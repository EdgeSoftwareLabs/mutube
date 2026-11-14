// Regenerates tests/fixtures/tizentube-1.15.2-settings.json by running TizenTube's
// REAL settings code (reisxd/TizenTube mods/ui/settings.js, ui/ytUI.js,
// ui/customYTSettings.js at v1.15.2) and recording every command it hands to
// resolveCommand. The fixture is what tests/simulate.js replays.
//
//   git clone https://github.com/reisxd/TizenTube /tmp/TizenTube   (package.json 1.15.2)
//   npm i --prefix /tmp/ttfix esbuild i18next@25 qrcode-npm@0.0.3
//   node tests/make-tizentube-fixtures.mjs /tmp/TizenTube /tmp/ttfix
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const [ttRoot, deps] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(path.join(ttRoot, 'package.json'), 'utf8'));
const require = createRequire(path.join(deps, 'package.json'));
const esbuild = require('esbuild');
const mods = path.join(ttRoot, 'mods');
const out = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', `tizentube-${pkg.version}-settings.json`);

const entry = `
import i18n from 'i18next';
import resources from ${JSON.stringify(path.join(mods, 'translations/i18nResources.js'))};
import modernUI, { optionShow } from ${JSON.stringify(path.join(mods, 'ui/settings.js'))};
import { PatchSettings } from ${JSON.stringify(path.join(mods, 'ui/customYTSettings.js'))};
export { i18n, resources, modernUI, optionShow, PatchSettings };
`;
const stub = `export default function resolveCommand(cmd) { (globalThis.__captured || (globalThis.__captured = [])).push(JSON.parse(JSON.stringify(cmd))); return true; }`;

globalThis.window = globalThis;
globalThis.localStorage = { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); } };
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' } });

const res = await esbuild.build({
  stdin: { contents: entry, resolveDir: mods, loader: 'js' },
  bundle: true, format: 'esm', platform: 'neutral', write: false,
  nodePaths: [path.join(deps, 'node_modules')], mainFields: ['module', 'main'],
  loader: { '.json': 'json' },
  plugins: [{ name: 'stub', setup(b) {
    b.onResolve({ filter: /resolveCommand\.js$/ }, () => ({ path: 'stub', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'js' }));
  } }]
});
const tmp = path.join(deps, 'tt-bundle.mjs');
fs.writeFileSync(tmp, res.outputFiles[0].text);
const TT = await import(tmp);

const fixtures = { tizentube: pkg.version, generated: new Date().toISOString(), languages: {} };
for (const lng of ['en', 'tr']) {
  await TT.i18n.init({ lng, fallbackLng: 'en', resources: TT.resources, interpolation: { escapeValue: false } });
  await TT.i18n.changeLanguage(lng);
  const f = {};
  const grab = (fn) => { globalThis.__captured = []; fn(); return globalThis.__captured.pop(); };
  f.main = grab(() => TT.modernUI(false));
  // Toggling "Ad Block" (row index 2 in 1.15.2) re-opens the list with parameters [2].
  f.mainAfterToggle = grab(() => TT.modernUI(true, [2]));
  const items = f.main.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items;
  const params = (it) => it.compactLinkRenderer.serviceEndpoint.commandExecutorCommand.commands.find((c) => c.customAction && c.customAction.action === 'OPTIONS_SHOW')?.customAction.parameters;
  const deArrow = items.map(params).find((p) => p && p.menuHeader && p.menuHeader.subtitle === 'https://dearrow.ajay.app/');
  f.dearrow = grab(() => TT.optionShow(deArrow, false));
  f.support = grab(() => TT.optionShow(params(items[0]), params(items[0]).update));
  const ytSettings = { title: { runs: [{ text: 'Settings' }] }, items: [] };
  TT.PatchSettings(ytSettings);
  f.ytSettingsResponse = ytSettings;
  fixtures.languages[lng] = f;
}
fs.mkdirSync(path.dirname(out), { recursive: true });
// QR data URLs are large and irrelevant here.
fs.writeFileSync(out, JSON.stringify(fixtures, (k, v) => (k === 'url' && typeof v === 'string' && v.startsWith('data:') ? 'data:image/gif;base64,(trimmed)' : v), 1) + '\n');
console.log('wrote', out);
