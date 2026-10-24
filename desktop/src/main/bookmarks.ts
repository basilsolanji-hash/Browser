import { randomUUID } from 'node:crypto';
import { JsonFile } from './store';

/** Избранное с папками одного уровня — общее для всех профилей (Bookmarks.kt). */
export interface Bookmark { id: string; t: string; u: string; f: string }

export const bookmarksFile = new JsonFile<{ list: Bookmark[]; folders: string[] }>('bookmarks', () => ({ list: [], folders: [] }));

export const all = () => bookmarksFile.get().list;
export const findByUrl = (url: string) => all().find((b) => b.u === url);

export function add(title: string, url: string, folder = ''): void {
  if (findByUrl(url)) return;
  bookmarksFile.update((d) => { d.list.push({ id: 'b' + randomUUID(), t: title || url, u: url, f: folder }); });
}

export function removeByUrl(url: string): void {
  bookmarksFile.update((d) => { d.list = d.list.filter((b) => b.u !== url); });
}
