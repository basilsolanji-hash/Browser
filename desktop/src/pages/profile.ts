import { boot, h, icon, iconButton, os, t } from '../shared/ui';
import { confirmDialog, contextMenu, param, promptDialog, section, toast } from './common';
import { pinEditor } from './_pins';
import type { ProfileInfo } from '../shared/types';

/** Профиль (ProfileActivity.kt): название, описание, закреплённые вкладки профиля и прикреплённые файлы. */
const app = document.getElementById('app')!;
app.className = 'wrap';
const id = Number(param('id'));

interface FileInfo { name: string; size: number; time: number }

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

async function render(): Promise<void> {
  const p = await os.call<ProfileInfo & { customName: string }>('profile', id);
  const files = await os.call<FileInfo[]>('files', id);
  document.title = p.name;
  const name = h('input', {
    type: 'text', id: 'name', value: p.customName || p.name, 'aria-label': t('profile_name'),
    onchange: () => void os.call('renameProfile', id, name.value),
  });
  const note = h('div', { class: 'saved-note' });
  let timer = 0;
  const desc = h('textarea', {
    id: 'desc', placeholder: t('profile_desc_hint'),
    oninput: () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => void os.call('setDescription', id, desc.value).then(() => { note.textContent = t('done'); }), 500);
    },
  });
  desc.value = p.description;
  const pins = await pinEditor(id, render);
  const fileRows = files.map((f) => h('div', {
    class: 'setting file',
    oncontextmenu: (e: MouseEvent) => { e.preventDefault(); fileMenu(f, e.clientX, e.clientY); },
  },
  icon('file'),
  h('div', { class: 'label' }, h('div', null, f.name), h('div', { class: 'sub' }, `${size(f.size)} · ${new Date(f.time).toLocaleDateString()}`)),
  h('button', { class: 'btn', onclick: () => void open(f) }, t('open')),
  iconButton('more', t('menu'), (e) => fileMenu(f, e.clientX, e.clientY))));

  app.replaceChildren(
    h('div', { class: 'head' }, h('span', { class: 'dot', style: `background:${p.color}` }), name,
      h('button', { class: 'btn' + (p.pinned ? ' on' : ''), id: 'profile-pin', 'aria-pressed': String(p.pinned),
        onclick: () => void os.call('setPinned', id, !p.pinned).then(render) }, icon('pin', 18), t(p.pinned ? 'profile_unpin' : 'profile_pin')),
      h('button', { class: 'btn', onclick: () => void os.call('openProfile', id) }, t('open'))),
    p.current ? h('div', { class: 'hint cur' }, icon('check', 16), t('profile_current')) : '',
    h('div', { class: 'hint' }, p.email ?? t('not_signed_in')),
    ...section(t('profile_desc'), desc, note),
    ...section(t('pinned_tabs'),
      p.ownPins
        ? h('div', null, h('div', { class: 'hint' }, t('tabs_own_desc')),
          h('button', { class: 'btn', style: 'margin:6px 0 10px', onclick: () => void os.call('pinsUseCommon', id).then(render) }, t('tabs_use_common')))
        : h('div', { class: 'hint' }, t('tabs_common_desc')),
      pins),
    ...section(t('profile_files'),
      files.length ? h('div', { class: 'card' }, ...fileRows) : h('div', { class: 'hint' }, t('profile_files_empty')),
      h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn', id: 'add-files', onclick: () => void add() }, icon('add', 18), t('add_files'))),
      h('div', { class: 'hint' }, t('profile_files_local'))),
    ...section(t('data'), h('div', { class: 'card' },
      h('a', { class: 'setting plink', id: 'profile-clear', href: `os://clear/?profile=${id}` },
        icon('history', 20), h('div', { class: 'label' }, h('div', null, t('clear_browsing_data')), h('div', { class: 'sub' }, t('cd_note')))),
      h('a', { class: 'setting plink', href: `os://history/?profile=${id}` }, icon('history', 20), h('div', { class: 'label' }, t('history'))),
      h('a', { class: 'setting plink', href: `os://site/?profile=${id}` }, icon('shield', 20), h('div', { class: 'label' }, t('site_permissions'))),
      h('button', { class: 'setting plink danger', onclick: async () => {
        if (await confirmDialog(t('clear_q', p.name), t('clear_profile_msg'), t('clear'), true)) { await os.call('clearProfile', id); toast(t('done')); }
      } }, icon('delete', 20), h('div', { class: 'label' }, t('logout_clear'))))),
  );
}

async function add(): Promise<void> {
  const r = await os.call<{ added: number; failed: number }>('filesAdd', id);
  if (r.failed) toast(t('file_add_failed'));
  void render();
}

async function open(f: FileInfo): Promise<void> {
  if (!(await os.call<boolean>('fileOpen', id, f.name))) toast(t('cant_open_file'));
}

function fileMenu(f: FileInfo, x: number, y: number): void {
  contextMenu(x, y, [
    { label: t('open'), run: () => void open(f) },
    { label: t('dt_show_in_folder'), run: () => void os.call('fileShow', id, f.name) },
    { label: t('rename'), run: async () => {
      const r = await promptDialog(t('rename'), [{ value: f.name, placeholder: f.name }]);
      if (r) { await os.call('fileRename', id, f.name, r[0]); void render(); }
    } },
    null,
    { label: t('delete'), danger: true, run: async () => {
      if (await confirmDialog(t('delete_file_q'), f.name, t('delete'), true)) { await os.call('fileDelete', id, f.name); void render(); }
    } },
  ]);
}

os.on('changed', () => {
  // Не перерисовываем, пока пользователь печатает описание или название.
  const a = document.activeElement;
  if (a && (a.id === 'desc' || a.id === 'name')) return;
  void render();
});
void boot(render);
