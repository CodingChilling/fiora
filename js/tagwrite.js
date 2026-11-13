// Lectura y escritura de metadatos dentro del propio archivo de audio, sin tocar el sonido:
//   MP3  -> etiqueta ID3v2 (se conserva la versión 2.3/2.4 y todos los marcos que no se editan)
//   FLAC -> bloque VORBIS_COMMENT (y PICTURE si cambia la portada)
//   M4A  -> átomos moov/udta/meta/ilst (se corrigen los desplazamientos stco/co64 si hace falta)
// El audio no se lee entero en memoria: el archivo nuevo es la cabecera nueva + un trozo (slice)
// del Blob original.
const te = new TextEncoder(), td = new TextDecoder();

/** Campos que se pueden escribir en el archivo. */
export const TAG_KEYS = ['title', 'artists', 'albumArtist', 'album', 'year', 'trackNo', 'genres', 'moods', 'coverId'];
export const canWrite = name => /\.(mp3|flac|m4a|m4b|mp4)$/i.test(name || '');

// Varios artistas: separados por comas; los nombres que llevan coma van entre comillas.
const joinArtists = l => (l || []).map(a => (a.includes(',') ? `"${a}"` : a)).join(', ');
const joinGenres = l => (l || []).join('; ');
/** Texto de cada campo editado, o '' si hay que borrarlo del archivo. */
function texts(f) {
  const v = {};
  if ('title' in f) v.title = f.title || '';
  if ('artists' in f) v.artist = joinArtists(f.artists);
  if ('albumArtist' in f) v.albumArtist = f.albumArtist || '';
  if ('album' in f) v.album = f.album || '';
  if ('year' in f) v.year = f.year ? String(f.year) : '';
  if ('trackNo' in f) v.track = f.trackNo ? String(f.trackNo) : '';
  if ('genres' in f) v.genre = joinGenres(f.genres);
  if ('moods' in f) v.mood = (f.moods || []).join('; ');
  return v;
}

const cat = parts => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const u32 = n => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u32le = n => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24]);
const syncsafe = n => new Uint8Array([(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]);
const readSyncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const readU32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const latin1 = s => Uint8Array.from(s, c => c.charCodeAt(0) & 255);
const bytes = async (blob, a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer());
/** Lector de trozos de un Blob: read(desde, hasta) -> Uint8Array. */
export const blobReader = blob => (a, b) => bytes(blob, a, b);

async function imageInfo(blob) {
  try { const bmp = await createImageBitmap(blob); return { w: bmp.width, h: bmp.height }; } catch { return { w: 0, h: 0 }; }
}

// ---------------------------------------------------------------------- ID3v2
function utf16(s) {   // UTF-16LE con BOM
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff; out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[2 + i * 2] = c & 255; out[3 + i * 2] = c >> 8; }
  return out;
}
function id3Frame(ver, id, body) {
  return cat([latin1(id), ver === 4 ? syncsafe(body.length) : u32(body.length), new Uint8Array([0, 0]), body]);
}
function id3Text(ver, id, value) {
  return id3Frame(ver, id, ver === 4 ? cat([new Uint8Array([3]), te.encode(value)]) : cat([new Uint8Array([1]), utf16(value)]));
}
function id3Txxx(ver, desc, value) {
  return id3Frame(ver, 'TXXX', ver === 4
    ? cat([new Uint8Array([3]), te.encode(desc), new Uint8Array([0]), te.encode(value)])
    : cat([new Uint8Array([1]), utf16(desc), new Uint8Array([0, 0]), utf16(value)]));
}
// Texto de un marco ID3 según su codificación (0 Latin-1, 1 UTF-16 con BOM, 2 UTF-16BE, 3 UTF-8).
function decodeEnc(enc, d) {
  if (enc === 0) return String.fromCharCode(...d);
  if (enc === 3) return td.decode(d);
  let le = enc !== 2, skip = 0;
  if (d[0] === 0xff && d[1] === 0xfe) { le = true; skip = 2; } else if (d[0] === 0xfe && d[1] === 0xff) { le = false; skip = 2; }
  // en UTF-16 cada valor puede llevar su propio BOM (ID3v2.4 con varios valores)
  return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(d.subarray(skip)).replace(/\ufeff/g, '');
}
/** Valor de un marco de texto (varios valores, separados por \0). */
const id3TextValue = data => decodeEnc(data[0], data.subarray(1)).replace(/\0+$/, '');
/** Descripción y valor de un marco TXXX. */
function id3Txxx_read(data) {
  const enc = data[0];
  let i = 1;
  if (enc === 0 || enc === 3) { while (i < data.length && data[i] !== 0) i++; return { desc: decodeEnc(enc, data.subarray(1, i)), value: decodeEnc(enc, data.subarray(i + 1)).replace(/\0+$/, '') }; }
  while (i + 1 < data.length && !(data[i] === 0 && data[i + 1] === 0)) i += 2;
  return { desc: decodeEnc(enc, data.subarray(1, i)), value: decodeEnc(enc, data.subarray(i + 2)).replace(/\0+$/, '') };
}
const deUnsync = b => { const out = []; for (let i = 0; i < b.length; i++) { out.push(b[i]); if (b[i] === 0xff && b[i + 1] === 0) i++; } return Uint8Array.from(out); };
const txxxDesc = data => id3Txxx_read(data).desc;

