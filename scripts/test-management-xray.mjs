// Verification harness for computeManagementXrayScore (Raio X de Gestão).
//
//   node scripts/test-management-xray.mjs
//
// The Worker is a single non-module file with no build step and no test
// runner in this repo, so rather than restructure it, this slices the
// scoring block out of worker/index.js by marker and evals it. That means
// the assertions run against the REAL source — editing a weight, a cutoff
// or the action templates in the Worker is caught here immediately.
//
// The anchor case is the one specified with the instrument:
//   G1=2,G2=1,G3=1,G4=0,G5=1,G6=0,G7=0,G8=1,G9=2,G10=1,G11=2
//   → 6+2+2+0+1+0+0+2+4+2+4 = 23/50 = 46% → GESTÃO DESORGANIZADA
import { readFileSync } from "fs";

const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");

function slice(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  if (a < 0 || b < 0) { throw new Error("markers not found: " + startMarker); }
  return src.slice(a, b);
}

const code =
  slice("var ASSESSMENT_SCALES = {", "var XRAY_AREAS") +
  slice("var MGMT_SCALE_LEVELS = [", "function computeAssessmentScore") +
  "\n; globalThis.computeManagementXrayScore = computeManagementXrayScore;" +
  "\n; globalThis.MGMT_CATEGORIES = MGMT_CATEGORIES;" +
  "\n; globalThis.mgmtMaxScore = mgmtMaxScore;";

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

// ── Structural invariants ────────────────────────────────────────────────
assert("11 categories", MGMT_CATEGORIES.length, 11);
assert("weight sum = 25", MGMT_CATEGORIES.reduce((s, c) => s + c.weight, 0), 25);
assert("max score = 50", mgmtMaxScore(), 50);
assert("every category has 3 PT options",
  MGMT_CATEGORIES.every(c => c.optionsPt.length === 3), true);
assert("every category has 3 EN options",
  MGMT_CATEGORIES.every(c => c.optionsEn.length === 3), true);
assert("weights are 3|2|1 only",
  MGMT_CATEGORIES.every(c => [1, 2, 3].includes(c.weight)), true);

// ── THE documented verification case ─────────────────────────────────────
// G1=2,G2=1,G3=1,G4=0,G5=1,G6=0,G7=0,G8=1,G9=2,G10=1,G11=2
// → 6+2+2+0+1+0+0+2+4+2+4 = 23/50 = 46% → GESTÃO DESORGANIZADA
const G = [2, 1, 1, 0, 1, 0, 0, 1, 2, 1, 2];
const answers = {};
MGMT_CATEGORIES.forEach((c, i) => { answers[c.key] = G[i]; });

const r = computeManagementXrayScore(answers);

assert("score = 23", r.score, 23);
assert("max_score = 50", r.max_score, 50);
assert("pct = 46", r.pct, 46);
assert("band = GESTÃO DESORGANIZADA", r.maturity.labelPt, "GESTÃO DESORGANIZADA");
assert("band level", r.maturity.level, "desorganizada");
assert("band color", r.maturity.color, "danger");
assert("band range", r.maturity.rangePt, "0-49%");

// Per-category weighted scores, in catalog order.
assert("weightedScore per category",
  r.categories.map(c => c.weightedScore), [6, 2, 2, 0, 1, 0, 0, 2, 4, 2, 4]);
assert("weighted sum matches score",
  r.categories.reduce((s, c) => s + c.weightedScore, 0), 23);

// Distribution: values [2,1,1,0,1,0,0,1,2,1,2] → three 0s, five 1s, three 2s.
assert("distribution", r.distribution,
  { vermelho: 3, amarelo: 5, verde: 3, nao_respondido: 0, total: 11 });

// Bucketing.
assert("criticos bucket (value 0)", r.buckets.criticos,
  ["gestao_metas", "processos_procedimentos", "indicadores_desempenho"]);
assert("fortes bucket (value 2)", r.buckets.fortes,
  ["planejamento_estrategico", "avaliacao_desempenho", "controle_conformidade"]);
assert("atencao bucket size", r.buckets.atencao.length, 5);

// Priority derives from weight.
const byKey = {};
r.categories.forEach(c => { byKey[c.key] = c; });
assert("weight 3 → ALTA", byKey.planejamento_estrategico.priorityPt, "ALTA");
assert("weight 2 → MÉDIA", byKey.estrutura_organizacional.priorityPt, "MÉDIA");
assert("weight 1 → BAIXA", byKey.gestao_reunioes.priorityPt, "BAIXA");

// ── Action plan ordering ─────────────────────────────────────────────────
// Non-verde only. value asc, then weight desc, then catalog order.
// value 0: gestao_metas(w3), processos_procedimentos(w3), indicadores_desempenho(w3)
// value 1: estrutura_organizacional(w2), comunicacao_interna(w2),
//          desenvolvimento_pessoas(w2), documentacao_registro(w2), gestao_reunioes(w1)
// → top 4 = the three w3 reds, then estrutura_organizacional.
assert("action plan capped at 4", r.action_plan.length, 4);
assert("action plan order", r.action_plan.map(p => p.categoryKey),
  ["gestao_metas", "processos_procedimentos", "indicadores_desempenho",
   "estrutura_organizacional"]);
assert("action plan tags", r.action_plan.map(p => p.tag),
  ["URGENTE", "URGENTE", "URGENTE", "MELHORIA"]);
