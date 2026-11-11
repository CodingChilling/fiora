// Reproductor: una sola etiqueta <audio>, cola, aleatorio, repetición y Media Session.
import * as db from './db.js';
import { S, emit, countPlay, saveTrack, saveKV } from './store.js';
import { coverUrl } from './library.js';
import { objectUrl } from './cloud.js';

const audio = new Audio();
audio.preload = 'auto';

export const P = {
  audio,
  queue: [],        // pistas (objetos); pueden ser de la biblioteca, del Archivo o radios
  index: -1,
  shuffle: false,
  repeat: 'off',    // off | all | one
  get current() { return this.queue[this.index] || null; },
  get playing() { return !audio.paused; },
};

let original = null;     // orden original de la cola mientras el aleatorio está activo
let blobUrl = null;
let loadToken = 0;
let counted = false;
let errors = 0;

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
  if (t.cloudName && S.settings.parUrl) return objectUrl(t.cloudName);
  if (t.url) return t.url;
  throw new Error('Esta canción no está disponible en este dispositivo');
}

async function load(autoplay = true) {
  const t = P.current;
  const token = ++loadToken;
  counted = false;
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
  emit('toast', `No se pudo reproducir «${t?.title || ''}»${navigator.onLine ? '' : ' (sin conexión)'}`);
  console.warn(e);
  if (++errors < 3 && P.index < P.queue.length - 1) next(true);
  else { errors = 0; emit('state'); }
}

/** Sustituye la cola y empieza a reproducir desde `start`. */
export function playQueue(tracks, start = 0) {
  if (!tracks.length) return;
  const first = tracks[start];
  if (P.shuffle) {
    original = tracks.slice();
    P.queue = [first, ...shuffled(tracks.filter((_, i) => i !== start))];
    P.index = 0;
  } else {
    original = null;
    P.queue = tracks.slice();
    P.index = start;
  }
  errors = 0;
  emit('queue');
  load();
}

export function jump(i) {
  if (i < 0 || i >= P.queue.length) return;
  P.index = i; errors = 0; load();
}

export function toggle() {
  if (!P.current) return;
  if (!audio.src) return load();
  audio.paused ? audio.play().catch(onError) : audio.pause();
}

export function next(auto = false) {
  if (!P.queue.length) return;
  if (auto && P.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  if (P.index < P.queue.length - 1) P.index++;
  else if (P.repeat === 'all' || !auto) P.index = 0;
  else { audio.pause(); emit('state'); return; }
  load();
}

export function prev() {
  if (audio.currentTime > 4 || P.index === 0) { audio.currentTime = 0; return; }
  P.index--; load();
}

export function seek(sec) {
  if (Number.isFinite(sec) && Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(sec, audio.duration));
}

export function toggleShuffle() {
  P.shuffle = !P.shuffle;
  const cur = P.current;
  if (P.shuffle) {
    original = P.queue.slice();
    if (cur) { P.queue = [cur, ...shuffled(P.queue.filter((_, i) => i !== P.index))]; P.index = 0; }
  } else if (original) {
    P.queue = original; original = null;
    P.index = Math.max(0, P.queue.indexOf(cur));
  }
  emit('queue'); emit('state');
}

export function cycleRepeat() {
  P.repeat = { off: 'all', all: 'one', one: 'off' }[P.repeat];
  emit('state');
}

export function enqueue(tracks, playNext = false) {
  if (!P.queue.length) return playQueue(tracks);
  if (playNext) P.queue.splice(P.index + 1, 0, ...tracks);
  else P.queue.push(...tracks);
  if (original) original.push(...tracks);
  emit('queue');
}

export function removeFromQueue(i) {
  if (i === P.index || i < 0 || i >= P.queue.length) return;
  const [t] = P.queue.splice(i, 1);
  if (original) original = original.filter(x => x !== t);
  if (i < P.index) P.index--;
  emit('queue');
}

export function setVolume(v) {
  audio.volume = Math.max(0, Math.min(1, v));
  S.settings.volume = audio.volume;
  S.settings.volAt = Date.now();
  saveKV('settings', false);
  emit('dirty');
}

// --- Eventos del elemento de audio ----------------------------------------
audio.addEventListener('ended', () => next(true));
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
