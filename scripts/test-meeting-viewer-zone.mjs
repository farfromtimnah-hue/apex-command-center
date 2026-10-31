// The portal meeting card and the booked row show the VIEWER's clock. Sessions are
// stored as wall clock on the Apex clock (America/New_York); the Worker converts
// them to the viewer's zone on the way out. The REAL Worker functions run on an
// in-memory SQLite, with a fixed "now".
//
//   node scripts/test-meeting-viewer-zone.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + (JSON.stringify(a) === JSON.stringify(b) ? "" : "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"));

const mkDate = (iso) => {
  const FIXED = Date.parse(iso);
  return class extends Date {
    constructor(...a) { if (a.length) { super(...a); } else { super(FIXED); } }
    static now() { return FIXED; }
  };
};

const d = makeDb([]);
try { d.raw.exec("ALTER TABLE clients ADD COLUMN location_state TEXT"); } catch (e) { /* already there */ }
d.raw.exec(`
  CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, client_name TEXT, client_id TEXT, date TEXT, time TEXT, end_time TEXT,
    session_type TEXT, status TEXT DEFAULT 'pending', location TEXT, google_meet_link TEXT, html_link TEXT);
`);
const addClient = (id, tz, st) => d.raw.prepare("INSERT INTO clients (id, name, status, archived, timezone, location_state) VALUES (?,?,?,?,?,?)").run(id, "N " + id, "active", 0, tz, st);
addClient("c-fl", null, "US-FL");
addClient("c-wa", null, "US-WA");
addClient("c-other", null, null);
let n = 0;
const addSession = (client, date, time, end, extra) => {
  const e = Object.assign({ status: "pending", type: "online_meet", loc: null, meet: "https://meet.google.com/x", html: null }, extra || {});
  d.raw.prepare("INSERT INTO sessions (id, client_name, client_id, date, time, end_time, session_type, status, location, google_meet_link, html_link) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("s" + (++n), "X", client, date, time, end, e.type, e.status, e.loc, e.meet, e.html);
};
const clearSessions = () => d.raw.exec("DELETE FROM sessions");

const NAMES = ["handleGetPortalNextMeeting", "handleGetSchedulingClientState", "easternDateStr", "portalMeetingsForViewer", "apexWallToZone", "apexEndToZone",
  "tzWallToUtcMs", "tzMidnightUtcMs", "tzParts", "tzOffsetMinutes", "tzIsValid", "tzZoneForState", "clientZoneFor", "resolveRequestZone", "tzPad2"];
let make;
try {
  make = (nowIso, user) => build(NAMES, ["APEX_TIMEZONE", "TZ_STATE_ZONES", "TZ_STATE_NAMES"], Object.assign({}, baseStubs, {
    Intl: globalThis.Intl, Date: mkDate(nowIso), Math: Math, Number: Number, Object: Object, URL: globalThis.URL,
    authenticate: async () => user,
    isAdminRole: (u) => !!u && (u.role === "developer" || u.role === "rafa" || u.role === "alice"),
    previewClientId: (u, r) => {
      if (!u || !(u.role === "developer" || u.role === "rafa" || u.role === "alice")) { return null; }
      return new URL(r.url).searchParams.get("previewAs") || null;
    },
    schedWindowStart: () => "2026-10-26",
    schedWindowEnd: () => "2026-11-10"
  }));
  make("2026-11-01T17:00:00Z", null);
} catch (e) {
  ok(false, "the Worker has the meeting helpers: " + e.message);
  console.log("\n" + fail + " failing");
  process.exit(1);
}
const env = { DB: d.DB };
const request = (tz, url) => ({ url: url || "https://x.test/api/portal/next-meeting", headers: { get: (k) => (k === "X-Client-Tz" ? tz : null) } });
const client = (id) => ({ role: "client", client_id: id });

// ---- the conversion, on its own ----
{
  const F = make("2026-11-01T17:00:00Z", null);
  const PAC = "America/Los_Angeles", EAST = "America/New_York", SP = "America/Sao_Paulo";
  eq(F.apexWallToZone("2026-11-01", "21:30", PAC), { date: "2026-11-01", time: "18:30" }, "stored 2026-11-01 21:30 is 18:30 for Pacific");
  eq(F.apexWallToZone("2026-11-01", "21:30", EAST), { date: "2026-11-01", time: "21:30" }, "stored 2026-11-01 21:30 is 21:30 for Eastern");
  eq(F.apexWallToZone("2026-11-02", "01:00", PAC), { date: "2026-11-01", time: "22:00" }, "stored 2026-11-02 01:00 is still 2026-11-01 (22:00, PST) for Pacific");
  eq(F.apexWallToZone("2026-11-02", "01:00", EAST), { date: "2026-11-02", time: "01:00" }, "stored 2026-11-02 01:00 stays 2026-11-02 for Eastern");
  eq(F.apexWallToZone("2026-07-10", "15:00", SP), { date: "2026-07-10", time: "16:00" }, "Sao Paulo in July is 1 hour ahead of Eastern (EDT, no DST in Brazil)");
  eq(F.apexWallToZone("2026-01-10", "15:00", SP), { date: "2026-01-10", time: "17:00" }, "Sao Paulo in January is 2 hours ahead of Eastern (EST)");
  eq(F.apexWallToZone("2026-01-10", "23:00", SP), { date: "2026-01-11", time: "01:00" }, "Sao Paulo: late evening Eastern rolls to the next day");
  // clock change days. 2026-03-08: Eastern jumps 2:00 to 3:00 (02:30 does not exist). 2026-11-01: 1:30 happens twice.
  eq(F.apexWallToZone("2026-03-08", "01:30", PAC), { date: "2026-03-07", time: "22:30" }, "03-08 01:30 Eastern (EST) is 22:30 on 03-07 Pacific");
  eq(F.apexWallToZone("2026-03-08", "03:30", PAC), { date: "2026-03-07", time: "23:30" }, "03-08 03:30 Eastern (EDT, 07:30 UTC) is 23:30 on 03-07 Pacific (still PST)");
  let miss; try { miss = F.apexWallToZone("2026-03-08", "02:30", PAC); } catch (e) { miss = "THREW " + e.message; }
  eq(miss, { date: "2026-03-07", time: "22:30" }, "the missing hour 02:30 on 03-08 does not throw and lands on a stable result (one hour earlier)");
  let rep; try { rep = F.apexWallToZone("2026-11-01", "01:30", PAC); } catch (e) { rep = "THREW " + e.message; }
  eq(rep, { date: "2026-10-31", time: "22:30" }, "the repeated hour 01:30 on 11-01 does not throw and takes the first one (EDT)");
  eq(F.apexWallToZone("2026-11-01", "21:30", PAC), { date: "2026-11-01", time: "18:30" }, "11-01 21:30 Eastern (EST) is 18:30 Pacific (PST)");
  eq(F.apexWallToZone("2026-11-01", "21:30", EAST), { date: "2026-11-01", time: "21:30" }, "Eastern viewers get the stored value back untouched, even in the repeated hour");
  eq(F.apexWallToZone("2026-11-01", "01:30", EAST), { date: "2026-11-01", time: "01:30" }, "Eastern: the repeated hour comes back untouched");
  eq(F.apexWallToZone("2026-03-08", "02:30", EAST), { date: "2026-03-08", time: "02:30" }, "Eastern: the missing hour comes back untouched");
  // no time: date kept, nothing converted
  eq(F.apexWallToZone("2026-11-01", null, PAC), { date: "2026-11-01", time: null }, "no time: the date is kept and nothing is converted");
  eq(F.apexWallToZone("2026-11-01", "", PAC), { date: "2026-11-01", time: "" }, "empty time: the date is kept and nothing is converted");
  // end time
  eq(F.apexEndToZone("2026-11-01", "22:30", PAC), "19:30", "end_time HH:MM converts like the start");
  eq(F.apexEndToZone("2026-11-01", "22:30", EAST), "22:30", "end_time HH:MM for Eastern is untouched");
  eq(F.apexEndToZone("2026-11-01", "2026-11-01T22:30:00-05:00", PAC), "19:30", "end_time as a full ISO value with an offset is converted as an instant");
  eq(F.apexEndToZone("2026-11-01", "2026-11-02T03:30:00Z", PAC), "19:30", "end_time as a full ISO value ending in Z is converted as an instant");
  eq(F.apexEndToZone("2026-11-01", "2026-11-01T22:30:00", PAC), "19:30", "end_time as an ISO value with no offset is read as Apex clock");
  eq(F.apexEndToZone("2026-11-01", null, PAC), null, "no end_time stays null");
  eq(F.apexEndToZone("2026-11-01", "garbage", PAC), "garbage", "an unreadable end_time is passed through, never thrown on");
}

// ---- easternDateStr is safe on clock change days ----
{
  const F = make("2026-11-02T04:30:00Z", null);   // 2026-11-01 23:30 EST
  eq(F.easternDateStr(0), "2026-11-01", "easternDateStr(0) on 11-01 23:30 EST");
  eq(F.easternDateStr(-1), "2026-10-31", "easternDateStr(-1) is the Eastern calendar day before, not 24 hours back");
  eq(F.easternDateStr(-2), "2026-10-30", "easternDateStr(-2)");
  eq(F.easternDateStr(1), "2026-11-02", "easternDateStr(1)");
  const G = make("2026-03-08T04:30:00Z", null);   // 2026-03-07 23:30 EST
  eq(G.easternDateStr(1), "2026-03-08", "easternDateStr(1) on 03-07 23:30 EST is 03-08, not 03-09");
  eq(G.easternDateStr(2), "2026-03-09", "easternDateStr(2)");
  eq(G.easternDateStr(-3), "2026-03-04", "easternDateStr(-3)");
}

// ---- the route: same auth, same scoping, converted fields ----
{
  const NOW = "2026-11-01T17:00:00Z";   // 2026-11-01 12:00 EST
  let F = make(NOW, null);
  eq((await F.handleGetPortalNextMeeting(request("America/New_York"), env)).status, 401, "next-meeting: not signed in is 401");
  F = make(NOW, { role: "alice" });
  eq((await F.handleGetPortalNextMeeting(request("America/New_York"), env)).status, 401, "next-meeting: staff without previewAs is still 401");
  F = make(NOW, { role: "client", client_id: null });
  eq((await F.handleGetPortalNextMeeting(request("America/New_York"), env)).status, 401, "next-meeting: a client login with no client is 401");

  clearSessions();
  addSession("c-fl", "2026-11-01", "21:30", "22:30", { loc: "Office" });
  addSession("c-fl", "2026-11-02", "01:00", null);
  addSession("c-other", "2026-11-01", "10:00", "11:00");
  addSession("c-fl", "2026-11-01", "08:00", "09:00", { status: "cancelled" });
  addSession("c-fl", "2026-11-01", "08:30", "09:00", { status: "discarded" });
  addSession("c-fl", "2026-11-05", "10:00", "11:00");
  F = make(NOW, client("c-fl"));
  const pac = await F.handleGetPortalNextMeeting(request("America/Los_Angeles"), env);
  eq(pac.status, 200, "next-meeting: Pacific viewer gets 200");
  eq(pac.data.meetings.map((m) => m.date + " " + m.time + "-" + m.end_time), ["2026-11-01 18:30-19:30", "2026-11-01 22:00-null"], "Pacific: 18:30 and 22:00 on 11-01, in order, own client only, no cancelled or discarded or far dates");
  eq(pac.data.meetings.map((m) => m.zone), ["America/Los_Angeles", "America/Los_Angeles"], "Pacific: every row carries the zone used");
  eq(pac.data.zone, "America/Los_Angeles", "Pacific: the answer carries the zone used");
  eq(pac.data.meeting.time, "18:30", "the meeting field is the first row");
  ok(pac.data.meetings[0].session_type === "online_meet" && pac.data.meetings[0].location === "Office" && "google_meet_link" in pac.data.meetings[0] && "html_link" in pac.data.meetings[0], "the other fields are still returned");
  // 11-02 01:00 EST is 23:00 on 11-01 in Pacific: Pacific today is 11-01, so both rows are today.
  const east = await F.handleGetPortalNextMeeting(request("America/New_York"), env);
  eq(east.data.meetings.map((m) => m.date + " " + m.time), ["2026-11-01 21:30", "2026-11-02 01:00"], "Eastern: 21:30 today and 01:00 tomorrow, stored values");
  const todayEast = "2026-11-01", todayPac = "2026-11-01";
  eq([east.data.meetings[1].date === todayEast, pac.data.meetings[1].date === todayPac], [false, true], "01:00 stored on 11-02 is Tomorrow for Eastern and Today for Pacific");

  // Sao Paulo (UTC-3 in November): 21:30 EST = 23:30; 01:00 EST on 11-02 = 03:00 on 11-02
  const sp = await F.handleGetPortalNextMeeting(request("America/Sao_Paulo"), env);
  eq(sp.data.meetings.map((m) => m.date + " " + m.time), ["2026-11-01 23:30", "2026-11-02 03:00"], "Sao Paulo: 23:30 today and 03:00 tomorrow");

  // no header, a US-WA client with no saved zone: Pacific
  F = make(NOW, client("c-wa"));
  clearSessions();
  addSession("c-wa", "2026-11-01", "21:30", "22:30");
  const wa = await F.handleGetPortalNextMeeting(request(null), env);
  eq(wa.data.meetings.map((m) => m.time + " " + m.zone), ["18:30 America/Los_Angeles"], "a US-WA client with no header gets Pacific");
  const fl0 = await make(NOW, client("c-fl")).handleGetPortalNextMeeting(request(null), env);
  eq(fl0.data.zone, "America/New_York", "a Florida client with no header gets Eastern");

  // no time: date kept, no conversion
  clearSessions();
  addSession("c-fl", "2026-11-01", null, null);
  const nt = await make(NOW, client("c-fl")).handleGetPortalNextMeeting(request("America/Los_Angeles"), env);
  eq(nt.data.meetings.map((m) => m.date + "|" + m.time + "|" + m.end_time), ["2026-11-01|null|null"], "a row with no time keeps its date and has no conversion");

  // end_time as a full ISO value (Google synced row)
  clearSessions();
  addSession("c-fl", "2026-11-01", "21:30", "2026-11-01T22:30:00-05:00");
  const iso = await make(NOW, client("c-fl")).handleGetPortalNextMeeting(request("America/Los_Angeles"), env);
  eq(iso.data.meetings.map((m) => m.time + "-" + m.end_time), ["18:30-19:30"], "a Google synced row with a full ISO end_time is converted too");

  // the window really covers five Eastern dates: read the dates the SQL was given
  clearSessions();
  d.log.length = 0;
  await make("2026-11-02T04:30:00Z", client("c-fl")).handleGetPortalNextMeeting(request("America/New_York"), env);
  const sqlSeen = d.log.filter((s) => /FROM sessions/.test(s));
  ok(sqlSeen.length === 1 && (sqlSeen[0].match(/\?/g) || []).length === 6, "the session query has 1 client placeholder and 5 date placeholders");
  // run each of the five dates through the real route: a row on each Eastern date is found by a far east viewer window check
  const seenDates = [];
  const spy = { DB: { prepare: (sql) => ({ bind: (...a) => ({ all: async () => { seenDates.push(a); return { results: [] }; } }) }) } };
  await make("2026-11-02T04:30:00Z", client("c-fl")).handleGetPortalNextMeeting(request("America/New_York"), spy);
  eq(seenDates[0].slice(1), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"], "the window is the five Eastern dates two back to two ahead, even across the 11-01 clock change");
  eq(seenDates[0][0], "c-fl", "the client id bound is the verified one");

  // a client can never read another client by passing previewAs
  clearSessions();
  addSession("c-other", "2026-11-01", "10:00", "11:00");
  const sneak = await make(NOW, client("c-fl")).handleGetPortalNextMeeting(request("America/New_York", "https://x.test/api/portal/next-meeting?previewAs=c-other"), env);
  eq(sneak.data.meetings.length, 0, "a client login cannot read another client with previewAs");
  const prev = await make(NOW, { role: "alice" }).handleGetPortalNextMeeting(request("America/New_York", "https://x.test/api/portal/next-meeting?previewAs=c-other"), env);
  eq(prev.data.meetings.length, 1, "admin preview as a client still works");
}

// ---- the scheduling state route: the booked row ----
{
  const NOW = "2026-11-01T17:00:00Z";
  const url = "https://x.test/api/scheduling/client-state";
  d.raw.exec("CREATE TABLE IF NOT EXISTS scheduling_requests (id TEXT PRIMARY KEY, client_id TEXT, token TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now')))");
  clearSessions();
  addSession("c-fl", "2026-11-01", "21:30", "22:30");
  let F = make(NOW, null);
  eq((await F.handleGetSchedulingClientState(request("America/New_York", url), env)).status, 401, "client-state: not signed in is 401");
  F = make(NOW, client("c-fl"));
  addSession("c-other", "2026-11-01", "09:00", "10:00");
  const spoof = await F.handleGetSchedulingClientState(request("America/New_York", url + "?client_id=c-other"), env);
  eq([spoof.status, spoof.data.session.time], [200, "21:30"], "client-state: a client login ignores client_id and only ever sees its own session");
  const pac = await F.handleGetSchedulingClientState(request("America/Los_Angeles", url), env);
  eq([pac.data.session.date, pac.data.session.time, pac.data.session.end_time, pac.data.session.zone], ["2026-11-01", "18:30", "19:30", "America/Los_Angeles"], "client-state: the booked session is converted to Pacific, with the zone");
  eq(pac.data.in_join_window, true, "client-state: in_join_window follows the viewer's today and tomorrow");
  const east = await F.handleGetSchedulingClientState(request("America/New_York", url), env);
  eq([east.data.session.date, east.data.session.time, east.data.session.end_time], ["2026-11-01", "21:30", "22:30"], "client-state: Eastern gets the stored values");
  // the card matches next-meeting row to booked row by date and time: they must agree
  const nm = await F.handleGetPortalNextMeeting(request("America/Los_Angeles"), env);
  eq([nm.data.meetings[0].date, nm.data.meetings[0].time], [pac.data.session.date, pac.data.session.time], "next-meeting and client-state give the same date and time for the same meeting");
  clearSessions();
  const none = await F.handleGetSchedulingClientState(request("America/Los_Angeles", url), env);
  eq([none.data.scheduled, none.data.session], [false, null], "client-state: no session stays scheduled false and session null");
}

console.log("\n" + (fail ? fail + " failing" : "all passed"));
process.exit(fail ? 1 : 0);
