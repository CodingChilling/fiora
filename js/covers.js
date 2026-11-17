// Portadas que faltan (modo desarrollador). La IA de los géneros identifica el álbum o single de
// cada canción y la imagen se busca en dos catálogos públicos, gratuitos y sin clave:
//   · Apple (iTunes Search API): rápido; una consulta da el disco y su portada. Apple pide no pasar
//     de unas 20 consultas por minuto.
//   · MusicBrainz y su Cover Art Archive: más lento (una consulta por segundo y las imágenes vienen
//     de archive.org), pero con discos que Apple no tiene.
// Se usa Apple mientras le quede cupo en el minuto y, si no encuentra el disco, MusicBrainz. Si el
// navegador no deja leer las respuestas de Apple, se sigue solo con MusicBrainz.
const MB = 'https://musicbrainz.org/ws/2';
const CAA = 'https://coverartarchive.org';
const ITUNES = 'https://itunes.apple.com/search';
const GAP = 1100;            // ms entre consultas a MusicBrainz
const MIN_SCORE = 85;        // puntuación mínima de MusicBrainz para aceptar un resultado
const APPLE_PER_MIN = 20;    // consultas a Apple por minuto
const ART = 600;             // tamaño de la portada que se pide (px)
const WAIT = 20000;          // ms como mucho por consulta o descarga (si no, se da por fallida)

/** fetch con tiempo máximo: un servidor que no contesta no deja la búsqueda colgada. */
async function get(url, opts = {}) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), WAIT);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    const body = await (opts.as === 'blob' ? r.blob() : r.json().catch(() => null));
    return { ok: r.ok, status: r.status, body };
  } finally { clearTimeout(timer); }
}

/** Texto comparable: sin tildes, mayúsculas ni signos (salvo «+» y «#», que distinguen discos como «MOTOMAMI +»). */
export const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9+#]+/g, ' ').replace(/\s*([+#])/g, ' $1').trim();
/** Quita añadidos habituales que no forman parte del título del disco: «(Deluxe)», «- Single», «[Remastered]». */
const core = s => norm(String(s || '').replace(/\s*[([][^)\]]*(deluxe|remaster|edition|edición|version|versión|bonus|expanded)[^)\]]*[)\]]/gi, '').replace(/\s*-\s*(single|ep)$/i, ''));
/** Clave de un disco para agrupar canciones: «YHLQMDLG (Deluxe)» y «YHLQMDLG» son el mismo. */
export const discKey = (album, artist) => `${core(album)}|${norm(artist)}`;
/** Títulos que no dicen nada de la canción («Track 01», «Pista 3», «Sin título»…): no sirven para buscar. */
export const junkTitle = t => !norm(t) || /^(track|pista|audio|cancion|song|untitled|sin titulo|unknown|desconocid[ao])( ?\d+)?$/.test(norm(t));
/** ¿Los datos del archivo bastan para buscar directamente, sin la IA? */
export const searchable = (title, artist) => !junkTitle(title) && !unknownArtist(artist);

/** ¿Son el mismo título? Iguales una vez quitados tildes, signos y añadidos como «(Deluxe)». Nada aproximado. */
export function sameTitle(a, b) {
  const x = core(a), y = core(b);
  return !!x && x === y;
}
/** ¿Aparece el artista buscado entre los del resultado? */
export function sameArtist(credit, artist) {
  const want = norm(artist);
  if (!want) return false;
  const names = (credit || []).flatMap(c => [c.name, c.artist?.name]).map(norm).filter(Boolean);
  return names.some(n => n === want || n.includes(want) || want.includes(n));
}
/** Escapa los caracteres especiales de las consultas de MusicBrainz (Lucene). */
const q = s => `"${String(s).replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1')}"`;

// Las consultas a MusicBrainz pasan de una en una por esta cola (aunque se busquen varios discos a la vez).
let mbQueue = Promise.resolve();
const mbSlot = () => { const p = mbQueue.then(() => new Promise(r => setTimeout(r, GAP))); mbQueue = p; return mbQueue.then(() => {}); };
let firstMb = true;
async function mb(path) {
  if (firstMb) firstMb = false; else await mbSlot();
  let r;
  try { r = await get(`${MB}/${path}`, { headers: { Accept: 'application/json' } }); }
  catch (e) { throw new Error(e?.name === 'AbortError' ? 'MusicBrainz no responde. Inténtalo dentro de un rato' : navigator.onLine ? 'No se pudo contactar con MusicBrainz' : 'No hay conexión a internet'); }
  if (r.status === 503 || r.status === 429) throw new Error('MusicBrainz está limitando las consultas. Inténtalo dentro de un rato');
  return r.ok ? r.body : null;
}

