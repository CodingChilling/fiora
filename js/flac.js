// Codificador FLAC (sin pérdida) para convertir WAV antes de subirlos a la nube.
// Usa predictores fijos de orden 0–4, codificación Rice con particiones y estéreo
// izquierda/derecha/medio/lateral. El audio resultante es idéntico muestra a muestra.

const BLOCK = 4096;
const SR_CODE = { 88200: 1, 176400: 2, 192000: 3, 8000: 4, 16000: 5, 22050: 6, 24000: 7, 32000: 8, 44100: 9, 48000: 10, 96000: 11 };
const BPS_CODE = { 8: 1, 16: 4, 24: 6 };

const CRC8 = new Uint8Array(256), CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let a = i, b = i << 8;
  for (let k = 0; k < 8; k++) { a = a & 0x80 ? ((a << 1) ^ 0x07) & 0xFF : (a << 1) & 0xFF; b = b & 0x8000 ? ((b << 1) ^ 0x8005) & 0xFFFF : (b << 1) & 0xFFFF; }
  CRC8[i] = a; CRC16[i] = b;
}

class BitWriter {
  constructor(cap) { this.buf = new Uint8Array(cap); this.pos = 0; this.cur = 0; this.fill = 0; }
  grow(n) {
    if (this.pos + n <= this.buf.length) return;
    const b = new Uint8Array(Math.max(this.buf.length * 2, this.pos + n));
    b.set(this.buf.subarray(0, this.pos)); this.buf = b;
  }
  /** Escribe los `n` bits bajos de `v` (0 ≤ v < 2^32, n ≤ 32). */
  bits(v, n) {
    while (n > 0) {
      const take = Math.min(n, 8 - this.fill);
      this.cur |= ((v >>> (n - take)) & ((1 << take) - 1)) << (8 - this.fill - take);
      this.fill += take; n -= take;
      if (this.fill === 8) { this.grow(1); this.buf[this.pos++] = this.cur; this.cur = 0; this.fill = 0; }
    }
  }
  signed(v, n) { this.bits(n === 32 ? v >>> 0 : (v & ((1 << n) - 1)) >>> 0, n); }
  unary(q) { while (q >= 32) { this.bits(0, 32); q -= 32; } this.bits(1, q + 1); }
  align() { if (this.fill) this.bits(0, 8 - this.fill); }
  bytes(arr) { this.grow(arr.length); this.buf.set(arr, this.pos); this.pos += arr.length; }
}

/** Lee la cabecera de un WAV PCM. Devuelve null si no es un formato que sepamos convertir. */
export function parseWav(buf) {
  const v = new DataView(buf);
  const tag = o => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt = null, o = 12;
  while (o + 8 <= buf.byteLength) {
    const id = tag(o), size = v.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ' && size >= 16) {
      let format = v.getUint16(body, true);
      if (format === 0xFFFE && size >= 26) format = v.getUint16(body + 24, true);   // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), align: v.getUint16(body + 12, true), bps: v.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 1 || !BPS_CODE[fmt.bps] || fmt.channels < 1 || fmt.channels > 2 || fmt.rate < 1 || fmt.rate > 655350) return null;
      if (fmt.align !== fmt.channels * fmt.bps / 8) return null;
      const bytes = Math.min(size, buf.byteLength - body);
      return { ...fmt, offset: body, frames: Math.floor(bytes / fmt.align) };
    }
    o = body + size + (size & 1);
  }
  return null;
}

