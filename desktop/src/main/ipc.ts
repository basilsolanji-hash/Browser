import { app, clipboard, dialog, ipcMain, nativeTheme, shell, session, type IpcMainInvokeEvent } from 'electron';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { applyLanguage, currentLang, isRtl, strings, t } from './i18n';
import { settings, ENGINES, MIN_PROFILES, MAX_PROFILES, profileCount } from './settings';
import { THEME_IDS, themeNameKey } from './themes';
import { OsWindow, byWebContents, mainWindow, openIncognito, profileInfo, profileSession, saveWithToast, windows } from './window';
import { fromInput, isWebUrl } from './urls';
import * as Profiles from './profiles';
import * as Pins from './pins';
import * as Tabs from './tabs';
import * as History from './history';
import * as Bookmarks from './bookmarks';
import * as Onboarding from './onboarding';
import * as Notes from './notes';
import * as Downloads from './downloads';
import * as Saved from './saved';
import * as Stats from './stats';
import { LANGS, LANG_NAMES } from '../shared/format';
import type { Suggestion, UiInit } from '../shared/types';

/**
 * IPC своих страниц. Каждый вызов проверяет отправителя: это шапка или экран нашего окна,
 * главный фрейм на схеме os:// (§7 ТЗ). Аргументы приводятся к нужным типам и ограничиваются.
 */
type Role = 'chrome' | 'page';
type Handler = (w: OsWindow, ...args: unknown[]) => unknown;

const num = (x: unknown, fallback = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const int = (x: unknown) => Math.trunc(num(x));
const str = (x: unknown, max = 2000) => (typeof x === 'string' ? x.slice(0, max) : '');
const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, 500) : []);
const profileArg = (x: unknown) => {
  const id = int(x);
  if (!Profiles.exists(id)) throw new Error('bad profile');
  return id;
};
const pinsTarget = (x: unknown): number | null => (x == null ? null : profileArg(x));

const handlers: Record<string, { roles: Role[]; fn: Handler }> = {};
const on = (roles: Role[], name: string, fn: Handler) => { handlers[name] = { roles, fn }; };
const both: Role[] = ['chrome', 'page'];

// --- Общие ---
on(both, 'init', (w): UiInit => ({
  lang: currentLang(),
  rtl: isRtl(),
  strings: strings(),
  palette: w.palette(),
  themeId: w.incognito ? 'incognito' : settings.get().theme,
  platform: process.platform,
  version: app.getVersion(),
}));
on(both, 'openPanel', (w, url) => w.openPanel(str(url)));
on(both, 'showHome', (w) => w.showHome());
on(both, 'openProfile', (w, id, tab) => w.openProfile(profileArg(id), typeof tab === 'string' ? tab : undefined));
on(both, 'openUrl', (w, url) => { const u = fromInput(str(url)); if (u && isWebUrl(u)) w.openUrl(u); });
on(both, 'incognito', () => { openIncognito(); });
on(both, 'closePanel', (w) => w.closePanel());

