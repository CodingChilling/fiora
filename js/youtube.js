// Descargas de YouTube (Explorar → Descargar): enlaces, servidores intermedios, audio y metadatos.
//
// YouTube no deja que una página web lea su audio, así que se pide a un servidor intermedio de código
// abierto que lo hace por nosotros: primero el servidor propio que el usuario haya puesto (Piped o
// Invidious) y después los servidores públicos de Piped (voluntarios, gratuitos y sin clave, que van
// y vienen). Al servidor solo se le envía el identificador del vídeo o de la playlist.
//
// El audio se guarda tal cual en M4A (AAC) cuando YouTube lo ofrece, que es lo normal; si solo hay
// Opus/WebM, se convierte a MP3 en el propio dispositivo. Después se escriben dentro del archivo el
// título, los artistas, el álbum, el año y la portada.
import { S } from './store.js';
import * as covers from './covers.js';
import { writeTags } from './tagwrite.js';
import { splitArtists } from './tags.js';

const WAIT = 12000;            // ms como mucho por consulta a un servidor
let CHUNK = 4 * 1048576;       // el audio se pide en trozos de 4 MB (YouTube corta las descargas largas de golpe)
/** Solo para las pruebas automáticas: trozos más pequeños. */
export const _tune = o => { if (o.chunk) CHUNK = o.chunk; };
const MAX_LIST = 500;          // canciones como mucho de una playlist
const ID = /^[A-Za-z0-9_-]{11}$/;

// ------------------------------------------------------------------ enlaces
/** {videoId, listId} de un enlace de YouTube o YouTube Music. Lanza un error si no lo es. */
export function parseLink(text) {
  let u;
  try { u = new URL(String(text || '').trim().replace(/^(?!https?:\/\/)/i, 'https://')); } catch { throw new Error('Eso no es un enlace'); }
  const host = u.hostname.replace(/^(www|m)\./, '');
  if (!/^(youtube\.com|music\.youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host)) throw new Error('Pega un enlace de YouTube o de YouTube Music');
  let videoId = '';
  if (host === 'youtu.be') videoId = u.pathname.slice(1).split('/')[0];
  else if (u.searchParams.get('v')) videoId = u.searchParams.get('v');
  else { const m = /^\/(shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname); if (m) videoId = m[2]; }
  if (videoId && !ID.test(videoId)) throw new Error('El enlace no tiene un identificador de vídeo válido');
  let listId = u.searchParams.get('list') || '';
  if (listId && (!/^[A-Za-z0-9_-]{2,64}$/.test(listId) || /^(WL|LL|LM)$/.test(listId))) listId = '';   // «Ver más tarde» y «Me gusta» son privadas
  if (!videoId && !listId) throw new Error('El enlace no es de un vídeo ni de una playlist');
  return { videoId, listId };
}
/** ¿Es una lista automática («Mix» de YouTube)? Cambia con cada persona: no se puede descargar entera. */
export const isMix = listId => /^RD/.test(listId || '');

// -------------------------------------------------------------- servidores
const kinds = new Map();   // servidor -> 'piped' | 'invidious'
const bad = new Set();     // servidores que han fallado en esta sesión
const own = () => String(S.settings.ytServer || '').trim().replace(/\/+$/, '');
let cur = null;            // servidor que está funcionando
async function servers() {
  const list = [];
  if (own()) list.push(own());
  for (const b of await covers.pipedAllServers().catch(() => [])) if (!list.includes(b)) list.push(b);
  const ok = list.filter(b => !bad.has(b) || b === own());
  if (ok.length) return ok;
  bad.clear();                 // todos fallaron antes: se les da otra oportunidad (quizá ya funcionan)
  return list;
}
const abs = (base, url) => (url && !/^https?:/.test(url) ? new URL(url, base + '/').href : url || '');
async function json(url) {
  const r = await covers.get(url, { wait: WAIT });
  if (!r.ok || !r.body || r.body.error) {
    const e = new Error(r.body?.message || r.body?.error || `El servidor respondió ${r.status}`);
    e.status = r.status; e.content = !!(r.body?.error || r.body?.message) && r.status !== 403 && r.status !== 429;
    throw e;
  }
  return r.body;
}
/**
 * Pide algo a los servidores, empezando por el que ya funciona. `fn(base, kind)` hace la consulta.
 * Si un servidor no contesta, se descarta y se prueba el siguiente.
 */
