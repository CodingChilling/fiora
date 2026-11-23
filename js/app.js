// Interfaz de Fiora: navegación, pantallas, menús y reproductor.
import * as kb from './knowledge.js';
import * as modes from './modes.js';
import { fileOutdated, S, load, on, emit, isFav, toggleFav, allTracks, everyTrack, trackBucketId, livePlaylists, savePlaylist, saveKV, saveTrack, collator, artistsOf, albumArtistOf, setEdit, MOODS, daypart, genreOptions } from './store.js';
import * as db from './db.js';
import * as ai from './ai.js';
import * as covers from './covers.js';
import { splitArtists, shrinkCover, hash } from './tags.js';
import * as lib from './library.js';
import * as player from './player.js';
import { P } from './player.js';
import * as cloud from './cloud.js';
import * as oci from './oci.js';
import * as vault from './vault.js';
import * as pldata from './playlists-data.js';
import { initPlaylists } from './playlist-ui.js';
import { initExplore } from './explore-ui.js';
import * as rdata from './radio-data.js';
import * as groups from './groups.js';
import * as habits from './habits.js';
import * as spatial from './spatial.js';
import * as fades from './fades.js';
import { initProfile } from './profile-ui.js';
import * as account from './account.js';
import * as src from './sources.js';
import { getLyrics } from './lyrics.js';
import * as recs from './recs.js';
import { icon } from './icons.js';

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
  const secs = tracks.reduce((a, t) => a + (t.duration || 0), 0), min = Math.round(secs / 60);
  if (!min && secs > 0) return 'menos de 1 min';
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};
const inLibrary = t => S.tracks.has(t.id);
// Sin conexión solo se puede escuchar lo descargado en este dispositivo.
const playable = t => (navigator.onLine ? !!(t.radio || t.hasBlob || t.url || (t.cloudName && cloud.configured())) : !!t.hasBlob);
const notPlayable = () => (navigator.onLine ? 'Esta canción no está descargada y no hay nube conectada' : 'Sin conexión: esta canción no está descargada en este dispositivo');
// El modo desarrollador cambia la música del bucket: solo funciona con la clave de API de Oracle
// guardada en este dispositivo y con permiso sobre algún bucket conectado.
const devReady = () => cloud.ownedBuckets().length > 0;
const devOn = () => !!S.settings.dev && devReady();

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
    ${o.reorder ? `<button class="icon-btn drag" data-drag aria-label="Mover «${esc(t.title)}» (arrastra o usa las flechas)">${icon('grip')}</button>` : ''}
    ${o.numbered ? `<span class="num">${t.trackNo || i + 1}</span>` : ''}
    <button class="row-main" data-act="play">${o.numbered ? '' : cover(t)}<span class="row-text"><b>${esc(t.title)}</b><small>${sub}</small></span></button>
    ${o.featured?.includes(t.id) ? `<span class="where feat-mark" title="Destacada">${icon('star')}</span>` : ''}
    ${o.notes?.[t.id]?.text ? `<button class="icon-btn note-mark" data-act="pl-note" data-pid="${esc(o.playlist)}" data-tid="${esc(t.id)}" title="${esc(o.notes[t.id].text.slice(0, 120))}" aria-label="Ver la nota">${icon('note')}</button>` : ''}
    ${where}
    ${o.dup ? (i === 0 ? '<span class="keep-tag">Se conserva</span>' : '<button class="chip" data-act="dup-keep">Conservar</button>') : ''}
    ${!o.dup && !t.radio && inLibrary(t) ? `<button class="icon-btn fav ${isFav(t.id) ? 'on' : ''}" data-act="fav" aria-label="Me gusta">${icon('heart')}</button>` : ''}
    ${o.auto ? `<button class="icon-btn q-promote" data-act="q-promote" aria-label="Añadir «${esc(t.title)}» a tu cola" data-tip="Añadir a tu cola">${icon('plus')}</button>` : ''}
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
  for (let i = from; i < to; i++) {
    // Cabeceras de sección (letra, fecha o década) cuando cambia el grupo.
    const g = opts.group?.(tracks[i]);
    if (g && (i === 0 || g !== opts.group(tracks[i - 1]))) out += `<li class="group-head" data-g="${esc(g)}">${esc(g)}</li>`;
    out += rowHTML(tracks[i], i, opts);
  }
  if (to < tracks.length) out += `<li class="sentinel" data-from="${to}"></li>`;
  return out;
}
function rows(tracks, opts = {}) {
  const k = lists.push({ tracks, opts }) - 1;
  return `<ol class="rows" data-list="${k}">${rowsChunk(k, 0)}</ol>`;
}
/** Pinta el siguiente bloque de filas de una lista; false si ya estaba entera. */
function renderNext(ol) {
  const s = $(':scope > .sentinel', ol);
  if (!s) return false;
  more.unobserve(s);
  s.remove();
  setHTML(ol, rowsChunk(ol.dataset.list, +s.dataset.from), 'beforeend');
  return true;
}
const more = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting || !e.target.parentNode) continue;
    const ol = e.target.parentNode;
    renderNext(ol);
    watchSentinels(ol);
  }
}, { rootMargin: '600px' });
/** Pinta filas hasta que la vista sea lo bastante alta para volver a una posición guardada. */
function fillTo(px) {
  for (const ol of $$('ol.rows[data-list]', view)) {
    while (view.scrollHeight - view.clientHeight < px && renderNext(ol));
    watchSentinels(ol);
  }
}
const watchSentinels = root => $$('.sentinel', root).forEach(s => more.observe(s));

// ---------------------------------------------------------------- navegación
const view = $('#view');
const NAV = [['inicio', 'Inicio', 'home'], ['biblioteca', 'Biblioteca', 'library'], ['playlists', 'Playlists', 'list'], ['explorar', 'Explorar', 'compass'], ['perfil', 'Perfil', 'user']];
const SECTION = { ajustes: 'perfil', estadisticas: 'perfil', repetidas: 'perfil', criatura: 'perfil', album: 'biblioteca', artista: 'biblioteca', genero: 'biblioteca', ambiente: 'biblioteca', playlist: 'playlists', favoritos: 'playlists', mix: 'inicio', archivo: 'explorar' };
$('#nav-links').innerHTML = NAV.map(([id, label, ic]) => `<a href="#/${id}" data-nav="${id}">${icon(ic)}<span>${label}</span></a>`).join('');

function show(html) {
  setHTML(view, `<div class="wrap">${html}</div>`);
  watchSentinels(view);
}
let lastHash = null;
const scrollMem = new Map();   // posición de cada pestaña de la biblioteca al salir de ella
async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name = '', ...args] = hash.split('/').map(decodeURIComponent);
  const fn = ROUTES[name] || viewHome;
  const section = SECTION[name] || (ROUTES[name] ? name : 'inicio');
  $$('#nav-links a').forEach(a => a.classList.toggle('on', a.dataset.nav === section));
  lists = [];
  if (!['perfil', 'criatura', 'estadisticas'].includes(name)) PF.leave();   // la escena 3D solo vive en Perfil y en la criatura
  const same = hash === lastHash;
  if (lastHash?.startsWith('biblioteca')) scrollMem.set(lastHash, view.scrollTop);
  const keep = same ? view.scrollTop : 0;
  lastHash = hash;
  await fn(...args);
  offlineNote(name);
  // La biblioteca vuelve a donde estabas (al volver de un álbum, de un artista o de otra pestaña).
  const now = location.hash.replace(/^#\/?/, '');
  lastHash = now;
  const target = same ? keep : now.startsWith('biblioteca') ? scrollMem.get(now) || 0 : 0;
  if (target) fillTo(target);
  view.scrollTop = target;
}
// Sin conexión: aviso en las pantallas que dependen de internet (la app sigue funcionando con lo descargado).
const NEEDS_NET = {
  explorar: 'Sin conexión: la música libre y las radios necesitan internet. Tus canciones descargadas siguen en la Biblioteca.',
  archivo: 'Sin conexión: este álbum se escucha desde internet. Vuelve a intentarlo cuando tengas conexión.',
};
function offlineNote(name) {
  $('.offline-note', view)?.remove();
  if (navigator.onLine || !NEEDS_NET[name]) return;
  const p = document.createElement('p');
  p.className = 'offline-note note-box'; p.setAttribute('role', 'status'); p.textContent = NEEDS_NET[name];
  ($('.wrap', view) || view).prepend(p);
}
function netState(announce) {
  const off = !navigator.onLine;
  document.body.classList.toggle('offline', off);
  $('#netbar').hidden = !off;
  if (!announce) return;
  toast(off ? 'Sin conexión: puedes seguir escuchando lo descargado en este dispositivo' : 'Conexión recuperada');
  refresh();                                       // las canciones no descargadas se marcan (o desmarcan) como no disponibles
  if (!now.hidden && nowMode === 'queue') renderNowPane();
}
addEventListener('online', () => netState(true));
addEventListener('offline', () => netState(true));
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
      `${ADD_BTN}<a class="btn" href="#/explorar">${icon('compass')}Explorar música libre</a><a class="btn" href="#/ajustes/${account.user() ? 'ayuda' : 'cuenta'}">${icon('user')}${account.user() ? 'Conectar nube' : 'Iniciar sesión'}</a>`)}`);
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
  const tracks = mood ? recs.moodMix(name, Infinity) : recs.byGenre(name).sort((a, b) => collator.compare(a.title, b.title));
  show(`<div class="hero"><span class="cover" style="--hue:${mood ? MOOD_HUE(name) : hue(name)}"><i>${icon(mood ? 'spark' : 'disc')}</i></span>
      <div class="info"><div class="kind">${mood ? 'Ambiente' : 'Género'}</div><h1 style="text-transform:${mood ? 'capitalize' : 'none'}">${esc(name)}</h1><p>${plural(tracks.length, 'canción', 'canciones')}${mood ? ' · primero las que más te gustan' : ''}</p>${playButtons(tracks)}</div></div>
    ${tracks.length ? rows(tracks) : empty('disc', 'Sin canciones', 'Ninguna canción tiene esta etiqueta todavía.')}`);
}
const modeBtns = (cls = 'btn') => `<button class="${cls}" data-act="play-surprise" title="Aleatorio, dejando para el final lo que has escuchado hace poco" aria-label="Modo sorpresa">${icon('dice')}<span>Sorpresa</span></button><button class="${cls}" data-act="play-ambient" title="De lo tranquilo a lo intenso, y vuelta a la calma (según «lo que transmite»)" aria-label="Modo ambiente">${icon('wave')}<span>Ambiente</span></button>`;
const playButtons = tracks => (tracks.length
  ? `<div class="actions"><button class="btn primary" data-act="play-all">${icon('play')}Reproducir</button><button class="btn" data-act="shuffle-all">${icon('shuffle')}Aleatorio</button>${modeBtns()}${downloadAllBtn(tracks)}</div>` : '');

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
// Botón de reproducir que aparece sobre la portada de una tarjeta (con ratón o teclado).
const cardPlay = (act, key, name) => `<span class="card-over"><button class="card-play" data-act="${act}" data-key="${esc(key)}" aria-label="Reproducir «${esc(name)}»" title="Reproducir">${icon('play')}</button></span>`;
const albumCard = a => `<div class="card-wrap"><a class="card" href="#/album/${enc(a.key)}">${cover({ album: a.title, coverId: a.coverId, coverUrl: a.coverUrl })}<span><b>${esc(a.title)}</b><small>${esc(a.artist)}${a.year ? ` · ${esc(a.year)}` : ''}</small></span></a>${cardPlay('play-album', a.key, a.title)}</div>`;
const artistCard = a => `<div class="card-wrap"><a class="card artist" href="#/artista/${enc(a.name)}">${cover({ album: a.name, coverId: a.coverId, coverUrl: a.coverUrl }, 'round')}<span><b>${esc(a.name)}</b><small>${[a.albums.size ? plural(a.albums.size, 'álbum', 'álbumes') : '', plural(a.tracks.length, 'canción', 'canciones')].filter(Boolean).join(' · ')}</small></span></a>${cardPlay('play-artist', a.name, a.name)}</div>`;
const byTrackNo = (x, y) => collator.compare(x.album || '', y.album || '') || (x.trackNo || 999) - (y.trackNo || 999) || collator.compare(x.title, y.title);
function artists() {
  const m = new Map();
  for (const t of allTracks()) {
    for (const name of artistsOf(t)) {
      let a = m.get(name);
      if (!a) m.set(name, a = { name, tracks: [], albums: new Set(), coverId: '', coverUrl: '' });
      a.tracks.push(t);
      if (t.album) a.albums.add(t.album);
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

// ------------------------------------------------------ vista de la biblioteca
const LIB_TABS = [['canciones', 'Canciones'], ['albumes', 'Álbumes'], ['artistas', 'Artistas'], ['generos', 'Géneros']];
const artistPlays = a => a.tracks.reduce((n, t) => n + stat(t, 'plays'), 0);
const ALBUM_SORT = {
  title: ['Título', (a, b) => collator.compare(a.title, b.title)],
  artist: ['Artista', (a, b) => collator.compare(a.artist, b.artist) || (a.year || 0) - (b.year || 0) || collator.compare(a.title, b.title)],
  year: ['Año (más nuevos)', (a, b) => (b.year || 0) - (a.year || 0) || collator.compare(a.title, b.title)],
  added: ['Añadidos recientemente', (a, b) => b.addedAt - a.addedAt],
};
const ARTIST_SORT = {
  name: ['Nombre', (a, b) => collator.compare(a.name, b.name)],
  songs: ['Más canciones', (a, b) => b.tracks.length - a.tracks.length || collator.compare(a.name, b.name)],
  plays: ['Más escuchados', (a, b) => artistPlays(b) - artistPlays(a) || collator.compare(a.name, b.name)],
};
// Pestaña → [ajuste donde se guarda, opciones, orden por defecto, qué se ordena]
const SORTS = {
  canciones: ['libSort', F_SORT, 'title', 'canciones'],
  albumes: ['libAlbumSort', ALBUM_SORT, 'title', 'álbumes'],
  artistas: ['libArtistSort', ARTIST_SORT, 'name', 'artistas'],
};
const sortOf = tab => { const [k, m, d] = SORTS[tab]; return m[S.settings[k]] ? S.settings[k] : d; };

// Secciones de la lista de canciones según el orden elegido.
const initial = s => { const c = fold(s).trim()[0] || ''; return /[a-z]/.test(c) ? c.toUpperCase() : '#'; };
const SONG_GROUPS = {
  title: t => initial(t.title),
  artist: t => initial(t.artist),
  album: t => (t.album ? initial(t.album) : 'Sin álbum'),
  added: t => {
    const d = (Date.now() - (t.addedAt || 0)) / DAY;
    return !t.addedAt ? 'Sin fecha' : d < 1 ? 'Hoy' : d < 7 ? 'Esta semana' : d < 31 ? 'Este mes' : d < 365 ? 'Este año' : 'Hace más de un año';
  },
  year: t => (decadeOf(t) ? `Años ${decadeName(decadeOf(t))}` : 'Sin año'),
};
// Filtros a un toque: [clave, valor, etiqueta, ¿activo?]
const QUICK = [
  ['fav', '1', 'Me gusta', () => libF.fav],
  ['plays', 'never', 'Sin escuchar', () => libF.plays === 'never'],
  ['avail', 'offline', 'Sin conexión', () => libF.avail === 'offline'],
];

function libSummary() {
  const t = allTracks();
  return [plural(t.length, 'canción', 'canciones'), plural(albums(t).length, 'álbum', 'álbumes'), plural(artists().length, 'artista', 'artistas'), totalTime(t)].join(' · ');
}
const sortBtn = tab => `<button class="btn sm" data-act="lib-sort" data-tab="${tab}" aria-label="Ordenar ${SORTS[tab][3]}: ${esc(SORTS[tab][1][sortOf(tab)][0])}">${icon('sort')}<span>${esc(SORTS[tab][1][sortOf(tab)][0])}</span></button>`;
const countLine = (what, extra = '') => `<span class="lib-count"><b>${what}</b>${extra ? `<small>${extra}</small>` : ''}</span>`;

function songTools(list, active) {
  const quick = QUICK.filter(([k]) => k !== 'avail' || libF.avail === 'offline' || allTracks().some(t => !t.hasBlob));
  const isQuick = (k, v) => quick.some(([qk, qv]) => qk === k && (k === 'fav' || libF[k] === qv));
  const rest = active.filter(([, k]) => !isQuick(k));
  return `<div class="lib-tools">
      <div class="lib-play">${list.length ? `<button class="play-fab" data-act="play-all" aria-label="Reproducir" title="Reproducir">${icon('play')}</button>
        <button class="icon-btn shuf" data-act="shuffle-all" aria-label="Reproducir en aleatorio" title="Aleatorio">${icon('shuffle')}</button>
        <button class="icon-btn shuf" data-act="play-surprise" aria-label="Modo sorpresa" title="Sorpresa: aleatorio, dejando para el final lo que has escuchado hace poco">${icon('dice')}</button>
        <button class="icon-btn shuf" data-act="play-ambient" aria-label="Modo ambiente" title="Ambiente: de lo tranquilo a lo intenso, y vuelta a la calma">${icon('wave')}</button>` : ''}
        ${countLine(plural(list.length, 'canción', 'canciones'), list.length ? totalTime(list) : '')}</div>
      <div class="lib-sort">${sortBtn('canciones')}
        <button class="btn sm ${active.length ? 'on' : ''}" data-act="lib-filter" aria-label="Filtrar${active.length ? ` (${active.length} activos)` : ''}">${icon('filter')}<span class="lbl">Filtrar</span>${active.length ? `<span class="count">${active.length}</span>` : ''}</button></div>
    </div>
    <div class="lib-count-m" aria-hidden="true"><b>${plural(list.length, 'canción', 'canciones')}</b>${list.length ? `<small>${totalTime(list)}</small>` : ''}</div>
    <div class="chips lib-chips">${quick.map(([k, v, l, on]) => `<button class="chip ${on() ? 'on' : ''}" data-act="lib-quick" data-k="${k}" data-v="${v}" aria-pressed="${on()}">${esc(l)}</button>`).join('')}
      ${rest.map(([l, k, v]) => `<button class="chip on removable" data-act="lib-unfilter" data-k="${k}" data-v="${esc(v ?? '')}" aria-label="Quitar filtro ${esc(l)}">${esc(l)}${icon('x')}</button>`).join('')}</div>`;
}

// Al buscar en Canciones también aparecen los artistas y álbumes que coinciden.
function searchExtras(q) {
  const hit = x => fold(x).includes(q);
  const ar = artists().filter(a => hit(a.name)).sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 12);
  const al = albums().filter(a => hit(a.title) || hit(a.artist)).sort(ALBUM_SORT.title[1]).slice(0, 12);
  if (!ar.length && !al.length) return '';
  return `${ar.length ? `<h3 class="lib-sub">Artistas</h3><div class="strip people">${ar.map(artistCard).join('')}</div>` : ''}
    ${al.length ? `<h3 class="lib-sub">Álbumes</h3><div class="strip">${al.map(albumCard).join('')}</div>` : ''}<h3 class="lib-sub">Canciones</h3>`;
}

// Índice de letras a un lado para saltar por la lista.
const azIndex = groups => `<nav class="az" aria-label="Ir a la letra">${groups.map(g => `<button type="button" data-az="${esc(g)}" tabindex="-1">${esc(g)}</button>`).join('')}</nav>`;

function tagTiles(list, kind, cap = Infinity) {
  // Hasta dos portadas distintas por etiqueta, en una sola pasada.
  const art = new Map(list.slice(0, cap).map(([n]) => [kind === 'genero' ? n.toLowerCase() : n, []]));
  for (const t of allTracks()) {
    const key = t.coverId || t.coverUrl;
    if (!key) continue;
    for (const x of kind === 'genero' ? (t.genres || []).map(g => g.toLowerCase()) : t.moods || []) {
      const a = art.get(x);
      if (a && a.length < 2 && !a.some(o => (o.coverId || o.coverUrl) === key)) a.push(t);
    }
  }
  const mood = kind === 'ambiente';
  return `<div class="tiles">${list.slice(0, cap).map(([n, c]) => `<a class="tile" href="#/${kind}/${enc(n)}" style="--hue:${mood ? MOOD_HUE(n) : hue(n)}">
      <span class="tile-text"><b class="${mood ? 'cap' : ''}">${esc(n)}</b><small>${plural(c, 'canción', 'canciones')}</small></span>
      <span class="tile-art">${(art.get(mood ? n : n.toLowerCase()) || []).map(t => cover(t)).join('') || icon(mood ? 'spark' : 'disc')}</span></a>`).join('')}</div>`;
}

function libraryList(tab) {
  const q = fold(libQuery.trim());
  const hit = (...f) => !q || f.some(x => fold(x).includes(q));
  const noHits = what => empty('search', 'Sin resultados', `No hay ${what} que coincidan con «${esc(libQuery.trim())}».`, '<button class="btn" data-act="lib-q-clear">Borrar búsqueda</button>');
  if (tab === 'albumes') {
    const list = albums().filter(a => hit(a.title, a.artist)).sort(ALBUM_SORT[sortOf(tab)][1]);
    if (!list.length) return q ? noHits('álbumes') : empty('disc', 'Sin álbumes', 'Las canciones con el nombre del álbum en sus etiquetas aparecen aquí agrupadas.');
    return `<div class="lib-tools">${countLine(plural(list.length, 'álbum', 'álbumes'))}<div class="lib-sort">${sortBtn(tab)}</div></div>
      <div class="grid lib-grid">${list.map(albumCard).join('')}</div>`;
  }
  if (tab === 'artistas') {
    const list = artists().filter(a => hit(a.name)).sort(ARTIST_SORT[sortOf(tab)][1]);
    if (!list.length) return q ? noHits('artistas') : empty('user', 'Sin artistas', 'Aún no hay artistas en tu biblioteca.');
    return `<div class="lib-tools">${countLine(plural(list.length, 'artista', 'artistas'))}<div class="lib-sort">${sortBtn(tab)}</div></div>
      <div class="grid lib-grid">${list.map(artistCard).join('')}</div>`;
  }
  if (tab === 'generos') {
    const { moods: allMoods, genres: rawGenres } = recs.tagCounts();
    // Géneros que solo cambian en mayúsculas cuentan como uno (se muestra la forma más usada).
    const merged = new Map();
    for (const [x, c] of rawGenres) { const k = x.toLowerCase(), m = merged.get(k); if (m) m[1] += c; else merged.set(k, [x, c]); }
    const moods = allMoods.filter(([n]) => hit(n)), genres = [...merged.values()].sort((a, b) => b[1] - a[1]).filter(([n]) => hit(n));
    if (!allMoods.length && !rawGenres.length) return empty('disc', 'Aún no hay etiquetas', 'Los géneros salen de las etiquetas de tus archivos. Para añadir géneros y ambientes a mano o con IA, activa el modo desarrollador en Ajustes.');
    if (!moods.length && !genres.length) return noHits('géneros ni ambientes');
    const TOP = q ? Infinity : 12;
    return `${moods.length ? `<h2 class="lib-h">Lo que transmite</h2>${tagTiles(moods, 'ambiente')}` : ''}
      ${genres.length ? `<h2 class="lib-h">Géneros</h2>${tagTiles(genres, 'genero', TOP)}` : ''}
      ${genres.length > TOP ? `<h3 class="lib-sub">Más géneros</h3><div class="chips">${genres.slice(TOP).map(([n, c]) => `<a class="chip" href="#/genero/${enc(n)}">${esc(n)} <small class="muted">${c}</small></a>`).join('')}</div>` : ''}`;
  }
  const sort = sortKey();
  const list = applySearch(filteredTracks()).sort(F_SORT[sort][1]);
  const active = activeFilters();
  const group = !q ? SONG_GROUPS[sort] : null;
  const groups = group && LETTERS.has(sort) ? [...new Set(list.map(group))].filter(g => g.length === 1) : [];
  const az = list.length >= 30 && groups.length >= 4;
  return `${songTools(list, active)}${q ? searchExtras(q) : ''}${list.length
    ? `<div class="${az ? 'has-az' : ''}">${rows(list, { group })}${az ? azIndex(groups) : ''}</div>`
    : empty('search', 'Sin resultados', active.length ? 'Ninguna canción cumple los filtros.' : `Ninguna canción coincide con «${esc(libQuery.trim())}».`,
      active.length ? '<button class="btn" data-act="lib-clear">Quitar filtros</button>' : '<button class="btn" data-act="lib-q-clear">Borrar búsqueda</button>')}`;
}
const LETTERS = new Set(['title', 'artist', 'album']);

const LIB_ADD = `<button class="btn primary add" data-act="add-music" aria-label="Añadir música">${icon('plus')}<span>Añadir música</span></button>`;
// Ver u ocultar las canciones de cada bucket sin desconectarlo (un toque en su botón).
function bucketToggles() {
  const bks = cloud.buckets();
  if (!bks.length) return '';
  const count = new Map();
  for (const t of everyTrack()) { const b = trackBucketId(t); if (b) count.set(b, (count.get(b) || 0) + 1); }
  const shown = bks.filter(b => count.get(b.id));
  if (!shown.length) return '';
  const hidden = new Set(S.settings.hiddenBuckets || []);
  return `<div class="chips lib-buckets" role="group" aria-label="Buckets que se ven en la biblioteca">${shown.map(b => {
    const on = !hidden.has(b.id);
    return `<button class="chip bucket-chip ${on ? 'on' : 'off'}" data-act="lib-bucket" data-bid="${esc(b.id)}" aria-pressed="${on}" title="${on ? 'Ocultar' : 'Mostrar'} las canciones de «${esc(b.name)}»">${icon(on ? 'cloud' : 'x')}${esc(b.name)}<small>${num(count.get(b.id))}</small></button>`;
  }).join('')}</div>`;
}
async function toggleBucket(id) {
  const h = new Set(S.settings.hiddenBuckets || []);
  if (h.has(id)) h.delete(id); else h.add(id);
  S.settings.hiddenBuckets = [...h];
  S.settings.hiddenBucketsAt = Date.now();
  await saveKV('settings', false);
  emit('dirty'); emit('library');
  const b = cloud.buckets().find(x => x.id === id);
  toast(h.has(id) ? `Canciones de «${b?.name || 'ese bucket'}» ocultas` : `Canciones de «${b?.name || 'ese bucket'}» visibles`);
}
function viewLibrary(tab) {
  if (S.tracks.size && !allTracks().length) {   // todo lo que hay está en buckets ocultos
    return show(`<div class="head lib-head"><div><h1>Biblioteca</h1></div>${LIB_ADD}</div>${bucketToggles()}
      ${empty('cloud', 'Tus buckets están ocultos', 'Toca un bucket de arriba para volver a ver sus canciones.')}`);
  }
  if (!S.tracks.size) {
    return show(`<div class="head"><h1>Biblioteca</h1></div>${empty('library', 'Aquí aparecerá tu música',
      'Elige archivos o una carpeta entera (MP3, FLAC, M4A, OGG…). Se guardan en este dispositivo para escucharlos sin conexión.',
      `${ADD_BTN}`)}`);
  }
  // Sin pestaña en la dirección, vuelve a la última que usaste.
  if (!LIB_TABS.some(([id]) => id === tab)) {
    tab = LIB_TABS.some(([id]) => id === S.settings.libTab) ? S.settings.libTab : 'canciones';
    history.replaceState(null, '', `#/biblioteca/${tab}`);
  } else if (S.settings.libTab !== tab) { S.settings.libTab = tab; saveKV('settings', false); }
  const n = { canciones: allTracks().length, albumes: albums().length, artistas: artists().length };
  show(`<div class="head lib-head"><div><h1>Biblioteca</h1><p class="muted lib-sum">${libSummary()}</p></div>${LIB_ADD}</div>
    ${bucketToggles()}
    <div class="bar-mark"></div>
    <div class="lib-bar">
      <label class="field lib-search">${icon('search')}<input id="lib-q" type="search" placeholder="Buscar canciones, artistas, álbumes…" aria-label="Buscar en tu biblioteca" value="${esc(libQuery)}" autocomplete="off" enterkeyhint="search">
        <button type="button" class="icon-btn clear" data-act="lib-q-clear" aria-label="Borrar búsqueda" ${libQuery ? '' : 'hidden'}>${icon('x')}</button><kbd title="Pulsa / para buscar">/</kbd></label>
      <nav class="seg" aria-label="Secciones de la biblioteca">${LIB_TABS.map(([id, l]) => `<a href="#/biblioteca/${id}" class="${id === tab ? 'on' : ''}" ${id === tab ? 'aria-current="page"' : ''}>${l}${n[id] ? `<small>${num(n[id])}</small>` : ''}</a>`).join('')}</nav>
    </div>
    <div id="lib-list" data-tab="${tab}">${libraryList(tab)}</div>`);
  watchBar();
}
// La barra de búsqueda y pestañas se queda arriba al desplazarse; con sombra cuando está «pegada».
// La barra se pega bajo el margen superior de la vista (no en el borde), así que se mide desde ahí.
const viewPad = () => parseFloat(getComputedStyle(view).paddingTop) || 0;
let barObs = null;
function watchBar() {
  barObs?.disconnect();
  const m = $('.bar-mark');
  if (!m) return;
  barObs = new IntersectionObserver(([e]) => $('.lib-bar')?.classList.toggle('stuck', !e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0) + 1),
    { root: view, rootMargin: `-${Math.ceil(viewPad())}px 0px 0px 0px` });
  barObs.observe(m);
}

