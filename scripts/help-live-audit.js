// LIVE audit: paste into the browser console (or run through the Chrome tool) on any
// staff or client page that loads help-core.js. It looks at every visible clickable
// thing on the screen right now, resolves it the way Learn does (data-help first,
// then the visible text and aria-label against the buttons[] labels of the audience)
// and returns the ones that match no guide. Open a sheet or a tab first, then run it
// again: labels built at run time only exist while they are on the screen.
(async function () {
  var HC = window.HelpCore;
  if (!HC) { return "HelpCore is not on this page"; }
  var guides = await (await fetch("/help/guides.json", { cache: "no-store" })).json();
  var page = (location.pathname.split("/").pop() || "").replace(/\.html$/, "");
  var aud = HC.defaultAudienceForPage(page) || "admin";
  var data = { version: guides.version, guides: HC.filterByAudience(guides.guides, aud), pages: guides.pages };
  var miss = {}, linked = 0, total = 0;
  document.querySelectorAll("button,a[href],[role=button],a.btn").forEach(function (b) {
    if (!b.offsetParent || b.closest(".aphelp-root") || b.closest("[data-no-help]")) { return; }
    total++;
    var dh = b.closest("[data-help]");
    var text = typeof b.innerText === "string" && b.innerText ? b.innerText : b.textContent;
    var r = HC.resolveTarget({ dataHelp: dh ? dh.getAttribute("data-help") : null, texts: [text, b.getAttribute("aria-label")] }, data);
    if (r) { linked++; return; }
    var k = HC.normalize(text || b.getAttribute("aria-label") || "(no text)");
    miss[k] = (miss[k] || 0) + 1;
  });
  return JSON.stringify({ page: page, audience: aud, total: total, linked: linked, unlinked: miss });
})();
