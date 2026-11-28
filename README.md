# YouTube +

YouTube + (formerly μTube / MuTube) enhances the YouTube TV app with
[TizenTube](https://github.com/reisxd/TizenTube)'s userscript (ad removal,
SponsorBlock, extra player controls) and adds its own feature. On iPhone and
iPad it is a separate app that wraps m.youtube.com and bundles its own ad
block, SponsorBlock, background audio, and Picture in Picture.

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
| iPhone / iPad (iOS) | SwiftUI + WKWebView app, script bundled in the IPA | Ready to build on a Mac ([platforms/ios](platforms/ios/README.md)) |

## Settings screen

TizenTube's settings screen (opened from YouTube's Settings, shown as
"YouTube + Settings") is rebranded at runtime by `youtube-plus.js`, because
TizenTube itself still loads unmodified from its CDN:

- every user-visible "TizenTube" reads "YouTube +" (any UI language);
- the "Made by ..." line and the Support / social-media entries are hidden;
- DeArrow's page keeps its website link and explains below it that DeArrow
  replaces clickbait titles and thumbnails with community-submitted ones.

The rows are matched by structure (icons, links), not English text, against
TizenTube 1.15.2's `mods/ui/settings.js`. `tests/simulate.js` replays the exact
commands that code produces (`tests/fixtures/`, regenerate with
`tests/make-tizentube-fixtures.mjs`). Set `YTPLUS_CONFIG = {rebrandSettings:
false}` to turn it off. The credit to TizenTube and its author stays here and
in [NOTICE](NOTICE).

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
3. A decrypted YouTube 4.54.01 IPA at `ipa/YouTube_4.54.01_decrypted.ipa`.
   An IPA already patched by MuTube (or YouTube +) also works: the patcher
   detects it, restores the original instructions from its stubs and zeroes
   the header padding, then patches again. (Checked: unpatching the 4.54.01
   MuTube build and re-patching it with MuTube's inject.js gives the same
   bytes.)

### Build

```bash
make                 # -> youtube-plus.ipa, display name "YouTube +"
make ICONS=1         # also replace app icon, Top Shelf and launch image (see platforms/tvos)
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
On launch a "Welcome to YouTube +" toast appears in the top right corner;
long-press a Home tile to see the two new items.

## iPhone (iOS)

`platforms/ios/YouTubePlus.xcodeproj` is a SwiftUI app. It loads
`https://m.youtube.com` in a WKWebView, injects `youtube-plus-ios.js` at
document start (bundled, no CDN), and compiles `content-rules.json` into a
content rule list. Background audio uses `UIBackgroundModes` (`audio`) and
`AVAudioSession` (`.playback`), including with the screen locked. Lock screen
and Control Center play, pause, and skip ±10 seconds. Settings, including
SponsorBlock categories, DeArrow, and Hide Shorts, are a native **YouTube +
Settings** sheet opened from YouTube's own settings menu and stored in
UserDefaults. See [platforms/ios/README.md](platforms/ios/README.md).

```bash
python3 platforms/build_platforms.py ios   # copy the script into the Xcode resources
platforms/ios/build.sh                     # on a Mac: unsigned platforms/ios/build/YouTubePlus-unsigned.ipa
```

Sideload that IPA with Sideloadly or Automatic Sideloader, or open the Xcode
project, set `YTPLUS_TEAM_ID` in `platforms/ios/Config/YouTubePlus.xcconfig`,
and run it on a device. The bundle id is `com.edgesoftwarelabs.youtubeplus`.
An optional Safari extension in the same IPA opens YouTube links in the app;
see [platforms/ios/README.md](platforms/ios/README.md).

## Tizen, webOS, browser

```bash
python3 platforms/build_platforms.py web            # platforms/web/youtube-plus.user.js
python3 platforms/build_platforms.py webos          # build/webos -> ares-package
python3 platforms/build_platforms.py tizen-module   # TizenBrew module bundle
python3 platforms/build_platforms.py ios            # iOS script bundle
```

Details: [Tizen](platforms/tizen/README.md), [webOS](platforms/webos/README.md),
[browser](platforms/web/README.md), [iOS](platforms/ios/README.md),
[tvOS icons](platforms/tvos/README.md).

## Icon

Original artwork in YouTube's app-icon style: a rounded play button and white
triangle, filled with an iridescent pastel gradient on solid black. The triangle
sits at the center of a square icon. Wide layouts add a white "YouTube +"
wordmark in Google Sans Bold (`icons/fonts`, SIL OFL).
`python3 icons/generate_icons.py` (needs `cairosvg`, `Pillow`, `numpy`)
regenerates every platform size:

- Apple TV: two-layer parallax icon (gradient logo and wordmark in front, solid
  black behind), Top Shelf 1920x720 and 2320x720 (@1x/@2x) on black with logo
  and wordmark centred as a group, and the launch image. Previews:
  `icons/png/youtube-plus-tvos-1280x768.png`, `icons/png/youtube-plus-topshelf-1920x720.png`.
- iOS, Tizen, webOS, web, and the Safari extension: square icon (gradient logo
  on black). The Samsung YT+ Helper icon is the greyscale copy. The 16:9 Tizen
  tile and webOS splash use the Top Shelf layout. `icons/youtube-plus.svg` is a
  vector approximation, `icons/youtube-plus-logo.svg` the bare logo.

YouTube is a trademark of Google LLC. This is an unofficial personal project,
not affiliated with or endorsed by Google.

YouTube + is built on [TizenTube](https://github.com/reisxd/TizenTube) by
Reis Can (reisxd) and contributors, GPL-3.0. Hiding TizenTube's name and links in
the TV UI does not change its license or authorship; bundles that include it
(Tizen module, optional webOS build) must follow its license. See [NOTICE](NOTICE).
