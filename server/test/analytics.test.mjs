import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { UsageQueue } from '../src/usage-queue.mjs';
import { validateBatch } from '../src/usage-schema.mjs';
import { AnalyticsStore } from '../src/analytics.mjs';
const batch = () => ({ platform: 'android', events: [{ feature: 'notes_open', count: 1 }] });
const context = (accountId = 'person-1') => ({ consent: true, privateMode: false, accountId });
const day = '2026-11-07';
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'os-analytics-'));
  const path = join(dir, 'analytics.sqlite');
  const clock = { now: Date.parse(day) };
  const store = new AnalyticsStore(path, { clock: () => clock.now });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, path, clock };
}

test('no consent means no queued or transmitted activity', () => {
  const queue = new UsageQueue('android');
  assert.equal(queue.record('notes_open'), false);
  assert.equal(queue.drain(), null);
});
test('withdrawal destroys queued activity; re-consent does not restore it', () => {
  const queue = new UsageQueue('windows');
  queue.setConsent(true); queue.record('notes_open'); queue.setConsent(false);
  assert.equal(queue.drain(), null);
  queue.setConsent(true); assert.equal(queue.drain(), null);
});
test('incognito does not collect or send even with consent', () => {
  const queue = new UsageQueue('android');
  queue.setConsent(true); queue.record('favorites_add'); queue.setPrivateMode(true);
  assert.equal(queue.record('notes_create'), false); assert.equal(queue.drain(), null);
  queue.setPrivateMode(false); assert.equal(queue.drain(), null);
});
test('batch contains only aggregate counts and platform; no event identifiers/times', () => {
  const queue = new UsageQueue('android'); queue.setConsent(true);
  queue.record('notes_open'); queue.record('notes_open');
  assert.deepEqual(queue.drain(), { platform: 'android', events: [{ feature: 'notes_open', count: 2 }] });
  assert.equal(queue.drain(), null);
});
test('queue stays bounded during an offline interval', () => {
  const queue = new UsageQueue('android'); queue.setConsent(true);
  for (let i = 0; i < 2000; i++) queue.record('notes_open');
  assert.equal(queue.drain().events[0].count, 1000);
});
test('untrusted fields including personal data are rejected at every level', () => {
  for (const key of ['url', 'host', 'query', 'password', 'text', 'accountId', 'deviceId', 'timestamp', 'consent']) {
    assert.throws(() => validateBatch({ ...batch(), [key]: 'private-value' }), TypeError);
    const value = batch(); value.events[0][key] = 'private-value';
    assert.throws(() => validateBatch(value), TypeError);
  }
  const value = batch(); value.events[0].feature = 'https://private.example';
  assert.throws(() => validateBatch(value), TypeError);
});
test('invalid numeric values and duplicate/oversized events are rejected', () => {
  for (const count of [-1, 0, 1.5, NaN, Infinity, 1001, '1']) {
    const value = batch(); value.events[0].count = count;
    assert.throws(() => validateBatch(value), TypeError);
  }
  const duplicate = batch(); duplicate.events.push({ ...duplicate.events[0] });
  assert.throws(() => validateBatch(duplicate), TypeError);
  assert.throws(() => validateBatch({ platform: 'android', events: [] }), TypeError);
  assert.throws(() => validateBatch({ platform: 'other', events: batch().events }), TypeError);
});
test('server fails closed without authenticated current consent and non-private context', (t) => {
  const { store, path } = fixture(t);
  for (const c of [undefined, {}, { ...context(), consent: false }, { ...context(), privateMode: true }, { consent: true }]) {
    assert.equal(store.ingest(batch(), c), false);
  }
  const db = new DatabaseSync(path); t.after(() => db.close());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usage_counts').get().n, 0);
});
test('one user cannot inflate the unique-participant privacy threshold', (t) => {
  const { store } = fixture(t);
  for (let i = 0; i < 30; i++) store.ingest(batch(), context());
  assert.deepEqual(store.summary(day, day), []);
});
test('twenty distinct consenting accounts reveal only aggregate counts', (t) => {
  const { store, path, clock } = fixture(t);
  for (let i = 0; i < 20; i++) store.ingest(batch(), context(`private-person-${i}`));
  assert.deepEqual(store.summary(day, day), []);
  clock.now += 86400000;
  const rows = store.summary(day, day);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0] }, { day, platform: 'android', feature: 'notes_open', count: 20 });
  const bytes = readFileSync(path).toString('utf8');
  assert.equal(bytes.includes('private-person'), false);
  const db = new DatabaseSync(path); t.after(() => db.close());
  assert.deepEqual(db.prepare('PRAGMA table_info(usage_counts)').all().map((x) => x.name), ['day', 'platform', 'feature', 'count', 'publishable']);
});
test('threshold does not combine different platforms or functions', (t) => {
  const { store } = fixture(t);
  for (let i = 0; i < 19; i++) store.ingest(batch(), context(`a-${i}`));
  store.ingest({ platform: 'windows', events: [{ feature: 'notes_open', count: 1 }] }, context('a-19'));
  store.ingest({ platform: 'android', events: [{ feature: 'favorites_add', count: 1 }] }, context('a-19'));
  assert.deepEqual(store.summary(day, day), []);
});
test('retention removes old data from the database rather than just hiding it', (t) => {
  const { store, path, clock } = fixture(t);
  store.ingest(batch(), context());
  clock.now += 30 * 86400000;
  assert.deepEqual(store.summary(day, '2026-12-31'), []);
  const db = new DatabaseSync(path); t.after(() => db.close());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usage_counts').get().n, 0);
});
test('invalid ranges/dates are refused', (t) => {
  const { store } = fixture(t);
  for (const [a, b] of [['2026-02-30', day], [day, '2026-11-01'], ['any', day]]) {
    assert.throws(() => store.summary(a, b), TypeError);
  }
});


test('live days never appear, including the twenty to twenty-one participant transition', (t) => {
  const { store, clock } = fixture(t);
  for (let i = 0; i < 20; i++) store.ingest(batch(), context(`person-${i}`));
  assert.deepEqual(store.summary(day, day), []);
  store.ingest(batch(), context('person-20'));
  assert.deepEqual(store.summary(day, '2026-12-31'), []);
  clock.now += 86400000;
  assert.equal(store.summary(day, day)[0].count, 21);
});

test('new current-day activity cannot change a closed day', (t) => {
  const { store, clock } = fixture(t);
  for (let i = 0; i < 20; i++) store.ingest(batch(), context(`person-${i}`));
  clock.now += 86400000; const closed = store.summary(day, day);
  for (let i = 0; i < 25; i++) store.ingest(batch(), context(`later-${i}`));
  assert.deepEqual(store.summary(day, '2026-12-31'), closed);
  assert.throws(() => store.ingest({ ...batch(), day }, context('backdate')), TypeError);
  assert.deepEqual(store.summary(day, day), closed);
});
