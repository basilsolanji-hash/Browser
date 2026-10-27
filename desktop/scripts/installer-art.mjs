// Картинки установщика в стиле приложения: боковая панель (164×314) и шапка (150×57), 24-битные BMP для NSIS.
// Запуск: node scripts/installer-art.mjs — пересоздаёт assets/installerSidebar.bmp и assets/installerHeader.bmp.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const logo = readFileSync(new URL('../assets/logo.svg', import.meta.url), 'utf8');
const font = `font-family: 'Segoe UI', 'Noto Sans', 'DejaVu Sans', sans-serif;`;

const sidebar = `<body style="margin:0;width:164px;height:314px;background:#17181B;${font};color:#fff;overflow:hidden">
  <div style="height:4px;background:#F0453A"></div>
  <div style="padding:34px 0 0;text-align:center">${logo.replace('width="256" height="256"', 'width="88" height="88"')}</div>
  <div style="text-align:center;font-size:21px;font-weight:700;margin-top:14px;letter-spacing:.2px">Ось Browser</div>
  <div style="width:28px;height:3px;background:#F0453A;border-radius:2px;margin:12px auto 0"></div>
  <div style="text-align:center;font-size:11.5px;line-height:1.45;color:#B7B9C0;margin:14px 14px 0">Профили отдельно.<br>Без слежки.<br>Всё хранится у вас.</div>
</body>`;

const header = `<body style="margin:0;width:150px;height:57px;background:#fff;${font};overflow:hidden;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-right:10px;box-sizing:border-box">
  <div style="font-size:13px;font-weight:700;color:#17181B">Ось Browser</div>
  ${logo.replace('width="256" height="256"', 'width="38" height="38"')}
</body>`;

/** PNG-скриншот → BMP 24 бит (снизу вверх, строки выровнены до 4 байт), как требует NSIS. */
function pngToBmp(rgba, w, h) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + row * h);
  buf.write('BM', 0); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14); buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = 54 + (h - 1 - y) * row + x * 3;
    buf[d] = rgba[s + 2]; buf[d + 1] = rgba[s + 1]; buf[d + 2] = rgba[s];
  }
  return buf;
}

// В облачной среде браузер Playwright лежит отдельно; локально — обычный запуск.
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
for (const [name, html, w, h] of [['installerSidebar', sidebar, 164, 314], ['installerHeader', header, 150, 57]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<!doctype html><meta charset="utf-8">${html}`);
  const png = await page.screenshot({ type: 'png' });
  writeFileSync(new URL(`../assets/${name}.png`, import.meta.url), png);
  // Пиксели из PNG через canvas в той же странице.
  const rgba = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(0, 0, img.width, img.height).data);
  }, png.toString('base64'));
  writeFileSync(new URL(`../assets/${name}.bmp`, import.meta.url), pngToBmp(Buffer.from(rgba), w, h));
  await page.close();
}
await browser.close();
