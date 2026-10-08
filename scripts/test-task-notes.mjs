// Open a task: the note thread, the two status pills and the due date.
// The Worker routes are the REAL functions cut out of worker/index.js, run on
// an in-memory SQLite (scripts/fixtures/d1-shim.mjs). The pages are read as
// source. No network, no browser, nothing written.
//
//   node scripts/test-task-notes.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, workerSrc } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

// The tasks table as it is live, then the migration of this job.
const TASKS = `
CREATE TABLE tasks (id TEXT PRIMARY KEY, client_id TEXT, type TEXT NOT NULL, description TEXT NOT NULL, due_date TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), session_id TEXT, due_date_source TEXT, completed_by TEXT, updated_at TEXT, source TEXT, nota TEXT, created_by TEXT, assigned_to TEXT, completed_at TEXT, created_by_role TEXT, description_en TEXT, description_pt TEXT);
CREATE TABLE sessions (id TEXT PRIMARY KEY, date TEXT);
CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, role TEXT, display_name TEXT, avatar_url TEXT, client_id TEXT);
`;
const MIG = readFileSync(new URL("migrations/2026-10-07_task_notes.sql", root), "utf8") +
  // The translation columns of task_notes (2026-10-08). The tasks ones are in TASKS above.
  "\nALTER TABLE task_notes ADD COLUMN body_en TEXT;\nALTER TABLE task_notes ADD COLUMN body_pt TEXT;\n";

const USERS = {
  rafa:  { email: "rafa@x.test", role: "rafa", display_name: "Rafael", avatar_url: "avatars/rafa@x.test.png" },
  alice: { email: "b-second@x.test", role: "alice", display_name: "Pra. Alice", avatar_url: "avatars/b-second@x.test.jpg" },
  aliceNoPic: { email: "a-first@x.test", role: "alice", display_name: "", avatar_url: null },
  dev:   { email: "dev@x.test", role: "developer", display_name: "The Developer", avatar_url: "avatars/dev@x.test.png" },
  client: { email: null, role: "client", display_name: "Acme", avatar_url: null, client_id: "c-acme", login_role: "client", auth_method: "password" },
  seller: { email: null, role: "client", display_name: "Sam Seller", avatar_url: null, client_id: "c-acme", login_role: "seller", seller_name: "Sam Seller", auth_method: "password" }
};

const pushes = [];
let pushFail = false;

function world() {
  const d = makeDb([]);
  d.raw.exec(TASKS);
  d.raw.exec(MIG);
  const u = d.raw.prepare("INSERT INTO users (email, role, display_name, avatar_url) VALUES (?,?,?,?)");
  for (const k of ["rafa", "alice", "aliceNoPic", "dev"]) { u.run(USERS[k].email, USERS[k].role, USERS[k].display_name, USERS[k].avatar_url); }
  d.raw.prepare("INSERT INTO clients (id, name, status, archived) VALUES (?,?,?,?)").run("c-acme", "Acme Pools", "active", 0);
  const t = d.raw.prepare("INSERT INTO tasks (id, client_id, type, description, due_date, status, source, assigned_to, created_by_role, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  t.run("t-alice", "c-acme", "consultant", "Call the Acme accountant", "2026-10-12", "pending", "voice", "alice", "rafa", "2026-10-01 10:00:00");
  t.run("t-own", null, "consultant", "His own", null, "pending", "voice", null, "rafa", "2026-10-01 10:01:00");
  t.run("t-to-rafa", null, "consultant", "Alice gave him this", null, "pending", "voice", null, "alice", "2026-10-01 10:02:00");
  t.run("t-sys", null, "consultant", "Fix the report", null, "pending", "voice", "developer", "rafa", "2026-10-01 10:03:00");
  t.run("t-done", null, "consultant", "Already done", null, "done", "voice", "alice", "rafa", "2026-10-01 10:04:00");
  t.run("t-client", "c-acme", "client", "The client's own to-do", "2026-10-15", "pending", "session", null, null, "2026-10-01 10:05:00");
  return d;
}

// The functions under test, signed in as `who` (a key of USERS, or null).
function as(d, who) {
  const user = who ? USERS[who] : null;
  const stubs = Object.assign({}, baseStubs, {
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status || 400, error: en, error_pt: pt, error_en: en }, extra || {}),
    authenticate: async () => (user ? Object.assign({}, user) : null),
    // Task translation (2026-10-08): this file's tests are about other things, so
    // the model is unreachable here. A note or edit on a task that involves the
    // developer must then behave exactly as it did before: saved, no translation.
    // (scripts/test-task-translation.mjs is where translation itself is tested.)
    CLAUDE_API_URL: "https://claude.test/v1/messages", CLAUDE_MODEL: "test-model",
    fetch: async () => { throw new Error("no model in this test"); },
    console: { log() {}, error() {}, warn() {} },
    crypto: globalThis.crypto,
    pushToUsers: async (env, emails, payload) => { if (pushFail) { throw new Error("push down"); } pushes.push({ emails, payload }); }
  });
  const F = build(
    ["taskGivenByRole", "taskNoteRecipients", "taskNotePushText", "taskNoteNotify", "taskAssigneeAliceName", "taskAssigneeRafaName", "taskNoteView", "taskNotesTask",
     "taskInvolvesDeveloper", "taskTranslationColumn", "taskWordsForRole", "taskTranslatePrompt", "taskTranslate", "taskVoiceAskClaude",
     "handleGetTaskNotes", "handlePostTaskNote", "handlePatchTask", "handleGetAllTasks",
     "sessionSellerName", "clientRequestAllowed", "sellerRequestAllowed", "enforceClientRoleGate"],
    ["TASK_NOTE_MAX", "TASK_NOT_UNDONE_SQL", "TASK_TRANSLATE_TIMEOUT_MS", "TASK_TRANSLATION_MAX"], stubs);
  const env = { DB: d.DB };
  const req = (body) => ({ url: "https://x.test/", headers: { get: (k) => (k === "Authorization" ? "Bearer tok" : null) }, json: async () => body });
  return {
    F, env,
    list: (id) => F.handleGetTaskNotes(id, req({}), env),
    add: (id, body) => F.handlePostTaskNote(id, req(body), env),
    patch: (id, body) => F.handlePatchTask(id, req(body), env),
    all: () => F.handleGetAllTasks(req({}), env),
    gate: (path, method) => F.enforceClientRoleGate(req({}), env, path, method)
  };
}
const task = (d, id) => d.q("SELECT * FROM tasks WHERE id = ?", id)[0];
const notes = (d, id) => d.q("SELECT * FROM task_notes WHERE task_id = ? ORDER BY created_at, rowid", id);
const tick = () => new Promise((r) => setTimeout(r, 3));