// --- Шапка ---
on(['chrome'], 'state', (w) => w.state());
on(['chrome'], 'navigate', (w, text) => w.navigate(str(text, 8000)));
on(['chrome'], 'back', (w) => w.back());
on(['chrome'], 'forward', (w) => w.forward());
on(['chrome'], 'reload', (w) => w.reload());
on(['chrome'], 'stop', (w) => w.stop());
on(['chrome'], 'home', (w) => w.goHome());
on(['chrome'], 'newTab', (w) => w.newTab());
on(['chrome'], 'closeTab', (w, id) => w.closeTab(str(id, 100)));
on(['chrome'], 'closeOthers', (w, id) => {
  if (w.profile == null) return;
  w.closeTabs(Tabs.list(w.profile).map((x) => x.id).filter((x) => x !== id));
});
on(['chrome'], 'activate', (w, id) => w.activate(str(id, 100)));
on(['chrome'], 'moveTab', (w, id, index) => w.moveTab(str(id, 100), int(index)));
on(['chrome'], 'reopen', (w) => w.reopenClosed());
on(['chrome'], 'overlay', (w, open) => w.setOverlay(open === true));
on(['chrome'], 'zoom', (w, step) => w.zoom(Math.sign(int(step))));
on(['chrome'], 'fullscreen', (w) => w.win.setFullScreen(!w.win.isFullScreen()));
on(['chrome'], 'copy', (_w, text) => clipboard.writeText(str(text, 8000)));
on(['chrome'], 'profileList', () => Profiles.order().map(profileInfo));
on(['chrome'], 'suggest', (w, text) => suggest(w, str(text, 500)));
on(['chrome'], 'win', (w, action) => {
  if (action === 'min') w.win.minimize();
  else if (action === 'max') { if (w.win.isMaximized()) w.win.unmaximize(); else w.win.maximize(); }
  else if (action === 'close') w.win.close();
});
on(['chrome'], 'setTabGroup', (w, id, group) => {
  if (w.profile == null) return;
  Tabs.setGroup(w.profile, [str(id, 100)], typeof group === 'string' && Tabs.groups(w.profile).some((g) => g.id === group) ? group : null);
  w.push();
});
on(['chrome'], 'newGroupWith', (w, id) => {
  if (w.profile == null) return;
  const g = Tabs.addGroup(w.profile, '', Tabs.GROUP_COLORS[Tabs.groups(w.profile).length % Tabs.GROUP_COLORS.length]);
  Tabs.setGroup(w.profile, [str(id, 100)], g.id);
  w.push();
});

on(['chrome'], 'toggleBookmark', (w) => {
  const r = w.toggleBookmark();
  w.toast(t(r == null ? 'fav_unavailable' : r ? 'added_favorite' : 'fav_removed'));
});
on(['chrome'], 'savePage', (w) => saveWithToast(w));

// --- История ---
on(['page'], 'history', (_w, profile) => {
  const p = profileArg(profile);
  return { profile: profileInfo(p), items: History.list(p) };
});
on(['page'], 'historyRemove', (_w, profile, url, time) => { History.remove(profileArg(profile), str(url, 8000), num(time)); });
on(['page'], 'historyClear', (_w, profile) => { History.clear(profileArg(profile)); });
on(both, 'openIn', (w, profile, url) => {
  const u = str(url, 8000);
  if (!isWebUrl(u)) return;
  if (w.incognito) { w.newTab(u); return; }
  w.openProfile(profileArg(profile));
  w.newTab(u);
});

// --- Избранное ---
on(['page'], 'favorites', () => ({ list: Bookmarks.all(), folders: Bookmarks.folders() }));
on(['page'], 'favRemove', (_w, id) => { Bookmarks.remove(str(id, 100)); broadcast(); });
on(['page'], 'favRename', (_w, id, title) => { Bookmarks.rename(str(id, 100), str(title, 300)); });
on(['page'], 'favMove', (_w, id, folder) => { Bookmarks.move(str(id, 100), str(folder, 80)); });
on(['page'], 'favAddFolder', (_w, name) => Bookmarks.addFolder(str(name, 80)));
on(['page'], 'favRenameFolder', (_w, from, to) => Bookmarks.renameFolder(str(from, 80), str(to, 80)));
on(['page'], 'favRemoveFolder', (_w, name, keep) => { Bookmarks.removeFolder(str(name, 80), keep === true); broadcast(); });
on(['page'], 'lastProfile', () => Tabs.tabsFile.get().lastProfile ?? Profiles.order()[0]);

// --- Загрузки ---
on(['page'], 'downloads', () => ({ list: Downloads.list(), folder: Downloads.folder() }));
on(['page'], 'dlOpen', (_w, id) => Downloads.open(str(id, 100)));
on(['page'], 'dlShow', (_w, id) => Downloads.show(str(id, 100)));
on(['page'], 'dlCancel', (_w, id) => Downloads.cancel(str(id, 100)));
on(['page'], 'dlRemove', (_w, id) => Downloads.remove(str(id, 100)));
on(['page'], 'dlClear', () => Downloads.clear());

