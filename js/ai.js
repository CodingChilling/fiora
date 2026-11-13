// Etiquetado con IA: pide a un modelo los géneros y el ambiente de un grupo de canciones.
// La app no tiene servidor, así que la petición sale del navegador con la clave de API que el
// usuario pega en Ajustes → Modo desarrollador. Esa clave se guarda solo en este dispositivo.
// Proveedores: Claude (Anthropic), OpenAI, Gemini (Google AI Studio), Hugging Face (Inference
// Providers, con API compatible con la de OpenAI) y cualquier otro servicio compatible con OpenAI.
import { MOODS } from './store.js';

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';

export const PROVIDERS = {
  anthropic: { name: 'Claude (Anthropic)', keyHint: 'Clave de la API (sk-ant-…)', site: 'console.anthropic.com' },
  openai: { name: 'OpenAI (GPT, Codex)', keyHint: 'Clave de la API (sk-…)', site: 'platform.openai.com', url: 'https://api.openai.com/v1' },
  gemini: { name: 'Gemini (Google AI Studio)', keyHint: 'Clave de la API (AIza…)', site: 'aistudio.google.com/api-keys' },
  huggingface: {
    name: 'Hugging Face', keyHint: 'Token de acceso (hf_…)', site: 'huggingface.co/settings/tokens', url: 'https://router.huggingface.co/v1',
    help: 'Crea un token de tipo «Fine-grained» con el permiso «Make calls to Inference Providers». Los modelos los sirven distintos proveedores; Hugging Face elige uno disponible y lo cobra en tu cuenta (con un saldo gratuito mensual).',
  },
  custom: { name: 'Otro servicio compatible con OpenAI', keyHint: 'Clave de la API (si la pide)', needsUrl: true },
};

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

const baseUrl = cfg => (cfg.provider === 'custom' ? String(cfg.url || '') : PROVIDERS[cfg.provider]?.url || PROVIDERS.openai.url).trim().replace(/\/+$/, '');

/** Falta algo para poder llamar al proveedor elegido: devuelve qué, o '' si está todo. */
export function missing(cfg) {
  if (!PROVIDERS[cfg.provider]) return 'el proveedor';
  if (cfg.provider === 'custom' && !/^https?:\/\//.test(cfg.url || '')) return 'la dirección del servicio';
  if (cfg.provider !== 'custom' && !cfg.key) return 'la clave de la API';
  if (!cfg.model) return 'el modelo';
  return '';
}

function httpError(status, msg) {
  if (status === 401) return new Error('La clave de la API no es válida');
  if (status === 403) return new Error(`La clave no tiene permiso para esta petición (${msg})`);
  if (status === 404) return new Error(`El servicio no reconoce ese modelo o esa dirección (${msg})`);
  if (status === 429) return new Error('Se ha alcanzado el límite de uso o de saldo de la API. Revisa tu cuenta o inténtalo más tarde');
  if (status >= 500) return new Error('El servicio de IA está saturado ahora mismo. Inténtalo más tarde');
  return new Error(msg);
}

async function post(url, headers, body) {
  let r;
  try { r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); }
  catch { throw new Error(navigator.onLine ? 'No se pudo contactar con el servicio de IA (puede que no admita llamadas desde el navegador)' : 'No hay conexión a internet'); }
  const data = await r.json().catch(() => null);
  return { r, data, msg: data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || `Respuesta ${r.status}` };
}

async function askAnthropic(cfg, user) {
  const body = {
    model: cfg.model, max_tokens: 16000, system: SYSTEM,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
  };
  const headers = {
    'Content-Type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',   // permite la llamada directa desde el navegador
  };
  // Si el modelo declina una petición, la API la reintenta sola en el modelo de reserva recomendado.
  if (!cfg.model.includes('haiku')) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
  const { r, data, msg } = await post(ANTHROPIC, headers, body);
  if (!r.ok) throw httpError(r.status, msg);
  if (data.stop_reason === 'refusal') throw new Error('El modelo declinó clasificar este grupo de canciones');
  if (data.stop_reason === 'max_tokens') throw new Error('La respuesta se cortó. Prueba con menos canciones');
  return (data.content || []).find(b => b.type === 'text')?.text;
}

// API de "chat completions" de OpenAI, que también ofrecen muchos otros servicios.
async function askOpenAI(cfg, user) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.key) headers.Authorization = `Bearer ${cfg.key}`;
  const shape = '\n\nResponde únicamente con un objeto JSON de la forma {"songs":[{"i":0,"genres":["…"],"moods":["…"]}]}. Los valores permitidos en "moods" son: ' + MOODS.join(', ') + '.';
  // Se intenta primero la salida con esquema estricto; los servicios que no la admiten responden 400
  // y se reintenta con JSON libre y, por último, sin pedir formato.
  const formats = [
    { type: 'json_schema', json_schema: { name: 'etiquetas', strict: true, schema: SCHEMA } },
    { type: 'json_object' },
    null,
  ];
  let last;
  for (const format of formats) {
    const body = { model: cfg.model, messages: [{ role: 'system', content: SYSTEM + (format?.type === 'json_schema' ? '' : shape) }, { role: 'user', content: user }] };
    if (format) body.response_format = format;
    last = await post(`${baseUrl(cfg)}/chat/completions`, headers, body);
    if (last.r.ok) {
      const m = last.data?.choices?.[0]?.message;
      if (m?.refusal) throw new Error('El modelo declinó clasificar este grupo de canciones');
      if (last.data?.choices?.[0]?.finish_reason === 'length') throw new Error('La respuesta se cortó. Prueba con menos canciones');
      return typeof m?.content === 'string' ? m.content : (m?.content || []).map(c => c.text || '').join('');
    }
    if (last.r.status !== 400) break;
  }
  throw httpError(last.r.status, last.msg);
}

