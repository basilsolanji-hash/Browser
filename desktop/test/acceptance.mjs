// Жёсткая приёмка настольной версии (§5 ТЗ): Playwright for Electron, проверки по состоянию
// (файлы userData, сессии, вкладки, окна), скриншоты с проверкой на «пустой экран».
// Результаты — в test-results/: checks.txt (ok/FAIL), steps.txt, main.log, console.log, PNG.
// Запуск: npm run build && node test/acceptance.mjs [этап]
import { _electron } from 'playwright';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import electronPath from 'electron';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'test-results');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const STAGE = Number(process.argv[2] ?? 99);

// --- Журнал результатов ---
let failures = 0;
const line = (file, text) => appendFileSync(join(OUT, file), text + '\n');
const step = (text) => { console.log('▶ ' + text); line('steps.txt', `${new Date().toISOString()} ${text}`); };
function check(name, cond, detail = '') {
  const ok = !!cond;
  if (!ok) failures++;
  const s = `${ok ? 'ok' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`;
  console.log(s);
  line('checks.txt', s);
  return ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 10000, every = 150) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // ещё не готово
    }
    await sleep(every);
  }
  return null;
}

// --- Тестовый сайт: cookies и страницы ---
const seen = [];
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  seen.push({ path: u.pathname + u.search, cookie: req.headers.cookie ?? '' });
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (u.pathname === '/set') {
    res.setHeader('set-cookie', `os_test=${u.searchParams.get('p')}; Path=/; Max-Age=86400`);
    res.end(`<title>Set ${u.searchParams.get('p')}</title><h1>cookie set</h1>`);
  } else if (u.pathname === '/get') {
    res.end(`<title>Get</title><h1 id="c">${(req.headers.cookie ?? '').replace(/</g, '')}</h1><script>document.title='Get '+(document.cookie||'none')</script>`);
  } else if (u.pathname === '/open') {
    res.end('<title>Opener</title><a id="blank" href="/page/opened" target="_blank">open</a>');
  } else {
    res.end(`<title>Page ${u.pathname.split('/').pop()}</title><body style="font:16px sans-serif"><h1>${u.pathname}</h1><p>Ось test page</p>` +
      '<div style="height:240px;background:linear-gradient(90deg,#d92d20,#1e88e5)"></div></body>');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const SITE = `http://127.0.0.1:${PORT}`;

// --- Запуск приложения ---
const userData = join(tmpdir(), `os-acceptance-${Date.now()}`);
let app;
let runNo = 0;

async function launch() {
  runNo++;
  app = await _electron.launch({
    executablePath: electronPath,
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, OS_TEST: '1', OS_USER_DATA: userData, OS_TEST_DELAY: '1500' },
    timeout: 60000,
  });
  app.process().stdout?.on('data', (d) => line('main.log', `[run ${runNo}] ${String(d).trimEnd()}`));
  app.process().stderr?.on('data', (d) => line('main.log', `[run ${runNo} err] ${String(d).trimEnd()}`));
  app.on('window', (p) => {
    p.on('console', (m) => line('console.log', `[${p.url()}] ${m.type()}: ${m.text()}`));
    p.on('pageerror', (e) => { line('console.log', `[${p.url()}] PAGEERROR ${e.message}`); line('checks.txt', `note page error on ${p.url()}: ${e.message}`); });
  });
  await waitFor(() => main(() => globalThis.osTest.windows().length > 0), 20000);
}

const main = (fn, arg) => app.evaluate(fn, arg);
const state = (i = 0) => main((_e, i) => globalThis.osTest.windows()[i]?.state() ?? null, i);
const flush = () => main(() => globalThis.osTest.flush());
const readJson = (name) => {
  const p = join(userData, name + '.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

async function page(prefix, timeout = 10000) {
  return waitFor(() => app.windows().find((p) => !p.isClosed() && p.url().startsWith(prefix)), timeout);
}

/** Горячая клавиша — через sendInputEvent шапки (так её видит before-input-event, как настоящую). */
async function key(accel, win = 0, target = 'chrome') {
  const parts = accel.split('+');
  const k = parts.pop();
  const modifiers = parts.map((m) => ({ Ctrl: 'control', Shift: 'shift', Alt: 'alt' })[m]);
  await main((_e, { k, modifiers, win, target }) => {
    const w = globalThis.osTest.windows()[win];
    const wc = target === 'page' ? w.page.webContents : w.chrome.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers });
  }, { k, modifiers, win, target });
  await sleep(400);
}

