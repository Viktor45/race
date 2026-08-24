const TIMEOUT_MS = 5000
const BATCH_SIZE = 5

let currentServers = []
let currentDomains = []
let abortController = null
let testResults = []
let customDomains = null

function parseList(text) {
	return text
		.split('\n')
		.map(line => line.trim())
		.filter(line => line && !line.startsWith('#'))
}

function isValidUrl(str) {
	try {
		new URL(str)
		return true
	} catch {
		return false
	}
}

function makeDnsPacket(domain) {
	const labels = domain.toLowerCase().split('.')
	let qname = []
	for (const label of labels) {
		const bytes = new TextEncoder().encode(label)
		qname.push(bytes.length, ...bytes)
	}
	qname.push(0)

	const header = new Uint8Array([
		0x00, 0x00, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	])

	const qtype = new Uint8Array([0x00, 0x01])
	const qclass = new Uint8Array([0x00, 0x01])

	return new Uint8Array([...header, ...qname, ...qtype, ...qclass])
}

function fetchWithTimeout(url, options, timeout = TIMEOUT_MS, signal = null) {
	const timeoutController = new AbortController()

	const finalController = new AbortController()

	// If an external signal is provided, forward its abort to finalController
	const forwardAbort = () => finalController.abort()
	if (signal) {
		if (signal.aborted) forwardAbort()
		else signal.addEventListener('abort', forwardAbort, { once: true })
	}

	// Forward timeout abort as well
	const timeoutId = setTimeout(() => timeoutController.abort(), timeout)
	if (timeoutController.signal.aborted) forwardAbort()
	else
		timeoutController.signal.addEventListener('abort', forwardAbort, {
			once: true,
		})

	return fetch(url, { ...options, signal: finalController.signal }).finally(
		() => {
			clearTimeout(timeoutId)
			try {
				if (signal) signal.removeEventListener('abort', forwardAbort)
			} catch (e) {}
			try {
				timeoutController.signal.removeEventListener('abort', forwardAbort)
			} catch (e) {}
		},
	)
}

async function testProvider(provider, signal = null) {
	let connectivityTime = null
	let dnsWorks = false

	// Probe with no-cors requests on purpose. Most public resolvers don't send
	// CORS headers, so a cors-mode request is blocked by the browser even when
	// the server answered — and the browser can't tell that CORS block apart
	// from a real network failure. An opaque no-cors response can't be read,
	// but it resolves whenever the server responds at all, which proves
	// reachability and gives us the round-trip time. So servers that simply
	// don't allow CORS get a latency in ms instead of being rejected.
	// HEAD first (lighter), GET as a fallback for servers that refuse HEAD.
	const attempts = [
		{ method: 'HEAD', mode: 'no-cors' },
		{ method: 'GET', mode: 'no-cors' },
	]

	for (const options of attempts) {
		const start = performance.now()
		try {
			await fetchWithTimeout(provider.url, options, TIMEOUT_MS, signal)
			connectivityTime = performance.now() - start
			break
		} catch (err) {
			if (signal && signal.aborted) throw err
		}
	}

	if (connectivityTime === null) {
		return { url: provider.url, error: 'Network unreachable' }
	}

	const testDomain = currentDomains[0] || 'example.com'
	try {
		if (provider.type === 'json') {
			const url = `${provider.url}?name=${encodeURIComponent(testDomain)}&type=A`
			const res = await fetchWithTimeout(url, {}, TIMEOUT_MS, signal)
			const contentType = (
				res.headers.get('content-type') || ''
			).toLowerCase()
			if (!contentType.includes('application/json'))
				throw new Error('Invalid JSON')
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const data = await res.json()
			if (data.Status !== 0) throw new Error('DNS error')
			dnsWorks = true
		} else {
			const packet = makeDnsPacket(testDomain)
			const res = await fetchWithTimeout(
				provider.url,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/dns-message' },
					body: packet,
				},
				TIMEOUT_MS,
				signal,
			)
			const contentType = (
				res.headers.get('content-type') || ''
			).toLowerCase()
			if (!contentType.includes('application/dns-message'))
				throw new Error('Invalid DoH')
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			dnsWorks = true
		}
	} catch (err) {
		if (signal && signal.aborted) throw err
		dnsWorks = false
	}

	return {
		url: provider.url,
		min: connectivityTime,
		avg: connectivityTime,
		max: connectivityTime,
		dnsWorks,
	}
}

