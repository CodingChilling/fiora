// Nube: uno o varios buckets de Oracle Cloud Object Storage, cada uno mediante una
// "Pre-Authenticated Request" (PAR) de bucket: una URL secreta que permite listar, leer y
// escribir objetos sin firmar peticiones.
//   GET  {par}            -> lista de objetos (JSON)
//   GET  {par}{nombre}    -> descarga (admite Range)
//   PUT  {par}{nombre}    -> subida
// Las PAR no permiten borrar: para eso se usa la API de Oracle con una clave de API (oci.js).
import * as db from './db.js';
import { S, saveTrack, saveKV, emit, on, albumArtistOf, fileSig, tagFields } from './store.js';
import { buildTrack, trackId, rekey, setRemoteCover } from './library.js';
import { isAudioName } from './tags.js';
import { snapshot, merge } from './sync.js';
import { wavToFlac } from './flac.js';
import * as oci from './oci.js';
import { writeTags, canWrite } from './tagwrite.js';

const DATA_OBJECT = '_fiora/datos.json';
const HEAD_BYTES = 768 * 1024;   // suficiente para las etiquetas y la carátula en casi todos los archivos

/** Buckets conectados: [{id, name, url}]. El primero guarda además la copia de playlists y favoritos. */
export const buckets = () => S.settings.buckets || [];
export const configured = () => buckets().length > 0;
const bucket = id => buckets().find(b => b.id === id) || buckets()[0];
/** Bucket al que se sube por defecto. */
export const uploadTarget = () => bucket(S.settings.uploadBucket);

/** Convierte la configuración antigua (un solo bucket) a la lista de buckets. */
export function migrate() {
  const s = S.settings;
  if (s.parUrl && !buckets().length) { s.buckets = [{ id: 'b1', name: 'Principal', url: s.parUrl }]; s.bucketsAt = s.parAt || 1; }
  delete s.parUrl; delete s.parAt;
}

/** Normaliza lo que pegue el usuario para que termine en ".../o/". */
export function normalizePar(url) {
  url = (url || '').trim();
  if (!url) return '';
  const u = new URL(url);   // lanza si no es una URL
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') throw new Error('La URL debe empezar por https://');
  const m = u.pathname.match(/^(.*\/o)(\/.*)?$/);
  if (!m || !u.pathname.includes('/p/')) throw new Error('No parece una URL de Pre-Authenticated Request de bucket (debe contener /p/…/o/)');
  return `${u.origin}${m[1]}/`;
}

const encodeName = name => name.split('/').map(encodeURIComponent).join('/');
export const objectUrl = (name, bucketId) => bucket(bucketId).url + encodeName(name);

async function listObjects(b) {
  const out = [];
  let start = '';
  do {
    const r = await fetch(`${b.url}?fields=name,size&limit=1000${start ? `&start=${encodeURIComponent(start)}` : ''}`);
    if (!r.ok) throw new Error(`«${b.name}» respondió ${r.status} al listar. Revisa que la PAR tenga activado el listado de objetos y no haya caducado.`);
    const j = await r.json();
    out.push(...(j.objects || []));
    start = j.nextStartWith || '';
  } while (start);
  return out;
}

/** Comprueba que una URL de bucket funciona. */
export async function test(url) {
  const r = await fetch(`${url}?limit=1`);
  if (!r.ok) throw new Error(`Respuesta ${r.status}`);
  await r.json();
}

/** Conecta un bucket nuevo (tras comprobarlo). */
export async function addBucket(name, rawUrl) {
  const url = normalizePar(rawUrl);
  if (buckets().some(b => b.url === url)) throw new Error('Ese bucket ya está conectado');
  await test(url);
  const b = { id: 'b' + Date.now().toString(36), name: name.trim() || `Bucket ${buckets().length + 1}`, url };
  S.settings.buckets = [...buckets(), b];
  await touchBuckets();
  return b;
}

/** Desconecta un bucket. No borra nada en Oracle. */
export async function removeBucket(id) {
  const wasFirst = buckets()[0]?.id === id;
  S.settings.buckets = buckets().filter(b => b.id !== id);
  if (S.settings.uploadBucket === id) delete S.settings.uploadBucket;
  await touchBuckets();
  // Solo se tocan las pistas de ese bucket: las descargadas se quedan en el dispositivo.
  for (const t of [...S.tracks.values()]) {
    if (!t.cloudName || !(t.bucketId === id || (!t.bucketId && wasFirst))) continue;
    if (t.hasBlob || t.url) { t.cloudName = ''; delete t.bucketId; await saveTrack(t); }
    else { S.tracks.delete(t.id); await db.del('tracks', t.id); }
  }
  emit('library');
}

