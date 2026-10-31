import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  LIMITS, chromeTimeToMs, flattenFolder, isWebUrl, mergeBookmarks, mergeHistory, mergeLogins, loginKey,
  parseBookmarksHtml, parseBookmarksJson, parseCsv, parsePasswordsCsv, readChromeHistory, sqliteAvailable,
} from '../../src/main/chromeparse.ts';
import { makeHistory } from '../fixtures/chrome/make-history.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/chrome');
const fixture = (name) => readFileSync(join(FIX, name), 'utf8');

test('HTML закладок Chrome: папки, сущности, пропуск javascript: и chrome://', () => {
  const r = parseBookmarksHtml(fixture('bookmarks.html'));
  assert.equal(r.bad, 2);
  assert.deepEqual(r.items.map((b) => [b.folder, b.title, b.url]), [
    ['', 'News & Weather', 'https://news.example/'],
    ['', 'Почта', 'https://mail.example/inbox'],
    ['Работа / Проекты', 'Задачи', 'https://tasks.example/board'],
    ['Работа / Проекты', 'Wiki', 'https://wiki.example/'],
    ['Другие закладки', 'Shop', 'https://shop.example/'],
    // Пустое название — адрес; &amp; в адресе раскодирован.
    ['Другие закладки', 'http://old.example/page?a=1&b=2', 'http://old.example/page?a=1&b=2'],
  ]);
  assert.ok(!r.items.some((b) => /^(javascript|chrome):/.test(b.url)));
});

test('HTML: нижний регистр, ссылки вне папок, пустой и чужой файл', () => {
  const r = parseBookmarksHtml('<dl><p><dt><a href=\'https://a.example/\' icon="data:x">A</a><dt><h3>Folder</h3><dl><dt><a href=https://b.example/>B &#x41;</a></dl></dl>');
  assert.deepEqual(r.items.map((b) => [b.folder, b.title]), [['', 'A'], ['Folder', 'B A']]);
  assert.deepEqual(parseBookmarksHtml(''), { items: [], bad: 0 });
  assert.deepEqual(parseBookmarksHtml('\u0000\u0001<<<>>> garbage <a'), { items: [], bad: 0 });
  assert.deepEqual(parseBookmarksHtml('<html><body><p>Hello</p></body></html>').items, []);
});

test('HTML: не больше 20 000 закладок, остальное — неподходящие', () => {
  const html = '<DL>' + Array.from({ length: LIMITS.bookmarks + 5 }, (_, i) => `<DT><A HREF="https://s${i}.example/">${i}</A>`).join('\n') + '</DL>';
  const r = parseBookmarksHtml(html);
  assert.equal(r.items.length, 20000);
  assert.equal(r.bad, 5);
});

test('JSON Bookmarks: панель — корень, «Другие» и «Мобильные» — папки, вложенность', () => {
  const r = parseBookmarksJson(fixture('User Data/Default/Bookmarks'), 'Другие закладки');
  assert.equal(r.bad, 0);
  assert.deepEqual(r.items.map((b) => [b.folder, b.url]), [
    ['', 'https://news.example/'],
    ['Другие закладки / Справка', 'https://docs-json.example/'],
    ['Mobile bookmarks', 'https://mobile-json.example/'],
  ]);
});

test('JSON: битый файл и глубина больше 50 — без исключения', () => {
  assert.deepEqual(parseBookmarksJson('{not json', 'O'), { items: [], bad: 1 });
  assert.deepEqual(parseBookmarksJson('null', 'O'), { items: [], bad: 1 });
  let node = { type: 'url', name: 'deep', url: 'https://deep.example/' };
  for (let i = 0; i < 60; i++) node = { type: 'folder', name: 'f' + i, children: [node] };
  const r = parseBookmarksJson(JSON.stringify({ roots: { bookmark_bar: { type: 'folder', children: [node, { type: 'url', name: 'x', url: 'https://ok.example/' }] } } }), 'O');
  assert.equal(r.bad, 1);
  assert.deepEqual(r.items.map((b) => b.url), ['https://ok.example/']);
  assert.ok(r.items.every((b) => b.folder.length <= 80));
});

test('CSV: кавычки, "" и переводы строк внутри, CRLF и BOM', () => {
  assert.deepEqual(parseCsv('\ufeffa,b\r\n"x,1","y""z\nw"\r\n\r\n'), [['a', 'b'], ['x,1', 'y"z\nw']]);
});

test('CSV паролей Chrome: android:// и пустой пароль пропущены', () => {
  const r = parsePasswordsCsv(fixture('passwords.csv'));
  assert.equal(r.header, true);
  assert.equal(r.bad, 2);
  assert.deepEqual(r.items, [
    { origin: 'https://bank.example', username: 'anna', password: 'New-From-Csv-1' },
    { origin: 'https://mail.example', username: 'bob', password: 'pa,ss"Csv-2' },
  ]);
});

test('CSV: старый формат без note, другой порядок колонок, нет заголовка', () => {
  assert.deepEqual(parsePasswordsCsv('name,url,username,password\nA,http://a.example:8080/x,u,p\n').items, [{ origin: 'http://a.example:8080', username: 'u', password: 'p' }]);
  assert.deepEqual(parsePasswordsCsv('Password,URL\np,https://b.example/\n').items, [{ origin: 'https://b.example', username: '', password: 'p' }]);
  const none = parsePasswordsCsv('https://c.example/,u,p\n');
  assert.equal(none.header, false);
  assert.equal(none.items.length, 0);
});

