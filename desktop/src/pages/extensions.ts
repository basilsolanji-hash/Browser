import { boot, h, icon, os, t } from '../shared/ui';
import { confirmDialog, param, section, toast } from './common';
import type { ProfileInfo } from '../shared/types';

/**
 * Расширения профиля: список, включить/выключить, удалить, параметры; установка по ссылке или ID из
 * Chrome Web Store. Сеть — только по нажатию «Установить» (запрос к магазину делает главный процесс).
 */
interface Ext {
  id: string; name: string; version: string; enabled: boolean; popup: string | null; options: string | null;
  icon: string | null; description: string; loaded: boolean; error: string | null;
}
type Result = { ok: true; id: string; name: string } | { ok: false; error: string; detail?: string };

const app = document.getElementById('app')!;
app.className = 'wrap';
const profile = Number(param('profile'));
let busy = false;
let draft = '';

const STORE = 'https://chromewebstore.google.com/';

async function install(input: HTMLInputElement): Promise<void> {
  const text = input.value.trim();
  if (!text || busy) return;
  busy = true;
  draft = text;
  void render();
  let r: Result;
  try {
    r = await os.call<Result>('extInstall', profile, text);
  } finally {
    busy = false;
  }
  if (r.ok) {
    draft = '';
    toast(t('dt_ext_installed', r.name));
  } else {
    const key = { id: 'dt_ext_err_id', network: 'dt_ext_err_network', notfound: 'dt_ext_err_notfound', bad: 'dt_ext_err_bad', load: 'dt_ext_err_load' }[r.error] ?? 'dt_ext_err_load';
    toast(t(key, r.detail ?? ''));
  }
  await render();
}

function row(e: Ext): HTMLElement {
  const seg = h('div', { class: 'seg', 'data-k': 'enabled' },
    h('button', { class: e.enabled ? 'on' : '', onclick: () => void toggle(e, true) }, t('dt_ext_on')),
    h('button', { class: e.enabled ? '' : 'on', onclick: () => void toggle(e, false) }, t('dt_ext_off')));
  return h('div', { class: 'ext' + (e.enabled ? '' : ' off'), 'data-id': e.id },
    h('div', { class: 'pic' }, e.icon ? h('img', { src: e.icon, alt: '' }) : icon('extension', 28)),
    h('div', { class: 'grow' },
      h('div', { class: 't' }, e.name),
      h('div', { class: 'u' }, [t('version', e.version || '—'), e.description].filter(Boolean).join(' · ')),
      e.error ? h('div', { class: 'err' }, t('dt_ext_err_load', e.error)) : null),
    h('div', { class: 'actions' },
      e.options && e.enabled && e.loaded ? h('button', { class: 'btn', 'data-k': 'options', onclick: () => void os.call('extOptions', profile, e.id) }, t('dt_ext_options')) : null,
      seg,
      h('button', { class: 'btn danger', 'data-k': 'remove', onclick: () => void removeExt(e) }, t('delete'))));
}

async function toggle(e: Ext, on: boolean): Promise<void> {
  if (e.enabled === on) return;
  if (!(await os.call<boolean>('extEnable', profile, e.id, on)) && on) toast(t('dt_ext_err_load', ''));
  await render();
}

async function removeExt(e: Ext): Promise<void> {
  if (!(await confirmDialog(t('dt_ext_remove_q', e.name), '', t('delete'), true))) return;
  await os.call('extRemove', profile, e.id);
  toast(t('dt_ext_removed', e.name));
  await render();
}

async function render(): Promise<void> {
  const { profile: p, list } = await os.call<{ profile: ProfileInfo; list: Ext[] }>('extensions', profile);
  document.title = t('dt_extensions');
  const input = h('input', { type: 'text', id: 'ext-input', spellcheck: false, placeholder: t('dt_ext_input_hint'), value: draft, disabled: busy,
    onkeydown: (ev: KeyboardEvent) => { if (ev.key === 'Enter') void install(input); },
    oninput: () => { draft = input.value; } });
  app.replaceChildren(
    h('h1', null, t('dt_extensions')),
    h('div', { class: 'row hint' }, h('span', { class: 'dot', style: `background:${p.color};width:10px;height:10px;border-radius:50%;display:inline-block` }), t('dt_ext_profile_note', p.name)),
    h('div', { class: 'card warn', id: 'ext-warning' }, icon('info'), h('div', null, t('dt_ext_warning'))),
    ...section(t('dt_ext_install_title'),
      h('div', { class: 'install' }, input,
        h('button', { class: 'btn accent', id: 'ext-install', disabled: busy, onclick: () => void install(input) }, busy ? t('dt_ext_installing') : t('dt_ext_install')),
        h('button', { class: 'btn', id: 'ext-store', onclick: () => void os.call('openIn', profile, STORE) }, t('dt_ext_store'))),
      h('div', { class: 'hint' }, t('dt_ext_net_note'))),
    ...section(t('dt_ext_list'),
      list.length ? h('div', { class: 'card', id: 'ext-list' }, ...list.map(row)) : h('div', { class: 'empty', id: 'ext-empty' }, t('dt_ext_empty'))),
  );
  if (busy) return;
  if (document.activeElement === document.body) input.focus();
}

os.on('changed', () => { if (!busy) void render(); });
void boot(render);
