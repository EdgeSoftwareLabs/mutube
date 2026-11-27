var box = document.getElementById('enabled');

chrome.storage.local.get({ enabled: true }, function (stored) {
  box.checked = !stored || stored.enabled !== false;
});

box.addEventListener('change', function () {
  chrome.storage.local.set({ enabled: box.checked });
});
