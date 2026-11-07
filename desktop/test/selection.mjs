// WINDOWS_SYNC §17: настоящее выделение мышью, прокрутка, меню и удержание пальцем.
import { _electron } from 'playwright';
import electronPath from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'selection-results'); mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'checks.txt'), '');
const data = mkdtempSync(join(tmpdir(), 'os-selection-'));
writeFileSync(join(data, 'onboarding.json'), JSON.stringify({ done: true }));
writeFileSync(join(data, 'settings.json'), JSON.stringify({ lang: 'ru', autoUpdate: false }));
const server = createServer((_req, res) => res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Selection</title>
<body style="font:20px/1.5 system-ui;padding:20px"><p style="margin-top:120px;width:600px" id="target">Keep this selected text stable while interacting with the page and browser controls.</p><div style="height:1600px">Scroll area</div><script>document.addEventListener('touchstart',()=>window.touchSeen=true);</script></body>`));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = `http://127.0.0.1:${server.address().port}/`;
const wait = async (fn) => { const end = Date.now() + 15000; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw new Error('selection timeout'); };
const check = (name, value) => { assert.ok(value, name); appendFileSync(join(out, 'checks.txt'), `ok ${name}\n`); };
let app;
try {
  app = await _electron.launch({ executablePath: electronPath, args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, OS_TEST: '1', OS_USER_DATA: data, OS_TEST_DELAY: '800' }, timeout: 60000 });
  const main = (fn, arg) => app.evaluate(fn, arg);
  await wait(() => main(() => globalThis.osTest.windows().length));
  await main((_e, url) => { const w = globalThis.osTest.windows()[0]; w.openProfile(1); w.newTab(url); }, site);
  const page = await wait(() => app.windows().find((p) => p.url() === site)); await page.waitForSelector('#target');
  const bounds = () => main(() => { const w = globalThis.osTest.windows()[0], v = w.liveTabs().find((v) => v.wc === w.activeWebContents()); return { chrome: w.chrome.getBounds(), tab: v.view.getBounds() }; });
  const base = await bounds(), r = await page.locator('#target').boundingBox();
  await page.mouse.move(r.x + 2, r.y + 10); await page.mouse.down(); await page.mouse.move(r.x + 350, r.y + 10, { steps: 10 });
  assert.deepEqual(await bounds(), base); check('holding mouse selection keeps both view bounds', true);
  await page.mouse.up();
  const selected = await page.evaluate(() => window.getSelection().toString());
  check('native mouse drag selects text', selected.length > 10);
  await page.screenshot({ path: join(out, 'mouse-selection.png') });
  await page.mouse.wheel(0, 50); await wait(() => page.evaluate(() => window.scrollY > 0));
  check('scroll preserves selected text', await page.evaluate(() => window.getSelection().toString()) === selected);
  assert.deepEqual(await bounds(), base); check('scroll does not slide browser panels', true);
  const after = await page.locator('#target').boundingBox();
  await page.mouse.click(after.x + 30, after.y + 10, { button: 'right' });
  check('right click keeps selection', await page.evaluate(() => window.getSelection().toString()) === selected);
  check('context menu gets selection actions', await main(() => globalThis.osTest.contextMenu().includes('Копировать')));
  assert.deepEqual(await bounds(), base); check('context menu does not resize browser panels', true);
  const cdp = await app.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: after.x + 120, y: after.y + 10, radiusX: 4, radiusY: 4, force: 1 }] });
  await page.waitForTimeout(750);
  check('actual touch start delivered', await page.evaluate(() => window.touchSeen === true));
  assert.deepEqual(await bounds(), base); check('long touch keeps browser panels still', true);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.deepEqual(await bounds(), base); check('touch release keeps browser panels still', true);
  await page.screenshot({ path: join(out, 'touch-hold.png') });
  console.log('10 selection checks PASS');
} catch (error) { appendFileSync(join(out, 'checks.txt'), `FAIL ${error.stack}\n`); throw error; }
finally { if (app) await app.close().catch(() => {}); server.closeAllConnections(); await new Promise((r) => server.close(r)); rmSync(data, { recursive: true, force: true }); }
