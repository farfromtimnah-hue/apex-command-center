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
  "gmFinFilterEntries", "gmFinTotals", "gmFinMonthlyFromEntries",
  "gmFinBalanceBefore", "gmFinAddBalances", "gmFinPeriodWithBalances", "gmFinUndatedCount",
  "gmFinUndatedNoteText", "gmFinCentsPlain", "gmFinReportOpenPrefill",
  "gmFinOpeningAnswered", "gmFinOpeningNeedsAnswer", "gmFinTodayStart", "gmFinZeroStart"
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


// ───────────────── Saldo inicial / Saldo final (2026-11-05 build) ─────────────
// Every case is a real run of the functions cut out of gm.js.
const cardBody = ["gmFinBalanceLineHtml", "gmFinMonthCardHtml", "gmFinOpeningHas", "gmFinOpeningCfg", "gmFinOpeningCardHtml", "gmFinMonthLabel",
  "gmFinOpeningAnswered", "gmFinOpeningNeedsAnswer", "gmFinIsPreview", "gmFinOpeningLiveText", "gmFinUnansweredNoteHtml"].map(fnFromGm).join("\n");
const cardMaker = new Function("gmT", "escHtml", "fmtNum", "isEn", "PREVIEW_AS", "GM_FIN_MONTH_NAMES_PT", "GM_FIN_MONTH_NAMES_EN", "getConfig",
  "var gmConfig = getConfig();\n" + cardBody + "\nreturn { gmFinMonthCardHtml, gmFinOpeningCardHtml, gmFinOpeningLiveText, gmFinUnansweredNoteHtml };");
const money = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toFixed(2);
const cards = (lang, cfgObj, preview) => cardMaker(
  (pt, en) => (lang === "en" ? en : pt), (x) => String(x), (n, k) => (k === "percent" ? n + "%" : money(n)), () => lang === "en",
  preview ? "client-1" : "", ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"],
  ["January","February","March","April","May","June","July","August","September","October","November","December"], () => ({ config: cfgObj }));

const NOCFG = {};
const base = [
  { data: "2026-09-05", tipo: E, valor: 1000 }, { data: "2026-09-20", tipo: S, valor: 300 },
  { data: "2026-10-01", tipo: E, valor: 2000 }, { data: "2026-10-15", tipo: S, valor: 150 }
];
const monthsFor = (all, cfg, from, to) => {
  const filtered = F.gmFinFilterEntries(all, from, to, false);
  return F.gmFinAddBalances(F.gmFinMonthlyFromEntries(filtered), all, cfg, from);
};
const byKey = (ms, k) => ms.find((m) => m.month_key === k);

// (a) two whole months: the second opens exactly where the first closed
const a = monthsFor(base, NOCFG, "2026-09-01", "2026-10-31");
eq([byKey(a, "2026-09").saldo_inicial, byKey(a, "2026-09").saldo_final], [0, 70000], "balance (a): the earliest month opens at 0 and closes at its Resultado");
eq(byKey(a, "2026-10").saldo_inicial, byKey(a, "2026-09").saldo_final, "balance (a): October's Saldo inicial is exactly September's Saldo final");
eq(byKey(a, "2026-10").saldo_final, 70000 + 185000, "balance (a): October closes at 2,550.00");

// (b) same data, filter on the second month only: identical balances
const b = monthsFor(base, NOCFG, "2026-10-01", "2026-10-31");
eq([byKey(b, "2026-10").saldo_inicial, byKey(b, "2026-10").saldo_final], [byKey(a, "2026-10").saldo_inicial, byKey(a, "2026-10").saldo_final], "balance (b): a This-month filter shows the same carried balance as the full view");

// (c) more out than in: negative closing balance, warning styling
const negData = [{ data: "2026-11-02", tipo: E, valor: 100 }, { data: "2026-11-03", tipo: S, valor: 500 }];
const c = monthsFor(negData, NOCFG, "2026-11-01", "2026-11-30");
eq(c[0].saldo_final, -40000, "balance (c): Saldo final is negative when out is larger than in");
const cHtmlPt = cards("pt", NOCFG).gmFinMonthCardHtml("Novembro", c[0]);
ok(/Saldo final<\/span><span class="gm-warn">▼ -\$400\.00/.test(cHtmlPt), "balance (c): a negative Saldo final uses gm-warn and the down triangle");
const posHtml = cards("en", NOCFG).gmFinMonthCardHtml("October", byKey(a, "2026-10"));
ok(/Closing balance<\/span><span>\$2550\.00/.test(posHtml), "balance (c): a positive balance is plain text, no class, no triangle");
const lines = (h) => [...h.matchAll(/<div class="gm-month-line"><span>([^<]+)<\/span>/g)].map((m) => m[1]);
eq(lines(posHtml), ["Opening balance", "In", "Out", "Net", "Net margin", "Closing balance"], "card (EN): lines top to bottom, existing labels unchanged");
eq(lines(cHtmlPt), ["Saldo inicial", "Entradas", "Saídas", "Resultado", "Margem líquida", "Saldo final"], "card (PT): lines top to bottom, existing labels unchanged");

