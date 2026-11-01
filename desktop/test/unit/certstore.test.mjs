import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reasonKey, isOverridable, codeFromName, nameFromCode, hostPort, CertExceptions, HstsStore, noteHsts,
  isPreloaded, canProceed, makeToken, PendingErrors, fingerprintHex, decideAct, hstsKnown,
} from '../../src/main/certstore.ts';

test('reasonKey: все коды из таблицы проекта', () => {
  const t = { '-201': 'expired', '-200': 'name', '-206': 'revoked', '-205': 'revcheck', '-204': 'revcheck', '-208': 'weak', '-211': 'weak' };
  for (const [c, k] of Object.entries(t)) assert.equal(reasonKey(Number(c), false), `dt_cert_why_${k}`);
  for (const c of [-213, -214, -215, -212, -210, -203, -207]) assert.equal(reasonKey(c, false), 'dt_cert_why_invalid');
  assert.equal(reasonKey(-202, false), 'dt_cert_why_authority');
  assert.equal(reasonKey(-202, true), 'dt_cert_why_self');
  assert.equal(reasonKey(-299, false), 'dt_cert_why_other');
  assert.equal(reasonKey(-209, false), 'dt_cert_why_other');
});

test('isOverridable и имена кодов', () => {
  assert.ok(isOverridable(-200) && isOverridable(-299));
  assert.ok(!isOverridable(-3) && !isOverridable(-105) && !isOverridable(-300) && !isOverridable(0) && !isOverridable(NaN));
  assert.equal(codeFromName('net::ERR_CERT_DATE_INVALID'), -201);
  assert.equal(codeFromName('ERR_CERT_AUTHORITY_INVALID'), -202);
  assert.equal(codeFromName('net::ERR_NOPE'), null);
  assert.equal(codeFromName('toString'), null);
  assert.equal(nameFromCode(-201), 'ERR_CERT_DATE_INVALID');
  assert.equal(nameFromCode(-250), 'ERR_CERT_-250');
});

test('hostPort: порт по умолчанию, регистр, IDN', () => {
  assert.deepEqual(hostPort('https://Example.COM/x'), { host: 'example.com', port: 443 });
  assert.deepEqual(hostPort('https://127.0.0.1:8443/'), { host: '127.0.0.1', port: 8443 });
  assert.equal(hostPort('os://error/'), null);
  assert.equal(hostPort('мусор'), null);
});

test('CertExceptions: точный хост, порт и отпечаток', () => {
  const e = new CertExceptions();
  e.allow('Example.com', 443, 'sha256/AAA');
  assert.ok(e.has('example.com', 443, 'sha256/AAA'));
  assert.ok(e.has('EXAMPLE.COM', 443, 'sha256/AAA'), 'регистр');
  assert.ok(!e.has('example.com', 8443, 'sha256/AAA'), 'другой порт');
  assert.ok(!e.has('www.example.com', 443, 'sha256/AAA'), 'поддомен');
  assert.ok(!e.has('com', 443, 'sha256/AAA'), 'родительский домен');
  assert.ok(!e.has('example.com', 443, 'sha256/BBB'), 'другой сертификат');
  assert.ok(!e.has('example.com', 443, ''), 'пустой отпечаток');
  e.allow('example.com', 443, '');
  assert.ok(!e.has('example.com', 443, ''));
  e.allow('пример.рф', 443, 'sha256/CCC');
  assert.ok(e.has('xn--e1afmkfd.xn--p1ai', 443, 'sha256/CCC'), 'IDN = punycode');
  e.clear();
  assert.ok(!e.has('example.com', 443, 'sha256/AAA'));
});

test('HSTS: max-age, includeSubDomains, max-age=0 снимает', () => {
  const h = new HstsStore();
  h.note('a.test', 'max-age=31536000');
  assert.ok(h.known('a.test') && !h.known('b.a.test'));
  h.note('a.test', 'max-age=31536000; includeSubDomains');
  assert.ok(h.known('b.a.test') && h.known('c.b.a.test') && !h.known('xa.test'));
  h.note('a.test', 'max-age=0');
  assert.ok(!h.known('a.test') && !h.known('b.a.test'));
  h.note('c.test', 'includeSubDomains');
  assert.ok(!h.known('c.test'), 'без max-age не считается');
  h.note('d.test', 'MAX-AGE="600"; includesubdomains');
  assert.ok(h.known('x.d.test'));
});

test('canProceed: HSTS, preload, не-сертификатные коды', () => {
  assert.ok(canProceed(-202, 'localhost.test'));
  assert.ok(!canProceed(-105, 'localhost.test'));
  assert.ok(!canProceed(-202, 'github.com'));
  assert.ok(!canProceed(-201, 'mail.google.com'));
  assert.ok(!canProceed(-202, 'my.site.dev'));
  assert.ok(isPreloaded('x.app') && !isPreloaded('app') && !isPreloaded('notgoogle.com'));
  noteHsts('hsts-only.test', 'max-age=100');
  assert.ok(!canProceed(-202, 'hsts-only.test'));
  noteHsts('hsts-only.test', 'max-age=0');
  assert.ok(canProceed(-202, 'hsts-only.test'));
});

