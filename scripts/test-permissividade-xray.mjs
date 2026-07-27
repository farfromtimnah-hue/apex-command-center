// Verification harness for computePermissividadeXrayScore (Raio X de Permissividade).
//
//   node scripts/test-permissividade-xray.mjs
//
// Same slice-and-eval approach as the other instrument harnesses: assertions
// run against the REAL worker source.
//
// The anchor case is the one specified with the instrument:
//   CL=7, CG=4, PR=2, PC=8 → (7+4)-(2+8) = 1 → em Atenção / warning
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
  slice("var PERM_QUESTIONS = [", "function computeAssessmentScore") +
  "\n; Object.assign(globalThis, { computePermissividadeXrayScore, PERM_QUESTIONS," +
  " PERM_CUTOFFS, PERM_INSIGHTS, scale10Band });";

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

const score = (CL, CG, PR, PC) => computePermissividadeXrayScore({ CL, CG, PR, PC });

// ── Structural invariants ────────────────────────────────────────────────
assert("4 indicators", PERM_QUESTIONS.length, 4);
assert("keys are CL,CG,PR,PC", PERM_QUESTIONS.map(q => q.key), ["CL", "CG", "PR", "PC"]);
assert("two competence + two permissiveness",
  PERM_QUESTIONS.map(q => q.side),
  ["competencia", "competencia", "permissividade", "permissividade"]);
assert("every indicator has a chart short label",
  PERM_QUESTIONS.every(q => q.shortPt && q.shortEn), true);

// ── THE documented verification case ─────────────────────────────────────
// CL=7, CG=4, PR=2, PC=8 → (7+4) - (2+8) = 11 - 10 = 1 → 0..10 → em Atenção
const r = score(7, 4, 2, 8);
assert("anchor pontos = 1", r.pontos, 1);
assert("anchor band = em Atenção", r.overall.labelPt, "Resultado Empresarial em Atenção");
assert("anchor color = warning", r.overall.color, "warning");
assert("anchor level", r.overall.level, "atencao");
assert("anchor headline interpolates pontos",
  r.overall.headlinePt, "Resultado Empresarial em Atenção (1 pontos).");
assert("anchor raw echoed back", r.raw, { CL: 7, CG: 4, PR: 2, PC: 8 });
assert("assessment_type stamped", r.assessment_type, "permissividade_xray");

// ── The subtraction formula across its full range ────────────────────────
assert("max: 10,10,0,0 → +20", score(10, 10, 0, 0).pontos, 20);
assert("min: 0,0,10,10 → -20", score(0, 0, 10, 10).pontos, -20);
assert("all zeros → 0", score(0, 0, 0, 0).pontos, 0);
assert("all tens → 0", score(10, 10, 10, 10).pontos, 0);
assert("pontos range declared", [score(0,0,0,0).min_pontos, score(0,0,0,0).max_pontos], [-20, 20]);

// ── Band boundaries (verified: >10 excelente, 0..10 atenção, <0 crítico) ──
assert("pontos 20 → Excelente", score(10, 10, 0, 0).overall.level, "excelente");
assert("pontos 11 → Excelente (first point above the boundary)",
  score(10, 10, 9, 0).pontos === 11 && score(10, 10, 9, 0).overall.level === "excelente", true);
assert("pontos 10 → em Atenção (boundary is inclusive on the low side)",
  score(10, 10, 10, 0).pontos === 10 && score(10, 10, 10, 0).overall.level === "atencao", true);
assert("pontos 0 → em Atenção", score(5, 5, 5, 5).overall.level, "atencao");
assert("pontos -1 → Crítico",
  score(5, 4, 5, 5).pontos === -1 && score(5, 4, 5, 5).overall.level === "critico", true);
assert("pontos -20 → Crítico", score(0, 0, 10, 10).overall.level, "critico");

// ── Verified band copy ───────────────────────────────────────────────────
const exc = score(10, 10, 0, 0);
assert("excelente headline (verified at pontos=20)",
  exc.overall.headlinePt, "Resultado Empresarial Excelente (20 pontos).");
assert("excelente devolutiva verbatim",
  exc.overall.devolutivaPt.startsWith("Sua empresa possui um alto nível de maturidade."), true);
assert("excelente ação titulo", exc.overall.acaoTituloPt, "Manutenção da Excelência");
assert("excelente ação verbatim tail",
  exc.overall.acaoImediataPt.endsWith("Continue elevando a barra e não permita que o sucesso traga complacência."), true);

const zero = score(5, 5, 5, 5);
assert("atenção headline (verified at pontos=0)",
  zero.overall.headlinePt, "Resultado Empresarial em Atenção (0 pontos).");
assert("atenção devolutiva verbatim",
  zero.overall.devolutivaPt.startsWith("O equilíbrio entre competências e permissividade é frágil."), true);
assert("atenção ação verbatim tail",
  zero.overall.acaoImediataPt.endsWith("Reforce os rituais de feedback e cobrança de metas (KPIs)."), true);

const crit = score(0, 0, 10, 10);
assert("crítico headline (verified at pontos=-20)",
  crit.overall.headlinePt, "Resultado Empresarial Crítico (-20 pontos).");
assert("crítico devolutiva verbatim",
  crit.overall.devolutivaPt.startsWith("Situação de alto risco."), true);

// ── Every Ação Imediata restates the raw inputs ──────────────────────────
assert("ação restates inputs (PT)",
  r.overall.acaoImediataPt.startsWith("Com base nos seus números de hoje (CL:7, CG:4, PR:2, PC:8), sua prioridade deve ser: "), true);