view.addEventListener('input', e => {
  if (e.target.id !== 'lib-q') return;
  libQuery = e.target.value;
  $('.lib-search .clear')?.toggleAttribute('hidden', !libQuery);
  paintLibrary();
  // Si estabas más abajo, los resultados empiezan justo debajo de la barra.
  const m = $('.bar-mark');
  const d = m ? m.getBoundingClientRect().top - view.getBoundingClientRect().top - viewPad() : 0;
  if (d < 0) view.scrollTop += d;
});
view.addEventListener('keydown', e => {
  if (e.target.id !== 'lib-q' || e.key !== 'Escape') return;
  e.stopPropagation();
  if (e.target.value) { e.target.value = ''; e.target.dispatchEvent(new Event('input', { bubbles: true })); } else e.target.blur();
});

// Índice de letras: tocar o arrastrar por él salta a esa letra.
let azBubble = null, azTimer = null;
function azJump(g) {
  const ol = $('#lib-list ol.rows');
  if (!ol) return;
  let h;
  while (!(h = $(`.group-head[data-g="${CSS.escape(g)}"]`, ol)) && renderNext(ol));
  watchSentinels(ol);
  if (!h) return;
  // La barra acaba pegada arriba, así que la sección queda justo debajo de su altura.
  view.scrollTop += h.getBoundingClientRect().top - view.getBoundingClientRect().top - viewPad() - ($('.lib-bar')?.offsetHeight || 0) - 4;
  azBubble ||= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'az-bubble' }));
  azBubble.textContent = g; azBubble.hidden = false;
  clearTimeout(azTimer); azTimer = setTimeout(() => { azBubble.hidden = true; }, 700);
}
view.addEventListener('pointerdown', e => {
  const nav = e.target.closest('.az');
  if (!nav) return;
  e.preventDefault();
  nav.setPointerCapture(e.pointerId);
  let last = '';
  const at = ev => {
    const b = document.elementFromPoint(nav.getBoundingClientRect().left + nav.offsetWidth / 2, ev.clientY)?.closest('[data-az]');
    if (b && b.dataset.az !== last) { last = b.dataset.az; azJump(last); }
  };
  at(e);
  nav.onpointermove = at;
  nav.onpointerup = nav.onpointercancel = () => { nav.onpointermove = nav.onpointerup = nav.onpointercancel = null; };
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
    <h2>Canciones</h2>${rows(tracks)}
    <section class="kb" data-kb-artist="${esc(name)}"><h2>Sobre ${esc(name)}</h2>${kbWait}</section>`);
  const box = $('[data-kb-artist]');
  kb.artistInfo(name, { albums: albs.map(a => a.title), titles: tracks.slice(0, 3).map(t => t.title) }).then(d => {
    if (box.isConnected) setHTML(box, artistKB(d));
  });
}

// ----------------------------------------------- información de artistas y canciones (knowledge.js)
const kbArtist = n => (allTracks().some(t => artistsOf(t).includes(n)) ? `<a class="link" href="#/artista/${enc(n)}">${esc(n)}</a>` : esc(n));
const kbParas = text => String(text || '').split(/\n{2,}|\n(?=§ )/).map(x => x.trim()).filter(Boolean).map(x => {
  if (!x.startsWith('§ ')) return `<p>${esc(x).replace(/\n/g, '<br>')}</p>`;
  const [head, ...rest] = x.split('\n');          // «§ Subsección» y, debajo, su texto
  return `<h4>${esc(head.slice(2))}</h4>${rest.join('\n').trim() ? `<p>${esc(rest.join('\n').trim()).replace(/\n/g, '<br>')}</p>` : ''}`;
}).join('');
// Si una foto no carga, se quita (sin recuadro roto).
document.addEventListener('error', e => { if (e.target?.classList?.contains('kb-img')) e.target.remove(); }, true);
const kbBadge = (name, kind, lang) => `<span class="kb-badge ${kind === 'comunidad' ? 'comm' : 'ver'}" title="${kind === 'comunidad' ? 'Escrito por la comunidad de ese sitio: puede contener errores' : 'Fuente verificable'}">${esc(name)}${lang === 'en' && !/inglés/.test(name) ? ' · en inglés' : ''}</span>`;
const kbChips = chips => (chips?.length ? `<div class="kb-chips">${chips.map(c => `<span class="kb-chip">${icon(c.icon)}${esc(c.text)}</span>`).join('')}</div>` : '');
const kbFactList = list => `<dl class="kb-facts">${list.map(f => `<div><dt>${esc(f.label)}</dt><dd>${f.values.map(esc).join(' · ')}${f.more ? ` <span class="muted">y ${f.more} más</span>` : ''}</dd></div>`).join('')}</dl>`;
const kbStories = new Map();   // historias que se abren en una hoja
let kbSeq = 0;
function kbStoryCards(list) {
  if (!list?.length) return '';
  return `<h3 class="kb-h">${icon('spark')}Historias y curiosidades</h3><div class="kb-stories">${list.map(x => {
    const k = 's' + (++kbSeq); kbStories.set(k, x);
    const first = x.text.replace(/§[^\n]*\n?/g, '').split(/\n{2,}/).find(p => p.trim().length > 30) || x.text;
    return `<button class="kb-story" data-act="kb-story" data-k="${k}">${kbBadge(x.source, x.kind, x.lang)}<b>${esc(x.title)}</b><span class="kb-excerpt">${esc(first.trim())}</span><span class="kb-more">Leer ${icon('chevR')}</span></button>`;
  }).join('')}</div>`;
}
function openStory(k) {
  const x = kbStories.get(k);
  if (!x) return;
  openSheet(`<div class="dlg kb-sheet kb-story-sheet"><div class="kb-card-head">${kbBadge(x.source, x.kind, x.lang)}</div><h3>${esc(x.title)}</h3>
    ${x.kind === 'comunidad' ? '<p class="kb-warn">Escrito por la comunidad de ese sitio: puede contener errores.</p>' : ''}
    <div class="kb-text">${kbParas(x.text)}</div>
    <div class="actions"><a class="btn ghost" href="${esc(x.url)}" target="_blank" rel="noopener">${icon('compass')}Ver en ${esc(x.source)}</a><button class="btn" data-x>Cerrar</button></div></div>`,
  e => { if (e.target.closest('[data-x]')) sheet.close(); });
}
const kbSourcesHTML = sources => (sources?.length ? `<footer class="kb-src"><div class="kb-src-list"><span>Fuentes</span>${sources.map(x => `<a class="kb-badge ${x.kind === 'comunidad' ? 'comm' : 'ver'}" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join('')}</div>
  <small><span class="kb-dot ver"></span>Verificable (Wikidata y Wikipedia; el texto de Wikipedia es <a class="link" href="https://creativecommons.org/licenses/by-sa/4.0/deed.es" target="_blank" rel="noopener">CC BY-SA 4.0</a>) · <span class="kb-dot comm"></span>Comunidad: lo escriben usuarios de esos sitios y puede contener errores.</small></footer>` : '');
const kbStatus = (d, what) => `<div class="kb-empty">${icon('note')}<p>${({
  offline: 'Sin conexión: esta información se consulta en internet.',
  error: `No se pudo consultar ahora${d.message ? ` (${esc(d.message)})` : ''}. Inténtalo más tarde.`,
  none: `No se ha encontrado información sobre ${what}.`,
}[d.status] || '')}</p></div>`;
function artistKB(d) {
  if (d.status !== 'ok') return kbStatus(d, 'este artista');
  const bioParas = (d.bio?.text || '').split(/\n{2,}/).filter(Boolean);
  const restHTML = bioParas.slice(2).length || d.bio?.rest?.length
    ? `<details class="kb-more-text"><summary>Leer la biografía completa</summary>${kbParas(bioParas.slice(2).join('\n\n'))}${(d.bio.rest || []).map(x => `<h4>${esc(x.title)}</h4>${kbParas(x.text)}`).join('')}</details>` : '';
  const now = d.members.filter(m => m.current), past = d.members.filter(m => !m.current);
  const memberChips = list => list.map(m => `<span class="kb-member">${icon('user')}<span>${kbArtist(m.name)}${m.begin || m.end ? `<small>${esc(m.begin || '?')}–${esc(m.end || 'hoy')}</small>` : ''}</span></span>`).join('');
  return `<div class="kb-hero${d.banner ? ' has-bg' : ''}">${d.banner ? `<img class="kb-img kb-bg" src="${esc(d.banner)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      ${d.photo ? `<img class="kb-img kb-avatar" src="${esc(d.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      <div class="kb-hero-text"><span class="kb-kicker">Sobre el artista</span><h2>${esc(d.name)}</h2>${d.description ? `<p>${esc(d.description)}</p>` : ''}</div></div>
    ${kbChips(d.chips)}
    ${d.guess ? `<p class="kb-warn">Hay ${d.guess} artistas con este nombre; se muestra el más conocido.</p>` : ''}
    ${d.bio ? `<article class="kb-card kb-bio"><div class="kb-card-head"><h3>Biografía</h3>${kbBadge(d.bio.source, d.bio.community ? 'comunidad' : 'verificable', d.bio.lang)}</div>
      ${kbParas(bioParas.slice(0, 2).join('\n\n'))}${restHTML}</article>` : ''}
    ${kbStoryCards(d.stories)}
    ${d.facts.length || d.members.length ? `<div class="kb-grid">
      ${d.facts.length ? `<article class="kb-card"><div class="kb-card-head"><h3>Datos</h3>${kbBadge('Wikidata', 'verificable')}</div>${kbFactList(d.facts)}</article>` : ''}
      ${d.members.length ? `<article class="kb-card"><h3>${d.group ? 'Miembros' : 'Grupos'}</h3><div class="kb-members">${memberChips(now)}</div>${past.length ? `<h4>Antiguos miembros</h4><div class="kb-members">${memberChips(past)}</div>` : ''}</article>` : ''}</div>` : ''}
    ${d.links.length ? `<div class="kb-links">${d.links.map(l => `<a class="btn sm" href="${esc(l.url)}" target="_blank" rel="noopener">${icon('compass')}${esc(l.label)}</a>`).join('')}</div>` : ''}
    ${!d.bio && !d.stories.length && !d.facts.length ? '<div class="kb-empty"><p>Solo se ha encontrado su ficha, sin biografía ni historias.</p></div>' : ''}
    ${kbSourcesHTML(d.sources)}`;
}
function songKB(d, t) {
  if (d.status !== 'ok') return kbStatus(d, 'esta canción (es normal en las menos conocidas)');
  return `<div class="kb-song-head">${t ? cover(t) : ''}<div><span class="kb-kicker">Sobre la canción</span><h2>${esc(d.title)}</h2><p>${esc(d.artist)}</p></div></div>
    ${kbChips(d.chips)}
    ${kbStoryCards(d.stories)}
    ${d.credits.length || d.facts.length ? `<div class="kb-grid">
      ${d.credits.length ? `<article class="kb-card"><div class="kb-card-head"><h3>Créditos</h3>${kbBadge('Wikidata', 'verificable')}</div>${kbFactList(d.credits)}</article>` : ''}
      ${d.facts.length ? `<article class="kb-card"><div class="kb-card-head"><h3>Datos</h3>${kbBadge('Wikidata', 'verificable')}</div>${kbFactList(d.facts)}</article>` : ''}</div>` : ''}
    ${!d.stories.length ? '<div class="kb-empty"><p>No hay historias sobre esta canción en estas fuentes.</p></div>' : ''}
    ${kbSourcesHTML(d.sources)}`;
}
const songQuery = t => ({ title: t.title, artist: artistsOf(t)[0] || t.artist || '', album: t.album || '' });
const kbWait = '<p class="muted kb-wait"><span class="spinner"></span>Buscando información…</p>';
function songSheet(t) {
  openSheet(`<div class="dlg kb-sheet"><div class="kb" data-kb-song>${kbWait}</div>
    <div class="actions"><button class="btn" data-x>Cerrar</button></div></div>`, e => { if (e.target.closest('[data-x]')) sheet.close(); });
  kb.songInfo(songQuery(t)).then(d => { const box = $('[data-kb-song]', sheet); if (box && sheet.open) setHTML(box, songKB(d, t)); });
}

// ----------------------------------------------------------------- playlists
const newPlaylist = t => PL.newPlaylist(t);
const addToPlaylist = t => PL.addToPlaylist(t);

// ------------------------------------------------------------------ explorar
// Explorar vive en explore-ui.js (Para ti, Música libre, Radios y experiencias).
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
  let n = 0;
  for (const t of tracks) if (!inLibrary(t)) { await saveTrack({ ...t, addedAt: Date.now() }); n++; }
  if (n) emit('library-added', n);
  emit('library');
}

// ------------------------------------------------------------------- ajustes
let installEvent = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; if (location.hash.startsWith('#/ajustes')) refresh(); });
// Secciones de Ajustes: [ruta, icono, título, tono del icono].
const SET_SECS = [['cuenta', 'user', 'Cuenta', 25], ['nube', 'cloud', 'Nube', 200], ['audio', 'wave', 'Audio y reproducción', 330], ['dispositivo', 'download', 'Este dispositivo', 150],
  ['criatura', 'spark', 'Criatura sonora', 45], ['desarrollador', 'edit', 'Modo desarrollador', 260], ['ayuda', 'help', 'Ayuda', 175]];
let helpPath = null;   // camino elegido en la guía del bucket («own» o «guest»)
async function viewSettings(sec) {
  const est = await lib.storageEstimate();
  const tracks = everyTrack();
  const offline = tracks.filter(t => t.hasBlob).length;
  const onlyLocal = tracks.filter(t => t.hasBlob && !t.cloudName && !t.url).length;
  const inCloud = tracks.filter(t => t.cloudName).length;
  const sum = recs.summary();
  const dev = devOn();
  const A = aiConf(), prov = ai.PROVIDERS[A.provider], savedKey = A.keys[A.provider], aiKey = savedKey ? (savedKey.hint || String(savedKey).slice(-4) || '····') : '', aiModel = A.models[A.provider] || '';
  const aiReady = aiIsReady();
  const presets = S.settings.genrePresets || [];
  const untagged = tracks.filter(needsTags).length;
  const coverless = tracks.filter(needsCover).length;
  const albumless = tracks.filter(albumPending).length, albumTried = tracks.filter(t => needsAlbum(t) && t.albumTried).length;
  const pendingFiles = dev ? tracks.filter(fileOutdated) : [];
  const writable = pendingFiles.filter(cloud.canWriteFile);
  const dups = dev ? lib.findDuplicates(dupKeep) : [], extra = dups.reduce((n, g) => n + g.tracks.length - 1, 0);
  const gb = n => (n / 1073741824).toFixed(n > 1073741824 * 10 ? 0 : 2);
  const bks = cloud.buckets(), target = cloud.uploadTarget();
  const O = S.settings.oci, own = cloud.ownedBuckets();
  const keySteps = `<ol class="steps"><li>En la consola de Oracle Cloud: icono de tu perfil (arriba a la derecha) → <b>Mi perfil</b> → <b>Claves API</b> (<i>API keys</i>) → <b>Agregar clave API</b>.</li>
        <li>Elige <b>Generar par de claves API</b>, pulsa <b>Descargar clave privada</b> y después <b>Agregar</b>.</li>
        <li>Copia el texto de la <b>vista previa del archivo de configuración</b> y pégalo aquí. Luego elige el archivo .pem que has descargado.</li></ol>
      <form class="stack" data-form="oci">
        <label class="field area">${icon('lock')}<textarea name="config" rows="5" spellcheck="false" autocomplete="off" placeholder="[DEFAULT]&#10;user=ocid1.user.oc1..…&#10;fingerprint=…&#10;tenancy=ocid1.tenancy.oc1..…&#10;region=…" required></textarea></label>
        <label class="field">${icon('folder')}<input name="pem" type="file" accept=".pem,.key,text/plain" aria-label="Archivo de la clave privada (.pem)" required></label>
        <div class="actions"><button class="btn primary">Guardar y comprobar</button></div></form>`;
  const keyPanel = O
    ? `<p>Guardada en este dispositivo (huella …${esc(O.fingerprint.slice(-5))}). ${own.length ? `Tiene permiso sobre ${own.map(b => `«${esc(b.name)}»`).join(', ')}: puedes subir, cambiar y compartir su música.` : 'No tiene permiso sobre ninguno de los buckets conectados.'}</p>
      <div class="actions">${own.length ? `<button class="btn" data-act="oci-purge">${icon('trash')}Borrar los archivos que quedaron vacíos</button>` : `<button class="btn" data-act="oci-recheck">${icon('sync')}Volver a comprobar</button>`}<button class="btn ghost danger" data-act="oci-forget">Quitar clave</button></div>`
    : `<p>Solo para <b>quien creó el bucket</b>. Permite subir música, cambiar los archivos, compartir y usar el modo desarrollador. Se guarda solo en este dispositivo (nunca en tu cuenta ni en el bucket) y tiene los permisos de tu usuario de Oracle: añádela solo en dispositivos tuyos.</p>
      ${bks.length ? `<details class="more key-steps"><summary>Añadir la clave de API de Oracle</summary>${keySteps}</details>` : `<p class="muted">Primero conecta tu bucket en <a class="link" href="#/ajustes/nube">Nube</a>.</p>`}`;
  const steps = `<ol class="steps"><li>En la consola de Oracle Cloud: <b>Storage → Buckets → Create Bucket</b> (privado).</li>
       <li>Dentro del bucket: <b>Pre-Authenticated Requests → Create</b>. Destino: <b>Bucket</b>; acceso: <b>Permit object reads and writes</b>; marca <b>Enable Object Listing</b>; pon una caducidad lejana.</li>
       <li>Copia la URL que aparece (solo se muestra una vez) y pégala aquí. Es solo para tus dispositivos: <b>no la compartas</b>.</li></ol>`;
  const bucketForm = `<form class="stack" data-form="par">
       <label class="field">${icon('edit')}<input name="name" placeholder="Nombre (p. ej. Rock, Clásica, Música de Ana)" autocomplete="off" maxlength="40"></label>
       <label class="field">${icon('cloud')}<input name="url" type="url" placeholder="https://objectstorage.….oraclecloud.com/p/…/n/…/b/…/o/" autocomplete="off" required></label>
       <div class="actions"><button class="btn ${bks.length ? '' : 'primary'}">${icon('plus')}Conectar bucket</button></div></form>`;
  const shareBox = b => `<section class="panel share-box"><h2>Compartir «${esc(b.name)}»</h2>
       <p>Un enlace de <b>solo lectura</b> para cada persona (como mucho ${oci.MAX_SHARES} a la vez): puede escuchar y descargar, pero no subir, cambiar ni borrar. Sus playlists y escuchas van a su cuenta, nunca al bucket. Puedes revocarlo cuando quieras.</p>
       <ul class="buckets shares" data-shares="${esc(b.id)}"><li class="muted">Cargando enlaces…</li></ul>
       <form class="stack" data-form="share" data-bid="${esc(b.id)}">
         <label class="field">${icon('user')}<input name="who" placeholder="Para quién (p. ej. Ana)" autocomplete="off" maxlength="40" required></label>
         <label class="field">${icon('lock')}<select name="days" aria-label="Caducidad del enlace"><option value="30">Caduca en 1 mes</option><option value="90">Caduca en 3 meses</option><option value="180" selected>Caduca en 6 meses</option><option value="365">Caduca en 1 año</option></select></label>
         <div class="actions"><button class="btn">${icon('plus')}Crear enlace de solo lectura</button>${groups.of(b.id)?.owner ? `<button type="button" class="btn ghost" data-act="group-rotate" data-bid="${esc(b.id)}">${icon('sync')}Renovar el grupo</button>` : ''}</div></form></section>`;
  const urlNote = `<p class="muted small">La URL de tu bucket funciona como una contraseña: quien la tenga puede leer y escribir en él. ${account.user() ? 'Se guarda en este dispositivo y en tu cuenta.' : 'Fiora la guarda solo en este dispositivo.'} Para compartir tu música no la des: crea enlaces de solo lectura.</p>`;
  const cloudPanel = bks.length
    ? `<section class="panel"><h2>Tus buckets</h2><p>${plural(inCloud, 'canción', 'canciones')} en la nube${S.settings.lastSync ? ` · última sincronización: ${new Date(S.settings.lastSync).toLocaleString('es')}` : ''}.</p>
       <ul class="buckets">${bks.map(b => {
         const n = tracks.filter(t => t.cloudName && (t.bucketId || bks[0].id) === b.id).length;
         const mine = cloud.owns(b), isTarget = !!target && b.id === target.id;
         const g = groups.of(b.id), grp = g?.status === 'ok' ? ` · grupo de ${plural(g.members || 1, 'persona', 'personas')}` : '';
         return `<li><span class="badge-ic">${icon(mine ? 'cloud' : 'lock')}</span><span class="row-text"><b>${esc(b.name)}</b><small>${plural(n, 'canción', 'canciones')} · ${mine ? 'tuyo' : 'solo lectura'}${grp}${isTarget && own.length > 1 ? ' · las subidas van aquí' : ''}</small></span>
           ${mine && !isTarget ? `<button class="chip" data-act="bucket-default" data-bid="${esc(b.id)}">Subir aquí</button>` : ''}
           <button class="icon-btn" data-act="bucket-remove" data-bid="${esc(b.id)}" aria-label="Desconectar ${esc(b.name)}">${icon('x')}</button></li>`;
       }).join('')}</ul>
       ${own.length < bks.length ? `<p class="muted small">${own.length ? 'En los buckets de solo lectura (de otra persona, o sobre los que tu clave no tiene permiso) no se sube, cambia ni borra nada.' : 'Aquí la nube es de solo lectura: escuchas y descargas, pero no se sube ni se cambia nada. Si el bucket es tuyo, añade su clave en <a class="link" href="#/ajustes/desarrollador">Modo desarrollador</a>.'}</p>` : ''}
       <div class="actions"><button class="btn primary" data-act="cloud-sync">${icon('sync')}Sincronizar ahora</button>
       ${onlyLocal && target ? `<button class="btn" data-act="cloud-upload-all">${icon('cloudUp')}Subir ${plural(onlyLocal, 'canción', 'canciones')}${own.length > 1 ? ` a «${esc(target.name)}»` : ' a la nube'}</button>` : ''}</div>
       ${groupsPanel()}</section>
       ${own.length || dev ? `<section class="panel"><h2>Archivos</h2>
         ${own.length ? `<label class="switch first"><input type="checkbox" data-toggle="shrink" ${S.settings.shrink ? 'checked' : ''}><span><b>Reducir el tamaño al subir, sin perder calidad</b>
           <small>Los WAV se convierten a FLAC: suenan igual y ocupan en torno a la mitad. El resto se sube tal cual.</small></span></label>` : ''}
         ${dev ? `<div class="sub-panel"><b>Metadatos de los archivos</b>
           <small>Escribe dentro de cada archivo de tus buckets los géneros, lo que transmite y los cambios hechos en la app. Primero revisa qué archivos lo necesitan; el sonido no cambia.</small>
           <div class="actions">${bulk ? `<button class="btn danger" data-act="cloud-tags-stop">${icon('x')}Detener</button>` : `<button class="btn" data-act="cloud-tags">${icon('sync')}Actualizar archivos de la nube</button>`}${lastReport && !bulk ? '<button class="btn ghost" data-act="cloud-report">Ver el último informe</button>' : ''}</div></div>` : ''}</section>` : ''}
       ${own.map(shareBox).join('')}
       <section class="panel"><details class="more flat"><summary>Conectar otro bucket</summary><p>Puedes tener varios buckets conectados a la vez; su música aparece junta en tu biblioteca. Pega la URL de tu bucket o el enlace de solo lectura que te hayan dado.</p>${bucketForm}
         <p class="muted small">¿No sabes de dónde sale la URL? Mira la <a class="link" href="#/ajustes/ayuda">guía paso a paso</a>.</p></details></section>`
    : `<a class="set-hero" href="#/ajustes/ayuda"><span class="set-ic" style="--h:175">${icon('help')}</span><span class="row-text"><b>¿Primera vez? Sigue la guía</b><small>Guarda tu música en un bucket de Oracle Cloud y escúchala desde cualquier dispositivo. Te lo explicamos paso a paso.</small></span>${icon('chevR')}</a>
       <section class="panel"><h2>Conectar un bucket</h2><p>Pega la URL de tu bucket o el enlace de solo lectura que alguien te haya dado.</p>${bucketForm}
       <details class="more flat"><summary>¿Cómo consigo la URL?</summary>${steps}</details>${urlNote}</section>`;
  const u = account.user();
  const accountPanel = u
    ? `<p>Has iniciado sesión como <b>${esc(u.email)}</b>. Tus playlists, favoritos, estadísticas, emisoras, ajustes y la conexión a la nube se guardan en tu cuenta${S.settings.accountSync ? ` · último guardado: ${new Date(S.settings.accountSync).toLocaleString('es')}` : ''}.</p>
       <p class="pl-account">Playlists: ${PL.syncChip()}</p>
       ${pldata.status().mode === 'missing' ? `<div class="sub-panel"><b>Falta preparar Supabase para las playlists</b>
         <small>Las playlists se siguen guardando como hasta ahora. La base de datos de la cuenta aún no está preparada para guardarlas con portadas, fotos, capítulos, notas y estadísticas. No se pierde nada.</small>
         <div class="actions"><button class="btn" data-act="pl-retry">${icon('sync')}Volver a comprobar</button></div></div>` : ''}
       <p class="pl-account">Explorar (emisoras favoritas, colecciones y pasaporte): ${exploreChip()}</p>
       ${rdata.status().mode === 'missing' ? `<div class="sub-panel"><b>Falta preparar Supabase para Explorar</b>
         <small>Tus emisoras favoritas, colecciones, pasaporte y preferencias se guardan en este dispositivo, porque la base de datos de la cuenta aún no está preparada para ellas. No se pierde nada.</small>
         <div class="actions"><button class="btn" data-act="explore-retry">${icon('sync')}Volver a comprobar</button></div></div>` : ''}
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
  const devSection = `<section class="panel"><h2>Clave de API de Oracle</h2>${keyPanel}</section>
    <section class="panel"><h2>Edición</h2>
      <label class="switch first${devReady() ? '' : ' disabled'}"><input type="checkbox" data-toggle="dev" ${dev ? 'checked' : ''} ${devReady() ? '' : 'disabled'}><span><b>Editar metadatos de las canciones</b>
        <small>${devReady() ? 'Añade «Editar metadatos» al menú ⋯ de cada canción: portada, título, artistas, álbum, géneros y lo que transmite. Los cambios se guardan en tu cuenta y en los archivos de tus buckets.' : 'Necesita la clave de API de Oracle con permiso sobre un bucket conectado.'}</small></span></label></section>
    ${dev ? `<section class="panel"><h2>Canciones repetidas</h2>
        <p>${dups.length ? `${plural(dups.length, 'canción tiene', 'canciones tienen')} más de una copia (mismo título y mismos artistas): ${plural(extra, 'copia sobra', 'copias sobran')}.` : 'No hay canciones repetidas en tu biblioteca.'}
          Borrar una canción en modo desarrollador la elimina también de su bucket.</p>
        ${dups.length ? `<div class="actions"><a class="btn" href="#/repetidas">${icon('list')}Ver canciones repetidas</a></div>` : ''}</section>
      <section class="panel"><h2>Metadatos en los archivos</h2>
        <p>Al guardar en el editor, los cambios se escriben dentro del archivo (MP3, FLAC y M4A) y, si está en la nube, se sube actualizado. El sonido no cambia.
          ${writable.length ? `Hay ${plural(writable.length, 'canción', 'canciones')} con cambios que aún no están en su archivo.` : 'Todos los cambios están ya en los archivos.'}
          ${pendingFiles.length > writable.length ? `${plural(pendingFiles.length - writable.length, 'canción', 'canciones')} solo ${pendingFiles.length - writable.length === 1 ? 'guarda' : 'guardan'} los cambios en la app (formato OGG, WAV u Opus, música libre o sin acceso al archivo).` : ''}</p>
        ${writable.length ? `<div class="actions"><button class="btn" data-act="write-files">${icon('sync')}Guardar en ${plural(writable.length, 'archivo', 'archivos')}</button></div>` : ''}</section>
      <section class="panel"><h2>Géneros predefinidos</h2>
        <p>El editor ofrece una lista de géneros habituales. Aquí puedes añadir los tuyos.</p>
        ${presets.length ? `<div class="chips">${presets.map(g => `<button class="chip" data-act="preset-remove" data-g="${esc(g)}" aria-label="Quitar ${esc(g)}">${esc(g)} ✕</button>`).join('')}</div>` : ''}
        <form class="search" data-form="preset-add"><label class="field">${icon('plus')}<input name="g" placeholder="Nuevo género (p. ej. Indie Español)" autocomplete="off" maxlength="40" required></label><button class="btn">Añadir</button></form></section>
      <section class="panel"><h2>Etiquetado con IA</h2>
        <p>Un modelo de IA propone los géneros y lo que transmite cada canción, y ayuda a encontrar portadas. Elige el servicio y pega su clave: tiene coste por uso y se guarda cifrada, solo en este dispositivo.</p>
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
          ${prov.site ? `<small class="muted">La clave se crea en ${prov.site}.${prov.help ? ` ${esc(prov.help)}` : ''}</small>` : '<small class="muted">Vale cualquier servicio con API compatible con la de OpenAI (OpenRouter, Groq, Mistral, un modelo local…), siempre que admita llamadas desde el navegador.</small>'}</form>
        ${aiReady ? `<div class="sub-panel ai-all"><b>Completarlo todo</b><small>${untagged || coverless || albumless ? `Busca el álbum, después la portada y al final los géneros de las que les falte (${[albumless && `${albumless} sin álbum`, coverless && `${coverless} sin portada`, untagged && `${untagged} sin etiquetar`].filter(Boolean).join(' · ')}), y lo guarda todo en los archivos.` : 'No falta nada por completar.'}</small>
          <div class="actions"><button class="btn primary" data-act="ai-all" ${untagged || coverless || albumless ? '' : 'disabled'}>${icon('spark')}Completarlo todo con IA</button></div></div>
          <small class="muted">O cada cosa por separado:</small>
          <div class="actions" style="margin-top:8px"><button class="btn" data-act="ai-tag-all" ${untagged ? '' : 'disabled'}>${icon('spark')}${untagged ? `Etiquetar ${plural(untagged, 'canción', 'canciones')} sin etiquetar` : 'Todas las canciones están etiquetadas'}</button>
          <button class="btn" data-act="ai-covers" ${coverless ? '' : 'disabled'}>${icon('disc')}${coverless ? `Buscar portada de ${plural(coverless, 'canción', 'canciones')} sin portada` : 'No quedan canciones sin portada por buscar'}</button>
          <button class="btn" data-act="ai-albums" ${albumless ? '' : 'disabled'}>${icon('library')}${albumless ? `Buscar álbum de ${plural(albumless, 'canción', 'canciones')} sin álbum` : 'No quedan canciones sin álbum por buscar'}</button></div>
          ${albumTried ? `<small class="muted">${plural(albumTried, 'canción', 'canciones')} sin álbum ya se ${albumTried === 1 ? 'buscó' : 'buscaron'} sin encontrarlo; puedes reintentarlo desde su menú ⋯ → «Buscar álbum».</small>` : ''}
          <details class="more flat"><summary>Cómo se buscan las portadas</summary><p>Se buscan con los datos de cada canción en Apple (iTunes), YouTube Music (a través de Piped) y MusicBrainz (Cover Art Archive), gratuitos y sin clave; la IA solo ayuda con las que no aparecen. Si el disco no tiene portada, se usa la de otra canción del mismo álbum o artista y, si no, se genera una con el título: ninguna se queda sin portada. Las portadas se escriben en el archivo y se suben a la nube junto con los metadatos.</p></details>` : ''}</section>` : ''}`;
  const sects = SET_SECS.map(([id, ic, title, hue]) => ({ id, ic, title, hue, sum: {
    cuenta: u ? `Sesión iniciada · ${esc(u.email)}` : account.available() ? 'Sin sesión: tus datos están solo en este dispositivo' : 'Sin cuentas configuradas',
    nube: bks.length ? `${plural(bks.length, 'bucket', 'buckets')} · ${plural(inCloud, 'canción', 'canciones')}` : 'Sin conectar',
    audio: `${fades.settings().mode === 'cross' ? 'Mezcla cruzada' : 'Una tras otra'} · audio espacial ${spatial.settings().on ? 'activado' : 'desactivado'}`,
    dispositivo: `${plural(offline, 'canción', 'canciones')} sin conexión${est.quota && est.usage > 1e7 ? ` · ${gb(est.usage)} GB usados` : ''}`,
    criatura: habits.prefs().off ? 'Desactivada' : 'Activada',
    desarrollador: dev ? 'Activado' : devReady() ? 'Desactivado' : 'Necesita la clave de API de Oracle',
    ayuda: bks.length ? 'Guía del bucket y preguntas frecuentes' : 'Crea y conecta tu bucket paso a paso',
  }[id] }));
  const row = (s, side) => `<a class="set-row" href="#/ajustes/${s.id}" data-sec="${s.id}" ${side && s.id === sec ? 'aria-current="page"' : ''}><span class="set-ic" style="--h:${s.hue}">${icon(s.ic)}</span>
      <span class="row-text"><b>${s.title}</b>${side ? '' : `<small>${s.sum}</small>`}</span>${side ? '' : icon('chevR')}</a>`;
  const credits = '<p class="muted set-credits">Fiora · Letras de LRCLIB · Música libre de Internet Archive, Openverse, Wikimedia Commons y Jamendo · Radios de Radio Browser</p>';
  const cur = sects.find(s => s.id === sec);
  if (!cur) {
    const group = (title, ids) => `<section class="set-group"><h3>${title}</h3><nav class="set-list">${sects.filter(s => ids.includes(s.id)).map(s => row(s)).join('')}</nav></section>`;
    return show(`<div class="head"><a class="icon-btn" href="#/perfil" aria-label="Volver al perfil">${icon('back')}</a><h1>Ajustes</h1></div>
      <div class="set-index">
      ${bks.length ? '' : `<a class="set-hero" href="#/ajustes/ayuda"><span class="set-ic" style="--h:200">${icon('cloud')}</span><span class="row-text"><b>Conecta tu música en unos minutos</b><small>Una guía paso a paso para crear tu bucket gratuito en Oracle Cloud y conectarlo, o para usar el que alguien ha compartido contigo.</small></span>${icon('chevR')}</a>`}
      ${group('Tu cuenta', ['cuenta', 'nube'])}
      ${group('Escucha', ['audio', 'dispositivo', 'criatura'])}
      <section class="set-group"><h3>Avanzado</h3><nav class="set-list">${row(sects.find(s => s.id === 'desarrollador'))}
        <a class="set-row" href="#/perfil"><span class="set-ic" style="--h:280">${icon('chart')}</span><span class="row-text"><b>Tus estadísticas</b><small>Están en tu perfil, junto a tu criatura sonora</small></span>${icon('chevR')}</a></nav></section>
      ${group('Ayuda', ['ayuda'])}
      ${credits}</div>`);
  }
  const P_ = (title, body, extra = '') => `<section class="panel"${extra}>${title ? `<h2>${title}</h2>` : ''}${body}</section>`;
  const body = {
    cuenta: () => P_('', accountPanel),
    nube: () => cloudPanel,
    audio: () => `<div id="ajustes-audio">${P_('Reproducción', `<label class="switch first"><input type="checkbox" data-toggle="autoplay" ${S.settings.autoplay === false ? '' : 'checked'}><span><b>Reproducción automática</b>
        <small>Cuando se acaba lo que estás escuchando, sigue con canciones parecidas de tu biblioteca.</small></span></label>`)}
      ${fadesPanel()}${spatialPanel()}</div>`,
    dispositivo: () => P_('Almacenamiento', `<p>${plural(tracks.length, 'canción', 'canciones')} en la biblioteca · ${offline} disponibles sin conexión.</p>
      ${est.quota ? `<div class="meter"><i style="width:${Math.min(100, (est.usage / est.quota) * 100).toFixed(1)}%"></i></div><small class="muted">${gb(est.usage)} GB usados de ${gb(est.quota)} GB disponibles para la app</small>` : ''}
      <div class="actions" style="margin-top:14px">${ADD_BTN}${installEvent ? `<button class="btn" data-act="install">${icon('download')}Instalar como app</button>` : ''}</div>`),
    criatura: () => PF.settingsPanel(),
    desarrollador: () => devSection,
    ayuda: () => helpSection({ u, bks, own, O, inCloud, keySteps, bucketForm }),
  }[sec]();
  // Si se vuelve a pintar la misma sección (p. ej. al terminar una sincronización) mientras escribes en
  // un formulario, no se pinta: se perdería lo escrito o el archivo elegido. Lo desplegado se conserva.
  const prev = $(`.set-body[data-set="${sec}"]`);
  if (prev && [...$$('[data-form]:not([data-sent]) :is(input, textarea)', prev)].some(f => (f.type === 'file' ? f.files.length : f.value !== f.defaultValue))) return;
  const opened = prev ? [...$$('details', prev)].map(d => d.open) : null;
  show(`<div class="head"><a class="icon-btn" href="#/ajustes" aria-label="Volver a Ajustes">${icon('back')}</a><h1>${cur.title}</h1></div>
    <div class="set-wrap"><nav class="set-side" aria-label="Secciones de Ajustes">${sects.map(s => row(s, true)).join('')}</nav>
    <div class="set-body" data-set="${sec}">${body}${sec === 'ayuda' ? credits : ''}</div></div>`);
  if (opened) $$(`.set-body[data-set="${sec}"] details`).forEach((d, i) => { if (opened[i] && !d.closest('.tuto-step')) d.open = true; });
  if (sec === 'nube') loadShares();
}
// Audio espacial (8D): toda su configuración vive aquí; no hay controles en ninguna otra pantalla.
const SPATIAL_WHY = { ok: 'se está procesando con el efecto', apagado: 'audio original (el efecto está desactivado)', radio: 'audio original: las emisoras nunca se procesan', explorar: 'audio original: no es una canción de tu biblioteca',
  cors: 'audio original: el servidor de esta canción no permite procesarla', contexto: 'audio original: el navegador no dejó iniciar el procesamiento', error: 'audio original: esta canción no se pudo procesar', 'sin-webaudio': 'audio original: este navegador no admite el procesamiento' };
// Fundidos y transiciones entre canciones (todo apagado por defecto).
const secs = v => `${String(+v.toFixed(1)).replace('.', ',')} s`;
const fxSecsText = (k, v) => (k === 'cross' ? `Las dos canciones suenan a la vez durante ${secs(v)}.` : v ? `${k === 'fadeIn' ? 'Sube' : 'Baja'} el volumen durante ${secs(v)}.` : 'Sin fundido.');
function fadesPanel() {
  const f = fades.settings(), ok = fades.volumeControl(), dis = ok ? '' : 'disabled';
  const range = (k, label, min, max, step) => `<label class="lbl">${label} <b data-fx-val="${k}">${secs(f[k])}</b>
      <input type="range" class="sp-range" data-fx="${k}" min="${min}" max="${max}" step="${step}" value="${f[k]}" style="--p:${((f[k] - min) / (max - min)) * 100}%" ${dis} ${k === 'cross' && f.mode !== 'cross' ? 'disabled' : ''} aria-label="${label}">
      <small data-fx-text="${k}">${fxSecsText(k, f[k])}</small></label>`;
  return `<section class="panel"><h2>Transiciones y fundidos</h2>
      <p>Cómo empieza, termina y pasa de una canción a otra. Las emisoras de radio solo usan el fundido al pausar.</p>
      ${ok ? '' : '<p class="note-box">Este navegador no deja que la página cambie el volumen (pasa en iPhone y iPad), así que los fundidos y la mezcla cruzada no se pueden aplicar aquí. Tus ajustes se guardan para tus otros dispositivos.</p>'}
      <div class="sp-controls" data-fx-box>
        <label class="lbl">Transición entre canciones<span class="field"><select data-fx="mode" ${dis}>
          <option value="normal" ${f.mode === 'normal' ? 'selected' : ''}>Una tras otra</option>
          <option value="cross" ${f.mode === 'cross' ? 'selected' : ''}>Mezcla cruzada</option></select></span>
          <small>${f.mode === 'cross' ? 'El final de cada canción se funde con el principio de la siguiente.' : 'Cada canción empieza cuando acaba la anterior (con los fundidos de abajo, si los pones).'}</small></label>
        ${range('cross', 'Duración de la mezcla', 1, 12, 0.5)}
        ${range('fadeIn', 'Fundido de entrada', 0, 10, 0.5)}
        ${range('fadeOut', 'Fundido de salida', 0, 10, 0.5)}
      </div>
      <label class="switch${ok ? '' : ' disabled'}"><input type="checkbox" data-fx="pause" ${f.pause ? 'checked' : ''} ${dis}><span><b>Suavizar pausa y reanudación</b>
        <small>Un fundido corto al pausar y al volver a reproducir, en vez de un corte.</small></span></label>
      <label class="switch${ok ? '' : ' disabled'}"><input type="checkbox" data-fx="manual" ${f.manual ? 'checked' : ''} ${dis}><span><b>Mezclar también al saltar de canción</b>
        <small>Al pulsar siguiente o anterior, o al elegir otra canción, la que suena se desvanece en vez de cortarse${f.mode === 'cross' ? ` (con un solape de hasta ${fades.MANUAL_MAX} s)` : ' (durante 1 s)'}.</small></span></label>
      <p class="muted small" style="margin:10px 0 0">En canciones muy cortas los fundidos nunca ocupan más del 40 % de su duración.</p>
      <div class="actions" style="margin-top:12px"><button class="btn ghost" data-act="fx-reset">${icon('sync')}Restaurar transiciones</button></div></section>`;
}
async function setFx(patch) {
  S.settings.fx = fades.settings({ ...fades.settings(), ...patch });
  S.settings.fxAt = Date.now();
  await saveKV('settings', false);
  emit('dirty');
}
on('fx-changed', () => { if (location.hash.startsWith('#/ajustes')) refresh(); });

function spatialPanel() {
  const sp = spatial.settings(), ok = spatial.supported(), st = spatial.status(), off = ok && sp.on ? '' : 'disabled';
  return `<section class="panel"><h2>Audio espacial (8D)</h2>
      <p>Crea una sensación de movimiento del sonido al escuchar canciones de tu biblioteca. Se recomienda utilizar auriculares.</p>
      <label class="switch${ok ? '' : ' disabled'}"><input type="checkbox" data-sp="on" ${sp.on && ok ? 'checked' : ''} ${ok ? '' : 'disabled'}><span><b>Activar audio espacial</b>
        <small>${ok ? 'Se aplica al vuelo, solo a las canciones de tu biblioteca. No cambia tus archivos, y las emisoras de radio y la música de Explorar suenan siempre como son.' : 'Este navegador no admite el procesamiento de audio necesario.'}</small></span></label>
      <div class="sp-controls">
        <label class="lbl">Modo<span class="field"><select data-sp="mode" ${off}>${Object.entries(spatial.MODES).map(([k, v]) => `<option value="${k}" ${k === sp.mode ? 'selected' : ''}>${v}</option>`).join('')}</select></span>
          <small data-sp-desc>${{ suave: 'El sonido se desplaza despacio entre izquierda y derecha. Pensado para escuchar mucho rato.', circular: 'Movimiento estéreo más amplio y continuo, con un ligero cambio de brillo al pasar «por detrás». Es un efecto estéreo, no sonido 3D real.', envolvente: 'Sitúa el sonido girando alrededor de la cabeza con procesamiento binaural (HRTF). Experimental: puede cambiar el timbre y el equilibrio de algunas canciones.' }[sp.mode]}</small></label>
        <label class="lbl">Intensidad <b data-sp-val="intensity">${sp.intensity} %</b><input type="range" class="sp-range" data-sp="intensity" min="0" max="100" step="1" value="${sp.intensity}" style="--p:${sp.intensity}%" ${off} aria-label="Intensidad del audio espacial">
          <small>Cuánto se mueve el sonido. No sube el volumen; al 0 % suena el original.</small></label>
        <label class="lbl">Velocidad <b data-sp-val="speed">${sp.speed} %</b><input type="range" class="sp-range" data-sp="speed" min="0" max="100" step="1" value="${sp.speed}" style="--p:${sp.speed}%" ${off} aria-label="Velocidad del audio espacial">
          <small data-sp-speed>${spatialSpeedText(sp)}</small></label>
      </div>
      <div class="actions" style="margin-top:12px"><button class="btn ghost" data-act="sp-reset">${icon('sync')}Restaurar ajustes</button></div>
      <p class="muted small" style="margin:12px 0 0">El efecto depende del archivo y de dónde está. Las canciones guardadas en este dispositivo siempre se pueden procesar; las que suenan directamente desde la nube, solo si su servidor lo permite. Cuando una canción no se puede procesar, suena el audio original sin avisos.
        ${st.last ? `<span data-sp-status>Última canción${st.last.title ? ` («${esc(st.last.title)}»)` : ''}: ${SPATIAL_WHY[st.last.reason] || 'audio original'}.</span>` : ''}</p></section>`;
}
const spatialSpeedText = sp => { const f = spatial.freqOf(sp); return `Una vuelta completa cada ${Math.round(1 / f)} segundos.`; };
async function setSpatial(patch) {
  const before = spatial.settings();
  S.settings.spatial = { ...before, ...patch };
  S.settings.spatialAt = Date.now();
  await saveKV('settings', false);
  emit('dirty');
  const now = spatial.settings();
  if (now.on && !before.on) { player.prepareSpatial(); spatial.apply(); await player.reroute(); }   // la canción que suena pasa a la ruta espacial sin reiniciarse
  else spatial.apply();
}
on('spatial-changed', () => { spatial.apply(); if (location.hash.startsWith('#/ajustes')) refresh(); });
// Ayuda: guía para crear y conectar un bucket. Cada paso se marca solo al detectar que ya está hecho.
function helpSection({ u, bks, own, O, inCloud, keySteps, bucketForm }) {
  const connected = bks.length > 0, keyOk = !!O && own.length > 0;
  const path = helpPath || (connected && !own.length && !O ? 'guest' : 'own');
  const ext = (href, text) => `<a class="link" href="${href}" target="_blank" rel="noopener">${text}</a>`;
  const go = (href, text, ic = 'chevR') => `<a class="btn sm" href="${href}">${text}${icon(ic)}</a>`;
  const loginStep = { title: 'Inicia sesión en Fiora', tag: 'Recomendado', done: !!u,
    body: `<p>Con tu cuenta, la conexión al bucket, tus playlists, favoritos y ajustes te siguen a cualquier dispositivo: solo tendrás que hacer esta guía una vez.</p><div class="actions">${go('#/ajustes/cuenta', u ? 'Ver mi cuenta' : 'Iniciar sesión o crear cuenta')}</div>` };
  const steps = path === 'own' ? [
    loginStep,
    { title: 'Crea tu cuenta de Oracle Cloud', done: connected,
      body: `<p>Regístrate en ${ext('https://www.oracle.com/cloud/free/', 'Oracle Cloud Free Tier')}. Oracle pide una tarjeta para verificar la cuenta; los recursos marcados como <i>Always Free</i> no se cobran. Revisa sus condiciones y límites al registrarte.</p>` },
    { title: 'Crea el bucket', done: connected,
      body: `<ol class="steps"><li>Entra en ${ext('https://cloud.oracle.com/', 'la consola de Oracle Cloud')}.</li>
        <li>Menú ☰ → <b>Storage</b> (Almacenamiento) → <b>Buckets</b> → <b>Create Bucket</b>.</li>
        <li>Ponle un nombre (por ejemplo, <code>musica</code>), deja el nivel <b>Standard</b> y la visibilidad <b>privada</b>, y pulsa <b>Create</b>.</li></ol>` },
    { title: 'Crea la URL de acceso', done: connected,
      body: `<ol class="steps"><li>Abre el bucket y entra en <b>Pre-Authenticated Requests</b> → <b>Create Pre-Authenticated Request</b>.</li>
        <li>Destino: <b>Bucket</b>. Acceso: <b>Permit object reads and writes</b>. Marca <b>Enable Object Listing</b>.</li>
        <li>Pon una fecha de caducidad lejana y pulsa <b>Create</b>.</li>
        <li>Copia la URL: <b>Oracle solo la muestra una vez</b>. Funciona como una contraseña, así que no la compartas.</li></ol>` },
    { title: 'Conecta el bucket a Fiora', done: connected,
      body: connected ? `<p>Conectado: ${bks.map(b => `«${esc(b.name)}»`).join(', ')}.</p><div class="actions">${go('#/ajustes/nube', 'Ver mis buckets')}</div>` : `<p>Pega aquí la URL que acabas de copiar.</p>${bucketForm}` },
    { title: 'Añade tu clave de API de Oracle', tag: 'Si el bucket es tuyo', done: keyOk,
      body: `<p>Sin ella el bucket es de solo lectura. Con ella puedes <b>subir música</b>, cambiar los archivos, crear enlaces para compartir y usar el modo desarrollador. Se guarda solo en este dispositivo: añádela únicamente en dispositivos tuyos.</p>
        ${keyOk ? `<div class="actions">${go('#/ajustes/desarrollador', 'Ver la clave')}</div>` : connected ? keySteps : '<p class="muted small">Disponible cuando el bucket esté conectado.</p>'}` },
    { title: 'Sube tu música', done: inCloud > 0,
      body: `<p>Añade canciones desde tu dispositivo y súbelas a la nube desde <b>Nube</b>. A partir de ahí suenan en todos tus dispositivos y puedes descargarlas para escucharlas sin conexión.</p>
        <div class="actions">${ADD_BTN}${connected ? go('#/ajustes/nube', 'Ir a Nube') : ''}</div>` },
  ] : [
    { title: 'Pide un enlace de solo lectura', done: connected,
      body: '<p>Quien creó el bucket lo genera en <b>Ajustes → Nube → Compartir</b>, uno para cada persona. Con él puedes escuchar y descargar, pero no subir, cambiar ni borrar nada.</p>' },
    loginStep,
    { title: 'Pega el enlace', done: connected,
      body: connected ? `<p>Conectado: ${bks.map(b => `«${esc(b.name)}»`).join(', ')}.</p>` : `<p>Ponle un nombre que te ayude a reconocerlo (por ejemplo, «Música de Ana») y pega el enlace.</p>${bucketForm}` },
    { title: 'Escucha', done: connected && inCloud > 0,
      body: `<p>Las canciones aparecen en tu biblioteca al sincronizar. Tus playlists, favoritos y escuchas se guardan en tu cuenta, nunca en su bucket, y nadie más los ve.</p><div class="actions">${go('#/biblioteca', 'Ir a la biblioteca')}</div>` },
  ];
  const done = steps.filter(s => s.done).length, next = steps.findIndex(s => !s.done);
  return `<section class="panel tuto-box"><h2>Conecta tu música</h2>
      <p>Fiora guarda tu música en un <b>bucket</b>: una carpeta en la nube de Oracle que solo tú controlas.</p>
      <div class="seg tuto-path" role="tablist">
        <button role="tab" data-act="help-path" data-path="own" aria-selected="${path === 'own'}" class="${path === 'own' ? 'on' : ''}">${icon('cloud')}Crear mi bucket</button>
        <button role="tab" data-act="help-path" data-path="guest" aria-selected="${path === 'guest'}" class="${path === 'guest' ? 'on' : ''}">${icon('user')}Tengo un enlace</button></div>
      <div class="tuto-progress" aria-label="${done} de ${steps.length} pasos hechos"><div class="meter"><i style="width:${(done / steps.length) * 100}%"></i></div>
        <small>${done === steps.length ? '¡Todo listo!' : `${done} de ${steps.length} pasos`}</small></div>
      <ol class="tuto">${steps.map((s, i) => `<li class="tuto-step${s.done ? ' done' : ''}${i === next ? ' cur' : ''}" data-step="${i + 1}"><details ${i === next ? 'open' : ''}>
        <summary><span class="tuto-n">${s.done ? icon('check') : i + 1}</span><span class="tuto-t"><b>${s.title}</b>${s.tag ? `<small>${s.tag}</small>` : ''}</span>${icon('chevD')}</summary>
        <div class="tuto-body">${s.body}</div></details></li>`).join('')}</ol></section>
    <section class="panel"><h2>Preguntas frecuentes</h2>
      <details class="faq"><summary>¿Cuánto cuesta?</summary><p>Fiora es gratuita y no cobra nada. El espacio lo pone Oracle: su nivel gratuito incluye almacenamiento de objetos; si superas sus límites, Oracle aplica sus tarifas. Consulta sus condiciones actuales en su web.</p></details>
      <details class="faq"><summary>¿Qué diferencia hay entre la URL del bucket y la clave de API?</summary><p>La <b>URL</b> conecta el bucket para escuchar y sincronizar. La <b>clave de API</b> demuestra que el bucket es tuyo y permite cambiarlo: subir, borrar, compartir y editar metadatos. Quien solo escucha no la necesita.</p></details>
      <details class="faq"><summary>¿Dónde se guardan la URL y la clave?</summary><p>La URL se guarda en este dispositivo y, si has iniciado sesión, en tu cuenta para conectarla en tus otros dispositivos. La clave de API se guarda solo en este dispositivo, nunca en tu cuenta ni en el bucket.</p></details>
      <details class="faq"><summary>¿Cómo comparto mi música sin dar mi URL?</summary><p>Con la clave de API añadida, en <b>Nube</b> aparece «Compartir»: crea un enlace de solo lectura para cada persona, con caducidad, y revócalo cuando quieras.</p></details>
      <details class="faq"><summary>He perdido la URL del bucket</summary><p>Oracle no la vuelve a mostrar. Crea otra en <b>Pre-Authenticated Requests</b> del mismo bucket y conéctala: la música sigue ahí. Si alguien pudo verla, borra la antigua en Oracle.</p></details>
      <details class="faq"><summary>No me deja subir canciones</summary><p>El bucket está en solo lectura en este dispositivo. Si es tuyo, añade la clave de API de Oracle (paso «Añade tu clave de API»). Si te lo compartieron, solo se puede escuchar.</p></details>
    </section>`;
}
// Grupos de los buckets: con quién se pueden compartir playlists y con qué nombre te ven.
function groupsPanel() {
  if (!account.user()) return '';
  if (groups.status() === 'missing') return `<div class="sub-panel"><b>Falta preparar Supabase para compartir playlists</b>
    <small>La base de datos de la cuenta aún no está preparada para compartir playlists con quienes comparten tus buckets.</small></div>`;
  const list = cloud.buckets().map(b => ({ b, g: groups.of(b.id) })).filter(x => x.g?.status === 'ok');
  if (!list.length) return '';
  return `<div class="sub-panel"><b>Playlists compartidas</b>
    <small>Quienes conectan el mismo bucket con su cuenta forman un grupo: puedes compartir playlists con ellos (botón «Compartir» de cada playlist). Te ven por el nombre que elijas, nunca por tu correo.</small>
    <ul class="buckets">${list.map(({ b, g }) => `<li><span class="badge-ic">${icon('user')}</span><span class="row-text"><b>${g.name ? esc(g.name) : 'Sin nombre todavía'}</b><small>tu nombre en «${esc(b.name)}» · ${plural(g.members || 1, 'persona', 'personas')} en el grupo</small></span>
      <button class="chip" data-act="group-name" data-bid="${esc(b.id)}">${g.name ? 'Cambiar' : 'Elegir nombre'}</button></li>`).join('')}</ul></div>`;
}
// Enlaces de solo lectura de cada bucket propio (se piden a Oracle después de pintar Ajustes).
const fmtDay = ms => new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
// Solo vale la lectura más reciente: si una anterior (p. ej. de antes de crear un enlace) contesta
// más tarde, no debe pisar la lista nueva.
let sharesRun = 0;
async function loadShares() {
  const run = ++sharesRun;
  for (const ul of $$('[data-shares]')) {
    const b = cloud.buckets().find(x => x.id === ul.dataset.shares);
    if (!b) continue;
    try {
      const list = await oci.listShares(b.url);
      if (!ul.isConnected || run !== sharesRun) return;
      const form = $(`[data-form="share"][data-bid="${CSS.escape(b.id)}"]`);
      const active = oci.activeShares(list).length;
      setHTML(ul, list.length ? list.map(p => {
        const live = p.expires > Date.now();
        return `<li><span class="badge-ic">${icon('user')}</span><span class="row-text"><b>${esc(p.who)}</b><small>${live ? `Solo lectura · caduca el ${fmtDay(p.expires)}` : 'Caducado'}${p.readOnly ? '' : ' · ¡no es de solo lectura!'}</small></span>
          <button class="chip" data-act="share-revoke" data-bid="${esc(b.id)}" data-pid="${esc(p.id)}" data-who="${esc(p.who)}">${live ? 'Revocar' : 'Quitar'}</button></li>`;
      }).join('') : '<li class="muted">Aún no lo has compartido con nadie.</li>');
      if (form) {
        $('button', form).disabled = active >= oci.MAX_SHARES;
        $('button', form).title = active >= oci.MAX_SHARES ? `Ya hay ${oci.MAX_SHARES} enlaces vigentes` : '';
      }
    } catch (e) {
      if (ul.isConnected && run === sharesRun) setHTML(ul, `<li class="muted">No se pudieron leer los enlaces: ${esc(e.message)}</li>`);
    }
  }
}
function showShareLink(who, url) {
  openSheet(`<div class="dlg"><h3>Enlace para ${esc(who)}</h3>
    <p>Envíaselo por un canal privado. Solo se muestra ahora: Fiora no lo guarda. Si se pierde, revócalo y crea otro.</p>
    <label class="field">${icon('lock')}<input readonly value="${esc(url)}" data-share-url aria-label="Enlace de solo lectura"></label>
    <p class="muted">En Fiora: Ajustes → Nube → pegar el enlace → Conectar bucket.</p>
    <div class="actions"><button class="btn ghost" data-x>Cerrar</button><button class="btn primary" data-copy>Copiar</button></div></div>`,
  e => {
    if (e.target.closest('[data-x]')) return sheet.close();
    if (!e.target.closest('[data-copy]')) return;
    const field = $('[data-share-url]', sheet);
    field.select();
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Enlace copiado'), () => { try { document.execCommand('copy'); toast('Enlace copiado'); } catch { toast('Cópialo a mano'); } });
  });
}
let syncing = null;
async function cloudSync(silent = false) {
  if (!cloud.configured() || !navigator.onLine) return;
  if (syncing) { if (!silent) toast('Ya se está sincronizando…'); return syncing; }
  syncing = doCloudSync(silent).finally(() => { syncing = null; lastAutoSync = Date.now(); });
  return syncing;
}
async function doCloudSync(silent) {
  const t = silent ? null : toast('Sincronizando con la nube…', 0);
  try {
    const r = await cloud.syncAll((i, n, name) => t?.set(`Leyendo ${i} de ${n}: ${name.split('/').pop()}`));
    const msg = r.added || r.removed || r.updated ? `Nube sincronizada: ${r.added} nuevas${r.updated ? `, ${r.updated} actualizadas` : ''}${r.removed ? `, ${r.removed} quitadas` : ''}` : 'Todo sincronizado';
    if (r.errors.length) { if (t) t.done(`No se pudo leer un bucket: ${r.errors[0]}`, 7000); }
    else if (t) t.done(msg); else if (r.added || r.updated) toast(msg);
  } catch (e) {
    console.warn(e);
    if (t) t.done(`No se pudo sincronizar: ${e.message}`, 6000);
  }
  await groups.sync().catch(e => console.warn('Grupos', e));   // y, con ello, las playlists compartidas
  pldata.pullShared();   // playlists que te hayan compartido (o dejado de compartir) desde la última vez
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
  const bks = cloud.ownedBuckets();
  if (!bks.length) return toast('Para subir hace falta un bucket tuyo y su clave de API de Oracle (Ajustes → Modo desarrollador)', 6000);
  if (bks.length < 2) return uploadMany(tracks, bks[0].id);
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
  return saveFile(new File([blob], name, { type: blob.type || 'audio/mpeg' }), note);
}
/** Guarda un archivo en el dispositivo (descargas; en iPhone/iPad, con el menú Compartir). */
async function saveFile(file, note = toast('Preparando el archivo…', 0)) {
  const name = file.name;
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
/** Todas las estadísticas de escucha (mosaicos y gráficos). Se muestran dentro de Perfil. */
function statsBody(d) {
  const fmtDay = x => x.date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  const tile = (value, label, sub = '') => `<div class="stat"><b title="${esc(String(value))}">${esc(String(value))}</b><small>${label}</small>${sub ? `<small class="stat-sub">${sub}</small>` : ''}</div>`;
  const WEEK = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const PARTS = ['Madrugada', 'Mañana', 'Tarde', 'Noche'];
  const peakHour = d.hoursOfDay.indexOf(Math.max(...d.hoursOfDay));
  const since = '<p class="chart-note">Este gráfico se empieza a llenar desde hoy: las escuchas anteriores no guardaban la fecha.</p>';
  return `<div class="stat-row tiles">
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
    <p class="muted" style="text-align:center">Todo se calcula en tu dispositivo a partir de tus escuchas.</p>`;
}
// La antigua pantalla de estadísticas ahora es una sección de Perfil.
const viewStats = () => PF.viewProfile('stats');
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
view.addEventListener('pointerover', e => showTip(e.target.closest('[data-tip]')));
view.addEventListener('pointerdown', e => showTip(e.target.closest('[data-tip]')));
view.addEventListener('focusin', e => showTip(e.target.closest('[data-tip]')));
view.addEventListener('pointerleave', () => showTip(null));
view.addEventListener('scroll', () => showTip(null), { passive: true });

// ------------------------------------------------- modo desarrollador
const needsTags = t => !t.aiTagged && !(t.moods || []).length;
// Canciones de la biblioteca sin portada (ninguna se queda así tras buscarlas).
const needsCover = t => !t.coverId && !t.coverUrl;
const needsAlbum = t => !t.album && !t.radio;
// Las que ya se buscaron sin éxito no se vuelven a enviar en bloque (sí desde el menú ⋯ de la canción).
const albumPending = t => needsAlbum(t) && !t.albumTried;
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
  if (!devOn()) return;
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
async function tagMany(tracks, { write = true } = {}) {
  const note = toast('Preparando…', 0);
  let tagged = 0, opts;
  try { opts = await aiOptions(); } catch (e) { note.done(e.message, 8000); return []; }
  for (let i = 0; i < tracks.length; i += ai.BATCH) {
    const chunk = tracks.slice(i, i + ai.BATCH);
    note.set(`Etiquetando con IA: ${i + 1}–${i + chunk.length} de ${tracks.length}…`);
    let res;
    try { res = await ai.tagTracks(chunk, opts); }
    catch (e) { emit('library'); note.done(`${tagged ? `${tagged} etiquetadas. ` : ''}Se detuvo: ${e.message}`, 8000); return tracks; }
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
  if (files.length && write) offerWrite(files);
  return tracks;
}

/**
 * Completa de una vez lo que falta, en el orden en que se ayudan: primero el álbum (con él se
 * encuentran mejor las portadas y los géneros), después la portada y al final los géneros y lo que
 * transmite. Cada paso usa lo que dejó el anterior. Los archivos se escriben y suben una sola vez.
 */
async function completeAll() {
  try { await aiOptions(); } catch (e) { return toast(e.message, 8000); }
  const STEPS = [
    ['Álbum', albumPending, l => findAlbums(l, { write: false })],
    ['Portada', needsCover, l => findCovers(l, { write: false })],
    ['Géneros y lo que transmite', needsTags, l => tagMany(l, { write: false })],
  ];
  const touched = new Set();
  for (let i = 0; i < STEPS.length; i++) {
    const [name, need, run] = STEPS[i];
    const list = everyTrack().filter(need);
    if (!list.length) continue;
    toast(`Paso ${i + 1} de 3 · ${name}: ${plural(list.length, 'canción', 'canciones')}`, 3000);
    for (const t of list) touched.add(t.id);
    await run(list);
  }
  const files = [...touched].map(id => S.tracks.get(id)).filter(x => x && fileOutdated(x) && cloud.canWriteFile(x));
  if (files.length) await writeFiles(files);
  refresh();
}

/**
 * Busca el álbum de las canciones que no lo tienen. Igual que las portadas: primero directamente
 * en los catálogos (Apple y, si no, MusicBrainz) con el título y el artista del archivo; la IA solo
 * para las que así no aparecen o cuyos datos no dicen nada. Lo que propone la IA se acepta solo si
 * un catálogo confirma que la canción está en ese disco: no se inventa ningún álbum.
 * Después se escribe en los archivos y se sube a la nube como el resto de metadatos editados.
 */
async function findAlbums(tracks, { write = true } = {}) {
  const note = toast('Preparando…', 0);
  let opts;
  try { opts = await aiOptions(); } catch (e) { note.done(e.message, 8000); return []; }
  const changed = [], from = { apple: 0, musicbrainz: 0 }, unanswered = new Set();
  let stopped = '', aiProblem = '', viaAi = 0, unconfirmed = 0;
  const artistOf = t => artistsOf(t)[0] || '';
  const apply = async (t, r) => {
    const f = { album: r.album, albumTried: true };
    if (r.albumArtist && covers.norm(r.albumArtist) !== covers.norm(artistOf(t))) f.albumArtist = r.albumArtist;
    if (!t.year && r.year) f.year = r.year;
    if (!t.trackNo && r.trackNo && !r.single) f.trackNo = r.trackNo;
    await setEdit(t, f);
    changed.push(t); from[r.from]++;
  };
  const pool = async (items, fn, n = 4) => {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length && !stopped) { const it = items[i++]; try { await fn(it); } catch (e) { stopped ||= e.message; } }
    }));
  };

  // 1. Directamente, con el título y el artista del archivo (las canciones iguales, una sola consulta).
  const jobs = new Map(), needAi = [];
  for (const t of tracks) {
    if (!covers.searchable(t.title, artistOf(t))) { needAi.push(t); continue; }
    const key = `${covers.norm(t.title)}|${covers.norm(artistOf(t))}`;
    if (!jobs.has(key)) jobs.set(key, { title: t.title, artist: artistOf(t), songs: [] });
    jobs.get(key).songs.push(t);
  }
  let done = 0;
  const list = [...jobs.values()];
  await pool(list, async j => {
    j.res = await covers.albumOf(j);
    done++; note.set(`Buscando álbumes (${tracks.length} canciones): ${done} de ${list.length}…`);
  });
  for (const j of list) {
    if (!('res' in j)) continue;                     // se cortó antes de buscarla
    for (const t of j.songs) {
      if (j.res) await apply(t, j.res);
      else { if (j.res === undefined) unanswered.add(t.id); needAi.push(t); }
    }
  }

  // 2. La IA, solo para las que faltan; lo que diga se comprueba en los catálogos.
  for (let i = 0; i < needAi.length && !stopped; i += ai.BATCH) {
    const chunk = needAi.slice(i, i + ai.BATCH);
    const label = `Identificando con IA: ${i + 1}–${i + chunk.length} de ${needAi.length}…`, t0 = Date.now();
    note.set(label);
    const tick = setInterval(() => { const sec = Math.round((Date.now() - t0) / 1000); if (sec >= 5) note.set(`${label} (${sec} s)`); }, 1000);
    let ids;
    try { ids = await ai.identifyReleases(chunk, opts); }
    catch (e) { aiProblem = e.message; ids = chunk.map(() => null); }
    finally { clearInterval(tick); }
    const checks = chunk.map((t, k) => ({ t, id: ids[k] })).filter(x => x.id);
    done = 0;
    await pool(checks, async x => {
      x.res = await covers.albumOf({ title: x.t.title, artist: x.id.artist, album: x.id.album });
      done++; note.set(`Comprobando lo que propone la IA: ${done} de ${checks.length}…`);
    });
    for (const x of checks) {
      if (!('res' in x)) continue;
      if (x.res) { await apply(x.t, x.res); viaAi++; unanswered.delete(x.t.id); }
      else { unconfirmed++; if (x.res === undefined) unanswered.add(x.t.id); }
    }
  }

  // 3. Las que no aparecen se marcan para no volver a enviarlas en bloque (salvo si los catálogos no contestaron).
  if (!stopped) for (const t of tracks) if (!changed.includes(t) && !unanswered.has(t.id)) await setEdit(t, { albumTried: true });

  emit('library');
  if (P.current && changed.some(t => t.id === P.current.id)) { renderMini(); renderNow(); }
  const left = tracks.length - changed.length;
  const msg = [`${plural(changed.length, 'álbum encontrado', 'álbumes encontrados')}${viaAi ? ` (${viaAi} con ayuda de la IA)` : ''}`,
    left && `${left} sin encontrar`,
    unconfirmed && `${plural(unconfirmed, 'propuesta', 'propuestas')} de la IA sin confirmar en los catálogos (no se han puesto)`,
    (from.apple || from.musicbrainz) && `de ${[from.apple && `Apple (${from.apple})`, from.musicbrainz && `MusicBrainz (${from.musicbrainz})`].filter(Boolean).join(' y ')}`,
    unanswered.size && `${unanswered.size} sin respuesta de los catálogos: vuelve a intentarlo más tarde`,
    aiProblem && `sin ayuda de la IA (${aiProblem})`,
    stopped && `se detuvo: ${stopped}`].filter(Boolean).join(' · ');
  note.done(msg, 9000);
  const files = changed.map(x => S.tracks.get(x.id) || x).filter(x => fileOutdated(x) && cloud.canWriteFile(x));
  if (files.length && write) await writeFiles(files);
  return changed;
}

/**
 * Pone portada a las canciones que no tienen. Ninguna se queda sin portada:
 *   1. la de su disco: la IA identifica el álbum o single y la imagen sale de MusicBrainz;
 *   2. si no existe, la de otra canción del mismo álbum que ya tenga en la biblioteca;
 *   3. si no, la de otra canción del mismo artista en la biblioteca;
 *   4. si no, la de otro disco del artista en MusicBrainz;
 *   5. y si ni del artista se sabe nada, una generada en el dispositivo con el título y el artista.
 * Las canciones del mismo disco comparten portada y una sola búsqueda. Después se escriben en los
 * archivos y se suben a la nube con el resto de metadatos editados.
 */
async function findCovers(tracks, { write = true } = {}) {
  const note = toast('Preparando…', 0);
  let opts;
  try { opts = await aiOptions(); } catch (e) { note.done(e.message, 8000); return []; }
  const byKey = new Map(), byArtist = new Map(), copies = new Map(), misses = [], changed = [];
  const count = { exact: 0, album: 0, artist: 0, generated: 0 }, from = { apple: 0, youtube: 0, musicbrainz: 0 };
  let stopped = '', notUploaded = 0;
  // Guarda una imagen como portada nueva (y la sube para los demás dispositivos).
  const store = async (blob, seed) => {
    const small = await shrinkCover(blob, 600);
    if (!small) return null;
    const cid = 'u' + hash(`${seed}|${Date.now()}|${Math.random()}`);
    await db.put('covers', cid, small);
    const up = cloud.configured() ? await cloud.uploadCover(cid, small).catch(() => false) : false;
    if (cloud.configured() && !up) notUploaded++;
    return cid;
  };
  // Portada que ya tiene otra canción: las leídas de un archivo solo están en este dispositivo,
  // así que se copian como portada nueva (y se suben) para que la vean también los demás.
  const reuse = async src => {
    if (src[0] === 'u') return src;
    if (!copies.has(src)) copies.set(src, db.get('covers', src).then(b => (b ? store(b, src) : null)).catch(() => null));
    return copies.get(src);
  };
  const apply = async (t, cid, kind) => {
    await setEdit(t, { coverId: cid, coverUrl: '', coverTried: true, coverSource: kind });
    count[kind]++; changed.push(t);
  };

  // Varias búsquedas a la vez: cada catálogo respeta su propio límite (covers.js), y mientras uno
  // espera, los demás discos avanzan. Si una falla, se dejan las que faltan para la próxima vez.
  const pool = async (items, fn, n = 4) => {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length && !stopped) { const it = items[i++]; try { await fn(it); } catch (e) { stopped ||= e.message; } }
    }));
  };
  let done = 0;
  const progress = (what, total) => note.set(`${what}: ${done} de ${total}…`);

  // 1. La portada de su disco. Primero directamente con el título, el artista y el álbum del
  //    archivo (lo normal: una consulta por disco y sin IA); la IA solo identifica las que así no
  //    se encuentran o cuyos datos no dicen nada («Track 01», «Artista desconocido»).
  const artistOf = t => albumArtistOf(t) || artistsOf(t)[0] || '';
  const found = new Map();          // disco del catálogo → portada guardada (aunque se llegue por consultas distintas)
  const lookup = async (jobs, what, direct = false) => {
    const todo = [...jobs.values()].filter(j => !byKey.has(j.key));
    done = 0;
    await pool(todo, async j => {
      const res = await covers.find(j.queries, { direct });
      if (res && !found.has(res.id)) { found.set(res.id, store(res.blob, res.id)); from[res.from]++; }
      byKey.set(j.key, res ? await found.get(res.id) : null);
      done++; progress(what, todo.length);
    });
  };
  const fileJobs = new Map(), needAi = [];
  for (const t of tracks) {
    const artist = artistOf(t);
    if (!covers.searchable(t.title, artist)) { needAi.push(t); continue; }
    const key = `f|${covers.discKey(t.album || t.title, artist)}`;
    if (!fileJobs.has(key)) fileJobs.set(key, { key, songs: [], queries: [{ album: t.album, artist, title: t.title }] });
    fileJobs.get(key).songs.push(t);
  }
  await lookup(fileJobs, `Buscando portadas (${tracks.length} canciones)`, true);
  for (const j of fileJobs.values()) {
    const cid = byKey.get(j.key);
    for (const t of j.songs) { if (cid) await apply(t, cid, 'exact'); else if (byKey.has(j.key)) needAi.push(t); }
  }
  let aiProblem = '';
  for (let i = 0; i < needAi.length && !stopped; i += ai.BATCH) {
    const chunk = needAi.slice(i, i + ai.BATCH);
    // Mientras la IA piensa, el aviso cuenta los segundos (para que se vea que sigue trabajando).
    const label = `Identificando con IA: ${i + 1}–${i + chunk.length} de ${needAi.length}…`, t0 = Date.now();
    note.set(label);
    const tick = setInterval(() => { const sec = Math.round((Date.now() - t0) / 1000); if (sec >= 5) note.set(`${label} (${sec} s)`); }, 1000);
    let ids;
    // Si la IA falla o no contesta, se sigue sin ella: se busca con lo que trae el archivo y, si
    // no aparece, con el resto de la cadena (álbum, artista, generada).
    try { ids = await ai.identifyReleases(chunk, opts); }
    catch (e) { aiProblem = e.message; ids = chunk.map(() => null); }
    finally { clearInterval(tick); }
    const jobs = new Map();          // disco → canciones que lo comparten y cómo buscarlo
    chunk.forEach((t, k) => {
      const id = ids[k], artist = artistOf(t);
      const key = id ? `ia|${covers.discKey(id.album, id.artist)}` : `fia|${covers.discKey(t.album || t.title, artist)}`;
      if (!jobs.has(key)) jobs.set(key, { key, songs: [], queries: [id && { ...id, title: t.title }, { album: t.album, artist, title: t.title }] });
      jobs.get(key).songs.push({ t, artist: id?.artist || artist });
    });
    await lookup(jobs, `Buscando portadas (${i + 1}–${i + chunk.length} de ${needAi.length})`);
    for (const j of jobs.values()) {
      if (!byKey.has(j.key)) continue;              // se cortó antes de buscarlo
      const cid = byKey.get(j.key);
      for (const x of j.songs) { if (cid) await apply(x.t, cid, 'exact'); else misses.push(x); }
    }
  }

  // 2–5. Las que no tienen portada de su disco (si la búsqueda se cortó, se dejan para la próxima vez)
  if (!stopped) {
    const later = [];
    for (const m of misses) {
      const { t, artist } = m;
      const lib_ = allTracks().filter(o => o.id !== t.id && o.coverId);
      const sib = t.album && lib_.find(o => lib.albumKey(o) === lib.albumKey(t));
      if (sib) { const cid = await reuse(sib.coverId); if (cid) { await apply(t, cid, 'album'); continue; } }
      if (!covers.unknownArtist(artist)) {
        const a = covers.norm(artist);
        const same = lib_.filter(o => covers.norm(albumArtistOf(o)) === a || artistsOf(o).some(x => covers.norm(x) === a));
        if (same.length) {
          const freq = new Map();
          for (const o of same) freq.set(o.coverId, (freq.get(o.coverId) || 0) + 1);
          const cid = await reuse([...freq].sort((x, y) => y[1] - x[1])[0][0]);
          if (cid) { await apply(t, cid, 'artist'); continue; }
        }
      }
      later.push(m);
    }
    // otros discos del artista, en los catálogos (un artista, una búsqueda)
    const artists = [...new Set(later.map(m => m.artist).filter(a => !covers.unknownArtist(a)))];
    done = 0;
    await pool(artists, async artist => {
      const res = await covers.artistCover(artist);
      byArtist.set(covers.norm(artist), res ? await store(res.blob, res.id) : null);
      if (res) from[res.from]++;
      done++; progress('Buscando discos de los artistas', artists.length);
    });
    if (!stopped) {
      for (const { t, artist } of later) {
        const cid = !covers.unknownArtist(artist) && byArtist.get(covers.norm(artist));
        if (cid) { await apply(t, cid, 'artist'); continue; }
        const img = await covers.generated({ title: t.title, artist: covers.unknownArtist(artist) ? '' : artist });
        const gen = img && await store(img, `gen|${t.id}`);
        if (gen) await apply(t, gen, 'generated');
      }
    }
  }

  emit('library');
  if (P.current && changed.some(t => t.id === P.current.id)) { renderMini(); renderNow(); }
  const left = tracks.length - changed.length;
  const msg = [`${plural(count.exact, 'portada encontrada', 'portadas encontradas')}`,
    count.album && `${count.album} del mismo álbum`, count.artist && `${count.artist} del mismo artista`,
    count.generated && `${plural(count.generated, 'generada', 'generadas')} (sin datos del disco ni del artista)`,
    (from.apple || from.youtube || from.musicbrainz) && `imágenes de ${[from.apple && `Apple (${from.apple})`, from.youtube && `YouTube Music (${from.youtube})`, from.musicbrainz && `MusicBrainz (${from.musicbrainz})`].filter(Boolean).join(', ')}`,
    notUploaded && `${notUploaded} no se pudieron subir a la nube`,
    aiProblem && `sin ayuda de la IA para algunas (${aiProblem})`,
    stopped && `se detuvo: ${stopped}${left ? ` (${left} sin portada todavía; vuelve a intentarlo más tarde)` : ''}`].filter(Boolean).join(' · ');
  note.done(msg, 9000);
  // Se escriben en los archivos (con los demás metadatos editados) y se suben a la nube.
  const files = changed.map(x => S.tracks.get(x.id) || x).filter(x => fileOutdated(x) && cloud.canWriteFile(x));
  if (files.length && write) await writeFiles(files);
  return changed;
}

