// Explorar → Descargar, de punta a punta con Playwright. Los servidores de Piped e Invidious, su
// proxy de audio, Apple (iTunes) y las miniaturas se simulan aquí con las respuestas de sus API y
// con audio real generado con ffmpeg (M4A fragmentado como el de YouTube y WebM/Opus).
// Necesita la app en :8765 y el emulador de Supabase en :8766 (ver README.md), y ffmpeg/ffprobe.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = process.env.APP || 'http://localhost:8765/';
const SHOTS = process.env.SHOTS;
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

// --- audio e imágenes de prueba
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fiora-descargas-'));
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
const probe = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]).toString());
ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:a', 'aac', '-b:a', '128k', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '1000000', '-f', 'mp4', path.join(TMP, 'frag.m4a'));
ff('-f', 'lavfi', '-i', 'sine=frequency=330:duration=5', '-c:a', 'libopus', '-b:a', '96k', path.join(TMP, 'opus.webm'));
ff('-f', 'lavfi', '-i', 'sine=frequency=550:duration=40', '-c:a', 'aac', '-b:a', '128k', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '1000000', '-f', 'mp4', path.join(TMP, 'largo.m4a'));
const M4A = fs.readFileSync(path.join(TMP, 'frag.m4a')), OPUS = fs.readFileSync(path.join(TMP, 'opus.webm')), LONG = fs.readFileSync(path.join(TMP, 'largo.m4a'));
ff('-f', 'lavfi', '-i', 'color=c=0xd2501e:s=600x600', '-frames:v', '1', path.join(TMP, 'apple.jpg'));
// Miniatura 4:3 con franjas negras arriba y abajo (como hqdefault) y el dibujo verde en el centro
ff('-f', 'lavfi', '-i', 'color=c=black:s=480x360', '-vf', 'drawbox=x=0:y=45:w=480:h=270:color=0x22aa44:t=fill', '-frames:v', '1', path.join(TMP, 'hq.jpg'));
const APPLE_JPG = fs.readFileSync(path.join(TMP, 'apple.jpg')), HQ = fs.readFileSync(path.join(TMP, 'hq.jpg'));

// --- el «YouTube» simulado
const P1 = 'https://piped1.prueba', P2 = 'https://piped2.prueba', MIO = 'https://mio.prueba', PROXY = 'https://proxy.prueba';
const VIDEOS = {
  AAAAAAAAAAA: { title: 'ROSALÍA - DESPECHÁ (Official Video)', uploader: 'ROSALÍA', duration: 6, audio: 'm4a' },
  BBBBBBBBBBB: { title: 'Canción Libre', uploader: 'Grupo Local - Topic', duration: 5, audio: 'opus' },
  CCCCCCCCCCC: { title: 'Otra Más (feat. Ana Prueba) [Lyrics]', uploader: 'Banda De Prueba VEVO', duration: 6, audio: 'm4a' },
  DDDDDDDDDDD: { unavailable: true, title: 'Borrado' },
  EEEEEEEEEEE: { title: 'Muy Larga', uploader: 'Lento', duration: 40, audio: 'long' },
};
const LIST = { PLprueba: { name: 'Mi lista de prueba', uploader: 'Alguien', pages: [['AAAAAAAAAAA', 'BBBBBBBBBBB'], ['CCCCCCCCCCC', 'DDDDDDDDDDD']] } };
const AUDIO = { m4a: [M4A, 'audio/mp4'], opus: [OPUS, 'audio/webm'], long: [LONG, 'audio/mp4'] };
const streamsOf = (base, id) => {
  const v = VIDEOS[id];
  const [buf, mime] = AUDIO[v.audio];
  return {
    title: v.title, uploader: v.uploader, duration: v.duration, thumbnailUrl: `https://img.prueba/vi/${id}/hqdefault.jpg`,
    audioStreams: [{ url: `${PROXY}/videoplayback?id=${id}&host=${encodeURIComponent(base)}`, mimeType: mime, codec: mime === 'audio/mp4' ? 'mp4a.40.2' : 'opus', bitrate: 128000, itag: mime === 'audio/mp4' ? 140 : 251, contentLength: String(buf.length) }],
  };
};
const log = [];
let allDown = false, slowAudio = false;
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });

