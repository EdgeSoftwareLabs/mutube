#!/usr/bin/env python3
"""Build the two unsigned widget trees for the Tizen launcher fix.

  build/tizen-launcher/player    xvvl3S1TT1  "YT+ Helper" (grey)  (TizenTube Cobalt 2.1.1,
                                 service removed, renamed, greyscale YouTube + icon)
  build/tizen-launcher/launcher  YTPlusLnch  "YouTube +"         (launcher page + the only
                                 proxy service, patched by patch_service.py, serving the
                                 bundled TizenTube 1.15.2 + youtube-plus.js user script)

usage: build.py [--proxy-host HOST] [path to TizenTubeCobalt.wgt v2.1.1]   (downloaded if omitted)
  --proxy-host HOST   point the player's proxy (and the launcher's readiness check) at
                      http://HOST:8101 instead of 127.0.0.2:8101, e.g. the TV's own LAN IP
                      (the proxy listens on 0.0.0.0). Use a DHCP reservation for that IP.
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
PLAYER_VERSION = "2.1.6"      # upstream 2.1.1 + our changes; must not go below the installed 2.1.1
PLAYER_NAME = "YT+ Helper"    # deliberately plain: open "YouTube +" instead
ICON = ROOT / "platforms" / "tizen" / "icon.png"     # centred E2 icon, 512x512
HELPER_ICON = ROOT / "platforms" / "tizen" / "icon_helper.png"   # greyscale of ICON (alpha kept), 512x512
# The user script the proxy serves: TizenTube pinned + our youtube-plus.js (the stock 2.1.1
# service loads TizenTube's unpinned latest from jsDelivr instead).
TIZENTUBE_VERSION = "1.15.2"
TT_URL = f"https://cdn.jsdelivr.net/npm/@foxreis/tizentube@{TIZENTUBE_VERSION}/dist/userScript.js"
TT_SHA256 = "7a092351e0e348507ef9c97da8833d5f6717de628517f5299053b3c2073f1d69"
YTPLUS = ROOT / "youtube-plus.js"



def once(s, old, new):
    n = s.count(old)
    if n != 1:
        sys.exit(f"build.py: expected exactly 1 match, found {n}: {old[:90]!r}")
    return s.replace(old, new)


def main():
    args = sys.argv[1:]
    host = "127.0.0.2"
    if args[:1] == ["--proxy-host"]:
        host, args = args[1], args[2:]
        if not re.fullmatch(r"[A-Za-z0-9.-]+", host):
            sys.exit("bad --proxy-host")
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    wgt = pathlib.Path(args[0]) if args else OUT / "TizenTubeCobalt-2.1.1.wgt"
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
    cfg = once(cfg, "<name>TizenTube</name>", f"<name>{PLAYER_NAME}</name>")
    cfg = once(cfg, '    <icon src="icon_16b9.png" width="1920" height="1080"/>\n'
                    '    <icon src="icon.png" width="1024" height="1024"/>\n',
               '    <icon src="icon.png" width="512" height="512"/>\n')
    cfg = once(cfg, '    <feature name="http://tizen.org/feature/web.service"/>\n', "")
    cfg = re.sub(r'\s*<tizen:service id="xvvl3S1TT1\.StandaloneService".*?</tizen:service>', "", cfg, flags=re.S)
    assert "tizen:service" not in cfg and "StandaloneService" not in cfg
    cfg = once(cfg, "--proxy=http://127.0.0.2:8101", f"--proxy=http://{host}:8101")
    cfg = once(cfg, "<widget ", "<!-- YouTube + Player: TizenTube Cobalt 2.1.1 (GPL-3.0, Reis Can) without its own service.\n"
                               "     The proxy on 127.0.0.2:8101 is run by the \"YouTube +\" launcher (YTPlusLnch);\n"
                               "     see platforms/tizen/launcher/README.md in github.com/mistermassacre/mutube. -->\n<widget ")
    (pl / "config.xml").write_text(cfg, encoding="utf-8")
    shutil.copy(HERE / "player" / "index.html", pl / "index.html")
    shutil.copy(HELPER_ICON, pl / "icon.png")
    (pl / "NOTICE").write_text(license_txt, encoding="utf-8")

    # ---- launcher: our page + the only (patched) proxy service ---------------------
    ln = OUT / "launcher"
    (ln / "service" / "dist").mkdir(parents=True)
    shutil.copy(up / "service" / "dist" / "index.js", ln / "service" / "dist" / "index.js")
    tt = OUT / f"tizentube-{TIZENTUBE_VERSION}.js"
    urllib.request.urlretrieve(TT_URL, tt)
    if hashlib.sha256(tt.read_bytes()).hexdigest() != TT_SHA256:
        sys.exit(f"TizenTube {TIZENTUBE_VERSION} userScript.js checksum mismatch")
    yp = YTPLUS.read_text(encoding="utf-8")
    ypver = re.search(r"VERSION\s*=\s*['\"]([0-9.]+)", yp)
    bundle = OUT / "ytplus-bundle.js"
    bundle.write_text(f"/* TizenTube {TIZENTUBE_VERSION} (GPL-3.0, https://github.com/reisxd/TizenTube) + YouTube + "
                      f"{ypver.group(1) if ypver else ''} */\n" + tt.read_text(encoding="utf-8") + "\n;\n" + yp, encoding="utf-8")
    subprocess.run([sys.executable, str(HERE / "patch_service.py"), str(ln), "YouTube + launcher", str(bundle)], check=True)
    subprocess.run(["node", "--check", str(ln / "service" / "dist" / "index.js")], check=True)
    shutil.copy(HERE / "launcher" / "config.xml", ln / "config.xml")
    page = (HERE / "launcher" / "index.html").read_text(encoding="utf-8")
    page = once(page, 'var HEALTH = "http://127.0.0.2:8101/__ytplus/health";',
                f'var HEALTH = "http://{host}:8101/__ytplus/health";')
    (ln / "index.html").write_text(page, encoding="utf-8")
    shutil.copy(ICON, ln / "icon.png")
    (ln / "NOTICE").write_text(license_txt, encoding="utf-8")
    shutil.rmtree(up)
    print("built", pl, "and", ln, "proxy", host)


if __name__ == "__main__":
    main()
