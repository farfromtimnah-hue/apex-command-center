// Edit a task's words (PATCH /api/tasks/:id { description }) and add a task
// by typing (POST /api/tasks), with the sheet's edit box and the "Add task"
// form. The Worker routes are the REAL functions cut out of worker/index.js,
// run on an in-memory SQLite (scripts/fixtures/d1-shim.mjs). The sheet is run
// against a stand-in page; the pages are read as source. No network, no
// browser, nothing written.
//
//   node scripts/test-task-edit-and-add.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, workerSrc } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

const TASKS = `
CREATE TABLE tasks (id TEXT PRIMARY KEY, client_id TEXT, type TEXT NOT NULL, description TEXT NOT NULL, due_date TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), session_id TEXT, due_date_source TEXT, completed_by TEXT, updated_at TEXT, source TEXT, nota TEXT, created_by TEXT, assigned_to TEXT, completed_at TEXT, created_by_role TEXT);
CREATE UNIQUE INDEX idx_tasks_session_dedup ON tasks (session_id, type, description) WHERE session_id IS NOT NULL;
CREATE TABLE sessions (id TEXT PRIMARY KEY, date TEXT);
CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, role TEXT, display_name TEXT, avatar_url TEXT, client_id TEXT);
`;
const MIG = read("migrations/2026-10-07_task_notes.sql");

const USERS = {
  rafa:  { email: "rafa@x.test", role: "rafa", display_name: "Rafael" },
  alice: { email: "alice@x.test", role: "alice", display_name: "Pra. Alice" },
  dev:   { email: "dev@x.test", role: "developer", display_name: "The Developer" },
  client: { email: null, role: "client", display_name: "Acme", client_id: "c-acme", login_role: "client", auth_method: "password" },
  seller: { email: null, role: "client", display_name: "Sam Seller", client_id: "c-acme", login_role: "seller", seller_name: "Sam Seller", auth_method: "password" }
};

const pushes = [];
let pushFail = false;

function world() {
  const d = makeDb([]);
  d.raw.exec(TASKS);
  d.raw.exec(MIG);
  const u = d.raw.prepare("INSERT INTO users (email, role, display_name, avatar_url) VALUES (?,?,?,?)");
  for (const k of ["rafa", "alice", "dev"]) { u.run(USERS[k].email, USERS[k].role, USERS[k].display_name, null); }
  u.run("alice2@x.test", "alice", "", null);
  d.raw.prepare("INSERT INTO clients (id, name, status, archived) VALUES (?,?,?,?)").run("c-acme", "Acme Pools", "active", 0);
  const t = d.raw.prepare("INSERT INTO tasks (id, client_id, type, description, due_date, status, source, session_id, assigned_to, created_by_role, updated_at, completed_at, completed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  t.run("t-alice", "c-acme", "consultant", "Call the Acme accountant", "2026-10-12", "pending", "voice", null, "alice", "rafa", "2026-10-01T10:00:00.000Z", null, null);
  t.run("t-done", null, "consultant", "Already done", null, "done", "voice", null, null, "rafa", "2026-10-02T10:00:00.000Z", "2026-10-02T10:00:00.000Z", "rafa");
  t.run("t-s1", "c-acme", "consultant", "Send the proposal", null, "pending", "session", "s-1", null, null, null, null, null);
  t.run("t-s2", "c-acme", "consultant", "Review the contract", null, "pending", "session", "s-1", null, null, null, null, null);
  t.run("t-client", "c-acme", "client", "The client's own to-do", "2026-10-15", "pending", "session", "s-1", null, null, null, null, null);
  return d;
}

function as(d, who) {
  const user = who ? USERS[who] : null;
  const stubs = Object.assign({}, baseStubs, {
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status || 400, error: en, error_pt: pt, error_en: en }, extra || {}),
    authenticate: async () => (user ? Object.assign({}, user) : null),
    crypto: globalThis.crypto,
    pushToUsers: async (env, emails, payload) => { if (pushFail) { throw new Error("push down"); } pushes.push({ emails, payload }); }
  });
  const F = build(
    ["taskDescriptionClean", "handlePatchTask", "handlePostTaskTyped", "taskVoiceOwnerRole", "taskVoicePushText", "taskVoiceNotify",
     "taskAssigneeAliceName", "taskAssigneeRafaName",
     "sessionSellerName", "clientRequestAllowed", "sellerRequestAllowed", "enforceClientRoleGate"],
    ["TASK_DESC_MAX", "TASK_PUSH_BODY_MAX"], stubs);
  const env = { DB: d.DB };
  const req = (body) => ({ url: "https://x.test/", headers: { get: (k) => (k === "Authorization" ? "Bearer tok" : null) },
    json: async () => { if (body === "not json") { throw new Error("bad json"); } return body; } });
  return {
    F, env,
    patch: (id, body) => F.handlePatchTask(id, req(body), env),
    add: (body) => F.handlePostTaskTyped(req(body), env),
    gate: (path, method) => F.enforceClientRoleGate(req({}), env, path, method)
  };
}
const task = (d, id) => d.q("SELECT * FROM tasks WHERE id = ?", id)[0];
const count = (d) => d.q("SELECT COUNT(*) AS n FROM tasks")[0].n;