// ----------------------------- actualizar los metadatos de todos los archivos de la nube
let bulk = null;        // { stop } mientras se revisa o se actualiza
let lastReport = null;  // resultado de la última vez, para poder consultarlo
async function keepAwake() {
  try { return await navigator.wakeLock?.request('screen'); } catch { return null; }
}
async function updateCloudFiles() {
  if (!devOn()) return;
  if (bulk) return;
  const inCloud = everyTrack().filter(t => t.cloudName);
  const list = inCloud.filter(t => cloud.canWriteFile(t));
  const report = { at: Date.now(), updated: [], fine: [], failed: [], skipped: inCloud.filter(t => !cloud.canWriteFile(t)).map(t => [t.title, /\.(mp3|flac|m4a|m4b|mp4)$/i.test(t.fileName) ? 'su bucket no está conectado' : `formato ${(t.fileName.match(/\.(\w+)$/) || [, '?'])[1].toUpperCase()} sin etiquetas`]) };
  if (!list.length) return toast(inCloud.length ? 'Ninguna canción de la nube está en MP3, FLAC o M4A' : 'No hay canciones en la nube');
  bulk = { stop: false }; refresh();
  const lock = await keepAwake();
  const note = toast('Revisando los archivos de la nube… Deja la app abierta.', 0);
  const todo = [];
  for (let i = 0; i < list.length && !bulk.stop; i++) {
    const t = list[i];
    note.set(`Revisando ${i + 1} de ${list.length}: ${t.title}${todo.length ? ` · ${todo.length} por actualizar` : ''}`);
    try { const gap = await cloud.cloudFileGap(t); if (gap) todo.push(t); else report.fine.push([t.title, 'ya tenía todos los datos']); }
    catch (e) { if (e.unsupported) report.skipped.push([t.title, e.message]); else { console.warn(e); report.failed.push([t.title, `no se pudo leer: ${e.message}`]); } }
  }
  const finish = msg => { lock?.release?.().catch(() => {}); bulk = null; lastReport = report; note.done(msg, 6000); refresh(); if (report.updated.length + report.failed.length + report.skipped.length) showReport(); };
  if (bulk.stop) return finish('Revisión detenida');
  if (!todo.length) return finish(`Los ${plural(list.length, 'archivo', 'archivos')} de la nube ya tienen todos los datos de la app.`);
  note.done('', 0);
  const remote = todo.filter(t => !t.hasBlob), bytes = remote.reduce((n, t) => n + (t.size || 0), 0) * 2 + todo.filter(t => t.hasBlob).reduce((n, t) => n + (t.size || 0), 0);
  const ok = await confirmDlg(`¿Actualizar ${plural(todo.length, 'archivo', 'archivos')} de la nube?`,
    `${plural(todo.length, 'archivo no tiene', 'archivos no tienen')} todavía los géneros, lo que transmite u otros cambios hechos en la app (de ${list.length} revisados). Se escribirán dentro de cada archivo y se subirán a tu nube, comprobando cada uno. Se moverán unos ${mb(bytes)}. El sonido no cambia. Deja la app abierta mientras tanto; puedes detenerlo cuando quieras.`, 'Actualizar');
  if (!ok) { lock?.release?.().catch(() => {}); bulk = null; return refresh(); }
  const res = await writeFiles(todo, { fields: t => cloud.desiredTags(t), stop: () => bulk?.stop });
  report.updated = res.done.map(t => [t.title, 'actualizado y comprobado']);
  report.failed.push(...res.fails);
  report.pending = todo.length - res.done.length - res.fails.length;
  lock?.release?.().catch(() => {}); bulk = null; lastReport = report; refresh(); showReport();
}
/** Informe de la última actualización: qué se actualizó, qué falló y por qué. */
function showReport() {
  const r = lastReport;
  if (!r) return;
  const sec = (title, rows, cls = '') => (rows.length ? `<h4>${title} (${rows.length})</h4><ul class="report ${cls}">${rows.slice(0, 300).map(([n, why]) => `<li><b>${esc(n)}</b><small>${esc(why)}</small></li>`).join('')}</ul>` : '');
  openSheet(`<div class="dlg filters"><h3>Informe de la actualización</h3>
    <p>${new Date(r.at).toLocaleString('es')} · ${r.updated.length} actualizados · ${r.failed.length} con error · ${r.fine.length} ya estaban bien${r.pending ? ` · ${r.pending} sin hacer (detenido)` : ''}</p>
    ${sec('Con error', r.failed, 'bad')}${sec('Actualizados', r.updated)}${sec('Sin etiquetas en el archivo', r.skipped)}${sec('Ya estaban bien', r.fine)}
    <div class="actions"><button type="button" class="btn primary" data-x>Cerrar</button></div></div>`,
  e => { if (e.target.closest('[data-x]')) sheet.close(); });
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
  const fails = [], doneList = [], failList = [];
  for (let i = 0; i < list.length; i++) {
    if (stop()) { stopped = true; break; }
    const t = list[i];
    const label = stage => note.set(list.length > 1 ? `${stage} ${i + 1} de ${list.length}: ${t.title}` : `${stage}: ${t.title}`);
    try { if ((got = await cloud.writeFile(t, label, fields ? fields(t) : null))) { done++; doneList.push(t); if (t.cloudName) toCloud++; } }
    catch (e) { console.warn(e); fails.push(`«${t.title}»: ${e.message}`); failList.push([t.title, e.message]); }
  }
  const msg = list.length === 1 && done ? `Guardado y comprobado en el archivo${toCloud ? ' de la nube' : ''}: géneros «${got.genre || '—'}» · lo que transmite «${got.mood || '—'}»`
    : `${plural(done, 'archivo actualizado y comprobado', 'archivos actualizados y comprobados')}${toCloud ? ` (${toCloud} en la nube)` : ''}`;
  const result = { done: doneList, fails: failList };
  if (stopped) { note.done(`Detenido: ${msg}. Lo que falta se actualizará la próxima vez.`, 8000); refresh(); return result; }
  note.done(fails.length ? `${done ? `${msg}. ` : ''}No se pudo guardar ${fails[0]}${fails.length > 1 ? ` y ${fails.length - 1} más` : ''}` : msg, fails.length ? 10000 : 7000);
  refresh();
  return result;
}

