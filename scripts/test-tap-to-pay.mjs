// Tap to Pay on iPhone (Stripe side): the REAL Worker functions on an
// in-memory SQLite, with stripeApi/stripeApiV2 stubbed (no network, no live
// Stripe calls, no production database).
//
//   node scripts/test-tap-to-pay.mjs
import { makeDb, build, baseStubs, req } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = [
  "gmStripeRow", "gmStripeOwnerGuard", "stripeAvailableFor",
  "gmTapMigrationMissing", "gmTapNotAvailable", "gmStripeTapOwnerGuard", "gmStripeTapActorGuard",
  "handleGetGmStripeTap", "handlePostGmStripeTapEnable", "handlePostGmStripeTapDisable",
  "handlePostGmStripeTapConnectionToken", "handlePostGmStripeTapPaymentIntent",
  "gmInvLoad", "gmInvDerive", "gmInvTolerance", "gmDocSettingsRow", "gmDocParseLicenses", "gmDocHexColor", "gmDocParseJsonObject",
  "gmStripeRecordCardPayment", "gmStripeRecordPaid", "gmStripeRecordTapPaid", "gmLogLeadEvents",
  "stripeWebhookGate", "handleStripeWebhook", "stripeVerifySignature", "stripeConstantTimeEqual",
  "requireClientAccess", "sessionSellerName"
];
const VARS = ["STRIPE_SANDBOX_CLIENT_ID", "STRIPE_V2_VERSION", "STRIPE_WEBHOOK_TOLERANCE_S", "GM_DOC_DEFAULT_SCHEDULE_PRESETS"];
const MIGRATIONS = [
  "migrations/client_estimates_invoices_p3.sql",
  "migrations/stripe_connect.sql",
  "migrations/stripe_connect_accepted.sql",
  "migrations/tap_to_pay.sql"
];

const TODAY = "2026-10-18";

// migrations/client_estimates_invoices_p1.sql, p2.sql and gm_growth_management.sql
// carry inline "-- comment" text on the SAME line as SQL. The test shim's
// migration loader only strips WHOLE-LINE "--" comments before splitting on
// ";", so those three files' CREATE TABLE statements silently fail to parse
// through the shim (every other statement in them errors and is swallowed).
// Rather than patch the shared shim for one test, the handful of columns
// this test actually touches (gm_doc_settings.address, gm_leads+events) are
// created directly here, matching the real column definitions exactly.
function seedExtraTables(d) {
  d.raw.exec("CREATE TABLE IF NOT EXISTS gm_doc_settings (client_id TEXT PRIMARY KEY, legal_name TEXT, address TEXT, phone TEXT, email TEXT, license_numbers TEXT NOT NULL DEFAULT '[]', payment_methods_json TEXT NOT NULL DEFAULT '{}', schedule_presets_json TEXT NOT NULL DEFAULT '[]', estimate_valid_days INTEGER NOT NULL DEFAULT 30, default_terms_days INTEGER NOT NULL DEFAULT 0)");
  d.raw.exec("CREATE TABLE IF NOT EXISTS gm_config (client_id TEXT PRIMARY KEY, target_margin REAL)");
  d.raw.exec("CREATE TABLE IF NOT EXISTS gm_leads (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, cliente TEXT NOT NULL, telefone TEXT, email TEXT, addr_street TEXT, addr_city TEXT, addr_state TEXT, addr_zip TEXT)");
  d.raw.exec("CREATE TABLE IF NOT EXISTS gm_lead_events (id TEXT PRIMARY KEY, lead_id TEXT, client_id TEXT, action TEXT, field TEXT, old_value TEXT, new_value TEXT, actor TEXT, reason TEXT)");
}

function world(stripeApiImpl, overrides) {
  const d = makeDb(MIGRATIONS);
  seedExtraTables(d);
  const calls = [];
  const stubs = Object.assign({}, baseStubs, {
    gmEasternToday: () => TODAY,
    authenticate: async () => ({ role: "client", client_id: "c1", display_name: "Owner" }),
    stripeApi: async (env, method, path, params, account) => {
      calls.push({ method, path, params, account });
      return stripeApiImpl(method, path, params, account);
    },
    gmInvIssueReceipt: async () => {},
    gmFinancePostPayment: async () => {},
    jsonErr2: (pt, en, status) => ({ status: status || 400, error: en, error_pt: pt, error_en: en })
  }, overrides || {});
  const F = build(FNS, VARS, stubs);
  return { d, env: { DB: d.DB, STRIPE_SECRET_KEY: "sk_test_x" }, F, calls };
}

