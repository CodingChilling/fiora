// Emulador mínimo de Supabase para las pruebas: Auth, REST (/rest/v1/rpc/*, fiora_datos, plays)
// y Storage. Las llamadas de datos se ejecutan en PostgreSQL REAL con la migración aplicada, como
// rol `authenticated` y con auth.uid() = usuario del token, así que RLS y las funciones son las de
// verdad. Storage guarda los bytes en memoria pero aplica el límite, los tipos y las políticas RLS
// de storage.objects leyendo la configuración del bucket desde la propia base de datos.
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

// Conexión a PostgreSQL: variables PGHOST / PGPORT / PGUSER (por defecto, el servidor local de las pruebas).
const conn = db => new pg.Pool({ host: process.env.PGHOST || '/var/lib/postgresql/fiora-test', port: +(process.env.PGPORT || 54329), user: process.env.PGUSER || 'postgres', database: db });
const pools = { mig: conn('sbtest'), nomig: conn('sbnomig') };
let mode = 'mig';
const pool = () => pools[mode];
const users = new Map();     // email -> {id, email}
const tokens = new Map();    // token -> id
const files = new Map();     // `${bucket}/${path}` -> {buf, mime}
const datos = new Map();     // id -> objeto
let cutUploads = 0, slowUploadMs = 0;
const log = [];

