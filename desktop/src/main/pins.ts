import { JsonFile } from './store';
import { local, t } from './i18n';
import { START } from './urls';
import type { Pin } from '../shared/types';

/**
 * Закреплённые вкладки (Pins.kt). Общий набор действует для профилей без своего; у профиля может
 * быть свой — первая правка в профиле копирует общий и дальше меняет только копию.
 */
interface PinsData {
  common: Pin[] | null;
  own: Record<string, Pin[]>;
}

export const pinsFile = new JsonFile<PinsData>('pins', () => ({ common: null, own: {} }));

const DEFAULT: Pin[] = [{ id: 'start', title: 'Старт', url: START }];

function raw(profile: number | null): Pin[] {
  const d = pinsFile.get();
  const list = (profile != null ? d.own[profile] : undefined) ?? d.common ?? DEFAULT;
  return list.length ? list : DEFAULT;
}

/** Названия встроенной «Старт» и примеров («@tab_mail») — на языке интерфейса. */
export function all(profile: number | null = null): Pin[] {
  return raw(profile).map((p) => ({ ...p, title: p.url === START ? t('start') : local(p.title) || t('tab_fallback') }));
}

export const hasOwn = (profile: number) => pinsFile.get().own[profile] != null;

export function useCommon(profile: number): void {
  pinsFile.update((d) => { delete d.own[profile]; });
}

export function byId(id: string, profile: number | null): Pin | undefined {
  return all(profile).find((p) => p.id === id);
}

export function save(list: Pin[], profile: number | null): void {
  const clean = list.map((p) => ({ id: p.id, title: p.title, url: p.url }));
  pinsFile.update((d) => {
    if (profile == null) d.common = clean;
    else d.own[profile] = clean;
  });
}

/** Сохраняем «сырые» названия, чтобы ключи примеров не превращались в текст на текущем языке. */
function edit(profile: number | null, fn: (list: Pin[]) => Pin[]): void {
  const next = fn(raw(profile).map((p) => ({ ...p })));
  save(next.length ? next : DEFAULT, profile);
}

export function normalize(url: string): string {
  const s = url.trim();
  if (!s) return START;
  if (s === START || /^https?:\/\//i.test(s)) return s;
  return 'https://' + s;
}

let seq = 0;
export function add(title: string, url: string, profile: number | null): void {
  edit(profile, (l) => [...l, { id: 'p' + Date.now() + (seq++ || ''), title: title.trim() || t('tab_fallback'), url: normalize(url) }]);
}

export function update(id: string, title: string, url: string, profile: number | null): void {
  edit(profile, (l) => l.map((p) => (p.id === id ? { ...p, title: title.trim() || t('tab_fallback'), url: normalize(url) } : p)));
}

export function remove(id: string, profile: number | null): void {
  edit(profile, (l) => l.filter((p) => p.id !== id));
}

export function move(id: string, delta: number, profile: number | null): void {
  edit(profile, (l) => {
    const i = l.findIndex((p) => p.id === id);
    const j = i + delta;
    if (i >= 0 && j >= 0 && j < l.length) l.splice(j, 0, l.splice(i, 1)[0]);
    return l;
  });
}
