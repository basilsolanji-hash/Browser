import { desktopCapturer, webContents, type DesktopCapturerSource, type Session, type WebContents } from 'electron';
import type { Mode } from './permissions';
import { decideDisplay } from './displayrule';

/**
 * Показ экрана на сайтах (getDisplayMedia). Решение по запросу принимает чистая decideDisplay
 * (проверяется unit-тестом): всё, что не «спросить», и любая неясность — отказ.
 * Содержимое экрана (список источников, миниатюры) только в памяти, не на диске и не в логах.
 */
/** Окно, с которым работает обработчик (реализует OsWindow; интерфейс — чтобы не зависеть от window.ts). */
export interface ShareWindow {
  locked: boolean;
  toast(text: string): void;
}

export interface ShareHost {
  /** Хост вкладки по адресу страницы (null — не http(s)). */
  hostOf(url: string): string;
  windowOf(wc: WebContents): ShareWindow | undefined;
  mode(host: string): Mode;
  /** Текст «запрещено для сайта» для подсказки. */
  blockedText(host: string): string;
}

type Callback = (streams?: { video?: DesktopCapturerSource; audio?: 'loopback' | 'loopbackWithMute' }) => void;

/** Навесить обработчик показа экрана на сессию (профиль или инкогнито). */
export function installDisplayHandler(ses: Session, host: ShareHost): void {
  ses.setDisplayMediaRequestHandler((request, callback) => {
    void handleDisplayMedia(host, request as unknown as DisplayRequest, callback as unknown as Callback);
  }, { useSystemPicker: false });
}

interface DisplayRequest {
  frame: Electron.WebFrameMain | null;
  securityOrigin: string;
  videoRequested: boolean;
  audioRequested: boolean;
}

async function handleDisplayMedia(host: ShareHost, request: DisplayRequest, callback: Callback): Promise<void> {
  const deny = () => callback();
  try {
    const wc = request.frame ? webContents.fromFrame(request.frame) : undefined;
    if (!wc || wc.isDestroyed()) return deny();
    const site = host.hostOf(wc.getURL());
    const w = host.windowOf(wc);
    const d = decideDisplay({
      host: site, securityOrigin: request.securityOrigin, hasWindow: !!w, locked: !!w?.locked,
      mode: site ? host.mode(site) : 'BLOCK', videoRequested: request.videoRequested,
    });
    if (d === 'blocked') { w?.toast(host.blockedText(site)); return deny(); }
    if (d !== 'ask') return deny();
    // TODO(этап 2): окно выбора (экран / окно / вкладка, звук, «Поделиться» / «Отмена»).
    // Пока — заглушка: первый экран без вопроса, если сайт не запрещён.
    let alive = true;
    const stop = () => { alive = false; };
    wc.once('destroyed', stop);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    wc.off('destroyed', stop);
    // Пока ждали список — вкладку закрыли или заблокировали PIN-ом: отказ.
    if (!alive || wc.isDestroyed() || w?.locked || !sources[0]) return deny();
    callback({ video: sources[0] });
  } catch {
    deny();
  }
}
