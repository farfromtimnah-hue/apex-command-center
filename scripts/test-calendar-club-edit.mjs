// Calendar edit screen, Apex Club block: the pure helpers cut out of calendar.html
// (root and iOS copy) and the Worker's by-session read. No network.
//
//   node scripts/test-calendar-club-edit.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, req } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

function cut(src, name) {
  const i = src.indexOf("\n    function " + name + "(");
  if (i < 0) { throw new Error("not found in calendar.html: " + name); }
  const j = src.indexOf("\n    }", i + 1);
  return src.slice(i + 1, j + 6);
}
const dt = readFileSync(new URL("datetime.js", root), "utf8");
const NAMES = ["clubMoneyToCents", "clubCentsToBoxText", "clubStartTimeText", "buildClubEventUpdateBody"];

for (const file of ["calendar.html", "ios/App/App/public/calendar.html"]) {
  const html = readFileSync(new URL(file, root), "utf8");
  const code = dt + "\n" + NAMES.map((n) => cut(html, n)).join("\n") + "\nreturn { " + NAMES.join(", ") + " };";
  const F = new Function(code)();
  const tag = "[" + file + "] ";

  ok(F.clubStartTimeText("07:00") === "7:00 AM", tag + "07:00 -> 7:00 AM");
  ok(F.clubStartTimeText("19:00") === "7:00 PM", tag + "19:00 -> 7:00 PM");
  ok(F.clubStartTimeText("12:00") === "12:00 PM", tag + "12:00 -> 12:00 PM");
  ok(F.clubStartTimeText("00:30") === "12:30 AM", tag + "00:30 -> 12:30 AM");
  ok(F.clubStartTimeText("") === null, tag + "no time -> null");

  ok(F.clubMoneyToCents("50.00") === 5000 && F.clubMoneyToCents("50,00") === 5000 && F.clubMoneyToCents("$50") === 5000, tag + "50.00, 50,00 and $50 all parse to 5000");
  ok(F.clubMoneyToCents("") === null && Number.isNaN(F.clubMoneyToCents("0")) && F.clubMoneyToCents("abc") === null, tag + "blank and letters-only -> null, zero -> NaN");
  ok(F.clubCentsToBoxText(5000) === "50.00" && F.clubCentsToBoxText(null) === "", tag + "5000 prints 50.00; null prints blank");

  const base = { eventName: "Apex Club Outubro", existingDate: "2026-10-20", windowStart: "2026-10-06", windowEnd: "2026-10-27",
    date: "2026-10-20", time: "19:00", location: "  123 Main St, Tampa  ", speakers: " Ana ", notes: "",
    priceSingle: "50,00", priceCouple: "", cardOn: false, cardSingle: "52.00", cardCouple: "78.00" };
  let r = F.buildClubEventUpdateBody(base);
  const b = r.body;
  ok(b && b.name === "Apex Club Outubro", tag + "name stays the event's own");
  ok(b.event_date === "2026-10-20" && b.start_time === "7:00 PM" && b.venue === "123 Main St, Tampa", tag + "date, time and venue come from the session fields");
  ok(b.price_single_cents === 5000 && b.price_couple_cents === null, tag + "prices parsed; empty couple -> null");
  ok(b.price_card_single_cents === null && b.price_card_couple_cents === null, tag + "card prices null when unticked");
  ok(b.speakers === "Ana" && b.notes === null, tag + "speakers trimmed; blank notes -> null");
  ok(b.window_start === "2026-10-06" && b.window_end === "2026-10-27", tag + "window kept when date unchanged");

  r = F.buildClubEventUpdateBody(Object.assign({}, base, { date: "2026-10-22", cardOn: true, priceCouple: "75.00" }));
  ok(r.body.price_card_single_cents === 5200 && r.body.price_card_couple_cents === 7800 && r.body.price_couple_cents === 7500, tag + "card ticked -> card prices parsed");
  ok(r.body.window_start === undefined && r.body.window_end === undefined && r.body.event_date === "2026-10-22", tag + "window left to the server when the date moved");
  ok(F.buildClubEventUpdateBody(Object.assign({}, base, { priceSingle: "" })).error === "single", tag + "blank price per person refused");
  ok(F.buildClubEventUpdateBody(Object.assign({}, base, { priceSingle: "0" })).error === "single", tag + "zero price per person refused");
  ok(F.buildClubEventUpdateBody(Object.assign({}, base, { priceCouple: "0" })).error === "couple", tag + "zero couple price refused");
  ok(F.buildClubEventUpdateBody(Object.assign({}, base, { cardOn: true, cardSingle: "" })).error === "cardSingle", tag + "ticked card with blank card price refused");
}

// Worker: GET /api/finance-new/club/events/by-session/:sessionId
{
  const d = makeDb(["migrations/apex_club_company.sql", "migrations/apex_invoice_public.sql", "migrations/apex_club_pay.sql"]); const env = { DB: d.DB };
  d.raw.prepare("INSERT INTO apex_club_events (id, name, event_date, window_start, window_end, price_single_cents, price_couple_cents, session_id) VALUES ('ev9','Club','2026-10-20','2026-10-06','2026-10-27',5000,7500,'sess9')").run();
  const run = async (role, sid) => {
    const F = build(["handleGetClubEventBySession"], [], Object.assign({}, baseStubs, { authenticate: async () => (role ? { role: role } : null) }));
    return F.handleGetClubEventBySession(sid, req({}), env);
  };
  let r = await run("alice", "sess9");
  ok(r.status === 200 && r.data.event.id === "ev9" && r.data.event.price_single_cents === 5000 && r.data.event.price_couple_cents === 7500, "staff gets the full event row with prices");
  ok((await run("developer", "sess9")).status === 200 && (await run("rafa", "sess9")).status === 200, "developer and rafa allowed");
  ok((await run("client", "sess9")).status === 403, "client session refused (403)");
  ok((await run("seller", "sess9")).status === 403, "seller session refused (403)");
  ok((await run(null, "sess9")).status === 401, "no session -> 401");
  r = await run("alice", "nope");
  ok(r.status === 404, "unknown session -> plain 404");
}
console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
