import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistedTabs } from '../../src/main/tabstorage.ts';
const tab = (id, url) => ({ id, url, title: 'page', group: 'g' });
test('live sign-in tabs remain intact; disk snapshot cannot restore them, including closed and pinned tabs', () => {
 const data = { lastProfile: 1, profiles: { '1': { active: 'tab1', groups: [{ id: 'g', title: 'Work' }],
   tabs: [tab('tab1', 'https://idmsa.apple.com/appleauth/auth'), tab('tab2', 'https://example.org/news')],
   closed: [tab('tab3', 'https://example.org/verify?code=secret')],
   pinState: { start: { url: 'https://example.org/login', title: 'Sign in' }, news: { url: 'https://example.org/news', title: 'News' } },
 } } };
 const original = JSON.parse(JSON.stringify(data)), disk = persistedTabs(data);
 assert.deepEqual(data, original, 'saving never mutates the live form or code');
 assert.equal(disk.profiles['1'].tabs[0].url, 'os://start/');
 assert.equal(disk.profiles['1'].closed[0].url, 'os://start/');
 assert.equal(disk.profiles['1'].tabs[0].title, '');
 assert.equal(disk.profiles['1'].tabs[1].url, 'https://example.org/news');
 assert.deepEqual(disk.profiles['1'].pinState, { news: { url: 'https://example.org/news', title: 'News' } });
 assert.deepEqual(disk.profiles['1'].groups, data.profiles['1'].groups);
 assert.deepEqual(persistedTabs(disk), disk, 'legacy migration is idempotent');
});
test('snapshots omit the whole sign-in address for all auth patterns and profiles', () => {
 const urls = ['https://accounts.google.com/challenge', 'https://login.microsoftonline.com/', 'https://x.org/2fa', 'https://x.org/mfa', 'https://x.org/OAuth', 'https://x.org/two-factor', 'https://x.org/?display=popup'];
 const data = { lastProfile: 2, profiles: Object.fromEntries([1, 2].map((id) => [id, { tabs: urls.map((u, i) => tab(`tab${i}`, u)), closed: [], groups: [], active: 'tab0', pinState: {} }])) };
 const saved = persistedTabs(data);
 for (const p of Object.values(saved.profiles)) assert.ok(p.tabs.every((t) => t.url === 'os://start/'));
 assert.equal(saved.lastProfile, 2);
});
