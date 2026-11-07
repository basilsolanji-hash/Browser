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
  assert.equal((await login()).response.status, 429);
  clock.now += 60000; assert.equal((await login()).response.status, 204);
});
test('service data is whitelisted; malformed values and private properties cannot leak', async (t) => {
  const { origin, login } = await fixture(t, { metrics: async () => ({ users: 5, devices: 8,
    storageBytes: -1, syncErrors: 'private-message', passwords: ['SECRET'], notes: ['PRIVATE'] }) });
  const { cookie } = await login();
  const r = await fetch(origin + path, { headers: { Cookie: cookie } });
  assert.deepEqual((await r.json()).service, { users: 5, devices: 8, storageBytes: null, syncErrors: null });
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
