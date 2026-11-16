// Hábitos de escucha para «Tu criatura sonora»: un resumen agregado POR DÍA (contadores, sin
// canciones, sin artistas y sin horas exactas), el historial de criaturas y las preferencias de la
// experiencia. Vive en este dispositivo y, con sesión, en tablas propias de Supabase protegidas con
// RLS (supabase/migrations/20261117120000_creature.sql). Nunca va al bucket.
//
// Qué guarda cada día (claves cortas para ocupar poco):
//   p escuchas · s segundos de las canciones contadas · ls segundos escuchados de verdad (canciones y radio)
//   dn terminadas · sk saltadas · h[8] escuchas por franja de 3 horas
//   rp repeticiones (ya la habías escuchado) · nw canciones nuevas · na artistas nuevos
//   bk reencuentros (llevaba más de 60 días sin sonar) · fa escuchas de tus 5 artistas principales
//   cs pares de canciones seguidas · ax pares con cambio de artista · al pares del mismo álbum
//   lg canciones de 6 minutos o más · dt canciones distintas · da artistas distintos
//   g {género: escuchas} · ss [minutos de cada sesión]
//   rs segundos de radio · rc {país: segundos} · rn emisoras distintas · sw cambios biblioteca ↔ radio
//   pe ediciones de playlists · ad canciones añadidas a la biblioteca
import * as db from './db.js';
import * as account from './account.js';
import { S, on, emit, dayKey, artistsOf } from './store.js';
import { P } from './player.js';
import { mergeDay } from './creature.js';
export { mergeDay };

export const SESSION_GAP = 20 * 60000;       // 20 minutos sin música cierran la sesión
export const COMEBACK = 60 * 86400000;       // 60 días sin sonar: reencuentro
const KEEP_DAYS = 400;
export const DEFAULT_PREFS = { off: false, period: '30', anim: true, habitat: true, mode: 'repel', sound: true, quality: 'auto' };

const EMPTY = () => ({ v: 1, days: {}, cur: null, today: null, last: null, log: {}, official: null, cand: null, stateAt: 0,
  prefs: {}, prefsAt: 0, resetAt: 0, dirty: {}, logDirty: {}, stateDirty: false, since: 0 });
export let H = EMPTY();
const st = { mode: 'local', busy: false, again: false };
export const status = () => ({ ...st });
export const prefs = () => ({ ...DEFAULT_PREFS, ...H.prefs });
export const enabled = () => !prefs().off;

let saveTimer = null, pushTimer = null;
function save(soon = true) {
  clearTimeout(saveTimer);
  if (soon) saveTimer = setTimeout(() => db.put('kv', 'habits', H).catch(() => {}), 2500);
  else return db.put('kv', 'habits', H).catch(() => {});
}
function touch(k) {
  H.dirty[k] = 1;
  save();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => sync().catch(() => {}), 45000);
}
const dayRec = (k = dayKey()) => { const d = H.days[k] || (H.days[k] = {}); touch(k); return d; };
const inc = (d, k, n = 1) => { d[k] = (d[k] || 0) + n; };
function todaySets() {
  const k = dayKey();
  if (H.today?.day !== k) H.today = { day: k, t: {}, a: {}, st: {} };
  return H.today;
}

// ------------------------------------------------------------------ registro
let top5 = null, top5At = 0;
function topArtists() {
  if (top5 && top5At > Date.now() - 600000) return top5;
  const m = new Map();
  for (const t of S.tracks.values()) { const n = S.stats[t.id]?.plays; if (n) for (const a of artistsOf(t)) m.set(a, (m.get(a) || 0) + n); }
  top5 = new Set([...m].sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]));
  top5At = Date.now();
  return top5;
}
/** Una escucha real de una canción de la biblioteca. `plays` y `last` son los de antes de contarla. */
export function recordPlay({ id, plays, last }, now = Date.now()) {
  if (!enabled()) return;
  const t = S.tracks.get(id);
  if (!t) return;
  const d = dayRec(dayKey(new Date(now))), sets = todaySets(), arts = artistsOf(t);
  inc(d, 'p'); inc(d, 's', Math.round(t.duration || 0));
  (d.h ||= Array(8).fill(0))[Math.floor(new Date(now).getHours() / 3)]++;
  if (plays > 0) inc(d, 'rp'); else inc(d, 'nw');
  if (plays > 0 && last && now - last > COMEBACK) inc(d, 'bk');
  if (!plays && !arts.some(a => a === 'Artista desconocido')) {
    // artista nuevo: ninguna otra canción suya tenía escuchas
    let known = false;
    for (const o of S.tracks.values()) if (o.id !== id && S.stats[o.id]?.plays && artistsOf(o).some(a => arts.includes(a))) { known = true; break; }
    if (!known) inc(d, 'na');
  }
  if (arts.some(a => topArtists().has(a))) inc(d, 'fa');
  if ((t.duration || 0) >= 360) inc(d, 'lg');
  const L = H.last;
  if (L && L.k === 'lib' && now - L.at < SESSION_GAP) {
    inc(d, 'cs');
    if (L.a !== arts[0]) inc(d, 'ax');
    if (t.album && L.al === t.album) inc(d, 'al');
  }
  if (L && L.k === 'radio' && now - L.at < SESSION_GAP) inc(d, 'sw');
  H.last = { k: 'lib', a: arts[0], al: t.album || '', at: now };
  if ((t.genres || []).length) {
    d.g ||= {};
    for (const g of t.genres.slice(0, 2)) if (g in d.g || Object.keys(d.g).length < 16) d.g[g] = (d.g[g] || 0) + 1;
  }
  sets.t[id] = 1; for (const a of arts) sets.a[a] = 1;
  d.dt = Math.max(d.dt || 0, Object.keys(sets.t).length);
  d.da = Math.max(d.da || 0, Object.keys(sets.a).length);
}

