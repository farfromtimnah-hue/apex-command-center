// The lost reason, state and finance lists in gm.js match the Worker (2026-11-14).
//
//   node scripts/test-lead-reason-lists.mjs
//
// The Worker validates against GM_LEAD_LOST_REASONS, GM_US_STATES and
// GM_FINANCE_STATUSES; gm.js shows GM_LOST_REASONS, GM_US_STATES and
// GM_FINANCE_STATUSES. If the two ever drift, a person picks something the
// server then refuses (or the server accepts a value no screen can show).
// The first eight reasons are the contact log's objections: same order, same
// Portuguese, and that list is not touched by this build.
import { varSrc } from "./fixtures/d1-shim.mjs";
import { gm, LOGIC, gmBlock } from "./fixtures/gm-extract.mjs";

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

const worker = new Function(
  varSrc("GM_LEAD_OBJECTIONS") + "\n" + varSrc("GM_LEAD_LOST_REASONS") + "\n" + varSrc("GM_US_STATES") + "\n" + varSrc("GM_FINANCE_STATUSES") +
  "\nreturn { GM_LEAD_OBJECTIONS, GM_LEAD_LOST_REASONS, GM_US_STATES, GM_FINANCE_STATUSES };")();

t("gm.js has the marked lead reason logic block", LOGIC !== null, true);
const front = LOGIC === null ? {} : new Function("lang", "var isEn = function() { return lang === 'en'; }; var gmT = function(pt, en) { return isEn() ? en : pt; };\n" + LOGIC +
  "\nreturn { GM_LOST_REASONS: GM_LOST_REASONS, GM_US_STATES: GM_US_STATES, GM_FINANCE_STATUSES: GM_FINANCE_STATUSES };")("pt");

t("reason keys: the Worker and gm.js lists are identical, same order", (front.GM_LOST_REASONS || []).map((r) => r.key), worker.GM_LEAD_LOST_REASONS);
t("state codes: the Worker and gm.js lists are identical, same order", (front.GM_US_STATES || []).map((s) => s.code), worker.GM_US_STATES);
t("finance keys: the Worker and gm.js lists are identical, same order", (front.GM_FINANCE_STATUSES || []).map((s) => s.key), worker.GM_FINANCE_STATUSES);
t("51 states: 50 and DC, none twice", [(front.GM_US_STATES || []).length, new Set((front.GM_US_STATES || []).map((s) => s.code)).size], [51, 51]);
t("every state has a name in both languages", (front.GM_US_STATES || []).every((s) => s.en && s.pt), true);

// The first eight are the contact log's own objections.
const objections = new Function(gmBlock("var GM_OBJECTIONS = [", "];") + "\nreturn GM_OBJECTIONS;")();
const first8 = (front.GM_LOST_REASONS || []).slice(0, 8);
t("the first eight reasons carry the objection labels in English, in the same order", first8.map((r) => r.en), objections.map((o) => o.en));
t("...and the same Portuguese, word for word", first8.map((r) => r.pt), objections.map((o) => o.pt));
t("...and the Worker's objection list (which this build does not change) says the same English", worker.GM_LEAD_OBJECTIONS, first8.map((r) => r.en));
t("the contact log's own picker list is untouched: still eight, no Other", objections.map((o) => o.key), worker.GM_LEAD_OBJECTIONS);

const reasons = front.GM_LOST_REASONS || [];
t("12 reasons; the last one is Other", [reasons.length, (reasons[11] || {}).key], [12, "other"]);
t("the new labels are what Nicole wrote", reasons.slice(8).map((r) => r.en), ["No response", "Out of state", "Out of scope", "Other"]);
t("every reason has both languages and no long dash", reasons.every((r) => r.pt && r.en && !/[–—]/.test(r.pt + r.en)), true);
t("the finance labels are what Nicole wrote", (front.GM_FINANCE_STATUSES || []).map((s) => s.en), ["Not needed or cash", "Not applied", "Applied and waiting", "Approved", "Not approved", "Other"]);
t("no long dash in any label of the lead reason code", /[–—]/.test((LOGIC || "").replace(/^\s*\/\/.*$/gm, "")), false);

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
