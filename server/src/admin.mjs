import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const publicRoot = new URL('../public/', import.meta.url);
const MAX_BODY = 2048;
const SESSION_MS = 15 * 60 * 1000;
const metricKeys = ['users', 'devices', 'storageBytes', 'syncErrors', 'syncSuccesses'];
const hash = (value) => createHash('sha256').update(value).digest();

async function jsonBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw { status: 415 };
  if (Number(req.headers['content-length']) > MAX_BODY) throw { status: 413 };
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw { status: 413 };
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw { status: 400 }; }
}

/** Owner-only API. No sync vault/key access, analytics ingestion or anonymous public stats. */
export function createAdminServer({ origin, secret, analytics, metrics = async () => null,
  clock = () => Date.now(), allowLocalHttp = false }) {
  const url = new URL(origin);
  const local = allowLocalHttp && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol === 'http:';
  if (url.origin !== origin || (!local && url.protocol !== 'https:')) throw new TypeError('HTTPS origin required');
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/i.test(secret)) throw new TypeError('32-byte owner secret required');
  if (!analytics || typeof analytics.summary !== 'function') throw new TypeError('Analytics store required');
  const expected = hash(secret);
  const sessions = new Map();
  const cookieName = local ? 'os_admin_local' : '__Host-os_admin';
  // Bounded temporary abuse state, never persisted/logged. Do not trust client X-Forwarded-For.
  // The valid high-entropy owner key is never locked out by another client's failures,
  // including when a reverse proxy makes multiple clients share one network peer.
  const failedLogins = new Map();
  const failedAttempt = (req, now) => {
    for (const [peer, entry] of failedLogins) if (entry.until <= now) failedLogins.delete(peer);
    const peer = req.socket.remoteAddress ?? 'unknown';
    let entry = failedLogins.get(peer);
    if (!entry) {
      if (failedLogins.size >= 1024) return 429;
      entry = { count: 0, until: now + 60000 };
      failedLogins.set(peer, entry);
    }
    return ++entry.count > 10 ? 429 : 401;
  };
  const cookie = (value, age) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${local ? '' : '; Secure'}`;
  const sessionExpiration = (req) => {
    const cookies = (req.headers.cookie ?? '').split(';').map((x) => x.trim()).filter((x) => x.startsWith(`${cookieName}=`));
    if (cookies.length !== 1) return false;
    const token = cookies[0].slice(cookieName.length + 1);
    const expiration = sessions.get(token);
    if (!expiration || expiration <= clock()) { sessions.delete(token); return false; }
    return expiration;
  };
  const authorized = (req) => Boolean(sessionExpiration(req));
  const sessionHeader = (req, res) => {
    const until = sessionExpiration(req);
    if (!until) return false;
    res.setHeader('X-Admin-Session-TTL', String(Math.max(0, until - clock())));
    return true;
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const send = (status, body) => {
      res.statusCode = status;
      if (body !== undefined) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); }
      else res.end();
    };
    try {
      if (req.headers.host !== url.host) return send(403, { error: 'forbidden' });
      const target = new URL(req.url, origin);
      if (req.method === 'POST' && target.pathname === '/admin/session') {
        if (req.headers.origin !== origin) return send(403, { error: 'forbidden' });
        const now = clock();
        const body = await jsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
            typeof body.token !== 'string' || body.token.length > 128 || !timingSafeEqual(hash(body.token), expected)) {
          const status = failedAttempt(req, now);
          return send(status, { error: status === 429 ? 'rate_limit' : 'unauthorized' });
        }
        failedLogins.delete(req.socket.remoteAddress ?? 'unknown');
        for (const [token, until] of sessions) if (until <= now) sessions.delete(token);
        if (sessions.size >= 32) return send(429, { error: 'rate_limit' });
        const token = randomBytes(32).toString('hex');
        sessions.set(token, now + SESSION_MS);
        res.setHeader('Set-Cookie', cookie(token, SESSION_MS / 1000));
        res.setHeader('X-Admin-Session-TTL', String(SESSION_MS));
        return send(204);
      }
      if (req.method === 'DELETE' && target.pathname === '/admin/session') {
        if (req.headers.origin !== origin) return send(403, { error: 'forbidden' });
        if (authorized(req)) {
          const value = req.headers.cookie.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${cookieName}=`));
          sessions.delete(value.slice(cookieName.length + 1));
        }
        res.setHeader('Set-Cookie', cookie('', 0));
        return send(204);
      }
      if (req.method === 'GET' && target.pathname === '/admin/api/summary') {
        if (!authorized(req)) return send(401, { error: 'unauthorized' });
        const since = target.searchParams.get('since'), until = target.searchParams.get('until');
        let usage;
        try { usage = analytics.summary(since, until); }
        catch { return send(400, { error: 'invalid_range' }); }
        const current = await metrics();
        const service = current === null ? null : { ...Object.fromEntries(metricKeys.map((key) => {
          const n = current[key];
          return [key, Number.isSafeInteger(n) && n >= 0 ? n : null];
        })), health: ['healthy', 'degraded', 'unavailable'].includes(current.health) ? current.health : null };
        // A logout/expiry can happen while the asynchronous provider is pending.
        if (!sessionHeader(req, res)) return send(401, { error: 'unauthorized' });
        return send(200, { service, usage, minimumParticipants: 20 });
      }
      if (req.method === 'GET') {
        const files = new Map([
          ['/admin/', ['index.html', 'text/html; charset=utf-8']],
          ['/admin/app.js', ['app.js', 'text/javascript; charset=utf-8']],
          ['/admin/style.css', ['style.css', 'text/css; charset=utf-8']],
          ['/admin/i18n.json', ['i18n.json', 'application/json; charset=utf-8']],
        ]);
        const file = files.get(target.pathname);
        if (file) {
          const content = await readFile(fileURLToPath(new URL(file[0], publicRoot)));
          res.setHeader('Content-Type', file[1]); res.end(content); return;
        }
      }
      send(404, { error: 'not_found' });
    } catch (error) {
      // Never include an exception message, submitted token or request data in responses/logs.
      if (!res.headersSent) send([400, 413, 415].includes(error?.status) ? error.status : 503, { error: 'unavailable' });
      else res.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;
  server.keepAliveTimeout = 5000;
  server.on('close', () => { sessions.clear(); failedLogins.clear(); });
  return server;
}
