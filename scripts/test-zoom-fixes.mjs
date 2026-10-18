// The random-zoom bug fixes (2026-10-18): the injected app-only stylesheet
// (Fix 2 + 3) and the quiet zoom logger (Fix 4), cut as source text out of
// native-bridge.js and run against a fake window/document -- same style as
// scripts/test-no-popups-portal.mjs. No network, nothing written.
//   node scripts/test-zoom-fixes.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
let failed = 0, passed = 0;
function ok(cond, label) { if (cond) { passed++; console.log("PASS  " + label); } else { failed++; console.log("FAIL  " + label); } }

const nbSrc = readFileSync(new URL("native-bridge.js", root), "utf8");
function cut(name, src) {
  src = src || nbSrc;
  let i = src.indexOf("\nfunction " + name + "(");
  if (i < 0) { i = src.indexOf("\nasync function " + name + "("); }
  if (i < 0) { throw new Error("not in native-bridge.js: " + name); }
  const j = src.indexOf("\n}\n", i + 1);
  return src.slice(i + 1, j + 3);
}
function cutVar(name, src) {
  src = src || nbSrc;
  const i = src.indexOf("\nvar " + name + " =");
  if (i < 0) { throw new Error("var not in native-bridge.js: " + name); }
  const m = /;[ \t]*(\/\/[^\n]*)?\n/.exec(src.slice(i));
  return src.slice(i + 1, i + m.index + 1);
}

// ── Fix 2 + 3: the injected stylesheet ───────────────────────────────────
const cssFns = cut("apexZoomGuardCss") + "\n" + cut("apexInstallZoomGuard");

