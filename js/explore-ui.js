// Explorar: descubrimiento de música libre y radios en una sola sección.
//   Vistas:  Para ti · Música libre · Radios (selector dentro de la página, no en el menú principal).
//   Buscador universal con resultados agrupados por tipo (canciones, álbumes, artistas, emisoras,
//   países, etiquetas); cada fuente se consulta por separado y el fallo de una no bloquea las demás.
//   Experiencias: ambientes, géneros (y Universo), ciudades con hora local, países, Ruleta, Sorpréndeme,
//   Atlas (globo/mapa, carga diferida), Radar, Pasaporte, Viajes, Degustación, Mezclador, favoritas y colecciones.
// Los datos de usuario están en radio-data.js; el directorio de emisoras en radio.js; la lógica sin
// interfaz en discover.js; las sesiones por tiempo en session.js.
import { S, on, emit } from './store.js';
import * as player from './player.js';
import { P } from './player.js';
import * as src from './sources.js';
import * as radio from './radio.js';
import * as dsc from './discover.js';
import * as data from './radio-data.js';
import * as session from './session.js';
import * as account from './account.js';
import { icon } from './icons.js';
import { JAMENDO_CLIENT_ID } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const hueOf = str => { let h = 0; for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const cap = s => String(s || '').replace(/^\p{L}/u, m => m.toUpperCase());

export function initExplore(c) {
  const { esc, enc, plural, toast, openSheet, sheet, menu, show, rows, cover, empty, setHTML, watch, ACTIONS, playable, saveToLibrary, trackMenu, confirmDlg, ask, PL } = c;
  const view = $('#view');
  const jamendoKey = () => JAMENDO_CLIENT_ID || S.settings.jamendoId || '';

  // ========================================================== estado
  const VIEWS = [['', 'Para ti'], ['libre', 'Música libre'], ['radios', 'Radios']];
  const X = { tab: '', q: '', scope: 'all', cat: 'all', cc: '', lang: '', res: {}, resKey: '', ctrl: null, timer: null };
  // Búsqueda clásica por catálogo (la de siempre de «Música libre», con «Más resultados»)
  const L = { src: 'archive', q: '', results: {}, more: {}, page: {}, loading: false, error: '' };
  const SUGGEST = ['jazz', 'música clásica', 'flamenco', 'blues', 'netlabel', 'ambient', 'folk', 'chiptune'];

  // Registro de lo pintado (los botones llevan solo una clave).
  const stations = new Map();   // uuid -> emisora
  const songLists = new Map();  // clave -> [pistas]
  let listSeq = 0;
  const regSt = s => { stations.set(s.uuid, s); return s; };
  const regSongs = list => { const k = 'x' + (++listSeq); songLists.set(k, list); return k; };

  // ========================================================== piezas
  const initials = t => String(t || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map(w => [...w][0]).join('').toUpperCase() || '♪';
  function logo(st, cls = '') {
    regSt(st);
    return `<span class="st-logo ${cls}" style="--hue:${hueOf(st.title)}"><i>${esc(initials(st.title))}</i>${st.coverUrl ? `<img src="${esc(st.coverUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</span>`;
  }
  const where = st => [radio.flag(st.cc), radio.countryName(st.cc), st.state && st.state !== radio.countryName(st.cc) ? st.state : ''].filter(Boolean).join(' ');
  const favBtn = st => `<button class="icon-btn fav ${data.isFav(st.uuid) ? 'on' : ''}" data-act="x-fav" data-uuid="${esc(st.uuid)}" aria-label="${data.isFav(st.uuid) ? 'Quitar de favoritas' : 'Guardar en favoritas'}" aria-pressed="${data.isFav(st.uuid)}">${icon('heart')}</button>`;
  const isOn = st => P.current?.id === st.id;
  /** Tarjeta de emisora (carruseles). */
  const stCard = (st, extra = '') => `<div class="st-card ${isOn(st) ? 'on' : ''}" data-uuid="${esc(regSt(st).uuid)}">
      <button class="st-open" data-act="x-open" data-uuid="${esc(st.uuid)}" aria-label="Ficha de ${esc(st.title)}">${logo(st)}<b>${esc(st.title)}</b><small>${esc(where(st))}</small>
        ${st.tags.length ? `<small class="st-tags">${esc(st.tags.slice(0, 3).join(' · '))}</small>` : ''}${extra}</button>
      <button class="st-play" data-act="x-play" data-uuid="${esc(st.uuid)}" aria-label="Escuchar ${esc(st.title)}">${icon('play')}</button></div>`;
  /** Fila de emisora (listas). */
  const stRow = (st, extra = '') => `<li class="st-row ${isOn(st) ? 'on' : ''}" data-uuid="${esc(regSt(st).uuid)}">
      <button class="st-main" data-act="x-play" data-uuid="${esc(st.uuid)}">${logo(st, 'sm')}<span><b>${esc(st.title)}</b><small>${esc([where(st), st.tags.slice(0, 2).join(', ')].filter(Boolean).join(' · '))}${extra}</small></span></button>
      ${favBtn(st)}<button class="icon-btn" data-act="x-more" data-uuid="${esc(st.uuid)}" aria-label="Más opciones">${icon('more')}</button></li>`;
  const stList = (list, extra) => `<ol class="st-list">${list.map(s => stRow(s, extra?.(s) || '')).join('')}</ol>`;
  const strip = (items, cls = '') => `<div class="x-strip ${cls}">${items.join('')}</div>`;
  /** Tarjeta de canción de un catálogo libre. */
  function songCard(list, i, k) {
    const t = list[i];
    return `<div class="song-card"><button class="song-main" data-act="x-song" data-k="${k}" data-i="${i}" aria-label="Escuchar ${esc(t.title)}">${cover(t)}<span class="song-play">${icon('play')}</span></button>
      <span class="song-text"><b title="${esc(t.title)}">${esc(t.title)}</b><small>${esc(t.artist || '')}</small>${t.license ? `<small class="lic">${esc(t.license)}${t.matched ? ` · ${esc(t.matched)}` : ''}</small>` : ''}</span>
      <button class="icon-btn song-more" data-act="x-song-more" data-k="${k}" data-i="${i}" aria-label="Más opciones">${icon('more')}</button></div>`;
  }
  const songStrip = list => { const k = regSongs(list); return strip(list.map((_, i) => songCard(list, i, k)), 'songs'); };
  const albumCardIA = r => `<a class="card ia" href="#/archivo/${enc(r.id)}">${cover({ album: r.title, coverUrl: r.cover })}<span><b>${esc(r.title)}</b><small>${esc(r.creator || r.year || '')}</small></span></a>`;
  const ambientCard = a => `<a class="amb-card" href="#/explorar/ambiente/${a.id}" style="--c1:${a.colors[0]};--c2:${a.colors[1]};--c3:${a.colors[2]}">
      <span class="amb-art">${dsc.ambientArt(a)}</span><span class="amb-text"><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></span></a>`;
  const genreTile = g => `<a class="tile" href="#/explorar/genero/${g.id}" style="--hue:${dsc.genreHue(g.id)}"><span class="tile-text"><b>${esc(g.name)}</b><small>${esc(g.sub.slice(0, 3).join(' · '))}</small></span><span class="tile-art">${icon('disc')}</span></a>`;
  function cityCard(cty) {
    const m = dsc.localMoment(cty);
    const [a, b, d] = dsc.SKY[m.moment];
    return `<a class="city-card" href="#/explorar/ciudad/${cty.id}" style="--s1:${a};--s2:${b};--s3:${d}" data-city="${cty.id}">
      <span class="city-sky ${m.moment}"><span class="sun" style="--el:${Math.max(-20, Math.min(60, m.elevation)).toFixed(1)}"></span></span>
      <span class="city-text"><small>${esc(m.phrase)}</small><b>${esc(cty.name)}</b><span>${radio.flag(cty.cc)} ${esc(radio.countryName(cty.cc))} · <time>${m.time}</time></span></span></a>`;
  }
  const expCard = (href, ic, title, sub, hue) => `<a class="exp-card" href="${href}" style="--hue:${hue}"><span class="badge">${icon(ic)}</span><span><b>${title}</b><small>${sub}</small></span></a>`;
  const EXPERIENCES = () => [
    expCard('#/explorar/ruleta', 'dice', 'Radio Roulette', 'Gira el dial y descubre una emisora real', 330),
    expCard('#/explorar/atlas', 'compass', 'Fiora Atlas', 'Emisoras sobre el mapa del mundo', 200),
    expCard('#/explorar/universo', 'spark', 'Universo musical', 'Géneros que se conectan entre sí', 270),
    expCard('#/explorar/viaje', 'wave', 'Viajes musicales', 'De ciudad en ciudad, con radios de cada sitio', 30),
    expCard('#/explorar/degustar', 'radio', 'Degustación', 'Varias emisoras seguidas, unos segundos cada una', 160),
    expCard('#/explorar/pasaporte', 'star', 'Pasaporte musical', 'Los países que has escuchado', 50),
  ];
  const errHTML = (e, retry) => `<div class="x-error">${icon('x')}<span>${esc(friendly(e))}</span>${retry ? `<button class="chip" data-act="x-retry" data-xb="${retry}">Reintentar</button>` : ''}</div>`;
  const friendly = e => (!navigator.onLine ? 'No hay conexión a internet.' : e?.limit ? e.message : e?.name === 'AbortError' ? 'Cancelado' : `No se pudo cargar: ${e?.message || 'error desconocido'}`);
  const skel = (n = 6, cls = '') => `<div class="x-strip skel ${cls}">${'<span class="sk"></span>'.repeat(n)}</div>`;

  // ========================================================== bloques con carga diferida
  // Cada bloque se pide cuando aparece en pantalla (no se lanza todo a la vez).
  let gen = 0, ctrl = null, blockObs = null;
  const loaders = new Map();
  function block(id, title, loader, { sub = '', link = '', cls = '' } = {}) {
    loaders.set(id, loader);
    return `<section class="xb ${cls}" data-xb="${id}"><div class="xb-head"><div><h2>${title}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}</div>${link}</div><div class="xb-body">${skel()}</div></section>`;
  }
  async function runBlock(el) {
    const id = el.dataset.xb, fn = loaders.get(id), my = gen;
    if (!fn) return;
    const body = $('.xb-body', el);
    try {
      const html = await fn(ctrl.signal);
      if (my !== gen || !el.isConnected) return;
      if (html === null) { el.remove(); return; }
      setHTML(body, html);
    } catch (e) {
      if (my !== gen || !el.isConnected || e?.name === 'AbortError') return;
      setHTML(body, errHTML(e, id));
    }
  }
  function armBlocks() {
    blockObs?.disconnect();
    blockObs = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { blockObs.unobserve(e.target); runBlock(e.target); } }, { root: view, rootMargin: '400px' });
    $$('[data-xb]', view).forEach(el => blockObs.observe(el));
  }
  function fresh() {
    gen++; ctrl?.abort(); ctrl = new AbortController(); loaders.clear();
    stations.clear(); songLists.clear(); clearInterval(clock); clock = null;
    stopRoulette(); universe = null;
    atlasMod?.unmount?.();
  }
  let clock = null;

  // ========================================================== cabecera y barra
  function head(tab) {
    return `<div class="head x-head"><h1>Explorar</h1><button class="btn sm surprise" data-act="x-surprise">${icon('spark')}<span>Sorpréndeme</span></button></div>
      <div class="bar-mark"></div>
      <div class="lib-bar x-bar">
        <label class="field lib-search">${icon('search')}<input id="x-q" type="search" placeholder="Canciones, artistas, emisoras, países, géneros…" aria-label="Buscar en Explorar" value="${esc(X.q)}" autocomplete="off" enterkeyhint="search">
          <button type="button" class="icon-btn clear" data-act="x-q-clear" aria-label="Borrar búsqueda" ${X.q ? '' : 'hidden'}>${icon('x')}</button></label>
        <nav class="seg" aria-label="Vistas de Explorar">${VIEWS.map(([id, l]) => `<a href="#/explorar${id ? '/' + id : ''}" class="${id === tab ? 'on' : ''}" ${id === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      </div>`;
  }
  const subHead = (title, back = '#/explorar', backLabel = 'Explorar', extra = '') => `<div class="x-sub"><a class="chip back" href="${back}">${icon('back')}${esc(backLabel)}</a>${extra}</div>${title ? `<div class="head"><h1>${title}</h1></div>` : ''}`;

  // ========================================================== router
  async function viewExplore(name = '', ...args) {
    name = String(name).split('?')[0];
    if (name === 'archivo') name = 'libre';   // dirección antigua
    fresh();
    const sub = SUBVIEWS[name];
    if (sub) { await sub(...args); watch(view); return; }
    X.tab = ['libre', 'radios'].includes(name) ? name : '';
    if (!X.q) X.scope = X.tab === 'libre' ? 'music' : X.tab === 'radios' ? 'radio' : 'all';
    show(`${head(X.tab)}<div id="x-body" class="x-fade">${X.q ? resultsHTML() : tabHTML(X.tab)}</div>`);
    afterPaint();
    if (X.q && X.resKey !== resKey()) runSearch();
  }
  function afterPaint() { armBlocks(); watchBar(); }
  function tabHTML(tab) { return tab === 'libre' ? viewFree() : tab === 'radios' ? viewRadios() : viewForYou(); }
  function paintBody(html) {
    const box = $('#x-body');
    if (!box) return;
    gen++; ctrl?.abort(); ctrl = new AbortController(); loaders.clear();
    setHTML(box, html);
    watch(box); armBlocks();
  }

  // Barra fija: misma técnica que la Biblioteca
  let barObs = null;
  function watchBar() {
    barObs?.disconnect();
    const m = $('.bar-mark', view); if (!m) return;
    const pad = parseFloat(getComputedStyle(view).paddingTop) || 0;
    barObs = new IntersectionObserver(([e]) => $('.x-bar')?.classList.toggle('stuck', !e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0) + 1), { root: view, rootMargin: `-${Math.ceil(pad)}px 0px 0px 0px` });
    barObs.observe(m);
  }

  // ========================================================== Para ti
  function viewForYou() {
    const prof = data.profile();
    const libGenres = topLibraryGenres();
    const enough = libGenres.length && [...S.tracks.values()].filter(t => t.genres?.length).length >= 15;
    const heard = data.historyList().length >= 3;
    const dayGenre = dsc.pickSeeded(dsc.GENRES, dsc.dayKey() + 'genre');
    const dayCities = shuffleSeeded(dsc.CITIES, dsc.dayKey() + 'cities').slice(0, 8);
    return `
      ${block('amb', 'Ambientes', async () => strip(dsc.AMBIENTS.map(ambientCard), 'amb'), { sub: 'Canciones y radios elegidas por sus etiquetas para cada momento' })}
      ${enough ? block('because', `Porque escuchas ${esc(cap(libGenres[0]))}`, async signal => {
        const list = await src.songsByTags(libGenres.slice(0, 2), { key: jamendoKey(), signal, n: 16 });
        const st = await radio.byTags(libGenres.slice(0, 2), { signal }).catch(() => []);
        if (!list.length && !st.length) return null;
        return `${list.length ? songStrip(list) : ''}${st.length ? `<h3 class="lib-sub">Emisoras</h3>${strip(mix(st).slice(0, 12).map(s => stCard(s)))}` : ''}`;
      }, { sub: 'Según los géneros de tu biblioteca' }) : ''}
      ${heard && !enough ? block('heard', 'Más como lo que has escuchado', async signal => {
        const tags = [...prof.tags].slice(0, 3);
        const st = tags.length ? await radio.byTags(tags, { signal }) : [];
        const seen = new Set(data.historyList().map(s => s.uuid));
        const list = st.filter(s => !seen.has(s.uuid));
        return list.length ? strip(mix(list).slice(0, 12).map(s => stCard(s))) : null;
      }, { sub: 'Por las etiquetas de las emisoras que has escuchado en este dispositivo' }) : ''}
      ${block('songs', 'Descubre canciones', async signal => {
        const list = await src.songsByTags([dayGenre.q, ...dayGenre.sub.slice(0, 1)], { key: jamendoKey(), signal, n: 18 });
        return list.length ? songStrip(mixSongs(list)) : `<p class="muted">Hoy no hay canciones libres etiquetadas como ${esc(dayGenre.name)}.</p>`;
      }, { sub: `Música libre etiquetada como ${esc(dayGenre.name.toLowerCase())} · cambia cada día`, link: `<a class="chip" href="#/explorar/genero/${dayGenre.id}">Ver ${esc(dayGenre.name)}</a>` })}
      ${block('featured', 'Radios destacadas', async signal => strip(mix(await radio.top('votes', { signal })).slice(0, 14).map(s => stCard(s))),
        { sub: 'Las más votadas en Radio Browser' })}
      ${block('daily', 'Descubrimiento del día', dailyBlock)}
      ${block('genres', 'Géneros', async () => `<div class="tiles">${dsc.GENRES.slice(0, 8).map(genreTile).join('')}</div>`, { link: '<a class="chip" href="#/explorar/universo">Universo musical</a>' })}
      ${block('cities', 'Destinos', async () => strip(dayCities.map(cityCard), 'cities'), { sub: 'Hora local real de cada ciudad', link: '<a class="chip" href="#/explorar/atlas">Abrir el Atlas</a>' })}
      ${block('exp', 'Experiencias', async () => `<div class="exp-grid">${EXPERIENCES().join('')}</div>`)}
      ${mixerPanel()}`;
  }
  function topLibraryGenres() {
    const m = new Map();
    for (const t of S.tracks.values()) for (const g of t.genres || []) m.set(g.toLowerCase(), (m.get(g.toLowerCase()) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  }
  function shuffleSeeded(arr, seed) { const r = dsc.seeded(seed), a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  async function dailyBlock(signal) {
    const list = await radio.top('votes', { signal, params: { limit: 200 } });
    const pool = list.filter(dsc.isMusic);
    const st = dsc.pickSeeded(pool.length ? pool : list, 'daily' + dsc.dayKey());
    if (!st) return '<p class="muted">Hoy no hay ninguna emisora disponible.</p>';
    return `<div class="daily">${logo(st, 'xl')}<div><small class="kicker">${new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</small>
      <h3>${esc(st.title)}</h3><p>${esc(where(st))}</p>${st.tags.length ? `<div class="chips">${st.tags.slice(0, 5).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
      <p class="muted small">${[st.langs.length ? `En ${st.langs.map(radio.langName).join(', ')}` : '', st.codec ? `${st.codec}${st.bitrate ? ` · ${st.bitrate} kbps` : ''}` : ''].filter(Boolean).join(' · ')}${st.homepage ? ` · <a href="${esc(st.homepage)}" target="_blank" rel="noopener noreferrer">Web de la emisora</a>` : ''}</p>
      <div class="actions"><button class="btn primary" data-act="x-play" data-uuid="${esc(st.uuid)}">${icon('play')}Escuchar</button>${favBtn(st)}</div></div></div>`;
  }

  // ========================================================== mezclador
  const MIX_AXES = [
    ['fam', 'Familiar', 'Sorprendente', 'Compara con los géneros de tu biblioteca y los países y etiquetas de las emisoras que escuchas.'],
    ['intl', 'Local', 'Internacional', 'Compara el país de cada emisora con el tuyo. No se aplica a canciones (los catálogos no indican país).'],
    ['energy', 'Tranquilo', 'Energético', dsc.ENERGY_RULE],
  ];
  const mixOn = () => { const m = data.prefs().mix; return ['fam', 'intl', 'energy'].some(k => Math.abs((m[k] ?? 0.5) - 0.5) > 0.05); };
  const home = () => dsc.homeCountry(data.prefs().home);
  const mix = list => dsc.mixRank(list, data.prefs().mix, data.profile(), home());
  const mixSongs = list => dsc.mixRank(list, { ...data.prefs().mix, intl: 0.5 }, data.profile(), '');
  function mixerPanel() {
    const m = data.prefs().mix, hc = home();
    return `<details class="mixer" ${mixOn() ? 'open' : ''}><summary>${icon('filter')}<span><b>Mezclador de descubrimiento</b><small>${mixOn() ? 'Activo: reordena las recomendaciones' : 'Opcional: ajusta qué tipo de música y radio te proponemos'}</small></span></summary>
      <div class="mixer-body">${MIX_AXES.map(([k, a, b, why]) => `<label class="mix-axis"><span class="ends"><span>${a}</span><span>${b}</span></span>
        <input type="range" min="0" max="100" value="${Math.round((m[k] ?? 0.5) * 100)}" data-mix="${k}" aria-label="${a} o ${b}"><small>${esc(why)}</small></label>`).join('')}
        <label class="field sm">${icon('compass')}<span class="muted">Tu país</span><select data-mix-home>${['', ...COUNTRY_CODES].map(cc => `<option value="${cc}" ${cc === hc ? 'selected' : ''}>${cc ? `${radio.flag(cc)} ${esc(radio.countryName(cc))}` : 'Sin indicar'}</option>`).join('')}</select></label>
        <div class="actions"><button class="btn sm ghost" data-act="x-mix-reset">Restablecer</button></div></div></details>`;
  }
  const COUNTRY_CODES = ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'US', 'GB', 'FR', 'DE', 'IT', 'PT', 'BR', 'NL', 'BE', 'CH', 'AT', 'PL', 'SE', 'NO', 'DK', 'FI', 'IE', 'GR', 'TR', 'RU', 'UA', 'JP', 'KR', 'CN', 'IN', 'AU', 'CA', 'ZA', 'EG', 'MA', 'NG', 'KE', 'CU', 'VE', 'UY', 'EC', 'BO', 'PY', 'DO', 'PR', 'CR', 'GT'];
  let mixTimer = null;
  view.addEventListener('input', e => {
    const r = e.target.closest('[data-mix]');
    if (!r) return;
    const m = { ...data.prefs().mix, [r.dataset.mix]: +r.value / 100 };
    clearTimeout(mixTimer);
    mixTimer = setTimeout(async () => { await data.setPrefs({ mix: m }); repaintMixed(); }, 250);
  });
  view.addEventListener('change', async e => {
    if (e.target.matches('[data-mix-home]')) { await data.setPrefs({ home: e.target.value }); repaintMixed(); }
  });
  function repaintMixed() {
    // vuelve a pedir (desde la caché) los bloques que dependen del mezclador
    for (const el of $$('[data-xb]', view)) if (['because', 'heard', 'featured', 'songs', 'trend', 'amb-radio', 'gen-radio', 'amb-songs', 'gen-songs'].includes(el.dataset.xb)) runBlock(el);
    const s = $('.mixer summary small', view); if (s) s.textContent = mixOn() ? 'Activo: reordena las recomendaciones' : 'Opcional: ajusta qué tipo de música y radio te proponemos';
  }

  // ========================================================== Música libre
  function viewFree() {
    const cats = [['all', 'Todos'], ...src.SOURCES.map(s => [s.id, s.name])];
    const chips = `<div class="chips sources x-cats">${cats.map(([id, n]) => `<button class="chip ${X.cat === id ? 'on' : ''}" data-act="x-cat" data-cat="${id}">${esc(n)}</button>`).join('')}</div>`;
    if (X.cat !== 'all') return `${chips}${legacyPanel()}`;
    const dayAmb = shuffleSeeded(dsc.AMBIENTS, dsc.dayKey() + 'free').slice(0, 5);
    const libGenres = topLibraryGenres();
    return `${chips}<p class="muted">Música con licencias abiertas o de dominio público de Internet Archive, Openverse, Wikimedia Commons y Jamendo. Puedes escucharla en línea, guardarla en tu biblioteca y, si la licencia lo permite, descargarla.</p>
      <div class="actions x-free-actions"><button class="btn" data-act="x-surprise" data-kind="song">${icon('spark')}Canción sorpresa</button></div>
      ${block('new', 'Novedades', async signal => {
        const r = await src.newReleases({ key: jamendoKey(), signal });
        return `${r.albums.length ? strip(r.albums.map(albumCardIA), 'albums') : ''}${r.tracks.length ? `<h3 class="lib-sub">Recién publicadas en Jamendo</h3>${songStrip(r.tracks)}` : ''}` || '<p class="muted">No hay novedades ahora mismo.</p>';
      }, { sub: 'Lo último publicado en los sellos netlabel de Internet Archive' })}
      ${libGenres.length ? block('recs', 'Recomendadas para ti', async signal => {
        const list = await src.songsByTags(libGenres.slice(0, 2), { key: jamendoKey(), signal, n: 18 });
        return list.length ? songStrip(mixSongs(list)) : null;
      }, { sub: `Por los géneros de tu biblioteca: ${esc(libGenres.slice(0, 2).join(', '))}` }) : ''}
      ${block('free-genres', 'Géneros', async () => `<div class="tiles">${dsc.GENRES.map(genreTile).join('')}</div>`)}
      ${block('free-amb', 'Por ambientes', async () => strip(dayAmb.map(ambientCard), 'amb'))}
      ${dsc.GENRES.slice(0, 3).map(g => block('fg-' + g.id, g.name, async signal => {
        const list = await src.songsByTags([g.q], { key: jamendoKey(), signal, n: 14 });
        return list.length ? songStrip(mixSongs(list)) : null;
      }, { link: `<a class="chip" href="#/explorar/genero/${g.id}">Ver más</a>` })).join('')}
      ${block('archive-collections', 'Colecciones de Internet Archive', async signal => strip((await src.albumsByTags(['jazz', 'classical', 'folk'], { signal })).map(albumCardIA), 'albums'))}
      ${mixerPanel()}`;
  }
  // --- búsqueda clásica por catálogo (comportamiento de siempre) ---
  function legacyPanel() {
    const source = src.SOURCES.find(x => x.id === X.cat);
    L.src = source.id;
    const needsKey = source.needsKey && !jamendoKey();
    if (needsKey) {
      return `<div class="panel"><h2>Conectar Jamendo</h2><p>Jamendo pide una clave gratuita para buscar en su catálogo:</p>
        <ol class="steps"><li>Regístrate en <b>devportal.jamendo.com</b> y crea una aplicación.</li><li>Copia su <b>Client ID</b> y pégalo aquí.</li></ol>
        <form class="search" data-form="jamendo-key"><label class="field">${icon('lock')}<input name="key" placeholder="Client ID de Jamendo" autocomplete="off" required></label><button class="btn primary">Guardar</button></form></div>`;
    }
    if (!L.results[source.id] && !L.loading && (X.q || source.id === 'jamendo') && L.q !== X.q) setTimeout(() => searchMusic(X.q), 0);
    return `<p class="muted">${esc(source.about)} Puedes escucharla en línea o guardarla en tu biblioteca.</p>
      ${X.q ? '' : `<div class="chips">${SUGGEST.map(q => `<button class="chip" data-act="x-suggest" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`}
      <div id="archive-list">${legacyBody(source)}</div>`;
  }
  function legacyBody(source) {
    const res = L.results[source.id];
    if (L.loading && !res) return '<p class="muted">Buscando…</p>';
    if (L.error) return `<p class="muted">${esc(L.error)}</p>`;
    if (!res) return X.q ? '' : '<p class="muted">Escribe arriba qué buscar o elige una sugerencia.</p>';
    if (!res.length) return '<p class="muted">Sin resultados. Prueba con otra búsqueda o con otro catálogo.</p>';
    if (source.albums) return `<div class="grid">${res.map(albumCardIA).join('')}</div>`;
    return `${!L.q && source.id === 'jamendo' ? '<h2>Populares esta semana</h2>' : ''}${rows(res.map(t => S.tracks.get(t.id) || t), { remote: true })}
      ${L.more[source.id] ? `<div class="actions" style="justify-content:center;margin-top:16px"><button class="btn" data-act="x-more-results" ${L.loading ? 'disabled' : ''}>${L.loading ? 'Cargando…' : 'Más resultados'}</button></div>` : ''}`;
  }
  function paintLegacy() {
    const box = $('#archive-list'), source = src.SOURCES.find(x => x.id === L.src);
    if (box && source) { setHTML(box, legacyBody(source)); watch(box); }
  }
  /** Busca en el catálogo elegido. Con `append`, añade la página siguiente a los resultados. */
  async function searchMusic(q, append = false) {
    const id = L.src;
    L.q = q; L.error = ''; L.loading = true;
    if (!append) { L.results[id] = null; L.page[id] = 1; } else L.page[id]++;
    paintLegacy();
    try {
      const r = await src.search(id, q, L.page[id], jamendoKey());
      if (L.src !== id || L.q !== q) return;
      L.results[id] = append ? [...(L.results[id] || []), ...r.items] : r.items;
      L.more[id] = r.more;
    } catch (e) {
      if (L.src !== id) return;
      if (e.needsKey) { S.settings.jamendoId = ''; c.saveKV('settings', false); toast('La clave de Jamendo no es válida'); }
      else if (append) toast('No se pudieron cargar más resultados');
      else L.error = !navigator.onLine ? 'No hay conexión a internet.'
        : e.limit ? 'Este catálogo limita las búsquedas por hora y se ha alcanzado el límite. Prueba más tarde o con otro catálogo.'
          : 'No se pudo consultar este catálogo. Inténtalo de nuevo o prueba con otro.';
    }
    L.loading = false;
    paintLegacy();
  }

  // ========================================================== Radios
  function viewRadios() {
    const favs = data.favs(), colls = data.collections(), hist = data.historyList();
    const s = data.status();
    const syncNote = account.user() ? (s.mode === 'missing' ? ' · <span class="warn">Falta preparar Supabase: se guardan solo en este dispositivo</span>' : '') : ' · <a href="#/ajustes">Inicia sesión</a> para tenerlas en todos tus dispositivos';
    return `
      <section class="xb mine"><div class="xb-head"><div><h2>Tus emisoras</h2><p class="muted">${plural(favs.length, 'favorita', 'favoritas')} · ${plural(colls.length, 'colección', 'colecciones')}${syncNote}</p></div>
        <button class="chip" data-act="x-new-coll">${icon('plus')}Nueva colección</button></div>
        ${colls.length ? strip(colls.map(collCard), 'colls') : ''}
        ${favs.length ? strip(favs.slice(0, 20).map(st => stCard(st))) : '<p class="muted">Toca el corazón de una emisora para guardarla aquí.</p>'}
      </section>
      <div class="exp-grid compact">${EXPERIENCES().join('')}</div>
      ${block('daily', 'Descubrimiento del día', dailyBlock)}
      ${block('featured', 'Destacadas', async signal => strip(mix(await radio.top('votes', { signal })).slice(0, 16).map(st => stCard(st))), { sub: 'Las más votadas en Radio Browser' })}
      ${block('trend', 'Tendencias', trendBlock, { sub: 'Clics registrados en Radio Browser en las últimas 24 horas. No son oyentes en directo.' })}
      ${block('cities', 'Ciudades', async () => strip(dsc.CITIES.map(cityCard), 'cities'), { sub: 'Hora local real · emisoras cerca de cada ciudad según sus coordenadas' })}
      ${block('countries', 'Países', countriesBlock, { link: '<a class="chip" href="#/explorar/atlas">Ver en el Atlas</a>' })}
      ${block('rgenres', 'Géneros', async signal => {
        const tags = await radio.tags('', { signal, limit: 24 });
        return `<div class="tiles">${dsc.GENRES.slice(0, 8).map(genreTile).join('')}</div><h3 class="lib-sub">Etiquetas con más emisoras</h3>
          <div class="chips">${tags.map(t => `<a class="chip" href="#/explorar/etiqueta/${enc(t.name)}">${esc(t.name)} <small class="muted">${t.count}</small></a>`).join('')}</div>`;
      })}
      ${hist.length ? `<section class="xb"><div class="xb-head"><div><h2>Escuchadas hace poco</h2><p class="muted">Solo en este dispositivo</p></div></div>${strip(hist.map(st => stCard(st)))}</section>` : ''}
      ${mixerPanel()}`;
  }
  const TRENDS = { clicks: ['Más escuchadas hoy', { order: 'clickcount' }], up: ['En alza', { order: 'clicktrend' }], votes: ['Más votadas', { order: 'votes' }], home: ['En tu país', { order: 'clickcount' }], tags: ['Géneros destacados'] };
  let trendTab = 'clicks';
  async function trendBlock(signal) {
    const hc = home();
    const tabs = `<div class="chips">${Object.entries(TRENDS).filter(([k]) => k !== 'home' || hc).map(([k, [l]]) => `<button class="chip ${k === trendTab ? 'on' : ''}" data-act="x-trend" data-t="${k}">${l}${k === 'home' ? ` ${radio.flag(hc)}` : ''}</button>`).join('')}</div>`;
    if (trendTab === 'tags') {
      const tags = await radio.tags('', { signal, limit: 30 });
      return `${tabs}<ol class="trend-tags">${tags.map((t, i) => `<li><a href="#/explorar/etiqueta/${enc(t.name)}"><span class="n">${i + 1}</span><b>${esc(t.name)}</b><small>${plural(t.count, 'emisora', 'emisoras')}</small></a></li>`).join('')}</ol>`;
    }
    const params = { ...TRENDS[trendTab][1], reverse: 'true', limit: 30, ...(trendTab === 'home' ? { countrycode: hc } : {}) };
    const list = mix(await radio.search(params, { signal, ttl: radio.HOUR }));
    const metric = s => (trendTab === 'up' ? `+${s.trend} clics` : trendTab === 'votes' ? `${s.votes.toLocaleString('es')} votos` : `${s.clicks.toLocaleString('es')} clics`);
    return `${tabs}${stList(list.slice(0, 20), s => ` · <span class="metric">${metric(s)}</span>`)}`;
  }
  async function countriesBlock(signal) {
    const list = await radio.countries({ signal });
    return `<div class="country-grid">${list.slice(0, 24).map(cn => `<a class="country" href="#/explorar/pais/${cn.cc}"><span class="flag">${radio.flag(cn.cc)}</span><span><b>${esc(cn.name)}</b><small>${plural(cn.count, 'emisora', 'emisoras')}</small></span></a>`).join('')}</div>
      <details class="more-countries"><summary>Todos los países (${list.length})</summary><div class="chips">${list.slice(24).map(cn => `<a class="chip" href="#/explorar/pais/${cn.cc}">${radio.flag(cn.cc)} ${esc(cn.name)} <small class="muted">${cn.count}</small></a>`).join('')}</div></details>`;
  }
  function collCard(cl) {
    const sts = data.stationsOf(cl).slice(0, 4);
    return `<a class="coll-card" href="#/explorar/coleccion/${enc(cl.id)}"><span class="coll-cover" data-coll="${esc(cl.id)}">${sts.length ? sts.map(s => logo(s)).join('') : `<i>${icon('radio')}</i>`}</span><b>${esc(cl.name)}</b><small>${plural(cl.items.length, 'emisora', 'emisoras')}</small></a>`;
  }
  async function paintCollCovers(root = view) {
    for (const el of $$('[data-coll]', root)) {
      const cl = data.collection(el.dataset.coll);
      const u = cl && await data.coverUrl(cl).catch(() => null);
      if (u && el.isConnected) { el.innerHTML = ''; el.style.backgroundImage = `url("${u}")`; el.classList.add('has'); }
    }
  }

  // ========================================================== buscador universal
  const resKey = () => `${X.q.trim()}|${X.scope}|${X.cat}|${X.cc}|${X.lang}`;
  const GROUPS = { music: [['songs', 'Canciones'], ['albums', 'Álbumes y colecciones'], ['artists', 'Artistas']], radio: [['stations', 'Emisoras'], ['countries', 'Países'], ['tags', 'Etiquetas']] };
  const groupsFor = scope => (scope === 'music' ? GROUPS.music : scope === 'radio' ? GROUPS.radio : [...GROUPS.music, ...GROUPS.radio]);
  function resultsHTML() {
    const scopes = [['all', 'Todo'], ['music', 'Música libre'], ['radio', 'Radios']];
    const music = X.scope !== 'radio', radios = X.scope !== 'music';
    const legacy = music && X.cat !== 'all';
    return `<div class="x-filters"><div class="chips" role="group" aria-label="Dónde buscar">${scopes.map(([id, l]) => `<button class="chip ${X.scope === id ? 'on' : ''}" data-act="x-scope" data-scope="${id}" aria-pressed="${X.scope === id}">${l}</button>`).join('')}</div>
        <div class="x-more-filters">
          ${music ? `<label class="field sm">${icon('disc')}<select data-xf="cat" aria-label="Catálogo">${[['all', 'Todos los catálogos'], ...src.SOURCES.map(s => [s.id, s.name])].map(([id, n]) => `<option value="${id}" ${X.cat === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
          ${radios ? `<label class="field sm">${icon('compass')}<select data-xf="cc" aria-label="País de las emisoras"><option value="">Cualquier país</option>${COUNTRY_CODES.map(cc => `<option value="${cc}" ${X.cc === cc ? 'selected' : ''}>${radio.flag(cc)} ${esc(radio.countryName(cc))}</option>`).join('')}</select></label>
            <label class="field sm">${icon('mic')}<select data-xf="lang" aria-label="Idioma de las emisoras"><option value="">Cualquier idioma</option>${['spanish', 'english', 'french', 'german', 'italian', 'portuguese', 'japanese', 'catalan'].map(l => `<option value="${l}" ${X.lang === l ? 'selected' : ''}>${cap(radio.langName(l))}</option>`).join('')}</select></label>` : ''}
        </div></div>
      ${legacy ? `<section class="xr"><h2>${esc(src.SOURCES.find(s => s.id === X.cat).name)}</h2>${legacyPanel()}</section>` : ''}
      ${groupsFor(X.scope).filter(([g]) => !(legacy && ['songs', 'albums', 'artists'].includes(g))).map(([g, l]) => `<section class="xr" data-g="${g}"><h2>${l}</h2><div class="xr-body">${groupBody(g)}</div></section>`).join('')}`;
  }
  function groupBody(g) {
    const r = X.res[g];
    if (!r || r.state === 'loading') return `<div class="x-loading"><span class="spin"></span>Buscando…</div>`;
    if (r.state === 'error') return errHTML(r.error) + `<button class="chip" data-act="x-retry-search">Reintentar</button>`;
    const items = r.items;
    if (!items.length) return `<p class="muted">Sin resultados${g === 'songs' ? ' en Openverse' + (jamendoKey() ? ' ni Jamendo' : '') : g === 'albums' ? ' en Internet Archive' : ''}.</p>`;
    if (g === 'songs') return `${rows(items.map(t => S.tracks.get(t.id) || t), { remote: true })}`;
    if (g === 'albums') return strip(items.map(albumCardIA), 'albums');
    if (g === 'artists') return `<div class="chips">${items.map(a => `<button class="chip artist" data-act="x-artist" data-name="${esc(a.name)}">${icon('user')}${esc(a.name)} <small class="muted">${a.n}</small></button>`).join('')}</div>`;
    if (g === 'stations') return stList(mix(items).slice(0, 30));
    if (g === 'countries') return `<div class="chips">${items.map(cn => `<a class="chip" href="#/explorar/pais/${cn.cc}">${radio.flag(cn.cc)} ${esc(cn.name)} <small class="muted">${cn.count}</small></a>`).join('')}</div>`;
    if (g === 'tags') return `<div class="chips">${items.map(t => `<a class="chip" href="#/explorar/etiqueta/${enc(t.name)}">${esc(t.name)} <small class="muted">${t.count}</small></a>`).join('')}</div>`;
    return '';
  }
  function paintGroup(g) {
    const el = $(`.xr[data-g="${g}"] .xr-body`);
    if (el) { setHTML(el, groupBody(g)); watch(el); }
  }
  async function runSearch() {
    X.ctrl?.abort();
    const q = X.q.trim();
    if (!q) return;
    const ctl = X.ctrl = new AbortController(), signal = ctl.signal, key = resKey();
    X.resKey = key; X.res = {};
    const want = new Set(groupsFor(X.scope).map(([g]) => g));
    const legacy = X.scope !== 'radio' && X.cat !== 'all';
    if (legacy) { ['songs', 'albums', 'artists'].forEach(g => want.delete(g)); L.results = {}; searchMusic(q); }
    for (const g of want) X.res[g] = { state: 'loading' };
    for (const g of want) paintGroup(g);
    const done = (g, p) => p.then(items => ({ state: 'ok', items }), error => ({ state: 'error', error })).then(r => {
      if (signal.aborted || X.resKey !== key) return r;
      X.res[g] = r; paintGroup(g); return r;
    });
    const jobs = {};
    if (want.has('songs')) {
      // solo las fuentes que de verdad se consultan: si fallan todas, el grupo muestra el error
      jobs.songs = done('songs', Promise.allSettled([src.search('openverse', q, 1, '', signal), ...(jamendoKey() ? [src.search('jamendo', q, 1, jamendoKey(), signal)] : [])])
        .then(rs => { if (rs.every(r => r.status === 'rejected')) throw rs[0].reason; return rs.filter(r => r.status === 'fulfilled').flatMap(r => r.value.items).slice(0, 30); }));
    }
    if (want.has('albums')) jobs.albums = done('albums', src.searchArchiveAlbums(q, signal));
    if (want.has('artists')) {
      // artistas: los autores que aparecen en las canciones y álbumes encontrados (dato real de cada catálogo)
      jobs.artists = done('artists', Promise.allSettled([jobs.songs, jobs.albums]).then(([s, a]) => {
        const m = new Map(), fq = fold(q);
        const add = name => { const n = String(name || '').trim(); if (!n || /desconocido|internet archive|wikimedia/i.test(n)) return; const k = fold(n); const e = m.get(k) || { name: n, n: 0, hit: k.includes(fq) }; e.n++; m.set(k, e); };
        for (const t of s.value?.items || []) add(t.artist);
        for (const r of a.value?.items || []) add(r.creator);
        return [...m.values()].sort((x, y) => y.hit - x.hit || y.n - x.n).slice(0, 16);
      }));
    }
    const rf = { ...(X.cc ? { countrycode: X.cc } : {}), ...(X.lang ? { language: X.lang } : {}) };
    if (want.has('stations')) {
      jobs.stations = done('stations', Promise.allSettled([
        radio.search({ name: q, order: 'clickcount', reverse: 'true', limit: 40, ...rf }, { signal }),
        radio.search({ tag: q, order: 'clickcount', reverse: 'true', limit: 40, ...rf }, { signal }),
      ]).then(rs => { if (rs.every(r => r.status === 'rejected')) throw rs[0].reason; const seen = new Set(); return rs.filter(r => r.status === 'fulfilled').flatMap(r => r.value).filter(s => !seen.has(s.uuid) && seen.add(s.uuid)); }));
    }
    if (want.has('countries')) jobs.countries = done('countries', radio.countries({ signal }).then(l => { const fq = fold(q); return l.filter(cn => fold(cn.name).includes(fq) || cn.cc === q.toUpperCase()).slice(0, 12); }));
    if (want.has('tags')) jobs.tags = done('tags', radio.tags(q, { signal, limit: 20 }));
    await Promise.allSettled(Object.values(jobs));
  }
  function onQuery(q) {
    X.q = q;
    $('.x-bar .clear')?.toggleAttribute('hidden', !q);
    clearTimeout(X.timer);
    if (!q.trim()) { X.ctrl?.abort(); X.resKey = ''; X.res = {}; paintBody(tabHTML(X.tab)); return; }
    if (!$('.x-filters')) paintBody(resultsHTML());
    X.timer = setTimeout(() => { paintBody(resultsHTML()); runSearch(); }, 350);
  }
  view.addEventListener('input', e => { if (e.target.id === 'x-q') onQuery(e.target.value); });
  view.addEventListener('keydown', e => {
    if (e.target.id !== 'x-q') return;
    if (e.key === 'Escape') { e.stopPropagation(); if (e.target.value) { e.target.value = ''; onQuery(''); } else e.target.blur(); }
    if (e.key === 'Enter') { clearTimeout(X.timer); paintBody(resultsHTML()); runSearch(); }
  });
  view.addEventListener('change', e => {
    const f = e.target.closest('[data-xf]');
    if (!f) return;
    X[f.dataset.xf] = f.value;
    paintBody(resultsHTML()); runSearch();
  });

  // ========================================================== páginas: ambiente, género, etiqueta
  async function viewAmbient(id) {
    const a = dsc.ambient(id);
    if (!a) return show(empty('spark', 'Ambiente no encontrado', '', '<a class="btn" href="#/explorar">Volver a Explorar</a>'));
    show(`${subHead('')}<div class="amb-hero" style="--c1:${a.colors[0]};--c2:${a.colors[1]};--c3:${a.colors[2]}">${dsc.ambientArt(a, 'hero')}<div><small class="kicker">Ambiente</small><h1>${esc(a.name)}</h1><p>${esc(a.desc)}</p>
        <p class="rule">${icon('filter')} Elegido por las etiquetas · canciones: <b>${esc(a.music.join(', '))}</b> · radios: <b>${esc(a.radio.join(', '))}</b></p></div></div>
      ${block('amb-songs', 'Canciones del ambiente', async signal => {
        const list = await src.songsByTags(a.music, { key: jamendoKey(), signal, n: 30 });
        if (!list.length) return '<p class="muted">Ahora mismo los catálogos libres no devuelven canciones con estas etiquetas.</p>';
        const k = regSongs(mixSongs(list));
        return `<div class="actions"><button class="btn primary" data-act="x-play-list" data-k="${k}">${icon('play')}Escuchar canciones</button></div>${strip(songLists.get(k).map((_, i) => songCard(songLists.get(k), i, k)), 'songs')}`;
      }, { sub: 'Música libre etiquetada con esos géneros (Openverse' + (jamendoKey() ? ' y Jamendo' : '') + ')' })}
      ${block('amb-radio', 'Radios del ambiente', async signal => {
        const list = await radio.byTags(a.radio, { signal });
        return list.length ? stList(mix(list).slice(0, 24), s => ` · <span class="metric">${esc(s.tags.filter(t => a.radio.some(r => t.includes(r))).slice(0, 2).join(', '))}</span>`) : '<p class="muted">No hay emisoras con estas etiquetas ahora mismo.</p>';
      }, { sub: 'Emisoras en directo con esas etiquetas en Radio Browser' })}`);
    armBlocks();
  }
  async function viewGenre(id) {
    const g = dsc.genre(id);
    if (!g) return viewTagPage(id);
    const rel = g.related.map(dsc.genre).filter(Boolean);
    show(`${subHead('')}<div class="genre-hero" style="--hue:${dsc.genreHue(g.id)}"><small class="kicker">Género</small><h1>${esc(g.name)}</h1>
        <div class="chips"><span class="muted">Subgéneros:</span>${g.sub.map(s => `<a class="chip" href="#/explorar/etiqueta/${enc(s)}">${esc(s)}</a>`).join('')}</div>
        ${rel.length ? `<div class="chips"><span class="muted">Relacionados:</span>${rel.map(r => `<a class="chip" href="#/explorar/genero/${r.id}">${esc(r.name)}</a>`).join('')}</div>` : ''}</div>
      ${block('gen-songs', 'Canciones', async signal => {
        const list = await src.songsByTags([g.q, ...g.sub.slice(0, 1)], { key: jamendoKey(), signal, n: 24 });
        return list.length ? songStrip(mixSongs(list)) : '<p class="muted">Ahora mismo no hay canciones libres con este género.</p>';
      }, { sub: 'Música libre con esta etiqueta' })}
      ${block('gen-radio', 'Emisoras', async signal => { const l = await radio.byTag(g.rb, { signal, params: { limit: 40 } }); return l.length ? stList(mix(l).slice(0, 24)) : '<p class="muted">No hay emisoras con esta etiqueta.</p>'; },
        { sub: `Etiqueta «${esc(g.rb)}» en Radio Browser`, link: `<button class="chip" data-act="x-roulette-genre" data-tag="${esc(g.rb)}">${icon('dice')}Ruleta de ${esc(g.name)}</button>` })}
      ${block('gen-albums', 'Álbumes', async signal => { const l = await src.albumsByTags([g.q, ...g.sub.slice(0, 2)], { signal }); return l.length ? strip(l.map(albumCardIA), 'albums') : null; }, { sub: 'Internet Archive' })}`);
    armBlocks();
  }
  async function viewTagPage(tag) {
    tag = String(tag || '').toLowerCase();
    show(`${subHead('')}<div class="genre-hero" style="--hue:${hueOf(tag)}"><small class="kicker">Etiqueta</small><h1>${esc(tag)}</h1></div>
      ${block('tag-radio', 'Emisoras', async signal => { const l = await radio.byTag(tag, { signal, params: { limit: 50 } }); return l.length ? stList(mix(l)) : '<p class="muted">No hay emisoras con esta etiqueta.</p>'; })}
      ${block('tag-songs', 'Canciones', async signal => { const l = await src.songsByTags([tag], { key: jamendoKey(), signal, n: 24 }); return l.length ? songStrip(l) : null; }, { sub: 'Música libre con esta etiqueta' })}`);
    armBlocks();
  }

  // ========================================================== ciudades y países
  async function viewCity(id) {
    const cty = dsc.city(id);
    if (!cty) return show(empty('compass', 'Ciudad no encontrada', '', '<a class="btn" href="#/explorar/radios">Volver</a>'));
    const paint = () => {
      const m = dsc.localMoment(cty), [a, b, d] = dsc.SKY[m.moment];
      return `<div class="city-hero" style="--s1:${a};--s2:${b};--s3:${d}"><span class="city-sky ${m.moment}"><span class="sun" style="--el:${Math.max(-20, Math.min(60, m.elevation)).toFixed(1)}"></span></span>
        <div><small class="kicker">${esc(m.phrase)}</small><h1>${esc(cty.name)}</h1><p>${radio.flag(cty.cc)} ${esc(radio.countryName(cty.cc))} · hora local <time>${m.time}</time></p>
        <p class="muted small">Sol a ${Math.round(m.elevation)}° sobre el horizonte (calculado para la fecha y hora reales)</p></div></div>`;
    };
    show(`${subHead('', '#/explorar/radios', 'Radios')}<div id="city-hero">${paint()}</div>
      ${block('city-st', 'Emisoras de la ciudad', async signal => {
        const list = await radio.near(cty.lat, cty.lon, 40, { signal, params: { limit: 60 } });
        const tags = new Map(); for (const s of list) for (const t of s.tags) tags.set(t, (tags.get(t) || 0) + 1);
        const top = [...tags].sort((x, y) => y[1] - x[1]).slice(0, 10);
        return list.length ? `${top.length ? `<div class="chips"><span class="muted">Géneros representados:</span>${top.map(([t, n]) => `<a class="chip" href="#/explorar/etiqueta/${enc(t)}">${esc(t)} <small class="muted">${n}</small></a>`).join('')}</div>` : ''}
          <div class="actions"><button class="btn primary" data-act="x-play-first" data-uuid="${esc(list[0].uuid)}">${icon('play')}Escuchar ${esc(cty.name)}</button></div>${stList(list, s => (s.dist != null ? ` · ${(s.dist / 1000).toFixed(0)} km` : ''))}`
          : `<p class="muted">El directorio no tiene emisoras con coordenadas a menos de 40 km de ${esc(cty.name)}.</p>`;
      }, { sub: 'A menos de 40 km, según las coordenadas que publica cada emisora' })}
      ${block('city-cc', `Más de ${esc(radio.countryName(cty.cc))}`, async signal => stList((await radio.byCountry(cty.cc, { signal, params: { limit: 20 } }))), { sub: 'Del mismo país (no tienen por qué estar en la ciudad)' })}`);
    armBlocks();
    clock = setInterval(() => { const h = $('#city-hero'); if (h) h.innerHTML = paint(); else clearInterval(clock); }, 30000);
  }
  async function viewCountry(cc) {
    cc = String(cc || '').toUpperCase();
    const cities = dsc.CITIES.filter(x => x.cc === cc);
    show(`${subHead('', '#/explorar/radios', 'Radios')}<div class="genre-hero country-hero"><span class="flag big">${radio.flag(cc)}</span><div><small class="kicker">País</small><h1>${esc(radio.countryName(cc))}</h1></div></div>
      ${cities.length ? strip(cities.map(cityCard), 'cities') : ''}
      ${block('cc-st', 'Emisoras', async signal => {
        const list = await radio.byCountry(cc, { signal, params: { limit: 80 } });
        if (!list.length) return '<p class="muted">No hay emisoras de este país que funcionen en este navegador.</p>';
        const tags = new Map(); for (const s of list) for (const t of s.tags) tags.set(t, (tags.get(t) || 0) + 1);
        return `<div class="chips"><span class="muted">Géneros representados:</span>${[...tags].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([t, n]) => `<span class="chip">${esc(t)} <small class="muted">${n}</small></span>`).join('')}</div>
          <div class="actions"><button class="btn primary" data-act="x-play-first" data-uuid="${esc(list[0].uuid)}">${icon('play')}Escuchar</button><a class="btn" href="#/explorar/ruleta?cc=${cc}">${icon('dice')}Ruleta de este país</a></div>${stList(mix(list))}`;
      }, { sub: 'Las más escuchadas hoy en Radio Browser' })}`);
    armBlocks();
  }

  // ========================================================== emisora: ficha y menú
  function stationSheet(st) {
    regSt(st);
    const tech = [st.codec, st.bitrate ? `${st.bitrate} kbps` : '', st.hls ? 'HLS' : ''].filter(Boolean).join(' · ');
    openSheet(`<div class="dlg st-sheet">${logo(st, 'xl')}<h3>${esc(st.title)}</h3><p>${esc(where(st))}</p>
      ${st.tags.length ? `<div class="chips">${st.tags.slice(0, 8).map(t => `<a class="chip" href="#/explorar/etiqueta/${enc(t)}">${esc(t)}</a>`).join('')}</div>` : ''}
      <dl class="st-facts">${st.langs.length ? `<dt>Idioma</dt><dd>${esc(st.langs.map(l => cap(radio.langName(l))).join(', '))}</dd>` : ''}${tech ? `<dt>Stream</dt><dd>${esc(tech)}</dd>` : ''}
        ${st.votes ? `<dt>Votos</dt><dd>${st.votes.toLocaleString('es')}</dd>` : ''}${st.clicks ? `<dt>Clics (24 h)</dt><dd>${st.clicks.toLocaleString('es')}</dd>` : ''}
        ${st.homepage ? `<dt>Web</dt><dd><a href="${esc(st.homepage)}" target="_blank" rel="noopener noreferrer">${esc(st.homepage.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></dd>` : ''}</dl>
      <div class="actions"><button class="btn primary" data-sa="play">${icon('play')}Escuchar</button><button class="btn" data-sa="fav">${icon('heart')}${data.isFav(st.uuid) ? 'Quitar de favoritas' : 'Favorita'}</button>
        <button class="btn" data-sa="coll">${icon('list')}Colección</button><button class="btn" data-sa="radar">${icon('compass')}Radar</button></div>
      <p class="muted small">Datos del directorio comunitario Radio Browser.</p></div>`, async e => {
      const b = e.target.closest('[data-sa]'); if (!b) return;
      const a = b.dataset.sa; sheet.close();
      if (a === 'play') playStation(st);
      if (a === 'fav') toggleFav(st);
      if (a === 'coll') addToCollectionMenu(st);
      if (a === 'radar') c.go(`#/explorar/radar/${enc(st.uuid)}`);
    });
  }
  function stationMenu(st) {
    regSt(st);
    menu(`<div class="sheet-head">${logo(st)}<div><b>${esc(st.title)}</b><small>${esc(where(st))}</small></div></div>`, [
      { icon: 'play', label: 'Escuchar', fn: () => playStation(st) },
      { icon: 'heart', label: data.isFav(st.uuid) ? 'Quitar de favoritas' : 'Guardar en favoritas', fn: () => toggleFav(st) },
      { icon: 'list', label: 'Añadir a una colección…', fn: () => addToCollectionMenu(st) },
      { icon: 'compass', label: 'Emisoras similares (Radar)', fn: () => c.go(`#/explorar/radar/${enc(st.uuid)}`) },
      { icon: 'more', label: 'Ver ficha', fn: () => stationSheet(st) },
      st.homepage && { icon: 'compass', label: 'Abrir la web de la emisora', fn: () => window.open(st.homepage, '_blank', 'noopener,noreferrer') },
    ]);
  }
  async function toggleFav(st) {
    const onNow = await data.toggleFav(st);
    $$(`.fav[data-uuid="${CSS.escape(st.uuid)}"]`).forEach(b => { b.classList.toggle('on', onNow); b.setAttribute('aria-pressed', onNow); b.classList.add('pop'); setTimeout(() => b.classList.remove('pop'), 400); });
    toast(onNow ? `«${st.title}» guardada en tus emisoras` : 'Quitada de tus emisoras');
  }
  function addToCollectionMenu(st) {
    const cols = data.collections();
    menu(`<div class="sheet-head"><div><b>Añadir a una colección</b><small>${esc(st.title)}</small></div></div>`, [
      { icon: 'plus', label: 'Nueva colección…', fn: async () => { const n = await ask({ title: 'Nueva colección', placeholder: 'Nombre', ok: 'Crear' }); if (!n) return; const cl = await data.newCollection(n); await data.addToCollection(cl, st); toast(`Añadida a «${cl.name}»`); } },
      ...cols.map(cl => ({ icon: 'list', label: `${cl.name}${cl.items.some(x => x.uuid === st.uuid) ? ' ✓' : ''}`, fn: async () => { toast(await data.addToCollection(cl, st) ? `Añadida a «${cl.name}»` : 'Ya estaba en esa colección'); } })),
    ]);
  }

  // ========================================================== reproducción
  let rouletteActive = null;   // {queue:[], i}
  function playStation(st, opts = {}) {
    if (!opts.keepSession) session.stop(true);
    regSt(st);
    player.playQueue([st]);
    radio.reportClick(st.uuid);
    data.remember(st);
    markPlaying();
  }
  function markPlaying() {
    $$('.st-card.on, .st-row.on').forEach(e => e.classList.remove('on'));
    const id = P.current?.radio && P.current.uuid;
    if (id) $$(`[data-uuid="${CSS.escape(id)}"].st-card, [data-uuid="${CSS.escape(id)}"].st-row`).forEach(e => e.classList.add('on'));
  }
  on('track', markPlaying);
  // Pasaporte: un país cuenta cuando se ha escuchado una emisora suya el tiempo mínimo (y la opción está activa).
  const stampedThisPlay = new Set();
  on('track', () => stampedThisPlay.clear());
  on('radio-time', async ({ track, secs }) => {
    const pp = data.prefs().passport;
    if (!pp.on || !track.cc || stampedThisPlay.has(track.id) || secs < pp.secs) return;
    stampedThisPlay.add(track.id);
    const isNew = await data.stamp(track.cc, track);
    if (isNew) toast(`${radio.flag(track.cc)} Nuevo sello en tu pasaporte: ${radio.countryName(track.cc)}`);
  });
  // Si una emisora de la ruleta falla, se prueba la siguiente candidata.
  on('play-error', ev => {
    if (!rouletteActive || ev.handled || ev.track.id !== rouletteActive.cur?.id) return;
    ev.handled = true;
    const next = rouletteActive.queue.shift();
    if (next) { toast(`«${ev.track.title}» no responde: probamos con otra`); showRouletteResult(next, true); playStation(next); }
    else toast('Ninguna de las emisoras elegidas responde ahora mismo: vuelve a girar');
  });

  // ========================================================== Radio Roulette
  const R_MODES = [['any', 'Cualquier lugar'], ['music', 'Solo música'], ['genre', 'Un género'], ['country', 'Un país'], ['outside', 'Fuera de mi zona']];
  let rState = { mode: 'any', tag: 'jazz', cc: '', spinning: false };
  function stopRoulette() { rouletteActive = null; }
  async function viewRoulette(arg = '') {
    const p = new URLSearchParams(location.hash.split('?')[1] || arg);
    rState.mode = p.get('cc') ? 'country' : p.get('tag') ? 'genre' : data.prefs().roulette || rState.mode;
    if (p.get('cc')) rState.cc = p.get('cc'); if (p.get('tag')) rState.tag = p.get('tag');
    if (!rState.cc) rState.cc = home() || 'ES';
    const seg = 12;
    show(`${subHead('Radio Roulette', '#/explorar/radios', 'Radios')}
      <div class="roulette">
        <div class="r-modes chips" role="radiogroup" aria-label="Modo">${R_MODES.map(([m, l]) => `<button class="chip ${rState.mode === m ? 'on' : ''}" role="radio" aria-checked="${rState.mode === m}" data-act="x-r-mode" data-m="${m}">${l}</button>`).join('')}</div>
        <div class="r-opts">
          <label class="field sm" ${rState.mode === 'genre' ? '' : 'hidden'}>${icon('disc')}<select data-r="tag">${dsc.GENRES.map(g => `<option value="${esc(g.rb)}" ${rState.tag === g.rb ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
          <label class="field sm" ${rState.mode === 'country' ? '' : 'hidden'}>${icon('compass')}<select data-r="cc">${COUNTRY_CODES.map(cc => `<option value="${cc}" ${rState.cc === cc ? 'selected' : ''}>${radio.flag(cc)} ${esc(radio.countryName(cc))}</option>`).join('')}</select></label>
          <p class="muted small r-rule">${rState.mode === 'music' || rState.mode === 'outside' ? esc(dsc.MUSIC_RULE) : ''}${rState.mode === 'outside' ? ' Se priorizan países y etiquetas que no aparecen en tus favoritas, tu pasaporte, lo que has escuchado aquí ni los géneros de tu biblioteca.' : ''}</p>
        </div>
        <div class="dial-wrap"><div class="dial-pointer" aria-hidden="true"></div>
          <svg class="dial" viewBox="-110 -110 220 220" aria-hidden="true"><g class="dial-rot">${Array.from({ length: seg }, (_, i) => {
            const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
            const p0 = [100 * Math.sin(a0), -100 * Math.cos(a0)], p1 = [100 * Math.sin(a1), -100 * Math.cos(a1)];
            return `<path d="M0 0 L${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A100 100 0 0 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)} Z" class="seg s${i % 3}"/><text class="seg-l" data-seg="${i}" transform="rotate(${(i + 0.5) * 360 / seg}) translate(0 -72)">·</text>`;
          }).join('')}<circle r="34" class="hub"/></g></svg>
          <button class="dial-btn" data-act="x-spin" aria-label="Girar la ruleta">${icon('dice')}<span>Girar</span></button></div>
        <div id="r-result" class="r-result" aria-live="polite"><p class="muted">Gira el dial: Fiora elegirá una emisora real del directorio que cumpla el modo.</p></div>
      </div>`);
  }
  let rRot = 0;
  async function spin() {
    if (rState.spinning) return;
    rState.spinning = true;
    const btn = $('.dial-btn'); btn?.setAttribute('disabled', '');
    const res = $('#r-result'); if (res) res.innerHTML = '<div class="x-loading"><span class="spin"></span>Sintonizando…</div>';
    const rot = $('.dial-rot');
    const turn = 720 + Math.floor(Math.random() * 360);
    rRot += turn;
    if (rot) { rot.style.transition = reduced() ? 'none' : 'transform 2.2s cubic-bezier(.15,.75,.2,1)'; rot.style.transform = `rotate(${rRot}deg)`; }
    try {
      const [list] = await Promise.all([
        dsc.pickStations({ mode: rState.mode, tag: rState.tag, cc: rState.cc, recent: data.recentPicks(), profile: data.profile(), signal: ctrl.signal }),
        new Promise(r => setTimeout(r, reduced() ? 0 : 2200)),
      ]);
      if (!list.length) { res && (res.innerHTML = '<p class="muted">No hay emisoras que cumplan este modo ahora mismo. Prueba con otro.</p>'); return; }
      // Etiquetas de los segmentos: banderas de las candidatas reales
      $$('.seg-l').forEach((t, i) => { t.textContent = radio.flag(list[i % list.length].cc) || '♪'; });
      const pick = list[0];
      rouletteActive = { queue: list.slice(1, 8), cur: pick };
      showRouletteResult(pick);
      data.markPicked(pick.uuid);
    } catch (e) { if (e?.name !== 'AbortError' && res) res.innerHTML = errHTML(e); }
    finally { rState.spinning = false; btn?.removeAttribute('disabled'); }
  }
  function showRouletteResult(st, playing = false) {
    if (rouletteActive) rouletteActive.cur = st;
    const res = $('#r-result'); if (!res) return;
    setHTML(res, `<div class="r-card pop-in">${logo(st, 'xl')}<div><h3>${esc(st.title)}</h3><p>${esc(where(st))}</p>
      ${st.tags.length ? `<div class="chips">${st.tags.slice(0, 4).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="actions"><button class="btn primary" data-act="x-play" data-uuid="${esc(st.uuid)}">${icon('play')}${playing ? 'Sonando' : 'Escuchar'}</button>
      <button class="btn" data-act="x-spin">${icon('dice')}Otra vez</button>${favBtn(st)}<button class="icon-btn" data-act="x-more" data-uuid="${esc(st.uuid)}" aria-label="Más">${icon('more')}</button></div></div></div>`);
  }

  // ========================================================== Sorpréndeme
  async function surprise(kind = 'any') {
    openSheet(`<div class="dlg surprise-dlg"><h3>${icon('spark')} Sorpréndeme</h3>
      <div class="chips" role="radiogroup">${[['song', 'Canción'], ['station', 'Emisora'], ['any', 'Cualquier cosa']].map(([k, l]) => `<button class="chip ${k === kind ? 'on' : ''}" data-sk="${k}" role="radio" aria-checked="${k === kind}">${l}</button>`).join('')}</div>
      <div class="sur-stage" aria-live="polite"><div class="sur-cards"><span></span><span></span><span></span></div><p class="muted">Buscando algo para ti…</p></div></div>`,
    e => { const b = e.target.closest('[data-sk]'); if (b) { surprise(b.dataset.sk); return; } const a = e.target.closest('[data-sur]'); if (a) onSurpriseAction(a); });
    const stage = $('.sur-stage', sheet);
    const my = ++surpriseSeq;
    const real = kind === 'any' ? (Math.random() < 0.5 ? 'song' : 'station') : kind;
    try {
      const wait = new Promise(r => setTimeout(r, reduced() ? 0 : 900));
      let html;
      if (real === 'station') {
        const list = await dsc.pickStations({ mode: 'music', recent: data.recentPicks() });
        await wait; if (my !== surpriseSeq) return;
        const st = list[0]; if (!st) throw new Error('No se encontró ninguna emisora');
        data.markPicked(st.uuid); regSt(st); surpriseItem = { st, alt: list.slice(1, 6) };
        html = `<div class="sur-result pop-in">${logo(st, 'xl')}<small class="kicker">Emisora en directo</small><h3>${esc(st.title)}</h3><p>${esc(where(st))}</p>${st.tags.length ? `<p class="muted small">${esc(st.tags.slice(0, 4).join(' · '))}</p>` : ''}
          <div class="actions"><button class="btn primary" data-sur="play-st">${icon('play')}Escuchar</button><button class="btn" data-sur="again">${icon('spark')}Otra</button></div></div>`;
      } else {
        const g = dsc.GENRES[Math.floor(Math.random() * dsc.GENRES.length)];
        const tags = Math.random() < 0.5 ? [g.q] : [g.sub[Math.floor(Math.random() * g.sub.length)]];
        let list = await src.songsByTags(tags, { key: jamendoKey(), n: 20 });
        if (!list.length) list = await src.songsByTags([g.q], { key: jamendoKey(), n: 20 });
        await wait; if (my !== surpriseSeq) return;
        const t = list[Math.floor(Math.random() * list.length)];
        if (!t) throw new Error('Los catálogos no han devuelto canciones');
        surpriseItem = { t };
        html = `<div class="sur-result pop-in">${cover(t)}<small class="kicker">Canción · ${esc(t.matched || g.name)}</small><h3>${esc(t.title)}</h3><p>${esc(t.artist || '')}</p>${t.license ? `<p class="muted small">${esc(t.license)} · ${esc(t.origin || '')}</p>` : ''}
          <div class="actions"><button class="btn primary" data-sur="play-song">${icon('play')}Escuchar</button><button class="btn" data-sur="again">${icon('spark')}Otra</button></div></div>`;
      }
      if (stage?.isConnected) { setHTML(stage, html); surpriseKind = kind; }
    } catch (e) { if (stage?.isConnected) stage.innerHTML = `${errHTML(e)}<div class="actions"><button class="btn" data-sur="again">Reintentar</button></div>`; surpriseKind = kind; }
  }
  let surpriseSeq = 0, surpriseItem = null, surpriseKind = 'any';
  function onSurpriseAction(a) {
    const act = a.dataset.sur;
    if (act === 'again') return surprise(surpriseKind);
    sheet.close();
    if (act === 'play-st' && surpriseItem?.st) { rouletteActive = { queue: surpriseItem.alt || [], cur: surpriseItem.st }; playStation(surpriseItem.st); }
    if (act === 'play-song' && surpriseItem?.t) player.playQueue([surpriseItem.t]);
  }

  // ========================================================== Radar
  async function viewRadar(uuid) {
    let st = uuid ? stations.get(uuid) || (P.current?.uuid === uuid ? P.current : null) : P.current?.radio ? P.current : null;
    if (!st && uuid) st = (await radio.byUuids([uuid]).catch(() => []))[0];
    if (!st) {
      return show(`${subHead('Fiora Radar', '#/explorar/radios', 'Radios')}${empty('compass', 'Pon una emisora', 'El radar muestra emisoras parecidas a la que estás escuchando. Elige una en Radios o gira la ruleta.', '<a class="btn" href="#/explorar/ruleta">Radio Roulette</a>')}`);
    }
    regSt(st);
    show(`${subHead('Fiora Radar', '#/explorar/radios', 'Radios')}<p class="muted">Emisoras relacionadas con <b>${esc(st.title)}</b> por etiquetas, idioma y país. Es un parecido según los datos del directorio, no un análisis del sonido.</p>
      <div class="radar-wrap"><div id="radar" class="radar"><div class="x-loading"><span class="spin"></span>Buscando emisoras parecidas…</div></div></div>
      <h2>En lista</h2><div id="radar-list"></div>`);
    try {
      const rel = await dsc.related(st, { signal: ctrl.signal });
      const box = $('#radar'); if (!box) return;
      if (!rel.length) { box.innerHTML = '<p class="muted">El directorio no tiene emisoras con datos en común con esta.</p>'; return; }
      const max = rel[0].score;
      const pts = rel.map((r, i) => { const ang = (i / rel.length) * 2 * Math.PI - Math.PI / 2; const rad = 34 + (1 - r.score / max) * 46 + (i % 2) * 6; return { ...r, x: 50 + rad * Math.cos(ang) * 0.92, y: 50 + rad * Math.sin(ang) * 0.92 }; });
      setHTML(box, `<svg viewBox="0 0 100 100" class="radar-svg" aria-hidden="true">${[18, 34, 50].map(r => `<circle cx="50" cy="50" r="${r * 0.92}" class="ring"/>`).join('')}
          <line x1="50" y1="4" x2="50" y2="96" class="axis"/><line x1="4" y1="50" x2="96" y2="50" class="axis"/>${pts.map(p => `<line x1="50" y1="50" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" class="link" style="--w:${(0.15 + p.score / max * 0.6).toFixed(2)}"/>`).join('')}
          <g class="sweep"><path d="M50 50 L50 4 A46 46 0 0 1 82.5 17.5 Z"/></g></svg>
        <div class="radar-center">${logo(st, 'lg')}<b>${esc(st.title)}</b></div>
        ${pts.map(p => `<button class="radar-pt" style="left:${p.x}%;top:${p.y}%" data-act="x-play" data-uuid="${esc(regSt(p.s).uuid)}" title="${esc(p.s.title)} — comparte: ${esc(p.why.join(', '))}">${logo(p.s, 'sm')}<span>${esc(p.s.title)}</span></button>`).join('')}`);
      setHTML($('#radar-list'), stList(rel.map(r => r.s), s => { const r = rel.find(x => x.s.uuid === s.uuid); return ` · <span class="metric">comparte: ${esc(r.why.join(', '))}</span>`; }));
    } catch (e) { if (e?.name !== 'AbortError') $('#radar') && ($('#radar').innerHTML = errHTML(e)); }
  }

  // ========================================================== Universo musical
  let universe = null;
  async function viewUniverse(id = '') {
    const sel = dsc.genre(id) || null;
    show(`${subHead('Universo musical', '#/explorar', 'Explorar', `<button class="chip" data-act="x-uni-list" aria-pressed="false">${icon('list')}Ver como lista</button>`)}
      <p class="muted">Toca un género: aparecen los relacionados, sus subgéneros, canciones libres y emisoras. Las relaciones siguen una taxonomía fija (editable en <code>discover.js</code>).</p>
      <div class="universe" id="universe" role="group" aria-label="Géneros">${dsc.GENRES.map(g => `<button class="bubble" data-act="x-uni" data-g="${g.id}" style="--hue:${dsc.genreHue(g.id)}" aria-pressed="false"><span>${esc(g.name)}</span></button>`).join('')}<svg class="uni-lines" aria-hidden="true"></svg></div>
      <div class="uni-list" hidden><ul>${dsc.GENRES.map(g => `<li><a href="#/explorar/genero/${g.id}"><b>${esc(g.name)}</b></a> — relacionados: ${g.related.map(r => `<a href="#/explorar/universo/${r}">${esc(dsc.genre(r)?.name || r)}</a>`).join(', ')} · subgéneros: ${esc(g.sub.join(', '))}</li>`).join('')}</ul></div>
      <div id="uni-detail"></div>`);
    universe = { sel: sel?.id || null };
    layoutUniverse(false);
    if (sel) selectGenre(sel.id);
  }
  function layoutUniverse(animate = true) {
    const box = $('#universe'); if (!box) return;
    const W = box.clientWidth, H = box.clientHeight, cx = W / 2, cy = H / 2;
    const sel = universe?.sel && dsc.genre(universe.sel);
    const rel = new Set(sel?.related || []);
    const others = dsc.GENRES.filter(g => g.id !== sel?.id && !rel.has(g.id));
    const pos = new Map();
    if (sel) {
      pos.set(sel.id, [cx, cy, 1.35]);
      sel.related.forEach((r, i, a) => { const ang = (i / a.length) * 2 * Math.PI - Math.PI / 2; pos.set(r, [cx + Math.cos(ang) * Math.min(W, H) * 0.27, cy + Math.sin(ang) * Math.min(W, H) * 0.27, 1.05]); });
      others.forEach((g, i, a) => { const ang = (i / a.length) * 2 * Math.PI; pos.set(g.id, [cx + Math.cos(ang) * W * 0.44, cy + Math.sin(ang) * H * 0.42, 0.7]); });
    } else {
      dsc.GENRES.forEach((g, i, a) => { const ring = i % 2 ? 0.38 : 0.22; const ang = (i / a.length) * 2 * Math.PI; pos.set(g.id, [cx + Math.cos(ang) * W * ring, cy + Math.sin(ang) * H * (ring + 0.06), 1]); });
    }
    for (const b of $$('.bubble', box)) {
      const [x, y, s] = pos.get(b.dataset.g);
      b.style.transition = animate && !reduced() ? 'transform .7s cubic-bezier(.2,.8,.2,1), opacity .4s' : 'none';
      b.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
      b.classList.toggle('sel', b.dataset.g === sel?.id); b.classList.toggle('rel', rel.has(b.dataset.g)); b.classList.toggle('dim', !!sel && b.dataset.g !== sel.id && !rel.has(b.dataset.g));
      b.setAttribute('aria-pressed', b.dataset.g === sel?.id);
    }
    const svg = $('.uni-lines', box);
    if (svg) { svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = sel ? sel.related.map(r => { const [x, y] = pos.get(r) || [cx, cy]; return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`; }).join('') : ''; }
  }
  addEventListener('resize', () => { if (universe) layoutUniverse(false); });
  function selectGenre(id) {
    const g = dsc.genre(id); if (!g || !universe) return;
    universe.sel = id; layoutUniverse(true);
    history.replaceState(null, '', `#/explorar/universo/${id}`);
    const det = $('#uni-detail'); if (!det) return;
    gen++; ctrl?.abort(); ctrl = new AbortController(); loaders.clear();
    setHTML(det, `<div class="genre-hero" style="--hue:${dsc.genreHue(g.id)}"><small class="kicker">Género</small><h2>${esc(g.name)}</h2><div class="chips"><span class="muted">Subgéneros:</span>${g.sub.map(s => `<a class="chip" href="#/explorar/etiqueta/${enc(s)}">${esc(s)}</a>`).join('')}</div><a class="chip" href="#/explorar/genero/${g.id}">Abrir ${esc(g.name)}</a></div>
      ${block('uni-songs', 'Canciones', async signal => { const l = await src.songsByTags([g.q], { key: jamendoKey(), signal, n: 16 }); return l.length ? songStrip(l) : '<p class="muted">Sin canciones libres con esta etiqueta ahora mismo.</p>'; })}
      ${block('uni-radio', 'Emisoras', async signal => { const l = await radio.byTag(g.rb, { signal, params: { limit: 20 } }); return l.length ? strip(l.slice(0, 14).map(s => stCard(s))) : '<p class="muted">Sin emisoras con esta etiqueta.</p>'; })}`);
    armBlocks();
  }

  // ========================================================== Atlas
  let atlasMod = null;
  async function loadAtlas() { atlasMod ||= await import('./atlas.js'); return atlasMod; }
  async function viewAtlas() {
    const pref = data.prefs().atlas;
    show(`${subHead('Fiora Atlas', '#/explorar/radios', 'Radios', `<div class="chips atlas-mode" role="group" aria-label="Vista del mapa">${[['auto', 'Automático'], ['3d', 'Globo'], ['2d', 'Mapa plano']].map(([m, l]) => `<button class="chip ${pref === m ? 'on' : ''}" data-act="x-atlas-mode" data-m="${m}">${l}</button>`).join('')}</div>`)}
      <div class="atlas-layout"><div class="atlas-stage" id="atlas"><div class="x-loading"><span class="spin"></span>Cargando el mapa y las emisoras con coordenadas…</div></div>
        <aside class="atlas-panel" id="atlas-panel" aria-live="polite"><p class="muted">Arrastra para girar, rueda o pellizco para acercar y toca un punto para ver sus emisoras. Solo aparecen emisoras con coordenadas en el directorio.</p>
          <h3 class="lib-sub">Ciudades</h3><div class="chips">${dsc.CITIES.map(cty => `<button class="chip" data-act="x-atlas-city" data-city="${cty.id}">${esc(cty.name)}</button>`).join('')}</div></aside></div>
      <details class="atlas-alt"><summary>Explorar sin mapa (lista accesible)</summary><div id="atlas-alt">${block('atlas-list', 'Países', countriesBlock)}</div></details>`);
    armBlocks();
    try {
      const [mod, list] = await Promise.all([loadAtlas(), radio.geoStations(1500, { signal: ctrl.signal })]);
      const box = $('#atlas'); if (!box) return;
      for (const s of list) regSt(radio.fromRef(s));
      mod.mount(box, { stations: list, mode: data.prefs().atlas, onSelect: atlasSelect, onMode: m => { $('.atlas-mode .note')?.remove(); if (m.auto2d) toast(m.reason, 5000); } });
    } catch (e) { if (e?.name !== 'AbortError') $('#atlas') && setHTML($('#atlas'), `${errHTML(e)}<p class="muted">Puedes usar la lista de países de abajo.</p>`); }
  }
  function atlasSelect(group) {
    const panel = $('#atlas-panel'); if (!panel) return;
    const sts = group.stations.map(s => regSt(radio.fromRef(s)));
    const cty = dsc.nearestCity({ lat: group.lat, lon: group.lon }, 50);
    const ccs = [...new Set(sts.map(s => s.cc).filter(Boolean))];
    const tags = new Map(); for (const s of sts) for (const t of s.tags) tags.set(t, (tags.get(t) || 0) + 1);
    const m = cty && dsc.localMoment(cty);
    setHTML(panel, `${cty ? `<small class="kicker">${esc(m.phrase)}</small><h2>${esc(cty.name)}</h2><p>${radio.flag(cty.cc)} ${esc(radio.countryName(cty.cc))} · hora local <time>${m.time}</time></p><a class="chip" href="#/explorar/ciudad/${cty.id}">Abrir la ciudad</a>`
      : `<small class="kicker">Zona</small><h2>${ccs.map(cc => `${radio.flag(cc)} ${esc(radio.countryName(cc))}`).join(', ') || 'Zona'}</h2><p class="muted small">Cerca de ${group.lat.toFixed(1)}°, ${group.lon.toFixed(1)}° · sin hora local (no es una de las ciudades con zona horaria conocida)</p>`}
      <p>${plural(sts.length, 'emisora', 'emisoras')}</p>
      ${tags.size ? `<div class="chips">${[...tags].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `<span class="chip">${esc(t)} <small class="muted">${n}</small></span>`).join('')}</div>` : ''}
      <div class="actions"><button class="btn primary sm" data-act="x-play-first" data-uuid="${esc(sts[0].uuid)}">${icon('play')}Escuchar</button></div>
      ${stList(sts.slice(0, 40))}`);
    panel.scrollTop = 0;
  }

  // ========================================================== Pasaporte
  async function viewPassport() {
    const pp = data.prefs().passport, stamps = data.passport();
    const favByCc = new Map(); for (const s of data.favs()) if (s.cc) (favByCc.get(s.cc) || favByCc.set(s.cc, []).get(s.cc)).push(s);
    const fmt = ms => new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
    show(`${subHead('Pasaporte musical', '#/explorar/radios', 'Radios')}
      <div class="passport-top"><div class="pp-count"><b>${stamps.length}</b><span>${stamps.length === 1 ? 'país explorado' : 'países explorados'}</span></div>
        <p class="muted">Un país se sella cuando escuchas una de sus emisoras al menos ${pp.secs < 60 ? pp.secs + ' segundos' : pp.secs / 60 + (pp.secs === 60 ? ' minuto' : ' minutos')} seguidos (sin contar pausas). Abrir una ficha no cuenta.
          ${account.user() ? '' : ' <a href="#/ajustes">Inicia sesión</a> para conservarlo en todos tus dispositivos.'}</p></div>
      <div id="pp-map" class="pp-map"><div class="x-loading"><span class="spin"></span>Cargando mapa…</div></div>
      ${stamps.length ? `<h2>Sellos</h2><div class="stamps">${stamps.map((s, i) => `<div class="stamp" style="--r:${((i * 37) % 9) - 4}deg;--hue:${hueOf(s.cc)}"><span class="flag">${radio.flag(s.cc)}</span><b>${esc(radio.countryName(s.cc))}</b><small>${fmt(s.first)}</small><small class="st-name">${esc(s.name || '')}</small></div>`).join('')}</div>
        <h2>Últimos descubrimientos</h2><ol class="pp-recent">${stamps.slice(0, 8).map(s => `<li>${radio.flag(s.cc)} <b>${esc(radio.countryName(s.cc))}</b> · ${fmt(s.first)}${s.name ? ` · con ${esc(s.name)}` : ''} <a class="chip" href="#/explorar/pais/${s.cc}">Más de ${esc(radio.countryName(s.cc))}</a></li>`).join('')}</ol>`
        : `<div class="empty">${icon('star')}<h2>Aún no hay sellos</h2><div>Escucha emisoras de otros países: gira la <a href="#/explorar/ruleta">ruleta</a>, abre el <a href="#/explorar/atlas">Atlas</a> o empieza un <a href="#/explorar/viaje">viaje</a>.</div></div>`}
      ${favByCc.size ? `<h2>Favoritas por país</h2>${[...favByCc].map(([cc, l]) => `<h3 class="lib-sub">${radio.flag(cc)} ${esc(radio.countryName(cc))}</h3>${strip(l.map(st => stCard(st)))}`).join('')}` : ''}
      <details class="pp-settings"><summary>${icon('settings')} Ajustes del pasaporte</summary>
        <label class="switch-row"><input type="checkbox" data-pp="on" ${pp.on ? 'checked' : ''}><span>Registrar países que escucho</span></label>
        <label class="field sm">${icon('radio')}<span class="muted">Tiempo mínimo</span><select data-pp="secs">${[30, 60, 120, 300].map(s => `<option value="${s}" ${pp.secs === s ? 'selected' : ''}>${s < 60 ? s + ' s' : s / 60 + ' min'}</option>`).join('')}</select></label>
        <button class="btn sm danger" data-act="x-pp-reset" ${stamps.length ? '' : 'disabled'}>Borrar mi pasaporte</button></details>`);
    try {
      const mod = await loadAtlas(); const box = $('#pp-map'); if (!box) return;
      mod.mountPassport(box, { visited: new Set(stamps.map(s => s.cc)) });
    } catch (e) { $('#pp-map') && setHTML($('#pp-map'), errHTML(e)); }
  }
  view.addEventListener('change', async e => {
    const el = e.target.closest('[data-pp]');
    if (!el) return;
    const pp = { ...data.prefs().passport, [el.dataset.pp]: el.dataset.pp === 'on' ? el.checked : +el.value };
    await data.setPrefs({ passport: pp });
    toast(el.dataset.pp === 'on' ? (pp.on ? 'El pasaporte vuelve a registrar países' : 'El pasaporte deja de registrar países') : 'Tiempo mínimo actualizado');
  });

  // ========================================================== Viajes musicales
  let jDraft = null;
  function draft() {
    jDraft ||= data.prefs().journey || { stops: ['madrid', 'paris', 'berlin', 'tokio'].map(id => ({ kind: 'city', id })), tag: '', mins: 5, auto: true };
    return jDraft;
  }
  const stopName = s => (s.kind === 'city' ? dsc.city(s.id)?.name : radio.countryName(s.id)) || s.id;
  async function viewJourney() {
    const cur = session.current();
    if (cur?.kind === 'journey') return paintRunning(cur);
    const d = draft();
    show(`${subHead('Viajes musicales', '#/explorar/radios', 'Radios')}
      <p class="muted">Elige destinos: en cada uno sonará una emisora real de allí (cerca de la ciudad según sus coordenadas o del país) el tiempo que digas, y pasará sola al siguiente. Si una emisora falla, se busca otra del mismo destino.</p>
      <div class="journey-builder">
        <ol class="j-stops">${d.stops.map((s, i) => `<li><span class="j-dot">${i + 1}</span><span class="j-name">${s.kind === 'country' ? radio.flag(s.id) + ' ' : ''}${esc(stopName(s))}</span>
          <button class="icon-btn" data-act="x-j-move" data-i="${i}" data-d="-1" aria-label="Subir" ${i ? '' : 'disabled'}>${icon('up')}</button><button class="icon-btn" data-act="x-j-move" data-i="${i}" data-d="1" aria-label="Bajar" ${i < d.stops.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
          <button class="icon-btn" data-act="x-j-del" data-i="${i}" aria-label="Quitar">${icon('x')}</button></li>`).join('')}</ol>
        <div class="j-add"><label class="field sm">${icon('plus')}<select data-j-add><option value="">Añadir destino…</option><optgroup label="Ciudades">${dsc.CITIES.map(cty => `<option value="city:${cty.id}">${esc(cty.name)}</option>`).join('')}</optgroup><optgroup label="Países">${COUNTRY_CODES.map(cc => `<option value="country:${cc}">${radio.flag(cc)} ${esc(radio.countryName(cc))}</option>`).join('')}</optgroup></select></label></div>
        <div class="j-opts"><label class="field sm">${icon('disc')}<select data-j="tag"><option value="">Cualquier música</option>${dsc.GENRES.map(g => `<option value="${esc(g.rb)}" ${d.tag === g.rb ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
          <div class="chips" role="radiogroup" aria-label="Tiempo por emisora">${[3, 5, 10].map(m => `<button class="chip ${d.mins === m ? 'on' : ''}" data-act="x-j-mins" data-m="${m}" role="radio" aria-checked="${d.mins === m}">${m} min</button>`).join('')}</div>
          <label class="switch-row"><input type="checkbox" data-j="auto" ${d.auto ? 'checked' : ''}><span>Pasar solo al siguiente destino</span></label></div>
        <button class="btn primary" data-act="x-j-start" ${d.stops.length ? '' : 'disabled'}>${icon('play')}Empezar el viaje</button></div>`);
  }
  async function stationsForStop(s, tag) {
    const music = l => { const m = l.filter(dsc.isMusic); return m.length ? m : l; };
    const params = tag ? { tag } : {};
    if (s.kind === 'city') {
      const cty = dsc.city(s.id);
      let l = await radio.near(cty.lat, cty.lon, 50, { params: { limit: 40, ...params } });
      if (l.length < 3) l = [...l, ...(await radio.byCountry(cty.cc, { params: { limit: 40, ...params } }))];
      if (!l.length && tag) l = await radio.near(cty.lat, cty.lon, 50, { params: { limit: 40 } });
      return music(l).sort(() => Math.random() - 0.5);
    }
    let l = await radio.byCountry(s.id, { params: { limit: 40, ...params } });
    if (!l.length && tag) l = await radio.byCountry(s.id, { params: { limit: 40 } });
    return music(l).sort(() => Math.random() - 0.5);
  }
  async function startJourney() {
    const d = draft();
    await data.setPrefs({ journey: d });
    await session.start({
      kind: 'journey', title: d.stops.map(stopName).join(' → '), secs: d.mins * 60, auto: d.auto,
      stops: d.stops.map(s => ({ label: stopName(s), sub: s.kind === 'city' ? radio.countryName(dsc.city(s.id)?.cc) : 'País', pick: () => stationsForStop(s, d.tag) })),
    });
  }
  function paintRunning(cur) {
    const isJ = cur.kind === 'journey';
    const pct = cur.secs ? Math.min(1, cur.elapsed / cur.secs) : 0;
    const left = Math.max(0, Math.ceil(cur.secs - cur.elapsed));
    const ring = `<svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg" style="stroke-dasharray:${(2 * Math.PI * 52).toFixed(1)};stroke-dashoffset:${((1 - pct) * 2 * Math.PI * 52).toFixed(1)}"/></svg>`;
    const html = `${subHead(isJ ? 'Viaje en curso' : 'Degustación', '#/explorar/radios', 'Radios')}
      <div class="run ${isJ ? 'journey' : 'tasting'}" id="run">
        ${isJ ? `<ol class="route">${cur.stops.map((s, i) => `<li class="${i < cur.i ? 'done' : i === cur.i ? 'now' : ''}"><span class="dot"></span><b>${esc(s.label)}</b><small>${esc(s.station?.title || s.sub || '')}</small></li>`).join('')}</ol>` : ''}
        <div class="run-now"><div class="ring-wrap">${ring}${cur.station ? logo(cur.station, 'lg') : '<span class="spin"></span>'}</div>
          <div><small class="kicker">${isJ ? `Destino ${cur.i + 1} de ${cur.total}` : `Emisora ${cur.i + 1} de ${cur.total}`}</small><h2>${esc(cur.stops[cur.i]?.label || '')}</h2>
          <p>${cur.loading ? 'Buscando una emisora…' : cur.station ? `${esc(cur.station.title)} · ${esc(where(cur.station))}` : esc(cur.error || '')}</p>
          <p class="muted small">${cur.auto ? `Siguiente en ${left >= 60 ? Math.floor(left / 60) + ' min ' : ''}${left % 60} s de escucha` : 'Paso automático desactivado'}${cur.paused ? ' · en pausa (el tiempo no corre)' : ''}</p></div></div>
        <div class="actions run-ctl"><button class="btn primary" data-act="x-s-toggle">${icon(cur.paused ? 'play' : 'pause')}${cur.paused ? 'Seguir' : 'Pausar'}</button>
          <button class="btn" data-act="x-s-skip">${icon('next')}${isJ ? 'Saltar destino' : 'Siguiente'}</button>
          <button class="btn ${cur.repeat ? 'on' : ''}" data-act="x-s-repeat" aria-pressed="${cur.repeat}">${icon('repeat')}Repetir</button>
          <button class="btn danger" data-act="x-s-stop">${icon('x')}Terminar</button></div></div>`;
    show(html);
  }
  on('session', cur => {
    if (!/^#\/explorar\/(viaje|degustar)/.test(location.hash)) return;
    if (cur) paintRunning(cur); else c.refresh();
  });
  on('session-tick', cur => {
    if (!cur || !$('#run')) return;
    const fg = $('#run .ring .fg'); if (fg) fg.style.strokeDashoffset = ((1 - Math.min(1, cur.elapsed / cur.secs)) * 2 * Math.PI * 52).toFixed(1);
    const left = Math.max(0, Math.ceil(cur.secs - cur.elapsed));
    const note = $('#run .run-now .muted.small'); if (note) note.textContent = `${cur.auto ? `Siguiente en ${left >= 60 ? Math.floor(left / 60) + ' min ' : ''}${left % 60} s de escucha` : 'Paso automático desactivado'}${cur.paused ? ' · en pausa (el tiempo no corre)' : ''}`;
    const tg = $('[data-act="x-s-toggle"]'); if (tg) tg.innerHTML = `${icon(cur.paused ? 'play' : 'pause')}${cur.paused ? 'Seguir' : 'Pausar'}`;
  });

  // ========================================================== Degustación
  let tDraft = { from: 'favs', interval: 0, tag: 'jazz', coll: '' };
  async function viewTasting() {
    const cur = session.current();
    if (cur?.kind === 'tasting') return paintRunning(cur);
    tDraft.interval ||= data.prefs().tasting || 30;   // lo guardado, solo la primera vez (luego manda lo que elijas)
    const colls = data.collections();
    show(`${subHead('Degustación de radios', '#/explorar/radios', 'Radios')}
      <p class="muted">Escucha varias emisoras seguidas, unos segundos cada una, y quédate con la que te guste (pulsa «Terminar» y sigue sonando la actual… o guárdala con el corazón). No se graba nada.</p>
      <div class="journey-builder"><div class="chips" role="radiogroup" aria-label="Qué emisoras">${[['favs', 'Tus favoritas'], ['coll', 'Una colección'], ['genre', 'Un género'], ['trend', 'Tendencias de hoy']].map(([k, l]) => `<button class="chip ${tDraft.from === k ? 'on' : ''}" data-act="x-t-from" data-k="${k}" role="radio" aria-checked="${tDraft.from === k}">${l}</button>`).join('')}</div>
        ${tDraft.from === 'coll' ? (colls.length ? `<label class="field sm">${icon('list')}<select data-t="coll">${colls.map(cl => `<option value="${esc(cl.id)}" ${tDraft.coll === cl.id ? 'selected' : ''}>${esc(cl.name)} (${cl.items.length})</option>`).join('')}</select></label>` : '<p class="muted">Aún no tienes colecciones.</p>') : ''}
        ${tDraft.from === 'genre' ? `<label class="field sm">${icon('disc')}<select data-t="tag">${dsc.GENRES.map(g => `<option value="${esc(g.rb)}" ${tDraft.tag === g.rb ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>` : ''}
        <div class="chips" role="radiogroup" aria-label="Tiempo por emisora">${[15, 30, 60].map(s => `<button class="chip ${tDraft.interval === s ? 'on' : ''}" data-act="x-t-int" data-s="${s}" role="radio" aria-checked="${tDraft.interval === s}">${s} s</button>`).join('')}</div>
        <button class="btn primary" data-act="x-t-start">${icon('play')}Empezar</button></div>`);
  }
  async function startTasting() {
    let list = [];
    if (tDraft.from === 'favs') list = data.favs();
    if (tDraft.from === 'coll') { const cl = data.collection(tDraft.coll) || data.collections()[0]; list = cl ? data.stationsOf(cl) : []; }
    if (tDraft.from === 'genre') list = await radio.byTag(tDraft.tag, { params: { limit: 30 } });
    if (tDraft.from === 'trend') list = await radio.search({ order: 'clickcount', reverse: 'true', limit: 30 }, { ttl: radio.HOUR });
    list = list.slice(0, 20);
    if (!list.length) return toast('No hay emisoras para degustar con esa opción');
    await data.setPrefs({ tasting: tDraft.interval });
    await session.start({ kind: 'tasting', title: 'Degustación', secs: tDraft.interval, auto: true, stops: list.map(s => ({ label: s.title, sub: where(s), pick: async () => [s] })) });
  }

  // ========================================================== colecciones
  async function viewCollection(id) {
    const cl = data.collection(id);
    if (!cl) return show(`${subHead('', '#/explorar/radios', 'Radios')}${empty('list', 'Colección no encontrada', 'Puede que se haya borrado en otro dispositivo.')}`);
    const sts = data.stationsOf(cl);
    show(`${subHead('', '#/explorar/radios', 'Radios')}<div class="coll-hero"><span class="coll-cover big" data-coll="${esc(cl.id)}">${sts.slice(0, 4).map(s => logo(s)).join('') || `<i>${icon('radio')}</i>`}</span>
        <div><small class="kicker">Colección de emisoras</small><h1>${esc(cl.name)}</h1>${cl.description ? `<p>${esc(cl.description)}</p>` : ''}<p class="muted">${plural(sts.length, 'emisora', 'emisoras')}${cl.cover?.only ? ' · portada solo en este dispositivo' : ''}</p>
        <div class="actions">${sts.length ? `<button class="btn primary" data-act="x-play-first" data-uuid="${esc(sts[0].uuid)}">${icon('play')}Escuchar</button><button class="btn" data-act="x-coll-taste" data-id="${esc(cl.id)}">${icon('radio')}Degustar</button>` : ''}
          <button class="btn" data-act="x-coll-edit" data-id="${esc(cl.id)}">${icon('edit')}Editar</button><button class="btn" data-act="x-coll-cover" data-id="${esc(cl.id)}">${icon('image')}Portada</button>
          <button class="btn danger" data-act="x-coll-del" data-id="${esc(cl.id)}">${icon('trash')}Eliminar</button></div></div></div>
      ${sts.length ? `<ol class="st-list coll-list">${sts.map((s, i) => stRow(s).replace('<button class="icon-btn" data-act="x-more"', `<button class="icon-btn" data-act="x-c-move" data-id="${esc(cl.id)}" data-i="${i}" data-d="-1" aria-label="Subir" ${i ? '' : 'disabled'}>${icon('up')}</button><button class="icon-btn" data-act="x-c-move" data-id="${esc(cl.id)}" data-i="${i}" data-d="1" aria-label="Bajar" ${i < sts.length - 1 ? '' : 'disabled'}>${icon('down')}</button><button class="icon-btn" data-act="x-c-rm" data-id="${esc(cl.id)}" data-uuid="${esc(s.uuid)}" aria-label="Quitar de la colección">${icon('x')}</button><button class="icon-btn" data-act="x-more"`)).join('')}</ol>`
        : '<p class="muted">Añade emisoras desde su menú ⋯ → «Añadir a una colección».</p>'}`);
    paintCollCovers();
  }
  async function editCollection(cl) {
    openSheet(`<form class="dlg" method="dialog" data-coll-form><h3>Editar colección</h3>
      <label class="field"><input name="name" maxlength="80" value="${esc(cl.name)}" placeholder="Nombre" required></label>
      <label class="field"><textarea name="description" maxlength="500" rows="3" placeholder="Descripción (opcional)">${esc(cl.description || '')}</textarea></label>
      <div class="actions"><button type="button" class="btn ghost" data-x>Cancelar</button><button class="btn primary">Guardar</button></div></form>`, e => { if (e.target.closest('[data-x]')) sheet.close(); });
    $('form', sheet).onsubmit = async ev => { const f = ev.target; cl.name = f.name.value; cl.description = f.description.value; await data.saveCollection(cl); c.refresh(); };
  }
  async function pickCover(cl) {
    const files = await PL.pickFiles(false);
    if (!files.length) return;
    const [res] = await PL.prepareImages(files, 'cover', 'radio-' + cl.id);
    if (!res) return;
    const note = toast('Guardando la portada…', 0);
    try {
      const up = await data.setCover(cl, res.rec, res.cloud);
      note.done(!res.cloud ? 'Portada guardada solo en este dispositivo (supera los 16 MB)' : up ? 'Portada guardada en tu cuenta' : account.user() ? 'Portada guardada aquí: se subirá cuando sea posible' : 'Portada guardada en este dispositivo: se subirá cuando inicies sesión');
    } catch (e) { note.done(`No se pudo guardar la portada: ${e.message}`, 7000); }
    c.refresh();
  }

  // ========================================================== pantalla de radio en directo
  function liveHTML(t) {
    regSt(t);
    const tech = [t.codec, t.bitrate ? `${t.bitrate} kbps` : '', t.hls ? 'HLS' : ''].filter(Boolean).join(' · ');
    const cur = session.current();
    return `<div class="top"><button class="icon-btn" data-act="close-now" aria-label="Cerrar">${icon('down')}</button><div class="live-badge"><span class="dotlive"></span>En directo</div>
        <button class="icon-btn" data-act="x-more" data-uuid="${esc(t.uuid)}" aria-label="Más opciones">${icon('more')}</button></div>
      <div class="body live"><div class="left">
        <div class="live-stage" style="--hue:${hueOf(t.title)}"><div class="aura" aria-hidden="true"><span></span><span></span><span></span></div>${logo(t, 'xxl')}<small class="deco-note">Animación decorativa: no representa el sonido</small></div>
        <div class="meta"><div><b>${esc(t.title)}</b><span>${esc(where(t))}</span>${t.tags.length ? `<span class="tags">${esc(t.tags.slice(0, 5).join(' · '))}</span>` : ''}</div>${favBtn(t)}</div>
        <dl class="st-facts">${t.langs.length ? `<dt>Idioma</dt><dd>${esc(t.langs.map(l => cap(radio.langName(l))).join(', '))}</dd>` : ''}${tech ? `<dt>Stream</dt><dd>${esc(tech)}</dd>` : ''}${t.homepage ? `<dt>Web</dt><dd><a href="${esc(t.homepage)}" target="_blank" rel="noopener noreferrer">${esc(t.homepage.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></dd>` : ''}
          <dt>Canción</dt><dd class="muted">El directorio no informa de qué suena en cada momento</dd></dl>
        ${cur ? `<p class="muted small">${cur.kind === 'journey' ? 'Viaje' : 'Degustación'} en curso · <a href="#/explorar/${cur.kind === 'journey' ? 'viaje' : 'degustar'}" data-act="close-now">ver</a></p>` : ''}
        <div class="ctl"><span></span>${cur ? `<button class="icon-btn mid" data-act="x-s-skip" aria-label="Siguiente emisora">${icon('next')}</button>` : '<span></span>'}
          <button class="icon-btn big js-play" data-act="toggle" aria-label="Reproducir o pausar"></button>
          <a class="icon-btn mid" href="#/explorar/radar/${enc(t.uuid)}" data-act="close-now" aria-label="Fiora Radar" title="Emisoras parecidas">${icon('compass')}</a><span></span></div>
      </div><div class="pane live-pane"><h2>Emisoras parecidas</h2><div id="live-similar"><div class="x-loading"><span class="spin"></span>Buscando…</div></div></div></div>`;
  }
  let liveFor = null;
  async function fillLive(root, t) {
    if (liveFor === t.id && $('#live-similar', root)?.dataset.done) return;
    liveFor = t.id;
    try {
      const rel = await dsc.related(t, { n: 8 });
      const box = $('#live-similar', root); if (!box || P.current?.id !== t.id) return;
      setHTML(box, rel.length ? stList(rel.map(r => r.s), s => { const r = rel.find(x => x.s.uuid === s.uuid); return ` · <span class="metric">${esc(r.why.slice(0, 3).join(', '))}</span>`; }) : '<p class="muted">No hay emisoras con datos en común.</p>');
      box.dataset.done = '1';
    } catch (e) { const box = $('#live-similar', root); if (box) box.innerHTML = errHTML(e); }
  }

  // ========================================================== acciones
  const stOf = el => stations.get(el.dataset.uuid) || (P.current?.uuid === el.dataset.uuid ? P.current : null) || data.favs().find(s => s.uuid === el.dataset.uuid);
  Object.assign(ACTIONS, {
    'x-play'(el) { const st = stOf(el); if (!st) return; if (isOn(st)) { if (!P.playing) player.toggle(); return; } playStation(st); },
    'x-play-first'(el) { const st = stOf(el); if (st) playStation(st); },
    'x-open'(el) { const st = stOf(el); if (st) stationSheet(st); },
    'x-more'(el) { const st = stOf(el); if (st) stationMenu(st); },
    'x-fav'(el) { const st = stOf(el); if (st) toggleFav(st); },
    'x-song'(el) { const l = songLists.get(el.dataset.k); if (!l) return; const list = l.filter(playable); const t = l[+el.dataset.i]; session.stop(true); player.playQueue(list, Math.max(0, list.indexOf(t))); },
    'x-song-more'(el) { const l = songLists.get(el.dataset.k); if (l) trackMenu(l[+el.dataset.i]); },
    'x-play-list'(el) { const l = songLists.get(el.dataset.k)?.filter(playable); if (l?.length) { session.stop(true); player.playQueue(l); } },
    'x-surprise'(el) { surprise(el.dataset.kind || 'any'); },
    'x-q-clear'() { const q = $('#x-q'); if (q) { q.value = ''; onQuery(''); q.focus(); } },
    'x-scope'(el) { X.scope = el.dataset.scope; paintBody(resultsHTML()); runSearch(); },
    'x-cat'(el) { X.cat = el.dataset.cat; L.error = ''; paintBody(tabHTML(X.tab)); },
    'x-suggest'(el) { const q = $('#x-q'); if (q) q.value = el.dataset.q; X.q = el.dataset.q; $('.x-bar .clear')?.removeAttribute('hidden'); X.scope = 'music'; paintBody(resultsHTML()); runSearch(); },
    'x-more-results'() { searchMusic(L.q, true); },
    'x-artist'(el) { const q = $('#x-q'); if (q) q.value = el.dataset.name; onQuery(el.dataset.name); },
    'x-retry'(el) { const s = $(`[data-xb="${CSS.escape(el.dataset.xb)}"]`); if (s) { setHTML($('.xb-body', s), skel()); runBlock(s); } },
    'x-retry-search'() { runSearch(); },
    'x-trend'(el) { trendTab = el.dataset.t; const s = $('[data-xb="trend"]'); if (s) runBlock(s); },
    async 'x-mix-reset'() { await data.setPrefs({ mix: { ...data.DEFAULT_PREFS.mix } }); $$('[data-mix]').forEach(r => { r.value = 50; }); repaintMixed(); },
    'x-new-coll': async () => { const n = await ask({ title: 'Nueva colección de emisoras', placeholder: 'Nombre', ok: 'Crear' }); if (!n) return; const cl = await data.newCollection(n); c.go(`#/explorar/coleccion/${enc(cl.id)}`); },
    'x-coll-edit'(el) { const cl = data.collection(el.dataset.id); if (cl) editCollection(cl); },
    'x-coll-cover'(el) { const cl = data.collection(el.dataset.id); if (cl) pickCover(cl); },
    async 'x-coll-del'(el) { const cl = data.collection(el.dataset.id); if (cl && await confirmDlg('¿Eliminar la colección?', `«${cl.name}» se borrará en todos tus dispositivos. Las emisoras no se borran de tus favoritas.`)) { await data.deleteCollection(cl); toast('Colección eliminada'); c.go('#/explorar/radios'); } },
    async 'x-c-move'(el) { const cl = data.collection(el.dataset.id); const i = +el.dataset.i, j = i + +el.dataset.d; if (!cl || j < 0 || j >= cl.items.length) return; [cl.items[i], cl.items[j]] = [cl.items[j], cl.items[i]]; await data.saveCollection(cl); c.refresh(); },
    async 'x-c-rm'(el) { const cl = data.collection(el.dataset.id); if (cl) { await data.removeFromCollection(cl, el.dataset.uuid); c.refresh(); } },
    'x-coll-taste'(el) { tDraft = { ...tDraft, from: 'coll', coll: el.dataset.id }; c.go('#/explorar/degustar'); },
    'x-r-mode'(el) { rState.mode = el.dataset.m; data.setPrefs({ roulette: rState.mode }); viewRoulette(); },
    'x-spin'() { spin(); },
    'x-roulette-genre'(el) { c.go(`#/explorar/ruleta?tag=${enc(el.dataset.tag)}`); },
    'x-uni'(el) { selectGenre(el.dataset.g); },
    'x-uni-list'(el) { const l = $('.uni-list'), u = $('#universe'); const show2 = l.hidden; l.hidden = !show2; u.hidden = show2; el.setAttribute('aria-pressed', show2); },
    async 'x-atlas-mode'(el) { await data.setPrefs({ atlas: el.dataset.m }); $$('.atlas-mode .chip').forEach(b => b.classList.toggle('on', b === el)); atlasMod?.setMode?.(el.dataset.m); },
    'x-atlas-city'(el) { const cty = dsc.city(el.dataset.city); if (cty) atlasMod?.focus?.(cty.lat, cty.lon); },
    async 'x-pp-reset'() { if (await confirmDlg('¿Borrar tu pasaporte?', 'Se borran todos los sellos en todos tus dispositivos. No se puede deshacer.', 'Borrar')) { await data.resetPassport(); c.refresh(); } },
    'x-j-move'(el) { const d = draft(), i = +el.dataset.i, j = i + +el.dataset.d; if (j < 0 || j >= d.stops.length) return; [d.stops[i], d.stops[j]] = [d.stops[j], d.stops[i]]; viewJourney(); },
    'x-j-del'(el) { draft().stops.splice(+el.dataset.i, 1); viewJourney(); },
    'x-j-mins'(el) { draft().mins = +el.dataset.m; viewJourney(); },
    async 'x-j-start'(el) { el.disabled = true; try { await startJourney(); } catch (e) { toast(e.message); el.disabled = false; } },
    'x-s-toggle'() { session.toggle(); },
    'x-s-skip'() { session.skip(); },
    'x-s-repeat'() { const cur = session.current(); if (cur) session.setRepeat(!cur.repeat); },
    'x-s-stop'() { session.stop(); },
    'x-t-from'(el) { tDraft.from = el.dataset.k; viewTasting(); },
    'x-t-int'(el) { tDraft.interval = +el.dataset.s; viewTasting(); },
    async 'x-t-start'(el) { el.disabled = true; try { await startTasting(); } catch (e) { toast(friendly(e)); el.disabled = false; } },
  });
  view.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-r]')) { rState[t.dataset.r] = t.value; }
    if (t.matches('[data-j-add]') && t.value) { const [kind, id] = t.value.split(':'); draft().stops.push({ kind, id }); viewJourney(); }
    if (t.matches('[data-j="tag"]')) draft().tag = t.value;
    if (t.matches('[data-j="auto"]')) draft().auto = t.checked;
    if (t.matches('[data-t="tag"]')) tDraft.tag = t.value;
    if (t.matches('[data-t="coll"]')) tDraft.coll = t.value;
  });
  // logos que no cargan: se queda la inicial (las imágenes de terceros pueden fallar)
  document.addEventListener('error', e => { if (e.target?.closest?.('.st-logo') && e.target.tagName === 'IMG') e.target.remove(); }, true);
  on('explore', what => {
    if (what === 'favs' || what === 'all') $$('.fav[data-uuid]').forEach(b => { const v = data.isFav(b.dataset.uuid); b.classList.toggle('on', v); b.setAttribute('aria-pressed', v); });
    if ((what === 'colls' || what === 'all') && /^#\/explorar\/(radios|coleccion)/.test(location.hash) && !sheet.open) c.refresh();
  });

  const SUBVIEWS = {
    ambiente: viewAmbient, genero: viewGenre, etiqueta: tag => viewTagPage(decodeURIComponent(tag || '')), ciudad: viewCity, pais: viewCountry,
    ruleta: viewRoulette, radar: viewRadar, universo: viewUniverse, atlas: viewAtlas, pasaporte: viewPassport, viaje: viewJourney, degustar: viewTasting,
    coleccion: viewCollection,
  };
  return {
    view: viewExplore, stationMenu, liveHTML, fillLive,
    forms: { async 'jamendo-key'(form) { S.settings.jamendoId = form.key.value.trim(); await c.saveKV('settings', false); paintBody(X.q ? resultsHTML() : tabHTML(X.tab)); if (X.q) runSearch(); } },
  };
}
