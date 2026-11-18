// Explorar → Descargar: pegar enlaces de YouTube y descargar canciones o playlists enteras en M4A
// (o MP3) con sus metadatos, para guardarlas en el dispositivo o añadirlas a la biblioteca.
import { S, saveKV } from './store.js';
import * as yt from './youtube.js';
import * as lib from './library.js';
import * as cloud from './cloud.js';
import { trackId } from './library.js';
import { icon } from './icons.js';
import * as player from './player.js';

const YT_EMBED = 'https://www.youtube-nocookie.com';

const PARALLEL_META = 3;   // canciones cuyos datos se buscan a la vez
const PARALLEL_DL = 2;     // descargas a la vez

export function initDownload(c) {
  const { esc, plural, toast, openSheet, sheet, setHTML } = c;
  const $ = (s, r = document) => r.querySelector(s);

  // Estado (se conserva al cambiar de pestaña: una descarga sigue mientras navegas por la app).
  const D = { link: '', busy: '', error: '', parsed: null, video: null, list: null, mode: '', items: [], run: null, summary: '', dest: '' };
  let metaQueue = [], metaActive = 0;
  // Navegador de YouTube: búsqueda, resultados y el vídeo que se está viendo (reproductor incrustado).
  const B = { q: '', what: 'songs', results: null, loading: false, error: '', watching: null };

  // ------------------------------------------------------------------ pintar
  const coverURLs = new Map();
  const coverSrc = it => {
    if (it.meta?.cover) { if (!coverURLs.has(it)) coverURLs.set(it, URL.createObjectURL(it.meta.cover)); return coverURLs.get(it); }
    return it.raw.thumb || '';
  };
  const fmtDur = s => (s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '');
  const STATE = { wait: 'En cola', run: '', ok: 'Lista', err: 'Error', skip: 'Cancelada' };
  function itemHTML(it, i) {
    const m = it.meta;
    const sub = m ? [m.artists.join(', '), m.album, m.year || ''].filter(Boolean).map(esc).join(' · ') : '<span class="muted">Buscando sus datos…</span>';
    const status = it.st === 'run' ? `<span class="dl-st run">${esc(it.step || 'Descargando…')}</span><span class="dl-bar"><i style="width:${Math.round((it.pct || 0) * 100)}%"></i></span>`
      : it.st ? `<span class="dl-st ${it.st}">${it.st === 'err' ? `Error: ${esc(it.err)}` : STATE[it.st]}</span>` : '';
    const img = coverSrc(it);
    return `<li class="dl-item${it.on ? '' : ' off'}" data-i="${i}">
      <label class="dl-check"><input type="checkbox" data-dl-on="${i}" ${it.on ? 'checked' : ''} ${D.run ? 'disabled' : ''} aria-label="Incluir «${esc(m?.title || it.raw.title)}»"></label>
      <span class="dl-cover${m?.cover ? '' : ' thumb'}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon('disc')}</span>
      <span class="row-text"><b>${esc(m?.title || it.raw.title)}</b><small>${sub}</small>${status}</span>
      <span class="dl-dur">${fmtDur(it.raw.duration)}</span>
      <button class="icon-btn" data-act="dl-edit" data-i="${i}" aria-label="Editar los datos de «${esc(m?.title || it.raw.title)}»" ${m && !D.run ? '' : 'disabled'}>${icon('edit')}</button></li>`;
  }
  function bodyHTML() {
    if (D.busy) return `<div class="panel dl-busy"><span class="spinner"></span>${esc(D.busy)}</div>`;
    let out = D.error ? `<p class="note-box dl-error">${esc(D.error)}</p>` : '';
    if (D.parsed && !D.mode && D.video && D.list) {
      out += `<div class="panel dl-choose"><h2>Esta canción está en una playlist</h2>
        <p>«${esc(D.list.title || 'Playlist')}»${D.list.author ? ` de ${esc(D.list.author)}` : ''}: ${plural(D.list.items.length, 'canción', 'canciones')}${D.list.capped ? ' (se muestran las primeras)' : ''}.</p>
        <div class="dl-options">
          <button class="dl-opt" data-act="dl-mode" data-mode="one">${icon('disc')}<span><b>Solo esta canción</b><small>${esc(D.video.title)}</small></span></button>
          <button class="dl-opt" data-act="dl-mode" data-mode="all">${icon('list')}<span><b>Toda la playlist</b><small>${plural(D.list.items.length, 'canción', 'canciones')}</small></span></button></div></div>`;
      return out;
    }
    if (!D.items.length) return out;
    const sel = D.items.filter(x => x.on).length, done = D.items.filter(x => x.st === 'ok').length;
    const many = D.items.length > 1;
    const target = cloud.uploadTarget();
    out += `<div class="panel dl-list">
      <div class="dl-top"><div><h2>${esc(D.mode === 'all' ? D.list?.title || 'Playlist' : 'Canción')}</h2>
        <small class="muted">${many ? `${sel} de ${D.items.length} seleccionadas · ` : ''}Se guardan en M4A con sus datos y portada; si un vídeo no tiene M4A, en MP3.</small></div>
        ${many && !D.run ? `<button class="chip" data-act="dl-all">${sel === D.items.length ? 'Quitar todas' : 'Elegir todas'}</button>` : ''}</div>
      <ol class="dl-items">${D.items.map(itemHTML).join('')}</ol>
      ${D.run ? `<div class="dl-run"><span>${esc(D.run.label)}</span><button class="btn ghost" data-act="dl-cancel">${icon('x')}Cancelar</button></div>`
        : `<div class="actions dl-actions"><button class="btn primary" data-act="dl-go" data-dest="file" ${sel ? '' : 'disabled'}>${icon('download')}Guardar en el dispositivo</button>
          <button class="btn" data-act="dl-go" data-dest="lib" ${sel ? '' : 'disabled'}>${icon('library')}Añadir a mi biblioteca</button></div>
          <label class="switch dl-opt-sw"${target ? '' : ' hidden'}><input type="checkbox" data-dl-upload ${D.upload ? 'checked' : ''}><span><b>Al añadirlas, subirlas también a la nube</b><small>${target ? `A «${esc(target.name)}».` : ''}</small></span></label>
          ${D.mode === 'all' ? `<label class="switch dl-opt-sw"><input type="checkbox" data-dl-playlist ${D.makePl !== false ? 'checked' : ''}><span><b>Al añadirlas, crear la playlist en Fiora</b><small>Con el nombre «${esc(D.list?.title || 'Playlist')}» (podrás cambiarlo).</small></span></label>` : ''}`}
      ${D.summary ? `<p class="dl-summary">${esc(D.summary)}${done && D.dest === 'lib' ? ' <a class="link" href="#/biblioteca">Ver en la biblioteca</a>' : ''}</p>` : ''}
      ${D.items.some(x => x.st === 'err') && !D.run ? `<div class="actions"><button class="btn sm" data-act="dl-retry">${icon('sync')}Reintentar las que fallaron</button></div>` : ''}</div>`;
    return out;
  }
  function html() {
    const srv = String(S.settings.ytServer || '');
    return `<section class="dl">
      <div class="panel dl-intro"><h2>${icon('download')}Descargar de YouTube</h2>
        <p>Pega el enlace de una canción o de una playlist de YouTube o YouTube Music. Se descarga el audio con su título, artistas, álbum y portada.</p>
        <form class="dl-form" data-form="dl-link"><label class="field">${icon('search')}<input name="url" type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" value="${esc(D.link)}" autocomplete="off" required aria-label="Enlace de YouTube"></label>
          <button class="btn primary" ${D.busy || D.run ? 'disabled' : ''}>Buscar</button></form>
        <small class="muted">Solo para uso personal: respeta los derechos de autor y las condiciones de YouTube.</small></div>
      <div id="dl-body">${bodyHTML()}</div>
      <section class="panel yt-browser"><h2>${icon('search')}Buscar en YouTube</h2>
        <p>Busca canciones, vídeos o playlists, escúchalos aquí y descarga o copia el enlace del que estés viendo.</p>
        <form class="dl-form" data-form="yt-search"><label class="field">${icon('search')}<input name="q" type="search" value="${esc(B.q)}" placeholder="Artista, canción, álbum…" autocomplete="off" required aria-label="Buscar en YouTube" enterkeyhint="search"></label>
          <button class="btn">Buscar</button></form>
        <div class="chips yt-what" role="group" aria-label="Qué buscar">${[['songs', 'Canciones'], ['videos', 'Vídeos'], ['playlists', 'Playlists']].map(([k, l]) => `<button class="chip ${B.what === k ? 'on' : ''}" data-act="yt-what" data-what="${k}" aria-pressed="${B.what === k}">${l}</button>`).join('')}</div>
        <div id="yt-box">${browserHTML()}</div></section>
      <section class="panel"><details class="more flat dl-server"><summary>Servidor de descarga</summary>
        <p>YouTube no deja que una página web descargue su audio, así que Fiora se lo pide a un servidor intermedio: ${srv ? 'primero al tuyo y, si falla, a' : ''} los servidores públicos de Piped, gratuitos pero que a veces no funcionan. Si fallan a menudo, puedes poner la dirección de tu propio servidor de Piped o Invidious. Solo se le envía el identificador del vídeo o de la playlist.</p>
        <form class="stack" data-form="dl-server"><label class="field">${icon('cloud')}<input name="url" type="url" value="${esc(srv)}" placeholder="https://pipedapi.ejemplo.com (opcional)" autocomplete="off"></label>
          <div class="actions"><button class="btn">Guardar y probar</button>${srv ? '<button type="button" class="btn ghost" data-act="dl-server-clear">Quitar</button>' : ''}</div></form></details></section>
    </section>`;
  }
  const paint = () => { const b = $('#dl-body'); if (b) setHTML(b, bodyHTML()); const btn = $('[data-form="dl-link"] button'); if (btn) btn.disabled = !!(D.busy || D.run); };
  // Actualizar una sola fila (progreso) sin repintar la lista entera.
  const paintItem = it => { const i = D.items.indexOf(it), li = $(`.dl-item[data-i="${i}"]`); if (li) li.outerHTML = itemHTML(it, i); };
  const paintRun = () => { const r = $('.dl-run span'); if (r && D.run) r.textContent = D.run.label; };

  // ------------------------------------------------------------ navegador
  function playerHTML() {
    const w = B.watching;
    if (!w) return '';
    const src = `${YT_EMBED}/embed/${encodeURIComponent(w.id)}?autoplay=1&rel=0&playsinline=1&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
    return `<div class="yt-player"><div class="yt-frame"><iframe src="${esc(src)}" title="${esc(w.title || 'Vídeo de YouTube')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
      <div class="yt-now"><span class="row-text"><b data-yt-title>${esc(w.title || '')}</b><small data-yt-url>${esc(yt.watchUrl(w.id))}</small></span>
        <div class="actions"><button class="btn sm" data-act="yt-copy">${icon('note')}Copiar enlace</button><button class="btn sm primary" data-act="yt-download">${icon('download')}Descargar</button><button class="icon-btn" data-act="yt-close" aria-label="Cerrar el vídeo">${icon('x')}</button></div></div></div>`;
  }
  // El reproductor y la lista se pintan por separado: buscar otra cosa no reinicia el vídeo que suena.
  const browserHTML = () => `<div class="yt-player-slot">${playerHTML()}</div><div class="yt-list">${listHTML()}</div>`;
  function listHTML() {
    const out = '';
    if (B.loading) return `<div class="dl-busy"><span class="spinner"></span>Buscando en YouTube…</div>`;
    if (B.error) return `<p class="note-box">${esc(B.error)}</p>`;
    if (!B.results) return out;
    if (!B.results.length) return `<p class="muted">No hay resultados para «${esc(B.q)}».</p>`;
    return `<ol class="yt-results">${B.results.map((r, i) => `<li><button class="yt-res${B.watching?.id === r.id ? ' on' : ''}" data-act="yt-open" data-i="${i}">
        <span class="yt-thumb">${r.thumb ? `<img src="${esc(r.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : icon(r.type === 'playlist' ? 'list' : 'play')}${r.type === 'playlist' ? `<i>${icon('list')}${r.count || ''}</i>` : r.duration ? `<i>${fmtDur(r.duration)}</i>` : ''}</span>
        <span class="row-text"><b>${esc(r.title)}</b><small>${esc(r.uploader.replace(/\s*-\s*Topic$/i, ''))}${r.type === 'playlist' ? ' · Playlist' : ''}</small></span></button></li>`).join('')}</ol>`;
  }
  const paintBrowser = (withPlayer = false) => {
    const l = $('#yt-box .yt-list'), pl = $('#yt-box .yt-player-slot');
    if (l) setHTML(l, listHTML());
    if (pl && withPlayer) setHTML(pl, playerHTML()); $$('.yt-what .chip').forEach(c2 => { const on = c2.dataset.what === B.what; c2.classList.toggle('on', on); c2.setAttribute('aria-pressed', on); }); };
  const $$ = (s2, r = document) => [...r.querySelectorAll(s2)];
  async function ytSearch(q) {
    B.q = q.trim();
    if (!B.q) return;
    B.loading = true; B.error = ''; paintBrowser();
    try {
      // Un enlace pegado en el buscador va directo a la descarga.
      if (/youtu\.?be/.test(B.q)) { B.loading = false; paintBrowser(); return openLink(B.q); }
      B.results = await yt.search(B.q, B.what);
    } catch (e) { B.error = e.message; B.results = null; }
    B.loading = false; paintBrowser();
  }
  function watch(r) {
    B.watching = { id: r.id, title: r.title, uploader: r.uploader };
    if (player.P.current && !player.P.audio.paused) player.pause();   // que no suenen las dos cosas a la vez
    paintBrowser(true);
    const fr = $('.yt-frame iframe');
    // Con la API del reproductor (postMessage), YouTube avisa de qué vídeo se está viendo aunque cambies a otro dentro.
    fr?.addEventListener('load', () => { try { fr.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'fiora', channel: 'widget' }), YT_EMBED); } catch { /* sin API: se queda con el elegido */ } });
    reveal($('.yt-player'));
  }
  addEventListener('message', e => {
    if (e.origin !== YT_EMBED || !B.watching) return;
    let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    const v = d?.info?.videoData;
    if (v?.video_id && /^[\w-]{11}$/.test(v.video_id) && (v.video_id !== B.watching.id || (v.title && v.title !== B.watching.title))) {
      B.watching = { id: v.video_id, title: v.title || B.watching.title, uploader: v.author || '' };
      const t = $('[data-yt-title]'), u = $('[data-yt-url]');
      if (t) t.textContent = B.watching.title; if (u) u.textContent = yt.watchUrl(B.watching.id);
    }
  });
  // Desplaza la pantalla solo en vertical (scrollIntoView también movería en horizontal la vista).
  function reveal(el) {
    const v = $('#view');
    if (!el || !v) return;
    const top = el.getBoundingClientRect().top - v.getBoundingClientRect().top;
    if (top < 0 || top > v.clientHeight * 0.6) v.scrollBy({ top: top - 12, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Enlace copiado'); }
    catch {   // sin permiso para el portapapeles: se muestra para copiarlo a mano
      openSheet(`<div class="dlg"><h3>Enlace del vídeo</h3><label class="field"><input value="${esc(text)}" readonly data-copy-me></label><div class="actions"><button class="btn primary" data-x>Hecho</button></div></div>`, e => { if (e.target.closest('[data-x]')) sheet.close(); });
      setTimeout(() => $('[data-copy-me]')?.select(), 50);
    }
  }
  function openLink(url) {
    const input = $('[data-form="dl-link"] [name=url]');
    if (input) input.value = url;
    lookup(url);
    reveal($('.dl-intro'));
  }

  // -------------------------------------------------------------- metadatos
  function needMeta(it) { if (!it.meta && !it.metaP) { metaQueue.push(it); pumpMeta(); } }
  function pumpMeta() {
    while (metaActive < PARALLEL_META && metaQueue.length) {
      const it = metaQueue.shift();
      if (!D.items.includes(it)) continue;
      metaActive++;
      it.metaP = yt.metadata(it.raw).catch(() => ({ ...yt.cleanMeta(it.raw), album: '', albumArtist: '', year: 0, trackNo: 0, genres: [], cover: null }))
        .then(m => { it.meta = m; paintItem(it); })
        .finally(() => { metaActive--; pumpMeta(); });
    }
  }

  // ---------------------------------------------------------------- buscar
  function reset() {
    for (const u of coverURLs.values()) URL.revokeObjectURL(u);
    coverURLs.clear(); metaQueue = [];
    Object.assign(D, { error: '', parsed: null, video: null, list: null, mode: '', items: [], summary: '', dest: '' });
  }
  async function lookup(text) {
    if (D.run) return;
    reset();
    D.link = text;
    let parsed;
    try { parsed = yt.parseLink(text); } catch (e) { D.error = e.message; return paint(); }
    D.parsed = parsed;
    D.busy = parsed.videoId ? 'Buscando el vídeo…' : 'Leyendo la playlist…';
    paint();
    try {
      const [v, l] = await Promise.all([
        parsed.videoId ? yt.video(parsed.videoId) : null,
        parsed.listId && !yt.isMix(parsed.listId) ? yt.playlist(parsed.listId, n => { if (n) { D.busy = `Leyendo la playlist… (${n})`; paint(); } }).catch(e => (parsed.videoId ? null : Promise.reject(e))) : null,
      ]);
      D.video = v && { id: parsed.videoId, title: v.title, uploader: v.uploader, duration: v.duration, thumb: v.thumb };
      D.list = l;
      if (D.video && !D.list) setMode('one');
      else if (!D.video && D.list) setMode('all');
    } catch (e) { D.error = e.message; }
    D.busy = '';
    paint();
  }
  function setMode(mode) {
    D.mode = mode;
    const raws = mode === 'one' ? [D.video] : D.list.items;
    D.items = raws.map(r => ({ id: r.id, raw: r, meta: null, on: true, st: '', pct: 0 }));
    D.items.forEach(needMeta);
  }

  // -------------------------------------------------------------- descargar
  async function go(dest) {
    const todo = D.items.filter(x => x.on && x.st !== 'ok');
    if (!todo.length || D.run) return;
    const ac = new AbortController();
    D.dest = dest; D.summary = '';
    D.run = { ac, label: '', ok: 0, fail: 0, total: todo.length, files: [] };
    todo.forEach(it => { it.st = 'wait'; it.err = ''; it.pct = 0; });
    paint();
    const label = () => { D.run.label = `${D.run.ok + D.run.fail} de ${D.run.total}${D.run.fail ? ` · ${D.run.fail} con error` : ''}`; paintRun(); };
    label();
    const queue = todo.slice();
    const worker = async () => {
      for (let it; (it = queue.shift());) {
        if (ac.signal.aborted) { it.st = 'skip'; continue; }
        it.st = 'run'; it.step = 'Buscando sus datos…'; paintItem(it);
        try {
          if (!it.meta) await (it.metaP || (needMeta(it), it.metaP));
          let last = 0;
          const file = await yt.downloadSong(it.id, it.meta, { signal: ac.signal, onStep: (step, p) => { it.step = step; it.pct = p; const now = Date.now(); if (now - last > 150 || p === 1) { last = now; paintItem(it); } } });
          await deliver(it, file, dest);
          it.st = 'ok'; D.run.ok++;
        } catch (e) {
          if (e?.name === 'AbortError') it.st = 'skip';
          else { it.st = 'err'; it.err = e.message || 'no se pudo descargar'; D.run.fail++; }
        }
        paintItem(it); label();
      }
    };
    await Promise.all([...Array(Math.min(PARALLEL_DL, todo.length))].map(worker));
    const r = D.run;
    D.run = null;
    if (dest === 'lib' && r.files.length) await afterLibrary(r.files);
    D.summary = ac.signal.aborted ? `Cancelado: ${plural(r.ok, 'canción descargada', 'canciones descargadas')}.`
      : `${r.ok ? `${plural(r.ok, 'canción', 'canciones')} ${dest === 'lib' ? (r.ok === 1 ? 'añadida a tu biblioteca' : 'añadidas a tu biblioteca') : (r.ok === 1 ? 'guardada en el dispositivo' : 'guardadas en el dispositivo')}` : 'No se ha descargado ninguna'}${r.fail ? ` · ${r.fail} con error` : ''}.`;
    paint();
  }
  async function deliver(it, file, dest) {
    if (dest === 'file') {
      // Las descargas van de una en una, con un pequeño respiro: así el navegador no las bloquea.
      deliverChain = deliverChain.then(() => c.saveFile(file, { done() {}, set() {} })).then(() => new Promise(r => setTimeout(r, 400)));
      await deliverChain;
      return;
    }
    it.step = 'Añadiendo a la biblioteca…'; paintItem(it);
    const res = await lib.importFiles([file]);
    if (res.failed) throw new Error('No se pudo guardar en este dispositivo (¿sin espacio?)');
    D.run.files.push({ id: trackId(file.size, file.name), it });
  }
  let deliverChain = Promise.resolve();
  async function afterLibrary(files) {
    const tracks = files.map(f => S.tracks.get(f.id)).filter(Boolean);
    if (!tracks.length) return;
    if (D.mode === 'all' && D.makePl !== false && tracks.length > 1) {
      const order = D.items.filter(x => files.some(f => f.it === x)).map(x => files.find(f => f.it === x).id);
      const p = await c.PL.newPlaylist(order.map(id => S.tracks.get(id)).filter(Boolean), D.list?.title || '');
      if (p) c.emit('playlists');
    }
    if (D.upload && cloud.uploadTarget()) c.uploadTo(tracks);
  }

  // ------------------------------------------------------------------ editar
  function edit(i) {
    const it = D.items[i], m = it?.meta;
    if (!m) return;
    openSheet(`<form class="dlg dl-edit" method="dialog"><h3>Datos de la canción</h3>
      <label class="lbl">Título<span class="field"><input name="title" value="${esc(m.title)}" required></span></label>
      <label class="lbl">Artistas<span class="field"><input name="artists" value="${esc(m.artists.join(', '))}" required></span><small>Separados por comas.</small></label>
      <label class="lbl">Álbum<span class="field"><input name="album" value="${esc(m.album)}"></span></label>
      <label class="lbl">Año<span class="field"><input name="year" type="number" min="1900" max="2100" value="${m.year || ''}"></span></label>
      <div class="actions"><button type="button" class="btn ghost" data-x>Cancelar</button><button class="btn primary">Guardar</button></div></form>`,
    e => { if (e.target.closest('[data-x]')) sheet.close(); });
    const form = $('form', sheet);
    form.onsubmit = () => {
      const artists = form.artists.value.split(',').map(s => s.trim()).filter(Boolean);
      it.meta = { ...m, title: form.title.value.trim() || m.title, artists: artists.length ? artists : m.artists, album: form.album.value.trim(), year: +form.year.value || 0 };
      if (it.meta.album !== m.album) it.meta.albumArtist = it.meta.album ? it.meta.artists[0] : '';
      paintItem(it);
    };
  }

  // ---------------------------------------------------------------- acciones
  const actions = {
    'dl-mode'(el) { setMode(el.dataset.mode); paint(); },
    'dl-all'() { const all = D.items.every(x => x.on); D.items.forEach(x => { x.on = !all; }); paint(); },
    'dl-go'(el) { go(el.dataset.dest); },
    'dl-cancel'() { D.run?.ac.abort(); },
    'dl-retry'() { D.items.forEach(x => { x.on = x.st === 'err'; }); go(D.dest || 'file'); },
    'dl-edit'(el) { edit(+el.dataset.i); },
    'yt-what'(el) { B.what = el.dataset.what; if (B.q) ytSearch(B.q); else paintBrowser(); },
    'yt-open'(el) { const r = B.results?.[+el.dataset.i]; if (!r) return; if (r.type === 'playlist') return openLink(yt.listUrl(r.id)); watch(r); },
    'yt-copy'() { if (B.watching) copy(yt.watchUrl(B.watching.id)); },
    'yt-download'() { if (B.watching) openLink(yt.watchUrl(B.watching.id)); },
    'yt-close'() { B.watching = null; paintBrowser(true); },
    async 'dl-server-clear'() { S.settings.ytServer = ''; S.settings.ytServerAt = Date.now(); await saveKV('settings', false); c.emit('dirty'); toast('Servidor propio quitado'); c.refresh(); },
  };
  const forms = {
    'dl-link'(form) { lookup(form.url.value); },
    'yt-search'(form) { ytSearch(form.q.value); },
    async 'dl-server'(form) {
      const url = form.url.value.trim().replace(/\/+$/, '');
      if (!url) return actions['dl-server-clear']();
      const t = toast('Probando el servidor…', 0);
      try {
        const kind = await yt.testServer(url);
        S.settings.ytServer = url; S.settings.ytServerAt = Date.now();
        await saveKV('settings', false); c.emit('dirty');
        t.done(`Servidor guardado (${kind === 'piped' ? 'Piped' : 'Invidious'}): se usará primero`, 5000);
        c.refresh();
      } catch (e) { t.done(e.message, 8000); }
    },
  };
  document.addEventListener('change', e => {
    const on = e.target.closest?.('[data-dl-on]');
    if (on) { const it = D.items[+on.dataset.dlOn]; if (it) { it.on = on.checked; paint(); } }
    if (e.target.matches?.('[data-dl-upload]')) D.upload = e.target.checked;
    if (e.target.matches?.('[data-dl-playlist]')) D.makePl = e.target.checked;
  });
  // Al pegar un enlace se busca directamente.
  document.addEventListener('paste', e => {
    const input = e.target.closest?.('[data-form="dl-link"] [name=url]');
    if (!input) return;
    setTimeout(() => { if (/youtu/.test(input.value)) lookup(input.value); }, 0);
  });
  return { html, actions, forms, busy: () => !!D.run };
}
