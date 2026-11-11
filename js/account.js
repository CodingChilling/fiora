// Cuenta de usuario con Supabase (correo y contraseña), usando su API REST directamente.
//   Autenticación: {url}/auth/v1/...      Datos: {url}/rest/v1/fiora_datos (una fila por usuario)
import * as db from './db.js';
import { S, saveKV, emit, on } from './store.js';
import { snapshot, merge, clearPersonal } from './sync.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const TABLE = 'fiora_datos';
let session = null;      // {access_token, refresh_token, expires_at, user: {id, email}}

const cfg = () => ({
  url: (SUPABASE_URL || S.settings.sbUrl || '').trim().replace(/\/+$/, ''),
  key: (SUPABASE_KEY || S.settings.sbKey || '').trim(),
});
export const builtIn = () => !!(SUPABASE_URL && SUPABASE_KEY);
export const available = () => !!(cfg().url && cfg().key);
export const user = () => session?.user || null;

const MESSAGES = {
  invalid_credentials: 'Correo o contraseña incorrectos',
  invalid_grant: 'Correo o contraseña incorrectos',
  email_not_confirmed: 'Confirma tu correo con el enlace que te enviamos antes de entrar',
  user_already_exists: 'Ya existe una cuenta con ese correo',
  email_exists: 'Ya existe una cuenta con ese correo',
  weak_password: 'La contraseña es demasiado débil (usa al menos 6 caracteres)',
  over_email_send_rate_limit: 'Demasiados correos enviados. Espera unos minutos',
  over_request_rate_limit: 'Demasiados intentos. Espera unos minutos',
  signup_disabled: 'El registro está desactivado en este proyecto de Supabase',
  same_password: 'La contraseña nueva debe ser distinta de la anterior',
  validation_failed: 'Revisa el correo y la contraseña',
};

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const { url, key } = cfg();
  let r;
  try {
    r = await fetch(url + path, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${token || key}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error(navigator.onLine ? 'No se pudo contactar con Supabase. Revisa la URL del proyecto' : 'No hay conexión a internet'); }
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* respuesta sin JSON */ }
  if (!r.ok) {
    const code = data?.error_code || data?.error || data?.code || '';
    const e = new Error(MESSAGES[code] || data?.msg || data?.error_description || data?.message || `Respuesta ${r.status}`);
    e.status = r.status; e.code = code;
    throw e;
  }
  return data;
}

async function setSession(data) {
  session = data && {
    access_token: data.access_token, refresh_token: data.refresh_token,
    expires_at: data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in || 3600) * 1000,
    user: { id: data.user.id, email: data.user.email },
  };
  await db.put('kv', 'session', session);
  emit('account');
}

/** Token de acceso vigente; lo renueva si está a punto de caducar. */
async function token() {
  if (!session) throw new Error('No has iniciado sesión');
  if (session.expires_at - Date.now() > 60000) return session.access_token;
  try {
    const d = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
    await setSession(d);
  } catch (e) {
    if (e.status >= 400 && e.status < 500) { await setSession(null); throw new Error('Tu sesión ha caducado. Vuelve a iniciar sesión'); }
    throw e;
  }
  return session.access_token;
}

/** Tras entrar: si es otra persona distinta de la última, sus datos no se mezclan con los anteriores. */
async function afterLogin() {
  const id = session.user.id;
  if (S.settings.accountId && S.settings.accountId !== id) await clearPersonal();
  S.settings.accountId = id;
  await saveKV('settings', false);
  await sync();
}

export async function signIn(email, password) {
  const d = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  await setSession(d);
  await afterLogin();
}

/** Devuelve true si ya ha entrado, o false si falta confirmar el correo. */
export async function signUp(email, password) {
  const d = await api(`/auth/v1/signup?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { method: 'POST', body: { email, password } });
  if (!d?.access_token) return false;
  await setSession(d);
  await afterLogin();
  return true;
}

export async function signOut() {
  const t = session?.access_token;
  await setSession(null);
  if (t) api('/auth/v1/logout', { method: 'POST', token: t }).catch(() => {});
}

export const recover = email =>
  api(`/auth/v1/recover?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { method: 'POST', body: { email } });

export const setPassword = async password => api('/auth/v1/user', { method: 'PUT', token: await token(), body: { password } });

/** Descarga los datos de la cuenta, los fusiona con los del dispositivo y guarda el resultado. */
export async function sync() {
  const t = await token();
  const rows = await api(`/rest/v1/${TABLE}?select=datos`, { token: t });
  if (rows?.[0]?.datos) await merge(rows[0].datos);
  await api(`/rest/v1/${TABLE}?on_conflict=user_id`, {
    method: 'POST', token: t, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { user_id: session.user.id, datos: snapshot(true), actualizado: new Date().toISOString() },
  });
  S.settings.accountSync = Date.now();
  await saveKV('settings', false);
}

/**
 * Arranque: recupera la sesión guardada. Si la página se abrió desde un enlace de correo de
 * Supabase (confirmación o cambio de contraseña), la sesión viene en el fragmento de la URL.
 * Devuelve 'recovery' cuando hay que pedir una contraseña nueva.
 */
export async function init() {
  session = (await db.get('kv', 'session').catch(() => null)) || null;
  const h = location.hash.slice(1);
  if (!/(^|&)(access_token|error_description)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + '#/ajustes');
  if (p.get('error_description')) { emit('toast', `El enlace no es válido o ha caducado (${p.get('error_description')})`); return null; }
  try {
    const access_token = p.get('access_token');
    const u = await api('/auth/v1/user', { token: access_token });
    await setSession({ access_token, refresh_token: p.get('refresh_token'), expires_in: +p.get('expires_in') || 3600, user: u });
    await afterLogin();
    return p.get('type') === 'recovery' ? 'recovery' : 'confirmed';
  } catch (e) { emit('toast', `No se pudo iniciar sesión con el enlace: ${e.message}`); return null; }
}

// Guardado automático (con retardo) cuando cambia algo.
let timer = null;
on('dirty', () => {
  if (!session || !navigator.onLine) return;
  clearTimeout(timer);
  timer = setTimeout(() => sync().catch(e => console.warn('Cuenta: guardado pendiente', e)), 5000);
});
