// ABC order screen (2026-11-16): typing in a question box must never redraw the screen under the person's cursor.
// The real gm.js functions run against a tiny fake page (no browser). The fake page does what a real one does when
// gmMatDraftRender runs: every old element leaves the page, and if the focused one left, focus is lost.
// GM_JS=path/to/older/gm.js node scripts/test-abc-typing-focus.mjs   runs it against an older copy (it must fail there).
//
//   node scripts/test-abc-typing-focus.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const src = readFileSync(process.env.GM_JS || new URL("../gm.js", import.meta.url), "utf8");
function fn(name, optional) {
  const i = src.indexOf("\nfunction " + name + "(");
  if (i < 0) { if (optional) { return ""; } throw new Error("function not in gm.js: " + name); }
  const j = src.indexOf("\n}", i + 1);
  const oneLine = src.indexOf("\n", i + 1);
  const end = src.slice(i + 1, oneLine).trimEnd().endsWith("}") && !src.slice(i + 1, oneLine).trimEnd().endsWith("{") ? oneLine : j + 2;
  return src.slice(i + 1, end);
}
function variable(name, optional) {
  const i = src.indexOf("\nvar " + name);
  if (i < 0) { if (optional) { return ""; } throw new Error("var not in gm.js: " + name); }
  const m = /;[ \t]*(\/\/[^\n]*)?\n/.exec(src.slice(i + 1));
  return src.slice(i + 1, i + 1 + m.index + 1);
}

// ── the fake page ──
function makePage() {
  const page = { live: new Set(), active: null, listeners: {}, renders: 0, timers: [], now: 0 };
  const parseEl = (tag, attrs, parent) => {
    const el = { tagName: tag.toUpperCase(), id: attrs.id || "", attrs, value: attrs.value || "", parent: parent || null, detached: false, disabled: "disabled" in attrs, changedSinceFocus: false, children: [] };
    el.contains = (o) => { for (let x = o; x; x = x.parent) { if (x === el) { return true; } } return false; };
    el.closest = (sel) => { for (let x = el; x; x = x.parent) { if (sel === "button" && x.tagName === "BUTTON") { return x; } } return null; };
    el.replaceWith = (n) => { n.parent = el.parent; kill(el); page.live.add(n); (function add(x) { x.children.forEach((c) => { page.live.add(c); add(c); }); })(n); };
    el.focus = () => { page.focusOn(el); };
    page.live.add(el);
    if (parent) { parent.children.push(el); }
    return el;
  };
  const kill = (el) => { el.detached = true; page.live.delete(el); el.children.forEach(kill); if (page.active === el || (page.active && page.active.detached)) { page.active = null; } };
  // Turns a piece of the app's own HTML into elements (inputs, selects, buttons, and ids on divs and paragraphs).
  const build = (html, parent) => {
    let top = null;
    const re = /<(div|p|input|select|button)\b([^>]*)>/g; let mt;
    const stack = [];
    while ((mt = re.exec(html))) {
      const attrs = {};
      mt[2].replace(/([\w-]+)(?:="([^"]*)")?/g, (_, k, v) => { attrs[k] = v === undefined ? "" : v; return ""; });
      const el = parseEl(mt[1], attrs, stack.length ? stack[stack.length - 1] : parent);
      if (!top) { top = el; }
      if (mt[1] === "div" && (attrs.id === "gmBrAsk" || attrs.id === "gmBrBar")) { stack.length = 0; stack.push(el); }
    }
    return top;
  };
  page.build = build;
  page.getElementById = (id) => { let hit = null; page.live.forEach((e) => { if (e.id === id && !hit) { hit = e; } }); return hit; };
  page.focusOn = (el) => {
    if (page.active === el) { return; }
    page.leave(el);
    page.active = el; if (el) { el.changedSinceFocus = false; page.fire("focusin", { target: el }); }
  };
  // Leaving the focused box: "change" (if the value changed) then "focusout", exactly as a browser orders them.
  page.leave = (relatedTarget) => {
    const a = page.active; if (!a) { return; }
    if (a.changedSinceFocus) { page.fire("change", { target: a }); }
    page.fire("focusout", { target: a, relatedTarget: relatedTarget || null });
    if (page.active === a) { page.active = null; }
  };
  page.fire = (type, ev) => { (page.listeners[type] || []).slice().forEach((f) => f(Object.assign({ type }, ev))); };
  page.document = {
    getElementById: page.getElementById,
    get activeElement() { return page.active || { tagName: "BODY", contains: () => false }; },
    createElement: () => {
      const box = { _h: "", firstChild: null };
      Object.defineProperty(box, "innerHTML", { set(h) { box._h = h; box.firstChild = h ? page.build(h, null) : null; if (box.firstChild) { page.live.delete(box.firstChild); box.firstChild.children.forEach((c) => page.live.delete(c)); } }, get() { return box._h; } });
      return box;
    },
    addEventListener: (type, f) => { (page.listeners[type] = page.listeners[type] || []).push(f); }
  };
  page.setTimeout = (f, ms) => { const t = { f, at: page.now + (ms || 0) }; page.timers.push(t); return t; };
  page.clearTimeout = (t) => { page.timers = page.timers.filter((x) => x !== t); };
  page.advance = (ms) => { page.now += ms; let t; while ((t = page.timers.filter((x) => x.at <= page.now).sort((a, b) => a.at - b.at)[0])) { page.timers = page.timers.filter((x) => x !== t); t.f(); } };
  return page;
}

