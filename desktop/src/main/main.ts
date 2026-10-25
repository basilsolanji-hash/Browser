import { app, BrowserWindow, Menu, nativeTheme, powerMonitor, type WebContentsView } from 'electron';
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { registerScheme } from './protocol';
import { installGlobalGuards, cleanUserAgent } from './security';
import { refreshDefault } from './defaultbrowser';
import * as History from './history';
import * as Perms from './permissions';
import * as Notes from './notes';
import * as Bookmarks from './bookmarks';
import * as Passwords from './passwords';
import { applyLanguage } from './i18n';
import { flushAll } from './store';
import { installIpc, applyTheme } from './ipc';
import { OsWindow, lockAll, mainWindow, profileSession, windows } from './window';
import { setBlockedListener } from './privacy';
import { installNotifications, shownForTest, clickLastForTest } from './notify';
import { installUploads } from './window';
import { installAutofill } from './autofill';
import { setTestPath } from './backup';
import { incomingUrl } from './defaultbrowser';
import * as Updater from './updater';
import { suspendAll } from './downloads';
import * as Onboarding from './onboarding';
import * as Tabs from './tabs';
import * as Profiles from './profiles';
import * as Extensions from './extensions';

/**
 * Ось Browser для Windows: главный процесс. Профили — изолированные партиции, вкладки — WebContentsView,
 * свои экраны — os://. Своих серверов и аналитики нет: данные лежат в userData.
 */

// Отдельная папка данных для приёмки и портативного запуска.
app.setName('Os Browser');
if (process.env.OS_USER_DATA) app.setPath('userData', process.env.OS_USER_DATA);
if (process.platform === 'win32') app.setAppUserModelId('ru.multibrowser.desktop');

// Никаких отчётов и фоновых запросов Chromium.
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,MediaRouter,DialMediaRouteProvider,AutofillServerCommunication,OptimizationHints');
// Хранилища сайтов в чужих рамках разделены по сайту верхнего уровня (изоляция сторонних данных).
app.commandLine.appendSwitch('enable-features', 'ThirdPartyStoragePartitioning,PartitionedCookies');
app.commandLine.appendSwitch('disable-background-networking');
// Снимки для магазина (scripts/store-shots.mjs): демо-сайты *.demo — на локальный сервер.
if (process.env.OS_TEST === '1' && process.env.OS_TEST_HOSTS) app.commandLine.appendSwitch('host-resolver-rules', process.env.OS_TEST_HOSTS);

registerScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Ссылка из другой программы (Ось — браузер по умолчанию) приходит вторым запуском.
  app.on('second-instance', (_e, argv) => {
    const w = mainWindow() ?? createMain();
    if (w.win.isMinimized()) w.win.restore();
    w.win.focus();
    const url = incomingUrl(argv);
    if (url) w.openUrl(url);
  });

  app.whenReady().then(async () => {
    app.userAgentFallback = cleanUserAgent();
    Menu.setApplicationMenu(null);
    installGlobalGuards();
    applyLanguage();
    applyTheme();
    installIpc();
    void refreshDefault();
    installNotifications();
    installUploads();
    installAutofill();
    nativeTheme.on('updated', () => { for (const w of windows) w.refreshLook(); });
    // Счётчик заблокированных трекеров в адресной строке.
    setBlockedListener((wcId) => { for (const w of windows) if (w.liveTabs().some((v) => v.wc.id === wcId)) w.push(); });
    // Блокировка Windows или сон — при возврате нужен PIN.
    powerMonitor.on('lock-screen', lockAll);
    powerMonitor.on('suspend', lockAll);
    Updater.start();
    // Расширения профилей загружаются до первых вкладок, иначе их скрипты не попадут на первую страницу.
    await Promise.all(Extensions.profilesInUse().map((id) => { profileSession(id); return Extensions.ready(id); }));
    if (process.env.OS_TEST_DELAY) setTimeout(createMain, Number(process.env.OS_TEST_DELAY));
    else createMain();
  });

  app.on('window-all-closed', () => app.quit());
  // Незаконченные загрузки запоминаем, чтобы после перезапуска продолжить их с того же места.
  app.on('before-quit', () => { suspendAll(); flushAll(); });
  app.on('will-quit', () => flushAll());
}

