// Verification harness for computePerceptionScore("pilares_crescimento").
//
//   node scripts/test-pilares-crescimento.mjs
//
// Pilares de Crescimento: 7 Sim/Não questions, pct = round(Sim / 7 × 100) —
// structurally identical to Feedback 360º, which is why both run on one
// engine. This file asserts the Pilares-specific questions and copy, plus the
// shared-engine invariant that the two instruments cannot drift apart.
//
// The anchor case is the one specified with the instrument:
//   4 Sim / 3 Não → 57%
//
// Same unrecovered bar formula as Feedback 360º: the legacy tool showed 50
// here against a 57% headline (and 40 on Feedback 360º for the SAME counts),
// so the bar mirrors the headline instead. Asserted below.
import { readFileSync } from "fs";

const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");

function slice(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  if (a < 0 || b < 0) { throw new Error("markers not found: " + startMarker); }
  return src.slice(a, b);
}

const code =
  slice("var ASSESSMENT_SCALES = {", "var LEAD_STAGE_ASSESSMENT_TYPES") +
  slice("var PERCEPTION_BINARY_LEVELS = [", "function computeAssessmentScore") +
  "\n; Object.assign(globalThis, { computePerceptionScore, PERCEPTION_SPECS," +
  " PERCEPTION_CUTOFFS, PERCEPTION_BINARY_LEVELS });";

eval(code);

let failures = 0;
function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "  → " + JSON.stringify(actual)
        : "\n        expected: " + JSON.stringify(expected) +
          "\n        actual:   " + JSON.stringify(actual)));
}

const QS = PERCEPTION_SPECS.pilares_crescimento.questions;
const score = (arr) => {
  const a = {};
  QS.forEach((q, i) => { if (arr[i] != null) { a[q.key] = arr[i]; } });
  return computePerceptionScore("pilares_crescimento", a);
};

// ── Structural invariants ────────────────────────────────────────────────
assert("7 questions", QS.length, 7);
assert("keys are q1..q7", QS.map(q => q.key), ["q1","q2","q3","q4","q5","q6","q7"]);
assert("every question has PT+EN name and label",
  QS.every(q => q.namePt && q.nameEn && q.labelPt && q.labelEn), true);
assert("first question is the vision one",
  QS[0].labelPt, "A empresa tem visão clara de futuro?");
assert("last question is the growth-potential one",
  QS[6].labelPt, "Você acredita que a empresa tem potencial real de crescimento?");
// The two surveys must NOT share question text — only structure.
assert("questions differ from Feedback 360's",
  QS.map(q => q.labelPt).some(l =>
    PERCEPTION_SPECS.feedback_360.questions.map(f => f.labelPt).includes(l)), false);

// ── THE documented verification case: 4 Sim / 3 Não → 57% ────────────────
const r = score([1, 1, 1, 1, 0, 0, 0]);
assert("anchor pct = 57", r.pct, 57);
assert("anchor score/max = 4/7", [r.score, r.max_score], [4, 7]);
assert("anchor distribution", r.distribution, { sim: 4, nao: 3, nao_respondido: 0, total: 7 });
assert("anchor devolutiva interpolates pct",
  r.overall.devolutivaPt,
  "Seus Pilares de Crescimento estão em 57%. Isso reflete a prontidão da empresa para escalar e sustentar o futuro.");
assert("anchor ação is the non-100% variant",
  r.overall.acaoImediataPt, "Foque em comunicar melhor a visão e investir no desenvolvimento do time.");
assert("assessment_type stamped", r.assessment_type, "pilares_crescimento");
assert("no {pct} placeholder survives",
  /\{pct\}/.test(r.overall.devolutivaPt + r.overall.devolutivaEn), false);

// ── The two verified Ação variants ───────────────────────────────────────
const allSim = score([1, 1, 1, 1, 1, 1, 1]);
assert("all Sim → 100%", allSim.pct, 100);
assert("100% ação is the perfect variant",
  allSim.overall.acaoImediataPt, "Sua base está sólida para buscar novas parcerias e mercados.");
const allNao = score([0, 0, 0, 0, 0, 0, 0]);
assert("all Não → 0%", allNao.pct, 0);
assert("0% ação is the standard variant",
  allNao.overall.acaoImediataPt, "Foque em comunicar melhor a visão e investir no desenvolvimento do time.");
assert("only 100% gets the perfect ação",
  [0,1,2,3,4,5,6].map(n => score(Array.from({length:7}, (_,i) => i < n ? 1 : 0))
    .overall.acaoImediataPt === allSim.overall.acaoImediataPt),
  [false, false, false, false, false, false, false]);