// ------------------------------------------------- canciones repetidas (desarrollador)
const dupKeep = {};   // copia elegida a mano en cada grupo: clave -> id
function viewDuplicates() {
  if (!devOn()) return show(empty('settings', 'Solo en modo desarrollador', 'Activa el modo desarrollador en Ajustes para revisar las canciones repetidas.', `<a class="btn primary" href="#/ajustes/desarrollador">Ir a Ajustes</a>`));
  const groups = lib.findDuplicates(dupKeep);
  const extra = groups.flatMap(g => g.tracks.slice(1));
  const ignored = (S.settings.dupIgnore || []).length;
  const back = ignored ? `<p class="muted" style="margin-top:18px">${plural(ignored, 'grupo marcado', 'grupos marcados')} como «no son repetidas». <button class="chip" data-act="dup-unignore">Volver a revisarlos</button></p>` : '';
  if (!groups.length) return show(`<div class="head"><h1>Canciones repetidas</h1></div>${empty('heart', 'No hay canciones repetidas', 'Ninguna canción de tu biblioteca tiene el mismo título y los mismos artistas que otra.', `<a class="btn" href="#/ajustes/desarrollador">Volver a Ajustes</a>`)}${back}`);
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
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    note.set(`Borrando ${i + 1} de ${list.length}: ${t.title}`);
    try {
      if (t.cloudName && cloud.configured()) await cloud.deleteRemote(t);   // solo en buckets propios; si no, lanza
      const keep = keepOf?.get(t.id);
      if (keep && S.tracks.has(keep.id)) await lib.mergeInto(t, keep);
      await lib.removeTrack(t.id);
      gone.add(t.id);
    } catch (e) { console.warn(e); fails.push(`«${t.title}»: ${e.message}`); }
  }
  if (gone.size) player.forget(gone);
  const msg = plural(gone.size, 'canción borrada', 'canciones borradas');
  note.done(fails.length ? `${msg}. No se pudo borrar ${fails[0]}${fails.length > 1 ? ` y ${fails.length - 1} más` : ''}` : msg, fails.length ? 8000 : 4000);
  refresh();
}
function confirmDelete(t) {
  const b = t.cloudName && (cloud.buckets().find(x => x.id === t.bucketId) || cloud.buckets()[0]);
  return confirmDlg('¿Borrar la canción para siempre?', `«${t.title}» se borrará de tu biblioteca, de este dispositivo${b ? ` y del bucket «${b.name}» (en todos tus dispositivos y para quien lo tenga compartido)` : ''}. No se puede deshacer.`, 'Borrar');
}

