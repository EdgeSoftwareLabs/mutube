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

function headerNode() {
  var el = {
    id: '',
    children: [],
    style: {},
    attrs: {},
    parentNode: null,
    firstChild: null,
    nodeType: 1,
    setAttribute: function (k, v) {
      this.attrs[k] = v;
      if (k === 'id') this.id = v;
    },
    getAttribute: function (k) { return this.attrs[k] || null; },
    appendChild: function (child) {
      child.parentNode = this;
      this.children.push(child);
      this.firstChild = this.children[0];
    },
    insertBefore: function (child, before) {
      child.parentNode = this;
      var at = this.children.indexOf(before);
      if (at < 0) this.children.unshift(child);
      else this.children.splice(at, 0, child);
      this.firstChild = this.children[0];
    },
    querySelector: function (sel) {
      var i, found;
      if (sel === '#ytplus-header-actions' || sel === '[data-ytplus-action="pip"]') {
        for (i = 0; i < this.children.length; i++) {
          found = this.children[i].querySelector ? this.children[i].querySelector(sel) : null;
          if (this.children[i].id === 'ytplus-header-actions' && sel === '#ytplus-header-actions') return this.children[i];
          if (found) return found;
        }
      }
      if (sel === '[data-ytplus-action="pip"]' && this.attrs['data-ytplus-action'] === 'pip') return this;
      if (sel === '#ytplus-header-actions' && this.id === 'ytplus-header-actions') return this;
      return null;
    },
    addEventListener: function () {},
    removeAttribute: function (k) {
      delete this.attrs[k];
      if (k === 'id') this.id = '';
      if (k === 'class') this.className = '';
    },
    cloneNode: function (deep) {
      var copy = headerNode();
      copy.textContent = this.textContent;
      copy.className = this.className;
      var k;
      for (k in this.attrs) {
        if (Object.prototype.hasOwnProperty.call(this.attrs, k)) copy.setAttribute(k, this.attrs[k]);
      }
      if (deep) {
        var i;
        for (i = 0; i < this.children.length; i++) {
          copy.appendChild(this.children[i].cloneNode ? this.children[i].cloneNode(true) : this.children[i]);
        }
      }
      return copy;
    }
  };
  return el;
}

function labeledRow(text) {
  var el = headerNode();
  el.className = 'compact-link';
  el.setAttribute('class', 'compact-link');
  var label = headerNode();
  label.className = 'compact-link-text';
  label.setAttribute('class', 'compact-link-text');
  label.textContent = text;
  var chevron = headerNode();
  chevron.className = 'chevron-right';
  chevron.setAttribute('class', 'chevron-right');
  el.appendChild(label);
  el.appendChild(chevron);
  return el;
}

function entryText(row) {
  var parts = [];
  var i;
  if (row.children) {
    for (i = 0; i < row.children.length; i++) {
      if (row.children[i].textContent) parts.push(row.children[i].textContent);
    }
  }
  if (parts.length) return parts.join(' ');
  return row.textContent || '';
}

function settingsMenus() {
  var page = headerNode();
  ['General', 'History & privacy', 'Privacy'].forEach(function (name) { page.appendChild(labeledRow(name)); });
  var footer = headerNode();
  footer.className = 'footer';
  footer.textContent = 'YouTube, a Google company';
  page.appendChild(footer);
  var account = headerNode();
  ['Settings', 'Help', 'Sign out'].forEach(function (name) { account.appendChild(labeledRow(name)); });
  var root = headerNode();
  root.appendChild(page);
  root.appendChild(account);
  return {
    doc: { body: root, createElement: function () { return headerNode(); } },
    page: page,
    account: account
  };
}

function searchFixture() {
  function removal(query, token) {
    var button = headerNode();
    button.setAttribute('aria-label', 'Remove');
    button.textContent = 'Remove';
    var row = headerNode();
    row.textContent = query + ' Remove';
    row.setAttribute('data-ytplus-token', token);
    row.appendChild(button);
    button.parentNode = row;
    return row;
  }
  var row = removal('cats', 'ROWTOK');
  var other = removal('dogs', 'ROWTOK2');
  var list = headerNode();
  list.appendChild(row);
  list.appendChild(other);
  row.parentNode = list;
  other.parentNode = list;
  return {
    doc: {
      body: list,
      createElement: function () { return headerNode(); },
      querySelectorAll: function () { return [list]; }
    },
    list: list,
    row: row,
    remove: row.children[0]
  };
}

