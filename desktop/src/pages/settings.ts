import { boot, h, os, t } from '../shared/ui';
import { confirmDialog, promptDialog, section, toast } from './common';
import { pinEditor } from './_pins';

/** Настройки (SettingsActivity.kt): язык, тема, поиск, главная страница, вкладки, профили, данные. */
interface Opt { id: string; name: string }
interface SettingsInfo {
  values: {
    lang: string; theme: string; engine: string; profileCount: number; homeMode: string; homeUrl: string;
    trackingProtection: boolean; httpsOnly: boolean; blockThirdPartyCookies: boolean; hideContent: boolean; lock: boolean; autoUpdate: boolean;
  };
  langs: Opt[]; themes: Opt[]; engines: Opt[]; minProfiles: number; maxProfiles: number;
}

const app = document.getElementById('app')!;
app.className = 'wrap';

const set = (key: string, value: unknown) => os.call('setSetting', key, value);

function select(id: string, opts: Opt[], value: string, onchange: (v: string) => void): HTMLSelectElement {
  const s = h('select', { id, onchange: () => onchange(s.value) }, ...opts.map((o) => h('option', { value: o.id, selected: o.id === value }, o.name)));
  return s;
}

function setting(label: string, control: HTMLElement | null, sub?: string): HTMLElement {
  return h('div', { class: 'setting' }, h('div', { class: 'label' }, h('div', null, label), sub ? h('div', { class: 'sub' }, sub) : null), control);
}

/** Переключатель из двух вариантов (как сегменты в Android-настройках). */
function toggle(id: string, value: boolean, on: string, off: string, key: string): HTMLElement {
  return h('div', { class: 'seg', id },
    h('button', { class: value ? 'on' : '', onclick: () => void set(key, true).then(render) }, on),
    h('button', { class: value ? '' : 'on', onclick: () => void set(key, false).then(render) }, off));
}

async function pinDialog(): Promise<void> {
  const r = await promptDialog(t('dt_pin_set'), [{ value: '', placeholder: t('dt_pin_new') }, { value: '', placeholder: t('dt_pin_repeat') }]);
  if (!r) return;
  if (r[0] !== r[1]) { toast(t('dt_pin_mismatch')); return; }
  if (!(await os.call<boolean>('setPin', r[0]))) { toast(t('dt_pin_rule')); return; }
  toast(t('done'));
  void render();
}

let query = '';

/** Поиск в настройках (№32): прячем строки и секции без совпадений. */
function applySearch(): void {
  const q = query.trim().toLowerCase();
  let any = false;
  document.querySelectorAll<HTMLElement>('section[data-sec]').forEach((sec) => {
    const title = sec.querySelector('h2')?.textContent?.toLowerCase() ?? '';
    const rows = [...sec.querySelectorAll<HTMLElement>('.setting, .links > *, .hint')];
    let visible = 0;
    rows.forEach((r) => {
      const hit = !q || title.includes(q) || (r.textContent ?? '').toLowerCase().includes(q);
      r.hidden = !hit;
      if (hit) visible++;
    });
    sec.hidden = !!q && !visible && !title.includes(q);
    if (!sec.hidden) any = true;
  });
  document.getElementById('nothing')!.hidden = any;
}

