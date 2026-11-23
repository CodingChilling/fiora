// Reproductor: cola, aleatorio, repetición, fundidos, mezcla cruzada y Media Session.
import * as db from './db.js';
import { S, emit, countPlay, countSkip, countDone, countNext, saveTrack, saveKV } from './store.js';
import { coverUrl } from './library.js';
import { objectUrl, configured } from './cloud.js';
import { songRadio } from './recs.js';
import * as spatial from './spatial.js';
import * as fades from './fades.js';

// Elementos de audio, en dos rutas:
//   · main    — la de siempre. Radios, música de Explorar, 8D apagado y todo lo que no se pueda procesar.
//               Nunca se conecta a Web Audio, así que nada del audio espacial puede dejarlo en silencio.
//   · spatial — la del audio espacial (spatial.js), solo para canciones de la biblioteca compatibles.
// Cada ruta tiene dos elementos. Normalmente suena uno solo; el segundo solo entra en una mezcla
// cruzada, mientras la canción que se va se desvanece (`outgoing`).
// `audio` es el que manda en cada momento (tiempo, duración, eventos).
const mk = () => { const a = new Audio(); a.preload = 'auto'; return a; };
const mains = [mk(), mk()];
let audio = mains[0];
const last = { main: mains[0], spatial: null };   // último elemento usado de cada ruta
const outgoing = new Set();                       // canciones que se están despidiendo en una mezcla
const urls = new Map();                           // elemento → dirección blob: que hay que liberar al vaciarlo
let curSrc = '';          // dirección de lo que suena (para volver al original si la ruta espacial falla)
let watchdog = null;
let vol = 1;              // volumen elegido por el usuario; los fundidos lo multiplican, nunca lo cambian

const kindOf = el => (spatial.owns(el) ? 'spatial' : 'main');
const poolOf = kind => (kind === 'spatial' ? [spatial.element(), spatial.partner()].filter(Boolean) : mains);
/** Elemento para la próxima canción: el de siempre de la ruta o, si se van a solapar, el otro. */
function pick(kind, overlap) {
  const pool = poolOf(kind);
  if (!overlap) return pool.includes(last[kind]) ? last[kind] : pool[0];
  return pool.find(e => e !== audio && !outgoing.has(e)) || pool.find(e => e !== audio) || pool[0];
}
/** Deja un elemento parado y vacío. */
function stopEl(el) {
  const f = fx.get(el);
  if (f?.ramp) { const r = f.ramp; f.ramp = null; r.done(false); }
  fx.delete(el); outgoing.delete(el);
  el.pause(); el.removeAttribute('src'); el.load();
  const u = urls.get(el);
  if (u) { urls.delete(el); URL.revokeObjectURL(u); }
}
/** Este elemento pasa a ser el dueño de una dirección blob: (se libera cuando deje de usarla). */
function own(el, src) {
  if (!src?.startsWith('blob:')) return;
  for (const [k, u] of urls) if (u === src && k !== el) urls.delete(k);   // pasa de un elemento a otro
  const prev = urls.get(el);
  urls.set(el, src);
  if (prev && prev !== src) URL.revokeObjectURL(prev);
}
/**
 * Pasa a usar un elemento. El anterior se para y se vacía; con `keep` segundos, en cambio, se
 * desvanece durante ese tiempo mientras empieza el nuevo (mezcla cruzada). Un cambio sin mezcla
 * corta también cualquier despedida que siguiera sonando.
 */
function use(el, keep = 0) {
  if (outgoing.has(el)) stopEl(el);
  const old = audio;
  audio = el;
  last[kindOf(el)] = el;
  if (keep <= 0) for (const o of [...outgoing]) stopEl(o);
  if (old === el) return;
  if (keep > 0 && !old.paused && old.getAttribute('src')) {
    outgoing.add(old);
    fadeTo(old, 0, keep).then(ok => { if (ok) stopEl(old); });
    run();
  } else stopEl(old);
}

