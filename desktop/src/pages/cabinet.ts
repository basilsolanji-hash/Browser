import { boot, h, icon, iconButton, os, t } from '../shared/ui';
import { confirmDialog, contextMenu, modal, param, toast } from './common';
import type { ProfileInfo } from '../shared/types';
import { MAX_LEN, MIN_LEN, STRENGTH_KEYS, backupPasswordOk, generate, strength } from '../shared/pwgen';

/**
 * Личный кабинет профиля (AccountActivity.kt): пароли (зашифрованы ключом Windows), наборы вкладок,
 * ссылки на данные профиля и резервная копия в файл. Показ и копирование пароля — после Windows Hello.
 * Без профиля (?profile=0) — общий кабинет «Все профили»: сводка, поиск по всем паролям, копия всех профилей.
 */
interface LoginInfo { g: string; o: string; u: string; t: number }
interface Cabinet {
  profile: ProfileInfo;
  logins: LoginInfo[];
  offer: boolean;
  never: string[];
  crypto: boolean;
  sets: { id: string; name: string; time: number; count: number }[];
  open: number;
}
type Restored = { passwords: number; tabSets: number; favorites: number; notes: number };

const app = document.getElementById('app')!;
app.className = 'wrap cab';
const id = Number(param('profile') ?? param('id') ?? 0) || 0;
const host = (o: string) => { try { return new URL(o).hostname; } catch { return o; } };

/** Переключатель: «Все профили» и каждый профиль (цветной кружок и имя). */
function chips(list: ProfileInfo[]): HTMLElement {
  const chip = (label: string, color: string | null, pid: number) => h('button', {
    class: 'chip' + (pid === id ? ' on' : ''), 'data-profile': String(pid), 'aria-pressed': String(pid === id),
    onclick: () => { if (pid !== id) location.href = `os://cabinet/?profile=${pid}`; },
  }, color ? h('span', { class: 'dot', style: `background:${color}` }) : null, label);
  return h('div', { class: 'chips', role: 'group' }, chip(t('all_profiles'), null, 0), ...list.map((p) => chip(p.name, p.color, p.id)));
}

