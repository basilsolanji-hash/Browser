import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { settings } from './settings';

/**
 * Автообновление (этап 5): electron-updater из GitHub Releases, только по HTTPS. Источник — постоянный
 * релиз «desktop-latest» (latest.yml + установщик). Подписи кода пока нет (§9 ТЗ): файл проверяется
 * по sha512 из latest.yml; проверку подписи включить после появления сертификата.
 * Отключается в настройках; в сборке из исходников не работает.
 */
export const FEED = 'https://github.com/basilsolanji-hash/Browser/releases/download/desktop-latest';

export type UpdateState = 'off' | 'dev' | 'idle' | 'checking' | 'none' | 'available' | 'downloaded' | 'error';
let state: UpdateState = 'idle';
let version = '';
let onChange: () => void = () => {};
let timer: NodeJS.Timeout | null = null;
let wired = false;

export const status = () => ({ state: supported() ? (settings.get().autoUpdate ? state : 'off') : 'dev', version });
export const setListener = (fn: () => void) => { onChange = fn; };
const supported = () => app.isPackaged && process.platform === 'win32';

function set(s: UpdateState, v = version): void {
  state = s;
  version = v;
  onChange();
}

function wire(): void {
  if (wired) return;
  wired = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: FEED });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => set('checking'));
  autoUpdater.on('update-not-available', () => set('none'));
  autoUpdater.on('update-available', (i) => set('available', i.version));
  autoUpdater.on('update-downloaded', (i) => set('downloaded', i.version));
  autoUpdater.on('error', (e) => { console.error('[update]', e?.message); set('error'); });
}

export function check(): void {
  if (!supported() || !settings.get().autoUpdate) return;
  wire();
  void autoUpdater.checkForUpdates().catch(() => set('error'));
}

/** Проверять через минуту после запуска и потом раз в 6 часов. */
export function start(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (!supported() || !settings.get().autoUpdate) { onChange(); return; }
  setTimeout(check, 60_000);
  timer = setInterval(check, 6 * 3600_000);
}

export function restartAndInstall(): void {
  if (state === 'downloaded') autoUpdater.quitAndInstall();
}
