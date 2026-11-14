// Genera data/world.json (fronteras de países para el Atlas y el Pasaporte) a partir de
// Natural Earth 1:110m (dominio público) distribuido en el paquete npm `world-atlas`.
// Solo se ejecuta al preparar los datos; la app no carga ninguna de estas dependencias.
//   npm i world-atlas@2.0.2 i18n-iso-countries@7.11.3 topojson-client@3.1.0
//   node tools/make-world.mjs [carpeta con node_modules]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(resolve(process.argv[2] || '.', 'package.json'));
const topo = require('world-atlas/countries-110m.json');
const { feature } = require('topojson-client');
const iso = require('i18n-iso-countries');
const r1 = n => Math.round(n * 10) / 10;   // 0,1° basta para un mapa a esta escala
const out = [];
for (const f of feature(topo, topo.objects.countries).features) {
  const a2 = iso.numericToAlpha2(f.id) || (f.properties.name === 'Kosovo' ? 'XK' : '');
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];
  for (const poly of polys) for (const ring of poly.slice(0, 1)) {   // solo el contorno exterior
    const pts = [];
    for (const [x, y] of ring) { const p = [r1(x), r1(y)]; const l = pts[pts.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) pts.push(p); }
    if (pts.length >= 4) rings.push(pts.flat());
  }
  if (rings.length) out.push({ cc: a2, n: f.properties.name, r: rings });
}
const file = resolve(new URL('..', import.meta.url).pathname, 'data/world.json');
writeFileSync(file, JSON.stringify({ source: 'Natural Earth 1:110m (dominio público) vía world-atlas', countries: out }));
console.log(out.length, 'países →', file);