async function render(): Promise<void> {
  const { list } = await os.call<{ list: ProfileInfo[] }>('profiles');
  document.title = t('cabinet');
  const head = [h('h1', null, t('cabinet')), chips(list)];
  if (id === 0) return renderAll(head);
  const c = await os.call<Cabinet>('cabinet', id);
  const p = c.profile;
  const sub = [p.email, p.description].filter(Boolean).join(' · ');
  app.replaceChildren(
    ...head,
    h('div', { class: 'card who' }, h('span', { class: 'bar', style: `background:${p.color}` }),
      h('div', { class: 'grow' }, h('div', { class: 'name' }, p.name), sub ? h('div', { class: 'sub' }, sub) : null)),
    h('div', { class: 'hint' }, t('dt_cabinet_desc')),

    // --- Пароли ---
    h('h2', null, `${t('passwords')} · ${c.logins.length}`),
    c.crypto ? '' : h('div', { class: 'hint warn' }, t('dt_pw_no_crypto')),
    c.logins.length
      ? h('div', { class: 'card', id: 'pw-list' }, ...c.logins.map((l) => h('div', {
        class: 'setting login', 'data-g': l.g, tabindex: '0',
        oncontextmenu: (e: MouseEvent) => { e.preventDefault(); loginMenu(l, e.clientX, e.clientY); },
        onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); loginMenu(l, r.left + 40, r.bottom); } },
      }, icon('globe'), h('div', { class: 'label' }, h('div', { class: 'site', dir: 'ltr' }, host(l.o)), h('div', { class: 'sub' }, l.u || '—')),
      iconButton('more', t('menu'), (e) => loginMenu(l, e.clientX, e.clientY), 'login-menu'))))
      : h('div', { class: 'hint' }, t('passwords_empty')),
    h('div', { class: 'row actions-row' },
      h('button', { class: 'btn', id: 'pw-add', disabled: !c.crypto, onclick: () => void editLogin(null) }, icon('add', 18), t('password_add')),
      h('button', { class: 'btn', id: 'pw-gen', onclick: () => generator() }, icon('lock', 18), t('pw_generator')),
      h('div', { class: 'grow' }),
      h('div', { class: 'seg', id: 'pw-offer', role: 'group' },
        h('button', { class: c.offer ? 'on' : '', 'aria-pressed': String(c.offer), onclick: () => void os.call('pwOffer', true) }, t('pw_offer_on')),
        h('button', { class: c.offer ? '' : 'on', 'aria-pressed': String(!c.offer), onclick: () => void os.call('pwOffer', false) }, t('pw_offer_off')))),
    c.never.length ? h('div', { class: 'hint' }, t('never_sites')) : '',
    c.never.length
      ? h('div', { class: 'card', id: 'never-list' }, ...c.never.map((s) => h('div', { class: 'setting never', 'data-host': s },
        h('div', { class: 'label', dir: 'ltr' }, s),
        iconButton('delete', t('delete'), () => void os.call('pwNever', id, s, false)))))
      : '',
    h('div', { class: 'hint' }, t('dt_passwords_local')),

    // --- Наборы вкладок ---
    h('h2', null, t('tab_sets')),
    h('button', { class: 'btn', id: 'set-save', onclick: () => void saveSet() }, icon('tabs', 18), t('tab_set_save', c.open)),
    c.sets.length
      ? h('div', { class: 'card', id: 'set-list', style: 'margin-top:10px' }, ...c.sets.map((s) => h('div', { class: 'setting set', 'data-id': s.id },
        icon('tabs'),
        h('div', { class: 'label' }, h('div', null, s.name), h('div', { class: 'sub' }, `${t('tabs_n', s.count)} · ${new Date(s.time).toLocaleString()}`)),
        h('button', { class: 'btn set-open', onclick: () => void os.call('tabSetOpen', id, s.id) }, t('open')),
        iconButton('delete', t('delete'), async () => {
          if (await confirmDialog(t('delete') + '?', s.name, t('delete'), true)) void os.call('tabSetRemove', id, s.id);
        }, 'set-delete'))))
      : h('div', { class: 'hint' }, t('tab_set_empty')),

    // --- Мои данные ---
    h('h2', null, t('my_data')),
    h('div', { class: 'card links' },
      link('star', t('favorites'), 'os://favorites/'),
      link('saved', t('dl_title'), 'os://downloads/'),
      link('note', t('notes'), 'os://notes/'),
      link('file', t('saved_pages'), 'os://saved/'),
      link('person', t('profile_settings'), `os://profile/?id=${id}`)),

    // --- Резервная копия ---
    h('h2', null, t('backup')),
    h('div', { class: 'row actions-row' },
      h('button', { class: 'btn', id: 'backup-export', onclick: () => void exportBackup() }, icon('saved', 18), t('backup_export')),
      h('button', { class: 'btn', id: 'backup-import', onclick: () => void importBackup() }, icon('history', 18), t('backup_import'))),
    h('div', { class: 'hint' }, t('dt_backup_desc')),
    h('div', { class: 'hint', id: 'backup-warning' }, t('dt_backup_warning')),
    h('div', { class: 'hint', id: 'backup-warning' }, t('dt_backup_warning')),
  );
}

function link(ic: string, label: string, href: string): HTMLElement {
  return h('a', { class: 'setting link', href }, icon(ic), h('div', { class: 'label' }, label), icon('forward', 18));
}