async function render(): Promise<void> {
  document.title = t('settings');
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
  const pins = await pinEditor(null, render);
  const sec = (title: string, ...children: (HTMLElement | null)[]) => h('section', { 'data-sec': '' }, ...section(title, ...children));
  const search = h('input', { type: 'search', id: 'settings-search', placeholder: t('search_settings'), value: query,
    oninput: () => { query = search.value; applySearch(); } });
  app.replaceChildren(
    h('h1', null, t('settings')),
    search,
    sec(t('general'), h('div', { class: 'card' },
      setting(t('language'), select('lang', s.langs, v.lang, (x) => void set('lang', x))),
      setting(t('theme'), select('theme', s.themes, v.theme, (x) => void set('theme', x))),
      setting(t('search_engine'), select('engine', s.engines, v.engine, (x) => void set('engine', x).then(render))),
    )),
    sec(t('privacy_security'), h('div', { class: 'card', id: 'privacy' },
      setting(t('sec_tracking'), toggle('tracking', v.trackingProtection, t('dt_on'), t('dt_off'), 'trackingProtection'), t('dt_tracking_desc')),
      setting(t('perm_cookies3p'), toggle('cookies3p', v.blockThirdPartyCookies, t('perm_block'), t('perm_allow'), 'blockThirdPartyCookies'), t('dt_cookies_desc')),
      setting(t('sec_https'), toggle('https', v.httpsOnly, t('https_on'), t('https_off'), 'httpsOnly'), t('sec_https_ok')),
      setting(t('hide_content'), toggle('hide', v.hideContent, t('hide'), t('show'), 'hideContent'), t('dt_hide_desc')),
      setting(t('sec_lock'), h('div', { class: 'row' },
        h('button', { class: 'btn', id: 'pin-set', onclick: () => void pinDialog() }, v.lock ? t('dt_pin_change') : t('dt_pin_set')),
        v.lock ? h('button', { class: 'btn', id: 'pin-remove', onclick: async () => {
          if (await confirmDialog(t('dt_pin_remove') + '?', '', t('dt_pin_remove'), true)) { await os.call('removePin'); void render(); }
        } }, t('dt_pin_remove')) : null), v.lock ? t('dt_lock_desc') : t('dt_lock_hello')),
      setting(t('site_permissions'), h('a', { class: 'btn', href: `os://site/?profile=${lastProfile}`, style: 'text-decoration:none;color:inherit' }, t('open'))),
      setting(t('security_check'), h('a', { class: 'btn', id: 'sec-check', href: 'os://security/', style: 'text-decoration:none;color:inherit' }, t('open'))),
    )),
    sec(t('default_browser'), h('div', { class: 'card' },
      setting(def.isDefault ? t('default_is') : t('default_not'),
        def.supported ? h('button', { class: 'btn' + (def.isDefault ? '' : ' accent'), id: 'make-default', onclick: () => void os.call('makeDefault') },
          def.isDefault ? t('default_change') : t('default_make')) : null,
        t('default_desc')))),
    sec(t('home_page'), h('div', { class: 'card' },
      h('div', { class: 'setting', style: 'display:block' },
        homeSeg,
        v.homeMode === 'CUSTOM' ? homeUrl : null,
        h('div', { class: 'hint' }, t('home_desc')))),
    ),
    sec(t('pinned_tabs'), h('div', { class: 'hint' }, t('dt_pinned_desc_common')), pins),
    sec(t('profiles'), h('div', { class: 'card' },
      setting(t('profiles_count'), count, t('range_desc', s.minProfiles, s.maxProfiles)))),
    sec(t('data'), h('div', { class: 'links' },
      h('button', { class: 'btn', onclick: async () => { await os.call('clearCacheAll'); toast(t('cache_cleared')); } }, t('clear_cache_all')),
      h('button', {
        class: 'btn', onclick: async () => {
          if (await confirmDialog(t('clear_history_all_q'), '', t('clear'), true)) { await os.call('clearHistoryAll'); toast(t('history_cleared')); }
        },
      }, t('clear_history_all')))),
    sec(t('dt_updates'), h('div', { class: 'card' },
      setting(t('dt_update_auto'), toggle('auto-update', v.autoUpdate, t('dt_on'), t('dt_off'), 'autoUpdate'), t('dt_update_desc')),
      setting(updText[upd.state] ?? '', upd.state === 'downloaded'
        ? h('button', { class: 'btn accent', id: 'update-restart', onclick: () => void os.call('updateRestart') }, t('dt_update_restart'))
        : h('button', { class: 'btn', id: 'update-check', disabled: upd.state === 'dev' || upd.state === 'off' || upd.state === 'checking',
          onclick: () => void os.call('updateCheck').then(render) }, t('dt_update_check'))))),
    sec(t('about_section'), h('div', { class: 'links' },
      h('a', { class: 'btn', href: 'os://stats/', style: 'text-decoration:none;color:inherit' }, t('stats')),
      h('a', { class: 'btn', href: 'os://about/', style: 'text-decoration:none;color:inherit' }, t('about')),
      h('a', { class: 'btn', href: 'os://onboarding/', style: 'text-decoration:none;color:inherit' }, t('onb_again')))),
    h('div', { class: 'empty', id: 'nothing', hidden: true }, t('nothing_found')),
  );
  applySearch();
}

os.on('changed', () => void render());
os.on('update', () => { if (document.activeElement?.tagName !== 'INPUT') void render(); });
void boot(render);
