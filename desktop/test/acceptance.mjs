// Жёсткая приёмка настольной версии (§5 ТЗ): Playwright for Electron, проверки по состоянию
// (файлы userData, сессии, вкладки, окна), скриншоты с проверкой на «пустой экран».
// Результаты — в test-results/: checks.txt (ok/FAIL), steps.txt, main.log, console.log, PNG.
// Запуск: npm run build && node test/acceptance.mjs [этап]
import { _electron } from 'playwright';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, createSign } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import electronPath from 'electron';
import { zip } from './zip.mjs';

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
// Маленький PDF на одну страницу (с честной таблицей ссылок).
const PDF = (() => {
  const text = 'BT /F1 24 Tf 40 100 Td (Os PDF test) Tj ET';
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${text.length}>>\nstream\n${text}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  let out = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
})();
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
  } else if (u.pathname === '/photo.bin') {
    // Картинка, которую сервер отдаёт как octet-stream: тип определяется по расширению имени.
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-disposition', 'attachment; filename="os-photo.png"');
    res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    return;
  } else if (u.pathname === '/pdf-attach') {
    // PDF-вложение: сайт открывает его в новом окне (window.open) — браузер должен просто скачать файл.
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', 'attachment; filename="os-doc.pdf"');
    res.end(PDF);
    return;
  } else if (u.pathname === '/pdf-opener') {
    res.end('<title>PDF opener</title><button id="b" onclick="window.open(\'/pdf-attach\')">pdf</button><a id="a" href="/pdf-attach" target="_blank">pdf</a>');
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
  } else if (u.pathname === '/data.json') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ browser: 'Ось', profiles: [1, 2, 3], nested: { ok: true } }));
  } else if (u.pathname === '/qa-popup') {
    // Сайт сам помечает окно как «вход» (display=popup) — проверка, что попап не плодит окна (§7.3).
    res.end('<title>QA popup host</title><button id="b" onclick="window.open(\'/qa-inner?display=popup\',\'qa\',\'width=420,height=420\')">p</button>');
  } else if (u.pathname === '/qa-inner') {
    res.end('<title>QA inner</title><button id="b" onclick="window.open(\'/qa-third\',\'_blank\')">p</button>');
  } else if (u.pathname === '/login') {
    // Форма входа для личного кабинета: вопрос «Сохранить пароль?» и подстановка.
    res.end('<title>Login</title><form method="post" action="/welcome"><input type="text" id="user" name="user">' +
      '<input type="password" id="pass" name="pass"><button id="go">Sign in</button></form>');
  } else if (u.pathname === '/signup') {
    // Регистрация: два новых пароля — Ось предлагает надёжный пароль (assets/pwgen).
    res.end('<title>Sign up</title><form method="post" action="/welcome"><input type="email" id="user" name="email">' +
      '<input type="password" id="pass" name="p1" autocomplete="new-password"><input type="password" id="pass2" name="p2" autocomplete="new-password">' +
      '<button id="go">Create account</button></form>');
  } else if (u.pathname === '/welcome') {
    req.resume();
    res.end('<title>Welcome</title><h1>signed in</h1>');
    return;
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

// --- Пакет CRX3 тестового расширения (как из Chrome Web Store, но подписан ключом теста) ---
function zipStored(dir) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const name of readdirSync(dir).sort()) {
    const data = readFileSync(join(dir, name));
    const n = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x21, 12);
    head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(head, n, data);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const varint = (n) => { const out = []; while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); return Buffer.from(out); };
const pbBytes = (field, data) => Buffer.concat([varint(field * 8 + 2), varint(data.length), data]);
function packCrx(dir) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const idBytes = createHash('sha256').update(spki).digest().subarray(0, 16);
  const id = [...idBytes].map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join('');
  const zip = zipStored(dir);
  const signed = pbBytes(1, idBytes);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(signed.length);
  const sig = createSign('sha256').update(Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), len, signed, zip])).sign(privateKey);
  const header = Buffer.concat([pbBytes(2, Buffer.concat([pbBytes(1, spki), pbBytes(2, sig)])), pbBytes(10000, signed)]);
  const top = Buffer.alloc(12);
  top.write('Cr24', 0, 'latin1'); top.writeUInt32LE(3, 4); top.writeUInt32LE(header.length, 8);
  return { id, crx: Buffer.concat([top, header, zip]) };
}

/** Всплывающее окно подогнано под содержимое (288 px по ширине у тестового расширения), а не 360×420 по умолчанию. */
const popInfo0 = (size) => Array.isArray(size) && size[0] < 340 && size[1] < 400;

/** Метка тестового расширения на странице активной вкладки окна. */
const extMark = (win = 0) => main((_e, win) => globalThis.osTest.windows()[win].activeWebContents()?.executeJavaScript('document.documentElement.getAttribute("data-os-test-ext")'), win);

