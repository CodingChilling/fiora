// Modos de reproducción que comparten las playlists y la biblioteca.
import { S } from './store.js';

const last = t => S.stats[t.id]?.last || 0;

/** Sorpresa: aleatorio, dejando para el final lo escuchado en las últimas `hours` horas. */
export function surpriseOrder(tracks, hours = 24) {
  const now = Date.now();
  return tracks.map(t => { const ago = (now - last(t)) / 3600000; return [t, Math.random() + (last(t) && ago < hours ? 2 + (1 - ago / hours) : 0)]; })
    .sort((a, b) => a[1] - b[1]).map(x => x[0]);
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
