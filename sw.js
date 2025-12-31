// sw.js
const CACHE_NAME = 'doh-tester-v1'
const urlsToCache = [
	'./',
	'./index.html',
	'./style.css',
	'./script.js',
	'./servers.txt',
	'./domains.txt',
	'./manifest.json',
]

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)),
	)
})

self.addEventListener('activate', event => {
	event.waitUntil(
		caches
			.keys()
			.then(keys =>
				Promise.all(
					keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)),
				),
			),
	)
})

self.addEventListener('fetch', event => {
	const url = new URL(event.request.url)

	if (url.origin !== self.location.origin) return

	event.respondWith(
		caches
			.match(event.request)
			.then(response => response || fetch(event.request)),
	)
})