// Elige la mejor forma de codificar un canal de un bloque y calcula cuántos bits ocupa.
function analyze(s, n, bps) {
  let constant = true;
  for (let i = 1; i < n; i++) if (s[i] !== s[0]) { constant = false; break; }
  if (constant) return { kind: 0, bits: 8 + bps };
  const verbatim = { kind: 1, bits: 8 + bps * n };
  if (n < 32) return verbatim;

  // Suma de |residuo| para cada orden de predictor fijo; el menor gana.
  const sum = [0, 0, 0, 0, 0];
  let p0 = 0, p1 = 0, p2 = 0, p3 = 0;
  for (let i = 0; i < n; i++) {
    const d0 = s[i], d1 = d0 - p0, d2 = d1 - p1, d3 = d2 - p2, d4 = d3 - p3;
    if (i >= 4) { sum[0] += Math.abs(d0); sum[1] += Math.abs(d1); sum[2] += Math.abs(d2); sum[3] += Math.abs(d3); sum[4] += Math.abs(d4); }
    p0 = d0; p1 = d1; p2 = d2; p3 = d3;
  }
  let order = 0;
  for (let k = 1; k <= 4; k++) if (sum[k] < sum[order]) order = k;

  // Residuo del orden elegido, en zigzag (sin signo), indexado por posición de muestra.
  const u = new Float64Array(n);
  p0 = p1 = p2 = p3 = 0;
  for (let i = 0; i < n; i++) {
    const d0 = s[i], d1 = d0 - p0, d2 = d1 - p1, d3 = d2 - p2, d4 = d3 - p3;
    if (i >= order) { const r = order === 0 ? d0 : order === 1 ? d1 : order === 2 ? d2 : order === 3 ? d3 : d4; u[i] = r >= 0 ? 2 * r : -2 * r - 1; }
    p0 = d0; p1 = d1; p2 = d2; p3 = d3;
  }

  // Búsqueda del mejor orden de partición y parámetro Rice de cada partición.
  const wide = bps > 16, paramBits = wide ? 5 : 4, maxK = wide ? 30 : 14;
  let maxPo = 0;
  while (maxPo < 8 && !((n >> maxPo) & 1) && (n >> (maxPo + 1)) > order) maxPo++;
  let sums = new Float64Array(1 << maxPo);
  const psize = n >> maxPo;
  for (let i = order; i < n; i++) sums[(i / psize) | 0] += u[i];
  let best = null;
  for (let po = maxPo; po >= 0; po--) {
    const parts = 1 << po, len = n >> po, ks = new Uint8Array(parts);
    let bits = 6;
    for (let p = 0; p < parts; p++) {
      const count = len - (p ? 0 : order), total = sums[p];
      let k = 0, cost = Infinity;
      for (let c = 0; c <= maxK; c++) {
        const b = count * (c + 1) + Math.floor(total / 2 ** c);
        if (b < cost) { cost = b; k = c; } else if (c > k + 1) break;
      }
      ks[p] = k; bits += paramBits + cost;
    }
    if (!best || bits < best.bits) best = { po, ks, bits };
    if (po) { const next = new Float64Array(parts >> 1); for (let p = 0; p < parts; p += 2) next[p >> 1] = sums[p] + sums[p + 1]; sums = next; }
  }
  const bits = 8 + order * bps + best.bits;
  return bits < verbatim.bits ? { kind: 2, bits, order, u, po: best.po, ks: best.ks, wide } : verbatim;
}

function writeSubframe(w, s, n, bps, a) {
  if (a.kind === 0) { w.bits(0x00, 8); w.signed(s[0], bps); return; }
  if (a.kind === 1) { w.bits(0x02, 8); for (let i = 0; i < n; i++) w.signed(s[i], bps); return; }
  w.bits((0x08 | a.order) << 1, 8);
  for (let i = 0; i < a.order; i++) w.signed(s[i], bps);
  w.bits(a.wide ? 1 : 0, 2);
  w.bits(a.po, 4);
  const len = n >> a.po, pb = a.wide ? 5 : 4;
  for (let p = 0, i = a.order; p < a.ks.length; p++) {
    const k = a.ks[p], end = (p + 1) * len, div = 2 ** k;
    w.bits(k, pb);
    for (; i < end; i++) {
      const v = a.u[i], q = Math.floor(v / div);
      w.unary(q);
      if (k) w.bits(v - q * div, k);
    }
  }
}

function utf8(w, v) {
  if (v < 0x80) return w.bits(v, 8);
  let n = v < 0x800 ? 1 : v < 0x10000 ? 2 : v < 0x200000 ? 3 : v < 0x4000000 ? 4 : 5;
  w.bits(((0xFF << (7 - n)) & 0xFF) | Math.floor(v / 2 ** (6 * n)), 8);
  while (n--) w.bits(0x80 | (Math.floor(v / 2 ** (6 * n)) & 0x3F), 8);
}

function crc(table, mask, buf, from, to) {
  let c = 0;
  if (mask === 0xFF) for (let i = from; i < to; i++) c = table[c ^ buf[i]];
  else for (let i = from; i < to; i++) c = ((c << 8) & 0xFFFF) ^ table[(c >> 8) ^ buf[i]];
  return c;
}

function vorbisComment(tags) {
  const enc = new TextEncoder();
  const vendor = enc.encode('Fiora');
  const items = Object.entries(tags).filter(([, v]) => v).map(([k, v]) => enc.encode(`${k}=${v}`));
  const out = new Uint8Array(8 + vendor.length + items.reduce((a, b) => a + 4 + b.length, 0));
  const v = new DataView(out.buffer);
  let o = 0;
  v.setUint32(o, vendor.length, true); o += 4; out.set(vendor, o); o += vendor.length;
  v.setUint32(o, items.length, true); o += 4;
  for (const it of items) { v.setUint32(o, it.length, true); o += 4; out.set(it, o); o += it.length; }
  return out;
}

/**
 * Convierte un WAV PCM (8, 16 o 24 bits; mono o estéreo) en FLAC.
 * Devuelve un Uint8Array, o null si el archivo no es un WAV que se pueda convertir.
 */
