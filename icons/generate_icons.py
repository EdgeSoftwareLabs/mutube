#!/usr/bin/env python3
"""Generate every YouTube + icon from one SVG master.

Original artwork in the general style of YouTube's app icons (red rounded
"play button" with a white triangle), plus a red "+" badge with a white ring.
Geometry is drawn from scratch here and is not traced from YouTube's logo.

Requires: pip install cairosvg pillow
Usage:    python3 icons/generate_icons.py      (writes into icons/ and platforms/)
"""
import io
import json
import shutil
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
RED = "#FF0000"
DARK = "#0F0F0F"


def logo_group(with_badge=True):
    # Logo drawn on a 1024x1024 grid, centred on (512, 512).
    badge = f"""
    <g id="badge">
      <circle cx="780" cy="300" r="132" fill="{RED}" stroke="#FFFFFF" stroke-width="32"/>
      <rect x="712" y="282" width="136" height="36" rx="18" fill="#FFFFFF"/>
      <rect x="762" y="232" width="36" height="136" rx="18" fill="#FFFFFF"/>
    </g>""" if with_badge else ""
    # translate() recentres the visual bounding box (button + badge) on 512,512.
    return f"""
  <g id="logo" transform="translate(-35 57)">
    <rect x="182" y="282" width="660" height="460" rx="138" ry="138" fill="{RED}"/>
    <path d="M 440 404 L 440 620 L 626 512 Z" fill="#FFFFFF" stroke="#FFFFFF"
          stroke-width="26" stroke-linejoin="round"/>{badge}
  </g>"""


def svg_square(bg="#FFFFFF", size=1024, corner=0, logo_scale=0.96, badge=True):
    s = logo_scale
    t = 512 - 512 * s
    bg_el = "" if bg is None else f'<rect width="1024" height="1024" rx="{corner}" fill="{bg}"/>'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 1024 1024">
  <title>YouTube +</title>
  {bg_el}
  <g transform="translate({t} {t}) scale({s})">{logo_group(badge)}</g>
</svg>
"""


def svg_wide(w, h, bg, logo_h_frac=0.62, wordmark=False, text_color="#FFFFFF", gradient=False):
    # Logo (1024 grid) scaled so its 1024 box is logo_h_frac of the height.
    s = h * logo_h_frac / 1024.0
    fs = h * 0.24
    gap = h * 0.10
    if wordmark:
        # visible logo box is ~730 units wide starting at x=147; text ~4.6em wide
        start = (w - (730 * s + gap + 4.6 * fs)) / 2
        lx = start - 147 * s
    else:
        lx = w / 2 - 512 * s
    ly = h / 2 - 512 * s
    defs = ""
    fill = bg
    if gradient:
        defs = f"""<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#2A2A2A"/><stop offset="1" stop-color="{bg}"/></linearGradient></defs>"""
        fill = "url(#g)"
    bg_el = "" if bg is None else f'<rect width="{w}" height="{h}" fill="{fill}"/>'
    text = ""
    if wordmark:
        tx = start + 730 * s + gap
        text = (f'<text x="{tx}" y="{h / 2 + fs * 0.36}" font-family="Roboto, Inter, DejaVu Sans, sans-serif" '
                f'font-weight="700" font-size="{fs}" fill="{text_color}" letter-spacing="{-fs * 0.02}">YouTube +</text>')
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  {defs}{bg_el}
  <g transform="translate({lx} {ly}) scale({s})">{logo_group()}</g>
  {text}
