import { originOf } from './backupcrypto';

/**
 * Перенос из Chrome: разбор файлов без electron (покрыт юнит-тестами). Закладки — HTML (формат Netscape,
 * его выгружают Chrome, Edge и Firefox) или JSON профиля Chrome; пароли — только CSV, который выгрузил
 * сам пользователь (Login Data профиля не читаем); история — копия SQLite-файла History, только чтение.
 */
export interface ImportBookmark { title: string; url: string; folder: string }
export interface ImportLogin { origin: string; username: string; password: string }
export interface ImportVisit { u: string; t: string; d: number }
export interface ImportReport { bookmarks: number; passwords: number; history: number; duplicates: number; skipped: number }
export interface Parsed<T> { items: T[]; bad: number }

/** Размеры файлов (проверяются до чтения) и число записей за один перенос. */
export const LIMITS = {
  htmlBytes: 20 * 1024 * 1024, jsonBytes: 20 * 1024 * 1024, csvBytes: 5 * 1024 * 1024, historyBytes: 512 * 1024 * 1024,
  bookmarks: 20_000, passwords: 5_000, history: 1_000,
};

const FOLDER_MAX = 80;
const TITLE_MAX = 300;
const JSON_DEPTH = 50;
/** Адрес длиннее 8 КБ не переносится. */
const URL_MAX = 8192;

export const emptyReport = (): ImportReport => ({ bookmarks: 0, passwords: 0, history: 0, duplicates: 0, skipped: 0 });

/** Только адреса сайтов: javascript:, data:, file:, chrome: и прочие не переносятся. */
export function isWebUrl(u: string): boolean {
  if (u.trim().length > URL_MAX) return false;
  try {
    const x = new URL(u.trim());
    return (x.protocol === 'http:' || x.protocol === 'https:') && !!x.hostname;
  } catch {
    return false;
  }
}

/** Время Chrome — микросекунды от 1601-01-01; 0 — нет времени (запись пропускается). */
export function chromeTimeToMs(us: number | bigint): number {
  const ms = (typeof us === 'bigint' ? Number(us / 1000n) : Math.floor(us / 1000)) - 11_644_473_600_000;
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/** Путь папок ниже корня → одна папка Оси («Работа / Проекты»), до 80 символов. */
export const flattenFolder = (path: string[]): string =>
  path.map((s) => s.trim()).filter(Boolean).join(' / ').slice(0, FOLDER_MAX).trim();

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === '#') {
      const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[k] ?? m;
  });
}

/** Текст между тегом и его закрывающим тегом (без вложенной разметки). */
function textUntil(text: string, from: number, tag: string): [string, number] {
  const re = new RegExp(`</${tag}\\s*>`, 'gi');
  re.lastIndex = from;
  const m = re.exec(text);
  const end = m ? m.index : text.length;
  return [decodeEntities(text.slice(from, end).replace(/<[^<>]{0,9000}>/g, '')).replace(/\s+/g, ' ').trim(), m ? re.lastIndex : end];
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function pushBookmark(out: Parsed<ImportBookmark>, title: string, url: string, path: string[]): void {
  const u = url.trim();
  if (!isWebUrl(u) || out.items.length >= LIMITS.bookmarks) { out.bad++; return; }
  out.items.push({ title: (title.trim() || u).slice(0, TITLE_MAX), url: u, folder: flattenFolder(path) });
}

/**
 * HTML закладок: линейный проход по тегам <H3>, <A>, <DL>, </DL> со стеком папок, без DOM.
 * Папка «Панель закладок» (PERSONAL_TOOLBAR_FOLDER) — корень избранного; атрибут ICON не используется.
 */
export function parseBookmarksHtml(text: string): Parsed<ImportBookmark> {
  const out: Parsed<ImportBookmark> = { items: [], bad: 0 };
  // null — безымянный уровень (верхний <DL>), '' — панель закладок.
  const stack: (string | null)[] = [];
  let pending: string | null = null;
  const re = /<(\/?)(dl|h3|a)(?=[\s>])([^<>]{0,9000})>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const close = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'dl') {
      if (close) stack.pop();
      else { stack.push(pending); pending = null; }
      continue;
    }
    if (close) continue;
    const [inner, next] = textUntil(text, re.lastIndex, tag);
    re.lastIndex = next;
    const path = stack.filter((x): x is string => x != null);
    if (tag === 'h3') pending = /\bPERSONAL_TOOLBAR_FOLDER\s*=\s*["']?true/i.test(m[3]) ? '' : (inner || ' ');
    else { pending = null; pushBookmark(out, inner, attr(m[3], 'href') ?? '', path); }
  }
  return out;
}

