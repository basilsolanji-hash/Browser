import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frequentSites, hints } from '../../src/main/addrpanel.ts';

const visits = [
  { u: 'https://news.example.com/a', t: 'Latest news' },
  { u: 'https://duckduckgo.com/?q=weather+moscow', t: 'weather moscow at DuckDuckGo' },
  { u: 'https://news.example.com/b', t: '' },
  { u: 'https://yandex.ru/search/?text=weather+spb&lr=2', t: '' },
  { u: 'https://shop.example.org/', t: 'Shop' },
  { u: 'https://duckduckgo.com/?q=weather+moscow', t: '' },
];

test('frequent sites: by visits, label = last page title, search pages skipped', () => {
  const tiles = frequentSites(visits);
  assert.deepEqual(tiles.map((x) => x.host), ['news.example.com', 'shop.example.org']);
  assert.equal(tiles[0].label, 'Latest news');
  assert.equal(tiles[0].url, 'https://news.example.com/');
  assert.equal(frequentSites([{ u: 'https://www.a.com/', t: ' ' }])[0].label, 'a.com');
  assert.equal(frequentSites(Array.from({ length: 20 }, (_, i) => ({ u: `https://s${i}.com/`, t: '' }))).length, 8);
});

test('hints: past queries first (no duplicates), then favorites and history, up to 6', () => {
  const marks = [{ u: 'https://weather.example/', t: 'Weather site' }];
  const h = hints('weather', visits, marks);
  assert.deepEqual(h.filter((x) => x.kind === 'query').map((x) => x.title), ['weather moscow', 'weather spb']);
  assert.equal(h[2].kind, 'favorite');
  assert.ok(!h.some((x) => x.kind === 'history' && x.url.includes('duckduckgo')));
  assert.equal(hints('', visits, marks).length, 0);
  assert.equal(hints('weather moscow', visits, []).filter((x) => x.kind === 'query').length, 0);
  const many = Array.from({ length: 20 }, (_, i) => ({ u: `https://x${i}.com/`, t: 'x' }));
  assert.equal(hints('x', many, []).length, 6);
});
