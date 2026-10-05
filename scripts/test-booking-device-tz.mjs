// book.html shows times on the visitor's own clock. Runs the page's REAL inline
// script in a vm with a tiny fake page and a fake fetch. No network.
//
//   node scripts/test-booking-device-tz.mjs
import fs from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const html = fs.readFileSync(new URL("../book.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const code = scripts[scripts.length - 1];
ok(html.includes("DOC_PAGE_LINK"), "DOC_PAGE_LINK is still in the page");

function boot(deviceZone) {
  const els = {};
  const mk = (id) => els[id] || (els[id] = { id, innerHTML: "", textContent: "", value: "", classList: { toggle() {}, contains() { return false; } }, querySelectorAll() { return []; }, style: {} });
  const posted = [];
  const ctx = {
    console, Date, Intl, Math, JSON, String, Number, Object, Array, RegExp, encodeURIComponent, setTimeout,
    window: { location: { search: "", pathname: "/book.html" }, scrollTo() {}, confirm() { return true; }, sessionStorage: { getItem() { return null; }, setItem() {} } },
    document: { documentElement: { style: { setProperty() {} } }, getElementById: mk },
    history: { replaceState() {} },
    fetch: (url, opt) => { posted.push({ url, body: JSON.parse(opt.body) }); return Promise.resolve({ status: 200, json: () => Promise.resolve({ booked: true, booking: {} }) }); }
  };
  vm.createContext(ctx);
  vm.runInContext(code.replace(/window\.onload\s*=\s*function\(\)\s*\{[\s\S]*?\n    \};\s*$/, ""), ctx);
  ctx.deviceTz = () => deviceZone; // what the device reports
  return { ctx, els, posted, run: (s) => vm.runInContext(s, ctx) };
}

// Business in New York. The Worker offers: Wed 10/14/2026 09:00..17:00, Sun 11/01/2026 (after the clock change), and a late slot.
const slots = [
  { date: "2026-10-14", times: ["09:00", "14:00", "20:30"] },
  { date: "2026-11-02", times: ["09:00", "14:00"] }
];
function load(zone, lang) {
  const p = boot(zone);
  p.ctx.D = { active: true, tz: "America/New_York", tz_label: "EDT", slots: JSON.parse(JSON.stringify(slots)), business: { name: "B" } };
  p.run('lang = "' + (lang || "en") + '"');
  return p;
}
const flat = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// 1. same zone: identical to today
{
  const p = load("America/New_York");
  p.run("renderDays()");
  const days = flat(p.els.stepDays.innerHTML);
  ok(days.includes("Wednesday 10/14/2026") && days.includes("Monday 11/02/2026"), "same zone: days as today (" + days + ")");
  p.run('chosenDate = "2026-10-14"; renderTimes()');
  const t = flat(p.els.stepTimes.innerHTML);
  ok(t.includes("Times shown in EDT") && t.includes("9:00 AM") && t.includes("2:00 PM") && t.includes("8:30 PM"), "same zone: times and EDT label as today (" + t + ")");
  p.run('renderDone({ slot_date: "2026-10-14", slot_time: "14:00", start_utc: "20261014T180000Z", end_utc: "20261014T183000Z" })');
  ok(flat(p.els.stepDone.innerHTML).includes("2:00 PM EDT"), "same zone: summary shows 2:00 PM EDT");
}

// 2. one hour behind (Chicago): 2:00 PM Eastern is 1:00 PM CDT; posts the Eastern slot
{
  const p = load("America/Chicago");
  p.run('chosenDate = "2026-10-14"; renderTimes()');
  const t = flat(p.els.stepTimes.innerHTML);
  ok(t.includes("Times shown in CDT") && t.includes("1:00 PM") && !t.includes("2:00 PM") && !t.includes("EDT"), "Chicago: 1:00 PM CDT, label CDT (" + t + ")");
  p.run('chosenTime = "13:00"; submit()');
  const b = p.posted[0] && p.posted[0].body;
  ok(b && b.slot_date === "2026-10-14" && b.slot_time === "14:00", "Chicago picks 1:00 PM and the Worker gets the Eastern slot 2026-10-14 14:00: " + JSON.stringify(b && [b.slot_date, b.slot_time]));
  ok(p.posted[0].url.endsWith("/book") || p.posted[0].url.includes("/book"), "posted to the book path");
  p.run('renderDone({ slot_date: "2026-10-14", slot_time: "14:00", start_utc: "20261014T180000Z", end_utc: "20261014T183000Z" })');
  const d = flat(p.els.stepDone.innerHTML);
  ok(d.includes("10/14/2026") && d.includes("1:00 PM CDT"), "Chicago summary: 10/14/2026 1:00 PM CDT");
  ok(decodeURIComponent(p.els.stepDone.innerHTML.match(/href="data:text\/calendar;charset=utf-8,([^"]+)"/)[1]).includes("DTSTART:20261014T180000Z"), "calendar file uses UTC (Z) times: 18:00 UTC");
}

// 3. three hours behind (Los Angeles): late slot stays on the same day: 8:30 PM EDT = 5:30 PM PDT
{
  const p = load("America/Los_Angeles");
  p.run("renderDays()");
  const days = flat(p.els.stepDays.innerHTML);
  ok(days.includes("Wednesday 10/14/2026") && days.includes("Monday 11/02/2026"), "LA: days listed");
  p.run('chosenDate = "2026-10-14"; renderTimes()');
  const t = flat(p.els.stepTimes.innerHTML);
  ok(t.includes("6:00 AM") && t.includes("11:00 AM") && t.includes("5:30 PM") && t.includes("Times shown in PDT"), "LA: 6:00 AM, 11:00 AM, 5:30 PM PDT (" + t + ")");
  p.run('chosenTime = "17:30"; submit()');
  const b = p.posted[0].body;
  ok(b.slot_date === "2026-10-14" && b.slot_time === "20:30", "LA 5:30 PM posts Eastern 20:30");
}

// 4. far ahead (Sydney): the late slot moves to the next day
{
  const p = load("Australia/Sydney");
  p.run("renderDays()");
  const days = flat(p.els.stepDays.innerHTML);
  ok(days.includes("Thursday 10/15/2026") && !days.includes("10/14/2026") && days.includes("Tuesday 11/03/2026"), "Sydney: every slot is on the next day, 10/14 is not listed (" + days + ")");
  p.run('chosenDate = "2026-10-15"; renderTimes()');
  const t = flat(p.els.stepTimes.innerHTML);
  ok(t.includes("11:30 AM"), "Sydney: 8:30 PM EDT is 11:30 AM on 10/15 (" + t + ")");
  p.run('chosenTime = "11:30"; submit()');
  ok(p.posted[0].body.slot_date === "2026-10-14" && p.posted[0].body.slot_time === "20:30", "Sydney pick posts the Eastern 10/14 20:30 slot, not 10/15");
}

// 5. after the November clock change (11/01/2026): New York is EST, Chicago CST; 2:00 PM EST = 1:00 PM CST
{
  const p = load("America/Chicago");
  p.run('chosenDate = "2026-11-02"; renderTimes()');
  const t = flat(p.els.stepTimes.innerHTML);
  ok(t.includes("8:00 AM") && t.includes("1:00 PM") && t.includes("Times shown in CST"), "after the change: 8:00 AM, 1:00 PM CST (" + t + ")");
  // Berlin ends daylight time on 10/25, so 11/02 is CET (+6 from EST): 2:00 PM EST = 8:00 PM CET
  const q = load("Europe/Berlin");
  q.run('chosenDate = "2026-11-02"; renderTimes()');
  ok(flat(q.els.stepTimes.innerHTML).includes("8:00 PM"), "after the change: Berlin shows 8:00 PM for 2:00 PM EST");
  const r = load("Europe/Berlin");
  r.run('chosenDate = "2026-10-14"; renderTimes()');
  ok(flat(r.els.stepTimes.innerHTML).includes("8:00 PM"), "before the change: Berlin 8:00 PM for 2:00 PM EDT (+6)");
}

// 6. unreadable zone: business time and label as today
for (const bad of ["", undefined, "Not/AZone"]) {
  const p = load(bad);
  p.run('chosenDate = "2026-10-14"; renderTimes()');
  const t = flat(p.els.stepTimes.innerHTML);
  ok(t.includes("Times shown in EDT") && t.includes("2:00 PM"), "unreadable zone " + JSON.stringify(bad) + ": falls back to EDT");
}

// 7. Portuguese keeps US formats
{
  const p = load("America/Chicago", "pt");
  p.run('chosenDate = "2026-10-14"; renderTimes()');
  const t = flat(p.els.stepTimes.innerHTML);
  ok(t.includes("10/14/2026") && t.includes("1:00 PM") && t.includes("CDT"), "Portuguese: MM/DD/YYYY, 12-hour, CDT (" + t + ")");
}

process.exit(fail ? 1 : 0);
