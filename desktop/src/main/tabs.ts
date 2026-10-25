import { JsonFile } from './store';
import { t } from './i18n';
import { START, host } from './urls';
import type { TabGroup } from '../shared/types';

/**
 * Открытые вкладки и группы — свои у каждого профиля (как Tabs.kt). Хранятся локально, чтобы
 * перезапуск восстанавливал вкладки. Закреплённые вкладки здесь хранят только последний адрес.
 */
export interface OpenTab { id: string; title: string; url: string; group: string | null }

interface ProfileTabs {
  tabs: OpenTab[];
  groups: TabGroup[];
  active: string | null;
  closed: OpenTab[];
  pinState: Record<string, { url: string; title: string }>;
}

interface TabsData {
  profiles: Record<string, ProfileTabs>;
  lastProfile: number | null;
}

export const tabsFile = new JsonFile<TabsData>('tabs', () => ({ profiles: {}, lastProfile: null }));

export const GROUP_COLORS = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#00ACC1', '#1E88E5', '#8E24AA', '#757575'];
const MAX_CLOSED = 25;

export const isTab = (id: string | null | undefined) => !!id && id.startsWith('tab');

let last = 0;
function newId(prefix: string): string {
  const now = Date.now();
  last = now > last ? now : last + 1;
  return prefix + last;
}

function of(profile: number): ProfileTabs {
  const d = tabsFile.get();
  const p = d.profiles[profile];
  if (p) return p;
  return { tabs: [], groups: [], active: null, closed: [], pinState: {} };
}

function edit(profile: number, fn: (p: ProfileTabs) => void): void {
  tabsFile.update((d) => {
    const p = (d.profiles[profile] ??= { tabs: [], groups: [], active: null, closed: [], pinState: {} });
    p.closed ??= [];
    p.pinState ??= {};
    p.groups ??= [];
    fn(p);
  });
}

export const list = (profile: number): OpenTab[] => of(profile).tabs;
export const byId = (profile: number, id: string) => of(profile).tabs.find((x) => x.id === id);
export const groups = (profile: number): TabGroup[] => of(profile).groups ?? [];
export const active = (profile: number): string | null => of(profile).active;
export const closedCount = (profile: number) => (of(profile).closed ?? []).length;

export function setActive(profile: number, id: string): void {
  if (of(profile).active === id && tabsFile.get().lastProfile === profile) return;
  edit(profile, (p) => { p.active = id; });
  tabsFile.update((d) => { d.lastProfile = profile; });
}

export function add(profile: number, url = START, opts: { after?: string | null; group?: string | null } = {}): OpenTab {
  const tab: OpenTab = { id: newId('tab'), title: '', url, group: opts.group ?? null };
  edit(profile, (p) => {
    const i = opts.after ? p.tabs.findIndex((x) => x.id === opts.after) : -1;
    if (i >= 0) {
      // Вкладка, открытая со страницы, встаёт рядом и попадает в группу родителя.
      if (opts.group === undefined) tab.group = p.tabs[i].group;
      p.tabs.splice(i + 1, 0, tab);
    } else p.tabs.push(tab);
  });
  return tab;
}

/** Заголовок и адрес обновляются по мере навигации; служебные адреса (кроме стартовой) не запоминаем. */
export function update(profile: number, id: string, patch: { title?: string; url?: string }): void {
  const cur = of(profile).tabs.find((x) => x.id === id);
  if (!cur) return;
  const url = patch.url && (/^https?:/.test(patch.url) || patch.url === START) ? patch.url : cur.url;
  const title = patch.title?.trim() ?? cur.title;
  if (url === cur.url && title === cur.title) return;
  edit(profile, (p) => {
    const x = p.tabs.find((y) => y.id === id);
    if (x) { x.url = url; x.title = title; }
  });
}

export function pinState(profile: number, pinId: string) {
  return of(profile).pinState?.[pinId];
}

