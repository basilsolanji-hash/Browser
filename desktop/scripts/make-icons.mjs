// Значки приложения из логотипа Android (ic_launcher_fg.xml на фоне mb_icon_bg): PNG и ICO.
// Запускать вручную при смене логотипа: node scripts/make-icons.mjs (нужен Chromium для Playwright).
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '../assets');
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">
<rect x="6" y="6" width="96" height="96" rx="22" fill="#17181B"/>
<path fill="#F0453A" d="M27,52.5H80V55.5H27Z"/><path fill="#F0453A" d="M20,54a6,6 0 1,0 12,0a6,6 0 1,0 -12,0z"/>
<path fill="#F0453A" d="M77,49H86V58H77Z"/>
<path fill="none" stroke="#FFFFFF" stroke-width="7" d="M35,54a19,17.5 0 1,0 38,0a19,17.5 0 1,0 -38,0z"/></svg>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
const png = {};
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`);
  png[size] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
writeFileSync(join(out, 'icon.png'), png[512]);
writeFileSync(join(out, 'icon-256.png'), png[256]);
writeFileSync(join(out, 'logo.svg'), svg(256));

// ICO с PNG внутри (поддерживается Windows Vista+).
const sizes = [16, 24, 32, 48, 64, 256];
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s === 256 ? 0 : s, e); header.writeUInt8(s === 256 ? 0 : s, e + 1);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(png[s].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += png[s].length;
});
writeFileSync(join(out, 'icon.ico'), Buffer.concat([header, ...sizes.map((s) => png[s])]));
console.log('icons: ok');