// Estado de la sincronización de Explorar en Ajustes.
function exploreChip() {
  const st = rdata.status();
  const [cls, txt] = st.mode === 'ready' ? (st.error ? ['bad', st.error] : st.pending || st.busy ? ['busy', 'Guardando…'] : ['ok', 'Guardado en tu cuenta'])
    : st.mode === 'missing' ? ['warn', 'Solo en este dispositivo: falta preparar Supabase'] : st.mode === 'offline' ? ['warn', 'Sin conexión: se guardará al volver'] : ['busy', 'Comprobando…'];
  return `<span class="sync-chip ${cls}" role="status" data-xsync>${icon(cls === 'ok' ? 'cloud' : 'sync')}<span>${esc(txt)}</span></span>`;
}
// Al cambiar los grupos (alguien entra o sale, o se cambia la clave) se vuelven a mirar las compartidas.
on('habits-sync', () => { if (location.hash.startsWith('#/ajustes')) refresh(); });
on('groups', () => { pldata.pullShared(); if (location.hash.startsWith('#/ajustes')) refresh(); });
on('explore-sync', () => { for (const el of $$('[data-xsync]')) el.outerHTML = exploreChip(); });
const ROUTES = { inicio: viewHome, biblioteca: viewLibrary, album: viewAlbum, artista: viewArtist, playlists: () => PL.viewList(), playlist: id => PL.viewPlaylist(id), favoritos: () => PL.viewPlaylist('favoritos'), mix: viewMix, estadisticas: viewStats, genero: n => viewTag('genero', n), ambiente: n => viewTag('ambiente', n), explorar: (...a) => EX.view(...a), archivo: viewArchive, ajustes: viewSettings, repetidas: viewDuplicates, perfil: () => PF.viewProfile(), criatura: (...a) => PF.viewCreature(...a) };

