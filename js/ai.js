// Etiquetado con IA: pide a Claude los géneros y el ambiente de un grupo de canciones.
// La app no tiene servidor, así que la petición sale del navegador con la clave de API que el
// usuario pega en Ajustes → Modo desarrollador. Esa clave se guarda solo en este dispositivo.
import { MOODS } from './store.js';

const API = 'https://api.anthropic.com/v1/messages';

export const AI_MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (el más preciso)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (intermedio)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 (el más barato)'],
];
export const DEFAULT_MODEL = AI_MODELS[0][0];
export const BATCH = 20;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['songs'],
  properties: {
    songs: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['i', 'genres', 'moods'],
        properties: {
          i: { type: 'integer' },
          genres: { type: 'array', items: { type: 'string' } },
          moods: { type: 'array', items: { type: 'string', enum: MOODS } },
        },
      },
    },
  },
};

const SYSTEM = `Clasificas canciones para la biblioteca de un reproductor de música. Con las etiquetas se construyen mezclas por ambiente y recomendaciones, así que importa más que sean coherentes entre canciones que exhaustivas.

Recibes una lista JSON de canciones con su índice "i", título, artistas, álbum, año y, si existe, el género que traía el archivo. Para cada una devuelve:

- "genres": de 1 a 4 géneros o subgéneros, del más general al más específico, con su nombre habitual en inglés y mayúsculas tipo título (por ejemplo "Indie Rock", "Dream Pop", "Flamenco", "Reggaeton"). Si la lista "generos_ya_usados" contiene un nombre equivalente, usa exactamente ese para no crear duplicados como "Hip Hop" y "Hip-Hop".
- "moods": de 1 a 4 valores de la lista permitida que describan lo que transmite la canción al escucharla, no su temática.

Básate en lo que sepas de la canción y del artista. Si no reconoces la canción, deduce lo que puedas del artista, el álbum y el género del archivo. Si tampoco así tienes base, devuelve listas vacías para esa canción en lugar de inventar: una etiqueta equivocada estropea las mezclas más que una ausente.

Devuelve una entrada por cada canción recibida, con el mismo "i".`;

/**
 * Etiqueta un grupo de canciones (como mucho BATCH por llamada).
 * Devuelve un array alineado con `tracks`: {genres, moods} o null si no hubo respuesta para esa canción.
 */
export async function tagTracks(tracks, { key, model = DEFAULT_MODEL, knownGenres = [] }) {
  if (!key) throw new Error('Falta la clave de la API de Claude');
  const songs = tracks.map((t, i) => ({ i, titulo: t.title, artistas: t.artists || [t.artist], album: t.album || '', anio: t.year || null, genero_del_archivo: (t.genres || []).join(', ') }));
  const body = {
    model, max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify({ generos_ya_usados: knownGenres.slice(0, 150), canciones: songs }) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
  };
  const headers = {
    'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',   // permite la llamada directa desde el navegador
  };
  // Si el modelo declina una petición, la API la reintenta sola en el modelo de reserva recomendado.
  if (!model.includes('haiku')) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }

  let r;
  try { r = await fetch(API, { method: 'POST', headers, body: JSON.stringify(body) }); }
  catch { throw new Error(navigator.onLine ? 'No se pudo contactar con la API de Claude' : 'No hay conexión a internet'); }
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = data?.error?.message || `Respuesta ${r.status}`;
    if (r.status === 401) throw new Error('La clave de la API no es válida');
    if (r.status === 403) throw new Error(`La clave no tiene permiso para esta petición (${msg})`);
    if (r.status === 429) throw new Error('Se ha alcanzado el límite de uso de la API. Espera un momento y vuelve a intentarlo');
    if (r.status >= 500) throw new Error('La API de Claude está saturada ahora mismo. Inténtalo más tarde');
    throw new Error(msg);
  }
  if (data.stop_reason === 'refusal') throw new Error('El modelo declinó clasificar este grupo de canciones');
  if (data.stop_reason === 'max_tokens') throw new Error('La respuesta se cortó. Prueba con menos canciones');
  const text = (data.content || []).find(b => b.type === 'text')?.text;
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('La respuesta de la IA no se pudo interpretar'); }

  const out = tracks.map(() => null);
  for (const s of parsed.songs || []) {
    if (!Number.isInteger(s.i) || s.i < 0 || s.i >= tracks.length) continue;
    out[s.i] = {
      genres: [...new Set((s.genres || []).map(g => String(g).trim()).filter(Boolean))].slice(0, 4),
      moods: [...new Set((s.moods || []).filter(m => MOODS.includes(m)))].slice(0, 4),
    };
  }
  return out;
}
