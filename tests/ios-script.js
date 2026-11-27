// Offline tests for the iOS injected script (platforms/ios/js/youtube-plus-ios.js).
// Run: node tests/ios-script.js
// Proves InnerTube ad stripping, menu preservation, SponsorBlock decisions,
// the visibility shim, and the settings bridge. It does not load m.youtube.com.
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var scriptPath = path.join(root, 'platforms', 'ios', 'js', 'youtube-plus-ios.js');
var rulesPath = path.join(root, 'platforms', 'ios', 'js', 'content-rules.json');
var bundledScript = path.join(root, 'platforms', 'ios', 'YouTubePlus', 'Resources', 'youtube-plus-ios.js');
var bundledRules = path.join(root, 'platforms', 'ios', 'YouTubePlus', 'Resources', 'content-rules.json');
var bundleInfo = path.join(root, 'platforms', 'ios', 'YouTubePlus', 'Resources', 'bundle-info.json');

var checks = 0;
function check(cond, msg) {
  assert.ok(cond, msg);
  checks++;
}

function load(hostname) {
  hostname = hostname || 'm.youtube.com';
  var listeners = [];
  var store = {};
  var doc = {
    readyState: 'complete',
    documentElement: { style: {}, appendChild: function () {} },
    head: { appendChild: function () {} },
    body: { appendChild: function () {} },
    addEventListener: function (type, fn, cap) { listeners.push({ type: type, fn: fn, cap: cap, target: 'document' }); },
    removeEventListener: function () {},
    createElement: function () { return { style: {}, setAttribute: function () {}, appendChild: function () {}, id: '' }; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
  var win = {
    document: doc,
    location: {
      href: 'https://' + hostname + '/watch?v=abcdefghijk',
      pathname: '/watch',
      search: '?v=abcdefghijk',
      hostname: hostname
    },
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); }
    },
    navigator: { userAgent: 'test' },
    addEventListener: function (type, fn, cap) { listeners.push({ type: type, fn: fn, cap: cap, target: 'window' }); },
    removeEventListener: function () {},
    setInterval: function (fn, ms) { win.__timers.push({ fn: fn, ms: ms }); return win.__timers.length; },
    clearInterval: function () {},
    setTimeout: function (fn) { return 1; },
    clearTimeout: function () {},
    console: console,
    YTPLUS_CONFIG: {},
    __timers: [],
    __fetchURLs: [],
    __fetchBody: '{}',
    URL: URL,
    URLSearchParams: URLSearchParams
  };
  win.window = win;
  doc.defaultView = win;
  var ctx = vm.createContext(win);
  vm.runInContext([
    'function Response(body) {',
    '  this._body = body;',
    '  this.url = "";',
    '  this.status = 200;',
    '}',
    'Response.prototype.json = function () {',
    '  return Promise.resolve(JSON.parse(this._body));',
    '};',
    'Response.prototype.text = function () {',
    '  return Promise.resolve(this._body);',
    '};',
    'Response.prototype.clone = function () { return new Response(this._body); };',
    'function fetch(url) {',
    '  __fetchURLs.push(String(url));',
    '  var res = new Response(__fetchBody || "{}");',
    '  res.url = String(url);',
    '  return Promise.resolve(res);',
    '}',
    'function HTMLMediaElement() {}',
    'HTMLMediaElement.prototype.pause = function () { this.pauses = (this.pauses || 0) + 1; };',
    'HTMLMediaElement.prototype.play = function () { this.plays = (this.plays || 0) + 1; };',
    'this.Response = Response;',
    'this.fetch = fetch;',
    'this.HTMLMediaElement = HTMLMediaElement;'
  ].join('\n'), ctx);
  vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), ctx);
  return { win: win, doc: doc, listeners: listeners, YP: win.YouTubePlus };
}

