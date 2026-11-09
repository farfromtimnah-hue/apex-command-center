// Guards against stepping a LOCAL calendar date by adding milliseconds.
//
//   new Date(d.getTime() + 86400000)   WRONG in a browser: the day the clocks
//   go back has 25 hours, so local midnight + 24 h is 11 PM the same day. The
//   month grid showed 2026-11-01 twice and every date after it sat one weekday
//   too far right (Pr Rafa, 2026-11-09).
//
//   new Date(y, m, d + 1)              RIGHT: step the calendar date.
//
// Scans the browser-side files. The Worker (worker/) runs in UTC, which has no
// clock changes, so ms arithmetic there is safe and is not scanned. Plain
// elapsed time (Date.now() - 7 * 86400000, "how many days ago") is also fine:
// only a Date built from another Date's getTime() plus or minus whole days is
// flagged, because that is calendar stepping.
import { readdirSync, readFileSync } from "node:fs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const root = new URL("../", import.meta.url);
const files = readdirSync(root).filter(f => /\.(js|html)$/.test(f) && !/min\.js$/.test(f));
const DAY = /(86400000|24 ?\* ?60 ?\* ?60 ?\* ?1000|24 ?\* ?3600 ?\* ?1000|8\.64e7|864e5)/;
const STEP = /(new Date\([^;]*\.getTime\(\)\s*[+-][^;]*|\.setTime\([^;]*\.getTime\(\)\s*[+-][^;]*)/;

const hits = [];
for (const f of files) {
  readFileSync(new URL(f, root), "utf8").split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");   // ignore comments
    const m = STEP.exec(code);
    if (m && DAY.test(m[0])) { hits.push(f + ":" + (i + 1) + "  " + line.trim().slice(0, 120)); }
  });
}
ok(hits.length === 0, "no browser file steps a local Date by whole days of milliseconds" + (hits.length ? ":\n    " + hits.join("\n    ") : ""));

// The guard must actually catch the bad pattern (so it cannot go blind).
const bad = "var e = new Date(start.getTime() + 41 * 86400000);";
const good = "var e = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 41);";
const catches = s => { const m = STEP.exec(s); return !!(m && DAY.test(m[0])); };
ok(catches(bad), "sanity: the guard flags the bad pattern");
ok(!catches(good), "sanity: the guard accepts calendar date stepping");

console.log(fail ? "\n" + fail + " FAILED" : "\nAll passed");
process.exit(fail ? 1 : 0);
