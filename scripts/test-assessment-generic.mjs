// Verifies the THREE generalized paths the brief called out, against the real
// worker source: the merge loop, assessmentAnsweredCount, and the catalog.
import { readFileSync } from "fs";
const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");

function slice(a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error("marker: " + a);
  return src.slice(i, j);
}

const code =
  slice("var ASSESSMENT_TYPES = {", "var XRAY_AREAS") +
  slice("var XRAY_AREAS = [", "// ---------------------------------------------------------------------------\n// Part 2 — practice-profile sections") +
  slice("var XRAY_PROFILE_SECTIONS = [", "function assessmentCatalog") +
  slice("var XRAY_CUTOFFS = {", "// ---------------------------------------------------------------------------\n// Management X-Ray") +
  slice("var MGMT_SCALE_LEVELS = [", "function computeAssessmentScore") +
  slice("function assessmentCatalog(type)", "// ------") +
  slice("function assessmentAnsweredCount(type, answers)", "// ── Practice-profile helpers") +
  "\n; Object.assign(globalThis, { assessmentCatalog, assessmentAnsweredCount, assessmentScaleAccepts, ASSESSMENT_TYPES, ASSESSMENT_SCALES, computeManagementXrayScore, computeXrayScore, computeLeadershipXrayScore, XRAY_QUESTIONS, MGMT_CATEGORIES });";

eval(code);

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

// ── Catalog shape ─────────────────────────────────────────────────────────
const bx = assessmentCatalog("business_xray");
const mx = assessmentCatalog("management_xray");
t("business_xray scale = binary", bx.scale.type, "binary");
t("management_xray scale = ternary", mx.scale.type, "ternary");
t("binary accepts 0,1", bx.scale.values, [0, 1]);
t("ternary accepts 0,1,2", mx.scale.values, [0, 1, 2]);
t("business_xray layout", bx.layout, "sections");
t("management_xray layout", mx.layout, "single_page");
t("management_xray total = 11", mx.total, 11);
t("management_xray max_score = 50", mx.max_score, 50);
t("mgmt questions === categories", mx.questions === mx.categories, true);
t("mgmt has NO profile activities", mx.profile_activities === undefined, true);
t("bx HAS profile activities", Array.isArray(bx.profile_activities), true);
t("unknown type → null", assessmentCatalog("nope"), null);
// The registry grows with each new instrument, so assert the INVARIANT rather
// than a snapshot of its contents: the two originals are still there, and
// every registered type resolves to a real catalog with a declared scale and
// a PT/EN label. A type registered without a catalog (or vice versa) is the
// actual bug this guards against.
t("business_xray still registered", !!ASSESSMENT_TYPES.business_xray, true);
t("management_xray still registered", !!ASSESSMENT_TYPES.management_xray, true);
t("every registered type has a catalog",
  Object.keys(ASSESSMENT_TYPES).filter(k => !assessmentCatalog(k)), []);
t("every registered type declares a scale",
  Object.keys(ASSESSMENT_TYPES).filter(k => !assessmentCatalog(k).scale), []);
t("every registered type has PT+EN labels",
  Object.keys(ASSESSMENT_TYPES).filter(k =>
    !ASSESSMENT_TYPES[k].labelPt || !ASSESSMENT_TYPES[k].labelEn), []);
t("every catalog's questions all carry a key",
  Object.keys(ASSESSMENT_TYPES).filter(k =>
    (assessmentCatalog(k).questions || []).some(q => !q.key)), []);
t("every catalog's total matches its question count",
  Object.keys(ASSESSMENT_TYPES).filter(k => {
    const c = assessmentCatalog(k);
    return c.total !== (c.questions || []).length;
  }), []);
t("mgmt label PT", ASSESSMENT_TYPES.management_xray.labelPt, "Raio X de Gestão");

// ── assessmentScaleAccepts ────────────────────────────────────────────────
t("binary rejects 2", assessmentScaleAccepts(bx, 2), false);
t("ternary accepts 2", assessmentScaleAccepts(mx, 2), true);
t("ternary rejects 3", assessmentScaleAccepts(mx, 3), false);
t("ternary rejects '1' (string)", assessmentScaleAccepts(mx, "1"), false);
t("ternary rejects null", assessmentScaleAccepts(mx, null), false);
t("ternary rejects undefined", assessmentScaleAccepts(mx, undefined), false);
t("ternary rejects true", assessmentScaleAccepts(mx, true), false);