function loginMenu(l: LoginInfo, x: number, y: number, pid = id): void {
  contextMenu(x, y, [
    { label: t('password_show'), icon: 'lock', run: () => void showPassword(l, pid) },
    { label: t('copy_login'), icon: 'person', run: () => void copy(l, 'login', pid) },
    { label: t('copy_password'), icon: 'lock', run: () => void copy(l, 'password', pid) },
    { label: t('edit'), icon: 'edit', run: () => void editExisting(l, pid) },
    null,
    { label: t('delete'), icon: 'delete', danger: true, run: async () => {
      if (await confirmDialog(t('delete') + '?', host(l.o) + (l.u ? ' · ' + l.u : ''), t('delete'), true)) void os.call('pwRemove', pid, l.g);
    } },
  ]);
}

async function copy(l: LoginInfo, what: 'login' | 'password', pid = id): Promise<void> {
  if (await os.call<boolean>('pwCopy', pid, l.g, what)) toast(t('password_copied'));
}

async function showPassword(l: LoginInfo, pid = id): Promise<void> {
  const pass = await os.call<string | null>('pwReveal', pid, l.g);
  if (pass == null) return;
  modal((close) => [
    h('h3', { dir: 'ltr' }, host(l.o)),
    h('div', { class: 'reveal' }, h('div', { class: 'sub' }, l.u || '—'), h('div', { class: 'secret', id: 'pw-revealed', dir: 'ltr' }, pass)),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: close }, t('close')),
      h('button', { class: 'btn accent', onclick: () => { close(); void copy(l, 'password', pid); } }, t('copy_password'))),
  ]);
}

async function editExisting(l: LoginInfo, pid = id): Promise<void> {
  const pass = await os.call<string | null>('pwReveal', pid, l.g);
  if (pass != null) await editLogin(l, pass, pid);
}

/** gen — под полем кнопка «Сгенерировать надёжный пароль». */
interface Field { id: string; type: string; value: string; placeholder: string; gen?: boolean }

/** Диалог с несколькими полями (в том числе пароль). null — отмена. */
function form(title: string, fields: Field[], ok = t('save')): Promise<string[] | null> {
  return new Promise((resolve) => {
    let done = false;
    const inputs = fields.map((f) => h('input', { type: f.type, id: f.id, value: f.value, placeholder: f.placeholder, 'aria-label': f.placeholder, spellcheck: false, autocomplete: 'off' }));
    const submit = (c: () => void) => { done = true; c(); resolve(inputs.map((i) => i.value)); };
    modal((c) => {
      inputs.forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(c); }));
      return [
        h('h3', null, title),
        ...inputs.flatMap((i, n) => (fields[n].gen ? [i, h('button', {
          class: 'linkbtn', id: 'f-generate', type: 'button',
          onclick: () => { i.type = 'text'; i.value = generate(); i.focus(); },
        }, '🔑 ' + t('pw_generate'))] : [i])),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => { done = true; c(); resolve(null); } }, t('cancel')),
          h('button', { class: 'btn accent', id: 'form-ok', onclick: () => submit(c) }, ok)),
      ];
    });
    const obs = new MutationObserver(() => {
      if (!document.querySelector('.modal-bg')) { obs.disconnect(); if (!done) resolve(null); }
    });
    obs.observe(document.body, { childList: true });
  });
}

async function editLogin(l: LoginInfo | null, pass = '', pid = id): Promise<void> {
  const r = await form(l ? t('edit') : t('password_add'), [
    { id: 'f-site', type: 'text', value: l?.o ?? '', placeholder: t('password_site') },
    { id: 'f-user', type: 'text', value: l?.u ?? '', placeholder: t('password_login') },
    { id: 'f-pass', type: 'password', value: pass, placeholder: t('password_value'), gen: true },
  ]);
  if (!r || !r[0].trim() || !r[2]) return;
  if (!(await os.call<boolean>('pwSave', pid, r[0], r[1], r[2], l?.g ?? null))) toast(t('dt_pw_bad_site'));
}

