// Safari extension resources must land at the paths manifest.json names.
// Xcode copies loose PBXFileReference items to the .appex root and only keeps
// a subdirectory when the reference is a folder (lastKnownFileType = folder).
//
//   node tests/ios-extension-bundle.js
//   node tests/ios-extension-bundle.js --appex /path/to/YouTubePlusSafariExtension.appex
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var ios = path.join(root, 'platforms', 'ios');
var pbxPath = path.join(ios, 'YouTubePlus.xcodeproj', 'project.pbxproj');
var manifestPath = path.join(ios, 'YouTubePlusSafariExtension', 'Resources', 'manifest.json');
var extensionPhase = 'B20000000000000000000003';

var checks = 0;
function check(cond, msg) {
  assert.ok(cond, msg || 'check');
  checks++;
}

function objectStart(pbx, id) {
  var re = new RegExp('\\n\\t\\t' + id + '(?: /\\* [^*]*\\*/)? = \\{');
  var match = re.exec(pbx);
  if (!match) throw new Error('missing pbx object ' + id);
  return match.index + match[0].length - 1;
}

function objectBody(pbx, id) {
  var brace = objectStart(pbx, id);
  var lineEnd = pbx.indexOf('\n', brace);
  var sameLine = pbx.slice(brace, lineEnd);
  if (sameLine.indexOf('};') !== -1) return sameLine.slice(1, sameLine.lastIndexOf('}'));
  var end = pbx.indexOf('\n\t\t};', brace);
  if (end < 0) throw new Error('unterminated pbx object ' + id);
  return pbx.slice(brace + 1, end);
}

function field(body, name) {
  var quoted = body.match(new RegExp(name + ' = "([^"]*)"'));
  if (quoted) return quoted[1];
  var plain = body.match(new RegExp(name + ' = ([^;\\n]+);'));
  if (!plain) return null;
  var value = plain[1].trim();
  var comment = value.indexOf(' /*');
  if (comment !== -1) value = value.slice(0, comment).trim();
  return value;
}

function idsIn(body, key) {
  var m = body.match(new RegExp(key + ' = \\(([\\s\\S]*?)\\);'));
  if (!m) return [];
  var found = [];
  var re = /([A-F0-9]{24})/g;
  var hit;
  while ((hit = re.exec(m[1]))) found.push(hit[1]);
  return found;
}

function basename(p) {
  var parts = String(p).split('/');
  return parts[parts.length - 1];
}

function parentMap(pbx) {
  var parents = {};
  var re = /\n\t\t([A-F0-9]{24}) /g;
  var hit;
  while ((hit = re.exec(pbx))) {
    var id = hit[1];
    var body;
    try { body = objectBody(pbx, id); } catch (e) { continue; }
    if (field(body, 'isa') !== 'PBXGroup') continue;
    idsIn(body, 'children').forEach(function (child) { parents[child] = id; });
  }
  return parents;
}

function diskPath(pbx, parents, id) {
  var parts = [];
  var cursor = id;
  while (cursor) {
    var body = objectBody(pbx, cursor);
    var rel = field(body, 'path');
    if (rel) parts.unshift(rel);
    cursor = parents[cursor];
  }
  return path.join.apply(path, [ios].concat(parts));
}

function walkFiles(dir, prefix, into) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent) {
    if (ent.name === '.DS_Store') return;
    var rel = prefix ? prefix + '/' + ent.name : ent.name;
    var full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, rel, into);
    else into.set(rel, full);
  });
}

function projectedLayout(pbx) {
  var parents = parentMap(pbx);
  var phase = objectBody(pbx, extensionPhase);
  check(field(phase, 'isa') === 'PBXResourcesBuildPhase', 'extension resources phase');
  var layout = new Map();
  idsIn(phase, 'files').forEach(function (buildId) {
    var build = objectBody(pbx, buildId);
    check(field(build, 'isa') === 'PBXBuildFile', 'resource build file');
    var ref = field(build, 'fileRef');
    var body = objectBody(pbx, ref);
    var kind = field(body, 'lastKnownFileType');
    var rel = field(body, 'path');
    var disk = diskPath(pbx, parents, ref);
    if (kind === 'folder') {
      check(fs.existsSync(disk) && fs.statSync(disk).isDirectory(), 'folder reference exists: ' + rel);
      walkFiles(disk, basename(rel), layout);
    } else {
      check(fs.existsSync(disk) && fs.statSync(disk).isFile(), 'resource file exists: ' + rel);
      layout.set(basename(rel), disk);
    }
  });
  return layout;
}

