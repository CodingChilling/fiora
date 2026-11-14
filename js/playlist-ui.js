// Interfaz de las playlists: lista de playlists, vista de una playlist (cabecera, carrusel,
// destacadas, canciones con capítulos, estadísticas, «Descubre más», notas), editor por
// categorías, visor de fotos y modos de reproducción. Los datos y la sincronización con Supabase
// están en playlists-data.js; las imágenes, en images.js.
import { S, on, savePlaylist, livePlaylists, isFav, toggleFav, artistsOf, collator, MOODS, dropFromPlaylist } from './store.js';
import * as data from './playlists-data.js';
import * as img from './images.js';
import * as lib from './library.js';
import * as player from './player.js';
import * as account from './account.js';
import { icon } from './icons.js';
import { IMAGE_MAX_BYTES, MAX_PHOTOS, MAX_FEATURED } from './config.js';

const TAG_SUGGESTIONS = ['Chill', 'Nostalgia', 'Estudio', 'Viajes', 'Verano', 'Romance', 'Energía', 'Noche', 'Fiesta', 'Lluvia', 'Carretera', 'Concentración'];
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const date = ms => (ms ? new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initPlaylists(c) {
  const { esc, enc, plural, totalTime, toast, openSheet, sheet, confirmDlg, menu, show, rows, empty, refresh, playable, num } = c;
  const byId = id => S.playlists.find(p => p.id === id && !p.deleted);
  const tracksOf = p => p.trackIds.map(id => S.tracks.get(id)).filter(Boolean);
  const views = new Map();   // estado de la vista de cada playlist (búsqueda, orden, filtros…) mientras se usa la app
  const viewOf = p => {
    if (!views.has(p.id)) views.set(p.id, { q: '', sort: 'custom', f: {}, reorder: false, discover: 'similar', page: 0, ...(p.settings.view || {}) });
    return views.get(p.id);
  };

  // ================================================================ portadas
  /** Marcador de portada; se rellena después con hydrate(). */
  function coverHTML(p, cls = '', big = false) {
    const label = (p.emoji || p.name || '♪').trim();
    const hue = data.isFavs(p) ? 340 : [...p.name].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) % 360, 7);
    const mark = data.isFavs(p) && !p.emoji ? icon('heart') : esc([...label][0] || '♪');
    return `<span class="cover pl-cover ${cls}" data-plcover="${esc(p.id)}" data-big="${big ? 1 : ''}" style="--hue:${hue}"><i>${mark}</i></span>`;
  }
  const cropStyle = cr => (cr ? `object-position:${cr.x}% ${cr.y}%;transform:scale(${cr.z || 1});transform-origin:${cr.x}% ${cr.y}%` : '');
  async function paintCover(el) {
    const p = byId(el.dataset.plcover) || S.playlists.find(x => x.id === el.dataset.plcover);
    if (!p) return;
    const big = !!el.dataset.big, l = data.localOf(p.id);
    let url = null, crop = null, local = false;
    if (l.cover) {
      const rec = await img.getLocal(l.cover);
      if (rec) { url = await img.localUrl(l.cover, !big); crop = rec.crop; local = rec.state; }
    }
    if (!url && p.cover.kind === 'image') { url = await img.cloudUrl(big ? p.cover.path : p.cover.thumb || p.cover.path); crop = p.cover.crop; }
    if (!url && p.cover.kind === 'collage') {
      const seen = new Set(), picks = [];
      for (const t of tracksOf(p)) { const k = t.coverId || t.coverUrl; if (k && !seen.has(k)) { seen.add(k); picks.push(t); } if (picks.length === 4) break; }
      if (picks.length >= 2) {
        const srcs = (await Promise.all(picks.map(t => lib.coverUrl(t)))).filter(Boolean);
        if (srcs.length >= 2) {
          while (srcs.length < 4) srcs.push(srcs[srcs.length % 2]);
          el.classList.add('has', 'collage');
          el.innerHTML = srcs.map(u => `<img alt="" src="${u}" loading="lazy">`).join('');
          return;
        }
      }
    }
    if (!url && !data.isFavs(p)) { const t = tracksOf(p).find(x => x.coverId || x.coverUrl); url = t ? await lib.coverUrl(t) : null; }
    if (!url) return;   // «Canciones que te gustan» sin foto: el corazón de siempre
    const im = new Image();
    im.alt = ''; im.decoding = 'async'; im.src = url;
    if (crop) im.style.cssText = cropStyle(crop);
    im.onload = () => {
      el.classList.add('has'); el.classList.remove('collage');
      el.querySelector('img')?.remove();
      el.prepend(im);
      if (local) el.insertAdjacentHTML('beforeend', `<span class="only-local" title="${local === 'pending' ? 'Pendiente de subir' : 'Esta foto solo está en este dispositivo'}">${local === 'pending' ? 'Pendiente de subir' : 'Solo local'}</span>`);
    };
  }
  /** Rellena portadas y fotos de un trozo de la página. */
  function hydrate(root = document) {
    $$('[data-plcover]', root).forEach(el => paintCover(el).catch(() => {}));
    $$('[data-photo]', root).forEach(el => paintPhoto(el).catch(() => {}));
  }
  async function paintPhoto(el) {
    const id = el.dataset.photo, p = byId(el.dataset.pid);
    if (!p) return;
    const f = p.photos.find(x => x.id === id);
    const url = f ? await img.cloudUrl(f.thumb || f.path) : await img.localUrl(id, true);
    if (url) { const im = el.querySelector('img'); im.src = url; im.onload = () => el.classList.add('has'); }
  }

  // ================================================================ colores
  async function coverBlob(p) {
    const l = data.localOf(p.id);
    if (l.cover) { const r = await img.getLocal(l.cover); if (r) return r.thumb || r.blob; }
    if (p.cover.kind === 'image') { const u = await img.cloudUrl(p.cover.thumb || p.cover.path); if (u) return (await fetch(u)).blob(); }
    const t = tracksOf(p).find(x => x.coverId);
    if (t) { const u = await lib.coverUrl(t); if (u) return (await fetch(u)).blob(); }
    return null;
  }
  /** Colores automáticos: se sacan de la portada una vez y se guardan con la playlist. */
  async function ensureAutoColors(p) {
    if (p.colors.mode !== 'auto' || p.colors.auto?.length) return;
    try {
      const b = await coverBlob(p);
      if (!b) return;
      p.colors.auto = await img.dominantColors(b);
      await savePlaylist(p);
      const hero = $(`.pl[data-pl="${CSS.escape(p.id)}"]`);
      if (hero) hero.style.cssText = themeStyle(p);
    } catch (e) { console.warn('Colores de la portada', e); }
  }
  function themeStyle(p) {
    const l = data.localOf(p.id);
    const list = p.colors.mode === 'manual' ? p.colors.manual : (l.cover && l.coverColors?.length ? l.coverColors : p.colors.auto);
    const pal = img.palette(list?.length ? list : null);
    if (!pal) return '';
    const [a, b, c2] = pal.list;
    return `--pl-1:${a};--pl-2:${b || a};--pl-3:${c2 || b || a};--pl-ink:${pal.ink};--pl-ink-soft:${pal.inkSoft};--pl-accent:${pal.accent}`;
  }

  // ================================================================ estado de la sincronización
  function syncChip() {
    const s = data.status(), u = account.user();
    let cls = 'ok', text = 'Guardado en tu cuenta', btn = '';
    if (!u) { cls = 'local'; text = account.available() ? 'Solo en este dispositivo · inicia sesión para sincronizar' : 'Solo en este dispositivo'; }
    else if (s.mode === 'missing') { cls = 'warn'; text = 'Sin sincronizar: falta preparar Supabase (ver Ajustes)'; }
    else if (s.mode === 'offline') { cls = 'warn'; text = s.pending ? 'Sin conexión: se guardará al volver' : 'Sin conexión'; }
    else if (s.error) { cls = 'bad'; text = s.error; btn = `<button class="chip" data-act="pl-retry">Reintentar</button>`; }
    else if (s.busy || s.uploading) { cls = 'busy'; text = s.uploading ? 'Subiendo fotos…' : 'Guardando…'; }
    else if (s.pending) { cls = 'busy'; text = 'Cambios pendientes de guardar'; }
    else if (s.mode === 'checking') { cls = 'busy'; text = 'Sincronizando…'; }
    return `<span class="sync-chip ${cls}" role="status" data-plsync>${icon(cls === 'ok' ? 'cloud' : cls === 'local' ? 'lock' : 'sync')}<span>${esc(text)}</span>${btn}</span>`;
  }
  on('plsync', () => { for (const el of $$('[data-plsync]')) el.outerHTML = syncChip(); });

  // ================================================================ imágenes (elegir, validar, subir o guardar en local)
  function pickFiles(multiple) {
    return new Promise(resolve => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple });
      input.onchange = () => resolve([...input.files]);
      input.addEventListener('cancel', () => resolve([]));
      input.click();
    });
  }
  /** Aviso para fotos de más de 16 MB. Devuelve 'local' | 'compress' | 'other' | 'cancel'. */
  function tooBigDialog(info) {
    return new Promise(resolve => {
      let choice = 'cancel';
      openSheet(`<div class="dlg big-photo"><h3>Esta fotografía supera los ${img.LIMIT_TEXT}</h3>
        <p><b>${esc(info.name)}</b> ocupa ${img.MB(info.size)}.</p>
        <p>Puedes utilizar esta fotografía localmente en este dispositivo, pero no se subirá a la nube ni estará disponible automáticamente en tus otros dispositivos.</p>
        <div class="choice-list">
          <button class="btn" data-c="local">${icon('lock')}<span><b>Usar localmente</b><small>Solo en este dispositivo, sin subirla</small></span></button>
          <button class="btn" data-c="compress">${icon('cloudUp')}<span><b>Reducirla y subirla</b><small>Se guarda una copia de 2560 px en JPEG (pierde algo de calidad)</small></span></button>
          <button class="btn" data-c="other">${icon('image')}<span><b>Elegir otra foto</b></span></button>
          <button class="btn ghost" data-c="cancel">Cancelar</button>
        </div></div>`,
      e => { const b = e.target.closest('[data-c]'); if (b) { choice = b.dataset.c; sheet.close(); } });
      sheet.addEventListener('close', () => resolve(choice), { once: true });
    });
  }
  /**
   * Prepara las imágenes elegidas: valida, avisa de las de más de 16 MB y crea los registros.
   * Devuelve [{rec, cloud}] donde rec es lo que se guarda en local y cloud indica si puede subirse.
   */
  async function prepareImages(files, role, pid) {
    const out = [];
    for (let i = 0; i < files.length; i++) {
      let file = files[i];
      const info = await img.inspect(file);
      if (!info.ok) { toast(`${info.name}: ${info.error}`, 7000); continue; }
      let blob = file, mime = info.mime, w = info.w, h = info.h, cloud = true;
      if (info.tooBig) {
        const choice = await tooBigDialog(info);
        if (choice === 'cancel') continue;
        if (choice === 'other') { const again = await pickFiles(false); if (again.length) files.splice(i + 1, 0, again[0]); continue; }
        if (choice === 'local') cloud = false;
        if (choice === 'compress') {
          const r = await img.compress(file).catch(() => null);
          if (!r || r.blob.size > IMAGE_MAX_BYTES) { toast('No se pudo reducir lo suficiente: elige «Usar localmente» u otra foto', 7000); continue; }
          ({ blob, w, h, mime } = r);
        }
      } else if (S.settings.plCompress && (Math.max(w, h) > 2560 || file.size > 3 * 1048576)) {
        const r = await img.compress(file).catch(() => null);   // compresión opcional (Ajustes de la playlist)
        if (r) ({ blob, w, h, mime } = r);
      }
      const thumb = (await img.thumbnail(blob).catch(() => null))?.blob || null;
      out.push({ rec: { id: img.newId(), pid, role, blob, thumb, size: blob.size, mime, w, h, caption: '', state: cloud ? 'pending' : 'local', at: Date.now() }, cloud });
    }
    return out;
  }
  /** Guarda en local y, si se puede, sube ya. Devuelve true si quedó en la nube. */
  async function storeImage(p, rec, cloud, label) {
    await img.saveLocal(rec);     // primero en el dispositivo: si la subida se corta, no se pierde
    const l = data.localOf(p.id);
    if (rec.role === 'cover') { if (l.cover) await img.dropLocal(l.cover); l.cover = rec.id; }
    else { l.photos.push(rec.id); l.order = data.orderPhotos(p).map(f => f.id); }
    await data.saveLocalState();
    if (!cloud) {
      if (!(await img.persistent())) toast('Foto guardada solo en este dispositivo. Este navegador podría borrarla si necesita espacio.', 8000);
      return false;
    }
    const s = data.status();
    if (!account.user() || s.mode !== 'ready') {
      toast(!account.user() ? 'La foto queda en este dispositivo: se subirá cuando inicies sesión' : s.mode === 'missing' ? 'La foto queda en este dispositivo: falta preparar Supabase para subirla' : 'Sin conexión: la foto se subirá cuando vuelva', 7000);
      return false;
    }
    const note = toast(`Subiendo ${label}…`, 0);
    try { await data.uploadNow(p.id, rec); note.done(`${label[0].toUpperCase() + label.slice(1)} guardada en tu cuenta`); return true; }
    catch (e) {
      note.done(e.network ? 'Se cortó la subida: la foto queda en este dispositivo y se subirá sola más tarde' : `No se pudo subir: ${e.message}. Queda en este dispositivo.`, 8000);
      return false;
    }
  }

  // ================================================================ lista de playlists
  function viewList() {
    if (data.reconcileFavs()) savePlaylist(byId(data.FAVS));
    const fp = byId(data.FAVS);
    const pls = livePlaylists().filter(p => !data.isFavs(p)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    show(`<div class="head"><h1>Playlists</h1><button class="btn primary" data-act="new-playlist">${icon('plus')}Nueva playlist</button></div>
      <p class="pl-list-sync">${syncChip()}</p>
      <div class="grid pl-grid">
        <a class="card pl-card" href="#/favoritos" style="${themeStyle(fp)}">${coverHTML(fp)}<span><b>${fp.emoji ? `${esc(fp.emoji)} ` : ''}${esc(fp.name)}</b><small>${plural(fp.trackIds.length, 'canción', 'canciones')} · tus «me gusta»</small></span></a>
        ${pls.map(p => `<a class="card pl-card" href="#/playlist/${enc(p.id)}" style="${themeStyle(p)}">${coverHTML(p)}
          <span><b>${p.emoji ? `${esc(p.emoji)} ` : ''}${esc(p.name)}</b><small>${plural(p.trackIds.length, 'canción', 'canciones')}${p.tags.length ? ` · ${esc(p.tags.slice(0, 2).join(' · '))}` : ''}</small></span></a>`).join('')}
      </div>
      ${pls.length ? '' : '<p class="muted" style="margin-top:18px">Crea una playlist o usa el menú ⋯ de cualquier canción para añadirla a una.</p>'}`);
    hydrate();
  }

  // ================================================================ canciones: orden, filtros y búsqueda
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const stat = (t, k) => S.stats[t.id]?.[k] || 0;
  const SORTS = {
    custom: ['Personalizado', null],
    title: ['Título', (a, b) => collator.compare(a.title, b.title)],
    artist: ['Artista', (a, b) => collator.compare(a.artist || '', b.artist || '') || collator.compare(a.title, b.title)],
    album: ['Álbum', (a, b) => collator.compare(a.album || '', b.album || '') || (a.trackNo || 0) - (b.trackNo || 0)],
    duration: ['Duración', (a, b) => (a.duration || 0) - (b.duration || 0)],
    recent: ['Añadidas recientemente', (a, b, p) => (p.added[b.id] || 0) - (p.added[a.id] || 0)],
    oldest: ['Añadidas hace más tiempo', (a, b, p) => (p.added[a.id] || 0) - (p.added[b.id] || 0)],
    plays: ['Más reproducidas', (a, b) => stat(b, 'plays') - stat(a, 'plays')],
    last: ['Última reproducción', (a, b) => stat(b, 'last') - stat(a, 'last')],
  };
  const DUR = { short: ['Menos de 3 min', t => (t.duration || 0) < 180], mid: ['De 3 a 5 min', t => t.duration >= 180 && t.duration <= 300], long: ['Más de 5 min', t => t.duration > 300] };
  const WEEK = 7 * 86400000;
  /** Canciones visibles según búsqueda, filtros y orden. Nunca toca el orden guardado. */
  function visible(p, v) {
    const f = v.f, q = fold(v.q.trim());
    let list = tracksOf(p).filter(t =>
      (!q || [t.title, t.artist, t.album, ...(t.genres || []), ...(t.moods || []), p.notes[t.id]?.text].some(x => fold(x).includes(q))) &&
      (!f.artists?.length || artistsOf(t).some(a => f.artists.includes(a))) &&
      (!f.albums?.length || f.albums.includes(t.album || '')) &&
      (!f.dur || DUR[f.dur][1](t)) &&
      (!f.moods?.length || (t.moods || []).some(m => f.moods.includes(m))) &&
      (!f.fav || isFav(t.id)) &&
      (!f.recent || Date.now() - stat(t, 'last') < WEEK) &&
      (!f.never || !stat(t, 'plays')));
    const cmp = SORTS[v.sort]?.[1];
    if (cmp) list = list.slice().sort((a, b) => cmp(a, b, p));
    return list;
  }
  const activeFilters = v => Object.entries(v.f).filter(([, x]) => (Array.isArray(x) ? x.length : x)).length;
  const isCustom = v => v.sort === 'custom' && !activeFilters(v) && !v.q.trim();

  // ================================================================ vista de una playlist
  function viewPlaylist(id) {
    if (id === data.FAVS && data.reconcileFavs()) savePlaylist(byId(data.FAVS));
    const p = byId(id);
    if (!p) return show(empty('list', 'Playlist no encontrada', 'Puede que se haya eliminado.'));
    const v = viewOf(p), tracks = tracksOf(p), s = p.settings;
    const missing = p.trackIds.length - tracks.length;
    const blocks = s.modules.filter(([m, on]) => on && data.BLOCKS.includes(m)).map(([m]) => m);
    if (!blocks.includes('songs')) blocks.push('songs');   // la lista de canciones siempre está
    const html = { photos: photosBlock, featured: featuredBlock, songs: songsBlock, stats: statsBlock, discover: discoverBlock, notes: notesBlock };
    show(`<article class="pl density-${s.density} hdr-${s.header}" data-pl="${esc(p.id)}" style="${themeStyle(p)}">
      ${hero(p, tracks, missing)}
      ${blocks.map(b => html[b](p, v, tracks)).join('')}
    </article>`);
    hydrate();
    if (blocks.includes('stats')) fillStats(p);
    ensureAutoColors(p);
  }

  function hero(p, tracks, missing) {
    const on = id => data.moduleOn(p, id);
    const amb = ambientPlan(p);
    return `<header class="pl-hero">
      ${on('cover') ? `<button class="pl-hero-cover" data-act="pl-edit" data-tab="look" aria-label="Cambiar la portada">${coverHTML(p, '', true)}</button>` : ''}
      <div class="pl-info">
        <div class="kind">${data.isFavs(p) ? 'Tus «me gusta»' : 'Playlist'} ${syncChip()}</div>
        <h1>${p.emoji ? `<span class="emoji">${esc(p.emoji)}</span> ` : ''}${esc(p.name)}</h1>
        ${on('description') && p.quote ? `<blockquote class="pl-quote">${esc(p.quote)}</blockquote>` : ''}
        ${on('description') && p.description ? `<p class="pl-desc">${esc(p.description)}</p>` : ''}
        ${on('tags') && (p.tags.length || p.mood) ? `<div class="pl-tags">${p.mood ? `<span class="tag mood">${icon('spark')}${esc(p.mood)}</span>` : ''}${p.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
        <p class="pl-meta">${plural(tracks.length, 'canción', 'canciones')} · ${totalTime(tracks)}${missing ? ` · ${plural(missing, 'no está', 'no están')} en este dispositivo` : ''}<br>
          Creada el ${date(p.createdAt)} · modificada el ${date(p.updatedAt)}</p>
        <div class="actions">
          ${tracks.length ? `<button class="btn primary" data-act="pl-play" data-pid="${esc(p.id)}">${icon('play')}Reproducir</button>
            <button class="btn" data-act="pl-shuffle" data-pid="${esc(p.id)}">${icon('shuffle')}Aleatorio</button>
            <button class="btn" data-act="pl-surprise" data-pid="${esc(p.id)}" title="Aleatorio evitando lo que has escuchado hace poco">${icon('dice')}Sorpresa</button>
            <button class="btn" data-act="pl-ambient" data-pid="${esc(p.id)}" ${amb.ok ? '' : `aria-disabled="true" title="${esc(amb.why)}"`}>${icon('wave')}Ambiente</button>` : ''}
          <button class="btn" data-act="pl-edit" data-pid="${esc(p.id)}">${icon('edit')}Editar</button>
          <button class="icon-btn" data-act="pl-more" data-pid="${esc(p.id)}" aria-label="Más opciones">${icon('more')}</button>
        </div>
      </div>
    </header>`;
  }

  // ---------------------------------------------------------------- carrusel
  function photosBlock(p) {
    if (!p.showPhotos) return '';
    const all = data.orderPhotos(p);
    if (!all.length) return '';
    return `<section class="pl-block pl-photos" aria-label="Fotos">
      <div class="block-head"><h2>Fotos</h2><span class="muted">${all.length} / ${MAX_PHOTOS}</span>
        <span class="grow"></span><button class="icon-btn" data-act="pl-car" data-d="-1" aria-label="Fotos anteriores">${icon('chevL')}</button><button class="icon-btn" data-act="pl-car" data-d="1" aria-label="Fotos siguientes">${icon('chevR')}</button></div>
      <div class="carousel" tabindex="0" aria-label="Carrusel de fotos: usa las flechas para moverte">
        ${all.map((f, i) => `<button class="ph" data-act="pl-photo" data-pid="${esc(p.id)}" data-i="${i}" data-photo="${esc(f.id)}" aria-label="Ver la foto ${i + 1}${f.caption ? `: ${esc(f.caption)}` : ''}">
          <img alt="" loading="lazy">${f.local ? '<span class="only-local">Solo en este dispositivo</span>' : ''}${(f.caption || '') ? `<span class="cap">${esc(f.caption)}</span>` : ''}</button>`).join('')}
      </div></section>`;
  }

  // ---------------------------------------------------------------- destacadas
  function featuredBlock(p) {
    const list = p.featured.map(id => S.tracks.get(id)).filter(Boolean);
    if (!list.length) return '';
    return `<section class="pl-block pl-featured"><div class="block-head"><h2>${icon('star')}Destacadas</h2></div>
      <div class="feat-row">${list.map((t, i) => `<div class="feat" style="--i:${i}">
        ${c.cover(t)}<span class="row-text"><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></span>
        <button class="icon-btn" data-act="pl-play-one" data-pid="${esc(p.id)}" data-tid="${esc(t.id)}" aria-label="Reproducir ${esc(t.title)}">${icon('play')}</button></div>`).join('')}</div></section>`;
  }

  // ---------------------------------------------------------------- canciones
  function songsBlock(p, v) {
    const list = visible(p, v), nf = activeFilters(v), custom = isCustom(v);
    const chapters = data.moduleOn(p, 'chapters') && p.sections.length && custom;
    const o = { playlist: p.id, notes: p.notes, featured: p.featured, reorder: v.reorder && custom, playAll: list };
    let body;
    if (!p.trackIds.length) body = data.isFavs(p) ? empty('heart', 'Todavía no hay favoritas', 'Pulsa el corazón en cualquier canción para guardarla aquí.')
      : empty('list', 'Playlist vacía', 'Añade canciones desde el menú ⋯ de cualquier canción, o mira «Descubre más».');
    else if (!tracksOf(p).length) body = empty('cloud', 'Las canciones no están en este dispositivo', `${plural(p.trackIds.length, 'canción', 'canciones')} de esta playlist no están en tu biblioteca de este dispositivo. Conecta tu nube en Ajustes o importa la música, y aparecerán aquí.`);
    else if (!list.length) body = empty('search', 'Sin resultados', 'Ninguna canción coincide con la búsqueda o los filtros.', '<button class="btn" data-act="pl-clear-view">Quitar filtros</button>');
    else if (chapters) {
      const groups = [...p.sections.map(sc => ({ sc, list: list.filter(t => p.trackSection[t.id] === sc.id) })), { sc: null, list: list.filter(t => !p.trackSection[t.id]) }];
      body = groups.filter(g => g.sc || g.list.length).map(({ sc, list: gl }) => `<div class="chapter ${sc?.collapsed ? 'collapsed' : ''}" data-chapter="${esc(sc?.id || '')}">
        <div class="chap-head" data-drop-chapter="${esc(sc?.id || '')}">
          <button class="chap-toggle" data-act="pl-chapter-toggle" data-pid="${esc(p.id)}" data-sid="${esc(sc?.id || '')}" aria-expanded="${!sc?.collapsed}">${icon('chevD')}
            <span><b>${esc(sc ? sc.name || 'Capítulo' : 'Sin capítulo')}</b><small>${plural(gl.length, 'canción', 'canciones')} · ${totalTime(gl)}</small></span></button>
          ${gl.length ? `<button class="icon-btn" data-act="pl-play-chapter" data-pid="${esc(p.id)}" data-sid="${esc(sc?.id || '')}" aria-label="Reproducir el capítulo">${icon('play')}</button>` : ''}
        </div>
        ${sc?.description ? `<p class="chap-desc">${esc(sc.description)}</p>` : ''}
        <div class="chap-body"><div>${gl.length ? rows(gl, o) : '<p class="muted chap-empty">Sin canciones. Usa «Mover a capítulo…» en el menú ⋯ de una canción.</p>'}</div></div>
      </div>`).join('');
    } else body = rows(list, o);
    const chips = [];
    for (const a of v.f.artists || []) chips.push([a, 'artists', a]);
    for (const a of v.f.albums || []) chips.push([a || 'Sin álbum', 'albums', a]);
    for (const m of v.f.moods || []) chips.push([m, 'moods', m]);
    if (v.f.dur) chips.push([DUR[v.f.dur][0], 'dur']);
    if (v.f.fav) chips.push(['Favoritas', 'fav']);
    if (v.f.recent) chips.push(['Escuchadas esta semana', 'recent']);
    if (v.f.never) chips.push(['Nunca reproducidas', 'never']);
    return `<section class="pl-block pl-songs">
      <div class="pl-tools">
        <label class="field">${icon('search')}<input type="search" data-plq="${esc(p.id)}" value="${esc(v.q)}" placeholder="Buscar en esta playlist" autocomplete="off"></label>
        <label class="field sort">${icon('list')}<select data-plsort="${esc(p.id)}" aria-label="Ordenar">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}" ${v.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <button class="btn ${nf ? 'on' : ''}" data-act="pl-filters" data-pid="${esc(p.id)}">${icon('filter')}Filtros${nf ? ` <span class="count">${nf}</span>` : ''}</button>
        ${custom && p.trackIds.length > 1 ? `<button class="btn ${v.reorder ? 'on' : ''}" data-act="pl-reorder" data-pid="${esc(p.id)}" aria-pressed="${v.reorder}">${icon('grip')}${v.reorder ? 'Listo' : 'Reordenar'}</button>` : ''}
        ${!custom ? `<button class="btn ghost" data-act="pl-clear-view" data-pid="${esc(p.id)}">Volver a mi orden</button>` : ''}
      </div>
      ${chips.length ? `<div class="chips pl-fchips">${chips.map(([l, k, x]) => `<button class="chip on" data-act="pl-unfilter" data-pid="${esc(p.id)}" data-k="${k}" data-v="${esc(x ?? '')}">${esc(l)} ✕</button>`).join('')}</div>` : ''}
      ${v.reorder && custom ? `<p class="muted reorder-hint">Arrastra ${icon('grip')} para cambiar el orden${chapters ? ' (también entre capítulos)' : ''}. Con el teclado: flechas arriba y abajo.</p>` : ''}
      ${data.isFavs(p) && custom && p.trackIds.length ? `<p class="muted reorder-hint">${p.settings.favOrder === 'manual' ? `Orden manual: las nuevas favoritas entran arriba. <button class="chip" data-act="pl-fav-date" data-pid="${esc(p.id)}">Ordenar por fecha</button>` : 'De la más reciente a la más antigua. Usa «Reordenar» para ponerlas a tu gusto.'}</p>` : ''}
      ${!custom && p.trackIds.length ? `<p class="muted reorder-hint">Vista ${v.sort !== 'custom' ? `ordenada por ${SORTS[v.sort][0].toLowerCase()}` : 'filtrada'}: tu orden personalizado se conserva.</p>` : ''}
      <div class="pl-list" data-pid="${esc(p.id)}">${body}</div>
    </section>`;
  }

  // ---------------------------------------------------------------- estadísticas
  function statsBlock(p, v, tracks) {
    const artists = new Set(tracks.flatMap(t => artistsOf(t))), albums = new Set(tracks.map(t => t.album).filter(Boolean));
    const tile = (val, label) => `<div class="stat"><b title="${esc(String(val))}">${esc(String(val))}</b><small>${label}</small></div>`;
    return `<section class="pl-block pl-stats ${p.settings.stats}"><div class="block-head"><h2>${icon('chart')}Estadísticas</h2></div>
      <div class="stat-row tiles">${tile(num(tracks.length), 'canciones')}${tile(totalTime(tracks), 'de duración')}${tile(num(artists.size), 'artistas')}${tile(num(albums.size), 'álbumes')}${tile(date(p.createdAt), 'creada')}${tile(date(p.updatedAt), 'última modificación')}</div>
      <div data-plstats="${esc(p.id)}"><p class="muted">Cargando escuchas…</p></div></section>`;
  }
  /** Gráfico circular (anillo) para el reparto entre artistas, con los valores escritos al lado. */
  function donut(items) {
    const total = items.reduce((n, x) => n + x[1], 0) || 1, R = 15.9155;   // circunferencia 100
    let acc = 0;
    const segs = items.map(([, n], i) => {
      const len = (n / total) * 100, s = `<circle r="${R}" cx="21" cy="21" fill="none" stroke-width="7" stroke="var(--chart)" stroke-opacity="${1 - i * 0.16}" stroke-dasharray="${Math.max(0, len - 0.6)} ${100 - Math.max(0, len - 0.6)}" stroke-dashoffset="${25 - acc}"/>`;
      acc += len; return s;
    }).join('');
    return `<div class="donut"><svg viewBox="0 0 42 42" role="img" aria-label="Reparto de escuchas por artista">${segs}</svg>
      <ol>${items.map(([a, n], i) => `<li><i style="opacity:${1 - i * 0.16}"></i><span>${esc(a)}</span><b>${Math.round((n / total) * 100)} %</b></li>`).join('')}</ol></div>`;
  }
  async function fillStats(p) {
    const box = $(`[data-plstats="${CSS.escape(p.id)}"]`);
    if (!box) return;
    const rowsData = await data.playRows(p.id);
    if (!box.isConnected) return;
    const total = rowsData.reduce((n, r) => n + r.plays, 0);
    if (!total) { box.innerHTML = '<p class="muted">Aún no hay escuchas registradas desde esta playlist. Se cuentan las canciones que suenan al reproducirla (más de 30 segundos o la mitad).</p>'; return; }
    const secs = rowsData.reduce((n, r) => n + r.seconds, 0);
    const byTrack = new Map(), byArtist = new Map(), byDay = new Map();
    for (const r of rowsData) {
      byTrack.set(r.track_id, (byTrack.get(r.track_id) || 0) + r.plays);
      byDay.set(r.day, (byDay.get(r.day) || 0) + r.plays);
      const t = S.tracks.get(r.track_id);
      for (const a of t ? artistsOf(t) : ['(no está en este dispositivo)']) byArtist.set(a, (byArtist.get(a) || 0) + r.plays);
    }
    const topTrack = [...byTrack].sort((a, b) => b[1] - a[1])[0], topArtist = [...byArtist].sort((a, b) => b[1] - a[1])[0];
    const tt = S.tracks.get(topTrack[0]);
    const days = [...Array(30)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 29 + i); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return { d, n: byDay.get(k) || 0 }; });
    const fmtD = d => d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
    const artistsTop = [...byArtist].sort((a, b) => b[1] - a[1]);
    const pie = artistsTop.slice(0, 5);
    if (artistsTop.length > 5) pie.push(['Otros', artistsTop.slice(5).reduce((n, x) => n + x[1], 0)]);
    const least = tracksOf(p).map(t => [t, byTrack.get(t.id) || 0]).sort((a, b) => a[1] - b[1]).slice(0, 5);
    const tile = (val, label) => `<div class="stat"><b title="${esc(String(val))}">${esc(String(val))}</b><small>${label}</small></div>`;
    const detailed = p.settings.stats !== 'compact';
    box.innerHTML = `<div class="stat-row tiles">${tile(num(total), 'reproducciones')}${tile(`${(secs / 3600).toLocaleString('es', { maximumFractionDigits: 1 })} h`, 'escuchadas')}${tile(topArtist[0], 'artista más escuchado')}${tile(tt?.title || '—', 'canción más reproducida')}</div>
      ${detailed ? `<div class="two-panels">
        <div class="panel"><h3>Últimos 30 días</h3>${c.columns(days.map(x => ({ label: fmtD(x.d), value: x.n, tip: `${fmtD(x.d)} · ${plural(x.n, 'escucha', 'escuchas')}` })), { unit: 'escuchas', ticks: [fmtD(days[0].d), fmtD(days[15].d), 'hoy'], caption: 'Escuchas de esta playlist cada día' })}</div>
        <div class="panel"><h3>Reparto por artista</h3>${donut(pie)}</div>
      </div>
      <div class="panel"><h3>Las que menos suenan</h3>${c.bars(least.map(([t, n]) => [t.title, n, t.artist]), '')}</div>` : ''}`;
  }

  // ---------------------------------------------------------------- Descubre más
  /** Canciones de tu biblioteca que encajan con la playlist (sin servicios externos). */
  function recommend(p, mode) {
    const inPl = new Set(p.trackIds), base = tracksOf(p);
    if (!base.length) return { list: [], why: 'Añade algunas canciones y aquí aparecerán otras parecidas de tu biblioteca.' };
    const count = (f) => { const m = new Map(); for (const t of base) for (const x of f(t)) m.set(x, (m.get(x) || 0) + 1); return m; };
    const A = count(t => artistsOf(t)), AL = count(t => (t.album ? [t.album] : [])), G = count(t => (t.genres || []).map(x => x.toLowerCase())), M = count(t => t.moods || []);
    const trans = new Map();
    for (const t of base) for (const [b, n] of Object.entries(S.trans[t.id] || {})) trans.set(b, (trans.get(b) || 0) + n);
    const n = base.length, surprise = mode === 'surprise';
    const scored = [];
    for (const t of S.tracks.values()) {
      if (inPl.has(t.id) || !playable(t)) continue;
      const art = Math.max(0, ...artistsOf(t).map(a => (A.get(a) || 0) / n));
      const alb = t.album ? (AL.get(t.album) || 0) / n : 0;
      const gen = (t.genres || []).reduce((s, g) => s + (G.get(g.toLowerCase()) || 0) / n, 0);
      const mood = (t.moods || []).reduce((s, m) => s + (M.get(m) || 0) / n, 0);
      const tr = Math.min(1, (trans.get(t.id) || 0) / 3);
      const signal = art + alb + gen + mood + tr;
      if (signal <= 0) continue;   // sin ninguna relación real con la playlist: no se recomienda
      const score = surprise
        ? 0.6 * art + 2 * gen + 1.6 * mood + 1.5 * tr + (isFav(t.id) ? 0.3 : 0) + Math.random() * 0.9 - (art > 0.3 ? 0.8 : 0)
        : 3 * art + 1.5 * alb + 2 * gen + 1.5 * mood + 2 * tr + (isFav(t.id) ? 0.5 : 0) + Math.random() * 0.15;
      scored.push([t, score]);
    }
    if (!scored.length) return { list: [], why: 'No hay en tu biblioteca canciones relacionadas (mismos artistas, géneros o ambiente). Añade más música o etiqueta las canciones.' };
    return { list: scored.sort((a, b) => b[1] - a[1]).map(x => x[0]) };
  }
  function discoverBlock(p, v) {
    const { list, why } = recommend(p, v.discover);
    const page = list.length ? list.slice((v.page * 6) % list.length, (v.page * 6) % list.length + 6) : [];
    return `<section class="pl-block pl-discover"><div class="block-head"><h2>${icon('compass')}Descubre más</h2><span class="grow"></span>
        <div class="seg" role="group" aria-label="Tipo de recomendaciones"><button class="chip ${v.discover === 'similar' ? 'on' : ''}" data-act="pl-disc-mode" data-pid="${esc(p.id)}" data-m="similar">Más parecido</button><button class="chip ${v.discover === 'surprise' ? 'on' : ''}" data-act="pl-disc-mode" data-pid="${esc(p.id)}" data-m="surprise">Sorpréndeme</button></div>
        ${list.length > 6 ? `<button class="icon-btn" data-act="pl-disc-more" data-pid="${esc(p.id)}" aria-label="Otras recomendaciones">${icon('sync')}</button>` : ''}</div>
      ${page.length ? `<div class="disc-grid">${page.map(t => `<div class="disc">${c.cover(t)}<span class="row-text"><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></span>
          <button class="icon-btn" data-act="pl-disc-play" data-tid="${esc(t.id)}" aria-label="Escuchar ${esc(t.title)}">${icon('play')}</button>
          <button class="icon-btn" data-act="pl-disc-add" data-pid="${esc(p.id)}" data-tid="${esc(t.id)}" aria-label="Añadir ${esc(t.title)} a la playlist">${icon('plus')}</button></div>`).join('')}</div>`
        : `<p class="muted">${esc(why)}</p>`}</section>`;
  }

  // ---------------------------------------------------------------- notas
  function notesBlock(p) {
    const list = Object.entries(p.notes).filter(([id, n]) => n?.text && p.trackIds.includes(id)).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    if (!list.length) return '';
    return `<section class="pl-block pl-notes"><div class="block-head"><h2>${icon('note')}Notas</h2></div>
      <ul class="notes">${list.map(([id, n]) => { const t = S.tracks.get(id); return `<li><button class="note-card" data-act="pl-note" data-pid="${esc(p.id)}" data-tid="${esc(id)}">
        <b>${esc(t?.title || 'Canción que no está en este dispositivo')}</b><small>${esc(t?.artist || '')}</small><p>${esc(n.text)}</p></button></li>`; }).join('')}</ul></section>`;
  }
  /** Diálogo para escribir, cambiar o borrar la nota de una canción. */
  function editNote(p, tid) {
    const t = S.tracks.get(tid), cur = p.notes[tid]?.text || '';
    openSheet(`<form class="dlg" method="dialog"><h3>Nota sobre «${esc(t?.title || 'la canción')}»</h3>
      <p>Es privada: solo la ves tú, en esta playlist.</p>
      <label class="field area"><textarea name="v" rows="5" maxlength="2000" placeholder="Esta canción me recuerda a…">${esc(cur)}</textarea></label>
      <div class="actions">${cur ? '<button type="button" class="btn ghost danger" data-del>Borrar nota</button>' : ''}<span class="grow"></span><button type="button" class="btn ghost" data-x>Cancelar</button><button class="btn primary">Guardar</button></div></form>`,
    async e => {
      if (e.target.closest('[data-x]')) return sheet.close();
      if (e.target.closest('[data-del]')) { delete p.notes[tid]; sheet.close(); await savePlaylist(p); toast('Nota borrada'); refresh(); }
    });
    const form = $('form', sheet);
    form.onsubmit = async () => {
      const v = form.v.value.trim();
      if (v) p.notes[tid] = { text: v, at: Date.now() }; else delete p.notes[tid];
      await savePlaylist(p); toast(v ? 'Nota guardada' : 'Nota borrada'); refresh();
    };
    setTimeout(() => form.v.focus(), 60);
  }

  // ================================================================ modos de reproducción
  const ctxOf = p => ({ playlist: p.id });
  function playOrder(p) { return tracksOf(p).filter(playable); }
  /** Sorpresa: aleatorio, dejando para el final lo que has escuchado hace poco. */
  function surpriseOrder(p) {
    const hours = p.settings.surpriseHours || 24, now = Date.now();
    return playOrder(p).map(t => { const ago = (now - stat(t, 'last')) / 3600000; return [t, Math.random() + (stat(t, 'last') && ago < hours ? 2 + (1 - ago / hours) : 0)]; })
      .sort((a, b) => a[1] - b[1]).map(x => x[0]);
  }
  // Ambiente: inicio tranquilo → más energía → momento intenso → final relajado, según «lo que transmite».
  const CALM = ['relajada', 'íntima', 'soñadora', 'melancólica', 'nostálgica', 'triste', 'romántica'];
  const LIFT = ['alegre', 'bailable', 'festiva', 'motivadora'];
  const PEAK = ['enérgica', 'épica', 'agresiva', 'oscura'];
  function ambientPlan(p) {
    const list = playOrder(p), tagged = list.filter(t => t.moods?.length);
    if (list.length < 6) return { ok: false, why: 'El modo ambiente necesita al menos 6 canciones' };
    if (tagged.length < Math.max(6, list.length * 0.6)) return { ok: false, why: `Solo ${tagged.length} de ${list.length} canciones tienen «lo que transmite». Etiquétalas (modo desarrollador o IA) para usar el modo ambiente.` };
    const score = t => { const m = t.moods; return PEAK.filter(x => m.includes(x)).length * 2 + LIFT.filter(x => m.includes(x)).length - CALM.filter(x => m.includes(x)).length * 1.5; };
    const sorted = tagged.map(t => [t, score(t) + Math.random() * 0.3]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    const calm = sorted.slice(0, Math.ceil(sorted.length * 0.35)), rest = sorted.slice(calm.length);
    const lift = rest.slice(0, Math.ceil(rest.length / 2)), peak = rest.slice(lift.length);
    const half = Math.ceil(calm.length / 2);
    return { ok: true, list: [...calm.slice(0, half), ...lift, ...peak, ...calm.slice(half).reverse()] };
  }

  // ================================================================ visor de fotos
  let viewer = null;
  function openViewer(p, start) {
    const all = data.orderPhotos(p);
    if (!all.length) return;
    let i = start;
    viewer?.remove();
    viewer = document.createElement('dialog');
    viewer.className = 'ph-viewer';
    viewer.setAttribute('aria-label', 'Fotos de la playlist');
    document.body.append(viewer);
    const paint = async () => {
      const f = all[i];
      viewer.innerHTML = `<figure><img alt="${esc(f.caption || '')}"><figcaption>${f.caption ? esc(f.caption) : ''}<small>${i + 1} / ${all.length}${f.local ? ' · Solo en este dispositivo' : ''}</small></figcaption></figure>
        <button class="icon-btn v-close" data-v="x" aria-label="Cerrar">${icon('x')}</button>
        ${all.length > 1 ? `<button class="icon-btn v-prev" data-v="-1" aria-label="Anterior">${icon('chevL')}</button><button class="icon-btn v-next" data-v="1" aria-label="Siguiente">${icon('chevR')}</button>` : ''}`;
      const url = f.local ? await img.localUrl(f.id) : await img.cloudUrl(f.path);
      const im = $('img', viewer);
      if (url && im) { im.src = url; }
    };
    const go = d => { i = (i + d + all.length) % all.length; paint(); };
    viewer.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) b.dataset.v === 'x' ? viewer.close() : go(+b.dataset.v); else if (e.target === viewer) viewer.close(); });
    viewer.addEventListener('keydown', e => { if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); });
    let sx = null;
    viewer.addEventListener('pointerdown', e => { sx = e.clientX; });
    viewer.addEventListener('pointerup', e => { if (sx !== null && Math.abs(e.clientX - sx) > 50) go(e.clientX < sx ? 1 : -1); sx = null; });
    viewer.addEventListener('close', () => { viewer.remove(); viewer = null; });
    paint();
    viewer.showModal();
  }

  // ================================================================ editor
  const TABS = [['info', 'Información'], ['look', 'Apariencia'], ['photos', 'Fotos'], ['org', 'Organización'], ['mods', 'Personalización'], ['adv', 'Avanzado']];
  let ed = null;   // {p, tab, draft}
  function openEditor(p, tab = 'info') {
    ed = { p, tab, draft: { name: p.name, emoji: p.emoji, description: p.description, quote: p.quote, tags: [...p.tags], mood: p.mood } };
    openSheet(`<div class="pl-editor" style="${themeStyle(p)}"><div class="ed-top"><h3>Editar playlist</h3><button class="icon-btn" data-ed="close" aria-label="Cerrar">${icon('x')}</button></div>
      <nav class="ed-tabs" role="tablist">${TABS.map(([id, l]) => `<button role="tab" data-ed-tab="${id}" aria-selected="${id === tab}">${l}</button>`).join('')}</nav>
      <div class="ed-body" role="tabpanel"></div></div>`, onEditorClick);
    sheet.classList.add('wide');
    sheet.addEventListener('close', () => { sheet.classList.remove('wide'); ed = null; refresh(); }, { once: true });
    paintTab();
  }
  const sw = (on, attr, label, sub = '') => `<label class="switch"><input type="checkbox" ${attr} ${on ? 'checked' : ''}><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span></label>`;
  async function paintTab() {
    if (!ed) return;
    const { p, tab, draft: d } = ed, body = $('.ed-body', sheet);
    $$('[data-ed-tab]', sheet).forEach(b => b.setAttribute('aria-selected', b.dataset.edTab === tab));
    const pid = esc(p.id);
    if (tab === 'info') {
      body.innerHTML = `<form class="stack" data-ed-form="info">
        <div class="two"><label class="lbl">Emoji<span class="field"><input name="emoji" value="${esc(d.emoji)}" maxlength="8" placeholder="🌙" autocomplete="off"></span></label>
          <label class="lbl">Título<span class="field"><input name="name" value="${esc(d.name)}" maxlength="200" required autocomplete="off"></span></label></div>
        <label class="lbl">Descripción <small>opcional</small><span class="field area"><textarea name="description" rows="3" maxlength="4000">${esc(d.description)}</textarea></span></label>
        <label class="lbl">Frase destacada <small>opcional</small><span class="field"><input name="quote" value="${esc(d.quote)}" maxlength="500" placeholder="Para las noches en que no puedo dormir" autocomplete="off"></span></label>
        <div class="lbl">Etiquetas<div class="chips ed-tags">${d.tags.map(t => `<button type="button" class="chip on" data-tag-del="${esc(t)}">#${esc(t)} ✕</button>`).join('')}</div>
          <span class="field"><input name="tag" list="pl-tag-list" placeholder="Añade una etiqueta y pulsa Intro" maxlength="40" autocomplete="off"><button type="button" class="chip" data-tag-add>Añadir</button></span>
          <datalist id="pl-tag-list">${TAG_SUGGESTIONS.map(t => `<option value="${t}">`).join('')}</datalist>
          <div class="chips sugg">${TAG_SUGGESTIONS.filter(t => !d.tags.includes(t)).map(t => `<button type="button" class="chip" data-tag-sugg="${t}">${t}</button>`).join('')}</div></div>
        <label class="lbl">Estado de ánimo<span class="field"><select name="mood"><option value="">Ninguno</option>${MOODS.map(m => `<option ${d.mood === m ? 'selected' : ''}>${m}</option>`).join('')}</select></span></label>
        <p class="muted">Creada el ${date(p.createdAt)} · modificada el ${date(p.updatedAt)}</p>
        <div class="actions"><button class="btn primary">Guardar cambios</button></div></form>`;
    } else if (tab === 'look') {
      const l = data.localOf(p.id), hasImg = l.cover || p.cover.kind === 'image';
      const cm = p.colors.mode, man = p.colors.manual?.length ? p.colors.manual : (p.colors.auto?.length ? p.colors.auto : ['#6d4fc2', '#e06d3f']);
      body.innerHTML = `<div class="ed-look">
        <div class="ed-cover">${coverHTML(p, '', true)}</div>
        <div class="stack">
          <div class="actions wrap">
            <button class="btn primary" data-ed="cover-upload">${icon('image')}${hasImg ? 'Cambiar la foto' : 'Subir una foto'}</button>
            ${hasImg ? `<button class="btn" data-ed="cover-crop">${icon('edit')}Recortar y encuadrar</button>` : ''}
            <button class="btn ${p.cover.kind === 'collage' && !l.cover ? 'on' : ''}" data-ed="cover-collage">Collage de carátulas</button>
            <button class="btn ${p.cover.kind === 'auto' && !l.cover ? 'on' : ''}" data-ed="cover-default">Portada predeterminada</button>
            ${hasImg ? `<button class="btn ghost danger" data-ed="cover-remove">Quitar la foto</button>` : ''}
          </div>
          <small class="muted">Fotos de hasta ${img.LIMIT_TEXT} (JPEG, PNG, WebP, GIF o AVIF) se guardan en tu cuenta. Las más grandes pueden usarse solo en este dispositivo.</small>
        </div></div>
        <h4>Colores</h4>
        <div class="seg" role="radiogroup"><button class="chip ${cm === 'auto' ? 'on' : ''}" data-ed="colors-auto" role="radio" aria-checked="${cm === 'auto'}">Automáticos (de la portada)</button><button class="chip ${cm === 'manual' ? 'on' : ''}" data-ed="colors-manual" role="radio" aria-checked="${cm === 'manual'}">Elegidos a mano</button></div>
        ${cm === 'manual' ? `<form class="color-row" data-ed-form="colors">${[0, 1, 2].map(i => `<label class="color"><input type="color" name="c${i}" value="${esc(man[i] || man[man.length - 1])}" ${i === 2 && man.length < 3 ? 'data-off' : ''}><span>Color ${i + 1}${i === 2 ? ' (opcional)' : ''}</span></label>`).join('')}
          <label class="switch mini"><input type="checkbox" name="use3" ${man.length > 2 ? 'checked' : ''}><span>Usar tres colores</span></label><button class="btn">Aplicar</button></form>` : `<button class="btn ghost" data-ed="colors-recalc">${icon('sync')}Volver a sacar los colores de la portada</button>`}
        <div class="pl-preview pl" style="${themeStyle(p)}"><b>${esc(p.emoji)} ${esc(p.name)}</b><span>Así se verá la cabecera · el texto siempre con contraste suficiente</span><span class="btn primary" aria-hidden="true">${icon('play')}Reproducir</span></div>
        <h4>Cabecera</h4>
        <div class="seg">${[['gradient', 'Degradado'], ['big', 'Portada grande'], ['minimal', 'Sencilla']].map(([k, l]) => `<button class="chip ${p.settings.header === k ? 'on' : ''}" data-ed="header" data-v="${k}">${l}</button>`).join('')}</div>`;
      hydrate(body);
    } else if (tab === 'photos') {
      const all = data.orderPhotos(p);
      body.innerHTML = `${sw(p.showPhotos, 'data-ed-sw="showPhotos"', 'Mostrar el carrusel', 'Si lo ocultas, las fotos se conservan y no ocupa espacio en la playlist.')}
        <div class="block-head"><h4>Fotos</h4><span class="muted">${all.length} / ${MAX_PHOTOS}</span><span class="grow"></span>
          <button class="btn primary" data-ed="photos-add" ${all.length >= MAX_PHOTOS ? 'disabled' : ''}>${icon('plus')}Añadir fotos</button></div>
        <p class="muted space" data-space>${spaceText(p)}</p>
        ${all.length ? `<ol class="ed-photos" data-sortable="photos">${all.map((f, i) => {
          const rec = f.local ? 'local' : 'nube';
          return `<li data-id="${esc(f.id)}"><button class="icon-btn drag" data-drag-item aria-label="Arrastrar para reordenar">${icon('grip')}</button>
            <span class="ph sm" data-photo="${esc(f.id)}" data-pid="${pid}"><img alt=""></span>
            <span class="ph-meta"><span class="badge-${rec}" data-badge="${esc(f.id)}">${f.local ? 'Solo en este dispositivo' : 'Guardada en tu cuenta'}</span>
              <input data-caption="${esc(f.id)}" value="${esc(f.caption || '')}" placeholder="Descripción (opcional)" maxlength="500" aria-label="Descripción de la foto ${i + 1}"></span>
            <span class="ph-ops"><button class="icon-btn" data-ed="photo-up" data-id="${esc(f.id)}" aria-label="Subir" ${i ? '' : 'disabled'}>${icon('up')}</button>
              <button class="icon-btn" data-ed="photo-del" data-id="${esc(f.id)}" aria-label="Eliminar la foto">${icon('trash')}</button></span></li>`;
        }).join('')}</ol>` : '<p class="muted">Aún no hay fotos. Añade hasta 15: recuerdos, lugares, gente… Aparecen en un carrusel en la playlist.</p>'}
        ${S.settings.plCompress ? '' : ''}${sw(!!S.settings.plCompress, 'data-ed-sw="compress"', 'Comprimir las fotos al subirlas', 'Las fotos de más de 2560 px o 3 MB se guardan como JPEG de 2560 px: ocupan mucho menos y apenas se nota.')}`;
      hydrate(body);
      // estado real de cada foto local (pendiente de subir o solo local)
      for (const f of all.filter(x => x.local)) img.getLocal(f.id).then(r => { const b = $(`[data-badge="${CSS.escape(f.id)}"]`, body); if (b && r?.state === 'pending') b.textContent = 'Pendiente de subir'; });
      sortable($('[data-sortable]', body), async ids => { data.localOf(p.id).order = ids; p.photos = data.orderPhotos(p, ids).filter(x => x.path); await data.saveLocalState(); await savePlaylist(p); paintTab(); });
    } else if (tab === 'org') {
      const feat = p.featured.map(id => S.tracks.get(id)).filter(Boolean);
      body.innerHTML = `${sw(data.moduleOn(p, 'chapters'), 'data-ed-mod="chapters"', 'Usar capítulos', 'Divide la playlist en partes que se pueden plegar y reproducir por separado. Si lo desactivas, verás una lista normal.')}
        <div class="block-head"><h4>Capítulos</h4><span class="grow"></span><button class="btn" data-ed="sec-add">${icon('plus')}Nuevo capítulo</button></div>
        ${p.sections.length ? `<ol class="ed-secs">${p.sections.map((sc, i) => `<li data-id="${esc(sc.id)}">
          <span class="field"><input data-sec-name="${esc(sc.id)}" value="${esc(sc.name)}" maxlength="200" placeholder="Nombre del capítulo" aria-label="Nombre del capítulo ${i + 1}"></span>
          <span class="field"><input data-sec-desc="${esc(sc.id)}" value="${esc(sc.description || '')}" maxlength="2000" placeholder="Descripción (opcional)" aria-label="Descripción del capítulo ${i + 1}"></span>
          <small class="muted">${plural(p.trackIds.filter(t => p.trackSection[t] === sc.id).length, 'canción', 'canciones')}</small>
          <span class="ph-ops"><button class="icon-btn" data-ed="sec-up" data-id="${esc(sc.id)}" aria-label="Subir" ${i ? '' : 'disabled'}>${icon('up')}</button><button class="icon-btn" data-ed="sec-del" data-id="${esc(sc.id)}" aria-label="Eliminar el capítulo">${icon('trash')}</button></span></li>`).join('')}</ol>
          <p class="muted">Para poner una canción en un capítulo: menú ⋯ de la canción → «Mover a capítulo…», o arrástrala en modo «Reordenar».</p>` : '<p class="muted">Ejemplo: «El comienzo», «Medianoche», «Los recuerdos», «El final».</p>'}
        <div class="block-head"><h4>Destacadas</h4><span class="muted">${feat.length} / ${MAX_FEATURED}</span></div>
        ${feat.length ? `<ol class="ed-secs">${feat.map((t, i) => `<li><span class="row-text"><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></span><span class="ph-ops"><button class="icon-btn" data-ed="feat-up" data-id="${esc(t.id)}" aria-label="Subir" ${i ? '' : 'disabled'}>${icon('up')}</button><button class="icon-btn" data-ed="feat-del" data-id="${esc(t.id)}" aria-label="Quitar de destacadas">${icon('x')}</button></span></li>`).join('')}</ol>` : '<p class="muted">Fija hasta 3 canciones con «Destacar» en su menú ⋯.</p>'}
        <h4>Orden y filtros</h4>
        ${data.isFavs(p) ? `<div class="seg">${[['date', 'Por fecha de «me gusta»'], ['manual', 'Manual']].map(([k, l]) => `<button class="chip ${(p.settings.favOrder || 'date') === k ? 'on' : ''}" data-ed="favorder" data-v="${k}">${l}</button>`).join('')}</div>
          <p class="muted">Con el orden manual, las canciones que marques con el corazón entran arriba y puedes moverlas con «Reordenar».</p>` : ''}
        <p class="muted">Tu orden personalizado se guarda siempre; ordenar o filtrar la vista no lo cambia.</p>
        ${sw(!!p.settings.view, 'data-ed-sw="rememberView"', 'Recordar la vista de esta playlist', 'Guarda el orden y los filtros elegidos para la próxima vez y en tus otros dispositivos.')}`;
    } else if (tab === 'mods') {
      const blocks = p.settings.modules;
      body.innerHTML = `<p class="muted">Elige qué se ve en esta playlist y en qué orden. Cada playlist tiene su propia configuración.</p>
        <ol class="ed-mods" data-sortable="mods">${blocks.map(([id, on]) => { const name = data.MODULES.find(m => m[0] === id)[1], fixed = id === 'songs', block = data.BLOCKS.includes(id); return `<li data-id="${id}">
          ${block ? `<button class="icon-btn drag" data-drag-item aria-label="Arrastrar para reordenar ${esc(name)}">${icon('grip')}</button>` : '<span class="drag-space"></span>'}
          <label class="switch mini"><input type="checkbox" data-ed-mod="${id}" ${on ? 'checked' : ''} ${fixed ? 'disabled' : ''}><span><b>${name}</b>${fixed ? '<small>Siempre visible</small>' : block ? '' : '<small>En la cabecera o en la lista</small>'}</span></label></li>`; }).join('')}</ol>
        <h4>Densidad de la lista</h4>
        <div class="seg">${[['comfortable', 'Cómoda'], ['compact', 'Compacta']].map(([k, l]) => `<button class="chip ${p.settings.density === k ? 'on' : ''}" data-ed="density" data-v="${k}">${l}</button>`).join('')}</div>
        <h4>Estadísticas</h4>
        <div class="seg">${[['detailed', 'Detalladas, con gráficos'], ['compact', 'Solo cifras']].map(([k, l]) => `<button class="chip ${p.settings.stats === k ? 'on' : ''}" data-ed="statsmode" data-v="${k}">${l}</button>`).join('')}</div>`;
      sortable($('[data-sortable]', body), async ids => {
        const map = new Map(p.settings.modules);
        p.settings.modules = ids.map(id => [id, map.get(id)]);
        await savePlaylist(p); paintTab();
      });
    } else if (tab === 'adv') {
      const tracks = tracksOf(p);
      body.innerHTML = `<h4>Estadísticas</h4><p class="muted">${plural(tracks.length, 'canción', 'canciones')} · ${totalTime(tracks)} · ${plural(new Set(tracks.flatMap(t => artistsOf(t))).size, 'artista', 'artistas')}. Las escuchas de esta playlist se guardan agregadas por día (sin horas ni dispositivo).</p>
        <h4>Reproducción</h4>
        <label class="lbl">Modo sorpresa: dejar para el final lo escuchado en las últimas…<span class="field"><select data-ed-sel="surpriseHours">${[[6, '6 horas'], [24, '24 horas'], [72, '3 días'], [168, 'Una semana']].map(([h, l]) => `<option value="${h}" ${(p.settings.surpriseHours || 24) === h ? 'selected' : ''}>${l}</option>`).join('')}</select></span></label>
        <p class="muted">El modo ambiente ordena las canciones en cuatro fases (inicio tranquilo, más energía, momento intenso y final relajado) usando «lo que transmite» de cada una. ${ambientPlan(p).ok ? 'Esta playlist tiene datos suficientes.' : esc(ambientPlan(p).why)}</p>
        ${data.isFavs(p) ? '<h4>Eliminar</h4><p class="muted">Esta playlist no se puede eliminar: se llena sola con las canciones a las que das «me gusta».</p>' : `<h4>Eliminar</h4>
        <p class="muted">Las canciones seguirán en tu biblioteca. Se borrarán la portada, las fotos, los capítulos, las notas y las estadísticas de esta playlist.</p>
        <button class="btn danger" data-ed="delete">${icon('trash')}Eliminar la playlist</button>`}`;
    }
    // formulario de información
    const form = $('[data-ed-form="info"]', body);
    if (form) {
      const addTag = v => { v = (v || '').trim().replace(/^#/, ''); if (v && !d.tags.some(x => x.toLowerCase() === v.toLowerCase()) && d.tags.length < 30) d.tags.push(v); };
      form.tag.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveDraft(form); addTag(form.tag.value); paintTab(); } });
      form.onsubmit = async e => {
        e.preventDefault(); saveDraft(form); addTag(form.tag.value);
        if (!d.name.trim()) return toast('La playlist necesita un título');
        Object.assign(p, { name: d.name.trim(), emoji: d.emoji.trim(), description: d.description.trim(), quote: d.quote.trim(), tags: d.tags, mood: d.mood });
        await savePlaylist(p); toast('Cambios guardados'); paintTab();
      };
      ed.addTag = addTag;
    }
    const cf = $('[data-ed-form="colors"]', body);
    if (cf) cf.onsubmit = async e => {
      e.preventDefault();
      p.colors.manual = [cf.c0.value, cf.c1.value, ...(cf.use3.checked ? [cf.c2.value] : [])];
      await savePlaylist(p); paintTab(); $('.pl-editor', sheet).style.cssText = themeStyle(p);
    };
  }
  /** Espacio que ocupan las imágenes de la playlist (en la cuenta y en este dispositivo). */
  function spaceText(p) {
    const cloud = p.photos.reduce((n, f) => n + (f.size || 0), 0) + (p.cover.kind === 'image' ? p.cover.size || 0 : 0);
    setTimeout(async () => {
      const l = data.localOf(p.id);
      let local = 0;
      for (const id of [l.cover, ...l.photos].filter(Boolean)) local += (await img.getLocal(id))?.size || 0;
      const el = $('[data-space]', sheet);
      if (el && local) el.textContent = `${el.textContent} · ${img.MB(local)} solo en este dispositivo`;
    });
    return `Las imágenes de esta playlist ocupan ${img.MB(cloud)} en tu cuenta (máximo ${img.LIMIT_TEXT} por foto).`;
  }
  const saveDraft = f => { if (!ed || !f) return; for (const k of ['name', 'emoji', 'description', 'quote', 'mood']) if (f[k]) ed.draft[k] = f[k].value; };

  async function onEditorClick(e) {
    if (!ed) return;
    const { p } = ed;
    const tabBtn = e.target.closest('[data-ed-tab]');
    if (tabBtn) { saveDraft($('[data-ed-form="info"]', sheet)); ed.tab = tabBtn.dataset.edTab; return paintTab(); }
    const t = e.target.closest('[data-tag-del],[data-tag-add],[data-tag-sugg]');
    if (t) {
      saveDraft($('[data-ed-form="info"]', sheet));
      if (t.dataset.tagDel) ed.draft.tags = ed.draft.tags.filter(x => x !== t.dataset.tagDel);
      else ed.addTag(t.dataset.tagSugg || $('[name=tag]', sheet).value);
      return paintTab();
    }
    const b = e.target.closest('[data-ed]');
    if (!b) return;
    const a = b.dataset.ed, l = data.localOf(p.id), id = b.dataset.id;
    const save = async () => { await savePlaylist(p); paintTab(); };
    switch (a) {
      case 'close': return sheet.close();
      case 'cover-upload': {
        const files = await pickFiles(false);
        if (!files.length) return;
        const [item] = await prepareImages(files, 'cover', p.id);
        if (!item) return paintTab();
        item.rec.colors = await img.dominantColors(item.rec.thumb || item.rec.blob).catch(() => []);
        // Una foto que solo estará en este dispositivo colorea solo este dispositivo (los demás no la ven).
        if (item.cloud) { if (p.colors.mode === 'auto') p.colors.auto = item.rec.colors; }
        else { data.localOf(p.id).coverColors = item.rec.colors; await data.saveLocalState(); }
        try { await storeImage(p, item.rec, item.cloud, 'la portada'); }
        catch (err) { toast(err.message, 7000); }
        await savePlaylist(p);
        return paintTab();
      }
      case 'cover-crop': return cropEditor(p);
      case 'cover-collage': case 'cover-default': {
        if (l.cover) { await img.dropLocal(l.cover); l.cover = null; await data.saveLocalState(); }
        p.cover = { kind: a === 'cover-collage' ? 'collage' : 'auto' };   // la foto anterior se borra de Storage al guardar
        p.colors.auto = [];
        await save(); ensureAutoColors(p); return;
      }
      case 'cover-remove':
        if (!(await confirmInline('¿Quitar la foto de portada?', 'Se borrará de tu cuenta y se usará la portada predeterminada.'))) return;
        if (l.cover) { await img.dropLocal(l.cover); l.cover = null; await data.saveLocalState(); }
        p.cover = { kind: 'auto' }; p.colors.auto = [];
        return save();
      case 'colors-auto': p.colors.mode = 'auto'; return save();
      case 'colors-manual': p.colors.mode = 'manual'; if (!p.colors.manual?.length) p.colors.manual = (p.colors.auto?.length ? p.colors.auto : ['#6d4fc2', '#e06d3f']).slice(0, 3); return save();
      case 'colors-recalc': p.colors.auto = []; await ensureAutoColors(p); return paintTab();
      case 'header': p.settings.header = b.dataset.v; return save();
      case 'density': p.settings.density = b.dataset.v; return save();
      case 'statsmode': p.settings.stats = b.dataset.v; return save();
      case 'favorder': p.settings.favOrder = b.dataset.v; data.reconcileFavs(); return save();
      case 'photos-add': {
        const room = MAX_PHOTOS - data.orderPhotos(p).length;
        let files = await pickFiles(true);
        if (!files.length) return;
        if (files.length > room) { toast(`Solo caben ${room} fotos más (máximo ${MAX_PHOTOS}). Se añaden las primeras.`, 6000); files = files.slice(0, room); }
        const items = await prepareImages(files, 'photo', p.id);
        for (let i = 0; i < items.length; i++) {
          try { await storeImage(p, items[i].rec, items[i].cloud, items.length > 1 ? `la foto ${i + 1} de ${items.length}` : 'la foto'); }
          catch (err) { toast(err.message, 7000); if (err.quota) break; }
        }
        return paintTab();
      }
      case 'photo-up': {
        const order = data.orderPhotos(p).map(f => f.id), i = order.indexOf(id);
        if (i > 0) [order[i - 1], order[i]] = [order[i], order[i - 1]];
        l.order = order; p.photos = data.orderPhotos(p, order).filter(x => x.path);
        await data.saveLocalState(); return save();
      }
      case 'photo-del': {
        if (!(await confirmInline('¿Eliminar esta foto?', 'Se quitará del carrusel y se borrará de tu cuenta (o de este dispositivo).'))) return;
        if (l.photos.includes(id)) { l.photos = l.photos.filter(x => x !== id); await img.dropLocal(id); }
        p.photos = p.photos.filter(f => f.id !== id);   // al guardar, Supabase devuelve su ruta y se borra de Storage
        l.order = l.order.filter(x => x !== id);
        await data.saveLocalState(); return save();
      }
      case 'sec-add': p.sections.push({ id: img.newId(), name: `Capítulo ${p.sections.length + 1}`, description: '', collapsed: false }); return save();
      case 'sec-up': { const i = p.sections.findIndex(s => s.id === id); if (i > 0) [p.sections[i - 1], p.sections[i]] = [p.sections[i], p.sections[i - 1]]; return save(); }
      case 'sec-del': {
        const n = p.trackIds.filter(x => p.trackSection[x] === id).length;
        if (n && !(await confirmInline('¿Eliminar el capítulo?', `Sus ${plural(n, 'canción', 'canciones')} siguen en la playlist, sin capítulo.`))) return;
        p.sections = p.sections.filter(s => s.id !== id);
        for (const x of Object.keys(p.trackSection)) if (p.trackSection[x] === id) delete p.trackSection[x];
        return save();
      }
      case 'feat-up': { const i = p.featured.indexOf(id); if (i > 0) [p.featured[i - 1], p.featured[i]] = [p.featured[i], p.featured[i - 1]]; return save(); }
      case 'feat-del': p.featured = p.featured.filter(x => x !== id); return save();
      case 'delete':
        if (!(await confirmInline('¿Eliminar la playlist?', `«${p.name}» se eliminará en todos tus dispositivos. Las canciones seguirán en tu biblioteca.`, 'Eliminar'))) return;
        return deletePlaylist(p);
    }
  }
  /** Confirmación dentro del editor (sin cerrarlo). */
  function confirmInline(title, text, ok = 'Sí, continuar') {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.className = 'ed-confirm';
      box.innerHTML = `<div class="dlg" role="alertdialog" aria-label="${esc(title)}"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="actions"><button class="btn ghost" data-n>Cancelar</button><button class="btn danger" data-y>${esc(ok)}</button></div></div>`;
      $('.pl-editor', sheet).append(box);
      box.addEventListener('click', ev => { if (ev.target.closest('[data-y]')) { box.remove(); resolve(true); } else if (ev.target.closest('[data-n]') || ev.target === box) { box.remove(); resolve(false); } });
      $('[data-y]', box).focus();
    });
  }
  async function deletePlaylist(p) {
    if (data.isFavs(p)) return toast('«Canciones que te gustan» no se puede eliminar');
    const l = data.localOf(p.id);
    for (const x of [l.cover, ...l.photos].filter(Boolean)) await img.dropLocal(x);
    l.cover = null; l.photos = []; l.order = [];
    await data.saveLocalState();
    // Se vacía y se marca como eliminada: Supabase borra canciones, fotos, capítulos, notas y
    // estadísticas, y devuelve las rutas de la portada y las fotos para borrarlas de Storage.
    Object.assign(p, { deleted: true, trackIds: [], photos: [], sections: [], trackSection: {}, notes: {}, featured: [], added: {} });
    await savePlaylist(p);
    sheet.close();
    toast(`Playlist «${p.name}» eliminada`);
    location.hash = '#/playlists';
  }

  /** Recorte y encuadre de la portada (no destructivo: se guarda la posición y el zoom). */
  async function cropEditor(p) {
    const l = data.localOf(p.id);
    const rec = l.cover ? await img.getLocal(l.cover) : null;
    const url = rec ? await img.localUrl(l.cover) : p.cover.kind === 'image' ? await img.cloudUrl(p.cover.path) : null;
    if (!url) return toast('La portada aún no está disponible en este dispositivo');
    const crop = { x: 50, y: 50, z: 1, ...(rec ? rec.crop : p.cover.crop) };
    const body = $('.ed-body', sheet);
    body.innerHTML = `<div class="crop"><p class="muted">Arrastra la imagen para encuadrarla y usa el zoom. Así se verá la portada.</p>
      <div class="crop-frame" tabindex="0" aria-label="Encuadre: usa las flechas para mover"><img alt="" src="${url}" style="${cropStyle(crop)}"></div>
      <label class="lbl">Zoom<input type="range" min="1" max="3" step="0.01" value="${crop.z}" data-zoom></label>
      <div class="actions"><button class="btn ghost" data-crop="reset">Centrar</button><button class="btn ghost" data-crop="cancel">Cancelar</button><button class="btn primary" data-crop="ok">Guardar el encuadre</button></div></div>`;
    const frame = $('.crop-frame', body), im = $('img', frame), zoom = $('[data-zoom]', body);
    const paint = () => { im.style.cssText = cropStyle(crop); };
    let drag = null;
    frame.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: crop.x, cy: crop.y }; frame.setPointerCapture(e.pointerId); });
    frame.addEventListener('pointermove', e => {
      if (!drag) return;
      const r = frame.getBoundingClientRect(), k = 100 / (r.width * Math.max(0.5, crop.z - 0.6));
      crop.x = Math.max(0, Math.min(100, drag.cx - (e.clientX - drag.x) * k));
      crop.y = Math.max(0, Math.min(100, drag.cy - (e.clientY - drag.y) * k));
      paint();
    });
    frame.addEventListener('pointerup', () => { drag = null; });
    frame.addEventListener('keydown', e => { const d = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] }[e.key]; if (d) { e.preventDefault(); crop.x = Math.max(0, Math.min(100, crop.x + d[0])); crop.y = Math.max(0, Math.min(100, crop.y + d[1])); paint(); } });
    zoom.addEventListener('input', () => { crop.z = +zoom.value; paint(); });
    body.onclick = async e => {
      const b = e.target.closest('[data-crop]');
      if (!b) return;
      if (b.dataset.crop === 'reset') { Object.assign(crop, { x: 50, y: 50, z: 1 }); zoom.value = 1; return paint(); }
      if (b.dataset.crop === 'ok') {
        const v = { x: Math.round(crop.x * 10) / 10, y: Math.round(crop.y * 10) / 10, z: Math.round(crop.z * 100) / 100 };
        if (rec) { rec.crop = v; await img.saveLocal(rec); } else { p.cover.crop = v; await savePlaylist(p); }
        toast('Encuadre guardado');
      }
      body.onclick = null;
      paintTab();
    };
  }

  /** Lista reordenable arrastrando el asa (ratón, dedo y teclado con flechas). */
  function sortable(list, onDone) {
    if (!list) return;
    let drag = null;
    const items = () => $$(':scope > li', list);
    // Mientras se arrastra se escucha en toda la ventana: al mover el elemento dentro de la lista,
    // el navegador puede dejar de enviarle a él los eventos del puntero.
    const move = e => {
      if (!drag) return;
      drag.li.style.transform = `translateY(${e.clientY - drag.y}px)`;
      const over = items().find(li => { if (li === drag.li) return false; const r = li.getBoundingClientRect(); return e.clientY > r.top && e.clientY < r.bottom; });
      if (over) {
        const r = over.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2;
        const top = drag.li.getBoundingClientRect().top;
        over.parentNode.insertBefore(drag.li, before ? over : over.nextSibling);
        drag.y += drag.li.getBoundingClientRect().top - top;
        drag.li.style.transform = `translateY(${e.clientY - drag.y}px)`;
      }
    };
    const end = () => {
      if (!drag) return;
      drag.stop.abort();
      drag.li.classList.remove('lifted'); drag.li.style.transform = '';
      const moved = drag.start !== items().map(li => li.dataset.id).join('|');
      drag = null;
      if (moved) onDone(items().map(li => li.dataset.id));
    };
    list.addEventListener('pointerdown', e => {
      const h = e.target.closest('[data-drag-item]');
      if (!h) return;
      e.preventDefault();
      const li = h.closest('li');
      drag = { li, y: e.clientY, start: items().map(x => x.dataset.id).join('|'), stop: new AbortController() };
      li.classList.add('lifted');
      const opts = { signal: drag.stop.signal };
      window.addEventListener('pointermove', move, opts);
      window.addEventListener('pointerup', end, opts);
      window.addEventListener('pointercancel', end, opts);
    });
    list.addEventListener('keydown', e => {
      const h = e.target.closest('[data-drag-item]');
      if (!h || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const li = h.closest('li'), sib = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling;
      if (!sib) return;
      list.insertBefore(li, e.key === 'ArrowUp' ? sib : sib.nextSibling);
      h.focus();
      onDone(items().map(x => x.dataset.id));
    });
  }

  // ================================================================ filtros
  function openFilters(p) {
    const v = viewOf(p), ts = tracksOf(p);
    const count = f => { const m = new Map(); for (const t of ts) for (const x of f(t)) m.set(x, (m.get(x) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
    const paint = () => {
      const f = v.f, chip = (k, val, label, on) => `<button type="button" class="chip ${on ? 'on' : ''}" data-f="${k}" data-v="${esc(val)}" aria-pressed="${!!on}">${esc(label)}</button>`;
      const moods = count(t => t.moods || []), artists = count(t => artistsOf(t)), albums = count(t => [t.album || '']);
      openSheet(`<div class="dlg filters"><h3>Filtrar «${esc(p.name)}»</h3>
        <h4>Artista</h4><div class="chips">${artists.slice(0, 40).map(([a, n]) => chip('artists', a, `${a} (${n})`, f.artists?.includes(a))).join('')}</div>
        <h4>Álbum</h4><div class="chips">${albums.slice(0, 40).map(([a, n]) => chip('albums', a, `${a || 'Sin álbum'} (${n})`, f.albums?.includes(a))).join('')}</div>
        <h4>Duración</h4><div class="chips">${Object.entries(DUR).map(([k, [l]]) => chip('dur', k, l, f.dur === k)).join('')}</div>
        <h4>Lo que transmite</h4><div class="chips">${moods.length ? moods.map(([m, n]) => chip('moods', m, `${m} (${n})`, f.moods?.includes(m))).join('') : '<small class="muted">Las canciones aún no tienen esta información.</small>'}</div>
        <h4>Escuchas</h4><div class="chips">${chip('fav', 1, 'Favoritas', f.fav)}${chip('recent', 1, 'Escuchadas esta semana', f.recent)}${chip('never', 1, 'Nunca reproducidas', f.never)}</div>
        <div class="actions"><button type="button" class="btn ghost" data-fclear>Quitar filtros</button><button type="button" class="btn primary" data-x>Ver ${plural(visible(p, v).length, 'canción', 'canciones')}</button></div></div>`,
      e => {
        if (e.target.closest('[data-x]')) return sheet.close();
        if (e.target.closest('[data-fclear]')) { v.f = {}; return repaint(); }
        const b = e.target.closest('[data-f]');
        if (!b) return;
        const k = b.dataset.f, val = b.dataset.v;
        if (['artists', 'albums', 'moods'].includes(k)) { const l = v.f[k] || []; v.f[k] = l.includes(val) ? l.filter(x => x !== val) : [...l, val]; }
        else if (k === 'dur') v.f.dur = v.f.dur === val ? '' : val;
        else v.f[k] = !v.f[k];
        repaint();
      });
    };
    const repaint = () => { const sc = $('.filters', sheet)?.scrollTop || 0; paint(); $('.filters', sheet).scrollTop = sc; rememberView(p); paintSongs(p); };
    paint();
    sheet.addEventListener('close', () => refresh(), { once: true });
  }
  /** Si el usuario pidió recordar la vista, se guarda con la playlist (y se sincroniza). */
  function rememberView(p) {
    if (!p.settings.view) return;
    const v = viewOf(p);
    p.settings.view = { sort: v.sort, f: v.f, discover: v.discover };
    clearTimeout(rememberView.t); rememberView.t = setTimeout(() => savePlaylist(p), 800);
  }
  /** Repinta solo la lista de canciones (al buscar no se pierde el foco). */
  function paintSongs(p) {
    const box = $(`.pl[data-pl="${CSS.escape(p.id)}"] .pl-songs`);
    if (!box) return;
    const tmp = document.createElement('div');
    c.setHTML(tmp, songsBlock(p, viewOf(p), tracksOf(p)));
    const fresh = tmp.firstElementChild;
    const q = $('[data-plq]', box), focused = document.activeElement === q, pos = q?.selectionStart;
    if (focused) { $('.pl-tools', fresh).replaceWith(q.closest('.pl-tools')); }
    box.replaceWith(fresh);
    if (focused) { q.focus(); q.setSelectionRange(pos, pos); }
    c.watch(fresh);
  }

  // ================================================================ reordenar canciones arrastrando
  /** En «Canciones que te gustan», mover algo a mano deja de ordenarla por fecha. */
  const markManual = p => { if (data.isFavs(p)) p.settings.favOrder = 'manual'; };
  let dragSong = null;
  function songOrder(p, tid, beforeId, sectionId) {
    const ids = p.trackIds.filter(x => x !== tid);
    const i = beforeId ? ids.indexOf(beforeId) : -1;
    if (i < 0) {
      // al final del capítulo de destino (o de la lista)
      let at = ids.length;
      if (sectionId !== undefined) { const last = ids.map((x, k) => [x, k]).filter(([x]) => (p.trackSection[x] || '') === sectionId).pop(); if (last) at = last[1] + 1; }
      ids.splice(at, 0, tid);
    } else ids.splice(i, 0, tid);
    p.trackIds = ids;
    if (sectionId !== undefined) { if (sectionId) p.trackSection[tid] = sectionId; else delete p.trackSection[tid]; }
  }
  document.addEventListener('pointerdown', e => {
    const h = e.target.closest('.pl-list [data-drag]');
    if (!h) return;
    e.preventDefault();
    const row = h.closest('.row'), list = h.closest('.pl-list');
    dragSong = { row, list, pid: list.dataset.pid, tid: row.dataset.id, y: e.clientY, target: null };
    row.classList.add('lifted');
    h.setPointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove', e => {
    if (!dragSong) return;
    dragSong.row.style.transform = `translateY(${e.clientY - dragSong.y}px)`;
    $$('.drop-before,.drop-after,.drop-into', dragSong.list).forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
    const el = document.elementsFromPoint(e.clientX, e.clientY).find(x => x !== dragSong.row && (x.matches('.row') || x.matches('[data-drop-chapter]')) && dragSong.list.contains(x));
    dragSong.target = null;
    if (el?.matches('.row')) { const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2; el.classList.add(after ? 'drop-after' : 'drop-before'); dragSong.target = { row: el, after }; }
    else if (el) { el.classList.add('drop-into'); dragSong.target = { chapter: el.dataset.dropChapter }; }
    // desplazamiento automático cerca de los bordes
    const view = document.getElementById('view'), vr = view.getBoundingClientRect();
    if (e.clientY < vr.top + 60) view.scrollTop -= 12; else if (e.clientY > vr.bottom - 60) view.scrollTop += 12;
  });
  const endDrag = async () => {
    if (!dragSong) return;
    const { row, list, pid, tid, target } = dragSong;
    dragSong = null;
    row.classList.remove('lifted'); row.style.transform = '';
    $$('.drop-before,.drop-after,.drop-into', list).forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
    const p = byId(pid);
    if (!p || !target) return;
    if (target.row) {
      const other = target.row.dataset.id, chap = target.row.closest('[data-chapter]');
      const ids = p.trackIds.filter(x => x !== tid), idx = ids.indexOf(other);
      songOrder(p, tid, target.after ? ids[idx + 1] || null : other, chap ? chap.dataset.chapter : undefined);
      if (target.after && !ids[idx + 1]) { p.trackIds = p.trackIds.filter(x => x !== tid); p.trackIds.splice(p.trackIds.indexOf(other) + 1, 0, tid); }
    } else songOrder(p, tid, null, target.chapter);
    markManual(p);
    await savePlaylist(p);
    paintSongs(p);
    const moved = $(`.pl-list .row[data-id="${CSS.escape(tid)}"]`);
    moved?.classList.add('moved');
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  document.addEventListener('keydown', async e => {
    const h = e.target.closest?.('.pl-list [data-drag]');
    if (!h || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const p = byId(h.closest('.pl-list').dataset.pid), tid = h.closest('.row').dataset.id, i = p.trackIds.indexOf(tid), j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j < 0 || j >= p.trackIds.length) return;
    [p.trackIds[i], p.trackIds[j]] = [p.trackIds[j], p.trackIds[i]];
    markManual(p);
    if (p.trackSection[p.trackIds[i]] !== p.trackSection[tid]) { if (p.trackSection[p.trackIds[i]]) p.trackSection[tid] = p.trackSection[p.trackIds[i]]; else delete p.trackSection[tid]; }
    await savePlaylist(p); paintSongs(p);
    $(`.pl-list .row[data-id="${CSS.escape(tid)}"] [data-drag]`)?.focus();
  });

  // ================================================================ búsqueda y orden (sin recargar la página)
  document.addEventListener('input', e => {
    const q = e.target.closest?.('[data-plq]');
    if (!q) return;
    const p = byId(q.dataset.plq); if (!p) return;
    viewOf(p).q = q.value; viewOf(p).reorder = false; paintSongs(p);
  });
  document.addEventListener('change', e => {
    const sel = e.target.closest?.('[data-plsort]');
    if (sel) { const p = byId(sel.dataset.plsort); const v = viewOf(p); v.sort = sel.value; v.reorder = false; rememberView(p); return paintSongs(p); }
    if (!ed) return;
    const { p } = ed;
    const swEl = e.target.closest('[data-ed-sw]'), mod = e.target.closest('[data-ed-mod]'), sl = e.target.closest('[data-ed-sel]');
    if (swEl) {
      const k = swEl.dataset.edSw;
      if (k === 'showPhotos') { p.showPhotos = swEl.checked; savePlaylist(p); }
      if (k === 'compress') { S.settings.plCompress = swEl.checked; c.saveKV('settings', false); }
      if (k === 'rememberView') { const v = viewOf(p); p.settings.view = swEl.checked ? { sort: v.sort, f: v.f, discover: v.discover } : null; savePlaylist(p); }
    }
    if (mod) { const m = p.settings.modules.find(x => x[0] === mod.dataset.edMod); if (m) { m[1] = mod.checked; savePlaylist(p); } }
    if (sl) { p.settings[sl.dataset.edSel] = +sl.value; savePlaylist(p); }
    const cap = e.target.closest('[data-caption]');
    if (cap) {
      const id = cap.dataset.caption, f = p.photos.find(x => x.id === id);
      if (f) { f.caption = cap.value.trim(); savePlaylist(p); }
      else img.getLocal(id).then(r => { if (r) { r.caption = cap.value.trim(); img.saveLocal(r); } });
    }
    const sn = e.target.closest('[data-sec-name],[data-sec-desc]');
    if (sn) {
      const sc = p.sections.find(x => x.id === (sn.dataset.secName || sn.dataset.secDesc));
      if (sc) { if (sn.dataset.secName) sc.name = sn.value.trim(); else sc.description = sn.value.trim(); savePlaylist(p); }
    }
  });

  // ================================================================ acciones
  const A = c.ACTIONS;
  const P_ = el => byId(el.dataset.pid || el.closest('[data-pl]')?.dataset.pl);
  Object.assign(A, {
    'pl-play'(el) { const p = P_(el); const l = playOrder(p); if (l.length) { if (player.P.shuffle) player.toggleShuffle(); player.playQueue(l, 0, ctxOf(p)); } },
    'pl-shuffle'(el) { const p = P_(el); const l = playOrder(p); if (l.length) { if (!player.P.shuffle) player.toggleShuffle(); player.playQueue(l, Math.floor(Math.random() * l.length), ctxOf(p)); } },
    'pl-surprise'(el) { const p = P_(el); const l = surpriseOrder(p); if (l.length) { if (player.P.shuffle) player.toggleShuffle(); player.playQueue(l, 0, ctxOf(p)); toast('Modo sorpresa: lo que escuchaste hace poco, al final'); } },
    'pl-ambient'(el) {
      const p = P_(el), plan = ambientPlan(p);
      if (!plan.ok) return toast(plan.why, 7000);
      if (player.P.shuffle) player.toggleShuffle();
      player.playQueue(plan.list, 0, ctxOf(p)); toast('Modo ambiente: de lo tranquilo a lo intenso, y vuelta a la calma');
    },
    'pl-play-one'(el) { const p = P_(el), t = S.tracks.get(el.dataset.tid); if (t && playable(t)) { const l = playOrder(p); player.playQueue(l, Math.max(0, l.indexOf(t)), ctxOf(p)); } },
    'pl-play-chapter'(el) {
      const p = P_(el), sid = el.dataset.sid;
      const l = playOrder(p).filter(t => (p.trackSection[t.id] || '') === sid);
      if (l.length) { if (player.P.shuffle) player.toggleShuffle(); player.playQueue(l, 0, ctxOf(p)); toast(`Capítulo «${p.sections.find(s => s.id === sid)?.name || 'Sin capítulo'}»`); }
    },
    async 'pl-chapter-toggle'(el) {
      const p = P_(el), sc = p.sections.find(s => s.id === el.dataset.sid), ch = el.closest('.chapter');
      const col = !ch.classList.contains('collapsed');
      ch.classList.toggle('collapsed', col); el.setAttribute('aria-expanded', !col);
      if (sc) { sc.collapsed = col; await savePlaylist(p); }
    },
    'pl-edit'(el) { openEditor(P_(el), el.dataset.tab || 'info'); },
    'pl-more'(el) {
      const p = P_(el), ts = tracksOf(p);
      menu(`<div class="sheet-head"><div><b>${esc(p.name)}</b></div></div>`, [
        ts.some(c.needsDownload) && { icon: 'download', label: 'Descargar para escuchar sin conexión', fn: () => c.downloadMany(ts.filter(c.needsDownload)) },
        { icon: 'image', label: 'Fotos del carrusel', fn: () => openEditor(p, 'photos') },
        { icon: 'list', label: 'Capítulos y destacadas', fn: () => openEditor(p, 'org') },
        { icon: 'settings', label: 'Personalizar la vista', fn: () => openEditor(p, 'mods') },
        !data.isFavs(p) && { icon: 'trash', label: 'Eliminar playlist', danger: true, fn: async () => { if (await confirmDlg('¿Eliminar playlist?', `«${p.name}» se eliminará en todos tus dispositivos. Las canciones seguirán en tu biblioteca.`)) deletePlaylist(p); } },
      ]);
    },
    'pl-retry'() { data.pull(); },
    'pl-photo'(el) { openViewer(P_(el), +el.dataset.i); },
    'pl-car'(el) { const car = $('.carousel', el.closest('.pl-photos')); car.scrollBy({ left: +el.dataset.d * car.clientWidth * 0.8, behavior: reduced() ? 'auto' : 'smooth' }); },
    'pl-filters'(el) { openFilters(P_(el)); },
    'pl-unfilter'(el) {
      const p = P_(el), v = viewOf(p), k = el.dataset.k;
      if (Array.isArray(v.f[k])) v.f[k] = v.f[k].filter(x => x !== el.dataset.v); else v.f[k] = k === 'dur' ? '' : false;
      rememberView(p); paintSongs(p);
    },
    'pl-clear-view'(el) { const p = P_(el), v = viewOf(p); Object.assign(v, { q: '', sort: 'custom', f: {} }); rememberView(p); paintSongs(p); },
    'pl-reorder'(el) { const p = P_(el), v = viewOf(p); v.reorder = !v.reorder; paintSongs(p); },
    'pl-disc-mode'(el) { const p = P_(el), v = viewOf(p); v.discover = el.dataset.m; v.page = 0; rememberView(p); refresh(); },
    'pl-disc-more'(el) { const p = P_(el); viewOf(p).page++; refresh(); },
    'pl-disc-play'(el) { const t = S.tracks.get(el.dataset.tid); if (t) player.playQueue([t]); },
    async 'pl-disc-add'(el) {
      const p = P_(el), t = S.tracks.get(el.dataset.tid);
      if (!t) return;
      if (data.isFavs(p)) { if (!isFav(t.id)) toggleFav(t.id); await data.syncFavs(); }
      else { data.addTracks(p, [t.id]); await savePlaylist(p); }
      toast(`«${t.title}» añadida a «${p.name}»`);
      refresh();
      setTimeout(() => $(`.pl-list .row[data-id="${CSS.escape(t.id)}"]`)?.classList.add('moved'), 200);
    },
    'pl-note'(el) { editNote(P_(el), el.dataset.tid); },
    async 'pl-fav-date'(el) { const p = P_(el); p.settings.favOrder = 'date'; data.reconcileFavs(); await savePlaylist(p); refresh(); },
  });

  /** Opciones del menú ⋯ de una canción dentro de una playlist. */
  function menuItems(t, pid) {
    const p = byId(pid);
    if (!p) return [];
    const feat = p.featured.includes(t.id), note = p.notes[t.id]?.text, v = viewOf(p), i = p.trackIds.indexOf(t.id);
    return [
      { icon: 'star', label: feat ? 'Quitar de destacadas' : 'Destacar', fn: async () => {
        if (feat) p.featured = p.featured.filter(x => x !== t.id);
        else { if (p.featured.length >= MAX_FEATURED) return toast(`Ya hay ${MAX_FEATURED} destacadas: quita una antes`); p.featured.push(t.id); }
        await savePlaylist(p); refresh();
      } },
      { icon: 'note', label: note ? 'Ver o cambiar la nota' : 'Añadir una nota', fn: () => editNote(p, t.id) },
      p.sections.length && { icon: 'list', label: 'Mover a capítulo…', fn: () => menu(`<div class="sheet-head"><div><b>¿A qué capítulo?</b></div></div>`,
        [...p.sections.map(sc => ({ icon: p.trackSection[t.id] === sc.id ? 'heart' : 'list', label: sc.name || 'Capítulo', fn: async () => { songOrder(p, t.id, null, sc.id); await savePlaylist(p); refresh(); } })),
          { icon: 'x', label: 'Sin capítulo', fn: async () => { songOrder(p, t.id, null, ''); await savePlaylist(p); refresh(); } }]) },
      isCustom(v) && i > 0 && { icon: 'up', label: 'Subir en la lista', fn: async () => { [p.trackIds[i - 1], p.trackIds[i]] = [p.trackIds[i], p.trackIds[i - 1]]; markManual(p); await savePlaylist(p); refresh(); } },
      isCustom(v) && i < p.trackIds.length - 1 && { icon: 'chevD', label: 'Bajar en la lista', fn: async () => { [p.trackIds[i + 1], p.trackIds[i]] = [p.trackIds[i], p.trackIds[i + 1]]; markManual(p); await savePlaylist(p); refresh(); } },
      data.isFavs(p)
        ? { icon: 'heart', label: 'Quitar de «me gusta»', fn: () => toggleFav(t.id) }
        : { icon: 'x', label: 'Quitar de esta playlist', fn: async () => { dropFromPlaylist(p, t.id); await savePlaylist(p); refresh(); } },
    ];
  }

  // ================================================================ crear y añadir
  async function newPlaylist(firstTracks = []) {
    const name = await c.ask({ title: 'Nueva playlist', placeholder: 'Nombre de la playlist', ok: 'Crear' });
    if (!name) return null;
    const p = data.normalize({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, trackIds: [], createdAt: Date.now() });
    data.addTracks(p, firstTracks.map(t => t.id));
    await savePlaylist(p);
    toast(`Playlist «${name}» creada`);
    return p;
  }
  function addToPlaylist(tracks) {
    const pls = livePlaylists().filter(p => !data.isFavs(p)).sort((a, b) => collator.compare(a.name, b.name));
    menu(`<div class="sheet-head"><div><b>Añadir a playlist</b></div></div>`, [
      { icon: 'plus', label: 'Nueva playlist…', fn: async () => { if (await newPlaylist(tracks)) refresh(); } },
      { icon: 'heart', label: 'Canciones que te gustan', fn: () => { const fresh = tracks.filter(t => !isFav(t.id)); fresh.forEach(t => toggleFav(t.id)); toast(fresh.length ? 'Añadida a tus «me gusta»' : 'Ya estaba en tus «me gusta»'); } },
      ...pls.map(p => ({
        icon: 'list', label: `${p.emoji ? `${p.emoji} ` : ''}${p.name}`, fn: async () => {
          const n = data.addTracks(p, tracks.map(t => t.id));
          if (n) await savePlaylist(p);
          toast(n ? `Añadida a «${p.name}»` : `Ya estaba en «${p.name}»`);
        },
      })),
    ]);
  }

  return { viewList, viewPlaylist, newPlaylist, addToPlaylist, menuItems, hydrate, syncChip, prepareImages, pickFiles };
}