// Mientras se elige servidor, las demás consultas esperan: así un servidor caído se prueba una vez, no una por consulta.
let picking = null;
function ask(fn) {
  if (!cur && picking) return picking.catch(() => {}).then(() => ask(fn));
  const p = askNow(fn);
  if (!cur) picking = p.then(() => {}, () => {}).finally(() => { picking = null; });
  return p;
}
async function askNow(fn) {
  const tried = [], errors = [];
  const list = await servers();
  if (cur && !list.includes(cur)) cur = null;     // p. ej. el servidor propio que se acaba de quitar
  const order = [...new Set([own(), cur, ...list].filter(Boolean))];
  for (const base of order.slice(0, 6)) {
    tried.push(base);
    let answered = false;
    for (const kind of kinds.has(base) ? [kinds.get(base)] : ['piped', 'invidious']) {
      try {
        const out = await fn(base, kind);
        kinds.set(base, kind); cur = base;
        return out;
      } catch (e) {
        errors.push(e);
        // El servidor funciona pero dice que el vídeo no existe: se pregunta a otro por si acaso,
        // sin descartar este. Si YouTube le exige demostrar que no es un robot, el bloqueado es el servidor.
        if (e.why === 'dead') { answered = true; kinds.set(base, kind); break; }
      }
    }
    if (base === cur && !answered) cur = null;
    if (!answered && base !== own()) { bad.add(base); covers.pipedBad(base); }
    if (errors.filter(e => e.why === 'dead').length >= 2) break;      // dos servidores coinciden: no está disponible
  }
  const dead = errors.filter(e => e.why === 'dead'), bot = errors.some(e => e.why === 'bot');
  const detail = [...new Set(errors.map(e => e.message).filter(Boolean))].slice(0, 2).join(' / ');
  let e;
  if (dead.length && dead.length >= Math.min(2, errors.filter(x => x.why).length)) e = new Error('El vídeo no está disponible (privado, borrado o bloqueado en tu país)');
  else if (bot) e = new Error(`YouTube está bloqueando a los servidores de descarga que se han probado (les pide demostrar que no son un robot). Prueba otra vez más tarde o pon un servidor propio en «Servidor de descarga».${detail ? ` Respuesta: ${detail}` : ''}`);
  else e = new Error(order.length ? `Ningún servidor de descarga ha respondido (${tried.length} probados)${detail ? `: ${detail}` : ''}` : 'No hay servidores de descarga disponibles');
  e.servers = true;
  throw e;
}
// Qué quiere decir el error de un servidor: el vídeo no existe ('dead') o YouTube bloquea al servidor ('bot').
const whyOf = m => (/\bbot\b|sign in|log ?in|confirm you|po.?token|captcha|rate.?limit|too many requests|\b429\b|blocked|\bip\b/i.test(m || '') ? 'bot'
  : /unavailable|private|removed|deleted|terminated|copyright|does not exist|not found|no disponible/i.test(m || '') ? 'dead' : '');

/** Prueba un servidor propio: devuelve 'piped' o 'invidious', o lanza un error. */
export async function testServer(base) {
  base = String(base || '').trim().replace(/\/+$/, '');
  // https, o un servidor en este mismo ordenador (http://localhost), que el navegador también permite.
  if (!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$))/.test(base)) throw new Error('La dirección debe empezar por https:// (o ser http://localhost en este ordenador)');
  // Se pide un vídeo de verdad (el primero de YouTube, «Me at the zoo»): así se sabe también si YouTube lo bloquea.
  const TEST = 'jNQXAC9IVRw';
  let blocked = '';
  for (const [kind, path] of [['piped', `/streams/${TEST}`], ['invidious', `/api/v1/videos/${TEST}?local=true`]]) {
    try {
      const d = await json(base + path);
      const v = kind === 'piped' ? fromPiped(base, d) : fromInvidious(base, d);
      if (v.title || v.audio.length) { kinds.set(base, kind); return kind; }
    } catch (e) { if (e.content && whyOf(e.message) === 'bot') blocked = e.message; }
  }
  if (blocked) throw new Error(`El servidor responde, pero YouTube lo está bloqueando: ${blocked}`);
  throw new Error('No responde como un servidor de Piped ni de Invidious (o no permite consultas desde el navegador)');
}

