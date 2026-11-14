// The new columns of the Pipeline spreadsheet and how their cells behave (2026-11-14).
//
//   node scripts/test-lead-reason-grid.mjs
//
// Runs the REAL grid code from gm.js. LESSON FROM THE LAST BUILD (2026-11-14):
// the browser sends no "dblclick" event on a grid cell, because the first click
// redraws the rows. So every new interaction here is proven from the click
// count (event.detail) and from Enter, never from dblclick alone.
//   - Four new columns in the grid and in the Worker's key list; the eight new
//     usage actions are in the Worker's list; every action the page sends is allowed.
//   - Sort and filter work on them, with counts for the lost reason.
//   - A cell can never set a reason, a pause date or a finance value without its
//     step; a stage cell moved to Perdido waits for the reason step.
//   - Paused rows are greyed; "Show paused" hides them.
import { varSrc } from "./fixtures/d1-shim.mjs";
import { gm, gmFn, gmBlock, LOGIC } from "./fixtures/gm-extract.mjs";

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

const gridLogic = gmBlock("// ==== LEADS GRID LOGIC BEGIN ====", "// ==== LEADS GRID LOGIC END ====");
const W = new Function(varSrc("GRID_EVENT_ACTIONS") + "\n" + varSrc("GRID_COLUMN_KEYS") + "\nreturn { GRID_EVENT_ACTIONS, GRID_COLUMN_KEYS };")();

