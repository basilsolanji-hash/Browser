import { app, shell, type DownloadItem, type Session } from 'electron';
import { existsSync, linkSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { basename, extname, join } from 'node:path';
import { JsonFile } from './store';

/**
 * Загрузки (Downloads.kt / DownloadsActivity.kt): файлы — в «Загрузки/Ось», список — для экрана «Загрузки».
 * Только по HTTP(S) и blob/data со страниц. Загрузку можно поставить на паузу и продолжить с того же
 * места — и после обрыва сети, и после перезапуска браузера (докачка по Range, если сайт её поддерживает).
 */
export type DownloadState = 'progress' | 'paused' | 'completed' | 'cancelled' | 'interrupted';

export interface Download {
  id: string; name: string; path: string; url: string; time: number; size: number;
  state: DownloadState; received: number; profile: number | null;
  /** Для докачки: цепочка адресов (с редиректами), тип, ETag и Last-Modified ответа, время начала. */
  urlChain?: string[]; mime?: string; etag?: string; lastModified?: string; start?: number;
  /** Сайт разрешает продолжить загрузку с места остановки. */
  resumable?: boolean;
}

const MAX = 200;
const RETRIES = 5;
const file = new JsonFile<{ list: Download[] }>('downloads', () => ({ list: [] }));
const live = new Map<string, DownloadItem>();
const sessions = new Map<string, Session>();
/** Загрузки, которые мы сами возобновляем через createInterruptedDownload: путь → id записи. */
const restoring = new Map<string, string>();
let onChange: () => void = () => {};
/** Браузер закрывается: Chromium отменит загрузки, но мы уже запомнили их как прерванные. */
let quitting = false;

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

/**
 * Недокачанная часть на время перезапуска. При выходе Chromium удаляет незаконченный файл, поэтому
 * заранее делаем на него жёсткую ссылку (мгновенно, без копирования) — данные переживают удаление.
 */
const partOf = (path: string) => join(dirname(path), `.${basename(path)}.osdownload`);

const key = (profile: number | null) => (profile == null ? 'incognito' : String(profile));
let seq = 0;

/** Подключить сессию: каждая загрузка сохраняется без вопросов в папку «Ось». */
export function attach(ses: Session, profile: number | null): void {
  // Инкогнито после закрытия окна не докачать: его сессии больше нет.
  if (profile != null) sessions.set(key(profile), ses);
  ses.on('will-download', (_e, item) => {
    const url = item.getURL();
    if (!/^(https?|blob|data):/i.test(url)) { item.cancel(); return; }
    const restored = restoring.get(item.getSavePath());
    if (restored) {
      restoring.delete(item.getSavePath());
      track(restored, item);
      patch(restored, { state: 'progress' });
      item.resume();
      return;
    }
    const dir = folder();
    mkdirSync(dir, { recursive: true });
    const path = unique(dir, safe(item.getFilename()));
    item.setSavePath(path);
    const id = `d${Date.now()}${seq++}`;
    const entry: Download = {
      id, name: basename(path), path, url: url.startsWith('http') ? url : '', time: Date.now(), size: item.getTotalBytes(),
      state: 'progress', received: 0, profile,
    };
    file.update((d) => { d.list = [entry, ...d.list].slice(0, MAX); });
    track(id, item);
    onChange();
  });
}

/** Следить за загрузкой и запоминать всё, что нужно для докачки. */
function track(id: string, item: DownloadItem): void {
  live.set(id, item);
  let last = 0;
  let retries = 0;
  const meta = (): Partial<Download> => {
    const chain = item.getURLChain().filter((u) => /^https?:/i.test(u));
    return {
      received: item.getReceivedBytes(),
      size: item.getTotalBytes(),
      urlChain: chain.length ? chain : undefined,
      mime: item.getMimeType(),
      etag: item.getETag(),
      lastModified: item.getLastModifiedTime(),
      start: item.getStartTime(),
      resumable: chain.length > 0 && item.canResume(),
    };
  };
  item.on('updated', (_ev, state) => {
    if (quitting) return;
    if (state === 'interrupted') {
      // Обрыв сети: пробуем продолжить сами, с того же места.
      patch(id, { ...meta(), state: 'interrupted' });
      if (item.canResume() && retries < RETRIES) {
        retries++;
        setTimeout(() => { if (live.get(id) === item && item.getState() === 'interrupted') item.resume(); }, 2000 * retries);
      }
      return;
    }
    const now = Date.now();
    const paused = item.isPaused();
    if (!paused && now - last < 500) return;
    last = now;
    patch(id, { ...meta(), state: paused ? 'paused' : 'progress' });
  });
  item.once('done', (_ev, state) => {
    if (live.get(id) === item) live.delete(id);
    if (quitting) return;
    if (state !== 'interrupted') rmSync(partOf(item.getSavePath()), { force: true });
    if (state === 'completed') patch(id, { received: item.getReceivedBytes(), size: item.getTotalBytes() || item.getReceivedBytes(), state, resumable: false });
    else patch(id, { ...meta(), state });
  });
}

function patch(id: string, p: Partial<Download>): void {
  file.update((d) => { const x = d.list.find((y) => y.id === id); if (x) Object.assign(x, p); });
  onChange();
}

export function pause(id: string): void {
  const item = live.get(id);
  if (item && item.getState() === 'progressing') item.pause();
}

/** Продолжить с места остановки: живую загрузку — сразу, прерванную (в том числе до перезапуска) — по Range. */
export function resume(id: string): boolean {
  const item = live.get(id);
  if (item) {
    if (item.isPaused() || item.getState() === 'interrupted') item.resume();
    return true;
  }
  const d = list().find((x) => x.id === id);
  if (!d || (d.state !== 'interrupted' && d.state !== 'paused') || !d.urlChain?.length) return false;
  const ses = sessions.get(key(d.profile));
  if (!ses) return false;
  if (!existsSync(d.path) && existsSync(partOf(d.path))) renameSync(partOf(d.path), d.path);
  const offset = existsSync(d.path) ? statSync(d.path).size : 0;
  restoring.set(d.path, id);
  ses.createInterruptedDownload({
    path: d.path, urlChain: d.urlChain, mimeType: d.mime, offset, length: d.size,
    lastModified: d.lastModified, eTag: d.etag, startTime: d.start,
  });
  return true;
}

/** Выход из браузера: незаконченные загрузки запоминаются как прерванные, чтобы потом продолжить. */
export function suspendAll(): void {
  quitting = true;
  for (const [id, item] of live) {
    if (item.getState() !== 'progressing' && item.getState() !== 'interrupted') continue;
    if (!item.isPaused()) item.pause();
    const path = item.getSavePath();
    try {
      rmSync(partOf(path), { force: true });
      if (existsSync(path)) linkSync(path, partOf(path));
    } catch (e) {
      console.error('[downloads] keep part', e);
    }
    const chain = item.getURLChain().filter((u) => /^https?:/i.test(u));
    file.update((d) => {
      const x = d.list.find((y) => y.id === id);
      if (!x) return;
      Object.assign(x, {
        state: 'interrupted', received: item.getReceivedBytes(), size: item.getTotalBytes(), urlChain: chain,
        mime: item.getMimeType(), etag: item.getETag(), lastModified: item.getLastModifiedTime(), start: item.getStartTime(),
        resumable: chain.length > 0,
      });
    });
  }
}

export function cancel(id: string): void {
  const item = live.get(id);
  if (item) item.cancel();
  else {
    const d = list().find((x) => x.id === id);
    if (d) rmSync(partOf(d.path), { force: true });
    patch(id, { state: 'cancelled', resumable: false });
  }
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
  live.get(id)?.cancel();
  const d = list().find((x) => x.id === id);
  if (d) rmSync(partOf(d.path), { force: true });
  file.update((d) => { d.list = d.list.filter((x) => x.id !== id); });
  onChange();
}

export function clear(): void {
  file.update((d) => { d.list = d.list.filter((x) => x.state === 'progress' || x.state === 'paused'); });
  onChange();
}
