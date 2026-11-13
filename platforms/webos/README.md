# YouTube + for LG webOS

Status: **scaffold, builds an installable IPK, untested on a TV.**

Same approach as [webosbrew/youtube-webos](https://github.com/webosbrew/youtube-webos):
a tiny web app (`app/index.html`) opens `https://www.youtube.com/tv`, and webOS
injects `webOSUserScripts/userScript.js` into that page. Our user script is
`youtube-plus.js` (plus a relaunch handler), so the long-press menu of every
Home tile gets **Not interested** and **Don't recommend channel**.

## Build

Requirements: Python 3, the webOS CLI (`npm i -g @webos-tools/cli`, provides
`ares-package` / `ares-install`), and a TV in Developer Mode or rooted with
Homebrew Channel.

```bash
python3 platforms/build_platforms.py webos      # -> build/webos/ (app dir) 
ares-package build/webos -o build               # -> build/com.youtubeplus.leanback_1.0.0_all.ipk
ares-install -d <tv> build/com.youtubeplus.leanback_1.0.0_all.ipk
```

`build_platforms.py webos --with-tizentube` also prepends TizenTube's user
script (ad-block, SponsorBlock, its own menu). TizenTube targets Tizen and is
not officially supported on webOS, so that combination is experimental.

## Using youtube-webos instead (recommended if you already run it)

youtube-webos already ships ad-block/SponsorBlock. To add YouTube + to it,
copy `youtube-plus.js` into its `src/` and add `import './youtube-plus.js';`
at the end of `src/userScript.js`, then build it as its README describes
(`pnpm install && pnpm run build && pnpm run package`). Rename `title` in
`assets/appinfo.json` to `YouTube +` and replace its icons with
`platforms/webos/assets/*`.

## Notes

- Without TizenTube the tiles have no TizenTube menu, so youtube-plus builds
  one (Play, Save to Watch Later, Save to playlist, Not interested, Don't
  recommend channel). Set `window.YTPLUS_CONFIG = {buildMenuIfMissing:false}`
  to disable.
- App id `com.youtubeplus.leanback` is separate from the stock YouTube app, so
  voice / cast (DIAL) launches still go to the stock app.
