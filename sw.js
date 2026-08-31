/* Service Worker - eSIM Manager */
const CACHE = 'esim-manager-v2';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/db.js',
  './js/sync.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // No interceptar llamadas a la API / otros orígenes
  if (e.request.method !== 'GET' ||
      url.origin !== self.location.origin) return;
  // El propio sw.js no se cachea (siempre obtener la última versión)
  if (url.pathname.endsWith('/sw.js')) return;

  // Estrategia network-first: siempre intentar la última versión en línea;
  // si no hay internet, caer a la caché (funciona offline).
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('./')))
  );
});
