// Portal navigation (rebuild 2026-09-28, Nicole): five destinations instead of
// a dock plus a full-screen "Mais". Início · Negócio · Agenda · Analytics · Apex,
// with Preços and Ajustes behind the header gear. Negócio lists its tools in
// the order the work happens: a lead first, invoicing last.
//
// Everything is derived from PORTAL_TABS + PORTAL_GROUPS, so the dock, the
// desktop strip and the step row cannot disagree. This file pins the groups,
// the process order, what each role gets, and that nothing became unreachable.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../portal.html", import.meta.url), "utf8");
const slice = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error("slice not found: " + a);
  return src.slice(i, j);
};

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const eq = (got, want, m) =>
  ok(JSON.stringify(got) === JSON.stringify(want),
     m + (JSON.stringify(got) === JSON.stringify(want) ? "" :
       `\n        want ${JSON.stringify(want)}\n        got  ${JSON.stringify(got)}`));

globalThis.isLead = () => false;
globalThis.isSeller = () => false;
globalThis.anyIncompleteAssigned = () => false;
globalThis.anyPendingEntries = () => false;
globalThis.gmAttentionBadgeCount = () => 0;
let ritmoDown = false;
globalThis.ritmoDeprioritized = () => ritmoDown;
globalThis.document = { addEventListener() {}, getElementById() { return null; } };
globalThis.window = { addEventListener() {}, innerWidth: 400 };
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
globalThis.clientId = "test-client-temp-001";
eval(slice("var LOCKED_PREVIEWS = [", "];") + "]; globalThis.LOCKED_PREVIEWS = LOCKED_PREVIEWS;");
eval(slice("var PORTAL_TABS = [", "function populateMobileDock()") +
  "\n; Object.assign(globalThis, { PORTAL_TABS, PORTAL_GROUPS, PORTAL_GEAR_TABS, PORTAL_TAB_GATES," +
  " LEAD_DOCK_TABS, portalTabs, portalTabEnabled, portalGroups, portalGroupTabs, portalGearTabs," +
  " portalGroupLanding, portalRememberTab, portalGroupOfTab, portalDockTabs, portalMoreTabs, SELLER_TABS });");

const groups = () => portalGroups().map(g => [g.tab, g.tabs.map(t => t.tab)]);

// ---- owner, test client (every tool switched on) ----
ok(PORTAL_TABS.every(t => t.labelPt && t.labelEn && t.icon), "every tab carries PT + EN labels and an icon");
eq(groups(), [
  ["grp-home", ["home"]],
  ["grp-negocio", ["gmcrm", "gmestimates", "gmcontracts", "gmjobs", "gminvoices", "gmfinance"]],
  ["grp-agenda", ["gmcalendar"]],
  ["grp-analytics", ["analytics"]],
  ["grp-apex", ["goals", "gmroadmap", "tasks", "documents"]]
], "owner: Início · Negócio (lead first, invoicing last) · Agenda · Analytics · Apex");
eq(portalDockTabs().map(t => t.tab), ["grp-home", "grp-negocio", "grp-agenda", "grp-analytics", "grp-apex"],
   "the phone dock is the five groups");
eq(portalMoreTabs(), [], "no Mais overflow for an owner");
eq(portalGearTabs().map(t => t.tab), ["gmpricing", "worksched"], "the gear holds Preços and Ajustes");
const reach = new Set([...portalGroups().flatMap(g => g.tabs.map(t => t.tab)), ...portalGearTabs().map(t => t.tab)]);
ok(portalTabs().every(t => reach.has(t.tab)), "every tool is reachable from a group or the gear");
ok(!PORTAL_TABS.some(t => t.tab === "invoices"), "Apex's invoices stay hidden (not in PORTAL_TABS)");
ok(/<div hidden id="legacyAssessmentTabBtns">/.test(src), "the legacy assessment buttons are still in the DOM");

// ---- a group opens the tool used last ----
const neg = portalGroups().find(g => g.tab === "grp-negocio");
eq(portalGroupLanding(neg), "gmcrm", "Negócio opens Pipeline the first time");
portalRememberTab("gminvoices");
eq(portalGroupLanding(neg), "gminvoices", "…and the tool used last after that");
portalRememberTab("gmcalendar");
eq(portalGroupLanding(neg), "gminvoices", "a one-tool group does not overwrite another group's memory");

// ---- Assigned and Ritmo inside Apex ----
globalThis.anyIncompleteAssigned = () => true;
eq(portalGroups().find(g => g.tab === "grp-apex").tabs.map(t => t.tab)[0], "assigned",
   "an assessment waiting puts Atribuídos first in Apex");
globalThis.anyIncompleteAssigned = () => false;
ritmoDown = true;
eq(portalGroups().find(g => g.tab === "grp-apex").tabs.map(t => t.tab),
   ["gmroadmap", "tasks", "documents", "goals"], "daily log / goals switched off: Ritmo goes last in Apex");
ritmoDown = false;

// ---- a real client (gates opened for everyone 2026-09-28) ----
globalThis.clientId = "some-real-client";
eq(portalGroups().find(g => g.tab === "grp-negocio").tabs.map(t => t.tab),
   ["gmcrm", "gmestimates", "gmcontracts", "gmjobs", "gminvoices", "gmfinance"], "every client gets the full Negócio now");
PORTAL_TAB_GATES.estimates = ["test-client-temp-001"]; PORTAL_TAB_GATES.invoices = ["test-client-temp-001"];
PORTAL_TAB_GATES.contracts = ["test-client-temp-001"];
eq(portalGroups().find(g => g.tab === "grp-negocio").tabs.map(t => t.tab), ["gmcrm", "gmjobs", "gmfinance"],
   "a gate list, if ever set again: Negócio has no Orçamentos / Faturas until the gates open");
PORTAL_TAB_GATES.estimates = null; PORTAL_TAB_GATES.invoices = null; PORTAL_TAB_GATES.contracts = null;
eq(portalGroups().find(g => g.tab === "grp-negocio").tabs.map(t => t.tab),
   ["gmcrm", "gmestimates", "gmcontracts", "gmjobs", "gminvoices", "gmfinance"], "…and gets them back in process order once reopened");
globalThis.clientId = "test-client-temp-001";

// ---- salesperson ----
globalThis.isSeller = () => true;
eq(groups(), [
  ["grp-negocio", ["gmcrm", "gmestimates", "gmcontracts", "gmjobs"]],
  ["grp-agenda", ["gmcalendar"]],
  ["grp-apex", ["documents"]]
], "salesperson: Negócio (their tools), Agenda, Documentos; no Início, Analytics or Ritmo");
const solo = portalGroups().find(g => g.tab === "grp-apex");
eq([solo.labelPt, solo.icon], ["Documentos", "file"], "a group left with one tool shows as that tool");
eq(portalGearTabs().map(t => t.tab), ["gmpricing"], "a salesperson's gear holds only Preços");
eq(portalMoreTabs(), [], "no Mais for a salesperson");
globalThis.isSeller = () => false;

// ---- lead: unchanged ----
globalThis.isLead = () => true;
eq(portalDockTabs().map(t => t.tab), LEAD_DOCK_TABS.map(t => t.tab), "a lead keeps their own dock");
ok(portalMoreTabs().length > 0 && portalMoreTabs().every(t => t.locked), "…and their locked-preview Mais");
globalThis.isLead = () => false;

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ PORTAL NAV CONSISTENT");
process.exit(fail ? 1 : 0);
