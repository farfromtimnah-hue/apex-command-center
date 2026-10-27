// Learn (Aprenda): the switch and the address.
// enabled is ON for everyone since 2026-10-26. While it is false the "?" button is not added, long press and
// right click do nothing, and the widget makes no network call. Turn it on by
// changing false to true here (and in ios/App/App/public/help-config.js).
// Guides come from the Worker (loader at the bottom), never from the app bundle.
// The site address below is used for the hero photo and for the last resort
// copy of the public guides. It matches CNAME.
(function () {
  var HELP_BASE = "https://apex.resonateai.online/";
  // Preview switch: only the browser that holds aprenda-preview = on sees the feature.
  // Used to test it on the real site before it is turned on for everyone.
  var preview = false;
  // A link ending in ?aprenda=on turns the preview on in that browser; ?aprenda=off turns it off.
  try {
    var m = /[?&]aprenda=(on|off)(&|$)/.exec(window.location.search);
    if (m) { if (m[1] === "on") { window.localStorage.setItem("aprenda-preview", "on"); } else { window.localStorage.removeItem("aprenda-preview"); } }
  } catch (e) { /* works without storage */ }
  try { preview = window.localStorage.getItem("aprenda-preview") === "on"; } catch (e) { preview = false; }
  // 2026-10-26: switched ON for everyone (Nicole: "Website live now and test flight").
  // preview stays read so a browser can still be inspected, but it no longer gates the feature.
  window.APEX_HELP = { enabled: true, base: HELP_BASE };

  // ---- the guide loader (security phase B) -------------------------------
  // Guides now come from the Worker, filtered by the verified login, one
  // language at a time, with pictures and videos as signed links that last 15
  // minutes. Signed out visitors get only the public guides. The old public
  // file help/guides.json is kept as a last resort ONLY when the Worker cannot
  // be reached, and then only its public guides are shown.
  //   opts: { lang: "pt"|"en", signedIn: bool, staff: bool, token: function -> Promise<string>, workerUrl: string }
  // Resolves { version, guides, pages, signedOut?, fallback? }. Rejects only when nothing at all could be loaded.
  function workerBase(o) { return String(o.workerUrl || window.WORKER_URL || "https://apex-api.farfromtimnah.workers.dev").replace(/\/$/, ""); }
  function getJson(url, token) {
    var init = { cache: "no-store" };
    if (token) { init.headers = { "Authorization": "Bearer " + token }; }
    return fetch(url, init).then(function (res) {
      if (!res.ok) { var e = new Error("status " + res.status); e.status = res.status; throw e; }
      return res.json();
    }).then(function (d) {
      if (!d || d.version !== 1 || !Array.isArray(d.guides)) { throw new Error("shape"); }
      return d;
    });
  }
  // The staff page signs in after it loads: keep asking for the token for about 12 seconds.
  function waitToken(fn, tries) {
    return Promise.resolve().then(fn).then(function (tok) { if (!tok) { throw new Error("no session"); } return tok; }, function (err) {
      if (tries <= 0) { throw err; }
      return new Promise(function (r) { setTimeout(r, 400); }).then(function () { return waitToken(fn, tries - 1); });
    });
  }
  function mergeSides(a, b) {
    var out = { version: 1, lang: a.lang, guides: a.guides.concat(b.guides), pages: {} };
    [a.pages || {}, b.pages || {}].forEach(function (pages) {
      Object.keys(pages).forEach(function (k) {
        if (!out.pages[k]) { out.pages[k] = pages[k]; return; }
        var ids = out.pages[k].guides.concat(pages[k].guides.filter(function (id) { return out.pages[k].guides.indexOf(id) === -1; }));
        out.pages[k] = Object.assign({}, out.pages[k], { guides: ids });
      });
    });
    return out;
  }
  function staticPublic(o) {
    var base = String(window.APEX_HELP.base || "");
    return fetch(base + "help/guides.json", { cache: "no-cache" }).then(function (res) {
      if (!res.ok) { throw new Error("status " + res.status); }
      return res.json();
    }).then(function (d) {
      var HC = window.HelpCore;
      if (!d || d.version !== 1 || !Array.isArray(d.guides) || !HC || typeof HC.filterGuides !== "function") { throw new Error("shape"); }
      var f = HC.filterGuides(d, null, "client");
      f.signedOut = true; f.fallback = true;
      return f;
    });
  }
  function publicSet(o) {
    return getJson(workerBase(o) + "/api/help/public?lang=" + (o.lang === "en" ? "en" : "pt")).then(function (d) {
      d.signedOut = true;
      return d;
    }, function () { return staticPublic(o); });
  }
  window.APEX_HELP.loadGuides = function (opts) {
    var o = opts || {};
    var lang = o.lang === "en" ? "en" : "pt";
    if (!o.signedIn || typeof o.token !== "function") { return publicSet(o); }
    var root = workerBase(o) + "/api/help/guides?lang=" + lang;
    return waitToken(o.token, 30).then(function (token) {
      if (o.staff) {
        return Promise.all([getJson(root + "&audience=admin", token), getJson(root + "&audience=client", token)]).then(function (two) { return mergeSides(two[0], two[1]); });
      }
      return getJson(root, token);
    }).then(null, function () { return publicSet(o); });
  };
}());
