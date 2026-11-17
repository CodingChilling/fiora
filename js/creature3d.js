// Escena 3D de «Tu criatura sonora»: una escultura de partículas (THREE.Points, una sola geometría
// con buffers) que respira, reacciona al cursor o al dedo con física de muelle (velocidad,
// amortiguación y retorno), se puede girar y acercar, y se transforma en otra criatura moviendo
// cada partícula a su nueva posición. Se carga solo cuando hace falta (import dinámico).
import * as THREE from '../vendor/three.module.min.js';
import { sample, nebula, viewOf } from './creature-shapes.js';

export function supported() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = () => Math.min(innerWidth, innerHeight) < 700 || (navigator.hardwareConcurrency || 4) <= 4;
const COUNTS = { card: [3600, 6000], full: [8000, 15000] };

const VERT = `
attribute float aSeed; attribute float aSize; attribute vec3 aTint; attribute float aKind;
uniform float uTime, uPulse, uBreath, uSpeed, uSway, uFlutter, uWave, uStream, uPixel, uFlash;
uniform vec3 uColA, uColB;
varying vec3 vColor; varying float vAlpha;
void main() {
  vec3 p = position;
  float t = uTime * uSpeed;
  float breathe = sin(t) * uBreath;
  p *= 1.0 + breathe + uPulse * 0.07 * (0.4 + aSeed);
  p += normalize(p + 0.0001) * uBreath * 0.6 * sin(t * 1.7 + aSeed * 6.2831);
  p.x += uSway * sin(t * 0.6 + p.y * 2.2);
  p.y += uWave * sin(t * 1.3 + p.x * 3.0) + uSway * 0.4 * cos(t * 0.5 + p.x);
  p += uFlutter * vec3(sin(uTime * 23.0 + aSeed * 40.0), cos(uTime * 19.0 + aSeed * 31.0), sin(uTime * 17.0 + aSeed * 23.0));
  p.x += uStream * sin(t * 2.0 + aSeed * 6.2831 + p.y * 4.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.75 + 0.25 * sin(uTime * (0.6 + aSeed * 1.6) + aSeed * 50.0);
  float flash = aKind > 1.5 ? pow(max(0.0, sin(uTime * (1.2 + aSeed * 2.0) + aSeed * 90.0)), 12.0) : 0.0;
  gl_PointSize = aSize * uPixel * (1.0 + uPulse * 0.5 + flash * 2.5) / max(0.2, -mv.z);
  vec3 base = mix(uColB, uColA, clamp(0.55 + p.y * 0.5 + (aSeed - 0.5) * 0.6, 0.0, 1.0));
  base = mix(base, vec3(1.0), 0.18 + 0.5 * step(0.9, aSeed)) * 1.25;   // un toque de luz y algunos puntos casi blancos
  vColor = mix(base, aTint, step(0.5, aKind) * (1.0 - step(1.5, aKind)) * 0.85) + vec3(flash + uFlash * 0.4);
  vAlpha = tw * (aKind > 1.5 ? 0.35 + flash : 1.0);
}`;
const FRAG = `

uniform float uOpacity, uChroma, uTime;
varying vec3 vColor; varying float vAlpha;
vec3 hue(vec3 c, float a) { const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d);
  vec3 c = uChroma > 0.0 ? hue(vColor, uChroma * sin(uTime * 0.25) * 1.6) : vColor;
  gl_FragColor = vec4(c, a * vAlpha * uOpacity);
}`;
// Hábitat: partículas de ambiente alrededor de la figura (nunca delante tapándola).
const HVERT = `
attribute float aSeed; attribute float aSize;
uniform float uTime, uPixel, uTwinkle, uWaveAmp; uniform vec3 uVel; uniform float uTravel;
varying float vAlpha;
void main() {
  vec3 p = position + uVel * uTime * (0.5 + aSeed);
  p = mod(p + 2.6, 5.2) - 2.6;
  p.y += uWaveAmp * sin(uTime * 0.8 + position.x * 1.6 + position.z * 1.3);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixel / max(0.2, -mv.z);
  float tw = mix(1.0, pow(0.5 + 0.5 * sin(uTime * (0.4 + aSeed * 2.4) + aSeed * 60.0), 3.0), uTwinkle);
  float trav = uTravel > 0.0 ? pow(fract(aSeed - uTime * 0.12), 6.0) * 1.6 + 0.25 : 1.0;
  vAlpha = tw * trav;
}`;
const HFRAG = `
uniform vec3 uColor; uniform float uOpacity; varying float vAlpha;
void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uColor, smoothstep(0.5, 0.0, d) * vAlpha * uOpacity); }`;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Posiciones de cada tipo de hábitat y sus parámetros de movimiento. */
function habitatSpec(type, n) {
  const r = rng(type.length * 977 + n), pos = new Float32Array(n * 3);
  const shell = (i, min = 1.5, max = 2.5) => { const u = r() * 2 - 1, th = r() * 6.2832, d = min + r() * (max - min), s = Math.sqrt(1 - u * u); pos.set([d * s * Math.cos(th), d * u, d * s * Math.sin(th) - 0.6], i * 3); };
  const spec = { vel: [0, 0, 0], twinkle: 0.6, wave: 0, travel: 0, size: 5 };
  for (let i = 0; i < n; i++) shell(i);
  if (type === 'stars') Object.assign(spec, { twinkle: 1, size: 6 });
  if (type === 'moon') { Object.assign(spec, { twinkle: 0.8 }); for (let i = 0; i < n * 0.35; i++) { const a = r() * 6.2832, d = Math.sqrt(r()) * 0.42; pos.set([-1.25 + d * Math.cos(a), 1.05 + d * Math.sin(a), -1.6], i * 3); } }
  if (type === 'streams') { Object.assign(spec, { vel: [0.5, 0, 0], twinkle: 0.2, wave: 0.12, size: 4 }); for (let i = 0; i < n; i++) { const band = Math.floor(r() * 5); pos.set([r() * 5.2 - 2.6, -1.2 + band * 0.55 + (r() - 0.5) * 0.12, -0.9 - r() * 0.8], i * 3); } }
  if (type === 'waves') { Object.assign(spec, { wave: 0.14, twinkle: 0.3, size: 4.5 }); for (let i = 0; i < n; i++) { const ring = 1.3 + Math.floor(r() * 5) * 0.28, a = r() * 6.2832; pos.set([ring * Math.cos(a), -1.05 + (r() - 0.5) * 0.05, ring * Math.sin(a) * 0.9], i * 3); } }
  if (type === 'routes') { Object.assign(spec, { travel: 1, twinkle: 0, size: 4.5 }); const arcs = 7; for (let i = 0; i < n; i++) { const k = i % arcs, t = r(), a0 = k * 0.9, R = 1.7 + (k % 3) * 0.25, tilt = (k - 3) * 0.28, a = a0 + t * 2.2; pos.set([R * Math.cos(a), R * Math.sin(a) * Math.sin(tilt) + Math.sin(t * 3.1416) * 0.35 - 0.2, R * Math.sin(a) * Math.cos(tilt) - 0.5], i * 3); } }
  if (type === 'sparks') Object.assign(spec, { twinkle: 1, vel: [0.05, 0.12, 0], size: 4 });
  if (type === 'chroma' || type === 'dust') Object.assign(spec, { vel: [0.03, 0.02, 0], twinkle: 0.5, size: 4.5 });
  if (type === 'dawn') { Object.assign(spec, { vel: [0, 0.07, 0], twinkle: 0.5 }); for (let i = 0; i < n; i++) pos.set([r() * 5.2 - 2.6, -1.4 + Math.pow(r(), 2.2) * 2.2, -1.2 - r() * 0.8], i * 3); }
  if (type === 'snow') Object.assign(spec, { vel: [0.02, -0.16, 0], twinkle: 0.3, size: 4.5 });
  if (type === 'hex') { Object.assign(spec, { twinkle: 0.9, size: 4 }); let i = 0; for (let row = -6; row <= 6 && i < n; row++) for (let col = -9; col <= 9 && i < n; col++) for (let k = 0; k < 6 && i < n; k++) { const cx = col * 0.52 + (row & 1) * 0.26, cy = row * 0.45, a = k * 1.0472; pos.set([cx + 0.15 * Math.cos(a), cy + 0.15 * Math.sin(a), -1.7], i * 3); i++; } }
  return { pos, ...spec };
}

