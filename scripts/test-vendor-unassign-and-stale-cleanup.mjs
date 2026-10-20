// Task 7.1(c): vendorCleanStaleAutoMatches undoes an UNCONFIRMED automatic
// match whose service's starts_on was edited after the match was made,
// breaking the date rule retroactively -- and never touches a CONFIRMED one.
// Task 7.1(d): the Change dialog's new plain "Unassign" action (POST
// .../undo with no vendor_ignored_transactions write) vs. "Not a vendor"
// (undo + ignore). Real Worker functions, in-memory D1.
//
//   node scripts/test-vendor-unassign-and-stale-cleanup.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = [
  "vendorBuildPayables", "vendorAddMonths", "vendorMonthOf", "vendorMonthCompare", "vendorRemaining",
  "vendorPayableIsDue", "vendorPayableIsLate", "vendorPayableIsUpcoming", "vendorPayableDatePasses",
  "vendorApplyToPayables", "vendorAutoApplyToPayables", "vendorDuePayablesForVendor", "vendorDuePayablesForVendorOnDate", "vendorApplyPayment",
  "vendorApplyPaymentOnDate", "vendorApplyManualAllocations", "vendorApplyCredit", "vendorOwedNow", "vendorUpcoming",
  "vendorIsRmtlyText", "vendorUnmatchedRemitlyRaw", "vendorCandidatesFor", "vendorAutoMatch", "vendorCleanStaleAutoMatches",
  "vendorLinkSentBatches", "vendorClawBackShortfall", "vendorMarkReviewed", "vendorFinishServicesIfDone",
  "handlePostVendorBatchAction", "handleGetVendorsRemitlyUnmatched", "handleGetVendorsAutoBatches",
  "apxParse", "vendorAuth", "vendorAuthed"
];
const VARS = ["VENDOR_PACKAGE_PRESETS"];

const MIGRATIONS = ["migrations/vendors.sql", "migrations/2026-10-15_vendor_tracking_and_club_plus_one.sql", "migrations/2026-10-15_vendor_matching_round2.sql", "migrations/2026-10-19_vendor_name_en.sql"];

let TODAY = "2026-10-20";

function world() {
  const d = makeDb(MIGRATIONS);
  const stubs = Object.assign({}, baseStubs, {
    gmEasternToday: () => TODAY,
    authenticate: async () => ({ role: "alice", display_name: "Alice" }),
    jsonErr2: (pt, en, status) => ({ status: status || 400, error: en, error_pt: pt, error_en: en })
  });
  const F = build(FNS, VARS, stubs);
  return { d, env: { DB: d.DB }, F };
}
function seedClient(d, id, name) { d.raw.prepare("INSERT INTO clients (id, name) VALUES (?, ?)").run(id, name || id); }
function seedVendor(d, id, name) { d.raw.prepare("INSERT INTO vendors (id, name, active) VALUES (?, ?, 1)").run(id, name); }

function req(body) {
  return { url: "https://x.test/", headers: { get: () => null }, json: async () => (body || {}) };
}

// ── 1. A stale unconfirmed match is undone when starts_on moves past it ────
{
  const w = world();
  seedClient(w.d, "c1"); seedVendor(w.d, "vnd1", "V1");
  // No starts_on yet -- matches normally against a transaction dated today.
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source, starts_on) VALUES ('s1', 'c1', 'vnd1', 'A', 'once', 10000, '2026-10', 'active', 'manual', NULL)").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p1', 's1', 'c1', 'vnd1', 'A', '2026-10', 10000, 'month', 'scheduled')").run();
  w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('t1', 'a1', -10000, '2026-10-15', 'PMNT SENT RMTLY* X')").run();
  await w.F.vendorAutoMatch(w.env);
  ok(w.d.q("SELECT COUNT(*) AS n FROM vendor_payment_batches")[0].n === 1, "matched while starts_on was still NULL");
  ok(w.d.q("SELECT status FROM vendor_payables WHERE id = 'p1'")[0].status === "paid", "payable marked paid by the auto match");

  // Now Alice corrects the contract start date to AFTER the transaction,
  // while the match is still sitting unconfirmed in the tray.
  w.d.raw.prepare("UPDATE vendor_services SET starts_on = '2026-10-18' WHERE id = 's1'").run();
  await w.F.vendorAutoMatch(w.env);
  ok(w.d.q("SELECT COUNT(*) AS n FROM vendor_payment_batches")[0].n === 0, "the stale unconfirmed match is undone once starts_on moves past its transaction date");
  ok(w.d.q("SELECT status, applied_cents FROM vendor_payables WHERE id = 'p1'")[0].status === "scheduled", "the payable is released back to scheduled");
  ok(w.d.q("SELECT COUNT(*) AS n FROM vendor_match_reviews")[0].n === 0, "no vendor_match_reviews row -- this was not a human decision, so re-matching stays open");

  // And since the transaction is free again and now passes the NEW date
  // rule (2026-10-15 is still before 2026-10-18 -- it should NOT re-match).
  ok(w.d.q("SELECT COUNT(*) AS n FROM vendor_payment_batches")[0].n === 0, "the same transaction does not immediately re-match, since it is still before the corrected starts_on");
}

