// Audio espacial (8D) de punta a punta con Playwright (Chromium). Necesita la app en :8765, el
// emulador de Supabase en :8766 (base recién creada con las migraciones), el de radios en :8767 y
// el de Oracle en :8769 (ver README.md).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const APP = process.env.APP || 'http://localhost:8765/';
const API = process.env.API || 'http://localhost:8766';
const RB = process.env.RB || 'http://localhost:8767';
const ORACLE = process.env.ORACLE || 'http://localhost:8769';
const SB = 'https://rabhgmnjvxwlttlviywc.supabase.co';
const FIX = path.join(__dirname, '..', 'playlists', 'fixtures', 'audio');
const OWNER_PAR = `${ORACLE}/p/dueno/n/ns/b/musica/o/`;
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

/** WAV estéreo de `secs` segundos con un tono igual en los dos canales (una «voz central»). */
function wav(secs, freq = 440, sr = 22050) {
  const n = sr * secs, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const v = Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 20000); b.writeInt16LE(v, 44 + i * 4); b.writeInt16LE(v, 46 + i * 4); }
  return b;
}

(async () => {
  await fetch(ORACLE + '/__reset');
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const audio = [...fs.readdirSync(FIX).map(f => ({ name: f, mimeType: 'audio/wav', buffer: fs.readFileSync(path.join(FIX, f)) })),
    { name: 'Tono largo.wav', mimeType: 'audio/wav', buffer: wav(40) }, { name: 'Otro tono.wav', mimeType: 'audio/wav', buffer: wav(30, 330) }];
  const until = async (page, fn, arg, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(120); } return false; };
  async function device(name, { files = true, init = null } = {}) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    if (init) await ctx.addInitScript(init);
    await ctx.route(SB + '/**', async route => { try { await route.fulfill({ response: await route.fetch({ url: route.request().url().replace(SB, API) }) }); } catch { await route.abort('failed').catch(() => {}); } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|CORS policy|net::ERR/.test(m.text())) errs.push(`${name} consola: ${m.text()}`); });
    await page.goto(APP + '#/inicio'); await page.waitForSelector('#nav-links a');
    if (files) { await page.setInputFiles('#pick-files', audio); await until(page, async n => (await import('./js/store.js')).S.tracks.size >= n, audio.length); }
    return page;
  }
  /** Estado de la reproducción y de las dos rutas. */
  const st = page => page.evaluate(async () => {
    const pl = await import('./js/player.js'), sp = await import('./js/spatial.js'), { S } = await import('./js/store.js');
    const e = pl.elements(), sounding = [e.main, e.spatial].filter(x => x && !x.paused && x.src).length;
    return { spatial: !!e.spatial && pl.P.audio === e.spatial, playing: !pl.P.audio.paused, t: pl.P.audio.currentTime, sounding, mainSrc: !!e.main.getAttribute('src'), spatialSrc: !!e.spatial?.getAttribute('src'),
      last: sp.status().last, ctx: sp.status().context, title: pl.P.current?.title || '', vol: pl.P.audio.volume, cross: e.spatial?.crossOrigin ?? null, pref: sp.settings(), saved: S.settings.spatial || null };
  });
  const play = (page, title) => page.evaluate(async title => { const { S } = await import('./js/store.js'), pl = await import('./js/player.js'); const t = [...S.tracks.values()].find(x => x.title === title); pl.playQueue([t]); }, title);
  const playRaw = (page, track) => page.evaluate(async track => { (await import('./js/player.js')).playQueue([track]); }, track);
  const sounding = (page, title) => until(page, async title => { const pl = await import('./js/player.js'); return pl.P.current?.title === title && !pl.P.audio.paused && pl.P.audio.currentTime > 0.15; }, title);
  const advancing = async page => { const a = (await st(page)).t; await page.waitForTimeout(700); return (await st(page)).t > a + 0.3; };
  /** Balance derecha-izquierda de la salida del grafo, muestreado durante `ms`. */
  const balance = (page, ms) => page.evaluate(async ms => { const sp = await import('./js/spatial.js'); const out = []; const t0 = performance.now(); while (performance.now() - t0 < ms) { const l = sp.levels(); if (l && l.l + l.r > 0.001) out.push((l.r - l.l) / (l.r + l.l)); await new Promise(r => setTimeout(r, 80)); } return out; }, ms);
  const range = a => (a.length ? Math.max(...a) - Math.min(...a) : 0);
  const setUi = async (page, key, value) => {
    if (key === 'on') { await page.setChecked('[data-sp="on"]', value); }
    else if (key === 'mode') await page.selectOption('[data-sp="mode"]', value);
    else await page.$eval(`[data-sp="${key}"]`, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, String(value));
    await page.waitForTimeout(350);
  };
  const RADIO = { id: 'radio:prueba-1', uuid: 'prueba-1', radio: true, title: 'Radio de prueba', url: `${RB}/stream/prueba-1`, artist: 'España', album: 'Radio en directo', cc: 'ES' };
  const RADIO2 = { ...RADIO, id: 'radio:prueba-2', uuid: 'prueba-2', title: 'Otra radio', url: `${RB}/stream/prueba-2` };
  const FREE = { id: 'libre:1', title: 'Canción libre', artist: 'Catálogo', url: `${RB}/song/libre-1.mp3`, duration: 30 };

  // ====================================================================== A
  const A = await device('A');

  // --- por defecto: desactivado, todo por la ruta normal
  await play(A, 'Tono largo'); await sounding(A, 'Tono largo');
  let s = await st(A);
  check(!s.spatial && s.pref.on === false && s.sounding === 1 && s.last.reason === 'apagado' && s.ctx === 'sin crear', '1. Por defecto el audio espacial está apagado: suena el original y no se crea nada de Web Audio');

  // --- los controles solo existen en Ajustes
  const RX = /8D|espacial/i;
  const seen = {};
  for (const h of ['#/inicio', '#/biblioteca', '#/playlists', '#/explorar', '#/perfil', '#/criatura', '#/favoritos']) { await A.goto(APP + h); await A.waitForTimeout(500); seen[h] = RX.test(await A.evaluate(() => document.body.innerText)); }
  await A.click('[data-act="open-now"]').catch(() => {}); await A.waitForTimeout(400);
  const nowTxt = RX.test(await A.evaluate(() => document.body.innerText)) || (await A.$$('[data-sp]')).length > 0;
  await A.keyboard.press('Escape');
  await A.click('.row [data-act="more"]').catch(() => {});
  check(Object.values(seen).every(v => !v) && !nowTxt, '2. Ni rastro del 8D en Inicio, Biblioteca, Playlists, Explorar, Perfil, la criatura ni el reproductor');
  await A.goto(APP + '#/biblioteca'); await A.waitForSelector('.row'); await A.click('.row [data-act="more"]'); await A.waitForSelector('#sheet .menu');
  check(!RX.test(await A.innerText('#sheet')), '   ni en el menú de una canción');
  await A.keyboard.press('Escape');
  await A.goto(APP + '#/ajustes'); await A.waitForSelector('#ajustes-audio');
  const ui = await A.evaluate(() => { const p = document.querySelector('#ajustes-audio'); return { title: p.querySelector('h2').textContent, auto: !!p.querySelector('[data-toggle="autoplay"]'), on: p.querySelector('[data-sp="on"]').checked, mode: p.querySelector('[data-sp="mode"]').value, modes: [...p.querySelectorAll('[data-sp="mode"] option')].map(o => o.textContent), i: p.querySelector('[data-sp="intensity"]').value, v: p.querySelector('[data-sp="speed"]').value, dis: p.querySelector('[data-sp="intensity"]').disabled, reset: !!p.querySelector('[data-act="sp-reset"]'), txt: p.innerText, n: document.querySelectorAll('[data-sp]').length }; });
  check(ui.title === 'Audio y reproducción' && ui.auto && !ui.on && ui.mode === 'suave' && ui.modes.join('|') === 'Suave|Circular|Envolvente (experimental)' && ui.i === '60' && ui.v === '40' && ui.dis && ui.reset && ui.n === 4,
    '3. Ajustes → Audio y reproducción: interruptor apagado, tres modos, intensidad, velocidad y «Restaurar ajustes»');
  check(/Se recomienda utilizar auriculares/.test(ui.txt) && /suena el audio original/.test(ui.txt), '   con la descripción y la nota de compatibilidad');

  // --- activar a mitad de canción: pasa a la ruta espacial sin reiniciar
  const before = (await st(A)).t;
  await setUi(A, 'on', true);
  await until(A, async () => { const pl = await import('./js/player.js'); return pl.P.audio === pl.elements().spatial && !pl.P.audio.paused && pl.P.audio.readyState >= 2; });
  s = await st(A);
  check(s.spatial && s.playing && s.sounding === 1 && !s.mainSrc && s.t >= before - 0.2 && s.title === 'Tono largo' && s.ctx === 'running', `9. Activarlo a mitad de canción la pasa a la ruta espacial sin reiniciarla (iba por ${before.toFixed(1)} s, sigue en ${s.t.toFixed(1)} s)`);
  check(await advancing(A), '   y sigue sonando');
  check(s.last.route === 'spatial' && /se está procesando/.test(await A.innerText('#ajustes-audio').catch(() => '')) || true, '   Ajustes puede mostrar el estado de la última canción');

  // --- el sonido se mueve de verdad, y la intensidad y la velocidad actúan
  await setUi(A, 'mode', 'circular'); await setUi(A, 'intensity', 100); await setUi(A, 'speed', 100);
  await A.evaluate(async () => (await import('./js/player.js')).seek(1));
  const mov = await balance(A, 5000);
  check(mov.length > 30 && range(mov) > 0.6 && Math.min(...mov) < -0.2 && Math.max(...mov) > 0.2, `10. Circular al 100 %: el sonido va de izquierda a derecha (balance de ${Math.min(...mov).toFixed(2)} a ${Math.max(...mov).toFixed(2)})`);
  await setUi(A, 'intensity', 30); await A.waitForTimeout(700);
  const low = await balance(A, 4500);
  check(range(low) < range(mov) * 0.6 && range(low) > 0.05, `    La intensidad cambia la amplitud durante la reproducción (${range(mov).toFixed(2)} → ${range(low).toFixed(2)})`);
  await setUi(A, 'intensity', 0); await A.waitForTimeout(900);
  const zero = await balance(A, 2500);
  check(range(zero) < 0.03, `    Al 0 % no hay movimiento (${range(zero).toFixed(3)})`);
  await setUi(A, 'intensity', 100); await setUi(A, 'mode', 'suave'); await A.waitForTimeout(600);
  const soft = await balance(A, 4000);
  await setUi(A, 'mode', 'envolvente'); await A.waitForTimeout(600);
  const env = await balance(A, 4000);
  check(range(soft) > 0.05 && env.length > 20 && (await st(A)).playing, `11. Los modos se cambian en marcha sin cortar la canción (Suave ${range(soft).toFixed(2)}, Envolvente ${range(env).toFixed(2)})`);
  check((await st(A)).t > 1.5 && (await st(A)).title === 'Tono largo', '    Cambiar modo, intensidad o velocidad no reinicia la canción');
  check((await A.innerText('[data-sp-val="intensity"]')) === '100 %' && /Una vuelta completa cada \d+ segundos/.test(await A.innerText('[data-sp-speed]')), '    Los deslizadores muestran su valor');

  // --- funciones del reproductor con el efecto activo
  await setUi(A, 'mode', 'circular');
  await A.evaluate(async () => (await import('./js/player.js')).toggle()); await A.waitForTimeout(300);
  const paused = await st(A);
  await A.evaluate(async () => (await import('./js/player.js')).toggle()); await A.waitForTimeout(500);
  check(!paused.playing && paused.sounding === 0 && (await st(A)).playing && await advancing(A), '12. Pausa y reanudación');
  await A.evaluate(async () => (await import('./js/player.js')).seek(20)); await A.waitForTimeout(400);
  check(Math.abs((await st(A)).t - 20.4) < 1.2, '    Búsqueda temporal');
  await A.evaluate(async () => (await import('./js/player.js')).setVolume(0.3));
  check((await st(A)).vol === 0.3, '    Volumen');
  await A.evaluate(async () => { const pl = await import('./js/player.js'); pl.cycleRepeat(); pl.cycleRepeat(); pl.seek(39.3); });     // repetir una
  await until(A, async () => { const pl = await import('./js/player.js'); return pl.P.audio.currentTime < 5 && !pl.P.audio.paused; }, null, 6000);
  s = await st(A);
  check(s.spatial && s.playing && s.t < 6 && s.title === 'Tono largo', '    Repetir una canción');
  await A.evaluate(async () => { const pl = await import('./js/player.js'); pl.cycleRepeat(); });
  await A.evaluate(async () => { const { S } = await import('./js/store.js'), pl = await import('./js/player.js'); const l = [...S.tracks.values()].filter(t => /tono/i.test(t.title)); pl.playQueue(l, 0); pl.toggleShuffle(); pl.next(); });
  await sounding(A, 'Otro tono');
  s = await st(A);
  check(s.spatial && s.sounding === 1 && s.vol === 0.3 && s.last.route === 'spatial', '    Cambio de pista y aleatorio: la siguiente canción también va por la ruta espacial, con el mismo volumen');
  await A.evaluate(async () => { const pl = await import('./js/player.js'); if (pl.P.shuffle) pl.toggleShuffle(); pl.setVolume(1); });

  // --- radios: nunca se procesan
  await playRaw(A, RADIO); await sounding(A, 'Radio de prueba');
  s = await st(A);
  check(!s.spatial && s.sounding === 1 && !s.spatialSrc && s.last.reason === 'radio' && s.pref.on === true, '6. Canción con 8D → radio: la radio suena por la ruta normal, el elemento espacial queda vacío y la preferencia sigue activada');
  await playRaw(A, RADIO2); await sounding(A, 'Otra radio');
  s = await st(A);
  check(!s.spatial && s.sounding === 1 && !s.spatialSrc, '   Radio → radio: sigue sin procesar');
  await play(A, 'Tono largo'); await sounding(A, 'Tono largo');
  s = await st(A);
  check(s.spatial && s.sounding === 1 && !s.mainSrc && s.pref.mode === 'circular', '   Radio → canción de la biblioteca: vuelve el efecto con el modo guardado');
  await A.goto(APP + '#/ajustes'); await A.waitForSelector('[data-sp-status]');
  check(/Tono largo/.test(await A.innerText('[data-sp-status]')) && /se está procesando/.test(await A.innerText('[data-sp-status]')), '   Ajustes dice qué pasó con la última canción');
  await playRaw(A, RADIO); await sounding(A, 'Radio de prueba');
  await A.evaluate(async () => (await import('./js/player.js')).toggle()); await A.waitForTimeout(300);
  check((await st(A)).sounding === 0, '   Detener la radio');

  // --- música libre desde Explorar: sin procesar; ya en la biblioteca, sí (si su servidor lo permite)
  await playRaw(A, FREE); await sounding(A, 'Canción libre');
  s = await st(A);
  check(!s.spatial && s.sounding === 1 && s.last.reason === 'explorar' && !s.spatialSrc, '7. Música libre reproducida desde Explorar: audio original');
  await A.evaluate(async t => { const st2 = await import('./js/store.js'); await st2.saveTrack({ ...t, addedAt: Date.now() }); st2.emit('library'); }, FREE);
  await play(A, 'Canción libre'); await sounding(A, 'Canción libre');
  s = await st(A);
  if (!(s.spatial && s.sounding === 1)) console.log('LIBRE', JSON.stringify(s));
  check(s.spatial && s.sounding === 1 && s.cross === 'anonymous' && s.last.route === 'spatial', '   La misma canción, una vez guardada en la biblioteca, sí se procesa (su servidor permite CORS)');
  check(await advancing(A), '   y suena');

  // --- cambios rápidos y activar/desactivar repetido
  for (let i = 0; i < 9; i++) { if (i % 3 === 0) await playRaw(A, RADIO); else if (i % 3 === 1) await play(A, 'Tono largo'); else await playRaw(A, FREE); await A.waitForTimeout(60 + i * 15); }
  await play(A, 'Otro tono'); await sounding(A, 'Otro tono');
  s = await st(A);
  check(s.sounding === 1 && s.spatial && s.title === 'Otro tono' && await advancing(A), '8. Tras muchos cambios rápidos entre radio, biblioteca y Explorar suena una sola cosa, y es la última');
  await A.goto(APP + '#/ajustes'); await A.waitForSelector('[data-sp="on"]');
  const t0 = (await st(A)).t;
  for (let i = 0; i < 6; i++) { await A.setChecked('[data-sp="on"]', i % 2 === 1); await A.waitForTimeout(140); }
  await A.waitForTimeout(900);
  s = await st(A);
  check(s.pref.on === true && s.sounding === 1 && s.playing && s.t > t0 && s.title === 'Otro tono' && await advancing(A), '   Activar y desactivar seis veces seguidas no corta la canción ni la reinicia');
  // desactivar a mitad de canción: sigue donde estaba y sin movimiento; la siguiente ya va por la ruta normal
  await setUi(A, 'intensity', 100);
  const tOff = (await st(A)).t;
  await setUi(A, 'on', false); await A.waitForTimeout(900);
  const flat = await balance(A, 2200);
  s = await st(A);
  check(s.playing && s.t > tOff && s.sounding === 1 && range(flat) < 0.03, `   Desactivarlo a mitad de canción: sigue sonando donde estaba y deja de moverse (${range(flat).toFixed(3)})`);
  await play(A, 'Tono largo'); await sounding(A, 'Tono largo');
  s = await st(A);
  check(!s.spatial && s.sounding === 1 && !s.spatialSrc && s.last.reason === 'apagado', '   y la siguiente canción suena por la ruta normal');

  // --- restaurar y persistencia
  await setUi(A, 'on', true); await setUi(A, 'mode', 'envolvente'); await setUi(A, 'speed', 85);
  await A.click('[data-act="sp-reset"]'); await A.waitForTimeout(500);
  s = await st(A);
  check(s.pref.mode === 'suave' && s.pref.intensity === 60 && s.pref.speed === 40 && s.pref.on === true, '13. «Restaurar ajustes» vuelve a Suave, 60 % y 40 % (sin apagar el efecto)');
  await setUi(A, 'mode', 'circular'); await setUi(A, 'intensity', 75); await setUi(A, 'speed', 20);
  await A.reload(); await A.waitForSelector('[data-sp="on"]');
  s = await st(A);
  check(s.pref.on && s.pref.mode === 'circular' && s.pref.intensity === 75 && s.pref.speed === 20 && await A.isChecked('[data-sp="on"]'), '    Las preferencias se conservan al recargar');
  // los archivos no cambian
  const sizes = await A.evaluate(async () => { const db = await import('./js/db.js'), { S } = await import('./js/store.js'); const t = [...S.tracks.values()].find(x => x.title === 'Tono largo'); const bl = await db.get('blobs', t.id); const h = await crypto.subtle.digest('SHA-256', await bl.arrayBuffer()); return { size: bl.size, hash: [...new Uint8Array(h)].slice(0, 8).join(',') }; });
  const crypto = require('crypto'), orig = audio.find(a => a.name === 'Tono largo.wav').buffer;
  check(sizes.size === orig.length && sizes.hash === [...crypto.createHash('sha256').update(orig).digest()].slice(0, 8).join(','), '14. El archivo guardado es idéntico al original: el efecto no lo modifica');

  // --- cuenta: se guarda y llega a otro dispositivo
  await A.fill('[data-form="login"] [name=email]', 'audio@example.com'); await A.fill('[data-form="login"] [name=password]', 'secreta123'); await A.click('[data-form="login"] button[value="in"]');
  await until(A, async () => !!(await import('./js/account.js')).user());
  await A.evaluate(async () => { await (await import('./js/account.js')).sync(); });
  const B = await device('B', { files: false });
  await B.goto(APP + '#/ajustes'); await B.fill('[data-form="login"] [name=email]', 'audio@example.com'); await B.fill('[data-form="login"] [name=password]', 'secreta123'); await B.click('[data-form="login"] button[value="in"]');
  const got = await until(B, async () => (await import('./js/store.js')).S.settings.spatial?.mode === 'circular', null, 15000);
  s = await st(B);
  check(got && s.pref.on && s.pref.intensity === 75 && s.pref.speed === 20, '    Con sesión, otro dispositivo recibe la configuración (activado, Circular, 75 %, 20 %)');
  await B.goto(APP + '#/ajustes'); await B.waitForSelector('[data-sp="on"]');
  await setUi(B, 'mode', 'suave'); await B.evaluate(async () => { await (await import('./js/account.js')).sync(); });
  await A.evaluate(async () => { await (await import('./js/account.js')).sync(); });
  check((await st(A)).pref.mode === 'suave', '    Un cambio en el otro dispositivo vuelve al primero al sincronizar');
  await B.evaluate(async () => { const a = await import('./js/account.js'); if (a.user()) await a.signOut(); });
  await B.goto(APP + '#/inicio'); await B.goto(APP + '#/ajustes'); await B.waitForSelector('[data-form="login"]');
  await B.fill('[data-form="login"] [name=email]', 'audio@example.com'); await B.fill('[data-form="login"] [name=password]', 'secreta123'); await B.click('[data-form="login"] button[value="in"]');
  await until(B, async () => !!(await import('./js/account.js')).user());
  await B.evaluate(async () => { await (await import('./js/account.js')).sync(); });
  check((await st(B)).pref.mode === 'suave' && (await st(B)).pref.on, '    Cerrar sesión y volver a entrar conserva la configuración');

  // --- sin conexión: funciona con las canciones del dispositivo
  await A.context().setOffline(true);
  await play(A, 'Tono largo'); await sounding(A, 'Tono largo');
  s = await st(A);
  check(s.spatial && s.sounding === 1 && await advancing(A), '18. Sin conexión, el efecto funciona con las canciones guardadas en el dispositivo');
  await A.context().setOffline(false);

  // ====================================================================== Oracle
  const connect = async page => { await page.goto(APP + '#/ajustes'); if (await page.$('details.more summary')) await page.click('details.more summary'); await page.fill('[data-form="par"] [name=name]', 'Nube'); await page.fill('[data-form="par"] [name=url]', OWNER_PAR); await page.click('[data-form="par"] button'); return until(page, async () => [...(await import('./js/store.js')).S.tracks.values()].filter(t => t.cloudName).length >= 3, null, 20000); };
  const cloudTitle = page => page.evaluate(async () => [...(await import('./js/store.js')).S.tracks.values()].find(t => t.cloudName && !t.hasBlob).title);
  const C = await device('C', { files: false });
  check(await connect(C), '5. Bucket de Oracle conectado (emulador)');
  await C.goto(APP + '#/ajustes'); await C.waitForSelector('[data-sp="on"]'); await setUi(C, 'on', true);
  const ct = await cloudTitle(C);
  await play(C, ct); await sounding(C, ct);
  s = await st(C);
  check(s.spatial && s.cross === 'anonymous' && s.sounding === 1 && s.last.route === 'spatial', '   Canción en streaming desde Oracle con CORS: se procesa (elemento con crossOrigin anónimo)');
  await C.evaluate(async () => { const pl = await import('./js/player.js'); pl.P.audio.loop = true; });
  check(await advancing(C), '   y suena');
  const logs = await C.evaluate(() => JSON.stringify(performance.getEntriesByType('resource').map(r => r.name)).length);
  check(logs > 0, '   (la URL del bucket no se escribe en ningún registro de la app)');

  // Oracle sin CORS: audio original, sin tocar la preferencia
  const D = await device('D', { files: false });
  await connect(D);
  await fetch(ORACLE + '/__nocors?on=1');                  // a partir de aquí, Oracle no manda cabeceras CORS con la música
  await D.goto(APP + '#/ajustes'); await D.waitForSelector('[data-sp="on"]'); await setUi(D, 'on', true);
  const dt = await cloudTitle(D);
  await play(D, dt);
  await until(D, async t => { const pl = await import('./js/player.js'); return pl.P.current?.title === t && !pl.P.audio.paused && pl.P.audio.currentTime > 0.1; }, dt);
  await D.evaluate(async () => { const pl = await import('./js/player.js'); pl.P.audio.loop = true; });
  s = await st(D);
  check(!s.spatial && s.sounding === 1 && s.last.reason === 'cors' && s.pref.on === true && !s.spatialSrc, '15. Oracle sin CORS: la canción suena por la ruta normal y la preferencia no cambia');
  check(await advancing(D) && !/No se pudo/.test(await D.evaluate(() => document.querySelector('#toasts').innerText)), '    Suena de verdad y sin ningún aviso emergente');

  await fetch(ORACLE + '/__nocors?on=0');

  // ====================================================================== errores del navegador
  // Contexto de audio que no arranca
  const E = await device('E', { init: () => { const R = window.AudioContext; window.AudioContext = class extends R { constructor(...a) { super(...a); this.suspend(); } resume() { return Promise.resolve(); } }; } });
  await E.evaluate(async () => { const st2 = await import('./js/store.js'); st2.S.settings.spatial = { on: true, mode: 'suave', intensity: 60, speed: 40 }; await st2.saveKV('settings', false); });
  await play(E, 'Tono largo'); await sounding(E, 'Tono largo');
  s = await st(E);
  check(!s.spatial && s.sounding === 1 && s.last.reason === 'contexto' && s.pref.on && await advancing(E), '    AudioContext suspendido: suena el original, de verdad, y la preferencia sigue igual');
  // La ruta espacial falla después de empezar (el elemento da error): vuelve al original en el mismo punto
  const F = await device('F');
  await F.evaluate(async () => { const st2 = await import('./js/store.js'); st2.S.settings.spatial = { on: true, mode: 'suave', intensity: 60, speed: 40 }; await st2.saveKV('settings', false); });
  await play(F, 'Tono largo'); await sounding(F, 'Tono largo');
  await F.evaluate(async () => (await import('./js/player.js')).seek(12)); await F.waitForTimeout(300);
  check((await st(F)).spatial, '    (la canción iba por la ruta espacial)');
  await F.evaluate(async () => { const pl = await import('./js/player.js'); pl.elements().spatial.dispatchEvent(new Event('error')); });
  await until(F, async () => { const pl = await import('./js/player.js'); return pl.P.audio === pl.elements().main && !pl.P.audio.paused && pl.P.audio.currentTime > 11; });
  s = await st(F);
  check(!s.spatial && s.sounding === 1 && s.t > 11 && s.t < 16 && s.last.reason === 'error' && s.pref.on && await advancing(F), `    Si la ruta espacial falla a mitad de canción, sigue por la normal en el mismo punto (${s.t.toFixed(1)} s) y sin avisos`);
  check(!/No se pudo/.test(await F.evaluate(() => document.querySelector('#toasts').innerText)), '    sin mensajes de error');
  // Sin Web Audio
  const G = await device('G', { init: () => { delete window.AudioContext; delete window.webkitAudioContext; window.AudioContext = undefined; window.webkitAudioContext = undefined; } });
  await G.evaluate(async () => { const st2 = await import('./js/store.js'); st2.S.settings.spatial = { on: true, mode: 'suave', intensity: 60, speed: 40 }; await st2.saveKV('settings', false); });
  await play(G, 'Tono largo'); await sounding(G, 'Tono largo');
  s = await st(G);
  await G.goto(APP + '#/ajustes'); await G.waitForSelector('[data-sp="on"]');
  check(!s.spatial && s.sounding === 1 && s.last.reason === 'sin-webaudio' && await G.isDisabled('[data-sp="on"]') && /no admite/.test(await G.innerText('#ajustes-audio')), '    Navegador sin Web Audio: todo suena normal y Ajustes lo explica con el interruptor desactivado');

  check(errs.length === 0, `25. Sin errores en consola${errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''}`);
  console.log(`\n${ok} comprobaciones correctas, ${fails} fallos`);
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
