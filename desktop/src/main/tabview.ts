import { BrowserWindow, Menu, WebContentsView, clipboard, type Session, type WebContents } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceOf } from './reader';
import { WEB_PREFS, cleanUserAgent, openExternal } from './security';
import { isWebUrl } from './urls';
import { t } from './i18n';
import { resetTab } from './privacy';
import * as Diag from './diag';

/** «Мобильная версия» сайта: User-Agent Chrome для Android (без версии устройства). */
const mobileUa = () => cleanUserAgent().replace(/\([^)]*\)/, '(Linux; Android 10; K)').replace(/ Safari\//, ' Mobile Safari/');

/**
 * Одна вкладка — один WebContentsView в сессии профиля (или инкогнито). Мостов preload у сайтов нет.
 * События навигации передаются окну через [TabHost].
 */
export interface TabHost {
  onTabUpdated(tab: TabView): void;
  onNavigated(tab: TabView, url: string): void;
  onTitle(tab: TabView, title: string): void;
  openTab(url: string, opener: TabView, foreground: boolean): void;
  popupOptions(): Electron.BrowserWindowConstructorOptions;
  addNote(text: string, url: string): void;
  searchText(text: string, opener: TabView): void;
  shareText(text: string, tab: TabView, how: 'copy' | 'mail'): void;
  shortcut(input: Electron.Input, wc: WebContents): boolean;
  onFound(wc: WebContents, r: Electron.Result): void;
}

const AUTH_HOSTS = new Set([
  'accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com', 'login.live.com', 'oauth.yandex.ru', 'id.vk.com',
]);

/** Окно входа («Войти через Google» и т.п.) должно быть настоящим окном с opener (как Popups.kt). */
export function isAuthPopup(url: string): boolean {
  try {
    const u = new URL(url);
    return AUTH_HOSTS.has(u.hostname) || /oauth|authorize/i.test(u.pathname) || u.searchParams.get('display') === 'popup';
  } catch {
    return false;
  }
}

/**
 * «Предложить надёжный пароль» на формах регистрации — тот же скрипт, что расширение Android
 * (assets/pwgen/pwgen.js), в своём изолированном мире: сайт не видит ни код, ни генератор.
 */
const PWGEN_WORLD = 1998;
let pwgen: string | null = null;
function suggestPasswords(wc: WebContents): void {
  if (!isWebUrl(wc.getURL())) return;
  try {
    pwgen ??= readFileSync(join(__dirname, '..', 'content', 'pwgen.js'), 'utf8');
  } catch {
    return;
  }
  wc.executeJavaScriptInIsolatedWorld(PWGEN_WORLD, [{ code: pwgen }]).catch(() => { /* страница ушла */ });
}

/** Схемы, которые сайт может открыть сам: только веб. Почта — во внешней программе. */
function allowedFromSite(url: string): boolean {
  return isWebUrl(url) || url === 'about:blank';
}

export class TabView {
  readonly view: WebContentsView;
  favicon: string | null = null;
  /** Открытое со страницы окно входа (не больше одного на вкладку). */
  private popup: BrowserWindow | null = null;
  /** Адрес, который не открылся (на экране — страница ошибки os://error). */
  failedUrl: string | null = null;
  /** Сайт открыт в мобильной версии (пункт меню с галочкой). */
  mobile = false;

  constructor(readonly key: string, readonly id: string, ses: Session, private host: TabHost, bg: string) {
    // Preload вкладки — только для веб-уведомлений (см. preload/tab.ts), мостов в window нет.
    this.view = new WebContentsView({ webPreferences: { ...WEB_PREFS, session: ses, preload: join(__dirname, '..', 'preload', 'tab.js') } });
    this.view.setBackgroundColor(bg);
    const wc = this.view.webContents;
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (!allowedFromSite(url)) return { action: 'deny' };
      // Окно входа — настоящее окно с opener, но одно на вкладку; второе открывается вкладкой.
      if (isAuthPopup(url) && (!this.popup || this.popup.isDestroyed())) {
        return { action: 'allow', overrideBrowserWindowOptions: this.host.popupOptions() };
      }
      this.host.openTab(url, this, disposition !== 'background-tab');
      return { action: 'deny' };
    });
    wc.on('did-create-window', (win) => this.guardPopup(win));
    wc.on('found-in-page', (_e, r) => this.host.onFound(wc, r));
    const guard = (e: Electron.Event, url: string) => {
      if (allowedFromSite(url)) return;
      e.preventDefault();
      if (/^mailto:/i.test(url)) openExternal(url);
    };
    wc.on('will-navigate', (e) => guard(e, e.url));
    wc.on('will-redirect', (e) => guard(e, e.url));
    wc.on('will-frame-navigate', (e) => { if (!e.isMainFrame && !allowedFromSite(e.url) && !e.url.startsWith('data:')) e.preventDefault(); });
    wc.on('did-start-loading', () => this.host.onTabUpdated(this));
    wc.on('did-stop-loading', () => this.host.onTabUpdated(this));
    wc.on('dom-ready', () => suggestPasswords(wc));
    // Счётчик трекеров — с начала перехода: запросы страницы могут блокироваться раньше did-navigate.
    wc.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) resetTab(wc.id); });
    wc.on('did-navigate', (_e, url, code) => {
      Diag.log(this.id, `${code || ''} ${url.slice(0, 200)}`);
      if (!url.startsWith('os://error')) this.failedUrl = null;
      this.favicon = null;
      this.host.onNavigated(this, url);
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) this.host.onNavigated(this, url); });
    wc.on('page-title-updated', (_e, title) => this.host.onTitle(this, title));
    wc.on('page-favicon-updated', (_e, icons) => void this.loadFavicon(ses, icons[0]));
    wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
      // -3 — навигацию отменили (новая загрузка, скачивание): это не ошибка.
      if (!isMainFrame || code === -3 || !isWebUrl(url)) return;
      Diag.log(this.id, `error ${code} ${_desc} ${url.slice(0, 200)}`);
      this.failedUrl = url;
      void wc.loadURL(`os://error/?code=${code}&url=${encodeURIComponent(url)}`);
    });
    wc.on('before-input-event', (e, input) => { if (this.host.shortcut(input, wc)) e.preventDefault(); });
    wc.on('context-menu', (_e, p) => this.contextMenu(p));
    wc.on('render-process-gone', (_e, d) => { Diag.log(this.id, `renderer ${d.reason}`); this.host.onTabUpdated(this); });
    wc.on('unresponsive', () => Diag.log(this.id, 'unresponsive'));
  }

  get wc(): WebContents {
    return this.view.webContents;
  }

  /** Адрес для адресной строки: у страницы ошибки — адрес, который не открылся. */
  url(): string {
    const u = this.wc.getURL();
    if (u.startsWith('os://reader')) return sourceOf(u) ?? u;
    return u.startsWith('os://error') && this.failedUrl ? this.failedUrl : u;
  }

  /** Мобильная версия сайта для этой вкладки: другой User-Agent, страница перезагружается. */
  setMobile(on: boolean): void {
    this.mobile = on;
    this.wc.setUserAgent(on ? mobileUa() : cleanUserAgent());
    this.wc.reload();
  }

  /** Сейчас показан режим чтения. */
  get reader(): boolean {
    return this.wc.getURL().startsWith('os://reader');
  }

  /** Значок сайта качаем в сессии профиля и отдаём интерфейсу как data: (интерфейс в сеть не ходит). */
  private async loadFavicon(ses: Session, url: string | undefined): Promise<void> {
    if (!url || !/^https?:|^data:image\//.test(url)) return;
    try {
      if (url.startsWith('data:')) {
        this.favicon = url.length < 100_000 ? url : null;
      } else {
        const res = await ses.fetch(url, { credentials: 'include' });
        const type = res.headers.get('content-type') ?? 'image/x-icon';
        const buf = Buffer.from(await res.arrayBuffer());
        if (!res.ok || buf.length > 64_000 || !/^image\//.test(type)) return;
        this.favicon = `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
      }
      this.host.onTabUpdated(this);
    } catch {
      // Нет значка — покажем букву сайта.
    }
  }

  private contextMenu(p: Electron.ContextMenuParams): void {
    const wc = this.wc;
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (p.linkURL && allowedFromSite(p.linkURL)) {
      items.push(
        { label: t('dt_open_link_new_tab'), click: () => this.host.openTab(p.linkURL, this, false) },
        { label: t('copy_link'), click: () => clipboard.writeText(p.linkURL) },
        { type: 'separator' },
      );
    }
    if (p.isEditable) {
      items.push(
        { label: t('dt_cut'), role: 'cut', enabled: p.editFlags.canCut },
        { label: t('copy'), role: 'copy', enabled: p.editFlags.canCopy },
        { label: t('dt_paste'), role: 'paste', enabled: p.editFlags.canPaste },
        { label: t('select_all'), role: 'selectAll' },
      );
    } else if (p.selectionText.trim()) {
      // Действия с выделенным текстом (PageTools.kt → TextActions): своя фишка — «Добавить в заметку».
      const text = p.selectionText.trim();
      const short = text.length > 24 ? text.slice(0, 23) + '…' : text;
      items.push(
        { label: t('copy'), role: 'copy' },
        { label: t('add_to_note'), click: () => this.host.addNote(text, this.url()) },
        { label: t('share'), submenu: [
          { label: t('dt_share_copy'), click: () => this.host.shareText(text, this, 'copy') },
          { label: t('dt_share_mail'), click: () => this.host.shareText(text, this, 'mail') },
        ] },
        { label: t('dt_search_for', short), click: () => this.host.searchText(text, this) },
      );
    }
    if (p.mediaType === 'image' && isWebUrl(p.srcURL)) {
      items.push({ label: t('dt_copy_image_link'), click: () => clipboard.writeText(p.srcURL) });
    }
    if (!items.length || items[items.length - 1].type !== 'separator') items.push({ type: 'separator' });
    items.push(
      { label: t('back'), enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: t('forward'), enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: t('refresh'), click: () => wc.reload() },
    );
    Menu.buildFromTemplate(items).popup();
  }

  /**
   * Окно входа живёт по тем же правилам, что вкладка: только веб-адреса, новые окна из него —
   * вкладками в окне браузера, в заголовке всегда виден сайт (адресной строки у попапа нет).
   */
  private guardPopup(win: BrowserWindow): void {
    this.popup = win;
    const pwc = win.webContents;
    const host = () => { try { return new URL(pwc.getURL()).host; } catch { return ''; } };
    pwc.setWindowOpenHandler(({ url }) => {
      if (allowedFromSite(url)) this.host.openTab(url, this, true);
      return { action: 'deny' };
    });
    const guard = (e: Electron.Event, url: string) => {
      if (allowedFromSite(url)) return;
      e.preventDefault();
      if (/^mailto:/i.test(url)) openExternal(url);
    };
    pwc.on('will-navigate', (e) => guard(e, e.url));
    pwc.on('will-redirect', (e) => guard(e, e.url));
    pwc.on('will-frame-navigate', (e) => { if (!e.isMainFrame && !allowedFromSite(e.url) && !e.url.startsWith('data:')) e.preventDefault(); });
    pwc.on('page-title-updated', (e, title) => { e.preventDefault(); win.setTitle(`${host()} — ${title}`); });
    pwc.on('did-navigate', () => win.setTitle(host()));
    win.on('closed', () => { if (this.popup === win) this.popup = null; });
  }

  destroy(): void {
    if (this.popup && !this.popup.isDestroyed()) this.popup.close();
    try {
      if (!this.wc.isDestroyed()) this.wc.close();
    } catch {
      // уже закрыта
    }
  }
}
