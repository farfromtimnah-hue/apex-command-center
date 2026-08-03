// Behavioral check for the FULL-PARITY session edit route (PATCH
// /api/sessions/:id) and the shared series-scope resolver.
//
//   node scripts/test-session-edit.mjs
//
// The load-bearing rules, and why each is easy to regress:
//
//   1. GOOGLE IS AUTHORITATIVE. When the Google call fails with anything
//      other than 404/410, D1 must not be touched AT ALL. This is the rule
//      the 2026-07-26 incident was about: Apex committed while the events
//      stayed live on the client's calendar. A regression here is invisible
//      by inspection and catastrophic in production, so it is asserted by
//      counting real UPDATE statements, not by reading the code.
//   2. 404/410 means the event is already gone -- the desired end state --
//      so it downgrades to a warning and the D1 write DOES proceed.
//   3. resolveScope() must never silently downgrade 'all'/'following' to
//      'single'. Alice answering "all meetings" and getting one changed is
//      the bug that made the scope dialog look broken for a month.
//   4. In-person sessions carry no google_event_id, so editing one makes
//      ZERO Google calls. This is what makes in-person the safe test bed.
//   5. Switching online_meet -> in_person KEEPS the event but drops the Meet
//      link (conferenceData:null + google_meet_link=NULL), so the client
//      keeps a calendar entry and loses a dead conference room.
//   6. Every write stamps updated_at/updated_by and NEVER re-stamps
//      created_by -- they answer different questions.
//   7. Every Google payload sends timeZone APEX_TIMEZONE. A missing zone is
//      what put a series 3 hours off once.
//
// Evals the real handler out of worker/index.js against a fake D1 and a fake
// Google, so the assertions exercise shipped code rather than a restatement
// of it. Follows scripts/test-lead-actor-attribution.mjs.
import { readFileSync } from "fs";

const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const html   = readFileSync(new URL("../calendar.html", import.meta.url), "utf8");

function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + a); }
  return src.slice(i, j);
}

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

// ── Harness ────────────────────────────────────────────────────────────────
// Pull the real route + its helpers out of the worker source and eval them
// with stubbed dependencies.

const src = [
  slice(worker, "var APEX_TIMEZONE", "// Minimal Google Calendar API call"),
  slice(worker, "function googleApiErrMessage", "// Resolves the concrete instance id"),
  slice(worker, "async function loadSeriesContext", "// Maps the app's frequency options"),
  slice(worker, "function resolveScope", "// ---------------------------------------------------------------------------\n// Route: POST /api/sessions/:id/cancel"),
  slice(worker, "function plusOneHourHHMM", "// The client's email as a Google Calendar attendee"),
  slice(worker, "async function handlePatchSessionDetails", "\n// ---------------------------------------------------------------------------\n// Route: GET /api/google/oauth/start"),
].join("\n");

// Mutable stubs the harness swaps per scenario.
let CALLS, DB_WRITES, GOOGLE_PLAN, TOKEN_THROWS, INSTANCE_PLAN, ROW, SERIES_ROWS;

function makeEnv() {
  return {
    DB: {
      prepare(sql) {
        const st = {
          _sql: sql, _binds: [],
          bind(...b) { st._binds = b; return st; },
          async first() {
            if (/FROM sessions WHERE id = \?/.test(sql)) { return ROW; }
            if (/FROM clients WHERE id = \?/.test(sql)) {
              return st._binds[0] === "missing" ? null : { id: st._binds[0], name: "NEW CLIENT NAME" };
            }
            if (/COUNT\(\*\) AS n FROM sessions WHERE google_event_id/.test(sql)) {
              return { n: SERIES_ROWS.length > 1 ? SERIES_ROWS.length - 1 : 0 };
            }
            return null;
          },
          async all() { return { results: SERIES_ROWS }; },
          async run() {
            if (/^UPDATE sessions SET/.test(sql)) { DB_WRITES.push({ sql, binds: st._binds }); }
            return { success: true };
          },
        };
        return st;
      },
    },
  };
}

const scope = {
  crypto: { randomUUID: () => "uuid-fixed" },
  async authenticate() { return { role: "alice", display_name: "Alice" }; },
  actorName(u) { return u ? (u.display_name || u.role || null) : null; },
  jsonErr(msg, status) { return { __err: true, status, error: msg }; },
  jsonOk(obj) { return { __err: false, status: 200, ...obj }; },
  endTimeHHMMFromRow(v) { if (!v) return null; return v.indexOf("T") !== -1 ? v.slice(11, 16) : v.slice(0, 5); },
  async getGoogleAccessToken() {
    if (TOKEN_THROWS) { throw new Error(TOKEN_THROWS); }
    return "fake-token";
  },
  async googleCalendarApiCall(token, method, path, body) {
    CALLS.push({ method, path, body });
    const plan = GOOGLE_PLAN.shift() || { ok: true, status: 200, data: {} };
    if (plan.throws) { throw new Error(plan.throws); }
    return plan;
  },
  async findGoogleInstanceId() { return INSTANCE_PLAN; },
};

