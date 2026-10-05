// RES-32: no browser pop-ups in portal.html / gm.js, and a booked visit shows
// once on the Calendar. No network, nothing written.
//   node scripts/test-no-popups-portal.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
let failed = 0, passed = 0;
function ok(cond, label) { if (cond) { passed++; console.log("PASS  " + label); } else { failed++; console.log("FAIL  " + label); } }
function cut(src, name) { const i = src.indexOf("\nfunction " + name + "("); if (i < 0) { throw new Error("not in gm.js: " + name); } const j = src.indexOf("\n}\n", i + 1); return src.slice(i + 1, j + 3); }

for (const f of ["portal.html", "gm.js", "ios/App/App/public/portal.html", "ios/App/App/public/gm.js"]) {
  const src = readFileSync(new URL(f, root), "utf8");
  const hits = src.split("\n").filter(function (l) { return /(^|[^.\w])(window\.)?(confirm|alert|prompt)\(/.test(l) && !/^\s*\/\//.test(l); });
  ok(hits.length === 0, f + ": no browser confirm/alert/prompt call" + (hits.length ? " -> " + hits[0].trim() : ""));
}

// ── tiny fake DOM: just enough for gmAsk ──
function el(tag) {
  const e = { tag, children: [], style: {}, attrs: {}, listeners: {}, parentNode: null, className: "", _html: "", ids: {} };
  e.setAttribute = function (k, v) { e.attrs[k] = v; };
  e.addEventListener = function (t, fn) { (e.listeners[t] = e.listeners[t] || []).push(fn); };
  e.appendChild = function (c) { c.parentNode = e; e.children.push(c); return c; };
  e.removeChild = function (c) { e.children = e.children.filter(function (x) { return x !== c; }); c.parentNode = null; };
  e.querySelectorAll = function () { return []; };
  e.focus = function () { doc.activeElement = e; };
  e.select = function () {};
  e.click = function () { (e.listeners.click || []).forEach(function (fn) { fn({ target: e }); }); };
  Object.defineProperty(e, "innerHTML", { get: function () { return e._html; }, set: function (h) {
    e._html = h;
    ["gmAskYes", "gmAskKeep", "gmAskInput"].forEach(function (id) {
      if (h.indexOf('id="' + id + '"') >= 0) { doc.byId[id] = el("x"); doc.byId[id].id = id; } else { delete doc.byId[id]; }
    });
  } });
  return e;
}
const doc = { byId: {}, activeElement: null, listeners: {} };
doc.body = el("body");
doc.createElement = el;
doc.getElementById = function (id) { return doc.byId[id] || null; };
doc.addEventListener = function (t, fn) { (doc.listeners[t] = doc.listeners[t] || []).push(fn); };

const gm = readFileSync(new URL("gm.js", root), "utf8");
function between(a, b) { const i = gm.indexOf(a); const j = gm.indexOf(b); if (i < 0 || j < 0) { throw new Error("marker missing"); } return gm.slice(i, j); }
const helperSrc = between("var gmAskEl = null;", "// ── Shared single-field editor");
const ctx = { document: doc, escHtml: function (s) { return String(s); } };
vm.createContext(ctx);
vm.runInContext(helperSrc, ctx);
function press(key) { let stopped = false; (doc.listeners.keydown || []).forEach(function (fn) { fn({ key: key, preventDefault: function () {}, stopImmediatePropagation: function () { stopped = true; } }); }); return stopped; }
function open(calls, extra) {
  ctx.gmAsk(Object.assign({ message: "Delete this event?", yes: "Yes, delete the event", keep: "Keep the event", onYes: function () { calls.push("sent"); } }, extra || {}));
}

{ const calls = []; open(calls); doc.byId.gmAskKeep.click();
  ok(calls.length === 0 && ctx.gmAskEl === null, "keep sends nothing and closes the card"); }
{ const calls = []; open(calls); const yes = doc.byId.gmAskYes; yes.click(); yes.click();
  ok(calls.length === 1 && ctx.gmAskEl === null, "yes pressed twice calls the action exactly once"); }
{ const calls = []; open(calls); const stopped = press("Escape");
  ok(calls.length === 0 && ctx.gmAskEl === null && stopped, "Escape means keep and does not reach other layers"); }
{ const calls = []; open(calls); const ov = ctx.gmAskEl; (ov.listeners.click || []).forEach(function (fn) { fn({ target: ov }); });
  ok(calls.length === 0 && ctx.gmAskEl === null, "tapping outside means keep"); }
{ const calls = []; open(calls); ok(doc.activeElement === doc.byId.gmAskKeep, "focus moves into the card, onto the safe button"); }
{
  const calls2 = []; ctx.gmAsk({ message: "Edit note", input: { value: "old" }, yes: "Save note", keep: "Keep the note", onYes: function (v) { calls2.push(v); } });
  doc.byId.gmAskInput.value = "new text"; doc.byId.gmAskYes.click();
  ok(calls2.length === 1 && calls2[0] === "new text", "input card passes the typed text to the action once"); }
{ ctx.gmAsk({ message: "Copy the link:", input: { value: "https://x", readonly: true }, keep: "Close" });
  ok(doc.byId.gmAskYes === undefined || doc.byId.gmAskYes === null, "notice card has no action button"); ctx.gmAskClose(); }

// ── calendar: a booked visit shows once ──
const dctx = {};
vm.createContext(dctx);
vm.runInContext(cut(gm, "gmCalHm") + cut(gm, "gmCalDropLeadDupes"), dctx);
const drop = dctx.gmCalDropLeadDupes;
const visit = { kind: "own", id: "e1", lead_id: "L1", date: "2026-10-12", start_time: "14:00:00", title: "Visit - Ana" };
const est = { kind: "lead", id: "lead:L1:estimate", lead_id: "L1", date: "2026-10-12", start_time: "14:00", title: "Ana", label_en: "Estimate" };
{ const out = drop([visit, est]); ok(out.length === 1 && out[0] === visit, "booked visit: the Estimate entry is left out, the Visit stays"); }
{ const out = drop([est, visit]); ok(out.length === 1 && out[0].kind === "own", "order does not matter"); }
{ const out = drop([Object.assign({}, visit, { start_time: "15:00" }), est]); ok(out.length === 2, "different time: both stay"); }
{ const out = drop([Object.assign({}, visit, { date: "2026-10-13" }), est]); ok(out.length === 2, "different day: both stay"); }
{ const out = drop([Object.assign({}, visit, { lead_id: "L2" }), est]); ok(out.length === 2, "different lead: both stay"); }
{ const out = drop([est]); ok(out.length === 1, "no visit event: the Estimate entry stays"); }
{ const out = drop([Object.assign({}, est, { start_time: null }), Object.assign({}, visit, { start_time: null })]); ok(out.length === 1, "both all-day same date: shown once"); }
{ const out = drop([Object.assign({}, est, { start_time: null }), visit]); ok(out.length === 2, "all-day estimate vs timed visit: both stay"); }
ok(drop(null).length === 0, "no events: empty list");

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
