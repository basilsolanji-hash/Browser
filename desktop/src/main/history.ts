import { JsonFile } from './store';
import * as Stats from './stats';
import { mergeHistory } from './chromeparse';

/** История посещений, отдельная для каждого профиля (History.kt). Инкогнито сюда не пишет. */
export interface Visit { u: string; t: string; d: number }

const MAX = 1000;
export const historyFile = new JsonFile<{ h: Record<string, Visit[]> }>('history', () => ({ h: {} }));

export const list = (profile: number): Visit[] => historyFile.get().h[profile] ?? [];

export function add(profile: number, url: string): void {
  if (!/^https?:/.test(url) || url.includes('accounts.google.com')) return;
  const items = list(profile);
  if (items[0]?.u === url) return;
  historyFile.update((d) => { d.h[profile] = [{ u: url, t: '', d: Date.now() }, ...items].slice(0, MAX); });
  Stats.page(profile);
}

/** Перенос из Chrome: без адресов, которые уже есть; итог — последние MAX по времени. Stats не меняется. */
export function importMany(profile: number, visits: Visit[]): { added: number; duplicates: number; dropped: number } {
  const r = mergeHistory(list(profile), visits, MAX);
  if (r.added) historyFile.update((d) => { d.h[profile] = r.list; });
  return { added: r.added, duplicates: r.duplicates, dropped: r.dropped };
}

/** Удалить одну запись (по адресу и времени). */
export function remove(profile: number, url: string, time: number): void {
  historyFile.update((d) => { d.h[profile] = list(profile).filter((v) => !(v.u === url && v.d === time)); });
}

export function setTitle(profile: number, url: string, title: string): void {
  const first = list(profile)[0];
  if (!first || first.u !== url || first.t === title) return;
  historyFile.update(() => { first.t = title; });
}

/** Удалить записи начиная с [since] (мс); 0 — всю историю профиля. */
export function clearSince(profile: number, since: number): void {
  if (since <= 0) clear(profile);
  else historyFile.update((d) => { d.h[profile] = list(profile).filter((v) => v.d < since); });
}

export function clear(profile: number): void {
  historyFile.update((d) => { delete d.h[profile]; });
}

export function clearAll(): void {
  historyFile.update((d) => { d.h = {}; });
}
