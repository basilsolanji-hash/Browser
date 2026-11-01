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
 * Показ экрана (getDisplayMedia): обёртка запоминает полученные треки, чтобы вкладка могла сообщить, что показ
 * закончился (сайт остановил сам, ушёл со страницы), и по команде кнопки «Остановить показ» остановить треки —
 * из главного процесса поток остановить нельзя. События называются случайным именем, известным только этому
 * preload: сайт не может ни подделать «показ закончился» (индикатор погасить), ни отключить остановку.
 * Если остановка не сработала (кадр без preload), главный процесс перезагрузит вкладку.
 */
const shareKey = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
contextBridge.executeInMainWorld({
  func: (key: string) => {
    const md = navigator.mediaDevices;
    const proto = md && Object.getPrototypeOf(md);
    if (!proto || typeof md.getDisplayMedia !== 'function') return;
    // Всё нужное забираем до сценариев страницы, чтобы она не могла подменить.
    const orig = md.getDisplayMedia;
    const dispatch = EventTarget.prototype.dispatchEvent;
    const listen = EventTarget.prototype.addEventListener;
    const Ev = Event;
    const setTick = window.setInterval.bind(window);
    const clearTick = window.clearInterval.bind(window);
    // Методы треков тоже забираем заранее: сайт не должен подменой readyState/stop/clone скрыть живой поток.
    const TP = MediaStreamTrack.prototype;
    const stateOf = Object.getOwnPropertyDescriptor(TP, 'readyState')?.get as (() => string) | undefined;
    const stopTrack = TP.stop;
    const cloneTrack = TP.clone;
    const cloneStream = MediaStream.prototype.clone;
    const streamTracks = MediaStream.prototype.getTracks;
    if (!stateOf) return;
    const ended = (t: MediaStreamTrack) => { try { return stateOf.call(t) === 'ended'; } catch { return true; } };
    const tracks = new Set<MediaStreamTrack>();
    let timer = 0;
    const check = () => {
      const had = tracks.size > 0;
      for (const t of [...tracks]) if (ended(t)) tracks.delete(t);
      if (tracks.size || !had) return;
      clearTick(timer);
      timer = 0;
      dispatch.call(window, new Ev('os-share-end-' + key));
    };
    const add = (t: MediaStreamTrack) => {
      tracks.add(t);
      listen.call(t, 'ended', check);
      if (!timer) timer = setTick(check, 500);
    };
    // Клоны (track.clone(), stream.clone()) — те же живые треки: учитываются, иначе остановкой оригиналов индикатор гасили бы.
    Object.defineProperty(TP, 'clone', { value: function clone(this: MediaStreamTrack): MediaStreamTrack {
      const c = Reflect.apply(cloneTrack, this, []) as MediaStreamTrack;
      if (tracks.has(this)) add(c);
      return c;
    }, writable: true, configurable: true, enumerable: true });
    Object.defineProperty(MediaStream.prototype, 'clone', { value: function clone(this: MediaStream): MediaStream {
      const c = Reflect.apply(cloneStream, this, []) as MediaStream;
      const mine = (Reflect.apply(streamTracks, this, []) as MediaStreamTrack[]).some((t) => tracks.has(t));
      if (mine) for (const t of Reflect.apply(streamTracks, c, []) as MediaStreamTrack[]) add(t);
      return c;
    }, writable: true, configurable: true, enumerable: true });
    const wrapped = async function getDisplayMedia(this: MediaDevices, ...args: unknown[]): Promise<MediaStream> {
      const stream = await Reflect.apply(orig, this, args) as MediaStream;
      // stop() у трека событие ended не вызывает — поэтому add() ещё и включает опрос.
      for (const t of Reflect.apply(streamTracks, stream, []) as MediaStreamTrack[]) add(t);
      return stream;
    };
    Object.defineProperty(proto, 'getDisplayMedia', { value: wrapped, writable: true, configurable: true, enumerable: true });
    listen.call(window, 'os-share-stop-' + key, () => {
      for (const t of [...tracks]) {
        Reflect.apply(stopTrack, t, []);
        dispatch.call(t, new Ev('ended'));
      }
      check();
    });
  },
  args: [shareKey],
});
window.addEventListener('os-share-end-' + shareKey, () => ipcRenderer.send('tab:share', 'end'));
ipcRenderer.on('tab:share-stop', () => window.dispatchEvent(new Event('os-share-stop-' + shareKey)));

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
// Пароль подставляется только после действия пользователя (щелчок или ввод в поле входа) и только
// в видимое поле: скрытые и вынесенные за экран формы — приём трекеров, собирающих логины.

/** Поле видно человеку: не скрыто стилями, есть размер и оно не вынесено за пределы страницы. */
function shown(el: HTMLInputElement): boolean {
  if (!el.isConnected || el.disabled || el.type === 'hidden' || el.offsetParent === null) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || r.right <= 0 || r.bottom + window.scrollY <= 0) return false;
  if (r.left >= Math.max(window.innerWidth, document.documentElement.scrollWidth)) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) return false;
  }
  return true;
}

/** Поле пароля и поле логина перед ним (текст, почта, телефон) в той же форме или на странице. */
function loginFields(root: ParentNode, withNew = false): { user: HTMLInputElement | null; pass: HTMLInputElement } | null {
  const inputs = [...root.querySelectorAll('input')];
  const pass = inputs.find((i) => i.type === 'password' && (withNew || !i.autocomplete.includes('new-password')) && shown(i));
  if (!pass) return null;
  const before = inputs.slice(0, inputs.indexOf(pass)).filter((i) => /^(text|email|tel)$/.test(i.type) && shown(i));
  const named = inputs.find((i) => i.autocomplete === 'username' && shown(i));
  return { user: named ?? before[before.length - 1] ?? null, pass };
}

document.addEventListener('submit', (e) => {
  // При отправке учитываем и регистрацию (новый пароль): Ось предложит его сохранить.
  const f = e.target instanceof HTMLFormElement ? loginFields(e.target, true) : null;
  if (!f || !f.pass.value) return;
  ipcRenderer.send('tab:pw-submit', JSON.stringify({ u: f.user?.value ?? '', p: f.pass.value }));
}, true);

/** Форма, в поле которой пользователь щёлкнул или начал ввод, — только в неё и подставляем. */
let target: ParentNode | null = null;
let askedAt = 0;
function onUserAction(e: Event): void {
  if (!e.isTrusted) return;
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || !/^(password|text|email|tel)$/.test(el.type) || !shown(el)) return;
  const root = el.form ?? document;
  const f = loginFields(root);
  if (!f || (el !== f.pass && el !== f.user)) return;
  target = root;
  // Не засыпаем главный процесс вопросами: одна карточка на несколько секунд.
  if (Date.now() - askedAt < 3000) return;
  askedAt = Date.now();
  ipcRenderer.send('tab:pw-form');
}
document.addEventListener('pointerdown', onUserAction, true);
document.addEventListener('keydown', onUserAction, true);

ipcRenderer.on('tab:pw-fill', (_e, d: { u?: unknown; p?: unknown }) => {
  const f = target ? loginFields(target) : null;
  if (!f || typeof d?.p !== 'string') return;
  const set = (el: HTMLInputElement, v: string) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (f.user && typeof d.u === 'string' && d.u) set(f.user, d.u);
  set(f.pass, d.p);
});
