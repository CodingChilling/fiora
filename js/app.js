// Interfaz de Fiora: navegación, pantallas, menús y reproductor.
import { fileOutdated, S, load, on, emit, isFav, toggleFav, allTracks, livePlaylists, savePlaylist, saveKV, saveTrack, collator, artistsOf, albumArtistOf, setEdit, MOODS, daypart, genreOptions } from './store.js';
import * as db from './db.js';
import * as ai from './ai.js';
import { splitArtists, shrinkCover, hash } from './tags.js';
import * as lib from './library.js';
import * as player from './player.js';
import { P } from './player.js';
import * as cloud from './cloud.js';
import * as oci from './oci.js';
import * as vault from './vault.js';
import * as account from './account.js';
import * as src from './sources.js';
import { getLyrics } from './lyrics.js';
import * as recs from './recs.js';
import { icon } from './icons.js';
import { JAMENDO_CLIENT_ID } from './config.js';

// ---------------------------------------------------------------- utilidades
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const fmt = s => {
  if (!Number.isFinite(s) || s <= 0) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
const hue = str => { let h = 0; for (const c of String(str)) h = (h * 31 + c.codePointAt(0)) % 360; return h; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const totalTime = tracks => {
  const min = Math.round(tracks.reduce((a, t) => a + (t.duration || 0), 0) / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};
const inLibrary = t => S.tracks.has(t.id);
const playable = t => !!(t.radio || t.hasBlob || t.url || (t.cloudName && cloud.configured()));

// Carátulas: se pinta un marcador y se rellena la imagen después de insertar el HTML.
let pending = [];
function cover(t, cls = '') {
  const label = String(t?.album || t?.title || '♪').trim();
  pending.push(t);
  return `<span class="cover ${cls}" style="--hue:${hue(label)}" data-cv="${pending.length - 1}"><i>${esc([...label][0] || '♪')}</i></span>`;
}
function setHTML(el, html, where) {
  if (where) el.insertAdjacentHTML(where, html); else el.innerHTML = html;
  const jobs = pending; pending = [];
  for (const n of $$('[data-cv]', el)) {
    const t = jobs[+n.dataset.cv];
    n.removeAttribute('data-cv');
    lib.coverUrl(t).then(url => {
      if (!url) return;
      const img = new Image();
      img.onload = () => { n.style.backgroundImage = `url("${url}")`; n.classList.add('has'); };
      img.src = url;
    });
  }
}

// ------------------------------------------------------------------- avisos
function toast(msg, ms = 3400) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  $('#toasts').append(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return { set: m => { el.textContent = m; }, done: (m, t = 3400) => { if (m) el.textContent = m; setTimeout(() => el.remove(), m ? t : 0); } };
}
on('toast', toast);

// ------------------------------------------------------- hojas y diálogos
const sheet = $('#sheet');
let sheetClick = null;
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); else sheetClick?.(e); });
function openSheet(html, onClick) {
  sheetClick = onClick;
  setHTML(sheet, html);
  if (!sheet.open) sheet.showModal();
}
function menu(headHTML, items) {
  items = items.filter(Boolean);
  openSheet(`${headHTML}<div class="menu">${items.map((it, i) =>
    `<button data-m="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon)}<span>${esc(it.label)}</span></button>`).join('')}</div>`,
  e => {
    const b = e.target.closest('[data-m]');
    // La acción se lanza cuando el diálogo ha terminado de cerrarse (puede abrir otro).
    if (b) { sheet.addEventListener('close', () => items[+b.dataset.m].fn(), { once: true }); sheet.close(); }
  });
}
function ask({ title, text = '', value = '', placeholder = '', ok = 'Guardar', type = 'text' }) {
  return new Promise(resolve => {
    let result = null;
    openSheet(`<form class="dlg" method="dialog"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
      <label class="field"><input name="v" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="${type === 'password' ? 'new-password' : 'off'}" ${type === 'password' ? 'minlength="6"' : ''} required></label>
      <div class="actions"><button type="button" class="btn ghost" data-x>Cancelar</button><button class="btn primary">${esc(ok)}</button></div></form>`,
    e => { if (e.target.closest('[data-x]')) sheet.close(); });
    const form = $('form', sheet);
    form.onsubmit = () => { result = form.v.value.trim() || null; };
    sheet.addEventListener('close', () => resolve(result), { once: true });
    setTimeout(() => form.v.select(), 50);
  });
}
function confirmDlg(title, text, ok = 'Eliminar') {
  return new Promise(resolve => {
    let result = false;
    openSheet(`<div class="dlg"><h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="actions"><button class="btn ghost" data-x>Cancelar</button><button class="btn danger" data-ok>${esc(ok)}</button></div></div>`,
    e => {
      if (e.target.closest('[data-ok]')) { result = true; sheet.close(); }
      else if (e.target.closest('[data-x]')) sheet.close();
    });
    sheet.addEventListener('close', () => resolve(result), { once: true });
  });
}

// ------------------------------------------------------- listas de canciones
const CHUNK = 150;
let lists = [];
const getList = k => (k === 'q' ? { tracks: P.queue, opts: { queue: true } } : k === 'u' ? { tracks: P.user, opts: { queue: true, user: true } } : lists[+k]);

// Nombres de artista y álbum que llevan a su página (solo para canciones de la biblioteca).
const artistLinks = t => (t.radio || !inLibrary(t) ? esc(t.artist || '')
  : artistsOf(t).map(a => `<span class="link" data-act="go-artist" data-name="${esc(a)}">${esc(a)}</span>`).join(', '));
const albumLink = t => (t.album && inLibrary(t) ? `<span class="link" data-act="go-album" data-key="${esc(lib.albumKey(t))}">${esc(t.album)}</span>` : esc(t.album || ''));

function rowHTML(t, i, o) {
  const cur = P.current && P.current.id === t.id && (o.queue ? !o.user && !P.fromUser && i === P.index : true) ? ' is-playing' : '';
  const where = t.radio || o.queue || o.dup ? '' : !t.hasBlob && (t.cloudName || t.url)
    ? `<span class="where" title="En línea">${icon('cloud')}</span>`
    : t.hasBlob && (t.cloudName || t.url) ? `<span class="where" title="Disponible sin conexión">${icon('offline')}</span>` : '';
  const sub = t.radio ? esc(t.artist) : o.dup ? copyInfo(t)
    : [artistLinks(t), o.hideAlbum ? '' : albumLink(t), o.remote ? esc(t.license || '') : ''].filter(Boolean).join(' · ');
  return `<li class="row${cur}${playable(t) ? '' : ' unavailable'}" data-i="${i}" data-id="${esc(t.id)}">
    ${o.numbered ? `<span class="num">${t.trackNo || i + 1}</span>` : ''}
    <button class="row-main" data-act="play">${o.numbered ? '' : cover(t)}<span class="row-text"><b>${esc(t.title)}</b><small>${sub}</small></span></button>
    ${where}
    ${o.dup ? (i === 0 ? '<span class="keep-tag">Se conserva</span>' : '<button class="chip" data-act="dup-keep">Conservar</button>') : ''}
    ${!o.dup && !t.radio && inLibrary(t) ? `<button class="icon-btn fav ${isFav(t.id) ? 'on' : ''}" data-act="fav" aria-label="Me gusta">${icon('heart')}</button>` : ''}
    ${o.dup ? '' : `<span class="dur">${fmt(t.duration)}</span>`}
    <button class="icon-btn" data-act="more" aria-label="Más opciones">${icon('more')}</button>
  </li>`;
}
// Detalles de una copia en la lista de repetidas: dónde está, si tiene portada y cuándo se añadió.
function copyInfo(t) {
  const b = t.cloudName && (cloud.buckets().find(x => x.id === t.bucketId) || (!t.bucketId && cloud.buckets()[0]));
  const where = b ? `nube «${esc(b.name)}»${t.hasBlob ? ' y este dispositivo' : ''}` : t.hasBlob ? 'solo en este dispositivo' : t.url ? 'en línea' : 'sin archivo';
  const date = t.addedAt ? `añadida el ${new Date(t.addedAt).toLocaleDateString('es')}` : '';
  return [where, t.coverId || t.coverUrl ? 'con portada' : 'sin portada', date, esc(t.album || t.fileName || '')].filter(Boolean).join(' · ');
}
function rowsChunk(k, from) {
  const { tracks, opts } = getList(k);
  const to = Math.min(tracks.length, from + CHUNK);
  let out = '';
  for (let i = from; i < to; i++) out += rowHTML(tracks[i], i, opts);
  if (to < tracks.length) out += `<li class="sentinel" data-from="${to}"></li>`;
  return out;
}
function rows(tracks, opts = {}) {
  const k = lists.push({ tracks, opts }) - 1;
  return `<ol class="rows" data-list="${k}">${rowsChunk(k, 0)}</ol>`;
}
const more = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const s = e.target, ol = s.parentNode;
    more.unobserve(s);
    if (!ol) continue;
    s.remove();
    setHTML(ol, rowsChunk(ol.dataset.list, +s.dataset.from), 'beforeend');
    watchSentinels(ol);
  }
}, { rootMargin: '600px' });
const watchSentinels = root => $$('.sentinel', root).forEach(s => more.observe(s));

// ---------------------------------------------------------------- navegación
const view = $('#view');
const NAV = [['inicio', 'Inicio', 'home'], ['biblioteca', 'Biblioteca', 'library'], ['playlists', 'Playlists', 'list'], ['explorar', 'Explorar', 'compass'], ['ajustes', 'Ajustes', 'settings']];
const SECTION = { estadisticas: 'ajustes', repetidas: 'ajustes', album: 'biblioteca', artista: 'biblioteca', genero: 'biblioteca', ambiente: 'biblioteca', playlist: 'playlists', favoritos: 'playlists', mix: 'inicio', archivo: 'explorar' };
$('#nav-links').innerHTML = NAV.map(([id, label, ic]) => `<a href="#/${id}" data-nav="${id}">${icon(ic)}<span>${label}</span></a>`).join('');

