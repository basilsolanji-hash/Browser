import { app, session, shell, type Session, type WebContents } from 'electron';
import { isWebUrl } from './urls';
import { currentLang } from './i18n';

/**
 * Правила безопасности Electron (§7 ТЗ): песочница, без Node и <webview>, свои страницы — только os://,
 * сайтам — только http(s), внешние программы — только для http(s) и mailto.
 */

/** Чистый UA Chrome без «Electron/…» и имени приложения: иначе часть сайтов (вход Google) отказывает. */
export function cleanUserAgent(): string {
  return app.userAgentFallback
    .replace(/\s?Electron\/\S+/g, '')
    .replace(new RegExp(`\\s?${app.getName().replace(/[^\w]/g, '.')}\\/\\S+`, 'gi'), '')
    .replace(/\s?os-browser\/\S+/gi, '');
}

export const WEB_PREFS = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: false, // проверка орфографии Chromium качает словари из сети
  navigateOnDragDrop: false,
  safeDialogs: true,
  // Звук — после действия пользователя на странице, как в Chrome: видео, запущенное плеером сайта чуть
  // позже нажатия, играет со звуком, а сам по себе сайт звук не включит.
  autoplayPolicy: 'document-user-activation-required',
} as const;

/** Открыть во внешней программе — только веб-адреса и почту. */
export function openExternal(url: string): void {
  if (isWebUrl(url) || /^mailto:/i.test(url)) void shell.openExternal(url);
}

/** Системные настройки Windows — только этот список адресов (ms-settings:), остальное — нельзя. */
const SYSTEM_SETTINGS = /^ms-settings:(privacy-webcam|privacy-microphone|privacy-location|defaultapps(\?registeredAppUser=Os%20Browser)?)$/;
export function openSystemSettings(uri: string): void {
  if (process.platform === 'win32' && SYSTEM_SETTINGS.test(uri)) void shell.openExternal(uri);
}

const hardened = new WeakSet<Session>();
const live: WeakRef<Session>[] = [];

/** Язык сайтов (Accept-Language) = язык приложения, запасной — английский. */
const acceptLanguages = () => {
  const l = currentLang();
  return l === 'en' ? 'en-US,en' : `${l},en-US;q=0.8,en;q=0.7`;
};

/** После смены языка приложения — новый Accept-Language во всех сессиях. */
export function applyAcceptLanguage(): void {
  for (const r of live) r.deref()?.setUserAgent(cleanUserAgent(), acceptLanguages());
}

/** Общие правила сессии профиля или инкогнито. Разрешения — «нет», пока нет экрана «спросить» (этап 3). */
export function hardenSession(ses: Session): void {
  if (hardened.has(ses)) return;
  hardened.add(ses);
  live.push(new WeakRef(ses));
  ses.setUserAgent(cleanUserAgent(), acceptLanguages());
  // Проверка орфографии в Linux качает словари с серверов Google — выключаем полностью.
  ses.setSpellCheckerEnabled(false);
  try { ses.setSpellCheckerLanguages([]); } catch { /* в Windows и macOS — системная проверка */ }
  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  ses.setDevicePermissionHandler(() => false);
  ses.on('select-hid-device', (e, _d, cb) => { e.preventDefault(); cb(''); });
  ses.on('select-serial-port', (e, _d, _wc, cb) => { e.preventDefault(); cb(''); });
  ses.on('select-usb-device', (e, _d, cb) => { e.preventDefault(); cb(); });
}

/** Для всех webContents: никаких <webview> и навигаций своих страниц на чужие адреса. */
export function installGlobalGuards(): void {
  app.on('web-contents-created', (_e, wc: WebContents) => {
    wc.on('will-attach-webview', (ev) => ev.preventDefault());
  });
  hardenSession(session.defaultSession);
}
