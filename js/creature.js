// «Tu criatura sonora»: motor de clasificación. Sin dependencias y sin acceso a datos: recibe un
// resumen de hábitos (creature-data.js lo prepara) y devuelve indicadores, puntuaciones, animal
// principal y secundario, explicaciones y ADN musical. Todo son reglas deterministas y comprobables
// (tests/profile/creature-test.mjs).
//
// MÉTODO
//  1. De los resúmenes diarios del período se calculan INDICADORES, casi todos proporciones (parte de
//     las escuchas, de los días o de las sesiones), para que escuchar más horas no dé más puntos.
//  2. Cada animal tiene REGLAS: indicador, valor desde el que empieza a contar (lo), valor en el que ya
//     cuenta del todo (hi) y peso. Cada regla vale entre 0 y 1 (rampa lineal entre lo y hi).
//  3. La PUNTUACIÓN del animal (0–100) es mitad la media ponderada de sus reglas con dato y mitad su
//     regla obligatoria más débil: así un solo rasgo muy marcado no compensa que falte el esencial.
//     Si falta el dato de una regla obligatoria, o no hay evidencia mínima, el animal no participa.
//  4. PRINCIPAL: la puntuación más alta, si llega a MIN_PRIMARY. SECUNDARIO: el siguiente, solo si llega
//     a MIN_SECONDARY y al 60 % del principal. Si no, no hay secundario.
//  5. La puntuación no es un porcentaje de afinidad: dice cuánto se cumplen las reglas de ese animal.

export const PERIODS = { 7: 'Últimos 7 días', 30: 'Últimos 30 días', 90: 'Últimos 90 días', all: 'Todo el historial' };
export const MIN_PRIMARY = 30, MIN_SECONDARY = 40, SECONDARY_RATIO = 0.6;
export const SWITCH_MARGIN = 8, SWITCH_DAYS = 3;       // metamorfosis: ventaja mínima y días distintos que debe mantenerse
const DAY = 86400000;
const BUCKETS = ['0:00–3:00', '3:00–6:00', '6:00–9:00', '9:00–12:00', '12:00–15:00', '15:00–18:00', '18:00–21:00', '21:00–0:00'];

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const ramp = (v, lo, hi) => (v == null ? null : clamp((v - lo) / (hi - lo)));
const pct = v => `${Math.round(v * 100)} %`;
const n1 = v => v.toLocaleString('es', { maximumFractionDigits: 1 });
const plural = (n, one, many) => `${n.toLocaleString('es')} ${n === 1 ? one : many}`;
const sum = a => a.reduce((x, y) => x + y, 0);
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const mins = v => (v >= 90 ? `${n1(v / 60)} h` : `${Math.round(v)} min`);

// ============================================================== indicadores
/**
 * src: { days: {AAAA-MM-DD: resumen}, open: {day, min} | null,
 *        all: { plays, heard, artists (distintos escuchados), done, skips, hours[24], top5, long, secs, genres: {g: n}, histDays: {día: [escuchas, s]} },
 *        playlists: [{createdAt, added: [ms…]}], favs: [ms…], passport: [{cc, first}] }
 */
