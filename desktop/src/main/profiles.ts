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
}

export const profilesFile = new JsonFile<ProfilesData>('profiles', () => ({
  order: [], names: {}, desc: {}, email: {}, unread: {},
}));

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

export function move(id: number, delta: number): void {
  const ids = order();
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
