import { boot, h, icon, iconButton, os, t } from '../shared/ui';
import { confirmDialog, contextMenu, promptDialog, toast } from './common';

/** Сохранённые страницы (SavedPagesActivity.kt): PDF на этом компьютере — открыть, переименовать, удалить. */
interface Saved { id: number; title: string; url: string; time: number; size: number }
const app = document.getElementById('app')!;
app.className = 'wrap';

const size = (n: number) => (n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

async function render(): Promise<void> {
  document.title = t('saved_pages');
  const list = await os.call<Saved[]>('saved');
  const open = async (p: Saved) => { if (!(await os.call<boolean>('savedOpen', p.id))) toast(t('cant_open_file')); };
  app.replaceChildren(
    h('h1', null, t('saved_pages')),
    list.length ? h('div', { class: 'card', style: 'margin-top:12px' }, ...list.map((p) => h('div', {
      class: 'item', oncontextmenu: (e: MouseEvent) => { e.preventDefault(); menu(p, open, e.clientX, e.clientY); },
    }, icon('saved'),
    h('div', { class: 'grow' }, h('div', { class: 't' }, p.title),
      h('div', { class: 'u' }, `${new Date(p.time).toLocaleString(document.documentElement.lang)} · ${size(p.size)} · ${p.url}`)),
    h('button', { class: 'btn', onclick: () => void open(p) }, t('open')),
    iconButton('more', t('menu'), (e) => menu(p, open, e.clientX, e.clientY)))))
      : h('div', { class: 'empty' }, t('dt_saved_empty')),
  );
}

function menu(p: Saved, open: (p: Saved) => void, x: number, y: number): void {
  contextMenu(x, y, [
    { label: t('open'), run: () => open(p) },
    { label: t('dt_show_in_folder'), run: () => void os.call('savedShow', p.id) },
    p.url.startsWith('http') ? { label: t('open_source'), run: async () => void os.call('openIn', await os.call('lastProfile'), p.url) } : null,
    { label: t('rename'), run: async () => {
      const r = await promptDialog(t('rename'), [{ value: p.title, placeholder: p.title }]);
      if (r) { await os.call('savedRename', p.id, r[0]); void render(); }
    } },
    null,
    { label: t('delete'), danger: true, run: async () => {
      if (await confirmDialog(t('delete') + ' «' + p.title + '»?', '', t('delete'), true)) { await os.call('savedRemove', p.id); void render(); }
    } },
  ]);
}

void boot(render);
