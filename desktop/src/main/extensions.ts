import { app, net, type Session } from 'electron';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { JsonFile } from './store';
import { CrxError, unzip, verifyCrx } from './crx';
import { profileCount } from './settings';

/**
 * Расширения Chrome — у каждого профиля свой набор (session.extensions партиции профиля), в инкогнито
 * их нет. Установка — из Chrome Web Store по ссылке или ID, только по нажатию пользователя; фоновых
 * проверок обновлений нет. Файлы: userData/extensions/<профиль>/<id>/, список — extensions.json.
 * Electron поддерживает только часть API расширений (нет chrome.action, declarativeNetRequest и др.).
 */
export interface ExtEntry {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  time: number;
}

export const extensionsFile = new JsonFile<{ profiles: Record<string, ExtEntry[]> }>('extensions', () => ({ profiles: {} }));

export interface ExtInfo extends ExtEntry {
  popup: string | null;
  options: string | null;
  icon: string | null;
  description: string;
  loaded: boolean;
  error: string | null;
}

export const isExtId = (s: string) => /^[a-p]{32}$/.test(s);

/** ID из ссылки Chrome Web Store (старой или новой) или сам ID. */
export function parseId(input: string): string | null {
  const m = /(?:^|[^a-z])([a-p]{32})(?:$|[^a-z])/.exec(input.trim().toLowerCase());
  return m ? m[1] : null;
}

const root = () => join(app.getPath('userData'), 'extensions');
const dirOf = (profile: number, id: string) => join(root(), String(profile), id);
export const list = (profile: number): ExtEntry[] => extensionsFile.get().profiles[profile] ?? [];
const entry = (profile: number, id: string) => list(profile).find((e) => e.id === id);

/** Ошибки загрузки (неподдерживаемый манифест и т.п.) — показываются на экране расширений. */
const errors = new Map<string, string>();
const loading = new Map<number, Promise<void>>();

/** Профили, у которых есть включённые расширения: их сессии поднимаются при старте. */
export function profilesInUse(): number[] {
  return Object.entries(extensionsFile.get().profiles)
    .filter(([p, l]) => Number(p) <= profileCount() && l.some((e) => e.enabled)).map(([p]) => Number(p));
}

/** Сессия профиля создана: загрузить его включённые расширения (каждый запуск заново). */
export function attach(ses: Session, profile: number): Promise<void> {
  let p = loading.get(profile);
  if (!p) {
    p = (async () => {
      cleanup(profile);
      for (const e of list(profile).filter((x) => x.enabled)) await load(ses, profile, e.id);
    })();
    loading.set(profile, p);
  }
  return p;
}

export const ready = (profile: number) => loading.get(profile) ?? Promise.resolve();

async function load(ses: Session, profile: number, id: string): Promise<boolean> {
  errors.delete(`${profile}:${id}`);
  if (ses.extensions.getExtension(id)) return true;
  try {
    const ext = await ses.extensions.loadExtension(dirOf(profile, id), { allowFileAccess: false });
    // Имя и версия — уже с переводом из _locales, как их показывает Chrome.
    const e = entry(profile, id);
    if (e && (e.name !== ext.name || e.version !== ext.version)) extensionsFile.update(() => { e.name = ext.name; e.version = ext.version; });
    return true;
  } catch (err) {
    errors.set(`${profile}:${id}`, String((err as Error).message ?? err).slice(0, 300));
    console.error('[extensions] load', profile, id, err);
    return false;
  }
}

