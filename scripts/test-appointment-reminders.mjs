// Appointment reminders: the REAL Worker functions on an in-memory SQLite.
// No network, no production database, no real push. pushToUsers is a recorder.
//
//   node scripts/test-appointment-reminders.mjs
import { makeDb, build, baseStubs, req } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = [
  "apptRemWall", "apptRemTime", "apptRemFmt12", "apptRemLead", "apptRemFindSessions",
  "apptRemFindClientEvents", "apptRemRoleEmails", "apptRemSend", "runAppointmentReminders",
  "handleGetApptReminderDryRun"
];
const VARS = ["APEX_TIMEZONE", "APPT_REMINDER_LEADS_MIN", "APPT_REMINDER_WINDOW_MIN", "APPT_REMINDER_OWNER_ROLE"];

function world(stubOverrides) {
  const d = makeDb([]);
  d.raw.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, client_name TEXT NOT NULL, client_id TEXT, date TEXT NOT NULL, time TEXT,
      session_type TEXT, status TEXT NOT NULL DEFAULT 'pending', location TEXT, created_by TEXT);
    CREATE TABLE IF NOT EXISTS gm_events (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, event_type TEXT, title TEXT NOT NULL,
      event_date TEXT NOT NULL, start_time TEXT, end_time TEXT, all_day INTEGER NOT NULL DEFAULT 0, location TEXT);
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT, role TEXT);
    CREATE TABLE IF NOT EXISTS push_sent_log (dedupe_key TEXT PRIMARY KEY, sent_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO users (email, role) VALUES ('rafa@test.com', 'rafa'), ('alice1@test.com', 'alice'), ('alice2@test.com', 'alice'), ('dev@test.com', 'developer');
  `);
  const calls = [];
  const state = { result: { sent: 1, failed: 0, total: 1 } };
  const stubs = Object.assign({}, baseStubs, {
    pushToUsers: async function (env, emails, payload) { calls.push({ emails: emails, payload: payload }); return state.result; },
    gmClientPushTargets: async function (env, clientId) { return clientId === "c-none" ? [] : ["login:" + clientId]; }
  }, stubOverrides || {});
  const F = build(FNS, VARS, stubs);
  return { d, env: { DB: d.DB }, F, calls, state };
}

// 2026-10-15 2:00 PM EDT = 18:00Z. Window for the 60-minute lead: (2:50 PM, 3:00 PM].
const NOW = Date.UTC(2026, 9, 15, 18, 0, 0);
function addSession(w, id, time, extra) {
  const e = Object.assign({ name: "Client " + id, status: "pending", by: "Rafa", type: "online_meet", loc: null, date: "2026-10-15" }, extra || {});
  w.d.raw.prepare("INSERT INTO sessions (id, client_name, date, time, session_type, status, location, created_by) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, e.name, e.date, time, e.type, e.status, e.loc, e.by);
}
function addClient(w, id, extra) {
  const e = Object.assign({ status: "active", lang: "pt", tz: null, archived: 0 }, extra || {});
  w.d.raw.prepare("INSERT INTO clients (id, name, status, language, timezone, archived) VALUES (?,?,?,?,?,?)").run(id, "Name " + id, e.status, e.lang, e.tz, e.archived);
}
function addEvent(w, id, clientId, time, extra) {
  const e = Object.assign({ title: "Visit " + id, date: "2026-10-15", allDay: 0, loc: null }, extra || {});
  w.d.raw.prepare("INSERT INTO gm_events (id, client_id, event_type, title, event_date, start_time, all_day, location) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, clientId, "visit", e.title, e.date, time, e.allDay, e.loc);
}

// ── wall clock and helpers ────────────────────────────────────────────
{
  const w = world();
  ok(w.F.apptRemWall(NOW) === "2026-10-15 14:00", "wall clock: 18:00Z in October is 2:00 PM Eastern (EDT)");
  ok(w.F.apptRemWall(Date.UTC(2026, 10, 1, 7, 30)) === "2026-11-01 02:30", "wall clock after fall-back: 07:30Z on 11/01 is 2:30 AM EST");
  ok(w.F.apptRemWall(Date.UTC(2026, 2, 8, 7, 0)) === "2026-03-08 03:00", "wall clock after spring-forward: 07:00Z on 03/08 is 3:00 AM EDT");
  ok(w.F.apptRemWall(NOW, "America/Chicago") === "2026-10-15 13:00", "a client zone is honoured (Chicago is 1:00 PM)");
  ok(w.F.apptRemWall(NOW, "Not/AZone") === "2026-10-15 14:00", "an unrecognised zone falls back to the business zone");
  ok(w.F.apptRemTime("9:30") === "09:30" && w.F.apptRemTime("09:30:00") === "09:30", "times normalise (9:30, 09:30:00)");
  ok(w.F.apptRemTime("") === null && w.F.apptRemTime("noon") === null && w.F.apptRemTime("25:00") === null, "bad times are rejected");
  ok(w.F.apptRemFmt12("15:00") === "3:00 PM" && w.F.apptRemFmt12("00:05") === "12:05 AM" && w.F.apptRemFmt12("12:30") === "12:30 PM", "12-hour formatting");
  ok(w.F.apptRemLead(60, true) === "1 hora" && w.F.apptRemLead(60, false) === "1 hour" && w.F.apptRemLead(15, false) === "15 minutes", "lead labels");
}

// ── window edges, owners, statuses ──────────────────────────────────
{
  const w = world();
  addSession(w, "edge-hi", "15:00");                 // exactly 60 minutes out: IN
  addSession(w, "edge-lo", "14:50");                 // exactly 50 minutes out: OUT (exclusive)
  addSession(w, "in-mid", "14:55");                  // IN
  addSession(w, "too-far", "15:05");                 // OUT
  addSession(w, "past", "13:00");                    // OUT
  addSession(w, "alice-one", "14:58", { by: "Alice" });
  addSession(w, "fire", "14:56", { by: "fireflies" });
  addSession(w, "who", "14:57", { by: "Somebody Else" });
  addSession(w, "cancelled", "14:58", { status: "cancelled" });
  addSession(w, "discarded", "14:58", { status: "discarded" });
  addSession(w, "archived", "14:58", { status: "archived" });
  addSession(w, "inbox", "14:58", { status: "inbox" });
  addSession(w, "notime", null);
  addSession(w, "emptytime", "");
  addSession(w, "badtime", "soon");
  addSession(w, "tomorrow", "15:00", { date: "2026-10-16" });
  const r = await w.F.runAppointmentReminders(w.env, { nowMs: NOW });
  const names = w.calls.map((c) => c.payload.tag).sort();
  ok(JSON.stringify(names) === JSON.stringify(["appt-s-alice-one", "appt-s-edge-hi", "appt-s-in-mid"]), "only items 50 to 60 minutes out are sent (60 in, 50 out, 65 out, past out): " + names.join(","));
  ok(r.sent === 3, "three sends reported");
  ok(r.skipped_no_owner === 2, "fireflies and an unknown label are skipped and counted, never guessed (" + r.skipped_no_owner + ")");
  ok(r.skipped_bad_time === 1, "an unparseable time is counted (" + r.skipped_bad_time + ")");
  addSession(w, "nic", "14:59", { by: "Nicole" });
  await w.F.runAppointmentReminders(w.env, { nowMs: NOW });
  const nicCall = w.calls.find((c) => c.payload.tag === "appt-s-nic");
  ok(nicCall && nicCall.emails.length === 1 && nicCall.emails[0] === "dev@test.com", "a meeting Nicole created goes to the developer login only");
  const aliceCall = w.calls.find((c) => c.payload.tag === "appt-s-alice-one");
  ok(aliceCall.emails.length === 2 && aliceCall.emails.indexOf("alice1@test.com") >= 0, "Alice's meeting goes to both of Alice's logins");
  const rafaCall = w.calls.find((c) => c.payload.tag === "appt-s-edge-hi");
  ok(rafaCall.emails.length === 1 && rafaCall.emails[0] === "rafa@test.com", "Rafa's meeting goes to Rafa only");
  ok(w.calls.every((c) => c.emails.length > 0), "pushToUsers is never called with an empty list (that would mean everyone)");
  const p = rafaCall.payload;
  ok(p.interruptionLevel === "time-sensitive", "the push is time-sensitive");
  ok(p.title === "Em 1 hora: Client edge-hi", "Portuguese title: " + p.title);
  ok(p.body === "3:00 PM · online", "12-hour time and place: " + p.body);
  ok(p.url === "/calendar.html", "staff tap opens the calendar");
}

// ── dedupe, failed send, no devices ────────────────────────────────
{
  const w = world();
  addSession(w, "s1", "14:55");
  await w.F.runAppointmentReminders(w.env, { nowMs: NOW });
  ok(w.calls.length === 1, "first run sends one");
  const r2 = await w.F.runAppointmentReminders(w.env, { nowMs: NOW });
  ok(w.calls.length === 1 && r2.already_sent === 1 && r2.sent === 0, "second run sends nothing (already sent)");
  const r3 = await w.F.runAppointmentReminders(w.env, { nowMs: NOW + 2 * 60000 });
  ok(w.calls.length === 1, "a later tick inside the window sends nothing either");
}
{
  const w = world();
  addSession(w, "s1", "14:55");
  w.state.result = { sent: 0, failed: 1, total: 1 };
  const r1 = await w.F.runAppointmentReminders(w.env, { nowMs: NOW });
  ok(r1.failed === 1 && r1.sent === 0, "a failed send is reported as failed");
  w.state.result = { sent: 1, failed: 0, total: 1 };
  const r2 = await w.F.runAppointmentReminders(w.env, { nowMs: NOW + 2 * 60000 });
  ok(r2.sent === 1, "a failed send is NOT marked as sent: the next tick retries and succeeds");
}
{
  const w = world();
  addSession(w, "s1", "14:55");
  w.state.result = { sent: 0, failed: 0, total: 0 };
  const r1 = await w.F.runAppointmentReminders(w.env, { nowMs: NOW });
  ok(r1.no_devices === 1, "nobody has a device: counted");
  w.state.result = { sent: 1, failed: 0, total: 1 };
  const r2 = await w.F.runAppointmentReminders(w.env, { nowMs: NOW + 2 * 60000 });
  ok(r2.sent === 0 && r2.already_sent === 1, "no-device is marked so it is not retried every tick");
}

// ── client calendar items ────────────────────────────────────────
{
  const w = world();
  addClient(w, "c1");
  addClient(w, "c-en", { lang: "en" });
  addClient(w, "c-closed", { status: "closed" });
  addClient(w, "c-arch", { archived: 1 });
  addClient(w, "c-none");
  addClient(w, "c-chi", { tz: "America/Chicago" });
  addEvent(w, "e1", "c1", "15:00", { loc: "Orlando" });
  addEvent(w, "e-en", "c-en", "14:55", { title: "Roof check" });
  addEvent(w, "e-closed", "c-closed", "15:00");
  addEvent(w, "e-arch", "c-arch", "15:00");
  addEvent(w, "e-allday", "c1", "15:00", { allDay: 1 });
  addEvent(w, "e-notime", "c1", null);
  addEvent(w, "e-far", "c1", "16:30");
  addEvent(w, "e-owner-less", "c-none", "15:00");
  addEvent(w, "e-chi-in", "c-chi", "14:00");     // Chicago wall: 13:00 now, window (13:50, 14:00] -> IN
  addEvent(w, "e-chi-out", "c-chi", "15:00");    // 1 hour later than the window -> OUT
  const r = await w.F.runAppointmentReminders(w.env, { nowMs: NOW });
  const tags = w.calls.map((c) => c.payload.tag).sort();
  ok(JSON.stringify(tags) === JSON.stringify(["appt-g-e-chi-in", "appt-g-e-en", "appt-g-e1"]), "client items: only active clients' timed items in the window (" + tags.join(",") + ")");
  const e1 = w.calls.find((c) => c.payload.tag === "appt-g-e1");
  ok(e1.emails.length === 1 && e1.emails[0] === "login:c1", "a client's item goes to that client's login only");
  ok(e1.payload.url === "/portal.html?tab=gmcalendar" && e1.payload.interruptionLevel === "time-sensitive", "client tap opens the portal calendar; time-sensitive");
  ok(e1.payload.title === "Em 1 hora: Visit e1" && e1.payload.body === "3:00 PM · Orlando", "client Portuguese push: " + e1.payload.title + " / " + e1.payload.body);
  const en = w.calls.find((c) => c.payload.tag === "appt-g-e-en");
  ok(en.payload.title === "In 1 hour: Roof check", "an English-language client gets English: " + en.payload.title);
  ok(r.skipped_no_owner === 1, "a client with nobody to push is counted, not guessed (" + r.skipped_no_owner + ")");
  ok(w.calls.every((c) => c.emails.indexOf("rafa@test.com") < 0), "client items never go to staff");
}

// ── dry run and the route ───────────────────────────────────────
{
  const w = world();
  addSession(w, "s1", "14:55");
  addSession(w, "s2", "20:00");
  addClient(w, "c1");
  addEvent(w, "e1", "c1", "23:00");
  const dry = await w.F.runAppointmentReminders(w.env, { nowMs: NOW, dry: true, horizonHours: 24 });
  ok(w.calls.length === 0, "dry run never sends");
  ok(w.d.raw.prepare("SELECT COUNT(*) AS n FROM push_sent_log").get().n === 0, "dry run never records");
  ok(dry.staff.length === 2 && dry.clients.length === 1, "dry run over 24 hours lists 2 staff and 1 client item");
  const res = await w.F.handleGetApptReminderDryRun(req({}, "https://x.test/api/appointment-reminders/dry-run?horizon_hours=24"), w.env);
  ok(res.status === 200 || res.data, "the route answers for a developer");
}
{
  const w = world({ authenticate: async () => ({ role: "alice" }) });
  const res = await w.F.handleGetApptReminderDryRun(req({}, "https://x.test/api/appointment-reminders/dry-run"), w.env);
  ok(res.status === 403, "the dry-run route refuses anyone but the developer");
}

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS");
process.exit(fail ? 1 : 0);