// --- Fundidos ---------------------------------------------------------------
// Cada elemento lleva su estado: `fin` (fundido de entrada propio de una mezcla; null: el de los
// ajustes), `g` (ganancia de las rampas de pausa y despedida) y `ramp` (la rampa en curso).
const fx = new Map();
const fresh = (t, fin = null) => ({ fin, g: 1, ramp: null, radio: !!t?.radio });
function gainOf(el) {
  const f = fx.get(el);
  if (!f || !fades.volumeControl()) return 1;
  let g = f.g;
  if (!f.radio) {
    const s = fades.settings(), d = el.duration;
    const { fin, fout } = fades.shape(s, d);
    g *= fades.positional(el.currentTime || 0, d, f.fin ?? fin, fout);
  }
  return g;
}
function setVol(el) {
  const v = Math.max(0, Math.min(1, vol * gainOf(el)));
  if (el.volume !== v) el.volume = v;
}
/** Lleva la ganancia de rampa de un elemento a `to` en `secs` segundos. Devuelve false si otra rampa la sustituye. */
function fadeTo(el, to, secs) {
  let f = fx.get(el);
  if (!f) { f = fresh(null); fx.set(el, f); }
  if (f.ramp) { const r = f.ramp; f.ramp = null; r.done(false); }
  return new Promise(done => {
    if (!(secs > 0) || !fades.volumeControl()) { f.g = to; setVol(el); return done(true); }
    f.ramp = { from: f.g, to, t0: performance.now(), dur: secs * 1000, done };
    run();
  });
}
let timer = null, crossedFor = -1;
let ready = -1;           // carga cuya canción ya está en el elemento que suena (mientras otra carga espera, `audio` sigue con la anterior)
function tick() {
  const now = performance.now();
  for (const el of [audio, ...outgoing]) {
    const f = fx.get(el);
    if (f?.ramp) {
      const r = f.ramp, p = (now - r.t0) / r.dur;
      f.g = r.to >= r.from ? r.from + (r.to - r.from) * fades.rise(p) : r.to + (r.from - r.to) * fades.fall(p);
      if (p >= 1) { f.g = r.to; f.ramp = null; r.done(true); }
    }
    if (fx.has(el)) setVol(el);
  }
  maybeCross();
  if (audio.paused && !outgoing.size && ![...fx.values()].some(f => f.ramp)) { clearInterval(timer); timer = null; }
}
function run() { if (!timer) timer = setInterval(tick, 40); }

/** ¿Hay algo detrás de lo que suena? (sin sacar nada de la cola) */
const skipOffline = t => !navigator.onLine && !t.radio && !t.hasBlob;
/** Mezcla cruzada automática: cuando a la canción le quedan los segundos del solape, empieza la siguiente. */
function maybeCross() {
  const t = P.now;
  if (!t || t.radio || audio.paused || ready !== loadToken || crossedFor === loadToken || P.repeat === 'one' || !fades.volumeControl()) return;
  const X = fades.crossFor(fades.settings(), audio.duration);
  if (!X || audio.duration - audio.currentTime > X || audio.currentTime < 1) return;
  crossedFor = loadToken;
  if (sess) sess.done = true;          // se ha escuchado hasta el final: cuenta como terminada
  next(true, { cross: X });
}

// Hay dos colas, como en los reproductores habituales:
//   · P.queue  — la lista que se está reproduciendo (un álbum, una playlist, una mezcla…) y, al
//                acabarse, la continuación automática con canciones parecidas (desde P.autoFrom).
//   · P.user   — lo que el usuario ha añadido a mano. Siempre suena antes de seguir con P.queue.
export const P = {
  get audio() { return audio; },
  queue: [],        // pistas (objetos); pueden ser de la biblioteca, de un catálogo o radios
  index: -1,        // posición en P.queue
  user: [],         // cola del usuario
  now: null,        // pista que suena
  fromUser: false,  // la pista que suena salió de la cola del usuario
  autoFrom: -1,     // índice de P.queue donde empieza la continuación automática (-1: no hay)
  ctx: null,        // de dónde viene lo que suena ({playlist: id}), para las estadísticas
  shuffle: false,
  repeat: 'off',    // off | all | one
  get current() { return this.now; },
  get playing() { return !audio.paused; },
};

let original = null;     // orden original de la cola mientras el aleatorio está activo
let loadToken = 0;
let counted = false;
let errors = 0;
let sess = null;          // escucha en curso: {id, max, dur, done, error}
let lastHeard = null;     // última canción escuchada de verdad: {id, at}
const radioClock = { id: null, secs: 0, last: 0 };   // tiempo real de escucha de la emisora en curso

