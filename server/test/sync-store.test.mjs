import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { SyncStore, SYNC_LIMITS } from '../src/sync-store.mjs';

const scope = () => ({ accountId: randomUUID(), vaultId: randomUUID(), deviceId: randomUUID() });
const raw = (body) => Buffer.from(JSON.stringify(body));
// Opaque wire-shape fixtures only. They intentionally do not claim a verified JOSE/GCM test vector.
function change(s, id = randomUUID(), baseRevision = 0, deleted = false, payloadBytes = 24) {
  const revision = baseRevision + 1, epoch = 1;
  const header = { alg: 'dir', enc: 'A256GCM', typ: 'os-sync+jwe', osv: 1,
    vault: s.vaultId, record: id, rev: revision, epoch, deleted };
  const jwe = [Buffer.from(JSON.stringify(header)).toString('base64url'), '',
    Buffer.alloc(12, 7).toString('base64url'), Buffer.alloc(payloadBytes, 0xa5).toString('base64url'),
    Buffer.alloc(16, 9).toString('base64url')].join('.');
  return { recordId: id, baseRevision, revision, epoch, deleted, jwe };
}
const mutation = (changes, preconditions = [], mutationId = randomUUID()) => ({ mutationId, preconditions, changes });
const expectCode = (fn, code) => assert.throws(fn, (error) => error.code === code && error.message === code);
function fixture(t, limits = {}, extraOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'os-sync-store-'));
  const path = join(dir, 'sync.sqlite'), a = scope(), b = scope(), permitted = new Set([a.accountId + a.deviceId, b.accountId + b.deviceId]);
  const options = { limits, authorize: (s) => permitted.has(s.accountId + s.deviceId), ...extraOptions };
  let store = new SyncStore(path, options);
  store.createVault(a); store.createVault(b);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { a, b, path, permitted, get store() { return store; },
    restart() { store.close(); store = new SyncStore(path, options); } };
}

test('two tenants can use the same record UUID without seeing or changing the other vault', (t) => {
  const f = fixture(t), id = randomUUID();
  const a = change(f.a, id), b = change(f.b, id, 0, false, 60);
  f.store.apply(f.a, raw(mutation([a]))); f.store.apply(f.b, raw(mutation([b])));
  assert.equal(f.store.changes(f.a).records[0].jwe, a.jwe);
  assert.equal(f.store.changes(f.b).records[0].jwe, b.jwe);
  const foreign = { ...f.a, vaultId: f.b.vaultId };
  expectCode(() => f.store.apply(foreign, raw(mutation([change(f.b, id, 1)]))), 'not_found');
  expectCode(() => f.store.changes(foreign), 'not_found');
  assert.equal(f.store.usage(f.b).sequence, 1);
});

test('lost-response replay is exact and durable, while altered bytes reuse is refused', (t) => {
  const f = fixture(t), request = raw(mutation([change(f.a)]));
  const first = f.store.apply(f.a, request), before = f.store.usage(f.a);
  f.restart();
  assert.deepEqual(f.store.apply(f.a, request), { replayed: true, result: first.result });
  assert.deepEqual(f.store.usage(f.a), before);
  expectCode(() => f.store.apply(f.a, Buffer.concat([request, Buffer.from('\n')])), 'mutation_mismatch');
  const changed = JSON.parse(request); changed.changes[0] = change(f.a);
  expectCode(() => f.store.apply(f.a, raw(changed)), 'mutation_mismatch');
  assert.deepEqual(f.store.usage(f.a), before);
});

test('revocation is rechecked before returning even an exact receipt', (t) => {
  const f = fixture(t), request = raw(mutation([change(f.a)]));
  f.store.apply(f.a, request); f.permitted.delete(f.a.accountId + f.a.deviceId);
  expectCode(() => f.store.apply(f.a, request), 'forbidden');
  expectCode(() => f.store.changes(f.a), 'forbidden');
});

