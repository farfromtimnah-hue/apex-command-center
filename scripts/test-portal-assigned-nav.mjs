// Structural + behavioral check for portal.html's Assigned-tab navigation.
//
//   node scripts/test-portal-assigned-nav.mjs
//
// Seven assignable assessments used to mean seven permanent tab buttons for a
// client: a scrolling "Mais" menu, no signal when something new landed, and a
// finished assessment parked in the nav forever. The Assigned tab (which
// leads already had) is now the single entry point for clients too:
//
//   * assigned + incomplete -> a card in Assigned, and NO tab button of its own
//   * completed            -> no Assigned card; a row in the Documents tab's
//                             "completed assessments" section instead
//   * nothing open         -> the Assigned entry point vanishes entirely
//   * something open       -> Assigned is FIRST in the strip and the dock,
//                             carrying a badge
//
// This evals the real logic out of portal.html (registry, spaOpen/xrayOpen,
// anyIncompleteAssigned, ASSIGNABLE_TOOLS, the dock/more builders and the
// Documents section builder) against fabricated assignment states, so the
// assertions exercise the shipped code rather than a restatement of it.
import { readFileSync } from "fs";

const html = readFileSync(new URL("../portal.html", import.meta.url), "utf8");

function slice(a, b) {
  const i = html.indexOf(a), j = html.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + a); }
  return html.slice(i, j);
}

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

// ── Load the real logic ───────────────────────────────────────────────────
// Registry + derived lists + the open/incomplete helpers + the picker.
eval(slice("var SINGLE_PAGE_ASSESSMENTS = [", "function loadAssigned()") +
  "\n; Object.assign(globalThis, { SINGLE_PAGE_ASSESSMENTS, spaState, spaConf," +
  " spaOpen, xrayOpen, anyIncompleteAssigned, ASSIGNABLE_TOOLS, assignedTools });");

// Dock + More-menu builders. They call isLead(); stub it as "client", which is
// the role this whole change is about.
globalThis.isLead = () => false;
eval(slice("var PORTAL_DOCK_TABS = [", "function populateMobileDock()") +
  "\n; Object.assign(globalThis, { PORTAL_DOCK_TABS, PORTAL_MORE_TABS," +
  " ASSIGNED_DOCK_TAB, portalDockTabs, portalMoreTabs });");

// The Documents "completed assessments" section builder.
globalThis.isEn = () => false;
globalThis.formatDate = (s) => s;
eval(slice("function completedAssessmentsList()", "// Called the moment an assessment is submitted") +
  "\n; Object.assign(globalThis, { completedAssessmentsList, completedAssessmentsHtml });");

globalThis.xrayAssigned = false;
globalThis.xrayStatus = null;
globalThis.assessmentsCache = [];

const keys = SINGLE_PAGE_ASSESSMENTS.map(e => e.key);

function reset() {
  keys.forEach(k => { spaState[k].assigned = false; spaState[k].status = null; });
  globalThis.xrayAssigned = false;
  globalThis.xrayStatus = null;
  globalThis.assessmentsCache = [];
}

// ── Nothing assigned: the Assigned entry point is gone entirely ───────────
reset();
t("nothing assigned -> anyIncompleteAssigned false", anyIncompleteAssigned(), false);
t("nothing assigned -> no Assigned card", assignedTools().length, 0);
t("nothing assigned -> Assigned absent from the dock",
  portalDockTabs().some(x => x.tab === "assigned"), false);
t("nothing assigned -> Assigned absent from the More menu",
  portalMoreTabs().some(x => x.tab === "assigned"), false);

// ── Assigned + incomplete: card in Assigned, Assigned leads the nav ───────
reset();
spaState[keys[0]].assigned = true;
spaState[keys[0]].status = "not_started";
t("assigned+incomplete -> anyIncompleteAssigned true", anyIncompleteAssigned(), true);
t("assigned+incomplete -> it has a card in Assigned",
  assignedTools().map(x => x.tab), [keys[0]]);
t("assigned+incomplete -> Assigned is FIRST in the dock",
  portalDockTabs()[0].tab, "assigned");
t("assigned+incomplete -> the dock still holds at most 4 + Mais",
  portalDockTabs().length <= 4, true);
t("assigned+incomplete -> no per-assessment entry in the More menu",
  portalMoreTabs().filter(x => keys.indexOf(x.tab) !== -1 || x.tab === "xray").map(x => x.tab), []);
