// Task 1.5: text reminders for meetings, through Twilio. Stubbed fetch (no
// network), the REAL Worker functions, an in-memory D1.
//
//   node scripts/test-reminder-texts.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = [
  "reminderTextsEnabled", "reminderTextSenderConfigured", "reminderTextsConfigured", "reminderTextFill",
  "twilioSendSms", "reminderTextOptedOut", "reminderTextSend", "sessionGetsTextReminder",
  "apptRemDateMDY", "apptRemFmt12",
  "sendCounterRead", "sendCounterIncrement", "sendCounterDayKey", "sendCounterMonthKey", "sendCounterMaybeAlert",
  "sendCounterMonthlyCap", "passkeySmsMonthlyCap", "reminderSmsDailyCap", "reminderSmsMonthlyCap",
  "passkeyNormalizePhone", "passkeyCountryCode", "passkeyMaskPhone", "easternDateStr"
];
const VARS = ["REMINDER_TEXT_TEMPLATE_PT", "REMINDER_TEXT_TEMPLATE_EN"];

const BASE_TABLES = [
  "CREATE TABLE send_counters (bucket TEXT NOT NULL, period_key TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, updated_at TEXT, PRIMARY KEY (bucket, period_key))",
  "CREATE TABLE send_counter_alerts (bucket TEXT NOT NULL, period_key TEXT NOT NULL, threshold TEXT NOT NULL, sent_at TEXT, PRIMARY KEY (bucket, period_key, threshold))",
  "CREATE TABLE reminder_text_sends (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, recipient TEXT NOT NULL, phone_e164 TEXT NOT NULL, sent_at TEXT NOT NULL, twilio_sid TEXT, UNIQUE (session_id, recipient))",
  "CREATE TABLE reminder_text_optouts (phone_e164 TEXT PRIMARY KEY, opted_out_at TEXT NOT NULL)"
];

function fakeTwilio(state) {
  return async function fetch(url, init) {
    const params = new URLSearchParams(init.body);
    state.calls.push({ url: String(url), auth: init.headers.Authorization, params: Object.fromEntries(params) });
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (state.nextReply) { const r = state.nextReply; state.nextReply = null; return reply(r.status, r.data); }
    return reply(201, { sid: "SM" + state.calls.length });
  };
}

function world(envOverrides) {
  const d = makeDb([]);
  BASE_TABLES.forEach((s) => d.raw.exec(s));
  const state = { calls: [], telegram: [], nextReply: null };
  const stubs = Object.assign({}, baseStubs, {
    fetch: fakeTwilio(state),
    notifyNicoleTelegram: async (env, msg) => { state.telegram.push(msg); }
  });
  const F = build(FNS, VARS, stubs);
  const env = Object.assign({
    DB: d.DB, TWILIO_ACCOUNT_SID: "ACxxx", TWILIO_API_KEY_SID: "SKxxx", TWILIO_API_KEY_SECRET: "secret",
    TWILIO_FROM_NUMBER: "+15555550123", REMINDER_TEXTS_ENABLED: "1"
  }, envOverrides || {});
  return { d, F, env, state };
}

// ── 1. Configuration gates ──────────────────────────────────────────────────
{
  const w = world();
  ok(w.F.reminderTextsConfigured(w.env) === true, "configured: enabled + sender present");
  ok(w.F.reminderTextsConfigured(Object.assign({}, w.env, { REMINDER_TEXTS_ENABLED: "" })) === false, "not configured: REMINDER_TEXTS_ENABLED off");
  ok(w.F.reminderTextsConfigured(Object.assign({}, w.env, { TWILIO_FROM_NUMBER: "", TWILIO_MESSAGING_SERVICE_SID: "" })) === false, "not configured: no sender");
  ok(w.F.reminderTextsConfigured(Object.assign({}, w.env, { TWILIO_MESSAGING_SERVICE_SID: "MGxxx", TWILIO_FROM_NUMBER: "" })) === true, "configured: MessagingServiceSid alone is enough");
}

// ── 2. Template fill, both languages, merge fields never hardcode a name ──
const TEMPLATE_PT = "Lembrete: sua reunião com {name} de {business} é em {date} às {time}. Responda STOP para não receber mais.";
const TEMPLATE_EN = "Reminder: your meeting with {name} from {business} is on {date} at {time}. Reply STOP to opt out.";
{
  const w = world();
  const pt = w.F.reminderTextFill(TEMPLATE_PT, "Rafael", "Apex", "10/19/2026", "5:00 PM");
  ok(pt.includes("Rafael") && pt.includes("Apex") && pt.includes("10/19/2026") && pt.includes("5:00 PM") && pt.includes("STOP"), "PT template fills every merge field and keeps the STOP line");
  const en = w.F.reminderTextFill(TEMPLATE_EN, "Teo", "JM Luxury Pools", "10/19/2026", "5:00 PM");
  ok(en.includes("Teo") && en.includes("JM Luxury Pools") && en.includes("opt out"), "EN template fills every merge field");
}

// ── 3. Twilio call shape: Basic auth, form fields, MessagingServiceSid preferred over From ──
{
  const w = world({ TWILIO_MESSAGING_SERVICE_SID: "MGxxx" });
  const r = await w.F.twilioSendSms(w.env, "+14075550001", "hello");
  ok(r.ok === true, "send succeeds");
  const call = w.state.calls[0];
  ok(call.auth === "Basic " + Buffer.from("SKxxx:secret").toString("base64"), "Basic auth is (API key sid, secret)");
  ok(call.params.To === "+14075550001" && call.params.Body === "hello", "To/Body carried as form fields");
  ok(call.params.MessagingServiceSid === "MGxxx" && !call.params.From, "MessagingServiceSid preferred over From when both are set");
}
{
  const w = world();
  const r = await w.F.twilioSendSms(w.env, "+14075550001", "hello");
  ok(r.ok === true, "send succeeds with From only");
  ok(w.state.calls[0].params.From === "+15555550123" && !w.state.calls[0].params.MessagingServiceSid, "From used when no MessagingServiceSid is set");
}