function show(html) {
  setHTML(view, `<div class="wrap">${html}</div>`);
  watchSentinels(view);
}
let lastHash = null;
async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name = '', ...args] = hash.split('/').map(decodeURIComponent);
  const fn = ROUTES[name] || viewHome;
  const section = SECTION[name] || (ROUTES[name] ? name : 'inicio');
  $$('#nav-links a').forEach(a => a.classList.toggle('on', a.dataset.nav === section));
  lists = [];
  const keep = hash === lastHash ? view.scrollTop : 0;
  lastHash = hash;
  await fn(...args);
  view.scrollTop = keep;
}
let refreshTimer = null;
const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(route, 120); };
const empty = (ic, title, text, actions = '') =>
  `<div class="empty">${icon(ic)}<h2>${title}</h2><div>${text}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
const ADD_BTN = `<button class="btn primary" data-act="add-music">${icon('plus')}Añadir música</button>`;

// -------------------------------------------------------------------- inicio
const MIXES = {
  diaria: { title: 'Mezcla diaria', sub: 'Tus habituales y algo que tenías olvidado', icon: 'spark', hue: 15, get: () => recs.dailyMix() },
  redescubre: { title: 'Redescubre', sub: 'Lo que llevas tiempo sin escuchar', icon: 'compass', hue: 190, get: () => recs.rediscover() },
  top: { title: 'Lo más escuchado', sub: 'Tus canciones de siempre', icon: 'disc', hue: 280, get: () => recs.mostPlayed() },
  recientes: { title: 'Añadidas recientemente', sub: 'Lo último de tu biblioteca', icon: 'plus', hue: 120, get: () => recs.recentlyAdded() },
  // Solo aparece cuando ya hay suficientes escuchas en esta franja del día.
  momento: { get title() { return `Para ${recs.PART_NAMES[daypart()]}`; }, sub: 'Lo que sueles escuchar a estas horas', icon: 'radio', hue: 45, get: () => recs.momentMix(), hideEmpty: true },
};
const MOOD_HUE = m => (MOODS.indexOf(m) * 47 + 200) % 360;
function viewHome() {
  const h = new Date().getHours();
  const hello = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  if (!S.tracks.size) {
    return show(`<div class="head"><h1>${hello}</h1></div>${empty('disc', 'Tu biblioteca está vacía',
      'Añade archivos de música de este dispositivo, conecta tu nube o explora música libre y radios.',
      `${ADD_BTN}<a class="btn" href="#/explorar">${icon('compass')}Explorar música libre</a><a class="btn" href="#/ajustes">${icon('user')}${account.user() ? 'Conectar nube' : 'Iniciar sesión'}</a>`)}`);
  }
  const recent = allTracks().filter(t => S.stats[t.id]?.last).sort((a, b) => S.stats[b.id].last - S.stats[a.id].last).slice(0, 6);
  const newest = albums().sort((a, b) => b.addedAt - a.addedAt).slice(0, 12);
  const topMoods = recs.tagCounts().moods.filter(([, n]) => n >= 3).slice(0, 6);
  show(`<div class="head"><h1>${hello}</h1></div>
    <div class="mixes">${Object.entries(MIXES).filter(([, m]) => !m.hideEmpty || m.get().length).map(([id, m]) =>
      `<a class="mix" href="#/mix/${id}"><span class="badge" style="--hue:${m.hue}">${icon(m.icon)}</span><span><b>${m.title}</b><small>${m.sub}</small></span></a>`).join('')}
      <a class="mix" href="#/favoritos"><span class="badge" style="--hue:340">${icon('heart')}</span><span><b>Canciones que te gustan</b><small>${plural(allTracks().filter(t => isFav(t.id)).length, 'canción', 'canciones')}</small></span></a>
    </div>
    ${topMoods.length ? `<h2>Por ambiente</h2><div class="mixes">${topMoods.map(([m, n]) =>
      `<a class="mix" href="#/ambiente/${enc(m)}"><span class="badge" style="--hue:${MOOD_HUE(m)}">${icon('spark')}</span><span><b style="text-transform:capitalize">${esc(m)}</b><small>${plural(n, 'canción', 'canciones')}</small></span></a>`).join('')}</div>` : ''}
    ${recent.length ? `<h2>Escuchado hace poco</h2>${rows(recent)}` : ''}
    ${newest.length ? `<h2>Álbumes recientes</h2><div class="strip">${newest.map(albumCard).join('')}</div>` : ''}`);
}

function viewMix(id) {
  const m = MIXES[id];
  if (!m) return viewHome();
  const tracks = m.get();
  show(`<div class="hero"><span class="cover" style="--hue:${m.hue}"><i>${icon(m.icon)}</i></span>
      <div class="info"><div class="kind">Hecha para ti</div><h1>${m.title}</h1><p>${m.sub} · ${plural(tracks.length, 'canción', 'canciones')}</p>${playButtons(tracks)}</div></div>
    ${tracks.length ? rows(tracks) : empty('spark', 'Aún no hay nada aquí', 'Escucha música durante unos días y esta lista se irá llenando.')}`);
}
// Pistas de la biblioteca que aún no están guardadas en el dispositivo y se pueden descargar.
const needsDownload = t => inLibrary(t) && !t.hasBlob && !!(t.cloudName || t.url) && !t.noDownload;
const downloadAllBtn = tracks => {
  const n = tracks.filter(needsDownload).length;
  return n ? `<button class="btn" data-act="download-all">${icon('download')}Descargar${n < tracks.length ? ` ${n}` : ''}</button>` : '';
};
function viewTag(kind, name) {
  const mood = kind === 'ambiente';
  const tracks = mood ? recs.moodMix(name, 500) : recs.byGenre(name).sort((a, b) => collator.compare(a.title, b.title));
  show(`<div class="hero"><span class="cover" style="--hue:${mood ? MOOD_HUE(name) : hue(name)}"><i>${icon(mood ? 'spark' : 'disc')}</i></span>
      <div class="info"><div class="kind">${mood ? 'Ambiente' : 'Género'}</div><h1 style="text-transform:${mood ? 'capitalize' : 'none'}">${esc(name)}</h1><p>${plural(tracks.length, 'canción', 'canciones')}${mood ? ' · primero las que más te gustan' : ''}</p>${playButtons(tracks)}</div></div>
    ${tracks.length ? rows(tracks) : empty('disc', 'Sin canciones', 'Ninguna canción tiene esta etiqueta todavía.')}`);
}
const playButtons = tracks => (tracks.length
  ? `<div class="actions"><button class="btn primary" data-act="play-all">${icon('play')}Reproducir</button><button class="btn" data-act="shuffle-all">${icon('shuffle')}Aleatorio</button>${downloadAllBtn(tracks)}</div>` : '');

// ---------------------------------------------------------------- biblioteca
function albums(tracks = allTracks()) {
  const m = new Map();
  for (const t of tracks) {
    if (!t.album) continue;
    const k = lib.albumKey(t);
    let a = m.get(k);
    if (!a) m.set(k, a = { key: k, title: t.album, artist: albumArtistOf(t), year: t.year, tracks: [], addedAt: 0, coverId: '', coverUrl: '' });
    a.tracks.push(t);
    a.addedAt = Math.max(a.addedAt, t.addedAt || 0);
    a.coverId ||= t.coverId || ''; a.coverUrl ||= t.coverUrl || '';
  }
  return [...m.values()];
}
const albumCard = a => `<a class="card" href="#/album/${enc(a.key)}">${cover({ album: a.title, coverId: a.coverId, coverUrl: a.coverUrl })}<span><b>${esc(a.title)}</b><small>${esc(a.artist)}</small></span></a>`;
function artists() {
  const m = new Map();
  for (const t of allTracks()) {
    for (const name of artistsOf(t)) {
      let a = m.get(name);
      if (!a) m.set(name, a = { name, tracks: [], coverId: '', coverUrl: '' });
      a.tracks.push(t);
      a.coverId ||= t.coverId || ''; a.coverUrl ||= t.coverUrl || '';
    }
  }
  return [...m.values()];
}

let libQuery = '';
// Búsqueda sin distinguir mayúsculas ni tildes.
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// ------------------------------------------------- filtros de las canciones
const DAY = 86400000;
const F_AVAIL = {
  offline: ['Sin conexión', t => t.hasBlob],
  cloud: ['En la nube', t => !!t.cloudName],
  local: ['Solo en este dispositivo', t => t.hasBlob && !t.cloudName && !t.url],
  free: ['Música libre', t => !!t.url && !t.cloudName],
};
const F_PLAYS = {
  never: ['Sin escuchar', t => !S.stats[t.id]?.plays],
  heard: ['Escuchadas', t => S.stats[t.id]?.plays > 0],
  skipped: ['Que sueles saltar', t => (S.stats[t.id]?.skips || 0) >= 2 && (S.stats[t.id].skips || 0) > (S.stats[t.id].done || 0)],
};
const F_ADDED = { week: ['Última semana', 7], month: ['Último mes', 30], year: ['Último año', 365] };
const stat = (t, k) => S.stats[t.id]?.[k] || 0;
const F_SORT = {
  title: ['Título', (a, b) => collator.compare(a.title, b.title)],
  artist: ['Artista', (a, b) => collator.compare(a.artist || '', b.artist || '') || collator.compare(a.album || '', b.album || '') || (a.trackNo || 999) - (b.trackNo || 999)],
  album: ['Álbum', (a, b) => collator.compare(a.album || '', b.album || '') || (a.trackNo || 999) - (b.trackNo || 999)],
  added: ['Añadidas recientemente', (a, b) => (b.addedAt || 0) - (a.addedAt || 0)],
  plays: ['Más escuchadas', (a, b) => stat(b, 'plays') - stat(a, 'plays')],
  recent: ['Escuchadas hace poco', (a, b) => stat(b, 'last') - stat(a, 'last')],
  year: ['Año (más nuevas)', (a, b) => (b.year || 0) - (a.year || 0)],
  duration: ['Duración (más largas)', (a, b) => (b.duration || 0) - (a.duration || 0)],
};
const libF = {};
const resetFilters = () => Object.assign(libF, { avail: '', fav: false, genres: [], moods: [], decades: [], plays: '', added: '' });
resetFilters();
const decadeOf = t => (t.year > 1000 ? Math.floor(t.year / 10) * 10 : 0);
const decadeName = d => (d >= 2000 ? `${d}s` : `${String(d).slice(2)}s`);
const sortKey = () => (F_SORT[S.settings.libSort] ? S.settings.libSort : 'title');
const lower = l => l.map(x => x.toLowerCase());

/** Canciones de la biblioteca que pasan los filtros. Dentro de un grupo vale cualquiera; entre grupos, todos. */
function filteredTracks() {
  const g = lower(libF.genres), m = libF.moods, now = Date.now();
  return allTracks().filter(t =>
    (!libF.avail || F_AVAIL[libF.avail][1](t)) &&
    (!libF.fav || isFav(t.id)) &&
    (!g.length || (t.genres || []).some(x => g.includes(x.toLowerCase()))) &&
    (!m.length || (t.moods || []).some(x => m.includes(x))) &&
    (!libF.decades.length || libF.decades.includes(decadeOf(t))) &&
    (!libF.plays || F_PLAYS[libF.plays][1](t)) &&
    (!libF.added || now - (t.addedAt || 0) <= F_ADDED[libF.added][1] * DAY));
}
/** Filtros activos como chips que se pueden quitar: [etiqueta, clave, valor]. */
function activeFilters() {
  const out = [];
  if (libF.avail) out.push([F_AVAIL[libF.avail][0], 'avail']);
  if (libF.fav) out.push(['Me gusta', 'fav']);
  for (const x of libF.genres) out.push([x, 'genres', x]);
  for (const x of libF.moods) out.push([x, 'moods', x]);
  for (const x of libF.decades) out.push([`Años ${decadeName(x)}`, 'decades', x]);
  if (libF.plays) out.push([F_PLAYS[libF.plays][0], 'plays']);
  if (libF.added) out.push([`Añadidas: ${F_ADDED[libF.added][0].toLowerCase()}`, 'added']);
  return out;
}
function clearFilter(k, v) {
  if (Array.isArray(libF[k])) libF[k] = libF[k].filter(x => String(x) !== String(v));
  else libF[k] = k === 'fav' ? false : '';
}
function toggleFilter(k, v) {
  if (k === 'fav') libF.fav = !libF.fav;
  else if (Array.isArray(libF[k])) {
    const val = k === 'decades' ? +v : v;
    libF[k] = libF[k].includes(val) ? libF[k].filter(x => x !== val) : [...libF[k], val];
  } else libF[k] = libF[k] === v ? '' : v;
}
function filterSheetHTML() {
  const { genres: raw, moods } = recs.tagCounts();
  // Géneros que solo cambian en mayúsculas cuentan como uno (se muestra la forma más usada).
  const merged = new Map();
  for (const [x, c] of raw) { const k = x.toLowerCase(), m = merged.get(k); if (m) m[1] += c; else merged.set(k, [x, c]); }
  const genres = [...merged.values()].sort((a, b) => b[1] - a[1]);
  const decades = [...new Set(allTracks().map(decadeOf).filter(Boolean))].sort((a, b) => b - a);
  const chip = (k, v, label, on, extra = '') => `<button type="button" class="chip ${on ? 'on' : ''}" data-f="${k}" data-v="${esc(v)}" aria-pressed="${on}">${esc(label)}${extra}</button>`;
  const n = c => ` <small>${c}</small>`;
  const group = (title, body) => (body ? `<h4>${title}</h4><div class="chips">${body}</div>` : '');
  const g = lower(libF.genres);
  const count = applySearch(filteredTracks()).length;
  return `<div class="dlg filters"><h3>Filtrar canciones</h3>
    ${group('Ordenar por', Object.entries(F_SORT).map(([k, [l]]) => chip('sort', k, l, sortKey() === k)).join(''))}
    ${group('Dónde están', Object.entries(F_AVAIL).map(([k, [l]]) => chip('avail', k, l, libF.avail === k)).join('') + chip('fav', '1', 'Me gusta', libF.fav))}
    ${group('Géneros', genres.map(([x, c]) => chip('genres', x, x, g.includes(x.toLowerCase()), n(c))).join(''))}
    ${group('Lo que transmite', moods.map(([x, c]) => chip('moods', x, x, libF.moods.includes(x), n(c))).join(''))}
    ${group('Época', decades.map(d => chip('decades', d, `Años ${decadeName(d)}`, libF.decades.includes(d))).join(''))}
    ${group('Escuchas', Object.entries(F_PLAYS).map(([k, [l]]) => chip('plays', k, l, libF.plays === k)).join(''))}
    ${group('Añadidas', Object.entries(F_ADDED).map(([k, [l]]) => chip('added', k, l, libF.added === k)).join(''))}
    <div class="actions"><button type="button" class="btn ghost" data-f-clear ${activeFilters().length ? '' : 'disabled'}>Quitar filtros</button>
      <button type="button" class="btn primary" data-x>Ver ${plural(count, 'canción', 'canciones')}</button></div></div>`;
}
function openFilters() {
  openSheet(filterSheetHTML(), e => {
    const f = e.target.closest('[data-f]');
    if (e.target.closest('[data-x]')) return sheet.close();
    if (e.target.closest('[data-f-clear]')) resetFilters();
    else if (f?.dataset.f === 'sort') { S.settings.libSort = f.dataset.v; saveKV('settings', false); }
    else if (f) toggleFilter(f.dataset.f, f.dataset.v);
    else return;
    const scroll = $('.filters', sheet)?.scrollTop || 0;
    setHTML(sheet, filterSheetHTML());
    $('.filters', sheet).scrollTop = scroll;
    paintLibrary();
  });
}
const applySearch = list => {
  const q = fold(libQuery.trim());
  return q ? list.filter(t => [t.title, t.artist, t.album, ...(t.genres || []), ...(t.moods || [])].some(x => fold(x).includes(q))) : list;
};
function paintLibrary() {
  const box = $('#lib-list');
  if (!box) return;
  lists = [];
  setHTML(box, libraryList(box.dataset.tab));
  watchSentinels(box);
}

function libraryList(tab) {
  const q = fold(libQuery.trim());
  const hit = (...f) => !q || f.some(x => fold(x).includes(q));
  if (tab === 'albumes') {
    const list = albums().filter(a => hit(a.title, a.artist)).sort((a, b) => collator.compare(a.title, b.title));
    return list.length ? `<div class="grid">${list.map(albumCard).join('')}</div>` : empty('disc', 'Sin álbumes', 'No hay álbumes que coincidan.');
  }
  if (tab === 'generos') {
    const { moods, genres } = recs.tagCounts();
    const chips = (list, route) => `<div class="chips">${list.filter(([n]) => hit(n)).map(([n, c]) => `<a class="chip" href="#/${route}/${enc(n)}">${esc(n)} <small class="muted">${c}</small></a>`).join('')}</div>`;
    if (!moods.length && !genres.length) return empty('disc', 'Aún no hay etiquetas', 'Los géneros salen de las etiquetas de tus archivos. Para añadir géneros y ambientes a mano o con IA, activa el modo desarrollador en Ajustes.');
    return `${moods.length ? `<h2 style="margin-top:6px">Lo que transmite</h2>${chips(moods, 'ambiente')}` : ''}${genres.length ? `<h2>Géneros</h2>${chips(genres, 'genero')}` : ''}`;
  }
  if (tab === 'artistas') {
    const list = artists().filter(a => hit(a.name)).sort((a, b) => collator.compare(a.name, b.name));
    return list.length ? `<div class="grid">${list.map(a =>
      `<a class="card" href="#/artista/${enc(a.name)}">${cover({ album: a.name, coverId: a.coverId, coverUrl: a.coverUrl }, 'round')}<span><b>${esc(a.name)}</b><small>${plural(a.tracks.length, 'canción', 'canciones')}</small></span></a>`).join('')}</div>`
      : empty('user', 'Sin artistas', 'No hay artistas que coincidan.');
  }
  const list = applySearch(filteredTracks()).sort(F_SORT[sortKey()][1]);
  const active = activeFilters();
  const tools = `<div class="lib-tools">
      <button class="btn ${active.length ? 'on' : ''}" data-act="lib-filter">${icon('filter')}Filtrar${active.length ? ` <span class="count">${active.length}</span>` : ''}</button>
      <button class="chip" data-act="lib-filter" aria-label="Ordenar">${esc(F_SORT[sortKey()][0])}</button>
      ${active.map(([l, k, v]) => `<button class="chip on" data-act="lib-unfilter" data-k="${k}" data-v="${esc(v ?? '')}" aria-label="Quitar filtro ${esc(l)}">${esc(l)} ✕</button>`).join('')}
    </div>`;
  const narrowed = active.length || q;
  return `${tools}${list.length
    ? `${narrowed ? `<p class="muted lib-count">${plural(list.length, 'canción', 'canciones')} · ${totalTime(list)}</p>${playButtons(list)}` : ''}${rows(list)}`
    : empty('search', 'Sin resultados', active.length ? 'Ninguna canción cumple los filtros.' : 'Ninguna canción coincide con la búsqueda.',
      active.length ? '<button class="btn" data-act="lib-clear">Quitar filtros</button>' : '')}`;
}
function viewLibrary(tab = 'canciones') {
  if (!S.tracks.size) {
    return show(`<div class="head"><h1>Biblioteca</h1></div>${empty('library', 'Aquí aparecerá tu música',
      'Elige archivos o una carpeta entera (MP3, FLAC, M4A, OGG…). Se guardan en este dispositivo para escucharlos sin conexión.',
      `${ADD_BTN}`)}`);
  }
  const tabs = [['canciones', 'Canciones'], ['albumes', 'Álbumes'], ['artistas', 'Artistas'], ['generos', 'Géneros']];
  show(`<div class="head"><h1>Biblioteca</h1>${ADD_BTN}</div>
    <label class="field" style="margin-bottom:14px">${icon('search')}<input id="lib-q" type="search" placeholder="Buscar en tu biblioteca" value="${esc(libQuery)}" autocomplete="off"></label>
    <div class="tabs">${tabs.map(([id, l]) => `<a href="#/biblioteca/${id}" class="${id === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="lib-list" data-tab="${tab}">${libraryList(tab)}</div>`);
}
view.addEventListener('input', e => {
  if (e.target.id !== 'lib-q') return;
  libQuery = e.target.value;
  paintLibrary();
});

function viewAlbum(key) {
  const a = albums().find(x => x.key === key);
  if (!a) return show(empty('disc', 'Álbum no encontrado', 'Puede que se haya eliminado de la biblioteca.'));
  const tracks = a.tracks.sort((x, y) => (x.trackNo || 999) - (y.trackNo || 999) || collator.compare(x.title, y.title));
  show(`<div class="hero">${cover({ album: a.title, coverId: a.coverId, coverUrl: a.coverUrl })}
      <div class="info"><div class="kind">Álbum</div><h1>${esc(a.title)}</h1>
      <p><a href="#/artista/${enc(a.artist)}">${esc(a.artist)}</a>${a.year ? ` · ${a.year}` : ''} · ${plural(tracks.length, 'canción', 'canciones')} · ${totalTime(tracks)}</p>${playButtons(tracks)}</div></div>
    ${rows(tracks, { numbered: true, hideAlbum: true })}`);
}
function viewArtist(name) {
  const tracks = allTracks().filter(t => artistsOf(t).includes(name) || albumArtistOf(t) === name).sort((a, b) => collator.compare(a.title, b.title));
  if (!tracks.length) return show(empty('user', 'Artista no encontrado', 'No hay canciones de este artista.'));
  const albs = albums(tracks).sort((a, b) => (b.year || 0) - (a.year || 0));
  show(`<div class="hero">${cover({ album: name, coverId: tracks.find(t => t.coverId)?.coverId, coverUrl: tracks.find(t => t.coverUrl)?.coverUrl }, 'round')}
      <div class="info"><div class="kind">Artista</div><h1>${esc(name)}</h1><p>${plural(tracks.length, 'canción', 'canciones')}</p>${playButtons(tracks)}</div></div>
    ${albs.length ? `<h2>Álbumes</h2><div class="strip">${albs.map(albumCard).join('')}</div>` : ''}
    <h2>Canciones</h2>${rows(tracks)}`);
}

