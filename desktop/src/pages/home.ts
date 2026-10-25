import { boot, h, icon, iconButton, os, svg, t } from '../shared/ui';
import { WORDMARK } from '../shared/icons';
import { confirmDialog, contextMenu, promptDialog } from './common';
import { byFolder, visibleProfiles } from '../shared/profilegroups';
import type { ProfileInfo } from '../shared/types';

/**
 * Экран профилей (MainActivity.kt): логотип, быстрые ссылки, профили — первые 10 и «Показать все».
 * Закреплённые — сверху с булавкой, текущий (последний открытый) — рамкой и галочкой; список или плитка;
 * папки профилей — разделы по алфавиту, «Без папки» последним, папку можно свернуть.
 */
interface Data { list: ProfileInfo[]; count: number; folders: string[]; collapsed: string[]; view: 'list' | 'grid' }
let expanded = false;
let data: Data | null = null;
/** Фраза — новая при каждом открытии экрана, а не при каждой перерисовке. */
let phrase: { greeting: string; phrase: string } | null | undefined;
const app = document.getElementById('app')!;
app.className = 'wrap';

async function render(): Promise<void> {
  document.title = t('profiles');
  data = await os.call<Data>('profiles');
  phrase ??= await os.call<{ greeting: string; phrase: string } | null>('phrase');
  const { list, view } = data;
  const shown = visibleProfiles(list, expanded);
  const sections = byFolder(shown, (p) => p.folder, document.documentElement.lang);
  const hasFolders = sections.some((s) => s.folder);
  const body = h('div', { class: 'sections' }, ...sections.map((s) => {
    const closed = !!s.folder && data!.collapsed.includes(s.folder);
    const items = h('div', { class: view === 'grid' ? 'grid' : 'list' }, ...s.items.map((p) => (view === 'grid' ? tile(p) : row(p))));
    if (!hasFolders) return items;
    const name = s.folder || t('folder_none');
    const head = h('button', {
      class: 'folder-head', 'aria-expanded': String(!closed), 'data-folder': s.folder,
      onclick: () => { if (s.folder) void os.call('setCollapsed', s.folder, !closed).then(render); },
      oncontextmenu: (e: MouseEvent) => { e.preventDefault(); if (s.folder) folderMenu(s.folder, e.clientX, e.clientY); },
    }, s.folder ? icon(closed ? 'forward' : 'chevron', 18) : h('span', { class: 'ic', style: 'width:18px' }), icon('folder', 18), h('span', { class: 'grow' }, name), h('span', { class: 'n' }, String(s.items.length)));
    return h('section', { class: 'folder' + (closed ? ' closed' : '') }, head, closed ? null : items);
  }));
  const toggle = h('button', {
    class: 'icon-btn', id: 'view-toggle', 'aria-pressed': String(view === 'grid'),
    title: t(view === 'grid' ? 'profiles_view_list' : 'profiles_view_grid'), 'aria-label': t(view === 'grid' ? 'profiles_view_list' : 'profiles_view_grid'),
    onclick: () => void os.call('setView', view === 'grid' ? 'list' : 'grid').then(render),
  }, icon(view === 'grid' ? 'list' : 'grid'));
  app.replaceChildren(
    h('div', { class: 'top' },
      iconButton('incognito', `${t('dt_new_incognito_window')} (Ctrl+Shift+N)`, () => void os.call('incognito')),
      // Общий личный кабинет (экран делает отдельная сессия).
      h('a', { class: 'icon-btn', id: 'cabinet', href: 'os://cabinet/?all=1', title: t('cabinet'), 'aria-label': t('cabinet') }, icon('lock')),
      iconButton('settings', t('settings'), () => { location.href = 'os://settings/'; })),
    h('div', { class: 'hero' },
      svg(WORDMARK, 'wordmark'),
      h('div', { class: 'tagline' }, t('start_tagline')),
      h('div', { class: 'about' }, t('about_desc')),
      phrase ? h('div', { class: 'greet' }, phrase.greeting) : '',
      phrase?.phrase ? h('div', { class: 'phrase' }, phrase.phrase) : ''),
    h('div', { class: 'quick' },
      h('a', { class: 'pill', href: 'os://notes/', style: 'text-decoration:none;color:inherit' }, icon('note', 16), t('notes')),
      h('a', { class: 'pill', href: 'os://saved/', style: 'text-decoration:none;color:inherit' }, icon('saved', 16), t('saved_pages')),
      h('a', { class: 'pill', href: 'os://about/', style: 'text-decoration:none;color:inherit' }, icon('info2', 16), t('about'))),
    h('div', { class: 'row' }, h('h1', { class: 'grow' }, t('profiles')), toggle),
    h('div', { class: 'hint' }, t('dt_profiles_desc', list.length)),
    h('div', { class: 'hint' }, t('dt_reorder_hint')),
    body,
    list.length > shown.length || expanded
      ? h('button', { class: 'btn showall', onclick: () => { expanded = !expanded; void render(); } },
        expanded ? t('profiles_fewer') : t('profiles_all', list.length))
      : '',
  );
}

