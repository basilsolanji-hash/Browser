/* global chrome */
// API расширения доступен во всплывающем окне: показываем свой ID и счётчик из chrome.storage.
document.getElementById('rid').textContent = 'id: ' + chrome.runtime.id;
chrome.storage.local.get('count').then(({ count = 0 }) => { document.getElementById('count').textContent = 'pings: ' + count; });
