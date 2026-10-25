/* Learn (Aprenda): the sheet, the "?" button, and press and hold on any button.
 *
 * Loaded by every logged in Apex screen (the client portal and the staff
 * pages). It is NOT loaded on public customer pages or on help.html. It does
 * nothing at all unless window.APEX_HELP.enabled === true (help-config.js).
 *
 * data-help, for whoever adds buttons later
 * ------------------------------------------
 * A button finds its guide in one of two ways, in this order:
 *   1. The nearest ancestor with a data-help attribute. The value is
 *      "guideId#sectionId#step", step optional:
 *          <button data-help="estimate#send#2">...</button>
 *   2. Otherwise the button's visible text or aria-label is compared (lower
 *      case, no accents, single spaces) with every "buttons[].labels" entry in
 *      help/guides.json, in both languages. The guide file brings its own
 *      labels, so most buttons need nothing added to the page.
 * A button that must keep its own right click (it already has one) can say so
 * with data-no-help; nothing happens for it. Nothing is added to the pages
 * by this file: data-help is only ever added by hand, one button at a time.
 *
 * Guides come from the live site (HELP_BASE in help-config.js), never from
 * the app bundle. Nothing from guides.json or from the worker is put on the
 * page as markup: text goes in with textContent, so there is nothing to escape
 * and nothing to inject.
 *
 * Two sides: every guide belongs to the admin side (the staff app) or the client
 * side (the client portal). The sheet starts on the side of the page it is on
 * (portal.html is the client side, every other page is the admin side). Only
 * staff see a small button to look at the other side, and the choice is not
 * remembered: it starts over every time the sheet opens. A client sees client
 * guides only and never a word about sides. The role read here only decides
 * whether to SHOW that button; the Worker decides what a person may be answered.
 */
