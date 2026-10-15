// Fornecedores (vendor payable tracking): the REAL Worker functions on an
// in-memory SQLite. No network, no production database.
//
//   node scripts/test-vendor-tracking.mjs
import { makeDb, build, baseStubs, req } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = [
  "vendorBuildPayables", "vendorAddMonths", "vendorMonthOf", "vendorRemaining",
  "vendorPayableIsDue", "vendorPayableIsLate", "vendorPayableIsUpcoming",
  "vendorApplyToPayables", "vendorDuePayablesForVendor", "vendorApplyPayment",
  "vendorApplyManualAllocations", "vendorApplyCredit", "vendorOwedNow", "vendorUpcoming",
  "vendorIsRmtlyText", "vendorUnmatchedRemitlyRaw", "vendorCandidatesFor", "vendorAutoMatch",
  "vendorCreateFromContract", "vendorFinishServicesIfDone",
  "handleGetVendorsOverview", "handleGetVendorsForecast", "handleGetVendorDetail", "handleGetVendorByClient",
  "handlePostVendorService", "handlePostVendorServiceCancel", "handlePostVendorServiceComplete",
  "handlePostVendorPayableAction", "handlePostVendorPayment", "handlePostVendorPaymentQuick",
  "handlePostVendorBatchAction", "handleGetVendorsRemitlyUnmatched", "handlePostVendorsRemitlyIgnore",
  "apxParse", "vendorAuth", "vendorAuthed"
];
const VARS = ["VENDOR_PACKAGE_PRESETS"];

function world(stubOverrides) {
  const d = makeDb(["migrations/vendors.sql", "migrations/2026-10-15_vendor_tracking_and_club_plus_one.sql"]);
  const stubs = Object.assign({}, baseStubs, {
    gmEasternToday: () => TODAY,
    authenticate: async () => ({ role: "alice", display_name: "Alice" }),
    jsonErr2: function (pt, en, status) { return { status: status || 400, error: en, error_pt: pt, error_en: en }; }
  }, stubOverrides || {});
  const F = build(FNS, VARS, stubs);
  return { d, env: { DB: d.DB }, F };
}

let TODAY = "2026-10-14";

function seedClient(d, id, name) {
  d.raw.prepare("INSERT INTO clients (id, name) VALUES (?, ?)").run(id, name || id);
}
function seedVendor(d, id, name, type) {
  d.raw.prepare("INSERT INTO vendors (id, name, vendor_type, active) VALUES (?, ?, ?, 1)").run(id, name, type || null);
}

// ── B. Schedule builder ──────────────────────────────────────────────────
{
  const w = world();
  let p = w.F.vendorBuildPayables({ kind: "monthly", price_cents: 22000, first_month: "2026-10", months: 3 });
  ok(p.length === 3 && p[0].period_month === "2026-10" && p[1].period_month === "2026-11" && p[2].period_month === "2026-12" && p.every(x => x.planned_cents === 22000), "monthly: one payable per month at the price");

  p = w.F.vendorBuildPayables({ kind: "once", price_cents: 10000, first_month: "2026-10", label: "Teste" });
  ok(p.length === 1 && p[0].period_month === "2026-10" && p[0].planned_cents === 10000, "once: one payable in the start month");

  p = w.F.vendorBuildPayables({ kind: "split", price_cents: 30000, first_month: "2026-10" });
  ok(p.length === 2 && p[0].planned_cents === 15000 && p[0].period_month === "2026-10" && p[0].status === "scheduled" &&
     p[1].planned_cents === 15000 && p[1].period_month === null && p[1].status === "waiting_completion", "split 30000: 15000 and 15000, first due now, second waiting");

  p = w.F.vendorBuildPayables({ kind: "split", price_cents: 30001, first_month: "2026-10" });
  ok(p[0].planned_cents === 15000 && p[1].planned_cents === 15001, "split 30001: 15000 and 15001 (floor then remainder)");
}

