// Verifies the two Task 4 questions by RUNNING the real populateMobileDock()
// and portalMoreTabs() out of portal.html against a minimal DOM stub:
//   1. a client with an incomplete assessment still gets Assigned + its dot
//      in the dock, with the desktop strip hidden;
//   2. a lead can still reach the locked-preview list via the dock's "Mais".
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
};
globalThis.window = { apexNavSvg: (n) => `<svg data-icon="${n}"></svg>` };
globalThis.apexNavSvg = window.apexNavSvg;

// --- real code out of portal.html ---
eval(slice("var SINGLE_PAGE_ASSESSMENTS = [", "function loadAssigned()") +
  "\n; Object.assign(globalThis, { SINGLE_PAGE_ASSESSMENTS, spaState, spaOpen, xrayOpen, anyIncompleteAssigned });");
eval(slice("var LOCKED_PREVIEWS = [", "function lockedPreviewBanner(") +
  "\n; Object.assign(globalThis, { LOCKED_PREVIEWS, lockedPreviewMeta });");
globalThis.updateMobileDockActive = () => {};
eval(slice("var PORTAL_TABS = [", "function portalMoreToggle()") +
  "\n; Object.assign(globalThis, { PORTAL_TABS, PORTAL_DOCK_TABS, PORTAL_MORE_TABS, LEAD_DOCK_TABS," +
  " ASSIGNED_DOCK_TAB, portalDockTabs, portalMoreTabs, populateMobileDock });");

globalThis.currentTab = "analytics";
globalThis.entryState = null;
globalThis.anyPendingEntries = () => !!(entryState && entryState.pending && entryState.pending.length);

// ---------- 1. client, incomplete assessment ----------
globalThis.isLead = () => false;
globalThis.xrayAssigned = true;
globalThis.xrayStatus = "in_progress";
ok(anyIncompleteAssigned(), "setup: an assessment is assigned and incomplete");

populateMobileDock();
const bar = els["mobile-tab-bar"].innerHTML;
ok(/data-dock-tab="assigned"/.test(bar), "dock renders the Assigned entry point");
const assignedBtn = bar.split('<button').find(b => b.includes('data-dock-tab="assigned"'));
ok(/m-tab-dot/.test(assignedBtn || ""), "the Assigned dock button carries its m-tab-dot");
ok(/data-dock-tab="mais"/.test(bar), 'dock still renders "Mais"');

// The strip is hidden by CSS only — the buttons must survive in the markup.
ok(/id="tabBtnAssigned"/.test(src), "tabBtnAssigned still exists in the markup (CSS hides the container)");
ok(/@media \(max-width: 768px\) \{\s*\.portal-tabs \{ display: none; \}/.test(src),
   ".portal-tabs is hidden below 769px");

// ---------- 2. Ritmo dot on a pending backlog ----------
globalThis.entryState = { pending: [{ date: "2026-07-28", is_today: true }] };
populateMobileDock();
const bar2 = els["mobile-tab-bar"].innerHTML;
const ritmoBtn = bar2.split('<button').find(b => b.includes('data-dock-tab="goals"'));
ok(!!ritmoBtn, "dock renders the Ritmo tab");
ok(/m-tab-dot/.test(ritmoBtn || ""), "the Ritmo dock button carries its dot when days are pending");
ok(/Ritmo/.test(bar2) && /Pace/.test(bar2), "the dock label reads Ritmo / Pace");

globalThis.entryState = null;
populateMobileDock();
const ritmoBtn3 = els["mobile-tab-bar"].innerHTML.split('<button').find(b => b.includes('data-dock-tab="goals"'));
ok(!/m-tab-dot/.test(ritmoBtn3 || ""), "no Ritmo dot when nothing is pending");

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

// ---------- 4. the Apex-owned divider renders, once, in the right place ----------
globalThis.isLead = () => false;
globalThis.xrayAssigned = false;
globalThis.xrayStatus = null;
populateMobileDock();
const menu = els["mobile-more-menu"].innerHTML;
ok((menu.match(/mm-divider/g) || []).length === 1, "exactly one divider is rendered in Mais");
// A line only: no heading, no label text inside it.
ok(/<div class="mm-divider" role="separator"><\/div>/.test(menu),
   "the divider is an empty hairline — no heading, no label");
// It must sit immediately before the first Apex-owned item (Tarefas).
const beforeDivider = menu.slice(0, menu.indexOf("mm-divider"));
const afterDivider = menu.slice(menu.indexOf("mm-divider"));
ok(!/portalMoreGo\('tasks'/.test(beforeDivider), "Tarefas is below the divider");
ok(!/portalMoreGo\('documents'/.test(beforeDivider), "Documentos is below the divider");
ok(!/portalMoreGo\('invoices'/.test(beforeDivider), "Faturas is below the divider");
ok(/portalMoreGo\('gmjobs'/.test(beforeDivider), "Obras is above the divider");
ok(/portalMoreGo\('gmroadmap'/.test(beforeDivider), "Execucao is above the divider");
ok(/portalMoreGo\('tasks'/.test(afterDivider), "…and Tarefas is the first item after it");
// The merged tab no longer offers Golden Base / Partners as menu entries.
ok(!/portalMoreGo\('gmbase'/.test(menu) && !/portalMoreGo\('gmpartners'/.test(menu),
   "Golden Base and Partners are gone from Mais (they are Pipeline sub-sections)");
ok(/Pipeline/.test(els["mobile-tab-bar"].innerHTML), "the dock label reads Pipeline");

// With a displaced tab in the list the line must still sit at the boundary.
globalThis.xrayAssigned = true;
globalThis.xrayStatus = "in_progress";
populateMobileDock();
const menu2 = els["mobile-more-menu"].innerHTML;
ok((menu2.match(/mm-divider/g) || []).length === 1,
   "still exactly one divider once Assigned displaces a dock tab");
const before2 = menu2.slice(0, menu2.indexOf("mm-divider"));
ok(/portalMoreGo\('gmfinance'/.test(before2),
   "the displaced tab (Financeiro) sits ABOVE the divider, at the true group boundary");
ok(!/portalMoreGo\('tasks'/.test(before2), "Tarefas is still below the divider");

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
