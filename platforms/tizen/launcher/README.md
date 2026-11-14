# Tizen launcher fix ("YouTube +" + "YouTube + Player")

Fixes "Network error occurred. Please wait a moment and try again." after a TV restart
with the TizenTube Cobalt build (v2.1.1).

**Cause.** TizenTube Cobalt's `config.xml` opens Samsung's own YouTube player
(`nativeID com.samsung.tv.cobalt-yt`) with `--proxy=http://127.0.0.2:8101`, and that proxy
is a service in the same package. Samsung TVs ignore the service's `on-boot="true"`, and the
app's `index.html` (which would start the service) never runs because the TV opens the native
player directly. After a restart nothing starts the proxy, port 8101 stays closed, and the
player shows the network error. In addition, the stock proxy generated two RSA-2048
certificates before listening (~3-4 s on a TV), racing the player.
(See also cgrkz/tizentube-cobalt-coldstart-fix and TizenTube issues #695, #712.)

**Fix.** Two packages, both signed with our Samsung certificate profile:

| Package | App id | Name | Role |
|---|---|---|---|
| `YTPlusLnch` | `YTPlusLnch.YouTubePlus` | YouTube + | The tile to open. Starts its own `YTPlusLnch.ProxyService` (the only proxy), waits for `http://127.0.0.2:8101/__ytplus/health`, opens the player. |
| `xvvl3S1TT1` | `xvvl3S1TT1.TizenTubeStandalone` | YouTube + Player | TizenTube Cobalt 2.1.1 with its service removed; opens Samsung's player with proxy `127.0.0.2:8101`. Same package id as TizenTube, so it updates the installed app in place. |

`patch_service.py` changes the proxy in the compiled service (`service/dist/index.js`): listen on
8101 immediately; load the CA lazily; make the youtube.com certificates on first use and cache them
in `/home/owner/share/ytplus-cert-<host>.json`; answer `/__ytplus/health`; don't crash on a listen
error. Every replacement must match exactly once.

```bash
python3 platforms/tizen/launcher/build.py            # downloads + checks official TizenTubeCobalt.wgt 2.1.1
tizen package -t wgt -s Samsung-TV -- build/tizen-launcher/player
tizen package -t wgt -s Samsung-TV -- build/tizen-launcher/launcher
tizen install -n <player>.wgt   -s <tv-ip>:26101 -- <dir>
tizen install -n <launcher>.wgt -s <tv-ip>:26101 -- <dir>
```

Open **YouTube +** (not "YouTube + Player") after a restart. Icons: `platforms/tizen/icon.png`
(play button centred). The user script is still TizenTube's from jsDelivr, as in the stock build.
GPL-3.0 (TizenTube by Reis Can).

**Tizen 9/10 (2025+ TVs).** Two things differ there (found on the 2026 Living Room Frame,
QN65LS03HEDXZA, Tizen 10, embedded Node 20):
- A web service only starts through `wrt:service`: the launcher loads
  `import { Service } from 'wrt:service'` in a module script and calls
  `new Service(id).start()` (as Apps2Samsung TV-Store 0.3.9 does). `launchAppControl` reports
  success but the service never runs. Older TVs keep using `launchAppControl`.
- The service file must not declare anything at the top level; the diagnostics bootstrap is
  wrapped in a function (the ncc bundle already is).
- Cobalt may not reach `127.0.0.2` there, so build with `--proxy-host <TV IP>` (the proxy
  listens on 0.0.0.0) and give the TV a DHCP reservation.
- Signed with the `YTPlus-Partner` profile (our author key + the Apps2Samsung Partner distributor
  certificate). Whether Public would also do now that the service starts properly is untested.

**Diagnostics.** The launcher's service serves its start-up log at `http://<tv>:8102/` (start-up
steps, cobalt setup, proxy listen, CONNECT host names, uncaught errors). Setting `REPORT_URL` in
`launcher/index.html` to a LAN listener makes the launcher page POST its own diagnostics.

## Installing from the Mac mini (no Apps2Samsung)

`tizen-install.sh` (a copy lives on the Mac mini at `~/Grokbot/youtube-plus/tizen-install.sh`)
signs the unsigned trees from `build.py` with a Tizen Studio profile and installs both apps over
sdb, updating them in place:

```bash
python3 platforms/tizen/launcher/build.py   # on the box -> build/tizen-launcher, tar to the Mac as
                                            # ~/Grokbot/youtube-plus/tizen-launcher-trees.tgz
~/Grokbot/youtube-plus/tizen-install.sh 192.168.1.232 --lan --launch                  # Living Room (Tizen 10)
~/Grokbot/youtube-plus/tizen-install.sh 192.168.1.159 --profile Samsung-TV --launch   # Bedroom (Tizen 6)
```

`--lan` points the proxy at the TV's own IP; `--profile` picks the signing profile (default
`YTPlus-Partner`); the script refuses to install when the profile's distributor certificate does
not list the TV's DUID, and restarts the sdb server once if the TV refuses to connect. Signed
packages land in `~/Grokbot/youtube-plus/out/tizen-launcher/<tv-ip>/`.