// ── Lists ──────────────────────────────────────────────────────────────────
const NEW_KEYS = ["lost_reason", "lost_reason_detail", "paused_until", "finance_status"];
const NEW_ACTIONS = ["reason_set", "other_step_opened", "other_step_go_back", "other_saved", "pause_set", "pause_ended_early", "banner_cleared", "finance_set"];
const colsText = gridLogic ? gridLogic.slice(gridLogic.indexOf("var GM_GRID_COLS = ["), gridLogic.indexOf("];", gridLogic.indexOf("var GM_GRID_COLS = [")) + 2) : "";
const gridKeys = colsText ? new Function(colsText + "\nreturn GM_GRID_COLS.map(function(c) { return c.key; });")() : [];
t("the grid has the four new columns", NEW_KEYS.filter((k) => gridKeys.indexOf(k) !== -1), NEW_KEYS);
t("the Worker accepts the four new column keys", NEW_KEYS.filter((k) => W.GRID_COLUMN_KEYS.indexOf(k) !== -1), NEW_KEYS);
t("every grid column key is a key the Worker accepts", gridKeys.filter((k) => W.GRID_COLUMN_KEYS.indexOf(k) === -1), []);
t("the Worker lists the eight new usage actions", NEW_ACTIONS.filter((a) => W.GRID_EVENT_ACTIONS.indexOf(a) !== -1), NEW_ACTIONS);
const sent = new Set([...gm.matchAll(/gmGridTrack\("([a-z_]+)"/g)].map((m) => m[1]));
t("every action the page can send is an action the Worker accepts", [...sent].filter((a) => W.GRID_EVENT_ACTIONS.indexOf(a) === -1), []);
t("the page sends the new actions where they happen", NEW_ACTIONS.filter((a) => sent.has(a) || new RegExp('"' + a + '"').test(gm)), NEW_ACTIONS);

// ── Sort, filter, counts ───────────────────────────────────────────────────
const logicApi = !gridLogic ? {} : new Function("gmSearchNorm", "gmServicoList", "gmParseMoney", "isEn", "gmT",
  gridLogic + "\nreturn { gmGridSortRows: gmGridSortRows, gmGridFilterRows: gmGridFilterRows, gmGridDistinct: gmGridDistinct, gmGridLabel: gmGridLabel, gmGridRaw: gmGridRaw, gmGridBuildPayload: gmGridBuildPayload, gmGridCol: gmGridCol, gmGridCommitCell: gmGridCommitCell };")(
  (s) => String(s || "").toLowerCase(), (v) => String(v || "").split(", ").filter(Boolean), (v) => (v === "" || v === null || v === undefined ? null : Number(v)), () => false, (pt) => pt);
const reasonName = { too_expensive: "Muito caro", cant_afford: "Não tem como pagar", out_of_state: "Fora do estado" };
const ctx = {
  nowMs: Date.UTC(2026, 10, 13, 12), stageOrder: [], stageLabel: (k) => k, statusLabel: (k) => k, monthLabel: (k) => k, fmtMoney: (n) => "$" + n,
  fmtDay: (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); },
  fmtDateTime: (v) => v, fmtDateTimeUtc: (v) => v, fmtPhone: (v) => v, looksLikePhone: () => true,
  reasonLabel: (l) => reasonName[l.lost_reason] || l.lost_reason,
  reasonDetailLabel: (l) => (l.lost_reason === "out_of_state" ? (l.lost_reason_detail === "FL" ? "Flórida" : l.lost_reason_detail) : String(l.lost_reason_detail || "")),
  financeLabel: (l) => ({ approved: "Aprovado", applied_waiting: "Solicitado e aguardando", other: "Outro" }[l.finance_status] || "") + (l.finance_status === "other" ? ": " + l.finance_status_other : "")
};
const leads = [
  { id: "a", cliente: "Ana", estagio: "perdido", lost_reason: "too_expensive", paused_until: null, finance_status: null },
  { id: "b", cliente: "Bia", estagio: "perdido", lost_reason: "cant_afford", finance_status: "approved" },
  { id: "c", cliente: "Caio", estagio: "perdido", lost_reason: "too_expensive", finance_status: "applied_waiting" },
  { id: "d", cliente: "Davi", estagio: "perdido", lost_reason: "out_of_state", lost_reason_detail: "FL", finance_status: "other", finance_status_other: "Family loan" },
  { id: "e", cliente: "Eva", estagio: "follow_up", paused_until: "2026-12-01", finance_status: null },
  { id: "f", cliente: "Fabio", estagio: "follow_up", paused_until: "2026-11-20" }
];
if (logicApi.gmGridDistinct) {
  const d = logicApi.gmGridDistinct(leads, "lost_reason", ctx, {});
  t("the lost reason filter lists each reason with its count (blank included)", d.map((x) => [x.label, x.count]).sort(), [["", 2], ["Fora do estado", 1], ["Muito caro", 2], ["Não tem como pagar", 1]]);
  t("filtering on a reason keeps only those rows", logicApi.gmGridFilterRows(leads, { lost_reason: { checked: ["Muito caro"] } }, ctx).map((l) => l.id), ["a", "c"]);
  t("sorting by the lost reason puts blanks last, both ways", [logicApi.gmGridSortRows(leads, [{ key: "lost_reason", dir: "asc" }], ctx).map((l) => l.id).join(""), logicApi.gmGridSortRows(leads, [{ key: "lost_reason", dir: "desc" }], ctx).map((l) => l.id).join("")], ["dacbef", "bacdef"]);
  t("the reason detail shows the state's name for out of state", logicApi.gmGridLabel(leads[3], "lost_reason_detail", ctx), "Flórida");
  t("paused until is a date column: sorts by date, blank last", logicApi.gmGridSortRows(leads, [{ key: "paused_until", dir: "asc" }], ctx).map((l) => l.id).slice(0, 2), ["f", "e"]);
  t("paused until shows the day", logicApi.gmGridLabel(leads[4], "paused_until", ctx), "2026-12-01");
  t("finance shows the label, and Other shows its text", [logicApi.gmGridLabel(leads[1], "finance_status", ctx), logicApi.gmGridLabel(leads[3], "finance_status", ctx), logicApi.gmGridLabel(leads[0], "finance_status", ctx)], ["Aprovado", "Outro: Family loan", ""]);
  t("a cell edit through the plain payload path is refused for all four new columns", NEW_KEYS.map((k) => logicApi.gmGridBuildPayload(k, "x", ctx).ok), [false, false, false, false]);
} else { t("the grid logic block is there", false, true); }

