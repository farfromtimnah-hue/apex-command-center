// The Ritmo tab's inline "next month has no goals" row must fire under the
// SAME conditions as decideBootView()'s soft gate, plus "the user is looking at
// the current month".
//
// The regression this guards: goalsMonth was seeded from
// `new Date().toISOString().slice(0, 7)` — UTC — while goal-state's
// current_month is derived from todayStr(), the LOCAL date the portal sends it.
// West of UTC those disagree for the last hours of every month: in Brazil
// (UTC-3), from 21:00 on the last day, goalsMonth was already next month and
// the row's `goalsMonth === goalState.current_month` guard silently suppressed
// it — at exactly the point in the month the row exists to fire. The boot
// prompt has no such guard, which is why it fired and the row did not.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../portal.html", import.meta.url), "utf8");
const slice = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error("slice not found: " + a);
  return src.slice(i, j);
};

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

// ---- 1. the source no longer seeds the tab's month from UTC ----
ok(/var goalsMonth = todayStr\(\)\.slice\(0, 7\);/.test(src),
   "goalsMonth is seeded from todayStr() (local), not toISOString() (UTC)");
ok(!/var goalsMonth = new Date\(\)\.toISOString\(\)/.test(src),
   "goalsMonth no longer uses toISOString()");

// ---- 2. run the real functions against a stubbed DOM + clock ----
const els = {};
const mkEl = (id) => ({ id, innerHTML: "", hidden: false, textContent: "", style: {} });
for (const id of ["nextMonthGoalRow"]) els[id] = mkEl(id);
globalThis.document = { getElementById: (id) => els[id] || null };
globalThis.escHtml = (s) => String(s);
globalThis.monthLabelText = (m) => m;
globalThis.isEn = () => false;

// Pull in todayStr(), daysLeftInMonth(), renderNextMonthGoalRow() and the
// goalsMonth seed exactly as they appear in portal.html.
eval(slice("    function todayStr() {", "    function weekdayName(ds)") +
  "\n; globalThis.todayStr = todayStr;");
eval(slice("    function daysLeftInMonth(ds) {", "    function loadGoalState()") +
  "\n; globalThis.daysLeftInMonth = daysLeftInMonth;");
eval(slice("    var goalsMonth = todayStr().slice(0, 7);", "    var goalsFormMonth") +
  "\n; globalThis.goalsMonth = goalsMonth;");
eval(slice("    function renderNextMonthGoalRow() {", "    function startGoalsForNextMonth()") +
  "\n; globalThis.renderNextMonthGoalRow = renderNextMonthGoalRow;");

// The soft gate's own condition, lifted from decideBootView(), so the two
// paths are compared rather than each asserted against a hand-copied rule.
const softGateFires = (gs) =>
  !!gs && daysLeftInMonth(gs.today) < 8 && !gs.next_month_has_goals;

const scenarios = [
  { name: "late in the month, next month ungoaled",
    gs: { today: "2026-07-31", current_month: "2026-07", next_month: "2026-08",
          next_month_has_goals: false } },
  { name: "late in the month but next month already has goals",
    gs: { today: "2026-07-31", current_month: "2026-07", next_month: "2026-08",
          next_month_has_goals: true } },
  { name: "mid-month (plenty of days left)",
    gs: { today: "2026-07-10", current_month: "2026-07", next_month: "2026-08",
          next_month_has_goals: false },
    viewing: "2026-07" },
  { name: "February's short month (21st is inside the window)",
    gs: { today: "2028-02-22", current_month: "2028-02", next_month: "2028-03",
          next_month_has_goals: false } },
];

for (const s of scenarios) {
  globalThis.goalState = s.gs;
  globalThis.goalsMonth = s.viewing || s.gs.current_month;
  renderNextMonthGoalRow();
  const shown = !els.nextMonthGoalRow.hidden;
  const expected = softGateFires(s.gs);
  ok(shown === expected,
     `${s.name}: row ${shown ? "shows" : "hidden"}, soft gate ${expected ? "fires" : "does not"} — they agree`);
}

// ---- 3. the specific regression: viewing the current month, late in it ----
// Reproduce the old UTC seed and assert it would NOT have matched, so this
// test fails if someone reintroduces it.
globalThis.goalState = { today: "2026-07-31", current_month: "2026-07",
                         next_month: "2026-08", next_month_has_goals: false };
globalThis.goalsMonth = new Date("2026-07-31T23:30:00-03:00").toISOString().slice(0, 7);
renderNextMonthGoalRow();
ok(els.nextMonthGoalRow.hidden,
   "sanity: the OLD UTC-derived month (2026-08) does suppress the row — this was the bug");
ok(globalThis.goalsMonth !== goalState.current_month,
   "sanity: UTC and local months genuinely diverge at 23:30 on the last day (UTC-3)");

// And with the fixed seed, at that same instant, it shows.
globalThis.goalsMonth = "2026-07";   // what todayStr().slice(0,7) yields locally
renderNextMonthGoalRow();
ok(!els.nextMonthGoalRow.hidden,
   "with the local-derived month the row SHOWS at 23:30 on the last day of the month");

// ---- 4. the row stays scoped to the current month ----
globalThis.goalsMonth = "2026-05";   // browsing history via the month picker
renderNextMonthGoalRow();
ok(els.nextMonthGoalRow.hidden,
   "the row stays hidden while browsing a PAST month in the picker");
globalThis.goalsMonth = "2026-08";
renderNextMonthGoalRow();
ok(els.nextMonthGoalRow.hidden,
   "the row stays hidden while browsing a FUTURE month in the picker");

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ NEXT-MONTH GOAL ROW CONSISTENT WITH THE SOFT GATE");
process.exit(fail ? 1 : 0);
