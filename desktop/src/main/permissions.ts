import { JsonFile } from './store';

/**
 * Разрешения сайтов (SitePermissions.kt): решения хранятся только на компьютере — по сайту и профилю.
 * По умолчанию безопасно: без явного «Разрешить» сайт ничего не получает (закрытый запрос = запрет).
 * В инкогнито решения не записываются на диск.
 */
export type Mode = 'ASK' | 'ALLOW' | 'BLOCK';
export interface Kind { key: string; titleKey: string; askKey: string; defaults: Mode[]; initial: Mode }

export const KINDS: Kind[] = [
  { key: 'location', titleKey: 'perm_location', askKey: 'perm_q_location', defaults: ['ASK', 'BLOCK'], initial: 'ASK' },
  { key: 'camera', titleKey: 'perm_camera', askKey: 'perm_q_camera', defaults: ['ASK', 'BLOCK'], initial: 'ASK' },
  { key: 'microphone', titleKey: 'perm_microphone', askKey: 'perm_q_microphone', defaults: ['ASK', 'BLOCK'], initial: 'ASK' },
  { key: 'notifications', titleKey: 'perm_notifications', askKey: 'perm_q_notifications', defaults: ['ASK', 'BLOCK'], initial: 'ASK' },
  { key: 'clipboard', titleKey: 'dt_perm_clipboard', askKey: 'dt_perm_q_clipboard', defaults: ['ASK', 'BLOCK'], initial: 'ASK' },
  // Скачивание — спросить перед сохранением файла; выбор файла для отправки — само системное окно и есть
  // согласие, поэтому по умолчанию разрешено (можно запретить или спрашивать) — как в Android.
  { key: 'downloads', titleKey: 'perm_downloads', askKey: 'perm_q_downloads', defaults: ['ASK', 'ALLOW', 'BLOCK'], initial: 'ASK' },
  { key: 'uploads', titleKey: 'perm_uploads', askKey: 'perm_q_uploads', defaults: ['ALLOW', 'ASK', 'BLOCK'], initial: 'ALLOW' },
];
/** Чувствительные — для «Проверки безопасности». */
export const SENSITIVE = ['location', 'camera', 'microphone', 'notifications'];

interface Data {
  /** profile → host → kind → решение */
  sites: Record<string, Record<string, Record<string, Mode>>>;
  defaults: Record<string, Mode>;
}
const file = new JsonFile<Data>('site_permissions', () => ({ sites: {}, defaults: {} }));

export const kind = (key: string) => KINDS.find((k) => k.key === key);

export function get(profile: number, host: string, key: string): Mode | undefined {
  return file.get().sites[profile]?.[host]?.[key];
}

/** Запомнить решение (null — забыть; ASK забывается, если и по умолчанию «спросить»). */
export function set(profile: number, host: string, key: string, mode: Mode | null): void {
  if (!kind(key) || !host) return;
  const fallback = defaultMode(key);
  file.update((d) => {
    const p = (d.sites[profile] ??= {});
    const h = (p[host] ??= {});
    if (!mode || (mode === 'ASK' && fallback === 'ASK')) delete h[key];
    else h[key] = mode;
    if (!Object.keys(h).length) delete p[host];
  });
}

export function defaultMode(key: string): Mode {
  const k = kind(key);
  const m = file.get().defaults[key];
  return k && m && k.defaults.includes(m) ? m : (k?.initial ?? 'ASK');
}

export function setDefault(key: string, mode: Mode): void {
  const k = kind(key);
  if (k?.defaults.includes(mode)) file.update((d) => { d.defaults[key] = mode; });
}

/** Итоговое решение для сайта: сохранённое или значение по умолчанию. */
export const effective = (profile: number, host: string, key: string): Mode => get(profile, host, key) ?? defaultMode(key);

export function sites(profile: number): Record<string, Record<string, Mode>> {
  return file.get().sites[profile] ?? {};
}

export function clearSite(profile: number, host: string): void {
  file.update((d) => { delete d.sites[profile]?.[host]; });
}

export function clearProfile(profile: number): void {
  file.update((d) => { delete d.sites[profile]; });
}

/** Сколько выдано чувствительных разрешений и скольким сайтам (по всем профилям). */
export function granted(): { count: number; sites: number } {
  let count = 0;
  let n = 0;
  for (const p of Object.values(file.get().sites)) {
    for (const m of Object.values(p)) {
      const c = Object.entries(m).filter(([k, v]) => SENSITIVE.includes(k) && v === 'ALLOW').length;
      count += c;
      if (c) n++;
    }
  }
  return { count, sites: n };
}
