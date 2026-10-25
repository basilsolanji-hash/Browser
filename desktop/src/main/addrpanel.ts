import { searchQuery } from './query';

/**
 * Панель адресной строки (AddressPanel.kt): плитки частых сайтов и подсказки при вводе — только из
 * того, что уже есть в браузере (история и избранное профиля), в сеть ничего не уходит.
 */
export interface Visit { u: string; t: string }
export interface Mark { u: string; t: string }
export interface Tile { host: string; label: string; url: string }
export interface Hint { kind: 'query' | 'favorite' | 'history'; title: string; url: string }

const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname : '';
  } catch {
    return '';
  }
};

/** До 8 частых сайтов по истории; подпись — последний заголовок страницы сайта, иначе домен. */
export function frequentSites(visits: Visit[], n = 8): Tile[] {
  const count = new Map<string, number>();
  for (const v of visits) {
    const h = hostOf(v.u);
    if (h && searchQuery(v.u) == null) count.set(h, (count.get(h) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([host]) => ({
    host,
    label: visits.find((v) => hostOf(v.u) === host && v.t.trim())?.t.trim() ?? host.replace(/^(www|m)\./, ''),
    url: `https://${host}/`,
  }));
}

/** Подсказки под строкой: прошлые запросы (до 4), затем избранное и история (до 6). */
export function hints(text: string, visits: Visit[], marks: Mark[]): Hint[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const has = (s: string) => s.toLowerCase().includes(q);
  const queries: Hint[] = [];
  const seenQ = new Set<string>();
  for (const v of visits) {
    const s = searchQuery(v.u);
    if (!s || !has(s) || s.toLowerCase() === q || seenQ.has(s.toLowerCase())) continue;
    seenQ.add(s.toLowerCase());
    queries.push({ kind: 'query', title: s, url: s });
    if (queries.length >= 4) break;
  }
  const items: Hint[] = [];
  const seen = new Set<string>();
  const add = (kind: 'favorite' | 'history', title: string, url: string) => {
    if (items.length >= 6 || seen.has(url)) return;
    seen.add(url);
    items.push({ kind, title: title.trim() || url, url });
  };
  for (const m of marks) if (has(m.t) || has(m.u)) add('favorite', m.t, m.u);
  for (const v of visits) if (searchQuery(v.u) == null && (has(v.t) || has(v.u))) add('history', v.t, v.u);
  return [...queries, ...items];
}