// --- Сохранённые страницы ---
on(['page'], 'saved', () => Saved.list());
on(['page'], 'savedOpen', async (_w, id) => {
  const p = Saved.byId(num(id));
  return p ? (await shell.openPath(Saved.pathOf(p))) === '' : false;
});
on(['page'], 'savedShow', (_w, id) => { const p = Saved.byId(num(id)); if (p) shell.showItemInFolder(Saved.pathOf(p)); });
on(['page'], 'savedRename', (_w, id, title) => Saved.rename(num(id), str(title, 300)));
on(['page'], 'savedRemove', (_w, id) => Saved.remove(num(id)));

// --- Статистика ---
on(['page'], 'stats', () => {
  const s = Stats.get();
  const hosts = new Map<string, number>();
  for (let id = 1; id <= profileCount(); id++) {
    for (const v of History.list(id)) {
      try {
        const h = new URL(v.u).hostname.replace(/^www\./, '');
        hosts.set(h, (hosts.get(h) ?? 0) + 1);
      } catch { /* битый адрес */ }
    }
  }
  return {
    since: s.since,
    trackers: s.trackers,
    pages: Profiles.order().map((id) => ({ profile: profileInfo(id), pages: s.pages[id] ?? 0 })),
    top: [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 10),
    library: { notes: Notes.all().length, saved: Saved.list().length, downloads: Downloads.list().length, favorites: Bookmarks.all().length },
  };
});
on(['page'], 'statsReset', () => Stats.reset());

// --- Очистка данных профиля ---
on(['page'], 'clearData', async (w, profile, what) => {
  const p = profileArg(profile);
  const o = (what ?? {}) as Record<string, unknown>;
  if (o.history === true) History.clear(p);
  if (o.cache === true) for (let id = 1; id <= profileCount(); id++) await profileSession(id).clearCache();
  if (o.logout === true) await clearProfile(p);
  broadcast();
  void w;
  return true;
});

// --- Экран профилей ---
on(['page'], 'profiles', () => ({
  list: Profiles.order().map(profileInfo),
  count: profileCount(),
}));
on(['page'], 'setOrder', (_w, ids) => {
  const n = Array.isArray(ids) ? ids.map(int).filter(Profiles.exists) : [];
  Profiles.setOrder([...n, ...Profiles.order().filter((x) => !n.includes(x))]);
  broadcast();
});
on(['page'], 'moveProfile', (_w, id, delta) => { Profiles.move(profileArg(id), Math.sign(int(delta))); broadcast(); });
on(['page'], 'renameProfile', (_w, id, name) => { Profiles.rename(profileArg(id), str(name, 80)); broadcast(); });
on(['page'], 'clearProfile', async (_w, id) => { await clearProfile(profileArg(id)); broadcast(); });

// --- Экран профиля: описание, файлы, закреплённые вкладки ---
on(['page'], 'profile', (_w, id) => {
  const p = profileArg(id);
  return { ...profileInfo(p), customName: Profiles.customName(p) };
});
on(['page'], 'setDescription', (_w, id, text) => { Profiles.setDescription(profileArg(id), str(text, 2000)); broadcast(); });
on(['page'], 'pins', (_w, profile) => {
  const p = pinsTarget(profile);
  return { pins: Pins.all(p), own: p != null && Pins.hasOwn(p) };
});
on(['page'], 'pinAdd', (_w, profile, title, url) => { Pins.add(str(title, 80), str(url), pinsTarget(profile)); broadcast(); });
on(['page'], 'pinUpdate', (_w, profile, id, title, url) => { Pins.update(str(id, 100), str(title, 80), str(url), pinsTarget(profile)); broadcast(); });
on(['page'], 'pinRemove', (_w, profile, id) => { Pins.remove(str(id, 100), pinsTarget(profile)); broadcast(); });
on(['page'], 'pinMove', (_w, profile, id, delta) => { Pins.move(str(id, 100), Math.sign(int(delta)), pinsTarget(profile)); broadcast(); });
on(['page'], 'pinsUseCommon', (_w, profile) => { Pins.useCommon(profileArg(profile)); broadcast(); });

