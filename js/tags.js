// Lectura de etiquetas (ID3 / MP4 / FLAC) con jsmediatags, carátulas y duración.
// jsmediatags no lee «lo que transmite» (MOOD) ni, en FLAC, el artista del álbum o el año:
// esos campos se leen con el lector propio de tagwrite.js.
import { readFileTags, blobReader } from './tagwrite.js';
const AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|webm)$/i;
export const isAudioName = name => AUDIO_EXT.test(name);

/** Deduce artista / álbum / título de una ruta tipo "Artista/Álbum/01 - Título.mp3". */
export function fromFilename(path) {
  const parts = path.split('/').filter(Boolean);
  let base = parts.pop().replace(AUDIO_EXT, '');
  let trackNo = 0;
  const m = base.match(/^(\d{1,3})[\s._-]+(.+)$/);
  if (m) { trackNo = +m[1]; base = m[2]; }
  let artist = '', album = '', title = base.trim();
  const dash = base.split(' - ');
  if (dash.length >= 2) { artist = dash.shift().trim(); title = dash.join(' - ').trim(); }
  if (parts.length >= 2) { album = parts[parts.length - 1]; artist = artist || parts[parts.length - 2]; }
  else if (parts.length === 1) album = parts[0];
  return { title, artist, album, trackNo };
}

/**
 * Separa una lista de artistas escrita como texto: van separados por comas, salvo las comas
 * que estén entre comillas.   A, B, "Tyler, The Creator"  ->  [A, B, Tyler, The Creator]
 */
export function splitArtists(str) {
  const out = [];
  let cur = '', quoted = false;
  for (const ch of String(str || '')) {
    if (ch === '"' || ch === '“' || ch === '”') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return [...new Set(out.map(s => s.trim()).filter(Boolean))];
}

/** Separa los géneros de una etiqueta ("Indie Rock / Dream Pop; Shoegaze"). */
export function splitGenres(str) {
  return [...new Set(String(str || '').split(/[\/;,|\0]/).map(s => s.trim()).filter(s => s && !/^\(?\d+\)?$/.test(s)))];
}

/** Separa la lista de «lo que transmite» de una etiqueta MOOD ("alegre; bailable"). */
export const splitMoods = str => [...new Set(String(str || '').split(/[;,\/|\0]/).map(s => s.trim()).filter(Boolean))];

/** Lee las etiquetas de un Blob. Nunca rechaza: si falla devuelve {}. */
export async function readTags(blob) {
  const [base, own] = await Promise.all([readTagsJsm(blob), readFileTags(blobReader(blob), blob.size).catch(() => ({}))]);
  const out = { ...base };
  if (own.genre) out.genre = own.genre;               // conserva bien varios géneros (ID3v2.4 los separa con \0)
  if (own.mood) out.moods = splitMoods(own.mood);
  if (!out.albumArtist && own.albumArtist) out.albumArtist = clean(own.albumArtist);
  if (!out.year && own.year) { const y = String(own.year).match(/\d{4}/); if (y) out.year = +y[0]; }
  return out;
}
function readTagsJsm(blob) {
  return new Promise(resolve => {
    const jsm = window.jsmediatags;
    if (!jsm) return resolve({});
    const timer = setTimeout(() => resolve({}), 8000);
    const done = v => { clearTimeout(timer); resolve(v); };
    try {
      new jsm.Reader(blob).read({
        onSuccess: ({ tags }) => {
          let picture = null;
          try {
            if (tags.picture?.data?.length) {
              picture = new Blob([new Uint8Array(tags.picture.data)], { type: tags.picture.format || 'image/jpeg' });
            }
          } catch { /* carátula corrupta */ }
          const lyr = tags.lyrics;
          const year = String(tags.year || '').match(/\d{4}/);
          done({
            title: clean(tags.title), album: clean(tags.album),
            // ID3v2.4 separa varios valores con un carácter nulo; el resto de casos, con comas.
            artists: [...new Set(String(tags.artist || '').split('\0').flatMap(splitArtists))],
            albumArtist: clean(tags.TPE2?.data || tags.aART?.data || ''),
            genre: clean(tags.genre), year: year ? +year[0] : 0,
            trackNo: parseInt(tags.track, 10) || 0,
            lyrics: clean(typeof lyr === 'string' ? lyr : lyr?.lyrics),
            picture,
          });
        },
        onError: () => done({}),
      });
    } catch { done({}); }
  });
}

const clean = s => (typeof s === 'string' ? s.replace(/\0/g, '').trim() : '');

/** Reduce una carátula a un JPEG de 400 px como máximo. */
export async function shrinkCover(blob, max = 400) {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || blob), 'image/jpeg', 0.85));
  } catch { return null; }
}

/** Duración en segundos de un Blob de audio (0 si no se puede saber). */
export function probeDuration(blob) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    const done = v => { clearTimeout(timer); URL.revokeObjectURL(url); a.removeAttribute('src'); resolve(v); };
    const timer = setTimeout(() => done(0), 5000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    a.src = url;
  });
}

export function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