// ── 1. The thread: oldest first, with the author's CURRENT name and picture ─
{
  const d = world();
  const empty = await as(d, "rafa").list("t-alice");
  ok(empty.status === 200 && Array.isArray(empty.data.notes) && empty.data.notes.length === 0, "a task with no notes answers 200 with an empty list");
  const tk = empty.data.task;
  ok(JSON.stringify(Object.keys(tk).sort()) === JSON.stringify(["assigned_to", "assignee_name", "client_id", "client_name", "created_by_role", "description", "description_en", "description_pt", "due_date", "giver_name", "id", "owner_name", "progress", "status"]), "GET notes: the task carries exactly its twelve fields and the two translation fields");
  ok(tk.client_id === "c-acme" && (await as(d, "rafa").list("t-own")).data.task.client_id === null && tk.id === "t-alice" && tk.description === "Call the Acme accountant" && tk.due_date === "2026-10-12" && tk.status === "pending" && tk.progress === null && tk.client_name === "Acme Pools", "GET notes: the task's words, due date, status, progress and client name");
  ok(tk.assigned_to === "alice" && tk.created_by_role === "rafa" && tk.assignee_name === "Pra. Alice" && tk.giver_name === "Rafael" && tk.owner_name === null, "GET notes: who has it (Alice) and who gave it (the consultant)");
  const back = (await as(d, "alice").list("t-to-rafa")).data.task;
  ok(back.assigned_to === null && back.owner_name === "Rafael" && back.giver_name === "Pra. Alice" && back.assignee_name === null, "GET notes: a task Alice gave the consultant names him as owner and her as giver");
  const sys = (await as(d, "rafa").list("t-sys")).data.task;
  ok(sys.assigned_to === "developer" && sys.assignee_name === null && sys.owner_name === null, "GET notes: a task for the system carries no person's name");

  const a1 = await as(d, "alice").add("t-alice", { body: "  Left a message.\nWill try again tomorrow.  " });
  await tick();
  const a2 = await as(d, "rafa").add("t-alice", { body: "Thanks. Ask for the 2025 return too." });
  await tick();
  const a3 = await as(d, "aliceNoPic").add("t-alice", { body: "Got it." });
  ok(a1.status === 200 && a2.status === 200 && a3.status === 200, "alice, the consultant and alice's second login can each add a note");
  ok(a1.data.note.body === "Left a message.\nWill try again tomorrow.", "the note is trimmed at the ends and keeps its line break");
  ok(JSON.stringify(Object.keys(a1.data.note).sort()) === JSON.stringify(["author_avatar_url", "author_name", "author_role", "body", "body_en", "body_pt", "created_at", "id"]), "POST answers with the new note in the same shape: six fields and the two translation fields");
  ok(a1.data.note.author_role === "alice" && a1.data.note.author_name === "Pra. Alice" && a1.data.note.author_avatar_url === "/api/users/b-second%40x.test/avatar-image", "POST: the new note carries her name and her picture's address (the route the site already serves pictures from)");
  ok("progress" in a1.data && a1.data.progress === null, "POST answers with the task's progress (none yet)");
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a1.data.note.created_at), "the note's time is a UTC moment: " + a1.data.note.created_at);
  const saved = notes(d, "t-alice");
  ok(saved.length === 3 && saved[0].author_email === "b-second@x.test" && saved[0].author_role === "alice" && saved[0].author_name === "Pra. Alice" && saved[0].task_id === "t-alice", "the row keeps the author's email, role and name");
  ok(saved[2].author_name === "Pra. Alice", "a login with no display name saves the role's name as the fallback, not an email: " + saved[2].author_name);

  const got = await as(d, "rafa").list("t-alice");
  ok(got.data.notes.length === 3 && got.data.notes.map((n) => n.body.slice(0, 6)).join("|") === "Left a|Thanks|Got it", "the thread is listed oldest first");
  ok(got.data.notes[1].author_name === "Rafael" && got.data.notes[1].author_avatar_url === "/api/users/rafa%40x.test/avatar-image", "the consultant's note carries his name and picture");
  ok(got.data.notes[2].author_avatar_url === null && got.data.notes[2].author_name === "Pra. Alice", "a login with no picture gets none (the page draws the initial), and the saved name is the fallback");
  ok(got.data.notes.every((n) => !("author_email" in n)), "no email is sent as a field of a note");

  // She changes her name and picture afterwards: old notes show the new ones.
  d.raw.prepare("UPDATE users SET display_name = ?, avatar_url = ? WHERE email = ?").run("Alice Souza", null, "b-second@x.test");
  d.raw.prepare("UPDATE users SET avatar_url = ? WHERE email = ?").run("avatars/a-first@x.test.png", "a-first@x.test");
  const later = await as(d, "rafa").list("t-alice");
  ok(later.data.notes[0].author_name === "Alice Souza" && later.data.notes[0].author_avatar_url === null, "the name and the picture are read from the users row when the thread is opened (new name, picture removed)");
  ok(later.data.notes[2].author_avatar_url === "/api/users/a-first%40x.test/avatar-image", "a picture added later shows on an old note");
  d.raw.prepare("DELETE FROM users WHERE email = ?").run("b-second@x.test");
  const gone = await as(d, "rafa").list("t-alice");
  ok(gone.data.notes[0].author_name === "Pra. Alice" && gone.data.notes[0].author_avatar_url === null, "an author whose users row is gone falls back to the name saved with the note");
}

// ── 2. The developer's note carries no name and no picture ──────────────────
{
  const d = world();
  const p = await as(d, "dev").add("t-sys", { body: "Fixed in tonight's release." });
  ok(p.status === 200 && p.data.note.author_role === "developer" && p.data.note.author_name === null && p.data.note.author_avatar_url === null, "POST by the developer: author_name null and author_avatar_url null");
  ok(notes(d, "t-sys")[0].author_name === null, "the developer's name is not saved with the note");
  const g = await as(d, "rafa").list("t-sys");
  ok(g.data.notes[0].author_role === "developer" && g.data.notes[0].author_name === null && g.data.notes[0].author_avatar_url === null, "GET: the developer's note has no name and no picture (the developer has both in users)");
  const all = await as(d, "rafa").all();
  ok(JSON.stringify(g.data).indexOf("The Developer") < 0 && JSON.stringify(p.data).indexOf("The Developer") < 0 && JSON.stringify(all.data).indexOf("The Developer") < 0, "the developer's name is in none of the three answers");
  ok(JSON.stringify(g.data).indexOf("dev@x.test") < 0 && JSON.stringify(all.data).indexOf("dev%40x.test") < 0, "nor is the developer's email or picture address");
}

// ── 3. An empty or over-long note is refused ────────────────────────────────
{
  const d = world();
  const h = as(d, "alice");
  for (const [label, body] of [["no body", {}], ["an empty note", { body: "" }], ["only spaces and line breaks", { body: "  \n \t " }], ["a null body", { body: null }]]) {
    const r = await h.add("t-alice", body);
    ok(r.status === 400 && !!r.error_pt && !!r.error_en, label + " is refused with a two-language message");
  }
  const max = "x".repeat(2000);
  const fits = await h.add("t-alice", { body: max });
  ok(fits.status === 200 && fits.data.note.body.length === 2000, "a note of exactly 2000 characters is saved");
  const long = await h.add("t-alice", { body: max + "y" });
  ok(long.status === 400 && /2000/.test(long.error_pt) && /2000/.test(long.error_en) && /longa/.test(long.error_pt) && /too long/.test(long.error_en), "2001 characters is refused in both languages: " + long.error_pt + " / " + long.error_en);
  ok(notes(d, "t-alice").length === 1, "nothing was saved for any refused note");
  ok((await h.add("no-such-task", { body: "x" })).status === 404 && (await h.list("no-such-task")).status === 404, "a task that does not exist answers 404 on both routes");
}

// ── 4. POST with progress: both are saved, or neither ───────────────────────
{
  const d = world();
  const h = as(d, "alice");
  let batches = 0;
  const realBatch = d.DB.batch;
  d.DB.batch = async (stmts) => { batches++; return realBatch(stmts); };
  const r = await h.add("t-alice", { body: "Waiting on their bank statement.", progress: "waiting_client" });
  ok(r.status === 200 && r.data.progress === "waiting_client" && task(d, "t-alice").progress === "waiting_client" && notes(d, "t-alice").length === 1, "a note with progress saves the note and the pill");
  ok(batches === 1, "they are written in ONE batch");
  const r2 = await h.add("t-alice", { body: "Statement arrived.", progress: null });
  ok(r2.status === 200 && r2.data.progress === null && task(d, "t-alice").progress === null, "progress null with a note clears the pill");
  await h.patch("t-alice", { progress: "working" });
  const r3 = await h.add("t-alice", { body: "No progress sent." });
  ok(r3.status === 200 && r3.data.progress === "working" && task(d, "t-alice").progress === "working", "a note with no progress leaves the pill as it was, and answers with it");
  const bad = await h.add("t-alice", { body: "x", progress: "blocked" });
  ok(bad.status === 400 && notes(d, "t-alice").length === 3, "an unknown progress value is refused and no note is saved");

  // The pill cannot be written: the note must not be saved either.
  d.raw.exec("CREATE TRIGGER no_progress BEFORE UPDATE OF progress ON tasks BEGIN SELECT RAISE(ABORT, 'progress write refused'); END;");
  const before = notes(d, "t-alice").length;
  const broken = await h.add("t-alice", { body: "This must not be saved.", progress: "waiting_client" });
  ok(broken.status === 500 && notes(d, "t-alice").length === before && task(d, "t-alice").progress === "working", "when the pill cannot be saved the note is not saved either (neither)");
  d.raw.exec("DROP TRIGGER no_progress");
  const doneNote = await h.add("t-done", { body: "For the record.", progress: "working" });
  ok(doneNote.status === 200 && doneNote.data.progress === null && task(d, "t-done").progress === null && notes(d, "t-done").length === 1, "a done task takes the note but no pill");
  ok(task(d, "t-alice").nota === null && d.log.every((s) => !/\bnota\b/.test(s)), "tasks.nota is never read or written");
}

