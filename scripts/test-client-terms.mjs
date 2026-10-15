// Client Terms question box: the REAL Worker functions on an in-memory
// SQLite. No network, no production database.
//
//   node scripts/test-client-terms.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = [
  "clientTermsQuestionsFor", "clientTermsValidateReply", "clientTermsAskClaude", "clientTermsRateLimited",
  "clientTermsAuthed", "clientTermsAuth", "clientTermsMonthlyEquivalentCents",
  "handleGetClientTermsNext", "handlePostClientTermsAnswer", "handlePostClientTermsApply",
  "handleGetClientTermsForecast"
];
const VARS = ["CLIENT_TERMS_BASE_QUESTIONS", "CLIENT_TERMS_PAUSE_QUESTIONS", "CLIENT_TERMS_SCHEMAS", "SUPPORT_AI_MODEL"];
const MIGRATIONS = ["migrations/client_terms.sql"];

function world(stubOverrides) {
  const d = makeDb(MIGRATIONS);
  const stubs = Object.assign({}, baseStubs, {
    gmEasternToday: () => TODAY,
    authenticate: async () => ({ role: "alice", display_name: "Alice", email: "alice@test.com" }),
    jsonErr2: function (pt, en, status) { return { status: status || 400, error: en, error_pt: pt, error_en: en }; },
    CLAUDE_API_URL: "https://x.test/claude",
    fetch: async function () { throw new Error("fetch should be stubbed per-test"); }
  }, stubOverrides || {});
  const F = build(FNS, VARS, stubs);
  return { d, env: { DB: d.DB }, F };
}

let TODAY = "2026-10-15";

function seedClient(d, id, name, status) {
  d.raw.prepare("INSERT INTO clients (id, name, status, created_at) VALUES (?, ?, ?, datetime('now'))").run(id, name || id, status || "active");
}

// ── Question ordering ──────────────────────────────────────────────────────
{
  const w = world();
  let qs = w.F.clientTermsQuestionsFor({ status: "active" });
  ok(qs.length === 11 && qs[0].key === "amount", "active client: 11 base questions, amount first");

  qs = w.F.clientTermsQuestionsFor({ status: "paused" });
  ok(qs.length === 14 && qs[0].key === "pause_started" && qs[3].key === "amount", "paused client: 3 pause questions first, then the 11 base");
}

// ── Validation ─────────────────────────────────────────────────────────────
{
  const w = world();
  ok(w.F.clientTermsValidateReply("amount", { amount_cents: 22000 }).ok, "amount: valid cents accepted");
  ok(!w.F.clientTermsValidateReply("amount", { amount_cents: 0 }).ok, "amount: zero rejected");
  ok(w.F.clientTermsValidateReply("amount", { unclear: true }).value.unclear === true, "amount: unclear passes through");
  ok(!w.F.clientTermsValidateReply("amount", { amount_cents: 100, extra_key: 1 }).ok, "amount: extra key rejected (schema is static)");

  ok(w.F.clientTermsValidateReply("frequency", { frequency: "monthly" }).ok, "frequency: monthly accepted");
  ok(!w.F.clientTermsValidateReply("frequency", { frequency: "daily" }).ok, "frequency: unknown value rejected");

  ok(w.F.clientTermsValidateReply("contract_end", { open_ended: true, auto_renews: false }).ok, "contract_end: open-ended needs no end_date");
  ok(!w.F.clientTermsValidateReply("contract_end", { open_ended: false, auto_renews: false }).ok, "contract_end: not open-ended requires end_date");
  ok(w.F.clientTermsValidateReply("contract_end", { open_ended: false, end_date: "2027-01-01", auto_renews: true }).ok, "contract_end: dated end accepted with auto_renews");

  ok(w.F.clientTermsValidateReply("pause_resume", { resume_unknown: true }).value.resume_date === null, "pause_resume: unknown stores null date, never a guess");
  ok(w.F.clientTermsValidateReply("pause_resume", { resume_unknown: false, resume_date: "2026-11-01" }).ok, "pause_resume: known date accepted");
  ok(!w.F.clientTermsValidateReply("pause_resume", { resume_unknown: false }).ok, "pause_resume: known-but-no-date rejected");

  ok(w.F.clientTermsValidateReply("pause_extends_contract", { unknown: true }).value.extends === null, "pause_extends_contract: unknown stores null, never assumed");
}

// ── Monthly equivalent ──────────────────────────────────────────────────────
{
  const w = world();
  ok(w.F.clientTermsMonthlyEquivalentCents(10000, "monthly") === 10000, "monthly: passes through");
  ok(w.F.clientTermsMonthlyEquivalentCents(10000, "weekly") === Math.round(10000 * 52 / 12), "weekly: annualized/12");
  ok(w.F.clientTermsMonthlyEquivalentCents(30000, "quarterly") === 10000, "quarterly: divided by 3");
  ok(w.F.clientTermsMonthlyEquivalentCents(50000, "one_time") === 0, "one_time: contributes 0 to the monthly figure");
}

