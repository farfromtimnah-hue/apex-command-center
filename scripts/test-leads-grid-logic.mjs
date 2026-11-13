// Pure logic of the Pipeline spreadsheet view (2026-11-13), loaded from the
// REAL gm.js (the block between the LEADS GRID LOGIC markers), never restated.
//
//   node scripts/test-leads-grid-logic.mjs
//
// Covers: multi level sort (numbers, dates, blanks last), every filter
// operator, the checkbox filter with counts, combined AND filters, group
// subtotals, selection stats, Dias no estagio, and that every detail string
// the page can send is accepted by the Worker's own validator.
import { readFileSync } from "fs";

const gm = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i + a.length);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + (i < 0 ? a : b)); }
  return src.slice(i, j);
}
let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

const code =
  slice(gm, "function gmSearchNorm", "// Digits only") +
  slice(gm, "function gmParseMoney", "function gmNowLocalIso") +
  slice(gm, "function gmServicoList", "// requiredMsg") +
  slice(gm, "// ==== LEADS GRID LOGIC BEGIN ====", "// ==== LEADS GRID LOGIC END ====");
const G = new Function(code + `
  return { GM_GRID_COLS: GM_GRID_COLS, gmGridRaw: gmGridRaw, gmGridLabel: gmGridLabel, gmGridSortRows: gmGridSortRows,
    gmGridFilterRows: gmGridFilterRows, gmGridDistinct: gmGridDistinct, gmGridGroupRows: gmGridGroupRows,
    gmGridStats: gmGridStats, gmGridDaysInStage: gmGridDaysInStage, gmGridOpsFor: gmGridOpsFor,
    gmGridActiveFilterCount: gmGridActiveFilterCount, gmGridDetail: gmGridDetail };`)();

const NOW = Date.UTC(2026, 10, 13, 15, 0, 0);
const ctx = {
  nowMs: NOW,
  stageLabel: (k) => ({ novo_lead: "Novo lead", estimate_enviado: "Estimate enviado", negociacao: "Negociação", fechado: "Fechado", perdido: "Perdido" })[k] || k,
  statusLabel: (v) => v,
  monthLabel: (k) => k,
  fmtMoney: (n) => "$" + n.toFixed(2),
  fmtDay: (ms) => new Date(ms).toISOString().slice(0, 10),
  fmtDateTime: (v) => String(v),
  fmtDateTimeUtc: (v) => String(v),
  fmtPhone: (v) => String(v)
};
const L = (id, o) => Object.assign({ id, cliente: "C" + id, estagio: "novo_lead", valor: null, vendedor: "", origem: "", servico: "",
  data_lead: null, data_estimate: null, data_contato: null, primeiro_contato: null, contatos_count: 0, stage_changed_at: null,
  proxima_acao: "", observacao: "", parceiro_name: null, mes_fechamento: "", created_at: "2026-10-01 10:00:00" }, o || {});
const ms = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
const leads = [
  L("1", { cliente: "Zélia Souza",  valor: 5000,  estagio: "negociacao", vendedor: "Ana", data_lead: "2026-10-05T09:30", contatos_count: 3 }),
  L("2", { cliente: "ana maria",    valor: 12000, estagio: "fechado",    vendedor: "Ana", data_lead: "2026-10-20T14:00", contatos_count: 1, mes_fechamento: "Outubro" }),
  L("3", { cliente: "Bruno Lima",   valor: null,  estagio: "novo_lead",  vendedor: "",    data_lead: null, observacao: "ligar sexta" }),
  L("4", { cliente: "Carlos Pires", valor: 800,   estagio: "negociacao", vendedor: "Beto", data_lead: "2026-09-02T08:00", contatos_count: 0 }),
  L("5", { cliente: "Ângela Reis",  valor: 12000, estagio: "perdido",    vendedor: "Beto", data_lead: "2026-10-20T09:00", contatos_count: 2 }),
  L("6", { cliente: "Débora Cruz",  valor: 0,     estagio: "novo_lead",  vendedor: "Ana", data_lead: "2026-11-01T10:00" })
];
const raw = (l, k) => G.gmGridRaw(l, k, ctx);
const ids = (rows) => rows.map(r => r.id).join(",");