async function loadBuiltinServers() {
	try {
		const text = await fetch('data/servers.txt').then(r => r.text())
		const urls = parseList(text).filter(isValidUrl)
		return urls.map(url => ({
			url,
			type: url.includes('/resolve') ? 'json' : 'doh',
		}))
	} catch {
		return [{ url: 'https://1.1.1.1/dns-query', type: 'doh' }]
	}
}

async function init() {
	currentServers = await loadBuiltinServers()
	const startBtn = document.getElementById('startBtn')
	startBtn.disabled = false
	startBtn.innerHTML =
		'<span class="material-symbols-outlined">play_arrow</span> Start Test'
	document.getElementById('singleDomain').value = 'example.com'
}

document.getElementById('singleDomain').addEventListener('input', e => {
	const domain = e.target.value.trim()
	customDomains = domain ? [domain] : null
})

document.getElementById('domainFile').addEventListener('change', async e => {
	const file = e.target.files[0]
	if (file) {
		const text = await file.text()
		const domains = parseList(text).filter(d => d.length > 0)
		if (domains.length > 0) {
			customDomains = domains
			document.getElementById('singleDomain').value = domains[0] || ''
		}
	}
})

document.getElementById('serverFile').addEventListener('change', async e => {
	const file = e.target.files[0]
	if (file) {
		const text = await file.text()
		const urls = parseList(text).filter(isValidUrl)
		if (urls.length > 0) {
			currentServers = urls.map(url => ({
				url,
				type: url.includes('/resolve') ? 'json' : 'doh',
			}))
		}
	}
})

function resetUI() {
	document.getElementById('startBtn').classList.remove('hidden')
	document.getElementById('cancelBtn').classList.add('hidden')
	document.querySelector('.progress-group').classList.add('hidden')
}

function renderInitialResults() {
	const resultsList = document.getElementById('resultsList')
	resultsList.innerHTML = ''
	currentServers.forEach(provider => {
		const li = document.createElement('li')
		li.className = 'server-item'
		li.dataset.min = Infinity // unknown yet
		li.dataset.pending = 'true'
		li.dataset.speed = 'pending'

		const header = document.createElement('div')
		header.className = 'server-header'

		const urlEl = document.createElement('div')
		urlEl.className = 'server-url'
		urlEl.textContent = provider.url
		urlEl.title = provider.url

		const avgEl = document.createElement('div')
		avgEl.className = 'server-avg skeleton-text'

		header.appendChild(urlEl)
		header.appendChild(avgEl)

		const barContainer = document.createElement('div')
		barContainer.className = 'server-bar-container'

		const bar = document.createElement('div')
		bar.className = 'server-bar skeleton-bar'

		barContainer.appendChild(bar)

		li.appendChild(header)
		li.appendChild(barContainer)

		resultsList.appendChild(li)
	})
}

function renderResultItem(result) {
	const li = document.createElement('li')
	li.className = 'server-item'
	li.dataset.min = result.error ? Infinity : String(result.min)
	if (result.error) li.dataset.speed = 'error'

	const header = document.createElement('div')
	header.className = 'server-header'

	const urlEl = document.createElement('div')
	urlEl.className = 'server-url'
	urlEl.textContent = result.url
	urlEl.title = result.url

	const avgEl = document.createElement('div')
	avgEl.className = 'server-avg'
	if (result.error) {
		avgEl.classList.add('error')
		avgEl.textContent = result.error
	} else {
		const mainTime = result.avg
		avgEl.textContent = `${mainTime.toFixed(1)} ms`
		const dnsStatus = result.dnsWorks ? '✅ DNS OK' : '⚠️ DNS failed'
		const titleText = `${dnsStatus}\nNetwork: ${mainTime.toFixed(1)} ms`
		avgEl.title = titleText
	}

	header.appendChild(urlEl)
	header.appendChild(avgEl)

	const barContainer = document.createElement('div')
	barContainer.className = 'server-bar-container'

	const bar = document.createElement('div')
	bar.className = 'server-bar'
	bar.style.width = '0%'
	if (result.error) {
		bar.classList.add('error')
	}

	barContainer.appendChild(bar)

	li.appendChild(header)
	li.appendChild(barContainer)

	// apply visual class for speed if available
	if (!result.error) {
		const mainTime = result.avg
		let barClass = 'slow'
		if (mainTime <= 50) barClass = 'fast'
		else if (mainTime <= 150) barClass = 'medium'
		bar.classList.add(barClass)
		li.dataset.speed = barClass
	}

	return li
}

