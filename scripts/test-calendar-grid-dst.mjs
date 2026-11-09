// Month grid across the autumn clock change (2026-11-01, a 25 hour day in
// New York). The grid once stepped one day with +86400000 ms from local
// midnight, which landed at 11 PM on the SAME day, so November 1 showed twice
// and every later date sat one weekday to the right (reported by Pr Rafa
// 2026-11-09). Runs itself under six time zones and checks every month of
// 2024 to 2030.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

// Zones with clock changes at different dates, plus UTC and a zone with none.
const ZONES = ["America/New_York", "America/Los_Angeles", "Europe/London", "Australia/Sydney", "America/Sao_Paulo", "UTC"];
if (!process.env.TZ) {
  let bad = 0;
  for (const tz of ZONES) {
    console.log("=== " + tz + " ===");
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname], { env: { ...process.env, TZ: tz }, stdio: "inherit" });
    if (r.status !== 0) { bad++; }
  }
  process.exit(bad ? 1 : 0);
}

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

function el() {
  const e = { children: [], attrs: {}, className: "", textContent: "", innerHTML: "", style: {}, onclick: null,
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; } };
  return e;
}
const win = {};
win.window = win;
win.document = { createElement: el };
vm.runInNewContext(readFileSync(new URL("../calendar-grid.js", import.meta.url), "utf8"), win);
const CG = win.CalendarGrid;

function cells(year, month) {
  const host = el();
  CG.renderMonthGrid(host, { anchor: new Date(year, month, 1), events: [], en: true, renderChip: () => null });
  const grid = host.children[0].children[1];
  return grid.children.map(c => ({ date: c.attrs["data-date"], num: c.children[0].textContent }));
}

function checkMonth(label, year, month) {
  const cs = cells(year, month);
  ok(cs.length % 7 === 0, label + ": whole weeks (" + cs.length + " cells)");
  const dates = cs.map(c => c.date);
  ok(new Set(dates).size === dates.length, label + ": no date appears twice");
  let step = true;
  for (let i = 1; i < dates.length; i++) {
    const [y, m, d] = dates[i - 1].split("-").map(Number);
    const n = new Date(y, m - 1, d + 1);
    const want = n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
    if (dates[i] !== want) { step = false; console.log("   gap: " + dates[i - 1] + " then " + dates[i]); }
  }
  ok(step, label + ": every cell is the day after the one before");
  const first = dates[0].split("-").map(Number);
  ok(new Date(first[0], first[1] - 1, first[2]).getDay() === 0, label + ": grid starts on a Sunday");
  const lastOfMonth = dates.filter(d => d.startsWith(year + "-" + String(month + 1).padStart(2, "0")));
  const dim = new Date(year, month + 1, 0).getDate();
  ok(lastOfMonth.length === dim, label + ": all " + dim + " days of the month present (" + lastOfMonth.length + ")");
  return cs;
}

// Every month of 2024 to 2030: covers both clock changes in every zone above.
const quiet = console.log;
let monthsBad = 0;
for (let y = 2024; y <= 2030; y++) {
  for (let m = 0; m < 12; m++) {
    const before = fail;
    console.log = () => {};
    checkMonth(y + "-" + (m + 1), y, m);
    console.log = quiet;
    if (fail > before) { monthsBad++; quiet("FAIL  month " + y + "-" + (m + 1) + " in " + process.env.TZ); }
  }
}
ok(monthsBad === 0, "all 84 months of 2024 to 2030 are whole weeks of consecutive, unique days in " + process.env.TZ);
// The reported case, in New York.
if (process.env.TZ === "America/New_York") {
  const nov = cells(2026, 10);
  ok(nov[0].date === "2026-11-01" && nov[1].date === "2026-11-02", "November 2026: Sunday is the 1st, Monday is the 2nd");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nAll passed");
process.exit(fail ? 1 : 0);
