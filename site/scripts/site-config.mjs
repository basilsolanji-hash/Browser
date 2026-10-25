// Адрес и базовый путь сайта — одно место для сборки, тестового сервера и приёмки.
// Свой домен задаётся в src/data/links.json (siteUrl): тогда сайт в корне домена.
// Без него — GitHub Pages проекта (…github.io/Browser). SITE_URL / SITE_BASE переопределяют.
import { readFileSync } from 'node:fs';

const links = JSON.parse(readFileSync(new URL('../src/data/links.json', import.meta.url), 'utf8'));
export const SITE = process.env.SITE_URL || links.siteUrl || 'https://basilsolanji-hash.github.io';
export const BASE = process.env.SITE_BASE ?? (links.siteUrl ? '' : '/Browser');
