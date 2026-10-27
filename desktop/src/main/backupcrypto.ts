import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

/**
 * Формат паролей и резервной копии — один в один как Passwords.kt и Backup.kt Android-версии,
 * чтобы файл .osbackup переносился между телефоном и компьютером. Без electron: покрыт юнит-тестами.
 */

/** Сохранённый вход: g — id, o — «https://example.com», u — логин, p — пароль, t — время (мс). */
export interface Login { g: string; o: string; u: string; p: string; t: number }
/** Набор вкладок (TabSets в Backup.kt): n — название, t — когда сохранён. */
export interface TabSet { id: string; n: string; t: number; tabs: { title: string; url: string }[] }
export interface BackupFavorite { title: string; url: string; folder: string }
export interface BackupNote { text: string; url: string }

/** Содержимое копии (поле data после расшифровки). */
export interface BackupData {
  v: number;
  name: string;
  desc: string;
  passwords: Login[];
  tabSets: TabSet[];
  favorites: BackupFavorite[];
  notes: BackupNote[];
}

/** Копия всех профилей одним файлом (Backup.collectAll): {"v":2,"profiles":[{"id":N,"data":{…}}]}. */
export interface BackupAll { v: 2; profiles: { id: number; data: BackupData }[] }
export type BackupFile = BackupData | BackupAll;
export const isAll = (x: BackupFile): x is BackupAll => x.v === 2 && Array.isArray((x as BackupAll).profiles);

/** Новые копии: формат файла v2 с полем iter (решение владельца 27.10, синхронно с Android). */
export const ITERATIONS = 600_000;
/** Копии v1 (без поля iter) шифровались так — их по-прежнему открываем. */
export const ITERATIONS_V1 = 120_000;
/** Границы iter из файла: ниже — слабо, выше — расшифровка зависнет на минуты. */
const ITER_MIN = 100_000;
const ITER_MAX = 5_000_000;
export const MIN_PASSWORD = 6;

/** Как Passwords.originOf: схема http/https (иначе https), хост в нижнем регистре, порт — если указан. */
export function originOf(url: string): string | null {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (!host) return null;
  const scheme = u.protocol === 'http:' ? 'http' : 'https';
  return `${scheme}://${host}${u.port ? ':' + u.port : ''}`;
}

export function hostOf(origin: string): string {
  try { return new URL(origin).hostname.toLowerCase(); } catch { return ''; }
}

/** Как Passwords.forDomain: тот же хост, его поддомен или родительский домен (без www.). */
export function sameSite(origin: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '');
  const host = hostOf(origin).replace(/^www\./, '');
  if (!host || !d) return false;
  return host === d || host.endsWith('.' + d) || d.endsWith('.' + host);
}

let seq = 0;
export function newGuid(): string {
  const now = Date.now();
  seq = now > seq ? now : seq + 1;
  return `os-${seq}`;
}

/** Добавить или обновить: тот же guid или тот же сайт с тем же логином. null — сайт не распознан. */
export function upsert(list: Login[], origin: string, username: string, password: string, guid: string | null = null): Login[] | null {
  const site = originOf(origin);
  if (!site) return null;
  const out = [...list];
  const i = out.findIndex((l) => (guid != null && l.g === guid) || (l.o === site && l.u === username));
  const login: Login = { g: i >= 0 ? out[i].g : (guid ?? newGuid()), o: site, u: username, p: password, t: Date.now() };
  if (i >= 0) out[i] = login;
  else out.push(login);
  return out;
}

// --- Шифрование копии ---

const b64 = (b: Buffer) => b.toString('base64');

function key(password: string, salt: Buffer, iter: number): Buffer {
  // PBEKeySpec(char[]) в Java → UTF-8 байты пароля; длина ключа 256 бит.
  return pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iter, 32, 'sha256');
}

/** Число итераций по заголовку файла: v1 — 120 000, v2 — поле iter. null — файл не наш или iter вне границ. */
export function iterationsOf(o: Record<string, unknown>): number | null {
  if (o.v === 1 && o.iter === undefined) return ITERATIONS_V1;
  if (o.v !== 2) return null;
  const n = o.iter;
  return typeof n === 'number' && Number.isInteger(n) && n >= ITER_MIN && n <= ITER_MAX ? n : null;
}

/** {"app":"os-browser","v":2,"iter":600000,"salt","iv","data"}; data — AES-256-GCM, тег (16 байт) в конце, как в Java. */
export function encrypt(data: BackupFile, password: string, salt = randomBytes(16), iv = randomBytes(12)): string {
  const c = createCipheriv('aes-256-gcm', key(password, salt, ITERATIONS), iv);
  const body = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final(), c.getAuthTag()]);
  return JSON.stringify({ app: 'os-browser', v: 2, iter: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(body) });
}

