import { boot, h, icon, iconButton, os, t } from '../shared/ui';
import { confirmDialog, contextMenu, toast } from './common';

/** Загрузки (DownloadsActivity.kt): список, ход загрузки, открыть, показать в папке, убрать, очистить. */
interface Download { id: string; name: string; path: string; url: string; time: number; size: number; state: string; received: number; resumable?: boolean }
const app = document.getElementById('app')!;
app.className = 'wrap';

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

async function render(): Promise<void> {
  document.title = t('downloads');
  const { list, folder } = await os.call<{ list: Download[]; folder: string }>('downloads');
  const row = (d: Download) => {
    const pct = d.size > 0 ? Math.min(100, Math.round((d.received / d.size) * 100)) : 0;
    const amount = `${size(d.received)}${d.size ? ' / ' + size(d.size) : ''}`;
    const sub = d.state === 'progress' ? t('downloading', amount)
      : d.state === 'paused' ? t('dt_dl_paused', amount)
      : d.state === 'interrupted' ? (d.resumable ? t('dt_dl_interrupted', amount) : t('download_failed', d.name))
      : d.state === 'completed' ? `${size(d.size)} · ${new Date(d.time).toLocaleString(document.documentElement.lang)}`
      : t('download_failed', d.name);
    const open = async () => { if (!(await os.call<boolean>('dlOpen', d.id))) toast(t('cant_open_file')); };
    const resume = async () => { if (!(await os.call<boolean>('dlResume', d.id))) toast(t('download_failed', d.name)); };
    const going = d.state === 'progress' || d.state === 'paused' || (d.state === 'interrupted' && d.resumable);
    const actions: (HTMLElement | string)[] = [];
    if (d.state === 'progress') actions.push(h('button', { class: 'btn dl-pause', onclick: () => void os.call('dlPause', d.id) }, t('dt_pause')));
    if (d.state === 'paused' || (d.state === 'interrupted' && d.resumable)) actions.push(h('button', { class: 'btn accent dl-resume', onclick: () => void resume() }, t('dt_resume')));
    if (going) actions.push(h('button', { class: 'btn dl-cancel', onclick: () => void os.call('dlCancel', d.id) }, t('cancel')));
    if (d.state === 'completed') actions.push(h('button', { class: 'btn', onclick: open }, t('open')));
    return h('div', { class: 'item', 'data-state': d.state, 'data-id': d.id, oncontextmenu: (e: MouseEvent) => { e.preventDefault(); menu(d, open, e.clientX, e.clientY); } },
      icon('file'),
      h('div', { class: 'grow' }, h('div', { class: 't' }, d.name), h('div', { class: 'u' }, sub),
        going ? h('div', { class: 'bar' + (d.state === 'progress' ? '' : ' stopped') }, h('span', { style: `width:${pct}%` })) : ''),
      ...actions,
      iconButton('more', t('menu'), (e) => menu(d, open, e.clientX, e.clientY)));
  };
  app.replaceChildren(
    h('div', { class: 'row' }, h('h1', { class: 'grow' }, t('downloads')),
      h('button', { class: 'btn', disabled: !list.length, onclick: async () => {
        if (await confirmDialog(t('downloads'), t('dt_downloads_clear_q'), t('clear'))) { await os.call('dlClear'); void render(); }
      } }, t('clear_short'))),
    h('div', { class: 'hint' }, t('dt_downloads_folder', folder)),
    list.length ? h('div', { class: 'card', style: 'margin-top:12px' }, ...list.map(row)) : h('div', { class: 'empty' }, t('downloads_empty')),
  );
}

function menu(d: Download, open: () => void, x: number, y: number): void {
  contextMenu(x, y, [
    d.state === 'completed' ? { label: t('open'), run: open } : null,
    d.state === 'completed' ? { label: t('dt_show_in_folder'), run: () => void os.call('dlShow', d.id) } : null,
    d.url ? { label: t('copy_link'), run: () => { void navigator.clipboard.writeText(d.url).then(() => toast(t('link_copied'))); } } : null,
    { label: t('remove'), danger: true, run: () => void os.call('dlRemove', d.id).then(render) },
  ].filter((x) => x !== null));
}

let pending = false;
os.on('downloads', () => {
  if (pending) return;
  pending = true;
  setTimeout(() => { pending = false; void render(); }, 300);
});
void boot(render);
