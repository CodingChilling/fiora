// Emulador de Radio Browser, Openverse e Internet Archive para las pruebas de Explorar.
// Implementa los parámetros documentados que usa la app (stations/search con name, tag, tagList,
// countrycode, language, has_geo_info, geo_lat/geo_long/geo_distance, is_https, hidebroken, order —
// incluido random —, reverse, limit; byuuid; tags; countries; url/{uuid}) sobre emisoras de prueba.
// También sirve el audio: /stream/{uuid}.mp3 (silencio largo) o 404 para las emisoras «rotas».
//   GET /__log            peticiones y clics recibidos
//   GET /__fail?src=x&on=1  hace fallar una fuente (openverse | archive | radio)
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const PORT = +(process.env.PORT || 8767);
const audioLong = fs.readFileSync(here + 'fixtures/silence-long.mp3');
const audioShort = fs.readFileSync(here + 'fixtures/silence-short.mp3');

const hex = n => n.toString(16).padStart(12, '0');
const uuid = i => `5ea1c0de-0000-4000-8000-${hex(i)}`;
// [nombre, país, estado, idioma, etiquetas, lat, lon, votos, clics, tendencia, rota]
const RAW = [
  ['Madrid Jazz Club', 'ES', 'Madrid', 'spanish', 'jazz,smooth jazz', 40.42, -3.70, 900, 300, 12],
  ['Radio Gran Vía', 'ES', 'Madrid', 'spanish', 'pop,hits', 40.43, -3.71, 1200, 800, 40],
  ['Noticias Madrid', 'ES', 'Madrid', 'spanish', 'news,talk', 40.41, -3.69, 500, 200, -3],
  ['Barna Electrònica', 'ES', 'Catalonia', 'catalan', 'electronic,house', 41.39, 2.17, 400, 150, 5],
  ['Flamenco Sur', 'ES', 'Andalusia', 'spanish', 'flamenco,world music', 37.39, -5.98, 300, 90, 2],
  ['Synthwave Ibiza', 'ES', 'Balearic Islands', 'english', 'synthwave,synthpop,retrowave', 38.91, 1.43, 700, 260, 30],
  ['Paris Chanson', 'FR', 'Île-de-France', 'french', 'chanson,jazz', 48.85, 2.35, 800, 420, 18],
  ['FIP Test', 'FR', 'Île-de-France', 'french', 'jazz,eclectic', 48.86, 2.34, 1500, 900, 55],
  ['Lyon Lounge', 'FR', 'Auvergne-Rhône-Alpes', 'french', 'lounge,chillout', 45.76, 4.84, 350, 120, 4],
  ['Berlin Techno', 'DE', 'Berlin', 'german', 'techno,electronic', 52.52, 13.40, 1100, 700, 60],
  ['Berlin Klassik', 'DE', 'Berlin', 'german', 'classical,piano', 52.51, 13.39, 650, 210, 1],
  ['Hamburg Rock', 'DE', 'Hamburg', 'german', 'rock,hard rock', 53.55, 9.99, 600, 330, 8],
  ['Tokyo City Pop', 'JP', 'Tokyo', 'japanese', 'city pop,jpop,pop', 35.68, 139.69, 950, 500, 25],
  ['Tokyo Ambient', 'JP', 'Tokyo', 'japanese', 'ambient,chillout', 35.69, 139.70, 420, 160, 6],
  ['Osaka Jazz', 'JP', 'Osaka', 'japanese', 'jazz,bossa nova', 34.69, 135.50, 380, 140, 3],
  ['NYC Hip Hop', 'US', 'New York', 'english', 'hip hop,rap', 40.71, -74.00, 1300, 990, 70],
  ['NYC Smooth Jazz', 'US', 'New York', 'english', 'smooth jazz,jazz', 40.72, -74.01, 870, 410, 15],
  ['LA Synthpop', 'US', 'California', 'english', 'synthpop,80s,pop', 34.05, -118.24, 720, 380, 11],
  ['Chicago Blues', 'US', 'Illinois', 'english', 'blues,soul', 41.88, -87.63, 560, 230, 9],
  ['Rio Bossa', 'BR', 'Rio de Janeiro', 'portuguese', 'bossa nova,latin', -22.91, -43.17, 610, 260, 7, 'rota'],
  ['São Paulo Samba', 'BR', 'São Paulo', 'portuguese', 'samba,latin', -23.55, -46.63, 590, 240, 6, 'rota'],
  ['Brasil Tropical', 'BR', 'Bahia', 'portuguese', 'tropical,reggae,latin', -12.97, -38.50, 480, 180, 4],
  ['Buenos Aires Tango', 'AR', 'Buenos Aires', 'spanish', 'tango,folk', -34.60, -58.38, 530, 210, 5],
  ['CDMX Cumbia', 'MX', 'Ciudad de México', 'spanish', 'cumbia,latin', 19.43, -99.13, 640, 300, 10],
  ['Lagos Afrobeats', 'NG', 'Lagos', 'english', 'afrobeats,world music', 6.52, 3.38, 450, 200, 20],
  ['Sin Coordenadas FM', 'IT', 'Lazio', 'italian', 'pop,italian', null, null, 300, 100, 1],
  ['Coordenada Cero', 'IT', '', 'italian', 'rock', 0, 0, 200, 50, 0],
  ['Coordenada Imposible', 'GR', '', 'greek', 'folk', 200, 30, 150, 40, 0],
  ['Downtempo Night', 'NL', 'North Holland', 'dutch', 'downtempo,trip-hop,chillout', 52.37, 4.90, 330, 110, 3],
  ['Lo-fi Lluvia', 'ES', 'Galicia', 'spanish', 'lofi,piano,study', 42.88, -8.54, 410, 170, 9],
];
const now = '2026-11-14 10:00:00';
const STATIONS = RAW.map(([name, cc, state, lang, tags, lat, lon, votes, clicks, trend, broken], i) => ({
  changeuuid: uuid(1000 + i), stationuuid: uuid(i + 1), serveruuid: null, name, url: `https://radio.fiora.test/stream/${uuid(i + 1)}.mp3`,
  url_resolved: `https://radio.fiora.test/stream/${uuid(i + 1)}.mp3`, homepage: `https://example.org/${i}`, favicon: '',
  tags, country: cc, countrycode: cc, iso_3166_2: '', state, language: lang, languagecodes: '', votes, lastchangetime: now,
  codec: 'MP3', bitrate: 128, hls: 0, lastcheckok: 1, lastchecktime: now, clickcount: clicks, clicktrend: trend, ssl_error: 0,
  geo_lat: lat, geo_long: lon, has_extended_info: false, _broken: !!broken,
}));
const pub = s => { const { _broken, ...o } = s; return o; };
const fail = { openverse: false, archive: false, radio: false };
const log = { requests: [], clicks: [] };

