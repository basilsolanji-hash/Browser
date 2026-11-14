import { app, net, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, normalize, sep } from 'node:path';
import { applyEdits, modify, parseTree, type ParseError } from 'jsonc-parser';
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
  /** Закреплено на панели рядом с адресной строкой (как значок-булавка в Chrome). */
  pinned?: boolean;
}

export const extensionsFile = new JsonFile<{ profiles: Record<string, ExtEntry[]> }>('extensions', () => ({ profiles: {} }));

export interface ExtInfo extends ExtEntry {
  popup: string | null;
  options: string | null;
  icon: string | null;
  description: string;
  loaded: boolean;
  error: string | null;
  /** Состояние изменено в памяти, но ещё не подтверждено записью на диск. */
  stateSaveFailed: boolean;
  recovery: 'blocked' | 'ready' | 'failed' | null;
}

export const isExtId = (s: string) => /^[a-p]{32}$/.test(s);

/** ID из ссылки Chrome Web Store (старой или новой) или сам ID. */
export function parseId(input: string): string | null {
  const m = /(?:^|[^a-z])([a-p]{32})(?:$|[^a-z])/.exec(input.trim().toLowerCase());
  return m ? m[1] : null;
}

const root = () => join(app.getPath('userData'), 'extensions');
const dirOf = (profile: number, id: string) => join(root(), String(profile), id);
function extensionDirectoryExists(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Invalid extension directory');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
export const list = (profile: number): ExtEntry[] => extensionsFile.get().profiles[profile] ?? [];
const entry = (profile: number, id: string) => list(profile).find((e) => e.id === id);

/** Ошибки загрузки (неподдерживаемый манифест и т.п.) — показываются на экране расширений. */
const errors = new Map<string, string>();
const loading = new Map<number, Promise<void>>();
// Все операции загрузки и выгрузки в сессии выполняются последовательно.
const sessionOperations = new WeakMap<Session, Promise<void>>();
// Переключения одного расширения выполняются по порядку, включая запросы из разных окон.
const toggling = new Map<string, Promise<void>>();

function serialize<T>(profile: number, id: string, task: () => Promise<T>): Promise<T> {
  const key = `${profile}:${id}`;
  const operation = (toggling.get(key) ?? Promise.resolve()).then(task);
  const settled = operation.then(() => {}, () => {});
  toggling.set(key, settled);
  void settled.then(() => { if (toggling.get(key) === settled) toggling.delete(key); });
  return operation;
}

function serializeSession<T>(ses: Session, task: () => Promise<T>): Promise<T> {
  const operation = (sessionOperations.get(ses) ?? Promise.resolve()).then(task);
  const settled = operation.then(() => {}, () => {});
  sessionOperations.set(ses, settled);
  void settled.then(() => { if (sessionOperations.get(ses) === settled) sessionOperations.delete(ses); });
  return operation;
}

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
      for (const e of list(profile).filter((x) => x.enabled)) await load(ses, profile, e.id);
    })();
    loading.set(profile, p);
  }
  return p;
}

export const ready = (profile: number) => loading.get(profile) ?? Promise.resolve();

async function load(ses: Session, profile: number, id: string): Promise<boolean> {
  return serializeSession(ses, () => loadInSession(ses, profile, id));
}