/** Marcos de la etiqueta ID3v2 del principio del archivo (versiones 2.3 y 2.4). */
async function parseId3(read) {
  const head = await read(0, 10);
  let ver = 3, frames = [], audioStart = 0;
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {   // "ID3"
    const flags = head[5];
    const size = readSyncsafe(head, 6);
    audioStart = 10 + size + (flags & 0x10 ? 10 : 0);
    if (head[3] === 3 || head[3] === 4) {
      ver = head[3];
      let body = await read(10, 10 + size);
      if (ver === 3 && flags & 0x80) body = deUnsync(body);
      let o = 0;
      if (flags & 0x40) o = ver === 4 ? readSyncsafe(body, 0) : readU32(body, 0) + 4;   // cabecera extendida: se descarta
      while (o + 10 <= body.length && body[o] !== 0) {
        const id = String.fromCharCode(...body.subarray(o, o + 4));
        if (!/^[A-Z0-9]{4}$/.test(id)) break;
        const len = ver === 4 ? readSyncsafe(body, o + 4) : readU32(body, o + 4);
        if (o + 10 + len > body.length) break;
        frames.push({ id, raw: body.subarray(o, o + 10 + len), data: body.subarray(o + 10, o + 10 + len), fflags: body[o + 9] });
        o += 10 + len;
      }
    }
    // ID3v2.2 (muy antigua): se sustituye por una 2.3 con los campos editados.
  }
  return { ver, frames, audioStart };
}

async function writeMp3(blob, f, cover) {
  const { ver, frames, audioStart } = await parseId3(blobReader(blob));
  const v = texts(f);
  const replace = new Set([
    'title' in v && 'TIT2', 'artist' in v && 'TPE1', 'albumArtist' in v && 'TPE2', 'album' in v && 'TALB',
    'genre' in v && 'TCON', 'year' in v && 'TYER', 'year' in v && 'TDRC', 'track' in v && 'TRCK', 'mood' in v && 'TMOO',
  ].filter(Boolean));
  const keep = frames.filter(fr => {
    if (replace.has(fr.id)) return false;
    if (cover && fr.id === 'APIC') return false;
    if ('mood' in v && fr.id === 'TXXX' && !(fr.fflags & (ver === 4 ? 0x0c : 0xc0)) && txxxDesc(fr.data).toUpperCase() === 'MOOD') return false;
    return true;
  }).map(fr => fr.raw);
  const add = [];
  const put = (id, val) => { if (val) add.push(id3Text(ver, id, val)); };
  put('TIT2', v.title); put('TPE1', v.artist); put('TPE2', v.albumArtist); put('TALB', v.album);
  put('TCON', v.genre); put(ver === 4 ? 'TDRC' : 'TYER', v.year); put('TRCK', v.track);
  if (v.mood) add.push(ver === 4 ? id3Text(ver, 'TMOO', v.mood) : id3Txxx(ver, 'MOOD', v.mood));
  if (cover) {
    const img = new Uint8Array(await cover.arrayBuffer());
    add.push(id3Frame(ver, 'APIC', cat([new Uint8Array([0]), latin1(cover.type || 'image/jpeg'), new Uint8Array([0, 3, 0]), img])));
  }
  const body = cat([...add, ...keep, new Uint8Array(1024)]);   // 1 KB de relleno
  const header = cat([latin1('ID3'), new Uint8Array([ver, 0, 0]), syncsafe(body.length)]);
  const out = new Blob([header, body, blob.slice(audioStart)], { type: blob.type || 'audio/mpeg' });
  out.tagRange = [0, header.length + body.length];
  return out;
}