// (d) starting balance 18000.00 at 2026-10-01
const CFG = { opening_balance_cents: 1800000, opening_balance_month: "2026-10-01", opening_balance_available: true };
const dData = base.concat([{ data: "2026-11-04", tipo: E, valor: 500 }, { data: "2026-11-09", tipo: S, valor: 200 }]);
const d1 = monthsFor(dData, CFG, "2026-09-01", "2026-11-30");
eq(byKey(d1, "2026-10").saldo_inicial, 1800000, "balance (d): October opens at the starting balance 18,000.00");
eq(byKey(d1, "2026-11").saldo_inicial, byKey(d1, "2026-10").saldo_final, "balance (d): November opens at October's Saldo final");
ok(byKey(d1, "2026-09").saldo_inicial === undefined && byKey(d1, "2026-09").saldo_final === undefined, "balance (d): the September card has no balance fields");
const sepHtml = cards("en", CFG).gmFinMonthCardHtml("September", byKey(d1, "2026-09"));
eq(lines(sepHtml), ["In", "Out", "Net", "Net margin"], "balance (d): the September card is drawn exactly as before, no balance lines");
eq(F.gmFinBalanceBefore(dData, CFG, "2026-09-30"), null, "balance (d): before the starting month the balance is not known (null)");

// (e) entries before the starting month: ignored by the balance, kept in their own month's In and Out
eq([byKey(d1, "2026-09").entradas, byKey(d1, "2026-09").saidas], [100000, 30000], "balance (e): September still shows its own In and Out");
eq(F.gmFinBalanceBefore(dData, CFG, "2026-12-01"), 1800000 + (200000 - 15000) + (50000 - 20000), "balance (e): the balance at Dec 1 counts only October and November on top of the start (18,000 + 1,850 + 300)");

// (f) undated entries: never change a balance, never throw, note with the right plural
const withUndated = base.concat([{ data: null, created_at: null, tipo: E, valor: 999 }, { tipo: S, valor: 5 }, { data: "garbage", tipo: E, valor: 7 }]);
let threw = false, f1 = null;
try { f1 = F.gmFinAddBalances(F.gmFinMonthlyFromEntries(withUndated), withUndated, NOCFG, ""); } catch (e) { threw = true; }
ok(!threw, "balance (f): entries with no usable date do not throw");
eq(F.gmFinBalanceBefore(withUndated, NOCFG, "2026-12-01"), F.gmFinBalanceBefore(base, NOCFG, "2026-12-01"), "balance (f): undated entries never change a balance");
eq(F.gmFinUndatedCount(withUndated), 3, "balance (f): three undated entries counted (garbage data with no created_at is undated too)");
ok(byKey(f1, null) && byKey(f1, null).saldo_inicial === undefined, "balance (f): the no-date group shows no balance lines");
eq(F.gmFinUndatedNoteText(1, false), "1 lançamento sem data não entra no saldo.", "note (f): PT singular");
eq(F.gmFinUndatedNoteText(3, false), "3 lançamentos sem data não entram no saldo.", "note (f): PT plural");
eq(F.gmFinUndatedNoteText(1, true), "1 entry with no date is not counted in the balance.", "note (f): EN singular");
eq(F.gmFinUndatedNoteText(2, true), "2 entries with no date are not counted in the balance.", "note (f): EN plural");

// (g) a filter that starts mid month
const g = monthsFor(base, NOCFG, "2026-10-10", "2026-10-31");
eq(byKey(g, "2026-10").saldo_inicial, F.gmFinBalanceBefore(base, NOCFG, "2026-10-10"), "balance (g): the cut-short month opens at the balance on the From date");
eq(byKey(g, "2026-10").saldo_final, byKey(g, "2026-10").saldo_inicial + byKey(g, "2026-10").resultado, "balance (g): Saldo final = Saldo inicial + the card's Resultado");
eq(byKey(g, "2026-10").saldo_inicial, 70000 + 200000, "balance (g): the Oct 1 sale is before the From date, so it is already in the opening (700.00 + 2,000.00)");
eq(byKey(g, "2026-10").saldo_final, 270000 - 15000, "balance (g): Saldo final is 2,700.00 - 150.00 = 2,550.00");

