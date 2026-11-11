// Envoltorio mínimo sobre IndexedDB. Todos los almacenes usan claves externas.
const STORES = ['tracks', 'blobs', 'covers', 'playlists', 'kv'];
let dbp;

export function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('fiora', 1);
      r.onupgradeneeded = () => {
        for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = t.onabort = () => rej(t.error);
  }));
}

export const get = (s, k) => tx(s, 'readonly', o => o.get(k));
export const put = (s, k, v) => tx(s, 'readwrite', o => o.put(v, k));
export const del = (s, k) => tx(s, 'readwrite', o => o.delete(k));
export const all = s => tx(s, 'readonly', o => o.getAll());
