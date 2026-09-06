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
		const u = new URL(str)
		return u.protocol === 'http:' || u.protocol === 'https:'
	} catch {
		return false
	}
}

// Normalize and validate a user-supplied domain for a DNS query. Returns
// the lowercased ASCII domain, or null if the input is unusable. Strips
// scheme, path, port, and a single trailing dot; rejects domains with
// overlong labels, bad characters, or total length > 253 bytes.
function normalizeDomain(input) {
	if (typeof input !== 'string') return null
	let s = input.trim().toLowerCase()
	if (!s) return null

	// If a URL was pasted, drop the scheme/authority/path parts.
	if (s.includes('://')) {
		try {
			const u = new URL(s.startsWith('http') ? s : 'http://' + s)
			s = u.hostname
		} catch {
			return null
		}
	}

	// Strip a single trailing dot (FQDN form).
	if (s.endsWith('.')) s = s.slice(0, -1)
	if (!s) return null

	if (s.length > 253) return null

	const labels = s.split('.')
	// Allow letters, digits, hyphens, and xn-- punycode labels (IDN).
	const labelRe = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$|^xn--[a-z0-9-]+$/i
	for (const label of labels) {
		if (label.length === 0 || label.length > 63) return null
		if (!labelRe.test(label)) return null
	}
	return s
}

