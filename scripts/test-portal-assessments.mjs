// Structural check for portal.html's single-page assessment registry.
//
//   node scripts/test-portal-assessments.mjs
//
// The portal used to name each instrument by hand in FIVE places (the lead
// tab allowlist, the Assigned-tab picker, the mobile More menu, switchTab's
// element-id list and a per-type "assigned" boolean). Missing one meant a
// newly added assessment was silently bounced back to the Assigned tab — the
// exact failure this file exists to prevent.
//
// Those five now DERIVE from SINGLE_PAGE_ASSESSMENTS. This evals the registry
// out of portal.html and asserts every entry is reachable end to end: present
// in each derived list, and backed by real DOM ids in the markup.
import { readFileSync } from "fs";

const html = readFileSync(new URL("../portal.html", import.meta.url), "utf8");

function slice(a, b) {
  const i = html.indexOf(a), j = html.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + a); }
  return html.slice(i, j);
}

// The registry plus everything derived from it, up to (not including) the
// first function that needs the live DOM.
eval(slice("var SINGLE_PAGE_ASSESSMENTS = [", "function loadAssessmentList()") +
  "\n; Object.assign(globalThis, { SINGLE_PAGE_ASSESSMENTS, spaState," +
  " LEAD_ALLOWED_TABS, ASSIGNABLE_TOOLS, spaConf });");

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

const keys = SINGLE_PAGE_ASSESSMENTS.map(e => e.key);
console.log("registry: " + keys.join(", ") + "\n");

// ── Registry hygiene ──────────────────────────────────────────────────────
t("at least the two shipped single-page instruments", keys.length >= 2, true);
t("keys are unique", keys.length, new Set(keys).size);
t("types are unique",
  SINGLE_PAGE_ASSESSMENTS.length, new Set(SINGLE_PAGE_ASSESSMENTS.map(e => e.type)).size);
t("elPrefixes are unique",
  SINGLE_PAGE_ASSESSMENTS.length, new Set(SINGLE_PAGE_ASSESSMENTS.map(e => e.elPrefix)).size);
t("every entry declares the required fields",
  SINGLE_PAGE_ASSESSMENTS.filter(e =>
    !e.key || !e.type || !e.elPrefix || !e.tabBtnId || !e.report || !e.icon ||
    !e.titlePt || !e.titleEn || !e.subPt || !e.subEn || !e.descPt || !e.descEn ||
    !e.introPt || !e.introEn || !e.unitPt || !e.unitEn || !e.donePt || !e.doneEn).map(e => e.key), []);
t("every intro carries the {total} placeholder",
  SINGLE_PAGE_ASSESSMENTS.filter(e =>
    !e.introPt.includes("{total}") || !e.introEn.includes("{total}")).map(e => e.key), []);
t("spaConf resolves every key", keys.filter(k => !spaConf(k)), []);
t("spaConf returns null for an unknown key", spaConf("nope"), null);

// ── The five derived lists ────────────────────────────────────────────────
t("every key is in LEAD_ALLOWED_TABS (else a lead is bounced to Assigned)",
  keys.filter(k => LEAD_ALLOWED_TABS.indexOf(k) === -1), []);
t("LEAD_ALLOWED_TABS still allows the originals",
  ["assigned", "documents", "xray", "lockedpreview"].filter(k => LEAD_ALLOWED_TABS.indexOf(k) === -1), []);
t("every key is an ASSIGNABLE_TOOLS row (Assigned-tab picker)",
  keys.filter(k => !ASSIGNABLE_TOOLS.some(a => a.tab === k)), []);
t("the Business X-Ray is still its own picker row",
  ASSIGNABLE_TOOLS.some(a => a.tab === "xray"), true);
t("every picker row has an isAssigned function",
  ASSIGNABLE_TOOLS.filter(a => typeof a.isAssigned !== "function").map(a => a.tab), []);
t("every key has runtime state", keys.filter(k => !spaState[k]), []);
t("state starts unassigned", keys.filter(k => spaState[k].assigned !== false), []);
t("state starts on the intro view", keys.filter(k => spaState[k].view !== "intro"), []);

// isAssigned must read live state, not a snapshot taken at registry build.
spaState[keys[0]].assigned = true;
t("isAssigned reflects live state",
  ASSIGNABLE_TOOLS.filter(a => a.tab === keys[0])[0].isAssigned(), true);
spaState[keys[0]].assigned = false;

// ── Markup backing ────────────────────────────────────────────────────────
// switchTab capitalizes the key to build the container id, and spaEl()
// concatenates elPrefix + suffix. Both must resolve to real elements or the
// tab silently fails to show (or throws mid-boot).
SINGLE_PAGE_ASSESSMENTS.forEach(e => {
  const tabId = "tab" + e.key.charAt(0).toUpperCase() + e.key.slice(1);
  t(e.key + ": container #" + tabId + " exists", html.includes('id="' + tabId + '"'), true);
  ["Body", "HeroTitle", "HeroSub"].forEach(sfx => {
    t(e.key + ": #" + e.elPrefix + sfx + " exists",
      html.includes('id="' + e.elPrefix + sfx + '"'), true);
  });
  t(e.key + ": tab button #" + e.tabBtnId + " exists",
    html.includes('id="' + e.tabBtnId + '"'), true);
  t(e.key + ": tab button calls switchTab('" + e.key + "')",
    html.includes("switchTab('" + e.key + "')"), true);
});

// ── No stale per-type code left behind ────────────────────────────────────
// The old mgmt-specific implementation must be fully gone: a leftover call
// site would throw at runtime even though the file still parses.
["loadMgmtXray", "renderMgmtXray", "answerMgmt(", "mgmtSubmit(", "mgmtOpenReport(",
 "mgmtDetail", "mgmtAnswers", "mgmtAssigned"].forEach(sym => {
  const hits = html.split(sym).length - 1;
  // The comment naming the retired globals is allowed to mention them.
  const allowed = (sym === "mgmtDetail" || sym === "mgmtAnswers") ? 1 : 0;
  t("no stale reference to " + sym, hits <= allowed, true);
});

console.log(fails === 0
  ? "\n✅ PORTAL REGISTRY CONSISTENT"
  : "\n❌ " + fails + " FAILED");
process.exit(fails ? 1 : 0);