export async function setUploadTarget(id) {
  S.settings.uploadBucket = id;
  await touchBuckets();
}

async function touchBuckets() {
  S.settings.bucketsAt = Date.now();
  await saveKV('settings', false);
  emit('dirty');
}

/** Quita (o deja solo en local) las pistas cuyo archivo ya no está en ningún bucket consultado. */
async function dropMissing(found, failed) {
  let removed = 0;
  const known = new Set(buckets().map(b => b.id));
  for (const t of [...S.tracks.values()]) {
    if (!t.cloudName) continue;
    const bid = t.bucketId && known.has(t.bucketId) ? t.bucketId : (t.bucketId ? null : buckets()[0]?.id);
    if (bid && (failed.has(bid) || found.get(t.id) === bid)) continue;
    if (t.hasBlob || t.url) { t.cloudName = ''; delete t.bucketId; await saveTrack(t); }
    else { S.tracks.delete(t.id); await db.del('tracks', t.id); removed++; }
  }
  if (removed) emit('library');
  return removed;
}

/** Trae a la biblioteca las canciones nuevas de todos los buckets y quita las que ya no existen. */
export async function syncLibrary(onProgress = () => {}) {
  const found = new Map();      // id de pista -> id del bucket donde está
  const failed = new Set();     // buckets que no se pudieron consultar: sus pistas no se tocan
  const errors = [];
  let added = 0, updated = 0;
  const redownload = [];
  // Pistas por objeto de la nube: si un archivo cambia de tamaño (p. ej. se le escribieron
  // metadatos desde otro dispositivo), sigue siendo la misma canción.
  const byName = new Map();
  for (const t of S.tracks.values()) if (t.cloudName) byName.set(`${t.bucketId || buckets()[0]?.id}|${t.cloudName}`, t);

  for (const b of buckets()) {
    let objects;
    try { objects = (await listObjects(b)).filter(o => o.size > 0 && isAudioName(o.name)); }   // los vacíos son canciones borradas
    catch (e) { failed.add(b.id); errors.push(e.message); continue; }
    let n = 0;
    for (const o of objects) {
      n++;
      const id = trackId(o.size, o.name.split('/').pop());
      if (found.has(id)) continue;          // el mismo archivo en dos buckets: vale el primero
      found.set(id, b.id);
      const old = S.tracks.get(id);
      if (old) {
        if (old.cloudName !== o.name || old.bucketId !== b.id) { old.cloudName = o.name; old.bucketId = b.id; await saveTrack(old); }
        continue;
      }
      onProgress(n, objects.length, o.name);
      let blob = new Blob();
      try {
        const r = await fetch(objectUrl(o.name, b.id), { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
        if (r.ok) blob = await r.blob();
      } catch { /* sin etiquetas: se usa el nombre del archivo */ }
      const prev = byName.get(`${b.id}|${o.name}`);
      if (prev && prev.id !== id) {
        // Archivo actualizado: la canción cambia de id (y la siguen playlists, me gusta y escuchas),
        // toma las etiquetas nuevas y, si estaba descargada, se vuelve a descargar.
        const fresh = await buildTrack({ id, blob, path: o.name, size: o.size });
        const had = prev.hasBlob;
        await rekey(prev, id, { blob: null, fileName: prev.fileName, size: o.size });
        for (const k of ['title', 'artists', 'artist', 'albumArtist', 'album', 'genres', 'genre', 'year', 'trackNo']) prev[k] = fresh[k];
        if (fresh.lyrics) prev.lyrics = fresh.lyrics;
        prev.coverId = fresh.coverId || prev.coverId;
        Object.assign(prev, { hasBlob: false, cloudName: o.name, bucketId: b.id, editAt: 0 });
        await saveTrack(prev);    // vuelve a aplicar las ediciones de la app por encima
        if (had) redownload.push(prev);
        updated++;
        continue;
      }
      const t = await buildTrack({ id, blob, path: o.name, size: o.size });
      t.cloudName = o.name; t.bucketId = b.id;
      await saveTrack(t);
      added++;
    }
  }
  for (const t of redownload) { onProgress(0, 0, `Descargando de nuevo ${t.fileName}`); await download(t).catch(e => console.warn('No se pudo volver a descargar', e)); }
  const removed = await dropMissing(found, failed);
  if (added || removed || updated) emit('library');
  return { added, removed, updated, total: found.size, errors };
}

/**
 * Sube a la nube una pista que solo está en este dispositivo.
 * Con la opción "reducir tamaño" activada, los WAV se convierten antes a FLAC (sin pérdida).
 * Devuelve los bytes ahorrados.
 */
export async function upload(t, bucketId, onStage = () => {}) {
  const b = bucket(bucketId || S.settings.uploadBucket);
  if (!b) throw new Error('No hay ningún bucket conectado');
  let blob = await db.get('blobs', t.id);
  if (!blob) throw new Error('No hay copia local que subir');
  let saved = 0;

  if (S.settings.shrink && /\.wav$/i.test(t.fileName)) {
    try {
      onStage('Comprimiendo sin pérdida');
      const flac = await wavToFlac(blob, t);
      const fileName = t.fileName.replace(/\.wav$/i, '.flac');
      const id = trackId(flac?.size, fileName);
      if (flac && flac.size < blob.size && !S.tracks.has(id)) {
        saved = blob.size - flac.size;
        await rekey(t, id, { blob: flac, fileName, size: flac.size });
        blob = flac;
      }
    } catch (e) { console.warn('No se pudo comprimir; se sube el original', e); }
  }

  // Las pistas de catálogos externos pasan a identificarse como cualquier archivo de la nube
  // (tamaño + nombre), para que otros dispositivos las reconozcan como la misma canción.
  const cloudId = trackId(blob.size, t.fileName);
  if (t.id !== cloudId && !S.tracks.has(cloudId)) await rekey(t, cloudId, { blob, fileName: t.fileName, size: blob.size });

  onStage('Subiendo');
  const safe = s => (s || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  const name = [safe(albumArtistOf(t)) || 'Varios', safe(t.album) || 'Sueltas', t.fileName].join('/');
  const r = await fetch(objectUrl(name, b.id), { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } });
  if (!r.ok) throw new Error(`«${b.name}» respondió ${r.status} al subir. ¿La PAR permite escritura?`);
  t.cloudName = name; t.bucketId = b.id;
  await saveTrack(t);
  emit('library');
  return saved;
}

/**
 * Borra de su bucket el archivo de una pista. Las PAR no permiten borrar (limitación de Oracle):
 * con una clave de API de Oracle configurada se borra de verdad ('deleted'); si no, el archivo se
 * sobrescribe vacío (0 bytes), lo que libera el espacio y Fiora deja de mostrarlo ('emptied').
 */
export async function deleteRemote(t) {
  if (!t.cloudName) return null;
  const b = t.bucketId ? buckets().find(x => x.id === t.bucketId) : buckets()[0];
  if (!b) throw new Error('El bucket de esta canción no está conectado');
  if (oci.configured()) { await oci.deleteObject(b.url, t.cloudName); return 'deleted'; }
  const w = await fetch(objectUrl(t.cloudName, b.id), { method: 'PUT', body: new Blob([]), headers: { 'Content-Type': 'application/octet-stream' } });
  if (w.ok) return 'emptied';
  throw new Error(`«${b.name}» respondió ${w.status} al borrar. ¿La PAR permite escritura?`);
}

/** Comprueba la clave de API de Oracle con el primer bucket. */
export const checkOci = () => oci.check(buckets()[0].url);

/** Borra del todo los archivos de audio vacíos (canciones borradas sin clave de API). */
export async function purgeEmpty(onProgress = () => {}) {
  let deleted = 0;
  for (const b of buckets()) {
    const empty = (await listObjects(b)).filter(o => !o.size && isAudioName(o.name));
    for (const o of empty) { onProgress(deleted + 1, o.name); await oci.deleteObject(b.url, o.name); deleted++; }
  }
  return deleted;
}

/** Se puede escribir en el archivo de esta canción (formato compatible y archivo accesible). */
export const canWriteFile = t => canWrite(t.fileName) && !!(t.hasBlob || (t.cloudName && configured() && (!t.bucketId || buckets().some(b => b.id === t.bucketId))));

/**
 * Escribe los metadatos editados dentro del archivo de la canción y, si está en la nube, lo sube
 * en lugar del anterior. Como cambia el tamaño, cambia el id: playlists, me gusta, escuchas y
 * ediciones pasan al nuevo. Los demás dispositivos lo reconocen al sincronizar.
 */
export async function writeFile(t, onStage = () => {}) {
  const e = S.edits[t.id];
  if (!e) return false;
  const f = tagFields(e);
  onStage(t.hasBlob ? 'Preparando' : 'Descargando');
  const blob = await fetchBlob(t);
  let cover = null;
  if (f.coverId) {
    cover = await db.get('covers', f.coverId);
    if (!cover && f.coverId[0] === 'u' && configured()) {
      const r = await fetch(objectUrl(coverName(f.coverId), buckets()[0].id)).catch(() => null);
      if (r?.ok) cover = await r.blob();
    }
  }
  onStage('Escribiendo las etiquetas');
  const out = await writeTags(blob, t.fileName, f, cover);
  if (!out) throw new Error('Este formato no permite escribir etiquetas');
  if (t.cloudName) {
    onStage('Subiendo');
    const b = t.bucketId ? buckets().find(x => x.id === t.bucketId) : buckets()[0];
    const r = await fetch(objectUrl(t.cloudName, b.id), { method: 'PUT', body: out, headers: { 'Content-Type': out.type || 'application/octet-stream' } });
    if (!r.ok) throw new Error(`«${b.name}» respondió ${r.status} al subir`);
  }
  const keep = !!t.hasBlob;
  const newId = trackId(out.size, t.fileName);
  if (newId !== t.id && !S.tracks.has(newId)) await rekey(t, newId, { blob: keep ? out : null, fileName: t.fileName, size: out.size });
  else if (keep) await db.put('blobs', t.id, out);
  t.hasBlob = keep;
  S.edits[t.id].fileSig = fileSig(S.edits[t.id]);
  await saveKV('edits');
  await saveTrack(t);
  emit('library');
  return true;
}

/** Archivo con los metadatos editados ya escritos (para guardarlo en el dispositivo). */
export async function taggedBlob(t, blob) {
  const e = S.edits[t.id];
  if (!e || !canWrite(t.fileName) || fileSig(e) === '[]') return blob;
  const f = tagFields(e);
  const cover = f.coverId ? await db.get('covers', f.coverId).catch(() => null) : null;
  try { return (await writeTags(blob, t.fileName, f, cover)) || blob; } catch { return blob; }
}

// Portadas elegidas a mano: se guardan en el primer bucket para que las vean los demás dispositivos.
const coverName = cid => `_fiora/portadas/${cid}.jpg`;
setRemoteCover(cid => (configured() ? objectUrl(coverName(cid), buckets()[0].id) : null));
export async function uploadCover(cid, blob) {
  if (!configured()) return false;
  const r = await fetch(objectUrl(coverName(cid), buckets()[0].id), { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
  return r.ok;
}

/** Devuelve el archivo de audio de una pista: la copia del dispositivo o, si no hay, lo descarga. */
export async function fetchBlob(t) {
  if (t.hasBlob) { const b = await db.get('blobs', t.id); if (b) return b; }
  if (t.noDownload) throw new Error('El artista no permite descargar esta canción');
  const src = t.cloudName && configured() ? objectUrl(t.cloudName, t.bucketId) : (t.dl || t.url);
  if (!src) throw new Error('Esta canción no está disponible');
  const r = await fetch(src);
  if (!r.ok) throw new Error(`Respuesta ${r.status} al descargar`);
  return r.blob();
}

/** Descarga una pista de la nube (o de una URL) para escucharla sin conexión. */
export async function download(t) {
  const r = await fetch(t.cloudName ? objectUrl(t.cloudName, t.bucketId) : (t.dl || t.url));
  if (!r.ok) throw new Error(`Respuesta ${r.status} al descargar`);
  const blob = await r.blob();
  navigator.storage?.persist?.().catch(() => {});
  await db.put('blobs', t.id, blob);
  t.hasBlob = true;
  if (!t.size) t.size = blob.size;
  await saveTrack(t);
  emit('library');
}

// --- Copia de playlists, favoritos y estadísticas en el primer bucket -------
export async function syncData() {
  const first = buckets()[0];
  if (!first) return;
  const r = await fetch(objectUrl(DATA_OBJECT, first.id), { cache: 'no-store' });
  if (r.ok) await merge(await r.json());
  else if (r.status !== 404) throw new Error(`Respuesta ${r.status} al leer los datos`);
  const w = await fetch(objectUrl(DATA_OBJECT, first.id), { method: 'PUT', body: JSON.stringify(snapshot()), headers: { 'Content-Type': 'application/json' } });
  if (!w.ok) throw new Error(`Respuesta ${w.status} al guardar los datos`);
  S.settings.lastSync = Date.now();
  saveKV('settings', false);
}

export async function syncAll(onProgress) {
  const res = await syncLibrary(onProgress);
  await syncData();
  return res;
}

// Subida automática (con retardo) cuando cambian playlists, favoritos o estadísticas.
let timer = null;
on('dirty', () => {
  if (!configured() || !navigator.onLine) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncData().catch(e => console.warn('Sincronización pendiente', e)), 8000);
});