// ── 5. PATCH with only { status }: exactly as before ────────────────────────
{
  const d = world();
  const h = as(d, "alice");
  const r = await h.patch("t-alice", { status: "done" });
  const row = task(d, "t-alice");
  ok(r.status === 200 && JSON.stringify(r.data) === JSON.stringify({ ok: true, status: "done" }), "the answer is exactly { ok: true, status } as before");
  ok(row.status === "done" && row.completed_by === "alice" && /^\d{4}-\d{2}-\d{2}T/.test(row.completed_at) && row.completed_at === row.updated_at, "done: status, completed_by, completed_at and updated_at are written as before");
  ok(row.due_date === "2026-10-12", "a { status } body does not touch the due date");
  const r2 = await h.patch("t-alice", { status: "pending" });
  const row2 = task(d, "t-alice");
  ok(r2.status === 200 && JSON.stringify(r2.data) === JSON.stringify({ ok: true, status: "pending" }) && row2.status === "pending" && row2.completed_by === null && row2.completed_at === null, "pending: completed_by and completed_at are cleared as before");
  ok(d.log.some((s) => s === "UPDATE tasks SET status = ?, completed_by = ?, completed_at = ?, updated_at = ? WHERE id = ?"), "re-opening is the very same statement as before");
  const none = await h.patch("t-alice", {});
  ok(none.status === 400 && none.error === "status is required", "a body with none of the three is refused with the same words as before");
  const badS = await h.patch("t-alice", { status: "archived" });
  ok(badS.status === 400 && badS.error === "status must be pending or done", "an unknown status is refused with the same words as before");
  ok((await h.patch("no-such-task", { status: "done" })).status === 404, "a missing task is 404 as before");
  ok((await as(d, null).patch("t-alice", { status: "done" })).status === 401, "no session is 401 as before");
  // A client's own to-do is still ticked by staff with { status }, as before.
  const c = await as(d, "rafa").patch("t-client", { status: "done" });
  ok(c.status === 200 && task(d, "t-client").status === "done" && task(d, "t-client").completed_by === "rafa", "a { status } body still works on a type 'client' task");
}

// ── 6. PATCH progress and due_date ──────────────────────────────────────────
{
  const d = world();
  const h = as(d, "rafa");
  const stamp0 = task(d, "t-alice").updated_at;
  const w = await h.patch("t-alice", { progress: "working" });
  ok(w.status === 200 && w.data.ok === true && w.data.progress === "working" && w.data.status === "pending" && w.data.due_date === "2026-10-12" && task(d, "t-alice").progress === "working", "progress 'working' alone is saved, and the answer carries status, progress and due_date");
  const wc = await h.patch("t-alice", { progress: "waiting_client" });
  ok(wc.data.progress === "waiting_client" && task(d, "t-alice").progress === "waiting_client", "progress 'waiting_client' replaces it (one or the other, never both)");
  const off = await h.patch("t-alice", { progress: null });
  ok(off.status === 200 && off.data.progress === null && task(d, "t-alice").progress === null, "progress null turns the pill off");
  ok(task(d, "t-alice").status === "pending" && task(d, "t-alice").completed_by === null && task(d, "t-alice").updated_at === stamp0, "a progress change does not touch status, completed_by or updated_at");
  for (const v of ["done", "", "WORKING", 1, true, ["working"]]) {
    const r = await h.patch("t-alice", { progress: v });
    ok(r.status === 400 && task(d, "t-alice").progress === null, "progress " + JSON.stringify(v) + " is refused");
  }

  const due = await h.patch("t-own", { due_date: "2026-11-03" });
  ok(due.status === 200 && due.data.due_date === "2026-11-03" && task(d, "t-own").due_date === "2026-11-03", "a due date alone is saved");
  const leap = await h.patch("t-own", { due_date: "2028-02-29" });
  ok(leap.status === 200 && task(d, "t-own").due_date === "2028-02-29", "a real leap day is accepted");
  for (const v of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "11/03/2026", "2026-1-3", "tomorrow", 20261103, "2026-11-03T10:00:00Z"]) {
    const r = await h.patch("t-own", { due_date: v });
    ok(r.status === 400 && task(d, "t-own").due_date === "2028-02-29", "due_date " + JSON.stringify(v) + " is refused");
  }
  const clear = await h.patch("t-own", { due_date: null });
  ok(clear.status === 200 && clear.data.due_date === null && task(d, "t-own").due_date === null, "due_date null clears it");

  const both = await h.patch("t-own", { progress: "working", due_date: "2026-12-01" });
  ok(both.status === 200 && both.data.progress === "working" && both.data.due_date === "2026-12-01", "progress and due_date together are saved together");
  const three = await h.patch("t-own", { status: "pending", progress: "waiting_client", due_date: "2026-12-02" });
  const row = task(d, "t-own");
  ok(three.status === 200 && row.status === "pending" && row.progress === "waiting_client" && row.due_date === "2026-12-02" && three.data.status === "pending", "all three together are saved in one statement");
  ok(d.log.filter((s) => /^UPDATE tasks SET/.test(s)).every((s) => (s.match(/UPDATE/g) || []).length === 1), "every PATCH is one UPDATE");
  for (const who of ["alice", "aliceNoPic", "dev"]) {
    const r = await as(d, who).patch("t-own", { progress: "working" });
    ok(r.status === 200, "role " + USERS[who].role + " may set the pill on a task they can see");
  }
}

// ── 7. Marking done clears progress; reopening leaves it empty ──────────────
{
  const d = world();
  const h = as(d, "alice");
  await h.patch("t-alice", { progress: "waiting_client" });
  const n = d.log.length;
  const done = await h.patch("t-alice", { status: "done" });
  const sql = d.log.slice(n).filter((s) => /^UPDATE tasks/.test(s));
  ok(done.status === 200 && task(d, "t-alice").status === "done" && task(d, "t-alice").progress === null, "marking a task done empties its pill");
  ok(sql.length === 1 && sql[0] === "UPDATE tasks SET status = ?, completed_by = ?, completed_at = ?, updated_at = ?, progress = NULL WHERE id = ?", "in the same statement as the status: " + sql[0]);
  const reopen = await h.patch("t-alice", { status: "pending" });
  ok(reopen.status === 200 && task(d, "t-alice").status === "pending" && task(d, "t-alice").progress === null, "re-opening leaves the pill empty");
  const both = await h.patch("t-alice", { status: "done", progress: "working" });
  ok(both.status === 200 && both.data.progress === null && task(d, "t-alice").progress === null, "done and a pill in one body: done wins, no pill");
  const late = await h.patch("t-alice", { progress: "working" });
  ok(late.status === 200 && late.data.progress === null && task(d, "t-alice").progress === null && task(d, "t-alice").status === "done", "a pill sent for a done task is saved as empty");
  const dueOnDone = await h.patch("t-alice", { due_date: "2026-10-20" });
  ok(dueOnDone.status === 200 && task(d, "t-alice").due_date === "2026-10-20" && task(d, "t-alice").status === "done", "the due date of a done task can still be changed, and it stays done");
}

// ── 8. A type 'client' task is refused on every new path ────────────────────
{
  const d = world();
  const before = JSON.stringify(task(d, "t-client"));
  for (const who of ["rafa", "alice", "dev"]) {
    const h = as(d, who);
    const g = await h.list("t-client");
    const p = await h.add("t-client", { body: "A note on the client's to-do", progress: "working" });
    const pp = await h.patch("t-client", { progress: "working" });
    const pd = await h.patch("t-client", { due_date: "2026-12-01" });
    const pc = await h.patch("t-client", { due_date: null });
    const ps = await h.patch("t-client", { status: "done", progress: "waiting_client" });
    ok([g, p, pp, pd, pc, ps].every((r) => r.status === 400 && !r.data), USERS[who].role + ": GET notes, POST note, PATCH progress, PATCH due_date and PATCH status+progress all refuse a 'client' task");
  }
  ok(JSON.stringify(task(d, "t-client")) === before && notes(d, "t-client").length === 0, "the client's task is untouched and has no notes");
  // A note that somehow sat on a client task still never goes out in the list.
  d.raw.prepare("INSERT INTO task_notes (id, task_id, body, author_email, author_role, author_name, created_at) VALUES (?,?,?,?,?,?,?)").run("n-stray", "t-client", "stray", "rafa@x.test", "rafa", "Rafael", "2026-10-07T12:00:00.000Z");
  d.raw.prepare("UPDATE tasks SET progress = 'working' WHERE id = 't-client'").run();
  const all = await as(d, "rafa").all();
  const c = all.data.tasks.find((t) => t.id === "t-client");
  ok(!!c && !("progress" in c) && !("note_count" in c) && !("last_note" in c), "GET /api/tasks: a 'client' task carries no progress, no note_count and no last_note");
}