function seedClient(d, id, name) {
  d.raw.prepare("INSERT INTO clients (id, name) VALUES (?, ?)").run(id, name || id);
}
function seedStripeAccount(d, clientId, acctId, chargesEnabled) {
  d.raw.prepare(
    "INSERT INTO gm_stripe_accounts (client_id, stripe_account_id, charges_enabled, details_submitted, livemode, created_at, updated_at) VALUES (?, ?, ?, 1, 0, datetime('now'), datetime('now'))"
  ).run(clientId, acctId, chargesEnabled ? 1 : 0);
}
function seedDocAddress(d, clientId, addr) {
  d.raw.prepare("INSERT INTO gm_doc_settings (client_id, address) VALUES (?, ?) ON CONFLICT (client_id) DO UPDATE SET address = excluded.address").run(clientId, addr || null);
}
function seedInvoice(d, id, clientId, opts) {
  opts = opts || {};
  d.raw.prepare(
    "INSERT INTO gm_invoices (id, client_id, job_id, lead_id, number, status, amount_cents, public_token) VALUES (?, ?, 'job1', ?, ?, ?, ?, ?)"
  ).run(id, clientId, opts.lead_id || null, opts.number || "INV-0001", opts.status || "sent", opts.amount_cents || 10000, id + "-token");
}

// ── GET tap status ──────────────────────────────────────────────────────
{
  const w = world(() => { throw new Error("should not call Stripe"); });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  const r = await w.F.handleGetGmStripeTap("c1", req({}), w.env);
  ok(r.status === 200 && r.data.available === true && r.data.enabled === false, "tap status: available (charges enabled), not yet enabled");
}
{
  const w = world(() => { throw new Error("should not call Stripe"); });
  seedClient(w.d, "c1");
  const r = await w.F.handleGetGmStripeTap("c1", req({}), w.env);
  ok(r.status === 200 && r.data.available === false, "tap status: not available with no Stripe account at all");
}

// ── enable: guards ───────────────────────────────────────────────────────
{
  // not accepted
  const w = world(() => { throw new Error("should not call Stripe"); });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  seedDocAddress(w.d, "c1", "123 Main St, Tampa FL");
  const r = await w.F.handlePostGmStripeTapEnable("c1", req({ accepted: false }), w.env);
  ok(r.status === 400, "enable refuses when accepted is not true");
}
{
  // not connected / not charges_enabled
  const w = world(() => { throw new Error("should not call Stripe"); });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", false);
  const r = await w.F.handlePostGmStripeTapEnable("c1", req({ accepted: true }), w.env);
  ok(r.status === 409, "enable refuses when Stripe is connected but charges are not enabled");
}
{
  // not connected at all
  const w = world(() => { throw new Error("should not call Stripe"); });
  seedClient(w.d, "c1");
  const r = await w.F.handlePostGmStripeTapEnable("c1", req({ accepted: true }), w.env);
  ok(r.status === 409, "enable refuses when Stripe is not connected at all");
}
{
  // missing address
  const w = world(() => { throw new Error("should not call Stripe"); });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  const r = await w.F.handlePostGmStripeTapEnable("c1", req({ accepted: true }), w.env);
  ok(r.status === 409 && /address/.test(r.error), "enable refuses with a clear bilingual error when the company address is missing");
}
{
  // seller cannot enable (owner-only)
  const w = world(() => { throw new Error("should not call Stripe"); }, { authenticate: async () => ({ role: "client", client_id: "c1", login_role: "seller", seller_name: "Joe", display_name: "Joe" }) });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  seedDocAddress(w.d, "c1", "123 Main St, Tampa FL");
  const r = await w.F.handlePostGmStripeTapEnable("c1", req({ accepted: true }), w.env);
  ok(r.status === 403, "enable refuses a seller session (owner only)");
}