// ------------------------------------------------------- menú de una canción
function trackMenu(t, o = {}, i = -1) {
  const head = `<div class="sheet-head">${cover(t)}<div><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></div></div>`;
  if (t.radio) return EX.stationMenu(t);
  const lib_ = inLibrary(t);
  const remote = t.cloudName || t.url;
  menu(head, [
    o.queue && !o.user && player.isUpcoming(i) && { icon: 'queue', label: 'Reproducir a continuación', fn: () => { player.queueUpcoming(i, true); toast('Sonará a continuación'); } },
    o.queue && !o.user && player.isUpcoming(i) && { icon: 'plus', label: 'Añadir a tu cola', fn: () => { player.queueUpcoming(i); toast('Añadida a tu cola'); } },
    o.queue && (o.user || P.fromUser || i !== P.index) && { icon: 'x', label: 'Quitar de la cola', fn: () => player.removeFromQueue(i, !!o.user) },
    !o.queue && { icon: 'queue', label: 'Reproducir a continuación', fn: () => { player.enqueue([t], true); toast('Sonará a continuación'); } },
    !o.queue && { icon: 'plus', label: 'Añadir a la cola', fn: () => { player.enqueue([t]); toast('Añadida a tu cola'); } },
    !lib_ && { icon: 'library', label: 'Añadir a mi biblioteca', fn: async () => { await saveToLibrary([t]); toast('Añadida a tu biblioteca'); } },
    lib_ && { icon: 'list', label: 'Añadir a playlist…', fn: () => addToPlaylist([t]) },
    lib_ && devOn() && { icon: 'edit', label: 'Editar metadatos', fn: () => editTrack(t) },
    lib_ && devOn() && aiIsReady() && !t.coverId && !t.coverUrl && { icon: 'disc', label: 'Buscar portada', fn: () => findCovers([t]) },
    lib_ && devOn() && aiIsReady() && needsAlbum(t) && { icon: 'library', label: 'Buscar álbum', fn: () => findAlbums([t]) },
    lib_ && { icon: 'heart', label: isFav(t.id) ? 'Quitar de favoritas' : 'Me gusta', fn: () => toggleFav(t.id) },
    !t.radio && { icon: 'note', label: 'Sobre esta canción', fn: () => songSheet(t) },
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
    lib_ && t.hasBlob && !t.cloudName && cloud.uploadTarget() && { icon: 'cloudUp', label: 'Subir a la nube', fn: () => uploadTo([t]) },
    t.link && /^https:\/\//.test(t.link) && { icon: 'compass', label: `Ver origen y licencia${t.license ? ` (${t.license})` : ''}`, fn: () => window.open(t.link, '_blank', 'noopener') },
    ...(o.playlist && lib_ ? PL.menuItems(t, o.playlist) : []),
    lib_ && devOn() && cloud.ownsTrack(t) && {
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
function playInOrder(tracks) {
  const l = tracks.filter(playable);
  if (!l.length) return toast(navigator.onLine ? 'Estas canciones no están descargadas y no hay nube conectada' : 'Sin conexión: ninguna de estas canciones está descargada en este dispositivo');
  if (P.shuffle) player.toggleShuffle();
  player.playQueue(l);
}

const ACTIONS = {
  play(el) {
    const r = rowInfo(el);
    if (!r?.track) return;
    if (!playable(r.track)) return toast(notPlayable());
    if (r.key === 'q') player.jump(r.i);
    else if (r.key === 'u') player.jumpUser(r.i);
    else if (r.track.radio) player.playQueue([r.track]);
    else {
      const list = (r.opts.playAll || r.tracks).filter(playable);
      player.playQueue(list, Math.max(0, list.indexOf(r.track)), r.opts.playlist ? { playlist: r.opts.playlist } : null);
    }
  },
  fav(el) { const r = rowInfo(el); if (r?.track) toggleFav(r.track.id); },
  more(el) { const r = rowInfo(el); if (r?.track) trackMenu(r.track, r.opts, r.i); },
  'lib-bucket'(el) { toggleBucket(el.dataset.bid); },
  'kb-story'(el) { openStory(el.dataset.k); },
  'play-surprise'() {
    const l = modes.surpriseOrder(firstList().filter(playable), S.settings.surpriseHours || 24);
    if (!l.length) return;
    if (P.shuffle) player.toggleShuffle();
    player.playQueue(l); toast('Modo sorpresa: lo que escuchaste hace poco, al final');
  },
  'play-ambient'() {
    const plan = modes.ambientPlan(firstList().filter(playable));
    if (!plan.ok) return toast(plan.why, 7000);
    if (P.shuffle) player.toggleShuffle();
    player.playQueue(plan.list); toast('Modo ambiente: de lo tranquilo a lo intenso, y vuelta a la calma');
  },
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
  'q-promote'(el) { const r = rowInfo(el); if (r && r.key === 'q' && player.queueUpcoming(r.i)) toast(`«${r.track.title}» añadida a tu cola`); },
  'q-promote-all'() {
    const n = player.promote(P.queue.map((_, i) => i));
    if (n) toast(`${plural(n, 'canción pasada', 'canciones pasadas')} a tu cola`);
  },
  'cloud-sync'() { cloudSync(); },
  'cloud-upload-all'() { if (cloud.uploadTarget()) uploadMany(everyTrack().filter(t => t.hasBlob && !t.cloudName && !t.url)); },
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
  'cloud-report'() { showReport(); },
  'cloud-tags-stop'() { if (bulk) { bulk.stop = true; toast('Deteniendo al terminar el archivo actual…'); } },
  'write-files'() { if (!devOn()) return; const l = everyTrack().filter(t => fileOutdated(t) && cloud.canWriteFile(t)); if (l.length) offerWrite(l); },
  'lib-unfilter'(el) { clearFilter(el.dataset.k, el.dataset.v); paintLibrary(); },
  'lib-clear'() { resetFilters(); paintLibrary(); },
  async 'explore-retry'() { await rdata.pull(); refresh(); },
  'lib-quick'(el) { toggleFilter(el.dataset.k, el.dataset.v); paintLibrary(); },
  'lib-q-clear'() {
    const q = $('#lib-q');
    if (!q) return;
    q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); q.focus();
  },
  'lib-sort'(el) {
    const tab = el.dataset.tab, [key, map, , what] = SORTS[tab], cur = sortOf(tab);
    menu(`<div class="sheet-head"><div><b>Ordenar ${what}</b></div></div>`, Object.entries(map).map(([k, [l]]) => ({
      icon: k === cur ? 'check' : 'blank', label: l,
      fn: async () => { S.settings[key] = k; await saveKV('settings', false); paintLibrary(); },
    })));
  },
  'play-album'(el) { const a = albums().find(x => x.key === el.dataset.key); if (a) playInOrder(a.tracks.sort(byTrackNo)); },
  'play-artist'(el) { const a = artists().find(x => x.name === el.dataset.key); if (a) playInOrder(a.tracks.sort(byTrackNo)); },
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
    if (!devOn()) return;
    const groups = lib.findDuplicates(dupKeep);
    const keepOf = new Map(), list = [];
    for (const g of groups) for (const t of g.tracks.slice(1)) { list.push(t); keepOf.set(t.id, g.tracks[0]); }
    if (!list.length) return;
    const inCloud = list.filter(t => t.cloudName).length;
    if (!(await confirmDlg(`¿Borrar ${plural(list.length, 'copia repetida', 'copias repetidas')}?`,
      `Se conserva una copia de cada canción.${inCloud ? ` ${plural(inCloud, 'copia está', 'copias están')} en la nube: se ${inCloud === 1 ? 'borrará' : 'borrarán'} también del bucket y desaparecerá${inCloud === 1 ? '' : 'n'} en todos tus dispositivos.` : ''} No se puede deshacer.`, 'Borrar'))) return;
    await deleteForever(list, keepOf);
  },
  async 'oci-forget'() {
    await oci.forget();
    S.settings.dev = false; await saveKV('settings', false);
    toast('Clave de Oracle quitada de este dispositivo: el modo desarrollador queda desactivado'); refresh();
  },
  async 'oci-recheck'() {
    const t = toast('Comprobando la clave con Oracle…', 0);
    try { const own = await cloud.verifyKey(); t.done(own.length ? 'Clave comprobada' : 'La clave no tiene permiso sobre ningún bucket conectado', 6000); }
    catch (e) { t.done(e.message, 9000); }
    refresh();
  },
  async 'group-rotate'(el) {
    if (!(await confirmDlg('¿Renovar el grupo?', 'Se cambia la clave del grupo de este bucket. Quien siga pudiendo leer el bucket entra solo de nuevo al sincronizar; quien ya no (por ejemplo, un enlace que revocaste en la consola de Oracle) deja de ver las playlists compartidas.', 'Renovar'))) return;
    const t = toast('Renovando…', 0);
    try { await groups.rotate(el.dataset.bid); await groups.sync(); t.done('Grupo renovado'); }
    catch (e) { t.done(e.message, 8000); }
  },
  async 'group-name'(el) {
    const g = groups.of(el.dataset.bid);
    if (!g?.id) return;
    const name = await ask({ title: 'Tu nombre en el grupo', text: 'Lo verán quienes comparten este bucket al compartir playlists contigo. Nunca se muestra tu correo.', value: g.name || '', placeholder: 'Por ejemplo, Pablo', ok: 'Guardar' });
    if (name === null) return;
    try { await groups.setName(g.id, name); toast('Nombre guardado'); } catch (e) { toast(e.message, 6000); }
  },
  async 'fx-reset'() { await setFx({ ...fades.DEFAULTS }); toast('Transiciones restauradas'); refresh(); },
  'help-path'(el) { helpPath = el.dataset.path; refresh(); },
  async 'sp-reset'() { await setSpatial({ mode: spatial.DEFAULTS.mode, intensity: spatial.DEFAULTS.intensity, speed: spatial.DEFAULTS.speed }); toast('Ajustes de audio espacial restaurados'); refresh(); },
  async 'share-revoke'(el) {
    const b = cloud.buckets().find(x => x.id === el.dataset.bid);
    if (!b || !(await confirmDlg(`¿Revocar el enlace de ${el.dataset.who}?`, `Dejará de funcionar al momento: ${el.dataset.who} ya no podrá escuchar ni descargar las canciones de «${b.name}». Lo que ya descargó en su dispositivo no se puede borrar desde aquí.`, 'Revocar'))) return;
    const t = toast('Revocando…', 0);
    try {
      await oci.revokeShare(b.url, el.dataset.pid);
      // nueva clave del grupo: quien ya no puede leer el bucket deja de ver las playlists compartidas
      const rotated = await groups.rotate(b.id).catch(e => { console.warn('Grupo', e); return false; });
      t.done(rotated ? 'Enlace revocado: ya no puede escuchar el bucket ni ver las playlists que se le compartieron' : 'Enlace revocado');
    } catch (e) { t.done(e.message, 8000); }
    loadShares();
  },
  async 'oci-purge'() {
    if (!devReady() || !(await confirmDlg('¿Borrar los archivos vacíos?', 'Se buscarán en tus buckets los archivos de audio vacíos (canciones borradas antes de añadir la clave) y se eliminarán de Oracle.', 'Borrar'))) return;
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
  async 'ai-covers'() {
    if (!devOn()) return;
    const list = everyTrack().filter(needsCover);
    const A = aiConf(), service = ai.PROVIDERS[A.provider].name;
    if (!list.length || !(await confirmDlg(`¿Buscar la portada de ${plural(list.length, 'canción', 'canciones')}?`,
      `Se enviarán el título, los artistas, el álbum y el año de cada canción a ${service} con tu clave (puede tener un coste en tu cuenta), y el nombre del disco y del artista a Apple (iTunes), a YouTube Music (a través de Piped) y a MusicBrainz para descargar la portada. Si no hay portada del disco, se usa una del mismo álbum o artista, o se genera una. Se escriben en los archivos y se suben a la nube.`, 'Buscar portadas'))) return;
    findCovers(list);
  },
  async 'ai-all'() {
    if (!devOn()) return;
    const n = [everyTrack().filter(albumPending).length, everyTrack().filter(needsCover).length, everyTrack().filter(needsTags).length];
    if (!n.some(Boolean)) return;
    const A = aiConf(), service = ai.PROVIDERS[A.provider].name;
    if (!(await confirmDlg('¿Completar lo que falta?',
      `Se hace en tres pasos, cada uno con lo que dejó el anterior: ${[n[0] && `álbum de ${plural(n[0], 'canción', 'canciones')}`, n[1] && `portada de ${n[1]}`, n[2] && `géneros y lo que transmite de ${n[2]}`].filter(Boolean).join(', ')} (el número puede cambiar al ir completándose). Álbumes y portadas se buscan primero en Apple (iTunes), YouTube Music y MusicBrainz, sin IA; a ${service} solo van las que no aparecen y el etiquetado, con tu clave (puede tener un coste en tu cuenta). Al final todo se escribe en los archivos y se sube a la nube.`, 'Completar'))) return;
    completeAll();
  },
  async 'ai-albums'() {
    if (!devOn()) return;
    const list = everyTrack().filter(albumPending);
    const A = aiConf(), service = ai.PROVIDERS[A.provider].name;
    if (!list.length || !(await confirmDlg(`¿Buscar el álbum de ${plural(list.length, 'canción', 'canciones')}?`,
      `Primero se busca cada canción, por su título y artista, en Apple (iTunes) y MusicBrainz. Solo las que no aparezcan se envían a ${service} con tu clave (puede tener un coste en tu cuenta), y lo que proponga se comprueba en esos catálogos antes de ponerlo. Los álbumes se escriben en los archivos y se suben a la nube.`, 'Buscar álbumes'))) return;
    findAlbums(list);
  },
  async 'ai-tag-all'() {
    if (!devOn()) return;
    const list = everyTrack().filter(needsTags);
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
// Playlists (vista, editor, fotos, capítulos…): playlist-ui.js, con los datos de playlists-data.js
const PL = initPlaylists({
  esc, enc, plural, totalTime, toast, openSheet, sheet, confirmDlg, menu, ask, show, rows, cover, empty, refresh, playable, num,
  columns, bars, allTracks, needsDownload, downloadMany, setHTML, watch: watchSentinels, saveKV, ACTIONS,
});
const PF = initProfile({ esc, plural, toast, openSheet, sheet, confirmDlg, show, empty, refresh: () => refresh(), num, statsBody, bars, rows, playable, ACTIONS });
const EX = initExplore({
  esc, enc, plural, toast, openSheet, sheet, menu, show, rows, cover, empty, setHTML, watch: watchSentinels, ACTIONS, playable,
  saveToLibrary, trackMenu: t => trackMenu(t, {}), confirmDlg, ask, PL, go: h => go(h), refresh: () => refresh(), saveKV,
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el, e);
});
document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  form.dataset.sent = '1';   // ya enviado: no impide volver a pintar Ajustes
  const kind = form.dataset.form;
  if (EX.forms[kind]) return EX.forms[kind](form);
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
      try { if (!(await cloud.verifyKey()).length) throw new Error('La clave no tiene permiso sobre ningún bucket conectado'); }
      catch (err) { await oci.forget(); throw err; }
      t.done('Clave de Oracle conectada: ya puedes activar el modo desarrollador y compartir tu bucket', 6000);
      refresh();
    } catch (err) { t.done(err.message, 9000); }
  }
  if (kind === 'share') {
    const b = cloud.ownedBuckets().find(x => x.id === form.dataset.bid);
    if (!b) return;
    const who = form.who.value.trim(), btn = $('button', form);
    btn.disabled = true;
    const t = toast('Creando el enlace en Oracle…', 0);
    try {
      const url = await oci.createShare(b.url, who, form.days.value);
      t.done('Enlace creado', 2500);
      form.reset();
      showShareLink(who, url);
    } catch (err) { t.done(err.message, 8000); }
    btn.disabled = false;
    loadShares();
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
// En las listas, hacia la derecha: a tu cola. En la cola del reproductor solo se deslizan las de la
// reproducción automática, que pasan a tu cola (las demás ya están en ella o en la lista que suena).
let swipe = null, swallowClick = false;
const SWIPE_ADD = 80;
const endSwipe = add => {
  if (!swipe) return;
  const { row, track, active, auto } = swipe;
  swipe = null;
  row.classList.remove('swiping', 'armed');
  row.style.removeProperty('--dx');
  if (!active) return;
  swallowClick = true; setTimeout(() => { swallowClick = false; }, 350);
  if (!add) return;
  if (auto >= 0) { if (player.queueUpcoming(auto)) toast(`«${track.title}» añadida a tu cola`); }
  else { player.enqueue([track]); toast(`«${track.title}» añadida a tu cola`); }
};
for (const box of [view, $('#now')]) {
  box.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || e.target.closest('[data-drag]')) return;
    const row = e.target.closest('.row');
    const info = row && rowInfo(row);
    if (!info?.track || info.track.radio || !playable(info.track) || info.key === 'u') return;
    const auto = info.key === 'q' ? info.i : -1;
    if (auto >= 0 && !player.isUpcoming(auto)) return;
    swipe = { row, track: info.track, auto, x: e.clientX, y: e.clientY, dx: 0, active: false };
  });
  box.addEventListener('pointermove', e => {
    if (!swipe) return;
    if (document.body.classList.contains('dnd')) { endSwipe(false); return; }   // se está arrastrando la canción a otro sitio
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (!swipe.active) {
      if (dx > 14 && dx > Math.abs(dy) * 1.5) { swipe.active = true; swipe.row.classList.add('swiping'); }
      else if (Math.abs(dy) > 14 || dx < -14) { swipe = null; return; }
      else return;
    }
    swipe.dx = Math.max(0, Math.min(dx, 150));
    swipe.row.style.setProperty('--dx', `${swipe.dx}px`);
    swipe.row.classList.toggle('armed', swipe.dx >= SWIPE_ADD);
  });
  box.addEventListener('pointerup', () => endSwipe(swipe?.dx >= SWIPE_ADD));
  box.addEventListener('pointercancel', () => endSwipe(false));
}
document.addEventListener('click', e => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);

