import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX = Number.MAX_SAFE_INTEGER;
const RESERVE_PER_ID = 4096;
const VERSION_META = 512, CURRENT_META = 256, RECEIPT_META = 256, VAULT_META = 512, CURSOR_META = 512;
export const SYNC_LIMITS = Object.freeze({
  maxRecords: 4096, maxGlobalRecords: 16384,
  maxMainBytes: 100 * 1024 * 1024, maxGlobalMainBytes: 256 * 1024 * 1024,
  maxReserveBytes: 16 * 1024 * 1024, maxGlobalReserveBytes: 64 * 1024 * 1024,
  maxLiveJweBytes: 256 * 1024, maxTombstoneJweBytes: 2048,
  maxChanges: 100, maxRequestBytes: 1024 * 1024,
  maxPageRecords: 100, maxPageBytes: 1024 * 1024,
  maxCursors: 32, cursorLifetimeMs: 24 * 60 * 60 * 1000,
});
export class SyncStoreError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'SyncStoreError'; this.code = code; this.status = status; }
}
const fail = (code, status = 400) => { throw new SyncStoreError(code, status); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const uuid = (value) => typeof value === 'string' && UUID.test(value);
const bytes = (value) => Buffer.byteLength(value, 'utf8');

// Parse bounded UTF-8 without silently accepting duplicate JSON object keys.
function parseJson(raw) {
  let text, value;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); value = JSON.parse(text); }
  catch { fail('invalid_json'); }
  const objects = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') objects.push(new Set());
    else if (text[i] === '}') objects.pop();
    else if (text[i] === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
      let next = i + 1; while (/\s/.test(text[next] ?? '') && next < text.length) next++;
      if (text[next] === ':') {
        const key = JSON.parse(text.slice(start, i + 1)), keys = objects.at(-1);
        if (!keys || keys.has(key)) fail('duplicate_json_key');
        keys.add(key);
      }
    }
  }
  return value;
}
function segment(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail('invalid_jwe');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) fail('invalid_jwe');
  return decoded;
}
function validateJwe(change, scope, epoch, limits) {
  if (typeof change.jwe !== 'string') fail('invalid_jwe');
  if (bytes(change.jwe) > (change.deleted ? limits.maxTombstoneJweBytes : limits.maxLiveJweBytes)) fail('jwe_too_large', 413);
  const parts = change.jwe.split('.');
  if (parts.length !== 5 || parts[1] !== '') fail('invalid_jwe');
  const protectedBytes = segment(parts[0]);
  if (segment(parts[2]).length !== 12 || segment(parts[4]).length !== 16) fail('invalid_jwe');
  segment(parts[3]);
  const header = parseJson(protectedBytes);
  if (!exact(header, ['alg', 'enc', 'typ', 'osv', 'vault', 'record', 'rev', 'epoch', 'deleted']) ||
      header.alg !== 'dir' || header.enc !== 'A256GCM' || header.typ !== 'os-sync+jwe' || header.osv !== 1 ||
      header.vault !== scope.vaultId || header.record !== change.recordId || header.rev !== change.revision ||
      header.epoch !== epoch || change.epoch !== epoch || header.deleted !== change.deleted) fail('invalid_jwe_context');
  // This is wire/header validation only. The server has no key and does not verify the GCM tag/plaintext.
}

