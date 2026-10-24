import { app, shell, type DownloadItem, type Session } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { JsonFile } from './store';

/**
 * Загрузки (Downloads.kt / DownloadsActivity.kt): файлы — в «Загрузки/Ось», список — для экрана «Загрузки».
 * Только по HTTP(S) и blob/data со страниц; ход загрузки виден на экране.
 */
export interface Download { id: string; name: string; path: string; url: string; time: number; size: number; state: 'progress' | 'completed' | 'cancelled' | 'interrupted'; received: number; profile: number | null }

const MAX = 200;
const file = new JsonFile<{ list: Download[] }>('downloads', () => ({ list: [] }));
const live = new Map<string, DownloadItem>();
let onChange: () => void = () => {};

export const list = () => file.get().list;
export const setListener = (fn: () => void) => { onChange = fn; };
export const folder = () => join(app.getPath('downloads'), 'Ось');

function unique(dir: string, name: string): string {
  const ext = extname(name);
  const base = name.slice(0, name.length - ext.length) || 'file';
  let p = join(dir, name);
  for (let n = 2; existsSync(p); n++) p = join(dir, `${base} (${n})${ext}`);
  return p;
}

// eslint-disable-next-line no-control-regex -- управляющие символы в имени файла заменяем намеренно
const safe = (name: string) => basename(name).replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 150) || 'download';

let seq = 0;

/** Подключить сессию: каждая загрузка сохраняется без вопросов в папку «Ось». */
export function attach(ses: Session, profile: number | null): void {
  ses.on('will-download', (_e, item) => {
    const url = item.getURL();
    if (!/^(https?|blob|data):/i.test(url)) { item.cancel(); return; }
    const dir = folder();
    mkdirSync(dir, { recursive: true });
    const path = unique(dir, safe(item.getFilename()));
    item.setSavePath(path);
    const id = `d${Date.now()}${seq++}`;
    live.set(id, item);
    const entry: Download = { id, name: basename(path), path, url: url.startsWith('http') ? url : '', time: Date.now(), size: item.getTotalBytes(), state: 'progress', received: 0, profile };
    file.update((d) => { d.list = [entry, ...d.list].slice(0, MAX); });
    onChange();
    let last = 0;
    item.on('updated', (_ev, state) => {
      const now = Date.now();
      if (now - last < 500) return;
      last = now;
      patch(id, { received: item.getReceivedBytes(), size: item.getTotalBytes(), state: state === 'interrupted' ? 'interrupted' : 'progress' });
    });
    item.once('done', (_ev, state) => {
      live.delete(id);
      patch(id, { received: item.getReceivedBytes(), size: item.getTotalBytes() || item.getReceivedBytes(), state });
    });
  });
}

function patch(id: string, p: Partial<Download>): void {
  file.update((d) => { const x = d.list.find((y) => y.id === id); if (x) Object.assign(x, p); });
  onChange();
}

export function cancel(id: string): void {
  live.get(id)?.cancel();
}

export async function open(id: string): Promise<boolean> {
  const d = list().find((x) => x.id === id);
  if (!d || d.state !== 'completed' || !existsSync(d.path)) return false;
  return (await shell.openPath(d.path)) === '';
}

export function show(id: string): void {
  const d = list().find((x) => x.id === id);
  if (d && existsSync(d.path)) shell.showItemInFolder(d.path);
}

/** Убрать из списка (файл на диске остаётся). */
export function remove(id: string): void {
  cancel(id);
  file.update((d) => { d.list = d.list.filter((x) => x.id !== id); });
  onChange();
}

export function clear(): void {
  file.update((d) => { d.list = d.list.filter((x) => x.state === 'progress'); });
  onChange();
}
