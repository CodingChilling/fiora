// Lógica de descubrimiento compartida por Explorar (sin interfaz):
// ambientes, taxonomía de géneros, ciudades con su hora local real, selección aleatoria de emisoras
// (Ruleta y Sorpréndeme), similitud entre emisoras (Radar) y el mezclador de descubrimiento.
// Todo se basa en metadatos reales (etiquetas, país, idioma, coordenadas); cuando una regla es
// aproximada, se dice en la interfaz con el texto que exporta este módulo.
import * as radio from './radio.js';

// ----------------------------------------------------------------- ambientes
// `music`: etiquetas para buscar en los catálogos libres (se comprueba que el resultado las lleve).
// `radio`: etiquetas del directorio de emisoras. Se pueden cambiar aquí sin tocar nada más.
export const AMBIENTS = [
  { id: 'neon', name: 'Noches de neón', desc: 'Sintetizadores, luces de ciudad y pulso electrónico.', music: ['synthwave', 'synthpop', 'electronic'], radio: ['synthwave', 'synthpop', 'retrowave', 'electronic'], colors: ['#ff3ea5', '#6a2cff', '#0b0620'], shape: 'grid' },
  { id: 'verano', name: 'Verano eterno', desc: 'Ritmos cálidos para que no se acabe el sol.', music: ['tropical', 'reggae', 'latin'], radio: ['tropical', 'reggae', 'summer', 'salsa'], colors: ['#ffb347', '#ff5f6d', '#1fc8db'], shape: 'sun' },
  { id: 'domingo', name: 'Domingo tranquilo', desc: 'Acústico y sin prisa, para empezar despacio.', music: ['acoustic', 'folk', 'indie'], radio: ['acoustic', 'folk', 'easy listening'], colors: ['#f6d5a8', '#9bc1bc', '#2f4858'], shape: 'waves' },
  { id: 'cafe', name: 'Café parisino', desc: 'Chanson, jazz y bossa nova de mesa junto a la ventana.', music: ['jazz', 'chanson', 'bossa nova'], radio: ['chanson', 'jazz', 'bossa nova'], colors: ['#c08552', '#f3e9dc', '#5e3023'], shape: 'circles' },
  { id: 'viaje', name: 'Viaje nocturno', desc: 'Downtempo y trip-hop para la carretera de noche.', music: ['downtempo', 'trip-hop', 'chillout'], radio: ['downtempo', 'trip-hop', 'chillout'], colors: ['#1b2a49', '#465881', '#00c9b1'], shape: 'road' },
  { id: 'energia', name: 'Energía máxima', desc: 'Pista de baile, guitarras y BPM altos.', music: ['edm', 'dance', 'rock'], radio: ['edm', 'dance', 'techno', 'hard rock'], colors: ['#ff0844', '#ffb199', '#200122'], shape: 'bolt' },
  { id: 'lluvia', name: 'Lluvia y nostalgia', desc: 'Lo-fi, piano y canciones de otro tiempo.', music: ['lo-fi', 'piano', 'ambient'], radio: ['lofi', 'piano', 'oldies'], colors: ['#5f7a8a', '#a3b8c2', '#1c2833'], shape: 'rain' },
  { id: 'atardecer', name: 'Atardecer', desc: 'Soul, lounge y luz dorada.', music: ['soul', 'chillout', 'lounge'], radio: ['lounge', 'soul', 'chillout'], colors: ['#ff7e5f', '#feb47b', '#3a1c71'], shape: 'sun' },
  { id: 'foco', name: 'Concentración profunda', desc: 'Ambient, clásica e instrumental sin distracciones.', music: ['ambient', 'classical', 'instrumental'], radio: ['ambient', 'classical', 'instrumental', 'study'], colors: ['#134e5e', '#71b280', '#0b1d26'], shape: 'rings' },
  { id: 'medianoche', name: 'Medianoche', desc: 'Jazz suave, blues y ambient para las horas quietas.', music: ['jazz', 'ambient', 'blues'], radio: ['smooth jazz', 'blues', 'ambient'], colors: ['#0f0c29', '#302b63', '#7f7fd5'], shape: 'moon' },
];
export const ambient = id => AMBIENTS.find(a => a.id === id);

