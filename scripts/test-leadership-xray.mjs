// Verification harness for computeLeadershipXrayScore (Raio X Nível de Liderança).
//
//   node scripts/test-leadership-xray.mjs
//
// Same slice-and-eval approach as test-management-xray.mjs: the assertions run
// against the REAL worker source, so editing a band cutoff, the verdict copy
// or the majority rule is caught here immediately.
//
// The anchor case is the one specified with the instrument:
//   L1=8,L2=3,L3=6,L4=9,L5=5,L6=2,L7=7,L8=4,L9=6,L10=5
//   → distribution {verde:2, amarelo:6, vermelho:2} → overall warning
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
  slice("var LEAD_QUESTIONS = [", "function computeAssessmentScore") +
  "\n; Object.assign(globalThis, { computeLeadershipXrayScore, LEAD_QUESTIONS," +
  " LEAD_VERDICTS, leadOverallColorKey, scale10Band, scale10Distribution });";

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

const keys = LEAD_QUESTIONS.map(q => q.key);
const answersFrom = (arr) => {
  const a = {};
  keys.forEach((k, i) => { if (arr[i] != null) { a[k] = arr[i]; } });
  return a;
};

// ── Structural invariants ────────────────────────────────────────────────
assert("10 questions", LEAD_QUESTIONS.length, 10);
assert("keys are L1..L10", keys, ["L1","L2","L3","L4","L5","L6","L7","L8","L9","L10"]);
assert("every question has a full PT competency name",
  LEAD_QUESTIONS.every(q => typeof q.namePt === "string" && q.namePt.length > 3), true);
assert("every question has a full EN competency name",
  LEAD_QUESTIONS.every(q => typeof q.nameEn === "string" && q.nameEn.length > 3), true);
assert("no truncated legacy-style labels (no trailing '&')",
  LEAD_QUESTIONS.some(q => /\s&$/.test(q.namePt)), false);

// ── Per-answer banding: 0-3 vermelho, 4-7 amarelo, 8-10 verde ────────────
assert("band 0", scale10Band(0, false).key, "vermelho");
assert("band 3", scale10Band(3, false).key, "vermelho");
assert("band 4", scale10Band(4, false).key, "amarelo");
assert("band 7", scale10Band(7, false).key, "amarelo");
assert("band 8", scale10Band(8, false).key, "verde");
assert("band 10", scale10Band(10, false).key, "verde");
assert("band unanswered → null", scale10Band(undefined, false), null);
assert("band out-of-range 11 → null", scale10Band(11, false), null);
assert("band rejects string", scale10Band("5", false), null);

// ── THE documented verification case ─────────────────────────────────────
// L1=8,L2=3,L3=6,L4=9,L5=5,L6=2,L7=7,L8=4,L9=6,L10=5
// bands:  8→verde 3→verm 6→amar 9→verde 5→amar 2→verm 7→amar 4→amar 6→amar 5→amar
// → verde 2, amarelo 6, vermelho 2 → amarelo has the strict majority → warning
const ANCHOR = [8, 3, 6, 9, 5, 2, 7, 4, 6, 5];
const r = computeLeadershipXrayScore(answersFrom(ANCHOR));

assert("anchor distribution", r.distribution,
  { verde: 2, amarelo: 6, vermelho: 2, nao_respondido: 0, total: 10 });
assert("anchor overall color", r.overall.color, "warning");
assert("anchor overall key", r.overall.key, "amarelo");
assert("anchor devolutiva is the AMARELO copy",
  r.overall.devolutivaPt.startsWith("Sua liderança possui boas intenções e potencial"), true);
assert("anchor ação is the AMARELO copy",
  r.overall.acaoImediataPt.startsWith("Mapeie o que mais toma seu tempo hoje"), true);
assert("anchor per-question values", r.categories.map(c => c.value), ANCHOR);
assert("anchor per-question bands", r.categories.map(c => c.band),
  ["verde","vermelho","amarelo","verde","amarelo","vermelho","amarelo","amarelo","amarelo","amarelo"]);
assert("anchor sum = 55", r.score, 55);
assert("anchor max = 100", r.max_score, 100);
assert("anchor pct = 55", r.pct, 55);
assert("assessment_type stamped", r.assessment_type, "leadership_xray");

// ── The three single-colour verdicts ─────────────────────────────────────
const allTens = computeLeadershipXrayScore(answersFrom(Array(10).fill(10)));
assert("all 8-10 → success", allTens.overall.color, "success");
assert("all verde distribution", allTens.distribution.verde, 10);
assert("verde devolutiva verbatim",
  allTens.overall.devolutivaPt.startsWith("Sua liderança está em alta performance."), true);
assert("verde ação verbatim",
  allTens.overall.acaoImediataPt.startsWith("Mantenha o foco em formar novos líderes"), true);
assert("all 10s → pct 100", allTens.pct, 100);

