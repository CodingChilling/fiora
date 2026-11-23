// Información de calidad sobre artistas y canciones, solo de fuentes contrastadas y citadas:
//   · MusicBrainz (CC0): identifica al artista o la grabación sin confundir homónimos, y da
//     miembros, créditos (composición, letra, producción), versiones y samples.
//   · Wikidata (CC0): datos verificados (fechas, lugares, géneros, discográficas, premios).
//   · Wikipedia (CC BY-SA): biografía o historia, primero en español y, si no hay, en inglés.
// Se enlazan por identificador (MusicBrainz → Wikidata → Wikipedia), no por coincidencia de nombre.
// Si no hay información, se dice; no se rellena con nada.
import * as db from './db.js';
import { musicbrainz as mb, norm, sameTitle, sameArtist } from './covers.js';

const TTL = 30 * 86400000;          // la información se guarda en el dispositivo 30 días
const WAIT = 15000;
const WD = 'https://www.wikidata.org';
// Secciones de Wikipedia que no aportan al leer (listas de referencias, enlaces…)
const SKIP = /^(referencias|notas|notas y referencias|enlaces externos|véase también|bibliografía|fuentes|lecturas? adicionales?|discografía|filmografía|premios y nominaciones|references|notes|external links|see also|further reading|bibliography|sources|citations|discography|filmography|awards and nominations|track listing|lista de canciones|personnel|créditos|charts|listas|certifications|certificaciones|release history|historial de lanzamientos|year-end charts|weekly charts|monthly charts)$/i;

async function getJSON(url) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), WAIT);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) return null;
    return await r.json();
  } finally { clearTimeout(timer); }
}
async function cached(key, fn) {
  const hit = await db.get('kv', key).catch(() => null);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = await fn();
  if (data && data.status !== 'error') db.put('kv', key, { at: Date.now(), data }).catch(() => {});
  return data;
}
const offline = () => !navigator.onLine;

