import { JsonFile } from './store';

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
}

export function setTitle(profile: number, url: string, title: string): void {
  const first = list(profile)[0];
  if (!first || first.u !== url || first.t === title) return;
  historyFile.update(() => { first.t = title; });
}

export function clear(profile: number): void {
  historyFile.update((d) => { delete d.h[profile]; });
}

export function clearAll(): void {
  historyFile.update((d) => { d.h = {}; });
}
