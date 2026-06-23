const CACHE_APP = 'pontos-app-v2';
const CACHE_TILES = 'pontos-tiles-v1';

const APP_ASSETS = [
  '/S.ANGELO/pontos/index.html',
  '/S.ANGELO/pontos/manifest.json',
  '/S.ANGELO/pontos/icon-192.png',
  '/S.ANGELO/pontos/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
];

// Instala e faz cache dos assets principais
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(c => c.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Ativa e limpa caches antigos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_APP && k !== CACHE_TILES)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Estratégia de fetch
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Tiles de mapa: cache-first, guarda para offline
  if (url.includes('cartocdn.com') || url.includes('tile.openstreetmap') || url.includes('arcgisonline.com')) {
    e.respondWith(
      caches.open(CACHE_TILES).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(resp => {
            if (resp.ok) cache.put(e.request, resp.clone());
            return resp;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // Assets do app: cache-first
  if (url.includes('/S.ANGELO/pontos/') || url.includes('unpkg.com/leaflet')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        return cached || fetch(e.request).then(resp => {
          if (resp.ok) {
            caches.open(CACHE_APP).then(c => c.put(e.request, resp.clone()));
          }
          return resp;
        });
      })
    );
    return;
  }
});
