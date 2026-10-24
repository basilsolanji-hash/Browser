/** Разбор ввода адресной строки и проверка схем. */

export const START = 'os://start/';

/** Схемы, которые можно открыть во вкладке. Остальное (file:, chrome:, javascript:…) — нельзя. */
export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function isOwnUrl(url: string): boolean {
  return url.startsWith('os://');
}

/** Адрес из ввода пользователя или null — тогда это поисковый запрос. */
export function fromInput(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^https?:\/\/\S+$/i.test(s)) return s;
  if (/^os:\/\/[a-z]+/i.test(s)) return s.toLowerCase().startsWith('os://') ? s : null;
  if (s === 'about:blank') return s;
  if (/\s/.test(s)) return null;
  // Локальные адреса и IP — по http, как в адресной строке Chrome.
  if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i.test(s)) return 'http://' + s;
  if (/^[^/?#:@]+\.[a-z¡-￿]{2,}\.?(:\d{1,5})?([/?#].*)?$/i.test(s)) return 'https://' + s;
  return null;
}

export function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
