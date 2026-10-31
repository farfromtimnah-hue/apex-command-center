// One server side zone rule for a client: device header, then the client's saved
// timezone, then the client's saved state, then Eastern. The REAL Worker
// functions are cut out of worker/index.js and run on an in-memory SQLite.
//
//   node scripts/test-client-zone.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const eq = (a, b, m) => ok(a === b, m + (a === b ? "" : "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"));

const d = makeDb([]);
try { d.raw.exec("ALTER TABLE clients ADD COLUMN location_state TEXT"); } catch (e) { /* already there */ }
d.raw.exec(`
  CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, client_name TEXT, client_id TEXT, date TEXT, time TEXT, end_time TEXT,
    session_type TEXT, status TEXT DEFAULT 'pending', location TEXT, google_meet_link TEXT, meeting_category TEXT, whatsapp_sent_at TEXT);
  CREATE TABLE IF NOT EXISTS message_templates (template_key TEXT PRIMARY KEY, template_text TEXT);
  CREATE TABLE IF NOT EXISTS gm_events (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, event_type TEXT, title TEXT NOT NULL,
    event_date TEXT NOT NULL, start_time TEXT, end_time TEXT, all_day INTEGER NOT NULL DEFAULT 0, location TEXT, lead_id TEXT);
  CREATE TABLE IF NOT EXISTS gm_leads (id TEXT PRIMARY KEY, telefone TEXT);
`);
const addClient = (id, tz, st) => d.raw.prepare("INSERT INTO clients (id, name, status, archived, timezone, location_state) VALUES (?,?,?,?,?,?)")
  .run(id, "Name " + id, "active", 0, tz, st);
addClient("c-wa", null, "US-WA");        // Washington, no timezone saved (YETCH ROOFING)
addClient("c-la", "America/Los_Angeles", null);   // Sara Seattle: zone, no state
addClient("c-fl", null, "US-FL");
addClient("c-none", null, null);
addClient("c-bad", "Not/AZone", "US-WA");

let F;
try {
  F = build(
    ["tzIsValid", "tzZoneForState", "clientZoneFor", "resolveRequestZone", "gmWeatherZone", "gmWeatherRequestZone",
     "handlePostSessionWhatsapp", "fmtTimeForClient", "fmtTime12", "tzShortLabel", "tzOffsetMs",
     "apptRemFindClientEvents", "apptRemWall", "apptRemTime", "bkClientInfo"],
    ["APEX_TIMEZONE", "TZ_STATE_ZONES", "TZ_STATE_NAMES", "BRAZIL_TZ_LABELS", "WEEKDAYS_PT", "DEFAULT_WHATSAPP_TEMPLATES"],
    Object.assign({}, baseStubs, {
      Intl: globalThis.Intl, Date: Date, Math: Math, Number: Number, Object: Object, URL: globalThis.URL,
      authenticate: async () => ({ role: "developer" })
    }));
} catch (e) {
  ok(false, "the Worker has the zone helpers: " + e.message);
  console.log("\n" + fail + " failing");
  process.exit(1);
}
const env = { DB: d.DB };
const request = (hdr, url) => ({ url: url || "https://x.test/", headers: { get: (k) => (k === "X-Client-Tz" ? hdr : null) } });

// ---- tzZoneForState accepts the stored "US-XX" shape ----
eq(F.tzZoneForState("US-WA"), "America/Los_Angeles", "tzZoneForState takes US-WA (the stored shape)");
eq(F.tzZoneForState("us-wa"), "America/Los_Angeles", "tzZoneForState takes lower case us-wa");
eq(F.tzZoneForState("WA"), "America/Los_Angeles", "tzZoneForState takes WA");
eq(F.tzZoneForState("Washington"), "America/Los_Angeles", "tzZoneForState takes Washington");
eq(F.tzZoneForState("US-"), null, "tzZoneForState rejects a bare US- prefix");
eq(F.tzZoneForState("US-ZZ"), null, "tzZoneForState rejects an unknown US- code");
eq(F.tzZoneForState("US-FL"), "America/New_York", "tzZoneForState takes US-FL");

