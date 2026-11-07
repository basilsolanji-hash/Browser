import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
const data = JSON.parse(readFileSync(new URL('server/public/i18n.json', root), 'utf8'));
const languages = 'en ru es pt fr de ar hi tr zh be uz ky tg kk hy'.split(' ');
test('owner interface has all sixteen complete dictionaries', () => {
  assert.deepEqual(Object.keys(data), languages);
  for (const lang of languages) {
    assert.deepEqual(Object.keys(data[lang]), Object.keys(data.en));
    for (const value of Object.values(data[lang])) assert.ok(typeof value === 'string' && value.trim());
  }
});
test('shared labels use the canonical Android/glossary terms', () => {
  const directory = new URL('app/src/main/java/ru/multibrowser/', root);
  const source = readdirSync(directory).filter((x) => /^Tr.*\.kt$/.test(x)).map((x) => readFileSync(new URL(x, directory), 'utf8')).join('\n');
  for (const key of ['profiles', 'notes', 'favorites', 'passwords', 'dl_title', 'refresh', 'search', 'language']) {
    const match = source.match(new RegExp('"' + key + '" to listOf\\((.*?)\\),', 's'));
    assert.ok(match, key);
    const values = JSON.parse('[' + match[1] + ']');
    languages.forEach((lang, i) => assert.equal(data[lang][key], values[i], `${lang}/${key}`));
  }
});
test('forbidden glossary synonyms do not appear in interface strings', () => {
  const glossary = readFileSync(new URL('docs/GLOSSARY.md', root), 'utf8').split('## Запрещённые синонимы')[1];
  for (const match of glossary.matchAll(/^\| (\w+) \| ([^|]+) \|/gm)) {
    const [, lang, forbidden] = match;
    if (data[lang]) for (const value of Object.values(data[lang])) assert.ok(!value.toLowerCase().includes(forbidden.trim().toLowerCase()), `${lang}: ${forbidden}`);
  }
});