function createMain(): OsWindow {
  const w = new OsWindow();
  w.lock();
  // Первый запуск — обучение; потом — последний открытый профиль (вкладки восстанавливаются).
  if (Onboarding.shouldShow()) {
    w.profile = null;
    w.openPanel('os://onboarding/');
  } else {
    const last = Tabs.tabsFile.get().lastProfile;
    if (last != null && Profiles.exists(last)) w.openProfile(last);
    else w.showHome();
    const url = incomingUrl(process.argv);
    if (url) w.openUrl(url);
  }
  return w;
}

// Для приёмки (Playwright): доступ к состоянию окон из главного процесса.
if (process.env.OS_TEST === '1') {
  (globalThis as Record<string, unknown>).osTest = {
    windows: () => [...windows],
    flush: () => flushAll(),
    userData: () => app.getPath('userData'),
    dist: () => join(__dirname, '..'),
    notifications: () => shownForTest(),
    clickNotification: () => clickLastForTest(),
    // Установка из CRX-файла, собранного приёмкой (без сети), и список расширений профиля.
    installCrx: (profile: number, base64: string) => Extensions.installCrx(profileSession(profile), profile, Buffer.from(base64, 'base64'), null),
    extensions: (profile: number) => Extensions.info(profileSession(profile), profile, 'en'),
    extensionFiles: (profile: number, id: string) => Extensions.hasFiles(profile, id),
    backupPath: (p: string | null) => setTestPath(p),
    setPerm: (profile: number, host: string, kind: string, mode: Perms.Mode | null) => Perms.set(profile, host, kind, mode),
    addHistory: (profile: number, url: string, title: string) => { History.add(profile, url); History.setTitle(profile, url, title); },
    // Данные для снимков магазина: заметки, избранное, пароль.
    seed: { note: (text: string, src: string) => Notes.save(null, text, src), bookmark: (t: string, u: string) => Bookmarks.add(t, u),
      password: (profile: number, origin: string, user: string, pass: string) => Passwords.upsert(profile, origin, user, pass) },
    /** Снимок окна целиком: слои (шапка, вкладка, свой экран) снизу вверх, как их рисует окно. */
    capture: async (win = 0) => {
      const w = [...windows][win];
      const layers: { x: number; y: number; w: number; h: number; png: string }[] = [];
      for (const v of w.win.contentView.children) {
        const b = v.getBounds();
        if (!b.width || !b.height || !(v as { getVisible?: () => boolean }).getVisible?.() || !('webContents' in v)) continue;
        const img = await (v as WebContentsView).webContents.capturePage();
        layers.push({ x: b.x, y: b.y, w: b.width, h: b.height, png: img.toDataURL() });
      }
      const c = w.win.getContentBounds();
      return { w: c.width, h: c.height, layers };
    },
    /** Отрисовать HTML вне экрана и вернуть JPEG (рамка 3:4 для магазина). */
    compose: async (html: string, width: number, height: number) => {
      const bw = new BrowserWindow({ show: false, width, height, useContentSize: true, enableLargerThanScreen: true, webPreferences: { offscreen: true } });
      bw.setContentSize(width, height);
      const file = join(app.getPath('temp'), `os-compose-${Date.now()}.html`);
      writeFileSync(file, html);
      await bw.loadFile(file);
      rmSync(file, { force: true });
      await new Promise((r) => setTimeout(r, 300));
      const img = await bw.webContents.capturePage({ x: 0, y: 0, width, height });
      bw.destroy();
      return img.toJPEG(88).toString('base64');
    },
  };
}
