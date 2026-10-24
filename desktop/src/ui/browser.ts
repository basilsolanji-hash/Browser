import { boot, h, icon, iconButton, os, svg, t, init } from '../shared/ui';
import { MARK } from '../shared/icons';
import type { ProfileInfo, StripTab, Suggestion, WindowState } from '../shared/types';

/**
 * Шапка браузера: верхний ряд (логотип, профиль, вкладки) и панель адреса. Выпадающие меню рисуются
 * здесь же: на время показа главный процесс растягивает шапку на всё окно (её фон прозрачный).
 */
const row1 = document.getElementById('row1')!;
const row2 = document.getElementById('row2')!;
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

function openDrop(el: HTMLElement, anchor: DOMRect, align: 'start' | 'end' = 'start', width?: number, focusFirst = true): void {
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
  closeDrop = () => {
    layer.hidden = true;
    layer.replaceChildren();
    closeDrop = null;
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
    hideDrop();
    if (editing) address?.blur();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && closeDrop && !editing) hideDrop();
  // Стрелки в меню — как в обычных меню Windows.
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && closeDrop && !editing) {
    const items = [...layer.querySelectorAll<HTMLButtonElement>('.menu button:not(:disabled)')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  }
});

interface Item { label?: string; icon?: string; kbd?: string; disabled?: boolean; run?: () => void; sep?: boolean; head?: string; el?: HTMLElement }

function menu(items: Item[]): HTMLElement {
  const box = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it.sep) box.append(h('div', { class: 'sep' }));
    else if (it.head) box.append(h('div', { class: 'head' }, it.head));
    else if (it.el) box.append(it.el);
    else {
      box.append(h('button', {
        role: 'menuitem',
        disabled: !!it.disabled,
        onclick: () => { hideDrop(); it.run?.(); },
      }, it.icon ? icon(it.icon) : h('span', { class: 'ic', style: 'width:20px' }), h('span', { class: 'grow' }, it.label ?? ''), it.kbd ? h('span', { class: 'kbd' }, it.kbd) : null));
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
  }, favicon(tab), h('span', { class: 'label' }, tab.pinned ? short(label, 18) : label));
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
    const strip = h('div', { id: 'strip', role: 'tablist' });
    const groups = new Map(st.groups.map((g) => [g.id, g]));
    let prevGroup: string | null = null;
    for (const tab of st.tabs) {
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
    nodes.push(strip);
    nodes.push(iconButton('add', `${t('new_tab')} (Ctrl+T)`, () => void os.call('newTab'), 'newtab'));
    nodes.push(h('div', { class: 'grow' }));
    if (st.profile) nodes.push(iconButton('tabs', `${t('tabs')} (Ctrl+Shift+A)`, () => void os.call('openPanel', `os://tabs/?profile=${st!.profile!.id}`), 'newtab'));
  } else {
    nodes.push(h('div', { class: 'title1' }, st.panelTitle || t('profiles')));
    nodes.push(h('div', { class: 'grow' }));
    nodes.push(iconButton('incognito', `${t('dt_new_incognito_window')} (Ctrl+Shift+N)`, () => void os.call('incognito'), 'newtab'));
  }
  if (init.platform === 'darwin') {
    // На macOS кнопки окна системные (слева), здесь ничего не добавляем.
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
  address = h('input', {
    id: 'address',
    type: 'text',
    spellcheck: false,
    autocomplete: 'off',
    'aria-label': t('address_hint'),
    placeholder: t('address_hint'),
    value: st.url ? host(st.url) : '',
    class: 'rest',
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
    void suggest(typed);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const s = suggestions[selected];
      const text = s && s.kind !== 'search' ? s.url : input.value;
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
      input.value = s ? (s.kind === 'search' ? s.title : s.url) : typed;
      paintSuggestions();
    }
  });
  const addr = h('div', { id: 'addr', onmousedown: (e: MouseEvent) => { if (e.target !== input) { e.preventDefault(); input.focus(); } } }, lock, input);
  const nodes: HTMLElement[] = [back, fwd, reload];
  if (!st.incognito) nodes.push(home);
  nodes.push(addr);
  if (st.zoom !== 100) nodes.push(h('button', { class: 'zoom', title: t('reset'), onclick: () => void os.call('zoom', 0) }, st.zoom + '%'));
  const more = iconButton('more', t('menu'), () => mainMenu(more.getBoundingClientRect()));
  nodes.push(more);
  row2.replaceChildren(...nodes);
  updateNavButtons();
}