test('isWebUrl, время Chrome, папки', () => {
  assert.ok(isWebUrl('https://a.example/') && isWebUrl('http://a.example'));
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'file:///c:/x', 'chrome://settings', 'android://h@com.app/', 'nonsense']) assert.ok(!isWebUrl(u), u);
  assert.equal(new Date(chromeTimeToMs(13_350_000_000_000_000)).toISOString(), '2024-01-17T21:20:00.000Z');
  assert.equal(chromeTimeToMs(13_350_000_000_000_000n), chromeTimeToMs(13_350_000_000_000_000));
  assert.equal(chromeTimeToMs(0), 0);
  assert.equal(flattenFolder(['', ' Работа ', 'Проекты']), 'Работа / Проекты');
  assert.equal(flattenFolder(['x'.repeat(100)]).length, 80);
});

test('История из SQLite: только видимые адреса сайтов, новые сверху, лимит', { skip: !sqliteAvailable() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'os-unit-hist-'));
  try {
    const db = join(dir, 'History');
    const now = Date.UTC(2026, 9, 30, 12);
    makeHistory(db, [
      { url: 'https://a.example/', title: 'A', time: now - 3000 },
      { url: 'https://hidden.example/', title: 'H', time: now - 2000, hidden: true },
      { url: 'file:///C:/secret.txt', title: 'F', time: now - 1000 },
      { url: 'https://accounts.google.com/signin', title: 'G', time: now - 500 },
      { url: 'http://b.example/', title: 'B', time: now },
    ]);
    const r = readChromeHistory(db, 1000);
    assert.deepEqual(r.items, [{ u: 'http://b.example/', t: 'B', d: now }, { u: 'https://a.example/', t: 'A', d: now - 3000 }]);
    assert.equal(r.bad, 2);
    assert.equal(readChromeHistory(db, 1).items.length + readChromeHistory(db, 1).bad, 1);
    const junk = join(dir, 'junk');
    writeFileSync(junk, 'not a database at all');
    assert.deepEqual(readChromeHistory(junk, 10), { items: [], bad: 1 });
    assert.deepEqual(readChromeHistory(join(dir, 'missing'), 10), { items: [], bad: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Слияние истории: повтор — 0 добавлено, обрезка до max учитывается', () => {
  const old = [{ u: 'https://x.example/', t: '', d: 500 }];
  const inc = [{ u: 'https://y.example/', t: '', d: 900 }, { u: 'https://x.example/', t: '', d: 100 }, { u: 'https://z.example/', t: '', d: 50 }];
  const r = mergeHistory(old, inc, 2);
  assert.deepEqual(r.list.map((v) => v.u), ['https://y.example/', 'https://x.example/']);
  assert.deepEqual([r.added, r.duplicates, r.dropped], [1, 1, 1]);
  const again = mergeHistory(r.list, inc, 2);
  assert.equal(again.added, 0);
});

test('Слияние паролей: существующая пара «сайт + логин» не перезаписывается', () => {
  const inc = [{ origin: 'https://bank.example', username: 'anna', password: 'NEW' }, { origin: 'https://mail.example', username: 'bob', password: 'p' },
    { origin: 'https://mail.example', username: 'bob', password: 'p2' }];
  const r = mergeLogins(new Set([loginKey('https://bank.example', 'anna')]), inc);
  assert.deepEqual(r.fresh.map((l) => l.origin), ['https://mail.example']);
  assert.equal(r.duplicates, 2);
});

test('Слияние закладок: дубликаты по адресу, папки без учёта регистра', () => {
  const r = mergeBookmarks(['https://a.example/'], ['Работа'], [
    { title: 'A', url: 'https://a.example/', folder: '' },
    { title: 'B', url: 'https://b.example/', folder: 'работа' },
    { title: 'C', url: 'https://c.example/', folder: 'Новая' },
    { title: 'C2', url: 'https://c.example/', folder: 'Новая' },
  ]);
  assert.deepEqual(r.fresh.map((b) => [b.url, b.folder]), [['https://b.example/', 'Работа'], ['https://c.example/', 'Новая']]);
  assert.deepEqual(r.folders, ['Новая']);
  assert.equal(r.duplicates, 2);
});

test('Пароли из профиля Chrome (Login Data) не читаются', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/main/chromeimport.ts'), 'utf8');
  assert.ok(!src.includes('Login Data') && !src.includes('os_crypt'));
});

test('Патологический ввод: 100 тыс. «<a » без «>» разбирается за ~1 с', () => {
  const t0 = Date.now();
  parseBookmarksHtml('<a '.repeat(100000));
  parseBookmarksHtml('<DL><a href="https://x.example/">' + '<b '.repeat(100000));
  assert.ok(Date.now() - t0 < 1500, `слишком долго: ${Date.now() - t0} мс`);
});

test('Адрес длиннее 8 КБ не переносится', () => {
  const long = 'https://x.example/' + 'a'.repeat(8200);
  assert.equal(isWebUrl(long), false);
  assert.equal(isWebUrl('https://x.example/' + 'a'.repeat(100)), true);
  const r = parseBookmarksHtml(`<DL><DT><A HREF="${long}">L</A><DT><A HREF="https://ok.example/">OK</A></DL>`);
  assert.equal(r.items.length, 1);
  assert.equal(r.bad, 1);
  const j = parseBookmarksJson(JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', name: 'L', url: long }] } } }), 'O');
  assert.deepEqual([j.items.length, j.bad], [0, 1]);
});
