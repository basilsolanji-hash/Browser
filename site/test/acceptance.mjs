// Приёмка сайта (§7 ТЗ): все страницы × 10 языков × ширины 390/768/1440 без ошибок в консоли
// и без горизонтальной прокрутки, axe-core без нарушений, определение платформы, выбор языка,
// HEAD-проверка файлов из releases.json, бюджеты JS, CSP без встроенных скриптов, внутренние ссылки.
// Результаты — test-results/: checks.txt (ok/FAIL), screenshots/*.jpg. Любой FAIL — код выхода 1.
// Запуск: npm run build && node test/acceptance.mjs
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { serve } from './serve.mjs';
import { LANGS } from '../scripts/langs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'dist');
const OUT = join(root, 'test-results');
import { BASE } from '../scripts/site-config.mjs';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'screenshots'), { recursive: true });

let failures = 0, passed = 0;
const log = (s) => { console.log(s); appendFileSync(join(OUT, 'checks.txt'), s + '\n'); };
function check(name, cond, detail = '') {
  if (cond) passed++; else failures++;
  log(`${cond ? 'ok' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  return !!cond;
}

const PAGES = ['', 'download', 'features', 'privacy-security', 'business', 'changelog', 'help', 'press'];
const WIDTHS = [390, 768, 1440];
const releases = JSON.parse(readFileSync(join(root, 'src/data/releases.json'), 'utf8'));
const { server, origin } = await serve(DIST, BASE);
const url = (p) => origin + BASE + p;
const browser = await chromium.launch();

// --- 1. Статика: файлы сборки ---
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } })(DIST);
const htmls = files.filter((f) => f.endsWith('.html'));
check('pages built: 8 × 10 languages + root + 404', htmls.filter((f) => /\/(en|ru|es|pt|fr|de|ar|hi|tr|zh)\//.test(f)).length === 80, `${htmls.length} html`);
check('privacy.html kept at the old address', files.includes(join(DIST, 'privacy.html')));
check('sitemap present', files.some((f) => /sitemap.*\.xml$/.test(f)));
for (const f of htmls) {
  const html = readFileSync(f, 'utf8');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/g)];
  if (inline.length) check(`no inline scripts (CSP) in ${f.slice(DIST.length)}`, false, inline[0][0]);
  if (/fonts\.googleapis|googletagmanager|google-analytics|cdn\./.test(html)) check(`no third-party resources in ${f.slice(DIST.length)}`, false);
}
check('no inline scripts and no third-party resources in any page', failures === 0);

// Названия функций на сайте — из переводов приложения ({app:ключ}), на всех языках.
{
  const app = JSON.parse(readFileSync(join(root, 'src/i18n/app.generated.json'), 'utf8'));
  const bad = LANGS.filter((l) => !readFileSync(join(DIST, l, 'index.html'), 'utf8').includes(app[l].security_check) || !readFileSync(join(DIST, l, 'index.html'), 'utf8').includes(app[l].add_to_note));
  check('feature names match the app on all languages', bad.length === 0, bad.join(','));
}

// Бюджет JavaScript ≤ 30 КБ (gzip) на страницу: свои скрипты из public/js.
const jsFiles = files.filter((f) => f.endsWith('.js'));
const jsTotal = jsFiles.reduce((s, f) => s + gzipSync(readFileSync(f)).length, 0);
check('JS budget ≤ 30 KB gzip (all scripts together)', jsTotal <= 30 * 1024, `${(jsTotal / 1024).toFixed(1)} KB`);

// Внутренние ссылки: каждый href/src внутри сайта ведёт на существующий файл.
const missing = new Set();
for (const f of htmls) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/(?:href|src)="([^"#?]+)/g)) {
    const u = m[1];
    if (!u.startsWith(BASE + '/') && u !== BASE) continue;
    let p = join(DIST, u.slice(BASE.length));
    if (u.endsWith('/')) p = join(p, 'index.html');
    try { statSync(p); } catch { missing.add(u); }
  }
}
check('internal links resolve', missing.size === 0, [...missing].slice(0, 5).join(', '));

// --- 2. Все страницы × языки × ширины ---
// Анимации выключены (как при «уменьшить движение»): снимки и контраст проверяются в конечном состоянии.
const ctx = await browser.newContext({ reducedMotion: 'reduce' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
for (const lang of LANGS) {
  for (const p of PAGES) {
    const path = `/${lang}/${p ? p + '/' : ''}`;
    for (const w of WIDTHS) {
      errors.length = 0;
      await page.setViewportSize({ width: w, height: 900 });
      const r = await page.goto(url(path), { waitUntil: 'load' });
      const info = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        lang: document.documentElement.lang, dir: document.documentElement.dir,
        h1: document.querySelectorAll('h1').length, title: document.title,
      }));
      const ok = r.status() === 200 && errors.length === 0 && info.overflow <= 0 && info.lang === lang && info.h1 === 1 && info.title.length > 0;
      check(`${path} @${w}`, ok, ok ? '' : `status=${r.status()} errors=${errors.join(' | ')} overflow=${info.overflow} lang=${info.lang} h1=${info.h1}`);
      if (lang === 'ar') check(`${path} @${w} is RTL`, info.dir === 'rtl');
      await page.evaluate(() => document.querySelectorAll('.pending').forEach((e) => e.classList.remove('pending')));
      await page.screenshot({ path: join(OUT, 'screenshots', `${lang}-${p || 'home'}-${w}.jpg`), type: 'jpeg', quality: 55, fullPage: ['', 'download'].includes(p) && ['en', 'ru', 'ar'].includes(lang) });
    }
    // Доступность: axe на широкой и узкой ширине.
    for (const w of [1440, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(url(path), { waitUntil: 'load' });
      await page.evaluate(() => document.querySelectorAll('.pending').forEach((e) => e.classList.remove('pending')));
      await page.waitForTimeout(700);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
      check(`axe ${path} @${w}`, res.violations.length === 0, res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`).join(' | '));
    }
  }
}
await ctx.close();

