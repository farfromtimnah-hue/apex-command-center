// Verification harness for the Meeting Prep ranking and owner-load maths.
//
//   node scripts/test-meeting-prep.mjs
//
// The endpoint itself needs a Firebase staff token, so it cannot be curled
// from CI. These tests instead lift the pure functions out of worker/index.js
// and run them against the SHAPES that actually exist in remote D1 — including
// BRAX's legacy four-area score_json, which is the case that broke every naive
// assumption (four areas not six, evidencePt present, buckets.fortes empty,
// answers_json and profile_json both '{}').
import { readFileSync } from "fs";

const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");

function slice(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  if (a < 0 || b < 0) { throw new Error("markers not found: " + startMarker); }
  return src.slice(a, b);
}

const code =
  slice("var XRAY_PROFILE_ACTIVITIES = [", "// Every catalog declares its `scale`") +
  slice("var MEETING_PATTERNS = [", "// ---------------------------------------------------------------------------\n// Route: GET /api/clients/:id/meeting-prep") +
  "\n; Object.assign(globalThis, { computeOwnerLoad, detectClientPatterns, rankStories," +
  " isMeetingPattern, MEETING_PATTERNS, parseStoryPatterns });";

eval(code);

let failures = 0;
function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n      got      " + JSON.stringify(actual) +
               "\n      expected " + JSON.stringify(expected)));
}

// --- ownerLoad -------------------------------------------------------------
// Never filled in is NOT zero activities. BRAX's profile_json is '{}' and the
// section must disappear rather than assert "the owner does 0 of 12".
assert("ownerLoad: empty profile returns null", computeOwnerLoad({}), null);
assert("ownerLoad: null profile returns null", computeOwnerLoad(null), null);

// Band midpoints: ate_2h=1, de_2_5h=3.5, de_5_10h=7.5, mais_10h=12.
// Two owner activities at 3.5 + 12 = 15.5, reported at -/+25%.
const load = computeOwnerLoad({
  prospeccao_pratica:   { quem: "dono",       tempo: "de_2_5h" },
  fidelizacao_pratica:  { quem: "dono",       tempo: "mais_10h" },
  redes_sociais_pratica:{ quem: "ninguem",    tempo: "nenhum" },
  avaliacoes_pratica:   { quem: "funcionario",tempo: "ate_2h" }
});
assert("ownerLoad: answered counts only answered", load.answered, 4);
assert("ownerLoad: owner count", load.owner_count, 2);
assert("ownerLoad: hours low is -25%", load.hours_low, 11.6);
assert("ownerLoad: hours high is +25%", load.hours_high, 19.4);
assert("ownerLoad: not allOwner when an employee appears", load.allOwner, false);
assert("ownerLoad: total is always the full 12", load.total_activities, 12);

const allOwner = computeOwnerLoad({
  prospeccao_pratica:  { quem: "dono", tempo: "ate_2h" },
  crm_followup_pratica:{ quem: "dono", tempo: "ate_2h" }
});
assert("ownerLoad: allOwner true when every answered activity is the owner", allOwner.allOwner, true);

// An activity with no `quem` is unanswered, not owner-run.
const partial = computeOwnerLoad({ prospeccao_pratica: { tempo: "mais_10h" } });
assert("ownerLoad: missing quem is not answered", partial, null);

// --- pattern detection on BRAX's real legacy shape -------------------------
const braxScore = {
  version: "legacy-4area",
  areas: [
    { key: "financeiro", status: "Moderado", pct: 60 },
    { key: "comercial",  status: "Critico",  pct: 40 },
    { key: "gestao",     status: "Critico",  pct: 30 },
    { key: "marketing",  status: "Critico",  pct: 40 }
  ],
  buckets: { fortes: [], atencao: ["financeiro"], criticos: ["comercial","gestao","marketing"] }
};
const braxPatterns = detectClientPatterns(braxScore, null).sort();
assert("detect: BRAX legacy 4-area yields real patterns", braxPatterns.length > 0, true);
assert("detect: every detected key is one of the eight",
  braxPatterns.every(isMeetingPattern), true);
assert("detect: BRAX weak comercial implies espera_o_cliente_vir",
  braxPatterns.indexOf("espera_o_cliente_vir") > -1, true);
assert("detect: BRAX weak gestao implies tudo_na_cabeca",
  braxPatterns.indexOf("tudo_na_cabeca") > -1, true);

