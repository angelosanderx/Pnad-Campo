// Service worker do app de campo (PNAD-C Campo). Cobre só o "app shell": o próprio
// campo.html, manifest, ícones e os pacotes externos fixos que ele carrega ao abrir
// (SDK do Firebase, Leaflet). NÃO intercepta nada do Firestore/Auth/tiles de mapa —
// eles têm sua própria persistência/cache e usam conexões (long-polling, streaming)
// que um service worker genérico poderia quebrar se tentasse interceptar.

const CACHE_NAME = 'campo-shell-v2';

const APP_SHELL_RELATIVE = [
  '/campo.html',
  '/manifest.json',
  '/icon-campo-192.png',
  '/icon-campo-512.png',
  '/icon-campo-apple.png',
];

const APP_SHELL_EXTERNAL = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js',
];

const APP_SHELL = [
  ...APP_SHELL_RELATIVE.map((p) => new URL(p, self.location.origin).href),
  ...APP_SHELL_EXTERNAL,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((e) => console.warn('[sw-campo] falha ao pré-cachear o app shell', e))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!APP_SHELL.includes(request.url)) return; // deixa passar tudo que não é o app shell

  // Network-first: busca a versão mais nova quando online (o app muda com frequência),
  // cai para o cache local quando offline ou a rede falhar.
  event.respondWith(
    fetch(request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copia));
        return resp;
      })
      .catch(() => caches.match(request))
  );
});
