// Estimates & invoices build — PHASE 3 math, against the REAL Worker functions.
import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const worker = readFileSync(new URL("worker/index.js", root), "utf8");
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const fnSrc = (src, name) => { const i = src.indexOf("function " + name + "("); if (i < 0) throw new Error("fn " + name); const j = src.indexOf("\n}", i); return src.slice(i, j + 2); };
const W = {};
new Function("g", [fnSrc(worker, "gmNum"), fnSrc(worker, "gmDateAddDays"), fnSrc(worker, "gmInvTolerance"), fnSrc(worker, "gmInvDerive"), fnSrc(worker, "gmInvLateFeeCents"),
  "g.f = { gmInvTolerance, gmInvDerive, gmInvLateFeeCents };"].join("\n"))(W);
const F = W.f;
const today = "2026-09-26";
const inv = (amount, status, due) => ({ amount_cents: amount, status: status || "sent", due_date: due || "2026-10-26" });
const pay = (amt, state) => ({ amount_cents: amt, state: state || "verified" });

ok(F.gmInvTolerance(100000) === 200, "$1,000 invoice: tolerance is $2.00 (0.5% = $5 > $2)");
ok(F.gmInvTolerance(10000) === 50, "$100 invoice: tolerance is $0.50 (0.5%), the smaller of the two");
let d = F.gmInvDerive(inv(100000), [pay(99850)], [], today);
ok(d.derived_status === "paid" && d.settled, "$998.50 on a $1,000 invoice counts as paid (within $2.00)");
d = F.gmInvDerive(inv(100000), [pay(99700)], [], today);
ok(d.derived_status === "partially_paid" && d.balance_cents === 300, "$997.00 on $1,000 is partially paid, balance $3.00");
d = F.gmInvDerive(inv(100000), [pay(100000, "pending_verification")], [], today);
ok(d.derived_status === "unpaid" && d.paid_cents === 0 && d.pending_cents === 100000 && d.awaiting_verification, "a pending payment never counts as paid, and flags awaiting verification");
d = F.gmInvDerive(inv(100000), [pay(100000, "rejected")], [], today);
ok(d.derived_status === "unpaid" && d.paid_cents === 0 && !d.awaiting_verification, "a rejected payment counts for nothing");
d = F.gmInvDerive(inv(100000), [pay(100000, "reversed")], [], today);
ok(d.derived_status === "unpaid" && d.paid_cents === 0, "a reversed payment counts for nothing");
d = F.gmInvDerive(inv(100000, "sent", "2026-09-01"), [], [], today);
ok(d.derived_status === "overdue" && d.balance_cents === 100000, "past due with a balance = overdue");
d = F.gmInvDerive(inv(100000, "sent", "2026-09-01"), [pay(100000)], [], today);
ok(d.derived_status === "paid", "past due but paid = paid, not overdue");
d = F.gmInvDerive(inv(100000), [pay(50000)], [{ kind: "credit", amount_cents: 50000 }], today);
ok(d.derived_status === "paid" && d.credit_cents === 50000, "a credit reduces what is owed");
d = F.gmInvDerive(inv(100000), [pay(100000)], [{ kind: "refund", amount_cents: 30000 }], today);
ok(d.paid_cents === 70000 && d.balance_cents === 30000 && d.derived_status === "partially_paid", "a refund comes back off paid");
ok(F.gmInvDerive(inv(100000, "draft"), [], [], today).derived_status === "draft" && F.gmInvDerive(inv(100000, "void"), [pay(100000)], [], today).derived_status === "void", "draft and void are stored statuses");
// late fee: simple interest from due + grace
let lf = F.gmInvLateFeeCents(100000, 18, "2026-08-01", 10, "2026-09-26");
// due 08-01 + 10 grace = 08-11; to 09-26 = 46 days; 1000 * 0.18 * 46/365 = 22.68
ok(lf.days === 46 && lf.cents === 2268, "18%/yr on $1,000, 46 days past due+grace = $22.68 simple interest");
ok(F.gmInvLateFeeCents(100000, 18, "2026-09-20", 10, "2026-09-26").cents === 0, "inside the grace period: no fee");
ok(F.gmInvLateFeeCents(0, 18, "2026-01-01", 0, "2026-09-26").cents === 0, "no balance: no fee");
// SQL guards
ok(/state = 'verified'[^;]*WHERE id = \? AND client_id = \? AND state = 'pending_verification'/.test(worker), "verify is guarded in SQL on state = pending_verification");
ok(/state = 'rejected'[^;]*state = 'pending_verification'/.test(worker), "reject is guarded in SQL");
ok(/state = 'reversed'[^;]*state = 'verified'/.test(worker), "reverse only a verified payment, guarded in SQL");
ok(/status = 'void'[^;]*NOT EXISTS \(SELECT 1 FROM gm_invoice_payments p WHERE p\.invoice_id = gm_invoices\.id AND p\.state = 'verified'\)/.test(worker), "void refuses an invoice with verified payments, in SQL");
ok(!/DELETE FROM gm_invoice|DELETE FROM gm_invoices/.test(worker), "no DELETE on the invoice tables");
ok(/late_fee[\s\S]*Never applied automatically/i.test(worker), "late fee is documented as never automatic");
// public pages: no Apex branding, fixed slides
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "").replace(/apex-api\.farfromtimnah\.workers\.dev/g, "");
for (const f of ["invoice-view.html", "receipt-view.html", "templates/client-invoice-template.html", "templates/client-receipt-template.html"]) {
  const src = readFileSync(new URL(f, root), "utf8");
  ok(!/apex/i.test(strip(src)), f + " carries no Apex branding");
  if (f.indexOf("templates/") === 0) { ok(/\.slide \{ position: relative; width: 8\.5in; height: 11in/.test(src) && !/position:\s*fixed/.test(strip(src)) && /window\.print\(\)/.test(src), f + " uses fixed slides and prints from its own window"); }
}
console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
