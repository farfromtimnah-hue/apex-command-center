// The desktop strip, the mobile dock and the "Mais" overflow must agree on
// one order. They used to be three hand-maintained lists and had drifted —
// Partners sat far from Sales, Goals was stranded mid-overflow, and a
// dock-displaced tab was push()ed onto the END of "Mais" regardless of
// importance.
//
// The dock and "Mais" are now DERIVED from a single PORTAL_TABS array, so they
// cannot disagree by construction. The desktop strip is still hand-written
// markup, so this file is what keeps it honest.
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
// The estimates & invoices tabs are gated per client (PORTAL_TAB_GATES);
// the canonical-order checks below run as the test client, where both exist.
globalThis.clientId = "test-client-temp-001";
eval(slice("var PORTAL_TABS = [", "function populateMobileDock()") +
  "\n; Object.assign(globalThis, { PORTAL_TABS, PORTAL_DOCK_ORDER, PORTAL_DOCK_TABS," +
  " PORTAL_MORE_TABS, ASSIGNED_DOCK_TAB, LEAD_DOCK_TABS, portalDockTabs, portalMoreTabs," +
  " PORTAL_TAB_GATES, portalTabEnabled, portalTabs, SELLER_TABS });");

// The canonical order, spelled out independently of the file so a reorder has
// to be deliberate in two places.
// Golden Base and Partners are NOT here: they are sub-sections of Pipeline
// (tab id "gmcrm") now, still addressable but out of the strip/dock/Mais.
// gmpricing/gmcalendar joined earlier; gmestimates/gminvoices are the
// estimates & invoices build (2026-09-26). "invoices" (Apex's bills to the
// client) is HIDDEN from the strip and gone from PORTAL_TABS since then.
const CANONICAL = ["analytics", "goals", "gmcrm", "gmjobs", "gmpricing", "gmestimates",
                   "gminvoices", "gmcalendar", "gmfinance", "gmroadmap", "tasks",
                   "documents", "worksched"];

// The Apex-owned group: the client's relationship with Apex rather than tools
// for running their own business. The More menu draws a hairline before the
// first of these.
const APEX_OWNED = ["tasks", "documents"];

eq(PORTAL_TABS.map(t => t.tab), CANONICAL, "PORTAL_TABS is in canonical order");
ok(!PORTAL_TABS.some(t => t.tab === "assigned"),
   "Assigned is NOT in PORTAL_TABS (it is inserted dynamically)");
ok(PORTAL_TABS.every(t => t.labelPt && t.labelEn),
   "every tab carries both a PT and an EN label");

// ---- desktop strip markup matches the array ----
const stripRaw = slice('<div class="portal-tabs">', "</div>\n\n      <div id=\"tabAnalytics\">");
// The legacy per-assessment buttons live inside the container but are
// permanently hidden and never appear in the strip — they exist only so the
// registry's tabBtnId and loadAssessmentList() keep a working handle. They are
// not part of the visible order.
const legacyStart = stripRaw.indexOf('<div hidden id="legacyAssessmentTabBtns">');
const legacyEnd = stripRaw.indexOf("</div>", stripRaw.indexOf("tabBtnPilares"));
const strip = legacyStart < 0 ? stripRaw
  : stripRaw.slice(0, legacyStart) + stripRaw.slice(legacyEnd);
ok(legacyStart >= 0, "the legacy assessment buttons are still present in the DOM");
// A `hidden` button (the Apex invoices tab) is not part of the visible order.
const stripTabs = [...strip.matchAll(/<button[^>]*data-tab="([a-z0-9]+)"[^>]*>/g)]
  .filter(m => !/\shidden[\s>]/.test(m[0]) || m[1] === "assigned").map(m => m[1]);
ok(/data-tab="invoices" hidden/.test(stripRaw), "the Apex invoices tab is still in the DOM but hidden");
ok(!PORTAL_TABS.some(t => t.tab === "invoices"), "…and is not in PORTAL_TABS (out of the dock and Mais)");
// Assigned leads the strip when shown; the rest must be canonical.
eq(stripTabs[0], "assigned", "Assigned is still the FIRST button in the strip");
eq(stripTabs.slice(1), CANONICAL, "the desktop strip markup is in canonical order");

// ---- dock ----
eq(PORTAL_DOCK_TABS.map(t => t.tab), ["analytics", "goals", "gmcrm", "gmfinance"],
   "dock is Analytics · Ritmo · Pipeline · Finances");
eq(PORTAL_DOCK_TABS[2].labelPt, "Pipeline", "the merged commercial tab is labelled Pipeline in PT");
eq(PORTAL_DOCK_TABS[2].labelEn, "Pipeline", "…and Pipeline in EN (same word, both spans still emitted)");
ok(!PORTAL_TABS.some(t => t.tab === "gmbase" || t.tab === "gmpartners"),
   "gmbase and gmpartners have left PORTAL_TABS (they are Pipeline sub-sections)");
ok(!/data-tab="gmbase"/.test(strip) && !/data-tab="gmpartners"/.test(strip),
   "…and have left the desktop strip markup too");
// They must stay ADDRESSABLE: switchTab() maps them onto the gmcrm container.
ok(/var GM_PIPELINE_ALIASES = \{ gmbase: "base", gmpartners: "partners" \};/.test(src),
   "gmbase / gmpartners still resolve, via GM_PIPELINE_ALIASES, to the Pipeline container");
