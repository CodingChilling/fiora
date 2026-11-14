// Pruebas de punta a punta de Explorar (Playwright) contra emuladores:
//   · rb-server.mjs  → Radio Browser, Openverse, Internet Archive y el audio de las emisoras (:8767)
//   · ../playlists/sb-server.mjs → Supabase sobre PostgreSQL real con las migraciones (:8766)
//   · ../playlists/static-server.mjs → la app (:8765)
// Recorre los criterios de aceptación del rediseño. Cada línea «ok/FAIL» dice qué se comprueba.
const { chromium } = require('playwright');
const SB = 'https://rabhgmnjvxwlttlviywc.supabase.co';
const API = process.env.API || 'http://localhost:8766';
const RB = process.env.RB || 'http://localhost:8767';
const APP = process.env.APP || 'http://localhost:8765/';
const sql = async q => (await fetch(API + '/__sql', { method: 'POST', body: q })).json();
const rb = p => fetch(RB + p).then(r => r.json());
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

(async () => {
  await rb('/__reset');
  const b = await chromium.launch();
  const errs = [];
  const all = await rb('/json/stations/search?limit=1000');
  const byName = n => all.find(s => s.name === n);
  const validGeo = all.filter(s => s.geo_lat != null && Math.abs(s.geo_lat) <= 90 && Math.abs(s.geo_long) <= 180 && !(s.geo_lat === 0 && s.geo_long === 0));

  async function device(name, { mobile = false, reducedMotion = 'no-preference' } = {}) {
    const ctx = await b.newContext({ ...(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 860 } }), reducedMotion });
    const to = (route, base) => async r => { try { const u = new URL(r.request().url()); await r.fulfill({ response: await r.fetch({ url: base + u.pathname + u.search }) }); } catch { await r.abort('failed').catch(() => {}); } };
    await ctx.route(SB + '/**', to(null, API));
    await ctx.route(/^https:\/\/([a-z0-9-]+\.)*api\.radio-browser\.info\//, to(null, RB));
    await ctx.route(/^https:\/\/(radio|media)\.fiora\.test\//, to(null, RB));
    await ctx.route(/^https:\/\/api\.openverse\.org\//, to(null, RB));
    await ctx.route(/^https:\/\/archive\.org\//, to(null, RB));
    await ctx.route(/^https:\/\/(commons\.wikimedia\.org|api\.jamendo\.com)\//, r => r.abort('failed'));
    // registra los elementos de audio que llegan a sonar (para comprobar que nunca suenan dos a la vez)
    await ctx.addInitScript(() => {
      window.__media = new Set();
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { window.__media.add(this); return play.call(this); };
    });
    const page = await ctx.newPage();
    page.reqs = [];
    page.on('request', r => page.reqs.push(r.url()));
    page.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    await page.goto(APP + '#/explorar'); await page.waitForSelector('#x-q');
    return page;
  }
  const until = async (page, fn, arg, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
  const settled = page => until(page, () => !document.querySelector('#view .x-loading, #view .skel'), null, 15000);
  const synced = async page => { await page.waitForTimeout(500); return until(page, async () => { const s = (await import('./js/radio-data.js')).status(); return s.mode === 'ready' && !s.pending && !s.busy; }); };
  const login = async (page, email) => {
    await page.goto(APP + '#/ajustes');
    await page.fill('[data-form="login"] [name=email]', email); await page.fill('[data-form="login"] [name=password]', 'secreta123');
    await page.click('[data-form="login"] button[value="in"]');
    return synced(page);
  };
  const current = page => page.evaluate(async () => { const { P } = await import('./js/player.js'); return P.current ? { id: P.current.id, title: P.current.title, radio: !!P.current.radio, playing: P.playing } : null; });
  const playingCount = page => page.evaluate(() => [...window.__media].filter(m => !m.paused).length);

  // ===================================================================== A: escritorio
  const A = await device('A');
  check((await A.$$('#nav-links a')).length === 5 && (await A.$$('#nav-links a[data-nav="explorar"]')).length === 1, '1. Explorar sigue siendo una única sección del menú principal');
  check(!A.reqs.some(u => /atlas\.js|world\.json/.test(u)), '20. Al abrir Explorar no se descarga el Atlas (globo ni mapa)');

  // --- tres vistas
  await settled(A);
  const forYou = await A.$$eval('[data-xb]', l => l.map(x => x.dataset.xb));
  await A.click('.seg a:has-text("Música libre")'); await A.waitForSelector('.x-cats'); await settled(A);
  const free = await A.$$eval('[data-xb]', l => l.map(x => x.dataset.xb));
  await A.click('.seg a:has-text("Radios")'); await A.waitForSelector('.xb.mine'); await settled(A);
  const radios = await A.$$eval('[data-xb]', l => l.map(x => x.dataset.xb));
  check(forYou.includes('amb') && forYou.includes('featured') && free.includes('new') && radios.includes('trend'), '2. Las tres vistas (Para ti · Música libre · Radios) se pintan con su contenido');
  check(!(await A.$$eval('[data-xb] .x-error', l => l.length)), '   …y ningún bloque da error');
  const trendNote = await A.innerText('[data-xb="trend"] .xb-head');
  check(/No son oyentes/.test(trendNote), '14. Las tendencias dicen de dónde salen (clics de Radio Browser, no oyentes)');
  const trendNames = await A.$$eval('[data-xb="trend"] .st-row b', l => l.map(x => x.textContent));
  const byClicks = all.filter(s => !s._broken).sort((x, y) => y.clickcount - x.clickcount).map(s => s.name);
  check(trendNames[0] === byClicks[0], '14. «Más escuchadas hoy» ordena por los clics reales del directorio: ' + trendNames.slice(0, 3).join(', '));

  // --- Música libre: el buscador clásico por catálogo sigue igual
  await A.click('.seg a:has-text("Música libre")'); await A.waitForSelector('.x-cats');
  await A.click('[data-act="x-cat"][data-cat="openverse"]');
  await A.fill('#x-q', 'a'); await A.waitForTimeout(500); await settled(A);
  await until(A, () => document.querySelectorAll('#archive-list .row').length >= 4);
  const before = (await A.$$('#archive-list .row')).length;
  const moreBtn = await A.$('[data-act="x-more-results"]');
  if (moreBtn) { await moreBtn.click(); await until(A, n => document.querySelectorAll('#archive-list .row').length > n, before); }
  check(before >= 4 && moreBtn && (await A.$$('#archive-list .row')).length > before, '3. Música libre conserva la búsqueda por catálogo con «Más resultados»');
  await A.click('[data-act="x-q-clear"]'); await A.click('[data-act="x-cat"][data-cat="all"]');

  // --- buscador universal
  await A.click('.seg a:has-text("Para ti")'); await A.waitForSelector('#x-q');
  await A.fill('#x-q', 'jazz'); await A.waitForTimeout(450); await settled(A);
  const groups = await A.$$eval('.xr[data-g]', l => l.map(x => [x.dataset.g, x.querySelectorAll('.row').length, x.querySelectorAll('.st-row').length, x.querySelectorAll('.card, .chip').length]));
  const g = Object.fromEntries(groups.map(([k, ...v]) => [k, v]));
  check(g.songs?.[0] > 0 && g.stations?.[1] > 0 && g.albums?.[2] > 0 && g.tags?.[2] > 0, '5. El buscador consulta música libre y radios a la vez: ' + JSON.stringify(g));
  check(g.songs[1] === 0 && g.stations[0] === 0, '6. Resultados agrupados: canciones y emisoras nunca en la misma lista');
  await A.click('.seg a:has-text("Radios")'); await A.waitForTimeout(400);
  check((await A.inputValue('#x-q')) === 'jazz' && !!(await A.$('.x-filters')), '   La búsqueda se conserva al cambiar de vista');
  await A.click('[data-act="x-scope"][data-scope="radio"]'); await settled(A);
  check(JSON.stringify(await A.$$eval('.xr[data-g]', l => l.map(x => x.dataset.g))) === '["stations","countries","tags"]', '   Se puede buscar solo en Radios');
  // si una fuente falla, la otra sigue
  await rb('/__fail?src=openverse&on=1');
  await A.click('[data-act="x-scope"][data-scope="all"]');
  await A.fill('#x-q', 'jazz club'); await A.waitForTimeout(450); await settled(A);
  const songsErr = await A.$('.xr[data-g="songs"] .x-error');
  const stOk = (await A.$$('.xr[data-g="stations"] .st-row')).length;
  check(!!songsErr && stOk > 0 && !!(await A.$('.xr[data-g="songs"] [data-act="x-retry-search"]')), '   Si Openverse falla, las emisoras salen igual y las canciones ofrecen «Reintentar»');
  await rb('/__fail?src=openverse&on=0');
  await A.click('[data-act="x-q-clear"]');

  // --- ambientes con contenido real
  await A.goto(APP + '#/explorar/ambiente/neon'); await A.waitForSelector('.amb-hero');
  for (let i = 0; i < 3; i++) { await A.evaluate(() => document.querySelector('#view').scrollBy(0, 500)); await A.waitForTimeout(200); }
  await settled(A);
  const ambSongs = await A.$$eval('[data-xb="amb-songs"] .song-text b', l => l.map(x => x.textContent));
  const ambRadio = await A.$$eval('[data-xb="amb-radio"] .st-row b', l => l.map(x => x.textContent));
  const want = ['synthwave', 'synthpop', 'retrowave', 'electronic'];
  const realTags = ambRadio.every(n => byName(n)?.tags.split(',').some(t => want.some(w => t.includes(w))));
  check(ambSongs.length > 0 && ambSongs.every(t => ['Neon Drive', 'Midnight Grid'].includes(t)), '7. Ambiente «Noches de neón»: canciones reales con esas etiquetas: ' + ambSongs.join(', '));
  check(ambRadio.length > 0 && realTags, '7. …y emisoras reales con esas etiquetas: ' + ambRadio.join(', '));
  check(/Elegido por las etiquetas/.test(await A.innerText('.amb-hero')), '   La regla de las etiquetas se muestra (transparencia)');

  // --- de canción a radio sin audio doble
  await A.click('[data-xb="amb-songs"] [data-act="x-song"]');
  await until(A, async () => { const { P } = await import('./js/player.js'); return P.current && !P.current.radio && P.playing; });
  const song = await current(A);
  await A.click('[data-xb="amb-radio"] .st-row [data-act="x-play"]');
  await until(A, async () => { const { P } = await import('./js/player.js'); return P.current?.radio && P.playing; });
  const st = await current(A);
  check(song && !song.radio && st?.radio, '8. Se pasa de una canción a una emisora: ' + song?.title + ' → ' + st?.title);
  check(await playingCount(A) === 1, '9. Nunca suenan dos audios a la vez (un único reproductor)');
  check((await rb('/__log')).clicks.includes(st.id.replace('radio:', '')), '22. Al escuchar se avisa del clic a Radio Browser (solo el uuid de la emisora)');
  // pantalla de directo
  await A.click('#mini [data-act="open-now"]'); await A.waitForSelector('#now .live-badge');
  await until(A, () => !!document.querySelector('#live-similar .st-row, #live-similar p'));
  const live = await A.evaluate(() => ({ seek: !!document.querySelector('#now .js-seek'), note: document.querySelector('#now .deco-note')?.textContent, song: document.querySelector('#now .st-facts')?.textContent || '' }));
  check(!live.seek && /decorativa/.test(live.note) && /no informa de qué suena/.test(live.song), '18. Pantalla de directo: sin barra de posición, animación marcada como decorativa y sin inventar la canción');
  await A.click('#now [data-act="close-now"]');

  // --- Radio Roulette: emisoras reales y sin repetir
  await A.goto(APP + '#/explorar/ruleta'); await A.waitForSelector('.dial');
  const picks = [];
  for (let i = 0; i < 3; i++) {
    await A.click('.dial-btn'); await until(A, () => !!document.querySelector('#r-result .r-card'), null, 10000);
    picks.push(await A.$eval('#r-result h3', h => h.textContent));
    await A.waitForTimeout(300);
  }
  check(picks.every(p => byName(p)) && new Set(picks).size === 3, '10. La ruleta elige emisoras reales del directorio y no repite: ' + picks.join(' · '));
  // modo país con emisoras rotas: salta sola a otra
  await A.goto(APP + '#/explorar/ruleta?cc=BR'); await A.waitForSelector('.dial');
  await A.click('.dial-btn'); await until(A, () => !!document.querySelector('#r-result .r-card'), null, 10000);
  const firstBr = await A.$eval('#r-result h3', h => h.textContent);
  await A.click('#r-result [data-act="x-play"]');
  const recovered = await until(A, async () => { const { P } = await import('./js/player.js'); return P.current?.title === 'Brasil Tropical' && P.playing; }, null, 20000);
  check(['Rio Bossa', 'São Paulo Samba'].includes(firstBr) && recovered, '11. Si la emisora no responde, la ruleta pasa sola a otra que funcione (' + firstBr + ' → Brasil Tropical)');

  // --- Atlas: solo coordenadas válidas y alternativa accesible
  await A.goto(APP + '#/explorar/atlas'); await A.waitForSelector('.atlas-canvas', { timeout: 15000 });
  await A.waitForTimeout(800);
  const geo = await A.evaluate(async () => (await import('./js/radio.js')).geoStations());
  const bad = geo.filter(s => !(Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180) || (s.lat === 0 && s.lon === 0));
  check(geo.length === validGeo.length && !bad.length, `12. El Atlas solo usa coordenadas válidas del directorio (${geo.length} de ${all.length}; sin 0,0 ni fuera de rango)`);
  await A.click('[data-act="x-atlas-city"][data-city="madrid"]'); await A.waitForTimeout(1500);
  const panel = await A.innerText('#atlas-panel');
  check(/Madrid/.test(panel) && /hora local \d\d:\d\d/.test(panel) && /Madrid Jazz Club|Radio Gran Vía/.test(panel), '12. Panel de ciudad con hora local real y sus emisoras');
  check(!!(await A.$('.atlas-alt summary')) && !!(await A.$('.atlas-canvas[aria-label]')), '13. El mapa tiene alternativa accesible (lista) y descripción');

  // --- cuenta: favoritas y colecciones en Supabase
  check(await login(A, 'explora@example.com'), 'A inicia sesión');
  await A.goto(APP + '#/explorar/pais/ES'); await settled(A);
  for (const n of ['Madrid Jazz Club', 'Radio Gran Vía']) await A.click(`.st-row:has-text("${n}") [data-act="x-fav"]`);
  await synced(A);
  let favRows = await sql("select station->>'title' t from fiora_radio_favorites order by added_at");
  check(favRows.length === 2, '15. Las favoritas se guardan en Supabase: ' + favRows.map(r => r.t).join(', '));
  // colección: crear, añadir, reordenar
  await A.click('.st-row:has-text("Madrid Jazz Club") [data-act="x-more"]');
  await A.click('#sheet .menu button:has-text("Añadir a una colección")'); await A.waitForTimeout(300);
  await A.click('#sheet .menu button:has-text("Nueva colección")');
  await A.fill('#sheet input[name=v]', 'Mañanas'); await A.click('#sheet button.primary'); await A.waitForTimeout(400);
  for (const n of ['Flamenco Sur', 'Lo-fi Lluvia']) {
    await A.click(`.st-row:has-text("${n}") [data-act="x-more"]`);
    await A.click('#sheet .menu button:has-text("Añadir a una colección")'); await A.waitForTimeout(300);
    await A.click('#sheet .menu button:has-text("Mañanas")'); await A.waitForTimeout(300);
  }
  const cid = await A.evaluate(async () => (await import('./js/radio-data.js')).collections()[0].id);
  await A.goto(APP + `#/explorar/coleccion/${cid}`); await A.waitForSelector('.coll-hero');
  await A.click('.coll-list li:nth-child(3) [data-act="x-c-move"][data-d="-1"]'); await A.waitForTimeout(300);
  await synced(A);
  const items = await sql("select string_agg(station->>'title', ', ' order by position) o from fiora_radio_collection_items");
  check(items[0]?.o === 'Madrid Jazz Club, Lo-fi Lluvia, Flamenco Sur', '17. Colección con orden personalizado en Supabase: ' + items[0]?.o);
  check((await sql("select count(*)::int n from fiora_radio_collection_items where station ? 'url' and not station ? 'audio'"))[0].n === 3, '17. Las colecciones guardan referencias a emisoras, no audio');

  // --- pasaporte: solo tras escuchar el tiempo mínimo
  await A.goto(APP + '#/explorar/pasaporte'); await A.waitForSelector('[data-pp="secs"]', { state: 'attached' });
  await A.evaluate(() => { document.querySelector('.pp-settings').open = true; });
  await A.selectOption('[data-pp="secs"]', '30'); await A.waitForTimeout(400);
  await A.goto(APP + '#/explorar/pais/FR'); await settled(A);
  await A.click('.st-row:has-text("Lyon Lounge") [data-act="x-more"]'); await A.click('#sheet .menu button:has-text("Ver ficha")'); await A.waitForTimeout(800);
  await A.keyboard.press('Escape');
  check((await sql('select count(*)::int n from fiora_passport'))[0].n === 0, '17. Abrir la ficha de una emisora no sella el pasaporte');
  await A.click('.st-row:has-text("Paris Chanson") [data-act="x-play"]');
  await until(A, async () => { const { P } = await import('./js/player.js'); return P.current?.title === 'Paris Chanson' && P.playing; });
  await A.waitForTimeout(12000);
  await synced(A);
  check((await sql('select count(*)::int n from fiora_passport'))[0].n === 0, '17. A los 12 s de escucha todavía no hay sello (mínimo 30 s)');
  await until(A, async () => (await import('./js/radio-data.js')).passport().length > 0, null, 30000);
  await synced(A);
  const pp = await sql('select country_code, station_name from fiora_passport');
  check(pp.length === 1 && pp[0].country_code === 'FR' && pp[0].station_name === 'Paris Chanson', '17. Tras 30 s de escucha real, Francia queda sellada en Supabase');

  // --- mezclador y preferencias que persisten
  await A.goto(APP + '#/explorar/radios'); await A.waitForSelector('.mixer');
  await A.evaluate(() => { document.querySelector('.mixer').open = true; });
  await A.selectOption('[data-mix-home]', 'ES');
  await A.$eval('[data-mix="intl"]', r => { r.value = 100; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await A.waitForTimeout(1200); await settled(A);
  const featured = await A.$$eval('[data-xb="featured"] .st-card b', l => l.map(x => x.textContent));
  const nonEsFirst = featured.slice(0, 5).every(n => byName(n)?.countrycode !== 'ES');
  check(featured.length && nonEsFirst, '16/21. El mezclador «Internacional» deja fuera de los primeros puestos las emisoras de tu país: ' + featured.slice(0, 4).join(', '));
  await synced(A);
  const prefs = await sql("select prefs->'mix'->>'intl' intl, prefs->>'home' home from fiora_explore_prefs");
  check(prefs[0]?.intl === '1' && prefs[0]?.home === 'ES', '21. Las preferencias de descubrimiento se guardan en Supabase');
  await A.reload(); await A.waitForSelector('.mixer');
  check((await A.$eval('[data-mix="intl"]', r => r.value)) === '100', '21. …y se conservan al volver a abrir la app');

  // --- descubrimiento del día determinista
  await settled(A);
  const day1 = await A.$eval('[data-xb="daily"] .daily h3', h => h.textContent).catch(() => '');
  await A.reload(); await A.waitForSelector('.xb.mine'); await until(A, () => !!document.querySelector('[data-xb="daily"] .daily h3'));
  check(day1 && day1 === await A.$eval('[data-xb="daily"] .daily h3', h => h.textContent), '15. «Descubrimiento del día» es el mismo al recargar: ' + day1);

  // --- viaje: se puede detener
  await A.goto(APP + '#/explorar/viaje'); await A.waitForSelector('[data-act="x-j-start"]');
  await A.click('[data-act="x-j-start"]');
  await A.waitForSelector('.route li.now', { timeout: 15000 });
  await until(A, async () => { const { P } = await import('./js/player.js'); return P.current?.radio && P.playing; });
  const stop1 = await A.$eval('.route li.now b', e => e.textContent);
  await A.click('[data-act="x-s-skip"]'); await A.waitForTimeout(800);
  await until(A, () => document.querySelector('.route li.now b')?.textContent === 'París');
  const stop2 = await A.$eval('.route li.now b', e => e.textContent);
  const j2 = await current(A);
  check(stop1 === 'Madrid' && stop2 === 'París' && /Paris Chanson|FIP Test/.test(j2?.title || ''), '18. Viaje Madrid → París con emisoras reales de cada destino; «Saltar destino» funciona (' + j2?.title + ')');
  await A.click('[data-act="x-s-stop"]'); await A.waitForTimeout(600);
  check(!(await A.evaluate(async () => (await import('./js/session.js')).current())) && !(await current(A))?.playing, '18. El viaje se puede terminar y deja de sonar');

  // --- degustación: cambia sola tras el intervalo
  await A.goto(APP + '#/explorar/degustar'); await A.waitForSelector('[data-act="x-t-start"]');
  await A.click('[data-act="x-t-int"][data-s="15"]'); await A.click('[data-act="x-t-start"]');
  await until(A, async () => { const { P } = await import('./js/player.js'); return P.current?.radio && P.playing; });
  const t1 = (await current(A)).title;
  const moved = await until(A, async t => { const { P } = await import('./js/player.js'); return P.current?.title !== t && P.playing; }, t1, 25000);
  check(moved && await playingCount(A) === 1, `   Degustación: tras 15 s de escucha pasa sola a la siguiente (${t1} → ${(await current(A))?.title})`);
  await A.click('[data-act="x-s-stop"]');

  // ===================================================================== B: otro dispositivo (móvil)
  const B = await device('B', { mobile: true });
  check(await login(B, 'explora@example.com'), 'B (móvil) inicia sesión con la misma cuenta');
  await B.goto(APP + '#/explorar/radios'); await B.waitForSelector('.xb.mine');
  const bFavs = await B.$$eval('.xb.mine .st-card b', l => l.map(x => x.textContent));
  check(bFavs.includes('Madrid Jazz Club') && bFavs.includes('Radio Gran Vía'), '15/16. B recupera las favoritas: ' + bFavs.join(', '));
  await B.click('.coll-card'); await B.waitForSelector('.coll-list');
  check((await B.$$eval('.coll-list .st-main b', l => l.map(x => x.textContent))).join(', ') === 'Madrid Jazz Club, Lo-fi Lluvia, Flamenco Sur', '16. B recupera la colección con su orden');
  await B.goto(APP + '#/explorar/pasaporte'); await B.waitForSelector('.pp-count');
  check((await B.innerText('.pp-count b')) === '1' && /Francia/.test(await B.innerText('.stamps')), '17. B ve el sello de Francia en su pasaporte');
  // quitar una favorita en B no vuelve a aparecer en A (el fallo de la versión anterior)
  await B.goto(APP + '#/explorar/radios'); await B.waitForSelector('.xb.mine');
  await B.click('.xb.mine .st-card:has-text("Radio Gran Vía") [data-act="x-open"]'); await B.click('#sheet [data-sa="fav"]'); await synced(B);
  await A.evaluate(async () => (await import('./js/radio-data.js')).pull()); await synced(A);
  await A.evaluate(async () => (await import('./js/account.js')).sync()); await A.waitForTimeout(800);
  const aFavs = await A.evaluate(async () => (await import('./js/radio-data.js')).favs().map(s => s.title));
  check(!aFavs.includes('Radio Gran Vía') && aFavs.includes('Madrid Jazz Club'), '15. Una favorita quitada en otro dispositivo no reaparece (antes volvía con la copia de la cuenta)');
  // diseño móvil: nada se sale de la pantalla
  for (const h of ['explorar', 'explorar/libre', 'explorar/radios', 'explorar/ruleta', 'explorar/viaje']) {
    await B.goto(APP + '#/' + h); await B.waitForTimeout(1200); await settled(B);
    const over = await B.evaluate(() => [...document.querySelectorAll('#view *')].filter(e => !e.closest('.x-strip, .seg, .lib-chips, .route, .lib-bar') && e.getBoundingClientRect().right > innerWidth + 1).map(e => e.className).slice(0, 3));
    check(!over.length, `19. Móvil (${h}): nada se sale de la pantalla ${over.join(' ')}`);
  }

  // ===================================================================== C: otra cuenta y movimiento reducido
  const C = await device('C', { reducedMotion: 'reduce' });
  check(await login(C, 'otra@example.com'), 'C inicia sesión con otra cuenta');
  const cData = await C.evaluate(async () => { const d = await import('./js/radio-data.js'); return { favs: d.favs().length, colls: d.collections().length, pp: d.passport().length }; });
  check(!cData.favs && !cData.colls && !cData.pp, '22. Otra cuenta no ve las favoritas, colecciones ni el pasaporte de la primera (RLS)');
  await C.goto(APP + '#/explorar/atlas'); await C.waitForSelector('.atlas-canvas', { timeout: 15000 }); await C.waitForTimeout(1200);
  check(/mapa plano/.test(await C.innerText('.atlas-hint')), '13. Con «reducir movimiento», el Atlas usa el mapa plano');
  await C.goto(APP + '#/explorar/universo'); await C.waitForSelector('.bubble');
  await C.click('[data-act="x-uni-list"]');
  check(!(await C.$('.uni-list[hidden]')) && (await C.$$('.uni-list a')).length > 10, '13. El Universo musical tiene una alternativa en lista');

  // ===================================================================== sin sesión
  const D = await device('D');
  await D.goto(APP + '#/explorar/radios'); await settled(D);
  await D.click('[data-xb="featured"] .st-card [data-act="x-open"]'); await D.click('#sheet [data-sa="fav"]'); await D.waitForTimeout(300);
  const dState = await D.evaluate(async () => { const d = await import('./js/radio-data.js'); return { favs: d.favs().length, mode: d.status().mode }; });
  check(dState.favs === 1 && dState.mode === 'local', '21. Sin sesión, Explorar funciona y guarda las favoritas en el dispositivo');
  check(/Inicia sesión/.test(await D.innerText('.xb.mine')), '21. …y explica que hay que iniciar sesión para tenerlas en todos los dispositivos');

  check(!errs.length, 'Sin errores de JavaScript ' + errs.join(' | '));
  console.log(`\n${ok} correctas · ${fails} fallos`);
  await b.close();
  process.exit(fails ? 1 : 0);
})();
