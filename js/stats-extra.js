// Estadísticas adicionales de Perfil. Lógica pura y sin dependencias: cada función recibe datos que
// Fiora ya guarda y devuelve números (tests/profile/stats-test.mjs). No registra nada nuevo.
//   histDays: {AAAA-MM-DD: [escuchas, segundos]}      habitDays: resúmenes diarios de habits.js
const DAY = 86400000;
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const noon = ms => { const d = new Date(ms); d.setHours(12, 0, 0, 0); return d; };
const sum = a => a.reduce((x, y) => x + y, 0);
const monday = d => (d.getDay() + 6) % 7;      // 0 = lunes

// ------------------------------------------------------------ tiempo y ritmo
/** Calendario de calor: `weeks` columnas de lunes a domingo, la última con hoy. Niveles 0–4. */
export function heatmap(histDays = {}, now = Date.now(), weeks = 53) {
  const today = noon(now), start = new Date(today);
  start.setDate(today.getDate() - monday(today) - (weeks - 1) * 7);
  const cols = [];
  let max = 0, active = 0, total = 0;
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + w * 7 + i);
      if (d > today) { col.push(null); continue; }
      const v = histDays[dayKey(d)] || [0, 0], min = Math.round(v[1] / 60);
      if (v[0]) { active++; total += min; }
      max = Math.max(max, min);
      col.push({ key: dayKey(d), plays: v[0], min });
    }
    cols.push(col);
  }
  const level = c => (!c || !c.plays ? 0 : max <= 0 ? 1 : Math.min(4, 1 + Math.floor((c.min / max) * 3.999)));
  for (const col of cols) for (const c of col) if (c) c.level = level(c);
  return { cols, max, active, total, from: dayKey(start) };
}
/** Racha actual, racha más larga y día con más música. */
export function streaks(histDays = {}, now = Date.now()) {
  const keys = Object.keys(histDays).filter(k => histDays[k]?.[0] > 0).sort();
  let longest = 0, run = 0, prev = null, longestEnd = null;
  for (const k of keys) {
    const t = new Date(`${k}T12:00:00`).getTime();
    run = prev != null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    if (run > longest) { longest = run; longestEnd = k; }
    prev = t;
  }
  let current = 0;
  const d = noon(now);
  for (let i = 0; i < 2000; i++) {
    if (histDays[dayKey(d)]?.[0] > 0) current++;
    else if (current || i > 0) break;                // hoy puede no tener escuchas todavía
    d.setDate(d.getDate() - 1);
  }
  const bestKey = keys.slice().sort((a, b) => histDays[b][1] - histDays[a][1])[0] || null;
  return { current, longest, longestEnd, days: keys.length, best: bestKey ? { key: bestKey, plays: histDays[bestKey][0], min: Math.round(histDays[bestKey][1] / 60) } : null };
}
const MILESTONES = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
/** Hitos de escuchas alcanzados y el siguiente. */
export function milestones(plays = 0) {
  const reached = MILESTONES.filter(m => plays >= m), next = MILESTONES.find(m => plays < m) || null;
  const from = reached[reached.length - 1] || 0;
  return { reached, last: from || null, next, progress: next ? (plays - from) / (next - from) : 1 };
}
/** Los últimos 7 días frente a los 7 anteriores. */
export function weekCompare(histDays = {}, now = Date.now()) {
  const span = from => { const o = { min: 0, plays: 0, days: 0 }; for (let i = from; i < from + 7; i++) { const v = histDays[dayKey(new Date(noon(now).getTime() - i * DAY))]; if (v?.[0]) { o.plays += v[0]; o.min += v[1] / 60; o.days++; } } o.min = Math.round(o.min); return o; };
  const cur = span(0), prev = span(7);
  return { cur, prev, delta: { min: cur.min - prev.min, plays: cur.plays - prev.plays, days: cur.days - prev.days } };
}
export const SESSION_BINS = [['Hasta 15 min', 0, 15], ['15–30 min', 15, 30], ['30–60 min', 30, 60], ['1–2 h', 60, 120], ['Más de 2 h', 120, Infinity]];
/** Histograma de duración de las sesiones (minutos) y la más larga. */
export function sessionsHist(habitDays = {}) {
  const all = [];
  let longestDay = null, longest = 0;
  for (const [k, d] of Object.entries(habitDays)) for (const m of d.ss || []) { all.push(m); if (m > longest) { longest = m; longestDay = k; } }
  const bins = SESSION_BINS.map(([label, lo, hi]) => ({ label, n: all.filter(m => m > lo && m <= hi || (lo === 0 && m === 0)).length }));
  return { count: all.length, bins, longest, longestDay, mean: all.length ? Math.round(sum(all) / all.length) : 0, since: Object.keys(habitDays).sort()[0] || null };
}

