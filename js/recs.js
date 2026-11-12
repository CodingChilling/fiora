// Recomendaciones calculadas en el dispositivo a partir de tus hábitos de escucha:
// qué terminas y qué saltas, a qué hora escuchas cada cosa y qué canciones suenan seguidas.
import { S, allTracks, isFav, artistsOf, daypart } from './store.js';

const DAY = 864e5;

// Generador pseudoaleatorio con semilla: la mezcla del día no cambia cada vez que abres la app.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const today = () => Math.floor(Date.now() / DAY);
const stat = t => S.stats[t.id] || { plays: 0, last: 0 };
const low = s => String(s).toLowerCase();

function pick(tracks, score, n, seed) {
  const rand = rng(seed);
  return tracks.map(t => [score(t, rand), t]).sort((a, b) => b[0] - a[0]).slice(0, n).map(x => x[1]);
}

/**
 * Cuánto te gusta una canción según lo que haces con ella, de 0 a 1 (0,5 = sin datos).
 * Terminarla suma, escucharla a medias suma algo, saltarla al empezar resta.
 */
export function affinity(t) {
  const s = stat(t);
  const good = (s.done || 0) + 0.3 * (s.plays || 0), bad = 1.5 * (s.skips || 0);
  return (1 + good) / (2 + good + bad);
}

/** Parte de las escuchas de una canción que caen en una franja del día. */
function partShare(t, part) {
  const h = stat(t).h;
  if (!h) return 0;
  const total = h[0] + h[1] + h[2] + h[3];
  return total ? h[part] / total : 0;
}

/** Parecido entre dos listas de etiquetas (0 a 1). */
function overlap(a, b) {
  if (!a?.length || !b?.length) return 0;
  const B = new Set(b.map(low));
  const shared = a.filter(x => B.has(low(x))).length;
  return shared / (a.length + b.length - shared);
}

/** Mezcla diaria: lo que más te gusta, lo que sueles oír a esta hora y hueco para lo olvidado. */
export function dailyMix(n = 40) {
  const now = Date.now(), part = daypart();
  return pick(allTracks(), (t, rand) => {
    const s = stat(t);
    const rest = s.last ? Math.min((now - s.last) / DAY, 30) / 30 : 0.6;
    return (isFav(t.id) ? 1 : 0) + Math.log2(1 + s.plays) * 0.4 + rest + affinity(t) * 1.5 + partShare(t, part) + rand() * 2;
  }, n, today());
}

export const PART_NAMES = ['tus madrugadas', 'tus mañanas', 'tus tardes', 'tus noches'];
/** Lo que sueles escuchar en esta franja del día. Vacía hasta que haya suficientes escuchas. */
export function momentMix(n = 40, part = daypart()) {
  const list = allTracks().filter(t => (stat(t).h?.[part] || 0) > 0);
  if (list.length < 5) return [];
  return pick(list, (t, rand) => partShare(t, part) * Math.log2(2 + stat(t).h[part]) + affinity(t) + rand() * 0.6, n, today() + part);
}

export function mostPlayed(n = 50) {
  return allTracks().filter(t => stat(t).plays > 0).sort((a, b) => stat(b).plays - stat(a).plays).slice(0, n);
}

export function recentlyAdded(n = 50) {
  return allTracks().sort((a, b) => b.addedAt - a.addedAt).slice(0, n);
}

/** Canciones que nunca has escuchado o que llevas más de un mes sin poner (salvo las que sueles saltar). */
export function rediscover(n = 40) {
  const limit = Date.now() - 30 * DAY;
  return pick(allTracks().filter(t => stat(t).last < limit && affinity(t) >= 0.3), (t, rand) => rand() + affinity(t), n, today() + 7);
}

/** Canciones con un ambiente o un género, ordenadas por lo que más te gusta. */
export const byMood = mood => allTracks().filter(t => (t.moods || []).includes(mood));
export const byGenre = genre => allTracks().filter(t => (t.genres || []).some(g => low(g) === low(genre)));
export const moodMix = (mood, n = 60) => pick(byMood(mood), (t, rand) => affinity(t) * 2 + (isFav(t.id) ? 0.5 : 0) + rand(), n, today() + mood.length);

/** Ambientes y géneros presentes en la biblioteca, con cuántas canciones tiene cada uno. */
export function tagCounts() {
  const moods = new Map(), genres = new Map();
  for (const t of allTracks()) {
    for (const m of t.moods || []) moods.set(m, (moods.get(m) || 0) + 1);
    for (const g of t.genres || []) genres.set(g, (genres.get(g) || 0) + 1);
  }
  const sort = m => [...m].sort((a, b) => b[1] - a[1]);
  return { moods: sort(moods), genres: sort(genres) };
}

/**
 * Radio a partir de una canción: mismos artistas, géneros y ambiente parecidos, época cercana,
 * canciones que sueles escuchar después de ella y, en general, las que no sueles saltar.
 */
export function songRadio(seed, n = 40) {
  const mine = new Set(artistsOf(seed));
  const after = S.trans[seed.id] || {};
  const rest = allTracks().filter(t => t.id !== seed.id);
  const list = pick(rest, (t, rand) => {
    let s = rand() * 1.2 + (affinity(t) - 0.5) * 1.5;
    if (artistsOf(t).some(a => mine.has(a))) s += 2.2;
    s += 2 * overlap(seed.genres, t.genres) + 2 * overlap(seed.moods, t.moods);
    if (seed.year && t.year && Math.abs(seed.year - t.year) <= 5) s += 0.7;
    s += Math.min(2, 0.7 * (after[t.id] || 0) + 0.4 * (S.trans[t.id]?.[seed.id] || 0));
    if (isFav(t.id)) s += 0.3;
    return s;
  }, n - 1, Math.floor(Math.random() * 1e9));
  return [seed, ...list];
}

export function summary() {
  const tracks = allTracks();
  let seconds = 0, plays = 0, skips = 0;
  const artists = new Map();
  for (const t of tracks) {
    const s = stat(t);
    skips += s.skips || 0;
    if (!s.plays) continue;
    plays += s.plays;
    seconds += s.plays * (t.duration || 0);
    for (const a of artistsOf(t)) artists.set(a, (artists.get(a) || 0) + s.plays);
  }
  return {
    plays, skips, hours: seconds / 3600,
    topArtists: [...artists].sort((a, b) => b[1] - a[1]).slice(0, 5),
    topTracks: mostPlayed(5),
  };
}
