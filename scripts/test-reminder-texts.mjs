// Text messages for meetings (confirmation, reminder, change, cancel), through
// Twilio. Fake Twilio (no network), the REAL Worker functions, an in-memory D1.
// The real migration file is applied on top of the old table, so the rebuild of
// reminder_text_sends is tested with an old row in it.
//
//   node scripts/test-reminder-texts.mjs
import { makeDb, build, baseStubs, workerSrc } from "./fixtures/d1-shim.mjs";
import { readFileSync } from "node:fs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };
async function section(name, fn) { try { await fn(); } catch (e) { ok(false, name + " crashed: " + (e && e.stack || e)); } }

const FNS = [
  "reminderTextsEnabled", "reminderTextSenderConfigured", "reminderTextsConfigured", "reminderTextSwitchOn", "reminderTextLang",
  "reminderTextFill", "reminderTextFormatPhone", "reminderTextFirstName", "reminderTextOwnerFirst",
  "twilioSendSms", "reminderTextOptedOut", "reminderTextSend", "reminderTextConsentAllows", "sessionGetsTextReminder",
  "reminderTextQuiet", "reminderTextMeetingMs", "reminderTextHost", "reminderTextFacts", "reminderTextRefreshSnapshot", "reminderTextDecide", "reminderTextCount",
  "reminderTextHold", "reminderTextDispatch", "reminderTextQueueTick", "reminderTextSessionsBefore", "reminderTextSessionsChanged",
  "reminderTextSnapshots", "reminderTextCancelled", "reminderTextConfirmed", "reminderTextChangedEvent",
  "reminderTextTwiml", "reminderTextOptKind", "reminderTextXmlEscape", "reminderTextFindLast", "reminderTextHandleOptEvent", "reminderTextHelpMessage", "reminderTextHostTargets", "reminderTextHandleReply", "reminderTextPushDeveloper", "reminderTextPushReply", "reminderTextRepliesRetry", "reminderTextRepliesList", "handleGetTextReplies", "handleGetGmTextReplies", "gmDocSettingsOwnerOnly", "requireClientAccess", "sessionSellerName", "handlePostTwilioInbound", "stripeConstantTimeEqual",
  "apptRemWall", "apptRemTime", "apptRemDateMDY", "apptRemFmt12", "apptRemClientPhone", "apptRemRoleEmails",
  "planClientAnd", "clientZoneFor", "tzIsValid", "tzZoneForState", "tzParts", "tzOffsetMinutes", "tzWallToUtcMs",
  "sendCounterRead", "sendCounterIncrement", "sendCounterDayKey", "sendCounterMonthKey", "sendCounterMaybeAlert",
  "sendCounterMonthlyCap", "passkeySmsMonthlyCap", "reminderSmsDailyCap", "reminderSmsMonthlyCap",
  "passkeyNormalizePhone", "passkeyCountryCode", "passkeyMaskPhone", "easternDateStr"
];
const VARS = ["REMINDER_TEXT_TEMPLATES", "REMINDER_TEXT_QUIET_START_MIN", "REMINDER_TEXT_QUIET_END_MIN", "REMINDER_TEXT_QUIET_MIN_LEAD_MIN", "APEX_TIMEZONE",
  "APPT_REMINDER_OWNER_ROLE", "TZ_STATE_ZONES", "TZ_STATE_NAMES", "TWILIO_STOP_WORDS", "TWILIO_HELP_WORDS", "REMINDER_TEXT_HELP"];

function fakeTwilio(state) {
  return async function fetch(url, init) {
    const params = new URLSearchParams(init.body);
    state.calls.push({ url: String(url), auth: init.headers.Authorization, params: Object.fromEntries(params) });
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (state.nextReply) { const r = state.nextReply; state.nextReply = null; return reply(r.status, r.data); }
    return reply(201, { sid: "SM" + state.calls.length });
  };
}

// The tables the code reads, made the way production has them. reminder_text_sends
// starts as the OLD table (with one old row) and the REAL migration rebuilds it.
function world(envOverrides, opts) {
  opts = opts || {};
  const d = makeDb([]);
  d.raw.exec(`
    CREATE TABLE send_counters (bucket TEXT NOT NULL, period_key TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, updated_at TEXT, PRIMARY KEY (bucket, period_key));
    CREATE TABLE send_counter_alerts (bucket TEXT NOT NULL, period_key TEXT NOT NULL, threshold TEXT NOT NULL, sent_at TEXT, PRIMARY KEY (bucket, period_key, threshold));
    CREATE TABLE reminder_text_sends (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, recipient TEXT NOT NULL, phone_e164 TEXT NOT NULL, sent_at TEXT NOT NULL, twilio_sid TEXT, UNIQUE (session_id, recipient));
    CREATE TABLE reminder_text_optouts (phone_e164 TEXT PRIMARY KEY, opted_out_at TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, client_name TEXT NOT NULL, client_id TEXT, date TEXT NOT NULL, time TEXT, session_type TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled', location TEXT, created_by TEXT, send_text_reminder INTEGER, series_id TEXT);
    CREATE TABLE users (email TEXT PRIMARY KEY, role TEXT NOT NULL, display_name TEXT);   -- no phone column, as in production: the migration adds it
    CREATE TABLE gm_leads (id TEXT PRIMARY KEY, client_id TEXT, telefone TEXT, cliente TEXT);
    CREATE TABLE gm_events (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, title TEXT, event_date TEXT NOT NULL, start_time TEXT, all_day INTEGER NOT NULL DEFAULT 0, lead_id TEXT);
    CREATE TABLE gm_booking_requests (id TEXT PRIMARY KEY, event_id TEXT, client_id TEXT, sms_consent_status TEXT, customer_phone TEXT);
  `);
  if (opts.legacyRow) {
    d.raw.prepare("INSERT INTO reminder_text_sends VALUES (?,?,?,?,?,?)").run("old1", "s-old", "client:c1", "+14075550001", "2026-10-20T00:00:00Z", "SMold");
  }
  // THE REAL MIGRATION, statement by statement.
  readFileSync(new URL("../migrations/2026-11-10_meeting_texts.sql", import.meta.url), "utf8").replace(/^\s*--[^\n]*$/gm, "").split(";").forEach((st) => {
    if (st.trim()) { d.raw.exec(st); }
  });
  readFileSync(new URL("../migrations/2026-11-10_text_queue_phone.sql", import.meta.url), "utf8").replace(/^\s*--[^\n]*$/gm, "").split(";").forEach((st) => { if (st.trim()) { d.raw.exec(st); } });
  readFileSync(new URL("../migrations/2026-11-10_text_replies_visible.sql", import.meta.url), "utf8").replace(/^\s*--[^\n]*$/gm, "").split(";").forEach((st) => { if (st.trim()) { d.raw.exec(st); } });
  readFileSync(new URL("../migrations/2026-11-10_gm_events_customer_language.sql", import.meta.url), "utf8").replace(/^\s*--[^\n]*$/gm, "").split(";").forEach((st) => { if (st.trim()) { d.raw.exec(st); } });
  for (const c of ["location_state", "owners", "owners_json", "phone", "whatsapp"]) {
    const have = d.raw.prepare("PRAGMA table_info(clients)").all().map((x) => x.name);
    if (have.indexOf(c) < 0) { d.raw.exec("ALTER TABLE clients ADD COLUMN " + c + " TEXT"); }
  }
  // c1: a consulting client met by staff (admin path). c2: a business whose customer books by link (booking path).
  d.raw.prepare("INSERT INTO clients (id, name, status, language, timezone, archived, whatsapp) VALUES ('c1','Acme Cleaning','active','en','America/New_York',0,'(407) 555-0101')").run();
  d.raw.prepare("INSERT INTO clients (id, name, status, language, timezone, archived, phone, owners_json) VALUES ('c2','JM Luxury Pools','active','es','America/New_York',0,'(321) 555-0188', ?)").run('[{"first":"Teo","last":"Mendes"}]');
  d.raw.prepare("INSERT INTO users (email, role, display_name, phone) VALUES ('rafa@t.test','rafa','Rafael Prata', ?)").run(opts.noHostPhone ? null : "+1 555-555-0123");
  d.raw.prepare("INSERT INTO users (email, role, display_name, phone) VALUES ('alice@t.test','alice','Alice Souza', NULL)").run();
  d.raw.prepare("INSERT INTO users (email, role, display_name, phone) VALUES ('dev@t.test','developer','Nicole', NULL)").run();
  const state = { calls: [], pushes: [], nextReply: null, pushFail: false, noTargets: false, user: { role: "developer", email: "dev@t.test" } };
  const stubs = Object.assign({}, baseStubs, {
    fetch: fakeTwilio(state),
    notifyNicoleTelegram: async () => {},
    authenticate: async () => state.user,
    pushToUsers: async (env, targets, payload) => { if (state.pushFail) { return { sent: 0, failed: 1, total: 1 }; } state.pushes.push({ targets, payload }); return { sent: 1, failed: 0, total: 1 }; },
    gmClientPushTargets: async (env, cid) => (state.noTargets ? [] : ["login:owner-" + cid]),
    gmOwnerPushLang: async () => "en"
  });
  const F = build(FNS, VARS, stubs);
  const env = Object.assign({
    DB: d.DB, TWILIO_ACCOUNT_SID: "ACxxx", TWILIO_API_KEY_SID: "SKxxx", TWILIO_API_KEY_SECRET: "secret",
    TWILIO_FROM_NUMBER: "+15555550123", REMINDER_TEXTS_ENABLED: "1", REMINDER_TEXTS_ADMIN_MEETINGS: "1", REMINDER_TEXTS_BOOKING_LINK: "1"
  }, envOverrides || {});
  return { d, F, env, state };
}

