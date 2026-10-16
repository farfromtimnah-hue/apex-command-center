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
  "handlePostClientTermsApplyHistory", "handleGetClientTermsForecast"
];
const VARS = ["CLIENT_TERMS_BASE_QUESTIONS", "CLIENT_TERMS_PAUSE_QUESTIONS", "CLIENT_TERMS_SCHEMAS", "CLIENT_TERMS_CARD_KEYS", "SUPPORT_AI_MODEL", "BANK_PAID_WHERE"];
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
    raw.prepare("INSERT INTO invoices (id, client_id, number, status) VALUES (?, ?, ?, 'paid')").run("i" + clientId + n, clientId, "N" + clientId + n);
    raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date) VALUES (?, 'a1', ?, ?)").run("t" + clientId + n, cents, dt);
    raw.prepare("INSERT INTO invoice_payments (id, invoice_id, transaction_id, amount_cents) VALUES (?, ?, ?, ?)").run("p" + clientId + n, "i" + clientId + n, "t" + clientId + n, cents);
  });
}

// ── Question ordering ──────────────────────────────────────────────────────
{
  const w = world();
  let qs = w.F.clientTermsQuestionsFor({ status: "active" });
  ok(qs.length === 12 && qs[0].key === "amount" && qs[1].key === "frequency" && qs[2].key === "due_day" && qs[3].key === "start_date" && qs[4].key === "contract_end" && qs[5].key === "balloon_payment", "active client: 12 base questions, order amount/frequency/due_day/start_date/contract_end/balloon_payment/...");

  qs = w.F.clientTermsQuestionsFor({ status: "paused" });
  ok(qs.length === 15 && qs[0].key === "pause_started" && qs[3].key === "amount", "paused client: 3 pause questions first, then the 12 base");
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

// ── handleGetClientTermsNext: eligibility and ordering ──────────────────────
{
  const w = world();
  seedClient(w.d, "c1", "Active Co", "active");
  seedClient(w.d, "c2", "Closed Co", "closed");
  seedClient(w.d, "c3", "Lead Co", "lead");
  const r = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  ok(r.status === 200 && r.data.client.id === "c1", "only the active client is offered; closed and lead are skipped");
  ok(r.data.question.key === "amount" && r.data.position === 1 && r.data.total === 12, "first question is 'amount', 1 of 12");
  ok(r.data.not_enough_history === true, "a client with no history at all gets the 'not enough history' flag on the first question");
}

// ── History card replaces the typed amount/frequency/due_day questions ─────
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active");
  seedGatorPayments(w.d, "g1", ["2026-08-03", "2026-09-01", "2026-10-01"], 150000);
  const r = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  ok(r.status === 200 && !!r.data.history_card, "three matched monthly payments: the history card is offered instead of a typed question");
  const h = r.data.history_card;
  ok(h.amount && h.amount.amount_cents === 150000 && h.amount.payment_count === 3, "card: amount derived from 3 matched payments");
  ok(h.frequency && h.frequency.frequency === "monthly", "card: frequency derived as monthly");
  ok(h.due_day_needed === true && h.fields_to_save.indexOf("due_day") !== -1, "card: due_day still needs a click even with a suggestion");
  ok(h.payment_count === 3 && h.payment_dates.length === 3, "card: payment dates and count are included for information");

  const row = w.d.q("SELECT answers_json FROM client_terms WHERE client_id = 'g1'")[0];
  ok(!row, "nothing is saved just from loading the card -- no silent save happens when the box loads");
}

// ── Yes on the history card saves exactly the open fields, with the edited due day ──
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active");
  seedGatorPayments(w.d, "g1", ["2026-08-03", "2026-09-01", "2026-10-01"], 150000);
  const applyResp = await w.F.handlePostClientTermsApplyHistory("g1", { json: async () => ({ fields_to_save: ["amount", "frequency", "due_day"], due_day: 1 }) }, w.env);
  ok(applyResp.status === 200 && applyResp.data.ok === true, "apply-history: Yes succeeds");
  const row = w.d.q("SELECT answers_json, confirmed_by FROM client_terms WHERE client_id = 'g1'")[0];
  const saved = JSON.parse(row.answers_json);
  ok(saved.amount.amount_cents === 150000 && saved.frequency.frequency === "monthly" && saved.due_day.due_day === 1, "apply-history: amount, frequency and the (possibly edited) due day are all saved");
  ok(row.confirmed_by && row.confirmed_by.indexOf("payment history") !== -1, "apply-history: confirmed_by records that this came from history, confirmed by a click");

  // The box moves on: due_day is answered, so the next question is start_date.
  const next = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  ok(next.data.question && next.data.question.key === "start_date", "after the card is confirmed, the next question is start_date");
}