// API de Gemini (Google AI Studio).
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const geminiModel = m => String(m).replace(/^models\//, '');
// El mismo esquema en el formato que usa Gemini (tipos en mayúsculas, sin additionalProperties).
const GEMINI_SCHEMA = {
  type: 'OBJECT', required: ['songs'],
  properties: {
    songs: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT', required: ['i', 'genres', 'moods'],
        properties: { i: { type: 'INTEGER' }, genres: { type: 'ARRAY', items: { type: 'STRING' } }, moods: { type: 'ARRAY', items: { type: 'STRING', enum: MOODS } } },
      },
    },
  },
};
const geminiError = (status, msg) => (/api key/i.test(msg) ? new Error('La clave de la API no es válida') : httpError(status, msg));

async function askGemini(cfg, user) {
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key };
  const shape = '\n\nResponde únicamente con un objeto JSON de la forma {"songs":[{"i":0,"genres":["…"],"moods":["…"]}]}. Los valores permitidos en "moods" son: ' + MOODS.join(', ') + '.';
  // Primero con esquema; si el modelo no lo admite (400), con JSON libre.
  const configs = [{ responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA }, { responseMimeType: 'application/json' }];
  let last;
  for (const generationConfig of configs) {
    last = await post(`${GEMINI}/models/${encodeURIComponent(geminiModel(cfg.model))}:generateContent`, headers, {
      systemInstruction: { parts: [{ text: SYSTEM + (generationConfig.responseSchema ? '' : shape) }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig,
    });
    if (last.r.ok) {
      const c = last.data?.candidates?.[0];
      if (last.data?.promptFeedback?.blockReason || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(c?.finishReason)) throw new Error('El modelo declinó clasificar este grupo de canciones');
      if (c?.finishReason === 'MAX_TOKENS') throw new Error('La respuesta se cortó. Prueba con menos canciones');
      return (c?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    }
    if (last.r.status !== 400 || /api key/i.test(last.msg)) break;
  }
  throw geminiError(last.r.status, last.msg);
}

/** Modelos que ofrece el proveedor para la clave dada (OpenAI, Gemini y compatibles). */
export async function listModels(cfg) {
  if (cfg.provider === 'gemini') {
    let r;
    try { r = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': cfg.key } }); }
    catch { throw new Error('No se pudo contactar con el servicio'); }
    const data = await r.json().catch(() => null);
    if (!r.ok) throw geminiError(r.status, data?.error?.message || `Respuesta ${r.status}`);
    return (data?.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => geminiModel(m.name)).sort();
  }
  const headers = cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {};
  let r;
  try { r = await fetch(`${baseUrl(cfg)}/models`, { headers }); }
  catch { throw new Error('No se pudo contactar con el servicio'); }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw httpError(r.status, data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || `Respuesta ${r.status}`);
  let list = data?.data || data?.models || [];
  // Hugging Face lista también modelos sin proveedor activo o que no generan texto: se quitan.
  if (cfg.provider === 'huggingface') list = list.filter(m => (m.architecture?.output_modalities || ['text']).includes('text') && (!m.providers || m.providers.some(p => p.status === 'live')));
  return list.map(m => m.id || m.name).filter(Boolean).sort();
}

/** Saca el objeto JSON de una respuesta que puede venir envuelta en texto o en un bloque de código. */
function parseJson(text) {
  try { return JSON.parse(text); } catch { /* se intenta recortar */ }
  const a = String(text || '').indexOf('{'), b = String(text || '').lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* no es JSON */ } }
  throw new Error('La respuesta de la IA no se pudo interpretar');
}

/**
 * Etiqueta un grupo de canciones (como mucho BATCH por llamada).
 * `cfg`: {provider, key, model, url, knownGenres}.
 * Devuelve un array alineado con `tracks`: {genres, moods} o null si no hubo respuesta para esa canción.
 */
export async function tagTracks(tracks, cfg) {
  const lack = missing(cfg);
  if (lack) throw new Error(`Falta ${lack} en Ajustes → Modo desarrollador`);
  const songs = tracks.map((t, i) => ({ i, titulo: t.title, artistas: t.artists || [t.artist], album: t.album || '', anio: t.year || null, genero_del_archivo: (t.genres || []).join(', ') }));
  const user = JSON.stringify({ generos_ya_usados: (cfg.knownGenres || []).slice(0, 200), canciones: songs });
  const parsed = parseJson(await (cfg.provider === 'anthropic' ? askAnthropic(cfg, user) : cfg.provider === 'gemini' ? askGemini(cfg, user) : askOpenAI(cfg, user)));

  const out = tracks.map(() => null);
  for (const s of parsed.songs || []) {
    if (!Number.isInteger(s.i) || s.i < 0 || s.i >= tracks.length) continue;
    out[s.i] = {
      genres: [...new Set((s.genres || []).map(g => String(g).trim()).filter(Boolean))].slice(0, 4),
      moods: [...new Set((s.moods || []).map(m => String(m).toLowerCase()).filter(m => MOODS.includes(m)))].slice(0, 4),
    };
  }
  return out;
}
