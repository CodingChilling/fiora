// Biblioteca: importar archivos del dispositivo, borrar pistas, carátulas.
import * as db from './db.js';
import { S, saveTrack, saveKV, emit, savePlaylist, albumArtistOf } from './store.js';
import { readTags, fromFilename, splitArtists, splitGenres, shrinkCover, probeDuration, isAudioName, hash } from './tags.js';

export const trackId = (size, name) => `${size}:${name}`;
export const albumKey = t => `${albumArtistOf(t).toLowerCase()}|${(t.album || '').toLowerCase()}`;

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
    genres: splitGenres(tags.genre), genre: splitGenres(tags.genre)[0] || '', moods: [], year: tags.year || 0,
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
  await db.put('blobs', newId, blob);
  await Promise.all([db.del('blobs', old), db.del('tracks', old)]);
  S.tracks.delete(old);
  Object.assign(t, { id: newId, fileName, size });
  await saveTrack(t);
  for (const p of S.playlists) {
    if (p.trackIds.includes(old)) { p.trackIds = p.trackIds.map(x => (x === old ? newId : x)); await savePlaylist(p); }
  }
  if (S.favs[old]) { S.favs[newId] = { on: S.favs[old].on, at: Date.now() }; S.favs[old] = { on: false, at: Date.now() }; saveKV('favs'); }
  if (S.stats[old]) { S.stats[newId] = S.stats[old]; delete S.stats[old]; saveKV('stats'); }
  if (S.edits[old]) { S.edits[newId] = { ...S.edits[old], at: Date.now() }; delete S.edits[old]; t.editAt = S.edits[newId].at; saveKV('edits'); await db.put('tracks', newId, t); }
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
