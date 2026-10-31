import { app } from 'electron';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonFile } from './store';
import { markFromInternet } from './motw';

/** Сохранённые страницы (SavedPages.kt): PDF в userData/saved, список — новые сверху. */
export interface SavedPage { id: number; title: string; url: string; file: string; time: number; size: number }

const file = new JsonFile<{ list: SavedPage[] }>('saved_pages', () => ({ list: [] }));

export const dir = () => join(app.getPath('userData'), 'saved');
export const pathOf = (p: SavedPage) => join(dir(), p.file);

export const list = (): SavedPage[] => file.get().list.filter((p) => existsSync(pathOf(p)));
export const byId = (id: number) => list().find((p) => p.id === id);

export function store(title: string, url: string, pdf: Buffer, incognito = false): SavedPage {
  mkdirSync(dir(), { recursive: true });
  let id = Date.now();
  while (file.get().list.some((p) => p.id === id)) id++;
  const name = `page_${id}.pdf`;
  writeFileSync(join(dir(), name), pdf);
  markFromInternet(join(dir(), name), { referrer: url, host: url, incognito });
  const page: SavedPage = { id, title: (title || url).slice(0, 300), url, file: name, time: id, size: statSync(join(dir(), name)).size };
  file.update((d) => { d.list = [page, ...d.list]; });
  return page;
}

export function rename(id: number, title: string): void {
  if (!title.trim()) return;
  file.update((d) => { const p = d.list.find((x) => x.id === id); if (p) p.title = title.trim().slice(0, 300); });
}

export function remove(id: number): void {
  const p = file.get().list.find((x) => x.id === id);
  if (p) rmSync(pathOf(p), { force: true });
  file.update((d) => { d.list = d.list.filter((x) => x.id !== id); });
}
