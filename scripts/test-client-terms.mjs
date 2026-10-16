// Client Terms question box: the REAL Worker functions on an in-memory
// SQLite. No network, no production database.
//
//   node scripts/test-client-terms.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = [
  "clientTermsQuestionsFor", "clientTermsDeriveFromHistory", "deriveTermsFromHistory",
  "clientTermsValidateReply", "clientTermsAskClaude", "clientTermsRateLimited",
  "clientTermsAuthed", "clientTermsAuth", "clientTermsMonthlyEquivalentCents",
  "clientTermsStripUnconfirmedHistory", "clientTermsAddMonths",
  "clientTermsContractProgressRows", "clientTermsContractEndSuggestion",
  "handleGetClientTermsNext", "handlePostClientTermsAnswer", "handlePostClientTermsApply",
  "handlePostClientTermsApplyHistory", "handleGetClientTermsForecast",
  "clientTermsPlanAdjust", "clientTermsPlanSummary", "clientTermsBalloonDate", "clientTermsAutoCompletePaid", "handlePostClientTermsApplyPlan", "clientTermsContractEndSuggestion", "clientTermsMergeExtras", "clientTermsInterpretNote", "handlePostClientTermsInterpret", "handlePostClientTermsApplyExtras", "gmEasternToday"
];
const VARS = ["CLIENT_TERMS_BASE_QUESTIONS", "CLIENT_TERMS_PAUSE_QUESTIONS", "CLIENT_TERMS_SCHEMAS", "CLIENT_TERMS_CARD_KEYS", "CLIENT_TERMS_COMING_KEYS", "CLIENT_TERMS_NONE_VALUES", "CLIENT_TERMS_KEY_DOCS", "SUPPORT_AI_MODEL", "BANK_PAID_WHERE"];
const MIGRATIONS = ["migrations/finance_plaid.sql", "migrations/client_terms.sql"];

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

function seedClient(d, id, name, status, pkg) {
  d.raw.prepare("INSERT INTO clients (id, name, status, package, created_at) VALUES (?, ?, ?, ?, datetime('now'))").run(id, name || id, status || "active", pkg || null);
}

function seedGatorPayments(d, clientId, dates, cents) {
  const raw = d.raw;
  dates.forEach(function (dt, n) {
    raw.prepare("INSERT INTO invoices (id, client_id, number, status, issued_at, due_at, amount_cents) VALUES (?, ?, ?, 'paid', ?, ?, ?)").run("i" + clientId + n, clientId, "N" + clientId + n, dt, dt, cents);
    raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES (?, 'a1', ?, ?, 'Zelle payment from CLIENT')").run("t" + clientId + n, cents, dt);
    raw.prepare("INSERT INTO invoice_payments (id, invoice_id, transaction_id, amount_cents) VALUES (?, ?, ?, ?)").run("p" + clientId + n, "i" + clientId + n, "t" + clientId + n, cents);
  });
}