const allZeros = computeLeadershipXrayScore(answersFrom(Array(10).fill(0)));
assert("all 0-3 → danger", allZeros.overall.color, "danger");
assert("vermelho devolutiva verbatim",
  allZeros.overall.devolutivaPt.startsWith("A situação atual da sua liderança é extremamente frágil."), true);
assert("vermelho ação verbatim",
  allZeros.overall.acaoImediataPt.startsWith("Pare e estruture o básico."), true);
assert("all 0s → pct 0", allZeros.pct, 0);

const allFives = computeLeadershipXrayScore(answersFrom(Array(10).fill(5)));
assert("all 4-7 → warning", allFives.overall.color, "warning");
assert("all amarelo distribution", allFives.distribution.amarelo, 10);

// ── The VERIFIED tie case: 5 verde + 5 vermelho → amarelo ────────────────
// No colour holds a strict majority, so the tie-break default wins.
const split = computeLeadershipXrayScore(answersFrom([10, 10, 10, 10, 10, 0, 0, 0, 0, 0]));
assert("5 verde + 5 vermelho distribution",
  [split.distribution.verde, split.distribution.vermelho, split.distribution.amarelo], [5, 5, 0]);
assert("5/5 tie resolves to amarelo/warning", split.overall.color, "warning");
assert("5/5 tie uses the amarelo copy",
  split.overall.devolutivaPt.startsWith("Sua liderança possui boas intenções"), true);

// Other tie shapes must also fall to amarelo.
const tieVA = computeLeadershipXrayScore(answersFrom([10,10,10,10,10, 5,5,5,5,5]));
assert("5 verde + 5 amarelo tie → warning", tieVA.overall.color, "warning");
const tieRA = computeLeadershipXrayScore(answersFrom([0,0,0,0,0, 5,5,5,5,5]));
assert("5 vermelho + 5 amarelo tie → warning", tieRA.overall.color, "warning");
// A three-way-ish split where verde leads outright still wins.
const verdeLeads = computeLeadershipXrayScore(answersFrom([10,10,10,10, 5,5,5, 0,0,0]));
assert("verde 4 / amarelo 3 / vermelho 3 → success", verdeLeads.overall.color, "success");
const vermLeads = computeLeadershipXrayScore(answersFrom([0,0,0,0, 5,5,5, 10,10,10]));
assert("vermelho 4 / amarelo 3 / verde 3 → danger", vermLeads.overall.color, "danger");

// ── Charts ───────────────────────────────────────────────────────────────
assert("bar chart uses FULL competency names", r.charts.competencyBar.bars[0].labelPt,
  "Admiração e Referência");
assert("bar chart has 10 bars", r.charts.competencyBar.bars.length, 10);
assert("bar y-axis 0..10",
  [r.charts.competencyBar.yMin, r.charts.competencyBar.yMax], [0, 10]);
assert("bar colours by value (red/yellow/green rule)",
  r.charts.competencyBar.bars.map(b => b.hex),
  ["#28a745","#dc3545","#ffc107","#28a745","#ffc107",
   "#dc3545","#ffc107","#ffc107","#ffc107","#ffc107"]);
assert("doughnut counts match distribution",
  r.charts.bandDoughnut.slices.map(s => s.count), [2, 6, 2, 0]);
assert("doughnut live pcts", r.charts.bandDoughnut.slices.map(s => s.pct), [20, 60, 20, 0]);
assert("doughnut labels carry the band ranges",
  r.charts.bandDoughnut.slices.map(s => s.labelPt),
  ["Crítico (0-3)", "Atenção (4-7)", "Excelência (8-10)", "Pendente"]);
assert("doughnut colours (4th is the gray Pendente)",
  r.charts.bandDoughnut.slices.map(s => s.hex),
  ["#dc3545", "#ffc107", "#28a745", "#c9cbcf"]);

// ── Empty / partial answers must not crash or miscount ───────────────────
const empty = computeLeadershipXrayScore({});
assert("empty: all unanswered", empty.distribution.nao_respondido, 10);
assert("empty: null values", empty.categories.every(c => c.value === null), true);
assert("empty: pct 0", empty.pct, 0);
assert("empty: defaults to amarelo", empty.overall.color, "warning");
assert("empty: doughnut is all Pendente",
  empty.charts.bandDoughnut.slices.map(s => s.count), [0, 0, 0, 10]);

const partial = computeLeadershipXrayScore({ L1: 10, L2: 0 });
assert("partial: 8 unanswered", partial.distribution.nao_respondido, 8);
assert("partial: pct over ANSWERED only (10+0 of 20)", partial.pct, 50);
assert("partial: 1-1 tie → amarelo", partial.overall.color, "warning");

// Out-of-scale values are ignored rather than banded.
const bad = computeLeadershipXrayScore({ L1: 11, L2: -1, L3: "8", L4: null });
assert("out-of-scale values count as unanswered", bad.distribution.nao_respondido, 10);

console.log(failures === 0
  ? "\n✅ ALL ASSERTIONS PASSED"
  : "\n❌ " + failures + " ASSERTION(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
