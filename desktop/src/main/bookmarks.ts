import { randomUUID } from 'node:crypto';
import { JsonFile } from './store';

/** Избранное с папками одного уровня — общее для всех профилей (Bookmarks.kt). */
export interface Bookmark { id: string; t: string; u: string; f: string }

export const bookmarksFile = new JsonFile<{ list: Bookmark[]; folders: string[] }>('bookmarks', () => ({ list: [], folders: [] }));

export const ROOT = '';
export const all = () => bookmarksFile.get().list;
export const findByUrl = (url: string) => all().find((b) => b.u === url);

/** Папки: созданные явно (в том числе пустые) и те, где есть закладки. */
export function folders(): string[] {
  const names = [...bookmarksFile.get().folders, ...all().map((b) => b.f)].filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export function add(title: string, url: string, folder = ROOT): void {
  if (findByUrl(url)) return;
  bookmarksFile.update((d) => { d.list.push({ id: 'b' + randomUUID(), t: (title || url).slice(0, 300), u: url, f: folder }); });
}

export function remove(id: string): void {
  bookmarksFile.update((d) => { d.list = d.list.filter((b) => b.id !== id); });
}

export function removeByUrl(url: string): void {
  bookmarksFile.update((d) => { d.list = d.list.filter((b) => b.u !== url); });
}

export function rename(id: string, title: string): void {
  if (!title.trim()) return;
  bookmarksFile.update((d) => { const b = d.list.find((x) => x.id === id); if (b) b.t = title.trim().slice(0, 300); });
}

export function move(id: string, folder: string): void {
  bookmarksFile.update((d) => {
    if (folder && !folders().includes(folder)) d.folders.push(folder);
    const b = d.list.find((x) => x.id === id);
    if (b) b.f = folder;
  });
}

/** false — если имя пустое или такая папка уже есть. */
export function addFolder(name: string): boolean {
  const n = name.trim().slice(0, 80);
  if (!n || folders().some((f) => f.toLowerCase() === n.toLowerCase())) return false;
  bookmarksFile.update((d) => { d.folders.push(n); });
  return true;
}

export function renameFolder(from: string, to: string): boolean {
  const n = to.trim().slice(0, 80);
  if (!n) return false;
  if (n === from) return true;
  if (folders().some((f) => f !== from && f.toLowerCase() === n.toLowerCase())) return false;
  bookmarksFile.update((d) => {
    d.folders = [...d.folders.filter((f) => f !== from), n];
    d.list.forEach((b) => { if (b.f === from) b.f = n; });
  });
  return true;
}

/** Удалить папку: закладки удаляются или (keep) переносятся в корень. */
export function removeFolder(name: string, keep: boolean): void {
  bookmarksFile.update((d) => {
    d.folders = d.folders.filter((f) => f !== name);
    d.list = keep ? d.list.map((b) => (b.f === name ? { ...b, f: ROOT } : b)) : d.list.filter((b) => b.f !== name);
  });
}