// -------------------------------------------------------------------- gustos
/** Escuchas por década según el año de cada canción. tracks: [{year, plays}] */
export function decades(tracks = []) {
  const m = new Map();
  let withYear = 0, noYear = 0, acc = 0;
  for (const t of tracks) {
    if (!t.plays) continue;
    const y = +t.year;
    if (!(y >= 1900 && y <= 2100)) { noYear += t.plays; continue; }
    const d = Math.floor(y / 10) * 10;
    m.set(d, (m.get(d) || 0) + t.plays); withYear += t.plays; acc += y * t.plays;
  }
  const list = [...m].sort((a, b) => a[0] - b[0]);
  return { list, withYear, noYear, mean: withYear ? Math.round(acc / withYear) : null, top: list.slice().sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
}
export const PARTS = ['Madrugada', 'Mañana', 'Tarde', 'Noche'];
/** Ambiente por franja del día. tracks: [{moods: [], h: [4]}]. Cada celda: parte de las escuchas etiquetadas de esa franja. */
export function moodByPart(tracks = [], maxMoods = 6) {
  const tot = new Map(), cell = new Map(), perPart = [0, 0, 0, 0];
  for (const t of tracks) {
    if (!t.moods?.length || !t.h) continue;
    t.h.forEach((n, p) => {
      if (!n) return;
      perPart[p] += n;
      for (const mo of t.moods) { tot.set(mo, (tot.get(mo) || 0) + n); const k = `${p}|${mo}`; cell.set(k, (cell.get(k) || 0) + n); }
    });
  }
  const moods = [...tot].sort((a, b) => b[1] - a[1]).slice(0, maxMoods).map(x => x[0]);
  const matrix = PARTS.map((_, p) => moods.map(mo => (perPart[p] ? (cell.get(`${p}|${mo}`) || 0) / perPart[p] : 0)));
  const top = PARTS.map((_, p) => { if (perPart[p] < 5) return null; const i = matrix[p].indexOf(Math.max(...matrix[p])); return matrix[p][i] > 0 ? moods[i] : null; });
  return { moods, matrix, top, perPart, tagged: sum(perPart) };
}
/** Río de géneros: escuchas por semana de los géneros principales. */
export function genreRiver(habitDays = {}, now = Date.now(), weeks = 12, maxGenres = 6) {
  const today = noon(now), start = new Date(today);
  start.setDate(today.getDate() - monday(today) - (weeks - 1) * 7);
  const tot = new Map(), per = Array.from({ length: weeks }, () => ({}));
  for (const [k, d] of Object.entries(habitDays)) {
    if (!d.g) continue;
    const w = Math.floor((new Date(`${k}T12:00:00`) - start) / (7 * DAY));
    if (w < 0 || w >= weeks) continue;
    for (const [g, n] of Object.entries(d.g)) { per[w][g] = (per[w][g] || 0) + n; tot.set(g, (tot.get(g) || 0) + n); }
  }
  const order = [...tot].sort((a, b) => b[1] - a[1]), genres = order.slice(0, maxGenres).map(x => x[0]), rest = order.length > maxGenres;
  const names = rest ? [...genres, 'Otros'] : genres;
  const series = names.map(g => per.map(w => (g === 'Otros' && rest ? sum(Object.entries(w).filter(([x]) => !genres.includes(x)).map(x => x[1])) : w[g] || 0)));
  const labels = per.map((_, w) => { const d = new Date(start); d.setDate(start.getDate() + w * 7); return dayKey(d); });
  return { genres: names, series, labels, weeksWithData: per.filter(w => Object.keys(w).length).length, total: sum([...tot.values()]) };
}
/** Concentración por artista. list: [[nombre, escuchas]] */
export function concentration(list = [], n = 12) {
  const sorted = list.filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]), total = sum(sorted.map(x => x[1]));
  const top = sorted.slice(0, n), rest = total - sum(top.map(x => x[1]));
  return { top, rest, total, count: sorted.length, top10: total ? sum(sorted.slice(0, 10).map(x => x[1])) / total : 0, top1: total && sorted[0] ? sorted[0][1] / total : 0 };
}
/** Reparte bloques en un rectángulo (treemap por cortes). items: [[nombre, valor]] → [{name, value, x, y, w, h}] en 0–100. */
export function treemap(items = [], x = 0, y = 0, w = 100, h = 100) {
  const list = items.filter(i => i[1] > 0);
  if (!list.length) return [];
  if (list.length === 1) return [{ name: list[0][0], value: list[0][1], x, y, w, h }];
  const total = sum(list.map(i => i[1]));
  let acc = 0, cut = 0;
  while (cut < list.length - 1 && acc + list[cut][1] <= total / 2) acc += list[cut++][1];
  if (!cut) { cut = 1; acc = list[0][1]; }
  const a = list.slice(0, cut), b = list.slice(cut), f = acc / total;
  return w >= h ? [...treemap(a, x, y, w * f, h), ...treemap(b, x + w * f, y, w * (1 - f), h)] : [...treemap(a, x, y, w, h * f), ...treemap(b, x, y + h * f, w, h * (1 - f))];
}

