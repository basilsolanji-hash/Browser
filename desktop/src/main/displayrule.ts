import type { Mode } from './permissions';

/** Чистая логика решения по запросу показа экрана (без electron — для unit-теста). */
export type DisplayDecision = 'deny' | 'blocked' | 'ask';

export interface DisplayCheck {
  /** Хост ВКЛАДКИ (не фрейма) — как для камеры; пусто, если адрес не http(s). */
  host: string;
  /** Origin фрейма, запросившего показ. */
  securityOrigin: string;
  /** Окно, владеющее вкладкой, найдено. */
  hasWindow: boolean;
  /** Окно заблокировано PIN-ом. */
  locked: boolean;
  /** Решение для сайта (в разрешениях). */
  mode: Mode;
  videoRequested: boolean;
}

const isHttp = (u: string) => /^https?:\/\//i.test(u);

/** Что делать с запросом: отказать молча, отказать с подсказкой «запрещено для сайта» или показать выбор. */
export function decideDisplay(c: DisplayCheck): DisplayDecision {
  if (!c.host || !c.hasWindow || c.locked || !c.videoRequested || !isHttp(c.securityOrigin)) return 'deny';
  if (c.mode === 'BLOCK') return 'blocked';
  // ALLOW для показа экрана невозможен (permissions.ts), но на случай ручной правки — всё равно спрашиваем.
  return 'ask';
}
