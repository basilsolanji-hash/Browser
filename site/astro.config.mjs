// Сайт Оси: статическая сборка. Адрес и базовый путь берутся из окружения,
// чтобы при переезде на свой домен не править код (SITE_URL, SITE_BASE).
// CSS встраивается в страницу: на первом экране нет блокирующего запроса стилей (LCP ≤ 1,5 с).
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';

// Свой домен владелец вписывает в src/data/links.json (siteUrl): тогда сайт живёт в корне домена.
const links = JSON.parse(readFileSync(new URL('./src/data/links.json', import.meta.url), 'utf8'));

const site = process.env.SITE_URL || links.siteUrl || 'https://basilsolanji-hash.github.io';
const base = process.env.SITE_BASE ?? (links.siteUrl ? '' : '/Browser');

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'always', assets: '_assets' },
  compressHTML: true,
  devToolbar: { enabled: false },
});
