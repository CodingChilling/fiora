// Catálogos libres: Internet Archive (música con licencias abiertas / dominio público) y radios por internet.
import { hash } from './tags.js';

const IA = 'https://archive.org';
const RADIO = 'https://all.api.radio-browser.info/json';

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Respuesta ${r.status}`);
  return r.json();
}

const one = v => (Array.isArray(v) ? v[0] : v) || '';

/** Busca colecciones de audio en Internet Archive. */
export async function searchArchive(query) {
  const q = `(${query}) AND mediatype:audio AND format:(MP3)`;
  const url = `${IA}/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&sort[]=downloads+desc&rows=40&output=json`;
  const j = await getJson(url);
  return (j.response?.docs || []).map(d => ({
    id: d.identifier, title: one(d.title) || d.identifier, creator: one(d.creator), year: one(d.year),
    cover: `${IA}/services/img/${d.identifier}`,
  }));
}

function seconds(len) {
  if (!len) return 0;
  if (String(len).includes(':')) return String(len).split(':').reduce((a, p) => a * 60 + parseFloat(p), 0);
  return parseFloat(len) || 0;
}

/** Devuelve las pistas reproducibles de un elemento de Internet Archive. */
export async function archiveItem(identifier) {
  const j = await getJson(`${IA}/metadata/${encodeURIComponent(identifier)}`);
  const md = j.metadata || {};
  const files = (j.files || []).filter(f => /\.mp3$/i.test(f.name));
  const album = one(md.title) || identifier;
  const cover = `${IA}/services/img/${identifier}`;
  const tracks = files.map((f, i) => {
    const fileName = f.name.split('/').pop();
    return {
      id: `${f.size || hash(identifier + f.name)}:${fileName}`,
      title: f.title || fileName.replace(/\.mp3$/i, ''),
      artist: f.creator || f.artist || one(md.creator) || 'Internet Archive',
      album, trackNo: parseInt(f.track, 10) || i + 1,
      duration: seconds(f.length), size: +f.size || 0,
      url: `${IA}/download/${identifier}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
      coverUrl: cover, fileName, genre: one(md.subject), year: parseInt(one(md.year) || one(md.date), 10) || 0,
      archiveId: identifier, hasBlob: false, cloudName: '', lyrics: '',
    };
  });
  return { id: identifier, title: album, creator: one(md.creator), license: md.licenseurl || '', cover, tracks };
}

const toStation = s => ({
  id: 'radio:' + s.stationuuid, radio: true, title: s.name.trim(), url: s.url_resolved || s.url,
  artist: [s.country, (s.tags || '').split(',').slice(0, 2).join(', ')].filter(Boolean).join(' · '),
  coverUrl: s.favicon && s.favicon.startsWith('https://') ? s.favicon : '', album: 'Radio en directo',
});

/** Busca emisoras (solo HTTPS, porque la app se sirve por HTTPS). Sin texto: las más populares del país. */
export async function searchRadio(query, country = 'ES') {
  const p = new URLSearchParams({ limit: '60', hidebroken: 'true', order: 'clickcount', reverse: 'true', is_https: 'true' });
  if (query) p.set('name', query); else p.set('countrycode', country);
  const list = await getJson(`${RADIO}/stations/search?${p}`);
  return list.filter(s => (s.url_resolved || s.url || '').startsWith('https://')).map(toStation);
}