function reset(YP) {
  YP.applySettings({
    adBlock: true,
    sponsorBlock: true,
    backgroundPlay: true,
    pictureInPicture: true,
    deArrow: false,
    returnYouTubeDislike: false,
    hideShorts: false,
    debug: false,
    categories: { sponsor: true, intro: true, outro: true, selfpromo: true, interaction: true }
  });
  YP.setAppActive(true);
}

function player() {
  return {
    responseContext: { serviceTrackingParams: [] },
    videoDetails: { videoId: 'abcdefghijk', title: 'Hello' },
    streamingData: { formats: [{ itag: 18 }] },
    playabilityStatus: { status: 'OK' },
    playerAds: [{ ad: 1 }],
    adPlacements: [{ adPlacementRenderer: { renderer: {} } }],
    adSlots: [{ slot: 1 }]
  };
}

function homeFeed() {
  return {
    responseContext: {},
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            content: {
              richGridRenderer: {
                contents: [
                  { richItemRenderer: { content: { videoRenderer: {
                    videoId: 'abcdefghijk',
                    title: { runs: [{ text: 'A real video' }] },
                    menu: { menuRenderer: { items: [
                      { menuServiceItemRenderer: { text: { simpleText: 'Not interested' } } },
                      { menuServiceItemRenderer: { text: { simpleText: "Don't recommend channel" } } },
                      { menuServiceItemRenderer: { text: { simpleText: 'Save to playlist' } } }
                    ] } }
                  } } } },
                  { richItemRenderer: { content: { adSlotRenderer: { adSlotMetadata: {} } } } },
                  { adSlotRenderer: {} },
                  { promotedVideoRenderer: { videoId: 'promo' } }
                ]
              }
            }
          }
        }]
      }
    },
    onResponseReceivedActions: [{
      appendContinuationItemsAction: {
        continuationItems: [
          { richItemRenderer: { content: { videoRenderer: {
            videoId: 'bbbbbbbbbbb',
            title: { simpleText: 'Next' },
            menu: { menuRenderer: { items: [
              { menuServiceItemRenderer: { text: { simpleText: 'Not interested' } } }
            ] } }
          } } } },
          { richItemRenderer: { content: { displayAdRenderer: {} } } }
        ]
      }
    }]
  };
}

function segments() {
  return [
    { category: 'sponsor', actionType: 'skip', segment: [10, 20], UUID: 'a' },
    { category: 'intro', actionType: 'skip', segment: [0, 5], UUID: 'b' },
    { category: 'outro', actionType: 'skip', segment: [100, 110], UUID: 'c' },
    { category: 'selfpromo', actionType: 'skip', segment: [30, 40], UUID: 'd' },
    { category: 'interaction', actionType: 'skip', segment: [50, 60], UUID: 'e' },
    { category: 'sponsor', actionType: 'poi', segment: [70, 71], UUID: 'f' },
    { category: 'sponsor', actionType: 'full', segment: [200, 210], UUID: 'g' },
    { category: 'sponsor', segment: [80, 90], UUID: 'h' }
  ];
}

function countNodes(node) {
  if (!node || typeof node !== 'object') return 0;
  var n = 1;
  var i, k;
  if (Array.isArray(node)) {
    for (i = 0; i < node.length; i++) n += countNodes(node[i]);
    return n;
  }
  for (k in node) if (Object.prototype.hasOwnProperty.call(node, k)) n += countNodes(node[k]);
  return n;
}