// ── 4. 21610 (opted out): recorded, never retried ───────────────────────────
{
  const w = world();
  w.state.nextReply = { status: 400, data: { code: 21610, message: "unsubscribed" } };
  const r1 = await w.F.reminderTextSend(w.env, "s1", "client:c1", "+14075550001", "Rafael", "Apex", "10/19/2026", "5:00 PM", "pt");
  ok(r1.sent === false && r1.reason === "opted_out", "first send: Twilio's 21610 is reported as opted_out");
  ok(await w.F.reminderTextOptedOut(w.env, "+14075550001") === true, "the number is recorded as opted out");
  const before = w.state.calls.length;
  const r2 = await w.F.reminderTextSend(w.env, "s2", "client:c1", "+14075550001", "Rafael", "Apex", "10/19/2026", "5:00 PM", "pt");
  ok(r2.sent === false && r2.reason === "opted_out" && w.state.calls.length === before, "second send to the same number is refused with NO new Twilio call");
}

// ── 5. Never sends twice for the same meeting + recipient ──────────────────
{
  const w = world();
  const r1 = await w.F.reminderTextSend(w.env, "s1", "client:c1", "+14075550002", "Rafael", "Apex", "10/19/2026", "5:00 PM", "pt");
  ok(r1.sent === true, "first send for this session+recipient succeeds");
  const r2 = await w.F.reminderTextSend(w.env, "s1", "client:c1", "+14075550002", "Rafael", "Apex", "10/19/2026", "5:00 PM", "pt");
  ok(r2.sent === false && r2.reason === "already_sent", "a second send for the SAME session+recipient is refused, no new Twilio call");
  ok(w.state.calls.length === 1, "only one Twilio call total");
}

// ── 6. Recorded only AFTER Twilio accepts -- a failed send leaves no row (so the next tick can retry) ──
{
  const w = world();
  w.state.nextReply = { status: 500, data: {} };
  const r = await w.F.reminderTextSend(w.env, "s1", "client:c9", "+14075550003", "Rafael", "Apex", "10/19/2026", "5:00 PM", "pt");
  ok(r.sent === false, "a 500 from Twilio is not treated as sent");
  const row = await w.env.DB.prepare("SELECT 1 AS x FROM reminder_text_sends WHERE session_id = ?").bind("s1").first();
  ok(!row, "no row is written for a failed send");
}

// ── 7. Caps block before any Twilio call ───────────────────────────────────
{
  const w = world({ REMINDER_SMS_DAILY_CAP: "1" });
  const r1 = await w.F.reminderTextSend(w.env, "sA", "client:cA", "+14075550010", "Rafael", "Apex", "10/19/2026", "5:00 PM", "pt");
  ok(r1.sent === true, "first send under the daily cap of 1 succeeds");
  const before = w.state.calls.length;
  const r2 = await w.F.reminderTextSend(w.env, "sB", "client:cB", "+14075550011", "Rafael", "Apex", "10/19/2026", "5:00 PM", "pt");
  ok(r2.sent === false && r2.reason === "daily_cap" && w.state.calls.length === before, "a second meeting is refused once the daily cap is reached, no Twilio call made");
}
{
  const w = world({ REMINDER_SMS_MONTHLY_CAP: "1" });
  const r1 = await w.F.reminderTextSend(w.env, "sC", "client:cC", "+14075550020", "Rafael", "Apex", "10/19/2026", "5:00 PM", "pt");
  ok(r1.sent === true, "first send under the monthly cap of 1 succeeds");
  const r2 = await w.F.reminderTextSend(w.env, "sD", "client:cD", "+14075550021", "Rafael", "Apex", "10/19/2026", "5:00 PM", "pt");
  ok(r2.sent === false && r2.reason === "monthly_cap", "a second meeting is refused once the monthly cap is reached");
}

// ── 8. Not configured: refuses with a reason, no Twilio call, no row ───────
{
  const w = world({ REMINDER_TEXTS_ENABLED: "" });
  const r = await w.F.reminderTextSend(w.env, "sE", "client:cE", "+14075550030", "Rafael", "Apex", "10/19/2026", "5:00 PM", "pt");
  ok(r.sent === false && r.reason === "not_configured", "refuses with not_configured when REMINDER_TEXTS_ENABLED is off");
  ok(w.state.calls.length === 0, "no Twilio call made");
}

// ── 9. sessionGetsTextReminder: scheduling-page booking always eligible; hand-made needs the checkbox ──
{
  const w = world();
  ok(w.F.sessionGetsTextReminder({ created_by: "Agendamento pelo cliente", send_text_reminder: 0 }) === true, "a scheduling-page booking is ALWAYS eligible, even unticked");
  ok(w.F.sessionGetsTextReminder({ created_by: "Rafa", send_text_reminder: 0 }) === false, "a hand-made meeting with the box unticked is not eligible");
  ok(w.F.sessionGetsTextReminder({ created_by: "Rafa", send_text_reminder: 1 }) === true, "a hand-made meeting with the box ticked is eligible");
}

// ── 10. Date format is always month first (rule 2) ──────────────────────────
{
  const w = world();
  ok(w.F.apptRemDateMDY("2026-10-19") === "10/19/2026", "apptRemDateMDY: MM/DD/YYYY");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
