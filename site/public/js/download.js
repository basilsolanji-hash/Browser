// «Скачать»: определить систему посетителя и выделить её сборку; кнопки позволяют выбрать вручную.
// Без JavaScript видны все платформы и рекомендуется Android.
(function () {
  function detect() {
    var uad = navigator.userAgentData, p = uad && uad.platform ? uad.platform : '', ua = navigator.userAgent || '';
    if (/android/i.test(p) || /Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/^ios$/i.test(p)) return 'ios';
    if (/windows/i.test(p) || /Windows/i.test(ua)) return 'windows';
    if (/macos/i.test(p) || /Mac OS X|Macintosh/i.test(ua)) return 'mac';
    return 'android';
  }
  var tabs = document.querySelector('[data-tabs]');
  function pick(id) {
    document.querySelectorAll('[data-panel]').forEach(function (el) { el.hidden = el.getAttribute('data-panel') !== id; });
    document.querySelectorAll('[data-tabs] .tab').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-id') === id)); });
    document.querySelectorAll('[data-card]').forEach(function (c) { c.classList.toggle('hl', c.getAttribute('data-card') === id); });
    document.documentElement.setAttribute('data-platform', id);
  }
  if (tabs) {
    tabs.hidden = false;
    tabs.addEventListener('click', function (e) { var b = e.target.closest('.tab'); if (b) pick(b.getAttribute('data-id')); });
  }
  var IDS = ['android', 'windows', 'ios', 'mac'];
  function fromHash() { var h = location.hash.slice(1); return IDS.indexOf(h) >= 0 ? h : null; }
  pick(fromHash() || detect());
  // Ссылки «#windows» и т. п. с других страниц и внутри страницы тоже переключают сборку.
  addEventListener('hashchange', function () { var h = fromHash(); if (h) pick(h); });
})();
