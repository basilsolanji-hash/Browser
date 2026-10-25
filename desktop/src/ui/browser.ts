import { boot, h, icon, iconButton, os, svg, t } from '../shared/ui';
import { MARK } from '../shared/icons';
import type { ProfileInfo, StripTab, Suggestion, Tile, WindowState } from '../shared/types';

/**
 * Шапка браузера: верхний ряд (логотип, профиль, вкладки) и панель адреса. Выпадающие меню рисуются
 * здесь же: на время показа главный процесс растягивает шапку на всё окно (её фон прозрачный).
 */
const row1 = document.getElementById('row1')!;
const row2 = document.getElementById('row2')!;
const row3 = document.getElementById('row3')!;
const layer = document.getElementById('layer')!;
const incognito = new URLSearchParams(location.search).has('incognito');

let st: WindowState | null = null;
let editing = false; // в адресной строке идёт ввод — состояние не перетирает текст
let address: HTMLInputElement | null = null;
let suggestions: Suggestion[] = [];
let selected = -1;
let typed = '';
let dirty = false; // пользователь уже что-то ввёл в адресную строку

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

// --- Выпадающие меню ---

let closeDrop: (() => void) | null = null;

let onDismiss: (() => void) | null = null;

function openDrop(el: HTMLElement, anchor: DOMRect, align: 'start' | 'end' = 'start', width?: number, focusFirst = true, dismiss: (() => void) | null = null): void {
  hideDrop(false);
  layer.hidden = false;
  layer.replaceChildren(el);
  el.classList.add('drop');
  if (width) el.style.width = width + 'px';
  void os.call('overlay', true);
  const rtl = document.documentElement.dir === 'rtl';
  const place = () => {
    const w = el.offsetWidth;
    let x = (align === 'end') !== rtl ? anchor.right - w : anchor.left;
    x = Math.max(6, Math.min(x, window.innerWidth - w - 6));
    el.style.left = x + 'px';
    el.style.top = anchor.bottom + 4 + 'px';
  };
  place();
  requestAnimationFrame(place);
  onDismiss = dismiss;
  layer.classList.remove('through');
  closeDrop = () => {
    layer.hidden = true;
    layer.classList.remove('through');
    layer.replaceChildren();
    closeDrop = null;
    onDismiss = null;
  };
  if (focusFirst) el.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
}

function hideDrop(release = true): void {
  if (!closeDrop) return;
  closeDrop();
  if (release) void os.call('overlay', false);
}

layer.addEventListener('mousedown', (e) => {
  if (e.target === layer) {
    // Закрытый без ответа запрос разрешения — это «запретить» (как на Android).
    onDismiss?.();
    hideDrop();
    if (editing) address?.blur();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && closeDrop && !editing) { onDismiss?.(); hideDrop(); }
  // Стрелки в меню — как в обычных меню Windows.
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && closeDrop && !editing) {
    const items = [...layer.querySelectorAll<HTMLButtonElement>('.menu button:not(:disabled)')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  }
});

interface Item { k?: string; sub?: boolean; label?: string; icon?: string; kbd?: string; disabled?: boolean; checked?: boolean; run?: () => void; sep?: boolean; head?: string; el?: HTMLElement }

function menu(items: Item[]): HTMLElement {
  const box = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it.sep) box.append(h('div', { class: 'sep' }));
    else if (it.head) box.append(h('div', { class: 'head' }, it.head));
    else if (it.el) box.append(it.el);
    else {
      box.append(h('button', {
        'data-k': it.k ?? null,
        role: it.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
        'aria-checked': it.checked === undefined ? null : String(it.checked),
        disabled: !!it.disabled,
        // Подменю открывается на месте меню (без мигания шапки).
        onclick: () => { if (it.sub || it.k === 'back-menu') it.run?.(); else { hideDrop(); it.run?.(); } },
      }, it.icon ? icon(it.icon) : h('span', { class: 'ic', style: 'width:20px' }), h('span', { class: 'grow' }, it.label ?? ''),
      it.kbd ? h('span', { class: 'kbd' }, it.kbd) : null,
      it.checked ? h('span', { class: 'mark-cur' }, icon('check', 18)) : null,
      it.sub ? h('span', { class: 'kbd sub-arrow' }, icon('next', 18)) : null));
    }
  }
  return box;
}

// --- Верхний ряд ---

function favicon(tab: StripTab): HTMLElement {
  if (tab.loading) return h('span', { class: 'spin' });
  if (tab.favicon) return h('span', { class: 'fav', style: 'background:none' }, h('img', { src: tab.favicon, alt: '' }));
  if (!/^https?:/.test(tab.url)) return svg(MARK, 'fav start');
  const letter = host(tab.url).charAt(0).toUpperCase() || '•';
  return h('span', { class: 'fav' }, letter);
}

let dragId: string | null = null;

