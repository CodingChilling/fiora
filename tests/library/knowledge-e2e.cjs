// Perfil de artistas e información de canciones (Wikidata, Wikipedia en español e inglés, TheAudioDB y
// Discogs; sin MusicBrainz) y modos Sorpresa y Ambiente en la biblioteca. Los servicios se simulan con
// respuestas en su formato real. Necesita solo la app en :8765.
const { chromium } = require('playwright');

const APP = process.env.APP || 'http://localhost:8765/';
const SHOTS = process.env.SHOTS;
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

// --- Wikidata
const T = (y, m, d, precision = 11) => ({ type: 'time', value: { time: `+${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00Z`, precision } });
const I = id => ({ type: 'wikibase-entityid', value: { id } });
const Sv = v => ({ type: 'string', value: v });
const C = (dv, q) => ({ rank: 'normal', mainsnak: { datavalue: dv }, ...(q ? { qualifiers: q } : {}) });
const yearQ = y => [{ datavalue: { value: { time: `+${y}-01-01T00:00:00Z`, precision: 9 } } }];
const E = (id, es, desc, claims, sitelinks = {}) => ({ id, labels: { es: { value: es } }, descriptions: { es: { value: desc } }, claims, sitelinks });
const WD = {
  Q1: E('Q1', 'Rosalía', 'cantante española', { P31: [C(I('Q5'))], P106: [C(I('Q177220'))], P569: [C(T(1992, 9, 25))], P19: [C(I('Q100'))], P136: [C(I('Q200')), C(I('Q201'))],
    P166: [C(I('Q300'), { P585: yearQ(2023) }), C(I('Q301'), { P585: yearQ(2019) })], P856: [C(Sv('https://rosalia.prueba/'))], P1953: [C(Sv('5555'))] },
    { eswiki: { title: 'Rosalía (cantante)' }, enwiki: { title: 'Rosalía (singer)' }, frwiki: {}, itwiki: {} }),
  Q2: E('Q2', 'Rosalía', 'cantante de otro país', { P31: [C(I('Q5'))], P106: [C(I('Q177220'))] }, { ptwiki: {} }),
  Q5: E('Q5', 'Banda X', 'grupo de rock', { P31: [C(I('Q215380'))], P571: [C(T(2001, 1, 1, 9))], P740: [C(I('Q101'))],
    P527: [C(I('Q60'), { P580: yearQ(2001) }), C(I('Q61'), { P580: yearQ(2001), P582: yearQ(2009) })] }, {}),
  Q7: E('Q7', 'Duplicado', 'cantante A', { P31: [C(I('Q5'))], P106: [C(I('Q177220'))] }, { eswiki: { title: 'Duplicado (A)' }, enwiki: {} }),
  Q8: E('Q8', 'Duplicado', 'cantante B', { P31: [C(I('Q5'))], P106: [C(I('Q177220'))] }, {}),
  Q9: E('Q9', 'Rosalía', 'municipio', { P31: [C(I('Q2074737'))] }, {}),   // homónimo que no es músico
  Q10: E('Q10', 'Despechá', 'canción de Rosalía', { P31: [C(I('Q134556'))], P175: [C(I('Q1'))], P577: [C(T(2022, 7, 28))], P361: [C(I('Q11'))], P86: [C(I('Q1')), C(I('Q12'))], P162: [C(I('Q12'))], P136: [C(I('Q202'))] },
    { enwiki: { title: 'Despechá' } }),
};
const LABELS = { Q100: 'Sant Esteve Sesrovires', Q101: 'Bilbao', Q200: 'flamenco', Q201: 'pop', Q202: 'merengue', Q300: 'Premio Grammy al mejor álbum latino', Q301: 'Premio Grammy Latino', Q11: 'Motomami', Q12: 'Dylan Patrice', Q1: 'Rosalía', Q60: 'Ana Prueba', Q61: 'Pepe Antiguo' };
const NAMES = { 'Rosalía': ['Q1', 'Q2', 'Q9'], 'Banda X': ['Q5'], 'Duplicado': ['Q7', 'Q8'] };
// --- Wikipedia
const WIKI = {
  'es|Rosalía (cantante)': { extract: 'Rosalía Vila Tobella es una cantante española.\n\nSu estilo mezcla flamenco y pop.\n\nTercer párrafo de la introducción.\n\n== Biografía ==\nNació en 1992 y estudió en la Escuela Superior de Música de Cataluña durante varios años de formación musical.\n\n== Vida personal ==\nDe niña cantaba en las fiestas del pueblo y aprendió flamenco escuchando a Camarón en el coche de su familia.\n\n== Referencias ==\nUna lista de referencias que no se debe mostrar porque no aporta nada al leer.\n' },
  'en|Rosalía (singer)': { extract: 'Rosalía is a Spanish singer.\n\n== Legacy ==\nShe has been credited with bringing flamenco to a global audience and influencing a new generation of artists.\n\n== Personal life ==\nShe lives in Barcelona and is known for her long nails, which she designs herself.\n', thumbnail: { source: 'https://img.prueba/foto-wiki.png' } },
  'en|Despechá': { extract: '"Despechá" is a song by Spanish singer Rosalía.\n\n== Background ==\nThe song was first previewed during the Motomami World Tour in July 2022 in Almería, before its official release.\n' },
  'es|Duplicado (A)': { extract: 'Duplicado A es un cantante.\n' },
};
// --- TheAudioDB y Discogs
const AUDIODB_ARTISTS = {
  'Rosalía': { idArtist: '111', strArtist: 'Rosalía', strArtistThumb: 'https://img.prueba/thumb.png', strArtistFanart: 'https://img.prueba/fanart.png', strBiographyEN: 'Rosalía Vila Tobella (born 25 September 1992) is a Spanish singer. Fans say she rehearses every song more than a hundred times before recording it.', strFacebook: 'www.facebook.com/rosalia', intFormedYear: '' },
  'Solo Audiodb': { idArtist: '222', strArtist: 'Solo Audiodb', strBiographyES: 'Solo Audiodb es un grupo de música independiente formado en Valencia. Grabaron su primer disco en un garaje.', strGenre: 'Indie', strCountry: 'España', intFormedYear: '2015', intMembers: '3' },
};
const AUDIODB_TRACKS = { 'ROSALÍA|DESPECHÁ': { idTrack: '9', strTrack: 'DESPECHÁ', strArtist: 'ROSALÍA', strDescriptionEN: 'Rosalía wrote the song after a summer in Dominican Republic, inspired by merengue and bachata.' } };
const DISCOGS = { 5555: { profile: 'Spanish singer. Before her debut she worked singing at [b]weddings[/b] and in tablaos, and collaborated with [a=Raül Refree] on her first album, recorded in [url=https://x]only two weeks[/url].', members: [] } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1 });
  const calls = [];
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  await ctx.route('https://musicbrainz.org/**', route => { calls.push('MUSICBRAINZ'); json(route, {}); });
  await ctx.route('https://www.wikidata.org/**', route => {
    const u = new URL(route.request().url()), act = u.searchParams.get('action');
    calls.push(`wd ${act} ${u.searchParams.get('srsearch') || u.searchParams.get('search') || u.searchParams.get('ids') || ''}`);
    if (act === 'wbsearchentities') { const n = u.searchParams.get('search'); return json(route, { search: (NAMES[n] || []).map(id => ({ id, label: n })) }); }
    if (act === 'wbgetentities') {
      const props = u.searchParams.get('props');
      return json(route, { entities: Object.fromEntries(u.searchParams.get('ids').split('|').map(id => [id, props === 'labels' ? { labels: { es: { value: LABELS[id] || WD[id]?.labels.es.value || id } } } : (WD[id] || { missing: '' })])) });
    }
    if (act === 'query') {
      const q = u.searchParams.get('srsearch') || '';
      const hits = /MOTOMAMI.*haswbstatement:P175=Q1$/i.test(q) ? ['Q10'] : /DESPECH.*haswbstatement:P175=Q1$/i.test(q) ? ['Q10'] : [];
      return json(route, { query: { search: hits.map(title => ({ title })) } });
    }
    json(route, {});
  });
  await ctx.route(/https:\/\/(es|en)\.wikipedia\.org\/.*/, route => {
    const u = new URL(route.request().url()), lang = u.hostname.slice(0, 2), title = u.searchParams.get('titles');
    calls.push(`wp ${lang} ${title}`);
    const w = WIKI[`${lang}|${title}`];
    json(route, { query: { pages: { 1: w ? { title, ...w } : { title, missing: '' } } } });
  });
  await ctx.route('https://www.theaudiodb.com/**', route => {
    const u = new URL(route.request().url());
    calls.push(`adb ${u.pathname.split('/').pop()} ${u.search}`);
    if (u.pathname.endsWith('search.php')) { const a = AUDIODB_ARTISTS[u.searchParams.get('s')]; return json(route, { artists: a ? [a] : null }); }
    if (u.pathname.endsWith('searchtrack.php')) { const t = AUDIODB_TRACKS[`${u.searchParams.get('s')}|${u.searchParams.get('t')}`]; return json(route, { track: t ? [t] : null }); }
    json(route, {});
  });
  await ctx.route('https://api.discogs.com/**', route => { const id = new URL(route.request().url()).pathname.split('/').pop(); calls.push(`discogs ${id}`); json(route, DISCOGS[id] || {}, DISCOGS[id] ? 200 : 404); });
  await ctx.route('https://img.prueba/**', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const until = async (fn, arg, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
  const ready = sel => until(s => document.querySelector(s) && !document.querySelector(`${s} .kb-wait`), sel);
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
      mk('t7', 'Siete', 'Banda X', 'Cosas', MOODS[6]), mk('t8', 'Ocho', 'Solo Audiodb', 'Cosas', MOODS[7])];
    for (const t of list) { await db.put('blobs', t.id, wav(30)); await st.saveTrack(t); }
    st.emit('library');
  });

  // ===================================================================== artistas
  await page.goto(APP + '#/artista/Rosal%C3%ADa'); await page.waitForSelector('[data-kb-artist]');
  check(await ready('[data-kb-artist]'), '1. La página del artista busca información y la muestra');
  const art = await page.innerText('[data-kb-artist]');
  check(!!(await page.$('[data-kb-artist] .kb-hero.has-bg .kb-bg')) && !!(await page.$('[data-kb-artist] .kb-avatar')) && /SOBRE EL ARTISTA|Sobre el artista/i.test(art) && /cantante española/.test(art), '   Cabecera con imagen de fondo, foto, nombre y descripción');
  const chips = await page.$$eval('[data-kb-artist] .kb-chip', l => l.map(x => x.textContent));
  check(chips.includes('Nacimiento: 1992') && chips.includes('Sant Esteve Sesrovires') && chips.includes('flamenco, pop') && chips.includes('2 premios'), `   Datos rápidos: ${chips.join(' · ')}`);
  check(/Biografía[\s\S]*Rosalía Vila Tobella es una cantante española/.test(art) && !/Tercer párrafo/.test(art) && /Leer la biografía completa/.test(art), '   Tarjeta de biografía (Wikipedia en español) con «Leer la biografía completa»');
  const stories = await page.$$eval('[data-kb-artist] .kb-story', l => l.map(x => ({ t: x.querySelector('b').textContent, src: x.querySelector('.kb-badge').textContent, comm: x.querySelector('.kb-badge').classList.contains('comm') })));
  check(stories.some(x => x.t === 'Vida personal' && !x.comm) && stories.some(x => x.t === 'Legacy' && /inglés/.test(x.src)) && stories.some(x => x.t === 'Según Discogs' && x.comm) && stories.some(x => x.t === 'Según TheAudioDB' && x.comm),
    `2. Historias y curiosidades de varias fuentes: ${stories.map(x => `${x.t} [${x.src}]`).join(' · ')}`);
  check(!stories.some(x => /Referencias|Biografía/.test(x.t)), '   Las secciones normales y las de referencias no se cuentan como historias');
  await page.click('[data-kb-artist] .kb-story >> text=Según Discogs');
  await page.waitForSelector('#sheet .kb-story-sheet');
  const sheetTxt = await page.innerText('#sheet');
  check(/weddings/.test(sheetTxt) && !/\[b\]|\[a=|\[url/.test(sheetTxt) && /puede contener errores/.test(sheetTxt) && !!(await page.$('#sheet a[href="https://www.discogs.com/artist/5555"]')), '   Al abrir una historia: el texto completo, limpio, con aviso si es de una comunidad y enlace a la fuente');
  await page.keyboard.press('Escape');
  const facts = await page.innerText('[data-kb-artist] .kb-grid');
  check(/Premio Grammy al mejor álbum latino \(2023\)/.test(facts) && /Nacimiento\s*25 de septiembre de 1992/.test(facts), '   Tarjeta de datos verificables de Wikidata');
  const src = await page.$$eval('[data-kb-artist] .kb-src-list .kb-badge', l => l.map(x => `${x.textContent}:${x.classList.contains('comm') ? 'comunidad' : 'verificable'}`));
  check(src.join() === 'Wikidata:verificable,Wikipedia:verificable,Wikipedia (inglés):verificable,TheAudioDB:comunidad,Discogs:comunidad' && /Web oficial/.test(art) && /Facebook/.test(art), `   Fuentes marcadas (verificable / comunidad): ${src.join(', ')}`);
  check(calls.some(c => /query "MOTOMAMI" haswbstatement:P175=Q1/.test(c)), '3. Había dos cantantes «Rosalía» (y un municipio): se elige la que tiene el disco de la biblioteca');
  if (SHOTS) { await page.evaluate(() => document.querySelector('[data-kb-artist]').scrollIntoView()); await page.screenshot({ path: `${SHOTS}/artista-1.png` }); await page.evaluate(() => document.querySelector('[data-kb-artist] .kb-h').scrollIntoView()); await page.screenshot({ path: `${SHOTS}/artista-2.png` }); }

  await page.goto(APP + '#/artista/Banda%20X'); await page.waitForSelector('[data-kb-artist]'); await ready('[data-kb-artist]');
  const band = await page.innerText('[data-kb-artist]');
  check(/Desde 2001/.test(band) && /Bilbao/.test(band) && /Miembros[\s\S]*Ana Prueba[\s\S]*2001–hoy/.test(band) && /Antiguos miembros[\s\S]*Pepe Antiguo[\s\S]*2001–2009/.test(band), '4. Grupo: miembros actuales y antiguos con años (Wikidata)');
  check(!!(await page.$('[data-kb-artist] a[href="#/artista/Ana%20Prueba"]')), '   Los miembros que están en tu biblioteca enlazan a su página');
  await page.goto(APP + '#/artista/Solo%20Audiodb'); await page.waitForSelector('[data-kb-artist]'); await ready('[data-kb-artist]');
  const only = await page.innerText('[data-kb-artist]');
  check(/garaje/.test(only) && await page.$eval('[data-kb-artist] .kb-bio .kb-badge', x => x.classList.contains('comm')) && /Desde 2015/.test(only) && /España/.test(only), '5. Sin Wikidata ni Wikipedia: biografía de TheAudioDB, marcada como de la comunidad');
  await page.goto(APP + '#/artista/Nadie%20Conocido'); await page.waitForSelector('[data-kb-artist]'); await ready('[data-kb-artist]');
  check(/No se ha encontrado información sobre este artista/.test(await page.innerText('[data-kb-artist]')), '6. Sin información: lo dice y no inventa nada');
  await page.goto(APP + '#/artista/Duplicado'); await page.waitForSelector('[data-kb-artist]'); await ready('[data-kb-artist]');
  check(/Hay 2 artistas con este nombre; se muestra el más conocido/.test(await page.innerText('[data-kb-artist]')) && /cantante A/.test(await page.innerText('[data-kb-artist]')), '   Homónimos sin pistas en la biblioteca: el más conocido, avisando');
  const before = calls.length;
  await page.goto(APP + '#/artista/Rosal%C3%ADa'); await page.waitForSelector('[data-kb-artist] .kb-hero');
  check(calls.length === before, '7. La segunda vez sale del dispositivo, sin volver a consultar');

  // ===================================================================== canciones
  await page.goto(APP + '#/biblioteca/canciones'); await page.waitForSelector('#lib-list .row');
  await page.fill('#lib-q', 'DESPECHÁ'); await page.waitForTimeout(400);
  await page.click('#lib-list .row [data-act="more"]'); await page.waitForSelector('#sheet .menu');
  await page.click('#sheet button:has-text("Sobre esta canción")');
  await page.waitForSelector('#sheet [data-kb-song]');
  check(await ready('#sheet [data-kb-song]'), '8. Menú ⋯ → «Sobre esta canción»');
  const song = await page.innerText('#sheet [data-kb-song]');
  const sStories = await page.$$eval('#sheet .kb-story b', l => l.map(x => x.textContent));
  const sChips = await page.$$eval('#sheet .kb-chip', l => l.map(x => x.textContent));
  check(sChips.includes('2022') && sChips.includes('Motomami') && sChips.includes('merengue'), `   Datos rápidos: ${sChips.join(' · ')}`);
  check(sStories.join() === 'La canción,Background,Según TheAudioDB', `   Historias: ${sStories.join(' · ')}`);
  check(/Créditos[\s\S]*Composición\s*Rosalía · Dylan Patrice[\s\S]*Producción\s*Dylan Patrice/.test(song), '   Créditos de Wikidata');
  await page.keyboard.press('Escape');
  await page.fill('#lib-q', 'Inventada'); await page.waitForTimeout(400);
  await page.click('#lib-list .row [data-act="more"]'); await page.waitForSelector('#sheet .menu');
  await page.click('#sheet button:has-text("Sobre esta canción")');
  await ready('#sheet [data-kb-song]');
  check(/No se ha encontrado información sobre esta canción/.test(await page.innerText('#sheet [data-kb-song]')), '   Una canción desconocida: lo dice');
  await page.keyboard.press('Escape');
  await page.fill('#lib-q', '');

  // --- pestaña Info del reproductor
  await page.evaluate(async () => { const { S } = await import('./js/store.js'), pl = await import('./js/player.js'); pl.playQueue([S.tracks.get('t1'), S.tracks.get('t4')]); });
  await page.click('#mini [data-act="open-now"]'); await page.waitForSelector('#now [data-mode="info"]');
  const tabs = await page.$$eval('#now .seg button', l => l.map(x => x.textContent));
  await page.click('#now [data-mode="info"]');
  check(tabs.join() === 'Carátula,Letra,Info,Cola' && await until(() => /Historias y curiosidades/.test(document.querySelector('#now .pane')?.innerText || '')), `9. Pestaña «Info» en el reproductor (${tabs.join(' · ')})`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/info.png` });
  await page.evaluate(async () => (await import('./js/player.js')).next());
  check(await until(() => /No se ha encontrado información sobre esta canción/.test(document.querySelector('#now .pane')?.innerText || '')), '   Al pasar de canción, se actualiza');
  await page.click('#now [data-act="close-now"]');
  check(!calls.includes('MUSICBRAINZ'), '10. No se consulta MusicBrainz');

  // --- sin conexión
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.goto(APP + '#/artista/Ana%20Prueba').catch(() => {}); await page.waitForSelector('[data-kb-artist]'); await ready('[data-kb-artist]');
  check(/Sin conexión/.test(await page.innerText('[data-kb-artist]')), '11. Sin conexión lo dice (y lo ya consultado sigue disponible)');
  await ctx.setOffline(false);

  // ===================================================================== modos en la biblioteca
  await page.goto(APP + '#/biblioteca/canciones'); await page.waitForSelector('#lib-list .row');
  check(!!(await page.$('.lib-play [data-act="play-surprise"]')) && !!(await page.$('.lib-play [data-act="play-ambient"]')), '12. Biblioteca → Canciones: botones Sorpresa y Ambiente junto a Reproducir y Aleatorio');
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
  check(/necesita al menos 6 canciones/.test(await page.innerText('#toasts')), '13. En la página de un artista también; con pocas canciones explica por qué no se puede');
  for (const h of ['#/album/' + encodeURIComponent((await page.evaluate(async () => (await import('./js/library.js')).albumKey((await import('./js/store.js')).S.tracks.get('t3'))))), '#/genero/Pop']) {
    await page.goto(APP + h); await page.waitForSelector('.hero .actions');
    if (!(await page.$('.hero [data-act="play-surprise"]'))) check(false, `    falta Sorpresa en ${h}`);
  }
  check(true, '    y en álbumes y géneros');
  await page.goto(APP + '#/explorar/libre'); await page.waitForTimeout(800);
  check(!(await page.$('[data-act="play-surprise"]')) && !(await page.$('[data-act="play-ambient"]')), '14. En Música libre y radios no aparecen');

  check(errs.length === 0, `15. Sin errores en consola${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
  await b.close();
  console.log(`\n${ok} ok, ${fails} fallos`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