// ----------------------------------------------------------------- playlists
const playlistTracks = p => p.trackIds.map(id => S.tracks.get(id)).filter(Boolean);
function viewPlaylists() {
  const favs = allTracks().filter(t => isFav(t.id));
  const pls = livePlaylists().sort((a, b) => collator.compare(a.name, b.name));
  show(`<div class="head"><h1>Playlists</h1><button class="btn primary" data-act="new-playlist">${icon('plus')}Nueva playlist</button></div>
    <div class="grid">
      <a class="card" href="#/favoritos"><span class="cover" style="--hue:340"><i>${icon('heart')}</i></span><span><b>Canciones que te gustan</b><small>${plural(favs.length, 'canción', 'canciones')}</small></span></a>
      ${pls.map(p => { const ts = playlistTracks(p); return `<a class="card" href="#/playlist/${enc(p.id)}">${cover({ album: p.name, coverId: ts.find(t => t.coverId)?.coverId, coverUrl: ts.find(t => t.coverUrl)?.coverUrl })}<span><b>${esc(p.name)}</b><small>${plural(ts.length, 'canción', 'canciones')}</small></span></a>`; }).join('')}
    </div>
    ${pls.length ? '' : '<p class="muted" style="margin-top:18px">Crea una playlist o usa el menú ⋯ de cualquier canción para añadirla a una.</p>'}`);
}
function viewPlaylist(id) {
  const p = livePlaylists().find(x => x.id === id);
  if (!p) return show(empty('list', 'Playlist no encontrada', 'Puede que se haya eliminado.'));
  const tracks = playlistTracks(p);
  show(`<div class="hero">${cover({ album: p.name, coverId: tracks.find(t => t.coverId)?.coverId, coverUrl: tracks.find(t => t.coverUrl)?.coverUrl })}
      <div class="info"><div class="kind">Playlist</div><h1>${esc(p.name)}</h1><p>${plural(tracks.length, 'canción', 'canciones')} · ${totalTime(tracks)}</p>
      <div class="actions">${tracks.length ? `<button class="btn primary" data-act="play-all">${icon('play')}Reproducir</button><button class="btn" data-act="shuffle-all">${icon('shuffle')}Aleatorio</button>${downloadAllBtn(tracks)}` : ''}
        <button class="icon-btn" data-act="rename-playlist" data-pid="${esc(p.id)}" aria-label="Cambiar nombre">${icon('edit')}</button>
        <button class="icon-btn" data-act="delete-playlist" data-pid="${esc(p.id)}" aria-label="Eliminar playlist">${icon('trash')}</button></div></div></div>
    ${tracks.length ? rows(tracks, { playlist: p.id }) : empty('list', 'Playlist vacía', 'Añade canciones desde el menú ⋯ de cualquier canción.')}`);
}
function viewFavs() {
  const tracks = allTracks().filter(t => isFav(t.id)).sort((a, b) => S.favs[b.id].at - S.favs[a.id].at);
  show(`<div class="hero"><span class="cover" style="--hue:340"><i>${icon('heart')}</i></span>
      <div class="info"><div class="kind">Playlist</div><h1>Canciones que te gustan</h1><p>${plural(tracks.length, 'canción', 'canciones')}</p>${playButtons(tracks)}</div></div>
    ${tracks.length ? rows(tracks) : empty('heart', 'Todavía no hay favoritas', 'Pulsa el corazón en cualquier canción para guardarla aquí.')}`);
}
async function newPlaylist(firstTracks = []) {
  const name = await ask({ title: 'Nueva playlist', placeholder: 'Nombre de la playlist', ok: 'Crear' });
  if (!name) return null;
  const p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, trackIds: firstTracks.map(t => t.id), deleted: false };
  await savePlaylist(p);
  toast(`Playlist «${name}» creada`);
  return p;
}
function addToPlaylist(tracks) {
  const pls = livePlaylists().sort((a, b) => collator.compare(a.name, b.name));
  menu(`<div class="sheet-head"><div><b>Añadir a playlist</b></div></div>`, [
    { icon: 'plus', label: 'Nueva playlist…', fn: async () => { if (await newPlaylist(tracks)) refresh(); } },
    ...pls.map(p => ({
      icon: 'list', label: p.name, fn: async () => {
        const fresh = tracks.filter(t => !p.trackIds.includes(t.id));
        p.trackIds.push(...fresh.map(t => t.id));
        await savePlaylist(p);
        toast(fresh.length ? `Añadida a «${p.name}»` : `Ya estaba en «${p.name}»`);
      },
    })),
  ]);
}