test('undefined, false, Promise and throwing authorization hooks leave no data writes', async () => {
  for (const hook of [() => undefined, () => false, () => Promise.resolve(false), async () => { throw new Error('PRIVATE AUTH'); }, () => { throw new Error('PRIVATE AUTH'); }]) {
    const dir = mkdtempSync(join(tmpdir(), 'os-sync-auth-')), path = join(dir, 'db.sqlite');
    const store = new SyncStore(path, { authorize: hook });
    try {
      expectCode(() => store.createVault(scope()), 'forbidden');
      const db = new DatabaseSync(path);
      try {
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_vaults').get().n, 0);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get().n, 0);
        assert.equal(db.prepare('SELECT main_bytes FROM sync_totals WHERE id=1').get().main_bytes, 0);
      } finally { db.close(); }
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  }
  const store = new SyncStore(':memory:'); expectCode(() => store.createVault(scope()), 'forbidden'); store.close();
  await new Promise((resolve) => setImmediate(resolve));
});

test('one failing CAS rolls the entire batch back and does not burn its mutation ID', (t) => {
  const f = fixture(t), first = change(f.a), second = change(f.a);
  f.store.apply(f.a, raw(mutation([first, second]))); const before = f.store.usage(f.a);
  const rejected = mutation([change(f.a, first.recordId, 1), change(f.a, second.recordId, 0)]);
  expectCode(() => f.store.apply(f.a, raw(rejected)), 'conflict');
  assert.deepEqual(f.store.usage(f.a), before);
  const page = f.store.changes(f.a); assert.deepEqual(page.records.map((r) => r.revision), [1, 1]);
  rejected.changes[1] = change(f.a, second.recordId, 1);
  assert.equal(f.store.apply(f.a, raw(rejected)).replayed, false);
  assert.equal(f.store.usage(f.a).sequence, 4);
});

test('live/deleted preconditions are checked against the state before the batch', (t) => {
  const f = fixture(t), profile = change(f.a), password = change(f.a);
  f.store.apply(f.a, raw(mutation([profile])));
  const precondition = { recordId: profile.recordId, revision: 1, deleted: false };
  f.store.apply(f.a, raw(mutation([password], [precondition])));
  f.store.apply(f.a, raw(mutation([change(f.a, profile.recordId, 1, true)])));
  const staleLive = { ...precondition, revision: 2 };
  const before = f.store.usage(f.a);
  expectCode(() => f.store.apply(f.a, raw(mutation([change(f.a, password.recordId, 1)], [staleLive]))), 'conflict');
  expectCode(() => f.store.apply(f.a, raw(mutation([change(f.a, profile.recordId, 2)], [{ ...precondition, revision: 2, deleted: true }]))), 'invalid_precondition');
  assert.deepEqual(f.store.usage(f.a), before);
  // Password cleanup remains possible after its profile tombstone without a live-profile precondition.
  assert.equal(f.store.apply(f.a, raw(mutation([change(f.a, password.recordId, 1, true)]))).result.sequence, 4);
});

test('snapshot cursor, contiguous versions and exact page replay survive writes and restart', (t) => {
  const f = fixture(t), records = [change(f.a), change(f.a), change(f.a)];
  f.store.apply(f.a, raw(mutation(records)));
  const first = f.store.changes(f.a, { pageSize: 1 }); assert.equal(first.upperSequence, 3);
  f.store.apply(f.a, raw(mutation([change(f.a, records[0].recordId, 1)])));
  f.restart();
  assert.deepEqual(f.store.changes(f.a, { cursor: first.cursor, pageSize: 1 }), first);
  const second = f.store.changes(f.a, { cursor: first.cursor, after: first.nextAfter, pageSize: 1 });
  const third = f.store.changes(f.a, { cursor: first.cursor, after: second.nextAfter, pageSize: 1 });
  assert.deepEqual([first.records[0].sequence, second.records[0].sequence, third.records[0].sequence], [1, 2, 3]);
  assert.equal(third.done, true); assert.equal(third.upperSequence, 3);
  expectCode(() => f.store.changes(f.b, { cursor: first.cursor }), 'invalid_cursor');
  f.store.closeCursor(f.a, first.cursor);
  assert.equal(f.store.changes(f.a, { after: 3 }).records[0].revision, 2);
});

test('page byte limit never truncates one opaque record', (t) => {
  const f = fixture(t, { maxLiveJweBytes: 2048, maxPageBytes: 2560 });
  const list = [change(f.a, randomUUID(), 0, false, 900), change(f.a, randomUUID(), 0, false, 900)];
  f.store.apply(f.a, raw(mutation(list)));
  const page = f.store.changes(f.a);
  assert.equal(page.records.length, 1); assert.equal(page.records[0].jwe, list[0].jwe);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 2560);
  const next = f.store.changes(f.a, { cursor: page.cursor, after: page.nextAfter });
  assert.equal(next.records[0].jwe, list[1].jwe); assert.equal(next.done, true);
});

