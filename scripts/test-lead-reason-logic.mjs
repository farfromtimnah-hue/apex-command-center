// Pure rules of the lost reason, pause and finance code in gm.js (2026-11-14).
//
//   node scripts/test-lead-reason-logic.mjs
//
//   - leadIsWorkableToday: false for closed, lost, paused now and "applied and
//     waiting"; otherwise true. (The "leads to call today" screen is a later build.)
//   - Paused now uses the device's LOCAL date, never the UTC date: at 9:30 PM in
//     New York it is already tomorrow in UTC, and the pause must not end early.
//   - The summary tiles the browser recomputes leave paused leads out of every
//     live figure, exactly like the Worker (same leads, same answers as
//     scripts/test-lead-paused-summary.mjs).
//   - The validators agree with the Worker's limits.
process.env.TZ = "America/New_York";
import { LOGIC, gmFn, gm } from "./fixtures/gm-extract.mjs";

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

const clock = { now: Date.UTC(2026, 10, 14, 2, 30, 0) };   // 9:30 PM Nov 13 in New York, already Nov 14 in UTC
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) { super(clock.now); } else { super(...a); } }
  static now() { return clock.now; }
};

const nowIso = gmFn("gmNowLocalIso"), today = gmFn("gmTodayLocal"), summary = gmFn("gmComputeSummary");
t("gm.js has the pure block and the summary", [LOGIC !== null, nowIso !== null, summary !== null], [true, true, true]);
const api = LOGIC === null ? {} : new Function("var isEn = function() { return false; }; var gmT = function(pt, en) { return pt; };\n" + nowIso + "\n" + today + "\n" + summary + "\n" + LOGIC +
  "\nreturn { gmTodayLocal: gmTodayLocal, gmLeadPausedNow: gmLeadPausedNow, leadIsWorkableToday: leadIsWorkableToday, gmPauseMin: gmPauseMin, gmPauseMax: gmPauseMax," +
  " gmLostReasonProblem: gmLostReasonProblem, gmPauseProblem: gmPauseProblem, gmFinanceProblem: gmFinanceProblem, gmComputeSummary: gmComputeSummary };")();

t("the device date in the evening is the local one, not the UTC one", [api.gmTodayLocal && api.gmTodayLocal(), new RealDate(clock.now).toISOString().slice(0, 10)], ["2026-11-13", "2026-11-14"]);

// ── leadIsWorkableToday ────────────────────────────────────────────────────
const W = api.leadIsWorkableToday || (() => "missing");
const T = "2026-11-13";
t("an ordinary live lead is workable", W({ estagio: "follow_up" }, T), true);
t("a lead with no stage yet is workable", W({}, T), true);
t("a closed lead is not", W({ estagio: "fechado" }, T), false);
t("a lost lead is not", W({ estagio: "perdido" }, T), false);
t("a lead paused until a later date is not", W({ estagio: "follow_up", paused_until: "2026-11-20" }, T), false);
t("a lead paused until tomorrow is not (even though UTC says tomorrow is today)", W({ estagio: "follow_up", paused_until: "2026-11-14" }, T), false);
t("a lead whose pause ends today is workable again", W({ estagio: "follow_up", paused_until: "2026-11-13" }, T), true);
t("a lead whose pause ended yesterday is workable", W({ estagio: "follow_up", paused_until: "2026-11-12" }, T), true);
t("an empty paused_until is not a pause", W({ estagio: "follow_up", paused_until: "" }, T), true);
t("a lead waiting on finance is not", W({ estagio: "negociacao", finance_status: "applied_waiting" }, T), false);
for (const v of ["not_needed", "not_applied", "approved", "not_approved", "other"]) {
  t("finance " + v + " does not stop the lead", W({ estagio: "negociacao", finance_status: v }, T), true);
}
t("nothing at all is not workable", W(null, T), false);
t("the lost reason has no say", W({ estagio: "follow_up", lost_reason: "too_expensive" }, T), true);

// ── Calendar helpers (whole days, never millisecond steps) ────────────────
const G = api;
t("pause min is tomorrow", G.gmPauseMin && G.gmPauseMin("2026-11-13"), "2026-11-14");
t("pause min across a month end", G.gmPauseMin && G.gmPauseMin("2026-11-30"), "2026-12-01");
t("pause min across a year end", G.gmPauseMin && G.gmPauseMin("2026-12-31"), "2027-01-01");
t("pause min on the clock change night (Nov 1) is Nov 2", G.gmPauseMin && G.gmPauseMin("2026-11-01"), "2026-11-02");
t("pause max is two years ahead", G.gmPauseMax && G.gmPauseMax("2026-11-13"), "2028-11-13");
t("pause max clamps Feb 29 to Feb 28", G.gmPauseMax && G.gmPauseMax("2026-02-28"), "2028-02-28");
t("pause max from a leap day lands on Feb 28 two years on", G.gmPauseMax && G.gmPauseMax("2024-02-29"), "2026-02-28");