// (h) Period total
const h = monthsFor(base, NOCFG, "2026-09-01", "2026-10-31");
const hp = F.gmFinPeriodWithBalances(F.gmFinTotals(F.gmFinFilterEntries(base, "2026-09-01", "2026-10-31", false)), h);
eq(hp.saldo_final - hp.saldo_inicial, hp.resultado, "period (h): Saldo final minus Saldo inicial equals the period Resultado");
eq(hp.saldo_inicial, byKey(h, "2026-09").saldo_inicial, "period (h): Saldo inicial is the first month's");
eq(hp.saldo_final, byKey(h, "2026-10").saldo_final, "period (h): Saldo final is the last month's");
const d1p = F.gmFinPeriodWithBalances(F.gmFinTotals(F.gmFinFilterEntries(dData, "2026-09-01", "2026-11-30", false)), d1);
ok(d1p.saldo_inicial === undefined && d1p.saldo_final === undefined, "period (h): when September's entries sit before the starting month the identity cannot hold, so the Period total shows no balance lines");
const dOnly = monthsFor(dData, CFG, "2026-10-01", "2026-11-30");
const dOnlyP = F.gmFinPeriodWithBalances(F.gmFinTotals(F.gmFinFilterEntries(dData, "2026-10-01", "2026-11-30", false)), dOnly);
eq([dOnlyP.saldo_inicial, dOnlyP.saldo_final - dOnlyP.saldo_inicial === dOnlyP.resultado], [1800000, true], "period (h): with a starting balance, the identity holds from the starting month on");

// (i) cents arithmetic
const tenths = [];
for (let i = 1; i <= 10; i++) { tenths.push({ data: "2026-09-" + String(i).padStart(2, "0"), tipo: E, valor: 0.1 }); }
eq(F.gmFinBalanceBefore(tenths, NOCFG, "2026-10-01"), 100, "cents (i): ten entries of 0.10 add to exactly 1.00");
eq(F.gmFinBalanceBefore([{ data: "2026-09-01", tipo: E, valor: 0.1 }, { data: "2026-09-02", tipo: E, valor: 0.2 }], NOCFG, "2026-10-01"), 30, "cents (i): 0.1 + 0.2 is exactly 30 cents");
eq(F.gmFinBalanceBefore([{ data: "2026-09-01", tipo: E, valor: 12345678.91 }, { data: "2026-09-02", tipo: S, valor: 0.01 }], { opening_balance_cents: 9999999999, opening_balance_month: "2026-09-01" }, "2026-10-01"), 9999999999 + 1234567891 - 1, "cents (i): large values add exactly");
eq(F.gmFinCentsPlain(1800000), "18000.00", "cents (i): plain decimal of 1800000 cents");
eq(F.gmFinCentsPlain(-1205), "-12.05", "cents (i): plain decimal of a negative amount");
eq(F.gmFinCentsPlain(5), "0.05", "cents (i): plain decimal pads the cents");

// (j) the report box starts with the card's Saldo inicial
eq(F.gmFinReportOpenPrefill(base, NOCFG, "2026-10-10"), F.gmFinCentsPlain(byKey(g, "2026-10").saldo_inicial), "report (j): the opening box equals the card's Saldo inicial for the same From date");
eq(F.gmFinReportOpenPrefill(dData, CFG, "2026-10-01"), "18000.00", "report (j): with the 18,000.00 starting balance the box reads 18000.00");
eq(F.gmFinReportOpenPrefill(base, NOCFG, "2026-09-01"), "", "report (j): a zero balance leaves the box empty");
eq(F.gmFinReportOpenPrefill(dData, CFG, "2026-09-01"), "", "report (j): an unknown balance (null) leaves the box empty");
eq(F.gmFinReportOpenPrefill(base, NOCFG, ""), "", "report (j): no From date leaves the box empty");

// The starting balance card: the three states and the read-only preview
const cardNone = cards("pt", { opening_balance_available: true, opening_balance_cents: null, opening_balance_month: null }).gmFinOpeningCardHtml();
ok(cardNone.indexOf("Informe o saldo de abertura para o saldo do mês ficar certo.") > 0 && cardNone.indexOf(">Informar saldo<") > 0 && cardNone.indexOf("gm-opening-hl") > 0, "opening card: unanswered shows the highlighted ask and Informar saldo (corrected from the earlier build's plain Definir, which is now the answered-or-preview look)");
const cardSet = cards("en", CFG).gmFinOpeningCardHtml();
ok(cardSet.indexOf("$18000.00 at the start of October 2026") > 0 && cardSet.indexOf(">Change<") > 0, "opening card: a set balance shows amount, month and Change");
const cardOff = cards("en", { opening_balance_available: false }).gmFinOpeningCardHtml();
ok(cardOff.indexOf("Not available yet") > 0 && cardOff.indexOf("<button") < 0, "opening card: columns missing shows Not available yet and no button");
const cardPrev = cards("pt", CFG, true).gmFinOpeningCardHtml();
ok(cardPrev.indexOf("<button") < 0 && cardPrev.indexOf("no início de Outubro de 2026") > 0, "opening card: a staff preview is read only, no button");

