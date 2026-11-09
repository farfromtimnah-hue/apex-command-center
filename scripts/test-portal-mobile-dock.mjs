// Verifies the dock by RUNNING the real populateMobileDock() and portalMoreTabs()
// out of portal.html against a minimal DOM stub:
//   1. a client with an incomplete assessment gets the Apex group's dot in the
//      dock (Assigned sits inside the Apex group while something is waiting),
//      with the desktop strip hidden;
//   2. a lead can still reach the locked-preview list via the dock's "Mais".
// Nav rebuild 2026-09-28: clients and sellers get the GROUPS as their dock and
// have no "Mais" at all; only a lead keeps the Mais overflow menu.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../portal.html", import.meta.url), "utf8");
const slice = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error("slice not found: " + a);
  return src.slice(i, j);
};

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

// --- minimal DOM: only what the dock builder touches ---
const els = {};
const mkEl = (id) => ({
  id, innerHTML: "", hidden: false, _attrs: {},
  setAttribute(k, v) { this._attrs[k] = v; },
  classList: { toggle() {}, remove() {}, add() {} },
  querySelectorAll: () => [],
});
for (const id of ["mobile-tab-bar", "mobile-more-menu"]) els[id] = mkEl(id);
globalThis.document = {
  getElementById: (id) => els[id] || null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
};
globalThis.window = { apexNavSvg: (n) => `<svg data-icon="${n}"></svg>`, addEventListener() {}, removeEventListener() {} };
globalThis.apexNavSvg = window.apexNavSvg;

// --- real code out of portal.html ---
eval(slice("var SINGLE_PAGE_ASSESSMENTS = [", "function loadAssigned()") +
  "\n; Object.assign(globalThis, { SINGLE_PAGE_ASSESSMENTS, spaState, spaOpen, xrayOpen, anyIncompleteAssigned });");
eval(slice("var LOCKED_PREVIEWS = [", "function lockedPreviewBanner(") +
  "\n; Object.assign(globalThis, { LOCKED_PREVIEWS, lockedPreviewMeta });");
globalThis.updateMobileDockActive = () => {};
// The group strip / step bar painter (renderPortalNav) is its own piece; here only the dock is under test.
globalThis.renderPortalNav = () => {};
globalThis.ritmoDeprioritized = () => false;
globalThis.gmAttentionBadgeCount = () => 0;
globalThis.localDateStr = () => "2099-01-01";   // past the "Novo" pill window, so no pills in the dock
globalThis.isSeller = () => false;
globalThis.clientId = "test-client-temp-001";   // both gated tabs exist here
eval(slice("var PORTAL_TABS = [", "function portalMoreToggle()") +
  "\n; Object.assign(globalThis, { PORTAL_TABS, PORTAL_DOCK_TABS, PORTAL_MORE_TABS, LEAD_DOCK_TABS," +
  " ASSIGNED_DOCK_TAB, portalDockTabs, portalMoreTabs, populateMobileDock, portalTabs, portalTabEnabled, portalGroups });");

globalThis.currentTab = "analytics";
globalThis.entryState = null;
globalThis.anyPendingEntries = () => !!(entryState && entryState.pending && entryState.pending.length);

const dockBtn = (html, key) => html.split('<button').find(b => b.includes('data-dock-tab="' + key + '"'));
const groupTabs = (key) => (portalDockTabs().find(g => g.tab === key) || { tabs: [] }).tabs.map(t => t.tab);

// ---------- 1. client, incomplete assessment ----------
globalThis.isLead = () => false;
globalThis.xrayAssigned = true;
globalThis.xrayStatus = "in_progress";
ok(anyIncompleteAssigned(), "setup: an assessment is assigned and incomplete");

populateMobileDock();
const bar = els["mobile-tab-bar"].innerHTML;
ok(/data-dock-tab="grp-apex"/.test(bar), "dock renders the Apex group");
ok(groupTabs("grp-apex").indexOf("assigned") !== -1, "Assigned is a tool inside the Apex group while an assessment is open");
ok(/m-tab-dot/.test(dockBtn(bar, "grp-apex") || ""), "the Apex dock button carries its m-tab-dot for the open assessment");
ok(!/data-dock-tab="assigned"/.test(bar), "Assigned is no longer a dock tab of its own");
ok(["grp-home", "grp-negocio", "grp-agenda", "grp-analytics", "grp-apex"].every(k => dockBtn(bar, k)),
   "a client's dock is the five groups: Inicio, Negocio, Agenda, Analytics, Apex");
ok(!/data-dock-tab="mais"/.test(bar), 'a client has no "Mais" button (nothing overflows)');
ok(portalMoreTabs().length === 0, "a client's More list is empty");