(function () {
  var HC = window.HelpCore;
  // The flag guard. Everything below runs only when the feature is switched on.
  if (!HC || !HC.isEnabled(window)) { return; }

  var doc = document;
  var BASE = String(window.APEX_HELP.base || "");
  var WORKER_URL_DEFAULT = "https://apex-api.farfromtimnah.workers.dev";

  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  var ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

  var guides = null;        // parsed help/guides.json once loaded
  var guidesPromise = null; // the load in flight, so two callers share one fetch
  var overlay = null, sheet = null, bodyEl = null, titleEl = null, closeBtn = null;
  var lastFocus = null;
  var menuEl = null, lightEl = null;
  var activePlayer = null;  // the video element in the open guide, if one was started
  var openView = null;      // { id, section, step } while the sheet shows a guide
  var side = "client";      // the side the sheet is showing: "admin" or "client"
  var sideBtn = null;       // the one side button (staff only), while the home view shows it
  var sideData = { admin: null, client: null }; // guides.json cut down to one side, built once per load
  var press = null;         // the touch press being timed
  var swallowClick = false;
  var swallowTimer = null;

  // ---- language, screen, auth ------------------------------------------
  function isEn() {
    if (typeof window.isEn === "function") { try { return !!window.isEn(); } catch (e) { /* fall through */ } }
    if (typeof window.apexIsEn === "function") { try { return !!window.apexIsEn(); } catch (e2) { /* fall through */ } }
    return !!(doc.body && doc.body.classList.contains("lang-en"));
  }
  function t(pt, en) { return isEn() ? en : pt; }
  function lang() { return isEn() ? "en" : "pt"; }
  function L(v) { return (v && typeof v === "object") ? (v[lang()] || v.pt || "") : ""; }

  // The screen file name (portal, dashboard, calendar...), used for the default side.
  function pageName() {
    var m = /([^\/]+?)(?:\.html)?$/.exec(window.location.pathname || "");
    return m ? m[1] : "";
  }
  // Same role source the app already uses (nav.js keeps it in sessionStorage).
  // It only decides whether the side button is SHOWN.
  function isStaff() {
    var role = null;
    try { role = sessionStorage.getItem("apex_role"); } catch (e) { role = null; }
    return HC.isStaffRole(role);
  }
  function defaultSide() { return HC.effectiveAudience(isStaff(), HC.defaultAudienceForPage(pageName())); }
  function sideLabel(a) { return a === "admin" ? t("Lado administrador", "Admin side") : t("Lado cliente", "Client side"); }

  function screenKey() {
    var k = "";
    if (typeof window.apexHelpScreenKey === "function") { try { k = window.apexHelpScreenKey(); } catch (e) { k = ""; } }
    if (!k) {
      var m = /([^\/]+?)(?:\.html)?$/.exec(window.location.pathname || "");
      k = m ? m[1] : "";
    }
    return /^[A-Za-z0-9_-]{1,60}$/.test(k) ? k : "";
  }

  function workerUrl() { return window.WORKER_URL || WORKER_URL_DEFAULT; }

  function getToken() {
    if (typeof window.getToken === "function") { return window.getToken(); }
    var role = null, clientToken = null;
    try { role = sessionStorage.getItem("apex_role"); } catch (e) { role = null; }
    if (role === "alice" || role === "rafa" || role === "developer") {
      var fb = window.firebase;
      if (fb && fb.auth && fb.auth().currentUser) { return fb.auth().currentUser.getIdToken(); }
      return Promise.reject(new Error("no session"));
    }
    try { clientToken = sessionStorage.getItem("apex_client_token") || localStorage.getItem("apex_client_token"); } catch (e2) { clientToken = null; }
    return clientToken ? Promise.resolve(clientToken) : Promise.reject(new Error("no session"));
  }

  // ---- small DOM helpers -----------------------------------------------
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined && text !== null) { e.textContent = text; }
    return e;
  }
  function clear(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }
  function button(cls, text) {
    var b = el("button", cls, text);
    b.type = "button";
    return b;
  }
  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
  }
  function store(key, val) { try { if (val === undefined) { return localStorage.getItem(key); } localStorage.setItem(key, val); } catch (e) { /* works without storage */ } return null; }

  // ---- guides ----------------------------------------------------------
  function loadGuides() {
    if (guides) { return Promise.resolve(guides); }
    if (guidesPromise) { return guidesPromise; }
    guidesPromise = fetch(BASE + "help/guides.json", { cache: "no-cache" }).then(function (res) {
      if (!res.ok) { throw new Error("status " + res.status); }
      return res.json();
    }).then(function (data) {
      if (!data || data.version !== 1 || !Array.isArray(data.guides)) { throw new Error("shape"); }
      guides = data;
      sideData = { admin: null, client: null };
      return data;
    });
    guidesPromise["catch"](function () { guidesPromise = null; });
    return guidesPromise;
  }
  function findGuide(id) {
    var list = guides && guides.guides ? guides.guides : [];
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return null;
  }
  // A guide of one side only: null when the id is unknown or belongs to the other side.
  function findGuideOn(id, audience) {
    var g = findGuide(id);
    return (g && HC.guideAudience(g) === audience) ? g : null;
  }
  // guides.json with only this side's guides (pages kept). The same object comes
  // back every time, so the label matching in help-core can cache on it.
  function dataFor(audience) {
    if (!guides) { return null; }
    if (!sideData[audience]) { sideData[audience] = { version: guides.version, guides: HC.filterByAudience(guides.guides, audience), pages: guides.pages }; }
    return sideData[audience];
  }
  function sideTag(g) {
    if (!isStaff()) { return null; }
    var a = HC.guideAudience(g);
    return a ? el("span", "aph-vtag aph-stag", sideLabel(a)) : null;
  }
  function imageUrl(path) {
    if (typeof path !== "string" || !path || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) || path.indexOf("..") !== -1 || path.indexOf("//") === 0) { return ""; }
    return BASE + path.replace(/^\/+/, "");
  }
  function linkOrigin() {
    var o = window.location.origin || "";
    return /^https?:\/\//.test(o) ? o : BASE.replace(/\/$/, "");
  }
  function deepLink(guideId, sectionId, step) {
    var q = "guide=" + encodeURIComponent(guideId);
    if (sectionId) { q += "&section=" + encodeURIComponent(sectionId); }
    if (step) { q += "&step=" + encodeURIComponent(step); }
    return linkOrigin() + "/help.html?" + q + "&lang=" + lang();
  }
  function libraryLink() {
    return linkOrigin() + "/help.html?audience=" + side + "&lang=" + lang();
  }

  // ---- styles ----------------------------------------------------------
  var CSS =
    ".aphelp-btn{width:30px;height:30px;border-radius:50%;border:1.5px solid #C9A43A;background:transparent;color:#C9A43A;font:700 14px/1 'Inter',sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;margin:0 6px;flex:none;transition:transform 120ms ease-out,background-color 120ms ease-out}" +
    ".aphelp-btn:active{transform:scale(0.97)}" +
    ".aphelp-btn:focus-visible,.aphelp-root button:focus-visible,.aphelp-root input:focus-visible,.aphelp-root a:focus-visible{outline:2px solid #C9A43A;outline-offset:2px}" +
    "@media (hover:hover){.aphelp-btn:hover{background:rgba(201,164,58,0.14)}}" +
    "button,[role=button]{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}" +
    ".aphelp-root{--ah-text:#1a1a1d;--ah-muted:#6b6660;--ah-line:#e8e2d9;--ah-bg:#f9f7f4;--ah-card:#fff;--ah-gold:#C9A43A;--ah-r:12px;font-family:'Inter',sans-serif;color:var(--ah-text)}" +
    ".aphelp-root *{box-sizing:border-box}" +
    ".aphelp-overlay{position:fixed;left:0;top:0;right:0;bottom:0;z-index:1200;background:rgba(20,18,16,0.5);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity 200ms ease-out}" +
    ".aphelp-overlay.aph-in{opacity:1}" +
    ".aphelp-sheet{background:var(--ah-bg);width:100%;max-width:560px;height:85vh;height:85dvh;border-radius:16px 16px 0 0;display:flex;flex-direction:column;box-shadow:0 -8px 40px rgba(0,0,0,0.25);transform:translateY(100%);transition:transform 300ms ease-out}" +
    ".aphelp-overlay.aph-in .aphelp-sheet{transform:translateY(0)}" +
    "@media (min-width:700px){.aphelp-overlay{align-items:center}.aphelp-sheet{height:auto;max-height:80vh;min-height:320px;border-radius:16px;transform:scale(0.98);opacity:0;transition:transform 200ms ease-out,opacity 200ms ease-out}.aphelp-overlay.aph-in .aphelp-sheet{transform:scale(1);opacity:1}}" +
    "@media (prefers-reduced-motion:reduce){.aphelp-sheet,.aphelp-overlay.aph-in .aphelp-sheet{transform:none}.aphelp-btn:active,.aphelp-root button:active{transform:none}}" +
    ".aphelp-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px 8px 20px;flex:none}" +
    ".aphelp-title{font-size:18px;font-weight:700;margin:0}" +
    ".aphelp-x{width:44px;height:44px;border-radius:var(--ah-r);border:1px solid var(--ah-line);background:var(--ah-card);color:var(--ah-text);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}" +
    ".aphelp-x svg,.aph-ico{width:18px;height:18px;flex:none}" +
    ".aphelp-body{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 20px calc(24px + env(safe-area-inset-bottom));flex:1;min-height:0}" +
    ".aphelp-root button{font-family:inherit;transition:transform 120ms ease-out,background-color 120ms ease-out}" +
    ".aphelp-root button:active{transform:scale(0.97)}" +
    ".aphelp-root button:disabled{opacity:0.55;cursor:default}" +
    ".aph-h{font-size:15px;font-weight:700;margin:18px 0 6px}" +
    ".aph-p{font-size:14px;line-height:1.5;margin:0 0 10px}" +
    ".aph-muted{color:var(--ah-muted);font-size:13px;line-height:1.45}" +
    ".aph-form{display:flex;gap:8px;margin:10px 0 6px}" +
    ".aph-input{flex:1;min-width:0;min-height:48px;border:1px solid var(--ah-line);border-radius:var(--ah-r);background:var(--ah-card);padding:0 14px;font:500 15px 'Inter',sans-serif;color:var(--ah-text)}" +
    ".aph-primary{min-height:48px;padding:0 16px;border:none;border-radius:var(--ah-r);background:#1a1a1d;color:#fff;font:600 14px 'Inter',sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:7px;white-space:nowrap}" +
    ".aph-quiet{min-height:44px;padding:0 14px;border:1px solid var(--ah-line);border-radius:var(--ah-r);background:var(--ah-card);color:var(--ah-text);font:600 13px 'Inter',sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:7px}" +
    "@media (hover:hover){.aph-quiet:hover{background:#f3eee3}.aph-primary:hover{background:#2b2b30}.aphelp-x:hover{background:#f3eee3}}" +
    ".aph-card{border:1px solid var(--ah-line);border-radius:var(--ah-r);background:var(--ah-card);padding:14px;margin:0 0 10px;text-align:left;width:100%}" +
    "button.aph-card{cursor:pointer;display:block;font:inherit;color:inherit}" +
    ".aph-card-title{font-size:15px;font-weight:700;margin:0 0 3px}" +
    ".aph-card-sum{font-size:13px;line-height:1.45;color:var(--ah-muted);margin:0}" +
    ".aph-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}" +
    ".aph-state{font-size:14px;line-height:1.5;margin:12px 0}" +
    ".aph-error{color:#8f2f2f}" +
    ".aph-ok{color:#2f6b3e;font-size:13px;font-weight:600;margin-top:8px}" +
    ".aph-sec{margin:20px 0 6px;font-size:16px;font-weight:700}" +
    ".aph-step{padding:12px;border-radius:var(--ah-r);margin:0 0 8px}" +
    ".aph-step.aph-hit{background:#f3eee3}" +
    ".aph-step-text{font-size:14px;line-height:1.5;margin:0 0 8px}" +
    ".aph-img{display:block;width:100%;padding:0;border:1px solid var(--ah-line);border-radius:var(--ah-r);overflow:hidden;background:var(--ah-card);cursor:zoom-in}" +
    ".aph-img img{display:block;width:100%;height:auto}" +
    ".aph-link{color:var(--ah-text);font-weight:600;font-size:14px;text-decoration:underline;text-underline-offset:3px}" +
    ".aph-vwrap{margin:0 0 14px}" +
    ".aph-vcard{display:block;width:100%;padding:0;border:1px solid var(--ah-line);border-radius:var(--ah-r);background:var(--ah-card);overflow:hidden;cursor:pointer;text-align:left;font:inherit;color:inherit}" +
    ".aph-vmedia{position:relative;display:block;width:100%;aspect-ratio:16/9;background:#1a1a1d;overflow:hidden}" +
    ".aph-vposter{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;display:block}" +
    ".aph-vplay{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:var(--ah-gold);color:#1a1a1d;display:flex;align-items:center;justify-content:center}" +
    ".aph-vplay svg{width:28px;height:28px;margin-left:3px}" +
    ".aph-vlabel{display:block;padding:12px 14px;font-size:15px;font-weight:700}" +
    "@media (hover:hover){.aph-vcard:hover .aph-vlabel{background:#f3eee3}}" +
    ".aph-video{display:block;width:100%;max-height:70vh;border-radius:var(--ah-r);background:#000}" +
    ".aph-vhint{font-size:13px;color:var(--ah-muted);margin:8px 0 0;line-height:1.45}" +
    ".aph-vtag{display:inline-block;margin-top:8px;padding:1px 8px;border:1px solid var(--ah-line);border-radius:6px;font-size:11px;font-weight:600;color:var(--ah-muted)}" +
    ".aph-side-row{margin:0 0 4px}" +
    ".aph-side{min-height:44px;padding:0 2px;border:none;border-radius:var(--ah-r);background:transparent;color:var(--ah-muted);font:600 13px 'Inter',sans-serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer}" +
    ".aph-side:disabled{text-decoration:none}" +
    "@media (hover:hover){.aph-side:hover{color:var(--ah-text)}}" +
    ".aph-stag{margin-left:6px}" +
    ".aph-tip{font-size:13px;color:var(--ah-muted);margin:18px 0 0;line-height:1.45}" +
    ".aphelp-menu{position:fixed;z-index:1300;background:var(--ah-card);border:1px solid var(--ah-line);border-radius:var(--ah-r);padding:4px;min-width:200px;opacity:0;transition:opacity 150ms ease-out}" +
    ".aphelp-menu.aph-in{opacity:1}" +
    ".aphelp-menu button{display:block;width:100%;text-align:left;min-height:44px;padding:0 12px;border:none;border-radius:8px;background:transparent;font:600 14px 'Inter',sans-serif;color:var(--ah-text);cursor:pointer}" +
    "@media (hover:hover){.aphelp-menu button:hover{background:#f3eee3}}" +
    ".aphelp-light{position:fixed;left:0;top:0;right:0;bottom:0;z-index:1250;background:rgba(20,18,16,0.82);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity 200ms ease-out}" +
    ".aphelp-light.aph-in{opacity:1}" +
    ".aphelp-light img{max-width:100%;max-height:100%;border-radius:var(--ah-r)}" +
    ".aphelp-light .aphelp-x{position:absolute;right:12px;top:12px}" +
    ".aphelp-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(88px + env(safe-area-inset-bottom));z-index:1100;background:#1a1a1d;color:#fff;border-radius:var(--ah-r);padding:12px 16px;font:600 14px 'Inter',sans-serif;max-width:calc(100vw - 32px)}";

  function injectStyles() {
    if (doc.getElementById("aphelp-style")) { return; }
    var st = doc.createElement("style");
    st.id = "aphelp-style";
    st.textContent = CSS;
    (doc.head || doc.body).appendChild(st);
  }

  // ---- the "?" button in the existing top bar ---------------------------
  var headerTries = 0;
  function placeButton() {
    if (doc.getElementById("aphelpBtn")) { return; }
    var host = doc.querySelector("#appHeader .header-right") || doc.querySelector("header .header-right") || doc.querySelector("#appHeader");
    if (!host) {
      // The top bar is part of the page markup; wait a moment if the page is still building it.
      if (headerTries++ < 10) { setTimeout(placeButton, 500); }
      return;
    }
    var b = button("aphelp-btn", "?");
    b.id = "aphelpBtn";
    b.setAttribute("title", t("Aprenda", "Learn"));
    b.setAttribute("aria-label", t("Aprenda", "Learn"));
    b.addEventListener("click", function () { openSheet({}); });
    var before = host.querySelector(".lang-btn");
    if (before && before.parentNode === host) { host.insertBefore(b, before); } else { host.appendChild(b); }
  }
  // A language switch redraws an open guide, so its video card and the player
  // follow the language (the old player is stopped by renderGuide).
  function onLangChange() {
    refreshLabels();
    if (sheet && bodyEl && openView) { renderGuide(openView.id, openView.section, openView.step); }
  }
  function refreshLabels() {
    var b = doc.getElementById("aphelpBtn");
    if (b) { b.setAttribute("title", t("Aprenda", "Learn")); b.setAttribute("aria-label", t("Aprenda", "Learn")); }
    if (sheet) { sheet.setAttribute("aria-label", t("Aprenda", "Learn")); }
    if (titleEl) { titleEl.textContent = t("Aprenda", "Learn"); }
    if (closeBtn) { closeBtn.setAttribute("aria-label", t("Fechar", "Close")); }
  }

  // ---- copy ------------------------------------------------------------
  function copyText(text) {
    if (window.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = el("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "readonly");
        ta.style.position = "fixed"; ta.style.opacity = "0";
        doc.body.appendChild(ta);
        ta.select();
        var okCopy = doc.execCommand("copy");
        doc.body.removeChild(ta);
        if (okCopy) { resolve(); } else { reject(new Error("copy")); }
      } catch (e) { reject(e); }
    });
  }
  function copyButton(link) {
    var b = button("aph-quiet");
    var ic = el("span", "aph-ico");
    ic.innerHTML = ICON_COPY;
    b.appendChild(ic);
    b.appendChild(doc.createTextNode(t("Copiar link", "Copy link")));
    var note = el("p", "aph-ok");
    note.setAttribute("role", "status");
    note.hidden = true;
    b.addEventListener("click", function () {
      copyText(link).then(function () {
        note.textContent = t("Link copiado.", "Link copied.");
        note.className = "aph-ok";
        note.hidden = false;
      }, function () {
        note.textContent = t("Não foi possível copiar.", "Could not copy.");
        note.className = "aph-ok aph-error";
        note.hidden = false;
      });
    });
    return { button: b, note: note };
  }

  // ---- the sheet -------------------------------------------------------
  function openSheet(target) {
    if (overlay) { closeSheet(true); }
    lastFocus = doc.activeElement;
    side = defaultSide();   // never remembered: every opening starts on the page's own side
    overlay = el("div", "aphelp-root aphelp-overlay");
    sheet = el("div", "aphelp-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", t("Aprenda", "Learn"));
    var head = el("div", "aphelp-head");
    titleEl = el("h2", "aphelp-title", t("Aprenda", "Learn"));
    closeBtn = button("aphelp-x");
    closeBtn.innerHTML = ICON_CLOSE;
    closeBtn.setAttribute("aria-label", t("Fechar", "Close"));
    closeBtn.addEventListener("click", function () { closeSheet(false); });
    head.appendChild(titleEl);
    head.appendChild(closeBtn);
    bodyEl = el("div", "aphelp-body");
    sheet.appendChild(head);
    sheet.appendChild(bodyEl);
    overlay.appendChild(sheet);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) { closeSheet(false); } });
    doc.body.appendChild(overlay);
    doc.body.style.overflow = "hidden";
    // One frame later so the slide and fade have a start state to move from.
    setTimeout(function () { if (overlay) { overlay.classList.add("aph-in"); } }, 16);
    showLoadingThen(target || {});
    try { closeBtn.focus(); } catch (e2) { /* focus is a courtesy */ }
  }

  function closeSheet(immediate) {
    if (!overlay) { return; }
    var gone = overlay;
    stopPlayer();
    overlay = null; sheet = null; bodyEl = null; titleEl = null; closeBtn = null; openView = null; sideBtn = null;
    doc.body.style.overflow = "";
    closeMenu();
    closeLightbox();
    gone.classList.remove("aph-in");
    var done = function () { if (gone.parentNode) { gone.parentNode.removeChild(gone); } };
    if (immediate || reducedMotion()) { done(); } else { setTimeout(done, 300); }
    var back = lastFocus;
    lastFocus = null;
    if (back && back.focus) { try { back.focus(); } catch (e) { /* element may be gone */ } }
  }

  function showLoadingThen(target) {
    clear(bodyEl);
    bodyEl.appendChild(el("p", "aph-state aph-muted", t("Carregando...", "Loading...")));
    loadGuides().then(function () {
      if (!bodyEl) { return; }
      if (target.guide && findGuideOn(target.guide, side)) { renderGuide(target.guide, target.section, target.step); } else { renderHome(); }
    }, function () {
      if (!bodyEl) { return; }
      renderOffline(function () { showLoadingThen(target); });
    });
  }

  function renderOffline(retry) {
    clear(bodyEl);
    bodyEl.appendChild(el("p", "aph-state aph-error", t("Sem conexão. Tente de novo.", "No connection. Try again.")));
    var b = button("aph-primary", t("Tentar de novo", "Try again"));
    b.addEventListener("click", retry);
    bodyEl.appendChild(b);
  }

  // ---- the video: tag on the list, play card and player in a guide -------
  function videoTag(g) {
    return HC.videoFor(g, lang()) ? el("span", "aph-vtag", t("Vídeo", "Video")) : null;
  }

  // Pause it, drop its address and reload, so nothing keeps downloading or
  // playing once the person has left the guide.
  function stopPlayer() {
    var v = activePlayer;
    activePlayer = null;
    if (!v) { return; }
    v.pause();
    v.removeAttribute("src");
    v.load();
  }

  function showVideoError(wrap, v) {
    if (activePlayer !== v) { return; }
    stopPlayer();
    clear(wrap);
    var msg = el("p", "aph-state aph-error", t("Não foi possível carregar o vídeo agora. Siga os passos abaixo.", "The video could not load right now. Follow the steps below."));
    msg.setAttribute("role", "status");
    wrap.appendChild(msg);
  }

  // The tap that chose the video also starts it, which is what lets a phone
  // browser play it. The addresses are only ever set as attributes.
  function startPlayer(wrap, card, vid) {
    stopPlayer();
    var v = el("video", "aph-video");
    v.setAttribute("controls", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.setAttribute("preload", "none");
    if (vid.poster) { v.setAttribute("poster", vid.poster); }
    v.setAttribute("src", vid.src);
    v.addEventListener("error", function () { showVideoError(wrap, v); });
    wrap.replaceChild(v, card);
    activePlayer = v;
    var started = v.play();
    if (started && started.then) { started.then(null, function () { if (v.error) { showVideoError(wrap, v); } }); }
    try { v.focus(); } catch (e) { /* focus is a courtesy */ }
  }

  function videoBlock(g) {
    var vid = HC.videoFor(g, lang());
    if (!vid) { return null; }
    var wrap = el("div", "aph-vwrap");
    var card = button("aph-vcard");
    var media = el("span", "aph-vmedia");
    if (vid.poster) {
      var pic = el("img", "aph-vposter");
      pic.alt = "";
      pic.src = vid.poster;
      // A poster that does not load leaves the calm dark panel.
      pic.addEventListener("error", function () { if (pic.parentNode) { pic.parentNode.removeChild(pic); } });
      media.appendChild(pic);
    }
    var play = el("span", "aph-vplay");
    play.setAttribute("aria-hidden", "true");
    play.innerHTML = ICON_PLAY;
    media.appendChild(play);
    card.appendChild(media);
    card.appendChild(el("span", "aph-vlabel", t("Assistir ao vídeo", "Watch the video")));
    card.addEventListener("click", function () { startPlayer(wrap, card, vid); });
    wrap.appendChild(card);
    wrap.appendChild(el("p", "aph-vhint", t("Ou siga os passos abaixo.", "Or follow the steps below.")));
    return wrap;
  }

  function guideCard(g, section, step) {
    var card = el("div", "aph-card");
    card.appendChild(el("p", "aph-card-title", L(g.title)));
    card.appendChild(el("p", "aph-card-sum", L(g.summary)));
    var gtag = videoTag(g);
    if (gtag) { card.appendChild(gtag); }
    var gside = sideTag(g);
    if (gside) { card.appendChild(gside); }
    var row = el("div", "aph-row");
    var open = button("aph-primary", t("Ver passo a passo", "See step by step"));
    open.addEventListener("click", function () { renderGuide(g.id, section, step); });
    row.appendChild(open);
    var cp = copyButton(deepLink(g.id, section, step));
    row.appendChild(cp.button);
    card.appendChild(row);
    card.appendChild(cp.note);
    return card;
  }

  function quietCard(g) {
    var b = button("aph-card");
    b.appendChild(el("span", "aph-card-title", L(g.title)));
    b.appendChild(el("span", "aph-card-sum", L(g.summary)));
    b.firstChild.style.display = "block";
    b.lastChild.style.display = "block";
    var qtag = videoTag(g);
    if (qtag) { b.appendChild(qtag); }
    var qside = sideTag(g);
    if (qside) { b.appendChild(qside); }
    b.addEventListener("click", function () { renderGuide(g.id); });
    return b;
  }

  // The one side button, for staff only: a quiet text button above the search.
  function buildSideRow() {
    var row = el("p", "aph-side-row");
    sideBtn = button("aph-side", side === "admin" ? t("Ver guias do cliente", "See client guides") : t("Voltar aos guias do administrador", "Back to admin guides"));
    sideBtn.addEventListener("click", function () {
      side = side === "admin" ? "client" : "admin";
      renderHome();
    });
    row.appendChild(sideBtn);
    return row;
  }

  function renderHome() {
    stopPlayer();
    openView = null;
    sideBtn = null;
    clear(bodyEl);
    var staff = isStaff();
    if (staff) { bodyEl.appendChild(buildSideRow()); }
    var sideGuides = HC.filterByAudience(guides && guides.guides, side);
    if (!sideGuides.length) {
      bodyEl.appendChild(el("p", "aph-state aph-muted", staff ? t("Os guias deste lado estão sendo preparados.", "The guides for this side are being prepared.") : t("Os guias estão sendo preparados.", "The guides are being prepared.")));
    } else {
      var key = screenKey();
      var page = guides && guides.pages && Object.prototype.hasOwnProperty.call(guides.pages, key) ? guides.pages[key] : null;
      var items = [];
      if (page) {
        (Array.isArray(page.guides) ? page.guides : []).forEach(function (id) {
          var g = findGuideOn(id, side);
          if (g) { items.push(g); }
        });
      }
      // The overview shows only when at least one of its guides is on this side.
      if (items.length) {
        bodyEl.appendChild(el("h3", "aph-h", L(page.title)));
        if (L(page.overview)) { bodyEl.appendChild(el("p", "aph-p", L(page.overview))); }
        items.forEach(function (g) { bodyEl.appendChild(quietCard(g)); });
      }
    }
    bodyEl.appendChild(buildSearch());
    var lib = el("a", "aph-link", t("Abrir a biblioteca completa", "Open the full library"));
    lib.href = libraryLink();
    lib.setAttribute("target", "_blank");
    lib.setAttribute("rel", "noopener");
    var libWrap = el("p", "aph-p");
    libWrap.style.marginTop = "16px";
    libWrap.appendChild(lib);
    bodyEl.appendChild(libWrap);
    bodyEl.appendChild(el("p", "aph-tip", t("Dica: toque e segure qualquer botão para aprender sobre ele.", "Tip: press and hold any button to learn about it.")));
  }

  // The same ask flow help.html uses.
  function buildSearch() {
    var wrap = el("div");
    var form = el("form", "aph-form");
    var input = el("input", "aph-input");
    input.type = "text";
    input.maxLength = 300;
    input.setAttribute("autocomplete", "off");
    input.setAttribute("placeholder", t("Pergunte: como envio um orçamento?", "Ask: how do I send an estimate?"));
    input.setAttribute("aria-label", t("Pergunte: como envio um orçamento?", "Ask: how do I send an estimate?"));
    var go = button("aph-primary");
    go.type = "submit";
    var gi = el("span", "aph-ico");
    gi.innerHTML = ICON_SEARCH;
    go.appendChild(gi);
    var goLabel = el("span", null, t("Perguntar", "Ask"));
    go.appendChild(goLabel);
    form.appendChild(input);
    form.appendChild(go);
    var out = el("div");
    out.setAttribute("aria-live", "polite");
    wrap.appendChild(form);
    wrap.appendChild(out);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = input.value.replace(/^\s+|\s+$/g, "");
      clear(out);
      if (q.length < 3) { out.appendChild(el("p", "aph-state aph-error", t("Escreva pelo menos 3 letras.", "Write at least 3 letters."))); return; }
      var askedSide = HC.effectiveAudience(isStaff(), side);
      go.disabled = true;
      if (sideBtn) { sideBtn.disabled = true; }
      go.setAttribute("aria-busy", "true");
      goLabel.textContent = t("Buscando...", "Searching...");
      out.appendChild(el("p", "aph-state aph-muted", t("Buscando o guia certo...", "Finding the right guide...")));
      ask(q, askedSide).then(function (r) { clear(out); renderAnswer(out, r, askedSide); }, function (err) {
        clear(out);
        var msg = t("Não foi possível buscar agora. Tente de novo.", "Could not search right now. Try again.");
        if (err && err.status === 429) { msg = t("Muitas perguntas em pouco tempo. Tente de novo em alguns minutos.", "Too many questions in a short time. Try again in a few minutes."); }
        if (err && err.status === 401) { msg = t("Entre de novo para perguntar.", "Sign in again to ask."); }
        out.appendChild(el("p", "aph-state aph-error", msg));
      }).then(function () {
        go.disabled = false;
        if (sideBtn) { sideBtn.disabled = false; }
        go.removeAttribute("aria-busy");
        goLabel.textContent = t("Perguntar", "Ask");
      });
    });
    return wrap;
  }

  function ask(question, audience) {
    return getToken().then(function (token) {
      return fetch(workerUrl() + "/api/help/ask", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ question: question, language: lang(), page_key: screenKey(), audience: audience })
      });
    }).then(function (res) {
      if (!res.ok) { var e = new Error("status " + res.status); e.status = res.status; throw e; }
      return res.json();
    }).then(function (data) {
      return loadGuides().then(function () { return data; });
    });
  }

  // A card for a guide on the other side, for staff: the button flips the side and opens it.
  function otherSideCard(g, otherSide) {
    var card = el("div", "aph-card");
    card.appendChild(el("p", "aph-card-title", L(g.title)));
    card.appendChild(el("p", "aph-card-sum", L(g.summary)));
    var tag = sideTag(g);
    if (tag) { card.appendChild(tag); }
    var row = el("div", "aph-row");
    var open = button("aph-primary", otherSide === "client" ? t("Ver o guia do cliente", "See the client guide") : t("Ver o guia do administrador", "See the admin guide"));
    open.addEventListener("click", function () { side = otherSide; renderGuide(g.id); });
    row.appendChild(open);
    card.appendChild(row);
    return card;
  }

  function renderAnswer(out, r, askedSide) {
    var ids = (r && Array.isArray(r.guide_ids)) ? r.guide_ids : [];
    var cards = [];
    ids.forEach(function (id) { var g = (typeof id === "string") ? findGuideOn(id, askedSide) : null; if (g && cards.length < 3) { cards.push(g); } });
    if (!r || !r.found || !cards.length) {
      var others = [];
      var otherSide = askedSide === "admin" ? "client" : "admin";
      if (isStaff() && r && Array.isArray(r.other_side)) {
        r.other_side.forEach(function (id) { var og = (typeof id === "string") ? findGuideOn(id, otherSide) : null; if (og && others.length < 2) { others.push(og); } });
      }
      if (others.length) {
        out.appendChild(el("p", "aph-state", t("Ainda não temos um guia deste lado.", "We do not have a guide for this side yet.")));
        others.forEach(function (og) { out.appendChild(otherSideCard(og, otherSide)); });
        return;
      }
      var msg = t("Ainda não temos um guia para isso.", "We do not have a guide for that yet.");
      if (r && r.logged === true) { msg += " " + t("Sua pergunta foi anotada.", "Your question was noted."); }
      out.appendChild(el("p", "aph-state", msg));
      return;
    }
    if (typeof r.reply === "string" && r.reply) { out.appendChild(el("p", "aph-p", r.reply)); }
    cards.forEach(function (g) {
      var sec = (r.best && r.best.guide === g.id) ? r.best.section : null;
      out.appendChild(guideCard(g, sec, null));
    });
  }

  function renderGuide(id, sectionId, step) {
    var g = findGuideOn(id, side);
    if (!g) { renderHome(); return; }
    stopPlayer();
    sideBtn = null;
    openView = { id: id, section: sectionId, step: step };
    clear(bodyEl);
    var back = button("aph-quiet");
    var bi = el("span", "aph-ico");
    bi.innerHTML = ICON_BACK;
    back.appendChild(bi);
    back.appendChild(doc.createTextNode(t("Voltar", "Back")));
    back.addEventListener("click", renderHome);
    bodyEl.appendChild(back);
    bodyEl.appendChild(el("h3", "aph-h", L(g.title)));
    bodyEl.appendChild(el("p", "aph-p aph-muted", L(g.summary)));
    var gtag2 = sideTag(g);
    if (gtag2) { var tagWrap = el("p", "aph-p"); tagWrap.appendChild(gtag2); bodyEl.appendChild(tagWrap); }
    var vblock = videoBlock(g);
    if (vblock) { bodyEl.appendChild(vblock); }
    var hitEl = null;
    (Array.isArray(g.sections) ? g.sections : []).forEach(function (s) {
      bodyEl.appendChild(el("h4", "aph-sec", L(s.title)));
      (Array.isArray(s.steps) ? s.steps : []).forEach(function (st) {
        var box = el("div", "aph-step");
        box.appendChild(el("p", "aph-step-text", st.n + ". " + L(st.text)));
        var src = st.image ? imageUrl(L(st.image)) : "";
        if (src) {
          var ib = button("aph-img");
          ib.setAttribute("aria-label", t("Ampliar a imagem", "Enlarge the picture"));
          var im = el("img");
          im.loading = "lazy";
          im.alt = L(st.text);
          im.src = src;
          ib.appendChild(im);
          ib.addEventListener("click", function () { openLightbox(src, L(st.text)); });
          box.appendChild(ib);
        }
        if (s.id === sectionId && (step === null || step === undefined || step === st.n)) {
          if (!hitEl) { hitEl = box; }
          if (step) { box.classList.add("aph-hit"); }
        }
        bodyEl.appendChild(box);
      });
    });
    var cp = copyButton(deepLink(g.id, sectionId, step));
    var row = el("div", "aph-row");
    row.appendChild(cp.button);
    bodyEl.appendChild(row);
    bodyEl.appendChild(cp.note);
    if (hitEl && hitEl.scrollIntoView) { try { hitEl.scrollIntoView({ block: "start" }); } catch (e) { /* older engines */ } }
    else { bodyEl.scrollTop = 0; }
  }

  // ---- picture layer (in page, not a new window) ------------------------
  function openLightbox(src, alt) {
    closeLightbox();
    lightEl = el("div", "aphelp-root aphelp-light");
    lightEl.setAttribute("role", "dialog");
    lightEl.setAttribute("aria-modal", "true");
    var im = el("img");
    im.src = src;
    im.alt = alt || "";
    var x = button("aphelp-x");
    x.innerHTML = ICON_CLOSE;
    x.setAttribute("aria-label", t("Fechar", "Close"));
    x.addEventListener("click", function (e) { e.stopPropagation(); closeLightbox(); });
    lightEl.appendChild(im);
    lightEl.appendChild(x);
    lightEl.addEventListener("click", closeLightbox);
    doc.body.appendChild(lightEl);
    var shown = lightEl;
    setTimeout(function () { shown.classList.add("aph-in"); }, 16);
  }
  function closeLightbox() {
    if (!lightEl) { return; }
    if (lightEl.parentNode) { lightEl.parentNode.removeChild(lightEl); }
    lightEl = null;
  }

  // ---- finding the guide for a pressed button ---------------------------
  function inEditable(node) {
    return !!(node && node.closest && node.closest("input,textarea,select,[contenteditable=''],[contenteditable='true']"));
  }
  function hasOwnContextMenu(node) {
    for (var n = node; n && n.nodeType === 1; n = n.parentNode) {
      if (n.oncontextmenu || (n.hasAttribute && n.hasAttribute("oncontextmenu"))) { return true; }
    }
    return false;
  }
  function visibleText(b) { return (typeof b.innerText === "string" && b.innerText) ? b.innerText : b.textContent; }

  function resolveFrom(node) {
    if (node && node.nodeType === 3) { node = node.parentNode; }
    if (!node || !node.closest || !guides) { return null; }
    if (inEditable(node) || node.closest(".aphelp-root") || node.closest("[data-no-help]")) { return null; }
    var dh = node.closest("[data-help]");
    var btn = node.closest("button,a,[role=button]");
    if (!dh && !btn) { return null; }
    var texts = [];
    if (btn) { texts.push(visibleText(btn)); texts.push(btn.getAttribute("aria-label")); }
    // Only the guides of the side this page starts on can be matched, so a client never lands on an admin guide.
    var res = HC.resolveTarget({ dataHelp: dh ? dh.getAttribute("data-help") : null, texts: texts }, dataFor(defaultSide()));
    return res ? { res: res, el: btn || dh } : null;
  }

  // ---- press and hold (touch) -------------------------------------------
  function pressEffect(node) {
    if (!node || reducedMotion()) { return; }
    var prevT = node.style.transform, prevTr = node.style.transition;
    node.style.transition = "transform 120ms ease-out";
    node.style.transform = "scale(0.97)";
    setTimeout(function () { node.style.transform = prevT; node.style.transition = prevTr; }, 120);
  }
  function cancelPress() {
    if (press && press.timer) { clearTimeout(press.timer); }
    press = null;
  }
  function onPointerDown(e) {
    cancelPress();
    if (e.pointerType !== "touch") { return; }
    var hit = resolveFrom(e.target);
    if (!hit || hasOwnContextMenu(e.target)) { return; }
    var x = e.clientX, y = e.clientY;
    press = { x: x, y: y, hit: hit, timer: setTimeout(function () {
      var h = press && press.hit;
      press = null;
      if (!h) { return; }
      swallowClick = true;
      if (swallowTimer) { clearTimeout(swallowTimer); }
      // A finger lifted somewhere else produces no click; do not eat a later real one.
      swallowTimer = setTimeout(function () { swallowClick = false; }, 5000);
      pressEffect(h.el);
      openSheet(h.res);
    }, HC.LONG_PRESS_MS) };
  }
  function onPointerMove(e) {
    if (press && HC.movedTooFar(press.x, press.y, e.clientX, e.clientY)) { cancelPress(); }
  }
  function onClickCapture(e) {
    if (!swallowClick) { return; }
    swallowClick = false;
    if (swallowTimer) { clearTimeout(swallowTimer); swallowTimer = null; }
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) { e.stopImmediatePropagation(); }
  }

  // ---- right click (computer) -------------------------------------------
  function closeMenu() {
    if (menuEl && menuEl.parentNode) { menuEl.parentNode.removeChild(menuEl); }
    menuEl = null;
  }
  function onContextMenu(e) {
    // Touch long press already handled it; keep the system menu from stacking on the sheet.
    if (swallowClick) { e.preventDefault(); return; }
    // Buttons that already use right click (message templates) win.
    if (e.defaultPrevented) { return; }
    var hit = resolveFrom(e.target);
    if (!hit) { return; }
    e.preventDefault();
    closeMenu();
    menuEl = el("div", "aphelp-root aphelp-menu");
    menuEl.setAttribute("role", "menu");
    var item = button(null, t("Aprender sobre este botão", "Learn about this button"));
    item.setAttribute("role", "menuitem");
    item.addEventListener("click", function () { closeMenu(); openSheet(hit.res); });
    menuEl.appendChild(item);
    doc.body.appendChild(menuEl);
    var w = window.innerWidth || 800, h = window.innerHeight || 600;
    menuEl.style.left = Math.max(8, Math.min(e.clientX, w - 220)) + "px";
    menuEl.style.top = Math.max(8, Math.min(e.clientY, h - 64)) + "px";
    var shown = menuEl;
    setTimeout(function () { shown.classList.add("aph-in"); }, 16);
    try { item.focus(); } catch (e2) { /* focus is a courtesy */ }
  }
  function onDocPointerDown(e) {
    if (menuEl && !menuEl.contains(e.target)) { closeMenu(); }
  }

  // ---- keyboard ----------------------------------------------------------
  function onKeyDown(e) {
    if (e.key === "Escape" || e.key === "Esc") {
      if (lightEl) { closeLightbox(); e.stopPropagation(); return; }
      if (menuEl) { closeMenu(); return; }
      if (overlay) { closeSheet(false); e.stopPropagation(); }
      return;
    }
    // Keep Tab inside the sheet while it is open.
    if (e.key === "Tab" && sheet && !lightEl) {
      var f = sheet.querySelectorAll("button:not([disabled]),input,a[href]");
      if (!f.length) { return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!sheet.contains(doc.activeElement)) { e.preventDefault(); first.focus(); }
    }
  }

  // ---- first time tip ----------------------------------------------------
  function showFirstTip() {
    if (store("apex_learn_tip_seen") === "1") { return; }
    store("apex_learn_tip_seen", "1");
    var tip = t("Dica: toque e segure qualquer botão para aprender sobre ele.", "Tip: press and hold any button to learn about it.");
    setTimeout(function () {
      if (typeof window.gmToast === "function") { window.gmToast(tip); return; }
      var n = el("div", "aphelp-root aphelp-toast", tip);
      n.setAttribute("role", "status");
      doc.body.appendChild(n);
      setTimeout(function () { if (n.parentNode) { n.parentNode.removeChild(n); } }, 5000);
    }, 1500);
  }

  // ---- start -------------------------------------------------------------
  function init() {
    injectStyles();
    placeButton();
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("pointerdown", onDocPointerDown, true);
    doc.addEventListener("pointermove", onPointerMove, true);
    doc.addEventListener("pointerup", cancelPress, true);
    doc.addEventListener("pointercancel", cancelPress, true);
    doc.addEventListener("scroll", cancelPress, true);
    doc.addEventListener("click", onClickCapture, true);
    doc.addEventListener("contextmenu", onContextMenu, false);
    doc.addEventListener("keydown", onKeyDown, true);
    doc.addEventListener("apex:langchange", onLangChange);
    window.addEventListener("resize", closeMenu);
    // The guide file is needed before a press can be matched to a guide.
    loadGuides()["catch"](function () { /* the sheet shows the offline state when opened */ });
    showFirstTip();
  }

  if (doc.readyState === "loading") { doc.addEventListener("DOMContentLoaded", init); } else { init(); }
}());