// ── C. Package presets via vendorCreateFromContract ──────────────────────
{
  const w = world();
  seedClient(w.d, "c1");
  seedVendor(w.d, "vnd-rais", "Rais", "Marketing");
  seedVendor(w.d, "vnd-addon-site", "Henrique", "Site");

  await w.F.vendorCreateFromContract(w.env, { id: "k1", client_id: "c1", signed_at: "2026-10-14 10:00:00", data_json: JSON.stringify({ package_key: "advanced" }) });
  let rais = w.d.q("SELECT * FROM vendor_payables WHERE vendor_id = 'vnd-rais' ORDER BY period_month");
  ok(rais.length === 6 && rais[0].period_month === "2026-10" && rais[5].period_month === "2027-03" && rais.every(r => r.planned_cents === 22000), "ADVANCED from 2026-10: Rais months 2026-10..2027-03 at 22000");
  let site = w.d.q("SELECT * FROM vendor_payables WHERE vendor_id = 'vnd-addon-site' ORDER BY created_at");
  ok(site.length === 2 && site[0].planned_cents === 15000 && site[1].planned_cents === 15000, "ADVANCED: site halves 15000 and 15000");

  const w2 = world();
  seedClient(w2.d, "c2");
  seedVendor(w2.d, "vnd-rais", "Rais", "Marketing");
  seedVendor(w2.d, "vnd-addon-site", "Henrique", "Site");
  await w2.F.vendorCreateFromContract(w2.env, { id: "k2", client_id: "c2", signed_at: "2026-10-14 10:00:00", data_json: JSON.stringify({ package_key: "growth" }) });
  let traffic = w2.d.q("SELECT DISTINCT period_month FROM vendor_payables p JOIN vendor_services s ON s.id = p.service_id WHERE s.service_key = 'pkg-traffic' ORDER BY period_month");
  let social = w2.d.q("SELECT DISTINCT period_month FROM vendor_payables p JOIN vendor_services s ON s.id = p.service_id WHERE s.service_key = 'pkg-social' ORDER BY period_month");
  ok(JSON.stringify(traffic.map(r => r.period_month)) === JSON.stringify(["2026-11", "2026-12", "2027-01"]), "GROWTH from 2026-10: traffic months 2026-11, 2026-12, 2027-01");
  ok(JSON.stringify(social.map(r => r.period_month)) === JSON.stringify(["2026-11", "2026-12", "2027-01"]), "GROWTH: social months 2026-11, 2026-12, 2027-01");
  let site2 = w2.d.q("SELECT * FROM vendor_payables p JOIN vendor_services s ON s.id = p.service_id WHERE s.service_key = 'pkg-site'");
  ok(site2.length === 2, "GROWTH: site halves also created");

  const w3 = world();
  seedClient(w3.d, "c3");
  const n = await w3.F.vendorCreateFromContract(w3.env, { id: "k3", client_id: "c3", signed_at: "2026-10-14 10:00:00", data_json: JSON.stringify({ package_key: "start" }) });
  ok(n === 0 && w3.d.q("SELECT COUNT(*) AS n FROM vendor_services")[0].n === 0, "START gives nothing");
}

// ── Due logic across a month boundary, Eastern time ──────────────────────
{
  const w = world();
  seedClient(w.d, "c1");
  seedVendor(w.d, "vnd1", "V1");
  TODAY = "2026-10-14";
  const svc = { kind: "monthly", price_cents: 10000, first_month: "2026-09", months: 3 };
  const payables = w.F.vendorBuildPayables(svc);
  ok(w.F.vendorPayableIsDue(payables[0], TODAY) === true && w.F.vendorPayableIsLate(payables[0], TODAY) === true, "a Sept payable viewed in Oct is due AND late");
  ok(w.F.vendorPayableIsDue(payables[1], TODAY) === true && w.F.vendorPayableIsLate(payables[1], TODAY) === false, "the Oct payable is due, not late");
  ok(w.F.vendorPayableIsDue(payables[2], TODAY) === false && w.F.vendorPayableIsUpcoming(payables[2], TODAY) === true, "the Nov payable is upcoming, not due");
}

