import { app, shell } from 'electron';
import { execFile } from 'node:child_process';
import { fromInput, isWebUrl } from './urls';

/**
 * Браузер по умолчанию (№26). Установщик регистрирует ProgId «OsBrowserURL» и возможности приложения
 * (assets/installer.nsh); стать браузером по умолчанию программно в Windows 10/11 нельзя — открываем
 * системные «Приложения по умолчанию».
 */
export const PROG_ID = 'OsBrowserURL';

export function isDefault(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId'],
      { windowsHide: true, timeout: 5000 }, (err, out) => resolve(!err && out.includes(PROG_ID)));
  });
}

export function openSystemSettings(): void {
  if (process.platform === 'win32') void shell.openExternal('ms-settings:defaultapps?registeredAppUser=Os%20Browser');
}

/** Адрес из командной строки (как DefaultBrowser.incomingUrl): только http(s). */
export function incomingUrl(argv: string[]): string | null {
  // Первые аргументы — сам exe (и путь к приложению при запуске из исходников).
  for (const a of argv.slice(app.isPackaged ? 1 : 2)) {
    if (a.startsWith('-')) continue;
    const u = fromInput(a);
    if (u && isWebUrl(u)) return u;
  }
  return null;
}
