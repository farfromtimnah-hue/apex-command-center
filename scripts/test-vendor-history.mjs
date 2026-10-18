// Vendors (Fornecedores) "Historico" / "History" sheet: the REAL Worker
// function cut from worker/index.js, against an in-memory SQLite. No
// network, no production database.
//
//   node scripts/test-vendor-history.mjs
import { makeDb, build, baseStubs, req } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = ["handleGetVendorsHistory", "vendorAuth", "vendorAuthed", "vendorAddMonths", "vendorMonthOf", "vendorMonthCompare"];
const VARS = [];
const MIGRATIONS = ["migrations/vendors.sql", "migrations/2026-10-15_vendor_tracking_and_club_plus_one.sql", "migrations/2026-10-15_vendor_matching_round2.sql"];

const TODAY = "2026-10-18";

function world(authUser) {
  const d = makeDb(MIGRATIONS);
  const stubs = Object.assign({}, baseStubs, {
    gmEasternToday: () => TODAY,
    authenticate: async () => authUser
  });
  const F = build(FNS, VARS, stubs);
  return { d, env: { DB: d.DB }, F };
}

function seedClient(d, id, name) {
  d.raw.prepare("INSERT INTO clients (id, name) VALUES (?, ?)").run(id, name || id);
}
function seedVendor(d, id, name) {
  d.raw.prepare("INSERT INTO vendors (id, name, active) VALUES (?, ?, 1)").run(id, name);
}
function seedService(d, id, clientId, vendorId) {
  d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES (?, ?, ?, 'Servico', 'monthly', 10000, '2026-01', 'active', 'manual')").run(id, clientId, vendorId);
}
function seedPayable(d, id, serviceId, clientId, vendorId) {
  d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, planned_cents, trigger, status) VALUES (?, ?, ?, ?, 'Pagamento', 10000, 'month', 'paid')").run(id, serviceId, clientId, vendorId);
}
function seedBatch(d, id, vendorId, amountCents, paidOn, note, kind) {
  d.raw.prepare("INSERT INTO vendor_payment_batches (id, vendor_id, amount_cents, paid_on, note, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))").run(id, vendorId, amountCents, paidOn, note || null, kind || "bank");
}
function seedAllocation(d, id, batchId, payableId, cents) {
  d.raw.prepare("INSERT INTO vendor_payment_allocations (id, batch_id, payable_id, applied_cents) VALUES (?, ?, ?, ?)").run(id, batchId, payableId, cents);
}

const RAFA = { role: "rafa", display_name: "Rafa" };

// ── auth gate: same as forecast (alice, developer, rafa); a client or seller is refused ──
{
  const w = world({ role: "client", client_id: "c1", display_name: "Client" });
  const r = await w.F.handleGetVendorsHistory(req({}), w.env);
  ok(r.status === 403, "a client role is refused (403), same gate as forecast");
}
{
  const w = world({ role: "client", client_id: "c1", login_role: "seller", seller_name: "Joe", display_name: "Joe" });
  const r = await w.F.handleGetVendorsHistory(req({}), w.env);
  ok(r.status === 403, "a seller role is refused (403), never sees this page");
}
{
  const w = world(null);
  const r = await w.F.handleGetVendorsHistory(req({}), w.env);
  ok(r.status === 401, "no session: 401 Unauthorized");
}
for (const role of ["alice", "developer", "rafa"]) {
  const w = world({ role, display_name: "Test" });
  seedVendor(w.d, "v1", "Vendor One");
  const r = await w.F.handleGetVendorsHistory(req({}), w.env);
  ok(r.status === 200, role + ": reaches the history endpoint");
}

// ── grouping, totals, newest first ────────────────────────────────────────
{
  const w = world(RAFA);
  seedClient(w.d, "c1", "Client One");
  seedVendor(w.d, "v1", "Vendor One");
  seedService(w.d, "s1", "c1", "v1");
  seedPayable(w.d, "p1", "s1", "c1", "v1");
  seedBatch(w.d, "b1", "v1", 10000, "2026-10-05", "Outubro", "bank");
  seedAllocation(w.d, "a1", "b1", "p1", 10000);
  seedBatch(w.d, "b2", "v1", 5000, "2026-10-10", null, "sent");
  seedBatch(w.d, "b3", "v1", 20000, "2026-09-02", "Setembro", "bank");

  const r = await w.F.handleGetVendorsHistory(req({}), w.env);
  ok(r.status === 200, "history loads");
  const months = r.data.months;
  ok(months.length === 12, "defaults to the last 12 months");
  ok(months[0].month === "2026-10" && months[1].month === "2026-09", "newest month first");
  ok(months[0].total_cents === 15000, "October's total is the sum of its two payments (10000 + 5000)");
  ok(months[0].payments.length === 2 && months[0].payments[0].paid_on === "2026-10-10", "within a month, newest payment first");
  ok(months[0].payments.some((p) => p.vendor_name === "Vendor One"), "each payment carries the vendor name");
  ok(months[0].payments.find((p) => p.paid_on === "2026-10-05").client_name === "Client One", "a payment tied to a client service carries the client name");
  ok(months[0].payments.find((p) => p.paid_on === "2026-10-10").client_name === null, "a payment with no allocation (no client tie) carries no client name");
  ok(months[0].payments.find((p) => p.paid_on === "2026-10-10").kind === "sent", "kind is surfaced as stored (bank / sent)");
  ok(months[1].total_cents === 20000 && months[1].payments[0].note === "Setembro", "September's total and note are correct");
  ok(!("internal_note" in months[0].payments[0]), "no internal note field beyond what the vendor card already shows");
}

// ── "Ver mais / Show more" (offset) ───────────────────────────────────────
{
  const w = world(RAFA);
  seedVendor(w.d, "v1", "Vendor One");
  seedBatch(w.d, "old1", "v1", 1000, "2025-05-01", null, "bank");
  const r1 = await w.F.handleGetVendorsHistory(req({}, "https://x.test/?months=12&offset=0"), w.env);
  ok(r1.data.has_more === true, "has_more is true when a payment exists before the current 12-month window");
  const r2 = await w.F.handleGetVendorsHistory(req({}, "https://x.test/?months=12&offset=12"), w.env);
  const may2025 = r2.data.months.find((m) => m.month === "2025-05");
  ok(may2025 && may2025.total_cents === 1000, "offset=12 loads the next 12 months back and finds the older payment");
}
{
  const w = world(RAFA);
  const r = await w.F.handleGetVendorsHistory(req({}), w.env);
  ok(r.data.has_more === false, "has_more is false when there is no payment before the window (no 'Show more' spinning forever)");
}

// ── empty state ───────────────────────────────────────────────────────────
{
  const w = world(RAFA);
  const r = await w.F.handleGetVendorsHistory(req({}), w.env);
  ok(r.status === 200 && r.data.months.every((m) => m.payments.length === 0 && m.total_cents === 0), "no payments at all: 12 empty months, not an error");
}

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
