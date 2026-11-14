#!/usr/bin/env python3
"""Generate every YouTube + icon from one SVG master.

Original artwork in the general style of YouTube's app icons (red rounded
"play button" with a white triangle), plus a red "+" badge with a white ring,
on the approved "E1" iridescent pastel background; Top Shelf layout "T1c".
Geometry is drawn from scratch here and is not traced from YouTube's logo.

Requires: pip install cairosvg pillow numpy
Usage:    python3 icons/generate_icons.py      (writes into icons/ and platforms/)
"""
import io
import json
import shutil
from pathlib import Path

import cairosvg
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

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


# ---------------------------------------------------------------------------
# "E1" artwork (approved Nov 2026): iridescent pastel mesh background with a
# dark vignette, red logo, white "YouTube +" wordmark in Google Sans Bold.
# Rasterised with numpy/Pillow (a smooth mesh gradient is not expressible in SVG).
# ---------------------------------------------------------------------------
FONT_BOLD = ICONS / "fonts" / "GoogleSans-Bold.ttf"     # OFL, static instance of google/fonts Google Sans
FONT_MEDIUM = ICONS / "fonts" / "GoogleSans-Medium.ttf"
# (x, y as 0..1, radius as a fraction of the 1280-wide reference, colour, strength)
BLOBS = [(0.10, 0.20, 0.26, "#7F55FF", 0.95), (0.75, 0.10, 0.26, "#4FB6FF", 0.95),
         (0.95, 0.75, 0.24, "#3FE0A8", 0.90), (0.08, 0.92, 0.22, "#FFC94D", 0.90),
         (0.50, 1.00, 0.24, "#FF6FA0", 0.95)]
BASE = "#9C7BFF"


def _rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def background(w, h, scale=1, wide=None):
    """E1 background at logical w x h, rendered at scale x. Blob radii follow the
    approved previews: 1280x768 icon reference, 1.25x for Top Shelf-like wide images."""
    W, H = int(w * scale), int(h * scale)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    if wide is None:
        wide = w / h > 2
    # E1 reference: radius = r * width. Wide (Top Shelf) reference T1c: r * 1549 px at 720 tall.
    rmul = (1280 * (720 / 768) ** 0.5 * 1.25 / 720 * h if wide else w) * scale
    img = np.ones((H, W, 3), np.float32) * _rgb(BASE)
    for x, y, r, col, k in BLOBS:
        d2 = (xx - x * W) ** 2 + (yy - y * H) ** 2
        wgt = (np.exp(-d2 / (2 * (r * rmul) ** 2)) * k)[..., None]
        img = img * (1 - wgt) + _rgb(col) * wgt
    d = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    v = np.clip((d - 0.55) / (1.25 - 0.55), 0, 1) ** 1.6 * 0.50
    img = img * (1 - v[..., None])
    # No dithering: random noise made the PNGs ~4x larger; banding is not visible at these ranges.
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB").convert("RGBA")


def logo_image(vis_h, badge=True):
    """Red logo with its visible box (746x590 units of the 1024 grid) vis_h px tall.
    Returns (image, alpha bbox, y of the play button's centre)."""
    size = int(round(1024 * vis_h / 590))
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{logo_group(badge)}</svg>'
    im = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size))).convert("RGBA")
    a = np.array(im)[:, :, 3]
    ys, xs = np.nonzero(a > 128)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    col = np.nonzero(a[:, x0 + int((x1 - x0) * 0.1)] > 128)[0]     # left edge: button only
    return im, (x0, x1, y0, y1), (col.min() + col.max()) / 2


def font(px, bold=True):
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT_MEDIUM), max(1, int(round(px))))


def with_shadow(canvas, layer, offset, blur, opacity):
    sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    sh.putalpha(layer.split()[-1].point(lambda v: int(v * opacity)))
    sh = sh.filter(ImageFilter.GaussianBlur(max(blur, 0.1)))
    moved = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    moved.alpha_composite(sh, (int(round(offset[0])), int(round(offset[1]))))
    canvas.alpha_composite(moved)
    canvas.alpha_composite(layer)
    return canvas


def e1_layout(w, h, scale=1, canvas=None):
    """The E1 icon: logo centred at 36% height, wordmark centred below. Reference 1280x768.
    canvas=None draws on the E1 background; pass a transparent image for a parallax front layer."""
    W, H = int(w * scale), int(h * scale)
    k = H / 768
    c = background(w, h, scale, wide=False) if canvas is None else canvas
    im, _, _ = logo_image(0.52 * H)
    L = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    L.alpha_composite(im, (int(W / 2 - im.width / 2), int(H * 0.36 - im.height / 2)))
    with_shadow(c, L, (0, 12 * k), 22 * k, 0.30)
    f = font(116 * k)
    T = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    x = W / 2 - f.getlength("YouTube +") / 2
    ImageDraw.Draw(T).text((x, H * 0.865), "YouTube +", font=f, fill="#FFFFFF", anchor="ls")
    with_shadow(c, T, (0, 5 * k), 9 * k, 0.40)
    return c


