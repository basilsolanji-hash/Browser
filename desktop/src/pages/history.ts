import { boot, h, icon, iconButton, os, t } from '../shared/ui';
import { param } from './common';
import { dayTitle, groupByDay } from '../shared/days';
import type { ProfileInfo } from '../shared/types';

/**
 * История профиля как в Chrome (HistoryActivity.kt): поиск, подсказка «История профиля …», ссылка
 * «Удалить данные о работе в браузере…», записи по дням, буква сайта в кружке, крестик удаляет запись,
 * нажатие открывает страницу новой вкладкой этого профиля.
 */
interface Visit { u: string; t: string; d: number }
const app = document.getElementById('app')!;
app.className = 'wrap';
const profile = Number(param('profile'));
let query = '';
const rows = h('div', { id: 'rows' });

const COLORS = ['#E53935', '#8E24AA', '#3949AB', '#1E88E5', '#00897B', '#43A047', '#F4511E', '#6D4C41', '#546E7A', '#D81B60', '#5E35B1', '#039BE5', '#7CB342', '#FB8C00', '#00ACC1'];
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };

/** Цвет кружка — по домену (как Profiles.color(hash) в Android). */
function colorOf(host: string): string {
  let x = 0;
  for (const c of host) x = (x * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(x) % COLORS.length];
}

let items: Visit[] = [];
let profileName = '';

function renderRows(): void {
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((v) => v.u.toLowerCase().includes(q) || v.t.toLowerCase().includes(q)) : items;
  if (!shown.length) {
    rows.replaceChildren(h('div', { class: 'empty' }, q ? t('nothing_found') : t('history_empty', profileName)));
    return;
  }
  const lang = document.documentElement.lang || 'en';
  const labels = { just: '', today: t('dl_today'), yesterday: t('dl_yesterday') };
  rows.replaceChildren(...groupByDay(shown.slice(0, 1000), (v) => v.d, Date.now()).flatMap((g) => [
    h('div', { class: 'day' }, dayTitle(g, lang, labels)),
    h('div', { class: 'card' }, ...g.items.map((v) => {
      const host = hostOf(v.u);
      const short = host.replace(/^(www|m)\./, '');
      const open = () => void os.call('openIn', profile, v.u);
      return h('div', {
        class: 'item', tabindex: '0', role: 'link', title: v.u,
        onclick: (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('button')) open(); },
        onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') open(); },
      },
      h('span', { class: 'letter', style: `background:${colorOf(short)}` }, (short[0] ?? '•').toUpperCase()),
      h('div', { class: 'grow' }, h('div', { class: 't' }, v.t || short || v.u), h('div', { class: 'u' }, host)),
      h('span', { class: 'time' }, new Date(v.d).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })),
      iconButton('close', t('delete'), () => void os.call('historyRemove', profile, v.u, v.d).then(load), 'del'));
    })),
  ]));
}

async function load(): Promise<void> {
  const r = await os.call<{ profile: ProfileInfo; items: Visit[] }>('history', profile);
  items = r.items;
  profileName = r.profile.name;
  renderRows();
}

async function render(): Promise<void> {
  const { profile: p } = await os.call<{ profile: ProfileInfo; items: Visit[] }>('history', profile);
  document.title = t('history');
  const search = h('input', { type: 'search', id: 'search', placeholder: t('search_history'), 'aria-label': t('search_history'), value: query,
    oninput: () => { query = search.value; renderRows(); } });
  app.replaceChildren(
    h('h1', null, t('history')),
    search,
    h('div', { class: 'hint ph' }, h('span', { class: 'dot', style: `background:${p.color}` }), t('history_profile_hint', p.name)),
    h('a', { class: 'clearlink', id: 'open-clear', href: `os://clear/?profile=${profile}` }, icon('delete', 18), t('clear_browsing_data') + '…'),
    rows,
  );
  await load();
}

os.on('changed', () => void load());
void boot(render);