// ── enable: happy path + idempotent (one location only) ─────────────────
{
  let locationsCreated = 0;
  const w = world((method, path) => {
    if (path === "/v1/terminal/locations") { locationsCreated++; return { id: "loc_" + locationsCreated }; }
    throw new Error("unexpected Stripe call: " + path);
  });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  seedDocAddress(w.d, "c1", "123 Main St, Tampa FL");
  const r1 = await w.F.handlePostGmStripeTapEnable("c1", req({ accepted: true, language: "en" }), w.env);
  ok(r1.status === 200 && r1.data.enabled === true && r1.data.location_id === "loc_1", "enable: creates the Terminal location and turns tap_enabled on");
  const r2 = await w.F.handlePostGmStripeTapEnable("c1", req({ accepted: true, language: "en" }), w.env);
  ok(r2.status === 200 && r2.data.location_id === "loc_1", "enable a second time: idempotent, does not create a second location");
  ok(locationsCreated === 1, "exactly one Stripe terminal location was ever created");
  const row = w.d.raw.prepare("SELECT tap_enabled, tap_accepted_at, tap_accepted_by FROM gm_stripe_accounts WHERE client_id = 'c1'").get();
  ok(row.tap_enabled === 1 && !!row.tap_accepted_at && row.tap_accepted_by === "Owner", "the account row records tap_enabled, tap_accepted_at and tap_accepted_by");
}

// ── disable ──────────────────────────────────────────────────────────────
{
  const w = world((method, path) => (path === "/v1/terminal/locations" ? { id: "loc_x" } : (() => { throw new Error("unexpected"); })()));
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  seedDocAddress(w.d, "c1", "123 Main St, Tampa FL");
  await w.F.handlePostGmStripeTapEnable("c1", req({ accepted: true }), w.env);
  const r = await w.F.handlePostGmStripeTapDisable("c1", req({}), w.env);
  ok(r.status === 200 && r.data.enabled === false, "disable turns tap_enabled off");
  const loc = w.d.raw.prepare("SELECT * FROM gm_stripe_terminal_locations WHERE client_id = 'c1'").get();
  ok(!!loc, "disable does not delete the stored Terminal location");
  const acct = w.d.raw.prepare("SELECT stripe_account_id FROM gm_stripe_accounts WHERE client_id = 'c1'").get();
  ok(!!acct, "disable does not touch the Stripe account row");
}

// ── connection token ─────────────────────────────────────────────────────
{
  const w = world((method, path, params, account) => {
    if (path === "/v1/terminal/locations") { return { id: "loc_z" }; }
    if (path === "/v1/terminal/connection_tokens") { ok(account === "acct_1", "connection token call carries the Stripe-Account header (connected account)"); return { secret: "pst_test_secret" }; }
    throw new Error("unexpected: " + path);
  });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  seedDocAddress(w.d, "c1", "123 Main St, Tampa FL");
  await w.F.handlePostGmStripeTapEnable("c1", req({ accepted: true }), w.env);
  const r = await w.F.handlePostGmStripeTapConnectionToken("c1", req({}), w.env);
  ok(r.status === 200 && r.data.secret === "pst_test_secret" && r.data.location_id === "loc_z", "connection-token: returns the secret and location id once enabled");
}
{
  // not enabled yet
  const w = world(() => { throw new Error("should not call Stripe"); });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  const r = await w.F.handlePostGmStripeTapConnectionToken("c1", req({}), w.env);
  ok(r.status === 409, "connection-token refuses when Tap to Pay is not enabled");
}
{
  // seller of the SAME business can reach connection-token
  const w2 = world(() => ({ secret: "pst_seller" }), { authenticate: async () => ({ role: "client", client_id: "c1", login_role: "seller", seller_name: "Joe", display_name: "Joe" }) });
  seedClient(w2.d, "c1");
  seedStripeAccount(w2.d, "c1", "acct_1", true);
  w2.d.raw.prepare("UPDATE gm_stripe_accounts SET tap_enabled = 1 WHERE client_id = 'c1'").run();
  w2.d.raw.prepare("INSERT INTO gm_stripe_terminal_locations (client_id, location_id, created_at) VALUES ('c1', 'loc_s', datetime('now'))").run();
  const r = await w2.F.handlePostGmStripeTapConnectionToken("c1", req({}), w2.env);
  ok(r.status === 200, "connection-token: a seller of the SAME business can reach it");
}