export function indicators(src, period = '30', now = Date.now()) {
  const N = period === 'all' ? null : +period;
  const from = N ? dayKey(new Date(now - (N - 1) * DAY)) : '', to = dayKey(new Date(now));
  const keys = Object.keys(src.days || {}).filter(k => k >= from && k <= to).sort();
  const W = keys.map(k => src.days[k]);
  const S = f => sum(W.map(d => +d[f] || 0));
  const all = src.all || {};
  const since = now - (N ? N * DAY : Infinity);
  const m = {}, f = {};

  let P = S('p');
  const ls = S('ls'), rs = S('rs');
  const activeKeys = keys.filter(k => (src.days[k].p || 0) > 0 || (src.days[k].ls || 0) >= 300);
  let active = activeKeys.length;
  const firstKey = keys[0] || null;
  // «Todo el historial»: si las escuchas son anteriores a los resúmenes diarios, las proporciones salen de los totales de siempre.
  const legacy = period === 'all' && (all.plays || 0) > P * 1.25;
  const histKeys = Object.keys(all.histDays || {}).filter(k => (all.histDays[k]?.[0] || 0) > 0 && k >= from && k <= to).sort();
  if (legacy) { P = all.plays; active = Math.max(active, histKeys.length); }
  const first = [firstKey, histKeys[0]].filter(Boolean).sort()[0] || null;
  const span = first ? Math.min(N || Infinity, Math.round((new Date(to) - new Date(first)) / DAY) + 1) : 0;

  f.plays = P; f.active = active; f.span = span; f.listenMin = ls / 60; f.radioMin = rs / 60; f.legacy = legacy;
  f.period = period; f.days = keys.length;

  // --- horario
  const h8 = Array(8).fill(0);
  if (legacy && all.hours?.some(Boolean)) all.hours.forEach((n, h) => { h8[Math.floor(h / 3)] += n; });
  else for (const d of W) (d.h || []).forEach((n, i) => { h8[i] += n; });
  const hp = sum(h8);
  if (hp >= 10) {
    m.night = (h8[7] + h8[0] + h8[1]) / hp;
    m.morning = (h8[2] + h8[3]) / hp;
    f.peak = BUCKETS[h8.indexOf(Math.max(...h8))];
  }
  const withH = activeKeys.filter(k => src.days[k].h);
  if (withH.length >= 3) {
    const nd = withH.filter(k => { const h = src.days[k].h; return h[7] + h[0] + h[1] > 0; }).length;
    const md = withH.filter(k => { const h = src.days[k].h; return h[2] + h[3] > 0; }).length;
    m.nightDays = nd / withH.length; m.morningDays = md / withH.length;
    f.nightDays = nd; f.morningDays = md; f.hourDays = withH.length;
    if (withH.length >= 5) {
      const dom = withH.map(k => { const h = src.days[k].h; return h.indexOf(Math.max(...h)); });
      const c = Array(8).fill(0); dom.forEach(i => c[i]++);
      const top = Math.max(...c);
      m.hourFocus = top / dom.length; f.focusBucket = BUCKETS[c.indexOf(top)]; f.focusDays = top;
    }
  }

  // --- repetición, descubrimiento, reencuentros
  // «tus 5 artistas principales» solo dice algo si has escuchado a bastantes más de cinco
  const manyArtists = (all.artists ?? 99) >= 10;
  const p = S('p');
  if (legacy) {
    if (all.plays >= 10) { m.repeat = 1 - (all.heard || 0) / all.plays; if (all.top5 != null && manyArtists) m.top5 = all.top5; f.heard = all.heard; }
  } else if (p >= 10) {
    m.repeat = S('rp') / p; if (manyArtists) m.top5 = S('fa') / p;
    const dt = S('dt'); if (dt) m.sameDay = clamp(1 - dt / p);
    m.fresh = S('nw') / p; m.newArtists = S('na') / p; m.comeback = S('bk') / p;
    f.newTracks = S('nw'); f.newArtists = S('na'); f.comebacks = S('bk'); f.repeats = S('rp');
  }

  // --- sesiones
  const ses = [];
  keys.forEach(k => ses.push(...(src.days[k].ss || [])));
  if (src.open && src.open.day >= from) ses.push(src.open.min);
  f.sessions = ses.length;
  if (ses.length >= (N === 7 ? 3 : 5)) {
    m.sesMedian = median(ses); m.sesLong = ses.filter(x => x >= 60).length / ses.length; m.sesShort = ses.filter(x => x <= 15).length / ses.length;
    const sd = keys.filter(k => (src.days[k].ss || []).length).length || 1;
    m.sesPerDay = ses.length / sd;
    f.sesLong = ses.filter(x => x >= 60).length; f.sesShort = ses.filter(x => x <= 15).length; f.sesMean = sum(ses) / ses.length;
  }

  // --- saltos y cambios
  const sk = legacy ? all.skips || 0 : S('sk');
  if (P + sk >= 15) { m.skip = sk / (P + sk); f.skips = sk; }
  const cs = S('cs');
  if (cs >= 10) { m.switch = S('ax') / cs; m.albumRun = S('al') / cs; f.pairs = cs; f.albumPairs = S('al'); }

  // --- géneros (solo con etiquetas suficientes)
  const G = {};
  if (legacy) Object.assign(G, all.genres || {}); else for (const d of W) for (const [g, n] of Object.entries(d.g || {})) G[g] = (G[g] || 0) + n;
  const gs = Object.entries(G).sort((a, b) => b[1] - a[1]), gt = sum(gs.map(x => x[1]));
  f.genres = gs.slice(0, 5);
  if (gs.length >= 2 && gt >= Math.max(10, P * 0.4)) {
    const H = -sum(gs.map(([, n]) => (n / gt) * Math.log(n / gt)));
    m.genreDiv = clamp(H / Math.log(8)); f.genreCount = gs.length;
    const tops = activeKeys.map(k => Object.entries(src.days[k].g || {}).sort((a, b) => b[1] - a[1])[0]?.[0]).filter(Boolean);
    if (tops.length >= 5) { let ch = 0; for (let i = 1; i < tops.length; i++) if (tops[i] !== tops[i - 1]) ch++; m.genreShift = ch / (tops.length - 1); f.genreShifts = ch; f.genreDays = tops.length; }
  }

  // --- radio y países
  if (ls >= 1800) { m.radioShare = rs / ls; m.mix = 1 - Math.abs(m.radioShare - 0.5) * 2; if (active) m.alternation = S('sw') / active; f.switches = S('sw'); f.stations = S('rn'); }
  const cc = {};
  for (const d of W) for (const [c, s] of Object.entries(d.rc || {})) cc[c] = (cc[c] || 0) + s;
  const heardCC = new Set(Object.entries(cc).filter(([, s]) => s >= 120).map(x => x[0]));
  const stamps = (src.passport || []).filter(x => x.cc);
  if (period === 'all') for (const x of stamps) heardCC.add(x.cc);
  const fresh = stamps.filter(x => x.first >= since && x.first <= now);
  for (const x of fresh) heardCC.add(x.cc);
  if (heardCC.size || rs > 0) { m.countries = heardCC.size; m.newCountries = fresh.length; }
  f.countryList = [...heardCC];

  // --- organizar y coleccionar (por semana, para comparar períodos distintos)
  const weeks = Math.max(1, (span || N || 7) / 7);
  const pls = (src.playlists || []);
  const created = pls.filter(x => x.createdAt >= since && x.createdAt <= now).length;
  const added = sum(pls.map(x => (x.added || []).filter(t => t >= since && t <= now).length));
  const edits = S('pe');
  f.plCreated = created; f.plAdded = added; f.plEdits = edits;
  if (span >= 3 || period === 'all') m.curation = (created * 3 + added + edits) / weeks;
  const favs = (src.favs || []).filter(t => t >= since && t <= now).length, ad = S('ad');
  f.favs = favs; f.libAdded = ad;
  if (span >= 3 || period === 'all') m.collect = (favs + ad) / weeks;

  // --- regularidad
  if (span >= 7) m.activeRatio = clamp(active / span);

  // --- inmersión
  if (legacy) {
    if (all.plays >= 10) { m.completion = clamp((all.done || 0) / all.plays); if (all.long != null) m.longTracks = all.long / all.plays; if (all.secs) m.avgTrack = all.secs / all.plays / 60; }
  } else if (p >= 10) { m.completion = clamp(S('dn') / p); m.longTracks = S('lg') / p; m.avgTrack = S('s') / p / 60; f.longCount = S('lg'); f.doneCount = S('dn'); }

  const minDays = N === 7 ? 2 : 3;
  const enough = (P >= 15 || ls >= 45 * 60) && active >= minDays;
  return { period, m, f, enough, need: { plays: 15, days: minDays } };
}

