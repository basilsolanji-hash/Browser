/**
 * Группы по дням («Только что», «Сегодня — 25 окт. 2026 г.», «Вчера — …», дата) для истории и загрузок
 * и диапазоны очистки данных (ClearDataActivity.RANGES). Без electron: используется и в тестах.
 */

/** Начало суток по местному времени. */
export function dayStart(time: number): number {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Сколько календарных дней между днём [time] и сегодня (0 — сегодня, 1 — вчера). Переход на летнее время не мешает. */
export function daysAgo(time: number, now: number): number {
  const a = new Date(dayStart(time));
  const b = new Date(dayStart(now));
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);
}

export interface DayGroup<T> { key: string; day: number; ago: number; items: T[] }

/** Разложить записи по дням (новые сверху; порядок внутри дня сохраняется). */
export function groupByDay<T>(items: T[], timeOf: (x: T) => number, now: number): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  const byDay = new Map<number, DayGroup<T>>();
  for (const it of [...items].sort((a, b) => timeOf(b) - timeOf(a))) {
    const day = dayStart(timeOf(it));
    let g = byDay.get(day);
    if (!g) {
      g = { key: String(day), day, ago: daysAgo(day, now), items: [] };
      byDay.set(day, g);
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

/** «Только что» на экране загрузок: идущие загрузки и скачанные за последние 5 минут. */
export const JUST_NOW_MS = 5 * 60_000;

export function groupDownloads<T>(items: T[], timeOf: (x: T) => number, active: (x: T) => boolean, now: number): DayGroup<T>[] {
  const recent = items.filter((x) => active(x) || now - timeOf(x) < JUST_NOW_MS);
  const rest = items.filter((x) => !recent.includes(x));
  const groups = groupByDay(rest, timeOf, now);
  if (recent.length) groups.unshift({ key: 'just', day: dayStart(now), ago: -1, items: recent });
  return groups;
}

/** Подпись группы: «Сегодня — 25 окт. 2026 г.» и т.п. на языке интерфейса. [labels] — переведённые шаблоны с %s. */
export function dayTitle(g: { day: number; ago: number }, lang: string, labels: { just: string; today: string; yesterday: string }): string {
  if (g.ago < 0) return labels.just;
  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(g.day));
  if (g.ago === 0) return labels.today.replace('%s', date);
  if (g.ago === 1) return labels.yesterday.replace('%s', date);
  return date;
}

/** Диапазоны «Удалить данные о работе в браузере»: ключ подписи и длительность (0 — всё время). */
export const RANGES: { key: string; ms: number }[] = [
  { key: 'range_15m', ms: 15 * 60_000 },
  { key: 'range_1h', ms: 3_600_000 },
  { key: 'range_24h', ms: 86_400_000 },
  { key: 'range_7d', ms: 7 * 86_400_000 },
  { key: 'range_4w', ms: 28 * 86_400_000 },
  { key: 'range_all', ms: 0 },
];
export const DEFAULT_RANGE = 'range_all';

/** С какого момента удалять (мс); 0 — всё. Неизвестный диапазон — ничего не удаляем по времени: всё время только явно. */
export function sinceFor(range: string, now: number): number {
  const r = RANGES.find((x) => x.key === range);
  if (!r) return now;
  return r.ms === 0 ? 0 : now - r.ms;
}

export const countSince = <T>(items: T[], timeOf: (x: T) => number, since: number) => items.filter((x) => timeOf(x) >= since).length;
