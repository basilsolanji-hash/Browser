// Сайт Оси: статическая сборка. Адрес и базовый путь — scripts/site-config.mjs (свой домен из links.json).
// CSS встраивается в страницу: на первом экране нет блокирующего запроса стилей (LCP ≤ 1,5 с).
import { defineConfig } from 'astro/config';
import { SITE, BASE } from './scripts/site-config.mjs';

const site = SITE;
const base = BASE;

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'always', assets: '_assets' },
  compressHTML: true,
  devToolbar: { enabled: false },
});
