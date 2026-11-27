/*
 * YouTube + for iPhone / iPad.
 *
 * Injected into https://m.youtube.com at document start by the native shell
 * (WKUserScript). No runtime CDN. The native app also installs WKContentRuleList
 * rules compiled from content-rules.json.
 *
 * InnerTube responses are cleaned the same way the TV script wraps JSON.parse:
 * JSON.parse, fetch, and Response.prototype.json. Ad payloads are removed,
 * SponsorBlock / DeArrow / dislike counts are applied from settings, and a
 * visibility shim keeps playback going when the app is backgrounded.
 *
 * Home-feed menu items (including "Not interested" and "Don't recommend
 * channel") are never rewritten.
 *
 * window.YTPLUS_CONFIG (set by the native shell before this script) and
 * window.YouTubePlus.applySettings update behaviour without a reload.
 * window.YouTubePlus.boot() runs again at document end.
 */
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : this;
  if (W.__ytPlusIOSLoaded) return;

  var VERSION = '1.0.1';
  var MARK = '__ytplusClean';
  var SPONSOR_API = 'https://sponsor.ajay.app/api/skipSegments';
  var DEARROW_API = 'https://sponsor.ajay.app/api/branding';
  var RYD_API = 'https://returnyoutubedislikeapi.com/votes';
  var DEPTH_LIMIT = 40;

  var AD_RENDERERS = [
    'adSlotRenderer',
    'adPlacementRenderer',
    'playerLegacyDesktopWatchAdsRenderer',
    'promotedVideoRenderer',
    'promotedSparklesTextSearchRenderer',
    'promotedSparklesWebRenderer',
    'compactPromotedVideoRenderer',
    'compactPromotedItemRenderer',
    'displayAdRenderer',
    'inFeedAdLayoutRenderer',
    'mastheadAdLayoutRenderer',
    'videoMastheadAdV3Renderer',
    'searchPyvRenderer',
    'carouselAdRenderer',
    'actionCompanionAdRenderer',
    'bannerPromoRenderer',
    'adBreakServiceRenderer'
  ];

  var PLAYER_AD_FIELDS = [
    'playerAds',
    'adPlacements',
    'adSlots',
    'adBreakHeartbeatParams',
    'interstitial',
    'paidContentOverlay'
  ];

  var SHORTS_RENDERERS = [
    'reelShelfRenderer',
    'reelItemRenderer',
    'shortsLockupViewModel'
  ];

  var CATEGORY_ORDER = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction'];

  var SKIP_LABELS = {
    sponsor: 'Skipped sponsor',
    intro: 'Skipped intro',
    outro: 'Skipped outro',
    selfpromo: 'Skipped self-promotion',
    interaction: 'Skipped interaction reminder'
  };

  var SKIP_BUTTONS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytm-skip-ad-button',
    '.ytm-ad-skip-button-modern',
    'button.ytp-ad-skip-button-slot'
  ].join(',');

  var SHORTS_DOM = [
    'ytm-reel-shelf-renderer',
    'ytm-shorts-lockup-view-model',
    'ytd-reel-shelf-renderer',
    'ytd-reel-item-renderer',
    'ytm-reel-item-renderer'
  ].join(',');

  function hostEnds(host, base) {
    if (host === base) return true;
    var suffix = '.' + base;
    return host.length > suffix.length && host.slice(-suffix.length) === suffix;
  }

  function isYouTubeHost(host) {
    host = String(host || '').toLowerCase();
    // Empty hosts are about:blank frames. Leave those, and Google sign-in, alone.
    if (!host) return false;
    var bases = ['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'googlevideo.com', 'ytimg.com'];
    var i;
    for (i = 0; i < bases.length; i++) if (hostEnds(host, bases[i])) return true;
    return false;
  }

  var pageHost = '';
  try { pageHost = W.location && W.location.hostname; } catch (eHost) { pageHost = ''; }
  if (!isYouTubeHost(pageHost)) return;
  W.__ytPlusIOSLoaded = true;

  var D = W.document;
  var CFG = {
    adBlock: true,
    sponsorBlock: true,
    categories: { sponsor: true, intro: true, outro: true, selfpromo: true, interaction: true },
    backgroundPlay: true,
    pictureInPicture: true,
    deArrow: false,
    returnYouTubeDislike: false,
    hideShorts: false,
    debug: false
  };

  var appActive = true;
  var segmentCache = {};
  var segmentPending = {};
  var deArrowCache = {};
  var deArrowPending = {};
  var rydCache = {};
  var rydPending = {};
  var stats = {
    responses: 0,
    nodesVisited: 0,
    adsRemoved: 0,
    shortsRemoved: 0,
    titlesReplaced: 0,
    sponsorSkips: 0,
    pauseBlocked: 0
  };

  // Leaf metadata. Walking these on every Home / Subscriptions / Shorts / You
  // response blocks the main thread before YouTube can request i.ytimg.com.
  var SKIP_DESCEND = {
    thumbnail: 1,
    thumbnails: 1,
    richThumbnail: 1,
    movingThumbnail: 1,
    channelThumbnail: 1,
    thumbnailOverlays: 1,
    accessibility: 1,
    accessibilityData: 1,
    trackingParams: 1,
    loggingDirectives: 1,
    clickTrackingParams: 1,
    playbackTracking: 1,
    captions: 1,
    storyboards: 1,
    playerConfig: 1,
    attestation: 1,
    responseContext: 1,
    frameworkUpdates: 1,
    microformat: 1,
    annotations: 1,
    endscreen: 1,
    cards: 1,
    videoDetails: 1,
    streamingData: 1,
    playabilityStatus: 1,
    heartbeatParams: 1,
    playerMicroformatRenderer: 1,
    menu: 1,
    menuRenderer: 1,
    title: 1,
    headline: 1,
    description: 1,
    descriptionSnippet: 1,
    detailedMetadataSnippets: 1,
    metadata: 1,
    ownerText: 1,
    shortBylineText: 1,
    longBylineText: 1,
    publishedTimeText: 1,
    viewCountText: 1,
    lengthText: 1,
    badges: 1,
    navigationEndpoint: 1,
    serviceEndpoint: 1,
    commandMetadata: 1,
    engagementPanels: 1
  };

  function lsGet(key) {
    try { return W.localStorage ? W.localStorage.getItem('ytplus.' + key) : null; } catch (e) { return null; }
  }

  function applyOverrides(o) {
    if (!o || typeof o !== 'object') return;
    var cats = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction'];
    var bools = ['adBlock', 'sponsorBlock', 'backgroundPlay', 'pictureInPicture', 'deArrow', 'returnYouTubeDislike', 'hideShorts', 'debug'];
    var i, k;
    if (o.categories && typeof o.categories === 'object') {
      for (k in o.categories) {
        if (Object.prototype.hasOwnProperty.call(o.categories, k)) CFG.categories[k] = !!o.categories[k];
      }
    }
    for (i = 0; i < bools.length; i++) {
      k = bools[i];
      if (typeof o[k] === 'boolean') CFG[k] = o[k];
    }
    for (i = 0; i < cats.length; i++) {
      if (typeof o[cats[i]] === 'boolean') CFG.categories[cats[i]] = !!o[cats[i]];
    }
  }

  applyOverrides(W.YTPLUS_CONFIG);
  if (lsGet('debug') === '1') CFG.debug = true;

  function log() {
    if (!CFG.debug || !W.console) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[YouTube+]');
    try { W.console.log.apply(W.console, args); } catch (e) { /* ignore */ }
    try {
      if (W.webkit && W.webkit.messageHandlers && W.webkit.messageHandlers.ytplus) {
        W.webkit.messageHandlers.ytplus.postMessage({ type: 'log', message: args.join(' ') });
      }
    } catch (e2) { /* ignore */ }
  }

  function isObj(v) { return v !== null && typeof v === 'object'; }

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  function hasRenderer(node, keys) {
    var i;
    if (!isObj(node) || Object.prototype.toString.call(node) === '[object Array]') return false;
    for (i = 0; i < keys.length; i++) if (node[keys[i]]) return true;
    return false;
  }

  function embeddedContent(node) {
    if (!isObj(node)) return null;
    if (node.richItemRenderer && isObj(node.richItemRenderer.content)) return node.richItemRenderer.content;
    if (node.richSectionRenderer && isObj(node.richSectionRenderer.content)) return node.richSectionRenderer.content;
    if (isObj(node.videoRenderer)) return node.videoRenderer;
    return null;
  }

  function isAdNode(node) {
    if (!CFG.adBlock) return false;
    if (hasRenderer(node, AD_RENDERERS)) return true;
    var child = embeddedContent(node);
    if (child && child !== node && hasRenderer(child, AD_RENDERERS)) return true;
    if (child && child.videoRenderer && hasRenderer(child, AD_RENDERERS)) return true;
    return false;
  }

  function hasReel(node) {
    if (!isObj(node)) return false;
    if (hasRenderer(node, SHORTS_RENDERERS)) return true;
    if (node.navigationEndpoint && node.navigationEndpoint.reelWatchEndpoint) return true;
    if (node.videoRenderer && node.videoRenderer.navigationEndpoint && node.videoRenderer.navigationEndpoint.reelWatchEndpoint) return true;
    return false;
  }

  function isShortsNode(node) {
    if (!CFG.hideShorts) return false;
    if (hasReel(node)) return true;
    var child = embeddedContent(node);
    if (child && child !== node && hasReel(child)) return true;
    return false;
  }

  function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  function looksLikeFeedItem(node) {
    if (!isObj(node) || isArray(node)) return false;
    if (hasRenderer(node, AD_RENDERERS) || hasRenderer(node, SHORTS_RENDERERS)) return true;
    return !!(node.videoRenderer || node.richItemRenderer || node.richSectionRenderer ||
      node.gridVideoRenderer || node.compactVideoRenderer || node.reelItemRenderer ||
      node.playlistRenderer || node.lockupViewModel);
  }

  function shouldProcess(data) {
    if (!isObj(data)) return false;
    if (isArray(data)) return data.length > 0 && looksLikeFeedItem(data[0]);
    return !!(data.responseContext || data.playerAds || data.adPlacements || data.adSlots ||
      data.contents || data.onResponseReceivedCommands || data.onResponseReceivedActions ||
      data.continuationContents || data.playabilityStatus);
  }

  function mark(data) {
    try {
      Object.defineProperty(data, MARK, { value: true, enumerable: false, configurable: true });
    } catch (e) {
      try { data[MARK] = true; } catch (e2) { /* ignore */ }
    }
  }

  function videoIdOf(node) {
    if (!isObj(node)) return null;
    if (typeof node.videoId === 'string' && /^[\w-]{11}$/.test(node.videoId)) return node.videoId;
    var ep = node.navigationEndpoint && node.navigationEndpoint.watchEndpoint;
    if (ep && typeof ep.videoId === 'string' && /^[\w-]{11}$/.test(ep.videoId)) return ep.videoId;
    var onTap = node.onTap && node.onTap.innertubeCommand && node.onTap.innertubeCommand.watchEndpoint;
    if (onTap && typeof onTap.videoId === 'string' && /^[\w-]{11}$/.test(onTap.videoId)) return onTap.videoId;
    return null;
  }

  function thumbURL(id, time) {
    return 'https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=' + encodeURIComponent(id) + '&time=' + encodeURIComponent(time);
  }

  function applyDeArrow(node) {
    if (!CFG.deArrow) return;
    var id = videoIdOf(node);
    if (!id) return;
    var cached = deArrowCache[id];
    if (!cached) {
      queueDeArrow(id);
      return;
    }
    if (cached.title) {
      if (node.title && node.title.runs && node.title.runs.length && node.title.runs[0]) {
        node.title.runs[0].text = cached.title;
        var r;
        for (r = 1; r < node.title.runs.length; r++) {
          if (node.title.runs[r]) node.title.runs[r].text = '';
        }
        stats.titlesReplaced++;
      } else if (node.title && typeof node.title.simpleText === 'string') {
        node.title.simpleText = cached.title;
        stats.titlesReplaced++;
      } else if (node.headline && node.headline.runs && node.headline.runs.length) {
        node.headline.runs[0].text = cached.title;
        stats.titlesReplaced++;
      }
    }
    if (cached.time != null && node.thumbnail && node.thumbnail.thumbnails && node.thumbnail.thumbnails.length) {
      node.thumbnail.thumbnails[0].url = thumbURL(id, cached.time);
    }
  }

  function clean(node, depth) {
    if (node == null || typeof node !== 'object' || depth > DEPTH_LIMIT) return node;
    stats.nodesVisited++;
    if (isArray(node)) {
      var write = 0;
      var i, item;
      for (i = 0; i < node.length; i++) {
        item = node[i];
        if (isAdNode(item)) { stats.adsRemoved++; continue; }
        if (isShortsNode(item)) { stats.shortsRemoved++; continue; }
        node[write++] = clean(item, depth + 1);
      }
      node.length = write;
      return node;
    }
    if (CFG.adBlock) {
      var f;
      for (f = 0; f < PLAYER_AD_FIELDS.length; f++) {
        if (node[PLAYER_AD_FIELDS[f]] != null) {
          delete node[PLAYER_AD_FIELDS[f]];
          stats.adsRemoved++;
        }
      }
    }
    if (CFG.deArrow) applyDeArrow(node);
    var keys = [];
    var k;
    for (k in node) if (hasOwn(node, k) && k !== MARK && !SKIP_DESCEND[k]) keys.push(k);
    var j;
    for (j = 0; j < keys.length; j++) {
      if (node[keys[j]] && typeof node[keys[j]] === 'object') node[keys[j]] = clean(node[keys[j]], depth + 1);
    }
    return node;
  }

  function featuresOn() {
    return CFG.adBlock || CFG.hideShorts || CFG.deArrow;
  }

  function process(data) {
    if (!isObj(data) || data[MARK]) return data;
    if (!shouldProcess(data) || !featuresOn()) return data;
    mark(data);
    stats.responses++;
    var beforeAds = stats.adsRemoved;
    var beforeShorts = stats.shortsRemoved;
    var cleaned = clean(data, 0);
    if (CFG.debug && (stats.adsRemoved !== beforeAds || stats.shortsRemoved !== beforeShorts)) {
      log('cleaned', 'ads', stats.adsRemoved - beforeAds, 'shorts', stats.shortsRemoved - beforeShorts);
    }
    return cleaned;
  }

  function installParseHook() {
    if (!W.JSON || typeof W.JSON.parse !== 'function' || W.JSON.parse.__ytplus) return;
    var orig = W.JSON.parse;
    function hooked(text, reviver) {
      var data = orig.call(W.JSON, text, reviver);
      try {
        if (shouldProcess(data)) data = process(data);
      } catch (err) {
        log('parse', err && err.message);
      }
      return data;
    }
    hooked.__ytplus = true;
    hooked.__ytplusOrig = orig;
    W.JSON.parse = hooked;
  }

  function installResponseHook() {
    if (typeof W.Response === 'undefined' || !W.Response.prototype) return;
    var orig = W.Response.prototype.json;
    if (typeof orig !== 'function' || orig.__ytplus) return;
    function hooked() {
      var pending = orig.apply(this, arguments);
      if (!pending || typeof pending.then !== 'function') return pending;
      return pending.then(function (data) {
        try { return process(data); } catch (e) { return data; }
      });
    }
    hooked.__ytplus = true;
    W.Response.prototype.json = hooked;
  }

  function isInnerTubeURL(url) {
    var s = String(url || '');
    if (!s) return false;
    if (s.indexOf('sponsor.ajay.app') !== -1) return false;
    if (s.indexOf('returnyoutubedislikeapi.com') !== -1) return false;
    if (s.indexOf('dearrow') !== -1) return false;
    return s.indexOf('/youtubei/') !== -1 || s.indexOf('youtubei.googleapis.com') !== -1;
  }

  function installFetchHook() {
    if (typeof W.fetch !== 'function' || W.fetch.__ytplus) return;
    var orig = W.fetch;
    function hooked(input) {
      var url = '';
      if (typeof input === 'string') url = input;
      else if (input && typeof input.url === 'string') url = input.url;
      var pending = orig.apply(this, arguments);
      if (!isInnerTubeURL(url) || !pending || typeof pending.then !== 'function') return pending;
      return pending.then(function (res) {
        if (!res || typeof res.json !== 'function' || res.__ytplusFetch) return res;
        var origJson = res.json;
        res.json = function () {
          var p = origJson.apply(res, arguments);
          if (!p || typeof p.then !== 'function') return p;
          return p.then(function (data) {
            try { return process(data); } catch (e) { return data; }
          });
        };
        res.__ytplusFetch = true;
        return res;
      });
    }
    hooked.__ytplus = true;
    W.fetch = hooked;
  }

  function pickDeArrowTitle(branding) {
    if (!branding || !branding.titles || !branding.titles.length) return null;
    var i, t, best = null, bestVotes = -1;
    for (i = 0; i < branding.titles.length; i++) {
      t = branding.titles[i];
      if (!t || t.original || !t.title) continue;
      if (t.locked) return t.title;
      var votes = typeof t.votes === 'number' ? t.votes : 0;
      if (votes < 0) continue;
      if (votes > bestVotes) { best = t.title; bestVotes = votes; }
    }
    return best;
  }

  function pickDeArrowThumb(branding) {
    if (!branding || !branding.thumbnails || !branding.thumbnails.length) return null;
    var i, t, best = null, bestVotes = -1;
    for (i = 0; i < branding.thumbnails.length; i++) {
      t = branding.thumbnails[i];
      if (!t || t.original || t.timestamp == null) continue;
      if (t.locked) return t.timestamp;
      var votes = typeof t.votes === 'number' ? t.votes : 0;
      if (votes < 0) continue;
      if (votes > bestVotes) { best = t.timestamp; bestVotes = votes; }
    }
    return best;
  }

  function rememberBranding(id, branding) {
    deArrowCache[id] = { title: pickDeArrowTitle(branding), time: pickDeArrowThumb(branding) };
    return deArrowCache[id];
  }

  function queueDeArrow(id) {
    if (!CFG.deArrow || deArrowCache[id] || deArrowPending[id] || typeof W.fetch !== 'function') return;
    deArrowPending[id] = true;
    var url = DEARROW_API + '?videoID=' + encodeURIComponent(id);
    W.fetch(url).then(function (res) {
      return res && res.json ? res.json() : null;
    }).then(function (data) {
      deArrowPending[id] = false;
      rememberBranding(id, data || {});
      refreshVisible(id);
    }).catch(function () { deArrowPending[id] = false; });
  }

  function formatCount(n) {
    n = Math.round(Number(n) || 0);
    if (n < 0) n = 0;
    if (n < 1000) return String(n);
    if (n < 1000000) {
      var v = n / 1000;
      var s = v < 10 ? v.toFixed(1) : String(Math.round(v));
      return s.replace(/\.0$/, '') + 'K';
    }
    if (n < 1000000000) {
      var m = n / 1000000;
      var t = m < 10 ? m.toFixed(1) : String(Math.round(m));
      return t.replace(/\.0$/, '') + 'M';
    }
    var b = n / 1000000000;
    return (b < 10 ? b.toFixed(1) : String(Math.round(b))).replace(/\.0$/, '') + 'B';
  }

  function skipLabel(category) {
    return SKIP_LABELS[category] || 'Skipped segment';
  }

  function sponsorDecision(segments, time, categories) {
    if (!CFG.sponsorBlock) return null;
    if (!segments || !segments.length) return null;
    if (typeof time !== 'number' || !(time >= 0)) return null;
    var cats = categories || CFG.categories;
    var i, s, start, end, span;
    for (i = 0; i < segments.length; i++) {
      s = segments[i];
      if (!s || !s.segment || s.segment.length < 2) continue;
      if (s.actionType && s.actionType !== 'skip') continue;
      if (!cats[s.category]) continue;
      start = Number(s.segment[0]);
      end = Number(s.segment[1]);
      if (!(end > start)) continue;
      span = end - start;
      if (time >= start && time < end && (span < 1 || time < end - 0.25)) {
        return {
          skipTo: end,
          category: s.category,
          uuid: s.UUID || (s.category + ':' + start)
        };
      }
    }
    return null;
  }

  function currentVideoId() {
    var loc = W.location || {};
    var path = String(loc.pathname || '');
    var search = String(loc.search || '');
    var href = String(loc.href || '');
    var m = search.match(/[?&]v=([\w-]{11})/);
    if (m) return m[1];
    m = path.match(/\/shorts\/([\w-]{11})/);
    if (m) return m[1];
    m = path.match(/\/embed\/([\w-]{11})/);
    if (m) return m[1];
    m = href.match(/youtu\.be\/([\w-]{11})/);
    if (m) return m[1];
    return null;
  }

  function showToast(text) {
    if (!D || typeof D.createElement !== 'function') return;
    var parent = D.documentElement || D.body;
    if (!parent || typeof parent.appendChild !== 'function') return;
    var el = null;
    try { el = D.getElementById ? D.getElementById('ytplus-toast') : null; } catch (e) { el = null; }
    if (!el) {
      el = D.createElement('div');
      el.id = 'ytplus-toast';
      if (el.style) {
        el.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom, 0px) + 72px);transform:translateX(-50%);background:rgba(15,15,15,.92);color:#fff;padding:10px 14px;border-radius:10px;font:600 13px -apple-system,BlinkMacSystemFont,sans-serif;z-index:2147483646;opacity:0;transition:opacity .2s ease;pointer-events:none;max-width:80%;text-align:center;';
      }
      try { parent.appendChild(el); } catch (e2) { return; }
    }
    el.textContent = text;
    if (el.style) el.style.opacity = '1';
    if (el._ytTimer && W.clearTimeout) W.clearTimeout(el._ytTimer);
    if (W.setTimeout) {
      el._ytTimer = W.setTimeout(function () { if (el.style) el.style.opacity = '0'; }, 1800);
    }
  }

  function enabledCategoryList() {
    var out = [];
    var i;
    for (i = 0; i < CATEGORY_ORDER.length; i++) {
      if (CFG.categories[CATEGORY_ORDER[i]]) out.push(CATEGORY_ORDER[i]);
    }
    return out;
  }

  function ensureSegments(id) {
    if (!CFG.sponsorBlock || !id || segmentCache[id] || segmentPending[id] || typeof W.fetch !== 'function') return;
    segmentPending[id] = true;
    var cats = JSON.stringify(enabledCategoryList());
    var url = SPONSOR_API + '?videoID=' + encodeURIComponent(id) + '&categories=' + encodeURIComponent(cats);
    W.fetch(url).then(function (res) {
      if (res && typeof res.status === 'number' && res.status === 404) return [];
      return res && res.json ? res.json() : [];
    }).then(function (data) {
      segmentPending[id] = false;
      segmentCache[id] = Object.prototype.toString.call(data) === '[object Array]' ? data : [];
    }).catch(function () {
      segmentPending[id] = false;
      segmentCache[id] = segmentCache[id] || [];
    });
  }

  function tick(video) {
    if (!CFG.sponsorBlock) return;
    var id = currentVideoId();
    if (!id) return;
    ensureSegments(id);
    if (!video && D && typeof D.querySelector === 'function') video = D.querySelector('video');
    if (!video || video.paused || typeof video.currentTime !== 'number') return;
    var decision = sponsorDecision(segmentCache[id] || [], video.currentTime);
    if (!decision) return;
    if (video.__ytplusLastSkip === decision.uuid && Math.abs(video.currentTime - decision.skipTo) < 1) return;
    try { video.currentTime = decision.skipTo; } catch (e) { return; }
    video.__ytplusLastSkip = decision.uuid;
    stats.sponsorSkips++;
    showToast(skipLabel(decision.category));
    log('skip', decision.category, decision.skipTo);
  }

  function skipPlayerAds(root) {
    if (!CFG.adBlock) return 0;
    root = root || D;
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    var n = 0;
    var buttons = root.querySelectorAll(SKIP_BUTTONS);
    var i;
    for (i = 0; i < buttons.length; i++) {
      if (buttons[i] && typeof buttons[i].click === 'function') {
        try { buttons[i].click(); n++; } catch (e) { /* ignore */ }
      }
    }
    var overlays = root.querySelectorAll('.ad-showing video, .ytp-ad-player-overlay video, .ytp-ad-module video');
    var j, v;
    for (j = 0; j < overlays.length; j++) {
      v = overlays[j];
      if (v && isFinite(v.duration) && v.duration > 0 && v.duration < 180 && v.currentTime < v.duration - 0.2) {
        try { v.currentTime = v.duration; n++; } catch (e2) { /* ignore */ }
      }
    }
    return n;
  }

  function hideShortsDOM() {
    if (!CFG.hideShorts || !D || typeof D.querySelectorAll !== 'function') return;
    var nodes = D.querySelectorAll(SHORTS_DOM);
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (!nodes[i] || !nodes[i].style) continue;
      nodes[i].style.display = CFG.hideShorts ? 'none' : '';
    }
  }

  function requestPictureInPicture() {
    if (!CFG.pictureInPicture || !D || typeof D.querySelector !== 'function') return false;
    var v = D.querySelector('video');
    if (!v) return false;
    try {
      if (typeof v.webkitSetPresentationMode === 'function') {
        v.webkitSetPresentationMode('picture-in-picture');
        return true;
      }
    } catch (e) { /* try the standard API */ }
    try {
      if (typeof v.requestPictureInPicture === 'function') {
        v.requestPictureInPicture();
        return true;
      }
    } catch (e2) { /* ignore */ }
    return false;
  }

  function refreshVisible(id) {
    if (!CFG.deArrow || !D || typeof D.querySelectorAll !== 'function') return;
    var cached = deArrowCache[id];
    if (!cached || !cached.title) return;
    var links = D.querySelectorAll('a[href*="' + id + '"]');
    var i, link, title;
    for (i = 0; i < links.length; i++) {
      link = links[i];
      title = link.querySelector ? link.querySelector('#video-title, .media-item-headline, h3, yt-formatted-string') : null;
      if (title) title.textContent = cached.title;
    }
  }

  function removeDislikeLabel() {
    if (!D || typeof D.getElementById !== 'function') return;
    var tag = D.getElementById('ytplus-dislike-count');
    if (tag && tag.parentNode && tag.parentNode.removeChild) tag.parentNode.removeChild(tag);
  }

  function applyDislikes(count) {
    if (!CFG.returnYouTubeDislike || !D || typeof D.querySelector !== 'function' || typeof D.createElement !== 'function') return;
    var btn = D.querySelector('button[aria-label*="dislike" i], ytm-dislike-button-renderer button, #segmented-dislike-button button');
    if (!btn) return;
    var tag = D.getElementById ? D.getElementById('ytplus-dislike-count') : null;
    if (!tag) {
      tag = D.createElement('span');
      tag.id = 'ytplus-dislike-count';
      if (tag.style) tag.style.cssText = 'margin-left:6px;color:#aaa;font:600 12px -apple-system,sans-serif;';
      if (btn.parentNode && btn.parentNode.appendChild) btn.parentNode.appendChild(tag);
    }
    tag.textContent = formatCount(count);
  }

  function ensureDislikes(id) {
    if (!CFG.returnYouTubeDislike || !id || rydCache[id] || rydPending[id] || typeof W.fetch !== 'function') return;
    rydPending[id] = true;
    W.fetch(RYD_API + '?videoId=' + encodeURIComponent(id)).then(function (res) {
      return res && res.json ? res.json() : null;
    }).then(function (data) {
      rydPending[id] = false;
      var count = data && typeof data.dislikes === 'number' ? data.dislikes : null;
      if (count == null) return;
      rydCache[id] = count;
      applyDislikes(count);
    }).catch(function () { rydPending[id] = false; });
  }

  function installVisibilityShim() {
    if (!D || D.__ytplusVis) return;
    D.__ytplusVis = true;
    var rawHidden = false;
    var rawState = 'visible';
    try {
      Object.defineProperty(D, 'hidden', {
        configurable: true,
        get: function () { return CFG.backgroundPlay ? false : rawHidden; },
        set: function (v) { rawHidden = !!v; }
      });
      Object.defineProperty(D, 'visibilityState', {
        configurable: true,
        get: function () { return CFG.backgroundPlay ? 'visible' : rawState; },
        set: function (v) { rawState = String(v || ''); }
      });
      Object.defineProperty(D, 'webkitHidden', {
        configurable: true,
        get: function () { return CFG.backgroundPlay ? false : rawHidden; }
      });
    } catch (e) { /* a locked document keeps its native getters */ }
    D._ytSetRawVisibility = function (hidden) {
      rawHidden = !!hidden;
      rawState = hidden ? 'hidden' : 'visible';
    };
    function block(ev) {
      if (!CFG.backgroundPlay || !ev) return;
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      else if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
    }
    var events = ['visibilitychange', 'webkitvisibilitychange', 'pagehide', 'freeze'];
    var i;
    for (i = 0; i < events.length; i++) {
      if (W.addEventListener) W.addEventListener(events[i], block, true);
      if (D.addEventListener) D.addEventListener(events[i], block, true);
    }
  }

  function installPauseGuard() {
    var Ctor = W.HTMLMediaElement;
    if (typeof Ctor === 'undefined' || !Ctor.prototype || Ctor.prototype.__ytplusPause) return;
    var origPause = Ctor.prototype.pause;
    var origPlay = Ctor.prototype.play;
    Ctor.prototype.__ytplusPause = true;
    Ctor.prototype.pause = function () {
      if (CFG.backgroundPlay && !appActive) {
        stats.pauseBlocked++;
        log('blocked pause');
        return;
      }
      this.__ytplusWantsPlay = false;
      if (typeof origPause === 'function') return origPause.apply(this, arguments);
    };
    Ctor.prototype.play = function () {
      this.__ytplusWantsPlay = true;
      if (typeof origPlay === 'function') return origPlay.apply(this, arguments);
    };
  }

  function resumeMedia() {
    if (!CFG.backgroundPlay || !D || typeof D.querySelectorAll !== 'function') return;
    var videos = D.querySelectorAll('video');
    var i;
    for (i = 0; i < videos.length; i++) {
      var v = videos[i];
      if (v && v.__ytplusWantsPlay && typeof v.play === 'function') {
        try { v.play(); } catch (e) { /* ignore */ }
      }
    }
  }

  function setAppActive(active) {
    var was = appActive;
    appActive = !!active;
    if (was && !appActive) resumeMedia();
    log('appActive', appActive);
  }

  function configureOne(video) {
    if (!video || video.__ytplusConfigured) return;
    video.__ytplusConfigured = true;
    try {
      if (typeof video.setAttribute === 'function') {
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
      }
      video.playsInline = true;
      if ('disablePictureInPicture' in video) video.disablePictureInPicture = !CFG.pictureInPicture;
    } catch (e) { /* ignore */ }
  }

  function maybeSkipAds(video) {
    var node = video;
    var hops = 0;
    var cls;
    while (node && hops < 6) {
      cls = node.className;
      if (typeof cls === 'string' && (cls.indexOf('ad-showing') !== -1 || cls.indexOf('ad-player') !== -1)) {
        skipPlayerAds(D);
        return;
      }
      node = node.parentNode;
      hops++;
    }
    // Skip buttons sit beside the player, not on the video. Only look when the
    // clip is ad-length so a Home/Shorts feed is not scanned every tick.
    if (video.duration && video.duration < 90 && D.querySelector) {
      var btn = D.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytm-ad-skip-button');
      if (btn && typeof btn.click === 'function') {
        try { btn.click(); } catch (e) { /* ignore */ }
      }
    }
  }

  function injectCSS() {
    if (!D || typeof D.createElement !== 'function') return;
    var parent = D.head || D.documentElement;
    if (!parent || typeof parent.appendChild !== 'function') return;
    var existing = null;
    try { existing = D.getElementById ? D.getElementById('ytplus-style') : null; } catch (e) { existing = null; }
    if (!existing) {
      var style = D.createElement('style');
      style.id = 'ytplus-style';
      style.textContent = 'html,body{background:#0f0f0f!important;}';
      try { parent.appendChild(style); } catch (e2) { /* ignore */ }
    }
    var hosts = ['https://i.ytimg.com', 'https://i9.ytimg.com', 'https://yt3.ggpht.com', 'https://yt3.googleusercontent.com'];
    var i, link;
    for (i = 0; i < hosts.length; i++) {
      link = D.createElement('link');
      if (!link) continue;
      if (link.setAttribute) {
        link.setAttribute('rel', 'preconnect');
        link.setAttribute('href', hosts[i]);
        link.setAttribute('crossorigin', '');
      }
      try { parent.appendChild(link); } catch (e3) { /* ignore */ }
    }
  }

  function onTick() {
    var video = null;
    if (D && typeof D.querySelector === 'function') {
      try { video = D.querySelector('video'); } catch (e) { video = null; }
    }
    if (video) configureOne(video);
    try { tick(video); } catch (e2) { /* ignore */ }
    if (CFG.adBlock && video) {
      try { maybeSkipAds(video); } catch (e3) { /* ignore */ }
    }
    if (CFG.hideShorts) {
      try { hideShortsDOM(); } catch (e4) { /* ignore */ }
    }
    if (CFG.returnYouTubeDislike) {
      try {
        var id = currentVideoId();
        if (id) ensureDislikes(id);
      } catch (e5) { /* ignore */ }
    }
  }

  function startLoops() {
    if (W.__ytplusTimer || typeof W.setInterval !== 'function') return;
    W.__ytplusTimer = W.setInterval(onTick, 1000);
  }

  function boot() {
    installVisibilityShim();
    installPauseGuard();
    injectCSS();
    startLoops();
  }

  function applySettings(o) {
    applyOverrides(o);
    if (!CFG.returnYouTubeDislike) removeDislikeLabel();
    if (CFG.hideShorts) {
      try { hideShortsDOM(); } catch (e) { /* ignore */ }
    }
    log('settings', JSON.stringify({
      adBlock: CFG.adBlock,
      sponsorBlock: CFG.sponsorBlock,
      backgroundPlay: CFG.backgroundPlay,
      deArrow: CFG.deArrow,
      hideShorts: CFG.hideShorts
    }));
    return CFG;
  }

  installParseHook();
  installResponseHook();
  installFetchHook();

  W.YouTubePlus = {
    version: VERSION,
    boot: boot,
    applySettings: applySettings,
    setAppActive: setAppActive,
    process: process,
    sponsorDecision: sponsorDecision,
    pickDeArrowTitle: pickDeArrowTitle,
    pickDeArrowThumb: pickDeArrowThumb,
    rememberBranding: rememberBranding,
    formatCount: formatCount,
    skipLabel: skipLabel,
    skipPlayerAds: skipPlayerAds,
    requestPictureInPicture: requestPictureInPicture,
    stats: function () { return stats; },
    settings: function () { return CFG; }
  };

  boot();
})();
