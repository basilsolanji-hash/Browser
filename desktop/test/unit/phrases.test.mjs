import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { greetingKey, nextIndex } from '../../src/main/phrasedeck.ts';

const dir = new URL('../../assets/phrases/', import.meta.url);

test('300 phrases per language, non-empty, no repeats', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.txt'));
  assert.equal(files.length, 16);
  for (const f of files) {
    const lines = readFileSync(new URL(f, dir), 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    assert.equal(lines.length, 300, f);
    assert.equal(new Set(lines).size, 300, f);
  }
});

test('greeting by hour', () => {
  assert.equal(greetingKey(8), 'greet_morning');
  assert.equal(greetingKey(13), 'greet_day');
  assert.equal(greetingKey(19), 'greet_evening');
  assert.equal(greetingKey(2), 'greet_night');
  assert.equal(greetingKey(23), 'greet_night');
  assert.equal(greetingKey(5), 'greet_morning');
});

test('300 shows in a row are all different, no repeat across decks', () => {
  let state = { deck: [], pos: -1 };
  const shown = [];
  for (let i = 0; i < 3000; i++) {
    const r = nextIndex(state, 300);
    shown.push(r.index);
    state = r.state;
  }
  for (let k = 0; k < 10; k++) assert.equal(new Set(shown.slice(k * 300, k * 300 + 300)).size, 300);
  for (let i = 1; i < shown.length; i++) assert.notEqual(shown[i], shown[i - 1]);
});

test('deck boundary: new deck never starts with the last shown phrase', () => {
  // Генератор, который всегда оставляет порядок 0..n-1: последняя фраза колоды = 299, первая новой ≠ 299.
  const deck = [...Array(300).keys()].reverse();
  const r = nextIndex({ deck, pos: 299 }, 300, () => 0.999999);
  assert.notEqual(r.index, deck[299]);
});
