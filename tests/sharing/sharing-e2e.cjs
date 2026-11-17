// Compartir el bucket con pocas personas, de punta a punta, con dos cuentas distintas:
// enlaces de solo lectura, playlists solo en Supabase y modo desarrollador solo con la clave de API.
// Requiere: la app en :8765 (tests/playlists/static-server.mjs), el emulador de Supabase en :8766
// sobre una base recién creada (tests/playlists/sb-server.mjs) y el de Oracle en :8769.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = process.env.APP || 'http://localhost:8765/';
const API = process.env.API || 'http://localhost:8766';
const ORACLE = process.env.ORACLE || 'http://localhost:8769';
const SB = 'https://rabhgmnjvxwlttlviywc.supabase.co';
const FIX = path.join(__dirname, 'fixtures');
const OWNER_PAR = `${ORACLE}/p/dueno/n/ns/b/musica/o/`;
const SHOTS = process.env.SHOTS || '';
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };
const oracle = async () => (await fetch(ORACLE + '/__log')).json();
const sql = async q => (await fetch(API + '/__sql', { method: 'POST', body: q })).json();

(async () => {
  await fetch(ORACLE + '/__reset');
  const b = await chromium.launch();
  const errs = [];
  async function device(name, mobile) {
    const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 900 } });
    await ctx.route(SB + '/**', async route => {
      try { await route.fulfill({ response: await route.fetch({ url: route.request().url().replace(SB, API) }) }); }
      catch { await route.abort('failed').catch(() => {}); }
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(`${name} consola: ${m.text()}`); });
    await page.goto(APP + '#/inicio');
    await page.waitForSelector('#nav-links a');
    return page;
  }
  const ev = (page, fn, arg) => page.evaluate(fn, arg);
  const until = async (page, fn, arg, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
  const toastHas = (page, re, ms = 15000) => until(page, re => new RegExp(re).test(document.querySelector('#toasts').innerText), re.source, ms);
  const plReady = page => until(page, async () => { const s = (await import('./js/playlists-data.js')).status(); return s.mode === 'ready' && !s.pending && !s.busy; }, null, 30000);
  const login = async (page, email) => {
    await page.goto(APP + '#/ajustes');
    await page.fill('[data-form="login"] [name=email]', email);
    await page.fill('[data-form="login"] [name=password]', 'secreta123');
    await page.click('[data-form="login"] button[value="in"]');
    return plReady(page);
  };
  const connect = async (page, url, name = '') => {
    await page.goto(APP + '#/ajustes');
    if (await page.$('details.more summary')) await page.click('details.more summary');
    await page.fill('[data-form="par"] [name=name]', name);
    await page.fill('[data-form="par"] [name=url]', url);
    await page.click('[data-form="par"] button');
    return until(page, () => document.body.innerText.includes('3 canciones en la nube'), null, 15000);
  };
  const menuOf = async (page, title) => {
    await page.goto(APP + '#/biblioteca/canciones');
    await page.waitForSelector('.row');
    await page.locator('.row', { hasText: title }).first().locator('[data-act="more"]').click();
    await page.waitForSelector('#sheet[open] .menu');
    const items = await page.$$eval('#sheet .menu button', l => l.map(x => x.innerText.trim()));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    return items;
  };
  const playlistNames = page => ev(page, async () => (await import('./js/store.js')).S.playlists.filter(p => !p.deleted).map(p => p.name));
  const newPlaylist = (page, name) => ev(page, async name => {
    const st = await import('./js/store.js'), d = await import('./js/playlists-data.js');
    const ids = [...st.S.tracks.keys()].slice(0, 2);
    const p = d.normalize({ id: 'p' + Math.random().toString(36).slice(2, 9), name, trackIds: [], createdAt: Date.now() });
    d.addTracks(p, ids); await st.savePlaylist(p);
  }, name);

  // ========================================================= propietario (escritorio)
  const O = await device('propietario', false);
  check(await login(O, 'dueno@example.com'), 'el propietario inicia sesión');
  check(await connect(O, OWNER_PAR, 'Mi música'), 'conecta su bucket con su URL de lectura y escritura');
  let s = await oracle();
  check(s.objects.some(([n, size]) => n === '_fiora/datos.json' && size === 0), 'la copia antigua de datos personales del bucket queda vacía al sincronizar');
  check(!(await playlistNames(O)).includes('Secreta del dueño'), 'lo que había en esa copia no se mezcla en la app');
  await O.goto(APP + '#/ajustes'); await O.waitForSelector('.buckets');
  check((await O.innerText('.buckets')).includes('solo lectura'), 'sin clave de API, su bucket es de solo lectura en este dispositivo');
  check(await O.$eval('[data-toggle="dev"]', i => i.disabled), 'sin clave de API no se puede activar el modo desarrollador');
  check(!(await O.$('[data-form="share"]')) && !(await O.$('[data-act="cloud-tags"]')), 'sin clave no aparecen «Compartir» ni «Actualizar archivos de la nube»');
  // Aunque el ajuste quedara activado (p. ej. de una versión anterior), no tiene efecto sin la clave.
  await ev(O, async () => { const st = await import('./js/store.js'); st.S.settings.dev = true; await st.saveKV('settings', false); });
  let items = await menuOf(O, 'Tití');
  check(!items.some(t => /Editar metadatos|Borrar también de la nube|Subir a la nube/.test(t)), 'el menú de una canción no ofrece editar, subir ni borrar de la nube sin la clave');
  await O.goto(APP + '#/repetidas');
  check((await O.innerText('#view')).includes('Solo en modo desarrollador'), '«Canciones repetidas» tampoco se abre sin la clave');
  check(await ev(O, async () => { const c = await import('./js/cloud.js'); const t = [...(await import('./js/store.js')).S.tracks.values()][0]; try { await c.deleteRemote(t); return false; } catch (e) { return /solo lectura/.test(e.message); } }), 'borrar de la nube sin la clave se rechaza aunque se llame directamente');

  // --- añade la clave de API
  await O.goto(APP + '#/ajustes');
  await O.click('details.key-steps summary');
  await O.fill('[data-form="oci"] textarea', fs.readFileSync(path.join(FIX, 'config.txt'), 'utf8'));
  await O.setInputFiles('[data-form="oci"] [name=pem]', path.join(FIX, 'key.pem'));
  await O.click('[data-form="oci"] button');
  await O.waitForSelector('[data-form="share"]', { timeout: 10000 });
  s = await oracle();
  check(s.log.includes('API GET (bucket) firmada'), 'la clave se comprueba con una petición firmada');
  check(!(await O.$eval('[data-toggle="dev"]', i => i.disabled)) && (await O.innerText('.buckets')).includes('tuyo'), 'con la clave, el bucket es suyo y el modo desarrollador se puede activar');
  items = await menuOf(O, 'Tití');
  check(items.includes('Editar metadatos') && items.includes('Borrar también de la nube'), 'con la clave y el modo activado vuelven «Editar metadatos» y «Borrar también de la nube»');
  await O.goto(APP + '#/ajustes');
  await O.click('[data-act="cloud-sync"]');
  await until(O, async () => !(await (await fetch('http://localhost:8769/__log')).json()).objects.some(o => o[0] === '_fiora/datos.json'), null, 10000);
  check((await oracle()).log.includes('API DELETE _fiora/datos.json firmada'), 'con la clave, la copia antigua se borra del todo de Oracle');

  // --- crea un enlace para Ana
  await O.waitForSelector('[data-form="share"]');
  await until(O, () => !document.querySelector('[data-shares]').innerText.includes('Cargando'), null, 8000);
  check((await O.innerText('[data-shares]')).includes('Aún no lo has compartido'), 'la PAR del propietario (creada en la consola) no aparece como enlace compartido');
  await O.fill('[data-form="share"] [name=who]', 'Ana');
  await O.selectOption('[data-form="share"] [name=days]', '30');
  await O.click('[data-form="share"] button');
  await O.waitForSelector('#sheet[open] [data-share-url]', { timeout: 10000 });
  const anaUrl = await O.$eval('[data-share-url]', i => i.value);
  s = await oracle();
  const anaPar = s.pars.find(p => p.name === 'fiora-compartir:Ana');
  check(s.log.includes('API POST PAR firmada'), 'el enlace se crea con una petición firmada con cuerpo (sha256, tipo y longitud)');
  check(anaPar && anaPar.accessType === 'AnyObjectRead' && anaPar.bucketListingAction === 'ListObjects', 'el enlace es de solo lectura, con listado');
  check(anaPar && Math.abs(Date.parse(anaPar.timeExpires) - Date.now() - 30 * 864e5) < 3600e3, 'caduca en el plazo elegido (1 mes)');
  check(anaUrl === `${ORACLE}/p/${anaPar?.token}/n/ns/b/musica/o/`, 'se muestra la URL completa una sola vez para copiarla');
  if (SHOTS) await O.screenshot({ path: path.join(SHOTS, 'compartir-enlace.png') });
  await O.click('#sheet [data-x]'); await O.waitForTimeout(300);
  await until(O, () => document.querySelector('[data-shares]').innerText.includes('Ana'), null, 8000);
  check((await O.innerText('[data-shares]')).includes('Solo lectura · caduca el'), 'Ana aparece en la lista de enlaces con su caducidad');
  if (SHOTS) await O.locator('.panel', { has: O.locator('.share-box') }).screenshot({ path: path.join(SHOTS, 'compartir-nube.png') });

  await newPlaylist(O, 'Solo mía');
  check(await plReady(O), 'el propietario crea una playlist y se guarda en Supabase');

  // ========================================================= Ana (móvil, otra cuenta)
  const G = await device('Ana', true);
  check(await login(G, 'ana@example.com'), 'Ana inicia sesión con su propia cuenta');
  check(await connect(G, anaUrl, 'Música compartida'), 'Ana conecta el enlace y ve las 3 canciones');
  await G.goto(APP + '#/ajustes'); await G.waitForSelector('.buckets');
  check((await G.innerText('.buckets')).includes('solo lectura'), 'para Ana el bucket es de solo lectura');
  check(await G.$eval('[data-toggle="dev"]', i => i.disabled) && !(await G.$('[data-form="share"]')), 'Ana no puede activar el modo desarrollador ni compartir');
  if (SHOTS) await G.screenshot({ path: path.join(SHOTS, 'compartido-movil.png'), fullPage: false });
  const got = await ev(G, async () => { const c = await import('./js/cloud.js'); const t = [...(await import('./js/store.js')).S.tracks.values()].find(x => x.cloudName); return (await c.fetchBlob(t)).size; });
  check(got > 1000, 'Ana puede escuchar y descargar las canciones');
  await ev(G, async () => { const st = await import('./js/store.js'); st.S.settings.dev = true; await st.saveKV('settings', false); });
  items = await menuOf(G, 'Tití');
  check(!items.some(t => /Editar metadatos|Borrar también de la nube|Subir a la nube/.test(t)), 'a Ana no se le ofrece editar, subir ni borrar aunque fuerce el ajuste');
  const wr = await ev(G, async () => { const c = await import('./js/cloud.js'); const t = [...(await import('./js/store.js')).S.tracks.values()].find(x => x.cloudName); const r = []; for (const f of [() => c.deleteRemote(t), () => c.writeFile(t, () => {}, { title: 'X' })]) { try { await f(); r.push('hecho'); } catch (e) { r.push(e.message); } } return r; });
  check(wr.every(m => /solo lectura/.test(m)), 'la app rechaza borrar o reescribir archivos del bucket compartido');
  const direct = await fetch(anaUrl + 'intruso.mp3', { method: 'PUT', body: 'x' });
  check(direct.status === 403, 'y Oracle rechaza escribir con su enlace aunque se intente fuera de la app');
  await G.waitForTimeout(500);
  check(await plReady(G), 'la sincronización de Ana termina');
  const gl = await playlistNames(G);
  check(!gl.includes('Solo mía') && !gl.includes('Secreta del dueño'), 'Ana no ve las playlists del propietario');
  await newPlaylist(G, 'De Ana');
  check(await plReady(G), 'Ana crea su playlist y se guarda en su cuenta');

  // --- el propietario no ve la de Ana
  await O.reload(); await O.waitForSelector('#nav-links a');
  await ev(O, async () => (await import('./js/playlists-data.js')).pull?.());
  check(await plReady(O), 'el propietario vuelve a sincronizar');
  check(!(await playlistNames(O)).includes('De Ana'), 'el propietario no ve las playlists de Ana');
  const rows = await sql("select u.email, p.name from public.fiora_playlists p join auth.users u on u.id = p.user_id where p.name in ('Solo mía', 'De Ana', 'Secreta del dueño') order by 2");
  check(JSON.stringify(rows.rows || rows) === JSON.stringify([{ email: 'ana@example.com', name: 'De Ana' }, { email: 'dueno@example.com', name: 'Solo mía' }]), 'en Supabase cada playlist está solo en la cuenta de su dueño');
  s = await oracle();
  check(!s.log.some(l => / PUT /.test(l) && !/_fiora\/(datos|grupo)\.json|intruso/.test(l)) && !s.objects.some(([n]) => /datos|playlist/i.test(n)), 'nada de playlists, favoritos ni escuchas se ha escrito en el bucket');

  // --- límite de enlaces
  const more = await ev(O, async url => { const oci = await import('./js/oci.js'); const r = []; for (const w of ['Bea', 'Carla', 'Dani', 'Eva', 'Fran']) { try { await oci.createShare(url, w, 30); r.push('ok'); } catch (e) { r.push(e.message); } } return r; }, OWNER_PAR);
  check(more.slice(0, 4).every(x => x === 'ok') && /revoca/.test(more[4]), `como mucho 5 enlaces vigentes a la vez (${more[4]})`);
  await O.goto(APP + '#/inicio'); await O.goto(APP + '#/ajustes');   // (si ya estaba en Ajustes, ir a la misma dirección no la vuelve a pintar)
  await until(O, () => document.querySelector('[data-shares]')?.innerText.includes('Eva'), null, 8000);
  check(await until(O, () => document.querySelector('[data-form="share"] button')?.disabled, null, 8000), 'con 5 enlaces el botón de crear otro queda desactivado');

  // --- revocar el de Ana
  await O.locator('[data-shares] li', { hasText: 'Ana' }).locator('[data-act="share-revoke"]').click();
  await O.click('#sheet [data-ok]');
  check(await toastHas(O, /Enlace revocado/), 'el propietario revoca el enlace de Ana');
  check(!(await oracle()).pars.some(p => p.name === 'fiora-compartir:Ana'), 'el enlace desaparece de Oracle');
  const after = await ev(G, async () => (await import('./js/cloud.js')).syncLibrary());
  check(after.errors.length === 1 && /revocado/.test(after.errors[0]), 'Ana ya no puede leer el bucket y la app explica por qué');
  check((await fetch(anaUrl)).status === 404, 'su URL deja de funcionar al momento');

  // --- quitar la clave
  await O.goto(APP + '#/ajustes');
  await O.click('[data-act="oci-forget"]');
  await O.waitForSelector('details.key-steps');
  check(await O.$eval('[data-toggle="dev"]', i => i.disabled && !i.checked) && !(await O.$('[data-form="share"]')), 'al quitar la clave se desactiva el modo desarrollador y desaparece «Compartir»');
  check(!(await ev(O, async () => (await import('./js/db.js')).get('kv', 'oci-key'))), 'la clave se borra del dispositivo');
  const snap = await ev(O, async () => JSON.stringify((await import('./js/sync.js')).snapshot(true)));
  check(!/ocid1|PRIVATE|fiora-compartir/.test(snap), 'ni la clave ni los enlaces viajan a la cuenta');

  check(!errs.length, 'sin errores de página ' + errs.join(' | '));
  console.log(`\n${ok} OK, ${fails} fallos`);
  process.exitCode = fails ? 1 : 0;
  await b.close();
})();