function headerFixture() {
  var search = headerNode();
  search.setAttribute('aria-label', 'Search');
  var host = headerNode();
  host.id = 'buttons';
  host.appendChild(search);
  var doc = {
    createElement: function () { return headerNode(); },
    querySelector: function (sel) {
      if (sel === 'ytm-mobile-topbar-renderer .header-buttons') return host;
      return null;
    }
  };
  return { doc: doc, host: host, search: search };
}

async function main() {
  var scriptText = fs.readFileSync(scriptPath, 'utf8');
  check(scriptText.indexOf('TizenTube') === -1, 'injected script must not name TizenTube');
  check(scriptText.indexOf("var VERSION = '1.1.2'") !== -1, 'script version');
  check(scriptText.indexOf('ytplus-header-actions') === -1, 'no header button row');
  check(scriptText.indexOf('Picture in Picture') === -1, 'no picture in picture button');
  check(scriptText.indexOf('Remove All') === -1, 'no Remove All button');
  check(scriptText.indexOf('ytplus-clear-history') === -1, 'no clear-history control');

  check(load('youtu.be').YP.version === '1.1.2', 'youtu.be is hooked');
  check(!load('accounts.google.com').YP, 'Google sign-in frame is not hooked');
  check(!load('example.com').YP, 'other sites are not hooked');

  var env = load();
  var YP = env.YP;
  var win = env.win;
  var doc = env.doc;
  check(YP && YP.version === '1.1.2', 'YouTubePlus exported');
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
  var menus = settingsMenus();
  win.__messages = [];
  win.webkit = { messageHandlers: { ytplus: { postMessage: function (m) { win.__messages.push(m); } } } };
  check(YP.mountSettingsEntry(menus.doc) === true, 'settings entry mounts');
  var pageLabels = menus.page.children.map(entryText);
  check(pageLabels[pageLabels.length - 1].indexOf('Google company') !== -1, 'footer stays last');
  check(pageLabels[pageLabels.length - 2] === 'YouTube +', 'entry sits with the category rows, above the footer');
  var entry = menus.page.children[pageLabels.length - 2];
  check(entry.getAttribute('class') === 'compact-link', 'entry clones the category row class');
  check(entry.children.some(function (child) { return child.className === 'chevron-right'; }), 'entry keeps the chevron');
  check(menus.account.children.every(function (row) { return entryText(row) !== 'YouTube +'; }), 'account menu is left alone when the settings page is open');
  entry.onclick();
  check(win.__messages.some(function (m) { return m.type === 'settings'; }), 'settings entry opens the native sheet');
  YP.mountSettingsEntry(menus.doc);
  check(menus.page.children.filter(function (row) { return row.getAttribute('data-ytplus-settings') === '1'; }).length === 1, 'settings entry is not duplicated');
  menus.page.children = menus.page.children.filter(function (row) { return row.getAttribute('data-ytplus-settings') !== '1'; });
  menus.page.children[0].textContent = 'General\nApp language';
  check(YP.mountSettingsEntry(menus.doc) === true, 'settings entry comes back after a redraw');
  pageLabels = menus.page.children.map(entryText);
  check(pageLabels[pageLabels.length - 2] === 'YouTube +', 'redraw puts the entry back above the footer');
  var accountOnly = settingsMenus();
  accountOnly.page.children = [];
  check(YP.mountSettingsEntry(accountOnly.doc) === true, 'account menu is the fallback');
  check(entryText(accountOnly.account.children[accountOnly.account.children.length - 1]) === 'YouTube +', 'fallback entry label');
  check(accountOnly.account.children[accountOnly.account.children.length - 1].children.some(function (child) { return child.className === 'chevron-right'; }), 'fallback entry has a chevron');
  reset(YP);
  var contentView = fs.readFileSync(path.join(root, 'platforms', 'ios', 'YouTubePlus', 'ContentView.swift'), 'utf8');
  var webViewSwift = fs.readFileSync(path.join(root, 'platforms', 'ios', 'YouTubePlus', 'YouTubeWebView.swift'), 'utf8');
  check(contentView.indexOf('padding(.top, 8)') === -1, 'settings is not overlaid on the top-right header');
  check(contentView.indexOf('headerActionsMounted') === -1, 'no header fallback row');
  check(contentView.indexOf('fallbackControls') === -1, 'fallback controls are gone');
  check(webViewSwift.indexOf('numberOfTouchesRequired = 2') !== -1, 'two-finger long-press remains');
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
  var ev = { stopped: false, type: 'visibilitychange', stopImmediatePropagation: function () { this.stopped = true; } };
  vis[0].fn(ev);
  check(ev.stopped === false, 'visibilitychange is left alone in the foreground');
  YP.setAppActive(false);
  var evBg = { stopped: false, type: 'visibilitychange', stopImmediatePropagation: function () { this.stopped = true; } };
  vis[0].fn(evBg);
  check(evBg.stopped === true, 'visibilitychange stopped while the app is backgrounded');
  YP.setAppActive(true);
  YP.applySettings({ backgroundPlay: false });
  check(doc.hidden === true, 'real hidden value when background play is off');
  check(doc.visibilityState === 'hidden', 'real visibilityState when background play is off');
  var ev2 = { stopped: false, stopImmediatePropagation: function () { this.stopped = true; } };
  vis[0].fn(ev2);
  check(ev2.stopped === false, 'events propagate when background play is off');
  YP.applySettings({ backgroundPlay: true });
  check(doc.hidden === false, 'shim follows the live setting');
  var blur = env.listeners.filter(function (l) { return l.type === 'blur' && l.target === 'window'; });
  check(blur.length === 1, 'window blur is watched');
  var fieldBlur = { type: 'blur', target: { nodeType: 1 }, stopped: false, stopImmediatePropagation: function () { this.stopped = true; } };
  blur[0].fn(fieldBlur);
  check(fieldBlur.stopped === false, 'a text field blur is not treated as backgrounding');
  YP.setAppActive(true);

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
  YP.applySettings({ backgroundPlay: true });
  var playing = new win.HTMLMediaElement();
  playing.play();
  playing.paused = true;
  var playsBeforeBackground = playing.plays;
  doc.querySelectorAll = function (sel) { return sel === 'video' ? [playing] : []; };
  YP.setAppActive(false);
  check(playing.plays === playsBeforeBackground + 1, 'background resumes a video the user had not paused');
  check(playing.pauses === undefined || playing.pauses === 0, 'the resume path does not pause');
  playing.pause();
  check(playing.pauses == null, 'pause during backgrounding is ignored');
  YP.setAppActive(true);
  var userPaused = new win.HTMLMediaElement();
  userPaused.play();
  userPaused.pause();
  userPaused.paused = true;
  var pausedPlays = userPaused.plays;
  doc.querySelectorAll = function (sel) { return sel === 'video' ? [userPaused] : []; };
  YP.setAppActive(false);
  check(userPaused.plays === pausedPlays, 'a video the user paused stays paused in the background');
  YP.setAppActive(true);
  var foreground = new win.HTMLMediaElement();
  foreground.paused = false;
  foreground.currentTime = 8;
  foreground.duration = 200;
  var foregroundPlays = foreground.plays || 0;
  doc.querySelectorAll = function (sel) { return sel === 'video' ? [foreground] : []; };
  vis[0].fn({ stopped: false, type: 'visibilitychange', stopImmediatePropagation: function () { this.stopped = true; } });
  YP.publishNowPlaying(foreground, true);
  check((foreground.plays || 0) === foregroundPlays, 'foreground now-playing does not call play');
  check(foreground.currentTime === 8, 'foreground now-playing does not seek');
  foreground.pause();
  check(foreground.pauses === 1, 'foreground pause still reaches the video');
  YP.setAppActive(true);
  doc.querySelectorAll = function () { return []; };
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

  var history = {
    contents: [{ searchSuggestionsSectionRenderer: { contents: [
      { searchSuggestionRenderer: {
        suggestion: { runs: [{ text: 'old search' }] },
        icon: { iconType: 'HISTORY' },
        serviceEndpoint: { feedbackEndpoint: { feedbackToken: 'TOK1' } }
      } },
      { searchSuggestionRenderer: {
        suggestion: { runs: [{ text: 'Keep Me' }] },
        icon: { iconType: 'HISTORY' },
        serviceEndpoint: { feedbackEndpoint: { feedbackToken: 'TOK2' } }
      } }
    ] } }]
  };
  var shown = YP.process(JSON.parse(JSON.stringify(history)));
  check(JSON.stringify(shown).indexOf('old search') !== -1, 'search history is visible at first');
  check(YP.rememberSearchRemoval('Old Search') === true, 'removal is stored');
  var hidden = YP.process(JSON.parse(JSON.stringify(history)));
  check(JSON.stringify(hidden).indexOf('old search') === -1, 'removed search stays out of the next response');
  check(JSON.stringify(hidden).indexOf('Keep Me') !== -1, 'a search that was not removed stays');
  var again = YP.process(JSON.parse(JSON.stringify(history)));
  check(JSON.stringify(again).indexOf('old search') === -1, 'removal is still in effect after leaving search');
  var search = searchFixture();
  var fetchesBefore = win.__fetchURLs.length;
  check(YP.handleSearchClick(search.remove) === true, 'tapping Remove records the row');
  check(search.row.style.display === 'none', 'the removed row is hidden');
  check(YP.blockedSearches().indexOf('cats') !== -1, 'the row is on the blocklist');
  check(win.__fetchURLs.slice(fetchesBefore).some(function (u) { return u.indexOf('/youtubei/v1/feedback') !== -1; }), 'Remove also calls the feedback endpoint');
  check(typeof YP.mountClearSearch !== 'function' && typeof YP.requestClearSearchHistory !== 'function', 'clear-all controls are not exported');
  YP.paintSearch(search.doc);
  check(search.list.style.backgroundColor === '#0f0f0f', 'suggestion list background');
  check(search.list.style.color === '#f1f1f1', 'suggestion list text');
  check(search.row.style.color === '#f1f1f1', 'suggestion row text');

  doc.querySelector = function (sel) {
    if (sel.indexOf('og:title') !== -1) return { getAttribute: function (k) { return k === 'content' ? 'Middle Ages' : null; } };
    if (sel.indexOf('owner') !== -1 || sel.indexOf('channel') !== -1) return { textContent: 'Sleepless Historian' };
    if (sel.indexOf('og:image') !== -1) return { getAttribute: function () { return 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg'; } };
    return null;
  };
  var media = new win.HTMLMediaElement();
  media.duration = 200;
  media.currentTime = 40;
  media.paused = false;
  media.playbackRate = 1;
  media.currentSrc = 'https://example.com/a.mp4';
  doc.querySelectorAll = function (sel) { return sel === 'video' ? [media] : []; };
  var info = YP.publishNowPlaying(media, true);
  check(info.title === 'Middle Ages', 'now playing title');
  check(info.author === 'Sleepless Historian', 'now playing channel');
  check(info.artwork.indexOf('i.ytimg.com') !== -1, 'now playing artwork');
  check(info.duration === 200 && info.elapsed === 40 && info.rate === 1, 'now playing times');
  check(YP.publishNowPlaying(media, false) === null, 'timeupdate is throttled');
  media.currentSrc = 'https://example.com/b.mp4';
  var changed = YP.publishNowPlaying(media, false);
  check(changed && changed.duration === 200, 'a new video updates now playing immediately');
  check(YP.remoteCommand('skip', 10) === true, 'skip forward');
  check(media.currentTime === 50, 'skip forward is 10 seconds');
  check(YP.remoteCommand('skip', 10) === false, 'a duplicate remote command is ignored');
  check(media.currentTime === 50, 'duplicate skip does not move twice');
  check(YP.remoteCommand('skip', -10) === true, 'skip back');
  check(media.currentTime === 40, 'skip back is 10 seconds');
  check(YP.remoteCommand('seek', 12) === true, 'scrub');
  check(media.currentTime === 12, 'scrub position');
  check(YP.remoteCommand('pause') === true, 'lock screen pause');
  check(media.__ytplusUserPaused === true, 'lock screen pause counts as the user');
  var plays = media.plays || 0;
  YP.setAppActive(false);
  check((media.plays || 0) === plays, 'backgrounding does not resume after a lock screen pause');
  check(YP.remoteCommand('play') === true, 'lock screen play');
  check(media.__ytplusUserPaused === false, 'lock screen play clears the pause');
  YP.setAppActive(true);
  doc.querySelector = function () { return null; };
  doc.querySelectorAll = function () { return []; };

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
  check(info.iosScriptVersion === '1.1.2', 'bundle info version');
  check(info.name === 'YouTube +', 'bundle info name');

  var swiftDir = path.join(root, 'platforms', 'ios', 'YouTubePlus');
  var settingsSwift = fs.readFileSync(path.join(swiftDir, 'SettingsView.swift'), 'utf8');
  var contentSwift = fs.readFileSync(path.join(swiftDir, 'ContentView.swift'), 'utf8');
  var infoPlist = fs.readFileSync(path.join(swiftDir, 'Info.plist'), 'utf8');
  var xcconfig = fs.readFileSync(path.join(root, 'platforms', 'ios', 'Config', 'YouTubePlus.xcconfig'), 'utf8');
  check(settingsSwift.indexOf('DeArrow replaces clickbait titles and thumbnails with community-submitted, more accurate ones.') !== -1, 'dearrow explanation');
  check(settingsSwift.indexOf('YouTube + Settings') !== -1, 'settings title');
  check(settingsSwift.indexOf('YouTubeToggleStyle') !== -1, 'custom switch style');
  check(settingsSwift.indexOf('.tint(.white)') === -1, 'switches are not tinted white');
  check(settingsSwift.indexOf('#717171') !== -1, 'off track');
  check(settingsSwift.indexOf('#aaaaaa') !== -1, 'on track');
  check(settingsSwift.indexOf('#909090') !== -1, 'off knob');
  check(settingsSwift.indexOf('#ffffff') !== -1, 'on knob');
  check(settingsSwift.indexOf('offset(x: isOn ? 11 : -11)') !== -1, 'knob sits on the track end cap');
  check(settingsSwift.indexOf('.toggleStyle(YouTubeToggleStyle())') !== -1, 'style applies to every toggle');
  check(settingsSwift.indexOf('#available(iOS 17, *)') !== -1, 'isToggle is gated to iOS 17');
  check(settingsSwift.indexOf('accessibilityValue(isOn ? "On" : "Off")') !== -1, 'switch value is announced on iOS 16');
  check(settingsSwift.indexOf('TizenTube') === -1, 'settings do not name TizenTube');
  check(contentSwift.indexOf('Welcome to YouTube +') !== -1, 'welcome toast');
  check(contentSwift.indexOf('TizenTube') === -1, 'main UI does not name TizenTube');
  check(infoPlist.indexOf('UIBackgroundModes') !== -1 && infoPlist.indexOf('audio') !== -1, 'background audio mode');
  var playbackSwift = fs.readFileSync(path.join(swiftDir, 'PlaybackSession.swift'), 'utf8');
  check(playbackSwift.indexOf('setCategory(.playback') !== -1, 'playback category');
  check(playbackSwift.indexOf('setActive(true)') !== -1, 'audio session activates');
  check(playbackSwift.indexOf('didActivate') !== -1, 'audio session is not activated on every tick');
  var updateFn = playbackSwift.split('static func update')[1].split('private static func number')[0];
  check(updateFn.indexOf('configure()') === -1 && updateFn.indexOf('setActive') === -1, 'now playing updates do not reactivate audio');
  check(playbackSwift.indexOf('skipBackwardCommand') !== -1 && playbackSwift.indexOf('preferredIntervals = [10]') !== -1, 'skip back 10');
  check(playbackSwift.indexOf('skipForwardCommand') !== -1, 'skip forward');
  check(playbackSwift.indexOf('nextTrackCommand.isEnabled = false') !== -1, 'next track hidden');
  check(playbackSwift.indexOf('previousTrackCommand.isEnabled = false') !== -1, 'previous track hidden');
  check(playbackSwift.indexOf('changePlaybackPositionCommand') !== -1, 'scrub command');
  check(playbackSwift.indexOf('MPNowPlayingInfoCenter') !== -1, 'now playing info');
  check(playbackSwift.indexOf('setAllMediaPlaybackSuspended(false') !== -1, 'background does not suspend media');
  check(webViewSwift.indexOf('allowsInlineMediaPlayback = true') !== -1, 'inline playback');
  check(webViewSwift.indexOf('mediaTypesRequiringUserActionForPlayback = []') !== -1, 'playback without a fresh tap');
  check(contentSwift.indexOf('keepAlive()') !== -1, 'background keeps the audio session');
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