// ── 1. PATCH description ────────────────────────────────────────────────────
{
  const d = world();
  const h = as(d, "rafa");
  const r = await h.patch("t-alice", { description: "  Call   the\n Acme\t\tbookkeeper  " });
  ok(r.status === 200 && r.data.ok === true && r.data.description === "Call the Acme bookkeeper" && task(d, "t-alice").description === "Call the Acme bookkeeper", "the words are saved trimmed, with inner runs of spaces and line breaks made one space");
  ok(r.data.status === "pending" && r.data.progress === null && r.data.due_date === "2026-10-12", "the answer also carries status, progress and due_date");
  ok(task(d, "t-alice").updated_at === "2026-10-01T10:00:00.000Z" && task(d, "t-alice").assigned_to === "alice" && task(d, "t-alice").client_id === "c-acme", "new words do not move updated_at, the owner or the client");
  ok(d.log.filter((s) => /^UPDATE tasks/.test(s)).pop() === "UPDATE tasks SET description = ? WHERE id = ?", "words alone are one UPDATE of the one column");

  for (const [label, v] of [["an empty string", ""], ["only spaces and line breaks", "  \n\t "], ["null", null], ["a number", 7], ["a list", ["x"]]]) {
    const e = await h.patch("t-alice", { description: v });
    ok(e.status === 400 && !!e.error_pt && !!e.error_en && task(d, "t-alice").description === "Call the Acme bookkeeper", "description " + label + " is refused in both languages, nothing saved");
  }
  const max = "x".repeat(500);
  const fits = await h.patch("t-alice", { description: " " + max + " " });
  ok(fits.status === 200 && task(d, "t-alice").description.length === 500, "exactly 500 characters (after trimming) is saved");
  const long = await h.patch("t-alice", { description: max + "y" });
  ok(long.status === 400 && /500/.test(long.error_pt) && /500/.test(long.error_en) && /longa/.test(long.error_pt) && /too long/.test(long.error_en) && task(d, "t-alice").description === max, "501 characters is refused in both languages: " + long.error_pt + " / " + long.error_en);

  // With the other fields.
  const mix = await h.patch("t-alice", { description: "New words", progress: "working", due_date: "2026-11-03" });
  const row = task(d, "t-alice");
  ok(mix.status === 200 && row.description === "New words" && row.progress === "working" && row.due_date === "2026-11-03" && mix.data.description === "New words" && mix.data.progress === "working", "description with progress and due_date: all saved together");
  const withStatus = await h.patch("t-alice", { status: "done", description: "Closed with new words" });
  const row2 = task(d, "t-alice");
  ok(withStatus.status === 200 && row2.status === "done" && row2.description === "Closed with new words" && row2.completed_by === "rafa" && row2.progress === null && withStatus.data.description === "Closed with new words", "description with status: both saved in one statement");
  ok(d.log.filter((s) => /^UPDATE tasks/.test(s)).pop() === "UPDATE tasks SET status = ?, completed_by = ?, completed_at = ?, updated_at = ?, progress = NULL, description = ? WHERE id = ?", "(one UPDATE, starting with the same status columns as before)");

  // A done task can be reworded and stays done, with its done moment kept.
  const done = await h.patch("t-done", { description: "Already done, fixed" });
  const dr = task(d, "t-done");
  ok(done.status === 200 && dr.description === "Already done, fixed" && dr.status === "done" && dr.completed_at === "2026-10-02T10:00:00.000Z" && dr.updated_at === "2026-10-02T10:00:00.000Z" && dr.completed_by === "rafa", "a done task can be reworded: it stays done and its done moment is untouched");

  for (const who of ["alice", "dev"]) {
    const x = await as(d, who).patch("t-done", { description: "By " + who });
    ok(x.status === 200 && task(d, "t-done").description === "By " + who, "role " + USERS[who].role + " may edit the words");
  }
  ok((await h.patch("no-such-task", { description: "x" })).status === 404, "a task that does not exist is 404");
  ok((await as(d, null).patch("t-alice", { description: "x" })).status === 401, "no session is 401");
}

// ── 2. PATCH description: client-type task, client and seller sessions ──────
{
  const d = world();
  const before = JSON.stringify(task(d, "t-client"));
  for (const who of ["rafa", "alice", "dev"]) {
    const r = await as(d, who).patch("t-client", { description: "Staff rewrote the client's to-do" });
    const r2 = await as(d, who).patch("t-client", { status: "done", description: "And closed it" });
    ok(r.status === 400 && r2.status === 400 && /equipe/.test(r.error_pt) && /staff tasks/.test(r.error_en), USERS[who].role + ": the words of a type 'client' task are refused, alone or with a status");
  }
  ok(JSON.stringify(task(d, "t-client")) === before, "the client's task is untouched");
  const stillTicks = await as(d, "rafa").patch("t-client", { status: "done" });
  ok(stillTicks.status === 200 && task(d, "t-client").status === "done", "(a { status } body still ticks a client-type task, as before)");

  for (const who of ["client", "seller"]) {
    const h = as(d, who);
    const g = await h.gate("/api/tasks/t-alice", "PATCH");
    const g2 = await h.gate("/api/tasks", "POST");
    ok(!!g && g.status === 403 && !!g2 && g2.status === 403, who + " session: the central gate refuses PATCH /api/tasks/:id and POST /api/tasks");
    const p = await h.patch("t-alice", { description: "from outside" });
    const a = await h.add({ description: "from outside", for: "self" });
    ok(p.status === 403 && !p.data && a.status === 403 && !a.data, who + " session: both handlers answer 403 by themselves");
  }
  const h0 = as(d, "client");
  ok(!h0.F.clientRequestAllowed("/api/tasks", "POST", "c-acme") && !h0.F.sellerRequestAllowed("/api/tasks", "POST", "c-acme"), "POST /api/tasks is on neither the client nor the salesperson allowlist");
  ok(task(d, "t-alice").description === "Call the Acme accountant" && count(d) === 5, "nothing was written by either session");
  ok((await as(d, "rafa").gate("/api/tasks", "POST")) === null, "(a staff session passes the gate)");
}

// ── 3. PATCH { status } alone is unchanged ──────────────────────────────────
{
  const d = world();
  const h = as(d, "alice");
  const r = await h.patch("t-alice", { status: "done" });
  ok(r.status === 200 && JSON.stringify(r.data) === JSON.stringify({ ok: true, status: "done" }), "{ status } alone answers exactly { ok: true, status }");
  ok(d.log.filter((s) => /^UPDATE tasks/.test(s)).pop() === "UPDATE tasks SET status = ?, completed_by = ?, completed_at = ?, updated_at = ?, progress = NULL WHERE id = ?" && task(d, "t-alice").description === "Call the Acme accountant", "it is the very same statement as before, and the words are untouched");
  const p = await h.patch("t-alice", { progress: null });
  ok(p.status === 200 && !("description" in p.data), "an answer to a pill or due-date change carries no description, as before");
  const none = await h.patch("t-alice", {});
  ok(none.status === 400 && none.error === "status is required", "an empty body is refused with the same words as before");
}