const factory = new Function(...Object.keys(scope), src + "\n;return { handlePatchSessionDetails, resolveScope };");
const { handlePatchSessionDetails, resolveScope } = factory(...Object.values(scope));

const APEX_IN_PERSON = {
  id: "s1", client_id: "c1", client_name: "TEST CLIENT", date: "2026-09-07", time: "14:00",
  end_time: "15:00", location: "100 Test St", session_type: "in_person", meeting_category: "client",
  google_event_id: null, google_meet_link: null, calendar_provider: "apex", series_id: null, status: "scheduled",
};
const APEX_ONLINE = { ...APEX_IN_PERSON, session_type: "online_meet", location: null,
  google_event_id: "gev123", google_meet_link: "https://meet.google.com/abc-defg-hij" };

function reset(row, opts = {}) {
  CALLS = []; DB_WRITES = []; TOKEN_THROWS = null;
  GOOGLE_PLAN = opts.google || [];
  INSTANCE_PLAN = opts.instance || { ok: true, instanceId: "inst_1", error: null };
  ROW = { ...row }; SERIES_ROWS = opts.seriesRows || [];
}
const call = (body) => handlePatchSessionDetails("s1", { json: async () => body }, makeEnv());
const setsOf = (w) => w.sql.replace(/^UPDATE sessions SET /, "").replace(/ WHERE id = \?$/, "").split(", ").map(s => s.split(" =")[0]);

console.log("\n── 1. In-person edits make ZERO Google calls (the safe test bed) ──");
{
  reset(APEX_IN_PERSON);
  const r = await call({ location: "200 New Address", notes: "updated notes" });
  t("in-person edit succeeds", r.ok, true);
  t("  → zero Google API calls", CALLS.length, 0);
  t("  → exactly one D1 UPDATE", DB_WRITES.length, 1);
  t("  → location written", DB_WRITES[0].binds[0], "200 New Address");
}

console.log("\n── 2. GOOGLE IS AUTHORITATIVE: a failed patch must not touch D1 ──");
{
  reset(APEX_ONLINE, { google: [{ ok: false, status: 500, data: { error: { message: "Backend Error" } } }] });
  const r = await call({ location: "x", end_time: "16:00" });
  t("500 from Google → route errors", r.__err, true);
  t("  → HTTP 502", r.status, 502);
  t("  → Google error surfaced", /Backend Error/.test(r.error), true);
  t("  → D1 NOT written (the July incident)", DB_WRITES.length, 0);
}
{
  reset(APEX_ONLINE, { google: [{ throws: "network timeout" }] });
  const r = await call({ end_time: "16:30" });
  t("network throw → route errors", r.__err, true);
  t("  → D1 NOT written", DB_WRITES.length, 0);
}
{
  reset(APEX_ONLINE);
  TOKEN_THROWS = "Google Calendar is not connected";
  const r = await call({ end_time: "16:30" });
  t("expired token → route errors", r.__err, true);
  t("  → message matches isGcalNotConnectedError()", /not connected/.test(r.error), true);
  t("  → D1 NOT written", DB_WRITES.length, 0);
}

console.log("\n── 3. 404/410 = already gone = success, D1 proceeds ──");
for (const status of [404, 410]) {
  reset(APEX_ONLINE, { google: [{ ok: false, status, data: null }] });
  const r = await call({ end_time: "16:00" });
  t(`${status} → ok`, r.ok, true);
  t("  → warning set", /no longer exists/.test(r.google_warning || ""), true);
  t("  → D1 WAS written", DB_WRITES.length, 1);
}

console.log("\n── 4. Timezone on every Google write (never toLocale*) ──");
{
  reset(APEX_ONLINE, { google: [{ ok: true, status: 200, data: {} }] });
  await call({ date: "2026-09-10", time: "09:00", end_time: "10:00" });
  const b = CALLS[0].body;
  t("start carries APEX_TIMEZONE", b.start.timeZone, "America/New_York");
  t("end carries APEX_TIMEZONE", b.end.timeZone, "America/New_York");
  t("start is naive local wall-clock", b.start.dateTime, "2026-09-10T09:00:00");
  t("uses PATCH, not delete+recreate", CALLS[0].method, "PATCH");
}

