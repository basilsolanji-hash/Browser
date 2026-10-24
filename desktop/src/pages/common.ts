import { h, icon, t } from '../shared/ui';

/** Диалоги и меню своих экранов (вместо системных alert/prompt — в стиле Оси и с переводами). */

export function modal(build: (close: () => void) => HTMLElement[]): () => void {
  const bg = h('div', { class: 'modal-bg' });
  const close = () => bg.remove();
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, ...build(close));
  bg.append(box);
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.body.append(bg);
  (box.querySelector('input,textarea') as HTMLElement | null ?? box.querySelector('.btn.accent') as HTMLElement | null)?.focus();
  return close;
}

export function confirmDialog(title: string, message: string, ok: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean, close: () => void) => { done = true; close(); resolve(v); };
    const close = modal((c) => [
      h('h3', null, title),
      message ? h('p', null, message) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => finish(false, c) }, t('cancel')),
        h('button', { class: 'btn accent' + (danger ? ' danger-accent' : ''), onclick: () => finish(true, c) }, ok)),
    ].filter(Boolean) as HTMLElement[]);
    const obs = new MutationObserver(() => {
      if (!document.querySelector('.modal-bg')) { obs.disconnect(); if (!done) resolve(false); }
    });
    obs.observe(document.body, { childList: true });
    void close;
  });
}

/** Ввод одной или двух строк (название и адрес). null — отмена. */
export function promptDialog(title: string, fields: { value: string; placeholder: string }[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    let done = false;
    const inputs = fields.map((f) => h('input', { type: 'text', value: f.value, placeholder: f.placeholder, spellcheck: false }));
    const submit = (c: () => void) => { done = true; c(); resolve(inputs.map((i) => i.value)); };
    modal((c) => {
      inputs.forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(c); }));
      return [
        h('h3', null, title),
        ...inputs,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => { done = true; c(); resolve(null); } }, t('cancel')),
          h('button', { class: 'btn accent', onclick: () => submit(c) }, t('save'))),
      ];
    });
    const obs = new MutationObserver(() => {
      if (!document.querySelector('.modal-bg')) { obs.disconnect(); if (!done) resolve(null); }
    });
    obs.observe(document.body, { childList: true });
  });
}

export function toast(text: string): void {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

export interface CtxItem { label: string; icon?: string; danger?: boolean; run: () => void }

/** Контекстное меню (правая кнопка или «⋮» у строки). */
export function contextMenu(x: number, y: number, items: (CtxItem | null)[]): void {
  document.querySelector('.ctx')?.remove();
  const box = h('div', { class: 'ctx', role: 'menu' });
  for (const it of items) {
    if (!it) { box.append(h('div', { class: 'sep' })); continue; }
    box.append(h('button', {
      role: 'menuitem', class: it.danger ? 'danger' : '',
      onclick: () => { box.remove(); it.run(); },
    }, it.icon ? icon(it.icon, 18) : null, it.label));
  }
  document.body.append(box);
  const r = box.getBoundingClientRect();
  box.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
  box.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
  (box.querySelector('button') as HTMLElement | null)?.focus();
  const off = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== 'Escape') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const b = [...box.querySelectorAll('button')];
        const i = b.indexOf(document.activeElement as HTMLButtonElement);
        b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length]?.focus();
        e.preventDefault();
      }
      return;
    }
    if (e.type === 'mousedown' && box.contains(e.target as Node)) return;
    box.remove();
    document.removeEventListener('mousedown', off, true);
    document.removeEventListener('keydown', off, true);
  };
  document.addEventListener('mousedown', off, true);
  document.addEventListener('keydown', off, true);
}

export function section(title: string, ...children: (HTMLElement | null)[]): HTMLElement[] {
  return [h('h2', null, title), ...children.filter((c): c is HTMLElement => !!c)];
}

export const param = (name: string) => new URLSearchParams(location.search).get(name);
