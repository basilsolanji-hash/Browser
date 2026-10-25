import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveMime, etaParts, formatSize, kindOf, matchesDownload, viewableInOs } from '../../src/shared/filetype.ts';

test('type by extension when the server says octet-stream', () => {
  assert.equal(effectiveMime('application/octet-stream', 'report.PDF'), 'application/pdf');
  assert.equal(effectiveMime('', 'photo.jpeg'), 'image/jpeg');
  assert.equal(effectiveMime(undefined, 'noext'), 'application/octet-stream');
  assert.equal(effectiveMime('text/plain; charset=utf-8', 'x.bin'), 'text/plain');
  assert.equal(effectiveMime('image/png', 'wrong.txt'), 'image/png');
});

test('kind chips', () => {
  assert.equal(kindOf('application/octet-stream', 'a.png'), 'images');
  assert.equal(kindOf('', 'song.mp3'), 'audio');
  assert.equal(kindOf('video/mp4', 'x'), 'video');
  assert.equal(kindOf('', 'contract.docx'), 'docs');
  assert.equal(kindOf('application/pdf', 'x'), 'docs');
  assert.equal(kindOf('text/plain', 'x'), 'docs');
  assert.equal(kindOf('', 'table.xlsx'), 'docs');
  assert.equal(kindOf('application/octet-stream', 'setup.exe'), 'other');
  assert.equal(kindOf('application/zip', 'a.zip'), 'other');
});

test('opens inside the browser: pdf, images, text — not html', () => {
  assert.ok(viewableInOs('application/pdf'));
  assert.ok(viewableInOs('image/png'));
  assert.ok(viewableInOs('text/plain'));
  assert.ok(!viewableInOs('text/html'));
  assert.ok(!viewableInOs('application/zip'));
  assert.ok(!viewableInOs('video/mp4'));
});

test('filter and search', () => {
  const d = { name: 'Договор №7.pdf', mime: 'application/octet-stream' };
  assert.ok(matchesDownload(d, 'all', ''));
  assert.ok(matchesDownload(d, 'docs', 'договор'));
  assert.ok(matchesDownload(d, 'docs', '  ДОГОВОР '));
  assert.ok(!matchesDownload(d, 'images', ''));
  assert.ok(!matchesDownload(d, 'all', 'счёт'));
});

test('sizes and remaining time', () => {
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(1536), '1.5 KB');
  assert.equal(formatSize(5 * 1048576, 'ru'), '5 MB');
  assert.equal(formatSize(1.25 * 1048576, 'ru'), '1,3 MB');
  assert.deepEqual(etaParts(14.2), { unit: 'sec', value: 14 });
  assert.deepEqual(etaParts(61), { unit: 'min', value: 2 });
  assert.deepEqual(etaParts(0.2), { unit: 'sec', value: 1 });
  assert.equal(etaParts(null), null);
  assert.equal(etaParts(-1), null);
  assert.equal(etaParts(Infinity), null);
});
