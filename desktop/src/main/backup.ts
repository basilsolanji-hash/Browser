import { dialog, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as Passwords from './passwords';
import * as TabSets from './tabsets';
import * as Bookmarks from './bookmarks';
import * as Notes from './notes';
import * as Profiles from './profiles';
import { backupPasswordOk } from '../shared/pwgen';
import { type BackupAll, type BackupData, type BackupFile, decrypt, encrypt, isAll, merge, originOf } from './backupcrypto';
import { profileCount } from './settings';

/**
 * Резервная копия профиля в файл .osbackup (Backup.kt): пароли, наборы вкладок, избранное, заметки,
 * имя и описание. Зашифрована паролем пользователя; никуда не отправляется — файл выбирает пользователь.
 */
export type Restored = { passwords: number; tabSets: number; favorites: number; notes: number };

/** Для приёмки: путь вместо диалога выбора файла (osTest.backupPath). */
let testPath: string | null = null;
export const setTestPath = (p: string | null) => { testPath = p; };

export function collect(profile: number): BackupData {
  return {
    v: 1,
    name: Profiles.customName(profile),
    desc: Profiles.description(profile),
    passwords: Passwords.listForBackup(profile),
    tabSets: TabSets.list(profile),
    favorites: Bookmarks.all().map((b) => ({ title: b.t, url: b.u, folder: b.f })),
    notes: Notes.all().map((n) => ({ text: n.text, url: n.source })),
  };
}

/** Проверить пароли до изменения каких-либо данных профиля. */
function preflightPasswords(profile: number, data: BackupData): void {
  Passwords.listForBackup(profile);
  if (data.passwords.length && !Passwords.available()) throw new Error('Password encryption unavailable');
  if (data.passwords.some((l) => !originOf(l.o) || !l.p)) throw new Error('Invalid backup login');
}

/** Добавить данные из копии в профиль; уже имеющееся не дублируется. */
export function apply(profile: number, data: BackupData): Restored {
  preflightPasswords(profile, data);
  const r = merge({
    name: Profiles.customName(profile),
    desc: Profiles.description(profile),
    logins: Passwords.listForBackup(profile),
    tabSets: TabSets.list(profile),
    favoriteUrls: Bookmarks.all().map((b) => b.u),
    notes: Notes.all().map((n) => ({ text: n.text, url: n.source })),
  }, data);
  if (r.name) Profiles.rename(profile, r.name);
  if (r.desc) Profiles.setDescription(profile, r.desc);
  let passwords = 0;
  for (const l of r.logins) {
    if (!Passwords.upsert(profile, l.o, l.u, l.p)) throw new Error('Password restore failed');
    passwords++;
  }
  r.tabSets.forEach((s) => TabSets.add(profile, s));
  for (const f of r.favorites) {
    if (f.folder) Bookmarks.addFolder(f.folder);
    Bookmarks.add(f.title, f.url, f.folder);
  }
  for (const n of r.notes) Notes.save(null, n.text, n.url);
  return { ...r.counts, passwords };
}

/** Копия всех профилей одним файлом (Backup.collectAll). */
export const collectAll = (): BackupAll => ({ v: 2, profiles: Profiles.order().map((id) => ({ id, data: collect(id) })) });

/** v2 — в профили с теми же номерами (если такие есть), v1 — в [profile] (Backup.applyAny). */
export function applyAny(profile: number, file: BackupFile): Restored {
  if (!isAll(file)) {
    preflightPasswords(profile, file);
    return apply(profile, file);
  }
  for (const p of file.profiles) {
    if (p.id < 1 || p.id > profileCount()) throw new Error('Backup profile unavailable');
    preflightPasswords(p.id, p.data);
  }
  const sum: Restored = { passwords: 0, tabSets: 0, favorites: 0, notes: 0 };
  for (const p of file.profiles) {
    if (p.id < 1 || p.id > profileCount()) continue;
    const r = apply(p.id, p.data);
    sum.passwords += r.passwords; sum.tabSets += r.tabSets; sum.favorites += r.favorites; sum.notes += r.notes;
  }
  return sum;
}

const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

/** Записать копию рядом с выбранным файлом, заменяя его только после успешной записи. */
async function writeBackup(path: string, content: string): Promise<void> {
  const temporary = join(dirname(path), `.osbackup-${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  let renamed = false;
  try {
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    renamed = true;
  } finally {
    // Удаляем только собственный временный файл; существующая копия не трогается.
    if (!renamed) await rm(temporary, { force: true }).catch(() => {});
  }
}

/** profile 0 — все профили. 'ok' | 'cancel' | 'short' | 'error'. */
export async function exportTo(win: BrowserWindow, profile: number, password: string): Promise<string> {
  // Новые копии — только с надёжным паролем; открыть старую (от 6 символов) по-прежнему можно.
  if (!backupPasswordOk(password)) return 'short';
  const name = profile === 0 ? 'all-profiles' : Profiles.name(profile).replace(/[^\p{L}\p{N}]/gu, '') || 'profile';
  let path = testPath;
  if (!path) {
    const res = await dialog.showSaveDialog(win, {
      defaultPath: `os-${name}-${stamp()}.osbackup`,
      filters: [{ name: 'Ось backup', extensions: ['osbackup'] }],
    });
    if (res.canceled || !res.filePath) return 'cancel';
    path = res.filePath;
  }
  try {
    await writeBackup(path, encrypt(profile === 0 ? collectAll() : collect(profile), password));
    return 'ok';
  } catch {
    return 'error';
  }
}

/** Выбранный для восстановления файл: сначала файл, потом пароль (как в Android). */
let picked: string | null = null;

export async function pick(win: BrowserWindow): Promise<boolean> {
  picked = testPath;
  if (!picked) {
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Ось backup', extensions: ['osbackup'] }, { name: '*', extensions: ['*'] }] });
    picked = res.canceled ? null : (res.filePaths[0] ?? null);
  }
  return picked != null;
}

/** Восстановить из выбранного файла (v1 — в [profile], v2 — во все профили); 'bad' — неверный пароль или повреждённый файл. */
export async function importPicked(profile: number, password: string): Promise<Restored | 'bad' | 'cancel' | 'error'> {
  if (!picked) return 'cancel';
  let text: string;
  try {
    text = await readFile(picked, 'utf8');
  } catch {
    return 'bad';
  }
  // Копия больше 50 МБ — не наша.
  if (text.length > 50_000_000) return 'bad';
  const data = decrypt(text, password);
  if (!data) return 'bad';
  try {
    const restored = applyAny(profile, data);
    picked = null;
    return restored;
  } catch {
    return 'error';
  }
}
