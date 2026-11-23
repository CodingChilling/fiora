// Biblioteca: ver u ocultar las canciones de un bucket sin desconectarlo.
// Necesita solo la app en :8765 (ver ../playlists/README.md). Los buckets y canciones se crean en el
// propio navegador; no se contacta con Oracle.
const { chromium } = require('playwright');

const APP = process.env.APP || 'http://localhost:8765/';
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|prueba/.test(m.text())) errs.push(`consola: ${m.text()}`); });
  await page.route('https://oracle.prueba/**', r => r.fulfill({ status: 404, body: '' }));   // que la app no salga a internet
  await page.goto(APP + '#/inicio'); await page.waitForTimeout(800);

  // 2 buckets (Rock: 3 canciones, Clásica: 2) y 2 canciones solo en el dispositivo; una playlist con canciones de los dos.
  await page.evaluate(async () => {
    const st = await import('./js/store.js');
    st.S.settings.buckets = [{ id: 'b1', name: 'Rock', url: 'https://oracle.prueba/p/a/n/x/b/rock/o/' }, { id: 'b2', name: 'Clásica', url: 'https://oracle.prueba/p/b/n/x/b/clasica/o/' }];
    const mk = (id, title, artist, album, genre, bucket) => ({ id, title, artists: [artist], artist, album, genres: [genre], moods: ['calma'], duration: 200, addedAt: Date.now(),
      hasBlob: !bucket, cloudName: bucket ? `${artist}/${album}/${title}.mp3` : '', bucketId: bucket || '' });
    const list = [mk('r1', 'Rayo', 'Banda Rock', 'Voltios', 'Rock', 'b1'), mk('r2', 'Trueno', 'Banda Rock', 'Voltios', 'Rock', 'b1'), mk('r3', 'Chispa', 'Otra Banda', 'Fusibles', 'Rock', 'b1'),
      mk('c1', 'Adagio', 'Orquesta', 'Clásicos', 'Clásica', 'b2'), mk('c2', 'Nocturno', 'Pianista', 'Noches', 'Clásica', 'b2'),
      mk('l1', 'Maqueta', 'Yo', 'Demos', 'Rock', ''), mk('l2', 'Ensayo', 'Yo', 'Demos', 'Pop', '')];
    for (const t of list) await st.saveTrack(t);
    const pd = await import('./js/playlists-data.js');
    st.S.playlists.push(pd.normalize({ id: 'pmix', name: 'Mezcla', trackIds: ['r1', 'c1', 'l1'], createdAt: Date.now() }));
    await st.saveKV('settings', false);
    st.emit('library');
  });
  const titles = () => page.$$eval('#lib-list .row .row-text b', l => l.map(x => x.textContent).sort());
  const chips = () => page.$$eval('.lib-buckets .bucket-chip', l => l.map(c => ({ t: c.textContent.trim(), on: c.getAttribute('aria-pressed') === 'true' })));

  await page.goto(APP + '#/biblioteca/canciones'); await page.waitForSelector('.lib-buckets');
  let c = await chips();
  check(c.length === 2 && c[0].t === 'Rock3' && c[1].t === 'Clásica2' && c.every(x => x.on), `1. La biblioteca muestra un botón por bucket con sus canciones: ${c.map(x => x.t).join(', ')}`);
  check((await titles()).length === 7, '   Al principio se ven todas (7)');

  // --- ocultar Rock
  await page.click('.bucket-chip[data-bid="b1"]');
  await page.waitForSelector('.bucket-chip[data-bid="b1"][aria-pressed="false"]');
  check(JSON.stringify(await titles()) === JSON.stringify(['Adagio', 'Ensayo', 'Maqueta', 'Nocturno']), `2. Un toque oculta las canciones de «Rock»: ${(await titles()).join(', ')}`);
  check(/4 canciones/.test(await page.innerText('.lib-sum')) && /Canciones4/.test((await page.textContent('.lib-bar .seg')).replace(/\s/g, '')), '   El resumen y las pestañas cuentan solo lo visible');
  check(/Canciones de «Rock» ocultas/.test(await page.innerText('#toasts')), '   Avisa de lo que ha hecho');
  await page.goto(APP + '#/biblioteca/albumes'); await page.waitForSelector('.lib-buckets');
  const albums = await page.$$eval('#lib-list .card b', l => l.map(x => x.textContent).sort());
  check(!albums.includes('Voltios') && !albums.includes('Fusibles') && albums.includes('Clásicos'), `   Álbumes sin los de Rock: ${albums.join(', ')}`);
  await page.goto(APP + '#/biblioteca/artistas'); await page.waitForSelector('.lib-buckets');
  const arts = await page.$$eval('#lib-list .card b', l => l.map(x => x.textContent));
  check(!arts.includes('Banda Rock') && arts.includes('Yo'), '   Artistas sin los de Rock');
  await page.goto(APP + '#/genero/Rock'); await page.waitForSelector('.hero');
  check(/1 canción/.test(await page.innerText('.hero p')), '3. La página del género Rock solo tiene la canción del dispositivo');
  const recs = await page.evaluate(async () => { const r = await import('./js/recs.js'); return { mood: r.moodMix('calma', 50).map(t => t.id), daily: r.dailyMix?.().map(t => t.id) || [] }; });
  check(![...recs.mood, ...recs.daily].some(id => id.startsWith('r')), '   Las mezclas y ambientes no proponen canciones ocultas');
  await page.goto(APP + '#/biblioteca/canciones'); await page.waitForSelector('#lib-q');
  await page.fill('#lib-q', 'rayo'); await page.waitForTimeout(400);
  check((await titles()).length === 0, '   Buscar tampoco las encuentra');
  await page.fill('#lib-q', '');
  await page.goto(APP + '#/playlist/pmix'); await page.waitForTimeout(800);
  check(/Rayo/.test(await page.innerText('#view')), '4. Las playlists siguen teniendo sus canciones (no se desconecta nada)');
  check(await page.evaluate(async () => (await import('./js/cloud.js')).buckets().length) === 2, '   El bucket sigue conectado');
  const snap = await page.evaluate(async () => (await import('./js/sync.js')).snapshot(true).prefs.hiddenBuckets);
  check(JSON.stringify(snap.v) === '["b1"]' && snap.at > 0, '   Se guarda en la cuenta con las demás preferencias');

  // --- se conserva al recargar
  await page.goto(APP + '#/biblioteca/canciones'); await page.reload(); await page.waitForSelector('.lib-buckets');
  c = await chips();
  check(!c[0].on && c[1].on && (await titles()).length === 4, '5. Se conserva al recargar');

  // --- ocultar todos
  await page.click('.bucket-chip[data-bid="b2"]'); await page.waitForTimeout(500);
  check(JSON.stringify(await titles()) === JSON.stringify(['Ensayo', 'Maqueta']), '6. Con los dos ocultos quedan las del dispositivo');
  await page.evaluate(async () => { const st = await import('./js/store.js'); for (const id of ['l1', 'l2']) st.S.tracks.delete(id); st.emit('library'); });
  await page.waitForSelector('.empty');
  check(/Tus buckets están ocultos/.test(await page.innerText('#view')) && (await chips()).length === 2, '   Si no queda nada visible lo explica y deja volver a mostrarlos');
  await page.click('.bucket-chip[data-bid="b1"]'); await page.click('.bucket-chip[data-bid="b2"]').catch(() => {});
  await page.waitForSelector('.bucket-chip[data-bid="b2"][aria-pressed="true"]');
  check((await titles()).length === 5 && (await chips()).every(x => x.on), '7. Otro toque vuelve a mostrarlas todas');
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), '   Sin desbordamiento horizontal a 390 px');

  check(errs.length === 0, `8. Sin errores en consola${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await b.close();
  console.log(`\n${ok} ok, ${fails} fallos`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
