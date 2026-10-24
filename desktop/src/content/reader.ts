/**
 * Режим чтения (по образцу app/src/main/assets/reader/reader.js): выполняется в изолированном мире
 * страницы после Readability.js, вынимает статью и очищает её от скриптов и встроенных объектов.
 * Показ статьи — на странице os://reader без скриптов (строгий CSP).
 */
declare const Readability: new (doc: Document) => { parse(): { title?: string; byline?: string; siteName?: string; content?: string } | null };

(globalThis as Record<string, unknown>).__osReader = () => {
  let article;
  try {
    article = new Readability(document.cloneNode(true) as Document).parse();
  } catch {
    return null;
  }
  if (!article?.content) return null;
  const body = new DOMParser().parseFromString(article.content, 'text/html').body;
  body.querySelectorAll('script, iframe, object, embed, form, input, button, link, meta, style, base').forEach((n) => n.remove());
  body.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|srcset|action|formaction|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
  });
  return {
    title: article.title || document.title,
    meta: [article.siteName || location.hostname, article.byline].filter(Boolean).join(' · '),
    content: body.innerHTML,
    url: location.href,
  };
};
