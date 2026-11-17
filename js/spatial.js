// Audio espacial (8D): motor de procesamiento con Web Audio, sin interfaz. Solo se usa con canciones
// de la biblioteca y nunca toca los archivos: el efecto se aplica al vuelo.
//
// SEGURIDAD: este módulo tiene su PROPIO elemento <audio>, conectado una sola vez al grafo. El
// elemento normal del reproductor (radios, Explorar, 8D apagado, fuentes no compatibles) nunca pasa
// por aquí, así que nada de lo que falle en Web Audio puede dejarlo en silencio.
//
// Grafo (buildGraph):
//   fuente ─┬─ seco ───────────────────────────────────────────────┬─ salida
//           ├─ compensación ─ StereoPanner ──────── rama «suave» ──┤
//           ├─ compensación ─ filtro ─ StereoPanner  rama «circular» ┤ (húmedo)
//           └─ mezcla mono ─ PannerNode HRTF ─ limitador ─ rama «envolvente» ┘
// El movimiento lo llevan dos osciladores (seno y coseno, misma frecuencia) conectados a los
// parámetros de los nodos: automatización nativa, sin temporizadores.
import { S } from './store.js';

export const DEFAULTS = { on: false, mode: 'suave', intensity: 60, speed: 40 };
export const MODES = { suave: 'Suave', circular: 'Circular', envolvente: 'Envolvente (experimental)' };
// Amplitud máxima del paneo y frecuencia del movimiento (Hz) de cada modo, con velocidad 0 % y 100 %.
export const RANGES = { suave: { amp: 0.6, f: [0.03, 0.12] }, circular: { amp: 0.9, f: [0.05, 0.25] }, envolvente: { amp: 1, f: [0.04, 0.2] } };
const SHELF_DB = 5;          // cuánto se apagan los agudos «detrás» en Circular, como mucho
const HRTF_MIX = 0.85;       // parte máxima de la rama HRTF en Envolvente
const HRTF_TRIM = 0.95;      // margen tras el limitador de la rama HRTF
const HRTF_DRIVE = 2;         // la HRTF baja bastante el nivel medio: se compensa antes del limitador, que sujeta los picos
const CIRC_TRIM = 0.93;      // el filtro de Circular puede subir un poco el pico de señales muy cuadradas: se deja margen
const TAU = 0.15;            // segundos: suavizado de cualquier cambio

export const settings = () => { const s = { ...DEFAULTS, ...(S.settings.spatial || {}) }; if (!MODES[s.mode]) s.mode = 'suave'; s.intensity = Math.max(0, Math.min(100, +s.intensity || 0)); s.speed = Math.max(0, Math.min(100, +s.speed || 0)); return s; };
const AC = () => globalThis.AudioContext || globalThis.webkitAudioContext;
export const supported = () => { const A = AC(); return !!A && typeof A.prototype.createStereoPanner === 'function' && typeof A.prototype.createMediaElementSource === 'function'; };
export const freqOf = s => { const [lo, hi] = RANGES[s.mode].f; return lo + (hi - lo) * (s.speed / 100); };

/**
 * Construye el efecto sobre cualquier contexto (el real o uno «offline» para las pruebas).
 * Devuelve { out, set(ajustes, inmediato), stop() }.
 */
