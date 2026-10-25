import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload вкладок сайтов: веб-уведомления, разрешение на отправку файлов и формы входа (пароли — ниже). Стандартный Notification показывается как
 * уведомление Windows с именем профиля (Notify.kt). Других мостов у сайтов нет: в window ничего
 * не добавляется, обмен идёт событиями DOM, а разрешение проверяет главный процесс.
 */
contextBridge.executeInMainWorld({
  func: () => {
    const Orig = window.Notification;
    if (!Orig) return;
    let seq = 0;
    const live = new Map<string, EventTarget>();
    class OsNotification extends EventTarget {
      title: string; body: string; tag: string; data: unknown; icon: string; dir = 'auto'; lang = '';
      onclick: ((e: Event) => void) | null = null;
      onshow: ((e: Event) => void) | null = null;
      onclose: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      constructor(title: string, opts: NotificationOptions = {}) {
        super();
        this.title = String(title);
        this.body = String(opts.body ?? '');
        this.tag = String(opts.tag ?? '');
        this.icon = String(opts.icon ?? '');
        this.data = opts.data;
        const fire = (type: string) => {
          const e = new Event(type);
          this.dispatchEvent(e);
          (this as unknown as Record<string, ((e: Event) => void) | null>)['on' + type]?.(e);
        };
        if (Orig.permission !== 'granted') {
          setTimeout(() => fire('error'));
          return;
        }
        const id = String(++seq);
        live.set(id, this);
        (this as unknown as { fire: (t: string) => void }).fire = fire;
        window.dispatchEvent(new CustomEvent('os-notify', { detail: JSON.stringify({ id, title: this.title, body: this.body, tag: this.tag }) }));
        setTimeout(() => fire('show'));
      }
      close(): void {
        (this as unknown as { fire?: (t: string) => void }).fire?.('close');
      }
      static get permission(): NotificationPermission { return Orig.permission; }
      static requestPermission(cb?: NotificationPermissionCallback): Promise<NotificationPermission> { return Orig.requestPermission(cb); }
      static get maxActions(): number { return 0; }
    }
    window.addEventListener('os-notify-click', (e) => {
      const n = live.get(String((e as CustomEvent).detail)) as unknown as { fire?: (t: string) => void } | undefined;
      n?.fire?.('click');
    });
    Object.defineProperty(window, 'Notification', { value: OsNotification, writable: true, configurable: true });
  },
});

window.addEventListener('os-notify', (e) => {
  const d = (e as CustomEvent).detail;
  if (typeof d === 'string' && d.length < 8000) ipcRenderer.send('tab:notify', d);
});
ipcRenderer.on('tab:notify-click', (_e, id: string) => {
  window.dispatchEvent(new CustomEvent('os-notify-click', { detail: String(id) }));
});

/**
 * Отправка файлов (<input type=file>): перед окном выбора спрашиваем разрешение сайта у главного процесса.
 * «Запретить» — окно не открывается; «Спросить» — после «Разрешить» в карточке окно открывается само.
 * Слушатель — в изолированном мире preload, сайт его не видит и не может снять.
 */
let waiting: HTMLInputElement | null = null;
let allowOnce = false;
window.addEventListener('click', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || el.type !== 'file') return;
  if (allowOnce) { allowOnce = false; return; }
  let mode = 'ALLOW';
  try { mode = String(ipcRenderer.sendSync('tab:upload')); } catch { /* окно закрывается */ }
  if (mode === 'ALLOW') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  waiting = mode === 'ASK' ? el : null;
}, true);
ipcRenderer.on('tab:upload-go', () => {
  const el = waiting;
  waiting = null;
  if (el?.isConnected) { allowOnce = true; el.click(); }
});

// --- Формы входа (изолированный мир preload): сайт не видит ни этот код, ни переданные пароли. ---
// Главный процесс сам проверяет вкладку, профиль и сайт; отсюда уходят только логин и пароль формы.
const visible = (el: HTMLInputElement) => !el.disabled && el.type !== 'hidden' && (el.offsetWidth > 0 || el.offsetHeight > 0);

/** Поле пароля и поле логина перед ним (текст, почта, телефон) в той же форме или на странице. */
function loginFields(root: ParentNode): { user: HTMLInputElement | null; pass: HTMLInputElement } | null {
  const inputs = [...root.querySelectorAll('input')];
  const pass = inputs.find((i) => i.type === 'password' && visible(i)) ?? inputs.find((i) => i.type === 'password');
  if (!pass) return null;
  const before = inputs.slice(0, inputs.indexOf(pass)).filter((i) => /^(text|email|tel)$/.test(i.type) && visible(i));
  const user = inputs.find((i) => i.autocomplete === 'username') ?? before[before.length - 1] ?? null;
  return { user, pass };
}

document.addEventListener('submit', (e) => {
  const f = e.target instanceof HTMLFormElement ? loginFields(e.target) : null;
  if (!f || !f.pass.value) return;
  ipcRenderer.send('tab:pw-submit', JSON.stringify({ u: f.user?.value ?? '', p: f.pass.value }));
}, true);

let asked = false;
// Подстановка — только в формы входа: поля нового пароля (регистрация) не заполняем.
const LOGIN_FIELD = 'input[type="password"]:not([autocomplete~="new-password"])';
function checkForm(): void {
  if (asked || !document.querySelector(LOGIN_FIELD)) return;
  asked = true;
  ipcRenderer.send('tab:pw-form');
}
window.addEventListener('DOMContentLoaded', () => {
  checkForm();
  if (asked) return;
  // Форма может появиться позже (страницы на скриптах): следим недолго.
  const obs = new MutationObserver(() => { checkForm(); if (asked) obs.disconnect(); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 15000);
});

ipcRenderer.on('tab:pw-fill', (_e, d: { u?: unknown; p?: unknown }) => {
  const field = document.querySelector<HTMLInputElement>(LOGIN_FIELD);
  const f = field ? loginFields(field.form ?? document) : null;
  if (!f || typeof d?.p !== 'string' || f.pass.autocomplete.includes('new-password')) return;
  const set = (el: HTMLInputElement, v: string) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (f.user && typeof d.u === 'string' && d.u) set(f.user, d.u);
  set(f.pass, d.p);
});