test('retained history consumes the main quota but pure terminal deletion uses its admitted reserve', (t) => {
  const f = fixture(t, { maxMainBytes: 7000, maxCursors: 1 });
  const initial = change(f.a); f.store.apply(f.a, raw(mutation([initial])));
  let revision = 1;
  while (true) {
    try { f.store.apply(f.a, raw(mutation([change(f.a, initial.recordId, revision)]))); revision++; }
    catch (error) { assert.equal(error.code, 'quota_exceeded'); break; }
  }
  const before = f.store.usage(f.a); assert.equal(before.records, 1); assert.equal(before.reservedBytes, 4096);
  const deletion = raw(mutation([change(f.a, initial.recordId, revision, true)]));
  assert.equal(f.store.apply(f.a, deletion).replayed, false);
  const after = f.store.usage(f.a); assert.equal(after.mainBytes, before.mainBytes);
  assert.ok(after.emergencyBytes > 0 && after.emergencyBytes <= 4096);
  assert.equal(f.store.apply(f.a, deletion).replayed, true); assert.deepEqual(f.store.usage(f.a), after);
  expectCode(() => f.store.apply(f.a, raw(mutation([change(f.a, initial.recordId, revision + 1)]))), 'conflict');
  expectCode(() => f.store.apply(f.a, raw(mutation([change(f.a, initial.recordId, revision + 1, true)]))), 'conflict');
  f.restart();
  const history = f.store.changes(f.a).records;
  assert.equal(history.length, after.sequence); assert.equal(history.at(-1).deleted, true);
});

test('new ID admission reserves all deletion capacity atomically', (t) => {
  const f = fixture(t, { maxReserveBytes: 4096 });
  const before = f.store.usage(f.a);
  expectCode(() => f.store.apply(f.a, raw(mutation([change(f.a), change(f.a)]))), 'quota_exceeded');
  assert.deepEqual(f.store.usage(f.a), before);
  f.store.apply(f.a, raw(mutation([change(f.a)])));
  expectCode(() => f.store.apply(f.a, raw(mutation([change(f.a)]))), 'quota_exceeded');
});

test('tombstones occupy IDs and unknown-ID deletion or automatic resurrection is forbidden', (t) => {
  const f = fixture(t, { maxRecords: 1 });
  expectCode(() => f.store.apply(f.a, raw(mutation([change(f.a, randomUUID(), 0, true)]))), 'conflict');
  const live = change(f.a); f.store.apply(f.a, raw(mutation([live])));
  f.store.apply(f.a, raw(mutation([change(f.a, live.recordId, 1, true)])));
  expectCode(() => f.store.apply(f.a, raw(mutation([change(f.a)]))), 'quota_exceeded');
  assert.equal(f.store.usage(f.a).records, 1);
});

test('global ID and reserve quotas bind tenants together without mixing their data', (t) => {
  const f = fixture(t, { maxGlobalRecords: 1, maxGlobalReserveBytes: 4096 });
  f.store.apply(f.a, raw(mutation([change(f.a)])));
  expectCode(() => f.store.apply(f.b, raw(mutation([change(f.b)]))), 'quota_exceeded');
  assert.equal(f.store.usage(f.b).sequence, 0);
  f.store.eraseVault(f.a);
  assert.equal(f.store.apply(f.b, raw(mutation([change(f.b)]))).result.sequence, 1);
  expectCode(() => f.store.changes(f.a), 'not_found');
});

