const cacheName = 'der-checklist-shell-v43';
const version = cacheName.split('-').at(-1);
const scripts = ['app.js','register-sw.js','catalog-import.js','catalog-sync.js','operators-import.js','quinzenal.js','relatorios.js','xlsx.js','ocorrencias.js','cloud.js','instalar.js'];
const appFiles = ['./index.html',...scripts.map(name=>'./'+name+'?v='+version),
  './app.css?v='+version,'./logo-der.jpg','./manifest.webmanifest','./icon-192.png','./icon-512.png'];

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
  if (['painel-tv/','painel-tv/index.html','tv.html','tv.js'].some(path=>
    url.pathname===new URL(path,self.registration.scope).pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request,{cache:'no-cache',signal:AbortSignal.timeout(4000)});
        if (response.ok) return response;
      } catch { /* The last installed version is available without a connection. */ }
      const cache = await caches.open(cacheName);
      return (await cache.match('./index.html')) || Response.error();
    })());
    return;
  }
  event.respondWith(caches.open(cacheName).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const file = url.pathname.split('/').at(-1);
    if (!url.search && scripts.includes(file)) {
      const current = await cache.match('./'+file+'?v='+version);
      if (current) return current;
    }
    return fetch(event.request);
  }));
});