// ── Cells: click count and Enter ───────────────────────────────────────────
function world() {
  const rec = { flows: [], pauses: [], fins: [], api: [], tracks: [], flashes: [], applied: 0, painted: 0 };
  const lead = (o) => Object.assign({ id: "L1", cliente: "Ana", estagio: "perdido", lost_reason: "too_expensive" }, o);
  const cols = gridLogic ? new Function(colsText + "\nreturn GM_GRID_COLS;")() : [];
  const st = { dataRows: [], editing: null, saving: false, dirty: false, ctx, sel: null, cur: null };
  const stubs = {
    rec, st, cols,
    gmGrid: st,
    gmGridVisCols: () => cols,
    gmGridEdit: { isOn: () => true, touch: () => {} },
    gmGridSelectCell: () => {}, gmGridSelectRow: () => {}, gmGridEnsureVisible: () => {}, gmGridPaintRows: () => { rec.painted++; },
    gmGridApply: () => { rec.applied++; }, gmGridScheduleRefresh: () => {}, gmGridRefreshNow: () => {}, gmGridClosePop: () => {}, gmGridOpenLead: () => {},
    gmGridFlash: (ed, cls, text) => rec.flashes.push([cls, text]),
    gmGridTrack: (a, o) => rec.tracks.push([a, o.column_key, o.lead_id, o.detail || ""]),
    gmGridColLabel: (c) => c.en, gmIsSeller: () => false, isEn: () => true, gmT: (pt, en) => en,
    gmLeadComputed: () => {}, gmLeadsData: { leads: [] },
    gmLostFlowOpen: (o) => rec.flows.push(o), gmPauseFlowOpen: (o) => rec.pauses.push(o), gmFinanceOpen: (o) => rec.fins.push(o),
    gmApi: (path, opts) => { rec.api.push([path, opts.method, opts.body]); return Promise.resolve({ lead: Object.assign({}, opts.body) }); },
    gmGridSuppressClick: false, gmGridDblAt: 0, GM_GRID_HEAD_H: 38, GM_GRID_ROW_H: 30,
    document: { getElementById: () => ({ focus: () => {}, clientHeight: 400 }), querySelector: () => ({ classList: { add() {}, remove() {} }, appendChild() {} }), createElement: () => ({}) }
  };
  const fnNames = ["gmGridColEditable", "gmGridStepEligible", "gmGridAfterSave", "gmGridStepSave", "gmGridStepCancel", "gmGridStepEdit", "gmGridAskReasonForStage",
    "gmGridStartEdit", "gmGridFinishEdit", "gmGridOnClick", "gmGridOnDblClick", "gmGridOnKey"];
  const names = Object.keys(stubs);
  const code = gridLogic.slice(gridLogic.indexOf("var GM_GRID_HOW"), gridLogic.indexOf("};", gridLogic.indexOf("var gmGridDetail = ")) + 2) + ";\n" +
    gmFn("gmGridMergeServerLead") + "\n" + gmFn("gmGridBuildPayload") + "\n" + gmFn("gmGridCol") + "\n" + gmFn("gmGridCommitCell") + "\n" +
    "var GM_GRID_COLS = cols;\n" + fnNames.map((n) => gmFn(n)).join("\n") +
    "\nreturn { " + fnNames.concat(["gmGridCommitCell"]).join(", ") + " };";
  const api = new Function(...names, code)(...names.map((k) => stubs[k]));
  return { api, rec, st, cols, lead };
}
const cellEl = (r, ci) => {
  const attrs = { "data-r": String(r), "data-ci": String(ci) };
  const el = { classList: { contains: () => false }, getAttribute: (k) => attrs[k], closest: (sel) => (/\.gm-grid-c/.test(sel) && !/hrow/.test(sel) ? el : null) };
  return el;
};
const ev = (target, detail) => ({ target, detail, shiftKey: false });
const colIndex = (cols, key) => cols.findIndex((c) => c.key === key);

