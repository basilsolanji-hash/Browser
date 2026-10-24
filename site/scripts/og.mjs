// OG/Twitter-картинки на каждый язык (1200×630) и PNG логотипов для пресс-кита.
// Рисуются браузером из HTML со своими шрифтами; пишет public/og/<lang>.png и public/press/*.png.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS, RTL } from './langs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
// Шрифты встраиваются data-URL: страница из setContent не может читать file://.
const font = (f) => 'data:font/woff2;base64,' + readFileSync(join(pub, 'fonts', f)).toString('base64');
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const css = `
@font-face{font-family:Inter;font-weight:400;src:url(${font('inter-latin-wght-normal.woff2')})}
@font-face{font-family:Inter;font-weight:400;src:url(${font('inter-cyrillic-wght-normal.woff2')});unicode-range:U+0400-045F}
@font-face{font-family:Unbounded;font-weight:700;src:url(${font('unbounded-latin-700-normal.woff2')})}
@font-face{font-family:Unbounded;font-weight:700;src:url(${font('unbounded-cyrillic-700-normal.woff2')});unicode-range:U+0400-045F}
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#F6F5F4;color:#1B1A19;font-family:Inter,'Noto Sans','Noto Sans Devanagari','Noto Sans Arabic','WenQuanYi Zen Hei',sans-serif}
.w{position:absolute;inset:0;padding:72px 80px;display:flex;flex-direction:column;justify-content:space-between}
.bar{position:absolute;left:0;right:0;bottom:0;height:14px;background:#D92D20}
h1{margin:0;font:700 64px/1.12 Unbounded,'Noto Sans Devanagari','Noto Sans Arabic','WenQuanYi Zen Hei',sans-serif;letter-spacing:-.01em;max-width:1040px}
:lang(ar) h1,:lang(hi) h1,:lang(zh) h1{font-family:'Noto Sans Arabic','Noto Sans Devanagari','WenQuanYi Zen Hei',sans-serif;font-weight:700}
h1 em{font-style:normal;color:#D92D20}
p{margin:0;font-size:28px;color:#615D57}`;
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1200, height: 630 } });
mkdirSync(join(pub, 'og'), { recursive: true });
const logo = readFileSync(join(pub, 'press/os-logo-light-bg.svg'), 'utf8').replace('width="1200" height="360"', 'width="300" height="90"');
for (const lang of LANGS) {
  const d = JSON.parse(readFileSync(join(root, 'src/i18n', `${lang}.json`), 'utf8'));
  const title = esc(d.hero_title).replace(/\*(.+?)\*/, '<em>$1</em>');
  await page.setContent(`<!doctype html><html lang="${lang}" dir="${RTL.includes(lang) ? 'rtl' : 'ltr'}"><style>${css}</style><body><div class="w"><div dir="ltr">${logo}</div><h1>${title}</h1><p>${esc(d.hero_badge)}</p></div><div class="bar"></div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  // Длинные заголовки уменьшаем, чтобы влезли в картинку.
  await page.evaluate(() => { const h = document.querySelector('h1'); let s = 64; while (h.scrollHeight > 300 && s > 36) h.style.fontSize = (s -= 4) + 'px'; });
  await page.screenshot({ path: join(pub, 'og', `${lang}.png`) });
}
for (const name of ['os-logo-dark-bg', 'os-logo-light-bg']) {
  const svg = readFileSync(join(pub, 'press', `${name}.svg`), 'utf8');
  await page.setViewportSize({ width: 1200, height: 360 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: join(pub, 'press', `${name}.png`), omitBackground: true, clip: { x: 0, y: 0, width: 1200, height: 360 } });
}
await b.close();
console.log(`og: ${LANGS.length} картинок, логотипы PNG`);
