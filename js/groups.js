// Grupo de un bucket: las cuentas que pueden leer ese bucket de Oracle, para compartir playlists
// entre ellas.
//
// Quien creó el bucket (con la clave de API de Oracle en su dispositivo) guarda en él
// `_fiora/grupo.json` = {v, group, key}: el id del grupo y una clave aleatoria. Cualquiera que pueda
// leer el bucket (también con un enlace de solo lectura) la presenta a Supabase para entrar; Supabase
// solo guarda su huella. Al revocar un enlace se cambia la clave: quien ya no puede leer el bucket
// deja de estar en el grupo y de ver lo que le compartieron. En el bucket no hay nada personal:
// solo esos dos valores aleatorios.
import * as db from './db.js';
import { emit, on } from './store.js';
import * as account from './account.js';
import * as cloud from './cloud.js';

const FILE = '_fiora/grupo.json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// {[bucketId]: {id, status: 'ok'|'none'|'bad_key'|'error', name, owner, members}}
let state = {};
let mode = 'unknown';   // 'ready' · 'missing' (Supabase sin preparar) · 'unknown'
const save = () => db.put('kv', 'groups', state).catch(() => {});

async function rpc(fn, args) {
  const r = await account.authFetch(`/rest/v1/rpc/${fn}`, { method: 'POST', json: args });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(data?.message || `Supabase respondió ${r.status}`);
    e.code = data?.code; e.status = r.status;
    throw e;
  }
  return data;
}
const isMissing = e => ['PGRST202', 'PGRST205', '42883', '42P01'].includes(e.code);
const randomKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));

async function readFile(b) {
  const r = await fetch(cloud.objectUrl(FILE, b.id), { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`«${b.name}» respondió ${r.status} al leer el grupo`);
  const f = await r.json().catch(() => null);
  return f && UUID.test(f.group) && typeof f.key === 'string' && f.key.length >= 32 ? f : null;
}
async function writeFile(b, f) {
  if (!cloud.owns(b)) throw new Error('Solo quien tiene la clave de API de Oracle del bucket puede cambiar su grupo');
  const r = await fetch(cloud.objectUrl(FILE, b.id), { method: 'PUT', body: JSON.stringify(f), headers: { 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`«${b.name}» respondió ${r.status} al guardar el grupo`);
}

async function syncOne(b) {
  let f = await readFile(b);
  if (!f) {
    if (!cloud.owns(b)) { state[b.id] = { status: 'none' }; return; }
    f = { v: 1, group: crypto.randomUUID(), key: randomKey() };
    await rpc('fiora_create_group', { g: f.group, k: f.key });
    await writeFile(b, f);
  }
  let res = await rpc('fiora_join_group', { g: f.group, k: f.key });
  // grupo de otro proyecto de Supabase, o la clave del archivo cambió sin llegar a Supabase
  if (res.status === 'unknown' && cloud.owns(b)) res = await rpc('fiora_create_group', { g: f.group, k: f.key });
  else if (res.status === 'bad_key' && res.owner) { await rpc('fiora_rotate_group', { g: f.group, k: f.key }); res = await rpc('fiora_join_group', { g: f.group, k: f.key }); }
  state[b.id] = { id: f.group, status: res.status === 'ok' ? 'ok' : res.status, name: res.name || '', owner: !!res.owner, members: res.members || 1 };
}

let running = null;
/** Entra (o sigue) en el grupo de cada bucket conectado. Se llama tras sincronizar la nube. */
export function sync() {
  if (!account.user() || !navigator.onLine || !cloud.configured()) return Promise.resolve();
  running ||= (async () => {
    const before = JSON.stringify([mode, state]);
    const known = new Set(cloud.buckets().map(b => b.id));
    for (const id of Object.keys(state)) if (!known.has(id)) delete state[id];
    for (const b of cloud.buckets()) {
      try { await syncOne(b); mode = 'ready'; }
      catch (e) {
        if (isMissing(e)) { mode = 'missing'; break; }
        if (!e.network && !(e instanceof TypeError)) state[b.id] = { ...(state[b.id] || {}), status: 'error', error: e.message };
        console.warn('Grupo del bucket', b.name, e);
      }
    }
    await save();
    if (JSON.stringify([mode, state]) !== before) emit('groups');   // solo si algo cambió (si no, no se repinta nada)
  })().finally(() => { running = null; });
  return running;
}

/** Grupos en los que estás: [{id, bucket, name, owner, members}] (solo los vigentes). */
export function list() {
  return cloud.buckets().map(b => ({ b, g: state[b.id] })).filter(x => x.g?.status === 'ok' && x.g.id)
    .map(({ b, g }) => ({ id: g.id, bucket: b, name: g.name, owner: g.owner, members: g.members }));
}
export const of = bucketId => state[bucketId] || null;
export const status = () => mode;

/** Cambia la clave del grupo de un bucket propio (al revocar un enlace): quien no lea el bucket sale. */
export async function rotate(bucketId) {
  const b = cloud.buckets().find(x => x.id === bucketId), g = state[bucketId];
  if (!b || !g?.owner || !g.id || !account.user()) return false;
  const f = { v: 1, group: g.id, key: randomKey() };
  await writeFile(b, f);                                          // primero el bucket: si falla Supabase,
  await rpc('fiora_rotate_group', { g: g.id, k: f.key });         // la próxima sincronización lo arregla
  return true;
}

/** Nombre con el que te ven en el grupo (nunca se muestra el correo). */
export async function setName(groupId, name) {
  const res = await rpc('fiora_set_member_name', { g: groupId, name });
  for (const g of Object.values(state)) if (g.id === groupId) g.name = res.name;
  await save(); emit('groups');
  return res.name;
}
export const members = groupId => rpc('fiora_group_members', { g: groupId });

export async function init() {
  state = (await db.get('kv', 'groups').catch(() => null)) || {};
  on('personal-cleared', () => { state = {}; save(); });   // otra cuenta en este dispositivo
  on('account', () => { if (!account.user()) { state = {}; save(); emit('groups'); } else sync(); });
}
