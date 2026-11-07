import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes } from 'node:crypto';

import { validateBatch } from './usage-schema.mjs';

const MIN_PARTICIPANTS = 20;
const DAY = 86400000;

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new TypeError('Invalid date');
  }
  return value;
}
/**
 * Only aggregate counts persist. Caller must authenticate and resolve current consent before
 * ingest(): `context` is trusted server state, never taken from the submitted JSON.
 * This module exposes no network endpoint and does not implement authentication itself.
 */
export class AnalyticsStore {
  #db;
  #clock;
  #day = null;
  #salt = null;
  #participants = new Map();
  constructor(filename, { clock = () => Date.now() } = {}) {
    this.#db = new DatabaseSync(filename);
    this.#clock = clock;
    this.#db.exec(`CREATE TABLE IF NOT EXISTS usage_counts (
      day TEXT NOT NULL, platform TEXT NOT NULL, feature TEXT NOT NULL,
      count INTEGER NOT NULL, publishable INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(day, platform, feature))`);
  }
  ingest(batch, context) {
    // Fail closed: a JSON field claiming consent cannot enable collection.
    if (!context || context.consent !== true || context.privateMode !== false ||
        typeof context.accountId !== 'string' || !context.accountId || context.accountId.length > 256) return false;
    validateBatch(batch);
    const now = this.#clock();
    if (!Number.isFinite(now)) throw new TypeError('Invalid clock');
    const today = new Date(now).toISOString().slice(0, 10);
    if (this.#day !== today) {
      this.#day = today;
      this.#salt = randomBytes(32);
      this.#participants.clear();
    }
    const digest = createHmac('sha256', this.#salt).update(context.accountId).digest('hex');
    const cutoff = new Date(now - 29 * DAY).toISOString().slice(0, 10);
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.prepare('DELETE FROM usage_counts WHERE day < ?').run(cutoff);
      const upsert = this.#db.prepare(`INSERT INTO usage_counts(day, platform, feature, count, publishable)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(day, platform, feature) DO UPDATE SET
        count = count + excluded.count, publishable = MAX(publishable, excluded.publishable)
        WHERE count <= 9007199254740991 - excluded.count`);
      for (const event of batch.events) {
        const key = `${batch.platform}:${event.feature}`;
        const members = this.#participants.get(key) ?? new Set();
        if (members.size < MIN_PARTICIPANTS) members.add(digest);
        this.#participants.set(key, members);
        const result = upsert.run(today, batch.platform, event.feature, event.count, Number(members.size >= MIN_PARTICIPANTS));
        if (!result.changes) throw new RangeError('Counter overflow');
      }
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      // Forget transient proof rather than overstate participant counts after a failed batch.
      this.#participants.clear();
      throw error;
    }
    return true;
  }
  summary(since, until) {
    date(since); date(until);
    if (since > until) throw new TypeError('Invalid date range');
    this.purge();
    // Never expose a live day's count: successive 20→21 observations reveal one person's action.
    // Events cannot carry a date; ingest only writes the server's current UTC day.
    const today = new Date(this.#clock()).toISOString().slice(0, 10);
    return this.#db.prepare(`SELECT day, platform, feature, count FROM usage_counts
      WHERE day BETWEEN ? AND ? AND day < ? AND publishable = 1
      ORDER BY day, platform, feature`).all(since, until, today);
  }
  purge() {
    const now = this.#clock();
    if (!Number.isFinite(now)) throw new TypeError('Invalid clock');
    const cutoff = new Date(now - 29 * DAY).toISOString().slice(0, 10);
    this.#db.prepare('DELETE FROM usage_counts WHERE day < ?').run(cutoff);
  }
  close() { this.#db.close(); this.#participants.clear(); this.#salt = null; }
}
