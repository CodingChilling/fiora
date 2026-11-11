// Letras: primero las incrustadas en el archivo, después la caché, y por último LRCLIB (gratuito, sin clave).
import * as db from './db.js';

const API = 'https://lrclib.net/api';

/** Convierte texto LRC en [{t, text}] ordenado; null si no tiene marcas de tiempo. */
export function parseLrc(text) {
  const out = [];
  for (const line of (text || '').split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text: words });
  }
  return out.length ? out.sort((a, b) => a.t - b.t) : null;
}

const pack = (synced, plain) => {
  const lines = parseLrc(synced);
  return { synced: lines, plain: lines ? null : (plain || synced || '').trim() || null };
};

export async function getLyrics(t) {
  if (!t || t.radio) return { synced: null, plain: null };
  if (t.lyrics) return pack(t.lyrics, t.lyrics);
  const key = 'lyr:' + t.id;
  const cached = await db.get('kv', key).catch(() => null);
  if (cached) return pack(cached.synced, cached.plain);
  if (!navigator.onLine) return { synced: null, plain: null, offline: true };

  let hit = null;
  try {
    const p = new URLSearchParams({ track_name: t.title, artist_name: t.artist || '' });
    if (t.album) p.set('album_name', t.album);
    if (t.duration) p.set('duration', Math.round(t.duration));
    let r = await fetch(`${API}/get?${p}`);
    if (r.ok) hit = await r.json();
    else {
      r = await fetch(`${API}/search?${new URLSearchParams({ track_name: t.title, artist_name: t.artist || '' })}`);
      if (r.ok) {
        const list = await r.json();
        hit = list.find(x => x.syncedLyrics && (!t.duration || Math.abs(x.duration - t.duration) < 4))
          || list.find(x => !t.duration || Math.abs(x.duration - t.duration) < 4) || null;
      }
    }
  } catch { return { synced: null, plain: null, offline: !navigator.onLine, failed: true }; }

  const rec = { synced: hit?.syncedLyrics || '', plain: hit?.plainLyrics || '' };
  await db.put('kv', key, rec).catch(() => {});
  return pack(rec.synced, rec.plain);
}