// ----------------------------------------------------------------------- FLAC
const VORBIS_KEYS = { title: ['TITLE'], artist: ['ARTIST'], albumArtist: ['ALBUMARTIST', 'ALBUM ARTIST'], album: ['ALBUM'], year: ['DATE', 'YEAR'], track: ['TRACKNUMBER'], genre: ['GENRE'], mood: ['MOOD'] };
/** Bloques de metadatos de un FLAC y dónde empieza el audio. */
async function parseFlac(read, untilComments = false) {
  const blocks = [];
  let o = 4, last = false;
  while (!last && !(untilComments && blocks.some(b => b.type === 4))) {
    const h = await read(o, o + 4);
    if (h.length < 4) throw new Error('FLAC incompleto');
    last = !!(h[0] & 0x80);
    const type = h[0] & 0x7f, len = (h[1] << 16) | (h[2] << 8) | h[3];
    blocks.push({ type, data: await read(o + 4, o + 4 + len) });
    o += 4 + len;
  }
  return { blocks, audioStart: o };
}
/** Comentarios Vorbis: proveedor y lista de "CLAVE=valor" (en bytes). */
function parseVorbis(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const vl = dv.getUint32(0, true), vendor = d.subarray(4, 4 + vl), comments = [];
  let p = 4 + vl; const n = dv.getUint32(p, true); p += 4;
  for (let i = 0; i < n && p + 4 <= d.length; i++) {
    const l = dv.getUint32(p, true); comments.push(d.subarray(p + 4, p + 4 + l)); p += 4 + l;
  }
  return { vendor, comments };
}
async function writeFlac(blob, f, cover) {
  const { blocks, audioStart: o } = await parseFlac(blobReader(blob));
  const v = texts(f);
  const drop = new Set(Object.entries(VORBIS_KEYS).filter(([k]) => k in v).flatMap(([, ks]) => ks));
  let vendor = te.encode('Fiora'), comments = [];
  const vc = blocks.find(b => b.type === 4);
  if (vc) {
    const parsed = parseVorbis(vc.data);
    vendor = parsed.vendor;
    comments = parsed.comments.filter(c => !drop.has(td.decode(c).split('=')[0].toUpperCase()));
  }
  for (const [k, ks] of Object.entries(VORBIS_KEYS)) if (v[k]) comments.push(te.encode(`${ks[0]}=${v[k]}`));
  const vcData = cat([u32le(vendor.length), vendor, u32le(comments.length), ...comments.flatMap(c => [u32le(c.length), c])]);
  let out = blocks.filter(b => b.type !== 4 && b.type !== 1 && !(cover && b.type === 6));   // portada nueva: sustituye a las anteriores
  out.splice(1, 0, { type: 4, data: vcData });   // después de STREAMINFO
  if (cover) {
    const img = new Uint8Array(await cover.arrayBuffer()), { w, h } = await imageInfo(cover), mime = latin1(cover.type || 'image/jpeg');
    out.push({ type: 6, data: cat([u32(3), u32(mime.length), mime, u32(0), u32(w), u32(h), u32(24), u32(0), u32(img.length), img]) });
  }
  out.push({ type: 1, data: new Uint8Array(1024) });   // relleno
  const parts = [latin1('fLaC')];
  out.forEach((b, i) => {
    const len = b.data.length;
    parts.push(new Uint8Array([(i === out.length - 1 ? 0x80 : 0) | b.type, (len >> 16) & 255, (len >> 8) & 255, len & 255]), b.data);
  });
  const head = cat(parts);
  const result = new Blob([head, blob.slice(o)], { type: blob.type || 'audio/flac' });
  result.tagRange = [0, head.length];
  return result;
}