/** Cierra la escucha anterior y anota si se terminó o se saltó. */
function settle() {
  const s = sess; sess = null;
  if (!s || !S.tracks.has(s.id) || s.error) return;
  if (s.done || (s.dur && s.max / s.dur > 0.9)) countDone(s.id);
  else if (s.max < 30 && (!s.dur || s.max / s.dur < 0.5)) countSkip(s.id);
}

const shuffled = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

async function resolveSrc(t) {
  if (t.radio) return t.url;
  if (t.hasBlob) {
    const blob = await db.get('blobs', t.id);
    if (blob) return URL.createObjectURL(blob);     // se libera al vaciar el elemento que la use (own/stopEl)
  }
  if (t.cloudName && configured()) return objectUrl(t.cloudName, t.bucketId);
  if (t.url) return t.url;
  throw new Error('Esta canción no está disponible en este dispositivo');
}

/**
 * Segundos que se solapará la canción nueva con la que suena (0: cambio normal).
 *   · opts.cross — mezcla cruzada automática al final de una canción.
 *   · cambio a mano (siguiente, anterior, elegir otra) con «Mezclar al saltar de canción».
 * Nunca con radios, ni si lo que suena está en pausa o el navegador no deja cambiar el volumen.
 */
function overlapFor(t, opts) {
  const cur = fx.get(audio);
  if (!t || t.radio || !cur || cur.radio || audio.paused || !audio.getAttribute('src') || !fades.volumeControl()) return 0;
  if (opts.cross) return opts.cross;
  const s = fades.settings();
  if (opts.auto || !s.manual) return 0;
  return s.mode === 'cross' ? Math.min(s.cross, fades.MANUAL_MAX) : 1;
}

async function load(autoplay = true, opts = {}) {
  const t = P.current;
  const token = ++loadToken;
  counted = false;
  settle();
  if (t && !t.radio) sess = { id: t.id, max: 0, dur: 0 };
  radioClock.id = null; radioClock.secs = 0;
  emit('track', t);
  let used = null;
  if (!t) { clearTimeout(watchdog); use(pick('main', 0)); curSrc = ''; audio.removeAttribute('src'); audio.load(); return; }
  const overlap = overlapFor(t, opts);
  try {
    const src = await resolveSrc(t);
    if (token !== loadToken) { if (src.startsWith('blob:')) URL.revokeObjectURL(src); return; }
    // ¿Ruta espacial? Solo canciones de la biblioteca con el 8D activado y fuente compatible.
    const target = spatial.settings().on && !t.radio && prepareSpatial() ? pick('spatial', overlap) : null;
    const spatialRoute = await spatial.routeFor(t, src, target).catch(() => false);
    if (token !== loadToken) { if (src.startsWith('blob:')) URL.revokeObjectURL(src); return; }
    clearTimeout(watchdog);
    const el = pick(spatialRoute ? 'spatial' : 'main', overlap);
    use(el, el === audio ? 0 : overlap);
    fx.set(el, fresh(t, overlap || null));       // en una mezcla, la nueva entra durante el mismo solape
    own(el, src);
    curSrc = src;
    used = el;
    setVol(el);
    el.src = src;
    ready = token;
    run();
    if (autoplay) await el.play();
    if (spatialRoute) guard(token);
  } catch (e) {
    if (token !== loadToken || e?.name === 'AbortError') return;
    if (used && used !== audio) return;      // falló la ruta espacial y la canción ya sigue por la normal
    // El navegador no deja arrancar un segundo elemento sin un toque: se repite sin solapar.
    if (overlap && e?.name === 'NotAllowedError') return load(autoplay, { ...opts, cross: 0, auto: true });
    onError(e);
  }
  updateMediaSession(t);
}

