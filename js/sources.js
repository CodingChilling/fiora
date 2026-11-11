// Catálogos libres: Internet Archive (música con licencias abiertas / dominio público) y radios por internet.
import { hash } from './tags.js';

const IA = 'https://archive.org';
const RADIO = 'https://all.api.radio-browser.info/json';

async function getJson(url) {
  const r = await fetch(url);
  if (r.status === 429) throw Object.assign(new Error('límite de uso'), { limit: true });
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
      artists: [f.creator || f.artist || one(md.creator) || 'Internet Archive'],
      album, trackNo: parseInt(f.track, 10) || i + 1,
      duration: seconds(f.length), size: +f.size || 0,
      url: `${IA}/download/${identifier}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
      coverUrl: cover, fileName, genre: one(md.subject), year: parseInt(one(md.year) || one(md.date), 10) || 0,
      archiveId: identifier, hasBlob: false, cloudName: '', lyrics: '',
    };
  });
  return { id: identifier, title: album, creator: one(md.creator), license: md.licenseurl || '', cover, tracks };
}

// ---------------------------------------------------------------------------
// Otros catálogos de música con licencias libres. Todos devuelven pistas sueltas.

const safeName = s => String(s || 'pista').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || 'pista';
const baseName = url => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch { return ''; } };
const stripHtml = s => String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const remoteTrack = t => ({ album: '', trackNo: 0, duration: 0, size: 0, genre: '', year: 0, hasBlob: false, cloudName: '', lyrics: '', coverUrl: '', ...t, artists: [t.artist] });

/** Openverse: buscador de obras Creative Commons (reúne Jamendo, ccMixter, Wikimedia y otros). Sin clave. */
async function searchOpenverse(q, page) {
  const p = new URLSearchParams({ q, category: 'music', page_size: '20', page: String(page) });
  const j = await getJson(`https://api.openverse.org/v1/audio/?${p}`);
  const items = (j.results || []).filter(r => r.url).map(r => remoteTrack({
    id: 'ov:' + r.id,
    title: r.title || 'Sin título', artist: r.creator || 'Autor desconocido', album: r.audio_set?.title || '',
    duration: (r.duration || 0) / 1000, genre: (r.genres || [])[0] || '',
    url: r.url, fileName: `${safeName(r.title)}.${r.filetype || 'mp3'}`,
    license: `CC ${r.license || ''} ${r.license_version || ''}`.toUpperCase().trim(), link: r.foreign_landing_url || '',
    origin: `Openverse${r.source ? ' · ' + r.source : ''}`,
  }));
  return { items, more: page < (j.page_count || 1) };
}

/** Wikimedia Commons: grabaciones libres y de dominio público (mucha música clásica). Sin clave. */
async function searchCommons(q, page) {
  const p = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrnamespace: '6', gsrlimit: '30',
    gsroffset: String((page - 1) * 30), gsrsearch: `${q} filetype:audio`,
    prop: 'videoinfo', viprop: 'url|size|mime|extmetadata|derivatives',
  });
  const j = await getJson(`https://commons.wikimedia.org/w/api.php?${p}`);
  const pages = Object.values(j.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const items = [];
  for (const pg of pages) {
    const v = pg.videoinfo?.[0];
    if (!v?.url || /midi/i.test(v.mime || '')) continue;
    // Si el original no es MP3, se usa la versión MP3 que genera Commons (suena en todos los navegadores).
    const mp3 = /mpeg/i.test(v.mime || '') ? null : (v.derivatives || []).find(d => /audio\/mpeg/i.test(d.type || ''));
    const url = mp3?.src || v.url;
    const meta = v.extmetadata || {};
    const title = stripHtml(meta.ObjectName?.value) || pg.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
    items.push(remoteTrack({
      id: 'wm:' + pg.pageid, title, artist: stripHtml(meta.Artist?.value).slice(0, 80) || 'Wikimedia Commons',
      duration: v.duration || 0, url, fileName: baseName(url) || `${safeName(title)}.mp3`,
      license: stripHtml(meta.LicenseShortName?.value), link: v.descriptionurl || '', origin: 'Wikimedia Commons',
    }));
  }
  return { items, more: !!j.continue };
}

/** Jamendo: música independiente con licencias Creative Commons. Necesita un "client_id" gratuito. */
async function searchJamendo(q, page, key) {
  if (!key) throw Object.assign(new Error('Falta la clave de Jamendo'), { needsKey: true });
  const p = new URLSearchParams({ client_id: key, format: 'json', limit: '30', offset: String((page - 1) * 30), include: 'musicinfo', audioformat: 'mp32' });
  if (q) p.set('search', q); else p.set('order', 'popularity_week');
  const j = await getJson(`https://api.jamendo.com/v3.0/tracks/?${p}`);
  if (j.headers?.code) throw Object.assign(new Error(j.headers.error_message || 'Jamendo rechazó la petición'), { needsKey: /client|credential/i.test(j.headers.error_message || '') });
  const items = (j.results || []).filter(r => r.audio).map(r => remoteTrack({
    id: 'jam:' + r.id, title: r.name, artist: r.artist_name || 'Jamendo', album: r.album_name || '',
    duration: +r.duration || 0, trackNo: +r.position || 0, year: parseInt(r.releasedate, 10) || 0,
    genre: r.musicinfo?.tags?.genres?.[0] || '', coverUrl: r.album_image || r.image || '',
    url: r.audio, fileName: `${safeName(r.name)}.mp3`,
    // el artista decide si su canción se puede descargar
    dl: r.audiodownload_allowed && r.audiodownload ? r.audiodownload : '', noDownload: !(r.audiodownload_allowed && r.audiodownload),
    license: (r.license_ccurl || '').replace(/^https?:\/\/creativecommons\.org\/licenses\//, 'CC ').replace(/\/+$/, '').replace(/\//g, ' ').toUpperCase(),
    link: r.shareurl || '', origin: 'Jamendo',
  }));
  return { items, more: items.length === 30 };
}

export const SOURCES = [
  { id: 'archive', name: 'Internet Archive', albums: true, about: 'Conciertos, sellos netlabel y grabaciones antiguas de dominio público.' },
  { id: 'openverse', name: 'Openverse', about: 'Buscador de música Creative Commons que reúne Jamendo, ccMixter y otros catálogos.' },
  { id: 'commons', name: 'Wikimedia Commons', about: 'Grabaciones libres y de dominio público; destaca en música clásica y tradicional.' },
  { id: 'jamendo', name: 'Jamendo', needsKey: true, about: 'Música independiente actual con licencias Creative Commons.' },
];

/** Busca en un catálogo. Devuelve {items, more}; en Internet Archive los elementos son álbumes. */
export async function search(source, q, page = 1, key = '') {
  if (source === 'openverse') return searchOpenverse(q, page);
  if (source === 'commons') return searchCommons(q, page);
  if (source === 'jamendo') return searchJamendo(q, page, key);
  return { items: await searchArchive(q), more: false };
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
