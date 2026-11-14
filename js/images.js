// Imágenes de las playlists (portadas y fotos del carrusel).
//  · Validación real: se mira la firma del archivo y se decodifica (no basta con la extensión).
//  · Nube: Supabase Storage, bucket privado `fiora-playlists`, carpeta `{user_id}/{playlist}/…`,
//    máximo IMAGE_MAX_BYTES (16 MB) por archivo, igual que el límite del bucket.
//  · Local: las fotos de más de 16 MB que el usuario decide usar igualmente se guardan solo en
//    este dispositivo (IndexedDB). Nunca se suben ni se guardan en PostgreSQL.
//  · Caché: las imágenes descargadas se guardan en IndexedDB para no volver a pedirlas.
import * as db from './db.js';
import * as account from './account.js';
import { IMAGE_MAX_BYTES, IMAGE_TYPES, PLAYLIST_BUCKET } from './config.js';

export const MB = n => `${(n / 1048576).toLocaleString('es', { maximumFractionDigits: 1 })} MB`;
export const LIMIT_TEXT = MB(IMAGE_MAX_BYTES).replace(',0', '');
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

// ------------------------------------------------------------ validación
/** Tipo real por la firma de los primeros bytes (o '' si no es una imagen admitida). */
async function sniff(file) {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const s = String.fromCharCode(...b);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (s.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (s.startsWith('GIF87a') || s.startsWith('GIF89a')) return 'image/gif';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'image/webp';
  if (s.slice(4, 8) === 'ftyp' && /^avi[fs]/.test(s.slice(8, 12))) return 'image/avif';
  if (s.slice(4, 8) === 'ftyp' && /^(heic|heix|mif1|msf1)/.test(s.slice(8, 12))) return 'image/heic';
  return '';
}
async function decode(blob) {
  try { return await createImageBitmap(blob); }
  catch {
    // Safari antiguo: se decodifica con <img>
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async'; img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}

/**
 * Comprueba un archivo elegido por el usuario. Devuelve {ok, mime, size, w, h, tooBig, error}.
 * `tooBig` no es un error: la foto puede usarse en local si el usuario quiere.
 */
export async function inspect(file) {
  const out = { ok: false, size: file.size, name: file.name || 'imagen' };
  if (!file.size) return { ...out, error: 'El archivo está vacío' };
  const mime = await sniff(file);
  if (mime === 'image/heic') return { ...out, error: 'Las fotos HEIC del iPhone no se pueden usar directamente: expórtala como JPEG (o pon «Más compatible» en Ajustes → Cámara → Formatos)' };
  if (!IMAGE_TYPES.includes(mime)) return { ...out, error: 'No es una imagen admitida (JPEG, PNG, WebP, GIF o AVIF)' };
  let bmp;
  try { bmp = await decode(file); } catch { return { ...out, mime, error: 'La imagen está dañada o el navegador no puede abrirla' }; }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  bmp.close?.();
  if (!w || !h) return { ...out, mime, error: 'La imagen no tiene dimensiones válidas' };
  if (w < 32 || h < 32) return { ...out, mime, w, h, error: `La imagen es demasiado pequeña (${w}×${h} px; mínimo 32 px)` };
  if (w > 20000 || h > 20000 || w * h > 150e6) return { ...out, mime, w, h, error: `La imagen es demasiado grande en píxeles (${w}×${h})` };
  return { ...out, ok: true, mime, w, h, tooBig: file.size > IMAGE_MAX_BYTES };
}

// ------------------------------------------------------------ transformaciones
async function toJpeg(blob, max, quality = 0.86) {
  const bmp = await decode(blob);
  const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
  const k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);   // fondo para PNG con transparencia
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const out = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
  if (!out) throw new Error('No se pudo procesar la imagen');
  return { blob: out, w: c.width, h: c.height };
}
/** Miniatura (para listas y carrusel): JPEG de 480 px como máximo. */
export const thumbnail = blob => toJpeg(blob, 480, 0.8);
/** Compresión opcional: JPEG de 2560 px como máximo. Solo si de verdad ocupa menos. */
export async function compress(blob) {
  const r = await toJpeg(blob, 2560, 0.86);
  return r.blob.size < blob.size ? { ...r, mime: 'image/jpeg' } : null;
}

// ------------------------------------------------------------ colores
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
export const rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = h => { const [r, g, b] = rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
export const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));

/** De dos a tres colores dominantes de una imagen (cuantización sencilla). */
export async function dominantColors(blob) {
  const bmp = await decode(blob);
  const c = document.createElement('canvas'); c.width = 48; c.height = 48;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, 48, 48); bmp.close?.();
  const px = g.getImageData(0, 0, 48, 48).data;
  const buckets = new Map();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const key = (px[i] >> 5) << 6 | (px[i + 1] >> 5) << 3 | (px[i + 2] >> 5);
    const e = buckets.get(key) || buckets.set(key, { n: 0, r: 0, g: 0, b: 0 }).get(key);
    e.n++; e.r += px[i]; e.g += px[i + 1]; e.b += px[i + 2];
  }
  const sorted = [...buckets.values()].map(e => ({ n: e.n, c: [e.r / e.n, e.g / e.n, e.b / e.n] }))
    .map(e => { const [r, g2, b] = e.c, mx = Math.max(r, g2, b), mn = Math.min(r, g2, b); return { ...e, sat: mx ? (mx - mn) / mx : 0 }; })
    .sort((a, b) => b.n * (0.4 + b.sat) - a.n * (0.4 + a.sat));
  const out = [];
  for (const e of sorted) {
    if (out.every(o => Math.hypot(...o.map((v, i) => v - e.c[i])) > 60)) out.push(e.c);
    if (out.length === 3) break;
  }
  while (out.length < 2) out.push(out[0] ? out[0].map(v => v * 0.55) : [60, 50, 80]);
  return out.map(hex);
}

