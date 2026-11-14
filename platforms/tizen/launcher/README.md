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
