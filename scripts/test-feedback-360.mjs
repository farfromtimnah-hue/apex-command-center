// Verification harness for computePerceptionScore("feedback_360").
//
//   node scripts/test-feedback-360.mjs
//
// Feedback 360º: 7 Sim/Não questions, pct = round(Sim / 7 × 100).
//
// The anchor case is the one specified with the instrument:
//   4 Sim / 3 Não → 57%
//
// Two legacy behaviours are pinned down here deliberately:
//   1. Question 6 ("are there avoidable wastes?") is phrased so "Sim" is bad
//      news in reality, but the legacy tool scores every Sim as a point. The
//      all-Sim → 100% case is verified. NO polarity inversion.
//   2. The "Eficiência por Área" bar did NOT match the headline in the legacy
//      tool (57% headline, 40 shown). Since Pilares showed 50 for the SAME
//      4 Sim/3 Não counts, the legacy bar cannot be a function of the answers
//      — so this implementation makes the bar equal the headline. That choice
//      is asserted below.
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

const QS = PERCEPTION_SPECS.feedback_360.questions;
const score = (arr) => {
  const a = {};
  QS.forEach((q, i) => { if (arr[i] != null) { a[q.key] = arr[i]; } });
  return computePerceptionScore("feedback_360", a);
};

// ── Structural invariants ────────────────────────────────────────────────
assert("7 questions", QS.length, 7);
assert("keys are q1..q7", QS.map(q => q.key), ["q1","q2","q3","q4","q5","q6","q7"]);
assert("binary levels are Não=0 / Sim=1",
  PERCEPTION_BINARY_LEVELS.map(l => [l.value, l.labelPt]), [[0, "Não"], [1, "Sim"]]);
assert("every question has PT+EN name and label",
  QS.every(q => q.namePt && q.nameEn && q.labelPt && q.labelEn), true);

// ── THE documented verification case: 4 Sim / 3 Não → 57% ────────────────
const r = score([1, 1, 1, 1, 0, 0, 0]);
assert("anchor pct = 57", r.pct, 57);
assert("anchor score/max = 4/7", [r.score, r.max_score], [4, 7]);
assert("anchor distribution", r.distribution, { sim: 4, nao: 3, nao_respondido: 0, total: 7 });
assert("anchor devolutiva interpolates pct",
  r.overall.devolutivaPt,
  "O Feedback 360 Financeiro indica um nível de confiança de 57% na gestão dos recursos.");
assert("anchor ação is the non-100% variant",
  r.overall.acaoImediataPt, "Revise os processos de controle de custos e desperdícios imediatamente.");
assert("assessment_type stamped", r.assessment_type, "feedback_360");
assert("no {pct} placeholder survives",
  /\{pct\}/.test(r.overall.devolutivaPt + r.overall.devolutivaEn), false);

// ── The two verified Ação variants ───────────────────────────────────────
const allSim = score([1, 1, 1, 1, 1, 1, 1]);
assert("all Sim → 100%", allSim.pct, 100);
assert("100% ação is the perfect variant",
  allSim.overall.acaoImediataPt, "Continue monitorando a eficiência do uso de recursos.");
const allNao = score([0, 0, 0, 0, 0, 0, 0]);
assert("all Não → 0%", allNao.pct, 0);
assert("0% ação is the standard variant",
  allNao.overall.acaoImediataPt, "Revise os processos de controle de custos e desperdícios imediatamente.");
assert("only 100% gets the perfect ação",
  [0,1,2,3,4,5,6].map(n => score(Array.from({length:7}, (_,i) => i < n ? 1 : 0))
    .overall.acaoImediataPt === allSim.overall.acaoImediataPt),
  [false, false, false, false, false, false, false]);

// ── LEGACY QUIRK: question 6's polarity is NOT inverted ──────────────────
// q6 asks whether avoidable waste EXISTS — a real-world "bad" Sim. The legacy
// tool still counts it as a point, so answering ONLY q6 Sim must score 1/7.
const onlyQ6 = score([0, 0, 0, 0, 0, 1, 0]);
assert("q6 Sim counts as a POINT (legacy quirk preserved)", onlyQ6.score, 1);
assert("q6 Sim → 14%", onlyQ6.pct, 14);
assert("q6 is banded as Sim/success like any other question",
  [onlyQ6.questions[5].band, onlyQ6.questions[5].color], ["sim", "success"]);