// ================================================================= animales
// Cada animal reúne TODO lo suyo: textos, reglas, evidencia mínima, hechos para la explicación y aspecto.
// Para añadir uno basta con otra entrada aquí y su geometría en creature-shapes.js (mismo id).
//   rules: [indicador, lo, hi, peso, obligatorio]     facts: hechos que se muestran en «¿Por qué soy este animal?»
//   look: colores, movimiento ambiental (motion) y hábitat de la escena 3D
export const ANIMALS = [
  { id: 'buho', name: 'Búho', sub: 'El noctámbulo',
    text: 'Buena parte de tu música suena de noche. Cuando el día termina, tu biblioteca sigue despierta.',
    rules: [['night', 0.25, 0.6, 3, true], ['nightDays', 0.3, 0.8, 2]], facts: ['night', 'nightDays', 'peak'],
    look: { colors: ['#8f7bff', '#3b2f8f'], motion: { breath: 0.022, speed: 0.45, pulse: 0.35 }, habitat: 'stars', view: [-0.5, 0.08] } },
  { id: 'alondra', name: 'Alondra', sub: 'El madrugador',
    text: 'Empiezas el día con música: las primeras horas concentran una parte importante de tus escuchas.',
    rules: [['morning', 0.25, 0.6, 3, true], ['morningDays', 0.3, 0.8, 2]], facts: ['morning', 'morningDays', 'peak'],
    look: { colors: ['#ffd27a', '#ff8f5a'], motion: { breath: 0.02, speed: 0.9, flutter: 0.006 }, habitat: 'dawn', view: [-0.35, 0.05] } },
  { id: 'lobo', name: 'Lobo', sub: 'El fiel',
    text: 'Vuelves una y otra vez a las mismas canciones y a tus artistas de siempre.',
    rules: [['top5', 0.35, 0.75, 3, true], ['repeat', 0.75, 0.98, 2], ['sameDay', 0.05, 0.3, 2]], facts: ['top5', 'repeat', 'sameDay'],
    look: { colors: ['#b9c7e6', '#52658f'], motion: { breath: 0.026, speed: 0.55, sway: 0.01 }, habitat: 'moon', view: [-0.3, 0.05] } },
  { id: 'zorro', name: 'Zorro', sub: 'El explorador',
    text: 'Descubres música nueva con frecuencia: canciones y artistas que no habías escuchado antes.',
    rules: [['fresh', 0.1, 0.45, 3, true], ['newArtists', 0.02, 0.15, 2]], min: I => I.f.newTracks >= 5, facts: ['fresh', 'newArtists'],
    look: { colors: ['#ff9a5a', '#ff5a7a'], motion: { breath: 0.02, speed: 0.8, stream: 0.02 }, habitat: 'streams', view: [-0.3, 0.05] } },
  { id: 'elefante', name: 'Elefante', sub: 'El nostálgico',
    text: 'Recuperas canciones que llevaban mucho tiempo sin sonar: tu biblioteca tiene memoria.',
    rules: [['comeback', 0.05, 0.3, 3, true]], min: I => I.f.comebacks >= 3, facts: ['comeback'],
    look: { colors: ['#c9b8a6', '#8a6f8f'], motion: { breath: 0.018, speed: 0.35, sway: 0.008 }, habitat: 'dust', view: [-0.4, 0.05] } },
  { id: 'tortuga', name: 'Tortuga', sub: 'El maratoniano',
    text: 'Escuchas en sesiones largas: cuando pones música, se queda sonando.',
    rules: [['sesMedian', 35, 100, 3, true], ['sesLong', 0.15, 0.6, 2]], facts: ['sesMedian', 'sesLong'],
    look: { colors: ['#7fd6a0', '#2f8f7a'], motion: { breath: 0.016, speed: 0.3, sway: 0.006 }, habitat: 'dust', view: [-0.45, 0.3] } },
  { id: 'liebre', name: 'Liebre', sub: 'El de los momentos',
    text: 'Tu música llega en ratos cortos y frecuentes, repartidos a lo largo del día.',
    rules: [['sesShort', 0.4, 0.85, 2, true], ['sesPerDay', 1.5, 4, 2], ['sesMedian', 30, 8, 1]], facts: ['sesShort', 'sesPerDay', 'sesMedian'],
    look: { colors: ['#f2e3c9', '#d98f6a'], motion: { breath: 0.024, speed: 1.1, flutter: 0.004 }, habitat: 'sparks', view: [-0.3, 0.05] } },
  { id: 'colibri', name: 'Colibrí', sub: 'El inquieto',
    text: 'Cambias a menudo de canción y de artista: tu escucha va de flor en flor.',
    rules: [['skip', 0.15, 0.5, 3, true], ['switch', 0.6, 0.95, 2]], facts: ['skip', 'switch'],
    look: { colors: ['#5af2c8', '#5a9aff'], motion: { breath: 0.012, speed: 1.6, flutter: 0.014 }, habitat: 'sparks', view: [-0.35, 0.1] } },
  { id: 'camaleon', name: 'Camaleón', sub: 'El versátil',
    text: 'Escuchas estilos muy distintos y cambias de género de un día para otro.',
    rules: [['genreDiv', 0.5, 0.9, 3, true], ['genreShift', 0.3, 0.8, 2]], facts: ['genreDiv', 'genreShift'],
    look: { colors: ['#9af25a', '#5ad9f2'], motion: { breath: 0.018, speed: 0.5, chroma: 1 }, habitat: 'chroma', view: [-0.3, 0.05] } },
  { id: 'delfin', name: 'Delfín', sub: 'El navegante',
    text: 'Alternas entre tu biblioteca y las emisoras de radio: navegas entre las dos.',
    rules: [['mix', 0.3, 0.9, 3, true], ['alternation', 0.3, 1.5, 2]], min: I => I.f.radioMin >= 20 && I.f.plays >= 5, facts: ['radioShare', 'alternation', 'stations'],
    look: { colors: ['#5ac8ff', '#3a6aff'], motion: { breath: 0.016, speed: 0.7, wave: 0.03 }, habitat: 'waves', view: [-0.3, 0.05] } },
  { id: 'aguila', name: 'Águila', sub: 'El viajero',
    text: 'Recorres emisoras de muchos países: tu radio no tiene fronteras.',
    rules: [['countries', 2, 8, 3, true], ['newCountries', 1, 4, 2]], min: I => I.m.countries >= 2, facts: ['countries', 'newCountries'],
    look: { colors: ['#ffd98a', '#c97a3a'], motion: { breath: 0.014, speed: 0.5, wave: 0.02, sway: 0.012 }, habitat: 'routes', view: [-0.9, 0.35] } },
  { id: 'abeja', name: 'Abeja', sub: 'El curador',
    text: 'Dedicas tiempo a ordenar tu música: creas playlists, añades canciones y las reorganizas.',
    rules: [['curation', 2, 15, 3, true]], min: I => I.f.plCreated + I.f.plAdded + I.f.plEdits >= 4, facts: ['plCreated', 'plAdded', 'plEdits'],
    look: { colors: ['#ffd23a', '#ff9a2a'], motion: { breath: 0.012, speed: 1.3, flutter: 0.012 }, habitat: 'hex', view: [-0.5, 0.25] } },
  { id: 'ardilla', name: 'Ardilla', sub: 'El coleccionista',
    text: 'Tu biblioteca no deja de crecer: guardas canciones y marcas favoritas con frecuencia.',
    rules: [['collect', 2, 15, 3, true]], min: I => I.f.favs + I.f.libAdded >= 4, facts: ['libAdded', 'favs'],
    look: { colors: ['#e6a05a', '#a85a3a'], motion: { breath: 0.022, speed: 1.0, flutter: 0.005 }, habitat: 'dust', view: [-0.3, 0.05] } },
  { id: 'pinguino', name: 'Pingüino', sub: 'El ritualista',
    text: 'Escuchas con mucha regularidad: casi todos los días y casi siempre a las mismas horas.',
    rules: [['hourFocus', 0.4, 0.85, 3, true], ['activeRatio', 0.5, 0.95, 2, true]], facts: ['hourFocus', 'activeRatio'],
    look: { colors: ['#cfe8ff', '#5a7aa8'], motion: { breath: 0.016, speed: 0.6, sway: 0.014 }, habitat: 'snow', view: [-0.35, 0.05] } },
  { id: 'ballena', name: 'Ballena', sub: 'El inmersivo',
    text: 'Te sumerges: canciones largas, álbumes seguidos y escuchas que llegan hasta el final.',
    rules: [['longTracks', 0.1, 0.45, 3], ['albumRun', 0.2, 0.7, 3], ['completion', 0.8, 0.98, 1, true], ['avgTrack', 3.5, 6.5, 1]],
    min: I => I.m.longTracks != null || I.m.albumRun != null, facts: ['longTracks', 'albumRun', 'completion'],
    look: { colors: ['#5a8aff', '#2a3a9f'], motion: { breath: 0.014, speed: 0.3, wave: 0.045 }, habitat: 'waves', view: [-0.35, 0.08] } },
];
export const animal = id => ANIMALS.find(a => a.id === id) || null;

