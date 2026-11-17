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
