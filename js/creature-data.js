// Une los datos reales de Fiora con el motor de «Tu criatura sonora» (creature.js): prepara el
// resumen de hábitos, calcula la criatura de un período, mantiene la criatura «oficial» con su
// historial (bestiario) y reúne los recuerdos de la constelación. No guarda nada por su cuenta:
// lo persistente vive en habits.js.
import { S, allTracks, artistsOf, albumArtistOf, dayKey, livePlaylists } from './store.js';
import * as habits from './habits.js';
import * as rdata from './radio-data.js';
import * as pldata from './playlists-data.js';
import { countryName } from './radio.js';
import * as C from './creature.js';

/** Resumen de hábitos que entiende el motor. */
export function gather() {
  const all = { plays: 0, heard: 0, done: 0, skips: 0, long: 0, secs: 0, genres: {}, hours: S.hist.hours, histDays: S.hist.days, top5: null };
  const artists = new Map();
  for (const t of allTracks()) {
    const s = S.stats[t.id];
    if (!s) continue;
    all.skips += s.skips || 0;
    if (!s.plays) continue;
    all.plays += s.plays; all.heard++; all.done += Math.min(s.done || 0, s.plays); all.secs += s.plays * (t.duration || 0);
    if ((t.duration || 0) >= 360) all.long += s.plays;
    for (const a of artistsOf(t)) artists.set(a, (artists.get(a) || 0) + s.plays);
    for (const g of (t.genres || []).slice(0, 2)) all.genres[g] = (all.genres[g] || 0) + s.plays;
  }
  all.artists = artists.size;
  if (all.plays) {
    const top = new Set([...artists].sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]));
    let n = 0;
    for (const t of allTracks()) { const p = S.stats[t.id]?.plays; if (p && artistsOf(t).some(a => top.has(a))) n += p; }
    all.top5 = n / all.plays;
  }
  const cur = habits.H.cur;
  return {
    days: habits.H.days, all,
    open: cur && cur.secs >= 60 ? { day: dayKey(new Date(cur.start)), min: Math.max(1, Math.round(cur.secs / 60)) } : null,
    playlists: livePlaylists().filter(p => !p.shared && p.id !== 'favoritos').map(p => ({ createdAt: p.createdAt || 0, added: Object.values(p.added || {}) })),
    favs: Object.values(S.favs).filter(f => f.on).map(f => f.at),
    passport: rdata.passport().map(p => ({ cc: p.cc, first: p.first })),
  };
}

/** Criatura de un período: indicadores, puntuaciones, explicación y ADN. */
export function evaluate(period = habits.prefs().period, now = Date.now()) {
  const I = C.indicators(gather(), period, now), res = C.classify(I);
  return { period, I, res, dna: C.dna(I), explain: res.primary ? C.explain(res.primary.id, I) : null };
}
/** Período principal; si aún no tiene datos suficientes, todo el historial (y se dice). */
export function main(now = Date.now()) {
  const chosen = habits.prefs().period;
  let ev = evaluate(chosen, now);
  if (!ev.res.primary && chosen !== 'all') { const all = evaluate('all', now); if (all.res.primary) ev = { ...all, fellBack: chosen }; }
  return ev;
}

/**
 * Criatura oficial: se revisa como mucho una vez al día y solo cambia con ventaja sostenida
 * (creature.step). Devuelve {official, cand, event, ev}.
 */
export function official(now = Date.now()) {
  const ev = main(now), H = habits.H, today = dayKey(new Date(now));
  if (!habits.enabled()) return { official: null, cand: null, event: null, ev };
  if (H.official?.evalDay === today || !ev.res.primary) return { official: H.official, cand: H.cand, event: null, ev };
  const r = C.step({ official: H.official, cand: H.cand }, ev.res, ev.I, now);
  const prev = H.log[r.entry.key];
  if (prev && prev.a === r.entry.a && prev.from && !r.entry.from) Object.assign(r.entry, { from: prev.from, changed: prev.changed, margin: prev.margin });
  habits.setOfficial({ ...r.official, evalDay: today }, r.cand, { [r.entry.key]: r.entry });
  return { official: habits.H.official, cand: r.cand, event: r.event, ev };
}
/** Bestiario: una entrada por mes con registro, de la más reciente a la más antigua. */
export const bestiary = () => Object.values(habits.H.log).sort((a, b) => b.key.localeCompare(a.key));

