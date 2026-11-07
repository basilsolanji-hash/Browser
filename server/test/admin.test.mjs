import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createAdminServer } from '../src/admin.mjs';

async function fixture(t, options = {}) {
  const probe = createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const secret = randomBytes(32).toString('hex');
  const clock = { now: Date.now() };
  const server = createAdminServer({ origin, secret, allowLocalHttp: true,
    analytics: { summary: () => [] }, clock: () => clock.now, ...options });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const login = async (token = secret, headers = {}) => {
    const r = await fetch(`${origin}/admin/session`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ token }) });
    return { response: r, cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  return { origin, secret, clock, login };
}
const path = '/admin/api/summary?since=2026-11-01&until=2026-11-07';

test('HTTPS and a strong configured owner credential are required before startup', () => {
  assert.throws(() => createAdminServer({ origin: 'http://owner.example', secret: '0'.repeat(64) }), /HTTPS/);
  assert.throws(() => createAdminServer({ origin: 'https://owner.example', secret: 'short' }), /secret/);
});
test('anonymous requests cannot read any metric', async (t) => {
  const { origin } = await fixture(t);
  const r = await fetch(origin + path);
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});
test('wrong credential does not open a session or echo the submitted secret', async (t) => {
  const { login } = await fixture(t);
  const { response, cookie } = await login('private-bad-secret');
  assert.equal(response.status, 401); assert.equal(cookie, undefined);
  assert.equal((await response.text()).includes('private-bad-secret'), false);
});
test('owner gets an HttpOnly SameSite session; an unconnected service remains null', async (t) => {
  const { origin, login } = await fixture(t);
  const { response, cookie } = await login();
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
  const r = await fetch(origin + path, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { service: null, usage: [], minimumParticipants: 20 });
});
test('CSRF prevents login and logout from another origin', async (t) => {
  const { origin, login } = await fixture(t);
  assert.equal((await login(undefined, { Origin: 'https://attacker.example' })).response.status, 403);
  const { cookie } = await login();
  const logout = await fetch(origin + '/admin/session', { method: 'DELETE', headers: { Cookie: cookie, Origin: 'https://attacker.example' } });
  assert.equal(logout.status, 403);
  assert.equal((await fetch(origin + path, { headers: { Cookie: cookie } })).status, 200);
});
test('logout invalidates the session on the server', async (t) => {
  const { origin, login } = await fixture(t); const { cookie } = await login();
  assert.equal((await fetch(origin + '/admin/session', { method: 'DELETE', headers: { Cookie: cookie, Origin: origin } })).status, 204);
  assert.equal((await fetch(origin + path, { headers: { Cookie: cookie } })).status, 401);
});
test('a session expires after fifteen minutes', async (t) => {
  const { origin, login, clock } = await fixture(t); const { cookie } = await login();
  clock.now += 15 * 60000;
  assert.equal((await fetch(origin + path, { headers: { Cookie: cookie } })).status, 401);
});
test('login attempts are bounded without storing an IP-address history', async (t) => {
  const { login, clock } = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await login('bad')).response.status, 401);
  assert.equal((await login('bad')).response.status, 429);
  // Valid owner key still works when nginx makes clients share a loopback peer.
  assert.equal((await login()).response.status, 204);
  for (let i = 0; i < 11; i++) await login('bad');
  clock.now += 60000; assert.equal((await login('bad')).response.status, 401);
});
test('service data is whitelisted; malformed values and private properties cannot leak', async (t) => {
  const { origin, login } = await fixture(t, { metrics: async () => ({ users: 5, devices: 8,
    storageBytes: -1, syncErrors: 'private-message', passwords: ['SECRET'], notes: ['PRIVATE'] }) });
  const { cookie } = await login();
  const r = await fetch(origin + path, { headers: { Cookie: cookie } });
  assert.deepEqual((await r.json()).service, { users: 5, devices: 8, storageBytes: null, syncErrors: null, syncSuccesses: null, health: null });
});
test('unsafe body sizes and content types are refused', async (t) => {
  const { origin } = await fixture(t);
  let r = await fetch(origin + '/admin/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: 'x'.repeat(3000) });
  assert.equal(r.status, 413);
  r = await fetch(origin + '/admin/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 415);
});

test('unexpected Host is refused before exposing even a login page', async (t) => {
  const { origin } = await fixture(t);
  const { request } = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    const req = request(origin + '/admin/', { headers: { Host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(status, 403);
});


test('revocation while metrics is pending prevents a late private response', async (t) => {
  let started, release;
  const entered = new Promise((r) => { started = r; });
  const { origin, login } = await fixture(t, { metrics: async () => { started(); return new Promise((r) => { release = r; }); } });
  const { cookie } = await login(); const pending = fetch(origin + path, { headers: { Cookie: cookie } });
  await entered;
  assert.equal((await fetch(origin + '/admin/session', { method: 'DELETE', headers: { Cookie: cookie, Origin: origin } })).status, 204);
  release({ users: 123 }); const response = await pending;
  assert.equal(response.status, 401); assert.equal((await response.text()).includes('123'), false);
});

test('waiting on a provider never extends an expired session', async (t) => {
  let started, release;
  const entered = new Promise((r) => { started = r; });
  const { origin, login, clock } = await fixture(t, { metrics: async () => { started(); return new Promise((r) => { release = r; }); } });
  const { cookie } = await login(); const pending = fetch(origin + path, { headers: { Cookie: cookie } });
  await entered; clock.now += 15 * 60000; release({ users: 321 });
  assert.equal((await pending).status, 401);
});

test('successful syncs and service health are whitelisted provider values', async (t) => {
  let health = 'healthy';
  const { origin, login } = await fixture(t, { metrics: async () => ({ users: 5, devices: 8, storageBytes: 4096, syncErrors: 2, syncSuccesses: 19, health }) });
  const { cookie } = await login();
  for (const state of ['healthy', 'degraded', 'unavailable', 'private traceback', 1, {}, null]) {
    health = state; const response = await fetch(origin + path, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200); assert.ok(Number(response.headers.get('X-Admin-Session-TTL')) > 0);
    const body = await response.json(); assert.equal(body.service.syncSuccesses, 19);
    assert.deepEqual(body.service.health, ['healthy', 'degraded', 'unavailable'].includes(state) ? state : null);
  }
});

test('provider failure stays an error instead of fake zero metrics', async (t) => {
  const { origin, login } = await fixture(t, { metrics: async () => { throw new Error('PRIVATE PROVIDER DETAILS'); } });
  const { cookie } = await login(); const response = await fetch(origin + path, { headers: { Cookie: cookie } });
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'unavailable' });
});

test('one peer exhausting failed attempts does not consume another peer budget', async (t) => {
  const { origin, login } = await fixture(t);
  for (let i = 0; i < 11; i++) await login('bad');
  assert.equal((await login('bad')).response.status, 429);
  const { request } = await import('node:http');
  const body = JSON.stringify({ token: 'bad' });
  const status = await new Promise((resolve, reject) => {
    const req = request(origin + '/admin/session', { method: 'POST', localAddress: '127.0.0.2',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
    (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end(body);
  });
  assert.equal(status, 401);
  assert.equal((await login()).response.status, 204);
});