/** Etiqueta de cada indicador (para el desglose de la puntuación). */
export const METRICS = {
  night: 'Escuchas de noche (21:00–6:00)', nightDays: 'Días con música de noche', morning: 'Escuchas de mañana (6:00–12:00)', morningDays: 'Días con música por la mañana',
  top5: 'Escuchas de tus 5 artistas principales', repeat: 'Escuchas de canciones que ya conocías', sameDay: 'Repeticiones en el mismo día',
  fresh: 'Escuchas de canciones nuevas para ti', newArtists: 'Artistas nuevos por escucha', comeback: 'Reencuentros (más de 60 días sin sonar)',
  sesMedian: 'Duración mediana de sesión (min)', sesLong: 'Sesiones de una hora o más', sesShort: 'Sesiones de 15 minutos o menos', sesPerDay: 'Sesiones por día',
  skip: 'Canciones saltadas', switch: 'Cambios de artista entre canciones seguidas', genreDiv: 'Diversidad de géneros', genreShift: 'Días en que cambia tu género principal',
  mix: 'Equilibrio entre biblioteca y radio', alternation: 'Cambios biblioteca ↔ radio por día', countries: 'Países de las emisoras', newCountries: 'Países nuevos',
  curation: 'Actividad de organización por semana', collect: 'Canciones guardadas y favoritas por semana', hourFocus: 'Días con la misma franja principal', activeRatio: 'Días con música',
  longTracks: 'Canciones de 6 minutos o más', albumRun: 'Canciones seguidas del mismo álbum', completion: 'Escuchadas hasta el final', avgTrack: 'Duración media de canción (min)',
};

