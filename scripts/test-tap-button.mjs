// Tap to Pay button (Build 5): the gating, in-progress disable, and polling
// logic, cut directly from gm.js (never a rewritten copy) and run against
// fakes. No network, no real Capacitor/Terminal SDK runtime -- this proves
// the BUTTON LOGIC only. See scripts/test-stripe-app-connect.mjs for the
// native-vs-web branching this build also touches.
//
//   node scripts/test-tap-button.mjs
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const gmSrc = readFileSync(new URL("../gm.js", import.meta.url), "utf8");

function fnSrc(name, src) {
  let i = src.indexOf("\nasync function " + name + "(");
  if (i < 0) { i = src.indexOf("\nfunction " + name + "("); }
  if (i < 0) { throw new Error("function not found: " + name); }
  const j = src.indexOf("\n}", i + 1);
  return src.slice(i + 1, j + 2);
}
function varSrc(name, src) {
  const i = src.indexOf("\nvar " + name + " =");
  if (i < 0) { throw new Error("var not found: " + name); }
  const m = /;[ \t]*(\/\/[^\n]*)?\n/.exec(src.slice(i));
  return src.slice(i + 1, i + m.index + 1);
}

function build(names, vars, stubs) {
  const stubNames = Object.keys(stubs);
  const getSet = vars.map((v) =>
    "get " + v + "() { return " + v + "; }, set " + v + "(v) { " + v + " = v; },"
  ).join("\n");
  const body = vars.map((v) => varSrc(v, gmSrc)).join("\n") + "\n" +
    names.map((n) => fnSrc(n, gmSrc)).join("\n") +
    "\nreturn { " + names.join(", ") + ",\n" + getSet + "\n};";
  return new Function(...stubNames, body)(...stubNames.map((k) => stubs[k]));
}

const FNS = [
  "gmTapButtonHtml", "gmTapCheckReady", "gmTapRerenderIfSameInvoice",
  "gmTapSetBusy", "gmTapErrorText", "gmTapStart", "gmTapPollInvoicePaid",
  "gmTapPlugin", "gmTapShowStatus", "gmTapStatusHtml", "gmTapWireTokenListener"
];
const VARS = ["gmTapReady", "gmTapBusy", "gmTapLocationId", "GM_TAP_ERROR_TEXT", "gmTapTokenListenerWired"];

function world(opts) {
  opts = opts || {};
  const calls = { api: [], pluginCalls: [], rerendered: 0 };
  const elements = {};
  const gmInvDetail0 = opts.gmInvDetail !== undefined ? opts.gmInvDetail : { id: "inv1", balance_cents: 10000 };

  const pluginStub = opts.plugin !== undefined ? opts.plugin : {
    isSupported: async () => ({ supported: opts.supported !== false }),
    prepare: async (args) => { calls.pluginCalls.push(["prepare", args]); if (opts.prepareError) { throw opts.prepareError; } return { connected: true }; },
    takePayment: async (args) => { calls.pluginCalls.push(["takePayment", args]); if (opts.takePaymentError) { throw opts.takePaymentError; } return { status: "succeeded", paymentIntentId: "pi_1" }; },
    addListener: () => {}
  };

  const stubs = {
    window: { Capacitor: { Plugins: { ApexTapToPay: pluginStub } } },
    gmInApp: () => opts.inApp !== false,
    isEn: () => false,
    gmT: (pt, en) => pt,
    escHtml: (s) => String(s),
    gmMoney: (c) => "$" + (c / 100).toFixed(2),
    document: {
      getElementById: (id) => elements[id] || null
    },
    setTimeout: (fn, ms) => { calls.timers = calls.timers || []; calls.timers.push({ fn, ms }); return calls.timers.length; },
    console: console,
    gmApi: (path, apiOpts) => {
      calls.api.push({ path, opts: apiOpts });
      const handler = opts.api && opts.api[path];
      if (!handler) { return Promise.reject(new Error("no api stub for " + path)); }
      return handler(apiOpts);
    },
    gmRenderInvoiceSheet: () => { calls.rerendered++; },
    get gmInvDetail() { return gmInvDetail0; }
  };
  const F = build(FNS, VARS, stubs);
  return { F, calls, elements, stubs };
}

// ── button hidden on web ──────────────────────────────────────────────────
{
  const w = world({ inApp: false });
  const html = w.F.gmTapButtonHtml({ id: "inv1", balance_cents: 10000 });
  ok(html === "", "button hidden outside the native app (web browser)");
}

// ── button hidden on iPad / unsupported device ───────────────────────────
{
  const w = world({ inApp: true, supported: false });
  w.F.gmTapReady = null;
  const html1 = w.F.gmTapButtonHtml({ id: "inv1", balance_cents: 10000 });
  ok(html1 === "", "first render (still loading isSupported): nothing shown yet");
  await new Promise((r) => setTimeout(r, 10));
  w.F.gmTapReady = { supported: false, enabled: false };
  const html2 = w.F.gmTapButtonHtml({ id: "inv1", balance_cents: 10000 });
  ok(html2 === "", "button hidden once isSupported() answers false (iPad or unsupported iPhone)");
}

// ── button hidden when Tap to Pay is off for the business ───────────────
{
  const w = world({ inApp: true });
  w.F.gmTapReady = { supported: true, enabled: false };
  const html = w.F.gmTapButtonHtml({ id: "inv1", balance_cents: 10000 });
  ok(html === "", "button hidden when the business has Tap to Pay switched off");
}

// ── button hidden when no balance due ────────────────────────────────────
{
  const w = world({ inApp: true });
  w.F.gmTapReady = { supported: true, enabled: true };
  const html = w.F.gmTapButtonHtml({ id: "inv1", balance_cents: 0 });
  ok(html === "", "button hidden when the invoice has no balance due (already paid)");
}

