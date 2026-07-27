// Verification harness for computeFalhasXrayScore (Raio X Falhas).
//
//   node scripts/test-falhas-xray.mjs
//
// This is the INVERTED instrument: a high answer means the failure is more
// present, so 8-10 is Crítico and 0-3 is Adequado — the opposite of every
// other instrument in the family. Several assertions below exist purely to
// pin that inversion down.
//
// The anchor case is the one specified with the instrument:
//   all 27 answered 0 → intensityTotal 0 → healthPct 100 → "Excelente"
//
// NOTE: only the 100% anchor is verified against the legacy tool. The mid and
// low bands' cutoffs and copy are INFERRED (see FALHAS_CUTOFFS); the tests
// below lock in the behaviour that was chosen, not legacy ground truth.
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
  slice("var FALHAS_GROUPS = [", "function computeAssessmentScore") +
  "\n; Object.assign(globalThis, { computeFalhasXrayScore, FALHAS_QUESTIONS," +
  " FALHAS_GROUPS, FALHAS_CUTOFFS, falhasMaxIntensity, falhasHealthPct, scale10Band });";

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

const fill = (v) => {
  const a = {};
  FALHAS_QUESTIONS.forEach(q => { a[q.key] = v; });
  return a;
};

// ── Structural invariants ────────────────────────────────────────────────
assert("27 questions", FALHAS_QUESTIONS.length, 27);
assert("16 operational failures",
  FALHAS_QUESTIONS.filter(q => q.group === "operacionais").length, 16);
assert("11 strategic errors",
  FALHAS_QUESTIONS.filter(q => q.group === "estrategicos").length, 11);
assert("operational keys are f1..f16",
  FALHAS_QUESTIONS.filter(q => q.group === "operacionais").map(q => q.key),
  Array.from({ length: 16 }, (_, i) => "f" + (i + 1)));
assert("strategic keys are e1..e11",
  FALHAS_QUESTIONS.filter(q => q.group === "estrategicos").map(q => q.key),
  Array.from({ length: 11 }, (_, i) => "e" + (i + 1)));
assert("keys are unique",
  FALHAS_QUESTIONS.length, new Set(FALHAS_QUESTIONS.map(q => q.key)).size);
assert("maxIntensity = 270", falhasMaxIntensity(), 270);
assert("two groups declared", FALHAS_GROUPS.map(g => g.key), ["operacionais", "estrategicos"]);
assert("group chart labels are FALHA / ERRO",
  FALHAS_GROUPS.map(g => g.shortPt), ["FALHA", "ERRO"]);

// ── INVERTED banding — the defining property of this instrument ──────────
assert("inverted: 0 → Adequado/verde", scale10Band(0, true).key, "verde");
assert("inverted: 3 → Adequado/verde", scale10Band(3, true).key, "verde");
assert("inverted: 4 → Atenção", scale10Band(4, true).key, "amarelo");
assert("inverted: 7 → Atenção", scale10Band(7, true).key, "amarelo");
assert("inverted: 8 → Crítico/vermelho", scale10Band(8, true).key, "vermelho");
assert("inverted: 10 → Crítico/vermelho", scale10Band(10, true).key, "vermelho");
assert("inverted band labels read correctly",
  [scale10Band(0, true).labelPt, scale10Band(10, true).labelPt], ["Adequado", "Crítico"]);
// The non-inverted direction must be unchanged for the other instruments.
assert("non-inverted is still the other way round",
  [scale10Band(0, false).key, scale10Band(10, false).key], ["vermelho", "verde"]);

