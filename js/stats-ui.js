// Estadísticas de Perfil por pestañas: Resumen (las de siempre), Tiempo, Gustos, Biblioteca y
// Conexiones, y el «Resumen del mes». Los números salen de stats-extra.js; aquí solo se pintan.
// Los gráficos son HTML y SVG propios, con una tabla «Ver los datos» como alternativa.
import { S, everyTrack as allTracks, artistsOf, isFav, dayKey } from './store.js';
import * as habits from './habits.js';
import * as rdata from './radio-data.js';
import * as lib from './library.js';
import * as player from './player.js';
import { countryName } from './radio.js';
import * as X from './stats-extra.js';
import * as CD from './creature-data.js';
import * as C from './creature.js';
import { icon } from './icons.js';

const $ = (s, r = document) => r.querySelector(s);
const TABS = [['resumen', 'Resumen'], ['tiempo', 'Tiempo'], ['gustos', 'Gustos'], ['biblioteca', 'Biblioteca'], ['conexiones', 'Conexiones']];
const KEY = 'fiora.stats.tab';
const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const color = g => (g === 'Otros' ? 'var(--muted)' : `hsl(${hue(g)} 62% 56%)`);
const fmtDay = k => new Date(`${k}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonth = k => new Date(`${k}-15T12:00:00`).toLocaleDateString('es', { month: 'long', year: 'numeric' });
const mins = m => (m >= 120 ? `${(m / 60).toLocaleString('es', { maximumFractionDigits: 1 })} h` : `${m} min`);
const pct = v => `${Math.round(v * 100)} %`;

export function initStats(c) {
  const { esc, plural, num, bars, rows, toast, openSheet, sheet, refresh, ACTIONS, statsBody, deliver } = c;
  let tab = 'resumen', node = '';
  try { tab = localStorage.getItem(KEY) || 'resumen'; } catch { /* sin almacenamiento */ }
  if (!TABS.some(t => t[0] === tab)) tab = 'resumen';

  const panel = (title, text, body, cls = '') => `<section class="panel sx-panel ${cls}"><h2>${title}</h2>${text ? `<p>${text}</p>` : ''}${body}</section>`;
  const none = text => `<p class="chart-note">${text}</p>`;
  const tile = (value, label, sub = '') => `<div class="stat"><b title="${esc(String(value))}">${esc(String(value))}</b><small>${label}</small>${sub ? `<small class="stat-sub">${sub}</small>` : ''}</div>`;
  const table = rws => `<details class="glist"><summary>Ver los datos</summary><table class="data">${rws.map(r => `<tr><td>${esc(String(r[0]))}</td><td>${esc(String(r[1]))}</td></tr>`).join('')}</table></details>`;
  const delta = (n, unit) => (n === 0 ? 'igual que la semana anterior' : `<span class="${n > 0 ? 'up' : 'down'}">${n > 0 ? '▲' : '▼'} ${num(Math.abs(n))}${unit}</span> frente a la anterior`);
  const title = t => `${t.title}${t.artist ? ` — ${t.artist}` : ''}`;

  // ============================================================ Tiempo y ritmo
  function tabTime() {
    const h = X.heatmap(S.hist.days), st = X.streaks(S.hist.days), wk = X.weekCompare(S.hist.days), ses = X.sessionsHist(habits.H.days);
    const plays = Object.values(S.stats).reduce((n, s) => n + (s.plays || 0), 0), ms = X.milestones(plays);
    const heat = `<div class="heat-scroll" data-heat><div class="heat" role="img" aria-label="Minutos de música de cada día del último año">${h.cols.map(col => col.map(d =>
      (d ? `<i class="h${d.level}" tabindex="0" data-day="${d.key}" data-tip="${esc(`${fmtDay(d.key)} · ${d.plays ? `${d.min} min · ${plural(d.plays, 'canción', 'canciones')}` : 'sin música'}`)}"></i>` : '<i class="hx"></i>')).join('')).join('')}</div></div>
      <div class="heat-legend"><span>${fmtDay(h.from)}</span><span class="heat-scale">menos <i class="h0"></i><i class="h1"></i><i class="h2"></i><i class="h3"></i><i class="h4"></i> más</span><span>hoy</span></div>`;
    const hours = S.hist.hours, hmax = Math.max(1, ...hours), peak = hours.indexOf(Math.max(...hours));
    const wedge = (i, v) => {
      const a0 = (i / 24) * 2 * Math.PI - Math.PI / 2 + 0.02, a1 = ((i + 1) / 24) * 2 * Math.PI - Math.PI / 2 - 0.02, r0 = 34, r1 = 36 + (v / hmax) * 58;
      const p = (r, a) => `${(100 + r * Math.cos(a)).toFixed(1)} ${(100 + r * Math.sin(a)).toFixed(1)}`;
      return `<path class="${i === peak && v ? 'peak' : ''}" tabindex="0" data-tip="${i}:00–${i + 1}:00 · ${plural(v, 'escucha', 'escuchas')}" d="M${p(r0, a0)} L${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z"/>`;
    };
    const clock = hours.some(Boolean)
      ? `<div class="clock"><svg viewBox="0 0 200 200" role="img" aria-label="Escuchas por hora del día en forma de reloj">${hours.map((v, i) => wedge(i, v)).join('')}
          <text x="100" y="97" class="clock-big">${peak}:00</text><text x="100" y="112" class="clock-sub">hora punta</text>
          <text x="100" y="9" class="clock-tick">0</text><text x="194" y="103" class="clock-tick">6</text><text x="100" y="198" class="clock-tick">12</text><text x="6" y="103" class="clock-tick">18</text></svg></div>${table(hours.map((v, i) => [`${i}:00`, `${num(v)} escuchas`]))}`
      : none('Aparecerá cuando haya escuchas.');
    const smax = Math.max(1, ...ses.bins.map(b => b.n));
    return `<div class="stat-row tiles">
        ${tile(`${num(wk.cur.min)} min`, 'últimos 7 días', delta(wk.delta.min, ' min'))}
        ${tile(num(wk.cur.plays), 'canciones esta semana', delta(wk.delta.plays, ''))}
        ${tile(`${wk.cur.days} de 7`, 'días con música', delta(wk.delta.days, ''))}
      </div>
      ${panel('Tu año en música', `${plural(h.active, 'día', 'días')} con música y ${mins(h.total)} en las últimas ${h.cols.length} semanas. Cada cuadro es un día; toca uno para ver sus datos.`, heat, 'sx-heat')}
      <div class="two-panels">
        ${panel('Reloj de escucha', 'Tus escuchas repartidas en las 24 horas.', clock)}
        ${panel('Rachas y récords', '', `<div class="stat-row">
          ${tile(st.current ? plural(st.current, 'día', 'días') : '—', 'racha actual')}
          ${tile(st.longest ? plural(st.longest, 'día', 'días') : '—', 'racha más larga', st.longestEnd ? `hasta el ${fmtDay(st.longestEnd)}` : '')}
          ${st.best ? `<div class="stat wide"><b>${mins(st.best.min)}</b><small>tu día con más música</small><small class="stat-sub">${fmtDay(st.best.key)} · ${plural(st.best.plays, 'canción', 'canciones')}</small></div>` : ''}
          <div class="stat wide"><b>${ms.last ? `${num(ms.last)} escuchas` : 'Primeros pasos'}</b><small>${ms.next ? `siguiente hito: ${num(ms.next)} (llevas ${num(plays)})` : 'has superado todos los hitos'}</small>
            <div class="meter"><i style="width:${(ms.progress * 100).toFixed(0)}%"></i></div></div></div>`)}
      </div>
      ${panel('Tus sesiones', ses.count ? `${plural(ses.count, 'sesión', 'sesiones')} · duración media ${mins(ses.mean)} · la más larga, ${mins(ses.longest)} el ${fmtDay(ses.longestDay)}. Una sesión termina tras 20 minutos sin música.` : '',
        ses.count ? `<ol class="hbars">${ses.bins.map(b => `<li><span class="hb-label"><b>${b.label}</b></span><span class="hb-track"><i style="width:${((b.n / smax) * 100).toFixed(1)}%"></i></span><span class="hb-val">${num(b.n)}</span></li>`).join('')}</ol>`
          : none(habits.enabled() ? 'Las sesiones empiezan a contarse desde ahora: aparecerán cuando escuches un rato.' : 'Las sesiones se cuentan con el resumen diario de la criatura sonora, que está desactivada (Ajustes → Tu criatura sonora).'))}`;
  }

  // =================================================================== Gustos
  function tabTaste() {
    const tracks = allTracks(), st = t => S.stats[t.id] || {};
    const dec = X.decades(tracks.map(t => ({ year: t.year, plays: st(t).plays || 0 })));
    const mood = X.moodByPart(tracks.map(t => ({ moods: t.moods, h: st(t).h })));
    const river = X.genreRiver(habits.H.days);
    const artists = new Map();
    for (const t of tracks) { const n = st(t).plays; if (n) for (const a of artistsOf(t)) artists.set(a, (artists.get(a) || 0) + n); }
    const con = X.concentration([...artists]);
    const mmax = Math.max(0.0001, ...mood.matrix.flat());
    const decHtml = dec.list.length
      ? `${bars(dec.list.map(([d, n]) => [`Años ${d}`, n]))}`
      : none('Tus canciones escuchadas no tienen año en sus etiquetas.');
    const moodHtml = mood.moods.length && mood.tagged >= 10
      ? `<div class="mood-grid" style="--n:${mood.moods.length}" role="img" aria-label="Ambiente de lo que escuchas en cada franja del día"><span></span>${mood.moods.map(m => `<b>${esc(m)}</b>`).join('')}
          ${X.PARTS.map((p, i) => `<b class="mg-row">${p}</b>${mood.matrix[i].map((v, j) => `<i tabindex="0" style="--v:${(v / mmax).toFixed(3)}" data-tip="${esc(`${p} · ${mood.moods[j]} · ${pct(v)} de las escuchas etiquetadas`)}"></i>`).join('')}`).join('')}</div>
         ${table(X.PARTS.flatMap((p, i) => mood.moods.map((m, j) => [`${p} · ${m}`, pct(mood.matrix[i][j])])))}`
      : none('Hace falta que las canciones tengan etiquetas de «lo que transmite» (se añaden en el modo desarrollador, a mano o con IA).');
    const phrase = mood.top.map((m, i) => (m ? `tus ${['madrugadas', 'mañanas', 'tardes', 'noches'][i]} suenan a música ${m}` : '')).filter(Boolean);
    let riverHtml = none(habits.enabled() ? 'El río se dibuja con el resumen diario: necesita al menos dos semanas con canciones etiquetadas con género.' : 'Necesita el resumen diario de la criatura sonora, que está desactivada.');
    if (river.weeksWithData >= 2 && river.genres.length) {
      const W = 600, Hh = 170, n = river.labels.length, tot = river.labels.map((_, w) => river.series.reduce((a, s2) => a + s2[w], 0)), max = Math.max(1, ...tot);
      const xs = i => (i / (n - 1)) * W, base = Array(n).fill(0);
      const bands = river.series.map((s2, gi) => {
        const lo = base.slice(); s2.forEach((v, i) => { base[i] += v; });
        const y = (v, i) => Hh / 2 + ((v - tot[i] / 2) / max) * (Hh - 12);
        const up = base.map((v, i) => `${xs(i).toFixed(1)},${y(v, i).toFixed(1)}`), down = lo.map((v, i) => `${xs(i).toFixed(1)},${y(v, i).toFixed(1)}`).reverse();
        return `<polygon points="${[...up, ...down].join(' ')}" fill="${color(river.genres[gi])}"><title>${esc(river.genres[gi])}</title></polygon>`;
      }).join('');
      riverHtml = `<svg class="river" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="Géneros que escuchas semana a semana">${bands}</svg>
        <div class="cols-x"><span>${fmtDay(river.labels[0])}</span><span>esta semana</span></div>
        <div class="sx-legend">${river.genres.map(g => `<span><i style="background:${color(g)}"></i>${esc(g)}</span>`).join('')}</div>
        ${table(river.genres.map((g, i) => [g, `${num(river.series[i].reduce((a, v) => a + v, 0))} escuchas`]))}`;
    }
    const tm = X.treemap([...con.top, ...(con.rest > 0 ? [['Los demás', con.rest]] : [])]);
    const conHtml = con.total
      ? `<div class="treemap" role="img" aria-label="Peso de cada artista en tus escuchas">${tm.map((b, i) => `<div tabindex="0" class="${b.name === 'Los demás' ? 'rest' : ''}" style="left:${b.x.toFixed(2)}%;top:${b.y.toFixed(2)}%;width:${b.w.toFixed(2)}%;height:${b.h.toFixed(2)}%;--k:${(1 - i / tm.length).toFixed(2)}" data-tip="${esc(`${b.name} · ${num(b.value)} escuchas · ${pct(b.value / con.total)}`)}"><span>${esc(b.name)}</span></div>`).join('')}</div>
         ${table(con.top.map(([a, n]) => [a, `${num(n)} · ${pct(n / con.total)}`]))}`
      : none('Aparecerá cuando haya escuchas.');
    return `${panel('Máquina del tiempo', dec.mean ? `El año medio de tu música es <b>${dec.mean}</b>${dec.top != null ? `, y tu década más escuchada, los ${dec.top}` : ''}.${dec.noYear ? ` ${plural(dec.noYear, 'escucha', 'escuchas')} de canciones sin año no ${dec.noYear === 1 ? 'cuenta' : 'cuentan'}.` : ''}` : '', decHtml)}
      ${panel('A qué suenan tus horas', phrase.length ? `${phrase[0][0].toUpperCase()}${phrase.join('; ').slice(1)}.` : 'Lo que transmite tu música en cada franja del día.', moodHtml)}
      ${panel('Río de géneros', 'Cómo cambian tus géneros semana a semana (últimas 12 semanas).', riverHtml)}
      ${panel('Concentración', con.total ? `Tus ${Math.min(10, con.count)} artistas más escuchados son el <b>${pct(con.top10)}</b> de tus escuchas, repartidas entre ${plural(con.count, 'artista', 'artistas')}.` : '', conHtml)}`;
  }

  // =============================================================== Biblioteca
  function tabLibrary() {
    const tracks = allTracks(), st = t => S.stats[t.id] || {};
    const ex = X.explored(tracks.map(t => ({ plays: st(t).plays || 0, album: t.album ? lib.albumKey(t) : '' })));
    const forgot = X.forgottenFavs(tracks.map(t => ({ id: t.id, fav: isFav(t.id), last: st(t).last || 0, plays: st(t).plays || 0 })));
    const sk = X.skipLists(tracks.map(t => ({ id: t.id, plays: st(t).plays || 0, done: st(t).done || 0, skips: st(t).skips || 0 })));
    const gr = X.growth(tracks.map(t => t.addedAt), Object.values(S.favs).filter(f => f.on).map(f => f.at));
    const R = 52, circ = 2 * Math.PI * R;
    const ring = `<div class="ring-row"><svg class="sx-ring" viewBox="0 0 120 120" role="img" aria-label="${pct(ex.share)} de tu biblioteca escuchada"><circle cx="60" cy="60" r="${R}" class="ring-bg"/><circle cx="60" cy="60" r="${R}" class="ring-fg" stroke-dasharray="${(circ * ex.share).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 60 60)"/><text x="60" y="66">${pct(ex.share)}</text></svg>
      <div class="stat-row">${tile(`${num(ex.heard)} de ${num(ex.total)}`, 'canciones escuchadas alguna vez')}${tile(num(ex.total - ex.heard), 'por descubrir')}${ex.albums ? `<div class="stat wide"><b>${num(ex.albumsDone)} de ${num(ex.albums)}</b><small>álbumes escuchados enteros</small></div>` : ''}</div></div>`;
    const list = (items, fmt) => `<ol class="sx-list">${items.map(x => { const t = S.tracks.get(x.id); return t ? `<li><span><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></span><em>${fmt(x)}</em></li>` : ''; }).join('')}</ol>`;
    const ftracks = forgot.map(f => S.tracks.get(f.id)).filter(Boolean);
    const max = Math.max(1, ...gr.map(g => g.lib)), W = 600, Hh = 150;
    const line = k => gr.map((g, i) => `${((i / (gr.length - 1)) * W).toFixed(1)},${(Hh - 6 - (g[k] / max) * (Hh - 16)).toFixed(1)}`).join(' ');
    const grew = gr[gr.length - 1].lib - gr[0].lib;
    return `${panel('Cuánto has explorado', '', ex.total ? ring : none('Tu biblioteca está vacía.'))}
      ${panel('Favoritas olvidadas', ftracks.length ? `${plural(ftracks.length, 'canción que te gusta lleva', 'canciones que te gustan llevan')} más de 90 días sin sonar.` : '',
        ftracks.length ? `<div class="actions" style="margin-bottom:10px"><button class="btn primary" data-act="sx-play-forgotten">${icon('play')}Reproducir todas</button></div>${rows(ftracks.slice(0, 30))}`
          : none(Object.values(S.favs).some(f => f.on) ? 'Ninguna: todas tus favoritas han sonado en los últimos 90 días.' : 'Marca canciones con el corazón y aquí verás las que llevas tiempo sin escuchar.'), 'sx-forgot')}
      <div class="two-panels">
        ${panel('Nunca las saltas', 'Las que más veces escuchas hasta el final (con 5 intentos o más).', sk.never.length ? list(sk.never, x => pct(x.done)) : none('Todavía no hay canciones con escuchas suficientes.'))}
        ${panel('Siempre las saltas', 'Las que más veces pasas nada más empezar.', sk.always.length ? list(sk.always, x => pct(x.skip)) : none('No hay ninguna canción que saltes la mitad de las veces o más.'))}
      </div>
      ${panel('Crecimiento', ex.total ? `${grew > 0 ? `${plural(grew, 'canción más', 'canciones más')} que hace un año` : 'Sin cambios en el último año'} · ${plural(gr[gr.length - 1].favs, 'favorita', 'favoritas')}.` : '',
        ex.total ? `<svg class="growth" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="Canciones y favoritas acumuladas en los últimos 12 meses"><polyline class="g-lib" points="${line('lib')}"/><polyline class="g-fav" points="${line('favs')}"/></svg>
          <div class="cols-x"><span>${fmtMonth(gr[0].key)}</span><span>${fmtMonth(gr[gr.length - 1].key)}</span></div>
          <div class="sx-legend"><span><i class="g-lib"></i>Canciones en la biblioteca</span><span><i class="g-fav"></i>Favoritas</span></div>
          ${table(gr.map(g => [fmtMonth(g.key), `${num(g.lib)} canciones · ${num(g.favs)} favoritas`]))}` : none('Aparecerá cuando añadas música.'))}`;
  }

  // =============================================================== Conexiones
  function tabLinks() {
    const known = new Set(S.tracks.keys()), tr = X.transitions(S.trans, 25, known), nodes = tr.nodes.slice(0, 14), idx = new Map(nodes.map((n, i) => [n.id, i]));
    let net = none('Aparecerá cuando hayas puesto varias veces las mismas canciones seguidas (al menos dos veces cada pareja).');
    if (nodes.length >= 2) {
      if (!idx.has(node)) node = '';
      const pos = i => { const a = (i / nodes.length) * 2 * Math.PI - Math.PI / 2; return [160 + 118 * Math.cos(a), 160 + 118 * Math.sin(a)]; };
      const wmax = Math.max(...tr.pairs.map(p => p.n)), nmax = Math.max(...nodes.map(n => n.w));
      const lines = tr.pairs.filter(p => idx.has(p.a) && idx.has(p.b)).map(p => { const [x1, y1] = pos(idx.get(p.a)), [x2, y2] = pos(idx.get(p.b)), on2 = node && (p.a === node || p.b === node);
        return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-width="${(1 + (p.n / wmax) * 5).toFixed(1)}" class="${on2 ? 'on' : node ? 'dim' : ''}"/>`; }).join('');
      const dots = nodes.map((n, i) => { const [x, y] = pos(i), t = S.tracks.get(n.id);
        return `<g class="net-node${n.id === node ? ' on' : ''}" data-act="sx-node" data-id="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(title(t))}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(11 + (n.w / nmax) * 9).toFixed(1)}" style="fill:hsl(${hue(t.artist || t.title)} 60% 52%)"/><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}">${i + 1}</text></g>`; }).join('');
      const comp = node ? X.companions(S.trans, node).filter(x => S.tracks.has(x.id)) : [];
      net = `<div class="net-wrap"><svg class="net" viewBox="0 0 320 320" role="img" aria-label="Red de canciones que sueles poner seguidas">${lines}${dots}</svg>
        <ol class="net-list">${nodes.map((n, i) => { const t = S.tracks.get(n.id); return `<li><button class="${n.id === node ? 'on' : ''}" data-act="sx-node" data-id="${esc(n.id)}"><i style="background:hsl(${hue(t.artist || t.title)} 60% 52%)">${i + 1}</i><span><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></span></button></li>`; }).join('')}</ol></div>
        ${node ? `<h3 class="sx-sub" data-sx-companions>Suenan junto a «${esc(S.tracks.get(node).title)}»</h3>${comp.length ? rows(comp.map(x => S.tracks.get(x.id))) : none('Sin compañeras conocidas.')}` : '<p class="muted">Toca una canción para ver cuáles suelen sonar junto a ella.</p>'}`;
    }
    const stamps = rdata.passport(), mins2 = X.radioCountries(habits.H.days), minOf = new Map(mins2.map(x => [x.cc, x.min]));
    const ccs = [...new Set([...stamps.map(s2 => s2.cc), ...mins2.map(x => x.cc)])];
    const map = ccs.length
      ? `<div class="sx-map" data-sx-map></div><ul class="sx-countries">${ccs.sort((a, b) => (minOf.get(b) || 0) - (minOf.get(a) || 0)).map(cc => `<li><b>${esc(countryName(cc) || cc)}</b><small>${minOf.has(cc) ? `${mins(minOf.get(cc))} de radio` : 'en tu pasaporte'}</small></li>`).join('')}</ul>`
      : none('Escucha emisoras de radio en Explorar y aquí verás los países por los que has pasado.');
    return `${panel('Qué suena después de qué', nodes.length >= 2 ? 'Las canciones que más veces pones seguidas. Cuanto más gruesa la línea, más veces han sonado juntas.' : '', net, 'sx-net')}
      ${panel('Mapa de radios', ccs.length ? `Emisoras de ${plural(ccs.length, 'país', 'países')}. Los minutos se cuentan desde que existe el resumen diario.` : '', map)}`;
  }

  // ======================================================== sección de Perfil
  function section(d) {
    const body = !d.plays && tab === 'resumen' ? '' : tab === 'tiempo' ? tabTime() : tab === 'gustos' ? tabTaste() : tab === 'biblioteca' ? tabLibrary() : tab === 'conexiones' ? tabLinks() : statsBody(d);
    return `<div class="sx-head"><h2 id="pf-stats">Mis estadísticas</h2>${X.monthsWithData(S.hist.days).length ? `<button class="btn sm" data-act="sx-recap">${icon('star')}Resumen del mes</button>` : ''}</div>
      <nav class="sx-tabs" aria-label="Estadísticas">${TABS.map(([id, label]) => `<button class="${id === tab ? 'on' : ''}" data-act="sx-tab" data-t="${id}" aria-pressed="${id === tab}">${label}</button>`).join('')}</nav>
      <div class="sx-body" data-sx-tab="${tab}">${body || c.empty('chart', 'Aún no hay escuchas', 'Pon música un rato y aquí verás cuánto escuchas, cuándo y qué.')}</div>`;
  }
  /** Después de pintar: coloca el calendario en hoy y carga el mapa. */
  function after() {
    const h = $('[data-heat]'); if (h) h.scrollLeft = h.scrollWidth;
    const box = $('[data-sx-map]');
    if (box) import('./atlas.js').then(m => { if (box.isConnected) m.mountPassport(box, { visited: new Set([...rdata.passport().map(s2 => s2.cc), ...X.radioCountries(habits.H.days).map(x => x.cc)]) }); }).catch(() => { box.remove(); });
  }

  // ========================================================== resumen del mes
  function recapCards(month) {
    const r = X.monthRecap(S.hist.days, habits.H.days, month), now = dayKey().slice(0, 7);
    const tracks = allTracks().filter(t => S.stats[t.id]?.plays).sort((a, b) => S.stats[b.id].plays - S.stats[a.id].plays);
    const artists = new Map(); for (const t of tracks) for (const a of artistsOf(t)) artists.set(a, (artists.get(a) || 0) + S.stats[t.id].plays);
    const topA = [...artists].sort((a, b) => b[1] - a[1])[0];
    const entry = habits.H.log[month], animal = entry && C.animal(entry.a), off = month === now && CD.official().official, cur = animal || (off && C.animal(off.a));
    return [
      { kind: fmtMonth(month), big: mins(r.min), text: `de música en ${plural(r.days, 'día', 'días')} de ${r.daysInMonth}`, sub: `${plural(r.plays, 'canción escuchada', 'canciones escuchadas')}` },
      r.best && { kind: 'Tu día récord', big: new Date(`${r.best.key}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long' }), text: `${mins(r.best.min)} y ${plural(r.best.plays, 'canción', 'canciones')}`, sub: '' },
      tracks[0] && { kind: 'Tu canción de siempre', big: tracks[0].title, text: tracks[0].artist || '', sub: `${S.stats[tracks[0].id].plays} escuchas en total (las escuchas por canción no se guardan por mes)` },
      topA && { kind: 'Tu artista de siempre', big: topA[0], text: `${topA[1]} escuchas en total`, sub: '' },
      (r.genre || r.sessions || r.newTracks) && { kind: 'Así fue el mes', big: r.genre || `${r.sessions} sesiones`, text: [r.genre && 'tu género principal', r.newTracks && plural(r.newTracks, 'canción nueva', 'canciones nuevas'), r.sessions && `sesión más larga: ${mins(r.longest)}`, r.radioMin && `${mins(r.radioMin)} de radio`].filter(Boolean).join(' · '), sub: '' },
      cur && { kind: 'Tu criatura', big: cur.name, text: cur.sub, sub: cur.text, color: cur.look.colors[0] },
    ].filter(Boolean);
  }
  function recapImage(month, cards) {
    const cv = Object.assign(document.createElement('canvas'), { width: 1080, height: 1350 }), g = cv.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 1080, 1350); bg.addColorStop(0, '#241a2e'); bg.addColorStop(1, '#0b0a12'); g.fillStyle = bg; g.fillRect(0, 0, 1080, 1350);
    g.textAlign = 'center'; g.fillStyle = '#a39db3'; g.font = '600 30px system-ui, sans-serif'; g.fillText(`FIORA · ${fmtMonth(month).toUpperCase()}`, 540, 84);
    const fit = (text, size, weight, maxW) => { do { g.font = `${weight} ${size}px system-ui, sans-serif`; size -= 4; } while (g.measureText(text).width > maxW && size > 24); };
    let y = 190; const step = (1350 - 230) / cards.length;
    for (const cd of cards) {
      g.fillStyle = '#a39db3'; g.font = '600 26px system-ui, sans-serif'; g.fillText(cd.kind.toUpperCase(), 540, y);
      g.fillStyle = cd.color || '#ff8f63'; fit(cd.big, 72, 800, 960); g.fillText(cd.big, 540, y + 74);
      g.fillStyle = '#d9d3e6'; fit(cd.text, 32, 400, 960); if (cd.text) g.fillText(cd.text, 540, y + 122);
      y += step;
    }
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }
  function openRecap(month) {
    const months = X.monthsWithData(S.hist.days);
    if (!months.length) return toast('Todavía no hay ningún mes con escuchas');
    month = months.includes(month) ? month : months[0];
    const cards = recapCards(month);
    openSheet(`<div class="dlg recap" data-month="${month}"><div class="recap-head"><h3>Resumen del mes</h3>
        <label class="field sm"><select data-recap-month aria-label="Mes">${months.map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${fmtMonth(m)}</option>`).join('')}</select></label></div>
      <div class="recap-cards" tabindex="0" aria-label="Tarjetas del resumen: desliza para verlas">${cards.map((cd, i) => `<article class="recap-card" style="${cd.color ? `--rc:${cd.color}` : ''}"><small>${esc(cd.kind)}</small><b>${esc(cd.big)}</b><span>${esc(cd.text)}</span>${cd.sub ? `<em>${esc(cd.sub)}</em>` : ''}<i>${i + 1} / ${cards.length}</i></article>`).join('')}</div>
      <div class="actions"><button class="btn ghost" data-x>Cerrar</button><button class="btn primary" data-ok>${icon('download')}Guardar como imagen</button></div>
      <small class="muted">La imagen se crea en este dispositivo; no se sube a ningún sitio.</small></div>`,
    async e => {
      if (e.target.closest('[data-x]')) return sheet.close();
      if (e.target.closest('[data-ok]')) { const blob = await recapImage(month, cards); if (blob) deliver(blob, `fiora-${month}.png`); }
    });
    $('[data-recap-month]', sheet)?.addEventListener('change', e => openRecap(e.target.value));
  }

  Object.assign(ACTIONS, {
    'sx-tab'(el) { tab = el.dataset.t; try { localStorage.setItem(KEY, tab); } catch { /* nada */ } refresh(); },
    'sx-node'(el) { node = node === el.dataset.id ? '' : el.dataset.id; refresh(); },
    'sx-recap'() { openRecap(); },
    'sx-play-forgotten'() {
      const ids = X.forgottenFavs(allTracks().map(t => ({ id: t.id, fav: isFav(t.id), last: S.stats[t.id]?.last || 0 })));
      const list = ids.map(f => S.tracks.get(f.id)).filter(t => t && c.playable(t));
      if (!list.length) return toast('Estas canciones no están disponibles en este dispositivo');
      player.playQueue(list); toast(`Sonando ${plural(list.length, 'favorita olvidada', 'favoritas olvidadas')}`);
    },
  });
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.net-node')) { e.preventDefault(); ACTIONS['sx-node'](e.target); } });

  return { section, after, tab: () => tab };
}