/** Vigila la ruta espacial: si el sonido no arranca de verdad, la misma canción vuelve al elemento normal. */
function guard(token) {
  clearTimeout(watchdog);
  const at = audio.currentTime;
  watchdog = setTimeout(() => {
    if (token !== loadToken || kindOf(audio) === 'main' || audio.paused) return;
    if (!spatial.contextRunning() || (audio.currentTime <= at && audio.readyState >= 2)) fallback('contexto');
  }, 1800);
}
/** La ruta espacial ha fallado: suena el original, en el mismo punto y sin avisos. La preferencia no cambia. */
function fallback(reason) {
  if (kindOf(audio) === 'main' || !curSrc) return false;
  const t = P.current, pos = audio.currentTime || 0, wasPlaying = !audio.paused || audio.readyState < 2;
  const f = fx.get(audio);
  spatial.failed(t, curSrc, reason);
  const m = pick('main', 0);
  own(m, curSrc);                       // la dirección pasa al elemento normal antes de vaciar el espacial
  use(m);
  fx.set(m, f || fresh(t));
  setVol(m);
  m.src = curSrc;
  if (pos > 0.5) m.addEventListener('loadedmetadata', () => { try { m.currentTime = pos; } catch { /* sin búsqueda */ } }, { once: true });
  if (wasPlaying) m.play().catch(onError);
  return true;
}
/**
 * Cambia de ruta la canción que suena (al activar el audio espacial a mitad de canción), en el mismo
 * punto y sin contarla de nuevo. Al desactivarlo no hace falta: el grafo se queda en la rama original.
 */
export async function reroute() {
  const t = P.current;
  if (!t || t.radio || !audio.src || kindOf(audio) !== 'main') return;
  const token = loadToken, pos = audio.currentTime || 0, wasPlaying = !audio.paused;
  if (!prepareSpatial()) return;
  const el = pick('spatial', 0);
  if (!(await spatial.routeFor(t, curSrc, el).catch(() => false)) || token !== loadToken || kindOf(audio) !== 'main') return;
  let src = curSrc;
  try { src = await resolveSrc(t); } catch { return; }
  if (token !== loadToken) { if (src !== curSrc && src.startsWith('blob:')) URL.revokeObjectURL(src); return; }
  const f = fx.get(audio);
  use(el);
  fx.set(el, f || fresh(t));
  own(el, src);
  curSrc = src; setVol(el); el.src = src;
  el.addEventListener('loadedmetadata', () => { try { el.currentTime = pos; } catch { /* sin búsqueda */ } }, { once: true });
  if (wasPlaying) { try { await el.play(); guard(token); } catch (e) { if (e?.name !== 'AbortError') fallback('error'); } }
  emit('state');
}

function onError(e) {
  if (kindOf(audio) !== 'main' && fallback('error')) return;      // el fallo era de la ruta espacial: se sigue con el original
  const t = P.current;
  if (sess) sess.error = true;
  if (t?.radio) {
    // Las experiencias de radio (ruleta, viajes, degustación) buscan otra emisora; si alguna lo hace, no se avisa aquí.
    const ev = { track: t, handled: false };
    emit('play-error', ev);
    if (ev.handled) { console.warn(e); return; }
  }
  emit('toast', `No se pudo reproducir «${t?.title || ''}»${navigator.onLine ? '' : ' (sin conexión)'}`);
  console.warn(e);
  if (++errors < 3 && (P.user.length || P.index < P.queue.length - 1)) next(true);
  else { errors = 0; emit('state'); }
}

const canPlay = t => !!(t.hasBlob || t.url || (t.cloudName && configured()));

/** Al acabarse la lista, la alarga con canciones parecidas a la última. Devuelve true si añadió alguna. */
function extend() {
  const seed = P.queue[P.index];
  if (S.settings.autoplay === false || !seed || seed.radio || !S.tracks.has(seed.id)) return false;
  const have = new Set(P.queue.map(t => t.id));
  const more = songRadio(seed, 30).slice(1).filter(t => !have.has(t.id) && canPlay(t) && !skipOffline(t)).slice(0, 20);
  if (!more.length) return false;
  if (P.autoFrom < 0) P.autoFrom = P.queue.length;
  P.queue.push(...more);
  if (original) original.push(...more);
  emit('queue');
  return true;
}

function playContext(i, opts = {}) {
  P.index = i; P.now = P.queue[i] || null; P.fromUser = false;
  if (!opts.auto) errors = 0;
  load(true, opts);
}

/** Sustituye la lista en reproducción y empieza desde `start`. La cola del usuario se conserva. */
/**
 * Reproduce una lista. `ctx` dice de dónde viene (p. ej. {playlist: id}) para las estadísticas
 * de esa playlist; no cambia nada de cómo suena.
 */
