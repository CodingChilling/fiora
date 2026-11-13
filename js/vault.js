// Cifrado de secretos en el dispositivo (claves de API de IA).
// Cada dispositivo genera una clave AES-GCM de 256 bits NO exportable: el navegador la guarda en
// IndexedDB pero nadie puede leer su valor, ni siquiera la app; solo puede usarla para cifrar y
// descifrar en este mismo dispositivo. Así, lo que queda en disco (o en una copia del perfil del
// navegador) es texto cifrado, y no sirve en otro dispositivo.
import * as db from './db.js';

const KEY = 'device-key';
const te = new TextEncoder(), td = new TextDecoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

let keyP = null;
function deviceKey() {
  keyP ||= (async () => {
    let k = await db.get('kv', KEY);
    if (!k) {
      k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await db.put('kv', KEY, k);
    }
    return k;
  })().catch(e => { keyP = null; throw e; });
  return keyP;
}

/** Un secreto ya cifrado: {v, iv, data, hint}. */
export const isSealed = x => !!(x && typeof x === 'object' && x.v === 1 && x.iv && x.data);

/**
 * Cifra `text`. `label` (p. ej. el proveedor) queda ligado al cifrado: un texto cifrado para un
 * proveedor no se puede hacer pasar por el de otro. `hint` son los 4 últimos caracteres, para
 * poder mostrar «Clave guardada (…abcd)» sin descifrar nada.
 */
export async function seal(text, label = '') {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(label) }, await deviceKey(), te.encode(text));
  return { v: 1, iv: b64(iv), data: b64(data), hint: text.slice(-4) };
}

export async function unseal(box, label = '') {
  if (!box) return '';
  if (typeof box === 'string') return box;   // valor antiguo sin cifrar (se cifra al arrancar)
  try {
    const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: te.encode(label) }, await deviceKey(), unb64(box.data));
    return td.decode(out);
  } catch {
    throw new Error('La clave guardada no se puede leer en este dispositivo. Vuelve a escribirla en Ajustes.');
  }
}