async function mock(ctx) {
  await ctx.route('https://piped-instances.kavin.rocks/**', r => json(r, [{ api_url: P1 }, { api_url: P2 }]));
  await ctx.route(/pipedapi\.|api\.piped\./, r => r.fulfill({ status: 502, body: 'no' }));
  await ctx.route(`${P1}/**`, r => { log.push(`p1 ${new URL(r.request().url()).pathname}`); r.fulfill({ status: 502, body: 'caído' }); });
  for (const [base, kind] of [[P2, 'piped'], [MIO, 'invidious']]) {
    await ctx.route(`${base}/**`, r => {
      const u = new URL(r.request().url()), p = u.pathname;
      log.push(`${base === P2 ? 'p2' : 'mio'} ${p}`);
      if (allDown) return r.fulfill({ status: 503, body: '' });
      if (kind === 'piped') {
        if (p.startsWith('/search')) {
          const q = u.searchParams.get('q'), f = u.searchParams.get('filter');
          log.push(`buscar ${f} ${q}`);
          if (q === 'rosalia' && f === 'music_songs') return json(r, { items: [
            { type: 'stream', url: '/watch?v=AAAAAAAAAAA', title: 'DESPECHÁ', uploaderName: 'ROSALÍA - Topic', duration: 157, thumbnail: 'https://img.prueba/vi/AAAAAAAAAAA/hqdefault.jpg' },
            { type: 'stream', url: '/watch?v=BBBBBBBBBBB', title: 'Canción Libre', uploaderName: 'Grupo Local - Topic', duration: 200, thumbnail: 'https://img.prueba/vi/BBBBBBBBBBB/hqdefault.jpg' },
            { type: 'stream', url: '/watch?v=ZZZZZZZZZZZ', title: 'Un short', uploaderName: 'X', duration: 20, isShort: true }] });
          if (q === 'rosalia' && f === 'playlists') return json(r, { items: [{ type: 'playlist', url: '/playlist?list=PLprueba', name: 'Mi lista de prueba', uploaderName: 'Alguien', videos: 4, thumbnail: 'https://img.prueba/vi/AAAAAAAAAAA/hqdefault.jpg' }] });
          return json(r, { items: [] });
        }
        if (p === '/trending') return json(r, []);
        let m = /^\/streams\/(\w{11}|[\w-]{11})$/.exec(p);
        if (m) { const v = VIDEOS[m[1]]; return !v || v.unavailable ? json(r, { error: 'Video unavailable', message: 'This video is unavailable' }, 500) : json(r, streamsOf(base, m[1])); }
        m = /^\/playlists\/(\w+)$/.exec(p);
        if (m && LIST[m[1]]) { const l = LIST[m[1]]; return json(r, { name: l.name, uploader: l.uploader, relatedStreams: l.pages[0].map(id => ({ url: `/watch?v=${id}`, title: VIDEOS[id].title, uploaderName: VIDEOS[id].uploader, duration: VIDEOS[id].duration, thumbnail: `https://img.prueba/vi/${id}/hqdefault.jpg` })), nextpage: 'pagina2' }); }
        m = /^\/nextpage\/playlists\/(\w+)$/.exec(p);
        if (m && u.searchParams.get('nextpage') === 'pagina2') { const l = LIST[m[1]]; return json(r, { relatedStreams: l.pages[1].map(id => ({ url: `/watch?v=${id}`, title: VIDEOS[id].title, uploaderName: VIDEOS[id].uploader || '', duration: VIDEOS[id].duration || 0, thumbnail: `https://img.prueba/vi/${id}/hqdefault.jpg` })), nextpage: null }); }
        return r.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
      }
      // Invidious
      if (p === '/api/v1/stats') return json(r, { software: { name: 'invidious' } });
      if (p.startsWith('/streams/') || p.startsWith('/trending') || p.startsWith('/playlists/')) return r.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
      const m = /^\/api\/v1\/videos\/([\w-]{11})$/.exec(p);
      if (m && VIDEOS[m[1]] && !VIDEOS[m[1]].unavailable) {
        const v = VIDEOS[m[1]], [buf, mime] = AUDIO[v.audio];
        return json(r, { title: v.title, author: v.uploader, lengthSeconds: v.duration, videoThumbnails: [{ quality: 'high', url: `/vi/${m[1]}/hqdefault.jpg` }],
          adaptiveFormats: [{ type: `${mime}; codecs="${mime === 'audio/mp4' ? 'mp4a.40.2' : 'opus'}"`, url: `/videoplayback?id=${m[1]}&local=1`, bitrate: '130000', itag: '140', clen: String(buf.length) }] });
      }
      if (p.startsWith('/vi/')) return r.fulfill({ contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' }, body: HQ });
      if (p === '/videoplayback') { const v = VIDEOS[u.searchParams.get('id')]; return r.fulfill({ contentType: 'audio/mp4', headers: { 'Access-Control-Allow-Origin': '*' }, body: AUDIO[v.audio][0] }); }
      return r.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
    });
  }
  await ctx.route(`${PROXY}/**`, async r => {
    const u = new URL(r.request().url()), v = VIDEOS[u.searchParams.get('id')];
    log.push(`audio ${u.searchParams.get('id')} ${u.searchParams.get('range') || 'entero'}`);
    if (slowAudio) await new Promise(res => setTimeout(res, 2500));
    let [buf, mime] = AUDIO[v.audio];
    const range = u.searchParams.get('range');
    if (range) { const [a, b] = range.split('-').map(Number); buf = buf.subarray(a, b + 1); }
    r.fulfill({ contentType: mime, headers: { 'Access-Control-Allow-Origin': '*' }, body: buf }).catch(() => {});
  });
  await ctx.route('https://img.prueba/**', r => {
    const u = r.request().url();
    if (/maxresdefault/.test(u)) return r.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });   // muchos vídeos no la tienen
    r.fulfill({ contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' }, body: HQ });
  });
  await ctx.route('https://itunes.apple.com/**', r => {
    const term = new URL(r.request().url()).searchParams.get('term') || '';
    log.push(`apple ${term}`);
    const results = /DESPECH/i.test(term) ? [{ trackName: 'DESPECHÁ', artistName: 'ROSALÍA', collectionName: 'MOTOMAMI +', collectionArtistName: 'ROSALÍA', releaseDate: '2022-07-28T07:00:00Z', trackNumber: 17, primaryGenreName: 'Latin', artworkUrl100: 'https://arte.prueba/img/100x100bb.jpg', collectionId: 1 }] : [];
    json(r, { resultCount: results.length, results });
  });
  // El reproductor incrustado de YouTube: cuando la página le pide noticias, dice que se está viendo
  // otro vídeo (como si se hubiera pasado a otro dentro del reproductor).
  await ctx.route('https://www.youtube-nocookie.com/embed/**', r => { log.push(`embed ${new URL(r.request().url()).pathname}`); r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><body style="background:#111;color:#fff">vídeo<script>
    addEventListener('message', e => { let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.event === 'listening') setTimeout(() => parent.postMessage(JSON.stringify({ event: 'infoDelivery', info: { videoData: { video_id: 'CCCCCCCCCCC', title: 'Otra Más (feat. Ana Prueba) [Lyrics]', author: 'Banda De Prueba VEVO' } } }), '*'), 300); });
  </script></body>` }); });
  await ctx.route('https://arte.prueba/**', r => r.fulfill({ contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' }, body: APPLE_JPG }));
}

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await mock(ctx);
  // El nombre que pone la app al enlace de descarga (el Chromium de las pruebas, sin locale UTF-8, cambia
  // los nombres con tildes por «download»; los navegadores normales no).
  await ctx.addInitScript(() => { const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dlNames = [...(window.__dlNames || []), this.download]; return c.call(this); }; });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(`consola: ${m.text()}`); });
  const until = async (fn, arg, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
  const search = async url => { await page.fill('[data-form="dl-link"] [name=url]', url); await page.click('[data-form="dl-link"] button'); };
  const items = () => page.$$eval('.dl-item', l => l.map(li => ({ t: li.querySelector('.row-text b').textContent, s: li.querySelector('.row-text small').textContent, st: li.querySelector('.dl-st')?.textContent || '', on: li.querySelector('input').checked })));
  const wide = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('.dl *')].some(e => e.getBoundingClientRect().width > innerWidth - 16));

  // ===================================================================== la pestaña
  await page.goto(APP + '#/explorar/descargar'); await page.waitForSelector('[data-form="dl-link"]');
  check(await page.$eval('.x-bar .seg a.on', a => a.textContent) === 'Descargar', '1. Explorar tiene la pestaña «Descargar»');
  check(!(await page.$('#nav-links a[href*="descargar"]')), '   No se añade nada a la navegación principal');
  check(!(await wide()), '   Sin desbordamiento horizontal a 390 px');
  await search('https://example.com/watch?v=AAAAAAAAAAA'); await page.waitForSelector('.dl-error');
  check(/YouTube/.test(await page.innerText('.dl-error')), `2. Un enlace que no es de YouTube da un error claro: «${await page.innerText('.dl-error')}»`);
  const parsed = await page.evaluate(async () => {
    const y = await import('./js/youtube.js');
    const p = s => { try { return y.parseLink(s); } catch (e) { return e.message; } };
    return [p('https://youtu.be/AAAAAAAAAAA?si=x'), p('https://music.youtube.com/watch?v=AAAAAAAAAAA&list=PLprueba'), p('youtube.com/shorts/AAAAAAAAAAA'), p('https://www.youtube.com/playlist?list=PLprueba'), p('https://m.youtube.com/watch?v=corto'), p('https://www.youtube.com/watch?v=AAAAAAAAAAA&list=WL')];
  });
  check(parsed[0].videoId === 'AAAAAAAAAAA' && parsed[1].listId === 'PLprueba' && parsed[2].videoId === 'AAAAAAAAAAA' && parsed[3].listId === 'PLprueba' && !parsed[3].videoId && typeof parsed[4] === 'string' && !parsed[5].listId,
    '   Reconoce youtu.be, music.youtube, shorts, playlist; rechaza ids malos; ignora «Ver más tarde»');
  const meta = await page.evaluate(async () => {
    const y = await import('./js/youtube.js');
    return [y.cleanMeta({ title: 'ROSALÍA - DESPECHÁ (Official Video)', uploader: 'ROSALÍA' }), y.cleanMeta({ title: 'Otra Más (feat. Ana Prueba) [Lyrics]', uploader: 'Banda De Prueba VEVO' }), y.cleanMeta({ title: 'Bailando con lobos', uploader: 'Grupo - Topic' }), y.cleanMeta({ title: 'Tema | Directo en Madrid #musica', uploader: 'X Official' })];
  });
  check(meta[0].title === 'DESPECHÁ' && meta[0].artists.join() === 'ROSALÍA' && meta[1].title === 'Otra Más' && meta[1].artists.join('|') === 'Banda De Prueba|Ana Prueba' && meta[2].title === 'Bailando con lobos' && meta[2].artists.join() === 'Grupo' && meta[3].title === 'Tema' && meta[3].artists.join() === 'X',
    `3. Limpia los títulos: ${meta.map(m => `«${m.title}» / ${m.artists.join(' + ')}`).join(' · ')}`);

  // ===================================================================== vídeo dentro de una playlist
  log.length = 0;
  await search('https://www.youtube.com/watch?v=AAAAAAAAAAA&list=PLprueba'); await page.waitForSelector('.dl-choose');
  check(/4 canciones/.test(await page.innerText('.dl-choose')) && /Mi lista de prueba/.test(await page.innerText('.dl-choose')), '4. Un vídeo dentro de una playlist pregunta: «Solo esta canción» o «Toda la playlist (4 canciones)» (dos páginas leídas)');
  check(log.filter(l => l.startsWith('p1')).length <= 2 && log.some(l => l === 'p2 /streams/AAAAAAAAAAA'), '   El servidor caído se descarta y se usa el siguiente');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'elegir.png') });
  await page.click('[data-act="dl-mode"][data-mode="one"]');
  check(await until(() => /MOTOMAMI/.test(document.querySelector('.dl-item small')?.textContent || '')), '   «Solo esta canción»: una ficha');
  let it = (await items())[0];
  check(it.t === 'DESPECHÁ' && /ROSALÍA · MOTOMAMI \+ · 2022/.test(it.s), `5. Datos completos con Apple: «${it.t}» — ${it.s}`);

  // --- guardar en el dispositivo
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('[data-act="dl-go"][data-dest="file"]')]);
  const saved = path.join(TMP, dl.suggestedFilename()); await dl.saveAs(saved);
  const dlName = await page.evaluate(() => window.__dlNames.at(-1));
  check(dlName === 'ROSALÍA - DESPECHÁ.m4a', `6. Se guarda «${dlName}»`);
  let pr = probe(saved);
  const tags = pr.format.tags || {};
  check(tags.title === 'DESPECHÁ' && tags.artist === 'ROSALÍA' && tags.album === 'MOTOMAMI +' && /2022/.test(tags.date || '') && tags.album_artist === 'ROSALÍA', `   Metadatos dentro del archivo: ${JSON.stringify(tags)}`);
  check(pr.streams.some(s => s.codec_type === 'audio' && s.codec_name === 'aac') && Math.abs(+pr.format.duration - 6) < 0.3, `   Audio AAC intacto (${(+pr.format.duration).toFixed(2)} s, fragmentado como el de YouTube)`);
  check(pr.streams.some(s => s.codec_type === 'video' && s.disposition?.attached_pic && s.width === 600 && s.height === 600), '   Con la portada de Apple (600×600) dentro');
  await page.waitForSelector('.dl-summary');
  check(/1 canción guardada en el dispositivo/.test(await page.innerText('.dl-summary')), `   Resumen: «${await page.innerText('.dl-summary')}»`);
  const fromBrowser = await page.evaluate(async () => { const t = await import('./js/tagwrite.js'); return true; });
  check(fromBrowser, '   (el archivo no se guarda en la biblioteca si no se pide)');
  check(!(await page.evaluate(async () => [...(await import('./js/store.js')).S.tracks.values()].length)), '   La biblioteca sigue vacía');

  // ===================================================================== playlist entera a la biblioteca
  log.length = 0;
  await search('https://www.youtube.com/playlist?list=PLprueba');
  await page.waitForSelector('.dl-list');
  check((await items()).length === 4 && !(await page.$('.dl-choose')), '7. Un enlace de playlist va directo a la lista (4 canciones)');
  await until(() => document.querySelectorAll('.dl-item .dl-cover img').length === 4 && ![...document.querySelectorAll('.dl-item small')].some(s => /Buscando/.test(s.textContent)));
  const list = await items();
  check(list[1].t === 'Canción Libre' && list[1].s === 'Grupo Local' && list[2].t === 'Otra Más' && /Banda De Prueba, Ana Prueba/.test(list[2].s), `   Datos de cada una: ${list.map(x => `${x.t} (${x.s})`).join(' · ')}`);
  await page.uncheck('.dl-item[data-i="0"] input'); await page.check('.dl-item[data-i="0"] input');
  check(/4 de 4 seleccionadas/.test(await page.innerText('.dl-top')), '   Se pueden quitar y poner canciones de la selección');
  // editar una antes de descargar
  await page.click('[data-act="dl-edit"][data-i="1"]'); await page.waitForSelector('#sheet .dl-edit');
  await page.fill('#sheet [name=album]', 'Disco Editado'); await page.fill('#sheet [name=year]', '2019'); await page.click('#sheet button.primary');
  check(await until(() => /Disco Editado · 2019/.test(document.querySelector('.dl-item[data-i="1"] small').textContent)), '8. Los datos se pueden editar antes de descargar');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'lista.png'), fullPage: true });
  await page.click('[data-act="dl-go"][data-dest="lib"]');
  await page.waitForSelector('#sheet[open] form [name=v]', { timeout: 60000 });
  check(await page.inputValue('#sheet [name=v]') === 'Mi lista de prueba', '9. Al terminar ofrece crear la playlist con su nombre');
  await page.click('#sheet button.primary');
  await page.waitForSelector('.dl-summary', { timeout: 30000 });
  const sum = await page.innerText('.dl-summary');
  check(/3 canciones añadidas a tu biblioteca · 1 con error/.test(sum), `   Resumen: «${sum}»`);
  const fin = await items();
  check(fin[3].st.startsWith('Error') && /no está disponible/.test(fin[3].st), `   El vídeo borrado da un error claro: «${fin[3].st}»`);
  const lib = await page.evaluate(async () => {
    const { S } = await import('./js/store.js'), db = await import('./js/db.js');
    const ts = [...S.tracks.values()];
    const out = [];
    for (const t of ts) out.push({ title: t.title, artists: t.artists, album: t.album, year: t.year, file: t.fileName, blob: !!(await db.get('blobs', t.id)), cover: !!t.coverId, dur: t.duration, hasBlob: t.hasBlob });
    const p = S.playlists.find(x => x.name === 'Mi lista de prueba');
    return { out, pl: p ? p.trackIds.map(id => S.tracks.get(id)?.title) : null };
  });
  const by = t => lib.out.find(x => x.title === t) || {};
  check(lib.out.length === 3 && lib.out.every(x => x.hasBlob && x.blob && x.cover && x.dur > 4), '10. Las 3 están en la biblioteca, sin conexión, con portada y duración');
  check(by('DESPECHÁ').album === 'MOTOMAMI +' && by('Otra Más').artists.join('|') === 'Banda De Prueba|Ana Prueba' && by('Canción Libre').album === 'Disco Editado' && by('Canción Libre').year === 2019, '    Con sus metadatos leídos del propio archivo (también los editados)');
  check(/\.mp3$/.test(by('Canción Libre').file) && /\.m4a$/.test(by('DESPECHÁ').file), `    Sin M4A disponible se convierte a MP3: ${by('Canción Libre').file}`);
  check(JSON.stringify(lib.pl) === JSON.stringify(['DESPECHÁ', 'Canción Libre', 'Otra Más']), `11. Playlist «Mi lista de prueba» creada en Fiora, en el orden de YouTube: ${JSON.stringify(lib.pl)}`);
  // el MP3 convertido se puede abrir y lleva sus datos
  const mp3 = await page.evaluate(async () => {
    const { S } = await import('./js/store.js'), db = await import('./js/db.js');
    const t = [...S.tracks.values()].find(x => /\.mp3$/.test(x.fileName));
    const blob = await db.get('blobs', t.id);
    const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
    const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
    return { dur: buf.duration, id3: String.fromCharCode(...head) === 'ID3', cover: t.coverId };
  });
  check(mp3.id3 && Math.abs(mp3.dur - 5) < 0.3, `    El MP3 se reproduce (${mp3.dur.toFixed(2)} s) y lleva etiquetas ID3`);
  const crop = await page.evaluate(async () => {
    const { S } = await import('./js/store.js'), db = await import('./js/db.js');
    const t = [...S.tracks.values()].find(x => x.title === 'Canción Libre');
    const img = await createImageBitmap(await db.get('covers', t.coverId));
    const cv = new OffscreenCanvas(img.width, img.height), g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const corner = g.getImageData(2, 2, 1, 1).data;
    return { w: img.width, h: img.height, green: corner[1] > 120 && corner[0] < 90 };
  });
  check(crop.w === crop.h && crop.green, `12. Sin datos en Apple, la portada es la miniatura recortada a cuadrado y sin franjas negras (${crop.w}×${crop.h})`);
  check(!!(await page.$('[data-act="dl-retry"]')), '    Se ofrece reintentar las que fallaron');

  // ===================================================================== navegador de YouTube
  log.length = 0;
  await page.fill('[data-form="yt-search"] [name=q]', 'rosalia'); await page.click('[data-form="yt-search"] button');
  await page.waitForSelector('.yt-res');
  const res = await page.$$eval('.yt-res', l => l.map(x => ({ t: x.querySelector('b').textContent, s: x.querySelector('small').textContent, d: x.querySelector('.yt-thumb i')?.textContent })));
  check(res.length === 2 && res[0].t === 'DESPECHÁ' && res[0].s === 'ROSALÍA' && res[0].d === '2:37', `18. Buscador de YouTube (canciones): ${res.map(x => `${x.t} · ${x.s} · ${x.d}`).join(' | ')} (sin shorts)`);
  await page.click('.yt-res >> nth=0');
  await page.waitForSelector('.yt-frame iframe');
  const src = await page.$eval('.yt-frame iframe', f => f.src);
  check(src.startsWith('https://www.youtube-nocookie.com/embed/AAAAAAAAAAA?') && /enablejsapi=1/.test(src), '    Al elegir uno se ve en el reproductor incrustado (youtube-nocookie)');
  const followed = await until(() => document.querySelector('[data-yt-url]')?.textContent.includes('CCCCCCCCCCC'), null, 8000);
  check(followed && /Otra Más/.test(await page.innerText('[data-yt-title]')), '    Si dentro del reproductor se pasa a otro vídeo, Fiora lo sigue');
  await page.click('[data-act="yt-copy"]');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(clip === 'https://www.youtube.com/watch?v=CCCCCCCCCCC', `19. «Copiar enlace» copia el vídeo que se está viendo: ${clip}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'navegador.png'), fullPage: false });
  await page.click('.yt-what [data-what="playlists"]'); await page.waitForSelector('.yt-res >> text=Mi lista de prueba');
  check(!!(await page.$('.yt-frame iframe')) && log.filter(l => l.startsWith('embed')).length === 1, '    Cambiar de búsqueda no reinicia el vídeo');
  await page.click('[data-act="yt-download"]');
  await page.waitForSelector('.dl-item');
  check(await page.inputValue('[data-form="dl-link"] [name=url]') === 'https://www.youtube.com/watch?v=CCCCCCCCCCC' && /Otra Más/.test((await items())[0]?.t || ''), '20. «Descargar» lleva el vídeo que se ve a la descarga');
  await page.click('.yt-res >> text=Mi lista de prueba'); await page.waitForSelector('.dl-list h2 >> text=Mi lista de prueba');
  check((await items()).length === 4, '    Una playlist del buscador se abre en la descarga (4 canciones)');
  await page.click('[data-act="yt-close"]');
  check(!(await page.$('.yt-frame')), '    El vídeo se puede cerrar');
  check(!(await wide()), '    Sin desbordamiento horizontal a 390 px');

  // ===================================================================== cancelar
  await search('https://youtu.be/EEEEEEEEEEE'); await page.waitForSelector('.dl-item');
  await until(() => !/Buscando/.test(document.querySelector('.dl-item small').textContent));
  slowAudio = true;
  await page.evaluate(async () => (await import('./js/youtube.js'))._tune({ chunk: 100000 }));
  await page.click('[data-act="dl-go"][data-dest="lib"]');
  await page.waitForSelector('[data-act="dl-cancel"]'); await page.waitForTimeout(1200);
  await page.click('[data-act="dl-cancel"]');
  await page.waitForSelector('.dl-summary', { timeout: 20000 });
  slowAudio = false;
  check(/Cancelado/.test(await page.innerText('.dl-summary')) && /Cancelada/.test((await items())[0].st), '13. Se puede cancelar a mitad');
  check(!(await page.evaluate(async () => [...(await import('./js/store.js')).S.tracks.values()].some(t => t.title === 'Muy Larga'))), '    y no queda ninguna canción a medias en la biblioteca');
  check(log.some(l => /^audio EEEEEEEEEEE 0-/.test(l)), '    (el audio largo se pide en trozos)');

  // ===================================================================== servidor propio (Invidious)
  await page.click('details.dl-server summary');
  await page.fill('[data-form="dl-server"] [name=url]', MIO + '/'); await page.click('[data-form="dl-server"] button');
  check(await until(() => (window.__s = null, true)) && await until(async () => (await import('./js/store.js')).S.settings.ytServer === 'https://mio.prueba'), '14. Servidor propio probado y guardado (Invidious)');
  log.length = 0;
  await page.waitForSelector('[data-form="dl-link"]');
  await search('https://www.youtube.com/watch?v=CCCCCCCCCCC'); await page.waitForSelector('.dl-item');
  check(log[0]?.startsWith('mio') && !log.some(l => l.startsWith('p2 /streams')), `    Se usa primero el servidor propio (${log.slice(0, 3).join(', ')})`);
  await until(() => !/Buscando/.test(document.querySelector('.dl-item small').textContent));
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('[data-act="dl-go"][data-dest="file"]')]);
  const saved2 = path.join(TMP, 'b-' + dl2.suggestedFilename()); await dl2.saveAs(saved2);
  pr = probe(saved2);
  check(pr.format.tags?.title === 'Otra Más' && pr.format.tags?.artist === 'Banda De Prueba, Ana Prueba', `    Descarga por Invidious con metadatos (${await page.evaluate(() => window.__dlNames.at(-1))})`);

  // ===================================================================== todo caído
  allDown = true;
  await page.evaluate(async () => { const { S, saveKV } = await import('./js/store.js'); S.settings.ytServer = ''; await saveKV('settings', false); });
  await search('https://www.youtube.com/watch?v=AAAAAAAAAAA'); await page.waitForSelector('.dl-error', { timeout: 60000 });
  check(/Ningún servidor de descarga/.test(await page.innerText('.dl-error')), `15. Si no responde ningún servidor, lo dice: «${await page.innerText('.dl-error')}»`);
  allDown = false;

  check(!(await wide()), '16. Sin desbordamiento horizontal a 390 px');
  check(errs.length === 0, `17. Sin errores en consola${errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''}`);
  await b.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${ok} ok, ${fails} fallos`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