// 2026-12-10 1:00 PM Eastern (EST) = 18:00Z
const NOW = Date.UTC(2026, 11, 10, 18, 0, 0);
function addSession(w, id, o) {
  o = Object.assign({ date: "2026-12-12", time: "10:00", by: "Rafa", ticked: 1, client: "c1", status: "scheduled", series: null }, o || {});
  w.d.raw.prepare("INSERT INTO sessions (id, client_name, client_id, date, time, session_type, status, created_by, send_text_reminder, series_id) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, "Client " + id, o.client, o.date, o.time, "online_meet", o.status, o.by, o.ticked, o.series);
}
function addBooking(w, n, consent, o) {
  o = Object.assign({ date: "2026-12-12", time: "10:00", phone: "407-555-0155", lang: null }, o || {});
  w.d.raw.prepare("INSERT INTO gm_leads (id, client_id, telefone, cliente) VALUES (?,?,?,?)").run("L" + n, "c2", o.phone, "Customer " + n);
  w.d.raw.prepare("INSERT INTO gm_events (id, client_id, title, event_date, start_time, all_day, lead_id, customer_language) VALUES (?,?,?,?,?,0,?,?)").run("ev" + n, "c2", "Visit", o.date, o.time, "L" + n, o.lang);
  w.d.raw.prepare("INSERT INTO gm_booking_requests (id, event_id, client_id, sms_consent_status, customer_phone) VALUES (?,?,?,?,?)").run("br" + n, "ev" + n, "c2", consent, o.phone);
}
const sentTo = (w) => w.state.calls.map((c) => c.params.Body);
const rowsOf = (w, sql) => w.d.q(sql);

// ── 1. Switches and sender ───────────────────────────────────────────────────
await section("switches", async () => {
  const w = world();
  ok(w.F.reminderTextsConfigured(w.env) === true, "configured: enabled + sender present");
  ok(w.F.reminderTextsConfigured(Object.assign({}, w.env, { REMINDER_TEXTS_ENABLED: "" })) === false, "not configured: REMINDER_TEXTS_ENABLED off");
  ok(w.F.reminderTextsConfigured(Object.assign({}, w.env, { TWILIO_FROM_NUMBER: "", TWILIO_MESSAGING_SERVICE_SID: "" })) === false, "not configured: no sender");
  ok(w.F.reminderTextsConfigured(Object.assign({}, w.env, { TWILIO_MESSAGING_SERVICE_SID: "MGxxx", TWILIO_FROM_NUMBER: "" })) === true, "configured: MessagingServiceSid alone is enough");
  const e = (o) => Object.assign({}, w.env, o);
  ok(w.F.reminderTextSwitchOn(w.env, "admin") && w.F.reminderTextSwitchOn(w.env, "booking"), "both paths on when all three switches are 1");
  ok(!w.F.reminderTextSwitchOn(e({ REMINDER_TEXTS_ADMIN_MEETINGS: "" }), "admin") && w.F.reminderTextSwitchOn(e({ REMINDER_TEXTS_ADMIN_MEETINGS: "" }), "booking"), "admin switch off blocks only the admin path");
  ok(w.F.reminderTextSwitchOn(e({ REMINDER_TEXTS_BOOKING_LINK: "" }), "admin") && !w.F.reminderTextSwitchOn(e({ REMINDER_TEXTS_BOOKING_LINK: "" }), "booking"), "booking switch off blocks only the booking path");
  ok(!w.F.reminderTextSwitchOn(e({ REMINDER_TEXTS_ENABLED: "" }), "admin") && !w.F.reminderTextSwitchOn(e({ REMINDER_TEXTS_ENABLED: "" }), "booking"), "the master switch off blocks both paths");
  ok(!w.F.reminderTextSwitchOn(e({ REMINDER_TEXTS_ADMIN_MEETINGS: "true" }), "admin"), "only the exact value 1 turns a switch on");
  ok(!w.F.reminderTextSwitchOn(w.env, "other"), "an unknown path is never on");

  // each switch through the real dispatcher, all four kinds
  addSession(w, "s1", {}); addBooking(w, 1, "agreed");
  for (const kind of ["reminder", "confirmation", "change"]) {
    const a = await w.F.reminderTextDispatch(e({ REMINDER_TEXTS_ADMIN_MEETINGS: "" }), kind, "s1", { nowMs: NOW });
    const b = await w.F.reminderTextDispatch(e({ REMINDER_TEXTS_ADMIN_MEETINGS: "" }), kind, "ge:ev1", { nowMs: NOW + 1000 * 60 * 60 * 24 * 0 });
    ok(a.sent === false && a.reason === "switch_off", kind + ": admin switch off, the admin meeting does not text");
    ok(b.sent === true, kind + ": admin switch off, the booking-link meeting still texts");
    w.d.raw.exec("DELETE FROM reminder_text_sends");
    const c = await w.F.reminderTextDispatch(e({ REMINDER_TEXTS_BOOKING_LINK: "" }), kind, "ge:ev1", { nowMs: NOW });
    const dd = await w.F.reminderTextDispatch(e({ REMINDER_TEXTS_BOOKING_LINK: "" }), kind, "s1", { nowMs: NOW });
    ok(c.sent === false && c.reason === "switch_off", kind + ": booking switch off, the booking-link meeting does not text");
    ok(dd.sent === true, kind + ": booking switch off, the admin meeting still texts");
    w.d.raw.exec("DELETE FROM reminder_text_sends");
  }
  const snap = await w.F.reminderTextFacts(w.env, "s1");
  const c1 = await w.F.reminderTextDispatch(e({ REMINDER_TEXTS_ADMIN_MEETINGS: "" }), "cancel", "s1", { nowMs: NOW, facts: snap });
  ok(c1.reason === "switch_off", "cancel: admin switch off blocks an admin cancel notice");
  const c2 = await w.F.reminderTextDispatch(e({ REMINDER_TEXTS_BOOKING_LINK: "" }), "cancel", "s1", { nowMs: NOW, facts: snap });
  ok(c2.sent === true, "cancel: booking switch off does not block an admin cancel notice");
});

// ── 2. The twelve templates, word for word ──────────────────────────────────
const EXPECT = {
  reminder: {
    en: "Reminder: you have an appointment with Rafael on 12/10/2026 at 2:00 PM. Reply 1 to confirm. To change it or ask a question, tap +1 555-555-0123. Msg and data rates may apply. Reply HELP for help, STOP to opt out.",
    es: "Recordatorio: tiene una cita con Rafael el 12/10/2026 a las 2:00 PM. Responda 1 para confirmar. Para cambiarla o hacer preguntas, toque +1 555-555-0123. Pueden aplicarse tarifas de mensajes y datos. Responda HELP para ayuda, STOP para dejar de recibir mensajes.",
    pt: "Lembrete: você tem um horário com Rafael em 12/10/2026 às 2:00 PM. Responda 1 para confirmar. Para mudar ou tirar dúvidas, toque em +1 555-555-0123. Podem ser aplicadas tarifas de mensagens e dados. Responda HELP para ajuda, STOP para cancelar os textos."
  },
  confirmation: {
    en: "Your appointment with Rafael is confirmed for 12/10/2026 at 2:00 PM. To reach Rafael, tap +1 555-555-0123. Msgs vary with your appointments. Msg and data rates may apply. Reply HELP for help, STOP to opt out.",
    es: "Su cita con Rafael está confirmada para el 12/10/2026 a las 2:00 PM. Para comunicarse con Rafael, toque +1 555-555-0123. Los mensajes varían según sus citas. Pueden aplicarse tarifas de mensajes y datos. Responda HELP para ayuda, STOP para dejar de recibir mensajes.",
    pt: "Seu horário com Rafael está confirmado para 12/10/2026 às 2:00 PM. Para falar com Rafael, toque em +1 555-555-0123. A frequência das mensagens varia conforme os agendamentos. Podem ser aplicadas tarifas de mensagens e dados. Responda HELP para ajuda, STOP para cancelar os textos."
  },
  change: {
    en: "Your appointment with Rafael was changed to 12/10/2026 at 2:00 PM. To reach Rafael, tap +1 555-555-0123. Reply STOP to opt out.",
    es: "Su cita con Rafael fue cambiada para el 12/10/2026 a las 2:00 PM. Para comunicarse con Rafael, toque +1 555-555-0123. Responda STOP para dejar de recibir mensajes.",
    pt: "Seu horário com Rafael foi alterado para 12/10/2026 às 2:00 PM. Para falar com Rafael, toque em +1 555-555-0123. Responda STOP para cancelar os textos."
  },
  cancel: {
    en: "Your appointment with Rafael on 12/10/2026 was cancelled. To reach Rafael, tap +1 555-555-0123. Reply STOP to unsubscribe.",
    es: "Su cita con Rafael del 12/10/2026 fue cancelada. Para comunicarse con Rafael, toque +1 555-555-0123. Responda STOP para dejar de recibir mensajes.",
    pt: "Seu horário com Rafael em 12/10/2026 foi cancelado. Para falar com Rafael, toque em +1 555-555-0123. Responda STOP para cancelar os textos."
  }
};
await section("templates", async () => {
  const w = world();
  const v = { who: "Rafael", name: "Rafael", phone: "+1 555-555-0123", date: "12/10/2026", time: "2:00 PM" };
  for (const kind of ["reminder", "confirmation", "change", "cancel"]) {
    for (const lang of ["en", "es", "pt"]) {
      const got = w.F.reminderTextFill(kind, lang, v);
      ok(got === EXPECT[kind][lang], "template " + kind + " " + lang + " is word for word" + (got === EXPECT[kind][lang] ? "" : "\n   got: " + got));
    }
  }
  const all = JSON.stringify(w.F.reminderTextFill("reminder", "en", v));
  ok(!/\{(who|name|phone|date|time)\}/.test(["reminder", "confirmation", "change", "cancel"].map((k) => ["en", "es", "pt"].map((l) => w.F.reminderTextFill(k, l, v)).join(" ")).join(" ")), "no merge field is left unfilled in any of the twelve");
  const tplSrc = workerSrc.slice(workerSrc.indexOf("var REMINDER_TEXT_TEMPLATES"), workerSrc.indexOf("var REMINDER_TEXT_QUIET_START_MIN"));
  ok(!/Apex|Resonate/i.test(tplSrc), "no template says Apex or Resonate");
  ok(!/https?:|bit\.ly|tel:/i.test(tplSrc), "no template holds a link, a short link or a tel: address");
  ok(w.F.reminderTextLang("pt") === "pt" && w.F.reminderTextLang("ES") === "es" && w.F.reminderTextLang("fr") === "en" && w.F.reminderTextLang(null) === "en" && w.F.reminderTextLang("") === "en", "language: en, pt, es are kept; anything else or missing is English");
  ok(w.F.reminderTextFormatPhone("(407) 555-0155") === "+1 407-555-0155" && w.F.reminderTextFormatPhone("+14075550155") === "+1 407-555-0155" && w.F.reminderTextFormatPhone("4075550155") === "+1 407-555-0155", "phone is written +1 AAA-BBB-CCCC from any saved shape");
  ok(w.F.reminderTextFormatPhone("+5511912345678") === "+55 11-91234-5678", "a Brazilian number keeps its country code and dashes");
  ok(w.F.reminderTextFormatPhone("12345") === null && w.F.reminderTextFormatPhone("") === null && w.F.reminderTextFormatPhone(null) === null, "a bad or empty phone gives null, never a made-up number");
  ok(w.F.apptRemDateMDY("2026-12-10") === "12/10/2026" && w.F.apptRemFmt12("14:00") === "2:00 PM" && w.F.apptRemFmt12("00:30") === "12:30 AM", "date month first, time 12-hour");
  // the real text of a real send
  addSession(w, "s1", { date: "2026-12-10", time: "14:00" });
  await w.F.reminderTextDispatch(w.env, "reminder", "s1", { nowMs: NOW });
  ok(sentTo(w)[0] === EXPECT.reminder.pt, "an admin reminder goes out in Portuguese with the host's first name, the right date, 12-hour time and the host's phone (the client record says en)");
});

// ── 3. Twilio call shape ─────────────────────────────────────────────────────
await section("twilio", async () => {
  const w = world({ TWILIO_MESSAGING_SERVICE_SID: "MGxxx" });
  const r = await w.F.twilioSendSms(w.env, "+14075550001", "hello");
  const call = w.state.calls[0];
  ok(r.ok === true && call.auth === "Basic " + Buffer.from("SKxxx:secret").toString("base64"), "send succeeds with Basic auth (API key sid, secret)");
  ok(call.params.To === "+14075550001" && call.params.Body === "hello", "To and Body are form fields");
  ok(call.params.MessagingServiceSid === "MGxxx" && !call.params.From, "MessagingServiceSid preferred over From when both are set");
  const w2 = world();
  await w2.F.twilioSendSms(w2.env, "+14075550001", "hello");
  ok(w2.state.calls[0].params.From === "+15555550123" && !w2.state.calls[0].params.MessagingServiceSid, "From is used when no MessagingServiceSid is set");
});

// ── 4. Eligibility matrix, all four kinds ───────────────────────────────────
await section("matrix", async () => {
  const rows = [
    // [label, setup, ref, expect "send" or reason]
    ["admin, box ticked", (w) => addSession(w, "m1", { ticked: 1 }), "m1", "send"],
    ["admin, box NOT ticked", (w) => addSession(w, "m2", { ticked: 0 }), "m2", "not_eligible"],
    ["booking, agreed", (w) => addBooking(w, 3, "agreed"), "ge:ev3", "send"],
    ["booking, declined", (w) => addBooking(w, 4, "declined"), "ge:ev4", "not_eligible"],
    ["booking, NULL (an old booking)", (w) => addBooking(w, 5, null), "ge:ev5", "not_eligible"],
    ["scheduling link (Agendamento pelo cliente), no consent recorded", (w) => addSession(w, "m6", { by: "Agendamento pelo cliente", ticked: 1 }), "m6", "not_eligible"],
    ["google_calendar origin", (w) => addSession(w, "m7", { by: "google_calendar", ticked: 1 }), "m7", "not_eligible"],
    ["fireflies origin", (w) => addSession(w, "m8", { by: "fireflies", ticked: 1 }), "m8", "not_eligible"],
    ["untagged origin", (w) => addSession(w, "m9", { by: "", ticked: 1 }), "m9", "not_eligible"]
  ];
  for (const kind of ["reminder", "confirmation", "change", "cancel"]) {
    for (const [label, setup, ref, want] of rows) {
      const w = world();
      setup(w);
      const facts = kind === "cancel" ? await w.F.reminderTextFacts(w.env, ref) : null;
      const r = await w.F.reminderTextDispatch(w.env, kind, ref, { nowMs: NOW, facts: facts || undefined });
      const good = want === "send" ? (r.sent === true && w.state.calls.length === 1) : (r.sent === false && r.reason === want && w.state.calls.length === 0);
      ok(good, kind + " / " + label + ": " + (want === "send" ? "texts" : "does not text") + (good ? "" : " (got " + JSON.stringify(r) + ")"));
    }
  }
  const w = world();
  ok(w.F.sessionGetsTextReminder({ created_by: "Agendamento pelo cliente", sms_consent_status: "agreed" }) === true, "scheduling link WITH a recorded agreed: eligible");
  ok(w.F.sessionGetsTextReminder({ created_by: "Agendamento pelo cliente", sms_consent_status: "declined" }) === false && w.F.sessionGetsTextReminder({ created_by: "Agendamento pelo cliente" }) === false && w.F.sessionGetsTextReminder({ created_by: "Agendamento pelo cliente", send_text_reminder: 1 }) === false, "scheduling link without an agreed: never eligible, even with the staff flag");
  ok(w.F.sessionGetsTextReminder({ created_by: "google_calendar", send_text_reminder: 1 }) === false && w.F.sessionGetsTextReminder({ created_by: "fireflies", send_text_reminder: 1 }) === false && w.F.sessionGetsTextReminder({ created_by: "", send_text_reminder: 1 }) === false, "google_calendar, fireflies and untagged never text");
  ok(w.F.sessionGetsTextReminder({ created_by: "Rafa", send_text_reminder: 1 }) === true && w.F.sessionGetsTextReminder({ created_by: "Rafa", send_text_reminder: 0 }) === false, "admin meeting: the staff box decides");
  ok(["declined", null, undefined, "", "AGREED"].every((x) => w.F.reminderTextConsentAllows(x) === false) && w.F.reminderTextConsentAllows("agreed") === true, "booking consent: ONLY the exact word agreed passes");
  // the booking text uses the number the customer gave with the consent
  const w2 = world();
  addBooking(w2, 1, "agreed", { phone: "(407) 555-0177", lang: "es" });
  w2.d.raw.exec("UPDATE gm_leads SET telefone = '321-555-0000' WHERE id = 'L1'");
  await w2.F.reminderTextDispatch(w2.env, "confirmation", "ge:ev1", { nowMs: NOW });
  ok(w2.state.calls[0].params.To === "+14075550177", "booking: the text goes to the phone saved with the consent");
  ok(w2.state.calls[0].params.Body === "Su cita con JM Luxury Pools está confirmada para el 12/12/2026 a las 10:00 AM. Para comunicarse con Teo, toque +1 321-555-0188. Los mensajes varían según sus citas. Pueden aplicarse tarifas de mensajes y datos. Responda HELP para ayuda, STOP para dejar de recibir mensajes.", "booking text: business name as {who}, owner first name as {name}, the owner's phone, in the stored language");
});

// ── 4b. Language: admin meetings are always Portuguese; booking links use the stored language ──
await section("language", async () => {
  for (const lang of ["en", "es", null, "fr", ""]) {
    const w = world();
    w.d.raw.prepare("UPDATE clients SET language = ? WHERE id = 'c1'").run(lang);
    addSession(w, "l1", { date: "2026-12-12", time: "10:00" });
    const want = { reminder: EXPECT.reminder.pt, confirmation: EXPECT.confirmation.pt, change: EXPECT.change.pt, cancel: EXPECT.cancel.pt };
    for (const kind of ["reminder", "confirmation", "change", "cancel"]) {
      w.d.raw.exec("DELETE FROM reminder_text_sends");
      w.state.calls.length = 0;
      const facts = await w.F.reminderTextFacts(w.env, "l1");
      await w.F.reminderTextDispatch(w.env, kind, "l1", { nowMs: NOW, facts: facts });
      const body = (w.state.calls[0] || { params: {} }).params.Body || "";
      const pt = /Rafael/.test(body) && (kind === "reminder" ? /^Lembrete: você tem um horário com Rafael em 12\/12\/2026 às 10:00 AM/.test(body)
        : kind === "confirmation" ? /^Seu horário com Rafael está confirmado para 12\/12\/2026 às 10:00 AM/.test(body)
        : kind === "change" ? /^Seu horário com Rafael foi alterado para 12\/12\/2026 às 10:00 AM/.test(body)
        : /^Seu horário com Rafael em 12\/12\/2026 foi cancelado/.test(body));
      ok(pt, "admin " + kind + " is Portuguese when the client language is " + JSON.stringify(lang));
    }
  }
  // booking link: the CUSTOMER's language from the booking page; the client's language never matters
  const BODY = {
    en: { reminder: /^Reminder: you have an appointment with JM Luxury Pools on 12\/12\/2026 at 10:00 AM/, confirmation: /^Your appointment with JM Luxury Pools is confirmed for 12\/12\/2026 at 10:00 AM/, change: /^Your appointment with JM Luxury Pools was changed to 12\/12\/2026 at 10:00 AM/, cancel: /^Your appointment with JM Luxury Pools on 12\/12\/2026 was cancelled/ },
    pt: { reminder: /^Lembrete: você tem um horário com JM Luxury Pools em 12\/12\/2026 às 10:00 AM/, confirmation: /^Seu horário com JM Luxury Pools está confirmado para 12\/12\/2026 às 10:00 AM/, change: /^Seu horário com JM Luxury Pools foi alterado para 12\/12\/2026 às 10:00 AM/, cancel: /^Seu horário com JM Luxury Pools em 12\/12\/2026 foi cancelado/ },
    es: { reminder: /^Recordatorio: tiene una cita con JM Luxury Pools el 12\/12\/2026 a las 10:00 AM/, confirmation: /^Su cita con JM Luxury Pools está confirmada para el 12\/12\/2026 a las 10:00 AM/, change: /^Su cita con JM Luxury Pools fue cambiada para el 12\/12\/2026 a las 10:00 AM/, cancel: /^Su cita con JM Luxury Pools del 12\/12\/2026 fue cancelada/ }
  };
  for (const [saved, expect] of [["en", "en"], ["pt", "pt"], ["es", "es"], [null, "en"], ["fr", "en"], ["", "en"], ["PT", "en"]]) {
    for (const clientLang of ["pt", "en", "es"]) {
      const w = world();
      w.d.raw.prepare("UPDATE clients SET language = ? WHERE id = 'c2'").run(clientLang);
      addBooking(w, 1, "agreed", { lang: saved });
      for (const kind of ["reminder", "confirmation", "change", "cancel"]) {
        w.d.raw.exec("DELETE FROM reminder_text_sends");
        w.state.calls.length = 0;
        const facts = await w.F.reminderTextFacts(w.env, "ge:ev1");
        await w.F.reminderTextDispatch(w.env, kind, "ge:ev1", { nowMs: NOW, facts: facts });
        ok(BODY[expect][kind].test((w.state.calls[0] || { params: {} }).params.Body || ""), "booking link " + kind + ": customer language " + JSON.stringify(saved) + " (client language " + clientLang + ") sends " + expect);
      }
    }
  }
});

// ── 5. A meeting in the past never texts ────────────────────────────────────
await section("past", async () => {
  const w = world();
  addSession(w, "p1", { date: "2026-12-10", time: "12:00" });          // 12:00 PM, now is 1:00 PM
  addBooking(w, 7, "agreed", { date: "2026-12-09", time: "10:00" });
  for (const kind of ["reminder", "confirmation", "change"]) {
    const a = await w.F.reminderTextDispatch(w.env, kind, "p1", { nowMs: NOW });
    const b = await w.F.reminderTextDispatch(w.env, kind, "ge:ev7", { nowMs: NOW });
    ok(a.reason === "past" && b.reason === "past", kind + ": a meeting that already happened never texts");
  }
  const snap = await w.F.reminderTextFacts(w.env, "p1");
  const c = await w.F.reminderTextDispatch(w.env, "cancel", "p1", { nowMs: NOW, facts: snap });
  ok(c.reason === "past" && w.state.calls.length === 0, "cancel: a past meeting gets no notice and no Twilio call was made");
  const w3 = world();
  addSession(w3, "p2", { date: "2026-12-10", time: "13:00" });         // exactly now
  ok((await w3.F.reminderTextDispatch(w3.env, "reminder", "p2", { nowMs: NOW })).reason === "past", "a meeting starting this very minute counts as past");
});

// ── 6. Never twice; a rescheduled meeting gets its change notice and a new reminder ──
await section("dedupe", async () => {
  const w = world();
  addSession(w, "d1", { date: "2026-12-10", time: "14:00" });
  const a = await w.F.reminderTextDispatch(w.env, "reminder", "d1", { nowMs: NOW });
  const b = await w.F.reminderTextDispatch(w.env, "reminder", "d1", { nowMs: NOW });
  ok(a.sent === true && b.sent === false && b.reason === "already_sent" && w.state.calls.length === 1, "the same reminder for the same meeting is sent once");
  const c = await w.F.reminderTextDispatch(w.env, "confirmation", "d1", { nowMs: NOW });
  ok(c.sent === true, "an already sent reminder does not block a different kind (confirmation)");
  // the meeting moves to 4:00 PM
  w.d.raw.exec("UPDATE sessions SET time = '16:00' WHERE id = 'd1'");
  const ch = await w.F.reminderTextDispatch(w.env, "change", "d1", { nowMs: NOW });
  ok(ch.sent === true && /foi alterado para 12\/10\/2026 às 4:00 PM/.test(w.state.calls[2].params.Body), "the move gets a change notice (Portuguese) naming the NEW date and time");
  const ch2 = await w.F.reminderTextDispatch(w.env, "change", "d1", { nowMs: NOW });
  ok(ch2.sent === false && ch2.reason === "already_sent", "the same change notice is never sent twice");
  const rem2 = await w.F.reminderTextDispatch(w.env, "reminder", "d1", { nowMs: Date.UTC(2026, 11, 10, 20, 0, 0) });
  ok(rem2.sent === true && /4:00 PM/.test(w.state.calls[3].params.Body), "the rescheduled meeting gets a NEW reminder for its new time");
  const again = await w.F.reminderTextDispatch(w.env, "reminder", "d1", { nowMs: Date.UTC(2026, 11, 10, 20, 0, 0) });
  ok(again.reason === "already_sent" && w.state.calls.length === 4, "and that new reminder is not sent twice either");
  const rows = rowsOf(w, "SELECT kind, meeting_at FROM reminder_text_sends WHERE session_id = 'd1' ORDER BY sent_at, kind");
  ok(rows.length === 4 && rows.every((r) => /^2026-12-10 \d\d:\d\d$/.test(r.meeting_at)), "every row keeps its kind and the meeting's date and time at the moment of sending");
  // a database-level guard, not a read then write
  let dup = null;
  try { w.d.raw.prepare("INSERT INTO reminder_text_sends (id, session_id, recipient, phone_e164, sent_at, kind, meeting_at) VALUES ('x','d1','client:c1','+14075550001','t','change','2026-12-10 16:00')").run(); } catch (e) { dup = e; }
  ok(!!dup && /UNIQUE/i.test(String(dup.message)), "the database itself refuses a second row for the same meeting, recipient, kind and time");
  // two overlapping ticks: both pass the read, only one claims
  const w2 = world();
  addSession(w2, "d2", { date: "2026-12-10", time: "14:00" });
  const both = await Promise.all([w2.F.reminderTextDispatch(w2.env, "reminder", "d2", { nowMs: NOW }), w2.F.reminderTextDispatch(w2.env, "reminder", "d2", { nowMs: NOW })]);
  ok(both.filter((x) => x.sent).length === 1 && w2.state.calls.length === 1, "two ticks at the same instant send ONE text");
});

// ── 7. Failures, opt-outs, caps ─────────────────────────────────────────────
const SEND = (w, ref, extra) => w.F.reminderTextSend(w.env, Object.assign({ ref: ref, recipient: "client:c1", phone: "+14075550002", kind: "reminder", lang: "en", meetingAt: "2026-12-12 10:00", vars: { who: "Rafael", name: "Rafael", phone: "+1 555-555-0123", date: "12/12/2026", time: "10:00 AM" } }, extra || {}));
await section("failures", async () => {
  const w = world();
  w.state.nextReply = { status: 400, data: { code: 21610, message: "unsubscribed" } };
  const r1 = await SEND(w, "s1", { phone: "+14075550001" });
  ok(r1.sent === false && r1.reason === "opted_out" && await w.F.reminderTextOptedOut(w.env, "+14075550001") === true, "Twilio's 21610 is reported as opted_out and the number is recorded");
  const before = w.state.calls.length;
  const r2 = await SEND(w, "s2", { phone: "+14075550001" });
  ok(r2.reason === "opted_out" && w.state.calls.length === before, "a number that opted out is refused with NO new Twilio call, for every kind");
  const r2b = await SEND(w, "s2", { phone: "+14075550001", kind: "cancel" });
  ok(r2b.reason === "opted_out" && w.state.calls.length === before, "a cancel notice to an opted-out number is refused too");
  ok(rowsOf(w, "SELECT 1 FROM reminder_text_sends WHERE session_id IN ('s1','s2')").length === 0, "no row is kept for a refused send");

  const w2 = world();
  w2.state.nextReply = { status: 500, data: {} };
  const f = await SEND(w2, "s1", { phone: "+14075550003" });
  ok(f.sent === false && rowsOf(w2, "SELECT 1 FROM reminder_text_sends WHERE session_id = 's1' AND twilio_sid IS NOT NULL").length === 0 && rowsOf(w2, "SELECT 1 FROM reminder_text_sends WHERE session_id = 's1'").length === 0, "a failed send leaves no row, so the next tick can retry");
  const retry = await SEND(w2, "s1", { phone: "+14075550003" });
  ok(retry.sent === true, "and the retry sends");

  const w3 = world({ REMINDER_SMS_DAILY_CAP: "1" });
  const a = await SEND(w3, "sA", { phone: "+14075550010" });
  const b = await SEND(w3, "sB", { phone: "+14075550011", kind: "cancel" });
  ok(a.sent === true && b.reason === "daily_cap" && w3.state.calls.length === 1, "every kind counts toward the daily cap (a cancel notice is refused at the cap)");
  const w4 = world({ REMINDER_SMS_MONTHLY_CAP: "1" });
  await SEND(w4, "sC", { phone: "+14075550020", kind: "confirmation" });
  const m = await SEND(w4, "sD", { phone: "+14075550021", kind: "change" });
  ok(m.reason === "monthly_cap", "every kind counts toward the monthly cap");
  const w5 = world({ REMINDER_TEXTS_ENABLED: "" });
  const nc = await SEND(w5, "sE");
  ok(nc.reason === "not_configured" && w5.state.calls.length === 0, "not configured: refuses with a reason, no Twilio call");
});

// ── 8. The host's phone: no phone, no text ──────────────────────────────────
await section("callback", async () => {
  const w = world({}, { noHostPhone: true });
  addSession(w, "n1", { by: "Rafa" });
  addSession(w, "n2", { by: "Alice" });
  const out = {};
  const r = await w.F.reminderTextDispatch(w.env, "reminder", "n1", { nowMs: NOW, out: out });
  await w.F.reminderTextDispatch(w.env, "reminder", "n2", { nowMs: NOW, out: out });
  ok(r.sent === false && r.reason === "no_callback_phone" && w.state.calls.length === 0, "a host with no phone: no text, no Twilio call");
  ok(out.text_skips && out.text_skips.no_callback_phone === 2, "no_callback_phone is counted in the run output (" + JSON.stringify(out.text_skips) + ")");
  ok(Array.isArray(out.no_callback_phone) && out.no_callback_phone.indexOf("Rafael") >= 0 && out.no_callback_phone.indexOf("Alice") >= 0, "the hosts who are missing a phone are listed by name");
  const w2 = world();
  w2.d.raw.exec("UPDATE clients SET phone = NULL, whatsapp = NULL WHERE id = 'c2'");
  addBooking(w2, 1, "agreed");
  const out2 = {};
  const r2 = await w2.F.reminderTextDispatch(w2.env, "confirmation", "ge:ev1", { nowMs: NOW, out: out2 });
  ok(r2.reason === "no_callback_phone" && out2.no_callback_phone[0] === "JM Luxury Pools", "a business with no phone on record: no text, and it is listed by name");
  const w3 = world();
  w3.d.raw.exec("UPDATE users SET phone = 'abc' WHERE role = 'rafa'");
  addSession(w3, "n3", {});
  ok((await w3.F.reminderTextDispatch(w3.env, "reminder", "n3", { nowMs: NOW })).reason === "no_callback_phone", "a host phone that is not a real number is treated as missing, never repaired or invented");
});

// ── 9. Quiet hours: 9:00 PM to 8:00 AM local ────────────────────────────────
await section("quiet", async () => {
  const w = world();
  const Q = (ms, tz) => w.F.reminderTextQuiet(ms, tz || "America/New_York");
  ok(Q(Date.UTC(2026, 11, 10, 13, 0)).quiet === false, "8:00 AM Eastern is allowed");
  ok(Q(Date.UTC(2026, 11, 10, 12, 59)).quiet === true, "7:59 AM Eastern is quiet");
  ok(Q(Date.UTC(2026, 11, 11, 1, 59)).quiet === false, "8:59 PM Eastern is allowed");
  ok(Q(Date.UTC(2026, 11, 11, 2, 0)).quiet === true, "9:00 PM Eastern is quiet");
  ok(Q(Date.UTC(2026, 11, 10, 10, 0)).resumeMs === Date.UTC(2026, 11, 10, 13, 0), "5:00 AM resumes at 8:00 AM the SAME day");
  ok(Q(Date.UTC(2026, 11, 11, 3, 30)).resumeMs === Date.UTC(2026, 11, 11, 13, 0), "10:30 PM resumes at 8:00 AM the NEXT day");
  ok(Q(Date.UTC(2026, 11, 10, 18, 0), "America/Chicago").quiet === false && Q(Date.UTC(2026, 11, 11, 2, 30), "America/Chicago").quiet === false, "another zone is judged on its own clock (8:30 PM Chicago is allowed)");
  ok(Q(Date.UTC(2026, 11, 11, 3, 30), "America/Chicago").resumeMs === Date.UTC(2026, 11, 11, 14, 0), "Chicago resumes at 8:00 AM Chicago (14:00Z)");
  // clock change days
  ok(Q(Date.UTC(2027, 2, 14, 3, 30)).resumeMs === Date.UTC(2027, 2, 14, 12, 0), "spring forward: 10:30 PM Saturday (EST) resumes at 8:00 AM Sunday EDT = 12:00Z");
  ok(Q(Date.UTC(2026, 10, 1, 3, 30)).resumeMs === Date.UTC(2026, 10, 1, 13, 0), "fall back: 11:30 PM Saturday (EDT) resumes at 8:00 AM Sunday EST = 13:00Z");
  ok(Q(Date.UTC(2026, 10, 1, 8, 0)).quiet === true && Q(Date.UTC(2026, 10, 1, 8, 0)).resumeMs === Date.UTC(2026, 10, 1, 13, 0), "fall back: 3:00 AM EST on the clock change day is quiet and resumes at 13:00Z");

  // ---- Quiet hours apply to REMINDERS ONLY ----------------------------------
  const E = (y, m, d, h, mi) => Date.UTC(y, m - 1, d, h, mi);          // an instant, in UTC
  const NIGHT = E(2026, 12, 10, 3, 15);                                  // 10:15 PM Eastern, Dec 9
  const sentNow = (w, k) => w.state.calls.length;
  const queueRows = (w) => rowsOf(w, "SELECT kind, status, send_after, payload FROM reminder_text_queue ORDER BY kind");

  // confirmation, change and cancel go out at once at any hour, and are never queued
  const w2 = world();
  addBooking(w2, 1, "agreed", { date: "2026-12-14" });
  const c = await w2.F.reminderTextDispatch(w2.env, "confirmation", "ge:ev1", { nowMs: NIGHT });
  ok(c.sent === true && !c.held && w2.state.calls.length === 1 && queueRows(w2).length === 0, "a confirmation created at 10:15 PM sends immediately and is not queued");
  const ch = await w2.F.reminderTextDispatch(w2.env, "change", "ge:ev1", { nowMs: E(2026, 12, 10, 7, 0) });
  const snap = await w2.F.reminderTextFacts(w2.env, "ge:ev1");
  const ca = await w2.F.reminderTextDispatch(w2.env, "cancel", "ge:ev1", { nowMs: E(2026, 12, 10, 7, 0), facts: snap });
  ok(ch.sent === true && ca.sent === true && w2.state.calls.length === 3 && queueRows(w2).length === 0, "a change notice and a cancel notice at 2:00 AM send immediately and are not queued");
  const w2b = world();
  addSession(w2b, "n1", { date: "2026-12-14" });
  const nb = await w2b.F.reminderTextDispatch(w2b.env, "confirmation", "n1", { nowMs: E(2026, 12, 10, 8, 0) });
  ok(nb.sent === true && /Rafael/.test(w2b.state.calls[0].params.Body) && queueRows(w2b).length === 0, "the same holds on the admin path (3:00 AM, sent at once)");

  // at night the other rules still apply to those three kinds
  const w2c = world();
  addBooking(w2c, 1, "declined", { date: "2026-12-14" });
  const nd = await w2c.F.reminderTextDispatch(w2c.env, "confirmation", "ge:ev1", { nowMs: NIGHT });
  ok(nd.reason === "not_eligible" && w2c.state.calls.length === 0, "at night a confirmation still needs the yes (declined: nothing sent)");
  const w2d = world();
  addBooking(w2d, 1, "agreed", { date: "2026-12-14" });
  w2d.d.raw.exec("INSERT INTO reminder_text_optouts VALUES ('+14075550155', 'x')");
  const no = await w2d.F.reminderTextDispatch(w2d.env, "change", "ge:ev1", { nowMs: NIGHT });
  ok(no.reason === "opted_out" && w2d.state.calls.length === 0, "at night a change notice still respects the opt-out list");
  const w2e = world({ REMINDER_TEXTS_BOOKING_LINK: "" });
  addBooking(w2e, 1, "agreed", { date: "2026-12-14" });
  const ns = await w2e.F.reminderTextDispatch(w2e.env, "confirmation", "ge:ev1", { nowMs: NIGHT });
  ok(ns.reason === "switch_off" && w2e.state.calls.length === 0, "at night a confirmation still respects the separate switch");
  const w2f = world();
  addBooking(w2f, 1, "agreed", { date: "2026-12-09", time: "09:00" });
  const np = await w2f.F.reminderTextDispatch(w2f.env, "cancel", "ge:ev1", { nowMs: NIGHT, facts: await w2f.F.reminderTextFacts(w2f.env, "ge:ev1") });
  ok(np.reason === "past" && w2f.state.calls.length === 0, "at night a past meeting never texts");
  const w2g = world({ REMINDER_SMS_DAILY_CAP: "1" });
  addBooking(w2g, 1, "agreed", { date: "2026-12-14" });
  await w2g.F.reminderTextDispatch(w2g.env, "confirmation", "ge:ev1", { nowMs: NIGHT });
  const ng = await w2g.F.reminderTextDispatch(w2g.env, "change", "ge:ev1", { nowMs: NIGHT });
  ok(ng.reason === "daily_cap" && w2g.state.calls.length === 1 && queueRows(w2g).length === 0, "at night the daily cap still applies, and a refused notice is not queued");

  // a reminder due at 2:00 PM is not affected
  const wd = world();
  addBooking(wd, 1, "agreed", { date: "2026-12-10", time: "15:00" });
  const outd = {};
  const rd = await wd.F.reminderTextDispatch(wd.env, "reminder", "ge:ev1", { nowMs: E(2026, 12, 10, 19, 0), out: outd });
  ok(rd.sent === true && wd.state.calls.length === 1 && queueRows(wd).length === 0 && !outd.text_held && !outd.text_skips, "a reminder due at 2:00 PM is sent at once, not held, nothing counted");

  // a reminder due in quiet hours is HELD (7:30 AM for an 8:45 AM meeting) and sent at the 8:00 AM tick
  const SEVEN30 = E(2026, 12, 10, 12, 30);                                // 7:30 AM Eastern
  const w3 = world();
  addBooking(w3, 1, "agreed", { date: "2026-12-10", time: "08:45" });
  const out3 = {};
  const h3 = await w3.F.reminderTextDispatch(w3.env, "reminder", "ge:ev1", { nowMs: SEVEN30, out: out3 });
  ok(h3.held === true && out3.text_held === 1 && w3.state.calls.length === 0, "a reminder due at 7:30 AM for an 8:45 AM meeting is held, and nothing is sent");
  const q3 = queueRows(w3);
  ok(q3.length === 1 && q3[0].kind === "reminder" && q3[0].status === "pending" && q3[0].send_after === new Date(E(2026, 12, 10, 13, 0)).toISOString() && q3[0].payload === "2026-12-10 08:45", "the held reminder waits in reminder_text_queue until 8:00 AM Eastern (13:00Z) and remembers the meeting time");
  await w3.F.reminderTextDispatch(w3.env, "reminder", "ge:ev1", { nowMs: E(2026, 12, 10, 12, 40) });
  ok(queueRows(w3).length === 1 && queueRows(w3)[0].status === "pending", "the cron asking again while it waits keeps one held row (the database refuses the copy)");

  // idle tick: ONE indexed read; none while off
  w3.d.log.length = 0;
  const early = await w3.F.reminderTextQueueTick(w3.env, E(2026, 12, 10, 12, 55));
  ok(early.sent === 0 && w3.state.calls.length === 0 && w3.d.log.length === 1 && /FROM reminder_text_queue/.test(w3.d.log[0]), "7:55 AM tick: nothing goes out and the tick costs exactly one read");
  const idle = world();
  idle.d.log.length = 0;
  await idle.F.reminderTextQueueTick(idle.env, NOW);
  ok(idle.d.log.length === 1, "an idle tick with an empty queue is one indexed read");
  const off = world({ REMINDER_TEXTS_ENABLED: "" });
  off.d.log.length = 0;
  await off.F.reminderTextQueueTick(off.env, NOW);
  ok(off.d.log.length === 0, "with the texts switched off the tick reads nothing");
  const plan = w3.d.raw.prepare("EXPLAIN QUERY PLAN SELECT id, kind, meeting_ref, payload FROM reminder_text_queue WHERE status = 'pending' AND send_after <= ? ORDER BY send_after LIMIT 25").all("x").map((r) => r.detail).join(" ");
  ok(/idx_rtq_due/.test(plan), "the due read uses the index (" + plan + ")");

  const t3 = await w3.F.reminderTextQueueTick(w3.env, E(2026, 12, 10, 13, 0));
  ok(t3.sent === 1 && w3.state.calls.length === 1 && /8:45 AM/.test(w3.state.calls[0].params.Body), "the first tick at 8:00 AM sends the held reminder, naming the meeting time");
  ok(queueRows(w3)[0].status === "sent", "the sent row is marked sent");
  const t3b = await w3.F.reminderTextQueueTick(w3.env, E(2026, 12, 10, 13, 5));
  const again3 = await w3.F.reminderTextDispatch(w3.env, "reminder", "ge:ev1", { nowMs: E(2026, 12, 10, 13, 5) });
  ok(t3b.sent === 0 && again3.reason === "already_sent" && w3.state.calls.length === 1, "the next tick sends nothing more, and nobody sends that reminder twice");

  // the admin path holds and sends too
  const w3a = world();
  addSession(w3a, "a1", { date: "2026-12-10", time: "09:00" });
  await w3a.F.reminderTextDispatch(w3a.env, "reminder", "a1", { nowMs: SEVEN30 });
  ok(queueRows(w3a).length === 1 && (await w3a.F.reminderTextQueueTick(w3a.env, E(2026, 12, 10, 13, 0))).sent === 1, "an admin meeting reminder is held at 7:30 AM and sent at 8:00 AM");

  // too late: less than 30 minutes away at 8:00 AM
  const w4 = world();
  addBooking(w4, 1, "agreed", { date: "2026-12-10", time: "07:00" });
  const out4 = {};
  const r4 = await w4.F.reminderTextDispatch(w4.env, "reminder", "ge:ev1", { nowMs: E(2026, 12, 10, 11, 0), out: out4 });
  ok(r4.reason === "quiet_hours_too_late" && out4.text_skips.quiet_hours_too_late === 1 && w4.state.calls.length === 0 && queueRows(w4).length === 0, "a reminder due at 6:00 AM for a 7:00 AM meeting is skipped, counted as quiet_hours_too_late, and not held");
  const w4b = world();
  addBooking(w4b, 1, "agreed", { date: "2026-12-10", time: "08:29" });
  const r4b = await w4b.F.reminderTextDispatch(w4b.env, "reminder", "ge:ev1", { nowMs: E(2026, 12, 10, 11, 0) });
  addBooking(w4b, 2, "agreed", { date: "2026-12-10", time: "08:30", phone: "407-555-0166" });
  const r4c = await w4b.F.reminderTextDispatch(w4b.env, "reminder", "ge:ev2", { nowMs: E(2026, 12, 10, 11, 0) });
  ok(r4b.reason === "quiet_hours_too_late" && r4c.held === true, "the line is 30 minutes: an 8:29 AM meeting is skipped, an 8:30 AM meeting is held");
  const w4d = world();
  addBooking(w4d, 1, "agreed", { date: "2026-12-10", time: "08:45" });
  await w4d.F.reminderTextDispatch(w4d.env, "reminder", "ge:ev1", { nowMs: SEVEN30 });
  const o4d = await w4d.F.reminderTextQueueTick(w4d.env, E(2026, 12, 10, 13, 20));     // a late tick: 8:20 AM, 25 minutes before
  ok(o4d.sent === 0 && o4d.dropped === 1 && o4d.text_skips.quiet_hours_too_late === 1 && w4d.state.calls.length === 0, "a held reminder whose meeting is under 30 minutes away when the tick finally runs is skipped as quiet_hours_too_late");
  const w4e = world();
  addBooking(w4e, 1, "agreed", { date: "2026-12-10", time: "21:30" });
  const r4e = await w4e.F.reminderTextDispatch(w4e.env, "reminder", "ge:ev1", { nowMs: E(2026, 12, 11, 2, 30) });
  ok(r4e.reason === "quiet_hours_too_late" || r4e.reason === "past", "a reminder due after 9:00 PM for a late meeting is never held to the next morning (" + r4e.reason + ")");

  // re-checks at 8:00 AM
  const held = () => { const w = world(); addBooking(w, 1, "agreed", { date: "2026-12-10", time: "08:45" }); return w; };
  const T8 = E(2026, 12, 10, 13, 0);
  const wA = held();
  await wA.F.reminderTextDispatch(wA.env, "reminder", "ge:ev1", { nowMs: SEVEN30 });
  wA.d.raw.exec("UPDATE gm_booking_requests SET sms_consent_status = 'declined'");
  ok((await wA.F.reminderTextQueueTick(wA.env, T8)).dropped === 1 && wA.state.calls.length === 0, "held reminder: the customer no longer says yes, so it is dropped");
  const wB = held();
  await wB.F.reminderTextDispatch(wB.env, "reminder", "ge:ev1", { nowMs: SEVEN30 });
  wB.d.raw.exec("DELETE FROM gm_events");
  ok((await wB.F.reminderTextQueueTick(wB.env, T8)).dropped === 1 && wB.state.calls.length === 0 && queueRows(wB)[0].status === "dropped", "held reminder: the meeting was cancelled (gone), so it is dropped");
  const wB2 = world();
  addSession(wB2, "a1", { date: "2026-12-10", time: "09:00" });
  await wB2.F.reminderTextDispatch(wB2.env, "reminder", "a1", { nowMs: SEVEN30 });
  wB2.d.raw.exec("UPDATE sessions SET status = 'cancelled'");
  ok((await wB2.F.reminderTextQueueTick(wB2.env, T8)).dropped === 1 && wB2.state.calls.length === 0, "held reminder: an admin meeting was cancelled, so it is dropped");
  const wC = held();
  await wC.F.reminderTextDispatch(wC.env, "reminder", "ge:ev1", { nowMs: SEVEN30 });
  wC.d.raw.exec("UPDATE gm_events SET start_time = '09:30'");
  ok((await wC.F.reminderTextQueueTick(wC.env, T8)).dropped === 1 && wC.state.calls.length === 0, "held reminder: the meeting was moved to a new time, so the stale reminder is dropped");
  const wC2 = held();
  await wC2.F.reminderTextDispatch(wC2.env, "reminder", "ge:ev1", { nowMs: SEVEN30 });
  wC2.d.raw.exec("UPDATE gm_events SET event_date = '2026-12-11'");
  ok((await wC2.F.reminderTextQueueTick(wC2.env, T8)).dropped === 1 && wC2.state.calls.length === 0, "held reminder: the meeting was moved to a new day, so the stale reminder is dropped");
  const wC3 = held();
  await wC3.F.reminderTextDispatch(wC3.env, "reminder", "ge:ev1", { nowMs: SEVEN30 });
  wC3.d.raw.exec("UPDATE gm_events SET start_time = '09:30'");
  await wC3.F.reminderTextDispatch(wC3.env, "reminder", "ge:ev1", { nowMs: E(2026, 12, 10, 12, 40) });
  const rowsC3 = queueRows(wC3);
  ok(rowsC3.length === 2 && rowsC3.filter((x) => x.status === "dropped").length === 1 && rowsC3.filter((x) => x.status === "pending" && x.payload === "2026-12-10 09:30").length === 1, "a moved meeting: the stale held row is dropped at once and one fresh row holds the new time");
  const tC3 = await wC3.F.reminderTextQueueTick(wC3.env, T8);
  ok(tC3.sent === 1 && /9:30 AM/.test(wC3.state.calls[0].params.Body), "and the 8:00 AM tick sends the reminder for the new time");
  const wD = held();
  await wD.F.reminderTextDispatch(wD.env, "reminder", "ge:ev1", { nowMs: SEVEN30 });
  wD.d.raw.exec("INSERT INTO reminder_text_optouts VALUES ('+14075550155', 'x')");
  const oD = await wD.F.reminderTextQueueTick(wD.env, T8);
  ok(oD.dropped === 1 && wD.state.calls.length === 0, "a held reminder is not sent to a phone that opted out");
  const wE = held();
  await wE.F.reminderTextDispatch(wE.env, "reminder", "ge:ev1", { nowMs: SEVEN30 });
  wE.d.raw.exec("UPDATE gm_events SET event_date = '2026-12-09'");
  ok((await wE.F.reminderTextQueueTick(wE.env, E(2026, 12, 10, 14, 0))).dropped === 1 && wE.state.calls.length === 0, "held reminder: the meeting is now in the past, so it is dropped");
  const wF = world({ REMINDER_TEXTS_BOOKING_LINK: "" });
  addBooking(wF, 1, "agreed", { date: "2026-12-10", time: "08:45" });
  await wF.F.reminderTextDispatch(Object.assign({}, wF.env, { REMINDER_TEXTS_BOOKING_LINK: "1" }), "reminder", "ge:ev1", { nowMs: SEVEN30 });
  ok((await wF.F.reminderTextQueueTick(wF.env, T8)).dropped === 1 && wF.state.calls.length === 0, "held reminder: the path's switch was turned off in the meantime, so it is dropped");

  // clock changes
  const w8 = world();
  addBooking(w8, 1, "agreed", { date: "2026-11-01", time: "09:00" });
  await w8.F.reminderTextDispatch(w8.env, "reminder", "ge:ev1", { nowMs: E(2026, 11, 1, 8, 30) });   // 3:30 AM EST (after the clocks went back)
  ok(queueRows(w8)[0].send_after === new Date(E(2026, 11, 1, 13, 0)).toISOString(), "fall back: held at 3:30 AM EST, due at 13:00Z (8:00 AM EST)");
  ok((await w8.F.reminderTextQueueTick(w8.env, E(2026, 11, 1, 12, 55))).sent === 0, "fall back: 7:55 AM EST, nothing goes out (an offset of 4 hours would have sent it at 12:00Z)");
  ok((await w8.F.reminderTextQueueTick(w8.env, E(2026, 11, 1, 13, 0))).sent === 1, "fall back: 8:00 AM EST, it goes out");
  const w8b = world();
  addBooking(w8b, 1, "agreed", { date: "2026-11-01", time: "08:20" });
  const r8b = await w8b.F.reminderTextDispatch(w8b.env, "reminder", "ge:ev1", { nowMs: E(2026, 11, 1, 11, 0) });
  ok(r8b.reason === "quiet_hours_too_late", "fall back: 6:00 AM EST for an 8:20 AM EST meeting is too late (20 minutes after 8:00 AM)");
  const w9 = world();
  addBooking(w9, 1, "agreed", { date: "2027-03-14", time: "08:45" });
  await w9.F.reminderTextDispatch(w9.env, "reminder", "ge:ev1", { nowMs: E(2027, 3, 14, 11, 30) });  // 7:30 AM EDT
  ok((await w9.F.reminderTextQueueTick(w9.env, E(2027, 3, 14, 11, 55))).sent === 0 && (await w9.F.reminderTextQueueTick(w9.env, E(2027, 3, 14, 12, 0))).sent === 1, "spring forward: nothing at 7:55 AM EDT (11:55Z), sent at 8:00 AM EDT (12:00Z)");
  const w9b = world();
  addBooking(w9b, 1, "agreed", { date: "2027-03-14", time: "08:20" });
  const r9b = await w9b.F.reminderTextDispatch(w9b.env, "reminder", "ge:ev1", { nowMs: E(2027, 3, 14, 10, 0) });
  const w9c = world();
  addBooking(w9c, 1, "agreed", { date: "2027-03-14", time: "08:45" });
  const r9c = await w9c.F.reminderTextDispatch(w9c.env, "reminder", "ge:ev1", { nowMs: E(2027, 3, 14, 10, 0) });
  ok(r9b.reason === "quiet_hours_too_late" && r9c.held === true, "spring forward: 6:00 AM EDT, an 8:20 AM EDT meeting is too late and an 8:45 AM EDT meeting is held");
  const w9d = world();
  addBooking(w9d, 1, "agreed", { date: "2027-03-14", time: "10:00" });
  await w9d.F.reminderTextDispatch(w9d.env, "confirmation", "ge:ev1", { nowMs: E(2027, 3, 14, 6, 30) });    // 1:30 AM EST, the night the clocks change
  ok(w9d.state.calls.length === 1 && queueRows(w9d).length === 0, "spring forward: a confirmation at 1:30 AM on the clock change night sends at once");

  // a different client time zone: Chicago
  const wz = world();
  wz.d.raw.exec("UPDATE clients SET timezone = 'America/Chicago' WHERE id = 'c2'");
  addBooking(wz, 1, "agreed", { date: "2026-12-10", time: "08:45" });
  const rz = await wz.F.reminderTextDispatch(wz.env, "reminder", "ge:ev1", { nowMs: E(2026, 12, 10, 13, 30) });   // 7:30 AM Chicago = 8:30 AM Eastern
  ok(rz.held === true && queueRows(wz)[0].send_after === new Date(E(2026, 12, 10, 14, 0)).toISOString(), "Chicago: 7:30 AM Chicago is quiet (it would not be on the Eastern clock) and is held until 8:00 AM Chicago (14:00Z)");
  ok((await wz.F.reminderTextQueueTick(wz.env, E(2026, 12, 10, 13, 55))).sent === 0 && (await wz.F.reminderTextQueueTick(wz.env, E(2026, 12, 10, 14, 0))).sent === 1, "Chicago: nothing at 7:55 AM Chicago, sent at 8:00 AM Chicago");
  const wz2 = world();
  wz2.d.raw.exec("UPDATE clients SET timezone = 'America/Chicago' WHERE id = 'c2'");
  addBooking(wz2, 1, "agreed", { date: "2026-12-10", time: "21:30" });
  const rz2 = await wz2.F.reminderTextDispatch(wz2.env, "reminder", "ge:ev1", { nowMs: E(2026, 12, 11, 2, 30) });   // 8:30 PM Chicago = 9:30 PM Eastern
  ok(rz2.sent === true, "Chicago: 8:30 PM Chicago is not quiet (it would be on the Eastern clock), so the reminder is sent at once");
  const wz3 = world();
  wz3.d.raw.exec("UPDATE clients SET timezone = 'America/Chicago' WHERE id = 'c2'");
  addBooking(wz3, 1, "agreed", { date: "2026-12-10", time: "08:20" });
  const rz3 = await wz3.F.reminderTextDispatch(wz3.env, "reminder", "ge:ev1", { nowMs: E(2026, 12, 10, 12, 0) });   // 6:00 AM Chicago
  ok(rz3.reason === "quiet_hours_too_late", "Chicago: 6:00 AM Chicago for an 8:20 AM Chicago meeting is too late");
  const wz4 = world();
  wz4.d.raw.exec("UPDATE clients SET timezone = 'America/Chicago' WHERE id = 'c2'");
  addBooking(wz4, 1, "agreed", { date: "2026-12-14" });
  await wz4.F.reminderTextDispatch(wz4.env, "confirmation", "ge:ev1", { nowMs: E(2026, 12, 11, 4, 15) });         // 10:15 PM Chicago
  ok(wz4.state.calls.length === 1 && queueRows(wz4).length === 0, "Chicago: a confirmation at 10:15 PM Chicago sends at once");
});

// ── 10. Replies: POST /api/twilio/inbound ───────────────────────────────────
function inbound(w, token, from, body, sid, optOutType) {
  const url = "https://api.test/api/twilio/inbound" + (token === null ? "" : "?token=" + encodeURIComponent(token));
  const form = new URLSearchParams({ From: from, Body: body, MessageSid: sid || "SMr" + Math.random() });
  if (optOutType) { form.set("OptOutType", optOutType); }
  return w.F.handlePostTwilioInbound(new Request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() }), w.env);
}
await section("inbound", async () => {
  const w = world({ TWILIO_INBOUND_TOKEN: "s3cret-token" });
  addSession(w, "r1", { date: "2026-12-10", time: "14:00" });
  await w.F.reminderTextDispatch(w.env, "reminder", "r1", { nowMs: NOW });            // the reminder this customer answers
  const PHONE = "+14075550101";   // c1 whatsapp: the number the reminder went to
  const TW = async (r) => ({ status: r.status, type: r.headers.get("Content-Type"), text: await r.text() });

  const r0 = await TW(await inbound(w, null, PHONE, "1"));
  const r1 = await TW(await inbound(w, "wrong", PHONE, "1"));
  const r2 = await TW(await inbound(w, "", PHONE, "1"));
  ok(r0.status === 403 && r1.status === 403 && r2.status === 403, "no token, a wrong token and an empty token are all refused with 403");
  ok(rowsOf(w, "SELECT 1 FROM reminder_text_replies").length === 0 && w.state.pushes.length === 0, "a refused call changes nothing");
  const wNo = world();                                                                // no TWILIO_INBOUND_TOKEN in the environment at all
  addSession(wNo, "r1", { date: "2026-12-10", time: "14:00" });
  const rNo = await inbound(wNo, "", PHONE, "1");
  const rNo2 = await inbound(wNo, "undefined", PHONE, "1");
  ok(rNo.status === 403 && rNo2.status === 403 && rowsOf(wNo, "SELECT 1 FROM reminder_text_replies").length === 0, "with no secret set in the environment every call is refused");

  const ok1 = await TW(await inbound(w, "s3cret-token", PHONE, " 1 ", "SM1"));
  ok(ok1.status === 200 && /^text\/xml/.test(ok1.type) && ok1.text === "<Response></Response>", "the answer is empty TwiML (text/xml, <Response></Response>)");
  const conf = rowsOf(w, "SELECT kind, session_ref, body, forwarded FROM reminder_text_replies");
  ok(conf.length === 1 && conf[0].kind === "confirm" && conf[0].session_ref === "r1" && conf[0].forwarded === 1, "a reply of 1 is recorded as a confirmation for that meeting and forwarded");
  ok(w.state.pushes.length === 1 && w.state.pushes[0].targets.join() === "rafa@t.test" && /Acme Cleaning/.test(w.state.pushes[0].payload.body) && /12\/10\/2026/.test(w.state.pushes[0].payload.body) && /2:00 PM/.test(w.state.pushes[0].payload.body), "the host gets one push with the customer's name, the date and the time");
  await inbound(w, "s3cret-token", PHONE, "1", "SM2");
  ok(w.state.pushes.length === 1 && rowsOf(w, "SELECT 1 FROM reminder_text_replies WHERE kind = 'confirm'").length === 1, "a second 1 does not confirm or push again");

  const t = await TW(await inbound(w, "s3cret-token", PHONE, "Can we do 5 PM instead?", "SM3"));
  ok(t.text === "<Response></Response>" && w.state.pushes.length === 2 && /Can we do 5 PM instead\?/.test(w.state.pushes[1].payload.body), "any other reply is forwarded to the host with its text");
  ok(rowsOf(w, "SELECT 1 FROM reminder_text_replies WHERE kind = 'reply' AND forwarded = 1").length === 1, "and it is logged");
  await inbound(w, "s3cret-token", PHONE, "Can we do 5 PM instead?", "SM3");
  ok(w.state.pushes.length === 2 && rowsOf(w, "SELECT 1 FROM reminder_text_replies WHERE kind = 'reply'").length === 1, "Twilio sending the same message twice is stored and forwarded once");

  const callsBefore = w.state.calls.length;
  for (const word of ["STOP", "stop", "CANCEL", "END", "QUIT", "UNSUBSCRIBE", " stop ", "STOPALL", "REVOKE", "OPTOUT"]) {
    const rr = await TW(await inbound(w, "s3cret-token", PHONE, word));
    ok(rr.status === 200 && rr.text === "<Response></Response>", word.trim() + ": a stop word is answered with empty TwiML");
  }
  ok(w.state.pushes.length === 2 && rowsOf(w, "SELECT 1 FROM reminder_text_replies WHERE kind = 'optout'").length === 10, "stop words are stored as opt-outs (an audit row each) and nobody is pushed");
  ok(w.state.calls.length === callsBefore, "no reply of any kind is sent back (no cancel by text, no automatic answer)");
  for (const word of ["Start", "UNSTOP", "YES"]) {
    const rr = await TW(await inbound(w, "s3cret-token", PHONE, word));
    ok(rr.status === 200 && rr.text === "<Response></Response>", word + " without OptOutType: answered with empty TwiML");
  }
  ok(rowsOf(w, "SELECT 1 FROM reminder_text_replies WHERE kind = 'optin'").length === 0 && w.state.pushes.length === 5, "START, UNSTOP and YES without OptOutType are normal replies (pushed), not a start");

  const un = await TW(await inbound(w, "s3cret-token", "+14075559999", "hello"));
  ok(un.status === 200 && un.text === "<Response></Response>" && rowsOf(w, "SELECT kind FROM reminder_text_replies WHERE phone_e164 = '+14075559999'")[0].kind === "unmatched" && w.state.pushes.length === 6 && w.state.pushes[5].targets.join() === "dev@t.test", "a reply from a number we never texted is logged as unmatched and pushed to the developer role (changed: it used to be silent)");
  w.d.raw.exec("UPDATE reminder_text_sends SET sent_at = '2026-01-01T00:00:00.000Z'");
  const old = await TW(await inbound(w, "s3cret-token", PHONE, "1", "SM9"));
  ok(old.status === 200 && rowsOf(w, "SELECT kind FROM reminder_text_replies WHERE message_sid = 'SM9'")[0].kind === "unmatched", "a text older than 30 days is not matched (changed from 48 hours to 30 days, any kind)");
  const bad = await TW(await inbound(w, "s3cret-token", "", ""));
  ok(bad.status === 200 && bad.text === "<Response></Response>", "an empty call still gets empty TwiML");

  // a booking-link meeting: the push goes to the owner
  const wb = world({ TWILIO_INBOUND_TOKEN: "tok" });
  addBooking(wb, 1, "agreed", { date: "2026-12-10", time: "14:00", phone: "(407) 555-0155" });
  await wb.F.reminderTextDispatch(wb.env, "reminder", "ge:ev1", { nowMs: NOW });
  await inbound(wb, "tok", "+14075550155", "1", "SMb1");
  ok(wb.state.pushes.length === 1 && wb.state.pushes[0].targets.join() === "login:owner-c2" && /Customer 1 confirmed 12\/10\/2026 at 2:00 PM/.test(wb.state.pushes[0].payload.body), "booking link: the owner is told the customer confirmed (name, date, time)");
  // route registered
  ok(/path === "\/api\/twilio\/inbound"\s*&& method === "POST"/.test(workerSrc), "the route is registered for POST /api/twilio/inbound");
});

