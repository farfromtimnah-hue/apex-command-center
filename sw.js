// Apex Command Center service worker.
// Caches STATIC ASSETS ONLY (JS, CSS, icons, fonts, manifest). It never
// caches HTML pages, worker API responses, financial data or client data:
// the app requires an internet connection to function. This worker exists
// only so the app is installable and opens with a standalone look.

// Auto-stamped by .git/hooks/pre-commit with a fresh timestamp on every
// commit that touches sw.js — do not hand-edit the suffix, it will be
// overwritten. This is what makes the activate handler's cache cleanup below
// actually fire on each deploy instead of silently serving stale
// nav.js/pwa.js/mobile.css/icons forever.
var CACHE_NAME = "apex-static-1784854822";

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

  var path = new URL(req.url).pathname.toLowerCase();
  var isCode = path.lastIndexOf(".js") === path.length - 3 || path.lastIndexOf(".css") === path.length - 4;

  if (isCode) {
    // Stale-while-revalidate: serve the cached copy instantly, but always
    // refetch in the background so a missed/failed version bump self-heals
    // within one extra load instead of serving stale JS/CSS indefinitely.
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(req).then(function (cached) {
          var fetchPromise = fetch(req).then(function (res) {
            if (res && res.status === 200 && (res.type === "basic" || res.type === "cors")) {
              cache.put(req, res.clone());
            }
            return res;
          })["catch"](function () { return cached; });
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // Icons/fonts/manifest: cache-first is fine, they're content-addressed
  // enough in practice and change far less often than code.
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
