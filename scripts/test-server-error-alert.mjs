// Server error alerts: Nicole hears within a minute of the FIRST failure,
// through Telegram, and the failure becomes a ticket on the Support panel.
// Real Worker functions on an in-memory database. No network, no production
// database. Telegram is stubbed per test.
//
//   node scripts/test-server-error-alert.mjs
import { makeDb, build } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = [
  "apexErrorSignature", "apexErrorNormalizePath", "apexErrorMaskText", "apexErrorShouldReport",
  "apexErrorGateAndMark", "apexErrorTimeEt", "apexErrorAlertText", "apexErrorSlug",
  "apexErrorTicketId", "apexErrorTextFromResponse", "apexReportServerErrorDo", "apexReportServerError",
  "notifyNicoleTelegram"
];
const VARS = ["APEX_ERROR_REPORT_STATE"];
const MIGRATIONS = ["migrations/support_tickets.sql"];

function world(telegramCalls) {
  const d = makeDb(MIGRATIONS);
  const stubs = {
    fetch: async function (url, opts) {
      telegramCalls.push({ url, opts });
      return { ok: true, json: async () => ({ ok: true }) };
    }
  };
  const F = build(FNS, VARS, stubs);
  // Each world() gets its own in-memory map -- the module-level var is
  // rebuilt fresh by build() per call, so tests never leak state into each other.
  return { d, env: { DB: d.DB, TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_ALERT_CHAT_ID: "123" }, F };
}

function fakeCtx() {
  const pending = [];
  return { waitUntil: (p) => pending.push(p), flush: async () => { await Promise.all(pending); } };
}

function response5xx(status, errorMsg) {
  return new Response(JSON.stringify({ error: errorMsg }), { status, headers: { "Content-Type": "application/json" } });
}

// ── A returned 500 produces one Telegram message and one open ticket ──────
{
  const calls = [];
  const w = world(calls);
  const ctx = fakeCtx();
  const resp = response5xx(500, "Something broke in the lead insert");
  const errText = await w.F.apexErrorTextFromResponse(resp);
  await w.F.apexReportServerError(w.env, ctx, "POST", "/api/gm/leads", 500, errText);
  await ctx.flush();
  ok(calls.length === 1, "exactly one Telegram message sent");
  const tickets = w.d.q("SELECT * FROM support_tickets");
  ok(tickets.length === 1, "exactly one ticket row created");
  ok(tickets[0].status === "open", "the ticket starts open");
  ok(tickets[0].kind === "broken", "the ticket kind is 'broken'");
  ok(tickets[0].reporter_name === "System (auto)", "reporter_name is 'System (auto)'");
  ok(tickets[0].reporter_email === "system", "reporter_email is 'system'");
  ok(tickets[0].page === "/api/gm/leads", "page is the normalized path");
  ok(tickets[0].summary_en.indexOf("[Auto] Server error 500") === 0, "summary_en starts with '[Auto] Server error 500'");
  ok(tickets[0].guidance === null, "guidance is NULL");
  ok(tickets[0].transcript_json === "[]", "transcript_json is the empty array");
  ok(tickets[0].original_words.indexOf("Something broke in the lead insert") !== -1, "the error text reaches original_words");
}

// ── Same signature twice within 30 minutes: one message, one ticket ───────
{
  const calls = [];
  const w = world(calls);
  const ctx = fakeCtx();
  for (let i = 0; i < 2; i++) {
    await w.F.apexReportServerError(w.env, ctx, "POST", "/api/gm/leads", 500, "boom");
  }
  await ctx.flush();
  ok(calls.length === 1, "only one Telegram message for the repeat within 30 minutes");
  ok(w.d.q("SELECT COUNT(*) AS n FROM support_tickets")[0].n === 1, "only one ticket for the repeat within 30 minutes");
}

// ── A different path produces a second message and ticket ─────────────────
{
  const calls = [];
  const w = world(calls);
  const ctx = fakeCtx();
  await w.F.apexReportServerError(w.env, ctx, "POST", "/api/gm/leads", 500, "boom");
  await w.F.apexReportServerError(w.env, ctx, "POST", "/api/gm/invoices", 500, "boom");
  await ctx.flush();
  ok(calls.length === 2, "a different path produces a second Telegram message");
  ok(w.d.q("SELECT COUNT(*) AS n FROM support_tickets")[0].n === 2, "a different path produces a second ticket");
}

