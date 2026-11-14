// Datos propios de Explorar: emisoras favoritas, colecciones de radios, pasaporte musical,
// preferencias e historial reciente. Primero se guardan en el dispositivo (funciona sin cuenta) y,
// con sesión iniciada, se sincronizan con Supabase (migración 20261115120000_explore.sql).
//
// Cómo se sincroniza: el estado local es «lo último que dio Supabase + cambios pendientes». Cada
// cambio se anota en una cola de operaciones que se envía en orden; al traer de Supabase se aplica
// lo remoto y, encima, lo que aún está pendiente.
import * as db from './db.js';
import { S, emit, on, saveKV } from './store.js';
import * as account from './account.js';
import * as img from './images.js';
import * as radio from './radio.js';

const EMPTY = () => ({ favs: [], colls: [], passport: {}, prefs: {}, prefsAt: 0 });
let D = EMPTY();
let ops = [];               // [{t:'fav', s, on, at} | {t:'coll', id} | {t:'stamp', cc, uuid, name, at} | {t:'prefs'}]
let history = [];           // últimas emisoras escuchadas (solo en este dispositivo, máx. 20)
let recent = [];            // uuids de las últimas emisoras propuestas por la ruleta/sorpresa (solo local)
const st = { mode: 'local', busy: false, error: '', pulled: false };
// mode: 'local' (sin sesión) · 'checking' · 'ready' · 'missing' (falta la migración) · 'offline'

export const status = () => ({ mode: st.mode, error: st.error, pending: ops.length, busy: st.busy });
const save = () => Promise.all([db.put('kv', 'explore', D), db.put('kv', 'exploreOps', ops)]).catch(() => {});
const changed = what => { emit('explore', what); };

// ------------------------------------------------------------- favoritas
export const favs = () => D.favs.map(f => radio.fromRef(f.station));
export const isFav = uuid => D.favs.some(f => f.uuid === uuid);
function mirror() {
  // `S.stations` (lo que usaban las versiones anteriores) sigue reflejando las favoritas
  S.stations = favs();
  saveKV('stations', false);
}
export async function toggleFav(st, force) {
  const on = force ?? !isFav(st.uuid);
  const at = Date.now();
  D.favs = D.favs.filter(f => f.uuid !== st.uuid);
  if (on) D.favs.unshift({ uuid: st.uuid, station: radio.ref(st), at });
  ops = ops.filter(o => !(o.t === 'fav' && o.s.uuid === st.uuid));
  ops.push({ t: 'fav', s: radio.ref(st), on, at });
  mirror(); await save(); changed('favs'); schedule();
  return on;
}

// ------------------------------------------------------------- colecciones
export const collections = () => D.colls.filter(c => !c.deleted);
export const collection = id => D.colls.find(c => c.id === id && !c.deleted);
const touch = c => { c.updatedAt = Math.max(Date.now(), (c.updatedAt || 0) + 1); ops = ops.filter(o => !(o.t === 'coll' && o.id === c.id)); ops.push({ t: 'coll', id: c.id }); };
export async function saveCollection(c) {
  if (!D.colls.includes(c)) D.colls.push(c);
  c.name = String(c.name || '').trim().slice(0, 80) || 'Colección';
  c.description = String(c.description || '').slice(0, 500);
  c.items = (c.items || []).filter((x, i, a) => a.findIndex(y => y.uuid === x.uuid) === i).slice(0, 500);
  c.createdAt ||= Date.now();
  touch(c);
  await save(); changed('colls'); schedule();
  return c;
}
export async function newCollection(name, description = '') {
  return saveCollection({ id: img.newId(), name, description, cover: {}, items: [] });
}
export async function addToCollection(c, st) {
  if (c.items.some(x => x.uuid === st.uuid)) return false;
  c.items.push({ uuid: st.uuid, station: radio.ref(st) });
  await saveCollection(c);
  return true;
}
export async function removeFromCollection(c, uuid) { c.items = c.items.filter(x => x.uuid !== uuid); await saveCollection(c); }
export async function deleteCollection(c) {
  if (c.cover?.local) await img.dropLocal(c.cover.local);
  c.deleted = true; c.items = [];
  await saveCollection(c);
}
export const stationsOf = c => c.items.map(x => radio.fromRef(x.station));

