import { app, shell, type DownloadItem, type Session, type WebContents } from 'electron';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { existsSync, linkSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { readFile, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { basename, extname, join } from 'node:path';
import { JsonFile } from './store';
import { effectiveMime, viewableInOs } from '../shared/filetype';
import * as DocView from './docview';
import { t } from './i18n';
import { markFromInternet } from './motw';

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
  /** Ждёт ответа на «Разрешить скачивание?»: файл уже качается, при «Запретить» — удаляется. */
  pending?: boolean;
}

/**
 * Решение о загрузке (разрешения сайта, окно браузера): 'allow' — сразу, 'block' — не начинать,
 * Promise — качать и ждать ответа пользователя (false — отменить и удалить).
 */
export interface GateRequest { ses: Session; profile: number | null; wc: WebContents | null; url: string; name: string }
export type GateAnswer = 'allow' | 'block' | Promise<boolean>;
let gate: (r: GateRequest) => GateAnswer = () => 'allow';
export const setGate = (fn: (r: GateRequest) => GateAnswer) => { gate = fn; };

const MAX = 200;
const RETRIES = 5;
const file = new JsonFile<{ list: Download[] }>('downloads', () => ({ list: [] }));
const live = new Map<string, DownloadItem>();
const sessions = new Map<string, Session>();
/** Загрузки, которые мы сами возобновляем через createInterruptedDownload: путь → id записи. */
const restoring = new Map<string, string>();
/** Скорость идущих загрузок (байт/с, сглаженная) — для «осталось N с». Только в памяти. */
const rates = new Map<string, { at: number; bytes: number; rate: number }>();
let onChange: () => void = () => {};
/** Браузер закрывается: Chromium отменит загрузки, но мы уже запомнили их как прерванные. */
let quitting = false;

export const list = () => file.get().list;
export const setListener = (fn: () => void) => { onChange = fn; };
export const folder = () => join(app.getPath('downloads'), 'Ось');

/** Сколько секунд осталось (null — неизвестно). */
export function eta(d: Download): number | null {
  const r = rates.get(d.id);
  if (d.state !== 'progress' || !r || r.rate <= 0 || d.size <= 0) return null;
  return Math.max(0, (d.size - d.received) / r.rate);
}

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
/** Страница, с которой начата загрузка (для ReferrerUrl); только в памяти, на диск не попадает. */
const referrers = new Map<string, string>();

/** Подключить сессию: загрузки сохраняются в папку «Ось», если сайт может скачивать (разрешения сайта). */
export function attach(ses: Session, profile: number | null): void {
  // Инкогнито после закрытия окна не докачать: его сессии больше нет.
  if (profile != null) sessions.set(key(profile), ses);
  cleanupPending();
  ses.on('will-download', (_e, item, wc) => {
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
    let answer: GateAnswer;
    try {
      answer = gate({ ses, profile, wc: wc ?? null, url, name: item.getFilename() });
    } catch (e) {
      console.error('[downloads] gate', e);
      answer = 'allow';
    }
    // Сайт с «Запретить» не начинает загрузку.
    if (answer === 'block') { item.cancel(); return; }
    const dir = folder();
    mkdirSync(dir, { recursive: true });
    const path = unique(dir, safe(item.getFilename()));
    item.setSavePath(path);
    const id = `d${Date.now()}${seq++}`;
    const entry: Download = {
      id, name: basename(path), path, url: url.startsWith('http') ? url : '', time: Date.now(), size: item.getTotalBytes(),
      state: 'progress', received: 0, profile, mime: item.getMimeType(), ...(answer === 'allow' ? {} : { pending: true }),
    };
    file.update((d) => { d.list = [entry, ...d.list].slice(0, MAX); });
    if (wc) referrers.set(id, wc.getURL());
    track(id, item);
    onChange();
    // Пока вопрос висит, файл качается; «Запретить» — отмена и удаление.
    if (answer !== 'allow') {
      void answer.then((ok) => {
        if (ok) patch(id, { pending: false });
        else discard(id);
      }, () => discard(id));
    }
  });
}

let cleaned = false;
/** Ответа так и не было (браузер закрыли с вопросом) — это «Запретить»: файл не оставляем. */
function cleanupPending(): void {
  if (cleaned) return;
  cleaned = true;
  const stale = list().filter((d) => d.pending);
  if (!stale.length) return;
  for (const d of stale) {
    rmSync(d.path, { force: true });
    rmSync(partOf(d.path), { force: true });
  }
  file.update((d) => { d.list = d.list.filter((x) => !x.pending); });
}

/** Отказ в загрузке: остановить, удалить файл и запись. */
function discard(id: string): void {
  const item = live.get(id);
  const d = list().find((x) => x.id === id);
  live.delete(id);
  rates.delete(id);
  file.update((x) => { x.list = x.list.filter((y) => y.id !== id); });
  if (item && item.getState() !== 'completed' && item.getState() !== 'cancelled') item.cancel();
  if (d) {
    rmSync(d.path, { force: true });
    rmSync(partOf(d.path), { force: true });
  }
  onChange();
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
    if (quitting || live.get(id) !== item) return;
    if (state === 'interrupted') {
      // Обрыв сети: пробуем продолжить сами, с того же места.
      rates.delete(id);
      patch(id, { ...meta(), state: 'interrupted' });
      if (item.canResume() && retries < RETRIES) {
        retries++;
        setTimeout(() => { if (live.get(id) === item && item.getState() === 'interrupted') item.resume(); }, 2000 * retries);
      }
      return;
    }
    const now = Date.now();
    const paused = item.isPaused();
    // Скорость — по приросту байт, сглаженно (чтобы «осталось» не прыгало).
    const got = item.getReceivedBytes();
    const r = rates.get(id);
    if (paused || !r) rates.set(id, { at: now, bytes: got, rate: r && !paused ? r.rate : 0 });
    else if (now - r.at >= 400) {
      const cur = ((got - r.bytes) * 1000) / (now - r.at);
      rates.set(id, { at: now, bytes: got, rate: r.rate ? r.rate * 0.6 + cur * 0.4 : cur });
    }
    if (!paused && now - last < 500) return;
    last = now;
    patch(id, { ...meta(), state: paused ? 'paused' : 'progress' });
  });
  item.once('done', (_ev, state) => {
    const mine = live.get(id) === item;
    if (mine) live.delete(id);
    rates.delete(id);
    const referrer = referrers.get(id);
    referrers.delete(id);
    // Отказ в разрешении уже удалил запись и файл.
    if (quitting || !mine && !list().some((x) => x.id === id)) return;
    if (state !== 'interrupted') rmSync(partOf(item.getSavePath()), { force: true });
    if (state === 'completed') {
      // Файл из интернета: метка для Проводника и SmartScreen (в инкогнито — без адресов).
      const d = list().find((x) => x.id === id);
      const chain = item.getURLChain();
      markFromInternet(item.getSavePath(), { referrer, host: d?.url || chain[chain.length - 1], incognito: d?.profile == null });
    }
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

const ready = (id: string) => {
  const d = list().find((x) => x.id === id);
  return d && d.state === 'completed' && !d.pending && existsSync(d.path) ? d : null;
};

export const mimeOf = (d: Download) => effectiveMime(d.mime, d.name);

/** Открывается во вкладке Оси: PDF, картинки, текст и документы (DOCX, XLSX, PPTX, ODF, CSV — через DocView). */
const viewable = (d: Download) => DocView.supports(d.name) || viewableInOs(mimeOf(d));

/** Адрес защищённой раздачи для вкладки Оси или null — тогда системным приложением. */
export function viewUrl(id: string): string | null {
  const d = ready(id);
  if (!d || d.profile == null || !viewable(d)) return null;
  return viewPath(d.path, d.name, d.profile, mimeOf(d));
}

/** Файл профиля или загрузка — во вкладку Оси; null — формат открывается системным приложением. */
export function viewPath(path: string, name: string, profile: number, mime = effectiveMime(undefined, name)): string | null {
  if (!DocView.supports(name) && !viewableInOs(mime)) return null;
  // Случайный ключ вместо пути: сайт не угадает адрес и не вставит чужой файл картинкой.
  const token = randomBytes(16).toString('hex');
  tokens.set(token, { path, name, profile, mime });
  return `os://file/${token}/${encodeURIComponent(name)}`;
}

/** Документ → HTML в отдельном потоке: не дольше 20 с и не больше 512 МБ памяти, иначе «не открылся». */
function docInWorker(path: string, name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const w = new Worker(join(__dirname, 'docworker.js'), { workerData: { path, name }, resourceLimits: { maxOldGenerationSizeMb: 512 } });
    const timer = setTimeout(() => { void w.terminate(); resolve(null); }, 20000);
    w.once('message', (html: string | null) => { clearTimeout(timer); resolve(html); void w.terminate(); });
    w.once('error', () => { clearTimeout(timer); resolve(null); });
  });
}