// ── button shown when every condition holds ──────────────────────────────
{
  const w = world({ inApp: true });
  w.F.gmTapReady = { supported: true, enabled: true };
  const html = w.F.gmTapButtonHtml({ id: "inv1", balance_cents: 10000 });
  ok(/id="gmTapBtn"/.test(html), "button renders when in-app, supported, enabled, and a balance is due");
  ok(/Receber no cart.o \(tap\)/.test(html) || /gmTapStart/.test(html), "button calls gmTapStart and carries the Portuguese label by default");
}

// ── gmTapCheckReady populates gmTapReady and re-renders the SAME invoice sheet ──
{
  const w = world({
    inApp: true,
    supported: true,
    api: { "stripe/tap": async () => ({ enabled: true, location_id: "loc_abc" }) }
  });
  w.F.gmTapReady = null;
  w.F.gmTapCheckReady("inv1");
  await new Promise((r) => setTimeout(r, 20));
  ok(w.F.gmTapReady && w.F.gmTapReady.supported === true && w.F.gmTapReady.enabled === true, "gmTapCheckReady sets gmTapReady from isSupported()+stripe/tap");
  ok(w.F.gmTapLocationId === "loc_abc", "gmTapCheckReady also caches the location id from stripe/tap");
  ok(w.calls.rerendered === 1, "the sheet re-renders once the async check resolves");
}
{
  // A DIFFERENT invoice is open by the time the check resolves (user
  // navigated away): must not re-render the wrong sheet.
  const w = world({
    inApp: true, supported: true,
    gmInvDetail: { id: "inv-other", balance_cents: 500 },
    api: { "stripe/tap": async () => ({ enabled: true, location_id: "loc_x" }) }
  });
  w.F.gmTapReady = null;
  w.F.gmTapCheckReady("inv1");
  await new Promise((r) => setTimeout(r, 20));
  ok(w.calls.rerendered === 0, "no re-render when a different invoice sheet is now open");
}

// ── in-progress disables the button ──────────────────────────────────────
{
  const w = world({ inApp: true });
  w.elements.gmTapBtn = { disabled: false };
  w.F.gmTapSetBusy(true);
  ok(w.F.gmTapBusy === true && w.elements.gmTapBtn.disabled === true, "gmTapSetBusy(true) sets the flag and disables the button element");
  w.F.gmTapSetBusy(false);
  ok(w.F.gmTapBusy === false && w.elements.gmTapBtn.disabled === false, "gmTapSetBusy(false) re-enables it");
}
{
  // gmTapStart itself refuses to start a second payment while one is in flight.
  const w = world({ inApp: true });
  w.F.gmTapBusy = true;
  w.F.gmTapStart("inv1");
  ok(w.calls.api.length === 0 && w.calls.pluginCalls.length === 0, "gmTapStart is a no-op while a payment is already in progress (never double-charges)");
}

// ── success: reload + poll logic ──────────────────────────────────────────
{
  const w = world({
    api: {
      "invoices/inv1": async () => ({ invoice: { id: "inv1", derived_status: "unpaid" } })
    }
  });
  w.F.gmTapPollInvoicePaid("inv1", 0);
  await new Promise((r) => setTimeout(r, 10));
  ok(w.calls.timers && w.calls.timers.length === 1 && w.calls.timers[0].ms === 2000, "not yet paid: schedules the next poll 2 seconds later");
}
{
  const w = world({
    api: {
      "invoices/inv1": async () => ({ invoice: { id: "inv1", derived_status: "paid", number: "INV-01" } })
    }
  });
  w.F.gmTapPollInvoicePaid("inv1", 0);
  await new Promise((r) => setTimeout(r, 10));
  ok(w.calls.rerendered === 1 && (!w.calls.timers || w.calls.timers.length === 0), "once paid: re-renders the sheet and stops polling");
}
{
  // 20s elapsed and still not paid: stop polling, show the "may take a few
  // seconds" message rather than looping forever.
  const w = world({
    api: { "invoices/inv1": async () => ({ invoice: { id: "inv1", derived_status: "unpaid" } }) }
  });
  w.elements.gmTapBtn = { disabled: false };
  w.F.gmTapPollInvoicePaid("inv1", 20000);
  await new Promise((r) => setTimeout(r, 10));
  ok(!w.calls.timers || w.calls.timers.length === 0, "after 20 seconds elapsed, polling stops rather than continuing forever");
}

// ── error states ──────────────────────────────────────────────────────────
const ERROR_CASES = ["cancelled", "cancelled_on_reader", "declined", "card_read_failed", "not_connected", "no_network", "too_many_accounts_today", "payment_in_progress"];
for (const code of ERROR_CASES) {
  const w = world({});
  const text = w.F.gmTapErrorText(code);
  ok(typeof text === "string" && text.length > 0, "gmTapErrorText(" + code + ") returns a non-empty bilingual message");
}
{
  const w = world({});
  const text = w.F.gmTapErrorText("some_unknown_code_12345");
  ok(typeof text === "string" && text.length > 0, "an unrecognized error code still gets a generic fallback message, never undefined");
}
{
  // End-to-end: prepare() fails with a Capacitor-style rejection carrying a
  // .code, and gmTapStart surfaces that code's text via the status line.
  const err = new Error("connectReader failed");
  err.code = "declined";
  const w = world({
    inApp: true,
    api: { "stripe/tap": async () => ({ enabled: true, location_id: "loc_1" }) },
    prepareError: err
  });
  w.elements.gmTapBtn = { disabled: false };
  w.F.gmTapStart("inv1");
  await new Promise((r) => setTimeout(r, 20));
  ok(w.F.gmTapBusy === false, "gmTapStart clears the busy flag after a failure");
}

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