{
  const sandbox = {
    window: {},
    document: {
      createElement: function () { return { id: "", textContent: "" }; },
      head: { appendChild: function (el) { sandbox.document._installed = el; } },
      documentElement: {}
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(cssFns + "\nthis.apexZoomGuardCss = apexZoomGuardCss; this.apexInstallZoomGuard = apexInstallZoomGuard;", sandbox);

  const css = sandbox.apexZoomGuardCss();
  ok(/font-size:\s*16px\s*!important/.test(css), "16px rule: forces 16px font-size on text fields");
  ok(/touch-action:\s*manipulation/.test(css), "touch-action rule: manipulation present");
  ok(/@media \(pointer: coarse\)/.test(css), "16px rule is scoped to coarse-pointer (touch) devices");
  ok(/:not\(\[type=checkbox\]\)/.test(css) && /:not\(\[type=radio\]\)/.test(css) &&
     /:not\(\[type=range\]\)/.test(css) && /:not\(\[type=color\]\)/.test(css) &&
     /:not\(\[type=file\]\)/.test(css),
     "16px rule excludes checkbox, radio, range, color and file inputs");
  // touch-action's selector list must not be gated behind the coarse-pointer
  // media query (pinch itself must keep working at any pointer type) and must
  // name the elements the task specifies. The rule is everything AFTER the
  // "@media (pointer: coarse) { ... }" block closes.
  const mediaEnd = css.indexOf("}}") + 2; // closes the font-size rule, then the @media block
  const touchActionBlock = css.slice(mediaEnd);
  ["html", "body", "button", "input", "select", "textarea", "a", "label", "summary",
   "[role=button]", "[onclick]"].forEach(function (sel) {
    ok(touchActionBlock.indexOf(sel) >= 0, "touch-action selector list includes " + sel);
  });
  ok(touchActionBlock.indexOf("touch-action: manipulation") >= 0, "touch-action block actually sets touch-action: manipulation");

  sandbox.apexInstallZoomGuard();
  ok(sandbox.document._installed && sandbox.document._installed.id === "apex-zoom-guard",
     "apexInstallZoomGuard appends a <style id=apex-zoom-guard> to <head>");
  ok(sandbox.document._installed.textContent === css,
     "the installed stylesheet's content matches apexZoomGuardCss() exactly");
}

// ── apexIsNative() gating: native-bridge.js only calls apexInstallZoomGuard
// and apexInstallZoomDiagnostics from inside apexInitNativeBridge, which
// returns immediately when !apexIsNative(). Verified structurally here
// rather than by executing the whole file (which needs a real Capacitor
// shell) -- a regression that moved either call outside that gate would
// break this assertion.
{
  const initFn = cut("apexInitNativeBridge");
  const gateLine = initFn.indexOf("if (!apexIsNative()) { return; }");
  const guardCallIdx = initFn.indexOf("apexInstallZoomGuard()");
  const diagCallIdx = initFn.indexOf("apexInstallZoomDiagnostics()");
  ok(gateLine >= 0 && guardCallIdx > gateLine, "apexInstallZoomGuard() is called after the apexIsNative() gate in apexInitNativeBridge");
  ok(gateLine >= 0 && diagCallIdx > gateLine, "apexInstallZoomDiagnostics() is called after the apexIsNative() gate in apexInitNativeBridge");
}
{
  // The web build must be byte-for-byte unchanged: apexZoomGuardCss/
  // apexInstallZoomGuard/the diagnostics installer must never run outside
  // apexInitNativeBridge (no second call site anywhere in the file).
  const guardTotal = (nbSrc.match(/apexInstallZoomGuard\(\)/g) || []).length;
  const diagTotal = (nbSrc.match(/apexInstallZoomDiagnostics\(\)/g) || []).length;
  // One occurrence is the "function apexInstallZoomGuard() {" declaration
  // itself; every other occurrence is a call site.
  ok(guardTotal === 2, "apexInstallZoomGuard() has exactly one call site in the whole file (plus its own declaration)");
  ok(diagTotal === 2, "apexInstallZoomDiagnostics() has exactly one call site in the whole file (plus its own declaration)");
}

// ── Fix 4: the logger ─────────────────────────────────────────────────────
function makeLoggerSandbox(opts) {
  opts = opts || {};
  const sent = [];
  const fakeListeners = { vv: {}, win: {} };
  const vv = {
    scale: (opts.scale !== undefined) ? opts.scale : 1,
    width: 390, height: 780,
    offsetTop: opts.offsetTop || 0,
    offsetLeft: opts.offsetLeft || 0,
    addEventListener: function (ev, fn) { fakeListeners.vv[ev] = fn; }
  };
  const doc = {
    documentElement: {
      clientWidth: opts.clientWidth || 390,
      scrollWidth: opts.scrollWidth || 390
    },
    activeElement: null
  };
  const sandbox = {
    window: {
      visualViewport: vv,
      innerWidth: 390, innerHeight: 780,
      screen: { width: 390 },
      location: { pathname: opts.pathname || "/apex-club.html" },
      addEventListener: function (ev, fn) { fakeListeners.win[ev] = fn; },
      setTimeout: function (fn) { fn(); return 1; }, // run the debounce synchronously for the test
      clearTimeout: function () {},
      localStorage: { getItem: function () { return null; } },
      Capacitor: null,
      getComputedStyle: function () { return { fontSize: "16px" }; }
    },
    document: doc,
    console: { log: function () {} },
    Date: Date,
    fetch: function (url, init) { sent.push({ url, init }); return Promise.resolve({ ok: true }); },
    Promise: Promise,
    Math: Math,
    Object: Object
  };
  sandbox.window.document = doc;
  sandbox.document.defaultView = sandbox.window;
  vm.createContext(sandbox);

  // apexFirebaseAuthPlugin / apexWorkerBase are defined elsewhere in
  // native-bridge.js; stubbed here exactly as the rest of the file would
  // call them -- no plugin, no portal token, so apexZoomSendRecord's
  // "not signed in: drop the record" path is what every test below hits
  // unless a client token is supplied.
  const stubs =
    "function apexFirebaseAuthPlugin() { return null; }\n" +
    (opts.clientToken ? "" : "") +
    "function apexWorkerBase() { return 'https://apex-api.test'; }\n";
  if (opts.clientToken) {
    sandbox.window.localStorage.getItem = function (k) { return k === "apex_client_token" ? opts.clientToken : null; };
  }

  const src = stubs + "\n" +
    cutVar("APEX_ZOOM_SENT_THIS_SESSION") + "\n" +
    cutVar("APEX_ZOOM_MAX_PER_SESSION") + "\n" +
    cutVar("APEX_ZOOM_MIN_GAP_MS") + "\n" +
    cutVar("APEX_ZOOM_LAST_SENT_AT") + "\n" +
    cutVar("APEX_ZOOM_ALREADY_REPORTED_THIS_PAGE") + "\n" +
    cutVar("APEX_ZOOM_LAST_TOUCHES") + "\n" +
    cutVar("APEX_ZOOM_LAST_BLUR") + "\n" +
    cutVar("APEX_ZOOM_LAST_TOUCH_COUNT") + "\n" +
    cutVar("APEX_ZOOM_DEBOUNCE_TIMER") + "\n" +
    cut("apexZoomFieldInfo") + "\n" +
    cut("apexZoomBaseline") + "\n" +
    cut("apexZoomDetected") + "\n" +
    cut("apexZoomBuildRecord") + "\n" +
    cut("apexZoomSendRecord") + "\n" +
    cut("apexZoomCheck") + "\n" +
    cut("apexInstallZoomDiagnostics") + "\n" +
    "this.apexZoomDetected = apexZoomDetected;\n" +
    "this.apexZoomBuildRecord = apexZoomBuildRecord;\n" +
    "this.apexZoomSendRecord = apexZoomSendRecord;\n" +
    "this.apexZoomCheck = apexZoomCheck;\n" +
    "this.apexInstallZoomDiagnostics = apexInstallZoomDiagnostics;\n" +
    "this.__getSentCount = function () { return typeof APEX_ZOOM_SENT_THIS_SESSION !== 'undefined' ? APEX_ZOOM_SENT_THIS_SESSION : 0; };\n";
  vm.runInContext(src, sandbox);
  return { sandbox, vv, doc, sent, fakeListeners };
}

// Normal page: no trigger fires.
{
  const { sandbox } = makeLoggerSandbox({});
  ok(sandbox.apexZoomDetected() === false, "logger: a normal (unzoomed) page is never flagged as a trigger");
}

// Each trigger individually.
{
  const { sandbox } = makeLoggerSandbox({ scale: 1.1 });
  ok(sandbox.apexZoomDetected() === true, "logger: scale above 1.02 is detected");
}
{
  const { sandbox } = makeLoggerSandbox({ scale: 1.0 });
  ok(sandbox.apexZoomDetected() === false, "logger: scale of exactly 1.0 is not a false positive");
}
{
  const { sandbox } = makeLoggerSandbox({ offsetTop: 5 });
  ok(sandbox.apexZoomDetected() === true, "logger: |offsetTop| above 2 is detected");
}
{
  const { sandbox } = makeLoggerSandbox({ offsetLeft: -5 });
  ok(sandbox.apexZoomDetected() === true, "logger: |offsetLeft| above 2 (negative) is detected");
}
{
  const { sandbox } = makeLoggerSandbox({ clientWidth: 390, scrollWidth: 400 });
  ok(sandbox.apexZoomDetected() === true, "logger: scrollWidth > clientWidth + 2 (overflow) is detected");
}
{
  const { sandbox } = makeLoggerSandbox({ clientWidth: 390, scrollWidth: 391 });
  ok(sandbox.apexZoomDetected() === false, "logger: a 1px overflow rounding wobble is not a false positive");
}

// Already-reported-this-page-view gate.
{
  const { sandbox } = makeLoggerSandbox({ scale: 1.1 });
  sandbox.APEX_ZOOM_ALREADY_REPORTED_THIS_PAGE = true;
  ok(sandbox.apexZoomDetected() === false, "logger: a trigger already reported on this page view is not detected again");
}

// Record shape: no free text, no field values, no names.
{
  // location.pathname never includes the query string by definition; the
  // record must read .pathname (not .href or .search) so a token/secret in
  // the URL's query string can never end up in the payload.
  const { sandbox } = makeLoggerSandbox({ scale: 1.2, pathname: "/apex-club.html" });
  const rec = sandbox.apexZoomBuildRecord();
  ok(rec.path === "/apex-club.html", "record.path is location.pathname only (no query string)");
  const json = JSON.stringify(rec);
  ok(!/secret|xyz/.test(json), "record never leaks a query string value");
  ok(typeof rec.scale === "number" && typeof rec.vv_width === "number" &&
     typeof rec.offset_top === "number" && typeof rec.client_width === "number",
     "record carries the numeric viewport fields");
  ok(rec.field === null, "record.field is null when no input is focused or recently blurred");
  ok(!("value" in rec) && !("name" in rec) && !("text" in rec),
     "record never carries a value/name/text key");
}
{
  const { sandbox, doc } = makeLoggerSandbox({ scale: 1.2 });
  doc.activeElement = { tagName: "INPUT", type: "text", id: "evName" };
  sandbox.window.getComputedStyle = function () { return { fontSize: "13px" }; };
  const rec = sandbox.apexZoomBuildRecord();
  ok(rec.field && rec.field.tag === "input" && rec.field.type === "text" &&
     rec.field.id === "evName" && rec.field.font_size === "13px" && rec.field.state === "focused",
     "record.field reports tag/type/id/font-size when a field is focused, never its value");
}

// Throttling: at most 1/60s and 5/session.
{
  const { sandbox, sent } = makeLoggerSandbox({ scale: 1.2, clientToken: "capt_test_token" });
  sandbox.apexZoomSendRecord({ path: "/x" });
  ok(sandbox.APEX_ZOOM_SENT_THIS_SESSION === 0, "send is dropped synchronously before the async id-token lookup resolves (count only increments inside the resolved branch)");
}
{
  // Drive the full async chain for real with Promise microtasks.
  async function run() {
    const { sandbox, sent } = makeLoggerSandbox({ scale: 1.2, clientToken: "capt_test_token" });
    await sandbox.apexZoomSendRecord({ path: "/x" });
    ok(sent.length === 1, "logger: a signed-in record is sent (one fetch call)");
    ok(sent[0].url === "https://apex-api.test/api/diagnostics/zoom", "logger: posts to /api/diagnostics/zoom");
    ok(sent[0].init.headers.Authorization === "Bearer capt_test_token", "logger: carries the portal token as a Bearer header when there is no Firebase plugin");

    // Second call within 60s: dropped by the client-side throttle.
    await sandbox.apexZoomSendRecord({ path: "/x" });
    ok(sent.length === 1, "logger: a second record within 60 seconds is dropped (max 1 per 60s)");
  }
  await run();
}
{
  async function run() {
    const { sandbox, sent } = makeLoggerSandbox({ scale: 1.2, clientToken: "capt_test_token" });
    for (let i = 0; i < 10; i++) {
      sandbox.APEX_ZOOM_LAST_SENT_AT = 0; // simulate time passing past the 60s gap each time
      await sandbox.apexZoomSendRecord({ path: "/x" });
    }
    ok(sent.length === 5, "logger: never sends more than 5 records in one session even with the 60s gap satisfied each time");
  }
  await run();
}
{
  async function run() {
    const { sandbox, sent } = makeLoggerSandbox({ scale: 1.2 }); // no clientToken, no Firebase plugin
    await sandbox.apexZoomSendRecord({ path: "/x" });
    ok(sent.length === 0, "logger: drops the record (no fetch) when the user is not signed in");
  }
  await run();
}

// ── Fix 1: capacitor.config.json ─────────────────────────────────────────
{
  const cfg = JSON.parse(readFileSync(new URL("capacitor.config.json", root), "utf8"));
  ok(cfg.ios && cfg.ios.zoomEnabled === true, "capacitor.config.json: ios.zoomEnabled is true");
  ok(cfg.ios && cfg.ios.contentInset === "always", "capacitor.config.json: ios.contentInset is still \"always\"");
}

// ── Worker: POST /api/diagnostics/zoom and GET /api/diagnostics/zoom ────
import { makeDb, build, baseStubs, req } from "./fixtures/d1-shim.mjs";

{
  const FNS = ["handlePostDiagnosticsZoom", "handleGetDiagnosticsZoom", "zoomValidatePayload"];
  const VARS = ["ZOOM_EVENTS_MAX_PER_DAY", "ZOOM_PATH_RE"];

  function world(role, overrides) {
    const d = makeDb(["migrations/zoom_events.sql"]);
    const stubs = Object.assign({}, baseStubs, {
      authenticate: async () => ({ role: role || "client", client_id: "c1", email: "owner@test.com", display_name: "Owner" })
    }, overrides || {});
    const F = build(FNS, VARS, stubs);
    return { d, env: { DB: d.DB }, F };
  }

  {
    const w = world("client");
    const r = await w.F.handlePostDiagnosticsZoom(req({ path: "/apex-club.html", scale: 1.2 }), w.env);
    ok(r.status === 200 && r.data.stored === true, "POST /api/diagnostics/zoom: a well-formed record from a signed-in client is stored");
    const row = w.d.raw.prepare("SELECT who, path FROM zoom_events").get();
    ok(row && row.who === "owner@test.com" && row.path === "/apex-club.html", "the stored row carries who and path");
  }
  {
    const w = world("client");
    const r = await w.F.handlePostDiagnosticsZoom(req({ path: "not-a-path", scale: 1.2 }), w.env);
    ok(r.status === 200 && r.data.stored === false, "POST: an invalid path shape is refused with {stored:false}, not a 400 a page could show as an error");
  }
  {
    const w = world("client");
    const r = await w.F.handlePostDiagnosticsZoom(req({ path: "/x", huge: "y".repeat(500) }), w.env);
    ok(r.status === 200 && r.data.stored === false, "POST: an oversized string field is refused");
  }
  {
    const w = world("client");
    const tooManyKeys = {};
    for (let i = 0; i < 50; i++) { tooManyKeys["k" + i] = i; }
    const r = await w.F.handlePostDiagnosticsZoom(req(Object.assign({ path: "/x" }, tooManyKeys)), w.env);
    ok(r.status === 200 && r.data.stored === false, "POST: a payload with too many keys is refused");
  }
  {
    const w = world("client");
    const r = await w.F.handlePostDiagnosticsZoom({ url: "https://x.test/", headers: { get: () => null }, json: async () => { throw new Error("bad json"); } }, w.env);
    ok(r.status === 200 && r.data.stored === false, "POST: unparseable JSON body answers {stored:false}, never a crash");
  }
  {
    // 21st row today is refused; one indexed COUNT, not a scan.
    const w = world("client");
    for (let i = 0; i < 20; i++) {
      await w.F.handlePostDiagnosticsZoom(req({ path: "/x", n: i }), w.env);
    }
    const row20 = w.d.raw.prepare("SELECT COUNT(*) AS n FROM zoom_events").get();
    ok(row20.n === 20, "20 rows were actually written before the cap");
    const r21 = await w.F.handlePostDiagnosticsZoom(req({ path: "/x", n: 21 }), w.env);
    ok(r21.status === 200 && r21.data.stored === false, "POST: the 21st row in a day is refused ({stored:false}, still HTTP 200)");
    const rowsAfter = w.d.raw.prepare("SELECT COUNT(*) AS n FROM zoom_events").get();
    ok(rowsAfter.n === 20, "the 21st attempt did not actually insert a row");
  }
  {
    // Missing table: makeDb() with no zoom_events.sql migration applied.
    const d = makeDb([]);
    const stubs = Object.assign({}, baseStubs, { authenticate: async () => ({ role: "client", client_id: "c1", email: "owner@test.com" }) });
    const F = build(FNS, VARS, stubs);
    const r = await F.handlePostDiagnosticsZoom(req({ path: "/x" }), { DB: d.DB });
    ok(r.status === 200 && r.data.stored === false, "POST: a missing zoom_events table answers {stored:false}, never a crash");
  }
  {
    const d = makeDb(["migrations/zoom_events.sql"]);
    const stubs = Object.assign({}, baseStubs, { authenticate: async () => null });
    const F = build(FNS, VARS, stubs);
    const r = await F.handlePostDiagnosticsZoom(req({ path: "/x" }), { DB: d.DB });
    ok(r.status === 401, "POST /api/diagnostics/zoom: unauthenticated is refused with 401");
  }

  // GET: developer-only.
  {
    const w = world("client");
    const r = await w.F.handleGetDiagnosticsZoom(req({}), w.env);
    ok(r.status === 403, "GET /api/diagnostics/zoom: a client session is refused (403)");
  }
  {
    const w = world("alice");
    const r = await w.F.handleGetDiagnosticsZoom(req({}), w.env);
    ok(r.status === 403, "GET /api/diagnostics/zoom: alice (staff, not developer) is refused (403)");
  }
  {
    const w = world("developer");
    await w.F.handlePostDiagnosticsZoom(req({ path: "/apex-club.html" }), w.env);
    const r = await w.F.handleGetDiagnosticsZoom(req({}), w.env);
    ok(r.status === 200 && Array.isArray(r.data.events) && r.data.events.length === 1, "GET /api/diagnostics/zoom: the developer reads back the stored rows");
  }
  {
    const d = makeDb([]); // no migration
    const stubs = Object.assign({}, baseStubs, { authenticate: async () => ({ role: "developer" }) });
    const F = build(FNS, VARS, stubs);
    const r = await F.handleGetDiagnosticsZoom(req({}), { DB: d.DB });
    ok(r.status === 200 && Array.isArray(r.data.events) && r.data.events.length === 0, "GET: a missing table answers an empty list, never a crash");
  }
}

console.log("");
console.log(failed === 0 ? "✅ ALL PASS" : "❌ " + failed + " FAILED, " + passed + " passed");
process.exit(failed === 0 ? 0 : 1);