/**
 * Paleta lista para pintar la cabecera: degradado, color del texto y color de acento, con
 * contraste suficiente (≥ 4,5:1 entre texto y cualquier punto del degradado).
 */
export function palette(colors) {
  let list = (colors || []).filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3);
  if (!list.length) return null;
  if (list.length === 1) list = [list[0], mix(list[0], '#000000', 0.45)];
  // Texto claro u oscuro, según cuál contraste mejor con el degradado completo.
  const minWith = ink => Math.min(...list.map(c => contrast(c, ink)));
  let ink = minWith('#ffffff') >= minWith('#111111') ? '#ffffff' : '#111111';
  // Se oscurecen (o aclaran) los colores hasta que el texto se lea bien.
  const target = ink === '#ffffff' ? '#000000' : '#ffffff';
  list = list.map(c => { let x = c, t = 0; while (contrast(x, ink) < 4.5 && t < 1) { t += 0.08; x = mix(c, target, t); } return x; });
  const accent = list.reduce((best, c) => (contrast(c, ink) < contrast(best, ink) ? c : best), list[0]);
  return { list, ink, accent, inkSoft: ink === '#ffffff' ? 'rgba(255,255,255,.78)' : 'rgba(17,17,17,.72)' };
}

// ------------------------------------------------------------ Storage (nube)
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
/** Ruta de un archivo: `{user_id}/{playlist}/{covers|photos}/{id}.{ext}`. */
export const cloudPath = (pid, role, id, mime, thumb = false) =>
  `${account.user().id}/${pid}/${role === 'cover' ? 'covers' : 'photos'}/${id}${thumb ? '_t.jpg' : '.' + (EXT[mime] || 'jpg')}`;

function storageError(r, data, what) {
  const msg = `${data?.message || ''} ${data?.error || ''}`;
  const e = new Error(
    r.status === 413 || /maximum allowed size|too large/i.test(msg) ? `La imagen supera el límite de ${LIMIT_TEXT} del almacenamiento`
      : /mime type|not supported/i.test(msg) ? 'El almacenamiento no admite ese tipo de imagen'
        : /bucket not found|NoSuchBucket/i.test(msg + (data?.code || '')) ? 'Falta preparar el almacenamiento en Supabase (ejecuta la migración de las playlists)'
          : r.status === 401 || r.status === 403 ? 'No tienes permiso para guardar esa imagen (vuelve a iniciar sesión)'
            : `Supabase respondió ${r.status} al ${what}${data?.message ? `: ${data.message}` : ''}`);
  e.status = r.status;
  return e;
}

