import { boot, h, icon, os, t } from '../shared/ui';
import { section } from './common';

/** Проверка безопасности (SecurityCheckActivity.kt): выполняется на компьютере, никуда не отправляется. */
interface Item { id: string; ok: boolean; title: string; text: string }
const app = document.getElementById('app')!;
app.className = 'wrap';

async function render(): Promise<void> {
  document.title = t('security_check');
  const items = await os.call<Item[]>('securityCheck');
  const passed = items.filter((i) => i.ok).length;
  const level = passed === items.length ? 'good' : passed >= items.length - 2 ? 'fair' : 'poor';
  const settingsLink = () => { location.href = 'os://settings/#privacy'; };
  app.replaceChildren(
    h('h1', null, t('security_check')),
    h('div', { class: `card score ${level}`, id: 'score' },
      h('div', { class: 'big' }, `${passed}/${items.length}`),
      h('div', null, h('div', { style: 'font-weight:700' }, t(level === 'good' ? 'sec_good' : level === 'fair' ? 'sec_fair' : 'sec_poor')),
        h('div', { class: 'hint' }, t('sec_score', passed, items.length)))),
    ...section(t('sec_items'), h('div', { class: 'card' }, ...items.map((i) => h('div', { class: `check ${i.ok ? 'ok' : 'bad'}`, 'data-id': i.id },
      h('span', { class: 'mark' }, icon(i.ok ? 'check' : 'close', 14)),
      h('div', { class: 'grow' }, h('div', null, i.title), h('div', { class: 'sub' }, i.text)),
      i.ok ? '' : h('button', { class: 'btn', onclick: settingsLink }, t('sec_fix')))))),
    h('div', { class: 'hint' }, t('sec_local_note')),
  );
}

void boot(render);