// ── 4. The unique index: a plain message, not a 500 ─────────────────────────
{
  const d = world();
  const h = as(d, "rafa");
  const hit = await h.patch("t-s2", { description: "  Send   the proposal " });
  ok(hit.status === 409 && /sess/.test(hit.error_pt) && /session/.test(hit.error_en) && !/UNIQUE|constraint|SQLITE/i.test(hit.error_pt + hit.error_en), "a session task edited to the words of another task of that session: a plain two-language message (" + hit.status + "): " + hit.error_pt + " / " + hit.error_en);
  ok(task(d, "t-s2").description === "Review the contract", "and nothing was saved");
  const both = await h.patch("t-s2", { status: "done", description: "Send the proposal" });
  ok(both.status === 409 && task(d, "t-s2").status === "pending", "with a status in the same body the status is not saved either");
  const fine = await h.patch("t-s2", { description: "Review the signed contract" });
  ok(fine.status === 200 && task(d, "t-s2").description === "Review the signed contract", "different words on the same session task are saved");
  const same = await h.patch("t-s1", { description: "Send the proposal" });
  ok(same.status === 200, "saving a session task with its own unchanged words is not a collision");
  // Tasks with no session never collide.
  const free = await h.patch("t-alice", { description: "Already done" });
  ok(free.status === 200 && task(d, "t-alice").description === "Already done", "two tasks with no session may carry the same words");
  // Any other database failure is still an error, not the collision message.
  d.raw.exec("CREATE TRIGGER no_words BEFORE UPDATE OF description ON tasks BEGIN SELECT RAISE(ABORT, 'disk on fire'); END;");
  const broken = await h.patch("t-alice", { description: "x" });
  ok(broken.status === 500 && !broken.error_pt, "another database failure is still a 500, not the collision message");
}

// ── 5. POST /api/tasks: who owns it, for every role and every "for" ─────────
{
  // [speaker, for] -> [assigned_to, given, the role pushed (or null)]
  const WANT = {
    "rafa|self": [null, false, null], "rafa|rafa": [null, false, null], "rafa|alice": ["alice", true, "alice"], "rafa|system": ["developer", true, "developer"],
    "alice|self": ["alice", false, null], "alice|rafa": [null, true, "rafa"], "alice|alice": ["alice", false, null], "alice|system": ["developer", true, "developer"],
    "dev|self": ["developer", false, null], "dev|rafa": [null, true, "rafa"], "dev|alice": ["alice", true, "alice"], "dev|system": ["developer", false, null]
  };
  const EMAILS = { rafa: ["rafa@x.test"], alice: ["alice2@x.test", "alice@x.test"], developer: ["dev@x.test"] };
  const d = world();
  for (const who of ["rafa", "alice", "dev"]) {
    for (const f of ["self", "rafa", "alice", "system"]) {
      const [assigned, given, pushed] = WANT[who + "|" + f];
      pushes.length = 0;
      const r = await as(d, who).add({ description: "Typed by " + who + " for " + f, for: f });
      const row = r.data && r.data.task ? task(d, r.data.task.id) : null;
      ok(r.status === 200 && !!row && row.assigned_to === assigned && row.created_by_role === USERS[who].role && r.data.task.assigned_to === assigned && r.data.task.given === given,
        USERS[who].role + " for \"" + f + "\": owner " + (assigned || "rafa (assigned_to NULL)") + ", given " + given);
      ok(pushed ? (pushes.length === 1 && JSON.stringify(pushes[0].emails.slice().sort()) === JSON.stringify(EMAILS[pushed])) : pushes.length === 0,
        "   " + (pushed ? "one push, to the " + pushed + " logins" : "nobody is pushed (their own task)"));
    }
  }
  ok(count(d) === 5 + 12, "each request saved exactly ONE task");
}

