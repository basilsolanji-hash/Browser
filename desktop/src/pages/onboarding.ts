import { boot, h, icon, os, svg, t } from '../shared/ui';
import { WORDMARK } from '../shared/icons';
import type { ProfileInfo } from '../shared/types';

/** Обучение при первом запуске (OnboardingActivity.kt): листается кнопками или стрелками, «Пропустить» — сразу к профилям. */
const app = document.getElementById('app')!;
let index = 0;
let examples: ProfileInfo[] = [];
let def = false; // предложить «браузер по умолчанию» на последнем экране (как на Android)

interface Page { title: string; body: string; art: () => HTMLElement }

function pages(): Page[] {
  return [
    { title: t('onb1_title'), body: t('onb1_body'), art: () => svg(WORDMARK, 'wordmark') },
    {
      title: t('onb2_title'), body: t('onb2_body'),
      art: () => h('div', { class: 'prof' }, ...examples.map((p) => h('div', null, h('span', { style: `background:${p.color}` }), p.name))),
    },
    {
      title: t('onb3_title'), body: t('dt_onb3_body'),
      art: () => h('div', { class: 'tabsart' }, ...(examples[0]?.pins ?? []).slice(0, 3).map((p, i) => h('div', { class: i === 0 ? 'on' : '' }, p.title))),
    },
    { title: t('onb4_title'), body: t('dt_onb4_body'), art: () => h('div', { class: 'badge' }, icon('history', 44)) },
    { title: t('onb5_title'), body: t('dt_onb5_body'), art: () => h('div', { class: 'badge' }, icon('more', 44)) },
    { title: t('onb6_title'), body: t('dt_onb6_body'), art: () => h('div', { class: 'badge' }, icon('lock', 44)) },
  ];
}

function done(): void {
  void os.call('onboardingDone');
}

function render(): void {
  document.title = t('onb1_title');
  const list = pages();
  const last = index === list.length - 1;
  const p = list[index];
  app.replaceChildren(
    h('button', { class: 'btn skip', id: 'skip', onclick: done }, t('onb_skip')),
    h('div', { class: 'stage', 'aria-live': 'polite' },
      h('div', { class: 'art' }, p.art()),
      h('div', { class: 'title', id: 'title' }, p.title),
      h('div', { class: 'body' }, p.body),
      last && def ? h('button', { class: 'btn', style: 'margin-top:18px', onclick: () => void os.call('makeDefault') }, t('default_make')) : ''),
    h('div', { class: 'dots' }, ...list.map((_x, i) => h('span', { class: i === index ? 'on' : '' }))),
    h('div', { class: 'nav' },
      h('button', { class: 'btn' + (index === 0 ? ' hidden' : ''), id: 'prev', onclick: () => go(index - 1) }, t('onb_back')),
      h('button', { class: 'btn accent', id: 'next', onclick: () => (last ? done() : go(index + 1)) }, last ? t('onb_start') : t('onb_next'))),
  );
  (document.getElementById('next') as HTMLButtonElement).focus();
}

function go(i: number): void {
  if (i < 0 || i >= pages().length) return;
  index = i;
  render();
}

document.addEventListener('keydown', (e) => {
  const rtl = document.documentElement.dir === 'rtl';
  if (e.key === 'ArrowRight') go(index + (rtl ? -1 : 1));
  if (e.key === 'ArrowLeft') go(index + (rtl ? 1 : -1));
  if (e.key === 'Escape') done();
});

void boot(async () => {
  examples = await os.call<ProfileInfo[]>('exampleProfiles');
  const d = await os.call<{ isDefault: boolean; supported: boolean }>('defaultBrowser');
  def = d.supported && !d.isDefault;
  render();
});
