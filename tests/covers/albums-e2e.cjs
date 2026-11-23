// Buscar el álbum de las canciones que no lo tienen (modo desarrollador), de punta a punta:
// primero directamente en Apple y MusicBrainz, la IA solo para las que faltan, y lo que propone la
// IA solo se acepta si un catálogo lo confirma. El álbum se escribe en el archivo y se sube a la nube.
// La IA, Apple y MusicBrainz se simulan. Necesita la app en :8765, Supabase en :8766, Oracle en :8769
// (ver README.md) y ffmpeg/ffprobe.
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fiora-albumes-'));
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
function song(file, tags, freq) {
  const meta = Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  const out = path.join(TMP, file);
  ff('-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=2`, ...meta, ...(file.endsWith('.mp3') ? ['-id3v2_version', '3'] : []), out);
  return fs.readFileSync(out);
}
// En la raíz del bucket: sin carpeta de la que sacar el álbum.
const FILES = {
  'ROSALÍA - DESPECHÁ.mp3': song('a.mp3', { title: 'DESPECHÁ', artist: 'ROSALÍA' }, 300),                       // Apple la tiene
  'Grupo Raro - Canción Escondida.flac': song('b.flac', { title: 'Canción Escondida', artist: 'Grupo Raro' }, 350), // solo MusicBrainz
  'Solista - Hit.mp3': song('c.mp3', { title: 'Hit', artist: 'Solista', date: '1999' }, 400),                      // single y álbum: gana el álbum
  'Track 05.mp3': song('d.mp3', { title: 'Track 05' }, 450),                                                       // nadie sabe nada
  'Luz de Luna.mp3': song('e.mp3', { title: 'Luz de Luna', artist: 'Unknown Artist' }, 500),                        // la IA sabe el artista; Apple lo confirma
  'Banda X - Inventada.mp3': song('f.mp3', { title: 'Inventada', artist: 'Banda X' }, 550),                         // la IA se lo inventa: no se pone
};
const AI_KNOWS = { 'luz de luna': { album: 'Noches', artist: 'Lunares', year: 2005 }, inventada: { album: 'Disco Falso', artist: 'Banda X', year: 2010 } };

(async () => {
  await fetch(ORACLE + '/__reset');
  for (const [name, buf] of Object.entries(FILES)) await fetch(OWNER_PAR + name.split('/').map(encodeURIComponent).join('/'), { method: 'PUT', body: buf });
  const b = await chromium.launch();
  const errs = [], aiSongs = [], appleTerms = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(SB + '/**', async route => { try { await route.fulfill({ response: await route.fetch({ url: route.request().url().replace(SB, API) }) }); } catch { await route.abort('failed').catch(() => {}); } });
  const json = (route, body) => route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  await ctx.route(AI + '/**', route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const songs = JSON.parse(body.messages.find(m => m.role === 'user').content).canciones;
    aiSongs.push(...songs.map(s => s.titulo));
    const out = songs.map(s => { const k = AI_KNOWS[s.titulo.toLowerCase()]; return k ? { i: s.i, known: true, ...k } : { i: s.i, known: false, album: '', artist: '', year: 0 }; });
    json(route, { choices: [{ message: { content: JSON.stringify({ songs: out }) }, finish_reason: 'stop' }] });
  });
  await ctx.route('https://itunes.apple.com/**', route => {
    const term = new URL(route.request().url()).searchParams.get('term') || '';
    appleTerms.push(term);
    const R = [];
    if (/ROSALÍA DESPECHÁ/i.test(term)) R.push({ trackName: 'DESPECHÁ', artistName: 'ROSALÍA', collectionName: 'MOTOMAMI +', releaseDate: '2022-07-28T07:00:00Z', trackNumber: 17 });
    if (/Solista Hit/i.test(term)) R.push({ trackName: 'Hit', artistName: 'Solista', collectionName: 'Hit - Single', releaseDate: '1998-01-01T00:00:00Z', trackNumber: 1 },
      { trackName: 'Hit', artistName: 'Solista', collectionName: 'Grandes Éxitos', releaseDate: '1999-05-01T00:00:00Z', trackNumber: 3 });
    if (/Lunares Luz de Luna/i.test(term)) R.push({ trackName: 'Luz de Luna', artistName: 'Lunares', collectionName: 'Noches', releaseDate: '2005-03-01T00:00:00Z', trackNumber: 4 });
    json(route, { resultCount: R.length, results: R });
  });
  await ctx.route('https://musicbrainz.org/**', route => {
    const qy = new URL(route.request().url()).searchParams.get('query') || '';
    const recordings = /"Canción Escondida"/.test(qy) && /"Grupo Raro"/.test(qy) ? [{ title: 'Canción Escondida', score: 100, 'artist-credit': [{ name: 'Grupo Raro', artist: { name: 'Grupo Raro' } }],
      releases: [{ title: 'Lo Mejor de los 2000', date: '2008', 'release-group': { title: 'Lo Mejor de los 2000', 'primary-type': 'Album', 'secondary-types': ['Compilation'] } },
        { title: 'Rarezas', date: '2001-10-02', 'artist-credit': [{ name: 'Grupo Raro' }], 'release-group': { title: 'Rarezas', 'primary-type': 'Album' } }] }] : [];
    json(route, { recordings });
  });
  await ctx.route(/piped|kavin\.rocks|r4fo|coverartarchive/, route => route.abort('failed'));
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  const until = async (fn, arg, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
  const tracks = () => page.evaluate(async () => [...(await import('./js/store.js')).S.tracks.values()].map(t => ({ title: t.title, album: t.album || '', albumArtist: t.albumArtist || '', year: t.year || 0, trackNo: t.trackNo || 0, tried: !!t.albumTried, cloudName: t.cloudName })));

  // --- cuenta, bucket, clave de API, modo desarrollador y la IA
  await page.goto(APP + '#/ajustes/cuenta'); await page.waitForSelector('[data-form="login"]');
  await page.fill('[data-form="login"] [name=email]', 'albumes@example.com'); await page.fill('[data-form="login"] [name=password]', 'secreta123');
  await page.click('[data-form="login"] button[value="in"]');
  await until(async () => !!(await import('./js/account.js')).user());
  await page.goto(APP + '#/ajustes/nube');
  if (await page.$('details.more summary')) await page.click('details.more summary');
  await page.fill('[data-form="par"] [name=name]', 'Mi música'); await page.fill('[data-form="par"] [name=url]', OWNER_PAR);
  await page.click('[data-form="par"] button');
  await until(async () => (await import('./js/store.js')).S.tracks.size >= 6, null, 30000);
  await page.goto(APP + '#/ajustes/desarrollador');
  await page.click('details.key-steps summary');
  await page.fill('[data-form="oci"] textarea', fs.readFileSync(path.join(KEYS, 'config.txt'), 'utf8'));
  await page.setInputFiles('[data-form="oci"] [name=pem]', path.join(KEYS, 'key.pem'));
  await page.click('[data-form="oci"] button');
  await page.waitForSelector('[data-act="oci-forget"]', { timeout: 15000 });
  await page.evaluate(async ai => {
    const { S, saveKV } = await import('./js/store.js');
    S.settings.dev = true;
    S.settings.ai = { provider: 'custom', url: ai, keys: {}, models: { custom: 'modelo-de-prueba' }, lists: {} };
    await saveKV('settings', false);
  }, AI);
  let all = await tracks();
  const MINE = ['DESPECHÁ', 'Canción Escondida', 'Hit', 'Track 05', 'Luz de Luna', 'Inventada'];
  check(MINE.every(n => all.some(t => t.title === n && !t.album)), '0. Seis canciones sin álbum en la nube (más las del emulador, que ya lo tienen)');

  // --- el botón
  await page.goto(APP + '#/inicio'); await page.goto(APP + '#/ajustes/desarrollador'); await page.waitForSelector('[data-act="ai-albums"]');
  check(/Buscar álbum de 6 canciones sin álbum/.test(await page.innerText('[data-act="ai-albums"]')), '1. Modo desarrollador: «Buscar álbum de 6 canciones sin álbum»');
  await page.click('[data-act="ai-albums"]'); await page.waitForSelector('#sheet[open]');
  check(/Apple \(iTunes\) y MusicBrainz/.test(await page.innerText('#sheet')) && /comprueba/.test(await page.innerText('#sheet')), '   El aviso explica que primero se busca sin IA y que lo de la IA se comprueba');
  await page.click('#sheet[open] button:has-text("Buscar álbumes")');
  check(await until(() => /álbumes encontrados/.test(document.querySelector('#toasts').innerText), null, 60000), '   Termina con un resumen');
  const summary = await page.innerText('#toasts');
  await until(async () => { const st = await import('./js/store.js'); return [...st.S.tracks.values()].every(t => !st.fileOutdated(t)); }, null, 60000);

  all = await tracks();
  const by = t => all.find(x => x.title === t) || {};
  check(by('DESPECHÁ').album === 'MOTOMAMI +' && by('DESPECHÁ').year === 2022 && by('DESPECHÁ').trackNo === 17, `2. Apple: DESPECHÁ → «${by('DESPECHÁ').album}» (2022, pista 17)`);
  check(by('Canción Escondida').album === 'Rarezas' && by('Canción Escondida').year === 2001, `   MusicBrainz, sin recopilatorios: Canción Escondida → «${by('Canción Escondida').album}» (2001)`);
  check(by('Hit').album === 'Grandes Éxitos' && by('Hit').year === 1999, `   Entre single y álbum, el álbum: Hit → «${by('Hit').album}» (el año del archivo se respeta)`);
  check(by('Luz de Luna').album === 'Noches' && by('Luz de Luna').albumArtist === 'Lunares', '3. Con IA y confirmado en Apple: Luz de Luna → «Noches» (artista del álbum: Lunares)');
  check(!by('Inventada').album && by('Inventada').tried && !by('Track 05').album && by('Track 05').tried, '   Lo que la IA no puede confirmar no se pone (Inventada, Track 05) y se marca como buscado');
  check(aiSongs.sort().join() === 'Inventada,Luz de Luna,Track 05', `4. A la IA solo van las que no se encontraron directamente: ${aiSongs.join(', ')}`);
  check(/4 álbumes encontrados \(1 con ayuda de la IA\)/.test(summary) && /2 sin encontrar/.test(summary) && /sin confirmar/.test(summary), `   Resumen: «${summary.trim().split('\n').pop()}»`);

  // --- en el archivo y en la nube
  const obj = await (await fetch(OWNER_PAR + encodeURIComponent('ROSALÍA - DESPECHÁ.mp3'))).arrayBuffer();
  const f = path.join(TMP, 'subido.mp3'); fs.writeFileSync(f, Buffer.from(obj));
  const tags = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', f]).toString()).format.tags || {};
  check(tags.album === 'MOTOMAMI +' && /2022/.test(tags.date || '') && tags.track === '17' && tags.title === 'DESPECHÁ', `5. El álbum se escribe en el archivo y se sube a la nube: ${JSON.stringify({ album: tags.album, date: tags.date, track: tags.track })}`);

  // --- después
  await page.goto(APP + '#/inicio'); await page.goto(APP + '#/ajustes/desarrollador'); await page.waitForSelector('[data-act="ai-albums"]');
  check(/No quedan canciones sin álbum por buscar/.test(await page.innerText('[data-act="ai-albums"]')) && /2 canciones sin álbum ya se buscaron/.test(await page.innerText('#view')), '6. Las buscadas sin éxito no se vuelven a enviar en bloque, y se dice cómo reintentarlas');
  const menu = await page.evaluate(async () => {
    const { S } = await import('./js/store.js');
    location.hash = '#/biblioteca/canciones';
    return [...S.tracks.values()].find(t => t.title === 'Inventada').id;
  });
  await page.waitForSelector('#lib-list .row');
  await page.fill('#lib-q', 'Inventada'); await page.waitForTimeout(400);
  await page.click('#lib-list .row [data-act="more"]'); await page.waitForSelector('#sheet .menu');
  const items = await page.$$eval('#sheet .menu button span', l => l.map(x => x.textContent));
  check(items.includes('Buscar álbum') && menu, '   Menú ⋯ de una canción sin álbum: «Buscar álbum» (para reintentar)');
  await page.keyboard.press('Escape');
  await page.fill('#lib-q', 'DESPECHÁ'); await page.waitForTimeout(400);
  await page.click('#lib-list .row [data-act="more"]'); await page.waitForSelector('#sheet .menu');
  check(!(await page.$$eval('#sheet .menu button span', l => l.map(x => x.textContent))).includes('Buscar álbum'), '   Las que ya tienen álbum no lo ofrecen');
  await page.keyboard.press('Escape');

  check(!errs.length, 'Sin errores de JavaScript' + (errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''));
  await b.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${ok} comprobaciones correctas, ${fails} fallos`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
