// Información sobre artistas y canciones, con varias fuentes y cada dato con la suya:
//   · Wikidata (CC0): identifica al artista o la canción (sin confundir homónimos) y da los datos
//     verificables (fechas, lugares, géneros, discográficas, premios, miembros, créditos).
//   · Wikipedia en español y en inglés (CC BY-SA): biografía o historia y, sobre todo, las secciones
//     con anécdotas (curiosidades, vida personal, antecedentes, grabación, legado…).
//   · TheAudioDB (comunidad): biografías y descripciones escritas por sus usuarios, y fotos.
//   · Discogs (comunidad): el perfil del artista, enlazado desde Wikidata.
// Lo de las comunidades se marca como tal. Si no hay información, se dice; no se inventa nada.
import * as db from './db.js';
import { norm, sameTitle } from './covers.js';

const TTL = 30 * 86400000;          // la información se guarda en el dispositivo 30 días
const WAIT = 15000;
const WD = 'https://www.wikidata.org';
const AUDIODB = 'https://www.theaudiodb.com/api/v1/json/123';   // clave pública y gratuita de TheAudioDB
const DISCOGS = 'https://api.discogs.com';

async function getJSON(url) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), WAIT);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }   // sin conexión, sin permiso del navegador (CORS) o el servicio no contesta: se sigue sin él
  finally { clearTimeout(timer); }
}
async function cached(key, fn) {
  const hit = await db.get('kv', key).catch(() => null);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = await fn();
  if (data && data.status !== 'error' && data.status !== 'offline') db.put('kv', key, { at: Date.now(), data }).catch(() => {});
  return data;
}
const offline = () => !navigator.onLine;

// ---------------------------------------------------------------- Wikidata
async function entities(ids) {
  if (!ids.length) return [];
  const d = await getJSON(`${WD}/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=labels|descriptions|aliases|claims|sitelinks&languages=es|en&format=json&origin=*`);
  return ids.map(id => d?.entities?.[id]).filter(e => e && !e.missing);
}
async function labels(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const d = await getJSON(`${WD}/w/api.php?action=wbgetentities&ids=${ids.slice(i, i + 50).join('|')}&props=labels&languages=es|en&format=json&origin=*`);
    for (const [id, e] of Object.entries(d?.entities || {})) out.set(id, e.labels?.es?.value || e.labels?.en?.value || '');
  }
  return out;
}
/** Búsqueda en Wikidata (texto y condiciones como «haswbstatement:P175=Q…»): ids de los elementos. */
async function search(query, n = 10) {
  const d = await getJSON(`${WD}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${n}&format=json&origin=*`);
  return (d?.query?.search || []).map(x => x.title).filter(t => /^Q\d+$/.test(t));
}
async function searchName(name, lang) {
  const d = await getJSON(`${WD}/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&uselang=${lang}&type=item&limit=10&format=json&origin=*`);
  return (d?.search || []).filter(x => norm(x.label) === norm(name) || norm(x.match?.text) === norm(name)).map(x => x.id);
}
const claims = (e, p) => (e?.claims?.[p] || []).filter(c => c.rank !== 'deprecated' && c.mainsnak?.datavalue);
const ids = (e, p) => claims(e, p).map(c => c.mainsnak.datavalue.value?.id).filter(Boolean);
const str = (e, p) => claims(e, p).map(c => c.mainsnak.datavalue.value).find(v => typeof v === 'string') || '';
const label = e => e?.labels?.es?.value || e?.labels?.en?.value || '';
const description = e => e?.descriptions?.es?.value || e?.descriptions?.en?.value || '';
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fmtTime(v) {
  const m = /^([+-])(\d+)-(\d\d)-(\d\d)/.exec(v?.time || '');
  if (!m) return '';
  const y = +m[2], mo = +m[3], d = +m[4], p = v.precision;
  if (p >= 11 && d) return `${d} de ${MONTHS[mo - 1]} de ${y}`;
  if (p === 10 && mo) return `${MONTHS[mo - 1]} de ${y}`;
  return String(y);
}
const yearOf = (e, p) => { const v = claims(e, p)[0]?.mainsnak.datavalue.value; return v ? +((/^[+-](\d+)/.exec(v.time) || [])[1]) || 0 : 0; };
/** Ficha: [{key, label, values, more}], solo con las propiedades que tenga. `props`: [[propiedad, etiqueta, máximo]]. */
async function facts(e, props) {
  const want = new Set();
  for (const [p] of props) for (const c of claims(e, p)) if (c.mainsnak.datavalue.type === 'wikibase-entityid') want.add(c.mainsnak.datavalue.value.id);
  const lab = await labels([...want]);
  const out = [];
  for (const [p, name, max = 8] of props) {
    const vals = [];
    for (const c of claims(e, p)) {
      const dv = c.mainsnak.datavalue;
      let v = dv.type === 'wikibase-entityid' ? lab.get(dv.value.id) : dv.type === 'time' ? fmtTime(dv.value) : dv.type === 'string' ? dv.value : '';
      if (!v) continue;
      const when = c.qualifiers?.P585?.[0]?.datavalue?.value;
      if (when) v += ` (${fmtTime({ ...when, precision: 9 })})`;
      if (!vals.includes(v)) vals.push(v);
    }
    if (vals.length) out.push({ key: p, label: name, values: vals.slice(0, max), more: Math.max(0, vals.length - max) });
  }
  return out;
}

