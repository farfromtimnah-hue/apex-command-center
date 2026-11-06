// Text consent on the booking page: the REAL bk* functions and the REAL reminder
// runner, cut from worker/index.js and run on an in-memory SQLite. No network.
//
//   node scripts/test-sms-consent.mjs
import { makeDb, build, baseStubs, workerSrc, hasFn } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };
async function section(fn) { try { await fn(); } catch (e) { ok(false, "section crashed: " + (e && e.message)); } }
const hasVar = (v) => workerSrc.indexOf("\nvar " + v + " =") >= 0;

const MIG = [
  "migrations/gm_growth_management.sql", "migrations/gm_events.sql", "migrations/gm_config_event_types.sql", "migrations/gm_event_types_keys.sql",
  "migrations/gm_lead_events.sql", "migrations/gm_leads_address.sql", "migrations/gm_leads_servico_desc_financiamento.sql",
  "migrations/gm_leads_costs_commission.sql", "migrations/gm_leads_stage_keys.sql", "migrations/customer_referrals.sql",
  "migrations/gm_lead_contacts.sql", "migrations/gm_lead_events.sql",
  "migrations/client_estimates_invoices_p1.sql", "migrations/client_estimates_invoices_p1b.sql", "migrations/hero_gallery_doc_settings.sql",
  "migrations/hero_flip.sql", "migrations/gm_booking.sql", "migrations/doc_links.sql",
  "migrations/2026-11-05_booking_sms_consent.sql"
];

// every top-level bk* function in the booking block, plus the helpers it reuses
const blockStart = workerSrc.indexOf("// \"Agendamento online\"");
const blockEnd = workerSrc.indexOf("// \"Enviar horarios\"");
const block = workerSrc.slice(blockStart, blockEnd);
const bkNames = [...block.matchAll(/^(?:async )?function ((?:bk|handle\w*Booking)\w*)\(/gm)].map((m) => m[1]);
const helpers = ["schedMinutes", "schedHHMM", "schedAddDays", "schedDayOfWeek", "fmtTime12", "tzOffsetMs", "tzShortLabel", "gmStr", "gmNum", "gmDateStr", "gmTimeStr",
  "gmReferralSlug", "gmEstNewToken", "gmNyNowParts", "gmOwnedRow", "gmInsertLead", "gmLogLeadEvents", "tzIsValid", "tzParts", "tzPad2", "tzLocalNowStamp", "tzZoneForState", "clientZoneFor", "resolveRequestZone", "gmGetConfig", "gmParseJsonList", "gmParseJsonListNonEmpty", "gmDocSettingsOwnerOnly", "sessionSellerName", "sellerCanActOnLead", "logoVersionParam",
  "docPrettyLink", "docLinkTarget", "docLinkSlugPart", "docLinkRandom", "gmOpeningBalanceAvailable"];
const vars = ["TZ_STATE_ZONES", "TZ_STATE_NAMES", "BK_STEP_MIN", "BK_ACTOR", "BK_QTYPES", "BK_PRESETS", "BK_INACTIVE", "BRAZIL_TZ_LABELS", "GM_LEAD_COST_FIELDS", "GM_LEAD_LOGGED_FIELDS", "GM_MONTH_NAMES_PT", "GM_DEFAULT_FINANCE_CATEGORIES", "GM_DEFAULT_VIEW_THRESHOLD", "APEX_TIMEZONE", "DEFAULT_ORIGIN", "DOC_LINK_ORIGIN", "DOC_LINK_PAGES", "DOC_LINK_LABELS"];

function bkWorld() {
  const d = makeDb(MIG);
  try { d.raw.exec("ALTER TABLE clients ADD COLUMN location_state TEXT"); } catch (e) { /* the shared schema may already have it */ }
  d.raw.exec("CREATE TABLE IF NOT EXISTS gm_doc_settings (client_id TEXT PRIMARY KEY, legal_name TEXT)");
  try { d.raw.exec("ALTER TABLE gm_leads ADD COLUMN imposto REAL"); } catch (e) { /* already there */ }
  d.raw.exec("INSERT INTO clients (id, name, phone, language, timezone) VALUES ('c1', 'Shine Cleaning', '555-0100', 'en', 'America/New_York')");
  d.raw.exec("INSERT INTO gm_config (client_id, event_types_json, cycle_months_json) VALUES ('c1', '[{\"key\":\"reuniao\",\"pt\":\"Reuniao\",\"en\":\"Meeting\"},{\"key\":\"visita_tecnica\",\"pt\":\"Visita\",\"en\":\"Visit\"}]', '[]')");
  const stubs = Object.assign({}, baseStubs, {
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status, error: en, error_pt: pt, error_en: en }, extra || {}),
    gmDocSettingsRow: async () => ({ legal_name: null, phone: null, brand_primary: "#112233", brand_accent: null }),
    gmDocHero: () => ({ url: null, hero: null }),
    gmClientPushTargets: async () => ["owner@x.test"],
    pushToUsers: async () => {},
    requireClientAccess: () => true,
    publicWriteRateLimit: async () => null, publicReadRateLimited: () => false,
    PUBLIC_LIMIT_MESSAGE: "limit", gmDocHexColor: (x) => x
  });
  const F = build(bkNames.concat(helpers).filter(hasFn), vars.filter(hasVar), stubs);
  const w = { d, env: { DB: d.DB }, F };
  d.raw.exec("INSERT INTO gm_booking_settings (client_id, enabled, public_slug, questions_json) VALUES ('c1', 1, 'abcdefghij2345', '" +
    JSON.stringify({ preset: "cleaning", items: F.bkPresetItems("cleaning").concat(F.bkPresetItems("general")) }).replace(/'/g, "''") + "')");
  return w;
}
let seq = 0;
async function freshLead(w) {
  seq++;
  const lid = "L" + seq, rid = "R" + seq, tok = String(seq).padStart(48, "a");
  w.d.raw.exec("INSERT INTO gm_leads (id, client_id, cliente, telefone, address, origem, estagio) VALUES ('" + lid + "','c1','MARIA SILVA','(555) 111-2222','12 Oak St','Site','novo_lead')");
  w.d.raw.exec("INSERT INTO gm_booking_requests (id, token, client_id, lead_id, kind, status) VALUES ('" + rid + "','" + tok + "','c1','" + lid + "','lead','waiting')");
  return { rid, lid, ctx: await w.F.bkResolve(w.env, "lead", tok) };
}
// Monday 10/05/2026 8:00 AM Eastern
const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const book = (over) => Object.assign({ slot_date: "2026-10-06", slot_time: "10:00", customer: { name: "Maria Silva", phone: "(555) 999-0000", email: "maria@x.test", address: "12 Oak St", city: "Tampa" },
  answers: { bedrooms: 3, bathrooms: "2", sqft: 1800, clean_type: "deep", pets: "yes", need_done: "Kitchen" } }, over || {});

