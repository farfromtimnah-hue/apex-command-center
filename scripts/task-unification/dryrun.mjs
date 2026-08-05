// DRY RUN — reports what the task unification would do. Writes NOTHING.
//
// Usage:
//   node scripts/task-unification/dryrun.mjs           # report only
//   node scripts/task-unification/dryrun.mjs --sql     # also emit migrate.sql
//
// Reads live remote D1 via `wrangler d1 execute --remote --json`.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { deriveTasks, resolveDue, completionKeys, ymd } from "./derive.mjs";

const DB = "apex-command-center";
const TODAY = new Date("2026-08-04T00:00:00");
TODAY.setHours(0, 0, 0, 0);
const CUTOFF = "2026-08-01";          // due < CUTOFF → swept to done
const EMIT_SQL = process.argv.includes("--sql");

function q(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB, "--remote", "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 256 }
  );
  const start = out.indexOf("[");
  const parsed = JSON.parse(out.slice(start));
  return parsed[0].results;
}

const esc = s => String(s).replace(/'/g, "''");
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : "0.0") + "%";

function table(rows, cols) {
  const w = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? "").length)));
  const line = (cells) => "  " + cells.map((c, i) => String(c).padEnd(w[i])).join("  ");
  console.log(line(cols));
  console.log("  " + w.map(x => "-".repeat(x)).join("  "));
  rows.forEach(r => console.log(line(cols.map(c => r[c] ?? ""))));
}

// ── Load ────────────────────────────────────────────────────────────────
console.log("Reading live D1 …\n");

const sessions = q(
  "SELECT id, client_id, client_name, date, status, summary_json, pdf_data, " +
  "task_completions, created_at FROM sessions"
);
const existing = q(
  "SELECT id, client_id, type, description, due_date, status, created_at FROM tasks"
);
const clientRows = q("SELECT id, name FROM clients");
const clientIds = new Set(clientRows.map(c => c.id));

// ── Part 1: existing tasks table ───────────────────────────────────────
console.log("=".repeat(72));
console.log("PART 1 — EXISTING `tasks` TABLE (" + existing.length + " rows)");
console.log("=".repeat(72) + "\n");

const byStatus = {};
existing.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });
console.log("Status vocabulary today:");
table(Object.entries(byStatus).map(([status, n]) => ({
  status, n, action: status === "completed" ? "→ normalize to 'done'" : "unchanged"
})), ["status", "n", "action"]);

// Backfill due dates for NULL rows.
const sessionById = new Map(sessions.map(s => [s.id, s]));
const backfill = [];
for (const t of existing) {
  if (t.due_date) { continue; }
  // These rows carry no session_id yet, so the session+7 branch is
  // unavailable; created_at+7 is the proxy (batch-import timestamp).
  const r = resolveDue(null, null, t.created_at, TODAY);
  backfill.push({ ...t, new_due: r.due, source: r.source });
}
console.log(`\nDue-date backfill: ${backfill.length} of ${existing.length} rows have NULL due_date`);
const bySource = {};
backfill.forEach(b => { bySource[b.source] = (bySource[b.source] || 0) + 1; });
table(Object.entries(bySource).map(([source, n]) => ({ source, n })), ["source", "n"]);

const dated = existing.map(t => {
  const b = backfill.find(x => x.id === t.id);
  return { ...t, eff_due: t.due_date || (b && b.new_due) || null,
           eff_source: t.due_date ? "already-set" : (b && b.source) };
});
const sweepExisting = dated.filter(
  t => t.eff_due && t.eff_due < CUTOFF && t.status !== "done"
);
const keepExisting = dated.filter(t => t.eff_due && t.eff_due >= CUTOFF);
console.log(`\nSweep (due < ${CUTOFF}): ${sweepExisting.length} rows → done`);
console.log(`Stay pending (due >= ${CUTOFF}): ${keepExisting.length} rows`);

// ── Part 2: derived tasks ──────────────────────────────────────────────
console.log("\n" + "=".repeat(72));
console.log("PART 2 — DERIVED TASKS TO MIGRATE");
console.log("=".repeat(72) + "\n");

const derived = deriveTasks(sessions, TODAY);
const real = derived.filter(d => d.kind !== "text");
const textTasks = derived.filter(d => d.kind === "text");