// ------------------------------------------------------------- pasaporte
export const passport = () => Object.entries(D.passport).map(([cc, p]) => ({ cc, ...p })).sort((a, b) => b.first - a.first);
/** Sella un país. Lo llama la app solo tras escuchar una emisora de ese país el tiempo mínimo. Devuelve true si es nuevo. */
export async function stamp(cc, st) {
  if (!/^[A-Z]{2}$/.test(cc || '')) return false;
  const at = Date.now();
  const prev = D.passport[cc];
  D.passport[cc] = prev ? { ...prev, last: at } : { first: at, last: at, uuid: st.uuid, name: st.title };
  ops.push({ t: 'stamp', cc, uuid: st.uuid || '', name: st.title || '', at });
  await save(); changed('passport'); schedule();
  return !prev;
}
export async function resetPassport() {
  D.passport = {};
  ops = ops.filter(o => o.t !== 'stamp');
  ops.push({ t: 'passport-reset', at: Date.now() });
  await save(); changed('passport'); schedule();
}

// ------------------------------------------------------------- preferencias
export const DEFAULT_PREFS = { mix: { fam: 0.5, intl: 0.5, energy: 0.5 }, home: '', passport: { on: true, secs: 60 }, atlas: 'auto', tasting: 30, journey: null, roulette: 'any', ambients: [] };
export const prefs = () => ({ ...DEFAULT_PREFS, ...D.prefs, mix: { ...DEFAULT_PREFS.mix, ...(D.prefs.mix || {}) }, passport: { ...DEFAULT_PREFS.passport, ...(D.prefs.passport || {}) } });
export async function setPrefs(patch) {
  D.prefs = { ...D.prefs, ...patch };
  D.prefsAt = Date.now();
  ops = ops.filter(o => o.t !== 'prefs'); ops.push({ t: 'prefs' });
  await save(); changed('prefs'); schedule(2500);
}

// ------------------------------------------------------------- historial local
export const historyList = () => history.map(radio.fromRef);
export function remember(st) {
  history = [radio.ref(st), ...history.filter(h => h.uuid !== st.uuid)].slice(0, 20);
  db.put('kv', 'radioHistory', history).catch(() => {});
}
export const recentPicks = () => recent;
export function markPicked(uuid) { recent = [uuid, ...recent.filter(x => x !== uuid)].slice(0, 60); db.put('kv', 'radioRecent', recent).catch(() => {}); }

/** Lo que escuchas (para «fuera de tu zona», el mezclador y «Porque escuchas…»). Todo local. */
export function profile() {
  const countries = new Set(), tags = new Set();
  for (const s of [...D.favs.map(f => f.station), ...history]) { if (s.cc) countries.add(s.cc); for (const t of s.tags || []) tags.add(t.toLowerCase()); }
  for (const cc of Object.keys(D.passport)) countries.add(cc);
  for (const t of S.tracks.values()) for (const g of t.genres || []) tags.add(g.toLowerCase());
  return { countries, tags };
}

// ------------------------------------------------------------- Supabase
async function rpc(fn, args) {
  const r = await account.authFetch(`/rest/v1/rpc/${fn}`, { method: 'POST', json: args });
  const data = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(data?.message || `Supabase respondió ${r.status}`); e.status = r.status; e.code = data?.code; throw e; }
  return data;
}
const isMissing = e => ['PGRST202', 'PGRST205', '42883', '42P01'].includes(e.code);

function applyRemote(r) {
  const next = EMPTY();
  next.favs = (r.favorites || []).map(f => ({ uuid: f.uuid, station: f.station, at: f.at }));
  next.colls = (r.collections || []).map(c => ({ ...c, cover: c.cover || {}, items: c.items || [] }));
  for (const p of r.passport || []) next.passport[p.cc] = { first: p.first, last: p.last, uuid: p.uuid, name: p.name };
  next.prefs = r.prefs || {}; next.prefsAt = r.prefsAt || 0;
  // lo que sigue pendiente en este dispositivo se aplica encima
  for (const o of ops) {
    if (o.t === 'fav') { next.favs = next.favs.filter(f => f.uuid !== o.s.uuid); if (o.on) next.favs.unshift({ uuid: o.s.uuid, station: o.s, at: o.at }); }
    if (o.t === 'stamp') { const p = next.passport[o.cc]; next.passport[o.cc] = p ? { ...p, last: Math.max(p.last, o.at) } : { first: o.at, last: o.at, uuid: o.uuid, name: o.name }; }
    if (o.t === 'passport-reset') next.passport = {};
    if (o.t === 'coll') {
      const local = D.colls.find(c => c.id === o.id), remote = next.colls.find(c => c.id === o.id);
      if (local && (!remote || (local.updatedAt || 0) >= (remote.updatedAt || 0))) next.colls = [...next.colls.filter(c => c.id !== o.id), local];
      else ops = ops.filter(x => x !== o);   // en Supabase hay una versión más nueva: gana esa
    }
    if (o.t === 'prefs' && D.prefsAt >= next.prefsAt) { next.prefs = D.prefs; next.prefsAt = D.prefsAt; }
  }
  // colecciones con portada solo local (más de 16 MB) conservan esa portada en este dispositivo
  for (const c of next.colls) { const l = D.colls.find(x => x.id === c.id); if (l?.cover?.local && !c.cover?.path) c.cover = { ...c.cover, local: l.cover.local }; }
  next.favs.sort((a, b) => b.at - a.at);
  D = next;
}

