// The Ritmo tab's "next month has no goals" prompt.
//
// Contract (deliberately NOT the soft gate's): the prompt is visible on ANY day
// of the month while the client is looking at the current month. Gating it on
// "fewer than 8 days left" — the soft gate's rule — made the boot reminder the
// only way in, so for three weeks of every month there was no path to next
// month's numbers at all. The 8-day rule now controls URGENCY (wording +
// .urgent styling), never visibility.
//
// It is also rendered ABOVE the indicator table. Below it, the prompt sat a
// dozen-plus rows down the card and clients never scrolled to it.
//
// The other regression guarded here: goalsMonth was seeded from
// `new Date().toISOString().slice(0, 7)` — UTC — while goal-state's
// current_month is derived from todayStr(), the LOCAL date the portal sends it.
// West of UTC those disagree for the last hours of every month: in Brazil
// (UTC-3), from 21:00 on the last day, goalsMonth was already next month and
// the prompt's `goalsMonth === goalState.current_month` guard silently
// suppressed it — at exactly the point in the month it exists to fire.
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

// ---- 2. the prompt renders above the indicator table ----
ok(src.indexOf('id="nextMonthGoalRow"') < src.indexOf('id="goalsTabBody"'),
   "the prompt is placed ABOVE the indicator table, not below it");
ok(src.indexOf('id="nextMonthGoalRow"') < src.indexOf('id="btnEditGoalsMonth"'),
   "the prompt is placed above the gold button too");

// ---- 3. run the real functions against a stubbed DOM + clock ----
const els = {};
const mkEl = (id) => ({ id, innerHTML: "", hidden: false, textContent: "", style: {} });
for (const id of ["nextMonthGoalRow", "btnEditGoalsMonthLabel"]) els[id] = mkEl(id);
globalThis.document = { getElementById: (id) => els[id] || null };
globalThis.escHtml = (s) => String(s);
globalThis.monthLabelText = (m) => m;
globalThis.isEn = () => false;

// Pull in todayStr(), daysLeftInMonth(), renderNextMonthGoalRow(),
// renderGoalsMonthButtonLabel() and the goalsMonth seed exactly as they appear
// in portal.html.
eval(slice("    function todayStr() {", "    function weekdayName(ds)") +
  "\n; globalThis.todayStr = todayStr;");
eval(slice("    function daysLeftInMonth(ds) {", "    function loadGoalState()") +
  "\n; globalThis.daysLeftInMonth = daysLeftInMonth;");
eval(slice("    var goalsMonth = todayStr().slice(0, 7);", "    var goalsFormMonth") +
  "\n; globalThis.goalsMonth = goalsMonth;");
eval(slice("    function renderNextMonthGoalRow() {", "    // Pages the navigator") +
  "\n; globalThis.renderNextMonthGoalRow = renderNextMonthGoalRow;");
eval(slice("    function renderGoalsMonthButtonLabel(hasGoals) {", "    function loadGoalsTab()") +
  "\n; globalThis.renderGoalsMonthButtonLabel = renderGoalsMonthButtonLabel;");

const render = (gs, viewing) => {
  globalThis.goalState = gs;
  globalThis.goalsMonth = viewing || gs.current_month;
  renderNextMonthGoalRow();
  return { shown: !els.nextMonthGoalRow.hidden, html: els.nextMonthGoalRow.innerHTML };
};

// ---- 4. visibility: any day of the month, while viewing the current month ----
const ungoaled = (today) => ({ today, current_month: today.slice(0, 7),
  next_month: today.slice(0, 7) === "2026-07" ? "2026-08" : "2028-03",
  next_month_has_goals: false });

const days = ["2026-07-01", "2026-07-10", "2026-07-20", "2026-07-25", "2026-07-31"];
for (const d of days) {
  const r = render(ungoaled(d));
  ok(r.shown, `${d}: prompt is visible (${daysLeftInMonth(d)} days left) — no 8-day visibility gate`);
}

// ---- 5. urgency: the 8-day rule styles the prompt, it does not hide it ----
const early = render(ungoaled("2026-07-10"));
ok(!/goal-next-note urgent/.test(early.html),
   "mid-month: prompt renders calm (no .urgent)");
ok(/ainda n/.test(early.html) && !/Faltam/.test(early.html),
   "mid-month: wording is the calm one, not the countdown");

