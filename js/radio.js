// Radio Browser (https://api.radio-browser.info): directorio libre y comunitario de emisoras.
// Normas de uso que se siguen aquí (documentación oficial del servicio):
//   · elegir un servidor de la lista que da all.api.radio-browser.info y, si falla, pasar al siguiente;
//   · avisar de cada clic con /json/url/{stationuuid} cuando el usuario empieza a escuchar una emisora;
//   · no cargar más de lo necesario: caché en memoria y en el dispositivo, pocas peticiones a la vez.
// No hay ningún dato inventado: todo lo que se muestra de una emisora sale de su ficha en el directorio.
import * as db from './db.js';

const FALLBACK = ['https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info', 'https://fi1.api.radio-browser.info'];
let servers = null;
let serverIdx = 0;

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function serverList() {
  if (servers) return servers;
  try {
    const r = await fetch('https://all.api.radio-browser.info/json/servers', { signal: AbortSignal.timeout?.(6000) });
    const list = [...new Set((await r.json()).map(x => x.name).filter(n => /^[a-z0-9.-]+\.api\.radio-browser\.info$/.test(n)))].map(n => 'https://' + n);
    servers = list.length ? shuffle(list) : FALLBACK.slice();
  } catch { servers = FALLBACK.slice(); }
  for (const f of FALLBACK) if (!servers.includes(f)) servers.push(f);
  return servers;
}

// ----------------------------------------------------------- peticiones
const mem = new Map();          // url -> {at, data}
const inflight = new Map();     // url -> Promise
let active = 0;
const waiting = [];
const MAX_ACTIVE = 3;
const slot = () => (active < MAX_ACTIVE ? (active++, Promise.resolve()) : new Promise(r => waiting.push(r)));
const release = () => { const next = waiting.shift(); if (next) next(); else active--; };

export const MIN = 60000, HOUR = 3600000, DAY = 86400000;

/** GET a la API con caché. `ttl` en ms (0: sin caché); las de una hora o más también se guardan en el dispositivo. */
export async function get(path, params = {}, { ttl = 10 * MIN, signal } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
  const key = `${path}?${qs}`;
  const hit = mem.get(key);
  if (ttl && hit && Date.now() - hit.at < ttl) return hit.data;
  if (ttl >= HOUR) {
    const saved = await db.get('kv', 'rbcache:' + key).catch(() => null);
    if (saved && Date.now() - saved.at < ttl) { mem.set(key, saved); return saved.data; }
  }
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    await slot();
    try {
      const list = await serverList();
      let lastErr;
      for (let n = 0; n < list.length; n++) {
        const base = list[(serverIdx + n) % list.length];
        if (signal?.aborted) throw new DOMException('Cancelada', 'AbortError');
        try {
          const r = await fetch(`${base}/json${path}${qs.size ? '?' + qs : ''}`, { signal });
          if (r.status === 429) throw Object.assign(new Error('Radio Browser limita las peticiones; prueba en un momento'), { limit: true });
          if (!r.ok) throw new Error(`Radio Browser respondió ${r.status}`);
          const data = await r.json();
          serverIdx = (serverIdx + n) % list.length;   // el que ha funcionado queda como preferido
          const rec = { at: Date.now(), data };
          if (ttl) mem.set(key, rec);
          if (ttl >= HOUR) db.put('kv', 'rbcache:' + key, rec).catch(() => {});
          return data;
        } catch (e) {
          if (e.name === 'AbortError' || e.limit) throw e;
          lastErr = e;
        }
      }
      throw lastErr || new Error('No se pudo contactar con Radio Browser');
    } finally { release(); inflight.delete(key); }
  })();
  inflight.set(key, job);
  return job;
}

// ------------------------------------------------------------- emisoras
const audio = typeof Audio !== 'undefined' ? new Audio() : null;
const can = type => !!audio?.canPlayType(type);
const HLS_OK = can('application/vnd.apple.mpegurl');
/** ¿Puede sonar en este navegador? Solo HTTPS (la app va por HTTPS) y formatos que el navegador declara. */
export function playableRaw(s) {
  const url = s.url_resolved || s.url || '';
  if (!url.startsWith('https://')) return false;
  if (s.hls && !HLS_OK) return false;
  const c = String(s.codec || '').toUpperCase();
  if (/H\.?264|FLV|VP\d|THEORA/.test(c)) return false;   // vídeo
  if (c.startsWith('OGG') && !can('audio/ogg')) return false;
  if (c.includes('AAC') && !(can('audio/aac') || can('audio/mp4'))) return false;
  return true;
}
const list = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
const validGeo = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

