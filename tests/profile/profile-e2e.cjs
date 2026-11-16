// Perfil, Ajustes dentro de Perfil y «Tu criatura sonora», de punta a punta con Playwright (escritorio
// y móvil), contra los mismos servidores que las demás pruebas: la app en :8765 y el emulador de
// Supabase en :8766 con las cuatro migraciones (ver README.md).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = process.env.APP || 'http://localhost:8765/';
const API = process.env.API || 'http://localhost:8766';
const SB = 'https://rabhgmnjvxwlttlviywc.supabase.co';
const FIX = path.join(__dirname, '..', 'playlists', 'fixtures', 'audio');
const SHOTS = process.env.SHOTS || '';
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };
const sql = async q => (await fetch(API + '/__sql', { method: 'POST', body: q })).json();
const DAY = 86400000;

// Perfiles sintéticos (los mismos patrones que creature-test.mjs), con fechas relativas a hoy.
const BASE = { p: 10, s: 2100, ls: 2400, dn: 8, sk: 1, h: [0, 0, 0, 1, 3, 4, 2, 0], rp: 8, nw: 0, na: 0, bk: 0, fa: 2, cs: 8, ax: 4, al: 1, lg: 0, dt: 10, da: 6, g: { Pop: 7, Rock: 3 }, ss: [25, 22] };
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const rot = i => { const h = Array(8).fill(0); h[[4, 5, 6][i % 3]] = 5; return h; };
function days(kind, n = 30) {
  const out = {};
  for (let i = 0; i < n; i += 2) {
    const d = { ...BASE, h: rot(i) };
    if (kind === 'buho' || kind === 'buho+zorro') d.h = [3, 1, 0, 0, 0, 0, 1, 5];
    if (kind === 'zorro' || kind === 'buho+zorro') Object.assign(d, { nw: 5, rp: 5, na: 2 });
    if (kind === 'few' && i > 0) continue;
    out[dayKey(new Date(Date.now() - i * DAY))] = d;
  }
  return out;
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const audio = fs.readdirSync(FIX).map(f => ({ name: f, mimeType: 'audio/wav', buffer: fs.readFileSync(path.join(FIX, f)) }));
  const until = async (page, fn, arg, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(150); } return false; };
  async function device(name, { mobile = false, files = true, opts = {}, init = null } = {}) {
    const ctx = await b.newContext({ ...(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 860 } }), acceptDownloads: true, ...opts });
    if (init) await ctx.addInitScript(init);
    await ctx.route(SB + '/**', async route => { try { await route.fulfill({ response: await route.fetch({ url: route.request().url().replace(SB, API) }) }); } catch { await route.abort('failed').catch(() => {}); } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|GPU stall|GL Driver Message/.test(m.text())) errs.push(`${name} consola: ${m.text()}`); });
    await page.goto(APP + '#/inicio'); await page.waitForSelector('#nav-links a');
    if (files) { await page.setInputFiles('#pick-files', audio); await until(page, async () => (await import('./js/store.js')).S.tracks.size >= 6); }
    return page;
  }
  const habitsReady = page => until(page, async () => { const h = await import('./js/habits.js'); const s = h.status(); return s.mode === 'ready' && !s.busy && !Object.keys(h.H.dirty).length && !h.H.stateDirty && !Object.keys(h.H.logDirty).length; });
  const login = async (page, email) => {
    await page.goto(APP + '#/ajustes');
    await page.fill('[data-form="login"] [name=email]', email); await page.fill('[data-form="login"] [name=password]', 'secreta123');
    await page.click('[data-form="login"] button[value="in"]');
    await until(page, async () => { const s = (await import('./js/playlists-data.js')).status(); return s.mode === 'ready' && !s.pending && !s.busy; });
    return until(page, async () => (await import('./js/habits.js')).status().mode === 'ready');
  };
  /** Pone un historial de hábitos sintético (y borra la criatura anterior) como si se hubiera escuchado así. */
  const seed = (page, kind, extra = {}) => page.evaluate(async ({ d, extra }) => {
    const h = await import('./js/habits.js');
    h.H.days = d; h.H.dirty = Object.fromEntries(Object.keys(d).map(k => [k, 1]));
    Object.assign(h.H, { official: null, cand: null, log: {}, logDirty: {}, cur: null }, extra);
    localStorage.removeItem('fiora.creature.seen');
  }, { d: days(kind), extra });
  const dbg = page => page.evaluate(() => globalThis.__fioraCreature()?.debug() || null);
  const sceneReady = (page, id) => until(page, id => { const c = globalThis.__fioraCreature(); return !!c && !c.morphing && (!id || c.debug().id === id); }, id, 20000);
  /** Píxeles con luz en el lienzo 3D (prueba de que se dibuja algo). */
  const litPixels = async page => {
    const png = await page.locator('.cr-canvas').screenshot();
    return page.evaluate(async b64 => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 330) n++; return n; }, png.toString('base64'));
  };
  const text = (page, sel) => page.innerText(sel).catch(() => '');

  // ======================================================================= A: escritorio
  const A = await device('A');

  // --- 1–2. Navegación
  const nav = await A.$$eval('#nav-links a', a => a.map(x => x.textContent.trim()));
  check(nav.includes('Perfil') && !nav.includes('Ajustes') && nav.length === 5, `1. La navegación principal tiene «Perfil» y no «Ajustes»: ${nav.join(' · ')}`);
  check(!!(await A.$('#nav-links a[data-nav="perfil"] svg')), '   Perfil lleva icono');
  await A.click('#nav-links a[data-nav="perfil"]'); await A.waitForSelector('.pf-id');
  check(await A.$eval('#nav-links a[data-nav="perfil"]', a => a.classList.contains('on')), '   Perfil queda marcado en la navegación');
  check(!!(await A.$('.head .pf-gear[aria-label="Ajustes"]')), '2. Perfil tiene el botón de Ajustes con engranaje en la cabecera');
  const order = await A.$$eval('.wrap > *', els => els.map(e => e.className || e.tagName).join(' | '));
  check(/pf-id.*pf-creature.*sx-head.*sx-tabs.*sx-body/s.test(order), '   Orden de Perfil: identidad, criatura y estadísticas');
  await A.click('.pf-gear'); await A.waitForSelector('.panel');
  check((await A.evaluate(() => location.hash)) === '#/ajustes' && await A.$eval('#nav-links a[data-nav="perfil"]', a => a.classList.contains('on')), '   El engranaje abre Ajustes (Perfil sigue marcado)');
  const panels = await A.$$eval('.panel > h2:first-child', h => h.map(x => x.textContent));
  check(['Cuenta', 'Nube', 'Este dispositivo', 'Modo desarrollador', 'Tu criatura sonora'].every(p => panels.includes(p)), `3. Ajustes conserva sus paneles: ${panels.join(' · ')}`);
  await A.click('.head a[aria-label="Volver al perfil"]'); await A.waitForSelector('.pf-id');
  check((await A.evaluate(() => location.hash)) === '#/perfil', '   Desde Ajustes se vuelve a Perfil');
  await A.goBack(); await A.waitForSelector('.panel');
  check((await A.evaluate(() => location.hash)) === '#/ajustes', '   El botón «atrás» del navegador conserva el historial');

  // --- 3. Un ajuste existente sigue guardándose
  await A.uncheck('[data-toggle="autoplay"]'); await A.waitForTimeout(300);
  await A.reload(); await A.waitForSelector('[data-toggle="autoplay"]');
  check(!(await A.isChecked('[data-toggle="autoplay"]')), '   «Reproducción automática» se desactiva y se conserva al recargar');
  await A.check('[data-toggle="autoplay"]');

  // --- 15. Datos insuficientes
  await A.goto(APP + '#/perfil'); await A.waitForSelector('.pf-creature');
  check(/tomando forma/i.test(await text(A, '.pf-creature')) && /0 de 15 escuchas/.test(await text(A, '.pf-creature')), '15. Sin historial: «Tu criatura está tomando forma», con el mínimo que falta');
  await sceneReady(A, 'nebula');
  check((await dbg(A))?.id === 'nebula' && (await litPixels(A)) > 300, '    y la escena es una nube de partículas sin silueta');
  check(/Sin sesión/.test(await text(A, '.pf-id')) && !!(await A.$('.pf-id a[href="#/ajustes"]')), '    Sin sesión, Perfil funciona y ofrece iniciar sesión');

  // --- 5/26. Reproducción real: se anota y no se corta al navegar
  await login(A, 'criatura@example.com');
  await A.goto(APP + '#/biblioteca'); await A.waitForSelector('.row');
  await A.click('.row');
  await until(A, async () => { const { P } = await import('./js/player.js'); return P.playing && P.audio.currentTime > 0.3; });
  const realDay = await until(A, async () => { const h = await import('./js/habits.js'); const d = Object.values(h.H.days)[0]; return !!d && d.p >= 1 && d.ls > 0; }, null, 60000);
  const rec = await A.evaluate(async () => { const h = await import('./js/habits.js'); return Object.values(h.H.days)[0]; });
  check(realDay && rec.h.reduce((a, x) => a + x, 0) === rec.p && rec.nw >= 1, `13. Una escucha real queda en el resumen del día: ${JSON.stringify(rec)}`);
  check(!('t' in rec) && !JSON.stringify(rec).match(/\.wav|Dakiti|despecha/i), '    El resumen no contiene canciones ni artistas');
  await A.evaluate(async () => { const { P } = await import('./js/player.js'); P.audio.loop = true; if (P.audio.paused) await P.audio.play(); });
  const playing = () => A.evaluate(async () => { const { P } = await import('./js/player.js'); return { on: !P.audio.paused, id: P.current?.id }; });
  const before = await playing();

  // --- 13/14. Criatura asignada a partir de las estadísticas
  await seed(A, 'buho');
  await A.goto(APP + '#/perfil'); await A.waitForSelector('.pf-creature [data-cr-name]');
  await until(A, () => document.querySelector('.pf-creature [data-cr-name]')?.textContent === 'Búho');
  const cardTxt = await text(A, '.pf-creature');
  const ind = await A.evaluate(async () => { const cd = await import('./js/creature-data.js'); const e = cd.evaluate('30'); return { night: Math.round(e.I.m.night * 100), primary: e.res.primary?.id, second: e.res.secondary?.id || '', dna: e.dna.map(d => [d.id, d.value]) }; });
  check(/Búho/.test(cardTxt) && /noctámbulo/i.test(cardTxt) && ind.primary === 'buho', '    Con escuchas nocturnas, la tarjeta de Perfil muestra el Búho');
  check(cardTxt.includes(`${ind.night} % de tus escuchas suenan entre las 21:00 y las 6:00`), `14. La explicación usa la misma cifra que la regla (${ind.night} %)`);
  await sceneReady(A, 'buho');
  const card = await dbg(A);
  check(card.id === 'buho' && card.count >= 3000 && (await litPixels(A)) > 500, `    La tarjeta lleva la figura 3D viva (${card.count} partículas)`);
  if (SHOTS) await A.screenshot({ path: `${SHOTS}/perfil-escritorio.png`, fullPage: false });

  // --- 4. Estadísticas actuales dentro de Perfil
  await A.evaluate(async () => { const st = await import('./js/store.js'); let i = 0; for (const t of st.S.tracks.values()) { st.S.stats[t.id] = { plays: 3 + i, last: Date.now(), done: 2, h: [0, 1, 1, 1 + i] }; i++; } const k = new Date(); st.S.hist.days[`${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, '0')}-${String(k.getDate()).padStart(2, '0')}`] = [20, 3600]; st.S.hist.hours[22] = 12; st.S.hist.week[2] = 9; await st.saveKV('stats'); await st.saveKV('hist'); });
  await A.goto(APP + '#/perfil'); await A.waitForSelector('.stat-row.tiles');
  const stats = await A.evaluate(() => ({ tiles: document.querySelectorAll('.stat-row.tiles .stat').length, cols: document.querySelectorAll('.chart .cols').length, bars: document.querySelectorAll('.hbars').length, heads: [...document.querySelectorAll('.panel > h2')].map(h => h.textContent), data: document.querySelectorAll('details.glist').length }));
  check(stats.tiles === 6 && stats.cols >= 2 && stats.bars >= 3 && ['Últimos 30 días', 'A qué hora escuchas', 'Qué días', 'Tus artistas', 'Tus canciones'].every(h => stats.heads.includes(h)) && stats.data >= 2,
    `4. Perfil conserva todas las estadísticas: ${stats.tiles} mosaicos, ${stats.cols} gráficos de columnas, ${stats.bars} de barras y «Ver los datos»`);
  let tipOk = false;
  for (let i = 0; i < 5 && !tipOk; i++) { await A.mouse.move(5, 5); await A.hover('.chart .col:last-child'); tipOk = await A.evaluate(() => !document.querySelector('#tip').hidden && /min/.test(document.querySelector('#tip').textContent)); }
  check(tipOk, '   Las etiquetas flotantes de los gráficos siguen funcionando');
  await A.goto(APP + '#/estadisticas'); await A.waitForSelector('.stat-row.tiles');
  check(!!(await A.$('.pf-id')) && await A.$eval('#nav-links a[data-nav="perfil"]', a => a.classList.contains('on')), '   El enlace antiguo #/estadisticas abre Perfil en sus estadísticas');
  check((await A.$$eval('.pf-evo', a => a.map(x => x.getAttribute('href')))).join() === '#/criatura/adn,#/criatura,#/criatura/evolucion,#/criatura/constelacion', '   «Mi evolución musical» da acceso a ADN, secundario, bestiario y constelación');

  // --- Experiencia completa
  await A.goto(APP + '#/perfil'); await A.waitForSelector('.pf-creature a.btn.primary');
  await A.click('.pf-creature a.btn.primary'); await A.waitForSelector('.cr-stage');
  await sceneReady(A, 'buho');
  const full = await dbg(A);
  check((await A.evaluate(() => location.hash)) === '#/criatura' && full.id === 'buho' && full.count > card.count, `7. La experiencia abre el Búho a pantalla completa con más partículas (${full.count})`);
  const box = await A.locator('.cr-stage').boundingBox(), vw = await A.evaluate(() => [document.querySelector('#view').clientWidth, document.querySelector('#view').clientHeight]);
  check(box.height >= vw[1] - 2 && box.width > vw[0] * 0.55, '   La escena ocupa toda la altura de la vista');
  const bodyTxt = await text(A, '.cr-body');
  ind.night = await A.evaluate(async () => Math.round((await import('./js/creature-data.js')).evaluate('30').I.m.night * 100));
  if (!/Puntuación \d+\/100/.test(bodyTxt) || !bodyTxt.includes(`${ind.night} %`)) console.log('CUERPO', ind.night, bodyTxt.slice(0, 500));
  check(/Eres el Búho/.test(bodyTxt) && /¿Por qué soy este animal\?/.test(bodyTxt) && [ind.night - 1, ind.night, ind.night + 1].some(n => bodyTxt.includes(`${n} % de tus escuchas suenan`)) && /Puntuación \d+\/100/.test(bodyTxt), '11. Explicación personalizada con «¿Por qué soy este animal?» y el desglose de la puntuación');
  check(/Sin animal secundario/.test(bodyTxt) && ind.second === '', '16. Sin otro patrón con evidencia, no se muestra animal secundario');
  check(/no un perfil psicológico/.test(bodyTxt), '    Se dice que es una interpretación artística, no un perfil psicológico');
  check(full.habitat === 'stars', '    El búho tiene su hábitat (estrellas)');

  // --- 8, 11. Partículas y cursor
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await until(A, () => globalThis.__fioraCreature().debug().displaced < 10);   // la figura ya se ha formado
  await A.mouse.move(cx - 60, cy - 20); await A.mouse.move(cx - 20, cy, { steps: 6 }); await A.mouse.move(cx + 10, cy + 10, { steps: 6 });
  await A.waitForTimeout(350);
  const pushed = (await dbg(A)).displaced;
  check(pushed > 80, `8. Las partículas cercanas al cursor se apartan (${pushed} desplazadas de ${full.drawn})`);
  check(pushed < full.drawn * 0.7, `   y las alejadas se quedan en su sitio (${full.drawn - pushed} sin moverse)`);
  await A.mouse.move(box.x + 5, box.y + box.height - 5); await A.mouse.move(box.x - 30, box.y + box.height + 30);
  const trail = [];
  for (let i = 0; i < 14; i++) { await A.waitForTimeout(220); trail.push((await dbg(A)).displaced); }
  check(trail[0] > 0 && trail[trail.length - 1] < 8 && trail.some((v, i) => i > 0 && v > 0 && v < trail[0]), `11. Vuelven poco a poco a su sitio, no de golpe: ${trail.join(' → ')}`);
  // atracción
  await A.click('[data-act="cr-ctl"][data-c="mode"]');
  check((await dbg(A)).mode === 'attract', '    Se puede cambiar a atracción');
  await A.mouse.move(cx - 30, cy); await A.mouse.move(cx, cy + 5, { steps: 5 }); await A.waitForTimeout(350);
  check((await dbg(A)).displaced > 30, '    En modo atracción también reaccionan');
  await A.click('[data-act="cr-ctl"][data-c="mode"]'); await A.mouse.move(box.x - 30, box.y + 300);

  // --- 10. Girar, acercar, restablecer
  const y0 = (await dbg(A)).yaw;
  await A.mouse.move(cx, cy); await A.mouse.down(); await A.mouse.move(cx + 160, cy + 40, { steps: 8 }); await A.mouse.up();
  const r1 = await dbg(A);
  check(Math.abs(r1.yaw - y0) > 0.8 && Math.abs(r1.pitch) <= 0.96, `10. Arrastrar gira la figura (de ${y0.toFixed(2)} a ${r1.yaw.toFixed(2)} rad) con la inclinación limitada`);
  check((await litPixels(A)) > 800, '    Sigue viéndose tras girarla');
  await A.mouse.move(cx, cy); await A.mouse.wheel(0, -400); await A.waitForTimeout(200);
  const z1 = (await dbg(A)).zoom;
  await A.click('[data-c="out"]'); const z2 = (await dbg(A)).zoom;
  await A.click('[data-c="left"]'); const r2 = await dbg(A);
  check(z1 > 1.05 && z2 < z1 && r2.yaw < r1.yaw, '    Rueda y botones acercan, alejan y giran (alternativa a los gestos)');
  await A.click('[data-c="reset"]'); const r3 = await dbg(A);
  check(r3.zoom === 1 && Math.abs(r3.yaw - y0) < 0.6, '    «Restablecer la vista» vuelve al encuadre inicial');

  // --- 22. Pausar animaciones y hábitat
  await A.mouse.move(box.x - 30, box.y + 300); await A.click('[data-c="anim"]'); await A.waitForTimeout(3500);
  const paused = await dbg(A);
  check(paused.anim === false && paused.running === false, '22. Se pueden pausar las animaciones (y el bucle de dibujo se detiene)');
  await A.click('[data-c="anim"]'); check((await dbg(A)).anim === true, '    y reanudarlas');
  await A.click('[data-c="hab"]'); check((await dbg(A)).habitat === '', '    El hábitat se puede quitar');
  await A.click('[data-c="hab"]'); check((await dbg(A)).habitat === 'stars', '    y volver a mostrar');

  // --- 26. La música sigue
  const mid = await playing();
  check(before.on && mid.on && mid.id === before.id, '26. La música no se ha cortado entre Biblioteca, Perfil y la criatura');

  // --- 9 (audio). Reacción al sonido real con una canción descargada
  await until(A, () => /volumen real/.test(document.querySelector('[data-cr-sound]')?.textContent || ''), null, 15000);
  const snd = await dbg(A);
  check(snd.energy && /Reacciona al volumen real/.test(await text(A, '[data-cr-sound]')), '    Con una canción descargada, la figura reacciona al volumen real del archivo');

  // --- 17. ADN musical
  await A.click('.cr-tabs a[href="#/criatura/adn"]'); await A.waitForSelector('.dna');
  ind.dna = await A.evaluate(async () => (await import('./js/creature-data.js')).evaluate('30').dna.map(d => [d.id, d.value]));
  const dnaDom = await A.$$eval('[data-dna]', els => els.map(e => [e.dataset.dna, e.textContent.trim() === '—' ? null : parseInt(e.textContent, 10)]));
  check(dnaDom.length === 7 && JSON.stringify(dnaDom) === JSON.stringify(ind.dna), `17. El ADN musical muestra los valores calculados: ${dnaDom.map(d => `${d[0]} ${d[1] ?? '—'}`).join(', ')}`);
  check(dnaDom.find(d => d[0] === 'geografia')[1] === null, '    Una dimensión sin datos se muestra como «—», no como 0');
  await A.click('.dna summary');
  check(/se calcula|Parte de tus escuchas/i.test(await text(A, '.dna[open] .dna-how')) && !!(await A.$('.dna[open] table.data')), '    Cada indicador abre su explicación y sus cifras');
  await A.selectOption('[data-cr-period]', '7'); await A.waitForTimeout(500);
  const dna7 = await A.evaluate(async () => (await import('./js/creature-data.js')).evaluate('7').dna.map(d => [d.id, d.value]));
  const dom7 = await A.$$eval('[data-dna]', els => els.map(e => [e.dataset.dna, e.textContent.trim() === '—' ? null : parseInt(e.textContent, 10)]));
  check(JSON.stringify(dom7) === JSON.stringify(dna7), '    Al cambiar el período, los valores se recalculan');
  await A.selectOption('[data-cr-period]', '30'); await A.waitForTimeout(400);
  check((await playing()).on, '12. La app sigue respondiendo y sonando con la escena animada');

  // --- 6/7. Las 15 criaturas en 3D
  await A.click('.cr-tabs a[href="#/criatura/evolucion"]'); await A.waitForSelector('.cr-all');
  const ids = await A.$$eval('.cr-animal', a => a.map(x => x.dataset.id));
  const seen = [];
  for (const id of ids) {
    await A.click(`.cr-animal[data-id="${id}"]`); await A.waitForTimeout(350);
    await sceneReady(A, id);
    await A.evaluate(() => globalThis.__fioraCreature().resetView()); await A.waitForTimeout(900);
    const d = await dbg(A);
    seen.push([id, d.id === id, await litPixels(A), d.habitat]);
    if (SHOTS) await A.locator('.cr-stage').screenshot({ path: `${SHOTS}/animal-${id}.png` });
  }
  check(ids.length === 15 && seen.every(s => s[1] && s[2] > 800), `7. Las 15 criaturas se dibujan en 3D: ${seen.map(s => `${s[0]} ${s[2]}`).join(', ')}`);
  check(new Set(seen.map(s => s[3])).size >= 8, `   con hábitats distintos (${[...new Set(seen.map(s => s[3]))].join(', ')})`);
  await A.click('.cr-tabs a[href="#/criatura"]'); await A.waitForSelector('.cr-preview');
  check(/Estás viendo otra criatura/.test(await text(A, '.cr-body')), '   Al mirar otra criatura se avisa de que no es la tuya');
  await A.click('.cr-preview [data-act="cr-preview"]'); await sceneReady(A, 'buho');

  // --- 16/12. Animal secundario
  await seed(A, 'buho+zorro');
  await A.goto(APP + '#/inicio'); await A.waitForSelector('.wrap'); await A.goto(APP + '#/criatura'); await A.waitForSelector('.cr-second'); await sceneReady(A);
  const pair = await A.evaluate(async () => { const o = (await import('./js/habits.js')).H.official; return [o.a, o.b]; });
  check(pair.includes('buho') && pair.includes('zorro') && (await text(A, '.cr-second')).length > 5, `16. Con dos patrones marcados aparece el secundario: ${pair.join(' + ')}`);
  await A.click('.cr-second'); await A.waitForTimeout(300);
  const morphSeen = await until(A, () => globalThis.__fioraCreature().morphing, null, 3000);
  await sceneReady(A, pair[1]);
  check(morphSeen && (await dbg(A)).id === pair[1], '12. Tocar el secundario lo muestra en 3D con una transición de partículas');

  // --- 18. Metamorfosis
  const d1 = dayKey(new Date(Date.now() - DAY)), d2 = dayKey(new Date(Date.now() - 2 * DAY));
  await seed(A, 'zorro', { official: { a: 'buho', b: '', score: 60, since: Date.now() - 20 * DAY, evalDay: d1 }, cand: { id: 'zorro', days: [d2, d1] }, log: {} });
  await A.evaluate(() => localStorage.setItem('fiora.creature.seen', 'buho'));
  await A.goto(APP + '#/inicio'); await A.waitForSelector('.wrap'); await A.goto(APP + '#/criatura');
  const stages = new Set();
  for (let i = 0; i < 60; i++) { const d = await dbg(A); if (d) { stages.add(`${d.morph}`); if (d.id === 'zorro' && d.morph === -1 && stages.size > 1) break; } await A.waitForTimeout(120); }
  const off = await A.evaluate(async () => (await import('./js/habits.js')).H.official);
  check(off.a === 'zorro' && off.from === 'buho', '18. Tras el tercer día por delante, la criatura oficial pasa del Búho al Zorro');
  check(['0', '1', '2'].every(s => stages.has(s)) && (await dbg(A)).id === 'zorro', `    La metamorfosis recorre sus fases con las partículas (pulsos, dispersión y viaje): ${[...stages].join(',')}`);
  check(/Metamorfosis: del Búho al Zorro/.test(await text(A, '#toasts')), '    y se anuncia');
  await A.click('.cr-tabs a[href="#/criatura/evolucion"]'); await A.waitForSelector('.best');
  const best = await text(A, '.cr-best');
  check(/Zorro/.test(best) && /Metamorfosis: del Búho al Zorro/.test(best) && /canciones nuevas|canción nueva/.test(best), '    El bestiario explica el cambio y sus cifras');
  check(/3 días distintos/.test(await text(A, '.cr-body')), '    y se explica el criterio que evita oscilaciones');
  await A.click('[data-act="cr-replay"]');
  check(await until(A, () => globalThis.__fioraCreature().morphing, null, 4000), '    La metamorfosis se puede repetir');
  await sceneReady(A, 'zorro');

  // --- Constelación
  await A.click('.cr-tabs a[href="#/criatura/constelacion"]'); await A.waitForSelector('.cr-stars');
  await until(A, () => (globalThis.__fioraCreature()?.debug().stars || 0) > 0);
  const nStars = (await dbg(A)).stars, listed = await A.$$eval('.cr-stars button', x => x.length);
  check(nStars >= 4 && nStars === listed, `    Constelación musical: ${nStars} recuerdos como estrellas y como lista accesible`);
  const pts = await A.evaluate(() => globalThis.__fioraCreature().starScreen());
  await A.mouse.click(pts[1].x, pts[1].y); await A.waitForSelector('[data-cr-memory]');
  const memTxt = await text(A, '[data-cr-memory]');
  const mem1 = await A.evaluate(async () => (await import('./js/creature-data.js')).memories()[1]);
  check(memTxt.includes(mem1.title), `    Tocar una estrella abre su tarjeta con datos reales: ${mem1.kind} · ${mem1.title}`);
  await A.click('.cr-stars li:first-child button'); await A.waitForTimeout(400);
  check(/Canción más reproducida/i.test(await text(A, '[data-cr-memory]')), '    y también desde la lista');

  // --- Exportar
  await A.click('.cr-tabs a[href="#/criatura"]'); await A.waitForSelector('[data-act="cr-share"]'); await sceneReady(A, 'zorro');
  await A.click('[data-act="cr-share"]'); await A.waitForSelector('.cr-share');
  check((await A.$$eval('.cr-share input[type=checkbox]', c => c.filter(x => x.checked).length)) === 0, '    Al compartir, ninguna estadística va marcada por defecto');
  await A.fill('[data-sh-alias]', 'Pablo'); await A.check('[data-sh-stat="0"]');
  const [dl] = await Promise.all([A.waitForEvent('download', { timeout: 15000 }), A.click('.cr-share [data-ok]')]);
  const file = await dl.path(), size = fs.statSync(file).size, sig = fs.readFileSync(file).subarray(1, 4).toString();
  check(dl.suggestedFilename() === 'fiora-zorro.png' && sig === 'PNG' && size > 30000, `    Se exporta una imagen PNG en el dispositivo (${Math.round(size / 1024)} KB), sin subir nada`);
  if (SHOTS) fs.copyFileSync(file, `${SHOTS}/tarjeta-exportada.png`);
  if (SHOTS) { await A.screenshot({ path: `${SHOTS}/criatura-escritorio.png` }); }

  // --- 19/20. Supabase
  await A.evaluate(async () => { await (await import('./js/habits.js')).sync(); });
  check(await habitsReady(A), '20. Los resúmenes, el historial y la criatura se suben a Supabase');
  const rows = (await sql(`select (select count(*) from fiora_habit_days) d, (select count(*) from fiora_creature_log) l, (select data->'official'->>'a' from fiora_creature_state limit 1) a`))[0];
  check(+rows.d >= 15 && +rows.l === 1 && rows.a === 'zorro', `    En la base: ${rows.d} días, ${rows.l} mes de historial, criatura «${rows.a}»`);
  const leak = (await sql(`select count(*) n from fiora_habit_days where data::text ~* 'wav|dakiti|despecha|example.com'`))[0];
  check(+leak.n === 0, '    Lo guardado no contiene canciones, artistas ni correos');

  // ======================================================================= B: móvil, misma cuenta
  const B = await device('B', { mobile: true, files: false });
  await login(B, 'criatura@example.com');
  await until(B, async () => Object.keys((await import('./js/habits.js')).H.days).length >= 15);
  await B.goto(APP + '#/perfil'); await B.waitForSelector('.pf-creature [data-cr-name]');
  await until(B, () => document.querySelector('.pf-creature [data-cr-name]')?.textContent === 'Zorro');
  check((await text(B, '.pf-creature [data-cr-name]')) === 'Zorro', '19. Otro dispositivo recupera la misma criatura');
  const sw = await B.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  check(sw[0] <= sw[1] + 1, '24. Perfil cabe en el móvil sin desplazamiento horizontal');
  if (SHOTS) await B.screenshot({ path: `${SHOTS}/perfil-movil.png` });
  await B.waitForSelector('.cr-canvas');
  check(await B.$eval('.cr-canvas', c => getComputedStyle(c).touchAction) === 'pan-y', '    En la tarjeta, deslizar en vertical sigue desplazando la página');
  await B.goto(APP + '#/criatura/evolucion'); await B.waitForSelector('.best');
  check(/Metamorfosis: del Búho al Zorro/.test(await text(B, '.cr-best')), '    y su historial (bestiario) con la metamorfosis');
  await B.goto(APP + '#/criatura'); await B.waitForSelector('.cr-stage'); await sceneReady(B, 'zorro');
  const mb = await B.locator('.cr-stage').boundingBox(), mp = await B.locator('.cr-panel').boundingBox();
  check(mb.width >= 388 && mp.y >= mb.y + mb.height - 2 && mp.height > 200, '24. En el móvil: escena arriba y panel debajo');
  // 9. Tacto
  let maxTouch = 0;
  await B.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height / 2);
  for (let i = 0; i < 8; i++) { maxTouch = Math.max(maxTouch, (await dbg(B)).displaced); await B.waitForTimeout(60); }
  check(maxTouch > 30, `9. Tocar la figura con el dedo mueve sus partículas (${maxTouch})`);
  check(await B.$eval('.cr-canvas', c => getComputedStyle(c).touchAction) === 'none' && !!(await B.$('[data-c="tool"]')), '   A pantalla completa los gestos son de la figura, con botón para girar con un dedo');
  const yb = (await dbg(B)).yaw; await B.tap('[data-c="right"]');
  check((await dbg(B)).yaw > yb, '   y los botones permiten girarla sin gestos');
  if (SHOTS) await B.screenshot({ path: `${SHOTS}/criatura-movil.png` });

  // ======================================================================= C: otra cuenta (RLS)
  const Cc = await device('C', { files: false });
  await login(Cc, 'otra@example.com');
  const other = await Cc.evaluate(async () => { const acc = await import('./js/account.js'); const r = await acc.authFetch('/rest/v1/rpc/fiora_creature_load', { method: 'POST', json: { since: 0 } }); return r.json(); });
  check(Object.keys(other.days).length === 0 && Object.keys(other.log).length === 0 && !other.state.official, '21. Otra cuenta no recibe nada de la criatura de la primera');
  await Cc.goto(APP + '#/perfil'); await Cc.waitForSelector('.pf-creature');
  check(/tomando forma/i.test(await text(Cc, '.pf-creature')), '    y su perfil empieza sin criatura');

  // ======================================================================= Sin WebGL y con «reducir movimiento»
  const D = await device('D', { files: false, init: () => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : g.call(this, t, ...a); }; } });
  await login(D, 'criatura@example.com');
  await until(D, async () => Object.keys((await import('./js/habits.js')).H.days).length >= 15);
  await D.goto(APP + '#/criatura'); await D.waitForSelector('.cr-canvas.static', { timeout: 20000 });
  check(await D.$eval('[data-creature="full"]', e => e.dataset.mode) === 'static' && /Eres el Zorro/.test(await text(D, '.cr-body')) && /¿Por qué soy este animal\?/.test(await text(D, '.cr-body')),
    '23. Sin WebGL: silueta estática y la misma explicación y estadísticas');
  check((await D.$eval('.cr-canvas.static', c => c.getAttribute('aria-label'))) === 'Silueta del Zorro', '    con texto alternativo');
  const E = await device('E', { files: false, opts: { reducedMotion: 'reduce' } });
  await E.goto(APP + '#/criatura/evolucion'); await E.waitForSelector('.cr-all'); await sceneReady(E);
  check((await dbg(E)).anim === false, '22. Con «reducir movimiento» del sistema, la figura no se anima sola');

  // ======================================================================= Privacidad
  await A.goto(APP + '#/ajustes'); await A.waitForSelector('#ajustes-criatura');
  check(/resumen por día/.test(await text(A, '#ajustes-criatura')) && /No guarda qué canciones/.test(await text(A, '#ajustes-criatura')), '    Ajustes explica qué datos usa la criatura');
  await A.uncheck('[data-cr-pref="on"]'); await A.waitForTimeout(400);
  await A.goto(APP + '#/perfil'); await A.waitForSelector('.pf-creature.off');
  const nBefore = await A.evaluate(async () => JSON.stringify((await import('./js/habits.js')).H.days));
  await A.evaluate(async () => { const st = await import('./js/store.js'); st.countPlay([...st.S.tracks.keys()][2]); });
  await A.waitForTimeout(300);
  check((await A.evaluate(async () => JSON.stringify((await import('./js/habits.js')).H.days))) === nBefore && !!(await A.$('.stat-row.tiles')), '    Desactivada: no se anota nada para ella y las estadísticas siguen en Perfil');
  await A.click('[data-act="cr-enable"]'); await A.waitForSelector('.pf-creature:not(.off)');

  // --- 27. Eliminar los datos de la criatura
  const plays0 = await A.evaluate(async () => Object.values((await import('./js/store.js')).S.stats).reduce((n, s) => n + s.plays, 0));
  await A.goto(APP + '#/ajustes'); await A.waitForSelector('[data-act="cr-erase"]');
  await A.click('[data-act="cr-erase"]'); await A.waitForSelector('#sheet .dlg'); await A.click('#sheet .dlg .btn.danger, #sheet .dlg .btn.primary');
  await until(A, () => /eliminados/.test(document.querySelector('#toasts').innerText));
  const after = await A.evaluate(async () => { const h = await import('./js/habits.js'), st = await import('./js/store.js'); return { days: Object.keys(h.H.days).length, log: Object.keys(h.H.log).length, off: h.H.official, plays: Object.values(st.S.stats).reduce((n, s) => n + s.plays, 0), pls: st.S.playlists.length }; });
  const db = (await sql(`select (select count(*) from fiora_habit_days) d, (select count(*) from fiora_creature_log) l, (select count(*) from fiora_playlists) pl, (select count(*) from fiora_creature_state where (data->>'resetAt')::float8 > 0) r`))[0];
  check(after.days === 0 && after.log === 0 && !after.off && +db.d === 0 && +db.l === 0, '27. «Eliminar los datos de la criatura» borra resúmenes e historial, aquí y en Supabase');
  check(after.plays === plays0 && plays0 > 0 && +db.pl >= 1 && after.pls >= 1, `    y no toca las estadísticas generales (${after.plays} escuchas), las playlists ni los datos de la cuenta`);
  await B.evaluate(async () => { await (await import('./js/habits.js')).sync(); });
  await until(B, async () => Object.keys((await import('./js/habits.js')).H.days).length === 0);
  await B.evaluate(async () => { await (await import('./js/habits.js')).sync(); }); await B.waitForTimeout(500);
  check((await B.evaluate(async () => Object.keys((await import('./js/habits.js')).H.days).length)) === 0 && +(await sql('select count(*) n from fiora_habit_days'))[0].n === 0, '    El otro dispositivo también los olvida y no los vuelve a subir');

  // --- 25. Consola
  check(errs.length === 0, `25. Sin errores en consola${errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''}`);

  console.log(`\n${ok} comprobaciones correctas, ${fails} fallos`);
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
