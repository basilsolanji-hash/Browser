// Проверка переводов сайта: у каждого ключа есть все 16 языков, подстановки {x} совпадают с английскими.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS } from './langs.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/i18n');
const read = (l) => JSON.parse(readFileSync(join(dir, `${l}.json`), 'utf8'));
const marks = (s) => [...s.matchAll(/\{[\w:]+\}|\*/g)].map((m) => m[0]).sort().join(',');
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
// Запрещённые синонимы берём из общего словаря, не из отдельного списка сайта.
const glossary = readFileSync(join(dir, '../../../docs/GLOSSARY.md'), 'utf8').split('## Запрещённые синонимы')[1];
for (const row of glossary.split('\n')) {
  const cells = row.split('|').map((x) => x.trim());
  if (!LANGS.includes(cells[1])) continue;
  for (const [key, value] of Object.entries(read(cells[1]))) {
    if (value.toLocaleLowerCase().includes(cells[2].toLocaleLowerCase())) errors.push(`${cells[1]}: ${key}: запрещённый синоним ${cells[2]} (GLOSSARY.md)`);
  }
}
// Ссылки {app:ключ} должны указывать на строки приложения (их выгружает prepare.mjs).
let app = null;
try { app = JSON.parse(readFileSync(join(dir, 'app.generated.json'), 'utf8')); } catch { /* prepare ещё не запускался */ }
if (app) for (const k of Object.keys(en)) for (const m of en[k].matchAll(/\{app:(\w+)\}/g)) for (const lang of LANGS) if (!app[lang]?.[m[1]]) errors.push(`${lang}: ${k}: нет строки приложения ${m[1]} — добавьте её в APP_KEYS (prepare.mjs)`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`i18n: ${Object.keys(en).length} ключей × ${LANGS.length} языков — ок`);