export function playQueue(tracks, start = 0, ctx = null) {
  if (!tracks.length) return;
  const first = tracks[start];
  P.autoFrom = -1;
  P.ctx = ctx;
  if (P.shuffle) {
    original = tracks.slice();
    P.queue = [first, ...shuffled(tracks.filter((_, i) => i !== start))];
    start = 0;
  } else {
    original = null;
    P.queue = tracks.slice();
  }
  emit('queue');
  playContext(start);
}

/** Salta a una posición de la lista en reproducción. */
export function jump(i) {
  if (i >= 0 && i < P.queue.length) playContext(i);
}

/** Reproduce ya una canción de la cola del usuario (y la saca de ella). */
export function jumpUser(i, opts = {}) {
  if (i < 0 || i >= P.user.length) return;
  P.now = P.user.splice(i, 1)[0]; P.fromUser = true;
  if (!opts.auto) errors = 0;
  emit('queue');
  load(true, opts);
}

export function toggle() {
  if (!P.current) return;
  if (!audio.src) return load();
  audio.paused || pausing ? resume() : pause();
}

// Pausa y reanudación, con un fundido corto si está activado en los ajustes.
let pausing = 0;
export function pause() {
  for (const o of [...outgoing]) stopEl(o);         // una mezcla a medias se resuelve: queda la canción nueva
  if (audio.paused) return;
  const el = audio, tok = ++pausing;
  if (!fades.settings().pause || !fades.volumeControl()) { pausing = 0; return el.pause(); }
  fadeTo(el, 0, fades.PAUSE_SECS).then(ok => { if (ok && tok === pausing && el === audio) { pausing = 0; el.pause(); } });
}
export function resume() {
  const el = audio, soft = fades.settings().pause && fades.volumeControl();
  pausing = 0;
  if (!fx.has(el)) fx.set(el, fresh(P.current));
  if (!soft) { fadeTo(el, 1, 0); return el.play().catch(onError); }
  if (el.paused) { fx.get(el).g = 0; setVol(el); }
  fadeTo(el, 1, fades.PAUSE_SECS);
  return el.play().catch(onError);
}

/**
 * Pasa a la siguiente. `auto`: porque la canción acabó (o empieza su mezcla cruzada, `opts.cross`).
 * Sin conexión se saltan las canciones que no están descargadas.
 */
export function next(auto = false, opts = {}) {
  if (!P.now) return;
  if (auto && P.repeat === 'one' && !opts.cross) { audio.currentTime = 0; audio.play(); return; }
  const o = { ...opts, auto };
  const ok = t => !skipOffline(t);
  const u = P.user.findIndex(ok);
  if (u >= 0) return jumpUser(u, o);                 // primero, lo que el usuario puso en cola
  for (let i = P.index + 1; i < P.queue.length; i++) if (ok(P.queue[i])) return playContext(i, o);
  if (P.repeat === 'all') { const i = P.queue.findIndex(ok); if (i >= 0) return playContext(i, o); }
  if (extend()) return playContext(P.index + 1, o);  // continuación automática
  if (opts.cross) return;                            // no hay nada detrás: la canción termina sola
  if (!auto) { const i = P.queue.findIndex(ok); if (i >= 0) return playContext(i, o); }
  P.fromUser = false;
  audio.pause(); emit('state');
}

export function prev() {
  if (audio.currentTime > 4) { audio.currentTime = 0; return; }
  if (P.fromUser) return playContext(P.index);       // vuelve a la lista donde se quedó
  for (let i = P.index - 1; i >= 0; i--) if (!skipOffline(P.queue[i])) return playContext(i);
  audio.currentTime = 0;
}

export function seek(sec) {
  if (Number.isFinite(sec) && Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(sec, audio.duration));
}

export function toggleShuffle() {
  P.shuffle = !P.shuffle;
  const cur = P.queue[P.index];
  if (P.shuffle) {
    original = P.queue.slice();
    if (cur) { P.queue = [cur, ...shuffled(P.queue.filter((_, i) => i !== P.index))]; P.index = 0; }
    P.autoFrom = -1;
  } else if (original) {
    P.queue = original; original = null;
    P.index = Math.max(0, P.queue.indexOf(cur));
    P.autoFrom = -1;
  }
  emit('queue'); emit('state');
}