test('wire shape, UUID, raw request size, context and tombstone bounds reject without writes', (t) => {
  const f = fixture(t), original = change(f.a), before = f.store.usage(f.a);
  expectCode(() => f.store.apply(f.a, Buffer.alloc(SYNC_LIMITS.maxRequestBytes + 1)), 'request_too_large');
  expectCode(() => f.store.apply(f.a, mutation([original])), 'raw_bytes_required');
  const badId = { ...original, recordId: original.recordId.toUpperCase() };
  expectCode(() => f.store.apply(f.a, raw(mutation([badId]))), 'invalid_change');
  const wrongHeader = change(f.b, original.recordId);
  expectCode(() => f.store.apply(f.a, raw(mutation([wrongHeader]))), 'invalid_jwe_context');
  expectCode(() => f.store.apply(f.a, raw(mutation([{ ...original, jwe: 'plain private content' }]))), 'invalid_jwe');
  expectCode(() => f.store.apply(f.a, raw(mutation([original, original]))), 'invalid_change');
  const duplicateJson = Buffer.from(JSON.stringify(mutation([original])).replace('"preconditions":[]', '"preconditions":[],"preconditions":[]'));
  expectCode(() => f.store.apply(f.a, duplicateJson), 'duplicate_json_key');
  assert.deepEqual(f.store.usage(f.a), before);
  f.store.apply(f.a, raw(mutation([original])));
  const after = f.store.usage(f.a);
  expectCode(() => f.store.apply(f.a, raw(mutation([change(f.a, original.recordId, 1, true, 2000)]))), 'jwe_too_large');
  assert.deepEqual(f.store.usage(f.a), after);
});

test('only opaque wire data is persisted, with one JWE copy per immutable version', (t) => {
  const f = fixture(t), original = change(f.a);
  const marker = 'PRIVATE_SITE_PASSWORD_MUST_NOT_PERSIST';
  expectCode(() => f.store.apply(f.a, raw({ ...mutation([original]), password: marker })), 'invalid_mutation');
  f.store.apply(f.a, raw(mutation([original])));
  const db = new DatabaseSync(f.path); t.after(() => db.close());
  assert.equal(db.prepare('SELECT jwe FROM sync_versions WHERE record_id=?').get(original.recordId).jwe, original.jwe);
  assert.equal(db.prepare('PRAGMA table_info(sync_current)').all().some((column) => column.name === 'jwe'), false);
  assert.equal(db.prepare('PRAGMA table_info(sync_receipts)').all().some((column) => /body|jwe|key/.test(column.name)), false);
  assert.equal(readFileSync(f.path).includes(Buffer.from(marker)), false);
});

test('two independent SQLite workers serialize simultaneous exact retries into one commit', async (t) => {
  const f = fixture(t), request = raw(mutation([change(f.a)]));
  const gate = new SharedArrayBuffer(8); const state = new Int32Array(gate);
  const launch = () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sync-store-worker.mjs', import.meta.url), { workerData: { path: f.path, scope: f.a, request, gate } });
    worker.once('message', (message) => message.error ? reject(new Error(message.error)) : resolve(message));
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code) reject(new Error(`Worker exited ${code}`)); });
  });
  const one = launch(), two = launch(), combined = Promise.all([one, two]);
  combined.catch(() => {});
  while (Atomics.load(state, 0) < 2) {
    const ready = Atomics.load(state, 0);
    if (ready >= 2) break;
    assert.notEqual(await Atomics.waitAsync(state, 0, ready, 5000).value, 'timed-out');
  }
  Atomics.store(state, 1, 1); Atomics.notify(state, 1, 2);
  const results = await combined;
  assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true]);
  assert.deepEqual(results[0].result, results[1].result); assert.equal(f.store.usage(f.a).sequence, 1);
});


