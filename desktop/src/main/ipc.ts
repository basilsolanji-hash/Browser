import { app, clipboard, dialog, ipcMain, nativeTheme, shell, session, type IpcMainInvokeEvent } from 'electron';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { applyLanguage, currentLang, isRtl, strings, t } from './i18n';
import { greeting, next } from './phrases';
import { engine, settings, toolbarButton, TOOLBAR_BUTTONS, ENGINES, MIN_PROFILES, MAX_PROFILES, profileCount } from './settings';
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
import * as Perms from './permissions';
import * as Lock from './lock';
import { blocklistSize } from './privacy';
import * as DefaultBrowser from './defaultbrowser';
import * as Diag from './diag';
import { frequentSites, hints } from './addrpanel';
import { applyAcceptLanguage, openExternal } from './security';
import { spawn } from 'node:child_process';
import * as Updater from './updater';
import { LANGS, LANG_NAMES } from '../shared/format';
import type { Suggestion, UiInit } from '../shared/types';

/** Адрес для отзывов — тот же, что в Android-версии (HelpActivity.FEEDBACK_EMAIL). */
const FEEDBACK_EMAIL = 'hello@os-browser.com';

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
// Приветствие и фраза для главного экрана (в инкогнито фраз нет).
on(['page'], 'phrase', (w) => (w.incognito ? null : { greeting: greeting(), phrase: next() }));

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
// Пустой ввод: плитки частых сайтов профиля (в инкогнито истории нет).
on(['chrome'], 'frequent', (w) => (w.profile != null && !w.incognito ? frequentSites(History.list(w.profile)) : []));
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
on(['chrome'], 'permissionAnswer', (w, id, allow, remember) => w.answerPrompt(int(id), allow === true, remember === true));
on(['chrome'], 'lockNow', () => { for (const w of windows) w.lock(); });
on(['chrome'], 'reader', (w) => w.toggleReader());
on(['chrome'], 'mobileSite', (w) => { const v = w.current; if (v && isWebUrl(v.url())) { v.setMobile(!v.mobile); w.push(); } });
on(['chrome'], 'diagnostics', (w) => `Ось ${app.getVersion()} (${process.platform} ${process.arch}, Chromium ${process.versions.chrome})\n${w.state().url}\n\n${Diag.text() || t('no_events')}`);
on(['chrome'], 'refreshDefault', async (w) => { const was = DefaultBrowser.isDefaultCached(); if ((await DefaultBrowser.refreshDefault()) !== was) w.push(); });
on(['chrome'], 'otherBrowsers', () => DefaultBrowser.otherBrowsers());
on(['chrome'], 'openInBrowser', async (w, exe) => {
  const url = w.current?.url() ?? '';
  if (!isWebUrl(url)) return;
  // Только браузер из списка установленных — произвольную программу страница меню запустить не может.
  const b = (await DefaultBrowser.otherBrowsers()).find((x) => x.exe === exe);
  if (b) spawn(b.exe, [url], { detached: true, stdio: 'ignore' }).unref();
  else if (exe == null) void shell.openExternal(url);
});
on(['chrome'], 'shareMail', (w) => {
  const url = w.current?.url() ?? '';
  if (isWebUrl(url)) openExternal(`mailto:?subject=${encodeURIComponent(w.current?.wc.getTitle() ?? '')}&body=${encodeURIComponent(url)}`);
});
on(['chrome'], 'findOpen', (w) => w.openFind());
on(['chrome'], 'find', (w, text, forward, next) => w.findText(str(text, 500), forward !== false, next === true));
on(['chrome'], 'findClose', (w) => w.closeFind());
on(['chrome'], 'print', (w) => w.print());

