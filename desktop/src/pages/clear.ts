import { boot, h, icon, os, t } from '../shared/ui';
import { confirmDialog, param, toast } from './common';
import { DEFAULT_RANGE, RANGES } from '../shared/days';
import type { ProfileInfo } from '../shared/types';

/**
 * «Удалить данные о работе в браузере» (ClearDataActivity.kt): диапазон времени и карточки с галочками
 * и счётчиками. История, cookies, кеш, вкладки — по умолчанию да; пароли и настройки сайтов — нет.
 */
interface Info { profile: ProfileInfo; history: number; tabs: number; passwords: number; sites: number }
const app = document.getElementById('app')!;
app.className = 'wrap';
const profile = Number(param('profile'));
let range = DEFAULT_RANGE;
const checked: Record<string, boolean> = { history: true, cookies: true, cache: true, tabs: true, passwords: false, sites: false };

async function render(): Promise<void> {
  const info = await os.call<Info>('clearInfo', profile, range);
  document.title = t('clear_browsing_data');
  const card = (id: string, ic: string, title: string, sub: string) => {
    const box = h('input', { type: 'checkbox', id: `o-${id}`, checked: checked[id], 'aria-label': title,
      onchange: () => { checked[id] = box.checked; } });
    return h('label', { class: 'opt', for: `o-${id}` }, icon(ic, 22), h('div', { class: 'grow' }, h('div', null, title), h('div', { class: 'sub' }, sub)), box);
  };
  const sel = h('select', { id: 'range', 'aria-label': t('time_range'), onchange: () => { range = sel.value; void render(); } },
    ...RANGES.map((r) => h('option', { value: r.key, selected: r.key === range }, t(r.key))));
  app.replaceChildren(
    h('h1', null, t('clear_browsing_data')),
    h('div', { class: 'hint ph' }, h('span', { class: 'dot', style: `background:${info.profile.color}` }), info.profile.name),
    h('div', { class: 'setting rangerow' }, h('div', { class: 'label' }, t('time_range')), sel),
    h('div', { class: 'card opts' },
      card('history', 'history', t('history'), t('cd_history_n', info.history)),
      card('cookies', 'shield', t('cd_cookies'), t('cd_cookies_desc')),
      card('cache', 'image', t('cd_cache'), t('cd_cache_desc')),
      card('tabs', 'tabs', t('tabs'), t('cd_tabs_n', info.tabs)),
      card('passwords', 'lock', t('passwords'), t('cd_passwords_n', info.passwords)),
      card('sites', 'settings', t('site_settings'), t('cd_sites_n', info.sites))),
    h('div', { class: 'hint' }, t('cd_note')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn accent', id: 'do-clear', onclick: async () => {
        if (!Object.values(checked).some(Boolean)) return;
        // Cookies и вкладки — для всего профиля: спрашиваем ещё раз.
        if ((checked.cookies || checked.tabs) && !(await confirmDialog(t('clear_browsing_data'), info.profile.name, t('cd_delete'), true))) return;
        await os.call('clearData', profile, { range, ...checked });
        toast(t('done'));
        void render();
      } }, t('cd_delete'))),
  );
}

os.on('changed', () => { if (!document.querySelector('.modal-bg')) void render(); });
void boot(render);