test('the global retained-byte limit applies across accounts while reserved deletion and reading still work', (t) => {
  const f = fixture(t, { maxCursors: 1, maxGlobalMainBytes: 7000, maxMainBytes: 7000 });
  const other = change(f.b), live = change(f.a);
  f.store.apply(f.b, raw(mutation([other]))); f.store.apply(f.a, raw(mutation([live])));
  let revision = 1;
  while (true) {
    try { f.store.apply(f.a, raw(mutation([change(f.a, live.recordId, revision)]))); revision++; }
    catch (error) { assert.equal(error.code, 'quota_exceeded'); break; }
  }
  assert.ok(f.store.usage(f.a).mainBytes < 7000);
  const before = f.store.usage(f.b);
  expectCode(() => f.store.apply(f.b, raw(mutation([change(f.b, other.recordId, 1)]))), 'quota_exceeded');
  assert.deepEqual(f.store.usage(f.b), before);
  f.store.apply(f.b, raw(mutation([change(f.b, other.recordId, 1, true)])));
  assert.equal(f.store.usage(f.b).mainBytes, before.mainBytes);
  assert.equal(f.store.changes(f.b).records.at(-1).deleted, true);
});

test('global ID ceiling and global reserve admission are each independently enforced', (t) => {
  for (const limits of [{ maxGlobalRecords: 1, maxGlobalReserveBytes: 8192 }, { maxGlobalRecords: 2, maxGlobalReserveBytes: 4096 }]) {
    const f = fixture(t, limits); f.store.apply(f.a, raw(mutation([change(f.a)])));
    expectCode(() => f.store.apply(f.b, raw(mutation([change(f.b)]))), 'quota_exceeded');
    assert.equal(f.store.usage(f.b).sequence, 0);
  }
});

test('cursor capacity and expiry are bounded, device-scoped and recoverable without deleting records', (t) => {
  const clock = { now: 1000 };
  const f = fixture(t, { maxCursors: 1, cursorLifetimeMs: 1000 }, { clock: () => clock.now });
  const live = change(f.a); f.store.apply(f.a, raw(mutation([live])));
  const page = f.store.changes(f.a);
  assert.deepEqual(f.store.changes(f.a), page); // Initial response replay does not allocate a new slot.
  const another = { ...f.a, deviceId: randomUUID() }; f.permitted.add(another.accountId + another.deviceId);
  expectCode(() => f.store.changes(another, { cursor: page.cursor }), 'invalid_cursor');
  expectCode(() => f.store.changes(f.a, { after: 1 }), 'cursor_limit');
  clock.now += 1000; expectCode(() => f.store.changes(f.a, { cursor: page.cursor }), 'invalid_cursor');
  const restarted = f.store.changes(f.a); assert.notEqual(restarted.cursor, page.cursor);
  assert.equal(restarted.records[0].jwe, live.jwe);
});

test('batch-count bound and forbidden protected headers reject atomically', (t) => {
  const f = fixture(t, { maxChanges: 1 }), one = change(f.a), before = f.store.usage(f.a);
  expectCode(() => f.store.apply(f.a, raw(mutation([one, change(f.a)]))), 'invalid_mutation');
  for (const patch of [{ alg: 'RSA1_5' }, { enc: 'A128GCM' }, { jku: 'https://private.invalid/key' }, { deleted: true }, { rev: 2 }]) {
    const parts = one.jwe.split('.'), header = { ...JSON.parse(Buffer.from(parts[0], 'base64url')), ...patch };
    parts[0] = Buffer.from(JSON.stringify(header)).toString('base64url');
    expectCode(() => f.store.apply(f.a, raw(mutation([{ ...one, jwe: parts.join('.') }]))), 'invalid_jwe_context');
  }
  const parts = one.jwe.split('.');
  parts[0] = Buffer.from(Buffer.from(parts[0], 'base64url').toString().replace('"alg":"dir"', '"alg":"RSA1_5","alg":"dir"')).toString('base64url');
  expectCode(() => f.store.apply(f.a, raw(mutation([{ ...one, jwe: parts.join('.') }]))), 'duplicate_json_key');
  assert.deepEqual(f.store.usage(f.a), before);
});