// ------------------------------------------------------------------ explorar
const explore = { src: 'archive', q: '', results: {}, more: {}, page: {}, loading: false, error: '', radioQ: '', stations: null };
const jamendoKey = () => JAMENDO_CLIENT_ID || S.settings.jamendoId || '';
const SUGGEST = ['jazz', 'música clásica', 'flamenco', 'blues', 'netlabel', 'ambient', 'folk', 'chiptune'];
async function viewExplore(tab = 'archivo') {
  const tabs = `<div class="head"><h1>Explorar</h1></div><div class="tabs"><a href="#/explorar/archivo" class="${tab === 'archivo' ? 'on' : ''}">Música libre</a><a href="#/explorar/radios" class="${tab === 'radios' ? 'on' : ''}">Radios</a></div>`;
  if (tab === 'radios') {
    show(`${tabs}<form class="search" data-form="radio"><label class="field">${icon('search')}<input name="q" type="search" placeholder="Buscar emisoras por nombre" value="${esc(explore.radioQ)}" autocomplete="off"></label><button class="btn primary">Buscar</button></form>
      ${S.stations.length ? `<h2>Tus emisoras</h2>${rows(S.stations)}` : ''}
      <h2>${explore.radioQ ? `Resultados de «${esc(explore.radioQ)}»` : 'Populares en España'}</h2><div id="radio-list"><p class="muted">Cargando emisoras…</p></div>`);
    if (!explore.stations) {
      try { explore.stations = await src.searchRadio(explore.radioQ); }
      catch { $('#radio-list') && ($('#radio-list').innerHTML = `<p class="muted">No se pudieron cargar las emisoras. ${navigator.onLine ? 'Inténtalo de nuevo más tarde.' : 'No hay conexión.'}</p>`); return; }
    }
    const box = $('#radio-list');
    if (box) setHTML(box, explore.stations.length ? rows(explore.stations) : '<p class="muted">No se encontraron emisoras.</p>');
    return;
  }
  const source = src.SOURCES.find(x => x.id === explore.src);
  const res = explore.results[source.id];
  const needsKey = source.needsKey && !jamendoKey();
  let body;
  if (needsKey) {
    body = `<div class="panel"><h2>Conectar Jamendo</h2><p>Jamendo pide una clave gratuita para buscar en su catálogo:</p>
      <ol class="steps"><li>Regístrate en <b>devportal.jamendo.com</b> y crea una aplicación.</li><li>Copia su <b>Client ID</b> y pégalo aquí.</li></ol>
      <form class="search" data-form="jamendo-key"><label class="field">${icon('lock')}<input name="key" placeholder="Client ID de Jamendo" autocomplete="off" required></label><button class="btn primary">Guardar</button></form></div>`;
  } else if (explore.loading && !res) body = '<p class="muted">Buscando…</p>';
  else if (explore.error) body = `<p class="muted">${esc(explore.error)}</p>`;
  else if (!res) body = '';
  else if (!res.length) body = '<p class="muted">Sin resultados. Prueba con otra búsqueda o con otro catálogo.</p>';
  else if (source.albums) {
    body = `<div class="grid">${res.map(r =>
      `<a class="card" href="#/archivo/${enc(r.id)}">${cover({ album: r.title, coverUrl: r.cover })}<span><b>${esc(r.title)}</b><small>${esc(r.creator || r.year || '')}</small></span></a>`).join('')}</div>`;
  } else {
    body = `${!explore.q && source.id === 'jamendo' ? '<h2>Populares esta semana</h2>' : ''}${rows(res.map(t => S.tracks.get(t.id) || t), { remote: true })}
      ${explore.more[source.id] ? `<div class="actions" style="justify-content:center;margin-top:16px"><button class="btn" data-act="more-results" ${explore.loading ? 'disabled' : ''}>${explore.loading ? 'Cargando…' : 'Más resultados'}</button></div>` : ''}`;
  }
  show(`${tabs}
    <div class="chips sources">${src.SOURCES.map(x => `<button class="chip ${x.id === source.id ? 'on' : ''}" data-act="source" data-src="${x.id}">${esc(x.name)}</button>`).join('')}</div>
    <p class="muted">${esc(source.about)} Puedes escucharla en línea o guardarla en tu biblioteca.</p>
    ${needsKey ? '' : `<form class="search" data-form="archive"><label class="field">${icon('search')}<input name="q" type="search" placeholder="Artista, género, canción…" value="${esc(explore.q)}" autocomplete="off"></label><button class="btn primary">Buscar</button></form>
    <div class="chips">${SUGGEST.map(q => `<button class="chip" data-act="suggest" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`}
    <div id="archive-list">${body}</div>`);
}
/** Busca en el catálogo elegido. Con `append`, añade la página siguiente a los resultados. */
async function searchMusic(q, append = false) {
  const id = explore.src;
  explore.q = q; explore.error = ''; explore.loading = true;
  if (!append) { explore.results[id] = null; explore.page[id] = 1; } else explore.page[id]++;
  const onExplore = () => location.hash.startsWith('#/explorar') && !location.hash.includes('radios');
  if (onExplore()) route();
  try {
    const r = await src.search(id, q, explore.page[id], jamendoKey());
    if (explore.src !== id || explore.q !== q) return;
    explore.results[id] = append ? [...(explore.results[id] || []), ...r.items] : r.items;
    explore.more[id] = r.more;
  } catch (e) {
    if (explore.src !== id) return;
    if (e.needsKey) { S.settings.jamendoId = ''; saveKV('settings', false); toast('La clave de Jamendo no es válida'); }
    else if (append) toast('No se pudieron cargar más resultados');
    else explore.error = !navigator.onLine ? 'No hay conexión a internet.'
      : e.limit ? 'Este catálogo limita las búsquedas por hora y se ha alcanzado el límite. Prueba más tarde o con otro catálogo.'
        : 'No se pudo consultar este catálogo. Inténtalo de nuevo o prueba con otro.';
  }
  explore.loading = false;
  if (onExplore()) route();
}
const archiveCache = new Map();
async function viewArchive(id) {
  let item = archiveCache.get(id);
  if (!item) {
    show('<p class="muted">Cargando…</p>');
    try { item = await src.archiveItem(id); archiveCache.set(id, item); }
    catch { return show(empty('compass', 'No se pudo cargar', 'Comprueba tu conexión e inténtalo de nuevo.', '<a class="btn" href="#/explorar">Volver</a>')); }
  }
  const tracks = item.tracks.map(t => S.tracks.get(t.id) || t);
  const saved = tracks.every(inLibrary);
  show(`<div class="hero">${cover({ album: item.title, coverUrl: item.cover })}
      <div class="info"><div class="kind">Internet Archive</div><h1>${esc(item.title)}</h1><p>${esc(item.creator)}${item.creator ? ' · ' : ''}${plural(tracks.length, 'pista', 'pistas')}</p>
      <div class="actions">${tracks.length ? `<button class="btn primary" data-act="play-all">${icon('play')}Reproducir</button>` : ''}
        ${tracks.length ? `<button class="btn" data-act="save-archive" data-aid="${esc(id)}" ${saved ? 'disabled' : ''}>${icon(saved ? 'offline' : 'plus')}${saved ? 'En tu biblioteca' : 'Añadir a mi biblioteca'}</button>` : ''}
        <a class="btn ghost" href="https://archive.org/details/${enc(id)}" target="_blank" rel="noopener">Ver ficha y licencia</a></div></div></div>
    ${tracks.length ? rows(tracks, { numbered: true, hideAlbum: true }) : empty('disc', 'Sin pistas reproducibles', 'Este elemento no tiene archivos MP3.')}`);
}
async function saveToLibrary(tracks) {
  for (const t of tracks) if (!inLibrary(t)) await saveTrack({ ...t, addedAt: Date.now() });
  emit('library');
}

// ------------------------------------------------------------------- ajustes
let installEvent = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; if (location.hash.startsWith('#/ajustes')) refresh(); });
async function viewSettings() {
  const est = await lib.storageEstimate();
  const tracks = allTracks();
  const offline = tracks.filter(t => t.hasBlob).length;
  const onlyLocal = tracks.filter(t => t.hasBlob && !t.cloudName && !t.url).length;
  const inCloud = tracks.filter(t => t.cloudName).length;
  const sum = recs.summary();
  const dev = !!S.settings.dev;
  const A = aiConf(), prov = ai.PROVIDERS[A.provider], savedKey = A.keys[A.provider], aiKey = savedKey ? (savedKey.hint || String(savedKey).slice(-4) || '····') : '', aiModel = A.models[A.provider] || '';
  const aiReady = aiIsReady();
  const presets = S.settings.genrePresets || [];
  const untagged = tracks.filter(needsTags).length;
  const pendingFiles = dev ? tracks.filter(fileOutdated) : [];
  const writable = pendingFiles.filter(cloud.canWriteFile);
  const dups = dev ? lib.findDuplicates(dupKeep) : [], extra = dups.reduce((n, g) => n + g.tracks.length - 1, 0);
  const gb = n => (n / 1073741824).toFixed(n > 1073741824 * 10 ? 0 : 2);
  const bks = cloud.buckets(), target = cloud.uploadTarget();
  const O = S.settings.oci;
  const ociPanel = !bks.length ? '' : `<h2 style="margin-top:22px">Borrar de verdad en Oracle</h2>
    ${O ? `<p>Clave de API de Oracle conectada (huella …${esc(O.fingerprint.slice(-5))}). Las canciones que borres de la nube se eliminan de Oracle.</p>
      <div class="actions"><button class="btn" data-act="oci-purge">${icon('trash')}Borrar los archivos que quedaron vacíos</button><button class="btn ghost danger" data-act="oci-forget">Quitar clave</button></div>`
    : `<p>Oracle no permite borrar archivos con la URL del bucket (PAR). Sin más, Fiora deja el archivo vacío: no ocupa espacio y desaparece de la app, pero su nombre sigue en el bucket. Para borrarlo del todo, añade una clave de API de tu usuario de Oracle. Se guarda solo en este dispositivo y tiene los mismos permisos que tu usuario: añádela solo en dispositivos tuyos.</p>
      <ol class="steps"><li>En la consola de Oracle Cloud: icono de tu perfil (arriba a la derecha) → <b>Mi perfil</b> → <b>Claves API</b> (<i>API keys</i>) → <b>Agregar clave API</b>.</li>
        <li>Elige <b>Generar par de claves API</b>, pulsa <b>Descargar clave privada</b> y después <b>Agregar</b>.</li>
        <li>Copia el texto de la <b>vista previa del archivo de configuración</b> y pégalo aquí. Luego elige el archivo .pem que has descargado.</li></ol>
      <form class="stack" data-form="oci">
        <label class="field area">${icon('lock')}<textarea name="config" rows="5" spellcheck="false" autocomplete="off" placeholder="[DEFAULT]&#10;user=ocid1.user.oc1..…&#10;fingerprint=…&#10;tenancy=ocid1.tenancy.oc1..…&#10;region=…" required></textarea></label>
        <label class="field">${icon('folder')}<input name="pem" type="file" accept=".pem,.key,text/plain" aria-label="Archivo de la clave privada (.pem)" required></label>
        <div class="actions"><button class="btn primary">Guardar y comprobar</button></div></form>`}`;
  const steps = `<ol class="steps"><li>En la consola de Oracle Cloud: <b>Storage → Buckets → Create Bucket</b> (privado).</li>
       <li>Dentro del bucket: <b>Pre-Authenticated Requests → Create</b>. Destino: <b>Bucket</b>; acceso: <b>Permit object reads and writes</b>; marca <b>Enable Object Listing</b>; pon una caducidad lejana.</li>
       <li>Copia la URL que aparece (solo se muestra una vez) y pégala aquí.</li></ol>`;
  const bucketForm = `<form class="stack" data-form="par">
       <label class="field">${icon('edit')}<input name="name" placeholder="Nombre (p. ej. Rock, Clásica, Bucket 2)" autocomplete="off" maxlength="40"></label>
       <label class="field">${icon('cloud')}<input name="url" type="url" placeholder="https://objectstorage.….oraclecloud.com/p/…/n/…/b/…/o/" autocomplete="off" required></label>
       <div class="actions"><button class="btn ${bks.length ? '' : 'primary'}">${icon('plus')}Conectar bucket</button></div></form>`;
  const cloudPanel = bks.length
    ? `<p>${plural(inCloud, 'canción', 'canciones')} en la nube${S.settings.lastSync ? ` · última sincronización: ${new Date(S.settings.lastSync).toLocaleString('es')}` : ''}.</p>
       <ul class="buckets">${bks.map(b => {
         const n = tracks.filter(t => t.cloudName && (t.bucketId || bks[0].id) === b.id).length;
         const isTarget = b.id === target.id;
         return `<li><span class="badge-ic">${icon('cloud')}</span><span class="row-text"><b>${esc(b.name)}</b><small>${plural(n, 'canción', 'canciones')}${isTarget && bks.length > 1 ? ' · las subidas van aquí' : ''}</small></span>
           ${!isTarget ? `<button class="chip" data-act="bucket-default" data-bid="${esc(b.id)}">Subir aquí</button>` : ''}
           <button class="icon-btn" data-act="bucket-remove" data-bid="${esc(b.id)}" aria-label="Desconectar ${esc(b.name)}">${icon('x')}</button></li>`;
       }).join('')}</ul>
       <div class="actions"><button class="btn primary" data-act="cloud-sync">${icon('sync')}Sincronizar ahora</button>
       ${onlyLocal ? `<button class="btn" data-act="cloud-upload-all">${icon('cloudUp')}Subir ${plural(onlyLocal, 'canción', 'canciones')}${bks.length > 1 ? ` a «${esc(target.name)}»` : ' a la nube'}</button>` : ''}</div>
       <div class="sub-panel"><b>Metadatos de los archivos</b>
         <small>Escribe dentro de cada archivo de la nube los géneros, lo que transmite y los cambios hechos en la app (también los de antes), para que estén en tus buckets. Primero revisa qué archivos lo necesitan; el sonido no cambia.</small>
         <div class="actions">${bulk ? `<button class="btn danger" data-act="cloud-tags-stop">${icon('x')}Detener</button>` : `<button class="btn" data-act="cloud-tags">${icon('sync')}Actualizar archivos de la nube</button>`}</div></div>
       <label class="switch"><input type="checkbox" data-toggle="shrink" ${S.settings.shrink ? 'checked' : ''}><span><b>Reducir el tamaño al subir, sin perder calidad</b>
         <small>Los archivos WAV se convierten a FLAC: suenan exactamente igual y ocupan en torno a la mitad. MP3, M4A, OGG y FLAC ya están comprimidos y se suben tal cual.</small></span></label>
       <details class="more"><summary>Conectar otro bucket</summary><p>Puedes tener varios buckets conectados a la vez; su música aparece junta en tu biblioteca.</p>${steps}${bucketForm}</details>`
    : `<p>Guarda tu música en Oracle Cloud Object Storage y escúchala desde cualquier dispositivo. Puedes conectar uno o varios buckets.</p>
       ${steps}${bucketForm}
       <p style="margin:12px 0 0">Esa URL funciona como una contraseña: quien la tenga puede leer y escribir en el bucket. ${account.user() ? 'Se guarda en este dispositivo y en tu cuenta.' : 'Fiora la guarda solo en este dispositivo.'}</p>`;
  const u = account.user();
  const accountPanel = u
    ? `<p>Has iniciado sesión como <b>${esc(u.email)}</b>. Tus playlists, favoritos, estadísticas, emisoras, ajustes y la conexión a la nube se guardan en tu cuenta${S.settings.accountSync ? ` · último guardado: ${new Date(S.settings.accountSync).toLocaleString('es')}` : ''}.</p>
       <div class="actions"><button class="btn primary" data-act="account-sync">${icon('sync')}Guardar y sincronizar</button><button class="btn ghost" data-act="sign-out">Cerrar sesión</button></div>`
    : account.available()
      ? `<p>Inicia sesión para guardar tus playlists, favoritos, estadísticas, emisoras, ajustes y la conexión a tu nube, y recuperarlos en cualquier dispositivo.</p>
         <form class="stack" data-form="login">
           <label class="field">${icon('user')}<input name="email" type="email" placeholder="Correo electrónico" autocomplete="username" required></label>
           <label class="field">${icon('lock')}<input name="password" type="password" placeholder="Contraseña" autocomplete="current-password" minlength="6" required></label>
           <div class="actions"><button class="btn primary" name="mode" value="in">Iniciar sesión</button><button class="btn" name="mode" value="up">Crear cuenta</button>
             <button type="button" class="btn ghost" data-act="forgot">He olvidado la contraseña</button></div></form>
         ${account.builtIn() ? '' : '<p style="margin:12px 0 0"><button class="chip" data-act="sb-reset">Cambiar de proyecto de Supabase</button></p>'}`
      : `<p>Para tener cuentas hace falta un proyecto gratuito de Supabase. Crea uno en supabase.com, ejecuta el SQL del README y pega aquí sus datos (<b>Project Settings → API</b>).</p>
         <form class="stack" data-form="sb-config">
           <label class="field">${icon('cloud')}<input name="url" type="url" placeholder="https://xxxxxxxx.supabase.co" autocomplete="off" required></label>
           <label class="field">${icon('lock')}<input name="key" placeholder="Clave pública (anon o publishable)" autocomplete="off" required></label>
           <div class="actions"><button class="btn primary">Guardar</button></div></form>`;
  show(`<div class="head"><h1>Ajustes</h1></div>
    <div class="panel"><h2>Cuenta</h2>${accountPanel}</div>
    <div class="panel"><h2>Nube</h2>${cloudPanel}</div>
    <div class="panel"><h2>Este dispositivo</h2>
      <p>${plural(tracks.length, 'canción', 'canciones')} en la biblioteca · ${offline} disponibles sin conexión.</p>
      ${est.quota ? `<div class="meter"><i style="width:${Math.min(100, (est.usage / est.quota) * 100).toFixed(1)}%"></i></div><small class="muted">${gb(est.usage)} GB usados de ${gb(est.quota)} GB disponibles para la app</small>` : ''}
      <label class="switch"><input type="checkbox" data-toggle="autoplay" ${S.settings.autoplay === false ? '' : 'checked'}><span><b>Reproducción automática</b>
        <small>Cuando se acaba lo que estás escuchando, sigue con canciones parecidas de tu biblioteca.</small></span></label>
      <div class="actions" style="margin-top:14px">${ADD_BTN}${installEvent ? `<button class="btn" data-act="install">${icon('download')}Instalar como app</button>` : ''}</div></div>
    <div class="panel"><h2>Modo desarrollador</h2>
      <label class="switch" style="margin-top:4px"><input type="checkbox" data-toggle="dev" ${dev ? 'checked' : ''}><span><b>Editar metadatos de las canciones</b>
        <small>Añade «Editar metadatos» al menú ⋯ de cada canción: portada, título, artistas, álbum, géneros y lo que transmite. Los cambios se guardan en tu cuenta y tu nube, y se ven en todos tus dispositivos.</small></span></label>
      ${dev ? `<h2 style="margin-top:22px">Canciones repetidas</h2>
        <p>${dups.length ? `${plural(dups.length, 'canción tiene', 'canciones tienen')} más de una copia (mismo título y mismos artistas): ${plural(extra, 'copia sobra', 'copias sobran')}.` : 'No hay canciones repetidas en tu biblioteca.'}
          En modo desarrollador, borrar una canción la elimina también de su bucket.</p>
        ${dups.length ? `<div class="actions"><a class="btn" href="#/repetidas">${icon('list')}Ver canciones repetidas</a></div>` : ''}
        ${ociPanel}
        <h2 style="margin-top:22px">Metadatos en los archivos</h2>
        <p>Al guardar en el editor, los cambios se escriben dentro del archivo (MP3, FLAC y M4A) y, si la canción está en la nube, se sube el archivo actualizado. El sonido no cambia.
          ${writable.length ? `Hay ${plural(writable.length, 'canción', 'canciones')} con cambios que aún no están en su archivo.` : 'Todos los cambios están ya en los archivos.'}
          ${pendingFiles.length > writable.length ? `${plural(pendingFiles.length - writable.length, 'canción', 'canciones')} solo ${pendingFiles.length - writable.length === 1 ? 'guarda' : 'guardan'} los cambios en la app (formato OGG, WAV u Opus, música libre o sin acceso al archivo).` : ''}</p>
        ${writable.length ? `<div class="actions"><button class="btn" data-act="write-files">${icon('sync')}Guardar en ${plural(writable.length, 'archivo', 'archivos')}</button></div>` : ''}
        <h2 style="margin-top:22px">Géneros predefinidos</h2>
        <p>El editor ofrece una lista de géneros habituales para elegir. Aquí puedes añadir los tuyos.</p>
        ${presets.length ? `<div class="chips">${presets.map(g => `<button class="chip" data-act="preset-remove" data-g="${esc(g)}" aria-label="Quitar ${esc(g)}">${esc(g)} ✕</button>`).join('')}</div>` : ''}
        <form class="search" data-form="preset-add"><label class="field">${icon('plus')}<input name="g" placeholder="Nuevo género (p. ej. Indie Español)" autocomplete="off" maxlength="40" required></label><button class="btn">Añadir</button></form>
        <h2 style="margin-top:22px">Etiquetado con IA</h2>
        <p>Un modelo de IA propone los géneros y lo que transmite cada canción a partir de su título, artistas y álbum. Elige el servicio y pega su clave de API: tiene coste por uso y se guarda cifrada, solo en este dispositivo.</p>
        <form class="stack" data-form="ai-key">
          <label class="field">${icon('compass')}<select name="provider" data-ai-provider aria-label="Servicio de IA">${Object.entries(ai.PROVIDERS).map(([id, x]) => `<option value="${id}" ${id === A.provider ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          ${prov.needsUrl ? `<label class="field">${icon('cloud')}<input name="url" type="url" value="${esc(A.url || '')}" placeholder="Dirección de la API (https://…/v1)" autocomplete="off" required></label>` : ''}
          <label class="field">${icon('lock')}<input name="key" type="password" autocomplete="off" placeholder="${aiKey ? `Clave guardada y cifrada (…${esc(aiKey)}). Escribe otra para cambiarla` : esc(prov.keyHint)}" ${aiKey || prov.needsUrl ? '' : 'required'}></label>
          ${A.provider === 'anthropic'
            ? `<label class="field">${icon('spark')}<select name="model" aria-label="Modelo">${ai.AI_MODELS.map(([id, label]) => `<option value="${id}" ${id === (aiModel || ai.DEFAULT_MODEL) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`
            : `<label class="field">${icon('spark')}<input name="model" list="ai-models" value="${esc(aiModel)}" placeholder="Nombre del modelo (pulsa «Ver modelos disponibles»)" autocomplete="off" required></label>
               <datalist id="ai-models">${(A.lists?.[A.provider] || []).map(m => `<option value="${esc(m)}">`).join('')}</datalist>`}
          <div class="actions"><button class="btn primary">Guardar</button>
            ${A.provider !== 'anthropic' ? '<button type="button" class="btn" data-act="ai-models">Ver modelos disponibles</button>' : ''}
            ${aiKey ? '<button type="button" class="btn ghost danger" data-act="ai-forget">Quitar clave</button>' : ''}</div>
          ${prov.site ? `<small class="muted">La clave se crea en ${prov.site}.</small>` : '<small class="muted">Vale cualquier servicio con API compatible con la de OpenAI (OpenRouter, Groq, Mistral, un modelo local…), siempre que admita llamadas desde el navegador.</small>'}</form>
        ${aiReady ? `<div class="actions" style="margin-top:14px"><button class="btn" data-act="ai-tag-all" ${untagged ? '' : 'disabled'}>${icon('spark')}${untagged ? `Etiquetar ${plural(untagged, 'canción', 'canciones')} sin etiquetar` : 'Todas las canciones están etiquetadas'}</button></div>` : ''}` : ''}</div>
    <div class="panel"><h2>Tus escuchas</h2>
      <div class="stat-row"><div class="stat"><b>${sum.plays}</b><small>reproducciones</small></div><div class="stat"><b>${sum.hours.toFixed(1)} h</b><small>escuchadas</small></div><div class="stat wide"><b title="${esc(sum.topArtists[0]?.[0] || '')}">${esc(sum.topArtists[0]?.[0] || '—')}</b><small>artista más escuchado</small></div></div>
      <div class="actions" style="margin-top:14px"><a class="btn primary" href="#/estadisticas">${icon('chart')}Ver todas tus estadísticas</a></div>
      <p style="margin:14px 0 0">Las recomendaciones aprenden de lo que terminas, a qué hora escuchas cada cosa y qué canciones pones seguidas.</p></div>
    <p class="muted" style="text-align:center">Fiora · Letras de LRCLIB · Música libre de Internet Archive, Openverse, Wikimedia Commons y Jamendo · Radios de Radio Browser</p>`);
}
async function cloudSync(silent = false) {
  if (!cloud.configured() || !navigator.onLine) return;
  const t = silent ? null : toast('Sincronizando con la nube…', 0);
  try {
    const r = await cloud.syncAll((i, n, name) => t?.set(`Leyendo ${i} de ${n}: ${name.split('/').pop()}`));
    const msg = r.added || r.removed || r.updated ? `Nube sincronizada: ${r.added} nuevas${r.updated ? `, ${r.updated} actualizadas` : ''}${r.removed ? `, ${r.removed} quitadas` : ''}` : 'Todo sincronizado';
    if (r.errors.length) { if (t) t.done(`No se pudo leer un bucket: ${r.errors[0]}`, 7000); }
    else if (t) t.done(msg); else if (r.added) toast(msg);
  } catch (e) {
    console.warn(e);
    if (t) t.done(`No se pudo sincronizar: ${e.message}`, 6000);
  }
  refresh();
}
const mb = n => `${(n / 1048576).toLocaleString('es', { maximumFractionDigits: 1 })} MB`;
async function uploadMany(tracks, bucketId) {
  const t = toast('Subiendo…', 0);
  let ok = 0, saved = 0;
  for (let i = 0; i < tracks.length; i++) {
    const label = stage => t.set(`${stage} ${i + 1} de ${tracks.length}: ${tracks[i].title}`);
    try { saved += await cloud.upload(tracks[i], bucketId, label); ok++; }
    catch (e) { t.done(`Error al subir «${tracks[i].title}»: ${e.message}`, 6000); refresh(); return; }
  }
  t.done(`${plural(ok, 'canción subida', 'canciones subidas')} a la nube${saved ? ` · ${mb(saved)} ahorrados al comprimir sin pérdida` : ''}`, saved ? 6000 : 3400);
  refresh();
}
/** Si hay varios buckets, pregunta a cuál subir. */
function uploadTo(tracks) {
  const bks = cloud.buckets();
  if (bks.length < 2) return uploadMany(tracks);
  menu(`<div class="sheet-head"><div><b>¿A qué bucket?</b><small>${plural(tracks.length, 'canción', 'canciones')}</small></div></div>`,
    bks.map(b => ({ icon: 'cloudUp', label: b.name, fn: () => uploadMany(tracks, b.id) })));
}
/** Guarda el archivo de la canción en el almacenamiento del dispositivo (Descargas / Archivos). */
async function exportFile(t) {
  const note = toast(t.hasBlob ? 'Preparando el archivo…' : 'Descargando el archivo…', 0);
  let blob;
  try { blob = await cloud.taggedBlob(t, await cloud.fetchBlob(t)); }
  catch (e) { return note.done(`No se pudo obtener el archivo: ${e.message}`, 6000); }
  const ext = (t.fileName || '').match(/\.[a-z0-9]{2,5}$/i)?.[0] || '.mp3';
  const name = `${[t.artist, t.title].filter(Boolean).join(' - ')}${ext}`.replace(/[\\/:*?"<>|]/g, '_');
  const file = new File([blob], name, { type: blob.type || 'audio/mpeg' });
  // En iPhone/iPad instalada como app no hay descargas directas: se usa el menú Compartir → "Guardar en Archivos".
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare?.({ files: [file] })) {
    const share = () => navigator.share({ files: [file] }).then(() => true, e => e?.name === 'AbortError');
    if (await share()) return note.done();
    // el permiso del toque caducó mientras se descargaba: se pide un toque más
    note.done();
    return menu(`<div class="sheet-head"><div><b>Archivo listo</b><small>${esc(name)}</small></div></div>`, [{ icon: 'folder', label: 'Guardar en Archivos…', fn: share }]);
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  note.done(`«${name}» guardado en las descargas del dispositivo`, 5000);
}
async function downloadMany(tracks) {
  const t = toast('Descargando…', 0);
  let ok = 0, fail = 0;
  for (let i = 0; i < tracks.length; i++) {
    t.set(`Descargando ${i + 1} de ${tracks.length}: ${tracks[i].title}`);
    try { await cloud.download(tracks[i]); ok++; } catch (e) { console.warn(e); fail++; }
  }
  t.done(fail ? `${ok} descargadas, ${fail} con error` : `${plural(ok, 'canción disponible', 'canciones disponibles')} sin conexión`);
  refresh();
}

// ------------------------------------------------------------ estadísticas
const num = n => n.toLocaleString('es');
/** Gráfico de columnas de una sola serie. items: [{label, value, tip}]; ticks: etiquetas del eje. */
function columns(items, { unit, ticks, caption }) {
  const max = Math.max(1, ...items.map(x => x.value));
  return `<figure class="chart"><div class="chart-top"><span>máx. ${num(max)} ${unit}</span></div>
    <div class="cols" role="img" aria-label="${esc(caption)}">${items.map(x =>
      `<div class="col" tabindex="0" data-tip="${esc(x.tip)}"><i style="height:${((x.value / max) * 100).toFixed(1)}%"></i></div>`).join('')}</div>
    <div class="cols-x">${ticks.map(l => `<span>${esc(l)}</span>`).join('')}</div>
    <details class="glist"><summary>Ver los datos</summary><table class="data">${items.map(x => `<tr><td>${esc(x.label)}</td><td>${num(x.value)} ${unit}</td></tr>`).join('')}</table></details></figure>`;
}
/** Barras horizontales con el valor al final: sirven a la vez de gráfico y de tabla. */
function bars(list, unit = '') {
  const max = Math.max(1, ...list.map(x => x[1]));
  return `<ol class="hbars">${list.map(([label, value, sub]) =>
    `<li><span class="hb-label" title="${esc(label)}"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="hb-track"><i style="width:${((value / max) * 100).toFixed(1)}%"></i></span><span class="hb-val">${num(value)}${unit}</span></li>`).join('')}</ol>`;
}
function viewStats() {
  const d = recs.dashboard();
  if (!d.plays) {
    return show(`<div class="head"><a class="icon-btn" href="#/ajustes" aria-label="Volver">${icon('back')}</a><h1>Tus estadísticas</h1></div>
      ${empty('chart', 'Aún no hay escuchas', 'Pon música un rato y aquí verás cuánto escuchas, cuándo y qué.')}`);
  }
  const fmtDay = x => x.date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  const tile = (value, label, sub = '') => `<div class="stat"><b title="${esc(String(value))}">${esc(String(value))}</b><small>${label}</small>${sub ? `<small class="stat-sub">${sub}</small>` : ''}</div>`;
  const WEEK = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const PARTS = ['Madrugada', 'Mañana', 'Tarde', 'Noche'];
  const peakHour = d.hoursOfDay.indexOf(Math.max(...d.hoursOfDay));
  const since = '<p class="chart-note">Este gráfico se empieza a llenar desde hoy: las escuchas anteriores no guardaban la fecha.</p>';
  show(`<div class="head"><a class="icon-btn" href="#/ajustes" aria-label="Volver">${icon('back')}</a><h1>Tus estadísticas</h1></div>
    <div class="stat-row tiles">
      ${tile(num(d.plays), 'reproducciones')}
      ${tile(`${d.hours.toLocaleString('es', { maximumFractionDigits: 1 })} h`, 'de música')}
      ${tile(num(d.heard), 'canciones distintas', `de ${num(d.total)} en tu biblioteca`)}
      ${tile(num(d.artists), 'artistas distintos')}
      ${tile(`${d.completion} %`, 'escuchadas hasta el final')}
      ${tile(d.streak ? plural(d.streak, 'día', 'días') : '—', 'racha actual', d.streak ? 'seguidos con música' : '')}
    </div>

    <section class="panel"><h2>Últimos 30 días</h2><p>Minutos de música por día.</p>
      ${columns(d.days.map(x => ({ label: fmtDay(x), value: x.min, tip: `${fmtDay(x)} · ${x.min} min · ${plural(x.plays, 'canción', 'canciones')}` })), { unit: 'min', ticks: [fmtDay(d.days[0]), fmtDay(d.days[14]), 'hoy'], caption: 'Minutos escuchados cada día durante los últimos 30 días' })}
      ${d.hasDays ? '' : since}</section>

    <div class="two-panels">
      <section class="panel"><h2>A qué hora escuchas</h2>
        ${d.hasHours ? `<p>Tu hora punta: las ${peakHour}:00.</p>${columns(d.hoursOfDay.map((v, h) => ({ label: `${h}:00`, value: v, tip: `${h}:00–${h + 1}:00 · ${plural(v, 'escucha', 'escuchas')}` })), { unit: 'escuchas', ticks: ['0 h', '6 h', '12 h', '18 h', '23 h'], caption: 'Escuchas por hora del día' })}`
          : `<p>Escuchas por franja del día.</p>${bars(PARTS.map((n, i) => [n, d.parts[i]]))}`}</section>
      <section class="panel"><h2>Qué días</h2><p>Escuchas por día de la semana.</p>
        ${d.week.some(Boolean) ? bars(WEEK.map((n, i) => [n, d.week[i]])) : since}</section>
    </div>

    <section class="panel"><h2>Tus artistas</h2><p>Por número de escuchas.</p>${bars(d.topArtists)}</section>
    <section class="panel"><h2>Tus canciones</h2><p>Por número de escuchas.</p>${bars(d.topTracks.map(([t, n]) => [t.title, n, t.artist]))}</section>
    ${d.topAlbums.length ? `<section class="panel"><h2>Tus álbumes</h2><p>Por número de escuchas.</p>${bars(d.topAlbums.map(([k, n]) => { const [al, ar] = k.split(' — '); return [al, n, ar]; }))}</section>` : ''}
    <div class="two-panels">
      ${d.topGenres.length ? `<section class="panel"><h2>Géneros</h2><p>Escuchas de canciones de cada género.</p>${bars(d.topGenres)}</section>` : ''}
      ${d.topMoods.length ? `<section class="panel"><h2>Lo que transmite</h2><p>Escuchas por ambiente.</p>${bars(d.topMoods.map(([m, n]) => [m[0].toUpperCase() + m.slice(1), n]))}</section>` : ''}
    </div>
    <p class="muted" style="text-align:center">Todo se calcula en tu dispositivo a partir de tus escuchas.</p>`);
}
// Etiqueta flotante de los gráficos: aparece al pasar el ratón, tocar o enfocar una columna.
const tip = Object.assign(document.createElement('div'), { id: 'tip', hidden: true });
document.body.append(tip);
function showTip(el) {
  if (!el) { tip.hidden = true; return; }
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const r = el.getBoundingClientRect(), w = tip.offsetWidth;
  tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
}
view.addEventListener('pointerover', e => showTip(e.target.closest('.col')));
view.addEventListener('pointerdown', e => showTip(e.target.closest('.col')));
view.addEventListener('focusin', e => showTip(e.target.closest('.col')));
view.addEventListener('pointerleave', () => showTip(null));
view.addEventListener('scroll', () => showTip(null), { passive: true });

// ------------------------------------------------- modo desarrollador
const needsTags = t => !t.aiTagged && !(t.moods || []).length;
const quoteList = list => (list || []).map(a => (String(a).includes(',') ? `"${a}"` : a)).join(', ');
/** Configuración de IA de este dispositivo: un proveedor activo y una clave y un modelo por proveedor. */
function aiConf() {
  const s = S.settings;
  if (!s.ai) {
    s.ai = { provider: 'anthropic', keys: {}, models: {}, lists: {}, url: '' };
    if (s.aiKey) { s.ai.keys.anthropic = s.aiKey; s.ai.models.anthropic = s.aiModel || ai.DEFAULT_MODEL; }   // versión anterior
    delete s.aiKey; delete s.aiModel;
  }
  return s.ai;
}
/** Opciones para llamar a la IA. La clave se descifra justo antes de usarla y no se guarda descifrada. */
const aiOptions = async (key = null) => {
  const A = aiConf();
  return { provider: A.provider, key: key ?? await vault.unseal(A.keys[A.provider], A.provider), model: A.models[A.provider] || (A.provider === 'anthropic' ? ai.DEFAULT_MODEL : ''), url: A.url, knownGenres: genreOptions() };
};
/** ¿Está todo listo para usar la IA? (sin descifrar la clave) */
const aiIsReady = () => { const A = aiConf(); return !ai.missing({ provider: A.provider, key: A.keys[A.provider] ? 'x' : '', model: A.models[A.provider] || (A.provider === 'anthropic' ? ai.DEFAULT_MODEL : ''), url: A.url }); };
/** Cifra las claves que quedasen sin cifrar de versiones anteriores. */
async function sealAiKeys() {
  const A = aiConf();
  let changed = false;
  for (const [p, k] of Object.entries(A.keys)) {
    if (typeof k !== 'string') continue;
    if (k) A.keys[p] = await vault.seal(k, p); else delete A.keys[p];
    changed = true;
  }
  if (changed) await saveKV('settings', false);
}

function editTrack(t) {
  let coverFile = null;
  const moods = new Set(t.moods || []);
  const field = (name, label, value, extra = '') => `<label class="lbl">${label}<span class="field"><input name="${name}" value="${esc(value ?? '')}" autocomplete="off" ${extra}></span></label>`;
  let genres = [...(t.genres || [])];
  const hasGenre = g => genres.some(x => x.toLowerCase() === g.toLowerCase());
  const addGenre = g => { g = String(g || '').trim(); if (g && !hasGenre(g)) genres.push(genreOptions().find(x => x.toLowerCase() === g.toLowerCase()) || g); };
  const paintGenres = () => {
    const form = $('form', sheet);
    $('.gsel', form).innerHTML = genres.map(g => `<button type="button" class="chip on" data-gdel="${esc(g)}" aria-label="Quitar ${esc(g)}">${esc(g)} ✕</button>`).join('') || '<small class="muted">Sin géneros</small>';
    $('.gall', form).innerHTML = genreOptions().map(g => `<button type="button" class="chip ${hasGenre(g) ? 'on' : ''}" data-gtoggle="${esc(g)}">${esc(g)}</button>`).join('');
  };
  const moodChips = () => MOODS.map(m => `<button type="button" class="chip ${moods.has(m) ? 'on' : ''}" data-mood="${m}">${m}</button>`).join('');
  openSheet(`<form class="dlg editor" method="dialog"><h3>Editar metadatos</h3>
    <div class="ed-cover">${cover(t)}<label class="btn">${icon('edit')}Cambiar portada<input type="file" name="cover" accept="image/*" hidden></label></div>
    ${field('title', 'Título', t.title, 'required')}
    ${field('artists', 'Artistas <small>separados por comas; entre comillas si el nombre lleva coma</small>', quoteList(artistsOf(t)), 'required')}
    ${field('album', 'Álbum', t.album)}
    ${field('albumArtist', 'Artista del álbum <small>opcional</small>', t.albumArtist)}
    <div class="two">${field('year', 'Año', t.year || '', 'inputmode="numeric" pattern="[0-9]{0,4}"')}${field('trackNo', 'Nº de pista', t.trackNo || '', 'inputmode="numeric" pattern="[0-9]{0,3}"')}</div>
    <div class="lbl">Géneros
      <div class="chips gsel"></div>
      <span class="field"><input name="genreAdd" list="genre-list" placeholder="Escribe o elige un género" autocomplete="off" maxlength="40"><button type="button" class="chip" data-gadd>Añadir</button></span>
      <datalist id="genre-list">${genreOptions().map(g => `<option value="${esc(g)}">`).join('')}</datalist>
      <details class="glist"><summary>Elegir de la lista</summary><div class="chips gall"></div></details></div>
    <div class="lbl">Lo que transmite<div class="chips moods">${moodChips()}</div></div>
    <p class="file-state" data-filestate>${cloud.canWriteFile(t) ? 'Leyendo lo que hay guardado en el archivo…' : t.url && !t.cloudName ? 'Música libre: los cambios se guardan en la app (el archivo no es tuyo).' : 'Este formato no guarda estos datos dentro del archivo: los cambios se guardan en la app.'}</p>
    ${t.album ? `<label class="switch ed-album" hidden><input type="checkbox" name="wholeAlbum" checked><span><b>Usar la portada en todo el álbum</b></span></label>` : ''}
    <div class="actions">${aiIsReady() ? `<button type="button" class="btn" data-ai>${icon('spark')}Etiquetar con IA</button>` : ''}
      <span style="flex:1"></span><button type="button" class="btn ghost" data-x>Cancelar</button><button class="btn primary">Guardar</button></div></form>`,
  async e => {
    const form = $('form', sheet);
    const mood = e.target.closest('[data-mood]');
    if (mood) { moods.has(mood.dataset.mood) ? moods.delete(mood.dataset.mood) : moods.add(mood.dataset.mood); mood.classList.toggle('on'); return; }
    if (e.target.closest('[data-x]')) return sheet.close();
    const gdel = e.target.closest('[data-gdel]'), gtog = e.target.closest('[data-gtoggle]');
    if (gdel) { genres = genres.filter(g => g !== gdel.dataset.gdel); return paintGenres(); }
    if (gtog) { hasGenre(gtog.dataset.gtoggle) ? genres = genres.filter(g => g.toLowerCase() !== gtog.dataset.gtoggle.toLowerCase()) : addGenre(gtog.dataset.gtoggle); return paintGenres(); }
    if (e.target.closest('[data-gadd]')) { addGenre(form.genreAdd.value); form.genreAdd.value = ''; return paintGenres(); }
    const aiBtn = e.target.closest('[data-ai]');
    if (aiBtn) {
      aiBtn.disabled = true;
      const note = toast('Consultando a la IA…', 0);
      try {
        const draft = { ...t, title: form.elements.title.value.trim(), artists: splitArtists(form.artists.value), album: form.album.value.trim(), year: +form.year.value || 0, genres };
        const [r] = await ai.tagTracks([draft], await aiOptions());
        if (r && (r.genres.length || r.moods.length)) {
          if (r.genres.length) { genres = []; r.genres.forEach(addGenre); paintGenres(); }
          moods.clear(); r.moods.forEach(m => moods.add(m));
          $('.moods', form).innerHTML = moodChips();
          note.done('Etiquetas propuestas. Revísalas y pulsa Guardar');
        } else note.done('La IA no reconoce esta canción lo suficiente para etiquetarla', 5000);
      } catch (err) { note.done(err.message, 6000); }
      aiBtn.disabled = false;
    }
  });
  const form = $('form', sheet);
  paintGenres();
  form.genreAdd.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addGenre(form.genreAdd.value); form.genreAdd.value = ''; paintGenres(); } });
  form.genreAdd.addEventListener('change', () => { if (genreOptions().some(g => g.toLowerCase() === form.genreAdd.value.trim().toLowerCase())) { addGenre(form.genreAdd.value); form.genreAdd.value = ''; paintGenres(); } });
  form.cover.onchange = () => {
    coverFile = form.cover.files[0] || null;
    if (!coverFile) return;
    const c = $('.ed-cover .cover', form);
    c.style.backgroundImage = `url("${URL.createObjectURL(coverFile)}")`; c.classList.add('has');
    const sw = $('.ed-album', form); if (sw) sw.hidden = false;
  };
  showFileState(t);
  form.onsubmit = async () => {
    const artists = splitArtists(form.artists.value);
    const fields = {
      title: form.elements.title.value.trim() || t.title, artists: artists.length ? artists : artistsOf(t),
      album: form.album.value.trim(), albumArtist: form.albumArtist.value.trim(),
      year: +form.year.value || 0, trackNo: +form.trackNo.value || 0,
      genres: (addGenre(form.genreAdd.value), genres), moods: MOODS.filter(m => moods.has(m)),
    };
    const siblings = coverFile && t.album && form.wholeAlbum?.checked ? allTracks().filter(o => o.id !== t.id && o.album && lib.albumKey(o) === lib.albumKey(t)) : [];
    let uploaded = true;
    if (coverFile) {
      const small = await shrinkCover(coverFile, 600);
      if (!small) toast('Esa imagen no se pudo leer; la portada no ha cambiado', 5000);
      else {
        const cid = 'u' + hash(t.id + Date.now());
        await db.put('covers', cid, small);
        Object.assign(fields, { coverId: cid, coverUrl: '' });
        for (const o of siblings) await setEdit(o, { coverId: cid, coverUrl: '' });
        if (cloud.configured()) uploaded = await cloud.uploadCover(cid, small).catch(() => false);
      }
    }
    await setEdit(t, fields);
    emit('library');
    if (P.current?.id === t.id) { renderMini(); renderNow(); }
    if (!uploaded) toast('La portada no se pudo subir a la nube', 5000);
    // Los cambios se escriben también dentro del archivo (y se sube a la nube si está allí).
    const files = [t, ...siblings].filter(x => fileOutdated(x) && cloud.canWriteFile(x));
    if (files.length) return writeFiles(files);
    toast(coverFile && !cloud.configured() ? 'Guardado. La portada solo se verá en este dispositivo hasta que conectes una nube'
      : !cloud.canWriteFile(t) && !t.url ? 'Metadatos guardados en la app (este formato no permite escribirlos en el archivo)' : 'Metadatos guardados');
  };
}

/** Muestra en el editor lo que hay escrito ahora mismo en el archivo de la canción. */
async function showFileState(t) {
  const el = $('[data-filestate]', sheet);
  if (!el || !cloud.canWriteFile(t)) return;
  try {
    const got = await cloud.fileTags(t);
    if (!got || !sheet.open || !el.isConnected) return;
    const where = t.hasBlob ? 'En el archivo' : 'En el archivo de la nube';
    const g = got.genre ? `«${got.genre}»` : 'nada', m = got.mood ? `«${got.mood}»` : 'nada';
    el.textContent = `${where}: géneros ${g} · lo que transmite ${m}.${fileOutdated(t) ? ' Hay cambios sin guardar en el archivo: se guardarán al pulsar Guardar.' : ''}`;
  } catch (e) { if (el.isConnected) el.textContent = `No se pudo leer el archivo (${e.message}).`; }
}

/** Etiqueta con IA un grupo de canciones, por lotes, guardando cada lote según llega. */
async function tagMany(tracks) {
  const note = toast('Preparando…', 0);
  let tagged = 0, opts;
  try { opts = await aiOptions(); } catch (e) { return note.done(e.message, 8000); }
  for (let i = 0; i < tracks.length; i += ai.BATCH) {
    const chunk = tracks.slice(i, i + ai.BATCH);
    note.set(`Etiquetando con IA: ${i + 1}–${i + chunk.length} de ${tracks.length}…`);
    let res;
    try { res = await ai.tagTracks(chunk, opts); }
    catch (e) { emit('library'); return note.done(`${tagged ? `${tagged} etiquetadas. ` : ''}Se detuvo: ${e.message}`, 8000); }
    for (let k = 0; k < chunk.length; k++) {
      const r = res[k], t = chunk[k];
      const got = r && (r.genres.length || r.moods.length);
      // aiTagged evita volver a enviar (y pagar) las canciones que la IA no reconoce
      await setEdit(t, got ? { genres: r.genres.length ? r.genres : t.genres || [], moods: r.moods, aiTagged: true } : { aiTagged: true });
      if (got) tagged++;
    }
  }
  emit('library');
  note.done(`${plural(tagged, 'canción etiquetada', 'canciones etiquetadas')}${tagged < tracks.length ? ` · ${tracks.length - tagged} sin reconocer` : ''}`, 6000);
  const files = tracks.map(x => S.tracks.get(x.id) || x).filter(x => fileOutdated(x) && cloud.canWriteFile(x));
  if (files.length) offerWrite(files);
}

// ----------------------------- actualizar los metadatos de todos los archivos de la nube
let bulk = null;   // { stop } mientras se revisa o se actualiza
async function updateCloudFiles() {
  if (bulk) return;
  const inCloud = allTracks().filter(t => t.cloudName);
  const list = inCloud.filter(t => cloud.canWriteFile(t));
  const other = inCloud.length - list.length;
  if (!list.length) return toast(inCloud.length ? 'Ninguna canción de la nube está en MP3, FLAC o M4A' : 'No hay canciones en la nube');
  bulk = { stop: false }; refresh();
  const note = toast('Revisando los archivos de la nube…', 0);
  const todo = [], errors = [];
  for (let i = 0; i < list.length && !bulk.stop; i++) {
    const t = list[i];
    note.set(`Revisando ${i + 1} de ${list.length}: ${t.title}${todo.length ? ` · ${todo.length} por actualizar` : ''}`);
    try { if (await cloud.cloudFileGap(t)) todo.push(t); }
    catch (e) { console.warn(e); errors.push(`«${t.title}»: ${e.message}`); }
  }
  if (bulk.stop) { bulk = null; note.done('Revisión detenida'); return refresh(); }
  const extra = `${other ? ` ${plural(other, 'canción está', 'canciones están')} en un formato que no guarda etiquetas (OGG, Opus, WAV…).` : ''}${errors.length ? ` No se pudo leer ${errors[0]}${errors.length > 1 ? ` y ${errors.length - 1} más` : ''}.` : ''}`;
  if (!todo.length) { bulk = null; note.done(`Los ${plural(list.length, 'archivo', 'archivos')} de la nube ya tienen todos los datos.${extra}`, 8000); return refresh(); }
  note.done('', 0);
  const remote = todo.filter(t => !t.hasBlob), bytes = remote.reduce((n, t) => n + (t.size || 0), 0) * 2 + todo.filter(t => t.hasBlob).reduce((n, t) => n + (t.size || 0), 0);
  const ok = await confirmDlg(`¿Actualizar ${plural(todo.length, 'archivo', 'archivos')} de la nube?`,
    `${plural(todo.length, 'archivo no tiene', 'archivos no tienen')} todavía los géneros, lo que transmite u otros datos de la app (de ${list.length} revisados). Se escribirán dentro de cada archivo y se subirán a tu nube, comprobando cada uno. Se moverán unos ${mb(bytes)}. El sonido no cambia y puedes detenerlo cuando quieras.${extra}`, 'Actualizar');
  if (!ok) { bulk = null; return refresh(); }
  await writeFiles(todo, { fields: t => cloud.desiredTags(t), stop: () => bulk?.stop });
  bulk = null; refresh();
}

/** Pregunta antes de escribir en muchos archivos (los que solo están en la nube hay que bajarlos y volver a subirlos). */
async function offerWrite(files) {
  const remote = files.filter(x => !x.hasBlob), bytes = remote.reduce((n, x) => n + (x.size || 0), 0);
  const ok = await confirmDlg(`¿Guardar los cambios en ${plural(files.length, 'archivo', 'archivos')}?`,
    `Los géneros y demás datos se escribirán dentro de cada archivo${files.some(x => x.cloudName) ? ' y se subirán a tu nube' : ''}.${remote.length ? ` ${plural(remote.length, 'canción', 'canciones')} solo ${remote.length === 1 ? 'está' : 'están'} en la nube: se ${remote.length === 1 ? 'descargará' : 'descargarán'} y volverán a subir (${mb(bytes * 2)} en total).` : ''} El sonido no cambia.`, 'Guardar');
  if (ok) writeFiles(files);
}

/** Escribe los metadatos editados en los archivos, uno a uno. */
async function writeFiles(list, { fields = null, stop = () => false } = {}) {
  const note = toast('Guardando en el archivo…', 0);
  let done = 0, toCloud = 0, got = null, stopped = false;
  const fails = [];
  for (let i = 0; i < list.length; i++) {
    if (stop()) { stopped = true; break; }
    const t = list[i];
    const label = stage => note.set(list.length > 1 ? `${stage} ${i + 1} de ${list.length}: ${t.title}` : `${stage}: ${t.title}`);
    try { if ((got = await cloud.writeFile(t, label, fields ? fields(t) : null))) { done++; if (t.cloudName) toCloud++; } }
    catch (e) { console.warn(e); fails.push(`«${t.title}»: ${e.message}`); }
  }
  const msg = list.length === 1 && done ? `Guardado y comprobado en el archivo${toCloud ? ' de la nube' : ''}: géneros «${got.genre || '—'}» · lo que transmite «${got.mood || '—'}»`
    : `${plural(done, 'archivo actualizado y comprobado', 'archivos actualizados y comprobados')}${toCloud ? ` (${toCloud} en la nube)` : ''}`;
  if (stopped) return note.done(`Detenido: ${msg}. Lo que falta se actualizará la próxima vez.`, 8000), refresh();
  note.done(fails.length ? `${done ? `${msg}. ` : ''}No se pudo guardar ${fails[0]}${fails.length > 1 ? ` y ${fails.length - 1} más` : ''}` : msg, fails.length ? 10000 : 7000);
  refresh();
}

// ------------------------------------------------- canciones repetidas (desarrollador)
const dupKeep = {};   // copia elegida a mano en cada grupo: clave -> id
function viewDuplicates() {
  if (!S.settings.dev) return show(empty('settings', 'Solo en modo desarrollador', 'Activa el modo desarrollador en Ajustes para revisar las canciones repetidas.', `<a class="btn primary" href="#/ajustes">Ir a Ajustes</a>`));
  const groups = lib.findDuplicates(dupKeep);
  const extra = groups.flatMap(g => g.tracks.slice(1));
  const ignored = (S.settings.dupIgnore || []).length;
  const back = ignored ? `<p class="muted" style="margin-top:18px">${plural(ignored, 'grupo marcado', 'grupos marcados')} como «no son repetidas». <button class="chip" data-act="dup-unignore">Volver a revisarlos</button></p>` : '';
  if (!groups.length) return show(`<div class="head"><h1>Canciones repetidas</h1></div>${empty('heart', 'No hay canciones repetidas', 'Ninguna canción de tu biblioteca tiene el mismo título y los mismos artistas que otra.', `<a class="btn" href="#/ajustes">Volver a Ajustes</a>`)}${back}`);
  const inCloud = extra.filter(t => t.cloudName).length;
  show(`<div class="head"><h1>Canciones repetidas</h1></div>
    <div class="panel"><p style="margin-top:0">${plural(groups.length, 'canción tiene', 'canciones tienen')} más de una copia. De cada una se conserva la copia con portada; si todas la tienen (o ninguna), la más reciente. Toca «Conservar» para elegir otra.</p>
      <p>Las playlists, los «me gusta» y las escuchas de las copias borradas pasan a la que se conserva.${inCloud ? ` ${plural(inCloud, 'copia está', 'copias están')} en la nube y se ${inCloud === 1 ? 'borrará' : 'borrarán'} también de su bucket.` : ''}</p>
      <div class="actions"><button class="btn danger" data-act="dup-auto">${icon('trash')}Borrar ${plural(extra.length, 'copia repetida', 'copias repetidas')}</button></div></div>
    ${groups.map(g => `<section class="dup-group"><div class="dup-head"><b>${esc(g.tracks[0].title)}</b><small>${esc(artistsOf(g.tracks[0]).join(', '))} · ${g.tracks.length} copias</small>
      <button class="chip" data-act="dup-ignore" data-key="${esc(g.key)}">No son repetidas</button></div>${rows(g.tracks, { dup: g.key })}</section>`).join('')}
    ${back}`);
}

/**
 * Borra canciones para siempre: de la biblioteca, de este dispositivo y, si están en la nube, de su bucket.
 * `keepOf` (id -> pista) indica a qué copia pasan las playlists, «me gusta» y escuchas de cada una.
 */
async function deleteForever(list, keepOf = null) {
  const note = toast('Borrando…', 0);
  const gone = new Set(), fails = [];
  let emptied = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    note.set(`Borrando ${i + 1} de ${list.length}: ${t.title}`);
    try {
      if (t.cloudName && cloud.configured() && (await cloud.deleteRemote(t)) === 'emptied') emptied++;
      const keep = keepOf?.get(t.id);
      if (keep && S.tracks.has(keep.id)) await lib.mergeInto(t, keep);
      await lib.removeTrack(t.id);
      gone.add(t.id);
    } catch (e) { console.warn(e); fails.push(`«${t.title}»: ${e.message}`); }
  }
  if (gone.size) player.forget(gone);
  const msg = `${plural(gone.size, 'canción borrada', 'canciones borradas')}${emptied ? `. ${emptied === 1 ? 'Ha quedado vacía' : `${emptied} han quedado vacías`} en la nube: para borrarlas del todo de Oracle, añade una clave de API en Ajustes → Modo desarrollador` : ''}`;
  note.done(fails.length ? `${msg}. No se pudo borrar ${fails[0]}${fails.length > 1 ? ` y ${fails.length - 1} más` : ''}` : msg, fails.length || emptied ? 8000 : 4000);
  refresh();
}
function confirmDelete(t) {
  const b = t.cloudName && (cloud.buckets().find(x => x.id === t.bucketId) || cloud.buckets()[0]);
  return confirmDlg('¿Borrar la canción para siempre?', `«${t.title}» se borrará de tu biblioteca, de este dispositivo${b ? ` y del bucket «${b.name}» (en todos tus dispositivos)${oci.configured() ? '' : '. Sin clave de API de Oracle, el archivo queda vacío en el bucket, sin ocupar espacio'}` : ''}. No se puede deshacer.`, 'Borrar');
}

const ROUTES = { inicio: viewHome, biblioteca: viewLibrary, album: viewAlbum, artista: viewArtist, playlists: viewPlaylists, playlist: viewPlaylist, favoritos: viewFavs, mix: viewMix, estadisticas: viewStats, genero: n => viewTag('genero', n), ambiente: n => viewTag('ambiente', n), explorar: viewExplore, archivo: viewArchive, ajustes: viewSettings, repetidas: viewDuplicates };

// ------------------------------------------------------- menú de una canción
function trackMenu(t, o = {}, i = -1) {
  const head = `<div class="sheet-head">${cover(t)}<div><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></div></div>`;
  if (t.radio) {
    const saved = S.stations.some(s => s.id === t.id);
    return menu(head, [
      { icon: 'play', label: 'Escuchar', fn: () => player.playQueue([t]) },
      saved
        ? { icon: 'trash', label: 'Quitar de tus emisoras', danger: true, fn: () => { S.stations = S.stations.filter(s => s.id !== t.id); saveKV('stations'); refresh(); } }
        : { icon: 'plus', label: 'Guardar en tus emisoras', fn: () => { S.stations.push(t); saveKV('stations'); toast('Emisora guardada'); refresh(); } },
    ]);
  }
  const lib_ = inLibrary(t);
  const remote = t.cloudName || t.url;
  menu(head, [
    o.queue && (o.user || P.fromUser || i !== P.index) && { icon: 'x', label: 'Quitar de la cola', fn: () => player.removeFromQueue(i, !!o.user) },
    !o.queue && { icon: 'queue', label: 'Reproducir a continuación', fn: () => { player.enqueue([t], true); toast('Sonará a continuación'); } },
    !o.queue && { icon: 'plus', label: 'Añadir a la cola', fn: () => { player.enqueue([t]); toast('Añadida a tu cola'); } },
    !lib_ && { icon: 'library', label: 'Añadir a mi biblioteca', fn: async () => { await saveToLibrary([t]); toast('Añadida a tu biblioteca'); } },
    lib_ && { icon: 'list', label: 'Añadir a playlist…', fn: () => addToPlaylist([t]) },
    lib_ && S.settings.dev && { icon: 'edit', label: 'Editar metadatos', fn: () => editTrack(t) },
    lib_ && { icon: 'heart', label: isFav(t.id) ? 'Quitar de favoritas' : 'Me gusta', fn: () => toggleFav(t.id) },
    lib_ && { icon: 'spark', label: 'Radio de esta canción', fn: () => { player.playQueue(recs.songRadio(t)); toast('Mezcla creada a partir de la canción'); } },
    lib_ && t.album && { icon: 'disc', label: 'Ir al álbum', fn: () => go(`#/album/${enc(lib.albumKey(t))}`) },
    lib_ && {
      icon: 'user', label: 'Ir al artista', fn: () => {
        const names = artistsOf(t);
        if (names.length === 1) return go(`#/artista/${enc(names[0])}`);
        menu(`<div class="sheet-head"><div><b>¿A qué artista?</b></div></div>`, names.map(n => ({ icon: 'user', label: n, fn: () => go(`#/artista/${enc(n)}`) })));
      },
    },
    lib_ && remote && !t.hasBlob && !t.noDownload && { icon: 'download', label: 'Descargar en la app (sin conexión)', fn: () => downloadMany([t]) },
    !t.noDownload && (t.hasBlob || remote) && { icon: 'folder', label: 'Guardar el archivo en el dispositivo', fn: () => exportFile(t) },
    lib_ && remote && t.hasBlob && { icon: 'x', label: 'Quitar la descarga de este dispositivo', fn: async () => { await lib.dropBlob(t.id); toast('Descarga eliminada'); } },
    lib_ && t.hasBlob && !t.cloudName && cloud.configured() && { icon: 'cloudUp', label: 'Subir a la nube', fn: () => uploadTo([t]) },
    t.link && /^https:\/\//.test(t.link) && { icon: 'compass', label: `Ver origen y licencia${t.license ? ` (${t.license})` : ''}`, fn: () => window.open(t.link, '_blank', 'noopener') },
    o.playlist && { icon: 'x', label: 'Quitar de esta playlist', fn: async () => { const p = S.playlists.find(x => x.id === o.playlist); p.trackIds = p.trackIds.filter(x => x !== t.id); await savePlaylist(p); refresh(); } },
    lib_ && S.settings.dev && t.cloudName && cloud.configured() && {
      icon: 'trash', label: 'Borrar también de la nube', danger: true, fn: async () => { if (await confirmDelete(t)) deleteForever([t]); },
    },
    lib_ && {
      icon: 'trash', label: 'Eliminar de la biblioteca', danger: true, fn: async () => {
        const extra = t.cloudName ? ' El archivo seguirá en tu nube y volverá a aparecer al sincronizar.' : '';
        if (await confirmDlg('¿Eliminar canción?', `«${t.title}» se quitará de tu biblioteca y de este dispositivo.${extra}`)) { await lib.removeTrack(t.id); toast('Canción eliminada'); }
      },
    },
  ]);
}

// ------------------------------------------------------- acciones (clics)
const rowInfo = el => {
  const li = el.closest('.row'), ol = el.closest('[data-list]');
  if (!li || !ol) return null;
  const l = getList(ol.dataset.list);
  return l && { ...l, i: +li.dataset.i, track: l.tracks[+li.dataset.i], key: ol.dataset.list };
};
const firstList = () => lists[0]?.tracks || [];

const ACTIONS = {
  play(el) {
    const r = rowInfo(el);
    if (!r?.track) return;
    if (!playable(r.track)) return toast('Esta canción no está descargada y no hay nube conectada');
    if (r.key === 'q') player.jump(r.i);
    else if (r.key === 'u') player.jumpUser(r.i);
    else if (r.track.radio) player.playQueue([r.track]);
    else player.playQueue(r.tracks.filter(playable), r.tracks.filter(playable).indexOf(r.track));
  },
  fav(el) { const r = rowInfo(el); if (r?.track) toggleFav(r.track.id); },
  more(el) { const r = rowInfo(el); if (r?.track) trackMenu(r.track, r.opts, r.i); },
  'play-all'() { const l = firstList().filter(playable); if (l.length) { if (P.shuffle) player.toggleShuffle(); player.playQueue(l); } },
  'download-all'() { const l = firstList().filter(needsDownload); if (l.length) downloadMany(l); },
  'shuffle-all'() { const l = firstList().filter(playable); if (l.length) { if (!P.shuffle) player.toggleShuffle(); player.playQueue(l, Math.floor(Math.random() * l.length)); } },
  'add-music'() {
    menu(`<div class="sheet-head"><div><b>Añadir música</b><small>Se copia a este dispositivo para escucharla sin conexión</small></div></div>`, [
      { icon: 'plus', label: 'Elegir archivos', fn: () => $('#pick-files').click() },
      'webkitdirectory' in HTMLInputElement.prototype && { icon: 'folder', label: 'Elegir una carpeta entera', fn: () => $('#pick-folder').click() },
      { icon: 'compass', label: 'Explorar música libre', fn: () => { location.hash = '#/explorar'; } },
    ]);
  },
  async 'new-playlist'() { const p = await newPlaylist(); if (p) location.hash = `#/playlist/${enc(p.id)}`; },
  async 'rename-playlist'(el) {
    const p = S.playlists.find(x => x.id === el.dataset.pid);
    const name = await ask({ title: 'Cambiar nombre', value: p.name });
    if (name) { p.name = name; await savePlaylist(p); refresh(); }
  },
  async 'delete-playlist'(el) {
    const p = S.playlists.find(x => x.id === el.dataset.pid);
    if (!(await confirmDlg('¿Eliminar playlist?', `«${p.name}» se eliminará. Las canciones seguirán en tu biblioteca.`))) return;
    p.deleted = true; p.trackIds = [];
    await savePlaylist(p);
    location.hash = '#/playlists';
  },
  suggest(el) { searchMusic(el.dataset.q); },
  source(el) {
    explore.src = el.dataset.src; explore.error = ''; explore.loading = false;
    const pending = !explore.results[explore.src] && (explore.q || explore.src === 'jamendo') && !(explore.src === 'jamendo' && !jamendoKey());
    if (pending) searchMusic(explore.q); else route();
  },
  'more-results'() { searchMusic(explore.q, true); },
  async 'save-archive'(el) {
    const item = archiveCache.get(el.dataset.aid);
    await saveToLibrary(item.tracks);
    toast(`${plural(item.tracks.length, 'pista añadida', 'pistas añadidas')} a tu biblioteca`);
  },
  'go-artist'(el) {
    // En pantallas táctiles, tocar el nombre dentro de una fila o del mini reproductor hace lo de siempre.
    const touch = !matchMedia('(hover: hover)').matches;
    if (touch && el.closest('.row')) return ACTIONS.play(el);
    if (touch && el.closest('#mini')) return openNow();
    if (sheet.open) sheet.close();
    go(`#/artista/${enc(el.dataset.name)}`);
  },
  'go-album'(el) {
    if (!matchMedia('(hover: hover)').matches && el.closest('.row')) return ACTIONS.play(el);
    go(`#/album/${enc(el.dataset.key)}`);
  },
  'clear-user-queue'() { player.clearUserQueue(); },
  'cloud-sync'() { cloudSync(); },
  'cloud-upload-all'() { uploadMany(allTracks().filter(t => t.hasBlob && !t.cloudName && !t.url)); },
  async 'bucket-remove'(el) {
    const b = cloud.buckets().find(x => x.id === el.dataset.bid);
    if (!b || !(await confirmDlg(`¿Desconectar «${b.name}»?`, 'Sus canciones que no estén descargadas desaparecerán de la biblioteca hasta que vuelvas a conectarlo. No se borra nada en Oracle.', 'Desconectar'))) return;
    await cloud.removeBucket(b.id);
    toast('Bucket desconectado');
    refresh();
  },
  async 'bucket-default'(el) { await cloud.setUploadTarget(el.dataset.bid); refresh(); },
  async 'ai-forget'() { const A = aiConf(); delete A.keys[A.provider]; await saveKV('settings', false); refresh(); },
  async 'ai-models'(el) {
    const form = el.closest('form'), A = aiConf();
    const note = toast('Consultando los modelos disponibles…', 0);
    try {
      const cfg = { ...(await aiOptions(form.key.value.trim() || null)), url: form.url?.value.trim() || A.url };
      const list = await ai.listModels(cfg);
      (A.lists ||= {})[A.provider] = list.slice(0, 300);
      await saveKV('settings', false);
      $('#ai-models').innerHTML = list.map(m => `<option value="${esc(m)}">`).join('');
      note.done(list.length ? `${list.length} modelos disponibles: toca el campo «modelo» para elegir` : 'El servicio no devolvió ningún modelo', 5000);
      form.model.focus();
    } catch (e) { note.done(e.message, 6000); }
  },
  'lib-filter'() { openFilters(); },
  'cloud-tags'() { updateCloudFiles(); },
  'cloud-tags-stop'() { if (bulk) { bulk.stop = true; toast('Deteniendo al terminar el archivo actual…'); } },
  'write-files'() { const l = allTracks().filter(t => fileOutdated(t) && cloud.canWriteFile(t)); if (l.length) offerWrite(l); },
  'lib-unfilter'(el) { clearFilter(el.dataset.k, el.dataset.v); paintLibrary(); },
  'lib-clear'() { resetFilters(); paintLibrary(); },
  'dup-keep'(el) {
    const r = rowInfo(el);
    if (!r?.track || !r.opts.dup) return;
    dupKeep[r.opts.dup] = r.track.id;
    refresh();
  },
  async 'dup-ignore'(el) {
    S.settings.dupIgnore = [...new Set([...(S.settings.dupIgnore || []), el.dataset.key])];
    await saveKV('settings', false);
    toast('No se volverán a marcar como repetidas');
    refresh();
  },
  async 'dup-unignore'() {
    S.settings.dupIgnore = [];
    await saveKV('settings', false);
    refresh();
  },
  async 'dup-auto'() {
    const groups = lib.findDuplicates(dupKeep);
    const keepOf = new Map(), list = [];
    for (const g of groups) for (const t of g.tracks.slice(1)) { list.push(t); keepOf.set(t.id, g.tracks[0]); }
    if (!list.length) return;
    const inCloud = list.filter(t => t.cloudName).length;
    if (!(await confirmDlg(`¿Borrar ${plural(list.length, 'copia repetida', 'copias repetidas')}?`,
      `Se conserva una copia de cada canción.${inCloud ? ` ${plural(inCloud, 'copia está', 'copias están')} en la nube: se ${inCloud === 1 ? 'borrará' : 'borrarán'} también del bucket y desaparecerá${inCloud === 1 ? '' : 'n'} en todos tus dispositivos.` : ''} No se puede deshacer.`, 'Borrar'))) return;
    await deleteForever(list, keepOf);
  },
  async 'oci-forget'() { await oci.forget(); toast('Clave de Oracle quitada de este dispositivo'); refresh(); },
  async 'oci-purge'() {
    if (!(await confirmDlg('¿Borrar los archivos vacíos?', 'Se buscarán en tus buckets los archivos de audio vacíos (canciones borradas antes de añadir la clave) y se eliminarán de Oracle.', 'Borrar'))) return;
    const t = toast('Buscando archivos vacíos…', 0);
    try {
      const n = await cloud.purgeEmpty((i, name) => t.set(`Borrando ${i}: ${name.split('/').pop()}`));
      t.done(n ? `${plural(n, 'archivo borrado', 'archivos borrados')} de Oracle` : 'No había archivos vacíos', 5000);
    } catch (e) { t.done(e.message, 9000); }
  },
  async 'preset-remove'(el) {
    S.settings.genrePresets = (S.settings.genrePresets || []).filter(g => g !== el.dataset.g);
    S.settings.genrePresetsAt = Date.now();
    await saveKV('settings', false); emit('dirty'); refresh();
  },
  async 'ai-tag-all'() {
    const list = allTracks().filter(needsTags);
    const A = aiConf(), o = { provider: A.provider, model: A.models[A.provider] || (A.provider === 'anthropic' ? ai.DEFAULT_MODEL : '') }, service = ai.PROVIDERS[o.provider].name;
    if (!list.length || !(await confirmDlg(`¿Etiquetar ${plural(list.length, 'canción', 'canciones')} con IA?`,
      `Se enviarán el título, los artistas, el álbum y el año de cada canción a ${service} con tu clave (modelo ${o.model}). Puede tener un coste que se carga a tu cuenta de ese servicio.`, 'Etiquetar'))) return;
    tagMany(list);
  },
  async 'account-sync'() {
    const t = toast('Guardando en tu cuenta…', 0);
    try { await account.sync(); t.done('Datos guardados y sincronizados'); }
    catch (e) { t.done(`No se pudo sincronizar: ${e.message}`, 6000); }
    refresh();
  },
  async 'sign-out'() {
    if (!(await confirmDlg('¿Cerrar sesión?', 'Tu música y tus datos seguirán en este dispositivo, pero los cambios dejarán de guardarse en tu cuenta.', 'Cerrar sesión'))) return;
    await account.signOut();
    toast('Sesión cerrada');
  },
  async forgot() {
    const email = await ask({ title: 'Recuperar contraseña', text: 'Te enviaremos un enlace para elegir una contraseña nueva.', placeholder: 'Correo electrónico', value: $('[data-form=login] [name=email]')?.value || '', ok: 'Enviar', type: 'email' });
    if (!email) return;
    try { await account.recover(email); toast('Si existe una cuenta con ese correo, recibirás un enlace en unos minutos', 6000); }
    catch (e) { toast(e.message, 6000); }
  },
  async 'sb-reset'() { S.settings.sbUrl = ''; S.settings.sbKey = ''; await saveKV('settings', false); refresh(); },
  async install() { await installEvent?.prompt(); installEvent = null; refresh(); },
  // reproductor
  toggle() { player.toggle(); },
  next() { player.next(); },
  prev() { player.prev(); },
  shuffle() { player.toggleShuffle(); },
  repeat() { player.cycleRepeat(); },
  'open-now'() { openNow(); },
  'close-now'() { closeNow(); },
  'now-fav'() { if (P.current && inLibrary(P.current)) toggleFav(P.current.id); },
  'now-more'() { if (P.current) trackMenu(P.current, {}, -1); },
  'now-mode'(el) { nowMode = el.dataset.mode; renderNowPane(); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el, e);
});
document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  if (kind === 'archive') { const q = form.q.value.trim(); if (q || explore.src === 'jamendo') searchMusic(q); }
  if (kind === 'jamendo-key') { S.settings.jamendoId = form.key.value.trim(); await saveKV('settings', false); searchMusic(explore.q); }
  if (kind === 'radio') { explore.radioQ = form.q.value.trim(); explore.stations = null; route(); }
  if (kind === 'ai-key') {
    const A = aiConf();
    if (form.key.value.trim()) A.keys[A.provider] = await vault.seal(form.key.value.trim(), A.provider);
    A.models[A.provider] = form.model.value.trim();
    if (form.url) A.url = form.url.value.trim();
    await saveKV('settings', false);
    toast('Configuración de IA guardada');
    refresh();
  }
  if (kind === 'preset-add') {
    const g = form.g.value.trim();
    const all = genreOptions().map(x => x.toLowerCase());
    if (g && !all.includes(g.toLowerCase())) {
      S.settings.genrePresets = [...(S.settings.genrePresets || []), g];
      S.settings.genrePresetsAt = Date.now();
      await saveKV('settings', false); emit('dirty');
    } else if (g) toast('Ese género ya está en la lista');
    refresh();
  }
  if (kind === 'sb-config') {
    let url;
    try { url = new URL(form.url.value.trim()); } catch { return toast('Esa URL no es válida'); }
    S.settings.sbUrl = url.origin; S.settings.sbKey = form.key.value.trim();
    await saveKV('settings', false);
    refresh();
  }
  if (kind === 'login') {
    const email = form.email.value.trim(), password = form.password.value;
    const up = e.submitter?.value === 'up';
    const t = toast(up ? 'Creando la cuenta…' : 'Iniciando sesión…', 0);
    try {
      if (up) {
        const inside = await account.signUp(email, password);
        t.done(inside ? 'Cuenta creada. Tus datos ya se guardan en ella' : 'Cuenta creada. Te hemos enviado un correo: ábrelo y pulsa el enlace para confirmar', 8000);
      } else {
        await account.signIn(email, password);
        t.done('Sesión iniciada');
      }
    } catch (err) { t.done(err.message, 6000); }
    refresh();
  }
  if (kind === 'oci') {
    const t = toast('Comprobando la clave con Oracle…', 0);
    try {
      const cfg = oci.parseConfig(form.config.value);
      const file = form.pem.files[0];
      if (!file) throw new Error('Elige el archivo .pem de la clave privada');
      await oci.save(cfg, await oci.importPem(await file.text()));
      try { await cloud.checkOci(); } catch (err) { await oci.forget(); throw err; }
      t.done('Clave de Oracle conectada: lo que borres de la nube se eliminará de Oracle', 5000);
      refresh();
    } catch (err) { t.done(err.message, 9000); }
  }
  if (kind === 'par') {
    const t = toast('Comprobando la conexión…', 0);
    try { await cloud.addBucket(form.name.value, form.url.value); }
    catch (err) {
      const known = /URL|bucket|https/.test(err.message || '');
      return t.done(known ? err.message : `No se pudo conectar (${err.message}). Revisa la URL y que tenga activado el listado de objetos.`, 7000);
    }
    t.done('Bucket conectado');
    cloudSync();
  }
});

