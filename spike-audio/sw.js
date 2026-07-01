// Minimal service worker — just enough to make the spike installable as a PWA
// (installed PWAs get better background-audio behaviour than a browser tab).
// Cache-first for the app shell; audio is user-picked at runtime, never cached here.

const CACHE = 'slipstream-spike-v1';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request))
  );
});