export function buildGraph(ctx, source) {
  const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const out = g(1), dry = g(1), wet = g(0);
  source.connect(dry); dry.connect(out); wet.connect(out);

  // osciladores de movimiento: seno y coseno enganchados (misma frecuencia, mismos cambios)
  const sin = ctx.createOscillator(), cos = ctx.createOscillator();
  cos.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0])));
  sin.frequency.value = cos.frequency.value = 0.05;
  const amp = g(0);                                   // seno × amplitud del paneo
  sin.connect(amp);

  // El StereoPanner suma un canal sobre el otro al panear y puede subir el pico hasta (1 + sen(|p|·π/2)).
  // Esta curva lo compensa en cada instante, así que la salida nunca supera a la entrada.
  const curve = new Float32Array(257);
  for (let i = 0; i < 257; i++) { const p = Math.abs(i / 128 - 1); curve[i] = 1 / (1 + Math.sin((p * Math.PI) / 2)) - 1; }
  const branch = withFilter => {
    const pre = g(1), shaper = ctx.createWaveShaper(), pan = ctx.createStereoPanner(), level = g(0);
    shaper.curve = curve;
    amp.connect(shaper); shaper.connect(pre.gain);
    amp.connect(pan.pan);
    source.connect(pre);
    let filter = null, depth = null;
    if (withFilter) {
      filter = ctx.createBiquadFilter(); filter.type = 'highshelf'; filter.frequency.value = 3500; filter.gain.value = 0;
      depth = g(0); cos.connect(depth); depth.connect(filter.gain);    // delante (coseno +1) sin cambio; detrás, menos agudos
      pre.connect(filter); filter.connect(pan);
    } else pre.connect(pan);
    pan.connect(level); level.connect(wet);
    return { level, filter, depth };
  };
  const soft = branch(false), circ = branch(true);

  // Envolvente: mezcla mono situada con HRTF en una órbita horizontal de radio 1 (sin atenuación por distancia)
  const mono = g(HRTF_DRIVE); mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 1; panner.rolloffFactor = 0;
  const env = g(0), ox = g(1), oz = g(-1);
  let orbitTimer = null;
  if (panner.positionX) { panner.positionX.value = 0; panner.positionY.value = 0; panner.positionZ.value = 0; sin.connect(ox); ox.connect(panner.positionX); cos.connect(oz); oz.connect(panner.positionZ); }
  // La HRTF realza algunas frecuencias y puede duplicar el pico de una señal a tope: un limitador lo sujeta
  // (medido: pico ≤ 0,99 con señales al máximo). Solo actúa en esta rama.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -9; limiter.knee.value = 3; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
  source.connect(mono); mono.connect(panner); panner.connect(limiter); limiter.connect(env); env.connect(wet);

  sin.start(); cos.start();
  let cur = null;
  function set(s, instant = false) {
    const t = ctx.currentTime, to = (p, v) => { if (instant) p.setValueAtTime(v, t); else p.setTargetAtTime(v, t, TAU); };
    const k = s.on ? s.intensity / 100 : 0, f = freqOf(s), R = RANGES[s.mode];
    to(sin.frequency, f); to(cos.frequency, f);
    const hrtf = s.mode === 'envolvente';
    to(amp.gain, hrtf ? 0 : R.amp * k);
    to(soft.level.gain, s.mode === 'suave' ? 1 : 0);
    to(circ.level.gain, s.mode === 'circular' ? CIRC_TRIM : 0);
    to(circ.filter.gain, s.mode === 'circular' ? (-SHELF_DB * k) / 2 : 0);
    to(circ.depth.gain, s.mode === 'circular' ? (SHELF_DB * k) / 2 : 0);
    to(env.gain, hrtf ? HRTF_TRIM : 0);
    // En intensidad 0 solo queda la rama seca: el original tal cual.
    const w = k <= 0 ? 0 : hrtf ? HRTF_MIX * k : 1;
    to(wet.gain, w); to(dry.gain, 1 - w);
    // navegadores sin parámetros de posición: órbita con setPosition
    if (!panner.positionX && hrtf && !orbitTimer && typeof setInterval === 'function') {
      const t0 = ctx.currentTime;
      orbitTimer = setInterval(() => { const a = 2 * Math.PI * freqOf(cur) * (ctx.currentTime - t0); panner.setPosition(Math.sin(a), 0, -Math.cos(a)); }, 40);
    }
    if (!hrtf && orbitTimer) { clearInterval(orbitTimer); orbitTimer = null; }
    cur = s;
  }
  return { out, set, stop() { try { sin.stop(); cos.stop(); } catch { /* ya parados */ } if (orbitTimer) clearInterval(orbitTimer); }, nodes: { dry, wet, amp, panner } };
}

// ------------------------------------------------------------------ motor
let el = null, el2 = null, ctx = null, graph = null, meters = null;
const corsOk = new Map();                 // servidor o bucket → ¿permite CORS?
const st = { last: null, route: 'original' };

/**
 * Elemento <audio> de la ruta espacial (se crea la primera vez que hace falta). Hay un segundo
 * elemento, `partner()`, conectado al mismo efecto: solo se usa para solapar dos canciones en una
 * mezcla cruzada. Cada uno se conecta a Web Audio una sola vez.
 */