function recoveryNames(profile: number): string[] {
  // lstat не следует за symlink/junction, включая битые ссылки.
  for (const path of [root(), join(root(), String(profile))]) {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Invalid extension directory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  // Если каталог исчез после lstat, это ошибка, а не пустой список.
  return readdirSync(join(root(), String(profile)));
}

function hasRecoveryCopy(profile: number, id: string, permitted: ReadonlySet<string> = new Set()): boolean {
  return recoveryNames(profile).some((name) =>
    (name.startsWith(`${id}.old-`) || name.startsWith(`${id}.install-`) || name.startsWith(`${id}.ready-`)) && !permitted.has(name));
}

function recoveryState(profile: number, id: string): 'blocked' | 'ready' | 'failed' | null {
  const names = recoveryNames(profile);
  const blocked = names.some((name) => name.startsWith(`${id}.old-`) || name.startsWith(`${id}.install-`));
  const ready = names.filter((name) => name.startsWith(`${id}.ready-`));
  if (blocked || ready.length > 1) return 'blocked';
  if (ready.length === 1) return 'ready';
  return entry(profile, id) && errors.get(`${profile}:${id}`) === 'load' ? 'failed' : null;
}

async function loadInSession(ses: Session, profile: number, id: string, permitted: ReadonlySet<string> = new Set()): Promise<boolean> {
  errors.delete(`${profile}:${id}`);
  let introduced: string | null = null;
  try {
    if (!isExtId(id)) throw new Error('Invalid extension ID');
    // До запуска кода проверить остатки прерванной переустановки, даже если final существует.
    if (hasRecoveryCopy(profile, id, permitted)) {
      if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
      errors.set(`${profile}:${id}`, 'recover');
      return false;
    }
    if (!extensionDirectoryExists(dirOf(profile, id))) throw new Error('Extension directory missing');
    if (ses.extensions.getExtension(id)) return true;
    const alreadyLoaded = new Set(ses.extensions.getAllExtensions().map((ext) => ext.id));
    const ext = await ses.extensions.loadExtension(dirOf(profile, id), { allowFileAccess: false });
    if (!alreadyLoaded.has(ext.id)) introduced = ext.id;
    if (ext.id !== id) {
      throw new Error('Extension ID mismatch');
    }
    // Имя и версия — уже с переводом из _locales, как их показывает Chrome.
    const e = entry(profile, id);
    if (e && (e.name !== ext.name || e.version !== ext.version)) extensionsFile.update(() => { e.name = ext.name; e.version = ext.version; });
    return true;
  } catch {
    if (introduced) {
      try { ses.extensions.removeExtension(introduced); } catch { /* Состояние отображается по загруженной сессии. */ }
    }
    // Даже если проверка каталога не удалась, пытаемся остановить уже загруженный ID.
    try { if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id); } catch { /* Ниже сохраняем ошибку. */ }
    let running = true;
    try { running = !!ses.extensions.getExtension(id); } catch { /* Не заявляем выключение без подтверждения. */ }
    // Ошибка чтения каталога не должна разрешить запуск сомнительного кода.
    let interrupted = true;
    try { interrupted = hasRecoveryCopy(profile, id, permitted); } catch { /* fail closed */ }
    errors.set(`${profile}:${id}`, running ? 'running' : interrupted ? 'recover' : 'load');
    return false;
  }
}

