import { readFileSync } from "node:fs";
import vm from "node:vm";
let bad = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { bad++; } };
const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");

function extract(name) {
  const i = src.indexOf("function " + name + "(");
  const start = src.lastIndexOf("\n", i) + 1;
  const j = src.indexOf("\n}\n", i) + 3;
  return src.slice(start, j);
}

const ctx = vm.createContext({});
vm.runInContext(extract("clientTermsAddMonths"), ctx);
vm.runInContext(extract("clientTermsDeriveFromHistory"), ctx);
const f = ctx.clientTermsDeriveFromHistory;

function pay(date, cents) { return { date, amount_cents: cents }; }
function inv(issued_at, due_at, total_cents, status) { return { issued_at, due_at, total_cents, status: status || "paid" }; }

// ── Gator-style: three $1,500 monthly payments ──────────────────────────────
{
  const payments = [pay("2026-08-03", 150000), pay("2026-09-01", 150000), pay("2026-10-01", 150000)];
  const r = f(payments, []);
  ok(r.frequency && r.frequency.frequency === "monthly", "Gator: three monthly payments -> frequency monthly");
  ok(r.amount && r.amount.amount_cents === 150000 && !r.amount.varies, "Gator: same amount every time -> amount known");
  ok(r.payment_count === 3, "Gator: payment_count is 3");
  ok(r.last_paid_date === "2026-10-01", "Gator: last_paid_date is the most recent payment");
  ok(r.next_expected_date === "2026-11-01", "Gator: next_expected_date is last paid + 1 calendar month (10/01 -> 11/01)");
}

// ── Varying amounts: amount reports 'varies' with min/max/most recent ──────
{
  const payments = [pay("2026-08-03", 100000), pay("2026-09-01", 150000)];
  const r = f(payments, []);
  ok(r.amount && r.amount.varies === true, "varying amounts: amount.varies is true");
  ok(r.amount.most_recent_cents === 150000 && r.amount.min_cents === 100000 && r.amount.max_cents === 150000, "varying amounts: min/max/most-recent reported");
}

// ── One payment: amount/frequency need >= 2 payments; invoice total used instead when exactly one non-void invoice exists ──
{
  const r1 = f([pay("2026-08-03", 150000)], []);
  ok(!r1.amount && !r1.frequency, "one payment, no invoice: nothing guessed");

  const r2 = f([pay("2026-08-03", 150000)], [inv("2026-08-01", "2026-08-01", 150000, "sent")]);
  ok(r2.amount && r2.amount.basis === "invoice_unpaid_twice" && r2.amount.amount_cents === 150000, "one payment, one non-void invoice: amount from the invoice, flagged not yet paid twice");

  const r3 = f([], [inv("2026-08-01", "2026-08-01", 150000, "sent"), inv("2026-09-01", "2026-09-01", 150000, "sent")]);
  ok(!r3.amount, "zero payments, two invoices: amount source only works with exactly one invoice");
}

// ── No payments, no invoices: nothing at all ────────────────────────────────
{
  const r = f([], []);
  ok(!r.amount && !r.frequency && !r.due_day_suggestion && r.payment_count === 0, "no payments and no invoices: nothing derived");
}

// ── Void and voided_mistake invoices are ignored ────────────────────────────
{
  const r = f([pay("2026-08-03", 150000)], [inv("2026-08-01", "2026-08-01", 999999, "void"), inv("2026-08-05", "2026-08-05", 888888, "voided_mistake")]);
  ok(!r.amount, "void and voided_mistake invoices never feed the single-invoice amount fallback");
}

// ── Undone payments are ignored (not modeled here -- the caller's SQL filters
// undone_at; this proves the pure function trusts its input, so a payment the
// caller excluded (e.g. undone) simply never shows up in the count) ────────
{
  const full = [pay("2026-08-03", 150000), pay("2026-09-01", 150000), pay("2026-10-01", 150000)];
  const withoutUndone = full.slice(0, 2); // simulates the undone 3rd payment never being passed in
  const r = f(withoutUndone, []);
  ok(r.payment_count === 2, "a payment excluded by the caller (e.g. undone) is never counted");
}