// --------------------------------------- deslizar una canción para añadirla a la cola
let swipe = null, swallowClick = false;
const endSwipe = add => {
  if (!swipe) return;
  const { row, track, active } = swipe;
  swipe = null;
  row.classList.remove('swiping', 'armed');
  row.style.removeProperty('--dx');
  if (!active) return;
  swallowClick = true; setTimeout(() => { swallowClick = false; }, 350);
  if (add) { player.enqueue([track]); toast(`«${track.title}» añadida a tu cola`); }
};
view.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch') return;
  const row = e.target.closest('.row');
  const info = row && rowInfo(row);
  if (!info?.track || info.track.radio || !playable(info.track)) return;
  swipe = { row, track: info.track, x: e.clientX, y: e.clientY, dx: 0, active: false };
});
view.addEventListener('pointermove', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.active) {
    if (dx > 14 && dx > Math.abs(dy) * 1.5) { swipe.active = true; swipe.row.classList.add('swiping'); }
    else if (Math.abs(dy) > 14 || dx < -14) { swipe = null; return; }
    else return;
  }
  swipe.dx = Math.max(0, Math.min(dx, 150));
  swipe.row.style.setProperty('--dx', `${swipe.dx}px`);
  swipe.row.classList.toggle('armed', swipe.dx >= 80);
});
view.addEventListener('pointerup', () => endSwipe(swipe?.dx >= 80));
view.addEventListener('pointercancel', () => endSwipe(false));
document.addEventListener('click', e => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);

