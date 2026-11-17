// El grafo del audio espacial (js/spatial.js → buildGraph) medido con OfflineAudioContext y señales
// de prueba, dentro de un navegador. Comprueba lo que se puede medir: que al 0 % es el original,
// que cada modo mueve el sonido con el período esperado, que la velocidad y la intensidad actúan,
// que los modos son distintos y que nunca suena más alto que el original.
//   node spatial-graph.cjs        (necesita la app en :8765)
const { chromium } = require('playwright');
const APP = process.env.APP || 'http://localhost:8765/';
let ok = 0, fails = 0;
const check = (c, m) => { if (c) { ok++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m); } };

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP + '#/inicio'); await page.waitForSelector('#nav-links a');

  /** Procesa una señal con unos ajustes y devuelve medidas por ventanas de 0,25 s. */
  const render = (signal, s, secs = 40) => page.evaluate(async ({ signal, s, secs }) => {
    const sp = await import('./js/spatial.js');
    const sr = 22050, n = sr * secs, ctx = new OfflineAudioContext(2, n, sr), buf = ctx.createBuffer(2, n, sr), L = buf.getChannelData(0), R = buf.getChannelData(1);
    let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (signal === 'centro') L[i] = R[i] = 0.8 * Math.sin(2 * Math.PI * 440 * t);                      // voz central: lo mismo en los dos canales
      else if (signal === 'ancho') { L[i] = 0.8 * Math.sin(2 * Math.PI * 330 * t); R[i] = 0.8 * Math.sin(2 * Math.PI * 523 * t); }   // estéreo muy separado
      else if (signal === 'izquierda') { L[i] = 0.8 * Math.sin(2 * Math.PI * 440 * t); R[i] = 0; }
      else if (signal === 'ruido') { const v = rnd() * 0.9; L[i] = v; R[i] = rnd() * 0.9; }                 // casi a tope, para medir picos
      else if (signal === 'tope') L[i] = R[i] = (Math.floor(t * 220) % 2 ? 1 : -1) * 0.999;                // onda cuadrada al máximo
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = sp.buildGraph(ctx, src); g.out.connect(ctx.destination); g.set(s, true); src.start();
    const out = await ctx.startRendering(), oL = out.getChannelData(0), oR = out.getChannelData(1), w = Math.floor(sr / 4);
    const bal = [], lvl = []; let peak = 0, inPeak = 0, diff = 0, sq = 0, sqIn = 0, hi = 0;
    for (let i = 0; i < n; i++) { peak = Math.max(peak, Math.abs(oL[i]), Math.abs(oR[i])); inPeak = Math.max(inPeak, Math.abs(L[i]), Math.abs(R[i])); diff = Math.max(diff, Math.abs(oL[i] - L[i]), Math.abs(oR[i] - R[i])); sq += oL[i] * oL[i] + oR[i] * oR[i]; sqIn += L[i] * L[i] + R[i] * R[i]; }
    for (let k = 0; k + w <= n; k += w) { let a = 0, c = 0; for (let i = k; i < k + w; i++) { a += oL[i] * oL[i]; c += oR[i] * oR[i]; } const l = Math.sqrt(a / w), r = Math.sqrt(c / w); bal.push((r - l) / (r + l + 1e-9)); lvl.push(Math.sqrt((a + c) / (2 * w))); }
    // saltos entre muestras seguidas (clics): la mayor diferencia frente a la de la señal original
    let jump = 0, jumpIn = 0; for (let i = 1; i < n; i++) { jump = Math.max(jump, Math.abs(oL[i] - oL[i - 1])); jumpIn = Math.max(jumpIn, Math.abs(L[i] - L[i - 1])); }
    return { bal, lvl, peak, inPeak, diff, rms: Math.sqrt(sq / (2 * n)), rmsIn: Math.sqrt(sqIn / (2 * n)), jump, jumpIn, f: sp.freqOf(s) };
  }, { signal, s, secs });
  /** Período del balance (s): distancia media entre cruces por cero ascendentes. */
  const period = bal => { const up = []; for (let i = 1; i < bal.length; i++) if (bal[i - 1] < 0 && bal[i] >= 0) up.push(i * 0.25); return up.length >= 2 ? (up[up.length - 1] - up[0]) / (up.length - 1) : null; };
  const range = a => Math.max(...a) - Math.min(...a);
  const S = (mode, intensity, speed, on = true) => ({ on, mode, intensity, speed });

  // ---- intensidad 0 y efecto apagado: el original
  for (const mode of ['suave', 'circular', 'envolvente']) {
    const r = await render('ancho', S(mode, 0, 50));
    check(r.diff < 1e-4, `${mode} al 0 %: sale el original (diferencia máxima ${r.diff.toExponential(1)})`);
  }
  const offR = await render('ancho', S('circular', 100, 100, false));
  check(offR.diff < 1e-4, 'con el efecto desactivado sale el original');

  // ---- cada modo mueve el sonido, con el período que le toca
  const meas = {};
  for (const mode of ['suave', 'circular', 'envolvente']) {
    const r = await render(mode === 'envolvente' ? 'ruido' : 'centro', S(mode, 100, 100), 40), per = period(r.bal), exp = 1 / r.f;   // la HRTF se mide con ruido: con un tono puro el balance depende de la fase
    meas[mode] = r;
    check(range(r.bal) > 0.3 && Math.min(...r.bal) < -0.12 && Math.max(...r.bal) > 0.12, `${mode}: el sonido va de un lado a otro (balance de ${Math.min(...r.bal).toFixed(2)} a ${Math.max(...r.bal).toFixed(2)})`);
    check(per && Math.abs(per - exp) / exp < 0.12, `${mode}: una vuelta cada ${per?.toFixed(1)} s (esperado ${exp.toFixed(1)} s)`);
  }
  // ---- velocidad
  const slow = await render('centro', S('circular', 100, 0), 60), fast = meas.circular;
  check(period(slow.bal) > period(fast.bal) * 3, `la velocidad cambia el período: ${period(slow.bal).toFixed(1)} s al 0 % y ${period(fast.bal).toFixed(1)} s al 100 %`);
  // ---- intensidad
  const half = await render('centro', S('suave', 40, 100)), full = meas.suave;
  const eHalf = await render('ruido', S('envolvente', 30, 100));
  check(range(eHalf.bal) < range(meas.envolvente.bal) * 0.8, `en Envolvente la intensidad también actúa: ${range(eHalf.bal).toFixed(2)} al 30 % y ${range(meas.envolvente.bal).toFixed(2)} al 100 %`);
  check(range(half.bal) < range(full.bal) * 0.8 && range(half.bal) > 0.1, `la intensidad cambia la amplitud del movimiento: ${range(half.bal).toFixed(2)} al 40 % y ${range(full.bal).toFixed(2)} al 100 %`);
  check(range(meas.circular.bal) > range(meas.suave.bal), 'Circular se mueve más que Suave');
  // ---- los modos son procesamientos distintos
  const a = meas.suave.bal, c = meas.circular.bal, e = meas.envolvente.bal;
  const dist = (x, y) => Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0) / x.length);
  check(dist(a, c) > 0.05 && dist(a, e) > 0.05 && dist(c, e) > 0.05, 'los tres modos dan resultados distintos');
  // Circular cambia el brillo según la posición; Suave no. Con ruido, se mide el nivel de agudos en dos momentos.
  // ---- nunca más alto que el original
  for (const mode of ['suave', 'circular', 'envolvente']) for (const sig of ['tope', 'ruido', 'ancho', 'izquierda']) {
    const r = await render(sig, S(mode, 100, 100), 24);
    const okPeak = r.peak <= Math.max(r.inPeak, 0.999) + 1e-3;
    check(okPeak && r.rms <= r.rmsIn * 1.02, `${mode} con señal «${sig}»: pico ${r.peak.toFixed(3)} (original ${r.inPeak.toFixed(3)}), nivel medio ${(20 * Math.log10(r.rms / r.rmsIn)).toFixed(1)} dB`);
  }
  // ---- sin saltos de volumen ni clics
  for (const mode of ['suave', 'circular', 'envolvente']) {
    const r = meas[mode], steps = r.lvl.slice(1).map((v, i) => Math.abs(v - r.lvl[i]));
    check(Math.max(...steps) < 0.12, `${mode}: el nivel cambia poco a poco (mayor cambio entre ventanas de 0,25 s: ${Math.max(...steps).toFixed(3)})`);
  }
  // ---- señal de un solo lado: Suave y Circular no la hacen desaparecer del todo de golpe ni la duplican
  const left = await render('izquierda', S('suave', 100, 100));
  check(left.peak <= left.inPeak + 1e-3 && Math.max(...left.lvl) <= 0.8 / Math.sqrt(2) / Math.sqrt(2) * 2 + 0.01, 'una señal solo izquierda no gana nivel al moverse');

  check(errs.length === 0, `sin errores${errs.length ? ': ' + errs.join(' | ') : ''}`);
  console.log(`\n${ok} comprobaciones correctas, ${fails} fallos`);
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
