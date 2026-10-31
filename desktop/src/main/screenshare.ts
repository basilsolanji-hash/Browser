import { desktopCapturer, webContents, type DesktopCapturerSource, type Session, type WebContents } from 'electron';
import type { Mode } from './permissions';
import { decideDisplay, buildStreams, type ShareKind } from './displayrule';
import { t } from './i18n';
import type { ShareSource } from '../shared/types';

/**
 * Показ экрана на сайтах (getDisplayMedia). Решение по запросу принимает чистая decideDisplay
 * (проверяется unit-тестом): всё, что не «спросить», и любая неясность — отказ.
 * Содержимое экрана (список источников, миниатюры) только в памяти, не на диске и не в логах.
 */
/** Окно, с которым работает обработчик (реализует OsWindow; интерфейс — чтобы не зависеть от window.ts). */
export interface ShareWindow {
  locked: boolean;
  toast(text: string): void;
  shareTabs(): { id: string; wc: WebContents; title: string; favicon: string | null }[];
  showTabOf(wc: WebContents): void;
  askScreen(wc: WebContents, host: string, audio: boolean, sources: ShareSource[], resolve: (sourceId: string | null, audio: boolean) => void): boolean;
}

export interface ShareHost {
  /** Хост вкладки по адресу страницы (null — не http(s)). */
  hostOf(url: string): string;
  windowOf(wc: WebContents): ShareWindow | undefined;
  mode(host: string): Mode;
  /** Текст «запрещено для сайта» для подсказки. */
  blockedText(host: string): string;
}

interface Streams { video?: DesktopCapturerSource | Electron.WebFrameMain; audio?: 'loopback' | 'loopbackWithMute' | Electron.WebFrameMain }
type Callback = (streams?: Streams) => void;

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

/** Не больше стольких окон в списке (на Windows их бывают десятки). */
const MAX_WINDOWS = 24;
const dataUrl = (img: Electron.NativeImage): string | null => (img.isEmpty() ? null : 'data:image/jpeg;base64,' + img.toJPEG(70).toString('base64'));

async function handleDisplayMedia(host: ShareHost, request: DisplayRequest, callback: Callback): Promise<void> {
  let answered = false;
  const done = (s?: Streams) => { if (!answered) { answered = true; callback(s); } };
  const deny = () => done();
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
    if (d !== 'ask' || !w) return deny();
    w.showTabOf(wc);

    // Источники: экраны и окна системы (с миниатюрами) + вкладки этого окна. Только в памяти.
    const real = new Map<string, DesktopCapturerSource>();
    const tabs = new Map<string, WebContents>();
    const list: ShareSource[] = [];
    let alive = true;
    const gone = () => { alive = false; };
    wc.once('destroyed', gone);
    let raw: DesktopCapturerSource[] = [];
    try {
      raw = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: true });
    } catch { /* нет права на запись экрана или нет экрана — остаются вкладки */ }
    wc.off('destroyed', gone);
    // Пока ждали список — вкладку закрыли или заблокировали PIN-ом: отказ.
    if (!alive || wc.isDestroyed() || w.locked) return deny();
    let n = 0;
    for (const s of raw.filter((x) => x.id.startsWith('screen:'))) {
      real.set(s.id, s);
      list.push({ id: s.id, kind: 'screen', name: t('dt_share_screen_n', ++n), thumb: dataUrl(s.thumbnail), icon: null });
    }
    for (const s of raw.filter((x) => x.id.startsWith('window:') && x.name.trim()).slice(0, MAX_WINDOWS)) {
      real.set(s.id, s);
      list.push({ id: s.id, kind: 'window', name: s.name, thumb: dataUrl(s.thumbnail), icon: s.appIcon ? dataUrl(s.appIcon) : null });
    }
    for (const tab of w.shareTabs()) {
      const id = 'tab:' + tab.id;
      tabs.set(id, tab.wc);
      list.push({ id, kind: 'tab', name: tab.wc === wc ? t('dt_share_this_tab') + ' — ' + tab.title : tab.title, thumb: null, icon: tab.favicon });
    }
    const opened = w.askScreen(wc, site, request.audioRequested, list, (sourceId, audio) => {
      if (!sourceId) return deny();
      const kind: ShareKind = sourceId.startsWith('tab:') ? 'tab' : sourceId.startsWith('window:') ? 'window' : 'screen';
      const plan = buildStreams(kind, audio, process.platform, request.audioRequested);
      if (kind === 'tab') {
        const twc = tabs.get(sourceId);
        if (!twc || twc.isDestroyed() || w.locked) return deny();
        return done({ video: twc.mainFrame, audio: plan.audio ? twc.mainFrame : undefined });
      }
      const src = real.get(sourceId);
      if (!src || w.locked) return deny();
      done({ video: src, audio: plan.audio === 'loopback' ? 'loopback' : undefined });
    });
    if (!opened) deny();
  } catch {
    deny();
  }
}
