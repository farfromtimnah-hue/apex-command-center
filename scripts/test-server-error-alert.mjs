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
  "notifyNicoleTelegram", "apexPushAutoTicket",
  "apexTicketEvidenceReady", "apexScrubText", "apexScrubValue", "apexEvidenceStart", "apexEvidenceExtra", "apexBuildEvidence", "apexTicketRepeat", "apexEvidenceTables"
];
const VARS = ["APEX_ERROR_REPORT_STATE", "APEX_ERROR_EVIDENCE", "APEX_EVIDENCE_REQ", "APEX_EVIDENCE_STATE", "APEX_SCRUB_KEY_RE"];
const MIGRATIONS = ["migrations/support_tickets.sql"];

function world(telegramCalls, pushCalls) {
  const d = makeDb(MIGRATIONS);
  const stubs = {
    AUTH_CACHE: new WeakMap(),
    pushToUsers: async function (env, emails, payload) { (pushCalls || []).push({ emails, payload }); },
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

// ── apexErrorMaskText masks every run of 20+ letters or digits ──────────────
{
  const w = world([]);
  ok(w.F.apexErrorMaskText("key sk_live_ABCDEFGHIJKLMNOPQRST1 bad").indexOf("ABCDEFGHIJKLMNOPQRST1") === -1, "a 20+ run with only one digit is masked");
  ok(w.F.apexErrorMaskText("token abcdefghijklmnopqrstuvwxyz ok").indexOf("abcdefghijklmnopqrstuvwxyz") === -1, "a 20+ run of letters only is masked");
  ok(w.F.apexErrorMaskText("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 jwt").indexOf("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9") === -1, "a JWT shaped run is masked");
  ok(w.F.apexErrorMaskText("no such table: support_tickets") === "no such table: support_tickets", "short words and underscores under 20 characters are left alone");
  ok(w.F.apexErrorMaskText("mail maria@example.com here").indexOf("maria@example.com") === -1, "an email is still masked");
}

// ── 2026-11-03: every automatic ticket also pushes the developers ──────────
{
  const tg = [], pushes = [];
  const w = world(tg, pushes);
  await w.d.DB.prepare("CREATE TABLE users (email TEXT, role TEXT)").run();
  await w.d.DB.prepare("INSERT INTO users (email, role) VALUES ('dev@example.com', 'developer'), ('alice@example.com', 'alice')").run();
  const ctx = fakeCtx();
  await w.F.apexReportServerError(w.env, ctx, "POST", "/api/clients/5551/gm/x", 500, "boom");
  await ctx.flush();
  ok(pushes.length === 1 && pushes[0].emails.length === 1 && pushes[0].emails[0] === "dev@example.com", "a new server-error ticket pushes the developer only");
  ok(/Apex ticket/.test(pushes[0].payload.title) && pushes[0].payload.url === "/dashboard.html", "the push names the ticket and opens the dashboard");
  await w.F.apexReportServerErrorDo(w.env, "POST", "/api/clients/:id/gm/x", 500, "boom", "alert", "POST /api/clients/:id/gm/x 500");
  ok(pushes.length === 1, "the same failure in the same hour makes no second push");
  await w.F.notifyNicoleTelegram(w.env, "Apex integration check failed:\n\nZoho Mail: boom");
  const t = (await w.d.DB.prepare("SELECT page, status FROM support_tickets WHERE page = 'telegram-alert'").all()).results || [];
  ok(t.length === 1 && t[0].status === "open", "a plain Telegram alert makes an open ticket");
  ok(pushes.length === 2 && /telegram-alert/.test(pushes[1].payload.title), "a plain Telegram alert also pushes");
  await w.F.notifyNicoleTelegram(w.env, "Apex integration check failed:\n\nZoho Mail: boom");
  ok(pushes.length === 2, "the same plain alert in the same hour makes no second push");
}

{
  // 2026-11-16: one ABC outage fails many routes; they must share one alert per hour.
  const w = world([], []);
  const a = w.F.apexErrorSignature("GET", "/api/clients/:id/gm/abc/items", 502);
  const b = w.F.apexErrorSignature("POST", "/api/clients/:id/gm/abc/drafts/:id/send", 502);
  ok(a === b, "502 on two different ABC routes share one alert signature");
  ok(w.F.apexErrorSignature("GET", "/api/clients/:id/gm/leads", 502) !== a, "a 502 outside ABC keeps its own signature");
  ok(w.F.apexErrorSignature("GET", "/api/clients/:id/gm/abc/items", 500) !== a, "a 500 on an ABC route keeps its own signature");
}


// ══ 2026-11-16: FULL EVIDENCE on every automatic ticket ═══════════════════════════════════════════
// support_tickets gets evidence_json and occurrences (migrations/ticket_evidence.sql). Everything the Worker has at the
// moment of the failure is saved, scrubbed first. Real Worker functions on an in-memory database.
const EV_FNS = FNS.concat(["abcUpstreamError", "abcServerError", "jsonErr2", "metaScrub"]);
const EV_VARS = VARS.concat(["APEX_ERROR_DETAIL", "CORS_HEADERS", "DEFAULT_ORIGIN"]);
function evWorld(withColumns, telegram, pushes) {
  const d = makeDb(["migrations/support_tickets.sql"].concat(withColumns === false ? [] : ["migrations/ticket_evidence.sql"]));
  const AUTH_CACHE = new WeakMap();
  d.raw.exec("CREATE TABLE users (email TEXT, role TEXT); INSERT INTO users (email, role) VALUES ('dev@example.com', 'developer')");
  const stubs = {
    AUTH_CACHE,
    pushToUsers: async (env, emails, payload) => { (pushes || []).push({ emails, payload }); },
    fetch: async (url, opts) => { (telegram || []).push({ url, opts }); return { ok: true, json: async () => ({ ok: true }) }; }
  };
  const F = build(EV_FNS, EV_VARS, stubs);
  return { d, F, AUTH_CACHE, env: { DB: d.DB, TELEGRAM_BOT_TOKEN: "t", TELEGRAM_ALERT_CHAT_ID: "1", CF_VERSION_METADATA: { id: "ver-123" } } };
}
const SECRETS = ["hunter2-PASSWORD", "sk_live_ABCDEF1234567890xyz", "4111 1111 1111 1111", "123-45-6789", "GATE-CODE-4455", "Leave the key under the green pot", "maria.private@example.com", "555-010-0222", "otp-837261"];
function evRequest(extraHeaders, body) {
  return new Request("https://api.test/api/clients/c1/gm/leads/8821/notes?token=sk_live_ABCDEF1234567890xyz&page=2&email=maria.private@example.com", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json", "cf-ray": "8abc123def-MIA", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Test", "Accept-Language": "pt-BR,pt;q=0.9", "Authorization": "Bearer sk_live_ABCDEF1234567890xyz", "Cookie": "session=hunter2-PASSWORD" }, extraHeaders || {}),
    body: JSON.stringify(body || {
      password: "hunter2-PASSWORD", api_key: "sk_live_ABCDEF1234567890xyz", card_number: "4111 1111 1111 1111", ssn: "123-45-6789", addr_access: "GATE-CODE-4455",
      delivery_instructions: "Leave the key under the green pot", contact: { email: "maria.private@example.com", phone: "555-010-0222" }, one_time_code: "otp-837261",
      note: "x".repeat(900), job_name: "Smith roof"
    })
  });
}

