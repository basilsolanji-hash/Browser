// WINDOWS_SYNC §12: шесть списков, включая кабинет, на широком и узком окне.
import { _electron } from 'playwright';
import electronPath from 'electron';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'layout-results'); mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'checks.txt'), '');
const data = mkdtempSync(join(tmpdir(), 'os-layout-'));
writeFileSync(join(data, 'onboarding.json'), JSON.stringify({ done: true }));
writeFileSync(join(data, 'settings.json'), JSON.stringify({ lang: 'ru', autoUpdate: false }));
const wait = async (fn) => { const end = Date.now() + 15000; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw new Error('layout page timeout'); };
let app;
try {
  app = await _electron.launch({ executablePath: electronPath, args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, OS_TEST: '1', OS_USER_DATA: data, OS_TEST_DELAY: '800' }, timeout: 60000 });
  const main = (fn, arg) => app.evaluate(fn, arg);
  await wait(() => main(() => globalThis.osTest.windows().length));
  for (const width of [1200, 560]) {
    await main((_e, width) => globalThis.osTest.windows()[0].win.setBounds({ width, height: 760 }), width);
    for (const name of ['home', 'settings', 'downloads', 'favorites', 'cabinet', 'site']) {
      const url = `os://${name}/${['cabinet', 'site'].includes(name) ? '?profile=1' : ''}`;
      await main((_e, url) => globalThis.osTest.windows()[0].openPanel(url), url);
      const page = await wait(() => app.windows().find((p) => p.url() === url));
      await page.waitForSelector('#app > *');
      const shape = await page.evaluate(() => {
        const a = document.getElementById('app'), r = a.getBoundingClientRect(), s = window.getComputedStyle(a), w = document.documentElement.clientWidth;
        return { content: r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight), offset: r.left + r.right - w, outer: r.width, viewport: w, overflow: document.documentElement.scrollWidth - w };
      });
      assert.ok(shape.content <= 720 && Math.abs(shape.offset) <= 2 && shape.overflow <= 1, `${name} ${width} ${JSON.stringify(shape)}`);
      if (width <= 720) assert.ok(Math.abs(shape.outer - shape.viewport) <= 1, `${name} fills narrow width`);
      await page.screenshot({ path: join(out, `${name}-${width}.png`) });
      appendFileSync(join(out, 'checks.txt'), `ok ${name} ${width}: ${JSON.stringify(shape)}\n`);
    }
  }
  console.log('12 layout checks PASS');
} catch (error) { appendFileSync(join(out, 'checks.txt'), `FAIL ${error.stack}\n`); throw error; }
finally { if (app) await app.close().catch(() => {}); rmSync(data, { recursive: true, force: true }); }
