import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('admin nginx logging policy covers vhost failures, slash redirect and proxy route', () => {
  const conf = readFileSync(new URL('../deploy/nginx-admin.conf', import.meta.url), 'utf8');
  const header = conf.replace(/^#.*$/gm, '').split(/\nlocation /)[0];
  assert.match(header, /access_log off;/);
  assert.match(header, /error_log \/dev\/null;/);
  for (const marker of ['location = /admin {', 'location /admin/ {']) {
    const block = conf.split(marker)[1].split('}')[0];
    assert.match(block, /access_log off;/); assert.match(block, /error_log \/dev\/null;/);
  }
});
