import { boot, h, os, svg, t } from '../shared/ui';
import { WORDMARK } from '../shared/icons';
import { section } from './common';

/** О приложении (AboutActivity.kt): версия, движок, конфиденциальность. */
/** Сайт Оси (AppInfo в Android): политика конфиденциальности — privacy.html (ru) и privacy-en.html. */
const SITE = 'https://www.os-browser.com';
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
    ...section(t('privacy_security'), h('p', { class: 'hint' }, t('about_privacy')),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn', id: 'privacy', onclick: () => void os.call('openUrl', `${SITE}/${document.documentElement.lang === 'ru' ? 'privacy.html' : 'privacy-en.html'}`) }, t('privacy_policy')),
        h('button', { class: 'btn', id: 'site', onclick: () => void os.call('openUrl', SITE + '/') }, 'www.os-browser.com'))),
    ...section(t('licenses'), h('div', { class: 'hint' }, t('dt_licenses_desc')),
      h('div', { class: 'card' }, ...[
        ['Electron', 'MIT'], ['Chromium', 'BSD-3-Clause …'], ['Mozilla Readability', 'Apache-2.0'],
        ['EasyPrivacy (easylist.to)', 'GPL-3.0 / CC BY-SA 3.0'], ['Node.js', 'MIT'],
      ].map(([name, lic]) => h('div', { class: 'setting' }, h('div', { class: 'label' }, name), h('span', { class: 'hint' }, lic)))),
      h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: () => void os.call('openLicenses') }, t('dt_licenses_open')))),
    h('div', { style: 'margin-top:16px' }, h('a', { class: 'btn', href: 'os://help/', style: 'text-decoration:none;color:inherit' }, t('help_feedback'))),
  );
});