// ── 1. the booking stores the consent and validates it ─────────────────────
await section(async () => {
  const w = bkWorld();
  const a = await freshLead(w);
  const r = await w.F.bkConfirm(w.env, a.ctx, book({ sms_consent_status: "agreed" }), NOW);
  const row = w.d.q("SELECT sms_consent_status, sms_consent_at FROM gm_booking_requests WHERE id = '" + a.rid + "'")[0];
  ok(r.status === 200 && row.sms_consent_status === "agreed", "booking with agreed: succeeds and stores agreed");
  ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(row.sms_consent_at || ""), "booking with agreed: sms_consent_at is a UTC timestamp");

  const b = await freshLead(w);
  const r2 = await w.F.bkConfirm(w.env, b.ctx, book({ sms_consent_status: "declined", slot_time: "11:00" }), NOW);
  const row2 = w.d.q("SELECT sms_consent_status, sms_consent_at FROM gm_booking_requests WHERE id = '" + b.rid + "'")[0];
  ok(r2.status === 200 && row2.sms_consent_status === "declined" && /Z$/.test(row2.sms_consent_at || ""), "booking with declined (box left unchecked): still succeeds, stores declined and a UTC time");

  const c = await freshLead(w);
  const r3 = await w.F.bkConfirm(w.env, c.ctx, book({ slot_time: "12:00" }), NOW);
  const row3 = w.d.q("SELECT sms_consent_status, sms_consent_at FROM gm_booking_requests WHERE id = '" + c.rid + "'")[0];
  ok(r3.status === 200 && row3.sms_consent_status === null && row3.sms_consent_at === null, "booking with no consent field: succeeds and stores NULL and NULL (older pages keep working)");
  const r3b = await (async () => { const x = await freshLead(w); const out = await w.F.bkConfirm(w.env, x.ctx, book({ slot_time: "13:00", sms_consent_status: null }), NOW); return { out, row: w.d.q("SELECT sms_consent_status, sms_consent_at FROM gm_booking_requests WHERE id = '" + x.rid + "'")[0] }; })();
  ok(r3b.out.status === 200 && r3b.row.sms_consent_status === null && r3b.row.sms_consent_at === null, "booking with consent null: stores NULL and NULL");
});

await section(async () => {
  const w = bkWorld();
  for (const bad of ["yes", "AGREED", "Declined", "", "true", 1, true, false, 0, ["agreed"], { v: "agreed" }, "agreed "]) {
    const a = await freshLead(w);
    const r = await w.F.bkConfirm(w.env, a.ctx, book({ sms_consent_status: bad }), NOW);
    const st = w.d.q("SELECT status, sms_consent_status FROM gm_booking_requests WHERE id = '" + a.rid + "'")[0];
    const ev = w.d.q("SELECT COUNT(*) AS n FROM gm_events WHERE lead_id = '" + a.lid + "'")[0].n;
    ok(r.status === 400 && st.status === "waiting" && st.sms_consent_status === null && ev === 0, "booking with sms_consent_status " + JSON.stringify(bad) + ": 400, nothing booked, nothing stored");
  }
});