// ---------------------------------------------------------------- Wikipedia
// Secciones que se leen como historias o curiosidades (se destacan aparte).
const STORY = /curiosidad|anécdota|trivia|vida personal|personal life|controversi|polémica|legado|legacy|influencia|influence|cultura popular|popular culture|antecedentes|background|origen|origins?\b|etimolog|nombre|name\b|grabación|recording|composición|composition|escritura|writing|inspiraci|inspiration|video ?musical|music video|vídeo|actuaciones|live performances?|versiones|cover versions|homenaje|tribute|recepción|reception|impacto|impact|estilo|style|artistry|imagen pública|public image|filantrop|philanthrop|activismo|activism/i;
const SKIP = /^(referencias|notas|notas y referencias|enlaces externos|véase también|bibliografía|fuentes|lecturas? adicionales?|discografía|filmografía|premios y nominaciones|giras|references|notes|external links|see also|further reading|bibliography|sources|citations|discography|filmography|awards and nominations|tours|track listing|lista de canciones|personnel|créditos|credits|charts|listas|posicionamiento en listas|certifications|certificaciones|release history|historial de lanzamientos|year-end charts|weekly charts|monthly charts|accolades|band members|miembros|members|formats and track listings)$/i;

async function wikipedia(e, lang) {
  const title = e?.sitelinks?.[`${lang}wiki`]?.title;
  if (!title) return null;
  const d = await getJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&explaintext=1&exsectionformat=wiki&piprop=thumbnail&pithumbsize=600&redirects=1&titles=${encodeURIComponent(title)}&format=json&origin=*`);
  const page = Object.values(d?.query?.pages || {})[0];
  if (!page?.extract) return null;
  return { lang, title: page.title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`, thumb: page.thumbnail?.source || '', ...sections(page.extract) };
}
/** Introducción y secciones de nivel 2 (con sus subsecciones dentro, marcadas con «§»). */
function sections(text) {
  const out = [];
  let intro = '', cur = null;
  for (const line of text.split('\n')) {
    const h = /^(={2,})\s*(.+?)\s*\1\s*$/.exec(line);
    if (h) {
      if (h[1].length === 2) { cur = { title: h[2], text: '' }; out.push(cur); }
      else if (cur) cur.text += `\n§ ${h[2]}\n`;
      continue;
    }
    if (cur) cur.text += line + '\n'; else intro += line + '\n';
  }
  const clean = s => s.replace(/\n{3,}/g, '\n\n').trim();
  return { intro: clean(intro), sections: out.map(s => ({ title: s.title, text: clean(s.text) })).filter(s => s.text.replace(/§[^\n]*/g, '').trim().length > 60 && !SKIP.test(s.title)) };
}
const WIKI_ES = { name: 'Wikipedia', kind: 'verificable' }, WIKI_EN = { name: 'Wikipedia (inglés)', kind: 'verificable' };
/** Historias: las secciones con anécdotas, en español y, de las que no estén, en inglés. */
function stories(es, en) {
  const out = [];
  const add = (w, src) => { for (const s of w?.sections || []) if (STORY.test(s.title)) out.push({ title: s.title, text: s.text, source: src.name, kind: src.kind, lang: w.lang, url: w.url }); };
  add(es, WIKI_ES);
  if (en && (!es || out.length < 3)) add(en, WIKI_EN);
  return out.slice(0, 10);
}

