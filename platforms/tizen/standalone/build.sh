#!/bin/sh
# Build the YouTube + standalone Tizen widget tree (unsigned) in build/tizen-standalone/pkg.
#   platforms/tizen/standalone/build.sh /path/to/TizenTube    (checkout whose package.json is 1.15.2)
# Then sign + package with Tizen Studio's CLI and a Samsung certificate profile:
#   tizen package -t wgt -s <profile> -- build/tizen-standalone/pkg   (-> pkg/YouTube +.wgt)
set -eu
TT="${1:?usage: build.sh /path/to/TizenTube}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
python3 platforms/build_platforms.py tizen-standalone --tizentube-src "$TT"
APP="$ROOT/build/tizen-standalone/app"
PKG="$ROOT/build/tizen-standalone/pkg"
( cd "$APP/service" && npm install --no-audit --no-fund && npm install --no-save --no-audit --no-fund @vercel/ncc && npm run build )
rm -rf "$PKG" && mkdir -p "$PKG/service/dist"
cp "$APP/config.xml" "$APP/index.html" "$APP/icon.png" "$APP/icon_16b9.png" "$PKG/"
cp "$APP/service/dist/index.js" "$PKG/service/dist/index.js"
cp "$TT/LICENSE" "$PKG/LICENSE.TizenTube"
cp "$ROOT/NOTICE" "$PKG/NOTICE"
echo "unsigned widget tree: $PKG"
