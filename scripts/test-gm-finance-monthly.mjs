// Finance tab date filter + monthly-by-entry-date grouping (2026-10-15 build).
// Worker: handleGetGmFinance groups the monthly summary by the month of the
// entry's own date, not the legacy stored mes column. Front: the small named
// helpers gm.js uses to build the on-screen date filter and its totals.
// No network, no live database -- an in-memory copy of the real schema.
//
//   node scripts/test-gm-finance-monthly.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { build, makeDb, baseStubs, req } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + (JSON.stringify(a) === JSON.stringify(b) ? "" : "  got " + JSON.stringify(a) + "  want " + JSON.stringify(b)));

// ─────────────────────────── worker: handleGetGmFinance ────────────────────
const W = build(["handleGetGmFinance", "requireClientAccess"], [], Object.assign({}, baseStubs, {
  authenticate: async () => ({ role: "client", client_id: "c1" })
}));
const d = makeDb(["migrations/gm_growth_management.sql"]);
d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'Dipro Remodeling')").run();
const ins = d.raw.prepare(
  "INSERT INTO gm_finance (id, client_id, mes, data, descricao, categoria, tipo, valor, obs, created_at) VALUES (?, 'c1', ?, ?, ?, 'A', ?, ?, NULL, ?)"
);
const E = "Entrada", S = "Saída";
// Every mes is empty (the real-world bug): September and October entries,
// one with no data at all (falls back to created_at), one with neither
// (goes to the null group).
ins.run("sep1", "", "2026-09-05", "Repasse", E, 1000, "2026-09-05 12:00:00");
ins.run("sep2", "", "2026-09-20", "Equipe",  S, 300,  "2026-09-20 12:00:00");
ins.run("oct1", "", "2026-10-01", "Vendas",  E, 2000, "2026-10-01 12:00:00");
ins.run("oct2", "", "2026-10-15", "Comissão",S, 150,  "2026-10-15 12:00:00");
ins.run("nodata", "", null, "Sem data no campo, mas tem created_at", E, 500, "2026-08-11 09:00:00");
ins.run("nothing", "", null, "Nada mesmo", S, 50, "not-a-timestamp");

const env = { DB: d.DB };
const res = await W.handleGetGmFinance("c1", req({}, "https://api.x.test/api/clients/c1/gm/finance"), env);
eq(res.status, 200, "worker: 200");
eq(res.data.monthly.map((m) => m.month_key), ["2026-10", "2026-09", "2026-08", null], "worker: month_key groups, newest first, no-date group last");
const sep = res.data.monthly.find((m) => m.month_key === "2026-09");
eq([sep.entradas, sep.saidas, sep.resultado], [1000, 300, 700], "worker: September sums (mes was empty for every row)");
eq(sep.margem_pct, 70, "worker: September margin 70%");
const oct = res.data.monthly.find((m) => m.month_key === "2026-10");
eq([oct.entradas, oct.saidas, oct.resultado], [2000, 150, 1850], "worker: October sums");
const aug = res.data.monthly.find((m) => m.month_key === "2026-08");
eq([aug.entradas, aug.saidas], [500, 0], "worker: an entry with no data falls back to created_at's month");
const nullGroup = res.data.monthly.find((m) => m.month_key === null);
eq([nullGroup.entradas, nullGroup.saidas], [0, 50], "worker: an entry with neither data nor created_at lands in the null group");
const totalIn = res.data.monthly.reduce((a, m) => a + m.entradas, 0);
const totalOut = res.data.monthly.reduce((a, m) => a + m.saidas, 0);
eq([totalIn, totalOut], [3500, 500], "worker: the sum of the new groups equals the old single lump (3500 in / 500 out)");
ok(res.data.monthly.every((m) => Object.prototype.hasOwnProperty.call(m, "mes")), "worker: legacy mes field is still returned on every row");
eq(res.data.entries.length, 6, "worker: entries is still all rows, unchanged");
ok(d.writes.length === 0, "worker: the route writes nothing");

// ──────────────────────────── front: gm.js helpers ──────────────────────────
const gmSrc = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
function fnFromGm(name) {
  const i = gmSrc.indexOf("\nfunction " + name + "(");
  if (i < 0) { throw new Error("function not found in gm.js: " + name); }
  const j = gmSrc.indexOf("\n}", i + 1);
  return gmSrc.slice(i + 1, j + 2);
}
const FN_NAMES = [
  "gmFinMonthLabel", "gmFinEntryDateKey", "gmFinEntryMonthKey", "gmFinMonthList",
  "gmFinMonthFirstLastDay", "gmFinDefaultRange", "gmFinPad2", "gmFinQuickRange",
  "gmFinFilterEntries", "gmFinTotals", "gmFinMonthlyFromEntries"
];
const varNames = ["GM_FIN_MONTH_NAMES_PT", "GM_FIN_MONTH_NAMES_EN"];
function varFromGm(name) {
  const i = gmSrc.indexOf("\nvar " + name + " =");
  if (i < 0) { throw new Error("var not found in gm.js: " + name); }
  const m = /;[ \t]*\n/.exec(gmSrc.slice(i));
  return gmSrc.slice(i + 1, i + m.index + 1);
}
const body = varNames.map(varFromGm).concat(FN_NAMES.map(fnFromGm)).join("\n") +
  "\nreturn { " + FN_NAMES.join(", ") + " };";
const F = new Function(body)();

