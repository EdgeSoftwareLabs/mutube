#!/usr/bin/env python3
"""Check generated YouTube + icons match their catalogs and contain no badge markup."""
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IOS = ROOT / "platforms" / "ios" / "Assets.xcassets"
TV = ROOT / "platforms" / "tvos" / "Assets.xcassets"


def png_size(path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path} is not a PNG")
    if data[12:16] != b"IHDR":
        raise SystemExit(f"{path} has no IHDR")
    w, h = struct.unpack(">II", data[16:24])
    return w, h


def check(cond, msg):
    if not cond:
        raise SystemExit(msg)


def catalog_pngs(root):
    found = 0
    for contents in root.rglob("Contents.json"):
        meta = json.loads(contents.read_text())
        for image in meta.get("images", []):
            name = image.get("filename")
            if not name:
                continue
            path = contents.parent / name
            check(path.is_file(), f"missing catalog image {path.relative_to(ROOT)}")
            w, h = png_size(path)
            scale = float(str(image.get("scale", "1x")).rstrip("x") or 1)
            if "size" in image:
                tw, th = (float(p) for p in image["size"].split("x"))
                expect = (int(round(tw * scale)), int(round(th * scale)))
                check((w, h) == expect, f"{path.relative_to(ROOT)} is {w}x{h}, catalog expects {expect[0]}x{expect[1]}")
            else:
                stem = path.stem
                # filenames like topshelf_1920x720 or front_400x240
                dims = stem.split("_")[-1]
                if "x" in dims and dims.replace("x", "").isdigit():
                    ew, eh = (int(p) for p in dims.split("x"))
                    check((w, h) == (ew, eh), f"{path.relative_to(ROOT)} is {w}x{h}, name says {ew}x{eh}")
            found += 1
    check(found > 0, f"no images listed under {root.relative_to(ROOT)}")
    return found


def main():
    n = catalog_pngs(IOS) + catalog_pngs(TV)
    check((IOS / "LaunchBackground.colorset" / "Contents.json").is_file(), "iOS launch color was removed")
    safari = ROOT / "platforms" / "ios" / "YouTubePlusSafariExtension" / "Resources" / "images"
    for name, px in (("icon-48.png", 48), ("icon-96.png", 96), ("icon-128.png", 128)):
        w, h = png_size(safari / name)
        check((w, h) == (px, px), f"Safari {name} is {w}x{h}")
        n += 1
    for path, size in (
        (ROOT / "platforms" / "tizen" / "icon.png", (512, 512)),
        (ROOT / "platforms" / "tizen" / "icon_helper.png", (512, 512)),
        (ROOT / "platforms" / "tizen" / "icon_1024.png", (1024, 1024)),
        (ROOT / "platforms" / "web" / "icons" / "icon-180.png", (180, 180)),
        (ROOT / "platforms" / "web" / "icons" / "icon-512.png", (512, 512)),
        (ROOT / "platforms" / "webos" / "assets" / "icon.png", (80, 80)),
    ):
        check(png_size(path) == size, f"{path.relative_to(ROOT)} size {png_size(path)} != {size}")
        n += 1
    svg = (ROOT / "icons" / "youtube-plus.svg").read_text()
    check('id="badge"' not in svg and 'cx="780"' not in svg, "square SVG still draws the corner badge")
    print(f"icon asset checks passed ({n} images)")


if __name__ == "__main__":
    main()
