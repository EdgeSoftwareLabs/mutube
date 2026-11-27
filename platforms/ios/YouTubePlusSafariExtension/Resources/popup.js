var box = document.getElementById('enabled');

chrome.storage.local.get({ enabled: true }, function (stored) {
  box.checked = !stored || stored.enabled !== false;
});

box.addEventListener('change', function () {
  chrome.storage.local.set({ enabled: box.checked });
});

document.getElementById('open').addEventListener('click', function () {
  var api = (typeof browser !== 'undefined' && browser.tabs) ? browser : chrome;
  if (!api.tabs) return;
  api.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0];
    if (!tab || !tab.url || !globalThis.YouTubePlusOpen) return;
    if (!YouTubePlusOpen.shouldRedirectSafariPage(tab.url)) return;
    var target = YouTubePlusOpen.safariRedirectURL(tab.url);
    if (!target) return;
    api.tabs.update(tab.id, { url: target });
  });
});
