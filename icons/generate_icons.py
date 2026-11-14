#!/usr/bin/env python3
"""Generate every YouTube + icon from one SVG master.

Original artwork in the general style of YouTube's app icons (red rounded
"play button" with a white triangle), plus a red "+" badge with a white ring,
in the approved "E2" style: logo filled with an iridescent pastel gradient on
solid black; Top Shelf layout "T1c".
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
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

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
# "E2" artwork (approved Nov 13 2026): solid black background, logo filled with
# the iridescent pastel gradient (white play triangle, white badge ring and "+"),
# soft coloured glow, white "YouTube +" wordmark in Google Sans Bold.
# Rasterised with numpy/Pillow (a smooth mesh gradient is not expressible in SVG).
# ---------------------------------------------------------------------------
FONT_BOLD = ICONS / "fonts" / "GoogleSans-Bold.ttf"     # OFL, static instance of google/fonts Google Sans
FONT_MEDIUM = ICONS / "fonts" / "GoogleSans-Medium.ttf"
BLACK = (0, 0, 0, 255)
# Gradient "mesh" over the logo's bounding box:
# (x, y as 0..1, radius as a fraction of the box width, colour, strength)
BLOBS = [(0.10, 0.20, 0.26, "#7F55FF", 0.95), (0.75, 0.10, 0.26, "#4FB6FF", 0.95),
         (0.95, 0.75, 0.24, "#3FE0A8", 0.90), (0.08, 0.92, 0.22, "#FFC94D", 0.90),
         (0.50, 1.00, 0.24, "#FF6FA0", 0.95)]
BASE = "#9C7BFF"
SATURATION = 1.25      # a touch richer than the old E1 background so it pops on black

# Logo geometry (1024 grid, same as logo_group()).
_G = '<g transform="translate(-35 57)">{}</g>'
_FILL = ('<rect x="182" y="282" width="660" height="460" rx="138" ry="138" fill="#FFFFFF"/>'
         '<circle cx="780" cy="300" r="132" fill="#FFFFFF"/>')
_FILL_NO_BADGE = '<rect x="182" y="282" width="660" height="460" rx="138" ry="138" fill="#FFFFFF"/>'
_WHITE = ('<path d="M 440 404 L 440 620 L 626 512 Z" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="26" stroke-linejoin="round"/>'
          '<circle cx="780" cy="300" r="132" fill="none" stroke="#FFFFFF" stroke-width="32"/>'
          '<rect x="712" y="282" width="136" height="36" rx="18" fill="#FFFFFF"/>'
          '<rect x="762" y="232" width="36" height="136" rx="18" fill="#FFFFFF"/>')
_WHITE_NO_BADGE = '<path d="M 440 404 L 440 620 L 626 512 Z" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="26" stroke-linejoin="round"/>'


def _rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def gradient(w, h):
    """The iridescent gradient at w x h (blob radii relative to the width)."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    img = np.ones((h, w, 3), np.float32) * _rgb(BASE)
    for x, y, r, col, k in BLOBS:
        d2 = (xx - x * w) ** 2 + (yy - y * h) ** 2
        wgt = (np.exp(-d2 / (2 * (r * w) ** 2)) * k)[..., None]
        img = img * (1 - wgt) + _rgb(col) * wgt
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")
    return ImageEnhance.Color(im).enhance(SATURATION).convert("RGBA")


def _svg_layer(body, size):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{_G.format(body)}</svg>'
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size))).convert("RGBA")


def logo_image(vis_h, badge=True):
    """Gradient logo with its visible box (746x590 units of the 1024 grid) vis_h px tall.
    Returns (image, alpha bbox, y of the play button's centre). The glow is separate
    (with_glow), so the image's alpha is the crisp logo shape."""
    size = int(round(1024 * vis_h / 590))
    mask = _svg_layer(_FILL if badge else _FILL_NO_BADGE, size)
    x0, y0, x1, y1 = mask.getbbox()
    fill = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    fill.paste(gradient(x1 - x0, y1 - y0), (x0, y0))
    fill.putalpha(mask.split()[-1])
    fill.alpha_composite(_svg_layer(_WHITE if badge else _WHITE_NO_BADGE, size))
    a = np.array(fill)[:, :, 3]
    ys, xs = np.nonzero(a > 128)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    col = np.nonzero(a[:, x0 + int((x1 - x0) * 0.1)] > 128)[0]     # left edge: button only
    return fill, (x0, x1, y0, y1), (col.min() + col.max()) / 2