// ---------------------------------------------------------------- TheAudioDB y Discogs
async function audiodbArtist(name) {
  const d = await getJSON(`${AUDIODB}/search.php?s=${encodeURIComponent(name)}`);
  return (d?.artists || []).find(a => norm(a.strArtist) === norm(name)) || null;
}
async function audiodbTrack(artist, title) {
  const d = await getJSON(`${AUDIODB}/searchtrack.php?s=${encodeURIComponent(artist)}&t=${encodeURIComponent(title)}`);
  return (d?.track || []).find(t => sameTitle(t.strTrack, title) && norm(t.strArtist) === norm(artist)) || null;
}
const audiodbText = (x, field) => {
  const es = String(x?.[`${field}ES`] || '').trim(), en = String(x?.[`${field}EN`] || '').trim();
  return es ? { text: es, lang: 'es' } : en ? { text: en, lang: 'en' } : null;
};
/** Perfil de Discogs sin sus marcas ([a=Nombre], [url=…]texto[/url], [b]…). */
const discogsText = s => String(s || '')
  .replace(/\[url=[^\]]*\]([^[]*)\[\/url\]/gi, '$1').replace(/\[(?:a|l|m|r)=([^\]]+)\]/gi, '$1').replace(/\[(?:a|l|m|r)\d+\]/gi, '')
  .replace(/\[\/?(?:b|i|u)\]/gi, '').replace(/\r/g, '').trim();
async function discogs(e) {
  const id = str(e, 'P1953');
  if (!id) return null;
  const d = await getJSON(`${DISCOGS}/artists/${encodeURIComponent(id)}`);
  return d ? { id, url: `https://www.discogs.com/artist/${id}`, profile: discogsText(d.profile), members: (d.members || []).map(m => ({ name: String(m.name || '').replace(/\s*\(\d+\)$/, ''), active: m.active !== false })) } : null;
}

// ---------------------------------------------------------------- artistas
const MUSIC_JOBS = new Set(['Q177220', 'Q639669', 'Q36834', 'Q488205', 'Q753110', 'Q855091', 'Q130857', 'Q2252262', 'Q183945', 'Q386854', 'Q806349', 'Q1259917', 'Q12800682', 'Q486748', 'Q2643890']);
const GROUPS = new Set(['Q215380', 'Q5741069', 'Q2088357', 'Q9212979', 'Q281643', 'Q641066', 'Q1196726', 'Q56816954', 'Q109940']);
const isGroup = e => ids(e, 'P31').some(q => GROUPS.has(q));
const isMusical = e => isGroup(e) || ids(e, 'P106').some(q => MUSIC_JOBS.has(q));
const fame = e => Object.keys(e.sitelinks || {}).length;

/**
 * El artista en Wikidata. Si hay varios músicos con ese nombre, se queda con el que tenga alguno de
 * los discos o canciones de la biblioteca; si ninguno, con el más conocido (y se avisa).
 */
async function findArtist(name, { albums = [], titles = [] } = {}) {
  let cand = await searchName(name, 'es');
  if (!cand.length) cand = await searchName(name, 'en');
  const list = (await entities([...new Set(cand)].slice(0, 8))).filter(isMusical);
  if (list.length <= 1) return { e: list[0] || null };
  for (const e of list.slice(0, 4)) {
    for (const what of [...albums.slice(0, 2), ...titles.slice(0, 2)]) {
      if ((await search(`"${what.replace(/"/g, '')}" haswbstatement:P175=${e.id}`, 3)).length) return { e };
    }
  }
  return { e: list.sort((a, b) => fame(b) - fame(a))[0], guess: list.length };
}

