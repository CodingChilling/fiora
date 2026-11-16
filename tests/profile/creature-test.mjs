// Motor de «Tu criatura sonora» con perfiles de escucha sintéticos: cada patrón produce su animal,
// los datos insuficientes no asignan ninguno, el secundario exige evidencia, el ADN sale de los
// indicadores, la metamorfosis no oscila y las 15 definiciones y geometrías son distintas.
//   node creature-test.mjs
import * as C from '../../js/creature.js';
import { distance, sample, shapeIds, SHAPES } from '../../js/creature-shapes.js';

let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };
const NOW = new Date('2026-11-16T18:00:00').getTime(), DAY = 86400000;
const key = i => C.dayKey(new Date(NOW - i * DAY));

// Día «neutro»: escucha de tarde, sin nada que destaque.
const BASE = { p: 10, s: 2100, ls: 2400, dn: 8, sk: 1, h: [0, 0, 0, 1, 3, 4, 2, 0], rp: 8, nw: 0, na: 0, bk: 0, fa: 2, cs: 8, ax: 4, al: 1, lg: 0, dt: 10, da: 6, g: { Pop: 7, Rock: 3 }, ss: [25, 22] };
/** Crea un historial: `every` días con música de cada `of`; `day(i)` personaliza cada día. */
function make({ days = 30, active = i => i % 2 === 0, day = () => ({}), extra = {} } = {}) {
  const src = { days: {}, all: { plays: 0, artists: 40 }, playlists: [], favs: [], passport: [], open: null, ...extra };
  for (let i = 0; i < days; i++) if (active(i)) src.days[key(i)] = { ...BASE, ...day(i) };
  return src;
}
const run = (src, period = '30') => { const I = C.indicators(src, period, NOW); return { I, res: C.classify(I), dna: C.dna(I) }; };
const top = r => r.res.primary?.id || `(ninguno: ${r.res.reason})`;

// ---------------------------------------------------------------- 15 patrones
const hours = (...idx) => { const h = Array(8).fill(0); idx.forEach(i => { h[i] = 5; }); return h; };
const rot = i => hours([2, 4, 5, 6, 3][i % 5]);                       // franja principal distinta cada día
const PROFILES = {
  buho: make({ day: i => ({ h: i % 3 ? [3, 1, 0, 0, 0, 0, 1, 5] : [0, 0, 0, 0, 2, 3, 3, 2] }) }),
  alondra: make({ day: i => ({ h: i % 3 ? [0, 0, 5, 4, 1, 0, 0, 0] : [0, 0, 1, 2, 4, 3, 0, 0] }) }),
  lobo: make({ day: i => ({ h: rot(i), fa: 8, rp: 10, dt: 7 }) }),
  zorro: make({ day: i => ({ h: rot(i), nw: 5, rp: 5, na: 2 }) }),
  elefante: make({ day: i => ({ h: rot(i), bk: 3 }) }),
  tortuga: make({ day: i => ({ h: rot(i), ss: [95, 130], ls: 13500 }) }),
  liebre: make({ day: i => ({ h: rot(i), ss: [8, 6, 12, 9, 5], ls: 2400 }) }),
  colibri: make({ day: i => ({ h: rot(i), sk: 8, ax: 8 }) }),
  camaleon: make({ day: i => ({ h: rot(i), g: [{ Jazz: 4, Rock: 3, Folk: 3 }, { Techno: 4, Salsa: 3, Pop: 3 }, { Classical: 5, Metal: 3, Reggae: 2 }, { Blues: 4, Soul: 3, Punk: 3 }][(i / 2) % 4] }) }),
  delfin: make({ day: i => ({ h: rot(i), ls: 4800, rs: 2400, rc: { ES: 2400 }, rn: 1, sw: 2 }) }),
  aguila: make({ day: i => ({ h: rot(i), ls: 3600, rs: 600, rn: 3, rc: { [['ES', 'JP', 'BR', 'IS', 'KE', 'IN', 'MX', 'FR'][(i / 2) % 8]]: 600 } }) }),
  abeja: make({ day: i => ({ h: rot(i), pe: 4 }), extra: { playlists: [{ createdAt: NOW - 3 * DAY, added: Array.from({ length: 30 }, (_, k) => NOW - k * DAY) }, { createdAt: NOW - 9 * DAY, added: [] }] } }),
  ardilla: make({ day: i => ({ h: rot(i), ad: 5 }), extra: { favs: Array.from({ length: 24 }, (_, k) => NOW - k * DAY) } }),
  pinguino: make({ active: i => i % 10 !== 9, day: () => ({ h: [0, 0, 0, 0, 0, 1, 8, 1] }) }),
  ballena: make({ day: i => ({ h: rot(i), lg: 6, al: 6, dn: 10, s: 4200 }) }),
};
for (const [id, src] of Object.entries(PROFILES)) {
  const r = run(src);
  check(top(r) === id, `perfil de ${id} → ${top(r)} (${r.res.primary?.score ?? '-'} puntos; siguientes: ${r.res.scores.slice(1, 3).map(x => `${x.id} ${x.score}`).join(', ')})`);
  const ex = r.res.primary && C.explain(r.res.primary.id, r.I);
  check(ex && ex.why.length >= 1 && ex.why.every(w => typeof w === 'string' && !/undefined|NaN/.test(w)), `  su explicación sale de sus cifras: «${ex?.why[0]}»`);
}
// la explicación coincide con el indicador
{
  const r = run(PROFILES.buho), night = Math.round(r.I.m.night * 100);
  check(C.explain('buho', r.I).why[0].startsWith(`${night} %`), `la explicación del búho muestra el mismo ${night} % que usa la regla`);
  const part = r.res.primary.parts.find(x => x.key === 'night');
  check(Math.abs(part.value - r.I.m.night) < 1e-9 && part.r === C.ramp(r.I.m.night, 0.25, 0.6), 'el desglose de la puntuación usa ese mismo indicador');
}

