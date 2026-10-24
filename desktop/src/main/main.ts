import { app, Menu, nativeTheme, powerMonitor } from 'electron';
import { join } from 'node:path';
import { registerScheme } from './protocol';
import { installGlobalGuards, cleanUserAgent } from './security';
import { applyLanguage } from './i18n';
import { flushAll } from './store';
import { installIpc, applyTheme } from './ipc';
import { OsWindow, lockAll, mainWindow, windows } from './window';
import { setBlockedListener } from './privacy';
import { installNotifications, shownForTest, clickLastForTest } from './notify';
import { incomingUrl } from './defaultbrowser';
import * as Updater from './updater';
import * as Onboarding from './onboarding';
import * as Tabs from './tabs';
import * as Profiles from './profiles';

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

  app.whenReady().then(() => {
    app.userAgentFallback = cleanUserAgent();
    Menu.setApplicationMenu(null);
    installGlobalGuards();
    applyLanguage();
    applyTheme();
    installIpc();
    installNotifications();
    nativeTheme.on('updated', () => { for (const w of windows) w.refreshLook(); });
    // Счётчик заблокированных трекеров в адресной строке.
    setBlockedListener((wcId) => { for (const w of windows) if (w.liveTabs().some((v) => v.wc.id === wcId)) w.push(); });
    // Блокировка Windows или сон — при возврате нужен PIN.
    powerMonitor.on('lock-screen', lockAll);
    powerMonitor.on('suspend', lockAll);
    Updater.start();
    if (process.env.OS_TEST_DELAY) setTimeout(createMain, Number(process.env.OS_TEST_DELAY));
    else createMain();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => flushAll());
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
  };
}