test('токены: 128 бит, уникальные', () => {
  const a = makeToken();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, makeToken());
});

const sample = (o = {}) => ({
  wcId: 7, sessionKey: 'persist:p1', url: 'https://x.test/', host: 'x.test', port: 443, code: -202, fp: 'sha256/AAA',
  issuer: 'CN=x', subject: 'CN=x', validFrom: 1, validTo: 2, selfSigned: true, canProceed: true, ...o,
});

test('PendingErrors: одноразовость, чужая вкладка и сессия', () => {
  const p = new PendingErrors();
  const t = p.add(sample());
  assert.equal(p.peek(t, 8, 'persist:p1'), null, 'чужая вкладка');
  assert.equal(p.peek(t, 7, 'incognito_1'), null, 'чужая сессия');
  assert.equal(p.take(t, 8, 'persist:p1'), null);
  assert.equal(p.size, 1, 'отказ токен не сжигает');
  assert.ok(p.peek(t, 7, 'persist:p1'));
  assert.ok(p.take(t, 7, 'persist:p1'));
  assert.equal(p.take(t, 7, 'persist:p1'), null, 'второй раз нельзя');
  assert.equal(p.take('0'.repeat(32), 7, 'persist:p1'), null);
});

test('PendingErrors: latestFor и dropTab', () => {
  const p = new PendingErrors();
  p.add(sample());
  const t2 = p.add(sample({ code: -201 }));
  const o = p.add(sample({ wcId: 9 }));
  assert.equal(p.latestFor(7).token, t2);
  p.dropTab(7);
  assert.equal(p.latestFor(7), null);
  assert.ok(p.latestFor(9) && p.size === 1 && p.peek(o, 9, 'persist:p1'));
});

test('fingerprintHex: sha256/base64 → AB:CD', () => {
  const b = Buffer.alloc(32, 0xab).toString('base64');
  const hex = fingerprintHex(`sha256/${b}`);
  assert.equal(hex.length, 32 * 3 - 1);
  assert.match(hex, /^(AB:){31}AB$/);
  assert.equal(fingerprintHex('weird'), 'weird');
});

test('PendingErrors.forSession: страница видна только в своей сессии', () => {
  const p = new PendingErrors();
  const t = p.add(sample());
  assert.ok(p.forSession(t, 'persist:p1'));
  assert.equal(p.forSession(t, 'incognito_1'), null);
  assert.equal(p.forSession('nope', 'persist:p1'), null);
});

test('decideAct: действия страницы ошибки и все отказы', () => {
  const mk = (over = {}) => {
    const p = new PendingErrors();
    const tok = p.add({ wcId: 7, sessionKey: 's1', url: 'https://a.test:8443/x', host: 'a.test', port: 8443, code: -202, fp: 'sha256/AA', issuer: 'i', subject: 's', validFrom: 0, validTo: 1, selfSigned: false, canProceed: true, ...over });
    return { p, tok };
  };
  const act = (tok, a) => `os://error/act?t=${tok}&a=${a}`;
  const page = 'os://error/?cert=x';
  // не наш адрес — вызывающий пропускает его в guard
  const { p, tok } = mk();
  assert.equal(decideAct(p, 'https://a.test/', page, 7, 's1').kind, 'none');
  assert.equal(decideAct(p, 'os://start', page, 7, 's1').kind, 'none');
  assert.equal(decideAct(p, 'os://error/actx?t=1', page, 7, 's1').kind, 'none');
  // со страницы сайта (текущий адрес не страница ошибки) — игнор, токен цел
  assert.equal(decideAct(p, act(tok, 'proceed'), 'https://evil.test/', 7, 's1').kind, 'ignore');
  assert.equal(decideAct(p, act(tok, 'proceed'), 'os://start', 7, 's1').kind, 'ignore');
  assert.equal(decideAct(p, act(tok, 'proceed'), 'os://errorx/', 7, 's1').kind, 'ignore');
  // чужая вкладка / чужая сессия / подбор / мусор — игнор, токен цел
  assert.equal(decideAct(p, act(tok, 'proceed'), page, 8, 's1').kind, 'ignore');
  assert.equal(decideAct(p, act(tok, 'proceed'), page, 7, 's2').kind, 'ignore');
  assert.equal(decideAct(p, act('0'.repeat(32), 'proceed'), page, 7, 's1').kind, 'ignore');
  assert.equal(decideAct(p, act(tok, 'delete'), page, 7, 's1').kind, 'ignore');
  assert.equal(decideAct(p, 'os://error/act', page, 7, 's1').kind, 'ignore');
  assert.equal(p.size, 1);
  // успех и одноразовость
  const d = decideAct(p, act(tok, 'proceed'), page, 7, 's1');
  assert.equal(d.kind, 'proceed');
  assert.equal(d.info.host, 'a.test');
  assert.equal(d.info.port, 8443);
  assert.equal(decideAct(p, act(tok, 'proceed'), page, 7, 's1').kind, 'ignore');
  // «Назад» тоже одноразово
  const b = mk();
  assert.equal(decideAct(b.p, act(b.tok, 'back'), page, 7, 's1').kind, 'back');
  assert.equal(decideAct(b.p, act(b.tok, 'back'), page, 7, 's1').kind, 'ignore');
});