// ── 6. POST /api/tasks: what is saved and what is answered ──────────────────
{
  const d = world();
  pushes.length = 0;
  const r = await as(d, "rafa").add({ description: "  Ask   Acme for\nthe bank statement ", for: "alice", client_id: "c-acme", due_date: "2026-11-03" });
  const tk = r.data.task;
  const row = task(d, tk.id);
  ok(r.status === 200 && r.data.ok === true && row.type === "consultant" && row.status === "pending" && row.source === "manual", "saved as type 'consultant', status 'pending', source 'manual'");
  ok(row.description === "Ask Acme for the bank statement" && row.created_by === "Rafael" && row.created_by_role === "rafa" && row.assigned_to === "alice", "the words are cleaned; created_by is the person's name, created_by_role the signed-in role");
  ok(row.client_id === "c-acme" && row.due_date === "2026-11-03" && row.due_date_source === "stated" && /^\d{4}-\d{2}-\d{2}T/.test(row.updated_at) && row.session_id === null && row.completed_at === null, "the client, the due date (due_date_source 'stated') and updated_at are saved; no session");
  const voiceKeys = ["assigned_to", "assignee_name", "client_id", "client_name", "created_at", "created_by", "created_by_role", "description", "due_date", "due_date_source", "given", "id", "source", "status", "type"];
  ok(JSON.stringify(Object.keys(tk).sort()) === JSON.stringify(voiceKeys), "the answer's task has exactly the fields a spoken task is answered with");
  ok(tk.assignee_name === "Pra. Alice" && tk.client_name === "Acme Pools" && tk.given === true && tk.source === "manual" && tk.created_by_role === "rafa", "with assignee_name, client_name, given and created_by_role");
  ok(pushes.length === 1 && pushes[0].payload.title === "Nova tarefa" && pushes[0].payload.body === "Ask Acme for the bank statement" && pushes[0].payload.tag === "apex-assigned-tasks" && pushes[0].payload.url === "/dashboard.html", "the push is the one a spoken task sends: same title, body, tag and address");
  pushes.length = 0;
  const sys = await as(d, "rafa").add({ description: "Fix the report", for: "system" });
  ok(sys.data.task.assignee_name === null && pushes.length === 1 && pushes[0].payload.title === "New system task" && JSON.stringify(sys.data).indexOf("The Developer") < 0, "a task for the system carries no person's name, and the developer's push is in English");
  const back = await as(d, "alice").add({ description: "Sign the lease", for: "rafa" });
  ok(back.data.task.assigned_to === null && back.data.task.assignee_name === "Rafael" && back.data.task.given === true, "a task Alice gives the consultant: assigned_to NULL, his name as assignee_name");

  const plain = await as(d, "rafa").add({ description: "Just words" });
  const prow = task(d, plain.data.task.id);
  ok(plain.status === 200 && prow.assigned_to === null && prow.client_id === null && prow.due_date === null && prow.due_date_source === null && plain.data.task.given === false, "with only the words: the person's own task, no client, no due date, no due_date_source");
  const blanks = await as(d, "rafa").add({ description: "Blanks", for: "self", client_id: "", due_date: "" });
  ok(blanks.status === 200 && task(d, blanks.data.task.id).client_id === null && task(d, blanks.data.task.id).due_date === null, "an empty client and an empty date mean none");

  const n = count(d);
  pushes.length = 0;
  for (const [label, body] of [
    ["a client id that does not exist", { description: "x", for: "self", client_id: "c-nope" }],
    ["a client id that is not a string", { description: "x", for: "self", client_id: 12 }],
    ["a date that is not a real day (2026-02-30)", { description: "x", for: "self", due_date: "2026-02-30" }],
    ["a date in another shape (11/03/2026)", { description: "x", for: "self", due_date: "11/03/2026" }],
    ["a date with a time", { description: "x", for: "self", due_date: "2026-11-03T10:00:00Z" }],
    ["no words", { for: "self" }],
    ["only spaces", { description: "   \n ", for: "self" }],
    ["501 characters", { description: "y".repeat(501), for: "self" }],
    ["an unknown \"for\"", { description: "x", for: "nicole" }],
    ["a null \"for\"", { description: "x", for: null }]
  ]) {
    const e = await as(d, "rafa").add(body);
    ok(e.status === 400 && !!e.error_pt && !!e.error_en && !e.data, label + " is refused in both languages: " + e.error_pt + " / " + e.error_en);
  }
  ok((await as(d, "rafa").add("not json")).status === 400 && (await as(d, null).add({ description: "x" })).status === 401, "a body that is not JSON is 400; no session is 401");
  ok(count(d) === n && pushes.length === 0, "nothing was saved and nobody was pushed for any refused request");
  const max = await as(d, "rafa").add({ description: "z".repeat(500) });
  ok(max.status === 200 && task(d, max.data.task.id).description.length === 500, "exactly 500 characters is saved");

  // A push that throws: the task is still saved and returned.
  pushFail = true;
  const n2 = count(d);
  const pf = await as(d, "rafa").add({ description: "Push is down", for: "alice" });
  pushFail = false;
  ok(pf.status === 200 && pf.data.task.description === "Push is down" && count(d) === n2 + 1 && task(d, pf.data.task.id).assigned_to === "alice", "a push that throws still returns the task, and it is saved");
  // A role with no users: pushToUsers is never called with an empty list.
  d.raw.prepare("DELETE FROM users WHERE role = 'alice'").run();
  pushes.length = 0;
  const nobody = await as(d, "rafa").add({ description: "Nobody home", for: "alice" });
  ok(nobody.status === 200 && pushes.length === 0, "a role with no users is skipped (never an empty list, which would mean everyone)");
  // A typed task for the consultant is in his "Mine" list on the dashboard.
  ok(/var mine = mtTasks\.filter\(function\(t\) \{ return t\.source === "voice" \|\| t\.source === "manual"; \}\);/.test(read("dashboard.html")), "dashboard.html: \"Mine\" is source voice or manual, so a typed task of his own lands there");
  ok(/if \(taskOwnerRole\(task\) === viewer\) \{ return task\.source === "session" \? "sessions" : "mine"; \}/.test(read("tasks.html")), "tasks.html: an own task that is not from a session is in \"Mine\"");
}

