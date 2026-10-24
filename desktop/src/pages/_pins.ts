import { h, iconButton, os, t } from '../shared/ui';
import { confirmDialog, promptDialog } from './common';
import type { Pin } from '../shared/types';

/** Редактор закреплённых вкладок (PinEditor.kt): общий набор (profile = null) или свой у профиля. */
export async function pinEditor(profile: number | null, onChange: () => void): Promise<HTMLElement> {
  const { pins } = await os.call<{ pins: Pin[]; own: boolean }>('pins', profile);
  const list = h('div', { class: 'card' });
  pins.forEach((pin, i) => {
    list.append(h('div', { class: 'setting' },
      h('div', { class: 'label' },
        h('div', null, pin.title),
        h('div', { class: 'sub' }, pin.url.startsWith('os://') ? t('start_page') : pin.url)),
      iconButton('up', t('move_up'), () => void os.call('pinMove', profile, pin.id, -1).then(onChange)),
      iconButton('chevron', t('move_down'), () => void os.call('pinMove', profile, pin.id, 1).then(onChange)),
      iconButton('edit', t('edit_tab'), () => void edit(profile, pin, onChange)),
      iconButton('delete', t('delete'), () => void remove(profile, pin, onChange)),
    ));
    const [up, down] = list.lastElementChild!.querySelectorAll('button');
    (up as HTMLButtonElement).disabled = i === 0;
    (down as HTMLButtonElement).disabled = i === pins.length - 1;
  });
  return h('div', null, list,
    h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: () => void edit(profile, null, onChange) }, t('add_tab'))));
}

async function edit(profile: number | null, pin: Pin | null, onChange: () => void): Promise<void> {
  const res = await promptDialog(pin ? t('edit_tab') : t('new_tab'), [
    { value: pin?.title ?? '', placeholder: t('tab_name_hint') },
    { value: pin && !pin.url.startsWith('os://') ? pin.url : '', placeholder: t('tab_url_hint') },
  ]);
  if (!res) return;
  const [title, url] = res;
  if (pin) await os.call('pinUpdate', profile, pin.id, title, url || (pin.url.startsWith('os://') ? pin.url : ''));
  else await os.call('pinAdd', profile, title, url);
  onChange();
}

async function remove(profile: number | null, pin: Pin, onChange: () => void): Promise<void> {
  if (await confirmDialog(t('delete') + ' «' + pin.title + '»?', '', t('delete'), true)) {
    await os.call('pinRemove', profile, pin.id);
    onChange();
  }
}
