// Emulador mínimo de Oracle Cloud Object Storage para las pruebas de compartir el bucket.
//   PAR de bucket:  GET {par}            lista (solo si la PAR tiene listado)
//                   GET {par}{nombre}    descarga (admite Range)
//                   PUT {par}{nombre}    subida (solo si la PAR permite escribir)
//   API firmada:    GET    /n/{ns}/b/{bucket}               datos del bucket (comprobar la clave)
//                   DELETE /n/{ns}/b/{bucket}/o/{nombre}    borrar un objeto
//                   GET    /n/{ns}/b/{bucket}/p             listar PAR
//                   POST   /n/{ns}/b/{bucket}/p             crear PAR
//                   DELETE /n/{ns}/b/{bucket}/p/{id}        revocar PAR
// Las firmas se comprueban como Oracle: con la clave pública de `fixtures/pub.pem`, la lista de
// cabeceras de Authorization y, con cuerpo, x-content-sha256, content-type y content-length.
// Como en Oracle, una PAR de lectura («AnyObjectRead») no puede escribir ni borrar, y una PAR
// revocada o caducada responde 404.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

const PORT = +(process.env.ORACLE_PORT || 8769);
const NS = 'ns', BUCKET = 'musica';
const PUB = fs.readFileSync(new URL('./fixtures/pub.pem', import.meta.url), 'utf8');
const KEYID = fs.readFileSync(new URL('./fixtures/keyid.txt', import.meta.url), 'utf8').trim();