const late = render(ungoaled("2026-07-31"));
ok(/goal-next-note urgent/.test(late.html),
   "last day: prompt renders .urgent");
// "Faltam 0 dia(s)" reads as a bug on the one day the message matters most.
ok(/ltimo dia do m/.test(late.html) && !/Faltam 0/.test(late.html),
   "last day: says 'último dia do mês', never 'Faltam 0 dia(s)'");

const oneLeft = render(ungoaled("2026-07-30"));
ok(/Faltam 1 dia /.test(oneLeft.html) && !/1 dias/.test(oneLeft.html),
   "one day left: singular 'dia', not 'dia(s)'");
const someLeft = render(ungoaled("2026-07-28"));
ok(/Faltam 3 dias/.test(someLeft.html),
   "several days left: plural 'dias', not 'dia(s)'");

const feb = render(ungoaled("2028-02-22"));
ok(/goal-next-note urgent/.test(feb.html),
   "February's short month: the 22nd is inside the urgency window (real month length)");

// ---- 6. already-set next month: still shown, worded as review ----
const done = render({ today: "2026-07-31", current_month: "2026-07",
                      next_month: "2026-08", next_month_has_goals: true });
ok(done.shown, "next month already has goals: prompt still shows (review, not vanish)");
ok(!/goal-next-note urgent/.test(done.html),
   "next month already has goals: never urgent");
ok(/Revisar/.test(done.html), "next month already has goals: offers Review");

// ---- 7. the UTC regression ----
globalThis.goalState = { today: "2026-07-31", current_month: "2026-07",
                         next_month: "2026-08", next_month_has_goals: false };
globalThis.goalsMonth = new Date("2026-07-31T23:30:00-03:00").toISOString().slice(0, 7);
renderNextMonthGoalRow();
ok(els.nextMonthGoalRow.hidden,
   "sanity: the OLD UTC-derived month (2026-08) does suppress the prompt — this was the bug");
ok(globalThis.goalsMonth !== goalState.current_month,
   "sanity: UTC and local months genuinely diverge at 23:30 on the last day (UTC-3)");
globalThis.goalsMonth = "2026-07";   // what todayStr().slice(0,7) yields locally
renderNextMonthGoalRow();
ok(!els.nextMonthGoalRow.hidden,
   "with the local-derived month the prompt SHOWS at 23:30 on the last day of the month");

// ---- 8. the prompt stays scoped to the current month ----
// On next month itself the empty state and the gold button already say it all;
// on a past month it is meaningless.
ok(!render(ungoaled("2026-07-20"), "2026-05").shown,
   "hidden while browsing a PAST month in the navigator");
ok(!render(ungoaled("2026-07-20"), "2026-08").shown,
   "hidden while browsing next month itself (the card already says it)");

// ---- 9. the gold button's label follows the month being viewed ----
const label = (viewing, gs, hasGoals) => {
  globalThis.goalState = gs;
  globalThis.goalsMonth = viewing;
  renderGoalsMonthButtonLabel(hasGoals);
  return els.btnEditGoalsMonthLabel.innerHTML;
};
const gs = { today: "2026-07-20", current_month: "2026-07",
             next_month: "2026-08", next_month_has_goals: false };

ok(/deste m/.test(label("2026-07", gs, true)),
   "viewing the current month WITH goals: label is the familiar 'this month' wording");
ok(/Definir metas de 2026-08/.test(label("2026-08", gs, false)),
   "viewing next month with NO goals: label names that month and says Definir");
ok(/Editar metas de 2026-08/.test(label("2026-08", gs, true)),
   "viewing next month WITH goals: label names that month and says Editar");
ok(/Definir metas de 2026-07/.test(label("2026-07", gs, false)),
   "viewing the current month with NO goals: label says Definir, not edit");

// ---- 10. the standalone entry point is gone, not left dangling ----
ok(!/startGoalsForNextMonth/.test(src),
   "the old standalone next-month launcher is removed, not left as a dead reference");
ok(/onclick="showNextMonthGoals\(\)"/.test(src) || /showNextMonthGoals\(\)/.test(src),
   "the prompt's button pages the navigator instead of opening a competing form");

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ NEXT-MONTH GOAL PROMPT: VISIBLE ANY DAY, ABOVE THE TABLE, BUTTON FOLLOWS THE MONTH");
process.exit(fail ? 1 : 0);
