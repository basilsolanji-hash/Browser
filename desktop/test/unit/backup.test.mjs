import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decrypt, encrypt, isAll, merge, originOf, sameSite, upsert } from '../../src/main/backupcrypto.ts';

// Образец собран по алгоритму Backup.encrypt Android (javax.crypto: PBKDF2WithHmacSHA256, 120000,
// AES/GCM/NoPadding) с фиксированными солью и IV; пароль копии — «пароль-копии 7».
const ANDROID = '{"app":"os-browser","v":1,"salt":"AQgPFh0kKzI5QEdOVVxjag==","iv":"yMXCv7y5trOwraqn","data":"JUGeljemUGbtrpwUYY/hlGukYGY5IumpZ/YnFkY1f6ggIp9PE0+a1dmku1gaQl+J+GPMAgG8p91JGE/gmRmmGU8C3epPrS4+6e2vHRsNWT+rwIzDuAjg1D38DFMhaejm7/2mCKR+7v4M7LOtuvO+jQEPc4JP9yBNZjSNezKjjoTpKZGd4I6ZZAVkgG/QmBxl5U0RItvMFn30tQIS6S21Apn5ULYyALEx3ly67nroEr4Mx+bRkUBr2rcxLurXHthAjGZhoc4tMktXDcIJAk4Dq4YDbJUQpZUpePOjV5BQFSGrvC8tXrMAO1t68grbvd9Hyp88Pwxsks22RmNyQBklV7ZW+UlDXcdIS/7BoipRlP9fu7J/Dp+cMhtnrthsCpEQH+Kt65hawoWTFQNQeM0FR3Ap3+6evSRmT8iKXQ//1EN9AlQq3S9B7wLJ/mdWcMSgdaMBMMYSjEE6i1YPjhhlik2C/KXj/O3eZ1/Rh8xh0RLbC3sHUTYO6QUfJvRmrgasPYOe2E8Noi1nn6MQWobzSLcouey01sa3WzyMYeWFvLYUnzhW097Fc3apW0yJIMVkBQKokJ+hOu9pYQtmNdo="}';

const sample = () => ({
  v: 1, name: 'Работа', desc: 'Счета',
  passwords: [{ g: 'os-1', o: 'https://bank.example', u: 'anna', p: 's3cret', t: 1 }],
  tabSets: [{ id: 'set1', n: 'Утро', t: 2, tabs: [{ title: 'News', url: 'https://news.example/' }] }],
  favorites: [{ title: 'Docs', url: 'https://docs.example/', folder: '' }],
  notes: [{ text: 'Позвонить Ивану', url: 'https://crm.example/' }],
});

test('backup: encrypt → decrypt round trip, no plain text inside', () => {
  const file = encrypt(sample(), 'correct horse');
  const o = JSON.parse(file);
  assert.deepEqual(Object.keys(o), ['app', 'v', 'salt', 'iv', 'data']);
  assert.equal(o.app, 'os-browser');
  assert.equal(o.v, 1);
  assert.equal(Buffer.from(o.salt, 'base64').length, 16);
  assert.equal(Buffer.from(o.iv, 'base64').length, 12);
  assert.ok(!file.includes('s3cret') && !file.includes('anna'));
  assert.deepEqual(decrypt(file, 'correct horse'), sample());
  // Соль и IV случайные: две копии одного и того же различаются.
  assert.notEqual(encrypt(sample(), 'correct horse'), file);
});

test('backup: wrong password or damaged file is rejected', () => {
  const file = encrypt(sample(), 'correct horse');
  assert.equal(decrypt(file, 'wrong password'), null);
  assert.equal(decrypt('{}', 'x'), null);
  assert.equal(decrypt('not json', 'x'), null);
  const o = JSON.parse(file);
  const data = Buffer.from(o.data, 'base64');
  data[3] ^= 1;
  assert.equal(decrypt(JSON.stringify({ ...o, data: data.toString('base64') }), 'correct horse'), null);
});

test('backup: file made by the Android algorithm opens here', () => {
  const d = decrypt(ANDROID, 'пароль-копии 7');
  assert.ok(d);
  assert.equal(d.name, 'Работа');
  assert.equal(d.desc, 'Счета и почта');
  assert.deepEqual(d.passwords, [{ g: 'os-1', o: 'https://bank.example', u: 'anna', p: 's3cret-Ж', t: 1700000000000 }]);
  assert.equal(d.tabSets[0].n, 'Утро');
  assert.deepEqual(d.tabSets[0].tabs, [{ title: 'News', url: 'https://news.example/' }]);
  assert.deepEqual(d.favorites, [{ title: 'Docs', url: 'https://docs.example/', folder: '' }]);
  assert.deepEqual(d.notes, [{ text: 'Позвонить Ивану', url: 'https://crm.example/' }]);
  assert.equal(decrypt(ANDROID, 'пароль-копии 8'), null);
});

test('backup: our file decrypts with the same parameters (salt + iv + PBKDF2 120000)', () => {
  const salt = Buffer.from('AQgPFh0kKzI5QEdOVVxjag==', 'base64');
  const iv = Buffer.from('yMXCv7y5trOwraqn', 'base64');
  // Тот же JSON, что в образце Android (порядок полей как в Backup.collect) → тот же шифротекст.
  const data = {
    v: 1, name: 'Работа', desc: 'Счета и почта',
    passwords: [{ g: 'os-1', o: 'https://bank.example', u: 'anna', p: 's3cret-Ж', t: 1700000000000 }],
    tabSets: [{ id: 'set1', n: 'Утро', t: 1700000000001, tabs: [{ title: 'News', url: 'https://news.example/' }] }],
    favorites: [{ title: 'Docs', url: 'https://docs.example/', folder: '' }],
    notes: [{ text: 'Позвонить Ивану', url: 'https://crm.example/' }],
  };
  assert.equal(encrypt(data, 'пароль-копии 7', salt, iv), ANDROID);
});

