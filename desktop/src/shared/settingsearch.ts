/**
 * Поиск в настройках (SettingsActivity.filter): по заголовкам и подписям пунктов всех групп.
 * Без electron и DOM: страница собирает пункты, здесь — только сопоставление (и для тестов).
 */
export interface SettingItem { id: string; group: string; section: string; texts: string[] }

const norm = (s: string) => s.toLocaleLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Пункты, подходящие под запрос: каждое слово запроса — в заголовке раздела или в текстах пункта. */
export function searchSettings(items: SettingItem[], query: string): SettingItem[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  return items.filter((it) => {
    const hay = norm([it.section, ...it.texts].join(' '));
    return words.every((w) => hay.includes(w));
  });
}

/** Краткое содержимое группы для карточки на главной настроек: названия её разделов без повторов. */
export function groupSummary(items: SettingItem[], group: string, groupTitle: string, max = 6): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.group !== group) continue;
    const s = it.section.trim();
    if (s && norm(s) !== norm(groupTitle) && !out.some((x) => norm(x) === norm(s))) out.push(s);
  }
  return out.slice(0, max);
}