// ------------------------------------------------------- datos insuficientes
{
  const few = run(make({ days: 30, active: i => i < 1 }));
  check(!few.res.primary && few.res.reason === 'few' && !few.I.enough, 'un solo día con música: no se asigna animal («tomando forma»)');
  const empty = run({ days: {}, all: {}, playlists: [], favs: [], passport: [] });
  check(!empty.res.primary && empty.res.scores.length === 0, 'sin historial: ningún animal y ninguna puntuación');
  const flat = run(make({ day: i => ({ h: hours([4, 5, 6][i % 3]) }) }));   // tardes repartidas, nada destaca
  check(!flat.res.primary && flat.res.reason === 'flat' && flat.I.enough, `escucha sin ningún patrón marcado: tampoco se elige uno al azar (mejor puntuación: ${flat.res.scores[0]?.score})`);
  const week = run(make({ days: 7, active: () => true, day: () => ({ h: [3, 1, 0, 0, 0, 0, 1, 5] }) }), '7');
  check(week.res.primary?.id === 'buho', 'el período de 7 días funciona con sus propios datos');
  const old = make({ days: 60, active: i => i >= 40, day: () => ({ h: [3, 1, 0, 0, 0, 0, 1, 5] }) });
  check(!run(old, '30').res.primary && run(old, '90').res.primary?.id === 'buho', 'lo escuchado hace 40 días no cuenta en «30 días» y sí en «90 días»');
}

// --------------------------------------------------------- animal secundario
{
  const both = run(make({ day: i => ({ h: [3, 1, 0, 0, 0, 0, 1, 5], nw: 5, rp: 5, na: 2 }) }));
  check(both.res.primary && both.res.secondary && new Set([both.res.primary.id, both.res.secondary.id]).size === 2
    && ['buho', 'zorro'].includes(both.res.primary.id) && ['buho', 'zorro'].includes(both.res.secondary.id), `noctámbulo que además descubre mucho → ${both.res.primary?.id} + ${both.res.secondary?.id}`);
  const solo = run(PROFILES.buho);
  check(solo.res.primary.id === 'buho' && !solo.res.secondary, `sin otro patrón con evidencia no hay secundario (segundo: ${solo.res.scores[1]?.id} ${solo.res.scores[1]?.score})`);
  check(both.res.secondary.score >= C.MIN_SECONDARY && both.res.secondary.score >= both.res.primary.score * C.SECONDARY_RATIO, 'el secundario cumple los dos umbrales documentados');
}

// --------------------------------------------- más horas no dan más puntos
{
  const a = run(PROFILES.buho), heavy = structuredClone(PROFILES.buho);
  for (const d of Object.values(heavy.days)) for (const k of ['p', 's', 'ls', 'dn', 'sk', 'rp', 'fa', 'cs', 'ax', 'al', 'dt', 'da']) d[k] *= 6, d.h = d.h.map(x => x), d.g = Object.fromEntries(Object.entries(d.g).map(([g, n]) => [g, n * 6]));
  for (const d of Object.values(heavy.days)) d.h = d.h.map(x => x * 6);
  const b = run(heavy);
  check(a.res.primary.score === b.res.primary.score && b.res.primary.id === 'buho', 'escuchar seis veces más con el mismo reparto da la misma puntuación');
}

// ------------------------------------------------------------- ADN musical
{
  const z = run(PROFILES.zorro), l = run(PROFILES.lobo), g = run(PROFILES.aguila);
  const v = (r, id) => r.dna.find(d => d.id === id).value;
  check(v(z, 'exploracion') > v(l, 'exploracion') && v(l, 'repeticion') > v(z, 'repeticion'), `ADN: el zorro explora más (${v(z, 'exploracion')} frente a ${v(l, 'exploracion')}) y el lobo repite más (${v(l, 'repeticion')} frente a ${v(z, 'repeticion')})`);
  check(v(g, 'geografia') === 100 && v(l, 'geografia') === null, 'ADN: diversidad geográfica 100 con 8 países y «sin datos» (no 0) sin radio');
  check(z.dna.every(d => d.how && (d.value === null || (d.value >= 0 && d.value <= 100))), 'ADN: siete dimensiones entre 0 y 100, cada una con su método');
  const d7 = run(PROFILES.zorro, '7'), d30 = run(PROFILES.zorro, '30');
  check(d7.I.f.days < d30.I.f.days && d7.dna.length === 7, 'ADN: al cambiar el período se recalcula con otros días');
}