assert("ação restates inputs (EN)",
  r.overall.acaoImediataEn.startsWith("Based on today's numbers (CL:7, CG:4, PR:2, PC:8), your priority should be: "), true);
assert("input restatement present in every band",
  [exc, zero, crit].every(x => /CL:\d+, CG:\d+, PR:\d+, PC:\d+/.test(x.overall.acaoImediataPt)), true);

// ── Conditional insight paragraphs ───────────────────────────────────────
// Thresholds reuse the family's 0-3 low / 8-10 high convention.
const keysOf = (x) => x.insights.map(i => i.key);
assert("weak base fires when CL is low", keysOf(score(2, 8, 0, 0)).includes("base_fraca"), true);
assert("weak base fires when CG is low", keysOf(score(8, 2, 0, 0)).includes("base_fraca"), true);
assert("solid base fires when BOTH are high", keysOf(score(9, 9, 0, 0)).includes("base_solida"), true);
assert("solid base does NOT fire when only one is high",
  keysOf(score(9, 5, 0, 0)).includes("base_solida"), false);
assert("base_fraca and base_solida are mutually exclusive",
  [score(2,8,0,0), score(9,9,0,0), score(5,5,0,0), score(0,0,10,10)]
    .every(x => !(keysOf(x).includes("base_fraca") && keysOf(x).includes("base_solida"))), true);
assert("rigor com metas fires when PR is high", keysOf(score(5, 5, 9, 0)).includes("rigor_metas"), true);
assert("rigor com metas silent when PR is low", keysOf(score(5, 5, 1, 0)).includes("rigor_metas"), false);
assert("cultura e valores fires when PC is high", keysOf(score(5, 5, 0, 9)).includes("cultura_valores"), true);
assert("cultura e valores silent when PC is low", keysOf(score(5, 5, 0, 1)).includes("cultura_valores"), false);
assert("mid-range answers fire nothing", keysOf(score(5, 5, 5, 5)), []);
assert("worst case fires base_fraca + both permissiveness insights",
  keysOf(score(0, 0, 10, 10)).sort(), ["base_fraca", "cultura_valores", "rigor_metas"]);

// Insight text interpolates the raw values, and leaves no placeholders.
const weak = score(2, 3, 0, 0);
assert("insight interpolates {CL} and {CG}",
  weak.insights.filter(i => i.key === "base_fraca")[0].textPt.includes("Liderança (2) ou Gestão (3)"), true);
const highPR = score(5, 5, 9, 0);
assert("insight interpolates {PR}",
  highPR.insights.filter(i => i.key === "rigor_metas")[0].textPt.includes("Resultado (9)"), true);
assert("no placeholder survives anywhere",
  [score(0,0,10,10), score(9,9,9,9), score(2,3,8,8)].some(x =>
    x.insights.some(i => /\{(CL|CG|PR|PC)\}/.test(i.textPt + i.textEn))), false);

// ── Per-indicator banding for the Distribuição display ───────────────────
assert("anchor per-indicator bands", r.indicators.map(i => i.band),
  ["amarelo", "amarelo", "vermelho", "verde"]);
assert("anchor distribution", r.distribution,
  { verde: 1, amarelo: 2, vermelho: 1, nao_respondido: 0, total: 4 });
assert("indicators and categories are the same rows", r.indicators, r.categories);

// ── Chart: ONE bar chart, four bars, no doughnut ─────────────────────────
assert("only the bar chart is emitted", Object.keys(r.charts), ["indicatorBar"]);
assert("bar labels in CL,CG,PR,PC order", r.charts.indicatorBar.bars.map(b => b.labelPt),
  ["Comp. Liderança", "Comp. Gestão", "Perm. Resultado", "Perm. Comportamento"]);
assert("bar values are the raw answers", r.charts.indicatorBar.bars.map(b => b.value), [7, 4, 2, 8]);
assert("bar y-axis 0..10", [r.charts.indicatorBar.yMin, r.charts.indicatorBar.yMax], [0, 10]);
// The legacy tool does NOT invert PR/PC polarity for the chart: a high
// permissiveness still renders green. Reproduced deliberately.
assert("PR/PC are NOT polarity-inverted (legacy behaviour reproduced)",
  r.charts.indicatorBar.bars.map(b => b.hex),
  ["#ffc107", "#ffc107", "#dc3545", "#28a745"]);
assert("high PC (bad in reality) still renders green",
  score(0, 0, 0, 10).charts.indicatorBar.bars[3].hex, "#28a745");

// ── Empty / partial answers must not crash ───────────────────────────────
const empty = computePermissividadeXrayScore({});
assert("empty: pontos 0", empty.pontos, 0);
assert("empty: band em Atenção", empty.overall.level, "atencao");
assert("empty: all unanswered", empty.distribution.nao_respondido, 4);
assert("empty: null values", empty.indicators.every(i => i.value === null), true);
assert("empty: no insights", empty.insights.length, 0);

const partial = computePermissividadeXrayScore({ CL: 10 });
assert("partial: unanswered treated as 0 in the formula", partial.pontos, 10);
assert("partial: 3 unanswered", partial.distribution.nao_respondido, 3);

// Out-of-scale values must not leak into the arithmetic.
const bad = computePermissividadeXrayScore({ CL: 99, CG: -5, PR: "8", PC: null });
assert("out-of-scale values contribute 0", bad.pontos, 0);
assert("out-of-scale values count as unanswered", bad.distribution.nao_respondido, 4);

console.log(failures === 0
  ? "\n✅ ALL ASSERTIONS PASSED"
  : "\n❌ " + failures + " ASSERTION(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
