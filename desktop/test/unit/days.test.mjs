import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RANGE, RANGES, countSince, dayStart, dayTitle, daysAgo, groupByDay, groupDownloads, sinceFor } from '../../src/shared/days.ts';

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 10, 25, 15, 30);

test('days ago by calendar, not by 24 hours', () => {
  assert.equal(daysAgo(at(2026, 10, 25, 0, 1), NOW), 0);
  assert.equal(daysAgo(at(2026, 10, 24, 23, 59), NOW), 1);
  assert.equal(daysAgo(at(2026, 10, 23, 23, 59), NOW), 2);
  assert.equal(daysAgo(at(2026, 3, 28, 12), at(2026, 3, 30, 1)), 2);
  assert.equal(dayStart(at(2026, 10, 25, 18)), at(2026, 10, 25, 0));
});

test('history groups: today, yesterday, date (newest first)', () => {
  const visits = [
    { u: 'a', d: at(2026, 10, 25, 9) },
    { u: 'b', d: at(2026, 10, 24, 22) },
    { u: 'c', d: at(2026, 10, 25, 14) },
    { u: 'd', d: at(2026, 10, 20, 8) },
  ];
  const g = groupByDay(visits, (v) => v.d, NOW);
  assert.deepEqual(g.map((x) => x.ago), [0, 1, 5]);
  assert.deepEqual(g[0].items.map((v) => v.u), ['c', 'a']);
  const labels = { just: 'Только что', today: 'Сегодня — %s', yesterday: 'Вчера — %s' };
  assert.equal(dayTitle(g[0], 'ru', labels), 'Сегодня — 25 окт. 2026 г.');
  assert.equal(dayTitle(g[1], 'ru', labels), 'Вчера — 24 окт. 2026 г.');
  assert.equal(dayTitle(g[2], 'en', { just: '', today: 'Today — %s', yesterday: 'Yesterday — %s' }), 'Oct 20, 2026');
});

test('downloads: «just now» holds running ones and the last 5 minutes', () => {
  const list = [
    { id: 1, time: NOW - 60_000, state: 'completed' },
    { id: 2, time: NOW - 3 * 3_600_000, state: 'completed' },
    { id: 3, time: NOW - 2 * 86_400_000, state: 'progress' },
    { id: 4, time: NOW - 86_400_000, state: 'completed' },
  ];
  const g = groupDownloads(list, (d) => d.time, (d) => d.state === 'progress', NOW);
  assert.equal(g[0].key, 'just');
  assert.deepEqual(g[0].items.map((d) => d.id), [1, 3]);
  assert.deepEqual(g.slice(1).map((x) => [x.ago, x.items.map((d) => d.id)]), [[0, [2]], [1, [4]]]);
  assert.equal(dayTitle(g[0], 'ru', { just: 'Только что', today: '', yesterday: '' }), 'Только что');
  assert.deepEqual(groupDownloads([], (d) => d.time, () => false, NOW), []);
});

test('clear ranges', () => {
  assert.deepEqual(RANGES.map((r) => r.key), ['range_15m', 'range_1h', 'range_24h', 'range_7d', 'range_4w', 'range_all']);
  assert.equal(DEFAULT_RANGE, 'range_all');
  assert.equal(sinceFor('range_15m', NOW), NOW - 15 * 60_000);
  assert.equal(sinceFor('range_4w', NOW), NOW - 28 * 86_400_000);
  assert.equal(sinceFor('range_all', NOW), 0);
  // Неизвестный диапазон ничего не удаляет.
  assert.equal(sinceFor('bogus', NOW), NOW);
  const items = [NOW - 10 * 60_000, NOW - 2 * 3_600_000, NOW - 30 * 86_400_000];
  assert.equal(countSince(items, (x) => x, sinceFor('range_15m', NOW)), 1);
  assert.equal(countSince(items, (x) => x, sinceFor('range_24h', NOW)), 2);
  assert.equal(countSince(items, (x) => x, sinceFor('range_all', NOW)), 3);
});
