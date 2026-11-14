// Datos de las playlists y su sincronización con Supabase.
//
// Fuente de verdad: las tablas de Supabase (supabase/migrations/…_playlists.sql), a través de las
// funciones fiora_load_playlists / fiora_save_playlist / fiora_count_plays (con RLS).
// En el dispositivo: IndexedDB (almacén `playlists`) como copia para trabajar sin conexión, más
// una cola de cambios pendientes que se reintenta sola.
// Sin sesión, o si aún no se ha aplicado la migración, todo sigue funcionando como antes (copia
// en `fiora_datos`, la fila de la cuenta) y no se pierde nada. Nunca se guardan en el bucket.
//
// Lo que es solo de este dispositivo (fotos de más de 16 MB, subidas pendientes, orden local del
// carrusel) se guarda aparte, en `plLocal`, y nunca se envía a Supabase.
//
// Playlists compartidas contigo (de otras personas del grupo de un bucket, ver groups.js): viven
// también en S.playlists, con id `sh~{dueño}~{id}` y `shared = {owner, pid, ownerName, role, group}`.
// Nunca se guardan en tu cuenta como tuyas; si puedes editarlas, tus cambios de canciones y
// capítulos van a la playlist de su dueño (fiora_save_shared_playlist). `base` es la última
// versión común de canciones y capítulos, para fusionar cambios hechos a la vez (merge.js).
import * as db from './db.js';
import * as account from './account.js';
import * as img from './images.js';
import { S, emit, on, saveKV, savePlaylist, dayKey } from './store.js';
import { MAX_FEATURED, MAX_PHOTOS } from './config.js';
import { mergeLists, listsOf } from './merge.js';

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

// ------------------------------------------------------------ «Canciones que te gustan»
// Es una playlist más (mismo diseño, se sincroniza como las demás), pero sus canciones las decide el
// corazón: las que tienen «me gusta». Por defecto van de la más reciente a la más antigua; si se
// reordena a mano, ese orden se respeta (las nuevas entran arriba y las que dejan de gustar salen).
export const FAVS = 'favoritos';
export const isFavs = p => p?.id === FAVS;
/** Pone al día la lista con los corazones. Devuelve true si ha cambiado (sin guardar). */
export function reconcileFavs() {
  let p = S.playlists.find(x => x.id === FAVS), created = false;
  if (!p) {
    // `autoOnly`: creada aquí y sin cambios del usuario en este dispositivo. Si en la cuenta ya existe,
    // gana la de la cuenta (con su orden y su personalización). Solo vive en este dispositivo.
    p = normalize({ id: FAVS, name: 'Canciones que te gustan', emoji: '', trackIds: [], createdAt: Date.now(), autoOnly: true });
    S.playlists.push(p); created = true;
  }
  if (p.deleted) { p.deleted = false; created = true; }   // no se puede eliminar
  const liked = Object.entries(S.favs).filter(([, f]) => f?.on).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).map(([id]) => id);
  const likedSet = new Set(liked);
  // Canciones de la lista cuyo «me gusta» aún no ha llegado a este dispositivo: se dejan donde están.
  const unknown = id => S.favs[id] === undefined;
  let next;
  if (p.settings.favOrder === 'manual') {
    const kept = p.trackIds.filter(id => likedSet.has(id) || unknown(id));
    next = [...liked.filter(id => !p.trackIds.includes(id)), ...kept];
  } else next = [...liked, ...p.trackIds.filter(id => unknown(id) && !likedSet.has(id))];
  const added = {};
  for (const id of next) added[id] = S.favs[id]?.at || p.added[id] || Date.now();
  const changed = created || next.join('\n') !== p.trackIds.join('\n') || next.some(id => added[id] !== p.added[id]);
  if (changed) { p.trackIds = next; p.added = added; normalize(p); }
  return changed;
}
let savingFavs = false;
export async function syncFavs() {
  if (!reconcileFavs()) return;
  savingFavs = true;
  try { await savePlaylist(S.playlists.find(x => x.id === FAVS)); } finally { savingFavs = false; }
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
    p.base = listsOf(r); p.baseAt = r.updatedAt || 0;
    S.playlists.push(p); await db.put('playlists', p.id, p);
    return true;
  }
  // ¿Ha cambiado allí desde la última versión que conoce este dispositivo?
  const news = l.baseAt ? (r.updatedAt || 0) > l.baseAt : (r.updatedAt || 0) > (l.updatedAt || 0);
  if (news || (l.autoOnly && !r.deleted)) {
    if (st.pending.has(l.id) && l.base && !r.deleted && !l.deleted && !l.autoOnly) {
      // cambios aquí sin subir y allí (otro dispositivo o quien colabora): se fusionan canciones y
      // capítulos; lo demás (aspecto, textos) solo lo cambia su dueño y se queda lo de aquí
      Object.assign(l, mergeLists(l.base, listsOf(l), listsOf(r)));
      normalize(l);
      l.updatedAt = Math.max(Date.now(), (r.updatedAt || 0) + 1, (l.updatedAt || 0) + 1);
    } else {
      // gana la versión de Supabase (más reciente, o la de la cuenta frente a una copia creada aquí sin tocar)
      for (const k of Object.keys(l)) if (!(k in r)) delete l[k];
      Object.assign(l, normalize(r));
      st.pending.delete(l.id);
    }
    l.base = listsOf(r); l.baseAt = r.updatedAt || 0;
    await db.put('playlists', l.id, l);
    return true;
  }
  if (!l.baseAt && (r.updatedAt || 0) === (l.updatedAt || 0)) { l.base = listsOf(r); l.baseAt = r.updatedAt || 0; }
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
      for (const p of S.playlists) if (!remote.has(p.id) && !p.shared) st.pending.add(p.id);
      st.fullPulled = true;
    }
    st.lastPull = Date.now();
    await persist();
    await syncFavs();
    if (changed) emit('playlists');
  } catch (e) {
    if (isMissing(e)) { st.mode = 'missing'; st.error = 'Falta aplicar en Supabase la migración de las playlists'; }
    else if (e.network) st.mode = 'offline';
    else { st.error = e.message; console.warn('Playlists: no se pudieron traer', e); }
  } finally { st.busy = false; announce(); }
  if (st.mode === 'ready') { await push(); processUploads(); flushPlays(); pullShared(); }
}