// ── 2. the reminder sender skips only declined ─────────────────────────────
const RFNS = ["apptRemWall", "apptRemTime", "apptRemFmt12", "apptRemDateMDY", "apptRemLead", "apptRemFindSessions", "apptRemFindClientEvents", "apptRemRoleEmails", "apptRemSend",
  "apptRemClientPhone", "apptRemStaffDisplayName", "sessionGetsTextReminder", "runAppointmentReminders", "reminderTextConsentAllows", "passkeyNormalizePhone", "passkeyCountryCode",
  "planClientAnd", "clientZoneFor", "tzIsValid", "tzZoneForState", "tzParts", "tzPad2", "tzOffsetMs"];
const RVARS = ["APEX_TIMEZONE", "APPT_REMINDER_LEADS_MIN", "APPT_REMINDER_WINDOW_MIN", "APPT_REMINDER_OWNER_ROLE", "TZ_STATE_ZONES", "TZ_STATE_NAMES"];

function remWorld() {
  const d = makeDb(MIG);
  d.raw.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, client_name TEXT NOT NULL, client_id TEXT, date TEXT NOT NULL, time TEXT,
      session_type TEXT, status TEXT NOT NULL DEFAULT 'pending', location TEXT, created_by TEXT, send_text_reminder INTEGER);
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT, role TEXT);
    CREATE TABLE IF NOT EXISTS push_sent_log (dedupe_key TEXT PRIMARY KEY, sent_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  try { d.raw.exec("ALTER TABLE clients ADD COLUMN location_state TEXT"); } catch (e) { /* already there */ }
  const texts = [];
  const stubs = Object.assign({}, baseStubs, {
    pushToUsers: async () => ({ sent: 1, failed: 0, total: 1 }),
    gmClientPushTargets: async (env, clientId) => ["login:" + clientId],
    reminderTextSend: async (env, sessionId, recipient, phone) => { texts.push({ sessionId, recipient, phone }); return { sent: true }; }
  });
  const F = build(RFNS.filter(hasFn), RVARS.filter(hasVar), stubs);
  return { d, env: { DB: d.DB }, F, texts };
}
// 2026-10-15 2:00 PM EDT = 18:00Z; the 60 minute window is (2:50 PM, 3:00 PM]
const RNOW = Date.UTC(2026, 9, 15, 18, 0, 0);
function addBooking(w, n, consent) {
  const phone = "(407) 555-01" + String(10 + n);
  w.d.raw.prepare("INSERT OR IGNORE INTO clients (id, name, status, language, timezone, archived) VALUES ('c1','Shine Cleaning','active','en','America/New_York',0)").run();
  w.d.raw.prepare("INSERT INTO gm_leads (id, client_id, cliente, telefone) VALUES (?, 'c1', 'Cust', ?)").run("lead" + n, phone);
  w.d.raw.prepare("INSERT INTO gm_events (id, client_id, event_type, title, event_date, start_time, all_day, lead_id) VALUES (?, 'c1', 'visita_tecnica', 'Visit', '2026-10-15', '14:55', 0, ?)").run("ev" + n, "lead" + n);
  w.d.raw.prepare("INSERT INTO gm_booking_requests (id, token, client_id, lead_id, kind, status, event_id, sms_consent_status) VALUES (?, ?, 'c1', ?, 'lead', 'booked', ?, ?)")
    .run("br" + n, String(n).padStart(48, "b"), "lead" + n, "ev" + n, consent);
}

await section(async () => {
  const w = remWorld();
  ok(typeof w.F.reminderTextConsentAllows === "function", "the consent helper exists in the Worker");
  addBooking(w, 1, "declined");
  addBooking(w, 2, "agreed");
  addBooking(w, 3, null);
  const out = await w.F.runAppointmentReminders(w.env, { nowMs: RNOW });
  ok(!out.error, "the reminder runner finishes without an error");
  const sentTo = w.texts.map((t) => t.sessionId).sort().join(",");
  ok(sentTo === "ge:ev2,ge:ev3", "reminder texts go to agreed and NULL, never to declined (sent: " + sentTo + ")");
});
await section(async () => {
  const w = remWorld();
  ok(w.F.reminderTextConsentAllows("declined") === false, "helper: declined is the only status that blocks");
  ok(["agreed", null, undefined, ""].every((s) => w.F.reminderTextConsentAllows(s) === true), "helper: agreed, NULL, undefined and empty all allow (existing rows keep working)");
  const send = workerSrc.slice(workerSrc.indexOf("async function reminderTextSend("), workerSrc.indexOf("function sessionGetsTextReminder"));
  ok(/reminder_text_optouts/.test(send), "the STOP handling (reminder_text_optouts) is still checked inside reminderTextSend");
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