// С анимацией: после прокрутки до конца ни одна секция не остаётся прозрачной.
{
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await c.newPage();
  await pg.goto(url('/ru/'));
  for (let y = 0; y < 6000; y += 400) { await pg.mouse.wheel(0, 400); await pg.waitForTimeout(120); }
  await pg.waitForTimeout(1200);
  const hidden = await pg.evaluate(() => [...document.querySelectorAll('.reveal')].filter((e) => getComputedStyle(e).opacity !== '1').length);
  check('reveal animation: all sections visible after scrolling', hidden === 0, `${hidden} hidden`);
  const moving = await pg.evaluate(() => document.getAnimations().length);
  check('hero mock is animated', moving > 0, `${moving} animations`);
  await c.close();
}

// --- 3. Определение платформы на «Скачать» ---
const UAS = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
};
for (const [want, ua] of Object.entries(UAS)) {
  const c = await browser.newContext({ userAgent: ua, hasTouch: want === 'ios', isMobile: ['android', 'ios'].includes(want) });
  const pg = await c.newPage();
  await pg.goto(url('/en/download/'));
  const got = await pg.evaluate(() => ({
    platform: document.documentElement.getAttribute('data-platform'),
    panel: [...document.querySelectorAll('[data-panel]')].filter((e) => !e.hidden).map((e) => e.getAttribute('data-panel')).join(','),
    card: document.querySelector('.card.hl')?.getAttribute('data-card'),
  }));
  check(`platform detection: ${want}`, got.platform === want && got.panel === want && got.card === want, JSON.stringify(got));
  await c.close();
}
// iPad с «настольным» User-Agent и сенсорным экраном
{
  const c = await browser.newContext({ userAgent: UAS.mac, hasTouch: true });
  const pg = await c.newPage();
  await pg.addInitScript(() => Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }));
  await pg.goto(url('/en/download/'));
  check('platform detection: iPad with desktop UA', (await pg.getAttribute('html', 'data-platform')) === 'ios');
  await c.close();
}
// Ручной выбор вкладкой и ссылка с якорем
{
  const c = await browser.newContext({ userAgent: UAS.android });
  const pg = await c.newPage();
  await pg.goto(url('/ru/download/'));
  await pg.click('[data-tabs] .tab[data-id="windows"]');
  check('manual platform switch shows Windows build', await pg.isVisible('[data-panel="windows"]') && !(await pg.isVisible('[data-panel="android"]')));
  await pg.goto(url('/ru/download/#mac'));
  check('anchor #mac selects macOS', (await pg.getAttribute('html', 'data-platform')) === 'mac');
  await c.close();
}
// Без JavaScript видны все платформы, рекомендуется Android
{
  const c = await browser.newContext({ javaScriptEnabled: false });
  const pg = await c.newPage();
  await pg.goto(url('/en/download/'));
  const n = await pg.locator('[data-card]').count();
  check('download works without JavaScript', n === 4 && await pg.isVisible('[data-panel="android"]') && !(await pg.isVisible('[data-tabs]')));
  await pg.goto(url('/'));
  check('root without JavaScript opens English', (await pg.getAttribute('html', 'lang')) === 'en' && pg.url() === url('/'));
  await c.close();
}

