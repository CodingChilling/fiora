// «Canciones que te gustan» con el nuevo diseño y orden manual. Mismo entorno que pl-e2e.cjs.
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
  async function device(name, mobile) {
    const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 860 } });
    await ctx.route(SB + '/**', async route => { try { await route.fulfill({ response: await route.fetch({ url: route.request().url().replace(SB, API) }) }); } catch { await route.abort('failed').catch(() => {}); } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    await page.goto(APP + '#/inicio'); await page.waitForSelector('#nav-links a');
    await page.setInputFiles('#pick-files', audio);
    await until(page, async () => (await import('./js/store.js')).S.tracks.size >= 6);
    return page;
  }
  const until = async (page, fn, arg, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
  const login = async (page, email) => {
    await page.goto(APP + '#/ajustes');
    await page.fill('[data-form="login"] [name=email]', email); await page.fill('[data-form="login"] [name=password]', 'secreta123');
    await page.click('[data-form="login"] button[value="in"]');
    return until(page, async () => { const s = (await import('./js/playlists-data.js')).status(); return s.mode === 'ready' && !s.pending && !s.busy; });
  };
  const synced = async page => { await page.waitForTimeout(600); return until(page, async () => { const s = (await import('./js/playlists-data.js')).status(); return s.mode === 'ready' && !s.pending && !s.busy; }); };
  const shown = page => page.$$eval('.pl-list .row', r => r.map(x => x.querySelector('b').textContent));
  const like = (page, title) => page.evaluate(async t => { const st = await import('./js/store.js'); const tr = [...st.S.tracks.values()].find(x => x.title === t); st.toggleFav(tr.id); }, title);

  const A = await device('A', false);
  check(await login(A, 'favs@example.com'), 'A inicia sesión');
  for (const t of ['despecha', 'Dakiti', 'Única (Live)']) { await like(A, t); await A.waitForTimeout(30); }
  await A.goto(APP + '#/favoritos');
  await A.waitForSelector('.pl-hero');
  check((await A.innerText('.pl-hero')).includes('Canciones que te gustan') && !!(await A.$('.pl-hero .pl-cover .ic')), 'Nuevo diseño: cabecera de playlist con el corazón como portada');
  await until(A, () => document.querySelectorAll('.pl-list .row').length === 3);
  check(JSON.stringify(await shown(A)) === JSON.stringify(['Única (Live)', 'despecha', 'Dakiti'].sort(() => 0) && await shown(A)) && (await shown(A))[0] === 'Única (Live)', 'Por defecto: de la más reciente a la más antigua ' + (await shown(A)).join(' · '));
  check(/más reciente a la más antigua/.test(await A.innerText('.pl-songs')), 'Explica el orden por fecha');

  // reordenar a mano: arrastrar la última arriba
  await A.click('[data-act="pl-reorder"]'); await A.waitForTimeout(500);
  const hs = await A.$$('.pl-list .row [data-drag]');
  const hb = await hs[1].boundingBox(), tb = await (await A.$('.pl-list .row')).boundingBox();
  await A.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await A.mouse.down();
  for (let y = hb.y; y >= tb.y + 4; y -= 10) await A.mouse.move(hb.x + hb.width / 2, y);
  await A.mouse.up();
  await synced(A);
  const manual = await shown(A);
  check(manual[0] === 'Dakiti', 'Se puede reordenar a mano: ' + manual.join(' · '));
  let row = (await sql(`select settings->>'favOrder' o, (select array_agg(track_id order by position) from fiora_playlist_tracks t where t.playlist_id = 'favoritos' and t.user_id = p.user_id) ids from fiora_playlists p where id = 'favoritos'`))[0];
  for (let i = 0; i < 40 && !(row?.o === 'manual' && row.ids?.[0]?.includes('Dakiti')); i++) { await A.waitForTimeout(250); row = (await sql(`select settings->>'favOrder' o, (select array_agg(track_id order by position) from fiora_playlist_tracks t where t.playlist_id = 'favoritos' and t.user_id = p.user_id) ids from fiora_playlists p where id = 'favoritos'`))[0]; }
  check(row?.o === 'manual' && row.ids.length === 3 && row.ids[0].includes('Dakiti'), 'El orden manual se guarda en Supabase ' + JSON.stringify(row));

  // una favorita nueva entra arriba sin desordenar el resto
  await like(A, 'DÁKITI');
  await until(A, () => document.querySelectorAll('.pl-list .row').length === 4);
  const withNew = await shown(A);
  check(withNew[0] === 'DÁKITI' && withNew.slice(1).join() === manual.join(), 'Una nueva favorita entra arriba y el resto mantiene tu orden: ' + withNew.join(' · '));
  // quitar el corazón desde la propia lista
  await A.click('.pl-list .row:has-text("despecha") [data-act="fav"]');
  await until(A, () => document.querySelectorAll('.pl-list .row').length === 3);
  const afterUnlike = await shown(A);
  check(!afterUnlike.includes('despecha') && afterUnlike.join() === withNew.filter(x => x !== 'despecha').join(), 'Quitar el «me gusta» la saca sin tocar el orden del resto');
  // menú: «Quitar de "me gusta"» y sin «Eliminar playlist»
  await A.click('.pl-list .row:has-text("Dakiti") [data-act="more"]');
  const items = await A.$$eval('#sheet .menu button', l => l.map(x => x.textContent));
  check(items.includes('Quitar de «me gusta»') && !items.includes('Quitar de esta playlist'), 'Su menú ofrece «Quitar de “me gusta”»');
  await A.keyboard.press('Escape'); await A.waitForTimeout(200);
  await A.click('.pl-hero [data-act="pl-more"]');
  check(!(await A.$$eval('#sheet .menu button', l => l.map(x => x.textContent))).some(x => /Eliminar/.test(x)), 'No se puede eliminar');
  await A.keyboard.press('Escape'); await A.waitForTimeout(200);

  // personalizar como cualquier playlist
  await A.click('.pl-info [data-act="pl-edit"]');
  await A.fill('[data-ed-form="info"] [name=emoji]', '💛');
  await A.fill('[data-ed-form="info"] [name=description]', 'Lo que más me gusta');
  await A.click('[data-ed-form="info"] button.primary');
  await A.click('[data-ed-tab="org"]');
  check((await A.innerText('.ed-body')).includes('Por fecha de «me gusta»'), 'Organización: elegir entre orden por fecha y manual');
  await A.keyboard.press('Escape'); await synced(A);
  row = (await sql(`select emoji, description from fiora_playlists where id = 'favoritos'`))[0];
  check(row?.emoji === '💛' && row.description === 'Lo que más me gusta', 'La personalización se guarda en Supabase');

  // en la lista de playlists: una sola tarjeta, la primera
  await A.goto(APP + '#/playlists'); await A.waitForSelector('.pl-grid');
  const cards = await A.$$eval('.pl-grid .card', l => l.map(x => x.querySelector('b').textContent));
  check(cards[0].includes('Canciones que te gustan') && cards.filter(x => x.includes('Canciones que te gustan')).length === 1, 'En Playlists aparece una vez y la primera: ' + cards.join(' | '));

  // otro dispositivo con la misma cuenta
  const B = await device('B', true);
  check(await login(B, 'favs@example.com'), 'B inicia sesión con la misma cuenta');
  await B.evaluate(async () => (await import('./js/account.js')).sync());   // trae también los «me gusta»
  await B.goto(APP + '#/favoritos'); await B.waitForSelector('.pl-hero');
  await until(B, () => document.querySelectorAll('.pl-list .row').length === 3);
  check(JSON.stringify(await shown(B)) === JSON.stringify(afterUnlike) && /Lo que más me gusta/.test(await B.innerText('.pl-hero')), 'B ve el mismo orden manual y la misma personalización: ' + (await shown(B)).join(' · '));

  // volver al orden por fecha
  await A.goto(APP + '#/favoritos'); await A.waitForSelector('[data-act="pl-fav-date"]');
  await A.click('[data-act="pl-fav-date"]'); await synced(A);
  const byDate = await shown(A);
  check(byDate[0] === 'DÁKITI' && byDate[1] === 'Única (Live)' && byDate[2] === 'Dakiti', '«Ordenar por fecha» vuelve al orden de «me gusta»: ' + byDate.join(' · '));
  check(!errs.length, 'Sin errores ' + errs.join(' | '));
  console.log(`\n${ok} correctas · ${fails} fallos`);
  await b.close();
  process.exit(fails ? 1 : 0);
})();
