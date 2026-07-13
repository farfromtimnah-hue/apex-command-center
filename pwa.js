// Shared PWA bootstrap: registers the static-asset service worker.
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

  window.addEventListener("load", registerServiceWorker);

})();