/** Perfil de un artista. `known`: {albums, titles} de la biblioteca, para no confundir homónimos. */
export function artistInfo(name, known = {}) {
  return cached(`kb2:a:${norm(name)}`, async () => {
    if (offline()) return { status: 'offline' };
    try {
      const { e, guess } = await findArtist(name, known);
      const [es, en, adb, dg] = await Promise.all([e && wikipedia(e, 'es'), e && wikipedia(e, 'en'), audiodbArtist(name), e && discogs(e)]);
      if (!e && !adb) return { status: 'none' };
      const group = e ? isGroup(e) : /^\d+$/.test(adb?.intMembers || '') && +adb.intMembers > 1;
      // Miembros: los de Wikidata (con años) y, si no hay, los de Discogs.
      let members = [];
      if (e && group) {
        const lab = await labels(ids(e, 'P527'));
        members = claims(e, 'P527').map(c => ({ name: lab.get(c.mainsnak.datavalue.value.id) || '', begin: fmtTime({ ...(c.qualifiers?.P580?.[0]?.datavalue?.value || {}), precision: 9 }), end: fmtTime({ ...(c.qualifiers?.P582?.[0]?.datavalue?.value || {}), precision: 9 }) }))
          .filter(m => m.name).map(m => ({ ...m, current: !m.end }));
      }
      if (!members.length && dg?.members.length) members = dg.members.map(m => ({ name: m.name, current: m.active }));
      const bioAdb = audiodbText(adb, 'strBiography');
      const story = stories(es, en);
      if (dg?.profile && dg.profile.length > 120) story.push({ title: 'Según Discogs', text: dg.profile, source: 'Discogs', kind: 'comunidad', lang: /\b(the|and|was|with)\b/i.test(dg.profile) ? 'en' : 'es', url: dg.url });
      if (bioAdb && (es || en)) story.push({ title: 'Según TheAudioDB', text: bioAdb.text, source: 'TheAudioDB', kind: 'comunidad', lang: bioAdb.lang, url: `https://www.theaudiodb.com/artist/${adb.idArtist}` });
      const bio = es ? { text: es.intro, rest: es.sections.filter(s => !STORY.test(s.title)), source: 'Wikipedia', lang: 'es', url: es.url }
        : bioAdb?.lang === 'es' ? { text: bioAdb.text, rest: [], source: 'TheAudioDB', lang: 'es', url: `https://www.theaudiodb.com/artist/${adb.idArtist}`, community: true }
          : en ? { text: en.intro, rest: en.sections.filter(s => !STORY.test(s.title)), source: 'Wikipedia', lang: 'en', url: en.url }
            : bioAdb ? { text: bioAdb.text, rest: [], source: 'TheAudioDB', lang: bioAdb.lang, url: `https://www.theaudiodb.com/artist/${adb.idArtist}`, community: true } : null;
      const f = e ? await facts(e, group
        ? [['P571', 'Formación', 1], ['P740', 'Origen', 2], ['P495', 'País', 2], ['P576', 'Disolución', 1], ['P136', 'Géneros', 6], ['P264', 'Discográficas', 5], ['P166', 'Premios', 12]]
        : [['P569', 'Nacimiento', 1], ['P19', 'Lugar de nacimiento', 1], ['P570', 'Fallecimiento', 1], ['P1303', 'Instrumentos', 6], ['P136', 'Géneros', 6], ['P264', 'Discográficas', 5], ['P166', 'Premios', 12]]) : [];
      const get = k => f.find(x => x.key === k);
      const year = (e && (yearOf(e, group ? 'P571' : 'P569') || yearOf(e, 'P2031'))) || +(adb?.intFormedYear || adb?.intBornYear || 0) || 0;
      const site = (e && str(e, 'P856')) || adb?.strWebsite || '';
      const links = [site && { label: 'Web oficial', url: /^https?:/.test(site) ? site : `https://${site}` },
        adb?.strFacebook && { label: 'Facebook', url: `https://${adb.strFacebook.replace(/^https?:\/\//, '')}` },
        adb?.strTwitter && { label: 'X / Twitter', url: `https://${adb.strTwitter.replace(/^https?:\/\//, '')}` }].filter(Boolean);
      const sources = [e && { name: 'Wikidata', kind: 'verificable', url: `${WD}/wiki/${e.id}` }, es && { name: 'Wikipedia', kind: 'verificable', url: es.url },
        en && { name: 'Wikipedia (inglés)', kind: 'verificable', url: en.url }, adb && { name: 'TheAudioDB', kind: 'comunidad', url: `https://www.theaudiodb.com/artist/${adb.idArtist}` },
        dg && { name: 'Discogs', kind: 'comunidad', url: dg.url }].filter(Boolean);
      return {
        status: 'ok', name: (e && label(e)) || adb?.strArtist || name, description: e ? description(e) : adb?.strStyle || '', group, guess: guess || 0,
        photo: adb?.strArtistThumb || es?.thumb || en?.thumb || '', banner: adb?.strArtistFanart || adb?.strArtistWideThumb || '',
        chips: [year && { icon: 'star', text: group ? `Desde ${year}` : `Nacimiento: ${year}` },
          (get('P740') || get('P19'))?.values[0] && { icon: 'compass', text: (get('P740') || get('P19')).values[0] },
          !get('P740') && !get('P19') && adb?.strCountry && { icon: 'compass', text: adb.strCountry },
          (get('P136')?.values.slice(0, 3).join(', ') || adb?.strGenre) && { icon: 'disc', text: get('P136')?.values.slice(0, 3).join(', ') || adb.strGenre },
          get('P166') && { icon: 'star', text: `${get('P166').values.length + get('P166').more} premios` },
          members.length && { icon: 'user', text: `${members.filter(m => m.current).length || members.length} miembros` }].filter(Boolean),
        facts: f, bio, stories: story, members, links, sources,
      };
    } catch (err) { return { status: 'error', message: err.message }; }
  });
}

