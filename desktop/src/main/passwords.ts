import { safeStorage } from 'electron';
import { JsonFile } from './store';
import { registerPasswords } from './clearhooks';
import { type Login, hostOf, sameSite, upsert as upsertIn } from './backupcrypto';

/**
 * Пароли (Passwords.kt) — свои у каждого профиля, только на этом компьютере. Пароль шифруется ключом ОС
 * (safeStorage: DPAPI в Windows) и лежит в JSON как base64; открытым текстом он не хранится нигде.
 * Логин и сайт не шифруются — их показывает список кабинета.
 */
interface Stored { g: string; o: string; u: string; p: string; t: number }
interface Data {
  offer: boolean;
  profiles: Record<string, Stored[]>;
  /** Сайты «Никогда для этого сайта» по профилям. */
  never: Record<string, string[]>;
}

const file = new JsonFile<Data>('passwords', () => ({ offer: true, profiles: {}, never: {} }));

/** Логин без пароля — для списков в интерфейсе. */
export type LoginInfo = Omit<Login, 'p'>;

let checked = false;
export function available(): boolean {
  // Приёмка на Linux без связки ключей: встроенный ключ Chromium (basic_text). В Windows всегда DPAPI.
  if (!checked && process.platform === 'linux' && process.env.OS_TEST === '1' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    safeStorage.setUsePlainTextEncryption(true);
  }
  checked = true;
  return safeStorage.isEncryptionAvailable();
}

function seal(password: string): string {
  if (!available()) throw new Error('encryption unavailable');
  return safeStorage.encryptString(password).toString('base64');
}

function open(stored: string): string | null {
  if (!available()) return null;
  try { return safeStorage.decryptString(Buffer.from(stored, 'base64')); } catch { return null; }
}

const raw = (profile: number): Stored[] => file.get().profiles[profile] ?? [];

/** Список без паролей (расшифровка не нужна). */
export const infos = (profile: number): LoginInfo[] =>
  raw(profile).map(({ g, o, u, t }) => ({ g, o, u, t })).sort((a, b) => hostOf(a.o).localeCompare(hostOf(b.o)) || a.u.localeCompare(b.u));

/** Все входы профиля с расшифрованными паролями (для копии и подстановки). Нерасшифрованные пропускаются. */
export function list(profile: number): Login[] {
  const out: Login[] = [];
  for (const s of raw(profile)) {
    const p = open(s.p);
    if (p != null) out.push({ ...s, p });
  }
  return out;
}

export function password(profile: number, guid: string): string | null {
  const s = raw(profile).find((x) => x.g === guid);
  return s ? open(s.p) : null;
}

/** Добавить или обновить по сайту и логину (или по guid). false — сайт не распознан или нет шифрования. */
export function upsert(profile: number, origin: string, username: string, pass: string, guid: string | null = null): boolean {
  if (!available() || !pass) return false;
  // Шифруется только новый пароль: остальные записи не трогаем.
  const next = upsertIn(raw(profile), origin, username, seal(pass), guid);
  if (!next) return false;
  file.update((d) => { d.profiles[profile] = next; });
  return true;
}

export function remove(profile: number, guid: string): void {
  file.update((d) => { d.profiles[profile] = raw(profile).filter((x) => x.g !== guid); });
}

// «Удалить данные о работе в браузере» (§14): пароли, сохранённые за выбранный период (t — время сохранения).
registerPasswords({
  count: (profile, since) => raw(profile).filter((x) => x.t >= since).length,
  removeSince: (profile, since) => file.update((d) => { d.profiles[profile] = raw(profile).filter((x) => x.t < since); }),
});

/** Входы профиля для сайта: тот же хост, поддомен или родительский домен. */
export const forDomain = (profile: number, domain: string): Login[] => list(profile).filter((l) => sameSite(l.o, domain));

export const never = (profile: number): string[] => [...(file.get().never[profile] ?? [])].sort();

export function setNever(profile: number, host: string, on: boolean): void {
  const h = host.toLowerCase().trim();
  if (!h) return;
  file.update((d) => {
    const set = new Set(d.never[profile] ?? []);
    if (on) set.add(h);
    else set.delete(h);
    d.never[profile] = [...set];
  });
}

/** Предлагать сохранять пароли (по умолчанию да) — общая настройка, как в Android. */
export const offer = () => file.get().offer !== false;
export function setOffer(on: boolean): void {
  file.update((d) => { d.offer = on; });
}

/** Выход из аккаунтов профиля не стирает пароли (как в Android): они в кабинете, удаляются там. */
export const count = (profile: number) => raw(profile).length;