let dragId: number | null = null;

/** Перетаскивание — смена порядка профилей (в показанном порядке, закреплённые остаются сверху). */
function draggable(el: HTMLElement, p: ProfileInfo): void {
  el.addEventListener('dragstart', (e) => { dragId = p.id; el.classList.add('drag'); e.dataTransfer?.setData('text/plain', String(p.id)); });
  el.addEventListener('dragend', () => { dragId = null; el.classList.remove('drag'); document.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); });
  el.addEventListener('dragover', (e) => { if (dragId != null && dragId !== p.id) { e.preventDefault(); el.classList.add('over'); } });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragId == null || dragId === p.id || !data) return;
    const ids = data.list.map((x) => x.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(p.id), 0, dragId);
    dragId = null;
    void os.call('setOrder', ids).then(render);
  });
}

/** Общее у строки и плитки: открытие, меню (правая кнопка, клавиша меню), значки. */
function common(p: ProfileInfo): Record<string, unknown> {
  return {
    tabindex: '0', role: 'button', draggable: 'true', 'data-id': String(p.id),
    'aria-label': p.name + (p.current ? ` · ${t('profile_current')}` : '') + (p.pinned ? ` · ${t('profile_pinned')}` : ''),
    onclick: () => void os.call('openProfile', p.id),
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') void os.call('openProfile', p.id);
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); menu(p, r.left + 40, r.bottom); }
    },
    oncontextmenu: (e: MouseEvent) => { e.preventDefault(); menu(p, e.clientX, e.clientY); },
  };
}

const marks = (p: ProfileInfo) => [
  p.pinned ? h('span', { class: 'mark pin', title: t('profile_pinned') }, icon('pin', 14)) : null,
  p.current ? h('span', { class: 'mark cur', title: t('profile_current') }, icon('check', 16)) : null,
];

const gear = (p: ProfileInfo) => iconButton('settings', t('profile_settings'), (e) => { e.stopPropagation(); location.href = `os://profile/?id=${p.id}`; }, 'gear');

function row(p: ProfileInfo): HTMLElement {
  const extra = [p.description, p.files > 0 ? t('files_n', p.files) : ''].filter(Boolean).join(' · ');
  const pins = h('div', { class: 'pins' }, ...p.pins.map((pin) => {
    const isMail = pin.url.includes('mail.google.com');
    const label = isMail && p.unread > 0 ? `${pin.title} · ${p.unread > 999 ? '999+' : p.unread}` : pin.title;
    return h('button', {
      class: 'pill' + (isMail && p.unread > 0 ? ' hot' : ''),
      title: pin.url.startsWith('http') ? pin.url : t('start_page'),
      onclick: (e: MouseEvent) => { e.stopPropagation(); void os.call('openProfile', p.id, pin.id); },
    }, label);
  }));
  const el = h('div', { class: 'prow' + (p.current ? ' current' : ''), ...common(p) },
    h('span', { class: 'bar', style: `background:${p.color}` }),
    h('div', { class: 'info' },
      h('div', { class: 'name' }, ...marks(p).slice(0, 1), h('span', null, p.name), ...marks(p).slice(1)),
      h('div', { class: 'mail' }, p.email ?? t('not_signed_in')),
      extra ? h('div', { class: 'extra', title: extra }, extra) : null),
    p.active ? h('span', { class: 'live', title: t('dt_profile_open') }) : null,
    pins,
    gear(p),
    iconButton('more', t('menu'), (e) => { e.stopPropagation(); menu(p, e.clientX, e.clientY); }, 'more'));
  draggable(el, p);
  return el;
}

