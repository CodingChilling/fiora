// Estadísticas adicionales de Perfil (js/stats-extra.js) con datos fabricados.
//   node stats-test.mjs
import * as X from '../../js/stats-extra.js';
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };
const NOW = new Date('2026-01-07T18:00:00').getTime(), DAY = 86400000;      // miércoles; la semana cruza de año
const k = i => X.dayKey(new Date(NOW - i * DAY));

// --- calendario
{
  const hist = { [k(0)]: [4, 600], [k(1)]: [10, 3000], [k(8)]: [2, 120], [k(400)]: [9, 900] };
  const h = X.heatmap(hist, NOW, 53), cells = h.cols.flat();
  check(h.cols.length === 53 && h.cols.every(c => c.length === 7), 'calendario: 53 semanas de 7 días');
  check(cells.filter(Boolean).at(-1).key === '2026-01-07' && h.cols.at(-1).filter(c => c === null).length === 4, 'la última columna llega hasta hoy (miércoles) y deja vacíos los días que faltan');
  check(h.cols.at(-1)[0].key === '2026-01-05' && h.cols.at(-2)[6].key === '2026-01-04' && h.cols.at(-2)[2].key === '2025-12-31', 'las semanas empiezan en lunes y cruzan bien el cambio de año');
  const by = Object.fromEntries(cells.filter(Boolean).map(c => [c.key, c]));
  check(by[k(1)].level === 4 && by[k(0)].level >= 1 && by[k(0)].level < 4 && by[k(3)].level === 0 && h.max === 50, 'cinco niveles: 0 sin música, 4 el día con más minutos');
  check(h.active === 3 && h.total === 62 && !by[k(400)], 'cuenta días y minutos de la ventana y deja fuera lo anterior');
}
// --- rachas
{
  const hist = {}; for (const i of [0, 1, 2, 5, 6, 7, 8, 9, 20]) hist[k(i)] = [3, 600 + i * 60];
  const s = X.streaks(hist, NOW);
  check(s.current === 3 && s.longest === 5 && s.longestEnd === k(5), `rachas con huecos: actual ${s.current}, más larga ${s.longest}`);
  check(s.best.key === k(20) && s.best.min === 30, 'día récord por minutos');
  delete hist[k(0)];
  check(X.streaks(hist, NOW).current === 2, 'si hoy aún no hay música, la racha de ayer sigue contando');
  delete hist[k(1)];
  check(X.streaks(hist, NOW).current === 0, 'dos días sin música rompen la racha');
  check(X.streaks({}, NOW).longest === 0 && X.streaks({}, NOW).best === null, 'sin historial no se inventa nada');
  const m = X.milestones(120);
  check(m.last === 100 && m.next === 250 && Math.abs(m.progress - 20 / 150) < 1e-9 && X.milestones(3).last === null, 'hitos: último alcanzado, siguiente y progreso');
}
// --- semana
{
  const hist = { [k(0)]: [5, 1200], [k(6)]: [5, 600], [k(7)]: [8, 2400], [k(13)]: [2, 600], [k(14)]: [50, 9000] };
  const w = X.weekCompare(hist, NOW);
  check(w.cur.plays === 10 && w.cur.min === 30 && w.cur.days === 2 && w.prev.plays === 10 && w.prev.min === 50 && w.delta.min === -20 && w.delta.plays === 0, 'últimos 7 días frente a los 7 anteriores (el día 15 no entra)');
}
// --- sesiones
{
  const s = X.sessionsHist({ a: { ss: [5, 15, 16] }, b: { ss: [45, 130] }, c: {} });
  check(s.count === 5 && s.bins.map(b => b.n).join() === '2,1,1,0,1' && s.longest === 130 && s.longestDay === 'b' && s.mean === 42, 'sesiones por tramos, media y la más larga');
  check(X.sessionsHist({}).count === 0, 'sin sesiones: cero, sin inventar');
}
// --- décadas
{
  const d = X.decades([{ year: 1985, plays: 10 }, { year: 1989, plays: 5 }, { year: 2015, plays: 15 }, { year: 0, plays: 7 }, { year: 2020, plays: 0 }, { year: 'x', plays: 1 }]);
  check(JSON.stringify(d.list) === '[[1980,15],[2010,15]]' && d.noYear === 8 && d.withYear === 30 && d.mean === 2001, `décadas: las canciones sin año se cuentan aparte (${d.noYear}) y el año medio es ponderado (${d.mean})`);
}
// --- ambiente por franja
{
  const m = X.moodByPart([{ moods: ['alegre'], h: [0, 8, 2, 0] }, { moods: ['triste', 'íntima'], h: [0, 2, 0, 6] }, { moods: [], h: [9, 9, 9, 9] }, { moods: ['alegre'] }]);
  check(m.moods[0] === 'alegre' && m.top[1] === 'alegre' && m.top[3] === 'triste' && m.top[0] === null && m.top[2] === null, 'ambiente dominante por franja; las franjas con pocas escuchas no dicen nada');
  check(Math.abs(m.matrix[1][0] - 0.8) < 1e-9 && m.tagged === 18, 'cada celda es la parte de las escuchas etiquetadas de esa franja; las canciones sin etiqueta no cuentan');
}
// --- río de géneros
{
  const days = { [k(0)]: { g: { Pop: 5, Jazz: 1 } }, [k(8)]: { g: { Pop: 2, Rock: 4 } }, [k(200)]: { g: { Folk: 99 } }, [k(1)]: { p: 3 } };
  const r = X.genreRiver(days, NOW, 12, 2);
  check(r.genres.join() === 'Pop,Rock,Otros' && r.series[0].at(-1) === 5 && r.series[0].at(-2) === 2 && r.series[1].at(-2) === 4 && r.series[2].at(-1) === 1 && r.weeksWithData === 2, 'río: escuchas por semana de los géneros principales y «Otros»; lo anterior a la ventana no entra');
  check(r.labels.length === 12 && r.labels.at(-1) === '2026-01-05', 'cada columna es una semana que empieza en lunes');
}
// --- concentración y bloques
{
  const list = Array.from({ length: 20 }, (_, i) => [`A${i}`, 20 - i]), c = X.concentration(list);
  check(c.total === 210 && c.count === 20 && Math.abs(c.top10 - 155 / 210) < 1e-9 && c.top.length === 12 && c.rest === 210 - 174, 'concentración: parte de los 10 primeros y «los demás»');
  const t = X.treemap([['a', 50], ['b', 30], ['c', 20]]);
  const area = t.reduce((n, b) => n + b.w * b.h, 0);
  check(t.length === 3 && Math.abs(area - 10000) < 1e-6 && Math.abs(t[0].w * t[0].h - 5000) < 1e-6 && t.every(b => b.x >= 0 && b.y >= 0 && b.x + b.w <= 100.0001 && b.y + b.h <= 100.0001), 'bloques: llenan el rectángulo y su área es proporcional');
  check(X.treemap([]).length === 0 && X.concentration([]).total === 0, 'sin datos: nada');
}
// --- biblioteca
{
  const e = X.explored([{ plays: 1, album: 'x' }, { plays: 2, album: 'x' }, { plays: 3, album: 'x' }, { plays: 0, album: 'y' }, { plays: 1, album: 'y' }, { plays: 1, album: 'y' }, { plays: 1, album: 'z' }, { plays: 0, album: '' }]);
  check(e.heard === 6 && e.total === 8 && e.albums === 2 && e.albumsDone === 1, 'explorado: canciones escuchadas y álbumes enteros (los de menos de 3 canciones no cuentan)');
  const f = X.forgottenFavs([{ id: 'a', fav: true, last: NOW - 100 * DAY }, { id: 'b', fav: true, last: NOW - 10 * DAY }, { id: 'c', fav: false, last: NOW - 300 * DAY }, { id: 'd', fav: true, last: 0 }], NOW);
  check(f.map(x => x.id).join() === 'd,a' && f[1].days === 100 && f[0].days === null, 'favoritas olvidadas: más de 90 días o nunca escuchadas; las no favoritas no salen');
  const s = X.skipLists([{ id: 'a', plays: 10, done: 10, skips: 0 }, { id: 'b', plays: 2, done: 1, skips: 8 }, { id: 'c', plays: 2, done: 2, skips: 1 }, { id: 'd', plays: 5, done: 3, skips: 1 }]);
  check(s.never.map(x => x.id).join() === 'a' && s.always.map(x => x.id).join() === 'b' && s.always[0].skip === 0.8, 'saltos: solo con 5 intentos o más');
  const g = X.growth([NOW - 400 * DAY, NOW - 40 * DAY, NOW - DAY], [NOW - 2 * DAY], NOW, 3);
  check(g.map(x => x.lib).join() === '2,2,3' && g.map(x => x.favs).join() === '0,0,1' && g.at(-1).key === '2026-01', 'crecimiento acumulado por mes');
}
// --- conexiones
{
  const trans = { a: { b: 3, c: 1 }, b: { a: 2, d: 1 }, c: { a: 1 }, x: { y: 9 } };
  const t = X.transitions(trans, 25, new Set(['a', 'b', 'c', 'd']));
  check(t.pairs.length === 2 && t.pairs[0].n === 5 && [t.pairs[0].a, t.pairs[0].b].sort().join() === 'a,b' && t.pairs[1].n === 2, 'parejas: se suman los dos sentidos, mínimo dos veces, y solo canciones que siguen en la biblioteca');
  check(t.nodes[0].id === 'a' && t.nodes[0].w === 7, 'las canciones se ordenan por lo conectadas que están');
  check(X.companions(trans, 'a').map(x => `${x.id}${x.times}`).join() === 'b5,c2', 'compañeras de una canción, antes o después');
  check(X.radioCountries({ a: { rc: { ES: 600, JP: 20 } }, b: { rc: { ES: 60 } } }).map(x => `${x.cc}${x.min}`).join() === 'ES11', 'minutos de radio por país (menos de un minuto no cuenta)');
}
// --- resumen del mes
{
  const hist = { '2025-12-30': [4, 1200], '2025-12-31': [9, 3600], '2026-01-02': [1, 60] };
  const hab = { '2025-12-30': { g: { Pop: 4 }, ss: [20], nw: 2 }, '2025-12-31': { g: { Jazz: 9 }, ss: [60, 5], rs: 600, rc: { ES: 600 } }, '2026-01-02': { g: { Rock: 1 } } };
  check(X.monthsWithData(hist).join() === '2026-01,2025-12', 'meses con datos, del más reciente al más antiguo');
  const r = X.monthRecap(hist, hab, '2025-12');
  check(r.days === 2 && r.daysInMonth === 31 && r.plays === 13 && r.min === 80 && r.best.key === '2025-12-31' && r.genre === 'Jazz' && r.sessions === 3 && r.longest === 60 && r.radioMin === 10 && r.countries === 1 && r.newTracks === 2, 'resumen de diciembre solo con lo de diciembre');
  const e = X.monthRecap(hist, hab, '2025-06');
  check(e.days === 0 && e.plays === 0 && e.best === null && e.genre === null, 'un mes sin datos queda vacío');
}
console.log(`\n${ok} comprobaciones correctas, ${fails} fallos`);
process.exit(fails ? 1 : 0);
