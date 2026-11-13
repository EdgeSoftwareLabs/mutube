# YouTube + on iPhone / iPad (iOS) - plan

Status: **plan only. Nothing here has been built or tested.**

## Why youtube-plus.js does not apply

The iOS YouTube app is a native (Objective-C/Swift + Elements) app, not the
Cobalt / youtube.com/tv web client used on Apple TV, Tizen and webOS. There is
no JSON.parse to hook, so `youtube-plus.js` cannot run there.

## Do we even need a feature patch on iOS?

On the iOS app, a Home feed video's three-dot menu already offers **Not
interested** and **Don't recommend channel** natively (check this on the
version you install). The TV client is the one that lost them. So the realistic
iOS deliverable is a **rebranded, tweaked sideload build**, plus a native
tweak only if YouTube ever removes those items on iOS too.

## Route 1: rebranded sideload build (practical)

1. Get a decrypted iOS YouTube IPA you are entitled to (from your own device,
   e.g. with a decryption tool on a jailbroken device). Not provided here.
2. Optional tweaks: inject [uYouEnhanced](https://github.com/arichornlover/uYouEnhanced)
   or YTLite (ad-block, background play, etc.). Both are distributed as .deb /
   prebuilt IPAs by their authors; follow their Building wiki.
3. Rename + icon with [cyan / pyzule-rw](https://github.com/asdfzxcvbn/pyzule-rw)
   (Linux or macOS):
   ```bash
   pipx install --force https://github.com/asdfzxcvbn/pyzule-rw/archive/main.zip
   pipx inject cyan Pillow            # needed for -k (icon)
   cyan -i YouTube_decrypted.ipa -o youtube-plus-ios.ipa \
        -n "YouTube +" -k ../../icons/png/youtube-plus-1024.png \
        -f uYouEnhanced.deb           # optional tweak(s)
   ```
   Keep the bundle id unless you need a side-by-side install (`-b`); changing
   it breaks Google sign-in keychain sharing in some tweak setups.
   `Assets.xcassets/` in this folder is the full iOS icon catalog if you prefer
   to rebuild the app's Assets.car with `actool` on a Mac.
4. Sideload with Sideloadly / AltStore / TrollStore (free Apple ID certs
   expire after 7 days).

## Route 2: Theos tweak that forces the two items (only if needed)

If a future iOS build drops the items, a small Theos/Logos tweak injected the
same way could add them back:

- Hook the menu/action-sheet builder used for feed video cells (in current
  builds this goes through classes such as `YTMenuController` /
  `YTDefaultSheetController` / `YTActionSheetAction`; uYouEnhanced and YTLite
  sources show the current names; verify with a class dump of the exact
  version you use).
- Read the cell's renderer (`YTIMenuRenderer` items with
  `YTIMenuServiceItemRenderer.serviceEndpoint.feedbackEndpoint.feedbackToken`)
  and, when the response has the tokens but the UI hides the items, append
  actions that dispatch that endpoint through the app's command handler.
- As on TV, if the server stops sending tokens there is nothing client-side
  can mint; only a local hide would be possible.

This needs: a Mac (or Linux) with Theos, the iOS SDK, the exact decrypted IPA,
and on-device testing. Not scaffolded here because class names change between
app versions and nothing could be verified without the IPA.