console.log("\n── 5. online_meet → in_person keeps event, drops Meet link ──");
{
  reset(APEX_ONLINE, { google: [{ ok: true, status: 200, data: {} }] });
  const r = await call({ session_type: "in_person", location: "300 Office Park" });
  t("no DELETE call is ever made", CALLS.filter(c => c.method === "DELETE").length, 0);
  t("conferenceData explicitly nulled", CALLS[0].body.conferenceData, null);
  t("conferenceDataVersion=1 on the patch", /conferenceDataVersion=1/.test(CALLS[0].path), true);
  t("location pushed to Google", CALLS[0].body.location, "300 Office Park");
  t("meet_link_removed reported", r.meet_link_removed, true);
  t("google_meet_link cleared in D1", setsOf(DB_WRITES[0]).includes("google_meet_link"), true);
}

console.log("\n── 6. Attribution: updated_* stamped, created_by untouched ──");
{
  reset(APEX_IN_PERSON);
  await call({ location: "abc" });
  const sets = setsOf(DB_WRITES[0]);
  t("updated_at stamped", sets.includes("updated_at"), true);
  t("updated_by stamped", sets.includes("updated_by"), true);
  t("updated_by = the real actor", DB_WRITES[0].binds[sets.indexOf("updated_by")], "Alice");
  t("created_by NOT re-stamped", sets.includes("created_by"), false);
}

console.log("\n── 7. resolveScope never silently downgrades ──");
{
  const rows = [{ id: "a", date: "2026-09-07" }, { id: "b", date: "2026-09-14" }];
  const ses = { id: "b", series_id: "ser1" };
  t("'all' keeps all rows", resolveScope("all", ses, { rows, thisIdx: 1 }).rows.length, 2);
  t("'following' slices from this one", resolveScope("following", ses, { rows, thisIdx: 1 }).rows.length, 1);
  t("'following' at index 0 becomes 'all'", resolveScope("following", { id: "a", series_id: "ser1" }, { rows, thisIdx: 0 }).scope, "all");
  t("non-series → single", resolveScope("all", { id: "x", series_id: null }, null).scope, "single");
  // The regression that made the dialog look broken:
  const orphan = resolveScope("all", ses, { rows, thisIdx: -1 });
  t("row missing from series + 'all' → ERROR, not silent single", orphan.ok, false);
  t("  → 'single' on an orphan still works", resolveScope("single", ses, { rows, thisIdx: -1 }).ok, true);
}

console.log("\n── 8. Series scope applies to the right rows ──");
{
  const seriesRows = [{ id: "s1", date: "2026-09-07" }, { id: "s2", date: "2026-09-14" }, { id: "s3", date: "2026-09-21" }];
  reset({ ...APEX_IN_PERSON, series_id: "ser1" }, { seriesRows });
  const r = await call({ location: "Series-wide address", scope: "all" });
  t("scope 'all' reported", r.scope, "all");
  t("  → all 3 rows updated", DB_WRITES.length, 3);
  t("  → still zero Google calls (in-person)", CALLS.length, 0);

  reset({ ...APEX_IN_PERSON, series_id: "ser1" }, { seriesRows });
  const r2 = await call({ location: "Only later ones", scope: "following" });
  t("scope 'following' from index 0 → all", r2.scope, "all");

  reset({ ...APEX_IN_PERSON, id: "s2", series_id: "ser1" }, { seriesRows });
  ROW.id = "s2";
  const r3 = await handlePatchSessionDetails("s2", { json: async () => ({ location: "L", scope: "following" }) }, makeEnv());
  t("scope 'following' from middle → 2 rows", r3.updated, 2);
}
{
  // Per-occurrence fields must not bleed across a series.
  const seriesRows = [{ id: "s1", date: "2026-09-07" }, { id: "s2", date: "2026-09-14" }];
  reset({ ...APEX_IN_PERSON, series_id: "ser1" }, { seriesRows });
  await call({ notes: "only mine", location: "shared", scope: "all" });
  const target = DB_WRITES.find(w => w.binds[w.binds.length - 1] === "s1");
  const other  = DB_WRITES.find(w => w.binds[w.binds.length - 1] === "s2");
  t("notes only on the opened occurrence", setsOf(target).includes("raw_transcript"), true);
  t("  → not on its siblings", setsOf(other).includes("raw_transcript"), false);
  t("location applies series-wide", setsOf(other).includes("location"), true);
}