export async function encodeWav(buf, tags = {}, pause = null) {
  const wav = parseWav(buf);
  if (!wav || !wav.frames) return null;
  const { channels, bps, rate, frames, offset } = wav;
  const view = new DataView(buf);
  const w = new BitWriter(Math.floor(buf.byteLength * 0.6) + 65536);

  // "fLaC" + STREAMINFO (los tamaños de trama se rellenan al final) + VORBIS_COMMENT
  w.bits(0x664C6143, 32);
  w.bits(0x00, 8); w.bits(34, 24);
  w.bits(BLOCK, 16); w.bits(BLOCK, 16); w.bits(0, 24); w.bits(0, 24);
  w.bits(rate, 20); w.bits(channels - 1, 3); w.bits(bps - 1, 5);
  w.bits(Math.floor(frames / 2 ** 32), 4); w.bits(frames >>> 0, 32);
  for (let i = 0; i < 4; i++) w.bits(0, 32);            // MD5 sin calcular (permitido)
  const vc = vorbisComment(tags);
  w.bits(0x84, 8); w.bits(vc.length, 24); w.bytes(vc);

  const ch = [new Int32Array(BLOCK), new Int32Array(BLOCK)], mid = new Int32Array(BLOCK), side = new Int32Array(BLOCK);
  const bytes = bps / 8;
  let minFrame = Infinity, maxFrame = 0;

  for (let pos = 0, frameNo = 0; pos < frames; pos += BLOCK, frameNo++) {
    const n = Math.min(BLOCK, frames - pos);
    let o = offset + pos * channels * bytes;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < channels; c++, o += bytes) {
        ch[c][i] = bps === 16 ? view.getInt16(o, true)
          : bps === 24 ? (view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16))
            : view.getUint8(o) - 128;
      }
    }

    // Elige la combinación de canales más barata.
    let subs, assign = channels - 1;
    if (channels === 2) {
      for (let i = 0; i < n; i++) { const l = ch[0][i], r = ch[1][i]; mid[i] = (l + r) >> 1; side[i] = l - r; }
      const L = analyze(ch[0], n, bps), R = analyze(ch[1], n, bps), M = analyze(mid, n, bps), Sd = analyze(side, n, bps + 1);
      const options = [
        [1, [[ch[0], bps, L], [ch[1], bps, R]], L.bits + R.bits],
        [8, [[ch[0], bps, L], [side, bps + 1, Sd]], L.bits + Sd.bits],
        [9, [[side, bps + 1, Sd], [ch[1], bps, R]], Sd.bits + R.bits],
        [10, [[mid, bps, M], [side, bps + 1, Sd]], M.bits + Sd.bits],
      ];
      const pick = options.reduce((a, b) => (b[2] < a[2] ? b : a));
      assign = pick[0]; subs = pick[1];
    } else subs = [[ch[0], bps, analyze(ch[0], n, bps)]];

    const start = w.pos;
    const bsCode = n === BLOCK ? 12 : n <= 256 ? 6 : 7;
    w.bits(0xFFF8, 16);
    w.bits(bsCode, 4); w.bits(SR_CODE[rate] || 0, 4);
    w.bits(assign, 4); w.bits(BPS_CODE[bps], 3); w.bits(0, 1);
    utf8(w, frameNo);
    if (bsCode === 6) w.bits(n - 1, 8); else if (bsCode === 7) w.bits(n - 1, 16);
    w.bits(crc(CRC8, 0xFF, w.buf, start, w.pos), 8);
    for (const [s, b, a] of subs) writeSubframe(w, s, n, b, a);
    w.align();
    w.bits(crc(CRC16, 0xFFFF, w.buf, start, w.pos), 16);
    const size = w.pos - start;
    minFrame = Math.min(minFrame, size); maxFrame = Math.max(maxFrame, size);
    if (pause && frameNo % 48 === 47) await pause();
  }

  const out = w.buf.subarray(0, w.pos);
  out[12] = minFrame >> 16; out[13] = minFrame >> 8; out[14] = minFrame;
  out[15] = maxFrame >> 16; out[16] = maxFrame >> 8; out[17] = maxFrame;
  return out;
}

/** Versión para el navegador: recibe el Blob del WAV y los datos de la pista. Devuelve un Blob FLAC o null. */
export async function wavToFlac(blob, t) {
  const out = await encodeWav(await blob.arrayBuffer(), {
    TITLE: t.title, ALBUM: t.album, GENRE: t.genre, ALBUMARTIST: t.albumArtist || '',
    // los nombres con coma van entre comillas para poder volver a separarlos al leerlos
    ARTIST: (t.artists?.length ? t.artists : [t.artist]).map(a => (String(a).includes(',') ? `"${a}"` : a)).join(', '),
    TRACKNUMBER: t.trackNo || '', DATE: t.year || '',
  }, () => new Promise(r => setTimeout(r)));
  return out && new Blob([out], { type: 'audio/flac' });
}