// ── THE MAIN CASE ─────────────────────────────────────────────────────────
{
  const w = world();
  seedClient(w.d, "c1", "Golden Home");
  seedClient(w.d, "c2", "JN Freitas");
  seedVendor(w.d, "vnd1", "Rais");
  const svcId1 = "s1", svcId2 = "s2";
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES (?, 'c1', 'vnd1', 'Svc1', 'once', 25000, '2026-10', 'active', 'manual')").run(svcId1);
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES (?, 'c2', 'vnd1', 'Svc2', 'once', 25000, '2026-10', 'active', 'manual')").run(svcId2);
  const pid1 = "p1", pid2 = "p2";
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status, created_at) VALUES (?, ?, 'c1', 'vnd1', 'Svc1', '2026-10', 25000, 'month', 'scheduled', '2026-01-01')").run(pid1, svcId1);
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status, created_at) VALUES (?, ?, 'c2', 'vnd1', 'Svc2', '2026-10', 25000, 'month', 'scheduled', '2026-01-02')").run(pid2, svcId2);

  let owed = await w.F.vendorOwedNow(w.env, "vnd1", TODAY);
  ok(owed === 50000, "owed is 500.00 before any payment");

  const r = await w.F.handlePostVendorPayment(req({ vendor_id: "vnd1", amount_cents: 25000, paid_on: "2026-10-14" }), w.env);
  ok(r.status === 200, "payment recorded");
  owed = await w.F.vendorOwedNow(w.env, "vnd1", TODAY);
  ok(owed === 25000, "owed drops to 250.00 AT ONCE");
  let row1 = w.d.q("SELECT status FROM vendor_payables WHERE id = ?", pid1)[0];
  let row2 = w.d.q("SELECT status FROM vendor_payables WHERE id = ?", pid2)[0];
  ok(row1.status === "paid" && row2.status === "scheduled", "the OLDEST payable (c1, created first) is settled; the other untouched");

  const batchId = r.data.id;
  const reRoute = await w.F.handlePostVendorBatchAction(batchId, "reallocate", req({ allocations: [{ payable_id: pid2, applied_cents: 25000 }] }), w.env);
  ok(reRoute.status === 200, "reallocate accepted");
  row1 = w.d.q("SELECT status FROM vendor_payables WHERE id = ?", pid1)[0];
  row2 = w.d.q("SELECT status FROM vendor_payables WHERE id = ?", pid2)[0];
  owed = await w.F.vendorOwedNow(w.env, "vnd1", TODAY);
  ok(row1.status === "scheduled" && row2.status === "paid" && owed === 25000, "reallocating changes which payable is settled, owed stays 250.00");

  const undoRoute = await w.F.handlePostVendorBatchAction(batchId, "undo", req({}), w.env);
  ok(undoRoute.status === 200, "undo accepted");
  owed = await w.F.vendorOwedNow(w.env, "vnd1", TODAY);
  ok(owed === 50000, "undo restores 500.00");
}

// ── Partial ───────────────────────────────────────────────────────────────
{
  const w = world();
  seedClient(w.d, "c1"); seedClient(w.d, "c2"); seedVendor(w.d, "vnd1", "V");
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s1', 'c1', 'vnd1', 'A', 'once', 25000, '2026-10', 'active', 'manual')").run();
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s2', 'c2', 'vnd1', 'B', 'once', 25000, '2026-10', 'active', 'manual')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status, created_at) VALUES ('p1', 's1', 'c1', 'vnd1', 'A', '2026-10', 25000, 'month', 'scheduled', '2026-01-01')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status, created_at) VALUES ('p2', 's2', 'c2', 'vnd1', 'B', '2026-10', 25000, 'month', 'scheduled', '2026-01-02')").run();
  await w.F.handlePostVendorPayment(req({ vendor_id: "vnd1", amount_cents: 10000, paid_on: "2026-10-14" }), w.env);
  const owed = await w.F.vendorOwedNow(w.env, "vnd1", TODAY);
  ok(owed === 40000, "a $100 payment against two $250 payables leaves $400 owed");
  const p1 = w.d.q("SELECT * FROM vendor_payables WHERE id = 'p1'")[0];
  ok(p1.planned_cents - p1.applied_cents === 15000 && p1.status === "scheduled", "the oldest payable shows $150 remaining, still scheduled");
}

