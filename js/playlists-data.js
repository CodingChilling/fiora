// Datos de las playlists y su sincronización con Supabase.
//
// Fuente de verdad: las tablas de Supabase (supabase/migrations/…_playlists.sql), a través de las
// funciones fiora_load_playlists / fiora_save_playlist / fiora_count_plays (con RLS).
// En el dispositivo: IndexedDB (almacén `playlists`) como copia para trabajar sin conexión, más
// una cola de cambios pendientes que se reintenta sola.
// Sin sesión, o si aún no se ha aplicado la migración, todo sigue funcionando como antes (copia
// en `fiora_datos` y en el bucket de Oracle) y no se pierde nada.
//
// Lo que es solo de este dispositivo (fotos de más de 16 MB, subidas pendientes, orden local del
// carrusel) se guarda aparte, en `plLocal`, y nunca se envía a Supabase.
import * as db from './db.js';
import * as account from './account.js';
import * as img from './images.js';
import { S, emit, on, saveKV, savePlaylist, dayKey } from './store.js';
import { MAX_FEATURED, MAX_PHOTOS } from './config.js';

// ------------------------------------------------------------ modelo
/** Módulos de la vista de una playlist: [id, nombre]. Los «bloques» se pueden reordenar. */
export const MODULES = [
  ['cover', 'Portada'], ['description', 'Descripción y frase'], ['tags', 'Etiquetas y estado de ánimo'],
  ['photos', 'Carrusel de fotos'], ['featured', 'Canciones destacadas'], ['songs', 'Canciones'],
  ['chapters', 'Capítulos'], ['stats', 'Estadísticas'], ['discover', 'Descubre más'], ['notes', 'Notas personales'],
];
export const BLOCKS = ['photos', 'featured', 'songs', 'stats', 'discover', 'notes'];
const defaultSettings = () => ({ modules: MODULES.map(([id]) => [id, true]), density: 'comfortable', header: 'gradient', stats: 'detailed', view: null });

/** Completa una playlist con los campos nuevos sin tocar lo que ya tenía (compatibilidad). */
export function normalize(p) {
  for (const k of ['name', 'description', 'emoji', 'quote', 'mood']) if (typeof p[k] !== 'string') p[k] = '';
  p.tags = Array.isArray(p.tags) ? p.tags.filter(x => typeof x === 'string').slice(0, 30) : [];
  p.trackIds = Array.isArray(p.trackIds) ? [...new Set(p.trackIds)] : [];
  p.added = p.added && typeof p.added === 'object' ? p.added : {};
  p.sections = Array.isArray(p.sections) ? p.sections : [];
  const secIds = new Set(p.sections.map(s => s.id));
  p.trackSection = Object.fromEntries(Object.entries(p.trackSection || {}).filter(([t, s]) => s && secIds.has(s) && p.trackIds.includes(t)));
  p.featured = [...new Set(p.featured || [])].filter(id => p.trackIds.includes(id)).slice(0, MAX_FEATURED);
  p.notes = p.notes && typeof p.notes === 'object' ? p.notes : {};
  p.photos = Array.isArray(p.photos) ? p.photos.slice(0, MAX_PHOTOS) : [];
  p.cover = p.cover && typeof p.cover === 'object' && p.cover.kind ? p.cover : { kind: 'auto' };
  p.colors = { mode: 'auto', auto: [], manual: [], ...(p.colors || {}) };
  const s = { ...defaultSettings(), ...(p.settings || {}) };
  const have = new Map((Array.isArray(s.modules) ? s.modules : []).filter(m => Array.isArray(m) && MODULES.some(([id]) => id === m[0])));
  s.modules = [...have.entries()];
  for (const [id] of MODULES) if (!have.has(id)) s.modules.push([id, true]);   // módulos nuevos de versiones futuras
  p.settings = s;
  p.showPhotos = p.showPhotos !== false;
  p.deleted = !!p.deleted;
  p.createdAt ||= p.updatedAt || Date.now();
  return p;
}
export const moduleOn = (p, id) => (p.settings.modules.find(m => m[0] === id) || [id, true])[1] !== false;