// ---------------------------------------------------------------- biblioteca
/** Cuánto de la biblioteca se ha escuchado. tracks: [{plays, album (clave o '')}] */
export function explored(tracks = []) {
  const albums = new Map();
  let heard = 0;
  for (const t of tracks) {
    if (t.plays) heard++;
    if (t.album) { const a = albums.get(t.album) || [0, 0]; a[0]++; if (t.plays) a[1]++; albums.set(t.album, a); }
  }
  const real = [...albums.values()].filter(a => a[0] >= 3);       // un «álbum» de una o dos canciones no cuenta
  return { heard, total: tracks.length, share: tracks.length ? heard / tracks.length : 0, albums: real.length, albumsDone: real.filter(a => a[1] === a[0]).length };
}
/** Favoritas que llevan `days` días sin sonar (o que no han sonado nunca). tracks: [{id, fav, last, plays}] */
export function forgottenFavs(tracks = [], now = Date.now(), days = 90) {
  return tracks.filter(t => t.fav && (!t.last || now - t.last > days * DAY)).sort((a, b) => (a.last || 0) - (b.last || 0))
    .map(t => ({ id: t.id, days: t.last ? Math.floor((now - t.last) / DAY) : null }));
}
/** Canciones que casi siempre terminas y canciones que casi siempre saltas (con al menos `min` intentos). */
export function skipLists(tracks = [], min = 5, n = 5) {
  const rated = tracks.map(t => { const tries = (t.plays || 0) + (t.skips || 0); return { id: t.id, tries, done: tries ? Math.min(t.done || 0, t.plays || 0) / tries : 0, skip: tries ? (t.skips || 0) / tries : 0 }; }).filter(t => t.tries >= min);
  return { never: rated.filter(t => t.done >= 0.8).sort((a, b) => b.done - a.done || b.tries - a.tries).slice(0, n),
    always: rated.filter(t => t.skip >= 0.5).sort((a, b) => b.skip - a.skip || b.tries - a.tries).slice(0, n) };
}
/** Crecimiento acumulado por mes de la biblioteca y de las favoritas. */
export function growth(addedAts = [], favAts = [], now = Date.now(), months = 12) {
  const out = [], d = new Date(now);
  for (let i = months - 1; i >= 0; i--) {
    const end = new Date(d.getFullYear(), d.getMonth() - i + 1, 1).getTime(), m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, lib: addedAts.filter(t => t && t < end).length, favs: favAts.filter(t => t && t < end).length });
  }
  return out;
}

