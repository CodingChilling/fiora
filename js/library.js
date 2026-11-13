// Biblioteca: importar archivos del dispositivo, borrar pistas, carátulas.
import * as db from './db.js';
import { S, saveTrack, saveKV, emit, savePlaylist, albumArtistOf, artistsOf, MOODS } from './store.js';
import { readTags, fromFilename, splitArtists, splitGenres, shrinkCover, probeDuration, isAudioName, hash } from './tags.js';

export const trackId = (size, name) => `${size}:${name}`;
export const albumKey = t => `${albumArtistOf(t).toLowerCase()}|${(t.album || '').toLowerCase()}`;

// «Lo que transmite» leído del archivo, llevado al vocabulario de la app (también acepta inglés).
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const MOOD_EN = { happy: 'alegre', joyful: 'alegre', cheerful: 'alegre', sad: 'triste', melancholic: 'melancólica', melancholy: 'melancólica', energetic: 'enérgica', relaxed: 'relajada', relaxing: 'relajada', calm: 'relajada', chill: 'relajada', dark: 'oscura', romantic: 'romántica', epic: 'épica', nostalgic: 'nostálgica', aggressive: 'agresiva', angry: 'agresiva', danceable: 'bailable', dance: 'bailable', intimate: 'íntima', dreamy: 'soñadora', festive: 'festiva', party: 'festiva', uplifting: 'motivadora', motivational: 'motivadora', motivating: 'motivadora' };
export function moodsFrom(list) {
  const out = [];
  for (const m of list || []) {
    const f = fold(m), hit = MOODS.find(x => fold(x) === f) || MOOD_EN[f];
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/** Construye el registro de una pista a partir de un Blob (completo o parcial) y su ruta. */
export async function buildTrack({ id, blob, path, size }) {
  const tags = await readTags(blob);
  const guess = fromFilename(path);
  let artists = tags.artists?.length ? tags.artists : splitArtists(guess.artist);
  if (!artists.length) artists = ['Artista desconocido'];
  const t = {
    id, size,
    title: tags.title || guess.title,
    artists, artist: artists.join(', '), albumArtist: tags.albumArtist || '',
    album: tags.album || guess.album || '',
    genres: splitGenres(tags.genre), genre: splitGenres(tags.genre)[0] || '', moods: moodsFrom(tags.moods), year: tags.year || 0,
    trackNo: tags.trackNo || guess.trackNo || 0,
    lyrics: tags.lyrics || '',
    duration: 0, addedAt: Date.now(),
    hasBlob: false, cloudName: '',
    fileName: path.split('/').pop(),
  };
  if (tags.picture) {
    const cid = t.album ? 'a' + hash(albumKey(t)) : 't' + hash(id);
    if (!(await db.get('covers', cid))) {
      const small = await shrinkCover(tags.picture);
      if (small) await db.put('covers', cid, small);
      else return t;
    }
    t.coverId = cid;
  }
  return t;
}

/** Importa archivos locales a la biblioteca (se copian a IndexedDB para funcionar sin conexión). */
export async function importFiles(fileList, onProgress = () => {}) {
  const files = [...fileList].filter(f => f.type.startsWith('audio/') || isAudioName(f.name));
  let added = 0, skipped = 0, failed = 0;
  if (files.length) navigator.storage?.persist?.().catch(() => {});
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(i + 1, files.length, f.name);
    const id = trackId(f.size, f.name);
    const old = S.tracks.get(id);
    try {
      if (old?.hasBlob) { skipped++; continue; }
      await db.put('blobs', id, f);
      if (old) {            // ya estaba en la nube: ahora además queda descargada
        old.hasBlob = true;
        if (!old.duration) old.duration = await probeDuration(f);
        await saveTrack(old);
      } else {
        const t = await buildTrack({ id, blob: f, path: f.webkitRelativePath || f.name, size: f.size });
        t.hasBlob = true;
        t.duration = await probeDuration(f);
        await saveTrack(t);
      }
      added++;
    } catch (e) {
      console.error('No se pudo importar', f.name, e);
      failed++;
      if (e?.name === 'QuotaExceededError') break;
    }
  }
  emit('library');
  return { added, skipped, failed, total: files.length };
}

/** Elimina la pista de la biblioteca (y de las playlists). */
export async function removeTrack(id) {
  S.tracks.delete(id);
  await Promise.all([db.del('tracks', id), db.del('blobs', id)]);
  for (const p of S.playlists) {
    if (p.trackIds.includes(id)) { p.trackIds = p.trackIds.filter(x => x !== id); await savePlaylist(p); }
  }
  emit('library');
}

/** Cambia el archivo de una pista (p. ej. WAV → FLAC): nuevo id, y playlists, favoritos y estadísticas la siguen. */
export async function rekey(t, newId, { blob, fileName, size }) {
  const old = t.id;
  if (blob) await db.put('blobs', newId, blob);   // sin blob: la pista solo queda en la nube
  await Promise.all([db.del('blobs', old), db.del('tracks', old)]);
  S.tracks.delete(old);
  Object.assign(t, { id: newId, fileName, size });
  await saveTrack(t);
  for (const p of S.playlists) {
    if (p.trackIds.includes(old)) { p.trackIds = p.trackIds.map(x => (x === old ? newId : x)); await savePlaylist(p); }
  }
  if (S.favs[old]) { S.favs[newId] = { on: S.favs[old].on, at: Date.now() }; S.favs[old] = { on: false, at: Date.now() }; saveKV('favs'); }
  if (S.stats[old]) { S.stats[newId] = S.stats[old]; delete S.stats[old]; saveKV('stats'); }
  if (S.edits[old]) { S.edits[newId] = { ...S.edits[old] }; delete S.edits[old]; t.editAt = S.edits[newId].at; saveKV('edits'); await db.put('tracks', newId, t); }
}

/** Borra solo la copia sin conexión de una pista que sigue en la nube. */
export async function dropBlob(id) {
  const t = S.tracks.get(id);
  if (!t?.cloudName && !t?.url) return;
  await db.del('blobs', id);
  t.hasBlob = false;
  await saveTrack(t);
  emit('library');
}

// --- Canciones repetidas ----------------------------------------------------
// Dos pistas son la misma canción si tienen el mismo título y los mismos artistas
// (sin importar mayúsculas, tildes, signos ni el orden de los artistas).
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function dupKey(t) {
  const artists = artistsOf(t).map(norm).filter(a => a && a !== 'artista desconocido');
  const title = norm(t.title);
  return artists.length && title ? `${[...new Set(artists)].sort().join(' & ')} — ${title}` : '';
}

/** Orden de preferencia: primero la que tiene portada; si empatan, la más reciente. */
const keepScore = t => [t.coverId || t.coverUrl ? 1 : 0, t.addedAt || 0];
export function rankCopies(list) {
  return [...list].sort((a, b) => { const x = keepScore(a), y = keepScore(b); return y[0] - x[0] || y[1] - x[1]; });
}

/**
 * Grupos de canciones repetidas: [{key, tracks}] con la copia que se conserva en primer lugar.
 * `keep` permite fijar a mano qué copia se conserva en un grupo ({key: id}).
 */
export function findDuplicates(keep = {}) {
  const ignore = new Set(S.settings.dupIgnore || []);
  const groups = new Map();
  for (const t of S.tracks.values()) {
    const k = dupKey(t);
    if (!k || ignore.has(k)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const out = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const tracks = rankCopies(list);
    const fixed = tracks.findIndex(t => t.id === keep[key]);
    if (fixed > 0) tracks.unshift(...tracks.splice(fixed, 1));
    out.push({ key, tracks });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Pasa a `keep` lo que tenía la copia que se va a borrar: playlists, me gusta y escuchas. */
export async function mergeInto(dup, keep) {
  for (const p of S.playlists) {
    if (!p.trackIds.includes(dup.id)) continue;
    p.trackIds = [...new Set(p.trackIds.map(x => (x === dup.id ? keep.id : x)))];
    await savePlaylist(p);
  }
  if (S.favs[dup.id]?.on && !S.favs[keep.id]?.on) { S.favs[keep.id] = { on: true, at: Date.now() }; saveKV('favs'); }
  const a = S.stats[dup.id];
  if (a) {
    const b = S.stats[keep.id] || (S.stats[keep.id] = { plays: 0, last: 0 });
    for (const f of ['plays', 'skips', 'done']) if (a[f]) b[f] = (b[f] || 0) + a[f];
    b.last = Math.max(b.last || 0, a.last || 0);
    if (a.h) b.h = (b.h || [0, 0, 0, 0]).map((n, i) => n + (a.h[i] || 0));
    saveKV('stats');
  }
  if (!keep.coverId && dup.coverId) { keep.coverId = dup.coverId; await saveTrack(keep); }
}

// --- Carátulas -------------------------------------------------------------
let remoteCover = null;
export const setRemoteCover = fn => { remoteCover = fn; };
const coverUrls = new Map();   // coverId -> objectURL | null
export async function coverUrl(track) {
  if (!track) return null;
  if (track.coverUrl) return track.coverUrl;
  const cid = track.coverId;
  if (!cid) return null;
  if (!coverUrls.has(cid)) {
    // Las portadas puestas a mano ("u…") que no estén en este dispositivo se piden a la nube.
    coverUrls.set(cid, db.get('covers', cid).then(b => (b ? URL.createObjectURL(b) : (cid[0] === 'u' && remoteCover ? remoteCover(cid) : null))).catch(() => null));
  }
  return coverUrls.get(cid);
}

export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return {}; }
}