/** Internal transactional storage only. Not an HTTP endpoint or an account/device authenticator. */
export class SyncStore {
  #db; #limits; #authorize; #clock;
  constructor(filename, { limits = {}, authorize = () => false, clock = () => Date.now() } = {}) {
    if (typeof filename !== 'string' || typeof authorize !== 'function' || typeof clock !== 'function') throw new TypeError('Invalid store options');
    for (const [key, value] of Object.entries(limits)) {
      if (!Object.hasOwn(SYNC_LIMITS, key) || !integer(value, 1) || value > SYNC_LIMITS[key]) throw new TypeError('Invalid storage limit');
    }
    this.#limits = { ...SYNC_LIMITS, ...limits }; this.#authorize = authorize; this.#clock = clock;
    if (this.#limits.maxPageBytes < Math.max(this.#limits.maxLiveJweBytes, this.#limits.maxTombstoneJweBytes) + 512) throw new TypeError('Page must fit one complete record');
    this.#db = new DatabaseSync(filename);
    try { if (filename !== ':memory:') chmodSync(filename, 0o600); }
    catch (error) { this.#db.close(); throw error; }
    this.#db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sync_vaults (
        account_id TEXT NOT NULL UNIQUE, vault_id TEXT NOT NULL PRIMARY KEY, epoch INTEGER NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0, main_bytes INTEGER NOT NULL, emergency_bytes INTEGER NOT NULL DEFAULT 0,
        reserved_bytes INTEGER NOT NULL DEFAULT 0, record_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(account_id,vault_id));
      CREATE TABLE IF NOT EXISTS sync_versions (
        account_id TEXT NOT NULL, vault_id TEXT NOT NULL, sequence INTEGER NOT NULL,
        record_id TEXT NOT NULL, revision INTEGER NOT NULL, epoch INTEGER NOT NULL, deleted INTEGER NOT NULL,
        jwe TEXT NOT NULL, PRIMARY KEY(account_id,vault_id,sequence),
        FOREIGN KEY(account_id,vault_id) REFERENCES sync_vaults(account_id,vault_id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS sync_current (
        account_id TEXT NOT NULL, vault_id TEXT NOT NULL, record_id TEXT NOT NULL, sequence INTEGER NOT NULL,
        PRIMARY KEY(account_id,vault_id,record_id),
        FOREIGN KEY(account_id,vault_id,sequence) REFERENCES sync_versions(account_id,vault_id,sequence) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS sync_receipts (
        account_id TEXT NOT NULL, vault_id TEXT NOT NULL, mutation_id TEXT NOT NULL,
        request_hash BLOB NOT NULL, result TEXT NOT NULL,
        PRIMARY KEY(account_id,vault_id,mutation_id),
        FOREIGN KEY(account_id,vault_id) REFERENCES sync_vaults(account_id,vault_id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS sync_cursors (
        token TEXT NOT NULL PRIMARY KEY, account_id TEXT NOT NULL, vault_id TEXT NOT NULL, device_id TEXT NOT NULL,
        start_after INTEGER NOT NULL, upper_sequence INTEGER NOT NULL, expires INTEGER NOT NULL,
        FOREIGN KEY(account_id,vault_id) REFERENCES sync_vaults(account_id,vault_id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS sync_totals (id INTEGER PRIMARY KEY CHECK(id=1), main_bytes INTEGER NOT NULL,
        emergency_bytes INTEGER NOT NULL, reserved_bytes INTEGER NOT NULL, record_count INTEGER NOT NULL);
      INSERT OR IGNORE INTO sync_totals VALUES(1,0,0,0,0);`);
  }
  #scope(input) {
    if (!exact(input, ['accountId', 'vaultId', 'deviceId'])) fail('invalid_scope');
    const snapshot = { ...input };
    if (!Object.values(snapshot).every(uuid)) fail('invalid_scope');
    return Object.freeze(snapshot);
  }
  #tx(input, operation, fn) {
    const scope = this.#scope(input);
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      let allowed;
      try { allowed = this.#authorize(scope, operation); } catch { fail('forbidden', 403); }
      if (allowed !== true) {
        // Never treat an accidentally async hook as an authorization decision.
        if (allowed && typeof allowed.then === 'function') Promise.resolve(allowed).catch(() => {});
        fail('forbidden', 403);
      }
      const value = fn(scope); this.#db.exec('COMMIT'); return value;
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #vault(scope) {
    const value = this.#db.prepare('SELECT * FROM sync_vaults WHERE account_id=? AND vault_id=?').get(scope.accountId, scope.vaultId);
    if (!value) fail('not_found', 404);
    return value;
  }
  #current(scope, recordId) {
    return this.#db.prepare(`SELECT v.* FROM sync_current c JOIN sync_versions v
      ON v.account_id=c.account_id AND v.vault_id=c.vault_id AND v.sequence=c.sequence
      WHERE c.account_id=? AND c.vault_id=? AND c.record_id=?`).get(scope.accountId, scope.vaultId, recordId);
  }
  #now() { const now = this.#clock(); if (!integer(now)) fail('invalid_clock'); return now; }
  createVault(input, { epoch = 1 } = {}) {
    if (!integer(epoch, 1)) fail('invalid_epoch');
    return this.#tx(input, 'provision', (scope) => {
      if (this.#db.prepare('SELECT 1 FROM sync_vaults WHERE account_id=? OR vault_id=?').get(scope.accountId, scope.vaultId)) fail('vault_exists', 409);
      const charge = VAULT_META + CURSOR_META * this.#limits.maxCursors;
      const total = this.#db.prepare('SELECT * FROM sync_totals WHERE id=1').get();
      if (charge > this.#limits.maxMainBytes || total.main_bytes + charge > this.#limits.maxGlobalMainBytes) fail('quota_exceeded', 409);
      this.#db.prepare('INSERT INTO sync_vaults(account_id,vault_id,epoch,main_bytes) VALUES(?,?,?,?)').run(scope.accountId, scope.vaultId, epoch, charge);
      this.#db.prepare('UPDATE sync_totals SET main_bytes=main_bytes+? WHERE id=1').run(charge);
      return { vaultId: scope.vaultId, epoch, sequence: 0 };
    });
  }
  apply(input, requestBytes) {
    if (!(requestBytes instanceof Uint8Array)) fail('raw_bytes_required');
    if (requestBytes.byteLength > this.#limits.maxRequestBytes) fail('request_too_large', 413);
    // Own the immutable request bytes before any caller-supplied authorization hook runs.
    const raw = Buffer.from(requestBytes);
    const body = parseJson(raw);
    if (!body || !uuid(body.mutationId)) fail('invalid_mutation');
    const digest = createHash('sha256').update(raw).digest();
    return this.#tx(input, 'write', (scope) => {
      const vault = this.#vault(scope);
      const receipt = this.#db.prepare('SELECT request_hash,result FROM sync_receipts WHERE account_id=? AND vault_id=? AND mutation_id=?')
        .get(scope.accountId, scope.vaultId, body.mutationId);
      if (receipt) {
        if (!Buffer.from(receipt.request_hash).equals(digest)) fail('mutation_mismatch', 409);
        return { replayed: true, result: JSON.parse(receipt.result) };
      }
      if (!exact(body, ['mutationId', 'preconditions', 'changes']) || !Array.isArray(body.preconditions) ||
          !Array.isArray(body.changes) || !body.changes.length || body.changes.length > this.#limits.maxChanges ||
          body.preconditions.length > this.#limits.maxRecords) fail('invalid_mutation');
      const ids = new Set(), conditions = new Set();
      for (const change of body.changes) {
        if (!exact(change, ['recordId', 'baseRevision', 'revision', 'epoch', 'deleted', 'jwe']) || !uuid(change.recordId) ||
            !integer(change.baseRevision) || !integer(change.revision, 1) || change.revision !== change.baseRevision + 1 ||
            !integer(change.epoch, 1) || typeof change.deleted !== 'boolean' || ids.has(change.recordId)) fail('invalid_change');
        ids.add(change.recordId); validateJwe(change, scope, vault.epoch, this.#limits);
      }
      for (const condition of body.preconditions) {
        if (!exact(condition, ['recordId', 'revision', 'deleted']) || !uuid(condition.recordId) ||
            !integer(condition.revision, 1) || typeof condition.deleted !== 'boolean' ||
            conditions.has(condition.recordId) || ids.has(condition.recordId)) fail('invalid_precondition');
        conditions.add(condition.recordId);
        const current = this.#current(scope, condition.recordId);
        if (!current || current.revision !== condition.revision || Boolean(current.deleted) !== condition.deleted) fail('conflict', 409);
      }
      const previous = body.changes.map((change) => this.#current(scope, change.recordId));
      let added = 0;
      for (let i = 0; i < body.changes.length; i++) {
        const change = body.changes[i], current = previous[i];
        if (!current) { if (change.baseRevision !== 0 || change.deleted) fail('conflict', 409); added++; }
        else if (current.revision !== change.baseRevision || current.deleted) fail('conflict', 409);
      }
      if (vault.sequence > MAX - body.changes.length) fail('sequence_exhausted', 409);
      const result = { sequence: vault.sequence + body.changes.length,
        changes: body.changes.map((change) => ({ recordId: change.recordId, revision: change.revision })) };
      const resultText = JSON.stringify(result);
      const receiptCharge = bytes(resultText) + 32 + 36 + RECEIPT_META;
      const deleteOnly = body.changes.every((change) => change.deleted);
      if (deleteOnly && receiptCharge > 512 * body.changes.length) fail('receipt_too_large', 413);
      const versionsCharge = body.changes.reduce((sum, change) => sum + bytes(change.jwe) + VERSION_META, 0);
      const charge = versionsCharge + added * CURRENT_META + receiptCharge;
      const mainDelta = deleteOnly ? 0 : charge, emergencyDelta = deleteOnly ? charge : 0;
      const reservedDelta = added * RESERVE_PER_ID;
      const total = this.#db.prepare('SELECT * FROM sync_totals WHERE id=1').get();
      if (vault.record_count + added > this.#limits.maxRecords || total.record_count + added > this.#limits.maxGlobalRecords ||
          vault.main_bytes + mainDelta > this.#limits.maxMainBytes || total.main_bytes + mainDelta > this.#limits.maxGlobalMainBytes ||
          vault.reserved_bytes + reservedDelta > this.#limits.maxReserveBytes || total.reserved_bytes + reservedDelta > this.#limits.maxGlobalReserveBytes ||
          vault.emergency_bytes + emergencyDelta > vault.reserved_bytes + reservedDelta ||
          total.emergency_bytes + emergencyDelta > total.reserved_bytes + reservedDelta) fail('quota_exceeded', 409);
      for (let i = 0; i < body.changes.length; i++) {
        const change = body.changes[i], sequence = vault.sequence + i + 1;
        this.#db.prepare('INSERT INTO sync_versions VALUES(?,?,?,?,?,?,?,?)').run(scope.accountId, scope.vaultId,
          sequence, change.recordId, change.revision, change.epoch, Number(change.deleted), change.jwe);
        this.#db.prepare(`INSERT INTO sync_current VALUES(?,?,?,?) ON CONFLICT(account_id,vault_id,record_id)
          DO UPDATE SET sequence=excluded.sequence`).run(scope.accountId, scope.vaultId, change.recordId, sequence);
      }
      this.#db.prepare('INSERT INTO sync_receipts VALUES(?,?,?,?,?)').run(scope.accountId, scope.vaultId, body.mutationId, digest, resultText);
      this.#db.prepare(`UPDATE sync_vaults SET sequence=?,main_bytes=main_bytes+?,emergency_bytes=emergency_bytes+?,
        reserved_bytes=reserved_bytes+?,record_count=record_count+? WHERE account_id=? AND vault_id=?`)
        .run(result.sequence, mainDelta, emergencyDelta, reservedDelta, added, scope.accountId, scope.vaultId);
      this.#db.prepare(`UPDATE sync_totals SET main_bytes=main_bytes+?,emergency_bytes=emergency_bytes+?,
        reserved_bytes=reserved_bytes+?,record_count=record_count+? WHERE id=1`).run(mainDelta, emergencyDelta, reservedDelta, added);
      return { replayed: false, result };
    });
  }
  changes(input, { after = 0, cursor = null, pageSize = this.#limits.maxPageRecords } = {}) {
    if (!integer(after) || !integer(pageSize, 1) || pageSize > this.#limits.maxPageRecords || (cursor !== null && !uuid(cursor))) fail('invalid_cursor');
    return this.#tx(input, 'read', (scope) => {
      const vault = this.#vault(scope), now = this.#now();
      this.#db.prepare('DELETE FROM sync_cursors WHERE expires<=?').run(now);
      let anchor;
      if (cursor) {
        anchor = this.#db.prepare('SELECT * FROM sync_cursors WHERE token=? AND account_id=? AND vault_id=? AND device_id=?')
          .get(cursor, scope.accountId, scope.vaultId, scope.deviceId);
        if (!anchor) fail('invalid_cursor', 409);
      } else {
        if (after > vault.sequence) fail('invalid_cursor');
        // A retry after losing the initial response reuses its existing snapshot boundary.
        anchor = this.#db.prepare(`SELECT * FROM sync_cursors WHERE account_id=? AND vault_id=? AND device_id=?
          AND start_after=? ORDER BY expires DESC LIMIT 1`).get(scope.accountId, scope.vaultId, scope.deviceId, after);
        if (!anchor) {
          const count = this.#db.prepare('SELECT COUNT(*) AS n FROM sync_cursors WHERE account_id=? AND vault_id=?').get(scope.accountId, scope.vaultId).n;
          if (count >= this.#limits.maxCursors) fail('cursor_limit', 409);
          anchor = { token: randomUUID(), upper_sequence: vault.sequence, start_after: after };
          this.#db.prepare('INSERT INTO sync_cursors VALUES(?,?,?,?,?,?,?)').run(anchor.token, scope.accountId, scope.vaultId,
            scope.deviceId, after, anchor.upper_sequence, now + this.#limits.cursorLifetimeMs);
        }
      }
      if (after < anchor.start_after || after > anchor.upper_sequence) fail('invalid_cursor');
      const result = { cursor: anchor.token, upperSequence: anchor.upper_sequence, nextAfter: after, done: after === anchor.upper_sequence, records: [] };
      const rows = this.#db.prepare(`SELECT record_id,revision,epoch,deleted,jwe,sequence FROM sync_versions
        WHERE account_id=? AND vault_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?`)
        .iterate(scope.accountId, scope.vaultId, after, anchor.upper_sequence, pageSize);
      for (const row of rows) {
        const record = { recordId: row.record_id, revision: row.revision, epoch: row.epoch, deleted: Boolean(row.deleted), jwe: row.jwe, sequence: row.sequence };
        const candidate = { ...result, nextAfter: row.sequence, done: row.sequence === anchor.upper_sequence, records: [...result.records, record] };
        if (bytes(JSON.stringify(candidate)) > this.#limits.maxPageBytes) {
          if (!result.records.length) fail('page_too_large', 413);
          break;
        }
        result.records.push(record); result.nextAfter = row.sequence; result.done = row.sequence === anchor.upper_sequence;
      }
      return result;
    });
  }
  closeCursor(input, cursor) {
    if (!uuid(cursor)) fail('invalid_cursor');
    return this.#tx(input, 'read', (scope) => {
      this.#vault(scope);
      this.#db.prepare('DELETE FROM sync_cursors WHERE token=? AND account_id=? AND vault_id=? AND device_id=?')
        .run(cursor, scope.accountId, scope.vaultId, scope.deviceId);
    });
  }
  usage(input) {
    return this.#tx(input, 'read', (scope) => {
      const vault = this.#vault(scope);
      return { sequence: vault.sequence, records: vault.record_count, mainBytes: vault.main_bytes,
        emergencyBytes: vault.emergency_bytes, reservedBytes: vault.reserved_bytes };
    });
  }
  eraseVault(input) {
    return this.#tx(input, 'erase', (scope) => {
      const vault = this.#vault(scope);
      this.#db.prepare('DELETE FROM sync_vaults WHERE account_id=? AND vault_id=?').run(scope.accountId, scope.vaultId);
      this.#db.prepare(`UPDATE sync_totals SET main_bytes=main_bytes-?,emergency_bytes=emergency_bytes-?,
        reserved_bytes=reserved_bytes-?,record_count=record_count-? WHERE id=1`)
        .run(vault.main_bytes, vault.emergency_bytes, vault.reserved_bytes, vault.record_count);
    });
  }
  close() { this.#db.close(); }
}
