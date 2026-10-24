import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import type { Palette } from '../shared/types';
import { isRtl, t } from './i18n';

/** Режим чтения: статья из Readability показывается на os://reader без скриптов. */
interface Article { title: string; meta: string; content: string; url: string }

const articles = new Map<number, Article>();
let seq = 0;
let code: string[] | null = null;
const WORLD = 1999;

function scripts(): string[] {
  code ??= [
    readFileSync(join(__dirname, '..', 'assets', 'Readability.js'), 'utf8'),
    readFileSync(join(__dirname, '..', 'content', 'reader.js'), 'utf8'),
  ];
  return code;
}

/** Вынуть статью со страницы; null — статьи нет. Возвращает адрес страницы режима чтения. */
export async function extract(wc: WebContents): Promise<string | null> {
  const [lib, reader] = scripts();
  // По одному скрипту за вызов: при массиве Electron возвращает значение первого, а не последнего.
  await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: lib }]);
  await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: reader }]);
  const r = (await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: '__osReader()' }])) as Article | null;
  if (!r || typeof r.content !== 'string' || !r.content.trim()) return null;
  const id = ++seq;
  articles.set(id, { title: String(r.title).slice(0, 500), meta: String(r.meta).slice(0, 300), content: r.content.slice(0, 3_000_000), url: String(r.url) });
  // Держим в памяти только последние статьи.
  if (articles.size > 30) articles.delete(articles.keys().next().value!);
  return `os://reader/?id=${id}`;
}

export const sourceOf = (url: string): string | null => {
  const m = /^os:\/\/reader\/\?id=(\d+)/.exec(url);
  return m ? (articles.get(Number(m[1]))?.url ?? null) : null;
};

const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const READER_CSP = "default-src 'none'; img-src http: https: data:; media-src http: https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

export function readerHtml(id: number, p: Palette): string {
  const a = articles.get(id);
  if (!a) return `<!doctype html><meta charset="utf-8"><title>${esc(t('reader_mode'))}</title><p>${esc(t('page_not_opened'))}</p>`;
  return `<!doctype html><html dir="${isRtl() ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(a.title)}</title>
<style>
html{background:${p.bg}}body{margin:0 auto;max-width:42em;padding:32px 24px 64px;color:${p.text};font:20px/1.65 Georgia,"Noto Serif",serif;overflow-wrap:break-word}
h1.os-title{font:700 1.6em/1.25 "Segoe UI",system-ui,sans-serif;margin:0 0 .3em}.os-meta{color:${p.muted};font:.8em/1.4 "Segoe UI",system-ui,sans-serif;margin-bottom:1.6em}
a{color:${p.accent}}img,video,figure,table{max-width:100%;height:auto}figure{margin:1em 0}figcaption{color:${p.muted};font-size:.8em}
pre,code{white-space:pre-wrap;font-size:.85em}table{display:block;overflow-x:auto;border-collapse:collapse}
blockquote{margin:1em 0;padding-inline-start:1em;border-inline-start:3px solid ${p.muted};color:${p.muted}}</style></head>
<body><h1 class="os-title">${esc(a.title)}</h1>${a.meta ? `<div class="os-meta">${esc(a.meta)}</div>` : ''}${a.content}</body></html>`;
}