// ── 7. The route table ──────────────────────────────────────────────────────
{
  const iAdd = workerSrc.indexOf('if (segs[0] === "api" && segs[1] === "tasks" && !segs[2] && method === "POST") {\n            return handlePostTaskTyped(request, env);');
  ok(iAdd > 0 && workerSrc.split("return handlePostTaskTyped(").length === 2, "POST /api/tasks goes to handlePostTaskTyped, from one place, and only with nothing after /tasks");
  ok(/segs\[2\] === "voice" && !segs\[3\] && method === "POST"\) \{\s*return handlePostTasksVoice\(request, env\);/.test(workerSrc) && /segs\[3\] === "undo" && !segs\[4\] && method === "POST"\) \{\s*return handlePostTasksVoiceUndo\(request, env\);/.test(workerSrc), "POST /api/tasks/voice and /voice/undo still go to their own handlers");
  ok(/segs\[3\] === "notes" && !segs\[4\] && method === "POST"\) \{\s*return handlePostTaskNote\(segs\[2\], request, env\);/.test(workerSrc), "POST /api/tasks/:id/notes still goes to the note handler");
  ok(/if \(segs\.length === 4 && segs\[3\] === "tasks"\) \{\s*if \(method === "GET"\)  \{ return handleGetClientTasks\(cid, request, env\); \}\s*if \(method === "POST"\) \{ return handlePostClientTask\(cid, request, env\); \}/.test(workerSrc), "POST /api/clients/:id/tasks still goes to handlePostClientTask (its second segment is \"clients\", never \"tasks\")");
  ok(/segs\[1\] === "tasks" && !segs\[2\] && method === "GET"\) \{\s*return handleGetAllTasks\(request, env\);/.test(workerSrc), "GET /api/tasks still goes to the list");
  const posts = [...workerSrc.matchAll(/segs\[1\] === "tasks" && !segs\[2\] && method === "POST"/g)].length;
  ok(posts === 1, "one route answers POST /api/tasks (" + posts + ")");
}

// ── 8. task-sheet.js and the pages, as source ───────────────────────────────
const sheet = read("task-sheet.js");
{
  ok(sheet === read("ios/App/App/public/task-sheet.js"), "task-sheet.js: the root and iOS copies are the same file");
  let parses = true;
  try { new Function(sheet); } catch (e) { parses = false; console.log("      " + e.message); }
  ok(parses, "task-sheet.js parses");
  const code = sheet.replace(/^\s*\/\/[^\n]*$/gm, "");
  ok(!/(^|[^A-Za-z0-9_.$])(window\.)?(confirm|alert|prompt)\s*\(/m.test(code), "task-sheet.js: no confirm(), alert() or prompt()");
  ok(!/=>/.test(code) && !/\b(const|let)\s/.test(code) && !/[^\x00-\x7F]/.test(sheet), "task-sheet.js: var and regular functions only, plain ASCII");
  for (const id of ["taskSheetEdit", "taskSheetEditWrap", "taskSheetEditBox", "taskSheetEditSave", "taskSheetEditCancel", "taskSheetEditMsg",
    "taskAdd", "taskAddTitle", "taskAddWords", "taskAddClient", "taskAddDue", "taskAddDueShown", "taskAddMsg", "taskAddSave", "taskAddCancel"]) {
    ok(sheet.split('.id = "' + id + '"').length === 2, 'id "' + id + '" is given to one element, once');
  }
  for (const [pt, en] of [["Editar", "Edit"], ["Salvar", "Save"], ["Cancelar", "Cancel"], ["Adicionar tarefa", "Add task"], ["O que precisa ser feito?", "What needs to be done?"],
    ["Para quem", "For whom"], ["Para mim", "For me"], ["Sistema", "System"], ["Cliente", "Client"], ["Prazo", "Due date"], ["Adicionar", "Add"],
    ["Escreva a tarefa antes de salvar.", "Write the task before saving."], ["Escreva a tarefa antes de adicionar.", "Write the task before adding it."]]) {
    ok(sheet.indexOf('"' + pt + '"') > 0 && sheet.indexOf('"' + en + '"') > 0, 'label in both languages: "' + pt + '" / "' + en + '"');
  }

  for (const name of ["dashboard.html", "tasks.html"]) {
    const page = read(name);
    ok(page === read("ios/App/App/public/" + name), name + ": the root and iOS copies carry the same edits (same file)");
    let n = 0, bad = 0;
    const scripts = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const src of scripts) { n++; try { new Function(src); } catch (e) { bad++; console.log("      " + name + " inline script " + n + ": " + e.message); } }
    ok(n > 0 && bad === 0, name + ": all " + n + " inline scripts parse");
    const js = scripts.join("\n").replace(/^\s*\/\/[^\n]*$/gm, "");
    ok(!/(^|[^A-Za-z0-9_.$])(window\.)?(confirm|alert|prompt)\s*\(/m.test(js), name + ": no confirm(), alert() or prompt()");
    ok(page.split('id="mtAddBtn"').length === 2 && page.split('id="mtSpeakBtn"').length === 2, name + ": the Add task button exists once (and the microphone once)");
    const speak = page.match(/<div class="mt-speak">[\s\S]*?<span class="mt-timer" id="mtTimer"><\/span>/);
    ok(!!speak && /id="mtSpeakBtn"[\s\S]*?<\/button>\s*<button type="button" class="btn-voice-mic btn-task-add" id="mtAddBtn" onclick="openAddTask\(\)">/.test(speak[0]), name + ": it is the next thing after the microphone button, in the same row");
    const btn = page.match(/<button[^>]*id="mtAddBtn"[\s\S]*?<\/button>/)[0];
    ok(/<span aria-hidden="true">\+<\/span>/.test(btn) && btn.indexOf("&#127908;") < 0 && /<span class="show-pt">Adicionar tarefa<\/span>\s*<span class="show-en">Add task<\/span>/.test(btn), name + ": a plus sign, not a microphone, reading Adicionar tarefa / Add task");
    ok(page.split("function openAddTask()").length === 2 && page.split("taskAddOpen({").length === 2, name + ": the form is opened from one place");
    ok(/mtBoth\("Tarefa adicionada\.", "Task added\."\), "ok"\)/.test(page), name + ': the status line says "Tarefa adicionada." / "Task added."');
    const added = page.match(/function (mtTaskAdded|taskAdded)\([\s\S]*?\n    \}\n/)[0];
    ok(/mtLastAdded = \[\];/.test(added) && !/Desfazer|Undo<|undoMyTasksDictation/.test(added), name + ": a typed task leaves nothing for Undo");
    ok(/\.btn-voice-mic\.btn-task-add \{/.test(page), name + ": the button has its own style rule");
  }
  const dash = read("dashboard.html");
  const tasksPage = read("tasks.html");
  ok(/function mtTaskAdded\(task\) \{[\s\S]*?mtRefreshLists\(\);/.test(dash), "dashboard.html: after a typed task the lists are refreshed by mtRefreshLists, as after a dictation");
  ok(/function taskAdded\(\) \{[\s\S]*?loadTasks\(\);/.test(tasksPage), "tasks.html: after a typed task the list is loaded again by loadTasks, as after a dictation");
  ok(/if \(c\.description\) \{ t\.description = c\.description; \}/.test(dash) && /if \(c\.description\) \{ tk\.text = c\.description; \}/.test(tasksPage), "both pages put edited words onto the task they hold, so the row is right with no reload");
  ok(/id="mtVoiceBlock">\s*<div class="mt-speak">[\s\S]*?id="mtAddBtn"/.test(dash), "dashboard.html: the button is inside mtVoiceBlock, the one block moved between the consultant's card and Alice's card");
  ok(/if \(dashClients\.length\) \{ return Promise\.resolve\(dashClients\); \}/.test(dash) && dash.split('"/api/clients"').length >= 2 && /WORKER_URL \+ "\/api\/clients"/.test(tasksPage), "the form's clients are the dashboard's own list; tasks.html reads the same existing route");
  const others = ["client.html", "portal.html"].filter((p) => /mtAddBtn|taskAddOpen|openAddTask\(/.test(read(p)));
  ok(others.length === 0, "client.html and portal.html carry nothing of the form (client.html's own openAddTaskForm is another, older thing)");
}

// ── 9. The sheet's edit box and the Add task form, on a stand-in page ───────
{
  const dt = read("datetime.js");
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
    fire(type, ev) { const e = Object.assign({ target: this, prevented: false, preventDefault() { e.prevented = true; }, stopPropagation() {} }, ev || {}); (this.on[type] || []).forEach((f) => f(e)); return e; }
    all(out) { out = out || []; this.children.forEach((c) => { out.push(c); c.all(out); }); return out; }
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
    "\nreturn { taskSheetOpen, taskSheetClose, taskAddOpen, taskAddClose, taskAddForList, sheet: function() { return taskSheetNow; }, form: function() { return taskAddNow; } };")(doc, {}, fetchStub);
  const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 0)); } };
  const $ = (id) => doc.getElementById(id);
  const esc = () => doc.keys.slice().forEach((f) => f({ key: "Escape", preventDefault() {}, stopPropagation() {} }));
  const serverTask = { id: "t1", description: "Call the acountant", due_date: null, status: "pending", progress: null };
  const changes = [];
  let closed = 0;
  const notesAnswer = (t) => ({ ok: true, data: { task: Object.assign({}, serverTask, t || {}), notes: [] } });
  const open = (o) => S.taskSheetOpen(Object.assign({ id: "t1", description: "Call the acountant", clientName: "", tags: [], done: false, progress: null, dueDate: null,
    apiBase: "https://api.test", getToken: async () => "tok-1", onChange: (c) => changes.push(c), onClose: () => { closed++; } }, o || {}));

  // The edit box: open, cancel, Escape.
  answer = () => notesAnswer();
  open();
  await settle();
  const top = $("taskSheetTitle").parentNode;
  ok(!!$("taskSheetEdit") && /Editar<\/span><span class="show-en">Edit/.test($("taskSheetEdit").innerHTML) && top.children.indexOf($("taskSheetEdit")) > top.children.indexOf($("taskSheetTitle")) && $("taskSheetEdit").parentNode === top, "the opened task has an Editar / Edit button in the same row as the title, after it");
  ok($("taskSheetEditWrap").hidden === true && $("taskSheetTitle").hidden === false, "the text box is not shown until Edit is pressed");
  calls.length = 0;
  $("taskSheetEdit").fire("click");
  const box = $("taskSheetEditBox");
  ok(box.tagName === "textarea" && box.value === "Call the acountant" && box.maxLength === 500 && $("taskSheetEditWrap").hidden === false && $("taskSheetTitle").hidden === true && $("taskSheetEdit").hidden === true && doc.activeElement === box, "Edit turns the title into a text box holding the current words (500 at most), with focus in it");
  ok(/Salvar<\/span><span class="show-en">Save/.test($("taskSheetEditSave").innerHTML) && /Cancelar<\/span><span class="show-en">Cancel/.test($("taskSheetEditCancel").innerHTML), "with Salvar / Save and Cancelar / Cancel");
  box.value = "Something else entirely";
  $("taskSheetEditCancel").fire("click");
  ok($("taskSheetTitle").textContent === "Call the acountant" && $("taskSheetTitle").hidden === false && $("taskSheetEditWrap").hidden === true && $("taskSheetEdit").hidden === false && calls.length === 0, "Cancel leaves the words as they were and sends nothing");
  $("taskSheetEdit").fire("click");
  ok($("taskSheetEditBox").value === "Call the acountant", "(opening the box again starts from the saved words, not the abandoned ones)");
  $("taskSheetEditBox").value = "Abandoned again";
  esc();
  ok(!!$("taskSheet") && $("taskSheetTitle").textContent === "Call the acountant" && $("taskSheetEditWrap").hidden === true && calls.length === 0 && closed === 0, "Escape leaves the edit with the words as they were, and the sheet stays open");

  // Empty, unchanged, failure, success.
  $("taskSheetEdit").fire("click");
  $("taskSheetEditBox").value = "  \n ";
  $("taskSheetEditSave").fire("click");
  await settle();
  ok(calls.length === 0 && /Escreva a tarefa antes de salvar\./.test($("taskSheetEditMsg").words) && /Write the task before saving\./.test($("taskSheetEditMsg").words) && $("taskSheetEditWrap").hidden === false, "empty words are not sent, and a plain message says why");
  $("taskSheetEditBox").value = " Call   the acountant ";
  $("taskSheetEditSave").fire("click");
  await settle();
  ok(calls.length === 0 && $("taskSheetEditWrap").hidden === true, "words that did not change send nothing and close the box");

  $("taskSheetEdit").fire("click");
  $("taskSheetEditBox").value = "Call  the\naccountant ";
  answer = () => ({ ok: false, data: { error: "x", error_pt: "Tarefa longa demais.", error_en: "That task is too long." } });
  $("taskSheetEditSave").fire("click");
  ok($("taskSheetEditSave").disabled === true && $("taskSheetEditCancel").disabled === true, "Save and Cancel are off while the save is on its way");
  $("taskSheetEditSave").fire("click");
  await settle();
  ok(calls.length === 1 && calls[0].method === "PATCH" && calls[0].url === "https://api.test/api/tasks/t1" && JSON.stringify(calls[0].body) === '{"description":"Call the accountant"}' && calls[0].auth === "Bearer tok-1", "Save sends PATCH /api/tasks/:id { description } and nothing else, once");
  ok($("taskSheetEditWrap").hidden === false && $("taskSheetEditBox").value === "Call  the\naccountant " && /That task is too long\./.test($("taskSheetEditMsg").words) && /Tarefa longa demais\./.test($("taskSheetEditMsg").words) && $("taskSheetEditSave").disabled === false, "on failure the box stays open with the words kept, and the Worker's two-language message shows");
  ok($("taskSheetTitle").textContent === "Call the acountant" && changes.every((c) => c.description !== "Call the accountant"), "the title is unchanged and the page is not told of words that were not saved");
  answer = () => ({ ok: false, data: {}, notJson: true });
  $("taskSheetEditSave").fire("click");
  await settle();
  ok(/Could not save\. Please try again\./.test($("taskSheetEditMsg").words) && /consegui salvar/.test($("taskSheetEditMsg").words) && $("taskSheetEditBox").value === "Call  the\naccountant ", "with no readable answer a plain message shows and the words are still kept");

  answer = (c) => ({ ok: true, data: { ok: true, status: "pending", progress: null, due_date: null, description: c.body.description } });
  const enter = $("taskSheetEditBox").fire("keydown", { key: "Enter" });
  await settle();
  ok(enter.prevented === true && $("taskSheetTitle").textContent === "Call the accountant" && $("taskSheetTitle").hidden === false && $("taskSheetEditWrap").hidden === true && $("taskSheetEdit").hidden === false, "on success (here by Enter) the title shows the new words and the box is gone");
  const last = changes[changes.length - 1];
  ok(last.id === "t1" && last.description === "Call the accountant" && /Salvo\./.test($("taskSheetStatus").words), "the page is told the new words (so the row behind the sheet is right), and it says Salvo. / Saved.");
  ok(doc.activeElement === $("taskSheetEdit"), "focus goes back to the Edit button");
  esc();
  ok(!$("taskSheet") && closed === 1, "with no edit open, Escape closes the sheet as before");

  // A done task can be edited too.
  answer = () => notesAnswer({ status: "done", description: "Call the accountant" });
  open({ done: true, description: "Call the accountant" });
  await settle();
  ok(/is-done/.test($("taskSheetTitle").className) && $("taskSheetEdit").hidden === false, "a done task has the Edit button too");
  answer = (c) => ({ ok: true, data: { ok: true, status: "done", progress: null, due_date: null, description: c.body.description } });
  $("taskSheetEdit").fire("click");
  $("taskSheetEditBox").value = "Called the accountant";
  $("taskSheetEditSave").fire("click");
  await settle();
  ok($("taskSheetTitle").textContent === "Called the accountant" && /is-done/.test($("taskSheetTitle").className), "and its words are saved; it stays crossed out");
  S.taskSheetClose();

  // The thread's answer brings the saved words (someone else fixed them).
  answer = () => notesAnswer({ description: "Fixed by someone else" });
  open({ description: "Old words on the row" });
  await settle();
  ok($("taskSheetTitle").textContent === "Fixed by someone else" && changes[changes.length - 1].description === "Fixed by someone else", "the title shows the words as they are saved now, and the page is told");
  S.taskSheetClose();

  // ── The Add task form ──
  ok(JSON.stringify(S.taskAddForList("rafa")) === '["self","alice","system"]' && JSON.stringify(S.taskAddForList("alice")) === '["self","rafa","system"]' && JSON.stringify(S.taskAddForList("developer")) === '["self","rafa","alice"]', "For whom: \"For me\" first, then the others, leaving out the viewer's own entry (Rafa, Alice, the developer)");
  const added = [];
  const CLIENTS = [{ id: "c-z", name: "Zeta", status: "active", archived: 0 }, { id: "c-a", name: "Acme Pools", status: null }, { id: "c-old", name: "Gone Co", status: "inactive" }, { id: "c-arch", name: "Archived Co", status: "active", archived: 1 }];
  let clientCalls = 0;
  const openAdd = (o) => S.taskAddOpen(Object.assign({ viewerRole: "rafa", names: { rafa: "Rafael", alice: "Pra. <Alice>" }, loadClients: () => { clientCalls++; return Promise.resolve(CLIENTS); },
    apiBase: "https://api.test", getToken: async () => "tok-2", onAdded: (t) => added.push(t) }, o || {}));
  const opener = new El("button");
  doc.body.appendChild(opener);
  opener.focus();
  calls.length = 0;
  ok(openAdd() === true && !!$("taskAdd") && $("taskAdd").attrs.role === "dialog" && $("taskAdd").attrs["aria-modal"] === "true" && /task-sheet-overlay/.test($("taskAdd").className), "Add task opens one in-page dialog in the sheet's overlay style");
  ok(openAdd() === false && open() === false && doc.body.all().filter((e) => e.id === "taskAdd").length === 1, "a second form, or a task sheet, does not open on top of it");
  await settle();
  const wordsBox = $("taskAddWords");
  ok(/O que precisa ser feito\?/.test($("taskAdd").words) && /What needs to be done\?/.test($("taskAdd").words) && wordsBox.tagName === "textarea" && wordsBox.maxLength === 500 && wordsBox.required === true && doc.activeElement === wordsBox, "1. the words: a required text box, 500 at most, with focus in it");
  const pill = (k) => $("taskAddFor_" + k);
  ok(/Para quem/.test($("taskAdd").words) && !!pill("self") && !!pill("alice") && !!pill("system") && !pill("rafa"), "2. For whom: the consultant sees For me, Alice and System, and no pill for himself");
  ok(/Para mim<\/span><span class="show-en">For me/.test(pill("self").innerHTML) && pill("alice").innerHTML === "Pra. &lt;Alice&gt;" && /Sistema<\/span><span class="show-en">System/.test(pill("system").innerHTML), "the pills read Para mim / For me, her name as the page gave it (escaped), and Sistema / System");
  ok(pill("self").attrs["aria-pressed"] === "true" && pill("alice").attrs["aria-pressed"] === "false" && pill("system").attrs["aria-pressed"] === "false", "exactly one pill is lit, the first by default");
  pill("alice").fire("click");
  ok(pill("self").attrs["aria-pressed"] === "false" && pill("alice").attrs["aria-pressed"] === "true" && pill("system").attrs["aria-pressed"] === "false", "one click lights another pill and turns the first off");
  const sel = $("taskAddClient");
  ok(sel.tagName === "select" && clientCalls === 1 && sel.children.length === 3 && sel.children[0].value === "" && sel.children[0].textContent === "Nenhum" && sel.children[1].textContent === "Acme Pools" && sel.children[1].value === "c-a" && sel.children[2].textContent === "Zeta", "3. Client: a select whose first option is none, then the ACTIVE clients by name (inactive and archived left out)");
  ok($("taskAddDue").type === "date" && /Prazo/.test($("taskAdd").words) && /Due date/.test($("taskAdd").words), "4. Due date: a date field");
  $("taskAddDue").value = "2026-10-01";
  $("taskAddDue").fire("change");
  ok($("taskAddDueShown").textContent === "10/01/2026", "the chosen date is printed beside it month first: 10/01/2026");
  ok(/Adicionar<\/span><span class="show-en">Add</.test($("taskAddSave").innerHTML) && /Cancelar<\/span><span class="show-en">Cancel/.test($("taskAddCancel").innerHTML), "buttons Adicionar / Add and Cancelar / Cancel");

  // Empty words.
  $("taskAddSave").fire("click");
  await settle();
  ok(calls.length === 0 && /Escreva a tarefa antes de adicionar\./.test($("taskAddMsg").words) && /Write the task before adding it\./.test($("taskAddMsg").words), "with no words nothing is sent, and a plain message says why");

  // Failure keeps everything.
  wordsBox.value = "  Ask Acme for\n the bank   statement ";
  sel.value = "c-a";
  answer = () => ({ ok: false, data: { error: "x", error_pt: "Cliente não encontrado.", error_en: "That client was not found." } });
  $("taskAddSave").fire("click");
  ok($("taskAddSave").disabled === true, "while saving, Add is disabled");
  $("taskAddSave").fire("click");
  await settle();
  ok(calls.length === 1 && calls[0].method === "POST" && calls[0].url === "https://api.test/api/tasks" && calls[0].auth === "Bearer tok-2" && JSON.stringify(calls[0].body) === JSON.stringify({ description: "Ask Acme for the bank statement", for: "alice", client_id: "c-a", due_date: "2026-10-01" }), "Add sends POST /api/tasks { description, for, client_id, due_date }, once: " + JSON.stringify(calls[0].body));
  ok(!!$("taskAdd") && wordsBox.value === "  Ask Acme for\n the bank   statement " && sel.value === "c-a" && $("taskAddDue").value === "2026-10-01" && pill("alice").attrs["aria-pressed"] === "true" && $("taskAddSave").disabled === false && added.length === 0, "on failure the form stays with everything kept, and Add is back on");
  ok(/That client was not found\./.test($("taskAddMsg").words) && /Cliente n/.test($("taskAddMsg").words), "and the Worker's two-language message shows");
  answer = () => ({ ok: false, data: {}, notJson: true });
  $("taskAddSave").fire("click");
  await settle();
  ok(/Could not add the task\. Please try again\./.test($("taskAddMsg").words) && /consegui adicionar a tarefa/.test($("taskAddMsg").words) && !!$("taskAdd"), "with no readable answer a plain message shows and the form stays");

  // A tap outside keeps a half-written task; success closes.
  $("taskAdd").fire("click");
  ok(!!$("taskAdd"), "a tap outside does not throw away a half-written task");
  const SAVED = { id: "new-1", description: "Ask Acme for the bank statement", assigned_to: "alice", given: true, source: "manual" };
  answer = () => ({ ok: true, data: { ok: true, task: SAVED } });
  $("taskAddSave").fire("click");
  await settle();
  ok(!$("taskAdd") && S.form() === null && added.length === 1 && added[0] === SAVED && doc.keys.length === 0, "on success the form closes and the page is handed the saved task, once");
  ok(doc.activeElement === opener, "focus goes back to where it was");

  // Only the words: no client, no date in the body. Alice's and the developer's pills.
  openAdd({ viewerRole: "alice" });
  await settle();
  ok(!!pill("self") && !!pill("rafa") && !!pill("system") && !pill("alice") && pill("rafa").innerHTML === "Rafael", "Alice sees For me, the consultant's name and System, and no pill for herself");
  ok($("taskAddWords").value === "" && $("taskAddClient").value === "" && $("taskAddDue").value === "" && pill("self").attrs["aria-pressed"] === "true", "a new form starts empty, with For me lit");
  calls.length = 0;
  $("taskAddWords").value = "Just words";
  $("taskAddSave").fire("click");
  await settle();
  ok(JSON.stringify(calls[0].body) === JSON.stringify({ description: "Just words", for: "self" }), "with only the words the body is { description, for: \"self\" }: no client, no date");
  openAdd({ viewerRole: "developer", names: {} });
  ok(!!pill("self") && !!pill("rafa") && !!pill("alice") && !pill("system") && pill("rafa").innerHTML === "Rafa" && pill("alice").innerHTML === "Alice", "the developer sees For me, Rafa and Alice (the plain names when the page has none), and no System pill");
  ok($("taskAdd").words.indexOf("The Developer") < 0, "no developer name is on the form");

  // Cancel, Escape, a tap outside when empty.
  calls.length = 0;
  $("taskAddWords").value = "Never mind";
  $("taskAddCancel").fire("click");
  ok(!$("taskAdd") && calls.length === 0 && added.length === 2, "Cancel closes the form and saves nothing");
  openAdd();
  esc();
  ok(!$("taskAdd") && S.form() === null, "Escape closes the form");
  openAdd();
  $("taskAdd").fire("click");
  ok(!$("taskAdd"), "a tap outside closes it while nothing is typed");

  // The client list cannot be read: the form still works.
  openAdd({ loadClients: () => Promise.reject(new Error("down")) });
  await settle();
  ok($("taskAddClient").children.length === 1 && /Could not load the clients\./.test($("taskAddClientNote").words), "when the clients cannot be read the select keeps only \"none\" and a quiet line says so");
  calls.length = 0;
  answer = () => ({ ok: true, data: { ok: true, task: SAVED } });
  $("taskAddWords").value = "Still works";
  $("taskAddSave").fire("click");
  await settle();
  ok(calls.length === 1 && !$("taskAdd"), "and a task can still be added without a client");
  // The sheet opens normally once the form is gone.
  answer = () => notesAnswer();
  ok(open() === true && S.taskAddOpen({ getToken: async () => "t" }) === false, "the form does not open on top of an opened task");
  S.taskSheetClose();
}

console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
