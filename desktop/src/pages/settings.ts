import { boot, h, os, t } from '../shared/ui';
import { confirmDialog, section, toast } from './common';
import { pinEditor } from './_pins';

/** Настройки (SettingsActivity.kt): язык, тема, поиск, главная страница, вкладки, профили, данные. */
interface Opt { id: string; name: string }
interface SettingsInfo {
  values: { lang: string; theme: string; engine: string; profileCount: number; homeMode: string; homeUrl: string };
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

async function render(): Promise<void> {
  document.title = t('settings');
  const s = await os.call<SettingsInfo>('settings');
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
  app.replaceChildren(
    h('h1', null, t('settings')),
    ...section(t('general'), h('div', { class: 'card' },
      setting(t('language'), select('lang', s.langs, v.lang, (x) => void set('lang', x))),
      setting(t('theme'), select('theme', s.themes, v.theme, (x) => void set('theme', x))),
      setting(t('search_engine'), select('engine', s.engines, v.engine, (x) => void set('engine', x).then(render))),
    )),
    ...section(t('home_page'), h('div', { class: 'card' },
      h('div', { class: 'setting', style: 'display:block' },
        homeSeg,
        v.homeMode === 'CUSTOM' ? homeUrl : null,
        h('div', { class: 'hint' }, t('home_desc')))),
    ),
    ...section(t('pinned_tabs'), h('div', { class: 'hint' }, t('dt_pinned_desc_common')), pins),
    ...section(t('profiles'), h('div', { class: 'card' },
      setting(t('profiles_count'), count, t('range_desc', s.minProfiles, s.maxProfiles)))),
    ...section(t('data'), h('div', { class: 'links' },
      h('button', { class: 'btn', onclick: async () => { await os.call('clearCacheAll'); toast(t('cache_cleared')); } }, t('clear_cache_all')),
      h('button', {
        class: 'btn', onclick: async () => {
          if (await confirmDialog(t('clear_history_all_q'), '', t('clear'), true)) { await os.call('clearHistoryAll'); toast(t('history_cleared')); }
        },
      }, t('clear_history_all')))),
    ...section(t('about_section'), h('div', { class: 'links' },
      h('a', { class: 'btn', href: 'os://about/', style: 'text-decoration:none;color:inherit' }, t('about')),
      h('a', { class: 'btn', href: 'os://onboarding/', style: 'text-decoration:none;color:inherit' }, t('onb_again')))),
  );
}

os.on('changed', () => void render());
void boot(render);
