// Реальное сохранение и перезапуск: форма входа не шлёт повторный код автоматически.
import { _electron } from 'playwright';
import electronPath from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'signin-results'); mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'checks.txt'), '');
const data = mkdtempSync(join(tmpdir(), 'os-signin-'));
let requests = 0;
const server = createServer((req, res) => {
  if (/^\/(verify|mfa|login)/.test(req.url)) requests++;
  res.end('<!doctype html><title>Verification</title><body style="font:20px system-ui;padding:40px"><h1>Verification code</h1><input id="code" placeholder="Code"></body>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = `http://127.0.0.1:${server.address().port}`;
writeFileSync(join(data, 'onboarding.json'), JSON.stringify({ done: true }));
writeFileSync(join(data, 'settings.json'), JSON.stringify({ lang: 'ru', autoUpdate: false }));
writeFileSync(join(data, 'tabs.json'), JSON.stringify({ lastProfile: 1, profiles: { '1': {
  active: 'tab-legacy', tabs: [{ id: 'tab-legacy', url: site + '/login', title: 'Login', group: null }],
  closed: [], groups: [], pinState: { start: { url: site + '/mfa', title: 'Old login' } },
} } }));
const wait = async (fn) => { const end = Date.now() + 15000; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw new Error('sign-in restore timeout'); };
const check = (name, value) => { assert.ok(value, name); appendFileSync(join(out, 'checks.txt'), `ok ${name}\n`); };
let app;
const main = (fn, arg) => app.evaluate(fn, arg);
async function launch() {
  app = await _electron.launch({ executablePath: electronPath, args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, OS_TEST: '1', OS_USER_DATA: data, OS_TEST_DELAY: '800' }, timeout: 60000 });
  app.process().stderr.on('data', (d) => appendFileSync(join(out, 'main.log'), d));
  await wait(() => main(() => globalThis.osTest.windows().length));
  await wait(() => main(() => { const w = globalThis.osTest.windows()[0]; return !w.state().loading && w.activeWebContents()?.getURL().startsWith('os://start'); }));
}
try {
  await launch(); check('legacy login and pinned login do not trigger requests on startup', requests === 0);
  const id = await main((_e, url) => globalThis.osTest.windows()[0].newTab(url), site + '/verify');
  const page = await wait(() => app.windows().find((p) => p.url() === site + '/verify'));
  await page.fill('#code', 'typed-code');
  check('explicit user navigation opens a live verification page', requests === 1);
  await page.screenshot({ path: join(out, 'verification-live.png') });
  await main((_e, id) => { const w = globalThis.osTest.windows()[0]; w.openProfile(2); w.openProfile(1, id); }, id);
  check('switching profiles preserves the code and sends no new request', requests === 1 && await page.inputValue('#code') === 'typed-code');
  await main((_e, url) => { const w = globalThis.osTest.windows()[0]; w.activate('start'); w.navigate(url); }, site + '/mfa');
  const pinned = await wait(() => app.windows().find((p) => p.url() === site + '/mfa'));
  await pinned.waitForSelector('#code');
  await main(() => globalThis.osTest.flush());
  const saved = readFileSync(join(data, 'tabs.json'), 'utf8');
  check('disk snapshot contains no login/verify/mfa address', !['/login', '/verify', '/mfa'].some((path) => saved.includes(path)));
  check('saving does not change a background live verification tab', await page.inputValue('#code') === 'typed-code');
  const before = requests;
  await app.close(); await launch();
  check('restart opens the safe start page without requesting a code', requests === before);
  console.log('6 sign-in restore checks PASS');
} catch (error) { appendFileSync(join(out, 'checks.txt'), `FAIL ${error.stack}\n`); throw error; }
finally { if (app) await app.close().catch(() => {}); server.closeAllConnections(); await new Promise((r) => server.close(r)); rmSync(data, { recursive: true, force: true }); }
