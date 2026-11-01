import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { certHtml, CERT_CSP } from '../../src/main/certpage.ts';

const P = { dark: false, bg: '#fff', surface: '#eee', border: '#ccc', text: '#111', muted: '#555', accent: '#06c', onAccent: '#fff' };
const info = (o = {}) => ({
  wcId: 1, sessionKey: 's1', url: 'https://example.test:8443/a?b=1', host: 'example.test', port: 8443, code: -202,
  fp: 'sha256/' + Buffer.alloc(32, 0xab).toString('base64'), issuer: 'CN=Issuer', subject: 'CN=Subj', validFrom: 1700000000, validTo: 1800000000,
  selfSigned: false, canProceed: true, ...o,
});
// настоящие английские строки из src/i18n/en.json (их собирает npm run i18n из TrDesktop.kt)
const EN = JSON.parse(readFileSync(new URL('../../src/i18n/en.json', import.meta.url), 'utf8'));
const tr = (k, ...a) => { let i = 0; return (EN[k] ?? k).replace(/%s/g, () => String(a[i++] ?? '')); };

test('страница без скриптов, с ссылками назад/перейти и деталями', () => {
  const h = certHtml(P, info(), 'TOK123', tr, false);
  assert.ok(!/<script|\son\w+=/i.test(h));
  assert.match(h, /href="os:\/\/error\/act\?t=TOK123&amp;a=back"/);
  assert.match(h, /href="os:\/\/error\/act\?t=TOK123&amp;a=proceed"/);
  assert.match(h, /<details>/);
  assert.match(h, /AB:AB:AB/);
  assert.match(h, /ERR_CERT_AUTHORITY_INVALID/);
  assert.match(h, /dir="ltr"/);
  assert.match(CERT_CSP, /frame-ancestors 'none'/);
  assert.ok(!/script-src/.test(CERT_CSP) && /default-src 'none'/.test(CERT_CSP));
});

test('«Перейти» нет для HSTS/закреплённых, действие не выдаётся', () => {
  const h = certHtml(P, info({ canProceed: false }), 'TOK', tr, false);
  assert.ok(!h.includes('a=proceed'));
  assert.match(h, /can&#39;t be bypassed/);
  assert.match(h, /a=back/);
});

test('экранирование сертификата и адреса', () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const h = certHtml(P, info({ issuer: evil, subject: evil + '‮', host: evil, url: 'https://x.test/?q=' + evil }), 'T"><b>', tr, false);
  assert.ok(!h.includes('<img'));
  assert.ok(!h.includes('T"><b>'));
  assert.ok(!h.includes('‮'));
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('длинные поля обрезаются, битый адрес не роняет страницу', () => {
  const h = certHtml(P, info({ issuer: 'A'.repeat(5000), url: 'не адрес' }), 'T', tr, false);
  assert.ok(h.length < 8000);
  assert.ok(h.includes('не адрес'));
});

test('причины: самоподписанный, срок (подсказка про часы), RTL, переводы', () => {
  assert.match(certHtml(P, info({ selfSigned: true }), 'T', tr, false), /self-signed/);
  const exp = certHtml(P, info({ code: -201 }), 'T', tr, true);
  assert.match(exp, /expired/);
  assert.match(exp, /date and time on your computer/);
  assert.match(exp, /dir="rtl"/);
  assert.ok(!certHtml(P, info({ code: -200 }), 'T', tr, false).includes('date and time'));
  const ru = certHtml(P, info(), 'T', (k) => (k === 'dt_cert_title' ? 'Подключение не защищено' : k), false);
  assert.match(ru, /<h1>Подключение не защищено<\/h1>/);
});

test('тёмная тема: красный акцент светлее', () => {
  assert.match(certHtml({ ...P, dark: true }, info(), 'T', tr, false), /#ff8a80/);
  assert.match(certHtml(P, info(), 'T', tr, false), /#b3261e/);
});