// ---------------------------------------------------------------- Wikidata
const qOf = url => (/\/(Q\d+)$/.exec(url || '') || [])[1] || '';
async function entity(q) {
  const d = await getJSON(`${WD}/wiki/Special:EntityData/${q}.json`);
  return d?.entities?.[q] || (d?.entities && Object.values(d.entities)[0]) || null;
}
/** El elemento de Wikidata que declara ese identificador de MusicBrainz (P434 artista, P435 obra, P4404 grabación). */
async function byStatement(prop, mbid) {
  const d = await getJSON(`${WD}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:${prop}=${mbid}`)}&srlimit=2&format=json&origin=*`);
  const hits = d?.query?.search || [];
  return hits.length === 1 ? hits[0].title : '';
}
async function labels(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const d = await getJSON(`${WD}/w/api.php?action=wbgetentities&ids=${ids.slice(i, i + 50).join('|')}&props=labels&languages=es|en&format=json&origin=*`);
    for (const [id, e] of Object.entries(d?.entities || {})) out.set(id, e.labels?.es?.value || e.labels?.en?.value || '');
  }
  return out;
}
const claims = (e, p) => (e?.claims?.[p] || []).filter(c => c.rank !== 'deprecated' && c.mainsnak?.datavalue);
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fmtTime(v) {
  const m = /^([+-])(\d+)-(\d\d)-(\d\d)/.exec(v?.time || '');
  if (!m) return '';
  const y = +m[2], mo = +m[3], d = +m[4], p = v.precision;
  if (p >= 11 && d) return `${d} de ${MONTHS[mo - 1]} de ${y}`;
  if (p === 10 && mo) return `${MONTHS[mo - 1]} de ${y}`;
  return String(y);
}
/**
 * Ficha de datos de un elemento: [{label, values:[texto]}], solo con las propiedades pedidas que
 * tenga. `props`: [[propiedad, etiqueta, máximo]].
 */
async function facts(e, props) {
  const ids = new Set();
  for (const [p] of props) for (const c of claims(e, p)) if (c.mainsnak.datavalue.type === 'wikibase-entityid') ids.add(c.mainsnak.datavalue.value.id);
  // año de los premios (calificador «fecha», P585)
  const lab = await labels([...ids]);
  const out = [];
  for (const [p, label, max = 8] of props) {
    const vals = [];
    for (const c of claims(e, p)) {
      const dv = c.mainsnak.datavalue;
      let v = dv.type === 'wikibase-entityid' ? lab.get(dv.value.id) : dv.type === 'time' ? fmtTime(dv.value) : dv.type === 'string' ? dv.value : '';
      if (!v) continue;
      const when = c.qualifiers?.P585?.[0]?.datavalue?.value;
      if (when) v += ` (${fmtTime({ ...when, precision: 9 })})`;
      if (!vals.includes(v)) vals.push(v);
    }
    if (vals.length) out.push({ label, values: vals.slice(0, max), more: Math.max(0, vals.length - max) });
  }
  return out;
}

// ---------------------------------------------------------------- Wikipedia
/** Artículo de Wikipedia de un elemento de Wikidata: en español si existe, si no en inglés. */
async function wikipedia(e) {
  for (const lang of ['es', 'en']) {
    const title = e?.sitelinks?.[`${lang}wiki`]?.title;
    if (!title) continue;
    const d = await getJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&explaintext=1&exsectionformat=wiki&piprop=thumbnail&pithumbsize=400&redirects=1&titles=${encodeURIComponent(title)}&format=json&origin=*`);
    const page = Object.values(d?.query?.pages || {})[0];
    if (!page?.extract) continue;
    return { lang, title: page.title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`, thumb: page.thumbnail?.source || '', ...sections(page.extract) };
  }
  return null;
}
/** Separa el texto en introducción y secciones (las de nivel 2, con sus subsecciones dentro). */
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
  return { intro: clean(intro), sections: out.map(s => ({ title: s.title, text: clean(s.text) })).filter(s => s.text.replace(/§[^\n]*/g, '').trim().length > 40 && !SKIP.test(s.title)) };
}

// ---------------------------------------------------------------- artistas
const MUSIC_JOBS = new Set(['Q177220', 'Q639669', 'Q36834', 'Q488205', 'Q753110', 'Q855091', 'Q130857', 'Q2252262', 'Q183945', 'Q386854', 'Q806349', 'Q1259917', 'Q12800682', 'Q486748']);
const GROUPS = new Set(['Q215380', 'Q5741069', 'Q2088357', 'Q9212979', 'Q281643', 'Q641066', 'Q1196726', 'Q56816954']);
const isMusical = e => claims(e, 'P31').some(c => GROUPS.has(c.mainsnak.datavalue.value.id)) || claims(e, 'P106').some(c => MUSIC_JOBS.has(c.mainsnak.datavalue.value.id));

/**
 * Busca el artista en MusicBrainz. Si hay varios con ese nombre, se queda con el que tenga alguno
 * de los discos o canciones de la biblioteca; si no se puede saber, lo dice ('ambiguous').
 */
async function findArtist(name, { albums = [], titles = [] }) {
  const d = await mb(`artist/?query=${encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`)}&fmt=json&limit=10`);
  const same = (d?.artists || []).filter(a => (a.score ?? 100) >= 85 && (norm(a.name) === norm(name) || (a.aliases || []).some(x => norm(x.name) === norm(name))));
  if (same.length <= 1) return { artist: same[0] || null };
  for (const a of same.slice(0, 3)) {
    for (const al of albums.slice(0, 2)) {
      const r = await mb(`release-group/?query=${encodeURIComponent(`arid:${a.id} AND releasegroup:"${al.replace(/"/g, '')}"`)}&fmt=json&limit=5`);
      if ((r?.['release-groups'] || []).some(g => sameTitle(g.title, al))) return { artist: a };
    }
    for (const ti of titles.slice(0, 2)) {
      const r = await mb(`recording/?query=${encodeURIComponent(`arid:${a.id} AND recording:"${ti.replace(/"/g, '')}"`)}&fmt=json&limit=5`);
      if ((r?.recordings || []).some(x => sameTitle(x.title, ti))) return { artist: a };
    }
  }
  return { artist: null, ambiguous: same.length };
}

