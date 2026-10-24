// Подготовка перед сборкой: шрифты со своего хостинга и строки из переводов приложения.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from '../../desktop/scripts/gen-i18n.mjs';
import { LANGS } from './langs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Только нужные начертания и подмножества — каждый файл грузится по unicode-range.
const fonts = [];
for (const w of [400, 600, 700]) for (const s of ['latin', 'latin-ext', 'cyrillic']) fonts.push(`inter/files/inter-${s}-${w}-normal.woff2`);
for (const s of ['latin', 'latin-ext', 'cyrillic']) fonts.push(`unbounded/files/unbounded-${s}-700-normal.woff2`);
mkdirSync(join(root, 'public/fonts'), { recursive: true });
for (const f of fonts) copyFileSync(join(root, 'node_modules/@fontsource', f), join(root, 'public/fonts', f.split('/').pop()));

// Ключи приложения, которые сайт показывает дословно, чтобы сайт и приложение говорили одинаково.
const APP_KEYS = /^(help_[qa]\d+|about_desc|about_privacy)$/;
const all = load();
const out = {};
LANGS.forEach((lang, i) => {
  out[lang] = {};
  for (const [k, v] of Object.entries(all)) if (APP_KEYS.test(k)) out[lang][k] = v[i] || v[0];
});
writeFileSync(join(root, 'src/i18n/app.generated.json'), JSON.stringify(out, null, 1));
console.log(`prepare: ${fonts.length} шрифтов, ${Object.keys(out.en).length} строк приложения`);