// The screen code obeys the house rules (var, no arrows, no pop-ups, null checks)
const newSrc = gmSrc.slice(gmSrc.indexOf("function gmFinBalanceBefore("), gmSrc.indexOf("function gmFinInitRange()")) +
  gmSrc.slice(gmSrc.indexOf("function gmFinBalanceLineHtml("), gmSrc.indexOf("function gmRenderFinance()"));
ok(!/=>/.test(newSrc) && !/\b(const|let)\s/.test(newSrc.replace(/\/\/[^\n]*/g, "")), "house rules: no arrow functions, no const or let in the new screen code");
ok(!/\b(alert|confirm|prompt)\(/.test(newSrc), "house rules: no browser pop-ups in the new screen code");

// ───────────── worker: starting balance on gm/config (2026-11-05) ─────────────
const MIG_OB = readFileSync(new URL("../migrations/2026-11-05_gm_opening_balance.sql", import.meta.url), "utf8");
ok((MIG_OB.match(/ALTER TABLE gm_config ADD COLUMN/g) || []).length === 2 && !/DROP|CREATE|RENAME/i.test(MIG_OB), "migration: exactly two ALTER TABLE gm_config ADD COLUMN statements, no rebuild");
const MIG_SM = readFileSync(new URL("../migrations/2026-10-07_clients_staff_manage.sql", import.meta.url), "utf8");

const WNAMES = ["handlePutGmConfig", "handleGetGmConfig", "gmGetConfig", "gmOpeningBalanceAvailable", "gmOpeningBalanceParse", "gmEnsureConfigRow",
  "gmRunUpdate", "gmStr", "gmNum", "gmParseJsonList", "gmParseJsonListNonEmpty", "isAdminRole", "requireClientAccess", "previewWriteGate"];
const WVARS = ["GM_DEFAULT_FINANCE_CATEGORIES", "GM_DEFAULT_VIEW_THRESHOLD", "gmOpeningColumnsKnown", "gmOpeningColumnsCheckedAt", "PREVIEW_READONLY_MSG", "STAFF_MANAGE_BLOCKED_MSG"];
function cfgWorld(withColumns, asUser) {
  const dd = makeDb(["migrations/gm_growth_management.sql"]);
  try { dd.raw.exec(MIG_SM); } catch (e) { /* the shim table already has it */ }
  dd.raw.exec("ALTER TABLE gm_config ADD COLUMN event_types_json TEXT");
  dd.raw.exec("CREATE TABLE IF NOT EXISTS message_templates (template_key TEXT PRIMARY KEY, template_text TEXT)");
  if (withColumns) { MIG_OB.replace(/^\s*--[^\n]*$/gm, "").split(";").forEach((st) => { if (st.trim()) { dd.raw.exec(st); } }); }
  dd.raw.prepare("INSERT INTO clients (id, name, staff_manage) VALUES ('c1', 'Dipro', 0)").run();
  dd.raw.prepare("INSERT INTO clients (id, name, staff_manage) VALUES ('c2', 'Other', 0)").run();
  const WW = build(WNAMES, WVARS, Object.assign({}, baseStubs, {
    URL: globalThis.URL, authenticate: async () => asUser,
    GM_STAGES: [], GM_STAGE_DEFS: [], GM_ACTIVE_PIPELINE_STAGES: [], GM_LIVE_STAGES: [], GM_ORIGENS: [], GM_ROADMAP_STATUSES: [], GM_FRENTES: [],
    GM_BASE_OURO_STATUSES: [], GM_PARTNER_STATUSES: [], GM_JOB_STATUSES: [], DEFAULT_WHATSAPP_TEMPLATES: { partner_referral_share: "x" }
  }));
  return { dd, WW, env: { DB: dd.DB } };
}
const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "Dipro" };
const put = (w, body, id) => w.WW.handlePutGmConfig(id || "c1", req(body, "https://api.x.test/api/clients/" + (id || "c1") + "/gm/config"), w.env);
const getCfg = async (w) => (await w.WW.handleGetGmConfig("c1", req({}), w.env)).data.config;
const cfgRows = (w) => w.dd.q("SELECT * FROM gm_config");