/** Снимок вида (шапка, экран, вкладка) из главного процесса + доля «непустых» пикселей. */
async function shot(name, which = 'tab', win = 0) {
  const r = await main(async (_e, { which, win }) => {
    const w = globalThis.osTest.windows()[win];
    const wc = which === 'chrome' ? w.chrome.webContents : which === 'page' ? w.page.webContents : w.activeWebContents();
    if (!wc) return null;
    // Вид мог ещё не отрисоваться (UnknownVizError) — ждём загрузку и повторяем.
    let img = null;
    for (let i = 0; i < 20 && !img; i++) {
      if (wc.isLoading()) { await new Promise((r) => setTimeout(r, 200)); continue; }
      try { img = await wc.capturePage(); if (img.isEmpty()) img = null; } catch { img = null; }
      if (!img) await new Promise((r) => setTimeout(r, 300));
    }
    if (!img) return null;
    const { width, height } = img.getSize();
    const bmp = img.toBitmap();
    const counts = new Map();
    for (let i = 0; i < bmp.length; i += 4 * 7) {
      const c = (bmp[i] >> 3) << 10 | (bmp[i + 1] >> 3) << 5 | (bmp[i + 2] >> 3);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const total = Math.ceil(bmp.length / 28);
    const top = Math.max(0, ...counts.values());
    return { png: img.toPNG().toString('base64'), width, height, varied: 1 - top / Math.max(1, total) };
  }, { which, win });
  if (!r) return check(`screenshot ${name}`, false, 'нет вида');
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.png, 'base64'));
  return r;
}

/** Ключевой экран не должен быть пустым (как blank-проверка Android-приёмки). */
async function keyScreen(name, which = 'tab', win = 0) {
  const r = await shot(name, which, win);
  if (r && typeof r === 'object') check(`screen ${name} not blank`, r.varied > 0.004 && r.width > 50, `varied=${r.varied.toFixed(4)} ${r.width}x${r.height}`);
}

/** Снимок окна целиком средствами ОС (для просмотра человеком; не влияет на приёмку). */
async function windowShot(name, win = 0) {
  try {
    const b = await main((_e, win) => globalThis.osTest.windows()[win].win.getBounds(), win);
    const file = join(OUT, `window-${name}.png`);
    if (process.platform === 'win32') {
      const ps = `Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap ${b.width}, ${b.height}; ` +
        `$g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(${b.x}, ${b.y}, 0, 0, $bmp.Size); $bmp.Save('${file.replace(/'/g, "''")}')`;
      execFileSync('powershell', ['-NoProfile', '-Command', ps], { timeout: 20000 });
    } else if (process.env.DISPLAY) {
      execFileSync('import', ['-window', 'root', '-crop', `${b.width}x${b.height}+${b.x}+${b.y}`, file], { timeout: 20000 });
    }
  } catch (e) {
    line('steps.txt', `window screenshot ${name} failed: ${e.message}`);
  }
}

async function typeAddress(text, win = 0) {
  const ui = await waitFor(() => app.windows().filter((p) => p.url().startsWith('os://ui'))[win === 0 ? 0 : app.windows().filter((p) => p.url().startsWith('os://ui')).length - 1]);
  await ui.click('#address');
  await ui.keyboard.type(text, { delay: 5 });
  await ui.keyboard.press('Enter');
  return ui;
}

const tabUrls = (s) => s.tabs.map((t) => t.url);

