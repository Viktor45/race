// sw.js — must be served from the repository root so its scope covers the app
const CACHE_NAME = 'doh-tester-v7'
const urlsToCache = [
	'./',
	'index.html',
	'src/style.css',
	'src/script.js',
	'src/theme.js',
	'src/manifest.json',
	'data/servers.txt',
	'data/domains.txt',
	'images/favicon.ico',
	'images/favicon-32x32.png',
	'images/favicon-16x16.png',
	'images/apple-touch-icon.png',
	'images/android-chrome-192x192.png',
	'images/android-chrome-512x512.png',
]

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)),
	)
})

// the page asks us to take over when the user confirms an update
self.addEventListener('message', event => {
	if (event.data === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('activate', event => {
	event.waitUntil(
		caches
			.keys()
			.then(keys =>
				Promise.all(
					keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	)
})

self.addEventListener('fetch', event => {
	const url = new URL(event.request.url)

	if (url.origin !== self.location.origin) return

	// data files change weekly (auto-updated server list): prefer the network,
	// fall back to the cached copy when offline
	if (url.pathname.includes('/data/')) {
		event.respondWith(
			fetch(event.request)
				.then(response => {
					// Only cache successful basic responses — caching 4xx/5xx would
					// poison the offline fallback and silently degrade the
					// resolver list to nothing until the next successful fetch.
					if (response.ok && response.type === 'basic') {
						const copy = response.clone()
						caches
							.open(CACHE_NAME)
							.then(cache => cache.put(event.request, copy))
					}
					return response
				})
				.catch(() => caches.match(event.request)),
		)
		return
	}

	event.respondWith(
		caches
			.match(event.request)
			.then(response => response || fetch(event.request))
			// If we're offline AND the request isn't cached, fall back to the
			// app shell so SPA-style same-origin navigations don't surface the
			// browser's connection-error page.
			.catch(() => caches.match('./')),
	)
})
