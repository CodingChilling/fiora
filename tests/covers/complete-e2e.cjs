// «Completarlo todo con IA» (modo desarrollador): álbum, después portada y al final géneros y lo que
// transmite, cada paso con lo que dejó el anterior, y los archivos se escriben y suben una sola vez.
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fiora-completar-'));
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
function song(file, tags, freq) {
  const meta = Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  const out = path.join(TMP, file);
  ff('-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=2`, ...meta, ...(file.endsWith('.mp3') ? ['-id3v2_version', '3'] : []), out);
  return fs.readFileSync(out);
}
// En la raíz del bucket: sin carpeta de la que sacar el álbum.
const FILES = {
  'ROSALÍA - DESPECHÁ.mp3': song('a.mp3', { title: 'DESPECHÁ', artist: 'ROSALÍA' }, 300),                        // álbum y portada de Apple
  'Grupo Raro - Canción Escondida.flac': song('b.flac', { title: 'Canción Escondida', artist: 'Grupo Raro' }, 350), // álbum de MusicBrainz, portada generada
  'Track 05.mp3': song('d.mp3', { title: 'Track 05' }, 450),                                                       // nada que buscar: solo portada generada
};
const AI_KNOWS = { 'luz de luna': { album: 'Noches', artist: 'Lunares', year: 2005 }, inventada: { album: 'Disco Falso', artist: 'Banda X', year: 2010 } };

(async () => {
  await fetch(ORACLE + '/__reset');
  // El emulador trae tres canciones de ejemplo; se vacían (un archivo vacío cuenta como borrado) para contar solo las de la prueba.
  const pre = (await (await fetch(OWNER_PAR)).json()).objects.filter(x => /\.(wav|mp3|flac|m4a)$/i.test(x.name));
  for (const x of pre) await fetch(OWNER_PAR + x.name.split('/').map(encodeURIComponent).join('/'), { method: 'PUT', body: new Uint8Array(0) });
  for (const [name, buf] of Object.entries(FILES)) await fetch(OWNER_PAR + name.split('/').map(encodeURIComponent).join('/'), { method: 'PUT', body: buf });
  const b = await chromium.launch();
  const errs = [], aiSongs = [], appleTerms = [], tagged = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(SB + '/**', async route => { try { await route.fulfill({ response: await route.fetch({ url: route.request().url().replace(SB, API) }) }); } catch { await route.abort('failed').catch(() => {}); } });
  const json = (route, body) => route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  await ctx.route(AI + '/**', route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const payload = JSON.parse(body.messages.find(m => m.role === 'user').content), songs = payload.canciones;
    if (payload.generos_ya_usados) {   // etiquetado de géneros y lo que transmite
      tagged.push(...songs.map(s => ({ t: s.titulo, album: s.album })));
      return json(route, { choices: [{ message: { content: JSON.stringify({ songs: songs.map(s => ({ i: s.i, genres: ['Pop Latino'], moods: ['enérgica'] })) }) }, finish_reason: 'stop' }] });
    }
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
    if (new URL(route.request().url()).searchParams.get('entity') === 'album' && /ROSALÍA MOTOMAMI/i.test(term)) R.push({ collectionId: 7, collectionName: 'MOTOMAMI +', artistName: 'ROSALÍA', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/moto/100x100bb.jpg' });
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
  ff('-f', 'lavfi', '-i', 'color=c=0xd2501e:s=600x600', '-frames:v', '1', path.join(TMP, 'p.jpg'));
  const JPG = fs.readFileSync(path.join(TMP, 'p.jpg'));
  await ctx.route('https://is1-ssl.mzstatic.com/**', route => route.fulfill({ contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' }, body: JPG }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  const until = async (fn, arg, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
  const tracks = () => page.evaluate(async () => [...(await import('./js/store.js')).S.tracks.values()].map(t => ({ title: t.title, album: t.album || '', cover: t.coverSource || (t.coverId ? 'archivo' : ''), genres: t.genres || [], moods: t.moods || [] })));

  // --- cuenta, bucket, clave de API, modo desarrollador y la IA
  await page.goto(APP + '#/ajustes/cuenta'); await page.waitForSelector('[data-form="login"]');
  await page.fill('[data-form="login"] [name=email]', 'completar@example.com'); await page.fill('[data-form="login"] [name=password]', 'secreta123');
  await page.click('[data-form="login"] button[value="in"]');
  await until(async () => !!(await import('./js/account.js')).user());
  await page.goto(APP + '#/ajustes/nube');
  if (await page.$('details.more summary')) await page.click('details.more summary');
  await page.fill('[data-form="par"] [name=name]', 'Mi música'); await page.fill('[data-form="par"] [name=url]', OWNER_PAR);
  await page.click('[data-form="par"] button');
  await until(async () => (await import('./js/store.js')).S.tracks.size >= 3, null, 30000);
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
  const MINE = ['DESPECHÁ', 'Canción Escondida', 'Track 05'];
  let all = await tracks();
  check(MINE.every(n => all.some(t => t.title === n && !t.album && !t.cover && !t.genres.length)), '0. Tres canciones sin álbum, portada ni géneros');

  await page.goto(APP + '#/inicio'); await page.goto(APP + '#/ajustes/desarrollador'); await page.waitForSelector('[data-act="ai-all"]');
  const box = await page.innerText('.ai-all');
  check(/Completarlo todo con IA/.test(box) && /3 sin álbum/.test(box) && /sin portada/.test(box) && /sin etiquetar/.test(box), `1. Un solo botón «Completarlo todo con IA» con lo que falta: ${box.replace(/\s+/g, ' ').slice(0, 160)}`);
  check(!!(await page.$('[data-act="ai-albums"]')) && !!(await page.$('[data-act="ai-covers"]')) && !!(await page.$('[data-act="ai-tag-all"]')), '   Los tres botones por separado siguen ahí');
  await page.click('[data-act="ai-all"]'); await page.waitForSelector('#sheet[open]');
  check(/tres pasos/.test(await page.innerText('#sheet')), '   El aviso explica los tres pasos');
  const logBefore = (await (await fetch(ORACLE + '/__log')).json()).log.length;
  await page.click('#sheet[open] button:has-text("Completar")');
  check(await until(async () => { const st = await import('./js/store.js'); const mine = [...st.S.tracks.values()].filter(t => ['DESPECHÁ', 'Canción Escondida', 'Track 05'].includes(t.title)); return mine.every(t => t.genres?.length && (t.coverId || t.coverUrl) && !st.fileOutdated(t)); }, null, 90000), '2. Termina con todo completado y guardado en los archivos');
  all = await tracks();
  const by = t => all.find(x => x.title === t) || {};
  check(by('DESPECHÁ').album === 'MOTOMAMI +' && by('Canción Escondida').album === 'Rarezas' && !by('Track 05').album, '   Álbumes: DESPECHÁ → MOTOMAMI +, Canción Escondida → Rarezas (Track 05, ninguno)');
  check(by('DESPECHÁ').cover === 'exact' && MINE.every(n => by(n).cover), `   Portadas para todas (DESPECHÁ, la de su disco: ${by('DESPECHÁ').cover}; ${by('Canción Escondida').cover}, ${by('Track 05').cover})`);
  check(MINE.every(n => by(n).genres.join() === 'Pop Latino' && by(n).moods.join() === 'enérgica'), `   Géneros y lo que transmite en todas (${MINE.map(n => `${n}: ${by(n).genres}/${by(n).moods}`).join('; ')})`);
  const tagD = tagged.find(x => x.t === 'DESPECHÁ');
  check(tagD?.album === 'MOTOMAMI +', '3. Van en orden: al etiquetar, la IA ya recibe el álbum encontrado en el primer paso');
  const log = (await (await fetch(ORACLE + '/__log')).json()).log.slice(logBefore);
  const puts = log.filter(l => / PUT /.test(l) && /DESPECH/.test(l));
  check(puts.length === 1, `4. Cada archivo se escribe y se sube una sola vez (${puts.length} subida de DESPECHÁ)`);
  const obj = await (await fetch(OWNER_PAR + encodeURIComponent('ROSALÍA - DESPECHÁ.mp3'))).arrayBuffer();
  const f = path.join(TMP, 'subido.mp3'); fs.writeFileSync(f, Buffer.from(obj));
  const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', f]).toString());
  const tg = pr.format.tags || {};
  check(tg.album === 'MOTOMAMI +' && /Pop Latino/.test(tg.genre || '') && pr.streams.some(s => s.disposition?.attached_pic), `   En el archivo subido: álbum, género y portada (${JSON.stringify({ album: tg.album, genre: tg.genre })})`);
  check(!(await page.$('#sheet[open]')), '   Sin preguntas a mitad (el etiquetado ya no pide confirmar por separado)');
  await page.goto(APP + '#/inicio'); await page.goto(APP + '#/ajustes/desarrollador'); await page.waitForSelector('[data-act="ai-all"]');
  check(/No falta nada por completar|sin álbum/.test(await page.innerText('.ai-all')), `5. Después: «${(await page.innerText('.ai-all')).replace(/\s+/g, ' ').slice(0, 120)}»`);

  check(!errs.length, 'Sin errores de JavaScript' + (errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''));
  await b.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${ok} comprobaciones correctas, ${fails} fallos`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