// ── 2. A CONFIRMED match is never touched, even if it would now fail ───────
{
  const w = world();
  seedClient(w.d, "c1"); seedVendor(w.d, "vnd1", "V1");
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source, starts_on) VALUES ('s1', 'c1', 'vnd1', 'A', 'once', 10000, '2026-10', 'active', 'manual', NULL)").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p1', 's1', 'c1', 'vnd1', 'A', '2026-10', 10000, 'month', 'scheduled')").run();
  w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('t1', 'a1', -10000, '2026-10-15', 'PMNT SENT RMTLY* X')").run();
  await w.F.vendorAutoMatch(w.env);
  const batchId = w.d.q("SELECT id FROM vendor_payment_batches")[0].id;
  // Confirm it (a person's decision) BEFORE the date changes.
  const confirmResult = await w.F.handlePostVendorBatchAction(batchId, "confirm", req({}), w.env);
  ok(confirmResult.status === 200, "batch confirmed");

  w.d.raw.prepare("UPDATE vendor_services SET starts_on = '2026-10-18' WHERE id = 's1'").run();
  await w.F.vendorAutoMatch(w.env);
  ok(w.d.q("SELECT COUNT(*) AS n FROM vendor_payment_batches")[0].n === 1, "the CONFIRMED batch still exists -- the cleanup never touches a confirmed match");
  ok(w.d.q("SELECT status FROM vendor_payables WHERE id = 'p1'")[0].status === "paid", "its payable is still paid");
}

// ── 3. Unassign (plain undo) leaves the transaction re-assignable ──────────
{
  const w = world();
  seedClient(w.d, "c1"); seedVendor(w.d, "vnd1", "V1"); seedVendor(w.d, "vnd2", "V2");
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s1', 'c1', 'vnd1', 'A', 'once', 10000, '2026-10', 'active', 'manual')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p1', 's1', 'c1', 'vnd1', 'A', '2026-10', 10000, 'month', 'scheduled')").run();
  w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('t1', 'a1', -10000, '2026-10-15', 'PMNT SENT RMTLY* X')").run();
  await w.F.vendorAutoMatch(w.env);
  const batchId = w.d.q("SELECT id FROM vendor_payment_batches")[0].id;

  // Plain "Unassign" -- the Change dialog's new button -- is implemented as
  // the same /undo action the dialog already had, with NO follow-up
  // /remitly/ignore call (that's what vendors.js's unassignAutoMatch does).
  const undo = await w.F.handlePostVendorBatchAction(batchId, "undo", req({}), w.env);
  ok(undo.status === 200, "undo (the Unassign button's action) succeeds");
  ok(w.d.q("SELECT COUNT(*) AS n FROM vendor_ignored_transactions")[0].n === 0, "plain Unassign writes NO vendor_ignored_transactions row -- unlike 'Not a vendor'");

  const unmatched = await w.F.handleGetVendorsRemitlyUnmatched(req({}), w.env);
  ok(unmatched.status === 200 && unmatched.data.transactions.some(t => t.id === "t1"), "the unassigned transaction reappears in the Unassigned list for a manual quickAssign");
}

// ── 4. "Not a vendor" (undo + ignore) makes the transaction vanish ─────────
{
  const w = world();
  seedClient(w.d, "c1"); seedVendor(w.d, "vnd1", "V1");
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s1', 'c1', 'vnd1', 'A', 'once', 10000, '2026-10', 'active', 'manual')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p1', 's1', 'c1', 'vnd1', 'A', '2026-10', 10000, 'month', 'scheduled')").run();
  w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('t1', 'a1', -10000, '2026-10-15', 'PMNT SENT RMTLY* X')").run();
  await w.F.vendorAutoMatch(w.env);
  const batchId = w.d.q("SELECT id FROM vendor_payment_batches")[0].id;

  await w.F.handlePostVendorBatchAction(batchId, "undo", req({}), w.env);
  w.d.raw.prepare("INSERT INTO vendor_ignored_transactions (transaction_id, reason) VALUES ('t1', NULL)").run();

  const unmatched = await w.F.handleGetVendorsRemitlyUnmatched(req({}), w.env);
  ok(!unmatched.data.transactions.some(t => t.id === "t1"), "an ignored ('not a vendor') transaction never reappears in the Unassigned list");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
