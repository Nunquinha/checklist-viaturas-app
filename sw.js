const cacheName = 'der-checklist-shell-v9';
const appFiles = ['./index.html','./quinzenal.js','./relatorios.js','./xlsx.js','./ocorrencias.js','./cloud.js','./instalar.js','./logo-der.jpg','./manifest.webmanifest','./icon-192.png','./icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(appFiles)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(
    names.filter(name => name.startsWith('der-checklist-shell-') && name !== cacheName)
      .map(name => caches.delete(name))
  )).then(()=>self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(cacheName).then(async cache =>
      (await cache.match('./index.html')) || fetch(event.request)
    ));
    return;
  }
  event.respondWith(caches.open(cacheName).then(async cache =>
    (await cache.match(event.request)) || fetch(event.request)
  ));
});
