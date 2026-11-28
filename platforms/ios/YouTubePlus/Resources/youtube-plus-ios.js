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

  var VERSION = '1.1.5';
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
    pauseBlocked: 0,
    searchHidden: 0
  };

  var backgrounding = false;
  var blockSet = null;
  var recentHistory = [];
  var lastNow = 0;
  var lastNowKey = '';
  var lastCmd = '';
  var lastCmdAt = 0;
  var origMediaPause = null;

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

  function lsSet(key, value) {
    try { if (W.localStorage) W.localStorage.setItem('ytplus.' + key, String(value)); } catch (e) { /* ignore */ }
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

  function hasSuggestionShape(node, depth) {
    if (!node || typeof node !== 'object' || depth > 5) return false;
    if (node.searchSuggestionsSectionRenderer || node.searchSuggestionRenderer || node.searchboxSuggestionRenderer) return true;
    if (isArray(node)) return node.length > 0 && hasSuggestionShape(node[0], depth + 1);
    var keys = ['contents', 'items', 'contentsArray'];
    var i;
    for (i = 0; i < keys.length; i++) {
      if (node[keys[i]] && hasSuggestionShape(node[keys[i]], depth + 1)) return true;
    }
    return false;
  }

  function process(data) {
    if (!isObj(data) || data[MARK]) return data;
    if (hasSuggestionShape(data, 0)) filterSearchPayload(data);
    if (!shouldProcess(data) || !featuresOn()) {
      if (hasSuggestionShape(data, 0)) mark(data);
      return data;
    }
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
        if (shouldProcess(data) || hasSuggestionShape(data, 0)) data = process(data);
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

  var rawHidden = false;
  var rawState = 'visible';
  var realHiddenGet = null;
  var acceptHold = true;
  var retiredHold = 0;
  var lastTouchAt = 0;

  function pageReallyHidden() {
    if (typeof realHiddenGet === 'function') {
      try { return !!realHiddenGet.call(D); } catch (e) { /* use the stored flag */ }
    }
    return !!rawHidden;
  }

  function isLifecycleEvent(type) {
    return type === 'visibilitychange' || type === 'webkitvisibilitychange' ||
      type === 'pagehide' || type === 'freeze';
  }

  function installVisibilityShim() {
    if (!D || D.__ytplusVis) return;
    D.__ytplusVis = true;
    try {
      var proto = W.Document && W.Document.prototype;
      var desc = proto && Object.getOwnPropertyDescriptor(proto, 'hidden');
      if (desc && typeof desc.get === 'function') realHiddenGet = desc.get;
    } catch (e) { /* the test document has no native hidden getter */ }
    // Lie only while the app is actually backgrounded. In the foreground YouTube
    // must see the real flag, or its player stalls.
    var pretendVisible = function () { return CFG.backgroundPlay && !appActive; };
    try {
      Object.defineProperty(D, 'hidden', {
        configurable: true,
        get: function () { return pretendVisible() ? false : (pageReallyHidden() || rawHidden); },
        set: function (v) { rawHidden = !!v; }
      });
      Object.defineProperty(D, 'visibilityState', {
        configurable: true,
        get: function () { return pretendVisible() ? 'visible' : (rawState || (pageReallyHidden() ? 'hidden' : 'visible')); },
        set: function (v) { rawState = String(v || ''); }
      });
      Object.defineProperty(D, 'webkitHidden', {
        configurable: true,
        get: function () { return pretendVisible() ? false : (pageReallyHidden() || rawHidden); }
      });
    } catch (e2) { /* a locked document keeps its native getters */ }
    D._ytSetRawVisibility = function (hidden) {
      rawHidden = !!hidden;
      rawState = hidden ? 'hidden' : 'visible';
    };
    wrapLifecycleListeners(W);
    wrapLifecycleListeners(D);
    function onHiddenEvent(ev) {
      if (!CFG.backgroundPlay || !ev || appActive) return;
      if (ev.type === 'blur' && ev.target !== W && ev.target !== D) return;
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      else if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
      resumeWanted();
    }
    onHiddenEvent.__ytplusInternal = true;
    function noteTouch() { lastTouchAt = Date.now(); }
    noteTouch.__ytplusInternal = true;
    if (D.addEventListener) {
      D.addEventListener('touchend', noteTouch, true);
      D.addEventListener('pointerup', noteTouch, true);
      D.addEventListener('click', noteTouch, true);
    }
    var events = ['visibilitychange', 'webkitvisibilitychange', 'pagehide', 'freeze', 'blur'];
    var i;
    for (i = 0; i < events.length; i++) {
      if (W.addEventListener) W.addEventListener(events[i], onHiddenEvent, true);
      if (D.addEventListener) D.addEventListener(events[i], onHiddenEvent, true);
    }
  }

  function wrapLifecycleListeners(target) {
    if (!target || target.__ytplusAdd || typeof target.addEventListener !== 'function') return;
    var orig = target.addEventListener;
    target.__ytplusAdd = true;
    target.addEventListener = function (type, fn, capture) {
      if (isLifecycleEvent(type) && typeof fn === 'function' && !fn.__ytplusInternal) {
        var wrapped = function (ev) {
          if (CFG.backgroundPlay && !appActive) return;
          return fn.apply(this, arguments);
        };
        wrapped.__ytplusWrapped = true;
        return orig.call(this, type, wrapped, capture);
      }
      return orig.call(this, type, fn, capture);
    };
  }

  function installPauseGuard() {
    var Ctor = W.HTMLMediaElement;
    if (typeof Ctor === 'undefined' || !Ctor.prototype || Ctor.prototype.__ytplusPause) return;
    var origPause = Ctor.prototype.pause;
    var origPlay = Ctor.prototype.play;
    origMediaPause = origPause;
    Ctor.prototype.__ytplusPause = true;
    Ctor.prototype.pause = function () {
      // A tap while we are in the foreground is the user, including when
      // WebKit still reports the page hidden right after we come back.
      // Anything else while hidden or backgrounded is the lock/home transition
      // and must not be stored as a user pause, or audio will not continue.
      if (recentUserGesture() && appActive && !backgrounding) {
        this.__ytplusExplicitPause = true;
        markUserPause(this);
        if (typeof origPause === 'function') return origPause.apply(this, arguments);
        return;
      }
      if (CFG.backgroundPlay && (backgrounding || !appActive || pageReallyHidden())) {
        stats.pauseBlocked++;
        log('blocked pause');
        return;
      }
      this.__ytplusExplicitPause = true;
      markUserPause(this);
      if (typeof origPause === 'function') return origPause.apply(this, arguments);
    };
    Ctor.prototype.play = function () {
      this.__ytplusUserPaused = false;
      this.__ytplusWantsPlay = true;
      if (typeof origPlay === 'function') return origPlay.apply(this, arguments);
    };
  }

  function recentUserGesture() {
    // Only a tap in the same moment as pause(). An older touch (watching,
    // then leaving the app) must not turn WebKit's background pause into
    // a user pause, or audio stops when the app resigns active.
    return !!lastTouchAt && (Date.now() - lastTouchAt) < 200;
  }

  function cancelRecover() {
    if (W.__ytplusRecover && typeof W.clearTimeout === 'function') W.clearTimeout(W.__ytplusRecover);
    W.__ytplusRecover = null;
  }

  function markUserPause(video) {
    if (!video) return;
    video.__ytplusUserPaused = true;
    video.__ytplusWantsPlay = false;
    cancelRecover();
  }

  function userPause(video) {
    markUserPause(video);
    if (typeof origMediaPause === 'function') origMediaPause.call(video);
  }

  function freezeForBackground(video) {
    // pause() from a locked screen is ignored by WebKit on the way back to
    // play(). Leaving the element playing and parking playbackRate at 0 keeps
    // the media session allowed, so lock-screen play can set the rate to 1.
    if (!video) return;
    markUserPause(video);
    var rate = Number(video.playbackRate);
    if (isFinite(rate) && rate > 0) video.__ytplusSavedRate = rate;
    if (!video.__ytplusSavedRate) video.__ytplusSavedRate = 1;
    try { video.playbackRate = 0; } catch (e) { /* ignore */ }
    publishNowPlaying(video, true);
  }

  function releaseForPlayback(video) {
    if (!video) return;
    video.__ytplusUserPaused = false;
    video.__ytplusWantsPlay = true;
    var rate = Number(video.__ytplusSavedRate);
    if (!isFinite(rate) || rate <= 0) rate = 1;
    try { video.playbackRate = rate; } catch (e) { /* ignore */ }
    if (video.paused && typeof video.play === 'function') {
      try { video.play(); } catch (e2) { /* ignore */ }
    }
    publishNowPlaying(video, true);
  }

  function resumeWanted() {
    if (appActive || !CFG.backgroundPlay || !D || typeof D.querySelectorAll !== 'function') return;
    var videos = D.querySelectorAll('video');
    var i, v;
    for (i = 0; i < videos.length; i++) {
      v = videos[i];
      if (!v || v.__ytplusUserPaused || !v.__ytplusWantsPlay) continue;
      if (v.paused === false) continue;
      if (typeof v.play === 'function') {
        try { v.play(); } catch (e) { /* ignore */ }
      }
    }
  }

  function holdForBackground(force, generation) {
    // Retries pass force=false. After setAppActive(true) those are ignored.
    // A generation from a hold we already retired (we came back) is ignored
    // even if it was the forced first nudge.
    if (typeof generation === 'number' && generation <= retiredHold) {
      log('stale hold ignored');
      return false;
    }
    if (!force && !acceptHold) {
      log('stale hold ignored');
      return false;
    }
    acceptHold = true;
    if (!CFG.backgroundPlay) {
      appActive = false;
      backgrounding = true;
      return false;
    }
    appActive = false;
    backgrounding = true;
    log('hold for background');
    resumeWanted();
    var video = activeVideo();
    if (video) publishNowPlaying(video, true);
    return true;
  }

  function recoverIfStalled() {
    if (!appActive || !CFG.backgroundPlay || !D || typeof D.querySelectorAll !== 'function') return 0;
    var videos = D.querySelectorAll('video');
    var n = 0;
    var i, v, stalled;
    for (i = 0; i < videos.length; i++) {
      v = videos[i];
      if (!v || v.__ytplusUserPaused || !v.__ytplusWantsPlay) continue;
      stalled = (typeof v.readyState === 'number' && v.readyState < 3) || !!v.__ytplusWaiting;
      if (!stalled) continue;
      log('recover stalled video');
      try { v.currentTime = v.currentTime; } catch (e) { /* ignore */ }
      if (typeof v.play === 'function') {
        try { v.play(); } catch (e2) { /* ignore */ }
      }
      n++;
    }
    return n;
  }

  function scheduleForegroundRecover() {
    if (typeof W.setTimeout !== 'function') return;
    if (W.__ytplusRecover) {
      if (typeof W.clearTimeout === 'function') W.clearTimeout(W.__ytplusRecover);
    }
    W.__ytplusRecover = W.setTimeout(function () {
      W.__ytplusRecover = null;
      recoverIfStalled();
    }, 1500);
  }

  function setAppActive(active, generation) {
    var was = appActive;
    if (!active) {
      acceptHold = true;
      holdForBackground(true, generation);
      log('appActive', false);
      return;
    }
    // Synchronous: a background retry that arrives after this returns must
    // see the foreground and do nothing.
    acceptHold = false;
    if (typeof generation === 'number') retiredHold = generation;
    appActive = true;
    backgrounding = false;
    if (!was) scheduleForegroundRecover();
    log('appActive', true);
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
    if (video.addEventListener) {
      var force = function () { publishNowPlaying(video, true); };
      video.addEventListener('play', force);
      video.addEventListener('playing', function () { video.__ytplusWaiting = false; publishNowPlaying(video, true); });
      video.addEventListener('pause', force);
      video.addEventListener('seeked', force);
      video.addEventListener('loadedmetadata', force);
      video.addEventListener('ratechange', force);
      video.addEventListener('waiting', function () { video.__ytplusWaiting = true; });
      video.addEventListener('stalled', function () { video.__ytplusWaiting = true; });
      video.addEventListener('timeupdate', function () { publishNowPlaying(video, false); });
    }
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
      style.textContent = 'html{color-scheme:dark;}html,body{background:#0f0f0f!important;color:#f1f1f1;}html.ytplus-watch-bar body{padding-bottom:52px!important;}[aria-label="Open App"],[aria-label="Open app"]{display:none!important;}ytm-search,ytm-searchbox,.searchbox,.searchbox-input,ytm-search-suggestions,.suggestion-list,[role="listbox"],input[type="search"]{background:#0f0f0f!important;color:#f1f1f1!important;caret-color:#f1f1f1;}ytm-search-suggestion,[role="option"]{background:#0f0f0f!important;color:#f1f1f1!important;}';
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

  var PIVOT_TABS = [
    { id: 'home', label: 'Home', url: 'https://m.youtube.com/' },
    { id: 'shorts', label: 'Shorts', url: 'https://m.youtube.com/shorts' },
    { id: 'subscriptions', label: 'Subscriptions', url: 'https://m.youtube.com/feed/subscriptions' },
    { id: 'you', label: 'You', url: 'https://m.youtube.com/feed/library' }
  ];

  function isWatchPage(href, opts) {
    opts = opts || {};
    if (opts.landscape || opts.fullscreen) return false;
    var u;
    try { u = new URL(String(href || ''), 'https://m.youtube.com'); } catch (e) { return false; }
    var path = u.pathname || '';
    if (path !== '/watch' && path.indexOf('/watch/') !== 0) return false;
    return !!(u.searchParams.get('v') || path.length > '/watch/'.length);
  }

  function isOpenAppLabel(text) {
    var t = String(text || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').toLowerCase();
    return t === 'open app';
  }

  function landscapeNow() {
    try {
      return !!(W.matchMedia && W.matchMedia('(orientation: landscape)').matches);
    } catch (e) { return false; }
  }

  function syncWatchBar() {
    if (!D || !D.documentElement || typeof D.createElement !== 'function') return;
    var href = '';
    try { href = W.location && W.location.href; } catch (e) { href = ''; }
    var show = isWatchPage(href, {
      landscape: landscapeNow(),
      fullscreen: !!(D.fullscreenElement || D.webkitFullscreenElement)
    });
    var root = D.documentElement;
    var bar = D.__ytplusPivot;
    if (!show) {
      if (bar && bar.parentNode && bar.parentNode.removeChild) bar.parentNode.removeChild(bar);
      D.__ytplusPivot = null;
      if (root.classList && root.classList.remove) root.classList.remove('ytplus-watch-bar');
      return;
    }
    if (root.classList && root.classList.add) root.classList.add('ytplus-watch-bar');
    if (bar) return;
    bar = D.createElement('nav');
    bar.id = 'ytplus-pivot';
    if (bar.setAttribute) bar.setAttribute('aria-label', 'YouTube +');
    if (bar.style) bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483646;display:flex;height:52px;margin:0;padding:0;background:#0f0f0f;border-top:1px solid rgba(255,255,255,.12);';
    var i, tab, btn;
    for (i = 0; i < PIVOT_TABS.length; i++) {
      tab = PIVOT_TABS[i];
      btn = D.createElement('button');
      btn.type = 'button';
      btn.textContent = tab.label;
      if (btn.setAttribute) btn.setAttribute('data-ytplus-tab', tab.id);
      if (btn.style) btn.style.cssText = 'flex:1;background:transparent;color:#fff;border:0;font:600 11px -apple-system,BlinkMacSystemFont,sans-serif;';
      btn.onclick = (function (url) {
        return function () { try { W.location.href = url; } catch (err) { /* ignore */ } };
      })(tab.url);
      if (bar.appendChild) bar.appendChild(btn);
    }
    var parent = D.body || root;
    if (parent && parent.appendChild) parent.appendChild(bar);
    D.__ytplusPivot = bar;
  }

  function hideOpenApp() {
    if (!D || typeof D.querySelectorAll !== 'function') return 0;
    var scopes = D.querySelectorAll('ytm-mobile-topbar-renderer, ytm-header-bar, header');
    var n = 0;
    var s, nodes, i, el, label;
    if (!scopes || !scopes.length) {
      var one = D.querySelector && D.querySelector('[aria-label="Open App"], [aria-label="Open app"]');
      if (one && one.style) { one.style.display = 'none'; return 1; }
      return 0;
    }
    for (s = 0; s < scopes.length; s++) {
      nodes = scopes[s].querySelectorAll ? scopes[s].querySelectorAll('a, button') : [];
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        label = (el.getAttribute && (el.getAttribute('aria-label') || '')) || el.innerText || el.textContent || '';
        if (!isOpenAppLabel(label) || !el.style) continue;
        el.style.display = 'none';
        n++;
      }
    }
    return n;
  }

  function postToApp(payload) {
    try {
      if (W.webkit && W.webkit.messageHandlers && W.webkit.messageHandlers.ytplus) {
        W.webkit.messageHandlers.ytplus.postMessage(payload);
      }
    } catch (e) { /* ignore */ }
  }

  var SETTINGS_PAGE_LABELS = {
    general: 1, account: 1, notifications: 1, privacy: 1, playback: 1,
    'playback and performance': 1, 'connected apps': 1, advanced: 1,
    'billing & payments': 1, 'billing and payments': 1,
    'purchases and memberships': 1, autoplay: 1, downloads: 1,
    'your data in youtube': 1, 'video quality preferences': 1,
    'history & privacy': 1, 'history and privacy': 1
  };
  var ACCOUNT_MENU_LABELS = {
    settings: 1, help: 1, 'send feedback': 1, 'sign out': 1, 'switch account': 1
  };

  function normLabel(s) {
    return String(s || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').toLowerCase();
  }

  function elementChildren(el) {
    var raw = el && el.children;
    if (!raw || typeof raw.length !== 'number') return [];
    var out = [];
    var i;
    for (i = 0; i < raw.length; i++) if (raw[i]) out.push(raw[i]);
    return out;
  }

  function elementText(el) {
    if (!el) return '';
    if (typeof el.textContent === 'string' && el.textContent) return el.textContent;
    var kids = elementChildren(el);
    var i, parts = [];
    for (i = 0; i < kids.length; i++) parts.push(elementText(kids[i]));
    return parts.join(' ');
  }

  function walkElements(node, out) {
    if (!node || node.nodeType === 3) return;
    out.push(node);
    var kids = elementChildren(node);
    var i;
    for (i = 0; i < kids.length; i++) walkElements(kids[i], out);
  }

  function matchesLabel(text, table) {
    var n = normLabel(text);
    if (!n) return false;
    if (table[n]) return true;
    var k;
    for (k in table) {
      if (!hasOwn(table, k)) continue;
      if (n.indexOf(k) === 0 && (n.length === k.length || n.charAt(k.length) === ' ')) return true;
    }
    return false;
  }

  function listKind(el) {
    var kids = elementChildren(el);
    var page = 0;
    var account = 0;
    var i;
    for (i = 0; i < kids.length; i++) {
      if (kids[i].getAttribute && kids[i].getAttribute('data-ytplus-settings')) continue;
      if (matchesLabel(elementText(kids[i]), SETTINGS_PAGE_LABELS)) page++;
      if (matchesLabel(elementText(kids[i]), ACCOUNT_MENU_LABELS)) account++;
    }
    if (page >= 2) return 'page';
    if (account >= 2) return 'account';
    return '';
  }

  function isChevron(el) {
    if (!el) return false;
    var tag = String(el.tagName || el.nodeName || '');
    var blob = String(el.className || '');
    if (el.getAttribute) blob += ' ' + String(el.getAttribute('class') || '') + ' ' + String(el.getAttribute('icon') || '');
    if (/^svg$/i.test(tag)) return true;
    return /chevron|arrow-right|yt-icon|iron-icon/i.test(blob + ' ' + tag);
  }

  function rowHasChevron(el) {
    var all = [];
    walkElements(el, all);
    var i;
    for (i = 0; i < all.length; i++) if (i > 0 && isChevron(all[i])) return true;
    return false;
  }

  function isCategoryRow(el, kind) {
    if (!el || (el.getAttribute && el.getAttribute('data-ytplus-settings') === '1')) return false;
    var text = elementText(el);
    if (kind === 'page') return matchesLabel(text, SETTINGS_PAGE_LABELS);
    if (kind === 'account') return matchesLabel(text, ACCOUNT_MENU_LABELS);
    return false;
  }

  function dropHrefs(el) {
    if (!el) return;
    if (el.removeAttribute && el.getAttribute && el.getAttribute('href') != null) el.removeAttribute('href');
    var kids = elementChildren(el);
    var i;
    for (i = 0; i < kids.length; i++) dropHrefs(kids[i]);
  }

  function stripIds(el) {
    if (!el) return;
    if (el.removeAttribute) el.removeAttribute('id');
    if (el.id && el.id !== 'ytplus-settings-row') el.id = '';
    var kids = elementChildren(el);
    var i;
    for (i = 0; i < kids.length; i++) stripIds(kids[i]);
  }

  function replaceVisibleLabel(row) {
    var leaves = [];
    function collect(el) {
      var ch = elementChildren(el);
      if (!ch.length) { leaves.push(el); return; }
      var n;
      for (n = 0; n < ch.length; n++) collect(ch[n]);
    }
    collect(row);
    var i, t;
    for (i = 0; i < leaves.length; i++) {
      if (isChevron(leaves[i])) continue;
      t = leaves[i].textContent || '';
      if (matchesLabel(t, SETTINGS_PAGE_LABELS) || matchesLabel(t, ACCOUNT_MENU_LABELS)) {
        leaves[i].textContent = 'YouTube +';
        return true;
      }
    }
    var cn = row.childNodes;
    if (cn) {
      for (i = 0; i < cn.length; i++) {
        if (cn[i].nodeType === 3 && (matchesLabel(cn[i].nodeValue, SETTINGS_PAGE_LABELS) || matchesLabel(cn[i].nodeValue, ACCOUNT_MENU_LABELS))) {
          cn[i].nodeValue = 'YouTube +';
          return true;
        }
      }
    }
    t = row.textContent || '';
    if (!(matchesLabel(t, SETTINGS_PAGE_LABELS) || matchesLabel(t, ACCOUNT_MENU_LABELS))) return false;
    var icons = [];
    var kids = elementChildren(row);
    for (i = 0; i < kids.length; i++) if (isChevron(kids[i])) icons.push(kids[i]);
    row.textContent = 'YouTube +';
    for (i = 0; i < icons.length; i++) {
      var still = elementChildren(row);
      var present = false;
      var j;
      for (j = 0; j < still.length; j++) if (still[j] === icons[i]) present = true;
      if (!present && row.appendChild) row.appendChild(icons[i]);
    }
    return true;
  }

  function rowShowsLabel(row) {
    var all = [];
    walkElements(row, all);
    var i, t = '';
    for (i = 0; i < all.length; i++) {
      if (!elementChildren(all[i]).length && all[i].textContent) t += ' ' + all[i].textContent;
    }
    return normLabel(t).indexOf('youtube +') !== -1;
  }

  function ensureChevron(row, doc) {
    if (rowHasChevron(row) || !doc || typeof doc.createElement !== 'function') return;
    var icon = doc.createElement('span');
    icon.className = 'yt-icon chevron-right';
    if (icon.setAttribute) {
      icon.setAttribute('class', 'yt-icon chevron-right');
      icon.setAttribute('aria-hidden', 'true');
    }
    if (typeof icon.innerHTML === 'string' || icon.innerHTML === '') {
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"></path></svg>';
    } else {
      icon.textContent = '\u203A';
    }
    if (row.appendChild) row.appendChild(icon);
  }

  function openNativeSettings(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    if (ev && ev.stopPropagation) ev.stopPropagation();
    postToApp({ type: 'settings' });
    return false;
  }

  function insertAfter(parent, node, after) {
    var kids = elementChildren(parent);
    var i, at = -1;
    for (i = 0; i < kids.length; i++) if (kids[i] === after) at = i;
    var next = at >= 0 ? kids[at + 1] : null;
    if (next && parent.insertBefore) parent.insertBefore(node, next);
    else if (parent.appendChild) parent.appendChild(node);
  }

  // One entry, cloned from a real category row so it keeps YouTube's padding,
  // type, and chevron. It sits with those rows, above the page footer, and
  // opens the native sheet. Re-inserted after SPA redraws.
  function mountSettingsEntry(doc) {
    doc = doc || D;
    if (!doc || typeof doc.createElement !== 'function') return false;
    var root = doc.body || doc.documentElement || doc;
    var all = [];
    walkElements(root, all);
    var pages = [];
    var accounts = [];
    var i, kind;
    for (i = 0; i < all.length; i++) {
      kind = listKind(all[i]);
      if (kind === 'page') pages.push(all[i]);
      else if (kind === 'account') accounts.push(all[i]);
    }
    var host = pages[0] || accounts[0];
    if (!host) return false;
    kind = pages.length ? 'page' : 'account';
    var kids = elementChildren(host);
    var proto = null;
    var lastCategory = null;
    for (i = 0; i < kids.length; i++) {
      if (kids[i].getAttribute && kids[i].getAttribute('data-ytplus-settings') === '1') return true;
      if (!isCategoryRow(kids[i], kind)) continue;
      lastCategory = kids[i];
      if (!proto || rowHasChevron(kids[i])) proto = kids[i];
    }
    if (!proto) return false;
    var row = null;
    if (typeof proto.cloneNode === 'function') {
      try { row = proto.cloneNode(true); } catch (e) { row = null; }
    }
    if (!row) row = doc.createElement('button');
    stripIds(row);
    dropHrefs(row);
    if (proto.className && !row.className) row.className = proto.className;
    var copiedClass = proto.getAttribute && proto.getAttribute('class');
    if (copiedClass && row.setAttribute && !(row.getAttribute && row.getAttribute('class'))) row.setAttribute('class', copiedClass);
    replaceVisibleLabel(row);
    if (!rowShowsLabel(row)) {
      var span = doc.createElement('span');
      span.className = 'compact-link-text';
      span.textContent = 'YouTube +';
      if (span.setAttribute) span.setAttribute('class', 'compact-link-text');
      var first = elementChildren(row)[0];
      if (first && row.insertBefore) row.insertBefore(span, first);
      else if (row.appendChild) row.appendChild(span);
    }
    ensureChevron(row, doc);
    if (row.setAttribute) {
      row.setAttribute('data-ytplus-settings', '1');
      row.setAttribute('aria-label', 'YouTube +');
      row.setAttribute('role', 'button');
    }
    row.onclick = openNativeSettings;
    if (row.addEventListener) row.addEventListener('click', openNativeSettings, true);
    if (!row.className && !(row.getAttribute && row.getAttribute('class')) && row.style) {
      row.style.cssText = 'display:flex;align-items:center;box-sizing:border-box;width:100%;min-height:48px;margin:0;padding:0 16px;border:0;background:transparent;color:#f1f1f1;font:400 16px Roboto,Arial,sans-serif;text-align:left;';
    }
    insertAfter(host, row, lastCategory);
    return true;
  }

  function normQuery(s) {
    return normLabel(s);
  }

  function loadBlock() {
    if (blockSet) return blockSet;
    blockSet = {};
    try {
      var raw = lsGet('searchBlock');
      var list = raw ? JSON.parse(raw) : [];
      var i;
      if (isArray(list)) {
        for (i = 0; i < list.length; i++) blockSet[normQuery(list[i])] = 1;
      }
    } catch (e) { blockSet = {}; }
    return blockSet;
  }

  function rememberSearchRemoval(query) {
    var n = normQuery(query);
    if (!n || n === 'remove' || n === 'remove all') return false;
    var set = loadBlock();
    set[n] = 1;
    var list = [];
    var k;
    for (k in set) if (hasOwn(set, k)) list.push(k);
    lsSet('searchBlock', JSON.stringify(list));
    return true;
  }

  function suggestionInner(node) {
    if (!node || typeof node !== 'object' || isArray(node)) return null;
    if (node.searchSuggestionRenderer) return node.searchSuggestionRenderer;
    if (node.searchboxSuggestionRenderer) return node.searchboxSuggestionRenderer;
    if (node.suggestion && (node.icon || node.serviceEndpoint || node.feedbackEndpoint)) return node;
    return null;
  }

  function suggestionQuery(inner) {
    if (!inner) return '';
    var s = inner.suggestion;
    if (typeof s === 'string') return s;
    if (s && typeof s.simpleText === 'string') return s.simpleText;
    if (s && s.runs && s.runs[0] && typeof s.runs[0].text === 'string') return s.runs[0].text;
    if (typeof inner.query === 'string') return inner.query;
    return '';
  }

  function suggestionToken(inner) {
    if (!inner) return '';
    var ep = inner.serviceEndpoint || inner.feedbackEndpoint || null;
    if (ep && ep.innertubeCommand) ep = ep.innertubeCommand;
    var fb = inner.feedbackEndpoint || (ep && (ep.feedbackEndpoint || null));
    if (fb && typeof fb.feedbackToken === 'string') return fb.feedbackToken;
    return '';
  }

  function rememberRecent(query, token) {
    var n = normQuery(query);
    if (!n) return;
    var i;
    for (i = 0; i < recentHistory.length; i++) {
      if (recentHistory[i].query === n) {
        if (token && !recentHistory[i].token) recentHistory[i].token = token;
        return;
      }
    }
    recentHistory.push({ query: n, token: token || '' });
    if (recentHistory.length > 100) recentHistory.shift();
  }

  function filterSearchPayload(data) {
    var blocked = loadBlock();
    function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > 14) return;
      if (isArray(node)) {
        var w = 0;
        var i, inner, q, n;
        for (i = 0; i < node.length; i++) {
          inner = suggestionInner(node[i]);
          if (inner) {
            q = suggestionQuery(inner);
            n = normQuery(q);
            rememberRecent(q, suggestionToken(inner));
            if (n && blocked[n]) {
              stats.searchHidden++;
              continue;
            }
          }
          walk(node[i], depth + 1);
          node[w++] = node[i];
        }
        node.length = w;
        return;
      }
      var k;
      for (k in node) {
        if (hasOwn(node, k) && node[k] && typeof node[k] === 'object') walk(node[k], depth + 1);
      }
    }
    walk(data, 0);
    return data;
  }

  function tryFeedback(token) {
    if (!token || typeof W.fetch !== 'function') return;
    var client = { clientName: 'MWEB', clientVersion: '2.20250101.00.00' };
    try {
      if (W.ytcfg && typeof W.ytcfg.get === 'function') {
        var ctx = W.ytcfg.get('INNERTUBE_CONTEXT');
        if (ctx && ctx.client) client = ctx.client;
      }
    } catch (e) { /* keep the mobile client */ }
    try {
      W.fetch('/youtubei/v1/feedback?prettyPrint=false', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: { client: client }, feedbackTokens: [token] })
      }).catch(function () {});
    } catch (err) { /* the blocklist still hides it */ }
  }

  function isRemoveControl(el) {
    if (!el) return false;
    var text = normLabel(el.textContent || '');
    var label = el.getAttribute ? String(el.getAttribute('aria-label') || el.getAttribute('title') || '') : '';
    if (/remove|delete/i.test(label)) return true;
    if (text === 'remove' || text === 'delete') return true;
    return false;
  }

  function rowQuery(row) {
    if (!row) return '';
    var explicit = row.getAttribute && row.getAttribute('data-ytplus-query');
    if (explicit) return explicit;
    return String(row.textContent || '').replace(/\b(remove|delete)\b/ig, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  }

  function eachSuggestionRow(doc, fn) {
    var root = doc && (doc.body || doc.documentElement || doc);
    if (!root) return;
    var all = [];
    walkElements(root, all);
    var i, kids, j;
    for (i = 0; i < all.length; i++) {
      kids = elementChildren(all[i]);
      for (j = 0; j < kids.length; j++) {
        if (!isRemoveControl(kids[j])) continue;
        var q = rowQuery(all[i]);
        if (q) fn(all[i], q);
        break;
      }
    }
  }

  function handleSearchClick(target) {
    var node = target;
    var hops = 0;
    var control = null;
    while (node && hops < 5) {
      if (isRemoveControl(node)) { control = node; break; }
      node = node.parentNode;
      hops++;
    }
    if (!control || !control.parentNode) return false;
    var row = control.parentNode;
    var query = rowQuery(row);
    if (!query || normQuery(query).length > 120) return false;
    rememberSearchRemoval(query);
    var token = row.getAttribute && (row.getAttribute('data-ytplus-token') || '');
    if (token) tryFeedback(token);
    if (row.style) row.style.display = 'none';
    return true;
  }

  function scrubSearch(doc) {
    doc = doc || D;
    var blocked = loadBlock();
    eachSuggestionRow(doc, function (row, q) {
      if (blocked[normQuery(q)] && row.style) row.style.display = 'none';
    });
  }

  function paintSearch(doc) {
    doc = doc || D;
    var nodes = [];
    if (doc && doc.querySelectorAll) {
      var found = doc.querySelectorAll('ytm-search, ytm-searchbox, ytm-search-suggestions, input[type="search"], [role="listbox"]');
      var i;
      if (found && found.length) {
        for (i = 0; i < found.length; i++) nodes.push(found[i]);
      }
    }
    eachSuggestionRow(doc, function (row) {
      nodes.push(row);
      if (row.parentNode) nodes.push(row.parentNode);
    });
    var j, el;
    for (j = 0; j < nodes.length; j++) {
      el = nodes[j];
      if (!el || !el.style) continue;
      el.style.backgroundColor = '#0f0f0f';
      el.style.color = '#f1f1f1';
    }
  }

  function activeVideo() {
    if (!D || typeof D.querySelectorAll !== 'function') return null;
    var list = D.querySelectorAll('video');
    if (!list || !list.length) return null;
    var i, best = null, bestArea = -1, area;
    for (i = 0; i < list.length; i++) {
      if (!list[i]) continue;
      if (list[i].paused === false && !list[i].ended) return list[i];
      area = (list[i].videoWidth || 0) * (list[i].videoHeight || 0);
      if (!best || area >= bestArea) { best = list[i]; bestArea = area; }
    }
    return best;
  }

  function attrContent(el) {
    if (!el) return '';
    if (el.getAttribute) {
      var c = el.getAttribute('content') || el.getAttribute('href');
      if (c) return c;
    }
    return String(el.textContent || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  }

  function readTitle() {
    if (!D || !D.querySelector) return '';
    var h = D.querySelector('h1.slim-video-information-title, ytm-slim-video-information-renderer h1, h1');
    var t = attrContent(h);
    if (t) return t;
    return attrContent(D.querySelector('meta[property="og:title"]'));
  }

  function readAuthor() {
    if (!D || !D.querySelector) return '';
    return attrContent(D.querySelector('ytm-video-owner-renderer a, ytm-channel-name, .slim-owner-channel-name'));
  }

  function readArtwork(video) {
    var og = D && D.querySelector && D.querySelector('meta[property="og:image"], link[itemprop="thumbnailUrl"]');
    var u = attrContent(og);
    if (u) return u;
    if (video && video.poster) return video.poster;
    var id = currentVideoId();
    if (id) return 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
    return '';
  }

  function bindMediaSession(ms, name, fn) {
    if (!ms || typeof ms.setActionHandler !== 'function') return;
    try { ms.setActionHandler(name, fn); } catch (e) { /* ignore */ }
  }

  function syncMediaSession(info) {
    var ms = W.navigator && W.navigator.mediaSession;
    if (!ms) return;
    try {
      if (typeof W.MediaMetadata === 'function') {
        ms.metadata = new W.MediaMetadata({
          title: info.title || 'YouTube +',
          artist: info.author || '',
          artwork: info.artwork ? [{ src: info.artwork, sizes: '512x512', type: 'image/jpeg' }] : []
        });
      }
      if (!appActive && typeof ms.setPositionState === 'function' && info.duration > 0) {
        var pos = info.elapsed;
        if (pos < 0) pos = 0;
        if (pos > info.duration) pos = info.duration;
        ms.setPositionState({
          duration: info.duration,
          playbackRate: info.rate > 0 ? info.rate : 1,
          position: pos
        });
      }
      if (!appActive && ms.playbackState !== undefined) ms.playbackState = info.rate > 0 ? 'playing' : 'paused';
    } catch (e) { /* WebKit rejects a position past the duration */ }
    // Re-apply every time. m.youtube.com installs its own handlers, and the
    // lock screen then seeks by WebKit's default of five seconds.
    // Ours always seek ten seconds.
    bindMediaSession(ms, 'play', function () { remoteCommand('play'); });
    bindMediaSession(ms, 'pause', function () { remoteCommand('pause'); });
    bindMediaSession(ms, 'seekbackward', function () { remoteCommand('skip', -10); });
    bindMediaSession(ms, 'seekforward', function () { remoteCommand('skip', 10); });
    bindMediaSession(ms, 'seekto', function (d) {
      if (d && typeof d.seekTime === 'number') remoteCommand('seek', d.seekTime);
    });
    bindMediaSession(ms, 'nexttrack', null);
    bindMediaSession(ms, 'previoustrack', null);
    if (!ms.__ytplusClaim && typeof ms.setActionHandler === 'function') {
      ms.__ytplusClaim = true;
      var origSet = ms.setActionHandler;
      ms.setActionHandler = function (name, handler) {
        if (name === 'seekforward') return origSet.call(this, name, function () { remoteCommand('skip', 10); });
        if (name === 'seekbackward') return origSet.call(this, name, function () { remoteCommand('skip', -10); });
        if (name === 'play') return origSet.call(this, name, function () { remoteCommand('play'); });
        if (name === 'pause') return origSet.call(this, name, function () { remoteCommand('pause'); });
        if (name === 'nexttrack' || name === 'previoustrack') return origSet.call(this, name, null);
        return origSet.call(this, name, handler);
      };
    }
  }

  function publishNowPlaying(video, force) {
    video = video || activeVideo();
    if (!video) return null;
    var id = currentVideoId() || '';
    var src = String(video.currentSrc || video.src || '');
    var key = id + '|' + src;
    var now = Date.now();
    if (!force && key === lastNowKey && now - lastNow < 1000) return null;
    lastNow = now;
    lastNowKey = key;
    var duration = (typeof video.duration === 'number' && isFinite(video.duration)) ? video.duration : 0;
    var elapsed = (typeof video.currentTime === 'number' && isFinite(video.currentTime)) ? video.currentTime : 0;
    var info = {
      type: 'nowPlaying',
      title: readTitle(),
      author: readAuthor(),
      artwork: readArtwork(video),
      duration: duration,
      elapsed: elapsed,
      rate: (function () {
        if (video.paused) return 0;
        var pr = Number(video.playbackRate);
        return isFinite(pr) ? pr : 1;
      })(),
      videoId: id
    };
    syncMediaSession(info);
    postToApp(info);
    return info;
  }

  function setTime(video, t) {
    if (!isFinite(t)) return;
    if (t < 0) t = 0;
    var d = video.duration;
    if (typeof d === 'number' && isFinite(d) && d > 0 && t > d) t = d;
    video.currentTime = t;
  }

  function remoteCommand(name, value) {
    var sig = String(name) + ':' + (value == null ? '' : String(value));
    var now = Date.now();
    if (sig === lastCmd && now - lastCmdAt < 200) return false;
    lastCmd = sig;
    lastCmdAt = now;
    var video = activeVideo();
    if (!video) return false;
    if (name === 'play') {
      releaseForPlayback(video);
      return true;
    } else if (name === 'pause') {
      if (!appActive || backgrounding) freezeForBackground(video);
      else userPause(video);
    } else if (name === 'toggle') {
      if (video.__ytplusUserPaused || video.paused || Number(video.playbackRate) === 0) releaseForPlayback(video);
      else if (!appActive || backgrounding) freezeForBackground(video);
      else userPause(video);
    } else     if (name === 'skip') {
      // Lock-screen skip is always 10 seconds, even if a handler was told five.
      var delta = Number(value);
      if (!isFinite(delta) || Math.abs(delta) !== 10) delta = delta < 0 ? -10 : 10;
      setTime(video, (Number(video.currentTime) || 0) + delta);
    } else if (name === 'seek') {
      var at = Number(value);
      if (!isFinite(at)) return false;
      setTime(video, at);
    } else return false;
    publishNowPlaying(video, true);
    return true;
  }

  function installWatchChrome() {
    if (!D || D.__ytplusWatch) return;
    D.__ytplusWatch = true;
    try {
      if (W.matchMedia) {
        var mq = W.matchMedia('(orientation: landscape)');
        var onChange = function () { syncWatchBar(); };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      }
    } catch (e) { /* ignore */ }
    if (D.addEventListener) {
      D.addEventListener('yt-navigate-finish', function () {
        syncWatchBar();
        hideOpenApp();
        mountSettingsEntry(D);
        scrubSearch(D);
        paintSearch(D);
      }, true);
      D.addEventListener('click', function (ev) {
        try { handleSearchClick(ev && ev.target); } catch (e) { /* ignore */ }
      }, true);
    }
    syncWatchBar();
    hideOpenApp();
    mountSettingsEntry(D);
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
    try { syncWatchBar(); } catch (e6) { /* ignore */ }
    try { hideOpenApp(); } catch (e7) { /* ignore */ }
    try { mountSettingsEntry(D); } catch (e8) { /* ignore */ }
    try { scrubSearch(D); paintSearch(D); } catch (e9) { /* ignore */ }
    try {
      var playing = activeVideo();
      if (playing) publishNowPlaying(playing, false);
    } catch (e10) { /* ignore */ }
  }

  function startLoops() {
    if (W.__ytplusTimer || typeof W.setInterval !== 'function') return;
    W.__ytplusTimer = W.setInterval(onTick, 1000);
  }

  function isMainFrame() {
    try {
      if (!W.top) return true;
      return W.top === W;
    } catch (e) { return true; }
  }

  function boot() {
    installVisibilityShim();
    installPauseGuard();
    // Subframes only need the lifecycle hooks. The feed parser and the poll
    // timer stay in the main frame so tab switches do not each walk JSON.
    if (!isMainFrame()) return;
    injectCSS();
    installWatchChrome();
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

  if (isMainFrame()) {
    installParseHook();
    installResponseHook();
    installFetchHook();
  }

  W.YouTubePlus = {
    version: VERSION,
    boot: boot,
    applySettings: applySettings,
    setAppActive: setAppActive,
    holdForBackground: holdForBackground,
    recoverIfStalled: recoverIfStalled,
    process: process,
    sponsorDecision: sponsorDecision,
    pickDeArrowTitle: pickDeArrowTitle,
    pickDeArrowThumb: pickDeArrowThumb,
    rememberBranding: rememberBranding,
    formatCount: formatCount,
    skipLabel: skipLabel,
    skipPlayerAds: skipPlayerAds,
    requestPictureInPicture: requestPictureInPicture,
    isWatchPage: isWatchPage,
    isOpenAppLabel: isOpenAppLabel,
    pivotTabs: function () { return PIVOT_TABS; },
    mountSettingsEntry: mountSettingsEntry,
    rememberSearchRemoval: rememberSearchRemoval,
    filterSearchPayload: filterSearchPayload,
    blockedSearches: function () { var set = loadBlock(); var k, out = []; for (k in set) if (hasOwn(set, k)) out.push(k); return out; },
    handleSearchClick: handleSearchClick,
    scrubSearch: scrubSearch,
    paintSearch: paintSearch,
    remoteCommand: remoteCommand,
    publishNowPlaying: publishNowPlaying,
    stats: function () { return stats; },
    settings: function () { return CFG; }
  };

  boot();
})();
