import { ipcMain, type IpcMainEvent, type WebFrameMain } from 'electron';
import { windows, type OsWindow } from './window';
import * as Passwords from './passwords';
import { originOf, sameSite, type Login } from './backupcrypto';
import type { TabView } from './tabview';
import { broadcast } from './ipc';

/**
 * Пароли на сайтах: preload вкладки (изолированный мир) сообщает о форме входа и об отправке логина
 * с паролем. Здесь решаем всё сами: только вкладки сайтов (http/https, главный фрейм), не инкогнито;
 * пароль отдаётся только странице того же сайта и только из профиля этой вкладки.
 */
interface Who { w: OsWindow; tab: TabView; profile: number; url: URL; frame: WebFrameMain }

function who(e: IpcMainEvent): Who | null {
  const frame = e.senderFrame;
  if (!frame || frame !== e.sender.mainFrame) return null;
  for (const w of windows) {
    const tab = w.tabOf(e.sender);
    if (!tab) continue;
    const profile = w.profileOfTab(tab);
    if (w.incognito || profile == null) return null;
    let url: URL;
    try { url = new URL(frame.url); } catch { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { w, tab, profile, url, frame };
  }
  return null;
}

/** Вход подходит странице: тот же сайт (как в Android) и пароль с https не уходит на http. */
function fits(l: Login, url: URL): boolean {
  if (!sameSite(l.o, url.hostname)) return false;
  return !(l.o.startsWith('https:') && url.protocol === 'http:');
}

function fill(frame: WebFrameMain, l: Login): void {
  try { frame.send('tab:pw-fill', { u: l.u, p: l.p }); } catch { /* страница уже закрыта */ }
}

function onForm(e: IpcMainEvent): void {
  const x = who(e);
  if (!x) return;
  const logins = Passwords.forDomain(x.profile, x.url.hostname).filter((l) => fits(l, x.url));
  if (!logins.length) return;
  if (logins.length === 1) { fill(x.frame, logins[0]); return; }
  const wc = x.tab.wc;
  x.w.askPassword(wc, {
    kind: 'pick', host: x.url.hostname.toLowerCase(), users: logins.map((l) => ({ g: l.g, u: l.u || '—' })),
    resolve: (action) => {
      if (wc.isDestroyed()) return;
      const l = logins.find((y) => y.g === action);
      // Пока пользователь выбирал, страница могла смениться: проверяем адрес ещё раз.
      let now: URL;
      try { now = new URL(wc.mainFrame.url); } catch { return; }
      if (l && fits(l, now) && x.w.profileOfTab(x.tab) === x.profile) fill(wc.mainFrame, l);
    },
  });
}

function onSubmit(e: IpcMainEvent, raw: unknown): void {
  const x = who(e);
  if (!x || typeof raw !== 'string' || raw.length > 4000) return;
  let d: { u?: unknown; p?: unknown };
  try { d = JSON.parse(raw); } catch { return; }
  const user = typeof d.u === 'string' ? d.u.trim().slice(0, 300) : '';
  const pass = typeof d.p === 'string' ? d.p.slice(0, 1000) : '';
  if (!pass || !Passwords.offer() || !Passwords.available()) return;
  const host = x.url.hostname.toLowerCase();
  if (Passwords.never(x.profile).includes(host)) return;
  const origin = originOf(x.url.href)!;
  // Уже сохранён с тем же паролем — не спрашиваем.
  if (Passwords.list(x.profile).some((l) => l.o === origin && l.u === user && l.p === pass)) return;
  const profile = x.profile;
  x.w.askPassword(x.tab.wc, {
    kind: 'save', host, users: [],
    resolve: (action) => {
      if (action === 'save') Passwords.upsert(profile, origin, user, pass);
      else if (action === 'never') Passwords.setNever(profile, host, true);
      else return;
      broadcast();
    },
  });
}

export function installAutofill(): void {
  ipcMain.on('tab:pw-form', onForm);
  ipcMain.on('tab:pw-submit', onSubmit);
}
