// Юнит-тесты импортируют исходники .ts напрямую: относительный импорт без расширения дополняем «.ts».
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); } catch (e) {
    if (spec.startsWith('.') && !/\\.[cm]?[jt]s$/.test(spec)) return next(spec + '.ts', ctx);
    throw e;
  }
}`));
