import { boot, h, os, svg, t } from '../shared/ui';
import { WORDMARK } from '../shared/icons';
import { section } from './common';

/** О приложении (AboutActivity.kt): версия, движок, конфиденциальность. */
const app = document.getElementById('app')!;
app.className = 'wrap';

void boot(async () => {
  document.title = t('about');
  const a = await os.call<{ version: string; electron: string; chromium: string; node: string }>('about');
  app.replaceChildren(
    h('div', { class: 'hero' }, svg(WORDMARK, 'wordmark')),
    h('div', { class: 'ver' }, t('version', a.version)),
    h('div', { class: 'ver' }, t('dt_engine', a.chromium, a.electron)),
    h('p', { class: 'hint', style: 'text-align:center' }, t('about_desc')),
    ...section(t('privacy_security'), h('p', { class: 'hint' }, t('about_privacy'))),
  );
});