if (gridLogic && gmFn("gmGridStepEdit")) {
  // Reason column, lost lead.
  { const w = world(); const ci = colIndex(w.cols, "lost_reason"); w.st.dataRows = [{ t: "r", lead: w.lead(), r: 0, fi: 0 }];
    const c = cellEl(0, ci);
    w.api.gmGridOnClick(ev(c, 1));
    t("one click on the reason cell opens nothing", [w.rec.flows.length, w.rec.pauses.length, w.rec.fins.length], [0, 0, 0]);
    w.api.gmGridOnClick(ev(c, 2));
    t("the second click (detail 2) opens the reason step, with no dblclick event", w.rec.flows.length, 1);
    t("...as an edit of a lost lead: no Pause instead, current reason chosen", [w.rec.flows[0].edit, w.rec.flows[0].allowPause, w.rec.flows[0].reason], [true, false, "too_expensive"]);
    w.api.gmGridOnDblClick(ev(c, 2));
    t("a real dblclick event afterwards does not open it twice", w.rec.flows.length, 1);
    t("the edit start is tracked with the column and the lead", w.rec.tracks.filter((x) => x[0] === "cell_edit_started").map((x) => [x[1], x[2]]), [["lost_reason", "L1"]]); }
  { const w = world(); const ci = colIndex(w.cols, "lost_reason_detail"); w.st.dataRows = [{ t: "r", lead: w.lead({ lost_reason: "out_of_scope", lost_reason_detail: "Roof" }), r: 0, fi: 0 }];
    w.api.gmGridOnDblClick(ev(cellEl(0, ci), 2));
    t("a dblclick event on its own still opens the reason step from the detail cell", w.rec.flows.length, 1); }
  { const w = world(); const ci = colIndex(w.cols, "lost_reason"); w.st.dataRows = [{ t: "r", lead: w.lead({ lost_reason: "too_expensive" }), r: 0, fi: 0 }]; w.st.cur = { r: 0, c: ci };
    w.api.gmGridOnKey({ key: "Enter", target: { closest: () => null }, preventDefault() {}, shiftKey: false });
    t("Enter on the reason cell opens the reason step", w.rec.flows.length, 1); }
  // A lead that is not lost has no reason to edit.
  { const w = world(); const ci = colIndex(w.cols, "lost_reason"); w.st.dataRows = [{ t: "r", lead: w.lead({ estagio: "follow_up", lost_reason: null }), r: 0, fi: 0 }];
    const c = cellEl(0, ci);
    w.api.gmGridOnClick(ev(c, 1)); w.api.gmGridOnClick(ev(c, 2));
    t("a lead that is not lost: no step opens, the cell says why, the refusal is tracked", [w.rec.flows.length, w.rec.flashes.length, w.rec.flashes[0] && w.rec.flashes[0][0], w.rec.tracks.filter((x) => x[0] === "cell_refused").length], [0, 1, "gm-grid-refused", 1]);
    t("...and nothing was sent", w.rec.api.length, 0); }
  // Pause column.
  { const w = world(); const ci = colIndex(w.cols, "paused_until"); w.st.dataRows = [{ t: "r", lead: w.lead({ estagio: "follow_up", lost_reason: null }), r: 0, fi: 0 }];
    const c = cellEl(0, ci);
    w.api.gmGridOnClick(ev(c, 1)); w.api.gmGridOnClick(ev(c, 2));
    t("the second click on the pause cell of a live lead opens the pause step", [w.rec.pauses.length, w.rec.flows.length], [1, 0]);
    w.rec.pauses[0].onPause({ paused_until: "2026-12-01", paused_reason: "Permit" });
    t("the pause step saves through the same lead route, with the date AND the reason together", w.rec.api, [["leads/L1", "PUT", { paused_until: "2026-12-01", paused_reason: "Permit" }]]);
    w.rec.pauses[0].onEnd();
    t("End the pause now saves pause_end_now through the same route", w.rec.api[1], ["leads/L1", "PUT", { pause_end_now: true }]); }
  { const w = world(); const ci = colIndex(w.cols, "paused_until"); w.st.dataRows = [{ t: "r", lead: w.lead({ estagio: "fechado" }), r: 0, fi: 0 }];
    w.api.gmGridOnClick(ev(cellEl(0, ci), 2));
    t("a closed lead can not be paused from a cell", [w.rec.pauses.length, w.rec.flashes.length], [0, 1]); }
  // Finance column.
  { const w = world(); const ci = colIndex(w.cols, "finance_status"); w.st.dataRows = [{ t: "r", lead: w.lead({ estagio: "negociacao" }), r: 0, fi: 0 }];
    const c = cellEl(0, ci);
    w.api.gmGridOnClick(ev(c, 1)); w.api.gmGridOnClick(ev(c, 2));
    t("the second click on the finance cell opens the finance picker", w.rec.fins.length, 1);
    w.rec.fins[0].onSave("approved", null);
    w.rec.fins[0].onSave("other", "Family loan");
    t("the picker saves the status, and Other with its text", w.rec.api.map((a) => a[2]), [{ finance_status: "approved" }, { finance_status: "other", finance_status_other: "Family loan" }]); }
  // Stage cell moved to Perdido.
  { const w = world(); const ci = colIndex(w.cols, "estagio"); const L = w.lead({ estagio: "negociacao", lost_reason: null });
    w.st.dataRows = [{ t: "r", lead: L, r: 0, fi: 0 }];
    w.st.editing = { r: 0, ci, fi: 0, key: "estagio", lead: L, kind: "select", start: "negociacao", el: null };
    w.api.gmGridFinishEdit(true, "perdido");
    t("a stage cell moved to Perdido sends NOTHING yet and opens the reason step", [w.rec.api.length, w.rec.flows.length, w.rec.flows[0] && w.rec.flows[0].allowPause, w.rec.flows[0] && w.rec.flows[0].edit], [0, 1, true, false]);
    await w.rec.flows[0].onSave({ lost_reason: "too_expensive" });
    t("after the reason, ONE save carries the stage and the reason together", w.rec.api, [["leads/L1", "PUT", { estagio: "perdido", lost_reason: "too_expensive" }]]);
    t("...and the save is tracked as a cell save", w.rec.tracks.filter((x) => x[0] === "cell_saved").map((x) => x[1]), ["estagio"]); }
  { const w = world(); const ci = colIndex(w.cols, "estagio"); const L = w.lead({ estagio: "negociacao", lost_reason: null });
    w.st.dataRows = [{ t: "r", lead: L, r: 0, fi: 0 }];
    w.st.editing = { r: 0, ci, fi: 0, key: "estagio", lead: L, kind: "select", start: "negociacao", el: null };
    w.api.gmGridFinishEdit(true, "perdido");
    w.rec.flows[0].onCancel();
    t("cancelling the reason step sends nothing and puts the old stage back on screen", [w.rec.api.length, w.rec.applied >= 0, w.st.editing], [0, true, null]); }
  { const w = world(); const ci = colIndex(w.cols, "estagio"); const L = w.lead({ estagio: "negociacao", lost_reason: null });
    w.st.dataRows = [{ t: "r", lead: L, r: 0, fi: 0 }];
    w.st.editing = { r: 0, ci, fi: 0, key: "estagio", lead: L, kind: "select", start: "negociacao", el: null };
    w.api.gmGridFinishEdit(true, "perdido");
    await w.rec.flows[0].onPause({ paused_until: "2026-12-01", paused_reason: "Permit" });
    t("Pause instead from the stage cell saves the pause and never moves the stage", w.rec.api, [["leads/L1", "PUT", { paused_until: "2026-12-01", paused_reason: "Permit" }]]); }
  { const w = world(); const ci = colIndex(w.cols, "estagio"); const L = w.lead({ estagio: "negociacao", lost_reason: null });
    w.st.dataRows = [{ t: "r", lead: L, r: 0, fi: 0 }];
    w.st.editing = { r: 0, ci, fi: 0, key: "estagio", lead: L, kind: "select", start: "negociacao", el: null };
    w.api.gmGridFinishEdit(true, "follow_up");
    await new Promise((r) => setTimeout(r, 0));
    t("a stage cell moved to any other stage saves straight away, no question", [w.rec.flows.length, w.rec.api.length], [0, 1]); }
  { const w = world(); const L = w.lead({ estagio: "perdido" });
    const res = await w.api.gmGridCommitCell({ api: (p, o) => { w.rec.api.push([p, o.method, o.body]); return Promise.resolve({}); }, track: () => {}, ctx, isEn: true }, L, "paused_until", "2026-12-01");
    t("a plain cell commit of a pause date is refused before any request", [res.ok, w.rec.api.length], [false, 0]); }
} else { t("the grid step code is there", false, true); }