console.log(`Derived total: ${derived.length}`);
console.log(`  consultant (rafa): ${derived.filter(d => d.kind === "rafa").length}`);
console.log(`  client:            ${derived.filter(d => d.kind === "client").length}`);
console.log(`  text fallback:     ${textTasks.length}  <-- see note below`);
console.log(`Sessions contributing: ${new Set(derived.map(d => d.session_id)).size}`);
console.log(`Discarded sessions skipped: ${sessions.filter(s => s.status === "discarded").length}`);

// Completion mapping.
const derivedKeys = new Set(derived.map(d => d.key));
const allCompletionKeys = [];
for (const s of sessions) {
  completionKeys(s.task_completions).forEach(k =>
    allCompletionKeys.push({ key: k, session_id: s.id, client_name: s.client_name,
                             discarded: s.status === "discarded" }));
}
const mapped = allCompletionKeys.filter(c => derivedKeys.has(c.key));
const orphans = allCompletionKeys.filter(c => !derivedKeys.has(c.key));

console.log(`\nCompletion keys in sessions.task_completions: ${allCompletionKeys.length}`);
console.log(`  map to a derived task  → status='done': ${mapped.length}`);
console.log(`  ORPHANED (defect 1)    → no matching task: ${orphans.length}`);
if (orphans.length) {
  console.log("\n  Orphaned keys (completion recorded, task no longer derives):");
  table(orphans.map(o => ({
    client: o.client_name, key: o.key,
    note: o.discarded ? "session discarded" : "task vanished from pdf_data"
  })), ["client", "key", "note"]);
}

// Client-id integrity: the overdue endpoint INNER JOINs clients, so a task
// whose client_id is missing would be invisible on Rafa's tile.
const noClient = real.filter(d => !d.client_id);
const badClient = real.filter(d => d.client_id && !clientIds.has(d.client_id));
console.log(`\nClient integrity of migrated rows:`);
console.log(`  NULL client_id:            ${noClient.length}`);
console.log(`  client_id not in clients:  ${badClient.length}`);
if (noClient.length || badClient.length) {
  const bad = [...noClient, ...badClient];
  table([...new Set(bad.map(b => b.session_id))].map(sid => {
    const g = bad.filter(x => x.session_id === sid);
    return { session: sid.slice(0, 8), client_name: g[0].client_name,
             client_id: String(g[0].client_id), tasks: g.length };
  }), ["session", "client_name", "client_id", "tasks"]);
  console.log("  ^ these would NOT appear on Rafa's overdue tile (INNER JOIN clients).");
}

// Import set = real tasks with a usable client_id.
const importable = real.filter(d => d.client_id && clientIds.has(d.client_id));
const skipped = real.length - importable.length;

console.log(`\nWould INSERT: ${importable.length} rows` +
            (skipped ? `  (${skipped} withheld — unresolvable client_id)` : ""));

const srcCount = {};
importable.forEach(d => { srcCount[d.due_date_source] = (srcCount[d.due_date_source] || 0) + 1; });
console.log("\nBy due_date_source:");
table(Object.entries(srcCount).map(([source, n]) =>
  ({ source, n, share: pct(n, importable.length) })), ["source", "n", "share"]);

const withStatus = importable.map(d => {
  const done = derivedKeys.has(d.key) && mapped.some(m => m.key === d.key);
  const swept = !done && d.due_date && d.due_date < CUTOFF;
  // Deterministic id derived from the derivation key ("{sessionId}_{kind}_{i}"),
  // so re-running the migration reproduces the same ids instead of inserting
  // duplicates. Prefixed to keep migrated rows distinguishable from the
  // hand-created ones (e.g. elevate-task-007).
  return { ...d, id_uuid: `sess-${d.key}`,
           final_status: (done || swept) ? "done" : "pending",
           reason: done ? "migrated-from-session" : (swept ? "system-sweep" : "live") };
});
console.log("\nResulting status:");
const rc = {};
withStatus.forEach(d => { rc[d.reason] = (rc[d.reason] || 0) + 1; });
table(Object.entries(rc).map(([reason, n]) => ({
  reason, n, status: reason === "live" ? "pending" : "done"
})), ["reason", "n", "status"]);

console.log("\nBy client:");
const byClient = {};
withStatus.forEach(d => {
  const k = d.client_name;
  byClient[k] = byClient[k] || { client: k, consultant: 0, client_t: 0, done: 0, pending: 0 };
  if (d.type === "consultant") { byClient[k].consultant++; } else { byClient[k].client_t++; }
  byClient[k][d.final_status]++;
});
table(Object.values(byClient).sort((a, b) =>
  (b.consultant + b.client_t) - (a.consultant + a.client_t)),
  ["client", "consultant", "client_t", "done", "pending"]);

