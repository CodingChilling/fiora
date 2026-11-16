// Perfil (identidad, tarjeta de la criatura, estadísticas y evolución) y la experiencia «Tu criatura
// sonora» a pantalla completa: figura 3D de partículas, explicación, ADN musical, bestiario,
// metamorfosis, constelación de recuerdos y exportación. El motor está en creature.js, los datos en
// creature-data.js / habits.js y la escena en creature3d.js (se carga solo al usarla).
import { on, livePlaylists } from './store.js';
import * as account from './account.js';
import * as groups from './groups.js';
import * as habits from './habits.js';
import * as CD from './creature-data.js';
import * as C from './creature.js';
import * as recs from './recs.js';
import * as db from './db.js';
import { P } from './player.js';
import { icon } from './icons.js';
import { initStats } from './stats-ui.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const DAY = 86400000;
const TABS = [['', 'Criatura'], ['adn', 'ADN'], ['evolucion', 'Evolución'], ['constelacion', 'Constelación']];
const SEEN = 'fiora.creature.seen';
const hue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const genreColor = g => `hsl(${hue(g)}, 85%, 68%)`;
const monthName = k => new Date(`${k}-15T12:00:00`).toLocaleDateString('es', { month: 'long', year: 'numeric' });

export function initProfile(c) {
  const { esc, plural, toast, openSheet, sheet, confirmDlg, show, empty, refresh, num, statsBody, ACTIONS } = c;

  // ------------------------------------------------------------ escena 3D
  let scene = null;            // {kind, canvas, ctl, id}
  let mod = null, shapes = null;
  const X = { period: '', preview: '', star: -1, tool: 'touch', env: null, envFor: '', soundNote: '' };
  const load3d = () => (mod ||= import('./creature3d.js'));
  const loadShapes = () => (shapes ||= import('./creature-shapes.js'));
  function leave() {
    if (scene) { scene.ctl?.dispose(); scene.canvas.remove(); scene = null; }
    X.preview = ''; X.star = -1;
  }
  /** Sin WebGL: la misma silueta dibujada con puntos en un lienzo 2D, quieta. */
  async function staticFigure(slot, id) {
    const { sample, nebula, viewOf } = await loadShapes();
    const cv = document.createElement('canvas'), w = (cv.width = 640), h = (cv.height = 640), g = cv.getContext('2d');
    cv.className = 'cr-canvas static'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', id ? `Silueta del ${C.animal(id).name}` : 'Nube de partículas');
    const pts = id ? sample(id, 2600) : nebula(2600), [yaw, pitch] = id ? viewOf(id) : [0, 0.2], look = C.animal(id)?.look;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i] * cy + pts[i + 2] * sy, z = -pts[i] * sy + pts[i + 2] * cy, y = pts[i + 1] * cp - z * sp;
      g.fillStyle = look?.colors?.[y > 0 ? 0 : 1] || '#b9a8ff'; g.globalAlpha = 0.55;
      g.beginPath(); g.arc(w / 2 + x * w * 0.4, h / 2 - y * h * 0.4, 1.6, 0, 6.3); g.fill();
    }
    slot.querySelector('canvas')?.remove(); slot.prepend(cv);
    slot.dataset.mode = 'static';
  }
  /** Coloca (o recoloca) la figura en el hueco de la vista. id vacío = nube sin forma. */
  async function mount(kind, id, { morph = false } = {}) {
    const slot = $(`[data-creature="${kind}"]`);
    if (!slot) return null;
    const p = habits.prefs();
    if (scene && scene.kind !== kind) leave();
    try {
      const m = await load3d();
      if (!m.supported()) throw new Error('sin WebGL');
      if (!$(`[data-creature="${kind}"]`)) return null;                // la vista cambió mientras cargaba
      const host = $(`[data-creature="${kind}"]`);
      if (!scene) {
        const canvas = document.createElement('canvas');
        canvas.className = 'cr-canvas'; canvas.setAttribute('aria-hidden', 'true');
        host.prepend(canvas); host.dataset.mode = '3d';
        const ctl = m.create(canvas, { kind, anim: p.anim, habitat: p.habitat, mode: p.mode, quality: p.quality, onPick: i => pickStar(i) });
        scene = { kind, canvas, ctl, id: null };
        await ctl.setAnimal(id, C.animal(id)?.look, { formless: !id });
        scene.id = id;
      } else {
        if (scene.canvas.parentNode !== host) host.prepend(scene.canvas);
        host.dataset.mode = '3d';
        scene.ctl.setAnim(p.anim); scene.ctl.setMode(p.mode);
        if (scene.id !== id) { const from = scene.id; scene.id = id; await scene.ctl.setAnimal(id, C.animal(id)?.look, { morph: morph && !!from && !!id, formless: !id }); }
      }
      host.dataset.mode = '3d';
      return scene.ctl;
    } catch (e) {
      if (e.message !== 'sin WebGL') console.warn('Criatura 3D', e);
      leave();
      const host = $(`[data-creature="${kind}"]`);
      if (host) await staticFigure(host, id);
      return null;
    }
  }

  // ----------------------------------------------- datos que se enseñan
  /** Criatura que se muestra para un período: la oficial si es el período principal; si no, la de ese período. */
  function current(period) {
    const off = CD.official(), mainPeriod = off.ev.period;
    const isMain = !period || period === habits.prefs().period || period === mainPeriod;
    const ev = isMain ? off.ev : CD.evaluate(period);
    const a = isMain && off.official ? off.official.a : ev.res.primary?.id || '';
    const b = isMain && off.official ? off.official.b || '' : ev.res.secondary?.id || '';
    return { off, ev, a, b: b !== a ? b : '', isMain };
  }
  /** Capas de datos que se pintan con partículas (solo las que tienen dato). */
  function layers(ev) {
    const f = ev.I.f, gs = f.genres || [], gt = gs.reduce((n, x) => n + x[1], 0);
    const variety = ev.dna.find(d => d.id === 'variedad')?.value ?? null;
    const lib = Math.max(0, f.listenMin - f.radioMin), tot = f.listenMin;
    return {
      genres: gt ? gs.slice(0, 4).map(([g, n]) => ({ name: g, color: genreColor(g), share: n / gt })) : [],
      variety, discoveries: f.newTracks || 0,
      sources: tot >= 10 ? [{ name: 'Biblioteca', color: '#ffffff', share: lib / tot }, { name: 'Radio', color: '#5ac8ff', share: f.radioMin / tot }].filter(s => s.share > 0.02) : [],
    };
  }
  const legend = L => [
    L.genres.length && `<li><span class="lg-dots">${L.genres.map(g => `<i style="background:${g.color}"></i>`).join('')}</span><span><b>Colores secundarios</b><small>Tus géneros más escuchados: ${L.genres.map(g => `${esc(g.name)} (${Math.round(g.share * 100)} %)`).join(', ')}</small></span></li>`,
    L.variety != null && `<li><span class="lg-dots"><i class="halo"></i></span><span><b>Partículas periféricas</b><small>Variedad ${L.variety}/100: cuanto más variada es tu escucha, más puntos orbitan la figura</small></span></li>`,
    L.discoveries > 0 && `<li><span class="lg-dots"><i class="flash"></i></span><span><b>Destellos</b><small>${plural(L.discoveries, 'canción nueva', 'canciones nuevas')} en el período${L.discoveries > 60 ? ' (se muestran 60)' : ''}</small></span></li>`,
    L.sources.length && `<li><span class="lg-dots">${L.sources.map(s => `<i style="background:${s.color}"></i>`).join('')}</span><span><b>Anillo de fuentes</b><small>${L.sources.map(s => `${s.name} ${Math.round(s.share * 100)} %`).join(' · ')} de tu tiempo de escucha</small></span></li>`,
  ].filter(Boolean).join('');

  // ---------------------------------------------- reacción al sonido real
  // Solo con canciones descargadas en la app: se decodifica el archivo una vez y se calcula su
  // envolvente de volumen (RMS cada 50 ms). No toca el elemento de audio ni añade latencia.
  async function prepareSound() {
    const t = P.current, ctl = scene?.ctl;
    if (!ctl) return;
    const set = note => { X.soundNote = note; const el = $('[data-cr-sound]'); if (el) el.textContent = note; };
    if (!habits.prefs().sound) { ctl.setEnergy(null); return set('Reacción al sonido desactivada'); }
    if (!t) { ctl.setEnergy(null); return set('Animación ambiental: no hay nada sonando'); }
    if (t.radio) { ctl.setEnergy(null); return set('Animación ambiental: el navegador no deja analizar el audio de una emisora'); }
    if (!t.hasBlob) { ctl.setEnergy(null); return set('Animación ambiental: para reaccionar al sonido la canción tiene que estar descargada en la app'); }
    if (X.envFor !== t.id) {
      X.envFor = t.id; X.env = null;
      try {
        const blob = await db.get('blobs', t.id);
        if (!blob || blob.size > 60e6 || (t.duration || 0) > 900) throw new Error('grande');
        const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
        const buf = await ac.decodeAudioData(await blob.arrayBuffer());
        ac.close();
        const step = Math.round(buf.sampleRate * 0.05), n = Math.floor(buf.length / step), env = new Float32Array(n), ch = buf.getChannelData(0);
        let max = 1e-6;
        for (let i = 0; i < n; i++) { let s = 0; for (let k = i * step, e = k + step; k < e; k += 4) s += ch[k] * ch[k]; env[i] = Math.sqrt(s / (step / 4)); if (env[i] > max) max = env[i]; }
        for (let i = 0; i < n; i++) env[i] = Math.min(1, env[i] / max);
        if (X.envFor === t.id) X.env = env;
      } catch { X.env = null; }
    }
    if (!X.env) { ctl.setEnergy(null); return set('Animación ambiental: no se pudo analizar esta canción'); }
    ctl.setEnergy(() => (P.playing && P.current?.id === X.envFor ? X.env[Math.floor(P.audio.currentTime * 20)] ?? 0 : null));
    set('Reacciona al volumen real de la canción que suena');
  }
  on('track', () => { if (scene?.kind === 'full') prepareSound(); });

  // ------------------------------------------------------------------ Perfil
  function identity(d) {
    const u = account.user();
    const alias = groups.list().map(g => g.name).find(Boolean) || '';
    const name = alias || (u ? u.email.split('@')[0] : 'Tu perfil');
    const since = u?.created_at ? `Cuenta creada en ${new Date(u.created_at).toLocaleDateString('es', { month: 'long', year: 'numeric' })}` : '';
    return `<section class="pf-id"><span class="pf-avatar" aria-hidden="true">${esc((name[0] || 'F').toUpperCase())}</span>
      <div class="pf-who"><h2>${esc(name)}</h2>
        <small>${u ? `${esc(u.email)}${since ? ` · ${since}` : ''}` : 'Sin sesión: tus datos están solo en este dispositivo'}</small>
        <small>${plural(d.total, 'canción', 'canciones')} · ${plural(livePlaylists().filter(p => !p.shared).length, 'playlist', 'playlists')} · ${d.hours.toLocaleString('es', { maximumFractionDigits: 1 })} h escuchadas</small></div>
      ${u ? '' : `<a class="btn" href="#/ajustes">${icon('user')}Iniciar sesión</a>`}</section>`;
  }
  function creatureCard(cur) {
    if (!habits.enabled()) {
      return `<section class="pf-creature off"><div class="pf-ctext"><span class="kind">Tu criatura sonora</span><h2>Desactivada</h2>
        <p>La criatura convierte tus hábitos de escucha en un animal de partículas. Ahora mismo no se guarda ningún resumen para ella; tus estadísticas siguen igual.</p>
        <div class="actions"><button class="btn primary" data-act="cr-enable">Activar</button></div></div></section>`;
    }
    const a = C.animal(cur.a), b = C.animal(cur.b), ex = a && C.explain(a.id, cur.ev.I), f = cur.ev.I.f, need = cur.ev.I.need;
    const body = a
      ? `<span class="kind">Tu criatura sonora</span><h2 data-cr-name>${esc(a.name)}</h2><b class="pf-sub">${esc(a.sub)}</b>
         <p>${esc(a.text)}</p>${ex.why[0] ? `<p class="pf-why">${icon('spark')}${esc(ex.why[0])}</p>` : ''}
         ${b ? `<a class="chip" href="#/criatura">+ ${esc(b.name)} · ${esc(b.sub.toLowerCase())}</a>` : ''}`
      : `<span class="kind">Tu criatura sonora</span><h2 data-cr-name>Tu criatura está tomando forma</h2>
         <p>${cur.ev.res.reason === 'flat' ? 'Ya hay escuchas suficientes, pero todavía no destaca ningún patrón. Sigue escuchando y aparecerá.' : `Hacen falta al menos ${need.plays} escuchas en ${need.days} días distintos para reconocer un patrón.`}</p>
         <div class="pf-progress"><div class="meter"><i style="width:${Math.min(100, (f.plays / need.plays) * 100).toFixed(0)}%"></i></div><small>${Math.min(f.plays, need.plays)} de ${need.plays} escuchas · ${Math.min(f.active, need.days)} de ${need.days} días</small></div>`;
    return `<section class="pf-creature" style="--ca:${a?.look.colors[0] || '#b9a8ff'};--cb:${a?.look.colors[1] || '#5a4fa8'}">
      <div class="pf-stage" data-creature="card"><span class="cr-loading">Formando la figura…</span></div>
      <div class="pf-ctext">${body}
        <div class="actions"><a class="btn primary" href="#/criatura">${icon('spark')}${a ? 'Abrir la experiencia' : 'Ver cómo se forma'}</a></div>
        <small class="muted">${C.PERIODS[cur.ev.period]}${cur.ev.fellBack ? ` (aún no hay datos suficientes de ${C.PERIODS[cur.ev.fellBack].toLowerCase()})` : ''} · se calcula con tus estadísticas</small></div></section>`;
  }
  function evolutionCards(cur) {
    if (!habits.enabled()) return '';
    const dnaTop = cur.ev.dna.filter(d => d.value != null).sort((x, y) => y.value - x.value).slice(0, 3);
    const log = CD.bestiary(), mem = CD.memories(), b = C.animal(cur.b);
    const card = (href, ic, title, text) => `<a class="pf-evo" href="${href}">${icon(ic)}<span><b>${title}</b><small>${text}</small></span>${icon('chevR')}</a>`;
    return `<h2>Mi evolución musical</h2><div class="pf-evos">
      ${card('#/criatura/adn', 'chart', 'ADN musical', dnaTop.length ? dnaTop.map(d => `${esc(d.name)} ${d.value}`).join(' · ') : 'Se llenará con tus escuchas')}
      ${card('#/criatura', 'user', 'Animal secundario', b ? `${esc(b.name)} · ${esc(b.sub.toLowerCase())}` : 'Todavía no hay un segundo patrón claro')}
      ${card('#/criatura/evolucion', 'sync', 'Bestiario y metamorfosis', log.length ? `${plural(log.length, 'mes', 'meses')} de historial · ${C.ANIMALS.length} criaturas` : `${C.ANIMALS.length} criaturas por descubrir`)}
      ${card('#/criatura/constelacion', 'star', 'Constelación musical', mem.length ? plural(mem.length, 'recuerdo', 'recuerdos') : 'Aparecerá con tus primeras escuchas')}</div>`;
  }
  async function viewProfile(section) {
    if (scene?.kind === 'full') leave();
    const d = recs.dashboard(), cur = current();
    show(`<div class="head"><h1>Perfil</h1><a class="icon-btn pf-gear" href="#/ajustes" aria-label="Ajustes" title="Ajustes">${icon('settings')}</a></div>
      ${identity(d)}
      ${creatureCard(cur)}
      ${ST.section(d)}
      ${evolutionCards(cur)}`);
    ST.after();
    if (section === 'stats') $('#pf-stats')?.scrollIntoView();
    if (habits.enabled()) mount('card', cur.a).then(ctl => ctl?.setData(layers(cur.ev)));
  }

  // -------------------------------------------------- experiencia completa
  const tools = () => {
    const p = habits.prefs(), b = (c2, ic, label, on2 = false) => `<button class="icon-btn${on2 ? ' on' : ''}" data-act="cr-ctl" data-c="${c2}" aria-label="${label}" title="${label}" aria-pressed="${on2}">${icon(ic)}</button>`;
    return `<div class="cr-tools" role="toolbar" aria-label="Controles de la figura">
      ${b('left', 'chevL', 'Girar a la izquierda')}${b('right', 'chevR', 'Girar a la derecha')}${b('up', 'up', 'Inclinar hacia arriba')}${b('down', 'chevD', 'Inclinar hacia abajo')}
      ${b('in', 'plus', 'Acercar')}${b('out', 'minus', 'Alejar')}${b('reset', 'sync', 'Restablecer la vista')}
      ${b('mode', 'spark', p.mode === 'attract' ? 'Las partículas se acercan: cambiar a repeler' : 'Las partículas se apartan: cambiar a atraer', p.mode === 'attract')}
      ${b('tool', 'grip', 'En pantallas táctiles: girar con un dedo en lugar de mover partículas', X.tool === 'rotate')}
      ${b('anim', p.anim ? 'pause' : 'play', p.anim ? 'Pausar las animaciones' : 'Reanudar las animaciones', !p.anim)}
      ${b('hab', 'wave', p.habitat ? 'Quitar el hábitat' : 'Mostrar el hábitat', p.habitat)}
      ${document.fullscreenEnabled ? b('fs', 'expand', 'Pantalla completa') : ''}</div>`;
  };
  function tabCreature(cur, shown) {
    const a = C.animal(shown), main = C.animal(cur.a), b = C.animal(cur.b), I = cur.ev.I, f = I.f, need = I.need;
    if (!main && !a) {
      return `<h2>Tu criatura está tomando forma</h2>
        <p>${cur.ev.res.reason === 'flat' ? 'Hay escuchas suficientes, pero ningún patrón llega todavía al mínimo para asignarte un animal. No se elige uno al azar.' : `Para reconocer un patrón hacen falta al menos ${need.plays} escuchas (o 45 minutos de música) repartidas en ${need.days} días distintos del período.`}</p>
        <div class="pf-progress"><div class="meter"><i style="width:${Math.min(100, (f.plays / need.plays) * 100).toFixed(0)}%"></i></div><small>${Math.min(f.plays, need.plays)} de ${need.plays} escuchas · ${Math.min(f.active, need.days)} de ${need.days} días con música</small></div>
        <p class="muted">Mientras tanto, la nube de partículas no tiene silueta. Puedes tocarla igualmente.</p>${allAnimals('')}`;
    }
    const ex = C.explain(a.id, I), sc = cur.ev.res.scores.find(x => x.id === a.id);
    const preview = shown !== cur.a;
    const L = layers(cur.ev), lg = legend(L);
    return `${preview ? `<p class="cr-preview">Estás viendo otra criatura. <button class="chip" data-act="cr-preview" data-id="">Volver a la tuya${main ? ` (${esc(main.name)})` : ''}</button></p>` : ''}
      <h2>${preview ? esc(a.name) : esc(ex.title)}</h2><b class="pf-sub">${esc(a.sub)}</b>
      <p>${esc(a.text)}</p>
      ${cur.off.cand && !preview ? `<p class="cr-note">${icon('sync')}Tus hábitos se están acercando al ${esc(C.animal(cur.off.cand.id)?.name || '')}: lleva ${cur.off.cand.days.length} de ${C.SWITCH_DAYS} días por delante. Si se mantiene, habrá metamorfosis.</p>` : ''}
      <h3>${preview ? `¿Qué dicen tus datos sobre el ${esc(a.name)}?` : '¿Por qué soy este animal?'}</h3>
      ${ex.why.length ? `<ul class="cr-why">${ex.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="muted">En este período no hay datos de los indicadores de este animal.</p>'}
      ${sc ? `<details class="more"><summary>Puntuación ${sc.score}/100: cómo se calcula</summary>
        <p class="muted">Cada regla vale de 0 a 100 % según dónde cae tu dato entre «empieza a contar» y «cuenta del todo». La puntuación es mitad la media ponderada de las reglas y mitad la regla esencial más débil. No es un porcentaje de afinidad.</p>
        <table class="data">${sc.parts.map(x => `<tr><td>${esc(x.label)}</td><td>${C.fmtMetric(x.key, x.value)}</td><td>${Math.round(x.r * 100)} % · peso ${x.weight}${x.req ? ' · esencial' : ''}</td></tr>`).join('')}</table></details>`
        : `<p class="muted">Con los datos de este período, este animal no entra en la clasificación.</p>`}
      ${!preview && b ? `<h3>Animal secundario</h3><button class="cr-second" data-act="cr-preview" data-id="${b.id}" style="--ca:${b.look.colors[0]}"><span><b>${esc(b.name)}</b><small>${esc(b.sub)} · ${esc(C.fact(b.facts[0], I) || b.text)}</small></span>${icon('chevR')}</button><p class="muted">${esc(C.pairText(cur.a, cur.b))}</p>`
        : !preview ? '<p class="muted">Sin animal secundario: ningún otro patrón tiene evidencia suficiente en este período.</p>' : ''}
      ${!preview && lg ? `<h3>Lo que dibujan las partículas</h3><ul class="cr-legend">${lg}</ul>` : ''}
      <p class="muted" data-cr-sound>${esc(X.soundNote)}</p>
      <div class="actions">${!preview ? `<button class="btn" data-act="cr-share">${icon('download')}Compartir mi criatura</button>` : ''}</div>
      <p class="muted cr-small">${C.PERIODS[cur.ev.period]}${cur.ev.fellBack ? ` · todavía no hay datos suficientes de ${C.PERIODS[cur.ev.fellBack].toLowerCase()}` : ''}${f.legacy ? ' · parte de tus escuchas son anteriores a los resúmenes diarios: de ellas solo se usan los totales' : ''}. Es una interpretación artística de hábitos musicales, no un perfil psicológico.</p>`;
  }
  function tabDna(cur, period) {
    const N = period === 'all' ? 0 : +period;
    const prev = N ? CD.evaluate(period, Date.now() - N * DAY) : null;
    const rows2 = cur.ev.dna.map(d => {
      const before = prev?.I.enough ? prev.dna.find(x => x.id === d.id)?.value : null;
      const delta = d.value != null && before != null ? d.value - before : null;
      return `<details class="dna" ${d.value == null ? 'data-empty' : ''}><summary><span class="dna-name">${esc(d.name)}</span>
          <span class="dna-bar" role="img" aria-label="${esc(d.name)}: ${d.value == null ? 'sin datos' : `${d.value} de 100`}"><i style="width:${d.value || 0}%"></i></span>
          <span class="dna-val" data-dna="${d.id}">${d.value == null ? '—' : `${d.value}<small>/100</small>`}</span>
          ${delta != null && delta !== 0 ? `<span class="dna-delta ${delta > 0 ? 'up' : 'down'}" title="Frente a los ${N} días anteriores">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}</span>` : '<span class="dna-delta"></span>'}</summary>
        <div class="dna-how"><p>${esc(d.how)}</p>
          ${d.parts.length ? `<table class="data">${d.parts.map(x => `<tr><td>${esc(x.label)}</td><td>${C.fmtMetric(x.key, x.value)}</td><td>${Math.round(x.r * 100)}/100</td></tr>`).join('')}</table>` : '<p class="muted">Sin datos en este período, así que no se muestra ningún valor.</p>'}
          ${d.facts.length ? `<ul class="cr-why">${d.facts.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div></details>`;
    }).join('');
    return `<h2>Tu ADN musical</h2><p>Siete dimensiones de cómo escuchas, de 0 a 100. Toca una para ver cómo se calcula y con qué datos.${N ? ` La flecha compara con los ${N} días anteriores.` : ''}</p>
      <div class="dna-list">${rows2}</div>`;
  }
  const allAnimals = active => `<h3>Las ${C.ANIMALS.length} criaturas</h3><p class="muted">Toca una para verla en 3D con una metamorfosis.</p>
    <div class="cr-all">${C.ANIMALS.map(a => `<button class="cr-animal${a.id === active ? ' on' : ''}" data-act="cr-preview" data-id="${a.id}" style="--ca:${a.look.colors[0]}"><b>${esc(a.name)}</b><small>${esc(a.sub)}</small></button>`).join('')}</div>`;
  function tabEvolution(cur, shown) {
    const log = CD.bestiary(), start = CD.recordStart();
    const items = log.map((e, i) => {
      const a = C.animal(e.a), b = C.animal(e.b), prev = log[i + 1], diff = C.diffEntries(prev, e), from = C.animal(e.from);
      return `<li class="best"><span class="best-dot" style="background:${a?.look.colors[0] || '#888'}"></span><div><small>${esc(monthName(e.key))}</small>
        <b>${esc(a?.name || e.a)}${b ? ` + ${esc(b.name)}` : ''}</b><small>Puntuación ${e.score}/100 · ${plural(e.plays || 0, 'escucha', 'escuchas')}</small>
        ${from ? `<p class="cr-note">${icon('sync')}Metamorfosis: del ${esc(from.name)} al ${esc(a.name)}${e.margin ? `, con ${e.margin} puntos de ventaja durante ${C.SWITCH_DAYS} días` : ''}.</p>` : ''}
        ${(e.why || []).length ? `<ul class="cr-why">${e.why.slice(0, 3).map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${diff.length ? `<p class="muted">Frente al mes anterior: ${diff.slice(0, 3).map(x => `${esc(x.label.toLowerCase())} ${C.fmtMetric(x.key, x.from)} → ${C.fmtMetric(x.key, x.to)}`).join('; ')}.</p>` : ''}
        <div class="actions"><button class="chip" data-act="cr-preview" data-id="${e.a}">Ver en 3D</button>${from ? `<button class="chip" data-act="cr-replay" data-from="${e.from}" data-to="${e.a}">Repetir la metamorfosis</button>` : ''}</div></div></li>`;
    }).join('');
    return `<h2>Bestiario y metamorfosis</h2>
      <p>Tu criatura se revisa como mucho una vez al día. Solo cambia si otro animal la supera en ${C.SWITCH_MARGIN} puntos o más durante ${C.SWITCH_DAYS} días distintos, para que no oscile.</p>
      ${log.length ? `<ol class="cr-best">${items}</ol>` : '<p class="muted">Todavía no hay historial: la primera entrada aparecerá cuando tu criatura tome forma. No se inventan meses anteriores.</p>'}
      ${start ? `<p class="muted cr-small">Los resúmenes diarios empiezan el ${new Date(`${start}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}. Cada entrada guarda el animal, su puntuación y sus cifras principales, no tus escuchas.</p>` : ''}
      ${allAnimals(shown)}`;
  }
  function tabConstellation() {
    const mem = CD.memories(), sel = mem[X.star];
    if (!mem.length) return `<h2>Constelación musical</h2><p class="muted">Aquí aparecerán tus momentos destacados cuando haya escuchas. No se inventan recuerdos.</p>`;
    return `<h2>Constelación musical</h2><p>Cada estrella es un momento real de tu historial. Tócala en la escena o elígela en la lista.</p>
      ${sel ? `<div class="cr-memory" data-cr-memory><small>${esc(sel.kind)}</small><b>${esc(sel.title)}</b><span>${esc(sel.detail || '')}</span>${sel.href ? `<a class="chip" href="${sel.href}">Abrir</a>` : ''}</div>` : ''}
      <ul class="cr-stars">${mem.map((m, i) => `<li><button class="${i === X.star ? 'on' : ''}" data-act="cr-star" data-i="${i}"><small>${esc(m.kind)}</small><b>${esc(m.title)}</b></button></li>`).join('')}</ul>`;
  }

  async function viewCreature(tab = '') {
    if (scene?.kind === 'card') leave();
    if (!TABS.some(t => t[0] === tab)) tab = '';
    if (!habits.enabled()) {
      leave();
      return show(`<div class="head"><a class="icon-btn" href="#/perfil" aria-label="Volver al perfil">${icon('back')}</a><h1>Tu criatura sonora</h1></div>
        ${empty('spark', 'La criatura está desactivada', 'No se guarda ningún resumen para ella. Tus estadísticas siguen funcionando.', '<button class="btn primary" data-act="cr-enable">Activar</button>')}`);
    }
    const period = X.period || habits.prefs().period;
    const cur = current(X.period);
    const shown = tab === 'constelacion' ? cur.a : X.preview || cur.a;
    const a = C.animal(shown);
    const body = tab === 'adn' ? tabDna(cur, cur.ev.period) : tab === 'evolucion' ? tabEvolution(cur, shown) : tab === 'constelacion' ? tabConstellation() : tabCreature(cur, shown);
    show(`<div class="cr" style="--ca:${a?.look.colors[0] || '#b9a8ff'};--cb:${a?.look.colors[1] || '#5a4fa8'}">
      <div class="cr-stage" data-creature="full">
        <div class="cr-top"><a class="icon-btn" href="#/perfil" aria-label="Volver al perfil">${icon('back')}</a>
          <div class="cr-title"><small>Tu criatura sonora</small><b data-cr-name>${a ? esc(a.name) : 'Tomando forma'}</b></div>
          <label class="field sm"><select data-cr-period aria-label="Período analizado">${Object.entries(C.PERIODS).map(([k, v]) => `<option value="${k}" ${k === (X.period || cur.ev.period) ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
        <span class="cr-loading">Formando la figura…</span>
        ${tools()}
      </div>
      <div class="cr-panel"><nav class="cr-tabs" aria-label="Secciones">${TABS.map(([id, label]) => `<a href="#/criatura${id ? `/${id}` : ''}" class="${id === tab ? 'on' : ''}" ${id === tab ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
        <div class="cr-body" data-cr-tab="${tab || 'criatura'}">${body}</div></div></div>`);
    void period;
    // metamorfosis pendiente: la criatura cambió desde la última vez que se vio en este dispositivo
    let seen = ''; try { seen = localStorage.getItem(SEEN) || ''; } catch { /* sin almacenamiento */ }
    const pending = !X.preview && cur.isMain && cur.a && seen && seen !== cur.a && C.animal(seen) && !scene;
    const ctl = await mount('full', pending ? seen : shown, { morph: true });
    if (!ctl) return;
    ctl.setTool(X.tool || 'touch');
    if (pending) {
      toast(`Metamorfosis: del ${C.animal(seen).name} al ${C.animal(cur.a).name}`, 6000);
      scene.id = cur.a; ctl.setAnimal(cur.a, C.animal(cur.a).look, { morph: true });
    }
    if (cur.isMain && cur.a && !X.preview) { try { localStorage.setItem(SEEN, cur.a); } catch { /* sin almacenamiento */ } }
    ctl.setData(shown === cur.a ? layers(cur.ev) : {});
    if (tab === 'constelacion') ctl.setConstellation(CD.memories().length, X.star); else ctl.setConstellation(0);
    prepareSound();
  }
  function pickStar(i) { X.star = i; refresh(); }

  // ------------------------------------------------------------- exportar
  function wrapText(g, text, x, y, maxW, lh) {
    let line = '';
    for (const w of String(text).split(' ')) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = w; } else line = t; }
    if (line) { g.fillText(line, x, y); y += lh; }
    return y;
  }
  function compose(cv, o) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, a = o.a;
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#15131c'); bg.addColorStop(1, '#0b0a12');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W / 2, H * 0.36, 40, W / 2, H * 0.36, W * 0.7);
    glow.addColorStop(0, `${a.look.colors[1]}55`); glow.addColorStop(1, '#00000000');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    const src = scene?.ctl ? scene.ctl.renderNow() : $('.cr-canvas');
    if (src?.width) { const s = Math.min(W / src.width, (H * 0.62) / src.height), w = src.width * s, h = src.height * s; g.drawImage(src, (W - w) / 2, H * 0.36 - h / 2, w, h); }
    g.textAlign = 'center'; g.fillStyle = '#a39db3'; g.font = '600 30px system-ui, sans-serif';
    g.fillText('FIORA · TU CRIATURA SONORA', W / 2, 78);
    let y = H * 0.7;
    g.fillStyle = '#f3efe8'; g.font = '800 92px system-ui, sans-serif'; g.fillText(a.name, W / 2, y); y += 54;
    g.fillStyle = a.look.colors[0]; g.font = '700 38px system-ui, sans-serif'; g.fillText(o.second ? `${a.sub} · con rasgos de ${o.second.name}` : a.sub, W / 2, y); y += 58;
    g.fillStyle = '#d9d3e6'; g.font = '400 32px system-ui, sans-serif'; y = wrapText(g, a.text, W / 2, y, W - 180, 42) + 10;
    g.fillStyle = '#a39db3'; g.font = '400 28px system-ui, sans-serif';
    for (const s of o.stats) y = wrapText(g, `· ${s}`, W / 2, y, W - 160, 38);
    if (o.alias) { g.fillStyle = '#f3efe8'; g.font = '600 30px system-ui, sans-serif'; g.fillText(o.alias, W / 2, H - 56); }
  }
  async function deliver(blob, name) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Mi criatura sonora' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const url = URL.createObjectURL(blob), link = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Guardada en tus descargas');
  }
  const ST = initStats({ ...c, deliver });
  function openShare() {
    const cur = current(X.period), a = C.animal(cur.a), b = C.animal(cur.b);
    if (!a) return toast('Tu criatura todavía está tomando forma');
    const why = C.explain(a.id, cur.ev.I).why;
    const canVideo = !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream) && !!scene?.ctl;
    openSheet(`<div class="dlg share-dlg cr-share"><h3>Compartir mi criatura</h3>
      <p>Se crea una imagen en este dispositivo: no se publica ni se sube a ningún servidor. Tú eliges qué lleva. Por defecto no incluye ninguna cifra de tus hábitos.</p>
      <label class="lbl">Nombre o alias (opcional)<span class="field"><input data-sh-alias maxlength="30" placeholder="Sin nombre" autocomplete="off"></span></label>
      ${b ? `<label class="switch mini"><input type="checkbox" data-sh-second><span><b>Incluir mi animal secundario</b><small>${esc(b.name)}</small></span></label>` : ''}
      ${why.length ? `<p class="muted" style="margin-bottom:4px">Estadísticas que quieres mostrar:</p>${why.map((w, i) => `<label class="switch mini"><input type="checkbox" data-sh-stat="${i}"><span><small>${esc(w)}</small></span></label>`).join('')}` : ''}
      <div class="actions"><button class="btn ghost" data-x>Cancelar</button>${canVideo ? '<button class="btn" data-video>Animación (4 s)</button>' : ''}<button class="btn primary" data-ok>Imagen</button></div>
      ${canVideo ? '' : '<small class="muted">Este navegador no permite grabar la animación: solo imagen.</small>'}</div>`,
    async e => {
      if (e.target.closest('[data-x]')) return sheet.close();
      const img = e.target.closest('[data-ok]'), vid = e.target.closest('[data-video]');
      if (!img && !vid) return;
      const o = { a, alias: $('[data-sh-alias]', sheet).value.trim(), second: $('[data-sh-second]', sheet)?.checked ? b : null, stats: $$('[data-sh-stat]', sheet).filter(x => x.checked).map(x => why[+x.dataset.shStat]) };
      const cv = Object.assign(document.createElement('canvas'), { width: 1080, height: 1350 });
      sheet.close();
      if (img) { compose(cv, o); return cv.toBlob(bl => bl && deliver(bl, `fiora-${a.id}.png`), 'image/png'); }
      const note = toast('Grabando la animación…', 0);
      try {
        const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
        const rec = new MediaRecorder(cv.captureStream(30), { mimeType: type }), chunks = [];
        rec.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
        const done = new Promise(r => (rec.onstop = r));
        let run = true; const loop = () => { if (!run) return; compose(cv, o); requestAnimationFrame(loop); };
        loop(); rec.start(); await new Promise(r => setTimeout(r, 4000)); run = false; rec.stop(); await done;
        note.done('Animación lista', 1500);
        await deliver(new Blob(chunks, { type: type.split(';')[0] }), `fiora-${a.id}.${type.includes('mp4') ? 'mp4' : 'webm'}`);
      } catch (err) { console.warn(err); note.done('No se pudo grabar la animación en este navegador; prueba con la imagen', 6000); }
    });
  }

  // ------------------------------------------------------------- acciones
  Object.assign(ACTIONS, {
    'cr-ctl'(el) {
      const k = el.dataset.c, ctl = scene?.ctl, p = habits.prefs();
      if (k === 'mode') { habits.setPrefs({ mode: p.mode === 'attract' ? 'repel' : 'attract' }); ctl?.setMode(habits.prefs().mode); return refreshTools(); }
      if (k === 'anim') { habits.setPrefs({ anim: !p.anim }); ctl?.setAnim(!p.anim); return refreshTools(); }
      if (k === 'hab') { habits.setPrefs({ habitat: !p.habitat }); ctl?.setHabitat(!p.habitat); return refreshTools(); }
      if (k === 'tool') { X.tool = X.tool === 'rotate' ? 'touch' : 'rotate'; ctl?.setTool(X.tool); return refreshTools(); }
      if (k === 'fs') { const box = $('.cr'); return document.fullscreenElement ? document.exitFullscreen() : box?.requestFullscreen?.().catch(() => {}); }
      if (!ctl) return;
      if (k === 'left') ctl.rotateBy(-0.35, 0); if (k === 'right') ctl.rotateBy(0.35, 0);
      if (k === 'up') ctl.rotateBy(0, -0.2); if (k === 'down') ctl.rotateBy(0, 0.2);
      if (k === 'in') ctl.zoomBy(1.2); if (k === 'out') ctl.zoomBy(1 / 1.2);
      if (k === 'reset') ctl.resetView();
    },
    'cr-preview'(el) { X.preview = el.dataset.id || ''; if (location.hash.startsWith('#/criatura/constelacion')) location.hash = '#/criatura'; else refresh(); },
    async 'cr-replay'(el) {
      const ctl = scene?.ctl, from = C.animal(el.dataset.from), to = C.animal(el.dataset.to);
      if (!ctl || !from || !to) return;
      await ctl.setAnimal(from.id, from.look, { morph: false }); scene.id = from.id;
      $('.cr-stage')?.scrollIntoView({ block: 'start' });
      scene.id = to.id; await ctl.setAnimal(to.id, to.look, { morph: true });
      X.preview = to.id === current(X.period).a ? '' : to.id;
    },
    'cr-star'(el) { X.star = +el.dataset.i; refresh(); },
    'cr-share'() { openShare(); },
    'cr-enable'() { habits.setPrefs({ off: false }); toast('Criatura sonora activada'); refresh(); },
    async 'cr-erase'() {
      if (!(await confirmDlg('¿Eliminar los datos de la criatura?', 'Se borran los resúmenes diarios de hábitos, el historial de criaturas y la criatura actual, en este dispositivo y en tu cuenta. Tus estadísticas, playlists y favoritos no se tocan.', 'Eliminar'))) return;
      try { await habits.erase(); try { localStorage.removeItem(SEEN); } catch { /* nada */ } toast('Datos de la criatura eliminados'); }
      catch (e) { toast(e.message, 7000); }
      refresh();
    },
  });
  function refreshTools() { const t = $('.cr-tools'); if (t) t.outerHTML = tools(); }
  document.addEventListener('change', e => {
    if (e.target.matches?.('[data-cr-period]')) { X.period = e.target.value; X.preview = ''; refresh(); }
    const k = e.target.dataset?.crPref;
    if (!k) return;
    if (k === 'period') habits.setPrefs({ period: e.target.value });
    else if (k === 'on') habits.setPrefs({ off: !e.target.checked });
    else habits.setPrefs({ [k]: e.target.checked });
    refresh();
  });
  on('habits', () => { if (/^#\/(perfil|criatura)/.test(location.hash) && !scene?.ctl?.morphing) refresh(); });

  /** Panel de privacidad y preferencias para Ajustes. */
  function settingsPanel() {
    const p = habits.prefs(), st = habits.status(), u = account.user();
    const sw = (k, on2, title, text) => `<label class="switch"><input type="checkbox" data-cr-pref="${k}" ${on2 ? 'checked' : ''}><span><b>${title}</b><small>${text}</small></span></label>`;
    return `<div class="panel" id="ajustes-criatura"><h2>Tu criatura sonora</h2>
      <p>Para calcularla, Fiora guarda un <b>resumen por día</b> con contadores: escuchas, minutos, franjas de tres horas, canciones nuevas o repetidas, saltos, duración de las sesiones, géneros, minutos de radio y países de las emisoras, y cambios en playlists. No guarda qué canciones ni qué artistas escuchas en ese resumen, ni horas exactas. Es una interpretación visual de hábitos, no un perfil psicológico, y no se publica ni se comparte con nadie.</p>
      ${sw('on', !p.off, 'Activar la criatura sonora', 'Si la desactivas, deja de guardarse el resumen diario y la criatura se oculta. Tus estadísticas de siempre siguen igual.')}
      ${sw('anim', p.anim, 'Animaciones', 'Respiración, flotación y pulsos de la figura. Con «reducir movimiento» del sistema se desactivan solas.')}
      ${sw('habitat', p.habitat, 'Hábitat', 'El ambiente de partículas que acompaña a cada criatura.')}
      ${sw('sound', p.sound, 'Reaccionar al sonido', 'Solo con canciones descargadas en la app: se analiza el archivo en este dispositivo.')}
      <label class="lbl" style="margin-top:12px">Período principal<span class="field"><select data-cr-pref="period">${Object.entries(C.PERIODS).map(([k, v]) => `<option value="${k}" ${k === p.period ? 'selected' : ''}>${v}</option>`).join('')}</select></span></label>
      ${u && st.mode === 'missing' ? `<div class="sub-panel"><b>Falta preparar Supabase para la criatura</b><small>Ahora se guarda solo en este dispositivo. Para tenerla en todos, ejecuta una vez <code>supabase/migrations/20261117120000_creature.sql</code> en Supabase → SQL Editor. No borra nada.</small></div>` : ''}
      <p class="muted" style="margin-top:12px">${u ? (st.mode === 'ready' ? 'Se guarda en tu cuenta, en tablas que solo tú puedes leer.' : 'Se guarda en este dispositivo.') : 'Sin sesión, se guarda solo en este dispositivo.'} ${plural(Object.keys(habits.H.days).length, 'día', 'días')} de resúmenes · ${plural(CD.bestiary().length, 'mes', 'meses')} de historial.</p>
      <div class="actions"><a class="btn" href="#/criatura">${icon('spark')}Ver mi criatura</a><button class="btn ghost danger" data-act="cr-erase">${icon('trash')}Eliminar los datos de la criatura</button></div></div>`;
  }

  globalThis.__fioraCreature = () => scene?.ctl || null;   // para las pruebas automáticas
  return { viewProfile, viewCreature, leave, settingsPanel };
}
