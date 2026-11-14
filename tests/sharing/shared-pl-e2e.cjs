// Playlists compartidas entre quienes comparten un bucket, de punta a punta, con tres cuentas:
// Pablo (crea el bucket), Ana (puede editar) y Bea (solo ver). Requiere los mismos servidores que
// sharing-e2e.cjs (app :8765, Supabase :8766 con las tres migraciones, Oracle :8769).
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
  const plReady = page => until(page, async () => { const d = await import('./js/playlists-data.js'); const s = d.status(), h = d.sharedStatus(); return s.mode === 'ready' && !s.pending && !s.busy && !h.pending && !h.busy && !h.again; }, null, 30000);
  const login = async (page, email) => {
    await page.goto(APP + '#/ajustes');
    await page.fill('[data-form="login"] [name=email]', email);
    await page.fill('[data-form="login"] [name=password]', 'secreta123');
    await page.click('[data-form="login"] button[value="in"]');
    return plReady(page);
  };
  const connect = async (page, url, name) => {
    await page.goto(APP + '#/ajustes');
    if (await page.$('details.more summary')) await page.click('details.more summary');
    await page.fill('[data-form="par"] [name=name]', name);
    await page.fill('[data-form="par"] [name=url]', url);
    await page.click('[data-form="par"] button');
    return until(page, () => document.body.innerText.includes('3 canciones en la nube'), null, 15000);
  };
  const groupOk = page => until(page, async () => { const g = await import('./js/groups.js'); return g.list().length === 1; }, null, 15000);
  const sync = async page => { await ev(page, async () => { await (await import('./js/groups.js')).sync(); const d = await import('./js/playlists-data.js'); await d.pull(); await d.pullShared(); }); return plReady(page); };
  const shared = page => ev(page, async () => (await import('./js/store.js')).S.playlists.filter(p => p.shared && !p.deleted).map(p => ({ name: p.name, role: p.shared.role, owner: p.shared.ownerName, n: p.trackIds.length, id: p.id })));
  const ids = page => ev(page, async () => Object.fromEntries([...(await import('./js/store.js')).S.tracks.values()].map(t => [t.fileName.replace(/\.wav$/, ''), t.id])));

  // ========================================================= Pablo crea el bucket y su grupo
  const O = await device('Pablo', false);
  check(await login(O, 'pablo@example.com'), 'Pablo inicia sesión');
  check(await connect(O, OWNER_PAR, 'Mi música'), 'Pablo conecta su bucket');
  await ev(O, async ({ cfg, pem }) => {
    const oci = await import('./js/oci.js'), cloud = await import('./js/cloud.js');
    await oci.save(oci.parseConfig(cfg), await oci.importPem(pem)); await cloud.verifyKey();
  }, { cfg: fs.readFileSync(path.join(FIX, 'config.txt'), 'utf8'), pem: fs.readFileSync(path.join(FIX, 'key.pem'), 'utf8') });
  await ev(O, async () => (await import('./js/groups.js')).sync());
  check(await groupOk(O), 'con la clave de API, la app crea el grupo del bucket');
  let s = await oracle();
  const file = s.objects.find(([n]) => n === '_fiora/grupo.json');
  check(file && file[1] < 200, 'en el bucket solo queda `_fiora/grupo.json` (id y clave aleatorios, nada personal)');
  const keyRow = await sql("select key_hash, key_version from public.fiora_bucket_groups");
  check(keyRow.length === 1 && /^[0-9a-f]{64}$/.test(keyRow[0].key_hash), 'Supabase guarda solo la huella de la clave');
  const links = await ev(O, async url => { const oci = await import('./js/oci.js'); return [await oci.createShare(url, 'Ana', 30), await oci.createShare(url, 'Bea', 30)]; }, OWNER_PAR);

  // ========================================================= Ana y Bea entran con sus enlaces
  const A = await device('Ana', true);
  check(await login(A, 'ana@example.com'), 'Ana inicia sesión');
  check(await connect(A, links[0], 'Música de Pablo'), 'Ana conecta su enlace de solo lectura');
  check(await groupOk(A), 'Ana entra sola en el grupo (puede leer la clave del bucket)');
  await A.goto(APP + '#/ajustes');
  await A.waitForSelector('[data-act="group-name"]');
  await A.click('[data-act="group-name"]');
  await A.fill('#sheet input[name=v]', 'Ana');
  await A.click('#sheet button.primary');
  check(await toastHas(A, /Nombre guardado/), 'Ana elige el nombre con el que la ven');
  if (SHOTS) { await A.waitForTimeout(3500); await A.locator('.sub-panel', { hasText: 'Playlists compartidas' }).screenshot({ path: path.join(SHOTS, 'grupo-ajustes.png') }); }
  const B = await device('Bea', false);
  check(await login(B, 'bea@example.com'), 'Bea inicia sesión');
  check(await connect(B, links[1], 'Música de Pablo'), 'Bea conecta su enlace');
  check(await groupOk(B), 'Bea entra en el grupo');
  await ev(B, async () => { const g = await import('./js/groups.js'); await g.setName(g.list()[0].id, 'Bea'); });

  // ========================================================= Pablo crea una playlist y la comparte
  const id = await ids(O);
  await ev(O, async t => {
    const st = await import('./js/store.js'), d = await import('./js/playlists-data.js');
    const p = d.normalize({ id: 'pverano', name: 'Verano', trackIds: [], createdAt: Date.now(), sections: [{ id: 's1', name: 'Mañana' }] });
    d.addTracks(p, [t['Rosalía - Despechá'], t['Bad Bunny - Tití']]);
    p.trackSection = { [t['Rosalía - Despechá']]: 's1' };
    p.notes = { [t['Rosalía - Despechá']]: { text: 'nota privada de Pablo', at: Date.now() } };
    await st.savePlaylist(p);
  }, id);
  check(await plReady(O), 'Pablo crea «Verano» (con una nota privada)');
  await O.goto(APP + '#/playlist/pverano');
  await O.click('[data-act="pl-share"]');
  await O.waitForSelector('#sheet[open] .share-dlg [data-sh-member]', { timeout: 15000 });
  const people = await O.$$eval('#sheet .share-people b', l => l.map(x => x.textContent));
  check(people.sort().join(',') === 'Ana,Bea', `el diálogo muestra a Ana y Bea por su nombre, sin correos (${people})`);
  check(!(await O.innerText('#sheet')).includes('@'), 'en el diálogo no aparece ningún correo');
  await O.fill('#sheet [data-sh-name]', 'Pablo');
  const [anaId, beaId] = await O.$$eval('#sheet .share-people li', l => ['Ana', 'Bea'].map(n => l.find(x => x.innerText.includes(n)).querySelector('[data-sh-member]').dataset.shMember));
  await O.check(`#sheet [data-sh-member="${anaId}"]`);
  await O.check(`#sheet [data-sh-member="${beaId}"]`);
  await O.selectOption(`#sheet [data-sh-edit="${beaId}"]`, 'view');
  if (SHOTS) await O.locator('#sheet .share-dlg').screenshot({ path: path.join(SHOTS, 'compartir-playlist.png') });
  await O.click('#sheet [data-ok]');
  check(await toastHas(O, /compartida con 2 personas/), 'Pablo la comparte: Ana puede editar, Bea solo ver');
  await O.waitForTimeout(500);
  const kindO = (await O.innerText('.pl-hero .kind')).toLowerCase();
  check(kindO.includes('compartida con'), 'la cabecera indica con quién está compartida: ' + kindO);

  // ========================================================= Ana la ve y colabora
  check(await sync(A), 'Ana sincroniza');
  let sa = await shared(A);
  check(sa.length === 1 && sa[0].name === 'Verano' && sa[0].owner === 'Pablo' && sa[0].role === 'edit', 'Ana ve «Verano» de Pablo y puede editar');
  await A.goto(APP + '#/playlists');
  check((await A.innerText('#view')).includes('Compartidas contigo'), 'aparece en «Compartidas contigo»');
  await A.goto(APP + '#/playlist/' + encodeURIComponent(sa[0].id));
  await A.waitForSelector('.pl-hero');
  const heroA = await A.innerText('.pl-hero'), heroAl = heroA.toLowerCase();
  check(heroAl.includes('compartida por pablo · puedes editar') && heroA.includes('Capítulos') && !/\bEditar\b/.test(heroA) && !heroA.includes('Compartir'), 'Ana tiene «Capítulos», pero no «Editar» ni «Compartir»: ' + heroA.replace(/\n/g, ' | '));
  check(!(await A.innerText('#view')).includes('nota privada'), 'Ana no ve las notas de Pablo');
  check(!(await A.$('.pl-stats')), 'ni sus estadísticas');
  if (SHOTS) { await A.waitForTimeout(1200); await A.screenshot({ path: path.join(SHOTS, 'compartida-ana.png') }); }
  // añade una canción desde su biblioteca
  await A.goto(APP + '#/biblioteca/canciones');
  await A.locator('.row', { hasText: 'Única' }).first().locator('[data-act="more"]').click();
  await A.click('#sheet .menu button:has-text("Añadir a playlist")');
  await A.click('#sheet .menu button:has-text("Verano (de Pablo)")');
  check(await toastHas(A, /Añadida a «Verano»/), 'Ana añade «Única» desde su biblioteca');
  check(await plReady(A), 'y se guarda');
  let rows = await sql("select track_id from public.fiora_playlist_tracks where playlist_id = 'pverano' order by position");
  check(rows.length === 3 && rows[2].track_id === id['Otro - Única'], 'la canción está en la playlist de Pablo en Supabase, al final');
  check(await sync(O), 'Pablo sincroniza');
  check((await ev(O, async () => (await import('./js/store.js')).S.playlists.find(p => p.id === 'pverano').trackIds.length)) === 3, 'Pablo ve el cambio de Ana');
  const note = await ev(O, async () => Object.values((await import('./js/store.js')).S.playlists.find(p => p.id === 'pverano').notes).map(n => n.text));
  check(note.includes('nota privada de Pablo'), 'su nota sigue intacta');

  // ========================================================= cambios a la vez
  // Ana crea el capítulo «Noche» y mete «Tití»; Pablo, sin haberlo visto aún, quita «Despechá».
  await ev(A, async ({ pid, titi }) => {
    const st = await import('./js/store.js'); const p = st.S.playlists.find(x => x.id === pid);
    p.sections.push({ id: 's2', name: 'Noche', description: '', collapsed: false }); p.trackSection[titi] = 's2';
    await st.savePlaylist(p);
  }, { pid: sa[0].id, titi: id['Bad Bunny - Tití'] });
  check(await plReady(A), 'Ana guarda su capítulo «Noche»');
  await ev(O, async t => {
    const st = await import('./js/store.js'), d = await import('./js/playlists-data.js'); const p = st.S.playlists.find(x => x.id === 'pverano');
    d.removeTracks(p, [t]); await st.savePlaylist(p);
  }, id['Rosalía - Despechá']);
  check(await plReady(O), 'Pablo guarda a la vez su cambio (sin haber visto el de Ana)');
  rows = await sql("select t.track_id, s.name from public.fiora_playlist_tracks t left join public.fiora_playlist_sections s on s.user_id = t.user_id and s.playlist_id = t.playlist_id and s.id = t.section_id where t.playlist_id = 'pverano' order by t.position");
  check(JSON.stringify(rows) === JSON.stringify([{ track_id: id['Bad Bunny - Tití'], name: 'Noche' }, { track_id: id['Otro - Única'], name: null }]), 'no se pierde ningún cambio: «Despechá» fuera y «Tití» en «Noche»');
  const pv = await ev(O, async () => { const p = (await import('./js/store.js')).S.playlists.find(x => x.id === 'pverano'); return [p.name, p.sections.map(s => s.name)]; });
  check(pv[0] === 'Verano' && pv[1].join() === 'Mañana,Noche', 'Pablo tiene la versión fusionada');

  // ========================================================= Bea solo puede verla
  check(await sync(B), 'Bea sincroniza');
  const sb = await shared(B);
  check(sb.length === 1 && sb[0].role === 'view' && sb[0].n === 2, 'Bea la ve, solo para ver, con las dos canciones');
  await B.goto(APP + '#/playlist/' + encodeURIComponent(sb[0].id));
  await B.waitForSelector('.pl-hero');
  check((await B.innerText('.pl-hero .kind')).toLowerCase().includes('solo ver') && !(await B.$('[data-act="pl-reorder"]')) && !(await B.$('.pl-discover')) && !(await B.$('[data-act="pl-edit"]')), 'Bea no tiene «Reordenar», «Descubre más», «Capítulos» ni «Editar»: ' + (await B.innerText('.pl-hero .kind')) + ' ' + !!(await B.$('[data-act="pl-reorder"]')) + !!(await B.$('.pl-discover')) + !!(await B.$('[data-act="pl-edit"]')));
  await B.locator('.pl-list .row').first().locator('[data-act="more"]').click();
  const bm = await B.$$eval('#sheet .menu button', l => l.map(x => x.innerText));
  await B.keyboard.press('Escape');
  check(!bm.some(t => /Quitar de esta playlist|Mover a capítulo|Destacar|nota/i.test(t)), 'su menú de canción no deja cambiar la playlist');
  const hack = await ev(B, async pid => {
    const st = await import('./js/store.js'); const p = st.S.playlists.find(x => x.id === pid);
    const acc = await import('./js/account.js');
    const r = await acc.authFetch('/rest/v1/rpc/fiora_save_shared_playlist', { method: 'POST', json: { owner: p.shared.owner, p: { id: p.shared.pid, updatedAt: Date.now() + 1e7, trackIds: [] } } });
    return r.status;
  }, sb[0].id);
  rows = await sql("select count(*)::int n from public.fiora_playlist_tracks where playlist_id = 'pverano'");
  check(hack >= 400 && rows[0].n === 2, `aunque Bea llame a Supabase directamente, no puede cambiarla (${hack})`);

  // ========================================================= revocar el enlace de Ana
  await O.goto(APP + '#/ajustes');
  await until(O, () => document.querySelector('[data-shares]')?.innerText.includes('Ana'), null, 10000);
  await O.locator('[data-shares] li', { hasText: 'Ana' }).locator('[data-act="share-revoke"]').click();
  await O.click('#sheet [data-ok]');
  check(await toastHas(O, /ni ver las playlists/), 'Pablo revoca el enlace de Ana y se renueva la clave del grupo');
  check((await sql('select key_version from public.fiora_bucket_groups'))[0].key_version === 2, 'versión nueva de la clave');
  await sync(A);
  check((await shared(A)).length === 0, 'Ana deja de ver «Verano»');
  check(!(await ev(A, async () => (await import('./js/groups.js')).list().length)), 'y ya no está en el grupo');
  await sync(B);
  check((await shared(B)).length === 1, 'Bea, que sigue pudiendo leer el bucket, la sigue viendo');

  // ========================================================= dejar de compartir
  await O.goto(APP + '#/playlist/pverano');
  await O.click('[data-act="pl-share"]');
  await O.waitForSelector('#sheet[open] [data-sh-member]');
  check(!(await O.innerText('#sheet .share-people')).includes('Ana'), 'Ana ya no aparece para compartir');
  await O.uncheck(`#sheet [data-sh-member="${beaId}"]`);
  await O.click('#sheet [data-ok]');
  check(await toastHas(O, /ya no está compartida/), 'Pablo deja de compartirla');
  await sync(B);
  check((await shared(B)).length === 0, 'Bea deja de verla');

  // ========================================================= nada de esto va a sitios equivocados
  const snapA = await ev(A, async () => JSON.stringify((await import('./js/sync.js')).snapshot(true)));
  check(!snapA.includes('Verano'), 'las playlists compartidas no se copian en la cuenta de quien las recibe');
  rows = await sql("select u.email from public.fiora_playlists p join auth.users u on u.id = p.user_id where p.name = 'Verano'");
  check(rows.length === 1 && rows[0].email === 'pablo@example.com', '«Verano» solo existe en la cuenta de Pablo');
  s = await oracle();
  check(!s.objects.some(([n, size]) => size > 0 && /datos|playlist|verano/i.test(n)), 'en el bucket no hay playlists');

  check(!errs.length, 'sin errores de página ' + errs.join(' | '));
  console.log(`\n${ok} correctas · ${fails} fallos`);
  process.exitCode = fails ? 1 : 0;
  await b.close();
})();
