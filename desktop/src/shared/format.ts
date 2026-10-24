/** Подстановка аргументов как String.format в Kotlin: %s, %d, %1$s, %2$d, %%. */
export function format(s: string, args: unknown[]): string {
  if (!args.length) return s;
  let next = 0;
  return s.replace(/%(?:(\d+)\$)?([sd%])/g, (_m, pos: string | undefined, kind: string) => {
    if (kind === '%') return '%';
    const v = pos ? args[Number(pos) - 1] : args[next++];
    return kind === 'd' ? String(Math.trunc(Number(v))) : String(v ?? '');
  });
}

export const LANGS = ['en', 'ru', 'es', 'pt', 'fr', 'de', 'ar', 'hi', 'tr', 'zh'] as const;
export const LANG_NAMES: Record<string, string> = {
  en: 'English', ru: 'Русский', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch',
  ar: 'العربية', hi: 'हिन्दी', tr: 'Türkçe', zh: '中文',
};
export const RTL = new Set(['ar']);