function world(lang) {
  const page = makePage();
  const sandbox = { console, Date, Math, JSON, Object, Array, String, Number, RegExp, encodeURIComponent,
    gmT: (pt, en) => (lang === "pt" ? pt : en), escHtml: (t) => String(t === null || t === undefined ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    document: page.document, setTimeout: page.setTimeout, clearTimeout: page.clearTimeout,
    gmAbcPlStatus: null, gmAbcStatus: null, gmMatDraft: null, gmMatBatch: null, gmBr: { contacts: [] }, gmBrContactsLoad: () => {}, gmIsSeller: () => false,
    syncSoon: 0, reviewOpened: [], gmMatDraftRender: null, gmBrSyncSoon: null, gmMatReviewOpen: null };
  const names = ["gmBrStillNeeded", "gmBrBarInner", "gmBrAddrOk", "gmBrAskLocal", "gmBrSig", "gmBrActiveLines", "gmBrAskNeed", "gmBrAskGroups", "gmBrAskGroup", "gmBrSyncState", "gmBrAskTitle",
    "gmBrAskBody", "gmBrAskHtml", "gmBrBarHtml", "gmBrAskInput", "gmMatField", "gmBrPhone", "gmBrPhoneDigits", "gmBrBarPaint", "gmBrBarWire", "gmBrAskRepaint", "gmMatIsoDate", "gmBrHold", "gmBrTapEnd", "gmBrSet", "gmBrTargetObj"];
  const code = ["GM_BR_ASK_GROUP", "GM_BR_ASK_ORDER"].map((v) => variable(v)).join("\n") + "\n" + ["gmBrBarWired", "gmBrTapping", "gmBrTapTimer", "gmBrLeft"].map((v) => variable(v, true)).join("\n") + "\n" + names.map((n) => fn(n, n === "gmBrHold" || n === "gmBrTapEnd")).join("\n");
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  // The pieces the page owns: the redraw (what really happens to the page), the saver, the Review handler.
  sandbox.gmMatDraftRender = () => {
    page.renders++;
    const had = Array.from(page.live); had.forEach((e) => { e.detached = true; }); page.live.clear();
    if (page.active && page.active.detached) { page.active = null; }
    const m = sandbox.gmMatDraft;
    const box = page.build('<div id="gmMatDeliveryBox">', null);
    const ask = page.build(sandbox.gmBrAskHtml(m).replace(/^<div class="gm-ask[^"]*" id="gmBrAsk">/, '<div id="gmBrAsk">'), box);
    const bar = page.build(sandbox.gmBrBarHtml(m), null);
    // the Review button lives in the bar: parse sets its parent
    page.live.forEach((e) => { if (e.id === "gmBrAsk") { e.parent = box; } });
    void ask; void bar;
  };
  sandbox.gmBrSyncSoon = () => { sandbox.syncSoon++; };
  sandbox.gmMatReviewOpen = () => { sandbox.reviewOpened.push(sandbox.gmMatDraft.form.contact_name); };
  // Re-bind the pieces that call them (they were compiled in the sandbox, so replace through the context).
  vm.runInContext("gmMatDraftRender = this.gmMatDraftRender; gmBrSyncSoon = this.gmBrSyncSoon; gmMatReviewOpen = this.gmMatReviewOpen;", Object.assign(sandbox, {}));
  sandbox.page = page;
  return sandbox;
}

// A draft with every answer in except the ones named in `empty`.
function draft(empty) {
  const f = { service: "OTG", dateMode: "tbd", date: "", dcName: "Sam", dcPhone: "8135550111", contact_name: "Owner Person", contact_email: "o@z.example", contact_phone: "8135550100", job_name: "Smith", order_ref: "AP-ABC12345",
    ja: { line1: "1 Oak St", city: "Tampa", state: "FL", postal: "33602" }, nl: {}, locId: "", lines: { l1: { qty: "3", removed: false } } };
  (empty || []).forEach((k) => { f[k] = ""; });
  return { ready: true, view: "edit", busy: false, locMode: "job", sync: "ok", prices: "ok", form: f, data: { lines: [{ id: "l1", unit_price: 5, description: "Shingles", uom: "BD" }], draft: { missing: [] } } };
}
function openScreen(w, m) {
  w.gmMatDraft = m; m.sigChecked = w.gmBrSig(m);
  w.gmMatDraftRender(); w.page.renders = 0;
  w.gmBrBarWire();
}
// A real keypress sequence: the box gets focus once, then one input event per character (the handler on the element sets the model).
function focusBox(w, id) { const el = w.page.getElementById(id); w.page.focusOn(el); return el; }
function typeInto(w, el, text, each) {
  let seen = "";
  for (const ch of text) {
    seen += ch;
    el.value = seen; el.changedSinceFocus = true;
    vm.runInContext("(function() { " + el.attrs.oninput.replace(/&quot;/g, '"').replace(/&amp;/g, "&") + " })", w).call(el);
    w.page.fire("input", { target: el });
    if (each) { each(seen, el); }
  }
}
function paste(w, el, text) {
  el.value = text; el.changedSinceFocus = true;
  vm.runInContext("(function() { " + el.attrs.oninput.replace(/&quot;/g, '"').replace(/&amp;/g, "&") + " })", w).call(el);
  w.page.fire("input", { target: el });
}
const askIsOk = (w) => !!w.page.getElementById("gmBrAsk") && !w.page.getElementById("gmAskCName") && !w.page.getElementById("gmAskCEmail") && !w.page.getElementById("gmAskCPhone");

// ── (1) a full name, one character at a time, into the last question box ──
{
  const w = world("en"), m = draft(["contact_name"]);
  openScreen(w, m);
  const el = focusBox(w, "gmAskCName");
  ok(w.gmBrAskGroup(m) === "contact" && !!el, "setup: the last question is the contact question and its name box is on the page");
  let stayed = true, focused = true, sameEl = true;
  typeInto(w, el, "Nicole Lepage", () => {
    if (w.page.getElementById("gmAskCName") !== el) { sameEl = false; }
    if (el.detached) { stayed = false; }
    if (w.page.active !== el) { focused = false; }
  });
  ok(sameEl && stayed, "name box: after every character the SAME input element is still in the page");
  ok(focused, "name box: after every character it is still the focused element");
  ok(m.form.contact_name === "Nicole Lepage", "name box: the stored value is the whole name");
  ok(w.page.renders === 0, "name box: the screen was not redrawn once while typing (" + w.page.renders + " redraws)");
  ok(w.syncSoon > 0, "name box: the automatic save and check is still asked for while typing");
}
// the email box and the phone box (the answer becomes valid before the typing ends)
{
  const w = world("en"), m = draft(["contact_email"]);
  openScreen(w, m);
  const el = focusBox(w, "gmAskCEmail");
  let kept = true;
  typeInto(w, el, "owner@zeta-roofing.example", () => { if (el.detached || w.page.active !== el || w.page.getElementById("gmAskCEmail") !== el) { kept = false; } });
  ok(kept && m.form.contact_email === "owner@zeta-roofing.example" && w.page.renders === 0, "email box: same element, still focused, whole address stored, no redraw");
}
{
  const w = world("en"), m = draft(["contact_phone"]);
  openScreen(w, m);
  const el = focusBox(w, "gmAskCPhone");
  let kept = true;
  typeInto(w, el, "8135550100", () => { if (el.detached || w.page.active !== el || w.page.getElementById("gmAskCPhone") !== el) { kept = false; } });
  ok(kept && m.form.contact_phone === "8135550100" && w.page.renders === 0, "phone box: same element, still focused, all ten digits stored, no redraw");
}

// ── (2) pasting the whole name in one go ──
{
  const w = world("en"), m = draft(["contact_name"]);
  openScreen(w, m);
  const el = focusBox(w, "gmAskCName");
  paste(w, el, "Nicole Lepage");
  ok(m.form.contact_name === "Nicole Lepage" && w.page.getElementById("gmAskCName") === el && w.page.active === el && w.page.renders === 0, "paste: whole name stored, same element, still focused, no redraw");
}

// ── (3) the block collapses to Ready to send only after the box is left ──
{
  const w = world("en"), m = draft(["contact_name"]);
  openScreen(w, m);
  const el = focusBox(w, "gmAskCName");
  typeInto(w, el, "Nicole Lepage");
  ok(!askIsOk(w), "while the cursor is in the box the question box is still on the page");
  w.page.leave(null);
  ok(askIsOk(w) && w.page.renders === 1, "after the box is left the block collapses (one redraw)");
  ok(/Ready to send|Checking/.test(w.gmBrAskHtml(m)), "the collapsed block says Ready to send or Checking");
}

// ── (4) the Review button enables when the last question is answered and the cursor is still in the box ──
{
  const w = world("en"), m = draft(["contact_name"]);
  openScreen(w, m);
  const el = focusBox(w, "gmAskCName");
  ok(w.page.getElementById("gmBrReviewBtn").disabled === true, "before the answer: the Review button is off");
  typeInto(w, el, "Nicole Lepage");
  // the Worker has checked the screen as it is now
  m.sync = "ok"; m.sigChecked = w.gmBrSig(m);
  w.gmBrBarPaint();
  ok(w.page.getElementById("gmBrReviewBtn").disabled === false && w.page.active === el && w.page.renders === 0, "answered and checked, cursor still in the box: Review is on and the box was not touched");
}

// ── (5) tapping Review while the cursor is still in the box ──
{
  const w = world("en"), m = draft(["contact_name"]);
  openScreen(w, m);
  const el = focusBox(w, "gmAskCName");
  typeInto(w, el, "Nicole Lepage");
  m.sync = "ok"; m.sigChecked = w.gmBrSig(m); w.gmBrBarPaint();
  const btn = w.page.getElementById("gmBrReviewBtn");
  // the tap: pointer goes down on the button, then the box loses focus (change, focusout), then the pointer goes up and the click lands
  w.page.fire("pointerdown", { target: btn });
  w.page.leave(btn);
  const stillThere = !btn.detached && w.page.getElementById("gmBrReviewBtn") === btn;
  w.page.fire("pointerup", { target: btn });
  if (!btn.detached) { vm.runInContext("(function() { gmMatReviewOpen() })", w)(); w.page.fire("click", { target: btn }); }
  w.page.advance(10);
  ok(stillThere, "the blur and change before the tap did not replace the button under the finger");
  ok(w.reviewOpened.length === 1 && w.reviewOpened[0] === "Nicole Lepage", "the tap landed and the review opens with the full name");
}
// the same tap on a phone (no focus on the button at all: relatedTarget is empty)
{
  const w = world("en"), m = draft(["contact_name"]);
  openScreen(w, m);
  const el = focusBox(w, "gmAskCName");
  typeInto(w, el, "Nicole Lepage");
  m.sync = "ok"; m.sigChecked = w.gmBrSig(m); w.gmBrBarPaint();
  const btn = w.page.getElementById("gmBrReviewBtn");
  w.page.fire("pointerdown", { target: btn });
  w.page.leave(null);
  ok(!btn.detached && w.page.getElementById("gmBrReviewBtn") === btn, "phone tap (no focus given to the button): the button is still the same one");
  w.page.fire("pointerup", { target: btn }); w.page.fire("click", { target: btn });
  w.page.advance(10);
  ok(askIsOk(w), "after the tap is finished the collapse that was waiting still happens");
}

// ── (6) a question box that is NOT the last one: live updates, next question after leaving ──
{
  const w = world("en"), m = draft(["dcName", "dcPhone", "contact_name", "contact_email", "contact_phone"]);
  openScreen(w, m);
  ok(w.gmBrAskGroup(m) === "person" && w.gmBrAskGroups(w.gmBrAskNeed(m)).length === 2, "setup: the person question is first, the contact question follows");
  const nm = focusBox(w, "gmAskDcName");
  typeInto(w, nm, "Sam Lee");
  ok(/2 questions left/.test(w.gmBrBarInner(w.gmBrAskGroups(w.gmBrAskNeed(m)), "ok")), "the bar line follows live: still two questions left while the person answer is half done");
  const ph = focusBox(w, "gmAskDcPhone");
  let kept = true;
  typeInto(w, ph, "8135550111", () => { if (ph.detached || w.page.active !== ph) { kept = false; } });
  ok(kept && m.form.dcName === "Sam Lee" && m.form.dcPhone === "8135550111", "a box that is not the last still stores live and keeps focus");
  ok(w.page.renders === 0 && !!w.page.getElementById("gmAskDcPhone"), "no redraw while typing in it, even though the person question is now answered");
  w.page.leave(null);
  ok(w.gmMatDraft.askGroup === "contact" && !!w.page.getElementById("gmAskCName") && !w.page.getElementById("gmAskDcPhone"), "after it is left the next question (contact) appears");
}

// ── (7) emptying the box again brings the question back ──
{
  const w = world("en"), m = draft(["contact_name"]);
  openScreen(w, m);
  const el = focusBox(w, "gmAskCName");
  typeInto(w, el, "Nic");
  el.value = ""; m.form.contact_name = ""; w.page.fire("input", { target: el });
  ok(w.page.active === el && w.page.getElementById("gmAskCName") === el && w.gmBrAskGroup(m) === "contact", "after emptying the box it is still there, still focused, and the question is still open");
  ok(/1 question left/.test(w.gmBrBarInner(w.gmBrAskGroups(w.gmBrAskNeed(m)), "ok")), "the bar again counts one question left");
  w.page.leave(null);
  ok(!!w.page.getElementById("gmAskCName") && !askIsOk(w), "after leaving the empty box the question is still shown (it never collapsed)");
  // and the other way round: collapsed first, then the person types again in the lower copy and empties it
}

// ── the automatic check coming back while the person is still typing must not redraw either ──
{
  const w = world("en"), m = draft(["contact_name"]);
  openScreen(w, m);
  const el = focusBox(w, "gmAskCName");
  typeInto(w, el, "Nicole");
  m.sync = "ok"; m.sigChecked = w.gmBrSig(m);
  w.gmBrAskRepaint(m);
  ok(w.page.renders === 0 && w.page.active === el && !el.detached, "the check coming back mid typing (gmBrAskRepaint) leaves the box alone");
  w.page.leave(null);
  ok(askIsOk(w), "and the block collapses once the box is left");
}

// ── nothing else changed: with no box focused the old redraw still happens at once ──
{
  const w = world("en"), m = draft(["contact_name"]);
  openScreen(w, m);
  m.form.contact_name = "Nicole Lepage";
  w.gmBrBarPaint();
  ok(w.page.renders === 1, "a change made with no box focused (a tap on a choice) still redraws at once");
}

// ── the real file: the guard exists, wiring covers focusout, and no pop-ups ──
ok(/function gmBrHold\(/.test(src), "gm.js has the typing guard");
console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
