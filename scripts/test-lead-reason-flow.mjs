// The steps of the lost reason, pause and finance screens (2026-11-14).
//
//   node scripts/test-lead-reason-flow.mjs
//
// Runs the REAL screen code from gm.js (the block between the LEAD REASON UI
// markers) with a stand-in page: it records what the screens would draw and
// what they would send. Rules proven here:
//   - The reasons list has eleven choices and NO "Other". Under it sits one low
//     emphasis link. "Other" is only reachable through the confirm step, where
//     "Go back" is the large filled button and "Yes, none of them fit" is the
//     small one, and the text box only exists after that second button.
//   - Nothing is saved until the answer would pass the Worker's rules.
//   - No shortcut, no default, no remembered choice: a new flow starts empty.
//   - Pause instead goes to the pause step and never moves the stage.
//   - A refusal from the route keeps the step open.
//   - No browser pop-up in any of it.
import { UI, LOGIC, gmFn } from "./fixtures/gm-extract.mjs";

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};
t("gm.js has the UI block", UI !== null && LOGIC !== null, true);
if (UI === null || LOGIC === null) { console.log("\n1 FAILED"); process.exit(1); }

function make(lang) {
  const rec = { tracks: [], sheets: [], closed: 0, html: "", titles: [] };
  const els = {};
  const stubs = {
    lang,
    escHtml: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    gmIcon: () => "<svg></svg>",
    gmConfig: { config: { servicos: ["Pool Repair", "Pool Build"] } },
    gmGridActive: true,
    gmGridTrack: (a, o) => rec.tracks.push([a, o.column_key, o.lead_id]),
    gmTodayLocal: () => "2026-11-13",
    formatDate: (s) => s,
    document: { getElementById: (id) => els[id] || (id === "gmLfBody" || id === "gmFinBody" ? { set innerHTML(v) { rec.html = v; }, get innerHTML() { return rec.html; } } : null) },
    rec,
    gmToast: () => {}, gmRenderLeadSheet: () => {}, gmSaveLeadField: () => {}, gmSheetRowHtml: () => "", gmSheetSection: () => "",
    gmApi: () => Promise.resolve({}), gmDetailLead: null, gmLeadsData: { leads: [] }, clientId: "c1", window: { localStorage: {} }
  };
  const names = Object.keys(stubs);
  const code = "var isEn = function() { return lang === 'en'; }; var gmT = function(pt, en) { return isEn() ? en : pt; };\n" +
    "var gmSheetEl = null; var gmSheetOnUserClose = null;\n" +
    "var gmSheetOpen = function(title) { gmSheetOnUserClose = null; rec.sheets.push(title); gmSheetEl = { querySelector: function() { return { set textContent(v) { rec.titles.push(v); } }; } }; };\n" +
    "var gmSheetClose = function() { var o = gmSheetOnUserClose; gmSheetOnUserClose = null; gmSheetEl = null; rec.closed++; if (o) { o(); } };\n" + LOGIC + "\n" + UI +
    "\nreturn { get gmLf() { return gmLf; }, get gmFin() { return gmFin; }, get gmSheetOnUserClose() { return gmSheetOnUserClose; }," +
    " gmFlowOpen: gmFlowOpen, gmLostFlowOpen: gmLostFlowOpen, gmPauseFlowOpen: gmPauseFlowOpen, gmLfPick: gmLfPick, gmLfSetDetail: gmLfSetDetail, gmLfSetOther: gmLfSetOther," +
    " gmLfToConfirm: gmLfToConfirm, gmLfBack: gmLfBack, gmLfBackWith: gmLfBackWith, gmLfToOther: gmLfToOther, gmLfToPause: gmLfToPause, gmLfSave: gmLfSave, gmPfSave: gmPfSave," +
    " gmPfEnd: gmPfEnd, gmFinanceOpen: gmFinanceOpen, gmFinPick: gmFinPick, gmFinSetText: gmFinSetText, gmFinSave: gmFinSave, gmFinClear: gmFinClear," +
    " gmLfPickHtml: gmLfPickHtml, gmLfConfirmHtml: gmLfConfirmHtml, gmLfOtherHtml: gmLfOtherHtml, gmLfPauseHtml: gmLfPauseHtml, gmPauseBannerHtml: gmPauseBannerHtml," +
    " gmLeadFlagsHtml: gmLeadFlagsHtml, gmLfSync: gmLfSync };";
  const api = new Function(...names, code)(...names.map((k) => stubs[k]));
  // gmSheetOpen leaves the "sheet" element in gmSheetEl; the flow remembers it.
  return { api, rec, els };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const LEAD = { id: "L1", cliente: "Maria Souza", estagio: "follow_up" };

// ── The reasons list ───────────────────────────────────────────────────────
{
  const { api, rec } = make("en");
  api.gmLostFlowOpen({ lead: LEAD, allowPause: true, onSave: async () => {}, onPause: async () => {} });
  const h = rec.html;
  const labels = [...h.matchAll(/<button type="button" class="gm-lr-opt[^"]*" role="radio"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
  t("eleven reasons, in order, and no Other in the picker", labels, ["Too expensive", "The other guys are cheaper", "Can&#39;t afford it".replace("&#39;", "'"), "Need to think about it",
    "Need to talk to someone", "Getting other quotes", "Already have someone", "We don't need it", "No response", "Out of state", "Out of scope"]);
  t("the low emphasis link under the list says None of these fit", /class="gm-lr-link"[^>]*>None of these fit</.test(h), true);
  t("the Pause instead button is there", />Pause instead</.test(h), true);
  t("the Save button starts off", /id="gmLfSave"[^>]*disabled/.test(h), true);
  t("the screen opened as a sheet, never a browser dialog", [rec.sheets.length, typeof globalThis.alert], [1, "undefined"]);
}
{
  const { api, rec } = make("pt");
  api.gmLostFlowOpen({ lead: LEAD, allowPause: true, onSave: async () => {}, onPause: async () => {} });
  t("Portuguese: the link and the second button", [/>Nenhum se encaixa</.test(rec.html), />Pausar em vez de perder</.test(rec.html)], [true, true]);
  t("Portuguese: the reasons keep the contact log's wording", /Muito caro/.test(rec.html) && /Os outros são mais baratos/.test(rec.html) && /Fora do escopo/.test(rec.html), true);
}

// ── Save is off until the answer is complete ──────────────────────────────
{
  const { api } = make("en");
  const calls = [];
  api.gmLostFlowOpen({ lead: LEAD, allowPause: true, onSave: async (p) => { calls.push(p); }, onPause: async () => {} });
  api.gmLfSave();
  t("saving with nothing chosen sends nothing", calls.length, 0);
  api.gmLfPick("out_of_state");
  api.gmLfSave();
  t("out_of_state with no state sends nothing", calls.length, 0);
  api.gmLfSetDetail("ZZ");
  api.gmLfSave();
  t("out_of_state with a made up state sends nothing", calls.length, 0);
  api.gmLfSetDetail("FL");
  api.gmLfSave(); await flush();
  t("out_of_state with a state sends the key and the code", calls, [{ lost_reason: "out_of_state", lost_reason_detail: "FL" }]);
}
{
  const { api } = make("en");
  const calls = [];
  api.gmLostFlowOpen({ lead: LEAD, onSave: async (p) => { calls.push(p); }, onPause: async () => {} });
  api.gmLfPick("out_of_scope"); api.gmLfSetDetail("   "); api.gmLfSave();
  t("out_of_scope with spaces sends nothing", calls.length, 0);
  api.gmLfSetDetail("  Roof repair  "); api.gmLfSave(); await flush();
  t("out_of_scope sends the trimmed text", calls, [{ lost_reason: "out_of_scope", lost_reason_detail: "Roof repair" }]);
}
{
  const { api, rec } = make("en");
  const calls = [];
  api.gmLostFlowOpen({ lead: LEAD, onSave: async (p) => { calls.push(p); }, onPause: async () => {} });
  api.gmLfPick("too_expensive"); api.gmLfSave(); await flush();
  t("a plain reason sends only the key", calls, [{ lost_reason: "too_expensive" }]);
  t("the screen tells the grid log which reason step was answered", rec.tracks, [["reason_set", "lost_reason", "L1"]]);
  t("the flow is finished after a save", api.gmLf, null);
}
{
  // The note under out_of_state / out_of_scope.
  const { api, rec } = make("en");
  api.gmLostFlowOpen({ lead: LEAD, onSave: async () => {}, onPause: async () => {} });
  api.gmLfPick("out_of_state");
  t("out_of_state shows a state picker with 51 states and the saved-for-later note", [(rec.html.match(/<option value="[A-Z]{2}"/g) || []).length, /Saved so you can find these leads by state or by scope later if your business expands\./.test(rec.html)], [51, true]);
  api.gmLfPick("out_of_scope");
  t("out_of_scope shows a typing box with the client's services as suggestions and the same note", [/id="gmLfScope"[^>]*maxlength="80"/.test(rec.html), /<option value="Pool Repair">/.test(rec.html), /Saved so you can find these leads/.test(rec.html)], [true, true, true]);
  api.gmLfPick("too_expensive");
  t("a plain reason shows no note and no extra box", [/gm-lr-note/.test(rec.html), /gmLfScope|gmLfState/.test(rec.html)], [false, false]);
}

// ── The Other path: two steps, then text ───────────────────────────────────
{
  const { api, rec } = make("en");
  const calls = [];
  api.gmLostFlowOpen({ lead: LEAD, allowPause: true, onSave: async (p) => { calls.push(p); }, onPause: async () => {} });
  t("the list step has no text box at all", /<textarea/.test(rec.html), false);
  api.gmLfToConfirm();
  const confirm = rec.html;
  t("the confirm step asks the question in Nicole's words", /Do these reasons really not fit what happened\?/.test(confirm), true);
  t("it shows the eleven reasons again", (confirm.match(/class="gm-lr-opt/g) || []).length, 11);
  t("Go back is the large, filled button; Yes none of them fit is the small one", [/class="gm-btn-primary"[^>]*onclick="gmLfBack\(\)">Go back</.test(confirm), /class="gm-lr-small"[^>]*onclick="gmLfToOther\(\)">Yes, none of them fit</.test(confirm)], [true, true]);
  t("Go back comes first", confirm.indexOf("Go back") < confirm.indexOf("Yes, none of them fit"), true);
  t("the plain line is on the step", /Reasons from the list let Apex suggest what to do next\. Other cannot\./.test(confirm), true);
  t("still no text box after the first question", /<textarea/.test(confirm), false);
  t("opening the step is tracked", rec.tracks.filter((x) => x[0] === "other_step_opened").length, 1);
  api.gmLfBack();
  t("Go back returns to the list and is tracked", [api.gmLf.step, rec.tracks.filter((x) => x[0] === "other_step_go_back").length], ["pick", 1]);
  api.gmLfToConfirm(); api.gmLfToOther();
  const other = rec.html;
  t("only after the second button the text box appears", /<textarea id="gmLfOther"[^>]*maxlength="300"/.test(other), true);
  t("the label is Nicole's, word for word", /What actually happened, in your own words\. Do not paste what the customer said\./.test(other), true);
  t("the box starts empty and Save starts off", [/<textarea[^>]*><\/textarea>/.test(other), /id="gmLfSave"[^>]*disabled/.test(other)], [true, true]);
  api.gmLfSetOther("y".repeat(19)); api.gmLfSave();
  t("19 characters send nothing", calls.length, 0);
  api.gmLfSetOther("  The pool was sold already.  "); api.gmLfSave(); await flush();
  t("20 or more characters send other with the trimmed text", calls, [{ lost_reason: "other", lost_reason_detail: "The pool was sold already." }]);
  t("the save is tracked as other_saved", rec.tracks.filter((x) => x[0] === "other_saved").length, 1);
}
{
  // No shortcut, no default, no remembered choice.
  const { api } = make("en");
  api.gmLostFlowOpen({ lead: LEAD, onSave: async () => {}, onPause: async () => {} });
  api.gmLfToConfirm(); api.gmLfToOther(); api.gmLfSetOther("The pool was sold already."); api.gmLfSave(); await flush();
  api.gmLostFlowOpen({ lead: LEAD, onSave: async () => {}, onPause: async () => {} });
  t("a new flow starts on the list with nothing chosen and no text", [api.gmLf.step, api.gmLf.reason, api.gmLf.other, api.gmLf.detail], ["pick", "", "", ""]);
  const start = UI.slice(UI.indexOf("var gmLf = null;"), UI.indexOf("// ── Finance status picker"));
  t("the reason flow code never touches any storage", /localStorage|sessionStorage|indexedDB|document\.cookie/.test(start), false);
  t("a reason tapped on the second look goes back to the list with it chosen, not saved", (() => {
    api.gmLfToConfirm(); api.gmLfBackWith("need_to_think"); return [api.gmLf.step, api.gmLf.reason]; })(), ["pick", "need_to_think"]);
}

// ── Pause instead ──────────────────────────────────────────────────────────
{
  const { api, rec } = make("en");
  const lost = [], paused = [];
  api.gmLostFlowOpen({ lead: LEAD, allowPause: true, onSave: async (p) => { lost.push(p); }, onPause: async (p) => { paused.push(p); } });
  api.gmLfToPause();
  t("Pause instead opens the pause step with a date box and a reason box", [api.gmLf.step, /type="date"[^>]*min="2026-11-14"[^>]*max="2028-11-13"/.test(rec.html), /<textarea id="gmPfWhy"[^>]*maxlength="160"/.test(rec.html)], ["pause", true, true]);
  api.gmPfSave();
  t("saving the pause with nothing filled in sends nothing", paused.length, 0);
  api.gmLf.pDate = "2026-11-13"; api.gmLf.pWhy = "Waiting for the permit"; api.gmPfSave();
  t("today is not a valid pause date", paused.length, 0);
  api.gmLf.pDate = "2026-12-01"; api.gmLf.pWhy = "ab"; api.gmPfSave();
  t("a 2 character reason sends nothing", paused.length, 0);
  api.gmLf.pWhy = "  Waiting for the permit  "; api.gmPfSave(); await flush();
  t("a valid pause sends the date and the trimmed reason, and no stage and no lost reason", [paused, lost.length], [[{ paused_until: "2026-12-01", paused_reason: "Waiting for the permit" }], 0]);
  t("the pause is tracked", rec.tracks.filter((x) => x[0] === "pause_set").length, 1);
}
{
  const { api, rec } = make("en");
  api.gmPauseFlowOpen({ lead: Object.assign({}, LEAD, { paused_until: "2026-12-01", paused_at: "2026-11-10" }), onPause: async () => {}, onEnd: async () => {} });
  t("a lead that is paused now offers End the pause now", /End the pause now/.test(rec.html), true);
  const { api: api2, rec: rec2 } = make("en");
  api2.gmPauseFlowOpen({ lead: LEAD, onPause: async () => {}, onEnd: async () => {} });
  t("a lead that is not paused does not", /End the pause now/.test(rec2.html), false);
}

// ── A refusal keeps the step open ─────────────────────────────────────────
{
  const { api } = make("en");
  api.gmLostFlowOpen({ lead: LEAD, onSave: async () => { throw new Error("A valid lost reason is required"); }, onPause: async () => {} });
  api.gmLfPick("too_expensive"); api.gmLfSave(); await flush();
  t("when the route refuses, the flow is still open and can be tried again", [api.gmLf !== null, api.gmLf && api.gmLf.busy], [true, false]);
}

// ── Cancel ─────────────────────────────────────────────────────────────────
{
  const { api } = make("en");
  let cancelled = 0;
  api.gmLostFlowOpen({ lead: LEAD, onSave: async () => {}, onPause: async () => {}, onCancel: () => { cancelled++; } });
  api.gmSheetOnUserClose();
  t("closing the sheet cancels: the caller is told and the flow is gone", [cancelled, api.gmLf], [1, null]);
}

// ── Finance picker ─────────────────────────────────────────────────────────
{
  const { api, rec } = make("en");
  const saved = [];
  api.gmFinanceOpen({ lead: { id: "L1", cliente: "Maria Souza" }, onSave: async (s, x) => { saved.push([s, x]); } });
  t("six choices, a Save that starts off, and no clear link on an empty lead", [(rec.html.match(/class="gm-lr-opt/g) || []).length, /id="gmFinSave"[^>]*disabled/.test(rec.html), /Clear the status/.test(rec.html)], [6, true, false]);
  api.gmFinPick("not_approved");
  t("not approved shows the hint and sets no reason", [/If you lose this lead, the reason is probably: Can't afford it\./.test(rec.html), /lost_reason/.test(rec.html)], [true, false]);
  api.gmFinPick("other"); api.gmFinSave();
  t("Other with no text sends nothing", saved.length, 0);
  api.gmFinSetText("ab"); api.gmFinSave();
  t("Other with 2 characters sends nothing", saved.length, 0);
  api.gmFinSetText("  Credit union review  "); api.gmFinSave(); await flush();
  t("Other with 3 to 120 characters sends the status and the trimmed text", saved, [["other", "Credit union review"]]);
  t("the finance save is tracked", rec.tracks.filter((x) => x[0] === "finance_set").length, 1);
}
{
  const { api } = make("en");
  const saved = [];
  api.gmFinanceOpen({ lead: { id: "L1", cliente: "Maria", finance_status: "approved" }, onSave: async (s, x) => { saved.push([s, x]); } });
  api.gmFinPick("applied_waiting"); api.gmFinSave(); await flush();
  t("a plain status sends the key and no text", saved, [["applied_waiting", null]]);
}

// ── The banner and the row flags ──────────────────────────────────────────
{
  const { api } = make("en");
  const base = { id: "L1", paused_at: "2026-11-10", paused_until: "2026-11-20", paused_reason: "Waiting for the permit" };
  const b = api.gmPauseBannerHtml(base);
  t("paused now: the banner shows since, reason, comes back on, and both buttons", [/Paused since/.test(b), /Reason/.test(b), /Waiting for the permit/.test(b), /Comes back on/.test(b), /Clear this note/.test(b), /End the pause now/.test(b)], [true, true, true, true, true, true]);
  const after = api.gmPauseBannerHtml(Object.assign({}, base, { paused_until: "2026-11-12" }));
  t("after the date the banner STAYS and says follow up now", [/Pause ended on 2026-11-12\. Follow up now\./.test(after), /Clear this note/.test(after), /End the pause now/.test(after)], [true, true, false]);
  t("cleared: no banner", api.gmPauseBannerHtml(Object.assign({}, base, { pause_banner_cleared_at: "2026-11-13 10:00:00" })), "");
  t("never paused: no banner", api.gmPauseBannerHtml({ id: "L1" }), "");
  t("the banner is a callout card (no side stripe, no inline colors)", /class="gm-pb"/.test(b) && !/border-left|style=/.test(b), true);
  t("paused row: a Paused until pill; waiting row: a Waiting on finance pill; both greyed pills",
    [/Paused until 2026-11-20/.test(api.gmLeadFlagsHtml(base)), /Waiting on finance/.test(api.gmLeadFlagsHtml({ finance_status: "applied_waiting" })), api.gmLeadFlagsHtml({ finance_status: "approved" })], [true, true, ""]);
}

t("no browser pop-up and no long dash anywhere in the screen code", /(^|[^A-Za-z0-9_.$])(window\.)?(alert|confirm|prompt)\s*\(|[–—]/.test(UI.replace(/^\s*\/\/.*$/gm, "").replace(/\/\/.*$/gm, "")), false);

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