// ------------------------- deslizar la canción que suena: a la izquierda, la siguiente; a la derecha, la anterior
// Funciona en el mini reproductor y en la carátula de la pantalla «Reproduciendo». Las radios en directo no.
let nowSwipe = null;
const SWIPE_SKIP = 70;
document.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return;
  const el = e.target.closest('[data-swipe-now]');
  if (!el || !P.current || P.current.radio) return;
  nowSwipe = { el, id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false };
});
document.addEventListener('pointermove', e => {
  const s = nowSwipe;
  if (!s || e.pointerId !== s.id) return;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (!s.active) {
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) { s.active = true; s.el.classList.remove('snap'); s.el.classList.add('now-swiping'); }
    else if (Math.abs(dy) > 12) { nowSwipe = null; return; }
    else return;
  }
  s.dx = Math.max(-170, Math.min(170, dx));
  s.el.style.setProperty('--sx', `${s.dx}px`);
  s.el.style.setProperty('--so', String(1 - Math.min(0.45, Math.abs(s.dx) / 400)));
  s.el.classList.toggle('armed', Math.abs(s.dx) >= SWIPE_SKIP);
});
function endNowSwipe(go) {
  const s = nowSwipe;
  nowSwipe = null;
  if (!s?.active) return;
  swallowClick = true; setTimeout(() => { swallowClick = false; }, 350);
  const skip = go && Math.abs(s.dx) >= SWIPE_SKIP;
  s.el.classList.remove('now-swiping', 'armed');
  s.el.classList.add('snap');
  s.el.style.removeProperty('--sx'); s.el.style.removeProperty('--so');
  if (!skip) return;
  if (s.dx < 0) player.next(); else player.prev();
}
document.addEventListener('pointerup', e => { if (nowSwipe && e.pointerId === nowSwipe.id) endNowSwipe(true); });
document.addEventListener('pointercancel', e => { if (nowSwipe && e.pointerId === nowSwipe.id) endNowSwipe(false); });

