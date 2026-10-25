// Lighthouse CI (§7 ТЗ): главная и «Скачать» на en/ru, мобильный профиль (по умолчанию).
// Собранный dist/ раздаёт тот же мини-сервер, что и приёмка, — с тем же базовым путём, что у сайта.
// Три прогона и медиана — чтобы случайный скачок нагрузки на раннере не валил проверку.
// Базовый путь — как в scripts/site-config.mjs: свой домен — корень, иначе /Browser (Pages).
const links = require('./src/data/links.json');
const base = process.env.SITE_BASE ?? (links.siteUrl ? '' : '/Browser');
const at = (p) => `http://127.0.0.1:4321${base}${p}`;

module.exports = {
  ci: {
    collect: {
      startServerCommand: 'node test/serve.mjs 4321',
      startServerReadyPattern: '127.0.0.1:4321',
      url: [
        at('/en/'),
        at('/ru/'),
        at('/en/download/'),
        at('/ru/download/'),
      ],
      numberOfRuns: 3,
      // Chromium из Playwright: отдельный Chrome на раннер не ставим.
      chromePath: process.env.CHROME_PATH || undefined,
      settings: { chromeFlags: '--no-sandbox --headless=new' },
    },
    assert: {
      // Медиана по прогонам, а не худший результат.
      aggregationMethod: 'median-run',
      assertions: {
        'categories:performance': ['error', { minScore: 0.95 }],
        'categories:accessibility': ['error', { minScore: 1 }],
        'categories:best-practices': ['error', { minScore: 0.95 }],
        'categories:seo': ['error', { minScore: 1 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 1500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
      },
    },
    // Отчёты складываем рядом и публикуем в ветку результатов; в чужие хранилища не отправляем.
    upload: { target: 'filesystem', outputDir: './lhci-reports' },
  },
};