def font(px, bold=True):
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT_MEDIUM), max(1, int(round(px))))


def with_glow(canvas, layer, vis_h, opacity=0.35):
    """Soft glow in the logo's own colours (a drop shadow would vanish on black).
    Blur is 10% of the logo height, as in the approved E2 preview."""
    g = layer.filter(ImageFilter.GaussianBlur(max(0.1 * vis_h, 0.1)))
    g.putalpha(g.split()[-1].point(lambda v: int(v * opacity)))
    canvas.alpha_composite(g)
    canvas.alpha_composite(layer)
    return canvas


def black(w, h):
    return Image.new("RGBA", (w, h), BLACK)


def e2_layout(w, h, scale=1, canvas=None):
    """The E2 icon: logo centred at 36% height, wordmark centred below. Reference 1280x768.
    canvas=None draws on black; pass a transparent image for a parallax front layer."""
    W, H = int(w * scale), int(h * scale)
    k = H / 768
    c = black(W, H) if canvas is None else canvas
    vis_h = 0.52 * H
    im, _, _ = logo_image(vis_h)
    L = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    L.alpha_composite(im, (int(W / 2 - im.width / 2), int(H * 0.36 - im.height / 2)))
    with_glow(c, L, vis_h)
    f = font(116 * k)
    x = W / 2 - f.getlength("YouTube +") / 2
    ImageDraw.Draw(c).text((x, H * 0.865), "YouTube +", font=f, fill="#FFFFFF", anchor="ls")
    return c


def t1c_layout(w, h, scale=1):
    """Top Shelf "T1c" on black: gradient logo + wordmark as one group centred
    horizontally, wordmark vertically centred on the play button. Reference 1920x720."""
    W, H = int(w * scale), int(h * scale)
    k = H / 720
    c = black(W, H)
    vis_h = 250 * k
    im, (x0, x1, y0, y1), bcy = logo_image(vis_h)
    f = font(165 * k)
    d = ImageDraw.Draw(c)
    tb = d.textbbox((0, 0), "YouTube +", font=f, anchor="ls")
    gap, lw = 72 * k, x1 - x0 + 1
    gx = (W - (lw + gap + tb[2] - tb[0])) / 2
    L = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    L.alpha_composite(im, (int(gx - x0), int(H / 2 - bcy)))
    with_glow(c, L, vis_h)
    d.text((gx + lw + gap - tb[0], H / 2 - tb[1] / 2), "YouTube +", font=f, fill="#FFFFFF", anchor="ls")
    return c


def square_icon(px):
    """Square E2 icon (gradient logo on black, no wordmark: every platform labels the icon)."""
    S = 1024
    c = black(S, S)
    vis_h = 0.55 * S
    im, _, _ = logo_image(vis_h)
    L = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    L.alpha_composite(im, (int(S / 2 - im.width / 2), int(S / 2 - im.height / 2)))
    with_glow(c, L, vis_h)
    return c if px == S else c.resize((px, px), Image.LANCZOS)


# Centre of the play button (the gradient rounded rectangle) on the 1024 grid, after
# the translate(-35 57) in logo_group(): rect 182..842 x 282..742.
BUTTON_CX, BUTTON_CY = 182 + 660 / 2 - 35, 282 + 460 / 2 + 57


def square_icon_centered(px):
    """Square E2 icon with the play button (not the button + badge box) exactly in the
    centre; the "+" badge overhangs towards the top-right corner. Used for Samsung
    Tizen, whose launcher tile made the box-centred icon look off-centre."""
    S = 1024
    c = black(S, S)
    vis_h = 0.55 * S                       # same logo size as square_icon()
    im, _, _ = logo_image(vis_h)
    k = im.width / 1024
    L = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    L.alpha_composite(im, (int(round(S / 2 - BUTTON_CX * k)), int(round(S / 2 - BUTTON_CY * k))))
    with_glow(c, L, vis_h)
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


