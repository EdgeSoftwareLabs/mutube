// YouTube + (formerly MuTube) bootstrap. patcher.py prepends this payload to the
// YouTube TV page script inside the Cobalt engine. Full-line // comments are
// stripped by patcher.py before embedding; keep the code itself ASCII.
//
// Add TizenTube script to the page. Don't inject more than once.
//
// Restore 4k support by hooking window.MediaSource.isTypeSupported to remove the height/width parameters.
// I am not actually sure why this works since isTypeSupported still returns false for VP09 codecs.
// YouTube does detect spoofing by checking nonsensical values for height/width so maybe that affects something?
// HDR still does not work, but at least 4k works now.
//
// YouTube +: youtube-plus.js (Home tile "Not interested" / "Don't recommend
// channel") is normally embedded by patcher.py directly in front of this
// script, so window.YouTubePlus already exists here. If the binary had no room
// to embed it, patcher.py builds without it and we load it from the URL below
// (patcher.py --youtube-plus-url overrides it; cdn.jsdelivr.net is already in
// the CSP allow-list). The jsDelivr /gh/ URL only works once the youtube-plus
// branch is pushed to GitHub.
//
(function () {
if (document.mutube) return;
document.mutube = true;

// Cobalt goes straight from readyState "loading" to "complete" without ever firing
// DOMContentLoaded. TizenTube is injected while still "loading", so its modules that
// wait for that event (player buttons incl. Speed Controls, extra subtitles) never
// start. Fire it ourselves at load if Cobalt didn't. Dispatched on document and
// window separately (non-bubbling) so listeners on either get it exactly once.
var dclFired = false;
document.addEventListener('DOMContentLoaded', function () { dclFired = true; });
window.addEventListener('load', function () {
  if (dclFired) return;
  document.dispatchEvent(new Event('DOMContentLoaded'));
  window.dispatchEvent(new Event('DOMContentLoaded'));
});

var script = document.createElement('script');
script.src = "https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?v=" + Date.now();
script.async = true;
document.head.appendChild(script);

if (!window.YouTubePlus) {
  var ytplus = document.createElement('script');
  ytplus.src = "https://cdn.jsdelivr.net/gh/mistermassacre/mutube@youtube-plus/youtube-plus.js?v=" + Date.now();
  ytplus.async = true;
  document.head.appendChild(ytplus);
}

const originalIsTypeSupported = window.MediaSource.isTypeSupported.bind(window.MediaSource);

window.MediaSource.isTypeSupported = function(mimeType) {
  const parts = mimeType
    .split(';')
    .map(part => part.trim())
    .filter(part => part);

  const filtered = parts.filter(part => {
    return !(part.startsWith('width=') || part.startsWith('height='));
  });

  const cleaned = filtered.join('; ');
  return originalIsTypeSupported(cleaned);
};
})();