// A six-area modern score must work identically.
const modern = detectClientPatterns({
  areas: [
    { key: "identidade_cultura",  status: "Bom" },
    { key: "estrategia",          status: "Critico" },
    { key: "processos",           status: "Bom" },
    { key: "pessoas",             status: "Bom" },
    { key: "comercial_marketing", status: "Bom" },
    { key: "resultados",          status: "Bom" }
  ]
}, null);
assert("detect: six-area shape works too", modern, ["risco_sem_conselho"]);
assert("detect: no areas yields nothing", detectClientPatterns(null, null), []);
assert("detect: strong areas yield nothing", detectClientPatterns({
  areas: [{ key: "estrategia", status: "Bom" }]
}, null), []);

// Owner load alone can imply dependence even with a clean score.
const byLoad = detectClientPatterns({ areas: [] },
  { owner_count: 7, answered: 7, allOwner: true });
assert("detect: heavy owner load implies dependencia_do_dono",
  byLoad.indexOf("dependencia_do_dono") > -1, true);

// --- story ranking ---------------------------------------------------------
const rows = [
  { id: "pub-generic", person: "P1", source: "public", industry: null,
    patterns: '["zona_de_conforto"]', one_liner: "a", telling_note: "n" },
  { id: "client-two",  person: "P2", source: "client", industry: null,
    patterns: '["tudo_na_cabeca","dependencia_do_dono"]', one_liner: "b", telling_note: "n" },
  { id: "pub-two",     person: "P3", source: "public", industry: null,
    patterns: '["tudo_na_cabeca","dependencia_do_dono"]', one_liner: "c", telling_note: "n" },
  { id: "pub-bottle",  person: "P4", source: "public", industry: null,
    patterns: '["medo_de_prospectar"]', one_liner: "d", telling_note: "n" }
];

// Nothing typed yet: detected patterns decide, then source, then order.
let ranked = rankStories(rows, [], ["tudo_na_cabeca","dependencia_do_dono"], null);
assert("rank: returns ALL stories, never a subset", ranked.length, 4);
assert("rank: two pattern hits outrank one", ranked[0].id, "client-two");
assert("rank: client source breaks a pattern tie", ranked[1].id, "pub-two");

// The typed bottleneck outranks everything: he heard it minutes ago.
ranked = rankStories(rows, ["medo_de_prospectar"], ["tudo_na_cabeca","dependencia_do_dono"], null);
assert("rank: bottleneck match outranks two pattern hits", ranked[0].id, "pub-bottle");
assert("rank: still returns everything", ranked.length, 4);
assert("rank: bottleneck story is flagged matched", ranked[0].matched, true);
assert("rank: bottleneck hit is reported for the why-line",
  ranked[0].matched_bottleneck, ["medo_de_prospectar"]);

// Industry is a TIEBREAKER, never a filter. Diego's story is about fear, not
// flooring: a story from another industry that matches the pattern must still
// outrank a same-industry story that matches nothing.
const indRows = [
  { id: "same-industry-nomatch", source: "public", industry: "Flooring",
    patterns: '["zona_de_conforto"]', one_liner: "x", telling_note: "n" },
  { id: "other-industry-match",  source: "public", industry: "Bakery",
    patterns: '["medo_de_prospectar"]', one_liner: "y", telling_note: "n" }
];
ranked = rankStories(indRows, ["medo_de_prospectar"], [], "Flooring");
assert("rank: industry never filters out a pattern match", ranked[0].id, "other-industry-match");
assert("rank: same-industry story is still present", ranked.length, 2);

// With everything else equal, industry proximity finally decides.
const tieRows = [
  { id: "far",  source: "public", industry: "Bakery",   patterns: '[]', one_liner: "x", telling_note: "n" },
  { id: "near", source: "public", industry: "Flooring", patterns: '[]', one_liner: "y", telling_note: "n" }
];
assert("rank: industry decides a true tie",
  rankStories(tieRows, [], [], "Flooring")[0].id, "near");

// No signal at all still returns every story, in stable order.
ranked = rankStories(rows, [], [], null);
assert("rank: zero signal still returns all", ranked.length, 4);
// With no pattern signal at all, tier 3 still applies: source='client' above
// source='public'. Stability only decides WITHIN a source.
assert("rank: zero signal falls through to client-source first", ranked[0].id, "client-two");
assert("rank: zero signal keeps stable order within a source", ranked[1].id, "pub-generic");
assert("rank: nothing is marked matched with no signal",
  ranked.filter(function(s) { return s.matched; }).length, 0);

// telling_note must survive ranking on every story: it says what must NOT be
// claimed, and the page always renders it.
assert("rank: telling_note preserved on all",
  ranked.every(function(s) { return s.telling_note === "n"; }), true);

// Malformed patterns JSON must not throw.
assert("rank: malformed patterns json is tolerated",
  rankStories([{ id: "bad", source: "public", patterns: "{not json", one_liner: "z", telling_note: "n" }],
    [], [], null)[0].patterns, []);

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURE(S)");
process.exit(failures === 0 ? 0 : 1);