// ------------------------------------------------------------ metamorfosis
{
  const owl = run(PROFILES.buho), fox = run(PROFILES.zorro);
  let st = C.step({}, owl.res, owl.I, NOW);
  check(st.official.a === 'buho' && st.event.type === 'born' && st.entry.key === '2026-11' && st.entry.a === 'buho', 'la primera clasificación crea la criatura y su entrada del mes');
  let s2 = C.step(st, fox.res, fox.I, NOW + DAY);
  check(s2.official.a === 'buho' && s2.cand.id === 'zorro' && s2.cand.days.length === 1 && !s2.event, 'un día por delante no basta: sigue el búho, con candidato');
  const back = C.step(s2, owl.res, owl.I, NOW + 2 * DAY);
  check(back.official.a === 'buho' && !back.cand, 'si el patrón vuelve, el candidato se descarta (no oscila)');
  let s3 = C.step(s2, fox.res, fox.I, NOW + 2 * DAY), s4 = C.step(s3, fox.res, fox.I, NOW + 3 * DAY);
  check(s3.official.a === 'buho' && s4.official.a === 'zorro' && s4.event.type === 'change' && s4.event.from === 'buho' && s4.entry.from === 'buho',
    `tras ${C.SWITCH_DAYS} días distintos con ${C.SWITCH_MARGIN}+ puntos de ventaja hay metamorfosis, y queda anotado de qué animal venía`);
  const same = C.step(s2, fox.res, fox.I, NOW + DAY + 3600000);
  check(same.cand.days.length === 1, 'varias revisiones el mismo día cuentan como un solo día');
  // ventaja pequeña: no hay candidato
  const close = structuredClone(fox.res); close.primary = { ...close.primary, score: (close.scores.find(x => x.id === 'buho')?.score || 0) + C.SWITCH_MARGIN - 1 };
  check(!C.step(st, close, fox.I, NOW + DAY).cand, 'con menos ventaja que el umbral no empieza ningún cambio');
  const diff = C.diffEntries(st.entry, s4.entry);
  check(Array.isArray(diff), 'las entradas del bestiario se pueden comparar entre sí');
}

// ------------------------------------------------ definiciones y geometrías
{
  check(C.ANIMALS.length === 15 && new Set(C.ANIMALS.map(a => a.id)).size === 15, '15 animales con identificador propio');
  check(new Set(C.ANIMALS.map(a => JSON.stringify(a.rules))).size === 15 && new Set(C.ANIMALS.map(a => a.sub)).size === 15 && new Set(C.ANIMALS.map(a => a.text)).size === 15, 'los 15 tienen reglas, subtítulo y texto distintos');
  check(C.ANIMALS.every(a => a.rules.some(r => r[4]) && a.facts.length && a.look.colors.length === 2 && a.look.habitat && a.look.motion), 'cada definición trae reglas, hechos, colores, movimiento y hábitat');
  check(C.ANIMALS.every(a => SHAPES[a.id]) && shapeIds().length === 15, 'cada animal tiene su geometría 3D');
  // huella de cada volumen: signo de la distancia en una rejilla de puntos
  const print = id => { let s = ''; for (let x = -1.1; x <= 1.1; x += 0.1) for (let y = -0.9; y <= 1; y += 0.1) for (let z = 0; z <= 1.2; z += 0.2) s += distance(id, x, y, z) < 0 ? '1' : '0'; return s; };
  const prints = shapeIds().map(print);
  check(new Set(prints).size === 15, 'las 15 geometrías son volúmenes distintos (no una misma forma deformada)');
  const pts = sample('lobo', 3000);
  let on = 0, depth = 0;
  for (let i = 0; i < pts.length; i += 3) { if (Math.abs(pts[i + 2]) > 0.03) depth++; if (Math.hypot(pts[i], pts[i + 1], pts[i + 2]) <= 1.0001) on++; }
  check(on === 3000 && depth > 1500, `las partículas ocupan un volumen 3D real (${depth} de 3000 fuera del plano central) y caben en radio 1`);
  const again = sample('lobo', 3000);
  check(again === pts || again.every((v, i) => v === pts[i]), 'la nube de un animal es siempre la misma (determinista)');
}

// ------------------------------------------------------ unión entre dispositivos
{
  const m = C.mergeDay({ p: 5, h: [1, 0, 2], g: { Pop: 3 }, ss: [10], rc: { ES: 60 } }, { p: 3, h: [0, 4, 1], g: { Pop: 1, Jazz: 2 }, ss: [30, 5], rc: { JP: 90 } });
  check(m.p === 5 && m.h.join() === '1,4,2' && m.g.Pop === 3 && m.g.Jazz === 2 && m.ss.join() === '30,5' && m.rc.ES === 60 && m.rc.JP === 90, 'dos dispositivos: de cada contador queda el más alto y no se duplica nada');
}

console.log(`\n${ok} comprobaciones correctas, ${fails} fallos`);
process.exit(fails ? 1 : 0);