// ── Question ordering: what the forecast, invoicing and the matcher use ─────
{
  const w = world();
  let qs = w.F.clientTermsQuestionsFor({ status: "active" });
  ok(qs.length === 6 && qs.map(function (q) { return q.key; }).join() === "amount,frequency,due_day,payment_method,balloon_payment,contract_end", "active client: 6 questions: amount, frequency, due day, payment method, balloon, contract end (no price change, setup fee, free months, cancel notice, renewals)");
  qs = w.F.clientTermsQuestionsFor({ status: "paused" });
  ok(qs.length === 9 && qs[0].key === "pause_started" && qs[3].key === "amount", "paused client: 3 pause questions first, then the 6");
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

  ok(w.F.clientTermsValidateReply("start_date", { start_date: "2026-08-01" }).ok, "start_date: valid date accepted");
  ok(!w.F.clientTermsValidateReply("start_date", { start_date: "not-a-date" }).ok, "start_date: bad date rejected");

  ok(w.F.clientTermsValidateReply("contract_end", { open_ended: true, auto_renews: false }).ok, "contract_end: open-ended needs no end_date");
  ok(!w.F.clientTermsValidateReply("contract_end", { open_ended: false, auto_renews: false }).ok, "contract_end: not open-ended requires end_date");
  ok(w.F.clientTermsValidateReply("contract_end", { open_ended: false, end_date: "2027-01-01", auto_renews: true }).ok, "contract_end: dated end accepted with auto_renews");

  ok(w.F.clientTermsValidateReply("balloon_payment", { has_balloon: false }).ok, "balloon_payment: no balloon accepted");
  ok(w.F.clientTermsValidateReply("balloon_payment", { has_balloon: true, balloon_cents: 50000, balloon_date: "2027-01-01" }).ok, "balloon_payment: a dated balloon accepted");
  ok(!w.F.clientTermsValidateReply("balloon_payment", { has_balloon: true, balloon_cents: 50000 }).ok, "balloon_payment: has_balloon true without a date is rejected");

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

// ── addMonths keeps day-of-month, clamped to the shorter month ─────────────
{
  const w = world();
  ok(w.F.clientTermsAddMonths("2026-10-01", 4) === "2027-02-01", "addMonths: simple forward case");
  ok(w.F.clientTermsAddMonths("2026-01-31", 1) === "2026-02-28", "addMonths: Jan 31 + 1 month clamps to Feb 28");
}

// ── No history and no plan: ONE box with the six open items ────────────────
{
  const w = world();
  seedClient(w.d, "c1", "Active Co", "active");
  seedClient(w.d, "c2", "Closed Co", "closed");
  seedClient(w.d, "c3", "Lead Co", "lead");
  const r = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  ok(r.status === 200 && r.data.client.id === "c1", "only the active client is offered; closed and lead are skipped");
  ok(!!r.data.intake_card && r.data.intake_card.open.length === 6, "a client with nothing to read gets ONE box listing the 6 items");
}

// ── Gator-style: one card, one Yes, then one end-date tap ───────────────────
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active", "growth");
  seedGatorPayments(w.d, "g1", ["2026-08-03", "2026-09-01", "2026-10-01"], 150000);
  w.d.raw.prepare("INSERT INTO client_package_terms (client_id, adjusted_total, recurrence_unit) VALUES ('g1', 8788, 'months')").run();
  const r = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  const h = r.data.history_card;
  ok(r.status === 200 && !!h, "Gator: one card");
  ok(h.amount.amount_cents === 150000 && h.frequency.frequency === "monthly" && h.payment_method.method === "zelle", "Gator: $1,500 monthly, paid by Zelle (for the invoice matcher)");
  ok(h.due_day_suggestion && h.due_day_suggestion.due_day === 1 && h.fields_to_save.indexOf("due_day") !== -1, "Gator: due day suggested for invoices, still to confirm");
  ok(h.coming_open.length === 1 && h.coming_open[0] === "balloon_payment", "Gator: the only 'anything else' line is about a larger final payment");
  ok(!w.d.q("SELECT * FROM client_terms WHERE client_id = 'g1'").length, "loading the card saves nothing");
  await w.F.handlePostClientTermsApplyHistory("g1", { json: async () => ({ fields_to_save: h.fields_to_save, due_day: 1, nothing_else: true }) }, w.env);
  const saved = JSON.parse(w.d.q("SELECT answers_json FROM client_terms WHERE client_id = 'g1'")[0].answers_json);
  ok(saved.amount.amount_cents === 150000 && saved.frequency.frequency === "monthly" && saved.due_day.due_day === 1 && saved.payment_method.method === "zelle" && saved.balloon_payment.has_balloon === false, "Yes saves amount, frequency, due day, payment method and no balloon");
  const next = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  const e = next.data.contract_end_suggestion;
  ok(!!e && e.end_date === "2027-01-01", "then ONE tap for the end: last payment around 01/01/2027");
  await w.F.handlePostClientTermsApply("g1", { json: async () => ({ question_key: "contract_end", interpreted: { open_ended: false, end_date: e.end_date, auto_renews: false } }) }, w.env);
  const done = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  ok(done.data.client === null, "that is the whole client: nothing else is asked");
}

// ── A balloon already in the plan is stated, not asked: $700 a month then $4,000 ──
{
  const w = world();
  seedClient(w.d, "b1", "Balloon Co", "active");
  seedGatorPayments(w.d, "b1", ["2026-08-01", "2026-09-01"], 70000);
  w.d.raw.prepare("INSERT INTO client_package_terms (client_id, adjusted_total, installment_count, installment_amount, recurrence_unit) VALUES ('b1', 7500, 6, 700, 'months')").run();
  const r = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  const h = r.data.history_card;
  ok(!!h && h.balloon_payment && h.balloon_payment.balloon_cents === 400000 && h.balloon_payment.balloon_date === "2027-01-01", "plan of 6 payments: $700 x 5 then a $4,000 final payment on 01/01/2027, stated on the card");
  ok(h.coming_open.length === 0 && h.fields_to_save.indexOf("balloon_payment") !== -1, "so the balloon is not asked about, it is confirmed");
  await w.F.handlePostClientTermsApplyHistory("b1", { json: async () => ({ fields_to_save: h.fields_to_save, due_day: 1 }) }, w.env);
  const saved = JSON.parse(w.d.q("SELECT answers_json FROM client_terms WHERE client_id = 'b1'")[0].answers_json);
  ok(saved.balloon_payment.has_balloon === true && saved.balloon_payment.balloon_cents === 400000, "Yes saves the balloon for the forecast");
}

