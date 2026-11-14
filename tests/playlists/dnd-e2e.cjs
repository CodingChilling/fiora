// Playlists: cabecera de «Descubre más» y arrastrar y soltar canciones (añadir desde «Descubre más»,
// mover a otro capítulo, posición exacta), con ratón y con el dedo. Mismo entorno que pl-e2e.cjs.
const { chromium } = require('playwright');
const fs = require('fs');
const SB = 'https://rabhgmnjvxwlttlviywc.supabase.co';
const API = process.env.API || 'http://localhost:8766';
const APP = process.env.APP || 'http://localhost:8765/';
const FIX = __dirname + '/fixtures/';
const sql = async q => (await fetch(API + '/__sql', { method: 'POST', body: q })).json();
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const audio = fs.readdirSync(FIX + 'audio').map(f => ({ name: f, mimeType: 'audio/wav', buffer: fs.readFileSync(FIX + 'audio/' + f) }));
  const until = async (page, fn, arg, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(150); } return false; };
  async function device(name, mobile) {
    const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 860 } });
    await ctx.route(SB + '/**', async r => { try { await r.fulfill({ response: await r.fetch({ url: r.request().url().replace(SB, API) }) }); } catch { await r.abort('failed').catch(() => {}); } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    await page.goto(APP + '#/inicio'); await page.waitForSelector('#nav-links a');
    await page.setInputFiles('#pick-files', audio);
    await until(page, async () => (await import('./js/store.js')).S.tracks.size >= 6);
    // todas con el mismo género: así «Descubre más» recomienda las que no están en la playlist
    await page.evaluate(async () => { const st = await import('./js/store.js'); for (const t of st.S.tracks.values()) { t.genres = ['Pop']; t.genre = 'Pop'; await st.saveTrack(t); } });
    await page.waitForTimeout(1000);   // que termine de repintarse antes de seguir
    return page;
  }
  const login = async (page, email) => {
    await page.goto(APP + '#/ajustes');
    await page.fill('[data-form="login"] [name=email]', email); await page.fill('[data-form="login"] [name=password]', 'secreta123');
    await page.click('[data-form="login"] button[value="in"]');
    return until(page, async () => { const s = (await import('./js/playlists-data.js')).status(); return s.mode === 'ready' && !s.pending && !s.busy; });
  };
  const synced = async page => { await page.waitForTimeout(500); return until(page, async () => { const s = (await import('./js/playlists-data.js')).status(); return s.mode === 'ready' && !s.pending && !s.busy; }); };
  // playlist con dos capítulos: «Mañana» (despecha) y «Noche» (Dakiti)
  const makePlaylist = (page, id) => page.evaluate(async id => {
    const st = await import('./js/store.js'), d = await import('./js/playlists-data.js');
    const by = t => [...st.S.tracks.values()].find(x => x.title === t).id;
    const p = d.normalize({ id, name: 'Arrastrar', trackIds: [], createdAt: Date.now(), sections: [{ id: 's1', name: 'Mañana' }, { id: 's2', name: 'Noche' }] });
    d.addTracks(p, [by('despecha'), by('Dakiti')]);
    p.trackSection = { [by('despecha')]: 's1', [by('Dakiti')]: 's2' };
    // sin estadísticas: la lista y «Descubre más» quedan juntas y se ven a la vez en la pantalla
    p.settings.modules = p.settings.modules.map(([m, on]) => [m, m === 'stats' ? false : on]);
    await st.savePlaylist(p);
  }, id);
  // deja la lista arriba de la vista, con «Descubre más» debajo y visible
  const frame = page => page.evaluate(() => { const v = document.querySelector('#view'); v.scrollTop += document.querySelector('.pl-songs').getBoundingClientRect().top - 70; });
  const order = page => page.$$eval('.pl-list .chapter:not(.free-empty)', l => l.map(ch => `${ch.querySelector('.chap-toggle b').textContent}: ${[...ch.querySelectorAll('.row b')].map(x => x.textContent).join(', ')}`).join(' | '));
  const box = async (page, sel) => (await page.$(sel)).boundingBox();
  async function mouseDrag(page, fromSel, toSel, where = 'center') {
    await frame(page); await page.waitForTimeout(150);
    const a = await box(page, fromSel), z = await box(page, toSel);
    const ty = where === 'top' ? z.y + 6 : where === 'bottom' ? z.y + z.height - 6 : z.y + z.height / 2;
    await page.mouse.move(a.x + a.width / 3, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + a.width / 3 + 4, a.y + a.height / 2 + 12, { steps: 3 });
    await page.mouse.move(z.x + z.width / 2, ty, { steps: 14 }); await page.waitForTimeout(150);
    await page.mouse.up(); await page.waitForTimeout(500);
  }
  async function touchDrag(page, fromSel, toSel, { hold = 450, where = 'center' } = {}) {
    await frame(page); await page.waitForTimeout(150);
    const a = await box(page, fromSel), z = await box(page, toSel);
    const cdp = await page.context().newCDPSession(page);
    const x0 = a.x + a.width / 3, y0 = a.y + a.height / 2, ty = where === 'top' ? z.y + 6 : z.y + z.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    await page.waitForTimeout(hold);
    for (let k = 1; k <= 12; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (z.x + z.width / 2 - x0) * k / 12, y: y0 + (ty - y0) * k / 12 }] }); await page.waitForTimeout(25); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(600);
  }

  // ======================================================== escritorio (ratón)
  const A = await device('A', false);
  check(await login(A, 'dnd@example.com'), 'A inicia sesión');
  await makePlaylist(A, 'dnd1'); await synced(A);
  await A.goto(APP + '#/playlist/dnd1'); await A.waitForSelector('.pl-discover .disc');
  const head = await A.$eval('.pl-discover .block-head h2', h => ({ h: h.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(h).lineHeight) || 24, w: h.scrollWidth <= h.clientWidth + 1 }));
  check(head.h < 40 && head.w, `Escritorio: «Descubre más» en una sola línea (${Math.round(head.h)} px)`);
  check(/Arrastra una canción hasta la lista o un capítulo/.test(await A.innerText('.pl-discover')), 'Escritorio: «Descubre más» explica que se puede arrastrar');
  // de «Descubre más» a la cabecera del capítulo «Noche»
  const discTitle = await A.$eval('.pl-discover .disc b', b => b.textContent);
  await mouseDrag(A, '.pl-discover .disc', '.chapter[data-chapter="s2"] .chap-head');
  await synced(A);
  let o = await order(A);
  check(o.includes(`Noche: Dakiti, ${discTitle}`), `Ratón: una recomendación soltada en «Noche» se añade a ese capítulo (${o})`);
  const db = await sql(`select t.position, s.name from fiora_playlist_tracks t left join fiora_playlist_sections s on s.user_id = t.user_id and s.playlist_id = t.playlist_id and s.id = t.section_id where t.playlist_id = 'dnd1' order by t.position`);
  check(db.length === 3 && db[2].name === 'Noche', '   …y así queda en Supabase (capítulo «Noche»)');
  // fila existente → otro capítulo, sin pulsar «Reordenar»
  await mouseDrag(A, '.chapter[data-chapter="s1"] .row', '.chapter[data-chapter="s2"] .row:last-child', 'bottom');
  await synced(A);
  o = await order(A);
  check(/Noche: Dakiti, .+, despecha$/.test(o) && !(await A.$('[data-act="pl-reorder"].on')), `Ratón: una canción se lleva a otro capítulo arrastrándola, sin entrar en «Reordenar» (${o})`);
  // soltar entre dos filas inserta justo ahí
  const disc2 = await A.$eval('.pl-discover .disc b', b => b.textContent);
  await mouseDrag(A, '.pl-discover .disc', '.chapter[data-chapter="s2"] .row:nth-child(2)', 'top');
  o = await order(A);
  check(o.includes(`Noche: Dakiti, ${disc2}, ${discTitle}, despecha`), `Ratón: soltar entre dos canciones la coloca justo ahí (${o})`);
  // un clic sin mover sigue reproduciendo
  await A.click('.chapter[data-chapter="s2"] .row:first-child .row-main');
  check(await until(A, async () => { const { P } = await import('./js/player.js'); return P.current?.title === 'Dakiti'; }), 'Ratón: un clic sin arrastrar sigue reproduciendo');
  // Escape cancela
  const before = await order(A);
  { const a = await box(A, '.chapter[data-chapter="s2"] .row'); await A.mouse.move(a.x + 60, a.y + a.height / 2); await A.mouse.down(); await A.mouse.move(a.x + 60, a.y + 140, { steps: 8 }); await A.keyboard.press('Escape'); await A.mouse.up(); await A.waitForTimeout(400); }
  check(await order(A) === before && !(await A.$('.dnd-ghost')), 'Escape cancela el arrastre sin cambiar nada');

  // ======================================================== móvil (dedo)
  const B = await device('B', true);
  await makePlaylist(B, 'dnd2');
  await B.goto(APP + '#/playlist/dnd2'); await B.waitForSelector('.pl-discover .disc');
  const mh = await B.$eval('.pl-discover .block-head h2', h => ({ h: h.getBoundingClientRect().height, fits: h.scrollWidth <= h.clientWidth + 1 }));
  check(mh.h < 40 && mh.fits, `Móvil: «Descubre más» ya no sale aplastado (${Math.round(mh.h)} px de alto)`);
  check(/Mantén pulsada una canción/.test(await B.innerText('.pl-discover')), 'Móvil: explica que se mantiene pulsada para arrastrar');
  const mDisc = await B.$eval('.pl-discover .disc b', b => b.textContent);
  await frame(B);
  check(await B.evaluate(() => { const d = document.querySelector('.pl-discover .disc').getBoundingClientRect(); return d.top > 0 && d.bottom < innerHeight; }), 'Móvil: la recomendación y la lista se ven a la vez para arrastrar');
  await touchDrag(B, '.pl-discover .disc', '.chapter[data-chapter="s1"] .chap-head');
  o = await order(B);
  check(o.includes(`Mañana: despecha, ${mDisc}`), `Dedo: mantener pulsada una recomendación y arrastrarla a «Mañana» la añade ahí (${o})`);
  // un deslizamiento rápido (sin mantener) desplaza la página y no arrastra
  const before2 = await order(B), st0 = await B.evaluate(() => document.querySelector('#view').scrollTop);
  const cdp = await B.context().newCDPSession(B);
  const a2 = await box(B, '.chapter[data-chapter="s2"] .row');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a2.x + 80, y: a2.y + 20 }] });
  for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a2.x + 80, y: a2.y + 20 - k * 25 }] }); await B.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await B.waitForTimeout(600);
  const st1 = await B.evaluate(() => document.querySelector('#view').scrollTop);
  check(await order(B) === before2 && st1 !== st0 && !(await B.$('.dnd-ghost')), 'Dedo: deslizar sin mantener pulsado desplaza la página y no mueve canciones');

  // ======================================================== «Canciones que te gustan»
  await A.evaluate(async () => { const st = await import('./js/store.js'); const t = [...st.S.tracks.values()].find(x => x.title === 'despecha'); if (!st.isFav(t.id)) st.toggleFav(t.id); });
  await A.waitForTimeout(500);
  await A.evaluate(async () => { const st = await import('./js/store.js'); const p = st.S.playlists.find(x => x.id === 'favoritos'); p.settings.modules = p.settings.modules.map(([m, on]) => [m, m === 'stats' ? false : on]); await st.savePlaylist(p); });
  await A.goto(APP + '#/favoritos'); await A.waitForSelector('.pl-list .row');
  await until(A, () => !!document.querySelector('.pl-discover .disc'));
  const favDisc = await A.$eval('.pl-discover .disc b', b => b.textContent);
  const favTid = await A.$eval('.pl-discover .disc', d => d.dataset.tid);
  await mouseDrag(A, '.pl-discover .disc', '.pl-list .row', 'bottom');
  const favs = await A.$$eval('.pl-list .row b', l => l.map(x => x.textContent));
  const liked = await A.evaluate(async id => (await import('./js/store.js')).isFav(id), favTid);
  check(liked && favs[1] === favDisc, `«Canciones que te gustan»: soltar una recomendación le da «me gusta» y la deja donde la sueltas (${favs.join(', ')})`);

  check(!errs.length, 'Sin errores ' + errs.join(' | '));
  console.log(`\n${ok} correctas · ${fails} fallos`);
  await b.close();
  process.exit(fails ? 1 : 0);
})();