/** Segundos escuchados de verdad (canción o emisora). Lleva la cuenta de la sesión en curso. */
export function recordListening(track, secs, now = Date.now()) {
  if (!enabled() || !(secs > 0)) return;
  const d = dayRec(dayKey(new Date(now)));
  inc(d, 'ls', secs);
  if (track?.radio) {
    inc(d, 'rs', secs);
    if (track.cc) { d.rc ||= {}; d.rc[track.cc] = (d.rc[track.cc] || 0) + secs; }
    const sets = todaySets();
    sets.st[track.uuid || track.id] = 1;
    d.rn = Math.max(d.rn || 0, Object.keys(sets.st).length);
    const L = H.last;
    if (L && L.k === 'lib' && now - L.at < SESSION_GAP) inc(d, 'sw');
    if (!L || L.k !== 'radio' || now - L.at > 60000) H.last = { k: 'radio', at: now }; else L.at = now;
  }
  for (const k of ['ls', 'rs']) if (d[k]) d[k] = Math.round(d[k]);
  if (H.cur && now - H.cur.last > SESSION_GAP) closeSession();
  if (!H.cur) H.cur = { start: now, last: now, secs: 0 };
  H.cur.secs += secs; H.cur.last = now;
}
function closeSession() {
  const c = H.cur; H.cur = null;
  if (!c || c.secs < 60) return;
  const d = dayRec(dayKey(new Date(c.start)));
  (d.ss ||= []).push(Math.max(1, Math.round(c.secs / 60)));
  if (d.ss.length > 24) d.ss = d.ss.slice(-24);
}
/** Sesiones de un día, contando la que está abierta. */
export const sessionsOf = (k, d, now = Date.now()) =>
  [...(d.ss || []), ...(H.cur && dayKey(new Date(H.cur.start)) === k && H.cur.secs >= 60 ? [Math.max(1, Math.round(H.cur.secs / 60))] : [])];

function prune() {
  const keys = Object.keys(H.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) { delete H.days[k]; delete H.dirty[k]; }
}

// -------------------------------------------------- historial y preferencias
export function setPrefs(patch) {
  H.prefs = { ...H.prefs, ...patch }; H.prefsAt = Date.now(); H.stateDirty = true;
  save(false); emit('habits-prefs'); schedule();
}
/** Estado de la criatura «oficial» (creature.js decide; aquí solo se guarda). */
export function setOfficial(official, cand, logEntries = {}) {
  H.official = official; H.cand = cand; H.stateAt = Date.now(); H.stateDirty = true;
  for (const [k, e] of Object.entries(logEntries)) { H.log[k] = e; H.logDirty[k] = 1; }
  save(false); schedule();
}
const schedule = (ms = 4000) => { clearTimeout(pushTimer); pushTimer = setTimeout(() => sync().catch(() => {}), ms); };

/** Borra todo lo propio de la criatura (resúmenes diarios, historial, criatura actual). Las estadísticas generales no se tocan. */
export async function erase() {
  const p = H.prefs, at = H.prefsAt;
  H = { ...EMPTY(), prefs: p, prefsAt: at, resetAt: Date.now() };
  await save(false);
  emit('habits');
  if (account.user() && st.mode !== 'missing') {
    try { await rpc('fiora_creature_delete', { at: H.resetAt }); } catch (e) { if (!e.network) throw e; H.pendingErase = true; await save(false); }
  }
}

