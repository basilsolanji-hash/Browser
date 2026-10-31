import { BrowserWindow, WebContentsView, clipboard, dialog, ipcMain, screen, session, systemPreferences, type Session, type WebContents } from 'electron';
import { join } from 'node:path';
import { JsonFile } from './store';
import { WEB_PREFS, hardenSession, openExternal, openSystemSettings } from './security';
import { handleUiSession, handleWebSession, isPanelUrl } from './protocol';
import { INCOGNITO_PALETTE, palette } from './themes';
import { settings, searchUrl, toolbarButton } from './settings';
import { TabView, type TabHost } from './tabview';
import { isDefaultCached } from './defaultbrowser';
import { isSignInPage } from './signin';
import { START, fromInput, isOwnUrl, isWebUrl } from './urls';
import { isRtl, t } from './i18n';
import * as Tabs from './tabs';
import * as Pins from './pins';
import * as Profiles from './profiles';
import * as History from './history';
import * as Downloads from './downloads';
import * as Bookmarks from './bookmarks';
import * as Saved from './saved';
import * as Perms from './permissions';
import * as Privacy from './privacy';
import * as Lock from './lock';
import * as Reader from './reader';
import * as Notes from './notes';
import * as Extensions from './extensions';
import { searchUrl as searchFor } from './settings';
import type { Palette, ProfileInfo, StripTab, WindowState } from '../shared/types';

/** Высота шапки: верхний ряд (вкладки + кнопки окна) и панель адреса. */
export const ROW1 = 40;
export const ROW2 = 44;
/** Строка «Найти на странице» (Ctrl+F) под адресной строкой. */
export const ROW3 = 40;

const windowFile = new JsonFile<{ x?: number; y?: number; width: number; height: number; maximized: boolean }>(
  'window', () => ({ width: 1280, height: 820, maximized: false }));

/** Все окна приложения: одно обычное и сколько угодно окон инкогнито. */
export const windows = new Set<OsWindow>();

let uiSession: Session | null = null;
export function uiSes(): Session {
  if (!uiSession) {
    uiSession = session.fromPartition('os-ui');
    hardenSession(uiSession);
    handleUiSession(uiSession);
  }
  return uiSession;
}

export function profileSession(id: number): Session {
  const ses = session.fromPartition(Profiles.partition(id));
  if (!attached.has(ses)) {
    attached.add(ses);
    hardenSession(ses);
    handleWebSession(ses, false);
    Downloads.attach(ses, id);
    Privacy.protect(ses);
    installPermissions(ses, id);
    void Extensions.attach(ses, id);
  }
  return ses;
}

const attached = new WeakSet<Session>();

let incognitoSeq = 0;

/** Адрес главной страницы для маркера «Старт» (Home.kt): «Ось», пустая или свой адрес. */
export function homeUrl(incognito: boolean): string {
  const s = settings.get();
  if (incognito || s.homeMode === 'OS') return START;
  if (s.homeMode === 'BLANK') return 'about:blank';
  return isWebUrl(s.homeUrl) ? s.homeUrl : START;
}

const preload = () => join(__dirname, '..', 'preload', 'preload.js');

interface MemTab { id: string; title: string; url: string }

interface Prompt {
  id: number; wcId: number; host: string; kinds: string[]; resolve: (allow: boolean, remember: boolean) => void;
  /** Свой текст вопроса (скачивание: сайт и имя файла). */
  text?: string;
}
export interface AskOptions { text?: string; keepOnNavigate?: boolean }
/** Вопрос о пароле: сохранить после входа или выбрать аккаунт для подстановки. */
export interface PwPrompt { id: number; wcId: number; kind: 'save' | 'pick'; host: string; users: { g: string; u: string }[]; resolve: (action: string) => void }
let promptSeq = 0;

const SIMPLE_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);

/** Какие наши типы разрешений нужны для запроса Electron (null — запрещено всегда). */
function kindsFor(permission: string, details: { mediaTypes?: string[]; mediaType?: string }): string[] | null {
  if (permission === 'geolocation') return ['location'];
  if (permission === 'notifications') return ['notifications'];
  if (permission === 'clipboard-read') return ['clipboard'];
  if (permission === 'media') {
    const types = details.mediaTypes ?? (details.mediaType ? [details.mediaType] : []);
    const out = [...(types.includes('video') ? ['camera'] : []), ...(types.includes('audio') ? ['microphone'] : [])];
    return out.length ? out : null;
  }
  return null;
}

const hostOf = (url: string) => {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
};

/**
 * Разрешения сайтов: по умолчанию — спросить; решение запоминается по сайту и профилю.
 * Инкогнито: решения живут только в памяти окна.
 */
const sessionModes = new WeakMap<Session, (host: string, kind: string) => Perms.Mode>();

/** Решение по разрешению для сайта в этой сессии (профиль или инкогнито). */
export function permissionMode(ses: Session, host: string, kind: string): Perms.Mode {
  return sessionModes.get(ses)?.(host, kind) ?? 'BLOCK';
}

/** Запомнить решение для сайта в этой сессии: профиль — на диск, инкогнито — в памяти окна. */
const sessionRemember = new WeakMap<Session, (host: string, kind: string, allow: boolean) => void>();
/** Доступ приложения к камере или микрофону выключен в настройках Windows. */
function osMediaDenied(kind: 'camera' | 'microphone'): boolean {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return false;
  return systemPreferences.getMediaAccessStatus(kind) === 'denied';
}

async function explainOsDenied(w: OsWindow, kind: 'camera' | 'microphone'): Promise<void> {
  const what = t(Perms.kind(kind)?.titleKey ?? kind);
  const r = await dialog.showMessageBox(w.win, {
    type: 'info', message: t('dt_perm_os_off', what), buttons: [t('open_settings'), t('close')], defaultId: 0, cancelId: 1, noLink: true,
  });
  if (r.response === 0) openSystemSettings(kind === 'camera' ? 'ms-settings:privacy-webcam' : 'ms-settings:privacy-microphone');
}

function installPermissions(ses: Session, profile: number | null): void {
  const memory = new Map<string, Perms.Mode>();
  const mode = (host: string, kind: string): Perms.Mode =>
    profile == null ? (memory.get(`${host}|${kind}`) ?? Perms.defaultMode(kind)) : Perms.effective(profile, host, kind);
  sessionModes.set(ses, mode);
  sessionRemember.set(ses, (host, k, allow) => {
    if (profile == null) memory.set(`${host}|${k}`, allow ? 'ALLOW' : 'BLOCK');
    else Perms.set(profile, host, k, allow ? 'ALLOW' : 'BLOCK');
  });
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    if (SIMPLE_ALLOW.has(permission)) return cb(true);
    const kinds = kindsFor(permission, details as { mediaTypes?: string[] });
    // Решение — за сайтом вкладки (как в Chrome), а не за встроенным фреймом: иначе рекламный iframe,
    // разрешённый один раз, получил бы доступ на любом сайте. Фрейму доступ даёт ещё и его allow=.
    const host = hostOf(wc?.getURL() ?? '');
    if (!kinds || !wc || !host) return cb(false);
    const modes = kinds.map((k) => mode(host, k));
    const w = [...windows].find((x) => x.owns(wc));
    // Запрещено для сайта — не молча: подсказка, где это поменять.
    const blocked = kinds[modes.indexOf('BLOCK')];
    if (blocked) {
      w?.toast(t('perm_blocked_for', t(Perms.kind(blocked)?.titleKey ?? blocked), host));
      return cb(false);
    }
    // Доступ выключен в самой Windows («Конфиденциальность» → микрофон или камера) — объясняем и ведём туда.
    const off = kinds.find((k): k is 'camera' | 'microphone' => (k === 'camera' || k === 'microphone') && osMediaDenied(k));
    if (off) {
      cb(false);
      if (w) void explainOsDenied(w, off);
      return;
    }
    if (modes.every((m) => m === 'ALLOW')) return cb(true);
    if (!w) return cb(false);
    w.askPermission(wc, host, kinds, (allow, remember) => {
      if (remember) {
        for (const k of kinds) {
          if (profile == null) memory.set(`${host}|${k}`, allow ? 'ALLOW' : 'BLOCK');
          else Perms.set(profile, host, k, allow ? 'ALLOW' : 'BLOCK');
        }
      }
      cb(allow);
    });
  });
  ses.setPermissionCheckHandler((wc, permission, origin, details) => {
    if (SIMPLE_ALLOW.has(permission)) return true;
    const kinds = kindsFor(permission, details as { mediaType?: string });
    const host = hostOf((details as { embeddingOrigin?: string }).embeddingOrigin || wc?.getURL() || origin);
    return !!kinds && !!host && kinds.every((k) => mode(host, k) === 'ALLOW');
  });
}