/** Añade canciones a una playlist (sin repetir) apuntando cuándo se añadieron. */
export function addTracks(p, ids) {
  const now = Date.now(), fresh = ids.filter(id => !p.trackIds.includes(id));
  for (const id of fresh) { p.trackIds.push(id); p.added[id] = now; }
  return fresh.length;
}
/** Quita una canción de una playlist y todo lo que dependía de ella (capítulo, destacada, nota). */
export function removeTracks(p, ids) {
  const out = new Set(ids);
  p.trackIds = p.trackIds.filter(id => !out.has(id));
  for (const id of out) { delete p.added[id]; delete p.trackSection[id]; delete p.notes[id]; }
  p.featured = p.featured.filter(id => !out.has(id));
}

// Lo que solo vive en este dispositivo: {[playlistId]: {cover: idLocal|null, photos: [idLocal], order: [ids]}}
let local = {};
export const localOf = pid => (local[pid] ||= { cover: null, photos: [], order: [] });
export const saveLocalState = () => db.put('kv', 'plLocal', local).catch(() => {});

// ------------------------------------------------------------ estado de la sincronización
const st = { mode: 'local', pending: new Set(), lastPull: 0, fullPulled: false, error: '', busy: false, uploading: 0, retryIn: 0 };
// mode: 'local' (sin sesión) · 'checking' · 'ready' · 'missing' (falta la migración) · 'offline'
export const status = () => ({ mode: st.mode, pending: st.pending.size, error: st.error, busy: st.busy, uploading: st.uploading });
const announce = () => emit('plsync', status());
const persist = () => db.put('kv', 'plsync', { pending: [...st.pending], lastPull: st.lastPull }).catch(() => {});

async function rpc(fn, args) {
  const r = await account.authFetch(`/rest/v1/rpc/${fn}`, { method: 'POST', json: args });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(data?.message || `Supabase respondió ${r.status}`);
    e.status = r.status; e.code = data?.code;
    throw e;
  }
  return data;
}
const isMissing = e => e.code === 'PGRST202' || e.code === 'PGRST205' || e.code === '42883' || e.code === '42P01';

/** Lo que se guarda en Supabase: todo menos lo que es solo de este dispositivo. */
export function toRemote(p) {
  const cover = p.cover?.kind === 'image' && p.cover.path ? p.cover : { kind: p.cover?.kind === 'collage' ? 'collage' : 'auto', crop: p.cover?.crop };
  return {
    id: p.id, name: p.name, description: p.description, emoji: p.emoji, quote: p.quote, mood: p.mood, tags: p.tags,
    featured: p.featured, colors: p.colors, cover, settings: p.settings, showPhotos: p.showPhotos, deleted: p.deleted,
    createdAt: p.createdAt, updatedAt: p.updatedAt || Date.now(), sections: p.sections, trackIds: p.trackIds,
    trackSection: p.trackSection, added: p.added, notes: p.notes,
    photos: p.photos.filter(f => f.path).map(({ id, path, thumb, size, mime, w, h, caption }) => ({ id, path, thumb, size, mime, w, h, caption: caption || '' })),
  };
}

// ------------------------------------------------------------ bajar de Supabase
async function mergeRemote(r) {
  const l = S.playlists.find(x => x.id === r.id);
  if (!l) {
    if (r.deleted) return false;
    const p = normalize(r);
    S.playlists.push(p); await db.put('playlists', p.id, p);
    return true;
  }
  if ((r.updatedAt || 0) > (l.updatedAt || 0)) {
    // gana la versión de Supabase (más reciente)
    for (const k of Object.keys(l)) if (!(k in r)) delete l[k];
    Object.assign(l, normalize(r));
    st.pending.delete(l.id);
    await db.put('playlists', l.id, l);
    return true;
  }
  if ((l.updatedAt || 0) > (r.updatedAt || 0)) st.pending.add(l.id);   // la del dispositivo es más nueva
  return false;
}

export async function pull() {
  if (!account.user()) { st.mode = 'local'; return announce(); }
  if (st.busy) return;
  st.busy = true; if (st.mode !== 'ready') st.mode = 'checking'; announce();
  try {
    // La primera vez en cada arranque se trae todo; después, solo lo cambiado (con margen de 10 min
    // por si el reloj de otro dispositivo va atrasado).
    const since = st.fullPulled ? Math.max(0, st.lastPull - 600000) : 0;
    const rows = await rpc('fiora_load_playlists', { since });
    st.mode = 'ready'; st.error = '';
    let changed = false;
    for (const r of rows || []) if (await mergeRemote(r)) changed = true;
    if (!st.fullPulled) {
      // Playlists que solo estaban en el dispositivo (las de antes de esta versión): se suben.
      const remote = new Set((rows || []).map(r => r.id));
      for (const p of S.playlists) if (!remote.has(p.id)) st.pending.add(p.id);
      st.fullPulled = true;
    }
    st.lastPull = Date.now();
    await persist();
    if (changed) emit('playlists');
  } catch (e) {
    if (isMissing(e)) { st.mode = 'missing'; st.error = 'Falta aplicar en Supabase la migración de las playlists'; }
    else if (e.network) st.mode = 'offline';
    else { st.error = e.message; console.warn('Playlists: no se pudieron traer', e); }
  } finally { st.busy = false; announce(); }
  if (st.mode === 'ready') { await push(); processUploads(); flushPlays(); }
}

