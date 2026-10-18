// Tap to Pay / Stripe Connect inside the iPhone app: the native-vs-web
// branching logic, cut directly from gm.js and native-bridge.js (never a
// rewritten copy) and run against fakes. No network, no real Capacitor
// runtime -- this proves the BRANCHING only. The real in-app behavior
// (Stripe's hosted onboarding actually opening in the system browser sheet,
// and the app actually reloading status on foreground) is NOT verified here
// and needs a TestFlight build -- see the final report.
//
//   node scripts/test-stripe-app-connect.mjs
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const gmSrc = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
const nbSrc = readFileSync(new URL("../native-bridge.js", import.meta.url), "utf8");

function fnSrc(name, src) {
  let i = src.indexOf("\nasync function " + name + "(");
  if (i < 0) { i = src.indexOf("\nfunction " + name + "("); }
  if (i < 0) { throw new Error("function not found: " + name); }
  const j = src.indexOf("\n}", i + 1);
  return src.slice(i + 1, j + 2);
}

function buildBrowserFns(stubs) {
  const names = ["apexIsNative", "apexOpenExternal"];
  const body = names.map((n) => fnSrc(n, nbSrc)).join("\n") +
    "\nreturn { " + names.join(", ") + " };";
  const stubNames = Object.keys(stubs);
  return new Function(...stubNames, body)(...stubNames.map((k) => stubs[k]));
}

function buildGmFns(stubs) {
  const names = ["gmInApp", "gmStripeConnect", "gmStripeWireAppResume"];
  const body = "var gmStripeResumeWired = false;\n" +
    names.map((n) => fnSrc(n, gmSrc)).join("\n") +
    "\nreturn { " + names.join(", ") + " };";
  const stubNames = Object.keys(stubs);
  return new Function(...stubNames, body)(...stubNames.map((k) => stubs[k]));
}

// ── apexOpenExternal: native vs web ───────────────────────────────────────
// apexIsNative itself is extracted (never stubbed out from under
// apexOpenExternal's own call to it), so "native" here means what the real
// function means: window.Capacitor.isNativePlatform() === true.
{
  let browserOpenedWith = null;
  const window_ = { Capacitor: { isNativePlatform: () => true, Plugins: { Browser: { open: (o) => { browserOpenedWith = o.url; } } } } };
  const F = buildBrowserFns({ window: window_ });
  const r = F.apexOpenExternal("https://connect.stripe.com/setup/x");
  ok(r === true && browserOpenedWith === "https://connect.stripe.com/setup/x", "native: apexOpenExternal hands the Stripe URL to Capacitor's Browser.open (system browser sheet)");
}
{
  let windowOpenedWith = null;
  const window_ = { Capacitor: { isNativePlatform: () => false }, open: (url) => { windowOpenedWith = url; return true; } };
  const F = buildBrowserFns({ window: window_ });
  const r = F.apexOpenExternal("https://connect.stripe.com/setup/x");
  ok(r === true && windowOpenedWith === "https://connect.stripe.com/setup/x", "web: apexOpenExternal behaves exactly as before (window.open), unchanged outside the app");
}
{
  // No Browser plugin available: falls through to a direct location assignment, never throws.
  const location = { href: null };
  const window_ = { Capacitor: { isNativePlatform: () => true, Plugins: {} }, location };
  const F = buildBrowserFns({ window: window_ });
  const r = F.apexOpenExternal("https://connect.stripe.com/setup/y");
  ok(r === true && location.href === "https://connect.stripe.com/setup/y", "native with no Browser plugin: falls back to window.location.href rather than throwing");
}

// ── gmStripeConnect: branches on gmInApp(), never touches window.location in-app ──
function worldGmConnect(isApp) {
  const calls = { apiBody: null, externalUrl: null, locationSet: null, resumeWired: false };
  const window_ = { apexIsNative: () => isApp, location: {} };
  Object.defineProperty(window_.location, "href", { set: (v) => { calls.locationSet = v; }, get: () => calls.locationSet });
  const stubs = {
    window: window_,
    apexIsNative: () => isApp,
    document: { getElementById: () => null },
    gmApi: (path, opts) => { calls.apiBody = opts.body; return Promise.resolve({ url: "https://connect.stripe.com/setup/abc" }); },
    apexOpenExternal: (url) => { calls.externalUrl = url; return true; },
    gmRenderEstimatesTab: () => {},
    gmToast: () => {},
    isEn: () => false,
    console: console
  };
  const F = buildGmFns(stubs);
  return { F, calls, window_ };
}
{
  const w = worldGmConnect(true);
  await w.F.gmStripeConnect(null);
  ok(w.calls.externalUrl === "https://connect.stripe.com/setup/abc", "in-app: gmStripeConnect opens the Stripe URL with apexOpenExternal, not window.location");
  ok(w.calls.locationSet === null, "in-app: window.location.href is never touched");
}
{
  const w = worldGmConnect(false);
  await w.F.gmStripeConnect(null);
  ok(w.calls.locationSet === "https://connect.stripe.com/setup/abc", "web: gmStripeConnect behaves exactly as before, sending the browser to the URL");
  ok(w.calls.externalUrl === null, "web: apexOpenExternal is never called outside the app");
}

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