t("assigned+incomplete -> a dock tab displaced by Assigned stays reachable in More",
  PORTAL_DOCK_TABS.filter(d => !portalDockTabs().some(x => x.tab === d.tab))
    .filter(d => !portalMoreTabs().some(m => m.tab === d.tab)).map(d => d.tab), []);

// in_progress is still open work.
spaState[keys[0]].status = "in_progress";
t("in_progress still counts as open", anyIncompleteAssigned(), true);

// ── Completed: leaves Assigned, appears under Documents ──────────────────
reset();
spaState[keys[0]].assigned = true;
spaState[keys[0]].status = "completed";
t("completed -> no card in Assigned", assignedTools().map(x => x.tab), []);
t("completed -> anyIncompleteAssigned false (nothing left to do)",
  anyIncompleteAssigned(), false);
t("completed -> Assigned entry point hidden from the dock",
  portalDockTabs().some(x => x.tab === "assigned"), false);

globalThis.assessmentsCache = [
  { assessment_type: spaConf(keys[0]).type, status: "completed", completed_at: "2026-07-27T10:00:00Z" }
];
t("completed -> one row in the Documents assessments section",
  completedAssessmentsList().map(x => x.titleEn), [spaConf(keys[0]).titleEn]);
t("completed -> that row opens its own report page",
  completedAssessmentsList()[0].open, "spaOpenReport('" + keys[0] + "')");
t("completed -> the section renders a bilingual heading",
  completedAssessmentsHtml().includes("Completed assessments") &&
  completedAssessmentsHtml().includes("conclu&iacute;dos"), true);

// An assigned-but-unfinished one must NOT show up under Documents.
globalThis.assessmentsCache = [
  { assessment_type: spaConf(keys[0]).type, status: "in_progress", completed_at: null }
];
t("incomplete -> absent from the Documents assessments section",
  completedAssessmentsList().length, 0);
t("empty section still renders its heading + empty state",
  completedAssessmentsHtml().includes("Nenhum diagn&oacute;stico"), true);

// ── The Business X-Ray follows the same rule ─────────────────────────────
reset();
globalThis.xrayAssigned = true;
globalThis.xrayStatus = "not_started";
t("xray assigned+incomplete -> card in Assigned",
  assignedTools().map(x => x.tab), ["xray"]);
globalThis.xrayStatus = "completed";
t("xray completed -> no card in Assigned", assignedTools().map(x => x.tab), []);
t("xray completed -> nothing open", anyIncompleteAssigned(), false);
globalThis.assessmentsCache = [
  { assessment_type: "business_xray", status: "completed", completed_at: "2026-07-27T10:00:00Z" }
];
t("xray completed -> Documents row opens xray-report.html",
  completedAssessmentsList()[0].open, "xrayOpenReport()");

// ── Mixed: one done, one open -> Assigned stays, showing only the open one ─
reset();
spaState[keys[0]].assigned = true; spaState[keys[0]].status = "completed";
spaState[keys[1]].assigned = true; spaState[keys[1]].status = "not_started";
t("mixed -> Assigned shows only the unfinished one",
  assignedTools().map(x => x.tab), [keys[1]]);
t("mixed -> Assigned entry point still shown", anyIncompleteAssigned(), true);

// ── Markup: no per-assessment button in the tab strip; Assigned is first ──
const strip = slice('<div class="portal-tabs">', "</div>\n\n      <div id=\"tabAnalytics\">");
const stripButtons = [...strip.matchAll(/<button class="portal-tab[^"]*"[^>]*data-tab="([a-z0-9]+)"/g)]
  .map(m => m[1]);
t("Assigned is the FIRST button in the desktop tab strip", stripButtons[0], "assigned");
t("no per-assessment button remains in the strip",
  stripButtons.filter(b => keys.indexOf(b) !== -1 || b === "xray"), []);
SINGLE_PAGE_ASSESSMENTS.concat([{ tabBtnId: "tabBtnXray" }]).forEach(e => {
  t(e.tabBtnId + " still exists in the DOM (registry + loadAssessmentList address it)",
    html.includes('id="' + e.tabBtnId + '"'), true);
});
t("the Assigned button carries a badge element",
  html.includes('id="assignedTabDot"'), true);
t("the mobile dock renders a badge on the Assigned icon",
  html.includes('class="m-tab-dot"'), true);
t("applyPortalShape no longer force-hides Assigned for clients",
  /if \(t === "assigned"\) \{ b\.hidden = true; \}/.test(html), false);

console.log(fails === 0
  ? "\n✅ ASSIGNED NAV CONSISTENT"
  : "\n❌ " + fails + " FAILED");
process.exit(fails ? 1 : 0);