interface ChromeNode { type?: unknown; name?: unknown; url?: unknown; children?: unknown }

/** JSON-файл Bookmarks профиля Chrome: панель закладок — корень, «Другие» и «Мобильные» — папки. */
export function parseBookmarksJson(text: string, otherName: string): Parsed<ImportBookmark> {
  const out: Parsed<ImportBookmark> = { items: [], bad: 0 };
  let roots: Record<string, ChromeNode>;
  try {
    const j = JSON.parse(text) as { roots?: Record<string, ChromeNode> };
    if (!j || typeof j.roots !== 'object' || !j.roots) throw new Error('no roots');
    roots = j.roots;
  } catch {
    out.bad++;
    return out;
  }
  const walk = (node: ChromeNode, path: string[], depth: number): void => {
    if (!node || typeof node !== 'object') return;
    if (depth > JSON_DEPTH) { out.bad++; return; }
    if (node.type === 'url') { pushBookmark(out, typeof node.name === 'string' ? node.name : '', typeof node.url === 'string' ? node.url : '', path); return; }
    if (!Array.isArray(node.children)) return;
    const sub = depth === 0 ? path : [...path, typeof node.name === 'string' ? node.name : ''];
    for (const c of node.children as ChromeNode[]) walk(c, sub, depth + 1);
  };
  walk(roots.bookmark_bar, [], 0);
  walk(roots.other, [otherName], 0);
  walk(roots.synced, [typeof roots.synced?.name === 'string' && roots.synced.name ? roots.synced.name : otherName], 0);
  return out;
}

/** CSV по RFC 4180: кавычки, "" внутри, переводы строк в кавычках, CRLF/LF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/**
 * CSV менеджера паролей Chrome (name,url,username,password,note). Колонки — по заголовку; без заголовка
 * с url и password ничего не переносится (header: false). Схема проверяется до originOf: android://… — не сайт.
 */
export function parsePasswordsCsv(text: string): Parsed<ImportLogin> & { header: boolean } {
  const rows = parseCsv(text);
  const head = (rows[0] ?? []).map((x) => x.trim().toLowerCase());
  const iu = head.indexOf('url');
  const ip = head.indexOf('password');
  const il = head.indexOf('username');
  if (iu < 0 || ip < 0) return { items: [], bad: rows.length, header: false };
  const out: Parsed<ImportLogin> & { header: boolean } = { items: [], bad: 0, header: true };
  for (const r of rows.slice(1)) {
    const url = (r[iu] ?? '').trim();
    const password = r[ip] ?? '';
    const origin = isWebUrl(url) ? originOf(url) : null;
    if (!origin || !password || out.items.length >= LIMITS.passwords) { out.bad++; continue; }
    out.items.push({ origin, username: il >= 0 ? (r[il] ?? '').trim().slice(0, 500) : '', password: password.slice(0, 1000) });
  }
  return out;
}

type Sqlite = typeof import('node:sqlite');
const sqlite = (): Sqlite | null => {
  try { return (process.getBuiltinModule('node:sqlite') as Sqlite | undefined) ?? null; } catch { return null; }
};

/** Есть ли встроенный node:sqlite (Electron 44); если нет — пункт «История» скрывается. */
export const sqliteAvailable = (): boolean => typeof sqlite()?.DatabaseSync === 'function';