function insertSortedResult(result) {
	const resultsList = document.getElementById('resultsList')
	const newLi = renderResultItem(result)

	// replace the "Testing…" placeholder for this server
	for (const li of resultsList.children) {
		if (li.querySelector('.server-url')?.textContent === result.url) {
			li.remove()
			break
		}
	}

	let inserted = false
	for (const li of resultsList.children) {
		const otherMin = Number(li.dataset.min)
		const otherValue = Number.isFinite(otherMin) ? otherMin : Infinity
		if (!result.error) {
			const myMin = Number(result.min)
			if (myMin < otherValue) {
				resultsList.insertBefore(newLi, li)
				inserted = true
				break
			}
		}
	}

	if (!inserted) resultsList.appendChild(newLi)
}

function finalizePendingTests() {
	const resultsList = document.getElementById('resultsList')
	const items = Array.from(resultsList.children)

	items.forEach(item => {
		if (!item.dataset.pending) return
		delete item.dataset.pending
		item.dataset.min = Infinity
		item.dataset.speed = 'error'
		const avgEl = item.querySelector('.server-avg')
		if (avgEl) {
			avgEl.textContent = 'Timeout'
			avgEl.className = 'server-avg error'
		}
		const bar = item.querySelector('.server-bar')
		if (bar) {
			bar.className = 'server-bar error'
			bar.style.width = '0%'
		}
		const url = item.querySelector('.server-url')?.textContent || 'Unknown'
		testResults.push({ url, error: 'Timeout' })
	})
}

function sortResults() {
	const resultsList = document.getElementById('resultsList')
	if (!resultsList) return
	const items = Array.from(resultsList.children)
	if (items.length === 0) return

	items.sort((a, b) => {
		const aMin = Number.parseFloat(a.dataset.min)
		const bMin = Number.parseFloat(b.dataset.min)
		return (Number.isFinite(aMin) ? aMin : Infinity) -
			(Number.isFinite(bMin) ? bMin : Infinity)
	})

	resultsList.innerHTML = ''
	items.forEach(item => resultsList.appendChild(item))
}

function renderBars() {
	const successfulResults = testResults.filter(r => !r.error)
	if (successfulResults.length === 0) return

	const avgValues = successfulResults.map(r => r.avg)
	const minAvg = Math.min(...avgValues)
	const maxAvg = Math.max(...avgValues)

	const resultsList = document.getElementById('resultsList')
	const items = Array.from(resultsList.children)

	items.forEach(item => {
		const url = item.querySelector('.server-url')?.textContent
		const result = testResults.find(r => r.url === url && !r.error)
		if (!result) return

		let percent = 0
		if (maxAvg > minAvg) {
			percent = ((result.avg - minAvg) / (maxAvg - minAvg)) * 100
		}
		if (percent < 5) percent = 5

		let barClass = 'slow'
		if (result.avg <= 50) {
			barClass = 'fast'
		} else if (result.avg <= 150) {
			barClass = 'medium'
		}

		const bar = item.querySelector('.server-bar')
		if (bar) {
			bar.className = `server-bar ${barClass}`
			bar.style.width = `${percent.toFixed(1)}%`
		}
	})
}

function updateSummary() {
	const ok = testResults.filter(r => !r.error)
	const errors = testResults.length - ok.length

	document.getElementById('statTested').textContent = testResults.length
	document.getElementById('statErrors').textContent = errors

	const fastestEl = document.getElementById('statFastest')
	const medianEl = document.getElementById('statMedian')
	if (ok.length === 0) {
		fastestEl.textContent = '—'
		medianEl.textContent = '—'
		return
	}

	const times = ok.map(r => r.avg).sort((a, b) => a - b)
	fastestEl.textContent = `${times[0].toFixed(1)} ms`
	const mid = Math.floor(times.length / 2)
	const median =
		times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2
	medianEl.textContent = `${median.toFixed(1)} ms`
}

let activeFilter = 'all'
let filterText = ''

function applyFilter() {
	const items = document.getElementById('resultsList').children
	for (const li of items) {
		const speed = li.dataset.speed || ''
		let visible = activeFilter === 'all' || speed === activeFilter
		if (visible && filterText) {
			const url = li.querySelector('.server-url')?.textContent || ''
			if (!url.toLowerCase().includes(filterText)) visible = false
		}
		li.classList.toggle('hidden', !visible)
	}
}

function downloadCSV(filename, csv) {
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.setAttribute('hidden', '')
	a.setAttribute('href', url)
	a.setAttribute('download', filename)
	document.body.appendChild(a)
	a.click()
	document.body.removeChild(a)
	URL.revokeObjectURL(url)
}

