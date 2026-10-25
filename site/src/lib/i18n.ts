// Тексты сайта и ссылки по языкам.
import { LANGS, RTL } from '../../scripts/langs.mjs';
import app from '../i18n/app.generated.json';

export { LANGS };
export type Lang = (typeof LANGS)[number];

const dicts = import.meta.glob<Record<string, string>>('../i18n/[a-z][a-z].json', { eager: true, import: 'default' });
const dict = (lang: string) => dicts[`../i18n/${lang}.json`] ?? {};

export const isRtl = (lang: string) => RTL.includes(lang);

/** Перевод по ключу с подстановками {name}; при отсутствии — английский (CI не пропустит пустые ключи). */
export function t(lang: string, key: string, vars: Record<string, string | number> = {}) {
  const s = dict(lang)[key] ?? dict('en')[key];
  if (s === undefined) throw new Error(`Нет ключа перевода: ${key}`);
  // {app:ключ} — название из переводов приложения, чтобы сайт и приложение называли вещи одинаково.
  return s.replace(/\{app:(\w+)\}/g, (_, k) => appText(lang, k)).replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? `{${v}}`));
}

/** Строка из переводов приложения (Tr*.kt). */
export function appText(lang: string, key: string) {
  return (app as Record<string, Record<string, string>>)[lang]?.[key] ?? (app as any).en[key];
}

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
/** Адрес страницы сайта: href(lang, 'download') → /Browser/ru/download/ */
export const href = (lang: string, page = '') => `${base}/${lang}/${page ? page + '/' : ''}`;
export const asset = (path: string) => `${base}/${path.replace(/^\//, '')}`;

export const PAGES = ['', 'download', 'features', 'privacy-security', 'business', 'changelog', 'help', 'press'] as const;

export function fmtDate(lang: string, iso: string) {
  return new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));
}
export function fmtSize(lang: string, bytes: number) {
  return new Intl.NumberFormat(lang, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 0 }).format(bytes / 1048576);
}