// ------------------------------------------------------- importar archivos
async function runImport(files) {
  if (!files?.length) return;
  const t = toast('Preparando…', 0);
  const r = await lib.importFiles(files, (i, n, name) => t.set(`Añadiendo ${i} de ${n}: ${name}`));
  if (!r.total) return t.done('No se encontraron archivos de audio');
  t.done([`${plural(r.added, 'canción añadida', 'canciones añadidas')}`, r.skipped && `${r.skipped} ya estaban`, r.failed && `${r.failed} con error (¿sin espacio?)`].filter(Boolean).join(' · '), 5000);
}
for (const id of ['#pick-files', '#pick-folder']) {
  $(id).addEventListener('change', e => { runImport([...e.target.files]); e.target.value = ''; });
}
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; $('#drop').hidden = false; } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('#drop').hidden = true;
  runImport([...e.dataTransfer.files]);
});

// ------------------------------------------------------- mini reproductor
const mini = $('#mini');
const now = $('#now');
let nowMode = 'cover';       // cover | lyrics | queue
let seeking = false;
const REPEAT_LABEL = { off: 'Repetir', all: 'Repitiendo todo', one: 'Repitiendo una' };

function renderMini() {
  const t = P.current;
  mini.hidden = !t;
  if (!t) return;
  setHTML(mini, `<div class="line"><i></i></div><div class="bar">
    <button class="open" data-act="open-now" aria-label="Abrir reproductor">${cover(t)}<span class="row-text"><b>${esc(t.title)}</b><small>${artistLinks(t)}</small></span></button>
    <div class="desk center"><div class="ctl">
        <button class="icon-btn js-shuffle" data-act="shuffle" aria-label="Aleatorio">${icon('shuffle')}</button>
        <button class="icon-btn" data-act="prev" aria-label="Anterior">${icon('prev')}</button>
        <button class="icon-btn play js-play" data-act="toggle" aria-label="Reproducir o pausar"></button>
        <button class="icon-btn" data-act="next" aria-label="Siguiente">${icon('next')}</button>
        <button class="icon-btn js-repeat" data-act="repeat"></button></div>
      <div class="seek"><span class="js-cur">0:00</span><input type="range" class="js-seek" min="0" max="1000" value="0" aria-label="Posición"><span class="js-dur"></span></div></div>
    <div class="desk right">
      ${inLibrary(t) ? `<button class="icon-btn fav js-fav" data-act="now-fav" aria-label="Me gusta">${icon('heart')}</button>` : ''}
      <input type="range" class="vol js-vol" min="0" max="100" value="${Math.round(P.audio.volume * 100)}" style="--p:${Math.round(P.audio.volume * 100)}%" aria-label="Volumen"></div>
    <button class="icon-btn play mob js-play" data-act="toggle" aria-label="Reproducir o pausar"></button>
    <button class="icon-btn mob" data-act="next" aria-label="Siguiente">${icon('next')}</button></div>`);
  syncState(); syncTime();
}