// Month label, both languages.
eq(F.gmFinMonthLabel("2026-09", false), "Setembro de 2026", "label: pt has \"de\"");
eq(F.gmFinMonthLabel("2026-09", true), "September 2026", "label: en has no \"de\"");
eq(F.gmFinMonthLabel(null, false), "Sem data", "label: pt no-date group");
eq(F.gmFinMonthLabel(null, true), "No date", "label: en no-date group");
eq(F.gmFinMonthLabel("2026-01", true), "January 2026", "label: January edge");

// Entry date / month key, with the created_at fallback.
eq(F.gmFinEntryDateKey({ data: "2026-09-05" }), "2026-09-05", "entry date: from data");
eq(F.gmFinEntryDateKey({ data: null, created_at: "2026-08-11 09:00:00" }), "2026-08-11", "entry date: falls back to created_at");
eq(F.gmFinEntryDateKey({ data: null, created_at: null }), null, "entry date: null when neither is set");
eq(F.gmFinEntryMonthKey({ data: "2026-09-05" }), "2026-09", "entry month key");

// Month list, newest first, with counts.
const entries = [
  { data: "2026-09-05", tipo: E, valor: 10 },
  { data: "2026-09-20", tipo: S, valor: 3 },
  { data: "2026-10-01", tipo: E, valor: 20 },
  { data: null, created_at: null, tipo: S, valor: 1 }
];
eq(F.gmFinMonthList(entries).map((m) => [m.key, m.count]), [["2026-10", 1], ["2026-09", 2]], "month list: newest first, no-date entries excluded, counted correctly");

// Default range: current month if it has entries, else the newest month that does.
eq(F.gmFinDefaultRange(entries, "2026-10-15"), { from: "2026-10-01", to: "2026-10-31", quick: "" }, "default range: current month (October) has entries");
eq(F.gmFinDefaultRange(entries, "2026-12-01"), { from: "2026-10-01", to: "2026-10-31", quick: "" }, "default range: no entries in December, falls to newest month (October)");
eq(F.gmFinDefaultRange([], "2026-10-15"), { from: "", to: "", quick: "" }, "default range: no entries at all");

// Quick-choice ranges, including January edges.
eq(F.gmFinQuickRange("this_month", "2026-10-15"), { from: "2026-10-01", to: "2026-10-31" }, "quick: this month");
eq(F.gmFinQuickRange("last_month", "2026-10-15"), { from: "2026-09-01", to: "2026-09-30" }, "quick: last month");
eq(F.gmFinQuickRange("last_month", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" }, "quick: last month in January wraps to December of the prior year");
eq(F.gmFinQuickRange("this_year", "2026-10-15"), { from: "2026-01-01", to: "2026-12-31" }, "quick: this year");
eq(F.gmFinQuickRange("last_year", "2026-01-15"), { from: "2025-01-01", to: "2025-12-31" }, "quick: last year");
eq(F.gmFinQuickRange("all_time", "2026-10-15", entries), { from: "2026-09-05", to: "2026-10-15" }, "quick: all time runs from the first entry date to today");
eq(F.gmFinQuickRange("all_time", "2026-10-15", []), { from: "2026-10-15", to: "2026-10-15" }, "quick: all time with no entries is just today");

// Range filter: inclusive bounds, mid-month start, no-date only in All time, bad range rejected by the caller (gmRenderFinance), not this helper.
eq(F.gmFinFilterEntries(entries, "2026-09-10", "2026-10-31", false).map((e) => e.valor), [3, 20], "filter: inclusive start/end, a range starting mid-month (Sept 10) excludes the Sept 5 entry");
eq(F.gmFinFilterEntries(entries, "2026-09-05", "2026-09-05", false).map((e) => e.valor), [10], "filter: a single-day range, both bounds inclusive");
eq(F.gmFinFilterEntries(entries, "", "", false).map((e) => e.valor), [10, 3, 20], "filter: no bounds keeps every dated entry, but not the no-date one");
eq(F.gmFinFilterEntries(entries, "", "", true).map((e) => e.valor), [10, 3, 20, 1], "filter: includeNoDate (All time) also keeps the no-date entry");

// Per-month and period totals in cents.
const sepTot = F.gmFinTotals([entries[0], entries[1]]);
eq([sepTot.entradas, sepTot.saidas, sepTot.resultado, sepTot.margem_pct, sepTot.count], [1000, 300, 700, 70, 2], "totals: September entries in cents");
const periodTot = F.gmFinTotals(entries.filter((e) => e.data));
eq([periodTot.entradas, periodTot.saidas], [3000, 300], "totals: period total for all dated entries (3000 in, 300 out)");
eq(F.gmFinTotals([]).margem_pct, null, "totals: no entradas means a null margin, not a divide-by-zero");

// Monthly grouping from an already-filtered entry set, newest first, no-date last.
const grouped = F.gmFinMonthlyFromEntries(entries);
eq(grouped.map((m) => m.month_key), ["2026-10", "2026-09", null], "grouped: newest month first, no-date group last");
eq(grouped.find((m) => m.month_key === "2026-09").entradas, 1000, "grouped: September group sums correctly");

// All-time front totals must equal the worker's monthly totals (same data, same math).
const allTimeGrouped = F.gmFinMonthlyFromEntries([
  { data: "2026-09-05", tipo: E, valor: 10 }, { data: "2026-09-20", tipo: S, valor: 3 },
  { data: "2026-10-01", tipo: E, valor: 20 }, { data: "2026-10-15", tipo: S, valor: 1.5 }
]);
eq(allTimeGrouped.find((m) => m.month_key === "2026-09"), { entradas: 1000, saidas: 300, resultado: 700, margem_pct: 70, count: 2, month_key: "2026-09" }, "front/worker parity: September group matches the worker's shape and sums");

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
