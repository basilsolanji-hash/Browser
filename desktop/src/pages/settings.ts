import { boot, h, icon, os, t } from '../shared/ui';
import { confirmDialog, param, promptDialog, toast } from './common';
import { pinEditor } from './_pins';
import { groupSummary, searchSettings, type SettingItem } from '../shared/settingsearch';

/**
 * Настройки (SettingsActivity.kt): сверху поиск по всем пунктам; главная — 7 групп с иконками и кратким
 * содержимым, нажатие открывает группу (os://settings/?g=…); при вводе — подходящие пункты из всех групп.
 */
interface Opt { id: string; name: string }
interface SettingsInfo {
  values: {
    lang: string; theme: string; engine: string; toolbarButton: string; profileCount: number; homeMode: string; homeUrl: string; zoom: number;
    trackingProtection: boolean; httpsOnly: boolean; blockThirdPartyCookies: boolean; hideContent: boolean; lock: boolean; autoUpdate: boolean;
  };
  langs: Opt[]; themes: Opt[]; engines: Opt[]; toolbarButtons: Opt[]; minProfiles: number; maxProfiles: number;
}

/** Группы: id, ключ названия, значок. */
const GROUPS: [string, string, string][] = [
  ['general', 'sg_general', 'settings'],
  ['profiles', 'sg_profiles', 'group'],
  ['panels', 'sg_panels', 'tabs'],
  ['privacy', 'sg_privacy', 'shield'],
  ['data', 'sg_data', 'delete'],
  ['library', 'sg_library', 'book'],
  ['about', 'sg_about', 'info'],
];

const app = document.getElementById('app')!;
app.className = 'wrap';
const group = GROUPS.some((g) => g[0] === param('g')) ? param('g')! : null;

const set = (key: string, value: unknown) => os.call('setSetting', key, value);

function select(id: string, opts: Opt[], value: string, onchange: (v: string) => void): HTMLSelectElement {
  const s = h('select', { id, onchange: () => onchange(s.value) }, ...opts.map((o) => h('option', { value: o.id, selected: o.id === value }, o.name)));
  return s;
}

function setting(label: string, control: HTMLElement | null, sub?: string, sum?: string): HTMLElement {
  return h('div', { class: 'setting', 'data-sum': sum }, h('div', { class: 'label' }, h('div', null, label), sub ? h('div', { class: 'sub' }, sub) : null), control);
}

/** Строка-ссылка на другой экран. */
function link(label: string, href: string, sub?: string, id?: string): HTMLElement {
  return h('a', { class: 'setting link', href, id }, h('div', { class: 'label' }, h('div', null, label), sub ? h('div', { class: 'sub' }, sub) : null), icon('forward', 18));
}

/** Переключатель из двух вариантов (как сегменты в Android-настройках). */
function toggle(id: string, value: boolean, on: string, off: string, key: string): HTMLElement {
  return h('div', { class: 'seg', id },
    h('button', { class: value ? 'on' : '', onclick: () => void set(key, true).then(render) }, on),
    h('button', { class: value ? '' : 'on', onclick: () => void set(key, false).then(render) }, off));
}

/** Новый PIN; если PIN уже задан — сначала текущий (иначе любой у открытого окна сменил бы его). */
async function pinDialog(hasPin: boolean): Promise<void> {
  const fields = [{ value: '', placeholder: t('dt_pin_new') }, { value: '', placeholder: t('dt_pin_repeat') }];
  if (hasPin) fields.unshift({ value: '', placeholder: t('dt_pin_current') });
  const r = await promptDialog(t(hasPin ? 'dt_pin_change' : 'dt_pin_set'), fields);
  if (!r) return;
  const [current, pin, repeat] = hasPin ? r : ['', r[0], r[1]];
  if (pin !== repeat) { toast(t('dt_pin_mismatch')); return; }
  const res = await os.call<string>('setPin', pin, current);
  if (res === 'wrong' || res === 'wait') { toast(t(res === 'wait' ? 'dt_pin_wait' : 'dt_pin_wrong')); return; }
  if (res !== 'ok') { toast(t('dt_pin_rule')); return; }
  toast(t('done'));
  void render();
}