// valid pair saves, in one UPDATE
let w = cfgWorld(true, OWNER);
let r1 = await put(w, { opening_balance_cents: 1800000, opening_balance_month: "2026-10-01" });
eq(r1.status, 200, "worker (k): a valid pair saves");
eq([r1.data.config.opening_balance_cents, r1.data.config.opening_balance_month, r1.data.config.opening_balance_available], [1800000, "2026-10-01", true], "worker (k): the answer carries the saved pair and available: true");
eq(w.dd.writes.filter((x) => /^UPDATE gm_config/.test(x[0])).length, 1, "worker (k): one UPDATE per save");
r1 = await put(w, { opening_balance_cents: -250, opening_balance_month: "2026-01-01" });
eq([r1.status, r1.data.config.opening_balance_cents], [200, -250], "worker (k): a negative balance saves");
r1 = await put(w, { opening_balance_cents: null, opening_balance_month: null });
eq([r1.status, r1.data.config.opening_balance_cents, r1.data.config.opening_balance_month], [200, null, null], "worker (k): both null clears it");

// every bad input: right 4xx, nothing written (not even the config row)
const BAD = [
  ["amount without month", { opening_balance_cents: 100 }, 400],
  ["month without amount", { opening_balance_month: "2026-10-01" }, 400],
  ["amount with null month", { opening_balance_cents: 100, opening_balance_month: null }, 400],
  ["null amount with month", { opening_balance_cents: null, opening_balance_month: "2026-10-01" }, 400],
  ["a string amount", { opening_balance_cents: "100", opening_balance_month: "2026-10-01" }, 400],
  ["a fractional cents value", { opening_balance_cents: 100.5, opening_balance_month: "2026-10-01" }, 400],
  ["a huge value", { opening_balance_cents: 10000000001, opening_balance_month: "2026-10-01" }, 400],
  ["a huge negative value", { opening_balance_cents: -10000000001, opening_balance_month: "2026-10-01" }, 400],
  ["not the first day", { opening_balance_cents: 100, opening_balance_month: "2026-10-02" }, 400],
  ["not a real month", { opening_balance_cents: 100, opening_balance_month: "2026-13-01" }, 400],
  ["month 00", { opening_balance_cents: 100, opening_balance_month: "2026-00-01" }, 400],
  ["year 1999", { opening_balance_cents: 100, opening_balance_month: "1999-12-01" }, 400],
  ["year 2101", { opening_balance_cents: 100, opening_balance_month: "2101-01-01" }, 400],
  ["a date with a time", { opening_balance_cents: 100, opening_balance_month: "2026-10-01T00:00" }, 400]
];
for (const [name, body, want] of BAD) {
  const wb = cfgWorld(true, OWNER);
  const rb = await put(wb, body);
  ok(rb.status === want && wb.dd.writes.length === 0 && cfgRows(wb).length === 0, "worker (k): " + name + " gives " + want + " and writes nothing");
}
w = cfgWorld(true, OWNER);
const r403 = await put(w, { opening_balance_cents: 100, opening_balance_month: "2026-10-01" }, "c2");
ok(r403.status === 403 && w.dd.writes.length === 0 && cfgRows(w).length === 0, "worker (k): a client without access to that business gets 403 and nothing is written");

// columns missing: 409 and no write; GET answers false
w = cfgWorld(false, OWNER);
const r409 = await put(w, { opening_balance_cents: 100, opening_balance_month: "2026-10-01" });
ok(r409.status === 409 && /Not available yet/.test(r409.error) && w.dd.writes.length === 0 && cfgRows(w).length === 0, "worker (k): columns missing gives 409 (not 500), writes nothing");
const g0 = await getCfg(w);
eq([g0.opening_balance_available, g0.opening_balance_cents, g0.opening_balance_month], [false, null, null], "worker (k): GET config without the columns: available false, nulls (no row)");
w.dd.raw.prepare("INSERT INTO gm_config (client_id) VALUES ('c1')").run();
w = Object.assign(w, {});
const g0b = await getCfg(w);
eq(g0b.opening_balance_available, false, "worker (k): GET config without the columns, row present: still false");
// a save that does not touch the balance still works before the migration
const rOther = await put(w, { vendedores: ["Ana"] });
eq(rOther.status, 200, "worker (k): other config saves keep working before the migration");

// columns present: GET answers true with and without a row, plus every old key
w = cfgWorld(true, OWNER);
const g1 = await getCfg(w);
eq([g1.opening_balance_available, g1.opening_balance_cents, g1.opening_balance_month], [true, null, null], "worker (k): GET config with the columns and no row: available true");
for (const key of ["servicos", "vendedores", "finance_categories", "partner_types", "cycle_months", "event_types", "target_margin", "target_margin_set_by", "target_margin_set_at", "pipeline_view_threshold", "pipeline_view_override"]) {
  ok(Object.prototype.hasOwnProperty.call(g1, key), "worker (k): GET config still returns " + key);
}
await put(w, { opening_balance_cents: 500, opening_balance_month: "2026-02-01" });
const g2 = await getCfg(w);
eq([g2.opening_balance_available, g2.opening_balance_cents, g2.opening_balance_month], [true, 500, "2026-02-01"], "worker (k): GET config returns the saved pair");