document.getElementById('startBtn').addEventListener('click', async () => {
	const startBtn = document.getElementById('startBtn')
	const cancelBtn = document.getElementById('cancelBtn')
	const exportBtn = document.getElementById('exportBtn')
	const progressBar = document.getElementById('progressBar')
	const progressText = document.getElementById('progressText')
	const progressGroup = document.querySelector('.progress-group')
	const resultsList = document.getElementById('resultsList')
	const resultsEl = document.getElementById('results')

	const domainsToUse = customDomains || [
		document.getElementById('singleDomain').value.trim() || 'example.com',
	]
	currentDomains = domainsToUse

	testResults = []
	resultsEl.classList.remove('hidden')
	exportBtn.classList.add('hidden')
	document.getElementById('shareBtn').classList.add('hidden')

	renderInitialResults()
	updateSummary()

	// reset filters so pending rows are visible during the run
	activeFilter = 'all'
	filterText = ''
	document.getElementById('filterSearch').value = ''
	for (const c of document.querySelectorAll('#filterChips .chip')) {
		c.classList.toggle('active', c.dataset.filter === 'all')
	}

	startBtn.classList.add('hidden')
	cancelBtn.classList.remove('hidden')
	progressGroup.classList.remove('hidden')

	const total = currentServers.length
	progressBar.max = total
	progressBar.value = 0
	progressText.textContent = `0 / ${total} servers tested`

	abortController = new AbortController()

	cancelBtn.onclick = () => {
		abortController.abort()
		resetUI()
		exportBtn.classList.add('hidden')
		resultsEl.classList.add('hidden')
		resultsList.innerHTML = ''
		testResults = []
	}

	let completed = 0
	const serverBatches = []
	for (let i = 0; i < currentServers.length; i += BATCH_SIZE) {
		serverBatches.push(currentServers.slice(i, i + BATCH_SIZE))
	}

	try {
		for (const batch of serverBatches) {
			const batchPromises = batch.map(provider =>
				testProvider(provider, abortController.signal)
					.then(result => {
						if (abortController.signal.aborted) return result
						testResults.push(result)
						insertSortedResult(result)
						renderBars()
						updateSummary()
						applyFilter()
						return result
					})
					.catch(err => {
						if (err.name === 'AbortError') throw err
						if (abortController.signal.aborted) return null
						const result = { url: provider.url, error: 'Test failed' }
						testResults.push(result)
						insertSortedResult(result)
						renderBars()
						updateSummary()
						applyFilter()
						return result
					}),
			)

			const progressPromises = batchPromises.map(p =>
				p.catch(() => {}).finally(() => {
					completed++
					progressBar.value = completed
					progressText.textContent = `${completed} / ${total} servers tested`
				}),
			)

			await Promise.all(progressPromises)

			if (abortController.signal.aborted) break
		}
	} catch (err) {
		if (err.name !== 'AbortError') {
			console.error('Test error:', err)
		}
	} finally {
		if (!abortController.signal.aborted) {
			finalizePendingTests()
			sortResults()
			renderBars()
			updateSummary()
			applyFilter()
			exportBtn.classList.remove('hidden')
			if (navigator.share)
				document.getElementById('shareBtn').classList.remove('hidden')
			resetUI()
		}
	}
})

function buildCSV() {
	const headers = ['Server URL', 'Network Latency (ms)', 'DNS Works', 'Status']
	const rows = testResults.map(r => {
		if (r.error) {
			return `"${r.url.replace(/"/g, '""')}",,,"${r.error.replace(/"/g, '""')}"`
		} else {
			const dnsStatus = r.dnsWorks ? 'Yes' : 'No'
			return `"${r.url.replace(/"/g, '""')}",${r.avg.toFixed(2)},${dnsStatus},OK`
		}
	})
	return [headers.join(','), ...rows].join('\n')
}

document.getElementById('exportBtn').addEventListener('click', () => {
	downloadCSV('doh-latency-results.csv', buildCSV())
})

document.getElementById('shareBtn').addEventListener('click', async () => {
	const ok = testResults.filter(r => !r.error).length
	const text = `DoH latency test: ${ok} of ${testResults.length} resolvers responded`
	try {
		const file = new File([buildCSV()], 'doh-latency-results.csv', {
			type: 'text/csv',
		})
		if (navigator.canShare && navigator.canShare({ files: [file] })) {
			await navigator.share({ files: [file], title: 'DoH latency results' })
		} else {
			await navigator.share({ title: 'DoH latency results', text })
		}
	} catch (e) {
		// user dismissed the share sheet — nothing to do
	}
})

