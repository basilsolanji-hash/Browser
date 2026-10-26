// Переводы — единый источник с Android: разбираем Tr*.kt и пишем src/i18n/<lang>.json.
// Формат строк в Kotlin: "ключ" to listOf("en", "ru", …) — порядок языков как в Tr.CODES без "system".
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ktDir = join(here, '../../app/src/main/java/ru/multibrowser');
const outDir = join(here, '../src/i18n');
export const LANGS = ['en', 'ru', 'es', 'pt', 'fr', 'de', 'ar', 'hi', 'tr', 'zh', 'be', 'uz', 'ky', 'tg', 'kk', 'hy'];

/** Строковый литерал Kotlin, начиная с открывающей кавычки в позиции i; возвращает [текст, позиция после]. */
function literal(src, i) {
  let out = '';
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') return [out, i + 1];
    if (c === '\\') {
      const n = src[i + 1];
      const map = { n: '\n', t: '\t', r: '\r', '"': '"', "'": "'", '\\': '\\', $: '$', b: '\b' };
      if (n === 'u') { out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)); i += 6; continue; }
      if (!(n in map)) throw new Error(`Неизвестная escape-последовательность \\${n}`);
      out += map[n];
      i += 2;
      continue;
    }
    if (c === '$' && /[a-zA-Z{]/.test(src[i + 1] ?? '')) throw new Error('Шаблон $ в строке перевода: ' + src.slice(i, i + 20));
    out += c;
    i++;
  }
  throw new Error('Незакрытая строка');
}

export function parse(src, file) {
  const rows = {};
  const re = /"([a-z0-9_]+)"\s+to\s+listOf\(/g;
  let m;
  while ((m = re.exec(src))) {
    const key = m[1];
    let i = re.lastIndex;
    const vals = [];
    for (;;) {
      while (/[\s,]/.test(src[i])) i++;
      if (src[i] === ')') break;
      if (src[i] !== '"') throw new Error(`${file}: ${key}: ожидалась строка, а не «${src.slice(i, i + 15)}»`);
      const [s, next] = literal(src, i);
      vals.push(s);
      i = next;
    }
    if (vals.length < LANGS.length) throw new Error(`${file}: ${key}: ${vals.length} переводов вместо ${LANGS.length}`);
    if (rows[key]) throw new Error(`${file}: ключ ${key} повторяется`);
    rows[key] = vals;
    re.lastIndex = i;
  }
  return rows;
}

export function load() {
  const all = {};
  for (const f of readdirSync(ktDir).filter((f) => /^Tr\w*\.kt$/.test(f)).sort()) {
    const rows = parse(readFileSync(join(ktDir, f), 'utf8'), f);
    for (const k of Object.keys(rows)) {
      if (all[k]) throw new Error(`Ключ ${k} есть в двух модулях (${f})`);
      all[k] = rows[k];
    }
  }
  return all;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const all = load();
  mkdirSync(outDir, { recursive: true });
  LANGS.forEach((lang, idx) => {
    const dict = {};
    for (const [k, v] of Object.entries(all)) dict[k] = v[idx] || v[0];
    writeFileSync(join(outDir, `${lang}.json`), JSON.stringify(dict));
  });
  console.log(`i18n: ${Object.keys(all).length} ключей × ${LANGS.length} языков`);
}
