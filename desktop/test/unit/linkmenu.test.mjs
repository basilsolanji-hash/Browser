import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkMenu, linkTarget, mediaKeys } from '../../src/main/linkmenu.ts';

const normal = { incognito: false, otherProfiles: true };

test('link: open, copy, download, favorite, share (Chrome order)', () => {
  const t = linkTarget({ linkURL: 'https://news.test/a', linkText: '  Big\n news ', srcURL: '', mediaType: 'none' });
  assert.deepEqual(t, { link: 'https://news.test/a', text: 'Big news', media: null, type: null });
  assert.deepEqual(linkMenu(t, normal), [
    ['open_new_tab', 'open_in_group', 'open_incognito', 'open_in_profile'],
    ['copy_link', 'copy_link_text', 'download_link', 'favorite', 'share_link'],
  ]);
  assert.deepEqual(linkMenu(t, { incognito: false, otherProfiles: false })[0], ['open_new_tab', 'open_in_group', 'open_incognito'], 'one profile — no profile item');
});

test('incognito: just "Open", copy and download — no profiles, groups or favorites', () => {
  const t = linkTarget({ linkURL: 'https://news.test/a', linkText: 'A' });
  assert.deepEqual(linkMenu(t, { incognito: true, otherProfiles: true }), [['open'], ['copy_link', 'copy_link_text', 'download_link', 'share_link']]);
});

test('mailto: and tel: — only copy and share; javascript:, data: and blob: — no menu', () => {
  assert.deepEqual(linkMenu(linkTarget({ linkURL: 'mailto:a@b.test', linkText: '' }), normal), [['copy_link', 'share_link']]);
  assert.deepEqual(linkMenu(linkTarget({ linkURL: 'tel:+100' }), normal), [['copy_link', 'share_link']]);
  assert.equal(linkTarget({ linkURL: 'javascript:void(0)', linkText: 'x' }), null);
  assert.equal(linkTarget({ srcURL: 'data:image/png;base64,AAA', mediaType: 'image' }), null);
  assert.equal(linkTarget({ srcURL: 'blob:https://x.test/1', mediaType: 'video' }), null);
});

test('image, video, audio; a linked image has both groups', () => {
  assert.deepEqual(linkMenu(linkTarget({ srcURL: 'https://x.test/p.jpg', mediaType: 'image' }), normal), [['open_media', 'download_media', 'copy_media', 'share_image']]);
  assert.deepEqual(linkMenu(linkTarget({ srcURL: 'https://x.test/v.mp4', mediaType: 'video' }), normal), [['open_media', 'download_media', 'copy_media']]);
  assert.equal(linkMenu(linkTarget({ linkURL: 'https://x.test/', srcURL: 'https://x.test/p.jpg', mediaType: 'image' }), normal).length, 3);
  assert.deepEqual(mediaKeys('audio'), { open: 'ctx_open_audio', download: 'ctx_download_audio', copy: 'ctx_copy_audio' });
});