// ── Tolerance ─────────────────────────────────────────────────────────────
{
  const mk = () => {
    const w = world();
    seedClient(w.d, "c1"); seedVendor(w.d, "vnd1", "V");
    w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s1', 'c1', 'vnd1', 'A', 'once', 15000, '2026-10', 'active', 'manual')").run();
    w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status, created_at) VALUES ('p1', 's1', 'c1', 'vnd1', 'A', '2026-10', 15000, 'month', 'scheduled', '2026-01-01')").run();
    return w;
  };
  let w = mk();
  await w.F.handlePostVendorPayment(req({ vendor_id: "vnd1", amount_cents: 15571, paid_on: "2026-10-14" }), w.env);
  let p1 = w.d.q("SELECT * FROM vendor_payables WHERE id = 'p1'")[0];
  let credit = w.d.q("SELECT COALESCE(SUM(unallocated_cents),0) AS c FROM vendor_payment_batches")[0].c;
  ok(p1.status === "paid" && credit === 0, "$155.71 against $150: settled fully, no credit");

  w = mk();
  await w.F.handlePostVendorPayment(req({ vendor_id: "vnd1", amount_cents: 13800, paid_on: "2026-10-14" }), w.env);
  p1 = w.d.q("SELECT * FROM vendor_payables WHERE id = 'p1'")[0];
  ok(p1.status === "paid", "$138 (92%) settles fully");

  w = mk();
  await w.F.handlePostVendorPayment(req({ vendor_id: "vnd1", amount_cents: 13000, paid_on: "2026-10-14" }), w.env);
  p1 = w.d.q("SELECT * FROM vendor_payables WHERE id = 'p1'")[0];
  ok(p1.status === "scheduled" && p1.applied_cents === 13000, "$130 is partial");
}

// ── Credit ────────────────────────────────────────────────────────────────
{
  const w = world();
  seedClient(w.d, "c1"); seedVendor(w.d, "vnd1", "V");
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s1', 'c1', 'vnd1', 'A', 'once', 25000, '2026-10', 'active', 'manual')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status, created_at) VALUES ('p1', 's1', 'c1', 'vnd1', 'A', '2026-10', 25000, 'month', 'scheduled', '2026-01-01')").run();
  await w.F.handlePostVendorPayment(req({ vendor_id: "vnd1", amount_cents: 30000, paid_on: "2026-10-14" }), w.env);
  let owed = await w.F.vendorOwedNow(w.env, "vnd1", TODAY);
  let credit = w.d.q("SELECT COALESCE(SUM(unallocated_cents),0) AS c FROM vendor_payment_batches")[0].c;
  ok(owed === 0 && credit === 5000, "$300 against $250 owed: $0 owed, $50 credit");

  // Next payable becomes due; credit applies automatically.
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status, created_at) VALUES ('p2', 's1', 'c1', 'vnd1', 'B', '2026-10', 5000, 'month', 'scheduled', '2026-02-01')").run();
  await w.F.vendorApplyCredit(w.env, "vnd1");
  const p2 = w.d.q("SELECT * FROM vendor_payables WHERE id = 'p2'")[0];
  credit = w.d.q("SELECT COALESCE(SUM(unallocated_cents),0) AS c FROM vendor_payment_batches")[0].c;
  ok(p2.status === "paid" && credit === 0, "the $50 credit is applied automatically to the new payable");
}

// ── Skip / resume ─────────────────────────────────────────────────────────
{
  const w = world();
  seedClient(w.d, "c1"); seedVendor(w.d, "vnd1", "V");
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, months, status, source) VALUES ('s1', 'c1', 'vnd1', 'A', 'monthly', 22000, '2026-10', 3, 'active', 'manual')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p1', 's1', 'c1', 'vnd1', 'Mês 1', '2026-10', 22000, 'month', 'scheduled')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p2', 's1', 'c1', 'vnd1', 'Mês 2', '2026-11', 22000, 'month', 'scheduled')").run();

  let r = await w.F.handlePostVendorPayableAction("p1", "pause", req({ reason: "cliente com problema" }), w.env);
  ok(r.status === 200, "skip with a reason is accepted");
  let p1 = w.d.q("SELECT * FROM vendor_payables WHERE id = 'p1'")[0];
  let p2 = w.d.q("SELECT * FROM vendor_payables WHERE id = 'p2'")[0];
  ok(p1.status === "paused" && p1.paused_kind === "skip" && p2.status === "scheduled" && p2.period_month === "2026-11", "only the skipped month is affected; nothing moved or added");

  r = await w.F.handlePostVendorPayableAction("p1", "resume", req({}), w.env);
  ok(r.status === 200 && w.d.q("SELECT * FROM vendor_payables WHERE id = 'p1'")[0].status === "scheduled", "resume restores it");

  r = await w.F.handlePostVendorPayableAction("p1", "pause", req({ reason: "" }), w.env);
  ok(r.status === 400, "skip without a reason is refused");

  await w.F.handlePostVendorPayment(req({ vendor_id: "vnd1", amount_cents: 10000, paid_on: "2026-10-14" }), w.env);
  r = await w.F.handlePostVendorPayableAction("p1", "pause", req({ reason: "problema" }), w.env);
  ok(r.status === 409, "skip is refused on a payable with money applied");
}

