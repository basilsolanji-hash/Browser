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
// Preload в песочнице: один файл, без require своих модулей.
await build({ ...common, platform: 'node', format: 'cjs', external: ['electron'],
  entryPoints: [join(src, 'preload/preload.ts')], outfile: join(dist, 'preload/preload.js') });

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
console.log('build: ok');
