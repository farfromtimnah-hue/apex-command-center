// Fix 5 (2026-10-18): Tap to Pay is gated to the developer role until Apple
// grants the distribution entitlement, unless env.TAP_TO_PAY_PUBLIC === "1".
// The REAL Worker functions on an in-memory SQLite, with stripeApi stubbed
// (no network, no live Stripe calls, no production database) -- same shim
// scripts/test-tap-to-pay.mjs uses.
//   node scripts/test-tap-gate.mjs
import { makeDb, build, baseStubs, req } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = [
  "gmStripeRow", "gmStripeOwnerGuard", "gmTapRoleGate",
  "gmTapMigrationMissing", "gmTapNotAvailable", "gmStripeTapOwnerGuard", "gmStripeTapActorGuard",
  "handleGetGmStripeTap", "handlePostGmStripeTapEnable", "handlePostGmStripeTapDisable",
  "handlePostGmStripeTapConnectionToken", "handlePostGmStripeTapPaymentIntent", "handlePostGmStripeTapSharedDetails",
  "gmInvLoad", "gmInvDerive", "gmInvTolerance", "gmDocSettingsRow", "gmDocParseLicenses", "gmDocHexColor", "gmDocParseJsonObject",
  "gmStripeRecordCardPayment", "gmStripeRecordPaid", "gmStripeRecordTapPaid", "gmLogLeadEvents",
  "requireClientAccess", "sessionSellerName"
];
const VARS = ["STRIPE_SANDBOX_CLIENT_ID", "GM_TAP_SHARED_FIELD_MAP", "GM_TAP_SHARED_NO_COLUMN"];
const MIGRATIONS = [
  "migrations/client_estimates_invoices_p3.sql",
  "migrations/stripe_connect.sql",
  "migrations/stripe_connect_accepted.sql",
  "migrations/tap_to_pay.sql"
];

function seedExtraTables(d) {
  d.raw.exec("CREATE TABLE IF NOT EXISTS gm_doc_settings (client_id TEXT PRIMARY KEY, legal_name TEXT, address TEXT, phone TEXT, email TEXT, license_numbers TEXT NOT NULL DEFAULT '[]', payment_methods_json TEXT NOT NULL DEFAULT '{}', schedule_presets_json TEXT NOT NULL DEFAULT '[]', estimate_valid_days INTEGER NOT NULL DEFAULT 30, default_terms_days INTEGER NOT NULL DEFAULT 0)");
  d.raw.exec("CREATE TABLE IF NOT EXISTS gm_config (client_id TEXT PRIMARY KEY, target_margin REAL)");
  d.raw.exec("CREATE TABLE IF NOT EXISTS gm_leads (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, cliente TEXT NOT NULL, telefone TEXT, email TEXT, addr_street TEXT, addr_city TEXT, addr_state TEXT, addr_zip TEXT)");
  d.raw.exec("CREATE TABLE IF NOT EXISTS gm_lead_events (id TEXT PRIMARY KEY, lead_id TEXT, client_id TEXT, action TEXT, field TEXT, old_value TEXT, new_value TEXT, actor TEXT, reason TEXT)");
}

function world(user, envOverrides, stripeApiImpl) {
  const d = makeDb(MIGRATIONS);
  seedExtraTables(d);
  const stubs = Object.assign({}, baseStubs, {
    gmEasternToday: () => "2026-10-18",
    authenticate: async () => user,
    stripeApi: async (env, method, path, params, account) => {
      if (stripeApiImpl) { return stripeApiImpl(method, path, params, account); }
      throw new Error("unexpected Stripe call in gate test: " + path);
    },
    jsonErr2: (pt, en, status) => ({ status: status || 400, error: en, error_pt: pt, error_en: en })
  });
  const F = build(FNS, VARS, stubs);
  const env = Object.assign({ DB: d.DB, STRIPE_SECRET_KEY: "sk_test_x" }, envOverrides || {});
  return { d, env, F };
}

function seedClient(d, id) { d.raw.prepare("INSERT INTO clients (id, name) VALUES (?, ?)").run(id, id); }
function seedStripeAccount(d, clientId, acctId, chargesEnabled) {
  d.raw.prepare(
    "INSERT INTO gm_stripe_accounts (client_id, stripe_account_id, charges_enabled, details_submitted, livemode, created_at, updated_at) VALUES (?, ?, ?, 1, 0, datetime('now'), datetime('now'))"
  ).run(clientId, acctId, chargesEnabled ? 1 : 0);
}
function seedDocAddress(d, clientId, addr) {
  d.raw.prepare("INSERT INTO gm_doc_settings (client_id, address) VALUES (?, ?) ON CONFLICT (client_id) DO UPDATE SET address = excluded.address").run(clientId, addr);
}
function enableTap(d, clientId) {
  d.raw.prepare("INSERT INTO gm_stripe_terminal_locations (client_id, location_id, created_at) VALUES (?, 'loc_1', datetime('now'))").run(clientId);
  d.raw.prepare("UPDATE gm_stripe_accounts SET tap_enabled = 1 WHERE client_id = ?").run(clientId);
}
function seedInvoice(d, id, clientId, opts) {
  opts = opts || {};
  d.raw.prepare(
    "INSERT INTO gm_invoices (id, client_id, job_id, lead_id, number, status, amount_cents, public_token) VALUES (?, ?, 'job1', ?, ?, ?, ?, ?)"
  ).run(id, clientId, opts.lead_id || null, opts.number || "INV-0001", opts.status || "sent", opts.amount_cents || 10000, id + "-token");
}

const OWNER = { role: "client", client_id: "c1", display_name: "Owner" };
const SELLER = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Joe", display_name: "Joe" };
const DEVELOPER = { role: "developer", display_name: "Dev" };