console.log("\n── 9. Series date/time moves are refused, not half-done ──");
{
  const seriesRows = [{ id: "s1", date: "2026-09-07" }, { id: "s2", date: "2026-09-14" }];
  reset({ ...APEX_IN_PERSON, series_id: "ser1" }, { seriesRows });
  const r = await call({ date: "2026-10-01", scope: "all" });
  t("series-wide date move refused", r.__err, true);
  t("  → nothing written", DB_WRITES.length, 0);
}

console.log("\n── 10. Provider gating (legacy + external stay read-only) ──");
for (const [prov, label] of [["google_external", "external"], ["google", "legacy google"], ["manual", "legacy manual"]]) {
  reset({ ...APEX_IN_PERSON, calendar_provider: prov });
  const r = await call({ location: "nope" });
  t(`${label} refused`, r.__err, true);
  t("  → nothing written", DB_WRITES.length, 0);
}

console.log("\n── 11. Field validation matches the create path ──");
{
  reset(APEX_IN_PERSON);
  t("end before start refused", (await call({ end_time: "13:00" })).__err, true);
  reset(APEX_IN_PERSON);
  t("bad date format refused", (await call({ date: "09/07/2026" })).__err, true);
  reset(APEX_IN_PERSON);
  t("bad category refused", (await call({ meeting_category: "nonsense" })).__err, true);
  reset(APEX_IN_PERSON);
  t("unknown client refused", (await call({ client_id: "missing" })).__err, true);
  reset(APEX_IN_PERSON);
  t("empty body refused", (await call({})).__err, true);
  // An event REQUIRES an end time. Start from a row that has none, so the
  // check exercises the rule rather than passing on an inherited value.
  reset({ ...APEX_IN_PERSON, end_time: null });
  t("event with no end_time refused", (await call({ meeting_category: "event", event_name: "Apex Club" })).__err, true);
  reset(APEX_IN_PERSON);
  const ev = await call({ meeting_category: "event", event_name: "Apex Club", end_time: "16:00" });
  t("event edit clears client_id", ev.ok, true);
  t("  → client_id set NULL", DB_WRITES[0].binds[setsOf(DB_WRITES[0]).indexOf("client_id")], null);
}
{
  // sessions.time must stay nullable -- Fireflies ingestion depends on it.
  reset({ ...APEX_IN_PERSON, time: null, end_time: null });
  const r = await call({ location: "no start time set" });
  t("row with NULL time still editable", r.ok, true);
}

console.log("\n── 12. Title convention pushed to Google matches create ──");
{
  reset(APEX_ONLINE, { google: [{ ok: true, status: 200, data: {} }] });
  await call({ client_id: "c2" });
  t("real client gets '- RDE' suffix", CALLS[0].body.summary, "NEW CLIENT NAME - RDE");
  reset(APEX_ONLINE, { google: [{ ok: true, status: 200, data: {} }] });
  await call({ client_id: "c2", meeting_category: "prospective" });
  t("prospective gets NO suffix", CALLS[0].body.summary, "NEW CLIENT NAME");
}

console.log("\n── 13. Frontend contract (calendar.html) ──");
{
  t("edit modal has client field", /id="edClient"/.test(html), true);
  t("edit modal has event name", /id="edEventName"/.test(html), true);
  t("edit modal has category toggle", /id="edCategoryVal"/.test(html), true);
  t("edit modal has date", /id="edDate"/.test(html), true);
  t("edit modal has start time", /id="edTime"/.test(html), true);
  t("edit modal has type toggle", /id="edTypeVal"/.test(html), true);
  t("edit wires the series scope dialog", /openSeriesScope\(function\(scope\)\s*\{[\s\S]{0,200}submitEdit/.test(html), true);
  // Strip HTML comments, CSS/JS block comments and // line comments before
  // the style checks -- prose legitimately contains backticks and arrows.
  const code = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  t("no arrow functions in calendar.html", /=>/.test(code), false);
  t("no template literals", /`/.test(code), false);
  t("no toLocale* date formatting", /toLocale(Date|Time)String/.test(html), false);
  const ed = slice(html, 'id="modalEdit"', "<!-- ═══════════════ FIREBASE");
  const ptCount = (ed.match(/show-pt/g) || []).length;
  const enCount = (ed.match(/show-en/g) || []).length;
  t("edit modal PT/EN labels are balanced", ptCount === enCount && ptCount > 8, true);
}

console.log(fails === 0 ? "\nAll checks passed.\n" : `\n${fails} FAILED\n`);
process.exit(fails === 0 ? 0 : 1);
