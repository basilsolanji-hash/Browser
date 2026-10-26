// Снимки Windows-версии для магазина и сайта (WINDOWS_SYNC §16): на 16 языках, 3:4 1800×2400, подпись сверху —
// тот же стиль, что docs/play/tools/compose.js у Android. Подписи — docs/play/tools/captions.json, отличия
// Windows — store/captions-desktop.json. Данные подготовлены: профили-примеры, вкладки, история, заметки,
// загрузки, пароль в кабинете. Сеть не нужна: демо-сайты *.demo отдаёт локальный сервер.
// Запуск (Linux, шрифты Noto для CJK/хинди/арабского): npm run build && xvfb-run -a -s '-screen 0 1920x1400x24' \
//   node scripts/store-shots.mjs [папка, по умолчанию docs/play/screenshots/windows] [языки через запятую]
import { _electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import electronPath from 'electron';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(root, '../docs/play/screenshots/windows');
const LANGS = (process.argv[3] ?? 'ru,en,es,pt,fr,de,ar,hi,tr,zh,be,uz,ky,tg,kk,hy').split(',');
const W = 1800, H = 2400;
const captions = {
  ...JSON.parse(readFileSync(join(root, '../docs/play/tools/captions.json'), 'utf8')),
  ...JSON.parse(readFileSync(join(root, 'store/captions-desktop.json'), 'utf8')),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Демо-сайты: простые страницы с заголовком, чтобы вкладки и история выглядели живыми ---
const SITES = {
  'news.demo': ['Morning news', '#2f6fdf'], 'mail.demo': ['Inbox (3)', '#d93025'], 'shop.demo': ['Shop — new arrivals', '#188038'],
  'docs.demo': ['Quarterly plan', '#f29900'], 'maps.demo': ['Maps', '#1a73e8'], 'video.demo': ['Video', '#c5221f'],
  'weather.demo': ['Weather', '#12b5cb'], 'social.demo': ['Friends feed', '#7e57c2'],
};
const server = createServer((req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  const [title, color] = SITES[host] ?? ['Os demo', '#444'];
  res.setHeader('content-type', 'text/html; charset=utf-8');
  const cards = Array.from({ length: 6 }, (_, i) => `<div class="c"><div class="i" style="background:${color}${(30 + i * 10).toString(16)}"></div>
    <div><b>${title} · ${i + 1}</b><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.</p></div></div>`).join('');
  res.end(`<!doctype html><title>${title}</title><style>body{margin:0;font-family:Segoe UI,system-ui,sans-serif;background:#f6f7f9;color:#202124}
    header{background:${color};color:#fff;padding:22px 40px;font-size:26px;font-weight:700}main{max-width:900px;margin:24px auto;display:grid;gap:14px;padding:0 20px}
    .c{display:flex;gap:16px;background:#fff;border-radius:14px;padding:16px;box-shadow:0 1px 3px #0002}.i{width:120px;height:80px;border-radius:10px;flex:none}
    p{margin:6px 0 0;color:#5f6368}</style><header>${title}</header><main>${cards}</main>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

async function shotsFor(lang) {
  const userData = join(tmpdir(), `os-store-${lang}-${Date.now()}`);
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ lang }));
  // Загрузки с процентом и готовые файлы (экран «Скачанные файлы»).
  const dl = join(userData, 'files');
  mkdirSync(dl, { recursive: true });
  const now = Date.now();
  const files = [['report-2026.pdf', 2_400_000, 'completed', 0], ['photo-trip.jpg', 3_100_000, 'completed', 3600e3], ['music.mp3', 6_800_000, 'progress', 0],
    ['notes.txt', 12_000, 'completed', 26 * 3600e3], ['setup.zip', 48_000_000, 'completed', 50 * 3600e3]];
  const list = files.map(([name, size, state, ago], i) => {
    const path = join(dl, name);
    writeFileSync(path, Buffer.alloc(state === 'completed' ? Math.min(size, 4096) : 1024));
    return { id: `d${i}`, name, path, url: `http://shop.demo/${name}`, time: now - ago, size, state,
      received: state === 'completed' ? size : Math.round(size * 0.62), profile: 1, start: (now - 20000) / 1000 };
  });
  writeFileSync(join(userData, 'downloads.json'), JSON.stringify({ list }));

  const app = await _electron.launch({
    executablePath: electronPath,
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, OS_TEST: '1', OS_USER_DATA: userData, OS_TEST_DELAY: '1500', OS_TEST_HOSTS: `MAP *.demo 127.0.0.1:${PORT}` },
    timeout: 60000,
  });
  const main = (fn, arg) => app.evaluate(fn, arg);
  const page = async (prefix, timeout = 15000) => {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(150)) {
      const p = app.windows().find((x) => !x.isClosed() && x.url().startsWith(prefix));
      if (p) return p;
    }
    throw new Error('no page ' + prefix);
  };
  try {
    await page('os://onboarding/');
    await main(({ BrowserWindow }) => {
      const w = globalThis.osTest.windows()[0];
      w.win.setContentSize(1280, 1180);
      w.win.center();
      void BrowserWindow;
    });
    // Данные профиля «Личное»: история с поисковыми запросами, заметки, избранное, пароль.
    await main((_e, port) => {
      const t = globalThis.osTest;
      const add = (u, title) => t.addHistory(1, u, title);
      add('https://duckduckgo.com/?q=weather+tomorrow', ''); add('https://duckduckgo.com/?q=weekend+trip+ideas', '');
      for (const [h, title] of [['news.demo', 'Morning news'], ['mail.demo', 'Inbox (3)'], ['shop.demo', 'Shop — new arrivals'],
        ['docs.demo', 'Quarterly plan'], ['weather.demo', 'Weather'], ['maps.demo', 'Maps'], ['video.demo', 'Video'], ['social.demo', 'Friends feed']]) {
        add(`http://${h}/`, title); add(`http://${h}/a`, title);
      }
      t.seed.note('Call the bank on Monday · ask about the card limit', 'http://mail.demo/');
      t.seed.note('Gift ideas: headphones, a book about the sea, tea set', 'http://shop.demo/');
      t.seed.note('Plan: draft the report → review with Anna → send on Friday', 'http://docs.demo/');
      t.seed.bookmark('Morning news', 'http://news.demo/');
      t.seed.bookmark('Weather', 'http://weather.demo/');
      t.seed.password(1, 'https://mail.demo', 'anna@mail.demo', 'Sunny-Harbor-42');
      t.seed.password(1, 'https://shop.demo', 'anna.k', 'Green-Lantern-7');
      t.seed.password(1, 'https://social.demo', 'anna_k', 'Quiet-River-19');
      void port;
    }, PORT);
    const W0 = () => globalThis.osTest.windows()[0];
    const shots = {};
    const grab = async (key) => {
      await sleep(900);
      shots[key] = await main(() => globalThis.osTest.capture(0));
      console.log('  ', lang, key);
    };
    const ui = await page('os://ui');

    // 01 — главный экран профилей.
    await main(() => globalThis.osTest.windows()[0].showHome());
    await page('os://home/');
    await grab('01-main');
    // 02 — профиль с вкладками сайтов.
    await main(() => { const w = globalThis.osTest.windows()[0]; w.openProfile(1); w.closePanel(); });
    for (const h of ['mail.demo', 'docs.demo', 'shop.demo', 'news.demo']) {
      await main((_e, u) => globalThis.osTest.windows()[0].newTab(u), `http://${h}/`);
      await sleep(400);
    }
    await page('http://news.demo/');
    await grab('02-browser');
    // 03 — меню ⋮.
    await ui.click('#more');
    await ui.waitForSelector('.main-menu');
    await grab('03-menu');
    await ui.keyboard.press('Escape');
    // 04 — смена профиля из чипа.
    await ui.click('.chip');
    await sleep(400);
    await grab('04-profiles');
    await ui.keyboard.press('Escape');
    // 05 — подсказки адресной строки.
    await ui.click('#address');
    await ui.keyboard.type('we', { delay: 30 });
    await ui.waitForSelector('.addr-panel .hint-row');
    await grab('05-address');
    await ui.keyboard.press('Escape');
    // 06 — стартовая страница с приветствием.
    await main(() => globalThis.osTest.windows()[0].newTab());
    await sleep(500);
    await ui.keyboard.press('Escape');
    await grab('06-start');
    // 07–12 — свои экраны.
    for (const [key, url] of [['07-cabinet', 'os://cabinet/?profile=1'], ['08-downloads', 'os://downloads/'], ['09-notes', 'os://notes/'],
      ['10-settings', 'os://settings/'], ['11-privacy', 'os://settings/?g=privacy'], ['12-tabs', 'os://tabs/?profile=1']]) {
      await main((_e, u) => globalThis.osTest.windows()[0].openPanel(u), url);
      await page(url.split('?')[0]);
      await grab(key);
    }
    void W0;

    // Рамка 3:4 с подписью — как compose.js у Android, окно — в рамке «ноутбука».
    for (const [key, s] of Object.entries(shots)) {
      const cap = captions[key]?.[lang];
      if (!cap) continue;
      const scale = (W - 160) / s.w;
      const layers = s.layers.map((l) => `<img src="${l.png}" style="position:absolute;left:${l.x * scale}px;top:${l.y * scale}px;width:${l.w * scale}px;height:${l.h * scale}px">`).join('');
      const html = `<html dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;
        background:radial-gradient(circle at 50% 0%, #3d1714 0%, #17181B 60%);font-family:'Segoe UI Variable Display','Segoe UI',Inter,system-ui,sans-serif;
        display:flex;flex-direction:column;align-items:center">
        <div style="color:#fff;font-weight:800;font-size:96px;line-height:1.15;text-align:center;padding:170px 80px 0;max-width:${W - 160}px;letter-spacing:-.5px">${cap}</div>
        <div style="width:120px;height:8px;background:#F0453A;border-radius:4px;margin:40px 0 70px"></div>
        <div style="position:relative;width:${s.w * scale}px;height:${s.h * scale}px;border-radius:22px;overflow:hidden;border:10px solid #2b2c31;
          box-shadow:0 30px 80px rgba(0,0,0,.55);background:#fff;direction:ltr">${layers}</div></body></html>`;
      const jpg = await main((_e, a) => globalThis.osTest.compose(a.html, a.W, a.H), { html, W, H });
      writeFileSync(join(OUT, `${lang}-${key}.jpg`), Buffer.from(jpg, 'base64'));
    }
  } finally {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
  }
}

mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const lang of LANGS) {
  console.log('▶', lang);
  try {
    await shotsFor(lang);
  } catch (e) {
    failed++;
    console.error('FAIL', lang, e.stack ?? e);
  }
}
server.close();
console.log(failed ? `FAILED: ${failed} languages` : `ok: ${LANGS.length} languages → ${OUT}`);
process.exit(failed ? 1 : 0);
