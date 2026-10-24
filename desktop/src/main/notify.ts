import { Notification, ipcMain, type IpcMainEvent } from 'electron';
import { windows, permissionMode } from './window';
import * as Profiles from './profiles';
import { t } from './i18n';

/**
 * Уведомления сайтов → уведомления Windows (Notify.kt): в заголовке — имя профиля, нажатие открывает
 * вкладку. Только пока вкладка открыта (push при закрытом браузере требует сервера, §9 ТЗ).
 */
interface Shown { title: string; body: string; profile: number | null; tab: string; n: Notification }
const shown: Shown[] = [];
export const shownForTest = () => shown.map((s) => ({ title: s.title, body: s.body, profile: s.profile, tab: s.tab }));

function onNotify(e: IpcMainEvent, raw: unknown): void {
  if (typeof raw !== 'string') return;
  let d: { id?: unknown; title?: unknown; body?: unknown };
  try { d = JSON.parse(raw); } catch { return; }
  for (const w of windows) {
    const tab = w.tabOf(e.sender);
    if (!tab) continue;
    let host: string;
    try { host = new URL(tab.url()).hostname.toLowerCase(); } catch { return; }
    // Разрешение проверяем сами: страница могла подделать событие.
    if (permissionMode(tab.wc.session, host, 'notifications') !== 'ALLOW') return;
    const profile = w.profileOfTab(tab);
    const who = profile == null ? t('incognito') : Profiles.name(profile);
    const title = `${who} · ${String(d.title ?? '').slice(0, 200)}`;
    const body = String(d.body ?? '').slice(0, 500) || host;
    const n = new Notification({ title, body, silent: false });
    const id = String(d.id ?? '');
    n.on('click', () => {
      if (w.win.isDestroyed()) return;
      if (w.win.isMinimized()) w.win.restore();
      w.win.focus();
      if (profile != null) w.openProfile(profile, tab.id);
      else w.activate(tab.id);
      if (!tab.wc.isDestroyed()) tab.wc.send('tab:notify-click', id);
    });
    shown.push({ title, body, profile, tab: tab.id, n });
    if (shown.length > 50) shown.shift();
    if (Notification.isSupported()) n.show();
    return;
  }
}

export function installNotifications(): void {
  ipcMain.on('tab:notify', onNotify);
}

/** Для приёмки: «нажать» на последнее уведомление. */
export function clickLastForTest(): void {
  shown[shown.length - 1]?.n.emit('click');
}