/** Perfil de un artista. `known`: {albums, titles} de la biblioteca, para no confundir homónimos. */
export function artistInfo(name, known = {}) {
  return cached(`kb:a:${norm(name)}`, async () => {
    if (offline()) return { status: 'offline' };
    try {
      const { artist, ambiguous } = await findArtist(name, known);
      let mbData = null, q = '';
      if (artist) {
        mbData = await mb(`artist/${artist.id}?inc=url-rels+artist-rels&fmt=json`);
        q = qOf((mbData?.relations || []).find(r => r.type === 'wikidata')?.url?.resource) || await byStatement('P434', artist.id);
      }
      if (!artist && ambiguous) return { status: 'ambiguous', count: ambiguous };
      if (!q && !artist) {
        // Sin rastro en MusicBrainz: Wikidata por nombre, solo si hay un único músico o grupo con ese nombre exacto.
        const s = await getJSON(`${WD}/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=es&uselang=es&type=item&limit=7&format=json&origin=*`);
        const cands = (s?.search || []).filter(x => norm(x.label) === norm(name) || norm(x.match?.text) === norm(name));
        const ok = [];
        for (const c of cands.slice(0, 4)) { const e = await entity(c.id); if (e && isMusical(e)) ok.push(c.id); }
        if (ok.length === 1) q = ok[0];
      }
      const e = q ? await entity(q) : null;
      if (!artist && !e) return { status: 'none' };
      const group = mbData?.type === 'Group' || claims(e, 'P31').some(c => GROUPS.has(c.mainsnak.datavalue.value.id));
      const rels = mbData?.relations || [];
      const member = (r, who) => ({ name: who.name, begin: (r.begin || '').slice(0, 4), end: (r.end || '').slice(0, 4), ended: !!r.ended, roles: (r.attributes || []).filter(x => !/original|founder/i.test(x)) });
      const data = {
        status: 'ok', name: mbData?.name || name, mbid: artist?.id || '', group, disambiguation: mbData?.disambiguation || '',
        area: mbData?.area?.name || '', beginArea: mbData?.['begin-area']?.name || '',
        life: mbData?.['life-span'] ? { begin: mbData['life-span'].begin || '', end: mbData['life-span'].end || '', ended: !!mbData['life-span'].ended } : null,
        members: rels.filter(r => r.type === 'member of band' && r.direction === 'backward' && r.artist).map(r => member(r, r.artist)),
        memberOf: rels.filter(r => r.type === 'member of band' && r.direction === 'forward' && r.artist).map(r => member(r, r.artist)),
        links: rels.filter(r => r.type === 'official homepage' && r.url?.resource).map(r => r.url.resource).slice(0, 2),
        facts: e ? await facts(e, group
          ? [['P571', 'Formación', 1], ['P740', 'Origen', 2], ['P495', 'País', 2], ['P576', 'Disolución', 1], ['P136', 'Géneros', 6], ['P264', 'Discográficas', 5], ['P166', 'Premios', 12]]
          : [['P569', 'Nacimiento', 1], ['P19', 'Lugar de nacimiento', 1], ['P570', 'Fallecimiento', 1], ['P20', 'Lugar de fallecimiento', 1], ['P1303', 'Instrumentos', 6], ['P136', 'Géneros', 6], ['P264', 'Discográficas', 5], ['P166', 'Premios', 12]]) : [],
        wiki: e ? await wikipedia(e) : null,
        wikidata: q ? `${WD}/wiki/${q}` : '',
      };
      return data;
    } catch (err) { return { status: 'error', message: err.message }; }
  });
}

