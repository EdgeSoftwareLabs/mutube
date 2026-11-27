#!/bin/bash
# Bundle the YouTube + iOS script and, on macOS, build an unsigned IPA
# for Sideloadly / Automatic Sideloader / a personal Xcode team.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

python3 "$ROOT/platforms/build_platforms.py" ios

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "JS assets bundled in platforms/ios/YouTubePlus/Resources."
  echo "xcodebuild needs macOS. On a Mac, run: platforms/ios/build.sh"
  exit 0
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild not found. Install Xcode, then re-run platforms/ios/build.sh" >&2
  exit 1
fi

DERIVED="$HERE/build/DerivedData"
rm -rf "$DERIVED"
xcodebuild \
  -project "$HERE/YouTubePlus.xcodeproj" \
  -scheme YouTubePlus \
  -configuration Release \
  -sdk iphoneos \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  DEVELOPMENT_TEAM="" \
  build

APP="$DERIVED/Build/Products/Release-iphoneos/YouTubePlus.app"
if [[ ! -d "$APP" ]]; then
  APP="$(find "$DERIVED" -type d -name 'YouTubePlus.app' -print -quit || true)"
fi
if [[ ! -d "${APP:-}" ]]; then
  echo "YouTubePlus.app was not produced" >&2
  exit 1
fi

STAGE="$HERE/build/ipa-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/Payload"
cp -R "$APP" "$STAGE/Payload/YouTubePlus.app"
OUT="$HERE/build/YouTubePlus-unsigned.ipa"
rm -f "$OUT"
if command -v ditto >/dev/null 2>&1; then
  ditto -c -k --sequesterRsrc --keepParent "$STAGE/Payload" "$OUT"
else
  (cd "$STAGE" && zip -qry "$OUT" Payload)
fi
echo "wrote $OUT"