// --- Браузер по умолчанию, справка ---
on(['page'], 'defaultBrowser', async () => ({ isDefault: await DefaultBrowser.isDefault(), supported: process.platform === 'win32' }));
on(both, 'makeDefault', () => DefaultBrowser.openSystemSettings());
on(['page'], 'feedback', (_w, kind) => {
  const v = app.getVersion();
  const subject = kind === 'problem' ? t('problem_subject', v) : t('feedback_subject', v);
  const body = kind === 'problem' ? t('problem_body') + '\n\n' : '';
  void shell.openExternal(`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
});
on(['page'], 'feedbackEmail', () => FEEDBACK_EMAIL);
on(['page'], 'updateStatus', () => Updater.status());
on(['page'], 'updateCheck', () => { Updater.check(); return Updater.status(); });
on(['page'], 'updateRestart', () => Updater.restartAndInstall());
on(['page'], 'openLicenses', async () => {
  // Лицензии Chromium лежат рядом с программой (их кладёт Electron).
  const file = join(dirname(process.execPath), 'LICENSES.chromium.html');
  return (await shell.openPath(file)) === '';
});

// --- Блокировка ---
on(['page'], 'unlock', (_w, pin) => {
  const r = Lock.check(str(pin, 20));
  if (r === 'ok') for (const w of windows) w.unlock();
  return r;
});
// Сменить или снять PIN можно только с текущим PIN.
on(['page'], 'setPin', (_w, pin, current) => {
  if (Lock.enabled()) {
    const r = Lock.check(str(current, 20));
    if (r !== 'ok') return r;
  }
  return Lock.setPin(str(pin, 20)) ? 'ok' : 'rule';
});
on(['page'], 'removePin', (_w, current) => {
  const r = Lock.check(str(current, 20));
  if (r === 'ok') Lock.removePin();
  return r;
});

// --- Разрешения сайтов ---
on(['page'], 'sitePerms', (_w, profile) => {
  const p = profileArg(profile);
  return {
    profile: profileInfo(p),
    kinds: Perms.KINDS.map((k) => ({ key: k.key, title: t(k.titleKey), defaults: k.defaults, current: Perms.defaultMode(k.key) })),
    sites: Perms.sites(p),
  };
});
const MODES = ['ASK', 'ALLOW', 'BLOCK'];
on(['page'], 'sitePermSet', (_w, profile, host, key, mode) => {
  if (!MODES.includes(str(mode))) return;
  Perms.set(profileArg(profile), str(host, 300).toLowerCase(), str(key, 40), str(mode) as Perms.Mode);
});
on(['page'], 'sitePermDefault', (_w, key, mode) => { if (MODES.includes(str(mode))) Perms.setDefault(str(key, 40), str(mode) as Perms.Mode); });
on(['page'], 'sitePermClear', (_w, profile, host) => Perms.clearSite(profileArg(profile), str(host, 300)));
on(['page'], 'sitePermClearAll', (_w, profile) => Perms.clearProfile(profileArg(profile)));

// --- Проверка безопасности ---
on(['page'], 'securityCheck', () => {
  const s = settings.get();
  const g = Perms.granted();
  const engine = ENGINES.find((e) => e.id === s.engine) ?? ENGINES[0];
  const privateEngine = ['ddg', 'startpage', 'brave'].includes(engine.id);
  return [
    { id: 'lock', ok: !!s.lock, title: t('sec_lock'), text: s.lock ? t('dt_sec_lock_ok') : t('dt_sec_lock_off') },
    { id: 'hide', ok: s.hideContent, title: t('hide_content'), text: s.hideContent ? t('dt_sec_hide_ok') : t('dt_sec_hide_off') },
    { id: 'tracking', ok: s.trackingProtection, title: t('sec_tracking'), text: s.trackingProtection ? t('dt_sec_tracking_ok', blocklistSize()) : t('dt_sec_tracking_off') },
    { id: 'cookies', ok: s.blockThirdPartyCookies, title: t('perm_cookies3p'), text: s.blockThirdPartyCookies ? t('dt_sec_cookies_ok') : t('dt_sec_cookies_off') },
    { id: 'https', ok: s.httpsOnly, title: t('sec_https'), text: s.httpsOnly ? t('sec_https_ok') : t('sec_https_off') },
    { id: 'search', ok: privateEngine, title: t('search_engine'), text: privateEngine ? t('sec_search_ok', engine.title) : t('sec_search_bad', engine.title) },
    { id: 'perms', ok: g.count === 0, title: t('site_permissions'), text: g.count === 0 ? t('sec_perms_ok') : t('sec_perms_n', g.count, g.sites) },
  ];
});

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
on(['page'], 'dlPause', (_w, id) => Downloads.pause(str(id, 100)));
on(['page'], 'dlResume', (_w, id) => Downloads.resume(str(id, 100)));
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
  values: { ...settings.get(), lock: !!settings.get().lock, profileCount: profileCount(), toolbarButton: toolbarButton() },
  langs: [{ id: 'system', name: t('system') }, ...LANGS.map((l) => ({ id: l, name: LANG_NAMES[l] }))],
  themes: THEME_IDS.map((id) => ({ id, name: t(themeNameKey(id)) })),
  engines: ENGINES.map((e) => ({ id: e.id, name: e.title })),
  toolbarButtons: Object.entries(TOOLBAR_BUTTONS).map(([id, key]) => ({ id, name: t(key) })),
  minProfiles: MIN_PROFILES,
  maxProfiles: MAX_PROFILES,
}));
on(['page'], 'setSetting', (_w, key, value) => {
  const k = str(key, 40);
  if (k === 'lang' && (value === 'system' || (LANGS as readonly string[]).includes(str(value)))) {
    settings.update((d) => { d.lang = str(value); });
    applyLanguage();
    applyAcceptLanguage();
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
  } else if (['trackingProtection', 'httpsOnly', 'blockThirdPartyCookies'].includes(k)) {
    settings.update((d) => { (d as unknown as Record<string, boolean>)[k] = value === true; });
  } else if (k === 'autoUpdate') {
    settings.update((d) => { d.autoUpdate = value === true; });
    Updater.start();
  } else if (k === 'hideContent') {
    settings.update((d) => { d.hideContent = value === true; });
    for (const w of windows) w.win.setContentProtection(value === true);
  } else if (k === 'toolbarButton' && str(value) in TOOLBAR_BUTTONS) {
    settings.update((d) => { d.toolbarButton = str(value); });
    for (const w of windows) w.push();
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
  let had = Downloads.list().length > 0;
  Downloads.setListener(() => {
    for (const w of windows) w.page.webContents.send('os:event', 'downloads', null);
    // Первая загрузка (или очищенный список) — показать или спрятать кнопку «Загрузки» на панели.
    const has = Downloads.list().length > 0;
    if (has !== had) { had = has; for (const w of windows) w.push(); }
  });
  Updater.setListener(() => { for (const w of windows) w.page.webContents.send('os:event', 'update', null); });
  ipcMain.handle('os', async (e, cmd: unknown, ...args: unknown[]) => {
    const who = sender(e);
    const h = typeof cmd === 'string' ? handlers[cmd] : undefined;
    // Окно уже закрывается (шапка ещё шлёт запросы) — молча ничего не делаем.
    if (!who && !byWebContents(e.sender) && e.senderFrame?.url.startsWith('os://')) return null;
    if (!who || !h || !h.roles.includes(who.role)) throw new Error(`denied: ${String(cmd)}`);
    // Под замком работают только экран PIN и загрузка переводов.
    if (who.win.locked && cmd !== 'init' && cmd !== 'unlock') {
      // Шапка спрашивает состояние и под замком — отвечаем «ничего», без ошибки в консоли.
      if (cmd === 'state') return null;
      throw new Error('locked');
    }
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
/** Подсказки адресной строки: первая строка — сам ввод (переход или поиск), дальше прошлые запросы, избранное, история. */
function suggest(w: OsWindow, text: string): Suggestion[] {
  const q = text.trim();
  if (!q) return [];
  const asUrl = fromInput(q);
  const first: Suggestion = asUrl && isWebUrl(asUrl) && !asUrl.startsWith(engine().query)
    ? { kind: 'url', title: asUrl, url: asUrl }
    : { kind: 'search', title: q, url: '' };
  const visits = w.profile != null && !w.incognito ? History.list(w.profile) : [];
  return [first, ...hints(q, visits, Bookmarks.all())];
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