async function asUser(uid, fn) {
  const c = await pool().connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = req => new Promise((ok, ko) => { const ch = []; req.on('data', c => ch.push(c)); req.on('end', () => ok(Buffer.concat(ch))); req.on('error', ko); });
const pgError = (res, e) => {
  if (e.code === '42883' || e.code === '42P01') return send(res, 404, { code: e.code === '42883' ? 'PGRST202' : 'PGRST205', message: `Could not find: ${e.message}` });
  return send(res, e.code === '42501' ? 403 : 400, { code: e.code, message: e.message, details: e.detail || null, hint: null });
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return send(res, 204);
  const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
  const uid = tokens.get(auth);
  try {
    // ---------------------------------------------------- utilidades de la prueba
    if (u.pathname === '/__mode') { mode = u.searchParams.get('db'); return send(res, 200, { mode }); }
    if (u.pathname === '/__cut') { cutUploads = +u.searchParams.get('n'); slowUploadMs = +(u.searchParams.get('slow') || 0); return send(res, 200, { cutUploads }); }
    if (u.pathname === '/__files') return send(res, 200, [...files].map(([k, v]) => [k, v.buf.length, v.mime]));
    if (u.pathname === '/__log') return send(res, 200, log);
    if (u.pathname === '/__sql') { const r = await pool().query((await readBody(req)).toString()); return send(res, 200, r.rows); }
    // ---------------------------------------------------- Auth
    if (u.pathname === '/auth/v1/token') {
      const b = JSON.parse((await readBody(req)).toString() || '{}');
      let user;
      if (u.searchParams.get('grant_type') === 'password') {
        user = users.get(b.email);
        if (!user) {
          user = { id: crypto.randomUUID(), email: b.email };
          users.set(b.email, user);
          for (const p of Object.values(pools)) await p.query('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [user.id, user.email]);
        }
      } else {
        const id = tokens.get(b.refresh_token?.replace(/^r-/, ''));
        user = [...users.values()].find(x => x.id === id);
        if (!user) return send(res, 400, { error_code: 'invalid_grant', msg: 'Invalid Refresh Token' });
      }
      const t = crypto.randomUUID();
      tokens.set(t, user.id);
      return send(res, 200, { access_token: t, refresh_token: 'r-' + t, expires_in: 3600, user });
    }
    if (u.pathname === '/auth/v1/user') { const user = [...users.values()].find(x => x.id === uid); return user ? send(res, 200, user) : send(res, 401, { msg: 'no' }); }
    if (u.pathname === '/auth/v1/logout') return send(res, 204);
    if (!uid) return send(res, 401, { code: '28000', message: 'JWT required' });
    // ---------------------------------------------------- REST
    if (u.pathname === '/rest/v1/fiora_datos') {
      if (req.method === 'GET') return send(res, 200, datos.has(uid) ? [{ datos: datos.get(uid) }] : []);
      const b = JSON.parse((await readBody(req)).toString());
      datos.set(uid, b.datos); return send(res, 201);
    }
    const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc) {
      const b = JSON.parse((await readBody(req)).toString() || '{}');
      const [arg, cast] = { fiora_save_playlist: [b.p, 'jsonb'], fiora_load_playlists: [b.since ?? 0, 'double precision'], fiora_count_plays: [b.items, 'jsonb'] }[rpc[1]] || [null, 'jsonb'];
      log.push(`rpc ${rpc[1]}`);
      const r = await asUser(uid, c => c.query(`select public.${rpc[1]}($1::${cast}) as r`, [cast === 'jsonb' ? JSON.stringify(arg) : arg]));
      return send(res, 200, r.rows[0].r);
    }
    if (u.pathname === '/rest/v1/fiora_playlist_plays') {
      const pid = (u.searchParams.get('playlist_id') || '').replace(/^eq\./, '');
      const r = await asUser(uid, c => c.query('select track_id, day::text as day, plays, seconds from public.fiora_playlist_plays where playlist_id = $1', [pid]));
      return send(res, 200, r.rows);
    }
    // ---------------------------------------------------- Storage
    const up = u.pathname.match(/^\/storage\/v1\/object\/(authenticated\/)?([^/]+)(?:\/(.+))?$/);
    if (up) {
      const bucketId = up[2], path = up[3] ? decodeURIComponent(up[3]) : '';
      const bk = (await pool().query('select * from storage.buckets where id = $1', [bucketId])).rows[0];
      if (!bk) return send(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found', code: 'NoSuchBucket' });
      if (req.method === 'POST' && path) {
        const mime = req.headers['content-type'];
        const declared = +req.headers['content-length'] || 0;
        if (bk.file_size_limit && declared > bk.file_size_limit) { req.resume(); return send(res, 400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' }); }
        if (cutUploads > 0) { cutUploads--; log.push(`cortada ${path}`); setTimeout(() => req.socket.destroy(), slowUploadMs); return; }
        const buf = await readBody(req);
        if (bk.file_size_limit && buf.length > bk.file_size_limit) return send(res, 400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
        if (bk.allowed_mime_types?.length && !bk.allowed_mime_types.includes(mime)) return send(res, 400, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${mime} is not supported` });
        try {
          await asUser(uid, c => c.query(`insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)
            on conflict (bucket_id, name) do update set metadata = excluded.metadata`, [bucketId, path, { size: buf.length, mimetype: mime }]));
        } catch (e) { return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }); }
        files.set(`${bucketId}/${path}`, { buf, mime });
        log.push(`subida ${path} ${buf.length}`);
        return send(res, 200, { Key: `${bucketId}/${path}` });
      }
      if (req.method === 'GET' && up[1]) {
        const ok = (await asUser(uid, c => c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucketId, path]))).rowCount;
        const f = files.get(`${bucketId}/${path}`);
        if (!ok || !f) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        return send(res, 200, f.buf, { 'Content-Type': f.mime });
      }
      if (req.method === 'DELETE' && !path) {
        const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || '{}');
        const r = await asUser(uid, c => c.query('delete from storage.objects where bucket_id = $1 and name = any($2) returning name', [bucketId, prefixes]));
        for (const row of r.rows) files.delete(`${bucketId}/${row.name}`);
        log.push(`borradas ${r.rows.map(x => x.name).join(', ')}`);
        return send(res, 200, r.rows.map(x => ({ name: x.name })));
      }
    }
    send(res, 404, { message: 'no implementado en el emulador: ' + req.method + ' ' + u.pathname });
  } catch (e) { console.error(e); pgError(res, e); }
}).listen(8766, () => console.log('emulador de Supabase en :8766'));