// The strip is hidden by CSS only — the buttons must survive in the markup.
ok(/id="tabBtnAssigned"/.test(src), "tabBtnAssigned still exists in the markup (CSS hides the container)");
ok(/@media \(max-width: 768px\) \{\s*\.portal-tabs \{ display: none; \}/.test(src),
   ".portal-tabs is hidden below 769px");

// Nothing waiting: the Apex group loses the dot (Assigned leaves it with the assessment).
globalThis.xrayAssigned = false;
globalThis.xrayStatus = null;
populateMobileDock();
const barNone = els["mobile-tab-bar"].innerHTML;
ok(groupTabs("grp-apex").indexOf("assigned") === -1, "nothing assigned: Assigned is not in the Apex group");
ok(!/m-tab-dot/.test(dockBtn(barNone, "grp-apex") || ""), "nothing assigned, nothing pending: no dot on the Apex button");

// ---------- 2. Ritmo dot on a pending backlog ----------
globalThis.entryState = { pending: [{ date: "2026-07-28", is_today: true }] };
populateMobileDock();
const bar2 = els["mobile-tab-bar"].innerHTML;
ok(groupTabs("grp-apex").indexOf("goals") !== -1, "Ritmo (goals) is a tool inside the Apex group");
ok(/m-tab-dot/.test(dockBtn(bar2, "grp-apex") || ""), "the Apex dock button carries its dot when days are pending");
const ritmo = portalGroups().find(g => g.tab === "grp-apex").tabs.find(t => t.tab === "goals");
ok(/Ritmo/.test(ritmo.labelPt) && /Pace/.test(ritmo.labelEn), "the Ritmo tool reads Ritmo / Pace");

globalThis.entryState = null;
populateMobileDock();
ok(!/m-tab-dot/.test(dockBtn(els["mobile-tab-bar"].innerHTML, "grp-apex") || ""), "no dot when nothing is pending");

// ---------- 3. lead reaches the locked previews via the dock's Mais ----------
globalThis.isLead = () => true;
globalThis.xrayAssigned = false;
globalThis.xrayStatus = null;
populateMobileDock();
const leadBar = els["mobile-tab-bar"].innerHTML;
const leadMenu = els["mobile-more-menu"].innerHTML;
ok(/data-dock-tab="mais"/.test(leadBar), 'lead dock renders "Mais"');
const listed = LOCKED_PREVIEWS.filter(p => leadMenu.includes(`portalMoreGo('${p.key}',true)`));
ok(listed.length === LOCKED_PREVIEWS.length,
   `lead's Mais lists all ${LOCKED_PREVIEWS.length} locked previews (found ${listed.length})`);
ok(/Ritmo/.test(leadMenu), "the lead's locked-preview list shows Ritmo, not Metas");
// A lead's menu is all locked teasers — none carry apexOwned, so no stray
// hairline should be drawn in it.
ok(!/mm-divider/.test(leadMenu), "no divider in the lead's Mais (nothing there is Apex-owned)");

// ---------- 4. a client's tools sit in the right groups ----------
globalThis.isLead = () => false;
globalThis.xrayAssigned = false;
globalThis.xrayStatus = null;
populateMobileDock();
ok(els["mobile-more-menu"].innerHTML.indexOf("mm-item") === -1 && !/mm-divider/.test(els["mobile-more-menu"].innerHTML),
   "a client's Mais menu holds no items and no divider");
const neg = groupTabs("grp-negocio");
ok(neg.indexOf("gmestimates") !== -1 && neg.indexOf("gminvoices") !== -1,
   "the client's own Estimates and Faturas are in the Business group (their tools, not Apex's)");
ok(neg.indexOf("gmjobs") !== -1 && neg.indexOf("gmfinance") !== -1, "Obras and Financeiro are in the Business group");
ok(neg.indexOf("gmcrm") < neg.indexOf("gmestimates") && neg.indexOf("gmestimates") < neg.indexOf("gminvoices"),
   "the Business group follows the order the work happens: lead, estimate, invoice");
const apexTools = groupTabs("grp-apex");
ok(apexTools.indexOf("gmroadmap") !== -1 && apexTools.indexOf("tasks") !== -1 && apexTools.indexOf("documents") !== -1,
   "Execucao, Tarefas and Documentos are in the Apex group");
ok(apexTools.indexOf("gmroadmap") < apexTools.indexOf("tasks") && apexTools.indexOf("tasks") < apexTools.indexOf("documents"),
   "the Apex group keeps Execucao, then Tarefas, then Documentos");
ok(!/portalMoreGo\('invoices'/.test(els["mobile-more-menu"].innerHTML) &&
   portalGroups().every(g => g.tabs.every(t => t.tab !== "invoices")),
   "Apex's own Faturas (invoices) is not reachable anywhere (hidden since the estimates build)");
ok(portalGroups().every(g => g.tabs.every(t => t.tab !== "gmbase" && t.tab !== "gmpartners")),
   "Golden Base and Partners are not nav entries (they are Pipeline sub-sections)");

// ---------- 5. seller dock: groups, no Mais ----------
globalThis.isSeller = () => true;
globalThis.isLead = () => false;
globalThis.xrayAssigned = false;
populateMobileDock();
const sellerBar = els["mobile-tab-bar"].innerHTML;
const sellerNeg = groupTabs("grp-negocio");
ok(["gmcrm", "gmjobs", "gmpricing", "gmestimates"].every(k => sellerNeg.indexOf(k) !== -1),
   "seller's Business group holds Pipeline, Projects, Pricing, Estimates");
ok(/data-dock-tab="grp-agenda"/.test(sellerBar) && portalGroups().some(g => g.tabs.some(t => t.tab === "documents")),
   "a seller still reaches Calendar and Documents (their own entries in the dock)");
ok(!/data-dock-tab="mais"/.test(sellerBar), "seller dock has no Mais (their tools are all in the groups)");
ok(!/data-dock-tab="gminvoices"/.test(sellerBar) && portalGroups().every(g => g.tabs.every(t => t.tab !== "gminvoices")),
   "a seller never reaches the client's Invoices tab");
globalThis.isSeller = () => false;

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