// ── Yes is refused with an empty due day ────────────────────────────────────
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active");
  seedGatorPayments(w.d, "g1", ["2026-08-03", "2026-09-01", "2026-10-01"], 150000);
  const applyResp = await w.F.handlePostClientTermsApplyHistory("g1", { json: async () => ({ fields_to_save: ["amount", "frequency", "due_day"] }) }, w.env);
  ok(applyResp.status === 400, "apply-history: Yes is refused when due_day is missing from the body");
  const row = w.d.q("SELECT answers_json FROM client_terms WHERE client_id = 'g1'")[0];
  ok(!row, "apply-history: a refused Yes writes nothing at all, not even the fields that were valid");
}

// ── Correct falls back: the normal typed question flow still works per field ──
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active");
  seedGatorPayments(w.d, "g1", ["2026-08-03", "2026-09-01", "2026-10-01"], 150000);
  // Simulate "Correct it": apply the typed amount question directly, bypassing the card.
  const applyResp = await w.F.handlePostClientTermsApply("g1", { json: async () => ({ question_key: "amount", interpreted: { amount_cents: 999999 } }) }, w.env);
  ok(applyResp.status === 200, "Correct it: the normal typed /apply route still accepts a hand-entered answer for a card field");
  const row = w.d.q("SELECT answers_json FROM client_terms WHERE client_id = 'g1'")[0];
  ok(JSON.parse(row.answers_json).amount.amount_cents === 999999, "Correct it: her typed answer wins over what the card would have saved");
}

// ── A client already answered (Gator-style: amount + frequency confirmed by Nicole) never gets re-asked, and the card still has due_day to confirm ──
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active");
  seedGatorPayments(w.d, "g1", ["2026-08-03", "2026-09-01", "2026-10-01"], 150000);
  w.d.raw.prepare("INSERT INTO client_terms (client_id, answers_json, confirmed_by) VALUES ('g1', ?, 'Nicole')")
    .run(JSON.stringify({ amount: { amount_cents: 150000 }, frequency: { frequency: "monthly" } }));
  const r = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  ok(r.status === 200 && !!r.data.history_card, "Gator: amount+frequency already confirmed, due_day still open -- the card still appears for due_day");
  ok(r.data.history_card.amount_already_saved && r.data.history_card.amount_already_saved.amount_cents === 150000, "Gator: the card shows the already-saved amount as a fact");
  ok(!r.data.history_card.amount, "Gator: amount is not offered again as something to save -- it is already confirmed");
  ok(r.data.history_card.fields_to_save.length === 1 && r.data.history_card.fields_to_save[0] === "due_day", "Gator: only due_day is left to save from the card");
}

// ── Silent saving from a previous build is un-done: confirmed_by 'payment history' answers are treated as unconfirmed and re-asked ──
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active");
  seedGatorPayments(w.d, "g1", ["2026-08-03", "2026-09-01", "2026-10-01"], 150000);
  w.d.raw.prepare("INSERT INTO client_terms (client_id, answers_json, confirmed_by) VALUES ('g1', ?, 'payment history')")
    .run(JSON.stringify({ amount: { amount_cents: 150000 }, frequency: { frequency: "monthly" } }));
  const r = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  ok(r.status === 200 && !!r.data.history_card, "an old silent save (confirmed_by = payment history) is stripped back out and the card is offered again");
  ok(r.data.history_card.amount && r.data.history_card.amount.amount_cents === 150000, "the stripped amount is offered again for a real click, not treated as already confirmed");
}

// ── Gator specifically: the first typed question after the card is contract_end's suggestion, not a typed start_and_first_invoice question ──
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active", "growth");
  seedGatorPayments(w.d, "g1", ["2026-08-03", "2026-09-01", "2026-10-01"], 150000);
  w.d.raw.prepare("INSERT INTO client_package_terms (client_id, adjusted_total) VALUES ('g1', 8788)").run();
  w.d.raw.prepare("INSERT INTO client_terms (client_id, answers_json, confirmed_by) VALUES ('g1', ?, 'Nicole')").run(
    JSON.stringify({ amount: { amount_cents: 150000 }, frequency: { frequency: "monthly" }, due_day: { due_day: 1 }, start_date: { start_date: "2026-08-01" } })
  );
  const r = await w.F.handleGetClientTermsNext({ url: "https://x/" }, w.env);
  ok(r.status === 200 && !!r.data.contract_end_suggestion, "Gator: with amount/frequency/due_day/start_date answered, the next thing offered is the contract-end suggestion");
}