/** История из копии файла History: по записи на адрес, новые сверху; не SQLite или чужая схема — bad. */
export function readChromeHistory(dbPath: string, limit: number = LIMITS.history): Parsed<ImportVisit> {
  const out: Parsed<ImportVisit> = { items: [], bad: 0 };
  const lib = sqlite();
  if (!lib) { out.bad++; return out; }
  let db: InstanceType<Sqlite['DatabaseSync']> | null = null;
  try {
    db = new lib.DatabaseSync(dbPath, { readOnly: true });
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'urls'").get()) throw new Error('no urls');
    const q = db.prepare('SELECT url, title, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ?');
    // Время Chrome больше 2^53 — читаем как BigInt.
    q.setReadBigInts(true);
    for (const r of q.all(BigInt(Math.max(0, Math.trunc(limit)))) as { url: unknown; title: unknown; last_visit_time: unknown }[]) {
      const u = typeof r.url === 'string' ? r.url : '';
      const d = typeof r.last_visit_time === 'bigint' || typeof r.last_visit_time === 'number' ? chromeTimeToMs(r.last_visit_time) : 0;
      if (!isWebUrl(u) || u.includes('accounts.google.com') || !d) { out.bad++; continue; }
      out.items.push({ u, t: typeof r.title === 'string' ? r.title.slice(0, TITLE_MAX) : '', d });
    }
  } catch {
    out.items = [];
    out.bad++;
  } finally {
    try { db?.close(); } catch { /* уже закрыта */ }
  }
  return out;
}

/** Слияние истории: дубликат — адрес, который уже есть; итог по времени (новые сверху), не больше max. */
export function mergeHistory(existing: ImportVisit[], incoming: ImportVisit[], max: number): { list: ImportVisit[]; added: number; duplicates: number; dropped: number } {
  const seen = new Set(existing.map((v) => v.u));
  const fresh: ImportVisit[] = [];
  let duplicates = 0;
  for (const v of incoming) {
    if (seen.has(v.u)) { duplicates++; continue; }
    seen.add(v.u);
    fresh.push(v);
  }
  const list = [...existing, ...fresh].sort((a, b) => b.d - a.d).slice(0, max);
  const kept = new Set(list);
  const added = fresh.filter((v) => kept.has(v)).length;
  return { list, added, duplicates, dropped: fresh.length - added };
}

export const loginKey = (origin: string, username: string) => `${origin}\n${username}`;

/** Пароли: пара «сайт + логин», которая уже есть, не перезаписывается (пароль в Оси остаётся). */
export function mergeLogins(existingKeys: Set<string>, incoming: ImportLogin[]): { fresh: ImportLogin[]; duplicates: number } {
  const keys = new Set(existingKeys);
  const fresh: ImportLogin[] = [];
  let duplicates = 0;
  for (const l of incoming) {
    const k = loginKey(l.origin, l.username);
    if (keys.has(k)) { duplicates++; continue; }
    keys.add(k);
    fresh.push(l);
  }
  return { fresh, duplicates };
}

/** Закладки: дубликат — адрес уже в избранном или раньше в файле; папка с тем же именем без учёта регистра — та же. */
export function mergeBookmarks(existingUrls: string[], existingFolders: string[], incoming: ImportBookmark[]): { fresh: ImportBookmark[]; folders: string[]; duplicates: number } {
  const urls = new Set(existingUrls);
  const byLower = new Map(existingFolders.map((f) => [f.toLowerCase(), f]));
  const folders: string[] = [];
  const fresh: ImportBookmark[] = [];
  let duplicates = 0;
  for (const b of incoming) {
    if (urls.has(b.url)) { duplicates++; continue; }
    urls.add(b.url);
    let folder = b.folder;
    if (folder) {
      const known = byLower.get(folder.toLowerCase());
      if (known) folder = known;
      else { byLower.set(folder.toLowerCase(), folder); folders.push(folder); }
    }
    fresh.push({ ...b, folder });
  }
  return { fresh, folders, duplicates };
}
