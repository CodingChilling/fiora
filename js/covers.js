// Portadas que faltan (modo desarrollador). La IA de los géneros identifica el álbum o single de
// cada canción y la imagen se busca en el catálogo público de MusicBrainz y su Cover Art Archive:
// gratuitos, sin clave y con permiso para llamadas desde el navegador. MusicBrainz pide no pasar de
// una consulta por segundo, así que las búsquedas van de una en una.
const MB = 'https://musicbrainz.org/ws/2';
const CAA = 'https://coverartarchive.org';
const GAP = 1100;            // ms entre consultas a MusicBrainz
const MIN_SCORE = 85;        // puntuación mínima de MusicBrainz para aceptar un resultado

/** Texto comparable: sin tildes, mayúsculas ni signos (salvo «+» y «#», que distinguen discos como «MOTOMAMI +»). */
export const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9+#]+/g, ' ').replace(/\s*([+#])/g, ' $1').trim();
/** Quita añadidos habituales que no forman parte del título del disco: «(Deluxe)», «- Single», «[Remastered]». */
const core = s => norm(String(s || '').replace(/\s*[([][^)\]]*(deluxe|remaster|edition|edición|version|versión|bonus|expanded)[^)\]]*[)\]]/gi, '').replace(/\s*-\s*(single|ep)$/i, ''));
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

let last = 0;
async function mb(path) {
  const wait = last + GAP - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  let r;
  try { r = await fetch(`${MB}/${path}`, { headers: { Accept: 'application/json' } }); }
  catch { throw new Error(navigator.onLine ? 'No se pudo contactar con MusicBrainz' : 'No hay conexión a internet'); }
  if (r.status === 503 || r.status === 429) throw new Error('MusicBrainz está limitando las consultas. Inténtalo dentro de un rato');
  if (!r.ok) return null;
  return r.json().catch(() => null);
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
export async function frontCover(groupId) {
  let r;
  try { r = await fetch(`${CAA}/release-group/${encodeURIComponent(groupId)}/front-500`); }
  catch { return null; }
  if (!r.ok) return null;
  const blob = await r.blob();
  return /^image\//.test(blob.type) && blob.size > 500 ? blob : null;
}

/**
 * Busca la portada de un lanzamiento. Prueba con lo que dijo la IA y, si no basta, con lo que
 * traía el archivo. Devuelve {blob, id, title} o null.
 */
export async function find(queries) {
  const seen = new Set();
  for (const query of queries) {
    if (!query?.artist || /^artista desconocido$/i.test(query.artist) || !(query.album || query.title)) continue;
    const key = `${norm(query.album)}|${norm(query.artist)}|${norm(query.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const c of await candidates(query)) {
      const blob = await frontCover(c.id);
      if (blob) return { blob, id: c.id, title: c.title };
    }
  }
  return null;
}

/** Nombre de artista que no sirve para buscar («Artista desconocido», vacío…). */
export const unknownArtist = a => !norm(a) || /^(artista desconocido|unknown artist|desconocido|various artists|varios artistas|va)$/.test(norm(a));

/**
 * Portada de otro disco del mismo artista en MusicBrainz, cuando la del disco de la canción no
 * existe. Prefiere álbumes a singles. Devuelve {blob, id, title} o null.
 */
export async function artistCover(artist) {
  if (unknownArtist(artist)) return null;
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