ok(/if \(GM_PIPELINE_ALIASES\[tab\] && !isLead\(\)\) \{/.test(src),
   "switchTab() resolves those aliases before anything else can drop them");
ok(PORTAL_DOCK_TABS.every(Boolean), "every docked key resolves to a real PORTAL_TABS entry");
eq(PORTAL_DOCK_TABS[1].labelPt, "Ritmo", "Ritmo is second in the dock (highest-frequency action)");

// ---- More ----
eq(portalMoreTabs().map(t => t.tab),
   ["gmjobs", "gmpricing", "gmestimates", "gminvoices", "gmcalendar", "gmroadmap", "tasks", "documents", "worksched"],
   "More is everything undocked, in canonical order");

// ---- the Apex-owned divider ----
eq(PORTAL_TABS.filter(t => t.apexOwned).map(t => t.tab), APEX_OWNED,
   "exactly Tasks / Documents carry the apexOwned flag (Apex Invoices is hidden)");
// The three must be CONTIGUOUS and last-but-Settings in the canonical order,
// or a single divider could not express the grouping at all.
const ownedIdx = APEX_OWNED.map(t => CANONICAL.indexOf(t));
ok(ownedIdx.every((v, i) => i === 0 || v === ownedIdx[i - 1] + 1),
   "the Apex-owned tabs are contiguous in the canonical order");

// ---- the displaced-tab bug ----
// With Assigned shown, the last dock tab yields its slot. It must reappear at
// its CANONICAL position in More, not appended after Settings.
globalThis.anyIncompleteAssigned = () => true;
const dockedNow = portalDockTabs().map(t => t.tab);
eq(dockedNow, ["assigned", "analytics", "goals", "gmcrm"],
   "Assigned leads the dock and displaces the last fixed tab");
const moreNow = portalMoreTabs().map(t => t.tab);
ok(moreNow.includes("gmfinance"), "the displaced tab (Finances) is still reachable under More");
eq(moreNow.indexOf("gmfinance"), 5,
   "the displaced tab lands at its CANONICAL position, not appended after Settings");
eq(moreNow, ["gmjobs", "gmpricing", "gmestimates", "gminvoices", "gmcalendar", "gmfinance", "gmroadmap", "tasks",
             "documents", "worksched"],
   "More stays in canonical order once a tab is displaced");
ok(moreNow[moreNow.length - 1] === "worksched", "Settings is still last in More");

// The divider is derived from the flag, never a fixed index. With Assigned
// shown, a displaced dock tab (Finances) lands mid-list — the line must still
// sit at the true group boundary, immediately before Tasks.
const dividerIndex = (list) => {
  for (let i = 0; i < list.length; i++) if (list[i].apexOwned) return i;
  return -1;
};
const dNow = dividerIndex(portalMoreTabs());
eq(moreNow[dNow], "tasks",
   "with a displaced tab in the list, the divider still sits immediately before Tasks");
ok(moreNow.slice(0, dNow).every(t => !APEX_OWNED.includes(t)),
   "nothing above the divider is Apex-owned");
ok(moreNow.slice(dNow).filter(t => t !== "worksched").every(t => APEX_OWNED.includes(t)),
   "everything below the divider is Apex-owned (Settings excepted — it is last by rule)");

globalThis.anyIncompleteAssigned = () => false;
const dPlain = dividerIndex(portalMoreTabs());
eq(portalMoreTabs()[dPlain].tab, "tasks",
   "without a displaced tab the divider also sits immediately before Tasks");
globalThis.anyIncompleteAssigned = () => true;

// Nothing may become unreachable: every canonical tab is in the dock or More.
const reachable = new Set([...dockedNow, ...moreNow]);
ok(CANONICAL.every(t => reachable.has(t)),
   "every canonical tab is reachable from the dock or More, even with Assigned shown");

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ PORTAL TAB ORDER CONSISTENT");
process.exit(fail ? 1 : 0);

// ---- estimates & invoices gates ----
ok(portalTabEnabled({ tab: "x" }), "a tab with no gate is always enabled");
globalThis.clientId = "some-real-client";
ok(!portalTabs().some(t => t.tab === "gmestimates" || t.tab === "gminvoices"),
   "a real client gets neither gated tab in phase 1");
globalThis.clientId = "test-client-temp-001";
ok(portalTabs().some(t => t.tab === "gmestimates") && portalTabs().some(t => t.tab === "gminvoices"),
   "the test client gets both gated tabs");
// ---- seller surface ----
globalThis.isSeller = () => true;
eq(portalTabs().map(t => t.tab), ["gmcrm", "gmjobs", "gmpricing", "gmestimates", "gmcalendar", "documents"],
   "a seller's tabs: Pipeline, Projects, Pricing, Estimates, Calendar, Documents");
eq(portalDockTabs().map(t => t.tab), ["gmcrm", "gmjobs", "gmpricing", "gmestimates"], "a seller's dock is the first four");
eq(portalMoreTabs().map(t => t.tab), ["gmcalendar", "documents"], "…and the rest sit under Mais");
ok(!portalTabs().some(t => t.tab === "gminvoices"), "a seller never sees the client's Invoices tab in phase 1");
globalThis.isSeller = () => false;