// ---- clientZoneFor ----
eq(F.clientZoneFor({ timezone: "America/Chicago", location_state: null }), "America/Chicago", "timezone and no state: the timezone");
eq(F.clientZoneFor({ timezone: "", location_state: "US-WA" }), "America/Los_Angeles", "state US-WA and empty timezone: Pacific");
eq(F.clientZoneFor({ timezone: null, location_state: "WA" }), "America/Los_Angeles", "state WA: Pacific");
eq(F.clientZoneFor({ timezone: null, location_state: "Washington" }), "America/Los_Angeles", "state Washington: Pacific");
eq(F.clientZoneFor({ timezone: null, location_state: null }), "America/New_York", "neither: Eastern");
eq(F.clientZoneFor(null), "America/New_York", "no row at all: Eastern");
eq(F.clientZoneFor(undefined), "America/New_York", "undefined row: Eastern");
eq(F.clientZoneFor({ timezone: "Not/AZone", location_state: "US-WA" }), "America/Los_Angeles", "a bad timezone falls through to the state");
eq(F.clientZoneFor({ timezone: "Not/AZone", location_state: "ZZ" }), "America/New_York", "bad timezone and bad state: Eastern");
eq(F.clientZoneFor({ timezone: "America/New_York", location_state: "US-WA" }), "America/New_York", "a saved timezone beats the state");
eq(F.clientZoneFor({ timezone: null, location_state: "US-TX" }), "America/Chicago", "a state with several zones keeps its usual zone");
eq(F.clientZoneFor({ timezone: null, location_state: "US-ID" }), "America/Denver", "Idaho keeps its usual zone");

// ---- resolveRequestZone: header, then client, then Eastern ----
eq(await F.resolveRequestZone(request("America/Sao_Paulo"), env, "c-wa"), "America/Sao_Paulo", "a valid header wins over the client state");
eq(await F.resolveRequestZone(request("America/Denver"), env, "c-la"), "America/Denver", "a valid header wins over the client timezone");
eq(await F.resolveRequestZone(request(null), env, "c-wa"), "America/Los_Angeles", "no header, US-WA client: Pacific");
eq(await F.resolveRequestZone(request(null), env, "c-la"), "America/Los_Angeles", "no header, timezone client: its timezone");
eq(await F.resolveRequestZone(request("garbage"), env, "c-wa"), "America/Los_Angeles", "a bad header is ignored, the client state applies");
eq(await F.resolveRequestZone(request(null), env, "c-fl"), "America/New_York", "no header, Florida client: Eastern");
eq(await F.resolveRequestZone(request(null), env, "c-none"), "America/New_York", "no header, no zone, no state: Eastern");
eq(await F.resolveRequestZone(request(null), env, "c-missing"), "America/New_York", "no header, no such client: Eastern");
eq(await F.resolveRequestZone(request(null), env, "c-bad"), "America/Los_Angeles", "bad saved timezone falls to the state");

// ---- weather: valid ?tz= first, else the request zone ----
const wUrl = (tz) => "https://x.test/api/x/weather" + (tz ? "?tz=" + encodeURIComponent(tz) : "");
eq(await F.gmWeatherRequestZone(request(null, wUrl("America/Chicago")), env, "c-wa"), "America/Chicago", "weather: a valid ?tz= wins");
eq(await F.gmWeatherRequestZone(request("America/Denver", wUrl("America/Chicago")), env, "c-wa"), "America/Chicago", "weather: ?tz= beats the header");
eq(await F.gmWeatherRequestZone(request("America/Denver", wUrl()), env, "c-wa"), "America/Denver", "weather: no ?tz=, the header");
eq(await F.gmWeatherRequestZone(request(null, wUrl()), env, "c-wa"), "America/Los_Angeles", "weather: no ?tz= and no header, the client state");
eq(await F.gmWeatherRequestZone(request(null, wUrl("nope")), env, "c-wa"), "America/Los_Angeles", "weather: a bad ?tz= falls to the client state");
eq(await F.gmWeatherRequestZone(request(null, wUrl()), env, "c-none"), "America/New_York", "weather: nothing known, Eastern");

