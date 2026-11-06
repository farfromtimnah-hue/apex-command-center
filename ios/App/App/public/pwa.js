// Shared PWA bootstrap: registers the static-asset service worker, and adds
// pull-to-refresh support for standalone (home-screen) mode only, since that
// mode has no Safari chrome at all and therefore no other way to reload.
// Included on every page. Uses addEventListener("load", ...) instead of
// window.onload so it never clobbers each page's own window.onload init.
(function () {

  // ── Escape hatch for a stuck full-screen overlay ────────────────────────
  //
  // 2026-09-07: .voice-modal-overlay set display:flex, which beats the UA
  // stylesheet's [hidden]{display:none}, so the voice dialog rendered on every
  // page load and its close button could not dismiss it. Alice could not use
  // the app at all. The CSS fix lives inside dashboard.html, and a device that
  // is still serving an older copy of that HTML -- from the HTTP cache or
  // iOS's back-forward cache, neither of which a hard refresh reliably clears
  // -- stays stuck with no way out from inside the page.
  //
  // pwa.js is loaded by every page and is NOT fingerprinted, so it is the one
  // file that reaches a device holding stale HTML. This closes the overlay on
  // load regardless of which dashboard.html is running. It is a safety net,
  // not the fix: the fix is the CSS guard.
  function dismissStuckOverlays() {
    var ids = ["voiceModal"];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (!el) { continue; }
      // Only touch one that is ALREADY marked hidden and RENDERING anyway --
      // that combination is the bug and nothing else.
      //
      // ⚠️ Setting an inline `display:none !important` here was itself a bug:
      // it stuck to the element permanently, so once the page had loaded the
      // modal could never be opened again. An inline !important outranks
      // everything, including the class rule that shows it. Removing the
      // inline display instead lets the stylesheet decide, and the CSS guard
      // (.voice-modal-overlay[hidden]) is what actually keeps it hidden.
      if (!el.hidden) { continue; }
      if (window.getComputedStyle(el).display === "none") { continue; }
      el.style.removeProperty("display");
      // Still rendering means the page is an OLD copy with no [hidden] guard.
      // Neutralise it without leaving a rule that outlives the stale HTML.
      if (window.getComputedStyle(el).display !== "none") {
        el.parentNode.removeChild(el);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", dismissStuckOverlays);
  } else {
    dismissStuckOverlays();
  }
  window.addEventListener("pageshow", dismissStuckOverlays);

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) { return; }
    navigator.serviceWorker.register("sw.js").then(function () {
      // Registered; nothing else to do.
    })["catch"](function () {
      // Registration failing (e.g. unsupported browser) must never break the app.
    });
  }

  // ── Never reload while the person is working ────────────────────────────
  //
  // 2026-11-06: a contractor redid the same estimate three times because the
  // version poll below reloaded the page under them. The estimate wizard keeps
  // everything in memory, so every reload wiped a half made estimate, and every
  // frontend deploy reloaded every open page within a minute. A reload is now
  // only automatic when pwaBusy() says nobody is in the middle of something.
  // When someone is, the new version waits behind a small banner.
  var BUSY_INPUT_WINDOW_MS = 120 * 1000;   // typing this recently counts as working
  var PENDING_RECHECK_MS = 5 * 1000;       // how often a waiting update re-asks
  var PENDING_QUIET_MS = 30 * 1000;        // calm for this long, then reload
  var lastInputAt = 0;
  var markedBusy = false;

  function stampInput() { lastInputAt = Date.now(); }
  // One capture phase listener: it sees every field on the page, including
  // ones a screen adds later, before any handler can stop the event.
  document.addEventListener("input", stampInput, true);
  document.addEventListener("change", stampInput, true);

  // A screen that holds unsaved work in memory calls pwaMarkBusy(true) when it
  // opens and pwaMarkBusy(false) when it closes.
  window.pwaMarkBusy = function (flag) { markedBusy = !!flag; };

  function sheetIsVisible() {
    var el = document.querySelector(".gm-sheet-overlay");
    if (!el) { return false; }
    if (el.hidden) { return false; }
    try {
      var cs = window.getComputedStyle(el);
      if (cs && (cs.display === "none" || cs.visibility === "hidden")) { return false; }
    } catch (e) { /* no computed style: an attached sheet counts */ }
    return true;
  }

  function fieldHasFocus() {
    var a = document.activeElement;
    if (!a || !a.tagName) { return false; }
    var tag = String(a.tagName).toLowerCase();
    if (tag === "textarea" || tag === "select") { return true; }
    if (tag !== "input") { return false; }
    var type = String(a.type || "text").toLowerCase();
    return !(type === "button" || type === "submit" || type === "reset" || type === "image");
  }

  function pwaBusy() {
    if (markedBusy) { return true; }
    if (window.gmEstWiz) { return true; }
    if (window.SW && window.SW.open) { return true; }
    if (sheetIsVisible()) { return true; }
    if (fieldHasFocus()) { return true; }
    if (lastInputAt && Date.now() - lastInputAt < BUSY_INPUT_WINDOW_MS) { return true; }
    return false;
  }
  window.pwaBusy = pwaBusy;

  function pageIsEn() {
    try {
      if (typeof window.apexIsEn === "function") { return !!window.apexIsEn(); }
      if (document.body && document.body.classList) {
        if (document.body.classList.contains("lang-en")) { return true; }
        if (document.body.classList.contains("lang-pt")) { return false; }
      }
      var l = document.documentElement && document.documentElement.lang;
      return /^en/i.test(l || "");
    } catch (e) { return false; }
  }

  // The reload every path uses: the one-shot _v query string makes it a
  // different URL, so the browser cache cannot answer with the stale page.
  function reloadWithVersion(version) {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("_v", String(version));
      window.location.replace(u.href);
      return;
    } catch (e) { /* fall through */ }
    window.location.reload();
  }

  // ── Draft cleanup for the estimate wizard ───────────────────────────────
  // A draft holds a customer's name, phone and address on this device. Every
  // sign out path calls this so the next person on the device never sees one.
  window.pwaClearEstDrafts = function () {
    try {
      var keys = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf("apexEstDraft:") === 0) { keys.push(k); }
      }
      for (var j = 0; j < keys.length; j++) { window.localStorage.removeItem(keys[j]); }
    } catch (e) { /* storage may be blocked */ }
  };

  var pendingVersion = null;
  var pendingTimer = null;
  var quietSince = null;
  var bannerEl = null;

  function removeBanner() {
    var el = document.getElementById("pwaUpdateBanner");
    if (el && el.parentNode) { el.parentNode.removeChild(el); }
    bannerEl = null;
    try { document.body.classList.remove("pwa-banner-on"); } catch (e) { /* body gone */ }
  }

  function stopPending() {
    if (pendingTimer) { clearInterval(pendingTimer); pendingTimer = null; }
    quietSince = null;
  }

  function reloadForPending() {
    reloaded = true;
    stopPending();
    removeBanner();
    reloadWithVersion(pendingVersion);
  }

  function showUpdateBanner() {
    if (document.getElementById("pwaUpdateBanner")) { return; }   // never two
    var en = pageIsEn();
    if (!document.getElementById("pwaUpdateBannerCss")) {
      var st = document.createElement("style");
      st.id = "pwaUpdateBannerCss";
      // The padding rule gives an open sheet room under its last button, so the
      // banner never sits on top of Save. 12px of air, plus the banner height.
      st.textContent =
        "#pwaUpdateBanner{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));" +
        "margin:0 auto;max-width:560px;z-index:2147483000;box-sizing:border-box;" +
        "background:var(--header,#1c1c1c);color:#fff;border-radius:12px;padding:8px 8px 8px 14px;" +
        "font-family:'Inter',sans-serif;font-size:13px;font-weight:600;line-height:1.3;" +
        "display:flex;align-items:center;gap:10px;box-shadow:0 8px 30px rgba(0,0,0,0.35)}" +
        "#pwaUpdateBanner span{flex:1 1 auto;min-width:0}" +
        "#pwaUpdateBanner button{flex:0 0 auto;min-height:44px;padding:0 14px;border:none;border-radius:10px;" +
        "background:var(--gold,#C9A43A);color:#1c1c1c;font-family:'Inter',sans-serif;font-size:14px;font-weight:800;cursor:pointer}" +
        "body.pwa-banner-on .gm-sheet{padding-bottom:calc(20px + var(--pwa-banner-h,60px) + 12px + env(safe-area-inset-bottom))}" +
        "body.pwa-banner-on{padding-bottom:calc(var(--pwa-banner-h,60px) + 24px)}";
      document.head.appendChild(st);
    }
    var el = document.createElement("div");
    el.id = "pwaUpdateBanner";
    el.setAttribute("role", "status");
    var msg = document.createElement("span");
    msg.textContent = en
      ? "A new version of Apex is ready. Tap Update when you finish what you are doing."
      : "Há uma versão nova do Apex. Toque em Atualizar quando terminar o que está fazendo.";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "pwaUpdateBannerBtn";
    btn.textContent = en ? "Update" : "Atualizar";
    btn.addEventListener("click", reloadForPending);
    el.appendChild(msg);
    el.appendChild(btn);
    document.body.appendChild(el);
    bannerEl = el;
    try {
      document.body.style.setProperty("--pwa-banner-h", (el.offsetHeight || 60) + "px");
      document.body.classList.add("pwa-banner-on");
    } catch (e) { /* cosmetic only */ }
  }

  function pendingTick() {
    if (pwaBusy()) { quietSince = null; return; }
    var now = Date.now();
    if (quietSince === null) { quietSince = now; return; }
    if (now - quietSince >= PENDING_QUIET_MS) { reloadForPending(); }
  }

  function holdUpdate(version) {
    pendingVersion = version;
    showUpdateBanner();
    if (!pendingTimer) {
      quietSince = null;
      pendingTimer = setInterval(pendingTick, PENDING_RECHECK_MS);
    }
  }

  // 60s, not 10 minutes. On 2026-09-07 a broken overlay left Alice unable to
  // use the app; the fix was live within minutes but her page kept serving the
  // pre-fix HTML. A ten-minute poll is far too slow when the page is unusable,
  // and worse: knownVersion resets to null on every load, so a stuck user
  // reloading repeatedly -- exactly what a stuck user does -- restarts the
  // clock each time and the check never fires at all.
  var VERSION_CHECK_INTERVAL_MS = 60 * 1000;
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
        // A plain reload() re-requests the HTML and can be answered from the
        // browser's own cache -- GitHub Pages serves *.html with
        // max-age=600 -- which reloads straight back into the stale page.
        // reloadWithVersion() uses a one-shot cache-busting query string, a
        // different URL that cannot be served from that cache.
        if (pendingVersion !== null) {
          // Already waiting behind the banner: just remember the newest one.
          pendingVersion = data.version;
          return;
        }
        if (pwaBusy()) {
          holdUpdate(data.version);
          return;
        }
        reloaded = true;
        reloadWithVersion(data.version);
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
      // Someone is in the middle of something: keep the restored page as it is.
      if (pwaBusy()) { return; }
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
        if (pwaBusy()) {
          // Unsaved work on screen: a pull must not wipe it.
          indicator.wrapper.style.height = "0px";
          startY = null;
          pulling = false;
          return;
        }
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

  // Test hook: lets a test run one version check without waiting for the timer.
  window.pwaCheckVersionNow = checkVersion;

  window.addEventListener("load", registerServiceWorker);
  window.addEventListener("load", setupPullToRefresh);
  window.addEventListener("load", setupVersionCheck);

  // Registered immediately, NOT on "load" — a bfcache restore fires pageshow
  // without firing load, so a load-gated registration would never be attached
  // on the very restore it exists to catch. (pwa.js is deferred, so the
  // document is already parsed by the time this runs.)
  setupBfcacheReload();

})();
