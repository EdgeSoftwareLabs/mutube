#!/bin/zsh
# Sign the YouTube + Tizen apps with a Tizen Studio profile and install them on a TV.
#
#   tizen-install.sh <tv-ip> [--lan] [--profile NAME] [--launch] [--trees FILE]
#
#   --lan       player proxy + launcher readiness check use http://<tv-ip>:8101
#               (default: http://127.0.0.2:8101). Give the TV a DHCP reservation first.
#   --profile   signing profile (default YTPlus-Partner: our author key + Apps2Samsung
#               Partner distributor cert; lists DUIDs 2DCDNDAH34TXS, P7CNQVDG2KDXI).
#               Use Samsung-TV (Public; lists SHCEPZPTUI3LK too) for Tizen 6 TVs.
#   --launch    open the launcher afterwards and wait for /__ytplus/health on 8101.
#   --trees     unsigned trees tarball from platforms/tizen/launcher/build.py
#               (default ~/Grokbot/youtube-plus/tizen-launcher-trees.tgz).
# Both apps are updated in place (same package ids and author key), so app data is kept.
set -e
[ "$(scutil --get ComputerName)" = "Brandon’s Mac mini" ] || { echo "wrong machine"; exit 9; }
IP=""; LAN=0; PROFILE=YTPlus-Partner; LAUNCH=0; TREES=~/Grokbot/youtube-plus/tizen-launcher-trees.tgz
while [ $# -gt 0 ]; do
  case "$1" in
    --lan) LAN=1;; --launch) LAUNCH=1;;
    --profile) PROFILE="$2"; shift;; --trees) TREES="$2"; shift;;
    -*) echo "unknown option $1"; exit 2;; *) IP="$1";;
  esac; shift
done
[[ "$IP" =~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' ]] || { echo "usage: $0 <tv-ip> [--lan] [--profile NAME] [--launch]"; exit 2; }
T=~/Applications/tizen-studio/tools/ide/bin/tizen; S=~/Applications/tizen-studio/tools/sdb
W=$(mktemp -d); O=~/Grokbot/youtube-plus/out/tizen-launcher/$IP; mkdir -p $O
tar -xzf "$TREES" -C $W
HOST=127.0.0.2; [ $LAN = 1 ] && HOST=$IP
sed -i '' -E "s#--proxy=http://[^ \"]+:8101#--proxy=http://$HOST:8101#" $W/tizen-launcher/player/config.xml
sed -i '' -E "s#var HEALTH = \"http://[^\"]+:8101/__ytplus/health\";#var HEALTH = \"http://$HOST:8101/__ytplus/health\";#" $W/tizen-launcher/launcher/index.html
grep -q -- "--proxy=http://$HOST:8101" $W/tizen-launcher/player/config.xml
grep -q "http://$HOST:8101/__ytplus/health" $W/tizen-launcher/launcher/index.html
echo "proxy: http://$HOST:8101   profile: $PROFILE"
for d in player launcher; do
  (cd $W/tizen-launcher/$d && $T package -t wgt -s "$PROFILE" >/dev/null)
done
mv $W/tizen-launcher/player/*.wgt $O/YouTubePlusPlayer.wgt
mv "$W/tizen-launcher/launcher/YouTube +.wgt" $O/YouTubePlusLauncher.wgt
rm -rf $W
# Connect (restart the sdb server once if the TV refuses).
if ! $S devices | grep -q "^$IP:26101"; then
  $S connect $IP >/dev/null 2>&1 || true
  if ! $S devices | grep -q "^$IP:26101"; then $S kill-server >/dev/null 2>&1; sleep 2; $S connect $IP >/dev/null 2>&1 || true; fi
fi
$S devices | grep -q "^$IP:26101" || { echo "sdb cannot connect to $IP (Developer Mode on, host IP = this Mac?)"; exit 3; }
DUID="$($S -s $IP:26101 shell 0 getduid | tr -d '\r\n ')"
echo "DUID: $DUID"
# The distributor certificate must list this TV's DUID, or the TV refuses the install.
python3 - "$O/YouTubePlusLauncher.wgt" "$DUID" "$PROFILE" <<'PY' || exit 5
import base64, re, sys, zipfile
x = zipfile.ZipFile(sys.argv[1]).read("signature1.xml").decode()
der = base64.b64decode("".join(re.findall(r"<X509Certificate>(.*?)</X509Certificate>", x, re.S)[0].split()))
ids = set(re.findall(rb"deviceid=([A-Z0-9]{13})", der))
if sys.argv[2].encode() not in ids:
    sys.exit("profile %s does not list DUID %s (it lists %s); use --profile Samsung-TV or add the DUID"
             % (sys.argv[3], sys.argv[2], ", ".join(sorted(i.decode() for i in ids))))
PY
for w in YouTubePlusPlayer.wgt YouTubePlusLauncher.wgt; do
  $T install -n $w -s $IP:26101 -- $O | grep -E "install completed|rror|failed" || true
done
if [ $LAUNCH = 1 ]; then
  $S -s $IP:26101 shell 0 execute YTPlusLnch.YouTubePlus | tail -1
  for i in $(seq 1 60); do
    if curl -s -m1 "http://$IP:8101/__ytplus/health" >/dev/null; then echo "8101 answers after ~$((i/2)) s"; exit 0; fi
    sleep 0.5
  done
  echo "8101 did not answer; log: http://$IP:8102/"; exit 4
fi
