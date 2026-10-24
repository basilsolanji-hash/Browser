import { boot, h, os, t } from '../shared/ui';
import { confirmDialog, param, toast } from './common';
import type { ProfileInfo } from '../shared/types';

/** Очистка данных профиля (BrowserActivity → «Очистка»): история, кэш, выход из аккаунтов. */
const app = document.getElementById('app')!;
app.className = 'wrap';
const profile = Number(param('profile'));

async function render(): Promise<void> {
  const p = await os.call<ProfileInfo>('profile', profile);
  document.title = t('clear_title');
  const opt = (id: string, label: string, sub: string, checked: boolean) =>
    h('label', { class: 'opt' }, h('input', { type: 'checkbox', id, checked }), h('div', null, h('div', null, label), sub ? h('div', { class: 'sub' }, sub) : ''));
  app.replaceChildren(
    h('h1', null, t('clear_title')),
    h('div', { class: 'card', style: 'margin-top:12px' },
      opt('o-history', t('opt_history', p.name), '', true),
      opt('o-cache', t('opt_cache'), '', true),
      opt('o-logout', t('opt_logout', p.name), t('clear_profile_msg'), false)),
    h('div', { style: 'margin-top:16px;display:flex;gap:8px' },
      h('button', { class: 'btn accent', id: 'do-clear', onclick: async () => {
        const what = {
          history: (document.getElementById('o-history') as HTMLInputElement).checked,
          cache: (document.getElementById('o-cache') as HTMLInputElement).checked,
          logout: (document.getElementById('o-logout') as HTMLInputElement).checked,
        };
        if (what.logout && !(await confirmDialog(t('clear_q', p.name), t('clear_profile_msg'), t('clear'), true))) return;
        await os.call('clearData', profile, what);
        toast(t('done'));
      } }, t('clear'))),
  );
}

void boot(render);