// ── Delay / start ─────────────────────────────────────────────────────────
{
  const w = world();
  seedClient(w.d, "c1"); seedVendor(w.d, "vnd1", "V");
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s1', 'c1', 'vnd1', 'Site', 'split', 30000, '2026-10', 'active', 'manual')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p1', 's1', 'c1', 'vnd1', '1ª metade', '2026-10', 15000, 'start', 'scheduled')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p2', 's1', 'c1', 'vnd1', '2ª metade', NULL, 15000, 'completion', 'waiting_completion')").run();

  let owed = await w.F.vendorOwedNow(w.env, "vnd1", TODAY);
  let r = await w.F.handlePostVendorPayableAction("p1", "delay", req({ note: "cliente não pronto" }), w.env);
  ok(r.status === 200, "delay accepted on a start payable with nothing applied");
  let p1 = w.d.q("SELECT * FROM vendor_payables WHERE id = 'p1'")[0];
  ok(p1.status === "paused" && p1.paused_kind === "delay", "it is paused as delayed");
  let owedAfter = await w.F.vendorOwedNow(w.env, "vnd1", TODAY);
  ok(owedAfter === owed - 15000, "delay removes it from owed");
  ok(w.F.vendorPayableIsUpcoming(p1, TODAY) === true, "it shows as upcoming with the delayed pill");

  r = await w.F.handlePostVendorPayableAction("p1", "start", req({}), w.env);
  ok(r.status === 200, "start accepted");
  p1 = w.d.q("SELECT * FROM vendor_payables WHERE id = 'p1'")[0];
  ok(p1.status === "scheduled" && p1.period_month === TODAY.slice(0, 7), "start makes it due in the current month");

  // Not a 'start' payable -> refused
  r = await w.F.handlePostVendorPayableAction("p2", "delay", req({}), w.env);
  ok(r.status === 409, "delay refused on a non-start payable");

  r = await w.F.handlePostVendorServiceComplete("s1", req({}), w.env);
  ok(r.status === 200, "complete turns the 2nd half due this month");
  const p2 = w.d.q("SELECT * FROM vendor_payables WHERE id = 'p2'")[0];
  ok(p2.status === "scheduled" && p2.period_month === TODAY.slice(0, 7), "2nd half is now scheduled this month");

  r = await w.F.handlePostVendorServiceComplete("s1", req({}), w.env);
  ok(r.status === 409, "complete refused on a service that is not waiting (already completed)");

  const w2 = world();
  seedClient(w2.d, "c1"); seedVendor(w2.d, "vnd1", "V");
  w2.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s1', 'c1', 'vnd1', 'Social', 'monthly', 10000, '2026-10', 'active', 'manual')").run();
  r = await w2.F.handlePostVendorServiceComplete("s1", req({}), w2.env);
  ok(r.status === 409, "complete refused on a service that is not split");
}

// ── Payment with allocations for another vendor is refused, writes nothing
{
  const w = world();
  seedClient(w.d, "c1"); seedVendor(w.d, "vnd1", "V1"); seedVendor(w.d, "vnd2", "V2");
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s1', 'c1', 'vnd2', 'Other', 'once', 10000, '2026-10', 'active', 'manual')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p1', 's1', 'c1', 'vnd2', 'Other', '2026-10', 10000, 'month', 'scheduled')").run();
  const r = await w.F.handlePostVendorPayment(req({ vendor_id: "vnd1", amount_cents: 10000, paid_on: "2026-10-14", allocations: [{ payable_id: "p1", applied_cents: 10000 }] }), w.env);
  ok(r.status === 400, "payment with allocations for another vendor's payable is refused");
  ok(w.d.q("SELECT COUNT(*) AS n FROM vendor_payment_batches")[0].n === 0 && w.d.q("SELECT COUNT(*) AS n FROM vendor_payment_allocations")[0].n === 0, "nothing was written");

  // service becomes finished only when all payables paid or cancelled
  const r2 = await w.F.handlePostVendorPayment(req({ vendor_id: "vnd2", amount_cents: 10000, paid_on: "2026-10-14" }), w.env);
  ok(r2.status === 200 && w.d.q("SELECT status FROM vendor_services WHERE id = 's1'")[0].status === "finished", "the service becomes finished only when all its payables are paid");
}