// ── assessmentAnsweredCount across BOTH scales ────────────────────────────
t("mgmt count: 2 is COUNTED (the old 0|1 check would drop it)",
  assessmentAnsweredCount("management_xray",
    { planejamento_estrategico: 2, estrutura_organizacional: 2 }), 2);
t("mgmt count: mixed values",
  assessmentAnsweredCount("management_xray",
    { planejamento_estrategico: 0, estrutura_organizacional: 1, comunicacao_interna: 2 }), 3);
t("mgmt count: out-of-scale 3 not counted",
  assessmentAnsweredCount("management_xray", { planejamento_estrategico: 3 }), 0);
t("mgmt count: stray key not counted",
  assessmentAnsweredCount("management_xray", { not_a_category: 2 }), 0);
t("bx count: 2 NOT counted on a binary scale",
  assessmentAnsweredCount("business_xray", { missao_visao_valores: 2 }), 0);
t("bx count: 1 counted",
  assessmentAnsweredCount("business_xray", { missao_visao_valores: 1 }), 1);
t("empty answers → 0", assessmentAnsweredCount("management_xray", {}), 0);

// ── The merge loop, extracted verbatim from handlePutAssessmentAnswers ────
function mergeLoop(catalog, prev, incoming) {
  const validKeys = {};
  catalog.questions.forEach(q => { validKeys[q.key] = true; });
  const merged = Object.assign({}, prev);
  Object.keys(incoming).forEach(k => {
    if (!validKeys[k]) return;
    let v = incoming[k];
    if (catalog.scale.coerceBool) {
      if (v === true) v = 1;
      if (v === false) v = 0;
    }
    if (assessmentScaleAccepts(catalog, v)) merged[k] = v;
  });
  return merged;
}

t("merge: ternary stores 2",
  mergeLoop(mx, {}, { planejamento_estrategico: 2 }), { planejamento_estrategico: 2 });
t("merge: ternary stores 0 and 1",
  mergeLoop(mx, {}, { gestao_metas: 0, gestao_reunioes: 1 }),
  { gestao_metas: 0, gestao_reunioes: 1 });
t("merge: ternary drops out-of-range 3",
  mergeLoop(mx, {}, { gestao_metas: 3 }), {});
t("merge: ternary drops booleans (no coercion on ternary)",
  mergeLoop(mx, {}, { gestao_metas: true }), {});
t("merge: ternary drops unknown key",
  mergeLoop(mx, {}, { bogus: 1 }), {});
t("merge: ternary preserves prior answers",
  mergeLoop(mx, { gestao_metas: 1 }, { gestao_reunioes: 2 }),
  { gestao_metas: 1, gestao_reunioes: 2 });
t("merge: ternary overwrites in place",
  mergeLoop(mx, { gestao_metas: 1 }, { gestao_metas: 0 }), { gestao_metas: 0 });
// The business_xray behaviour the brief said to KEEP:
t("merge: binary still coerces true→1",
  mergeLoop(bx, {}, { missao_visao_valores: true }), { missao_visao_valores: 1 });
t("merge: binary still coerces false→0",
  mergeLoop(bx, {}, { missao_visao_valores: false }), { missao_visao_valores: 0 });
t("merge: binary rejects 2",
  mergeLoop(bx, {}, { missao_visao_valores: 2 }), {});

// ── Full submit round-trip: merge → count → score ─────────────────────────
const G = [2, 1, 1, 0, 1, 0, 0, 1, 2, 1, 2];
const payload = {};
MGMT_CATEGORIES.forEach((c, i) => { payload[c.key] = G[i]; });
const merged = mergeLoop(mx, {}, payload);
const count = assessmentAnsweredCount("management_xray", merged);
t("round-trip: all 11 survive the merge", Object.keys(merged).length, 11);
t("round-trip: answered count = total (submit gate passes)", count, mx.total);
const scored = computeManagementXrayScore(merged);
t("round-trip: 23/50 = 46%", [scored.score, scored.max_score, scored.pct], [23, 50, 46]);
t("round-trip: band", scored.maturity.labelPt, "GESTÃO DESORGANIZADA");
t("round-trip: score_summary fields present (client.html reads these)",
  [typeof scored.score, typeof scored.max_score, typeof scored.pct,
   typeof scored.maturity.labelPt, typeof scored.maturity.labelEn],
  ["number", "number", "number", "string", "string"]);

