import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITERATIONS, decrypt, encrypt, isAll, iterationsOf, merge, originOf, sameSite, upsert } from '../../src/main/backupcrypto.ts';

// Образец собран по алгоритму Backup.encrypt Android (javax.crypto: PBKDF2WithHmacSHA256, 120000,
// AES/GCM/NoPadding) с фиксированными солью и IV; пароль копии — «пароль-копии 7».
const ANDROID = '{"app":"os-browser","v":1,"salt":"AQgPFh0kKzI5QEdOVVxjag==","iv":"yMXCv7y5trOwraqn","data":"JUGeljemUGbtrpwUYY/hlGukYGY5IumpZ/YnFkY1f6ggIp9PE0+a1dmku1gaQl+J+GPMAgG8p91JGE/gmRmmGU8C3epPrS4+6e2vHRsNWT+rwIzDuAjg1D38DFMhaejm7/2mCKR+7v4M7LOtuvO+jQEPc4JP9yBNZjSNezKjjoTpKZGd4I6ZZAVkgG/QmBxl5U0RItvMFn30tQIS6S21Apn5ULYyALEx3ly67nroEr4Mx+bRkUBr2rcxLurXHthAjGZhoc4tMktXDcIJAk4Dq4YDbJUQpZUpePOjV5BQFSGrvC8tXrMAO1t68grbvd9Hyp88Pwxsks22RmNyQBklV7ZW+UlDXcdIS/7BoipRlP9fu7J/Dp+cMhtnrthsCpEQH+Kt65hawoWTFQNQeM0FR3Ap3+6evSRmT8iKXQ//1EN9AlQq3S9B7wLJ/mdWcMSgdaMBMMYSjEE6i1YPjhhlik2C/KXj/O3eZ1/Rh8xh0RLbC3sHUTYO6QUfJvRmrgasPYOe2E8Noi1nn6MQWobzSLcouey01sa3WzyMYeWFvLYUnzhW097Fc3apW0yJIMVkBQKokJ+hOu9pYQtmNdo="}';

// Тот же образец в формате v2 (PBKDF2 600000) — эталон для Android: Backup.encrypt с той же солью и IV
// должен дать ровно эту строку.
const V2 = '{"app":"os-browser","v":2,"iter":600000,"salt":"AQgPFh0kKzI5QEdOVVxjag==","iv":"yMXCv7y5trOwraqn","data":"DpCFBvxKL5/K+KrJzGdXVW/zQdw3q5h+jnNo8MdK38T+L6AMhFW1n4HIqcPF/QWX177XWTj47jfqy2JJ1FlooxMC1IKDNNWlz1rJGaF6plYYKeTbj4mdyZZkLHmnoczjaMrE4Sa81EcH7MPVYrYEMlRjOPtlL0bXWwp1CHGvu9vERQKSOUXaSAvk7jEaiBFgiz/qWxuBzVJMQ8N65e54OIGc2XILMKXop4XprhoUKn/Twj2yp0qhNLCXsBIU1+8iWYKsLfoEfZP21dFtPFlWUOPVmBHdjGiur4E4LM4qrZsChdfQ3GhqdwdNFG+N7Y8eOZGw1ZJirIlKofL1BVZJh22xUQXjHdwxoH6RiyiCf3ZVARZ3HOO5BNwxlnPcXhYE2t/CwsUzebZ7OB6KxFW6Lkg2YuO7qCfklZXnNWjpl1lwbaGsl+LmvMx6XfbSV4qJqpQiL99o7DT7/K1yEMNwm7Yo0X0t7I1VkVxtNIo9MIUF3O8t78GfuQEk0uC9kywwr9QJyUGphK4a6pmbeMdW169SayPybFDv8LoAhlXZWyR6zwmWZ8z3ZVWeW5/cWPpmqk7h/ynOt5TqZi+937A="}';

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
  assert.deepEqual(Object.keys(o), ['app', 'v', 'iter', 'salt', 'iv', 'data']);
  assert.equal(o.app, 'os-browser');
  assert.equal(o.v, 2);
  assert.equal(o.iter, 600_000);
  assert.equal(ITERATIONS, 600_000);
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

test('backup: v2 file with fixed salt + iv matches the reference (PBKDF2 600000)', () => {
  const salt = Buffer.from('AQgPFh0kKzI5QEdOVVxjag==', 'base64');
  const iv = Buffer.from('yMXCv7y5trOwraqn', 'base64');
  // Тот же JSON, что в образце Android (порядок полей как в Backup.collect).
  const data = {
    v: 1, name: 'Работа', desc: 'Счета и почта',
    passwords: [{ g: 'os-1', o: 'https://bank.example', u: 'anna', p: 's3cret-Ж', t: 1700000000000 }],
    tabSets: [{ id: 'set1', n: 'Утро', t: 1700000000001, tabs: [{ title: 'News', url: 'https://news.example/' }] }],
    favorites: [{ title: 'Docs', url: 'https://docs.example/', folder: '' }],
    notes: [{ text: 'Позвонить Ивану', url: 'https://crm.example/' }],
  };
  assert.equal(encrypt(data, 'пароль-копии 7', salt, iv), V2);
  assert.deepEqual(decrypt(V2, 'пароль-копии 7'), decrypt(ANDROID, 'пароль-копии 7'));
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

test('backup: version and iterations in the header; old v1 copies still open', () => {
  assert.equal(iterationsOf({ v: 1 }), 120_000);
  assert.equal(iterationsOf({ v: 2, iter: 600_000 }), 600_000);
  assert.equal(iterationsOf({ v: 2 }), null, 'v2 without iter');
  assert.equal(iterationsOf({ v: 2, iter: 1000 }), null, 'too weak');
  assert.equal(iterationsOf({ v: 2, iter: 1e9 }), null, 'would hang');
  assert.equal(iterationsOf({ v: 3, iter: 600_000 }), null, 'unknown version');
  const o = JSON.parse(encrypt(sample(), 'pw-123456'));
  assert.equal(decrypt(JSON.stringify({ ...o, iter: 300_000 }), 'pw-123456'), null, 'iter is bound to the key');
  assert.equal(decrypt(JSON.stringify({ ...o, v: 1, iter: undefined }), 'pw-123456'), null, 'v2 file read as v1');
});
