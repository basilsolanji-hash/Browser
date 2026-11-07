import { FEATURES, validateBatch } from './usage-schema.mjs';

/** Client-side policy. Transport must only send drain() output; consent defaults off. */
export class UsageQueue {
  #enabled = false;
  #private = false;
  #counts = new Map();
  constructor(platform) {
    if (!['android', 'windows'].includes(platform)) throw new TypeError('Invalid platform');
    this.platform = platform;
  }
  setConsent(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid consent');
    this.#enabled = enabled;
    if (!enabled) this.#counts.clear();
  }
  setPrivateMode(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid private mode');
    this.#private = enabled;
    // Do not carry regular activity into a private browsing request either.
    if (enabled) this.#counts.clear();
  }
  record(feature) {
    if (!this.#enabled || this.#private) return false;
    if (!FEATURES.includes(feature)) throw new TypeError('Unknown feature');
    const total = [...this.#counts.values()].reduce((a, b) => a + b, 0);
    if (total >= 1000) return false;
    this.#counts.set(feature, (this.#counts.get(feature) ?? 0) + 1);
    return true;
  }
  drain() {
    if (!this.#enabled || this.#private || !this.#counts.size) return null;
    const batch = { platform: this.platform, events: [...this.#counts].map(([feature, count]) => ({ feature, count })) };
    this.#counts.clear();
    return validateBatch(batch);
  }
}