// a staff preview session cannot write (the router's own gate, same rule as every other write)
w = cfgWorld(true, OWNER);
const pv = await w.WW.previewWriteGate({ url: "https://x.test/api/clients/c1/gm/config?previewAs=c1" }, w.env, "/api/clients/c1/gm/config");
ok(pv && pv.status === 403 && w.dd.writes.length === 0, "worker (k): a staff preview of a client cannot write config (403)");
ok(/method !== "GET" && new URL\(request\.url\)\.searchParams\.get\("previewAs"\)\) \{\s*return jsonErr\("Preview is read-only", 403\)/.test(workerSrcText()), "worker (k): the router blocks every non-GET that carries previewAs");
function workerSrcText() { return readFileSync(new URL("../worker/index.js", import.meta.url), "utf8"); }


// ───────────── Part A follow-up: ask for the starting balance (2026-11-05) ─────────────
const UNANS = { opening_balance_available: true, opening_balance_cents: null, opening_balance_month: null };
const ZERO = { opening_balance_available: true, opening_balance_cents: 0, opening_balance_month: "2026-09-01" };

// (a) answered versus unanswered drives the highlight, the auto open and the warning line
ok(F.gmFinOpeningNeedsAnswer(UNANS, false) === true, "ask (a): unanswered is asked");
ok(F.gmFinOpeningNeedsAnswer(CFG, false) === false, "ask (a): an answered balance is not asked");
ok(F.gmFinOpeningAnswered(ZERO) === true && F.gmFinOpeningNeedsAnswer(ZERO, false) === false, "ask (d): a saved 0 is an answer, never treated as empty");
const hlCard = cards("en", UNANS).gmFinOpeningCardHtml();
ok(hlCard.indexOf("gm-opening-hl") > 0 && hlCard.indexOf("Enter your starting balance so the monthly balance is right.") > 0 && hlCard.indexOf(">Enter balance<") > 0, "ask (a): unanswered card is highlighted, English text and button");
const doneCard = cards("en", CFG).gmFinOpeningCardHtml();
ok(doneCard.indexOf("gm-opening-hl") < 0 && doneCard.indexOf(">Change<") > 0, "ask (a): answered card is not highlighted");
const zeroCard = cards("pt", ZERO).gmFinOpeningCardHtml();
ok(zeroCard.indexOf("gm-opening-hl") < 0 && zeroCard.indexOf(">Alterar<") > 0 && zeroCard.indexOf("$0.00 no início de Setembro de 2026") > 0, "ask (d): a saved 0 shows as an answered balance of $0.00");
ok(cards("pt", UNANS).gmFinUnansweredNoteHtml(UNANS).indexOf("Este saldo só conta os lançamentos do Apex. Informe o saldo de abertura para corrigir.") > 0, "ask (a): the warning line shows while unanswered (PT)");
ok(cards("en", UNANS).gmFinUnansweredNoteHtml(UNANS).indexOf("This balance only counts entries in Apex. Enter your starting balance to correct it.") > 0, "ask (a): the warning line shows while unanswered (EN)");
eq(cards("en", ZERO).gmFinUnansweredNoteHtml(ZERO), "", "ask (a): the warning line disappears once answered, even with 0");
eq(cards("en", CFG).gmFinUnansweredNoteHtml({ opening_balance_available: false }), "", "ask (c): no warning line when the columns are not available");

// (b) staff preview: no button, no highlight, never asked
const pvCard = cards("pt", UNANS, true).gmFinOpeningCardHtml();
ok(pvCard.indexOf("<button") < 0 && pvCard.indexOf("gm-opening-hl") < 0 && pvCard.indexOf("Sem saldo de abertura definido") > 0, "ask (b): a staff preview shows the card read only, no button, no highlight");
ok(F.gmFinOpeningNeedsAnswer(UNANS, true) === false, "ask (b): a staff preview is never asked");

// (c) columns missing: no button, no ask
const offUnans = { opening_balance_available: false, opening_balance_cents: null, opening_balance_month: null };
ok(F.gmFinOpeningNeedsAnswer(offUnans, false) === false && cards("pt", offUnans).gmFinOpeningCardHtml().indexOf("<button") < 0, "ask (c): columns missing gives no button and no ask");

