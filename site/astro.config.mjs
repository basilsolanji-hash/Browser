// Сайт Оси: статическая сборка. Адрес и базовый путь берутся из окружения,
// чтобы при переезде на свой домен не править код (SITE_URL, SITE_BASE).
// CSS встраивается в страницу: на первом экране нет блокирующего запроса стилей (LCP ≤ 1,5 с).
import { defineConfig } from 'astro/config';

const site = process.env.SITE_URL || 'https://basilsolanji-hash.github.io';
const base = process.env.SITE_BASE ?? '/Browser';

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'always', assets: '_assets' },
  compressHTML: true,
  devToolbar: { enabled: false },
});