def t1c_layout(w, h, scale=1):
    """Top Shelf "T1c": logo + wordmark as one group centred horizontally (like the
    original Top Shelf), wordmark vertically centred on the play button. Reference 1920x720."""
    W, H = int(w * scale), int(h * scale)
    k = H / 720
    c = background(w, h, scale)
    L = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(L)
    im, (x0, x1, y0, y1), bcy = logo_image(250 * k)
    f = font(165 * k)
    tb = d.textbbox((0, 0), "YouTube +", font=f, anchor="ls")
    gap, lw = 72 * k, x1 - x0 + 1
    gx = (W - (lw + gap + tb[2] - tb[0])) / 2
    L.alpha_composite(im, (int(gx - x0), int(H / 2 - bcy)))
    d.text((gx + lw + gap - tb[0], H / 2 - tb[1] / 2), "YouTube +", font=f, fill="#FFFFFF", anchor="ls")
    return with_shadow(c, L, (0, 10 * k), 18 * k, 0.32)


def square_icon(px):
    """Square E1 icon (background + logo, no wordmark: every platform labels the icon)."""
    S = 1024
    c = background(S, S, wide=False)
    im, _, _ = logo_image(0.55 * S)
    L = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    L.alpha_composite(im, (int(S / 2 - im.width / 2), int(S / 2 - im.height / 2)))
    with_shadow(c, L, (0, 14), 26, 0.30)
    return c if px == S else c.resize((px, px), Image.LANCZOS)


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(path, optimize=True)
    return path


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


INFO = {"author": "xcode", "version": 1}


def contents(path, obj):
    write(path / "Contents.json", json.dumps(obj, indent=2) + "\n")


def svg_e1_square():
    """Vector approximation of the square E1 icon (for icon.svg / favicons in browsers).
    Gaussian blobs become radial gradients; the PNGs are the reference rendering."""
    S = 1024
    rmul = S
    defs, rects = [], []
    for i, (x, y, r, col, k) in enumerate(BLOBS):
        sig = r * rmul
        stops = "".join(f'<stop offset="{t / 3:.3f}" stop-color="{col}" stop-opacity="{k * np.exp(-t * t / 2):.3f}"/>'
                        for t in (0, 0.5, 1, 1.5, 2, 2.5, 3))
        defs.append(f'<radialGradient id="b{i}" gradientUnits="userSpaceOnUse" cx="{x * S}" cy="{y * S}" r="{3 * sig:.1f}">{stops}</radialGradient>')
        rects.append(f'<rect width="{S}" height="{S}" fill="url(#b{i})"/>')
    defs.append('<radialGradient id="v" cx="0.5" cy="0.5" r="0.884"><stop offset="0.44" stop-color="#000" stop-opacity="0"/>'
                '<stop offset="0.75" stop-color="#000" stop-opacity="0.12"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></radialGradient>')
    s = 0.55 * S / 590
    t = 512 - 512 * s
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">
  <title>YouTube +</title>
  <defs>{"".join(defs)}</defs>
  <rect width="{S}" height="{S}" fill="{BASE}"/>{"".join(rects)}
  <rect width="{S}" height="{S}" fill="url(#v)"/>
  <g transform="translate({t:.2f} {t:.2f}) scale({s:.4f})">{logo_group()}</g>
</svg>
"""


def tvos_catalog(out):
    """tvOS asset catalog that is a drop-in replacement for the Assets.car in
    the YouTube 4.54.01 tvOS IPA.

    That Assets.car (xcrun assetutil --info) holds only: AppIconSmall
    (2-layer image stack, 400x240 @1x/@2x), TopShelfImage (1920x720),
    Top Shelf Image Wide (2320x720) and LaunchImage (1920x1080 @1x,
    3840x2160 @2x), referenced by name from Info.plist. We emit exactly those
    names so Info.plist needs no change.

    Icon: E1 (front layer = logo + wordmark, back layer = background, so tvOS
    parallax moves the logo over the gradient). Top Shelf: T1c, @1x and @2x.
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
        for scale in (1, 2):
            w, h = 400 * scale, 240 * scale
            fn = f"{layer.lower()}_{w}x{h}.png"
            iset.mkdir(parents=True, exist_ok=True)
            if layer == "Front":
                e1_layout(400, 240, scale, canvas=Image.new("RGBA", (w, h), (0, 0, 0, 0))).save(iset / fn, optimize=True)
            else:
                save(background(400, 240, scale, wide=False), iset / fn)
            imgs.append({"filename": fn, "idiom": "tv", "scale": f"{scale}x"})
        contents(iset, {"images": imgs, "info": INFO})

    for name, (w, h) in (("TopShelfImage", (1920, 720)), ("Top Shelf Image Wide", (2320, 720))):
        iset = out / f"{name}.imageset"
        imgs = []
        for mult in (1, 2):
            fn = f"topshelf_{w * mult}x{h * mult}.png"
            save(t1c_layout(w, h, mult), iset / fn)
            imgs.append({"filename": fn, "idiom": "tv", "scale": f"{mult}x"})
        contents(iset, {"images": imgs, "info": INFO})

    li = out / "LaunchImage.launchimage"
    imgs = []
    for mult in (1, 2):
        save(t1c_layout(1920, 1080, mult), li / f"launch_{1920 * mult}x{1080 * mult}.png")
    for minver, mults in (("11.0", (1, 2)), ("9.0", (1,))):
        for mult in mults:
            imgs.append({"orientation": "landscape", "idiom": "tv", "extent": "full-screen",
                         "minimum-system-version": minver, "filename": f"launch_{1920 * mult}x{1080 * mult}.png",
                         "scale": f"{mult}x"})
    contents(li, {"images": imgs, "info": INFO})