/** null — неверный пароль или повреждённый файл. */
export function decrypt(file: string, password: string): BackupFile | null {
  try {
    const o = JSON.parse(file) as Record<string, unknown>;
    if (typeof o.salt !== 'string' || typeof o.iv !== 'string' || typeof o.data !== 'string') return null;
    const iter = iterationsOf(o);
    if (iter == null) return null;
    const salt = Buffer.from(o.salt, 'base64');
    const iv = Buffer.from(o.iv, 'base64');
    const raw = Buffer.from(o.data, 'base64');
    if (iv.length !== 12 || raw.length < 17) return null;
    const d = createDecipheriv('aes-256-gcm', key(password, salt, iter), iv);
    d.setAuthTag(raw.subarray(raw.length - 16));
    const text = Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8');
    return normalizeFile(JSON.parse(text));
  } catch {
    return null;
  }
}

const s = (x: unknown) => (typeof x === 'string' ? x : '');
const arr = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((i) => i && typeof i === 'object') : []);

/** v2 (все профили) или v1 (один профиль), как Backup.applyAny: есть массив profiles — значит v2. */
export function normalizeFile(o: unknown): BackupFile | null {
  if (!o || typeof o !== 'object') return null;
  const all = (o as Record<string, unknown>).profiles;
  if (!Array.isArray(all)) return normalize(o);
  const profiles: BackupAll['profiles'] = [];
  for (const p of arr(all)) {
    const id = Math.trunc(Number(p.id));
    const data = normalize(p.data);
    if (Number.isInteger(id) && id > 0 && data) profiles.push({ id, data });
  }
  return { v: 2, profiles };
}

/** Привести расшифрованный JSON к типам (как optString/optJSONArray в Android): лишнее отбрасываем. */
export function normalize(o: unknown): BackupData | null {
  if (!o || typeof o !== 'object') return null;
  const d = o as Record<string, unknown>;
  return {
    v: Number(d.v) || 1,
    name: s(d.name),
    desc: s(d.desc),
    passwords: arr(d.passwords).filter((l) => s(l.o) && typeof l.p === 'string')
      .map((l) => ({ g: s(l.g), o: s(l.o), u: s(l.u), p: s(l.p), t: Number(l.t) || 0 })),
    tabSets: arr(d.tabSets).filter((x) => s(x.id))
      .map((x) => ({ id: s(x.id), n: s(x.n), t: Number(x.t) || 0, tabs: arr(x.tabs).filter((tb) => s(tb.url)).map((tb) => ({ title: s(tb.title), url: s(tb.url) })) })),
    favorites: arr(d.favorites).map((f) => ({ title: s(f.title), url: s(f.url), folder: s(f.folder) })),
    notes: arr(d.notes).map((n) => ({ text: s(n.text), url: s(n.url) })),
  };
}

// --- Восстановление: добавить недостающее без дублей ---

export interface Current {
  name: string;
  desc: string;
  logins: Login[];
  tabSets: TabSet[];
  favoriteUrls: string[];
  notes: BackupNote[];
}

export interface MergeResult {
  /** Новое имя и описание профиля — только если своих не было. */
  name: string | null;
  desc: string | null;
  /** Входы, которых нет или у которых другой пароль: их добавить (обновить) по сайту и логину. */
  logins: Login[];
  /** Наборы вкладок, которых ещё нет. */
  tabSets: TabSet[];
  favorites: BackupFavorite[];
  notes: BackupNote[];
  counts: { passwords: number; tabSets: number; favorites: number; notes: number };
}

/** Что добавить из копии: пароли — по сайту и логину, наборы — по id, избранное — по адресу, заметки — по тексту и адресу. */
export function merge(cur: Current, data: BackupData): MergeResult {
  let all = cur.logins;
  const logins: Login[] = [];
  for (const l of data.passwords) {
    const site = originOf(l.o);
    if (!site || all.some((x) => x.o === site && x.u === l.u && x.p === l.p)) continue;
    all = upsert(all, site, l.u, l.p) ?? all;
    // В копии один сайт+логин может встретиться дважды — берём последний.
    const i = logins.findIndex((x) => x.o === site && x.u === l.u);
    if (i >= 0) logins.splice(i, 1);
    logins.push({ ...l, o: site });
  }
  const tabSets: TabSet[] = [];
  for (const x of data.tabSets) {
    if (!x.tabs.length || [...cur.tabSets, ...tabSets].some((y) => y.id === x.id)) continue;
    tabSets.push(x);
  }
  const urls = new Set(cur.favoriteUrls);
  const favorites: BackupFavorite[] = [];
  for (const f of data.favorites) {
    if (!f.url.trim() || urls.has(f.url)) continue;
    urls.add(f.url);
    favorites.push(f);
  }
  const have = new Set(cur.notes.map((n) => n.text + '\u0000' + n.url));
  const notes: BackupNote[] = [];
  for (const n of data.notes) {
    const k = n.text + '\u0000' + n.url;
    if (!n.text.trim() || have.has(k)) continue;
    have.add(k);
    notes.push(n);
  }
  return {
    name: !cur.name && data.name.trim() ? data.name : null,
    desc: !cur.desc && data.desc.trim() ? data.desc : null,
    logins, tabSets, favorites, notes,
    counts: { passwords: logins.length, tabSets: tabSets.length, favorites: favorites.length, notes: notes.length },
  };
}
