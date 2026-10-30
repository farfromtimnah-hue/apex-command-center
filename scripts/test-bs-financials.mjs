// Business System Financials: the money math, run on the REAL functions cut out
// of worker/index.js (integer cents, no network, no database).
//
//   node scripts/test-bs-financials.mjs
import vm from "node:vm";
import { fnSrc, varSrc } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

const code = ["bsOccurrences", "bsMonthlyEquivalent", "bsSplitShares", "bsComputeFinancials", "bsValidDate", "bsCostValidate"].map((n) => fnSrc(n)).join("\n") +
  "\n" + ["BS_COST_KINDS", "BS_COST_FREQS", "BS_COST_PAID_BY"].map((n) => varSrc(n)).join("\n");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);

// Splits: an odd cent goes to Resonate.
let s = ctx.bsSplitShares(12345, "split_50_50");
ok(s.resonate === 6173 && s.rafa === 6172, "50-50 on 12,345 cents: Resonate 6,173, Pr Rafa 6,172");
s = ctx.bsSplitShares(10000, "split_50_50");
ok(s.resonate === 5000 && s.rafa === 5000, "50-50 on an even amount splits evenly");
s = ctx.bsSplitShares(10000, "resonate_100");
ok(s.resonate === 10000 && s.rafa === 0, "resonate_100 gives everything to Resonate");
s = ctx.bsSplitShares(5001, "rafa_100");
ok(s.resonate === 0 && s.rafa === 5001, "rafa_100 gives everything to Pr Rafa");
s = ctx.bsSplitShares(null, "split_50_50");
ok(s.resonate === 0 && s.rafa === 0, "not set counts as zero");

// Occurrences.
const occ = (freq, start, end, today) => ctx.bsOccurrences({ frequency: freq, start_date: start, end_date: end || null }, today);
ok(occ("monthly", "2026-08-01", null, "2026-10-30") === 3, "monthly from Aug 1 to Oct 30: 3 charges");
ok(occ("monthly", "2026-08-31", null, "2026-10-30") === 2, "monthly from Aug 31 to Oct 30: 2 charges (Oct 31 not reached)");
ok(occ("yearly", "2026-01-01", null, "2026-10-30") === 1, "yearly from Jan 1: 1 charge so far");
ok(occ("yearly", "2025-11-15", null, "2026-10-30") === 1 && occ("yearly", "2025-10-30", null, "2026-10-30") === 2, "yearly counts the anniversary day itself");
ok(occ("monthly", "2026-11-01", null, "2026-10-30") === 0, "not started: 0");
ok(occ("monthly", "2026-05-01", "2026-06-15", "2026-10-30") === 2, "ended entries stop accruing");
ok(occ("one_time", "2026-10-01", null, "2026-10-30") === 1, "one time once");

// The full hand calculation.
const clients = [
  { id: "a", name: "A", status: "active", split_mode: "split_50_50", monthly_amount_cents: 12345 },
  { id: "b", name: "B", status: "active", split_mode: "resonate_100", monthly_amount_cents: 10000 },
  { id: "c", name: "C", status: "active", split_mode: "rafa_100", monthly_amount_cents: 5001 },
  { id: "d", name: "D", status: "active", split_mode: "split_50_50", monthly_amount_cents: null }
];
const e = (kind, amount_cents, frequency, start_date, end_date) => ({ kind, amount_cents, frequency, start_date, end_date: end_date || null });
const entries = [
  e("investment", 100000, "one_time", "2026-07-01"),
  e("recurring_cost", 2000, "monthly", "2026-08-01"),
  e("recurring_cost", 12001, "yearly", "2026-01-01"),
  e("recurring_cost", 5000, "one_time", "2026-09-01"),
  e("recurring_cost", 700, "monthly", "2026-05-01", "2026-06-15"),
  e("planned_cost", 3000, "monthly", "2027-06-15"),
  e("planned_cost", 7000, "one_time", "2027-06-15"),
  e("income", 4000, "one_time", "2026-09-01")
];
const r = ctx.bsComputeFinancials(clients, entries, "2026-10-30");
const f = r.figures;
ok(r.totals.monthly_revenue_cents === 27346 && r.totals.resonate_cents === 16173 && r.totals.rafa_cents === 11173 && r.totals.not_set_count === 1, "client totals: revenue 27,346; Resonate 16,173; Pr Rafa 11,173; 1 not set");
ok(f.monthly_cost_cents === 3000, "monthly cost today = 2,000 + round(12,001 / 12) = 3,000 (the ended 700 is out)");
ok(f.monthly_profit_cents === 24346, "monthly profit today = 27,346 - 3,000");
ok(f.monthly_cost_after_planned_cents === 6000 && f.monthly_profit_after_planned_cents === 21346, "after planned charges: cost 6,000, profit 21,346");
ok(f.one_time_spend_to_date_cents === 105000, "one-time spend to date = 100,000 + 5,000");
ok(f.planned_one_time_ahead_cents === 7000, "planned one-time ahead = 7,000");
ok(f.income_received_to_date_cents === 4000, "income received = 4,000");
ok(f.recurring_accrued_cents === 6000 + 12001 + 700 * 2, "recurring accrued = 3 x 2,000 + 12,001 + 2 x 700 = 19,401");
ok(f.unrecovered_cents === 105000 + 19401 - 4000, "unrecovered = 120,401 (still in debt)");
const recovered = ctx.bsComputeFinancials([], [e("income", 50000, "one_time", "2026-01-01"), e("investment", 20000, "one_time", "2026-01-01")], "2026-10-30");
ok(recovered.figures.unrecovered_cents === -30000, "income above spend gives a negative position (recovered)");

// Ledger validation.
const base = { kind: "recurring_cost", description: "Claude", amount_cents: 2000, frequency: "monthly", start_date: "2026-08-01" };
const v = (patch) => ctx.bsCostValidate(Object.assign({}, base, patch)).ok;
ok(v({}) === true, "a good entry validates");
ok(!v({ kind: "x" }) && !v({ frequency: "weekly" }) && !v({ amount_cents: 0 }) && !v({ amount_cents: -1 }) && !v({ amount_cents: 1.5 }) && !v({ amount_cents: "20" }), "kind, frequency and amount are strict");
ok(!v({ start_date: "2026-02-30" }) && !v({ end_date: "2026-07-31" }) && !v({ paid_by: "bob" }) && !v({ description: " " }), "dates, end before start, paid_by and description are strict");
ok(v({ end_date: "2026-12-31", paid_by: "joint" }) === true, "optional end date and paid_by accepted");

console.log(fail ? "\n" + fail + " FAILED" : "\nAll passed");
process.exit(fail ? 1 : 0);
