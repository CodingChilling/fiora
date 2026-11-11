// Estado en memoria de la app (metadatos); los audios y carátulas viven en IndexedDB.
import * as db from './db.js';

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

export const allTracks = () => [...S.tracks.values()];
export const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