export class OsWindow implements TabHost {
  readonly win: BrowserWindow;
  readonly chrome: WebContentsView;
  readonly page: WebContentsView;
  readonly incognito: boolean;
  private incogSession: Session | null = null;
  /** Профиль, чьи вкладки показаны; null — экран профилей. */
  profile: number | null = null;
  /** Открытый поверх вкладок экран (os://settings, os://tabs…); у экрана профилей всегда открыт os://home. */
  panel: string | null = null;
  private views = new Map<string, TabView>();
  private shown: TabView | null = null;
  /** Вкладка на экране (для пунктов меню, которые меняют саму вкладку). */
  get current(): TabView | null { return this.panel ? null : this.shown; }
  private overlay = false;
  private pushTimer: NodeJS.Timeout | null = null;
  // Вкладки инкогнито живут только в памяти.
  private memTabs: MemTab[] = [];
  private memActive: string | null = null;
  private memClosed: MemTab[] = [];
  private memSeq = 0;
  /** Запросы разрешений сайтов, ждущие ответа пользователя. */
  private prompts: Prompt[] = [];
  private pwPrompts: PwPrompt[] = [];
  /** Поиск на странице: текст и найденное (null — строка поиска закрыта). */
  private find: { text: string; active: number; matches: number } | null = null;
  /** Окно заблокировано PIN-ом: видно только os://lock. */
  locked = false;

  constructor(opts: { incognito?: boolean; from?: OsWindow } = {}) {
    this.incognito = !!opts.incognito;
    const pal = this.palette();
    const saved = windowFile.get();
    const from = opts.from && !opts.from.win.isDestroyed() ? opts.from.win.getBounds() : null;
    // Новое окно — каскадом от текущего, как в Windows; первое — где было при закрытии.
    const bounds = this.incognito ? { width: 1100, height: 760 } : from ? visibleBounds({ ...from, x: from.x + 32, y: from.y + 32 }) : visibleBounds(saved);
    this.win = new BrowserWindow({
      ...bounds,
      minWidth: 560,
      minHeight: 400,
      show: false,
      frame: false,
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin' ? {} : { titleBarOverlay: { color: pal.surface, symbolColor: pal.text, height: ROW1 } }),
      backgroundColor: pal.bg,
      title: this.incognito ? `${t('incognito')} — Ось Browser` : 'Ось Browser',
      icon: join(__dirname, '..', 'assets', 'icon.png'),
      webPreferences: { ...WEB_PREFS, session: uiSes() },
    });
    this.win.webContents.loadURL('about:blank');
    // Скрывать содержимое окна от записи экрана и скриншотов — по настройке.
    this.win.setContentProtection(settings.get().hideContent);
    if (!this.incognito && !from && saved.maximized) this.win.maximize();

    this.page = this.ownView();
    this.chrome = this.ownView();
    // Шапка прозрачна там, где открывается выпадающее меню поверх страницы.
    this.chrome.setBackgroundColor('#00000000');
    this.win.contentView.addChildView(this.page);
    this.win.contentView.addChildView(this.chrome);
    void this.chrome.webContents.loadURL(this.incognito ? 'os://ui/?incognito=1' : 'os://ui/');

    this.win.on('resize', () => { this.layout(); this.saveBounds(); });
    this.win.on('move', () => this.saveBounds());
    this.win.on('maximize', () => { this.push(); this.saveBounds(); });
    this.win.on('unmaximize', () => { this.push(); this.saveBounds(); });
    this.win.on('enter-full-screen', () => { this.layout(); this.push(); });
    this.win.on('leave-full-screen', () => { this.layout(); this.push(); });
    // Кнопки «назад/вперёд» мыши в Windows.
    this.win.on('app-command', (_e, cmd) => {
      if (cmd === 'browser-backward') this.back();
      if (cmd === 'browser-forward') this.forward();
    });
    // Свернули больше чем на минуту — при возврате спросим PIN (как блокировка после минуты в фоне на Android).
    let minimizedAt = 0;
    this.win.on('minimize', () => { minimizedAt = Date.now(); });
    this.win.on('restore', () => {
      if (minimizedAt && Date.now() - minimizedAt > 60_000) lockAll();
      minimizedAt = 0;
    });
    this.win.once('ready-to-show', () => this.win.show());
    this.chrome.webContents.once('did-finish-load', () => this.win.show());
    this.win.on('closed', () => this.destroyAll());
    windows.add(this);
    if (this.incognito) this.newTab();
    this.layout();
  }

