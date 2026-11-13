// Copia de los datos del usuario (playlists, favoritos, estadísticas, emisoras, ajustes)
// y fusión con una copia remota. Lo usan tanto la cuenta (Supabase) como el bucket de Oracle.
import { forget as forgetOci } from './oci.js';
import * as db from './db.js';
import { S, saveKV, emit, applyEdit } from './store.js';

/** Datos que se guardan fuera del dispositivo. Los ajustes solo viajan con la cuenta. */
export function snapshot(withPrefs = false) {
  const data = { v: 2, at: Date.now(), playlists: S.playlists, favs: S.favs, stats: S.stats, stations: S.stations, edits: S.edits, trans: S.trans, hist: S.hist };
  if (withPrefs) {
    const s = S.settings;
    if (s.buckets?.length && !s.bucketsAt) s.bucketsAt = 1;   // conexión hecha antes de tener cuenta
    data.prefs = {
      buckets: { v: s.buckets || [], upload: s.uploadBucket || '', at: s.bucketsAt || 0 },
      shrink: { v: !!s.shrink, at: s.shrinkAt || 0 },
      genrePresets: { v: s.genrePresets || [], at: s.genrePresetsAt || 0 },
      volume: { v: typeof s.volume === 'number' ? s.volume : 1, at: s.volAt || 0 },
    };
  }
  return data;
}

/** Fusiona una copia remota con los datos locales (gana el cambio más reciente). */
export async function merge(remote) {
  if (!remote || typeof remote !== 'object') return false;
  let changed = false;
  for (const rp of remote.playlists || []) {
    const lp = S.playlists.find(p => p.id === rp.id);
    if (!lp) { S.playlists.push(rp); await db.put('playlists', rp.id, rp); changed = true; }
    else if ((rp.updatedAt || 0) > (lp.updatedAt || 0)) { Object.assign(lp, rp); await db.put('playlists', lp.id, lp); changed = true; }
  }
  for (const [id, f] of Object.entries(remote.favs || {})) {
    if (!S.favs[id] || f.at > S.favs[id].at) { S.favs[id] = f; changed = true; }
  }
  for (const [id, s] of Object.entries(remote.stats || {})) {
    const l = S.stats[id] || (S.stats[id] = { plays: 0, last: 0 });
    if (s.plays > l.plays || s.last > l.last) { l.plays = Math.max(l.plays, s.plays); l.last = Math.max(l.last, s.last); changed = true; }
    for (const k of ['skips', 'done']) if ((s[k] || 0) > (l[k] || 0)) { l[k] = s[k]; changed = true; }
    if (s.h) { l.h ||= [0, 0, 0, 0]; s.h.forEach((n, i) => { if (n > l.h[i]) { l.h[i] = n; changed = true; } }); }
  }
  let transChanged = false;
  for (const [a, m] of Object.entries(remote.trans || {})) {
    const l = S.trans[a] || (S.trans[a] = {});
    for (const [b, n] of Object.entries(m)) if (n > (l[b] || 0)) { l[b] = n; transChanged = true; }
  }
  // Metadatos editados: gana la edición más reciente de cada canción.
  let editsChanged = false;
  for (const [id, e] of Object.entries(remote.edits || {})) {
    if (S.edits[id] && S.edits[id].at >= e.at) continue;
    S.edits[id] = e; editsChanged = true;
    const t = S.tracks.get(id);
    if (t && applyEdit(t)) await db.put('tracks', id, t);
  }
  // Historial de escuchas: de cada día, hora y día de la semana se conserva el valor más alto.
  let histChanged = false;
  const rh = remote.hist;
  if (rh) {
    for (const [day, v] of Object.entries(rh.days || {})) {
      const l = S.hist.days[day] || (S.hist.days[day] = [0, 0]);
      if (v[0] > l[0] || v[1] > l[1]) { l[0] = Math.max(l[0], v[0]); l[1] = Math.max(l[1], v[1]); histChanged = true; }
    }
    for (const k of ['hours', 'week']) (rh[k] || []).forEach((n, i) => { if (n > (S.hist[k][i] || 0)) { S.hist[k][i] = n; histChanged = true; } });
  }
  if (histChanged) await saveKV('hist', false);
  if (transChanged) await saveKV('trans', false);
  if (editsChanged) { await saveKV('edits', false); emit('library'); }
  const seen = new Set(S.stations.map(s => s.id));
  for (const st of remote.stations || []) if (!seen.has(st.id)) { S.stations.push(st); changed = true; }

  let cloudChanged = false;
  const p = remote.prefs;
  if (p) {
    const s = S.settings;
    if (p.buckets && p.buckets.at > (s.bucketsAt || 0)) {
      s.buckets = p.buckets.v || []; s.uploadBucket = p.buckets.upload || ''; s.bucketsAt = p.buckets.at; cloudChanged = true;
    } else if (!p.buckets && p.parUrl?.v && !s.buckets?.length) {   // copia guardada por una versión anterior
      s.buckets = [{ id: 'b1', name: 'Principal', url: p.parUrl.v }]; s.bucketsAt = p.parUrl.at || 1; cloudChanged = true;
    }
    if (p.shrink && p.shrink.at > (s.shrinkAt || 0)) { s.shrink = p.shrink.v; s.shrinkAt = p.shrink.at; }
    if (p.genrePresets && p.genrePresets.at > (s.genrePresetsAt || 0)) { s.genrePresets = p.genrePresets.v || []; s.genrePresetsAt = p.genrePresets.at; }
    if (p.volume && p.volume.at > (s.volAt || 0)) { s.volume = p.volume.v; s.volAt = p.volume.at; emit('volume', s.volume); }
    await saveKV('settings', false);
  }
  if (changed) {
    await Promise.all([saveKV('favs', false), saveKV('stats', false), saveKV('stations', false)]);
    emit('playlists'); emit('favs');
  }
  if (cloudChanged) emit('cloud-changed');
  return changed || cloudChanged;
}

/** Borra los datos personales del dispositivo (al entrar con otra cuenta). La música descargada no se toca. */
export async function clearPersonal() {
  for (const p of S.playlists) await db.del('playlists', p.id);
  S.playlists = []; S.favs = {}; S.stats = {}; S.stations = []; S.trans = {}; S.hist = { days: {}, hours: Array(24).fill(0), week: Array(7).fill(0) };
  S.settings.buckets = []; S.settings.bucketsAt = 0; delete S.settings.uploadBucket;   // la nube era de la otra persona
  await forgetOci();
  await Promise.all([saveKV('favs', false), saveKV('stats', false), saveKV('stations', false), saveKV('trans', false), saveKV('hist', false), saveKV('settings', false)]);
  emit('playlists'); emit('favs');
}
