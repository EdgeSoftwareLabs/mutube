/*
 * Runs in Safari at document start on youtube.com and youtu.be.
 * Sends the page to YouTube + unless the popup switch is off, the page is
 * sign-in / OAuth, or we already tried in the last few seconds.
 */
(function () {
  if (!globalThis.YouTubePlusOpen) return;
  var href = '';
  try { href = String(location.href || ''); } catch (e) { return; }
  if (!YouTubePlusOpen.shouldRedirectSafariPage(href)) return;

  function lastAttempt() {
    try { return Number(sessionStorage.getItem('ytplus-redirect-at') || 0); } catch (e) { return 0; }
  }

  function go(enabled) {
    var target = YouTubePlusOpen.planSafariRedirect(href, {
      enabled: enabled,
      now: Date.now(),
      lastAttempt: lastAttempt()
    });
    if (!target) return;
    try { sessionStorage.setItem('ytplus-redirect-at', String(Date.now())); } catch (e2) { /* ignore */ }
    location.replace(target);
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ enabled: true }, function (stored) {
        go(!stored || stored.enabled !== false);
      });
      return;
    }
  } catch (e3) { /* storage unavailable; fall through */ }
  go(true);
})();
