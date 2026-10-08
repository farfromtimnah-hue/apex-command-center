// Alice's hero tiles: page source checks and the two invoice counts.
// Reads the page source only. No network.
//
//   node scripts/test-dashboard-alice-hero-tiles.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const count = (s, t) => s.split(t).length - 1;

const FILES = ["dashboard.html", "ios/App/App/public/dashboard.html"];
const OLD = ["aliceStatPending", "aliceStatSummarized", "aliceStatApproved", "aliceStatTotal"];
const NEW = ["aliceStatUnsentInvoices", "aliceStatOverdueInvoices", "aliceStatReminders", "aliceStatTasks"];

function grab(src, name) {
  const i = src.indexOf("    function " + name + "(");
  if (i < 0) { throw new Error("no function " + name); }
  const j = src.indexOf("\n    }\n", i);
  return src.slice(i, j + 7);
}

for (const f of FILES) {
  const src = readFileSync(new URL(f, root), "utf8");
  for (const id of OLD) { ok(count(src, id) === 0, f + ": " + id + " gone"); }
  for (const id of NEW) {
    ok(count(src, 'id="' + id + '"') === 1, f + ": tile " + id + " present once");
    ok(count(src, '"' + id + '"') >= 1, f + ": " + id + " is filled by the script");
  }
  ok(count(src, 'id="aliceStatResourcePending"') === 1, f + ": Pending Sends tile kept");
  ok(count(src, 'id="aliceResourceProgressFill"') === 1, f + ": resources bar kept");
  ok(count(src, "function renderAliceRecentSessions(") === 1, f + ": recent sessions renderer kept");
  ok(/renderAliceRecentSessions\(sessions\);/.test(src), f + ": recent sessions still drawn");
  ok(count(src, "finance-new.html?highlight=invoice") === 1, f + ": unsent tile opens the Faturas tab");
  const hero = src.slice(src.indexOf('<div id="aliceDash"'), src.indexOf("<!-- Resource sends status bar"));
  ok(hero.indexOf("+ New Session") > 0 && hero.indexOf("Speak a meeting") > 0, f + ": hero buttons kept");
  ok(count(hero, "data-title-attr-pt") === 5 && count(hero, "data-title-attr-en") === 5, f + ": five tiles carry both titles");
  ok(count(hero, 'tabindex="0"') === 5 && count(hero, "onkeydown") === 4, f + ": tiles are keyboard reachable");

  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(grab(src, "aliceCountUnsentInvoices") + grab(src, "aliceCountOverdueInvoices"), ctx);
  const today = "2026-10-07";
  const inv = (status, due, extra) => Object.assign({ status: status, due_at: due }, extra || {});
  ok(ctx.aliceCountUnsentInvoices([inv("draft", "2026-09-01"), inv("draft", "2026-12-01"), inv("sent", "2026-09-01"), inv("paid"), inv("void"), inv("voided_mistake")]) === 2, f + ": unsent counts drafts only");
  ok(ctx.aliceCountUnsentInvoices([]) === 0 && ctx.aliceCountUnsentInvoices(null) === 0, f + ": unsent of nothing is 0");
  ok(ctx.aliceCountOverdueInvoices([inv("sent", "2026-10-06")], today) === 1, f + ": sent, day after due date is overdue");
  ok(ctx.aliceCountOverdueInvoices([inv("sent", "2026-10-07")], today) === 0, f + ": due today is not overdue");
  ok(ctx.aliceCountOverdueInvoices([inv("sent", "2026-10-08")], today) === 0, f + ": sent before due date is not overdue");
  ok(ctx.aliceCountOverdueInvoices([inv("draft", "2026-09-01")], today) === 0, f + ": draft is not overdue");
  ok(ctx.aliceCountOverdueInvoices([inv("paid", "2026-09-01"), inv("void", "2026-09-01"), inv("voided_mistake", "2026-09-01")], today) === 0, f + ": paid and void are not overdue");
  ok(ctx.aliceCountOverdueInvoices([inv("sent", "2026-09-01", { partially_paid: true })], today) === 0, f + ": part paid follows the Finance label (not overdue)");
  ok(ctx.aliceCountOverdueInvoices([inv("sent", null)], today) === 0, f + ": no due date is not overdue");

  const dir = mkdtempSync(join(tmpdir(), "alice-hero-"));
  const scripts = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  scripts.forEach((code, i) => {
    const p = join(dir, "s" + i + ".js");
    writeFileSync(p, code);
    let good = true;
    try { execFileSync(process.execPath, ["--check", p], { stdio: "pipe" }); } catch (e) { good = false; }
    ok(good, f + ": inline script " + i + " passes node --check");
  });
}
console.log(fail ? fail + " FAILED" : "ALL PASSED");
process.exit(fail ? 1 : 0);