// ============================================================================
try {
  // --- 1. Первый запуск и обучение ---
  step('1. Первый запуск: обучение и профили-примеры');
  await launch();
  const onb = await page('os://onboarding/', 15000);
  check('onboarding shown on first run', onb);
  await flush();
  const prof = readJson('profiles');
  check('example profiles seeded (@ex_*)', prof?.names?.['1'] === '@ex_personal_name' && prof?.names?.['4'] === '@ex_social_name', JSON.stringify(prof?.names));
  const pins = readJson('pins');
  check('example pins: Work has Start, Mail, Calendar', pins?.own?.['2']?.map((p) => p.id).join(',') === 'start,mail,calendar');
  const titles = [];
  for (let i = 0; i < 6; i++) {
    await onb.waitForSelector('#title');
    titles.push(await onb.textContent('#title'));
    await keyScreen(`01-onboarding-${i + 1}`, 'page');
    if (i === 0) await windowShot('onboarding');
    await onb.click('#next');
    await sleep(250);
  }
  check('onboarding has 6 distinct pages', new Set(titles).size === 6, titles.join(' | '));
  const home = await page('os://home/');
  check('tutorial finishes on the profiles screen', home);
  await flush();
  check('onboarding.json done', readJson('onboarding')?.done === true);
  await home.waitForSelector('.prow');
  const names = await home.$$eval('.prow .name', (els) => els.map((e) => e.textContent));
  check('home lists example profiles', names.slice(0, 4).join(',') === 'Personal,Work,Shopping,Social', names.join(','));
  check('home shows first 5 profiles and «Show all»', names.length === 5 && (await home.$('.showall')) !== null, `rows=${names.length}`);
  await keyScreen('02-home', 'page');
  await windowShot('home');

  // --- 2. Профили и вкладки ---
  step('2. Вкладки в профиле: новая, адрес, закрытие, возврат, порядок');
  await home.click('.prow >> nth=0');
  const s1 = await waitFor(async () => { const s = await state(); return s?.profile?.id === 1 && s; });
  check('profile 1 opened from the profiles screen', s1);
  check('pinned tabs of profile 1 in the strip', s1 && s1.tabs.filter((t) => t.pinned).map((t) => t.id).join(',') === 'start,mail');
  await keyScreen('03-profile1-start', 'tab');
  await keyScreen('03-chrome', 'chrome');
  await key('Ctrl+T');
  let s = await state();
  check('Ctrl+T opens a new tab', s.tabs.filter((t) => !t.pinned).length === 1 && !s.tabs.find((t) => t.id === s.active)?.pinned);
  await typeAddress(`${SITE}/set?p=one`);
  s = await waitFor(async () => { const x = await state(); return x.url.includes('/set?p=one') && !x.loading && x; });
  check('address bar opens a site in the new tab', s, s?.url);
  const ui = await page('os://ui');
  const rest = await ui.inputValue('#address');
  check('address bar at rest shows the domain', rest === '127.0.0.1', rest);
  await key('Ctrl+T');
  await typeAddress(`${SITE}/page/two`);
  await waitFor(async () => (await state()).url.endsWith('/page/two'));
  await key('Ctrl+T');
  await typeAddress('localhost:' + PORT + '/page/three');
  s = await waitFor(async () => { const x = await state(); return x.url.endsWith('/page/three') && x; });
  check('address without scheme opens over http for localhost', s, s?.url);
  await flush();
  const hist = readJson('history')?.h?.['1'] ?? [];
  check('history of profile 1 is saved', hist.some((v) => v.u.endsWith('/page/two')), `${hist.length} entries`);
  const before = (await state()).tabs.filter((t) => !t.pinned).length;
  await key('Ctrl+W');
  s = await state();
  check('Ctrl+W closes the tab', s.tabs.filter((t) => !t.pinned).length === before - 1);
  await key('Ctrl+Shift+T');
  s = await waitFor(async () => { const x = await state(); return x.tabs.some((t) => t.url.endsWith('/page/three')) && x; });
  check('Ctrl+Shift+T brings back the closed tab', s);
  const activeBefore = (await state()).active;
  await key('Ctrl+Tab');
  check('Ctrl+Tab switches to another tab', (await state()).active !== activeBefore);
  // Перетаскивание вкладки мышью: последнюю — на место первой обычной.
  const open = (await state()).tabs.filter((t) => !t.pinned).map((t) => t.id);
  await ui.dragAndDrop(`.tab[data-id="${open[open.length - 1]}"]`, `.tab[data-id="${open[0]}"]`);
  await sleep(500);
  await flush();
  const order = readJson('tabs')?.profiles?.['1']?.tabs?.map((t) => t.id) ?? [];
  check('drag and drop reorders tabs (saved)', order[0] === open[open.length - 1], `${open.join(',')} → ${order.join(',')}`);
  // Сайт открывает ссылку target=_blank — новая вкладка того же профиля, не окно.
  await typeAddress(`${SITE}/open`);
  await waitFor(async () => (await state()).url.endsWith('/open'));
  const opener = await page(`${SITE}/open`);
  const count0 = (await state()).tabs.length;
  await opener.click('#blank');
  s = await waitFor(async () => { const x = await state(); return x.tabs.some((t) => t.url.endsWith('/page/opened')) && x; });
  check('target=_blank opens a new tab in the same profile', s && s.tabs.length === count0 + 1, `${count0} → ${s?.tabs.length}`);
  check('no extra windows from target=_blank', (await main(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 1);
  await windowShot('profile1-tabs');

  // --- 3. Изоляция cookies между профилями ---
  step('3. Профиль 2 не видит cookies профиля 1');
  const chip = await ui.$('.chip');
  await chip.click();
  await ui.waitForSelector('.menu');
  await keyScreen('04-profile-menu', 'chrome');
  await ui.click('.menu button:has-text("Work")');
  s = await waitFor(async () => { const x = await state(); return x.profile?.id === 2 && x; });
  check('switch to profile 2 from the profile chip', s);
  check('profile 2 has its own pinned tabs', s && s.tabs.filter((t) => t.pinned).length === 3);
  await key('Ctrl+T');
  await typeAddress(`${SITE}/get`);
  await waitFor(async () => (await state()).url.endsWith('/get') && !(await state()).loading);
  await sleep(500);
  const getReq = seen.filter((r) => r.path === '/get').pop();
  check('profile 2 request has no cookie of profile 1', getReq && !getReq.cookie.includes('os_test'), JSON.stringify(getReq));
  const title2 = (await state()).title;
  check('document.cookie in profile 2 is empty', title2 === 'Get none', title2);
  const jar = await main(async ({ session }) => {
    const one = await session.fromPartition('persist:profile_1').cookies.get({ name: 'os_test' });
    const two = await session.fromPartition('persist:profile_2').cookies.get({ name: 'os_test' });
    return { one: one.map((c) => c.value), two: two.map((c) => c.value) };
  });
  check('cookie stored only in profile 1 session', jar.one.join() === 'one' && jar.two.length === 0, JSON.stringify(jar));
  await typeAddress(`${SITE}/set?p=two`);
  await waitFor(async () => (await state()).url.includes('p=two'));
  const jar2 = await main(async ({ session }) => {
    return [(await session.fromPartition('persist:profile_1').cookies.get({ name: 'os_test' }))[0]?.value,
      (await session.fromPartition('persist:profile_2').cookies.get({ name: 'os_test' }))[0]?.value];
  });
  check('each profile keeps its own cookie value', jar2[0] === 'one' && jar2[1] === 'two', JSON.stringify(jar2));

  // --- 4. Свои страницы не получают сайты ---
  step('4. Безопасность вкладок');
  const sec = await main(async () => {
    const w = globalThis.osTest.windows()[0];
    const tab = w.activeWebContents();
    const prefs = tab.getLastWebPreferences();
    const bridge = await tab.executeJavaScript('typeof window.os + "/" + typeof window.require + "/" + typeof process');
    const before = tab.getURL();
    await tab.executeJavaScript('location.href = "os://settings/"; 1');
    await new Promise((r) => setTimeout(r, 600));
    await tab.executeJavaScript('location.href = "file:///C:/Windows/win.ini"; 1').catch(() => 0);
    await new Promise((r) => setTimeout(r, 600));
    return { ci: prefs.contextIsolation, sb: prefs.sandbox, ni: prefs.nodeIntegration, ws: prefs.webSecurity, preload: prefs.preload ?? null, bridge, before, after: tab.getURL() };
  });
  check('tab webPreferences: contextIsolation, sandbox, no node, webSecurity', sec.ci === true && sec.sb === true && sec.ni === false && sec.ws !== false, JSON.stringify(sec));
  check('sites get no preload bridge', !sec.preload && sec.bridge === 'undefined/undefined/undefined', sec.bridge);
  check('site cannot navigate to os:// or file://', sec.after === sec.before, `${sec.before} → ${sec.after}`);
  const ua = await main(() => globalThis.osTest.windows()[0].activeWebContents().getUserAgent());
  check('user agent has no Electron token', !/Electron|os-browser/i.test(ua), ua);

  // --- 5. Сетка вкладок, поиск, группы ---
  step('5. Экран вкладок: поиск и группы');
  await main(() => globalThis.osTest.windows()[0].openProfile(1));
  await key('Ctrl+Shift+A');
  const grid = await page('os://tabs/');
  check('Ctrl+Shift+A opens the tabs screen', grid);
  await grid.waitForSelector('.tcard');
  const cards = await grid.$$eval('.tcard', (els) => els.length);
  const open1 = (await state()).tabs.filter((t) => !t.pinned).length;
  check('tabs screen shows every open tab', cards === open1, `${cards} vs ${open1}`);
  await keyScreen('05-tabs-grid', 'page');
  await grid.fill('#search', 'Page two');
  await sleep(300);
  const found = await grid.$$eval('.tcard', (els) => els.length);
  check('search filters tabs', found === 1, `found ${found}`);
  await grid.fill('#search', 'zzzz-nothing');
  await sleep(200);
  check('search shows «nothing found»', (await grid.$('.empty')) !== null);
  await grid.fill('#search', '');
  await sleep(200);
  await grid.click('button:has-text("Select tabs")');
  await grid.click('.tcard >> nth=0');
  await grid.click('.tcard >> nth=1');
  await grid.click('.selbar button:has-text("To group")');
  await grid.click('.ctx button:has-text("New tab group")');
  await grid.fill('.modal input', 'Clients');
  await grid.click('.modal .btn.accent');
  await sleep(600);
  await flush();
  const tg = readJson('tabs')?.profiles?.['1'];
  check('group created and two tabs added to it', tg?.groups?.[0]?.name === 'Clients' && tg.tabs.filter((t) => t.group === tg.groups[0].id).length === 2, JSON.stringify(tg?.groups));
  await keyScreen('05-tabs-groups', 'page');
  await key('Escape', 0, 'page');
  await sleep(300);
  s = await state();
  check('Esc closes the tabs screen', s.panel === null);
  check('group chip appears in the tab strip', (await ui.$('.gchip')) !== null);
  await keyScreen('05-strip-groups', 'chrome');

  // --- 6. Закреплённые вкладки профиля ---
  step('6. Свои закреплённые вкладки у профиля');
  await main(() => globalThis.osTest.windows()[0].openPanel('os://profile/?id=3'));
  const pp = await page('os://profile/');
  await pp.waitForSelector('#add-files');
  await pp.click('button:has-text("+ Add tab")');
  const inputs = await pp.$$('.modal input');
  await inputs[0].fill('Docs');
  await inputs[1].fill('127.0.0.1:' + PORT + '/page/docs');
  await pp.click('.modal .btn.accent');
  await sleep(500);
  await flush();
  const pins3 = readJson('pins')?.own?.['3'] ?? [];
  check('profile 3 got its own pinned tab', pins3.some((p) => p.title === 'Docs' && p.url === `https://127.0.0.1:${PORT}/page/docs`), JSON.stringify(pins3));
  check('common set is unchanged', (readJson('pins')?.common ?? null) === null);
  await keyScreen('06-profile-screen', 'page');

  // --- 7. Инкогнито ---
  step('7. Инкогнито не оставляет данных');
  await main(() => globalThis.osTest.windows()[0].openProfile(1));
  await key('Ctrl+Shift+N');
  const two = await waitFor(async () => (await main(() => globalThis.osTest.windows().length)) === 2);
  check('Ctrl+Shift+N opens an incognito window', two);
  const si = await waitFor(async () => { const x = await state(1); return x?.incognito && x.tabs.length === 1 && x; });
  check('incognito window has one start tab', si);
  await sleep(800);
  await keyScreen('07-incognito', 'tab', 1);
  await keyScreen('07-incognito-chrome', 'chrome', 1);
  await windowShot('incognito', 1);
  const iui = (await waitFor(() => app.windows().filter((p) => p.url().startsWith('os://ui/?incognito')).pop()));
  await iui.click('#address');
  await iui.keyboard.type(`${SITE}/set?p=incog`, { delay: 5 });
  await iui.keyboard.press('Enter');
  await waitFor(async () => (await state(1)).url.includes('p=incog'));
  const incogPart = await main(async () => {
    const w = globalThis.osTest.windows()[1];
    const ses = w.activeWebContents().session;
    const c = await ses.cookies.get({ name: 'os_test' });
    return { persistent: ses.isPersistent(), value: c[0]?.value, path: ses.getStoragePath() };
  });
  check('incognito session is in memory', incogPart.persistent === false && !incogPart.path, JSON.stringify(incogPart));
  check('incognito cookie lives only there', incogPart.value === 'incog');
  const p1 = await main(async ({ session }) => (await session.fromPartition('persist:profile_1').cookies.get({ name: 'os_test' }))[0]?.value);
  check('profile 1 cookie untouched by incognito', p1 === 'one', p1);
  await main(() => globalThis.osTest.windows()[1].win.close());
  check('incognito window closed', await waitFor(async () => (await main(() => globalThis.osTest.windows().length)) === 1));
  await flush();
  const all = ['history', 'tabs', 'profiles'].map((n) => JSON.stringify(readJson(n) ?? {})).join('');
  check('no incognito URLs in history or tabs', !all.includes('p=incog'));
  const parts = existsSync(join(userData, 'Partitions')) ? readdirSync(join(userData, 'Partitions')) : [];
  check('no incognito partition on disk', !parts.some((p) => p.includes('incognito')), parts.join(','));

  // --- 8. Смена языка ---
  step('8. Смена языка применяется сразу везде');
  await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/'));
  const st = await page('os://settings/');
  await st.waitForSelector('#lang');
  await st.selectOption('#lang', 'ru');
  const ruOk = await waitFor(async () => (await st.title()) === 'Настройки');
  check('settings screen switched to Russian', ruOk);
  await flush();
  check('settings.json lang = ru', readJson('settings')?.lang === 'ru');
  await main(() => globalThis.osTest.windows()[0].closePanel());
  await sleep(400);
  const ph = await waitFor(async () => (await ui.getAttribute('#address', 'placeholder')) === 'Адрес или поиск' && 'yes');
  check('browser chrome switched to Russian', ph, await ui.getAttribute('#address', 'placeholder'));
  const startRu = await main(async () => {
    const w = globalThis.osTest.windows()[0];
    w.activate('start');
    await new Promise((r) => setTimeout(r, 800));
    return w.activeWebContents().executeJavaScript('document.body.innerText');
  });
  check('start page re-rendered in Russian', /Деловой браузер|ДЕЛОВОЙ БРАУЗЕР/i.test(startRu), startRu.slice(0, 80));
  await keyScreen('08-start-ru', 'tab');
  await keyScreen('08-chrome-ru', 'chrome');
  await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/'));
  await st.selectOption('#lang', 'ar');
  const rtl = await waitFor(async () => (await ui.evaluate(() => document.documentElement.dir)) === 'rtl');
  check('Arabic switches the interface to RTL', rtl);
  await keyScreen('08-settings-ar', 'page');
  await windowShot('settings-ar');
  await st.selectOption('#lang', 'ru');
  await waitFor(async () => (await st.title()) === 'Настройки');
  await main(() => globalThis.osTest.windows()[0].closePanel());

  // --- 9. Перезапуск восстанавливает вкладки ---
  step('9. Перезапуск восстанавливает вкладки, профиль, язык и размер окна');
  await main(() => globalThis.osTest.windows()[0].win.setBounds({ x: 40, y: 30, width: 900, height: 640 }));
  await main(() => globalThis.osTest.windows()[0].activate(globalThis.osTest.windows()[0].state().tabs.filter((t) => !t.pinned).pop().id));
  await sleep(600);
  const beforeRestart = await state();
  await flush();
  const p2tabs = readJson('tabs')?.profiles?.['2']?.tabs?.map((t) => t.url);
  await flush();
  await app.close();
  await launch();
  const after = await waitFor(async () => { const x = await state(); return x?.profile && x; }, 20000);
  check('last profile reopened after restart', after?.profile?.id === beforeRestart.profile.id);
  check('open tabs restored after restart', after && JSON.stringify(tabUrls(after).filter((u) => u.startsWith('http'))) === JSON.stringify(tabUrls(beforeRestart).filter((u) => u.startsWith('http'))),
    `${tabUrls(beforeRestart).join(' ')} → ${after && tabUrls(after).join(' ')}`);
  check('active tab restored', after?.active === beforeRestart.active, `${beforeRestart.active} → ${after?.active}`);
  const loaded = await waitFor(async () => { const x = await state(); return x.url === beforeRestart.url && !x.loading && x; });
  check('active tab reloaded its page', loaded, `${beforeRestart.url} → ${(await state()).url}`);
  check('tabs of profile 2 kept', JSON.stringify(readJson('tabs')?.profiles?.['2']?.tabs?.map((t) => t.url)) === JSON.stringify(p2tabs));
  const ui2 = await page('os://ui');
  check('language kept after restart', (await ui2.getAttribute('#address', 'placeholder')) === 'Адрес или поиск');
  const bounds = await main(() => globalThis.osTest.windows()[0].win.getBounds());
  check('window size remembered', Math.abs(bounds.width - 900) <= 2 && Math.abs(bounds.height - 640) <= 2, JSON.stringify(bounds));
  await keyScreen('09-after-restart', 'tab');
  await windowShot('after-restart');

  // --- 10. Экран профилей после работы: порядок и меню ---
  step('10. Порядок профилей и меню профиля');
  await main(() => globalThis.osTest.windows()[0].showHome());
  const home2 = await page('os://home/');
  await home2.waitForSelector('.prow');
  await home2.dragAndDrop('.prow >> nth=2', '.prow >> nth=0');
  await sleep(500);
  await flush();
  const ord = readJson('profiles')?.order ?? [];
  check('drag a profile changes the order (saved)', ord[0] === 3, ord.slice(0, 5).join(','));
  await home2.click('.prow >> nth=0', { button: 'right' });
  await home2.waitForSelector('.ctx');
  await keyScreen('10-profile-menu', 'page');
  check('profile context menu has rename and sign out', (await home2.$$eval('.ctx button', (b) => b.length)) >= 5);
  await home2.keyboard.press('Escape');
} catch (e) {
  check('scenario finished without errors', false, e.stack ?? String(e));
} finally {
  try { await flush(); } catch { /* приложение уже закрыто */ }
  try {
    for (const f of ['settings', 'profiles', 'pins', 'tabs', 'onboarding', 'history']) {
      const j = readJson(f);
      if (j) writeFileSync(join(OUT, `state-${f}.json`), JSON.stringify(j, null, 1));
    }
  } catch { /* нет данных */ }
  try { await app?.close(); } catch { /* уже закрыто */ }
  server.close();
  void STAGE;
  const summary = `${failures ? 'FAILED' : 'PASSED'}: ${failures} failed checks`;
  line('checks.txt', summary);
  console.log(summary);
  rmSync(userData, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
}
