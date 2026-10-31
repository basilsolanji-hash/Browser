import { boot, h, icon, os, t } from '../shared/ui';
import { param, toast } from './common';
import type { ProfileInfo } from '../shared/types';

/**
 * «Перенести из Chrome»: закладки и история прямо из профиля Chrome на этом компьютере, закладки из HTML,
 * пароли из CSV. Всё попадает в текущий профиль (избранное — общее). Названия и адреса из файлов здесь
 * не показываются — только числа отчёта.
 */
interface ChromeProfile { dir: string; name: string; bookmarks: boolean; history: boolean }
interface Info { incognito: boolean; profile: ProfileInfo | null; chrome: ChromeProfile[] | null; sqlite: boolean; crypto: boolean }
interface Report { bookmarks: number; passwords: number; history: number; duplicates: number; skipped: number }

const app = document.getElementById('app')!;
app.className = 'wrap';
const profile = Number(param('profile')) || 0;
const ERRORS: Record<string, string> = {
  big: 'dt_import_big', bad: 'dt_import_bad', busy: 'dt_import_busy', notfound: 'dt_import_no_profile', nocrypto: 'dt_import_nocrypto', incognito: 'dt_import_incognito',
};
let report: Report | null = null;
let chosen = '';
const want = { bookmarks: true, history: true };
let running = false;

async function run(cmd: string, ...args: unknown[]): Promise<void> {
  if (running) return;
  running = true;
  document.querySelectorAll<HTMLButtonElement>('.imp .btn').forEach((b) => { b.disabled = true; });
  try {
    const r = await os.call<Report | string>(cmd, profile, ...args);
    if (typeof r === 'object' && r) { report = r; toast(t('done')); } else if (r !== 'cancel') toast(t(ERRORS[String(r)] ?? 'dt_import_bad'));
  } finally {
    running = false;
    void render();
  }
}

function reportCard(r: Report): HTMLElement {
  return h('div', { class: 'card imp', id: 'import-report', role: 'status' },
    h('h3', null, icon('check', 20), t('dt_import_added', r.bookmarks, r.passwords, r.history)),
    h('div', { class: 'hint', id: 'import-skipped' }, t('dt_import_skipped', r.duplicates, r.skipped)),
    h('div', { class: 'links' },
      h('a', { href: 'os://favorites/', id: 'open-favorites' }, t('favorites')),
      h('a', { href: `os://cabinet/?profile=${profile}`, id: 'open-cabinet' }, t('cabinet'))));
}

function chromeCard(info: Info): HTMLElement {
  const list = info.chrome ?? [];
  if (!list.length) {
    return h('div', { class: 'card imp', id: 'import-chrome' },
      h('h3', null, icon('globe', 20), t('dt_import_local')),
      h('div', { class: 'hint', id: 'chrome-missing' }, t('dt_import_not_found')),
      h('div', { class: 'hint' }, t('dt_import_pw_hint')));
  }
  if (!list.some((p) => p.dir === chosen)) chosen = list[0].dir;
  const cur = list.find((p) => p.dir === chosen)!;
  const hist = cur.history && info.sqlite;
  const sel = h('select', { id: 'chrome-profile', 'aria-label': t('dt_import_chrome_profile'), onchange: () => { chosen = sel.value; void render(); } },
    ...list.map((p) => h('option', { value: p.dir, selected: p.dir === chosen }, p.name)));
  const box = (id: string, key: 'bookmarks' | 'history', label: string) => {
    const c = h('input', { type: 'checkbox', id, checked: want[key], onchange: () => { want[key] = c.checked; } });
    return h('label', { for: id }, c, label);
  };
  return h('div', { class: 'card imp', id: 'import-chrome' },
    h('h3', null, icon('globe', 20), t('dt_import_local')),
    h('div', { class: 'opts' },
      h('label', null, t('dt_import_chrome_profile'), sel),
      cur.bookmarks ? box('imp-bm', 'bookmarks', t('dt_import_bookmarks')) : null,
      hist ? box('imp-hist', 'history', t('dt_import_history')) : null),
    h('div', { class: 'hint' }, t('dt_import_pw_hint')),
    hist ? h('div', { class: 'hint' }, t('dt_import_history_limit')) : null,
    h('div', { class: 'go' }, h('button', { class: 'btn accent', id: 'import-chrome-go', onclick: () => {
      const what = { bookmarks: cur.bookmarks && want.bookmarks, history: hist && want.history };
      if (what.bookmarks || what.history) void run('importChrome', chosen, what);
    } }, t('dt_import_go'))));
}

async function render(): Promise<void> {
  const info = await os.call<Info>('importInfo', profile);
  document.title = t('dt_import_chrome');
  if (info.incognito || !info.profile) {
    app.replaceChildren(h('h1', null, t('dt_import_chrome')), h('div', { class: 'empty', id: 'import-incognito' }, t('dt_import_incognito')));
    return;
  }
  app.replaceChildren(...[
    h('h1', null, t('dt_import_chrome')),
    h('div', { class: 'hint ph', id: 'import-to' }, h('span', { class: 'dot', style: `background:${info.profile.color}` }), t('dt_import_to', info.profile.name)),
    report ? reportCard(report) : null,
    chromeCard(info),
    h('div', { class: 'card imp' },
      h('h3', null, icon('star', 20), t('dt_import_html')),
      h('div', { class: 'hint' }, t('dt_import_html_hint')),
      h('div', { class: 'go' }, h('button', { class: 'btn', id: 'import-html', onclick: () => void run('importFile', 'html') }, t('dt_import_pick')))),
    h('div', { class: 'card imp' },
      h('h3', null, icon('lock', 20), t('dt_import_csv')),
      h('div', { class: 'hint' }, t('dt_import_csv_hint')),
      h('div', { class: 'warn', id: 'csv-warning' }, t('dt_import_csv_warning')),
      info.crypto ? null : h('div', { class: 'hint', id: 'csv-nocrypto' }, t('dt_import_nocrypto')),
      h('div', { class: 'go' }, h('button', { class: 'btn', id: 'import-csv', disabled: !info.crypto, onclick: () => void run('importFile', 'csv') }, t('dt_import_pick')))),
    h('div', { class: 'hint' }, t('dt_import_common')),
  ].filter((x): x is HTMLElement => !!x));
}

os.on('changed', () => { if (!running) void render(); });
void boot(render);