// ── handleGetClientTermsNext: eligibility and ordering ──────────────────────
{
  const w = world();
  seedClient(w.d, "c1", "Active Co", "active");
  seedClient(w.d, "c2", "Closed Co", "closed");
  seedClient(w.d, "c3", "Lead Co", "lead");
  const r = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  ok(r.status === 200 && r.data.client.id === "c1", "only the active client is offered; closed and lead are skipped");
  ok(r.data.question.key === "amount" && r.data.position === 1 && r.data.total === 11, "first question is 'amount', 1 of 11");
}

// ── Answer -> apply round trip never writes before confirmation ────────────
{
  const w = world({
    fetch: async function () {
      return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ amount_cents: 22000 }) }] }) };
    }
  });
  seedClient(w.d, "c1", "Active Co", "active");
  const ansResp = await w.F.handlePostClientTermsAnswer("c1", { json: async () => ({ question_key: "amount", answer_raw: "duzentos e vinte por mes" }) }, w.env);
  ok(ansResp.status === 200 && ansResp.data.understood === true && ansResp.data.interpreted.amount_cents === 22000, "answer: raw text interpreted by Claude, returned for confirmation");

  let row = w.d.q("SELECT answers_json FROM client_terms WHERE client_id = 'c1'")[0];
  ok(JSON.parse(row.answers_json || "{}").amount === undefined, "answer alone never writes to answers_json -- only apply does");
  let rawRow = w.d.q("SELECT raw_json FROM client_terms WHERE client_id = 'c1'")[0];
  ok(JSON.parse(rawRow.raw_json).amount === "duzentos e vinte por mes", "her raw words are saved verbatim before Claude is even called");

  const applyResp = await w.F.handlePostClientTermsApply("c1", { json: async () => ({ question_key: "amount", interpreted: { amount_cents: 22000 } }) }, w.env);
  ok(applyResp.status === 200 && applyResp.data.ok === true, "apply: succeeds with a validated interpreted value");
  row = w.d.q("SELECT answers_json FROM client_terms WHERE client_id = 'c1'")[0];
  ok(JSON.parse(row.answers_json).amount.amount_cents === 22000, "apply: now written to answers_json");
}

// ── Skip leaves the question empty, never a guess ───────────────────────────
{
  const w = world();
  seedClient(w.d, "c1", "Active Co", "active");
  const skipResp = await w.F.handlePostClientTermsApply("c1", { json: async () => ({ question_key: "setup_fee", skip: true }) }, w.env);
  ok(skipResp.status === 200, "skip: accepted without an interpreted value");
  let row = w.d.q("SELECT answers_json FROM client_terms WHERE client_id = 'c1'")[0];
  ok(JSON.parse(row.answers_json).setup_fee.skipped === true, "skip: recorded as skipped, not a default value");
}

// ── apply never trusts a client round-trip ──────────────────────────────────
{
  const w = world();
  seedClient(w.d, "c1", "Active Co", "active");
  const badResp = await w.F.handlePostClientTermsApply("c1", { json: async () => ({ question_key: "amount", interpreted: { amount_cents: -5 } }) }, w.env);
  ok(badResp.status === 400, "apply: an invalid interpreted value is rejected even if the client sends it directly");
}

// ── Forecast: paused-unknown excluded, contract end stops income ───────────
{
  const w = world();
  seedClient(w.d, "c1", "Steady Co", "active");
  seedClient(w.d, "c2", "Paused Unknown Co", "paused");
  seedClient(w.d, "c3", "Paused Known Co", "paused");
  seedClient(w.d, "c4", "Ended Co", "active");

  function completeTerms(clientId, answers) {
    w.d.raw.prepare("INSERT INTO client_terms (client_id, answers_json, completed) VALUES (?, ?, 1)").run(clientId, JSON.stringify(answers));
  }
  completeTerms("c1", { amount: { amount_cents: 10000 }, frequency: { frequency: "monthly" } });
  completeTerms("c2", { amount: { amount_cents: 10000 }, frequency: { frequency: "monthly" }, pause_resume: { resume_unknown: true, resume_date: null } });
  completeTerms("c3", { amount: { amount_cents: 10000 }, frequency: { frequency: "monthly" }, pause_resume: { resume_unknown: false, resume_date: "2026-10-01" } });
  completeTerms("c4", { amount: { amount_cents: 10000 }, frequency: { frequency: "monthly" }, contract_end: { open_ended: false, end_date: "2026-09-01", auto_renews: false } });

  const r = await w.F.handleGetClientTermsForecast({ url: "https://x/" }, w.env);
  ok(r.status === 200, "forecast endpoint responds");
  const byId = {}; r.data.clients.forEach(c => { byId[c.client_id] = c; });
  ok(!byId.c1.excluded && byId.c1.monthly_cents === 10000, "steady active client counts in full");
  ok(byId.c2.excluded === true, "paused client with unknown resume date is excluded entirely");
  ok(!byId.c3.excluded, "paused client whose resume date has already passed counts again");
  ok(byId.c4.excluded === true && byId.c4.reason === "contract_ended", "income stops after the contract end date");
  ok(r.data.monthly_total_cents === 10000 + 10000, "monthly total only sums the non-excluded clients");
}

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS");
process.exit(fail ? 1 : 0);