function tabEl(tab: StripTab, groups: Map<string, { name: string; color: string }>): HTMLElement {
  const active = st?.active === tab.id && !st?.panel;
  const label = tab.title || t('new_tab');
  const el = h('div', {
    class: `tab${tab.pinned ? ' pinned' : ''}${active ? ' active' : ''}`,
    role: 'tab',
    tabindex: '0',
    'aria-selected': String(active),
    title: label + (tab.url && /^https?:/.test(tab.url) ? '\n' + tab.url : ''),
    'data-id': tab.id,
    draggable: tab.pinned ? 'false' : 'true',
    onmousedown: (e: MouseEvent) => {
      if (e.button === 0 && !(e.target as HTMLElement).closest('.x')) void os.call('activate', tab.id);
    },
    onauxclick: (e: MouseEvent) => { if (e.button === 1) void os.call('closeTab', tab.id); },
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') void os.call('activate', tab.id); },
    oncontextmenu: (e: MouseEvent) => { e.preventDefault(); tabMenu(tab, el.getBoundingClientRect()); },
  }, favicon(tab), h('span', { class: 'label', dir: 'auto' }, tab.pinned ? short(label, 18) : label));
  if (!tab.pinned) {
    el.append(h('button', {
      class: 'x', title: t('close_tab'), 'aria-label': t('close_tab'),
      onclick: (e: MouseEvent) => { e.stopPropagation(); void os.call('closeTab', tab.id); },
    }, icon('close', 14)));
  }
  const g = tab.group ? groups.get(tab.group) : undefined;
  if (g) el.append(h('span', { class: 'grp', style: `background:${g.color}` }));
  if (!tab.pinned) {
    el.addEventListener('dragstart', (e) => {
      dragId = tab.id;
      el.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', tab.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => { dragId = null; render(); });
    el.addEventListener('dragover', (e) => {
      if (!dragId || dragId === tab.id) return;
      e.preventDefault();
      row1.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
      el.classList.add('drop-before');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragId || !st) return;
      const open = st.tabs.filter((x) => !x.pinned).map((x) => x.id);
      let to = open.indexOf(tab.id);
      if (open.indexOf(dragId) < to) to--;
      void os.call('moveTab', dragId, Math.max(0, to));
      dragId = null;
    });
  }
  return el;
}

function tabMenu(tab: StripTab, r: DOMRect): void {
  if (!st) return;
  const items: Item[] = [
    { label: t('refresh'), icon: 'refresh', run: () => { void os.call('activate', tab.id).then(() => os.call('reload')); } },
    { label: t('copy_link'), icon: 'globe', disabled: !/^https?:/.test(tab.url), run: () => void os.call('copy', tab.url) },
  ];
  if (!tab.pinned && !st.incognito) {
    items.push({ sep: true }, { head: t('add_to_group') });
    for (const g of st.groups) {
      const dot = h('span', { class: 'dot', style: `background:${g.color}` });
      items.push({
        el: h('button', { onclick: () => { hideDrop(); void os.call('setTabGroup', tab.id, g.id); } },
          dot, h('span', { class: 'grow' }, g.name), tab.group === g.id ? icon('check', 16) : null),
      });
    }
    items.push({ label: t('new_tab_group'), icon: 'add', run: () => void os.call('newGroupWith', tab.id) });
    if (tab.group) items.push({ label: t('ungroup'), icon: 'close', run: () => void os.call('setTabGroup', tab.id, null) });
  }
  items.push({ sep: true });
  items.push({ label: tab.pinned ? t('dt_reset_pinned') : t('close_tab'), icon: 'close', kbd: 'Ctrl+W', run: () => void os.call('closeTab', tab.id) });
  if (!tab.pinned && !st.incognito) items.push({ label: t('dt_close_others'), run: () => void os.call('closeOthers', tab.id) });
  items.push({ label: t('dt_reopen_closed'), icon: 'history', kbd: 'Ctrl+Shift+T', run: () => void os.call('reopen') });
  openDrop(menu(items), r);
}

async function profileMenu(anchor: DOMRect): Promise<void> {
  const list = await os.call<ProfileInfo[]>('profileList');
  const items: Item[] = [{ head: t('profiles') }];
  for (const p of list) {
    const cur = st?.profile?.id === p.id;
    items.push({
      el: h('button', { onclick: () => { hideDrop(); void os.call('openProfile', p.id); } },
        h('span', { class: 'dot', style: `background:${p.color}` }),
        h('span', { class: 'grow' }, p.name, h('span', { class: 'sub' }, p.email ? '  ' + p.email : '')),
        cur ? h('span', { class: 'mark-cur' }, icon('check', 16)) : null),
    });
  }
  items.push({ sep: true }, { label: t('dt_all_profiles'), icon: 'person', run: () => void os.call('showHome') });
  if (st?.profile) items.push({ label: t('profile_info'), icon: 'edit', run: () => void os.call('openPanel', `os://profile/?id=${st!.profile!.id}`) });
  openDrop(menu(items), anchor, 'start', 300);
}

function renderRow1(): void {
  if (!st) return;
  const nodes: HTMLElement[] = [];
  if (st.incognito) {
    nodes.push(h('div', { class: 'incog' }, icon('incognito', 18), t('incognito')));
  } else {
    nodes.push(h('button', { class: 'brand', title: t('profiles'), 'aria-label': t('profiles'), onclick: () => void os.call('showHome') }, svg(MARK, 'mark')));
  }
  if (st.profile) {
    const p = st.profile;
    const chip = h('button', {
      class: 'chip', title: p.name + (p.email ? '\n' + p.email : ''), 'aria-haspopup': 'menu',
      onclick: () => void profileMenu(chip.getBoundingClientRect()),
    }, h('span', { class: 'dot', style: `background:${p.color}` }), h('span', { class: 'name' }, p.name), icon('chevron', 16));
    nodes.push(chip);
  }
  if (st.profile || st.incognito) {
    // Закреплённые вкладки не прокручиваются и всегда видны (как в Chrome); листается только полоса обычных.
    const pinned = h('div', { id: 'pins', role: 'tablist' });
    const strip = h('div', { id: 'strip', role: 'tablist' });
    const groups = new Map(st.groups.map((g) => [g.id, g]));
    let prevGroup: string | null = null;
    for (const tab of st.tabs) {
      if (tab.pinned) { pinned.append(tabEl(tab, groups)); continue; }
      if (tab.group && tab.group !== prevGroup && groups.has(tab.group)) {
        const g = groups.get(tab.group)!;
        strip.append(h('span', {
          class: 'gchip', style: `background:${g.color}`, title: g.name,
          onclick: () => void os.call('openPanel', `os://tabs/?profile=${st!.profile!.id}`),
        }, g.name));
      }
      prevGroup = tab.group;
      strip.append(tabEl(tab, groups));
    }
    strip.addEventListener('wheel', (e) => { strip.scrollLeft += e.deltaY; }, { passive: true });
    if (pinned.childElementCount) nodes.push(pinned);
    nodes.push(strip);
    nodes.push(iconButton('add', `${t('new_tab')} (Ctrl+T)`, () => void os.call('newTab'), 'newtab'));
    nodes.push(h('div', { class: 'grow' }));
    if (st.profile) nodes.push(iconButton('tabs', `${t('tabs')} (Ctrl+Shift+A)`, () => void os.call('openPanel', `os://tabs/?profile=${st!.profile!.id}`), 'newtab'));
  } else {
    nodes.push(h('div', { class: 'title1' }, st.panelTitle || t('profiles')));
    nodes.push(h('div', { class: 'grow' }));
    nodes.push(iconButton('incognito', `${t('dt_new_incognito_window')} (Ctrl+Shift+N)`, () => void os.call('incognito'), 'newtab'));
  }
  row1.replaceChildren(...nodes);
  // Узкие вкладки — только значок (как в Chrome, когда вкладок много).
  requestAnimationFrame(() => {
    row1.querySelectorAll<HTMLElement>('.tab:not(.pinned)').forEach((el) => el.classList.toggle('narrow', el.offsetWidth < 90));
    row1.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

// --- Панель адреса ---

function renderRow2(): void {
  if (!st) return;
  const showBar = !!st.profile || st.incognito;
  row2.hidden = !showBar;
  if (!showBar) return;
  if (st.panel && st.profile) {
    row2.replaceChildren(
      iconButton('back', t('back'), () => void os.call('closePanel')),
      h('div', { class: 'panel-title' }, st.panelTitle),
      iconButton('close', `${t('close')} (Esc)`, () => void os.call('closePanel')),
    );
    address = null;
    return;
  }
  if (editing && address && row2.contains(address)) {
    // Пока ничего не введено, адрес следует за вкладкой (например, после Ctrl+T).
    if (!dirty && address.value !== st.url) {
      address.value = st.url;
      address.select();
    }
    updateNavButtons();
    return;
  }
  const back = iconButton('back', `${t('back')} (Alt+←)`, () => void os.call('back'));
  back.dataset.k = 'back';
  const fwd = iconButton('forward', `${t('forward')} (Alt+→)`, () => void os.call('forward'));
  fwd.dataset.k = 'fwd';
  const reload = iconButton(st.loading ? 'close' : 'refresh', st.loading ? t('dt_stop') : `${t('refresh')} (F5)`, () => void os.call(st?.loading ? 'stop' : 'reload'));
  reload.dataset.k = 'reload';
  const home = iconButton('home', `${t('home')} (Alt+Home)`, () => void os.call('home'));
  const lock = icon(st.url ? (st.secure ? 'lock' : 'info') : 'search', 16);
  if (st.secure) lock.classList.add('secure');
  lock.title = st.url ? (st.secure ? t('dt_secure') : t('dt_not_secure')) : '';
  // При вводе слева — кружок выбранного поисковика (как в Chrome), без фокуса — замок у HTTPS.
  const badge = engineBadge(st.engine);
  badge.hidden = true;
  const clear = iconButton('close', t('clear_text'), () => {
    input.value = '';
    typed = '';
    dirty = true;
    clear.hidden = true;
    void suggest('');
  }, 'addr-clear');
  clear.id = 'addr-clear';
  clear.hidden = true;
  clear.tabIndex = -1;
  address = h('input', {
    id: 'address',
    type: 'text',
    spellcheck: false,
    autocomplete: 'off',
    'aria-label': t('address_hint'),
    placeholder: t('address_hint'),
    value: st.url ? host(st.url) : '',
    class: 'rest',
    // Адрес всегда слева направо (как в Chrome на арабском), подсказка — по языку.
    dir: 'auto',
  });
  const input = address;
  // Как в Chrome: по фокусу — полный адрес, выделенный целиком (и щелчок мышью выделение не снимает).
  let justFocused = false;
  input.addEventListener('focus', () => {
    editing = true;
    dirty = false;
    justFocused = true;
    input.value = st?.url ?? '';
    input.classList.remove('rest');
    input.select();
    lock.hidden = true;
    badge.hidden = false;
    clear.hidden = !input.value;
    typed = '';
    void suggest('');
  });
  input.addEventListener('mouseup', (e) => {
    if (justFocused && input.selectionStart === input.selectionEnd) e.preventDefault();
    justFocused = false;
  });
  input.addEventListener('keydown', () => { justFocused = false; });
  input.addEventListener('blur', () => {
    editing = false;
    if (closeDrop && layer.querySelector('.sugg')) hideDrop();
    setTimeout(() => { if (!editing) render(); }, 0);
  });
  input.addEventListener('input', () => {
    dirty = true;
    typed = input.value;
    clear.hidden = !input.value;
    void suggest(typed);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const s = suggestions[selected];
      const text = s ? target(s) : input.value;
      hideDrop();
      editing = false;
      input.blur();
      if (text.trim()) void os.call('navigate', text);
    } else if (e.key === 'Escape') {
      hideDrop();
      input.value = st?.url ?? '';
      input.blur();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggestions.length) {
      e.preventDefault();
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length + 1) % (suggestions.length + 1);
      if (selected === suggestions.length) selected = -1;
      const s = suggestions[selected];
      input.value = s ? fillText(s) : typed;
      paintSuggestions();
    }
  });
  const addr = h('div', { id: 'addr', onmousedown: (e: MouseEvent) => { if (e.target !== input && !clear.contains(e.target as Node)) { e.preventDefault(); input.focus(); } } }, lock, badge, input, clear);
  clear.addEventListener('mousedown', (e) => e.preventDefault());
  const nodes: HTMLElement[] = [back, fwd, reload];
  if (!st.incognito) nodes.push(home);
  nodes.push(addr);
  if (st.blocked > 0) {
    addr.append(h('span', { class: 'shield', id: 'shield', title: t('dt_blocked_n', st.blocked) }, icon('lock', 13), String(st.blocked)));
  }
  if (!st.panel && st.url && /^https?:/.test(st.url)) {
    const star = iconButton('star', `${st.bookmarked ? t('fav_remove') : t('add_favorite')} (Ctrl+D)`, () => void os.call('toggleBookmark'), st.bookmarked ? 'on' : 'off');
    star.id = 'star';
    addr.append(star);
  }
  if (st.zoom !== 100) nodes.push(h('button', { class: 'zoom', title: t('reset'), onclick: () => void os.call('zoom', 0) }, st.zoom + '%'));
  const tb = toolbarItem(st);
  if (tb) nodes.push(tb);
  const more = iconButton('more', t('menu'), () => mainMenu(more.getBoundingClientRect()));
  more.id = 'more';
  nodes.push(more);
  row2.replaceChildren(...nodes);
  updateNavButtons();
}

/** Настраиваемая кнопка справа от адресной строки (по умолчанию — «Скачанные файлы»). */
function toolbarItem(s: WindowState): HTMLElement | null {
  const id = s.profile?.id;
  const web = /^https?:/.test(s.url);
  const items: Record<string, [string, string, (() => void) | null]> = {
    downloads: ['download', t('dl_title'), () => void os.call('openPanel', 'os://downloads/')],
    clear: ['delete', t('clear_short'), id != null ? () => void os.call('openPanel', `os://clear/?profile=${id}`) : null],
    favorites: ['star', t('favorites'), () => void os.call('openPanel', 'os://favorites/')],
    tabs: ['tabs', t('tabs'), id != null ? () => void os.call('openPanel', `os://tabs/?profile=${id}`) : null],
    notes: ['note', t('notes'), () => void os.call('openPanel', 'os://notes/')],
    saved: ['saved', t('saved_pages'), () => void os.call('openPanel', 'os://saved/')],
    share: ['share', t('share'), web ? () => shareMenu(document.getElementById('tb-btn')!.getBoundingClientRect()) : null],
    find: ['search', t('find_in_page'), web ? () => void os.call('findOpen') : null],
  };
  const [name, label, run] = items[s.toolbarButton] ?? items.downloads;
  // Как в Chrome: кнопка загрузок появляется после первой загрузки.
  if (s.toolbarButton === 'downloads' && !s.hasDownloads) return null;
  if (s.incognito && !['downloads', 'share', 'find'].includes(s.toolbarButton)) return null;
  const b = iconButton(name, label, () => run?.());
  b.id = 'tb-btn';
  b.dataset.k = s.toolbarButton;
  b.disabled = !run;
  return b;
}

function updateNavButtons(): void {
  if (!st) return;
  const b = row2.querySelector<HTMLButtonElement>('[data-k="back"]');
  const f = row2.querySelector<HTMLButtonElement>('[data-k="fwd"]');
  if (b) b.disabled = !st.canBack;
  if (f) f.disabled = !st.canForward;
}

const ENGINE_BADGES: Record<string, [string, string]> = {
  ddg: ['D', '#DE5833'], startpage: ['S', '#6573FF'], brave: ['B', '#FB542B'],
  google: ['G', '#4285F4'], bing: ['B', '#008373'], yandex: ['Я', '#FC3F1D'],
};

function engineBadge(id: string): HTMLElement {
  const [letter, color] = ENGINE_BADGES[id] ?? ENGINE_BADGES.ddg;
  return h('span', { class: 'engine', id: 'engine', 'data-engine': id, style: `background:${color}`, 'aria-hidden': 'true' }, letter);
}

/** Буква сайта в кружке — значки сайтов в панели из сети не грузим. */
const letterOf = (url: string) => h('span', { class: 'letter', 'aria-hidden': 'true' }, (host(url).charAt(0) || '•').toUpperCase());

/** Что открыть по подсказке: запрос — поиском, остальное — адресом. */
const target = (s: Suggestion) => (s.kind === 'search' || s.kind === 'query' ? s.title : s.url);
/** Что подставить в строку по стрелке ↖. */
const fillText = (s: Suggestion) => (s.kind === 'search' || s.kind === 'query' ? s.title : s.url);

let tiles: Tile[] = [];

/** Пустой ввод — карточка страницы и частые сайты, при вводе — подсказки (AddressPanel.kt). */
async function suggest(text: string): Promise<void> {
  if (!text.trim() || text === st?.url) {
    suggestions = [];
    selected = -1;
    tiles = await os.call<Tile[]>('frequent');
    if (!editing || (text !== typed && typed !== '')) return;
    paintSuggestions();
    return;
  }
  const list = await os.call<Suggestion[]>('suggest', text);
  if (!editing || text !== typed) return;
  suggestions = list;
  selected = -1;
  paintSuggestions();
}

function go(text: string): void {
  hideDrop();
  editing = false;
  address?.blur();
  if (text.trim()) void os.call('navigate', text);
}

/** Кнопка в панели: фокус остаётся в адресной строке. */
const keep = (cls: string, name: string, label: string, run: () => void) =>
  h('button', { class: 'icon-btn ' + cls, title: label, 'aria-label': label, tabindex: '-1',
    onmousedown: (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); run(); } }, icon(name, 18));

function pageCard(): HTMLElement | null {
  if (!st || !/^https?:/.test(st.url)) return null;
  const url = st.url;
  return h('div', { class: 'pagecard' },
    letterOf(url),
    h('span', { class: 'grow' }, h('span', { class: 'ttl', dir: 'auto' }, st.title || host(url)), h('span', { class: 'url', dir: 'ltr' }, url)),
    keep('pc-share', 'share', t('share'), () => { const r = document.getElementById('addr')!.getBoundingClientRect(); address?.blur(); shareMenu(r); }),
    keep('pc-copy', 'link', t('copy_link'), () => { void os.call('copy', url); toast(t('link_copied')); }),
    keep('pc-edit', 'edit', t('edit_address'), () => {
      if (!address) return;
      address.value = url;
      address.setSelectionRange(url.length, url.length);
    }));
}

function paintSuggestions(): void {
  const addr = document.getElementById('addr');
  if (!addr || !editing) return;
  const box = h('div', { class: 'menu sugg addr-panel', role: 'listbox', 'aria-label': t('address_hint') });
  if (!suggestions.length) {
    const card = pageCard();
    if (card) box.append(card);
    if (tiles.length) {
      box.append(h('div', { class: 'tiles' }, ...tiles.map((x) => h('button', {
        class: 'tile', title: x.host, tabindex: '-1',
        onmousedown: (e: MouseEvent) => { e.preventDefault(); go(x.url); },
      }, letterOf(x.url), h('span', { class: 'lbl' }, x.label)))));
    }
    if (!box.childElementCount) { if (layer.querySelector('.sugg')) hideDrop(); return; }
  } else {
    const list = h('div', { class: 'hints' });
    suggestions.forEach((s, i) => {
      const ic = s.kind === 'search' || s.kind === 'query' ? 'search' : s.kind === 'favorite' ? 'star' : s.kind === 'history' ? 'history' : 'globe';
      const label = s.kind === 'search' ? t('dt_search_for', s.title) : s.title;
      const row = h('div', {
        class: 'hint-row' + (i === selected ? ' sel' : ''),
        role: 'option',
        'aria-selected': String(i === selected),
        'data-kind': s.kind,
        onmousedown: (e: MouseEvent) => { e.preventDefault(); go(target(s)); },
      }, icon(ic), h('span', { class: 'grow' }, h('span', { class: 'ttl', dir: 'auto' }, label),
        s.kind !== 'search' && s.kind !== 'query' && s.title !== s.url ? h('span', { class: 'url', dir: 'ltr' }, s.url) : null));
      if (i > 0) {
        row.append(keep('fill', 'fill', t('fill_in'), () => {
          if (!address) return;
          address.value = fillText(s);
          typed = address.value;
          dirty = true;
          void suggest(typed);
        }));
      }
      list.append(row);
    });
    box.append(list);
  }
  const r = addr.getBoundingClientRect();
  const old = layer.querySelector('.sugg');
  if (closeDrop && old) {
    old.replaceWith(box);
    box.classList.add('drop');
    Object.assign(box.style, { left: r.left + 'px', top: r.bottom + 4 + 'px', width: r.width + 'px' });
    return;
  }
  openDrop(box, r, 'start', r.width, false);
  // Подсказки не закрывают шапку: щелчок по строке адреса или кнопкам проходит сквозь слой.
  layer.classList.add('through');
}

/** Меню ⋮ как в Chrome (BrowserMenu.kt): ряд круглых кнопок сверху, ниже группы пунктов через линию. */
function mainMenu(anchor: DOMRect): void {
  if (!st) return;
  void os.call('refreshDefault');
  const web = /^https?:/.test(st.url);
  const id = st.profile?.id;
  const panel = (url: string) => () => void os.call('openPanel', url);
  const round = (name: string, label: string, run: () => void, enabled = true, on?: boolean) => {
    const b = iconButton(name, label, () => { hideDrop(); run(); }, 'round' + (on ? ' on' : ''));
    b.disabled = !enabled;
    b.setAttribute('role', 'menuitem');
    if (on !== undefined) b.setAttribute('aria-pressed', String(on));
    return b;
  };
  const top = h('div', { class: 'toprow' },
    round('back', t('back'), () => void os.call('back'), st.canBack),
    round('forward', t('forward'), () => void os.call('forward'), st.canForward),
    round('star', st.bookmarked ? t('fav_remove') : t('add_favorite'), () => void os.call('toggleBookmark'), web && !st.incognito, st.bookmarked),
    round('savepage', t('save_page'), () => void os.call('savePage'), web),
    round('refresh', t('refresh'), () => void os.call('reload'), !!st.url));
  const zoomRow = h('div', { class: 'zoomrow' },
    icon('zoom'),
    h('span', { class: 'lbl' }, t('zoom')),
    h('button', { title: '−', 'aria-label': t('zoom') + ' −', onclick: () => { void os.call('zoom', -1); } }, '−'),
    h('span', { class: 'val' }, st.zoom + '%'),
    h('button', { title: '+', 'aria-label': t('zoom') + ' +', onclick: () => { void os.call('zoom', 1); } }, '+'),
  );
  const groups: Item[][] = [];
  groups.push([
    { label: t('new_tab'), icon: 'add', kbd: 'Ctrl+T', run: () => void os.call('newTab') },
    { label: t('dt_new_incognito_window'), icon: 'incognito', kbd: 'Ctrl+Shift+N', run: () => void os.call('incognito') },
    ...(id != null ? [{ k: 'group', label: t('new_tab_group'), icon: 'group', run: panel(`os://tabs/?profile=${id}&new=group`) }] : []),
  ]);
  if (id != null) {
    groups.push([
      { label: t('history'), icon: 'history', kbd: 'Ctrl+H', run: panel(`os://history/?profile=${id}`) },
      { label: t('clear_title'), icon: 'delete', kbd: 'Ctrl+Shift+Del', run: panel(`os://clear/?profile=${id}`) },
      { label: t('site_permissions'), icon: 'shield', disabled: !web, run: panel(`os://site/?profile=${id}&host=${encodeURIComponent(host(st.url))}`) },
    ]);
    groups.push([
      { k: 'cabinet', label: t('cabinet'), icon: 'account', run: panel(`os://cabinet/?profile=${id}`) },
      { label: t('dl_title'), icon: 'download', kbd: 'Ctrl+J', run: panel('os://downloads/') },
      { label: t('favorites'), icon: 'star', kbd: 'Ctrl+Shift+O', run: panel('os://favorites/') },
      { label: t('tabs'), icon: 'tabs', kbd: 'Ctrl+Shift+A', run: panel(`os://tabs/?profile=${id}`) },
    ]);
  } else {
    groups.push([{ label: t('dl_title'), icon: 'download', kbd: 'Ctrl+J', run: panel('os://downloads/') }]);
  }
  groups.push([
    { el: zoomRow },
    { label: t('find_in_page'), icon: 'search', kbd: 'Ctrl+F', disabled: !web, run: () => void os.call('findOpen') },
    { label: st.reader ? t('reader_exit') : t('reader_mode'), icon: 'book', kbd: 'Ctrl+Alt+R', disabled: !web, run: () => void os.call('reader') },
    { label: st.fullscreen ? t('exit_full_screen') : t('full_screen'), icon: 'fullscreen', kbd: 'F11', run: () => void os.call('fullscreen') },
    { k: 'more-tools', label: t('dt_more_tools'), icon: 'more', sub: true, run: () => moreTools(anchor, web, id) },
  ]);
  if (!st.incognito) {
    groups.push([
      { label: t('settings'), icon: 'settings', run: panel('os://settings/') },
      { label: t('help_feedback'), icon: 'help', run: panel('os://help/') },
      ...(st.lockEnabled ? [{ label: t('dt_lock_now'), icon: 'lock', run: () => void os.call('lockNow') }] : []),
    ]);
    if (!st.isDefault) groups.push([{ label: t('default_make'), icon: 'globe', run: () => void os.call('makeDefault') }]);
  }
  const items: Item[] = [{ el: top }];
  for (const g of groups) items.push({ sep: true }, ...g);
  const box = menu(items);
  box.classList.add('main-menu');
  openDrop(box, anchor, 'end');
}

/** «Другие инструменты ▸» (как в Chrome): редкие пункты, чтобы меню влезало на экран ноутбука. */
function moreTools(anchor: DOMRect, web: boolean, id: number | undefined): void {
  const items: Item[] = [
    { k: 'back-menu', label: t('dt_more_tools'), icon: 'back', run: () => mainMenu(anchor) },
    { sep: true },
    ...(id != null ? [
      { label: t('saved_pages'), icon: 'saved', run: () => void os.call('openPanel', 'os://saved/') },
      { label: t('notes'), icon: 'note', run: () => void os.call('openPanel', 'os://notes/') },
      { sep: true },
    ] : []),
    { k: 'share', label: t('share'), icon: 'share', disabled: !web, run: () => shareMenu(anchor) },
    { label: t('copy_link'), icon: 'link', disabled: !web, run: () => { void os.call('copy', st!.url); toast(t('link_copied')); } },
    { label: t('open_external'), icon: 'external', disabled: !web, run: () => void browsersMenu(anchor) },
    { k: 'mobile', label: t('dt_mobile_site'), icon: 'phone', disabled: !web, checked: !!st?.mobile, run: () => void os.call('mobileSite') },
    { label: t('dt_print'), icon: 'file', kbd: 'Ctrl+P', disabled: !web, run: () => void os.call('print') },
    { sep: true },
    { k: 'diag', label: t('diagnostics'), icon: 'bug', run: () => void diagnostics(anchor) },
  ];
  const box = menu(items);
  box.classList.add('main-menu');
  openDrop(box, anchor, 'end');
}

function shareMenu(anchor: DOMRect): void {
  openDrop(menu([
    { head: t('share') },
    { label: t('copy_link'), icon: 'link', run: () => { void os.call('copy', st!.url); toast(t('link_copied')); } },
    { label: t('dt_share_mail'), icon: 'mail', run: () => void os.call('shareMail') },
  ]), anchor, 'end', 280);
}

async function browsersMenu(anchor: DOMRect): Promise<void> {
  const list = await os.call<{ name: string; exe: string }[]>('otherBrowsers');
  const items: Item[] = [{ head: t('open_external') }];
  if (list.length) items.push(...list.map((b) => ({ label: b.name, icon: 'globe', run: () => void os.call('openInBrowser', b.exe) })));
  else if (document.documentElement.dataset.platform === 'win32') items.push({ label: t('dt_no_other_browsers'), disabled: true });
  else items.push({ label: t('open_external'), icon: 'external', run: () => void os.call('openInBrowser', null) });
  openDrop(menu(items), anchor, 'end', 300);
}

async function diagnostics(anchor: DOMRect): Promise<void> {
  const text = await os.call<string>('diagnostics');
  const card = h('div', { class: 'menu diag', role: 'dialog', 'aria-label': t('diagnostics') },
    h('div', { class: 'head' }, t('diagnostics')),
    h('pre', { id: 'diag-text', tabindex: '0' }, text),
    h('div', { class: 'perm-actions' },
      h('button', { class: 'pbtn', onclick: () => hideDrop() }, t('close')),
      h('button', { class: 'pbtn accent', onclick: () => { void os.call('copy', text); hideDrop(); toast(t('copied')); } }, t('copy'))));
  openDrop(card, anchor, 'end', 460, false);
}

let shownPrompt = 0;

/** Запрос разрешения сайта: карточка под адресной строкой. */
function renderPrompt(): void {
  const p = st?.prompt;
  if (!p) {
    if (shownPrompt && layer.querySelector('.perm-card')) hideDrop();
    shownPrompt = 0;
    return;
  }
  if (p.id === shownPrompt) return;
  const addr = document.getElementById('addr');
  if (!addr) return;
  shownPrompt = p.id;
  const remember = h('input', { type: 'checkbox', id: 'perm-remember', checked: true, disabled: !p.canRemember });
  const answer = (allow: boolean) => { hideDrop(); void os.call('permissionAnswer', p.id, allow, remember.checked); };
  const card = h('div', { class: 'menu perm-card', role: 'dialog', 'aria-label': p.text },
    h('div', { class: 'perm-text' }, p.text),
    h('label', { class: 'perm-rem' }, remember, p.canRemember ? t('perm_remember') : t('perm_private_note')),
    h('div', { class: 'perm-actions' },
      h('button', { class: 'pbtn', id: 'perm-block', onclick: () => answer(false) }, t('perm_block')),
      h('button', { class: 'pbtn accent', id: 'perm-allow', onclick: () => answer(true) }, t('perm_allow'))));
  const r = addr.getBoundingClientRect();
  openDrop(card, new DOMRect(r.left + 8, r.top, 360, r.height), 'start', 360, false, () => void os.call('permissionAnswer', p.id, false, false));
}

/** Строка «Найти на странице» (Ctrl+F): ввод ищет сразу, Enter — дальше, Shift+Enter — назад, Esc — закрыть. */
function renderFind(): void {
  const f = st?.find;
  row3.hidden = !f;
  if (!f) { row3.replaceChildren(); return; }
  const count = f.text ? (f.matches ? t('dt_find_count', f.active, f.matches) : t('dt_find_none')) : '';
  let input = document.getElementById('find') as HTMLInputElement | null;
  if (!input) {
    input = h('input', { id: 'find', type: 'search', spellcheck: false, placeholder: t('dt_find_hint'), 'aria-label': t('dt_find') });
    const el = input;
    el.value = f.text;
    el.addEventListener('input', () => void os.call('find', el.value, true, false));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); void os.call('find', el.value, !e.shiftKey, true); }
      if (e.key === 'Escape') { e.preventDefault(); void os.call('findClose'); }
    });
    row3.replaceChildren(icon('search', 16), el, h('span', { class: 'find-count', id: 'find-count', role: 'status' }),
      iconButton('up', `${t('dt_find_prev')} (Shift+Enter)`, () => void os.call('find', el.value, false, true)),
      iconButton('chevron', `${t('dt_find_next')} (Enter)`, () => void os.call('find', el.value, true, true)),
      iconButton('close', `${t('close')} (Esc)`, () => void os.call('findClose')));
  }
  input.classList.toggle('none', !!f.text && f.matches === 0);
  document.getElementById('find-count')!.textContent = count;
}

function render(): void {
  renderRow1();
  renderRow2();
  renderFind();
  renderPrompt();
}

let booted = false;
os.on('state', (s) => {
  st = s as WindowState;
  // Состояние может прийти раньше переводов (boot) — тогда отрисуем после загрузки.
  if (booted) render();
});
let toastTimer = 0;
os.on('toast', (text) => toast(String(text)));

function toast(text: string): void {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(el);
  // Тост живёт внизу шапки: на время показа шапка не растягивается, поэтому он — под адресной строкой справа.
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 2600);
}
os.on('focusFind', () => {
  const el = document.getElementById('find') as HTMLInputElement | null;
  if (el) { el.focus(); el.select(); } else setTimeout(() => (document.getElementById('find') as HTMLInputElement | null)?.focus(), 50);
});
os.on('focusAddress', () => {
  const el = document.getElementById('address') as HTMLInputElement | null;
  el?.focus();
});

void boot(async () => {
  document.title = incognito ? t('incognito') : 'Ось Browser';
  st = await os.call<WindowState>('state');
  booted = true;
  render();
});