async function unlockIfNeeded() {
  const lp = await page('os://lock/', 8000);
  if (lp) {
    await lp.fill('#pin', '2468');
    await lp.click('#unlock');
    await waitFor(async () => (await state())?.locked === false);
  }
}

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
  check('home shows first 10 profiles and «Show all»', names.length === 10 && (await home.$('.showall')) !== null, `rows=${names.length}`);
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
  await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/?g=general'));
  const st = await page('os://settings/');
  await st.waitForSelector('#lang');
  await st.selectOption('#lang', 'ru');
  const ruOk = await waitFor(async () => (await st.title()) === 'Основные');
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
  await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/?g=general'));
  await st.selectOption('#lang', 'ar');
  const rtl = await waitFor(async () => (await ui.evaluate(() => document.documentElement.dir)) === 'rtl');
  check('Arabic switches the interface to RTL', rtl);
  await keyScreen('08-settings-ar', 'page');
  await windowShot('settings-ar');
  await st.selectOption('#lang', 'ru');
  await waitFor(async () => (await st.title()) === 'Основные');
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
    const ui13 = await typeAddress(`${SITE}/file.txt`);
    // Скачивание по умолчанию «Спросить»: карточка вопроса в окне, файл тем временем качается.
    const pr13 = await waitFor(async () => (await state()).prompt, 8000);
    check('download asks the site permission (default «Ask»)', pr13 && pr13.text.includes('127.0.0.1') && pr13.text.includes('os-test-'), pr13?.text);
    await keyScreen('13-download-prompt', 'chrome');
    if (pr13) await ui13.click('#perm-allow');
    const dl = await waitFor(async () => { await flush(); return (readJson('downloads')?.list ?? []).find((d) => d.state === 'completed' && !d.pending); }, 15000);
    check('«Allow» with «Remember» saved for the site', readJson('site_permissions')?.sites?.['1']?.['127.0.0.1']?.downloads === 'ALLOW');
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
    await cp.waitForSelector('#o-cookies');
    await keyScreen('16-clear', 'page');
    check('clear data: history, cookies, cache, tabs on; passwords, site settings off; all time',
      await cp.isChecked('#o-history') && await cp.isChecked('#o-cookies') && await cp.isChecked('#o-cache') && await cp.isChecked('#o-tabs') &&
      !(await cp.isChecked('#o-passwords')) && !(await cp.isChecked('#o-sites')) && (await cp.inputValue('#range')) === 'range_all');
    await cp.click('#do-clear');
    await cp.click('.modal .btn.accent');
    const c2 = await waitFor(async () => (await main(async ({ session }) => (await session.fromPartition('persist:profile_2').cookies.get({})).length)) === 0, 15000);
    check('profile 2 cookies removed', c2);
    const gone = await waitFor(async () => { await flush(); return !(readJson('tabs')?.profiles?.['2']?.tabs?.length) && !(readJson('history')?.h?.['2']?.length); }, 10000);
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
    await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/?g=privacy'));
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
    await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/?g=privacy'));
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
    await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/?g=general'));
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
    await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/?g=about'));
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
    const ui28 = await typeAddress(`${SITE}/big.bin`);
    // В этом профиле сайт ещё не разрешал скачивание — отвечаем «Разрешить» в карточке.
    if (await waitFor(async () => (await state()).prompt, 6000)) await ui28.click('#perm-allow');
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
    await keyScreen('39-menu', 'chrome');
    await mui.click('.main-menu .toprow .round:nth-child(3)');
    check('menu: star adds the page to favorites', await waitFor(async () => (await state()).bookmarked));
    await openMenu();
    check('menu: star shows as pressed', (await mui.getAttribute('.main-menu .toprow .round:nth-child(3)', 'aria-pressed')) === 'true');
    const openMore = async () => { await openMenu(); await mui.click('.main-menu [data-k="more-tools"]'); await mui.waitForSelector('.main-menu [data-k="back-menu"]'); };
    await openMore();
    await keyScreen('39-more-tools', 'chrome');
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
    await keyScreen('39-diagnostics', 'chrome');
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
    await keyScreen('40-address-empty', 'chrome');
    await mui.fill('#address', '');
    await mui.keyboard.type('weath', { delay: 10 });
    await mui.waitForSelector('.addr-panel .hint-row[data-kind="query"]', { timeout: 5000 }).catch(() => null);
    const rows = await mui.$$eval('.addr-panel .hint-row', (els) => els.map((e) => [e.dataset.kind, e.querySelector('.ttl').textContent, !!e.querySelector('.fill')]));
    check('address: first row is the typed query itself', rows[0]?.[0] === 'search' && rows[0][1].includes('weath') && !rows[0][2], JSON.stringify(rows));
    check('address: past search queries from history (q=, text=)', rows.filter((r) => r[0] === 'query').map((r) => r[1]).join('|') === 'weather spb|weather moscow', JSON.stringify(rows));
    check('address: every row except the first has ↖ «fill in»', rows.slice(1).every((r) => r[2]));
    await keyScreen('40-address-typing', 'chrome');
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
    await keyScreen('42-site-permissions', 'page');
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
    await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/?g=panels'));
    const st38 = await page('os://settings/');
    await st38.selectOption('#toolbar-button', 'find');
    await main(() => globalThis.osTest.windows()[0].closePanel());
    check('toolbar button switched to «Find on page»', await waitFor(async () => (await ui37.getAttribute('#tb-btn', 'data-k')) === 'find'));
    await ui37.click('#tb-btn');
    check('find button opens the find bar', await waitFor(async () => !!(await state()).find));
    await keyScreen('38-toolbar-find', 'chrome');
    await key('Escape');
  }
  if (STAGE >= 7) {
    // --- 39. Личный кабинет: пароли ---
    step('39. Личный кабинет: пароли раздельны по профилям, вопрос о сохранении, подстановка, без открытого текста');
    const PW1 = 'Os-Secret-Pw-91';
    const PW2 = 'Os-Second-Pw-47';
    let loginSeq = 0;
    const inProfile = async (p, base) => {
      // У каждой открытой формы свой адрес: так её страницу легко найти среди вкладок.
      const url = `${base}?k=${++loginSeq}`;
      await main((_e, { p, url }) => { const w = globalThis.osTest.windows()[0]; w.openProfile(p); w.newTab(url); }, { p, url });
      return waitFor(() => app.windows().filter((x) => !x.isClosed() && x.url() === url).pop());
    };
    const login = async (lp, user, pass) => {
      await lp.waitForSelector('#pass');
      await lp.fill('#user', user);
      await lp.fill('#pass', pass);
      await lp.click('#go');
    };
    const pwJson = async () => { await flush(); return readJson('passwords') ?? { profiles: {}, never: {} }; };
    const strings = (await main(() => globalThis.osTest.windows()[0].chrome.webContents.executeJavaScript('window.os.call("init")'))).strings;
    const uiP = await page('os://ui');

    let lp = await inProfile(1, `${SITE}/login`);
    await login(lp, 'anna', PW1);
    const ask = await waitFor(async () => { const x = await state(); return x.pw?.kind === 'save' && x.url.endsWith('/welcome') && x.pw; }, 10000);
    check('Личный кабинет: after signing in, Ось asks to save the password for the site', ask && ask.host === '127.0.0.1', JSON.stringify(ask));
    await uiP.waitForSelector('#pw-save');
    check('Личный кабинет: the card offers Save · Never for this site · Not now',
      (await uiP.isVisible('#pw-save')) && (await uiP.isVisible('#pw-never')) && (await uiP.isVisible('#pw-later')));
    await keyScreen('39-password-save-prompt', 'chrome');
    await uiP.click('#pw-save');
    let pj = await waitFor(async () => { const j = await pwJson(); return j.profiles?.['1']?.length === 1 && j; });
    check('Личный кабинет: password saved in profile 1 (site + login)', pj && pj.profiles['1'][0].o === SITE && pj.profiles['1'][0].u === 'anna', JSON.stringify(pj?.profiles));
    check('Личный кабинет: stored password is encrypted (base64 of safeStorage), not plain', pj && pj.profiles['1'][0].p !== PW1 && /^[A-Za-z0-9+/=]+$/.test(pj.profiles['1'][0].p));
    check('Личный кабинет: the prompt goes away after the answer', await waitFor(async () => (await state()).pw === null));

    // Профиль 2 не видит пароли профиля 1.
    lp = await inProfile(2, `${SITE}/login`);
    await lp.waitForSelector('#pass');
    await sleep(1200);
    check('Личный кабинет: profile 2 does not get the password of profile 1', (await lp.inputValue('#pass')) === '' && (await state()).pw === null);
    await login(lp, 'boris', PW2);
    await waitFor(async () => (await state()).pw?.kind === 'save');
    await uiP.click('#pw-never');
    pj = await waitFor(async () => { const j = await pwJson(); return j.never?.['2']?.includes('127.0.0.1') && j; });
    check('Личный кабинет: «Never for this site» is remembered for the profile', pj && !(pj.profiles['2'] ?? []).length && !(pj.never['1'] ?? []).includes('127.0.0.1'), JSON.stringify(pj?.never));
    lp = await inProfile(2, `${SITE}/login`);
    await login(lp, 'boris', PW2);
    await waitFor(async () => (await state()).url.endsWith('/welcome'));
    await sleep(1000);
    check('Личный кабинет: no question on a «never» site', (await state()).pw === null);

    // Подстановка в профиле 1.
    lp = await inProfile(1, `${SITE}/login`);
    const filled = await waitFor(async () => (await lp.inputValue('#pass')) === PW1 && (await lp.inputValue('#user')) === 'anna');
    check('Личный кабинет: saved login fills the sign-in form in profile 1', filled);
    await keyScreen('39-password-filled', 'tab');
    // Другой сайт (localhost ≠ 127.0.0.1) пароль не получает.
    lp = await inProfile(1, `http://localhost:${PORT}/login`);
    await lp.waitForSelector('#pass');
    await sleep(1200);
    check('Личный кабинет: password is not given to another site', (await lp.inputValue('#pass')) === '');
    // Инкогнито: не спрашиваем и не подставляем.
    const incW = await main(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    await key('Ctrl+Shift+N');
    await waitFor(async () => (await main(() => globalThis.osTest.windows().length)) >= 2);
    const wi = await main(() => globalThis.osTest.windows().findIndex((w) => w.incognito));
    await main((_e, { wi, url }) => globalThis.osTest.windows()[wi].navigate(url), { wi, url: `${SITE}/login` });
    const ip = await waitFor(() => app.windows().filter((x) => !x.isClosed() && x.url() === `${SITE}/login`).pop());
    await ip.waitForSelector('#pass');
    await sleep(1000);
    const incFilled = await ip.inputValue('#pass');
    await login(ip, 'anna', 'Incognito-Pw-3');
    await waitFor(async () => (await state(wi))?.url.endsWith('/welcome'));
    await sleep(1000);
    check('Личный кабинет: incognito neither fills nor asks to save', incFilled === '' && (await state(wi)).pw === null);
    await main((_e, wi) => globalThis.osTest.windows()[wi].win.close(), wi);
    await waitFor(async () => (await main(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) < incW + 1);

    // Экран кабинета.
    await main(() => globalThis.osTest.windows()[0].openPanel('os://cabinet/?profile=1'));
    const cab = await page('os://cabinet/');
    await cab.waitForSelector('.login');
    // Второй аккаунт того же сайта — через «Добавить пароль».
    await cab.click('#pw-add');
    await cab.fill('#f-site', SITE);
    await cab.fill('#f-user', 'second');
    await cab.fill('#f-pass', PW2);
    await cab.click('#form-ok');
    check('Личный кабинет: «Add password» adds a login', await waitFor(async () => (await cab.$$('.login')).length === 2));
    pj = await pwJson();
    check('Личный кабинет: login added by hand is stored for the http site with port', pj.profiles['1'].some((l) => l.u === 'second' && l.o === SITE), JSON.stringify(pj.profiles['1'].map((l) => l.o)));
    const width = await cab.evaluate(() => document.getElementById('app').getBoundingClientRect().width);
    check('Личный кабинет: content is not wider than 720px', width <= 720, String(width));
    await keyScreen('39-cabinet', 'page');
    await cab.click('.login >> nth=0 >> .login-menu');
    await cab.waitForSelector('.ctx');
    await cab.click('.ctx button >> nth=0');
    const shown = await waitFor(async () => (await cab.$('#pw-revealed')) && cab.textContent('#pw-revealed'));
    check('Личный кабинет: «Show password» shows the saved password', shown === PW1 || shown === PW2, String(shown));
    await keyScreen('39-cabinet-show-password', 'page');
    await cab.keyboard.press('Escape');
    await main(({ clipboard }) => clipboard.writeText(''));
    await cab.click('.login >> nth=0 >> .login-menu');
    await cab.click('.ctx button >> nth=2');
    const clip = await waitFor(() => main(({ clipboard }) => clipboard.readText()));
    check('Личный кабинет: «Copy password» copies it', clip === shown, String(clip));
    await cab.click('.login >> nth=0 >> .login-menu');
    await cab.click('.ctx button >> nth=1');
    check('Личный кабинет: «Copy username» copies the login', await waitFor(async () => ['anna', 'second'].includes(await main(({ clipboard }) => clipboard.readText()))));
    await main(({ clipboard }) => clipboard.writeText(''));
    await cab.click('#pw-offer button >> nth=1');
    check('Личный кабинет: «Don\'t offer» switch is saved', await waitFor(async () => (await pwJson()).offer === false));
    await cab.click('#pw-offer button >> nth=0');
    check('Личный кабинет: «Offer to save» switch back on', await waitFor(async () => (await pwJson()).offer === true));
    check('Личный кабинет: «Never» site of profile 2 is not in the list of profile 1', (await cab.$$('.never')).length === 0);

    // Выбор аккаунта при двух входах для сайта.
    lp = await inProfile(1, `${SITE}/login`);
    const pick = await waitFor(async () => { const x = await state(); return x.pw?.kind === 'pick' && x.pw; });
    check('Личный кабинет: two accounts for the site → account choice', pick && pick.users.length === 2, JSON.stringify(pick));
    await uiP.waitForSelector('.pw-user');
    await keyScreen('39-password-pick', 'chrome');
    const pickIdx = pick ? pick.users.findIndex((u) => u.u === 'second') : 1;
    await uiP.click(`.pw-user >> nth=${pickIdx}`);
    check('Личный кабинет: the chosen account fills the form', await waitFor(async () => (await lp.inputValue('#user')) === 'second' && (await lp.inputValue('#pass')) === PW2));

    // Никакого открытого текста паролей в userData.
    await flush();
    const leaks = [];
    const walk = (dir) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.isFile()) {
          let buf;
          try { buf = readFileSync(p); } catch { continue; }
          for (const pw of [PW1, PW2]) {
            if (buf.includes(Buffer.from(pw, 'utf8')) || buf.includes(Buffer.from(pw, 'utf16le'))) leaks.push(`${p.slice(userData.length)}: ${pw}`);
          }
        }
      }
    };
    walk(userData);
    check('Личный кабинет: no plain-text password anywhere in userData (grep)', leaks.length === 0, leaks.slice(0, 5).join(' | '));

    // --- 40. Наборы вкладок ---
    step('40. Личный кабинет: наборы вкладок без стартовых страниц');
    await main(() => { const w = globalThis.osTest.windows()[0]; w.openProfile(1); w.newTab(); });
    await flush();
    const open1 = readJson('tabs').profiles['1'].tabs;
    const web1 = open1.filter((x) => /^https?:/.test(x.url));
    check('Личный кабинет: profile 1 has a start page tab open (os://)', open1.some((x) => x.url.startsWith('os://')));
    await main(() => globalThis.osTest.windows()[0].openPanel('os://cabinet/?profile=1'));
    const cab2 = await page('os://cabinet/');
    await cab2.waitForSelector('#set-save');
    check('Личный кабинет: «Save open tabs (N)» counts only web pages',
      await waitFor(async () => (await cab2.textContent('#set-save')).includes(`(${web1.length})`), 5000), `${await cab2.textContent('#set-save')} / ${web1.length} of ${open1.length}`);
    await cab2.click('#set-save');
    await cab2.fill('#f-set', 'Набор Q');
    await cab2.click('#form-ok');
    await cab2.waitForSelector('.set');
    await flush();
    const sets = readJson('tab_sets')?.profiles?.['1'] ?? [];
    check('Личный кабинет: tab set saved with a name, without os:// start pages',
      sets.length === 1 && sets[0].n === 'Набор Q' && sets[0].tabs.length === web1.length && sets[0].tabs.every((x) => /^https?:/.test(x.url)), JSON.stringify(sets.map((s) => [s.n, s.tabs.length])));
    check('Личный кабинет: list shows name, tab count and date', (await cab2.textContent('.set')).includes('Набор Q'));
    await keyScreen('40-cabinet-tabsets', 'page');
    const before35 = (await state()).tabs.filter((x) => !x.pinned).length;
    await cab2.click('.set-open');
    const after35 = await waitFor(async () => { const x = await state(); return !x.panel && x.tabs.filter((t) => !t.pinned).length === before35 + web1.length && x; });
    check('Личный кабинет: «Open» adds the set tabs to the open ones', after35, `${before35} + ${web1.length}`);

    // --- 41. Резервная копия ---
    step('41. Личный кабинет: резервная копия — неверный пароль, восстановление в другой профиль без дублей');
    const bfile = join(tmpdir(), `os-acc-${Date.now()}.osbackup`);
    await main((_e, p) => globalThis.osTest.backupPath(p), bfile);
    await flush();
    const favCount = (readJson('bookmarks')?.list ?? []).length;
    const noteCount = (readJson('notes')?.list ?? []).length;
    await main(() => globalThis.osTest.windows()[0].openPanel('os://cabinet/?profile=1'));
    const cab3 = await page('os://cabinet/');
    await cab3.waitForSelector('#backup-export');
    const toastIs = (text) => waitFor(async () => (await cab3.textContent('.toast').catch(() => null)) === text, 4000);
    await cab3.click('#backup-export');
    await cab3.fill('#f-bpw', '12345');
    await cab3.fill('#f-bpw2', '12345');
    await cab3.click('#form-ok');
    check('Личный кабинет: backup password shorter than 6 is refused', (await toastIs(strings.backup_pw_short)) && !existsSync(bfile));
    await cab3.click('#backup-export');
    await cab3.fill('#f-bpw', 'Kopiya-77');
    await cab3.fill('#f-bpw2', 'Kopiya-78');
    await cab3.click('#form-ok');
    check('Личный кабинет: backup passwords must match', (await toastIs(strings.backup_pw_mismatch)) && !existsSync(bfile));
    await cab3.click('#backup-export');
    await cab3.fill('#f-bpw', 'Kopiya-77');
    await cab3.fill('#f-bpw2', 'Kopiya-77');
    await cab3.click('#form-ok');
    const written = await waitFor(() => existsSync(bfile) && readFileSync(bfile, 'utf8'));
    const bj = written ? JSON.parse(written) : {};
    check('Личный кабинет: backup file in the Android format {app, v, salt, iv, data}',
      bj.app === 'os-browser' && bj.v === 1 && Buffer.from(bj.salt ?? '', 'base64').length === 16 && Buffer.from(bj.iv ?? '', 'base64').length === 12 && !!bj.data, Object.keys(bj).join(','));
    check('Личный кабинет: backup file has no plain-text passwords', written && !written.includes(PW1) && !written.includes(PW2) && !written.includes('anna'));
    await main(() => globalThis.osTest.windows()[0].openPanel('os://cabinet/?profile=3'));
    const cab4 = await waitFor(() => app.windows().find((x) => !x.isClosed() && x.url().startsWith('os://cabinet/?profile=3')));
    await cab4.waitForSelector('#backup-import');
    await cab4.click('#backup-import');
    await cab4.fill('#f-bpw', 'wrong-password');
    await cab4.click('#form-ok');
    const bad = await waitFor(() => cab4.textContent('.toast').catch(() => null), 6000);
    await flush();
    check('Личный кабинет: wrong backup password → «Wrong password or damaged file», nothing restored',
      bad === strings.backup_bad && !(readJson('passwords').profiles['3'] ?? []).length, String(bad));
    await keyScreen('41-backup-wrong-password', 'page');
    await cab4.click('#backup-import');
    await cab4.fill('#f-bpw', 'Kopiya-77');
    await cab4.click('#form-ok');
    const restored = await waitFor(() => cab4.textContent('#restored').catch(() => null), 8000);
    check('Личный кабинет: restore shows what was restored (2 passwords, 1 set, 0 favorites, 0 notes)',
      restored === strings.backup_restored.replace('%1$d', '2').replace('%2$d', '1').replace('%3$d', '0').replace('%4$d', '0'), String(restored));
    await keyScreen('41-backup-restored', 'page');
    await cab4.keyboard.press('Escape');
    await flush();
    const p3 = readJson('passwords').profiles['3'] ?? [];
    check('Личный кабинет: passwords restored into profile 3 (encrypted)', p3.length === 2 && p3.every((l) => l.p !== PW1 && l.p !== PW2), String(p3.length));
    check('Личный кабинет: tab set restored into profile 3', (readJson('tab_sets')?.profiles?.['3'] ?? []).length === 1);
    check('Личный кабинет: favorites and notes not duplicated', (readJson('bookmarks')?.list ?? []).length === favCount && (readJson('notes')?.list ?? []).length === noteCount,
      `${favCount} ${noteCount}`);
    await cab4.click('#backup-import');
    await cab4.fill('#f-bpw', 'Kopiya-77');
    await cab4.click('#form-ok');
    const again = await waitFor(() => cab4.textContent('#restored').catch(() => null), 8000);
    await flush();
    check('Личный кабинет: restoring the same file again adds nothing',
      again === strings.backup_restored.replace('%1$d', '0').replace('%2$d', '0').replace('%3$d', '0').replace('%4$d', '0') && (readJson('passwords').profiles['3'] ?? []).length === 2, String(again));
    await cab4.keyboard.press('Escape');
    // Восстановленный пароль подставляется в профиле 3.
    lp = await inProfile(3, `${SITE}/login`);
    check('Личный кабинет: restored passwords work in profile 3 (account choice)', await waitFor(async () => (await state()).pw?.kind === 'pick'));
    rmSync(bfile, { force: true });

    // --- 42. Генератор, «Предложить надёжный пароль», общий кабинет ---
    step('42. Личный кабинет: «Предложить надёжный пароль», генератор, общий кабинет и копия всех профилей');
    lp = await inProfile(4, `${SITE}/signup`);
    await lp.waitForSelector('#pass');
    await sleep(800);
    check('Личный кабинет: sign-up form (new-password) is not filled with saved logins', (await lp.inputValue('#pass')) === '');
    await lp.click('#pass');
    const chipSel = 'div[role=button]:has-text("🔑")';
    check('Личный кабинет: sign-up form offers «Suggest a strong password»', await waitFor(() => lp.isVisible(chipSel)));
    await keyScreen('42-suggest-password', 'tab');
    await lp.click(chipSel);
    const s1v = await lp.inputValue('#pass');
    const s2v = await lp.inputValue('#pass2');
    check('Личный кабинет: suggested password fills both new-password fields', s1v.length === 16 && s1v === s2v && !/[0O1lI]/.test(s1v), s1v);
    await lp.fill('#user', 'new@example.com');
    await lp.click('#go');
    check('Личный кабинет: after sign-up Ось offers to save the suggested password', await waitFor(async () => (await state()).pw?.kind === 'save'));
    await uiP.click('#pw-save');
    check('Личный кабинет: suggested password saved in profile 4', await waitFor(async () => (await pwJson()).profiles?.['4']?.length === 1));

    await main(() => globalThis.osTest.windows()[0].openPanel('os://cabinet/?profile=4'));
    const cg = await waitFor(() => app.windows().find((x) => !x.isClosed() && x.url().startsWith('os://cabinet/?profile=4')));
    await cg.waitForSelector('#pw-gen');
    await cg.click('#pw-gen');
    await cg.waitForSelector('#gen-out');
    const g1 = await cg.textContent('#gen-out');
    check('Личный кабинет: generator makes a 16-character password without look-alikes', g1.length === 16 && !/[0O1lI]/.test(g1), g1);
    await cg.$eval('#gen-len', (el) => { el.value = '24'; el.dispatchEvent(new el.ownerDocument.defaultView.Event('input')); });
    await cg.click('#gen-digits');
    const g2 = await cg.textContent('#gen-out');
    check('Личный кабинет: generator length 24 without digits, strength shown',
      g2.length === 24 && !/\d/.test(g2) && (await cg.textContent('#gen-meta')).includes(strings.pw_very_strong), `${g2} ${await cg.textContent('#gen-meta')}`);
    await sleep(300);
    await keyScreen('42-password-generator', 'page');
    await cg.click('#gen-new');
    const g3 = await cg.textContent('#gen-out');
    check('Личный кабинет: «New» makes another password', g3 !== g2 && g3.length === 24);
    await cg.click('#gen-copy');
    check('Личный кабинет: generator «Copy» copies the password', await waitFor(async () => (await main(({ clipboard }) => clipboard.readText())) === g3));
    await main(({ clipboard }) => clipboard.writeText(''));
    await cg.click('#pw-add');
    await cg.click('#f-generate');
    check('Личный кабинет: «Generate a strong password» in «Add password»', (await cg.inputValue('#f-pass')).length === 16);
    await cg.keyboard.press('Escape');

    // Общий кабинет: кнопка с замком на главном экране.
    const bfile2 = join(tmpdir(), `os-acc-all-${Date.now()}.osbackup`);
    await main((_e, p) => globalThis.osTest.backupPath(p), bfile2);
    await main(() => globalThis.osTest.windows()[0].showHome());
    const hm = await page('os://home/');
    await hm.waitForSelector('#cabinet');
    await hm.click('#cabinet');
    const ca = await waitFor(() => app.windows().find((x) => !x.isClosed() && x.url().startsWith('os://cabinet/') && !x.url().includes('profile=')));
    await ca.waitForSelector('#summary');
    check('Личный кабинет: shared cabinet opens with «All profiles» selected', await ca.isVisible('.chip.on[data-profile="0"]'));
    const nProfiles = (await ca.$$('.chip')).length - 1;
    check('Личный кабинет: summary lists every profile', (await ca.$$('#summary .sum')).length === nProfiles && nProfiles >= 4, String(nProfiles));
    check('Личный кабинет: summary shows passwords per profile', (await ca.textContent('#summary .sum[data-profile="1"]')).includes(`${strings.passwords}: 2`));
    await ca.fill('#pw-search', 'second');
    const found = await waitFor(async () => { const r = await ca.$$eval('#pw-results .login', (els) => els.map((e) => e.dataset.profile)); return r.length && r; });
    check('Личный кабинет: search finds passwords in all profiles', found && found.length === 2 && found.includes('1') && found.includes('3'), JSON.stringify(found));
    await keyScreen('42-cabinet-all', 'page');
    await ca.click('#backup-export');
    await ca.fill('#f-bpw', 'Vse-profili-1');
    await ca.fill('#f-bpw2', 'Vse-profili-1');
    await ca.click('#form-ok');
    const allText = await waitFor(() => existsSync(bfile2) && readFileSync(bfile2, 'utf8'));
    const crypto = await import('../src/main/backupcrypto.ts');
    const allData = allText ? crypto.decrypt(allText, 'Vse-profili-1') : null;
    check('Личный кабинет: backup of all profiles is v2 {"v":2,"profiles":[{id,data}]}',
      allData?.v === 2 && allData.profiles.length === nProfiles && allData.profiles.find((p) => p.id === 1)?.data.passwords.length === 2, JSON.stringify(allData?.profiles?.map((p) => [p.id, p.data.passwords.length])));
    // Убрать пароль профиля 4 и вернуть его из общей копии (в профиль с тем же номером).
    await main(() => globalThis.osTest.windows()[0].openPanel('os://cabinet/?profile=4'));
    const c4 = await waitFor(() => app.windows().find((x) => !x.isClosed() && x.url().startsWith('os://cabinet/?profile=4')));
    await c4.waitForSelector('.login-menu');
    await c4.click('.login-menu');
    await c4.click('.ctx button.danger');
    await c4.click('.modal .btn.accent');
    check('Личный кабинет: password deleted from profile 4', await waitFor(async () => !(await pwJson()).profiles['4'].length));
    await main(() => globalThis.osTest.windows()[0].openPanel('os://cabinet/'));
    const ca2 = await waitFor(() => app.windows().find((x) => !x.isClosed() && x.url() === 'os://cabinet/'));
    await ca2.waitForSelector('#backup-import');
    await ca2.click('#backup-import');
    await ca2.fill('#f-bpw', 'Vse-profili-1');
    await ca2.click('#form-ok');
    const rAll = await waitFor(() => ca2.textContent('#restored').catch(() => null), 10000);
    await flush();
    const pa = readJson('passwords').profiles;
    check('Личный кабинет: v2 backup restores into the same profiles without duplicates',
      rAll === strings.backup_restored.replace('%1$d', '1').replace('%2$d', '0').replace('%3$d', '0').replace('%4$d', '0') &&
      pa['4'].length === 1 && pa['1'].length === 2 && pa['3'].length === 2, `${rAll} ${pa['1'].length}/${pa['3'].length}/${pa['4'].length}`);
    await ca2.keyboard.press('Escape');
    await main(() => globalThis.osTest.backupPath(null));
    rmSync(bfile2, { force: true });

    // Пункт «Личный кабинет» в меню профиля на главном экране.
    await main(() => globalThis.osTest.windows()[0].showHome());
    const home7 = await page('os://home/');
    await home7.waitForSelector('.prow');
    await home7.click('.prow >> nth=0', { button: 'right' });
    await home7.waitForSelector('.ctx');
    check('Личный кабинет: item in the profile menu on the home screen', (await home7.textContent('.ctx')).includes(strings.cabinet));
    await home7.click(`.ctx button:has-text("${strings.cabinet}")`);
    const cab5 = await page('os://cabinet/');
    check('Личный кабинет: opens from the profile menu', cab5 && await cab5.waitForSelector('h1').then(() => true).catch(() => false));
    check('Личный кабинет: own pages without script errors', ownPageErrors.length === 0, ownPageErrors.slice(0, 5).join(' | '));
  }
  if (STAGE >= 6) {
    const W = () => globalThis.osTest.windows()[0];
    const osCall = async (cmd, ...args) => {
      // Вызов моста от имени своего экрана (как это делает страница).
      await main(() => globalThis.osTest.windows()[0].openPanel('os://downloads/'));
      const p = await page('os://downloads/');
      return p.evaluate(([c, a]) => window.os.call(c, ...a), [cmd, args]);
    };
    const dlList = async () => { await flush(); return readJson('downloads')?.list ?? []; };
    await main((_e) => { const w = globalThis.osTest.windows()[0]; w.win.setBounds({ x: 20, y: 20, width: 1400, height: 900 }); w.openProfile(1); w.closePanel(); });
    await sleep(600);

    // --- 43. Экран «Скачанные файлы» как в Chrome ---
    step('43. Скачанные файлы: место на диске, чипы типов, группы, поиск, меню строки, открытие во вкладке Оси');
    await typeAddress(`${SITE}/photo.bin`);
    const img = await waitFor(async () => (await dlList()).find((d) => d.name.startsWith('os-photo') && d.state === 'completed'), 15000);
    check('remembered «Allow» downloads without asking', img && !img.pending && !(await state()).prompt, JSON.stringify(img));
    await key('Ctrl+J');
    const d39 = await page('os://downloads/');
    await d39.waitForSelector('.item[data-kind="images"]');
    check('octet-stream file typed by extension (image)', await d39.$('.item[data-kind="images"]') !== null);
    check('free disk space line (fs.statfs)', /\d/.test(await d39.textContent('#dl-disk')), await d39.textContent('#dl-disk'));
    check('six type chips', (await d39.$$eval('.chips .chip', (e) => e.length)) === 6);
    check('«Just now» group on top', (await d39.textContent('.group-title')) === 'Только что', await d39.textContent('.group-title'));
    await d39.click('.chip[data-kind="images"]');
    const onlyImg = await d39.$$eval('.item', (e) => e.map((x) => x.dataset.kind));
    check('chip «Images» filters the list', onlyImg.length >= 1 && onlyImg.every((k) => k === 'images'), onlyImg.join(','));
    await keyScreen('43-downloads-images', 'page');
    await d39.click('.chip[data-kind="all"]');
    await d39.fill('#dl-search', 'zzzz-nothing');
    check('search shows «nothing found»', (await d39.textContent('.empty')) === 'Ничего не найдено');
    await d39.fill('#dl-search', 'os-photo');
    await d39.click('.item[data-kind="images"] .dl-more');
    const menu39 = await d39.$$eval('.ctx button', (b) => b.map((x) => x.textContent));
    check('row menu: Open · Show in folder · Share · Delete (Open with — only on Windows)',
      menu39.includes('Открыть') && menu39.includes('Показать в папке') && menu39.includes('Поделиться') && menu39.includes('Удалить') &&
      menu39.includes('Открыть в другом приложении') === (process.platform === 'win32'), menu39.join(' | '));
    await keyScreen('43-downloads-menu', 'page');
    await d39.click('.ctx button:has-text("Поделиться")');
    await d39.click('.ctx button:has-text("Копировать путь к файлу")');
    check('share copies the file path', await waitFor(async () => (await main(({ clipboard }) => clipboard.readText())) === img?.path), await main(({ clipboard }) => clipboard.readText()));
    await d39.click('.item[data-kind="images"]');
    const s39 = await waitFor(async () => { const x = await state(); return x.url.startsWith('os://file/') && !x.loading && x; }, 8000);
    check('image opens in an Ось tab (protected os://file)', s39 && !s39.panel, s39?.url);
    // Страница файла — в песочнице без скриптов; что картинка показана, видно по заголовку Chromium («имя (1×1)»).
    const imgOk = await waitFor(() => main(() => globalThis.osTest.windows()[0].activeWebContents().getTitle()).then((x) => /1\s*[×x]\s*1/.test(x) && x), 5000);
    check('image is shown in the tab (scripts off)', imgOk, String(imgOk || await main(() => globalThis.osTest.windows()[0].activeWebContents().getTitle())));
    const js = await main(() => globalThis.osTest.windows()[0].activeWebContents().executeJavaScript('1').then(() => 'ran', () => 'blocked'));
    check('no scripts run on the file page (CSP sandbox)', js === 'blocked', js);
    const leak = await main(async ({ session }, url) => {
      // Сайт того же профиля не может вставить файл по чужому адресу (ключ случайный, другой профиль — 404).
      const w = globalThis.osTest.windows()[0];
      const r1 = await w.activeWebContents().session.fetch(url.replace(/file\/[0-9a-f]+\//, 'file/0000/')).then((r) => r.status).catch(() => 0);
      const r2 = await session.fromPartition('persist:profile_2').fetch(url).then((r) => r.status).catch(() => 0);
      return [r1, r2];
    }, s39?.url ?? '');
    check('os://file is not guessable and not served to another profile', leak[0] !== 200 && leak[1] !== 200, JSON.stringify(leak));

    // --- 44. PDF-вложение в новом пустом окне ---
    step('44. PDF-вложение (Content-Disposition: attachment) в новом окне скачивается, исходная вкладка не перезагружается');
    await main((_e, u) => globalThis.osTest.windows()[0].newTab(u), `${SITE}/pdf-opener`);
    const op = await page(`${SITE}/pdf-opener`);
    await waitFor(async () => { const x = await state(); return x.url.endsWith('/pdf-opener') && !x.loading; });
    const loads = () => seen.filter((r) => r.path === '/pdf-opener').length;
    const loads0 = loads();
    const tabs40 = (await state()).tabs.length;
    await op.click('#b');
    const pdf = await waitFor(async () => (await dlList()).find((d) => d.name.startsWith('os-doc') && d.state === 'completed' && !d.pending), 15000);
    check('PDF attachment downloaded as a file', pdf && existsSync(pdf.path) && readFileSync(pdf.path).subarray(0, 4).toString() === '%PDF', JSON.stringify(pdf));
    await sleep(800);
    const s40 = await state();
    check('blank tab for the attachment is closed', s40.tabs.length === tabs40, `${tabs40} → ${s40.tabs.length}`);
    check('opener tab is back and not reloaded', s40.url.endsWith('/pdf-opener') && loads() === loads0, `${s40.url} loads ${loads0}→${loads()}`);
    check('no extra windows', (await main(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 1);
    await main(() => globalThis.osTest.windows()[0].openPanel('os://downloads/'));
    const d40 = await page('os://downloads/');
    await d40.fill('#dl-search', 'os-doc');
    await d40.click('.item[data-kind="docs"]');
    const s40b = await waitFor(async () => { const x = await state(); return x.url.startsWith('os://file/') && x.url.includes('os-doc') && !x.loading && x; }, 8000);
    check('PDF opens in an Ось tab', s40b, s40b?.url);
    await sleep(1500);
    await keyScreen('44-pdf-in-tab', 'tab');
    await windowShot('pdf-in-tab');
    if (pdf) rmSync(pdf.path, { force: true });
    if (img) rmSync(img.path, { force: true });

    // --- 45. Запрет скачивания и «Запретить» в карточке ---
    step('45. Скачивание: сайт с «Запретить» не начинает загрузку, «Запретить» в вопросе удаляет файл');
    const n41 = (await dlList()).length;
    await osCall('sitePermSet', 1, 'localhost', 'downloads', 'BLOCK');
    await main(() => globalThis.osTest.windows()[0].closePanel());
    await typeAddress(`http://localhost:${PORT}/file.txt`);
    await sleep(2000);
    check('blocked site does not start a download', (await dlList()).length === n41 && !(await state()).prompt, `${n41} → ${(await dlList()).length}`);
    await osCall('sitePermSet', 1, 'localhost', 'downloads', 'ASK');
    await main(() => globalThis.osTest.windows()[0].closePanel());
    const ui41 = await typeAddress(`http://localhost:${PORT}/file.txt`);
    const pr41 = await waitFor(async () => (await state()).prompt, 8000);
    check('«Ask» shows the question again', pr41 && pr41.text.includes('localhost'), pr41?.text);
    const during = (await dlList()).find((d) => d.url.includes('localhost:'));
    check('while the question is open, the file is downloading (pending)', during?.pending === true, JSON.stringify(during && { p: during.pending, s: during.state }));
    await keyScreen('45-download-ask', 'chrome');
    await ui41.click('#perm-remember');
    await ui41.click('#perm-block');
    const gone41 = await waitFor(async () => !(await dlList()).some((d) => d.url.includes('localhost:')), 8000);
    check('«Block» cancels and deletes the file', gone41 && (!during || !existsSync(during.path)), during?.path);
    check('one-time «Block» is not remembered', readJson('site_permissions')?.sites?.['1']?.localhost?.downloads === undefined);

    // --- 46. Отправка файлов: разрешено по умолчанию, запрет в разрешениях сайта ---
    step('46. Отправка файлов: «Разрешено» по умолчанию, «Запретить» не открывает выбор файла');
    const kinds = await osCall('sitePerms', 1);
    const upK = kinds.kinds.find((k) => k.key === 'uploads');
    const dnK = kinds.kinds.find((k) => k.key === 'downloads');
    check('site permissions list downloads (Ask) and uploads (Allow) by default', upK?.current === 'ALLOW' && dnK?.current === 'ASK', JSON.stringify([upK, dnK]));
    await main(() => globalThis.osTest.windows()[0].closePanel());
    await typeAddress(`${SITE}/upload`);
    await waitFor(async () => { const x = await state(); return x.url.endsWith('/upload') && !x.loading; });
    const up42 = app.windows().filter((p) => p.url() === `${SITE}/upload`).pop();
    const fc1 = up42.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
    await up42.click('#file');
    const chooser = await fc1;
    check('file chooser opens by default', !!chooser);
    await osCall('sitePermSet', 1, '127.0.0.1', 'uploads', 'BLOCK');
    await main(() => globalThis.osTest.windows()[0].closePanel());
    await sleep(300);
    const fc2 = up42.waitForEvent('filechooser', { timeout: 2500 }).catch(() => null);
    await up42.click('#file');
    check('blocked site cannot open the file chooser', !(await fc2));
    await osCall('sitePermSet', 1, '127.0.0.1', 'uploads', 'ALLOW');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://site/?profile=1&host=127.0.0.1'));
    const sp42 = await page('os://site/');
    await sp42.waitForSelector('#p-uploads');
    await keyScreen('46-site-permissions-files', 'page');

    // --- 47. Профили: 10, закрепление, текущий, шестерёнка, плитка, папки ---
    step('47. Главный экран: 10 профилей, закрепить, текущий, шестерёнка, плитка, папки');
    await main(() => globalThis.osTest.windows()[0].showHome());
    const h43 = await page('os://home/');
    await h43.waitForSelector('.prow');
    check('home shows 10 profiles and «Show all profiles (N)»', (await h43.$$eval('.prow', (e) => e.length)) === 10 && /\(15\)/.test(await h43.textContent('.showall')));
    check('current profile has an accent frame and a check mark', (await h43.$$eval('.prow.current', (e) => e.map((x) => x.dataset.id))).join() === '1' && (await h43.$('.prow.current .mark.cur')) !== null);
    await h43.click('.prow[data-id="7"] .more');
    await h43.click('.ctx button:has-text("Закрепить")');
    await waitFor(async () => (await h43.$$eval('.prow', (e) => e.map((x) => x.dataset.id)))[0] === '7');
    await flush();
    check('pinned profile goes on top with a pin, stored apart from the order',
      (await h43.$$eval('.prow', (e) => e[0].dataset.id)) === '7' && (await h43.$('.prow[data-id="7"] .mark.pin')) !== null &&
      JSON.stringify(readJson('profiles')?.pinned) === '[7]' && (readJson('profiles')?.order ?? []).indexOf(7) !== 0, JSON.stringify(readJson('profiles')?.pinned));
    await h43.click('.prow[data-id="7"] .more');
    const m43 = await h43.$$eval('.ctx button', (b) => b.map((x) => x.textContent));
    check('profile menu: settings, rename, unpin, folder, up/down, sign out', ['Настройки профиля', 'Переименовать', 'Открепить', 'В папку', 'Ниже', 'Выйти из аккаунтов (очистить профиль)'].every((x) => m43.includes(x)), m43.join(' | '));
    await h43.keyboard.press('Escape');
    await keyScreen('47-home-pinned', 'page');
    // Папки: профиль 2 и 3 — в «Работа», 7 — в «Банки».
    for (const [id, f] of [[2, 'Работа'], [3, 'Работа'], [7, 'Банки']]) await h43.evaluate(([i, n]) => window.os.call('setFolder', i, n), [id, f]);
    await h43.reload();
    await h43.waitForSelector('.folder-head');
    const heads = await h43.$$eval('.folder-head .grow', (e) => e.map((x) => x.textContent));
    check('folders sorted, «No folder» last', heads.join('|') === 'Банки|Работа|Без папки', heads.join('|'));
    await h43.click('.folder-head[data-folder="Работа"]');
    await waitFor(async () => (await h43.getAttribute('.folder-head[data-folder="Работа"]', 'aria-expanded')) === 'false');
    check('folder collapses', !(await h43.$('.prow[data-id="2"]')));
    await h43.click('.folder-head[data-folder="Работа"]', { button: 'right' });
    await h43.click('.ctx button:has-text("Переименовать папку")');
    await h43.fill('.modal input', 'Клиенты');
    await h43.click('.modal .btn.accent');
    await waitFor(async () => (await h43.$('.folder-head[data-folder="Клиенты"]')) !== null);
    await flush();
    check('folder renamed (profiles stay in it)', readJson('profiles')?.folders?.['2'] === 'Клиенты' && readJson('profiles')?.folders?.['3'] === 'Клиенты');
    await h43.click('#view-toggle');
    await h43.waitForSelector('.ptile');
    await flush();
    check('tiles view: avatar, name, marks, gear; saved', (await h43.$('.ptile[data-id="1"] .avatar')) !== null && (await h43.$('.ptile .gear')) !== null && readJson('profiles')?.view === 'grid');
    await keyScreen('47-home-tiles-folders', 'page');
    await windowShot('home-tiles');
    const cols = await h43.$eval('.grid', (g) => window.getComputedStyle(g).gridTemplateColumns.split(' ').length);
    check('wide window: 4 tile columns', cols === 4, String(cols));
    await h43.click('.folder-head[data-folder="Клиенты"]', { button: 'right' });
    await h43.click('.ctx button:has-text("Убрать папку")');
    await h43.evaluate(() => window.os.call('setFolder', 7, ''));
    await h43.click('#view-toggle');
    await h43.waitForSelector('.prow');
    await flush();
    check('folder removed, profiles stay', !readJson('profiles')?.folders?.['2'] && (await h43.$$eval('.folder-head', (e) => e.length)) === 0);
    check('cabinet button links to the common cabinet', (await h43.getAttribute('#cabinet', 'href')) === 'os://cabinet/?all=1');
    await h43.click('.prow[data-id="3"] .gear');
    const pp43 = await page('os://profile/');
    await pp43.waitForSelector('#profile-pin');
    check('gear opens profile settings: pin, own tabs, files, clear data', (await pp43.$('#profile-clear')) !== null && (await pp43.$('#add-files')) !== null);
    await pp43.click('#profile-pin');
    await waitFor(async () => { await flush(); return (readJson('profiles')?.pinned ?? []).includes(3); });
    check('pin from the profile screen', (readJson('profiles')?.pinned ?? []).includes(3));
    await keyScreen('47-profile-settings', 'page');
    await pp43.evaluate(() => Promise.all([window.os.call('setPinned', 3, false), window.os.call('setPinned', 7, false)]));

    // --- 48. Список профилей у чипа в окне ---
    step('48. Чип профиля: список с отметкой текущего, переключение, «Все профили»');
    await main(() => globalThis.osTest.windows()[0].openProfile(1));
    const ui44 = await page('os://ui');
    await ui44.click('.chip');
    await ui44.waitForSelector('.pmenu');
    check('chip list marks the current profile', (await ui44.$$eval('.pmenu .pitem.cur', (e) => e.map((x) => x.dataset.profile))).join() === '1');
    await keyScreen('48-profile-chip-list', 'chrome');
    await ui44.click('.pmenu .pitem[data-profile="4"]');
    check('choosing switches the profile', await waitFor(async () => (await state()).profile?.id === 4));
    await ui44.click('.chip');
    await ui44.click('.pmenu button[data-k="all-profiles"]');
    check('«All profiles» opens the home screen', await waitFor(async () => { const x = await state(); return x.profile === null && x.panel?.startsWith('os://home'); }));

    // --- 49. Настройки: группы и поиск ---
    step('49. Настройки: 7 групп с кратким содержимым, поиск по всем пунктам, «Запретить скриншоты»');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://settings/'));
    const st45 = await page('os://settings/');
    await st45.waitForSelector('.gcard');
    const g45 = await st45.$$eval('.gcard', (e) => e.map((x) => [x.querySelector('.gtitle').textContent, x.querySelector('.gsum').textContent]));
    check('7 groups with icons and summaries', g45.length === 7 && g45.every(([a, b]) => a && b) && (await st45.$$eval('.gcard .gicon .ic', (e) => e.length)) === 7, JSON.stringify(g45));
    check('no single setting is shown on the main page', (await st45.$$eval('.setting', (e) => e.filter((x) => x.offsetParent !== null).length)) === 0);
    await keyScreen('49-settings-groups', 'page');
    await st45.fill('#settings-search', 'скриншот');
    await sleep(200);
    const hit45 = await st45.$$eval('.setting', (e) => e.filter((x) => x.offsetParent !== null).map((x) => x.textContent));
    check('search finds «Block screenshots» in Privacy', hit45.length === 1 && hit45[0].includes('Запретить скриншоты'), hit45.join(' | '));
    await keyScreen('49-settings-search', 'page');
    await st45.fill('#settings-search', '');
    await st45.click('.gcard[data-g="privacy"]');
    await st45.waitForSelector('#hide');
    check('privacy group: block screenshots, lock, HTTPS, site permissions', await st45.isVisible('#hide') && await st45.isVisible('#pin-set') && await st45.isVisible('#https'));
    await keyScreen('49-settings-privacy', 'page');

    // --- 50. История ---
    step('50. История: по дням, буква сайта, поиск, крестик, открыть новой вкладкой, ссылка на удаление данных');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://history/?profile=1'));
    const h46 = await page('os://history/');
    await h46.waitForSelector('.item');
    const day46 = await h46.textContent('.day');
    const today = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
    check('days titled «Сегодня — <date>»', day46 === `Сегодня — ${today}`, day46);
    check('profile hint and «Clear browsing data…» link', (await h46.textContent('.ph')).includes('История профиля') && (await h46.textContent('#open-clear')).startsWith('Удалить данные о работе в браузере'));
    check('site letter in a circle', /^[A-Z0-9•]$/.test(await h46.textContent('.item .letter')));
    await keyScreen('50-history', 'page');
    const n46 = await h46.$$eval('.item', (e) => e.length);
    await h46.click('.item .del');
    await waitFor(async () => (await h46.$$eval('.item', (e) => e.length)) === n46 - 1);
    check('cross removes one entry', (await h46.$$eval('.item', (e) => e.length)) === n46 - 1);
    await flush();
    const tabs46 = (readJson('tabs')?.profiles?.['1']?.tabs ?? []).length;
    await h46.click('.item >> nth=0');
    check('click opens a new tab of this profile', await waitFor(async () => { const x = await state(); await flush(); return x.profile?.id === 1 && !x.panel && (readJson('tabs')?.profiles?.['1']?.tabs ?? []).length === tabs46 + 1; }));

    // --- 51. Удалить данные: диапазон и счётчики ---
    step('51. Удалить данные о работе в браузере: диапазон, счётчики, удаление истории за 15 минут');
    await typeAddress(`${SITE}/set?p=keep`);
    await waitFor(async () => (await main(async ({ session }) => (await session.fromPartition('persist:profile_1').cookies.get({ name: 'os_test' }))[0]?.value)) === 'keep');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://clear/?profile=1'));
    const c47 = await page('os://clear/');
    await c47.waitForSelector('#range');
    const ranges = await c47.$$eval('#range option', (o) => o.map((x) => x.textContent));
    check('six ranges: 15 min … all time', ranges.join('|') === 'Последние 15 минут|Последний час|Последние 24 часа|Последние 7 дней|Последние 4 недели|Всё время', ranges.join('|'));
    check('note: favorites, notes, saved pages and files are kept', (await c47.textContent('body')).includes('Избранное, заметки, сохранённые страницы и файлы профиля не удаляются'));
    await c47.selectOption('#range', 'range_15m');
    await c47.waitForSelector('#o-history');
    for (const id of ['cookies', 'cache', 'tabs']) await c47.uncheck(`#o-${id}`);
    await keyScreen('51-clear-range', 'page');
    const tabsBefore47 = (readJson('tabs')?.profiles?.['1']?.tabs ?? []).length;
    const since47 = Date.now() - 15 * 60_000;
    await c47.click('#do-clear');
    const h47 = await waitFor(async () => { await flush(); const h = readJson('history')?.h?.['1'] ?? []; return h.every((v) => v.d < since47) && h; }, 8000);
    check('history of the last 15 minutes deleted, older kept, tabs untouched', h47 && (readJson('tabs')?.profiles?.['1']?.tabs ?? []).length === tabsBefore47, `${h47?.length} left`);
    check('cookies of the profile kept when unchecked', (await main(async ({ session }) => (await session.fromPartition('persist:profile_1').cookies.get({ name: 'os_test' }))[0]?.value)) === 'keep');

    // --- 52. Ширина экранов-списков ---
    step('52. Экраны-списки не шире 720 px и по центру');
    const widths = [];
    for (const u of ['os://home/', 'os://settings/', 'os://downloads/', 'os://favorites/', 'os://site/?profile=1']) {
      await main((_e, url) => globalThis.osTest.windows()[0].openPanel(url), u);
      const p = await page(u.split('?')[0]);
      await p.waitForSelector('#app > *');
      widths.push(await p.evaluate(() => {
        const a = document.getElementById('app');
        const r = a.getBoundingClientRect();
        const cs = window.getComputedStyle(a);
        return [Math.round(r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)), Math.round(r.left + r.right - document.documentElement.clientWidth)];
      }));
    }
    check('content ≤ 720 px, centered', widths.every(([w, off]) => w <= 720 && Math.abs(off) <= 2), JSON.stringify(widths));
    await main(() => globalThis.osTest.windows()[0].openProfile(1));
    check('no script errors on own pages (os://) after the new screens', ownPageErrors.length === 0, ownPageErrors.slice(0, 5).join(' | '));
    void W;

    // --- 53. Документы открываются в Оси (WINDOWS_SYNC §20) ---
    step('53. Документы (DOCX, XLSX, CSV) из файлов профиля открываются во вкладке Оси, без сети');
    const fdir = join(userData, 'profile_files', '1');
    mkdirSync(fdir, { recursive: true });
    writeFileSync(join(fdir, 'plan.docx'), zip({ 'word/document.xml': '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarter plan</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold goal</w:t></w:r></w:p><w:p><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:p>' +
      ['Hire two designers', 'Launch the Windows version', 'Open the store page', 'Reach 10 000 users'].map((x) => `<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>${x}</w:t></w:r></w:p>`).join('') +
      '<w:tbl>' + [['Month', 'Plan', 'Fact'], ['October', '120', '134'], ['November', '150', '—'], ['December', '180', '—']].map((r) => `<w:tr>${r.map((c) => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('') + '</w:tbl>' +
      '<w:p><w:r><w:t>Each team writes a short weekly note: what was done, what is blocked, what comes next. Notes stay on the computer and open right in the browser.</w:t></w:r></w:p>' +
      '</w:body></w:document>' }));
    writeFileSync(join(fdir, 'sales.xlsx'), zip({ 'xl/sharedStrings.xml': '<sst><si><t>Region</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1234</v></c></row>' +
        ['North', 'South', 'East', 'West', 'Centre', 'Online'].map((x, k) => `<row r="${k + 2}"><c r="A${k + 2}" t="inlineStr"><is><t>${x}</t></is></c><c r="B${k + 2}"><v>${(k + 3) * 211}</v></c><c r="C${k + 2}"><v>${(k + 1) * 17}</v></c><c r="D${k + 2}" t="inlineStr"><is><t>Q${(k % 4) + 1}</t></is></c></row>`).join('') +
        '</sheetData></worksheet>' }));
    writeFileSync(join(fdir, 'list.csv'), 'name;qty\nTea;3\n');
    await main(() => globalThis.osTest.windows()[0].openPanel('os://profile/?id=1'));
    const pf = await page('os://profile/');
    const openDoc = async (name) => {
      const before = (await state()).tabs.length;
      check(`document ${name}: opens`, await pf.evaluate((n) => window.os.call('fileOpen', 1, n), name));
      await waitFor(async () => (await state()).tabs.length > before);
      const dp = await waitFor(() => app.windows().find((x) => !x.isClosed() && x.url().startsWith('os://file/') && decodeURIComponent(x.url()).endsWith('/' + name)));
      await dp.waitForLoadState();
      return dp;
    };
    const dDoc = await openDoc('plan.docx');
    check('DOCX in a tab: heading and bold text', (await dDoc.innerHTML('body')).includes('<h1>Quarter plan</h1>') && (await dDoc.innerHTML('body')).includes('<b>Bold goal</b>'));
    check('DOCX: document text cannot run scripts', (await dDoc.$('script')) === null && (await dDoc.textContent('body')).includes('<script>'));
    await keyScreen('53-docx', 'tab');
    const dXls = await openDoc('sales.xlsx');
    check('XLSX in a tab: table with column letters and values', /<th>A<\/th><th>B<\/th>/.test(await dXls.innerHTML('body')) && (await dXls.textContent('body')).includes('Region') && (await dXls.textContent('body')).includes('1234'));
    await keyScreen('53-xlsx', 'tab');
    const dCsv = await openDoc('list.csv');
    check('CSV in a tab: table with a header row', (await dCsv.innerHTML('body')).includes('<th>name</th><th>qty</th>'));
    await main(() => globalThis.osTest.windows()[0].openPanel('os://profile/?id=1'));
    check('documents: no script errors on own pages', ownPageErrors.length === 0, ownPageErrors.slice(0, 5).join(' | '));
    // --- 54. Расширения Chrome по профилям ---
    step('54. Расширения: установка CRX в профиль 1, скрипт на странице, нет в профиле 2 и инкогнито');
    await main(() => globalThis.osTest.windows()[0].openProfile(1));
    const { id: extId, crx } = packCrx(join(root, 'test', 'extension'));
    const bad = Buffer.from(crx);
    bad[bad.length - 40] ^= 0xff;
    const rBad = await main((_e, b64) => globalThis.osTest.installCrx(1, b64), bad.toString('base64'));
    check('tampered CRX is rejected by the signature check', rBad && rBad.ok === false && rBad.error === 'bad', JSON.stringify(rBad));
    const r29 = await main((_e, b64) => globalThis.osTest.installCrx(1, b64), crx.toString('base64'));
    check('test extension installed into profile 1 from a signed CRX3', r29?.ok === true && r29.id === extId, JSON.stringify(r29));
    await flush();
    const ej = readJson('extensions');
    check('extensions.json lists it for profile 1 only, enabled', ej?.profiles?.['1']?.some((e) => e.id === extId && e.enabled && e.version === '1.2.3') && !ej?.profiles?.['2']);
    const manifest = JSON.parse(readFileSync(join(userData, 'extensions', '1', extId, 'manifest.json'), 'utf8'));
    check('manifest gets the store key, so the extension ID matches the package ID', typeof manifest.key === 'string' && manifest.key.length > 200);
    const loaded1 = await main(({ session }, id) => !!session.fromPartition('persist:profile_1').extensions.getExtension(id), extId);
    check('extension loaded into the profile 1 session', loaded1);
    await key('Ctrl+T');
    await typeAddress(`${SITE}/page/ext`);
    await waitFor(async () => { const x = await state(); return x.url.endsWith('/page/ext') && !x.loading; });
    check('content script of the extension marks the test page in profile 1', await waitFor(async () => (await extMark()) === 'ok', 8000));
    const bg = await waitFor(async () => (await main(() => globalThis.osTest.windows()[0].activeWebContents().executeJavaScript('document.documentElement.getAttribute("data-os-test-bg")'))) ?? null, 8000);
    check('content script talks to the MV3 service worker (runtime messaging + storage)', bg === 'pong', String(bg));
    await keyScreen('54-extension-on-page', 'tab');
    await main(() => globalThis.osTest.windows()[0].navigate('os://start'));
    await waitFor(async () => { const x = await state(); return x.url === '' && !x.loading; });
    await sleep(500);
    check('extension does not touch own os:// pages (start page)', (await extMark()) === null);
    const uiExt = await main(({ session }) => session.fromPartition('os-ui').extensions.getAllExtensions().length);
    check('browser UI session has no extensions', uiExt === 0, `${uiExt}`);
    await main(() => globalThis.osTest.windows()[0].openProfile(2));
    await key('Ctrl+T');
    await typeAddress(`${SITE}/page/ext2`);
    await waitFor(async () => { const x = await state(); return x.profile?.id === 2 && x.url.endsWith('/page/ext2') && !x.loading; });
    await sleep(800);
    check('profile 2 does not have the extension (no mark, empty session list)',
      (await extMark()) === null && (await main(({ session }) => session.fromPartition('persist:profile_2').extensions.getAllExtensions().length)) === 0);
    await key('Ctrl+Shift+N');
    await waitFor(async () => (await main(() => globalThis.osTest.windows().length)) === 2);
    const iw = await waitFor(() => app.windows().filter((p) => p.url().startsWith('os://ui/?incognito')).pop());
    await iw.waitForSelector('#address');
    await main((_e, url) => globalThis.osTest.windows()[1].navigate(url), `${SITE}/page/ext-incognito`);
    await waitFor(async () => { const x = await state(1); return x.url.endsWith('/page/ext-incognito') && !x.loading; });
    await sleep(800);
    check('incognito runs without extensions', (await extMark(1)) === null);
    check('no extensions button in incognito', (await iw.$('#ext-btn')) === null);
    await main(() => globalThis.osTest.windows()[1].win.close());
    await waitFor(async () => (await main(() => globalThis.osTest.windows().length)) === 1);

    step('55. Кнопка расширений в шапке: меню и всплывающее окно расширения');
    await main(() => globalThis.osTest.windows()[0].openProfile(1));
    const ui6 = await page('os://ui/');
    await ui6.waitForSelector('#ext-btn');
    await ui6.click('#ext-btn');
    await ui6.waitForSelector(`.menu button[data-ext="${extId}"]`);
    check('toolbar menu lists the profile extension', true);
    await keyScreen('55-extensions-menu', 'chrome');
    await ui6.click(`.menu button[data-ext="${extId}"]`);
    const pop = await page(`chrome-extension://${extId}/popup.html`, 10000);
    check('popup of the extension opens (action.default_popup)', pop);
    if (pop) {
      await pop.waitForSelector('#rid');
      const ridText = await waitFor(async () => { const x = await pop.textContent('#rid'); return x.includes(extId) && x; }, 5000);
      check('popup runs with the extension API (chrome.runtime.id)', ridText, ridText);
      const cnt = await waitFor(async () => /pings: [1-9]/.test(await pop.textContent('#count')) && await pop.textContent('#count'), 5000);
      check('popup reads chrome.storage written by the service worker', cnt, String(cnt));
      check('popup window sized to its content', popInfo0(await main(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith(`chrome-extension://${id}/`))?.getContentSize(), extId)));
      check('popup has no os:// bridge', (await pop.evaluate(() => typeof window.os)) === 'undefined');
      const popInfo = await main(({ BrowserWindow, session }, id) => {
        const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith(`chrome-extension://${id}/`));
        return w ? { partition: w.webContents.session === session.fromPartition('persist:profile_1'), frame: w.getBounds() } : null;
      }, extId).catch(() => null);
      check('popup lives in the profile session', popInfo?.partition === true, JSON.stringify(popInfo));
      try { await pop.screenshot({ path: join(OUT, '55-extension-popup.png') }); } catch { /* снимок для человека */ }
      await main(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith(`chrome-extension://${id}/`))?.close(), extId);
    }

    step('56. Экран os://extensions: список, выключение, перезапуск, удаление');
    const mui6 = await page('os://ui/');
    await mui6.click('#more');
    await mui6.click('.main-menu [data-k="more-tools"]');
    await mui6.click('.main-menu [data-k="extensions"]');
    const ep = await page('os://extensions/');
    check('«More tools ▸ Extensions» in the ⋮ menu opens the extensions screen', ep && ep.url().includes('profile=1'), ep?.url());
    await ep.waitForSelector(`.ext[data-id="${extId}"]`);
    check('extensions screen lists the extension with its name and version', (await ep.textContent(`.ext[data-id="${extId}"]`)).includes('Os test extension'));
    check('extensions screen warns that only some extensions work', (await ep.textContent('#ext-warning')).includes('declarativeNetRequest'));
    check('extension icon shown', (await ep.$(`.ext[data-id="${extId}"] img[src^="data:image/png"]`)) !== null);
    await keyScreen('56-extensions-screen', 'page');
    await windowShot('extensions');
    await ep.click(`.ext[data-id="${extId}"] [data-k="enabled"] button >> nth=1`);
    await sleep(500);
    await flush();
    check('turning off is saved', readJson('extensions')?.profiles?.['1']?.find((e) => e.id === extId)?.enabled === false);
    check('turned-off extension is unloaded', !(await main(({ session }, id) => !!session.fromPartition('persist:profile_1').extensions.getExtension(id), extId)));
    await main(() => globalThis.osTest.windows()[0].closePanel());
    await key('Ctrl+T');
    await typeAddress(`${SITE}/page/ext-off`);
    await waitFor(async () => { const x = await state(); return x.url.endsWith('/page/ext-off') && !x.loading; });
    await sleep(800);
    check('turned-off extension does not run on pages', (await extMark()) === null);
    await app.close();
    await launch();
    await unlockIfNeeded();
    await waitFor(async () => (await state())?.profile?.id === 1);
    check('after restart the extension stays off', readJson('extensions')?.profiles?.['1']?.find((e) => e.id === extId)?.enabled === false &&
      !(await main(({ session }, id) => !!session.fromPartition('persist:profile_1').extensions.getExtension(id), extId)));
    await main(() => globalThis.osTest.windows()[0].openPanel('os://extensions/?profile=1'));
    const ep2 = await page('os://extensions/');
    await ep2.waitForSelector(`.ext[data-id="${extId}"]`);
    await ep2.click(`.ext[data-id="${extId}"] [data-k="enabled"] button >> nth=0`);
    check('turning on loads it again', await waitFor(() => main(({ session }, id) => !!session.fromPartition('persist:profile_1').extensions.getExtension(id), extId)));
    await app.close();
    await launch();
    await unlockIfNeeded();
    await waitFor(async () => (await state())?.profile?.id === 1);
    check('enabled extension is loaded at startup (before the first tab)', await main(({ session }, id) => !!session.fromPartition('persist:profile_1').extensions.getExtension(id), extId));
    await key('Ctrl+T');
    await typeAddress(`${SITE}/page/ext-again`);
    await waitFor(async () => { const x = await state(); return x.url.endsWith('/page/ext-again') && !x.loading; });
    check('after restart the content script works again', await waitFor(async () => (await extMark()) === 'ok', 8000));
    await main(() => globalThis.osTest.windows()[0].openPanel('os://extensions/?profile=1'));
    const ep3 = await page('os://extensions/');
    await ep3.waitForSelector(`.ext[data-id="${extId}"] [data-k="options"]`);
    await ep3.click(`.ext[data-id="${extId}"] [data-k="options"]`);
    const opt = await page(`chrome-extension://${extId}/options.html`, 8000);
    check('options page of the extension opens', opt);
    await main(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith(`chrome-extension://${id}/`))?.close(), extId);
    await ep3.click(`.ext[data-id="${extId}"] [data-k="remove"]`);
    await ep3.click('.modal .btn.accent');
    await sleep(800);
    await flush();
    check('removal is saved', !(readJson('extensions')?.profiles?.['1'] ?? []).some((e) => e.id === extId));
    check('removed extension is unloaded', !(await main(({ session }, id) => !!session.fromPartition('persist:profile_1').extensions.getExtension(id), extId)));
    check('extensions screen shows the empty state', await ep3.waitForSelector('#ext-empty', { timeout: 5000 }).then(() => true).catch(() => false));
    await app.close();
    await launch();
    await unlockIfNeeded();
    check('after restart the removed extension is gone (list, session and files)',
      !(readJson('extensions')?.profiles?.['1'] ?? []).some((e) => e.id === extId) &&
      !(await main(({ session }, id) => !!session.fromPartition('persist:profile_1').extensions.getExtension(id), extId)) &&
      await waitFor(() => !existsSync(join(userData, 'extensions', '1', extId)), 5000));

    // --- 57. Настоящие расширения из Chrome Web Store (сеть CI). Итог — в extensions-report.txt, без падения приёмки; снимки страниц — только для человека (страница /tracked почти пустая). ---
    step('57. Chrome Web Store: установка по ссылке и проверка работы настоящих расширений');
    const report = (text) => { line('extensions-report.txt', text); line('checks.txt', `note ${text}`); };
    await main(() => globalThis.osTest.windows()[0].openPanel('os://extensions/?profile=3'));
    const esp = await page('os://extensions/?profile=3');
    const real = [
      { id: 'eimadpbcbfnmbkopoojfekhnkhdbieeh', name: 'Dark Reader', url: `${SITE}/page/dark`, probe: 'document.querySelector("style.darkreader, .darkreader") !== null || document.documentElement.hasAttribute("data-darkreader-scheme")' },
      { id: 'bcjindcccaagfpapjjmafapmmgkkhgoa', name: 'JSON Formatter', url: `${SITE}/data.json`, probe: 'document.body.querySelectorAll("*").length > 3 || !!document.querySelector("#jsonFormatterParsed, .json-formatter-container")' },
      { id: 'ddkjiahejlhfcafbddmgiahcphecmpfh', name: 'uBlock Origin Lite', url: `${SITE}/tracked`, probe: 'false' },
      { id: 'nngceckbapebfimnlniiiahkandclblb', name: 'Bitwarden', url: `${SITE}/page/bw`, probe: 'false' },
    ];
    for (const ext of real) {
      await esp.fill('#ext-input', `https://chromewebstore.google.com/detail/x/${ext.id}`);
      await esp.click('#ext-install');
      const done = await waitFor(async () => !(await esp.isDisabled('#ext-install')) && (await esp.$('.toast')), 120000, 500);
      const msg = done ? await esp.textContent('.toast').catch(() => '') : 'timeout';
      const info = (await main((_e, id) => globalThis.osTest.extensions(3).find((x) => x.id === id) ?? null, ext.id)) ?? null;
      if (!info) { report(`${ext.name}: not installed — ${msg}`); continue; }
      let works = 'n/a';
      if (info.loaded) {
        await main((_e, url) => { const w = globalThis.osTest.windows()[0]; w.openProfile(3); w.newTab(url); }, ext.url);
        await waitFor(async () => { const x = await state(); return x.url.startsWith(ext.url) && !x.loading; }, 15000);
        const ok = await waitFor(() => main((_e, js) => globalThis.osTest.windows()[0].activeWebContents().executeJavaScript(js), ext.probe), 8000);
        works = ok ? 'content script works' : 'no visible effect on the test page';
        await shot(`57-${ext.name.replace(/\W+/g, '-').toLowerCase()}`, 'tab').catch(() => {});
        await main(() => globalThis.osTest.windows()[0].openPanel('os://extensions/?profile=3'));
      }
      report(`${ext.name} ${info.version}: installed, loaded=${info.loaded}${info.error ? ' error=' + info.error : ''}, popup=${info.popup ?? '-'}; ${works}`);
    }
    await keyScreen('57-extensions-store', 'page');
  }
} catch (e) {
  check('scenario finished without errors', false, e.stack ?? String(e));
} finally {
  try { await flush(); } catch { /* приложение уже закрыто */ }
  try {
    for (const f of ['settings', 'profiles', 'pins', 'tabs', 'onboarding', 'history', 'bookmarks', 'downloads', 'saved_pages', 'stats', 'notes', 'site_permissions', 'extensions']) {
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
