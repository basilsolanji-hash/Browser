import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneIdentifier } from '../../src/shared/motw.ts';

test('zone identifier with referrer and host', () => {
  assert.equal(
    zoneIdentifier({ referrer: 'https://a.ru/page', host: 'https://a.ru/f.exe' }),
    '[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://a.ru/page\r\nHostUrl=https://a.ru/f.exe\r\n',
  );
});

test('incognito: only ZoneId', () => {
  assert.equal(zoneIdentifier({ referrer: 'https://a.ru/', host: 'https://a.ru/f', incognito: true }), '[ZoneTransfer]\r\nZoneId=3\r\n');
});

test('data/blob/file and newline addresses are skipped', () => {
  assert.equal(zoneIdentifier({ referrer: 'blob:https://a.ru/x', host: 'data:text/plain,hi' }), '[ZoneTransfer]\r\nZoneId=3\r\n');
  assert.equal(zoneIdentifier({ referrer: 'file:///c:/x', host: 'https://a.ru/\r\nZoneId=0' }), '[ZoneTransfer]\r\nZoneId=3\r\n');
  assert.equal(zoneIdentifier({}), '[ZoneTransfer]\r\nZoneId=3\r\n');
});
