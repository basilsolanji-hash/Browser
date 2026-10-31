import { dialog, type BrowserWindow } from 'electron';
import { copyFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Bookmarks from './bookmarks';
import * as Passwords from './passwords';
import * as History from './history';
import {
  type ImportBookmark, type ImportReport, type ImportVisit, LIMITS, emptyReport, parseBookmarksHtml, parseBookmarksJson,
  parsePasswordsCsv, readChromeHistory, sqliteAvailable,
} from './chromeparse';

/**
 * Перенос из Chrome в текущий профиль: закладки (HTML или Bookmarks профиля), пароли (только CSV,
 * выгруженный пользователем) и история (копия History во временной папке). Всё локально, без сети.
 * Пути собираются только здесь: из диалога или из проверенного имени папки профиля Chrome.
 */
export interface ChromeProfile { dir: string; name: string; bookmarks: boolean; history: boolean }
export type ChromeResult = ImportReport | 'notfound' | 'busy' | 'bad' | 'big';
export type FileResult = ImportReport | 'cancel' | 'big' | 'bad' | 'nocrypto';

/** Для приёмки: свой корень User Data и путь вместо диалога (osTest.chromeRoot, osTest.importPath). */
let testRoot: string | null | undefined;
let testPath: string | null = null;
export const setTestRoot = (p: string | null) => { testRoot = p; };
export const setTestPath = (p: string | null) => { testPath = p; };

export function chromeRoot(): string | null {
  if (testRoot !== undefined) return testRoot;
  const local = process.env.LOCALAPPDATA;
  return process.platform === 'win32' && local ? join(local, 'Google', 'Chrome', 'User Data') : null;
}

const DIR_RE = /^(Default|Profile \d{1,3})$/;
const order = (d: string) => (d === 'Default' ? 0 : Number(d.slice(8)));

async function isFile(p: string): Promise<boolean> {
  try { return (await stat(p)).isFile(); } catch { return false; }
}

/** Размер не больше max (проверка до чтения): 'big' — больше, null — файла нет. */
async function sizeOk(p: string, max: number): Promise<boolean | null> {
  try { return (await stat(p)).size <= max; } catch { return null; }
}

/** Профили Chrome с закладками или историей; имена — из Local State. */
export async function chromeProfiles(): Promise<ChromeProfile[]> {
  const root = chromeRoot();
  if (!root) return [];
  let dirs: string[];
  try { dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && DIR_RE.test(d.name)).map((d) => d.name); } catch { return []; }
  let names: Record<string, { name?: unknown }> = {};
  try {
    const ls = join(root, 'Local State');
    if (await sizeOk(ls, 10 * 1024 * 1024)) names = (JSON.parse(await readFile(ls, 'utf8')) as { profile?: { info_cache?: typeof names } }).profile?.info_cache ?? {};
  } catch { /* без имён — показываем имя папки */ }
  const out: ChromeProfile[] = [];
  for (const dir of dirs.sort((a, b) => order(a) - order(b))) {
    const bookmarks = await isFile(join(root, dir, 'Bookmarks'));
    const history = await isFile(join(root, dir, 'History'));
    if (!bookmarks && !history) continue;
    const n = names[dir]?.name;
    out.push({ dir, name: typeof n === 'string' && n.trim() ? n.trim().slice(0, 100) : dir, bookmarks, history });
  }
  return out;
}

/** Применить разобранное к профилю и сложить отчёт. */
function apply(profile: number, r: ImportReport, bookmarks: ImportBookmark[] | null, visits: ImportVisit[] | null): ImportReport {
  if (bookmarks) {
    const b = Bookmarks.addMany(bookmarks);
    r.bookmarks += b.added; r.duplicates += b.duplicates;
  }
  if (visits) {
    const h = History.importMany(profile, visits);
    r.history += h.added; r.duplicates += h.duplicates; r.skipped += h.dropped;
  }
  return r;
}

/** Закладки и история прямо из профиля Chrome. Сначала всё читается, потом применяется. */
export async function fromChrome(profile: number, dir: string, what: { bookmarks: boolean; history: boolean }, otherName: string): Promise<ChromeResult> {
  const p = (await chromeProfiles()).find((x) => x.dir === dir);
  const root = chromeRoot();
  if (!p || !root) return 'notfound';
  const r = emptyReport();
  let bookmarks: ImportBookmark[] | null = null;
  let visits: ImportVisit[] | null = null;
  if (what.bookmarks && p.bookmarks) {
    const path = join(root, p.dir, 'Bookmarks');
    const ok = await sizeOk(path, LIMITS.jsonBytes);
    if (ok === false) return 'big';
    if (ok == null) return 'notfound';
    let text: string;
    try { text = await readFile(path, 'utf8'); } catch { return 'bad'; }
    const parsed = parseBookmarksJson(text, otherName);
    bookmarks = parsed.items;
    r.skipped += parsed.bad;
  }
  if (what.history && p.history && sqliteAvailable()) {
    const path = join(root, p.dir, 'History');
    const ok = await sizeOk(path, LIMITS.historyBytes);
    if (ok === false) return 'big';
    if (ok == null) return 'notfound';
    // Chrome держит файл открытым: читаем копию во временной папке, копию удаляем в любом случае.
    const tmp = await mkdtemp(join(tmpdir(), 'os-chrome-'));
    try {
      const copy = join(tmp, 'History');
      try {
        await copyFile(path, copy);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        console.error('[import] history copy', code);
        return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' ? 'busy' : 'bad';
      }
      const parsed = readChromeHistory(copy, LIMITS.history);
      visits = parsed.items;
      r.skipped += parsed.bad;
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }
  return apply(profile, r, bookmarks, visits);
}

async function pickFile(win: BrowserWindow, kind: 'html' | 'csv'): Promise<string | null> {
  if (testPath) return testPath;
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: kind === 'html' ? [{ name: 'HTML', extensions: ['html', 'htm'] }] : [{ name: 'CSV', extensions: ['csv'] }],
  });
  return res.canceled ? null : (res.filePaths[0] ?? null);
}

/** Закладки из HTML или пароли из CSV; файл выбирает пользователь в окне Windows. */
export async function fromFile(win: BrowserWindow, profile: number, kind: 'html' | 'csv'): Promise<FileResult> {
  if (kind === 'csv' && !Passwords.available()) return 'nocrypto';
  const path = await pickFile(win, kind);
  if (!path) return 'cancel';
  const ok = await sizeOk(path, kind === 'html' ? LIMITS.htmlBytes : LIMITS.csvBytes);
  if (ok == null) return 'bad';
  if (!ok) return 'big';
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch { return 'bad'; }
  const r = emptyReport();
  if (kind === 'html') {
    const parsed = parseBookmarksHtml(text);
    r.skipped += parsed.bad;
    return apply(profile, r, parsed.items, null);
  }
  const parsed = parsePasswordsCsv(text);
  if (!parsed.header) return 'bad';
  const res = Passwords.importMany(profile, parsed.items);
  if (res === 'nocrypto') return res;
  r.passwords = res.added; r.duplicates = res.duplicates; r.skipped = parsed.bad;
  return r;
}