export async function pull() {
  if (!account.user()) { st.mode = 'local'; return emit('explore-sync', status()); }
  if (st.busy) return;
  st.busy = true; if (st.mode !== 'ready') st.mode = 'checking';
  try {
    const r = await rpc('fiora_load_explore', {});
    st.mode = 'ready'; st.error = ''; S.radioManaged = true;
    if (!st.pulled) {
      // primera vez con esta cuenta en este dispositivo: lo que había solo aquí se sube
      const remoteFavs = new Set((r.favorites || []).map(f => f.uuid));
      for (const f of D.favs) if (!remoteFavs.has(f.uuid) && !ops.some(o => o.t === 'fav' && o.s.uuid === f.uuid)) ops.push({ t: 'fav', s: f.station, on: true, at: f.at });
      const remoteColls = new Set((r.collections || []).map(c => c.id));
      for (const c of D.colls) if (!remoteColls.has(c.id) && !ops.some(o => o.t === 'coll' && o.id === c.id)) ops.push({ t: 'coll', id: c.id });
      const remoteCc = new Set((r.passport || []).map(p => p.cc));
      for (const [cc, p] of Object.entries(D.passport)) if (!remoteCc.has(cc)) ops.push({ t: 'stamp', cc, uuid: p.uuid, name: p.name, at: p.first });
      if (D.prefsAt > (r.prefsAt || 0) && !ops.some(o => o.t === 'prefs')) ops.push({ t: 'prefs' });
      st.pulled = true;
    }
    applyRemote(r);
    mirror(); await save(); changed('all');
  } catch (e) {
    if (isMissing(e)) { st.mode = 'missing'; st.error = 'Falta aplicar en Supabase la migración de Explorar'; }
    else if (e.network) st.mode = 'offline';
    else { st.error = e.message; console.warn('Explorar: no se pudo traer', e); }
  } finally { st.busy = false; emit('explore-sync', status()); }
  if (st.mode === 'ready') { await push(); uploadCovers(); }
}

let timer = null, backoff = 2000;
function schedule(ms = 900) {
  clearTimeout(timer);
  if (!account.user()) return;
  timer = setTimeout(() => (st.mode === 'ready' ? push() : pull()), ms);
}
export async function push() {
  if (st.busy) { if (ops.length) schedule(800); return; }
  if (st.mode !== 'ready' || !ops.length) return;
  st.busy = true;
  let failed = false;
  try {
    while (ops.length) {
      const o = ops[0];
      if (o.t === 'fav') await rpc('fiora_radio_fav', { station: o.s, fav: o.on, at: o.at });
      else if (o.t === 'stamp') await rpc('fiora_passport_stamp', { cc: o.cc, station_uuid: o.uuid, station_name: o.name, at: o.at });
      else if (o.t === 'passport-reset') {
        const r = await account.authFetch('/rest/v1/fiora_passport?country_code=neq.__', { method: 'DELETE' });
        if (!r.ok) throw Object.assign(new Error(`Supabase respondió ${r.status}`), { status: r.status });
      } else if (o.t === 'prefs') {
        const res = await rpc('fiora_save_explore_prefs', { prefs: D.prefs, at: D.prefsAt || Date.now() });
        if (res?.status === 'stale') { ops.shift(); st.busy = false; st.pulled = true; await save(); return pull(); }
      } else if (o.t === 'coll') {
        const c = D.colls.find(x => x.id === o.id);
        if (c) {
          const res = await rpc('fiora_save_radio_collection', { c: toRemote(c) });
          if (res?.status === 'stale') { ops.shift(); st.busy = false; await save(); return pull(); }
          if (res?.removed?.length) img.remove(res.removed).catch(err => console.warn('No se pudieron borrar portadas viejas', err));
        }
      }
      ops.shift();
      await save();
    }
    st.error = ''; backoff = 2000;
  } catch (e) {
    failed = true;
    if (e.network) st.mode = 'offline';
    else if (isMissing(e)) { st.mode = 'missing'; st.error = 'Falta aplicar en Supabase la migración de Explorar'; }
    else if (e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429) {
      console.warn('Explorar: operación rechazada, se descarta', ops[0], e);
      ops.shift(); await save(); failed = false;   // datos que Supabase no acepta: no se reintenta para siempre
    } else st.error = `No se pudo guardar: ${e.message}`;
  } finally { st.busy = false; emit('explore-sync', status()); }
  if (failed && st.mode !== 'missing') { backoff = Math.min(backoff * 2, 120000); schedule(backoff); }
  else if (ops.length) schedule(300);
}
const toRemote = c => ({
  id: c.id, name: c.name, description: c.description || '', createdAt: c.createdAt, updatedAt: c.updatedAt, deleted: !!c.deleted,
  cover: c.cover?.path ? { kind: 'image', path: c.cover.path, thumb: c.cover.thumb || '' } : {},
  items: c.items.map(x => x.station),
});

