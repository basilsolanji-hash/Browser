import { JsonFile } from './store';

/** Статистика для самого пользователя (Stats.kt): только на компьютере, никуда не отправляется. */
const file = new JsonFile<{ since: number; pages: Record<string, number>; trackers: number }>('stats', () => ({ since: 0, pages: {}, trackers: 0 }));

export function get() {
  const d = file.get();
  if (!d.since) file.update((x) => { x.since = Date.now(); });
  return file.get();
}

export function page(profile: number): void {
  get();
  file.update((d) => { d.pages[profile] = (d.pages[profile] ?? 0) + 1; });
}

export function trackers(n: number): void {
  if (n > 0) file.update((d) => { d.trackers += n; });
}

export function reset(): void {
  file.update((d) => { d.since = Date.now(); d.pages = {}; d.trackers = 0; });
}
