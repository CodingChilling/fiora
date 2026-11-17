// Sirve la app (la raíz del repositorio) en http://localhost:8765 para las pruebas.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
// /__slow?ms=N retrasa todas las respuestas N ms (una conexión que «parece» funcionar pero no carga).
let slow = 0;
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__slow') { slow = +(u.searchParams.get('ms') || 0); res.setHeader('Access-Control-Allow-Origin', '*'); return res.end(String(slow)); }
  if (slow) await new Promise(r => setTimeout(r, slow));
  const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(+(process.env.PORT || 8765), () => console.log('app en http://localhost:' + (process.env.PORT || 8765)));