export type InstallResult = { ok: true; id: string; name: string; disabled?: boolean } | { ok: false; error: 'id' | 'network' | 'notfound' | 'bad' | 'load' | 'save' | 'recover' | 'disabled'; detail?: string };

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
    if (!res.ok || (res.url && !res.url.startsWith('https://'))) return { ok: false, error: 'network' };
    if (Number(res.headers.get('content-length') ?? 0) > 200 * 1024 * 1024) return { ok: false, error: 'bad', detail: 'too big' };
    if (!res.body) return { ok: false, error: 'network' };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 200 * 1024 * 1024) {
          await reader.cancel().catch(() => {});
          return { ok: false, error: 'bad', detail: 'too big' };
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    crx = Buffer.concat(chunks, length);
  } catch {
    return { ok: false, error: 'network' };
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
  } catch {
    return { ok: false, error: 'bad' };
  }
  const manifestRaw = files.get('manifest.json');
  if (!manifestRaw) return { ok: false, error: 'bad', detail: 'no manifest' };
  // Ключ в манифесте — чтобы ID распакованного расширения совпал с ID в магазине (как делает Chrome).
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(manifestRaw);
    files.set('manifest.json', Buffer.from(withKey(text, pkg.key.toString('base64'))));
  } catch { return { ok: false, error: 'bad' }; }
  const id = pkg.id;
  return serialize<InstallResult>(profile, id, async () => {
    await ready(profile);
    return serializeSession<InstallResult>(ses, async () => {
    const final = dirOf(profile, id);
    const tmp = `${final}.tmp-${randomUUID()}`;
    const old = `${final}.old-${randomUUID()}`;
    const previous = `${final}.previous-${randomUUID()}`;
    const failed = `${final}.failed-${randomUUID()}`;
    const marker = `${final}.install-${randomUUID()}`;
    const resolved = `${final}.resolved-${randomUUID()}`;
    const prior = entry(profile, id);
    const snapshot = prior ? { ...prior } : null;
    const priorError = errors.get(`${profile}:${id}`);
    const wasLoaded = !!ses.extensions.getExtension(id);
    let readyMarker: string | null = null;
    try {
      const state = recoveryState(profile, id);
      if (state === 'blocked' || state === 'failed') return { ok: false, error: 'recover' };
      if (state === 'ready') {
        const name = recoveryNames(profile).find((n) => n.startsWith(`${id}.ready-`));
        if (!name) return { ok: false, error: 'recover' };
        readyMarker = join(dirname(final), name);
        if (!lstatSync(readyMarker).isDirectory() || snapshot?.enabled || wasLoaded || extensionDirectoryExists(final)) {
          return { ok: false, error: 'recover' };
        }
      }
    }
    catch { return { ok: false, error: 'recover' }; }
    // Проверка загрузкой исполняет код: отключённое расширение нельзя запускать даже временно.
    if (snapshot && !snapshot.enabled && !readyMarker) return { ok: false, error: 'disabled' };
    // Папка без записи может содержать данные, не связанные с этой установкой.
    try { if (!snapshot && extensionDirectoryExists(final)) return { ok: false, error: 'recover' }; }
    catch { return { ok: false, error: 'recover' }; }
    let previousPath: string | null = null;
    let markerCreated = false;
    let readyConsumed = false;
    let installed = false;
    let metadataChanged = false;
    let failure: 'bad' | 'load' | 'save' = 'save';
    try {
      await mkdir(dirname(tmp), { recursive: true });
      // До любого изменения final фиксируем незавершённую установку.
      await mkdir(marker);
      markerCreated = true;
      // mkdir без recursive гарантирует, что случайно не используем чужую папку.
      await mkdir(tmp);
      for (const [name, data] of files) {
        const path = normalize(join(tmp, name));
        if (!path.startsWith(tmp + sep)) throw new CrxError('bad path');
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, data);
      }
      failure = 'load';
      if (wasLoaded) ses.extensions.removeExtension(id);
      if (extensionDirectoryExists(final)) {
        await rename(final, old);
        previousPath = old;
      }
      await rename(tmp, final);
      installed = true;
      extensionsFile.update((d) => {
        const entries = (d.profiles[profile] ??= []);
        const replacement: ExtEntry = {
          id, name: snapshot?.name ?? id, version: snapshot?.version ?? '',
          enabled: readyMarker ? false : (snapshot?.enabled ?? true), time: Date.now(), pinned: entry(profile, id)?.pinned ?? snapshot?.pinned,
        };
        const index = entries.findIndex((item) => item.id === id);
        if (index >= 0) entries[index] = replacement; else entries.push(replacement);
      });
      metadataChanged = true;
      const ownMarkers = new Set([basename(marker), ...(previousPath ? [basename(previousPath)] : [])]);
      // При восстановлении подписанный пакет остаётся выключенным; код не исполняется.
      if (!readyMarker && !(await loadInSession(ses, profile, id, ownMarkers))) throw new Error('Extension load failed');
      failure = 'save';
      extensionsFile.flush();
      // Отдельное имя фиксирует завершённое обновление; прежние файлы сохраняем.
      if (previousPath) { await rename(previousPath, previous); previousPath = previous; }
      if (readyMarker) { await rename(readyMarker, resolved); readyConsumed = true; }
      // Снятие маркера — последний шаг после загрузки и записи метаданных.
      await rmdir(marker);
      markerCreated = false;
      return { ok: true, id, name: entry(profile, id)?.name ?? id, disabled: !!readyMarker };
    } catch (error) {
      if (error instanceof CrxError) failure = 'bad';
      let recovered = true;
      // Незавершённый пакет оставляем отдельно, не удаляя пользовательские файлы.
      if (installed) {
        try {
          if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
          await rename(final, failed);
        } catch { recovered = false; }
      }
      if (previousPath) {
        try {
          if (extensionDirectoryExists(final)) recovered = false;
          else await rename(previousPath, final);
        } catch { recovered = false; }
      }
      if (metadataChanged) {
        try {
          extensionsFile.update((d) => {
            const entries = (d.profiles[profile] ??= []);
            const index = entries.findIndex((item) => item.id === id);
            if (snapshot) {
              const pinned = index >= 0 ? entries[index].pinned : snapshot.pinned;
              const restored = { ...snapshot, pinned, enabled: recovered ? snapshot.enabled : false };
              if (index >= 0) entries[index] = restored; else entries.push(restored);
            } else if (index >= 0) entries.splice(index, 1);
          });
          extensionsFile.flush();
        } catch { extensionsFile.retry(); recovered = false; }
      }
      if (readyMarker && readyConsumed) {
        try { await rename(resolved, readyMarker); } catch { recovered = false; }
      }
      if (wasLoaded && recovered && snapshot?.enabled) {
        if (!(await loadInSession(ses, profile, id, new Set(markerCreated ? [basename(marker)] : [])))) recovered = false;
      }
      if (markerCreated && recovered) {
        try { await rmdir(marker); markerCreated = false; }
        catch { recovered = false; }
      }
      if (!recovered) errors.set(`${profile}:${id}`, 'recover');
      else if (priorError) errors.set(`${profile}:${id}`, priorError);
      else errors.delete(`${profile}:${id}`);
      return { ok: false, error: recovered ? failure : 'recover' };
    }
    });
  });
}