function updateNavButtons(): void {
  if (!st) return;
  const b = row2.querySelector<HTMLButtonElement>('[data-k="back"]');
  const f = row2.querySelector<HTMLButtonElement>('[data-k="fwd"]');
  if (b) b.disabled = !st.canBack;
  if (f) f.disabled = !st.canForward;
}

async function suggest(text: string): Promise<void> {
  if (!text.trim()) {
    suggestions = [];
    selected = -1;
    if (closeDrop) hideDrop();
    return;
  }
  const list = await os.call<Suggestion[]>('suggest', text);
  if (!editing || text !== typed) return;
  suggestions = list;
  selected = -1;
  paintSuggestions();
}

function paintSuggestions(): void {
  const addr = document.getElementById('addr');
  if (!addr || !suggestions.length) return;
  const box = h('div', { class: 'menu sugg', role: 'listbox' });
  suggestions.forEach((s, i) => {
    const ic = s.kind === 'search' ? 'search' : s.kind === 'favorite' ? 'star' : s.kind === 'history' ? 'history' : 'globe';
    const label = s.kind === 'search' ? t('dt_search_for', s.title) : s.title;
    box.append(h('button', {
      class: i === selected ? 'sel' : '',
      role: 'option',
      tabindex: '-1',
      onmousedown: (e: MouseEvent) => {
        e.preventDefault();
        hideDrop();
        editing = false;
        address?.blur();
        void os.call('navigate', s.kind === 'search' ? s.title : s.url);
      },
    }, icon(ic), h('span', { class: 'grow' }, label, s.kind !== 'search' && s.title !== s.url ? h('span', { class: 'url' }, s.url) : null)));
  });
  if (closeDrop && layer.querySelector('.sugg')) {
    layer.querySelector('.sugg')!.replaceWith(box);
    box.classList.add('drop');
    const r = addr.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + 'px', top: r.bottom + 4 + 'px', width: r.width + 'px' });
    return;
  }
  const r = addr.getBoundingClientRect();
  openDrop(box, r, 'start', r.width, false);
}

function mainMenu(anchor: DOMRect): void {
  if (!st) return;
  const zoomRow = h('div', { class: 'zoomrow' },
    h('span', { class: 'lbl' }, t('zoom')),
    h('button', { title: '−', onclick: () => { void os.call('zoom', -1); } }, '−'),
    h('span', { class: 'val' }, st.zoom + '%'),
    h('button', { title: '+', onclick: () => { void os.call('zoom', 1); } }, '+'),
    h('button', { title: t('full_screen'), onclick: () => { hideDrop(); void os.call('fullscreen'); } }, icon('fullscreen', 18)),
  );
  const items: Item[] = [
    { label: t('new_tab'), icon: 'add', kbd: 'Ctrl+T', run: () => void os.call('newTab') },
    { label: t('dt_new_incognito_window'), icon: 'incognito', kbd: 'Ctrl+Shift+N', run: () => void os.call('incognito') },
  ];
  if (st.profile) {
    items.push(
      { label: t('tabs'), icon: 'tabs', kbd: 'Ctrl+Shift+A', run: () => void os.call('openPanel', `os://tabs/?profile=${st!.profile!.id}`) },
    );
  }
  items.push(
    { label: t('dt_reopen_closed'), icon: 'history', kbd: 'Ctrl+Shift+T', run: () => void os.call('reopen') },
    { sep: true },
    { el: zoomRow },
    { sep: true },
    { label: t('copy_link'), icon: 'globe', disabled: !st.url, run: () => void os.call('copy', st!.url) },
  );
  if (!st.incognito) {
    items.push(
      { sep: true },
      { label: t('profiles'), icon: 'person', run: () => void os.call('showHome') },
      { label: t('notes'), icon: 'note', run: () => void os.call('openPanel', 'os://notes/') },
      { label: t('about'), icon: 'info2', run: () => void os.call('openPanel', 'os://about/') },
      { label: t('settings'), icon: 'settings', run: () => void os.call('openPanel', 'os://settings/') },
    );
  }
  openDrop(menu(items), anchor, 'end');
}

function render(): void {
  renderRow1();
  renderRow2();
}

os.on('state', (s) => {
  st = s as WindowState;
  render();
});
os.on('focusAddress', () => {
  const el = document.getElementById('address') as HTMLInputElement | null;
  el?.focus();
});

void boot(async () => {
  document.title = incognito ? t('incognito') : 'Ось Browser';
  st = await os.call<WindowState>('state');
  render();
});