</svg>
"""


def png(svg_text, w, h, path, flatten=None):
    data = cairosvg.svg2png(bytestring=svg_text.encode(), output_width=w, output_height=h)
    img = Image.open(io.BytesIO(data)).convert("RGBA")
    if flatten:
        base = Image.new("RGBA", img.size, flatten)
        base.alpha_composite(img)
        img = base.convert("RGB")
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    return path


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


INFO = {"author": "xcode", "version": 1}


def contents(path, obj):
    write(path / "Contents.json", json.dumps(obj, indent=2) + "\n")


def tvos_catalog(out):
    """tvOS asset catalog that is a drop-in replacement for the Assets.car in
    the YouTube 4.54.01 tvOS IPA.

    That Assets.car (xcrun assetutil --info) holds only: AppIconSmall
    (2-layer image stack, 400x240 @1x/@2x), TopShelfImage (1920x720 @1x),
    Top Shelf Image Wide (2320x720 @1x/@2x) and LaunchImage (1920x1080 @1x,
    3840x2160 @2x), referenced by name from Info.plist. We emit exactly those
    names so Info.plist needs no change.
    """
    if out.exists():
        shutil.rmtree(out)
    contents(out, {"info": INFO})

    st = out / "AppIconSmall.imagestack"
    contents(st, {"info": INFO, "layers": [{"filename": "Front.imagestacklayer"}, {"filename": "Back.imagestacklayer"}]})
    for layer in ("Front", "Back"):
        ls = st / f"{layer}.imagestacklayer"
        contents(ls, {"info": INFO})
        iset = ls / "Content.imageset"
        imgs = []
        for scale, (w, h) in (("1x", (400, 240)), ("2x", (800, 480))):
            fn = f"{layer.lower()}_{w}x{h}.png"
            if layer == "Front":
                png(svg_wide(w, h, None, logo_h_frac=0.80), w, h, iset / fn)
            else:
                png(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}"><rect width="{w}" height="{h}" fill="#FFFFFF"/></svg>', w, h, iset / fn, flatten="#FFFFFF")
            imgs.append({"filename": fn, "idiom": "tv", "scale": scale})
        contents(iset, {"images": imgs, "info": INFO})

    for name, (w, h), scales in (("TopShelfImage", (1920, 720), (1,)), ("Top Shelf Image Wide", (2320, 720), (1, 2))):
        iset = out / f"{name}.imageset"
        imgs = []
        for mult in scales:
            fn = f"topshelf_{w * mult}x{h * mult}.png"
            png(svg_wide(w, h, DARK, logo_h_frac=0.42, wordmark=True, gradient=True), w * mult, h * mult, iset / fn, flatten=DARK)
            imgs.append({"filename": fn, "idiom": "tv", "scale": f"{mult}x"})
        contents(iset, {"images": imgs, "info": INFO})

    li = out / "LaunchImage.launchimage"
    imgs = []
    for mult in (1, 2):
        fn = f"launch_{1920 * mult}x{1080 * mult}.png"
        png(svg_wide(1920, 1080, DARK, logo_h_frac=0.30), 1920 * mult, 1080 * mult, li / fn, flatten=DARK)
    for minver, mults in (("11.0", (1, 2)), ("9.0", (1,))):
        for mult in mults:
            imgs.append({"orientation": "landscape", "idiom": "tv", "extent": "full-screen",
                         "minimum-system-version": minver, "filename": f"launch_{1920 * mult}x{1080 * mult}.png",
                         "scale": f"{mult}x"})
    contents(li, {"images": imgs, "info": INFO})


def ios_catalog(out, master):
    if out.exists():
        shutil.rmtree(out)
    contents(out, {"info": INFO})
    iset = out / "AppIcon.appiconset"
    # Single-size 1024 universal icon (Xcode 14+) plus legacy sizes for older tools.
    entries = [{"filename": "icon_1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}]
    png(master, 1024, 1024, iset / "icon_1024.png", flatten="#FFFFFF")
    legacy = [("iphone", 20, (2, 3)), ("iphone", 29, (2, 3)), ("iphone", 40, (2, 3)), ("iphone", 60, (2, 3)),
              ("ipad", 20, (1, 2)), ("ipad", 29, (1, 2)), ("ipad", 40, (1, 2)), ("ipad", 76, (1, 2)), ("ipad", 83.5, (2,))]
    for idiom, pt, scales in legacy:
        for sc in scales:
            px = int(round(pt * sc))
            fn = f"icon_{px}.png"
            if not (iset / fn).exists():
                png(master, px, px, iset / fn, flatten="#FFFFFF")
            ptxt = f"{pt:g}"
            entries.append({"filename": fn, "idiom": idiom, "scale": f"{sc}x", "size": f"{ptxt}x{ptxt}"})
    contents(iset, {"images": entries, "info": INFO})


def main():
    master = svg_square("#FFFFFF")
    write(ICONS / "youtube-plus.svg", master)
    write(ICONS / "youtube-plus-logo.svg", svg_square(None))
    png(master, 1024, 1024, ROOT / "icon-preview.png", flatten="#FFFFFF")
    for px in (1024, 512, 256, 192, 180, 128, 64, 32, 16):
        png(master, px, px, ICONS / "png" / f"youtube-plus-{px}.png", flatten="#FFFFFF")
    png(svg_square(None), 1024, 1024, ICONS / "png" / "youtube-plus-logo-1024.png")

    # tvOS (Apple TV) asset catalog consumed by patcher.py --tvos-icons.
    tvos_catalog(ROOT / "platforms" / "tvos" / "Assets.xcassets")
    # iOS asset catalog (for a re-signed iOS build, see platforms/ios/README.md).
    ios_catalog(ROOT / "platforms" / "ios" / "Assets.xcassets", master)

    # Tizen: square icon (512 recommended, 1024 accepted) + 16:9 tile.
    tz = ROOT / "platforms" / "tizen"
    png(master, 512, 512, tz / "icon.png", flatten="#FFFFFF")
    png(master, 1024, 1024, tz / "icon_1024.png", flatten="#FFFFFF")
    png(svg_wide(1920, 1080, DARK, logo_h_frac=0.34, wordmark=True, gradient=True), 1920, 1080, tz / "icon_16b9.png", flatten=DARK)

    # webOS: names/sizes as used by webosbrew/youtube-webos appinfo.json.
    wo = ROOT / "platforms" / "webos" / "assets"
    for name, px in (("icon.png", 80), ("mediumLargeIcon.png", 115), ("largeIcon.png", 130), ("extraLargeIcon.png", 192)):
        png(master, px, px, wo / name, flatten="#FFFFFF")
    png(svg_wide(1920, 1080, DARK, logo_h_frac=0.34, wordmark=True, gradient=True), 1920, 1080, wo / "splashBackground.png", flatten=DARK)
    png(svg_wide(1920, 1080, DARK, logo_h_frac=0.34, wordmark=True, gradient=True), 1920, 1080, wo / "imageForRecents.png", flatten=DARK)
    png(svg_square(None, badge=False), 33, 33, wo / "playIcon.png")

    # Web: favicon + PWA/manifest icons.
    web = ROOT / "platforms" / "web" / "icons"
    for px in (16, 32, 48, 180, 192, 512):
        png(master, px, px, web / f"icon-{px}.png", flatten="#FFFFFF")
    ico = Image.open(web / "icon-48.png")
    ico.save(web / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    shutil.copy(ICONS / "youtube-plus.svg", web / "icon.svg")
    print("icons written")


if __name__ == "__main__":
    main()