/** Ключи раздачи файлов во вкладки (только до выхода из браузера). */
const tokens = new Map<string, { path: string; name: string; profile: number; mime: string }>();

export const profileOf = (id: string) => list().find((x) => x.id === id)?.profile ?? null;

/** Системным приложением по типу файла. */
export async function open(id: string): Promise<boolean> {
  const d = ready(id);
  if (!d) return false;
  return (await shell.openPath(d.path)) === '';
}

/** «Открыть с помощью» — системный выбор программы (только Windows). */
export function openWith(id: string): boolean {
  const d = ready(id);
  if (!d || process.platform !== 'win32') return false;
  execFile('rundll32', ['shell32.dll,OpenAs_RunDLL', d.path], { windowsHide: true }, () => {});
  return true;
}

/**
 * Раздача скачанного файла во вкладку (os://file/<ключ>/<имя>): только своему профилю, только готовый файл.
 * Не PDF — со строгим CSP в песочнице: ни скриптов, ни запросов наружу (SVG и текст безопасны).
 */
export async function serve(token: string, ses: Session): Promise<Response> {
  const d = tokens.get(token);
  if (!d || sessions.get(key(d.profile)) !== ses || !existsSync(d.path)) return new Response('', { status: 404 });
  // Документ — страница HTML, собранная на компьютере (без сети), со строгим CSP: картинки только встроенные.
  if (DocView.supports(d.name)) {
    try {
      const html = (await docInWorker(d.path, d.name)) ?? `<!doctype html><meta charset="utf-8"><title>${DocView.esc(d.name)}</title><p>${DocView.esc(t('dt_doc_broken'))}</p>`;
      return new Response(html, { headers: {
        'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      } });
    } catch {
      return new Response('', { status: 404 });
    }
  }
  const mime = d.mime;
  if (!viewableInOs(mime)) return new Response('', { status: 404 });
  const text = mime.startsWith('text/') || mime === 'application/json';
  const headers: Record<string, string> = {
    'content-type': text ? 'text/plain; charset=utf-8' : mime, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store',
  };
  // PDF показывает встроенный просмотрщик Chromium — ему CSP мешает.
  if (mime !== 'application/pdf') headers['content-security-policy'] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
  try {
    return new Response(new Uint8Array(await readFile(d.path)), { headers });
  } catch {
    return new Response('', { status: 404 });
  }
}

/** Место на диске с папкой загрузок (fs.statfs). */
export async function disk(): Promise<{ free: number; total: number } | null> {
  try {
    const dir = existsSync(folder()) ? folder() : app.getPath('downloads');
    const s = await statfs(dir);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

export function show(id: string): void {
  const d = list().find((x) => x.id === id);
  if (d && !d.pending && existsSync(d.path)) shell.showItemInFolder(d.path);
}

/** Убрать из списка (файл на диске остаётся). */
export function remove(id: string): void {
  live.get(id)?.cancel();
  const d = list().find((x) => x.id === id);
  if (d) rmSync(partOf(d.path), { force: true });
  file.update((d) => { d.list = d.list.filter((x) => x.id !== id); });
  onChange();
}

/** Удалить файл с диска и из списка (меню строки «Удалить»). */
export function deleteFile(id: string): void {
  const d = list().find((x) => x.id === id);
  const item = live.get(id);
  live.delete(id);
  file.update((x) => { x.list = x.list.filter((y) => y.id !== id); });
  item?.cancel();
  if (d) {
    rmSync(d.path, { force: true });
    rmSync(partOf(d.path), { force: true });
  }
  onChange();
}

export function clear(): void {
  file.update((d) => { d.list = d.list.filter((x) => x.state === 'progress' || x.state === 'paused' || x.pending); });
  onChange();
}
