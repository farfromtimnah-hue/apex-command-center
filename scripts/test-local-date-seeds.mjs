// Guards the whole class of bug that has now shipped three times:
// deriving a LOCAL calendar date or month from toISOString(), which is UTC.
//
//   1465f5f, 786d0cc (2026-07-28) — stored UTC timestamps rendered as local
//                                   dates by slicing before converting
//   f05bedd            — goalsMonth seeded from toISOString()
//   this file's commit — analyticsMonth, plus four more seeds in
//                        finance.html / client.html / calendar.html
//
// The 07-28 audit missed the seeds because it grepped for display formatting.
// This test greps for SEEDS AND COMPARISONS, which is where the last three
// lived. See rule 23 in the universal rules.
//
// The failure is invisible for most of the month: west of UTC, toISOString()
// only disagrees with the local calendar during the local evening, and only
// rolls the MONTH on the last day of one. It does not show up in casual
// testing, so it has to be caught statically.
import { readFileSync, readdirSync } from "node:fs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const root = new URL("../", import.meta.url);

// ---- 1. the shared helpers exist and are correct ----
const dt = readFileSync(new URL("datetime.js", root), "utf8");
ok(/function localDateStr\(/.test(dt), "datetime.js exports localDateStr()");
ok(/function localMonthStr\(/.test(dt), "datetime.js exports localMonthStr()");
ok(!/function localDateStr[\s\S]{0,400}toISOString/.test(dt),
   "localDateStr() does NOT go through toISOString()");

// Run them against the exact instant that broke goalsMonth: 23:30 in Sao Paulo
// on the last day of a month. localDateStr() reads the MACHINE's local
// calendar, so this only means anything under a fixed TZ — the runner below
// re-executes this file with TZ=America/Sao_Paulo rather than asserting
// against whatever the developer's clock happens to be.
const sandbox = {};
new Function("g", dt + "\ng.localDateStr = localDateStr; g.localMonthStr = localMonthStr;")(sandbox);
const lastNight = new Date("2026-07-31T23:30:00-03:00");
if (process.env.TZ === "America/Sao_Paulo") {
  ok(sandbox.localDateStr(lastNight) === "2026-07-31",
     "localDateStr() returns the LOCAL date at 23:30 on the last day of the month");
  ok(sandbox.localMonthStr(lastNight) === "2026-07",
     "localMonthStr() returns the LOCAL month at that instant");
} else {
  // Re-run this file under the TZ the bug actually manifests in, so the check
  // runs exactly once and cannot be silently skipped.
  const { execFileSync } = await import("node:child_process");
  console.log("      (re-running the clock assertions under TZ=America/Sao_Paulo)");
  try {
    execFileSync(process.execPath, [new URL(import.meta.url).pathname], {
      env: { ...process.env, TZ: "America/Sao_Paulo" }, stdio: "inherit",
    });
  } catch (e) { fail++; }
}
ok(lastNight.toISOString().slice(0, 7) === "2026-08",
   "sanity: toISOString() would have said 2026-08 — the bug that shipped");

// ---- 2. no static file derives a local date/month from toISOString() ----
// A seed/comparison is the dangerous shape: slicing a UTC instant down to a
// calendar date or month. Sending a full toISOString() to the server, or to a
// UTC-aware formatter, is legitimate and is NOT matched here.
const SLICE_TO_DATE = /toISOString\(\)\s*(?:\.slice\(\s*0\s*,\s*(?:7|10)\s*\)|\.split\(\s*["']T["']\s*\)\s*\[\s*0\s*\])/;

const files = readdirSync(root)
  .filter((f) => /\.(html|js)$/.test(f) && f !== "sw.js");

const offenders = [];
for (const f of files) {
  const src = readFileSync(new URL(f, root), "utf8");
  src.split("\n").forEach((line, i) => {
    if (!SLICE_TO_DATE.test(line)) return;
    // Comments are documentation of the anti-pattern, not uses of it.
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    offenders.push(`${f}:${i + 1}  ${t.slice(0, 100)}`);
  });
}
ok(offenders.length === 0,
   "no static file slices toISOString() down to a local calendar date or month" +
   (offenders.length ? "\n        " + offenders.join("\n        ") : ""));

// ---- 3. the known seeds specifically ----
const portal = readFileSync(new URL("portal.html", root), "utf8");
ok(/var analyticsMonth = todayStr\(\)\.slice\(0, 7\);/.test(portal),
   "analyticsMonth is seeded from todayStr(), not toISOString()");
ok(/var goalsMonth = todayStr\(\)\.slice\(0, 7\);/.test(portal),
   "goalsMonth is still seeded from todayStr() (f05bedd stays fixed)");

for (const [file, what] of [
  ["finance.html", "the recurring-invoice start-date default"],
  ["client.html",  "the new-session date default and the overdue-task comparison"],
  ["calendar.html", "the isPastEvent() today comparison"],
]) {
  const src = readFileSync(new URL(file, root), "utf8");
  ok(/localDateStr\(\)/.test(src), `${file}: ${what} uses localDateStr()`);
  // Every page calling the helper must actually load the file defining it.
  ok(/<script src="datetime\.js"><\/script>/.test(src),
     `${file}: loads datetime.js, which defines localDateStr()`);
}

// ---- 4. stored timestamps still render through the UTC-aware formatters ----
// Slicing a STORED string is the 786d0cc bug: the slice happens before the
// conversion, so it takes the UTC calendar date literally.
ok(/function formatDateUTC\(/.test(dt) && /function formatDateTimeUTC\(/.test(dt),
   "the UTC-aware display formatters are still present for stored timestamps");

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ NO UTC-DERIVED LOCAL DATES");
process.exit(fail ? 1 : 0);
