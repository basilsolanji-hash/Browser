import { boot, h, icon, iconButton, os, svg, t } from '../shared/ui';
import { WORDMARK } from '../shared/icons';
import { confirmDialog, contextMenu, promptDialog } from './common';
import type { ProfileInfo } from '../shared/types';

/** Экран профилей (MainActivity.kt): логотип, быстрые ссылки, профили — первые 5 и «Показать все». */
const VISIBLE = 5;
let expanded = false;
/** Фраза — новая при каждом открытии экрана, а не при каждой перерисовке. */
let phrase: { greeting: string; phrase: string } | null | undefined;
const app = document.getElementById('app')!;
app.className = 'wrap';

async function render(): Promise<void> {
  document.title = t('profiles');
  const { list } = await os.call<{ list: ProfileInfo[]; count: number }>('profiles');
  phrase ??= await os.call<{ greeting: string; phrase: string } | null>('phrase');
  const shown = expanded ? list : list.slice(0, VISIBLE);
  const rows = h('div', { class: 'list' }, ...shown.map((p) => row(p, list)));
  app.replaceChildren(
    h('div', { class: 'top' },
      iconButton('incognito', `${t('dt_new_incognito_window')} (Ctrl+Shift+N)`, () => void os.call('incognito')),
      iconButton('lock', t('cabinet'), () => { location.href = 'os://cabinet/'; }, 'cabinet-all'),
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
    h('h1', null, t('profiles')),
    h('div', { class: 'hint' }, t('dt_profiles_desc', list.length)),
    h('div', { class: 'hint' }, t('dt_reorder_hint')),
    rows,
    list.length > VISIBLE
      ? h('button', { class: 'btn showall', onclick: () => { expanded = !expanded; void render(); } },
        expanded ? t('profiles_fewer') : t('profiles_all', list.length))
      : '',
  );
}

let dragId: number | null = null;

function row(p: ProfileInfo, all: ProfileInfo[]): HTMLElement {
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
  const el = h('div', {
    class: 'prow', tabindex: '0', role: 'button', draggable: 'true', 'data-id': String(p.id),
    'aria-label': p.name,
    onclick: () => void os.call('openProfile', p.id),
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') void os.call('openProfile', p.id);
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { const r = el.getBoundingClientRect(); menu(p, all, r.left + 40, r.bottom); }
    },
    oncontextmenu: (e: MouseEvent) => { e.preventDefault(); menu(p, all, e.clientX, e.clientY); },
  },
  h('span', { class: 'bar', style: `background:${p.color}` }),
  h('div', { class: 'info' },
    h('div', { class: 'name' }, p.name),
    h('div', { class: 'mail' }, p.email ?? t('not_signed_in')),
    extra ? h('div', { class: 'extra', title: extra }, extra) : null),
  p.active ? h('span', { class: 'live', title: t('dt_profile_open') }) : null,
  pins,
  iconButton('more', t('menu'), (e) => { e.stopPropagation(); menu(p, all, e.clientX, e.clientY); }, 'more'));

  // Перетаскивание — смена порядка профилей.
  el.addEventListener('dragstart', (e) => { dragId = p.id; el.classList.add('drag'); e.dataTransfer?.setData('text/plain', String(p.id)); });
  el.addEventListener('dragend', () => { dragId = null; el.classList.remove('drag'); document.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); });
  el.addEventListener('dragover', (e) => { if (dragId != null && dragId !== p.id) { e.preventDefault(); el.classList.add('over'); } });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragId == null || dragId === p.id) return;
    const ids = all.map((x) => x.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(p.id), 0, dragId);
    dragId = null;
    void os.call('setOrder', ids).then(render);
  });
  return el;
}

function menu(p: ProfileInfo, all: ProfileInfo[], x: number, y: number): void {
  const i = all.findIndex((q) => q.id === p.id);
  contextMenu(x, y, [
    { label: t('open'), icon: 'forward', run: () => void os.call('openProfile', p.id) },
    { label: t('profile_info'), icon: 'edit', run: () => { location.href = `os://profile/?id=${p.id}`; } },
    { label: t('cabinet'), icon: 'lock', run: () => { location.href = `os://cabinet/?profile=${p.id}`; } },
    { label: t('rename'), icon: 'edit', run: () => void rename(p) },
    i > 0 ? { label: t('move_up'), icon: 'up', run: () => void os.call('moveProfile', p.id, -1).then(render) } : null,
    i < all.length - 1 ? { label: t('move_down'), icon: 'chevron', run: () => void os.call('moveProfile', p.id, 1).then(render) } : null,
    null,
    { label: t('logout_clear'), icon: 'delete', danger: true, run: () => void clear(p) },
  ].filter((x, idx, arr) => x !== null || (idx > 0 && arr[idx - 1] !== null)));
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
