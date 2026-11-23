// Modos de reproducción que comparten las playlists y la biblioteca.
import { S, isFav, artistsOf } from './store.js';

const DAY = 86400000;
const last = t => S.stats[t.id]?.last || 0;
export const SURPRISE_HOURS = 168;   // por defecto se aparta lo escuchado en la última semana
export const SURPRISE_WINDOWS = [[24, '24 horas'], [72, '3 días'], [168, 'Una semana'], [336, 'Dos semanas'], [720, 'Un mes']];

/** ¿Dos canciones seguidas «se pisan»? Mismo artista o mismo álbum. */
const clash = (a, b) => !!a && !!b && ((a.album && a.album === b.album) || artistsOf(a).some(x => artistsOf(b).includes(x)));
/**
 * Reordena lo menos posible para que no suenen seguidas dos del mismo artista o álbum. `prev`: la
 * canción que suena justo antes. Si un artista acapara más de la mitad de lo que queda, se le da paso
 * antes, para que sus canciones no se amontonen al final (y acaben seguidas).
 */
function spread(list, prev = null) {
  const out = [], pool = list.slice(), key = t => artistsOf(t)[0];
  const count = new Map();
  for (const t of pool) count.set(key(t), (count.get(key(t)) || 0) + 1);
  while (pool.length) {
    let top = null, topN = 0;
    for (const [a, c] of count) if (c > topN) { top = a; topN = c; }
    let k = -1;
    if (topN * 2 > pool.length) k = pool.findIndex(t => key(t) === top && !clash(prev, t));
    if (k < 0) k = pool.slice(0, 40).findIndex(t => !clash(prev, t));
    if (k < 0) k = pool.findIndex(t => !clash(prev, t));
    if (k < 0) k = 0;                                  // no hay otra: se acepta la repetición
    const [t] = pool.splice(k, 1);
    count.set(key(t), count.get(key(t)) - 1);
    out.push(t); prev = t;
  }
  return out;
}
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * Sorpresa:
 *  · primero lo olvidado: las que llevan mucho sin sonar y las que nunca has escuchado tienen ventaja;
 *  · de vez en cuando, una favorita («Me gusta») que llevas más de un mes sin oír;
 *  · nunca dos seguidas del mismo artista o álbum (si hay alternativa);
 *  · lo escuchado en la ventana (`hours`, por defecto una semana) va al final, lo más reciente lo último.
 */
export function surpriseOrder(tracks, hours = SURPRISE_HOURS) {
  const now = Date.now(), win = hours * 3600000;
  const recent = [], rest = [];
  for (const t of tracks) (last(t) && now - last(t) < win ? recent : rest).push(t);
  const days = t => (last(t) ? (now - last(t)) / DAY : Infinity);
  const favs = shuffle(rest.filter(t => isFav(t.id) && days(t) > 30));
  const others = rest.filter(t => !favs.includes(t))
    .map(t => [t, Math.random() + (days(t) === Infinity ? 0.6 : Math.min(1, days(t) / 180) * 0.8)])
    .sort((a, b) => b[1] - a[1]).map(x => x[0]);
  // Una favorita olvidada cada cinco canciones (la primera, en el segundo puesto).
  const main = [];
  for (let i = 0, f = 0; i < others.length || f < favs.length; i++) {
    if (f < favs.length && (main.length % 5 === 1 || i >= others.length)) main.push(favs[f++]);
    if (i < others.length) main.push(others[i]);
  }
  const tail = recent.map(t => [t, last(t) + Math.random() * 3600000]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
  const head = spread(main);
  return [...head, ...spread(tail, head[head.length - 1])];
}

// Ambiente: inicio tranquilo → más energía → momento intenso → final relajado, según «lo que transmite».
const CALM = ['relajada', 'íntima', 'soñadora', 'melancólica', 'nostálgica', 'triste', 'romántica'];
const LIFT = ['alegre', 'bailable', 'festiva', 'motivadora'];
const PEAK = ['enérgica', 'épica', 'agresiva', 'oscura'];
/** {ok, list} o {ok: false, why} si no hay canciones o etiquetas suficientes. */
export function ambientPlan(tracks) {
  const tagged = tracks.filter(t => t.moods?.length);
  if (tracks.length < 6) return { ok: false, why: 'El modo ambiente necesita al menos 6 canciones' };
  if (tagged.length < Math.max(6, tracks.length * 0.6)) return { ok: false, why: `Solo ${tagged.length} de ${tracks.length} canciones tienen «lo que transmite». Etiquétalas (modo desarrollador o IA) para usar el modo ambiente.` };
  const score = t => { const m = t.moods; return PEAK.filter(x => m.includes(x)).length * 2 + LIFT.filter(x => m.includes(x)).length - CALM.filter(x => m.includes(x)).length * 1.5; };
  const sorted = tagged.map(t => [t, score(t) + Math.random() * 0.3]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
  const calm = sorted.slice(0, Math.ceil(sorted.length * 0.35)), rest = sorted.slice(calm.length);
  const lift = rest.slice(0, Math.ceil(rest.length / 2)), peak = rest.slice(lift.length);
  const half = Math.ceil(calm.length / 2);
  return { ok: true, list: [...calm.slice(0, half), ...lift, ...peak, ...calm.slice(half).reverse()] };
}
