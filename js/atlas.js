// Fiora Atlas: globo terráqueo (proyección ortográfica) y mapa plano (equirectangular) en un
// canvas 2D, sin librerías. Se carga solo al abrir el Atlas o el Pasaporte.
//   · Solo se dibujan emisoras con coordenadas del directorio, agrupadas por cercanía en pantalla.
//   · Se pinta bajo demanda (al arrastrar, acercar o seleccionar), nunca en bucle; la inercia se
//     detiene sola, y fuera de pantalla o con la pestaña oculta no se dibuja nada.
//   · Con «movimiento reducido» o si el globo va lento en este dispositivo, se usa el mapa plano.
// Fronteras: data/world.json (Natural Earth 1:110m, dominio público).

let worldP = null;
export const loadWorld = () => (worldP ||= fetch(new URL('../data/world.json', import.meta.url)).then(r => { if (!r.ok) throw new Error('No se pudo cargar el mapa'); return r.json(); }));
const RAD = Math.PI / 180;
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

class WorldMap {
  constructor(box, { stations = [], mode = 'auto', onSelect, onMode, visited = null, interactive = true } = {}) {
    this.box = box; this.stations = stations; this.onSelect = onSelect; this.onMode = onMode;
    this.visited = visited; this.interactive = interactive;
    this.want = mode;
    this.flat = mode === '2d' || (mode === 'auto' && reduced());
    this.lon = 0; this.lat = 25; this.zoom = 1; this.vel = [0, 0];
    this.sel = null; this.clusters = [];
    box.innerHTML = '';
    this.canvas = Object.assign(document.createElement('canvas'), { className: 'atlas-canvas', tabIndex: interactive ? 0 : -1 });
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', interactive ? 'Mapa de emisoras. Flechas: girar o mover; + y −: acercar; Intro: abrir el grupo del centro.' : 'Mapa de países descubiertos');
    box.append(this.canvas);
    if (interactive) {
      this.hint = Object.assign(document.createElement('div'), { className: 'atlas-hint' });
      box.append(this.hint);
      const zoomUi = document.createElement('div');
      zoomUi.className = 'atlas-zoom';
      zoomUi.innerHTML = '<button type="button" data-z="1" aria-label="Acercar">+</button><button type="button" data-z="-1" aria-label="Alejar">−</button>';
      zoomUi.addEventListener('click', e => { const b = e.target.closest('[data-z]'); if (b) this.zoomBy(+b.dataset.z > 0 ? 1.5 : 1 / 1.5); });
      box.append(zoomUi);
    }
    this.colors();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(box);
    this.visible = true;
    this.io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.render(); }, {}); this.io.observe(this.canvas);
    this.onVis = () => { if (!document.hidden) this.render(); };
    document.addEventListener('visibilitychange', this.onVis);
    this.mq = matchMedia('(prefers-color-scheme: dark)'); this.onScheme = () => { this.colors(); this.render(); }; this.mq.addEventListener?.('change', this.onScheme);
    if (interactive) this.bind();
    this.resize();
  }
  colors() {
    this.c = { bg: css('--bg') || '#15131c', surface: css('--surface') || '#1f1c29', surface2: css('--surface-2') || '#2a2637', line: css('--line') || '#353045', text: css('--text') || '#f3efe8', muted: css('--muted') || '#a39db3', accent: css('--accent') || '#ff8f63', accent2: css('--accent-2') || '#f2557a' };
  }
  setWorld(w) { this.world = w; this.render(); }
  setMode(m) {
    this.want = m;
    const flat = m === '2d' || (m === 'auto' && (reduced() || this.slow));
    if (flat !== this.flat) { this.flat = flat; this.zoom = 1; this.clampFlat(); }
    this.render();
  }
  resize() {
    const r = this.box.getBoundingClientRect();
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.W = Math.max(200, r.width); this.H = Math.max(200, r.height || r.width * 0.6);
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
    this.clampFlat(); this.render();
  }
  get R() { return Math.min(this.W, this.H) * 0.44 * this.zoom; }
  get k() { return Math.max(this.W / 360, this.H / 180) * this.zoom; }
  clampFlat() {
    if (!this.flat || !this.W) return;
    const k = this.k, hw = this.W / 2 / k, hh = this.H / 2 / k;
    this.lon = hw >= 180 ? 0 : Math.max(-180 + hw, Math.min(180 - hw, this.lon));
    this.lat = hh >= 90 ? 0 : Math.max(-90 + hh, Math.min(90 - hh, this.lat));
  }
  /** Coordenadas → pantalla. `v` false si el punto está en la cara oculta del globo. */
  proj(lon, lat, clamp = false) {
    if (this.flat) return [this.W / 2 + (lon - this.lon) * this.k, this.H / 2 - (lat - this.lat) * this.k, true];
    const l = (lon - this.lon) * RAD, p = lat * RAD, p0 = this.lat * RAD;
    const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l);
    let x = Math.cos(p) * Math.sin(l), y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l);
    if (cosc < 0 && clamp) { const n = Math.hypot(x, y) || 1; x /= n; y /= n; }
    return [this.W / 2 + x * this.R, this.H / 2 - y * this.R, cosc >= 0];
  }
  /** Pantalla → coordenadas (para centrar al tocar). */
  unproj(sx, sy) {
    if (this.flat) return [this.lon + (sx - this.W / 2) / this.k, this.lat - (sy - this.H / 2) / this.k];
    const x = (sx - this.W / 2) / this.R, y = -(sy - this.H / 2) / this.R, rho = Math.hypot(x, y);
    if (rho > 1) return null;
    const c = Math.asin(rho), p0 = this.lat * RAD;
    const lat = Math.asin(Math.cos(c) * Math.sin(p0) + (rho ? y * Math.sin(c) * Math.cos(p0) / rho : 0)) / RAD;
    const lon = this.lon + Math.atan2(x * Math.sin(c), rho * Math.cos(c) * Math.cos(p0) - y * Math.sin(c) * Math.sin(p0)) / RAD;
    return [((lon + 540) % 360) - 180, lat];
  }
  render() {
    if (this.raf || !this.visible || document.hidden) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }
  draw() {
    const t0 = performance.now();
    const { ctx = this.canvas.getContext('2d') } = this; this.ctx = ctx;
    const c = this.c;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    // océano / esfera con luz suave
    if (this.flat) {
      ctx.fillStyle = c.surface; ctx.fillRect(0, 0, this.W, this.H);
    } else {
      const R = this.R, cx = this.W / 2, cy = this.H / 2;
      const glow = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.25);
      glow.addColorStop(0, c.accent + '33'); glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, this.W, this.H);
      const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      g.addColorStop(0, c.surface2); g.addColorStop(1, c.bg);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.stroke();
    }
    // retícula
    ctx.strokeStyle = c.line; ctx.lineWidth = 0.5; ctx.globalAlpha = 0.6;
    for (let lon = -180; lon < 180; lon += 30) this.line(Array.from({ length: 37 }, (_, i) => [lon, -90 + i * 5]));
    for (let lat = -60; lat <= 60; lat += 30) this.line(Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]));
    ctx.globalAlpha = 1;
    // países
    if (this.world) {
      for (const country of this.world.countries) {
        const on = this.visited?.has(country.cc);
        ctx.beginPath();
        for (const ring of country.r) this.ring(ring);
        ctx.fillStyle = on ? c.accent : this.visited ? c.line : c.surface2;   // en el pasaporte, más contraste para ver el mapa
        ctx.globalAlpha = on ? 0.95 : this.flat ? 1 : 0.92;
        ctx.fill();
        ctx.globalAlpha = 1; ctx.strokeStyle = on ? c.accent2 : c.line; ctx.lineWidth = 0.6; ctx.stroke();
      }
    }
    // emisoras agrupadas
    if (this.interactive) this.drawClusters();
    const dt = performance.now() - t0;
    // modo automático: si el globo tarda demasiado en este dispositivo, se pasa al mapa plano
    if (this.want === 'auto' && !this.flat && this.world && this.stations.length && dt > 40) {
      this.slowCount = (this.slowCount || 0) + 1;
      if (this.slowCount >= 3) { this.slow = true; this.flat = true; this.zoom = 1; this.clampFlat(); this.onMode?.({ auto2d: true, reason: 'El globo iba lento en este dispositivo: se muestra el mapa plano' }); this.render(); }
    }
  }
  line(pts) {
    const ctx = this.ctx; let pen = false;
    ctx.beginPath();
    for (const [lon, lat] of pts) {
      const [x, y, v] = this.proj(lon, lat);
      if (!v) { pen = false; continue; }
      if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
    }
    ctx.stroke();
  }
  ring(flat) {
    const ctx = this.ctx;
    if (!this.flat) {
      // si todo el contorno está detrás del globo no se dibuja; si está a medias, los puntos ocultos se pegan al borde
      let any = false;
      for (let i = 0; i < flat.length; i += 2) if (this.proj(flat[i], flat[i + 1])[2]) { any = true; break; }
      if (!any) return;
    }
    if (this.flat) {
      // En el mapa plano, los contornos que cruzan el antimeridiano (Rusia, Fiyi…) se «desenrollan»
      // para que no crucen todo el mapa, y se dibujan también desplazados 360° por el otro lado.
      let prev = flat[0], min = Infinity, max = -Infinity;
      const lons = [];
      for (let i = 0; i < flat.length; i += 2) {
        let lon = flat[i];
        while (lon - prev > 180) lon -= 360;
        while (prev - lon > 180) lon += 360;
        lons.push(lon); prev = lon; min = Math.min(min, lon); max = Math.max(max, lon);
      }
      const shifts = [0, ...(min < -180 ? [360] : []), ...(max > 180 ? [-360] : [])];
      for (const s of shifts) {
        for (let j = 0; j < lons.length; j++) {
          const [x, y] = this.proj(lons[j] + s, flat[j * 2 + 1]);
          if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.closePath();
      }
      return;
    }
    for (let i = 0; i < flat.length; i += 2) {
      const [x, y] = this.proj(flat[i], flat[i + 1], true);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  drawClusters() {
    const ctx = this.ctx, c = this.c, cell = 30;
    const grid = new Map();
    for (const s of this.stations) {
      const [x, y, v] = this.proj(s.lon, s.lat);
      if (!v || x < -20 || y < -20 || x > this.W + 20 || y > this.H + 20) continue;
      const key = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
      let g = grid.get(key);
      if (!g) grid.set(key, g = { x: 0, y: 0, lat: 0, lon: 0, stations: [] });
      g.x += x; g.y += y; g.lat += s.lat; g.lon += s.lon; g.stations.push(s);
    }
    this.clusters = [...grid.values()].map(g => { const n = g.stations.length; return { ...g, x: g.x / n, y: g.y / n, lat: g.lat / n, lon: g.lon / n, n }; });
    for (const g of this.clusters) {
      const r = Math.min(16, 3.5 + Math.sqrt(g.n) * 1.6);
      const sel = this.sel && g.stations.includes(this.sel.stations[0]);
      ctx.beginPath(); ctx.arc(g.x, g.y, r + 3, 0, 2 * Math.PI); ctx.fillStyle = c.accent + (sel ? '66' : '2e'); ctx.fill();
      ctx.beginPath(); ctx.arc(g.x, g.y, r, 0, 2 * Math.PI); ctx.fillStyle = sel ? c.text : c.accent; ctx.fill();
      if (g.n > 1 && r >= 7) { ctx.fillStyle = sel ? c.bg : '#1d1108'; ctx.font = `700 ${r >= 11 ? 11 : 9}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(g.n > 99 ? '99+' : String(g.n), g.x, g.y + 0.5); }
    }
    if (this.hint) this.hint.textContent = `${this.stations.length.toLocaleString('es')} emisoras con coordenadas · ${this.flat ? 'mapa plano' : 'globo'}`;
  }
  hit(x, y) {
    let best = null, bd = 24 * 24;
    for (const g of this.clusters) { const d = (g.x - x) ** 2 + (g.y - y) ** 2; if (d < bd) { bd = d; best = g; } }
    return best;
  }
  select(g) { this.sel = g; this.render(); this.onSelect?.(g); }
  zoomBy(f) { this.zoom = Math.max(1, Math.min(this.flat ? 12 : 10, this.zoom * f)); this.clampFlat(); this.render(); }
  /** Centra el mapa en un punto (con una animación breve si se permite). */
  focus(lat, lon, zoom = 3.2) {
    const from = { lat: this.lat, lon: this.lon, zoom: this.zoom }, to = { lat, lon, zoom };
    let dl = to.lon - from.lon; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
    const t0 = performance.now(), dur = reduced() ? 0 : 650;
    const step = now => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1, e = 1 - (1 - k) ** 3;
      this.lat = from.lat + (to.lat - from.lat) * e; this.lon = from.lon + dl * e; this.zoom = from.zoom + (to.zoom - from.zoom) * e;
      this.clampFlat(); this.draw();
      if (k < 1) requestAnimationFrame(step);
      else { const g = this.hit(...this.proj(lon, lat)); if (g) this.select(g); }
    };
    requestAnimationFrame(step);
  }
  bind() {
    const cv = this.canvas, pts = new Map();
    let moved = 0, last = null, pinch = null;
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.offsetX, e.offsetY]);
      this.vel = [0, 0]; cancelAnimationFrame(this.inertia); moved = 0; last = { x: e.offsetX, y: e.offsetY, t: performance.now() };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: this.zoom }; }
    });
    cv.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) {
        const g = this.hit(e.offsetX, e.offsetY); cv.style.cursor = g ? 'pointer' : 'grab'; return;
      }
      pts.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; this.zoom = Math.max(1, Math.min(10, pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d)); this.clampFlat(); this.render(); moved = 99; return; }
      const dx = e.offsetX - last.x, dy = e.offsetY - last.y, now = performance.now();
      moved += Math.abs(dx) + Math.abs(dy);
      this.pan(dx, dy);
      const dt = Math.max(1, now - last.t);
      this.vel = [dx / dt * 16, dy / dt * 16];
      last = { x: e.offsetX, y: e.offsetY, t: now };
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (moved < 6 && e.type === 'pointerup') { const g = this.hit(e.offsetX, e.offsetY); if (g) this.select(g); return; }
      if (!reduced() && !this.flat && Math.hypot(...this.vel) > 0.5) this.spin();
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    cv.addEventListener('keydown', e => {
      const step = 40;
      if (e.key === 'ArrowLeft') this.pan(step, 0); else if (e.key === 'ArrowRight') this.pan(-step, 0);
      else if (e.key === 'ArrowUp') this.pan(0, step); else if (e.key === 'ArrowDown') this.pan(0, -step);
      else if (e.key === '+' || e.key === '=') this.zoomBy(1.4); else if (e.key === '-') this.zoomBy(1 / 1.4);
      else if (e.key === 'Enter') { const g = this.hit(this.W / 2, this.H / 2) || this.clusters.sort((a, b) => ((a.x - this.W / 2) ** 2 + (a.y - this.H / 2) ** 2) - ((b.x - this.W / 2) ** 2 + (b.y - this.H / 2) ** 2))[0]; if (g) this.select(g); }
      else return;
      e.preventDefault();
    });
  }
  pan(dx, dy) {
    if (this.flat) { this.lon -= dx / this.k; this.lat += dy / this.k; this.clampFlat(); }
    else { this.lon -= dx / this.R / RAD; this.lat = Math.max(-80, Math.min(80, this.lat + dy / this.R / RAD)); }
    this.lon = ((this.lon + 540) % 360) - 180;
    this.render();
  }
  spin() {
    // inercia que se apaga sola (no hay animación constante)
    const step = () => {
      this.vel = this.vel.map(v => v * 0.92);
      if (Math.hypot(...this.vel) < 0.15 || !this.visible || document.hidden) return;
      this.pan(...this.vel); this.inertia = requestAnimationFrame(step);
    };
    this.inertia = requestAnimationFrame(step);
  }
  destroy() {
    cancelAnimationFrame(this.inertia); cancelAnimationFrame(this.raf);
    this.ro.disconnect(); this.io.disconnect(); document.removeEventListener('visibilitychange', this.onVis); this.mq.removeEventListener?.('change', this.onScheme);
  }
}

let current = null;
export async function mount(box, opts) {
  unmount();
  const m = current = new WorldMap(box, opts);
  m.setWorld(await loadWorld());
  return m;
}
export const unmount = () => { current?.destroy(); current = null; };
export const setMode = m => current?.setMode(m);
export const focus = (lat, lon) => current?.focus(lat, lon);
/** Mapa del pasaporte: países descubiertos resaltados. */
export async function mountPassport(box, { visited }) {
  unmount();
  const m = current = new WorldMap(box, { mode: '2d', visited, interactive: false });
  m.setWorld(await loadWorld());
  return m;
}
