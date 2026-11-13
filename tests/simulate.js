// Offline simulation of youtube-plus.js against hand-built YouTube TV
// responses (shapes taken from TizenTube's source). Run: node tests/simulate.js
// This only proves the menu-rewriting and click plumbing; it does NOT prove the
// real TV client renders or routes the items the same way.
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var store = {};
var calls = [];
var toasts = [];
var nativeResolved = [];
var win = {
  console: console,
  location: { hash: '#/' },
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); }
  },
  _yttv: {}
};
var host = {
  resolveCommand: function (cmd) {
    if (cmd.openPopupAction) toasts.push(cmd.openPopupAction.popup.overlayToastRenderer.subtitle.simpleText);
    else nativeResolved.push(cmd);
    return true;
  }
};
var client = {
  fetch: function (req) {
    calls.push(req);
    return { subscribe: function (next) {
      if (req.path === '/youtubei/v1/get_panel') {
        next({ content: { engagementPanelSectionListRenderer: { content: { listViewModel: { listItems: [
          { listItemViewModel: { title: { content: 'Save to Watch Later' } } },
          { listItemViewModel: { title: { content: 'Not interested' }, rendererContext: { commandContext: { onTap: { innertubeCommand: { feedbackEndpoint: { feedbackToken: 'TOKEN_NI' } } } } } } },
          { listItemViewModel: { title: { content: "Don't recommend channel" }, rendererContext: { commandContext: { onTap: { innertubeCommand: { openPopupAction: { popup: { commandExecutorCommand: { commands: [{ feedbackEndpoint: { feedbackToken: 'TOKEN_DRC' } }] } } } } } } } } }
        ] } } } } });
      } else {
        next({ feedbackResponses: [{ isProcessed: true }] });
      }
    } };
  }
};
win._yttv.a = { instance: host };
win._yttv.b = { mappings: { get: function (n) { return n === 'KabukiInnerTubeClient' ? client : null; } } };

var ctx = vm.createContext({ window: win, JSON: JSON, setInterval: function (fn) { fn(); return 0; }, clearInterval: function () {}, setTimeout: setTimeout, clearTimeout: clearTimeout, console: console });
win.JSON = ctx.JSON = JSON;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'youtube-plus.js'), 'utf8'), ctx);
var YP = win.YouTubePlus;

// Simulate TizenTube wrapping JSON.parse AFTER us (it loads async).
var ttWrapped = JSON.parse;
JSON.parse = function () { return ttWrapped.apply(this, arguments); };
var panelEp = { showEngagementPanelEndpoint: { identifier: { tag: 'PAcontext_menu' }, globalConfiguration: { params: 'PARAMS123' } } };

function tile(id, longPress) {
  var t = { tileRenderer: { style: 'TILE_STYLE_YTLR_DEFAULT', contentId: id,
    onSelectCommand: { watchEndpoint: { videoId: id } },
    header: { tileHeaderRenderer: { thumbnail: { thumbnails: [{ url: 'x' }] } } },
    metadata: { tileMetadataRenderer: { title: { simpleText: 'Video ' + id }, lines: [{ lineRenderer: { items: [{ lineItemRenderer: { text: { runs: [{ text: 'Chan ' + id, navigationEndpoint: { browseEndpoint: { browseId: 'UC' + id } } }] } } }] } }] } } } };
  if (longPress) t.tileRenderer.onLongPressCommand = longPress;
  return t;
}
function ttMenu(original, withOldFeedback) {
  var copy = JSON.parse(JSON.stringify(original));
  var items = [
    { menuNavigationItemRenderer: { text: { runs: [{ text: 'Play' }] }, navigationEndpoint: { watchEndpoint: { videoId: 'x' } } } },
    { menuServiceItemRenderer: { text: { runs: [{ text: 'Save to Watch Later' }] }, serviceEndpoint: { playlistEditEndpoint: { playlistId: 'WL', actions: [] } } } },
    { menuNavigationItemRenderer: { text: { runs: [{ text: 'Save to playlist' }] }, navigationEndpoint: { addToPlaylistEndpoint: { videoId: 'x' } } } },
    { menuServiceItemRenderer: { text: { runs: [{ text: 'Add to queue' }] }, serviceEndpoint: { playlistEditEndpoint: { customAction: { action: 'ADD_TO_QUEUE', parameters: copy } } } } },
    { menuServiceItemRenderer: { text: { runs: [{ text: 'Go to channel' }] }, serviceEndpoint: { playlistEditEndpoint: { customAction: { action: 'GO_TO_CHANNEL', parameters: copy } } } } }
  ];
  if (withOldFeedback) {
    items.push({ menuServiceItemRenderer: { text: { runs: [{ text: 'Not interested' }] }, serviceEndpoint: { customAction: { action: 'NOT_INTERESTED', parameters: { panelId: 'PAcontext_menu', params: 'PARAMS123' } } } } });
    items.push({ menuServiceItemRenderer: { text: { runs: [{ text: "Don't recommend channel" }] }, serviceEndpoint: { customAction: { action: 'DONT_RECOMMEND_CHANNEL', parameters: { panelId: 'PAcontext_menu', params: 'PARAMS123' } } } } });
  }
  return { showMenuCommand: { menu: { menuRenderer: { items: items } } } };
}