def ios_catalog(out, icon):
    if out.exists():
        shutil.rmtree(out)
    contents(out, {"info": INFO})
    iset = out / "AppIcon.appiconset"
    # Single-size 1024 universal icon (Xcode 14+) plus legacy sizes for older tools.
    entries = [{"filename": "icon_1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}]
    save(icon, iset / "icon_1024.png")
    legacy = [("iphone", 20, (2, 3)), ("iphone", 29, (2, 3)), ("iphone", 40, (2, 3)), ("iphone", 60, (2, 3)),
              ("ipad", 20, (1, 2)), ("ipad", 29, (1, 2)), ("ipad", 40, (1, 2)), ("ipad", 76, (1, 2)), ("ipad", 83.5, (2,))]
    for idiom, pt, scales in legacy:
        for sc in scales:
            px = int(round(pt * sc))
            fn = f"icon_{px}.png"
            if not (iset / fn).exists():
                save(icon.resize((px, px), Image.LANCZOS), iset / fn)
            ptxt = f"{pt:g}"
            entries.append({"filename": fn, "idiom": idiom, "scale": f"{sc}x", "size": f"{ptxt}x{ptxt}"})
    contents(iset, {"images": entries, "info": INFO})


def main():
    icon = square_icon(1024)
    sq = lambda px: icon if px == 1024 else icon.resize((px, px), Image.LANCZOS)
    write(ICONS / "youtube-plus.svg", svg_e1_square())
    write(ICONS / "youtube-plus-logo.svg", svg_square(None))
    save(sq(1024), ROOT / "icon-preview.png")
    for px in (1024, 512, 256, 192, 180, 128, 64, 32, 16):
        save(sq(px), ICONS / "png" / f"youtube-plus-{px}.png")
    png(svg_square(None), 1024, 1024, ICONS / "png" / "youtube-plus-logo-1024.png")
    # The approved 16:10 tvOS icon artwork and Top Shelf, for reference / store listings.
    save(e1_layout(1280, 768), ICONS / "png" / "youtube-plus-tvos-1280x768.png")
    save(t1c_layout(1920, 720), ICONS / "png" / "youtube-plus-topshelf-1920x720.png")

    # tvOS (Apple TV) asset catalog consumed by patcher.py --tvos-icons.
    tvos_catalog(ROOT / "platforms" / "tvos" / "Assets.xcassets")
    # iOS asset catalog (for a re-signed iOS build, see platforms/ios/README.md).
    ios_catalog(ROOT / "platforms" / "ios" / "Assets.xcassets", icon)

    # Tizen: square icon (512 recommended, 1024 accepted) + 16:9 tile.
    tz = ROOT / "platforms" / "tizen"
    save(sq(512), tz / "icon.png")
    save(sq(1024), tz / "icon_1024.png")
    wide = t1c_layout(1920, 1080)
    save(wide, tz / "icon_16b9.png")

    # webOS: names/sizes as used by webosbrew/youtube-webos appinfo.json.
    wo = ROOT / "platforms" / "webos" / "assets"
    for name, px in (("icon.png", 80), ("mediumLargeIcon.png", 115), ("largeIcon.png", 130), ("extraLargeIcon.png", 192)):
        save(sq(px), wo / name)
    save(wide, wo / "splashBackground.png")
    save(wide, wo / "imageForRecents.png")
    png(svg_square(None, badge=False), 33, 33, wo / "playIcon.png")

    # Web: favicon + PWA/manifest icons.
    web = ROOT / "platforms" / "web" / "icons"
    for px in (16, 32, 48, 180, 192, 512):
        save(sq(px), web / f"icon-{px}.png")
    ico = Image.open(web / "icon-48.png")
    ico.save(web / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    shutil.copy(ICONS / "youtube-plus.svg", web / "icon.svg")
    print("icons written")


if __name__ == "__main__":
    main()
