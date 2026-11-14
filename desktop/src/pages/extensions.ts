import { boot, h, icon, os, t } from '../shared/ui';
import { confirmDialog, param, section, toast } from './common';
import type { ProfileInfo } from '../shared/types';

/**
 * Расширения профиля: список, включить/выключить, удалить, параметры; установка по ссылке или ID из
 * Chrome Web Store. Сеть — только по нажатию «Установить» (запрос к магазину делает главный процесс).
 */
interface Ext {
  id: string; name: string; version: string; enabled: boolean; popup: string | null; options: string | null;
  icon: string | null; description: string; loaded: boolean; error: string | null; stateSaveFailed: boolean;
  recovery: 'blocked' | 'ready' | 'failed' | null;
}
type Result = { ok: true; id: string; name: string; disabled?: boolean } | { ok: false; error: string; detail?: string };

const app = document.getElementById('app')!;
app.className = 'wrap';
const profile = Number(param('profile'));
let busy = false;
let draft = '';
const toggling = new Set<string>();
let stateRefresh: ReturnType<typeof setTimeout> | null = null;
let listingAvailable = true;

const STORE = 'https://chromewebstore.google.com/';

async function install(input: HTMLInputElement): Promise<void> {
  const text = input.value.trim();
  if (!text || busy) return;
  busy = true;
  draft = text;
  void render();
  let r: Result | null = null;
  try {
    r = await os.call<Result>('extInstall', profile, text);
  } catch {
    toast(t('dt_ext_restore_incomplete'));
  } finally {
    busy = false;
  }
  if (!r) { await render(); return; }
  if (r.ok) {
    draft = '';
    toast(r.disabled ? t('dt_ext_reinstalled_off') : t('dt_ext_installed', r.name));
  } else {
    const key = { id: 'dt_ext_err_id', network: 'dt_ext_err_network', notfound: 'dt_ext_err_notfound', bad: 'dt_ext_package_invalid', load: 'dt_ext_err_load', save: 'dt_storage_save_failed', recover: 'dt_ext_restore_incomplete', disabled: 'dt_ext_enable_before_update' }[r.error] ?? 'dt_ext_err_load';
    // Техническая причина сбоя сети — в скобках, чтобы её можно было прислать в отзыве.
    toast(t(key, r.detail ?? '') + (r.error === 'network' && r.detail ? ` (${r.detail})` : ''));
  }
  await render();
}

function row(e: Ext): HTMLElement {
  const active = e.loaded;
  const pending = toggling.has(e.id);
  const seg = h('div', { class: 'seg', 'data-k': 'enabled' },
    h('button', { class: active ? 'on' : '', disabled: pending, onclick: () => void toggle(e, true) }, t('dt_ext_on')),
    h('button', { class: active ? '' : 'on', disabled: pending, onclick: () => void toggle(e, false) }, t('dt_ext_off')));
  return h('div', { class: 'ext' + (active ? '' : ' off'), 'data-id': e.id },
    h('div', { class: 'pic' }, e.icon ? h('img', { src: e.icon, alt: '' }) : icon('extension', 28)),
    h('div', { class: 'grow' },
      h('div', { class: 't' }, e.name),
      h('div', { class: 'u' }, [t('version', e.version || '—'), e.description].filter(Boolean).join(' · ')),
      e.loaded ? h('div', { class: 'hint' }, t('dt_ext_loaded_unverified')) : null,
      e.recovery ? h('div', { class: 'err' }, t(e.recovery === 'blocked' ? 'dt_ext_recovery_blocked' : e.recovery === 'failed' ? 'dt_ext_load_failed' : 'dt_ext_recovery_ready')) :
        e.error ? h('div', { class: 'err' }, t(e.error === 'running' ? 'dt_ext_still_running' : e.error === 'recover' ? 'dt_ext_restore_incomplete' : 'dt_ext_err_load', '')) : null,
      e.recovery && e.loaded ? h('div', { class: 'err' }, t('dt_ext_still_running')) : null,
      e.stateSaveFailed ? h('div', { class: 'err' }, t('dt_storage_save_failed')) : null),
    h('div', { class: 'actions' },
      e.options && e.enabled && e.loaded && !e.recovery && e.error !== 'recover' && e.error !== 'running' ? h('button', { class: 'btn', 'data-k': 'options', onclick: () => void os.call('extOptions', profile, e.id) }, t('dt_ext_options')) : null,
      (e.recovery === 'blocked' || e.recovery === 'failed') ? h('button', { class: 'btn', disabled: pending, onclick: () => void prepareRecovery(e) }, t('dt_ext_recovery_prepare')) :
        e.recovery === 'ready' ? h('button', { class: 'btn', disabled: pending || busy, onclick: () => {
          const input = document.getElementById('ext-input');
          if (input instanceof HTMLInputElement) { input.value = e.id; void install(input); }
        } }, t('dt_ext_recovery_install')) : seg,
      !e.recovery ? h('button', { class: 'btn danger', 'data-k': 'remove', disabled: pending, onclick: () => void removeExt(e) }, t('delete')) : null));
}

async function prepareRecovery(e: Ext): Promise<void> {
  if (toggling.has(e.id) || !(await confirmDialog(t('dt_ext_recovery_confirm'), '', t('dt_ext_recovery_prepare'), true))) return;
  toggling.add(e.id);
  try {
    await render();
    if (!listingAvailable) return;
    await os.call('extPrepareRecovery', profile, e.id);
    toast(t('dt_ext_recovery_ready'));
  } catch {
    toast(t('dt_ext_restore_incomplete'));
  } finally {
    toggling.delete(e.id);
    await render();
  }
}

async function toggle(e: Ext, on: boolean): Promise<void> {
  if (toggling.has(e.id) || (!e.stateSaveFailed && e.enabled === on && e.loaded === on)) return;
  toggling.add(e.id);
  try {
    await render();
    if (!listingAvailable) return;
    if (!(await os.call<boolean>('extEnable', profile, e.id, on))) {
      const current = await os.call<{ list: Ext[] }>('extensions', profile);
      const updated = current.list.find((item) => item.id === e.id);
      toast(t(updated?.stateSaveFailed ? 'dt_storage_save_failed' : 'dt_ext_err_load', ''));
    } else toast(t('dt_ext_reload_hint'));
  } catch {
    toast(t('dt_ext_err_load', ''));
  } finally {
    toggling.delete(e.id);
    await render();
  }
}

async function removeExt(e: Ext): Promise<void> {
  if (!(await confirmDialog(t('dt_ext_remove_q', e.name), '', t('delete'), true))) return;
  try {
    await os.call('extRemove', profile, e.id);
    toast(t('dt_ext_removed', e.name));
  } catch {
    toast(t('dt_ext_remove_incomplete'));
  } finally {
    await render();
  }
}

async function render(): Promise<void> {
  let state: { profile: ProfileInfo; list: Ext[] };
  try {
    state = await os.call<{ profile: ProfileInfo; list: Ext[] }>('extensions', profile);
    listingAvailable = true;
  } catch {
    listingAvailable = false;
    if (stateRefresh) clearTimeout(stateRefresh);
    stateRefresh = null;
    app.replaceChildren(h('h1', null, t('dt_extensions')), h('div', { class: 'err' }, t('dt_ext_list_unavailable')));
    return;
  }
  const { profile: p, list } = state;
  if (stateRefresh) clearTimeout(stateRefresh);
  stateRefresh = list.some((e) => e.stateSaveFailed) ? setTimeout(() => {
    stateRefresh = null;
    void render().catch(() => {});
  }, 6000) : null;
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