// ── Contract-end suggestion: payment-based (the Gator-style case from the prompt) ──
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active");
  seedGatorPayments(w.d, "g1", ["2026-08-03", "2026-09-01", "2026-10-01"], 150000);
  w.d.raw.prepare("INSERT INTO client_package_terms (client_id, adjusted_total) VALUES ('g1', 8788)").run();
  const answers = { amount: { amount_cents: 150000 }, frequency: { frequency: "monthly" } };
  const s = await w.F.clientTermsContractEndSuggestion(w.env, { id: "g1", package: null }, answers);
  ok(s && s.basis === "payments" && !s.paid_in_full, "Gator-style: a payment-based suggestion is produced");
  ok(s.total_cents === 878800 && s.paid_cents === 450000, "Gator-style: total is $8,788.00 and matched paid is $4,500.00 (3 x $1,500), never the raw bank total");
  // remaining = 878800 - 450000 = 428800; /150000 = 2.86 -> 3 payments left; last paid 2026-10-01 + 3 months = 2027-01-01
  ok(s.payments_left === 3 && s.end_date === "2027-01-01", "Gator-style: suggested end date is the last matched payment date plus the remaining whole payments");
}

// ── Contract-end suggestion: overpaid / paid in full ────────────────────────
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active");
  seedGatorPayments(w.d, "g1", ["2026-08-03", "2026-09-01", "2026-10-01"], 150000);
  w.d.raw.prepare("INSERT INTO client_package_terms (client_id, adjusted_total) VALUES ('g1', 4000)").run();
  const answers = { amount: { amount_cents: 150000 }, frequency: { frequency: "monthly" } };
  const s = await w.F.clientTermsContractEndSuggestion(w.env, { id: "g1", package: null }, answers);
  ok(s && s.paid_in_full === true && s.last_paid_date === "2026-10-01", "overpaid: the suggestion says paid in full as of the last matched payment date");
}

// ── Contract-end suggestion: missing package total skips the suggestion entirely ──
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active");
  seedGatorPayments(w.d, "g1", ["2026-08-03", "2026-09-01", "2026-10-01"], 150000);
  // No client_package_terms row at all -- total is unknown.
  const answers = { amount: { amount_cents: 150000 }, frequency: { frequency: "monthly" } };
  const s = await w.F.clientTermsContractEndSuggestion(w.env, { id: "g1", package: null }, answers);
  ok(s === null, "missing package total: no suggestion is produced, contract_end is asked plainly");
}

// ── Contract-end suggestion never uses the raw bank total, only matched invoice_payments ──
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active");
  seedGatorPayments(w.d, "g1", ["2026-08-03", "2026-09-01", "2026-10-01"], 150000);
  // An extra, unmatched bank transaction -- not tied to any invoice_payments row (e.g. the My Pure Filter JV cut).
  w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date) VALUES ('t_extra', 'a1', 672770, '2026-10-05')").run();
  w.d.raw.prepare("INSERT INTO client_package_terms (client_id, adjusted_total) VALUES ('g1', 8788)").run();
  const answers = { amount: { amount_cents: 150000 }, frequency: { frequency: "monthly" } };
  const s = await w.F.clientTermsContractEndSuggestion(w.env, { id: "g1", package: null }, answers);
  ok(s.paid_cents === 450000, "the unmatched extra transaction is never counted -- only the 3 matched $1,500 payments ($4,500.00) feed the suggestion");
}

// ── Contract-end suggestion: start_date + package length fallback ──────────
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active", "growth");
  w.d.raw.prepare("INSERT INTO packages (id, name, short_name, duration_days) VALUES ('pkg_growth', 'Growth', 'growth', 120)").run();
  const answers = { start_date: { start_date: "2026-08-01" } }; // no amount/frequency -> payment-based path unavailable
  const s = await w.F.clientTermsContractEndSuggestion(w.env, { id: "g1", package: "growth" }, answers);
  ok(s && s.basis === "start_date_and_package" && s.end_date === "2026-12-01", "no payment-based data: falls back to start date + package length (120 days ~ 4 months)");
}

// ── Contract-end suggestion: missing monthly amount skips straight to the typed question ──
{
  const w = world();
  seedClient(w.d, "g1", "Gator Co", "active");
  seedGatorPayments(w.d, "g1", ["2026-08-03", "2026-09-01", "2026-10-01"], 150000);
  w.d.raw.prepare("INSERT INTO client_package_terms (client_id, adjusted_total) VALUES ('g1', 8788)").run();
  const answers = {}; // amount/frequency not yet confirmed
  const s = await w.F.clientTermsContractEndSuggestion(w.env, { id: "g1", package: null }, answers);
  ok(s === null, "no confirmed monthly amount: the payment-based suggestion is skipped, and there is no start_date for the fallback either");
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
