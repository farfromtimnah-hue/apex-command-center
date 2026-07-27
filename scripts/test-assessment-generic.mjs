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
  "\n; Object.assign(globalThis, { assessmentCatalog, assessmentAnsweredCount, assessmentScaleAccepts, ASSESSMENT_TYPES, ASSESSMENT_SCALES, computeManagementXrayScore, computeXrayScore, XRAY_QUESTIONS, MGMT_CATEGORIES });";

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
t("both types registered", Object.keys(ASSESSMENT_TYPES).sort(),
  ["business_xray", "management_xray"]);
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