assert("timeline ladder", r.action_plan.map(p => p.timeframePt),
  ["2 semanas", "1 mês", "6 semanas", "3 meses"]);
assert("ranks are 1..4", r.action_plan.map(p => p.rank), [1, 2, 3, 4]);
assert("{cat} interpolated in PT", r.action_plan[0].actionsPt[0],
  'Diagnosticar raiz do problema em "Gestão de Metas"');
assert("{cat} interpolated in EN", r.action_plan[0].actionsEn[0],
  'Diagnose the root cause in "Goal Management"');
assert("no {cat} left anywhere",
  r.action_plan.some(p => p.actionsPt.concat(p.actionsEn).some(a => a.includes("{cat}"))), false);
assert("success criterion", r.action_plan[3].criterioSucessoPt,
  "Implementação completa e primeiro ciclo de melhoria em andamento");

// ── Charts ───────────────────────────────────────────────────────────────
assert("bar chart uses full names", r.charts.categoryBar.bars[0].labelPt,
  "Planejamento Estratégico");
assert("bar colors by value",
  r.charts.categoryBar.bars.map(b => b.hex).slice(0, 5),
  ["#28a745", "#ffc107", "#ffc107", "#dc3545", "#ffc107"]);
assert("bar y-axis 0..2", [r.charts.categoryBar.yMin, r.charts.categoryBar.yMax], [0, 2]);
assert("doughnut counts",
  r.charts.responseDoughnut.slices.map(s => s.count), [3, 5, 3, 0]);
assert("doughnut live pcts",
  r.charts.responseDoughnut.slices.map(s => s.pct), [27, 45, 27, 0]);
assert("doughnut colors",
  r.charts.responseDoughnut.slices.map(s => s.hex),
  ["#dc3545", "#ffc107", "#28a745", "#c9cbcf"]);

// ── Band boundary cases (cutoffs: >=80 success, >=50 warning, else danger) ─
function pctBand(target) {
  // Build answers reaching approximately `target` raw score.
  const a = {};
  let remaining = target;
  MGMT_CATEGORIES.forEach(c => {
    const take = Math.min(2, Math.floor(remaining / c.weight));
    a[c.key] = take;
    remaining -= take * c.weight;
  });
  return computeManagementXrayScore(a);
}
assert("50/50 = 100% → CONSOLIDADA", pctBand(50).maturity.labelPt, "GESTÃO CONSOLIDADA");
assert("40/50 = 80% → CONSOLIDADA", pctBand(40).maturity.labelPt, "GESTÃO CONSOLIDADA");
// The exact 80% boundary: 40/50 is CONSOLIDADA (asserted above), and the
// score one point below it must fall to TRANSIÇÃO. Built explicitly rather
// than greedily, since the weight ladder can't express every raw total.
const at39 = {};
MGMT_CATEGORIES.forEach(c => { at39[c.key] = 2; });
at39.gestao_reunioes = 1;         // w1: 50 - 1 = 49 → 98%
at39.estrutura_organizacional = 0; // w2: 49 - 4 = 45 → 90%
at39.comunicacao_interna = 0;      // w2: 45 - 4 = 41 → 82%
at39.desenvolvimento_pessoas = 1;  // w2: 41 - 2 = 39 → 78%
const b39 = computeManagementXrayScore(at39);
assert("39/50 = 78% → TRANSIÇÃO", [b39.score, b39.pct, b39.maturity.labelPt],
  [39, 78, "GESTÃO EM TRANSIÇÃO"]);
const b25 = pctBand(25); // 50%
assert("25/50 = 50% → TRANSIÇÃO", [b25.pct, b25.maturity.labelPt], [50, "GESTÃO EM TRANSIÇÃO"]);
const b24 = pctBand(24); // 48%
assert("24/50 = 48% → DESORGANIZADA", [b24.pct, b24.maturity.labelPt], [48, "GESTÃO DESORGANIZADA"]);
assert("0/50 = 0% → DESORGANIZADA", pctBand(0).maturity.labelPt, "GESTÃO DESORGANIZADA");

// ── Empty / partial answers must not crash or miscount ───────────────────
const empty = computeManagementXrayScore({});
assert("empty: score 0", empty.score, 0);
assert("empty: pct 0", empty.pct, 0);
assert("empty: all unanswered", empty.distribution.nao_respondido, 11);
assert("empty: no action cards", empty.action_plan.length, 0);
assert("empty: null values", empty.categories.every(c => c.value === null), true);
assert("empty: buckets empty",
  empty.buckets.criticos.length + empty.buckets.atencao.length + empty.buckets.fortes.length, 0);

const partial = computeManagementXrayScore({ planejamento_estrategico: 2, gestao_metas: 0 });
assert("partial: score 6", partial.score, 6);
assert("partial: 9 unanswered", partial.distribution.nao_respondido, 9);
assert("partial: 1 action card", partial.action_plan.length, 1);

// All-verde → no action cards at all (only non-verde generate actions).
const allVerde = {};
MGMT_CATEGORIES.forEach(c => { allVerde[c.key] = 2; });
const rv = computeManagementXrayScore(allVerde);
assert("all verde: 50/50 100%", [rv.score, rv.pct], [50, 100]);
assert("all verde: no action cards", rv.action_plan.length, 0);
assert("all verde: fortes = 11", rv.buckets.fortes.length, 11);

console.log(failures === 0
  ? "\n✅ ALL ASSERTIONS PASSED"
  : "\n❌ " + failures + " ASSERTION(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