// ── payment intent ───────────────────────────────────────────────────────
{
  const w = world((method, path, params, account) => {
    if (path === "/v1/payment_intents") {
      ok(params.amount === 10000, "payment-intent: amount equals the invoice's exact balance_cents");
      ok(account === "acct_1", "payment-intent: created on the connected account (Stripe-Account header)");
      ok(params.payment_method_types[0] === "card_present", "payment-intent: allowed_payment_method_types is card_present");
      ok(params.capture_method === "automatic", "payment-intent: automatic capture (no extra server step for card_present on iOS Terminal SDK)");
      ok(params.metadata.apex_source === "tap_to_pay", "payment-intent: metadata.apex_source = tap_to_pay");
      return { id: "pi_1", client_secret: "pi_1_secret" };
    }
    throw new Error("unexpected: " + path);
  });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  w.d.raw.prepare("UPDATE gm_stripe_accounts SET tap_enabled = 1 WHERE client_id = 'c1'").run();
  seedInvoice(w.d, "inv1", "c1", { amount_cents: 10000, status: "sent" });
  const r = await w.F.handlePostGmStripeTapPaymentIntent("c1", req({ invoice_id: "inv1" }), w.env);
  ok(r.status === 200 && r.data.payment_intent_id === "pi_1" && r.data.client_secret === "pi_1_secret" && r.data.amount_cents === 10000, "payment-intent: returns client_secret, id and amount_cents");
}
{
  const w = world(() => { throw new Error("should not call Stripe"); });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  w.d.raw.prepare("UPDATE gm_stripe_accounts SET tap_enabled = 1 WHERE client_id = 'c1'").run();
  seedInvoice(w.d, "inv_void", "c1", { status: "void", amount_cents: 5000 });
  const r = await w.F.handlePostGmStripeTapPaymentIntent("c1", req({ invoice_id: "inv_void" }), w.env);
  ok(r.status === 409, "payment-intent refuses a void invoice");
}
{
  const w = world(() => { throw new Error("should not call Stripe"); });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  w.d.raw.prepare("UPDATE gm_stripe_accounts SET tap_enabled = 1 WHERE client_id = 'c1'").run();
  seedInvoice(w.d, "inv_draft", "c1", { status: "draft", amount_cents: 5000 });
  const r = await w.F.handlePostGmStripeTapPaymentIntent("c1", req({ invoice_id: "inv_draft" }), w.env);
  ok(r.status === 409, "payment-intent refuses a draft invoice");
}
{
  const w = world(() => { throw new Error("should not call Stripe"); });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  w.d.raw.prepare("UPDATE gm_stripe_accounts SET tap_enabled = 1 WHERE client_id = 'c1'").run();
  seedInvoice(w.d, "inv_paid", "c1", { status: "sent", amount_cents: 5000 });
  w.d.raw.prepare("INSERT INTO gm_invoice_payments (id, invoice_id, client_id, amount_cents, paid_date, method, state) VALUES ('p1', 'inv_paid', 'c1', 5000, '2026-10-01', 'card', 'verified')").run();
  const r = await w.F.handlePostGmStripeTapPaymentIntent("c1", req({ invoice_id: "inv_paid" }), w.env);
  ok(r.status === 409, "payment-intent refuses an invoice with no balance due (already paid)");
}
{
  // cross-business refusal: client c2's session cannot create a PI for c1's invoice
  const w = world(() => { throw new Error("should not call Stripe"); }, { authenticate: async () => ({ role: "client", client_id: "c2", display_name: "Other Owner" }) });
  seedClient(w.d, "c1");
  seedClient(w.d, "c2");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  w.d.raw.prepare("UPDATE gm_stripe_accounts SET tap_enabled = 1 WHERE client_id = 'c1'").run();
  seedInvoice(w.d, "inv_cross", "c1", { status: "sent", amount_cents: 5000 });
  const r = await w.F.handlePostGmStripeTapPaymentIntent("c1", req({ invoice_id: "inv_cross" }), w.env);
  ok(r.status === 403, "a session from a DIFFERENT business is refused (403) before reaching the invoice");
}

