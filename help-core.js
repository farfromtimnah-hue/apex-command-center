// Learn (Aprenda): the pure, DOM-free rules of the self-serve help system.
// One file, two homes: the browser loads it with a script tag (window.HelpCore)
// and the Node tests require() it. Nothing here touches the page, the network
// or storage, so every rule can be tested on its own.
//
// What lives here: the text normalizer, the button-to-guide resolver, the deep
// link parser, the long press timing rule, the guide file validator, the model
// reply validator, and the flag guard.
(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.HelpCore = factory(); }
}(typeof self !== "undefined" ? self : this, function () {

  var LONG_PRESS_MS = 550;
  var MOVE_PX = 10;
  var ID_RE = /^[A-Za-z0-9_-]{1,60}$/;
  var DASH_RE = /[–—]/;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function isId(v) { return typeof v === "string" && ID_RE.test(v); }

  // Lowercase, no accents, one space between words, no edge spaces. Used on
  // both sides of every label comparison so "Orçamento" matches "orcamento".
  function normalize(s) {
    if (s === null || s === undefined) { return ""; }
    var out = String(s).toLowerCase();
    if (out.normalize) { out = out.normalize("NFD"); }
    return out.replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").replace(/^ | $/g, "");
  }

  // ---- resolver ---------------------------------------------------------
  var labelCacheData = null;
  var labelCacheMap = null;

  function labelMap(data) {
    if (labelCacheData === data && labelCacheMap) { return labelCacheMap; }
    var map = {};
    var guides = (data && Array.isArray(data.guides)) ? data.guides : [];
    for (var g = 0; g < guides.length; g++) {
      var buttons = Array.isArray(guides[g].buttons) ? guides[g].buttons : [];
      for (var b = 0; b < buttons.length; b++) {
        var langs = ["pt", "en"];
        for (var l = 0; l < langs.length; l++) {
          var list = buttons[b].labels && buttons[b].labels[langs[l]];
          if (!Array.isArray(list)) { continue; }
          for (var i = 0; i < list.length; i++) {
            var key = normalize(list[i]);
            // The first match wins, so a later duplicate never overrides it.
            if (key && !has(map, key)) { map[key] = { guide: guides[g].id, section: buttons[b].section || null, step: (typeof buttons[b].step === "number") ? buttons[b].step : null }; }
          }
        }
      }
    }
    labelCacheData = data;
    labelCacheMap = map;
    return map;
  }

  function findGuide(data, id) {
    var guides = (data && Array.isArray(data.guides)) ? data.guides : [];
    for (var i = 0; i < guides.length; i++) { if (guides[i].id === id) { return guides[i]; } }
    return null;
  }

  function hasSection(guide, id) {
    var secs = Array.isArray(guide.sections) ? guide.sections : [];
    for (var i = 0; i < secs.length; i++) { if (secs[i].id === id) { return true; } }
    return false;
  }

  // info: { dataHelp: "guide#section#step" or null, texts: [visible text, aria-label] }
  // Returns { guide, section, step } (section and step may be null) or null.
  function resolveTarget(info, data) {
    if (!info || !data || !Array.isArray(data.guides) || !data.guides.length) { return null; }
    if (typeof info.dataHelp === "string" && info.dataHelp) {
      var parts = info.dataHelp.split("#");
      var g = parts[0], s = parts.length > 1 ? parts[1] : "", n = parts.length > 2 ? parts[2] : "";
      var step = null;
      var valid = parts.length <= 3 && isId(g) && (s === "" || isId(s)) && (n === "" || /^[1-9][0-9]{0,2}$/.test(n));
      if (valid) {
        var guide = findGuide(data, g);
        if (guide && (s === "" || hasSection(guide, s))) {
          if (n !== "") { step = parseInt(n, 10); }
          return { guide: g, section: s === "" ? null : s, step: step };
        }
      }
    }
    var texts = Array.isArray(info.texts) ? info.texts : [];
    var map = labelMap(data);
    for (var t = 0; t < texts.length; t++) {
      var key = normalize(texts[t]);
      if (key && has(map, key)) { return { guide: map[key].guide, section: map[key].section, step: map[key].step }; }
    }
    return null;
  }

  // ---- deep links -------------------------------------------------------
  // help.html?guide=ID&section=SECTION&step=N&lang=pt|en. Anything that is not
  // a plain id comes back as null, never as a repaired value.
  function parseDeepLink(search) {
    var out = { guide: null, section: null, step: null, lang: null };
    if (typeof search !== "string" || !search) { return out; }
    var p;
    try { p = new URLSearchParams(search); } catch (e) { return out; }
    var g = p.get("guide"), s = p.get("section"), n = p.get("step"), l = p.get("lang");
    if (isId(g)) { out.guide = g; }
    if (isId(s)) { out.section = s; }
    if (typeof n === "string" && /^[1-9][0-9]{0,2}$/.test(n)) { out.step = parseInt(n, 10); }
    if (l === "pt" || l === "en") { out.lang = l; }
    return out;
  }

  // ---- long press -------------------------------------------------------
  // events[0] is the pointer down {type:"down", x, y, t}. Later events are
  // "move", "up", "cancel" or "scroll", in time order. endT is "now".
  // A move of MORE than MOVE_PX from the start cancels; exactly MOVE_PX does not.
  function longPressOutcome(events, endT) {
    var down = events && events[0];
    if (!down || down.type !== "down") { return { fired: false, at: null }; }
    for (var i = 1; i < events.length; i++) {
      var ev = events[i];
      if (ev.t - down.t >= LONG_PRESS_MS) { return { fired: true, at: down.t + LONG_PRESS_MS }; }
      if (ev.type === "move") {
        if (movedTooFar(down.x, down.y, ev.x, ev.y)) { return { fired: false, at: null }; }
      } else if (ev.type === "up" || ev.type === "cancel" || ev.type === "scroll") {
        return { fired: false, at: null };
      }
    }
    if (endT - down.t >= LONG_PRESS_MS) { return { fired: true, at: down.t + LONG_PRESS_MS }; }
    return { fired: false, at: null };
  }

  function movedTooFar(x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0;
    return Math.sqrt(dx * dx + dy * dy) > MOVE_PX;
  }

  // ---- guide file validator --------------------------------------------
  function bi(v) { return isObj(v) && typeof v.pt === "string" && v.pt.replace(/\s/g, "") !== "" && typeof v.en === "string" && v.en.replace(/\s/g, "") !== ""; }

  function validateGuides(data) {
    var errs = [];
    if (!isObj(data)) { return ["file is not an object"]; }
    if (data.version !== 1) { errs.push("version must be 1"); }
    if (!Array.isArray(data.guides)) { errs.push("guides must be an array"); return errs; }
    if (!isObj(data.pages)) { errs.push("pages must be an object"); }
    var seen = {};

    function checkText(v, where) {
      if (!bi(v)) { errs.push(where + ": needs non-empty pt and en"); return; }
      if (DASH_RE.test(v.pt) || DASH_RE.test(v.en)) { errs.push(where + ": no long dash or en dash in visible text"); }
    }

    data.guides.forEach(function (g, gi) {
      var w = "guide[" + gi + "]";
      if (!isObj(g)) { errs.push(w + ": not an object"); return; }
      if (!isId(g.id)) { errs.push(w + ": id must be a plain id"); }
      else if (has(seen, g.id)) { errs.push(w + ": duplicate guide id " + g.id); }
      else { seen[g.id] = true; }
      w = "guide " + g.id;
      checkText(g.title, w + " title");
      checkText(g.summary, w + " summary");
      if (!isObj(g.keywords) || !Array.isArray(g.keywords.pt) || !Array.isArray(g.keywords.en)) { errs.push(w + ": keywords needs pt and en arrays"); }
      if (g.video !== null && g.video !== undefined) {
        if (!isObj(g.video) || typeof g.video.pt !== "string" || typeof g.video.en !== "string") { errs.push(w + ": video must be null or {pt, en}"); }
      }
      var secIds = {};
      var stepNums = {};
      if (!Array.isArray(g.sections)) { errs.push(w + ": sections must be an array"); }
      (Array.isArray(g.sections) ? g.sections : []).forEach(function (s, si) {
        var sw = w + " section[" + si + "]";
        if (!isObj(s)) { errs.push(sw + ": not an object"); return; }
        if (!isId(s.id)) { errs.push(sw + ": id must be a plain id"); }
        else if (has(secIds, s.id)) { errs.push(sw + ": duplicate section id " + s.id); }
        else { secIds[s.id] = true; stepNums[s.id] = {}; }
        checkText(s.title, sw + " title");
        if (!Array.isArray(s.steps)) { errs.push(sw + ": steps must be an array"); return; }
        s.steps.forEach(function (st, ti) {
          var tw = sw + " step[" + ti + "]";
          if (!isObj(st)) { errs.push(tw + ": not an object"); return; }
          if (typeof st.n !== "number" || st.n < 1 || Math.floor(st.n) !== st.n) { errs.push(tw + ": n must be a whole number from 1"); }
          else if (isId(s.id) && stepNums[s.id]) {
            if (has(stepNums[s.id], String(st.n))) { errs.push(tw + ": duplicate step number " + st.n); }
            stepNums[s.id][String(st.n)] = true;
          }
          checkText(st.text, tw + " text");
          if (st.image !== null && st.image !== undefined) {
            if (!isObj(st.image) || typeof st.image.pt !== "string" || typeof st.image.en !== "string" || !st.image.pt || !st.image.en) { errs.push(tw + ": image must be null or {pt, en} paths"); }
          }
        });
      });
      var buttons = Array.isArray(g.buttons) ? g.buttons : [];
      buttons.forEach(function (b, bi2) {
        var bw = w + " button[" + bi2 + "]";
        if (!isObj(b) || !isObj(b.labels) || !Array.isArray(b.labels.pt) || !Array.isArray(b.labels.en) || !b.labels.pt.length || !b.labels.en.length) { errs.push(bw + ": labels needs non-empty pt and en arrays"); return; }
        if (!has(secIds, b.section)) { errs.push(bw + ": section " + b.section + " does not exist"); return; }
        if (!has(stepNums[b.section], String(b.step))) { errs.push(bw + ": step " + b.step + " does not exist in section " + b.section); }
      });
    });

    if (isObj(data.pages)) {
      Object.keys(data.pages).forEach(function (k) {
        var p = data.pages[k], pw = "page " + k;
        if (!isObj(p)) { errs.push(pw + ": not an object"); return; }
        checkText(p.title, pw + " title");
        checkText(p.overview, pw + " overview");
        if (!Array.isArray(p.guides)) { errs.push(pw + ": guides must be an array"); return; }
        p.guides.forEach(function (id) { if (!has(seen, id)) { errs.push(pw + ": lists unknown guide " + id); } });
      });
    }
    return errs;
  }

  // ---- model reply validator -------------------------------------------
  // index: { ids: { guideId: { sections: { sectionId: true } } } } (the same
  // shape the Worker builds). The model's text is never trusted: only ids that
  // exist survive, and the reply is plain text, cut and cleaned.
  var NOT_FOUND = function () { return { found: false, guide_ids: [], best: null, reply: "" }; };

  function validateReply(text, index) {
    if (typeof text !== "string" || !index || !isObj(index.ids)) { return NOT_FOUND(); }
    var t = text.replace(/^\s+|\s+$/g, "");
    if (t.indexOf("```") === 0) { t = t.replace(/^```[A-Za-z]*\s*/, "").replace(/\s*```$/, ""); }
    var obj;
    try { obj = JSON.parse(t); } catch (e) { return NOT_FOUND(); }
    if (!isObj(obj)) { return NOT_FOUND(); }

    var ids = [];
    if (Array.isArray(obj.guide_ids)) {
      for (var i = 0; i < obj.guide_ids.length && ids.length < 3; i++) {
        var id = obj.guide_ids[i];
        if (typeof id === "string" && has(index.ids, id) && ids.indexOf(id) === -1) { ids.push(id); }
      }
    }
    var best = null;
    if (isObj(obj.best) && typeof obj.best.guide === "string" && typeof obj.best.section === "string" &&
        has(index.ids, obj.best.guide) && isObj(index.ids[obj.best.guide].sections) && has(index.ids[obj.best.guide].sections, obj.best.section)) {
      best = { guide: obj.best.guide, section: obj.best.section };
      if (ids.indexOf(best.guide) === -1) { ids.unshift(best.guide); ids = ids.slice(0, 3); }
    }
    if (!ids.length) { return NOT_FOUND(); }
    var reply = "";
    if (typeof obj.reply === "string") { reply = obj.reply.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(/^\s+|\s+$/g, "").slice(0, 400); }
    return { found: true, guide_ids: ids, best: best, reply: reply };
  }

  // ---- flag guard -------------------------------------------------------
  // The whole feature is off unless the config says enabled === true exactly.
  function isEnabled(win) {
    return !!(win && win.APEX_HELP && win.APEX_HELP.enabled === true);
  }

  return {
    LONG_PRESS_MS: LONG_PRESS_MS,
    MOVE_PX: MOVE_PX,
    ID_RE: ID_RE,
    normalize: normalize,
    resolveTarget: resolveTarget,
    parseDeepLink: parseDeepLink,
    longPressOutcome: longPressOutcome,
    movedTooFar: movedTooFar,
    validateGuides: validateGuides,
    validateReply: validateReply,
    isEnabled: isEnabled
  };
}));