// ── 9. A client session and a seller session are refused ────────────────────
{
  const d = world();
  await as(d, "rafa").add("t-alice", { body: "Staff words." });
  const PATHS = [["/api/tasks/t-alice/notes", "GET"], ["/api/tasks/t-alice/notes", "POST"], ["/api/tasks/t-alice", "PATCH"], ["/api/tasks", "GET"]];
  for (const who of ["client", "seller"]) {
    const h = as(d, who);
    // The central gate, which runs before any route.
    for (const [path, method] of PATHS) {
      const r = await h.gate(path, method);
      ok(!!r && r.status === 403, who + " session: the central gate refuses " + method + " " + path);
    }
    // And each handler on its own, should the gate ever be bypassed.
    const g = await h.list("t-alice");
    const p = await h.add("t-alice", { body: "from outside", progress: "working" });
    const pa = await h.patch("t-alice", { progress: "working" });
    const pd = await h.patch("t-alice", { due_date: "2026-12-01" });
    const all = await h.all();
    ok([g, p, pa, pd, all].every((r) => r.status === 403 && !r.data), who + " session: every handler answers 403 by itself");
  }
  const h0 = as(d, "client");
  ok(!h0.F.clientRequestAllowed("/api/tasks/t-alice/notes", "GET", "c-acme") && !h0.F.clientRequestAllowed("/api/tasks/t-alice/notes", "POST", "c-acme") && !h0.F.clientRequestAllowed("/api/tasks/t-alice", "PATCH", "c-acme"), "the client allowlist has none of the three paths");
  ok(!h0.F.sellerRequestAllowed("/api/tasks/t-alice/notes", "GET", "c-acme") && !h0.F.sellerRequestAllowed("/api/tasks/t-alice/notes", "POST", "c-acme") && !h0.F.sellerRequestAllowed("/api/tasks/t-alice", "PATCH", "c-acme"), "the salesperson allowlist has none of the three paths");
  ok(h0.F.clientRequestAllowed("/api/clients/c-acme/tasks", "GET", "c-acme") === true, "(the client's own task list is still allowed, as before)");
  ok(!h0.F.clientRequestAllowed("/api/clients/c-acme/tasks/t-alice/notes", "GET", "c-acme"), "no notes path exists under the client's own address either");
  ok(notes(d, "t-alice").length === 1 && task(d, "t-alice").progress === null && task(d, "t-alice").due_date === "2026-10-12", "nothing was written by either session");
  const anon = as(d, null);
  ok((await anon.list("t-alice")).status === 401 && (await anon.add("t-alice", { body: "x" })).status === 401, "no session at all is 401 on both notes routes");
  ok((await as(d, "rafa").gate("/api/tasks/t-alice/notes", "GET")) === null, "(a staff session passes the gate)");
  // The portal's task list (GET /api/clients/:id/tasks) must not carry any of it.
  const i = workerSrc.indexOf("\nasync function handleGetClientTasks(");
  const clientTasksSrc = workerSrc.slice(i, workerSrc.indexOf("\n}", i + 1));
  ok(i > 0 && !/progress|task_notes|note_count|last_note/.test(clientTasksSrc), "the client's own task list route reads no progress and no notes");
  ok(/segs\[3\] === "notes" && !segs\[4\] && method === "GET"\) \{\s*return handleGetTaskNotes\(segs\[2\], request, env\);/.test(workerSrc) && /segs\[3\] === "notes" && !segs\[4\] && method === "POST"\) \{\s*return handlePostTaskNote\(segs\[2\], request, env\);/.test(workerSrc), "the router sends GET and POST /api/tasks/:id/notes to the two handlers");
  ok(workerSrc.indexOf("return handleGetTaskNotes(") < workerSrc.indexOf("return handlePatchTask(") && workerSrc.indexOf("enforceClientRoleGate(request, env, path, method)") > 0, "the notes routes sit in the same router the central gate guards");
}

// ── 10. GET /api/tasks: progress, note_count, last_note, ONE extra query ────
{
  const d = world();
  const h = as(d, "rafa");
  const q0 = d.log.length;
  const none = await h.all();
  const queriesEmpty = d.log.length - q0;
  const by0 = {}; none.data.tasks.forEach((t) => { by0[t.id] = t; });
  ok(none.status === 200 && by0["t-alice"].progress === null && by0["t-alice"].note_count === 0 && by0["t-alice"].last_note === null, "a staff task with no notes: progress null, note_count 0, last_note null");

  await as(d, "alice").add("t-alice", { body: "First.", progress: "working" });
  await tick();
  await as(d, "rafa").add("t-alice", { body: "Second." });
  await tick();
  const longBody = "L".repeat(139) + "MN" + "tail".repeat(20);
  await as(d, "alice").add("t-alice", { body: longBody });
  await as(d, "dev").add("t-sys", { body: "Shipped." });
  await as(d, "rafa").add("t-own", { body: "Only one." });
  // Many more tasks, each with notes: the number of queries must not grow.
  const ins = d.raw.prepare("INSERT INTO tasks (id, type, description, status, source, created_at) VALUES (?,?,?,?,?,?)");
  const insN = d.raw.prepare("INSERT INTO task_notes (id, task_id, body, author_email, author_role, author_name, created_at) VALUES (?,?,?,?,?,?,?)");
  for (let k = 0; k < 40; k++) {
    ins.run("bulk-" + k, "consultant", "Bulk " + k, "pending", "manual", "2026-10-02 10:00:00");
    insN.run("bn-" + k + "-a", "bulk-" + k, "older", "rafa@x.test", "rafa", "Rafael", "2026-10-07T12:00:00.000Z");
    insN.run("bn-" + k + "-b", "bulk-" + k, "newer " + k, "rafa@x.test", "rafa", "Rafael", "2026-10-07T12:00:00.000Z");
  }
  const q1 = d.log.length;
  const all = await h.all();
  const sqls = d.log.slice(q1);
  const by = {}; all.data.tasks.forEach((t) => { by[t.id] = t; });
  ok(sqls.filter((s) => /task_notes/.test(s)).length === 1, "the notes of the whole list are read in ONE query (" + sqls.filter((s) => /task_notes/.test(s)).length + ")");
  ok(sqls.length === queriesEmpty, "46 tasks with notes cost the same number of queries as 6 tasks with none (" + sqls.length + " and " + queriesEmpty + ")");
  ok(by["t-alice"].progress === "working" && by["t-alice"].note_count === 3, "the task carries its progress and its note count (3)");
  const ln = by["t-alice"].last_note;
  ok(JSON.stringify(Object.keys(ln).sort()) === JSON.stringify(["author_name", "author_role", "body", "body_en", "body_pt", "created_at"]), "last_note has exactly body, body_en, body_pt, author_role, author_name, created_at");
  ok(ln.body.length === 140 && ln.body === longBody.slice(0, 140) && ln.author_role === "alice" && ln.author_name === "Pra. Alice", "last_note is the NEWEST note, its first 140 characters, with the author's current name");
  ok(by["t-sys"].note_count === 1 && by["t-sys"].last_note.author_role === "developer" && by["t-sys"].last_note.author_name === null && by["t-sys"].last_note.body === "Shipped.", "a developer's last note carries no name");
  ok(by["t-own"].note_count === 1 && by["t-own"].last_note.author_name === "Rafael", "one note: count 1 and its author");
  ok(by["bulk-7"].note_count === 2 && by["bulk-7"].last_note.body === "newer 7", "two notes saved in the same instant: the later one is the last note");
  ok(by["t-done"].progress === null && by["t-done"].note_count === 0, "a done staff task still carries the three fields");
  ok(all.data.tasks.filter((t) => t.type === "consultant").every((t) => "progress" in t && "note_count" in t && "last_note" in t), "every staff task carries progress, note_count and last_note");
  ok(all.data.tasks.every((t) => "assignee_name" in t && "giver_name" in t && "owner_name" in t && "completed_at" in t), "and everything GET /api/tasks returned before is still there");
  ok(JSON.stringify(all.data).indexOf("@x.test") < 0, "no email is in the list");
}

// ── 11. The migration file ──────────────────────────────────────────────────
{
  ok(/CREATE TABLE IF NOT EXISTS task_notes \(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL, author_email TEXT, author_role TEXT NOT NULL, author_name TEXT, created_at TEXT NOT NULL DEFAULT \(datetime\('now'\)\)\);/.test(MIG), "the migration creates task_notes as it is live (IF NOT EXISTS)");
  ok(/CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes \(task_id, created_at\);/.test(MIG), "and its index (IF NOT EXISTS)");
  ok(/ALTER TABLE tasks ADD COLUMN progress TEXT;/.test(MIG), "and tasks.progress");
  ok(!/\b(DROP|DELETE|UPDATE)\b/i.test(MIG.replace(/^\s*--[^\n]*$/gm, "")), "it only adds: no DROP, DELETE or UPDATE");
}