on(['page'], 'files', async (_w, id) => listFiles(profileArg(id)));
on(['page'], 'filesAdd', async (w, id) => {
  const p = profileArg(id);
  const res = await dialog.showOpenDialog(w.win, { properties: ['openFile', 'multiSelections'] });
  if (res.canceled) return { added: 0, failed: 0 };
  const dir = Profiles.filesDir(p);
  await mkdir(dir, { recursive: true });
  let added = 0;
  let failed = 0;
  for (const src of res.filePaths) {
    try {
      await copyFile(src, await unique(dir, safeName(basename(src))));
      added++;
    } catch {
      failed++;
    }
  }
  broadcast();
  return { added, failed };
});
on(['page'], 'fileOpen', async (_w, id, name) => {
  const path = ownedFile(profileArg(id), str(name, 200));
  const err = await shell.openPath(path);
  return err === '';
});
on(['page'], 'fileShow', (_w, id, name) => shell.showItemInFolder(ownedFile(profileArg(id), str(name, 200))));
on(['page'], 'fileRename', async (_w, id, name, next) => {
  const p = profileArg(id);
  const from = ownedFile(p, str(name, 200));
  const clean = safeName(str(next, 200));
  if (!clean || clean === basename(from)) return false;
  await rename(from, await unique(Profiles.filesDir(p), clean));
  return true;
});
on(['page'], 'fileDelete', async (_w, id, name) => { await rm(ownedFile(profileArg(id), str(name, 200))); broadcast(); });

// --- Настройки ---
on(['page'], 'settings', () => ({
  values: { ...settings.get(), profileCount: profileCount() },
  langs: [{ id: 'system', name: t('system') }, ...LANGS.map((l) => ({ id: l, name: LANG_NAMES[l] }))],
  themes: THEME_IDS.map((id) => ({ id, name: t(themeNameKey(id)) })),
  engines: ENGINES.map((e) => ({ id: e.id, name: e.title })),
  minProfiles: MIN_PROFILES,
  maxProfiles: MAX_PROFILES,
}));
on(['page'], 'setSetting', (_w, key, value) => {
  const k = str(key, 40);
  if (k === 'lang' && (value === 'system' || (LANGS as readonly string[]).includes(str(value)))) {
    settings.update((d) => { d.lang = str(value); });
    applyLanguage();
    lookChanged();
  } else if (k === 'theme' && THEME_IDS.includes(str(value))) {
    settings.update((d) => { d.theme = str(value); });
    applyTheme();
    lookChanged();
  } else if (k === 'engine' && ENGINES.some((e) => e.id === value)) {
    settings.update((d) => { d.engine = str(value); });
  } else if (k === 'profileCount') {
    settings.update((d) => { d.profileCount = Math.min(MAX_PROFILES, Math.max(MIN_PROFILES, int(value))); });
    broadcast();
  } else if (k === 'homeMode' && ['OS', 'BLANK', 'CUSTOM'].includes(str(value))) {
    settings.update((d) => { d.homeMode = str(value) as 'OS' | 'BLANK' | 'CUSTOM'; });
  } else if (k === 'homeUrl') {
    const u = fromInput(str(value));
    settings.update((d) => { d.homeUrl = u && isWebUrl(u) ? u : ''; });
  } else if (k === 'zoom') {
    settings.update((d) => { d.zoom = Math.min(250, Math.max(50, int(value))); });
  } else {
    throw new Error('bad setting');
  }
  return true;
});
on(['page'], 'clearCacheAll', async () => {
  for (let id = 1; id <= profileCount(); id++) await profileSession(id).clearCache();
  return true;
});
on(['page'], 'clearHistoryAll', () => { History.clearAll(); return true; });