// ── Remitly refund pairing, used/ignored exclusion ───────────────────────
{
  const w = world();
  seedVendor(w.d, "vnd1", "V");
  w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('t1', 'a1', -25000, '2026-10-01', 'PMNT SENT 1012 RMTLY* RXXXXX7597 SEATTLE WA')").run();
  w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('t2', 'a1', 25000, '2026-10-05', 'CHECKCARD 0929 RMTLY* H47FF')").run();
  let rows = await w.F.vendorUnmatchedRemitlyRaw(w.env, 60);
  ok(rows.length === 0, "a refund pairs with the earlier debit of the same amount; both disappear");

  w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('t3', 'a1', -10000, '2026-10-02', 'PMNT SENT 1012 RMTLY* ABC')").run();
  rows = await w.F.vendorUnmatchedRemitlyRaw(w.env, 60);
  ok(rows.length === 1 && rows[0].id === "t3", "an unpaired debit remains");

  await w.F.handlePostVendorPaymentQuick(req({ transaction_id: "t3", vendor_id: "vnd1" }), w.env);
  rows = await w.F.vendorUnmatchedRemitlyRaw(w.env, 60);
  ok(rows.length === 0, "an already-used transaction cannot be used twice (excluded)");
  const again = await w.F.handlePostVendorPayment(req({ vendor_id: "vnd1", transaction_id: "t3", paid_on: "2026-10-02" }), w.env);
  ok(again.status !== 200, "using the same transaction again is refused");

  w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('t4', 'a1', -5000, '2026-10-02', 'PMNT SENT RMTLY* X')").run();
  await w.F.handlePostVendorsRemitlyIgnore(req({ transaction_id: "t4", reason: "personal" }), w.env);
  rows = await w.F.vendorUnmatchedRemitlyRaw(w.env, 60);
  ok(!rows.some(r => r.id === "t4"), "an ignored transaction disappears");
}

// ── Automatic match ───────────────────────────────────────────────────────
{
  const w = world();
  seedClient(w.d, "c1"); seedVendor(w.d, "vnd1", "V1"); seedVendor(w.d, "vnd2", "V2");
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s1', 'c1', 'vnd1', 'A', 'once', 25000, '2026-10', 'active', 'manual')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p1', 's1', 'c1', 'vnd1', 'A', '2026-10', 25000, 'month', 'scheduled')").run();
  w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('tm1', 'a1', -25000, ?, 'PMNT SENT RMTLY* V1')").run(TODAY);
  await w.F.vendorAutoMatch(w.env);
  let owed = await w.F.vendorOwedNow(w.env, "vnd1", TODAY);
  let batch = w.d.q("SELECT * FROM vendor_payment_batches WHERE transaction_id = 'tm1'")[0];
  ok(owed === 0 && batch && batch.auto === 1 && !batch.confirmed_at, "exactly one candidate within 8%: auto batch created, confirmed_at empty, owed drops");

  const n1 = w.d.q("SELECT COUNT(*) AS n FROM vendor_payment_batches")[0].n;
  await w.F.vendorAutoMatch(w.env);
  ok(w.d.q("SELECT COUNT(*) AS n FROM vendor_payment_batches")[0].n === n1, "running it twice creates nothing new");

  await w.F.handlePostVendorBatchAction(batch.id, "confirm", req({}), w.env);
  ok(w.d.q("SELECT confirmed_at FROM vendor_payment_batches WHERE id = ?", batch.id)[0].confirmed_at, "confirm sets confirmed_at");
  await w.F.handlePostVendorBatchAction(batch.id, "undo", req({}), w.env);
  owed = await w.F.vendorOwedNow(w.env, "vnd1", TODAY);
  ok(owed === 25000, "undo restores the owed total");

  // two candidates -> nothing
  const w2 = world();
  seedClient(w2.d, "c1"); seedVendor(w2.d, "vnd1", "V1"); seedVendor(w2.d, "vnd2", "V2");
  w2.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s1', 'c1', 'vnd1', 'A', 'once', 25000, '2026-10', 'active', 'manual')").run();
  w2.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s2', 'c1', 'vnd2', 'B', 'once', 25100, '2026-10', 'active', 'manual')").run();
  w2.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p1', 's1', 'c1', 'vnd1', 'A', '2026-10', 25000, 'month', 'scheduled')").run();
  w2.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p2', 's2', 'c1', 'vnd2', 'B', '2026-10', 25100, 'month', 'scheduled')").run();
  w2.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('tm2', 'a1', -25000, ?, 'PMNT SENT RMTLY* X')").run(TODAY);
  await w2.F.vendorAutoMatch(w2.env);
  ok(w2.d.q("SELECT COUNT(*) AS n FROM vendor_payment_batches")[0].n === 0, "two candidate vendors: nothing created");

  // no candidates -> nothing
  const w3 = world();
  seedVendor(w3.d, "vnd1", "V1");
  w3.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('tm3', 'a1', -99999, ?, 'PMNT SENT RMTLY* Y')").run(TODAY);
  await w3.F.vendorAutoMatch(w3.env);
  ok(w3.d.q("SELECT COUNT(*) AS n FROM vendor_payment_batches")[0].n === 0, "no candidate vendors: nothing created");

  // older than 14 days -> never matched
  const w4 = world();
  seedClient(w4.d, "c1"); seedVendor(w4.d, "vnd1", "V1");
  w4.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s1', 'c1', 'vnd1', 'A', 'once', 25000, '2026-10', 'active', 'manual')").run();
  w4.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p1', 's1', 'c1', 'vnd1', 'A', '2026-10', 25000, 'month', 'scheduled')").run();
  w4.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('tm4', 'a1', -25000, '2026-09-01', 'PMNT SENT RMTLY* X')").run();
  await w4.F.vendorAutoMatch(w4.env);
  ok(w4.d.q("SELECT COUNT(*) AS n FROM vendor_payment_batches")[0].n === 0, "a transaction older than 14 days is never matched automatically");
}

