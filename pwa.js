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

})();
