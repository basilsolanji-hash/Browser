import { boot, h, os, t } from '../shared/ui';
import { section, toast } from './common';

/** Справка и отзывы (HelpActivity.kt): ответы на частые вопросы и письмо разработчику. */
const app = document.getElementById('app')!;
app.className = 'wrap';

void boot(async () => {
  document.title = t('help_feedback');
  const email = await os.call<string>('feedbackEmail');
  const qa = [1, 2, 3, 4, 5, 6].map((i) => h('div', { class: 'qa' }, h('div', { class: 'q' }, t(`help_q${i}`)), h('div', { class: 'a' }, t(`dt_help_a${i}`))));
  app.replaceChildren(
    h('h1', null, t('help_feedback')),
    ...section(t('help'), h('div', { class: 'card' }, ...qa)),
    ...section(t('feedback'),
      h('div', { class: 'hint' }, t('feedback_desc', email)),
      h('div', { class: 'links' },
        h('button', { class: 'btn accent', id: 'send-feedback', onclick: () => void os.call('feedback', 'feedback') }, t('send_feedback')),
        h('button', { class: 'btn', onclick: () => void os.call('feedback', 'problem') }, t('report_problem')),
        h('button', { class: 'btn', onclick: () => { void navigator.clipboard.writeText(email).then(() => toast(t('copied'))); } }, t('copy') + ' ' + email))),
    h('div', { style: 'margin-top:16px' }, h('a', { class: 'btn', href: 'os://onboarding/', style: 'text-decoration:none;color:inherit' }, t('onb_again'))),
  );
});
