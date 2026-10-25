import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload вкладок сайтов: веб-уведомления и разрешение на отправку файлов. Стандартный Notification показывается как
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
