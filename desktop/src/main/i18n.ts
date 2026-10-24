import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, LANGS, RTL } from '../shared/format';
import { settings } from './settings';

/** Переводы интерфейса (генерируются из Tr*.kt Android-версии). Язык — из настроек или системы. */
const cache = new Map<string, Record<string, string>>();
let lang = 'en';

function dict(code: string): Record<string, string> {
  let d = cache.get(code);
  if (!d) {
    d = JSON.parse(readFileSync(join(__dirname, '..', 'i18n', code + '.json'), 'utf8')) as Record<string, string>;
    cache.set(code, d);
  }
  return d;
}

/** Определить язык: «system» — язык Windows, если он поддержан, иначе английский. */
export function applyLanguage(): void {
  const chosen = settings.get().lang;
  const sys = app.getPreferredSystemLanguages()[0]?.split('-')[0] ?? app.getLocale().split('-')[0];
  const code = chosen === 'system' ? sys : chosen;
  lang = (LANGS as readonly string[]).includes(code) ? code : 'en';
}

export const currentLang = () => lang;
export const isRtl = () => RTL.has(lang);
export const strings = () => dict(lang);

export function t(key: string, ...args: unknown[]): string {
  const s = dict(lang)[key] ?? dict('en')[key] ?? key;
  return format(s, args);
}

/** Текст, сохранённый ключом перевода («@ex_work_name»), показывается на языке интерфейса. */
export function local(stored: string | undefined | null): string | undefined {
  if (stored == null) return undefined;
  return stored.startsWith('@') ? t(stored.slice(1)) : stored;
}
