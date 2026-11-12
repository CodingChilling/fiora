// Estado en memoria de la app (metadatos); los audios y carátulas viven en IndexedDB.
import * as db from './db.js';
import { splitArtists, splitGenres } from './tags.js';

export const S = {
  tracks: new Map(),   // id -> pista
  playlists: [],       // {id, name, trackIds, updatedAt, deleted}
  favs: {},            // id -> {on, at}
  stats: {},           // id -> {plays, last}
  stations: [],        // radios guardadas
  edits: {},           // id -> {at, f: {campos editados a mano o por IA}}
  trans: {},           // id -> {idSiguiente: veces}  (qué suena después de qué)
  hist: { days: {}, hours: Array(24).fill(0), week: Array(7).fill(0) },   // escuchas por día, hora y día de la semana
  settings: {},        // {buckets, uploadBucket, shrink, volume, ...}
};

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, e => fn(e.detail));

export async function load() {
  const [tracks, playlists, favs, stats, stations, settings, edits, trans, hist] = await Promise.all([
    db.all('tracks'), db.all('playlists'),
    db.get('kv', 'favs'), db.get('kv', 'stats'), db.get('kv', 'stations'), db.get('kv', 'settings'),
    db.get('kv', 'edits'), db.get('kv', 'trans'), db.get('kv', 'hist'),
  ]);
  if (hist) S.hist = { days: hist.days || {}, hours: hist.hours || Array(24).fill(0), week: hist.week || Array(7).fill(0) };
  S.edits = edits || {};
  S.trans = trans || {};
  S.tracks = new Map(tracks.map(t => [t.id, t]));
  // Pistas guardadas por versiones anteriores: separa sus artistas una sola vez.
  for (const t of tracks) {
    let changed = false;
    if (!t.artists) {
      const list = splitArtists(t.artist);
      t.artists = list.length ? list : ['Artista desconocido'];
      t.artist = t.artists.join(', ');
      changed = true;
    }
    if (!t.genres) { t.genres = splitGenres(t.genre); t.genre = t.genres[0] || ''; changed = true; }
    if (!t.moods) { t.moods = []; changed = true; }
    if (applyEdit(t)) changed = true;
    if (changed) db.put('tracks', t.id, t);
  }
  S.playlists = playlists;
  S.favs = favs || {};
  S.stats = stats || {};
  S.stations = stations || [];
  S.settings = settings || {};
}

/** Guarda una clave de estado. `sync` marca que hay cambios que subir a la nube. */
export function saveKV(name, sync = true) {
  if (sync && name !== 'settings') emit('dirty');
  return db.put('kv', name, S[name]);
}

/** Géneros predefinidos que ofrece el editor (se pueden añadir más en el modo desarrollador). */
export const GENRES = ['Pop', 'Indie Pop', 'Synthpop', 'Dream Pop', 'K-Pop', 'Rock', 'Indie Rock', 'Alternative Rock', 'Hard Rock', 'Punk', 'Post-Punk',
  'Metal', 'Shoegaze', 'Grunge', 'Folk', 'Indie Folk', 'Singer-Songwriter', 'Country', 'Blues', 'Jazz', 'Soul', 'Funk', 'R&B', 'Hip Hop', 'Rap', 'Trap',
  'Reggaeton', 'Latin Pop', 'Urbano Latino', 'Flamenco', 'Flamenco Pop', 'Rumba', 'Copla', 'Bolero', 'Salsa', 'Bachata', 'Cumbia', 'Tango', 'Bossa Nova',
  'Reggae', 'Ska', 'Electronic', 'House', 'Techno', 'Trance', 'Drum and Bass', 'Dubstep', 'Ambient', 'Lo-Fi', 'Chillout', 'Disco', 'Dance',
  'Classical', 'Opera', 'Soundtrack', 'Instrumental', 'World', 'Afrobeats', 'Gospel', 'Experimental', 'Rock en Español', 'Pop en Español', 'Indie Español'];