// --- Apple ---------------------------------------------------------------
const apple = { calls: [], off: false, pause: 0 };
/** ¿Se puede consultar a Apple ahora mismo sin pasar de su límite? (si no, se usa MusicBrainz) */
function appleTurn() {
  const now = Date.now();
  if (apple.off || now < apple.pause) return false;
  apple.calls = apple.calls.filter(t => now - t < 60000);
  if (apple.calls.length >= APPLE_PER_MIN) return false;
  apple.calls.push(now);
  return true;
}
const country = () => { const m = /-([A-Za-z]{2})\b/.exec(navigator.language || ''); return (m ? m[1] : 'us').toLowerCase(); };
async function itunes(params) {
  if (!appleTurn()) return undefined;                       // sin cupo: que busque MusicBrainz
  let r;
  try { r = await get(`${ITUNES}?${new URLSearchParams({ ...params, country: country(), limit: '15' })}`); }
  catch (e) { if (e?.name !== 'AbortError' && navigator.onLine) apple.off = true; return undefined; }   // el navegador no deja leerla (CORS): solo MusicBrainz
  if (r.status === 403 || r.status === 429) { apple.pause = Date.now() + 60000; return undefined; }
  if (!r.ok) return undefined;
  return r.body?.results || [];
}
const artOf = x => String(x.artworkUrl100 || '').replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/i, `/${ART}x${ART}bb.jpg`);
// Cada imagen se descarga una sola vez aunque la pidan a la vez varias canciones del mismo disco.
const images = new Map();
const once = (key, fn) => { if (!images.has(key)) images.set(key, fn()); return images.get(key); };
function appleImage(url) { return url ? once(url, () => appleImageNow(url)) : Promise.resolve(null); }
async function appleImageNow(url) {
  let r;
  try { r = await get(url, { as: 'blob' }); } catch (e) { if (e?.name !== 'AbortError') apple.off = true; return null; }
  if (!r.ok) return null;
  const blob = r.body;
  return /^image\//.test(blob.type) && blob.size > 500 ? blob : null;
}
/** Portada en Apple de un disco (o, sin disco, del single o disco donde está la canción). undefined: no se ha podido consultar. */
async function appleFind({ album, artist, title = '' }) {
  const credit = x => [{ name: x.artistName }];
  if (album) {
    const res = await itunes({ term: `${artist} ${album}`, entity: 'album' });
    if (res === undefined) return undefined;
    const hit = res.find(x => sameTitle(x.collectionName, album) && sameArtist(credit(x), artist));
    if (hit) return { url: artOf(hit), id: `apple:${hit.collectionId}`, title: hit.collectionName };
  }
  if (title) {
    const res = await itunes({ term: `${artist} ${title}`, entity: 'song' });
    if (res === undefined) return undefined;
    const hit = res.find(x => sameTitle(x.trackName, title) && sameArtist(credit(x), artist) && (!album || sameTitle(x.collectionName, album) || sameTitle(x.collectionName, title)));
    if (hit) return { url: artOf(hit), id: `apple:${hit.collectionId}`, title: hit.collectionName };
  }
  return null;
}

/**
 * Grupos de lanzamiento de MusicBrainz que encajan con un álbum (o single) y su artista, del más
 * probable al menos. Solo los que coinciden de verdad en título y artista: nada aproximado.
 */
export async function candidates({ album, artist, title = '' }) {
  const out = [];
  const add = (id, name) => { if (id && !out.some(c => c.id === id)) out.push({ id, title: name }); };
  if (album && artist) {
    const d = await mb(`release-group/?query=${encodeURIComponent(`releasegroup:${q(album)} AND artist:${q(artist)}`)}&fmt=json&limit=8`);
    for (const g of d?.['release-groups'] || []) if ((g.score ?? 100) >= MIN_SCORE && sameTitle(g.title, album) && sameArtist(g['artist-credit'], artist)) add(g.id, g.title);
  }
  // Sin álbum fiable: el single o el disco donde aparece la grabación con ese título.
  if (!out.length && title && artist) {
    const d = await mb(`recording/?query=${encodeURIComponent(`recording:${q(title)} AND artist:${q(artist)}`)}&fmt=json&limit=5`);
    for (const rec of d?.recordings || []) {
      if ((rec.score ?? 100) < MIN_SCORE || !sameTitle(rec.title, title) || !sameArtist(rec['artist-credit'], artist)) continue;
      for (const rel of rec.releases || []) {
        const g = rel['release-group'];
        if (g && (!album || sameTitle(g.title || rel.title, album) || sameTitle(g.title || rel.title, title))) add(g.id, g.title || rel.title);
      }
    }
  }
  return out.slice(0, 4);
}

/** Descarga la portada delantera de un grupo de lanzamiento (500 px). null si no tiene. */
export function frontCover(groupId) { return once(`caa:${groupId}`, () => frontCoverNow(groupId)); }
async function frontCoverNow(groupId) {
  let r;
  try { r = await get(`${CAA}/release-group/${encodeURIComponent(groupId)}/front-500`, { as: 'blob' }); }
  catch { return null; }
  if (!r.ok) return null;
  const blob = r.body;
  return /^image\//.test(blob.type) && blob.size > 500 ? blob : null;
}

