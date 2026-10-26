// Return to Meeting Prep.
//
// Rafa opens these pages from Meeting Prep MID-MEETING, in a new tab, while
// talking to a client. Without a way back he lands on a long page, loses the
// prep he was reading from, and has to find it again in front of the client.
//
// Every link out of prep stamps ?from=prep plus the client and meeting type.
// This renders a sticky bar pointing back at exactly that prep page.
//
// Shared rather than pasted into each page: a page that forgets to include it
// silently loses the way back, and that is not a failure anyone would notice
// until it happened live. See guards-must-not-need-installing.
(function () {
  function boot() {
    var q = new URLSearchParams(window.location.search);
    if (q.get("from") !== "prep") { return; }

    // client.html already carries the client as ?id=; the other pages are not
    // client-scoped, so prep passes it explicitly as prepClient.
    var cid = q.get("prepClient") || q.get("id") || "";
    if (!cid) { return; }

    var type = q.get("prepType") || "";
    var href = "meeting-prep.html?client=" + encodeURIComponent(cid) +
               (type ? "&type=" + encodeURIComponent(type) : "");

    if (document.getElementById("prepReturn")) { return; }

    var a = document.createElement("a");
    a.id = "prepReturn";
    a.href = href;
    a.innerHTML =
      '<span class="show-pt">&#8592; Voltar para a prepara&#231;&#227;o da reuni&#227;o</span>' +
      '<span class="show-en">&#8592; Back to meeting prep</span>';
    a.style.cssText =
      "position:sticky;top:0;z-index:60;display:block;text-align:center;" +
      "background:#10233f;color:#bf9f54;font-size:14px;font-weight:600;" +
      "letter-spacing:0.2px;padding:11px 14px;text-decoration:none;" +
      "border-bottom:1px solid rgba(191,159,84,0.35);";
    document.body.insertBefore(a, document.body.firstChild);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
