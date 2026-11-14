// Reproductor: una sola etiqueta <audio>, cola, aleatorio, repetición y Media Session.
import * as db from './db.js';
import { S, emit, countPlay, countSkip, countDone, countNext, saveTrack, saveKV } from './store.js';
import { coverUrl } from './library.js';
import { objectUrl, configured } from './cloud.js';
import { songRadio } from './recs.js';

const audio = new Audio();
audio.preload = 'auto';

// Hay dos colas, como en los reproductores habituales:
//   · P.queue  — la lista que se está reproduciendo (un álbum, una playlist, una mezcla…) y, al
//                acabarse, la continuación automática con canciones parecidas (desde P.autoFrom).
//   · P.user   — lo que el usuario ha añadido a mano. Siempre suena antes de seguir con P.queue.
export const P = {
  audio,
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
let blobUrl = null;
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
    if (blob) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      return (blobUrl = URL.createObjectURL(blob));
    }
  }
  if (t.cloudName && configured()) return objectUrl(t.cloudName, t.bucketId);
  if (t.url) return t.url;
  throw new Error('Esta canción no está disponible en este dispositivo');
}

async function load(autoplay = true) {
  const t = P.current;
  const token = ++loadToken;
  counted = false;
  settle();
  if (t && !t.radio) sess = { id: t.id, max: 0, dur: 0 };
  radioClock.id = null; radioClock.secs = 0;
  emit('track', t);
  if (!t) { audio.removeAttribute('src'); audio.load(); return; }
  try {
    const src = await resolveSrc(t);
    if (token !== loadToken) return;
    audio.src = src;
    if (autoplay) await audio.play();
  } catch (e) {
    if (token !== loadToken || e?.name === 'AbortError') return;
    onError(e);
  }
  updateMediaSession(t);
}

function onError(e) {
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
  const more = songRadio(seed, 30).slice(1).filter(t => !have.has(t.id) && canPlay(t)).slice(0, 20);
  if (!more.length) return false;
  if (P.autoFrom < 0) P.autoFrom = P.queue.length;
  P.queue.push(...more);
  if (original) original.push(...more);
  emit('queue');
  return true;
}

function playContext(i) {
  P.index = i; P.now = P.queue[i] || null; P.fromUser = false;
  errors = 0;
  load();
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
export function jumpUser(i) {
  if (i < 0 || i >= P.user.length) return;
  P.now = P.user.splice(i, 1)[0]; P.fromUser = true;
  errors = 0;
  emit('queue');
  load();
}

export function toggle() {
  if (!P.current) return;
  if (!audio.src) return load();
  audio.paused ? audio.play().catch(onError) : audio.pause();
}

export function next(auto = false) {
  if (!P.now) return;
  if (auto && P.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  if (P.user.length) return jumpUser(0);            // primero, lo que el usuario puso en cola
  if (P.index < P.queue.length - 1) return playContext(P.index + 1);
  if (P.repeat === 'all') return playContext(0);
  if (extend()) return playContext(P.index + 1);    // continuación automática
  if (!auto) return playContext(0);
  P.fromUser = false;
  audio.pause(); emit('state');
}

export function prev() {
  if (audio.currentTime > 4) { audio.currentTime = 0; return; }
  if (P.fromUser) return playContext(P.index);       // vuelve a la lista donde se quedó
  if (P.index > 0) return playContext(P.index - 1);
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
  if (playNext) P.user.unshift(...tracks); else P.user.push(...tracks);
  emit('queue');
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

export function setVolume(v) {
  audio.volume = Math.max(0, Math.min(1, v));
  S.settings.volume = audio.volume;
  S.settings.volAt = Date.now();
  saveKV('settings', false);
  emit('dirty');
}

// --- Eventos del elemento de audio ----------------------------------------
audio.addEventListener('ended', () => { if (sess) sess.done = true; next(true); });
audio.addEventListener('play', () => { errors = 0; emit('state'); });
audio.addEventListener('pause', () => emit('state'));
audio.addEventListener('waiting', () => emit('state'));
audio.addEventListener('playing', () => emit('state'));
audio.addEventListener('error', () => { if (audio.src && P.current) onError(audio.error); });
audio.addEventListener('loadedmetadata', () => {
  const t = P.current;
  if (t && !t.radio && !t.duration && Number.isFinite(audio.duration)) {
    t.duration = audio.duration;
    if (S.tracks.has(t.id)) saveTrack(t);
  }
  emit('time');
});
audio.addEventListener('timeupdate', () => {
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
  emit('time');
  if ('mediaSession' in navigator && Number.isFinite(audio.duration) && audio.duration > 0) {
    try {
      navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate });
    } catch { /* algunos navegadores no lo admiten */ }
  }
});

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
  set('play', () => audio.play());
  set('pause', () => audio.pause());
  set('previoustrack', prev);
  set('nexttrack', () => next(false));
  set('seekto', d => seek(d.seekTime));
}