  /** Вид для своих страниц: сессия интерфейса, preload с мостом (только для os://). */
  private ownView(): WebContentsView {
    const v = new WebContentsView({ webPreferences: { ...WEB_PREFS, session: uiSes(), preload: preload() } });
    const wc = v.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) this.openUrl(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e) => {
      if (isPanelUrl(e.url) && v === this.page) return;
      e.preventDefault();
      if (isWebUrl(e.url) || /^mailto:/i.test(e.url)) {
        if (/^mailto:/i.test(e.url)) openExternal(e.url);
        else this.openUrl(e.url);
      }
    });
    wc.on('did-navigate', () => { if (v === this.page) this.push(); });
    wc.on('did-navigate-in-page', () => { if (v === this.page) this.push(); });
    wc.on('page-title-updated', () => { if (v === this.page) this.push(); });
    wc.on('before-input-event', (e, input) => { if (this.shortcut(input, wc)) e.preventDefault(); });
    return v;
  }

  palette(): Palette {
    return this.incognito ? INCOGNITO_PALETTE : palette(settings.get().theme);
  }

  private session(): Session {
    if (this.incognito) {
      if (!this.incogSession) {
        // Партиция без «persist:» живёт в памяти и исчезает вместе с окном.
        this.incogSession = session.fromPartition(`incognito_${++incognitoSeq}`);
        hardenSession(this.incogSession);
        handleWebSession(this.incogSession, true);
        Downloads.attach(this.incogSession, null);
        Privacy.protect(this.incogSession);
        installPermissions(this.incogSession, null);
      }
      return this.incogSession;
    }
    return profileSession(this.profile!);
  }

  // --- Раскладка ---

  chromeHeight(): number {
    if (this.win.isFullScreen() && !this.panel) return 0;
    const base = this.profile == null && !this.incognito ? ROW1 : ROW1 + ROW2;
    return base + (this.find && !this.panel ? ROW3 : 0);
  }

  layout(): void {
    if (this.win.isDestroyed()) return;
    const { width, height } = this.win.getContentBounds();
    if (this.locked) {
      // Под замком видно только экран ввода PIN: ни вкладок, ни шапки.
      this.chrome.setVisible(false);
      for (const v of this.views.values()) v.view.setVisible(false);
      this.page.setVisible(true);
      this.page.setBounds({ x: 0, y: 0, width, height });
      return;
    }
    const top = this.chromeHeight();
    const content = { x: 0, y: top, width, height: Math.max(0, height - top) };
    this.chrome.setBounds(this.overlay ? { x: 0, y: 0, width, height } : { x: 0, y: 0, width, height: top || 1 });
    this.chrome.setVisible(top > 0 || this.overlay);
    const showPanel = this.panel != null;
    this.page.setVisible(showPanel);
    this.page.setBounds(content);
    for (const v of this.views.values()) {
      const visible = !showPanel && v === this.shown;
      v.view.setVisible(visible);
      if (visible) v.view.setBounds(content);
    }
  }

  /** Выпадающее меню шапки: на время показа шапка накрывает окно целиком (её фон прозрачный). */
  setOverlay(open: boolean): void {
    this.overlay = open;
    this.layout();
    if (open) this.chrome.webContents.focus();
  }

  private saveBounds(): void {
    if (this.incognito || this.win.isDestroyed() || this.win.isFullScreen()) return;
    const maximized = this.win.isMaximized();
    windowFile.update((d) => {
      d.maximized = maximized;
      if (!maximized && !this.win.isMinimized()) Object.assign(d, this.win.getBounds());
    });
  }

  // --- Состояние для шапки ---

  push(): void {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      if (this.win.isDestroyed()) return;
      this.chrome.webContents.send('os:event', 'state', this.state());
      if (!this.incognito) this.win.setTitle(this.profile ? `${Profiles.name(this.profile)} — Ось Browser` : 'Ось Browser');
    }, 16);
  }

  state(): WindowState {
    const v = this.shown;
    const wc = v?.wc;
    const url = v ? v.url() : '';
    const pageWc = this.page.webContents;
    return {
      incognito: this.incognito,
      profile: this.profile != null ? profileInfo(this.profile) : null,
      tabs: this.strip(),
      groups: this.profile != null ? Tabs.groups(this.profile) : [],
      active: this.activeId(),
      url: url === START || url === 'about:blank' ? '' : url,
      title: wc?.getTitle() ?? '',
      canBack: !!wc?.navigationHistory.canGoBack(),
      canForward: !!wc?.navigationHistory.canGoForward(),
      loading: !!wc?.isLoading(),
      secure: url.startsWith('https://') && !v?.failedUrl,
      panel: this.panel,
      panelTitle: this.panel ? pageWc.getTitle() : '',
      panelCanBack: this.panel ? pageWc.navigationHistory.canGoBack() && this.profile == null : false,
      maximized: this.win.isMaximized(),
      zoom: wc ? Math.round(wc.getZoomFactor() * 100) : 100,
      find: this.find && !this.panel ? this.find : null,
      bookmarked: isWebUrl(url) && !!Bookmarks.findByUrl(url),
      prompt: this.currentPrompt(),
      pw: this.currentPw(),
      blocked: wc ? Privacy.blockedOnTab(wc.id) : 0,
      locked: this.locked,
      lockEnabled: Lock.enabled(),
      reader: !!v?.reader,
      mobile: !!v?.mobile,
      isDefault: isDefaultCached(),
      fullscreen: this.win.isFullScreen(),
      engine: settings.get().engine,
      toolbarButton: toolbarButton(),
      hasDownloads: Downloads.list().length > 0,
    };
  }

  private key(id: string): string {
    return this.incognito ? `i:${id}` : `${this.profile}:${id}`;
  }

  strip(): StripTab[] {
    const live = (id: string) => this.views.get(this.key(id));
    const item = (id: string, pinned: boolean, title: string, url: string, group: string | null): StripTab => {
      const v = live(id);
      return {
        id, pinned, group, url: v?.url() || url,
        title: v?.wc.getTitle() && !v.wc.getURL().startsWith('os://start') ? v.wc.getTitle() : title,
        loading: !!v?.wc.isLoading(),
        favicon: v?.favicon ?? null,
      };
    };
    if (this.incognito) return this.memTabs.map((m) => item(m.id, false, m.title || t('new_tab'), m.url, null));
    if (this.profile == null) return [];
    const p = this.profile;
    const pins = Pins.all(p).map((pin) => item(pin.id, true, pin.title, Tabs.pinState(p, pin.id)?.url ?? pin.url, null));
    const tabs = Tabs.list(p).map((x) => item(x.id, false, Tabs.label(x), x.url, x.group));
    return [...pins, ...tabs];
  }

  activeId(): string | null {
    if (this.incognito) return this.memActive;
    if (this.profile == null) return null;
    const id = Tabs.active(this.profile);
    return id && this.exists(id) ? id : (Pins.all(this.profile)[0]?.id ?? null);
  }

  private exists(id: string): boolean {
    if (this.incognito) return this.memTabs.some((m) => m.id === id);
    if (this.profile == null) return false;
    return Tabs.isTab(id) ? !!Tabs.byId(this.profile, id) : !!Pins.byId(id, this.profile);
  }

  /** С какого адреса открыть вкладку, у которой ещё нет вида. */
  private initialUrl(id: string): string {
    if (this.incognito) return this.memTabs.find((m) => m.id === id)?.url ?? homeUrl(true);
    const p = this.profile!;
    if (Tabs.isTab(id)) {
      const url = Tabs.byId(p, id)?.url ?? START;
      return url === START ? homeUrl(false) : url;
    }
    const pin = Pins.byId(id, p);
    const saved = Tabs.pinState(p, id)?.url;
    if (saved) return saved;
    return !pin || pin.url === START ? homeUrl(false) : pin.url;
  }

  // --- Профили и экраны ---

  /** Показать окно поверх остальных (было свёрнуто — развернуть). */
  focus(): void {
    if (this.win.isDestroyed()) return;
    if (this.win.isMinimized()) this.win.restore();
    this.win.focus();
  }

  showHome(): void {
    if (this.incognito) return;
    this.profile = null;
    this.openPanel('os://home/');
  }

  openProfile(id: number, tabId?: string): void {
    if (this.incognito || !Profiles.exists(id)) return;
    // Профиль — только в одном окне (у вкладки один вид): уже открыт в другом — переходим туда.
    const other = ownerOf(id);
    if (other && other !== this) {
      other.openProfile(id, tabId);
      other.focus();
      return;
    }
    this.profile = id;
    this.panel = null;
    this.overlay = false;
    this.activate(tabId && this.exists(tabId) ? tabId : this.activeId()!);
  }

  openPanel(url: string): void {
    if (!isPanelUrl(url) || url.startsWith('os://lock')) return;
    if (this.locked) {
      // Откроется после ввода PIN.
      this.panel = url;
      return;
    }
    this.panel = url;
    const wc = this.page.webContents;
    if (wc.getURL() !== url) void wc.loadURL(url);
    // Тот же экран открыт снова — данные могли поменяться (вкладки, пароли): пусть перечитает.
    else wc.send('os:event', 'changed', null);
    this.layout();
    this.push();
    wc.focus();
  }

  closePanel(): void {
    if (this.profile == null) return;
    this.panel = null;
    this.layout();
    this.push();
    this.shown?.wc.focus();
  }

  // --- Вкладки ---

  activate(id: string): void {
    if (!this.incognito && this.profile == null) return;
    if (!this.exists(id)) return;
    this.panel = null;
    const key = this.key(id);
    let v = this.views.get(key);
    if (!v) {
      // Сайты без своего фона — на белом, как в Chrome.
      v = new TabView(key, id, this.session(), this, '#FFFFFF');
      this.views.set(key, v);
      this.win.contentView.addChildView(v.view, 0);
      v.wc.setZoomFactor(settings.get().zoom / 100);
      void v.wc.loadURL(this.initialUrl(id));
    }
    if (this.shown !== v && this.find) {
      this.shown?.wc.stopFindInPage('clearSelection');
      this.find = null;
    }
    this.shown = v;
    if (this.incognito) this.memActive = id;
    else Tabs.setActive(this.profile!, id);
    this.layout();
    this.push();
    if (!this.overlay) v.wc.focus();
  }

  newTab(url?: string, opts: { after?: string | null; foreground?: boolean } = {}): string {
    const target = url ?? START;
    if (this.incognito) {
      const m: MemTab = { id: `tab${Date.now()}${++this.memSeq}`, title: '', url: target === START ? homeUrl(true) : target };
      const i = opts.after ? this.memTabs.findIndex((x) => x.id === opts.after) : -1;
      if (i >= 0) this.memTabs.splice(i + 1, 0, m);
      else this.memTabs.push(m);
      if (opts.foreground !== false || !this.memActive) this.activate(m.id);
      else this.push();
      return m.id;
    }
    if (this.profile == null) {
      const last = Tabs.tabsFile.get().lastProfile ?? Profiles.order()[0];
      this.openProfile(last);
      // Профиль открыт в другом окне — вкладка откроется там.
      if (this.profile == null) {
        const other = ownerOf(last);
        return other && other !== this ? other.newTab(url, opts) : '';
      }
    }
    const tab = Tabs.add(this.profile!, target, { after: opts.after ?? null });
    if (opts.foreground !== false) this.activate(tab.id);
    else this.push();
    return tab.id;
  }

  /** Какая вкладка открыла эту (target=_blank, window.open): вкладка → открывшая. */
  private openers = new Map<string, string>();

  /** Вкладка, открывшая [tab], если она ещё жива. */
  openerOf(tab: TabView): TabView | undefined {
    const id = this.openers.get(tab.id);
    return id ? this.views.get(this.key(id)) : undefined;
  }

  /**
   * Вкладку открыли только ради файла (PDF-вложение в новом пустом окне): закрываем её и возвращаемся
   * к вкладке, которая её открыла. Исходную вкладку не перезагружаем (на Android это давало цикл).
   */
  closeBlankTab(tab: TabView): void {
    const opener = this.openerOf(tab);
    if (this.tabOf(tab.wc) !== tab) return;
    this.closeTab(tab.id);
    if (opener && this.tabOf(opener.wc) === opener) this.activate(opener.id);
  }

  /** Ссылка из своих экранов или извне: в текущем профиле (или последнем), в новой вкладке. */
  openUrl(url: string): void {
    if (this.panel && this.profile != null) this.closePanel();
    this.newTab(url);
  }

  closeTab(id: string | null = this.activeId()): void {
    if (!id) return;
    const strip = this.strip();
    const idx = strip.findIndex((s) => s.id === id);
    const key = this.key(id);
    const v = this.views.get(key);
    const wasActive = this.activeId() === id;
    if (v) {
      this.win.contentView.removeChildView(v.view);
      v.destroy();
      this.views.delete(key);
      if (this.shown === v) this.shown = null;
    }
    if (this.incognito) {
      const m = this.memTabs.find((x) => x.id === id);
      this.memTabs = this.memTabs.filter((x) => x.id !== id);
      if (m) this.memClosed.unshift({ ...m, url: v?.url() || m.url });
      if (!this.memTabs.length) {
        this.win.close();
        return;
      }
    } else if (this.profile != null) {
      if (Tabs.isTab(id)) Tabs.close(this.profile, [id]);
      // Закреплённая вкладка не исчезает: выгружается и возвращается к своему адресу.
      else Tabs.forgetPin(this.profile, id);
    }
    if (wasActive) {
      const rest = this.strip();
      const next = rest[Math.min(idx, rest.length - 1)] ?? rest[0];
      if (next) this.activate(next.id === id ? (rest[idx + 1]?.id ?? rest[0].id) : next.id);
    } else {
      this.push();
    }
    this.layout();
  }

  /** Закрыть вкладки профиля (экран вкладок, «Закрыть все»). Закреплённые остаются. */
  closeTabs(ids: string[]): void {
    if (this.profile == null) return;
    for (const id of ids.filter((x) => Tabs.isTab(x))) {
      const v = this.views.get(this.key(id));
      if (v) {
        this.win.contentView.removeChildView(v.view);
        v.destroy();
        this.views.delete(v.key);
        if (this.shown === v) this.shown = null;
      }
    }
    Tabs.close(this.profile, ids.filter((x) => Tabs.isTab(x)));
    if (!this.shown && !this.panel) this.activate(this.activeId()!);
    this.push();
  }

  reopenClosed(): void {
    if (this.incognito) {
      const m = this.memClosed.shift();
      if (m) this.newTab(m.url);
      return;
    }
    if (this.profile == null) return;
    const tab = Tabs.reopen(this.profile);
    if (tab) this.activate(tab.id);
  }

  cycle(delta: number): void {
    const strip = this.strip();
    if (!strip.length) return;
    const i = strip.findIndex((s) => s.id === this.activeId());
    this.activate(strip[(i + delta + strip.length) % strip.length].id);
  }

  activateIndex(n: number): void {
    const strip = this.strip();
    const tab = n === 9 ? strip[strip.length - 1] : strip[n - 1];
    if (tab) this.activate(tab.id);
  }

  moveTab(id: string, index: number): void {
    if (this.incognito) {
      const i = this.memTabs.findIndex((m) => m.id === id);
      if (i < 0) return;
      const [m] = this.memTabs.splice(i, 1);
      this.memTabs.splice(Math.max(0, Math.min(index, this.memTabs.length)), 0, m);
    } else if (this.profile != null) {
      Tabs.moveTo(this.profile, id, index);
    }
    this.push();
  }

  /** Ввод адресной строки: адрес или поисковый запрос. */
  navigate(input: string): void {
    const url = fromInput(input) ?? searchUrl(input.trim());
    if (isPanelUrl(url)) {
      if (!this.incognito) this.openPanel(url);
      return;
    }
    if (isOwnUrl(url) && url !== START && !url.startsWith('os://start')) return;
    if (!this.shown) {
      this.newTab(url);
      return;
    }
    this.shown.failedUrl = null;
    void this.shown.wc.loadURL(url.startsWith('os://start') ? homeUrl(this.incognito) : url);
    this.shown.wc.focus();
  }

  back(): void {
    if (this.panel && this.profile == null && this.page.webContents.navigationHistory.canGoBack()) {
      this.page.webContents.navigationHistory.goBack();
    } else if (this.panel) {
      this.closePanel();
    } else if (this.shown?.wc.navigationHistory.canGoBack()) this.shown.wc.navigationHistory.goBack();
  }

  forward(): void {
    if (this.shown?.wc.navigationHistory.canGoForward()) this.shown.wc.navigationHistory.goForward();
  }

  reload(ignoreCache = false): void {
    if (this.panel) return this.page.webContents.reload();
    const v = this.shown;
    if (!v) return;
    if (v.failedUrl) {
      const u = v.failedUrl;
      v.failedUrl = null;
      void v.wc.loadURL(u);
    } else v.reload(ignoreCache);
  }

  stop(): void {
    this.shown?.wc.stop();
  }

  goHome(): void {
    if (this.shown) void this.shown.wc.loadURL(homeUrl(this.incognito));
  }

  zoom(step: number): void {
    const wc = this.panel ? this.page.webContents : this.shown?.wc;
    if (!wc) return;
    const levels = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];
    const cur = wc.getZoomFactor();
    let next = 1;
    if (step !== 0) {
      const i = levels.findIndex((l) => l >= cur - 0.001);
      next = levels[Math.max(0, Math.min(levels.length - 1, (i < 0 ? levels.length - 1 : i) + step))];
    }
    wc.setZoomFactor(next);
    this.push();
  }

  owns(wc: WebContents): boolean {
    return [...this.views.values()].some((v) => v.wc === wc);
  }

  askPermission(wc: WebContents, host: string, kinds: string[], resolve: (allow: boolean, remember: boolean) => void, opts: AskOptions = {}): void {
    const p: Prompt = { id: ++promptSeq, wcId: wc.id, host, kinds, resolve, text: opts.text };
    this.prompts.push(p);
    // Вкладку закрыли или увели на другой сайт — запрос отклоняется (вопрос о скачивании переживает переход).
    const cancel = () => this.answerPrompt(p.id, false, false);
    const nav = (e: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (e.isMainFrame && !e.isSameDocument) { wc.off('did-start-navigation', nav); cancel(); }
    };
    wc.once('destroyed', cancel);
    if (!opts.keepOnNavigate) wc.on('did-start-navigation', nav);
    this.push();
  }

  answerPrompt(id: number, allow: boolean, remember: boolean): void {
    const i = this.prompts.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [p] = this.prompts.splice(i, 1);
    p.resolve(allow, remember && !this.incognito);
    this.push();
  }

  /** Вопрос о пароле для вкладки; новый вопрос той же вкладки заменяет старый. */
  askPassword(wc: WebContents, q: Omit<PwPrompt, 'id' | 'wcId'>): void {
    if (this.incognito) return;
    for (const old of this.pwPrompts.filter((x) => x.wcId === wc.id)) this.answerPassword(old.id, 'later');
    const p: PwPrompt = { ...q, id: ++promptSeq, wcId: wc.id };
    this.pwPrompts.push(p);
    const cancel = () => this.answerPassword(p.id, 'later');
    // Выбор аккаунта — только для этой страницы; «Сохранить?» живёт, пока вкладка на том же сайте (после входа сайт обычно переходит на другую страницу).
    const nav = (e: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (!e.isMainFrame || e.isSameDocument) return;
      let host = '';
      try { host = new URL(e.url).hostname.toLowerCase(); } catch { /* не адрес */ }
      if (p.kind === 'pick' || host !== p.host) { wc.off('did-start-navigation', nav); cancel(); }
    };
    wc.once('destroyed', cancel);
    wc.on('did-start-navigation', nav);
    this.push();
  }

  answerPassword(id: number, action: string): void {
    const i = this.pwPrompts.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [p] = this.pwPrompts.splice(i, 1);
    p.resolve(action);
    this.push();
  }

  private currentPw(): WindowState['pw'] {
    const wc = this.shown?.wc;
    const p = wc && !this.panel ? this.pwPrompts.find((x) => x.wcId === wc.id) : undefined;
    if (!p) return null;
    return { id: p.id, kind: p.kind, text: p.kind === 'save' ? t('password_save_q', p.host) : t('login_pick'), host: p.host, users: p.users };
  }

  private currentPrompt(): WindowState['prompt'] {
    const wc = this.shown?.wc;
    const p = wc && !this.panel ? this.prompts.find((x) => x.wcId === wc.id) : undefined;
    if (!p) return null;
    const text = p.text ? p.text : p.kinds.length === 2 ? t('perm_q_camera_mic', p.host) : t(Perms.kind(p.kinds[0])!.askKey, p.host);
    // Камера, микрофон и местоположение: «Запомнить» — только явным выбором (как в Chrome).
    const sensitive = p.kinds.some((k) => k === 'camera' || k === 'microphone' || k === 'location');
    return { id: p.id, text, canRemember: !this.incognito, rememberDefault: !sensitive };
  }

  // --- Блокировка ---

  lock(): void {
    if (!Lock.enabled() || this.locked) return;
    this.locked = true;
    this.overlay = false;
    void this.page.webContents.loadURL('os://lock/');
    this.layout();
    this.page.webContents.focus();
  }

  unlock(): void {
    this.locked = false;
    if (this.panel) void this.page.webContents.loadURL(this.panel);
    else void this.page.webContents.loadURL('about:blank');
    this.layout();
    this.push();
    this.shown?.wc.focus();
  }

  // --- Найти на странице (Ctrl+F) ---

  openFind(): void {
    if (this.panel || !this.shown) return;
    this.find ??= { text: '', active: 0, matches: 0 };
    this.layout();
    this.push();
    this.chrome.webContents.focus();
    this.chrome.webContents.send('os:event', 'focusFind', null);
  }

  findText(text: string, forward = true, next = false): void {
    const wc = this.shown?.wc;
    if (!wc || !this.find) return;
    this.find.text = text;
    if (!text) {
      wc.stopFindInPage('clearSelection');
      this.find.active = 0;
      this.find.matches = 0;
      this.push();
      return;
    }
    // В Electron findNext: true — начать новый поиск (новый текст), false — следующее совпадение.
    wc.findInPage(text, { forward, findNext: !next, matchCase: false });
  }

  onFound(wc: WebContents, r: Electron.Result): void {
    if (!this.find || wc !== this.shown?.wc) return;
    this.find.active = r.activeMatchOrdinal;
    this.find.matches = r.matches;
    this.push();
  }

  closeFind(): void {
    if (!this.find) return;
    this.shown?.wc.stopFindInPage('keepSelection');
    this.find = null;
    this.layout();
    this.push();
    this.shown?.wc.focus();
  }

  print(): void {
    if (this.panel) { this.page.webContents.print(); return; }
    this.shown?.wc.print({ silent: false, printBackground: true });
  }

  /** В избранное / убрать из избранного (Ctrl+D). Возвращает новое состояние или null, если страницу нельзя добавить. */
  toggleBookmark(): boolean | null {
    const v = this.shown;
    const url = v?.url() ?? '';
    if (!v || !isWebUrl(url) || this.panel) return null;
    const has = !!Bookmarks.findByUrl(url);
    if (has) Bookmarks.removeByUrl(url);
    else Bookmarks.add(v.wc.getTitle() || url, url);
    this.push();
    return !has;
  }

  /** Сохранить страницу в PDF для чтения без интернета (SavedPages.kt). */
  async savePage(): Promise<Saved.SavedPage | null> {
    const v = this.shown;
    if (!v || !isWebUrl(v.url()) || this.panel) return null;
    const pdf = await v.wc.printToPDF({ printBackground: true, generateDocumentOutline: true, generateTaggedPDF: true });
    return Saved.store(v.wc.getTitle(), v.url(), pdf, this.incognito);
  }

  /** Сообщение в шапке (как Toast на Android). */
  toast(text: string): void {
    this.chrome.webContents.send('os:event', 'toast', text);
  }

  activeWebContents(): WebContents | null {
    return this.shown?.wc ?? null;
  }

  /** Все живые вкладки окна (для приёмки и снимков сетки вкладок). */
  liveTabs(): TabView[] {
    return [...this.views.values()];
  }

  viewFor(profile: number, id: string): TabView | undefined {
    return this.views.get(`${profile}:${id}`);
  }

  /** Выход из аккаунтов профиля: закрыть его вкладки в окне. */
  dropProfileViews(profile: number): void {
    for (const [key, v] of [...this.views]) {
      if (!key.startsWith(`${profile}:`)) continue;
      this.win.contentView.removeChildView(v.view);
      v.destroy();
      this.views.delete(key);
      if (this.shown === v) this.shown = null;
    }
    if (this.profile === profile) this.showHome();
  }

  /** Тема или язык поменялись: шапку и экраны перерисовать, стартовые страницы — перезагрузить. */
  refreshLook(): void {
    const pal = this.palette();
    if (process.platform !== 'darwin') this.win.setTitleBarOverlay({ color: pal.surface, symbolColor: pal.text, height: ROW1 });
    this.win.setBackgroundColor(pal.bg);
    for (const wc of [this.chrome.webContents, this.page.webContents]) wc.send('os:event', 'look', null);
    for (const v of this.views.values()) {
      if (v.wc.getURL().startsWith('os://')) v.wc.reload();
    }
    this.push();
  }

  // --- TabHost ---

  onTabUpdated(): void {
    this.push();
  }

  onNavigated(tab: TabView, url: string): void {
    if (!this.incognito) {
      const p = Number(tab.key.split(':')[0]);
      const real = tab.url();
      // Страницу входа не запоминаем: после перезапуска вкладка не должна снова слать код подтверждения.
      if (isSignInPage(real)) { /* последний адрес вкладки остаётся прежним */ } else if (Tabs.isTab(tab.id)) Tabs.update(p, tab.id, { url: real.startsWith('os://start') ? START : real });
      else Tabs.setPinState(p, tab.id, real, tab.wc.getTitle());
      if (isWebUrl(url)) History.add(p, url);
    } else {
      const m = this.memTabs.find((x) => x.id === tab.id);
      if (m && isWebUrl(url)) m.url = url;
    }
    this.push();
  }

  onTitle(tab: TabView, title: string): void {
    if (!this.incognito) {
      const p = Number(tab.key.split(':')[0]);
      const url = tab.wc.getURL();
      if (isWebUrl(url)) {
        if (Tabs.isTab(tab.id)) Tabs.update(p, tab.id, { title });
        else Tabs.setPinState(p, tab.id, url, title);
        History.setTitle(p, url, title);
        Profiles.updateFromTitle(p, title);
      }
    } else {
      const m = this.memTabs.find((x) => x.id === tab.id);
      if (m) m.title = title;
    }
    this.push();
  }

  openTab(url: string, opener: TabView, foreground: boolean): void {
    if (!this.incognito && opener.key.split(':')[0] !== String(this.profile)) return;
    const id = this.newTab(url, { after: Tabs.isTab(opener.id) || this.incognito ? opener.id : null, foreground });
    this.openers.set(id, opener.id);
  }

  /** Ссылка новой вкладкой в фоне (как Chrome) и подсказка «Открыто в новой вкладке · Перейти»; в группе —
   *  в группу текущей вкладки, а без неё — новая группа из текущей и новой (openInGroup в BrowserActivity.kt). */
  openLink(url: string, opener: TabView, inGroup: boolean): void {
    if (this.incognito || this.profile == null) { this.openTab(url, opener, false); return; }
    const p = this.profile;
    let group: string | null = null;
    if (inGroup) {
      const current = Tabs.isTab(opener.id) ? Tabs.byId(p, opener.id) : undefined;
      group = current?.group && Tabs.groups(p).some((g) => g.id === current.group) ? current.group : null;
      if (!group) {
        const n = Tabs.groups(p).length;
        group = Tabs.addGroup(p, t('group_n', n + 1), Tabs.GROUP_COLORS[n % Tabs.GROUP_COLORS.length]).id;
        if (current) Tabs.setGroup(p, [current.id], group);
      }
    }
    const id = this.newTab(url, { after: Tabs.isTab(opener.id) ? opener.id : null, foreground: false });
    this.openers.set(id, opener.id);
    if (group) Tabs.setGroup(p, [id], group);
    this.push();
    this.toastGo(t('ctx_opened_in_tab'), () => this.activate(id));
  }

  openIncognitoUrl(url: string): void {
    openIncognito().navigate(url);
  }

  /** «Открыть в другом профиле»: вкладка добавляется в тот профиль, «Перейти» — открыть её там. */
  openInProfile(url: string, profile: number): void {
    if (!Profiles.exists(profile)) return;
    const tab = Tabs.add(profile, url);
    this.toastGo(t('ctx_opened_in_profile', Profiles.name(profile)), () => this.openProfile(profile, tab.id));
  }

  otherProfiles(): { id: number; name: string }[] {
    if (this.incognito) return [];
    return Profiles.sorted().filter((id) => id !== this.profile).map((id) => ({ id, name: Profiles.name(id) }));
  }

  isFavorite(url: string): boolean {
    return !!Bookmarks.findByUrl(url);
  }

  toggleFavorite(url: string, title: string): void {
    const has = this.isFavorite(url);
    if (has) Bookmarks.removeByUrl(url);
    else Bookmarks.add(title || url, url);
    this.push();
    this.toast(t(has ? 'fav_removed' : 'added_favorite'));
  }

  shareDone(): void {
    this.toast(t('link_copied'));
  }

  /** Действие кнопки «Перейти» в последней подсказке. */
  private toastAction: (() => void) | null = null;

  toastGo(text: string, go: () => void): void {
    this.toastAction = go;
    this.chrome.webContents.send('os:event', 'toast', { text, action: t('qs_go') });
  }

  runToastAction(): void {
    const go = this.toastAction;
    this.toastAction = null;
    go?.();
  }

  addNote(text: string, url: string): void {
    Notes.save(null, text, this.incognito ? '' : url);
    this.toast(t('note_added'));
  }

  searchText(text: string, opener: TabView): void {
    this.openTab(searchFor(text), opener, true);
  }

  shareText(text: string, tab: TabView, how: 'copy' | 'mail'): void {
    const url = tab.url();
    const quote = `«${text}»\n${url}`;
    if (how === 'copy') {
      clipboard.writeText(quote);
      this.toast(t('copied'));
    } else {
      openExternal(`mailto:?subject=${encodeURIComponent(tab.wc.getTitle())}&body=${encodeURIComponent(quote)}`);
    }
  }

  /** Режим чтения (№34): статья без лишнего; повторный вызов — выход. */
  async toggleReader(): Promise<void> {
    const v = this.shown;
    if (!v || this.panel) return;
    if (v.reader) {
      if (v.wc.navigationHistory.canGoBack()) v.wc.navigationHistory.goBack();
      else void v.wc.loadURL(v.url());
      return;
    }
    if (!isWebUrl(v.url())) { this.toast(t('web_only')); return; }
    const url = await Reader.extract(v.wc).catch(() => null);
    if (!url) { this.toast(t('dt_reader_none')); return; }
    void v.wc.loadURL(url);
  }

  tabOf(wc: WebContents): TabView | undefined {
    return [...this.views.values()].find((v) => v.wc === wc);
  }

  profileOfTab(tab: TabView): number | null {
    return this.incognito ? null : Number(tab.key.split(':')[0]);
  }

  parentWindow(): BrowserWindow {
    return this.win;
  }

  popupOptions(): Electron.BrowserWindowConstructorOptions {
    return {
      width: 520,
      height: 680,
      parent: this.win,
      autoHideMenuBar: true,
      backgroundColor: '#FFFFFF',
      webPreferences: { ...WEB_PREFS, session: this.session() },
    };
  }

  /** Горячие клавиши — как в Chrome. true — нажатие обработано. */
  shortcut(input: Electron.Input, wc: WebContents): boolean {
    if (input.type !== 'keyDown') return false;
    if (this.locked) return input.control || input.meta || input.alt || /^F\d+$/.test(input.key);
    const ctrl = input.control || input.meta;
    const k = input.key.length === 1 ? input.key.toLowerCase() : input.key;
    const code = input.code;
    const fromChrome = wc === this.chrome.webContents;
    if (ctrl && input.shift && (code === 'KeyT')) { this.reopenClosed(); return true; }
    if (ctrl && input.shift && code === 'KeyN') { openIncognito(); return true; }
    if (ctrl && !input.shift && code === 'KeyT') { this.newTab(); this.focusAddress(); return true; }
    // Ctrl+N — как в Chrome: новое окно (решение владельца 27.10). В инкогнито — новая вкладка инкогнито.
    if (ctrl && !input.shift && code === 'KeyN') {
      if (this.incognito) { this.newTab(); this.focusAddress(); } else openWindow(this);
      return true;
    }
    if (ctrl && code === 'KeyW') { if (this.panel && this.profile != null) this.closePanel(); else this.closeTab(); return true; }
    if (ctrl && (k === 'Tab' || k === 'PageDown' || k === 'PageUp')) {
      this.cycle(k === 'PageUp' || (k === 'Tab' && input.shift) ? -1 : 1);
      return true;
    }
    if (ctrl && !input.shift && /^Digit[1-9]$/.test(code)) { this.activateIndex(Number(code.slice(5))); return true; }
    if ((ctrl && code === 'KeyL') || (input.alt && code === 'KeyD') || k === 'F6') { this.focusAddress(); return true; }
    if (ctrl && input.alt && code === 'KeyR') { void this.toggleReader(); return true; }
    if (k === 'F5' || (ctrl && code === 'KeyR')) { this.reload(input.shift || ctrl && k === 'F5'); return true; }
    if (input.alt && k === 'ArrowLeft') { this.back(); return true; }
    if (input.alt && k === 'ArrowRight') { this.forward(); return true; }
    if (input.alt && k === 'Home') { this.goHome(); return true; }
    if (ctrl && (k === '=' || k === '+' || code === 'NumpadAdd')) { this.zoom(1); return true; }
    if (ctrl && (k === '-' || code === 'NumpadSubtract')) { this.zoom(-1); return true; }
    if (ctrl && (code === 'Digit0' || code === 'Numpad0')) { this.zoom(0); return true; }
    if (ctrl && !input.shift && code === 'KeyH' && !this.incognito) { this.openPanel(`os://history/?profile=${this.profile ?? Profiles.order()[0]}`); return true; }
    if (ctrl && !input.shift && code === 'KeyJ') { this.openPanel('os://downloads/'); return true; }
    // Как в Chrome: Ctrl+Shift+Del — «Удалить данные о работе в браузере».
    if (ctrl && input.shift && k === 'Delete' && this.profile != null) { this.openPanel(`os://clear/?profile=${this.profile}`); return true; }
    if (ctrl && input.shift && code === 'KeyO' && !this.incognito) { this.openPanel('os://favorites/'); return true; }
    if (ctrl && !input.shift && code === 'KeyD') {
      const r = this.toggleBookmark();
      if (r != null) this.toast(t(r ? 'added_favorite' : 'fav_removed'));
      return true;
    }
    if (ctrl && !input.shift && code === 'KeyF') {
      // На своих экранах (настройки, история…) — в их собственное поле поиска.
      if (this.panel) void this.page.webContents.executeJavaScript("document.querySelector('input[type=search]')?.focus()").catch(() => {});
      else this.openFind();
      return true;
    }
    if (ctrl && !input.shift && code === 'KeyP') { this.print(); return true; }
    if (k === 'F3') { if (this.find?.text) this.findText(this.find.text, !input.shift, true); else this.openFind(); return true; }
    if (k === 'Escape' && this.find && !this.panel) { this.closeFind(); return true; }
    if (ctrl && !input.shift && code === 'KeyS') { void saveWithToast(this); return true; }
    if (k === 'F11') { this.win.setFullScreen(!this.win.isFullScreen()); return true; }
    if (ctrl && input.shift && code === 'KeyA' && this.profile != null) { this.openPanel(`os://tabs/?profile=${this.profile}`); return true; }
    if (k === 'Escape' && !fromChrome) {
      if (this.panel && this.profile != null) { this.closePanel(); return true; }
      if (this.shown?.wc.isLoading()) { this.stop(); return false; }
    }
    return false;
  }

  focusAddress(): void {
    if (this.panel && this.profile != null) this.closePanel();
    this.chrome.webContents.focus();
    this.chrome.webContents.send('os:event', 'focusAddress', null);
  }

  private destroyAll(): void {
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    windows.delete(this);
    if (this.incogSession) {
      // Инкогнито не оставляет данных: всё, что было в памяти сессии, стираем сразу.
      void this.incogSession.clearStorageData();
      void this.incogSession.clearCache();
      this.incogSession = null;
    }
  }
}

