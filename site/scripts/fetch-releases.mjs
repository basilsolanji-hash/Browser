// Сборка данных о релизах для сайта: последние Android (build-N) и Windows (desktop-N) сборки,
// файлы, размеры, SHA-256 и журнал изменений из коммитов между релизами. Пишет src/data/releases.json.
// Посетитель сайта к GitHub не обращается — всё собирается здесь, при сборке.
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.GITHUB_REPOSITORY || 'basilsolanji-hash/Browser';
const API = 'https://api.github.com';
const KEEP = 30; // сколько релизов каждой платформы попадает в журнал
const out = join(dirname(fileURLToPath(import.meta.url)), '../src/data/releases.json');

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'os-browser-site' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function get(path) {
  const r = await fetch(API + path, { headers });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

async function allReleases() {
  const list = [];
  for (let page = 1; page < 20; page++) {
    const part = await get(`/repos/${REPO}/releases?per_page=100&page=${page}`);
    list.push(...part);
    if (part.length < 100) break;
  }
  return list.filter((r) => !r.draft && !r.prerelease);
}

const sha = (r) => (r.body?.match(/\b[0-9a-f]{40}\b/) || [])[0] || (/^[0-9a-f]{40}$/.test(r.target_commitish) ? r.target_commitish : null);

function asset(a) {
  return { name: a.name, size: a.size, url: a.browser_download_url, sha256: a.digest?.startsWith('sha256:') ? a.digest.slice(7) : null };
}

// Коммиты, которые затрагивают папку платформы, — чтобы в ленту Windows не попали правки Android и наоборот.
async function platformCommits(head, path) {
  const set = new Set();
  for (let page = 1; page <= 5; page++) {
    const part = await get(`/repos/${REPO}/commits?sha=${head}&path=${path}&per_page=100&page=${page}`);
    part.forEach((c) => set.add(c.sha));
    if (part.length < 100) break;
  }
  return set;
}

function subject(msg) {
  const line = msg.split('\n')[0].trim();
  return line.length > 200 ? line.slice(0, 197) + '…' : line;
}

async function platform(all, re, path, mainAsset, describe) {
  const rel = all
    .map((r) => ({ r, n: +(r.tag_name.match(re)?.[1] ?? NaN) }))
    .filter((x) => Number.isFinite(x.n) && x.r.assets.some((a) => mainAsset.test(a.name)))
    .sort((a, b) => b.n - a.n)
    .slice(0, KEEP + 1);
  if (!rel.length) return null;
  const head = sha(rel[0].r);
  const touched = head ? await platformCommits(head, path).catch(() => null) : null;
  const items = [];
  for (let i = 0; i < Math.min(rel.length, KEEP); i++) {
    const { r, n } = rel[i];
    const prev = rel[i + 1]?.r;
    let changes = [];
    const a = prev && sha(prev), b = sha(r);
    if (a && b && a !== b) {
      try {
        const cmp = await get(`/repos/${REPO}/compare/${a}...${b}`);
        changes = cmp.commits
          .filter((c) => !touched || touched.has(c.sha))
          .map((c) => subject(c.commit.message))
          .filter((s) => s && !/^Merge (branch|pull request|remote)/.test(s))
          .reverse();
      } catch (e) { console.warn('compare', r.tag_name, e.message); }
    }
    items.push({
      tag: r.tag_name, build: n, ...describe(r),
      date: r.published_at, page: r.html_url, commit: b,
      engine: (r.body?.match(/(GeckoView[^.]*?\d+|Electron \d+(\.\d+)*)/) || [])[0] || null,
      assets: r.assets.filter((x) => !/\.(blockmap|yml)$/.test(x.name)).map(asset),
      changes: [...new Set(changes)].slice(0, 25),
    });
  }
  return { latest: items[0], releases: items };
}

try {
  const all = await allReleases();
  const data = {
    generated: new Date().toISOString(),
    repo: REPO,
    android: await platform(all, /^build-(\d+)$/, 'app', /\.apk$/, (r) => ({ version: `0.8.${r.tag_name.slice(6)}` })),
    windows: await platform(all, /^desktop-(\d+)$/, 'desktop', /Setup.*\.exe$/, (r) => ({
      version: (r.assets.find((a) => /Setup.*\.exe$/.test(a.name))?.name.match(/(\d+\.\d+\.\d+)/) || [])[1] || null,
    })),
  };
  writeFileSync(out, JSON.stringify(data, null, 1) + '\n');
  console.log(`releases: Android ${data.android?.latest.tag}, Windows ${data.windows?.latest.tag}`);
} catch (e) {
  // Без сети сборка идёт на последнем сохранённом снимке; в CI отсутствие данных — ошибка.
  if (existsSync(out) && !process.env.CI) console.warn('fetch-releases: оставляю старый снимок —', e.message);
  else throw e;
}