function withKey(text: string, key: string): string {
  const clean = text.replace(/^\uFEFF/, '');
  const errors: ParseError[] = [];
  const tree = parseTree(clean, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || tree?.type !== 'object') throw new Error('Invalid extension manifest');
  // Повторные ключи неоднозначны; не оставляем возможность загрузить другой ID.
  if ((tree.children ?? []).filter((p) => p.children?.[0]?.value === 'key').length > 1) {
    throw new Error('Duplicate extension key');
  }
  const output = applyEdits(clean, modify(clean, ['key'], key, {}));
  const resultErrors: ParseError[] = [];
  const result = parseTree(output, resultErrors, { allowTrailingComma: true, disallowComments: false });
  const keys = (result?.children ?? []).filter((p) => p.children?.[0]?.value === 'key');
  if (resultErrors.length || result?.type !== 'object' || keys.length !== 1 || keys[0].children?.[1]?.value !== key) {
    throw new Error('Invalid extension key');
  }
  return output;
}

export async function setEnabled(ses: Session, profile: number, id: string, on: boolean): Promise<boolean> {
  const key = `${profile}:${id}`;
  return serialize(profile, id, async () => {
    await ready(profile);
    return serializeSession(ses, async () => {
    const e = entry(profile, id);
    if (!e) {
      // Запись может отсутствовать после прерванной установки, но код ещё загружен.
      if (on || !hasRecoveryCopy(profile, id)) return false;
      if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
      if (ses.extensions.getExtension(id)) { errors.set(key, 'running'); return false; }
      errors.delete(key);
      return true;
    }
    if (on) {
      if (!(await loadInSession(ses, profile, id))) {
        extensionsFile.update(() => { e.enabled = !!ses.extensions.getExtension(id); });
        try { extensionsFile.flush(); } catch { extensionsFile.retry(); }
        return false;
      }
      extensionsFile.update(() => { e.enabled = true; });
      try { extensionsFile.flush(); return true; } catch { extensionsFile.retry(); return false; }
    }
    if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
    if (ses.extensions.getExtension(id)) {
      errors.set(key, 'running');
      return false;
    }
    extensionsFile.update(() => { e.enabled = false; });
    errors.delete(key);
    try { extensionsFile.flush(); return true; } catch { extensionsFile.retry(); return false; }
    });
  });
}