export async function saveWithToast(w: OsWindow): Promise<void> {
  if (!w.activeWebContents() || !isWebUrl(w.activeWebContents()!.getURL())) { w.toast(t('web_only')); return; }
  w.toast(t('saving_page'));
  try {
    w.toast((await w.savePage()) ? t('page_saved') : t('save_failed'));
  } catch {
    w.toast(t('save_failed'));
  }
}

/**
 * Окно страницы расширения в сессии профиля: всплывающее (action.default_popup) — маленькое, без рамки,
 * у кнопки расширений и закрывается при потере фокуса; параметры — обычное окно. Мостов preload нет;
 * уйти со страниц расширения нельзя, веб-ссылки открываются вкладками профиля.
 */
export function openExtensionWindow(w: OsWindow, profile: number, url: string, anchor: { left: number; right: number; bottom: number } | null): BrowserWindow {
  const base = new URL(url).origin + '/';
  const popup = anchor != null;
  const cb = w.win.getContentBounds();
  const win = new BrowserWindow({
    width: popup ? 360 : 900,
    height: popup ? 420 : 700,
    show: false,
    parent: w.win,
    frame: !popup,
    resizable: !popup,
    minimizable: !popup,
    maximizable: !popup,
    skipTaskbar: popup,
    autoHideMenuBar: true,
    backgroundColor: '#FFFFFF',
    icon: join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { ...WEB_PREFS, session: profileSession(profile) },
  });
  const place = () => {
    if (!anchor || win.isDestroyed()) return;
    const [width] = win.getSize();
    const rtl = isRtl();
    win.setPosition(Math.round(cb.x + (rtl ? anchor.left : anchor.right - width)), Math.round(cb.y + anchor.bottom + 2));
  };
  place();
  const wc = win.webContents;
  const toTab = (target: string) => {
    if (!isWebUrl(target) || w.win.isDestroyed()) return;
    w.openProfile(profile);
    w.newTab(target);
  };
  wc.setWindowOpenHandler(({ url: target }) => { toTab(target); return { action: 'deny' }; });
  const guard = (e: Electron.Event, target: string) => {
    if (target.startsWith(base)) return;
    e.preventDefault();
    toTab(target);
  };
  wc.on('will-navigate', (e) => guard(e, e.url));
  wc.on('will-redirect', (e) => guard(e, e.url));
  wc.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && popup) { e.preventDefault(); win.close(); }
  });
  if (popup) {
    // Как в Chrome: размер — по содержимому страницы (в пределах 800×600).
    const fit = async () => {
      if (win.isDestroyed()) return;
      try {
        const s = await wc.executeJavaScript('(() => { const b = document.body, r = b ? b.getBoundingClientRect() : { right: 0, bottom: 0 }, st = b ? getComputedStyle(b) : null;' +
          ' const m = st ? parseFloat(st.marginRight) + parseFloat(st.marginBottom) : 0; return [r.right + m, r.bottom + m]; })()') as [number, number];
        if (win.isDestroyed() || !(s[0] > 40 && s[1] > 20)) return;
        win.setContentSize(Math.min(800, Math.max(160, Math.ceil(s[0]))), Math.min(600, Math.max(60, Math.ceil(s[1]))));
        place();
      } catch {
        // окно уже закрыли
      }
    };
    wc.on('did-finish-load', () => { void fit(); setTimeout(() => void fit(), 400); });
    win.on('blur', () => { if (!win.isDestroyed()) win.close(); });
  }
  win.once('ready-to-show', () => win.show());
  void wc.loadURL(url);
  return win;
}

