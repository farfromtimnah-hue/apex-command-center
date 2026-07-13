// Apex Command Center service worker.
// Caches STATIC ASSETS ONLY (JS, CSS, icons, fonts, manifest). It never
// caches HTML pages, worker API responses, financial data or client data:
// the app requires an internet connection to function. This worker exists
// only so the app is installable and opens with a standalone look.

var CACHE_NAME = "apex-static-v1";

var PRECACHE_URLS = [
  "nav.js",
  "pwa.js",
  "mobile.css",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png"
];

var STATIC_EXTENSIONS = [".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".woff", ".woff2", ".ttf"];

function isStaticAsset(url) {
  var u;
  try { u = new URL(url); } catch (e) { return false; }

  // Same-origin static files by extension
  if (u.origin === self.location.origin) {
    var path = u.pathname.toLowerCase();
    if (path.indexOf("/api/") !== -1) { return false; }
    for (var i = 0; i < STATIC_EXTENSIONS.length; i++) {
      if (path.lastIndexOf(STATIC_EXTENSIONS[i]) === path.length - STATIC_EXTENSIONS[i].length) {
        return true;
      }
    }
    if (path.lastIndexOf("manifest.json") === path.length - 13) { return true; }
    return false;
  }

  // Google Fonts stylesheet + font files
  if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") {
    return true;
  }

  return false;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // addAll would reject the whole install on one failure; add one by one.
      var adds = [];
      for (var i = 0; i < PRECACHE_URLS.length; i++) {
        adds.push(cache.add(PRECACHE_URLS[i])["catch"](function () {}));
      }
      return Promise.all(adds);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      var deletions = [];
      for (var i = 0; i < names.length; i++) {
        if (names[i] !== CACHE_NAME) { deletions.push(caches["delete"](names[i])); }
      }
      return Promise.all(deletions);
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") { return; }
  if (!isStaticAsset(req.url)) { return; }

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) { return cached; }
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && (res.type === "basic" || res.type === "cors")) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      });
    })
  );
});
