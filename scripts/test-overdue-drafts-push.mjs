// The push text for past-due invoices still in draft, run against the REAL
// Worker functions (sliced from worker/index.js). No network, no database.
//
//   node scripts/test-overdue-drafts-push.mjs
import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const worker = readFileSync(new URL("worker/index.js", root), "utf8");
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const fnSrc = (src, name) => { const i = src.indexOf("function " + name + "("); if (i < 0) throw new Error("fn not found " + name); const j = src.indexOf("\n}", i); return src.slice(i, j + 2); };

const W = {};
new Function("g", [fnSrc(worker, "fmtCentsUs"), fnSrc(worker, "fmtDateUs"), fnSrc(worker, "overdueDraftsMessage"),
  "g.W = { fmtCentsUs, fmtDateUs, overdueDraftsMessage };"].join("\n"))(W);
const F = W.W;

const rows = [
  { number: "INV-000036", client_name: "DIPRO REMODELING", amount_cents: 34925, due_at: "2026-09-22" },
  { number: "INV-000038", client_name: "TIGERS", amount_cents: 80000, due_at: "2026-09-29" },
  { number: "INV-000039", client_name: "DIPRO REMODELING", amount_cents: 34925, due_at: "2026-09-29" },
  { number: "INV-000041", client_name: "GOLDEN HOME IMPROVEMENT", amount_cents: 70000, due_at: "2026-09-29" },
  { number: "INV-000042", client_name: "GATOR OUTDOOR LIVING", amount_cents: 150000, due_at: "2026-10-01" }
];
const five = F.overdueDraftsMessage(rows);
ok(five.title === "5 faturas vencidas ainda em rascunho", "five rows: title");
// NOTE: the job text said $4,198.50, but these five amounts add up to
// 34925+80000+34925+70000+150000 = 369850 cents = $3,698.50. The test follows the arithmetic.
ok(five.body === "Total $3,698.50. A mais antiga venceu em 09/22/2026. Toque para revisar e enviar.", "five rows: body (sum is $3,698.50)");
const shuffled = F.overdueDraftsMessage(rows.slice().reverse());
ok(shuffled.body === five.body, "oldest date found even when rows are not sorted");

const one = F.overdueDraftsMessage([rows[1]]);
ok(one.title === "Fatura vencida ainda em rascunho", "one row: title");
ok(one.body === "TIGERS · $800.00 · INV-000038 · venceu em 09/29/2026", "one row: body");

const none = F.overdueDraftsMessage([]);
ok(none.title === "0 faturas vencidas ainda em rascunho" && /^Total \$0\.00\./.test(none.body), "empty list does not throw");

ok(F.fmtCentsUs(838200) === "$8,382.00", "$8,382.00 format");
ok(F.fmtDateUs("2026-10-01") === "10/01/2026", "October 1 is 10/01/2026");

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