{
  // An ABC failure (HTTP 500 from ABC) and what is saved.
  const tg = [], pushes = [];
  const w = evWorld(true, tg, pushes);
  const ctx = fakeCtx();
  const request = evRequest();
  w.AUTH_CACHE.set(request, { role: "client", client_id: "c1", login_role: "client", email: "owner@private.example", display_name: "Zeta Owner" });
  w.F.apexEvidenceStart(request);
  const err = Object.assign(new Error("The server was unable to process the request due to an internal error. Bearer sk_live_ABCDEF1234567890xyz"), { abcStatus: 500, abcCall: { method: "POST", path: "/api/pricing/v2/prices", fields: ["requestId", "shipToNumber", "lines"] } });
  const response = w.F.abcUpstreamError("draft-prices", err, ["sk_live_ABCDEF1234567890xyz"]);
  const errText = await w.F.apexErrorTextFromResponse(response);
  const extra = w.F.apexEvidenceExtra(request, response, err);
  await w.F.apexReportServerError(w.env, ctx, "POST", "/api/clients/c1/gm/abc/drafts/abcdefabcdefabcdefabcdef/prices", 502, errText, extra);
  await ctx.flush();
  const t = w.d.q("SELECT * FROM support_tickets")[0];
  ok(t && t.evidence_json && t.occurrences === 1, "an ABC failure saves evidence_json on the ticket (occurrences starts at 1)");
  const ev = JSON.parse(t.evidence_json);
  ok(ev.method === "POST" && /\/gm\/abc\/drafts\/:id\/prices$/.test(ev.path) && ev.status === 502, "method, normalized path and status");
  ok(ev.query && ev.query.page === "2" && ev.query.token === "[hidden]" && ev.query.email !== "maria.private@example.com", "the query parameters are kept, their values scrubbed");
  ok(ev.cf_ray === "8abc123def-MIA" && ev.worker_version === "ver-123", "the Cloudflare request id and the Worker version id");
  ok(/^\d{4}-\d{2}-\d{2}/.test(ev.time_utc) && /ET|EST|EDT/.test(ev.time_eastern) && typeof ev.duration_ms === "number" && ev.duration_ms >= 0, "the time in UTC and in Eastern, and how long the request took");
  ok(ev.role === "client" && ev.client_id === "c1" && ev.login_role === "client", "the role and the business id come from our records of the signed in user");
  ok(JSON.stringify(ev).indexOf("owner@private.example") === -1, "the signed in person's email is not saved");
  ok(/iPhone/.test(ev.user_agent) && /^pt/.test(ev.language), "the browser and device text and the page language");
  ok(ev.request_body && ev.request_body.job_name === "Smith roof" && ev.request_body.note.length <= 300, "the request body is kept, each value cut to 300 characters");
  ok(ev.response_body && /ABC Supply did not answer/.test(JSON.stringify(ev.response_body)), "the response body that was sent back");
  ok(ev.error_message && /unable to process/.test(ev.error_message) && Array.isArray(ev.stack) && ev.stack.length >= 1 && ev.stack.length <= 20, "the error message and a stack of at most 20 lines");
  ok(ev.abc && ev.abc.step === "draft-prices" && ev.abc.http_status === 500 && /unable to process the request/.test(ev.abc.said) && ev.abc.fields.join() === "requestId,shipToNumber,lines", "for ABC: the step, ABC's HTTP status, ABC's exact scrubbed text and the request FIELD NAMES");
  const all = t.evidence_json + t.original_words + t.summary_en + JSON.stringify(tg);
  const leaked = SECRETS.filter((s) => all.indexOf(s) !== -1 && !(s === "sk_live_ABCDEF1234567890xyz" && false));
  ok(leaked.length === 0, "SCRUB: no password, key, card, social security number, gate code, instruction text, email or phone number reaches the ticket (leaked: " + JSON.stringify(leaked) + ")");
  ok(ev.request_body.contact.email === "m***@example.com" && /\*\*\*|\[phone/.test(JSON.stringify(ev.request_body.contact.phone)) && /22\]?$/.test(JSON.stringify(ev.request_body.contact.phone).replace(/["\]]/g, "")), "emails keep the first letter and the domain, phones keep the last 2 digits");
  ok(tg.length === 1 && pushes.length === 1, "the short Telegram message and the push are as before (one each)");
  ok(new URLSearchParams(tg[0].opts.body).get("text").length < 700, "the Telegram text stays short");
}

{
  // A failure that is not ABC at all: a 500 in a made up route (a thrown error).
  const w = evWorld(true, [], []);
  const ctx = fakeCtx();
  const request = new Request("https://api.test/api/made/up/route", { method: "GET", headers: { "cf-ray": "ray-2", "User-Agent": "Android" } });
  w.F.apexEvidenceStart(request);
  const err = new Error("no such table: gm_made_up_things");
  const extra = w.F.apexEvidenceExtra(request, null, err);
  await w.F.apexReportServerError(w.env, ctx, "GET", "/api/made/up/route", 500, err.message, extra);
  await ctx.flush();
  const t = w.d.q("SELECT * FROM support_tickets")[0];
  const ev = t && t.evidence_json ? JSON.parse(t.evidence_json) : null;
  ok(ev && ev.path === "/api/made/up/route" && ev.status === 500 && ev.cf_ray === "ray-2" && ev.abc === undefined && /no such table/.test(ev.error_message), "a non ABC failure also saves its evidence (no ABC part)");
  ok(ev && ev.tables && ev.tables.indexOf("gm_made_up_things") !== -1, "the database table named in the error is listed");
  ok(ev && ev.role === null, "no signed in user: the role is empty, not invented");
}

{
  // Repeats: same ticket id again adds to occurrences, no new ticket, no new push.
  const tg = [], pushes = [];
  const w = evWorld(true, tg, pushes);
  const ctx = fakeCtx();
  const mk = (ray) => { const r = new Request("https://api.test/api/made/up/route", { method: "GET", headers: { "cf-ray": ray } }); w.AUTH_CACHE.set(r, { role: "client", client_id: "c1" }); w.F.apexEvidenceStart(r); return r; };
  for (let i = 1; i <= 3; i++) {
    const r = mk("ray-" + i);
    await w.F.apexReportServerError(w.env, ctx, "GET", "/api/made/up/route", 500, "boom", w.F.apexEvidenceExtra(r, null, new Error("boom")));
    await ctx.flush();
  }
  const rows = w.d.q("SELECT * FROM support_tickets");
  ok(rows.length === 1 && rows[0].occurrences === 3, "the same failure three times: ONE ticket, occurrences is 3 (got " + (rows[0] && rows[0].occurrences) + ")");
  ok(pushes.length === 1 && tg.length === 1, "no new push and no new Telegram text for the repeats");
  const ev = JSON.parse(rows[0].evidence_json);
  ok(Array.isArray(ev.repeats) && ev.repeats.length === 2 && ev.repeats[1].cf_ray === "ray-3" && ev.repeats[1].role === "client" && typeof ev.repeats[1].time === "string", "each repeat adds a compact record (time, request id, role)");
  for (let i = 4; i <= 40; i++) { const r = mk("ray-" + i); await w.F.apexReportServerError(w.env, ctx, "GET", "/api/made/up/route", 500, "boom", w.F.apexEvidenceExtra(r, null, new Error("boom"))); await ctx.flush(); }
  const ev2 = JSON.parse(w.d.q("SELECT evidence_json FROM support_tickets")[0].evidence_json);
  ok(ev2.repeats.length === 20 && ev2.repeats[19].cf_ray === "ray-40", "at most 20 repeat records are kept (the newest)");
  ok(w.d.q("SELECT * FROM support_tickets").length === 1 && pushes.length === 1, "still one ticket and one push after 40 hits");
  // all 502 on ABC routes share one ticket
  const w2 = evWorld(true, [], []); const c2 = fakeCtx();
  await w2.F.apexReportServerError(w2.env, c2, "GET", "/api/clients/c1/gm/abc/items", 502, "x"); await c2.flush();
  await w2.F.apexReportServerError(w2.env, c2, "POST", "/api/clients/c1/gm/abc/drafts/abc/send", 502, "y"); await c2.flush();
  const r2 = w2.d.q("SELECT * FROM support_tickets");
  ok(r2.length === 1 && r2[0].occurrences === 2, "all 502 errors on ABC routes still share ONE ticket and count as occurrences");
}

{
  // Before the migration: behaves as before.
  const tg = [];
  const w = evWorld(false, tg, []);
  const ctx = fakeCtx();
  const request = evRequest();
  w.F.apexEvidenceStart(request);
  await w.F.apexReportServerError(w.env, ctx, "POST", "/api/made/up/route", 500, "boom", w.F.apexEvidenceExtra(request, null, new Error("boom")));
  await ctx.flush();
  ok(w.d.q("SELECT * FROM support_tickets").length === 1 && tg.length === 1, "without the new columns the ticket is saved exactly as before");
}

{
  // A failing evidence builder never changes or delays the answer, and the old ticket is still made.
  const tg = [];
  const w = evWorld(true, tg, []);
  const ctx = fakeCtx();
  const hostile = { get url() { throw new Error("evidence blew up"); }, get headers() { throw new Error("headers blew up"); }, clone() { throw new Error("clone blew up"); } };
  let extra = null, threw = false;
  try { extra = w.F.apexEvidenceExtra(hostile, null, new Error("x")); } catch (e) { threw = true; }
  ok(!threw, "building the evidence from a request that explodes does not throw");
  const response = new Response(JSON.stringify({ error: "Boom" }), { status: 500 });
  const errText = await w.F.apexErrorTextFromResponse(response);
  await w.F.apexReportServerError(w.env, ctx, "GET", "/api/made/up/route", 500, errText, { throws: true, request: hostile });
  await ctx.flush();
  ok(w.d.q("SELECT * FROM support_tickets").length === 1 && tg.length === 1, "a failing evidence builder still leaves the ticket and the Telegram text");
  ok(response.status === 500 && (await response.json()).error === "Boom", "the response on its way out is unchanged");
}

{
  const w = evWorld(true, [], []);
  const s = w.F.apexScrubText("call 555-010-0222 or (813) 555-0100, mail bob@site.org, card 4111-1111-1111-1111, ssn 123-45-6789, Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123");
  ok(s.indexOf("555-010-0222") === -1 && s.indexOf("(813) 555-0100") === -1 && s.indexOf("bob@site.org") === -1 && s.indexOf("4111") === -1 && s.indexOf("123-45-6789") === -1 && s.indexOf("abcdefghijklmnopqrstuvwxyz0123") === -1 && /b\*\*\*@site\.org/.test(s), "the text scrub masks phones, emails (first letter and domain kept), cards, social security numbers and tokens");
  ok(/22/.test(w.F.apexScrubText("555-010-0222")), "a phone keeps its last 2 digits");
  ok(w.F.apexScrubText("z".repeat(1000)).length <= 300, "a value longer than 300 characters is cut");
}

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS");
process.exit(fail ? 1 : 0);