async function removePinDialog(): Promise<void> {
  const r = await promptDialog(t('dt_pin_remove'), [{ value: '', placeholder: t('dt_pin_current') }]);
  if (!r) return;
  const res = await os.call<string>('removePin', r[0]);
  if (res !== 'ok') { toast(t(res === 'wait' ? 'dt_pin_wait' : 'dt_pin_wrong')); return; }
  toast(t('done'));
  void render();
}

let query = '';

/** Пункты для поиска и краткого содержимого: подписи строк (без полей ввода — в них данные пользователя). */
function collect(): { items: SettingItem[]; rows: Map<string, HTMLElement> } {
  const items: SettingItem[] = [];
  const rows = new Map<string, HTMLElement>();
  document.querySelectorAll<HTMLElement>('section[data-group]').forEach((sec, si) => {
    const title = sec.querySelector('h2')?.textContent ?? '';
    sec.querySelectorAll<HTMLElement>('.setting, .hint.searchable').forEach((r, ri) => {
      const id = `${si}:${ri}`;
      const texts = [...r.querySelectorAll<HTMLElement>('.label > div, .label .sub')].map((x) => x.textContent ?? '');
      // Подсказки ищутся, но в краткое содержимое группы не попадают; у строк с меняющейся подписью — своё название.
      const lead = r.classList.contains('hint') ? '' : r.dataset.sum;
      items.push({ id, group: sec.dataset.group!, section: title, texts: [...(lead != null ? [lead] : []), ...(texts.length ? texts : [r.textContent ?? ''])] });
      rows.set(id, r);
    });
  });
  return { items, rows };
}

/** Главная — только группы; в группе — её разделы; с запросом — совпадения из всех групп. */
function applySearch(): void {
  const { items, rows } = collect();
  const q = query.trim();
  const home = !group && !q;
  document.getElementById('groups')!.hidden = !home;
  const hits = q ? new Set(searchSettings(items, q).map((x) => x.id)) : null;
  document.querySelectorAll<HTMLElement>('section[data-group]').forEach((sec) => {
    if (home) { sec.hidden = true; return; }
    if (!hits) { sec.hidden = sec.dataset.group !== group; rows.forEach((r) => { r.hidden = false; }); return; }
    let visible = 0;
    sec.querySelectorAll<HTMLElement>('.setting, .hint.searchable').forEach((r) => {
      const id = [...rows].find(([, el]) => el === r)?.[0] ?? '';
      r.hidden = !hits.has(id);
      if (!r.hidden) visible++;
    });
    sec.hidden = !visible;
  });
  document.getElementById('nothing')!.hidden = home || !hits || hits.size > 0;
  // Краткое содержимое групп — из названий их пунктов.
  for (const [id] of GROUPS) {
    const el = document.querySelector<HTMLElement>(`.gcard[data-g="${id}"] .gsum`);
    if (el) el.textContent = groupSummary(items, id).join(' · ');
  }
}

