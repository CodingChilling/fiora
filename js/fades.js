// Fundidos y transiciones entre canciones: ajustes y cálculo del volumen de cada momento.
// Sin estado ni efectos: el reproductor (player.js) lo aplica a sus elementos de audio.
import { S } from './store.js';

// Todo apagado por defecto: sin tocar nada, la reproducción suena como siempre.
export const DEFAULTS = Object.freeze({
  fadeIn: 0,         // segundos de fundido al empezar cada canción (0–10)
  fadeOut: 0,        // segundos de fundido al acabar cada canción (0–10)
  mode: 'normal',    // transición entre canciones: 'normal' (una tras otra) | 'cross' (se solapan)
  cross: 6,          // segundos de solape de la mezcla cruzada (1–12)
  pause: false,      // fundido corto al pausar y al reanudar
  manual: false,     // mezclar también al saltar de canción a mano (con un solape de 3 s como mucho)
});
export const LIMITS = Object.freeze({ fadeIn: [0, 10], fadeOut: [0, 10], cross: [1, 12] });
export const PAUSE_SECS = 0.35;
export const MANUAL_MAX = 3;

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : lo));
/** Ajustes guardados, completos y dentro de sus límites. */
export function settings(raw = S.settings?.fx) {
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  for (const k of Object.keys(LIMITS)) s[k] = clamp(s[k], LIMITS[k]);
  s.mode = s.mode === 'cross' ? 'cross' : 'normal';
  s.pause = !!s.pause; s.manual = !!s.manual;
  return s;
}

/**
 * ¿Deja el navegador cambiar el volumen desde la página? En iPhone y iPad no (el volumen es siempre
 * el del sistema): allí los fundidos no se oirían y una mezcla cruzada sonaría a dos canciones a la vez.
 */
let volOk = null;
export function volumeControl() {
  if (volOk !== null) return volOk;
  try { const a = new Audio(); a.volume = 0.5; volOk = Math.abs(a.volume - 0.5) < 0.01; } catch { volOk = false; }
  return volOk;
}

// Curvas de potencia constante: en una mezcla cruzada la suma de las dos se oye igual de fuerte.
export const rise = p => Math.sin(Math.max(0, Math.min(1, p)) * Math.PI / 2);
export const fall = p => Math.cos(Math.max(0, Math.min(1, p)) * Math.PI / 2);

/**
 * Ganancia (0–1) de una canción según su posición: sube durante `fin` segundos al empezar y baja
 * durante `fout` segundos antes del final. Depende solo de la posición, así que buscar, pausar o
 * volver atrás nunca deja el volumen a medias.
 */
export function positional(t, dur, fin, fout) {
  let g = 1;
  if (fin > 0 && t < fin) g *= rise(t / fin);
  if (fout > 0 && Number.isFinite(dur) && dur > 0) {
    const left = dur - t;
    if (left < fout) g *= rise(left / fout);
  }
  return Math.max(0, Math.min(1, g));
}

/**
 * Duraciones que se aplican a una canción concreta. Una canción corta no puede pasarse la mitad
 * fundiéndose: entrada y salida juntas ocupan como mucho el 40 % de su duración.
 */
export function shape(s, dur) {
  let fin = s.fadeIn, fout = s.fadeOut;
  if (Number.isFinite(dur) && dur > 0 && fin + fout > dur * 0.4) { const k = (dur * 0.4) / (fin + fout); fin *= k; fout *= k; }
  return { fin, fout };
}

/** Segundos de solape de la próxima transición automática (0: sin mezcla cruzada para esta canción). */
export function crossFor(s, dur) {
  if (s.mode !== 'cross' || !Number.isFinite(dur) || dur <= 0) return 0;
  return Math.min(s.cross, dur * 0.4);    // nunca más del 40 % de la canción que se va
}