// ── THE documented verification case: all 27 answered 0 ──────────────────
const perfect = computeFalhasXrayScore(fill(0));
assert("anchor intensityTotal = 0", perfect.intensity_total, 0);
assert("anchor maxIntensity = 270", perfect.max_intensity, 270);
assert("anchor healthPct = 100", perfect.health_pct, 100);
assert("anchor band = Excelente", perfect.overall.labelPt, "Nível de Saúde Excelente");
assert("anchor color = success", perfect.overall.color, "success");
assert("anchor headline", perfect.overall.headlinePt, "Nível de Saúde Excelente (100%)");
assert("anchor devolutiva verbatim (with 0/270 interpolated)",
  perfect.overall.devolutivaPt,
  "Sua empresa possui poucas falhas operacionais e erros estratégicos (Intensidade total de falhas: 0/270). A operação está rodando com fluidez e a estratégia está bem direcionada.");
assert("anchor ação verbatim",
  perfect.overall.acaoImediataPt, "Mantenha o rigor nos processos e foque em expansão agressiva.");
assert("anchor: all 27 read Adequado", perfect.distribution.verde, 27);
assert("assessment_type stamped", perfect.assessment_type, "falhas_xray");
assert("no placeholder survives",
  /\{(total|max)\}/.test(perfect.overall.devolutivaPt + perfect.overall.devolutivaEn), false);

// ── The formula across its range ─────────────────────────────────────────
assert("all 10s → intensity 270, health 0",
  [computeFalhasXrayScore(fill(10)).intensity_total, computeFalhasXrayScore(fill(10)).health_pct],
  [270, 0]);
assert("all 10s → Crítico", computeFalhasXrayScore(fill(10)).overall.level, "critico");
assert("all 10s → all 27 read Crítico", computeFalhasXrayScore(fill(10)).distribution.vermelho, 27);
assert("all 5s → intensity 135, health 50",
  [computeFalhasXrayScore(fill(5)).intensity_total, computeFalhasXrayScore(fill(5)).health_pct],
  [135, 50]);
assert("healthPct helper matches the headline formula",
  falhasHealthPct(135, 27), 50);
assert("all 5s → all 27 read Atenção", computeFalhasXrayScore(fill(5)).distribution.amarelo, 27);

// ── Band boundaries (INFERRED cutoffs: >=80 / 50-79 / <50) ───────────────
assert("health 100 → excelente", computeFalhasXrayScore(fill(0)).overall.level, "excelente");
assert("health 50 → atencao", computeFalhasXrayScore(fill(5)).overall.level, "atencao");
// 27×6 = 162 → 100 − 60 = 40 → below 50 → crítico
assert("health 40 → critico", computeFalhasXrayScore(fill(6)).overall.level, "critico");
// 27×2 = 54 → 100 − 20 = 80 → exactly the excelente boundary
assert("health 80 → excelente (boundary inclusive)",
  computeFalhasXrayScore(fill(2)).health_pct === 80 &&
  computeFalhasXrayScore(fill(2)).overall.level === "excelente", true);
// A total of 57 → round(57/270*100) = 21 → health 79 → atenção
const at79 = fill(2); at79.f1 = 5;
assert("health 79 → atencao (one point below the boundary)",
  [computeFalhasXrayScore(at79).health_pct, computeFalhasXrayScore(at79).overall.level],
  [79, "atencao"]);
assert("every band interpolates the intensity into its devolutiva",
  [fill(0), fill(5), fill(10)].every(a => {
    const r = computeFalhasXrayScore(a);
    return r.overall.devolutivaPt.includes(r.intensity_total + "/270");
  }), true);

// ── Per-group rollup ─────────────────────────────────────────────────────
// Operational all 10 (160/160 → health 0), strategic all 0 (0/110 → health 100).
const lopsided = {};
FALHAS_QUESTIONS.forEach(q => { lopsided[q.key] = (q.group === "operacionais") ? 10 : 0; });
const lop = computeFalhasXrayScore(lopsided);
assert("group question counts", lop.groups.map(g => g.count), [16, 11]);
assert("group max intensities", lop.groups.map(g => g.maxIntensity), [160, 110]);
assert("group intensities", lop.groups.map(g => g.intensity), [160, 0]);
assert("group health scoped to its OWN question count",
  lop.groups.map(g => g.healthPct), [0, 100]);