// ── Dias no estagio ───────────────────────────────────────────────────────
t("days in stage: 3 full days", G.gmGridDaysInStage("2026-11-10 14:00:00", NOW), 3);
t("days in stage: under one day is 0", G.gmGridDaysInStage("2026-11-13 10:00:00", NOW), 0);
t("days in stage: a future stamp is never negative", G.gmGridDaysInStage("2026-11-20 10:00:00", NOW), 0);
t("days in stage: no stamp is blank", G.gmGridDaysInStage(null, NOW), null);
t("days in stage: junk is blank", G.gmGridDaysInStage("not a date", NOW), null);
t("column dias_estagio reads stage_changed_at", raw(L("9", { stage_changed_at: "2026-11-01 15:00:00" }), "dias_estagio"), 12);

// ── Column values ─────────────────────────────────────────────────────────
t("the columns are the 17 asked for, in order", G.GM_GRID_COLS.map(c => c.key), [
  "cliente", "telefone", "origem", "parceiro", "servico", "vendedor", "estagio", "valor", "data_lead", "data_contato",
  "data_estimate", "followups", "proxima_acao", "mes_lead", "mes_fechamento", "dias_estagio", "observacao"]);
t("valor is a number column", G.GM_GRID_COLS.find(c => c.key === "valor").type, "num");
t("data_lead is a date column", G.GM_GRID_COLS.find(c => c.key === "data_lead").type, "date");
t("followups reads contatos_count", raw(leads[0], "followups"), 3);
t("month of the lead comes from the lead date", raw(leads[3], "mes_lead"), "2026-09");
t("month of the lead falls back to created_at", raw(leads[2], "mes_lead"), "2026-10");
t("estagio label is the Pipeline label", G.gmGridLabel(leads[0], "estagio", ctx), "Negociação");
t("valor label is dollars", G.gmGridLabel(leads[0], "valor", ctx), "$5000.00");
t("a blank valor has an empty label", G.gmGridLabel(leads[2], "valor", ctx), "");
t("a zero valor is NOT blank", G.gmGridLabel(leads[5], "valor", ctx), "$0.00");
t("first contact prefers the logged one (UTC)", raw(L("7", { primeiro_contato: "2026-11-02 12:00:00", data_contato: "2026-10-01T09:00" }), "data_contato"), Date.UTC(2026, 10, 2, 12, 0, 0));
t("first contact falls back to the typed local date", raw(L("8", { data_contato: "2026-10-01T09:00" }), "data_contato"), ms(2026, 10, 1, 9, 0));

// ── Sort ──────────────────────────────────────────────────────────────────
t("sort valor ascending: blanks last", ids(G.gmGridSortRows(leads, [{ key: "valor", dir: "asc" }], ctx)), "6,4,1,2,5,3");
t("sort valor descending: blanks STILL last", ids(G.gmGridSortRows(leads, [{ key: "valor", dir: "desc" }], ctx)), "2,5,1,4,6,3");
t("sort date ascending: blank last", ids(G.gmGridSortRows(leads, [{ key: "data_lead", dir: "asc" }], ctx)), "4,1,5,2,6,3");
t("sort date descending: blank last", ids(G.gmGridSortRows(leads, [{ key: "data_lead", dir: "desc" }], ctx)), "6,2,5,1,4,3");
t("sort text ignores case and accents", ids(G.gmGridSortRows(leads, [{ key: "cliente", dir: "asc" }], ctx)), "2,5,3,4,6,1");
t("sort text blanks last (vendedor)", ids(G.gmGridSortRows(leads, [{ key: "vendedor", dir: "asc" }], ctx)).slice(-1), "3");
t("two levels: vendedor asc then valor desc", ids(G.gmGridSortRows(leads, [{ key: "vendedor", dir: "asc" }, { key: "valor", dir: "desc" }], ctx)), "2,1,6,5,4,3");
t("equal keys keep the original order (stable)", ids(G.gmGridSortRows(leads, [{ key: "valor", dir: "desc" }], ctx)).split(",").slice(0, 3).join(","), "2,5,1");
t("no sorts returns the same order", ids(G.gmGridSortRows(leads, [], ctx)), "1,2,3,4,5,6");
t("sorting does not change the input array", (() => { const c = leads.slice(); G.gmGridSortRows(c, [{ key: "valor", dir: "asc" }], ctx); return ids(c); })(), "1,2,3,4,5,6");

