/* global chrome */
// Фоновый service worker (MV3): отвечает на сообщения content script и хранит счётчик в chrome.storage.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg !== 'ping') return false;
  chrome.storage.local.get('count').then(({ count = 0 }) => {
    chrome.storage.local.set({ count: count + 1 }).then(() => reply('pong'));
  });
  return true;
});
