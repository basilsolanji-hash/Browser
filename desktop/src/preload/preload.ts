import { contextBridge, ipcRenderer } from 'electron';

/**
 * Мост только для своих страниц (os://): шапка браузера и экраны. Сайтам мост не выдаётся —
 * у вкладок сайтов preload вообще нет, а здесь дополнительно проверяем схему.
 */
if (location.protocol === 'os:') {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  ipcRenderer.on('os:event', (_e, name: string, data: unknown) => {
    listeners.get(name)?.forEach((cb) => cb(data));
  });
  contextBridge.exposeInMainWorld('os', {
    call: (cmd: string, ...args: unknown[]) => ipcRenderer.invoke('os', cmd, ...args),
    on: (name: string, cb: (data: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(cb);
    },
  });
}