function tile(p: ProfileInfo): HTMLElement {
  const letter = (p.name.trim()[0] ?? '•').toUpperCase();
  const el = h('div', { class: 'ptile' + (p.current ? ' current' : ''), ...common(p) },
    h('div', { class: 'tile-top' },
      h('span', { class: 'avatar', style: `background:${p.color}` }, letter),
      h('span', { class: 'grow' }),
      ...marks(p),
      gear(p)),
    h('div', { class: 'name' }, p.name),
    h('div', { class: 'mail' }, p.email ?? t('not_signed_in')),
    p.unread > 0 ? h('span', { class: 'badge' }, p.unread > 999 ? '999+' : String(p.unread)) : null);
  draggable(el, p);
  return el;
}

/** Меню профиля: Открыть · Настройки профиля · Переименовать · Закрепить · В папку · Выше · Ниже · Выйти и очистить. */
function menu(p: ProfileInfo, x: number, y: number): void {
  const all = data?.list ?? [];
  const i = all.findIndex((q) => q.id === p.id);
  contextMenu(x, y, [
    { label: t('open'), icon: 'forward', run: () => void os.call('openProfile', p.id) },
    { label: t('profile_settings'), icon: 'settings', run: () => { location.href = `os://profile/?id=${p.id}`; } },
    { label: t('rename'), icon: 'edit', run: () => void rename(p) },
    { label: t(p.pinned ? 'profile_unpin' : 'profile_pin'), icon: 'pin', run: () => void os.call('setPinned', p.id, !p.pinned).then(render) },
    { label: t('folder_move'), icon: 'folder', run: () => folderPick(p, x, y) },
    i > 0 ? { label: t('move_up'), icon: 'up', run: () => void os.call('moveProfile', p.id, -1).then(render) } : null,
    i < all.length - 1 ? { label: t('move_down'), icon: 'chevron', run: () => void os.call('moveProfile', p.id, 1).then(render) } : null,
    null,
    { label: t('logout_clear'), icon: 'delete', danger: true, run: () => void clear(p) },
  ].filter((v, idx, arr) => v !== null || (idx > 0 && arr[idx - 1] !== null)));
}

/** «В папку»: существующая, новая или без папки. */
function folderPick(p: ProfileInfo, x: number, y: number): void {
  const folders = data?.folders ?? [];
  contextMenu(x, y, [
    ...folders.map((f) => ({ label: f, icon: p.folder === f ? 'check' : 'folder', run: () => void os.call('setFolder', p.id, f).then(render) })),
    { label: t('folder_new'), icon: 'add', run: async () => {
      const r = await promptDialog(t('folder_name'), [{ value: '', placeholder: t('folder_name') }]);
      if (r && r[0].trim()) await os.call('setFolder', p.id, r[0]);
      void render();
    } },
    p.folder ? { label: t('folder_none'), icon: 'close', run: () => void os.call('setFolder', p.id, '').then(render) } : null,
  ]);
}

function folderMenu(name: string, x: number, y: number): void {
  contextMenu(x, y, [
    { label: t('folder_rename'), icon: 'edit', run: async () => {
      const r = await promptDialog(t('folder_rename'), [{ value: name, placeholder: t('folder_name') }]);
      if (r && r[0].trim()) await os.call('renameFolder', name, r[0]);
      void render();
    } },
    { label: t('folder_delete'), icon: 'delete', danger: true, run: () => void os.call('removeFolder', name).then(render) },
  ]);
}

async function rename(p: ProfileInfo): Promise<void> {
  const res = await promptDialog(t('profile_name'), [{ value: p.name, placeholder: t('profile_name') }]);
  if (res && res[0].trim()) await os.call('renameProfile', p.id, res[0]);
  void render();
}

async function clear(p: ProfileInfo): Promise<void> {
  if (await confirmDialog(t('clear_q', p.name), t('clear_profile_msg'), t('clear'), true)) {
    await os.call('clearProfile', p.id);
    void render();
  }
}

os.on('changed', () => void render());
void boot(render);
