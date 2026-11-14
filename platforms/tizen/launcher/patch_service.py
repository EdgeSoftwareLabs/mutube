#!/usr/bin/env python3
"""Patch TizenTube Cobalt v2.1.1's compiled service (service/dist/index.js) for the
YouTube + launcher. Approach from cgrkz/tizentube-cobalt-coldstart-fix (patch_fix.py,
GPL-3.0), rewritten without its diagnostic-log dependency:

  1. The proxy on :8101 starts listening immediately. Stock code first generated two
     RSA-2048 certificates (1-2 s each on a TV) and only then listened, so a player that
     started at the same time found nothing on 8101 -> "Network error occurred".
  2. The CA is loaded lazily, and the www.youtube.com / youtube.com certificates are made
     on first use and cached in /home/owner/share/ytplus-cert-<host>.json (re-made after
     300 days or when TizenTube's CA file is newer).
  3. GET http://127.0.0.2:8101/__ytplus/health answers 200 "ok" so the launcher can tell
     the proxy is up (the stock proxy has no local route; a bare GET just fails).
  4. A listen error (e.g. EADDRINUSE because another copy already serves 8101) is caught
     instead of crashing the service into an auto-restart loop.

Every replacement must match exactly once, or the build stops.
usage: patch_service.py <dir containing service/dist/index.js> [label]
"""
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
label = sys.argv[2] if len(sys.argv) > 2 else "YouTube + launcher"
js_path = root / "service" / "dist" / "index.js"
js = js_path.read_text(encoding="utf-8")


def once(old, new):
    global js
    n = js.count(old)
    if n != 1:
        sys.exit(f"patch_service: expected exactly 1 match, found {n}: {old[:100]!r}")
    js = js.replace(old, new)


# 1. Lazy CA.
once("  var caCertificate = forge.pki.certificateFromPem(fs.readFileSync('/home/owner/share/tizentube-ca.crt', 'utf8'));\n"
     "  var caPrivateKey = forge.pki.privateKeyFromPem(fs.readFileSync('/home/owner/share/tizentube-ca.key', 'utf8'));\n"
     "  function createHostCertificate(hostname) {\n",
     "  var caCertificate = null;\n"
     "  var caPrivateKey = null;\n"
     "  function loadCa() {\n"
     "    if (caCertificate) return;\n"
     "    caCertificate = forge.pki.certificateFromPem(fs.readFileSync('/home/owner/share/tizentube-ca.crt', 'utf8'));\n"
     "    caPrivateKey = forge.pki.privateKeyFromPem(fs.readFileSync('/home/owner/share/tizentube-ca.key', 'utf8'));\n"
     "  }\n"
     "  function createHostCertificate(hostname) {\n"
     "    loadCa();\n")

# 2. Cached, on-demand host certificates instead of eager generation.
once("  var ytCertWWW = createHostCertificate('www.youtube.com');\n"
     "  var ytCert = createHostCertificate('youtube.com');\n",
     "  var __ytpCerts = {};\n"
     "  function hostCert(hostname) {\n"
     "    if (__ytpCerts[hostname]) return __ytpCerts[hostname];\n"
     "    var file = '/home/owner/share/ytplus-cert-' + hostname + '.json';\n"
     "    var caFile = '/home/owner/share/tizentube-ca.crt';\n"
     "    try {\n"
     "      var st = fs.statSync(file);\n"
     "      var fresh = Date.now() - st.mtimeMs < 300 * 24 * 60 * 60 * 1000;\n"
     "      var newerThanCa = !fs.existsSync(caFile) || st.mtimeMs >= fs.statSync(caFile).mtimeMs;\n"
     "      if (fresh && newerThanCa) {\n"
     "        var saved = JSON.parse(fs.readFileSync(file, 'utf8'));\n"
     "        if (saved && saved.key && saved.cert) return __ytpCerts[hostname] = saved;\n"
     "      }\n"
     "    } catch (e) {}\n"
     "    var made = createHostCertificate(hostname);\n"
     "    try { fs.writeFileSync(file, JSON.stringify(made)); } catch (e) {}\n"
     "    return __ytpCerts[hostname] = made;\n"
     "  }\n")
once("    var tlsServer = new tls.Server(hostname === 'www.youtube.com' ? ytCertWWW : ytCert);\n",
     "    var tlsServer = new tls.Server(hostCert(hostname === 'www.youtube.com' ? 'www.youtube.com' : 'youtube.com'));\n")

# 3. Health route for the launcher.
once("  var proxyServer = http.createServer(function (request, response) {\n"
     "    var targetUrl = url.parse(request.url);\n",
     "  var proxyServer = http.createServer(function (request, response) {\n"
     "    if (request.url.indexOf('/__ytplus/health') === 0) {\n"
     "      response.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });\n"
     f"      return response.end('ok {label}');\n"
     "    }\n"
     "    var targetUrl = url.parse(request.url);\n")

# 1 + 4. Listen first, catch listen errors, then warm the certificates in the background.
once("  proxyServer.listen(proxyPort, '0.0.0.0');\n}\nmodule.exports = startServer;",
     "  proxyServer.on('error', function (e) { try { console.error('ytplus proxy: ' + (e && e.code || e)); } catch (x) {} });\n"
     "  proxyServer.listen(proxyPort, '0.0.0.0', function () {\n"
     "    setTimeout(function () {\n"
     "      try { hostCert('www.youtube.com'); hostCert('youtube.com'); } catch (e) {}\n"
     "    }, 0);\n"
     "  });\n}\nmodule.exports = startServer;")

js_path.write_text(js, encoding="utf-8")
print("patched", js_path)
