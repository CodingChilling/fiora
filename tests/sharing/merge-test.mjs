// Pruebas de la fusión de tres vías (js/merge.js): node merge-test.mjs
import { mergeLists } from '../../js/merge.js';
let ok = 0, fails = 0;
const check = (got, want, m) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m, '\n  obtenido', g, '\n  esperado', w); } };
const P = (trackIds, trackSection = {}, sections = []) => ({ trackIds, trackSection, sections: sections.map(id => ({ id, name: id })), added: Object.fromEntries(trackIds.map(t => [t, 1])) });
const base = P(['a', 'b', 'c'], { a: 's1' }, ['s1']);
check(mergeLists(base, P(['a', 'b', 'c', 'd'], { a: 's1' }, ['s1']), base).trackIds, ['a', 'b', 'c', 'd'], 'solo yo añado: vale lo mío');
check(mergeLists(base, base, P(['a', 'c'], { a: 's1' }, ['s1'])).trackIds, ['a', 'c'], 'solo ellos quitan: vale lo suyo');
check(mergeLists(base, P(['a', 'b', 'c', 'd'], { a: 's1' }, ['s1']), P(['a', 'b', 'c', 'e'], { a: 's1' }, ['s1'])).trackIds, ['a', 'b', 'c', 'e', 'd'], 'los dos añaden: están las dos');
check(mergeLists(base, P(['a', 'c'], { a: 's1' }, ['s1']), P(['a', 'b', 'c', 'e'], { a: 's1' }, ['s1'])).trackIds, ['a', 'c', 'e'], 'yo quito b, ellos añaden e');
check(mergeLists(base, P(['c', 'b', 'a'], { a: 's1' }, ['s1']), P(['a', 'b', 'c', 'e'], { a: 's1' }, ['s1'])).trackIds, ['c', 'b', 'a', 'e'], 'yo reordeno, ellos añaden: mi orden con lo suyo');
check(mergeLists(base, P(['a', 'x', 'b', 'c'], { a: 's1' }, ['s1']), P(['c', 'a', 'b'], { a: 's1' }, ['s1'])).trackIds, ['c', 'a', 'x', 'b'], 'ellos reordenan, yo inserto en medio: tras su vecina');
const r = mergeLists(base, P(['a', 'b', 'c'], { a: 's1', b: 's2' }, ['s1', 's2']), P(['a', 'b', 'c'], { a: 's1', c: 's3' }, ['s1', 's3']));
check([r.sections.map(s => s.id), r.trackSection], [['s1', 's3', 's2'], { a: 's1', b: 's2', c: 's3' }], 'capítulos nuevos de los dos lados y canciones movidas por cada uno');
const r2 = mergeLists(base, P(['a', 'b', 'c'], {}, []), P(['a', 'b', 'c', 'e'], { a: 's1' }, ['s1']));
check([r2.sections, r2.trackSection, r2.trackIds], [[], {}, ['a', 'b', 'c', 'e']], 'yo borro el capítulo: sus canciones quedan sin capítulo');
check(Object.keys(mergeLists(base, P(['a', 'c', 'd']), P(['a', 'b', 'c', 'e'])).added).sort(), ['a', 'c', 'd', 'e'], 'fechas de alta solo de las que quedan');
console.log(`\n${ok} correctas · ${fails} fallos`); process.exitCode = fails ? 1 : 0;