// ------------------------------------------------------------ subir a Supabase
let timer = null, backoff = 2000;
export function schedulePush(ms = 1200) {
  clearTimeout(timer);
  if (!account.user()) return;
  timer = setTimeout(() => (st.mode === 'ready' ? push() : pull()), ms);
}
export async function push() {
  if (st.mode !== 'ready' || st.busy || !st.pending.size) return;
  st.busy = true; announce();
  let failed = false;
  try {
    for (const id of [...st.pending]) {
      const p = S.playlists.find(x => x.id === id);
      if (!p) { st.pending.delete(id); continue; }
      const res = await rpc('fiora_save_playlist', { p: toRemote(p) });
      if (res?.status === 'stale') { st.busy = false; st.fullPulled = false; await pull(); return; }   // otro dispositivo guardó algo más nuevo
      st.pending.delete(id);
      await persist();
      if (res?.removed?.length) img.remove(res.removed).catch(e => console.warn('No se pudieron borrar imágenes viejas', e));
    }
    st.error = ''; backoff = 2000;
  } catch (e) {
    failed = true;
    if (e.network) st.mode = 'offline';
    else if (isMissing(e)) { st.mode = 'missing'; st.error = 'Falta aplicar en Supabase la migración de las playlists'; }
    else st.error = `No se pudo guardar: ${e.message}`;
  } finally { st.busy = false; announce(); }
  if (failed && st.mode !== 'missing') { backoff = Math.min(backoff * 2, 120000); schedulePush(backoff); }
}

// ------------------------------------------------------------ imágenes pendientes de subir
/** Sube las imágenes que esperaban (sin conexión, sin sesión o subida interrumpida). */
export async function processUploads() {
  if (st.mode !== 'ready' || st.uploading) return;
  const recs = [];
  for (const [pid, l] of Object.entries(local)) for (const id of [l.cover, ...l.photos].filter(Boolean)) { const r = await img.getLocal(id); if (r?.state === 'pending') recs.push({ pid, r }); }
  for (const { pid, r } of recs) {
    try { await uploadNow(pid, r); }
    catch (e) { if (!e.network) { st.error = e.message; } console.warn('Subida pendiente', e); break; }
  }
}