// Every question contributes identically — no per-question weighting anywhere.
assert("each single Sim scores the same regardless of which question",
  [0,1,2,3,4,5,6].map(i => score(Array.from({length:7}, (_,j) => j === i ? 1 : 0)).pct),
  [14, 14, 14, 14, 14, 14, 14]);

// ── The percentage across every possible Sim count ───────────────────────
assert("pct for 0..7 Sim",
  [0,1,2,3,4,5,6,7].map(n => score(Array.from({length:7}, (_,i) => i < n ? 1 : 0)).pct),
  [0, 14, 29, 43, 57, 71, 86, 100]);

// ── Bands ────────────────────────────────────────────────────────────────
assert("100% → forte", allSim.overall.level, "forte");
assert("57% → moderada", r.overall.level, "moderada");
assert("0% → fragil", allNao.overall.level, "fragil");
assert("86% (6 Sim) → forte", score([1,1,1,1,1,1,0]).overall.level, "forte");
assert("43% (3 Sim) → fragil", score([1,1,1,0,0,0,0]).overall.level, "fragil");

// ── Charts ───────────────────────────────────────────────────────────────
assert("two charts emitted", Object.keys(r.charts).sort(), ["areaBar", "responseDoughnut"]);
assert("bar chart has ONE bar", r.charts.areaBar.bars.length, 1);
assert("bar is labelled FINANCEIRO", r.charts.areaBar.bars[0].labelPt, "FINANCEIRO");
assert("bar is flat gray", r.charts.areaBar.bars[0].hex, "#6c757d");
assert("bar y-axis 0..100", [r.charts.areaBar.yMin, r.charts.areaBar.yMax], [0, 100]);
// DECISION: the legacy bar (40) was not derivable from the answers, so the
// bar mirrors the headline instead.
assert("bar value EQUALS the headline pct (legacy 40 was underivable)",
  r.charts.areaBar.bars[0].value, r.pct);
assert("bar tracks the headline across counts",
  [0,4,7].map(n => {
    const x = score(Array.from({length:7}, (_,i) => i < n ? 1 : 0));
    return x.charts.areaBar.bars[0].value === x.pct;
  }), [true, true, true]);

// The doughnut IS verified to match the headline: 4 Sim/3 Não → [4,3,0].
assert("doughnut counts", r.charts.responseDoughnut.slices.map(s => s.count), [4, 3, 0]);
assert("doughnut pcts 57/43/0", r.charts.responseDoughnut.slices.map(s => s.pct), [57, 43, 0]);
assert("doughnut labels Sim/Não/Não respondidas",
  r.charts.responseDoughnut.slices.map(s => s.labelPt), ["Sim", "Não", "Não respondidas"]);
assert("doughnut colours (teal Sim, red Não, gray pending)",
  r.charts.responseDoughnut.slices.map(s => s.hex), ["#4bc0c0", "#dc3545", "#c9cbcf"]);
assert("doughnut Sim slice pct matches the headline exactly",
  r.charts.responseDoughnut.slices[0].pct, r.pct);

// ── Empty / partial answers ──────────────────────────────────────────────
const empty = computePerceptionScore("feedback_360", {});
assert("empty: pct 0", empty.pct, 0);
assert("empty: all 7 unanswered", empty.distribution.nao_respondido, 7);
assert("empty: null values", empty.questions.every(q => q.value === null), true);
assert("empty: doughnut all pending", empty.charts.responseDoughnut.slices.map(s => s.count), [0, 0, 7]);

// An unanswered question costs a point (denominator is the full bank).
const partial = score([1, 1, 1, 1, null, null, null]);
assert("partial: 4 Sim of 7 still = 57%", partial.pct, 57);
assert("partial: 3 unanswered", partial.distribution.nao_respondido, 3);
assert("partial: unanswered are NOT counted as Não", partial.distribution.nao, 0);

// Out-of-scale values must not be counted.
const bad = computePerceptionScore("feedback_360", { q1: 2, q2: true, q3: "1", q4: null });
assert("out-of-scale values count as unanswered", bad.distribution.nao_respondido, 7);
assert("out-of-scale values score 0", bad.pct, 0);

assert("unknown perception type → null", computePerceptionScore("nope", {}), null);

console.log(failures === 0
  ? "\n✅ ALL ASSERTIONS PASSED"
  : "\n❌ " + failures + " ASSERTION(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