test('decideAct: «Перейти» при canProceed=false отклоняется на действии, «Назад» работает', () => {
  const p = new PendingErrors();
  const tok = p.add({ wcId: 1, sessionKey: 's', url: 'https://hsts.test/', host: 'hsts.test', port: 443, code: -201, fp: 'f', issuer: '', subject: '', validFrom: 0, validTo: 0, selfSigned: false, canProceed: false });
  const page = 'os://error/?cert=x';
  assert.equal(decideAct(p, `os://error/act?t=${tok}&a=proceed`, page, 1, 's').kind, 'ignore');
  assert.equal(p.size, 1);
  assert.equal(decideAct(p, `os://error/act?t=${tok}&a=back`, page, 1, 's').kind, 'back');
});

test('decideAct: canProceed пересчитывается в момент действия (HSTS появился после показа страницы)', () => {
  const p = new PendingErrors();
  const tok = p.add({ wcId: 1, sessionKey: 's', url: 'https://late-hsts.test/', host: 'late-hsts.test', port: 443, code: -202, fp: 'f', issuer: '', subject: '', validFrom: 0, validTo: 0, selfSigned: true, canProceed: true });
  noteHsts('late-hsts.test', 'max-age=1000');
  assert.equal(decideAct(p, `os://error/act?t=${tok}&a=proceed`, 'os://error/?cert=x', 1, 's').kind, 'ignore');
  noteHsts('late-hsts.test', 'max-age=0');
  assert.equal(decideAct(p, `os://error/act?t=${tok}&a=proceed`, 'os://error/?cert=x', 1, 's').kind, 'proceed');
});

test('HSTS: лимит с вытеснением старых, срок, запись на диск и загрузка', () => {
  const h = new HstsStore(3);
  let changes = 0;
  h.onChange = () => changes++;
  const now = 1_000_000;
  for (const n of ['a', 'b', 'c']) h.note(`${n}.test`, 'max-age=100', now);
  h.note('a.test', 'max-age=100', now); // повторно: уходит в конец, на диск не пишем
  assert.equal(changes, 3);
  h.note('d.test', 'max-age=100', now);
  assert.equal(h.size, 3);
  assert.ok(!h.known('b.test', now + 1) && h.known('a.test', now + 1) && h.known('d.test', now + 1), 'вытеснен самый давний — b');
  assert.ok(!h.known('a.test', now + 101_000), 'срок max-age вышел');
  const copy = new HstsStore(3);
  copy.load(JSON.parse(JSON.stringify(h.dump())));
  assert.deepEqual(copy.dump(), h.dump());
  copy.load([['x.test', 1, now + 5000], 'мусор', ['', 1, 1], ['y.test', 1, 'нет'], null]);
  assert.equal(copy.size, 1);
  assert.ok(copy.known('sub.x.test', now) && !copy.known('x.test.evil', now));
  h.clear();
  assert.equal(h.size, 0);
  const big = new HstsStore(2);
  big.load([['1.test', 0, now + 9], ['2.test', 0, now + 9], ['3.test', 0, now + 9]]);
  assert.ok(big.size === 2 && !big.known('1.test', now));
});

test('HSTS: инкогнито отдельно (в память), общий вердикт hstsKnown', () => {
  noteHsts('inc-only.test', 'max-age=100', true);
  assert.ok(hstsKnown('inc-only.test') && !canProceed(-202, 'inc-only.test'));
  noteHsts('inc-only.test', 'max-age=0', true);
  assert.ok(!hstsKnown('inc-only.test'));
});

test('CertExceptions.hasHostPort: только точный хост и порт', () => {
  const e = new CertExceptions();
  e.allow('Example.com', 8443, 'sha256/A');
  assert.ok(e.hasHostPort('example.com', 8443));
  assert.ok(!e.hasHostPort('example.com', 443) && !e.hasHostPort('a.example.com', 8443) && !e.hasHostPort('127.0.0.1', 8443));
});