async function saveSet(): Promise<void> {
  const now = new Date();
  const r = await form(t('tab_set_name_q'), [{ id: 'f-set', type: 'text', value: now.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) + ' ' + now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), placeholder: t('tab_set_name_q') }]);
  if (!r) return;
  if (!(await os.call<boolean>('tabSetSave', id, r[0]))) toast(t('tab_sets_none'));
}

const pwFields = (confirm: boolean): Field[] => [
  { id: 'f-bpw', type: 'password', value: '', placeholder: t('password_value') },
  ...(confirm ? [{ id: 'f-bpw2', type: 'password', value: '', placeholder: t('backup_pw_again') }] : []),
];

async function exportBackup(): Promise<void> {
  // Индикатор надёжности под паролем копии — обновляется при вводе.
  const meter = () => {
    const i = document.getElementById('f-bpw') as HTMLInputElement | null;
    if (!i || document.getElementById('bpw-meter')) return;
    const m = h('div', { class: 'sub', id: 'bpw-meter', 'aria-live': 'polite' }, t('dt_backup_pw_rule'));
    i.after(m);
    i.addEventListener('input', () => {
      m.textContent = i.value ? `${t(STRENGTH_KEYS[strength(i.value)])}${backupPasswordOk(i.value) ? '' : ' · ' + t('dt_backup_pw_rule')}` : t('dt_backup_pw_rule');
    });
  };
  setTimeout(meter, 0);
  const r = await form(t('backup_pw'), pwFields(true), 'OK');
  if (!r) return;
  if (!backupPasswordOk(r[0])) { toast(t('dt_backup_pw_rule')); return; }
  if (r[0] !== r[1]) { toast(t('backup_pw_mismatch')); return; }
  const res = await os.call<string>('backupExport', id, r[0], r[1]);
  if (res === 'ok') toast(t('backup_done'));
  else if (res !== 'cancel') toast(t('backup_bad'));
}

async function importBackup(): Promise<void> {
  if (!(await os.call<boolean>('backupPick'))) return;
  const r = await form(t('backup_pw'), pwFields(false), 'OK');
  if (!r) return;
  if (r[0].length < 6) { toast(t('backup_pw_short')); return; }
  // В общем кабинете копия одного профиля (v1) восстанавливается в последний открытый профиль, как в Android.
  const target = id || (await os.call<{ last: number }>('cabinetAll')).last;
  const res = await os.call<Restored | 'bad' | 'cancel'>('backupImport', target, r[0]);
  if (res === 'cancel') return;
  if (res === 'bad') { toast(t('backup_bad')); return; }
  await render();
  modal((close) => [
    h('h3', null, t('backup')),
    h('p', { id: 'restored' }, t('backup_restored', res.passwords, res.tabSets, res.favorites, res.notes)),
    h('div', { class: 'actions' }, h('button', { class: 'btn accent', onclick: close }, 'OK')),
  ]);
}

/** Генератор: длина 8–32, цифры, знаки, оценка надёжности; «Копировать» и «Новый». */
function generator(): void {
  let pass = '';
  const out = h('div', { class: 'secret gen-out', id: 'gen-out', dir: 'ltr' });
  const meta = h('div', { class: 'sub', id: 'gen-meta' });
  const len = h('input', { type: 'range', id: 'gen-len', min: String(MIN_LEN), max: String(MAX_LEN), value: '16', 'aria-label': t('pw_length', 16) });
  const digits = h('input', { type: 'checkbox', id: 'gen-digits', checked: true });
  const symbols = h('input', { type: 'checkbox', id: 'gen-symbols', checked: true });
  const regen = () => {
    pass = generate(Number(len.value), digits.checked, symbols.checked);
    out.textContent = pass;
    meta.textContent = `${t('pw_length', Number(len.value))} · ${t(STRENGTH_KEYS[strength(pass)])}`;
  };
  [len, digits, symbols].forEach((el) => el.addEventListener('input', regen));
  regen();
  modal((close) => [
    h('h3', null, t('pw_generator')),
    h('div', { class: 'reveal' }, out, meta),
    len,
    h('label', { class: 'check' }, digits, t('pw_digits')),
    h('label', { class: 'check' }, symbols, t('pw_symbols')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: close }, t('close')),
      h('button', { class: 'btn', id: 'gen-new', onclick: regen }, t('pw_new')),
      h('button', { class: 'btn accent', id: 'gen-copy', onclick: async () => { await os.call('copyText', pass); close(); toast(t('password_copied')); } }, t('copy_password'))),
  ]);
}