/** Portada generada (SVG) de un ambiente: degradado de su paleta y una forma propia. Sin fotos de terceros. */
export function ambientArt(a, uid = a.id) {
  const [c1, c2, c3] = a.colors;
  const shapes = {
    grid: `<g stroke="${c1}" stroke-opacity=".55" stroke-width="1.2">${Array.from({ length: 9 }, (_, i) => `<line x1="${-60 + i * 40}" y1="200" x2="${100 + (i - 4) * 9}" y2="118"/>`).join('')}${[132, 146, 164, 188].map(y => `<line x1="0" y1="${y}" x2="200" y2="${y}"/>`).join('')}</g><circle cx="100" cy="92" r="34" fill="url(#s${uid})"/>`,
    sun: `<circle cx="140" cy="70" r="40" fill="${c1}" opacity=".9"/><circle cx="140" cy="70" r="62" fill="${c1}" opacity=".2"/>`,
    waves: [0, 1, 2, 3].map(i => `<path d="M0 ${120 + i * 18} q25 -14 50 0 t50 0 t50 0 t50 0" fill="none" stroke="${c1}" stroke-opacity="${0.7 - i * 0.12}" stroke-width="5"/>`).join(''),
    circles: [[60, 70, 30], [120, 110, 46], [160, 50, 20]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c2}" stroke-opacity=".6" stroke-width="3"/>`).join(''),
    road: `<path d="M70 200 L98 100 L102 100 L130 200 Z" fill="${c3}" opacity=".7"/>${[110, 140, 175].map((y, i) => `<rect x="${99 - i}" y="${y}" width="${2 + i * 2}" height="${8 + i * 4}" fill="${c3 === '#00c9b1' ? '#fff' : c2}" opacity=".8"/>`).join('')}<circle cx="100" cy="96" r="3" fill="#fff"/>`,
    bolt: `<path d="M110 20 L60 110 L96 110 L84 180 L140 84 L104 84 Z" fill="${c2}" opacity=".9"/>`,
    rain: Array.from({ length: 22 }, (_, i) => `<line x1="${(i * 37) % 200}" y1="${(i * 53) % 160}" x2="${(i * 37) % 200 - 8}" y2="${(i * 53) % 160 + 26}" stroke="${c2}" stroke-opacity=".55" stroke-width="2"/>`).join(''),
    rings: [24, 44, 64, 84].map((r, i) => `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${c2}" stroke-opacity="${0.75 - i * 0.15}" stroke-width="2"/>`).join(''),
    moon: `<circle cx="138" cy="62" r="30" fill="#fdf6d8"/><circle cx="152" cy="54" r="28" fill="${c1}"/>${[[30, 40], [70, 24], [90, 70], [40, 120], [170, 140]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="#fff" opacity=".8"/>`).join('')}`,
  };
  return `<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>
    <linearGradient id="g${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset=".55" stop-color="${c2}" stop-opacity=".85"/><stop offset="1" stop-color="${c3}"/></linearGradient>
    <radialGradient id="s${uid}"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="${c1}" stop-opacity="0"/></radialGradient></defs>
    <rect width="200" height="200" fill="url(#g${uid})"/>${shapes[a.shape] || ''}<rect width="200" height="200" fill="url(#g${uid})" opacity=".18"/></svg>`;
}

// ------------------------------------------------------- taxonomía de géneros
// `rb`: etiqueta en el directorio de emisoras · `q`: término para los catálogos libres.
export const GENRES = [
  { id: 'jazz', name: 'Jazz', rb: 'jazz', q: 'jazz', related: ['blues', 'soul', 'classical', 'latin'], sub: ['smooth jazz', 'bossa nova', 'swing', 'bebop', 'jazz fusion', 'nu jazz'] },
  { id: 'rock', name: 'Rock', rb: 'rock', q: 'rock', related: ['metal', 'indie', 'blues', 'pop'], sub: ['hard rock', 'classic rock', 'alternative', 'punk', 'progressive rock'] },
  { id: 'electronic', name: 'Electrónica', rb: 'electronic', q: 'electronic', related: ['ambient', 'pop', 'hiphop'], sub: ['house', 'techno', 'trance', 'drum and bass', 'synthwave', 'downtempo'] },
  { id: 'classical', name: 'Clásica', rb: 'classical', q: 'classical', related: ['jazz', 'ambient', 'folk'], sub: ['baroque', 'opera', 'piano', 'orchestral', 'chamber music'] },
  { id: 'indie', name: 'Indie', rb: 'indie', q: 'indie', related: ['rock', 'pop', 'folk'], sub: ['indie rock', 'indie pop', 'dream pop', 'shoegaze', 'lo-fi'] },
  { id: 'hiphop', name: 'Hip-hop', rb: 'hip hop', q: 'hip hop', related: ['soul', 'electronic', 'reggae'], sub: ['rap', 'trap', 'boom bap', 'r&b'] },
  { id: 'pop', name: 'Pop', rb: 'pop', q: 'pop', related: ['indie', 'electronic', 'latin', 'rock'], sub: ['synthpop', 'k-pop', 'j-pop', 'dance pop', '80s'] },
  { id: 'ambient', name: 'Ambient', rb: 'ambient', q: 'ambient', related: ['electronic', 'classical', 'world'], sub: ['chillout', 'new age', 'drone', 'meditation', 'downtempo'] },
  { id: 'folk', name: 'Folk', rb: 'folk', q: 'folk', related: ['indie', 'world', 'blues', 'country'], sub: ['acoustic', 'singer-songwriter', 'celtic', 'americana'] },
  { id: 'latin', name: 'Latina', rb: 'latin', q: 'latin', related: ['pop', 'world', 'jazz', 'reggae'], sub: ['salsa', 'reggaeton', 'cumbia', 'bossa nova', 'tango', 'flamenco'] },
  { id: 'blues', name: 'Blues', rb: 'blues', q: 'blues', related: ['jazz', 'soul', 'rock', 'folk'], sub: ['delta blues', 'chicago blues', 'blues rock'] },
  { id: 'soul', name: 'Soul y funk', rb: 'soul', q: 'soul', related: ['hiphop', 'jazz', 'blues'], sub: ['funk', 'r&b', 'motown', 'neo soul'] },
  { id: 'metal', name: 'Metal', rb: 'metal', q: 'metal', related: ['rock'], sub: ['heavy metal', 'death metal', 'black metal', 'metalcore'] },
  { id: 'reggae', name: 'Reggae', rb: 'reggae', q: 'reggae', related: ['latin', 'world', 'hiphop'], sub: ['dub', 'ska', 'dancehall', 'roots reggae'] },
  { id: 'world', name: 'Músicas del mundo', rb: 'world music', q: 'world music', related: ['folk', 'latin', 'reggae', 'ambient'], sub: ['afrobeat', 'celtic', 'bollywood', 'arabic', 'balkan'] },
  { id: 'country', name: 'Country', rb: 'country', q: 'country', related: ['folk', 'blues', 'rock'], sub: ['bluegrass', 'americana', 'country rock'] },
];
export const genre = id => GENRES.find(g => g.id === id);
export const genreHue = id => (GENRES.findIndex(g => g.id === id) * 47 + 12) % 360;

// --------------------------------------------------------------- ciudades
// Coordenadas y zona horaria IANA de cada ciudad: datos geográficos fijos. Las emisoras se buscan
// alrededor con las coordenadas del directorio; nunca se asignan a una ciudad sin ellas.
export const CITIES = [
  { id: 'madrid', name: 'Madrid', cc: 'ES', lat: 40.4168, lon: -3.7038, tz: 'Europe/Madrid' },
  { id: 'barcelona', name: 'Barcelona', cc: 'ES', lat: 41.3874, lon: 2.1686, tz: 'Europe/Madrid' },
  { id: 'lisboa', name: 'Lisboa', cc: 'PT', lat: 38.7223, lon: -9.1393, tz: 'Europe/Lisbon' },
  { id: 'paris', name: 'París', cc: 'FR', lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris' },
  { id: 'londres', name: 'Londres', cc: 'GB', lat: 51.5072, lon: -0.1276, tz: 'Europe/London' },
  { id: 'berlin', name: 'Berlín', cc: 'DE', lat: 52.52, lon: 13.405, tz: 'Europe/Berlin' },
  { id: 'amsterdam', name: 'Ámsterdam', cc: 'NL', lat: 52.3676, lon: 4.9041, tz: 'Europe/Amsterdam' },
  { id: 'roma', name: 'Roma', cc: 'IT', lat: 41.9028, lon: 12.4964, tz: 'Europe/Rome' },
  { id: 'viena', name: 'Viena', cc: 'AT', lat: 48.2082, lon: 16.3738, tz: 'Europe/Vienna' },
  { id: 'estocolmo', name: 'Estocolmo', cc: 'SE', lat: 59.3293, lon: 18.0686, tz: 'Europe/Stockholm' },
  { id: 'varsovia', name: 'Varsovia', cc: 'PL', lat: 52.2297, lon: 21.0122, tz: 'Europe/Warsaw' },
  { id: 'atenas', name: 'Atenas', cc: 'GR', lat: 37.9838, lon: 23.7275, tz: 'Europe/Athens' },
  { id: 'estambul', name: 'Estambul', cc: 'TR', lat: 41.0082, lon: 28.9784, tz: 'Europe/Istanbul' },
  { id: 'cairo', name: 'El Cairo', cc: 'EG', lat: 30.0444, lon: 31.2357, tz: 'Africa/Cairo' },
  { id: 'lagos', name: 'Lagos', cc: 'NG', lat: 6.5244, lon: 3.3792, tz: 'Africa/Lagos' },
  { id: 'nairobi', name: 'Nairobi', cc: 'KE', lat: -1.2921, lon: 36.8219, tz: 'Africa/Nairobi' },
  { id: 'ciudad-del-cabo', name: 'Ciudad del Cabo', cc: 'ZA', lat: -33.9249, lon: 18.4241, tz: 'Africa/Johannesburg' },
  { id: 'bombay', name: 'Bombay', cc: 'IN', lat: 19.076, lon: 72.8777, tz: 'Asia/Kolkata' },
  { id: 'bangkok', name: 'Bangkok', cc: 'TH', lat: 13.7563, lon: 100.5018, tz: 'Asia/Bangkok' },
  { id: 'tokio', name: 'Tokio', cc: 'JP', lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo' },
  { id: 'seul', name: 'Seúl', cc: 'KR', lat: 37.5665, lon: 126.978, tz: 'Asia/Seoul' },
  { id: 'sidney', name: 'Sídney', cc: 'AU', lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney' },
  { id: 'nueva-york', name: 'Nueva York', cc: 'US', lat: 40.7128, lon: -74.006, tz: 'America/New_York' },
  { id: 'chicago', name: 'Chicago', cc: 'US', lat: 41.8781, lon: -87.6298, tz: 'America/Chicago' },
  { id: 'los-angeles', name: 'Los Ángeles', cc: 'US', lat: 34.0522, lon: -118.2437, tz: 'America/Los_Angeles' },
  { id: 'montreal', name: 'Montreal', cc: 'CA', lat: 45.5019, lon: -73.5674, tz: 'America/Toronto' },
  { id: 'ciudad-de-mexico', name: 'Ciudad de México', cc: 'MX', lat: 19.4326, lon: -99.1332, tz: 'America/Mexico_City' },
  { id: 'la-habana', name: 'La Habana', cc: 'CU', lat: 23.1136, lon: -82.3666, tz: 'America/Havana' },
  { id: 'bogota', name: 'Bogotá', cc: 'CO', lat: 4.711, lon: -74.0721, tz: 'America/Bogota' },
  { id: 'lima', name: 'Lima', cc: 'PE', lat: -12.0464, lon: -77.0428, tz: 'America/Lima' },
  { id: 'buenos-aires', name: 'Buenos Aires', cc: 'AR', lat: -34.6037, lon: -58.3816, tz: 'America/Argentina/Buenos_Aires' },
  { id: 'sao-paulo', name: 'São Paulo', cc: 'BR', lat: -23.5505, lon: -46.6333, tz: 'America/Sao_Paulo' },
];
export const city = id => CITIES.find(c => c.id === id);
const RAD = Math.PI / 180;
/** Distancia en km entre dos puntos (fórmula del haversine). */
export function km(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
export const nearestCity = (p, maxKm = 50) => {
  let best = null, bd = Infinity;
  for (const c of CITIES) { const d = km(p, c); if (d < bd) { bd = d; best = c; } }
  return bd <= maxKm ? best : null;
};

/** Altura del sol sobre el horizonte (grados) en un lugar y momento: aproximación astronómica estándar (±1°). */
export function sunElevation(date, lat, lon) {
  const d = date.getTime() / 86400000 - 10957.5;   // días desde J2000
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = (gmst * 15 + lon) * RAD - ra;
  return Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha)) / RAD;
}
/** Hora local real de una ciudad, el momento del día (según la altura real del sol) y una frase que lo describe. */
export function localMoment(c, now = new Date()) {
  const parts = new Intl.DateTimeFormat('es', { timeZone: c.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = +parts.find(p => p.type === 'hour').value, m = +parts.find(p => p.type === 'minute').value;
  const el = sunElevation(now, c.lat, c.lon);
  const am = h < 12;
  const moment = el > 6 ? (am ? 'mañana' : 'tarde') : el >= -6 ? (am ? 'amanecer' : 'atardecer') : h === 0 ? 'medianoche' : 'noche';
  const phrase = { mañana: `Buenos días, ${c.name}`, tarde: `Una tarde en ${c.name}`, amanecer: `Amanecer en ${c.name}`, atardecer: `Atardecer en ${c.name}`, medianoche: `Medianoche en ${c.name}`, noche: `Noche en ${c.name}` }[moment];
  return { time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, hour: h, elevation: el, moment, phrase };
}
/** Colores de la tarjeta según el momento (luz del cielo). */
export const SKY = {
  mañana: ['#5aa9e6', '#9fd3f5', '#fbe3a1'], tarde: ['#3a7bd5', '#6fb1e8', '#f6d38e'],
  amanecer: ['#2b3a67', '#f28f6b', '#ffd27f'], atardecer: ['#41295a', '#e5636b', '#ffb36b'],
  noche: ['#0b1026', '#1c2550', '#3b3f75'], medianoche: ['#05060f', '#11173a', '#272b5c'],
};

// --------------------------------------------------- semillas y aleatoriedad
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const strHash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };
export function seeded(seed) {
  let a = strHash(seed);
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const pickSeeded = (arr, seed) => (arr.length ? arr[Math.floor(seeded(seed)() * arr.length)] : null);

// -------------------------------------------------- reglas sobre etiquetas
// «Solo música» deja fuera las emisoras cuyas etiquetas indican noticias, tertulia, deportes o religión,
// y las que no tienen ninguna etiqueta (no sabemos qué emiten).
const NON_MUSIC = /\b(news|noticias|talk|tertulia|sports?|deportes?|religio\w*|christian talk|sermon|preach\w*|podcast|politic\w*|information|info|comedy|bible|quran|islam\w*)\b/;
export const MUSIC_RULE = 'Se excluyen las emisoras sin etiquetas y las etiquetadas como noticias, tertulia, deportes o religión.';
export const isMusic = s => !!s.tags?.length && !s.tags.some(t => NON_MUSIC.test(t));
// Energía: solo por etiquetas. Lo que no encaja en ninguna lista queda «sin datos».
const CALM = /\b(ambient|chill\w*|lounge|relax\w*|meditation|new age|classical|piano|easy listening|smooth|downtempo|lo-?fi|acoustic|sleep|spa|study|soft|baroque|bossa)/;
const ENERGETIC = /\b(edm|dance|techno|house|trance|drum and bass|dnb|hardstyle|metal|hard rock|punk|rock|hits|club|electro|reggaeton|rap|hip ?hop|trap|party|workout|eurodance)/;
export const ENERGY_RULE = 'Aproximado por etiquetas: «ambient», «chillout», «classical»… cuentan como tranquilas; «dance», «techno», «rock»… como enérgicas. Lo demás no se clasifica.';
export function energyOf(tags = []) {
  const t = tags.join(' ').toLowerCase();
  const calm = CALM.test(t), hot = ENERGETIC.test(t);
  return calm && !hot ? 0 : hot && !calm ? 1 : null;
}

// -------------------------------------------------- perfil de escucha (local)
/** País del usuario según el idioma del navegador (p. ej. es-ES → ES); se puede cambiar en el mezclador. */
export function homeCountry(pref) {
  if (/^[A-Z]{2}$/.test(pref || '')) return pref;
  for (const l of navigator.languages || [navigator.language]) { const m = /-([A-Z]{2})$/i.exec(l || ''); if (m) return m[1].toUpperCase(); }
  return '';
}

/**
 * Elige emisoras al azar que cumplan un modo. Devuelve varias candidatas ordenadas (para tener
 * alternativa si una falla) y evita las que han sonado hace poco (`recent`).
 *   modos: any · music · genre (tag) · country (cc) · outside (fuera de tu zona: países y etiquetas que no escuchas)
 */
export async function pickStations({ mode = 'any', tag = '', cc = '', recent = [], profile = null, signal } = {}) {
  const avoid = new Set(recent);
  const params = mode === 'genre' && tag ? { tag } : mode === 'country' && cc ? { countrycode: cc } : {};
  let list = await radio.random({ ...params, limit: mode === 'outside' ? 80 : 40 }, { signal });
  if (mode === 'music' || mode === 'outside') list = list.filter(isMusic);
  if (mode === 'outside' && profile && (profile.countries.size || profile.tags.size)) {
    const known = s => (profile.countries.has(s.cc) ? 1 : 0) + s.tags.filter(t => profile.tags.has(t)).length;
    list = list.map(s => [s, known(s)]).sort((a, b) => a[1] - b[1]).filter(([, k], i, arr) => k === 0 || i < arr.length / 3).map(([s]) => s);
  }
  const fresh = list.filter(s => !avoid.has(s.uuid));
  return fresh.length ? fresh : list;
}

/** Parecido entre dos emisoras según sus metadatos (no se analiza el sonido). Devuelve puntuación y motivos. */
export function similarity(a, b) {
  const shared = (a.tags || []).filter(t => (b.tags || []).includes(t)).slice(0, 4);
  const lang = (a.langs || []).find(l => (b.langs || []).map(x => x.toLowerCase()).includes(l.toLowerCase()));
  let score = shared.length * 3;
  const why = shared.map(t => t);
  if (lang) { score += 2; why.push(radio.langName(lang)); }
  if (a.cc && a.cc === b.cc) { score += 1.5; why.push(radio.countryName(a.cc)); if (a.state && a.state === b.state) { score += 0.5; why.push(a.state); } }
  return { score, why };
}
/** Hasta `n` emisoras relacionadas con una dada, con el motivo de cada una. */
export async function related(st, { n = 12, signal } = {}) {
  const jobs = [];
  if (st.tags?.length) jobs.push(radio.byTags(st.tags.slice(0, 3), { signal }));
  if (st.langs?.length) jobs.push(radio.search({ language: st.langs[0], order: 'clickcount', reverse: 'true', limit: 40 }, { signal }));
  if (st.cc) jobs.push(radio.byCountry(st.cc, { signal, params: { limit: 40 } }));
  const all = (await Promise.allSettled(jobs)).filter(r => r.status === 'fulfilled').flatMap(r => r.value);
  const seen = new Set([st.uuid]);
  return all.filter(s => !seen.has(s.uuid) && seen.add(s.uuid)).map(s => ({ s, ...similarity(st, s) })).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || b.s.clicks - a.s.clicks).slice(0, n);
}

/**
 * Mezclador: reordena emisoras o canciones según tres ejes (0..1). Cada eje usa un dato real:
 *   fam    Familiar (0) ↔ Sorprendente (1): etiquetas y países que ya escuchas (perfil local).
 *   intl   Local (0) ↔ Internacional (1): tu país frente a los demás (solo emisoras).
 *   energy Tranquilo (0) ↔ Energético (1): reglas de etiquetas; sin datos, queda neutral.
 * Un eje a 0,5 no cuenta.
 */
export function mixRank(items, mix, profile, home) {
  const w = v => (v == null ? 0 : (v - 0.5) * 2);
  const wf = w(mix?.fam), wi = w(mix?.intl), we = w(mix?.energy);
  if (!wf && !wi && !we) return items;
  const score = it => {
    const tags = (it.tags || []).map(t => t.toLowerCase());
    let s = 0;
    if (wf && profile) { const known = (profile.countries.has(it.cc) ? 1 : 0) + (tags.some(t => profile.tags.has(t)) ? 1 : 0); s += wf * (known ? -1 : 1); }
    if (wi && it.cc && home) s += wi * (it.cc === home ? -1 : 1);
    if (we) { const e = energyOf(tags); if (e != null) s += we * (e ? 1 : -1); }
    return s;
  };
  return items.map((it, i) => [it, score(it), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(x => x[0]);
}
