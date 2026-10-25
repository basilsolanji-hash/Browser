import { JsonFile } from './store';
import { t } from './i18n';
import * as Tabs from './tabs';
import type { TabSet } from './backupcrypto';

/** Наборы вкладок (TabSets в Backup.kt): сохранить открытые вкладки профиля и потом открыть их снова. */
const file = new JsonFile<{ profiles: Record<string, TabSet[]> }>('tab_sets', () => ({ profiles: {} }));

export const list = (profile: number): TabSet[] => file.get().profiles[profile] ?? [];

/** Вкладки, которые попадут в набор: только сайты, без стартовых страниц os://. */
export const openWeb = (profile: number) => Tabs.list(profile).filter((x) => /^https?:\/\//.test(x.url));

let seq = 0;

/** Открытые вкладки → новый набор (в начало списка); null — сохранять нечего. */
export function saveOpen(profile: number, name: string): TabSet | null {
  const tabs = openWeb(profile).map((x) => ({ title: x.title, url: x.url }));
  if (!tabs.length) return null;
  const set: TabSet = { id: `set${Date.now()}${++seq}`, n: name.trim().slice(0, 100) || t('tab_sets'), t: Date.now(), tabs };
  file.update((d) => { d.profiles[profile] = [set, ...list(profile)]; });
  return set;
}

export function add(profile: number, set: TabSet): void {
  if (list(profile).some((x) => x.id === set.id)) return;
  file.update((d) => { d.profiles[profile] = [...list(profile), set]; });
}

export function remove(profile: number, id: string): void {
  file.update((d) => { d.profiles[profile] = list(profile).filter((x) => x.id !== id); });
}

/** Открыть набор: вкладки добавляются к открытым; возвращает id первой. */
export function restore(profile: number, id: string): string | null {
  const set = list(profile).find((x) => x.id === id);
  if (!set) return null;
  const ids = set.tabs.filter((x) => /^https?:\/\//.test(x.url)).map((x) => Tabs.add(profile, x.url).id);
  return ids[0] ?? null;
}
