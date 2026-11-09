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
// The registry slice now also contains top-level listener bindings (scroll, dock, ...); give them inert targets.
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.document = globalThis.document || { addEventListener() {}, removeEventListener() {}, getElementById() { return null; } };

// Registry + derived lists + the open/incomplete helpers + the picker.
eval(slice("var SINGLE_PAGE_ASSESSMENTS = [", "function loadAssigned()") +
  "\n; Object.assign(globalThis, { SINGLE_PAGE_ASSESSMENTS, spaState, spaConf," +
  " spaOpen, xrayOpen, anyIncompleteAssigned, ASSIGNABLE_TOOLS, assignedTools });");

// Dock + More-menu builders. They call isLead(); stub it as "client", which is
// the role this whole change is about.
globalThis.isLead = () => false;
globalThis.isSeller = () => false;
globalThis.ritmoDeprioritized = () => false;   // goals / daily log both on
// PORTAL_DOCK_TABS and PORTAL_MORE_TABS are now DERIVED from the canonical
// PORTAL_TABS array rather than hand-listed, so the slice starts there.
// Order itself is asserted by test-portal-tab-order.mjs; this file only cares
// that Assigned's insertion keeps everything reachable.
eval(slice("var PORTAL_TABS = [", "function populateMobileDock()") +
  "\n; Object.assign(globalThis, { PORTAL_TABS, PORTAL_DOCK_TABS, PORTAL_MORE_TABS," +
  " ASSIGNED_DOCK_TAB, portalDockTabs, portalMoreTabs, portalGroups, portalGroupOfTab, portalGearTabs, portalTabs });");

// The Documents "completed assessments" section builder.
globalThis.isEn = () => false;
globalThis.formatDate = (s) => s;
globalThis.formatDateUTC = (s) => s;
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
// Nav rebuild 2026-09-28: clients and sellers navigate by GROUPS (Início, Negócio, Agenda, Analytics, Apex);
// the dock is the list of groups and there is no "Mais" for them. "Assigned joins Apex only while something
// is waiting", so the entry point is a tool inside the Apex group instead of the first dock tab.
const groupHas = (tab) => portalGroups().some(g => g.tabs.some(x => x.tab === tab));
t("nothing assigned -> Assigned absent from every nav group", groupHas("assigned"), false);
t("nothing assigned -> no More menu entries for a client", portalMoreTabs().length, 0);

// ── Assigned + incomplete: card in Assigned, Assigned reachable in the Apex group ──
reset();
spaState[keys[0]].assigned = true;
spaState[keys[0]].status = "not_started";
t("assigned+incomplete -> anyIncompleteAssigned true", anyIncompleteAssigned(), true);
t("assigned+incomplete -> it has a card in Assigned",
  assignedTools().map(x => x.tab), [keys[0]]);
t("assigned+incomplete -> Assigned is a tool inside the Apex group",
  (portalGroupOfTab("assigned") || {}).tab, "grp-apex");
t("assigned+incomplete -> the Apex group itself is in the dock",
  portalDockTabs().some(x => x.tab === "grp-apex"), true);
t("assigned+incomplete -> the dock is the groups: at most five destinations, no Mais",
  portalDockTabs().length <= 5 && portalDockTabs().every(x => x.group), true);
t("assigned+incomplete -> no per-assessment entry in any group or the More menu",
  portalGroups().reduce((a, g) => a.concat(g.tabs.map(x => x.tab)), []).concat(portalMoreTabs().map(x => x.tab))
    .filter(x => keys.indexOf(x) !== -1 || x === "xray"), []);
t("assigned+incomplete -> every tab a client can open is still reachable (a group, or the gear)",
  portalTabs().map(x => x.tab)
    .filter(x => !portalGroupOfTab(x) && !portalGearTabs().some(g => g.tab === x)), []);

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
t("completed -> Assigned entry point hidden from the nav groups",
  groupHas("assigned"), false);

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
// The one-row strip is the LEAD's shape only now (clients use the groups); it still leads with Assigned.
const strip = slice('<div class="portal-tabs">', "<!-- ══ Navigation (rebuild 2026-09-28)");
const stripButtons = [...strip.matchAll(/<button class="portal-tab[^"]*"[^>]*data-tab="([a-z0-9]+)"/g)]
  .map(m => m[1]);
t("Assigned is the FIRST button in the (lead) tab strip", stripButtons[0], "assigned");
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