// Build a minimal RFC 8484 query packet for an A record. The caller is
// expected to have already validated the domain (see normalizeDomain), but
// we still defend per-label: cap each UTF-8 label at 63 bytes (DNS limit) and
// skip empty labels that would otherwise produce a malformed packet (e.g.
// "example.com." trailing dot, or "https://example.com" with empty parts).
function makeDnsPacket(domain) {
	const labels = domain
		.toLowerCase()
		.split('.')
		.filter(l => l.length > 0)
	let qname = []
	for (const label of labels) {
		const fullBytes = new TextEncoder().encode(label)
		// DNS labels are capped at 63 octets; truncate rather than let the
		// length-prefix byte wrap mod 256 (which would silently produce a
		// FORMERR-causing packet).
		const bytes = fullBytes.length > 63 ? fullBytes.slice(0, 63) : fullBytes
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
	// Race HEAD and GET in parallel so the worst-case probe time is TIMEOUT_MS
	// instead of 2×TIMEOUT_MS for servers that silently swallow one method.
	const attempts = [
		{ method: 'HEAD', mode: 'no-cors' },
		{ method: 'GET', mode: 'no-cors' },
	]

	const probeStart = performance.now()
	try {
		// Promise.any resolves on the first success; if both reject (or are
		// aborted) the aggregated error propagates after TIMEOUT_MS.
		const winner = await Promise.any(
			attempts.map(options =>
				fetchWithTimeout(provider.url, options, TIMEOUT_MS, signal),
			),
		)
		connectivityTime = performance.now() - probeStart
		// winner is unused — the resolved promise just tells us one attempt
		// completed; the elapsed wall time is what we report.
		void winner
	} catch (err) {
		if (signal && signal.aborted) throw err
		// Both attempts failed (or timed out): leave connectivityTime null so
		// the caller reports "Network unreachable".
	}

	if (connectivityTime === null) {
		return { url: provider.url, error: 'Network unreachable' }
	}

	// The settings UI accepts an uploaded domains.txt (one per line) but only
	// the first entry is tested per provider. This is intentional — the app
	// measures per-resolver reachability & latency, not per-domain
	// resolution — and keeps the run time bounded. Uploaded entries are
	// normalized and exposed via currentDomains for any future multi-domain
	// mode; until then only [0] is used.
	const testDomain = currentDomains[0] || 'example.com'
	try {
		if (provider.type === 'json') {
			const url = new URL(provider.url)
			url.searchParams.set('name', testDomain)
			url.searchParams.set('type', 'A')
			const res = await fetchWithTimeout(url.toString(), {}, TIMEOUT_MS, signal)
			const contentType = (res.headers.get('content-type') || '').toLowerCase()
			if (!contentType.includes('application/json'))
				throw new Error('Invalid JSON')
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const data = await res.json()
			if (data.Status !== 0) throw new Error('DNS error')
			if (!Array.isArray(data.Answer) || data.Answer.length === 0)
				throw new Error('Empty answer')
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
			const contentType = (res.headers.get('content-type') || '').toLowerCase()
			if (!contentType.includes('application/dns-message'))
				throw new Error('Invalid DoH')
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			dnsWorks = true
		}
	} catch (err) {
		if (signal && signal.aborted) throw err
		if (err && err.name === 'AbortError') throw err
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
		const urls = Array.from(new Set(parseList(text).filter(isValidUrl)))
		return urls.map(url => ({
			url,
			type: url.includes('/resolve') ? 'json' : 'doh',
		}))
	} catch {
		// Surface the failure so the user knows why the list shrunk to one entry.
		showStatus('Could not load the built-in server list — using a fallback.')
		return [{ url: 'https://1.1.1.1/dns-query', type: 'doh' }]
	}
}

// Show a non-fatal status message in #statusToast. Defined early because
// loadBuiltinServers uses it during init.
function showStatus(message) {
	const toast = document.getElementById('statusToast')
	if (!toast) return
	// Rewrite the text *after* unhiding so screen readers announce it.
	toast.textContent = message
	toast.classList.remove('hidden')
}

// Announce a milestone to screen readers via the polite #testStatus region.
// The visual progress bar updates every server; this only fires at ≤10%
// intervals so assistive tech doesn't get flooded.
function setTestStatus(message) {
	const el = document.getElementById('testStatus')
	if (el) el.textContent = message
}

async function init() {
	currentServers = await loadBuiltinServers()
	const startBtn = document.getElementById('startBtn')
	startBtn.disabled = false
	startBtn.innerHTML =
		'<span class="material-symbols-outlined" aria-hidden="true">play_arrow</span> Start Test'
	document.getElementById('singleDomain').value = 'example.com'
}

document.getElementById('singleDomain').addEventListener('input', e => {
	const raw = e.target.value.trim()
	if (!raw) {
		customDomains = null
		return
	}
	const normalized = normalizeDomain(raw)
	if (!normalized) {
		// Don't clobber customDomains if the user is mid-typing something
		// we can't yet parse, but still tell them.
		showStatus('Invalid domain — enter something like example.com')
		return
	}
	customDomains = [normalized]
})

document.getElementById('domainFile').addEventListener('change', async e => {
	const file = e.target.files[0]
	if (!file) return
	try {
		if (file.size > 5_000_000) {
			showStatus('Domain file is too large (limit 5 MB).')
			return
		}
		const text = await file.text()
		const domains = parseList(text)
			.map(normalizeDomain)
			.filter(d => d !== null)
		if (domains.length === 0) {
			showStatus('No valid domains found in the uploaded file.')
			return
		}
		customDomains = domains
		document.getElementById('singleDomain').value = domains[0] || ''
		showStatus(
			domains.length === 1
				? `Loaded domain: ${domains[0]}`
				: `Loaded ${domains.length} domains (the first one is tested).`,
		)
	} catch (err) {
		showStatus('Could not read the uploaded domains file.')
	}
})

document.getElementById('serverFile').addEventListener('change', async e => {
	const file = e.target.files[0]
	if (!file) return
	try {
		if (file.size > 5_000_000) {
			showStatus('Server file is too large (limit 5 MB).')
			return
		}
		const text = await file.text()
		const urls = Array.from(new Set(parseList(text).filter(isValidUrl)))
		if (urls.length === 0) {
			showStatus('No valid server URLs found in the uploaded file.')
			return
		}
		currentServers = urls.map(url => ({
			url,
			type: url.includes('/resolve') ? 'json' : 'doh',
		}))
		showStatus(`Loaded ${currentServers.length} servers from file.`)
		// A previous run's rows no longer match the new list — clear them so
		// the UI never shows results for a list that isn't loaded. If a test
		// is mid-run, leave it alone; the next Start resets everything.
		const isRunning = !document
			.querySelector('.progress-group')
			.classList.contains('hidden')
		if (!isRunning) {
			testResults = []
			document.getElementById('resultsList').innerHTML = ''
			document.getElementById('results').classList.add('hidden')
		}
	} catch (err) {
		showStatus('Could not read the uploaded server file.')
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
		// Screen readers need a label here — the visual shimmer is invisible
		// to them, and under prefers-reduced-motion the animation is gone too.
		const pendingLabel = document.createElement('span')
		pendingLabel.className = 'sr-only'
		pendingLabel.textContent = 'Testing'
		avgEl.appendChild(pendingLabel)

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
	// urlEl.title intentionally omitted — it duplicated textContent and
	// triggered double-announcement in some screen readers.

	const avgEl = document.createElement('div')
	avgEl.className = 'server-avg'
	if (result.error) {
		avgEl.classList.add('error')
		avgEl.textContent = result.error
		avgEl.setAttribute('aria-label', `Error: ${result.error}`)
	} else {
		const mainTime = result.avg
		const formatted = `${mainTime.toFixed(1)} ms`
		avgEl.textContent = formatted
		const dnsLabel = result.dnsWorks ? 'DNS OK' : 'DNS failed'
		avgEl.setAttribute('aria-label', `${formatted}, ${dnsLabel}`)
		avgEl.title = result.dnsWorks
			? `✅ DNS OK\nNetwork: ${formatted}`
			: `⚠️ DNS failed\nNetwork: ${formatted}`
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
		return (
			(Number.isFinite(aMin) ? aMin : Infinity) -
			(Number.isFinite(bMin) ? bMin : Infinity)
		)
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
	const list = document.getElementById('resultsList')
	const items = list.children
	const counts = { all: 0, fast: 0, medium: 0, slow: 0, error: 0 }
	let visible = 0

	// Drop any previous empty-state placeholder before re-evaluating.
	const prev = list.querySelector('.empty-state')
	if (prev) prev.remove()

	for (const li of items) {
		if (li.classList.contains('empty-state')) continue
		const speed = li.dataset.speed || ''
		if (counts[speed] !== undefined) counts[speed]++
		counts.all++
		const matchFilter = activeFilter === 'all' || speed === activeFilter
		let show = matchFilter
		if (show && filterText) {
			const url = li.querySelector('.server-url')?.textContent || ''
			if (!url.toLowerCase().includes(filterText)) show = false
		}
		li.classList.toggle('hidden', !show)
		if (show) visible++
	}

	// If the active filter hides everything, show an empty-state row so the
	// page doesn't look broken.
	if (items.length > 0 && visible === 0) {
		const li = document.createElement('li')
		li.className = 'empty-state'
		li.textContent = 'No servers match your filter.'
		list.appendChild(li)
	}

	// Update the per-chip counts so the user can see what's available.
	for (const chip of document.querySelectorAll('#filterChips .chip')) {
		const f = chip.dataset.filter
		const n = counts[f] ?? 0
		chip
			.querySelector('.chip-count')
			?.replaceChildren(document.createTextNode(String(n)))
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

	// Resolve the domain list with a fallback to the single-domain input,
	// then validate it. A malformed single-domain entry falls back to the
	// built-in example so the test still runs (better than blocking on a
	// typo) but the user sees a warning.
	const rawSingle = document.getElementById('singleDomain').value.trim()
	let domainsToUse
	if (customDomains && customDomains.length > 0) {
		domainsToUse = customDomains
	} else {
		const normalized = rawSingle ? normalizeDomain(rawSingle) : null
		if (!normalized) {
			showStatus(
				rawSingle
					? `"${rawSingle}" is not a valid domain — using example.com instead.`
					: 'Using example.com (no domain entered).',
			)
			domainsToUse = ['example.com']
		} else {
			domainsToUse = [normalized]
		}
	}
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
		const isActive = c.dataset.filter === 'all'
		c.classList.toggle('active', isActive)
		c.setAttribute('aria-pressed', isActive ? 'true' : 'false')
		c.querySelector('.chip-count')?.replaceChildren(
			document.createTextNode('0'),
		)
	}

	startBtn.classList.add('hidden')
	cancelBtn.classList.remove('hidden')
	// Move keyboard focus to the now-visible Cancel button so screen-reader and
	// keyboard users don't get dumped back to <body> when Start hides itself.
	cancelBtn.focus()
	progressGroup.classList.remove('hidden')

	const total = currentServers.length
	// <progress>.max must be > 0 (some UAs clamp or reject 0). The visual bar
	// is meaningless for an empty run anyway; we surface that case below.
	progressBar.max = total > 0 ? total : 1
	progressBar.value = 0
	progressText.textContent = `0 / ${total} servers tested`
	setTestStatus(`Starting test of ${total} servers`)
	let lastAnnouncedPct = -10

	abortController = new AbortController()
	// Capture locally so a Cancel-then-Start sequence cannot cross-wire two
	// runs through the module-level `abortController` reassignment.
	const controller = abortController

	// Two-tap cancel: first click arms it (text flips to "Confirm?"),
	// second click within 3 s aborts and discards the run. Avoids losing
	// partial results to an accidental click on the now-focused Cancel
	// button while still being keyboard-/screen-reader-friendly.
	let cancelArmed = false
	let cancelArmTimer = null
	const armCancel = () => {
		if (cancelArmed) {
			clearTimeout(cancelArmTimer)
			cancelArmed = false
			cancelBtn.innerHTML =
				'<span class="material-symbols-outlined" aria-hidden="true">close</span> Cancel'
			cancelBtn.setAttribute('aria-label', 'Cancel test')
			controller.abort()
			resetUI()
			exportBtn.classList.add('hidden')
			resultsEl.classList.add('hidden')
			resultsList.innerHTML = ''
			testResults = []
			return
		}
		cancelArmed = true
		cancelBtn.innerHTML =
			'<span class="material-symbols-outlined" aria-hidden="true">check</span> Confirm?'
		cancelBtn.setAttribute(
			'aria-label',
			'Confirm cancel — press again to abort the run',
		)
		cancelArmTimer = setTimeout(() => {
			cancelArmed = false
			cancelBtn.innerHTML =
				'<span class="material-symbols-outlined" aria-hidden="true">close</span> Cancel'
			cancelBtn.setAttribute('aria-label', 'Cancel test')
		}, 3000)
	}
	cancelBtn.onclick = armCancel

	let completed = 0
	const serverBatches = []
	for (let i = 0; i < currentServers.length; i += BATCH_SIZE) {
		serverBatches.push(currentServers.slice(i, i + BATCH_SIZE))
	}

	try {
		for (const batch of serverBatches) {
			const batchPromises = batch.map(provider =>
				testProvider(provider, controller.signal)
					.then(result => {
						if (controller.signal.aborted) return result
						testResults.push(result)
						insertSortedResult(result)
						renderBars()
						updateSummary()
						applyFilter()
						return result
					})
					.catch(err => {
						if (err.name === 'AbortError') throw err
						if (controller.signal.aborted) return null
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
				p
					.catch(() => {})
					.finally(() => {
						completed++
						progressBar.value = completed
						progressText.textContent = `${completed} / ${total} servers tested`
						// Throttle screen-reader announcements to ~10% steps so a
						// 223-server run doesn't queue 223 polite updates.
						const pct = total > 0 ? Math.floor((completed / total) * 100) : 100
						if (pct - lastAnnouncedPct >= 10) {
							lastAnnouncedPct = pct
							setTestStatus(
								`${pct}% complete — ${completed} of ${total} servers tested`,
							)
						}
					}),
			)

			await Promise.all(progressPromises)

			// Re-render derived views once per batch instead of once per
			// result — renderBars and applyFilter both iterate every row.
			renderBars()
			updateSummary()
			applyFilter()

			if (controller.signal.aborted) break
		}
	} catch (err) {
		if (err.name !== 'AbortError') {
			console.error('Test error:', err)
		}
	} finally {
		// Always clear any pending arm-state so a click mid-run that didn't
		// land in time doesn't leave the button stuck on "Confirm?".
		clearTimeout(cancelArmTimer)
		cancelArmed = false
		if (!controller.signal.aborted) {
			finalizePendingTests()
			sortResults()
			renderBars()
			updateSummary()
			applyFilter()
			exportBtn.classList.remove('hidden')
			if (navigator.share)
				document.getElementById('shareBtn').classList.remove('hidden')
			resetUI()
			// Hand focus back to Start so the keyboard user can re-run.
			startBtn.focus()
			// One final screen-reader announcement summarising the run.
			const okCount = testResults.filter(r => !r.error).length
			const fastest =
				okCount > 0
					? `${testResults
							.filter(r => !r.error)
							.map(r => r.avg)
							.sort((a, b) => a - b)[0]
							.toFixed(1)} ms`
					: 'no successful responses'
			setTestStatus(
				`Test complete: ${okCount} of ${testResults.length} resolvers responded. Fastest: ${fastest}.`,
			)
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
			return `"${r.url.replace(/"/g, '""')}",${r.avg.toFixed(2)},${dnsStatus},"OK"`
		}
	})
	return [headers.join(','), ...rows].join('\n')
}

document.getElementById('exportBtn').addEventListener('click', () => {
	try {
		downloadCSV('doh-latency-results.csv', buildCSV())
	} catch (err) {
		// Blob URL / anchor download can fail on locked-down browsers.
		showStatus('Could not start the CSV download in this browser.')
	}
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
		btn.innerHTML =
			'<span class="material-symbols-outlined" aria-hidden="true">close</span> Close'
	} else {
		form.classList.add('hidden')
		btn.innerHTML =
			'<span class="material-symbols-outlined" aria-hidden="true">settings</span> Settings'
	}
})

document.getElementById('toggleAboutBtn').addEventListener('click', () => {
	const panel = document.getElementById('aboutPanel')
	const btn = document.getElementById('toggleAboutBtn')
	const isHidden = panel.classList.contains('hidden')

	if (isHidden) {
		panel.classList.remove('hidden')
		btn.innerHTML =
			'<span class="material-symbols-outlined" aria-hidden="true">close</span> Close'
	} else {
		panel.classList.add('hidden')
		btn.innerHTML =
			'<span class="material-symbols-outlined" aria-hidden="true">info</span> About'
	}
})

document.getElementById('filterChips').addEventListener('click', e => {
	const chip = e.target.closest('.chip')
	if (!chip) return
	activeFilter = chip.dataset.filter
	for (const c of document.querySelectorAll('#filterChips .chip')) {
		const isActive = c === chip
		c.classList.toggle('active', isActive)
		c.setAttribute('aria-pressed', isActive ? 'true' : 'false')
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
		// First install: there's no prior controller, so `claim()` firing this
		// event would otherwise trigger a spurious reload on every fresh visit.
		if (!navigator.serviceWorker.controller) return
		if (reloadedForUpdate) return
		reloadedForUpdate = true
		window.location.reload()
	})

	window.addEventListener('load', () => {
		navigator.serviceWorker
			.register('sw.js')
			.then(reg => {
				const showUpdateToast = () => {
					const toast = document.getElementById('updateToast')
					if (!toast) return
					// Rewrite the message after unhiding so screen readers
					// announce it (most readers don't fire on a display
					// toggle of pre-existing text).
					toast.querySelector('span').textContent =
						'Update available. Reload to get the latest version.'
					toast.classList.remove('hidden')
				}

				reg.addEventListener('updatefound', () => {
					const newWorker = reg.installing
					if (!newWorker) return
					newWorker.addEventListener('statechange', () => {
						const hasActiveController = !!navigator.serviceWorker.controller
						if (newWorker.state === 'installed' && hasActiveController) {
							showUpdateToast()
						}
					})
				})

				// Proactively check for updates shortly after load so the toast
				// surfaces even when the user keeps the tab open across days.
				setTimeout(() => reg.update().catch(() => {}), 30_000)
			})
			.catch(console.error)
	})
}

document
	.getElementById('updateReloadBtn')
	.addEventListener('click', async () => {
		if (!('serviceWorker' in navigator)) return
		const reg = await navigator.serviceWorker.getRegistration()
		const toast = document.getElementById('updateToast')
		if (reg && reg.waiting) {
			reg.waiting.postMessage('skip-waiting')
		} else {
			// Nothing to wait for — either already up-to-date or already taken
			// over by an earlier controllerchange. Reload to be safe.
			if (toast) toast.classList.add('hidden')
			window.location.reload()
		}
	})