function fatBrowse(n) {
  var contents = [];
  var i;
  for (i = 0; i < n; i++) {
    contents.push({ richItemRenderer: { content: { videoRenderer: {
      videoId: 'abcdefghijk',
      title: { runs: [{ text: 'Video ' + i }] },
      thumbnail: { thumbnails: [
        { url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', width: 480, height: 360 },
        { url: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg', width: 320, height: 180 }
      ] },
      trackingParams: 'x',
      accessibility: { accessibilityData: { label: 'Video ' + i } },
      menu: { menuRenderer: { items: [
        { menuServiceItemRenderer: { text: { simpleText: 'Not interested' } } },
        { menuServiceItemRenderer: { text: { simpleText: "Don't recommend channel" } } }
      ] } }
    } } } });
  }
  contents.push({ richItemRenderer: { content: { adSlotRenderer: { adSlotMetadata: { tracking: 'ad' } } } } });
  var contextKids = [];
  for (i = 0; i < 80; i++) contextKids.push({ serviceTrackingParams: [{ params: [{ key: 'k', value: 'v' }] }] });
  return {
    responseContext: { serviceTrackingParams: contextKids },
    contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { richGridRenderer: { contents: contents } } } }] } }
  };
}

async function main() {
  var scriptText = fs.readFileSync(scriptPath, 'utf8');
  check(scriptText.indexOf('TizenTube') === -1, 'injected script must not name TizenTube');
  check(scriptText.indexOf("var VERSION = '1.0.2'") !== -1, 'script version');

  check(load('youtu.be').YP.version === '1.0.2', 'youtu.be is hooked');
  check(!load('accounts.google.com').YP, 'Google sign-in frame is not hooked');
  check(!load('example.com').YP, 'other sites are not hooked');

  var env = load();
  var YP = env.YP;
  var win = env.win;
  var doc = env.doc;
  check(YP && YP.version === '1.0.2', 'YouTubePlus exported');
  check(YP.isWatchPage('https://m.youtube.com/watch?v=abcdefghijk') === true, 'portrait watch page keeps the bottom bar');
  check(YP.isWatchPage('https://www.youtube.com/watch?v=abcdefghijk&pp=abc&si=xyz') === true, 'watch page with Google params');
  check(YP.isWatchPage('https://m.youtube.com/watch?v=abcdefghijk', { landscape: true }) === false, 'landscape video hides the bar');
  check(YP.isWatchPage('https://m.youtube.com/watch?v=abcdefghijk', { fullscreen: true }) === false, 'fullscreen hides the bar');
  check(YP.isWatchPage('https://m.youtube.com/') === false, 'home uses YouTube\'s own bar');
  check(YP.isWatchPage('https://m.youtube.com/feed/subscriptions') === false, 'subscriptions uses YouTube\'s own bar');
  check(YP.isOpenAppLabel('Open App') === true, 'open app label');
  check(YP.isOpenAppLabel('  Open   App ') === true, 'open app spacing');
  check(YP.isOpenAppLabel('Subscribe') === false, 'subscribe is not the open app pill');
  var pivot = YP.pivotTabs();
  check(pivot.length === 4 && pivot[0].label === 'Home' && pivot[1].label === 'Shorts' && pivot[2].label === 'Subscriptions' && pivot[3].label === 'You', 'bottom tabs');
  check(env.win.__timers.length === 1 && env.win.__timers[0].ms === 1000, 'poll timer');

  reset(YP);

  var stripped = YP.process(JSON.parse(JSON.stringify(player())));
  check(stripped.playerAds === undefined, 'playerAds removed');
  check(stripped.adPlacements === undefined, 'adPlacements removed');
  check(stripped.adSlots === undefined, 'adSlots removed');
  check(stripped.videoDetails.videoId === 'abcdefghijk', 'video kept');
  check(stripped.playabilityStatus.status === 'OK', 'playability kept');
  check(stripped.streamingData.formats[0].itag === 18, 'stream kept');
  var again = YP.process(stripped);
  check(JSON.stringify(again) === JSON.stringify(stripped), 'process is idempotent');

  var live = JSON.parse(JSON.stringify(player()));
  YP.applySettings({ adBlock: false, hideShorts: false, deArrow: false });
  YP.process(live);
  check(live.playerAds && live.playerAds.length === 1, 'ad block off leaves ads');
  YP.applySettings({ adBlock: true });
  YP.process(live);
  check(live.playerAds === undefined, 'ad block applies without a new parse');
  reset(YP);

  var feed = YP.process(JSON.parse(JSON.stringify(homeFeed())));
  var items = feed.contents.singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents;
  check(items.length === 1, 'feed ads removed');
  var menu = JSON.stringify(items[0]);
  check(menu.indexOf('Not interested') !== -1, 'Not interested kept');
  check(menu.indexOf("Don't recommend channel") !== -1, "Don't recommend channel kept");
  check(menu.indexOf('Save to playlist') !== -1, 'existing menu item kept');
  check(menu.indexOf('adSlotRenderer') === -1, 'ad slot gone from the kept item');
  var cont = feed.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems;
  check(cont.length === 1, 'continuation ads removed');
  check(JSON.stringify(cont[0]).indexOf('Not interested') !== -1, 'continuation menu kept');

  var shorts = {
    responseContext: {},
    contents: [
      { videoRenderer: { videoId: 'aaaaaaaaaaa', title: { simpleText: 'Keep' } } },
      { reelShelfRenderer: { title: 'Shorts' } },
      { richSectionRenderer: { content: { reelShelfRenderer: {} } } },
      { reelItemRenderer: { videoId: 'short0000001' } },
      { videoRenderer: { videoId: 'bbbbbbbbbbb', navigationEndpoint: { reelWatchEndpoint: { videoId: 'bbbbbbbbbbb' } } } }
    ]
  };
  YP.applySettings({ hideShorts: true });
  var hidden = YP.process(JSON.parse(JSON.stringify(shorts)));
  check(hidden.contents.length === 1 && hidden.contents[0].videoRenderer.videoId === 'aaaaaaaaaaa', 'shorts removed from the feed');
  YP.applySettings({ hideShorts: false });
  var shown = YP.process(JSON.parse(JSON.stringify(shorts)));
  check(shown.contents.length === 5, 'shorts stay when the toggle is off');
  reset(YP);

  var segs = segments();
  check(YP.sponsorDecision(segs, 12).skipTo === 20, 'skip sponsor');
  check(YP.sponsorDecision(segs, 12).category === 'sponsor', 'sponsor category');
  check(YP.skipLabel('sponsor') === 'Skipped sponsor', 'sponsor toast');
  check(YP.sponsorDecision(segs, 1).category === 'intro', 'skip intro');
  check(YP.skipLabel('intro') === 'Skipped intro', 'intro toast');
  check(YP.sponsorDecision(segs, 105).category === 'outro', 'skip outro');
  check(YP.skipLabel('outro') === 'Skipped outro', 'outro toast');
  check(YP.sponsorDecision(segs, 31).category === 'selfpromo', 'skip selfpromo');
  check(YP.skipLabel('selfpromo') === 'Skipped self-promotion', 'selfpromo toast');
  check(YP.sponsorDecision(segs, 51).category === 'interaction', 'skip interaction');
  check(YP.skipLabel('interaction') === 'Skipped interaction reminder', 'interaction toast');
  check(YP.sponsorDecision(segs, 70) === null, 'poi is not skipped');
  check(YP.sponsorDecision(segs, 201) === null, 'full is not auto-skipped');
  check(YP.sponsorDecision(segs, 81).skipTo === 90, 'missing actionType still skips');
  check(YP.sponsorDecision(segs, 19.9) === null, 'near the end does not loop');
  check(YP.sponsorDecision(segs, 19.7).skipTo === 20, 'still inside the segment skips');
  check(YP.sponsorDecision(segs, 12, { sponsor: false, intro: true, outro: true, selfpromo: true, interaction: true }) === null, 'category toggle');
  YP.applySettings({ categories: { sponsor: false } });
  check(YP.sponsorDecision(segs, 12) === null, 'settings bridge drops sponsor');
  check(YP.sponsorDecision(segs, 1).category === 'intro', 'other categories stay on');
  YP.applySettings({ sponsorBlock: false });
  check(YP.sponsorDecision(segs, 1) === null, 'master toggle');
  YP.applySettings({ sponsorBlock: true, categories: { sponsor: true } });
  check(YP.settings().sponsorBlock === true && YP.settings().categories.sponsor === true, 'settings read back');
  reset(YP);

  var branding = {
    titles: [
      { title: 'Original title', original: true, votes: 100 },
      { title: 'Accurate title', original: false, votes: 4 },
      { title: 'Downvoted', original: false, votes: -2 }
    ],
    thumbnails: [
      { timestamp: 1, original: true, votes: 10 },
      { timestamp: 12.5, original: false, votes: 3 }
    ]
  };
  check(YP.pickDeArrowTitle(branding) === 'Accurate title', 'dearrow title');
  check(YP.pickDeArrowThumb(branding) === 12.5, 'dearrow thumb');
  check(YP.pickDeArrowTitle({ titles: [
    { title: 'More votes', original: false, votes: 99 },
    { title: 'Locked', original: false, votes: 0, locked: true }
  ] }) === 'Locked', 'locked title wins');
  check(YP.pickDeArrowTitle({ titles: [{ title: 'Orig', original: true, votes: 5 }] }) === null, 'original title ignored');
  check(YP.pickDeArrowThumb({ thumbnails: [{ timestamp: 4, original: false, votes: 1, locked: true }] }) === 4, 'locked thumb');

  YP.applySettings({ deArrow: true, adBlock: false, hideShorts: false });
  YP.rememberBranding('abcdefghijk', branding);
  var titled = YP.process({
    responseContext: {},
    contents: { videoRenderer: {
      videoId: 'abcdefghijk',
      title: { runs: [{ text: 'CLICKBAIT!!!' }, { text: ' extra' }] },
      thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' }] },
      menu: { menuRenderer: { items: [
        { menuServiceItemRenderer: { text: { simpleText: 'Not interested' } } },
        { menuServiceItemRenderer: { text: { simpleText: "Don't recommend channel" } } }
      ] } }
    } }
  });
  check(titled.contents.videoRenderer.title.runs[0].text === 'Accurate title', 'title replaced');
  check(titled.contents.videoRenderer.title.runs[1].text === '', 'extra runs cleared');
  check(titled.contents.videoRenderer.thumbnail.thumbnails[0].url.indexOf('dearrow-thumb.ajay.app') !== -1, 'thumb replaced');
  check(JSON.stringify(titled).indexOf('Not interested') !== -1, 'dearrow keeps Not interested');
  check(JSON.stringify(titled).indexOf("Don't recommend channel") !== -1, 'dearrow keeps the channel item');
  reset(YP);

  check(YP.formatCount(999) === '999', 'count');
  check(YP.formatCount(1500) === '1.5K', 'thousands');
  check(YP.formatCount(12000) === '12K', 'ten thousands');
  check(YP.formatCount(2000000) === '2M', 'millions');
  check(YP.formatCount(2500000) === '2.5M', 'fractional millions');

  doc._ytSetRawVisibility(true);
  check(doc.hidden === false, 'visibility shim hides the hidden flag');
  check(doc.visibilityState === 'visible', 'visibilityState stays visible');
  check(doc.webkitHidden === false, 'webkitHidden');
  var vis = env.listeners.filter(function (l) { return l.type === 'visibilitychange'; });
  check(vis.length >= 2, 'capture listeners on window and document');
  var ev = { stopped: false, stopImmediatePropagation: function () { this.stopped = true; } };
  vis[0].fn(ev);
  check(ev.stopped === true, 'visibilitychange stopped while background play is on');
  YP.applySettings({ backgroundPlay: false });
  check(doc.hidden === true, 'real hidden value when background play is off');
  check(doc.visibilityState === 'hidden', 'real visibilityState when background play is off');
  var ev2 = { stopped: false, stopImmediatePropagation: function () { this.stopped = true; } };
  vis[0].fn(ev2);
  check(ev2.stopped === false, 'events propagate when background play is off');
  YP.applySettings({ backgroundPlay: true });
  check(doc.hidden === false, 'shim follows the live setting');

  var video = new win.HTMLMediaElement();
  video.pause();
  check(video.pauses === 1, 'pause works in the foreground');
  var blocked = YP.stats().pauseBlocked;
  YP.setAppActive(false);
  video.pause();
  check(video.pauses === 1, 'pause blocked in the background');
  check(YP.stats().pauseBlocked === blocked + 1, 'pause block counted');
  YP.applySettings({ backgroundPlay: false });
  video.pause();
  check(video.pauses === 2, 'pause allowed when background play is off');
  YP.setAppActive(true);
  reset(YP);

  var clicks = [];
  var adVideo = { duration: 15, currentTime: 1 };
  var adRoot = {
    querySelectorAll: function (sel) {
      if (sel.indexOf('ytp-ad-skip-button') !== -1) return [{ click: function () { clicks.push('skip'); } }];
      if (sel.indexOf('ad-showing') !== -1) return [adVideo];
      return [];
    }
  };
  check(YP.skipPlayerAds(adRoot) === 2, 'dom ad skip');
  check(clicks.length === 1 && adVideo.currentTime === 15, 'skip button and ad video');
  YP.applySettings({ adBlock: false });
  check(YP.skipPlayerAds(adRoot) === 0, 'dom skip respects the toggle');
  reset(YP);
  check(YP.requestPictureInPicture() === false, 'pip without a video does not throw');
  YP.boot();
  check(env.win.__timers.length === 1, 'boot is idempotent');

  function parseIn(text) {
    win.__parseText = text;
    try {
      return { ok: true, value: vm.runInContext('JSON.parse(__parseText)', win) };
    } catch (err) {
      return { ok: false, error: err };
    }
  }
  var parsed = parseIn(JSON.stringify(player()));
  check(parsed.ok && parsed.value.playerAds === undefined && parsed.value.videoDetails.title === 'Hello', 'JSON.parse hook strips ads');
  check(parseIn('5').value === 5, 'numbers still parse');
  check(parseIn('"hi"').value === 'hi', 'strings still parse');
  check(parseIn('{').ok === false, 'invalid JSON still throws');

  win.__fetchBody = JSON.stringify({ hello: 1 });
  var plain = await win.fetch('https://example.com/data.json');
  var plainData = await plain.json();
  check(plainData.hello === 1, 'non-youtube fetch is unchanged');

  win.__fetchBody = JSON.stringify(player());
  var res = await win.fetch('https://m.youtube.com/youtubei/v1/player?prettyPrint=false');
  var data = await res.json();
  check(data.playerAds === undefined, 'fetch hook strips innertube ads');
  check(data.streamingData.formats[0].itag === 18, 'fetch hook keeps the stream');
  check(win.__fetchURLs.some(function (u) { return u.indexOf('/youtubei/v1/player') !== -1; }), 'player url recorded');

  YP.applySettings({ debug: true });
  check(YP.settings().debug === true, 'debug flag');
  YP.process(JSON.parse(JSON.stringify(player())));
  reset(YP);

  var fat = fatBrowse(40);
  var totalNodes = countNodes(fat);
  var beforeNodes = YP.stats().nodesVisited;
  var beforeFetches = win.__fetchURLs.length;
  var cleanedFat = YP.process(fat);
  var visited = YP.stats().nodesVisited - beforeNodes;
  check(visited * 3 < totalNodes, 'browse walk skips thumbnail and tracking metadata');
  check(JSON.stringify(cleanedFat).indexOf('adSlotRenderer') === -1, 'fat feed ads removed');
  check(JSON.stringify(cleanedFat).indexOf('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg') !== -1, 'thumbnail urls preserved');
  check(JSON.stringify(cleanedFat).indexOf('Not interested') !== -1, 'fat feed keeps Not interested');
  check(JSON.stringify(cleanedFat).indexOf("Don't recommend channel") !== -1, 'fat feed keeps the channel item');
  check(win.__fetchURLs.length === beforeFetches, 'DeArrow stays quiet when it is off');

  var rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  var blob = JSON.stringify(rules);
  check(Array.isArray(rules) && rules.length >= 6, 'content rules list');
  check(blob.indexOf('doubleclick') !== -1, 'doubleclick rule');
  check(blob.indexOf('googlesyndication') !== -1, 'googlesyndication rule');
  check(blob.indexOf('googleadservices') !== -1, 'googleadservices rule');
  check(blob.indexOf('pagead') !== -1, 'pagead rule');
  check(blob.indexOf('ptracking') !== -1, 'ptracking rule');
  check(blob.indexOf('api/stats/ads') !== -1, 'stats/ads rule');
  rules.forEach(function (rule) {
    check(rule.action && rule.action.type === 'block', 'rule blocks');
    check(rule.trigger && rule.trigger['url-filter'], 'rule has a filter');
    check(rule.trigger['if-domain'].indexOf('*youtube.com') !== -1, 'rule is limited to YouTube');
    var types = rule.trigger['resource-type'] || [];
    check(types.indexOf('image') === -1, 'image requests skip the content blocker');
  });
  check(blob.indexOf('ytimg') === -1, 'rules do not name thumbnail hosts');

  check(fs.existsSync(bundledScript), 'bundled script is checked in');
  check(fs.readFileSync(bundledScript, 'utf8') === scriptText, 'bundle matches the source script');
  check(fs.readFileSync(bundledRules, 'utf8') === fs.readFileSync(rulesPath, 'utf8'), 'bundle matches the rules');
  var info = JSON.parse(fs.readFileSync(bundleInfo, 'utf8'));
  check(info.iosScriptVersion === '1.0.2', 'bundle info version');
  check(info.name === 'YouTube +', 'bundle info name');

  var swiftDir = path.join(root, 'platforms', 'ios', 'YouTubePlus');
  var settingsSwift = fs.readFileSync(path.join(swiftDir, 'SettingsView.swift'), 'utf8');
  var contentSwift = fs.readFileSync(path.join(swiftDir, 'ContentView.swift'), 'utf8');
  var infoPlist = fs.readFileSync(path.join(swiftDir, 'Info.plist'), 'utf8');
  var xcconfig = fs.readFileSync(path.join(root, 'platforms', 'ios', 'Config', 'YouTubePlus.xcconfig'), 'utf8');
  check(settingsSwift.indexOf('DeArrow replaces clickbait titles and thumbnails with community-submitted, more accurate ones.') !== -1, 'dearrow explanation');
  check(settingsSwift.indexOf('YouTube + Settings') !== -1, 'settings title');
  check(settingsSwift.indexOf('TizenTube') === -1, 'settings do not name TizenTube');
  check(contentSwift.indexOf('Welcome to YouTube +') !== -1, 'welcome toast');
  check(contentSwift.indexOf('TizenTube') === -1, 'main UI does not name TizenTube');
  check(infoPlist.indexOf('UIBackgroundModes') !== -1 && infoPlist.indexOf('audio') !== -1, 'background audio mode');
  check(infoPlist.indexOf('youtubeplus') !== -1, 'custom URL scheme');
  check(infoPlist.indexOf('Edge Software Labs LLC') !== -1, 'copyright');
  check(xcconfig.indexOf('com.edgesoftwarelabs.youtubeplus') !== -1, 'bundle id');
  check(xcconfig.indexOf('YouTube +') !== -1, 'display name');

  console.log('ios script tests passed (' + checks + ' checks)');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