// ------------------------------------------------------------------ Supabase
async function rpc(fn, args) {
  const r = await account.authFetch(`/rest/v1/rpc/${fn}`, { method: 'POST', json: args });
  const data = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(data?.message || `Supabase respondió ${r.status}`); e.status = r.status; e.code = data?.code; throw e; }
  return data;
}
const isMissing = e => ['PGRST202', 'PGRST205', '42883', '42P01'].includes(e.code);
function wipeBefore(at) {
  const k = dayKey(new Date(at));
  for (const d of Object.keys(H.days)) if (d <= k) { delete H.days[d]; delete H.dirty[d]; }
  H.log = {}; H.logDirty = {}; H.official = null; H.cand = null; H.cur = null; H.resetAt = at;
}
function applyRemote(r) {
  let changed = false;
  if ((r.state?.resetAt || 0) > (H.resetAt || 0)) { wipeBefore(r.state.resetAt); changed = true; }
  for (const [k, d] of Object.entries(r.days || {})) {
    const m = mergeDay(H.days[k], d);
    if (JSON.stringify(m) !== JSON.stringify(H.days[k])) { H.days[k] = m; changed = true; }
    if (JSON.stringify(m) !== JSON.stringify(d)) H.dirty[k] = 1;
  }
  for (const [k, e] of Object.entries(r.log || {})) {
    if (!H.log[k] || (e.at || 0) > (H.log[k].at || 0)) { H.log[k] = e; delete H.logDirty[k]; changed = true; }
  }
  const s = r.state || {};
  if ((s.stateAt || 0) > (H.stateAt || 0)) { H.official = s.official || null; H.cand = s.cand || null; H.stateAt = s.stateAt; changed = true; }
  if ((s.prefsAt || 0) > (H.prefsAt || 0)) { H.prefs = s.prefs || {}; H.prefsAt = s.prefsAt; changed = true; emit('habits-prefs'); }
  if (r.at) H.since = r.at;
  return changed;
}
/** Trae lo nuevo de la cuenta, lo une con lo de este dispositivo y sube lo pendiente. */
export async function sync() {
  if (!account.user()) { st.mode = 'local'; return; }
  if (st.busy) { st.again = true; return; }
  st.busy = true;
  try {
    if (H.pendingErase) { await rpc('fiora_creature_delete', { at: H.resetAt }); delete H.pendingErase; }
    const r = await rpc('fiora_creature_load', { since: st.mode === 'ready' ? H.since || 0 : 0 });
    st.mode = 'ready';
    const changed = applyRemote(r || {});
    const days = Object.fromEntries(Object.keys(H.dirty).filter(k => H.days[k]).map(k => [k, H.days[k]]));
    const log = Object.fromEntries(Object.keys(H.logDirty).filter(k => H.log[k]).map(k => [k, H.log[k]]));
    if (Object.keys(days).length || Object.keys(log).length || H.stateDirty) {
      const sent = { days: Object.keys(days), log: Object.keys(log) };
      const res = await rpc('fiora_creature_save', { days, log,
        state: { official: H.official, cand: H.cand, stateAt: H.stateAt || 0, prefs: H.prefs, prefsAt: H.prefsAt || 0, resetAt: H.resetAt || 0 } });
      for (const k of sent.days) if (JSON.stringify(H.days[k]) === JSON.stringify(days[k])) delete H.dirty[k];
      for (const k of sent.log) delete H.logDirty[k];
      H.stateDirty = false;
      if (res?.at) H.since = Math.max(H.since || 0, res.at);
    }
    await save(false);
    if (changed) emit('habits');
  } catch (e) {
    if (isMissing(e)) st.mode = 'missing';
    else if (!e.network) console.warn('Criatura', e);
  } finally {
    st.busy = false;
    emit('habits-sync', status());
    if (st.again) { st.again = false; schedule(1000); }
  }
}

// --------------------------------------------------------------------- inicio
export async function init() {
  const saved = await db.get('kv', 'habits').catch(() => null);
  if (saved?.v === 1) H = { ...EMPTY(), ...saved };
  if (H.cur && Date.now() - H.cur.last > SESSION_GAP) closeSession();
  prune();

  on('play-counted', e => recordPlay(e));
  on('play-skipped', () => { if (enabled()) inc(dayRec(), 'sk'); });
  on('play-done', () => { if (enabled()) inc(dayRec(), 'dn'); });
  on('playlist-saved', p => { if (enabled() && p && p.id !== 'favoritos') inc(dayRec(), 'pe'); });
  on('library-added', n => { if (enabled() && n > 0) inc(dayRec(), 'ad', n); });
  // reloj de escucha real: se acumula y se anota cada 10 segundos
  let clock = 0, acc = 0, who = null;
  const flush = () => { if (acc > 0 && who) recordListening(who, acc); acc = 0; };
  on('time', () => {
    const t = P.current;
    if (!t || !P.playing) { clock = 0; return; }
    const now = performance.now(), dt = clock && now - clock < 3000 ? (now - clock) / 1000 : 0;
    clock = now;
    if (who && who !== t) flush();
    who = t; acc += dt;
    if (acc >= 10) flush();
  });
  on('state', () => { if (!P.playing) flush(); });
  addEventListener('pagehide', () => { flush(); save(false); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flush(); save(false); } });

  on('personal-cleared', () => { H = EMPTY(); save(false); emit('habits'); });
  on('account', () => { if (account.user()) sync().catch(() => {}); else st.mode = 'local'; });
  if (account.user()) sync().catch(() => {});
}
