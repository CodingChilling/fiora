// Service worker: guarda la app para abrirla sin conexión. La música vive en IndexedDB, no aquí.
const CACHE = 'fiora-v50';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/app.js', 'js/db.js', 'js/store.js', 'js/tags.js', 'js/library.js', 'js/player.js',
  'js/cloud.js', 'js/sources.js', 'js/lyrics.js', 'js/recs.js', 'js/icons.js', 'js/sync.js', 'js/flac.js', 'js/ai.js', 'js/oci.js', 'js/vault.js', 'js/tagwrite.js', 'js/images.js', 'js/playlists-data.js', 'js/playlist-ui.js', 'js/account.js', 'js/config.js',
  'js/radio.js', 'js/discover.js', 'js/radio-data.js', 'js/session.js', 'js/explore-ui.js', 'js/groups.js', 'js/merge.js',
  'js/habits.js', 'js/creature.js', 'js/creature-data.js', 'js/profile-ui.js', 'js/stats-extra.js', 'js/stats-ui.js', 'js/spatial.js', 'js/fades.js', 'js/covers.js',
  'vendor/jsmediatags.min.js', 'icons/icon-64.png', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];
// Lo que se carga al usarlo (mapa de radios, escena 3D de la criatura). Se guarda también al instalar,
// para que esas pantallas funcionen sin conexión, pero si falla no impide la instalación.
const LAZY = ['js/atlas.js', 'data/world.json', 'js/creature3d.js', 'js/creature-shapes.js', 'vendor/three.module.min.js', 'vendor/three.core.min.js'];
// Si la red no contesta en este tiempo se usa la copia guardada (conexiones que «parecen» funcionar pero no cargan nada).
// Tras una espera así, durante un rato se sirve directamente la copia (y se actualiza por detrás): los
// módulos se piden unos tras otros y esperar cada vez sumaría muchos segundos.
const NET_WAIT = 3500, SLOW_FOR = 60000;
let slowUntil = 0;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL).then(() => Promise.all(LAZY.map(f => c.add(f).catch(() => null)))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Archivos de la propia app: primero la red (para recibir actualizaciones); si falla o tarda demasiado,
// la copia guardada. Si la red contesta más tarde, la copia se actualiza igualmente.
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const page = req.mode === 'navigate';
  const cached = () => caches.match(req, { ignoreSearch: true }).then(r => r || (page ? caches.match('index.html') : null));
  let saving = null;
  const net = fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); saving = caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  });
  e.waitUntil(net.then(() => saving, () => null).catch(() => null));
  e.respondWith(new Promise(resolve => {
    let done = false;
    const fromCache = () => cached().then(r => { if (r && !done) { done = true; resolve(r); } return r; });
    const t0 = Date.now(), wait = t0 < slowUntil ? 0 : NET_WAIT;
    const timer = setTimeout(() => { if (wait) slowUntil = Date.now() + SLOW_FOR; fromCache(); }, wait);
    net.then(r => {
      clearTimeout(timer);
      if (Date.now() - t0 < NET_WAIT) slowUntil = 0;           // la red vuelve a contestar a tiempo
      if (!done) { done = true; resolve(r); }
    })
      .catch(() => { clearTimeout(timer); fromCache().then(r => { if (!done) { done = true; resolve(r || Response.error()); } }); });
  }));
});