function pushPath(list, value) {
  if (typeof value === 'string' && value && value.indexOf('://') === -1) list.push(value);
}

function manifestResourcePaths(manifest) {
  var list = [];
  if (manifest.icons) Object.keys(manifest.icons).forEach(function (k) { pushPath(list, manifest.icons[k]); });
  var action = manifest.action || {};
  pushPath(list, action.default_popup);
  if (typeof action.default_icon === 'string') pushPath(list, action.default_icon);
  else if (action.default_icon) Object.keys(action.default_icon).forEach(function (k) { pushPath(list, action.default_icon[k]); });
  (manifest.content_scripts || []).forEach(function (script) {
    (script.js || []).forEach(function (item) { pushPath(list, item); });
    (script.css || []).forEach(function (item) { pushPath(list, item); });
  });
  var background = manifest.background || {};
  pushPath(list, background.service_worker);
  (background.scripts || []).forEach(function (item) { pushPath(list, item); });
  return list;
}

function localRefsInText(text) {
  var refs = [];
  var re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  var hit;
  while ((hit = re.exec(text))) refs.push(hit[1]);
  var urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((hit = urlRe.exec(text))) refs.push(hit[1]);
  return refs.filter(function (ref) {
    return ref && ref.indexOf('://') === -1 && ref.charAt(0) !== '#' && ref.indexOf('data:') !== 0;
  });
}

function resolveRef(fromBundlePath, ref) {
  var dir = fromBundlePath.indexOf('/') === -1 ? '' : fromBundlePath.slice(0, fromBundlePath.lastIndexOf('/') + 1);
  var parts = (dir + ref).split('/');
  var out = [];
  parts.forEach(function (part) {
    if (!part || part === '.') return;
    if (part === '..') out.pop();
    else out.push(part);
  });
  return out.join('/');
}

function requiredPaths(manifest, layout) {
  var required = manifestResourcePaths(manifest);
  var seen = {};
  required.forEach(function (item) { seen[item] = true; });
  // Follow HTML (and CSS) shipped in the extension so popup.js is required too.
  var extra = [];
  required.forEach(function (item) {
    if (!/\.(html|css)$/i.test(item)) return;
    var disk = layout.get(item);
    if (!disk) return;
    localRefsInText(fs.readFileSync(disk, 'utf8')).forEach(function (ref) {
      var resolved = resolveRef(item, ref);
      if (!seen[resolved]) {
        seen[resolved] = true;
        extra.push(resolved);
      }
    });
  });
  return required.concat(extra);
}

function appexArg(argv) {
  var i = argv.indexOf('--appex');
  if (i === -1) return null;
  var value = argv[i + 1];
  if (!value) throw new Error('--appex needs a path');
  return value;
}

function main() {
  var pbx = fs.readFileSync(pbxPath, 'utf8');
  var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  var layout = projectedLayout(pbx);
  var needed = requiredPaths(manifest, layout);
  check(needed.indexOf('images/icon-128.png') !== -1, 'manifest asks for images/icon-128.png');
  check(layout.has('images/icon-128.png'), 'images folder is copied as a directory, not flattened');
  check(!layout.has('icon-128.png'), 'icon-128.png is not also dropped at the appex root');
  needed.forEach(function (item) {
    check(layout.has(item), 'bundle layout contains ' + item);
  });

  var appex = appexArg(process.argv);
  if (appex) {
    check(fs.existsSync(appex) && fs.statSync(appex).isDirectory(), 'appex exists');
    needed.forEach(function (item) {
      var full = path.join(appex, item);
      check(fs.existsSync(full) && fs.statSync(full).isFile(), 'appex contains ' + item);
    });
  }

  console.log('ios extension bundle tests passed (' + checks + ' checks' + (appex ? ', appex ' + appex : '') + ')');
}

main();
