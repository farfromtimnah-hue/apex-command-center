// Runs every scripts/test-*.mjs and fails if one that should pass does not.
//
//   node scripts/run-tests.mjs            run all
//   node scripts/run-tests.mjs calendar   only files whose name contains "calendar"
//
// Why this exists: package.json's "test" was a stub, so the test files only
// ran when somebody remembered. The 2026-11-01 clock change bug (a calendar
// showing November 1 twice) shipped because nothing ran a date test on that
// day. GitHub runs this on every push (.github/workflows/tests.yml).
//
// Lists live in scripts/tests-skip.json:
//   known_failing  tests that fail today for a known, logged reason. They still
//                  run and are printed, but do not fail the run. Fix one, then
//                  delete it from the list (the runner tells you when it passes).
//   needs_outside  tests that need a live service, a secret or a database.
//                  They are not run here.
import { readdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const dir = new URL("./", import.meta.url);
const cfg = JSON.parse(readFileSync(new URL("tests-skip.json", dir), "utf8"));
const only = process.argv[2] || "";
const names = readdirSync(dir).filter(f => /^test-.*\.mjs$/.test(f) && f.includes(only)).sort();
const TIMEOUT_MS = 60000;
const PARALLEL = 6;

function run(name) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [new URL(name, dir).pathname], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", d => { out += d; });
    p.stderr.on("data", d => { out += d; });
    const t = setTimeout(() => { p.kill("SIGKILL"); out += "\nTIMEOUT after " + TIMEOUT_MS / 1000 + " s"; }, TIMEOUT_MS);
    p.on("close", code => { clearTimeout(t); resolve({ name, code, out }); });
  });
}

const todo = names.filter(n => !cfg.needs_outside.includes(n));
const skipped = names.length - todo.length;
const results = [];
let i = 0;
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  while (i < todo.length) { const n = todo[i++]; results.push(await run(n)); }
}));

let bad = 0;
for (const r of results.sort((a, b) => a.name.localeCompare(b.name))) {
  const known = cfg.known_failing.includes(r.name);
  if (r.code === 0 && known) { console.log("NOW PASSES (remove from known_failing): " + r.name); }
  else if (r.code !== 0 && known) { console.log("known failing: " + r.name); }
  else if (r.code !== 0) { bad++; const lines = r.out.split("\n");
    const failing = lines.filter(l => /FAIL|Error|TIMEOUT/.test(l)).slice(0, 15);
    console.log("\nFAIL: " + r.name + "\n" + (failing.length ? failing.join("\n") + "\n--- last lines ---\n" : "") + lines.slice(-8).join("\n")); }
}
console.log("\n" + results.filter(r => r.code === 0).length + " passed, " + bad + " failed, " +
  results.filter(r => r.code !== 0 && cfg.known_failing.includes(r.name)).length + " known failing, " + skipped + " need outside services (not run)");
process.exit(bad ? 1 : 0);