// -------------------------------------------------------------- vídeos y listas
function fromPiped(base, d) {
  return {
    title: d.title || '', uploader: d.uploader || '', duration: d.duration || 0, thumb: abs(base, d.thumbnailUrl),
    audio: (d.audioStreams || []).map(a => ({ url: abs(base, a.url), mime: String(a.mimeType || '').split(';')[0], codec: a.codec || '', bitrate: +a.bitrate || 0, itag: +a.itag || 0, size: +a.contentLength || 0 })),
  };
}
function fromInvidious(base, d) {
  const th = d.videoThumbnails || [];
  const pick = th.find(t => t.quality === 'maxres') || th.find(t => t.quality === 'sddefault') || th.find(t => t.quality === 'high') || th[0];
  return {
    title: d.title || '', uploader: d.author || '', duration: d.lengthSeconds || 0, thumb: abs(base, pick?.url),
    audio: (d.adaptiveFormats || []).filter(f => /^audio\//.test(f.type || '')).map(f => ({ url: abs(base, f.url), mime: f.type.split(';')[0], codec: (/codecs="([^"]+)"/.exec(f.type) || [])[1] || '', bitrate: +f.bitrate || 0, itag: +f.itag || 0, size: +f.clen || 0 })),
  };
}
/** Información de un vídeo: {title, uploader, duration, thumb, audio:[{url, mime, bitrate, itag, size}], server}. */
export async function video(id) {
  return ask(async (base, kind) => {
    let d;
    try { d = await json(kind === 'piped' ? `${base}/streams/${id}` : `${base}/api/v1/videos/${id}?local=true`); }
    catch (e) { if (e.content) e.why = whyOf(e.message); throw e; }
    const v = kind === 'piped' ? fromPiped(base, d) : fromInvidious(base, d);
    if (!v.title && !v.audio.length) throw new Error('Respuesta vacía');
    return { ...v, id, server: base };
  });
}
const vidOf = u => (/[?&]v=([A-Za-z0-9_-]{11})/.exec(u || '') || [])[1] || '';
/** Una playlist: {title, author, items:[{id, title, uploader, duration, thumb}], capped}. */
export async function playlist(listId, onPage = () => {}) {
  if (isMix(listId)) throw new Error('Es un «Mix» automático de YouTube: cambia para cada persona y no se puede descargar entero');
  return ask(async (base, kind) => {
    const items = [];
    let title = '', author = '';
    const add = x => { if (x.id && !items.some(y => y.id === x.id)) items.push(x); };
    if (kind === 'piped') {
      let d = await json(`${base}/playlists/${encodeURIComponent(listId)}`);
      title = d.name || ''; author = d.uploader || '';
      for (let page = 0; ; page++) {
        for (const s of d.relatedStreams || []) add({ id: vidOf(s.url), title: s.title || '', uploader: s.uploaderName || '', duration: s.duration || 0, thumb: abs(base, s.thumbnail) });
        onPage(items.length);
        if (!d.nextpage || items.length >= MAX_LIST || page > 40) break;
        d = await json(`${base}/nextpage/playlists/${encodeURIComponent(listId)}?nextpage=${encodeURIComponent(d.nextpage)}`);
      }
    } else {
      for (let page = 1; page < 40 && items.length < MAX_LIST; page++) {
        const d = await json(`${base}/api/v1/playlists/${encodeURIComponent(listId)}?page=${page}`);
        if (page === 1) { title = d.title || ''; author = d.author || ''; }
        const before = items.length;
        for (const v of d.videos || []) add({ id: v.videoId, title: v.title || '', uploader: v.author || '', duration: v.lengthSeconds || 0, thumb: abs(base, (v.videoThumbnails || []).find(t => t.quality === 'high')?.url) });
        onPage(items.length);
        if (items.length === before) break;
      }
    }
    if (!items.length) throw new Error('La playlist está vacía o es privada');
    const capped = items.length > MAX_LIST;
    return { title, author, items: items.slice(0, MAX_LIST), capped };
  });
}

// ------------------------------------------------------------------ búsqueda
/** Tipos de búsqueda: canciones (YouTube Music), vídeos y playlists. */
export const SEARCH = { songs: ['music_songs', 'video'], videos: ['videos', 'video'], playlists: ['playlists', 'playlist'] };
/**
 * Busca en YouTube a través del servidor. Devuelve
 * [{type: 'video'|'playlist', id, title, uploader, duration, count, thumb}].
 */
export async function search(q, what = 'songs') {
  const [pf, it] = SEARCH[what] || SEARCH.songs;
  return ask(async (base, kind) => {
    const out = [];
    if (kind === 'piped') {
      const d = await json(`${base}/search?${new URLSearchParams({ q, filter: pf })}`);
      if (!Array.isArray(d.items)) throw new Error('Respuesta vacía');
      for (const x of d.items) {
        if (x.type === 'stream' && vidOf(x.url) && !x.isShort) out.push({ type: 'video', id: vidOf(x.url), title: x.title || '', uploader: x.uploaderName || '', duration: x.duration || 0, thumb: abs(base, x.thumbnail) });
        else if (x.type === 'playlist') { const id = (/[?&]list=([\w-]+)/.exec(x.url || '') || [])[1]; if (id) out.push({ type: 'playlist', id, title: x.name || x.title || '', uploader: x.uploaderName || '', count: x.videos || 0, thumb: abs(base, x.thumbnail) }); }
      }
    } else {
      const d = await json(`${base}/api/v1/search?${new URLSearchParams({ q, type: it })}`);
      if (!Array.isArray(d)) throw new Error('Respuesta vacía');
      for (const x of d) {
        if (x.type === 'video') out.push({ type: 'video', id: x.videoId, title: x.title || '', uploader: x.author || '', duration: x.lengthSeconds || 0, thumb: abs(base, (x.videoThumbnails || []).find(t => t.quality === 'medium' || t.quality === 'high')?.url) });
        else if (x.type === 'playlist') out.push({ type: 'playlist', id: x.playlistId, title: x.title || '', uploader: x.author || '', count: x.videoCount || 0, thumb: abs(base, x.playlistThumbnail) });
      }
    }
    return out.filter(x => x.id);
  });
}
export const watchUrl = id => `https://www.youtube.com/watch?v=${id}`;
export const listUrl = id => `https://www.youtube.com/playlist?list=${id}`;

/** El mejor audio: M4A (AAC) si lo hay; si no, el de más calidad para convertirlo a MP3. */
export function pickAudio(list) {
  const by = l => l.slice().sort((a, b) => b.bitrate - a.bitrate)[0] || null;
  const m4a = by(list.filter(a => a.mime === 'audio/mp4' && !/ec-3|ac-3/.test(a.codec)));
  if (m4a) return { stream: m4a, ext: 'm4a', convert: false };
  const other = by(list.filter(a => /^audio\//.test(a.mime)));
  return other ? { stream: other, ext: 'mp3', convert: true } : null;
}
export const formatLabel = p => (!p ? 'Sin audio' : p.convert ? 'MP3 (convertido)' : `M4A · ${Math.round(p.stream.bitrate / 1000) || 128} kbps`);

/** Descarga el audio con progreso (`onProgress(0..1)`). Se puede cancelar con `signal`. */
export async function fetchAudio(stream, { signal, onProgress = () => {} } = {}) {
  const parts = [];
  const read = async (url, expect) => {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(`El servidor no entregó el audio (${r.status})`);
    if (!r.body?.getReader) return new Uint8Array(await r.arrayBuffer());
    const reader = r.body.getReader(), chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      onProgress(Math.min(1, (done0 + got) / (expect || stream.size || 1)));
    }
    return concat(chunks);
  };
  let done0 = 0;
  if (stream.size > CHUNK) {
    for (let a = 0; a < stream.size; a += CHUNK) {
      const b = Math.min(stream.size, a + CHUNK) - 1;
      const sep = stream.url.includes('?') ? '&' : '?';
      const part = await read(`${stream.url}${sep}range=${a}-${b}`, stream.size);
      if (part.length !== b - a + 1) throw new Error('El servidor cortó la descarga');
      parts.push(part); done0 += part.length;
    }
  } else {
    const all = await read(stream.url, stream.size);
    if (stream.size && all.length !== stream.size) throw new Error('El servidor cortó la descarga');
    parts.push(all);
  }
  onProgress(1);
  return new Blob(parts, { type: stream.mime || 'audio/mp4' });
}
const concat = chunks => { const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };

// -------------------------------------------------------------------- MP3
let lame = null;
function loadLame() {
  if (globalThis.lamejs) return Promise.resolve(globalThis.lamejs);
  return lame ||= new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = 'vendor/lame.min.js';
    s.onload = () => (globalThis.lamejs ? ok(globalThis.lamejs) : ko(new Error('No se pudo cargar el codificador MP3')));
    s.onerror = () => { lame = null; ko(new Error('No se pudo cargar el codificador MP3 (¿sin conexión?)')); };
    document.head.append(s);
  });
}
/** Convierte cualquier audio que el navegador sepa abrir a MP3 de 192 kbps, en este dispositivo. */
export async function toMp3(blob, { signal, onProgress = () => {} } = {}) {
  const L = await loadLame();
  let buf;
  try { buf = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await blob.arrayBuffer()); }
  catch { throw new Error('Este navegador no puede abrir el audio de YouTube (Opus) para convertirlo a MP3'); }
  const ch = Math.min(2, buf.numberOfChannels), enc = new L.Mp3Encoder(ch, buf.sampleRate, 192);
  const pcm = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  const out = [], step = 1152 * 40, n = buf.length;
  const i16 = (f, a, b) => { const r = new Int16Array(b - a); for (let i = a; i < b; i++) { const s = Math.max(-1, Math.min(1, f[i])); r[i - a] = s < 0 ? s * 32768 : s * 32767; } return r; };
  for (let a = 0; a < n; a += step) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const b = Math.min(n, a + step);
    const m = ch === 2 ? enc.encodeBuffer(i16(pcm[0], a, b), i16(pcm[1], a, b)) : enc.encodeBuffer(i16(pcm[0], a, b));
    if (m.length) out.push(new Uint8Array(m));
    if ((a / step) % 20 === 0) { onProgress(a / n); await new Promise(r => setTimeout(r)); }   // deja respirar a la página
  }
  const end = enc.flush();
  if (end.length) out.push(new Uint8Array(end));
  onProgress(1);
  return new Blob(out, { type: 'audio/mpeg' });
}

