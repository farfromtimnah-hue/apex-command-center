// Paused leads and the live figures (2026-11-14).
//
//   node scripts/test-lead-paused-summary.mjs
//
// The REAL handleGetGmLeads and its summary SQL run against an in-memory
// SQLite. A lead is paused now when paused_until is later than the client's
// LOCAL today, worked out when the lead list is read: no scheduled job, no
// write on the date. UTC is never used.
//   - live_count, pipeline_ativo and both SLA counts leave out paused leads;
//     closed, lost and total figures are unchanged; paused leads stay listed.
//   - At 9:30 PM in New York (already the next day in UTC) a lead paused until
//     "tomorrow" is still paused; next morning the same lead is back by itself.
import { makeDb, loadWorker, makeStubs, mkReq, USERS, NY, workerSrc } from "./fixtures/lead-reason-harness.mjs";

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};
const state = { user: USERS.owner };
const database = makeDb();
// The list query itself (dozens of estimate and contact joins) is not what is under test:
// it is answered with the plain rows. The summary query runs for real.
const realPrepare = database.DB.prepare;
const env = { DB: { prepare: (sql) => {
  if (/^SELECT l\.\*, p\.name AS parceiro_name/.test(sql)) {
    return { bind: () => ({ all: async () => ({ results: database.q("SELECT * FROM gm_leads WHERE client_id = 'c1' ORDER BY id") }) }) };
  }
  return realPrepare(sql);
}, batch: database.DB.batch } };
const W = loadWorker(makeStubs(state));

const ins = (id, over) => {
  const row = Object.assign({ id, client_id: "c1", cliente: id, estagio: "novo_lead", valor: 0 }, over);
  const k = Object.keys(row);
  database.raw.prepare("INSERT INTO gm_leads (" + k.join(",") + ") VALUES (" + k.map(() => "?").join(",") + ")").run(...k.map((x) => row[x]));
};
const breach = { data_lead: "2026-11-01T09:00", data_contato: "2026-11-01T10:00", data_estimate: "2026-11-05T09:00" };
ins("A-paused-future", Object.assign({ estagio: "follow_up", valor: 1000, paused_until: "2026-11-20", paused_at: "2026-11-10", paused_reason: "Permit" }, breach));
ins("B-live", Object.assign({ estagio: "estimate_enviado", valor: 500 }, breach));
ins("C-ended-today", { estagio: "novo_lead", paused_until: "2026-11-13", paused_at: "2026-11-01", paused_reason: "Travel" });
ins("D-lost", { estagio: "perdido", valor: 900, paused_until: "2026-12-01", paused_reason: "x" });
ins("E-closed", { estagio: "fechado", valor: 2000 });
ins("F-empty-date", { estagio: "negociacao", valor: 300, paused_until: "" });
ins("G-tomorrow", { estagio: "follow_up", valor: 700, paused_until: "2026-11-14", paused_at: "2026-11-12", paused_reason: "Customer away" });

const get = async (nowUtcMs) => {
  const real = Date.now; Date.now = () => nowUtcMs;
  try {
    const res = await W.handleGetGmLeads("c1", mkReq({}, NY, "https://w.example/api/clients/c1/gm/leads"), env);
    return { status: res.status, body: await res.json() };
  } finally { Date.now = real; }
};
const stage = (s) => ({ live_count: s.live_count, pipeline_ativo: s.pipeline_ativo, fora_sla_contato: s.fora_sla_contato, fora_sla_estimate: s.fora_sla_estimate,
  leads_totais: s.leads_totais, receita_fechada: s.receita_fechada, fechados: s.fechados });

// 9:30 PM Nov 13 in New York = 02:30 UTC Nov 14.
let r = await get(Date.UTC(2026, 10, 14, 2, 30));
t("the list answers 200", r.status, 200);
t("evening: live figures leave out A (paused) and G (paused until the client's tomorrow)", stage(r.body.summary || {}),
  { live_count: 3, pipeline_ativo: 800, fora_sla_contato: 1, fora_sla_estimate: 1, leads_totais: 7, receita_fechada: 2000, fechados: 1 });
t("paused leads are still listed (7 rows)", (r.body.leads || []).length, 7);
t("a lead whose pause ended today is live, not paused", (r.body.summary || {}).live_count, 3);

// 10 AM Nov 14 in New York: G's date is today, so G comes back with no job and no write.
const writesBefore = database.writes.length;
r = await get(Date.UTC(2026, 10, 14, 15, 0));
t("next morning: the same lead is back by itself (G counts again)", stage(r.body.summary || {}),
  { live_count: 4, pipeline_ativo: 1500, fora_sla_contato: 1, fora_sla_estimate: 1, leads_totais: 7, receita_fechada: 2000, fechados: 1 });
t("...and reading wrote nothing to the database", database.writes.length, writesBefore);
t("...and the stored paused_until of G is untouched", database.q("SELECT paused_until FROM gm_leads WHERE id = 'G-tomorrow'")[0].paused_until, "2026-11-14");

// A far east evening: a client whose zone is already the next day.
r = await get(Date.UTC(2026, 10, 19, 23, 30));
t("Nov 19, 6:30 PM in New York: A (until Nov 20) is still paused; B, C, F and G are live", (r.body.summary || {}).live_count, 4);
r = await get(Date.UTC(2026, 10, 20, 12, 0));
t("Nov 20, 7 AM in New York: A is back, with its value and its late first contact", stage(r.body.summary || {}),
  { live_count: 5, pipeline_ativo: 2500, fora_sla_contato: 2, fora_sla_estimate: 2, leads_totais: 7, receita_fechada: 2000, fechados: 1 });

// Every other place that counts live leads leaves paused ones out too.
const src = workerSrc;
const entrySql = src.slice(src.indexOf("async function handleGetEntrySuggestions"), src.indexOf("async function handleGetEntrySuggestions") + 9000);
t("the daily log suggestion's pipeline_ativo leaves out paused leads", /AS pipeline_ativo[\s\S]{0,40}/.test(entrySql) && /GM_NOT_PAUSED_SQL/.test(entrySql), true);
const kick = src.slice(src.indexOf("The live pipeline is the CLIENT's own open leads"), src.indexOf("The live pipeline is the CLIENT's own open leads") + 700);
t("the kickoff pipeline count leaves out paused leads", /GM_NOT_PAUSED_SQL/.test(kick), true);

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