/** Sube un archivo a Storage. Nunca intenta subir algo que ya sabe que supera el límite. */
export async function upload(path, blob, mime, signal) {
  if (blob.size > IMAGE_MAX_BYTES) throw new Error(`La imagen supera el límite de ${LIMIT_TEXT}`);
  const r = await account.authFetch(`/storage/v1/object/${PLAYLIST_BUCKET}/${encPath(path)}`, {
    method: 'POST', body: blob, signal,
    headers: { 'Content-Type': mime, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' },
  });
  if (!r.ok) throw storageError(r, await r.json().catch(() => null), 'subir la imagen');
  await db.put('covers', 'plcache:' + path, blob).catch(() => {});   // ya la tenemos: no hace falta descargarla
}

/** Borra archivos que ya no se usan (portadas sustituidas, fotos quitadas…). */
export async function remove(paths) {
  paths = [...new Set((paths || []).filter(Boolean))];
  if (!paths.length) return;
  for (const p of paths) { db.del('covers', 'plcache:' + p).catch(() => {}); forget(p); }
  const r = await account.authFetch(`/storage/v1/object/${PLAYLIST_BUCKET}`, { method: 'DELETE', json: { prefixes: paths } });
  if (!r.ok) throw storageError(r, await r.json().catch(() => null), 'borrar imágenes');
}

// URLs de las imágenes que se muestran: de la caché de IndexedDB o descargadas una sola vez.
const urls = new Map();     // clave -> Promise<objectURL|null>
function forget(key) { const u = urls.get(key); urls.delete(key); u?.then(x => x && URL.revokeObjectURL(x)); }
export function cloudUrl(path) {
  if (!path) return Promise.resolve(null);
  if (!urls.has(path)) {
    urls.set(path, (async () => {
      let blob = await db.get('covers', 'plcache:' + path).catch(() => null);
      if (!blob) {
        if (!account.user()) return null;
        const r = await account.authFetch(`/storage/v1/object/authenticated/${PLAYLIST_BUCKET}/${encPath(path)}`);
        if (!r.ok) return null;
        blob = await r.blob();
        db.put('covers', 'plcache:' + path, blob).catch(() => {});   // si no cabe, se vuelve a pedir otro día
      }
      return URL.createObjectURL(blob);
    })().catch(() => { urls.delete(path); return null; }));
  }
  return urls.get(path);
}

// ------------------------------------------------------------ imágenes solo locales
// {id, pid, role, blob, thumb, size, mime, w, h, caption, state: 'local' | 'pending', at}
//  'local'   → más de 16 MB, el usuario eligió usarla en este dispositivo. No se sube nunca.
//  'pending' → cabe en la nube pero aún no se pudo subir (sin conexión, subida interrumpida…).
export async function saveLocal(rec) {
  try { await db.put('covers', 'plimg:' + rec.id, rec); }
  catch (e) {
    const err = new Error(e?.name === 'QuotaExceededError' ? 'No queda espacio en este dispositivo para guardar la foto' : 'No se pudo guardar la foto en este dispositivo');
    err.quota = e?.name === 'QuotaExceededError';
    throw err;
  }
  navigator.storage?.persist?.().catch(() => {});
}
export const getLocal = id => db.get('covers', 'plimg:' + id).catch(() => null);
export async function dropLocal(id) { forget('local:' + id); forget('localt:' + id); await db.del('covers', 'plimg:' + id).catch(() => {}); }
export function localUrl(id, thumb = false) {
  const key = (thumb ? 'localt:' : 'local:') + id;
  if (!urls.has(key)) urls.set(key, getLocal(id).then(r => (r ? URL.createObjectURL(thumb && r.thumb ? r.thumb : r.blob) : null)));
  return urls.get(key);
}
/** ¿El navegador garantiza que las fotos locales no se borrarán solas? */
export async function persistent() {
  try { return (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false; } catch { return false; }
}
