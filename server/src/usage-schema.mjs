// An internal schema, never arbitrary event names/properties or personal content.
export const FEATURES = Object.freeze([
  'profile_switch', 'quick_search', 'notes_open', 'notes_create',
  'favorites_add', 'password_save', 'download_start', 'sync_manual',
]);
const platforms = new Set(['android', 'windows']);
const allowed = new Set(FEATURES);
const MAX_COUNT = 1000;
const MAX_EVENTS = FEATURES.length;

function exact(object, keys) {
  return object && typeof object === 'object' && !Array.isArray(object) &&
    Object.keys(object).length === keys.length && keys.every((k) => Object.hasOwn(object, k));
}
export function validateBatch(batch) {
  if (!exact(batch, ['platform', 'events']) || !platforms.has(batch.platform) ||
      !Array.isArray(batch.events) || !batch.events.length || batch.events.length > MAX_EVENTS) {
    throw new TypeError('Invalid aggregate batch');
  }
  const seen = new Set();
  let total = 0;
  for (const event of batch.events) {
    if (!exact(event, ['feature', 'count']) || !allowed.has(event.feature) ||
        !Number.isSafeInteger(event.count) || event.count < 1 || event.count > MAX_COUNT || seen.has(event.feature)) {
      throw new TypeError('Invalid aggregate event');
    }
    total += event.count;
    seen.add(event.feature);
  }
  if (total > MAX_COUNT) throw new TypeError('Batch too large');
  return batch;
}

