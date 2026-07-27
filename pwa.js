// Shared PWA bootstrap: registers the static-asset service worker, and adds
// pull-to-refresh support for standalone (home-screen) mode only, since that
// mode has no Safari chrome at all and therefore no other way to reload.
// Included on every page. Uses addEventListener("load", ...) instead of
// window.onload so it never clobbers each page's own window.onload init.
(function () {

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) { return; }
    navigator.serviceWorker.register("sw.js").then(function () {
      // Registered; nothing else to do.
    })["catch"](function () {
      // Registration failing (e.g. unsupported browser) must never break the app.
    });
  }

  var VERSION_CHECK_INTERVAL_MS = 10 * 60 * 1000;
  var knownVersion = null;
  var reloaded = false;

  function checkVersion() {
    fetch("version.json", { cache: "no-store" }).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (knownVersion === null) {
        knownVersion = data.version;
        return;
      }
      if (reloaded) { return; }
      if (data.version !== knownVersion) {
        reloaded = true;
        window.location.reload();
      }
    })["catch"](function () {
      // No network / bad response must never break the app.
    });
  }

  function setupVersionCheck() {
    checkVersion();
    setInterval(checkVersion, VERSION_CHECK_INTERVAL_MS);
  }

  // ── bfcache (back-forward cache) restore ────────────────────────────────
  // Safari's bfcache is far more aggressive than Chrome's: on back/forward
  // navigation, and on reopening a recently-closed tab, WebKit can restore a
  // fully-alive page — already-executed JS, already-rendered DOM — WITHOUT
  // re-running any script or refetching the HTML. The page's only signal that
  // this happened is pageshow's event.persisted flag.
  //
  // This is a THIRD staleness path, distinct from the two fixed on 2026-07-25
  // (d3203b2): the service worker is not involved at all (the HTML is never
  // refetched, so nothing consults sw.js), and the version-check poll above
  // does not save us either — setInterval is paused while the page sits in
  // bfcache and may be discarded outright, so a restored page can show stale
  // content for up to a full VERSION_CHECK_INTERVAL_MS after it reappears.
  // Confirmed live in Safari on 2026-07-27: portal.html rendered pre-fix
  // content while a fetch() from that same tab's console returned the fixed
  // HTML, proving the network layer was correct and the DOM was restored.
  //
  // Force a real reload rather than trusting restored in-memory state. This
  // does not fight the eight per-page pageshow handlers that call
  // fetchAndApplyRole() — those re-validate the user's ROLE on a restore but
  // deliberately keep the rendered DOM; reloading supersedes them, and their
  // work is redone by the fresh load's own init().
  function setupBfcacheReload() {
    window.addEventListener("pageshow", function (evt) {
      if (!evt.persisted) { return; }   // normal load; init() already ran
      if (reloaded) { return; }
      reloaded = true;
      window.location.reload();
    });
  }

  function isStandalone() {
    if (window.navigator.standalone === true) { return true; }
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) { return true; }
    return false;
  }

  function setupPullToRefresh() {
    if (!isStandalone()) { return; }

    var THRESHOLD = 80;
    var startY = null;
    var pulling = false;
    var indicator = null;

    function createIndicator() {
      var el = document.createElement("div");
      el.id = "ptr-indicator";
      el.style.cssText =
        "position:fixed;top:0;left:0;right:0;height:0;overflow:hidden;" +
        "display:flex;align-items:center;justify-content:center;" +
        "background:transparent;z-index:99999;transition:none;" +
        "pointer-events:none;";
      var spinner = document.createElement("div");
      spinner.style.cssText =
        "width:24px;height:24px;border-radius:50%;" +
        "border:3px solid rgba(201,164,58,0.25);" +
        "border-top-color:#C9A43A;" +
        "transform:rotate(0deg);";
      el.appendChild(spinner);
      document.body.appendChild(el);
      return { wrapper: el, spinner: spinner };
    }

    function onTouchStart(evt) {
      if (window.scrollY > 0) { startY = null; return; }
      if (evt.touches.length !== 1) { startY = null; return; }
      startY = evt.touches[0].clientY;
      pulling = false;
    }

    function onTouchMove(evt) {
      if (startY === null) { return; }
      if (window.scrollY > 0) { startY = null; return; }
      var currentY = evt.touches[0].clientY;
      var delta = currentY - startY;
      if (delta <= 0) { return; }

      pulling = true;
      if (!indicator) { indicator = createIndicator(); }

      var height = Math.min(delta * 0.5, THRESHOLD + 20);
      indicator.wrapper.style.height = height + "px";
      var rotation = Math.min((height / THRESHOLD) * 360, 360);
      indicator.spinner.style.transform = "rotate(" + rotation + "deg)";

      if (height > 10) { evt.preventDefault(); }
    }

    function onTouchEnd() {
      if (!pulling || !indicator) { startY = null; pulling = false; return; }

      var currentHeight = parseInt(indicator.wrapper.style.height, 10) || 0;
      if (currentHeight >= THRESHOLD * 0.5) {
        indicator.wrapper.style.height = THRESHOLD + "px";
        indicator.spinner.style.transition = "transform 0.6s linear infinite";
        setTimeout(function () { window.location.reload(); }, 150);
      } else {
        indicator.wrapper.style.height = "0px";
      }
      startY = null;
      pulling = false;
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
  }

  window.addEventListener("load", registerServiceWorker);
  window.addEventListener("load", setupPullToRefresh);
  window.addEventListener("load", setupVersionCheck);

  // Registered immediately, NOT on "load" — a bfcache restore fires pageshow
  // without firing load, so a load-gated registration would never be attached
  // on the very restore it exists to catch. (pwa.js is deferred, so the
  // document is already parsed by the time this runs.)
  setupBfcacheReload();

})();
