// Сборка: esbuild для главного процесса, preload, интерфейса и своих страниц; статика копируется в dist/.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });

const common = { bundle: true, sourcemap: 'linked', target: 'chrome140', logLevel: 'warning', legalComments: 'none' };

await build({ ...common, platform: 'node', format: 'cjs', external: ['electron'],
  entryPoints: [join(src, 'main/main.ts')], outfile: join(dist, 'main/main.js') });
// Разбор документов (DocView) — в отдельном потоке, чтобы большой файл не подвешивал браузер.
await build({ ...common, platform: 'node', format: 'cjs', external: ['electron'],
  entryPoints: [join(src, 'main/docworker.ts')], outfile: join(dist, 'main/docworker.js') });
// Preload в песочнице: один файл, без require своих модулей.
await build({ ...common, platform: 'node', format: 'cjs', external: ['electron'],
  entryPoints: [join(src, 'preload/preload.ts')], outfile: join(dist, 'preload/preload.js') });
await build({ ...common, platform: 'node', format: 'cjs', external: ['electron'],
  entryPoints: [join(src, 'preload/tab.ts')], outfile: join(dist, 'preload/tab.js') });
// Скрипты для сайтов (изолированный мир): режим чтения.
await build({ ...common, platform: 'browser', format: 'iife', sourcemap: false,
  entryPoints: [join(src, 'content/reader.ts')], outfile: join(dist, 'content/reader.js') });

const pages = readdirSync(join(src, 'pages')).filter((f) => f.endsWith('.ts') && f !== 'common.ts' && !f.startsWith('_'));
await build({ ...common, platform: 'browser', format: 'iife',
  entryPoints: [join(src, 'ui/browser.ts'), ...pages.map((f) => join(src, 'pages', f))],
  outdir: dist, outbase: src });

for (const dir of ['ui', 'pages']) {
  mkdirSync(join(dist, dir), { recursive: true });
  for (const f of readdirSync(join(src, dir)).filter((f) => /\.(html|css|svg)$/.test(f))) {
    cpSync(join(src, dir, f), join(dist, dir, f));
  }
}
cpSync(join(src, 'i18n'), join(dist, 'i18n'), { recursive: true });
cpSync(join(root, 'assets'), join(dist, 'assets'), { recursive: true });
// Режим чтения — тот же Readability.js (Mozilla, Apache 2.0), что в Android-версии.
cpSync(join(root, '../app/src/main/assets/reader/Readability.js'), join(dist, 'assets/Readability.js'));
// «Предложить надёжный пароль» — тот же скрипт, что встроенное расширение Android (content script).
cpSync(join(root, '../app/src/main/assets/pwgen/pwgen.js'), join(dist, 'content/pwgen.js'));
console.log('build: ok');