// ---- the WhatsApp scheduling message ----
d.raw.prepare("INSERT INTO sessions (id, client_name, client_id, date, time, session_type, status) VALUES (?,?,?,?,?,?,?)")
  .run("s-wa", "WA", "c-wa", "2026-10-15", "21:30", "in_person", "pending");
d.raw.prepare("INSERT INTO sessions (id, client_name, client_id, date, time, session_type, status) VALUES (?,?,?,?,?,?,?)")
  .run("s-fl", "FL", "c-fl", "2026-10-15", "21:30", "in_person", "pending");
d.raw.prepare("INSERT INTO sessions (id, client_name, client_id, date, time, session_type, status) VALUES (?,?,?,?,?,?,?)")
  .run("s-la", "LA", "c-la", "2026-10-15", "21:30", "in_person", "pending");
const textOf = async (sid) => {
  const r = await F.handlePostSessionWhatsapp(sid, request(null), env);
  return r.status === 200 ? decodeURIComponent(r.data.whatsapp_url.split("text=")[1]) : "ERR " + JSON.stringify(r);
};
const wa = await textOf("s-wa");
ok(/9:30 PM EDT \/ 6:30 PM PDT/.test(wa), "WhatsApp for a US-WA client shows BOTH zones, labelled: " + wa);
const la = await textOf("s-la");
ok(/9:30 PM EDT \/ 6:30 PM PDT/.test(la), "WhatsApp for a timezone client still shows both zones: " + la);
const fl = await textOf("s-fl");
ok(/às 9:30 PM\./.test(fl) && !/\//.test(fl.split("às")[1] || ""), "WhatsApp for a Florida client shows the single Eastern time: " + fl);

// ---- appointment reminders find a US-WA client's event on the client's own clock ----
d.raw.prepare("INSERT INTO gm_events (id, client_id, title, event_date, start_time, all_day) VALUES (?,?,?,?,?,0)")
  .run("e-wa", "c-wa", "Visit", "2026-10-15", "15:00");
// 3:00 PM Pacific = 22:00Z. Window (21:50Z, 22:00Z].
const lo = Date.UTC(2026, 9, 15, 21, 50, 0), hi = Date.UTC(2026, 9, 15, 22, 0, 0);
const found = await F.apptRemFindClientEvents(env, lo, hi);
eq(found.rows.length, 1, "the reminder search finds the US-WA client's 3:00 PM Pacific event");
d.raw.prepare("INSERT INTO gm_events (id, client_id, title, event_date, start_time, all_day) VALUES (?,?,?,?,?,0)")
  .run("e-fl", "c-fl", "Visit", "2026-10-15", "15:00");
const found2 = await F.apptRemFindClientEvents(env, lo, hi);
eq(found2.rows.filter((r) => r.client_id === "c-fl").length, 0, "the Florida client's 3:00 PM Eastern event is NOT in that Pacific window");

// ---- the booking page's client info carries the state fallback ----
eq((await F.bkClientInfo(env, "c-wa")).timezone, "America/Los_Angeles", "bkClientInfo: US-WA client gets Pacific");
eq((await F.bkClientInfo(env, "c-none")).timezone, "America/New_York", "bkClientInfo: no zone, Eastern");
eq((await F.bkClientInfo(env, "c-la")).timezone, "America/Los_Angeles", "bkClientInfo: saved timezone");

console.log("\n" + (fail ? fail + " failing" : "all passed"));
process.exit(fail ? 1 : 0);
