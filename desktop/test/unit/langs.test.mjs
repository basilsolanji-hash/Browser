import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS, LANG_NAMES, RTL } from '../../src/shared/format.ts';
import { LANGS as GEN_LANGS, load } from '../../scripts/gen-i18n.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('16 interface languages in the Android column order (WINDOWS_SYNC §22)', () => {
  assert.deepEqual([...LANGS], ['en', 'ru', 'es', 'pt', 'fr', 'de', 'ar', 'hi', 'tr', 'zh', 'be', 'uz', 'ky', 'tg', 'kk', 'hy']);
  assert.deepEqual(GEN_LANGS, [...LANGS], 'gen-i18n reads Tr*.kt columns in the same order');
  for (const l of LANGS) assert.ok(LANG_NAMES[l], `name for ${l}`);
  assert.deepEqual([...RTL], ['ar'], 'the six new languages are left-to-right');
});

test('every language has 300 phrases, line N is the same phrase everywhere', () => {
  for (const l of LANGS) {
    const lines = readFileSync(join(root, 'assets', 'phrases', `${l}.txt`), 'utf8').split(/\r?\n/).filter((x) => x.trim());
    assert.equal(lines.length, 300, `${l}.txt`);
  }
});

test('Microsoft Store captions for Windows exist in every language', () => {
  const c = JSON.parse(readFileSync(join(root, 'store', 'captions-desktop.json'), 'utf8'));
  for (const [k, v] of Object.entries(c)) {
    if (k === '_') continue;
    for (const l of LANGS) assert.ok(v[l]?.trim(), `${k}: ${l}`);
  }
});

test('every string of Tr*.kt is translated into all 16 languages', () => {
  const empty = Object.entries(load()).flatMap(([k, v]) => LANGS.filter((_l, i) => !v[i]?.trim()).map((l) => `${k}:${l}`));
  assert.deepEqual(empty, []);
});