export function setPinned(profile: number, id: string, on: boolean): boolean {
  const e = entry(profile, id);
  if (!e) return false;
  extensionsFile.update(() => { e.pinned = on; });
  return true;
}

export async function remove(ses: Session, profile: number, id: string): Promise<void> {
  await serialize(profile, id, async () => {
    await ready(profile);
    await serializeSession(ses, async () => {
    // Незавершённое обновление требует отдельного восстановления файлов.
    if (hasRecoveryCopy(profile, id)) throw new Error('Extension recovery required');
    const existing = entry(profile, id);
    if (!existing) return;
    const snapshot = { ...existing };
    const index = list(profile).findIndex((item) => item.id === id);
    extensionsFile.update((d) => { d.profiles[profile] = (d.profiles[profile] ?? []).filter((e) => e.id !== id); });
    try {
      // Сначала сохраняем удаление списка, лишь затем затрагиваем файлы расширения.
      extensionsFile.flush();
      if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
    } catch {
      // Сбой записи или выгрузки: возвращаем запись и сохраняем её повторно.
      extensionsFile.update((d) => {
        const entries = (d.profiles[profile] ??= []);
        if (!entries.some((item) => item.id === id)) entries.splice(Math.max(0, index), 0, snapshot);
      });
      try { extensionsFile.flush(); } catch { extensionsFile.retry(); }
      throw new Error('Extension removal could not be saved');
    }
    errors.delete(`${profile}:${id}`);
    // Если файл занят, сообщаем об этом; автоматическая очистка не удаляет данные.
    try { await rm(dirOf(profile, id), { recursive: true, force: true, maxRetries: 3 }); }
    catch { throw new Error('Extension files may remain'); }
    });
  });
}

/** Подготовить переустановку после сбоя, сохранив все обнаруженные каталоги. */
export async function prepareRecovery(ses: Session, profile: number, id: string): Promise<void> {
  await serialize(profile, id, async () => {
    await ready(profile);
    await serializeSession(ses, async () => {
      const state = recoveryState(profile, id);
      if (state !== 'blocked' && state !== 'failed') throw new Error('No recovery needed');
      const parent = join(root(), String(profile));
      for (const path of [root(), parent]) {
        try { await mkdir(path); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const stat = lstatSync(path);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Invalid extension directory');
      }
      const names = recoveryNames(profile).filter((name) => name === id ||
        ['old', 'install', 'ready', 'tmp', 'failed'].some((kind) => name.startsWith(`${id}.${kind}-`)));
      // Перемещаем только каталоги без символических ссылок и не принимаем пути из интерфейса.
      for (const name of names) if (!lstatSync(join(parent, name)).isDirectory()) throw new Error('Invalid recovery entry');
      const marker = join(parent, `${id}.install-${randomUUID()}`);
      const archive = join(parent, `${id}.quarantine-${randomUUID()}`);
      const prepared = join(parent, `${id}.ready-${randomUUID()}`);
      await mkdir(marker);
      // Прежде чем обещать выключение, фактически выгружаем код. При любой
      // ошибке защитный маркер остаётся; файлы не перемещаются и не удаляются.
      if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
      if (ses.extensions.getExtension(id)) throw new Error('Extension remained loaded');
      // Затем фиксируем выключенное состояние; при ошибке маркер остаётся.
      const saved = entry(profile, id);
      if (saved) {
        extensionsFile.update(() => { saved.enabled = false; });
        try { extensionsFile.flush(); } catch { extensionsFile.retry(); throw new Error('Recovery state not saved'); }
      }
      if (names.length) {
        await mkdir(archive);
        for (const name of names) await rename(join(parent, name), join(archive, name));
      }
      // После прерывания .install останется и продолжит запрещать запуск.
      await rename(marker, prepared);
      errors.delete(`${profile}:${id}`);
    });
  });
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
    if (!path || !/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) continue;
    try {
      if (statSync(path).size > 256 * 1024) continue;
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
      const type = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return `data:${type};base64,${readFileSync(path).toString('base64')}`;
    } catch { /* Недоступный значок не должен скрывать список расширений. */ }
  }
  return null;
}