// ── Paid in full (Delicie-style): filed as done, never shown ────────────────
{
  const w = world();
  seedClient(w.d, "d1", "Delicie Co", "active", "start");
  w.d.raw.prepare("INSERT INTO client_package_terms (client_id, adjusted_total) VALUES ('d1', 997)").run();
  [["2026-08-07", 50000], ["2026-08-21", 49700]].forEach(function (p, n) {
    w.d.raw.prepare("INSERT INTO invoices (id, client_id, number, status, issued_at, due_at, amount_cents) VALUES (?, 'd1', ?, 'paid', ?, ?, ?)").run("di" + n, "DN" + n, p[0], p[0], p[1]);
    w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES (?, 'a1', ?, ?, 'Zelle payment from X')").run("dt" + n, p[1], p[0]);
    w.d.raw.prepare("INSERT INTO invoice_payments (id, invoice_id, transaction_id, amount_cents) VALUES (?, ?, ?, ?)").run("dp" + n, "di" + n, "dt" + n, p[1]);
  });
  seedClient(w.d, "n1", "Next Co", "active");
  const r = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  ok(r.data.client && r.data.client.id === "n1", "a paid-off package is skipped: the next client is the one she sees");
  const row = w.d.q("SELECT answers_json, completed FROM client_terms WHERE client_id = 'd1'")[0];
  const saved = JSON.parse(row.answers_json);
  ok(row.completed === 1 && saved.frequency.frequency === "one_time" && saved.contract_end.auto_renews === false, "the paid-off client is filed as done, one-time, no renewal");
}

// ── The one box: what she says is filed, read back, and only then saved ─────
{
  const w = world({
    fetch: async function () {
      return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ answers: { amount: { amount_cents: 220000 }, frequency: { frequency: "monthly" }, due_day: { due_day: 5 }, payment_method: { method: "zelle" }, balloon_payment: { has_balloon: false }, contract_end: { open_ended: false, end_date: "2027-03-01", auto_renews: true }, not_a_field: { x: 1 } } }) }] }) };
    }
  });
  seedClient(w.d, "n1", "No History Co", "active");
  const r = await w.F.handlePostClientTermsInterpret("n1", { json: async () => ({ text: "2200 por mes, dia 5, zelle, sem balao, ate marco" }) }, w.env);
  ok(r.status === 200 && r.data.understood === true && r.data.values.amount.amount_cents === 220000 && r.data.values.payment_method.method === "zelle" && r.data.values.due_day.due_day === 5, "interpret: one note is filed into every field it covers");
  ok(!("not_a_field" in r.data.values), "interpret: a field that is not on the list is dropped");
  ok(!w.d.q("SELECT * FROM client_terms WHERE client_id = 'n1'").length, "interpret: nothing is saved until she says Yes");
  await w.F.handlePostClientTermsApplyExtras("n1", { json: async () => ({ values: r.data.values }) }, w.env);
  const saved = JSON.parse(w.d.q("SELECT answers_json FROM client_terms WHERE client_id = 'n1'")[0].answers_json);
  ok(saved.amount.amount_cents === 220000 && saved.contract_end.auto_renews === false, "apply-extras: saved, and a consulting contract never auto-renews");
  const next = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  ok(next.data.client === null, "all six answered: the client is done");
}
{
  const w = world();
  seedClient(w.d, "p1", "Paused Co", "paused");
  const r = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  ok(!!r.data.intake_card && r.data.intake_card.open.length === 9 && r.data.intake_card.open[0].key === "pause_started", "a paused client's box also covers the three pause questions");
  await w.F.handlePostClientTermsApplyExtras("p1", { json: async () => ({ values: {}, skip_keys: r.data.intake_card.open.map(function (q) { return q.key; }) }) }, w.env);
  const after = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  ok(after.data.client === null, "'I don't know' marks the rest as skipped and the client is done");
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

// ── balloon_payment: interpreted and counted once in the forecast month ────
{
  const w = world();
  seedClient(w.d, "c1", "Balloon Co", "active");
  const applyResp = await w.F.handlePostClientTermsApply("c1", { json: async () => ({ question_key: "balloon_payment", interpreted: { has_balloon: true, balloon_cents: 500000, balloon_date: "2027-03-15" } }) }, w.env);
  ok(applyResp.status === 200, "balloon_payment: a dated balloon answer is accepted and applied");

  w.d.raw.prepare("UPDATE client_terms SET completed = 1, answers_json = ? WHERE client_id = 'c1'").run(
    JSON.stringify({ amount: { amount_cents: 10000 }, frequency: { frequency: "monthly" }, balloon_payment: { has_balloon: true, balloon_cents: 500000, balloon_date: "2027-03-15" } })
  );
  const forecast = await w.F.handleGetClientTermsForecast({ url: "https://x/" }, w.env);
  ok(forecast.status === 200, "forecast endpoint responds with a balloon payment present");
  const oneTime = forecast.data.one_time || [];
  ok(oneTime.length === 1 && oneTime[0].kind === "balloon_payment" && oneTime[0].amount_cents === 500000 && oneTime[0].month === "2027-03", "the balloon payment counts once, in the month of its own date, never folded into monthly_cents");
  ok(forecast.data.monthly_total_cents === 10000, "monthly_total_cents is unaffected by the one-time balloon amount");
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
