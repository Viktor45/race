// sw.js — must be served from the repository root so its scope covers the app
const CACHE_NAME = 'doh-tester-v3'
const urlsToCache = [
	'./',
	'./index.html',
	'src/style.css',
	'src/script.js',
	'src/theme.js',
	'data/servers.txt',
	'data/domains.txt',
	'src/manifest.json',
]

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)),
	)
	self.skipWaiting()
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
					const copy = response.clone()
					caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy))
					return response
				})
				.catch(() => caches.match(event.request)),
		)
		return
	}

	event.respondWith(
		caches
			.match(event.request)
			.then(response => response || fetch(event.request)),
	)
})
