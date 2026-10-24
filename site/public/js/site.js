// Общий скрипт сайта: запоминание выбранного языка (localStorage, не cookie),
// закрытие меню языков и мягкое появление секций при прокрутке.
(function () {
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-lang]');
    if (a) { try { localStorage.setItem('os-lang', a.getAttribute('data-lang')); } catch (err) {} }
    document.querySelectorAll('details.lang[open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('details.lang[open]').forEach(function (d) { d.removeAttribute('open'); d.querySelector('summary').focus(); });
  });

  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var items = [].slice.call(document.querySelectorAll('.reveal')).filter(function (el) {
    return el.getBoundingClientRect().top > innerHeight; // то, что уже на экране, не прячем
  });
  if (!items.length) return;
  document.documentElement.classList.add('js');
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.remove('pending'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -10% 0px' });
  items.forEach(function (el) { el.classList.add('pending'); io.observe(el); });
})();