const km = (a, b, c, d) => { const R = Math.PI / 180; const h = Math.sin((c - a) * R / 2) ** 2 + Math.cos(a * R) * Math.cos(c * R) * Math.sin((d - b) * R / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function search(q) {
  const has = k => q.has(k) && q.get(k) !== '';
  let l = STATIONS.slice();
  const lc = s => String(s || '').toLowerCase();
  if (has('name')) l = l.filter(s => lc(s.name).includes(lc(q.get('name'))));
  if (has('tag')) l = l.filter(s => s.tags.split(',').some(t => t.includes(lc(q.get('tag')))));
  if (has('tagList')) { const want = q.get('tagList').split(',').map(lc); l = l.filter(s => want.every(w => s.tags.split(',').includes(w))); }
  if (has('countrycode')) l = l.filter(s => s.countrycode === q.get('countrycode').toUpperCase());
  if (has('language')) l = l.filter(s => lc(s.language).includes(lc(q.get('language'))));
  if (q.get('has_geo_info') === 'true') l = l.filter(s => s.geo_lat != null && s.geo_long != null);
  if (has('geo_lat') && has('geo_long')) {
    const la = +q.get('geo_lat'), lo = +q.get('geo_long');
    l = l.filter(s => s.geo_lat != null).map(s => ({ ...s, geo_distance: km(la, lo, s.geo_lat, s.geo_long) * 1000 }));
    if (has('geo_distance')) l = l.filter(s => s.geo_distance <= +q.get('geo_distance'));
  }
  const order = q.get('order') || 'name';
  if (order === 'random') {
    // Para poder probar la alternativa ante fallos, en Brasil salen primero las emisoras rotas.
    l = q.get('countrycode') === 'BR' ? l.sort((a, b) => b._broken - a._broken) : l.map(s => [rnd(), s]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  } else {
    const key = { votes: 'votes', clickcount: 'clickcount', clicktrend: 'clicktrend', name: 'name' }[order] || 'name';
    l.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0));
    if (q.get('reverse') === 'true') l.reverse();
  }
  const off = +(q.get('offset') || 0), lim = +(q.get('limit') || 100000);
  return l.slice(off, off + lim).map(pub);
}

// ------------------------------------------------------------- catálogos de música libre
const SONGS = [
  ['Neon Drive', 'Night Runner', ['synthwave', 'electronic']], ['Midnight Grid', 'Retro Pulse', ['synthwave', 'synthpop']],
  ['Velvet Jazz', 'Blue Room Trio', ['jazz', 'lounge']], ['Bossa de Domingo', 'Carioca Duo', ['bossa nova', 'latin']],
  ['Rain Piano', 'Lo Wave', ['lo-fi', 'piano', 'ambient']], ['Deep Focus', 'Calm Lab', ['ambient', 'instrumental']],
  ['Tropical Sun', 'Isla', ['tropical', 'reggae']], ['Rock Engine', 'Gearbox', ['rock', 'hard rock']],
  ['Club Energy', 'DJ Volt', ['edm', 'dance']], ['Soul Sunset', 'Golden Hour', ['soul', 'chillout']],
  ['Folk Morning', 'Wood & Wire', ['folk', 'acoustic']], ['Trip Night', 'Downhill', ['trip-hop', 'downtempo']],
  ['Classical Study', 'Quartet 4', ['classical', 'instrumental']], ['Indie Window', 'The Porch', ['indie', 'indie pop']],
  ['Hip Hop Block', 'MC Test', ['hip hop', 'rap']], ['Metal Storm', 'Iron Test', ['metal', 'rock']],
];
const songJson = (s, i) => ({
  id: `ov-${i}`, title: s[0], creator: s[1], url: `https://media.fiora.test/song/${i}.mp3`, license: 'by', license_version: '4.0',
  foreign_landing_url: `https://example.org/song/${i}`, duration: 20000, genres: s[2], tags: s[2].map(name => ({ name })), filetype: 'mp3',
  source: 'jamendo', thumbnail: '', audio_set: null,
});
function openverse(q) {
  const text = String(q.get('q') || '').toLowerCase();
  const hits = SONGS.map((s, i) => [s, i]).filter(([s]) => (s[0] + ' ' + s[1] + ' ' + s[2].join(' ')).toLowerCase().includes(text));
  const page = +(q.get('page') || 1), size = 4;
  return { result_count: hits.length, page_count: Math.max(1, Math.ceil(hits.length / size)), page, results: hits.slice((page - 1) * size, page * size).map(([s, i]) => songJson(s, i)) };
}
function archive(q) {
  const text = String(q.get('q') || '').toLowerCase();
  const albums = [['jazz-sessions-1959', 'Jazz Sessions 1959', 'Archivo Jazz', ['jazz']], ['netlabel-synth-2026', 'Synth Netlabel 2026', 'Neon Netlabel', ['synthwave', 'electronic']], ['folk-field-recordings', 'Folk Field Recordings', 'Folkways Test', ['folk']], ['classical-public-domain', 'Classical Public Domain', 'PD Orchestra', ['classical']]];
  const docs = albums.filter(a => text.includes('netlabels') || a[3].some(t => text.includes(t)) || text.includes(a[1].toLowerCase().split(' ')[0]))
    .map(([identifier, title, creator]) => ({ identifier, title, creator, year: '2020' }));
  return { responseHeader: { status: 0 }, response: { numFound: docs.length, start: 0, docs } };
}

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body));
};

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname, q = u.searchParams;
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (!p.startsWith('/__') && !p.startsWith('/stream/') && !p.startsWith('/song/')) log.requests.push(p + (u.search || ''));
  if (p === '/__log') return send(res, 200, log);
  if (p === '/__reset') { log.requests = []; log.clicks = []; Object.keys(fail).forEach(k => { fail[k] = false; }); return send(res, 200, { ok: true }); }
  if (p === '/__fail') { fail[q.get('src')] = q.get('on') === '1'; return send(res, 200, fail); }
  if (p.startsWith('/stream/')) {
    const id = p.slice(8).replace(/\.mp3$/, '');
    const st = STATIONS.find(s => s.stationuuid === id);
    if (!st || st._broken) return send(res, 404, 'stream caído', 'text/plain');
    return send(res, 200, audioLong, 'audio/mpeg');
  }
  if (p.startsWith('/song/')) return send(res, 200, audioShort, 'audio/mpeg');
  // Radio Browser
  if (p.startsWith('/json/')) {
    if (fail.radio) return send(res, 503, { error: 'caído para la prueba' });
    if (p === '/json/servers') return send(res, 200, [{ ip: '127.0.0.1', name: 'de1.api.radio-browser.info' }]);
    if (p === '/json/stations/search') return send(res, 200, search(q));
    if (p === '/json/stations/byuuid') { const ids = (q.get('uuids') || '').split(','); return send(res, 200, STATIONS.filter(s => ids.includes(s.stationuuid)).map(pub)); }
    if (p.startsWith('/json/url/')) { const id = decodeURIComponent(p.slice(10)); log.clicks.push(id); const s = STATIONS.find(x => x.stationuuid === id); return send(res, 200, { ok: 'true', message: 'retrieved station url', stationuuid: id, name: s?.name || '', url: s?.url || '' }); }
    if (p.startsWith('/json/tags')) {
      const filter = decodeURIComponent(p.slice(11) || '').toLowerCase();
      const m = new Map(); for (const s of STATIONS) for (const t of s.tags.split(',')) m.set(t, (m.get(t) || 0) + 1);
      const l = [...m].filter(([t]) => !filter || t.includes(filter)).sort((a, b) => b[1] - a[1]).map(([name, stationcount]) => ({ name, stationcount }));
      return send(res, 200, l.slice(0, +(q.get('limit') || 1000)));
    }
    if (p === '/json/countries') {
      const m = new Map(); for (const s of STATIONS) m.set(s.countrycode, (m.get(s.countrycode) || 0) + 1);
      return send(res, 200, [...m].sort((a, b) => b[1] - a[1]).map(([cc, n]) => ({ name: cc, iso_3166_1: cc, stationcount: n })));
    }
    return send(res, 404, { error: 'no implementado: ' + p });
  }
  // Openverse
  if (p === '/v1/audio/') { if (fail.openverse) return send(res, 500, { detail: 'caído para la prueba' }); return send(res, 200, openverse(q)); }
  // Internet Archive
  if (p === '/advancedsearch.php') { if (fail.archive) return send(res, 503, 'caído'); return send(res, 200, archive(q)); }
  if (p.startsWith('/services/img/')) return send(res, 404, '');
  send(res, 404, { error: 'no implementado: ' + p });
}).listen(PORT, () => console.log('Emulador de Radio Browser y catálogos en :' + PORT));
