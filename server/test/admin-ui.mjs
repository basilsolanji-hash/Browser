import { chromium } from 'playwright';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createAdminServer } from '../src/admin.mjs';
import { AnalyticsStore } from '../src/analytics.mjs';
const root = new URL('../', import.meta.url);
const words = JSON.parse(readFileSync(new URL('public/i18n.json', root), 'utf8'));
const languages = 'en ru es pt fr de ar hi tr zh be uz ky tg kk hy'.split(' ');
assert.deepEqual(Object.keys(words), languages);
for (const lang of languages) {
  assert.deepEqual(Object.keys(words[lang]), Object.keys(words.en));
  assert.ok(Object.values(words[lang]).every((s) => typeof s === 'string' && s.trim()));
}
const probe = createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port; await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString('hex');
const analytics = new AnalyticsStore(':memory:');
const server = createAdminServer({ origin, secret, allowLocalHttp: true, analytics });
await new Promise((r) => server.listen(port, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const out = fileURLToPath(new URL('artifacts/', root)); mkdirSync(out, { recursive: true });
let checks = 0;
try {
  await page.goto(origin + '/admin/?lang=en');
  await page.locator('#login').waitFor({ state: 'visible' });
  await page.fill('#token', secret); await page.click('#login-form button');
  await page.locator('#dashboard').waitFor({ state: 'visible' });
  assert.equal(await page.inputValue('#token'), ''); checks++;
  assert.equal(await page.evaluate(() => document.cookie.includes('os_admin_local')), false); checks++;
  for (const lang of languages) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/admin/?lang=${lang}`);
    await page.locator('#dashboard').waitFor({ state: 'visible' });
    assert.equal(await page.getAttribute('html', 'lang'), lang);
    assert.equal(await page.getAttribute('html', 'dir'), lang === 'ar' ? 'rtl' : 'ltr');
    assert.equal(await page.locator('aside h1').textContent(), words[lang].title);
    assert.equal(await page.locator('#connection').isVisible(), true);
    assert.equal(await page.locator('#empty').isVisible(), true);
    assert.equal(await page.locator('#users').textContent(), '—');
    assert.equal(await page.locator('#language option').count(), 16);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: `${out}owner-${lang}-desktop.png`, fullPage: true }); checks++;
    if (['ru', 'ar', 'kk', 'hy'].includes(lang)) {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({ path: `${out}owner-${lang}-mobile.png`, fullPage: true }); checks++;
    }
  }
  // Actual aggregate data in the test-only SQLite store; no synthetic production metrics.
  for (let i = 0; i < 20; i++) analytics.ingest({ platform: 'android', events: [{ feature: 'notes_open', count: 1 }] },
    { consent: true, privateMode: false, accountId: `fixture-${i}` });
  await page.click('#refresh'); await page.locator('#usage-table').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#rows tr').count(), 1); checks++;
  assert.equal(await page.locator('#rows td').nth(1).textContent(), new Intl.NumberFormat('hy').format(20)); checks++;
  assert.equal(await page.locator('#rows td').nth(2).textContent(), '—'); checks++;
  assert.equal(await page.locator('#rows td').nth(3).textContent(), new Intl.NumberFormat('hy').format(20)); checks++;
  await page.click('#logout'); await page.locator('#login').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(async () => (await fetch('/admin/api/summary?since=2026-11-01&until=2026-11-07')).status), 401); checks++;
  assert.deepEqual(errors, []); checks++;
  console.log(`${checks} owner panel UI checks PASS (16 languages, RTL, 390/1440px)`);
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); analytics.close();
}