// ── 12. The pages ───────────────────────────────────────────────────────────
{
  const read = (p) => readFileSync(new URL(p, root), "utf8");
  const sheet = read("task-sheet.js");
  ok(sheet === read("ios/App/App/public/task-sheet.js"), "task-sheet.js: the root and iOS copies are the same file");
  let parses = true;
  try { new Function(sheet); } catch (e) { parses = false; console.log("      task-sheet.js: " + e.message); }
  ok(parses, "task-sheet.js parses");
  const code = sheet.replace(/^\s*\/\/[^\n]*$/gm, "");
  ok(!/(^|[^A-Za-z0-9_.$])(window\.)?(confirm|alert|prompt)\s*\(/m.test(code), "task-sheet.js: no confirm(), alert() or prompt()");
  ok(!/=>/.test(code) && !/\b(const|let)\s/.test(code), "task-sheet.js: var and regular functions only (no arrow functions, no const or let)");
  ok(!/[^\x00-\x7F]/.test(sheet), "task-sheet.js: plain ASCII only");
  const IDS = ["taskSheet", "taskSheetTitle", "taskSheetClose", "taskSheetMeta", "taskSheetPills", "taskSheetPillWorking", "taskSheetPillWaiting",
    "taskSheetDue", "taskSheetDueShown", "taskSheetDueClear", "taskSheetStatus", "taskSheetThread", "taskSheetNoteBox", "taskSheetAdd"];
  for (const id of IDS) {
    const made = sheet.split('.id = "' + id + '"').length - 1 + (id.indexOf("Pill") > 0 && id !== "taskSheetPills" ? sheet.split('"' + id + '"]').length - 1 : 0);
    ok(made === 1, 'the sheet\'s id "' + id + '" is given to one element, once (' + made + ")");
  }
  for (const [pt, en] of [["Em andamento", "Working on it"], ["Aguardando cliente", "Waiting on client"], ["Nenhuma nota ainda.", "No notes yet."],
    ["Adicionar nota", "Add note"], ["remover", "clear"], ["Sistema", "System"], ["Prazo", "Due date"], ["Fechar", "Close"], ["Salvo.", "Saved."]]) {
    ok(sheet.indexOf('"' + pt + '"') > 0 && sheet.indexOf('"' + en + '"') > 0, 'label in both languages: "' + pt + '" / "' + en + '"');
  }
  ok(/" notas", n \+ " notes"/.test(sheet), 'the count reads "3 notas" / "3 notes"');
  ok(/n > 1 \?/.test(sheet), "the count shows only when there is more than one note");
  ok(sheet.indexOf("formatDateTimeUTC(note.created_at)") > 0 && sheet.indexOf("formatDate(s.dueDate)") > 0, "times and dates are printed by the site's own formatters (datetime.js)");
  ok(!/keydown[\s\S]{0,200}taskSheetAddNote/.test(sheet) && sheet.indexOf('addBtn.addEventListener("click", taskSheetAddNote)') > 0, "only the button adds a note: no key sends it");
  ok(/s\.sending = true;\s*btn\.disabled = true;/.test(sheet), "the button is off while a note is being sent");
  ok(/white-space: pre-wrap/.test(sheet) && /var mine = taskSheetNoteWords\(note\);\s+text\.textContent = mine;/.test(sheet) && sheet.indexOf("text.innerHTML") < 0, "a note's words are written as text with line breaks kept");
  ok(sheet.indexOf('e.key === "Enter"') > 0 && sheet.indexOf('el.setAttribute("tabindex", "0")') > 0 && /\.task-sheet-open \{ cursor: pointer/.test(sheet) && /\.task-sheet-open:focus-visible \{ outline/.test(sheet), "the row's words: pointer, focus ring, reachable by keyboard, Enter opens");

  // What the row prints, run for real against a stand-in document.
  const mkEl = () => ({ className: "", innerHTML: "", textContent: "", setAttribute() {}, classList: { add() {} }, addEventListener() {} });
  const doc = { getElementById: () => ({}), createElement: mkEl, body: { classList: { contains: () => false } }, head: { appendChild() {} } };
  const S = new Function("document", "window", sheet + "\nreturn { taskSheetRowPill, taskSheetRowNote, taskSheetAuthorHtml, taskSheetEsc };")(doc, {});
  ok(S.taskSheetRowPill(null, "x") === null && S.taskSheetRowPill("done", "x") === null, "no pill on a row whose task has no progress");
  const pw = S.taskSheetRowPill("working", "mt-due");
  const pc = S.taskSheetRowPill("waiting_client", "task-due");
  ok(pw.className === "mt-due" && pw.innerHTML === '<span class="show-pt">Em andamento</span><span class="show-en">Working on it</span>', "the row pill for 'working' uses the page's pill class and both languages");
  ok(pc.className === "task-due" && pc.innerHTML === '<span class="show-pt">Aguardando cliente</span><span class="show-en">Waiting on client</span>', "the row pill for 'waiting_client'");
  ok(S.taskSheetRowNote(null, 0) === null, "no note line on a row whose task has no notes");
  const one = S.taskSheetRowNote({ body: "Left a\nmessage <b>", author_role: "alice", author_name: "Pra. Alice" }, 1);
  ok(one.innerHTML === "Pra. Alice: Left a message &lt;b&gt;", "one note: \"<name>: <words>\", escaped, on one line, no count: " + one.innerHTML);
  const many = S.taskSheetRowNote({ body: "w".repeat(200), author_role: "rafa", author_name: "Rafael" }, 3);
  ok(many.innerHTML === "Rafael: " + "w".repeat(90) + "… · " + '<span class="show-pt">3 notas</span><span class="show-en">3 notes</span>', "a long note is cut with an ellipsis and three notes show the count");
  const sysLine = S.taskSheetRowNote({ body: "Shipped.", author_role: "developer", author_name: "The Developer" }, 2);
  ok(sysLine.innerHTML.indexOf("The Developer") < 0 && sysLine.innerHTML.indexOf('<span class="show-pt">Sistema</span><span class="show-en">System</span>: Shipped.') === 0, "a developer's note reads Sistema / System even if a name were sent");

  for (const name of ["dashboard.html", "tasks.html"]) {
    const page = read(name);
    const ios = read("ios/App/App/public/" + name);
    ok(page === ios, name + ": the root and iOS copies carry the same edits (same file)");
    ok(page.split('src="task-sheet.js').length === 2 && /<script src="task-sheet\.js\?v=\d+"><\/script>/.test(page), name + " loads task-sheet.js once, with a ?v= stamp");
    ok(page.indexOf('src="datetime.js"') < page.indexOf('src="task-sheet.js'), name + " loads datetime.js (the formatters) before it");
    let n = 0, bad = 0;
    for (const m of page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) { n++; try { new Function(m[1]); } catch (e) { bad++; console.log("      " + name + " inline script " + n + ": " + e.message); } }
    ok(n > 0 && bad === 0, name + ": all " + n + " inline scripts parse");
    const js = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n").replace(/^\s*\/\/[^\n]*$/gm, "");
    ok(!/(^|[^A-Za-z0-9_.$])(window\.)?(confirm|alert|prompt)\s*\(/m.test(js), name + ": no confirm(), alert() or prompt()");
    ok(IDS.every((id) => page.indexOf('"' + id + '"') < 0), name + ": none of the sheet's ids is repeated in the page");
    ok(page.split("taskSheetOpen({").length === 2, name + " opens the sheet from one place");
    ok(page.split("taskSheetMakeOpener(").length === 2 && page.split("taskSheetRowPill(").length === 2 && page.split("taskSheetRowNote(").length === 2, name + ": the row's opener, pill and note line are each wired once (in the one row builder)");
  }
  const dash = read("dashboard.html");
  const tasksPage = read("tasks.html");
  ok(/var isStaff = t\.type === "consultant";/.test(dash) && /var isStaff = task\.type === "rafa";/.test(tasksPage), "both row builders open the sheet for staff tasks only (the Tasks page calls type 'consultant' \"rafa\")");
  ok(/type:\s+r\.type === "consultant" \? "rafa" : "client"/.test(tasksPage), "(tasks.html maps 'consultant' to \"rafa\" and everything else to \"client\")");
  ok(/progress:\s+r\.progress \|\| null,\s+noteCount:\s+r\.note_count \|\| 0,\s+lastNote:\s+r\.last_note \|\| null/.test(tasksPage), "tasks.html keeps progress, note_count and last_note from GET /api/tasks");
  const hook = read("scripts/pre-commit");
  ok(/VERSIONED_ASSETS="[^"]*\btask-sheet\.js\b[^"]*"/.test(hook), "scripts/pre-commit stamps task-sheet.js (VERSIONED_ASSETS)");
  const others = ["client.html", "portal.html"].filter((p) => /task-sheet|taskSheet|task_notes|last_note|note_count/.test(read(p)));
  ok(others.length === 0, "client.html and portal.html carry nothing of the sheet");
}

// ── 13. The sheet itself, run against a stand-in page ───────────────────────
// No browser here: a small stand-in for the document, enough to press the
// sheet's buttons and read what it sends and what it shows.
{
  const sheet = readFileSync(new URL("task-sheet.js", root), "utf8");
  const dt = readFileSync(new URL("datetime.js", root), "utf8");
  class El {
    constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.on = {}; this.className = ""; this.id = ""; this.hidden = false; this.disabled = false; this.value = ""; this._html = ""; this._text = ""; this.parentNode = null; this.style = {}; this.offsetParent = {}; this.scrollTop = 0; this.scrollHeight = 500; this.classList = { add: (c) => { this.className += " " + c; } }; }
    set innerHTML(v) { this._html = String(v); this._text = ""; this.children.forEach((c) => { c.parentNode = null; }); this.children = []; }
    get innerHTML() { return this._html; }
    set textContent(v) { this._text = String(v); this._html = ""; this.children = []; }
    get textContent() { return this._text; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
    replaceChild(n, o) { this.children = this.children.map((x) => (x === o ? n : x)); n.parentNode = this; o.parentNode = null; }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
    contains(x) { for (let n = x; n; n = n.parentNode) { if (n === this) { return true; } } return false; }
    querySelectorAll() { return []; }
    focus() { doc.activeElement = this; }
    fire(type, ev) { (this.on[type] || []).forEach((f) => f(Object.assign({ target: this, preventDefault() {}, stopPropagation() {} }, ev || {}))); }
    all(out) { out = out || []; this.children.forEach((c) => { out.push(c); c.all(out); }); return out; }
    // Everything a person would read in this element.
    get words() { return (this._text || this._html) + this.children.map((c) => c.words).join(" "); }
  }
  const doc = { body: new El("body"), head: new El("head"), activeElement: null, keys: [],
    createElement: (t) => new El(t),
    getElementById: (id) => doc.body.all().concat(doc.head.all()).find((e) => e.id === id) || null,
    querySelectorAll: () => doc.body.all().filter((e) => "data-task-open" in e.attrs),
    addEventListener: (t, f) => { doc.keys.push(f); }, removeEventListener: (t, f) => { doc.keys = doc.keys.filter((x) => x !== f); } };
  doc.body.classList.contains = () => false;
  const calls = [];
  let answer = () => ({ ok: true, data: {} });
  const fetchStub = async (url, opts) => {
    const call = { url, method: opts.method, auth: opts.headers.Authorization, body: opts.body ? JSON.parse(opts.body) : null };
    calls.push(call);
    const a = answer(call);
    return { ok: a.ok, json: async () => { if (a.notJson) { throw new Error("not json"); } return a.data; } };
  };
  const S = new Function("document", "window", "fetch", dt + "\n" + sheet +
    "\nreturn { taskSheetOpen, taskSheetClose, taskSheetMakeOpener, state: function() { return taskSheetNow; } };")(doc, {}, fetchStub);
  const settle = async () => { for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 0)); } };
  const $ = (id) => doc.getElementById(id);
  const NOTE1 = { id: "n1", body: "Left a message.\nWill call again.", author_role: "alice", author_name: "Pra. Alice", author_avatar_url: "/api/users/a%40x.test/avatar-image", created_at: "2026-10-07T16:05:00.000Z" };
  const NOTE2 = { id: "n2", body: "Shipped.", author_role: "developer", author_name: null, author_avatar_url: null, created_at: "2026-10-07 20:30:00" };
  const serverTask = { id: "t1", description: "Call the accountant", due_date: "2026-10-12", status: "pending", progress: "working" };
  const changes = [];
  let closed = 0;
  const open = (o) => S.taskSheetOpen(Object.assign({ id: "t1", description: "Call the accountant", clientName: "Acme Pools",
    tags: ['<span class="show-pt">De Rafael</span><span class="show-en">From Rafael</span>'], done: false, progress: null, dueDate: null,
    apiBase: "https://api.test", getToken: async () => "tok-1", onChange: (c) => changes.push(c), onClose: () => { closed++; } }, o || {}));

  // A row's words that open it, so focus has somewhere to go back to.
  const rowWords = new El("div");
  doc.body.appendChild(rowWords);
  let opened = 0;
  S.taskSheetMakeOpener(rowWords, "t1", () => { opened++; });
  rowWords.fire("click");
  rowWords.fire("keydown", { key: "Enter" });
  rowWords.fire("keydown", { key: "a" });
  ok(opened === 2 && rowWords.attrs.tabindex === "0" && rowWords.attrs.role === "button" && /task-sheet-open/.test(rowWords.className), "the row's words open on a click and on Enter, not on another key, and can take focus");

  answer = () => ({ ok: true, data: { task: serverTask, notes: [NOTE1, NOTE2] } });
  ok(open() === true && !!$("taskSheet") && $("taskSheet").attrs.role === "dialog" && $("taskSheet").attrs["aria-modal"] === "true", "opening draws one in-page dialog");
  ok(open() === false && doc.body.all().filter((e) => e.id === "taskSheet").length === 1, "a second open while one is showing does nothing");
  ok(/Carregando/.test($("taskSheetThread").words), "the thread says it is loading until it arrives");
  await settle();
  ok(calls.length === 1 && calls[0].url === "https://api.test/api/tasks/t1/notes" && calls[0].method === "GET" && calls[0].auth === "Bearer tok-1", "it reads GET /api/tasks/:id/notes with the signed-in user's token");
  ok($("taskSheetTitle").textContent === "Call the accountant" && /Acme Pools/.test($("taskSheetMeta").words) && /De Rafael/.test($("taskSheetMeta").words), "the top shows the task's words, the client and the row's tag");
  const thread = $("taskSheetThread");
  ok(thread.children.length === 2 && /Pra\. Alice/.test(thread.children[0].words) && /10\/07\/2026 12:05 PM/.test(thread.children[0].words), "a note shows its author and the time as MM/DD/YYYY h:mm AM/PM in New York: " + thread.children[0].words.replace(/\n/g, " "));
  ok(/10\/07\/2026 4:30 PM/.test(thread.children[1].words) && /Sistema<\/span><span class="show-en">System/.test(thread.children[1].words), "a developer's note reads Sistema / System, and a bare database time is read as UTC (4:30 PM)");
  const textEl = thread.children[0].all().find((e) => e.className === "task-sheet-notetext");
  ok(textEl.textContent === "Left a message.\nWill call again.", "the note's words are set as text, line break kept");
  const av1 = thread.children[0].children[0];
  const av2 = thread.children[1].children[0];
  ok(av1.tagName === "img" && av1.src === "https://api.test/api/users/a%40x.test/avatar-image" && av1.width === 24, "her picture is a 24px image from the site's picture route");
  ok(av2.tagName === "span" && /is-system/.test(av2.className) && av2.textContent === "S", "the system gets a neutral mark, no picture");
  av1.onerror();
  const mark = thread.children[0].children[0];
  ok(mark.tagName === "span" && mark.textContent === "P", "a picture that does not load becomes the neutral initial mark");
  ok(thread.scrollTop === thread.scrollHeight, "the thread is scrolled to the newest note");
  ok($("taskSheetPillWorking").attrs["aria-pressed"] === "true" && $("taskSheetPillWaiting").attrs["aria-pressed"] === "false" && $("taskSheetDue").value === "2026-10-12" && $("taskSheetDueShown").textContent === "10/12/2026", "the pill and the due date are the SAVED ones from the server (due shown as 10/12/2026)");
  ok(changes.length === 1 && changes[0].progress === "working" && changes[0].due_date === "2026-10-12" && changes[0].note_count === 2 && changes[0].last_note.body === "Shipped." && changes[0].last_note.author_name === null, "the page is told what the row should show (pill, due date, 2 notes, the newest)");

  // Pills: one on, the other off; the lit one turns off; a failed save is put back.
  calls.length = 0;
  answer = (c) => ({ ok: true, data: { ok: true, status: "pending", progress: c.body.progress, due_date: "2026-10-12" } });
  $("taskSheetPillWaiting").fire("click");
  ok($("taskSheetPillWaiting").attrs["aria-pressed"] === "true" && $("taskSheetPillWorking").attrs["aria-pressed"] === "false" && $("taskSheetPillWaiting").disabled === true, "one click lights 'waiting on client' and turns 'working' off at once");
  await settle();
  ok(calls.length === 1 && calls[0].method === "PATCH" && calls[0].url === "https://api.test/api/tasks/t1" && JSON.stringify(calls[0].body) === '{"progress":"waiting_client"}', "it is saved at once: PATCH { progress: \"waiting_client\" } and nothing else");
  ok(/Salvo\./.test($("taskSheetStatus").words) && /Saved\./.test($("taskSheetStatus").words) && $("taskSheetPillWaiting").disabled === false, "it says Salvo. / Saved.");
  $("taskSheetPillWaiting").fire("click");
  await settle();
  ok(JSON.stringify(calls[1].body) === '{"progress":null}' && $("taskSheetPillWaiting").attrs["aria-pressed"] === "false" && $("taskSheetPillWorking").attrs["aria-pressed"] === "false", "a click on the lit pill turns it off (PATCH { progress: null })");
  answer = () => ({ ok: false, data: { error: "boom" } });
  $("taskSheetPillWorking").fire("click");
  ok($("taskSheetPillWorking").attrs["aria-pressed"] === "true", "(lit while the save is on its way)");
  await settle();
  ok($("taskSheetPillWorking").attrs["aria-pressed"] === "false" && /is-error/.test($("taskSheetStatus").className) && /Could not save\. Please try again\./.test($("taskSheetStatus").words) && /consegui salvar/.test($("taskSheetStatus").words), "a failed save puts the pill back and says so in both languages");
  ok(changes[changes.length - 1].progress === null, "and the page is not told of a pill that was not saved");

  // Due date.
  calls.length = 0;
  answer = (c) => ({ ok: true, data: { ok: true, status: "pending", progress: null, due_date: c.body.due_date } });
  $("taskSheetDue").value = "2026-11-03";
  $("taskSheetDue").fire("change");
  await settle();
  ok(JSON.stringify(calls[0].body) === '{"due_date":"2026-11-03"}' && $("taskSheetDueShown").textContent === "11/03/2026" && $("taskSheetDueClear").hidden === false && changes[changes.length - 1].due_date === "2026-11-03", "changing the date saves it at once and prints it as 11/03/2026");
  $("taskSheetDueClear").fire("click");
  await settle();
  ok(JSON.stringify(calls[1].body) === '{"due_date":null}' && $("taskSheetDue").value === "" && $("taskSheetDueShown").textContent === "" && $("taskSheetDueClear").hidden === true && changes[changes.length - 1].due_date === null, "\"remover\" / \"clear\" empties it (PATCH { due_date: null }) and then hides itself");
  answer = () => ({ ok: false, data: { error: "x", error_pt: "Data inválida.", error_en: "That is not a valid date." } });
  $("taskSheetDue").value = "2026-12-01";
  $("taskSheetDue").fire("change");
  await settle();
  ok($("taskSheetDue").value === "" && /That is not a valid date\./.test($("taskSheetStatus").words) && /Data inv/.test($("taskSheetStatus").words), "a refused date is put back and the Worker's two-language words are shown");

  // Notes.
  calls.length = 0;
  const box = $("taskSheetNoteBox");
  const add = $("taskSheetAdd");
  ok(box.tagName === "textarea" && !box.on.keydown && !box.on.keypress && !box.on.keyup, "the text box listens to no key: Enter is a new line, never a send");
  box.value = "   ";
  add.fire("click");
  await settle();
  ok(calls.length === 0 && /Escreva a nota antes de adicionar\./.test($("taskSheetStatus").words) && /Write the note before adding it\./.test($("taskSheetStatus").words), "an empty note is not sent, and a plain message says why");
  answer = () => ({ ok: false, data: { error: "down" } });
  box.value = "First line\nSecond line";
  add.fire("click");
  ok(add.disabled === true, "the button is off while the note is being sent");
  add.fire("click");
  await settle();
  ok(calls.length === 1, "a second press while sending does not send twice");
  ok(add.disabled === false && box.value === "First line\nSecond line" && /Could not add the note\. Please try again\./.test($("taskSheetStatus").words) && thread.children.length === 2, "on failure the words stay in the box, a plain message shows and the button is back");
  const NOTE3 = { id: "n3", body: "First line\nSecond line", author_role: "rafa", author_name: "Rafael", author_avatar_url: null, created_at: "2026-10-07T21:00:00.000Z" };
  answer = () => ({ ok: true, data: { ok: true, progress: null, note: NOTE3 } });
  add.fire("click");
  await settle();
  ok(calls[1].method === "POST" && calls[1].url === "https://api.test/api/tasks/t1/notes" && JSON.stringify(calls[1].body) === JSON.stringify({ body: "First line\nSecond line" }), "the button sends POST /api/tasks/:id/notes with the words, line break kept");
  ok(thread.children.length === 3 && /Rafael/.test(thread.children[2].words) && box.value === "" && thread.children[2].children[0].tagName === "span" && thread.children[2].children[0].textContent === "R", "the new note appears at once, last, with the initial mark (no picture), and the box is emptied");
  const lastChange = changes[changes.length - 1];
  ok(lastChange.note_count === 3 && lastChange.last_note.body === "First line\nSecond line" && lastChange.last_note.author_name === "Rafael", "the page is told: 3 notes, and the newest one");

  // Close.
  box.value = "half a thought";
  doc.keys.slice().forEach((f) => f({ key: "Escape", preventDefault() {}, stopPropagation() {} }));
  ok(!$("taskSheet") && closed === 1 && S.state() === null && doc.keys.length === 0, "Escape closes the sheet, tells the page once, and stops listening to keys");
  ok(doc.activeElement === rowWords, "focus goes back to the row's words");
  answer = () => ({ ok: true, data: { task: Object.assign({}, serverTask, { status: "done", progress: null }), notes: [] } });
  open({ done: true });
  ok($("taskSheetNoteBox").value === "half a thought", "words typed and not added are still there when the task is opened again");
  ok($("taskSheetPills").hidden === true && /is-done/.test($("taskSheetTitle").className), "on a done task the two pills are hidden");
  await settle();
  ok(/Nenhuma nota ainda\./.test($("taskSheetThread").words) && /No notes yet\./.test($("taskSheetThread").words), "an empty thread reads Nenhuma nota ainda. / No notes yet.");
  $("taskSheetPillWorking").fire("click");
  await settle();
  ok(calls.filter((c) => c.method === "PATCH" && c.body && "progress" in c.body).length === 0, "a pill on a done task saves nothing");
  $("taskSheet").fire("click");
  ok(!$("taskSheet") && closed === 2, "a tap outside the box closes it");
  open();
  $("taskSheetClose").fire("click");
  ok(!$("taskSheet") && closed === 3, "the Fechar / Close button closes it");

  // The thread cannot be read: nothing the row shows is wiped.
  const n0 = changes.length;
  answer = (c) => (c.method === "GET" ? { ok: false, data: {}, notJson: true } : { ok: true, data: { ok: true, status: "pending", progress: c.body.progress, due_date: null } });
  open();
  await settle();
  ok(/Could not load the notes\./.test($("taskSheetThread").words) && changes.length === n0, "when the thread does not load it says so, and the page is told nothing");
  $("taskSheetPillWorking").fire("click");
  await settle();
  const c1 = changes[changes.length - 1];
  ok(changes.length === n0 + 1 && c1.progress === "working" && !("note_count" in c1) && !("last_note" in c1), "a pill saved then updates the row's pill and leaves its note line alone");
  S.taskSheetClose();

  // The client's name is a link to the client's profile.
  answer = () => ({ ok: true, data: { task: Object.assign({}, serverTask, { client_id: "c 1&2" }), notes: [] } });
  open();
  await settle();
  const cl = $("taskSheetClient");
  ok(cl && cl.tagName === "a" && cl.href === "client.html?id=" + encodeURIComponent("c 1&2") && cl.textContent === "Acme Pools", "the client's name is a link to client.html?id=<client id>, as on the task row");
  ok(cl.attrs.title === "Abrir o perfil do cliente" && /task-sheet-tag/.test(cl.className) && !("tabindex" in cl.attrs) && $("taskSheetMeta").children[0] === cl, "it has a Portuguese title, keeps the pill look, and a real link is keyboard reachable");
  S.taskSheetClose();
  answer = () => ({ ok: true, data: { task: Object.assign({}, serverTask, { client_id: null }), notes: [] } });
  open();
  await settle();
  ok($("taskSheetClient").tagName === "span" && $("taskSheetClient").href === undefined, "a task with no client id shows the name with no link");
  S.taskSheetClose();
  answer = () => ({ ok: true, data: { task: Object.assign({}, serverTask, { client_id: null }), notes: [] } });
  open({ clientName: "" });
  await settle();
  ok($("taskSheetClient") === null, "a task with no client shows no client pill and no link");
  ok(/"Open the client's profile"/.test(sheet) && /"Abrir o perfil do cliente"/.test(sheet), "the title is in both languages");
  S.taskSheetClose();
}

// ── 14. A note tells the OTHER people on the task ───────────────────────────
{
  const d = world();
  d.raw.prepare("INSERT INTO users (email, role, display_name, avatar_url) VALUES (?,?,?,?)").run("rafa2@x.test", "rafa", "Rafael Dois", null);
  const last = () => pushes[pushes.length - 1];
  // Alice notes on a task Rafa gave her -> rafa (both rafa logins, ONE push).
  pushes.length = 0;
  const r1 = await as(d, "alice").add("t-alice", { body: "Called them." });
  ok(r1.status === 200 && pushes.length === 1 && JSON.stringify(pushes[0].emails.slice().sort()) === JSON.stringify(["rafa2@x.test", "rafa@x.test"]), "Alice notes on a task Rafa gave her: ONE push, to every rafa login");
  ok(last().payload.title === "Nova nota em uma tarefa" && last().payload.body === "Pra. Alice: Called them." && last().payload.tag === "apex-task-note" && last().payload.url === "/tasks.html?task=t-alice", "Portuguese recipient: title, \"<author>: <note>\", tag and url");
  // Rafa answers -> alice.
  pushes.length = 0;
  await as(d, "rafa").add("t-alice", { body: "Thanks." });
  ok(pushes.length === 1 && pushes[0].emails.indexOf("a-first@x.test") >= 0 && pushes[0].emails.indexOf("b-second@x.test") >= 0 && pushes[0].emails.length === 2 && last().payload.body === "Rafael: Thanks.", "Rafa answers: one push to alice's logins");
  // Self task, nobody gave it -> nobody.
  pushes.length = 0;
  await as(d, "rafa").add("t-own", { body: "Reminder to me." });
  ok(pushes.length === 0, "a note on your own task that nobody gave you sends nothing");
  // Alice's task from Alice (assigned alice, created alice) -> nobody.
  d.raw.prepare("INSERT INTO tasks (id, type, description, status, assigned_to, created_by_role) VALUES ('t-a-self','consultant','Hers','pending','alice','alice')").run();
  await as(d, "alice").add("t-a-self", { body: "x" });
  ok(pushes.length === 0, "same for Alice on her own task");
  // Owner notes on the task someone gave him -> the giver (alice).
  await as(d, "rafa").add("t-to-rafa", { body: "On it." });
  ok(pushes.length === 1 && pushes[0].emails.length === 2 && last().payload.url === "/tasks.html?task=t-to-rafa", "the owner notes on a task Alice gave him: Alice is told");
  // Third party: the developer on a task between Rafa and Alice -> both, in their own language.
  pushes.length = 0;
  await as(d, "dev").add("t-alice", { body: "Deploying a fix." });
  const toRafa = pushes.filter((p) => p.emails.indexOf("rafa@x.test") >= 0)[0];
  const toAlice = pushes.filter((p) => p.emails.indexOf("a-first@x.test") >= 0)[0];
  ok(pushes.length === 2 && !!toRafa && !!toAlice, "a third party (the developer) notes: rafa AND alice are each told once");
  ok(toRafa.payload.body === "Sistema: Deploying a fix." && toAlice.payload.title === "Nova nota em uma tarefa", "the developer author reads Sistema for Portuguese recipients");
  ok(JSON.stringify(pushes).indexOf("The Developer") < 0 && JSON.stringify(pushes).indexOf("dev@x.test") < 0, "the developer's name is in no push");
  // A task for the developer from Rafa; Rafa notes -> developer, in English.
  pushes.length = 0;
  await as(d, "rafa").add("t-sys", { body: "Any news?" });
  ok(pushes.length === 1 && pushes[0].emails.join() === "dev@x.test" && last().payload.title === "New note on a task" && last().payload.body === "Rafael: Any news?", "to the developer: English title, author named");
  pushes.length = 0;
  await as(d, "dev").add("t-sys", { body: "Done." });
  ok(pushes.length === 1 && pushes[0].emails.join() === "rafa@x.test,rafa2@x.test" && last().payload.body === "Sistema: Done.", "developer on a task he owns, given by Rafa: Rafa is told, as Sistema");
  // English recipient sees System: developer is recipient, author developer cannot happen on own task; test the text function directly.
  const F = as(d, "rafa").F;
  ok(F.taskNotePushText("developer", "developer", null, "x").body === "System: x" && F.taskNotePushText("rafa", "developer", null, "x").body === "Sistema: x", "the text: System for the English recipient, Sistema for Portuguese");
  // 140 cut.
  pushes.length = 0;
  await as(d, "alice").add("t-alice", { body: "z".repeat(300) });
  ok(last().payload.body === "Pra. Alice: " + "z".repeat(140), "the note is cut at 140 characters (no ellipsis)");
  // A push that throws: the note is still saved and returned.
  pushFail = true;
  const before = notes(d, "t-alice").length;
  const rf = await as(d, "alice").add("t-alice", { body: "Push is down." });
  pushFail = false;
  ok(rf.status === 200 && rf.data.note.body === "Push is down." && notes(d, "t-alice").length === before + 1, "a push that throws still returns the note, and it is saved");
  // Pill or due date alone: nothing.
  pushes.length = 0;
  await as(d, "alice").patch("t-alice", { progress: "working" });
  await as(d, "alice").patch("t-alice", { due_date: "2026-11-01" });
  ok(pushes.length === 0, "a pill or due-date change alone sends nothing");
  // Nobody to send to: pushToUsers is never called with an empty list.
  d.raw.prepare("DELETE FROM users WHERE role = 'rafa'").run();
  pushes.length = 0;
  const re = await as(d, "alice").add("t-alice", { body: "Nobody home." });
  ok(re.status === 200 && pushes.length === 0, "a role with no users is skipped (never an empty list)");
  // The push is after the save: a refused note sends nothing.
  pushes.length = 0;
  await as(d, "alice").add("t-alice", { body: "   " });
  ok(pushes.length === 0, "a refused note sends nothing");
}

// ── 15. tasks.html?task=<id> opens the sheet ────────────────────────────────
{
  const page = readFileSync(new URL("tasks.html", root), "utf8");
  const ios = readFileSync(new URL("ios/App/App/public/tasks.html", root), "utf8");
  ok(page === ios, "tasks.html: root and iOS copies are the same file");
  const m = page.match(/function openTaskFromUrl\(\) \{[\s\S]*?\n    \}\n/);
  ok(!!m && /get\("task"\)/.test(m[0]) && /taskUrlRead/.test(m[0]), "the page reads the task parameter, once");
  let opened = [], clicked = [];
  const mk = (search, tasks, openers) => new Function("window", "document", "allTasks", "completedMap", "openTaskSheet",
    "var taskUrlRead = false;\n" + m[0] + "\nreturn openTaskFromUrl;")(
    { location: { search } },
    { querySelectorAll: () => openers },
    tasks, {}, (tk, tags, done) => { opened.push(tk.key); });
  const tasks = [{ key: "t1", type: "rafa" }, { key: "t2", type: "client" }];
  const row = { getAttribute: () => "t1", click: () => clicked.push("t1") };
  mk("?task=t1", tasks, [row])();
  ok(clicked.join() === "t1" && opened.length === 0, "with the row drawn, the same click opens it");
  mk("?task=t1", tasks, [])();
  ok(opened.join() === "t1", "with the row not drawn, the sheet opens straight from the list");
  opened = []; clicked = [];
  const once = mk("?task=t1", tasks, []);
  once(); once();
  ok(opened.length === 1, "the parameter is read once");
  opened = []; clicked = [];
  mk("?task=t2", tasks, [])(); mk("?task=nope", tasks, [])(); mk("", tasks, [])();
  ok(opened.length === 0 && clicked.length === 0, "a client-type task, an unknown id or no parameter does nothing and errors nothing");
  ok(/renderTaskView\(\);\s*openTaskFromUrl\(\);/.test(page), "it runs after the list has loaded and drawn");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