interface AllLogin extends LoginInfo { profile: number; profileName: string }
interface All { profiles: (ProfileInfo & { passwords: number; sets: number })[]; logins: AllLogin[]; crypto: boolean }

/** Общий кабинет: сводка по профилям, поиск по паролям всех профилей, генератор, копия всех профилей. */
async function renderAll(head: HTMLElement[]): Promise<void> {
  const a = await os.call<All>('cabinetAll');
  const results = h('div', { class: 'card', id: 'pw-results' });
  const search = h('input', { type: 'search', id: 'pw-search', placeholder: t('pw_search'), 'aria-label': t('pw_search'), spellcheck: false });
  const show = () => {
    const q = search.value.trim().toLowerCase();
    const found = a.logins.filter((l) => !q || l.o.toLowerCase().includes(q) || l.u.toLowerCase().includes(q))
      .sort((x, y) => host(x.o).localeCompare(host(y.o)));
    results.hidden = !found.length;
    results.replaceChildren(...found.slice(0, 200).map((l) => h('div', {
      class: 'setting login', 'data-g': l.g, 'data-profile': String(l.profile), tabindex: '0',
      oncontextmenu: (e: MouseEvent) => { e.preventDefault(); loginMenu(l, e.clientX, e.clientY, l.profile); },
    }, icon('globe'), h('div', { class: 'label' }, h('div', { class: 'site', dir: 'ltr' }, host(l.o)), h('div', { class: 'sub' }, `${l.u || '—'} · ${l.profileName}`)),
    iconButton('more', t('menu'), (e) => loginMenu(l, e.clientX, e.clientY, l.profile), 'login-menu'))));
    empty.textContent = found.length ? '' : t(q ? 'nothing_found' : 'passwords_empty');
  };
  const empty = h('div', { class: 'hint', id: 'pw-empty' });
  search.addEventListener('input', show);
  app.replaceChildren(
    ...head,
    h('div', { class: 'hint' }, t('cabinet_all_desc')),
    h('h2', null, t('profiles')),
    h('div', { class: 'card', id: 'summary' }, ...a.profiles.map((p) => h('a', { class: 'setting link sum', href: `os://cabinet/?profile=${p.id}`, 'data-profile': String(p.id) },
      h('span', { class: 'dot big', style: `background:${p.color}` }),
      h('div', { class: 'label' }, h('div', null, p.name),
        h('div', { class: 'sub' }, `${t('passwords')}: ${p.passwords} · ${t('tab_sets')}: ${p.sets} · ${t('profile_files')}: ${p.files}`)),
      icon('forward', 18)))),
    h('h2', null, `${t('passwords')} · ${a.logins.length}`),
    search, empty, results,
    h('div', { class: 'row actions-row' },
      h('button', { class: 'btn', id: 'pw-gen', onclick: () => generator() }, icon('lock', 18), t('pw_generator'))),
    h('h2', null, t('backup')),
    h('div', { class: 'row actions-row' },
      h('button', { class: 'btn', id: 'backup-export', onclick: () => void exportBackup() }, icon('saved', 18), t('backup_export_all')),
      h('button', { class: 'btn', id: 'backup-import', onclick: () => void importBackup() }, icon('history', 18), t('backup_import'))),
    h('div', { class: 'hint' }, t('dt_backup_desc')),
  );
  show();
}

os.on('changed', () => { if (!document.querySelector('.modal-bg')) void render(); });
void boot(render);