// ── Part 3: combined outcome ───────────────────────────────────────────
console.log("\n" + "=".repeat(72));
console.log("PART 3 — RESULT AFTER MIGRATION + SWEEP");
console.log("=".repeat(72) + "\n");

const livePending = withStatus.filter(d => d.final_status === "pending").length
                  + keepExisting.filter(t => t.status !== "done").length;
console.log(`Total rows in tasks after migration: ${existing.length + importable.length}`);
console.log(`  pending (live work, due >= ${CUTOFF}): ${livePending}`);
console.log(`  done (swept + completed + migrated):  ${existing.length + importable.length - livePending}`);

const overdueAfter = [...withStatus.filter(d => d.final_status === "pending"),
                      ...keepExisting.filter(t => t.status !== "done")]
  .filter(t => (t.due_date || t.eff_due) < ymd(TODAY));
console.log(`\nRafa's overdue tile (both types, pending, due < today): ${overdueAfter.length}`);
console.log(`  (reads 4 today)`);

const elevate = existing.filter(t => /^elevate-task-(007|008|009|010)$/.test(t.id));
console.log(`\n⚠ ELEVATE tasks awaiting Nicole's decision: ${elevate.length}`);
table(elevate.map(t => ({ id: t.id, due: t.due_date, status: t.status,
  description: t.description.slice(0, 46) })), ["id", "due", "status", "description"]);
console.log("  Included in the sweep counts above. Excluding them leaves");
console.log(`  Rafa's tile at ${overdueAfter.length + elevate.length} instead of ${overdueAfter.length}.`);

if (textTasks.length) {
  console.log(`\n⚠ ${textTasks.length} free-text fallback task(s) NOT imported (no due date,`);
  console.log("  whole-summary blobs rather than discrete tasks). Listed for review:");
  table(textTasks.map(t => ({ client: t.client_name, session: t.session_id.slice(0, 8),
    chars: t.text.length })), ["client", "session", "chars"]);
}

// ── Optional SQL emission ──────────────────────────────────────────────
if (EMIT_SQL) {
  const now = "2026-08-04T00:00:00Z";
  const L = [];
  L.push("-- Task unification — generated by dryrun.mjs --sql. NO DELETEs.");
  // No BEGIN TRANSACTION/COMMIT: D1 rejects explicit SQL transaction control
  // ("please use state.storage.transaction() instead"). `wrangler d1 execute
  // --file` already applies the whole file atomically and rolls back on error.
  L.push("\n-- 2. Normalize status vocabulary");
  L.push(`UPDATE tasks SET status='done', updated_at='${now}' WHERE status='completed';`);
  L.push("\n-- 3. Backfill due dates on existing rows");
  for (const b of backfill) {
    L.push(`UPDATE tasks SET due_date='${b.new_due}', due_date_source='${b.source}', ` +
           `updated_at='${now}' WHERE id='${esc(b.id)}';`);
  }
  L.push("\n-- 4. Migrate derived tasks");
  for (const d of withStatus) {
    const cb = d.final_status === "done" ? `'${d.reason}'` : "NULL";
    L.push(
      "INSERT INTO tasks (id, client_id, type, description, due_date, status, " +
      "created_at, updated_at, completed_by, session_id, due_date_source) VALUES (" +
      `'${esc(d.id_uuid)}', '${esc(d.client_id)}', '${d.type}', '${esc(d.text)}', ` +
      `${d.due_date ? `'${d.due_date}'` : "NULL"}, '${d.final_status}', ` +
      `'${esc(d.session_date || now)}', '${now}', ${cb}, '${esc(d.session_id)}', ` +
      `'${d.due_date_source}');`
    );
  }
  L.push("\n-- 5. Sweep — everything overdue before the cutoff, ELEVATE included");
  L.push("--    (Nicole 2026-08-04: sweep elevate-task-007..010 with the rest)");
  L.push(`UPDATE tasks SET status='done', completed_by='system-sweep', updated_at='${now}' ` +
         `WHERE due_date < '${CUTOFF}' AND status='pending';`);
  writeFileSync("scripts/task-unification/migrate.sql", L.join("\n") + "\n");
  console.log("\nWrote scripts/task-unification/migrate.sql (NOT applied).");
}

console.log("\nDRY RUN COMPLETE — nothing was written to D1.\n");