/** Текст из _locales для полей вида «__MSG_name__» (для описания; имя берём у Chromium). */
function localized(profile: number, id: string, m: Record<string, unknown>, value: unknown, lang: string): string {
  const s = typeof value === 'string' ? value : '';
  const key = /^__MSG_(\w+)__$/.exec(s)?.[1];
  if (!key) return s;
  for (const loc of [lang, String(m.default_locale ?? 'en'), 'en']) {
    // Locale из манифеста не должен выходить за пределы папки _locales.
    if (!/^[A-Za-z0-9_-]+$/.test(loc)) continue;
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
  const entries = [...list(profile)];
  // После прерванной первой установки запись в extensions.json может отсутствовать.
  for (const name of recoveryNames(profile)) {
    const id = name.slice(0, 32);
    if (isExtId(id) && (name.startsWith(`${id}.install-`) || name.startsWith(`${id}.old-`) || name.startsWith(`${id}.ready-`)) && !entries.some((e) => e.id === id)) {
      entries.push({ id, name: id, version: '', enabled: false, time: 0 });
    }
  }
  return entries.map((e) => {
    if (!isExtId(e.id)) throw new Error('Invalid extension ID');
    extensionDirectoryExists(dirOf(profile, e.id));
    const loaded = ses.extensions.getExtension(e.id);
    const m = loaded ? loaded.manifest as unknown as Record<string, unknown> : manifestOf(profile, e.id);
    const action = (m.action ?? m.browser_action) as { default_popup?: unknown } | undefined;
    const optionsUi = m.options_ui as { page?: unknown } | undefined;
    return {
      ...e,
      popup: pageOf(profile, e.id, action?.default_popup),
      options: pageOf(profile, e.id, optionsUi?.page ?? m.options_page),
      icon: iconOf(profile, e.id, m),
      description: localized(profile, e.id, m, m.description, lang).slice(0, 300),
      loaded: !!loaded,
      error: errors.get(`${profile}:${e.id}`) ?? null,
      stateSaveFailed: extensionsFile.hasWriteFailure(),
      recovery: recoveryState(profile, e.id),
    };
  });
}

/** Адрес страницы расширения (всплывающее окно или параметры) — только загруженного и только из манифеста. */
export function pageUrl(ses: Session, profile: number, id: string, which: 'popup' | 'options'): string | null {
  const ext = ses.extensions.getExtension(id);
  if (!ext || !entry(profile, id)) return null;
  const x = info(ses, profile, 'en').find((e) => e.id === id);
  if (x?.recovery || x?.error === 'recover' || x?.error === 'running') return null;
  const rel = which === 'popup' ? x?.popup : x?.options;
  return rel ? `chrome-extension://${id}/${rel}` : null;
}

/** Файлы расширения для приёмки: удалено ли с диска. */
export const hasFiles = (profile: number, id: string) => existsSync(dirOf(profile, id));
