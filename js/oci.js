// Peticiones firmadas a la API de Oracle Cloud Object Storage, hechas desde el navegador.
// Las URL de bucket (PAR) no permiten borrar objetos, así que para borrar de verdad hace falta
// una clave de API del usuario de Oracle. La firma sigue
// https://docs.oracle.com/en-us/iaas/Content/API/Concepts/signingrequests.htm
// (RSA-SHA256 sobre "(request-target)", "host" y "x-date").
// La clave privada se importa como CryptoKey NO exportable y se guarda solo en este dispositivo.
import * as db from './db.js';
import { S, saveKV } from './store.js';

const KEY = 'oci-key';

/** Lee el texto de «Configuration file preview» que muestra Oracle al crear la clave de API. */
export function parseConfig(text) {
  const get = k => (String(text || '').match(new RegExp(`^\\s*${k}\\s*=\\s*(\\S+)`, 'mi')) || [])[1] || '';
  const c = { user: get('user'), fingerprint: get('fingerprint').toLowerCase(), tenancy: get('tenancy'), region: get('region') };
  if (!/^ocid1\.user\./.test(c.user)) throw new Error('Falta la línea «user=ocid1.user…» de la configuración');
  if (!/^ocid1\.tenancy\./.test(c.tenancy)) throw new Error('Falta la línea «tenancy=ocid1.tenancy…» de la configuración');
  if (!/^([0-9a-f]{2}:){15}[0-9a-f]{2}$/.test(c.fingerprint)) throw new Error('Falta la línea «fingerprint=xx:xx:…» de la configuración');
  return c;
}

// --- Clave privada (PEM) -----------------------------------------------------
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const derLen = n => (n < 128 ? [n] : n < 256 ? [0x81, n] : n < 65536 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255]);
const der = (tag, bytes) => new Uint8Array([tag, ...derLen(bytes.length), ...bytes]);
/** Envuelve una clave RSA en formato PKCS#1 («BEGIN RSA PRIVATE KEY») en PKCS#8, que es lo que entiende WebCrypto. */
function pkcs1to8(pkcs1) {
  const algo = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  return der(0x30, [0x02, 0x01, 0x00, ...algo, ...der(0x04, pkcs1)]);
}
export async function importPem(pem) {
  pem = String(pem || '');
  if (/ENCRYPTED/.test(pem)) throw new Error('La clave privada tiene contraseña. Usa la que descarga Oracle al generar la clave (sin contraseña).');
  const m = pem.match(/-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END \1?PRIVATE KEY-----/);
  if (!m) throw new Error('El archivo no parece una clave privada (.pem)');
  let bytes = b64(m[2].replace(/[^A-Za-z0-9+/=]/g, ''));
  if (m[1]) bytes = pkcs1to8(bytes);
  try {
    return await crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch { throw new Error('No se pudo leer la clave privada'); }
}

// --- Configuración guardada en el dispositivo -------------------------------
export const configured = () => !!S.settings.oci?.user;
let keyCache = null;
async function key() {
  if (!keyCache) keyCache = await db.get('kv', KEY);
  if (!keyCache) throw new Error('Falta la clave privada de Oracle');
  return keyCache;
}
export async function save(cfg, cryptoKey) {
  await db.put('kv', KEY, cryptoKey);
  keyCache = cryptoKey;
  S.settings.oci = { user: cfg.user, fingerprint: cfg.fingerprint, tenancy: cfg.tenancy };
  await saveKV('settings', false);
}
export async function forget() {
  await db.del('kv', KEY).catch(() => {});
  keyCache = null;
  delete S.settings.oci;
  await saveKV('settings', false);
}

// --- Firma ---------------------------------------------------------------------
// Codificación estricta de RFC 3986 (encodeURIComponent deja sin codificar !'()*).
export const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** Texto que se firma y cabecera Authorization para una petición sin cuerpo (GET, HEAD, DELETE). */
export async function sign(method, url, cfg, cryptoKey, date = new Date().toUTCString()) {
  const u = new URL(url);
  const signing = `(request-target): ${method.toLowerCase()} ${u.pathname}${u.search}\nhost: ${u.host}\nx-date: ${date}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signing));
  const s64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  const auth = `Signature version="1",keyId="${cfg.tenancy}/${cfg.user}/${cfg.fingerprint}",algorithm="rsa-sha256",headers="(request-target) host x-date",signature="${s64}"`;
  return { signing, headers: { 'x-date': date, authorization: auth } };
}

/** Punto de acceso de la API y nombres de namespace/bucket a partir de la URL de la PAR. */
export function target(parUrl) {
  const u = new URL(parUrl);
  const m = u.pathname.match(/\/n\/([^/]+)\/b\/([^/]+)\/o\/?$/);
  if (!m) throw new Error('No se reconoce el bucket en la URL de la PAR');
  const region = u.hostname.match(/(?:^|\.)objectstorage\.([a-z0-9-]+)\./)?.[1];
  // El punto de acceso clásico sirve para cualquier namespace; en pruebas locales se usa el mismo origen.
  return { base: region ? `https://objectstorage.${region}.oraclecloud.com` : u.origin, ns: decodeURIComponent(m[1]), bucket: decodeURIComponent(m[2]) };
}

async function call(method, url) {
  const cfg = S.settings.oci;
  if (!cfg?.user) throw new Error('No hay clave de API de Oracle');
  const { headers } = await sign(method, url, cfg, await key());
  const r = await fetch(url, { method, headers, cache: 'no-store' });
  let code = '';
  if (!r.ok) { try { code = (await r.json()).code || ''; } catch { /* sin cuerpo */ } }
  return { r, code };
}
const explain = (r, code, what) => {
  if (r.status === 401) return `Oracle no aceptó la clave de API (401${code ? ` ${code}` : ''}). Revisa que la configuración y el archivo .pem sean de la misma clave y que la hora del dispositivo sea correcta.`;
  if (r.status === 404 || r.status === 403) return `Oracle no deja ${what} (${r.status}${code ? ` ${code}` : ''}): tu usuario no tiene permiso sobre ese bucket o no existe.`;
  return `Oracle respondió ${r.status}${code ? ` ${code}` : ''} al ${what}`;
};

/** Comprueba la clave leyendo los datos del bucket. */
export async function check(parUrl) {
  const { base, ns, bucket } = target(parUrl);
  const { r, code } = await call('GET', `${base}/n/${enc(ns)}/b/${enc(bucket)}`);
  if (!r.ok) throw new Error(explain(r, code, 'leer el bucket'));
}

/** Borra un objeto. Si ya no existía, también cuenta como borrado. */
export async function deleteObject(parUrl, name) {
  const { base, ns, bucket } = target(parUrl);
  const { r, code } = await call('DELETE', `${base}/n/${enc(ns)}/b/${enc(bucket)}/o/${enc(name)}`);
  if (r.ok || code === 'ObjectNotFound') return;
  throw new Error(explain(r, code, 'borrar el archivo'));
}