// ── 10b. Replies are never missed ───────────────────────────────────────────
await section("replies", async () => {
  const DAY = 86400000;
  const w = world({ TWILIO_INBOUND_TOKEN: "tok" });
  const PH = "+14075550155";                                             // booking 1's customer
  addBooking(w, 1, "agreed", { date: "2026-12-20", time: "10:00" });
  // (a) a reply to a CONFIRMATION, 5 days later, is matched and pushed
  await w.F.reminderTextDispatch(w.env, "confirmation", "ge:ev1", { nowMs: NOW });
  let r = await w.F.reminderTextHandleReply(w.env, PH, "Thank you, see you then", "SMa1", Date.now() + 5 * DAY);
  let row = rowsOf(w, "SELECT * FROM reminder_text_replies WHERE message_sid = 'SMa1'")[0];
  ok(r.kind === "reply" && row.session_ref === "ge:ev1" && row.client_id === "c2" && row.person_name === "Customer 1" && row.forwarded === 1, "a reply to a confirmation text 5 days later is matched to the meeting and forwarded");
  ok(w.state.pushes.length === 1 && w.state.pushes[0].targets.join() === "login:owner-c2" && /Thank you, see you then/.test(w.state.pushes[0].payload.body) && /12\/20\/2026 at 10:00 AM/.test(w.state.pushes[0].payload.body), "the owner got the reply text with the customer's name, date and time");
  // (b) "1" after a confirmation is a normal reply, not a confirmation
  r = await w.F.reminderTextHandleReply(w.env, PH, "1", "SMa2", Date.now() + 5 * DAY);
  ok(r.kind === "reply" && rowsOf(w, "SELECT 1 FROM reminder_text_replies WHERE kind = 'confirm'").length === 0 && /Customer replied/.test(w.state.pushes[1].payload.title) && /: 1$/.test(w.state.pushes[1].payload.body), "\"1\" after a confirmation text is a normal reply, pushed with its text");
  // "1" after a REMINDER confirms
  w.d.raw.exec("UPDATE reminder_text_sends SET sent_at = '2020-01-01T00:00:00.000Z'");
  await w.F.reminderTextDispatch(w.env, "reminder", "ge:ev1", { nowMs: Date.UTC(2026, 11, 20, 14, 0) });
  r = await w.F.reminderTextHandleReply(w.env, PH, "1", "SMa3", Date.now() + 1000);
  ok(r.kind === "confirm" && /Customer confirmed/.test(w.state.pushes[2].payload.title), "\"1\" after a reminder confirms the meeting");
  // (c) a reply to a CANCEL text is matched (the meeting is gone)
  const w2 = world({ TWILIO_INBOUND_TOKEN: "tok" });
  addBooking(w2, 1, "agreed", { date: "2026-12-20", time: "10:00" });
  const snap = await w2.F.reminderTextFacts(w2.env, "ge:ev1");
  w2.d.raw.exec("DELETE FROM gm_events");
  await w2.F.reminderTextDispatch(w2.env, "cancel", "ge:ev1", { nowMs: NOW, facts: snap });
  const rc = await w2.F.reminderTextHandleReply(w2.env, PH, "Why was it cancelled?", "SMc1", Date.now() + 1000);
  const rowc = rowsOf(w2, "SELECT * FROM reminder_text_replies WHERE message_sid = 'SMc1'")[0];
  ok(rc.kind === "reply" && rowc.session_ref === "ge:ev1" && rowc.person_name === "Customer 1" && rowc.meeting_at === "2026-12-20 10:00" && rowc.forwarded === 1 && w2.state.pushes[0].targets.join() === "login:owner-c2", "a reply to a cancel text is matched and reaches the owner even though the meeting is gone");
  // (d) unmatched: the developer role hears it, with the phone and the text
  const w3 = world({ TWILIO_INBOUND_TOKEN: "tok" });
  await w3.F.reminderTextHandleReply(w3.env, "+15555550999", "who is this?", "SMu1", Date.now());
  ok(w3.state.pushes.length === 1 && w3.state.pushes[0].targets.join() === "dev@t.test" && w3.state.pushes[0].payload.title === "Resposta de texto não associada" && /\+1 555-555-0999: who is this\?/.test(w3.state.pushes[0].payload.body) && rowsOf(w3, "SELECT forwarded FROM reminder_text_replies")[0].forwarded === 1, "an unmatched reply is pushed to the developer role with the phone and the text, and marked forwarded");
  // matched but nobody to push to
  const w4 = world({ TWILIO_INBOUND_TOKEN: "tok" });
  addBooking(w4, 1, "agreed", { date: "2026-12-20", time: "10:00" });
  await w4.F.reminderTextDispatch(w4.env, "confirmation", "ge:ev1", { nowMs: NOW });
  w4.state.noTargets = true;
  await w4.F.reminderTextHandleReply(w4.env, PH, "hello", "SMn1", Date.now());
  ok(w4.state.pushes.length === 1 && w4.state.pushes[0].targets.join() === "dev@t.test", "a matched reply with no host or owner to tell goes to the developer role");
  // (e) a failed push is retried by the cron, then marked forwarded
  const w5 = world({ TWILIO_INBOUND_TOKEN: "tok" });
  addBooking(w5, 1, "agreed", { date: "2026-12-20", time: "10:00" });
  await w5.F.reminderTextDispatch(w5.env, "confirmation", "ge:ev1", { nowMs: NOW });
  w5.state.pushFail = true;
  const t0 = Date.now();
  await w5.F.reminderTextHandleReply(w5.env, PH, "call me", "SMf1", t0);
  ok(rowsOf(w5, "SELECT forwarded FROM reminder_text_replies")[0].forwarded === 0 && w5.state.pushes.length === 0, "when every push fails the reply is saved and stays forwarded = 0");
  const early = await w5.F.reminderTextRepliesRetry(w5.env, t0 + 30000);
  ok(early.tried === 0, "the tick leaves a brand new reply alone for 2 minutes");
  w5.state.pushFail = true;
  const still = await w5.F.reminderTextRepliesRetry(w5.env, t0 + 5 * 60000);
  ok(still.tried === 1 && still.forwarded === 0 && rowsOf(w5, "SELECT forwarded FROM reminder_text_replies")[0].forwarded === 0, "a tick while pushes still fail tries once and leaves it for the next tick");
  w5.state.pushFail = false;
  const fixed = await w5.F.reminderTextRepliesRetry(w5.env, t0 + 10 * 60000);
  ok(fixed.forwarded === 1 && rowsOf(w5, "SELECT forwarded FROM reminder_text_replies")[0].forwarded === 1 && /call me/.test(w5.state.pushes[0].payload.body), "the cron tick retries and then marks it forwarded");
  w5.d.log.length = 0;
  const none = await w5.F.reminderTextRepliesRetry(w5.env, t0 + 15 * 60000);
  ok(none.tried === 0 && w5.d.log.length === 1 && /FROM reminder_text_replies/.test(w5.d.log[0]), "an idle tick costs one read");
  const plan = w5.d.raw.prepare("EXPLAIN QUERY PLAN SELECT id FROM reminder_text_replies WHERE forwarded = 0 AND received_at >= ? AND received_at <= ? ORDER BY received_at LIMIT 20").all("a", "b").map((x) => x.detail).join(" ");
  ok(/idx_rtr_retry/.test(plan), "and that read uses the index");
  const w6 = world({ TWILIO_INBOUND_TOKEN: "tok" });
  w6.state.pushFail = true;
  const t1 = Date.now();
  await w6.F.reminderTextHandleReply(w6.env, "+15555550998", "old one", "SMo1", t1);
  w6.state.pushFail = false;
  ok((await w6.F.reminderTextRepliesRetry(w6.env, t1 + 25 * 3600000)).tried === 0, "a reply older than 24 hours is no longer retried");

  // (f) the list: staff see all, an owner only their own
  const L = new world({ TWILIO_INBOUND_TOKEN: "tok" });
  addBooking(L, 1, "agreed", { date: "2026-12-20", time: "10:00" });
  addSession(L, "sa", { date: "2026-12-20", time: "14:00" });
  await L.F.reminderTextDispatch(L.env, "confirmation", "ge:ev1", { nowMs: NOW });
  await L.F.reminderTextDispatch(L.env, "confirmation", "sa", { nowMs: NOW });
  await L.F.reminderTextHandleReply(L.env, "+14075550155", "booking reply", "SML1", Date.now());
  await L.F.reminderTextHandleReply(L.env, "+14075550101", "admin reply", "SML2", Date.now() + 1000);
  await L.F.reminderTextHandleReply(L.env, "+15555550999", "stranger", "SML3", Date.now() + 2000);
  for (const role of ["alice", "rafa", "developer"]) {
    L.state.user = { role, email: role + "@t.test" };
    const out = await L.F.handleGetTextReplies({}, L.env);
    ok(out.status === 200 && out.data.replies.length === 3, role + " sees every reply (3)");
  }
  L.state.user = { role: "developer" };
  const all = (await L.F.handleGetTextReplies({}, L.env)).data.replies;
  ok(all[0].text === "stranger" && all[1].text === "admin reply" && all[2].text === "booking reply", "newest first");
  const br = all[2], un = all[0];
  ok(br.phone === "+1 407-555-0155" && br.matched === true && br.name === "Customer 1" && br.meeting_date === "12/20/2026" && br.meeting_time === "10:00 AM" && br.forwarded === true && /^\d{4}-\d\d-\d\dT/.test(br.received_at), "a row has the formatted phone, the text, the meeting (name, MM/DD/YYYY, 12-hour), forwarded and the time");
  ok(un.matched === false && un.name === null && un.meeting_date === null && un.phone === "+1 555-555-0999", "an unmatched reply says so");
  L.state.user = { role: "client", client_id: "c2", email: "o@t.test" };
  const own = await L.F.handleGetGmTextReplies("c2", {}, L.env);
  ok(own.status === 200 && own.data.replies.length === 1 && own.data.replies[0].text === "booking reply", "a client owner sees only the replies for their own client's meetings");
  const other = await L.F.handleGetGmTextReplies("c1", {}, L.env);
  ok(other.status === 403, "an owner cannot open another client's replies");
  L.state.user = { role: "client", client_id: "c1", email: "o1@t.test" };
  ok((await L.F.handleGetGmTextReplies("c1", {}, L.env)).data.replies.length === 0, "an owner never sees Apex staff meeting replies or unmatched ones");
  ok((await L.F.handleGetTextReplies({}, L.env)).status === 403, "the all-replies list is staff only");
  L.state.user = { role: "client", client_id: "c2", login_role: "seller", seller_name: "Bia" };
  ok((await L.F.handleGetGmTextReplies("c2", {}, L.env)).status === 403, "a salesperson login does not see customer replies");
  L.state.user = { role: "alice" };
  ok((await L.F.handleGetGmTextReplies("c2", {}, L.env)).data.replies.length === 1, "staff can open one client's list too");
  L.state.user = null;
  ok((await L.F.handleGetTextReplies({}, L.env)).status === 401, "no login, no list");
});