/** Hechos con cifras reales para explicar una asignación. Devuelven null si no hay dato. */
const FACTS = {
  night: ({ m }) => m.night != null && `${pct(m.night)} de tus escuchas suenan entre las 21:00 y las 6:00`,
  nightDays: ({ m, f }) => m.nightDays != null && `Música de noche en ${f.nightDays} de ${plural(f.hourDays, 'día', 'días')} con escuchas`,
  morning: ({ m }) => m.morning != null && `${pct(m.morning)} de tus escuchas suenan entre las 6:00 y las 12:00`,
  morningDays: ({ m, f }) => m.morningDays != null && `Música por la mañana en ${f.morningDays} de ${plural(f.hourDays, 'día', 'días')} con escuchas`,
  peak: ({ f }) => f.peak && `Tu franja con más actividad: ${f.peak}`,
  top5: ({ m }) => m.top5 != null && `${pct(m.top5)} de tus escuchas son de tus cinco artistas principales`,
  repeat: ({ m }) => m.repeat != null && `${pct(m.repeat)} de tus escuchas son de canciones que ya habías escuchado`,
  sameDay: ({ m }) => m.sameDay != null && `${pct(m.sameDay)} de las escuchas repiten una canción ya escuchada ese mismo día`,
  fresh: ({ m, f }) => m.fresh != null && `${plural(f.newTracks, 'canción nueva', 'canciones nuevas')} para ti: ${pct(m.fresh)} de tus escuchas`,
  newArtists: ({ f }) => f.newArtists != null && `${plural(f.newArtists, 'artista que no habías escuchado', 'artistas que no habías escuchado')}`,
  comeback: ({ m, f }) => m.comeback != null && `${plural(f.comebacks, 'reencuentro', 'reencuentros')} con canciones que llevaban más de 60 días sin sonar (${pct(m.comeback)} de tus escuchas)`,
  sesMedian: ({ m }) => m.sesMedian != null && `Tu sesión típica dura ${mins(m.sesMedian)} (mediana)`,
  sesLong: ({ m, f }) => m.sesLong != null && `${f.sesLong} de ${plural(f.sessions, 'sesión', 'sesiones')} duran una hora o más`,
  sesShort: ({ m, f }) => m.sesShort != null && `${f.sesShort} de ${plural(f.sessions, 'sesión', 'sesiones')} duran 15 minutos o menos`,
  sesPerDay: ({ m }) => m.sesPerDay != null && `${n1(m.sesPerDay)} sesiones al día, de media, los días que escuchas`,
  skip: ({ m, f }) => m.skip != null && `Saltas ${pct(m.skip)} de las canciones nada más empezar (${f.skips})`,
  switch: ({ m }) => m.switch != null && `En ${pct(m.switch)} de las canciones seguidas cambias de artista`,
  genreDiv: ({ m, f }) => m.genreDiv != null && `${plural(f.genreCount, 'género', 'géneros')} en tus escuchas; los principales: ${f.genres.slice(0, 3).map(x => x[0]).join(', ')}`,
  genreShift: ({ m, f }) => m.genreShift != null && `Tu género principal cambia en ${f.genreShifts} de ${f.genreDays - 1} días consecutivos con música`,
  radioShare: ({ m, f }) => m.radioShare != null && `${pct(m.radioShare)} de tu tiempo de escucha es radio (${mins(f.radioMin)}) y el resto, tu biblioteca`,
  alternation: ({ f }) => f.switches != null && f.switches > 0 && `${plural(f.switches, 'cambio', 'cambios')} entre biblioteca y radio dentro de una misma sesión`,
  stations: ({ f }) => f.stations > 0 && `${plural(f.stations, 'emisora escuchada', 'emisoras escuchadas')} (contando cada día por separado)`,
  countries: ({ m }) => m.countries != null && m.countries > 0 && `Emisoras de ${plural(m.countries, 'país', 'países')}`,
  newCountries: ({ m }) => m.newCountries > 0 && `${plural(m.newCountries, 'país nuevo', 'países nuevos')} en tu pasaporte de radio en este período`,
  plCreated: ({ f }) => f.plCreated > 0 && `${plural(f.plCreated, 'playlist creada', 'playlists creadas')}`,
  plAdded: ({ f }) => f.plAdded > 0 && `${plural(f.plAdded, 'canción añadida', 'canciones añadidas')} a tus playlists`,
  plEdits: ({ f }) => f.plEdits > 0 && `${plural(f.plEdits, 'cambio guardado', 'cambios guardados')} en playlists (orden, capítulos, aspecto…)`,
  libAdded: ({ f }) => f.libAdded > 0 && `${plural(f.libAdded, 'canción añadida', 'canciones añadidas')} a tu biblioteca`,
  favs: ({ f }) => f.favs > 0 && `${plural(f.favs, 'canción marcada', 'canciones marcadas')} como favorita`,
  hourFocus: ({ m, f }) => m.hourFocus != null && `En ${f.focusDays} de ${f.hourDays} días tu franja principal fue la misma: ${f.focusBucket}`,
  activeRatio: ({ m, f }) => m.activeRatio != null && `Música en ${f.active} de ${plural(f.span, 'día', 'días')}`,
  longTracks: ({ m, f }) => m.longTracks != null && `${pct(m.longTracks)} de tus escuchas son canciones de 6 minutos o más`,
  albumRun: ({ m }) => m.albumRun != null && `${pct(m.albumRun)} de las canciones seguidas son del mismo álbum`,
  completion: ({ m }) => m.completion != null && `Escuchas hasta el final ${pct(m.completion)} de las canciones`,
};
export const fact = (key, I) => FACTS[key]?.(I) || null;