/** Остатки прерванной установки или удаления (папки не из списка) стираем при старте. */
function cleanup(profile: number): void {
  const dir = join(root(), String(profile));
  if (!existsSync(dir)) return;
  const keep = new Set(list(profile).map((e) => e.id));
  for (const name of readdirSync(dir)) {
    if (!keep.has(name)) void rm(join(dir, name), { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

export type InstallResult = { ok: true; id: string; name: string } | { ok: false; error: 'id' | 'network' | 'notfound' | 'bad' | 'load'; detail?: string };

/** Установить из Chrome Web Store: скачать CRX по HTTPS, проверить подпись, распаковать, загрузить. */
export async function installFromStore(ses: Session, profile: number, input: string): Promise<InstallResult> {
  const id = parseId(input);
  if (!id) return { ok: false, error: 'id' };
  const url = 'https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx3' +
    `&prodversion=${encodeURIComponent(process.versions.chrome)}&x=${encodeURIComponent(`id=${id}&installsource=ondemand&uc`)}`;
  let crx: Buffer;
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(90_000), cache: 'no-store' });
    if (res.status === 204 || res.status === 404) return { ok: false, error: 'notfound' };
    // Адрес ответа после переадресаций (если Electron его сообщает) — тоже только HTTPS; целостность даёт подпись CRX.
    if (!res.ok || (res.url && !res.url.startsWith('https://'))) return { ok: false, error: 'network', detail: `HTTP ${res.status} ${res.url}` };
    if (Number(res.headers.get('content-length') ?? 0) > 200 * 1024 * 1024) return { ok: false, error: 'bad', detail: 'too big' };
    crx = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.error('[extensions] download', id, e);
    return { ok: false, error: 'network', detail: String((e as Error).message ?? e) };
  }
  if (!crx.length) return { ok: false, error: 'notfound' };
  return installCrx(ses, profile, crx, id);
}

/** Установить из пакета CRX3 (скачанного из магазина; в приёмке — собранного тестом). */
export async function installCrx(ses: Session, profile: number, crx: Buffer, expectedId: string | null): Promise<InstallResult> {
  let pkg: ReturnType<typeof verifyCrx>;
  let files: Map<string, Buffer>;
  try {
    pkg = verifyCrx(crx, expectedId);
    files = unzip(pkg.zip);
  } catch (e) {
    if (!(e instanceof CrxError)) console.error('[extensions] crx', e);
    return { ok: false, error: 'bad', detail: String((e as Error).message ?? e) };
  }
  const manifestRaw = files.get('manifest.json');
  if (!manifestRaw) return { ok: false, error: 'bad', detail: 'no manifest' };
  // Ключ в манифесте — чтобы ID распакованного расширения совпал с ID в магазине (как делает Chrome).
  files.set('manifest.json', Buffer.from(withKey(manifestRaw.toString('utf8'), pkg.key.toString('base64'))));
  const id = pkg.id;
  const final = dirOf(profile, id);
  const tmp = `${final}.tmp-${Date.now()}`;
  try {
    for (const [name, data] of files) {
      const path = normalize(join(tmp, name));
      if (!path.startsWith(tmp + sep)) throw new CrxError('bad path');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    }
  } catch (e) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    return { ok: false, error: 'bad', detail: String((e as Error).message ?? e) };
  }
  // Переустановка (обновление вручную): старую версию выгружаем и заменяем.
  if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
  if (existsSync(final)) {
    const old = `${final}.old-${Date.now()}`;
    await rename(final, old);
    void rm(old, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
  await rename(tmp, final);
  const prev = entry(profile, id);
  extensionsFile.update((d) => {
    const l = (d.profiles[profile] ??= []);
    const e: ExtEntry = { id, name: prev?.name ?? id, version: prev?.version ?? '', enabled: true, time: Date.now() };
    if (prev) Object.assign(prev, e);
    else l.push(e);
  });
  if (!(await load(ses, profile, id))) {
    return { ok: false, error: 'load', detail: errors.get(`${profile}:${id}`) };
  }
  return { ok: true, id, name: entry(profile, id)?.name ?? id };
}

function withKey(text: string, key: string): string {
  const clean = text.replace(/^\uFEFF/, '');
  try {
    const m = JSON.parse(clean) as Record<string, unknown>;
    m.key = key;
    return JSON.stringify(m, null, 2);
  } catch {
    // В манифесте бывают комментарии (Chrome их допускает) — тогда вставляем ключ первым полем.
    const i = clean.indexOf('{');
    return i < 0 ? clean : `${clean.slice(0, i + 1)}"key":${JSON.stringify(key)},${clean.slice(i + 1)}`;
  }
}

export async function setEnabled(ses: Session, profile: number, id: string, on: boolean): Promise<boolean> {
  const e = entry(profile, id);
  if (!e) return false;
  extensionsFile.update(() => { e.enabled = on; });
  if (on) return load(ses, profile, id);
  if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
  errors.delete(`${profile}:${id}`);
  return true;
}

export async function remove(ses: Session, profile: number, id: string): Promise<void> {
  if (!entry(profile, id)) return;
  if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
  extensionsFile.update((d) => { d.profiles[profile] = (d.profiles[profile] ?? []).filter((e) => e.id !== id); });
  errors.delete(`${profile}:${id}`);
  // Если файл ещё занят, папку сотрёт очистка при следующем запуске.
  await rm(dirOf(profile, id), { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}

function manifestOf(profile: number, id: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(dirOf(profile, id), 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Путь файла внутри папки расширения (страница или значок из манифеста) или null. */
function inside(profile: number, id: string, rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel) return null;
  const base = dirOf(profile, id);
  const path = normalize(join(base, rel.replace(/^\//, '').split(/[?#]/)[0]));
  return path.startsWith(base + sep) && existsSync(path) ? path : null;
}

const pageOf = (profile: number, id: string, rel: unknown) => (inside(profile, id, rel) ? String(rel).replace(/^\//, '') : null);

/** Значок для списка и меню — data: (интерфейс не ходит на chrome-extension://). */
function iconOf(profile: number, id: string, m: Record<string, unknown>): string | null {
  const action = (m.action ?? m.browser_action) as { default_icon?: unknown } | undefined;
  const sets = [m.icons, action?.default_icon];
  for (const set of sets) {
    let rel: unknown = null;
    if (typeof set === 'string') rel = set;
    else if (set && typeof set === 'object') {
      const sizes = Object.keys(set).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
      const best = sizes.find((n) => n >= 32) ?? sizes[sizes.length - 1];
      rel = best != null ? (set as Record<string, unknown>)[String(best)] : null;
    }
    const path = inside(profile, id, rel);
    if (!path || !/\.(png|jpe?g|gif|webp|svg)$/i.test(path) || statSync(path).size > 256 * 1024) continue;
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    const type = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return `data:${type};base64,${readFileSync(path).toString('base64')}`;
  }
  return null;
}

/** Текст из _locales для полей вида «__MSG_name__» (для описания; имя берём у Chromium). */
function localized(profile: number, id: string, m: Record<string, unknown>, value: unknown, lang: string): string {
  const s = typeof value === 'string' ? value : '';
  const key = /^__MSG_(\w+)__$/.exec(s)?.[1];
  if (!key) return s;
  for (const loc of [lang, String(m.default_locale ?? 'en'), 'en']) {
    try {
      const msgs = JSON.parse(readFileSync(join(dirOf(profile, id), '_locales', loc, 'messages.json'), 'utf8').replace(/^\uFEFF/, '')) as Record<string, { message?: string }>;
      const hit = Object.entries(msgs).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1]?.message;
      if (hit) return hit;
    } catch {
      // нет такого языка
    }
  }
  return '';
}

export function info(ses: Session, profile: number, lang: string): ExtInfo[] {
  return list(profile).map((e) => {
    const m = manifestOf(profile, e.id);
    const action = (m.action ?? m.browser_action) as { default_popup?: unknown } | undefined;
    const optionsUi = m.options_ui as { page?: unknown } | undefined;
    return {
      ...e,
      popup: pageOf(profile, e.id, action?.default_popup),
      options: pageOf(profile, e.id, optionsUi?.page ?? m.options_page),
      icon: iconOf(profile, e.id, m),
      description: localized(profile, e.id, m, m.description, lang).slice(0, 300),
      loaded: !!ses.extensions.getExtension(e.id),
      error: errors.get(`${profile}:${e.id}`) ?? null,
    };
  });
}

/** Адрес страницы расширения (всплывающее окно или параметры) — только загруженного и только из манифеста. */
export function pageUrl(ses: Session, profile: number, id: string, which: 'popup' | 'options'): string | null {
  const ext = ses.extensions.getExtension(id);
  if (!ext || !entry(profile, id)) return null;
  const x = info(ses, profile, 'en').find((e) => e.id === id);
  const rel = which === 'popup' ? x?.popup : x?.options;
  return rel ? `chrome-extension://${id}/${rel}` : null;
}

/** Файлы расширения для приёмки: удалено ли с диска. */
export const hasFiles = (profile: number, id: string) => existsSync(dirOf(profile, id));
