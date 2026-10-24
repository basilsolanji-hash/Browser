import { boot, h, t } from '../shared/ui';

/** Сохранённые страницы (SavedPagesActivity.kt). Сохранение в PDF появится на этапе 2. */
const app = document.getElementById('app')!;
app.className = 'wrap';

void boot(() => {
  document.title = t('saved_pages');
  app.replaceChildren(h('h1', null, t('saved_pages')), h('div', { class: 'empty' }, t('saved_empty')));
});
