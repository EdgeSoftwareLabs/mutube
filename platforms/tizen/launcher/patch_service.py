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

  5. Diagnostics: a tiny log server on 0.0.0.0:8102 starts before anything else in the
     service and serves the last 500 log lines (start-up steps, cobalt setup result,
     proxy listen result, uncaught errors) as plain text, so a TV whose sdb shell and
     file pull are locked down can still be diagnosed from the LAN
     (curl http://<tv>:8102/). Uncaught errors are logged instead of killing the service.

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


# 5. Diagnostics bootstrap, before the webpack bootstrap.
BOOT = (r"""/* YouTube + diagnostics (patch_service.py) */
var __ytpLogBuf = [];
function __ytpLog(m) {
  try {
    __ytpLogBuf.push(new Date().toISOString() + ' ' + m);
    if (__ytpLogBuf.length > 500) __ytpLogBuf.shift();
  } catch (e) {}
}
global.__ytpLog = __ytpLog;
try {
  process.on('uncaughtException', function (e) { __ytpLog('UNCAUGHT ' + (e && e.stack || e)); });
  process.on('unhandledRejection', function (e) { __ytpLog('UNHANDLED ' + (e && e.stack || e)); });
} catch (e) {}
try {
  var __ytpDiag = require('http').createServer(function (q, r) {
    r.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    r.end(__ytpLogBuf.join('\n') + '\n');
  });
  __ytpDiag.on('error', function (e) { __ytpLog('diag server error ' + (e && e.code || e)); });
  __ytpDiag.listen(8102, '0.0.0.0', function () { __ytpLog('diag listening on 8102'); });
} catch (e) {}
__ytpLog('=== service start [""" + "{label}" + r"""] node ' + process.version + ' pid ' + process.pid + ' dir ' + __dirname);
""").replace("{label}", label)
if js.startswith("/* YouTube + diagnostics"):
    sys.exit("patch_service: already patched")
js = BOOT + js

# Log the cobalt setup and the choice between proxy and DIAL.
once("app.listen(PORT, '127.0.0.1');\nif (cobaltSetup()) {\n  startServer();\n} else {\n",
     "app.listen(PORT, '127.0.0.1');\n"
     "var __ytpFs = __nccwpck_require__(9896);\n"
     "['/usr/apps/com.samsung.tv.cobalt/content/app/cobalt/content', '/usr/apps/com.samsung.tv.cobalt/content/data',\n"
     " '/home/owner/share/tizentube-content', '/home/owner/share/tizentube-ca.crt', '/home/owner/share/tizentube-ca.key'].forEach(function (p) {\n"
     "  try { global.__ytpLog('exists ' + p + ' = ' + __ytpFs.existsSync(p)); } catch (e) { global.__ytpLog('exists ' + p + ' threw ' + e); }\n"
     "});\n"
     "var __ytpSetupOk = false;\n"
     "try { __ytpSetupOk = cobaltSetup(); } catch (e) { global.__ytpLog('cobaltSetup threw ' + (e && e.stack || e)); }\n"
     "global.__ytpLog('cobaltSetup -> ' + __ytpSetupOk);\n"
     "if (__ytpSetupOk) {\n  startServer();\n} else {\n")

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

# Log which hosts the player connects to (host names only), to confirm traffic flows.
once("  proxyServer.on('connect', function (request, clientSocket, initialData) {\n"
     "    var reqUrl = request.url.split(':');\n",
     "  proxyServer.on('connect', function (request, clientSocket, initialData) {\n"
     "    global.__ytpLog('CONNECT ' + request.url);\n"
     "    var reqUrl = request.url.split(':');\n")

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
     "  proxyServer.on('error', function (e) { global.__ytpLog('proxy error ' + (e && e.code || e)); });\n"
     "  global.__ytpLog('proxy listen 8101...');\n"
     "  proxyServer.listen(proxyPort, '0.0.0.0', function () {\n"
     "    global.__ytpLog('proxy LISTENING on 8101');\n"
     "    setTimeout(function () {\n"
     "      try { hostCert('www.youtube.com'); hostCert('youtube.com'); global.__ytpLog('certificates ready'); } catch (e) { global.__ytpLog('cert warm-up failed ' + (e && e.stack || e)); }\n"
     "    }, 0);\n"
     "  });\n}\nmodule.exports = startServer;")

js_path.write_text(js, encoding="utf-8")
print("patched", js_path)
