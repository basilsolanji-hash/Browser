import { boot, h, icon, iconButton, os, t } from '../shared/ui';
import { confirmDialog, contextMenu, toast } from './common';
import { FILE_KINDS, etaParts, formatSize, kindOf, matchesDownload } from '../shared/filetype';
import { dayTitle, groupDownloads } from '../shared/days';

/**
 * «Скачанные файлы» как в Chrome (DownloadsActivity.kt): поиск, «Очистить», место на диске, чипы типов,
 * группы «Только что» / «Сегодня» / «Вчера» / дата, у идущей загрузки — кольцо, «осталось», «X из Y».
 */
interface Download {
  id: string; name: string; path: string; url: string; time: number; size: number; state: string; received: number;
  mime?: string; resumable?: boolean; pending?: boolean; eta: number | null;
}
interface Data { list: Download[]; folder: string; disk: { free: number; total: number } | null; openWith: boolean }

const app = document.getElementById('app')!;
app.className = 'wrap';
const KIND_ICON: Record<string, string> = { all: 'file', images: 'image', audio: 'audio', video: 'video', docs: 'note', other: 'file' };
let filter = 'all';
let query = '';
let data: Data | null = null;
const listBox = h('div', { id: 'dl-list' });
const diskLine = h('div', { class: 'hint disk', id: 'dl-disk' });
const chipsBox = h('div', { class: 'chips', role: 'tablist' });

const lang = () => document.documentElement.lang || 'en';
const size = (n: number) => formatSize(n, lang());
const running = (d: Download) => d.state === 'progress' || d.state === 'paused' || (d.state === 'interrupted' && !!d.resumable) || !!d.pending;

/** Кольцо прогресса (fraction < 0 — размер неизвестен: дуга без процента). */
function ring(fraction: number, stopped: boolean): HTMLElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 44 44');
  svg.setAttribute('class', 'ring' + (stopped ? ' stopped' : '') + (fraction < 0 ? ' busy' : ''));
  const c = (cls: string) => {
    const el = document.createElementNS(ns, 'circle');
    el.setAttribute('cx', '22'); el.setAttribute('cy', '22'); el.setAttribute('r', '19'); el.setAttribute('class', cls);
    return el;
  };
  const arc = c('arc');
  const len = 2 * Math.PI * 19;
  const f = fraction < 0 ? 0.25 : Math.max(0.02, Math.min(1, fraction));
  arc.setAttribute('stroke-dasharray', `${len * f} ${len}`);
  svg.append(c('track'), arc);
  const box = h('div', { class: 'lead ringbox', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100',
    'aria-valuenow': fraction < 0 ? null : String(Math.round(fraction * 100)) });
  box.append(svg, icon('download', 18));
  return box;
}

function eta(sec: number | null): string {
  const e = etaParts(sec);
  return e ? t('dl_left', t(e.unit === 'sec' ? 'dl_sec' : 'dl_min', e.value)) : '';
}

function row(d: Download): HTMLElement {
  const go = running(d);
  const amount = d.size > 0 ? t('dl_of', size(d.received), size(d.size)) : size(d.received);
  const time = new Date(d.time).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' });
  const sub = d.pending ? [t('dt_dl_waiting'), amount].join(' • ')
    : d.state === 'progress' ? [eta(d.eta), amount].filter(Boolean).join(' • ')
    : d.state === 'paused' ? t('dt_dl_paused', amount)
    : d.state === 'interrupted' ? (d.resumable ? t('dt_dl_interrupted', amount) : t('download_failed', d.name))
    : d.state === 'completed' ? [d.size > 0 ? size(d.size) : '', time].filter(Boolean).join(' • ')
    : t('download_failed', d.name);
  const actions: HTMLElement[] = [];
  if (d.state === 'progress' && !d.pending) actions.push(h('button', { class: 'btn dl-pause', onclick: () => void os.call('dlPause', d.id) }, t('dt_pause')));
  if (d.state === 'paused' || (d.state === 'interrupted' && d.resumable)) actions.push(h('button', { class: 'btn accent dl-resume', onclick: () => void resume(d) }, t('dt_resume')));
  if (go && !d.pending) actions.push(iconButton('close', t('cancel'), () => void os.call('dlCancel', d.id), 'dl-cancel'));
  const done = d.state === 'completed' && !d.pending;
  const lead = go
    ? ring(d.size > 0 ? d.received / d.size : -1, d.state !== 'progress')
    : h('div', { class: 'lead kind' }, icon(KIND_ICON[kindOf(d.mime, d.name)] ?? 'file', 22));
  const el = h('div', {
    class: 'item' + (done ? ' openable' : ''), 'data-state': d.state, 'data-id': d.id, 'data-kind': kindOf(d.mime, d.name),
    tabindex: done ? '0' : null,
    onclick: (e: MouseEvent) => { if (done && !(e.target as HTMLElement).closest('button')) void open(d); },
    onkeydown: (e: KeyboardEvent) => { if (done && e.key === 'Enter') void open(d); },
    oncontextmenu: (e: MouseEvent) => { e.preventDefault(); menu(d, e.clientX, e.clientY); },
  },
  lead,
  h('div', { class: 'grow' }, h('div', { class: 't', title: d.name }, d.name), h('div', { class: 'u' }, sub)),
  ...actions,
  iconButton('more', t('menu'), (e) => { e.stopPropagation(); menu(d, e.clientX, e.clientY); }, 'dl-more'));
  return el;
}

