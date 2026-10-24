// Режим чтения Оси (№34). Приложение добавляет к адресу метку #os-reader — переход внутри
// документа, страница не перезагружается. Скрипт видит метку, вынимает статью через Readability
// и подменяет документ простой разметкой. Выход — загрузка адреса без метки (полная перезагрузка).
(() => {
  const MARK = "#os-reader";
  let shown = false;

  const marked = () => location.hash === MARK;

  function render() {
    if (shown || !marked()) return;
    let article = null;
    try {
      article = new Readability(document.cloneNode(true)).parse();
    } catch (e) {
      console.error("os-reader: " + e);
    }
    if (!article || !article.content) {
      // Статьи не нашлось — снимаем метку, приложение вернёт пункт «Режим чтения».
      console.warn("os-reader: no article");
      history.replaceState(history.state, "", location.href.slice(0, -MARK.length));
      return;
    }
    shown = true;
    const doc = document.implementation.createHTMLDocument(article.title || document.title);
    const meta = doc.createElement("meta");
    meta.name = "viewport";
    meta.content = "width=device-width, initial-scale=1";
    doc.head.appendChild(meta);
    const style = doc.createElement("style");
    style.textContent = `
      :root { color-scheme: light dark; --bg: #fbfaf7; --fg: #1d1d1f; --muted: #6e6e73; --link: #c62828; }
      @media (prefers-color-scheme: dark) { :root { --bg: #18181b; --fg: #e8e8ea; --muted: #9a9aa0; --link: #ff6b5b; } }
      html { background: var(--bg); }
      body { margin: 0 auto; max-width: 42em; padding: 20px 18px 48px; background: var(--bg); color: var(--fg);
             font: 19px/1.6 Georgia, "Noto Serif", serif; overflow-wrap: break-word; }
      h1.os-title { font: 700 1.5em/1.25 system-ui, sans-serif; margin: 0 0 .3em; }
      .os-meta { color: var(--muted); font: .8em/1.4 system-ui, sans-serif; margin-bottom: 1.6em; }
      a { color: var(--link); }
      img, video, figure, table { max-width: 100%; height: auto; }
      figure { margin: 1em 0; } figcaption { color: var(--muted); font-size: .8em; }
      pre, code { white-space: pre-wrap; font-size: .85em; }
      table { display: block; overflow-x: auto; border-collapse: collapse; }
      blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid var(--muted); color: var(--muted); }
    `;
    doc.head.appendChild(style);
    const h1 = doc.createElement("h1");
    h1.className = "os-title";
    h1.textContent = article.title || document.title;
    doc.body.appendChild(h1);
    const info = [article.siteName || location.hostname, article.byline].filter(Boolean).join(" · ");
    if (info) {
      const p = doc.createElement("div");
      p.className = "os-meta";
      p.textContent = info;
      doc.body.appendChild(p);
    }
    const content = new DOMParser().parseFromString(article.content, "text/html").body;
    content.querySelectorAll("script, iframe, object, embed").forEach((n) => n.remove());
    while (content.firstChild) doc.body.appendChild(doc.adoptNode(content.firstChild));
    document.replaceChild(document.importNode(doc.documentElement, true), document.documentElement);
    window.scrollTo(0, 0);
    console.info("os-reader: ok");
  }

  render();
  window.addEventListener("hashchange", () => {
    if (marked()) render();
    else if (shown) location.reload(); // «Назад» из режима чтения — вернуть исходную страницу
  });
})();
