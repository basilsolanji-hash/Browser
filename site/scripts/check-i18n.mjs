// Проверка переводов сайта: у каждого ключа есть все 10 языков, подстановки {x} совпадают с английскими.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS } from './langs.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/i18n');
const read = (l) => JSON.parse(readFileSync(join(dir, `${l}.json`), 'utf8'));
const marks = (s) => [...s.matchAll(/\{\w+\}|\*/g)].map((m) => m[0]).sort().join(',');
const en = read('en');
const errors = [];
for (const lang of LANGS) {
  let d;
  try { d = read(lang); } catch (e) { errors.push(`${lang}: нет файла или ошибка JSON — ${e.message}`); continue; }
  for (const k of Object.keys(en)) {
    if (typeof d[k] !== 'string' || !d[k].trim()) errors.push(`${lang}: нет ключа ${k}`);
    else if (marks(d[k]) !== marks(en[k])) errors.push(`${lang}: ${k}: подстановки «${marks(d[k])}» вместо «${marks(en[k])}»`);
  }
  for (const k of Object.keys(d)) if (!(k in en)) errors.push(`${lang}: лишний ключ ${k}`);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`i18n: ${Object.keys(en).length} ключей × ${LANGS.length} языков — ок`);