// ── Quick route ───────────────────────────────────────────────────────────
{
  const w = world();
  seedClient(w.d, "c1"); seedVendor(w.d, "vnd1", "V");
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s1', 'c1', 'vnd1', 'A', 'once', 25000, '2026-10', 'active', 'manual')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p1', 's1', 'c1', 'vnd1', 'A', '2026-10', 25000, 'month', 'scheduled')").run();
  w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('tq1', 'a1', -25000, '2026-10-14', 'PMNT SENT RMTLY* X')").run();
  let rows = await w.F.vendorUnmatchedRemitlyRaw(w.env, 60);
  ok(rows.some(r => r.id === "tq1"), "the transaction starts in the unassigned list");
  const r = await w.F.handlePostVendorPaymentQuick(req({ transaction_id: "tq1", vendor_id: "vnd1" }), w.env);
  ok(r.status === 200, "one tap applies the payment");
  rows = await w.F.vendorUnmatchedRemitlyRaw(w.env, 60);
  ok(!rows.some(r => r.id === "tq1"), "the row leaves the unassigned list");
}

// ── Tiles, forecast ───────────────────────────────────────────────────────
{
  const w = world();
  seedClient(w.d, "c1"); seedClient(w.d, "c2");
  seedVendor(w.d, "vnd1", "V1"); seedVendor(w.d, "vnd2", "V2");
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, months, status, source) VALUES ('s1', 'c1', 'vnd1', 'A', 'monthly', 10000, '2026-10', 2, 'active', 'manual')").run();
  w.d.raw.prepare("INSERT INTO vendor_services (id, client_id, vendor_id, label, kind, price_cents, first_month, status, source) VALUES ('s2', 'c2', 'vnd2', 'B', 'split', 20000, '2026-10', 'active', 'manual')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p1', 's1', 'c1', 'vnd1', 'Mês 1', '2026-10', 10000, 'month', 'scheduled')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p2', 's1', 'c1', 'vnd1', 'Mês 2', '2026-11', 10000, 'month', 'scheduled')").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p3', 's2', 'c2', 'vnd2', '1ª metade', '2026-10', 10000, 'start', 'paused')").run();
  w.d.raw.prepare("UPDATE vendor_payables SET paused_kind = 'skip', pause_reason = 'x' WHERE id = 'p3'").run();
  w.d.raw.prepare("INSERT INTO vendor_payables (id, service_id, client_id, vendor_id, label, period_month, planned_cents, trigger, status) VALUES ('p4', 's2', 'c2', 'vnd2', '2ª metade', NULL, 10000, 'completion', 'waiting_completion')").run();

  const ov = await w.F.handleGetVendorsOverview(req({}, "https://x/?month=2026-10"), w.env);
  const sumVendorDue = ov.data.vendors.reduce((s, v) => s + v.due_total_cents, 0);
  ok(ov.data.tiles.total_due_cents === sumVendorDue, "tiles total equals the sum of vendor owed totals");
  ok(ov.data.tiles.total_due_cents === 10000, "paid/skipped/delayed payables are excluded from the tiles total (p1 due, p3 skipped excluded)");

  const fc = await w.F.handleGetVendorsForecast(req({}, "https://x/?months=3"), w.env);
  ok(fc.data.months.length === 3, "forecast returns the requested month count");
  ok(fc.data.waiting_completion.vnd2 === 10000, "forecast lists waiting-completion separately per vendor");
}