async function open(d: Download): Promise<void> {
  if (!(await os.call<boolean>('dlOpen', d.id))) toast(t('cant_open_file'));
}

async function resume(d: Download): Promise<void> {
  if (!(await os.call<boolean>('dlResume', d.id))) toast(t('download_failed', d.name));
}

/** Меню строки: Открыть · Открыть с помощью · Показать в папке · Поделиться · Удалить. */
function menu(d: Download, x: number, y: number): void {
  const done = d.state === 'completed' && !d.pending;
  contextMenu(x, y, [
    done ? { label: t('open'), icon: 'forward', run: () => void open(d) } : null,
    done && data?.openWith ? { label: t('open_with'), icon: 'file', run: () => void os.call('dlOpenWith', d.id) } : null,
    done ? { label: t('dt_show_in_folder'), icon: 'folder', run: () => void os.call('dlShow', d.id) } : null,
    { label: t('share'), icon: 'globe', run: () => share(d, x, y) },
    null,
    { label: t('delete'), icon: 'delete', danger: true, run: () => void remove(d) },
  ].filter((v, i, a) => v !== null || (i > 0 && a[i - 1] !== null)));
}

/** «Поделиться»: скопировать путь к файлу или ссылку, откуда он скачан. */
function share(d: Download, x: number, y: number): void {
  contextMenu(x, y, [
    { label: t('dt_copy_path'), run: () => void os.call('dlCopy', d.id, 'path').then(() => toast(t('copied'))) },
    d.url ? { label: t('copy_link'), run: () => void os.call('dlCopy', d.id, 'url').then(() => toast(t('link_copied'))) } : null,
  ].filter((v) => v !== null));
}

async function remove(d: Download): Promise<void> {
  if (d.state === 'completed' && !(await confirmDialog(t('delete'), t('dt_dl_delete_q', d.name), t('delete'), true))) return;
  await os.call('dlDelete', d.id);
  void load();
}

function renderList(): void {
  if (!data) return;
  const items = data.list.filter((d) => matchesDownload(d, filter, query));
  chipsBox.replaceChildren(...FILE_KINDS.map((k) => h('button', {
    class: 'chip' + (k === filter ? ' on' : ''), role: 'tab', 'aria-selected': String(k === filter), 'data-kind': k,
    onclick: () => { filter = k; renderList(); },
  }, icon(k === filter ? 'check' : KIND_ICON[k], 18), t('dl_' + k))));
  if (!items.length) {
    listBox.replaceChildren(h('div', { class: 'empty' }, t(!data.list.length || (filter === 'all' && !query.trim()) ? 'downloads_empty' : 'nothing_found')));
    return;
  }
  const labels = { just: t('dl_just_now'), today: t('dl_today'), yesterday: t('dl_yesterday') };
  listBox.replaceChildren(...groupDownloads(items, (d) => d.time, running, Date.now()).flatMap((g) => [
    h('div', { class: 'group-title' }, dayTitle(g, lang(), labels)),
    h('div', { class: 'card' }, ...g.items.map(row)),
  ]));
}

async function load(): Promise<void> {
  data = await os.call<Data>('downloads');
  const disk = data.disk;
  diskLine.textContent = disk ? t('dl_storage', size(disk.total - disk.free), size(disk.total)) : '';
  diskLine.title = t('dt_downloads_folder', data.folder);
  (document.getElementById('dl-clear') as HTMLButtonElement | null)?.toggleAttribute('disabled', !data.list.length);
  renderList();
}

async function render(): Promise<void> {
  document.title = t('dl_title');
  const search = h('input', { type: 'search', id: 'dl-search', placeholder: t('dl_search_hint'), value: query, 'aria-label': t('dl_search_hint'),
    oninput: () => { query = search.value; renderList(); } });
  app.replaceChildren(
    h('div', { class: 'row' }, h('h1', { class: 'grow' }, t('dl_title')),
      h('button', { class: 'btn', id: 'dl-clear', onclick: async () => {
        if (await confirmDialog(t('dl_title'), t('dl_clear_q'), t('clear'))) { await os.call('dlClear'); void load(); }
      } }, icon('delete', 18), t('clear_short'))),
    search,
    h('div', { class: 'row diskrow' }, icon('storage', 18), diskLine),
    chipsBox,
    listBox,
  );
  await load();
}

// Ход загрузок: не чаще раза в 300 мс.
let pending = false;
os.on('downloads', () => {
  if (pending) return;
  pending = true;
  setTimeout(() => { pending = false; void load(); }, 300);
});
void boot(render);
