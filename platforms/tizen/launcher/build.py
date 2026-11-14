#!/usr/bin/env python3
"""Build the two unsigned widget trees for the Tizen launcher fix.

  build/tizen-launcher/player    xvvl3S1TT1  "YouTube + Player"  (TizenTube Cobalt 2.1.1,
                                 service removed, renamed, centred icon)
  build/tizen-launcher/launcher  YTPlusLnch  "YouTube +"         (launcher page + the only
                                 proxy service, patched by patch_service.py)

usage: build.py [path to TizenTubeCobalt.wgt v2.1.1]   (downloaded if omitted)
Sign/package each tree with: tizen package -t wgt -s <profile> -- <tree>
"""
import hashlib
import pathlib
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT / "build" / "tizen-launcher"
URL = "https://github.com/reisxd/TizenTube/releases/download/v2.1.1/TizenTubeCobalt.wgt"
SHA256 = "d5ebcf5b61e907912d5200b033f0d366717cb952c9f543a6332d36bef771b3b5"
PLAYER_VERSION = "2.1.2"      # upstream 2.1.1 + our changes; must not go below the installed 2.1.1
ICON = ROOT / "platforms" / "tizen" / "icon.png"     # centred E2 icon, 512x512


def once(s, old, new):
    n = s.count(old)
    if n != 1:
        sys.exit(f"build.py: expected exactly 1 match, found {n}: {old[:90]!r}")
    return s.replace(old, new)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    wgt = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else OUT / "TizenTubeCobalt-2.1.1.wgt"
    if not wgt.exists():
        urllib.request.urlretrieve(URL, wgt)
    if hashlib.sha256(wgt.read_bytes()).hexdigest() != SHA256:
        sys.exit("TizenTubeCobalt.wgt checksum mismatch (expected the official v2.1.1)")
    up = OUT / "upstream"
    with zipfile.ZipFile(wgt) as z:
        z.extractall(up)
    license_txt = (ROOT / "NOTICE").read_text(encoding="utf-8")

    # ---- player: upstream app, no service, renamed, centred icon -------------------
    pl = OUT / "player"
    pl.mkdir()
    cfg = (up / "config.xml").read_text(encoding="utf-8")
    cfg = once(cfg, 'version="2.1.1"', f'version="{PLAYER_VERSION}"')
    cfg = once(cfg, "<name>TizenTube</name>", "<name>YouTube + Player</name>")
    cfg = once(cfg, '    <icon src="icon_16b9.png" width="1920" height="1080"/>\n'
                    '    <icon src="icon.png" width="1024" height="1024"/>\n',
               '    <icon src="icon.png" width="512" height="512"/>\n')
    cfg = once(cfg, '    <feature name="http://tizen.org/feature/web.service"/>\n', "")
    cfg = re.sub(r'\s*<tizen:service id="xvvl3S1TT1\.StandaloneService".*?</tizen:service>', "", cfg, flags=re.S)
    assert "tizen:service" not in cfg and "StandaloneService" not in cfg
    cfg = once(cfg, "<widget ", "<!-- YouTube + Player: TizenTube Cobalt 2.1.1 (GPL-3.0, Reis Can) without its own service.\n"
                               "     The proxy on 127.0.0.2:8101 is run by the \"YouTube +\" launcher (YTPlusLnch);\n"
                               "     see platforms/tizen/launcher/README.md in github.com/mistermassacre/mutube. -->\n<widget ")
    (pl / "config.xml").write_text(cfg, encoding="utf-8")
    shutil.copy(HERE / "player" / "index.html", pl / "index.html")
    shutil.copy(ICON, pl / "icon.png")
    (pl / "NOTICE").write_text(license_txt, encoding="utf-8")

    # ---- launcher: our page + the only (patched) proxy service ---------------------
    ln = OUT / "launcher"
    (ln / "service" / "dist").mkdir(parents=True)
    shutil.copy(up / "service" / "dist" / "index.js", ln / "service" / "dist" / "index.js")
    subprocess.run([sys.executable, str(HERE / "patch_service.py"), str(ln)], check=True)
    subprocess.run(["node", "--check", str(ln / "service" / "dist" / "index.js")], check=True)
    for name in ("config.xml", "index.html"):
        shutil.copy(HERE / "launcher" / name, ln / name)
    shutil.copy(ICON, ln / "icon.png")
    (ln / "NOTICE").write_text(license_txt, encoding="utf-8")
    shutil.rmtree(up)
    print("built", pl, "and", ln)


if __name__ == "__main__":
    main()