/** Puntuación de un animal: {id, score, parts} o null si no puede participar. */
export function scoreOf(a, I) {
  let w = 0, acc = 0, weakest = 1;
  const parts = [];
  for (const [key, lo, hi, weight, req] of a.rules) {
    const v = I.m[key];
    if (v == null) { if (req) return null; continue; }
    const r = ramp(v, lo, hi);
    w += weight; acc += weight * r;
    if (req) weakest = Math.min(weakest, r);
    parts.push({ key, label: METRICS[key], value: v, r, weight, lo, hi, req: !!req });
  }
  if (!w || (a.min && !a.min(I))) return null;
  return { id: a.id, score: Math.round((0.5 * (acc / w) + 0.5 * weakest) * 100), parts };
}

/** Clasificación completa de un período. */
export function classify(I, animals = ANIMALS) {
  const scores = animals.map(a => scoreOf(a, I)).filter(Boolean).sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
  const out = { enough: I.enough, scores, primary: null, secondary: null, reason: '' };
  if (!I.enough) { out.reason = 'few'; return out; }
  const [a, b] = scores;
  if (!a || a.score < MIN_PRIMARY) { out.reason = 'flat'; return out; }
  out.primary = a;
  if (b && b.score >= MIN_SECONDARY && b.score >= a.score * SECONDARY_RATIO) out.secondary = b;
  return out;
}