// ------------------------------------------------- pantalla "Reproduciendo"
function openNow() {
  if (!P.current) return;
  now.hidden = false;
  renderNow();
  history.pushState({ now: true }, '');
}
/** Navega a otra pantalla; si el reproductor a pantalla completa está abierto, lo cierra antes. */
function go(hash) {
  if (!now.hidden) {
    now.hidden = true;
    // Sustituye la entrada del historial del reproductor en vez de volver atrás (que desharía la navegación).
    if (history.state?.now) { history.replaceState(null, '', hash); return route(); }
  }
  if (location.hash === hash) route(); else location.hash = hash;
}
function closeNow() {
  if (now.hidden) return;
  now.hidden = true;
  if (history.state?.now) history.back();
}
addEventListener('popstate', () => { now.hidden = true; });

function renderNow() {
  const t = P.current;
  if (now.hidden || !t) { if (!t) now.hidden = true; return; }
  const modes = [['cover', 'Carátula'], ['lyrics', 'Letra'], ['queue', 'Cola']];
  setHTML(now, `<div class="top">
      <button class="icon-btn" data-act="close-now" aria-label="Cerrar">${icon('down')}</button>
      <div class="seg">${modes.map(([m, l]) => `<button data-act="now-mode" data-mode="${m}">${l}</button>`).join('')}</div>
      <button class="icon-btn" data-act="now-more" aria-label="Más opciones">${icon('more')}</button></div>
    <div class="body"><div class="left">
      <div class="stage">${cover(t)}</div>
      <div class="meta"><div><b>${esc(t.title)}</b><span>${artistLinks(t)}${t.album && inLibrary(t) ? ` · ${albumLink(t)}` : ''}</span>
        ${[...(t.genres || []), ...(t.moods || [])].length ? `<span class="tags">${esc([...(t.genres || []).slice(0, 2), ...(t.moods || []).slice(0, 3)].join(' · '))}</span>` : ''}</div>
        ${inLibrary(t) ? `<button class="icon-btn fav js-fav" data-act="now-fav" aria-label="Me gusta">${icon('heart')}</button>` : ''}</div>
      <div><input type="range" class="js-seek" min="0" max="1000" value="0" aria-label="Posición" style="width:100%">
        <div class="times"><span class="js-cur">0:00</span><span class="js-dur"></span></div></div>
      <div class="ctl">
        <button class="icon-btn js-shuffle" data-act="shuffle" aria-label="Aleatorio">${icon('shuffle')}</button>
        <button class="icon-btn mid" data-act="prev" aria-label="Anterior">${icon('prev')}</button>
        <button class="icon-btn big js-play" data-act="toggle" aria-label="Reproducir o pausar"></button>
        <button class="icon-btn mid" data-act="next" aria-label="Siguiente">${icon('next')}</button>
        <button class="icon-btn js-repeat" data-act="repeat"></button></div>
    </div><div class="pane"></div></div>`);
  syncState(); syncTime();
  renderNowPane();
}

