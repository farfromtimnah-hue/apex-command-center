// migrations/2026-10-05_tasks_client_optional.sql against an in-memory SQLite
// (node:sqlite, the same tool scripts/fixtures/d1-shim.mjs uses) built with the
// tasks table exactly as it is live today. No network, no file is written.
//
//   node scripts/test-tasks-client-optional.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../", import.meta.url);
const MIG = "migrations/2026-10-05_tasks_client_optional.sql";
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

// The live schema, as given in the job.
const CURRENT = `
CREATE TABLE tasks (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL, due_date TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), session_id TEXT, due_date_source TEXT, completed_by TEXT, updated_at TEXT, source TEXT, nota TEXT);
CREATE INDEX idx_tasks_status_due ON tasks (status, due_date);
CREATE INDEX idx_tasks_client ON tasks (client_id, status);
CREATE UNIQUE INDEX idx_tasks_session_dedupe ON tasks (session_id, type, description) WHERE session_id IS NOT NULL;
CREATE INDEX idx_tasks_source_due ON tasks (source, due_date);
CREATE INDEX idx_tasks_session ON tasks (session_id);
`;
const COLS = "id, client_id, type, description, due_date, status, created_at, session_id, due_date_source, completed_by, updated_at, source, nota";
const INDEXES = {
  idx_tasks_status_due: "CREATE INDEX idx_tasks_status_due ON tasks (status, due_date)",
  idx_tasks_client: "CREATE INDEX idx_tasks_client ON tasks (client_id, status)",
  idx_tasks_session_dedupe: "CREATE UNIQUE INDEX idx_tasks_session_dedupe ON tasks (session_id, type, description) WHERE session_id IS NOT NULL",
  idx_tasks_source_due: "CREATE INDEX idx_tasks_source_due ON tasks (source, due_date)",
  idx_tasks_session: "CREATE INDEX idx_tasks_session ON tasks (session_id)"
};

