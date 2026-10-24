import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { settings } from './settings';

/**
 * Блокировка приложения (AppLock.kt): PIN, хранится только хеш scrypt с солью.
 * Windows Hello не подключён: надёжного модуля без нативной сборки нет — только PIN.
 */
const MIN = 4;
let failures = 0;
let lockedUntil = 0;

export const enabled = () => !!settings.get().lock;

export function setPin(pin: string): boolean {
  if (!/^\d{4,12}$/.test(pin)) return false;
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pin, salt, 32).toString('hex');
  settings.update((d) => { d.lock = { salt, hash }; });
  return true;
}

export function removePin(): void {
  settings.update((d) => { d.lock = null; });
}

/** Проверка PIN. После 5 ошибок подряд — пауза 30 секунд (защита от перебора). */
export function check(pin: string): 'ok' | 'wrong' | 'wait' {
  const l = settings.get().lock;
  if (!l) return 'ok';
  if (Date.now() < lockedUntil) return 'wait';
  if (pin.length < MIN) return 'wrong';
  const got = scryptSync(pin, l.salt, 32);
  if (timingSafeEqual(got, Buffer.from(l.hash, 'hex'))) {
    failures = 0;
    return 'ok';
  }
  if (++failures >= 5) {
    failures = 0;
    lockedUntil = Date.now() + 30_000;
  }
  return 'wrong';
}