// --- 4. Язык при первом заходе ---
const LOCALE_CASES = [['ru-RU', 'ru'], ['kk-KZ', 'ru'], ['be-BY', 'ru'], ['uz-UZ', 'ru'], ['de-DE', 'de'], ['ar-EG', 'ar'], ['zh-CN', 'zh'], ['pt-BR', 'pt'], ['ja-JP', 'en'], ['en-US', 'en']];
for (const [locale, want] of LOCALE_CASES) {
  const c = await browser.newContext({ locale });
  const pg = await c.newPage();
  await pg.goto(url('/'));
  await pg.waitForLoadState('load');
  await pg.waitForTimeout(300);
  const lang = await pg.getAttribute('html', 'lang');
  check(`first visit with ${locale} → ${want}`, lang === want, `${pg.url()} lang=${lang}`);
  await c.close();
}
{
  const c = await browser.newContext({ locale: 'ru-RU' });
  const pg = await c.newPage();
  await pg.goto(url('/ru/'));
  await pg.click('details.lang summary');
  await pg.click('details.lang a[data-lang="tr"]');
  await pg.waitForURL(/\/tr\/$/);
  await pg.goto(url('/'));
  await pg.waitForTimeout(300);
  check('chosen language is remembered (localStorage, no cookies)', pg.url().endsWith('/tr/') && (await c.cookies()).length === 0, pg.url());
  await pg.goto(url('/ru/no-such-page/'));
  const shown = await pg.evaluate(() => document.querySelector('[data-nf]:not([hidden])')?.getAttribute('data-nf'));
  check('404 page in the language from the address', shown === 'ru' && (await pg.getAttribute('html', 'lang')) === 'ru', String(shown));
  await c.close();
}

// --- 5. Кнопки скачивания ведут на существующие файлы ---
const assets = ['android', 'windows'].flatMap((k) => (releases[k]?.latest.assets ?? []).filter((a) => /\.(apk|exe|zip)$/.test(a.name)));
check('releases.json has Android APK and Windows installer', assets.some((a) => a.name.endsWith('.apk')) && assets.some((a) => a.name.endsWith('.exe')));
for (const a of assets) {
  // HEAD к адресу релиза → редирект на хранилище; ссылка хранилища подписана только для GET,
  // поэтому сам файл проверяем GET с Range на 1 байт и сверяем полный размер с releases.json.
  let detail = '';
  let ok = false;
  try {
    const head = await fetch(a.url, { method: 'HEAD', redirect: 'manual' });
    const loc = head.headers.get('location');
    detail = `HEAD ${head.status}`;
    if (head.status === 302 && loc) {
      const g = await fetch(loc, { headers: { Range: 'bytes=0-0' } });
      const total = Number((g.headers.get('content-range') ?? '').split('/')[1]);
      await g.arrayBuffer();
      detail += ` → GET ${g.status}, size ${total}`;
      ok = g.status === 206 && total === a.size;
    } else ok = head.status === 200;
  } catch (e) { detail = String(e.cause?.code ?? e.message); }
  check(`download exists: ${a.name}`, ok, detail);
  const html = readFileSync(join(DIST, 'en/download/index.html'), 'utf8');
  check(`download page links ${a.name}`, html.includes(a.url));
}

// --- 6. Валидный HTML ---
{
  const { HtmlValidate } = await import('html-validate');
  const hv = new HtmlValidate({ extends: ['html-validate:recommended'], rules: { 'no-inline-style': 'off', 'long-title': 'off', 'attribute-boolean-style': 'off', 'no-trailing-whitespace': 'off', 'void-style': 'off', 'element-required-attributes': 'off', 'no-redundant-role': 'off' } });
  let bad = 0;
  for (const f of htmls) {
    const r = await hv.validateFile(f);
    if (!r.valid) { bad++; if (bad <= 5) log(`  html-validate ${f.slice(DIST.length)}: ${r.results[0].messages.slice(0, 3).map((m) => `${m.ruleId} ${m.message}`).join(' | ')}`); }
  }
  check('HTML valid (html-validate)', bad === 0, `${bad} files with errors`);
}

await browser.close();
server.close();
log(`\nИтог: ${passed} ok, ${failures} FAIL`);
writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ passed, failures, date: new Date().toISOString() }));
process.exit(failures ? 1 : 0);
