import { boot, h, icon, os, t } from '../shared/ui';
import { confirmDialog, param, section } from './common';
import type { ProfileInfo } from '../shared/types';

/** Разрешения сайтов (SiteSettingsActivity.kt): по профилю — все сайты, один сайт, значения по умолчанию. */
type Mode = 'ASK' | 'ALLOW' | 'BLOCK';
interface Data { profile: ProfileInfo; kinds: { key: string; title: string; defaults: Mode[]; current: Mode }[]; sites: Record<string, Record<string, Mode>> }
const app = document.getElementById('app')!;
app.className = 'wrap';
const profile = Number(param('profile'));
let host = param('host') ?? '';
const label: Record<Mode, string> = { ASK: 'perm_ask', ALLOW: 'perm_allow', BLOCK: 'perm_block' };

function seg(options: Mode[], value: Mode, onPick: (m: Mode) => void, id: string): HTMLElement {
  return h('div', { class: 'seg', id }, ...options.map((m) => h('button', { class: m === value ? 'on' : '', onclick: () => onPick(m) }, t(label[m]))));
}

async function render(): Promise<void> {
  const d = await os.call<Data>('sitePerms', profile);
  if (host) {
    document.title = host;
    const m = d.sites[host] ?? {};
    app.replaceChildren(
      h('div', { class: 'row' }, host && param('host') == null ? h('button', { class: 'icon-btn', onclick: () => { host = ''; void render(); } }, icon('back')) : '',
        h('h1', { class: 'grow' }, host)),
      h('div', { class: 'hint' }, d.profile.name),
      ...section(t('site_permissions'), h('div', { class: 'card' }, ...d.kinds.map((k) => h('div', { class: 'perm' },
        h('div', { class: 'label' }, k.title),
        seg(['ASK', 'ALLOW', 'BLOCK'], m[k.key] ?? k.current, (x) => void os.call('sitePermSet', profile, host, k.key, x).then(render), `p-${k.key}`))))),
      h('button', { class: 'btn', style: 'margin-top:12px', onclick: () => void os.call('sitePermClear', profile, host).then(render) }, t('perm_reset_site')),
    );
    return;
  }
  document.title = t('site_permissions');
  const hosts = Object.keys(d.sites).sort();
  app.replaceChildren(
    h('h1', null, t('site_permissions')),
    h('div', { class: 'hint' }, d.profile.name),
    ...section(t('perm_defaults'), h('div', { class: 'card' }, ...d.kinds.map((k) => h('div', { class: 'perm' },
      h('div', { class: 'label' }, k.title),
      seg(k.defaults, k.current, (x) => void os.call('sitePermDefault', k.key, x).then(render), `d-${k.key}`))))),
    ...section(t('perm_sites'), hosts.length
      ? h('div', { class: 'card' }, ...hosts.map((x) => h('div', { class: 'host', tabindex: '0', role: 'button', onclick: () => { host = x; void render(); } },
        h('div', { class: 'grow' }, h('div', null, x),
          h('div', { class: 'sub' }, Object.entries(d.sites[x]).map(([k, v]) => `${d.kinds.find((y) => y.key === k)?.title}: ${t(label[v])}`).join(' · '))),
        icon('forward', 18))))
      : h('div', { class: 'hint' }, t('sec_perms_ok'))),
    hosts.length ? h('button', { class: 'btn danger', style: 'margin-top:12px', onclick: async () => {
      if (await confirmDialog(t('perm_reset_all_q'), '', t('reset'), true)) { await os.call('sitePermClearAll', profile); void render(); }
    } }, t('perm_reset_all')) : '',
  );
}

void boot(render);
