// Never reload while the person is working, and the estimate wizard's local draft.
// Runs the REAL pwa.js in a fake page (fake clock, fake timers, fake storage, fake
// location) and the REAL wizard and draft functions cut out of gm.js. No network,
// no database, nothing is sent.
//   node scripts/test-pwa-busy-guard.mjs
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { fnSrc, varSrc } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");
const pwaSrc = read("pwa.js");
const gmSrc = read("gm.js");

let failed = 0, passed = 0;
function ok(cond, label) { if (cond) { passed++; console.log("PASS  " + label); } else { failed++; console.log("FAIL  " + label); } }
const flush = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 6; i++) { await flush(); } }

// ───────────────────────────── a fake clock with timers ─────────────────────────────
function makeClock(start) {
  const c = { now: start, timers: [], nextId: 1 };
  c.setTimeout = (fn, ms) => { const id = c.nextId++; c.timers.push({ id, at: c.now + (ms || 0), every: 0, fn }); return id; };
  c.setInterval = (fn, ms) => { const id = c.nextId++; c.timers.push({ id, at: c.now + ms, every: ms, fn }); return id; };
  c.clear = (id) => { c.timers = c.timers.filter((t) => t.id !== id); };
  c.advance = async (ms) => {
    const target = c.now + ms;
    for (;;) {
      c.timers.sort((a, b) => a.at - b.at);
      const t = c.timers[0];
      if (!t || t.at > target) { break; }
      c.now = t.at;
      if (t.every) { t.at += t.every; } else { c.timers.shift(); }
      t.fn();
      await settle();
    }
    c.now = target;
  };
  return c;
}
function fakeDate(clock) {
  return class FD extends Date {
    static now() { return clock.now; }
    constructor(...a) { if (a.length) { super(...a); } else { super(clock.now); } }
  };
}
function fakeStorage(opts) {
  const m = new Map();
  const boom = () => { throw new Error("storage blocked"); };
  const s = {
    m, sets: 0,
    getItem(k) { if (opts && opts.throws) { boom(); } return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (opts && opts.throws) { boom(); } s.sets++; m.set(k, String(v)); },
    removeItem(k) { if (opts && opts.throws) { boom(); } m.delete(k); },
    key(i) { if (opts && opts.throws) { boom(); } return Array.from(m.keys())[i] || null; }
  };
  Object.defineProperty(s, "length", { get() { if (opts && opts.throws) { boom(); } return m.size; } });
  return s;
}

// ───────────────────────────── a fake page for pwa.js ─────────────────────────────
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.attrs = {}; this.listeners = {};
    this.props = {}; this.classSet = new Set(); this.className = ""; this.hidden = false; this.id = ""; this.textContent = ""; this.offsetHeight = 48; this.type = ""; this.cssDisplay = "block";
    const self = this;
    this.style = { setProperty(k, v) { self.props[k] = v; }, removeProperty() {}, cssText: "" };
    this.classList = { add: (c) => self.classSet.add(c), remove: (c) => self.classSet.delete(c), contains: (c) => self.classSet.has(c) || self.className.split(/\s+/).includes(c) }; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  click() { (this.listeners.click || []).forEach((f) => f({})); }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk(fn)); }
}

