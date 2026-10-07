// An approved session writes its tasks, against the REAL helper cut out of
// worker/index.js on an in-memory SQLite. No network.
//
//   node scripts/test-session-tasks.mjs
import { makeDb, build } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

const errors = [];
const stubs = { crypto: globalThis.crypto, console: { error: function (m) { errors.push(m); } } };
const F = build(
  ["sessionTaskYmd", "resolveSessionTaskDue", "sessionTaskItems", "createTasksForApprovedSession"],
  ["SESSION_TASKS_START_DATE", "SESSION_TASK_MONTHS"], stubs);

function world() {
  const d = makeDb([]);
  // The three tables the helper touches (columns it uses; the tasks table
  // mirrors production, with the unique index from tasks_unification.sql).
  d.raw.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, client_id TEXT, date TEXT, status TEXT, pdf_data TEXT);
    CREATE TABLE IF NOT EXISTS session_summaries (id TEXT PRIMARY KEY, session_id TEXT UNIQUE, rafa_followups_pt TEXT, client_action_items_pt TEXT);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL, due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), session_id TEXT, due_date_source TEXT,
      completed_by TEXT, updated_at TEXT, source TEXT, nota TEXT, assigned_to TEXT);
    CREATE UNIQUE INDEX idx_tasks_session_dedupe ON tasks (session_id, type, description) WHERE session_id IS NOT NULL;`);
  return d;
}
function seed(d, id, date, opts) {
  const o = Object.assign({ client: "c1", summary: true, pdf: null, rafa: null, cli: null }, opts || {});
  d.raw.prepare("INSERT INTO sessions (id, client_id, date, status, pdf_data) VALUES (?,?,?,?,?)").run(id, o.client, date, "approved", o.pdf ? JSON.stringify(o.pdf) : null);
  if (o.summary) { d.raw.prepare("INSERT INTO session_summaries (id, session_id, rafa_followups_pt, client_action_items_pt) VALUES (?,?,?,?)").run("ss" + id, id, o.rafa, o.cli); }
}
const tasks = (d, id) => d.q("SELECT * FROM tasks WHERE session_id = ? ORDER BY type, description", id);
const PDF = {
  consultant_followups: [{ text: "Estruturar missao", due: "20 Out" }, { text: "Repassar ao marketing", due: null }],
  client_actions: [{ text: "Criar lista de transmissao", due: null }]
};

{ // 2026-10-05 creates every item
  const d = world(); const env = { DB: d.DB };
  seed(d, "s1", "2026-10-05", { pdf: PDF, rafa: "texto", cli: "texto" });
  await F.createTasksForApprovedSession(env, "s1");
  const t = tasks(d, "s1");
  ok(t.length === 3, "a session dated 2026-10-05 creates one task per follow-up and per action item (3)");
  ok(t.filter(x => x.type === "consultant").length === 2 && t.filter(x => x.type === "client").length === 1, "two consultant tasks, one client task");
  ok(t.every(x => x.source === "session" && x.session_id === "s1" && x.client_id === "c1" && x.status === "pending" && x.created_at), "source session, session_id, client_id, status pending, created now");
  const st = t.find(x => x.description === "Estruturar missao"), pl = t.find(x => x.description === "Repassar ao marketing");
  ok(st.due_date === "2026-10-20" && st.due_date_source === "stated", "a stated date (20 Out) beats session date + 7");
  ok(pl.due_date === "2026-10-12" && pl.due_date_source === "session+7", "no stated date: session date + 7 (2026-10-12)");

  await F.createTasksForApprovedSession(env, "s1");
  await Promise.all([F.createTasksForApprovedSession(env, "s1"), F.createTasksForApprovedSession(env, "s1")]);
  ok(tasks(d, "s1").length === 3, "approving again (and twice at once) creates no duplicates");
}
{ // before the start date
  const d = world(); const env = { DB: d.DB };
  seed(d, "s2", "2026-10-04", { pdf: PDF, rafa: "x", cli: "y" });
  await F.createTasksForApprovedSession(env, "s2");
  ok(tasks(d, "s2").length === 0, "a session dated 2026-10-04 creates none");
}
{ // no summary row / no client / throws
  const d = world(); const env = { DB: d.DB };
  seed(d, "s3", "2026-10-06", { summary: false, pdf: PDF });
  seed(d, "s4", "2026-10-06", { client: null, pdf: PDF, rafa: "x" });
  let threw = false;
  try { await F.createTasksForApprovedSession(env, "s3"); await F.createTasksForApprovedSession(env, "s4"); await F.createTasksForApprovedSession(env, "nope"); } catch (e) { threw = true; }
  ok(!threw && d.q("SELECT COUNT(*) AS c FROM tasks")[0].c === 0, "no summary row, no client, or no such session: nothing created, nothing thrown");
  const bad = { DB: { prepare: function () { throw new Error("db down"); } } };
  errors.length = 0; threw = false;
  try { await F.createTasksForApprovedSession(bad, "s1"); } catch (e) { threw = true; }
  ok(!threw && errors.length === 1, "a database error is caught and logged with console.error, not thrown");
}
{ // shapes of the stored fields
  const d = world(); const env = { DB: d.DB };
  seed(d, "s5", "2026-10-05", { rafa: JSON.stringify(["A um", { text: "B dois", due: "09 Nov" }]), cli: "[]" });
  seed(d, "s6", "2026-10-05", { rafa: "Um paragrafo de texto corrido.", cli: null });
  await F.createTasksForApprovedSession(env, "s5"); await F.createTasksForApprovedSession(env, "s6");
  const a = tasks(d, "s5");
  ok(a.length === 2 && a.find(x => x.description === "B dois").due_date === "2026-11-09" && a.find(x => x.description === "A um").due_date === "2026-10-12", "summary field as a JSON list of strings and objects; empty list adds nothing");
  ok(tasks(d, "s6").length === 1 && tasks(d, "s6")[0].type === "consultant", "plain prose becomes one task; an empty field adds none");
}
console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
