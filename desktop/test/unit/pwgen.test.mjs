import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, strength, MIN_LEN, MAX_LEN } from '../../src/shared/pwgen.ts';

const SIMILAR = /[0O1lI]/;

test('generator: length 8–32, required kinds, no look-alike characters', () => {
  for (let len = MIN_LEN; len <= MAX_LEN; len++) {
    for (let i = 0; i < 20; i++) {
      const p = generate(len);
      assert.equal(p.length, len);
      assert.ok(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[2-9]/.test(p) && /[-_.!@#%+=?]/.test(p), p);
      assert.ok(!SIMILAR.test(p), p);
    }
  }
  assert.equal(generate(4).length, MIN_LEN);
  assert.equal(generate(100).length, MAX_LEN);
});

test('generator: digits and symbols can be turned off', () => {
  for (let i = 0; i < 50; i++) {
    const p = generate(16, false, false);
    assert.match(p, /^[a-zA-Z]{16}$/);
    assert.ok(!SIMILAR.test(p));
    assert.match(generate(12, true, false), /^[a-zA-Z2-9]{12}$/);
    assert.match(generate(12, false, true), /^[a-zA-Z\-_.!@#%+=?]{12}$/);
  }
});

test('generator: passwords differ', () => {
  const seen = new Set(Array.from({ length: 200 }, () => generate(16)));
  assert.equal(seen.size, 200);
});

test('strength: weak / fair / strong / very strong (as PasswordGen.strength)', () => {
  assert.equal(strength('abc'), 0);
  assert.equal(strength('abcdefgh'), 0);
  assert.equal(strength('abcdefg1'), 1);
  assert.equal(strength('Abcdefghij12'), 2);
  assert.equal(strength('Abcdefghijklmn12'), 3);
  assert.equal(strength('пароль-Пароль-12'), 3);
  assert.equal(strength(generate(16)), 3);
  assert.equal(strength(generate(8)), 1);
});

test('backup password: at least 10 chars, not only digits, not a common one', async () => {
  const { backupPasswordOk } = await import('../../src/shared/pwgen.ts');
  for (const p of ['abcdef', 'abcdefghi', '1234567890123', 'aaaaaaaaaaaa', 'Password1', 'qwertyuiop', 'ababababab']) assert.equal(backupPasswordOk(p), false, p);
  for (const p of ['Sunny-Harbor-42', 'correct horse battery', 'Мой пароль копии', 'tea4two-cups']) assert.equal(backupPasswordOk(p), true, p);
});
