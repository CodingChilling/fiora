// Interfaz de Fiora: navegación, pantallas, menús y reproductor.
import { S, load, on, emit, isFav, toggleFav, allTracks, livePlaylists, savePlaylist, saveKV, saveTrack, collator, artistsOf, albumArtistOf } from './store.js';
import * as lib from './library.js';
import * as player from './player.js';
import { P } from './player.js';
import * as cloud from './cloud.js';
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
const getList = k => (k === 'q' ? { tracks: P.queue, opts: { queue: true } } : lists[+k]);

function rowHTML(t, i, o) {
  const cur = P.current && P.current.id === t.id && (!o.queue || i === P.index) ? ' is-playing' : '';
  const where = t.radio || o.queue ? '' : !t.hasBlob && (t.cloudName || t.url)
    ? `<span class="where" title="En línea">${icon('cloud')}</span>`
    : t.hasBlob && (t.cloudName || t.url) ? `<span class="where" title="Disponible sin conexión">${icon('offline')}</span>` : '';
  const sub = t.radio ? t.artist : [t.artist, o.hideAlbum ? '' : t.album, o.remote ? t.license : ''].filter(Boolean).join(' · ');
  return `<li class="row${cur}${playable(t) ? '' : ' unavailable'}" data-i="${i}" data-id="${esc(t.id)}">
    ${o.numbered ? `<span class="num">${t.trackNo || i + 1}</span>` : ''}
    <button class="row-main" data-act="play">${o.numbered ? '' : cover(t)}<span class="row-text"><b>${esc(t.title)}</b><small>${esc(sub)}</small></span></button>
    ${where}
    ${!t.radio && inLibrary(t) ? `<button class="icon-btn fav ${isFav(t.id) ? 'on' : ''}" data-act="fav" aria-label="Me gusta">${icon('heart')}</button>` : ''}
    <span class="dur">${fmt(t.duration)}</span>
    <button class="icon-btn" data-act="more" aria-label="Más opciones">${icon('more')}</button>
  </li>`;
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
const SECTION = { album: 'biblioteca', artista: 'biblioteca', playlist: 'playlists', favoritos: 'playlists', mix: 'inicio', archivo: 'explorar' };
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
};
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
  show(`<div class="head"><h1>${hello}</h1></div>
    <div class="mixes">${Object.entries(MIXES).map(([id, m]) =>
      `<a class="mix" href="#/mix/${id}"><span class="badge" style="--hue:${m.hue}">${icon(m.icon)}</span><span><b>${m.title}</b><small>${m.sub}</small></span></a>`).join('')}
      <a class="mix" href="#/favoritos"><span class="badge" style="--hue:340">${icon('heart')}</span><span><b>Canciones que te gustan</b><small>${plural(allTracks().filter(t => isFav(t.id)).length, 'canción', 'canciones')}</small></span></a>
    </div>
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
const playButtons = tracks => (tracks.length
  ? `<div class="actions"><button class="btn primary" data-act="play-all">${icon('play')}Reproducir</button><button class="btn" data-act="shuffle-all">${icon('shuffle')}Aleatorio</button></div>` : '');

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
function libraryList(tab) {
  const q = libQuery.trim().toLowerCase();
  const hit = (...f) => !q || f.some(x => (x || '').toLowerCase().includes(q));
  if (tab === 'albumes') {
    const list = albums().filter(a => hit(a.title, a.artist)).sort((a, b) => collator.compare(a.title, b.title));
    return list.length ? `<div class="grid">${list.map(albumCard).join('')}</div>` : empty('disc', 'Sin álbumes', 'No hay álbumes que coincidan.');
  }
  if (tab === 'artistas') {
    const list = artists().filter(a => hit(a.name)).sort((a, b) => collator.compare(a.name, b.name));
    return list.length ? `<div class="grid">${list.map(a =>
      `<a class="card" href="#/artista/${enc(a.name)}">${cover({ album: a.name, coverId: a.coverId, coverUrl: a.coverUrl }, 'round')}<span><b>${esc(a.name)}</b><small>${plural(a.tracks.length, 'canción', 'canciones')}</small></span></a>`).join('')}</div>`
      : empty('user', 'Sin artistas', 'No hay artistas que coincidan.');
  }
  const list = allTracks().filter(t => hit(t.title, t.artist, t.album)).sort((a, b) => collator.compare(a.title, b.title));
  return list.length ? rows(list) : empty('search', 'Sin resultados', 'Ninguna canción coincide con la búsqueda.');
}
function viewLibrary(tab = 'canciones') {
  if (!S.tracks.size) {
    return show(`<div class="head"><h1>Biblioteca</h1></div>${empty('library', 'Aquí aparecerá tu música',
      'Elige archivos o una carpeta entera (MP3, FLAC, M4A, OGG…). Se guardan en este dispositivo para escucharlos sin conexión.',
      `${ADD_BTN}`)}`);
  }
  const tabs = [['canciones', 'Canciones'], ['albumes', 'Álbumes'], ['artistas', 'Artistas']];
  show(`<div class="head"><h1>Biblioteca</h1>${ADD_BTN}</div>
    <label class="field" style="margin-bottom:14px">${icon('search')}<input id="lib-q" type="search" placeholder="Buscar en tu biblioteca" value="${esc(libQuery)}" autocomplete="off"></label>
    <div class="tabs">${tabs.map(([id, l]) => `<a href="#/biblioteca/${id}" class="${id === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="lib-list" data-tab="${tab}">${libraryList(tab)}</div>`);
}
view.addEventListener('input', e => {
  if (e.target.id !== 'lib-q') return;
  libQuery = e.target.value;
  const box = $('#lib-list');
  lists = [];
  setHTML(box, libraryList(box.dataset.tab));
  watchSentinels(box);
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
      <div class="actions">${tracks.length ? `<button class="btn primary" data-act="play-all">${icon('play')}Reproducir</button><button class="btn" data-act="shuffle-all">${icon('shuffle')}Aleatorio</button>` : ''}
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
  const gb = n => (n / 1073741824).toFixed(n > 1073741824 * 10 ? 0 : 2);
  const bks = cloud.buckets(), target = cloud.uploadTarget();
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
      <div class="actions" style="margin-top:14px">${ADD_BTN}${installEvent ? `<button class="btn" data-act="install">${icon('download')}Instalar como app</button>` : ''}</div></div>
    <div class="panel"><h2>Tus escuchas</h2>
      <div class="stat-row"><div class="stat"><b>${sum.plays}</b><small>reproducciones</small></div><div class="stat"><b>${sum.hours.toFixed(1)} h</b><small>escuchadas</small></div><div class="stat"><b>${esc(sum.topArtists[0]?.[0] || '—')}</b><small>artista más escuchado</small></div></div>
      ${sum.topTracks.length ? `<h2 style="margin-top:20px">Tus 5 canciones</h2>${rows(sum.topTracks)}` : '<p style="margin-top:12px">Las estadísticas se calculan en tu dispositivo a medida que escuchas.</p>'}</div>
    <p class="muted" style="text-align:center">Fiora · Letras de LRCLIB · Música libre de Internet Archive, Openverse, Wikimedia Commons y Jamendo · Radios de Radio Browser</p>`);
}
async function cloudSync(silent = false) {
  if (!cloud.configured() || !navigator.onLine) return;
  const t = silent ? null : toast('Sincronizando con la nube…', 0);
  try {
    const r = await cloud.syncAll((i, n, name) => t?.set(`Leyendo ${i} de ${n}: ${name.split('/').pop()}`));
    const msg = r.added || r.removed ? `Nube sincronizada: ${r.added} nuevas${r.removed ? `, ${r.removed} quitadas` : ''}` : 'Todo sincronizado';
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

const ROUTES = { inicio: viewHome, biblioteca: viewLibrary, album: viewAlbum, artista: viewArtist, playlists: viewPlaylists, playlist: viewPlaylist, favoritos: viewFavs, mix: viewMix, explorar: viewExplore, archivo: viewArchive, ajustes: viewSettings };

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
    o.queue && i !== P.index && { icon: 'x', label: 'Quitar de la cola', fn: () => player.removeFromQueue(i) },
    !o.queue && { icon: 'queue', label: 'Reproducir a continuación', fn: () => { player.enqueue([t], true); toast('Sonará a continuación'); } },
    !o.queue && { icon: 'plus', label: 'Añadir a la cola', fn: () => { player.enqueue([t]); toast('Añadida a la cola'); } },
    !lib_ && { icon: 'library', label: 'Añadir a mi biblioteca', fn: async () => { await saveToLibrary([t]); toast('Añadida a tu biblioteca'); } },
    lib_ && { icon: 'list', label: 'Añadir a playlist…', fn: () => addToPlaylist([t]) },
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
    lib_ && remote && !t.hasBlob && !t.noDownload && { icon: 'download', label: 'Descargar para escuchar sin conexión', fn: () => downloadMany([t]) },
    lib_ && remote && t.hasBlob && { icon: 'x', label: 'Quitar la descarga de este dispositivo', fn: async () => { await lib.dropBlob(t.id); toast('Descarga eliminada'); } },
    lib_ && t.hasBlob && !t.cloudName && cloud.configured() && { icon: 'cloudUp', label: 'Subir a la nube', fn: () => uploadTo([t]) },
    t.link && /^https:\/\//.test(t.link) && { icon: 'compass', label: `Ver origen y licencia${t.license ? ` (${t.license})` : ''}`, fn: () => window.open(t.link, '_blank', 'noopener') },
    o.playlist && { icon: 'x', label: 'Quitar de esta playlist', fn: async () => { const p = S.playlists.find(x => x.id === o.playlist); p.trackIds = p.trackIds.filter(x => x !== t.id); await savePlaylist(p); refresh(); } },
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
    else if (r.track.radio) player.playQueue([r.track]);
    else player.playQueue(r.tracks.filter(playable), r.tracks.filter(playable).indexOf(r.track));
  },
  fav(el) { const r = rowInfo(el); if (r?.track) toggleFav(r.track.id); },
  more(el) { const r = rowInfo(el); if (r?.track) trackMenu(r.track, r.opts, r.i); },
  'play-all'() { const l = firstList().filter(playable); if (l.length) { if (P.shuffle) player.toggleShuffle(); player.playQueue(l); } },
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
    <button class="open" data-act="open-now" aria-label="Abrir reproductor">${cover(t)}<span class="row-text"><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></span></button>
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
      <div class="meta"><div><b>${esc(t.title)}</b><span>${esc(t.artist || '')}</span></div>
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
    setHTML(pane, `<h2 style="margin-top:0">Cola de reproducción</h2><ol class="rows" data-list="q">${P.queue.slice(0, 400).map((t, i) => rowHTML(t, i, { queue: true })).join('')}</ol>`);
    $('.is-playing', pane)?.scrollIntoView({ block: 'center' });
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
  const key = e.target.dataset?.toggle;
  if (!key) return;
  S.settings[key] = e.target.checked;
  S.settings[key + 'At'] = Date.now();
  await saveKV('settings', false);
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
    const q = r.closest('[data-list="q"]');
    if (!q || +r.dataset.i === P.index) r.classList.add('is-playing');
  });
}
on('track', () => { renderMini(); renderNow(); markPlaying(); });
on('state', syncState);
on('time', syncTime);
on('queue', () => { if (!now.hidden && nowMode === 'queue') renderNowPane(); });
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