// ── Idempotent creation from contract, no invoice/contract touch ─────────
{
  const w = world();
  seedClient(w.d, "c1");
  seedVendor(w.d, "vnd-rais", "Rais"); seedVendor(w.d, "vnd-addon-site", "Henrique");
  const contract = { id: "k1", client_id: "c1", signed_at: "2026-10-14 10:00:00", data_json: JSON.stringify({ package_key: "advanced", addons: [{ key: "noaddon", label: "No vendor", vendor_id: null, vendor_cost_cents: 1000 }] }) };
  await w.F.vendorCreateFromContract(w.env, contract);
  const count1 = w.d.q("SELECT COUNT(*) AS n FROM vendor_payables")[0].n;
  await w.F.vendorCreateFromContract(w.env, contract);
  const count2 = w.d.q("SELECT COUNT(*) AS n FROM vendor_payables")[0].n;
  ok(count1 === count2 && count1 > 0, "creation from a contract is idempotent (run twice, same rows)");
  ok(w.d.q("SELECT COUNT(*) AS n FROM vendor_services WHERE label = 'No vendor'")[0].n === 0, "an add-on without a vendor makes no row");

  const w2 = world();
  seedClient(w2.d, "c1");
  const contract2 = { id: "k2", client_id: "c1", signed_at: "2026-10-14 10:00:00", data_json: JSON.stringify({ package_key: "start", addons: [{ key: "a1", label: "Has vendor, no cost", vendor_id: "vnd-x", vendor_cost_cents: null }] }) };
  await w2.F.vendorCreateFromContract(w2.env, contract2);
  ok(w2.d.q("SELECT COUNT(*) AS n FROM vendor_services")[0].n === 0, "an add-on with a vendor but no cost makes no row");
  ok(!w2.d.q("SELECT name FROM sqlite_master WHERE name = 'invoices'").length || w2.d.q("SELECT COUNT(*) AS n FROM invoices")[0].n === 0, "nothing in creation touches invoices");
}

// ── Role gates ────────────────────────────────────────────────────────────
{
  const d = makeDb(["migrations/vendors.sql", "migrations/2026-10-15_vendor_tracking_and_club_plus_one.sql"]);
  const F = build(FNS, VARS, Object.assign({}, baseStubs, { jsonErr2: function (pt, en, status) { return { status: status || 400, error: en }; }, gmEasternToday: () => TODAY, authenticate: async () => ({ role: "rafa", display_name: "Rafa" }) }));
  const env = { DB: d.DB };
  let r = await F.handleGetVendorsOverview(req({}, "https://x/?month=2026-10"), env);
  ok(r.status === 403, "rafa is refused");

  const F2 = build(FNS, VARS, Object.assign({}, baseStubs, { jsonErr2: function (pt, en, status) { return { status: status || 400, error: en }; }, gmEasternToday: () => TODAY, authenticate: async () => ({ role: "client", display_name: "C" }) }));
  r = await F2.handleGetVendorsOverview(req({}, "https://x/?month=2026-10"), env);
  ok(r.status === 403, "a client is refused");

  const F3 = build(FNS, VARS, Object.assign({}, baseStubs, { jsonErr2: function (pt, en, status) { return { status: status || 400, error: en }; }, gmEasternToday: () => TODAY, authenticate: async () => ({ role: "alice", display_name: "Alice" }) }));
  r = await F3.handleGetVendorsOverview(req({}, "https://x/?month=2026-10"), env);
  ok(r.status === 200, "alice passes");

  const F4 = build(FNS, VARS, Object.assign({}, baseStubs, { jsonErr2: function (pt, en, status) { return { status: status || 400, error: en }; }, gmEasternToday: () => TODAY, authenticate: async () => ({ role: "developer", display_name: "Dev" }) }));
  r = await F4.handleGetVendorsOverview(req({}, "https://x/?month=2026-10"), env);
  ok(r.status === 200, "developer passes");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