// ------------------------------------------------------------ subir a Supabase
let timer = null, backoff = 2000;
export function schedulePush(ms = 1200) {
  clearTimeout(timer);
  if (!account.user()) return;
  timer = setTimeout(() => (st.mode === 'ready' ? push() : pull()), ms);
}
export async function push() {
  if (st.busy) { if (st.pending.size) schedulePush(800); return; }   // hay otra operación en curso: se reintenta al acabar
  if (st.mode !== 'ready' || !st.pending.size) return;
  st.busy = true; announce();
  let failed = false;
  try {
    for (const id of [...st.pending]) {
      const p = S.playlists.find(x => x.id === id);
      if (!p) { st.pending.delete(id); continue; }
      const sent = toRemote(p);
      if (p.baseAt) sent.baseAt = p.baseAt;
      const res = await rpc('fiora_save_playlist', { p: sent });
      if (res?.status === 'stale') { st.busy = false; st.fullPulled = false; await pull(); return; }   // otro dispositivo guardó algo más nuevo
      // si se cambió mientras se guardaba, sigue pendiente (se sube la versión nueva en la siguiente vuelta)
      if ((p.updatedAt || 0) <= sent.updatedAt) st.pending.delete(id);
      p.base = listsOf(sent); p.baseAt = sent.updatedAt;
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
  else if (!failed && st.pending.size) schedulePush(300);   // cambios hechos mientras se guardaba
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

// ------------------------------------------------------------ playlists compartidas
export const sharedId = (owner, pid) => `sh~${owner}~${pid}`;
export const isShared = p => !!p?.shared;
/** ¿Puede quien usa la app cambiar las canciones y capítulos de esta playlist? */
export const canEdit = p => !p?.shared || p.shared.role === 'edit';
const sh = { mode: 'unknown', pending: new Set(), busy: false };
let myShares = {};   // {playlistId: [{id, name, edit, group, valid}]}: con quién compartes las tuyas
const persistShared = () => db.put('kv', 'plShared', { pending: [...sh.pending] }).catch(() => {});
export const sharedStatus = () => ({ mode: sh.mode, pending: sh.pending.size, busy: sh.busy, again: !!sh.again });
export const sharesOf = pid => myShares[pid] || [];

/** Trae las playlists que otras personas comparten contigo y quita las que ya no. */
export async function pullShared() {
  if (!account.user() || st.mode !== 'ready') return;
  if (sh.busy) { sh.again = true; return; }   // se repite al acabar la que está en marcha
  sh.busy = true; sh.again = false;
  let changed = false;
  try {
    const [rows, mine] = await Promise.all([rpc('fiora_load_shared_playlists', {}), rpc('fiora_my_shares', {})]);
    sh.mode = 'ready';
    if (JSON.stringify(mine || {}) !== JSON.stringify(myShares)) { myShares = mine || {}; changed = true; }
    const seen = new Set();
    for (const r of rows || []) {
      const { owner, ownerName, role, group, ...rest } = r;
      const id = sharedId(owner, rest.id), meta = { owner, pid: rest.id, ownerName, role, group };
      seen.add(id);
      const remote = normalize({ ...rest, id, shared: meta, notes: {} });
      const l = S.playlists.find(x => x.id === id);
      if (!l) { Object.assign(remote, { base: listsOf(remote), baseAt: remote.updatedAt }); S.playlists.push(remote); await db.put('playlists', id, remote); changed = true; continue; }
      if ((remote.updatedAt || 0) <= (l.baseAt || 0) && JSON.stringify(l.shared) === JSON.stringify(meta)) continue;
      const mine = sh.pending.has(id) && role === 'edit' && l.base ? listsOf(l) : null, base = l.base;
      for (const k of Object.keys(l)) delete l[k];
      Object.assign(l, remote, { base: listsOf(remote), baseAt: remote.updatedAt });
      if (mine) { Object.assign(l, mergeLists(base, mine, l.base)); normalize(l); l.updatedAt = Math.max(Date.now(), remote.updatedAt + 1); }
      else sh.pending.delete(id);
      await db.put('playlists', id, l);
      changed = true;
    }
    // ya no compartidas contigo (o eliminadas, o ya no estás en el grupo)
    for (const p of S.playlists.filter(x => x.shared && !seen.has(x.id))) {
      S.playlists.splice(S.playlists.indexOf(p), 1);
      await db.del('playlists', p.id);
      sh.pending.delete(p.id);
      changed = true;
    }
  } catch (e) {
    if (isMissing(e)) sh.mode = 'missing';
    else if (!e.network) console.warn('Playlists compartidas', e);
  } finally { sh.busy = false; persistShared(); }
  if (changed) emit('playlists');
  if (sh.again) return pullShared();
  if (sh.pending.size) pushShared();
}

let shTimer = null;
function schedulePushShared(ms = 1200) { clearTimeout(shTimer); shTimer = setTimeout(pushShared, ms); }
async function pushShared() {
  if (!sh.pending.size || st.mode !== 'ready') return;
  if (sh.busy) return schedulePushShared(800);
  sh.busy = true;
  let stale = false, retry = false;
  try {
    for (const id of [...sh.pending]) {
      const p = S.playlists.find(x => x.id === id);
      if (!p || p.shared?.role !== 'edit') { sh.pending.delete(id); continue; }
      const lists = listsOf(p), sent = { id: p.shared.pid, updatedAt: p.updatedAt || Date.now(), baseAt: p.baseAt || 0, ...lists };
      const res = await rpc('fiora_save_shared_playlist', { owner: p.shared.owner, p: sent });
      if (res?.status === 'stale') { stale = true; break; }
      if ((p.updatedAt || 0) <= sent.updatedAt) sh.pending.delete(id);
      p.base = lists; p.baseAt = sent.updatedAt;
      await db.put('playlists', p.id, p);
    }
  } catch (e) {
    if (e.code === '42501') { stale = true; for (const id of sh.pending) { const p = S.playlists.find(x => x.id === id); if (p) delete p.base; } sh.pending.clear(); }   // ya no puedes editarla
    else retry = true;
  } finally { sh.busy = false; persistShared(); }
  if (stale) return pullShared();   // fusiona con lo de la otra persona y vuelve a guardar
  if (retry) schedulePushShared(15000);
}

/** Comparte una playlist tuya con personas de un grupo: [{id, edit}]. Vacío deja de compartirla allí. */
export async function share(p, groupId, members) {
  if (p.shared || isFavs(p)) throw new Error('Esta playlist no se puede compartir');
  if (st.mode !== 'ready') throw new Error('Para compartir hace falta conexión y sesión iniciada con Supabase preparado');
  if (st.pending.has(p.id)) await push();
  if (st.pending.has(p.id)) throw new Error('La playlist aún no se ha guardado en tu cuenta; prueba en un momento');
  await rpc('fiora_share_playlist', { pid: p.id, g: groupId, members });
  myShares = (await rpc('fiora_my_shares', {})) || {};
  emit('playlists');
}
/** Deja de ver una playlist que te compartieron. */
export async function leave(p) {
  if (!p.shared) return;
  await rpc('fiora_leave_shared_playlist', { owner: p.shared.owner, pid: p.shared.pid });
  S.playlists.splice(S.playlists.indexOf(p), 1);
  sh.pending.delete(p.id);
  await db.del('playlists', p.id);
  persistShared();
  emit('playlists');
}

// ------------------------------------------------------------ arranque
export async function init() {
  const saved = await db.get('kv', 'plsync').catch(() => null);
  if (saved) { st.pending = new Set(saved.pending || []); st.lastPull = saved.lastPull || 0; }
  local = (await db.get('kv', 'plLocal').catch(() => null)) || {};
  plays = { queue: [], agg: {}, ...((await db.get('kv', 'plPlays').catch(() => null)) || {}) };
  sh.pending = new Set((await db.get('kv', 'plShared').catch(() => null))?.pending || []);
  for (const p of S.playlists) normalize(p);
  on('playlist-saved', p => {
    if (p.shared) { normalize(p); if (p.shared.role === 'edit' && account.user()) { sh.pending.add(p.id); persistShared(); schedulePushShared(); } return; }
    if (p.autoOnly && !savingFavs) delete p.autoOnly;   // el usuario la ha cambiado: ya es «suya» en este dispositivo
    normalize(p);
    if (account.user()) { st.pending.add(p.id); persist(); schedulePush(); }
    announce();
  });
  // «Canciones que te gustan» sigue a los corazones (también cuando llegan de otro dispositivo)
  let favTimer = null;
  on('favs', () => { clearTimeout(favTimer); favTimer = setTimeout(syncFavs, 250); });
  on('personal-cleared', () => setTimeout(syncFavs, 0));
  on('played', ({ id, ctx, secs }) => {
    const p = ctx?.playlist && S.playlists.find(x => x.id === ctx.playlist);
    if (p && !p.deleted && !p.shared && p.trackIds.includes(id)) recordPlay(p.id, id, secs);   // las escuchas de compartidas no se guardan
  });
  on('account', () => { st.fullPulled = false; if (account.user()) pull(); else { st.mode = 'local'; announce(); } });
  on('personal-cleared', async () => {
    // otra cuenta en este dispositivo: lo de la anterior no se mezcla
    st.pending.clear(); st.lastPull = 0; st.fullPulled = false; remoteRows.clear();
    sh.pending.clear(); sh.mode = 'unknown'; myShares = {}; persistShared();
    for (const l of Object.values(local)) for (const id of [l.cover, ...l.photos].filter(Boolean)) await img.dropLocal(id);
    local = {}; plays = { queue: [], agg: {} };
    await Promise.all([persist(), saveLocalState(), savePlays()]);
  });
  addEventListener('online', () => { if (account.user()) pull(); });
  await syncFavs();
  if (account.user()) pull(); else announce();
}