/** Texto y hechos de una asignación, siempre a partir de los indicadores. */
export function explain(id, I) {
  const a = animal(id);
  if (!a) return null;
  return { title: `Eres el ${a.name}`, sub: a.sub, text: a.text, why: a.facts.map(k => fact(k, I)).filter(Boolean) };
}
export function pairText(p, s) {
  const A = animal(p), B = animal(s);
  return A && B ? `${A.name} + ${B.name}: ${A.sub.toLowerCase().replace(/^el /, 'patrón de ')} con rasgos de ${B.sub.toLowerCase().replace(/^el /, '')}.` : '';
}

// ================================================================ ADN musical
// Cada dimensión va de 0 a 100 y es la media de sus componentes con dato (cada uno, una rampa 0–1).
const DNA = [
  { id: 'exploracion', name: 'Exploración', parts: [['fresh', 0, 0.4], ['newArtists', 0, 0.12]],
    how: 'Parte de tus escuchas que son canciones nuevas para ti (100 a partir del 40 %) y artistas nuevos por escucha (100 a partir de 12 de cada 100).' },
  { id: 'repeticion', name: 'Repetición', parts: [['top5', 0.2, 0.8], ['repeat', 0.6, 1]],
    how: 'Parte de tus escuchas que van a tus cinco artistas principales (de 20 % a 80 %) y a canciones que ya conocías (de 60 % a 100 %).' },
  { id: 'variedad', name: 'Variedad', parts: [['genreDiv', 0, 1], ['switch', 0.3, 1]],
    how: 'Diversidad de géneros de lo que escuchas (reparto entre géneros, solo con canciones etiquetadas) y cada cuánto cambias de artista entre canciones seguidas.' },
  { id: 'regularidad', name: 'Regularidad', parts: [['activeRatio', 0, 1], ['hourFocus', 0.25, 0.9]],
    how: 'Días con música sobre el total de días del período y días en los que tu franja horaria principal es la misma.' },
  { id: 'sesiones', name: 'Duración de sesiones', parts: [['sesMedian', 5, 90]],
    how: 'Duración mediana de tus sesiones: 0 con 5 minutos o menos, 100 con 90 minutos o más. Una sesión termina tras 20 minutos sin música.' },
  { id: 'geografia', name: 'Diversidad geográfica', parts: [['countries', 0, 8]],
    how: 'Países de las emisoras de radio que has escuchado (100 con 8 o más). No se deduce nada del origen de los artistas.' },
  { id: 'organizacion', name: 'Organización', parts: [['curation', 0, 12]],
    how: 'Actividad semanal en tus playlists: cada playlist creada cuenta 3 y cada canción añadida o cambio guardado, 1 (100 con 12 o más por semana).' },
];
export function dna(I) {
  return DNA.map(d => {
    const vals = d.parts.map(([k, lo, hi]) => ({ key: k, label: METRICS[k], value: I.m[k], r: ramp(I.m[k], lo, hi) })).filter(x => x.r != null);
    return { id: d.id, name: d.name, how: d.how, value: vals.length ? Math.round((sum(vals.map(x => x.r)) / vals.length) * 100) : null, parts: vals,
      facts: d.parts.map(([k]) => fact(k, I)).filter(Boolean) };
  });
}
/** Valor legible de un indicador. */
export function fmtMetric(key, v) {
  if (v == null) return '—';
  if (['sesMedian', 'avgTrack'].includes(key)) return `${n1(v)} min`;
  if (['sesPerDay', 'alternation', 'curation', 'collect', 'countries', 'newCountries'].includes(key)) return n1(v);
  return pct(v);
}