export function profileInfo(id: number): ProfileInfo {
  return {
    id,
    name: Profiles.name(id),
    color: Profiles.color(id),
    email: Profiles.email(id),
    unread: Profiles.unread(id),
    description: Profiles.description(id),
    files: Profiles.fileCount(id),
    active: [...windows].some((w) => w.liveTabs().some((v) => v.key.startsWith(`${id}:`))),
    pins: Pins.all(id),
    ownPins: Pins.hasOwn(id),
    pinned: Profiles.isPinned(id),
    current: (Tabs.tabsFile.get().lastProfile ?? Profiles.sorted()[0]) === id,
    folder: Profiles.folderOf(id),
  };
}

function visibleBounds(b: { x?: number; y?: number; width: number; height: number }) {
  const width = Math.max(560, b.width);
  const height = Math.max(400, b.height);
  if (b.x == null || b.y == null) return { width, height };
  const area = screen.getDisplayMatching({ x: b.x, y: b.y, width, height }).workArea;
  const inside = b.x < area.x + area.width - 80 && b.y < area.y + area.height - 40 && b.x + width > area.x + 80 && b.y >= area.y - 8;
  return inside ? { x: b.x, y: b.y, width, height } : { width, height };
}

export function lockAll(): void {
  for (const w of windows) w.lock();
}