export function cycleRepeat() {
  P.repeat = { off: 'all', all: 'one', one: 'off' }[P.repeat];
  emit('state');
}

/** Añade canciones a la cola del usuario: al final, o delante de todo con `playNext`. */
export function enqueue(tracks, playNext = false) {
  if (!P.now) return playQueue(tracks);
  // Si alguna ya estaba en la reproducción automática, pasa a tu cola (no suena dos veces).
  const ids = new Set(tracks.map(t => t.id));
  for (let i = P.queue.length - 1; i > P.index; i--) {
    if (!isAuto(i) || !ids.has(P.queue[i].id)) continue;
    const [x] = P.queue.splice(i, 1);
    if (original) original = original.filter(y => y !== x);
  }
  if (playNext) P.user.unshift(...tracks); else P.user.push(...tracks);
  emit('queue');
}
/** ¿Esta posición de la lista en reproducción aún está por sonar? */
export const isUpcoming = i => i > P.index && i < P.queue.length;
/**
 * Pone en tu cola una canción que ya está por sonar en la lista. Si es de la reproducción automática,
 * sale de ella; si es de la lista que escuchas (álbum, playlist…), además de sonar antes, sigue en su sitio.
 */
export function queueUpcoming(i, playNext = false) {
  if (!isUpcoming(i)) return 0;
  if (isAuto(i)) return promote([i], playNext);
  const t = P.queue[i];
  if (playNext) P.user.unshift(t); else P.user.push(t);
  emit('queue');
  return 1;
}

/** ¿Esta posición de la lista en reproducción es de la continuación automática (aún por sonar)? */
export const isAuto = i => P.autoFrom >= 0 && i >= P.autoFrom && i > P.index && i < P.queue.length;
/**
 * Pasa canciones de la reproducción automática a la cola del usuario (al final, o delante de todo
 * con `playNext`). Salen de la continuación automática para que no suenen dos veces.
 */
export function promote(indexes, playNext = false) {
  const picked = [...new Set(indexes)].filter(isAuto).sort((a, b) => a - b);
  if (!picked.length) return 0;
  const tracks = picked.map(i => P.queue[i]);
  for (const i of picked.slice().reverse()) P.queue.splice(i, 1);
  if (original) original = original.filter(t => !tracks.includes(t));
  if (playNext) P.user.unshift(...tracks); else P.user.push(...tracks);
  emit('queue');
  return tracks.length;
}

/** Quita una canción de la cola del usuario (`user`) o de la lista en reproducción. */
export function removeFromQueue(i, user = false) {
  if (user) { if (i >= 0 && i < P.user.length) P.user.splice(i, 1); emit('queue'); return; }
  if (i < 0 || i >= P.queue.length || (i === P.index && !P.fromUser)) return;
  const [t] = P.queue.splice(i, 1);
  if (original) original = original.filter(x => x !== t);
  if (i < P.index) P.index--;
  if (P.autoFrom > i) P.autoFrom--;
  emit('queue');
}

/** Quita de las colas las canciones borradas de la biblioteca (menos la que está sonando). */
export function forget(ids) {
  P.user = P.user.filter(t => !ids.has(t.id));
  for (let i = P.queue.length - 1; i >= 0; i--) if (ids.has(P.queue[i].id)) removeFromQueue(i);
  emit('queue');
}

export function clearUserQueue() { P.user = []; emit('queue'); }

/** Pone el volumen sin guardarlo (al arrancar o al recibirlo de la cuenta). */
export function applyVolume(v) {
  vol = Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 1));
  for (const el of [audio, ...outgoing]) setVol(el);
}
/** Volumen elegido (sin los fundidos del momento). */
export const volume = () => vol;
export function setVolume(v) {
  applyVolume(v);
  S.settings.volume = vol;
  S.settings.volAt = Date.now();
  saveKV('settings', false);
  emit('dirty');
}

