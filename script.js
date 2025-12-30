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
		qname.push(label.length, ...new TextEncoder().encode(label))
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
	const timeoutId = setTimeout(() => timeoutController.abort(), timeout)
	const finalSignal = signal
		? AbortSignal.any([signal, timeoutController.signal])
		: timeoutController.signal
	return fetch(url, { ...options, signal: finalSignal }).finally(() =>
		clearTimeout(timeoutId),
	)
}

async function testProvider(provider, signal = null) {
	const start = performance.now()
	let connectivityTime = null
	let networkSuccess = false
	let dnsWorks = false

	try {
		await fetchWithTimeout(provider.url, { method: 'HEAD' }, TIMEOUT_MS, signal)
		connectivityTime = performance.now() - start
		networkSuccess = true
	} catch (err) {
		connectivityTime = performance.now() - start
		networkSuccess = false
	}

	if (!networkSuccess) {
		try {
			await fetchWithTimeout(
				provider.url,
				{ method: 'GET' },
				TIMEOUT_MS,
				signal,
			)
			connectivityTime = performance.now() - start
			networkSuccess = true
		} catch (err) {
			connectivityTime = performance.now() - start
			networkSuccess = false
		}
	}

	if (networkSuccess) {
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
			dnsWorks = false
		}
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
		const text = await fetch('servers.txt').then(r => r.text())
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
	document.getElementById('startBtn').disabled = false
	document.getElementById('startBtn').textContent = 'Start Test'
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
		li.dataset.min = Infinity
		li.innerHTML = `
      <div class="server-header">
        <div class="server-url" title="${provider.url}">${provider.url}</div>
        <div class="server-avg">Testing…</div>
      </div>
      <div class="server-bar-container">
        <div class="server-bar" style="width: 0%; background: var(--bar-bg);"></div>
      </div>
    `
		resultsList.appendChild(li)
	})
}

function renderResultItem(result) {
	const li = document.createElement('li')
	li.className = 'server-item'
	li.dataset.min = result.error ? Infinity : result.min

	if (result.error) {
		li.innerHTML = `
      <div class="server-header">
        <div class="server-url" title="${result.url}">${result.url}</div>
        <div class="server-avg error">${result.error}</div>
      </div>
      <div class="server-bar-container">
        <div class="server-bar error" style="width: 0%;"></div>
      </div>
    `
	} else {
		const mainTime = result.avg
		let barClass = 'slow'
		if (mainTime <= 50) barClass = 'fast'
		else if (mainTime <= 150) barClass = 'medium'

		const dnsStatus = result.dnsWorks ? '✅ DNS OK' : '⚠️ DNS failed'
		const titleText = `${dnsStatus}\nNetwork: ${mainTime.toFixed(1)} ms`

		li.innerHTML = `
      <div class="server-header">
        <div class="server-url" title="${result.url}">${result.url}</div>
        <div class="server-avg" title="${titleText}">${mainTime.toFixed(1)} ms</div>
      </div>
      <div class="server-bar-container">
        <div class="server-bar ${barClass}" style="width: 0%;"></div>
      </div>
    `
	}

	return li
}

function insertSortedResult(result) {
	const resultsList = document.getElementById('resultsList')
	const newLi = renderResultItem(result)

	let inserted = false
	for (const li of resultsList.children) {
		const otherMin = parseFloat(li.dataset.min)
		if (!result.error && (result.min < otherMin || otherMin === Infinity)) {
			resultsList.insertBefore(newLi, li)
			inserted = true
			break
		}
	}

	if (!inserted) {
		resultsList.appendChild(newLi)
	}
}

function finalizePendingTests() {
	const resultsList = document.getElementById('resultsList')
	const items = Array.from(resultsList.children)

	items.forEach(item => {
		const avgEl = item.querySelector('.server-avg')
		if (avgEl && avgEl.textContent === 'Testing…') {
			avgEl.textContent = 'Timeout'
			avgEl.className = 'server-avg error'
			const bar = item.querySelector('.server-bar')
			if (bar) {
				bar.className = 'server-bar error'
				bar.style.width = '0%'
			}
			const url = item.querySelector('.server-url')?.textContent || 'Unknown'
			testResults.push({ url, error: 'Timeout' })
			item.dataset.min = Infinity
		}
	})
}

function sortResults() {
	const resultsList = document.getElementById('resultsList')
	if (!resultsList) return
	const items = Array.from(resultsList.children)
	if (items.length === 0) return

	items.sort((a, b) => {
		const aMin = parseFloat(a.dataset.min) || Infinity
		const bMin = parseFloat(b.dataset.min) || Infinity
		return aMin - bMin
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

	renderInitialResults()

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
						testResults.push(result)
						insertSortedResult(result)
						renderBars()
						return result
					})
					.catch(err => {
						if (abortController.signal.aborted) {
							throw err
						}
						const result = { url: provider.url, error: 'Test failed' }
						testResults.push(result)
						insertSortedResult(result)
						renderBars()
						return result
					}),
			)

			batchPromises.forEach(p => {
				p.finally(() => {
					completed++
					progressBar.value = completed
					progressText.textContent = `${completed} / ${total} servers tested`
				})
			})

			await Promise.all(batchPromises)

			if (abortController.signal.aborted) break
		}
	} catch (err) {
		if (!abortController.signal.aborted) {
			console.error('Test error:', err)
		}
	} finally {
		if (!abortController.signal.aborted) {
			finalizePendingTests()
			sortResults()
			renderBars()
			exportBtn.classList.remove('hidden')
			resetUI()
		}
	}
})

document.getElementById('exportBtn').addEventListener('click', () => {
	const headers = ['Server URL', 'Network Latency (ms)', 'NO CORS', 'Status']
	const rows = testResults.map(r => {
		if (r.error) {
			return `"${r.url.replace(/"/g, '""')}",,,"${r.error.replace(/"/g, '""')}"`
		} else {
			const dnsStatus = r.dnsWorks ? 'Yes' : 'No'
			return `"${r.url.replace(/"/g, '""')}",${r.avg.toFixed(2)},${dnsStatus},OK`
		}
	})
	const csv = [headers.join(','), ...rows].join('\n')
	downloadCSV('doh-latency-results.csv', csv)
})

init().catch(console.error)