function checksum(db) {
  const rows = db.prepare("SELECT " + COLS + " FROM tasks ORDER BY id").all();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
function count(db) { return Number(db.prepare("SELECT COUNT(*) AS n FROM tasks").get().n); }
function throws(fn) { try { fn(); return null; } catch (e) { return String(e.message); } }

const db = new DatabaseSync(":memory:");
db.exec(CURRENT);

// Varied rows: every source, both types, with and without a session, with and
// without a due date, done and pending, accents, quotes, an empty nota, a
// created_at left to its default.
const ins = db.prepare("INSERT INTO tasks (" + COLS + ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
const sources = ["session", "manual", "help_request", null];
let n = 0;
for (let i = 0; i < 60; i++) {
  const hasSession = i % 3 !== 0;
  const done = i % 4 === 0;
  ins.run(
    "t" + String(i).padStart(3, "0"), "client-" + (i % 7), i % 2 ? "client" : "consultant",
    i % 5 === 0 ? "Ligar para o contador \u2014 a\u00e7\u00e3o n\u00ba " + i + " 'aspas' \"duplas\"" : "Task number " + i,
    i % 6 === 0 ? null : "2026-" + String((i % 12) + 1).padStart(2, "0") + "-" + String((i % 27) + 1).padStart(2, "0"),
    done ? "done" : (i % 11 === 0 ? "not_done" : "pending"),
    "2026-08-" + String((i % 27) + 1).padStart(2, "0") + " 14:0" + (i % 10) + ":00",
    hasSession ? "sess-" + (i % 9) : null,
    i % 6 === 0 ? null : (i % 2 ? "stated" : "session+7"),
    done ? (i % 8 === 0 ? "system-sweep" : "rafa") : null,
    i % 3 === 0 ? null : "2026-09-01T12:00:0" + (i % 10) + ".000Z",
    sources[i % 4],
    i % 9 === 0 ? "" : (i % 10 === 0 ? "nota com\nquebra de linha" : null)
  );
  n++;
}
// One row that takes the column defaults (status, created_at).
db.prepare("INSERT INTO tasks (id, client_id, type, description) VALUES ('t-default', 'client-1', 'client', 'Defaults row')").run();
n++;
// Two rows with the same type and description but NO session: the unique
// index does not cover them, and both must survive the copy.
db.prepare("INSERT INTO tasks (id, client_id, type, description, source) VALUES ('t-same-a', 'client-2', 'consultant', 'Same words', 'manual')").run();
db.prepare("INSERT INTO tasks (id, client_id, type, description, source) VALUES ('t-same-b', 'client-2', 'consultant', 'Same words', 'manual')").run();
n += 2;
// A session task, and its duplicate, which the unique index must refuse.
db.prepare("INSERT INTO tasks (id, client_id, type, description, session_id, source) VALUES ('t-dup-1', 'client-3', 'client', 'Send the report', 'sess-dup', 'session')").run();
n++;
const dupSql = "INSERT INTO tasks (id, client_id, type, description, session_id, source) VALUES (?, 'client-3', 'client', 'Send the report', 'sess-dup', 'session')";

ok(count(db) === n, "before: " + n + " rows seeded");
ok(/UNIQUE/i.test(throws(() => db.prepare(dupSql).run("t-dup-before")) || ""), "before: the unique index rejects a duplicate session task");
ok(/NOT NULL/i.test(throws(() => db.prepare("INSERT INTO tasks (id, client_id, type, description) VALUES ('t-null-before', NULL, 'consultant', 'x')").run()) || ""), "before: a row with client_id NULL is refused (the live table today)");

const beforeCount = count(db);
const beforeSum = checksum(db);

// The file is run the way D1 runs one: no BEGIN / COMMIT of its own.
const sql = readFileSync(new URL(MIG, root), "utf8");
const body = sql.replace(/^\s*--[^\n]*$/gm, "");
ok(!/\b(BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i.test(body), "the file has no BEGIN / COMMIT / ROLLBACK / SAVEPOINT statement");
ok(!/\bPRAGMA\b/i.test(body), "the file uses no PRAGMA");
ok(!/\b(UPDATE|DELETE)\b/i.test(body), "the file has no UPDATE and no DELETE");
// One statement at a time as well as whole, so a statement that only works
// inside a multi-statement exec would show up.
const stmts = body.split(";").map((s) => s.trim()).filter(Boolean);
let runErr = null;
try { stmts.forEach((s) => db.exec(s)); } catch (e) { runErr = e.message; }
ok(runErr === null, "the migration runs, one statement at a time (" + stmts.length + " statements)" + (runErr ? ": " + runErr : ""));

ok(count(db) === beforeCount, "after: same row count (" + beforeCount + " -> " + count(db) + ")");
ok(checksum(db) === beforeSum, "after: same checksum over the 13 original columns, ordered by id (" + beforeSum.slice(0, 16) + "...)");

const cols = db.prepare("PRAGMA table_info(tasks)").all();
const names = cols.map((c) => c.name);
ok(names.join(", ") === COLS + ", created_by", "after: same columns in the same order, plus created_by last");
ok(Number(cols.find((c) => c.name === "client_id").notnull) === 0, "after: client_id is no longer NOT NULL");
const stillRequired = ["type", "description", "status", "created_at"].every((c) => Number(cols.find((x) => x.name === c).notnull) === 1);
ok(stillRequired, "after: type, description, status and created_at are still NOT NULL");
ok(Number(cols.find((c) => c.name === "id").pk) === 1, "after: id is still the primary key");
ok(cols.find((c) => c.name === "status").dflt_value === "'pending'" && cols.find((c) => c.name === "created_at").dflt_value === "datetime('now')", "after: the status and created_at defaults are unchanged");
ok(names.indexOf("created_by") >= 0, "after: created_by exists");
ok(Number(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE created_by IS NOT NULL").get().n) === 0, "after: created_by is NULL for every existing row");

const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' AND sql IS NOT NULL").all();
Object.keys(INDEXES).forEach((k) => {
  const found = idx.find((r) => r.name === k);
  ok(!!found && found.sql.replace(/\s+/g, " ").trim() === INDEXES[k], "after: index " + k + " present with the same definition");
});
ok(idx.length === 5, "after: exactly five indexes on tasks (" + idx.length + ")");
ok(Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'tasks_new'").get().n) === 0, "after: tasks_new is gone");

ok(/UNIQUE/i.test(throws(() => db.prepare(dupSql).run("t-dup-after")) || ""), "after: the unique index still rejects a duplicate session task");
ok(throws(() => db.prepare("INSERT INTO tasks (id, client_id, type, description, source, created_by) VALUES ('t-null-after', NULL, 'consultant', 'Call the accountant', 'voice', 'Test')").run()) === null, "after: a row with client_id NULL can be inserted");
const fresh = db.prepare("SELECT status, created_at, created_by FROM tasks WHERE id = 't-null-after'").get();
ok(fresh.status === "pending" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(fresh.created_at) && fresh.created_by === "Test", "after: a new row still gets status 'pending' and a created_at by default");
ok(/NOT NULL/i.test(throws(() => db.prepare("INSERT INTO tasks (id, type) VALUES ('t-nodesc', 'consultant')").run()) || ""), "after: a row with no description is still refused");

const dumpCols = db.prepare("PRAGMA table_info(task_voice_dumps)").all().map((c) => c.name).join(", ");
ok(dumpCols === "id, created_by, created_at, language, transcript, status, error, tasks_created", "task_voice_dumps exists with the eight columns");
db.prepare("INSERT INTO task_voice_dumps (id, created_by) VALUES ('d1', 'Test')").run();
const dump = db.prepare("SELECT status, tasks_created, created_at FROM task_voice_dumps WHERE id = 'd1'").get();
ok(dump.status === "received" && Number(dump.tasks_created) === 0 && !!dump.created_at, "a new dump row defaults to status 'received' and tasks_created 0");

// A second run must stop at the FIRST statement and leave everything alone: a
// repeated rebuild would copy the rows without created_by and blank it.
let ran = 0;
const again = throws(() => stmts.forEach((s) => { db.exec(s); ran++; }));
ok(again !== null && ran === 0, "a second run is refused at its first statement (" + again + ")");
ok(count(db) === beforeCount + 1, "after the refused second run every row is still there");
ok(db.prepare("SELECT created_by FROM tasks WHERE id = 't-null-after'").get().created_by === "Test", "after the refused second run created_by is intact");

console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
