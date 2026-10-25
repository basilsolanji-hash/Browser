/**
 * Поисковый запрос из адреса страницы результатов поисковика (AddressPanel.kt): DuckDuckGo, Startpage,
 * Brave, Google, Bing — параметр q или query, Яндекс — text. Нужен для подсказок «прошлые запросы».
 */
const ENGINES: { host: RegExp; path: RegExp; params: string[] }[] = [
  { host: /(^|\.)duckduckgo\.com$/, path: /^\/$|^\/html\/?$/, params: ['q'] },
  { host: /(^|\.)startpage\.com$/, path: /^\/(do\/)?(search|dsearch|asearch)/, params: ['query', 'q'] },
  { host: /(^|\.)search\.brave\.com$/, path: /^\/search/, params: ['q'] },
  { host: /(^|\.)google\.[a-z.]+$/, path: /^\/search/, params: ['q'] },
  { host: /(^|\.)bing\.com$/, path: /^\/search/, params: ['q'] },
  { host: /(^|\.)(yandex|ya)\.(ru|com|by|kz|com\.tr)$/, path: /^\/search/, params: ['text'] },
];

export function searchQuery(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const e = ENGINES.find((x) => x.host.test(host) && x.path.test(u.pathname));
  if (!e) return null;
  for (const p of e.params) {
    const v = u.searchParams.get(p)?.replace(/\s+/g, ' ').trim();
    if (v) return v;
  }
  return null;
}