assert("lopsided overall intensity = 160", lop.intensity_total, 160);
assert("lopsided overall health = 41", lop.health_pct, 41);
// A group's health must not be computed against the 27-question denominator.
assert("group health is NOT scoped to 27",
  lop.groups[0].healthPct !== falhasHealthPct(160, 27), true);

// ── Charts ───────────────────────────────────────────────────────────────
const r = computeFalhasXrayScore(fill(5));
assert("two charts emitted", Object.keys(r.charts).sort(), ["bandDoughnut", "groupBar"]);
assert("bar chart has exactly 2 bars", r.charts.groupBar.bars.length, 2);
assert("bar labels FALHA / ERRO", r.charts.groupBar.bars.map(b => b.labelPt), ["FALHA", "ERRO"]);
assert("bar values are per-group health", r.charts.groupBar.bars.map(b => b.value), [50, 50]);
assert("bar y-axis 0..100", [r.charts.groupBar.yMin, r.charts.groupBar.yMax], [0, 100]);
assert("bars are FLAT GRAY, not coloured by value",
  r.charts.groupBar.bars.map(b => b.hex), ["#6c757d", "#6c757d"]);
assert("lopsided bar values differ per group",
  lop.charts.groupBar.bars.map(b => b.value), [0, 100]);

// The doughnut must NOT be the legacy Sim/Não one — it uses this
// instrument's own three bands, inverted.
assert("doughnut labels are the 3 bands + pending, NOT Sim/Não",
  r.charts.bandDoughnut.slices.map(s => s.labelPt),
  ["Crítico (8-10)", "Atenção (4-7)", "Adequado (0-3)", "Pendente"]);
assert("doughnut has no Sim/Não label",
  r.charts.bandDoughnut.slices.some(s => /Sim|Não respondidas/.test(s.labelPt)), false);
assert("doughnut colours", r.charts.bandDoughnut.slices.map(s => s.hex),
  ["#dc3545", "#ffc107", "#28a745", "#c9cbcf"]);
assert("doughnut counts (all 5s → all Atenção)",
  r.charts.bandDoughnut.slices.map(s => s.count), [0, 27, 0, 0]);
assert("doughnut pcts", r.charts.bandDoughnut.slices.map(s => s.pct), [0, 100, 0, 0]);
// Inverted: all-10s must fill the CRÍTICO slice, not the Adequado one.
assert("all 10s fill the Crítico slice (inversion end-to-end)",
  computeFalhasXrayScore(fill(10)).charts.bandDoughnut.slices.map(s => s.count), [27, 0, 0, 0]);

// ── Empty / partial answers must not crash ───────────────────────────────
const empty = computeFalhasXrayScore({});
assert("empty: intensity 0", empty.intensity_total, 0);
assert("empty: health 100", empty.health_pct, 100);
assert("empty: all 27 unanswered", empty.distribution.nao_respondido, 27);
assert("empty: null values", empty.categories.every(c => c.value === null), true);
assert("empty: group intensities 0", empty.groups.map(g => g.intensity), [0, 0]);

const partial = computeFalhasXrayScore({ f1: 10, e1: 10 });
assert("partial: intensity 20", partial.intensity_total, 20);
assert("partial: 25 unanswered", partial.distribution.nao_respondido, 25);
assert("partial: 2 critical", partial.distribution.vermelho, 2);

const bad = computeFalhasXrayScore({ f1: 11, f2: -1, f3: "9", f4: null });
assert("out-of-scale values contribute 0 intensity", bad.intensity_total, 0);
assert("out-of-scale values count as unanswered", bad.distribution.nao_respondido, 27);

console.log(failures === 0
  ? "\n✅ ALL ASSERTIONS PASSED"
  : "\n❌ " + failures + " ASSERTION(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
