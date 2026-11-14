// Sesiones de radio por tiempo: Viajes musicales y Degustación de radios.
// Una sesión es una lista de paradas; en cada parada suena una emisora real durante un tiempo de
// escucha (si pausas, el reloj se para). Al acabar, pasa sola a la siguiente parada.
//   · Si la emisora falla, la parada busca otra (alternativa del mismo destino o la siguiente de la lista).
//   · Si el usuario pone otra cosa (una canción, otra emisora), la sesión termina sola: nunca compite
//     con la reproducción normal y nunca suenan dos cosas a la vez (hay un único <audio>).
//   · No se graba ni se guarda audio.
import * as player from './player.js';
import { P } from './player.js';
import { emit, on } from './store.js';
import * as radio from './radio.js';

let S = null;   // sesión en curso
// {kind, title, stops: [{label, sub, pick: async (avoid) => station[]}], secs, auto, repeat,
//  i, station, tried: Set, elapsed, paused, ending}

export const current = () => S && {
  kind: S.kind, title: S.title, i: S.i, total: S.stops.length, secs: S.secs, auto: S.auto, repeat: S.repeat,
  elapsed: S.elapsed, paused: S.paused || !P.playing, station: S.station, loading: S.loading, error: S.error,
  stops: S.stops.map(s => ({ label: s.label, sub: s.sub, station: s.station || null })),
};
const tell = () => emit('session', current());

export async function start({ kind, title, stops, secs, auto = true, repeat = false }) {
  if (!stops.length) throw new Error('No hay paradas');
  stop(true);
  S = { kind, title, stops, secs, auto, repeat, i: -1, station: null, elapsed: 0 };
  await goTo(0);
}

async function goTo(i) {
  if (!S) return;
  if (i >= S.stops.length) {
    if (S.repeat) i = 0;
    else return stop();
  }
  S.i = i; S.elapsed = 0; S.base = 0; S.error = ''; S.loading = true; S.tried = new Set();
  tell();
  await playStop();
}

async function playStop() {
  const sess = S, stopInfo = S.stops[S.i];
  try {
    if (!stopInfo.queue?.length) stopInfo.queue = await stopInfo.pick();
  } catch (e) { stopInfo.queue = []; S.error = e.message; }
  if (S !== sess) return;
  const next = (stopInfo.queue || []).find(s => !S.tried.has(s.uuid));
  if (!next) {
    S.loading = false; S.error = `No se encontró ninguna emisora que funcione en «${stopInfo.label}»`;
    tell(); emit('toast', `${S.error}: pasamos al siguiente destino`);
    if (S.i < S.stops.length - 1 || S.repeat) setTimeout(() => S === sess && goTo(S.i + 1), 1500); else stop();
    return;
  }
  S.tried.add(next.uuid); S.base = 0;
  S.station = next; stopInfo.station = next; S.loading = false;
  S.switching = true;
  player.playQueue([next]);
  S.switching = false;
  radio.reportClick(next.uuid);
  tell();
}

export function skip() { if (S) goTo(S.i + 1); }
export function toggle() { if (S) player.toggle(); }
export function restartStop() { if (S) { S.base = S.lastSecs || 0; S.elapsed = 0; tell(); } }
export function setRepeat(v) { if (S) { S.repeat = v; tell(); } }
/** Termina la sesión. Con `keep`, la emisora sigue sonando (solo deja de cambiar). */
export function stop(keep = false) {
  if (!S) return;
  const was = S; S = null;
  if (!keep && was.station && P.current?.id === was.station.id && P.playing) P.audio.pause();   // pausa la emisora de la sesión
  tell();
}

// --- eventos del reproductor -------------------------------------------------
on('radio-time', ({ track, secs }) => {
  if (!S || track.id !== S.station?.id) return;
  S.lastSecs = secs;
  if (secs < (S.base || 0)) S.base = 0;   // la emisora se ha reiniciado (otra alternativa)
  const done = secs - (S.base || 0);
  S.elapsed = Math.min(done, S.secs);
  emit('session-tick', current());
  if (S.auto && done >= S.secs) goTo(S.i + 1);
});
on('play-error', ev => {
  if (!S || ev.track.id !== S.station?.id) return;
  ev.handled = true;
  emit('toast', `«${ev.track.title}» no responde: probamos otra emisora`);
  S.loading = true; tell();
  playStop();
});
on('track', t => {
  // si suena algo que no es de la sesión, el usuario ha cambiado de música: la sesión termina
  if (S && !S.switching && t && t.id !== S.station?.id) { S = null; tell(); }
});
on('state', () => { if (S) emit('session-tick', current()); });