// ------------------------------------------------------- importar archivos
async function runImport(files) {
  if (!files?.length) return;
  const t = toast('Preparando…', 0);
  const r = await lib.importFiles(files, (i, n, name) => t.set(`Añadiendo ${i} de ${n}: ${name}`));
  if (!r.total) return t.done('No se encontraron archivos de audio');
  if (r.added) emit('library-added', r.added);
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
let nowMode = 'cover';       // cover | lyrics | info | queue
let seeking = false;
const REPEAT_LABEL = { off: 'Repetir', all: 'Repitiendo todo', one: 'Repitiendo una' };

function renderMini() {
  const t = P.current;
  mini.hidden = !t;
  if (!t) return;
  setHTML(mini, `<div class="line"><i></i></div><div class="bar">
    <button class="open" data-act="open-now" data-swipe-now aria-label="Abrir reproductor">${cover(t)}<span class="row-text"><b>${esc(t.title)}</b><small>${artistLinks(t)}</small></span></button>
    <div class="desk center"><div class="ctl">
        <button class="icon-btn js-shuffle" data-act="shuffle" aria-label="Aleatorio">${icon('shuffle')}</button>
        <button class="icon-btn" data-act="prev" aria-label="Anterior">${icon('prev')}</button>
        <button class="icon-btn play js-play" data-act="toggle" aria-label="Reproducir o pausar"></button>
        <button class="icon-btn" data-act="next" aria-label="Siguiente">${icon('next')}</button>
        <button class="icon-btn js-repeat" data-act="repeat"></button></div>
      <div class="seek"><span class="js-cur">0:00</span><input type="range" class="js-seek" min="0" max="1000" value="0" aria-label="Posición"><span class="js-dur"></span></div></div>
    <div class="desk right">
      ${inLibrary(t) ? `<button class="icon-btn fav js-fav" data-act="now-fav" aria-label="Me gusta">${icon('heart')}</button>` : ''}
      <input type="range" class="vol js-vol" min="0" max="100" value="${Math.round(player.volume() * 100)}" style="--p:${Math.round(player.volume() * 100)}%" aria-label="Volumen"></div>
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
  if (t.radio && t.uuid) {
    // Emisora en directo: pantalla propia (mismo reproductor, controles de directo)
    setHTML(now, EX.liveHTML(t));
    syncState();
    EX.fillLive(now, t);
    return;
  }
  const modes = [['cover', 'Carátula'], ['lyrics', 'Letra'], ['info', 'Info'], ['queue', 'Cola']];
  setHTML(now, `<div class="top">
      <button class="icon-btn" data-act="close-now" aria-label="Cerrar">${icon('down')}</button>
      <div class="seg">${modes.map(([m, l]) => `<button data-act="now-mode" data-mode="${m}">${l}</button>`).join('')}</div>
      <button class="icon-btn" data-act="now-more" aria-label="Más opciones">${icon('more')}</button></div>
    <div class="body"><div class="left">
      <div class="stage" data-swipe-now>${cover(t)}</div>
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
  if (now.hidden || (P.current?.radio && P.current.uuid)) return;   // la pantalla de directo tiene su propio panel
  const pane = $('.pane', now), stage = $('.stage', now);
  if (!pane) return;
  const desktop = matchMedia('(min-width: 900px)').matches;
  $$('.seg button', now).forEach(b => {
    b.classList.toggle('on', b.dataset.mode === nowMode || (desktop && nowMode === 'cover' && b.dataset.mode === 'lyrics'));
    if (b.dataset.mode === 'cover') b.hidden = desktop;
  });
  stage.hidden = nowMode !== 'cover';
  pane.hidden = nowMode === 'cover';
  if (nowMode === 'info') {
    const t = P.current;
    if (!t) return;
    if (t.radio) { pane.innerHTML = '<div class="lyrics-empty"><div>Emisión en directo: no hay información de canciones.</div></div>'; return; }
    setHTML(pane, `<div class="kb kb-now" data-kb-now="${esc(t.id)}"><h2 style="margin-top:0">${esc(t.title)}</h2><p class="muted kb-wait"><span class="spinner"></span>Buscando información…</p></div>`);
    pane.scrollTop = 0;
    const d = await kb.songInfo(songQuery(t));
    const box = $(`[data-kb-now="${CSS.escape(t.id)}"]`, pane);
    if (box && nowMode === 'info' && P.current?.id === t.id) setHTML(box, songKB(d, t));
    return;
  }
  if (nowMode === 'queue') {
    const t = P.current, from = P.index + 1;
    const upcoming = P.queue.slice(from, from + 300);
    const inAuto = P.autoFrom >= 0 && P.autoFrom <= from;
    const autoAll = '<button class="chip" data-act="q-promote-all">Añadir todas a tu cola</button>';
    setHTML(pane, `<h2 style="margin-top:0">Sonando</h2>
      ${t ? `<div class="row is-playing"><span class="row-main">${cover(t)}<span class="row-text"><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></span></span></div>` : ''}
      ${P.user.length ? `<div class="qhead"><h2>A continuación en tu cola</h2><button class="chip" data-act="clear-user-queue">Vaciar</button></div>
        <ol class="rows" data-list="u">${P.user.map((x, i) => rowHTML(x, i, { queue: true, user: true })).join('')}</ol>` : ''}
      ${upcoming.length ? `<div class="qhead"><h2>${inAuto ? 'Reproducción automática' : P.user.length ? 'Después, de lo que estabas escuchando' : 'A continuación'}</h2>${inAuto ? autoAll : ''}</div>
        <ol class="rows" data-list="q">${upcoming.map((x, k) => (from + k === P.autoFrom && !inAuto ? `<li class="qdivider"><span>Reproducción automática · canciones parecidas</span>${autoAll}</li>` : '') + rowHTML(x, from + k, { queue: true, auto: player.isUpcoming(from + k) })).join('')}</ol>` : ''}
      ${upcoming.length ? '<p class="muted small">Desliza una canción hacia la derecha (o pulsa +) para pasarla a tu cola.</p>' : ''}
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
  if (nowMode === 'queue' || nowMode === 'info' || !lyr.data || P.current?.id !== lyr.id) return;
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
  if (!lines || now.hidden || nowMode === 'queue' || nowMode === 'info' || P.current?.id !== lyr.id) return;
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
  document.body.classList.toggle('audio-on', !!P.playing);
  document.body.classList.toggle('live', !!t?.radio);   // directo: sin barra de posición ni anterior/siguiente   // anima el indicador de la fila que suena
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
// Transiciones: los deslizadores se aplican mientras se mueven (y se guardan al soltarlos).
document.addEventListener('input', e => {
  const k = e.target.dataset?.fx;
  if (!['cross', 'fadeIn', 'fadeOut'].includes(k)) return;
  const v = +e.target.value, [lo, hi] = fades.LIMITS[k];
  e.target.style.setProperty('--p', `${((v - lo) / (hi - lo)) * 100}%`);
  S.settings.fx = fades.settings({ ...fades.settings(), [k]: v });
  const out = $(`[data-fx-val="${k}"]`); if (out) out.textContent = secs(v);
  const txt = $(`[data-fx-text="${k}"]`); if (txt) txt.textContent = fxSecsText(k, v);
});
// Audio espacial: los deslizadores actúan mientras se mueven; el resto, al cambiar.
document.addEventListener('input', e => {
  const k = e.target.dataset?.sp;
  if (k !== 'intensity' && k !== 'speed') return;
  const v = +e.target.value;
  e.target.style.setProperty('--p', `${v}%`);
  const out = $(`[data-sp-val="${k}"]`); if (out) out.textContent = `${v} %`;
  S.settings.spatial = { ...spatial.settings(), [k]: v };
  spatial.apply();
  const sp = $('[data-sp-speed]'); if (sp) sp.textContent = spatialSpeedText(spatial.settings());
});
document.addEventListener('change', async e => {
  const fxk = e.target.dataset?.fx;
  if (fxk) {
    await setFx({ [fxk]: e.target.type === 'checkbox' ? e.target.checked : fxk === 'mode' ? e.target.value : +e.target.value });
    if (fxk === 'mode') refresh();
    return;
  }
  const spk = e.target.dataset?.sp;
  if (spk) {
    await setSpatial({ [spk]: spk === 'on' ? e.target.checked : spk === 'mode' ? e.target.value : +e.target.value });
    if (spk === 'on' || spk === 'mode') refresh();
    return;
  }
  if (e.target.matches?.('[data-ai-provider]')) { e.target.form.dataset.sent = '1'; aiConf().provider = e.target.value; await saveKV('settings', false); return refresh(); }
  const key = e.target.dataset?.toggle;
  if (!key) return;
  if (key === 'dev' && e.target.checked && !devReady()) { e.target.checked = false; return toast('El modo desarrollador necesita la clave de API de Oracle con permiso sobre un bucket conectado', 6000); }
  S.settings[key] = e.target.checked;
  S.settings[key + 'At'] = Date.now();
  await saveKV('settings', false);
  if (key === 'dev') return refresh();   // solo cambia lo que se ve en este dispositivo
  emit('dirty');
});
addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/' && $('#lib-q')) { e.preventDefault(); $('#lib-q').focus(); return; }
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
on('track', () => { if (!now.hidden && (nowMode === 'queue' || nowMode === 'info')) renderNowPane(); });
on('favs', id => {
  syncState();
  if (id) $$('.row').forEach(r => { if (r.dataset.id === id) $('.fav', r)?.classList.toggle('on', isFav(id)); });
  if (!id) refresh();   // «Canciones que te gustan» se actualiza sola (playlists-data.js) y avisa con 'playlists'
});
on('library', refresh);
on('playlists', () => { if (/^#\/(playlists?|favoritos)/.test(location.hash) && !document.querySelector('#sheet[open] .pl-editor')) refresh(); });

// -------------------------------------------------------------------- arranque
async function accountSync() {
  if (!account.user() || !navigator.onLine) return;
  try { await account.sync(); } catch (e) { console.warn('Cuenta sin sincronizar', e); }
}
on('account', refresh);
on('cloud-changed', async () => {
  // Buckets que llegan de la cuenta: se comprueba en cuáles tiene permiso la clave de este dispositivo.
  if (oci.configured() && navigator.onLine) await cloud.verifyKey().catch(e => console.warn('Clave de Oracle', e));
  refresh(); cloudSync(true);
});
on('volume', v => { player.applyVolume(v); });

async function start() {
  try { await load(); }
  catch (e) {
    console.error(e);
    view.innerHTML = `<div class="wrap">${empty('x', 'No se pudo abrir la biblioteca', 'El navegador ha bloqueado el almacenamiento. Si estás en una ventana privada, prueba en una normal.')}</div>`;
    return;
  }
  if (typeof S.settings.volume === 'number') player.applyVolume(S.settings.volume);
  netState(false);
  cloud.migrate();
  await sealAiKeys().catch(e => console.warn('No se pudieron cifrar las claves de IA', e));
  if (devOn()) {
    const pending = everyTrack().filter(t => fileOutdated(t) && cloud.canWriteFile(t)).length;
    if (pending) setTimeout(() => toast(`${plural(pending, 'canción tiene', 'canciones tienen')} géneros u otros cambios que aún no están en su archivo. Guárdalos en Ajustes → Modo desarrollador.`, 9000), 1500);
  }
  const linked = await account.init();   // puede venir de un enlace de correo de Supabase
  await pldata.init();
  await habits.init();                  // resúmenes diarios para la criatura sonora
  await groups.init();                  // grupos de los buckets (playlists compartidas)
  await rdata.init();                    // Explorar: favoritas, colecciones, pasaporte y preferencias                   // playlists: datos nuevos, cola pendiente y sincronización con Supabase
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
  // En el móvil la app suele quedarse en segundo plano días enteros sin volver a arrancar: se
  // sincroniza al volver a ella y, mientras está abierta, cada 5 minutos.
  const autoSync = () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastAutoSync < 60000) return;
    lastAutoSync = Date.now();
    accountSync(); cloudSync(true);
  };
  document.addEventListener('visibilitychange', autoSync);
  setInterval(autoSync, 5 * 60000);
}
let lastAutoSync = Date.now();
start();