// ------------------------------------------------------------------------ MP4
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'edts', 'dinf', 'mvex', 'ilst', '----']);
const typeBytes = s => Uint8Array.from(s, c => c.charCodeAt(0));   // '©' = 0xA9
function parseBoxes(b, start, end) {
  const out = [];
  let o = start;
  while (o + 8 <= end) {
    let size = readU32(b, o), hdr = 8;
    const type = String.fromCharCode(...b.subarray(o + 4, o + 8));
    if (size === 1) { size = readU32(b, o + 8) * 4294967296 + readU32(b, o + 12); hdr = 16; }
    else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) break;
    const box = { type, start: o, hdr, size };
    if (CONTAINERS.has(type)) box.children = parseBoxes(b, o + hdr, o + size);
    else if (type === 'meta') {
      // En MP4 "meta" es un FullBox (4 bytes de versión); en algunos QuickTime, no.
      const full = String.fromCharCode(...b.subarray(o + hdr + 4, o + hdr + 8)) !== 'hdlr';
      box.full = full ? b.subarray(o + hdr, o + hdr + 4) : null;
      box.children = parseBoxes(b, o + hdr + (full ? 4 : 0), o + size);
    } else box.data = b.subarray(o + hdr, o + size);
    out.push(box);
    o += size;
  }
  if (o < end) out.push({ tail: b.subarray(o, end) });   // bytes sueltos al final (p. ej. el 0 que cierra udta en QuickTime)
  return out;
}
function serialize(box) {
  if (box.tail) return box.tail;
  const body = box.children ? cat([...(box.full ? [box.full] : []), ...box.children.map(serialize)]) : box.data;
  return cat([u32(8 + body.length), typeBytes(box.type), body]);
}
const mk = (type, children) => ({ type, children });
const leaf = (type, data) => ({ type, data });
const dataAtom = (kind, payload) => leaf('data', cat([u32(kind), u32(0), payload]));
function shiftOffsets(box, delta) {
  if (box.children) return box.children.forEach(c => shiftOffsets(c, delta));
  if (box.type === 'stco' || box.type === 'co64') {
    const d = box.data = box.data.slice();
    const n = readU32(d, 4), wide = box.type === 'co64';
    for (let i = 0; i < n; i++) {
      const p = 8 + i * (wide ? 8 : 4);
      if (wide) {
        const v = readU32(d, p) * 4294967296 + readU32(d, p + 4) + delta;
        d.set(u32(Math.floor(v / 4294967296)), p); d.set(u32(v >>> 0), p + 4);
      } else d.set(u32(readU32(d, p) + delta), p);
    }
  }
}
/** Cajas de primer nivel de un MP4 y la caja moov ya analizada. */
async function parseMp4(read, total) {
  const top = [];
  for (let o = 0; o + 8 <= total;) {
    const h = await read(o, o + 16);
    if (h.length < 8) break;
    let size = readU32(h, 0);
    const type = String.fromCharCode(...h.subarray(4, 8));
    if (size === 1) size = readU32(h, 8) * 4294967296 + readU32(h, 12);
    else if (size === 0) size = total - o;
    if (size < 8) throw new Error('MP4 no válido');
    top.push({ type, start: o, size });
    o += size;
  }
  const mv = top.find(x => x.type === 'moov');
  if (!mv) throw new Error('MP4 sin moov');
  const raw = await read(mv.start, mv.start + mv.size);
  if (raw.length < mv.size) throw new Error('MP4 incompleto');
  const [moov] = parseBoxes(raw, 0, raw.length);
  return { top, mv, moov };
}
const findBox = (box, ...path) => path.reduce((b, t) => b?.children?.find(c => c.type === t), box);
async function writeMp4(blob, f, cover) {
  const { top, mv, moov } = await parseMp4(blobReader(blob), blob.size);
  if (top.some(x => x.type === 'moof')) throw new Error('MP4 fragmentado: no se puede editar');
  let udta = moov.children.find(c => c.type === 'udta');
  if (!udta) moov.children.push(udta = mk('udta', []));
  let meta = udta.children.find(c => c.type === 'meta');
  if (!meta) {
    const hdlr = leaf('hdlr', cat([u32(0), u32(0), typeBytes('mdirappl'), u32(0), u32(0), new Uint8Array([0])]));
    meta = { type: 'meta', full: u32(0), children: [hdlr] };
    const tail = udta.children.findIndex(c => c.tail);
    udta.children.splice(tail < 0 ? udta.children.length : tail, 0, meta);
  }
  let ilst = meta.children.find(c => c.type === 'ilst');
  if (!ilst) meta.children.push(ilst = mk('ilst', []));
  const v = texts(f);
  const ITEMS = { title: '©nam', artist: '©ART', albumArtist: 'aART', album: '©alb', year: '©day', genre: '©gen' };
  const freeName = b => { const n = b.children?.find(c => c.type === 'name'); return n ? td.decode(n.data.subarray(4)).toUpperCase() : ''; };
  const drop = new Set(Object.entries(ITEMS).filter(([k]) => k in v).map(([, a]) => a));
  if ('genre' in v) drop.add('gnre');
  if ('track' in v) drop.add('trkn');
  if (cover) drop.add('covr');
  ilst.children = ilst.children.filter(b => !drop.has(b.type) && !('mood' in v && b.type === '----' && freeName(b) === 'MOOD'));
  // Los elementos de ilst son contenedores de átomos "data"; parseBoxes no los abre, se reconstruyen aquí.
  for (const [k, a] of Object.entries(ITEMS)) if (v[k]) ilst.children.push(mk(a, [dataAtom(1, te.encode(v[k]))]));
  if (v.track) ilst.children.push(mk('trkn', [dataAtom(0, cat([u32(+v.track & 0xffff), u32(0)]))]));
  if (v.mood) ilst.children.push(mk('----', [leaf('mean', cat([u32(0), te.encode('com.apple.iTunes')])), leaf('name', cat([u32(0), te.encode('MOOD')])), dataAtom(1, te.encode(v.mood))]));
  if (cover) ilst.children.push(mk('covr', [dataAtom(/png/.test(cover.type) ? 14 : 13, new Uint8Array(await cover.arrayBuffer()))]));
  // Si el audio (mdat) va detrás de moov, al crecer moov hay que mover los desplazamientos.
  let out = serialize(moov);
  const delta = out.length - mv.size;
  if (delta && top.some(x => x.type === 'mdat' && x.start > mv.start)) { shiftOffsets(moov, delta); out = serialize(moov); }
  const result = new Blob([blob.slice(0, mv.start), out, blob.slice(mv.start + mv.size)], { type: blob.type || 'audio/mp4' });
  result.tagRange = [mv.start, mv.start + out.length];
  return result;
}

