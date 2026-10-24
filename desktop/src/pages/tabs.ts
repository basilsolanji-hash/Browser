import { boot, h, icon, iconButton, os, t } from '../shared/ui';
import { confirmDialog, contextMenu, modal, param, promptDialog, toast } from './common';
import type { ProfileInfo, TabGroup } from '../shared/types';

/** Открытые вкладки профиля (TabsActivity.kt): сетка, группы, поиск, выбор нескольких. */
interface Tab { id: string; title: string; url: string; group: string | null }
interface Data { profile: ProfileInfo; pins: Tab[]; tabs: Tab[]; groups: TabGroup[]; active: string | null; colors: string[] }

const app = document.getElementById('app')!;
app.className = 'wrap wide';
const profile = Number(param('profile'));
let data: Data;
let thumbs: Record<string, string> = {};
let query = '';
let selecting = false;
const selected = new Set<string>();

const host = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return t('start_page'); }
};

async function load(): Promise<void> {
  data = await os.call<Data>('tabsOf', profile);
  render();
  thumbs = await os.call<Record<string, string>>('thumbs', profile);
  render();
}

function card(tab: Tab): HTMLElement {
  const g = data.groups.find((x) => x.id === tab.group);
  const isSel = selected.has(tab.id);
  const thumb = thumbs[tab.id]
    ? h('img', { src: thumbs[tab.id], alt: '' })
    : h('span', { class: 'letter' }, (/^https?:/.test(tab.url) ? host(tab.url).charAt(0) : 'О').toUpperCase());
  const el = h('div', {
    class: `tcard${tab.id === data.active ? ' cur' : ''}${isSel ? ' sel' : ''}`, tabindex: '0', role: 'button', 'data-id': tab.id,
    'aria-label': tab.title,
    onclick: () => (selecting ? toggle(tab.id) : void os.call('activateTab', profile, tab.id)),
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') el.click(); if (e.key === 'Delete') void close([tab.id]); },
    oncontextmenu: (e: MouseEvent) => { e.preventDefault(); tabMenu(tab, e.clientX, e.clientY); },
  },
  g ? h('span', { class: 'gbar', style: `background:${g.color}` }) : null,
  h('div', { class: 'thumb' }, thumb),
  h('div', { class: 'meta' }, h('div', { class: 'ttl' }, tab.title), h('div', { class: 'host' }, /^https?:/.test(tab.url) ? host(tab.url) : t('start_page'))));
  if (selecting) {
    el.append(h('input', { type: 'checkbox', class: 'chk', checked: isSel, tabindex: '-1', onclick: (e: MouseEvent) => { e.stopPropagation(); toggle(tab.id); } }));
  } else {
    el.append(h('button', { class: 'x', title: t('close_tab'), 'aria-label': t('close_tab'), onclick: (e: MouseEvent) => { e.stopPropagation(); void close([tab.id]); } }, icon('close', 16)));
  }
  return el;
}

function toggle(id: string): void {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  render();
}

function render(): void {
  document.title = `${t('tabs')} — ${data.profile.name}`;
  const q = query.trim().toLowerCase();
  const match = (x: Tab) => !q || x.title.toLowerCase().includes(q) || x.url.toLowerCase().includes(q);
  const tabs = data.tabs.filter(match);
  const search = h('input', {
    type: 'search', id: 'search', placeholder: t('search_tabs'), value: query,
    oninput: () => { query = search.value; render(); document.getElementById('search')?.focus(); },
  });
  const nodes: (HTMLElement | null)[] = [
    h('h1', null, `${t('tabs')} · ${data.profile.name}`),
    h('div', { class: 'hint' }, t('tabs_open_n', data.tabs.length)),
    h('div', { class: 'toolbar' }, search,
      h('button', { class: 'btn', onclick: () => void os.call('newTabIn', profile, null) }, icon('add', 18), t('new_tab')),
      h('button', { class: 'btn', onclick: () => void newGroup([]) }, t('new_tab_group')),
      h('button', { class: 'btn', disabled: !data.tabs.length, onclick: () => { selecting = !selecting; selected.clear(); render(); } }, selecting ? t('cancel') : t('select_tabs')),
      h('button', { class: 'btn danger', disabled: !data.tabs.length, onclick: () => void closeAll() }, t('close_all_tabs'))),
  ];
  if (selecting) {
    nodes.push(h('div', { class: 'selbar' },
      h('span', { class: 'grow' }, t('selected_n', selected.size)),
      h('button', { class: 'btn', onclick: () => { data.tabs.forEach((x) => selected.add(x.id)); render(); } }, t('select_all')),
      h('button', { class: 'btn', disabled: !selected.size, onclick: (e: MouseEvent) => groupPicker([...selected], e.clientX, e.clientY) }, t('to_group')),
      h('button', { class: 'btn', disabled: !selected.size, onclick: () => void close([...selected]) }, t('close'))));
  }
  if (!q && data.pins.length) {
    nodes.push(h('h2', null, t('pinned_tabs')), h('div', { class: 'pinrow' }, ...data.pins.map((p) =>
      h('button', { class: 'btn' + (p.id === data.active ? ' cur' : ''), onclick: () => void os.call('activateTab', profile, p.id) }, p.title))));
  }
  if (!data.tabs.length) {
    nodes.push(h('div', { class: 'empty' }, h('div', { class: 'big' }, t('tabs_empty')), t('tabs_empty_hint')));
  } else if (!tabs.length) {
    nodes.push(h('div', { class: 'empty' }, h('div', { class: 'big' }, t('tabs_not_found')), t('tabs_not_found_hint', query)));
  } else {
    for (const g of data.groups) {
      const items = tabs.filter((x) => x.group === g.id);
      if (q && !items.length) continue;
      nodes.push(h('div', { class: 'ghead' },
        h('span', { class: 'dot', style: `background:${g.color}` }),
        h('span', { class: 'gname' }, g.name),
        h('span', { class: 'cnt' }, String(items.length)),
        h('span', { class: 'grow' }),
        iconButton('more', t('menu'), (e) => groupMenu(g, e.clientX, e.clientY))));
      nodes.push(items.length ? h('div', { class: 'grid' }, ...items.map(card)) : h('div', { class: 'hint' }, t('group_empty')));
    }
    const other = tabs.filter((x) => !x.group || !data.groups.some((g) => g.id === x.group));
    if (other.length) {
      if (data.groups.length) nodes.push(h('div', { class: 'ghead' }, h('span', { class: 'gname' }, t('other_tabs')), h('span', { class: 'cnt' }, String(other.length))));
      nodes.push(h('div', { class: 'grid', style: data.groups.length ? '' : 'margin-top:16px' }, ...other.map(card)));
    }
  }
  app.replaceChildren(...nodes.filter((n): n is HTMLElement => !!n));
}