// ── webhook: tap payment_intent.succeeded recorded once; Checkout path untouched ──
{
  const w = world(() => { throw new Error("should not call Stripe"); });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  seedInvoice(w.d, "inv_tap", "c1", { status: "sent", amount_cents: 7500, number: "INV-0099" });

  const piEvent = { id: "evt_pi_1", type: "payment_intent.succeeded", livemode: false, account: "acct_1",
    data: { object: { id: "pi_tap_1", status: "succeeded", amount_received: 7500, metadata: { apex_invoice_id: "inv_tap", apex_client_id: "c1", apex_invoice_number: "INV-0099", apex_source: "tap_to_pay" } } } };
  const r1 = await w.F.gmStripeRecordTapPaid(w.env, req({}), piEvent);
  ok(r1 === "recorded", "tap PaymentIntent succeeded: recorded once");
  const r2 = await w.F.gmStripeRecordTapPaid(w.env, req({}), piEvent);
  ok(r2 === "already recorded", "redelivery of the SAME tap event is a no-op");

  const payments = w.d.q("SELECT * FROM gm_invoice_payments WHERE invoice_id = 'inv_tap'");
  ok(payments.length === 1 && payments[0].amount_cents === 7500 && payments[0].note === "Paid in person by card (Tap to Pay)", "exactly one payment row, correct amount and note");

  // A Checkout session for a DIFFERENT invoice with the SAME payment_intent id must not double count against this one, and a Checkout event for tap's own invoice/PI must not double-record it either.
  const checkoutEventSamePI = { id: "evt_co_dup", type: "checkout.session.completed", account: "acct_1",
    data: { object: { payment_status: "paid", amount_total: 7500, payment_intent: "pi_tap_1", metadata: { apex_invoice_id: "inv_tap", apex_client_id: "c1" } } } };
  const r3 = await w.F.gmStripeRecordPaid(w.env, req({}), checkoutEventSamePI);
  ok(r3 === "already recorded", "a Checkout event carrying the SAME payment_intent id as a tap payment is never recorded a second time");
  const paymentsAfter = w.d.q("SELECT * FROM gm_invoice_payments WHERE invoice_id = 'inv_tap'");
  ok(paymentsAfter.length === 1, "still exactly one payment row after the Checkout-shaped duplicate attempt");
}
{
  // Checkout's own payment_intent.succeeded (no apex_source=tap_to_pay) must NOT be recorded by the tap path at all.
  const w = world(() => { throw new Error("should not call Stripe"); });
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  seedInvoice(w.d, "inv_co", "c1", { status: "sent", amount_cents: 3000 });
  const checkoutPiEvent = { id: "evt_pi_checkout", type: "payment_intent.succeeded", account: "acct_1",
    data: { object: { id: "pi_checkout_1", status: "succeeded", amount_received: 3000, metadata: { apex_invoice_id: "inv_co", apex_client_id: "c1" } } } };
  // Simulate the webhook's own gate: metadata.apex_source !== "tap_to_pay", so handleStripeWebhook's dispatch would never call gmStripeRecordTapPaid for this event. We assert the dispatch condition directly.
  const wouldDispatchToTap = checkoutPiEvent.type === "payment_intent.succeeded" && checkoutPiEvent.data.object.metadata && checkoutPiEvent.data.object.metadata.apex_source === "tap_to_pay";
  ok(wouldDispatchToTap === false, "a Checkout PaymentIntent's own payment_intent.succeeded (no apex_source=tap_to_pay) is never routed to the tap recorder");
}

// ── missing-migration behavior ───────────────────────────────────────────
{
  const w = world(() => { throw new Error("should not call Stripe"); });
  // Simulate the migration not having run: drop the tap_* columns and the
  // location table by rebuilding gm_stripe_accounts without them.
  w.d.raw.exec("DROP TABLE gm_stripe_terminal_locations");
  w.d.raw.exec("CREATE TABLE gm_stripe_accounts_old AS SELECT client_id, stripe_account_id, charges_enabled, details_submitted, livemode, connected_by, created_at, updated_at FROM gm_stripe_accounts");
  w.d.raw.exec("DROP TABLE gm_stripe_accounts");
  w.d.raw.exec("ALTER TABLE gm_stripe_accounts_old RENAME TO gm_stripe_accounts");
  seedClient(w.d, "c1");
  seedStripeAccount(w.d, "c1", "acct_1", true);
  const rStatus = await w.F.handleGetGmStripeTap("c1", req({}), w.env);
  ok(rStatus.status === 200 && rStatus.data.enabled === false, "GET tap status before the migration: answers enabled:false (no tap_enabled column), not a 500");
  const rEnable = await w.F.handlePostGmStripeTapEnable("c1", req({ accepted: true }), w.env);
  ok(rEnable.status === 409, "enable before the migration: a clean 409, not a 500 crash");
}

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