// ------------------------------------------------------------- portadas de colecciones
export const coverPath = (cid, id, mime, thumb) => img.cloudPath(`radio-${cid}`, 'cover', id, mime, thumb);
/** Guarda la portada elegida (ya preparada con el diálogo de 16 MB) y la sube si se puede. */
export async function setCover(c, rec, cloud) {
  await img.saveLocal({ ...rec, pid: 'radio-' + c.id, state: cloud ? 'pending' : 'local' });
  if (c.cover?.local && c.cover.local !== rec.id) await img.dropLocal(c.cover.local);
  c.cover = { local: rec.id, ...(cloud ? { pending: true } : { only: true }) };
  await saveCollection(c);
  if (cloud) return uploadCover(c);
  return false;
}
async function uploadCover(c) {
  if (!account.user() || st.mode !== 'ready' || !c.cover?.local || !c.cover.pending) return false;
  const rec = await img.getLocal(c.cover.local);
  if (!rec) return false;
  const path = coverPath(c.id, rec.id, rec.mime), thumb = rec.thumb ? coverPath(c.id, rec.id, 'image/jpeg', true) : '';
  await img.upload(path, rec.blob, rec.mime);
  if (rec.thumb) await img.upload(thumb, rec.thumb, 'image/jpeg');
  c.cover = { kind: 'image', path, thumb, local: rec.id };
  await saveCollection(c);
  return true;
}
async function uploadCovers() { for (const c of collections()) if (c.cover?.pending) await uploadCover(c).catch(e => console.warn('Portada de colección', e)); }
export async function coverUrl(c) {
  if (c.cover?.local) { const u = await img.localUrl(c.cover.local, true); if (u) return u; }
  if (c.cover?.thumb || c.cover?.path) return img.cloudUrl(c.cover.thumb || c.cover.path);
  return null;
}

// ------------------------------------------------------------- arranque
export async function init() {
  D = { ...EMPTY(), ...((await db.get('kv', 'explore').catch(() => null)) || {}) };
  ops = (await db.get('kv', 'exploreOps').catch(() => null)) || [];
  history = (await db.get('kv', 'radioHistory').catch(() => null)) || [];
  recent = (await db.get('kv', 'radioRecent').catch(() => null)) || [];
  // Las emisoras guardadas con versiones anteriores pasan a ser favoritas (una sola vez).
  if (!D.migratedStations && S.stations?.length) {
    for (const s of S.stations) {
      const uuid = s.uuid || String(s.id || '').replace(/^radio:/, '');
      if (!uuid || D.favs.some(f => f.uuid === uuid)) continue;
      D.favs.push({ uuid, station: radio.ref({ ...s, uuid }), at: Date.now() });
    }
  }
  D.migratedStations = true;
  mirror(); await save();
  on('account', () => { st.pulled = false; if (account.user()) pull(); else { st.mode = 'local'; emit('explore-sync', status()); } });
  on('personal-cleared', async () => {
    // otra cuenta en este dispositivo: lo de la anterior no se mezcla
    for (const c of D.colls) if (c.cover?.local) await img.dropLocal(c.cover.local);
    D = { ...EMPTY(), migratedStations: true }; ops = []; history = []; recent = []; st.pulled = false;
    await Promise.all([save(), db.put('kv', 'radioHistory', []), db.put('kv', 'radioRecent', [])]).catch(() => {});
    mirror(); changed('all');
  });
  addEventListener('online', () => { if (account.user()) pull(); });
  if (account.user()) pull();
}
/** ¿Las favoritas ya las gestiona Supabase? (entonces la copia antigua del snapshot no se mezcla). */
export const managed = () => st.mode === 'ready';
