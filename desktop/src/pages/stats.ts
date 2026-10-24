import { boot, h, os, t } from '../shared/ui';
import { confirmDialog, section } from './common';
import type { ProfileInfo } from '../shared/types';

/** Статистика (StatsActivity.kt): страницы, трекеры, частые сайты, библиотека. Только на этом компьютере. */
interface Stats {
  since: number; trackers: number;
  pages: { profile: ProfileInfo; pages: number }[];
  top: [string, number][];
  library: { notes: number; saved: number; downloads: number; favorites: number };
}
const app = document.getElementById('app')!;
app.className = 'wrap';

const line = (label: string, value: string, color?: string) =>
  h('div', { class: 'line' }, color ? h('span', { class: 'dot', style: `background:${color}` }) : '', h('span', { class: 'grow' }, label), h('span', { class: 'v' }, value));

async function render(): Promise<void> {
  document.title = t('stats');
  const s = await os.call<Stats>('stats');
  const total = s.pages.reduce((a, p) => a + p.pages, 0);
  const used = s.pages.filter((p) => p.pages > 0);
  app.replaceChildren(
    h('h1', null, t('stats')),
    h('div', { class: 'tiles' },
      h('div', { class: 'card tile' }, h('div', { class: 'n', id: 'pages-total' }, String(total)), h('div', { class: 'l' }, t('stats_pages'))),
      h('div', { class: 'card tile' }, h('div', { class: 'n' }, String(s.trackers)), h('div', { class: 'l' }, t('stats_trackers')))),
    h('div', { class: 'hint' }, t('stats_since', new Date(s.since).toLocaleDateString(document.documentElement.lang))),
    ...section(t('profiles'), used.length ? h('div', { class: 'card' }, ...used.map((p) => line(p.profile.name, String(p.pages), p.profile.color)))
      : h('div', { class: 'hint' }, t('stats_no_sites'))),
    ...section(t('stats_top_sites'), s.top.length ? h('div', { class: 'card' }, ...s.top.map(([host, n]) => line(host, t('stats_visits', n))))
      : h('div', { class: 'hint' }, t('stats_no_sites'))),
    ...section(t('my_library'), h('div', { class: 'card' },
      line(t('notes'), String(s.library.notes)), line(t('saved_pages'), String(s.library.saved)),
      line(t('downloads'), String(s.library.downloads)), line(t('favorites'), String(s.library.favorites)))),
    h('div', { style: 'margin-top:18px' }, h('button', { class: 'btn', onclick: async () => {
      if (await confirmDialog(t('stats_reset_q'), '', t('stats_reset'), true)) { await os.call('statsReset'); void render(); }
    } }, t('stats_reset'))),
    h('div', { class: 'hint' }, t('stats_local')),
  );
}

void boot(render);
