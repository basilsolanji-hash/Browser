/**
 * Точка подключения паролей к «Удалить данные о работе в браузере» (§14). Хранилище паролей
 * (src/main/passwords.ts) делает отдельная сессия: оно вызывает registerPasswords(...) при запуске.
 * Пока не подключено — карточка «Пароли» показывает 0 и ничего не удаляет.
 */
export interface PasswordStore {
  /** Сколько паролей профиля сохранено начиная с [since] (мс; 0 — все). */
  count(profile: number, since: number): number;
  /** Удалить пароли профиля, сохранённые начиная с [since] (0 — все). */
  removeSince(profile: number, since: number): void | Promise<void>;
}

let store: PasswordStore | null = null;

export function registerPasswords(s: PasswordStore): void {
  store = s;
}

export const passwordsReady = () => store != null;

export function passwordCount(profile: number, since: number): number {
  try {
    return store?.count(profile, since) ?? 0;
  } catch {
    return 0;
  }
}

export async function removePasswords(profile: number, since: number): Promise<void> {
  await store?.removeSince(profile, since);
}
