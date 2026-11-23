// Modo Sorpresa: lo olvidado primero, favoritas olvidadas de vez en cuando, sin repetir artista o álbum
// seguidos y lo escuchado en la ventana (una semana por defecto) al final. Ejecuta el algoritmo real
// muchas veces sobre una biblioteca de prueba. Necesita solo la app en :8765.
const { chromium } = require('playwright');

const APP = process.env.APP || 'http://localhost:8765/';
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP + '#/inicio'); await page.waitForTimeout(700);

  const r = await page.evaluate(async () => {
    const st = await import('./js/store.js'), m = await import('./js/modes.js');
    const DAY = 86400000, now = Date.now();
    // 60 canciones de 6 artistas (2 discos cada uno). Grupos: nunca escuchadas, olvidadas (>180 días),
    // escuchadas hace poco más de una semana, escuchadas esta semana (3 días y 1 hora) y 3 favoritas olvidadas.
    const tracks = [];
    for (let i = 0; i < 60; i++) {
      const a = i % 6;
      tracks.push({ id: 'k' + i, title: 'T' + i, artists: ['Artista ' + a], artist: 'Artista ' + a, album: `Disco ${a}-${i % 2}` });
    }
    st.S.stats = {}; st.S.favs = {};
    const set = (i, daysAgo) => { st.S.stats['k' + i] = { last: now - daysAgo * DAY, plays: 3 }; };
    for (let i = 0; i < 60; i++) {
      if (i < 12) continue;                         // 0-11: nunca escuchadas
      else if (i < 24) set(i, 200 + i);             // 12-23: olvidadas
      else if (i < 50) set(i, 8 + (i % 5) * 0.3);   // 24-49: escuchadas hace poco más de una semana
      else if (i < 55) set(i, 3);                   // 50-54: hace 3 días (dentro de la semana)
      else set(i, 1 / 24);                          // 55-59: hace una hora
    }
    for (const i of [30, 31, 32]) { st.S.favs['k' + i] = { on: true, at: now }; set(i, 60); }   // favoritas olvidadas (2 meses)
    const runs = [];
    for (let n = 0; n < 200; n++) runs.push(m.surpriseOrder(tracks).map(t => +t.id.slice(1)));
    const pos = id => runs.reduce((s, o) => s + o.indexOf(id), 0) / runs.length;
    const avg = ids => ids.reduce((s, i) => s + pos(i), 0) / ids.length;
    const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
    const week = range(50, 60), outside = range(0, 50);
    const tailOk = runs.every(o => o.slice(-10).every(i => week.includes(i)) && o.slice(0, 50).every(i => outside.includes(i)));
    const lastHourLast = runs.every(o => o.slice(-5).every(i => i >= 55));
    const clashes = runs.reduce((s, o) => s + o.slice(1).filter((x, k) => x % 6 === o[k] % 6).length, 0);
    const favEarly = runs.filter(o => o.slice(0, 7).some(i => [30, 31, 32].includes(i))).length / runs.length;
    const distinct = new Set(runs.map(o => o.join())).size;
    const h24 = m.surpriseOrder(tracks, 24).map(t => +t.id.slice(1));
    return { tailOk, lastHourLast, clashes, favEarly, distinct, never: avg(range(0, 12)), forgotten: avg(range(12, 24)), recentish: avg(range(33, 50)), h24tail: h24.slice(-5), h24has3days: range(50, 55).every(i => h24.indexOf(i) < 55) };
  });
  check(r.distinct === 200, `1. Cada vez un orden distinto (${r.distinct} órdenes distintos en 200 tiradas)`);
  check(r.tailOk && r.lastHourLast, '2. Lo escuchado en la última semana va al final, y lo de hace una hora lo último');
  check(r.never < r.recentish - 5 && r.forgotten < r.recentish - 5, `3. Primero lo olvidado: posición media de las nunca escuchadas ${r.never.toFixed(1)} y de las olvidadas ${r.forgotten.toFixed(1)}, frente a ${r.recentish.toFixed(1)} de las escuchadas hace poco más de una semana`);
  check(r.favEarly > 0.9, `4. Una favorita olvidada aparece entre las primeras canciones (en el ${Math.round(r.favEarly * 100)} % de las tiradas)`);
  check(r.clashes === 0, `5. Nunca dos seguidas del mismo artista (${r.clashes} repeticiones en 200 tiradas)`);
  check(r.h24tail.every(i => i >= 55) && r.h24has3days, '6. Con la ventana de 24 horas, solo lo de la última hora va al final (lo de hace 3 días ya no)');

  // --- el ajuste en Ajustes → Audio y reproducción
  await page.goto(APP + '#/ajustes/audio'); await page.waitForSelector('[data-surprise-hours]');
  const opts = await page.$$eval('[data-surprise-hours] option', l => l.map(o => `${o.textContent}${o.selected ? '*' : ''}`));
  check(opts.join() === '24 horas,3 días,Una semana*,Dos semanas,Un mes', `7. Ajustes → Audio: ventana del modo sorpresa, una semana por defecto (${opts.join(', ')})`);
  await page.selectOption('[data-surprise-hours]', '336'); await page.waitForTimeout(300);
  const saved = await page.evaluate(async () => { const st = await import('./js/store.js'), sy = await import('./js/sync.js'); return [st.S.settings.surpriseHours, sy.snapshot(true).prefs.surpriseHours.v]; });
  check(saved[0] === 336 && saved[1] === 336, '   Se guarda (y viaja con la cuenta)');

  check(errs.length === 0, `8. Sin errores en consola${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(`\n${ok} ok, ${fails} fallos`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
