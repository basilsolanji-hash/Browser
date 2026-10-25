/* global chrome */
// Помечает страницу: приёмка проверяет метку и видит плашку на снимке.
document.documentElement.setAttribute('data-os-test-ext', 'ok');
const badge = document.createElement('div');
badge.id = 'os-test-ext-badge';
badge.textContent = 'Os test extension';
badge.style.cssText = 'position:fixed;right:12px;bottom:12px;padding:6px 10px;background:#d92d20;color:#fff;font:13px sans-serif;border-radius:6px;z-index:2147483647';
document.documentElement.append(badge);
// Связь с фоновым service worker: ответ «pong» — значит runtime и storage работают.
chrome.runtime.sendMessage('ping').then((r) => document.documentElement.setAttribute('data-os-test-bg', String(r)))
  .catch((e) => document.documentElement.setAttribute('data-os-test-bg', 'error: ' + e.message));