// ------------------------------------------------------------------ recuerdos
const fmtDate = ms => new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
/** Momentos destacados del historial, solo con datos que existen. */
export function memories() {
  const out = [], tracks = allTracks();
  const played = tracks.filter(t => S.stats[t.id]?.plays).sort((a, b) => S.stats[b.id].plays - S.stats[a.id].plays);
  if (played[0]) out.push({ id: 'track', kind: 'Canción más reproducida', title: played[0].title, detail: `${played[0].artist || ''} · ${S.stats[played[0].id].plays} escuchas`, href: '' });
  const artists = new Map(), albums = new Map();
  for (const t of played) {
    for (const a of artistsOf(t)) artists.set(a, (artists.get(a) || 0) + S.stats[t.id].plays);
    if (t.album) { const k = `${t.album}\n${albumArtistOf(t)}`; albums.set(k, (albums.get(k) || 0) + S.stats[t.id].plays); }
  }
  const topA = [...artists].sort((a, b) => b[1] - a[1])[0];
  if (topA) out.push({ id: 'artist', kind: 'Artista más escuchado', title: topA[0], detail: `${topA[1]} escuchas`, href: `#/artista/${encodeURIComponent(topA[0])}` });
  const topAl = [...albums].sort((a, b) => b[1] - a[1])[0];
  if (topAl) { const [al, ar] = topAl[0].split('\n'); out.push({ id: 'album', kind: 'Álbum más escuchado', title: al, detail: `${ar} · ${topAl[1]} escuchas` }); }
  const totals = pldata.localPlayTotals(), topPl = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  const pl = topPl && livePlaylists().find(p => p.id === topPl[0]);
  if (pl && topPl[1] > 0) out.push({ id: 'playlist', kind: 'Playlist más utilizada', title: pl.name, detail: `${topPl[1]} escuchas desde ella en este dispositivo`, href: pl.id === 'favoritos' ? '#/favoritos' : `#/playlist/${encodeURIComponent(pl.id)}` });
  const days = Object.entries(S.hist.days).filter(([, v]) => v[1] > 0).sort((a, b) => b[1][1] - a[1][1]);
  if (days[0]) out.push({ id: 'day', kind: 'Tu día con más música', title: fmtDate(new Date(`${days[0][0]}T12:00:00`).getTime()), detail: `${Math.round(days[0][1][1] / 60)} minutos · ${days[0][1][0]} canciones` });
  const peak = S.hist.hours.indexOf(Math.max(...S.hist.hours));
  if (S.hist.hours.some(Boolean)) out.push({ id: 'hour', kind: 'Tu hora punta', title: `Las ${peak}:00`, detail: `${S.hist.hours[peak]} escuchas a esa hora` });
  const lastFav = Object.entries(S.favs).filter(([id, f]) => f.on && S.tracks.has(id)).sort((a, b) => b[1].at - a[1].at)[0];
  if (lastFav) { const t = S.tracks.get(lastFav[0]); out.push({ id: 'fav', kind: 'Tu favorita más reciente', title: t.title, detail: `${t.artist || ''} · desde el ${fmtDate(lastFav[1].at)}` }); }
  const rf = rdata.favs();
  if (rf.length) { const s = rf[rf.length - 1]; out.push({ id: 'radio', kind: 'Tu primera emisora favorita', title: s.title, detail: countryName(s.cc) || 'Radio en directo' }); }
  const cc = {};
  for (const d of Object.values(habits.H.days)) for (const [c, s] of Object.entries(d.rc || {})) cc[c] = (cc[c] || 0) + s;
  const topC = Object.entries(cc).sort((a, b) => b[1] - a[1])[0];
  const stamps = rdata.passport();
  if (topC && topC[1] >= 120) out.push({ id: 'country', kind: 'País más explorado', title: countryName(topC[0]) || topC[0], detail: `${Math.round(topC[1] / 60)} minutos de sus emisoras` });
  else if (stamps[0]) out.push({ id: 'country', kind: 'Último país de tu pasaporte', title: countryName(stamps[0].cc) || stamps[0].cc, detail: `Sellado el ${fmtDate(stamps[0].first)}` });
  const log = bestiary();
  if (log.length) { const first = log[log.length - 1], a = C.animal(first.a); if (a) out.push({ id: 'first', kind: 'Tu primera criatura', title: a.name, detail: `Desde ${new Date(`${first.key}-15`).toLocaleDateString('es', { month: 'long', year: 'numeric' })}` }); }
  return out;
}
/** Desde cuándo hay resúmenes diarios (para no prometer historia anterior). */
export const recordStart = () => Object.keys(habits.H.days).sort()[0] || null;
