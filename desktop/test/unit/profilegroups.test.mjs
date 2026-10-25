import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VISIBLE_PROFILES, byFolder, visibleProfiles } from '../../src/shared/profilegroups.ts';

test('home shows 10 profiles until «Show all»', () => {
  const ids = Array.from({ length: 15 }, (_, i) => i + 1);
  assert.equal(VISIBLE_PROFILES, 10);
  assert.deepEqual(visibleProfiles(ids, false), ids.slice(0, 10));
  assert.equal(visibleProfiles(ids, true).length, 15);
  assert.equal(visibleProfiles([1, 2], false).length, 2);
});

test('folders sorted by name, «no folder» last, order inside kept', () => {
  const list = [
    { id: 1, f: '' }, { id: 2, f: 'Работа' }, { id: 3, f: 'дом' }, { id: 4, f: '' }, { id: 5, f: 'Работа' }, { id: 6, f: 'Банки' },
  ];
  const s = byFolder(list, (x) => x.f, 'ru');
  assert.deepEqual(s.map((x) => x.folder), ['Банки', 'дом', 'Работа', '']);
  assert.deepEqual(s[2].items.map((x) => x.id), [2, 5]);
  assert.deepEqual(s[3].items.map((x) => x.id), [1, 4]);
  assert.deepEqual(byFolder([{ id: 1, f: '' }], (x) => x.f).map((x) => x.folder), ['']);
  assert.deepEqual(byFolder([], (x) => x.f), []);
});