test('restore: adds only what is missing, no duplicates', () => {
  const data = sample();
  data.passwords.push({ g: 'x', o: 'https://shop.example/cart', u: 'bob', p: 'p2', t: 3 });
  const cur = {
    name: '', desc: 'своё описание',
    logins: [{ g: 'a', o: 'https://bank.example', u: 'anna', p: 's3cret', t: 0 }],
    tabSets: [],
    favoriteUrls: ['https://docs.example/'],
    notes: [{ text: 'Позвонить Ивану', url: 'https://crm.example/' }],
  };
  const r = merge(cur, data);
  assert.equal(r.name, 'Работа');
  assert.equal(r.desc, null, 'своё описание не заменяется');
  assert.deepEqual(r.logins.map((l) => l.o + ' ' + l.u), ['https://shop.example bob']);
  assert.equal(r.tabSets.length, 1);
  assert.deepEqual(r.favorites, []);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.counts, { passwords: 1, tabSets: 1, favorites: 0, notes: 0 });
  // Повторное восстановление того же файла ничего не добавляет.
  const again = merge({ ...cur, name: 'Работа', logins: [...cur.logins, ...r.logins], tabSets: r.tabSets }, data);
  assert.deepEqual(again.counts, { passwords: 0, tabSets: 0, favorites: 0, notes: 0 });
  // Другой пароль того же сайта и логина — обновление.
  data.passwords[0].p = 'new';
  assert.equal(merge(cur, data).counts.passwords, 2);
});

// Копия всех профилей (Backup.collectAll, v2), собранная тем же алгоритмом Android; пароль «пароль-копии 7».
const ANDROID_ALL = '{"app":"os-browser","v":1,"salt":"AQgPFh0kKzI5QEdOVVxjag==","iv":"yMXCv7y5trOwraqn","data":"JUGeljelUGbzvZ4XKtmmN+lOi82qmzNa3xe7Fg52b6xxe8ZXR70BNXJWYOj1982TCgt3Aga9ntxzGEbgkBmmGVsG3foa+H54tu3lJxNcSXLjhpCSr2K52nixFEtscrGjvaK+SKkmrfgTtqam4bHhgEpIJ8FXpXYKJXbBbzK1joH6MZ/Mo8/RIwF4ctXQwBwr9gp9OcmIRy+X4EZR+yfeIuj3FKMlDZA93krr9hvIbftKi7OHh1Y90c5AcfnZX9j5S5XZQmLf6AgPTpQRQ11CuYwCcIdO9Mh8avitpUThx4I4VsqH/hfZbRs9tFWKkJgKm588Pwl/jZz7C3liR0tsNuJb8A4ODIZeHq2O/mRbmecAjrtWUs7AfEJq8tRgDo9CSdz05c5GlNPUQgtQEIAWFmgnjanO/SQoT5rMVCKgzBgzBGgs2nIGrTj5oilVPpDjJawaOdFVxDhdhVYcvEAilwDMwou8u+vYYvuqOvMy0+lSMp/VN2HJmA=="}';

test('backup v2: all profiles in one file, Android-compatible', () => {
  const d = decrypt(ANDROID_ALL, 'пароль-копии 7');
  assert.ok(isAll(d));
  assert.deepEqual(d.profiles.map((p) => [p.id, p.data.name, p.data.passwords[0].p]), [[1, 'Личный', 'p1'], [2, 'Работа', 'p2']]);
  // Свой файл v2: те же поля, что у Android; v1 не путается с v2.
  const all = { v: 2, profiles: [{ id: 1, data: sample() }, { id: 3, data: { ...sample(), name: 'Третий' } }] };
  const file = encrypt(all, 'secret-1');
  const back = decrypt(file, 'secret-1');
  assert.ok(isAll(back));
  assert.deepEqual(back, all);
  assert.ok(!isAll(decrypt(encrypt(sample(), 'secret-1'), 'secret-1')));
  assert.equal(decrypt(file, 'secret-2'), null);
  // Битые записи профилей отбрасываются, остальные остаются.
  const odd = decrypt(encrypt({ v: 2, profiles: [{ id: 'x', data: {} }, { id: 2, data: sample() }, { id: 4 }] }, 'secret-1'), 'secret-1');
  assert.deepEqual(odd.profiles.map((p) => p.id), [2]);
});

test('passwords: origin, subdomains, update by site and login', () => {
  assert.equal(originOf('https://Example.com/path?q=1'), 'https://example.com');
  assert.equal(originOf('http://example.com:8080/x'), 'http://example.com:8080');
  assert.equal(originOf('not a url'), null);
  assert.ok(sameSite('https://accounts.example.com', 'example.com'));
  assert.ok(sameSite('https://example.com', 'accounts.example.com'));
  assert.ok(sameSite('https://www.example.com', 'example.com'));
  assert.ok(!sameSite('https://example.com', 'badexample.com'));
  assert.ok(!sameSite('https://other.org', 'example.com'));
  let list = upsert([], 'https://a.example.com', 'anna', 'old');
  list = upsert(list, 'https://a.example.com/other', 'anna', 'new');
  list = upsert(list, 'https://a.example.com', 'boris', 'x');
  assert.equal(list.length, 2);
  assert.equal(list.find((l) => l.u === 'anna').p, 'new');
  const g = list[0].g;
  list = upsert(list, 'https://b.example.com', 'anna2', 'z', g);
  assert.equal(list.length, 2);
  assert.equal(list.find((l) => l.g === g).o, 'https://b.example.com');
});
