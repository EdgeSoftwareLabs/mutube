// URL scheme and Safari redirect rules for YouTube +.
// Run: node tests/ios-open-url.js
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var openURL = require(path.join(root, 'platforms', 'ios', 'js', 'open-url.js'));
var checks = 0;

function check(cond, msg) {
  assert.ok(cond, msg);
  checks++;
}

function samePage(actual, expected) {
  var a = new URL(actual);
  var b = new URL(expected);
  assert.strictEqual(a.origin, b.origin, actual);
  assert.strictEqual(a.pathname, b.pathname, actual);
  assert.strictEqual(a.searchParams.get('v'), b.searchParams.get('v'), actual);
  assert.strictEqual(a.searchParams.get('t'), b.searchParams.get('t'), actual);
  assert.strictEqual(a.searchParams.get('list'), b.searchParams.get('list'), actual);
  checks++;
}

var watch = 'https://m.youtube.com/watch?v=abcdefghijk';

samePage(
  openURL.parseYouTubePlusURL('youtubeplus://open?url=' + encodeURIComponent('https://www.youtube.com/watch?v=abcdefghijk')),
  watch
);
samePage(
  openURL.parseYouTubePlusURL('youtubeplus://open?url=' + encodeURIComponent('https://youtu.be/abcdefghijk')),
  watch
);
samePage(
  openURL.parseYouTubePlusURL('youtubeplus://open?url=' + encodeURIComponent('https://youtu.be/abcdefghijk?t=30')),
  'https://m.youtube.com/watch?v=abcdefghijk&t=30'
);
samePage(
  openURL.parseYouTubePlusURL('youtubeplus://open?url=' + encodeURIComponent('https://m.youtube.com/shorts/abcdefghijk')),
  'https://m.youtube.com/shorts/abcdefghijk'
);
samePage(openURL.parseYouTubePlusURL('youtubeplus://watch?v=abcdefghijk'), watch);
samePage(openURL.parseYouTubePlusURL('youtubeplus://watch?v=abcdefghijk&t=12'), 'https://m.youtube.com/watch?v=abcdefghijk&t=12');
samePage(openURL.parseYouTubePlusURL('youtubeplus://youtu.be/abcdefghijk'), watch);
samePage(
  openURL.parseYouTubePlusURL('youtubeplus://www.youtube.com/playlist?list=PLabcdefghij'),
  'https://m.youtube.com/playlist?list=PLabcdefghij'
);
check(openURL.parseYouTubePlusURL('youtubeplus://open?url=' + encodeURIComponent('https://accounts.google.com/o/oauth2/v2/auth')) === null, 'oauth is not opened');
check(openURL.parseYouTubePlusURL('youtubeplus://open?url=' + encodeURIComponent('https://www.youtube.com/signin?next=%2F')) === null, 'youtube sign-in is not opened');
check(openURL.parseYouTubePlusURL('youtubeplus://open?url=' + encodeURIComponent('https://example.com/watch?v=abcdefghijk')) === null, 'other sites are not opened');
check(openURL.parseYouTubePlusURL('https://www.youtube.com/watch?v=abcdefghijk') === null, 'https is not a custom scheme');

check(openURL.shouldRedirectSafariPage('https://m.youtube.com/'), 'm.youtube.com');
check(openURL.shouldRedirectSafariPage('https://www.youtube.com/watch?v=abcdefghijk'), 'www.youtube.com');
check(openURL.shouldRedirectSafariPage('https://youtu.be/abcdefghijk'), 'youtu.be');
check(openURL.shouldRedirectSafariPage('https://youtube.com/feed/subscriptions'), 'apex youtube.com');
check(!openURL.shouldRedirectSafariPage('https://accounts.google.com/ServiceLogin'), 'accounts.google.com');
check(!openURL.shouldRedirectSafariPage('https://accounts.youtube.com/'), 'accounts.youtube.com');
check(!openURL.shouldRedirectSafariPage('https://www.youtube.com/signin?next=%2F'), 'signin path');
check(!openURL.shouldRedirectSafariPage('https://music.youtube.com/watch?v=abcdefghijk'), 'music stays put');
check(!openURL.shouldRedirectSafariPage('https://example.com/'), 'example.com');

var page = 'https://www.youtube.com/watch?v=abcdefghijk';
check(openURL.planSafariRedirect(page, { enabled: false, now: 10000, lastAttempt: 0 }) === null, 'popup switch off');
check(openURL.planSafariRedirect(page, { enabled: true, now: 2000, lastAttempt: 1000 }) === null, 'recent attempt does not loop');
var target = openURL.planSafariRedirect(page, { enabled: true, now: 10000, lastAttempt: 0 });
check(target === 'youtubeplus://open?url=' + encodeURIComponent(page), 'redirect target');
samePage(openURL.parseYouTubePlusURL(target), watch);
check(openURL.planSafariRedirect('https://accounts.google.com/o/oauth2/auth', { enabled: true, now: 10000 }) === null, 'oauth is not redirected');

var manifest = JSON.parse(fs.readFileSync(path.join(root, 'platforms', 'ios', 'YouTubePlusSafariExtension', 'Resources', 'manifest.json'), 'utf8'));
check(manifest.name === 'Open in YouTube +', 'extension name');
var script = manifest.content_scripts[0];
check(script.all_frames === false, 'main frame only');
check(script.js.indexOf('open-url.js') !== -1 && script.js.indexOf('content.js') !== -1, 'scripts');
check(script.matches.join(' ').indexOf('youtube.com') !== -1, 'matches youtube.com');
check(script.matches.join(' ').indexOf('youtu.be') !== -1, 'matches youtu.be');
check(script.exclude_matches.join(' ').indexOf('accounts.google.com') !== -1, 'excludes accounts.google.com');
var content = fs.readFileSync(path.join(root, 'platforms', 'ios', 'YouTubePlusSafariExtension', 'Resources', 'content.js'), 'utf8');
check(content.indexOf('planSafariRedirect') !== -1, 'content script uses the shared planner');
check(content.indexOf('TizenTube') === -1, 'extension does not name TizenTube');
var popup = fs.readFileSync(path.join(root, 'platforms', 'ios', 'YouTubePlusSafariExtension', 'Resources', 'popup.html'), 'utf8');
check(popup.indexOf('Open YouTube links in YouTube +') !== -1, 'popup toggle');
check(popup.indexOf('Settings') !== -1 && popup.indexOf('Safari') !== -1, 'popup points at Safari settings');

console.log('ios open-url tests passed (' + checks + ' checks)');
