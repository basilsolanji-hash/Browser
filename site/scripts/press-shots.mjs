// Скриншоты настольной Оси для пресс-кита на всех 10 языках: текст на картинках — на языке страницы.
// Запуск (нужны собранный desktop/ и X-сервер): cd desktop && npm run build; xvfb-run -a -s "-screen 0 1280x800x24" node ../site/scripts/press-shots.mjs
// Пишет public/press/shots/<lang>/<экран>.png.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { LANGS } from './langs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '../../desktop');
const req = createRequire(join(desktop, 'package.json'));
const { _electron } = req('playwright');
const electronPath = req('electron');
const OUT = join(here, '../public/press/shots');
const only = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* ещё нет */ } await sleep(150); }
  return null;
}

for (const lang of only.length ? only : LANGS) {
  const userData = join(tmpdir(), `os-press-${lang}-${Date.now()}`);
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ lang }));
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [desktop, '--no-sandbox'],
    env: { ...process.env, OS_TEST: '1', OS_USER_DATA: userData, OS_TEST_DELAY: '800' },
    timeout: 60000,
  });
  const main = (fn, arg) => app.evaluate(fn, arg);
  const page = (prefix) => waitFor(() => app.windows().find((p) => !p.isClosed() && p.url().startsWith(prefix)));
  await waitFor(() => main(() => globalThis.osTest.windows().length > 0));
  await main(() => { const w = globalThis.osTest.windows()[0].win; w.setBounds({ x: 0, y: 0, width: 1200, height: 760 }); w.focus(); });
  const dir = join(OUT, lang);
  mkdirSync(dir, { recursive: true });
  // Снимок окна целиком средствами X — вместе со своей шапкой Оси.
  const shot = async (name) => {
    await sleep(900);
    const b = await main(() => globalThis.osTest.windows()[0].win.getContentBounds());
    execFileSync('import', ['-window', 'root', '-crop', `${b.width}x${b.height}+${b.x}+${b.y}`, '+repage', join(dir, `${name}.png`)]);
  };
  const onb = await page('os://onboarding/');
  if (onb) {
    await onb.waitForSelector('#title');
    await shot('onboarding');
    for (let i = 0; i < 6; i++) { await onb.click('#next'); await sleep(200); }
  }
  const home = await page('os://home/');
  await home.waitForSelector('.prow');
  await shot('home');
  await home.click('.prow >> nth=0');
  await sleep(1500);
  await shot('start');
  await app.close();
  rmSync(userData, { recursive: true, force: true });
  console.log('press shots:', lang);
}
