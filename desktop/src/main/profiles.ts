import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { JsonFile } from './store';
import { profileCount } from './settings';
import { local, t } from './i18n';

/** Профили 1–50 (как Profiles.kt): имя, цвет, почта и непрочитанные из заголовка Gmail, описание. */
interface ProfilesData {
  order: number[];
  names: Record<string, string>;
  desc: Record<string, string>;
  email: Record<string, string>;
  unread: Record<string, number>;
  /** Закреплённые профили — всегда сверху списка; хранятся отдельно от порядка. */
  pinned: number[];
  /** Папки профилей: профиль → название папки (без записи — «Без папки»). */
  folders: Record<string, string>;
  /** Свёрнутые папки на главном экране. */
  collapsed: string[];
  /** Вид главного экрана: списком или плиткой. */
  view: 'list' | 'grid';
}

export const profilesFile = new JsonFile<ProfilesData>('profiles', () => ({
  order: [], names: {}, desc: {}, email: {}, unread: {}, pinned: [], folders: {}, collapsed: [], view: 'list',
}));

// --- Папки и вид главного экрана ---

export const folderOf = (id: number): string => profilesFile.get().folders?.[id] ?? '';

export function setFolder(id: number, name: string): void {
  const f = name.trim().slice(0, 60);
  profilesFile.update((d) => {
    d.folders ??= {};
    if (f) d.folders[id] = f;
    else delete d.folders[id];
  });
}

/** Существующие папки по алфавиту (на языке интерфейса). */
export const folders = (): string[] =>
  [...new Set(Object.values(profilesFile.get().folders ?? {}))].sort((a, b) => a.localeCompare(b));

export function renameFolder(from: string, to: string): void {
  const f = to.trim().slice(0, 60);
  if (!f) return;
  profilesFile.update((d) => {
    for (const k of Object.keys(d.folders ?? {})) if (d.folders[k] === from) d.folders[k] = f;
    d.collapsed = (d.collapsed ?? []).map((x) => (x === from ? f : x));
  });
}

/** Убрать папку: профили остаются, просто без папки. */
export function removeFolder(name: string): void {
  profilesFile.update((d) => {
    for (const k of Object.keys(d.folders ?? {})) if (d.folders[k] === name) delete d.folders[k];
    d.collapsed = (d.collapsed ?? []).filter((x) => x !== name);
  });
}

export const collapsed = (): string[] => profilesFile.get().collapsed ?? [];

export function setCollapsed(name: string, on: boolean): void {
  profilesFile.update((d) => {
    const rest = (d.collapsed ?? []).filter((x) => x !== name);
    d.collapsed = on ? [...rest, name] : rest;
  });
}

export const view = (): 'list' | 'grid' => (profilesFile.get().view === 'grid' ? 'grid' : 'list');
export function setView(v: string): void {
  profilesFile.update((d) => { d.view = v === 'grid' ? 'grid' : 'list'; });
}

const COLORS = [
  '#E53935', '#8E24AA', '#3949AB', '#1E88E5', '#00897B', '#43A047', '#F4511E', '#6D4C41',
  '#546E7A', '#D81B60', '#5E35B1', '#039BE5', '#7CB342', '#FB8C00', '#00ACC1',
];

/** Первые 15 — фирменная палитра, дальше — по «золотому углу», чтобы соседние не совпадали. */
export function color(id: number): string {
  if (id >= 1 && id <= COLORS.length) return COLORS[id - 1];
  return hsv((id * 137.5) % 360, 0.62, 0.78);
}

function hsv(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return '#' + [f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Порядок профилей, заданный перетаскиванием; новые — в конце. */
export function order(): number[] {
  const n = profileCount();
  const saved = [...new Set(profilesFile.get().order.filter((id) => Number.isInteger(id) && id >= 1 && id <= n))];
  for (let id = 1; id <= n; id++) if (!saved.includes(id)) saved.push(id);
  return saved;
}

export function setOrder(ids: number[]): void {
  profilesFile.update((d) => { d.order = ids.filter((id) => Number.isInteger(id)); });
}

export const isPinned = (id: number) => (profilesFile.get().pinned ?? []).includes(id);

export function setPinned(id: number, on: boolean): void {
  profilesFile.update((d) => {
    const rest = (d.pinned ?? []).filter((x) => x !== id);
    d.pinned = on ? [...rest, id].sort((a, b) => a - b) : rest;
  });
}

/** Порядок для экранов: закреплённые сверху (в своём порядке), дальше остальные (MainActivity.kt). */
export function sorted(): number[] {
  const ids = order();
  return [...ids.filter(isPinned), ...ids.filter((id) => !isPinned(id))];
}

/** «Выше»/«Ниже» в показанном списке (закреплённые остаются сверху). */
export function move(id: number, delta: number): void {
  const ids = sorted();
  const from = ids.indexOf(id);
  const to = Math.min(ids.length - 1, Math.max(0, from + delta));
  if (from < 0 || from === to) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  setOrder(ids);
}

export const exists = (id: number) => Number.isInteger(id) && id >= 1 && id <= profileCount();

export function name(id: number): string {
  return local(profilesFile.get().names[id]) || t('profile_n', id);
}

export function customName(id: number): string {
  return local(profilesFile.get().names[id]) ?? '';
}

/** Пустое имя возвращает «Профиль N». */
export function rename(id: number, value: string): void {
  profilesFile.update((d) => {
    if (value.trim()) d.names[id] = value.trim().slice(0, 80);
    else delete d.names[id];
  });
}

export function description(id: number): string {
  return local(profilesFile.get().desc[id]) ?? '';
}

export function setDescription(id: number, value: string): void {
  profilesFile.update((d) => {
    if (value.trim()) d.desc[id] = value.trim().slice(0, 2000);
    else delete d.desc[id];
  });
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const UNREAD = /\((\d+)\)/;

/** Заголовок Gmail «Входящие (3) - name@gmail.com - Gmail»: берём адрес и число непрочитанных. */
export function updateFromTitle(id: number, title: string): void {
  if (!title.includes('Gmail')) return;
  const email = EMAIL.exec(title)?.[0];
  if (!email) return;
  const unread = Number(UNREAD.exec(title)?.[1] ?? 0);
  const d = profilesFile.get();
  if (d.email[id] === email && d.unread[id] === unread) return;
  profilesFile.update((x) => { x.email[id] = email; x.unread[id] = unread; });
}

export function forget(id: number): void {
  profilesFile.update((d) => { delete d.email[id]; delete d.unread[id]; });
}

export const email = (id: number): string | null => profilesFile.get().email[id] ?? null;
export const unread = (id: number): number => profilesFile.get().unread[id] ?? 0;

/** Файлы профиля: копии в userData/profile_files/<id>/ (не стираются при выходе из аккаунтов). */
export const filesDir = (id: number) => join(app.getPath('userData'), 'profile_files', String(id));

export function fileCount(id: number): number {
  const dir = filesDir(id);
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile()).length;
  } catch {
    return 0;
  }
}

export const partition = (id: number) => `persist:profile_${id}`;
