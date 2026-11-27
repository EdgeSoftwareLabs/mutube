/*
 * Runs in Safari at document start on youtube.com and youtu.be.
 *
 * iOS Safari ignores location changes to a custom scheme that happen in an
 * async callback (chrome.storage) or without a user gesture, which is what
 * happens when Google Search opens a watch page. Try once, synchronously,
 * then keep a one-tap banner and hand off play/link taps, which do have a
 * gesture. Sign-in pages are never sent to the app.
 */
(function () {
  if (!globalThis.YouTubePlusOpen) return;

  var KEY_AT = 'ytplus-redirect-at';
  var KEY_URL = 'ytplus-redirect-url';
  var KEY_ENABLED = 'ytplus-open-enabled';
  var dismissedFor = '';

  function enabledNow() {
    try {
      if (localStorage.getItem(KEY_ENABLED) === '0') return false;
    } catch (e) { /* private mode */ }
    return true;
  }

  function rememberEnabled(on) {
    try { localStorage.setItem(KEY_ENABLED, on ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function hrefOf() {
    try { return String(location.href || ''); } catch (e) { return ''; }
  }

  function readAttempt() {
    try {
      return {
        at: Number(sessionStorage.getItem(KEY_AT) || 0),
        url: sessionStorage.getItem(KEY_URL) || ''
      };
    } catch (e) { return { at: 0, url: '' }; }
  }

  function writeAttempt(href) {
    try {
      sessionStorage.setItem(KEY_AT, String(Date.now()));
      sessionStorage.setItem(KEY_URL, href);
    } catch (e) { /* ignore */ }
  }

  function targetFor(href, userGesture) {
    var attempt = readAttempt();
    return YouTubePlusOpen.planSafariRedirect(href, {
      enabled: enabledNow(),
      now: Date.now(),
      lastAttempt: attempt.at,
      lastURL: attempt.url,
      userGesture: !!userGesture
    });
  }

  function handoff(href, userGesture) {
    var target = targetFor(href, userGesture);
    if (!target) return false;
    if (!userGesture) writeAttempt(href);
    try { location.href = target; } catch (e) { return false; }
    return true;
  }

  function removeBanner() {
    var el = document.getElementById('ytplus-open-banner');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function ensureBanner(href) {
    if (!document.documentElement || dismissedFor === href) return;
    if (!YouTubePlusOpen.shouldRedirectSafariPage(href) || !enabledNow()) {
      removeBanner();
      return;
    }
    var banner = document.getElementById('ytplus-open-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'ytplus-open-banner';
      banner.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top, 0px) + 8px);z-index:2147483647;display:flex;gap:8px;align-items:center;padding:10px;background:#0f0f0f;color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:12px;font:600 15px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);';
      var open = document.createElement('button');
      open.type = 'button';
      open.textContent = 'Open in YouTube +';
      open.style.cssText = 'flex:1;background:#fff;color:#0f0f0f;border:0;border-radius:8px;padding:10px 12px;font:inherit;';
      open.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        handoff(hrefOf(), true);
      }, true);
      var dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.textContent = 'Stay';
      dismiss.style.cssText = 'background:transparent;color:#fff;border:0;padding:10px;font:inherit;';
      dismiss.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        dismissedFor = hrefOf();
        removeBanner();
      }, true);
      banner.appendChild(open);
      banner.appendChild(dismiss);
      (document.body || document.documentElement).appendChild(banner);
    }
  }

  function onClick(ev) {
    if (!enabledNow()) return;
    var href = hrefOf();
    if (dismissedFor === href) return;
    var node = ev.target;
    var link = null;
    while (node && node !== document) {
      if (node.tagName === 'A' && node.href) { link = node; break; }
      node = node.parentNode;
    }
    if (link && YouTubePlusOpen.shouldRedirectSafariPage(link.href) && /\/watch|\/shorts\/|youtu\.be\//.test(link.href)) {
      ev.preventDefault();
      ev.stopPropagation();
      handoff(link.href, true);
      return;
    }
    if (!/[?&]v=|\/shorts\//.test(href)) return;
    var el = ev.target;
    while (el && el !== document) {
      var id = el.id || '';
      var cls = typeof el.className === 'string' ? el.className : '';
      if (el.tagName === 'VIDEO' || id === 'movie_player' || cls.indexOf('html5-video-player') !== -1 || cls.indexOf('ytp-play') !== -1 || cls.indexOf('ytm-player') !== -1) {
        ev.preventDefault();
        ev.stopPropagation();
        handoff(href, true);
        return;
      }
      el = el.parentNode;
    }
  }

  function refresh() {
    var href = hrefOf();
    if (!YouTubePlusOpen.shouldRedirectSafariPage(href)) {
      removeBanner();
      return;
    }
    ensureBanner(href);
    if (enabledNow()) handoff(href, false);
  }

  document.addEventListener('click', onClick, true);
  window.addEventListener('yt-navigate-finish', refresh);
  window.addEventListener('popstate', refresh);
  refresh();

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ enabled: true }, function (stored) {
        var on = !stored || stored.enabled !== false;
        rememberEnabled(on);
        if (!on) removeBanner();
        else ensureBanner(hrefOf());
      });
    }
  } catch (e) { /* storage is optional; the sync default is on */ }
})();