/** Sube una imagen ya guardada en local (estado 'pending') y la pasa a la playlist. */
export async function uploadNow(pid, rec, signal) {
  st.uploading++; announce();
  try { await uploadInner(pid, rec, signal); } finally { st.uploading--; announce(); }
}
async function uploadInner(pid, rec, signal) {
  const p = S.playlists.find(x => x.id === pid);
  if (!p || p.deleted) { await img.dropLocal(rec.id); return; }
  const path = img.cloudPath(pid, rec.role, rec.id, rec.mime), thumb = img.cloudPath(pid, rec.role, rec.id, rec.mime, true);
  await img.upload(path, rec.blob, rec.mime, signal);
  if (rec.thumb) await img.upload(thumb, rec.thumb, 'image/jpeg', signal);
  const info = { path, thumb: rec.thumb ? thumb : null, size: rec.size, mime: rec.mime, w: rec.w, h: rec.h };
  const l = localOf(pid);
  if (rec.role === 'cover') {
    p.cover = { kind: 'image', ...info, crop: rec.crop || { x: 50, y: 50, z: 1 } };
    if (rec.colors?.length) p.colors.auto = rec.colors;
    if (l.cover === rec.id) { l.cover = null; delete l.coverColors; }
  } else {
    const photo = { id: rec.id, ...info, caption: rec.caption || '' };
    l.photos = l.photos.filter(x => x !== rec.id);
    p.photos.push(photo);
    p.photos = orderPhotos(p, l.order).filter(x => x.path);
  }
  await saveLocalState();
  await img.dropLocal(rec.id);
  await savePlaylist(p);
}
/** Fotos del carrusel (de la nube y locales) en el orden elegido en este dispositivo. */
export function orderPhotos(p, order = localOf(p.id).order) {
  const all = [...p.photos, ...localOf(p.id).photos.map(id => ({ id, local: true }))];
  const pos = new Map(order.map((id, i) => [id, i]));
  return all.map((f, i) => [f, pos.has(f.id) ? pos.get(f.id) : 1000 + i]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
}

// ------------------------------------------------------------ escuchas por playlist
// Se guarda lo mínimo: por playlist, canción y día, cuántas veces y cuántos segundos.
let plays = { queue: [], agg: {} };   // queue: pendientes de subir · agg: total en este dispositivo
const savePlays = () => db.put('kv', 'plPlays', plays).catch(() => {});
export function recordPlay(pid, trackId, secs) {
  const d = dayKey();
  plays.queue.push({ p: pid, t: trackId, d, n: 1, s: Math.round(secs || 0) });
  const a = (plays.agg[pid] ||= {}), k = `${trackId}|${d}`;
  a[k] = [(a[k]?.[0] || 0) + 1, (a[k]?.[1] || 0) + Math.round(secs || 0)];
  savePlays();
  remoteRows.delete(pid);
  setTimeout(flushPlays, 3000);
}
export async function flushPlays() {
  if (st.mode !== 'ready' || !plays.queue.length) return;
  const batch = plays.queue.slice(0, 400);
  try {
    await rpc('fiora_count_plays', { items: batch });
    plays.queue = plays.queue.slice(batch.length);
    await savePlays();
    if (plays.queue.length) flushPlays();
  } catch (e) { if (!e.network) console.warn('Escuchas pendientes', e); }
}
const remoteRows = new Map();
/** Filas {track_id, day, plays, seconds} de una playlist: de Supabase (+ lo pendiente) o de este dispositivo. */
export async function playRows(pid) {
  const pend = plays.queue.filter(x => x.p === pid).map(x => ({ track_id: x.t, day: x.d, plays: x.n, seconds: x.s }));
  if (st.mode === 'ready') {
    try {
      if (!remoteRows.has(pid)) {
        const r = await account.authFetch(`/rest/v1/fiora_playlist_plays?playlist_id=eq.${encodeURIComponent(pid)}&select=track_id,day,plays,seconds`);
        if (!r.ok) throw new Error(`Respuesta ${r.status}`);
        remoteRows.set(pid, await r.json());
      }
      return [...remoteRows.get(pid), ...pend];
    } catch (e) { console.warn('Estadísticas de la playlist', e); }
  }
  return Object.entries(plays.agg[pid] || {}).map(([k, [n, s]]) => { const [t, d] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)]; return { track_id: t, day: d, plays: n, seconds: s }; });
}

// ------------------------------------------------------------ arranque
export async function init() {
  const saved = await db.get('kv', 'plsync').catch(() => null);
  if (saved) { st.pending = new Set(saved.pending || []); st.lastPull = saved.lastPull || 0; }
  local = (await db.get('kv', 'plLocal').catch(() => null)) || {};
  plays = { queue: [], agg: {}, ...((await db.get('kv', 'plPlays').catch(() => null)) || {}) };
  for (const p of S.playlists) normalize(p);
  on('playlist-saved', p => {
    normalize(p);
    if (account.user()) { st.pending.add(p.id); persist(); schedulePush(); }
    announce();
  });
  on('played', ({ id, ctx, secs }) => {
    const p = ctx?.playlist && S.playlists.find(x => x.id === ctx.playlist);
    if (p && !p.deleted && p.trackIds.includes(id)) recordPlay(p.id, id, secs);
  });
  on('account', () => { st.fullPulled = false; if (account.user()) pull(); else { st.mode = 'local'; announce(); } });
  on('personal-cleared', async () => {
    // otra cuenta en este dispositivo: lo de la anterior no se mezcla
    st.pending.clear(); st.lastPull = 0; st.fullPulled = false; remoteRows.clear();
    for (const l of Object.values(local)) for (const id of [l.cover, ...l.photos].filter(Boolean)) await img.dropLocal(id);
    local = {}; plays = { queue: [], agg: {} };
    await Promise.all([persist(), saveLocalState(), savePlays()]);
  });
  addEventListener('online', () => { if (account.user()) pull(); });
  if (account.user()) pull(); else announce();
}
