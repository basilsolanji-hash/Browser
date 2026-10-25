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

let defaultCache = false;
/** Последний известный ответ «Ось — браузер по умолчанию» (меню показывает пункт без ожидания). */
export const isDefaultCached = () => defaultCache;
export async function refreshDefault(): Promise<boolean> {
  defaultCache = await isDefault();
  return defaultCache;
}

export interface OtherBrowser { name: string; exe: string }

/** Другие браузеры, установленные в Windows (StartMenuInternet), — для «Открыть в другом браузере». */
export function otherBrowsers(): Promise<OtherBrowser[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const read = (root: string) => new Promise<string>((resolve) => {
    execFile('reg', ['query', `${root}\\SOFTWARE\\Clients\\StartMenuInternet`, '/s'], { windowsHide: true, timeout: 5000, maxBuffer: 1 << 20 },
      (err, out) => resolve(err ? '' : out));
  });
  return Promise.all([read('HKCU'), read('HKLM')]).then((outs) => {
    const found = new Map<string, OtherBrowser>();
    for (const out of outs) {
      let key = '';
      let name = '';
      for (const line of out.split(/\r?\n/)) {
        const k = /^HKEY_[^\\]+\\SOFTWARE\\Clients\\StartMenuInternet\\([^\\]+)(\\.*)?$/i.exec(line.trim());
        if (k) {
          if (!k[2]) { key = k[1]; name = key; }
          continue;
        }
        const v = /^\s+\(.*\)\s+REG_\w+\s+(.+)$/.exec(line);
        if (!v || !key || /^OsBrowser/i.test(key)) continue;
        if (!found.has(key) && !/\.exe/i.test(v[1])) name = v[1].trim();
        const exe = /^"([^"]+\.exe)"|^(\S+\.exe)/i.exec(v[1].trim());
        if (exe && !found.has(key)) found.set(key, { name, exe: exe[1] ?? exe[2] });
      }
    }
    return [...found.values()];
  });
}
