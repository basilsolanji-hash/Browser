import { boot, h, os, svg, t } from '../shared/ui';
import { WORDMARK } from '../shared/icons';

/** Экран блокировки (AppLock.kt): PIN. Под ним скрыты все вкладки и шапка. */
const app = document.getElementById('app')!;

function render(): void {
  document.title = t('unlock');
  const err = h('div', { class: 'err', id: 'err', role: 'alert' });
  const pin = h('input', { type: 'password', id: 'pin', inputmode: 'numeric', autocomplete: 'off', maxlength: '12', 'aria-label': t('dt_pin') });
  const go = async () => {
    const r = await os.call<string>('unlock', pin.value);
    if (r !== 'ok') {
      err.textContent = r === 'wait' ? t('dt_pin_wait') : t('dt_pin_wrong');
      pin.value = '';
      pin.focus();
    }
  };
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') void go(); });
  app.replaceChildren(
    svg(WORDMARK, 'wordmark'),
    h('h1', null, t('confirm_you')),
    h('div', { class: 'hint' }, t('dt_pin_enter')),
    pin, err,
    h('button', { class: 'btn accent', id: 'unlock', onclick: () => void go() }, t('unlock')),
  );
  pin.focus();
}

void boot(render);