// ============================================================= metamorfosis
/**
 * Un paso de la criatura «oficial» (como mucho uno por día). No cambia por pequeñas oscilaciones:
 * el nuevo animal debe superar al actual en SWITCH_MARGIN puntos durante SWITCH_DAYS días distintos.
 * state: {official: {a, b, score, since, from?}, cand: {id, days: []}}. Devuelve el estado nuevo, si hubo
 * cambio y la entrada del mes para el bestiario.
 */
export function step(state, res, I, now = Date.now()) {
  const today = dayKey(new Date(now)), month = today.slice(0, 7);
  let { official = null, cand = null } = state || {};
  let event = null;
  if (!res.primary) return { official, cand, event, entry: null };
  const p = res.primary, s = res.secondary;
  if (!official) { official = { a: p.id, b: s?.id || '', score: p.score, since: now }; cand = null; event = { type: 'born', to: p.id }; }
  else if (official.a === p.id) { official = { ...official, b: s?.id || '', score: p.score }; cand = null; }
  else {
    const cur = res.scores.find(x => x.id === official.a)?.score || 0;
    if (p.score - cur >= SWITCH_MARGIN) {
      cand = cand?.id === p.id ? { id: p.id, days: [...new Set([...cand.days, today])] } : { id: p.id, days: [today] };
      if (cand.days.length >= SWITCH_DAYS) {
        event = { type: 'change', from: official.a, to: p.id, margin: p.score - cur, was: cur };
        official = { a: p.id, b: s?.id || '', score: p.score, since: now, from: official.a };
        cand = null;
      }
    } else cand = null;
  }
  const ex = explain(official.a, I);
  const mine = res.scores.find(x => x.id === official.a);
  const entry = { key: month, a: official.a, b: official.b || '', score: mine?.score ?? official.score, at: now, period: I.period,
    why: ex.why.slice(0, 4), m: Object.fromEntries((mine?.parts || []).map(x => [x.key, +(+x.value).toFixed(3)])),
    plays: I.f.plays, listenMin: Math.round(I.f.listenMin), ...(event?.type === 'change' ? { from: event.from, changed: today, margin: event.margin } : {}) };
  return { official, cand, event, entry };
}
/** Qué cambió entre dos entradas del bestiario (indicadores comunes). */
export function diffEntries(prev, cur) {
  if (!prev || !cur) return [];
  return Object.keys(cur.m || {}).filter(k => prev.m && k in prev.m && Math.abs(cur.m[k] - prev.m[k]) >= 0.05)
    .map(k => ({ key: k, label: METRICS[k], from: prev.m[k], to: cur.m[k] }));
}

// ================================================= unión entre dispositivos
const sumOf = a => (a || []).reduce((x, y) => x + y, 0);
const maxArr = (a = [], b = []) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => Math.max(a[i] || 0, b[i] || 0));
const maxMap = (a = {}, b = {}) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = Math.max(o[k] || 0, v); return o; };
/** Une el resumen de un día de dos dispositivos: de cada contador, el valor más alto. */
export function mergeDay(l = {}, r = {}) {
  const o = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    const a = l[k], b = r[k];
    if (k === 'h') o.h = maxArr(a, b);
    else if (k === 'g' || k === 'rc') o[k] = maxMap(a, b);
    else if (k === 'ss') o.ss = sumOf(b) > sumOf(a) ? b : a || b;
    else o[k] = Math.max(+a || 0, +b || 0);
  }
  return o;
}