async function close(ids: string[]): Promise<void> {
  await os.call('closeTabs', profile, ids);
  ids.forEach((id) => selected.delete(id));
  if (selecting && !selected.size) selecting = false;
  await load();
}

async function closeAll(): Promise<void> {
  if (!(await confirmDialog(t('close_all_q', data.tabs.length), '', t('close_all_tabs'), true))) return;
  await close(data.tabs.map((x) => x.id));
  toast(t('tabs_closed'));
}

function tabMenu(tab: Tab, x: number, y: number): void {
  contextMenu(x, y, [
    { label: t('open'), run: () => void os.call('activateTab', profile, tab.id) },
    { label: t('add_to_group'), run: () => groupPicker([tab.id], x, y) },
    tab.group ? { label: t('ungroup'), run: () => void os.call('setGroup', profile, [tab.id], null).then(load) } : null,
    null,
    { label: t('close_tab'), danger: true, run: () => void close([tab.id]) },
  ]);
}

function groupPicker(ids: string[], x: number, y: number): void {
  const done = () => { selecting = false; selected.clear(); void load(); };
  contextMenu(x, y, [
    ...data.groups.map((g) => ({ label: g.name, run: () => void os.call('setGroup', profile, ids, g.id).then(done) })),
    { label: t('new_tab_group'), icon: 'add', run: () => void newGroup(ids) },
  ].filter((v) => v !== null));
}

function colorPicker(current: string, onPick: (c: string) => void): void {
  modal((close) => [
    h('h3', null, t('group_color')),
    h('div', { class: 'colors' }, ...data.colors.map((c) => h('button', {
      class: c === current ? 'on' : '', style: `background:${c}`, 'aria-label': c,
      onclick: () => { close(); onPick(c); },
    }))),
  ]);
}

async function newGroup(ids: string[]): Promise<void> {
  const r = await promptDialog(t('new_tab_group'), [{ value: '', placeholder: t('group_name_hint') }]);
  if (!r) return;
  const color = data.colors[data.groups.length % data.colors.length];
  await os.call('groupAdd', profile, r[0], color, ids);
  selecting = false;
  selected.clear();
  await load();
}

function groupMenu(g: TabGroup, x: number, y: number): void {
  const ids = data.tabs.filter((tab) => tab.group === g.id).map((tab) => tab.id);
  contextMenu(x, y, [
    { label: t('new_tab_in_group'), icon: 'add', run: () => void os.call('newTabIn', profile, g.id) },
    { label: t('rename_group'), icon: 'edit', run: async () => {
      const r = await promptDialog(t('rename_group'), [{ value: g.name, placeholder: t('group_name_hint') }]);
      if (r) { await os.call('groupUpdate', profile, g.id, r[0], ''); await load(); }
    } },
    { label: t('group_color'), run: () => colorPicker(g.color, (c) => void os.call('groupUpdate', profile, g.id, '', c).then(load)) },
    null,
    ids.length ? { label: t('close_group_tabs'), danger: true, run: () => void close(ids) } : null,
    { label: t('delete_group'), danger: true, run: async () => {
      if (await confirmDialog(t('delete_group'), t('delete_group_msg', g.name), t('delete'), true)) {
        await os.call('groupDelete', profile, g.id);
        await load();
      }
    } },
  ]);
}

os.on('changed', () => void load());
void boot(load);
