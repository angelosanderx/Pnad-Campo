const CACHE = 'estudos-v2';
const ASSETS = ['/2027.html', '/icons/icon-192.png', '/icons/icon-512.png', '/manifest-estudos.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Requisições ao Firebase sempre vão para a rede
  if (e.request.url.includes('firestore') || e.request.url.includes('googleapis') || e.request.url.includes('gstatic')) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
