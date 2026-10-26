import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDLE_MS, askBeforeLeave, noteContentType, noteRequest, repostFor, toPostData, forget } from '../../src/main/unload.ts';

test('beforeunload: ask only after recent work with the page', () => {
  const now = 10 * IDLE_MS;
  assert.equal(askBeforeLeave(0, now), false, 'never touched');
  assert.equal(askBeforeLeave(now - 1000, now), true);
  assert.equal(askBeforeLeave(now - IDLE_MS, now), true);
  assert.equal(askBeforeLeave(now - IDLE_MS - 1, now), false, 'idle more than 3 minutes');
});

test('repost: remembers the last form POST of the tab, forgets on any other navigation', () => {
  const body = Buffer.from('a=1&b=2');
  noteRequest(7, 'POST', 'https://shop.test/pay', [{ bytes: body }]);
  noteContentType(7, 'https://shop.test/pay', { 'Content-Type': 'application/x-www-form-urlencoded' });
  const r = repostFor(7, 'https://shop.test/pay');
  assert.deepEqual(r, { postData: [{ type: 'rawData', bytes: body }], extraHeaders: 'Content-Type: application/x-www-form-urlencoded' });
  assert.equal(repostFor(7, 'https://shop.test/other'), null, 'another page is shown');
  assert.equal(repostFor(8, 'https://shop.test/pay'), null, 'another tab');
  noteRequest(7, 'GET', 'https://shop.test/pay', undefined);
  assert.equal(repostFor(7, 'https://shop.test/pay'), null, 'reloaded as GET');
  noteRequest(7, 'POST', 'https://shop.test/pay', [{ bytes: body }]);
  forget(7);
  assert.equal(repostFor(7, 'https://shop.test/pay'), null, 'tab closed');
  noteRequest(undefined, 'POST', 'https://x.test/', [{ bytes: body }]);
});

test('repost: files are sent again, blobs cannot be', () => {
  assert.deepEqual(toPostData([{ bytes: Buffer.from('x') }, { bytes: undefined, file: 'C:\\a.txt' }]),
    [{ type: 'rawData', bytes: Buffer.from('x') }, { type: 'file', filePath: 'C:\\a.txt' }]);
  assert.equal(toPostData([{ bytes: undefined, blobUUID: 'b' }]), null);
  assert.equal(toPostData([]), null);
});