export function mainWindow(): OsWindow | undefined {
  return [...windows].find((w) => !w.incognito);
}

/** Окно, где профиль показан или где живут его вкладки. */
export function ownerOf(profile: number): OsWindow | undefined {
  const normal = [...windows].filter((w) => !w.incognito);
  return normal.find((w) => w.profile === profile) ?? normal.find((w) => w.liveTabs().some((v) => v.key.startsWith(`${profile}:`)));
}

/** Окно для профиля: где он уже открыт, иначе первое обычное. */
export function windowFor(profile: number | null): OsWindow | undefined {
  return (profile != null ? ownerOf(profile) : undefined) ?? mainWindow();
}

/**
 * Новое обычное окно (Ctrl+N): со смещением от текущего, на экране профилей — выбрать, какой профиль
 * держать рядом. Профиль, открытый в другом окне, там и откроется.
 */
export function openWindow(from?: OsWindow): OsWindow {
  const w = new OsWindow({ from });
  if (from?.locked) w.lock();
  w.showHome();
  w.win.focus();
  return w;
}

export function openIncognito(): OsWindow {
  const w = new OsWindow({ incognito: true });
  w.win.focus();
  return w;
}

export function byWebContents(wc: WebContents): { win: OsWindow; role: 'chrome' | 'page' } | null {
  for (const w of windows) {
    if (w.chrome.webContents === wc) return { win: w, role: 'chrome' };
    if (w.page.webContents === wc) return { win: w, role: 'page' };
  }
  return null;
}

