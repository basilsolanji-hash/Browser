/**
 * Главный экран: первые N профилей и разделы по папкам (по алфавиту, «Без папки» — последним).
 * Без electron и DOM — для тестов.
 */
export const VISIBLE_PROFILES = 10;

export interface FolderSection<T> { folder: string; items: T[] }

/** Сколько показать: свёрнутый список — первые [limit], развёрнутый — все. */
export const visibleProfiles = <T>(list: T[], expanded: boolean, limit = VISIBLE_PROFILES): T[] => (expanded ? list : list.slice(0, limit));

/** Разложить профили по папкам; порядок внутри папки — как в списке. Без папок — один раздел. */
export function byFolder<T>(list: T[], folderOf: (x: T) => string, lang = 'en'): FolderSection<T>[] {
  const map = new Map<string, T[]>();
  for (const it of list) {
    const f = folderOf(it).trim();
    if (!map.has(f)) map.set(f, []);
    map.get(f)!.push(it);
  }
  const names = [...map.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, lang, { sensitivity: 'base' }));
  if (map.has('')) names.push('');
  return names.map((folder) => ({ folder, items: map.get(folder)! }));
}
