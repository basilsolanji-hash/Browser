// 404: показать текст на языке из адреса (/…/ru/…), сохранённом или браузерном.
(function () {
  var blocks = document.querySelectorAll('[data-nf]');
  var have = [].map.call(blocks, function (b) { return b.getAttribute('data-nf'); });
  var m = location.pathname.match(/\/([a-z]{2})(\/|$)/);
  var saved = null;
  try { saved = localStorage.getItem('os-lang'); } catch (e) {}
  var nav = String(navigator.language || 'en').toLowerCase().split('-')[0];
  if (['kk', 'be', 'uz', 'ky', 'tg', 'uk', 'hy', 'az', 'tt', 'ba', 'mn'].indexOf(nav) >= 0) nav = 'ru';
  var lang = [m && m[1], saved, nav, 'en'].filter(function (l) { return l && have.indexOf(l) >= 0; })[0];
  blocks.forEach(function (b) {
    var on = b.getAttribute('data-nf') === lang;
    b.hidden = !on;
    if (on) { document.documentElement.lang = lang; document.documentElement.dir = b.dir; document.title = b.getAttribute('data-title'); }
  });
})();