export function setPinState(profile: number, pinId: string, url: string, title: string): void {
  // Страницы входа не запоминаем, чтобы вкладка не открывалась на форме логина.
  if (!/^https?:/.test(url) || url.includes('accounts.google.com')) return;
  const cur = of(profile).pinState?.[pinId];
  if (cur && cur.url === url && cur.title === title) return;
  edit(profile, (p) => { p.pinState[pinId] = { url, title }; });
}

export function forgetPin(profile: number, pinId: string): void {
  edit(profile, (p) => { delete p.pinState[pinId]; });
}

/** Закрыть вкладки; последние закрытые можно вернуть Ctrl+Shift+T. */
export function close(profile: number, ids: string[]): void {
  if (!ids.length) return;
  edit(profile, (p) => {
    const gone = p.tabs.filter((x) => ids.includes(x.id));
    p.tabs = p.tabs.filter((x) => !ids.includes(x.id));
    p.closed = [...gone.reverse(), ...p.closed].slice(0, MAX_CLOSED);
  });
}

/** «Удалить данные → Вкладки»: закрыть все вкладки профиля без возможности вернуть. */
export function closeAll(profile: number): void {
  edit(profile, (p) => { p.tabs = []; p.closed = []; p.active = null; });
}

/** Вернуть последнюю закрытую вкладку (на её прежний адрес). */
export function reopen(profile: number): OpenTab | null {
  let tab: OpenTab | null = null;
  edit(profile, (p) => {
    const x = p.closed.shift();
    if (!x) return;
    tab = { ...x, id: newId('tab'), group: p.groups.some((g) => g.id === x.group) ? x.group : null };
    p.tabs.push(tab);
  });
  return tab;
}

/** Перетаскивание в полосе вкладок: поставить вкладку на место [index] среди обычных вкладок. */
export function moveTo(profile: number, id: string, index: number): void {
  edit(profile, (p) => {
    const from = p.tabs.findIndex((x) => x.id === id);
    if (from < 0) return;
    const [tab] = p.tabs.splice(from, 1);
    p.tabs.splice(Math.max(0, Math.min(index, p.tabs.length)), 0, tab);
  });
}

export function setGroup(profile: number, ids: string[], group: string | null): void {
  edit(profile, (p) => { p.tabs.forEach((x) => { if (ids.includes(x.id)) x.group = group; }); });
}

export function addGroup(profile: number, name: string, color: string): TabGroup {
  const existing = groups(profile);
  const g: TabGroup = {
    id: newId('g'),
    name: name.trim().slice(0, 60) || t('group_n', existing.length + 1),
    color: GROUP_COLORS.includes(color) ? color : GROUP_COLORS[0],
  };
  edit(profile, (p) => { p.groups.push(g); });
  return g;
}

export function updateGroup(profile: number, id: string, patch: { name?: string; color?: string }): void {
  edit(profile, (p) => {
    const g = p.groups.find((x) => x.id === id);
    if (!g) return;
    if (patch.name?.trim()) g.name = patch.name.trim().slice(0, 60);
    if (patch.color && GROUP_COLORS.includes(patch.color)) g.color = patch.color;
  });
}

/** Удалить группу; её вкладки остаются открытыми, но без группы. */
export function deleteGroup(profile: number, id: string): void {
  edit(profile, (p) => {
    p.groups = p.groups.filter((g) => g.id !== id);
    p.tabs.forEach((x) => { if (x.group === id) x.group = null; });
  });
}

/** Стереть вкладки, группы и адреса закреплённых вкладок профиля (выход из аккаунтов). */
export function forgetProfile(profile: number): void {
  tabsFile.update((d) => { delete d.profiles[profile]; });
}

export function label(tab: { title: string; url: string }): string {
  if (tab.title.trim()) return tab.title;
  if (/^https?:/.test(tab.url)) return host(tab.url);
  return t('new_tab');
}
