import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideDisplay } from '../../src/main/displayrule.ts';

const ok = { host: 'meet.example', securityOrigin: 'https://meet.example', hasWindow: true, locked: false, mode: 'ASK', videoRequested: true };

test('ask by default', () => assert.equal(decideDisplay(ok), 'ask'));
test('blocked site: hint and deny', () => assert.equal(decideDisplay({ ...ok, mode: 'BLOCK' }), 'blocked'));
test('ALLOW is never silent: still ask', () => assert.equal(decideDisplay({ ...ok, mode: 'ALLOW' }), 'ask'));
test('PIN lock, no window, no host, audio only: deny', () => {
  assert.equal(decideDisplay({ ...ok, locked: true }), 'deny');
  assert.equal(decideDisplay({ ...ok, hasWindow: false }), 'deny');
  assert.equal(decideDisplay({ ...ok, host: '' }), 'deny');
  assert.equal(decideDisplay({ ...ok, videoRequested: false }), 'deny');
});
test('own pages and non-http origins: deny', () => {
  assert.equal(decideDisplay({ ...ok, securityOrigin: 'os://settings' }), 'deny');
  assert.equal(decideDisplay({ ...ok, securityOrigin: 'file://' }), 'deny');
});
