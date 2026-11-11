// Service worker: guarda la app para abrirla sin conexión. La música vive en IndexedDB, no aquí.
const CACHE = 'fiora-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/app.js', 'js/db.js', 'js/store.js', 'js/tags.js', 'js/library.js', 'js/player.js',
  'js/cloud.js', 'js/sources.js', 'js/lyrics.js', 'js/recs.js', 'js/icons.js', 'js/sync.js', 'js/account.js', 'js/config.js',
  'vendor/jsmediatags.min.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Archivos de la propia app: primero la red (para recibir actualizaciones) y, si falla, la copia guardada.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