// ---------------------------------------------------------------- conexiones
/** Parejas de canciones que más suenan seguidas (en cualquier orden). trans: {a: {b: veces}} */
export function transitions(trans = {}, maxPairs = 25, known = null) {
  const m = new Map();
  for (const [a, next] of Object.entries(trans)) for (const [b, n] of Object.entries(next)) {
    if (a === b || (known && (!known.has(a) || !known.has(b)))) continue;
    const k = a < b ? `${a}\n${b}` : `${b}\n${a}`;
    m.set(k, (m.get(k) || 0) + n);
  }
  const pairs = [...m].map(([k, n]) => { const [a, b] = k.split('\n'); return { a, b, n }; }).filter(p => p.n >= 2).sort((x, y) => y.n - x.n).slice(0, maxPairs);
  const weight = new Map();
  for (const p of pairs) { weight.set(p.a, (weight.get(p.a) || 0) + p.n); weight.set(p.b, (weight.get(p.b) || 0) + p.n); }
  return { pairs, nodes: [...weight].sort((a, b) => b[1] - a[1]).map(([id, w]) => ({ id, w })) };
}
/** Canciones que acompañan a una (antes o después), de más a menos. */
export function companions(trans = {}, id, n = 6) {
  const m = new Map();
  for (const [b, k] of Object.entries(trans[id] || {})) m.set(b, (m.get(b) || 0) + k);
  for (const [a, next] of Object.entries(trans)) if (a !== id && next[id]) m.set(a, (m.get(a) || 0) + next[id]);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([tid, times]) => ({ id: tid, times }));
}
/** Minutos de radio por país, de los resúmenes diarios. */
export function radioCountries(habitDays = {}) {
  const cc = {};
  for (const d of Object.values(habitDays)) for (const [c, s] of Object.entries(d.rc || {})) cc[c] = (cc[c] || 0) + s;
  return Object.entries(cc).map(([c, s]) => ({ cc: c, min: Math.round(s / 60) })).filter(x => x.min >= 1).sort((a, b) => b.min - a.min);
}

// ----------------------------------------------------------- resumen del mes
/** Meses (AAAA-MM) con escuchas, del más reciente al más antiguo. */
export const monthsWithData = (histDays = {}) => [...new Set(Object.keys(histDays).filter(k => histDays[k]?.[0] > 0).map(k => k.slice(0, 7)))].sort().reverse();
/** Lo que se sabe de un mes: minutos, escuchas, días, día récord, género principal, sesiones y radio. */
export function monthRecap(histDays = {}, habitDays = {}, month) {
  const keys = Object.keys(histDays).filter(k => k.startsWith(month) && histDays[k]?.[0] > 0).sort();
  const g = {}, cc = new Set();
  let sessions = 0, longest = 0, radio = 0, fresh = 0;
  for (const [k, d] of Object.entries(habitDays)) {
    if (!k.startsWith(month)) continue;
    for (const [x, n] of Object.entries(d.g || {})) g[x] = (g[x] || 0) + n;
    for (const m of d.ss || []) { sessions++; longest = Math.max(longest, m); }
    radio += d.rs || 0; fresh += d.nw || 0;
    for (const c of Object.keys(d.rc || {})) cc.add(c);
  }
  const best = keys.slice().sort((a, b) => histDays[b][1] - histDays[a][1])[0] || null;
  const [y, mo] = month.split('-').map(Number);
  return { month, days: keys.length, daysInMonth: new Date(y, mo, 0).getDate(), plays: sum(keys.map(k => histDays[k][0])), min: Math.round(sum(keys.map(k => histDays[k][1])) / 60),
    best: best ? { key: best, min: Math.round(histDays[best][1] / 60), plays: histDays[best][0] } : null,
    genre: Object.entries(g).sort((a, b) => b[1] - a[1])[0]?.[0] || null, sessions, longest, radioMin: Math.round(radio / 60), countries: cc.size, newTracks: fresh };
}
