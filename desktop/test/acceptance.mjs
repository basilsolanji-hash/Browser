// Жёсткая приёмка настольной версии (§5 ТЗ): Playwright for Electron, проверки по состоянию
// (файлы userData, сессии, вкладки, окна), скриншоты с проверкой на «пустой экран».
// Результаты — в test-results/: checks.txt (ok/FAIL), steps.txt, main.log, console.log, PNG.
// Запуск: npm run build && node test/acceptance.mjs [этап]
import { _electron } from 'playwright';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
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
// 6 МБ неповторяющихся данных: по контрольной сумме видно, что докачка склеила файл правильно.
const BIG = Buffer.alloc(6 * 1024 * 1024);
for (let i = 0; i < BIG.length; i++) BIG[i] = (i * 31 + (i >> 11)) & 255;
const BIG_SHA = createHash('sha256').update(BIG).digest('hex');
let bigDrop = true;
const uploaded = [];
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  seen.push({ path: u.pathname + u.search, cookie: req.headers.cookie ?? '', range: req.headers.range, lang: req.headers['accept-language'] });
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (u.pathname === '/set') {
    res.setHeader('set-cookie', `os_test=${u.searchParams.get('p')}; Path=/; Max-Age=86400`);
    res.end(`<title>Set ${u.searchParams.get('p')}</title><h1>cookie set</h1>`);
  } else if (u.pathname === '/sound') {
    // Звук после нажатия (§15): плеер включается через секунду после щелчка.
    res.end(`<title>Sound</title><button id="b" style="width:200px;height:80px">play</button><script>
      window.before = new AudioContext().state;
      document.getElementById('b').onclick = () => setTimeout(() => { const c = new AudioContext(); window.after = c.state; }, 1000);
    </script>`);
  } else if (u.pathname === '/get') {
    res.end(`<title>Get</title><h1 id="c">${(req.headers.cookie ?? '').replace(/</g, '')}</h1><script>document.title='Get '+(document.cookie||'none')</script>`);
  } else if (u.pathname === '/big.bin') {
    // Медленный файл с Range/ETag: проверка паузы, обрыва и докачки после перезапуска.
    const range = req.headers.range;
    const start = range ? Number(/bytes=(\d+)-/.exec(range)[1]) : 0;
    res.writeHead(range ? 206 : 200, {
      'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="os-big.bin"', 'accept-ranges': 'bytes',
      etag: '"os-v1"', 'last-modified': 'Wed, 21 Oct 2026 07:28:00 GMT', 'content-length': BIG.length - start,
      ...(range ? { 'content-range': `bytes ${start}-${BIG.length - 1}/${BIG.length}` } : {}),
    });
    let pos = start;
    const timer = setInterval(() => {
      if (pos >= BIG.length) { clearInterval(timer); res.end(); return; }
      if (bigDrop && !range && pos >= 1024 * 1024) { bigDrop = false; clearInterval(timer); req.socket.destroy(); return; }
      const n = Math.min(32 * 1024, BIG.length - pos);
      res.write(BIG.subarray(pos, pos + n));
      pos += n;
    }, 40);
    req.on('close', () => clearInterval(timer));
    return;
  } else if (u.pathname === '/file.txt') {
    res.setHeader('content-type', 'text/plain');
    res.setHeader('content-disposition', `attachment; filename="os-test-${process.pid}.txt"`);
    res.end('Ось download test');
    return;
  } else if (u.pathname === '/tracked') {
    // Трекер — сторонний (localhost против 127.0.0.1) и есть в тестовом списке (OS_TEST_BLOCK).
    res.end(`<title>Tracked</title><img src="http://pixel-tracker.localhost:${PORT}/pixel"><img src="/first.png"><iframe src="http://localhost:${PORT}/set3p"></iframe>`);
  } else if (u.pathname === '/set3p') {
    res.setHeader('set-cookie', 'os_3p=1; Path=/; Max-Age=86400; SameSite=None; Secure');
    res.end('<title>3p</title>');
  } else if (u.pathname === '/article') {
    const para = (n) => `<p>Параграф ${n}: деловой браузер Ось хранит данные на компьютере и не отправляет их на свои серверы. ` +
      'Профили изолированы друг от друга, у каждого свои входы, cookies и история посещений, а трекеры блокируются.</p>';
    res.end(`<title>Article page</title><body><nav>menu menu menu</nav><article><h1>Ось reader test</h1>${[1, 2, 3, 4, 5, 6, 7, 8].map(para).join('')}</article>` +
      '<aside>ads</aside><script>document.title = "JS ran"</script></body>');
  } else if (u.pathname === '/upload' && req.method === 'POST') {
    // Сайт принимает файл (как вложение в почте): запоминаем, что пришло.
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      uploaded.push(Buffer.concat(chunks).toString('utf8'));
      res.end('<title>Uploaded</title><h1>ok</h1>');
    });
    return;
  } else if (u.pathname === '/upload') {
    res.end('<title>Upload</title><form method="post" enctype="multipart/form-data" action="/upload">' +
      '<input type="file" name="doc" id="file"><button id="send">Send</button></form>');
  } else if (u.pathname === '/find') {
    res.end('<title>Find</title><p>Ось ищет слово договор. Второй договор. Третий договор.</p>');
  } else if (u.pathname === '/popup-opener') {
    res.end('<title>Popup opener</title><p>popup test</p>');
  } else if (u.pathname === '/notify') {
    res.end('<title>Notify</title><p>permissions</p>');
  } else if (u.pathname === '/qa-popup') {
    // Сайт сам помечает окно как «вход» (display=popup) — проверка, что попап не плодит окна (§7.3).
    res.end('<title>QA popup host</title><button id="b" onclick="window.open(\'/qa-inner?display=popup\',\'qa\',\'width=420,height=420\')">p</button>');
  } else if (u.pathname === '/qa-inner') {
    res.end('<title>QA inner</title><button id="b" onclick="window.open(\'/qa-third\',\'_blank\')">p</button>');
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
// Ошибки скриптов на своих страницах (os://…): каждая — повод разобраться.
const ownPageErrors = [];

async function launch() {
  runNo++;
  app = await _electron.launch({
    executablePath: electronPath,
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, OS_TEST: '1', OS_USER_DATA: userData, OS_TEST_DELAY: '1500', OS_TEST_BLOCK: 'pixel-tracker.localhost' },
    timeout: 60000,
  });
  app.process().stdout?.on('data', (d) => line('main.log', `[run ${runNo}] ${String(d).trimEnd()}`));
  app.process().stderr?.on('data', (d) => line('main.log', `[run ${runNo} err] ${String(d).trimEnd()}`));
  app.on('window', (p) => {
    p.on('console', (m) => line('console.log', `[${p.url()}] ${m.type()}: ${m.text()}`));
    p.on('pageerror', (e) => { line('console.log', `[${p.url()}] PAGEERROR ${e.message}`); line('checks.txt', `note page error on ${p.url()}: ${e.message}`);
      if (p.url().startsWith('os://')) ownPageErrors.push(`${p.url()}: ${e.message}`);
    });
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
  check('sites get no preload bridge (only the notification shim)', (!sec.preload || /tab\.js$/.test(sec.preload)) && sec.bridge === 'undefined/undefined/undefined', `${sec.preload} ${sec.bridge}`);
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

  if (STAGE >= 2) {
    // --- 11. Избранное ---
    step('11. Избранное: звёздочка, Ctrl+D, папки');
    await main(() => globalThis.osTest.windows()[0].openProfile(1));
    await key('Ctrl+T');
    await typeAddress(`${SITE}/page/fav`);
    await waitFor(async () => { const x = await state(); return x.url.endsWith('/page/fav') && !x.loading; });
    const ui3 = await page('os://ui');
    await ui3.click('#star');
    await sleep(400);
    await flush();
    check('☆ adds the page to favorites', (readJson('bookmarks')?.list ?? []).some((b) => b.u.endsWith('/page/fav') && b.t === 'Page fav'));
    check('star shows the page is in favorites', (await state()).bookmarked === true);
    await key('Ctrl+D');
    await flush();
    check('Ctrl+D removes it again', !(readJson('bookmarks')?.list ?? []).some((b) => b.u.endsWith('/page/fav')));
    await key('Ctrl+D');
    await key('Ctrl+Shift+O');
    const fav = await page('os://favorites/');
    check('Ctrl+Shift+O opens favorites', fav);
    await fav.waitForSelector('.item');
    check('favorites list shows the page', (await fav.textContent('body')).includes('Page fav'));
    await fav.click('#new-folder');
    await fav.fill('.modal input', 'Work docs');
    await fav.click('.modal .btn.accent');
    await sleep(400);
    await flush();
    check('folder created in favorites', (readJson('bookmarks')?.folders ?? []).includes('Work docs'));
    await keyScreen('11-favorites', 'page');
    await key('Escape', 0, 'page');

    // --- 12. История ---
    step('12. История профиля: список, поиск, удаление');
    await key('Ctrl+H');
    const hp = await page('os://history/');
    check('Ctrl+H opens history', hp);
    await hp.waitForSelector('.item');
    const n0 = await hp.$$eval('.item', (e) => e.length);
    check('history shows visits', n0 >= 3, `${n0}`);
    await hp.fill('#search', 'fav');
    await sleep(400);
    check('history search filters', (await hp.$$eval('.item', (e) => e.length)) === 1);
    await keyScreen('12-history', 'page');
    await hp.click('.item .icon-btn');
    await sleep(400);
    await flush();
    check('history entry deleted', !(readJson('history')?.h?.['1'] ?? []).some((v) => v.u.endsWith('/page/fav')));
    await key('Escape', 0, 'page');

    // --- 13. Загрузки ---
    step('13. Загрузки: файл сохраняется в «Загрузки/Ось» и виден в списке');
    await typeAddress(`${SITE}/file.txt`);
    const dl = await waitFor(async () => { await flush(); return (readJson('downloads')?.list ?? []).find((d) => d.state === 'completed'); }, 15000);
    check('download completed and logged', dl, JSON.stringify(dl));
    check('downloaded file saved in Downloads/Ось', dl && existsSync(dl.path) && readFileSync(dl.path, 'utf8') === 'Ось download test' && /[\\/]Ось[\\/]/.test(dl.path), dl?.path);
    await key('Ctrl+J');
    const dp = await page('os://downloads/');
    await dp.waitForSelector('.item');
    check('downloads screen lists the file', (await dp.textContent('.item .t')) === dl?.name);
    await keyScreen('13-downloads', 'page');
    if (dl) rmSync(dl.path, { force: true });
    await key('Escape', 0, 'page');

    // --- 14. Сохранённые страницы ---
    step('14. Сохранить страницу в PDF');
    await typeAddress(`${SITE}/page/save`);
    await waitFor(async () => { const x = await state(); return x.url.endsWith('/page/save') && !x.loading; });
    await key('Ctrl+S');
    const sp = await waitFor(async () => { await flush(); return (readJson('saved_pages')?.list ?? [])[0]; }, 15000);
    const pdfPath = sp && join(userData, 'saved', sp.file);
    check('page saved as PDF', sp && existsSync(pdfPath) && readFileSync(pdfPath).subarray(0, 4).toString() === '%PDF', JSON.stringify(sp));
    check('saved page title and address', sp?.title === 'Page save' && sp.url.endsWith('/page/save'));
    await main(() => globalThis.osTest.windows()[0].openPanel('os://saved/'));
    const svp = await page('os://saved/');
    await svp.waitForSelector('.item');
    check('saved pages screen lists it', (await svp.textContent('.item .t')) === 'Page save');
    await keyScreen('14-saved', 'page');

    // --- 15. Статистика и заметки ---
    step('15. Статистика и заметки');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://stats/'));
    const stp = await page('os://stats/');
    await stp.waitForSelector('#pages-total');
    const total = Number(await stp.textContent('#pages-total'));
    await flush();
    check('statistics counts opened pages', total > 0 && (readJson('stats')?.pages?.['1'] ?? 0) > 0, `${total}`);
    await keyScreen('15-stats', 'page');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://notes/'));
    const np = await page('os://notes/');
    await np.click('#new-note');
    await np.fill('.modal textarea', 'Позвонить клиенту в 15:00');
    await np.click('.modal .btn.accent');
    await sleep(400);
    await flush();
    check('note saved locally', (readJson('notes')?.list ?? []).some((n) => n.text === 'Позвонить клиенту в 15:00'));
    await keyScreen('15-notes', 'page');

    // --- 16. Очистка профиля ---
    step('16. Очистка данных и выход из аккаунтов профиля 2');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://clear/?profile=2'));
    const cp = await page('os://clear/');
    await cp.waitForSelector('#o-logout');
    await keyScreen('16-clear', 'page');
    await cp.check('#o-logout');
    await cp.click('#do-clear');
    await cp.click('.modal .btn.accent');
    const c2 = await waitFor(async () => (await main(async ({ session }) => (await session.fromPartition('persist:profile_2').cookies.get({})).length)) === 0, 15000);
    check('profile 2 cookies removed', c2);
    const gone = await waitFor(async () => { await flush(); return !readJson('tabs')?.profiles?.['2'] && !readJson('history')?.h?.['2']; }, 10000);
    check('profile 2 tabs and history removed', gone);
    const c1 = await main(async ({ session }) => (await session.fromPartition('persist:profile_1').cookies.get({ name: 'os_test' }))[0]?.value);
    check('other profiles not affected', c1 === 'one', c1);
  }
  if (STAGE >= 3) {
    // --- 17. Защита от трекеров и сторонние cookies ---
    step('17. Трекеры блокируются, сторонние cookies не ставятся, «только HTTPS»');
    await main(() => globalThis.osTest.windows()[0].openProfile(1));
    await key('Ctrl+T');
    const before17 = seen.length;
    await typeAddress(`${SITE}/tracked`);
    await waitFor(async () => { const x = await state(); return x.url.endsWith('/tracked') && !x.loading; });
    await sleep(800);
    const reqs = seen.slice(before17).map((r) => r.path);
    check('third-party tracker request is blocked', reqs.includes('/tracked') && !reqs.includes('/pixel'), reqs.join(' '));
    check('first-party request still loads', reqs.includes('/first.png'));
    const sb = await state();
    check('address bar shows blocked trackers count', sb.blocked >= 1, `${sb.blocked}`);
    await flush();
    check('statistics count blocked trackers', await waitFor(async () => { await flush(); return (readJson('stats')?.trackers ?? 0) >= 1; }, 5000));
    check('cross-site cookie from an embedded site is not stored',
      (await main(async ({ session }) => (await session.fromPartition('persist:profile_1').cookies.get({ name: 'os_3p' })).length)) === 0);
    await keyScreen('17-tracked-chrome', 'chrome');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/'));
    const st3 = await page('os://settings/');
    await st3.waitForSelector('#https');
    await st3.click('#https button >> nth=0');
    await sleep(300);
    await flush();
    check('HTTPS-only saved', readJson('settings')?.httpsOnly === true);
    await main(() => globalThis.osTest.windows()[0].closePanel());
    await typeAddress('http://os-https-test.invalid/');
    const up = await waitFor(async () => { const x = await state(); return x.url.startsWith('https://os-https-test.invalid') && x; }, 10000);
    check('HTTPS-only upgrades http:// addresses', up, (await state()).url);
    // Поиск в настройках.
    await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/'));
    await st3.fill('#settings-search', 'HTTPS');
    await sleep(300);
    const vis = await st3.$$eval('.setting', (els) => els.filter((e) => !e.hidden && e.offsetParent !== null).length);
    check('settings search leaves matching rows', vis >= 1 && vis <= 3, `${vis}`);
    await st3.fill('#settings-search', 'qqqzzz');
    await sleep(200);
    check('settings search shows «nothing found»', await st3.isVisible('#nothing'));
    await keyScreen('17-settings-search', 'page');
    await st3.fill('#settings-search', '');
    await main(() => globalThis.osTest.windows()[0].closePanel());

    // --- 18. Разрешения сайтов ---
    step('18. Разрешения: запрос, запоминание по сайту и профилю');
    const ui3 = await page('os://ui');
    await typeAddress(`${SITE}/notify`);
    await waitFor(async () => (await state()).url.endsWith('/notify'));
    const tab18 = await page(`${SITE}/notify`);
    const res18 = tab18.evaluate(() => window.Notification.requestPermission());
    const pr = await waitFor(async () => (await state()).prompt, 8000);
    check('site permission request shows a prompt', pr && /127\.0\.0\.1/.test(pr.text), pr?.text);
    await keyScreen('18-permission-prompt', 'chrome');
    await windowShot('permission-prompt');
    await ui3.click('#perm-allow');
    check('page gets the permission after «Allow»', (await res18) === 'granted');
    await flush();
    check('decision saved for site and profile', readJson('site_permissions')?.sites?.['1']?.['127.0.0.1']?.notifications === 'ALLOW');
    await main(() => globalThis.osTest.windows()[0].openProfile(4));
    await key('Ctrl+T');
    await typeAddress(`${SITE}/notify`);
    await waitFor(async () => (await state()).url.endsWith('/notify') && (await state()).profile.id === 4);
    const tab18b = app.windows().filter((p) => p.url() === `${SITE}/notify`).pop();
    const res18b = tab18b.evaluate(() => window.Notification.requestPermission());
    const pr2 = await waitFor(async () => (await state()).prompt, 8000);
    check('another profile is asked again', pr2);
    await ui3.click('#perm-block');
    check('«Block» denies the permission', (await res18b) === 'denied');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://site/?profile=1'));
    const sp3 = await page('os://site/');
    await sp3.waitForSelector('.host');
    check('site permissions screen lists the site', (await sp3.textContent('.host')).includes('127.0.0.1'));
    await keyScreen('18-site-permissions', 'page');

    // --- 19. Проверка безопасности, PIN, скрытие окна ---
    step('19. Проверка безопасности, PIN и скрытие содержимого');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://security/'));
    const sec3 = await page('os://security/');
    await sec3.waitForSelector('#score');
    const score1 = await sec3.textContent('#score .big');
    check('security check shows a score', /^\d\/\d$/.test(score1), score1);
    check('security check counts granted permissions', (await sec3.getAttribute('.check[data-id="perms"]', 'class')).includes('bad'));
    await keyScreen('19-security', 'page');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/'));
    await st3.waitForSelector('#pin-set');
    await st3.click('#pin-set');
    const pins3 = await st3.$$('.modal input');
    await pins3[0].fill('2468');
    await pins3[1].fill('2468');
    await st3.click('.modal .btn.accent');
    await sleep(500);
    await flush();
    const lockData = readJson('settings')?.lock;
    check('PIN stored only as a hash', lockData?.hash?.length === 64 && !JSON.stringify(readJson('settings')).includes('2468'));
    await st3.click('#hide button >> nth=0');
    await sleep(300);
    await flush();
    check('hide content saved', readJson('settings')?.hideContent === true);
    await main(() => globalThis.osTest.windows()[0].openPanel('os://security/'));
    await sec3.waitForSelector('#score');
    const score2 = await sec3.textContent('#score .big');
    check('security score improves after fixes', Number(score2.split('/')[0]) > Number(score1.split('/')[0]), `${score1} → ${score2}`);
    await main(() => globalThis.osTest.windows()[0].closePanel());
    const tabsBefore = (await state()).tabs.length;
    await main(() => globalThis.osTest.windows().forEach((w) => w.lock()));
    const lp = await page('os://lock/');
    check('lock screen shown', lp);
    const hidden = await main(() => { const w = globalThis.osTest.windows()[0]; return !w.chrome.getVisible() && w.liveTabs().every((v) => !v.view.getVisible()); });
    check('tabs and chrome hidden under the lock', hidden);
    await key('Ctrl+T', 0, 'page');
    check('shortcuts ignored while locked', (await state()).tabs.length === tabsBefore);
    await keyScreen('19-lock', 'page');
    await lp.fill('#pin', '1111');
    await lp.click('#unlock');
    await sleep(300);
    check('wrong PIN rejected', (await lp.textContent('#err')).length > 0 && (await state()).locked === true);
    await lp.fill('#pin', '2468');
    await lp.click('#unlock');
    check('correct PIN unlocks', await waitFor(async () => (await state()).locked === false));
    check('tab visible again after unlock', await main(() => globalThis.osTest.windows()[0].liveTabs().some((v) => v.view.getVisible())));
  }
  if (STAGE >= 4) {
    // --- 20. Режим чтения ---
    step('20. Режим чтения (Readability) без скриптов страницы');
    await main(() => globalThis.osTest.windows()[0].openProfile(1));
    await key('Ctrl+T');
    await typeAddress(`${SITE}/article`);
    await waitFor(async () => { const x = await state(); return x.url.endsWith('/article') && !x.loading; });
    await key('Ctrl+Alt+R');
    const rd = await waitFor(async () => { const x = await state(); return x.reader && !x.loading && x; }, 10000);
    check('reader mode opens', rd);
    check('address bar keeps the article address in reader mode', rd && rd.url.endsWith('/article'), rd?.url);
    const rtext = await main(() => globalThis.osTest.windows()[0].activeWebContents().executeJavaScript('document.body.innerText'));
    check('reader shows the article text', rtext.includes('Ось reader test') && rtext.includes('Параграф 8'), rtext.slice(0, 80));
    const scriptsLeft = await main(() => globalThis.osTest.windows()[0].activeWebContents().executeJavaScript('document.scripts.length + document.querySelectorAll("iframe,object,embed,[onclick]").length'));
    check('reader page has no site scripts or embeds', scriptsLeft === 0, `${scriptsLeft}`);
    await keyScreen('20-reader', 'tab');
    await key('Ctrl+Alt+R');
    check('reader mode exits', await waitFor(async () => { const x = await state(); return !x.reader && x.url.endsWith('/article'); }));

    // --- 21. Выделенный текст → заметка, поиск ---
    step('21. Действия с выделенным текстом');
    await main(() => {
      const w = globalThis.osTest.windows()[0];
      const tab = w.liveTabs().find((v) => v.wc === w.activeWebContents());
      w.addNote('Цитата из статьи', tab.url());
      w.searchText('ось браузер', tab);
    });
    await flush();
    check('«Add to note» saves the selection with its page', (readJson('notes')?.list ?? []).some((n) => n.text === 'Цитата из статьи' && n.source.endsWith('/article')));
    check('«Search» opens a search tab', await waitFor(async () => (await state()).tabs.some((x) => /duckduckgo\.com\/\?q=/.test(x.url))));

    // --- 22. Уведомления сайтов → Windows ---
    step('22. Уведомления сайтов с именем профиля, нажатие открывает вкладку');
    await typeAddress(`${SITE}/notify`);
    await waitFor(async () => (await state()).url.endsWith('/notify') && !(await state()).loading);
    const nt = app.windows().filter((p) => p.url() === `${SITE}/notify`).pop();
    await nt.evaluate(() => { window.__clicked = false; const n = new window.Notification('Hello', { body: 'World' }); n.onclick = () => { window.__clicked = true; }; });
    const shownN = await waitFor(async () => (await main(() => globalThis.osTest.notifications())).find((n) => n.title.endsWith('Hello')), 5000);
    const pname = (await state()).profile.name;
    check('site notification shown with the profile name', shownN && shownN.title === `${pname} · Hello` && shownN.body === 'World', JSON.stringify(shownN));
    const notifTab = (await state()).active;
    await main(() => globalThis.osTest.windows()[0].activate('start'));
    await main(() => globalThis.osTest.clickNotification());
    check('click opens the tab', await waitFor(async () => (await state()).active === notifTab));
    check('page gets the click event', await waitFor(() => nt.evaluate(() => window.__clicked === true)));
    await main(() => globalThis.osTest.windows()[0].openProfile(4));
    await key('Ctrl+T');
    await typeAddress(`${SITE}/notify`);
    await waitFor(async () => (await state()).url.endsWith('/notify') && (await state()).profile.id === 4);
    const nt4 = app.windows().filter((p) => p.url() === `${SITE}/notify`).pop();
    await nt4.evaluate(() => window.dispatchEvent(new window.CustomEvent('os-notify', { detail: JSON.stringify({ id: 'f', title: 'Forged' }) })));
    await sleep(500);
    check('no notification without permission (forged event ignored)', !(await main(() => globalThis.osTest.notifications())).some((n) => n.title.endsWith('Forged')));

    // --- 23. Полный экран ---
    step('23. Полный экран F11');
    await key('F11');
    check('F11 enters full screen and hides the chrome', await waitFor(() => main(() => { const w = globalThis.osTest.windows()[0]; return w.win.isFullScreen() && !w.chrome.getVisible(); })));
    await key('F11', 0, 'tab');
    check('F11 again leaves full screen', await waitFor(() => main(() => !globalThis.osTest.windows()[0].win.isFullScreen())));

    // --- 24. Ссылка из другой программы ---
    step('24. Открытие ссылок, переданных при запуске');
    await main(({ app: a }, url) => a.emit('second-instance', {}, ['os.exe', '--flag', 'file:///C:/Windows/win.ini', url], process.cwd()), `${SITE}/page/external`);
    check('URL from another program opens in a new tab', await waitFor(async () => (await state()).tabs.some((x) => x.url.endsWith('/page/external'))));
    const bad = await main(({ app: a }) => { a.emit('second-instance', {}, ['os.exe', 'javascript:alert(1)'], process.cwd()); return 1; });
    void bad;
    await sleep(400);
    check('dangerous schemes from the command line are ignored', !(await state()).tabs.some((x) => /^(javascript|file):/.test(x.url)));

    // --- 25. О приложении, справка ---
    step('25. О приложении и «Справка и отзывы»');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://about/'));
    const ab = await page('os://about/');
    await ab.waitForSelector('.ver');
    const abText = await ab.textContent('body');
    check('about shows version and Chromium engine', /Chromium \d+/.test(abText) && /Electron \d+/.test(abText));
    check('about lists open-source licenses', abText.includes('Readability') && abText.includes('EasyPrivacy'));
    await keyScreen('25-about', 'page');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://help/'));
    const hp4 = await page('os://help/');
    await hp4.waitForSelector('.qa');
    check('help has 6 answers and a feedback address', (await hp4.$$eval('.qa', (e) => e.length)) === 6 && (await hp4.textContent('body')).includes('hello@os-browser.com'));
    await keyScreen('25-help', 'page');

    // --- 26. Язык во всех окнах сразу ---
    step('26. Смена языка сразу во всех окнах');
    await key('Ctrl+Shift+N');
    await waitFor(async () => (await main(() => globalThis.osTest.windows().length)) === 2);
    const iui4 = await waitFor(() => app.windows().filter((p) => p.url().startsWith('os://ui/?incognito')).pop());
    await iui4.waitForSelector('#address');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/'));
    const st4 = await page('os://settings/');
    await st4.waitForSelector('#lang');
    await st4.selectOption('#lang', 'de');
    check('incognito window switched language too', await waitFor(async () => (await iui4.getAttribute('#address', 'placeholder')) === 'Adresse oder Suche'));
    await st4.selectOption('#lang', 'ru');
    await main(() => globalThis.osTest.windows()[1].win.close());
  }
  if (STAGE >= 2) {
    // --- 29. Отправка файла на сайт ---
    step('29. Отправка файла на сайт (выбор файла и форма)');
    await main(() => globalThis.osTest.windows()[0].closePanel());
    await key('Ctrl+T');
    await typeAddress(`${SITE}/upload`);
    await waitFor(async () => { const x = await state(); return x.url.endsWith('/upload') && !x.loading; });
    const up = app.windows().filter((p) => p.url() === `${SITE}/upload`).pop();
    const file = join(tmpdir(), `os-upload-${process.pid}.txt`);
    writeFileSync(file, 'Договор №7 — Ось upload test');
    await up.setInputFiles('#file', file);
    await up.click('#send');
    const got = await waitFor(() => uploaded.find((b) => b.includes('Ось upload test')), 10000);
    check('site receives the chosen file (form upload)', got && got.includes('filename="os-upload-'), got?.slice(0, 120));
    check('page after upload loads', await waitFor(async () => (await state()).title === 'Uploaded'));
    rmSync(file, { force: true });
  }

  if (STAGE >= 4) {
    // --- 30. Найти на странице ---
    step('30. Найти на странице (Ctrl+F, Enter, Esc)');
    await main(() => globalThis.osTest.windows()[0].closePanel());
    await typeAddress(`${SITE}/find`);
    await waitFor(async () => { const x = await state(); return x.url.endsWith('/find') && !x.loading; });
    await key('Ctrl+F');
    const uiF = await page('os://ui');
    check('Ctrl+F opens the find bar', await waitFor(async () => (await state()).find !== null && await uiF.isVisible('#find')));
    await uiF.fill('#find', 'договор');
    const f1 = await waitFor(async () => { const f = (await state()).find; return f && f.matches === 3 && f; });
    check('find counts matches on the page', f1, JSON.stringify((await state()).find));
    await uiF.press('#find', 'Enter');
    check('Enter goes to the next match', await waitFor(async () => (await state()).find?.active === 2));
    await keyScreen('30-find-bar', 'chrome');
    await uiF.fill('#find', 'нетакогослова');
    check('no matches is shown', await waitFor(async () => { const f = (await state()).find; return f && f.matches === 0; }));
    await uiF.press('#find', 'Escape');
    check('Esc closes the find bar', await waitFor(async () => (await state()).find === null));

    // --- 31. Окна входа (попапы) под защитой ---
    step('31. Попапы: одно окно на вкладку, новые окна из попапа — вкладками, без os://');
    await typeAddress(`${SITE}/popup-opener`);
    await waitFor(async () => (await state()).url.endsWith('/popup-opener'));
    const po = app.windows().filter((p) => p.url() === `${SITE}/popup-opener`).pop();
    const winCount = () => main(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const w0 = await winCount();
    await po.evaluate(() => { window.open('/page/login?display=popup', 'p1'); });
    check('auth popup opens as a window', await waitFor(async () => (await winCount()) === w0 + 1));
    const popupPage = await page(`${SITE}/page/login`);
    const tabs0 = (await state()).tabs.length;
    await popupPage.evaluate(() => { window.open('/page/third?display=popup'); });
    await sleep(800);
    check('window.open from the popup opens a tab, not a window', (await winCount()) === w0 + 1 && (await state()).tabs.length === tabs0 + 1);
    await po.evaluate(() => { window.open('/page/second?display=popup', 'p2'); });
    await sleep(800);
    check('only one auth popup per tab (second → tab)', (await winCount()) === w0 + 1);
    await popupPage.evaluate(() => { window.location.href = 'os://start/'; });
    await sleep(600);
    check('popup cannot navigate to os://', popupPage.url().startsWith(SITE));
    const ptitle = await main(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()).find((x) => x.startsWith('127.0.0.1')) ?? '');
    check('popup title shows the site', ptitle.startsWith('127.0.0.1'), ptitle);
    await main(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.getTitle().startsWith('127.0.0.1')).forEach((w) => w.close()));
  }

  if (STAGE >= 5) {
    // --- 27. Обновления ---
    step('27. Автообновление: настройка и состояние');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/'));
    const st5 = await page('os://settings/');
    await st5.waitForSelector('#auto-update');
    check('updates section present (installed-only notice in dev build)', (await st5.isDisabled('#update-check')) === true);
    await st5.click('#auto-update button >> nth=1');
    await sleep(300);
    await flush();
    check('automatic updates can be turned off', readJson('settings')?.autoUpdate === false);
    await st5.click('#auto-update button >> nth=0');
    await sleep(300);
    await flush();
    check('automatic updates on by default and saved', readJson('settings')?.autoUpdate === true);
    await keyScreen('27-settings-updates', 'page');
    // PIN (задан в сценарии 19) нельзя сменить или снять без текущего.
    const pinWrong = await st5.evaluate(() => window.os.call('setPin', '1357', '0000'));
    const rmWrong = await st5.evaluate(() => window.os.call('removePin', '0000'));
    await flush();
    check('PIN cannot be changed or removed without the current PIN', pinWrong === 'wrong' && rmWrong === 'wrong' && !!readJson('settings')?.lock, `${pinWrong} ${rmWrong}`);

    // --- 28. Докачка ---
    step('28. Загрузки: обрыв связи, пауза и докачка после перезапуска с того же места');
    await main(() => globalThis.osTest.windows()[0].closePanel());
    const bigReqs = () => seen.filter((r) => r.path === '/big.bin');
    const n0 = bigReqs().length;
    await typeAddress(`${SITE}/big.bin`);
    const dlEntry = async () => { await flush(); return (readJson('downloads')?.list ?? []).find((d) => d.name.startsWith('os-big')); };
    check('download resumes by itself after a dropped connection (Range request)',
      await waitFor(async () => bigReqs().slice(n0).some((r) => /^bytes=\d+-/.test(r.range ?? '')), 20000), JSON.stringify(bigReqs().slice(n0)));
    await key('Ctrl+J');
    const dlp = await page('os://downloads/');
    await dlp.waitForSelector('.dl-pause', { timeout: 15000 });
    await dlp.click('.dl-pause');
    check('pause stops the download', await waitFor(async () => (await dlEntry())?.state === 'paused'));
    const pausedAt = (await dlEntry()).received;
    await sleep(800);
    check('paused download does not grow', (await dlEntry()).received === pausedAt);
    await keyScreen('28-download-paused', 'page');
    await dlp.click('.dl-resume');
    check('resume continues the download', await waitFor(async () => { const d = await dlEntry(); return d.state === 'progress' && d.received > pausedAt; }));
    await sleep(500);
    await flush();
    await app.close();
    const mid = (readJson('downloads')?.list ?? []).find((d) => d.name.startsWith('os-big'));
    check('unfinished download is kept as resumable after quitting', mid?.state === 'interrupted' && mid.resumable === true && mid.received < BIG.length, JSON.stringify(mid && { s: mid.state, r: mid.received }));
    const n1 = bigReqs().length;
    await launch();
    // После перезапуска браузер под PIN (сценарий 19).
    const lock2 = await page('os://lock/', 8000);
    if (lock2) {
      await lock2.fill('#pin', '2468');
      await lock2.click('#unlock');
      await waitFor(async () => (await state())?.locked === false);
    }
    await main(() => globalThis.osTest.windows()[0].openPanel('os://downloads/'));
    const dlp2 = await page('os://downloads/');
    await dlp2.waitForSelector('.dl-resume', { timeout: 15000 });
    await keyScreen('28-download-interrupted', 'page');
    await dlp2.click('.dl-resume');
    const done = await waitFor(async () => { const d = await dlEntry(); return d?.state === 'completed' && d; }, 40000);
    const after = bigReqs().slice(n1);
    check('after restart the download continues from the same point (Range, not from zero)',
      after.length > 0 && after.every((r) => /^bytes=[1-9]\d*-/.test(r.range ?? '')), JSON.stringify(after));
    const sha = done && existsSync(done.path) ? createHash('sha256').update(readFileSync(done.path)).digest('hex') : '';
    check('resumed file is complete and intact (sha256)', sha === BIG_SHA, `${done?.path} ${sha.slice(0, 12)}`);
    if (done) rmSync(done.path, { force: true });
  }
  if (STAGE >= 6) {
    // --- 32. Попапы сайтов (§7.3) ---
    step('32. Попап входа не открывает новые окна и не уходит на os:// и file://');
    await main(() => { const w = globalThis.osTest.windows()[0]; w.openProfile(1); w.closePanel(); });
    await sleep(800);
    await main((_e, u) => globalThis.osTest.windows()[0].newTab(u), `${SITE}/qa-popup`);
    const host = await page(`${SITE}/qa-popup`);
    const winCount = () => main(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const before = await winCount();
    await host.click('#b');
    const inner = await page(`${SITE}/qa-inner`);
    check('site popup marked display=popup opens one window', inner && (await winCount()) === before + 1);
    if (inner) {
      await inner.click('#b');
      await sleep(1500);
      check('window.open from a popup does not create another window', (await winCount()) === before + 1, `windows ${await winCount()} (было ${before + 1})`);
      check('window.open from a popup opens a tab in the browser window',
        (await state()).tabs.some((t) => t.url === `${SITE}/qa-third`), JSON.stringify(tabUrls(await state())));
      await inner.evaluate(() => { window.location.href = 'file:///'; }).catch(() => {});
      await sleep(800);
      check('popup cannot navigate to file://', inner.isClosed() || !inner.url().startsWith('file:'), inner.isClosed() ? 'closed' : inner.url());
      await inner.evaluate(() => { window.location.href = 'os://start/'; }).catch(() => {});
      await sleep(800);
      check('popup cannot navigate to os://', inner.isClosed() || !inner.url().startsWith('os://'), inner.isClosed() ? 'closed' : inner.url());
      await main(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) if (!globalThis.osTest.windows().some((x) => x.win === w)) w.close();
      });
    }
    // --- 33. Свои страницы без ошибок скриптов ---
    step('33. Свои страницы (os://) отработали без ошибок скриптов');
    check('no script errors on own pages (os://)', ownPageErrors.length === 0, ownPageErrors.slice(0, 5).join(' | '));

    // --- 34. Меню ⋮ как в Chrome (WINDOWS_SYNC §1) ---
    step('34. Меню ⋮: ряд кнопок, группы, избранное, мобильная версия, диагностика');
    await main(() => { const w = globalThis.osTest.windows()[0]; w.openProfile(1); w.closePanel(); });
    await main((_e, u) => globalThis.osTest.windows()[0].newTab(u), `${SITE}/set?p=menu`);
    const s34a = await waitFor(async () => { const x = await state(); return x.url.includes('p=menu') && !x.loading && x; });
    check('menu: test page opened in a profile tab', s34a && !s34a.panel, JSON.stringify(s34a && { panel: s34a.panel, url: s34a.url }));
    const menuReq = seen.filter((r) => r.path === '/set?p=menu').pop();
    const appLang = readJson('settings')?.lang;
    check('sites get Accept-Language = app language', appLang && menuReq?.lang?.startsWith(appLang), `${appLang} / ${menuReq?.lang}`);
    const mui = await waitFor(() => app.windows().find((p) => !p.isClosed() && p.url().startsWith('os://ui') && !p.url().includes('incognito')));
    if (!(await mui.waitForSelector('#more', { timeout: 5000 }).catch(() => null))) await windowShot('34-no-menu-button');
    const openMenu = async () => {
      if (await mui.$('.main-menu')) { await mui.keyboard.press('Escape'); await mui.waitForSelector('.main-menu', { state: 'detached' }); }
      await mui.click('#more');
      await mui.waitForSelector('.main-menu');
    };
    await openMenu();
    const shape = await mui.evaluate(() => {
      const m = document.querySelector('.main-menu');
      const r = m.getBoundingClientRect();
      return {
        round: m.querySelectorAll('.toprow .round').length,
        backDisabled: m.querySelector('.toprow .round').disabled,
        groups: m.querySelectorAll('.sep').length,
        icons: [...m.querySelectorAll(':scope > button')].every((b) => b.querySelector('.ic svg')),
        fits: r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1 && r.width < window.innerWidth,
        height: m.scrollHeight,
        cut: [...m.querySelectorAll('.grow')].filter((g) => g.scrollWidth > g.clientWidth + 1).map((g) => g.textContent),
        labels: [...m.querySelectorAll('.toprow .round')].every((b) => b.getAttribute('aria-label')),
      };
    });
    const s34 = await state();
    check('menu: row of 5 round buttons with labels', shape.round === 5 && shape.labels, JSON.stringify(shape));
    check('menu: Back disabled when there is nowhere to go', shape.backDisabled === !s34.canBack);
    check('menu: groups divided by lines, every item has an icon', shape.groups >= 5 && shape.icons, JSON.stringify(shape));
    check('menu: fits a 768 px laptop screen (rare items under «More tools»)', shape.height <= 660, `height=${shape.height}`);
    check('menu: labels are not cut off', shape.cut.length === 0, shape.cut.join(' | '));
    check('menu: card at the corner, not full screen, fits the window', shape.fits);
    await keyScreen('34-menu', 'chrome');
    await mui.click('.main-menu .toprow .round:nth-child(3)');
    check('menu: star adds the page to favorites', await waitFor(async () => (await state()).bookmarked));
    await openMenu();
    check('menu: star shows as pressed', (await mui.getAttribute('.main-menu .toprow .round:nth-child(3)', 'aria-pressed')) === 'true');
    const openMore = async () => { await openMenu(); await mui.click('.main-menu [data-k="more-tools"]'); await mui.waitForSelector('.main-menu [data-k="back-menu"]'); };
    await openMore();
    await keyScreen('34-more-tools', 'chrome');
    await mui.click('.main-menu [data-k="mobile"]');
    const tabPage = await page(`${SITE}/set?p=menu`);
    check('menu: mobile site switches the User-Agent', await waitFor(async () => /Mobile/.test(await tabPage.evaluate(() => window.navigator.userAgent).catch(() => ''))));
    await openMore();
    check('menu: mobile site item is checked', (await mui.getAttribute('.main-menu [data-k="mobile"]', 'aria-checked')) === 'true');
    await mui.click('.main-menu [data-k="mobile"]');
    check('menu: mobile site off restores the desktop User-Agent', await waitFor(async () => !/Mobile/.test(await tabPage.evaluate(() => window.navigator.userAgent).catch(() => 'Mobile'))));
    await openMore();
    await mui.click('.main-menu [data-k="diag"]');
    const diag = await mui.waitForSelector('#diag-text').then((e) => e.textContent()).catch(() => '');
    check('menu: diagnostics shows version and page log', diag.includes('p=menu') && /Ось \d/.test(diag), diag.slice(0, 200));
    await keyScreen('34-diagnostics', 'chrome');
    await mui.keyboard.press('Escape');
    await openMenu();
    await mui.click('.main-menu [data-k="group"]');
    const tp = await page('os://tabs/');
    check('menu: New tab group asks for the group name', tp && await tp.waitForSelector('.modal input', { timeout: 5000 }).then(() => true).catch(() => false));
    await tp?.keyboard.press('Escape');
    await main(() => globalThis.osTest.windows()[0].closePanel());

    // --- 35. Панель адресной строки как в Chrome (WINDOWS_SYNC §3) ---
    step('35. Адресная строка: поисковик, «Очистить», карточка страницы, частые сайты, прошлые запросы, ↖');
    await main(() => {
      globalThis.osTest.addHistory(1, 'https://duckduckgo.com/?q=weather+moscow', 'weather moscow at DuckDuckGo');
      globalThis.osTest.addHistory(1, 'https://yandex.ru/search/?text=weather+spb&lr=2', '');
    });
    await waitFor(async () => !(await state()).panel);
    await mui.click('#address');
    await mui.waitForSelector('.addr-panel', { timeout: 5000 }).catch(() => null);
    const empty = await mui.evaluate(() => ({
      engine: window.getComputedStyle(document.getElementById('engine')).display !== 'none' && document.getElementById('engine')?.dataset.engine,
      lockHidden: [...document.querySelectorAll('#addr > .ic')].every((x) => window.getComputedStyle(x).display === 'none'),
      card: !!document.querySelector('.addr-panel .pagecard'),
      tiles: [...document.querySelectorAll('.addr-panel .tile')].map((x) => [x.title, x.querySelector('.lbl').textContent]),
      clear: !document.getElementById('addr-clear')?.hidden,
      net: [...document.querySelectorAll('.addr-panel img')].length,
    }));
    check('address: engine badge on the left while typing (instead of the lock)', !!empty.engine && empty.lockHidden, JSON.stringify(empty));
    check('address: current page card on empty input', empty.card);
    check('address: frequent sites tiles (letter + page title, not domain)', empty.tiles.length > 0 && empty.tiles.length <= 8 && empty.tiles.some(([h, l]) => l && l !== h), JSON.stringify(empty.tiles));
    check('address: tiles do not load icons from the network', empty.net === 0);
    check('address: clear button shown when there is text', empty.clear);
    await keyScreen('35-address-empty', 'chrome');
    await mui.fill('#address', '');
    await mui.keyboard.type('weath', { delay: 10 });
    await mui.waitForSelector('.addr-panel .hint-row[data-kind="query"]', { timeout: 5000 }).catch(() => null);
    const rows = await mui.$$eval('.addr-panel .hint-row', (els) => els.map((e) => [e.dataset.kind, e.querySelector('.ttl').textContent, !!e.querySelector('.fill')]));
    check('address: first row is the typed query itself', rows[0]?.[0] === 'search' && rows[0][1].includes('weath') && !rows[0][2], JSON.stringify(rows));
    check('address: past search queries from history (q=, text=)', rows.filter((r) => r[0] === 'query').map((r) => r[1]).join('|') === 'weather spb|weather moscow', JSON.stringify(rows));
    check('address: every row except the first has ↖ «fill in»', rows.slice(1).every((r) => r[2]));
    await keyScreen('35-address-typing', 'chrome');
    await mui.click('.addr-panel .hint-row[data-kind="query"] .fill');
    check('address: ↖ puts the suggestion into the field', await waitFor(async () => (await mui.inputValue('#address')) === 'weather spb'), await mui.inputValue('#address'));
    await mui.click('#addr-clear');
    check('address: × clears the field and shows tiles again', await waitFor(async () => (await mui.inputValue('#address')) === '' && (await mui.$('.addr-panel .tile')) !== null));
    await mui.keyboard.press('Escape');

    // --- 36. Звук после нажатия (WINDOWS_SYNC §15) ---
    step('36. Звук: сам сайт не включает, после нажатия плеер играет со звуком');
    await main((_e, u) => globalThis.osTest.windows()[0].newTab(u), `${SITE}/sound`);
    const snd = await page(`${SITE}/sound`);
    await snd.waitForLoadState();
    check('no sound without a user action (autoplay blocked)', (await snd.evaluate(() => window.before)) === 'suspended', await snd.evaluate(() => window.before));
    await snd.click('#b');
    const after = await waitFor(() => snd.evaluate(() => window.after), 5000);
    check('sound allowed for a player started shortly after a click', after === 'running', String(after));

    // --- 37. Микрофон, камера, геолокация: «Разрешить» и понятный запрет (WINDOWS_SYNC §18) ---
    step('37. Разрешения: «Разрешить» по умолчанию для камеры и микрофона, запрет — с подсказкой');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://site/?profile=1'));
    const sp = await page('os://site/');
    await sp.waitForSelector('#d-camera');
    const segs = await sp.$$eval('#d-location button, #d-camera button, #d-microphone button', (b) => b.length);
    check('location, camera and microphone defaults: Ask · Allow · Block', segs === 9, `buttons=${segs}`);
    await keyScreen('37-site-permissions', 'page');
    await main(() => globalThis.osTest.windows()[0].closePanel());
    await main(() => globalThis.osTest.setPerm(1, '127.0.0.1', 'location', 'BLOCK'));
    await snd.evaluate(() => { window.navigator.geolocation.getCurrentPosition(() => {}, () => {}); });
    const ui37 = await page('os://ui');
    const toast37 = await ui37.waitForSelector('.toast', { timeout: 5000 }).then((e) => e.textContent()).catch(() => '');
    check('blocked permission is explained (site settings), not silent', /127\.0\.0\.1/.test(toast37), toast37);
    await main(() => globalThis.osTest.setPerm(1, '127.0.0.1', 'location', null));

    // --- 38. Кнопка на панели на выбор (WINDOWS_SYNC §6) ---
    step('38. Кнопка справа от адресной строки: по умолчанию «Скачанные файлы», меняется в настройках');
    check('toolbar button defaults to Downloads', (await ui37.getAttribute('#tb-btn', 'data-k')) === 'downloads');
    await ui37.click('#tb-btn');
    check('toolbar button opens Downloads', await page('os://downloads/', 5000));
    await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/'));
    const st38 = await page('os://settings/');
    await st38.selectOption('#toolbar-button', 'find');
    await main(() => globalThis.osTest.windows()[0].closePanel());
    check('toolbar button switched to «Find on page»', await waitFor(async () => (await ui37.getAttribute('#tb-btn', 'data-k')) === 'find'));
    await ui37.click('#tb-btn');
    check('find button opens the find bar', await waitFor(async () => !!(await state()).find));
    await keyScreen('38-toolbar-find', 'chrome');
    await key('Escape');
  }
} catch (e) {
  check('scenario finished without errors', false, e.stack ?? String(e));
} finally {
  try { await flush(); } catch { /* приложение уже закрыто */ }
  try {
    for (const f of ['settings', 'profiles', 'pins', 'tabs', 'onboarding', 'history', 'bookmarks', 'downloads', 'saved_pages', 'stats', 'notes', 'site_permissions']) {
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
