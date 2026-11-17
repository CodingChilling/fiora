// Reproducción de punta a punta con Playwright (Chromium): modo sin conexión, deslizar la canción
// que suena, pasar canciones de la reproducción automática a tu cola, fundidos y mezcla cruzada.
// Necesita la app en :8765, el emulador de Supabase en :8766 (base recién creada con las
// migraciones) y el de radios en :8767 (ver README.md).
const { chromium } = require('playwright');
const APP = process.env.APP || 'http://localhost:8765/';
const API = process.env.API || 'http://localhost:8766';
const RB = process.env.RB || 'http://localhost:8767';
const SB = 'https://rabhgmnjvxwlttlviywc.supabase.co';
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

/** WAV estéreo de `secs` segundos con un tono. */
function wav(secs, freq = 440, sr = 22050) {
  const n = sr * secs, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const v = Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 16000); b.writeInt16LE(v, 44 + i * 4); b.writeInt16LE(v, 46 + i * 4); }
  return b;
}
const SONGS = [['Uno', 330], ['Dos', 392], ['Tres', 440], ['Cuatro', 494], ['Cinco', 523], ['Seis', 587]]
  .map(([n, f]) => ({ name: `Prueba - ${n}.wav`, mimeType: 'audio/wav', buffer: wav(14, f) }));