// ---------------------------------------------------------------- canciones
/** Información de una canción: créditos, versiones, samples, ficha de Wikidata y artículo de Wikipedia. */
export function songInfo({ title, artist, album = '' }) {
  return cached(`kb:s:${norm(artist)}|${norm(title)}`, async () => {
    if (offline()) return { status: 'offline' };
    try {
      const d = await mb(`recording/?query=${encodeURIComponent(`recording:"${title.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`)}&fmt=json&limit=15`);
      const recs = (d?.recordings || []).filter(r => (r.score ?? 100) >= 85 && sameTitle(r.title, title) && sameArtist(r['artist-credit'], artist));
      // Mejor la grabación del mismo disco; si no, la que más lanzamientos tiene (la original, no una rareza).
      recs.sort((a, b) => (album ? (b.releases || []).some(x => sameTitle(x.title, album)) - (a.releases || []).some(x => sameTitle(x.title, album)) : 0) || (b.releases?.length || 0) - (a.releases?.length || 0));
      const rec = recs[0];
      let full = null, work = null, workFull = null;
      if (rec) {
        full = await mb(`recording/${rec.id}?inc=artist-rels+work-rels+url-rels+recording-rels&fmt=json`);
        const perf = (full?.relations || []).find(r => r.type === 'performance' && r.work);
        work = perf ? { id: perf.work.id, title: perf.work.title, cover: (perf.attributes || []).includes('cover'), live: (perf.attributes || []).includes('live') } : null;
        if (work) workFull = await mb(`work/${work.id}?inc=artist-rels+url-rels&fmt=json`);
      }
      const wdUrl = r => (r?.relations || []).find(x => x.type === 'wikidata')?.url?.resource;
      let q = qOf(wdUrl(workFull)) || qOf(wdUrl(full));
      if (!q && work) q = await byStatement('P435', work.id);
      if (!q && rec) q = await byStatement('P4404', rec.id);
      const e = q ? await entity(q) : null;
      if (!rec && !e) return { status: 'none' };
      const people = (rels, types) => {
        const m = new Map();
        for (const r of rels || []) if (types.includes(r.type) && r.artist) m.set(r.artist.name, true);
        return [...m.keys()];
      };
      const credits = [
        ['Composición', people(workFull?.relations, ['composer', 'writer'])],
        ['Letra', people(workFull?.relations, ['lyricist'])],
        ['Producción', people(full?.relations, ['producer'])],
        ['Grabación y mezcla', people(full?.relations, ['engineer', 'recording', 'mix', 'mastering'])],
        ['Arreglos', people([...(full?.relations || []), ...(workFull?.relations || [])], ['arranger', 'instrument arranger', 'vocal arranger'])],
      ].filter(([, v]) => v.length).map(([label, values]) => ({ label, values: values.slice(0, 10), more: Math.max(0, values.length - 10) }));
      const samples = (full?.relations || []).filter(r => r.type === 'samples material' && r.direction === 'forward' && r.recording)
        .map(r => ({ title: r.recording.title, artist: (r.recording['artist-credit'] || []).map(c => c.name).join(', ') }));
      return {
        status: 'ok', title: rec?.title || title, artist, mbid: rec?.id || '',
        cover: !!work?.cover, live: !!work?.live, work: work?.title || '',
        credits, samples,
        facts: e ? await facts(e, [['P577', 'Publicación', 1], ['P361', 'Parte de', 3], ['P136', 'Géneros', 5], ['P264', 'Discográfica', 3], ['P86', 'Composición', 6], ['P676', 'Letra', 6], ['P162', 'Producción', 6], ['P166', 'Premios', 10]]) : [],
        wiki: e ? await wikipedia(e) : null,
        wikidata: q ? `${WD}/wiki/${q}` : '',
      };
    } catch (err) { return { status: 'error', message: err.message }; }
  });
}
