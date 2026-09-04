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
var CACHE_NAME = "apex-static-1788484308";

var PRECACHE_URLS = [
  "nav.js",
  "datetime.js",
  "analytics-view.js",
  "pwa.js",
  "gm.js",
  "gm.css",
  "calendar-grid.js",
  "calendar-grid.css",
  "scheduling-queue.js",
  "scheduling-queue.css",
  "template-edit.js",
  "template-edit.css",
  "gm-labels.js",
  "mobile.css",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png"
];

var STATIC_EXTENSIONS = [".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".woff", ".woff2", ".ttf"];

// Suffix test. Must be used instead of a bare
// `path.lastIndexOf(s) === path.length - s.length` comparison: when the
// needle is absent lastIndexOf returns -1, which equals length - s.length
// for ANY path exactly one character shorter than the needle. That false
// positive previously made "/portal.html" (12 chars) match "manifest.json"
// (13 chars) and get treated as a cacheable static asset.
function endsWith(path, suffix) {
  if (suffix.length > path.length) { return false; }
  return path.lastIndexOf(suffix) === path.length - suffix.length;
}

function isStaticAsset(url) {
  var u;
  try { u = new URL(url); } catch (e) { return false; }

  // Same-origin static files by extension
  if (u.origin === self.location.origin) {
    var path = u.pathname.toLowerCase();
    if (path.indexOf("/api/") !== -1) { return false; }
    // version.json is polled by pwa.js for the self-heal reload; it must never
    // be served from the SW cache or the poll can never observe a change.
    if (endsWith(path, "/version.json")) { return false; }
    for (var i = 0; i < STATIC_EXTENSIONS.length; i++) {
      if (endsWith(path, STATIC_EXTENSIONS[i])) {
        return true;
      }
    }
    if (endsWith(path, "manifest.json")) { return true; }
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

  var path;
  try { path = new URL(req.url).pathname.toLowerCase(); } catch (e) { return; }

  // sw.js itself: NETWORK-ONLY. A service worker that can serve itself from
  // cache can pin its own replacement out of existence — the browser's update
  // check fetches this URL, so it must always reach the network. Declining to
  // call respondWith() lets the request pass through untouched.
  if (endsWith(path, "/sw.js")) { return; }

  if (!isStaticAsset(req.url)) { return; }

  var isCode = endsWith(path, ".js") || endsWith(path, ".css");

  if (isCode) {
    // CACHE-FIRST, not stale-while-revalidate. Every JS/CSS URL here already
    // carries a ?v= param stamped at commit time, which makes the URL itself
    // immutable: ?v=NEW is a different cache key, so a new deploy is a cache
    // MISS and fetches fresh regardless. SWR's revalidation therefore buys
    // nothing, and actively hurt — when an old HTML shell asked for ?v=OLD,
    // SWR served the stale entry AND re-fetched that same obsolete URL in the
    // background forever, refreshing a version that will never be current.
    // Cache-first drops the pointless background fetch; the shell's own
    // version bump is what retires the old URL.
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(req).then(function (cached) {
          if (cached) { return cached; }
          return fetch(req).then(function (res) {
            if (res && res.status === 200 && (res.type === "basic" || res.type === "cors")) {
              cache.put(req, res.clone());
            }
            return res;
          });
        });
      })
    );
    return;
  }

  // Icons/fonts/manifest: cache-first. These are genuinely immutable in
  // practice and are retired by the CACHE_NAME bump on deploy.
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

// ═══════════════ WEB PUSH ═══════════════════════════════════════════════
//
// Works on an installed home-screen PWA, iPhone included (iOS 16.4+). It does
// NOT work in a plain Safari tab, and the permission prompt must come from a
// real tap -- both are iOS rules, not choices made here.

self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }

  var title = data.title || "Apex Command Center";
  var options = {
    body: data.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    // A tag replaces an earlier notification with the same tag instead of
    // stacking duplicates -- a daily check must not pile up.
    tag: data.tag || "apex",
    data: { url: data.url || "/dashboard.html" },
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || "/dashboard.html";

  // Focus an already-open window rather than opening a second copy.
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(target) !== -1 && "focus" in list[i]) { return list[i].focus(); }
      }
      if (clients.openWindow) { return clients.openWindow(target); }
    })
  );
});
