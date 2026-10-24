import { boot, h, icon, iconButton, os, t } from '../shared/ui';
import { confirmDialog, contextMenu, modal, promptDialog, toast } from './common';

/** Избранное с папками (BookmarksActivity.kt): общее для профилей, открывается в текущем профиле. */
interface Bookmark { id: string; t: string; u: string; f: string }
const app = document.getElementById('app')!;
app.className = 'wrap';
let folder = '';
let query = '';

async function render(): Promise<void> {
  const { list, folders } = await os.call<{ list: Bookmark[]; folders: string[] }>('favorites');
  const profile = await os.call<number>('lastProfile');
  document.title = folder || t('favorites');
  const q = query.trim().toLowerCase();
  const search = h('input', { type: 'search', id: 'search', placeholder: t('fav_search'), value: query,
    oninput: () => { query = search.value; void render().then(() => document.getElementById('search')?.focus()); } });
  const row = (b: Bookmark) => h('div', { class: 'item', oncontextmenu: (e: MouseEvent) => { e.preventDefault(); menu(b, folders, e.clientX, e.clientY); } },
    icon('star', 18),
    h('a', { class: 'link', href: b.u, onclick: (e: MouseEvent) => { e.preventDefault(); void os.call('openIn', profile, b.u); } },
      h('div', { class: 't' }, b.t), h('div', { class: 'u' }, b.u)),
    iconButton('more', t('menu'), (e) => menu(b, folders, e.clientX, e.clientY)));
  const nodes: HTMLElement[] = [
    h('div', { class: 'crumb' },
      folder ? iconButton('back', t('back'), () => { folder = ''; void render(); }) : '',
      h('h1', { class: 'grow' }, folder || t('favorites')),
      folder ? iconButton('more', t('menu'), (e) => folderMenu(folder, list, e.clientX, e.clientY)) : '',
      !folder ? h('button', { class: 'btn', id: 'new-folder', onclick: async () => {
        const r = await promptDialog(t('new_folder'), [{ value: '', placeholder: t('fav_folder_name') }]);
        if (r && !(await os.call<boolean>('favAddFolder', r[0]))) toast(t('fav_folder_exists'));
        void render();
      } }, icon('add', 18), t('new_folder')) : '') as HTMLElement,
    h('div', { class: 'toolbar' }, search),
  ];
  if (q) {
    const found = list.filter((b) => b.t.toLowerCase().includes(q) || b.u.toLowerCase().includes(q));
    nodes.push(found.length ? h('div', { class: 'card' }, ...found.map(row)) : h('div', { class: 'empty' }, t('fav_nothing_found')));
  } else if (folder) {
    const items = list.filter((b) => b.f === folder);
    nodes.push(items.length ? h('div', { class: 'card' }, ...items.map(row))
      : h('div', { class: 'empty' }, h('div', { class: 'big' }, t('fav_folder_empty')), t('fav_folder_empty_hint')));
  } else {
    if (!list.length && !folders.length) {
      nodes.push(h('div', { class: 'empty' }, h('div', { class: 'big' }, t('favorites_empty')), t('dt_fav_empty_hint')));
    }
    if (folders.length) {
      nodes.push(h('h2', null, t('fav_folders')), h('div', { class: 'card' }, ...folders.map((f) => h('div', {
        class: 'item', tabindex: '0', role: 'button', onclick: () => { folder = f; void render(); },
        onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { folder = f; void render(); } },
      }, icon('file', 18), h('div', { class: 'link' }, h('div', { class: 't' }, f), h('div', { class: 'u' }, t('fav_count', list.filter((b) => b.f === f).length)))))));
    }
    const root = list.filter((b) => !b.f);
    if (root.length) nodes.push(h('h2', null, t('fav_pages')), h('div', { class: 'card' }, ...root.map(row)));
  }
  app.replaceChildren(...nodes);
}

function menu(b: Bookmark, folders: string[], x: number, y: number): void {
  contextMenu(x, y, [
    { label: t('open'), run: async () => void os.call('openIn', await os.call('lastProfile'), b.u) },
    { label: t('rename'), run: async () => {
      const r = await promptDialog(t('rename'), [{ value: b.t, placeholder: t('fav_page_name') }]);
      if (r) { await os.call('favRename', b.id, r[0]); void render(); }
    } },
    { label: t('move_to_folder'), run: () => moveDialog(b, folders) },
    null,
    { label: t('delete'), danger: true, run: async () => {
      if (await confirmDialog(t('fav_delete_q', b.t), '', t('delete'), true)) { await os.call('favRemove', b.id); void render(); }
    } },
  ]);
}

function moveDialog(b: Bookmark, folders: string[]): void {
  modal((close) => [
    h('h3', null, t('move_to_folder')),
    h('div', { class: 'card' }, ...['', ...folders].map((f) => h('div', {
      class: 'item', tabindex: '0', role: 'button',
      onclick: async () => { close(); await os.call('favMove', b.id, f); toast(t('fav_moved', f || t('no_folder'))); void render(); },
    }, icon(f ? 'file' : 'star', 18), h('div', { class: 'link' }, f || t('no_folder')), b.f === f ? icon('check', 18) : '')),
    h('div', { class: 'item', tabindex: '0', role: 'button', onclick: async () => {
      close();
      const r = await promptDialog(t('new_folder'), [{ value: '', placeholder: t('fav_folder_name') }]);
      if (r && r[0].trim()) { await os.call('favAddFolder', r[0]); await os.call('favMove', b.id, r[0].trim()); void render(); }
    } }, icon('add', 18), h('div', { class: 'link' }, t('new_folder')))),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, t('cancel'))),
  ]);
}

function folderMenu(name: string, list: Bookmark[], x: number, y: number): void {
  const n = list.filter((b) => b.f === name).length;
  contextMenu(x, y, [
    { label: t('fav_rename_folder'), run: async () => {
      const r = await promptDialog(t('fav_rename_folder'), [{ value: name, placeholder: t('fav_folder_name') }]);
      if (!r) return;
      if (await os.call<boolean>('favRenameFolder', name, r[0])) folder = r[0].trim();
      else toast(t('fav_folder_exists'));
      void render();
    } },
    { label: t('fav_delete_folder'), danger: true, run: () => {
      if (!n) { void os.call('favRemoveFolder', name, false).then(() => { folder = ''; void render(); }); return; }
      modal((close) => [
        h('h3', null, t('fav_delete_folder_q', name)),
        h('p', null, t('fav_delete_folder_msg', n)),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: close }, t('cancel')),
          h('button', { class: 'btn', onclick: async () => { close(); await os.call('favRemoveFolder', name, true); folder = ''; void render(); } }, t('fav_keep_pages')),
          h('button', { class: 'btn accent', onclick: async () => { close(); await os.call('favRemoveFolder', name, false); folder = ''; void render(); } }, t('fav_delete_all'))),
      ]);
    } },
  ]);
}

os.on('changed', () => void render());
void boot(render);