// ── Validators agree with the Worker ───────────────────────────────────────
const P = G.gmLostReasonProblem || (() => "missing");
t("a reason with nothing chosen is a problem", !!P("", ""), true);
t("a plain reason is fine", P("too_expensive", ""), null);
t("out_of_state needs a code", [!!P("out_of_state", ""), !!P("out_of_state", "ZZ"), P("out_of_state", "FL")], [true, true, null]);
t("out_of_scope needs 1 to 80", [!!P("out_of_scope", "  "), P("out_of_scope", "x"), P("out_of_scope", "x".repeat(80)), !!P("out_of_scope", "x".repeat(81))], [true, null, null, true]);
t("other needs 20 to 300 after trimming", [!!P("other", "y".repeat(19)), P("other", "y".repeat(20)), P("other", "y".repeat(300)), !!P("other", "y".repeat(301)), !!P("other", " ".repeat(5) + "y".repeat(19))], [true, null, null, true, true]);
const D = G.gmPauseProblem || (() => "missing");
t("pause: a date after today and a reason of 3 to 160", [D("2026-11-14", "abc", T), !!D("2026-11-13", "abc", T), !!D("2026-11-14", "ab", T), !!D("2026-11-14", "r".repeat(161), T), D("2028-11-13", "r".repeat(160), T), !!D("2028-11-14", "abc", T), !!D("", "abc", T)],
  [null, true, true, true, null, true, true]);
const F = G.gmFinanceProblem || (() => "missing");
t("finance: Other needs 3 to 120, the rest need nothing", [F("approved", ""), !!F("other", "ab"), F("other", "abc"), !!F("other", "x".repeat(121)), !!F("nope", "")], [null, true, null, true, true]);

// ── The tiles the browser recomputes ──────────────────────────────────────
const lead = (id, o) => Object.assign({ id, estagio: "novo_lead", valor: 0 }, o);
const breach = { data_lead: "2026-11-01T09:00", data_contato: "2026-11-01T10:00", data_estimate: "2026-11-05T09:00" };
const leads = [
  lead("A", Object.assign({ estagio: "follow_up", valor: 1000, paused_until: "2026-11-20" }, breach)),
  lead("B", Object.assign({ estagio: "estimate_enviado", valor: 500 }, breach)),
  lead("C", { estagio: "novo_lead", paused_until: "2026-11-13" }),
  lead("D", { estagio: "perdido", valor: 900, paused_until: "2026-12-01" }),
  lead("E", { estagio: "fechado", valor: 2000 }),
  lead("F", { estagio: "negociacao", valor: 300, paused_until: "" }),
  lead("G", { estagio: "follow_up", valor: 700, paused_until: "2026-11-14" })
];
const pick = (s) => ({ live_count: s.live_count, pipeline_ativo: s.pipeline_ativo, fora_sla_contato: s.fora_sla_contato, fora_sla_estimate: s.fora_sla_estimate, leads_totais: s.leads_totais, receita_fechada: s.receita_fechada, fechados: s.fechados });
t("evening: the tiles leave out A and G, like the Worker", api.gmComputeSummary ? pick(api.gmComputeSummary(leads)) : null,
  { live_count: 3, pipeline_ativo: 800, fora_sla_contato: 1, fora_sla_estimate: 1, leads_totais: 7, receita_fechada: 2000, fechados: 1 });
clock.now = Date.UTC(2026, 10, 14, 15, 0, 0);   // 10 AM Nov 14 in New York
t("next morning: G is back with no write and no job", api.gmComputeSummary ? pick(api.gmComputeSummary(leads)) : null,
  { live_count: 4, pipeline_ativo: 1500, fora_sla_contato: 1, fora_sla_estimate: 1, leads_totais: 7, receita_fechada: 2000, fechados: 1 });
t("the code never uses the UTC date for a pause (no toISOString in the pure block)", /toISOString|getUTCDate\(\) \+ 1|86400000/.test((LOGIC || "").replace(/^\s*\/\/.*$/gm, "")), false);

globalThis.Date = RealDate;
console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
