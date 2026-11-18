// Ajustes reorganizados en secciones y la guía para crear y conectar un bucket (Ajustes → Ayuda).
// Necesita la app en :8765, el emulador de Supabase en :8766 y el de Oracle en :8769 (ver README.md).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = process.env.APP || 'http://localhost:8765/';
const API = process.env.API || 'http://localhost:8766';
const ORACLE = process.env.ORACLE || 'http://localhost:8769';
const SB = 'https://rabhgmnjvxwlttlviywc.supabase.co';
const OWNER_PAR = `${ORACLE}/p/dueno/n/ns/b/musica/o/`;
const KEYS = path.join(__dirname, '..', 'sharing', 'fixtures');
const SHOTS = process.env.SHOTS;
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

(async () => {
  await fetch(ORACLE + '/__reset');
  await fetch(OWNER_PAR + 'Artista%20-%20Cancion.mp3', { method: 'PUT', body: Buffer.alloc(2048, 1) });
  const b = await chromium.launch();
  const errs = [];
  const device = async (viewport) => {
    const ctx = await b.newContext({ viewport });
    await ctx.route(SB + '/**', async route => { try { await route.fulfill({ response: await route.fetch({ url: route.request().url().replace(SB, API) }) }); } catch { await route.abort('failed').catch(() => {}); } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|localhost:8769/.test(m.text())) errs.push(`consola: ${m.text()}`); });
    return page;
  };
  const until = async (page, fn, arg, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
  const steps = page => page.$$eval('.tuto-step', l => l.map(li => ({ t: li.querySelector('.tuto-t b').textContent, done: li.classList.contains('done'), cur: li.classList.contains('cur'), open: li.querySelector('details').open })));
  const wide = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);

  // ===================================================================== portada de Ajustes (móvil)
  const M = await device({ width: 390, height: 844 });
  await M.goto(APP + '#/ajustes'); await M.waitForSelector('.set-list');
  const rows = await M.$$eval('.set-index .set-row', l => l.map(a => ({ t: a.querySelector('b').textContent, s: a.querySelector('small')?.textContent || '', href: a.getAttribute('href') })));
  check(['Cuenta', 'Nube', 'Audio y reproducción', 'Este dispositivo', 'Criatura sonora', 'Modo desarrollador', 'Ayuda'].every(t => rows.some(r => r.t === t)), `1. La portada lista las secciones: ${rows.map(r => r.t).join(' · ')}`);
  check(rows.every(r => r.s.length > 0), '   Cada sección resume su estado en una línea');
  check(rows.find(r => r.t === 'Nube').s === 'Sin conectar' && /Sin sesión/.test(rows.find(r => r.t === 'Cuenta').s), '   Resúmenes reales: «Sin conectar», «Sin sesión»');
  check(!(await M.$('.set-index form')) && !(await M.$('.set-index input')), '   La portada no tiene formularios: solo la lista');
  check(!!(await M.$('.set-hero[href="#/ajustes/ayuda"]')), '2. Sin bucket, la portada destaca la guía paso a paso');
  check(!(await wide(M)), '   Sin desbordamiento horizontal a 390 px');
  if (SHOTS) await M.screenshot({ path: path.join(SHOTS, 'ajustes-movil.png') });
  const heights = {};
  for (const s of ['cuenta', 'nube', 'audio', 'dispositivo', 'criatura', 'desarrollador', 'ayuda']) {
    await M.goto(APP + '#/ajustes/' + s); await M.waitForSelector(`.set-body[data-set="${s}"]`);
    heights[s] = await M.evaluate(() => document.querySelector('#view').scrollHeight);
    if (await wide(M)) check(false, `   «${s}» se desborda a 390 px`);
  }
  check(true, `3. Cada sección abre su propia página (alturas: ${Object.entries(heights).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  await M.goto(APP + '#/ajustes/audio'); await M.waitForSelector('#ajustes-audio');
  check(!(await M.$('[data-form="login"]')) && !(await M.$('[data-form="par"]')) && (await M.$$('#ajustes-audio .panel')).length === 3, '   Audio solo tiene lo suyo, en tres tarjetas (reproducción, transiciones, 8D)');
  check(await M.isHidden('.set-side'), '   En móvil no se ve el menú lateral');
  await M.click('.head a[aria-label="Volver a Ajustes"]'); await M.waitForSelector('.set-index');
  check((await M.evaluate(() => location.hash)) === '#/ajustes', '   «Atrás» vuelve a la portada de Ajustes');
  await M.goto(APP + '#/ajustes/no-existe'); await M.waitForSelector('.set-index');
  check(true, '   Una sección desconocida muestra la portada');

  // ===================================================================== guía (sin nada hecho)
  await M.goto(APP + '#/ajustes/ayuda'); await M.waitForSelector('.tuto');
  let st = await steps(M);
  check(st.length === 7 && st.every(s => !s.done) && st[0].cur && st[0].open && st.filter(s => s.open).length === 1, `4. Guía «Crear mi bucket»: 7 pasos, solo el primero abierto (${st.map(s => s.t).join(' → ')})`);
  check(/0 de 7 pasos/.test(await M.innerText('.tuto-progress')), '   Indica el progreso: 0 de 7');
  const body = await M.innerText('.tuto');
  await M.click('.tuto-step[data-step="3"] summary'); await M.click('.tuto-step[data-step="4"] summary');
  const txt = await M.innerText('.tuto');
  check(/Create Bucket/.test(txt) && /Pre-Authenticated Requests/.test(txt) && /Permit object reads and writes/.test(txt) && /Enable Object Listing/.test(txt) && /solo la muestra una vez/.test(txt), '   Explica cómo crear el bucket y la URL (con los nombres de la consola de Oracle)');
  check(!!(await M.$('.tuto-step[data-step="5"] [data-form="par"]')), '   El paso «Conecta el bucket» trae el formulario ahí mismo');
  check(!(await M.$('.tuto-step[data-step="6"] [data-form="oci"]')) && /Disponible cuando el bucket esté conectado/.test(await M.textContent('.tuto-step[data-step="6"]')), '   La clave de API se pide después de conectar el bucket');
  check(!!(await M.$('.tuto a[href="https://www.oracle.com/cloud/free/"][target="_blank"][rel="noopener"]')), '   Enlace a Oracle Cloud Free Tier, en otra pestaña');
  await M.click('[data-act="help-path"][data-path="guest"]'); await M.waitForSelector('[data-path="guest"].on');
  st = await steps(M);
  check(st.length === 4 && /enlace de solo lectura/.test(st[0].t) && /Ajustes → Nube → Compartir/.test(await M.innerText('.tuto')), `5. Guía «Tengo un enlace»: 4 pasos (${st.map(s => s.t).join(' → ')})`);
  const faqs = await M.$$eval('details.faq summary', l => l.map(x => x.textContent));
  check(faqs.length >= 5, `6. Preguntas frecuentes: ${faqs.length}`);
  if (SHOTS) await M.screenshot({ path: path.join(SHOTS, 'ayuda-movil.png'), fullPage: true });

  // ===================================================================== hacer la guía de verdad
  await M.click('[data-act="help-path"][data-path="own"]'); await M.waitForSelector('[data-path="own"].on');
  await M.click('.tuto-step[data-step="1"] a[href="#/ajustes/cuenta"]'); await M.waitForSelector('[data-form="login"]');
  await M.fill('[data-form="login"] [name=email]', 'guia@example.com'); await M.fill('[data-form="login"] [name=password]', 'secreta123');
  await M.click('[data-form="login"] button[value="in"]');
  check(await until(M, async () => !!(await import('./js/account.js')).user()), '7. Desde la guía se llega a crear la cuenta');
  await M.goto(APP + '#/ajustes/ayuda'); await M.waitForSelector('.tuto');
  st = await steps(M);
  check(st[0].done && st[1].cur && !st[0].open && st[1].open, '   El paso 1 queda hecho y se abre el siguiente');
  await M.click('.tuto-step[data-step="5"] summary');
  await M.fill('.tuto-step[data-step="5"] [data-form="par"] [name=name]', 'Mi música');
  await M.fill('.tuto-step[data-step="5"] [data-form="par"] [name=url]', OWNER_PAR);
  await M.click('.tuto-step[data-step="5"] [data-form="par"] button');
  check(await until(M, async () => (await import('./js/cloud.js')).buckets().length === 1 && [...(await import('./js/store.js')).S.tracks.values()].some(t => t.cloudName)), '8. El bucket se conecta desde la guía y su música aparece');
  await M.goto(APP + '#/inicio'); await M.goto(APP + '#/ajustes/ayuda'); await M.waitForSelector('.tuto');
  st = await steps(M);
  check(st.slice(0, 5).every(s => s.done) && st[5].cur && !st[5].done && st[5].open && st[6].done, `   Pasos 1–5 hechos (y «Sube tu música», porque el bucket ya tiene canciones); el siguiente es la clave de API (${st.filter(s => s.done).length} de 7)`);
  check(/Conectado: «Mi música»/.test(await M.textContent('.tuto-step[data-step="5"]')), '   El paso de conectar dice qué bucket está conectado');
  await M.fill('.tuto-step[data-step="6"] [data-form="oci"] textarea', fs.readFileSync(path.join(KEYS, 'config.txt'), 'utf8'));
  await M.setInputFiles('.tuto-step[data-step="6"] [data-form="oci"] [name=pem]', path.join(KEYS, 'key.pem'));
  await M.click('.tuto-step[data-step="6"] [data-form="oci"] button');
  check(await until(M, async () => (await import('./js/cloud.js')).ownedBuckets().length === 1), '9. La clave de API se añade desde la guía y el bucket pasa a ser tuyo');
  await M.waitForSelector('.tuto-step[data-step="6"].done');
  st = await steps(M);
  check(st.slice(0, 6).every(s => s.done) && st[6].done && /¡Todo listo!/.test(await M.innerText('.tuto-progress')), '   Con música en la nube, la guía queda completa: «¡Todo listo!»');
  check(!(await M.$('.set-hero[href="#/ajustes/ayuda"]')), '   (sin el aviso de la guía)');
  await M.goto(APP + '#/ajustes'); await M.waitForSelector('.set-index');
  const rows2 = await M.$$eval('.set-index .set-row', l => Object.fromEntries(l.map(a => [a.querySelector('b').textContent, a.querySelector('small')?.textContent || ''])));
  check(/^1 bucket · \d+ canci/.test(rows2.Nube) && /Sesión iniciada/.test(rows2.Cuenta) && /Desactivado/.test(rows2['Modo desarrollador']) && !(await M.$('.set-index .set-hero')), `10. La portada se actualiza: «${rows2.Nube}», «${rows2['Modo desarrollador']}»`);
  check(!(await M.evaluate(() => JSON.stringify(localStorage) + document.cookie)).includes('BEGIN'), '    La clave privada no queda en localStorage ni en cookies');
  await M.goto(APP + '#/ajustes/nube'); await M.waitForSelector('.buckets');
  check(!!(await M.$('.share-box [data-form="share"]')) && !!(await M.$('details.more.flat summary')), '    Nube: buckets, «Compartir» y «Conectar otro bucket» en tarjetas separadas');
  await M.waitForSelector('[data-shares] li:not(.muted), [data-shares] li.muted:not(:has-text("Cargando"))', { timeout: 8000 }).catch(() => {});
  check(!/Cargando enlaces/.test(await M.innerText('[data-shares]')), '    Los enlaces compartidos se cargan en la página de Nube');

  await M.click('details.more.flat summary'); await M.fill('details.more.flat [data-form="par"] [name=name]', 'A medias');
  await M.evaluate(() => dispatchEvent(new HashChangeEvent('hashchange')));   // la app vuelve a pintar (como tras sincronizar)
  await M.waitForTimeout(500);
  check(await M.inputValue('details.more.flat [data-form="par"] [name=name]') === 'A medias' && await M.$eval('details.more.flat', d => d.open), '    Volver a pintar Ajustes no borra lo que estás escribiendo');
  await M.fill('details.more.flat [data-form="par"] [name=name]', '');
  await M.evaluate(() => dispatchEvent(new HashChangeEvent('hashchange'))); await M.waitForTimeout(500);
  check(await M.$eval('details.more.flat', d => d.open), '    …y lo que estaba desplegado sigue desplegado');

  // ===================================================================== escritorio
  const D = await device({ width: 1280, height: 860 });
  await D.goto(APP + '#/ajustes/audio'); await D.waitForSelector('.set-side');
  const side = await D.evaluate(() => ({ vis: getComputedStyle(document.querySelector('.set-side')).display !== 'none', cur: document.querySelector('.set-side [aria-current="page"]')?.dataset.sec, n: document.querySelectorAll('.set-side .set-row').length }));
  check(side.vis && side.cur === 'audio' && side.n === 7, '11. En escritorio, menú lateral con las 7 secciones y la actual marcada');
  await D.click('.set-side [data-sec="ayuda"]'); await D.waitForSelector('.tuto');
  check((await D.evaluate(() => location.hash)) === '#/ajustes/ayuda' && await D.$eval('.set-side [aria-current="page"]', a => a.dataset.sec) === 'ayuda', '    El menú lateral cambia de sección');
  check(!(await wide(D)), '    Sin desbordamiento horizontal en escritorio');
  if (SHOTS) await D.screenshot({ path: path.join(SHOTS, 'ayuda-escritorio.png') });

  // ===================================================================== enlaces de otras pantallas
  await D.goto(APP + '#/perfil'); await D.waitForSelector('.pf-id');
  check(!!(await D.$('.pf-id a[href="#/ajustes/cuenta"]')), '12. «Iniciar sesión» del perfil lleva directo a Cuenta');

  check(errs.length === 0, `13. Sin errores en consola${errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''}`);
  await b.close();
  console.log(`\n${ok} ok, ${fails} fallos`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
