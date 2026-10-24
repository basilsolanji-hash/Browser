import { boot, h, iconButton, os, t } from '../shared/ui';
import { confirmDialog, param, toast } from './common';
import type { ProfileInfo } from '../shared/types';

/** История профиля (History.kt): по дням, поиск, удаление записи, очистка. */
interface Visit { u: string; t: string; d: number }
const app = document.getElementById('app')!;
app.className = 'wrap';
const profile = Number(param('profile'));
let query = '';

async function render(): Promise<void> {
  const { profile: p, items } = await os.call<{ profile: ProfileInfo; items: Visit[] }>('history', profile);
  document.title = t('history_title', p.name);
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((v) => v.u.toLowerCase().includes(q) || v.t.toLowerCase().includes(q)) : items;
  const search = h('input', { type: 'search', id: 'search', placeholder: t('search'), value: query,
    oninput: () => { query = search.value; void render().then(() => document.getElementById('search')?.focus()); } });
  const nodes: HTMLElement[] = [
    h('h1', null, t('history_title', p.name)),
    h('div', { class: 'toolbar' }, search,
      h('button', { class: 'btn danger', disabled: !items.length, onclick: async () => {
        if (await confirmDialog(t('clear_history') + '?', p.name, t('clear'), true)) {
          await os.call('historyClear', profile);
          toast(t('history_cleared'));
          void render();
        }
      } }, t('clear_history'))),
  ];
  if (!items.length) nodes.push(h('div', { class: 'empty' }, t('history_empty', p.name)));
  else if (!shown.length) nodes.push(h('div', { class: 'empty' }, t('nothing_found')));
  let day = '';
  let card: HTMLElement | null = null;
  for (const v of shown.slice(0, 500)) {
    const d = new Date(v.d);
    const label = d.toLocaleDateString(document.documentElement.lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (label !== day) {
      day = label;
      nodes.push(h('div', { class: 'day' }, label));
      card = h('div', { class: 'card' });
      nodes.push(card);
    }
    card!.append(h('div', { class: 'item' },
      h('span', { class: 'time' }, d.toLocaleTimeString(document.documentElement.lang, { hour: '2-digit', minute: '2-digit' })),
      h('a', { class: 'link', href: v.u, onclick: (e: MouseEvent) => { e.preventDefault(); void os.call('openIn', profile, v.u); } },
        h('div', { class: 't' }, v.t || v.u), h('div', { class: 'u' }, v.u)),
      iconButton('delete', t('delete'), () => void os.call('historyRemove', profile, v.u, v.d).then(render))));
  }
  app.replaceChildren(...nodes);
}

void boot(render);