def svg_e2_square(bg="#000000"):
    """Vector approximation of the square E2 icon (for icon.svg / favicons in browsers):
    black square, gradient blobs as radial gradients clipped to the logo shape.
    The PNGs are the reference rendering."""
    S = 1024
    # Fill bounding box in logo_group coordinates (button + badge circle, before translate).
    bx0, by0, bx1, by1 = 182, 168, 912, 742
    bw, bh = bx1 - bx0, by1 - by0
    defs, rects = [], []
    for i, (x, y, r, col, k) in enumerate(BLOBS):
        sig = r * bw
        stops = "".join(f'<stop offset="{t / 3:.3f}" stop-color="{col}" stop-opacity="{k * np.exp(-t * t / 2):.3f}"/>'
                        for t in (0, 0.5, 1, 1.5, 2, 2.5, 3))
        defs.append(f'<radialGradient id="b{i}" gradientUnits="userSpaceOnUse" cx="{bx0 + x * bw:.1f}" cy="{by0 + y * bh:.1f}" r="{3 * sig:.1f}">{stops}</radialGradient>')
        rects.append(f'<rect x="{bx0}" y="{by0}" width="{bw}" height="{bh}" fill="url(#b{i})"/>')
    clip = ('<clipPath id="c"><rect x="182" y="282" width="660" height="460" rx="138" ry="138"/>'
            '<circle cx="780" cy="300" r="132"/></clipPath>')
    s = 0.55 * S / 590
    t = 512 - 512 * s
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">
  <title>YouTube +</title>
  <defs>{"".join(defs)}{clip}</defs>
  {"" if bg is None else f'<rect width="{S}" height="{S}" fill="{bg}"/>'}
  <g transform="translate({t:.2f} {t:.2f}) scale({s:.4f})"><g transform="translate(-35 57)">
    <g clip-path="url(#c)"><rect x="{bx0}" y="{by0}" width="{bw}" height="{bh}" fill="{BASE}"/>{"".join(rects)}</g>
    {_WHITE}
  </g></g>
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

    Icon: E2 (front layer = gradient logo + wordmark, back layer = solid black,
    so tvOS parallax moves the logo over the black). Top Shelf: T1c on black, @1x and @2x.
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
                e2_layout(400, 240, scale, canvas=Image.new("RGBA", (w, h), (0, 0, 0, 0))).save(iset / fn, optimize=True)
            else:
                save(black(w, h), iset / fn)
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
    write(ICONS / "youtube-plus.svg", svg_e2_square())
    write(ICONS / "youtube-plus-logo.svg", svg_e2_square(None))
    save(sq(1024), ROOT / "icon-preview.png")
    for px in (1024, 512, 256, 192, 180, 128, 64, 32, 16):
        save(sq(px), ICONS / "png" / f"youtube-plus-{px}.png")
    logo, _, _ = logo_image(0.55 * 1024)
    t = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    t.alpha_composite(logo, ((1024 - logo.width) // 2, (1024 - logo.height) // 2))
    t.save(ICONS / "png" / "youtube-plus-logo-1024.png", optimize=True)
    # The approved 16:10 tvOS icon artwork and Top Shelf, for reference / store listings.
    save(e2_layout(1280, 768), ICONS / "png" / "youtube-plus-tvos-1280x768.png")
    save(t1c_layout(1920, 720), ICONS / "png" / "youtube-plus-topshelf-1920x720.png")

    # tvOS (Apple TV) asset catalog consumed by patcher.py --tvos-icons.
    tvos_catalog(ROOT / "platforms" / "tvos" / "Assets.xcassets")
    # iOS asset catalog (for a re-signed iOS build, see platforms/ios/README.md).
    ios_catalog(ROOT / "platforms" / "ios" / "Assets.xcassets", icon)

    # Tizen: square icon (512 recommended, 1024 accepted), play button centred on the
    # canvas (see square_icon_centered), + 16:9 tile.
    tz = ROOT / "platforms" / "tizen"
    tz_icon = square_icon_centered(1024)
    save(tz_icon.resize((512, 512), Image.LANCZOS), tz / "icon.png")
    save(tz_icon, tz / "icon_1024.png")
    wide = t1c_layout(1920, 1080)
    save(wide, tz / "icon_16b9.png")

    # webOS: names/sizes as used by webosbrew/youtube-webos appinfo.json.
    wo = ROOT / "platforms" / "webos" / "assets"
    for name, px in (("icon.png", 80), ("mediumLargeIcon.png", 115), ("largeIcon.png", 130), ("extraLargeIcon.png", 192)):
        save(sq(px), wo / name)
    save(wide, wo / "splashBackground.png")
    save(wide, wo / "imageForRecents.png")
    play, (px0, px1, py0, py1), _ = logo_image(33 * 4 * 590 / 460, badge=False)
    play.crop((px0, py0, px1 + 1, py1 + 1)).resize((33, 23), Image.LANCZOS).crop((0, -5, 33, 28)).save(wo / "playIcon.png")

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
