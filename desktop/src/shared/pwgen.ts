/**
 * Генератор паролей (PasswordGen.kt, те же правила, что подсказка на сайтах в assets/pwgen):
 * без похожих символов (0/O, 1/l/I), обязательно строчная, заглавная и — по выбору — цифра и знак.
 * Случайность — crypto.getRandomValues (есть и в странице, и в Node для юнит-тестов).
 */
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '-_.!@#%+=?';
export const MIN_LEN = 8;
export const MAX_LEN = 32;

/** Равномерное число 0…n-1 (с отбрасыванием «хвоста», чтобы не было перекоса). */
function rnd(n: number): number {
  const a = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do globalThis.crypto.getRandomValues(a); while (a[0] >= limit);
  return a[0] % n;
}

export function generate(length = 16, digits = true, symbols = true): string {
  const sets = [LOWER, UPPER, ...(digits ? [DIGITS] : []), ...(symbols ? [SYMBOLS] : [])];
  const len = Math.min(MAX_LEN, Math.max(MIN_LEN, Math.trunc(length) || 16));
  const all = sets.join('');
  const out = sets.map((s) => s[rnd(s.length)]);
  while (out.length < len) out.push(all[rnd(all.length)]);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

/** Оценка надёжности: 0 — слабый, 1 — средний, 2 — надёжный, 3 — очень надёжный. */
export function strength(p: string): number {
  const kinds = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{N}]/u].filter((r) => r.test(p)).length;
  const n = [...p].length;
  if (n >= 16 && kinds >= 3) return 3;
  if (n >= 12 && kinds >= 3) return 2;
  if (n >= 8 && kinds >= 2) return 1;
  return 0;
}

export const STRENGTH_KEYS = ['pw_weak', 'pw_ok', 'pw_strong', 'pw_very_strong'];