// ---------------------------------------------------------------- canciones
const SONG_TYPES = new Set(['Q7366', 'Q134556', 'Q105543609', 'Q2188189', 'Q55850593', 'Q207628']);
/** Información de una canción: datos y créditos (Wikidata), historia y anécdotas (Wikipedia) y su descripción en TheAudioDB. */
export function songInfo({ title, artist, album = '' }) {
  return cached(`kb2:s:${norm(artist)}|${norm(title)}`, async () => {
    if (offline()) return { status: 'offline' };
    try {
      const a = await artistInfo(artist, { albums: album ? [album] : [], titles: [title] });
      const aq = (a?.sources || []).find(s => s.name === 'Wikidata')?.url.split('/').pop() || '';
      let e = null;
      if (aq) {
        const hits = await entities(await search(`"${title.replace(/"/g, '')}" haswbstatement:P175=${aq}`, 6));
        e = hits.find(x => sameTitle(label(x), title) || Object.values(x.labels || {}).some(l => sameTitle(l.value, title))) || null;
      }
      if (!e) {
        // Sin el artista en Wikidata: una canción con ese título cuyo intérprete se llame igual.
        const cand = (await entities((await searchName(title, 'es')).concat(await searchName(title, 'en')).slice(0, 8))).filter(x => ids(x, 'P31').some(q => SONG_TYPES.has(q)));
        const perf = await labels([...new Set(cand.flatMap(x => ids(x, 'P175')))]);
        e = cand.find(x => ids(x, 'P175').some(q => norm(perf.get(q)) === norm(artist))) || null;
      }
      const [es, en, adb] = await Promise.all([e && wikipedia(e, 'es'), e && wikipedia(e, 'en'), audiodbTrack(artist, title)]);
      const descAdb = audiodbText(adb, 'strDescription');
      if (!e && !descAdb) return { status: 'none' };
      const f = e ? await facts(e, [['P577', 'Publicación', 1], ['P361', 'Disco', 2], ['P136', 'Géneros', 4], ['P264', 'Discográfica', 3], ['P86', 'Composición', 8], ['P676', 'Letra', 8], ['P162', 'Producción', 8], ['P166', 'Premios', 10], ['P144', 'Basada en', 2]]) : [];
      const get = k => f.find(x => x.key === k);
      const story = stories(es, en);
      const main = es || en;
      if (main?.intro) story.unshift({ title: 'La canción', text: main.intro, source: main.lang === 'es' ? 'Wikipedia' : 'Wikipedia (inglés)', kind: 'verificable', lang: main.lang, url: main.url });
      if (descAdb) story.push({ title: 'Según TheAudioDB', text: descAdb.text, source: 'TheAudioDB', kind: 'comunidad', lang: descAdb.lang, url: `https://www.theaudiodb.com/track/${adb.idTrack}` });
      const sources = [e && { name: 'Wikidata', kind: 'verificable', url: `${WD}/wiki/${e.id}` }, es && { name: 'Wikipedia', kind: 'verificable', url: es.url },
        en && { name: 'Wikipedia (inglés)', kind: 'verificable', url: en.url }, adb && descAdb && { name: 'TheAudioDB', kind: 'comunidad', url: `https://www.theaudiodb.com/track/${adb.idTrack}` }].filter(Boolean);
      const year = (e && yearOf(e, 'P577')) || +(adb?.intYearReleased || 0) || 0;
      return {
        status: 'ok', title: (e && label(e)) || title, artist,
        chips: [year && { icon: 'star', text: String(year) }, get('P361')?.values[0] && { icon: 'disc', text: get('P361').values[0] },
          (get('P136')?.values.slice(0, 2).join(', ') || adb?.strGenre) && { icon: 'wave', text: get('P136')?.values.slice(0, 2).join(', ') || adb.strGenre },
          get('P166') && { icon: 'star', text: `${get('P166').values.length + get('P166').more} premios` }].filter(Boolean),
        credits: f.filter(x => ['P86', 'P676', 'P162'].includes(x.key)),
        facts: f.filter(x => !['P86', 'P676', 'P162', 'P577', 'P361'].includes(x.key)),
        stories: story, sources,
      };
    } catch (err) { return { status: 'error', message: err.message }; }
  });
}