document.getElementById('toggleSettingsBtn').addEventListener('click', () => {
	const form = document.getElementById('settingsForm')
	const btn = document.getElementById('toggleSettingsBtn')
	const isHidden = form.classList.contains('hidden')

	if (isHidden) {
		form.classList.remove('hidden')
		btn.innerHTML = '<span class="material-symbols-outlined">close</span> Close'
	} else {
		form.classList.add('hidden')
		btn.innerHTML =
			'<span class="material-symbols-outlined">settings</span> Settings'
	}
})

document.getElementById('toggleAboutBtn').addEventListener('click', () => {
	const panel = document.getElementById('aboutPanel')
	const btn = document.getElementById('toggleAboutBtn')
	const isHidden = panel.classList.contains('hidden')

	if (isHidden) {
		panel.classList.remove('hidden')
		btn.innerHTML = '<span class="material-symbols-outlined">close</span> Close'
	} else {
		panel.classList.add('hidden')
		btn.innerHTML = '<span class="material-symbols-outlined">info</span> About'
	}
})

document.getElementById('filterChips').addEventListener('click', e => {
	const chip = e.target.closest('.chip')
	if (!chip) return
	activeFilter = chip.dataset.filter
	for (const c of document.querySelectorAll('#filterChips .chip')) {
		c.classList.toggle('active', c === chip)
	}
	applyFilter()
})

document.getElementById('filterSearch').addEventListener('input', e => {
	filterText = e.target.value.trim().toLowerCase()
	applyFilter()
})

function getEffectiveTheme() {
	const saved = document.documentElement.dataset.theme
	if (saved === 'light' || saved === 'dark') return saved
	return window.matchMedia('(prefers-color-scheme: dark)').matches
		? 'dark'
		: 'light'
}

function updateThemeButton() {
	const btn = document.getElementById('themeBtn')
	const icon = btn.querySelector('.material-symbols-outlined')
	// show the theme the button will switch to
	icon.textContent = getEffectiveTheme() === 'dark' ? 'light_mode' : 'dark_mode'
}

document.getElementById('themeBtn').addEventListener('click', () => {
	const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark'
	document.documentElement.dataset.theme = next
	try {
		localStorage.setItem('theme', next)
	} catch (e) {}
	updateThemeButton()
})

// keep the icon in sync while the user hasn't made an explicit choice
window
	.matchMedia('(prefers-color-scheme: dark)')
	.addEventListener('change', () => {
		if (!document.documentElement.dataset.theme) updateThemeButton()
	})

updateThemeButton()

init().catch(console.error)

// PWA: install prompt (Chromium fires it; other browsers use their own UI)
const installBtn = document.getElementById('installBtn')
let deferredInstallPrompt = null

window.addEventListener('beforeinstallprompt', e => {
	e.preventDefault()
	deferredInstallPrompt = e
	installBtn.classList.remove('hidden')
})

installBtn.addEventListener('click', async () => {
	if (!deferredInstallPrompt) return
	deferredInstallPrompt.prompt()
	await deferredInstallPrompt.userChoice
	deferredInstallPrompt = null
	installBtn.classList.add('hidden')
})

window.addEventListener('appinstalled', () => {
	deferredInstallPrompt = null
	installBtn.classList.add('hidden')
})

// PWA: offline indicator
const offlineBadge = document.getElementById('offlineBadge')
function updateOnlineStatus() {
	offlineBadge.classList.toggle('hidden', navigator.onLine)
}
window.addEventListener('online', updateOnlineStatus)
window.addEventListener('offline', updateOnlineStatus)
updateOnlineStatus()

// PWA: service worker with an explicit "update available" flow — the new
// worker waits for the user to confirm a reload instead of swapping in
// under a running test.
if ('serviceWorker' in navigator) {
	let reloadedForUpdate = false
	navigator.serviceWorker.addEventListener('controllerchange', () => {
		if (reloadedForUpdate) return
		reloadedForUpdate = true
		window.location.reload()
	})

	window.addEventListener('load', () => {
		navigator.serviceWorker
			.register('sw.js')
			.then(reg => {
				reg.addEventListener('updatefound', () => {
					const newWorker = reg.installing
					if (!newWorker) return
					newWorker.addEventListener('statechange', () => {
						const hasActiveController = !!navigator.serviceWorker.controller
						if (newWorker.state === 'installed' && hasActiveController) {
							document
								.getElementById('updateToast')
								.classList.remove('hidden')
						}
					})
				})
			})
			.catch(console.error)
	})
}

document.getElementById('updateReloadBtn').addEventListener('click', async () => {
	if (!('serviceWorker' in navigator)) return
	const reg = await navigator.serviceWorker.getRegistration()
	if (reg && reg.waiting) reg.waiting.postMessage('skip-waiting')
})
