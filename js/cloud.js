// Nube: Oracle Cloud Object Storage mediante una "Pre-Authenticated Request" (PAR) de bucket.
// La PAR es una URL secreta que permite listar, leer y escribir objetos sin firmar peticiones.
//   GET  {par}            -> lista de objetos (JSON)
//   GET  {par}{nombre}    -> descarga (admite Range)
//   PUT  {par}{nombre}    -> subida
import * as db from './db.js';
import { S, saveTrack, saveKV, emit, on } from './store.js';
import { buildTrack, trackId } from './library.js';
import { isAudioName } from './tags.js';
import { snapshot, merge } from './sync.js';

const DATA_OBJECT = '_fiora/datos.json';
const HEAD_BYTES = 768 * 1024;   // suficiente para las etiquetas y la carátula en casi todos los archivos

export const configured = () => !!S.settings.parUrl;

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
export const objectUrl = name => S.settings.parUrl + encodeName(name);

async function listObjects() {
  const out = [];
  let start = '';
  do {
    const r = await fetch(`${S.settings.parUrl}?fields=name,size&limit=1000${start ? `&start=${encodeURIComponent(start)}` : ''}`);
    if (!r.ok) throw new Error(`La nube respondió ${r.status} al listar. Revisa que la PAR tenga activado el listado de objetos y no haya caducado.`);
    const j = await r.json();
    out.push(...(j.objects || []));
    start = j.nextStartWith || '';
  } while (start);
  return out;
}

/** Comprueba que la URL funciona. */
export async function test() {
  const r = await fetch(`${S.settings.parUrl}?limit=1`);
  if (!r.ok) throw new Error(`Respuesta ${r.status}`);
  await r.json();
}

/** Trae a la biblioteca las canciones nuevas del bucket y quita las que ya no existen. */
export async function syncLibrary(onProgress = () => {}) {
  const objects = (await listObjects()).filter(o => isAudioName(o.name));
  const byId = new Map(objects.map(o => [trackId(o.size, o.name.split('/').pop()), o]));
  let added = 0, removed = 0, n = 0;

  for (const [id, o] of byId) {
    n++;
    const old = S.tracks.get(id);
    if (old) {
      if (old.cloudName !== o.name) { old.cloudName = o.name; await saveTrack(old); }
      continue;
    }
    onProgress(n, byId.size, o.name);
    let blob = new Blob();
    try {
      const r = await fetch(objectUrl(o.name), { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
      if (r.ok) blob = await r.blob();
    } catch { /* sin etiquetas: se usa el nombre del archivo */ }
    const t = await buildTrack({ id, blob, path: o.name, size: o.size });
    t.cloudName = o.name;
    await saveTrack(t);
    added++;
  }

  for (const t of [...S.tracks.values()]) {
    if (!t.cloudName || byId.has(t.id)) continue;
    if (t.hasBlob) { t.cloudName = ''; await saveTrack(t); }
    else { S.tracks.delete(t.id); await db.del('tracks', t.id); removed++; }
  }
  if (added || removed) emit('library');
  return { added, removed, total: byId.size };
}

/** Sube a la nube una pista que solo está en este dispositivo. */
export async function upload(t) {
  const blob = await db.get('blobs', t.id);
  if (!blob) throw new Error('No hay copia local que subir');
  const safe = s => (s || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  const name = [safe(t.artist) || 'Varios', safe(t.album) || 'Sueltas', t.fileName].join('/');
  const r = await fetch(objectUrl(name), { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } });
  if (!r.ok) throw new Error(`La nube respondió ${r.status} al subir. ¿La PAR permite escritura?`);
  t.cloudName = name;
  await saveTrack(t);
  emit('library');
}

/** Descarga una pista de la nube (o de una URL) para escucharla sin conexión. */
export async function download(t) {
  const r = await fetch(t.cloudName ? objectUrl(t.cloudName) : t.url);
  if (!r.ok) throw new Error(`Respuesta ${r.status} al descargar`);
  const blob = await r.blob();
  navigator.storage?.persist?.().catch(() => {});
  await db.put('blobs', t.id, blob);
  t.hasBlob = true;
  if (!t.size) t.size = blob.size;
  await saveTrack(t);
  emit('library');
}

// --- Playlists, favoritos y estadísticas entre dispositivos ----------------
/** Descarga los datos de la nube, los fusiona con los locales y sube el resultado. */
export async function syncData() {
  const r = await fetch(objectUrl(DATA_OBJECT), { cache: 'no-store' });
  if (r.ok) {
    await merge(await r.json());
  } else if (r.status !== 404) throw new Error(`Respuesta ${r.status} al leer los datos`);
  const body = JSON.stringify(snapshot());
  const w = await fetch(objectUrl(DATA_OBJECT), { method: 'PUT', body, headers: { 'Content-Type': 'application/json' } });
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