// --- Скачивание и отправка файлов: разрешения сайта (§4) ---

/** Вкладка ещё ничего не показала — её открыли только ради файла. */
const isBlank = (tab: TabView) => {
  const u = tab.wc.mainFrame?.url ?? '';
  return (!u || u === 'about:blank') && !tab.wc.navigationHistory.canGoBack() && (Tabs.isTab(tab.id) || tab.key.startsWith('i:'));
};

/**
 * Можно ли сайту скачать файл: «Запретить» — загрузка не начинается, «Разрешить» — сразу, «Спросить»
 * (по умолчанию) — файл качается, а в окне висит карточка вопроса; «Запретить» в ней удаляет файл.
 */
function downloadGate(r: Downloads.GateRequest): Downloads.GateAnswer {
  const wc = r.wc && !r.wc.isDestroyed() ? r.wc : null;
  const w = wc ? [...windows].find((x) => x.owns(wc)) : undefined;
  const tab = w && wc ? w.tabOf(wc) : undefined;
  const blank = !!tab && isBlank(tab);
  const opener = blank && w ? w.openerOf(tab!) : undefined;
  // Чей это файл: страница вкладки, а у пустой вкладки — страница, которая её открыла.
  const page = blank ? opener?.url() ?? '' : tab?.url() ?? '';
  const host = hostOf(isWebUrl(page) ? page : r.url);
  const mode = host ? permissionMode(r.ses, host, 'downloads') : 'ALLOW';
  if (blank) setTimeout(() => { if (!tab!.wc.isDestroyed()) w!.closeBlankTab(tab!); }, 0);
  if (mode === 'BLOCK') {
    w?.toast(t('perm_blocked_for', t('perm_downloads'), host));
    return 'block';
  }
  if (mode === 'ALLOW' || !w) return 'allow';
  return new Promise<boolean>((resolve) => {
    const ask = () => {
      const target = blank ? (opener && !opener.wc.isDestroyed() ? opener.wc : w.activeWebContents()) : wc;
      if (!target || target.isDestroyed()) { resolve(true); return; }
      w.askPermission(target, host, ['downloads'], (allow, remember) => {
        if (remember) sessionRemember.get(r.ses)?.(host, 'downloads', allow);
        resolve(allow);
      }, { text: t('perm_q_downloads', host, r.name), keepOnNavigate: true });
    };
    if (blank) setTimeout(ask, 0);
    else ask();
  });
}
Downloads.setGate(downloadGate);

