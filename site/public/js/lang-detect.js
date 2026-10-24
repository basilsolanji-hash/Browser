// Первый заход на корень сайта: язык по сохранённому выбору или по языкам браузера.
// Казахский, белорусский, узбекский, киргизский, таджикский, украинский и армянский → русская версия.
(function () {
  var LANGS = ['en', 'ru', 'es', 'pt', 'fr', 'de', 'ar', 'hi', 'tr', 'zh'];
  var TO_RU = ['kk', 'be', 'uz', 'ky', 'tg', 'uk', 'hy', 'az', 'tt', 'ba', 'mn'];
  var saved = null;
  try { saved = localStorage.getItem('os-lang'); } catch (e) {}
  function pick() {
    if (saved && LANGS.indexOf(saved) >= 0) return saved;
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < list.length; i++) {
      var code = String(list[i]).toLowerCase().split('-')[0];
      if (LANGS.indexOf(code) >= 0) return code;
      if (TO_RU.indexOf(code) >= 0) return 'ru';
    }
    return 'en';
  }
  var lang = pick();
  var base = location.pathname.replace(/\/(index\.html)?$/, '');
  if (lang !== 'en' || saved === 'en') location.replace(base + '/' + lang + '/' + location.hash);
})();
