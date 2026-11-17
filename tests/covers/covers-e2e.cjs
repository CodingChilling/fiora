// Portadas que faltan (modo desarrollador), de punta a punta con Playwright: la IA identifica el
// disco de cada canción, la imagen sale de MusicBrainz / Cover Art Archive, se escribe en el
// archivo (MP3 y FLAC) y se sube a la nube junto con los metadatos.
// La IA (servicio compatible con OpenAI), MusicBrainz y el Cover Art Archive se simulan aquí con
// las respuestas de sus API. Necesita la app en :8765, el emulador de Supabase en :8766 y el de
// Oracle en :8769 (ver README.md), y ffmpeg para crear los archivos de prueba.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = process.env.APP || 'http://localhost:8765/';
const API = process.env.API || 'http://localhost:8766';
const ORACLE = process.env.ORACLE || 'http://localhost:8769';
const SB = 'https://rabhgmnjvxwlttlviywc.supabase.co';
const OWNER_PAR = `${ORACLE}/p/dueno/n/ns/b/musica/o/`;
const KEYS = path.join(__dirname, '..', 'sharing', 'fixtures');
const AI = 'https://ia.prueba/v1';
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

// --- archivos de prueba
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fiora-portadas-'));
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
function song(file, tags, freq) {
  const meta = Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  const out = path.join(TMP, file);
  ff('-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=3`, ...meta, ...(file.endsWith('.mp3') ? ['-id3v2_version', '3'] : []), out);
  return fs.readFileSync(out);
}
const FILES = {
  'Bad Bunny/YHLQMDLG/Bad Bunny - Safaera.mp3': song('a.mp3', { title: 'Safaera', artist: 'Bad Bunny', album: 'YHLQMDLG (Deluxe)' }, 300),
  'Bad Bunny/YHLQMDLG/Bad Bunny - Yo Perreo Sola.mp3': song('b.mp3', { title: 'Yo Perreo Sola', artist: 'Bad Bunny' }, 350),
  'Rosalía/MOTOMAMI/Rosalía - Saoko.flac': song('c.flac', { title: 'Saoko', artist: 'Rosalía', album: 'Motomami' }, 400),
  'Varios/Track 01.flac': song('d.flac', { title: 'Track 01' }, 450),
  'Rosalía/Demos 2019/Rosalía - Maqueta B.flac': song('e.flac', { title: 'Maqueta B', artist: 'Rosalía', album: 'Demos 2019' }, 500),
};
ff('-f', 'lavfi', '-i', 'color=c=0xd2501e:s=600x600', '-frames:v', '1', path.join(TMP, 'portada.jpg'));
const JPG = fs.readFileSync(path.join(TMP, 'portada.jpg'));
// Otra canción del mismo álbum que ya trae su portada dentro del archivo
song('f0.flac', { title: 'Maqueta A', artist: 'Rosalía', album: 'Demos 2019' }, 550);
ff('-f', 'lavfi', '-i', 'color=c=0x1e8cd2:s=300x300', '-frames:v', '1', path.join(TMP, 'demo.jpg'));
ff('-i', path.join(TMP, 'f0.flac'), '-i', path.join(TMP, 'demo.jpg'), '-map', '0', '-map', '1', '-c', 'copy', '-disposition:v', 'attached_pic', path.join(TMP, 'f.flac'));
FILES['Rosalía/Demos 2019/Rosalía - Maqueta A.flac'] = fs.readFileSync(path.join(TMP, 'f.flac'));

// --- lo que contestarían la IA y MusicBrainz
const KNOWN = {
  safaera: { album: 'YHLQMDLG', artist: 'Bad Bunny', year: 2020 },
  'yo perreo sola': { album: 'YHLQMDLG', artist: 'Bad Bunny', year: 2020 },
  saoko: { album: 'MOTOMAMI', artist: 'ROSALÍA', year: 2022 },
  'despecha': { album: 'MOTOMAMI +', artist: 'ROSALÍA', year: 2022 },      // en MusicBrainz sin portada
};
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const GROUPS = [
  { id: 'rg-yhlq', title: 'YHLQMDLG', score: 100, 'artist-credit': [{ name: 'Bad Bunny', artist: { name: 'Bad Bunny' } }] },
  { id: 'rg-falso', title: 'YHLQMDLG', score: 95, 'artist-credit': [{ name: 'Otro Artista', artist: { name: 'Otro Artista' } }] },   // mismo título, otro artista: no vale
  { id: 'rg-moto', title: 'MOTOMAMI', score: 100, 'artist-credit': [{ name: 'ROSALÍA', artist: { name: 'ROSALÍA' } }] },
  { id: 'rg-motoplus', title: 'MOTOMAMI +', score: 100, 'artist-credit': [{ name: 'ROSALÍA', artist: { name: 'ROSALÍA' } }] },
];

(async () => {
  await fetch(ORACLE + '/__reset');
  for (const [name, buf] of Object.entries(FILES)) await fetch(OWNER_PAR + name.split('/').map(encodeURIComponent).join('/'), { method: 'PUT', body: buf });
  const b = await chromium.launch();
  const errs = [], aiCalls = [], mbCalls = [], caaCalls = [], appleCalls = [], artCalls = [];
  let aiFail = false;
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(SB + '/**', async route => { try { await route.fulfill({ response: await route.fetch({ url: route.request().url().replace(SB, API) }) }); } catch { await route.abort('failed').catch(() => {}); } });
  await ctx.route(AI + '/**', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    aiCalls.push(body);
    if (aiFail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'caído' } }) });
    const songs = JSON.parse(body.messages.find(m => m.role === 'user').content).canciones;
    const out = songs.map(s => { const k = KNOWN[norm(s.titulo)]; return k ? { i: s.i, known: true, ...k } : { i: s.i, known: false, album: '', artist: '', year: 0 }; });
    route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ songs: out }) }, finish_reason: 'stop' }] }) });
  });
  await ctx.route('https://musicbrainz.org/**', route => {
    const u = new URL(route.request().url());
    mbCalls.push({ at: Date.now(), path: u.pathname, query: u.searchParams.get('query') || '' });
    const qy = u.searchParams.get('query') || '';
    const byArtist = /^artist:/.test(qy);    // otros discos del artista
    const groups = !u.pathname.includes('release-group') ? [] : byArtist
      ? (/"Otro"/.test(qy) ? [{ id: 'rg-otro', title: 'Disco de Otro', 'primary-type': 'Album', score: 100, 'artist-credit': [{ name: 'Otro', artist: { name: 'Otro' } }] }] : [])
      : GROUPS.filter(g => qy.toLowerCase().includes(`"${g.title.toLowerCase().replace(/[+]/g, '\\+')}"`));
    route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(u.pathname.includes('recording') ? { recordings: [] } : { 'release-groups': groups }) });
  });
  // Apple (iTunes Search API): conoce YHLQMDLG; MOTOMAMI y el resto no, así que van a MusicBrainz.
  const appleRoutes = async c => {
    await c.route('https://itunes.apple.com/**', route => {
      const u = new URL(route.request().url());
      appleCalls.push({ at: Date.now(), term: u.searchParams.get('term'), entity: u.searchParams.get('entity') });
      const ent = u.searchParams.get('entity'), term = u.searchParams.get('term');
      const hit = ent === 'album' && /YHLQMDLG/i.test(term);
      const song = ent === 'song' && /Bad Bunny Yo Perreo Sola/i.test(term);
      const results = song ? [{ trackName: 'Yo Perreo Sola', collectionName: 'YHLQMDLG', artistName: 'Bad Bunny', collectionId: 2, artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/yhlq/100x100bb.jpg' }] : hit ? [
        { collectionId: 1, collectionName: 'YHLQMDLG', artistName: 'Otro Artista', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/falso/100x100bb.jpg' },   // otro artista: no vale
        { collectionId: 2, collectionName: 'YHLQMDLG', artistName: 'Bad Bunny', trackCount: 20, artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/yhlq/100x100bb.jpg' },
      ] : [];
      route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ resultCount: results.length, results }) });
    });
    await c.route('https://is1-ssl.mzstatic.com/**', route => {
      artCalls.push(new URL(route.request().url()).pathname);
      route.fulfill({ contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' }, body: JPG });
    });
  };
  await appleRoutes(ctx);
  await ctx.route('https://coverartarchive.org/**', route => {
    const u = new URL(route.request().url());
    caaCalls.push(u.pathname);
    if (/rg-(yhlq|moto|otro)\/front-500$/.test(u.pathname)) return route.fulfill({ contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' }, body: JPG });
    route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  // El emulador de Oracle es http y la app solo admite imágenes https (como el Oracle real): eso no es un error de la app.
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|img-src[\s\S]*|localhost:8769/.test(m.text())) errs.push(`consola: ${m.text()}`); });
  const until = async (fn, arg, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
  const tracks = () => page.evaluate(async () => [...(await import('./js/store.js')).S.tracks.values()].map(t => ({ title: t.title, coverId: t.coverId || '', tried: !!t.coverTried, source: t.coverSource || '', cloud: t.cloudName || '' })));

  // --- cuenta, bucket con su clave de API, modo desarrollador y la IA de los géneros
  await page.goto(APP + '#/ajustes'); await page.waitForSelector('[data-form="login"]');
  await page.fill('[data-form="login"] [name=email]', 'portadas@example.com'); await page.fill('[data-form="login"] [name=password]', 'secreta123');
  await page.click('[data-form="login"] button[value="in"]');
  await until(async () => !!(await import('./js/account.js')).user());
  await page.goto(APP + '#/ajustes');
  if (await page.$('details.more summary')) await page.click('details.more summary');
  await page.fill('[data-form="par"] [name=name]', 'Mi música'); await page.fill('[data-form="par"] [name=url]', OWNER_PAR);
  await page.click('[data-form="par"] button');
  await until(async () => (await import('./js/store.js')).S.tracks.size >= 9, null, 30000);
  await page.goto(APP + '#/ajustes');
  await page.click('details.key-steps summary');
  await page.fill('[data-form="oci"] textarea', fs.readFileSync(path.join(KEYS, 'config.txt'), 'utf8'));
  await page.setInputFiles('[data-form="oci"] [name=pem]', path.join(KEYS, 'key.pem'));
  await page.click('[data-form="oci"] button');
  await page.waitForSelector('[data-form="share"]', { timeout: 15000 });
  await page.evaluate(async ai => {
    const { S, saveKV } = await import('./js/store.js');
    S.settings.dev = true;
    S.settings.ai = { provider: 'custom', url: ai, keys: {}, models: { custom: 'modelo-de-prueba' }, lists: {} };
    await saveKV('settings', false);
  }, AI);
  await page.goto(APP + '#/inicio'); await page.goto(APP + '#/ajustes'); await page.waitForSelector('[data-act="ai-covers"]');
  let all = await tracks();
  const without = all.filter(t => !t.coverId).length;
  const btn = await page.innerText('[data-act="ai-covers"]');
  check(new RegExp(`Buscar portada de ${without} canciones sin portada`).test(btn), `1. Modo desarrollador: «${btn.trim()}»`);
  check(/MusicBrainz/.test(await page.innerText('#view')), '   con la explicación de dónde salen las portadas');

  // el menú de una canción sin portada también lo ofrece
  await page.goto(APP + '#/biblioteca/canciones'); await page.waitForSelector('.row');
  await page.locator('.row', { hasText: 'Safaera' }).first().locator('[data-act="more"]').click();
  await page.waitForSelector('#sheet[open] .menu');
  check((await page.innerText('#sheet')).includes('Buscar portada'), '2. El menú de una canción sin portada ofrece «Buscar portada»');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);

  // --- primera pasada sin IA: las canciones con buenos datos salen directamente de Apple
  aiFail = true;   // la IA falla: así se ve qué se encuentra sin ella y que lo demás no se toca
  await page.goto(APP + '#/ajustes'); await page.click('[data-act="ai-covers"]');
  await page.waitForSelector('#sheet[open]'); await page.click('#sheet[open] button:has-text("Buscar portadas")');
  await until(() => /se detuvo/.test(document.querySelector('#toasts').innerText));
  await until(() => /actualizados? y comprobados?|Guardado y comprobado/.test(document.querySelector('#toasts').innerText), null, 30000);
  all = await tracks();
  const by1 = n => all.find(t => t.title === n);
  const sentToAi = aiCalls.length ? JSON.parse(aiCalls[0].messages.find(m => m.role === 'user').content).canciones.map(c => c.titulo) : [];
  check(by1('Safaera').coverId && by1('Safaera').coverId === by1('Yo Perreo Sola').coverId && by1('Safaera').source === 'exact',
    '3. Sin IA: «Safaera» y «Yo Perreo Sola» salen directamente de Apple con el título, el artista y el álbum del archivo (la misma portada para las dos)');
  check(sentToAi.length === without - 2 && !sentToAi.includes('Safaera') && !sentToAi.includes('Yo Perreo Sola') && sentToAi.includes('Track 01'),
    `   A la IA solo van las que no se encuentran así o cuyos datos no dicen nada (${sentToAi.length}: ${sentToAi.join(', ')})`);
  check(all.filter(t => !['Maqueta A', 'Safaera', 'Yo Perreo Sola'].includes(t.title)).every(t => !t.coverId && !t.tried) && !mbCalls.length,
    '   Si la IA falla, se avisa y las demás no se tocan (ni se consulta MusicBrainz para ellas)');
  const yhlqApple = appleCalls.filter(c => /YHLQMDLG|Yo Perreo Sola/.test(c.term)).length;
  check(yhlqApple === 1 && artCalls.filter(p => p.includes('/yhlq/600x600bb.jpg')).length === 1 && !artCalls.some(p => p.includes('falso')),
    '   Las dos son del mismo disco: una sola consulta a Apple y una sola descarga, a 600 px, y nunca la de otro artista con el mismo título');
  aiFail = false; aiCalls.length = 0;
  const pending = without - 2;

  // --- búsqueda de verdad
  await page.goto(APP + '#/inicio'); await page.goto(APP + '#/ajustes');
  await page.click('[data-act="ai-covers"]');
  await page.waitForSelector('#sheet[open]');
  const dlg = await page.innerText('#sheet');
  await page.click('#sheet[open] button:has-text("Buscar portadas")');
  check(/MusicBrainz/.test(dlg) && /coste/.test(dlg), '4. Antes de empezar avisa de qué se envía a la IA y a MusicBrainz');
  const t0 = Date.now();
  await page.evaluate(() => { document.querySelector('#toasts').innerHTML = ''; });   // (el aviso final de la pasada anterior)
  const finished = await until(() => /archivos? actualizados? y comprobados?|Guardado y comprobado/.test(document.querySelector('#toasts').innerText), null, 60000);
  all = await tracks();
  const by = n => all.find(t => t.title === n);
  check(finished, '   termina escribiendo los archivos');
  check(by('Saoko').coverId && by('Saoko').coverId !== by('Safaera').coverId, '   «Saoko» recibe la de MOTOMAMI (el archivo decía «Motomami»)');
  check(by('Saoko').source === 'exact' && by('Safaera').source === 'exact', '   (portadas de su propio disco)');
  check(all.every(t => t.coverId), '6. Ninguna canción se queda sin portada');
  check(by('Maqueta B').source === 'album' && by('Maqueta B').coverId[0] === 'u', '   «Maqueta B» (disco que no está en MusicBrainz) recibe la de «Maqueta A», del mismo álbum');
  check(by('Despechá').source === 'artist' && by('Despechá').coverId === by('Saoko').coverId, '   «Despechá» (MOTOMAMI + no tiene portada) recibe una de Rosalía de tu biblioteca');
  check(by('Tití').source === 'artist' && by('Tití').coverId === by('Safaera').coverId, '   «Tití» (la IA no la reconoce) recibe una de Bad Bunny de tu biblioteca');
  check(by('Única').source === 'artist' && caaCalls.includes('/release-group/rg-otro/front-500') && mbCalls.some(c => c.query === 'artist:"Otro"'), '   «Única» (artista sin otras canciones) recibe la de otro disco del artista en MusicBrainz');
  check(by('Track 01').source === 'generated' && !mbCalls.some(c => /artist:"Artista desconocido"/.test(c.query)), '   «Track 01» (sin artista ni disco) recibe una portada generada, sin buscar «Artista desconocido»');
  check(!caaCalls.includes('/release-group/rg-falso/front-500'), '   Un disco con el mismo título pero de otro artista no se acepta');
  check(aiCalls.length === 1 && JSON.parse(aiCalls[0].messages.find(m => m.role === 'user').content).canciones.length === pending, `7. Una sola llamada a la IA para las ${pending} que quedaban (por lotes de 20)`);
  const took = (Date.now() - t0) / 1000;
  const yhlqSearches = mbCalls.filter(c => /releasegroup:"YHLQMDLG"/.test(c.query)).length;
  const gaps = mbCalls.slice(1).map((c, i) => c.at - mbCalls[i].at);
  check(yhlqSearches === 0, '   YHLQMDLG, que ya salió de Apple, no se busca en MusicBrainz');
  check(mbCalls.some(c => /releasegroup:"MOTOMAMI"/.test(c.query)) && caaCalls.includes('/release-group/rg-moto/front-500'), '   MOTOMAMI, que Apple no tiene, sale de MusicBrainz');
  const perMin = Math.max(...appleCalls.map(c => appleCalls.filter(d => d.at >= c.at && d.at - c.at < 60000).length));
  check(perMin <= 20, `   Como mucho 20 consultas por minuto a Apple (${appleCalls.length} en total, máximo ${perMin} en un minuto)`);
  console.log(`     (búsqueda y escritura de las ${pending} restantes: ${took.toFixed(1)} s)`);
  check(gaps.every(g => g >= 1000), `   Como mucho una consulta por segundo a MusicBrainz (${mbCalls.length} consultas, mínimo ${Math.min(...gaps)} ms entre ellas)`);
  check(mbCalls.every(c => !/@|secreta|portadas@/.test(c.query)), '   A MusicBrainz solo llegan el disco, el artista y el título');

  // --- en la nube: imagen para los demás dispositivos y archivos reescritos con la portada dentro
  const log = await (await fetch(ORACLE + '/__log')).json();
  const covers = log.objects.filter(([n]) => n.startsWith('_fiora/portadas/'));
  check(covers.length === 5, `8. Las portadas nuevas se suben a la nube (_fiora/portadas) para los demás dispositivos: ${covers.length} (2 de su disco, la copiada del álbum, la del artista y la generada)`);
  const get = async n => Buffer.from(await (await fetch(OWNER_PAR + n.split('/').map(encodeURIComponent).join('/'))).arrayBuffer());
  const mp3 = await get('Bad Bunny/YHLQMDLG/Bad Bunny - Safaera.mp3'), flac = await get('Rosalía/MOTOMAMI/Rosalía - Saoko.flac'), plain = await get('Varios/Track 01.flac');
  const jpegIn = buf => buf.includes(Buffer.from([0xff, 0xd8, 0xff]));
  check(mp3.includes(Buffer.from('APIC')) && jpegIn(mp3) && mp3.length > FILES['Bad Bunny/YHLQMDLG/Bad Bunny - Safaera.mp3'].length, '9. El MP3 de la nube lleva ahora la portada dentro (APIC)');
  const flacPicture = buf => { let o = 4; while (o < buf.length) { const h = buf[o], len = buf.readUIntBE(o + 1, 3); if ((h & 0x7f) === 6) return true; if (h & 0x80) break; o += 4 + len; } return false; };
  check(flacPicture(flac) && jpegIn(flac), '   El FLAC de la nube lleva la portada dentro (bloque PICTURE)');
  check(flacPicture(plain) && jpegIn(plain), '   La portada generada también se escribe en el archivo de la nube');
  const back = await page.evaluate(async () => { const { S } = await import('./js/store.js'), c = await import('./js/cloud.js'); const t = [...S.tracks.values()].find(x => x.title === 'Safaera'); const g = await c.fileTags(t, true); return { title: g?.title, artist: g?.artist, pic: !!g?.picture }; });
  check(back.title === 'Safaera' && back.artist === 'Bad Bunny', '   y conserva el resto de sus metadatos');
  check(await page.evaluate(async () => { const { S, fileOutdated } = await import('./js/store.js'); const c = await import('./js/cloud.js'); return [...S.tracks.values()].filter(t => t.coverId && c.canWriteFile(t)).every(t => !fileOutdated(t)); }), '   No quedan cambios pendientes de escribir en los archivos que lo admiten (los WAV no guardan portada dentro: la ven la app y tus dispositivos)');

  // --- se ve en la app y no se vuelve a pedir
  await page.goto(APP + '#/biblioteca/canciones'); await page.waitForSelector('.row');
  await page.waitForTimeout(800);
  const shown = await page.locator('.row', { hasText: 'Saoko' }).first().evaluate(r => { const c = r.querySelector('.cover'); return !!(c && (c.querySelector('img') || /url\(/.test(c.style.backgroundImage))); });
  check(shown, '10. La portada aparece en la biblioteca');
  await page.goto(APP + '#/ajustes'); await page.waitForSelector('[data-act="ai-covers"]');
  const btn2 = await page.innerText('[data-act="ai-covers"]');
  const left = (await tracks()).filter(t => !t.coverId && !t.tried).length;
  check(left === 0 && /No quedan canciones sin portada/.test(btn2), `   No queda ninguna por buscar: «${btn2.trim()}»`);

  // --- otro dispositivo ve las portadas
  const ctx2 = await b.newContext();
  await ctx2.route(SB + '/**', async route => { try { await route.fulfill({ response: await route.fetch({ url: route.request().url().replace(SB, API) }) }); } catch { await route.abort('failed').catch(() => {}); } });
  await page.evaluate(async () => { await (await import('./js/account.js')).sync(); });
  const p2 = await ctx2.newPage();
  await p2.goto(APP + '#/ajustes'); await p2.waitForSelector('[data-form="login"]');
  await p2.fill('[data-form="login"] [name=email]', 'portadas@example.com'); await p2.fill('[data-form="login"] [name=password]', 'secreta123');
  await p2.click('[data-form="login"] button[value="in"]');
  const got2 = await (async () => { const t = Date.now(); while (Date.now() - t < 30000) { const r = await p2.evaluate(async () => { const { S } = await import('./js/store.js'), l = await import('./js/library.js'); const t = [...S.tracks.values()].find(x => x.title === 'Saoko'); return t?.coverId ? !!(await l.coverUrl(t)) : false; }).catch(() => false); if (r) return true; await p2.waitForTimeout(500); } return false; })();
  check(got2, '11. Otro dispositivo con la misma cuenta y el mismo bucket ve la portada');

  // --- si el navegador no deja leer a Apple (CORS), se sigue solo con MusicBrainz
  const ctx3 = await b.newContext();
  let appleBlocked = 0;
  await ctx3.route('https://itunes.apple.com/**', route => { appleBlocked++; route.abort('failed'); });
  await ctx3.route('https://musicbrainz.org/**', route => { const qy = new URL(route.request().url()).searchParams.get('query') || ''; route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ 'release-groups': GROUPS.filter(g => qy.includes(`"${g.title}"`)) }) }); });
  await ctx3.route('https://coverartarchive.org/**', route => route.fulfill(/rg-(yhlq|moto)\/front-500$/.test(new URL(route.request().url()).pathname) ? { contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' }, body: JPG } : { status: 404, body: '' }));
  const p3 = await ctx3.newPage();
  await p3.goto(APP + '#/inicio'); await p3.waitForSelector('#nav-links a');
  const r3 = await p3.evaluate(async () => {
    const c = await import('./js/covers.js');
    const a = await c.find([{ album: 'YHLQMDLG', artist: 'Bad Bunny' }]), m = await c.find([{ album: 'MOTOMAMI', artist: 'ROSALÍA' }]);
    return [a?.from, m?.from];
  });
  check(r3[0] === 'musicbrainz' && r3[1] === 'musicbrainz' && appleBlocked === 1, `12. Si el navegador no deja leer a Apple, se sigue con MusicBrainz sin volver a intentarlo con Apple (${appleBlocked} intento)`);

  check(!errs.length, 'Sin errores de JavaScript' + (errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''));
  await b.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${ok} comprobaciones correctas, ${fails} fallos`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
