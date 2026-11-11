// Estado en memoria de la app (metadatos); los audios y carátulas viven en IndexedDB.
import * as db from './db.js';
import { splitArtists } from './tags.js';

export const S = {
  tracks: new Map(),   // id -> pista
  playlists: [],       // {id, name, trackIds, updatedAt, deleted}
  favs: {},            // id -> {on, at}
  stats: {},           // id -> {plays, last}
  stations: [],        // radios guardadas
  settings: {},        // {buckets, uploadBucket, shrink, volume, ...}
};

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, e => fn(e.detail));

export async function load() {
  const [tracks, playlists, favs, stats, stations, settings] = await Promise.all([
    db.all('tracks'), db.all('playlists'),
    db.get('kv', 'favs'), db.get('kv', 'stats'), db.get('kv', 'stations'), db.get('kv', 'settings'),
  ]);
  S.tracks = new Map(tracks.map(t => [t.id, t]));
  // Pistas guardadas por versiones anteriores: separa sus artistas una sola vez.
  for (const t of tracks) {
    if (t.artists) continue;
    const list = splitArtists(t.artist);
    t.artists = list.length ? list : ['Artista desconocido'];
    t.artist = t.artists.join(', ');
    db.put('tracks', t.id, t);
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

export async function saveTrack(t) {
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

export function countPlay(id) {
  const s = S.stats[id] || (S.stats[id] = { plays: 0, last: 0 });
  s.plays++;
  s.last = Date.now();
  saveKV('stats');
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