// ── The percentage across every possible Sim count ───────────────────────
assert("pct for 0..7 Sim",
  [0,1,2,3,4,5,6,7].map(n => score(Array.from({length:7}, (_,i) => i < n ? 1 : 0)).pct),
  [0, 14, 29, 43, 57, 71, 86, 100]);
assert("each single Sim scores the same regardless of which question",
  [0,1,2,3,4,5,6].map(i => score(Array.from({length:7}, (_,j) => j === i ? 1 : 0)).pct),
  [14, 14, 14, 14, 14, 14, 14]);

// ── Bands ────────────────────────────────────────────────────────────────
assert("100% → forte", allSim.overall.level, "forte");
assert("57% → moderada", r.overall.level, "moderada");
assert("0% → fragil", allNao.overall.level, "fragil");

// ── Charts ───────────────────────────────────────────────────────────────
assert("two charts emitted", Object.keys(r.charts).sort(), ["areaBar", "responseDoughnut"]);
assert("bar chart has ONE bar", r.charts.areaBar.bars.length, 1);
assert("bar is labelled CRESCIMENTO", r.charts.areaBar.bars[0].labelPt, "CRESCIMENTO");
assert("bar is flat gray", r.charts.areaBar.bars[0].hex, "#6c757d");
assert("bar y-axis 0..100", [r.charts.areaBar.yMin, r.charts.areaBar.yMax], [0, 100]);
// DECISION: the legacy bar (50) was not derivable from the answers.
assert("bar value EQUALS the headline pct (legacy 50 was underivable)",
  r.charts.areaBar.bars[0].value, r.pct);

// The doughnut IS verified: 4 Sim/3 Não → [4,3,0] → 57/43/0%.
assert("doughnut counts", r.charts.responseDoughnut.slices.map(s => s.count), [4, 3, 0]);
assert("doughnut pcts 57/43/0", r.charts.responseDoughnut.slices.map(s => s.pct), [57, 43, 0]);
assert("doughnut labels Sim/Não/Não respondidas",
  r.charts.responseDoughnut.slices.map(s => s.labelPt), ["Sim", "Não", "Não respondidas"]);
assert("doughnut colours", r.charts.responseDoughnut.slices.map(s => s.hex),
  ["#4bc0c0", "#dc3545", "#c9cbcf"]);
assert("doughnut Sim slice pct matches the headline exactly",
  r.charts.responseDoughnut.slices[0].pct, r.pct);

// ── Empty / partial answers ──────────────────────────────────────────────
const empty = computePerceptionScore("pilares_crescimento", {});
assert("empty: pct 0", empty.pct, 0);
assert("empty: all 7 unanswered", empty.distribution.nao_respondido, 7);
assert("empty: null values", empty.questions.every(q => q.value === null), true);

const partial = score([1, 1, 1, 1, null, null, null]);
assert("partial: 4 Sim of 7 still = 57%", partial.pct, 57);
assert("partial: 3 unanswered", partial.distribution.nao_respondido, 3);
assert("partial: unanswered are NOT counted as Não", partial.distribution.nao, 0);

const bad = computePerceptionScore("pilares_crescimento", { q1: 2, q2: true, q3: "1" });
assert("out-of-scale values count as unanswered", bad.distribution.nao_respondido, 7);

// ── Shared-engine invariant ──────────────────────────────────────────────
// Both surveys run through computePerceptionScore, so identical answers must
// produce identical NUMBERS while the copy stays instrument-specific. This is
// what makes the shared engine safe.
const fb = computePerceptionScore("feedback_360",
  { q1: 1, q2: 1, q3: 1, q4: 1, q5: 0, q6: 0, q7: 0 });
assert("same answers → same pct across both surveys", [fb.pct, r.pct], [57, 57]);
assert("same answers → same distribution", fb.distribution, r.distribution);
assert("same answers → same doughnut counts",
  fb.charts.responseDoughnut.slices.map(s => s.count),
  r.charts.responseDoughnut.slices.map(s => s.count));
assert("but the devolutiva copy differs",
  fb.overall.devolutivaPt === r.overall.devolutivaPt, false);
assert("and the area label differs",
  [fb.charts.areaBar.bars[0].labelPt, r.charts.areaBar.bars[0].labelPt],
  ["FINANCEIRO", "CRESCIMENTO"]);
assert("and the ação copy differs",
  fb.overall.acaoImediataPt === r.overall.acaoImediataPt, false);
assert("both register their own assessment_type",
  [fb.assessment_type, r.assessment_type], ["feedback_360", "pilares_crescimento"]);

console.log(failures === 0
  ? "\n✅ ALL ASSERTIONS PASSED"
  : "\n❌ " + failures + " ASSERTION(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