/** Ficha de emisora tal y como la usa Fiora (también es una «pista» para el reproductor). */
export function toStation(s) {
  const lat = num(s.geo_lat), lon = num(s.geo_long);
  const tags = list(s.tags).map(t => t.toLowerCase()).slice(0, 12);
  const cc = String(s.countrycode || '').toUpperCase();
  return {
    id: 'radio:' + s.stationuuid, uuid: s.stationuuid, radio: true,
    title: String(s.name || 'Emisora').trim(), url: s.url_resolved || s.url,
    artist: [countryName(cc) || s.country, tags.slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    album: 'Radio en directo',
    coverUrl: String(s.favicon || '').startsWith('https://') ? s.favicon : '',
    cc, state: String(s.state || '').trim(), langs: list(s.language).slice(0, 4), tags,
    codec: s.codec && s.codec !== 'UNKNOWN' ? s.codec : '', bitrate: +s.bitrate || 0, hls: !!+s.hls,
    homepage: String(s.homepage || '').startsWith('http') ? s.homepage : '',
    votes: +s.votes || 0, clicks: +s.clickcount || 0, trend: +s.clicktrend || 0,
    ...(validGeo(lat, lon) ? { lat, lon } : {}),
    ...(s.geo_distance != null ? { dist: +s.geo_distance } : {}),
  };
}
/** Ficha mínima para guardar como referencia (favoritos, colecciones): nunca el audio. */
export const ref = st => ({
  uuid: st.uuid, title: st.title, url: st.url, coverUrl: st.coverUrl || '', cc: st.cc || '', state: st.state || '',
  tags: (st.tags || []).slice(0, 6), langs: (st.langs || []).slice(0, 3), codec: st.codec || '', bitrate: st.bitrate || 0, homepage: st.homepage || '',
  ...(st.lat != null ? { lat: st.lat, lon: st.lon } : {}),
});
/** Reconstruye la ficha de reproducción desde una referencia guardada (o desde las emisoras antiguas). */
export function fromRef(r) {
  if (!r) return null;
  const uuid = r.uuid || String(r.id || '').replace(/^radio:/, '');
  const tags = r.tags || [];
  return {
    ...r, id: 'radio:' + uuid, uuid, radio: true, title: r.title || 'Emisora', album: 'Radio en directo',
    artist: r.artist || [countryName(r.cc), tags.slice(0, 2).join(', ')].filter(Boolean).join(' · '), tags, langs: r.langs || [],
  };
}

const dedupe = arr => {
  const seen = new Set(), out = [];
  for (const s of arr) {
    const k1 = s.uuid, k2 = s.url.replace(/[?#].*$/, '').toLowerCase();
    if (seen.has(k1) || seen.has(k2)) continue;
    seen.add(k1); seen.add(k2); out.push(s);
  }
  return out;
};
/** Busca emisoras en el directorio (solo HTTPS, sin las marcadas como caídas) y deja las que pueden sonar aquí. */
export async function search(params = {}, opts = {}) {
  const raw = await get('/stations/search', { hidebroken: 'true', is_https: 'true', limit: 60, ...params }, opts);
  return dedupe(raw.filter(playableRaw).map(toStation));
}
export const byTag = (tag, o = {}) => search({ tag, order: 'clickcount', reverse: 'true', ...o.params }, o);
export const byTags = (tags, o = {}) => Promise.allSettled(tags.slice(0, 4).map(t => byTag(t, { ...o, params: { limit: 30, ...o.params } })))
  .then(rs => { const ok = rs.filter(r => r.status === 'fulfilled').flatMap(r => r.value); if (!ok.length && rs.every(r => r.status === 'rejected')) throw rs[0].reason; return dedupe(ok); });
export const byCountry = (cc, o = {}) => search({ countrycode: cc, order: 'clickcount', reverse: 'true', ...o.params }, o);
/** Emisoras a menos de `km` según las coordenadas que publica el directorio (no todas las tienen). */
export const near = (lat, lon, km = 40, o = {}) => search({ geo_lat: lat, geo_long: lon, geo_distance: Math.round(km * 1000), order: 'clickcount', reverse: 'true', ...o.params }, o);
export const byUuids = async (uuids, o = {}) => (uuids.length ? (await get('/stations/byuuid', { uuids: uuids.slice(0, 100).join(',') }, o)).map(toStation) : []);
/** Las más votadas / con más clics en 24 h / con más subida de clics (datos del directorio, no oyentes). */
export const top = (by = 'votes', o = {}) => search({ order: by, reverse: 'true', limit: 40, ...o.params }, { ttl: HOUR, ...o });
export const random = (params = {}, o = {}) => search({ order: 'random', limit: 30, ...params }, { ttl: 0, ...o });
export async function tags(filter = '', o = {}) {
  const l = await get(`/tags${filter ? '/' + encodeURIComponent(filter) : ''}`, { order: 'stationcount', reverse: 'true', hidebroken: 'true', limit: o.limit || 40 }, { ttl: DAY, ...o });
  return l.filter(t => t.name && t.stationcount > 0).map(t => ({ name: t.name, count: t.stationcount }));
}
export async function countries(o = {}) {
  const l = await get('/countries', { order: 'stationcount', reverse: 'true', hidebroken: 'true' }, { ttl: 7 * DAY, ...o });
  return l.filter(c => /^[A-Z]{2}$/.test(c.iso_3166_1) && c.stationcount > 0).map(c => ({ cc: c.iso_3166_1, name: countryName(c.iso_3166_1) || c.name, count: c.stationcount }));
}

/** Emisoras con coordenadas para el Atlas (las más escuchadas), guardadas un día en el dispositivo. */
export async function geoStations(limit = 1500, o = {}) {
  const key = 'rbgeo:' + limit;
  const saved = await db.get('kv', key).catch(() => null);
  if (saved && Date.now() - saved.at < DAY) return saved.list;
  const raw = await get('/stations/search', { has_geo_info: 'true', hidebroken: 'true', is_https: 'true', order: 'clickcount', reverse: 'true', limit }, { ttl: 0, ...o });
  const list = dedupe(raw.filter(playableRaw).map(toStation)).filter(s => s.lat != null).map(s => ({ ...ref(s), lat: s.lat, lon: s.lon, clicks: s.clicks }));
  db.put('kv', key, { at: Date.now(), list }).catch(() => {});
  return list;
}

const clicked = new Set();
/** Aviso de clic que pide el directorio al empezar a escuchar. Solo envía el identificador de la emisora. */
export function reportClick(uuid) {
  const day = new Date().toDateString();
  if (!uuid || clicked.has(uuid + day)) return;
  clicked.add(uuid + day);
  get(`/url/${encodeURIComponent(uuid)}`, {}, { ttl: 0 }).catch(() => {});
}

// ------------------------------------------------------------- utilidades
let names = null;
export function countryName(cc) {
  if (!cc) return '';
  try { names ||= new Intl.DisplayNames(['es'], { type: 'region' }); return names.of(cc) || cc; } catch { return cc; }
}
/** Bandera (emoji) a partir del código ISO del país. */
export const flag = cc => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map(c => 0x1F1A5 + c.charCodeAt(0))) : '');
const LANG = { english: 'inglés', spanish: 'español', french: 'francés', german: 'alemán', italian: 'italiano', portuguese: 'portugués', japanese: 'japonés', russian: 'ruso', dutch: 'neerlandés', polish: 'polaco', greek: 'griego', turkish: 'turco', arabic: 'árabe', chinese: 'chino', korean: 'coreano', catalan: 'catalán', basque: 'euskera', galician: 'gallego', swedish: 'sueco', norwegian: 'noruego', danish: 'danés', finnish: 'finés', czech: 'checo', hungarian: 'húngaro', romanian: 'rumano', ukrainian: 'ucraniano', hindi: 'hindi', indonesian: 'indonesio', thai: 'tailandés', vietnamese: 'vietnamita', hebrew: 'hebreo', persian: 'persa' };
export const langName = l => LANG[String(l).toLowerCase()] || l;