// the auto open, with sessionStorage working, failing, and a preview / unavailable client
const autoBody = ["gmFinOpeningCfg", "gmFinOpeningAnswered", "gmFinOpeningNeedsAnswer", "gmFinIsPreview", "gmFinOpeningAutoOpen"].map(fnFromGm).join("\n");
function autoRig(cfgObj, store, preview) {
  let opened = 0;
  const maker = new Function("window", "clientId", "PREVIEW_AS", "gmFinOpeningOpen", "getConfig",
    "var gmConfig = getConfig(); var gmFinOpeningAskedMem = false;\n" + autoBody + "\nreturn gmFinOpeningAutoOpen;");
  const fn = maker({ sessionStorage: store }, "c1", preview ? "c1" : "", () => { opened++; }, () => ({ config: cfgObj }));
  return { run: fn, count: () => opened };
}
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
let rg = autoRig(UNANS, mem(), false); rg.run(); rg.run(); rg.run();
eq(rg.count(), 1, "ask (b): the sheet opens by itself once, not on every visit");
const sharedStore = mem();
rg = autoRig(UNANS, sharedStore, false); rg.run();
const rg2 = autoRig(UNANS, sharedStore, false); rg2.run();
eq([rg.count(), rg2.count()], [1, 0], "ask (b): remembered in sessionStorage, a later visit in the same session does not ask again");
const brokenStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
let g7 = null, threw7 = false;
try { g7 = autoRig(UNANS, brokenStore, false); g7.run(); g7.run(); g7.run(); } catch (e) { threw7 = true; }
ok(!threw7 && g7.count() === 1, "ask (g): sessionStorage failing neither throws nor loops, it opens once per page load");
rg = autoRig(UNANS, mem(), true); rg.run();
eq(rg.count(), 0, "ask (b): a staff preview never opens the sheet");
rg = autoRig(offUnans, mem(), false); rg.run();
eq(rg.count(), 0, "ask (c): columns missing never opens the sheet");
rg = autoRig(CFG, mem(), false); rg.run();
eq(rg.count(), 0, "ask (a): an answered client is never opened");
rg = autoRig(ZERO, mem(), false); rg.run();
eq(rg.count(), 0, "ask (d): a saved 0 counts as answered, nothing opens");

// (d) "I started from zero"
eq(F.gmFinZeroStart([{ data: "2026-09-20", tipo: E, valor: 1 }, { data: "2026-08-11", tipo: E, valor: 1 }, { data: null, created_at: null, tipo: E, valor: 1 }], "2026-11-05"), { cents: 0, month: "2026-08-01" }, "zero (d): 0 cents at the first day of the earliest dated entry's month");
eq(F.gmFinZeroStart([{ data: null, created_at: null, tipo: E, valor: 1 }], "2026-11-05"), { cents: 0, month: "2026-11-01" }, "zero (d): no dated entries means the current month");
eq(F.gmFinZeroStart([], "2026-11-05"), { cents: 0, month: "2026-11-01" }, "zero (d): no entries at all means the current month");
let wz = cfgWorld(true, OWNER);
const rz = await put(wz, { opening_balance_cents: 0, opening_balance_month: "2026-08-01" });
eq([rz.status, rz.data.config.opening_balance_cents, rz.data.config.opening_balance_month], [200, 0, "2026-08-01"], "zero (d): the Worker saves a 0 and returns 0, not null");
const gz = await getCfg(wz);
ok(gz.opening_balance_cents === 0 && F.gmFinOpeningAnswered(gz), "zero (d): the next load counts as answered");
eq(F.gmFinBalanceBefore(base, gz, "2026-09-01"), 0, "zero (d): a 0 starting balance feeds the balance math (not skipped as empty)");