// --- Первый запуск ---
on(['page'], 'onboardingDone', (w) => { Onboarding.finish(); w.showHome(); });
on(['page'], 'exampleProfiles', () => Profiles.order().slice(0, 4).map(profileInfo));

// --- Вкладки профиля (сетка, группы, поиск) ---
on(['page'], 'tabsOf', (_w, profile) => {
  const p = profileArg(profile);
  return {
    profile: profileInfo(p),
    pins: Pins.all(p).map((pin) => ({ id: pin.id, title: Tabs.pinState(p, pin.id)?.title || pin.title, url: Tabs.pinState(p, pin.id)?.url ?? pin.url })),
    tabs: Tabs.list(p).map((x) => ({ id: x.id, title: Tabs.label(x), url: x.url, group: x.group })),
    groups: Tabs.groups(p),
    active: Tabs.active(p),
    colors: Tabs.GROUP_COLORS,
  };
});
on(['page'], 'thumbs', async (w, profile) => {
  const p = profileArg(profile);
  const out: Record<string, string> = {};
  for (const tab of [...Tabs.list(p), ...Pins.all(p)]) {
    const v = w.viewFor(p, tab.id);
    if (!v || v.wc.isDestroyed() || v.wc.isLoading()) continue;
    try {
      const img = await v.wc.capturePage();
      if (!img.isEmpty()) out[tab.id] = img.resize({ width: 360 }).toDataURL();
    } catch {
      // вкладка закрылась во время снимка
    }
  }
  return out;
});
on(['page'], 'activateTab', (w, profile, id) => w.openProfile(profileArg(profile), str(id, 100)));
on(['page'], 'closeTabs', (w, profile, ids) => {
  const p = profileArg(profile);
  if (w.profile === p) w.closeTabs(strs(ids));
  else Tabs.close(p, strs(ids));
  broadcast();
});
on(['page'], 'newTabIn', (w, profile, group) => {
  const p = profileArg(profile);
  w.openProfile(p);
  const tab = Tabs.add(p, undefined, { group: typeof group === 'string' ? group : null });
  w.activate(tab.id);
});
on(['page'], 'setGroup', (w, profile, ids, group) => {
  const p = profileArg(profile);
  Tabs.setGroup(p, strs(ids), typeof group === 'string' && Tabs.groups(p).some((g) => g.id === group) ? group : null);
  w.push();
});
on(['page'], 'groupAdd', (w, profile, name, color, ids) => {
  const p = profileArg(profile);
  const g = Tabs.addGroup(p, str(name, 60), str(color, 10));
  if (Array.isArray(ids)) Tabs.setGroup(p, strs(ids), g.id);
  w.push();
  return g;
});
on(['page'], 'groupUpdate', (w, profile, id, name, color) => {
  Tabs.updateGroup(profileArg(profile), str(id, 100), { name: str(name, 60) || undefined, color: str(color, 10) || undefined });
  w.push();
});
on(['page'], 'groupDelete', (w, profile, id) => { Tabs.deleteGroup(profileArg(profile), str(id, 100)); w.push(); });

// --- Заметки ---
on(['page'], 'notes', () => Notes.all());
on(['page'], 'noteSave', (_w, id, text) => Notes.save(typeof id === 'string' ? id : null, str(text, 20000)));
on(['page'], 'noteDelete', (_w, id) => Notes.remove(str(id, 100)));