function makePage(opts) {
  opts = opts || {};
  const clock = makeClock(1700000000000);
  const body = new El("body"), head = new El("head");
  if (opts.lang === "en") { body.classSet.add("lang-en"); } else { body.classSet.add("lang-pt"); }
  const docListeners = {};
  const winListeners = {};
  const state = { version: "1", replaced: [], reloads: 0 };
  const find = (pred) => { let hit = null; [head, body].forEach((r) => r.walk((e) => { if (!hit && pred(e)) { hit = e; } })); return hit; };
  const doc = {
    readyState: "complete", body, head, activeElement: null,
    documentElement: { lang: opts.docLang || "" },
    createElement: (t) => new El(t),
    getElementById: (id) => find((e) => e.id === id),
    querySelector: (sel) => { const cls = sel.replace(/^\./, ""); return find((e) => e.className.split(/\s+/).includes(cls)); },
    addEventListener: (t, f, cap) => { (docListeners[t] = docListeners[t] || []).push({ f, cap }); }
  };
  const ls = fakeStorage(opts.storage);
  const ctx = {
    document: doc, navigator: { standalone: !!opts.standalone },
    localStorage: ls, URL, Promise, console,
    Date: fakeDate(clock), setTimeout: clock.setTimeout, setInterval: clock.setInterval, clearInterval: clock.clear, clearTimeout: clock.clear,
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ version: state.version }) }),
    location: {
      href: "https://app.test/portal.html?x=1",
      replace(u) { state.replaced.push(u); }, reload() { state.reloads++; }
    },
    getComputedStyle: (e) => ({ display: e.cssDisplay, visibility: "visible" }),
    scrollY: 0
  };
  ctx.window = ctx;
  ctx.addEventListener = (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); };
  ctx.localStorage = ls;
  vm.createContext(ctx);
  vm.runInContext(pwaSrc, ctx, { filename: "pwa.js" });
  const page = {
    ctx, doc, body, head, clock, state, ls, El,
    fireWin(t, evt) { (winListeners[t] || []).forEach((f) => f(evt || {})); },
    fireDoc(t, evt) { (docListeners[t] || []).forEach((h) => h.f(evt || {})); },
    hasCaptureListener(t) { return (docListeners[t] || []).some((h) => h.cap === true); },
    banners: () => { const n = []; [head, body].forEach((r) => r.walk((e) => { if (e.id === "pwaUpdateBanner") { n.push(e); } })); return n; },
    sheet(visible) { const e = new El("div"); e.className = "gm-sheet-overlay"; if (visible === false) { e.cssDisplay = "none"; } body.appendChild(e); return e; },
    async load() { page.fireWin("load"); await settle(); },
    async poll() { await clock.advance(60000); }
  };
  return page;
}

const PT_TEXT = "Há uma versão nova do Apex. Toque em Atualizar quando terminar o que está fazendo.";
const EN_TEXT = "A new version of Apex is ready. Tap Update when you finish what you are doing.";

// ───────────────────────────── (a) pwaBusy, one condition at a time ─────────────────────────────
{
  const p = makePage(); await p.load();
  const busy = () => p.ctx.pwaBusy();
  ok(typeof p.ctx.pwaBusy === "function" && typeof p.ctx.pwaMarkBusy === "function", "(a) pwaBusy and pwaMarkBusy are exported on window");
  ok(busy() === false, "(a) nothing going on: not busy");
  ok(p.hasCaptureListener("input") && p.hasCaptureListener("change"), "(a) one capture phase listener watches input and change");

  const s = p.sheet(true);
  ok(busy() === true, "(a) a visible .gm-sheet-overlay: busy");
  s.cssDisplay = "none"; ok(busy() === false, "(a) a hidden sheet overlay: not busy");
  s.cssDisplay = "block"; s.hidden = true; ok(busy() === false, "(a) a sheet overlay with the hidden attribute: not busy");
  p.body.removeChild(s); ok(busy() === false, "(a) sheet removed: not busy");

  p.ctx.gmEstWiz = { step: 1 }; ok(busy() === true, "(a) window.gmEstWiz set: busy");
  p.ctx.gmEstWiz = null; ok(busy() === false, "(a) window.gmEstWiz cleared: not busy");

  p.ctx.SW = { open: true }; ok(busy() === true, "(a) setup wizard SW.open: busy");
  p.ctx.SW = { open: false }; ok(busy() === false, "(a) setup wizard closed: not busy");

  for (const tag of ["input", "textarea", "select"]) {
    const f = new El(tag); f.type = "text"; p.doc.activeElement = f;
    ok(busy() === true, "(a) focus in a " + tag + ": busy");
  }
  const btn = new El("button"); p.doc.activeElement = btn; ok(busy() === false, "(a) focus on a button: not busy");
  const sub = new El("input"); sub.type = "submit"; p.doc.activeElement = sub; ok(busy() === false, "(a) focus on a submit input: not busy");
  p.doc.activeElement = null;

  p.fireDoc("input"); ok(busy() === true, "(a) an input event just now: busy");
  p.clock.now += 119000; ok(busy() === true, "(a) 119 seconds after the input event: still busy");
  p.clock.now += 2000; ok(busy() === false, "(a) 121 seconds after the input event: not busy");
  p.fireDoc("change"); ok(busy() === true, "(a) a change event just now: busy");
  p.clock.now += 121000; ok(busy() === false, "(a) change event 121 seconds ago: not busy");

  p.ctx.pwaMarkBusy(true); ok(busy() === true, "(a) pwaMarkBusy(true): busy");
  p.ctx.pwaMarkBusy(false); ok(busy() === false, "(a) pwaMarkBusy(false): not busy");
}