/**
 * Отправка файлов (<input type=file>): preload вкладки спрашивает перед окном выбора файла.
 * По умолчанию «Разрешено»; «Запретить» — окно не открывается; «Спросить» — карточка, после «Разрешить»
 * окно выбора открывается (жест пользователя даёт главный процесс).
 */
export function installUploads(): void {
  ipcMain.on('tab:upload', (e) => {
    let mode: Perms.Mode = 'ALLOW';
    for (const w of windows) {
      const tab = w.tabOf(e.sender);
      if (!tab) continue;
      const host = hostOf(tab.url());
      if (!host) break;
      mode = permissionMode(tab.wc.session, host, 'uploads');
      if (mode === 'BLOCK') w.toast(t('perm_blocked_for', t('perm_uploads'), host));
      if (mode === 'ASK') {
        const wc = tab.wc;
        w.askPermission(wc, host, ['uploads'], (allow, remember) => {
          if (remember) sessionRemember.get(wc.session)?.(host, 'uploads', allow);
          if (!allow || wc.isDestroyed()) return;
          void wc.executeJavaScript('0', true).then(() => { if (!wc.isDestroyed()) wc.send('tab:upload-go'); }).catch(() => {});
        }, { text: t('perm_q_uploads', host) });
      }
      break;
    }
    e.returnValue = mode;
  });
}
