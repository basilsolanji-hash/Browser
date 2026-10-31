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
  push(): void;
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

// --- Индикатор и остановка показа ---
// Включает и снимает индикатор только главный процесс по своим событиям; сайт его скрыть не может.

interface Active { w: ShareWindow; label: string; startedAt: number; off: () => void; timer: NodeJS.Timeout | null }
const active = new Map<number, Active>();

/** Идёт ли показ экрана на этой вкладке. */
export const isSharing = (wcId: number): boolean => active.has(wcId);

/** Показ начался: индикатор включён, пока не кончатся все потоки (уход на другой сайт, закрытие, остановка). */
function beginSharing(w: ShareWindow, wc: WebContents, label: string): void {
  const prev = active.get(wc.id);
  if (prev) { prev.label = label; prev.startedAt = Date.now(); w.push(); return; }
  const nav = (e: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (e.isMainFrame && !e.isSameDocument) endSharing(wc.id);
  };
  const gone = () => endSharing(wc.id);
  wc.on('did-start-navigation', nav);
  wc.once('destroyed', gone);
  const off = () => {
    if (wc.isDestroyed()) return;
    wc.off('did-start-navigation', nav);
    wc.off('destroyed', gone);
  };
  active.set(wc.id, { w, label, startedAt: Date.now(), off, timer: null });
  w.toast(t('dt_share_started'));
  w.push();
}

/** Индикатор снят (потоки кончились, вкладка ушла или закрыта). */
export function endSharing(wcId: number): void {
  const a = active.get(wcId);
  if (!a) return;
  active.delete(wcId);
  if (a.timer) clearTimeout(a.timer);
  a.off();
  a.w.push();
}

/**
 * Остановить показ вкладки. Мягко: preload вкладки останавливает треки (из главного процесса поток не
 * остановить). Если за секунду индикатор не погас (кадр без preload, клонированные треки) — перезагрузка
 * вкладки, она гарантированно рвёт все потоки.
 */
export function stopSharing(wc: WebContents, quiet = false): void {
  const a = active.get(wc.id);
  if (!a || wc.isDestroyed()) return;
  try { wc.send('tab:share-stop'); } catch { /* вкладка закрывается */ }
  if (a.timer) clearTimeout(a.timer);
  a.timer = setTimeout(() => {
    a.timer = null;
    if (active.get(wc.id) !== a) return;
    if (!wc.isDestroyed()) wc.reload();
    endSharing(wc.id);
    if (!quiet) a.w.toast(t('dt_share_stopped'));
  }, 1000);
}

/** Остановить показ всех вкладок окна (блокировка PIN-ом). */
export function stopWindowSharing(w: ShareWindow): void {
  for (const [id, a] of [...active]) {
    if (a.w !== w) continue;
    const wc = webContents.fromId(id);
    if (wc) stopSharing(wc, true); else endSharing(id);
  }
}

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
        done({ video: twc.mainFrame, audio: plan.audio ? twc.mainFrame : undefined });
        return beginSharing(w, wc, site);
      }
      const src = real.get(sourceId);
      if (!src || w.locked) return deny();
      done({ video: src, audio: plan.audio === 'loopback' ? 'loopback' : undefined });
      beginSharing(w, wc, site);
    });
    if (!opened) deny();
  } catch {
    deny();
  }
}
