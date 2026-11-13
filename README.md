# YouTube +

YouTube + (formerly μTube / MuTube) enhances the YouTube TV app with
[TizenTube](https://github.com/reisxd/TizenTube)'s userscript (ad removal,
SponsorBlock, extra player controls) and adds its own feature:

- **Not interested** and **Don't recommend channel** on every Home video tile.
  Hold Select (Apple TV) / OK (TV remotes) on a tile; the two items are added
  after the existing ones (Play, Save to Watch Later, Save to playlist, Add to
  queue, Go to channel), and a toast confirms the action.

| Platform | How | Status |
|---|---|---|
| Apple TV (tvOS) | `patcher.py` patches a decrypted YouTube 4.54.01 IPA | Ready to build (Mac); feature untested on device |
| Samsung Tizen | TizenBrew module, or standalone .wgt | Module ready to build; .wgt scaffold |
| LG webOS | youtube-webos-style IPK | Scaffold, builds an IPK |
| Browser | Tampermonkey script for youtube.com/tv | Ready |
| iPhone / iPad | rebranded sideload build | Plan only ([platforms/ios](platforms/ios/README.md)) |

## How the Home menu feature works

`youtube-plus.js` (ES5, no dependencies) wraps `JSON.parse`, which the TV
client uses for every InnerTube response. It keeps itself outermost so it runs
after TizenTube has built the tile menus. For each video tile
(`tileRenderer` / `lockupViewModel`) it appends two `menuServiceItemRenderer`
entries to `onLongPressCommand.showMenuCommand.menu.menuRenderer.items`.

YouTube no longer puts feedback tokens in the TV long-press menu. Where a tile
carries the `PAcontext_menu` engagement-panel reference (directly, or in
TizenTube's copy of the original tile), clicking an item calls
`/youtubei/v1/get_panel`, takes the real feedback token and sends it to
`/youtubei/v1/feedback`, which is what YouTube's own clients send. Tiles
without that reference still get both items, but the action can only hide the
video/channel **on this device** (stored in localStorage, removed from later
responses), and the toast says so. See the header of `youtube-plus.js` for what
is verified vs. assumed.

Debugging: `localStorage.setItem('ytplus.debug', '1')`, or set
`window.YTPLUS_CONFIG = {debug: true}` before the script loads, then look for
`[YouTube+]` in the console. `window.YouTubePlus.stats()` shows counters.
`make test` runs an offline simulation (`tests/simulate.js`, Node).

## Apple TV (tvOS)

Tested by the original MuTube with YouTube 4.54.01 on an Apple TV 4K. The
YouTube + additions have not been tested on a device yet.

### Requirements

1. `uv` (used to run `patcher.py` and resolve script dependencies)
2. Xcode Command Line Tools (`xcrun` + `clang` with the AppleTV SDK); full
   Xcode for `make ICONS=1`
3. A decrypted YouTube 4.54.01 IPA at `ipa/YouTube_4.54.01_decrypted.ipa`

### Build

```bash
make                 # -> youtube-plus.ipa, display name "YouTube +"
make ICONS=1         # also replace app icon + Top Shelf (experimental, see platforms/tvos)
make EMBED=0         # load youtube-plus.js from jsDelivr instead of embedding it
make PRINTF_LOGS=1   # printf tracing in the native stubs
```

`patcher.py` now also:
- embeds `youtube-plus.js` ahead of `inject.js` in the binary's `__TEXT`
  padding. If it does not fit, it says so and builds a payload that loads it
  from `https://cdn.jsdelivr.net/gh/mistermassacre/mutube@youtube-plus/youtube-plus.js`
  (works only once that branch is pushed; override with `--youtube-plus-url`);
- sets `CFBundleDisplayName` to `YouTube +` (`--display-name` to change). The
  bundle id is unchanged; Sideloadly may rewrite it when re-signing.

### Usage

Sideload `youtube-plus.ipa` with a tool like [Sideloadly](https://sideloadly.io/).
On launch TizenTube shows its popup in the top right corner; long-press a Home
tile to see the two new items.

## Tizen, webOS, browser, iOS

```bash
python3 platforms/build_platforms.py web            # platforms/web/youtube-plus.user.js
python3 platforms/build_platforms.py webos          # build/webos -> ares-package
python3 platforms/build_platforms.py tizen-module   # TizenBrew module bundle
```

Details: [Tizen](platforms/tizen/README.md), [webOS](platforms/webos/README.md),
[browser](platforms/web/README.md), [iOS](platforms/ios/README.md),
[tvOS icons](platforms/tvos/README.md).

## Icon

`icons/youtube-plus.svg` is the master (original artwork in YouTube's app-icon
style: red rounded play button, white triangle, red "+" badge).
`python3 icons/generate_icons.py` (needs `cairosvg`, `Pillow`) regenerates
every platform size. `icon-preview.png` is a 1024px preview.

YouTube is a trademark of Google LLC. This is an unofficial personal project,
not affiliated with or endorsed by Google. TizenTube is GPL-3.0; bundles that
include it (Tizen module, optional webOS build) must follow its license.