// A partial draft must NOT satisfy the submit gate.
const partial = mergeLoop(mx, {}, { planejamento_estrategico: 2 });
t("partial draft blocks submit", assessmentAnsweredCount("management_xray", partial) < mx.total, true);

// ── The 0-10 scale on the same generic paths ──────────────────────────────
// The point of the scale descriptor is that a third scale needs no new code
// in the merge loop or the answered-count; these assert exactly that.
const lx = assessmentCatalog("leadership_xray");
t("leadership_xray scale = scale0to10", lx.scale.type, "scale0to10");
t("scale0to10 accepts 0..10", lx.scale.values, [0,1,2,3,4,5,6,7,8,9,10]);
t("leadership_xray layout", lx.layout, "single_page");
t("leadership_xray total = 10", lx.total, 10);
t("lead questions === categories", lx.questions === lx.categories, true);
t("leadership_xray has NO profile activities", lx.profile_activities === undefined, true);
t("scale0to10 accepts 10", assessmentScaleAccepts(lx, 10), true);
t("scale0to10 rejects 11", assessmentScaleAccepts(lx, 11), false);
t("scale0to10 rejects -1", assessmentScaleAccepts(lx, -1), false);
t("scale0to10 rejects '5' (string)", assessmentScaleAccepts(lx, "5"), false);
t("scale0to10 rejects true (no bool coercion)", assessmentScaleAccepts(lx, true), false);
t("merge: 0-10 stores 10", mergeLoop(lx, {}, { L1: 10 }), { L1: 10 });
t("merge: 0-10 stores 0", mergeLoop(lx, {}, { L2: 0 }), { L2: 0 });
t("merge: 0-10 drops 11", mergeLoop(lx, {}, { L1: 11 }), {});
t("merge: 0-10 drops booleans", mergeLoop(lx, {}, { L1: true }), {});
t("merge: 0-10 drops unknown key", mergeLoop(lx, {}, { L99: 5 }), {});
t("count: 0-10 counts every in-range value",
  assessmentAnsweredCount("leadership_xray", { L1: 0, L2: 10, L3: 7 }), 3);
t("count: 0-10 ignores out-of-range",
  assessmentAnsweredCount("leadership_xray", { L1: 11 }), 0);

// Full submit round-trip on the anchor case.
const LEAD_ANCHOR = [8, 3, 6, 9, 5, 2, 7, 4, 6, 5];
const leadPayload = {};
lx.questions.forEach((q, i) => { leadPayload[q.key] = LEAD_ANCHOR[i]; });
const leadMerged = mergeLoop(lx, {}, leadPayload);
t("lead round-trip: all 10 survive the merge", Object.keys(leadMerged).length, 10);
t("lead round-trip: answered count = total",
  assessmentAnsweredCount("leadership_xray", leadMerged), lx.total);
const leadScored = computeLeadershipXrayScore(leadMerged);
t("lead round-trip: distribution", leadScored.distribution,
  { verde: 2, amarelo: 6, vermelho: 2, nao_respondido: 0, total: 10 });
t("lead round-trip: overall warning", leadScored.overall.color, "warning");
t("lead round-trip: maturity mirror present (client.html reads it)",
  [typeof leadScored.maturity.labelPt, typeof leadScored.maturity.labelEn,
   leadScored.maturity.color], ["string", "string", "warning"]);

// ── Business X-Ray must be untouched by all of this ───────────────────────
const bxAnswers = {};
XRAY_QUESTIONS.forEach(q => { bxAnswers[q.key] = 1; });
const bxScore = computeXrayScore(bxAnswers);
t("business_xray still scores 62/62 100%", [bxScore.score, bxScore.max_score, bxScore.pct], [62, 62, 100]);
t("business_xray still reports its own type", bxScore.assessment_type, "business_xray");
t("business_xray answered count still 62", assessmentAnsweredCount("business_xray", bxAnswers), 62);

console.log(fails === 0 ? "\n✅ ALL GENERIC-PATH ASSERTIONS PASSED"
                        : "\n❌ " + fails + " FAILED");
process.exit(fails ? 1 : 0);