async function render(): Promise<void> {
  const title = group ? t(GROUPS.find((g) => g[0] === group)![1]) : t('settings');
  document.title = title;
  const s = await os.call<SettingsInfo>('settings');
  const lastProfile = await os.call<number>('lastProfile');
  const def = await os.call<{ isDefault: boolean; supported: boolean }>('defaultBrowser');
  const upd = await os.call<{ state: string; version: string }>('updateStatus');
  const updText: Record<string, string> = {
    off: t('dt_update_off'), dev: t('dt_update_dev'), idle: t('dt_update_idle'), checking: t('dt_update_checking'),
    none: t('dt_update_none'), available: t('dt_update_available', upd.version), downloaded: t('dt_update_ready', upd.version), error: t('dt_update_error'),
  };
  const v = s.values;
  const homeUrl = h('input', {
    type: 'url', class: 'homeurl', id: 'home-url', value: v.homeUrl, placeholder: t('home_url_hint'),
    onchange: () => void set('homeUrl', homeUrl.value).then(render),
  });
  const homeSeg = h('div', { class: 'seg' }, ...([['OS', 'home_os'], ['BLANK', 'home_blank'], ['CUSTOM', 'home_custom']] as const).map(([id, key]) =>
    h('button', { class: v.homeMode === id ? 'on' : '', onclick: () => void set('homeMode', id).then(render) }, t(key))));
  const count = h('input', {
    type: 'number', id: 'profile-count', min: String(s.minProfiles), max: String(s.maxProfiles), value: String(v.profileCount),
    onchange: () => void set('profileCount', Number(count.value)).then(render),
  });
  const zooms = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200].map((z) => ({ id: String(z), name: `${z}%` }));
  const pins = await pinEditor(null, render);
  const sec = (g: string, heading: string, ...children: (HTMLElement | null)[]) =>
    h('section', { 'data-group': g }, h('h2', null, heading), ...children.filter((c): c is HTMLElement => !!c));
  const search = h('input', { type: 'search', id: 'settings-search', placeholder: t('search_settings'), value: query, 'aria-label': t('search_settings'),
    oninput: () => { query = search.value; applySearch(); } });
  const groups = h('div', { id: 'groups', class: 'groups' }, ...GROUPS.map(([id, key, ic]) => h('a', { class: 'gcard', href: `os://settings/?g=${id}`, 'data-g': id },
    h('span', { class: 'gicon' }, icon(ic, 22)),
    h('div', { class: 'grow' }, h('div', { class: 'gtitle' }, t(key)), h('div', { class: 'gsum' })),
    icon('forward', 18))));
  app.replaceChildren(
    h('div', { class: 'row' },
      group ? h('a', { class: 'icon-btn', href: 'os://settings/', title: t('back'), 'aria-label': t('back') }, icon('back')) : null,
      h('h1', { class: 'grow' }, title)),
    search,
    groups,
    sec('general', t('sg_general'), h('div', { class: 'card' },
      setting(t('language'), select('lang', s.langs, v.lang, (x) => void set('lang', x))),
      setting(t('theme'), select('theme', s.themes, v.theme, (x) => void set('theme', x))),
      setting(t('search_engine'), select('engine', s.engines, v.engine, (x) => void set('engine', x).then(render))))),
    sec('general', t('home_page'), h('div', { class: 'card' },
      h('div', { class: 'setting', style: 'display:block' },
        h('div', { class: 'label' }, h('div', null, t('home_page')), h('div', { class: 'sub' }, t('home_desc'))),
        homeSeg,
        v.homeMode === 'CUSTOM' ? homeUrl : null))),
    sec('general', t('default_browser'), h('div', { class: 'card' },
      setting(def.isDefault ? t('default_is') : t('default_not'),
        def.supported ? h('button', { class: 'btn' + (def.isDefault ? '' : ' accent'), id: 'make-default', onclick: () => void os.call('makeDefault') },
          def.isDefault ? t('default_change') : t('default_make')) : null,
        t('default_desc'), t('default_browser')))),
    sec('profiles', t('sg_profiles'), h('div', { class: 'card' },
      setting(t('profiles_count'), count, t('range_desc', s.minProfiles, s.maxProfiles)),
      link(t('dt_all_profiles'), 'os://home/'),
      link(t('profile_settings'), `os://profile/?id=${lastProfile}`))),
    sec('profiles', t('pinned_tabs'), h('div', { class: 'hint searchable' }, t('dt_pinned_desc_common')), pins),
    sec('panels', t('sg_panels'), h('div', { class: 'card' },
      setting(t('bottom_button'), select('toolbar-button', s.toolbarButtons, v.toolbarButton, (x) => void set('toolbarButton', x)), t('dt_toolbar_button_desc')),
      setting(t('zoom'), select('zoom', zooms, String(v.zoom), (x) => void set('zoom', Number(x)))),
      link(t('tabs'), `os://tabs/?profile=${lastProfile}`))),
    sec('privacy', t('sg_privacy'), h('div', { class: 'card', id: 'privacy' },
      setting(t('block_screenshots'), toggle('hide', v.hideContent, t('dt_on'), t('dt_off'), 'hideContent'), t('block_screenshots_desc')),
      setting(t('sec_lock'), h('div', { class: 'row' },
        h('button', { class: 'btn', id: 'pin-set', onclick: () => void pinDialog(v.lock) }, v.lock ? t('dt_pin_change') : t('dt_pin_set')),
        v.lock ? h('button', { class: 'btn', id: 'pin-remove', onclick: () => void removePinDialog() }, t('dt_pin_remove')) : null), v.lock ? t('dt_lock_desc') : t('dt_lock_hello')),
      setting(t('sec_https'), toggle('https', v.httpsOnly, t('https_on'), t('https_off'), 'httpsOnly'), t('sec_https_ok')),
      setting(t('sec_tracking'), toggle('tracking', v.trackingProtection, t('dt_on'), t('dt_off'), 'trackingProtection'), t('dt_tracking_desc')),
      setting(t('perm_cookies3p'), toggle('cookies3p', v.blockThirdPartyCookies, t('perm_block'), t('perm_allow'), 'blockThirdPartyCookies'), t('dt_cookies_desc')),
      link(t('site_permissions'), `os://site/?profile=${lastProfile}`),
      link(t('security_check'), 'os://security/', undefined, 'sec-check'))),
    sec('data', t('sg_data'), h('div', { class: 'card' },
      link(t('clear_browsing_data'), `os://clear/?profile=${lastProfile}`, t('cd_note'), 'open-clear'),
      link(t('history'), `os://history/?profile=${lastProfile}`),
      setting(t('clear_cache_all'), h('button', { class: 'btn', onclick: async () => { await os.call('clearCacheAll'); toast(t('cache_cleared')); } }, t('clear'))),
      setting(t('clear_history_all'), h('button', {
        class: 'btn', onclick: async () => {
          if (await confirmDialog(t('clear_history_all_q'), '', t('clear'), true)) { await os.call('clearHistoryAll'); toast(t('history_cleared')); }
        },
      }, t('clear'))))),
    sec('library', t('sg_library'), h('div', { class: 'card' },
      link(t('favorites'), 'os://favorites/'),
      link(t('notes'), 'os://notes/'),
      link(t('saved_pages'), 'os://saved/'),
      link(t('dl_title'), 'os://downloads/'),
      link(t('stats'), 'os://stats/'))),
    sec('about', t('dt_updates'), h('div', { class: 'card' },
      setting(t('dt_update_auto'), toggle('auto-update', v.autoUpdate, t('dt_on'), t('dt_off'), 'autoUpdate'), t('dt_update_desc')),
      setting(updText[upd.state] ?? '', upd.state === 'downloaded'
        ? h('button', { class: 'btn accent', id: 'update-restart', onclick: () => void os.call('updateRestart') }, t('dt_update_restart'))
        : h('button', { class: 'btn', id: 'update-check', disabled: upd.state === 'dev' || upd.state === 'off' || upd.state === 'checking',
          onclick: () => void os.call('updateCheck').then(render) }, t('dt_update_check')), undefined, t('dt_update_check')))),
    sec('about', t('sg_about'), h('div', { class: 'card' },
      link(t('help_feedback'), 'os://help/'),
      link(t('about'), 'os://about/'),
      link(t('onb_again'), 'os://onboarding/'))),
    h('div', { class: 'empty', id: 'nothing', hidden: true }, t('nothing_found')),
  );
  applySearch();
}

os.on('changed', () => void render());
os.on('update', () => { if (document.activeElement?.tagName !== 'INPUT') void render(); });
void boot(render);