// ── 4xx, 401, and OPTIONS never report ─────────────────────────────────────
{
  const calls = [];
  const w = world(calls);
  const ctx = fakeCtx();
  await w.F.apexReportServerError(w.env, ctx, "POST", "/api/gm/leads", 404, "not found");
  await w.F.apexReportServerError(w.env, ctx, "POST", "/api/gm/leads", 401, "unauthorized");
  await w.F.apexReportServerError(w.env, ctx, "OPTIONS", "/api/gm/leads", 500, "preflight should never report");
  await ctx.flush();
  ok(calls.length === 0, "a 4xx, 401, or OPTIONS never sends a Telegram message");
  ok(w.d.q("SELECT COUNT(*) AS n FROM support_tickets")[0].n === 0, "a 4xx, 401, or OPTIONS never creates a ticket");
}

// ── Query string, email, and long token never appear in the alert text ────
{
  const calls = [];
  const w = world(calls);
  const ctx = fakeCtx();
  const errText = "Failed for alice.secret@example.com token=abcdEFGH1234567890ijklMN with query string leaking";
  // Mirrors the real call sites: they pass url.pathname, which never
  // includes the query string in the first place -- this proves that
  // property, not that the masking strips one out after the fact.
  const pathWithoutQuery = new URL("https://x.test/api/gm/leads/8821?ssn=123456789&name=Bob").pathname;
  await w.F.apexReportServerError(w.env, ctx, "GET", pathWithoutQuery, 500, errText);
  await ctx.flush();
  const body = new URLSearchParams(calls[0].opts.body).get("text");
  ok(body.indexOf("ssn=") === -1 && body.indexOf("Bob") === -1, "the query string never appears in the alert text");
  ok(body.indexOf("alice.secret@example.com") === -1, "the email is masked out of the alert text");
  ok(body.indexOf("abcdEFGH1234567890ijklMN") === -1, "the long token is masked out of the alert text");
  const ticket = w.d.q("SELECT * FROM support_tickets")[0];
  ok(ticket.original_words.indexOf("ssn=") === -1 && ticket.original_words.indexOf("Bob") === -1, "the query string never appears in original_words");
  ok(ticket.original_words.indexOf("alice.secret@example.com") === -1, "the email is masked out of original_words");
  ok(ticket.original_words.indexOf("abcdEFGH1234567890ijklMN") === -1, "the long token is masked out of original_words");
  ok(ticket.summary_en.indexOf("alice.secret@example.com") === -1 && ticket.summary_en.indexOf("abcdEFGH1234567890ijklMN") === -1,
     "the email and long token are masked out of summary_en");
}

// ── 10-per-hour cap ─────────────────────────────────────────────────────────
{
  const calls = [];
  const w = world(calls);
  const ctx = fakeCtx();
  for (let i = 0; i < 15; i++) {
    await w.F.apexReportServerError(w.env, ctx, "POST", "/api/route" + i, 500, "boom" + i);
  }
  await ctx.flush();
  ok(calls.length === 10, "at most 10 Telegram messages per hour per Worker instance");
  ok(w.d.q("SELECT COUNT(*) AS n FROM support_tickets")[0].n === 10, "at most 10 tickets per hour per Worker instance");
}

// ── Time formatted in 12-hour Eastern ───────────────────────────────────────
{
  const w = world([]);
  const t = w.F.apexErrorTimeEt();
  ok(/^\d{1,2}:\d{2} (AM|PM) ET$/.test(t), "apexErrorTimeEt formats as h:mm AM/PM ET, got: " + t);
}

// ── Clearing the in-memory map and reporting again in the same hour: the
//    database's INSERT OR IGNORE still leaves exactly one ticket row ───────
// A fresh build() against the SAME database simulates a new Worker instance
// (its own empty in-memory gate) hitting the same failure within the same
// UTC hour -- the gate alone would allow a second send, but the ticket id is
// deterministic per hour+signature, so the database itself refuses the
// duplicate row via INSERT OR IGNORE on the primary key.
{
  const calls = [];
  const d = makeDb(MIGRATIONS);
  const env = { DB: d.DB, TELEGRAM_BOT_TOKEN: "t", TELEGRAM_ALERT_CHAT_ID: "1" };
  const stubs = { fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({}) }; } };
  const ctx = fakeCtx();
  const F1 = build(FNS, VARS, stubs);
  await F1.apexReportServerError(env, ctx, "POST", "/api/gm/leads", 500, "boom");
  await ctx.flush();
  const F2 = build(FNS, VARS, stubs);
  await F2.apexReportServerError(env, ctx, "POST", "/api/gm/leads", 500, "boom again");
  await ctx.flush();
  ok(calls.length === 2, "a fresh in-memory gate (new instance) does send Telegram again");
  ok(d.q("SELECT COUNT(*) AS n FROM support_tickets")[0].n === 1,
     "the database's INSERT OR IGNORE on the deterministic id still leaves exactly one ticket row");
}

