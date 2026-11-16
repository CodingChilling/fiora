// Estadísticas por pestañas de Perfil y «Resumen del mes», con datos sembrados (seed-stats.cjs).
// Solo necesita la app en :8765 y los audios de ../playlists/fixtures. No usa Supabase.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const APP = process.env.APP || 'http://localhost:8765/';
const FIX = path.join(__dirname, '..', 'playlists', 'fixtures', 'audio');
const SHOTS = process.env.SHOTS || '';
const seed = require('./seed-stats.cjs');
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const audio = fs.readdirSync(FIX).map(f => ({ name: f, mimeType: 'audio/wav', buffer: fs.readFileSync(path.join(FIX, f)) }));
  const until = async (page, fn, arg, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(150); } return false; };
  async function device(name, mobile) {
    const ctx = await b.newContext({ ...(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 900 } }), acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|GPU stall|GL Driver/.test(m.text())) errs.push(`${name} consola: ${m.text()}`); });
    await page.goto(APP + '#/inicio'); await page.waitForSelector('#nav-links a');
    await page.setInputFiles('#pick-files', audio);
    await until(page, async () => (await import('./js/store.js')).S.tracks.size >= 6);
    return page;
  }
  const open = async (page, tab) => { await page.goto(APP + '#/inicio'); await page.waitForSelector('.wrap'); await page.goto(APP + '#/perfil'); await page.waitForSelector('.sx-tabs'); if (tab) { await page.click(`.sx-tabs [data-t="${tab}"]`); await page.waitForSelector(`[data-sx-tab="${tab}"]`); } };
  const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const shot = async (page, name) => { if (SHOTS) { await page.locator('.sx-body').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/stats-${name}.png` }); } };

  const A = await device('A', false);
  // sin escuchas
  await open(A);
  check((await A.$$eval('.sx-tabs button', x => x.map(e => e.textContent)).then(x => x.join())) === 'Resumen,Tiempo,Gustos,Biblioteca,Conexiones', 'Perfil tiene las cinco pestañas de estadísticas');
  check(/Aún no hay escuchas/.test(await A.innerText('.sx-body')) && !(await A.$('[data-act="sx-recap"]')), 'Sin escuchas: aviso, y no se ofrece el resumen del mes');
  await A.click('.sx-tabs [data-t="conexiones"]'); await A.waitForSelector('[data-sx-tab="conexiones"]');
  check(/Aparecerá cuando hayas puesto/.test(await A.innerText('.sx-net')) && !(await A.$('.net')), 'Sin datos, cada bloque dice qué falta en lugar de pintar un gráfico vacío');
  await A.click('.sx-tabs [data-t="resumen"]');

  await A.evaluate(seed);
  // --- Resumen: lo de siempre
  await open(A, 'resumen');
  const res = await A.evaluate(() => ({ tiles: document.querySelectorAll('.sx-body .stat-row.tiles .stat').length, heads: [...document.querySelectorAll('.sx-body .panel > h2')].map(h => h.textContent) }));
  check(res.tiles === 6 && ['Últimos 30 días', 'A qué hora escuchas', 'Qué días', 'Tus artistas', 'Tus canciones'].every(h => res.heads.includes(h)), 'Resumen: las estadísticas de siempre siguen intactas');

  // --- Tiempo
  await open(A, 'tiempo');
  const today = await A.evaluate(async () => { const st = await import('./js/store.js'); const k = st.dayKey(); return { k, v: st.S.hist.days[k] }; });
  const heat = await A.evaluate(() => ({ cells: document.querySelectorAll('.heat i[data-day]').length, last: [...document.querySelectorAll('.heat i[data-day]')].at(-1).dataset.day, levels: new Set([...document.querySelectorAll('.heat i[data-day]')].map(i => i.className)).size }));
  check(heat.cells > 360 && heat.last === today.k && heat.levels === 5, `Calendario de calor: ${heat.cells} días hasta hoy, con cinco intensidades`);
  let tipTxt = '';
  for (let i = 0; i < 4 && !tipTxt; i++) { await A.mouse.move(5, 5); await A.hover(`.heat i[data-day="${today.k}"]`); tipTxt = await A.evaluate(() => (document.querySelector('#tip').hidden ? '' : document.querySelector('#tip').textContent)); }
  check(today.v ? tipTxt.includes(`${Math.round(today.v[1] / 60)} min`) && tipTxt.includes(`${today.v[0]} canci`) : /sin música/.test(tipTxt), `Al señalar un día se ven sus datos: «${tipTxt}»`);
  const peak = await A.evaluate(async () => { const h = (await import('./js/store.js')).S.hist.hours; return h.indexOf(Math.max(...h)); });
  check((await A.$$('.clock path')).length === 24 && (await A.innerText('.clock')).includes(`${peak}:00`) && (await A.$$('.clock path.peak')).length === 1, `Reloj de 24 horas con la hora punta (${peak}:00)`);
  const calc = await A.evaluate(async () => { const X = await import('./js/stats-extra.js'), st = await import('./js/store.js'), h = await import('./js/habits.js'); return { s: X.streaks(st.S.hist.days), w: X.weekCompare(st.S.hist.days), ses: X.sessionsHist(h.H.days) }; });
  const timeTxt = await A.innerText('.sx-body');
  check(timeTxt.includes(`${calc.w.cur.min} min`) && new RegExp(`${calc.s.longest} días?\\s*\\n?racha más larga`).test(timeTxt.replace(/\n+/g, '\n')), `Semana y rachas con los valores calculados (${calc.w.cur.min} min, racha más larga ${calc.s.longest})`);
  check(timeTxt.includes(`${calc.ses.count} sesiones`) && (await A.$$('.sx-body .hbars li')).length === 5, `Sesiones: ${calc.ses.count} en cinco tramos`);
  await shot(A, 'tiempo');

  // --- Gustos
  await open(A, 'gustos');
  const taste = await A.evaluate(() => ({ dec: [...document.querySelectorAll('.sx-panel')].find(p => /Máquina/.test(p.textContent)).querySelectorAll('.hbars li').length, mood: document.querySelectorAll('.mood-grid i').length, river: document.querySelectorAll('.river polygon').length, tm: document.querySelectorAll('.treemap div').length, txt: document.querySelector('.sx-body').innerText }));
  check(taste.dec >= 4 && /año medio de tu música es \d{4}/.test(taste.txt), `Máquina del tiempo: ${taste.dec} décadas y el año medio`);
  check(taste.mood === 4 * 5 && /suenan a música/.test(taste.txt), 'Ambiente por franja: matriz de 4 franjas y la frase resumen');
  check(taste.river >= 3 && /esta semana/.test(taste.txt), `Río de géneros con ${taste.river} bandas`);
  check(taste.tm >= 5 && /son el \d+ % de tus escuchas/.test(taste.txt), `Concentración: ${taste.tm} bloques y la frase con el porcentaje`);
  const tm = await A.$$eval('.treemap div', ds => ds.map(d => { const r = d.getBoundingClientRect(); return r.width * r.height; }));
  check(tm[0] >= Math.max(...tm) - 1, 'El artista más escuchado ocupa el bloque más grande');
  check((await A.$$('.sx-body details.glist')).length >= 3, 'Cada gráfico tiene su tabla «Ver los datos»');
  await shot(A, 'gustos');

  // --- Biblioteca
  await open(A, 'biblioteca');
  const libTxt = await A.innerText('.sx-body');
  check(/100 %/.test(await A.textContent('.sx-ring')) && /6 de 6/.test(libTxt), 'Cuánto has explorado: anillo y recuento');
  const forgot = await A.evaluate(async () => { const X = await import('./js/stats-extra.js'), st = await import('./js/store.js'); return X.forgottenFavs([...st.S.tracks.values()].map(t => ({ id: t.id, fav: st.isFav(t.id), last: st.S.stats[t.id]?.last || 0 }))).map(f => st.S.tracks.get(f.id).title); });
  const shown = await A.$$eval('.sx-forgot .row b', x => x.map(e => e.textContent));
  check(forgot.length >= 1 && JSON.stringify(shown) === JSON.stringify(forgot), `Favoritas olvidadas: ${forgot.join(', ')}`);
  await A.click('[data-act="sx-play-forgotten"]');
  check(await until(A, async t => { const { P } = await import('./js/player.js'); return P.current?.title === t; }, forgot[0]), '«Reproducir todas» pone a sonar la primera');
  check(/Siempre las saltas[\s\S]*DÁKITI[\s\S]*\d+ %/.test(libTxt), 'Listas de canciones que nunca o siempre saltas');
  check((await A.$$('.growth polyline')).length === 2 && /canciones más que hace un año/.test(libTxt), 'Crecimiento de la biblioteca y de las favoritas');
  await shot(A, 'biblioteca');

  // --- Conexiones
  await open(A, 'conexiones');
  const net = await A.evaluate(() => ({ nodes: document.querySelectorAll('.net .net-node').length, lines: document.querySelectorAll('.net line').length, list: document.querySelectorAll('.net-list button').length }));
  check(net.nodes === 6 && net.lines >= 6 && net.list === net.nodes, `Red de canciones seguidas: ${net.nodes} canciones y ${net.lines} uniones, con lista equivalente`);
  await A.click('.net .net-node');
  await A.waitForSelector('[data-sx-companions]');
  const comp = await A.evaluate(async () => { const X = await import('./js/stats-extra.js'), st = await import('./js/store.js'); const id = document.querySelector('.net-node.on').dataset.id; return X.companions(st.S.trans, id).map(c => st.S.tracks.get(c.id).title); });
  const compShown = await A.$$eval('.sx-net .rows .row b', x => x.map(e => e.textContent));
  check(JSON.stringify(compShown) === JSON.stringify(comp) && (await A.$$('.net line.on')).length >= 1, `Al tocar una canción se ven sus compañeras: ${comp.join(', ')}`);
  await A.focus('.net .net-node:nth-of-type(2)'); await A.keyboard.press('Enter'); await A.waitForTimeout(400);
  check((await A.$eval('.net-node.on', e => e.getAttribute('aria-label'))).length > 0 && (await A.$$('.net-node.on')).length === 1, 'La red también se maneja con el teclado');
  await until(A, () => !!document.querySelector('[data-sx-map] canvas, [data-sx-map] svg'));
  check(!!(await A.$('[data-sx-map] canvas, [data-sx-map] svg')) && (await A.$$('.sx-countries li')).length === 2 && /min de radio/.test(await A.innerText('.sx-countries')), 'Mapa de radios con sus países y minutos');
  await shot(A, 'conexiones');

  // --- la pestaña se recuerda
  await A.reload(); await A.waitForSelector('.sx-tabs');
  check(await A.$eval('.sx-tabs button.on', e => e.dataset.t) === 'conexiones', 'La pestaña elegida se recuerda');

  // --- Resumen del mes
  await A.click('[data-act="sx-recap"]'); await A.waitForSelector('.recap-card');
  const months = await A.$$eval('[data-recap-month] option', o => o.map(x => x.value));
  const rec = await A.evaluate(async m => { const X = await import('./js/stats-extra.js'), st = await import('./js/store.js'), h = await import('./js/habits.js'); return X.monthRecap(st.S.hist.days, h.H.days, m); }, months[0]);
  const cards = await A.$$eval('.recap-card', c => c.map(x => x.innerText));
  check(months.length >= 10 && cards.length >= 4 && cards[0].includes(`${rec.days} días de ${rec.daysInMonth}`) && cards[0].includes(`${rec.plays} canciones`), `Resumen del mes: ${cards.length} tarjetas con los datos del mes (${rec.days} días, ${rec.plays} canciones)`);
  check(cards.some(c => /de siempre/i.test(c) && /no se guardan por mes/.test(c)), 'Dice claramente qué dato es «de siempre» y no del mes');
  const sc = await A.$eval('.recap-cards', e => [e.scrollWidth > e.clientWidth, getComputedStyle(e).scrollSnapType]);
  check(sc[0] && /x/.test(sc[1]), 'Las tarjetas se deslizan en horizontal');
  await A.selectOption('[data-recap-month]', months[3]); await A.waitForSelector(`.recap[data-month="${months[3]}"]`);
  const rec3 = await A.evaluate(async m => { const X = await import('./js/stats-extra.js'), st = await import('./js/store.js'), h = await import('./js/habits.js'); return X.monthRecap(st.S.hist.days, h.H.days, m); }, months[3]);
  check((await A.innerText('.recap-card')).includes(`${rec3.days} días de ${rec3.daysInMonth}`), 'Se puede elegir otro mes');
  if (SHOTS) await A.locator('#sheet').screenshot({ path: `${SHOTS}/stats-resumen-mes.png` });
  const [dl] = await Promise.all([A.waitForEvent('download', { timeout: 15000 }), A.click('.recap [data-ok]')]);
  const file = await dl.path(), size = fs.statSync(file).size;
  check(dl.suggestedFilename() === `fiora-${months[3]}.png` && fs.readFileSync(file).subarray(1, 4).toString() === 'PNG' && size > 20000, `Se guarda como imagen PNG (${Math.round(size / 1024)} KB)`);
  if (SHOTS) fs.copyFileSync(file, `${SHOTS}/stats-resumen-mes-imagen.png`);

  // --- móvil
  const B = await device('B', true);
  await B.evaluate(seed);
  for (const t of ['tiempo', 'gustos', 'biblioteca', 'conexiones']) {
    await open(B, t); await B.waitForTimeout(300);
    const okFit = await fits(B), n = await B.$$eval('.sx-body .panel', p => p.length);
    check(okFit && n >= 2, `Móvil · ${t}: ${n} bloques, sin desplazamiento horizontal de la página`);
    await shot(B, `movil-${t}`);
  }
  await open(B, 'tiempo');
  const hs = await B.$eval('[data-heat]', e => [e.scrollWidth > e.clientWidth, Math.abs(e.scrollLeft + e.clientWidth - e.scrollWidth) < 3]);
  check(hs[0] && hs[1], 'Móvil: el calendario se desplaza dentro de su caja y empieza mostrando hoy');
  await B.tap(`.heat i[data-day="${today.k}"]`); await B.waitForTimeout(200);
  check(await B.evaluate(() => !document.querySelector('#tip').hidden), 'Móvil: tocar un día muestra sus datos');

  check(errs.length === 0, `Sin errores en consola${errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''}`);
  console.log(`\n${ok} comprobaciones correctas, ${fails} fallos`);
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