export function element() {
  if (el || !supported()) return el;
  try {
    const a = new Audio(), b = new Audio(); a.preload = b.preload = 'auto';
    ctx = new (AC())({ latencyHint: 'playback' });
    const input = ctx.createGain();
    ctx.createMediaElementSource(a).connect(input);
    ctx.createMediaElementSource(b).connect(input);
    graph = buildGraph(ctx, input);
    graph.out.connect(ctx.destination);
    graph.set(settings(), true);
    el = a; el2 = b;
  } catch (e) { console.warn('Audio espacial no disponible', e); el = el2 = null; ctx = null; graph = null; }
  return el;
}
/** El otro elemento de la ruta espacial (para las mezclas cruzadas). */
export const partner = () => (element() ? el2 : null);
/** ¿Es uno de los elementos de la ruta espacial? */
export const owns = a => !!a && (a === el || a === el2);
export const hasElement = () => !!el;
/** Aplica los ajustes guardados al grafo (con suavizado). */
export function apply() { if (graph) graph.set(settings()); }
/** Pone el contexto en marcha (los navegadores lo dejan suspendido hasta que hay un gesto). */
async function running() {
  if (!ctx) return false;
  if (ctx.state === 'running') return true;
  try { await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 700))]); } catch { /* sin permiso */ }
  return ctx.state === 'running';
}
export const contextRunning = () => !!ctx && ctx.state === 'running';

const sourceKey = src => { try { const u = new URL(src, location.href), i = u.pathname.indexOf('/o/'); return u.origin + (i >= 0 ? u.pathname.slice(0, i + 3) : ''); } catch { return src; } };
async function allowsCors(src) {
  const key = sourceKey(src);
  if (corsOk.has(key)) return corsOk.get(key);
  let ok = false;
  // Petición sencilla (sin cabeceras extra, para no necesitar «preflight») que se corta en cuanto llegan las cabeceras.
  const ac = new AbortController();
  try { const r = await fetch(src, { mode: 'cors', credentials: 'omit', signal: ac.signal }); ok = r.ok; }
  catch { ok = false; }
  ac.abort();
  if (ok || navigator.onLine) corsOk.set(key, ok);        // sin red no se saca ninguna conclusión
  return ok;
}
const note = (track, route, reason) => { st.last = { title: track?.title || '', route, reason }; st.route = route; return route === 'spatial'; };

/**
 * ¿Esta canción puede ir por la ruta espacial? Solo canciones de la biblioteca, con el 8D activado
 * y con una fuente que Web Audio pueda leer. Ante cualquier duda, no: suena el original.
 * `target` es el elemento espacial que la cargará (el principal o, en una mezcla cruzada, `partner()`).
 */
export async function routeFor(track, src, target = null) {
  const s = settings();
  if (!track || track.radio) return note(track, 'original', 'radio');
  if (!S.tracks.has(track.id)) return note(track, 'original', 'explorar');
  if (!s.on) return note(track, 'original', 'apagado');
  if (!supported() || !element()) return note(track, 'original', 'sin-webaudio');
  const local = /^blob:|^data:/.test(src) || new URL(src, location.href).origin === location.origin;
  if (!local && !(await allowsCors(src))) return note(track, 'original', 'cors');
  if (!(await running())) return note(track, 'original', 'contexto');
  const a = owns(target) ? target : el;
  if (local) a.removeAttribute('crossorigin'); else a.crossOrigin = 'anonymous';
  graph.set(s);
  return note(track, 'spatial', 'ok');
}
/** La ruta espacial falló con esta canción: se anota y, si era por el origen, no se vuelve a intentar con ese servidor. */
export function failed(track, src, reason = 'error') {
  if (src && !/^blob:|^data:/.test(src)) corsOk.set(sourceKey(src), false);
  note(track, 'original', reason);
}
export const status = () => ({ supported: supported(), ...st, context: ctx ? ctx.state : 'sin crear' });

/** Niveles de salida por canal (0–1), para las pruebas: confirma que el sonido se mueve de verdad. */
export function levels() {
  if (!graph) return null;
  if (!meters) {
    const sp = ctx.createChannelSplitter(2), l = ctx.createAnalyser(), r = ctx.createAnalyser();
    l.fftSize = r.fftSize = 2048; graph.out.connect(sp); sp.connect(l, 0); sp.connect(r, 1);
    meters = { l, r, buf: new Float32Array(2048) };
  }
  const rms = a => { a.getFloatTimeDomainData(meters.buf); let s = 0; for (const v of meters.buf) s += v * v; return Math.sqrt(s / meters.buf.length); };
  return { l: rms(meters.l), r: rms(meters.r) };
}
