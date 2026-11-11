// Recomendaciones calculadas en el dispositivo a partir de tus escuchas (nada sale de aquí).
import { S, allTracks, isFav, artistsOf } from './store.js';

const DAY = 864e5;

// Generador pseudoaleatorio con semilla: la mezcla del día no cambia cada vez que abres la app.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const today = () => Math.floor(Date.now() / DAY);
const stat = t => S.stats[t.id] || { plays: 0, last: 0 };

function pick(tracks, score, n, seed) {
  const rand = rng(seed);
  return tracks.map(t => [score(t, rand), t]).sort((a, b) => b[0] - a[0]).slice(0, n).map(x => x[1]);
}

/** Mezcla diaria: favoritas y habituales, con hueco para lo que llevas tiempo sin oír. */
export function dailyMix(n = 40) {
  const now = Date.now();
  return pick(allTracks(), (t, rand) => {
    const s = stat(t);
    const rest = s.last ? Math.min((now - s.last) / DAY, 30) / 30 : 0.6;
    return (isFav(t.id) ? 1 : 0) + Math.log2(1 + s.plays) * 0.5 + rest + rand() * 2.2;
  }, n, today());
}

export function mostPlayed(n = 50) {
  return allTracks().filter(t => stat(t).plays > 0).sort((a, b) => stat(b).plays - stat(a).plays).slice(0, n);
}

export function recentlyAdded(n = 50) {
  return allTracks().sort((a, b) => b.addedAt - a.addedAt).slice(0, n);
}

/** Canciones que nunca has escuchado o que llevas más de un mes sin poner. */
export function rediscover(n = 40) {
  const limit = Date.now() - 30 * DAY;
  return pick(allTracks().filter(t => stat(t).last < limit), (t, rand) => rand() + (stat(t).plays ? 0.3 : 0), n, today() + 7);
}

/** Radio a partir de una canción: mismo artista, mismo género y época parecida. */
export function songRadio(seed, n = 40) {
  const g = (seed.genre || '').toLowerCase();
  const mine = new Set(artistsOf(seed));
  const rest = allTracks().filter(t => t.id !== seed.id);
  const list = pick(rest, (t, rand) => {
    let s = rand() * 1.5;
    if (artistsOf(t).some(a => mine.has(a))) s += 2;
    if (g && (t.genre || '').toLowerCase() === g) s += 1.5;
    if (seed.year && t.year && Math.abs(seed.year - t.year) <= 5) s += 0.7;
    if (isFav(t.id)) s += 0.3;
    return s;
  }, n - 1, Math.floor(Math.random() * 1e9));
  return [seed, ...list];
}

export function summary() {
  const tracks = allTracks();
  let seconds = 0, plays = 0;
  const artists = new Map();
  for (const t of tracks) {
    const s = stat(t);
    if (!s.plays) continue;
    plays += s.plays;
    seconds += s.plays * (t.duration || 0);
    for (const a of artistsOf(t)) artists.set(a, (artists.get(a) || 0) + s.plays);
  }
  return {
    plays, hours: seconds / 3600,
    topArtists: [...artists].sort((a, b) => b[1] - a[1]).slice(0, 5),
    topTracks: mostPlayed(5),
  };
}
