// Pruebas de las playlists con Supabase (emulador sobre PostgreSQL real con la migración).
// Uso: ver tests/playlists/README.md
const { chromium } = require('playwright');
const fs = require('fs');
const SB = 'https://rabhgmnjvxwlttlviywc.supabase.co';
const API = process.env.API || 'http://localhost:8766';
const APP = process.env.APP || 'http://localhost:8765/';
const FIX = __dirname + '/fixtures/';
const IMG = FIX + 'imgs/';
const sql = async q => (await fetch(API + '/__sql', { method: 'POST', body: q })).json();
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  async function device(name, mobile) {
    const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 860 } });
    await ctx.route(SB + '/**', async route => {
      if (ctx.cut) return route.abort('internetdisconnected');   // corte de red simulado
      try { const resp = await route.fetch({ url: route.request().url().replace(SB, API) }); await route.fulfill({ response: resp }); }
      catch { await route.abort('failed').catch(() => {}); }
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR_FAILED/.test(m.text())) errs.push(`${name} consola: ${m.text()}`); });
    await page.goto(APP + '#/inicio');
    await page.waitForSelector('#nav-links a');
    return { ctx, page };
  }
  const ev = (page, fn, arg) => page.evaluate(fn, arg);
  const until = async (page, fn, arg, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
  const status = page => ev(page, async () => (await import('./js/playlists-data.js')).status());
  const login = async (page, email) => {
    await page.goto(APP + '#/ajustes');
    await page.fill('[data-form="login"] [name=email]', email);
    await page.fill('[data-form="login"] [name=password]', 'secreta123');
    await page.click('[data-form="login"] button[value="in"]');
    return until(page, async () => { const s = (await import('./js/playlists-data.js')).status(); return s.mode === 'ready' && !s.pending && !s.busy; });
  };
  const synced = async page => { await page.waitForTimeout(500); return until(page, async () => { const s = (await import('./js/playlists-data.js')).status(); return s.mode === 'ready' && !s.pending && !s.busy && !s.uploading; }, null, 30000); };
  const pick = async (page, click, files) => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), click()]); await fc.setFiles(files); };
  const toastHas = (page, re, ms = 15000) => until(page, re => new RegExp(re).test(document.querySelector('#toasts').innerText), re.source, ms);
  const closeSheet = async page => { if (await page.$('#sheet[open]')) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); } };

  // ================================================================ dispositivo A (escritorio)
  const { page: A } = await device('A', false);
  const audio = fs.readdirSync(FIX + 'audio').map(f => ({ name: f, mimeType: 'audio/wav', buffer: fs.readFileSync(FIX + 'audio/' + f) }));
  await A.setInputFiles('#pick-files', audio);
  await until(A, async () => (await import('./js/store.js')).S.tracks.size >= 6);
  // metadatos para recomendaciones y modo ambiente
  await ev(A, async () => {
    const st = await import('./js/store.js');
    const M = { 'despecha': ['Pop', ['alegre', 'bailable']], 'Dakiti': ['Reggaeton', ['bailable']], 'DÁKITI': ['Reggaeton', ['enérgica']], 'Única (Live)': ['Rock', ['épica']], 'Track 01': ['Rock', ['relajada']] };
    for (const t of st.S.tracks.values()) { const m = M[t.title] || ['Rock', ['relajada']]; t.genres = [m[0]]; t.moods = m[1]; await st.saveTrack(t); }
  });
  const ids = await ev(A, async () => [...(await import('./js/store.js')).S.tracks.values()].map(t => [t.id, t.title]));
  const idOf = title => ids.find(x => x[1] === title)[0];
  // 1. Una playlist del formato ANTERIOR (antes de esta versión), sin sesión
  const legacy = [idOf('despecha'), idOf('Dakiti'), idOf('DÁKITI'), idOf('Única (Live)')];
  await ev(A, async l => { const st = await import('./js/store.js'); await st.savePlaylist({ id: 'pvieja', name: 'Midnight Memories', trackIds: l, deleted: false }); }, legacy);
  check(await login(A, 'ana@example.com'), 'A inicia sesión y la sincronización queda lista');
  let rows = await sql(`select p.name, array_agg(t.track_id order by t.position) ids from fiora_playlists p join fiora_playlist_tracks t using (user_id) where t.playlist_id = p.id and p.id = 'pvieja' group by p.name`);
  check(rows[0]?.name === 'Midnight Memories' && JSON.stringify(rows[0].ids) === JSON.stringify(legacy), '1/2. La playlist anterior se sube a Supabase sin perder canciones ni orden');

  // 2. Información desde el editor
  await A.goto(APP + '#/playlist/pvieja');
  await A.waitForSelector('.pl-hero');
  await A.click('.pl-info [data-act="pl-edit"]');
  await A.fill('[data-ed-form="info"] [name=emoji]', '🌙');
  await A.fill('[data-ed-form="info"] [name=description]', 'Para las noches largas');
  await A.fill('[data-ed-form="info"] [name=quote]', 'Lo mejor pasa de madrugada');
  await A.click('[data-tag-sugg="Noche"]'); await A.click('[data-tag-sugg="Chill"]');
  await A.selectOption('[data-ed-form="info"] [name=mood]', 'nostálgica');
  await A.click('[data-ed-form="info"] button.primary');
  await synced(A);
  rows = await sql(`select emoji, description, quote, tags, mood from fiora_playlists where id = 'pvieja'`);
  check(rows[0]?.emoji === '🌙' && rows[0].description === 'Para las noches largas' && rows[0].quote === 'Lo mejor pasa de madrugada' && rows[0].tags.join() === 'Noche,Chill' && rows[0].mood === 'nostálgica', '2. Título, emoji, descripción, frase, etiquetas y ánimo se guardan en Supabase');

  // 4/5. Portada (<16 MB) → Storage; colores automáticos
  await A.click('[data-ed-tab="look"]');
  await pick(A, () => A.click('[data-ed="cover-upload"]'), IMG + 'portada.jpg');
  check(await toastHas(A, /portada guardada en tu cuenta/i), '5. Portada de 0,9 MB subida');
  await synced(A);
  rows = await sql(`select cover, colors from fiora_playlists where id = 'pvieja'`);
  let files = await (await fetch(API + '/__files')).json();
  const coverPath = rows[0]?.cover?.path;
  check(coverPath && files.some(f => f[0] === `fiora-playlists/${coverPath}`) && files.some(f => f[0] === `fiora-playlists/${rows[0].cover.thumb}`), '4. Portada y miniatura en Storage, y la ruta en la base de datos');
  check(Array.isArray(rows[0]?.colors?.auto) && rows[0].colors.auto.length >= 2, `18. Colores sacados de la portada y guardados (${rows[0]?.colors?.auto})`);
  // contraste del texto en la cabecera
  const ratio = await ev(A, async () => { const im = await import('./js/images.js'); const el = document.querySelector('.pl-preview'); const cs = getComputedStyle(el); const ink = cs.getPropertyValue('--pl-ink').trim(); return Math.min(...['--pl-1', '--pl-2', '--pl-3'].map(k => im.contrast(cs.getPropertyValue(k).trim(), ink))); });
  check(ratio >= 4.5, `Contraste del texto sobre el degradado ≥ 4,5 (mínimo ${ratio.toFixed(2)})`);
  // validación real: un texto con extensión .jpg
  await pick(A, () => A.click('[data-ed="cover-upload"]'), IMG + 'falsa.jpg');
  check(await toastHas(A, /No es una imagen admitida/), 'Validación real: un archivo que no es imagen se rechaza aunque se llame .jpg');

  // 6/7/8. Foto de más de 16 MB: aviso y modo local
  const before = (await (await fetch(API + '/__files')).json()).length;
  await pick(A, () => A.click('[data-ed="cover-upload"]'), IMG + 'enorme.png');
  await A.waitForSelector('.big-photo');
  const warn = await A.innerText('.big-photo');
  check(/Esta fotografía supera los 16 MB/.test(warn) && /Puedes utilizar esta fotografía localmente en este dispositivo, pero no se subirá a la nube ni estará disponible automáticamente en tus otros dispositivos/.test(warn), '7. Aviso claro con el texto pedido');
  check(['Usar localmente', 'Elegir otra foto', 'Cancelar'].every(x => warn.includes(x)), '7. Opciones: usar localmente, elegir otra, cancelar');
  await A.click('.big-photo [data-c="local"]');
  await A.waitForTimeout(1500);
  await synced(A);
  const after = await (await fetch(API + '/__files')).json();
  check(after.length === before && !after.some(f => f[1] > 16 * 1024 * 1024), '6. La foto de 20 MB NO se sube a Storage');
  rows = await sql(`select cover from fiora_playlists where id = 'pvieja'`);
  check(rows[0].cover.path === coverPath, '6. En Supabase sigue la portada anterior (lo local no se sincroniza)');
  await closeSheet(A);
  await A.goto(APP + '#/playlist/pvieja'); await A.waitForSelector('.pl-hero');
  check(await until(A, () => /Solo local/.test(document.querySelector('.pl-hero .pl-cover')?.innerText || '')), '8. La portada local lleva el indicador «Solo local»');
  check(!(await sql(`select count(*)::int n from fiora_playlists where cover::text like '%enorme%' or cover::text like '%blob:%'`))[0].n, '6. Nada binario ni blob: en PostgreSQL');

  // 9/10. Carrusel: 15 fotos como máximo, reordenar y eliminar
  await A.click('.pl-info [data-act="pl-edit"]'); await A.click('[data-ed-tab="photos"]');
  await pick(A, () => A.click('[data-ed="photos-add"]'), Array.from({ length: 16 }, (_, i) => `${IMG}foto${String(i + 1).padStart(2, '0')}.jpg`));
  check(await toastHas(A, /Solo caben 15 fotos/), '9. Al elegir 16 fotos avisa de que caben 15');
  for (let i = 0; i < 120 && (await sql(`select count(*)::int n from fiora_playlist_photos where playlist_id = 'pvieja'`))[0].n < 15; i++) await A.waitForTimeout(250);
  await synced(A);
  await A.waitForTimeout(800);
  rows = await sql(`select id, path from fiora_playlist_photos where playlist_id = 'pvieja' order by position`);
  check(rows.length === 15, `9. 15 fotos en Supabase (${rows.length})`);
  check(await A.$eval('[data-ed="photos-add"]', x => x.disabled), '9. No se pueden añadir más de 15');
  const firstId = rows[0].id, lastPath = rows[14].path;
  // arrastrar la primera al final
  const h0 = await A.$('.ed-photos li:first-child [data-drag-item]'), last = await A.$('.ed-photos li:last-child');
  const b0 = await h0.boundingBox(), bl = await last.boundingBox();
  await A.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2); await A.mouse.down();
  for (let y = b0.y; y <= bl.y + bl.height - 5; y += 25) await A.mouse.move(b0.x + b0.width / 2, y);
  await A.mouse.move(b0.x + b0.width / 2, bl.y + bl.height - 4); await A.mouse.up();
  await synced(A); await A.waitForTimeout(600);
  rows = await sql(`select id from fiora_playlist_photos where playlist_id = 'pvieja' order by position`);
  check(rows[rows.length - 1].id === firstId, '10. Reordenar arrastrando se guarda en Supabase');
  // eliminar la última (la que ahora está al final es firstId) → su archivo se borra de Storage
  const delId = rows[3].id, delPath = (await sql(`select path from fiora_playlist_photos where id = '${delId}'`))[0].path;
  await A.click(`[data-ed="photo-del"][data-id="${delId}"]`);
  await A.click('.ed-confirm [data-y]');
  await synced(A); await A.waitForTimeout(1200);
  files = await (await fetch(API + '/__files')).json();
  check(!(await sql(`select 1 from fiora_playlist_photos where id = '${delId}'`)).length && !files.some(f => f[0].endsWith(delPath)), '10. Eliminar una foto la quita de la base de datos y su archivo de Storage (sin huérfanos)');
  // descripción de una foto
  const capId = rows[0].id;
  await A.fill(`[data-caption="${capId}"]`, 'Atardecer en Cádiz'); await A.press(`[data-caption="${capId}"]`, 'Tab');
  await synced(A); await A.waitForTimeout(500);
  check((await sql(`select caption from fiora_playlist_photos where id = '${capId}'`))[0]?.caption === 'Atardecer en Cádiz', 'Descripción de una foto guardada');
  await closeSheet(A);

  // 11/12. Orden manual arrastrando; los filtros no lo cambian
  await A.goto(APP + '#/playlist/pvieja'); await A.waitForSelector('.pl-songs');
  await A.click('[data-act="pl-reorder"]'); await A.waitForTimeout(500);
  const handles = await A.$$('.pl-list .row [data-drag]');
  const hb = await handles[3].boundingBox(), tb = await (await A.$('.pl-list .row')).boundingBox();
  await A.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await A.mouse.down();
  for (let y = hb.y; y >= tb.y + 4; y -= 12) await A.mouse.move(hb.x + hb.width / 2, y);
  await A.mouse.up();
  await synced(A); await A.waitForTimeout(500);
  const order1 = (await sql(`select array_agg(track_id order by position) ids from fiora_playlist_tracks where playlist_id = 'pvieja'`))[0].ids;
  check(order1[0] === legacy[3] && order1.length === 4, '12. El orden manual (arrastrando) se guarda en Supabase');
  await A.selectOption('[data-plsort]', 'title');
  await A.fill('[data-plq]', 'a');
  await A.waitForTimeout(1500);
  const order2 = (await sql(`select array_agg(track_id order by position) ids from fiora_playlist_tracks where playlist_id = 'pvieja'`))[0].ids;
  check(JSON.stringify(order1) === JSON.stringify(order2), '11. Ordenar por título y buscar no cambian el orden guardado');
  await A.click('[data-act="pl-clear-view"]');
  const shown = await A.$$eval('.pl-list .row', r => r.map(x => x.dataset.id));
  check(JSON.stringify(shown) === JSON.stringify(order1), '11. «Volver a mi orden» recupera el orden personalizado');

  // 15. Capítulos
  await A.click('.pl-info [data-act="pl-edit"]'); await A.click('[data-ed-tab="org"]');
  await A.click('[data-ed="sec-add"]'); await A.waitForTimeout(400); await A.click('[data-ed="sec-add"]'); await A.waitForTimeout(400);
  const secIds = await A.$$eval('.ed-secs li', l => l.map(x => x.dataset.id));
  await A.fill(`[data-sec-name="${secIds[0]}"]`, 'El comienzo'); await A.press(`[data-sec-name="${secIds[0]}"]`, 'Tab');
  await A.fill(`[data-sec-name="${secIds[1]}"]`, 'Medianoche'); await A.press(`[data-sec-name="${secIds[1]}"]`, 'Tab');
  await closeSheet(A);
  for (const [tid, sec] of [[order1[0], 'El comienzo'], [order1[1], 'Medianoche'], [order1[2], 'Medianoche']]) {
    await A.goto(APP + '#/playlist/pvieja'); await A.waitForSelector('.pl-songs');
    await A.click(`.pl-list .row[data-id="${tid}"] [data-act="more"]`);
    await A.click('#sheet .menu button:has-text("Mover a capítulo")');
    await A.waitForTimeout(300);
    await A.click(`#sheet .menu button:has-text("${sec}")`);
    await A.waitForTimeout(300);
  }
  await synced(A);
  rows = await sql(`select s.name, count(t.*)::int n from fiora_playlist_sections s left join fiora_playlist_tracks t on t.section_id = s.id and t.playlist_id = s.playlist_id where s.playlist_id = 'pvieja' group by s.name, s.position order by s.position`);
  check(JSON.stringify(rows) === JSON.stringify([{ name: 'El comienzo', n: 1 }, { name: 'Medianoche', n: 2 }]), '15. Capítulos y sus canciones en Supabase');
  await A.goto(APP + '#/playlist/pvieja'); await A.waitForSelector('.chapter');
  await A.click(`[data-act="pl-play-chapter"][data-sid="${secIds[1]}"]`);
  await A.waitForTimeout(500);
  let q = await ev(A, async () => (await import('./js/player.js')).P.queue.map(t => t.id));
  check(JSON.stringify(q.slice(0, 2)) === JSON.stringify([order1[1], order1[2]]) && q.length === 2, '15. «Reproducir el capítulo» suena solo ese capítulo');
  // plegar y que se recuerde
  await A.click(`[data-act="pl-chapter-toggle"][data-sid="${secIds[0]}"]`); await synced(A);
  check((await sql(`select collapsed from fiora_playlist_sections where id = '${secIds[0]}'`))[0].collapsed === true, 'Capítulo plegado (se guarda)');

  // 16. Destacadas (máx. 3, sin duplicar al reproducir)
  for (const tid of [order1[0], order1[1], order1[2], order1[3]]) {
    await A.click(`.pl-list .row[data-id="${tid}"] [data-act="more"]`).catch(async () => { await A.click(`[data-act="pl-chapter-toggle"][data-sid="${secIds[0]}"]`); await A.click(`.pl-list .row[data-id="${tid}"] [data-act="more"]`); });
    await A.click('#sheet .menu button:has-text("Destacar")');
    await A.waitForTimeout(400);
  }
  check(await toastHas(A, /Ya hay 3 destacadas/), '16. No se pueden fijar más de 3 destacadas');
  await synced(A);
  check((await sql(`select featured from fiora_playlists where id = 'pvieja'`))[0].featured.length === 3, '16. Las 3 destacadas, en Supabase');
  await A.click('.pl-hero [data-act="pl-play"]'); await A.waitForTimeout(400);
  q = await ev(A, async () => (await import('./js/player.js')).P.queue.map(t => t.id));
  check(q.length === 4 && new Set(q).size === 4, '16. Reproducir la playlist: las destacadas no se repiten');

  // 17. Notas personales
  await A.click(`.pl-list .row[data-id="${order1[3]}"] [data-act="more"]`);
  await A.click('#sheet .menu button:has-text("Añadir una nota")');
  await A.fill('#sheet textarea[name=v]', 'Esta canción me recuerda a aquel viaje de verano');
  await A.click('#sheet button.primary'); await synced(A);
  check((await sql(`select note from fiora_playlist_notes where playlist_id = 'pvieja'`))[0]?.note === 'Esta canción me recuerda a aquel viaje de verano', '17. La nota se guarda en Supabase');
  await A.goto(APP + '#/playlist/pvieja'); await A.waitForSelector('.pl-songs');
  check(!!(await A.$(`.row[data-id="${order1[3]}"] .note-mark`)) && (await A.innerText('.pl-notes')).includes('aquel viaje'), '17. Indicador discreto en la canción y módulo de notas');

  // 18. Módulos y presentación
  await A.click('.pl-info [data-act="pl-edit"]'); await A.click('[data-ed-tab="mods"]');
  await A.click('[data-ed-mod="discover"]'); await A.click('[data-ed="density"][data-v="compact"]');
  await synced(A);
  rows = await sql(`select settings from fiora_playlists where id = 'pvieja'`);
  check(rows[0].settings.density === 'compact' && rows[0].settings.modules.find(m => m[0] === 'discover')[1] === false, '18. Módulos y densidad se guardan en Supabase');
  await A.click('[data-ed="density"][data-v="comfortable"]'); await A.click('[data-ed-mod="discover"]');
  await closeSheet(A);

  // 13. Recomendaciones reales
  await A.goto(APP + '#/playlist/pvieja'); await A.waitForSelector('.pl-discover');
  const recs = await A.$$eval('.disc [data-act="pl-disc-add"]', l => l.map(x => x.dataset.tid));
  const pl = await ev(A, async () => (await import('./js/store.js')).S.playlists.find(p => p.id === 'pvieja').trackIds);
  const lib = await ev(A, async () => [...(await import('./js/store.js')).S.tracks.keys()]);
  check(recs.length > 0 && recs.every(id => lib.includes(id) && !pl.includes(id)), `13. «Descubre más» propone canciones reales de la biblioteca que no están en la playlist (${recs.length})`);
  await A.click(`[data-act="pl-disc-add"][data-tid="${recs[0]}"]`); await synced(A);
  check((await sql(`select count(*)::int n from fiora_playlist_tracks where playlist_id = 'pvieja'`))[0].n === 5, '13. Añadir una recomendación la guarda en la playlist');
  // playlist sin relación → estado informativo
  await ev(A, async () => { const st = await import('./js/store.js'); const d = await import('./js/playlists-data.js'); const p = d.normalize({ id: 'pvacia', name: 'Vacía', trackIds: [] }); await st.savePlaylist(p); });
  await A.goto(APP + '#/playlist/pvacia'); await A.waitForSelector('.pl-discover');
  check(/Añade algunas canciones/.test(await A.innerText('.pl-discover')) && !(await A.$('.disc')), '13. Sin datos: mensaje informativo, sin recomendaciones inventadas');

  // 14. Estadísticas reales (las canciones de prueba duran 1 s: se cuentan al pasar la mitad)
  await A.goto(APP + '#/playlist/pvieja'); await A.waitForSelector('.pl-hero');
  await A.click('.pl-hero [data-act="pl-play"]');
  await until(A, async () => (await import('./js/player.js')).P.index >= 2, null, 20000);
  await A.waitForTimeout(1500);
  await ev(A, async () => (await import('./js/player.js')).toggle());
  await A.waitForTimeout(4000);
  rows = await sql(`select sum(plays)::int n, count(distinct track_id)::int t from fiora_playlist_plays where playlist_id = 'pvieja'`);
  check(rows[0].n >= 2, `14. Las escuchas desde la playlist se registran en Supabase (${rows[0].n})`);
  await A.goto(APP + '#/playlist/pvacia'); await A.goto(APP + '#/playlist/pvieja');
  await until(A, () => /reproducciones/.test(document.querySelector('[data-plstats]')?.innerText || ''));
  const stx = await A.innerText('.pl-stats');
  check(/reproducciones/.test(stx) && /Últimos 30 días/.test(stx) && /Reparto por artista/.test(stx), '14. Estadísticas con datos reales y gráficos');

  // 20. La reproducción sigue al navegar y editar
  await A.click('.pl-hero [data-act="pl-play"]'); await A.waitForTimeout(300);
  const cur = await ev(A, async () => (await import('./js/player.js')).P.current?.id);
  await A.goto(APP + '#/biblioteca'); await A.goto(APP + '#/playlist/pvieja');
  await A.click('.pl-info [data-act="pl-edit"]'); await A.fill('[data-ed-form="info"] [name=name]', 'Midnight Memories ✨'); await A.click('[data-ed-form="info"] button.primary'); await closeSheet(A);
  const st20 = await ev(A, async () => { const { P } = await import('./js/player.js'); return { id: P.current?.id, q: P.queue.length }; });
  check(st20.id && st20.q >= 4, '20. Navegar y editar la playlist no corta la reproducción');
  await ev(A, async () => { const { P } = await import('./js/player.js'); P.audio.pause(); });
  await synced(A);

  // Subida interrumpida y sin conexión
  await fetch(API + '/__cut?n=1');
  await A.click('.pl-info [data-act="pl-edit"]'); await A.click('[data-ed-tab="photos"]');
  await A.click(`[data-ed="photo-del"][data-id="${capId}"]`); await A.click('.ed-confirm [data-y]'); await synced(A);
  await pick(A, () => A.click('[data-ed="photos-add"]'), IMG + 'foto16.jpg');
  check(await toastHas(A, /Se cortó la subida/), 'Subida interrumpida: avisa y la foto se queda en el dispositivo');
  check(await until(A, () => /Pendiente de subir/.test(document.querySelector('.ed-photos')?.innerText || '')), 'La foto aparece como «Pendiente de subir» (no como sincronizada)');
  await ev(A, async () => (await import('./js/playlists-data.js')).processUploads());
  await synced(A); await A.waitForTimeout(800);
  check((await sql(`select count(*)::int n from fiora_playlist_photos where playlist_id = 'pvieja'`))[0].n === 14, 'Al reintentar, la foto pendiente se sube sola');
  await closeSheet(A);
  A.context().cut = true; await A.context().setOffline(true);
  await A.goto(APP + '#/playlist/pvieja').catch(() => {});
  await ev(A, async () => { const st = await import('./js/store.js'); const p = st.S.playlists.find(x => x.id === 'pvieja'); p.description = 'Editada sin conexión'; await st.savePlaylist(p); });
  await A.waitForTimeout(2500);
  const off = await status(A);
  check(off.pending >= 1 && (off.mode === 'offline' || off.mode === 'ready'), `Sin conexión: el cambio queda pendiente (${off.mode}, ${off.pending})`);
  A.context().cut = false; await A.context().setOffline(false);
  await ev(A, () => dispatchEvent(new Event('online')));
  await synced(A);
  check((await sql(`select description from fiora_playlists where id = 'pvieja'`))[0].description === 'Editada sin conexión', 'Al volver la conexión, se guarda solo');
  // Almacenamiento local agotado (foto de más de 16 MB que no cabe en el dispositivo)
  await A.goto(APP + '#/playlist/pvacia'); await A.waitForSelector('.pl-hero');
  await ev(A, async () => { const db = await import('./js/db.js'); const orig = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { if (String(k).startsWith('plimg:')) throw new DOMException('lleno', 'QuotaExceededError'); return orig.call(this, v, k); }; });
  await A.click('.pl-info [data-act="pl-edit"]'); await A.click('[data-ed-tab="look"]');
  await pick(A, () => A.click('[data-ed="cover-upload"]'), IMG + 'enorme.png');
  await A.click('.big-photo [data-c="local"]');
  check(await toastHas(A, /No queda espacio en este dispositivo/), 'Almacenamiento lleno: aviso claro, sin fingir que se guardó');
  await closeSheet(A);

  // ================================================================ dispositivo B (móvil), misma cuenta
  const { page: B } = await device('B', true);
  await B.goto(APP + '#/playlist/pvieja');
  check(await login(B, 'ana@example.com'), 'B (móvil) inicia sesión con la misma cuenta');
  await B.goto(APP + '#/playlist/pvieja'); await B.waitForSelector('.pl-songs');
  check(/no están en este dispositivo/.test(await B.innerText('.pl-songs')), 'Sin la música en el dispositivo: lo explica (no dice «sin resultados»)');
  // la misma música que en A (como al sincronizar la nube)
  await B.setInputFiles('#pick-files', audio);
  await until(B, async () => (await import('./js/store.js')).S.tracks.size >= 6);
  await until(B, async () => (await import('./js/store.js')).S.playlists.some(p => p.id === 'pvieja' && p.photos.length === 14));
  await B.goto(APP + '#/playlist/pvieja');
  await B.waitForSelector('.pl-hero');
  const bt = await B.innerText('.pl');
  check(/Midnight Memories ✨/.test(bt) && /Lo mejor pasa de madrugada/.test(bt) && /#Noche/.test(bt) && /Medianoche/.test(bt) && /aquel viaje/.test(bt), '3. En el otro dispositivo aparecen título, frase, etiquetas, capítulos y notas' + (/Midnight Memories ✨/.test(bt) ? '' : ' → B ve: ' + bt.slice(0, 400).replace(/\n+/g, ' | ')));
  check(await until(B, () => !!document.querySelector('.pl-hero .pl-cover.has img')), '4. La portada se descarga de Supabase Storage en el otro dispositivo');
  check(!/Solo local/.test(await B.innerText('.pl-hero')), '8. La portada local de A no aparece en B como si estuviera sincronizada');
  check((await B.$$('.pl-photos .ph')).length === 14 && await until(B, () => document.querySelectorAll('.pl-photos .ph.has').length >= 3), '3. El carrusel (14 fotos) llega a B');
  const bOrder = await B.$$eval('.pl-list .row', r => r.map(x => x.dataset.id));
  check(bOrder.slice(0, 3).join() === order1.slice(0, 3).join(), '12. B ve el mismo orden personalizado' + ` (${bOrder.length}: ${bOrder.join(' / ').slice(0, 200)} vs ${order1.join(' / ').slice(0, 200)})`);
  // visor a pantalla completa
  await B.click('.pl-photos .ph >> nth=0');
  await B.waitForSelector('.ph-viewer[open]');
  check(await until(B, () => !!document.querySelector('.ph-viewer img')?.src), 'Visor a pantalla completa abre la foto');
  await B.keyboard.press('ArrowRight'); await B.waitForTimeout(300);
  check(/2 \/ 14/.test(await B.innerText('.ph-viewer')), 'Visor: navegación con teclado');
  await B.keyboard.press('Escape');
  // 21. Móvil: nada se sale de la pantalla
  const ovB = await B.evaluate(() => [...document.querySelectorAll('#view *')].filter(e => !e.closest('.carousel,.tabs,.ed-tabs') && e.getBoundingClientRect().right > innerWidth + 1).map(e => e.className).slice(0, 5));
  check(!ovB.length, '21. Móvil (390 px): nada se sale de la pantalla ' + ovB.join(','));
  await B.screenshot({ path: FIX + 'pl-movil.png' });
  await B.evaluate(() => { document.getElementById('view').scrollTop = 900; }); await B.waitForTimeout(300);
  await B.screenshot({ path: FIX + 'pl-movil2.png' });
  await A.goto(APP + '#/playlist/pvieja'); await A.waitForSelector('.pl-hero'); await A.waitForTimeout(800);
  await A.screenshot({ path: FIX + 'pl-escritorio.png' });
  const ovA = await A.evaluate(() => [...document.querySelectorAll('#view *')].filter(e => !e.closest('.carousel,.tabs') && e.getBoundingClientRect().right > innerWidth + 1).length);
  check(!ovA, '21. Escritorio: nada se sale de la pantalla');

  // ================================================================ 19. otra cuenta (RLS)
  const { page: C } = await device('C', true);
  check(await login(C, 'otra@example.com'), 'C inicia sesión con otra cuenta');
  const cSees = await ev(C, async () => (await import('./js/store.js')).S.playlists.filter(p => !p.deleted).map(p => [p.id, p.name, p.trackIds.length]));
  check(cSees.every(([id, , n]) => id === 'favoritos' && n === 0), '19. Otra cuenta no ve ninguna playlist de A (solo su propia «Canciones que te gustan», vacía) ' + JSON.stringify(cSees));
  const steal = await ev(C, async p => { const acc = await import('./js/account.js'); const r = await acc.authFetch(`/storage/v1/object/authenticated/fiora-playlists/${p}`); return r.status; }, coverPath);
  check(steal >= 400, `19. Otra cuenta no puede descargar la portada de A (respuesta ${steal})`);
  const put = await ev(C, async p => { const acc = await import('./js/account.js'); const r = await acc.authFetch(`/storage/v1/object/fiora-playlists/${p}`, { method: 'POST', body: new Blob(['x']), headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' } }); return r.status; }, coverPath);
  check(put >= 400, `19. Otra cuenta no puede sobrescribir archivos de A (respuesta ${put})`);
  const plays = await ev(C, async () => { const acc = await import('./js/account.js'); const r = await acc.authFetch('/rest/v1/fiora_playlist_plays?playlist_id=eq.pvieja&select=*'); return (await r.json()).length; });
  check(plays === 0, '19. Otra cuenta no ve las estadísticas de A');
  const tooBig = await ev(C, async () => { const acc = await import('./js/account.js'); const uid = acc.user().id; const r = await acc.authFetch(`/storage/v1/object/fiora-playlists/${uid}/x/covers/g.jpg`, { method: 'POST', body: new Blob([new Uint8Array(17 * 1024 * 1024)]), headers: { 'Content-Type': 'image/jpeg' } }); return [r.status, (await r.json()).message]; });
  check(tooBig[0] >= 400 && /maximum allowed size/.test(tooBig[1]), '3.3. El bucket rechaza archivos de más de 16 MB aunque se salten la app');

  // ================================================================ eliminar la playlist (y sus archivos)
  await A.goto(APP + '#/playlist/pvieja'); await A.waitForSelector('.pl-hero');
  await A.click('.pl-hero [data-act="pl-more"]');
  await A.click('#sheet .menu button:has-text("Eliminar playlist")');
  await A.click('#sheet [data-ok]');
  await synced(A); await A.waitForTimeout(1500);
  const left = (await sql(`select (select count(*)::int from fiora_playlist_tracks where playlist_id = 'pvieja') t, (select count(*)::int from fiora_playlist_photos where playlist_id = 'pvieja') f, (select count(*)::int from fiora_playlist_notes where playlist_id = 'pvieja') n, (select count(*)::int from fiora_playlist_sections where playlist_id = 'pvieja') s, (select deleted from fiora_playlists where id = 'pvieja') d`))[0];
  const leftFiles = (await (await fetch(API + '/__files')).json()).filter(f => f[0].includes('/pvieja/'));
  check(left.d === true && !left.t && !left.f && !left.n && !left.s, '16.e Eliminar la playlist borra en Supabase sus canciones, fotos, notas y capítulos');
  check(!leftFiles.length, `16.e …y todos sus archivos de Storage (quedan ${leftFiles.length})`);
  await ev(B, async () => (await import('./js/playlists-data.js')).pull());
  check(await until(B, async () => !(await import('./js/store.js')).S.playlists.some(p => p.id === 'pvieja' && !p.deleted)), '16.e …y desaparece en el otro dispositivo');

  // ================================================================ sin la migración
  await fetch(API + '/__mode?db=nomig');
  const { page: D } = await device('D', false);
  await D.goto(APP + '#/ajustes');
  await D.fill('[data-form="login"] [name=email]', 'nueva@example.com'); await D.fill('[data-form="login"] [name=password]', 'secreta123');
  await D.click('[data-form="login"] button[value="in"]');
  check(await until(D, async () => (await import('./js/playlists-data.js')).status().mode === 'missing'), 'Sin la migración aplicada, la app lo detecta');
  await D.goto(APP + '#/ajustes'); await D.waitForTimeout(400);
  check(/Falta preparar Supabase para las playlists/.test(await D.innerText('#view')), 'Ajustes explica qué falta y que no se pierde nada');
  await D.click('[data-act="new-playlist"]').catch(() => {});
  await D.goto(APP + '#/playlists'); await D.click('[data-act="new-playlist"]'); await D.fill('#sheet input', 'Local'); await D.click('#sheet button.primary');
  check(await until(D, () => /Local/.test(document.querySelector('#view').innerText)), 'Sin migración, las playlists siguen funcionando en el dispositivo');
  await fetch(API + '/__mode?db=mig');

  check(!errs.length, '22. Sin errores en consola ' + errs.join(' | '));
  console.log(`\n${ok} correctas · ${fails} fallos`);
  await b.close();
  process.exit(fails ? 1 : 0);
})();