// ── Filter operators ──────────────────────────────────────────────────────
const F = (filters) => ids(G.gmGridFilterRows(leads, filters, ctx));
t("num gt", F({ valor: { op: "gt", v1: "5000" } }), "2,5");
t("num lt", F({ valor: { op: "lt", v1: "5000" } }), "4,6");
t("num eq", F({ valor: { op: "eq", v1: "12000" } }), "2,5");
t("num between is inclusive", F({ valor: { op: "between", v1: "800", v2: "5000" } }), "1,4");
t("num blank", F({ valor: { op: "blank" } }), "3");
t("num not_blank keeps the zero", F({ valor: { op: "not_blank" } }), "1,2,4,5,6");
t("num accepts a comma decimal like the lead card", F({ valor: { op: "gt", v1: "4.999,99" } }), "1,2,5");
t("num with an unreadable value does not filter", F({ valor: { op: "gt", v1: "abc" } }), "1,2,3,4,5,6");
t("date gt (after the day)", F({ data_lead: { op: "gt", v1: "2026-10-20" } }), "6");
t("date lt (before the day)", F({ data_lead: { op: "lt", v1: "2026-10-05" } }), "4");
t("date eq matches the whole local day", F({ data_lead: { op: "eq", v1: "2026-10-20" } }), "2,5");
t("date between is inclusive of both days", F({ data_lead: { op: "between", v1: "2026-10-05", v2: "2026-10-20" } }), "1,2,5");
t("date blank", F({ data_lead: { op: "blank" } }), "3");
t("date not_blank", F({ data_lead: { op: "not_blank" } }), "1,2,4,5,6");
t("text contains ignores case and accents", F({ cliente: { op: "contains", v1: "angela" } }), "5");
t("text contains finds case differences", F({ cliente: { op: "contains", v1: "ANA" } }), "2");
t("text not_contains", F({ cliente: { op: "not_contains", v1: "a" } }), "");
t("text not_contains (narrower)", F({ cliente: { op: "not_contains", v1: "ana" } }), "1,3,4,5,6");
t("text begins", F({ cliente: { op: "begins", v1: "c" } }), "4");
t("text blank", F({ vendedor: { op: "blank" } }), "3");
t("an empty condition value does not filter", F({ cliente: { op: "contains", v1: "" } }), "1,2,3,4,5,6");
t("ops for text", G.gmGridOpsFor("text"), ["contains", "not_contains", "begins", "blank"]);
t("ops for numbers", G.gmGridOpsFor("num"), ["gt", "lt", "between", "eq", "blank", "not_blank"]);
t("ops for dates", G.gmGridOpsFor("date"), ["gt", "lt", "between", "eq", "blank", "not_blank"]);

// ── Checkbox filter, counts, AND ──────────────────────────────────────────
t("checkbox filter keeps ticked labels", F({ vendedor: { checked: ["Ana"] } }), "1,2,6");
t("checkbox filter can tick the blank value", F({ vendedor: { checked: [""] } }), "3");
t("checkbox filter with nothing ticked shows nothing", F({ vendedor: { checked: [] } }), "");
t("checkbox null means everything", F({ vendedor: { checked: null } }), "1,2,3,4,5,6");
t("checkbox on a stage uses the visible label", F({ estagio: { checked: ["Negociação"] } }), "1,4");
t("two columns combine with AND", F({ vendedor: { checked: ["Ana"] }, valor: { op: "gt", v1: "1000" } }), "1,2");
t("checkbox and condition on ONE column both apply", F({ valor: { checked: ["$12000.00", "$5000.00"], op: "gt", v1: "6000" } }), "2,5");
t("three columns combine with AND", F({ vendedor: { checked: ["Ana"] }, estagio: { checked: ["Negociação", "Fechado"] }, valor: { op: "lt", v1: "9999" } }), "1");

const d = G.gmGridDistinct(leads, "vendedor", ctx, {});
t("distinct values with counts, the blank value last", d.map(x => x.label + ":" + x.count), ["Ana:3", "Beto:2", ":1"]);
const d2 = G.gmGridDistinct(leads, "vendedor", ctx, { estagio: { checked: ["Negociação"] } });
t("counts follow the OTHER columns' filters", d2.map(x => x.label + ":" + x.count), ["Ana:1", "Beto:1"]);
const d3 = G.gmGridDistinct(leads, "vendedor", ctx, { vendedor: { checked: ["Ana"] } });
t("counts ignore the column's own filter (so it can be widened)", d3.map(x => x.label + ":" + x.count), ["Ana:3", "Beto:2", ":1"]);
t("distinct numbers sort numerically", G.gmGridDistinct(leads, "valor", ctx, {}).map(x => x.label), ["$0.00", "$800.00", "$5000.00", "$12000.00", ""]);
t("active filter count counts a column once", G.gmGridActiveFilterCount({ valor: { op: "gt", v1: "1" }, vendedor: { checked: ["Ana"] }, cliente: { checked: null, op: "" } }), 2);
t("an empty condition op is not an active filter", G.gmGridActiveFilterCount({ cliente: { checked: null, op: "contains", v1: "" } }), 0);

