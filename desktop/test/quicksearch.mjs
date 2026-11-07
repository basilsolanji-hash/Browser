// Быстрый поиск: настоящие профили/cookies, новая вкладка и уже открытое окно профиля.
import { _electron } from 'playwright';
import electronPath from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'quicksearch-results');
mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'checks.txt'), '');
const data = mkdtempSync(join(tmpdir(), 'os-quicksearch-'));
writeFileSync(join(data, 'onboarding.json'), JSON.stringify({ done: true }));
writeFileSync(join(data, 'settings.json'), JSON.stringify({ lang: 'ru', autoUpdate: false }));
const seen = [];
const server = createServer((req, res) => {
  seen.push({ url: req.url, cookie: req.headers.cookie ?? '' });
  res.end('<!doctype html><title>Profile search</title><h1>Local profile result</h1>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = `http://127.0.0.1:${server.address().port}`;
const wait = async (fn) => { const end = Date.now() + 15000; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw new Error('quick search timeout'); };
const check = (name, value) => { assert.ok(value, name); appendFileSync(join(out, 'checks.txt'), `ok ${name}\n`); };
let app;
try {
  app = await _electron.launch({ executablePath: electronPath, args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, OS_TEST: '1', OS_USER_DATA: data, OS_TEST_DELAY: '800' }, timeout: 60000 });
  const main = (fn, arg) => app.evaluate(fn, arg);
  await wait(() => main(() => globalThis.osTest.windows().length));
  const home = await wait(() => app.windows().find((p) => p.url().startsWith('os://home/')));
  await home.waitForSelector('#quick-query');
  check('default target is the first profile on a clean install', await home.inputValue('#quick-profile') === '1');
  await home.click('#quick-go');
  check('empty input does nothing', await main(() => globalThis.osTest.windows()[0].profile === null));
  await main(async ({ session }, url) => {
    for (const id of [1, 2]) await session.fromPartition(`persist:profile_${id}`).cookies.set({ url, name: 'profile_cookie', value: String(id) });
  }, site);
  await home.selectOption('#quick-profile', '2');
  await home.fill('#quick-query', `${site}/result-two`);
  await home.screenshot({ path: join(out, 'quick-search-ru.png') });
  await home.press('#quick-query', 'Enter');
  check('Enter opens a new tab in the selected profile', await wait(() => main(() => { const w = globalThis.osTest.windows()[0]; return w.profile === 2 && w.state().url.endsWith('/result-two'); })));
  await wait(() => seen.some((x) => x.url === '/result-two'));
  check('request carries only the target profile cookies', seen.find((x) => x.url === '/result-two')?.cookie === 'profile_cookie=2');
  const ui = await wait(() => app.windows().find((p) => p.url().startsWith('os://ui')));
  await ui.evaluate(() => window.os.call('showHome'));
  await wait(() => home.isVisible('#quick-query'));
  check('successful submission clears the input', await home.inputValue('#quick-query') === '');
  await ui.evaluate(() => window.os.call('newWindow'));
  await wait(() => main(() => globalThis.osTest.windows().length === 2));
  await main(() => globalThis.osTest.windows()[1].openProfile(1));
  await home.selectOption('#quick-profile', '1');
  await home.fill('#quick-query', `${site}/result-one`);
  await home.click('#quick-go');
  check('existing profile window receives the tab; home stays in its own window', await wait(() => main(() => { const [a, b] = globalThis.osTest.windows(); return a.profile === null && b.profile === 1 && b.state().url.endsWith('/result-one'); })));
  await wait(() => seen.some((x) => x.url === '/result-one'));
  check('other profile request has its own cookies', seen.find((x) => x.url === '/result-one')?.cookie === 'profile_cookie=1');
  await main(() => { globalThis.osTest.windows()[1].locked = true; });
  const refused = await home.evaluate((url) => window.os.call('quickSearch', 1, url), `${site}/under-lock`);
  check('locked target window refuses navigation', refused === false && !seen.some((x) => x.url === '/under-lock'));
  await main(() => { globalThis.osTest.windows()[1].locked = false; });
  for (const value of ['os://settings/', 'about:blank']) {
    check(`internal target is refused: ${value}`, await home.evaluate((value) => window.os.call('quickSearch', 1, value), value) === false);
  }
  console.log('10 quick search checks PASS');
} catch (error) { appendFileSync(join(out, 'checks.txt'), `FAIL ${error.stack}\n`); throw error; }
finally { if (app) await app.close().catch(() => {}); server.closeAllConnections(); await new Promise((r) => server.close(r)); rmSync(data, { recursive: true, force: true }); }
