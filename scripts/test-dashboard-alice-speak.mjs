// Alice's dashboard: one copy of the "Speak my tasks" control, and the
// sessions-approved bar gone. Reads the page source only. No network.
//
//   node scripts/test-dashboard-alice-speak.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const count = (s, t) => s.split(t).length - 1;

const FILES = ["dashboard.html", "ios/App/App/public/dashboard.html"];
const IDS = ["mtVoiceBlock", "mtSpeakBtn", "mtSpeakLabel", "mtTimer", "mtCancelBtn", "mtStatus", "mtHeard", "mtHeardText"];
const FUNCS = ["toggleMyTasksRecording", "uploadMyTasksBlob", "undoMyTasksDictation", "mtMoveVoiceBlock", "mtRefreshLists"];

for (const f of FILES) {
  const src = readFileSync(new URL(f, root), "utf8");
  for (const id of IDS) { ok(count(src, 'id="' + id + '"') === 1, f + ": id " + id + " appears once"); }
  for (const fn of FUNCS) { ok(count(src, "function " + fn + "(") === 1, f + ": function " + fn + " defined once"); }
  ok(count(src, "aliceStatusLabel") === 0, f + ": aliceStatusLabel gone");
  ok(count(src, "aliceProgressFill") === 0, f + ": aliceProgressFill gone");
  ok(count(src, 'id="aliceResourceStatusLabel"') === 1, f + ": aliceResourceStatusLabel kept");
  ok(count(src, 'id="aliceResourceProgressFill"') === 1, f + ": aliceResourceProgressFill kept");
  ok(/if \(who === "alice"\) \{\s*mtMoveVoiceBlock\(card\);/.test(src), f + ": Alice card takes the block");
  const dir = mtemp();
  const scripts = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  scripts.forEach((code, i) => {
    const p = join(dir, "s" + i + ".js");
    writeFileSync(p, code);
    let good = true;
    try { execFileSync(process.execPath, ["--check", p], { stdio: "pipe" }); } catch (e) { good = false; }
    ok(good, f + ": inline script " + i + " passes node --check");
  });
}
function mtemp() { return mkdtempSync(join(tmpdir(), "alice-")); }
console.log(fail ? fail + " FAILED" : "ALL PASSED");
process.exit(fail ? 1 : 0);