// (e) today's balance
const tData = [
  { data: "2026-11-01", tipo: E, valor: 1000 }, { data: "2026-11-03", tipo: S, valor: 250.5 },
  { data: "2026-10-30", tipo: E, valor: 999 },                       // last month: not subtracted
  { data: "2026-11-20", tipo: E, valor: 5000 },                      // future: ignored
  { data: null, created_at: null, tipo: S, valor: 77 }               // undated: ignored
];
const t1 = F.gmFinTodayStart(tData, 500000, "2026-11-05");
eq(t1, { cents: 500000 - (100000 - 25050), month: "2026-11-01" }, "today (e): 5,000.00 today minus the month's net so far (1,000.00 in, 250.50 out) gives the opening of November");
eq(F.gmFinTodayStart([{ data: "2026-11-05", tipo: E, valor: 10 }], 100000, "2026-11-05").cents, 99000, "today (e): an entry dated today is included");
eq(F.gmFinTodayStart([{ data: "2026-11-06", tipo: E, valor: 10 }], 100000, "2026-11-05").cents, 100000, "today (e): an entry dated tomorrow is ignored");
eq(F.gmFinTodayStart([{ data: "2026-11-01", tipo: E, valor: 0.1 }, { data: "2026-11-02", tipo: E, valor: 0.2 }], 0, "2026-11-05").cents, -30, "today (e): 0.1 and 0.2 are exact cents");
eq(F.gmFinTodayStart([], -123456, "2026-11-05").cents, -123456, "today (e): a negative typed balance with no entries is kept as is");
{ // round trip: type today's balance, save it, then the card's Saldo final for the month is exactly the typed balance
  const typed = 1234567; const noLater = tData.filter((e) => !(e.data && e.data > "2026-11-05"));
  const res = F.gmFinTodayStart(noLater, typed, "2026-11-05");
  const cfgRound = { opening_balance_cents: res.cents, opening_balance_month: res.month };
  const mm = monthsFor(noLater, cfgRound, "2026-11-01", "2026-11-30");
  eq(byKey(mm, "2026-11").saldo_final, typed, "today (e): reading the month's Saldo final back through the card math returns exactly the typed balance");
}
ok(cards("pt", CFG).gmFinOpeningLiveText(123456, "2026-11-01") === "Saldo no início de Novembro de 2026: $1234.56", "today (e): live line, Portuguese");
ok(cards("en", CFG).gmFinOpeningLiveText(-500, "2026-11-01") === "Balance at the start of November 2026: -$5.00", "today (e): live line, English");

// the new screen code keeps the house rules
const newSrc2 = gmSrc.slice(gmSrc.indexOf("function gmFinOpeningCfg("), gmSrc.indexOf("function gmRenderFinance()"));
ok(!/=>/.test(newSrc2) && !/\b(const|let)\s/.test(newSrc2.replace(/\/\/[^\n]*/g, "")) && !/\b(alert|confirm|prompt)\(/.test(newSrc2), "house rules: the ask code has no arrows, const, let or browser pop-ups");
ok(!/type="(month|date|radio)"/.test(newSrc2), "house rules: the sheet uses no type=month, type=date or radio");

// (h) the two catalog entries
const WSRC = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const rec = /\{ key: "receita",[^\n]*\}/.exec(WSRC)[0], sai = /\{ key: "saida",[^\n]*\}/.exec(WSRC)[0];
ok(/labelPt: "Entradas \(\$\)"/.test(rec) && /labelEn: "Money In \(\$\)"/.test(rec) && /section: "financeiro"/.test(rec) && /type: "currency"/.test(rec) && !/inverse/.test(rec), "labels (h): receita carries Entradas ($) and Money In ($), same key, section and type, no inverse");
ok(/labelPt: "Saídas \(\$\)"/.test(sai) && /labelEn: "Money Out \(\$\)"/.test(sai) && /inverse: true/.test(sai) && /section: "financeiro"/.test(sai) && /type: "currency"/.test(sai), "labels (h): saida carries Saídas ($) and Money Out ($), same key, inverse still true");
const OLDWORDS = ["Receita do Dia", "Saída do Dia", "Saida do Dia", "Revenue Today", "Expenses Today"];
const { execSync } = await import("node:child_process");
const repoRoot = new URL("../", import.meta.url).pathname;
const tracked = execSync("git ls-files", { cwd: repoRoot, maxBuffer: 1 << 26 }).toString().split("\n").filter((f) => f && !/^(ios\/|www\/|build\/|node_modules\/|.claude\/)/.test(f) && /\.(js|html|json|mjs|md|css)$/.test(f) && f !== "scripts/test-gm-finance-monthly.mjs");
const leftovers = [];
for (const f of tracked) { let t = ""; try { t = readFileSync(new URL("../" + f, import.meta.url), "utf8"); } catch (e) { continue; } for (const w of OLDWORDS) { if (t.indexOf(w) >= 0) { leftovers.push(f + ": " + w); } } }
eq(leftovers, [], "labels (h): no source file still contains the old labels");
const GUIDES_TXT = readFileSync(new URL("../help/guides.json", import.meta.url), "utf8");
ok(GUIDES_TXT.indexOf("Entradas ($), Saídas ($), Lucro Líquido") > 0 && GUIDES_TXT.indexOf("Money In ($), Money Out ($), Net Profit") > 0 && GUIDES_TXT.indexOf("Para Entradas ($), as duas caixas Hoje (1) e Média por dia (2)") > 0 && GUIDES_TXT.indexOf("For Money In ($), the two boxes Today (1) and Average per day (2)") > 0, "labels (h): the two Learn steps use the new labels in both languages");

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