/**
 * Crea la escena sobre un <canvas>. opts: { kind: 'card' | 'full', anim, habitat, mode: 'repel' | 'attract', onPick }
 */
export function create(canvas, opts = {}) {
  const kind = opts.kind || 'card';
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  const model = new THREE.Group();
  scene.add(model);

  let N = COUNTS[kind][small() ? 0 : 1];
  if (opts.quality === 'low') N = COUNTS[kind][0]; else if (opts.quality === 'high') N = COUNTS[kind][1];
  let drawN = N, dpr = Math.min(devicePixelRatio || 1, small() ? 1.5 : 2);
  const pos = new Float32Array(N * 3), home = new Float32Array(N * 3), vel = new Float32Array(N * 3);
  const seed = new Float32Array(N), size = new Float32Array(N), tint = new Float32Array(N * 3), akind = new Float32Array(N);
  const rand = rng(12345);
  for (let i = 0; i < N; i++) { seed[i] = rand(); size[i] = 9 + rand() * rand() * 22; }
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3); aPos.setUsage(THREE.DynamicDrawUsage);
  const aTint = new THREE.BufferAttribute(tint, 3), aKind = new THREE.BufferAttribute(akind, 1);
  geo.setAttribute('position', aPos); geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); geo.setAttribute('aTint', aTint); geo.setAttribute('aKind', aKind);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  const U = { uTime: { value: 0 }, uPulse: { value: 0 }, uBreath: { value: 0.02 }, uSpeed: { value: 0.6 }, uSway: { value: 0 }, uFlutter: { value: 0 }, uWave: { value: 0 },
    uStream: { value: 0 }, uPixel: { value: 1 }, uFlash: { value: 0 }, uOpacity: { value: 1 }, uChroma: { value: 0 },
    uColA: { value: new THREE.Color('#ffffff') }, uColB: { value: new THREE.Color('#8f7bff') } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  model.add(points);

  // capas de datos (anillos de fuentes, periferia de variedad): giran con la figura
  let extras = null, extraMat = null;
  // hábitat
  let hab = null, habMat = null, habOn = opts.habitat !== false, habType = '';
  // constelación
  let stars = null, starLines = null, starPts = [], starSel = -1;

  const S = { id: '', anim: opts.anim !== false && !reduced(), mode: opts.mode || 'repel', tool: 'touch', yaw: -0.35, pitch: 0.05, zoom: 1, baseYaw: -0.35, basePitch: 0.05,
    lastUser: 0, ray: null, rayUntil: 0, morph: null, energy: null, pulse: 0, visible: true, running: false, settled: 0, frames: 0, slow: 0, fps: 60, displaced: 0, disposed: false,
    motion: {}, colA: new THREE.Color(), colB: new THREE.Color(), w: 0, h: 0, time: 0 };

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h || (w === S.w && h === S.h)) return;
    S.w = w; S.h = h;
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    U.uPixel.value = (h * dpr) / 900;
    if (habMat) habMat.uniforms.uPixel.value = U.uPixel.value;
    if (extraMat) extraMat.uniforms.uPixel.value = U.uPixel.value;
    placeCamera();
  }
  function placeCamera() {
    // la figura (radio 1) cabe entera también en pantallas estrechas
    const fit = camera.aspect < 1 ? 1 / camera.aspect : 1;
    const base = 3.9 * Math.max(1, fit * 0.98);
    // En la constelación no se puede acercar más que el encuadre de todas las estrellas (si no, la
    // cámara se mete entre ellas y se ven enormes y cortadas); sí alejarse.
    camera.position.set(0, 0, starPts.length && stars ? Math.max(base, starsFit()) / Math.min(1, S.zoom) : base / S.zoom);
    camera.lookAt(0, 0, 0);
  }
  /** Distancia a la que caben todas las estrellas, con margen, en el tamaño actual del lienzo. */
  function starsFit() {
    const tv = Math.tan((camera.fov * Math.PI) / 360) * 0.8, th = tv * camera.aspect;
    let d = 0;
    for (const v of starPts) d = Math.max(d, v.z + Math.max(Math.abs(v.x) / th, Math.abs(v.y) / tv), v.z + 2);
    return d;
  }

  function applyLook(look) {
    const m = look?.motion || {};
    S.motion = m;
    U.uBreath.value = m.breath ?? 0.02; U.uSpeed.value = m.speed ?? 0.6; U.uSway.value = m.sway || 0; U.uFlutter.value = m.flutter || 0;
    U.uWave.value = m.wave || 0; U.uStream.value = m.stream || 0; U.uChroma.value = m.chroma || 0;
    S.colA.set(look?.colors?.[0] || '#ffffff'); S.colB.set(look?.colors?.[1] || '#8f7bff');
  }
  function setHabitat(type, on = habOn) {
    habOn = on;
    if (hab) { scene.remove(hab); hab.geometry.dispose(); habMat.dispose(); hab = null; habMat = null; }
    habType = type || '';
    if (!on || !type) return kick();
    const n = kind === 'full' ? (small() ? 320 : 620) : 200, sp = habitatSpec(type, n);
    const g = new THREE.BufferGeometry(), sd = new Float32Array(n), sz = new Float32Array(n), r = rng(n);
    for (let i = 0; i < n; i++) { sd[i] = r(); sz[i] = sp.size * (0.5 + r()); }
    g.setAttribute('position', new THREE.BufferAttribute(sp.pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1)); g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    habMat = new THREE.ShaderMaterial({ uniforms: { uTime: U.uTime, uPixel: { value: U.uPixel.value }, uTwinkle: { value: sp.twinkle }, uWaveAmp: { value: sp.wave }, uVel: { value: new THREE.Vector3(...sp.vel) },
      uTravel: { value: sp.travel }, uColor: { value: S.colA.clone().lerp(new THREE.Color('#ffffff'), 0.35) }, uOpacity: { value: 0.5 } },
      vertexShader: HVERT, fragmentShader: HFRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    hab = new THREE.Points(g, habMat); hab.frustumCulled = false; hab.renderOrder = -1;
    scene.add(hab);
    kick();
  }

  /** Pone un animal. Con `morph`, las partículas viajan desde la figura actual (metamorfosis). */
  function setAnimal(id, look, { morph = false, formless = false } = {}) {
    const target = formless ? nebula(N, 7) : sample(id, N);
    const first = !S.id;
    S.id = formless ? 'nebula' : id;
    const [yaw, pitch] = formless ? [0, 0.2] : viewOf(id);
    S.baseYaw = yaw; S.basePitch = pitch;
    if (first || !morph) {
      home.set(target);
      if (first) { for (let i = 0; i < N * 3; i++) pos[i] = target[i] * 1.9 + (rand() - 0.5) * 1.4; }   // entra formándose
      S.yaw = yaw; S.pitch = pitch;
      applyLook(look); U.uColA.value.copy(S.colA); U.uColB.value.copy(S.colB);
      if (formless) { U.uBreath.value = 0.05; U.uSpeed.value = 0.5; U.uStream.value = 0.05; U.uWave.value = 0.04; }
      setHabitat(look?.habitat || (formless ? 'dust' : ''), habOn);
      S.settled = 0; kick();
      return Promise.resolve();
    }
    return new Promise(done => {
      S.morph = { t: 0, stage: 0, target, look, fromA: U.uColA.value.clone(), fromB: U.uColB.value.clone(), yaw0: S.yaw, pitch0: S.pitch, done };
      applyLookColorsOnly(look);
      S.settled = 0; kick();
    });
  }
  function applyLookColorsOnly(look) { S.colA.set(look?.colors?.[0] || '#ffffff'); S.colB.set(look?.colors?.[1] || '#8f7bff'); }

  // Metamorfosis: 1) pulsos · 2) las partículas se sueltan de la silueta · 3) la nube se reordena ·
  // 4) cada punto viaja a su sitio en la nueva geometría · 5) aparece la criatura · 6) vuelve la calma.
  const M = { pulse: 0.9, loose: 1.0, travel: 1.9 };
  function stepMorph(dt) {
    const m = S.morph; m.t += dt;
    if (m.stage === 0) {
      U.uFlash.value = 0.5 + 0.5 * Math.sin(m.t * 14); S.pulse = 0.6 + 0.4 * Math.sin(m.t * 14);
      if (m.t >= M.pulse) {
        m.stage = 1;
        for (let i = 0; i < N; i++) {
          const k = i * 3, x = pos[k], y = pos[k + 1], z = pos[k + 2], l = Math.hypot(x, y, z) || 1, b = 0.9 + seed[i] * 1.6;
          vel[k] += (x / l) * b + (rand() - 0.5) * 0.8; vel[k + 1] += (y / l) * b + (rand() - 0.5) * 0.8; vel[k + 2] += (z / l) * b + (rand() - 0.5) * 0.8;
          // la nube intermedia: una esfera suelta alrededor
          const u = rand() * 2 - 1, th = rand() * 6.2832, d = 0.9 + rand() * 0.5, s = Math.sqrt(1 - u * u);
          home[k] = d * s * Math.cos(th); home[k + 1] = d * u; home[k + 2] = d * s * Math.sin(th);
        }
      }
    } else if (m.stage === 1) {
      U.uFlash.value *= 0.9;
      if (m.t >= M.pulse + M.loose) { m.stage = 2; home.set(m.target); applyLook(m.look); setHabitat(m.look?.habitat, habOn); }
    } else {
      const k = Math.min(1, (m.t - M.pulse - M.loose) / M.travel);
      if (k >= 1) { U.uFlash.value = 0; S.morph = null; m.done(); }
    }
    const k = Math.min(1, m.t / (M.pulse + M.loose + M.travel)), e = k * k * (3 - 2 * k);
    U.uColA.value.copy(m.fromA).lerp(S.colA, e); U.uColB.value.copy(m.fromB).lerp(S.colB, e);
    if (performance.now() - S.lastUser > 1500) { S.yaw = m.yaw0 + (S.baseYaw - m.yaw0) * e; S.pitch = m.pitch0 + (S.basePitch - m.pitch0) * e; }
  }

  // ------------------------------------------------------------ física
  const inv = new THREE.Matrix4(), ray = new THREE.Ray(), ndc = new THREE.Vector2(), caster = new THREE.Raycaster();
  function physics(dt) {
    const loose = S.morph && S.morph.stage === 1;
    const K = loose ? 6 : S.morph ? 16 : 34, damp = Math.exp(-(loose ? 2.2 : S.morph ? 3.4 : 5.2) * dt);
    let hasRay = false, ox = 0, oy = 0, oz = 0, dx = 0, dy = 0, dz = 0;
    if (S.ray && performance.now() < S.rayUntil && !S.morph) {
      model.updateMatrixWorld(); inv.copy(points.matrixWorld).invert();
      caster.setFromCamera(ndc.set(S.ray.x, S.ray.y), camera); ray.copy(caster.ray).applyMatrix4(inv);
      ox = ray.origin.x; oy = ray.origin.y; oz = ray.origin.z; dx = ray.direction.x; dy = ray.direction.y; dz = ray.direction.z;
      hasRay = true;
    }
    const R = 0.3, F = S.mode === 'attract' ? -9 : 12, maxD = S.mode === 'attract' ? 0.2 : 0.55;
    let moved = 0, energy = 0;
    for (let i = 0; i < drawN; i++) {
      const k = i * 3;
      let ax = (home[k] - pos[k]) * K, ay = (home[k + 1] - pos[k + 1]) * K, az = (home[k + 2] - pos[k + 2]) * K;
      if (hasRay) {
        const wx = pos[k] - ox, wy = pos[k + 1] - oy, wz = pos[k + 2] - oz, t = wx * dx + wy * dy + wz * dz;
        const px = wx - dx * t, py = wy - dy * t, pz = wz - dz * t, d = Math.hypot(px, py, pz);
        if (d < R) {
          const f = (F * (1 - d / R) * (1 - d / R)) / (d + 0.02);
          // hacia fuera del rayo (repulsión) o hacia él (atracción), con un poco de azar para que se abra en volumen
          ax += px * f + (S.mode === 'repel' ? (seed[i] - 0.5) * 3 : 0); ay += py * f; az += pz * f + (S.mode === 'repel' ? dz * 2 * (seed[i] - 0.5) : 0);
        }
      }
      vel[k] = (vel[k] + ax * dt) * damp; vel[k + 1] = (vel[k + 1] + ay * dt) * damp; vel[k + 2] = (vel[k + 2] + az * dt) * damp;
      pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt;
      const ex = pos[k] - home[k], ey = pos[k + 1] - home[k + 1], ez = pos[k + 2] - home[k + 2], e2 = ex * ex + ey * ey + ez * ez;
      if (!S.morph && e2 > maxD * maxD) { const s = maxD / Math.sqrt(e2); pos[k] = home[k] + ex * s; pos[k + 1] = home[k + 1] + ey * s; pos[k + 2] = home[k + 2] + ez * s; }
      if (e2 > 0.0004) moved++;
      energy += e2 + (vel[k] * vel[k] + vel[k + 1] * vel[k + 1] + vel[k + 2] * vel[k + 2]) * 0.01;
    }
    S.displaced = moved;
    aPos.needsUpdate = true;
    return hasRay || S.morph || energy / drawN > 1e-7;
  }

  // ------------------------------------------------------------ bucle
  let raf = 0, last = 0;
  function frame(now) {
    raf = 0;
    if (S.disposed) return;
    resize();
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    // rendimiento: si va lento, menos partículas y menos resolución
    S.frames++; if (dt > 0.03) S.slow++;
    if (S.frames >= 90) {
      S.fps = Math.round(1 / Math.max(0.001, dt));
      if (S.slow > 45 && drawN > 2400) { drawN = Math.max(2400, Math.round(drawN * 0.7)); geo.setDrawRange(0, drawN); if (dpr > 1) { dpr = Math.max(1, dpr - 0.5); S.w = 0; } }
      S.frames = 0; S.slow = 0;
    }
    if (S.anim || S.morph) S.time += dt;
    U.uTime.value = S.time;
    if (S.morph) stepMorph(dt);
    else {
      // sonido real (si hay envolvente) o pulso ambiental propio de la especie
      const e = S.energy ? S.energy() : null;
      const target = e != null ? e : S.anim ? (S.motion.pulse || 0.12) * (0.5 + 0.5 * Math.sin(S.time * 1.1)) : 0;
      S.pulse += (target - S.pulse) * Math.min(1, dt * (e != null ? 14 : 3));
    }
    U.uPulse.value = S.pulse;
    const busy = physics(dt);
    if (S.anim && !S.morph && performance.now() - S.lastUser > 3500 && !stars) S.yaw += (S.baseYaw + Math.sin(S.time * 0.22) * 0.28 - S.yaw) * Math.min(1, dt * 0.8);
    model.rotation.set(S.pitch, S.yaw, 0);
    if (extras) extras.rotation.y = S.time * 0.12;
    renderer.render(scene, camera);
    S.settled = busy ? 0 : S.settled + 1;
    if (S.visible && (S.anim || busy || S.settled < 20)) raf = requestAnimationFrame(frame); else { S.running = false; last = 0; }
  }
  function kick() { if (!raf && !S.disposed && S.visible) { S.running = true; raf = requestAnimationFrame(frame); } }

  // ------------------------------------------------------------ gestos
  const pointers = new Map();
  let drag = null, pinch = null;
  const setRay = e => { const r = canvas.getBoundingClientRect(); S.ray = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }; S.rayUntil = performance.now() + (e.pointerType === 'touch' ? 260 : 900); kick(); };
  /** ¿El punto cae sobre la figura? (radio proyectado en pantalla) */
  function onFigure(e) {
    const r = canvas.getBoundingClientRect(), cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
    const px = (r.height / 2) / Math.tan((camera.fov * Math.PI) / 360) / camera.position.z;   // píxeles por unidad en el origen
    return Math.hypot(cx, cy) < px * 0.85;
  }
  const rotateBy = (dyaw, dpitch) => { S.yaw += dyaw; S.pitch = Math.max(-0.95, Math.min(0.95, S.pitch + dpitch)); S.lastUser = performance.now(); S.settled = 0; kick(); };
  const zoomBy = f => { S.zoom = Math.max(0.6, Math.min(stars ? 1 : 2.6, S.zoom * f)); placeCamera(); S.lastUser = performance.now(); S.settled = 0; kick(); };
  function down(e) {
    pointers.set(e.pointerId, e);
    if (kind === 'full') { try { canvas.setPointerCapture(e.pointerId); } catch { /* sin captura */ } }
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; drag = null; S.ray = null; return; }
    const touch = e.pointerType === 'touch';
    // dedo: sobre la figura mueve partículas; fuera (o con la herramienta «girar») la gira. Ratón: arrastrar gira.
    const deform = touch && (kind === 'card' || (S.tool === 'touch' && onFigure(e)));
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, deform, moved: false, touch };
    if (deform || !touch) setRay(e);
  }
  function move(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x = (a.clientX + b.clientX) / 2, y = (a.clientY + b.clientY) / 2;
      zoomBy(d / (pinch.d || d)); rotateBy((x - pinch.x) * 0.008, (y - pinch.y) * 0.006);
      pinch = { d, x, y }; return;
    }
    if (!drag) { if (e.pointerType !== 'touch') setRay(e); return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) drag.moved = true;
    if (drag.touch && kind === 'card') { setRay(e); rotateBy(dx * 0.008, 0); return; }     // en la tarjeta: tocar deforma y deslizar en horizontal gira
    if (drag.deform) return setRay(e);
    rotateBy(dx * 0.008, kind === 'full' || !drag.touch ? dy * 0.006 : 0);
  }
  function up(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && stars && opts.onPick) { const i = pickStar(e); if (i >= 0) opts.onPick(i); }
    if (drag?.touch) S.rayUntil = performance.now() + 120;
    drag = null;
  }
  const leave = () => { S.ray = null; };
  const wheel = e => { if (kind !== 'full') return; e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.08 : 0.925); };
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.style.touchAction = kind === 'full' ? 'none' : 'pan-y';

  const io = new IntersectionObserver(es => { S.visible = es[0].isIntersecting && !document.hidden; if (S.visible) kick(); }, { threshold: 0.05 });
  io.observe(canvas);
  const vis = () => { S.visible = !document.hidden; if (S.visible) kick(); };
  document.addEventListener('visibilitychange', vis);
  const ro = new ResizeObserver(() => { S.settled = 0; kick(); });
  ro.observe(canvas);

  // ------------------------------------------------- datos en las partículas
  /**
   * layers: { genres: [{color, share}], variety: 0–100 | null, discoveries: n, sources: [{color, share}] }
   * Colores secundarios por género, periferia según variedad, destellos por descubrimientos y anillos por fuente.
   */
  function setData(layers = {}) {
    akind.fill(0);
    let i = 0;
    const tinted = Math.round(N * 0.3);
    for (const g of layers.genres || []) {
      const c = new THREE.Color(g.color), n = Math.round(tinted * g.share);
      for (let k = 0; k < n && i < N; k++, i++) { const j = Math.floor(seed[i] * 7919 + i * 31) % N; tint.set([c.r, c.g, c.b], j * 3); akind[j] = 1; }
    }
    const disc = Math.min(layers.discoveries || 0, 60);
    for (let k = 0; k < disc; k++) akind[(k * 197 + 13) % N] = 2;
    aTint.needsUpdate = true; aKind.needsUpdate = true;
    if (extras) { model.remove(extras); extras.geometry.dispose(); extraMat.dispose(); extras = null; }
    const pts = [], cols = [], r = rng(99);
    const ring = (radius, from, share, color) => { const c = new THREE.Color(color), n = Math.round(260 * share); for (let k = 0; k < n; k++) { const a = from + (k / Math.max(1, n)) * share * 6.2832; pts.push(radius * Math.cos(a), (r() - 0.5) * 0.02, radius * Math.sin(a)); cols.push(c.r, c.g, c.b); } };
    let from = 0;
    for (const s of layers.sources || []) { ring(1.32, from, s.share, s.color); from += s.share * 6.2832; }
    const per = layers.variety == null ? 0 : Math.round((layers.variety / 100) * 140);
    for (let k = 0; k < per; k++) { const u = r() * 2 - 1, th = r() * 6.2832, d = 1.12 + r() * 0.3, s = Math.sqrt(1 - u * u); pts.push(d * s * Math.cos(th), d * u, d * s * Math.sin(th)); cols.push(1, 1, 1); }
    if (pts.length) {
      const g = new THREE.BufferGeometry(), n = pts.length / 3, sd = new Float32Array(n), sz = new Float32Array(n), kd = new Float32Array(n);
      for (let k = 0; k < n; k++) { sd[k] = r(); sz[k] = 6 + r() * 4; kd[k] = 1; }
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3)); g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(cols), 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1)); g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1)); g.setAttribute('aKind', new THREE.BufferAttribute(kd, 1));
      const z = { value: 0 };
      extraMat = new THREE.ShaderMaterial({ uniforms: { ...U, uBreath: z, uSway: z, uFlutter: z, uWave: z, uStream: z, uPulse: z, uFlash: z, uChroma: z, uOpacity: { value: 0.75 }, uPixel: { value: U.uPixel.value } },
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      extras = new THREE.Points(g, extraMat); extras.frustumCulled = false; extras.rotation.x = 0.18;
      model.add(extras);
    }
    kick();
  }

  // ------------------------------------------------------------ constelación
  function setConstellation(n, selected = -1) {
    if (stars) { scene.remove(stars); scene.remove(starLines); stars.geometry.dispose(); stars.material.dispose(); starLines.geometry.dispose(); starLines.material.dispose(); stars = starLines = null; }
    starSel = selected;
    points.visible = !n; if (extras) extras.visible = !n;
    if (!n) { placeCamera(); return kick(); }
    const r = rng(n * 31 + 5); starPts = [];
    // en un óvalo compacto alrededor del centro (más juntas que la figura, que mide 1 de radio)
    for (let i = 0; i < n; i++) { const a = (i / n) * 6.2832 + (r() - 0.5) * 0.4, d = 0.42 + r() * 0.36; starPts.push(new THREE.Vector3(d * Math.cos(a) * 1.15, d * Math.sin(a) * 0.75 + (r() - 0.5) * 0.12, (r() - 0.5) * 0.4)); }
    const p = new Float32Array(n * 3), sd = new Float32Array(n), sz = new Float32Array(n);
    starPts.forEach((v, i) => { p.set([v.x, v.y, v.z], i * 3); sd[i] = r(); sz[i] = i === selected ? 34 : 24; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1)); g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    stars = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { uTime: U.uTime, uPixel: U.uPixel, uTwinkle: { value: 0.35 }, uWaveAmp: { value: 0 }, uVel: { value: new THREE.Vector3() }, uTravel: { value: 0 }, uColor: { value: new THREE.Color('#ffffff') }, uOpacity: { value: 1 } },
      vertexShader: HVERT, fragmentShader: HFRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    stars.frustumCulled = false;
    const lp = [];
    for (let i = 0; i < n; i++) { const a = starPts[i], b = starPts[(i + 1) % n]; lp.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
    starLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: S.colA.clone().lerp(new THREE.Color('#ffffff'), 0.5), transparent: true, opacity: 0.22 }));
    scene.add(starLines); scene.add(stars);
    S.zoom = Math.min(S.zoom, 1);
    placeCamera();
    kick();
  }
  function pickStar(e) {
    const r = canvas.getBoundingClientRect(); let best = -1, bd = 34;
    starPts.forEach((v, i) => { const q = v.clone().project(camera), x = ((q.x + 1) / 2) * r.width + r.left, y = ((1 - q.y) / 2) * r.height + r.top, d = Math.hypot(x - e.clientX, y - e.clientY); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  /** Posición en pantalla de cada estrella (para pruebas y para el foco accesible). */
  const starScreen = () => { const r = canvas.getBoundingClientRect(); return starPts.map(v => { const q = v.clone().project(camera); return { x: ((q.x + 1) / 2) * r.width + r.left, y: ((1 - q.y) / 2) * r.height + r.top }; }); };

  resize();
  return {
    setAnimal, setData, setHabitat: on => setHabitat(habType || S.lastHab, on), setConstellation, starScreen,
    setMode(m) { S.mode = m; }, setTool(t) { S.tool = t; },
    setAnim(on) { S.anim = !!on && !reduced(); kick(); },
    setEnergy(fn) { S.energy = fn; kick(); },
    rotateBy, zoomBy,
    resetView() { S.yaw = S.baseYaw; S.pitch = S.basePitch; S.zoom = 1; placeCamera(); S.lastUser = 0; S.settled = 0; kick(); },
    /** Dibuja ahora mismo y devuelve el lienzo (para exportar la imagen en el mismo instante). */
    renderNow() { resize(); model.rotation.set(S.pitch, S.yaw, 0); renderer.render(scene, camera); return canvas; },
    get morphing() { return !!S.morph; },
    debug: () => ({ id: S.id, count: N, drawn: drawN, displaced: S.displaced, yaw: S.yaw, pitch: S.pitch, zoom: S.zoom, running: S.running, anim: S.anim, morph: S.morph ? S.morph.stage : -1,
      habitat: hab ? habType : '', mode: S.mode, pulse: S.pulse, energy: !!S.energy, stars: starPts.length && stars ? starPts.length : 0, extras: extras ? extras.geometry.attributes.position.count : 0, fps: S.fps }),
    dispose() {
      S.disposed = true; cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', vis);
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('wheel', wheel);
      setConstellation(0);
      for (const o of [points, hab, extras]) if (o) { o.geometry.dispose(); o.material.dispose(); }
      renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* ya perdido */ }
    },
  };
}
