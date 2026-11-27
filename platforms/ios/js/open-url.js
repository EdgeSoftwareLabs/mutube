/*
 * YouTube + link routing shared by the iOS app's tests and the Safari extension.
 *
 * parseYouTubePlusURL: youtubeplus:// URL -> https://m.youtube.com/... (or null)
 * planSafariRedirect: Safari page -> youtubeplus://open?url=... (or null)
 *
 * Google sign-in and OAuth pages are never redirected. A redirect attempted in
 * the last few seconds is skipped so a failed handoff does not loop.
 */
(function (root) {
  'use strict';

  var LOOP_MS = 4000;

  function isStandardHost(host) {
    return host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com';
  }

  function hostEnds(host, base) {
    if (host === base) return true;
    var suffix = '.' + base;
    return host.length > suffix.length && host.slice(-suffix.length) === suffix;
  }

  function isShortHost(host) {
    return hostEnds(host, 'youtu.be');
  }

  function isBlockedHost(host) {
    if (!host) return true;
    if (hostEnds(host, 'accounts.google.com') || hostEnds(host, 'accounts.youtube.com')) return true;
    if (host === 'myaccount.google.com' || host === 'consent.google.com' || host === 'consent.youtube.com') return true;
    if (host.indexOf('accounts.') === 0) return true;
    return false;
  }

  function isBlockedPath(path) {
    path = String(path || '').toLowerCase();
    return path.indexOf('/signin') !== -1 || path.indexOf('/oauth') !== -1 ||
      path.indexOf('servicelogin') !== -1 || path.indexOf('/account') !== -1;
  }

  function videoIdFromPath(path) {
    var id = String(path || '').replace(/^\/+/, '').split('/')[0];
    return /^[\w-]{11}$/.test(id) ? id : '';
  }

  function watchFromShort(id, search) {
    var out = new URL('https://m.youtube.com/watch');
    out.searchParams.set('v', id);
    var params = new URLSearchParams(search || '');
    params.forEach(function (value, key) {
      if (key !== 'v') out.searchParams.append(key, value);
    });
    return out.toString();
  }

  function normalizeHttp(href) {
    var u;
    try { u = new URL(href); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    var host = u.hostname.toLowerCase();
    if (isBlockedHost(host) || isBlockedPath(u.pathname)) return null;
    if (isShortHost(host)) {
      var id = videoIdFromPath(u.pathname);
      if (!id) return null;
      return watchFromShort(id, u.search);
    }
    if (host === 'music.youtube.com' || host === 'studio.youtube.com' || host === 'tv.youtube.com' || host === 'kids.youtube.com') {
      u.protocol = 'https:';
      return u.toString();
    }
    if (!isStandardHost(host)) return null;
    u.protocol = 'https:';
    u.hostname = 'm.youtube.com';
    return u.toString();
  }

  function parseYouTubePlusURL(input) {
    var u;
    try { u = new URL(String(input || '')); } catch (e) { return null; }
    if (u.protocol !== 'youtubeplus:') return null;
    var host = (u.hostname || '').toLowerCase();
    if (host === 'open') {
      var inner = u.searchParams.get('url');
      if (!inner) return null;
      return normalizeHttp(inner);
    }
    if (host === 'watch') {
      var vid = u.searchParams.get('v') || '';
      if (!/^[\w-]{11}$/.test(vid)) return null;
      return watchFromShort(vid, u.search);
    }
    if (isShortHost(host)) {
      var shortId = videoIdFromPath(u.pathname);
      if (!shortId) return null;
      return watchFromShort(shortId, u.search);
    }
    // A non-special scheme cannot be rewritten to https in place.
    return normalizeHttp('https://' + host + u.pathname + u.search + u.hash);
  }

  function shouldRedirectSafariPage(href) {
    var u;
    try { u = new URL(String(href || '')); } catch (e) { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    var host = u.hostname.toLowerCase();
    if (isBlockedHost(host) || isBlockedPath(u.pathname)) return false;
    return isStandardHost(host) || isShortHost(host);
  }

  function safariRedirectURL(href) {
    if (!shouldRedirectSafariPage(href)) return null;
    return 'youtubeplus://open?url=' + encodeURIComponent(href);
  }

  function planSafariRedirect(href, opts) {
    opts = opts || {};
    if (opts.enabled === false) return null;
    if (!shouldRedirectSafariPage(href)) return null;
    var now = typeof opts.now === 'number' ? opts.now : 0;
    var last = typeof opts.lastAttempt === 'number' ? opts.lastAttempt : 0;
    if (last && now - last < LOOP_MS) return null;
    return safariRedirectURL(href);
  }

  var api = {
    parseYouTubePlusURL: parseYouTubePlusURL,
    shouldRedirectSafariPage: shouldRedirectSafariPage,
    safariRedirectURL: safariRedirectURL,
    planSafariRedirect: planSafariRedirect
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.YouTubePlusOpen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
