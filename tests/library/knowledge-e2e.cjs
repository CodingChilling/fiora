// Perfil de artistas, información de canciones (MusicBrainz → Wikidata → Wikipedia) y modos Sorpresa y
// Ambiente en la biblioteca. Los tres servicios se simulan con respuestas en su formato real.
// Necesita solo la app en :8765.
const { chromium } = require('playwright');

const APP = process.env.APP || 'http://localhost:8765/';
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

// --- MusicBrainz
const MB = {
  artists: {
    'Rosalía': [{ id: 'a-rosalia', name: 'Rosalía', score: 100 }, { id: 'a-otra', name: 'Rosalía', score: 100, disambiguation: 'cantante de otro país' }],
    'Banda X': [{ id: 'a-banda', name: 'Banda X', score: 100 }],
    'Duplicado': [{ id: 'a-d1', name: 'Duplicado', score: 100 }, { id: 'a-d2', name: 'Duplicado', score: 100 }],
  },
  lookup: {
    'a-rosalia': { id: 'a-rosalia', name: 'Rosalía', type: 'Person', 'life-span': { begin: '1992-09-25' }, area: { name: 'España' },
      relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q1' } }, { type: 'official homepage', url: { resource: 'https://rosalia.prueba/' } }] },
    'a-banda': { id: 'a-banda', name: 'Banda X', type: 'Group', 'life-span': { begin: '2001' }, 'begin-area': { name: 'Bilbao' }, relations: [
      { type: 'member of band', direction: 'backward', artist: { name: 'Ana Prueba' }, begin: '2001', attributes: ['lead vocals', 'original'] },
      { type: 'member of band', direction: 'backward', artist: { name: 'Pepe Antiguo' }, begin: '2001', end: '2009', ended: true, attributes: ['drums'] }] },
  },
  recordings: {
    'DESPECHÁ|ROSALÍA': [{ id: 'r-desp', title: 'DESPECHÁ', score: 100, 'artist-credit': [{ name: 'ROSALÍA', artist: { name: 'ROSALÍA' } }], releases: [{ title: 'MOTOMAMI +' }, { title: 'DESPECHÁ' }] }],
    'Otra|Banda X': [{ id: 'r-otra', title: 'Otra', score: 100, 'artist-credit': [{ name: 'Banda X', artist: { name: 'Banda X' } }], releases: [{ title: 'Cosas' }] }],
  },
  recLookup: {
    'r-desp': { id: 'r-desp', relations: [{ type: 'producer', artist: { name: 'Dylan Patrice' } }, { type: 'producer', artist: { name: 'Rosalía' } }, { type: 'mix', artist: { name: 'Manny Marroquin' } },
      { type: 'performance', work: { id: 'w-desp', title: 'DESPECHÁ' }, attributes: [] }] },
    'r-otra': { id: 'r-otra', relations: [{ type: 'performance', work: { id: 'w-otra', title: 'Otra (original)' }, attributes: ['cover'] },
      { type: 'samples material', direction: 'forward', recording: { title: 'Ritmo Viejo', 'artist-credit': [{ name: 'Los Clásicos' }] } }] },
  },
  works: {
    'w-desp': { id: 'w-desp', relations: [{ type: 'composer', artist: { name: 'Rosalía' } }, { type: 'composer', artist: { name: 'Dylan Patrice' } }, { type: 'lyricist', artist: { name: 'Rosalía' } }, { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q10' } }] },
    'w-otra': { id: 'w-otra', relations: [{ type: 'composer', artist: { name: 'Autor Original' } }] },
  },
};
const T = (y, m, d, precision = 11) => ({ type: 'time', value: { time: `+${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00Z`, precision } });
const I = id => ({ type: 'wikibase-entityid', value: { id } });
const C = (dv, q) => ({ rank: 'normal', mainsnak: { datavalue: dv }, ...(q ? { qualifiers: q } : {}) });
const WIKIDATA = {
  Q1: { id: 'Q1', claims: { P31: [C(I('Q5'))], P106: [C(I('Q177220'))], P569: [C(T(1992, 9, 25))], P19: [C(I('Q100'))], P136: [C(I('Q200')), C(I('Q201'))], P166: [C(I('Q300'), { P585: [{ datavalue: { value: { time: '+2023-01-01T00:00:00Z', precision: 9 } } }] })] },
    sitelinks: { eswiki: { title: 'Rosalía (cantante)' }, enwiki: { title: 'Rosalía (singer)' } } },
  Q10: { id: 'Q10', claims: { P577: [C(T(2022, 7, 28))], P361: [C(I('Q11'))], P86: [C(I('Q12'))] }, sitelinks: { enwiki: { title: 'Despechá' } } },
};
const LABELS = { Q100: 'Sant Esteve Sesrovires', Q200: 'flamenco', Q201: 'pop', Q300: 'Premio Grammy al mejor álbum latino', Q11: 'Motomami', Q12: 'Rosalía' };
const WIKI = {
  'es|Rosalía (cantante)': { extract: 'Rosalía Vila Tobella es una cantante española.\n\nSu estilo mezcla flamenco y pop.\n\nTercer párrafo de la introducción.\n\n== Biografía ==\nNació en 1992 y estudió en la Escuela Superior de Música de Cataluña durante varios años de formación.\n=== Inicios ===\nPublicó su primer disco en 2017 con buena acogida de la crítica especializada.\n\n== Referencias ==\nUna lista de referencias que no se debe mostrar porque no aporta nada al leer.\n',
    thumbnail: { source: 'https://upload.prueba/rosalia.jpg' } },
  'en|Despechá': { extract: '"Despechá" is a song by Spanish singer Rosalía.\n\n== Background ==\nThe song was first previewed during the Motomami World Tour in July 2022 in Almería.\n' },
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const calls = [];
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  await ctx.route('https://musicbrainz.org/**', route => {
    const u = new URL(route.request().url()), p = u.pathname.replace('/ws/2/', ''), qy = u.searchParams.get('query') || '';
    calls.push(`mb ${p} ${qy}`);
    if (p === 'artist/' || p === 'artist') { const name = (/artist:"([^"]+)"/.exec(qy) || [])[1]; return json(route, { artists: MB.artists[name] || [] }); }
    if (p.startsWith('artist/')) return json(route, MB.lookup[p.slice(7)] || {}, MB.lookup[p.slice(7)] ? 200 : 404);
    if (p.startsWith('release-group')) return json(route, { 'release-groups': /arid:a-rosalia/.test(qy) && /MOTOMAMI/i.test(qy) ? [{ title: 'MOTOMAMI' }] : [] });
    if (p === 'recording/' || p === 'recording') {
      if (/arid:/.test(qy)) return json(route, { recordings: [] });
      const t = (/recording:"([^"]+)"/.exec(qy) || [])[1], a = (/artist:"([^"]+)"/.exec(qy) || [])[1];
      return json(route, { recordings: MB.recordings[`${t}|${a}`] || [] });
    }
    if (p.startsWith('recording/')) return json(route, MB.recLookup[p.slice(10)] || {});
    if (p.startsWith('work/')) return json(route, MB.works[p.slice(5)] || {});
    json(route, {});
  });
  await ctx.route('https://www.wikidata.org/**', route => {
    const u = new URL(route.request().url());
    calls.push(`wd ${u.pathname}${u.search}`);
    const m = /EntityData\/(Q\d+)\.json/.exec(u.pathname);
    if (m) return json(route, { entities: { [m[1]]: WIKIDATA[m[1]] || {} } });
    const act = u.searchParams.get('action');
    if (act === 'wbgetentities') return json(route, { entities: Object.fromEntries(u.searchParams.get('ids').split('|').map(id => [id, { labels: { es: { value: LABELS[id] || id } } }])) });
    if (act === 'query') return json(route, { query: { search: [] } });
    if (act === 'wbsearchentities') return json(route, { search: [] });
    json(route, {});
  });
  await ctx.route(/https:\/\/(es|en)\.wikipedia\.org\/.*/, route => {
    const u = new URL(route.request().url()), lang = u.hostname.slice(0, 2), title = u.searchParams.get('titles');
    calls.push(`wp ${lang} ${title}`);
    const w = WIKI[`${lang}|${title}`];
    json(route, { query: { pages: { 1: w ? { title, ...w } : { title, missing: '' } } } });
  });
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await ctx.route('https://upload.prueba/**', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const until = async (fn, arg, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
  await page.goto(APP + '#/inicio'); await page.waitForTimeout(700);

  // Biblioteca: canciones con audio (WAV generado aquí) para poder reproducirlas.
  await page.evaluate(async () => {
    const st = await import('./js/store.js'), db = await import('./js/db.js');
    const wav = secs => { const sr = 8000, n = sr * secs, b = new ArrayBuffer(44 + n * 2), v = new DataView(b); const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 8) * 3000, true); return new Blob([b], { type: 'audio/wav' }); };
    const MOODS = [['relajada'], ['alegre'], ['enérgica'], ['épica'], ['romántica'], ['bailable'], ['melancólica'], ['agresiva']];
    const mk = (id, title, artist, album, moods) => ({ id, title, artists: [artist], artist, album, genres: ['Pop'], moods, duration: 30, addedAt: Date.now(), hasBlob: true, cloudName: '', fileName: id + '.wav' });
    const list = [mk('t1', 'DESPECHÁ', 'ROSALÍA', 'MOTOMAMI', MOODS[0]), mk('t2', 'Saoko', 'Rosalía', 'MOTOMAMI', MOODS[1]), mk('t3', 'Otra', 'Banda X', 'Cosas', MOODS[2]),
      mk('t4', 'Inventada', 'Nadie Conocido', '', MOODS[3]), mk('t5', 'Repetida', 'Duplicado', '', MOODS[4]), mk('t6', 'Ana Sola', 'Ana Prueba', '', MOODS[5]),
      mk('t7', 'Siete', 'Banda X', 'Cosas', MOODS[6]), mk('t8', 'Ocho', 'Banda X', 'Cosas', MOODS[7])];
    for (const t of list) { await db.put('blobs', t.id, wav(30)); await st.saveTrack(t); }
    st.emit('library');
  });

  // ===================================================================== artistas
  await page.goto(APP + '#/artista/Rosal%C3%ADa'); await page.waitForSelector('[data-kb-artist]');
  check(await until(() => !document.querySelector('[data-kb-artist] .kb-wait')), '1. La página del artista busca información y la muestra');
  const art = await page.innerText('[data-kb-artist]');
  check(/Nacimiento\s*25 de septiembre de 1992/.test(art) && /Sant Esteve Sesrovires/.test(art) && /flamenco · pop/.test(art) && /Premio Grammy al mejor álbum latino \(2023\)/.test(art),
    '   Ficha con datos verificados de Wikidata (nacimiento, lugar, géneros, premios con su año)');
  check(/Rosalía Vila Tobella es una cantante española/.test(art) && !/Tercer párrafo/.test(art) && await page.$('[data-kb-artist] .kb-photo'), '   Biografía de Wikipedia en español (2 párrafos y «Seguir leyendo»), con foto');
  const secs = await page.$$eval('[data-kb-artist] .kb-sec summary', l => l.map(x => x.textContent));
  check(secs.includes('Biografía') && !secs.includes('Referencias'), `   Secciones desplegables, sin las de referencias: ${secs.join(', ')}`);
  check(/Fuentes: MusicBrainz · Wikidata · Wikipedia: «Rosalía \(cantante\)»/.test(art) && /CC BY-SA 4.0/.test(art) && /Web oficial/.test(art), '   Cita las fuentes y la licencia del texto, y enlaza la web oficial');
  check(calls.some(c => /release-group.*arid:a-rosalia/.test(c)) && calls.some(c => c.includes('EntityData/Q1')), '2. Había dos «Rosalía» en MusicBrainz: se elige la que tiene el disco de la biblioteca (MOTOMAMI)');

  await page.goto(APP + '#/artista/Banda%20X'); await page.waitForSelector('[data-kb-artist]');
  await until(() => !document.querySelector('[data-kb-artist] .kb-wait'));
  const band = await page.innerText('[data-kb-artist]');
  check(/Formación\s*2001/.test(band) && /Origen\s*Bilbao/.test(band) && /Miembros[\s\S]*Ana Prueba[\s\S]*lead vocals[\s\S]*2001–hoy/.test(band) && /Antiguos miembros[\s\S]*Pepe Antiguo[\s\S]*2001–2009/.test(band),
    '3. Grupo sin Wikidata: datos y miembros (actuales y antiguos, con años) de MusicBrainz');
  check(!!(await page.$('[data-kb-artist] a[href="#/artista/Ana%20Prueba"]')) && !/Wikipedia/.test(band), '   Los miembros que están en tu biblioteca enlazan a su página; no se inventa biografía');

  await page.goto(APP + '#/artista/Nadie%20Conocido'); await page.waitForSelector('[data-kb-artist]');
  await until(() => !document.querySelector('[data-kb-artist] .kb-wait'));
  check(/No hay información verificada sobre este artista/.test(await page.innerText('[data-kb-artist]')), '4. Sin información: lo dice y no muestra nada más');
  await page.goto(APP + '#/artista/Duplicado'); await page.waitForSelector('[data-kb-artist]');
  await until(() => !document.querySelector('[data-kb-artist] .kb-wait'));
  check(/Hay 2 artistas con este nombre[\s\S]*para no confundirlos/.test(await page.innerText('[data-kb-artist]')), '   Homónimos sin forma de distinguirlos: lo dice en vez de arriesgarse');

  const before = calls.length;
  await page.goto(APP + '#/artista/Rosal%C3%ADa'); await page.waitForSelector('[data-kb-artist] .kb-facts');
  check(calls.length === before, '5. La segunda vez sale del dispositivo, sin volver a consultar');

  // ===================================================================== canciones
  await page.goto(APP + '#/biblioteca/canciones'); await page.waitForSelector('#lib-list .row');
  await page.fill('#lib-q', 'DESPECHÁ'); await page.waitForTimeout(400);
  await page.click('#lib-list .row [data-act="more"]'); await page.waitForSelector('#sheet .menu');
  await page.click('#sheet button:has-text("Sobre esta canción")');
  await page.waitForSelector('#sheet [data-kb-song]');
  check(await until(() => !document.querySelector('#sheet [data-kb-song] .kb-wait')), '6. Menú ⋯ → «Sobre esta canción»');
  const song = await page.innerText('#sheet [data-kb-song]');
  check(/Composición\s*Rosalía · Dylan Patrice/.test(song) && /Letra\s*Rosalía/.test(song) && /Producción\s*Dylan Patrice · Rosalía/.test(song) && /Grabación y mezcla\s*Manny Marroquin/.test(song),
    '   Créditos de MusicBrainz: composición, letra, producción y mezcla');
  check(/Publicación\s*28 de julio de 2022/.test(song) && /Parte de\s*Motomami/.test(song) && (song.match(/Composición/g) || []).length === 1, '   Datos de Wikidata, sin repetir lo que ya está en los créditos');
  check(/Historia[\s\S]*Solo disponible en inglés[\s\S]*is a song by Spanish singer/.test(song), '   Historia de Wikipedia; solo hay artículo en inglés y lo avisa');
  await page.keyboard.press('Escape');

  await page.fill('#lib-q', 'Otra'); await page.waitForTimeout(400);
  await page.click('#lib-list .row [data-act="more"]'); await page.waitForSelector('#sheet .menu');
  await page.click('#sheet button:has-text("Sobre esta canción")');
  await until(() => document.querySelector('#sheet [data-kb-song]') && !document.querySelector('#sheet [data-kb-song] .kb-wait'));
  const other = await page.innerText('#sheet [data-kb-song]');
  check(/Es una versión/.test(other) && /Usa fragmentos de[\s\S]*Ritmo Viejo[\s\S]*Los Clásicos/.test(other) && /No hay un artículo de Wikipedia sobre esta canción/.test(other), '7. Versiones y samples; sin artículo, lo dice');
  await page.keyboard.press('Escape');
  await page.fill('#lib-q', 'Inventada'); await page.waitForTimeout(400);
  await page.click('#lib-list .row [data-act="more"]'); await page.waitForSelector('#sheet .menu');
  await page.click('#sheet button:has-text("Sobre esta canción")');
  await until(() => document.querySelector('#sheet [data-kb-song]') && !document.querySelector('#sheet [data-kb-song] .kb-wait'));
  check(/No hay información verificada sobre esta canción/.test(await page.innerText('#sheet [data-kb-song]')), '   Una canción desconocida: lo dice');
  await page.keyboard.press('Escape');
  await page.fill('#lib-q', '');

  // --- pestaña Info del reproductor
  await page.evaluate(async () => { const { S } = await import('./js/store.js'), pl = await import('./js/player.js'); pl.playQueue([S.tracks.get('t1'), S.tracks.get('t3')]); });
  await page.click('#mini [data-act="open-now"]'); await page.waitForSelector('#now [data-mode="info"]');
  const tabs = await page.$$eval('#now .seg button', l => l.map(x => x.textContent));
  await page.click('#now [data-mode="info"]');
  check(tabs.join() === 'Carátula,Letra,Info,Cola' && await until(() => /Composición/.test(document.querySelector('#now .pane')?.innerText || '')), `8. Pestaña «Info» en el reproductor (${tabs.join(' · ')}) con la canción que suena`);
  await page.evaluate(async () => (await import('./js/player.js')).next());
  check(await until(() => /Es una versión/.test(document.querySelector('#now .pane')?.innerText || '')), '   Al pasar de canción, se actualiza');
  await page.click('#now [data-act="close-now"]');

  // --- sin conexión
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.goto(APP + '#/artista/Ana%20Prueba').catch(() => {}); await page.waitForSelector('[data-kb-artist]');
  await until(() => !document.querySelector('[data-kb-artist] .kb-wait'));
  check(/Sin conexión/.test(await page.innerText('[data-kb-artist]')), '9. Sin conexión lo dice (y lo ya consultado sigue disponible)');
  await ctx.setOffline(false);

  // ===================================================================== modos en la biblioteca
  await page.goto(APP + '#/biblioteca/canciones'); await page.waitForSelector('#lib-list .row');
  check(!!(await page.$('.lib-play [data-act="play-surprise"]')) && !!(await page.$('.lib-play [data-act="play-ambient"]')), '10. Biblioteca → Canciones: botones Sorpresa y Ambiente junto a Reproducir y Aleatorio');
  await page.evaluate(async () => { const st = await import('./js/store.js'); st.S.stats.t2 = { ...(st.S.stats.t2 || {}), last: Date.now() - 3600000, plays: 1 }; });
  await page.click('.lib-play [data-act="play-surprise"]'); await page.waitForTimeout(400);
  const q1 = await page.evaluate(async () => (await import('./js/player.js')).P.queue.map(t => t.id));
  check(q1.length === 8 && q1[q1.length - 1] === 't2', `    Sorpresa: todas, y la escuchada hace una hora al final (${q1.join(',')})`);
  await page.click('.lib-play [data-act="play-ambient"]'); await page.waitForTimeout(400);
  const q2 = await page.evaluate(async () => (await import('./js/player.js')).P.queue.map(t => t.moods[0]));
  const calmFirst = ['relajada', 'romántica', 'melancólica'].includes(q2[0]), peakMid = q2.slice(3, 7).some(m => ['agresiva', 'épica', 'enérgica'].includes(m));
  check(q2.length === 8 && calmFirst && peakMid, `    Ambiente: empieza tranquila y sube (${q2.join(' → ')})`);
  await page.goto(APP + '#/artista/Banda%20X'); await page.waitForSelector('.hero [data-act="play-ambient"]');
  await page.click('.hero [data-act="play-ambient"]'); await page.waitForTimeout(400);
  check(/necesita al menos 6 canciones/.test(await page.innerText('#toasts')), '11. En la página de un artista también; con pocas canciones explica por qué no se puede');
  for (const h of ['#/album/' + encodeURIComponent((await page.evaluate(async () => (await import('./js/library.js')).albumKey((await import('./js/store.js')).S.tracks.get('t3'))))), '#/genero/Pop']) {
    await page.goto(APP + h); await page.waitForSelector('.hero .actions');
    if (!(await page.$('.hero [data-act="play-surprise"]'))) check(false, `    falta Sorpresa en ${h}`);
  }
  check(true, '    y en álbumes y géneros');
  await page.goto(APP + '#/explorar/libre'); await page.waitForTimeout(800);
  check(!(await page.$('[data-act="play-surprise"]')) && !(await page.$('[data-act="play-ambient"]')), '12. En Música libre y radios no aparecen');

  check(errs.length === 0, `13. Sin errores en consola${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await b.close();
  console.log(`\n${ok} ok, ${fails} fallos`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
