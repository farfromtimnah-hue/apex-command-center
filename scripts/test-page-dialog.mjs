// The in-page confirmation helper (pageDialog) that replaced the browser's
// confirm/alert/prompt boxes in dashboard, client, finance-new and calendar.
// No network. Pulls the helper's source out of each page and runs it against
// a tiny fake DOM: Keep sends nothing, Yes runs the action once even when
// pressed twice, Escape and a tap outside mean Keep, focus lands inside.
import fs from "node:fs";
import vm from "node:vm";

var PAGES = ["dashboard.html", "client.html", "finance-new.html", "calendar.html",
  "clients.html", "documents.html", "finance.html", "sessions.html", "settings.html",
  "meeting-prep.html", "apex-invoice-view.html"];
// Pages that only needed the one-line message (they had alert boxes, no questions).
var NOTICE_PAGES = ["dashboard.html", "client.html",
  "clients.html", "documents.html", "finance.html", "sessions.html", "settings.html",
  "meeting-prep.html", "add-user.html", "contract-review.html", "client-analytics.html"];
var IOS = "ios/App/App/public/";
var failed = 0;
function check(name, ok) {
  if (!ok) { failed++; }
  console.log((ok ? "ok   " : "FAIL ") + name);
}

function makeEl(tag) {
  var el = {
    tagName: tag, children: [], parentNode: null, style: {}, listeners: {}, className: "",
    attrs: {}, textContent: "", value: "", focused: false,
    appendChild: function(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild: function(c) { el.children = el.children.filter(function(x) { return x !== c; }); c.parentNode = null; },
    setAttribute: function(k, v) { el.attrs[k] = v; },
    addEventListener: function(t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); },
    focus: function() { el.focused = true; doc.activeElement = el; }
  };
  return el;
}
function fire(el, type, ev) {
  ev = ev || {};
  if (!ev.target) { ev.target = el; }
  ev.preventDefault = ev.preventDefault || function() {};
  ev.stopPropagation = ev.stopPropagation || function() {};
  (el.listeners[type] || []).forEach(function(fn) { fn(ev); });
}
var doc;
function load(page) {
  var html = fs.readFileSync(page, "utf8");
  var a = html.indexOf("// BEGIN PAGE DIALOG");
  var b = html.indexOf("// END PAGE DIALOG");
  if (a < 0 || b < 0) { throw new Error(page + ": helper markers missing"); }
  var body = makeEl("body");
  var docListeners = {};
  doc = {
    body: body, activeElement: null,
    createElement: makeEl,
    getElementById: function(id) { return null; },
    addEventListener: function(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
    removeEventListener: function(t, fn) { docListeners[t] = (docListeners[t] || []).filter(function(x) { return x !== fn; }); }
  };
  doc.documentElement = body;
  doc.keydown = function(ev) {
    ev.preventDefault = ev.preventDefault || function() {};
    ev.stopPropagation = ev.stopPropagation || function() {};
    (docListeners.keydown || []).slice().forEach(function(fn) { fn(ev); });
  };
  doc.listenerCount = function() { return (docListeners.keydown || []).length; };
  var ctx = { document: doc };
  vm.createContext(ctx);
  vm.runInContext(html.slice(a, b), ctx);
  return ctx;
}
function buttons(ctx) {
  var ov = doc.body.children[0];
  var out = [];
  (function walk(n) {
    if (n.tagName === "button") { out.push(n); }
    n.children.forEach(walk);
  })(ov);
  return { ov: ov, btns: out };
}

PAGES.concat(PAGES.filter(function(p) { return fs.existsSync(IOS + p); }).map(function(p) { return IOS + p; })).forEach(function(page) {
  var ctx = load(page);
  var yesCount = 0, keepCount = 0, seen = null;
  function open(extra) {
    var o = { message: "Sure?", yes: "Yes, do it", keep: "Keep it",
      onYes: function(v) { yesCount++; seen = v; }, onKeep: function() { keepCount++; } };
    for (var k in extra) { o[k] = extra[k]; }
    return vm.runInContext("pageDialog", ctx)(o);
  }
  // Keep sends nothing
  open();
  var u = buttons(ctx);
  check(page + ": opens and puts the card on the page", u.ov && doc.body.children.length === 1);
  var keepBtn = u.btns.filter(function(b) { return b.textContent === "Keep it"; })[0];
  var yesBtn = u.btns.filter(function(b) { return b.textContent === "Yes, do it"; })[0];
  check(page + ": focus moves into the card (onto Keep)", keepBtn.focused === true);
  check(page + ": no OK / Cancel labels", u.btns.every(function(b) { return !/^(ok|cancel)$/i.test(b.textContent); }));
  fire(keepBtn, "click");
  check(page + ": Keep sends nothing", yesCount === 0 && keepCount === 1 && doc.body.children.length === 0);
  // Yes pressed twice runs once
  open();
  u = buttons(ctx);
  yesBtn = u.btns.filter(function(b) { return b.textContent === "Yes, do it"; })[0];
  fire(yesBtn, "click"); fire(yesBtn, "click");
  check(page + ": Yes twice calls the action once", yesCount === 1 && doc.body.children.length === 0);
  // Escape means keep
  open();
  doc.keydown({ key: "Escape" });
  check(page + ": Escape means keep", yesCount === 1 && keepCount === 2 && doc.body.children.length === 0);
  check(page + ": key listener removed after close", doc.listenerCount() === 0);
  // Tap outside means keep, tap inside does not
  open();
  u = buttons(ctx);
  fire(u.ov.children[0], "click");
  check(page + ": tap inside the card does not close it", doc.body.children.length === 1);
  fire(u.ov, "click");
  check(page + ": tap outside means keep", yesCount === 1 && keepCount === 3 && doc.body.children.length === 0);
  // a second dialog while one is open is ignored
  open();
  check(page + ": second dialog is refused while one is open", open() === false && doc.body.children.length === 1);
  doc.keydown({ key: "Escape" });
  // input: value passed to onYes, Enter in the field means yes, focus on field
  open({ field: { value: "abc" } });
  u = buttons(ctx);
  var input = u.ov.children[0];
  (function find(n) { if (n.tagName === "input") { input = n; } n.children.forEach(find); })(u.ov);
  check(page + ": with a field, focus lands on the field", input.focused === true);
  input.value = "typed";
  fire(input, "keydown", { key: "Enter" });
  doc.keydown({ key: "Enter", target: input });
  check(page + ": Enter in the field sends the typed text once", yesCount === 2 && seen === "typed" && doc.body.children.length === 0);
  // note with no yes button
  open({ yes: "", field: { value: "http://x", readonly: true } });
  u = buttons(ctx);
  check(page + ": note-only card has one button", u.btns.length === 1);
  fire(u.btns[0], "click");
  check(page + ": closing a note-only card sends nothing", yesCount === 2 && doc.body.children.length === 0);
});

// pageNotice: shows the same words in a pill, replaces the earlier one, goes away by itself.
function loadNotice(page) {
  var html = fs.readFileSync(page, "utf8");
  var a = html.indexOf("function pageNotice");
  if (a < 0) { throw new Error(page + ": pageNotice missing"); }
  var b = html.indexOf("\n    }\n", a) + 7;
  var body = makeEl("body");
  var byId = {};
  var timers = [];
  doc = {
    body: body, createElement: makeEl,
    getElementById: function(id) { return byId[id] || null; }
  };
  var origAppend = body.appendChild;
  body.appendChild = function(c) { if (c.id) { byId[c.id] = c; } return origAppend(c); };
  var ctx = { document: doc, setTimeout: function(fn, ms) { timers.push([fn, ms]); return timers.length; }, clearTimeout: function() {} };
  vm.createContext(ctx);
  vm.runInContext(html.slice(a, b), ctx);
  return { ctx: ctx, body: body, timers: timers };
}
NOTICE_PAGES.concat(NOTICE_PAGES.filter(function(p) { return fs.existsSync(IOS + p); }).map(function(p) { return IOS + p; })).forEach(function(page) {
  var n = loadNotice(page);
  vm.runInContext("pageNotice", n.ctx)("Erro: x / Error: x");
  var el = n.body.children[0];
  check(page + ": pageNotice shows the same words in the page", el && el.textContent === "Erro: x / Error: x" && el.style.display === "block");
  vm.runInContext("pageNotice", n.ctx)("second");
  check(page + ": a second notice replaces the first (one pill)", n.body.children.length === 1 && el.textContent === "second");
  n.timers[n.timers.length - 1][0]();
  check(page + ": the notice goes away by itself", el.style.display === "none");
});

if (failed) { console.log(failed + " FAILED"); process.exit(1); }
console.log("all passed");