// ── GET /gm/stripe/tap: gated answer is {available:false, enabled:false} ──
{
  const w = world(OWNER);
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  enableTap(w.d, "c1");
  const r = await w.F.handleGetGmStripeTap("c1", req({}), w.env);
  ok(r.status === 200 && r.data.available === false && r.data.enabled === false,
     "GET tap: a gated owner (enabled in the DB) is shown available:false, enabled:false -- gm.js hides the switch and button with no other change");
}
{
  const w = world(DEVELOPER);
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  enableTap(w.d, "c1");
  const r = await w.F.handleGetGmStripeTap("c1", req({}), w.env);
  ok(r.status === 200 && r.data.available === true && r.data.enabled === true,
     "GET tap: the developer sees the real status");
}
{
  const w = world(OWNER, { TAP_TO_PAY_PUBLIC: "1" });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  enableTap(w.d, "c1");
  const r = await w.F.handleGetGmStripeTap("c1", req({}), w.env);
  ok(r.status === 200 && r.data.available === true && r.data.enabled === true,
     "GET tap: TAP_TO_PAY_PUBLIC=1 opens the real status to an owner");
}

// ── Every write route: owner and seller gated, developer works ──────────
const WRITE_ROUTES = [
  { name: "enable", fn: "handlePostGmStripeTapEnable", body: { accepted: true }, needsEnabled: false },
  { name: "disable", fn: "handlePostGmStripeTapDisable", body: {}, needsEnabled: false },
  { name: "connection-token", fn: "handlePostGmStripeTapConnectionToken", body: {}, needsEnabled: true, actorRoute: true },
  { name: "payment-intent", fn: "handlePostGmStripeTapPaymentIntent", body: { invoice_id: "inv1" }, needsEnabled: true, actorRoute: true, needsInvoice: true },
  { name: "shared-details", fn: "handlePostGmStripeTapSharedDetails", body: { invoice_id: "inv1", details: {} }, needsEnabled: false, actorRoute: true, needsInvoice: true }
];

for (const route of WRITE_ROUTES) {
  // Owner, gated (no TAP_TO_PAY_PUBLIC, not developer).
  {
    const w = world(OWNER);
    seedClient(w.d, "c1");
    seedStripeAccount(w.d, "c1", "acct_1", true);
    seedDocAddress(w.d, "c1", "123 Main St");
    if (route.needsEnabled) { enableTap(w.d, "c1"); }
    if (route.needsInvoice) { seedInvoice(w.d, "inv1", "c1"); }
    const r = await w.F[route.fn]("c1", req(route.body), w.env);
    ok(r.status === 409, "Fix 5: " + route.name + " refuses a non-developer owner (409, not available yet)");
  }
  // Seller of the same business, gated (actor routes only -- enable/disable
  // already refuse a seller for an unrelated reason, owner-only).
  if (route.actorRoute) {
    const w = world(SELLER);
    seedClient(w.d, "c1");
    seedStripeAccount(w.d, "c1", "acct_1", true);
    if (route.needsEnabled) { enableTap(w.d, "c1"); }
    if (route.needsInvoice) { seedInvoice(w.d, "inv1", "c1"); }
    const r = await w.F[route.fn]("c1", req(route.body), w.env);
    ok(r.status === 409, "Fix 5: " + route.name + " refuses a seller of the same business (409, not available yet)");
  }
  // Developer: works on every route (gate passes; route's own logic runs).
  {
    const w = world(DEVELOPER, {}, (method, path) => {
      if (path === "/v1/terminal/locations") { return { id: "loc_1" }; }
      if (path === "/v1/terminal/connection_tokens") { return { secret: "pst_dev" }; }
      if (path === "/v1/payment_intents") { return { id: "pi_1", client_secret: "pi_1_secret" }; }
      throw new Error("unexpected: " + path);
    });
    seedClient(w.d, "c1");
    seedStripeAccount(w.d, "c1", "acct_1", true);
    seedDocAddress(w.d, "c1", "123 Main St");
    if (route.needsEnabled) { enableTap(w.d, "c1"); }
    if (route.needsInvoice) { seedInvoice(w.d, "inv1", "c1"); }
    const r = await w.F[route.fn]("c1", req(route.body), w.env);
    ok(r.status === 200, "Fix 5: " + route.name + " still works for the developer (status " + r.status + (r.error ? " " + r.error : "") + ")");
  }
  // TAP_TO_PAY_PUBLIC="1": opens it for a plain owner.
  {
    const w = world(OWNER, { TAP_TO_PAY_PUBLIC: "1" }, (method, path) => {
      if (path === "/v1/terminal/locations") { return { id: "loc_1" }; }
      if (path === "/v1/terminal/connection_tokens") { return { secret: "pst_owner" }; }
      if (path === "/v1/payment_intents") { return { id: "pi_1", client_secret: "pi_1_secret" }; }
      throw new Error("unexpected: " + path);
    });
    seedClient(w.d, "c1");
    seedStripeAccount(w.d, "c1", "acct_1", true);
    seedDocAddress(w.d, "c1", "123 Main St");
    if (route.needsEnabled) { enableTap(w.d, "c1"); }
    if (route.needsInvoice) { seedInvoice(w.d, "inv1", "c1"); }
    const r = await w.F[route.fn]("c1", req(route.body), w.env);
    ok(r.status === 200, "Fix 5: TAP_TO_PAY_PUBLIC=1 opens " + route.name + " for a plain owner (status " + r.status + (r.error ? " " + r.error : "") + ")");
  }
}

console.log("");
console.log(fail === 0 ? "✅ ALL PASS" : "❌ " + fail + " FAILED");
process.exit(fail === 0 ? 0 : 1);