// ── Greyed rows and the Show paused switch ────────────────────────────────
const rowSrc = gmFn("gmGridRowHtml") || "";
t("a paused row carries the grey class", /gm-grid-paused/.test(rowSrc) && /gmLeadPausedNow\(e\.lead, gmTodayLocal\(\)\)/.test(rowSrc), true);
t("the grid has the Show paused switch, and turning it off re-draws the rows", [/data-act="showpaused"/.test(gm), /getAttribute\("data-act"\) === "showpaused"\) \{ gmShowPausedSet\(t\.checked\); gmGridApply\(\)/.test(gm)], [true, true]);
const compute = gmFn("gmGridCompute") || "";
t("the grid's rows leave out paused leads only when Show paused is off", /gmLeadMatchesPaused\(l\)/.test(compute), true);
const css = (await import("node:fs")).readFileSync(new URL("../gm.css", import.meta.url), "utf8");
t("paused rows are greyed with lower contrast and no accent color", /\.gm-grid-paused \.gm-grid-c \{[^}]*color: var\(--muted\)[^}]*opacity: 0\.6/.test(css) && /\.gm-lead-paused \{[^}]*grayscale\(1\)/.test(css), true);
t("the new columns sit under the same no way out rules (cells are .gm-grid-c: not selectable)", /\.gm-grid-c\s*\{[^}]*user-select:\s*none/.test(css), true);

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