// --- О приложении ---
on(['page'], 'about', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  node: process.versions.node,
}));
on(['page'], 'openExternalSafe', (_w, url) => {
  const u = str(url, 2000);
  if (/^https:\/\//.test(u) || /^mailto:/.test(u)) void shell.openExternal(u);
});

function sender(e: IpcMainInvokeEvent) {
  const found = byWebContents(e.sender);
  const frame = e.senderFrame;
  if (!found || !frame || frame !== e.sender.mainFrame || !frame.url.startsWith('os://')) return null;
  return found;
}

export function installIpc(): void {
  // Ход загрузок — экранам «Загрузки» (не чаще, чем шлёт downloads.ts).
  Downloads.setListener(() => { for (const w of windows) w.page.webContents.send('os:event', 'downloads', null); });
  ipcMain.handle('os', async (e, cmd: unknown, ...args: unknown[]) => {
    const who = sender(e);
    const h = typeof cmd === 'string' ? handlers[cmd] : undefined;
    if (!who || !h || !h.roles.includes(who.role)) throw new Error('denied');
    return h.fn(who.win, ...args);
  });
}

/** Данные поменялись: экраны и шапки всех окон перечитывают их. */
export function broadcast(): void {
  for (const w of windows) {
    w.page.webContents.send('os:event', 'changed', null);
    w.push();
  }
}

function lookChanged(): void {
  for (const w of windows) w.refreshLook();
}

export function applyTheme(): void {
  const id = settings.get().theme;
  nativeTheme.themeSource = id === 'system' ? 'system' : ['scarlet_light', 'sand'].includes(id) ? 'light' : 'dark';
}

/** Выход из аккаунтов профиля: cookies, хранилища, кэш, вкладки и история профиля. */
async function clearProfile(id: number): Promise<void> {
  for (const w of windows) if (!w.incognito) w.dropProfileViews(id);
  const ses = session.fromPartition(Profiles.partition(id));
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.clearAuthCache();
  Tabs.forgetProfile(id);
  History.clear(id);
  Profiles.forget(id);
}

/** Подсказки адресной строки: поиск, история профиля, избранное. */
function suggest(w: OsWindow, text: string): Suggestion[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const out: Suggestion[] = [];
  const asUrl = fromInput(text);
  if (asUrl && isWebUrl(asUrl)) out.push({ kind: 'url', title: asUrl, url: asUrl });
  out.push({ kind: 'search', title: text.trim(), url: '' });
  const seen = new Set(out.map((s) => s.url));
  const match = (title: string, url: string) => title.toLowerCase().includes(q) || url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').includes(q);
  for (const b of Bookmarks.all()) {
    if (out.length >= 9) break;
    if (match(b.t, b.u) && !seen.has(b.u)) { out.push({ kind: 'favorite', title: b.t, url: b.u }); seen.add(b.u); }
  }
  if (w.profile != null && !w.incognito) {
    for (const v of History.list(w.profile)) {
      if (out.length >= 9) break;
      if (match(v.t, v.u) && !seen.has(v.u)) { out.push({ kind: 'history', title: v.t || v.u, url: v.u }); seen.add(v.u); }
    }
  }
  return out;
}

// --- Файлы профиля ---

async function listFiles(id: number) {
  const dir = Profiles.filesDir(id);
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  const out: { name: string; size: number; time: number }[] = [];
  for (const name of names) {
    try {
      const s = await stat(join(dir, name));
      if (s.isFile()) out.push({ name, size: s.size, time: s.mtimeMs });
    } catch {
      // файл удалили
    }
  }
  return out.sort((a, b) => b.time - a.time);
}

// eslint-disable-next-line no-control-regex -- управляющие символы в имени файла заменяем намеренно
const safeName = (name: string) => name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120);

/** Файл должен лежать в папке этого профиля — защита от подмены пути. */
function ownedFile(id: number, name: string): string {
  const clean = basename(name);
  if (!clean || clean !== name || clean.startsWith('.')) throw new Error('bad file');
  return join(Profiles.filesDir(id), clean);
}

/** «файл.pdf» → «файл (2).pdf», если имя занято. */
async function unique(dir: string, name: string): Promise<string> {
  const ext = extname(name);
  const base = name.slice(0, name.length - ext.length) || 'file';
  let candidate = join(dir, name);
  for (let n = 2; existsSync(candidate); n++) candidate = join(dir, `${base} (${n})${ext}`);
  return candidate;
}

export { mainWindow };
