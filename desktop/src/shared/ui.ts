import { format } from './format';
import { iconSvg } from './icons';
import type { Palette, UiInit } from './types';

/** Общее для шапки и своих экранов: мост, переводы, тема, построение DOM. */
interface Bridge {
  call<T = unknown>(cmd: string, ...args: unknown[]): Promise<T>;
  on(name: string, cb: (data: unknown) => void): void;
}

declare global {
  interface Window { os: Bridge }
}

export const os: Bridge = window.os;
let S: Record<string, string> = {};
export let init: UiInit;

export function t(key: string, ...args: unknown[]): string {
  return format(S[key] ?? key, args);
}

/** Текст, сохранённый ключом перевода («@ex_work_name»). */
export const local = (s: string) => (s.startsWith('@') ? t(s.slice(1)) : s);

function applyPalette(p: Palette): void {
  const r = document.documentElement.style;
  r.setProperty('--bg', p.bg);
  r.setProperty('--surface', p.surface);
  r.setProperty('--border', p.border);
  r.setProperty('--text', p.text);
  r.setProperty('--muted', p.muted);
  r.setProperty('--accent', p.accent);
  r.setProperty('--on-accent', p.onAccent);
  document.documentElement.style.colorScheme = p.dark ? 'dark' : 'light';
  document.documentElement.dataset.dark = String(p.dark);
}

/** Загрузить язык и тему, отрисовать; при смене языка или темы — перерисовать без перезагрузки. */
export async function boot(render: () => void | Promise<void>): Promise<void> {
  const load = async () => {
    init = await os.call<UiInit>('init');
    S = init.strings;
    document.documentElement.lang = init.lang;
    document.documentElement.dir = init.rtl ? 'rtl' : 'ltr';
    document.documentElement.dataset.platform = init.platform;
    applyPalette(init.palette);
  };
  await load();
  await render();
  os.on('look', async () => { await load(); await render(); });
}

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: string };

/** Небольшой построитель DOM: h('button', { class: 'x', onclick }, 'текст'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) if (c != null && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

export function icon(name: string, size = 20): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'ic';
  s.innerHTML = iconSvg(name, size);
  return s;
}

export function svg(markup: string, cls: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.innerHTML = markup;
  return s;
}

/** Кнопка-значок с подсказкой. */
export function iconButton(name: string, label: string, onclick: (e: MouseEvent) => void, cls = ''): HTMLButtonElement {
  return h('button', { class: 'icon-btn ' + cls, title: label, 'aria-label': label, onclick }, icon(name));
}
