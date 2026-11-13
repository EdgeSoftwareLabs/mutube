# YouTube + for Samsung Tizen TVs

Two ways to ship it. Both load TizenTube (ad-block, SponsorBlock, its
long-press menu) followed by `youtube-plus.js`, which adds **Not interested**
and **Don't recommend channel** to every Home tile's long-press menu.

## A. TizenBrew module (recommended) - ready to build, untested on a TV

[TizenBrew](https://github.com/reisxd/TizenBrew) fetches modules from jsDelivr
(`npm/<package>` or `gh/<user>/<repo>`), reads `package.json`
(`packageType: "mods"`, `websiteURL`, `main`, `serviceFile`) and evaluates
`main` inside the YouTube TV page.

```bash
python3 platforms/build_platforms.py tizen-module
# -> platforms/tizen/module/dist/userScript.js  (TizenTube 1.15.2 + youtube-plus.js)
# -> platforms/tizen/module/dist/service.js     (TizenTube's service, unchanged)
```

Publish it, either:
- **GitHub**: commit `platforms/tizen/module/dist` (it is git-ignored by
  default: `git add -f`), push the branch, then in TizenBrew add the module
  `gh/mistermassacre/mutube@youtube-plus/platforms/tizen/module`; or
- **npm**: `cd platforms/tizen/module && npm publish` (pick a package name you
  own), then add `npm/<name>` in TizenBrew.

The bundle contains TizenTube, which is GPL-3.0: publish it under GPL-3.0 and
link to TizenTube's source.

## B. Standalone .wgt (scaffold)

`standalone/config.xml` is TizenTube's standalone widget config renamed to
"YouTube +" with new ids and our icons. The service code is TizenTube's,
copied and patched at build time (not vendored):

```bash
git clone https://github.com/reisxd/TizenTube /tmp/TizenTube
python3 platforms/build_platforms.py tizen-standalone --tizentube-src /tmp/TizenTube
cd build/tizen-standalone/service && npm install && node build-service.js
# package + sign with Tizen Studio (Samsung certificate profile), then install
tizen package -t wgt -s <profile> -- build/tizen-standalone
tizen install -n YouTubePlus.wgt -t <tv>
```

The build swaps TizenTube's jsDelivr user-script URL for the module bundle
URL above (`--bundle-url` to change it), so option A's bundle must be published
first.

Needs: Tizen Studio + TV extension, a Samsung certificate, TV in Developer
Mode. Icons: `icon.png` (512x512), `icon_1024.png`, `icon_16b9.png` (1920x1080).