/**
 * Busca la portada de un lanzamiento. Prueba con cada consulta (lo que dijo la IA, lo que traía el
 * archivo), primero en Apple y luego en MusicBrainz. Devuelve {blob, id, title, from} o null.
 * Con `direct` (primera pasada, con los datos del archivo y sin IA): MusicBrainz solo se consulta
 * si Apple no ha podido contestar (sin cupo en ese minuto o bloqueado); si Apple contesta que no lo
 * tiene, se deja para la segunda pasada, con la IA.
 */
export async function find(queries, { direct = false } = {}) {
  const seen = new Set(), list = [];
  for (const query of queries) {
    if (!query?.artist || unknownArtist(query.artist) || !(query.album || query.title)) continue;
    const key = `${norm(query.album)}|${norm(query.artist)}|${norm(query.title)}`;
    if (!seen.has(key)) { seen.add(key); list.push(query); }
  }
  const asked = [];
  for (const query of list) {
    const a = await appleFind(query);
    if (a !== undefined) asked.push(query);
    const blob = a && await appleImage(a.url);
    if (blob) return { blob, id: a.id, title: a.title, from: 'apple' };
  }
  for (const query of list) {
    if (direct && asked.includes(query)) continue;
    for (const c of await candidates(query)) {
      const blob = await frontCover(c.id);
      if (blob) return { blob, id: c.id, title: c.title, from: 'musicbrainz' };
    }
  }
  return null;
}

/** Nombre de artista que no sirve para buscar («Artista desconocido», vacío…). */
export const unknownArtist = a => !norm(a) || /^(artista desconocido|unknown artist|desconocido|various artists|varios artistas|va)$/.test(norm(a));

/**
 * Portada de otro disco del mismo artista (en Apple y, si no, en MusicBrainz), cuando la del disco de la canción no
 * existe. Prefiere álbumes a singles. Devuelve {blob, id, title} o null.
 */
export async function artistCover(artist) {
  if (unknownArtist(artist)) return null;
  const res = await itunes({ term: artist, entity: 'album', attribute: 'artistTerm' });
  for (const x of (res || []).filter(x => norm(x.artistName) === norm(artist)).sort((p, q2) => (q2.trackCount || 0) - (p.trackCount || 0)).slice(0, 3)) {
    const blob = await appleImage(artOf(x));
    if (blob) return { blob, id: `apple:${x.collectionId}`, title: x.collectionName, from: 'apple' };
  }
  const d = await mb(`release-group/?query=${encodeURIComponent(`artist:${q(artist)}`)}&fmt=json&limit=15`);
  const groups = (d?.['release-groups'] || []).filter(g => (g.score ?? 100) >= MIN_SCORE && sameArtist(g['artist-credit'], artist) && norm(g['artist-credit']?.[0]?.name || g['artist-credit']?.[0]?.artist?.name) === norm(artist));
  const rank = g => (g['primary-type'] === 'Album' ? 0 : g['primary-type'] === 'EP' ? 1 : 2);
  for (const g of groups.sort((a, b) => rank(a) - rank(b)).slice(0, 5)) {
    const blob = await frontCover(g.id);
    if (blob) return { blob, id: g.id, title: g.title };
  }
  return null;
}

/**
 * Portada generada en el dispositivo (sin ningún servicio) para las canciones de las que no se
 * conoce ni el disco ni el artista: un degradado con el título y el artista. Siempre da una imagen.
 */
export async function generated({ title = '', artist = '' }) {
  const size = 600, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  let h = 0;
  for (const ch of `${artist}|${title}`) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const hue = h % 360, hue2 = (hue + 40 + (h >> 9) % 80) % 360;
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, `hsl(${hue} 55% 42%)`); grad.addColorStop(1, `hsl(${hue2} 60% 22%)`);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  g.fillStyle = 'rgba(255,255,255,0.10)';
  g.beginPath(); g.arc(size * 0.78, size * 0.26, size * 0.32, 0, Math.PI * 2); g.fill();
  const lines = (text, font, y, max = 2) => {
    g.font = font; const words = String(text).split(/\s+/).filter(Boolean); const out = []; let line = '';
    for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > size - 96 && line) { out.push(line); line = w; } else line = t; }
    if (line) out.push(line);
    return out.slice(0, max).map((l, i, a) => (i === max - 1 && out.length > max ? `${l}…` : l)).map((l, i) => [l, y + i * parseInt(font.match(/(\d+)px/)[1], 10) * 1.15]);
  };
  g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
  const tl = lines(title || 'Sin título', '700 58px system-ui, sans-serif', size - 150);
  const shift = (tl.length - 1) * 66;
  for (const [l, y] of tl) g.fillText(l, 48, y - shift);
  g.fillStyle = 'rgba(255,255,255,0.78)';
  for (const [l, y] of lines(unknownArtist(artist) ? '' : artist, '500 32px system-ui, sans-serif', size - 64, 1)) g.fillText(l, 48, y);
  return new Promise(r => c.toBlob(b => r(b), 'image/jpeg', 0.9));
}