// ── An automatic ticket marked resolved is not reopened by a repeat in the
//    same hour ───────────────────────────────────────────────────────────
{
  const calls = [];
  const d = makeDb(MIGRATIONS);
  const env = { DB: d.DB, TELEGRAM_BOT_TOKEN: "t", TELEGRAM_ALERT_CHAT_ID: "1" };
  const stubs = { fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({}) }; } };
  const ctx = fakeCtx();
  const F1 = build(FNS, VARS, stubs);
  await F1.apexReportServerError(env, ctx, "POST", "/api/gm/leads", 500, "boom");
  await ctx.flush();
  const id = d.q("SELECT id FROM support_tickets")[0].id;
  d.raw.prepare("UPDATE support_tickets SET status = 'resolved', resolved_at = '2026-10-19 10:00:00', resolved_by = 'Dev' WHERE id = ?").run(id);
  const F2 = build(FNS, VARS, stubs);
  await F2.apexReportServerError(env, ctx, "POST", "/api/gm/leads", 500, "boom again");
  await ctx.flush();
  const row = d.q("SELECT status FROM support_tickets WHERE id = ?", id)[0];
  ok(row.status === "resolved", "a resolved automatic ticket is not reopened by a repeat failure in the same hour");
  ok(d.q("SELECT COUNT(*) AS n FROM support_tickets")[0].n === 1, "still exactly one ticket row for that hour+signature");
}

// ── A Telegram failure still creates the ticket ─────────────────────────────
{
  const d = makeDb(MIGRATIONS);
  const F = build(FNS, VARS, { fetch: async function () { throw new Error("telegram down"); } });
  const env = { DB: d.DB, TELEGRAM_BOT_TOKEN: "t", TELEGRAM_ALERT_CHAT_ID: "1" };
  const ctx = fakeCtx();
  await F.apexReportServerError(env, ctx, "POST", "/api/gm/leads", 500, "boom");
  await ctx.flush();
  ok(d.q("SELECT COUNT(*) AS n FROM support_tickets")[0].n === 1, "the ticket is created even when Telegram fails");
}

// ── A ticket insert failure still sends the Telegram message and never
//    throws ─────────────────────────────────────────────────────────────
{
  const calls = [];
  const w = world(calls);
  const ctx = fakeCtx();
  // Drop the table so the INSERT fails, without touching the real schema.
  w.d.raw.exec("DROP TABLE support_tickets");
  let threw = false;
  try {
    await w.F.apexReportServerError(w.env, ctx, "POST", "/api/gm/leads", 500, "boom");
    await ctx.flush();
  } catch (e) { threw = true; }
  ok(!threw, "a ticket insert failure never throws out of apexReportServerError");
  ok(calls.length === 1, "the Telegram message still sends when the ticket insert fails");
}

// ── The response returned to the person is unchanged in every case ─────────
{
  const calls = [];
  const w = world(calls);
  const ctx = fakeCtx();
  const resp = response5xx(500, "boom");
  const bodyBefore = await resp.clone().text();
  const statusBefore = resp.status;
  const errText = await w.F.apexErrorTextFromResponse(resp);
  await w.F.apexReportServerError(w.env, ctx, "POST", "/api/gm/leads", resp.status, errText);
  await ctx.flush();
  const bodyAfter = await resp.text();
  ok(resp.status === statusBefore, "the response status is unchanged after reporting");
  ok(bodyAfter === bodyBefore, "the response body is unchanged after reporting (clone() was used, not the original body)");
}

// ── apexErrorNormalizePath masks ids ────────────────────────────────────────
{
  const w = world([]);
  ok(w.F.apexErrorNormalizePath("/api/gm/leads/8821") === "/api/gm/leads/:id", "a 4+ digit run becomes :id");
  ok(w.F.apexErrorNormalizePath("/api/gm/leads/f47ac10b-58cc-4372-a567-0e02b2c3d479") === "/api/gm/leads/:id", "a UUID becomes :id");
  ok(w.F.apexErrorNormalizePath("/api/gm/leads/aVeryLongOpaqueIdentifierToken123") === "/api/gm/leads/:id", "a 20+ char id-shaped segment becomes :id");
  ok(w.F.apexErrorNormalizePath("/api/gm/leads") === "/api/gm/leads", "a plain route is left alone");
}

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS");
process.exit(fail ? 1 : 0);