// ── Group subtotals ───────────────────────────────────────────────────────
const g = G.gmGridGroupRows(leads, "vendedor", ctx);
t("groups: label, count and valor subtotal", g.map(x => [x.label, x.count, x.sum]), [["Ana", 3, 17000], ["Beto", 2, 12800], ["", 1, 0]]);
t("groups keep each group's rows", g[0].rows.map(r => r.id).join(","), "1,2,6");
t("groups by stage use the visible label, sorted like a column", G.gmGridGroupRows(leads, "estagio", ctx).map(x => x.label), ["Fechado", "Negociação", "Novo lead", "Perdido"]);
t("a blank valor adds nothing to a subtotal", G.gmGridGroupRows([L("a", { vendedor: "X", valor: null }), L("b", { vendedor: "X", valor: 10 })], "vendedor", ctx)[0].sum, 10);

// ── Selection stats ───────────────────────────────────────────────────────
t("stats: count, sum, average", G.gmGridStats([10, 20, 30]), { count: 3, sum: 60, avg: 20 });
t("stats ignore blanks", G.gmGridStats([10, null, "", 30]), { count: 2, sum: 40, avg: 20 });
t("stats count a zero", G.gmGridStats([0, 10]), { count: 2, sum: 10, avg: 5 });
t("stats on nothing", G.gmGridStats([]), { count: 0, sum: 0, avg: null });
t("stats round to cents", G.gmGridStats([0.1, 0.2]).sum, 0.3);

// ── The details the page sends are accepted by the Worker's validator ─────
const wsrc = slice(worker, "// ==== LEADS GRID EVENTS BEGIN ====", "// ==== LEADS GRID EVENTS END ====");
const clean = new Function(wsrc + "\nreturn gridCleanEvent;")();
const sample = [
  ["sort_set", "valor", G.gmGridDetail.sort("asc", 1)], ["sort_set", "valor", G.gmGridDetail.sort("desc", 2)],
  ["filter_set", "origem", G.gmGridDetail.values(3)], ["filter_set", "valor", G.gmGridDetail.op("between")],
  ["filter_set", "cliente", G.gmGridDetail.op("not_contains")], ["filter_set", "cliente", G.gmGridDetail.op("blank")],
  ["filters_cleared_all", "", G.gmGridDetail.count(4)], ["column_resized", "cliente", G.gmGridDetail.width(180)],
  ["column_moved", "valor", G.gmGridDetail.pos(3)], ["search_used", "", G.gmGridDetail.len(6)],
  ["selection_stats_used", "valor", G.gmGridDetail.count(5)], ["lead_opened", "", G.gmGridDetail.how("key")],
  ["lead_opened", "", G.gmGridDetail.how("mouse")], ["edit_mode_on", "", G.gmGridDetail.how("button")],
  ["edit_mode_auto_off", "", G.gmGridDetail.how("idle")], ["edit_mode_auto_off", "", G.gmGridDetail.how("leave")],
  ["cell_saved", "valor", G.gmGridDetail.OK], ["cell_refused", "valor", G.gmGridDetail.REFUSED],
  ["view_opened", "", G.gmGridDetail.how("grid")], ["view_closed", "", G.gmGridDetail.how("pagehide")],
  ["switched_to_stacked", "", ""], ["copy_blocked", "", ""], ["print_blocked", "", G.gmGridDetail.how("key")]
];
sample.forEach(([action, col, detail]) => {
  const e = { action, mode: "read", column_key: col, detail, session_ref: "s-1", device_id: "d-1" };
  if (action === "cell_saved" || action === "cell_refused" || action === "lead_opened") { e.lead_id = "lead-1"; }
  t("worker accepts page detail " + action + " '" + detail + "'", !!clean(e), true);
});
t("a detail built from typed text would be refused (search text)", !!clean({ action: "search_used", mode: "read", detail: "silva", session_ref: "s", device_id: "d" }), false);

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