// ── 10c. STOP, START and HELP ───────────────────────────────────────────────
await section("optout", async () => {
  const TW = async (r) => ({ status: r.status, type: r.headers.get("Content-Type"), text: await r.text() });
  const PH = "+14075550155";                                          // the customer of booking 1
  const setup = (envx, bookingLang) => {
    const w = world(Object.assign({ TWILIO_INBOUND_TOKEN: "tok" }, envx || {}));
    addBooking(w, 1, "agreed", { date: "2026-12-20", time: "10:00", lang: bookingLang === undefined ? "es" : bookingLang });
    return w;
  };
  // STOP with OptOutType: recorded, queue cancelled, audit row, nothing pushed, next send refused
  const w = setup();
  await w.F.reminderTextDispatch(w.env, "confirmation", "ge:ev1", { nowMs: NOW });                               // sent by day
  addBooking(w, 2, "agreed", { date: "2026-12-21", time: "10:00" });                                              // a second meeting, same phone
  await w.F.reminderTextDispatch(w.env, "reminder", "ge:ev1", { nowMs: Date.UTC(2026, 11, 10, 3, 30) });        // 10:30 PM: held
  await w.F.reminderTextDispatch(w.env, "reminder", "ge:ev2", { nowMs: Date.UTC(2026, 11, 10, 3, 30) });        // 10:30 PM: held
  ok(rowsOf(w, "SELECT 1 FROM reminder_text_queue WHERE status = 'pending' AND phone_e164 = '+14075550155'").length === 2, "two reminders are held for the phone (the queue knows the phone)");
  const sentBefore = w.state.calls.length;
  const r = await TW(await inbound(w, "tok", PH, "STOP", "SMs1", "STOP"));
  ok(r.status === 200 && /^text\/xml/.test(r.type) && r.text === "<Response></Response>", "STOP: empty TwiML (Twilio sends its own reply)");
  ok(rowsOf(w, "SELECT 1 FROM reminder_text_optouts WHERE phone_e164 = '+14075550155'").length === 1, "STOP: the phone is in reminder_text_optouts");
  ok(rowsOf(w, "SELECT 1 FROM reminder_text_queue WHERE status = 'pending' AND phone_e164 = '+14075550155'").length === 0 && rowsOf(w, "SELECT 1 FROM reminder_text_queue WHERE status = 'dropped'").length === 2, "STOP: every pending held reminder for that phone is cancelled");
  const orow = rowsOf(w, "SELECT kind, forwarded, session_ref, person_name FROM reminder_text_replies WHERE message_sid = 'SMs1'")[0];
  ok(orow && orow.kind === "optout" && orow.session_ref === "ge:ev1" && orow.person_name === "Customer 1" && w.state.pushes.length === 0, "STOP: an optout row is stored with the meeting it belongs to, and nothing is pushed");
  const refused = await w.F.reminderTextDispatch(w.env, "reminder", "ge:ev1", { nowMs: NOW });
  const refusedSend = await w.F.reminderTextSend(w.env, { ref: "ge:ev1", recipient: "lead:L1", phone: PH, kind: "change", lang: "en", meetingAt: "2026-12-20 11:00", vars: {} });
  ok(refused.sent === false && refused.reason === "opted_out" && refusedSend.reason === "opted_out" && w.state.calls.length === sentBefore, "after STOP the next send to that phone, of any kind, is refused with no Twilio call");
  const tick = await w.F.reminderTextQueueTick(w.env, Date.UTC(2026, 11, 10, 13, 0));
  ok(tick.sent === 0 && w.state.calls.length === sentBefore, "and the 8:00 AM tick sends nothing to it");
  // START with OptOutType: removed, audit row, the audit trail stays
  const st = await TW(await inbound(w, "tok", PH, "START", "SMs2", "START"));
  ok(st.text === "<Response></Response>" && rowsOf(w, "SELECT 1 FROM reminder_text_optouts WHERE phone_e164 = '+14075550155'").length === 0, "START: the phone comes out of reminder_text_optouts");
  ok(rowsOf(w, "SELECT kind FROM reminder_text_replies WHERE message_sid = 'SMs2'")[0].kind === "optin" && rowsOf(w, "SELECT 1 FROM reminder_text_replies WHERE kind = 'optout'").length === 1 && w.state.pushes.length === 0, "START: an optin row is stored, the optout row is kept, nothing pushed");
  const again = await w.F.reminderTextDispatch(w.env, "reminder", "ge:ev1", { nowMs: NOW });
  ok(again.sent === true, "after START texts can go to the phone again");
  // a plain STOP with no OptOutType (Advanced Opt-Out not on yet)
  const w2 = setup();
  await inbound(w2, "tok", PH, " stop ", "SMp1");
  ok(rowsOf(w2, "SELECT 1 FROM reminder_text_optouts WHERE phone_e164 = '+14075550155'").length === 1 && rowsOf(w2, "SELECT kind FROM reminder_text_replies")[0].kind === "optout", "a plain STOP without OptOutType records the opt-out");
  // a plain YES, START or UNSTOP without OptOutType is a normal reply
  const w3 = setup();
  await w3.F.reminderTextDispatch(w3.env, "confirmation", "ge:ev1", { nowMs: NOW });
  w3.d.raw.exec("INSERT INTO reminder_text_optouts VALUES ('+14075550155', 'x')");
  await inbound(w3, "tok", PH, "YES", "SMy1");
  ok(rowsOf(w3, "SELECT 1 FROM reminder_text_optouts").length === 1 && rowsOf(w3, "SELECT kind FROM reminder_text_replies WHERE message_sid = 'SMy1'")[0].kind === "reply" && w3.state.pushes.length === 1, "a plain YES without OptOutType is a normal reply, not a start");
  await inbound(w3, "tok", PH, "YES", "SMy2", "START");
  ok(rowsOf(w3, "SELECT 1 FROM reminder_text_optouts").length === 0, "YES with OptOutType START is a start");
  ok(w3.F.reminderTextOptKind("stop", "hello") === "stop" && w3.F.reminderTextOptKind("Help", "") === "help" && w3.F.reminderTextOptKind("", "INFO") === "help" && w3.F.reminderTextOptKind("", "hello") === null && w3.F.reminderTextOptKind("WHATEVER", "STOPALL") === "stop" && w3.F.reminderTextOptKind(null, "START") === null, "OptOutType is read case-insensitively, then the body decides");

  // HELP
  const H = async (w, from, sid) => TW(await inbound(w, "tok", from, "HELP", sid, "HELP"));
  const wa = world({ TWILIO_INBOUND_TOKEN: "tok" });
  addSession(wa, "h1", { date: "2026-12-20", time: "14:00" });
  await wa.F.reminderTextDispatch(wa.env, "confirmation", "h1", { nowMs: NOW });
  const ha = await H(wa, "+14075550101", "SMh1");
  ok(/^text\/xml/.test(ha.type) && ha.text === "<Response><Message>Rafael: para o seu horário, ligue para +1 555-555-0123. Para ajuda com este serviço de mensagens, escreva para support@resonateai.online.</Message></Response>", "HELP after an admin text: Portuguese, host name and phone" + (ha.text.indexOf("Rafael") < 0 ? " got " + ha.text : ""));
  ok(rowsOf(wa, "SELECT kind FROM reminder_text_replies WHERE message_sid = 'SMh1'")[0].kind === "help" && wa.state.pushes.length === 0, "HELP: a help row is stored, nobody is pushed");
  ok(rowsOf(wa, "SELECT 1 FROM reminder_text_optouts").length === 0, "HELP does not opt anyone out");
  const wes = setup({}, "es");
  await wes.F.reminderTextDispatch(wes.env, "confirmation", "ge:ev1", { nowMs: NOW });
  ok((await H(wes, PH, "SMh2")).text === "<Response><Message>JM Luxury Pools: para su cita, llame al +1 321-555-0188. Para ayuda con este servicio de mensajes, escriba a support@resonateai.online.</Message></Response>", "HELP after a booking text with customer_language es: Spanish, business name and owner phone");
  const wen = setup({}, null);
  wen.d.raw.exec("UPDATE clients SET language = 'pt' WHERE id = 'c2'");
  await wen.F.reminderTextDispatch(wen.env, "confirmation", "ge:ev1", { nowMs: NOW });
  ok((await H(wen, PH, "SMh3")).text === "<Response><Message>JM Luxury Pools: for your appointment, call +1 321-555-0188. For help with this text service, email support@resonateai.online.</Message></Response>", "HELP after a booking text with no language: English (not the client's Portuguese)");
  const wpt = setup({}, "pt");
  await wpt.F.reminderTextDispatch(wpt.env, "confirmation", "ge:ev1", { nowMs: NOW });
  ok(/^<Response><Message>JM Luxury Pools: para o seu horário, ligue para \+1 321-555-0188\./.test((await H(wpt, PH, "SMh4")).text), "HELP after a booking text with customer_language pt: Portuguese");
  const wnp = setup({}, "en");
  await wnp.F.reminderTextDispatch(wnp.env, "confirmation", "ge:ev1", { nowMs: NOW });
  wnp.d.raw.exec("UPDATE clients SET phone = NULL, whatsapp = NULL WHERE id = 'c2'");
  ok((await H(wnp, PH, "SMh5")).text === "<Response><Message>JM Luxury Pools: for help with this text service, email support@resonateai.online.</Message></Response>", "HELP with no phone on record: the same text without the sentence about calling");
  const wn = setup();
  const hn = await H(wn, "+15555550777", "SMh6");
  ok(hn.status === 200 && hn.text === "<Response></Response>" && rowsOf(wn, "SELECT kind FROM reminder_text_replies WHERE message_sid = 'SMh6'")[0].kind === "help", "HELP with no matched text: empty TwiML (Twilio already answered), and the row is still kept");
  const wc = setup({}, "es");
  const snapc = await wc.F.reminderTextFacts(wc.env, "ge:ev1");
  await wc.F.reminderTextDispatch(wc.env, "cancel", "ge:ev1", { nowMs: NOW, facts: snapc });
  wc.d.raw.exec("DELETE FROM gm_events");
  ok(/^<Response><Message>JM Luxury Pools: for your appointment, call \+1 321-555-0188\./.test((await H(wc, PH, "SMh7")).text), "HELP after a cancel text (meeting gone): the business still answers");
  const wx = setup();
  wx.d.raw.exec("UPDATE clients SET name = 'Bob & <Sons>' WHERE id = 'c2'");
  await wx.F.reminderTextDispatch(wx.env, "confirmation", "ge:ev1", { nowMs: NOW });
  ok(/Bob &amp; &lt;Sons&gt;/.test((await H(wx, PH, "SMh8")).text), "names are escaped in the TwiML");
  // the token check is unchanged
  const wt = setup();
  const t1 = await inbound(wt, null, PH, "STOP", "SMt1", "STOP");
  const t2 = await inbound(wt, "wrong", PH, "STOP", "SMt2", "STOP");
  ok(t1.status === 403 && t2.status === 403 && rowsOf(wt, "SELECT 1 FROM reminder_text_optouts").length === 0 && rowsOf(wt, "SELECT 1 FROM reminder_text_replies").length === 0, "no token or a wrong token: still 403, and a STOP with a bad token changes nothing");
  // the help wording: exact words, the support address, and none of Twilio's own HELP text
  const sw = workerSrc.slice(workerSrc.indexOf("var REMINDER_TEXT_HELP"), workerSrc.indexOf("function reminderTextOptKind"));
  ok((sw.match(/support@resonateai\.online/g) || []).length === 6 && !/Reply HELP|Msg & data|Msg and data/i.test(sw), "help wording: the support address in all three languages, and not Twilio's own HELP words");
});