const wav = n => { const sr = 8000, len = sr + n, b = Buffer.alloc(44 + len); b.write('RIFF', 0); b.writeUInt32LE(36 + len, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(len, 40); b.fill(128, 44); return b; };
const store = new Map();   // nombre -> Buffer
const pars = new Map();    // token -> {id, name, accessType, listing, expires, created}
const log = [];
function reset() {
  store.clear(); pars.clear(); log.length = 0;
  store.set('Rosalía/Sueltas/Rosalía - Despechá.wav', wav(11));
  store.set('Bad Bunny/Sueltas/Bad Bunny - Tití.wav', wav(22));
  store.set('Otro/Sueltas/Otro - Única.wav', wav(33));
  // Copia de datos personales que guardaban versiones anteriores (debe desaparecer).
  store.set('_fiora/datos.json', Buffer.from(JSON.stringify({ v: 2, playlists: [{ id: 'pdueno', name: 'Secreta del dueño', trackIds: [], updatedAt: Date.now() }], favs: {}, stats: {} })));
  // La PAR del propietario: lectura, escritura y listado, creada en la consola (no por Fiora).
  pars.set('dueno', { id: 'id-dueno', name: 'mis dispositivos', accessType: 'AnyObjectReadWrite', listing: 'ListObjects', expires: Date.now() + 365 * 864e5, created: Date.now() });
}
reset();

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,PUT,GET,HEAD,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'authorization,x-date,x-content-sha256,content-type,range', 'Access-Control-Expose-Headers': 'content-range,etag' };
const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { ...cors, 'Content-Type': type }); res.end(body === undefined ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = req => new Promise(ok => { const ch = []; req.on('data', c => ch.push(c)); req.on('end', () => ok(Buffer.concat(ch))); });
const summary = p => ({ id: p.id, name: p.name, accessType: p.accessType, bucketListingAction: p.listing, objectName: null, timeExpires: new Date(p.expires).toISOString(), timeCreated: new Date(p.created).toISOString() });

function verify(req, body) {
  const f = Object.fromEntries([...(req.headers.authorization || '').matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  const names = (f.headers || '').split(' ');
  const need = ['(request-target)', 'host', 'x-date', ...(body !== null ? ['x-content-sha256', 'content-type', 'content-length'] : [])];
  if (f.keyId !== KEYID || f.algorithm !== 'rsa-sha256' || f.version !== '1' || need.some(n => !names.includes(n))) return false;
  if (Math.abs(Date.parse(req.headers['x-date']) - Date.now()) > 300000) return false;
  if (body !== null) {
    if (req.headers['x-content-sha256'] !== crypto.createHash('sha256').update(body).digest('base64')) return false;
    if (+req.headers['content-length'] !== body.length) return false;
  }
  const signing = names.map(n => (n === '(request-target)' ? `${n}: ${req.method.toLowerCase()} ${req.url}` : `${n}: ${req.headers[n]}`)).join('\n');
  return crypto.verify('sha256', Buffer.from(signing), PUB, Buffer.from(f.signature || '', 'base64'));
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200);
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__log') return send(res, 200, { log, objects: [...store].map(([n, b]) => [n, b.length]), pars: [...pars].map(([t, p]) => ({ token: t, ...summary(p) })) });
  if (u.pathname === '/__reset') { reset(); return send(res, 200, {}); }

  // --- PAR
  const m = u.pathname.match(/^\/p\/([^/]+)\/n\/ns\/b\/musica\/o\/(.*)$/);
  if (m) {
    const p = pars.get(m[1]), name = decodeURIComponent(m[2]);
    log.push(`PAR ${m[1]} ${req.method} ${name || '(lista)'}`);
    if (!p || p.expires < Date.now()) return send(res, 404, { code: 'NotFound' });
    const canRead = /Read/.test(p.accessType), canWrite = /Write/.test(p.accessType);
    if (req.method === 'GET' && !name) {
      if (p.listing !== 'ListObjects') return send(res, 403, { code: 'ListObjectsNotAllowed' });
      const objects = [...store].map(([n, b]) => ({ name: n, size: b.length, etag: crypto.createHash('md5').update(b).digest('hex'), timeModified: new Date(0).toISOString() }));
      return send(res, 200, { objects });
    }
    if (req.method === 'GET') {
      if (!canRead) return send(res, 403, { code: 'NotAllowed' });
      const b = store.get(name);
      if (!b) return send(res, 404, { code: 'ObjectNotFound' });
      const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      if (r) { const a = +r[1], z = Math.min(b.length - 1, r[2] ? +r[2] : b.length - 1); res.writeHead(206, { ...cors, 'Content-Range': `bytes ${a}-${z}/${b.length}` }); return res.end(b.subarray(a, z + 1)); }
      return send(res, 200, b, 'application/octet-stream');
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (!canWrite) return send(res, 403, { code: 'NotAllowed' });
      store.set(name, body);
      return send(res, 200);
    }
    return send(res, 405, { code: 'MethodNotAllowed' });   // las PAR nunca permiten borrar
  }

  // --- API firmada
  const a = u.pathname.match(/^\/n\/ns\/b\/musica(?:\/(o|p)(?:\/(.+))?)?$/);
  if (a) {
    const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : null;
    const good = verify(req, body);
    const what = a[1] === 'p' ? `PAR ${a[2] ? decodeURIComponent(a[2]) : ''}`.trim() : a[1] === 'o' ? decodeURIComponent(a[2] || '') : '(bucket)';
    log.push(`API ${req.method} ${what} ${good ? 'firmada' : 'MAL'}`);
    if (!good) return send(res, 401, { code: 'NotAuthenticated' });
    if (!a[1] && req.method === 'GET') return send(res, 200, { name: BUCKET, namespace: NS });
    if (a[1] === 'o' && req.method === 'DELETE' && a[2]) {
      const n = decodeURIComponent(a[2]);
      if (!store.delete(n)) return send(res, 404, { code: 'ObjectNotFound' });
      return send(res, 204);
    }
    if (a[1] === 'p' && !a[2] && req.method === 'GET') return send(res, 200, [...pars.values()].map(summary));
    if (a[1] === 'p' && !a[2] && req.method === 'POST') {
      let d; try { d = JSON.parse(body); } catch { return send(res, 400, { code: 'InvalidParameter' }); }
      if (!d.name || !['ObjectRead', 'ObjectWrite', 'ObjectReadWrite', 'AnyObjectWrite', 'AnyObjectRead', 'AnyObjectReadWrite'].includes(d.accessType) || !['Deny', 'ListObjects', undefined].includes(d.bucketListingAction) || !Date.parse(d.timeExpires)) return send(res, 400, { code: 'InvalidParameter' });
      const token = crypto.randomBytes(12).toString('base64url');
      const p = { id: crypto.randomBytes(16).toString('base64') + ':', name: d.name, accessType: d.accessType, listing: d.bucketListingAction || 'Deny', expires: Date.parse(d.timeExpires), created: Date.now() };
      pars.set(token, p);
      return send(res, 200, { ...summary(p), accessUri: `/p/${token}/n/${NS}/b/${BUCKET}/o/` });
    }
    if (a[1] === 'p' && a[2] && req.method === 'DELETE') {
      const id = decodeURIComponent(a[2]);
      const hit = [...pars].find(([, p]) => p.id === id);
      if (!hit) return send(res, 404, { code: 'NotFound' });
      pars.delete(hit[0]);
      return send(res, 204);
    }
    return send(res, 400, { code: 'InvalidParameter' });
  }
  send(res, 404, { code: 'NotFound' });
}).listen(PORT, () => console.log('Oracle simulado en http://localhost:' + PORT));