/** Géneros predefinidos, propios y ya usados en la biblioteca, sin repetir y en orden alfabético. */
export function genreOptions() {
  const seen = new Map();
  const add = g => { const k = String(g).trim().toLowerCase(); if (k && !seen.has(k)) seen.set(k, String(g).trim()); };
  GENRES.forEach(add);
  (S.settings.genrePresets || []).forEach(add);
  for (const t of S.tracks.values()) (t.genres || []).forEach(add);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

/** Lo que transmite una canción: vocabulario cerrado para que las mezclas sean coherentes. */
export const MOODS = ['alegre', 'melancólica', 'enérgica', 'relajada', 'oscura', 'romántica', 'épica', 'nostálgica',
  'agresiva', 'bailable', 'íntima', 'soñadora', 'festiva', 'triste', 'motivadora'];

/** Aplica a la pista los metadatos editados (a mano o por IA). Devuelve true si cambió algo. */
export function applyEdit(t) {
  const e = S.edits[t.id];
  if (!e || t.editAt === e.at) return false;
  Object.assign(t, e.f);
  if (e.f.artists) t.artist = t.artists.join(', ');
  if (e.f.genres) t.genre = t.genres[0] || '';
  t.editAt = e.at;
  return true;
}

/** Guarda una edición de metadatos; se sincroniza con la cuenta y la nube como el resto de datos. */
export async function setEdit(t, fields) {
  S.edits[t.id] = { at: Date.now(), f: { ...(S.edits[t.id]?.f || {}), ...fields } };
  await saveKV('edits');
  if (S.tracks.has(t.id)) await saveTrack(t); else applyEdit(t);
}

export async function saveTrack(t) {
  applyEdit(t);
  if (!t.genres) t.genres = splitGenres(t.genre);
  if (!t.moods) t.moods = [];
  S.tracks.set(t.id, t);
  commonArtist = null;
  await db.put('tracks', t.id, t);
}

export const isFav = id => !!S.favs[id]?.on;
export function toggleFav(id) {
  S.favs[id] = { on: !isFav(id), at: Date.now() };
  saveKV('favs');
  emit('favs', id);
  return S.favs[id].on;
}

/** Fecha local como AAAA-MM-DD. */
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Franja del día: 0 madrugada, 1 mañana, 2 tarde, 3 noche. */
export const daypart = (d = new Date()) => { const h = d.getHours(); return h < 6 ? 0 : h < 12 ? 1 : h < 19 ? 2 : 3; };

const statOf = id => S.stats[id] || (S.stats[id] = { plays: 0, last: 0 });
/** Escucha real (más de 30 s o la mitad de la canción). */
export function countPlay(id) {
  const s = statOf(id);
  s.plays++;
  s.last = Date.now();
  (s.h ||= [0, 0, 0, 0])[daypart()]++;
  saveKV('stats');
  // Historial para las estadísticas: [escuchas, segundos] por día, y recuentos por hora y día de la semana.
  const now = new Date(), day = dayKey(now), secs = Math.round(S.tracks.get(id)?.duration || 0);
  const d = S.hist.days[day] || (S.hist.days[day] = [0, 0]);
  d[0]++; d[1] += secs;
  S.hist.hours[now.getHours()]++;
  S.hist.week[(now.getDay() + 6) % 7]++;          // 0 = lunes
  const keys = Object.keys(S.hist.days);
  if (keys.length > 400) for (const k of keys.sort().slice(0, keys.length - 400)) delete S.hist.days[k];
  saveKV('hist');
}
/** La canción se saltó nada más empezar. */
export function countSkip(id) { const s = statOf(id); s.skips = (s.skips || 0) + 1; saveKV('stats'); }
/** La canción se escuchó hasta el final. */
export function countDone(id) { const s = statOf(id); s.done = (s.done || 0) + 1; saveKV('stats'); }
/** Tras `a` se escuchó `b`: sirve para saber qué canciones van bien juntas. */
export function countNext(a, b) {
  const m = S.trans[a] || (S.trans[a] = {});
  m[b] = (m[b] || 0) + 1;
  const keys = Object.keys(m);
  if (keys.length > 40) for (const k of keys.sort((x, y) => m[y] - m[x]).slice(30)) delete m[k];
  saveKV('trans');
}

export const livePlaylists = () => S.playlists.filter(p => !p.deleted);
export async function savePlaylist(p) {
  p.updatedAt = Date.now();
  if (!S.playlists.includes(p)) S.playlists.push(p);
  await db.put('playlists', p.id, p);
  emit('dirty');
  emit('playlists');
}

/** Artistas de una pista, como lista. */
export const artistsOf = t => (t.artists?.length ? t.artists : [t.artist || 'Artista desconocido']);

// Artista común de cada álbum sin etiqueta "artista del álbum": título en minúsculas -> artista.
let commonArtist = null;
function buildCommonArtists() {
  const groups = new Map();
  for (const t of S.tracks.values()) {
    if (!t.album || t.albumArtist) continue;
    const k = t.album.toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(artistsOf(t));
  }
  commonArtist = new Map();
  for (const [k, lists] of groups) {
    // artistas que salen en todas las canciones; si hay varios, el que más veces va en primer lugar
    const shared = lists[0].filter(a => lists.every(l => l.includes(a)));
    if (!shared.length) continue;
    const firsts = a => lists.filter(l => l[0] === a).length;
    commonArtist.set(k, shared.reduce((best, a) => (firsts(a) > firsts(best) ? a : best)));
  }
}
bus.addEventListener('library', () => { commonArtist = null; });

/**
 * Artista al que pertenece el álbum: la etiqueta "artista del álbum"; si falta, el artista que
 * comparten todas las canciones de ese álbum; y si no hay ninguno, el primero de la canción.
 */
export function albumArtistOf(t) {
  if (t.albumArtist) return t.albumArtist;
  if (!commonArtist) buildCommonArtists();
  return (t.album && S.tracks.has(t.id) && commonArtist.get(t.album.toLowerCase())) || artistsOf(t)[0];
}

export const allTracks = () => [...S.tracks.values()];
export const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