var A = tile('A', panelEp);                                   // raw tile, no TizenTube
var B0 = tile('B', panelEp); var B = tile('B', ttMenu(B0, true));  // TizenTube 1.15.2 processed
var C0 = tile('C'); var C = tile('C', ttMenu(C0, false));     // TizenTube menu, no panel anywhere
var D = tile('D');                                            // no menu at all
var resp = { contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: { sectionListRenderer: { contents: [
  { shelfRenderer: { content: { horizontalListRenderer: { items: [A, B, C, D] } } } }
] } } } } } } };

// Next timer tick: youtube-plus re-wraps so it stays outermost (runs after TizenTube).
YP.rehook();
assert.ok(JSON.parse.__ytPlus, 'youtube-plus wrapper must be outermost');
var out = JSON.parse(JSON.stringify(resp));
var items = out.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items;

function labels(t) {
  return Array.from(t.tileRenderer.onLongPressCommand.showMenuCommand.menu.menuRenderer.items, function (m) {
    var r = m.menuServiceItemRenderer || m.menuNavigationItemRenderer; return r.text.runs[0].text;
  });
}
items.forEach(function (t) { console.log(t.tileRenderer.contentId, JSON.stringify(labels(t))); });
assert.deepStrictEqual(labels(items[1]), ['Play', 'Save to Watch Later', 'Save to playlist', 'Add to queue', 'Go to channel', 'Not interested', "Don't recommend channel"]);
assert.deepStrictEqual(labels(items[2]).slice(-2), ['Not interested', "Don't recommend channel"]);
assert.deepStrictEqual(labels(items[3]).slice(-2), ['Not interested', "Don't recommend channel"]);
// Idempotent
YP.process(out);
assert.strictEqual(labels(items[1]).length, 7);

function click(t, label) {
  var mi = t.tileRenderer.onLongPressCommand.showMenuCommand.menu.menuRenderer.items.filter(function (m) {
    return m.menuServiceItemRenderer && m.menuServiceItemRenderer.text.runs[0].text === label; })[0];
  host.resolveCommand(mi.menuServiceItemRenderer.serviceEndpoint);
}
click(items[1], 'Not interested');
click(items[1], "Don't recommend channel");
setTimeout(function () {
  var fb = calls.filter(function (c) { return c.path === '/youtubei/v1/feedback'; }).map(function (c) { return c.payload.feedbackTokens[0]; });
  console.log('feedback sent:', fb, 'toasts:', toasts);
  assert.deepStrictEqual(Array.from(fb), ['TOKEN_NI', 'TOKEN_DRC']);
  assert.strictEqual(nativeResolved.length, 0, 'our action must not reach the native handler');

  click(items[2], "Don't recommend channel");   // no panel -> local block
  console.log('local store:', store);
  assert.ok(/UCC/.test(store['ytplus.hiddenChannels']));
  // Next response filters the locally hidden channel and video.
  var again = YP.process(JSON.parse(JSON.stringify(resp)));
  var ids = Array.from(again.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items, function (t) { return t.tileRenderer.contentId; });
  console.log('after refresh:', ids);
  assert.deepStrictEqual(ids, ['A', 'D']);
  console.log('ALL OK', JSON.stringify(YP.stats()));
}, 50);