// ───────────────────────────── (b) the version check ─────────────────────────────
{
  const p = makePage(); await p.load();
  p.state.version = "2"; await p.poll();
  ok(p.state.replaced.length === 1 && /_v=2/.test(p.state.replaced[0]) && /x=1/.test(p.state.replaced[0]), "(b) not busy: reloads right away with the _v cache buster");
  ok(p.banners().length === 0, "(b) not busy: no banner");
}
{
  const p = makePage(); await p.load();
  p.ctx.pwaMarkBusy(true);
  p.state.version = "2"; await p.poll();
  ok(p.state.replaced.length === 0 && p.state.reloads === 0, "(b) busy: does not reload");
  ok(p.banners().length === 1, "(b) busy: exactly one banner");
  await p.poll(); await p.poll();
  ok(p.banners().length === 1, "(b) polls that keep finding the new version still leave exactly one banner");
}
{
  const p = makePage(); await p.load();
  p.ctx.pwaMarkBusy(true);
  p.state.version = "2"; await p.poll();
  await p.clock.advance(300000);
  ok(p.state.replaced.length === 0 && p.banners().length === 1, "(b) busy for five minutes: never reloads by itself, banner stays");
  p.ctx.pwaMarkBusy(false);
  await p.clock.advance(25000);
  ok(p.state.replaced.length === 0, "(b) not busy for 25 seconds: not yet");
  p.ctx.pwaMarkBusy(true); await p.clock.advance(10000); p.ctx.pwaMarkBusy(false);
  await p.clock.advance(25000);
  ok(p.state.replaced.length === 0, "(b) busy again in between: the 30 second count starts over");
  await p.clock.advance(10000);
  ok(p.state.replaced.length === 1 && /_v=2/.test(p.state.replaced[0]), "(b) not busy for 30 seconds in a row: reloads with the _v cache buster");
  ok(p.banners().length === 0, "(b) the banner is removed when it reloads");
}
{
  const p = makePage(); await p.load();
  p.ctx.pwaMarkBusy(true);
  p.state.version = "2"; await p.poll();
  p.state.version = "3"; await p.poll();
  const btn = p.banners()[0].children.filter((c) => c.tagName === "BUTTON")[0];
  btn.click();
  ok(p.state.replaced.length === 1 && /_v=3/.test(p.state.replaced[0]), "(b) the banner button reloads with the newest version, even while busy");
  ok(p.banners().length === 0, "(b) the banner is gone after the button");
}
{
  // bfcache restore
  const p = makePage(); await p.load();
  p.ctx.pwaMarkBusy(true);
  p.fireWin("pageshow", { persisted: true });
  ok(p.state.reloads === 0 && p.banners().length === 0, "(b) bfcache restore while busy: no reload and no banner");
  p.fireWin("pageshow", { persisted: false });
  ok(p.state.reloads === 0, "(b) a normal pageshow never reloads");
  p.ctx.pwaMarkBusy(false);
  p.fireWin("pageshow", { persisted: true });
  ok(p.state.reloads === 1, "(b) bfcache restore while not busy: reloads as before");
}
{
  // pull to refresh (the third reload)
  for (const busy of [true, false]) {
    const p = makePage({ standalone: true }); await p.load();
    if (busy) { p.ctx.pwaMarkBusy(true); }
    const ev = (y) => ({ touches: [{ clientY: y }], preventDefault() {} });
    p.fireDoc("touchstart", ev(0)); p.fireDoc("touchmove", ev(300)); p.fireDoc("touchend", {});
    await p.clock.advance(500);
    ok(busy ? (p.state.reloads === 0 && p.banners().length === 0) : p.state.reloads === 1,
      "(b) pull to refresh while " + (busy ? "busy: skipped, no banner" : "not busy: reloads as before"));
  }
}
{
  // blocked storage must not break the version check
  const p = makePage({ storage: { throws: true } }); await p.load();
  p.state.version = "2"; await p.poll();
  ok(p.state.replaced.length === 1, "(d) all localStorage functions throwing: the version check still reloads");
  let threw = false; try { p.ctx.pwaClearEstDrafts(); } catch (e) { threw = true; }
  ok(!threw, "(d) all localStorage functions throwing: pwaClearEstDrafts does not throw");
}
ok(!/(^|[^A-Za-z0-9_.$])(window\.)?(alert|confirm|prompt)\(|beforeunload/.test(pwaSrc.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n")), "(b) pwa.js has no alert, confirm, prompt or beforeunload dialog");
ok(/VERSION_CHECK_INTERVAL_MS = 60 \* 1000/.test(pwaSrc) && /fetch\("version\.json", \{ cache: "no-store" \}\)/.test(pwaSrc), "(b) the 60 second interval and the uncached version.json are unchanged");

// ───────────────────────────── (c) banner text and look ─────────────────────────────
for (const [lang, text, label] of [["pt", PT_TEXT, "Atualizar"], ["en", EN_TEXT, "Update"]]) {
  const p = makePage({ lang }); await p.load();
  p.ctx.pwaMarkBusy(true); p.state.version = "2"; await p.poll();
  const b = p.banners()[0];
  const span = b.children.filter((c) => c.tagName === "SPAN")[0];
  const btn = b.children.filter((c) => c.tagName === "BUTTON")[0];
  ok(span.textContent === text, "(c) " + lang + " banner text is exact");
  ok(btn.textContent === label && b.children.filter((c) => c.tagName === "BUTTON").length === 1, "(c) " + lang + " banner has one button: " + label);
  const css = p.head.children.map((c) => c.textContent).join("");
  ok(/z-index:2147483000/.test(css) && /position:fixed/.test(css) && /bottom:calc\(12px/.test(css), "(c) " + lang + " banner is fixed at the bottom, 12 pixels up, above every sheet");
  ok(/\.gm-sheet\{padding-bottom:calc\(20px \+ var\(--pwa-banner-h/.test(css) && p.body.classSet.has("pwa-banner-on"), "(c) " + lang + " an open sheet gets room under its last button");
}
{
  const p = makePage({ docLang: "en-US" }); p.body.classSet.clear(); await p.load();
  p.ctx.pwaMarkBusy(true); p.state.version = "2"; await p.poll();
  ok(p.banners()[0].children[0].textContent === EN_TEXT, "(c) with no app language class, the page language decides");
  const q = makePage(); q.body.classSet.clear(); await q.load();
  q.ctx.pwaMarkBusy(true); q.state.version = "2"; await q.poll();
  ok(q.banners()[0].children[0].textContent === PT_TEXT, "(c) with nothing to go on, Portuguese");
}

// ───────────────────────────── sign out clears drafts only ─────────────────────────────
{
  const p = makePage(); await p.load();
  p.ls.setItem("apexEstDraft:c1:l1", "{}"); p.ls.setItem("apexEstDraft:c2:new", "{}"); p.ls.setItem("apexEstDraft:c1:e5", "{}");
  p.ls.setItem("apex_client_token", "t"); p.ls.setItem("apexLeadLayout", "x"); p.ls.setItem("other", "y");
  p.ctx.pwaClearEstDrafts();
  const left = Array.from(p.ls.m.keys()).sort().join(",");
  ok(left === "apexLeadLayout,apex_client_token,other", "(d) sign out removes every apexEstDraft: key and leaves the other keys alone (" + left + ")");
}
{
  // every sign out path calls it
  const files = readdirSync(new URL(".", root)).filter((f) => /\.html$/.test(f));
  const missing = [];
  let sites = 0;
  for (const f of files) {
    const s = read(f);
    const m = /function handleSignOut\(\) \{([^]*?)\n\s*\}\n/.exec(s) || /function handleSignOut\(\) \{([^\n]*)\}/.exec(s);
    if (!m) { continue; }
    sites++;
    if (m[1].indexOf("pwaClearEstDrafts") === -1) { missing.push(f); }
  }
  ok(sites >= 20 && missing.length === 0, "(d) all " + sites + " handleSignOut functions clear the drafts" + (missing.length ? " (missing: " + missing.join(", ") + ")" : ""));
  const portal = read("portal.html");
  ok(/function goToLogin\(\) \{[^}]*pwaClearEstDrafts/.test(portal), "(d) the portal's goToLogin (manual and expired session) clears the drafts");
  const nb = read("native-bridge.js");
  ok((nb.match(/pwaClearEstDrafts/g) || []).length >= 2, "(d) the native sign out hooks clear the drafts");
}

// ───────────────────────────── the wizard draft (real gm.js code) ─────────────────────────────
const GM_FNS = ["gmSheetCloseNow", "gmEstWizNewState", "gmEstWizFromDetail", "gmEstWizStart", "gmEstEditOpen", "gmEstWizApplyDefaultTerms", "gmEstWizPreselectService",
  "gmEstWizRender", "gmEstWizGo", "gmEstWizSet", "gmEstWizNext", "gmEstWizValidate", "gmEstWizPayload", "gmEstWizSave",
  "gmEstDraftKey", "gmEstDraftRemove", "gmEstDraftRead", "gmEstDraftWrite", "gmEstDraftCancelTimer", "gmEstDraftTouch", "gmEstDraftFlush",
  "gmEstWizEnded", "gmEstDraftOffer", "gmEstDraftTime", "gmEstDraftCardHtml", "gmEstDraftContinue", "gmEstDraftStartOver"];
const GM_VARS = ["gmEstDraftTimer", "gmEstDraftDirty", "gmEstDraftSeen", "gmEstDraftDone", "GM_EST_WIZ_TITLES", "GM_EST_DRAFT_PREFIX", "GM_EST_DRAFT_MAX_AGE_MS", "GM_EST_DRAFT_DEBOUNCE_MS"];
const listenerLines = gmSrc.split("\n").filter((l) => /^document\.addEventListener\("(input|change)", function\(\) \{ if \(gmEstWiz\)/.test(l));
ok(listenerLines.length === 2, "(d) gm.js registers one input and one change capture listener for the draft");

function makeGm(o) {
  o = o || {};
  const clock = makeClock(new Date(2026, 10, 6, 16, 12, 0).getTime());   // local 4:12 PM
  const ls = fakeStorage(o.storage);
  const docL = {};
  const doc = { getElementById: () => null, addEventListener: (t, f, cap) => { (docL[t] = docL[t] || []).push({ f, cap }); } };
  const calls = { api: [], marks: [], toasts: [] };
  const lang = { en: !!o.en };
  const apiImpl = o.api || ((path, opts) => {
    if (path === "pricing") { return Promise.resolve({ items: [] }); }
    if (path === "estimates" && opts && opts.method === "POST") { return Promise.resolve({ estimate: { id: "e9" }, revised: false }); }
    if (/^estimates\/e5$/.test(path) && opts && opts.method === "PUT") { return Promise.resolve({ estimate: { id: "e5" }, revised: false }); }
    if (/^estimates\//.test(path)) { return Promise.resolve({ estimate: { id: "e9", status: "draft" } }); }
    if (path === "leads") { return Promise.resolve({ leads: [] }); }
    return Promise.resolve({});
  });
  const stubs = {
    clientId: "c1", document: doc, window: { localStorage: ls, pwaMarkBusy: (f) => calls.marks.push(f) },
    Date: fakeDate(clock), setTimeout: clock.setTimeout, clearTimeout: clock.clear,
    gmT: (pt, en) => (lang.en ? en : pt), escHtml: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"),
    gmServicoList: (s) => (s ? [s] : []), gmLeadAddressLine: (l) => l.address || "", localDateStr: () => "2026-12-06",
    gmDocSettings: { setup_completed_at: "2026-01-01", default_terms_included: "", estimate_valid_days: 30, schedule_presets: [] },
    gmIsSeller: () => false, gmToast: (m) => calls.toasts.push(m), gmApi: (path, opts) => { calls.api.push(path + (opts && opts.method ? ":" + opts.method : "")); return apiImpl(path, opts); },
    gmPricingData: null, gmEstPricingMatchesServices: () => false, gmEstHeadlineOption: () => ({ schedule: [{ label: "Deposit", pct: 50 }, { label: "Completion", pct: 50 }] }),
    gmLoadEstimatesList: () => Promise.resolve(), gmLoadCrmSilent: () => {}, gmRenderEstimatesTab: () => {}, gmCurrentTab: "x",
    gmEstSendOpen: () => {}, gmEstDetail: o.estDetail || null, gmLeadsData: { leads: [] }, GM_EST_TIER_LABEL: {},
    gmEstWizStep1: () => '<input id="gmEwJob">', gmEstWizStep2: () => "s2", gmEstWizStepPick: () => "pick", gmEstWizStep5: () => "s5",
    gmEstWizStep6: () => "s6", gmEstWizStep7: () => "s7", gmEstWizStep8: () => "s8", gmDocMsgLoad: () => Promise.resolve({}),
    gmSheetOnUserClose: null, console: { error() {} }
  };
  const stubNames = Object.keys(stubs);
  const code = GM_VARS.map((v) => varSrc(v, gmSrc)).concat(GM_FNS.map((n) => fnSrc(n, gmSrc))).join("\n") + "\n" + listenerLines.join("\n") + `
var gmEstWiz = null;
var gmSheetEl = null;
var sheets = [];
function gmSheetOpen(titleHtml, bodyHtml, tourKey) {
  gmSheetCloseNow(tourKey === "gm-estimate-wizard");
  var el = { parentNode: { removeChild: function() {} }, html: bodyHtml, tour: tourKey,
    querySelector: function(sel) { return (this.tour === "gm-estimate-wizard" && sel.indexOf("gm-estimate-wizard") !== -1) ? {} : null; } };
  gmSheetEl = el; sheets.push(el);
}
function gmSheetClose() { gmSheetCloseNow(); }
function gmRenderEstimateSheet() { gmSheetOpen("Estimate", "estimate sheet", "gm-estimate"); }
return {
  get wiz() { return gmEstWiz; }, set wiz(v) { gmEstWiz = v; },
  get sheet() { return gmSheetEl; }, sheets: sheets,
  start: gmEstWizStart, editOpen: gmEstEditOpen, go: gmEstWizGo, set: gmEstWizSet, next: gmEstWizNext, save: gmEstWizSave, render: gmEstWizRender,
  close: gmSheetClose, openOther: function() { gmSheetOpen("Other", "other", "other"); },
  cont: gmEstDraftContinue, startOver: gmEstDraftStartOver
};`;
  const api = new Function(...stubNames, code)(...stubNames.map((k) => stubs[k]));
  const g = {
    api, clock, ls, calls, lang,
    type(key, value) { api.set(key, value); (docL.input || []).forEach((h) => h.f({})); },
    change() { (docL.change || []).forEach((h) => h.f({})); },
    key(k) { return "apexEstDraft:c1:" + k; },
    draft(k) { const raw = ls.m.get(g.key(k)); return raw ? JSON.parse(raw) : null; },
    html() { return api.sheet ? api.sheet.html : ""; }
  };
  return g;
}
const LEAD = { id: "l1", cliente: "Ana Souza", telefone: "555", email: "", servico: "Deck", city: "Tampa", address: "1 Main St" };

{
  const g = makeGm();
  await g.api.start(LEAD); await settle();
  ok(g.api.wiz && g.api.sheet && g.api.sheet.tour === "gm-estimate-wizard", "(d) the wizard opens");
  ok(g.calls.marks[g.calls.marks.length - 1] === true, "(d) opening the wizard calls pwaMarkBusy(true)");
  await g.clock.advance(5000);
  ok(g.ls.sets === 0, "(d) a wizard nobody touched saves no draft");

  g.type("customer_name", "Ana Maria");
  await g.clock.advance(799);
  ok(g.ls.sets === 0, "(d) 799 milliseconds after an edit: nothing saved yet (debounced)");
  await g.clock.advance(2);
  const d1 = g.draft("l1");
  ok(!!d1 && d1.state.customer_name === "Ana Maria" && d1.state.step === 1 && d1.clientId === "c1" && d1.ref === "l1" && typeof d1.savedAt === "number", "(d) 800 milliseconds after an edit: draft saved with state, step, client id, lead id and a timestamp");
  ok(Object.keys(JSON.parse(g.ls.m.get(g.key("l1"))).state).indexOf("draftOffer") === -1, "(d) the draft does not carry the offer card");

  const before = g.ls.sets;
  g.type("job_name", "Deck job"); await g.clock.advance(500); g.type("customer_phone", "407"); await g.clock.advance(500);
  ok(g.ls.sets === before, "(d) two edits 500 ms apart: still nothing written");
  await g.clock.advance(400);
  ok(g.ls.sets === before + 1 && g.draft("l1").state.customer_phone === "407" && g.draft("l1").state.job_name === "Deck job", "(d) the two edits become one write holding both");

  // step change and line items
  g.api.go(3); await g.clock.advance(900);
  ok(g.draft("l1").state.step === 3, "(d) a step change is saved");
  g.api.wiz.options[0].items.push({ item_name: "Deck boards", qty: "2", rate_cents: 1000, line_type: "standard" });
  g.api.render(); await g.clock.advance(900);
  ok(g.draft("l1").state.options[0].items.length === 1, "(d) a line item added is saved");
  g.api.wiz.options[0].items.splice(0, 1); g.api.render(); await g.clock.advance(900);
  ok(g.draft("l1").state.options[0].items.length === 0, "(d) a line item removed is saved");
  g.api.wiz.options[0].items.push({ item_name: "Deck boards", qty: "2", rate_cents: 1000, line_type: "standard" }); g.api.render(); await g.clock.advance(900);
  g.change(); await g.clock.advance(900);

  // close with a change still waiting: flushed, kept
  g.type("customer_email", "ana@x.test");
  g.api.close();
  ok(g.draft("l1").state.customer_email === "ana@x.test", "(d) closing right after an edit still saves it");
  ok(g.api.wiz === null && g.calls.marks[g.calls.marks.length - 1] === false, "(d) closing the wizard clears it and calls pwaMarkBusy(false)");
  await g.clock.advance(5000);
  ok(!!g.draft("l1"), "(d) closing the wizard without saving keeps the draft");

  // reopen: the offer card, PT
  await g.api.start(LEAD); await settle();
  const h = g.html();
  ok(h.indexOf("Você tem um orçamento não salvo de 4:12 PM. Quer continuar de onde parou?") !== -1, "(e) Portuguese card text with a 12 hour time");
  ok(/>Continuar<\/button>/.test(h) && /Começar de novo/.test(h), "(e) Portuguese buttons Continuar and Começar de novo");
  ok(/id="gmEstWizFrozen" inert aria-hidden="true" style="pointer-events:none/.test(h) && h.indexOf("gmEstDraftCard") < h.indexOf("gmEstWizFrozen"), "(e) the card is on top and the form behind it is inert with taps off");
  g.type("customer_name", "ZZZ"); g.api.next(); g.api.go(5); g.api.save(false);
  ok(g.api.wiz.customer_name === "" || g.api.wiz.customer_name === LEAD.cliente, "(e) while the card shows, typing does not change the form (" + g.api.wiz.customer_name + ")");
  ok(g.api.wiz.step === 1, "(e) while the card shows, Continue/Back/Next taps behind it do nothing");
  await g.clock.advance(3000);
  ok(g.draft("l1").state.customer_name === "Ana Maria", "(e) the saved draft is not overwritten while the card shows");

  // Continue restores
  g.api.cont();
  const w = g.api.wiz;
  ok(w.step === 3 && w.customer_name === "Ana Maria" && w.customer_phone === "407" && w.job_name === "Deck job" && w.customer_email === "ana@x.test" && w.options[0].items.length === 1 && w.options[0].items[0].item_name === "Deck boards", "(d) Continue restores the same step, fields and line items");
  ok(g.html().indexOf("gmEstDraftCard") === -1 && g.html().indexOf("gmEstWizFrozen") === -1, "(d) after Continue the card is gone and the form is live");
  g.type("customer_name", "Ana Maria B"); await g.clock.advance(900);
  ok(g.draft("l1").state.customer_name === "Ana Maria B", "(d) editing after Continue saves again");

  // English card
  g.api.close();
  g.lang.en = true;
  await g.api.start(LEAD); await settle();
  ok(g.html().indexOf("You have an unsaved estimate from 4:12 PM. Do you want to continue where you left off?") !== -1, "(e) English card text with a 12 hour time");
  ok(/>Continue<\/button>/.test(g.html()) && />Start over<\/button>/.test(g.html()), "(e) English buttons Continue and Start over");

  // Start over
  g.api.startOver();
  ok(g.draft("l1") === null, "(d) Start over deletes the draft");
  ok(g.html().indexOf("gmEstDraftCard") === -1 && g.api.wiz.step === 1 && g.api.wiz.customer_name === "Ana Souza", "(d) Start over shows the normal form from the lead");
  g.type("customer_name", "Fresh"); await g.clock.advance(900);
  ok(g.draft("l1") && g.draft("l1").state.customer_name === "Fresh", "(d) after Start over, new edits save a new draft");
}

// a draft is per lead, per estimate, or "new"
{
  const g = makeGm();
  await g.api.start(LEAD); await settle(); g.type("job_name", "A"); await g.clock.advance(900);
  await g.api.start(Object.assign({}, LEAD, { id: "l2" })); await settle();
  ok(g.html().indexOf("gmEstDraftCard") === -1, "(d) a draft for lead l1 is not offered for lead l2");
  g.type("job_name", "B"); await g.clock.advance(900);
  ok(g.draft("l1").state.job_name === "A" && g.draft("l2").state.job_name === "B", "(d) each lead has its own draft key");
}

// older than 24 hours
{
  for (const [age, shown] of [[25 * 3600000, false], [24 * 3600000, false], [23 * 3600000, true]]) {
    const g = makeGm();
    await g.api.start(LEAD); await settle(); g.type("job_name", "Old"); await g.clock.advance(900);
    g.api.close();
    await g.clock.advance(age);
    await g.api.start(LEAD); await settle();
    const has = g.html().indexOf("gmEstDraftCard") !== -1;
    ok(has === shown, "(d) a draft " + (age / 3600000) + " hours old is " + (shown ? "offered" : "ignored"));
    if (!shown) { ok(g.draft("l1") === null, "(d) a draft " + (age / 3600000) + " hours old is deleted when read"); }
  }
}

// saved successfully
{
  const g = makeGm();
  await g.api.start(LEAD); await settle();
  g.type("job_name", "Deck job");
  g.api.wiz.options[0].items.push({ item_name: "Boards", qty: "1", rate_cents: 5000, line_type: "standard", pricing_id: null, category: "", description: "", unit: "", is_addon: false, material_cost_cents: 0, labor_cost_cents: 0, other_cost_cents: 0 });
  g.api.go(8); await g.clock.advance(900);
  ok(!!g.draft("l1"), "(d) before the save a draft exists");
  g.type("internal_notes", "last second edit");   // timer pending when the save lands
  g.api.save(false); await settle();
  ok(g.calls.api.indexOf("estimates:POST") !== -1, "(d) the estimate was posted");
  ok(g.draft("l1") === null, "(d) a successful save deletes the draft");
  ok(g.api.sheet.tour === "gm-estimate" && g.api.wiz === null, "(d) the sheet changed after the draft was deleted, and the wizard is cleared");
  await g.clock.advance(5000);
  ok(g.draft("l1") === null, "(d) a pending timer cannot bring the draft back after a save");
}
{
  const g = makeGm({ api: (path) => (path === "pricing" ? Promise.resolve({ items: [] }) : Promise.reject(new Error("Server said no"))) });
  await g.api.start(LEAD); await settle();
  g.type("job_name", "Deck job");
  g.api.wiz.options[0].items.push({ item_name: "Boards", qty: "1", rate_cents: 5000, line_type: "standard" });
  g.api.go(8); await g.clock.advance(900);
  g.api.save(false); await settle();
  ok(g.draft("l1") !== null, "(d) a save that fails keeps the draft");
}

// editing an existing estimate
{
  const est = { id: "e5", lead_id: "l1", customer_name: "Ana", customer_phone: "1", customer_email: "", customer_address: "x", job_name: "Deck", mode: "single", vendedor: null,
    valid_until: "2026-12-01", updated_at: "2026-11-06 19:00:00",   // 2:00 PM Eastern, 7:00 PM UTC
    options: [{ tier: "single", label: null, sections: [{ category: "", lines: [{ item_name: "Deck", qty: 1, line_type: "standard", rate_cents: 1000 }] }] }],
    terms_included: "", terms_excluded: "", customer_notes: "", internal_notes: "" };
  const g = makeGm({ estDetail: est });
  await g.api.editOpen(); await settle();
  g.type("job_name", "Deck edited"); await g.clock.advance(900);
  ok(g.draft("e5") && g.draft("e5").ref === "e5" && g.draft("e5").state.id === "e5", "(d) editing an estimate keys the draft by the estimate id");
  g.api.close();
  await g.api.editOpen(); await settle();
  ok(g.html().indexOf("gmEstDraftCard") !== -1, "(d) a draft newer than the estimate's last change is offered");
  g.api.close();
  // the estimate was changed on the server after the draft
  est.updated_at = "2026-11-06 21:30:00";
  await g.api.editOpen(); await settle();
  ok(g.html().indexOf("gmEstDraftCard") === -1 && g.draft("e5") === null, "(d) a draft older than the estimate's own updated time is ignored and deleted");
}

// storage blocked
{
  const g = makeGm({ storage: { throws: true } });
  let threw = null;
  try {
    await g.api.start(LEAD); await settle();
    g.type("customer_name", "Ana"); g.api.go(2); g.api.next(); await g.clock.advance(2000);
    g.api.wiz.options[0].items.push({ item_name: "Boards", qty: "1", rate_cents: 5000, line_type: "standard" });
    g.api.go(8); g.type("job_name", "J");
    g.api.save(false); await settle();
    await g.api.start(LEAD); await settle();
    g.api.close();
  } catch (e) { threw = e; }
  ok(threw === null, "(d) all localStorage functions throwing: open, edit, step, save and close all work" + (threw ? " (" + threw.message + ")" : ""));
  ok(g.calls.api.indexOf("estimates:POST") !== -1, "(d) with storage blocked the estimate still saves");
}

// the real gm.js wiring
ok(/gmSheetCloseNow\(tourKey === "gm-estimate-wizard"\)/.test(gmSrc), "(d) the real gmSheetOpen keeps the wizard alive across its own steps");
ok(/gmSheetCloseNow\(\);/.test(fnSrc("gmSheetClose", gmSrc)), "(d) the real gmSheetClose ends the wizard");

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
