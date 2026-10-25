/** Журнал событий загрузки страниц (Diag.kt) — для меню «Диагностика». Только в памяти, наружу не уходит. */
const MAX = 80;
const lines: string[] = [];
const two = (n: number) => String(n).padStart(2, '0');

export function log(tab: string, message: string): void {
  const d = new Date();
  lines.unshift(`${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} [${tab}] ${message}`);
  lines.length = Math.min(lines.length, MAX);
}

export const text = () => lines.join('\n');