// ── 11. The migration ───────────────────────────────────────────────────────
await section("migration", async () => {
  const w = world({}, { legacyRow: true });
  const old = rowsOf(w, "SELECT kind, meeting_at, session_id FROM reminder_text_sends WHERE id = 'old1'")[0];
  ok(old && old.kind === "reminder" && old.meeting_at === "", "the old row survives the rebuild as kind reminder");
  const names = rowsOf(w, "SELECT name FROM sqlite_master WHERE type IN ('table','index')").map((r) => r.name);
  ok(["reminder_text_queue", "reminder_text_replies", "idx_rtq_due", "uq_rtq_pending", "uq_rtr_sid", "uq_rtr_confirm", "idx_rts_phone"].every((n) => names.indexOf(n) >= 0) && names.indexOf("reminder_text_sends_v2") < 0, "the queue, the replies table and all indexes exist; the temporary table is gone");
  ok(rowsOf(w, "SELECT name FROM pragma_table_info('users')").some((r) => r.name === "phone"), "users has a phone column");
  addSession(w, "s-old", { date: "2026-12-10", time: "14:00" });
  const r = await w.F.reminderTextDispatch(w.env, "reminder", "s-old", { nowMs: NOW });
  ok(r.reason === "already_sent" && w.state.calls.length === 0, "a reminder that was sent before the migration is not sent again");
  const rn = await w.F.reminderTextDispatch(w.env, "confirmation", "s-old", { nowMs: NOW });
  ok(rn.sent === true, "but the old row does not block a different kind for the same meeting");
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