// ── Weekly / biweekly / monthly / quarterly gaps ────────────────────────────
{
  ok(f([pay("2026-08-03", 100), pay("2026-08-10", 100), pay("2026-08-17", 100)], []).frequency.frequency === "weekly", "7-day gaps: weekly");
  ok(f([pay("2026-08-03", 100), pay("2026-08-17", 100), pay("2026-08-31", 100)], []).frequency.frequency === "biweekly", "14-day gaps: biweekly");
  ok(f([pay("2026-08-03", 100), pay("2026-09-01", 100), pay("2026-10-01", 100)], []).frequency.frequency === "monthly", "~30-day gaps: monthly");
  ok(f([pay("2026-01-01", 100), pay("2026-04-01", 100), pay("2026-07-01", 100)], []).frequency.frequency === "quarterly", "~90-day gaps: quarterly");
  ok(!f([pay("2026-01-01", 100), pay("2026-03-01", 100)], []).frequency, "a 59-day gap matches no named band -- nothing guessed");
}

// ── Outlier payment flagged ─────────────────────────────────────────────────
{
  const r = f([pay("2026-01-01", 150000), pay("2026-02-01", 150000), pay("2026-03-01", 400000), pay("2026-04-01", 150000)], []);
  ok(r.outlier_payments && r.outlier_payments.length === 1 && r.outlier_payments[0].amount_cents === 400000 && r.outlier_payments[0].date === "2026-03-01", "a payment >= 1.5x the median is flagged as an outlier");
}

// ── Weekend-shifted due day: payments land on the 3rd, invoices are due the 1st -- due-day suggestion prefers invoice due dates ──
{
  const r = f(
    [pay("2026-08-03", 150000), pay("2026-09-03", 150000), pay("2026-10-03", 150000)],
    [inv("2026-07-25", "2026-08-01", 150000), inv("2026-08-25", "2026-09-01", 150000), inv("2026-09-25", "2026-10-01", 150000)]
  );
  ok(r.due_day_suggestion && r.due_day_suggestion.due_day === 1 && r.due_day_suggestion.basis === "invoice_due_dates", "weekend-shifted payments: due day suggestion comes from invoice due dates (the 1st), not the paid-on dates (the 3rd)");
}

// ── Due day from payment dates when there are no invoice due dates ─────────
{
  const r = f([pay("2026-08-05", 100), pay("2026-09-05", 100), pay("2026-10-05", 100)], []);
  ok(r.due_day_suggestion && r.due_day_suggestion.due_day === 5 && r.due_day_suggestion.basis === "payment_dates", "no invoice due dates: due day falls back to the payment dates, marked as such");
}


// ── payment method, "amount varies", start date, read from the data ──
{
  const z = (d) => ({ date: d, amount_cents: 150000, description: "Zelle payment from GATOR OUTDOOR LIVING" });
  const r = f([z("2026-08-03"), z("2026-09-01"), z("2026-10-01")], [{ issued_at: "2026-07-31", due_at: "2026-08-01", total_cents: 150000, status: "paid" }]);
  ok(r.payment_method && r.payment_method.method === "zelle", "payment method: Zelle read from the deposit descriptions");
  ok(r.amount_varies && r.amount_varies.varies === false, "amount varies: same every time reads as no");
  ok(r.start_date && r.start_date.start_date === "2026-07-31", "start date: the first invoice date");
  const mixed = f([{ date: "2026-08-03", amount_cents: 100, description: "Zelle from X" }, { date: "2026-09-01", amount_cents: 100, description: "ACH credit from X" }, { date: "2026-10-01", amount_cents: 100, description: "Zelle from X" }], []);
  ok(!mixed.payment_method, "payment method: mixed or unknown descriptions are not guessed");
  const varying = f([{ date: "2026-08-03", amount_cents: 100 }, { date: "2026-09-01", amount_cents: 300 }], []);
  ok(varying.amount_varies && varying.amount_varies.varies === true, "amount varies: different amounts read as yes");
}
console.log(bad ? bad + " FAILED" : "ALL PASSED"); process.exit(bad ? 1 : 0);