// --- Eventos del elemento de audio ----------------------------------------
const handlers = [];
const listen = (name, fn) => handlers.push([name, fn]);
listen('ended', () => { if (sess) sess.done = true; next(true); });
listen('play', () => { errors = 0; run(); emit('state'); });
listen('pause', () => emit('state'));
listen('waiting', () => emit('state'));
listen('playing', () => emit('state'));
listen('error', () => { if (audio.src && P.current) onError(audio.error); });
listen('loadedmetadata', () => {
  const t = P.current;
  if (t && !t.radio && !t.duration && Number.isFinite(audio.duration)) {
    t.duration = audio.duration;
    if (S.tracks.has(t.id)) saveTrack(t);
  }
  emit('time');
});
listen('timeupdate', () => {
  const t = P.current;
  if (t && !counted && !t.radio && S.tracks.has(t.id) &&
      (audio.currentTime > 30 || (audio.duration && audio.currentTime > audio.duration / 2))) {
    counted = true;
    countPlay(t.id);
    // escucha dentro de una playlist (no cuenta lo que suena de la cola manual ni la continuación automática)
    if (P.ctx && !P.fromUser && (P.autoFrom < 0 || P.index < P.autoFrom)) emit('played', { id: t.id, ctx: P.ctx, secs: Number.isFinite(audio.duration) ? audio.duration : t.duration || 0 });
    if (lastHeard && lastHeard.id !== t.id && Date.now() - lastHeard.at < 30 * 60000) countNext(lastHeard.id, t.id);
    lastHeard = { id: t.id, at: Date.now() };
  }
  if (sess) { sess.max = Math.max(sess.max, audio.currentTime); sess.dur = Number.isFinite(audio.duration) ? audio.duration : 0; }
  // Segundos escuchados de verdad de la emisora actual (para el pasaporte y las sesiones por tiempo).
  if (t?.radio && !audio.paused) {
    const now = performance.now();
    if (radioClock.id === t.id && now - radioClock.last < 3000) radioClock.secs += (now - radioClock.last) / 1000;
    else if (radioClock.id !== t.id) radioClock.secs = 0;
    radioClock.id = t.id; radioClock.last = now;
    emit('radio-time', { track: t, secs: radioClock.secs });
  }
  tick();                                  // fundidos y mezcla cruzada (también si el temporizador va lento en segundo plano)
  emit('time');
  if ('mediaSession' in navigator && Number.isFinite(audio.duration) && audio.duration > 0) {
    try {
      navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate });
    } catch { /* algunos navegadores no lo admiten */ }
  }
});

/** Engancha los eventos a un elemento; solo cuenta el que está sonando. */
// Mientras se carga otra canción, el elemento que suena aún tiene la anterior: su final, sus errores y
// sus tiempos no deben atribuirse a la nueva (saltaría la canción elegida o contaría escuchas que no son).
const STALE = new Set(['ended', 'error', 'loadedmetadata', 'timeupdate']);
function bind(el) {
  for (const [name, fn] of handlers) el.addEventListener(name, () => { if (el === audio && (ready === loadToken || !STALE.has(name))) fn(); });
  // La canción que se despide en una mezcla se vacía al acabar (o si falla): ya no manda.
  for (const name of ['ended', 'error']) el.addEventListener(name, () => { if (outgoing.has(el)) stopEl(el); });
}
mains.forEach(bind);
let boundSpatial = false;
/** Los elementos espaciales se crean la primera vez que hacen falta: entonces se les enganchan los mismos eventos. */
export function prepareSpatial() {
  const el = spatial.element();
  if (el && !boundSpatial) { boundSpatial = true; bind(el); bind(spatial.partner()); }
  return el;
}

// --- Controles del sistema (pantalla de bloqueo, auriculares) --------------
async function updateMediaSession(t) {
  if (!('mediaSession' in navigator) || !t) return;
  const art = await coverUrl(t);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title, artist: t.artist || '', album: t.album || '',
    artwork: art ? [{ src: art, sizes: '400x400' }] : [],
  });
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* acción no admitida */ } };
  set('play', () => { if (P.current) audio.getAttribute('src') ? resume() : load(); });
  set('pause', pause);
  set('previoustrack', prev);
  set('nexttrack', () => next(false));
  set('seekto', d => seek(d.seekTime));
}

/**
 * Elementos de audio, para las pruebas: el último usado de cada ruta, todos, y los que se están
 * despidiendo en una mezcla (fuera de una mezcla nunca suenan dos a la vez).
 */
export const elements = () => ({
  main: last.main, spatial: spatial.hasElement() ? last.spatial || spatial.element() : null,
  all: [...mains, ...(spatial.hasElement() ? [spatial.element(), spatial.partner()] : [])], outgoing: [...outgoing],
});