// --------------------------------------------------------------------- lectura
/**
 * Lee del archivo los campos de texto: {title, artist, albumArtist, album, year, track, genre, mood}
 * (los que existan). `read(desde, hasta)` devuelve trozos del archivo; `size` es su tamaño.
 * Sirve tanto para un Blob como para leer por rangos un archivo de la nube.
 */
export async function readFileTags(read, size, fileName = '') {
  const h = await read(0, 12);
  const s = String.fromCharCode(...h);
  const out = {};
  if (s.startsWith('fLaC')) {
    const { blocks } = await parseFlac(read, true);
    const vc = blocks.find(b => b.type === 4);
    if (!vc) return out;
    const map = {};
    for (const c of parseVorbis(vc.data).comments) {
      const t = td.decode(c), i = t.indexOf('=');
      if (i > 0) (map[t.slice(0, i).toUpperCase()] ||= []).push(t.slice(i + 1));
    }
    for (const [k, ks] of Object.entries(VORBIS_KEYS)) { const val = ks.map(x => map[x]).find(Boolean); if (val) out[k] = val.join('; '); }
    return out;
  }
  if (s.slice(4, 8) === 'ftyp') {
    const { moov } = await parseMp4(read, size);
    const ilst = findBox(moov, 'udta', 'meta', 'ilst');
    if (!ilst) return out;
    const ITEMS = { '©nam': 'title', '©ART': 'artist', aART: 'albumArtist', '©alb': 'album', '©day': 'year', '©gen': 'genre' };
    for (const item of ilst.children || []) {
      if (ITEMS[item.type] && item.data?.length > 16) out[ITEMS[item.type]] = td.decode(item.data.subarray(16));
      if (item.type === 'trkn' && item.data?.length >= 22) out.track = String((item.data[18] << 8) | item.data[19]);
      if (item.type === '----') {
        const name = item.children?.find(c => c.type === 'name'), data = item.children?.find(c => c.type === 'data');
        if (name && data && td.decode(name.data.subarray(4)).toUpperCase() === 'MOOD') out.mood = td.decode(data.data.subarray(8));
      }
    }
    return out;
  }
  if (s.startsWith('ID3')) {
    const { frames, ver } = await parseId3(read);
    const T = { TIT2: 'title', TPE1: 'artist', TPE2: 'albumArtist', TALB: 'album', TYER: 'year', TDRC: 'year', TRCK: 'track', TCON: 'genre', TMOO: 'mood' };
    for (const fr of frames) {
      if (fr.fflags & (ver === 4 ? 0x4f : 0xe0)) continue;   // comprimido, cifrado o agrupado: no se interpreta
      if (T[fr.id]) out[T[fr.id]] = id3TextValue(fr.data);
      else if (fr.id === 'TXXX') { const x = id3Txxx_read(fr.data); if (x.desc.toUpperCase() === 'MOOD') out.mood = x.value; }
    }
  }
  return out;
}

/**
 * Devuelve un Blob nuevo con los campos `f` (los de TAG_KEYS que se hayan editado) escritos en
 * el archivo, o null si el formato no se puede editar. `cover` es la portada nueva, si cambió.
 */
export async function writeTags(blob, fileName, f, cover = null) {
  const h = await bytes(blob, 0, 12);
  const s = String.fromCharCode(...h);
  if (s.startsWith('fLaC')) return writeFlac(blob, f, cover);
  if (/\.flac$/i.test(fileName)) return null;   // FLAC con una etiqueta ID3 delante: no se toca
  if (s.slice(4, 8) === 'ftyp') return writeMp4(blob, f, cover);
  if (s.startsWith('ID3') || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) || /\.mp3$/i.test(fileName)) return writeMp3(blob, f, cover);
  return null;
}