// --------------------------------------------------------------- metadatos
const NOISE = /\s*[([](?:[^)\]]*\b(?:official|oficial|video|vídeo|audio|lyrics?|letra|visuali[sz]er|clip|hd|hq|4k|mv|m\/v|en vivo|live performance)\b[^)\]]*)[)\]]/gi;
// «(feat. X)», «[ft. X]», «(con X)» o «feat. X» al final (sin paréntesis, «con» no cuenta: «Bailando con lobos»).
const FEAT = /\s*(?:[([]\s*(?:feat|ft|featuring|con|with)\.?\s+([^)\]]+)[)\]]|\s(?:feat|ft|featuring)\.?\s+(.+))\s*$/i;
const tidy = s => String(s || '').replace(/\s+/g, ' ').replace(/\s*[|｜].*$/, '').replace(/\s*#\S+/g, '').replace(/^["“']|["”']$/g, '').trim();
export const channelArtist = s => tidy(String(s || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s*(official|oficial)(\s*(channel|canal))?$/i, ''));
/**
 * Título y artistas a partir de lo que da YouTube: quita «(Official Video)», «[Lyrics]»…, separa
 * «Artista - Canción» y pasa los «feat.» a la lista de artistas.
 */
export function cleanMeta({ title, uploader }) {
  let t = tidy(String(title || '').replace(NOISE, ''));
  const topic = /-\s*Topic$/i.test(uploader || '');
  let artists = [];
  const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(t);
  if (dash && !topic) { artists = splitArtists(dash[1]); t = dash[2]; }
  const feat = FEAT.exec(t);
  if (feat) { t = t.slice(0, feat.index).trim(); }
  t = tidy(t.replace(NOISE, ''));
  if (!artists.length) artists = splitArtists(channelArtist(uploader));
  if (feat) for (const a of splitArtists(String(feat[1] || feat[2]).replace(/\s+(?:&|x|y|and)\s+/gi, ', '))) if (!artists.some(x => x.toLowerCase() === a.toLowerCase())) artists.push(a);
  return { title: t || tidy(title), artists: artists.length ? artists : ['Artista desconocido'] };
}

/** Recorta una miniatura de vídeo a una portada cuadrada de 600 px (sin las franjas negras). */
export async function squareCover(blob, size = 600) {
  const img = await createImageBitmap(blob);
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, img.width, img.height).data;
  const dark = (x0, y0, x1, y1) => {   // ¿la franja es casi negra y lisa?
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const i = (y * img.width + x) * 4; sum += px[i] + px[i + 1] + px[i + 2]; n++; }
    return n && sum / n / 3 < 18;
  };
  let top = 0, bot = img.height, left = 0, right = img.width;
  while (top < bot - 20 && dark(0, top, img.width, top + 2)) top += 2;
  while (bot > top + 20 && dark(0, bot - 2, img.width, bot)) bot -= 2;
  while (left < right - 20 && dark(left, top, left + 2, bot)) left += 2;
  while (right > left + 20 && dark(right - 2, top, right, bot)) right -= 2;
  const w = right - left, h = bot - top, side = Math.min(w, h);
  const out = document.createElement('canvas');
  out.width = out.height = size;
  out.getContext('2d').drawImage(img, left + (w - side) / 2, top + (h - side) / 2, side, side, 0, 0, size, size);
  img.close?.();
  return new Promise(r => out.toBlob(r, 'image/jpeg', 0.9));
}
/** Miniatura del vídeo, recortada a cuadrado. null si no se puede descargar. */
export async function thumbCover(url) {
  if (!url) return null;
  for (const u of [url.replace(/\/(hq|mq|sd)default\.jpg/, '/maxresdefault.jpg'), url]) {
    try {
      const r = await covers.get(u, { as: 'blob', wait: WAIT });
      if (r.ok && /^image\//.test(r.body?.type) && r.body.size > 1500) return await squareCover(r.body);
    } catch { /* la siguiente */ }
  }
  return null;
}
/**
 * Metadatos completos de una canción: limpia los de YouTube y, si Apple (o YouTube Music) la
 * reconoce, añade álbum, año, número y portada cuadrada; si no, la portada es la miniatura recortada.
 */
export async function metadata({ title, uploader, thumb }) {
  const base = cleanMeta({ title, uploader });
  let found = null;
  try { found = await covers.identifySong({ title: base.title, artist: base.artists[0] }); } catch { /* sin datos extra */ }
  const cover = found?.cover || await thumbCover(thumb);
  return {
    ...base, album: found?.album || '', albumArtist: found?.album ? found.albumArtist || base.artists[0] : '', year: found?.year || 0, trackNo: found?.album ? found.trackNo || 0 : 0,
    genres: found?.genre ? [found.genre] : [], cover, coverFrom: found?.cover ? found.from : cover ? 'thumb' : '',
  };
}

/** Nombre de archivo «Artistas - Título.ext» sin caracteres que los sistemas no admiten. */
export const fileName = (m, ext) => `${[m.artists.join(', '), m.title].filter(Boolean).join(' - ')}.${ext}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);

/**
 * Descarga una canción completa con sus metadatos. `meta` son los datos (quizá editados) de
 * `metadata()`. Devuelve un File listo para guardar o importar. `onStep(texto, 0..1)` informa.
 */
export async function downloadSong(id, meta, { signal, onStep = () => {} } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    onStep('Buscando el audio…', 0);
    const v = await video(id);
    const pick = pickAudio(v.audio);
    if (!pick) throw new Error('YouTube no ofrece audio para este vídeo');
    let blob;
    try { blob = await fetchAudio(pick.stream, { signal, onProgress: p => onStep('Descargando…', p) }); }
    catch (e) {
      if (e?.name === 'AbortError') throw e;
      lastErr = e;
      if (v.server !== own()) { bad.add(v.server); covers.pipedBad(v.server); }
      if (cur === v.server) cur = null;
      continue;                                    // otro servidor
    }
    if (pick.convert) blob = await toMp3(blob, { signal, onProgress: p => onStep('Convirtiendo a MP3…', p) });
    onStep('Escribiendo los datos…', 1);
    const name = fileName(meta, pick.ext);
    const fields = { title: meta.title, artists: meta.artists, albumArtist: meta.albumArtist || '', album: meta.album || '', year: meta.year || 0, trackNo: meta.trackNo || 0, genres: meta.genres || [] };
    let tagged = null;
    try { tagged = await writeTags(blob, name, fields, meta.cover || null); } catch (e) { console.warn('No se pudieron escribir los metadatos', e); }
    if (!tagged) throw new Error('No se pudieron escribir los metadatos en el archivo');
    return new File([tagged], name, { type: pick.ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg' });
  }
  throw lastErr || new Error('No se pudo descargar');
}