let lyr = { id: null, data: null, active: -1 };
async function renderNowPane() {
  if (now.hidden) return;
  const pane = $('.pane', now), stage = $('.stage', now);
  if (!pane) return;
  const desktop = matchMedia('(min-width: 900px)').matches;
  $$('.seg button', now).forEach(b => {
    b.classList.toggle('on', b.dataset.mode === nowMode || (desktop && nowMode === 'cover' && b.dataset.mode === 'lyrics'));
    if (b.dataset.mode === 'cover') b.hidden = desktop;
  });
  stage.hidden = nowMode !== 'cover';
  pane.hidden = nowMode === 'cover';
  if (nowMode === 'queue') {
    const t = P.current, from = P.index + 1;
    const upcoming = P.queue.slice(from, from + 300);
    const inAuto = P.autoFrom >= 0 && P.autoFrom <= from;
    setHTML(pane, `<h2 style="margin-top:0">Sonando</h2>
      ${t ? `<div class="row is-playing"><span class="row-main">${cover(t)}<span class="row-text"><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></span></span></div>` : ''}
      ${P.user.length ? `<div class="qhead"><h2>A continuación en tu cola</h2><button class="chip" data-act="clear-user-queue">Vaciar</button></div>
        <ol class="rows" data-list="u">${P.user.map((x, i) => rowHTML(x, i, { queue: true, user: true })).join('')}</ol>` : ''}
      ${upcoming.length ? `<h2>${inAuto ? 'Reproducción automática' : P.user.length ? 'Después, de lo que estabas escuchando' : 'A continuación'}</h2>
        <ol class="rows" data-list="q">${upcoming.map((x, k) => (from + k === P.autoFrom && !inAuto ? '<li class="qdivider">Reproducción automática · canciones parecidas</li>' : '') + rowHTML(x, from + k, { queue: true })).join('')}</ol>` : ''}
      ${!P.user.length && !upcoming.length ? '<p class="muted">No hay nada más en la cola. Desliza una canción hacia la derecha o usa su menú ⋯ para añadirla.</p>' : ''}`);
    pane.scrollTop = 0;
    return;
  }
  const t = P.current;
  if (!t) return;
  if (t.radio) { pane.innerHTML = '<div class="lyrics-empty"><div>Emisión en directo</div></div>'; return; }
  if (lyr.id !== t.id || lyr.retry) {
    lyr = { id: t.id, data: null, active: -1, retry: false };
    pane.innerHTML = '<div class="lyrics-empty"><div>Buscando la letra…</div></div>';
    const data = await getLyrics(t);
    if (lyr.id !== t.id) return;
    lyr.data = data;
    lyr.retry = !!(data.failed || data.offline);
  }
  if (nowMode === 'queue' || !lyr.data || P.current?.id !== lyr.id) return;
  lyr.active = -1;
  const d = lyr.data;
  if (d.synced) pane.innerHTML = `<div class="lyrics">${d.synced.map((l, i) => `<p data-l="${i}">${esc(l.text) || '♪'}</p>`).join('')}</div>`;
  else if (d.plain) pane.innerHTML = `<div class="lyrics plain">${esc(d.plain)}</div>`;
  else pane.innerHTML = `<div class="lyrics-empty"><div>${d.offline ? 'Sin conexión: no se puede buscar la letra ahora.' : d.failed ? 'No se pudo consultar el servicio de letras. Inténtalo más tarde.' : 'No se encontró la letra de esta canción.'}</div></div>`;
  pane.scrollTop = 0;
  syncLyrics();
}
now.addEventListener('click', e => {
  const p = e.target.closest('.lyrics p[data-l]');
  if (p && lyr.data?.synced) player.seek(lyr.data.synced[+p.dataset.l].t);
});
function syncLyrics() {
  const lines = lyr.data?.synced;
  if (!lines || now.hidden || nowMode === 'queue' || P.current?.id !== lyr.id) return;
  const time = P.audio.currentTime + 0.25;
  let i = -1;
  while (i + 1 < lines.length && lines[i + 1].t <= time) i++;
  if (i === lyr.active) return;
  lyr.active = i;
  const pane = $('.pane', now);
  $('.lyrics p.on', pane)?.classList.remove('on');
  const el = i >= 0 && $(`.lyrics p[data-l="${i}"]`, pane);
  if (el) { el.classList.add('on'); if (!pane.hidden) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}

// ------------------------------------------------------- estado del reproductor
function syncState() {
  const t = P.current;
  const buffering = P.playing && P.audio.readyState < 3;
  $$('.js-play').forEach(b => { b.innerHTML = icon(P.playing ? 'pause' : 'play'); b.classList.toggle('loading', buffering); });
  $$('.js-shuffle').forEach(b => b.classList.toggle('on', P.shuffle));
  $$('.js-repeat').forEach(b => { b.innerHTML = icon(P.repeat === 'one' ? 'repeat1' : 'repeat'); b.classList.toggle('on', P.repeat !== 'off'); b.setAttribute('aria-label', REPEAT_LABEL[P.repeat]); });
  $$('.js-fav').forEach(b => b.classList.toggle('on', !!t && isFav(t.id)));
  document.title = t && P.playing ? `${t.title} · ${t.artist || 'Fiora'}` : 'Fiora';
}
function syncTime() {
  const a = P.audio, t = P.current;
  const live = !!t?.radio || !Number.isFinite(a.duration);
  const dur = live ? 0 : a.duration;
  const ratio = dur ? a.currentTime / dur : 0;
  const line = $('#mini .line i');
  if (line) line.style.width = `${ratio * 100}%`;
  $$('.js-cur').forEach(el => { if (!seeking) el.textContent = fmt(a.currentTime) || '0:00'; });
  $$('.js-dur').forEach(el => { el.textContent = t?.radio ? 'EN DIRECTO' : fmt(dur || t?.duration); });
  $$('.js-seek').forEach(el => {
    el.disabled = live;
    if (!seeking) { el.value = Math.round(ratio * 1000); el.style.setProperty('--p', `${ratio * 100}%`); }
  });
  syncLyrics();
}
document.addEventListener('input', e => {
  const el = e.target;
  if (el.classList.contains('js-seek')) {
    seeking = true;
    el.style.setProperty('--p', `${el.value / 10}%`);
    const d = P.audio.duration;
    if (Number.isFinite(d)) $$('.js-cur').forEach(c => { c.textContent = fmt((el.value / 1000) * d) || '0:00'; });
  } else if (el.classList.contains('js-vol')) {
    el.style.setProperty('--p', `${el.value}%`);
    player.setVolume(el.value / 100);
  }
});
document.addEventListener('change', e => {
  if (!e.target.classList.contains('js-seek')) return;
  seeking = false;
  if (Number.isFinite(P.audio.duration)) player.seek((e.target.value / 1000) * P.audio.duration);
});
document.addEventListener('change', async e => {
  if (e.target.matches?.('[data-ai-provider]')) { aiConf().provider = e.target.value; await saveKV('settings', false); return refresh(); }
  const key = e.target.dataset?.toggle;
  if (!key) return;
  S.settings[key] = e.target.checked;
  S.settings[key + 'At'] = Date.now();
  await saveKV('settings', false);
  if (key === 'dev') return refresh();   // solo cambia lo que se ve en este dispositivo
  emit('dirty');
});
addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space' && !e.target.closest('button, a')) { e.preventDefault(); player.toggle(); }
  else if (e.key === 'Escape') closeNow();
});

function markPlaying() {
  const id = P.current?.id;
  $$('.row.is-playing').forEach(r => r.classList.remove('is-playing'));
  if (!id) return;
  $$('.row').forEach(r => {
    if (r.dataset.id !== id) return;
    if (!r.closest('[data-list="q"], [data-list="u"]')) r.classList.add('is-playing');
  });
}
on('track', () => { renderMini(); renderNow(); markPlaying(); });
on('state', syncState);
on('time', syncTime);
on('queue', () => { if (!now.hidden && nowMode === 'queue') renderNowPane(); });
on('track', () => { if (!now.hidden && nowMode === 'queue') renderNowPane(); });
on('favs', id => {
  syncState();
  if (id) $$('.row').forEach(r => { if (r.dataset.id === id) $('.fav', r)?.classList.toggle('on', isFav(id)); });
  if (!id || location.hash.startsWith('#/favoritos')) refresh();
});
on('library', refresh);
on('playlists', () => { if (/^#\/playlists?/.test(location.hash)) refresh(); });

// -------------------------------------------------------------------- arranque
async function accountSync() {
  if (!account.user() || !navigator.onLine) return;
  try { await account.sync(); } catch (e) { console.warn('Cuenta sin sincronizar', e); }
}
on('account', refresh);
on('cloud-changed', () => { refresh(); cloudSync(true); });
on('volume', v => { P.audio.volume = v; });

async function start() {
  try { await load(); }
  catch (e) {
    console.error(e);
    view.innerHTML = `<div class="wrap">${empty('x', 'No se pudo abrir la biblioteca', 'El navegador ha bloqueado el almacenamiento. Si estás en una ventana privada, prueba en una normal.')}</div>`;
    return;
  }
  if (typeof S.settings.volume === 'number') P.audio.volume = S.settings.volume;
  cloud.migrate();
  await sealAiKeys().catch(e => console.warn('No se pudieron cifrar las claves de IA', e));
  if (S.settings.dev) {
    const pending = allTracks().filter(t => fileOutdated(t) && cloud.canWriteFile(t)).length;
    if (pending) setTimeout(() => toast(`${plural(pending, 'canción tiene', 'canciones tienen')} géneros u otros cambios que aún no están en su archivo. Guárdalos en Ajustes → Modo desarrollador.`, 9000), 1500);
  }
  const linked = await account.init();   // puede venir de un enlace de correo de Supabase
  addEventListener('hashchange', route);
  await route();
  if (linked === 'confirmed') toast('Correo confirmado. Sesión iniciada');
  if (linked === 'recovery') {
    const pw = await ask({ title: 'Nueva contraseña', text: 'Elige la contraseña que usarás a partir de ahora.', placeholder: 'Contraseña nueva', ok: 'Cambiar', type: 'password' });
    if (pw) account.setPassword(pw).then(() => toast('Contraseña cambiada')).catch(e => toast(e.message, 6000));
  }
  accountSync();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(e => console.warn('Sin modo offline', e));
  cloudSync(true);
  addEventListener('online', () => { accountSync(); cloudSync(true); });
}
start();