const RADIO = { id: 'radio:prueba-1', uuid: 'prueba-1', radio: true, title: 'Radio de prueba', url: `${RB}/stream/prueba-1`, artist: 'España', album: 'Radio en directo', cc: 'ES' };

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const until = async (page, fn, arg, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(100); } return false; };
  async function device(name, { mobile = false, init = null, files = true } = {}) {
    const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 860 } });
    if (init) await ctx.addInitScript(init);
    await ctx.route(SB + '/**', async route => { try { await route.fulfill({ response: await route.fetch({ url: route.request().url().replace(SB, API) }) }); } catch { await route.abort('failed').catch(() => {}); } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|CORS policy|net::ERR/.test(m.text())) errs.push(`${name} consola: ${m.text()}`); });
    await page.goto(APP + '#/inicio'); await page.waitForSelector('#nav-links a');
    if (files) { await page.setInputFiles('#pick-files', SONGS); await until(page, async n => (await import('./js/store.js')).S.tracks.size >= n, SONGS.length); }
    return { page, ctx };
  }
  const st = page => page.evaluate(async () => {
    const pl = await import('./js/player.js'), e = pl.elements();
    return { title: pl.P.current?.title || '', v: pl.P.audio.volume, t: pl.P.audio.currentTime, d: pl.P.audio.duration, paused: pl.P.audio.paused, vol: pl.volume(),
      out: e.outgoing.map(x => ({ v: x.volume, t: x.currentTime })), sounding: e.all.filter(x => !x.paused && x.getAttribute('src')).length,
      user: pl.P.user.map(t => t.title), queue: pl.P.queue.map(t => t.title), index: pl.P.index, autoFrom: pl.P.autoFrom, spatial: !!e.spatial && pl.P.audio === e.spatial };
  });
  /** Reproduce una lista y espera a que la canción nueva haya cargado de verdad (otra dirección en el elemento). */
  const playTitles = (page, titles, start = 0) => page.evaluate(async ([titles, start]) => {
    const { S } = await import('./js/store.js'), pl = await import('./js/player.js');
    const all = [...S.tracks.values()], before = pl.P.audio.getAttribute('src');
    pl.playQueue(titles.map(n => all.find(x => x.title === n)), start);
    for (let i = 0; i < 100 && pl.P.audio.getAttribute('src') === before; i++) await new Promise(r => setTimeout(r, 50));
  }, [titles, start]);
  const sounding = (page, title) => until(page, async title => { const pl = await import('./js/player.js'); return pl.P.current?.title === title && !pl.P.audio.paused && pl.P.audio.currentTime > 0.1; }, title);
  const seek = (page, secs) => page.evaluate(async secs => { const pl = await import('./js/player.js'); pl.seek(secs < 0 ? pl.P.audio.duration + secs : secs); }, secs);
  const setFx = async (page, key, value) => {
    if (typeof value === 'boolean') await page.setChecked(`[data-fx="${key}"]`, value);
    else if (key === 'mode') await page.selectOption('[data-fx="mode"]', value);
    else await page.$eval(`[data-fx="${key}"]`, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, String(value));
    await page.waitForTimeout(300);
  };
  const fxOf = page => page.evaluate(async () => (await import('./js/fades.js')).settings());
  /** Desliza con el dedo sobre un elemento (eventos de puntero táctiles, como en el móvil). */
  const swipe = (page, sel, dx, dy = 0, click = true) => page.evaluate(async ([sel, dx, dy, click]) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const ev = (type, cx, cy) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: cy }));
    ev('pointerdown', x, y);
    for (let i = 1; i <= 8; i++) { ev('pointermove', x + (dx * i) / 8, y + (dy * i) / 8); await new Promise(r => setTimeout(r, 16)); }
    ev('pointerup', x + dx, y + dy);
    if (click) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x + dx, clientY: y + dy }));   // el clic que puede seguir al gesto
    await new Promise(r => setTimeout(r, 400));   // tras un gesto, la app ignora un instante los toques (el clic que lo acompaña)
  }, [sel, dx, dy, click]);

  // ======================================================== 1. Deslizar la canción que suena (móvil)
  const { page: M } = await device('M', { mobile: true });
  await playTitles(M, ['Uno', 'Dos', 'Tres']); await sounding(M, 'Uno');
  await swipe(M, '#mini .open', -120);
  await sounding(M, 'Dos');
  let s = await st(M);
  check(s.title === 'Dos' && await M.isHidden('#now'), '1. Deslizar el mini reproductor a la izquierda pasa a la siguiente (sin abrir la pantalla completa)');
  await swipe(M, '#mini .open', 120); await sounding(M, 'Uno');
  check((await st(M)).title === 'Uno', '   y a la derecha vuelve a la anterior');
  await swipe(M, '#mini .open', -35); await M.waitForTimeout(500);
  check((await st(M)).title === 'Uno' && await M.isHidden('#now'), '   Un gesto corto no cambia de canción ni abre el reproductor');
  await swipe(M, '#mini .open', -20, -90, false); await M.waitForTimeout(500);   // (al desplazar en vertical el navegador no envía clic)
  check((await st(M)).title === 'Uno', '   Un gesto vertical tampoco');
  check(!(await M.$eval('#mini .open', el => el.classList.contains('now-swiping') || el.style.getPropertyValue('--sx'))), '   y la tarjeta vuelve a su sitio');
  await M.click('#mini [data-act="open-now"]'); await M.waitForSelector('#now .stage[data-swipe-now]');
  await swipe(M, '#now .stage', -140); await sounding(M, 'Dos');
  check((await st(M)).title === 'Dos' && await M.isVisible('#now'), '2. En la pantalla «Reproduciendo», deslizar la carátula a la izquierda pasa a la siguiente');
  await M.click('#now [data-act="close-now"]'); await M.waitForTimeout(300);
  await M.evaluate(async r => (await import('./js/player.js')).playQueue([r]), RADIO);
  await until(M, async () => (await import('./js/player.js')).P.current?.radio);
  await M.waitForTimeout(400);
  await swipe(M, '#mini .open', -120, 0, false); await M.waitForTimeout(500);
  check((await st(M)).title === 'Radio de prueba', '   Con una radio en directo el gesto no hace nada');

  // ======================================================== 2. Reproducción automática → tu cola
  await playTitles(M, ['Uno']); await sounding(M, 'Uno');
  await seek(M, -0.6);
  await until(M, async () => { const pl = await import('./js/player.js'); return pl.P.autoFrom >= 0 && pl.P.current?.title !== 'Uno' && !pl.P.audio.paused; });
  s = await st(M);
  const autoLeft = s.queue.length - s.index - 1;
  check(s.autoFrom === 1 && autoLeft >= 3, `3. Al acabarse la lista sigue la reproducción automática (${autoLeft} por sonar)`);
  await M.click('#mini [data-act="open-now"]'); await M.click('#now [data-mode="queue"]');
  await M.waitForSelector('#now .pane [data-list="q"] .row');
  const paneTxt = await M.innerText('#now .pane');
  const plusBtns = await M.$$eval('#now .pane [data-list="q"] .row', rows => rows.map(r => !!r.querySelector('[data-act="q-promote"]')));
  check(/Reproducción automática/.test(paneTxt) && plusBtns.length === autoLeft && plusBtns.every(Boolean) && (await M.$$('#now [data-act="q-promote-all"]')).length === 1,
    '   La cola muestra la reproducción automática con un botón + en cada canción y «Añadir todas a tu cola»');
  const firstAuto = s.queue[s.index + 1];
  await M.click('#now .pane [data-list="q"] .row [data-act="q-promote"]');
  await M.waitForTimeout(300);
  s = await st(M);
  check(s.user.join() === firstAuto && !s.queue.slice(s.index + 1).includes(firstAuto) && /añadida a tu cola/.test(await M.innerText('#toasts')),
    `4. Con + «${firstAuto}» pasa a tu cola y sale de la reproducción automática (no sonará dos veces)`);
  check(/A continuación en tu cola/.test(await M.innerText('#now .pane')), '   y aparece en «A continuación en tu cola»');
  // menú ⋯ → Reproducir a continuación
  const lastAuto = s.queue[s.queue.length - 1];
  await M.click('#now .pane [data-list="q"] .row:last-child [data-act="more"]'); await M.waitForSelector('#sheet .menu');
  const menuTxt = await M.innerText('#sheet');
  await M.click('#sheet button:has-text("Reproducir a continuación")'); await M.waitForTimeout(300);
  s = await st(M);
  check(/Añadir a tu cola/.test(menuTxt) && s.user[0] === lastAuto && s.user[1] === firstAuto, `5. Menú ⋯ → «Reproducir a continuación» pone «${lastAuto}» la primera de tu cola`);
  // deslizar a la derecha una de la automática
  const before = s.queue.slice(s.index + 1);
  if (before.length) {
    const row = await M.$('#now .pane [data-list="q"] .row');
    await swipe(M, row, 120); await M.waitForTimeout(300);
    s = await st(M);
    check(s.user[s.user.length - 1] === before[0] && !s.queue.slice(s.index + 1).includes(before[0]), `6. Deslizar a la derecha «${before[0]}» en la cola la pasa a tu cola`);
  } else check(false, '6. Quedaban canciones automáticas para deslizar');
  // las de tu cola no se deslizan ni tienen +
  const uRow = await M.$('#now .pane [data-list="u"] .row');
  const userBefore = (await st(M)).user.join('|');
  await swipe(M, uRow, 120); await M.waitForTimeout(300);
  check((await st(M)).user.join('|') === userBefore && (await M.$$('#now .pane [data-list="u"] [data-act="q-promote"]')).length === 0, '   Las canciones que ya están en tu cola no se duplican al deslizarlas');
  // añadir todas
  const rest = (await st(M)).queue.slice((await st(M)).index + 1);
  if (rest.length) {
    await M.click('#now [data-act="q-promote-all"]'); await M.waitForTimeout(300);
    s = await st(M);
    check(s.queue.length === s.index + 1 && rest.every(t => s.user.includes(t)), `7. «Añadir todas a tu cola» pasa las ${rest.length} que quedaban`);
  } else check(true, '7. (no quedaban canciones automáticas)');
  // suenan en el orden de tu cola, sin repetir
  const order = (await st(M)).user.slice();
  const heard = [];
  for (let i = 0; i < Math.min(3, order.length); i++) {
    await M.evaluate(async () => (await import('./js/player.js')).next());
    await until(M, async t => (await import('./js/player.js')).P.current?.title === t, order[i]);
    heard.push((await st(M)).title);
  }
  check(heard.join() === order.slice(0, heard.length).join(), `8. Tu cola suena en su orden (${heard.join(', ')})`);
  await M.click('#now [data-act="close-now"]').catch(() => {});

  // ======================================================== 3. Fundidos y transiciones (escritorio)
  const { page: A } = await device('A');
  await playTitles(A, ['Uno']); await sounding(A, 'Uno');
  await A.waitForTimeout(600);
  s = await st(A);
  check(s.v === 1 && s.vol === 1 && s.sounding === 1 && !s.out.length, '9. Por defecto, sin fundidos: el volumen es el elegido desde el primer momento');
  await A.goto(APP + '#/ajustes'); await A.waitForSelector('#ajustes-audio [data-fx="mode"]');
  const ui = await A.evaluate(() => { const p = document.querySelector('#ajustes-audio'); const q = s => p.querySelector(s); return { mode: q('[data-fx="mode"]').value, cross: q('[data-fx="cross"]').disabled, fin: q('[data-fx="fadeIn"]').value, fout: q('[data-fx="fadeOut"]').value, pause: q('[data-fx="pause"]').checked, manual: q('[data-fx="manual"]').checked, reset: !!q('[data-act="fx-reset"]'), txt: p.innerText }; });
  check(ui.mode === 'normal' && ui.cross && ui.fin === '0' && ui.fout === '0' && !ui.pause && !ui.manual && ui.reset && /Transiciones y fundidos/.test(ui.txt),
    '10. Ajustes → Audio y reproducción → «Transiciones y fundidos»: todo apagado de inicio, con «Restaurar transiciones»');

  // fundido de entrada
  await setFx(A, 'fadeIn', 4);
  await playTitles(A, ['Dos']);
  await until(A, async () => { const pl = await import('./js/player.js'); return pl.P.current?.title === 'Dos' && pl.P.audio.currentTime > 0.3; });
  const early = await st(A);
  await until(A, async () => (await import('./js/player.js')).P.audio.currentTime > 4.3);
  const later = await st(A);
  check(early.v < 0.4 && later.v > 0.98, `11. Fundido de entrada de 4 s: ${early.v.toFixed(2)} a los ${early.t.toFixed(1)} s y ${later.v.toFixed(2)} a los ${later.t.toFixed(1)} s`);
  await seek(A, 0.4); await A.waitForTimeout(250);
  check((await st(A)).v < 0.5, '    Al volver al principio, vuelve a fundirse (depende de la posición, no de un temporizador)');
  // fundido de salida (sin el de entrada: en una canción de 14 s, 4 + 4 s superarían el 40 % y se acortarían)
  await setFx(A, 'fadeIn', 0); await setFx(A, 'fadeOut', 4);
  await seek(A, 6); await A.waitForTimeout(300);
  const mid = await st(A);
  await seek(A, -2.2); await A.waitForTimeout(150);
  const end1 = await st(A); await A.waitForTimeout(900); const end2 = await st(A);
  const short = await A.evaluate(async () => { const f = await import('./js/fades.js'); return f.shape({ ...f.DEFAULTS, fadeIn: 4, fadeOut: 4 }, 14); });
  check(mid.v > 0.98 && end1.v < 0.85 && end2.v < end1.v, `12. Fundido de salida de 4 s: ${mid.v.toFixed(2)} en mitad, ${end1.v.toFixed(2)} → ${end2.v.toFixed(2)} al final`);
  check(Math.abs(short.fin + short.fout - 5.6) < 0.01, `    En una canción de 14 s, 4 s + 4 s se acortan a ${short.fin.toFixed(1)} + ${short.fout.toFixed(1)} s (40 % de la canción)`);
  await setFx(A, 'fadeIn', 4);
  // el volumen elegido se respeta
  await A.evaluate(async () => (await import('./js/player.js')).setVolume(0.5));
  await seek(A, 6); await A.waitForTimeout(300);
  s = await st(A);
  check(Math.abs(s.v - 0.5) < 0.01 && s.vol === 0.5, '13. Los fundidos multiplican el volumen elegido sin cambiarlo (50 % en mitad de la canción)');
  await A.evaluate(async () => (await import('./js/player.js')).setVolume(1));

  // pausa suave
  await setFx(A, 'pause', true);
  await A.evaluate(async () => (await import('./js/player.js')).toggle());
  await A.waitForTimeout(120);
  const p1 = await st(A);
  await A.waitForTimeout(600);
  const p2 = await st(A);
  check(!p1.paused && p1.v < 0.95 && p2.paused, `14. Pausa suave: baja el volumen (${p1.v.toFixed(2)}) y luego se pausa`);
  await A.evaluate(async () => (await import('./js/player.js')).toggle());
  await A.waitForTimeout(100);
  const r1 = await st(A); await A.waitForTimeout(500); const r2 = await st(A);
  check(!r1.paused && r1.v < 0.9 && r2.v > 0.98, `    Al reanudar sube desde ${r1.v.toFixed(2)} hasta ${r2.v.toFixed(2)}`);
  // pausar y reanudar enseguida no deja la canción a medias
  await A.evaluate(async () => { const pl = await import('./js/player.js'); pl.toggle(); await new Promise(r => setTimeout(r, 80)); pl.toggle(); });
  await A.waitForTimeout(700);
  s = await st(A);
  check(!s.paused && s.v > 0.98, '    Pausar y reanudar en seguida: sigue sonando a su volumen');

  // mezcla cruzada
  await setFx(A, 'fadeIn', 0); await setFx(A, 'fadeOut', 0);
  await setFx(A, 'mode', 'cross'); await A.waitForSelector('[data-fx="cross"]:not([disabled])');
  await setFx(A, 'cross', 4);
  check((await fxOf(A)).mode === 'cross' && (await fxOf(A)).cross === 4, '15. Mezcla cruzada de 4 s activada desde Ajustes');
  const statsBefore = await A.evaluate(async () => { const { S } = await import('./js/store.js'); const t = [...S.tracks.values()].find(x => x.title === 'Tres'); return S.stats[t.id]?.done || 0; });
  await playTitles(A, ['Tres', 'Cuatro']); await sounding(A, 'Tres');
  await seek(A, -6);
  const crossed = await until(A, async () => { const pl = await import('./js/player.js'); return pl.P.current?.title === 'Cuatro' && pl.elements().outgoing.length === 1; }, null, 8000);
  const c1 = await st(A);
  await A.waitForTimeout(1500);
  const c2 = await st(A);
  check(crossed && c1.sounding === 2 && c1.out[0].t > 9, `16. A falta de 4 s empieza «Cuatro» mientras «Tres» sigue sonando (desde el segundo ${c1.out[0]?.t.toFixed(1)})`);
  check(c2.out.length === 1 && c2.out[0].v < c1.out[0].v && c2.v > c1.v, `    «Tres» baja (${c1.out[0]?.v.toFixed(2)} → ${c2.out[0]?.v.toFixed(2)}) y «Cuatro» sube (${c1.v.toFixed(2)} → ${c2.v.toFixed(2)})`);
  const pow = c2.v ** 2 + c2.out[0].v ** 2;
  check(pow > 0.8 && pow < 1.2, `    Potencia constante durante la mezcla (suma de cuadrados ${pow.toFixed(2)})`);
  await until(A, async () => (await import('./js/player.js')).elements().outgoing.length === 0, null, 6000);
  s = await st(A);
  const statsAfter = await A.evaluate(async () => { const { S } = await import('./js/store.js'); const t = [...S.tracks.values()].find(x => x.title === 'Tres'); return S.stats[t.id]?.done || 0; });
  check(s.sounding === 1 && s.title === 'Cuatro' && s.v > 0.98, '    Al acabar la mezcla queda una sola canción sonando, a su volumen');
  check(statsAfter === statsBefore + 1, '    «Tres» cuenta como escuchada hasta el final en las estadísticas');
  // sin nada detrás, la canción termina sola (sin mezcla ni corte)
  await A.evaluate(() => { document.querySelector('[data-toggle="autoplay"]').click(); });
  await A.waitForTimeout(300);
  await playTitles(A, ['Cinco']); await sounding(A, 'Cinco');
  await seek(A, -5);
  await A.waitForTimeout(2500);
  s = await st(A);
  check(!s.out.length && s.title === 'Cinco' && !s.paused, '17. Sin nada detrás (reproducción automática apagada) no hay mezcla: la canción sigue hasta el final');
  await A.evaluate(() => { document.querySelector('[data-toggle="autoplay"]').click(); });
  // repetir una: tampoco
  await A.evaluate(async () => { const pl = await import('./js/player.js'); pl.cycleRepeat(); pl.cycleRepeat(); });
  await playTitles(A, ['Cinco', 'Seis']); await sounding(A, 'Cinco');
  await seek(A, -5); await A.waitForTimeout(2500);
  s = await st(A);
  check(!s.out.length && s.title === 'Cinco', '    Con «repetir una» tampoco se mezcla con la siguiente');
  await A.evaluate(async () => { (await import('./js/player.js')).cycleRepeat(); });

  // saltos manuales
  await playTitles(A, ['Uno', 'Dos', 'Tres']); await sounding(A, 'Uno');
  await A.waitForTimeout(500);
  await A.evaluate(async () => (await import('./js/player.js')).next());
  await sounding(A, 'Dos');
  check(!(await st(A)).out.length, '18. Sin «Mezclar al saltar», pulsar siguiente corta como siempre');
  await setFx(A, 'manual', true);
  await A.evaluate(async () => (await import('./js/player.js')).next());
  await sounding(A, 'Tres');
  const m1 = await st(A);
  await until(A, async () => (await import('./js/player.js')).elements().outgoing.length === 0, null, 5000);
  check(m1.out.length === 1 && m1.title === 'Tres', '    Con «Mezclar al saltar», la anterior se desvanece mientras empieza la siguiente (y luego se para)');
  // radio: nunca se mezcla
  await A.evaluate(async r => (await import('./js/player.js')).playQueue([r]), RADIO);
  await until(A, async () => { const pl = await import('./js/player.js'); return pl.P.current?.radio && !pl.P.audio.paused; });
  s = await st(A);
  check(!s.out.length && s.sounding === 1 && s.v === s.vol, '19. Al pasar a una radio no hay mezcla y suena a su volumen');

  // mezcla cruzada con el audio espacial activado
  await A.evaluate(async () => { const { S, saveKV } = await import('./js/store.js'); S.settings.spatial = { on: true, mode: 'suave', intensity: 60, speed: 40 }; S.settings.spatialAt = Date.now(); await saveKV('settings', false); });
  await playTitles(A, ['Uno', 'Dos']); await sounding(A, 'Uno');
  await until(A, async () => { const pl = await import('./js/player.js'); return pl.P.audio === pl.elements().spatial; });
  await A.evaluate(async () => (await import('./js/spatial.js')).levels());   // el medidor empieza a escuchar
  await seek(A, -6);
  const sx = await until(A, async () => { const pl = await import('./js/player.js'), sp = await import('./js/spatial.js'); const o = pl.elements().outgoing[0]; return pl.P.current?.title === 'Dos' && o && sp.owns(o) && sp.owns(pl.P.audio) && o !== pl.P.audio; }, null, 8000);
  const lv = await A.evaluate(async () => (await import('./js/spatial.js')).levels());
  check(sx && lv.l + lv.r > 0.01, '20. Con el 8D activado la mezcla usa los dos elementos espaciales y las dos canciones pasan por el efecto');
  await until(A, async () => (await import('./js/player.js')).elements().outgoing.length === 0, null, 6000);
  s = await st(A);
  check(s.spatial && s.sounding === 1, '    Al terminar, una sola canción, por la ruta espacial');
  await A.evaluate(async () => { const { S, saveKV } = await import('./js/store.js'); S.settings.spatial = { ...S.settings.spatial, on: false }; await saveKV('settings', false); });

  // se conservan al recargar y viajan con la cuenta
  await A.goto(APP + '#/ajustes'); await A.reload(); await A.waitForSelector('[data-fx="mode"]');
  const kept = await A.evaluate(() => ({ mode: document.querySelector('[data-fx="mode"]').value, cross: document.querySelector('[data-fx="cross"]').value, manual: document.querySelector('[data-fx="manual"]').checked, pause: document.querySelector('[data-fx="pause"]').checked }));
  check(kept.mode === 'cross' && kept.cross === '4' && kept.manual && kept.pause, '21. Los ajustes se conservan al recargar');
  await A.fill('[data-form="login"] [name=email]', 'fundidos@example.com'); await A.fill('[data-form="login"] [name=password]', 'secreta123'); await A.click('[data-form="login"] button[value="in"]');
  await until(A, async () => !!(await import('./js/account.js')).user());
  await A.evaluate(async () => { await (await import('./js/account.js')).sync(); });
  const { page: B } = await device('B', { files: false });
  await B.goto(APP + '#/ajustes'); await B.fill('[data-form="login"] [name=email]', 'fundidos@example.com'); await B.fill('[data-form="login"] [name=password]', 'secreta123'); await B.click('[data-form="login"] button[value="in"]');
  const got = await until(B, async () => (await import('./js/store.js')).S.settings.fx?.mode === 'cross', null, 15000);
  const fb = await fxOf(B);
  check(got && fb.cross === 4 && fb.manual && fb.pause, '    Con sesión, otro dispositivo recibe las transiciones');
  await A.click('[data-act="fx-reset"]'); await A.waitForTimeout(400);
  const fr = await fxOf(A);
  check(fr.mode === 'normal' && fr.fadeIn === 0 && fr.fadeOut === 0 && !fr.pause && !fr.manual, '22. «Restaurar transiciones» vuelve a todo apagado');

  // navegador que no deja cambiar el volumen (iPhone, iPad)
  const { page: I } = await device('I', { init: () => { Object.defineProperty(HTMLMediaElement.prototype, 'volume', { get() { return 1; }, set() {}, configurable: true }); localStorage.setItem('x', '1'); } });
  await I.evaluate(async () => { const { S, saveKV } = await import('./js/store.js'); S.settings.fx = { mode: 'cross', cross: 6, fadeIn: 3, fadeOut: 3, pause: true, manual: true }; await saveKV('settings', false); });
  await I.goto(APP + '#/ajustes'); await I.waitForSelector('[data-fx="mode"]');
  const iu = await I.evaluate(() => ({ dis: document.querySelector('[data-fx="mode"]').disabled && document.querySelector('[data-fx="fadeIn"]').disabled, txt: document.querySelector('#ajustes-audio').innerText }));
  await playTitles(I, ['Uno', 'Dos']); await sounding(I, 'Uno');
  await seek(I, -7); await I.waitForTimeout(2500);
  s = await st(I);
  await I.evaluate(async () => (await import('./js/player.js')).toggle()); await I.waitForTimeout(100);
  const ip = await st(I);
  check(iu.dis && /no deja que la página cambie el volumen/.test(iu.txt) && !s.out.length && s.title === 'Uno' && ip.paused,
    '23. Si el navegador no deja cambiar el volumen: se avisa en Ajustes, no hay mezcla (ni dos canciones a la vez) y pausar es inmediato');

  // ======================================================== 4. Sin conexión
  const { page: O, ctx: OC } = await device('O');
  await until(O, () => !!navigator.serviceWorker.controller, null, 15000);
  await O.evaluate(async () => {   // una canción de la biblioteca que solo está en internet
    const { S, saveTrack } = await import('./js/store.js');
    const t = { id: 'remota-1', title: 'Solo en internet', artist: 'Prueba', artists: ['Prueba'], url: 'http://localhost:8767/song/libre-1.mp3', duration: 30, addedAt: Date.now() };
    S.tracks.set(t.id, t); await saveTrack(t);
  });
  // la escena 3D y el mapa se guardan al instalar, aunque no se hayan abierto
  const cachedLazy = await O.evaluate(async () => { const c = await caches.open((await caches.keys()).find(k => k.startsWith('fiora-'))); return Promise.all(['js/creature3d.js', 'vendor/three.module.min.js', 'js/atlas.js', 'data/world.json'].map(async f => !!(await c.match(f)))); });
  check(cachedLazy.every(Boolean), '24. La app queda guardada entera al instalarse, también la escena 3D y el mapa');
  await OC.setOffline(true);
  await O.reload(); await O.waitForSelector('#nav-links a', { timeout: 10000 });
  check(await O.isVisible('#netbar') && await O.evaluate(() => document.body.classList.contains('offline')) && /Sin conexión/.test(await O.innerText('#netbar')),
    '25. Sin conexión la app se abre y muestra «Sin conexión · solo lo descargado»');
  await O.goto(APP + '#/biblioteca'); await O.waitForSelector('.row');
  const avail = await O.$$eval('.row', rows => rows.map(r => [r.querySelector('b').textContent, r.classList.contains('unavailable')]));
  check(avail.find(x => x[0] === 'Solo en internet')?.[1] === true && avail.filter(x => x[0] !== 'Solo en internet').every(x => !x[1]), '26. En la biblioteca, lo que no está descargado aparece como no disponible');
  await O.click('.row.unavailable [data-act="play"]'); await O.waitForTimeout(300);
  check(/Sin conexión: esta canción no está descargada/.test(await O.innerText('#toasts')), '    y al tocarla lo explica');
  await O.evaluate(async () => { const { S } = await import('./js/store.js'), pl = await import('./js/player.js'); const all = [...S.tracks.values()]; pl.playQueue(['Uno', 'Solo en internet', 'Dos'].map(n => all.find(x => x.title === n))); });
  await sounding(O, 'Uno');
  await O.evaluate(async () => (await import('./js/player.js')).next());
  await sounding(O, 'Dos');
  check((await st(O)).title === 'Dos', '27. Al pasar de canción se salta la que no está descargada');
  await O.goto(APP + '#/explorar'); await O.waitForTimeout(800);
  check(/la música libre y las radios necesitan internet/.test(await O.innerText('#view')), '28. Explorar avisa de que necesita internet');
  await O.goto(APP + '#/criatura'); await O.waitForTimeout(2500);
  check(!errs.some(e => /^O.*dynamically imported module/.test(e)) && await O.$('canvas') !== null, '    La criatura sonora (escena 3D) se abre sin conexión');
  await O.click('#mini [data-act="open-now"]'); await O.click('#now [data-mode="lyrics"]').catch(() => {}); await O.waitForTimeout(600);
  check(/Sin conexión/.test(await O.innerText('#now')), '    Las letras explican que no hay conexión');
  await O.click('#now [data-act="close-now"]').catch(() => {});
  await OC.setOffline(false); await O.waitForTimeout(600);
  await O.goto(APP + '#/biblioteca'); await O.waitForSelector('.row'); await O.waitForTimeout(400);
  check(await O.isHidden('#netbar') && !(await O.$$eval('.row.unavailable', r => r.length)), '29. Al volver la conexión desaparece el aviso y todo vuelve a estar disponible');
  // conexión que no carga nada: la app se abre igualmente desde la copia guardada
  await fetch(APP + '__slow?ms=20000');
  const t0 = Date.now();
  await O.reload({ timeout: 15000 }).catch(() => {}); await O.waitForSelector('#nav-links a', { timeout: 15000 }).catch(() => {});
  const took = Date.now() - t0;
  await fetch(APP + '__slow?ms=0');
  check(await O.$('#nav-links a') !== null && took < 9000, `30. Con una red que no responde, la app se abre desde la copia guardada (${(took / 1000).toFixed(1)} s)`);

  check(!errs.length, 'Sin errores de JavaScript' + (errs.length ? `: ${errs.slice(0, 4).join(' | ')}` : ''));
  await b.close();
  console.log(`\n${ok} comprobaciones correctas, ${fails} fallos`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
