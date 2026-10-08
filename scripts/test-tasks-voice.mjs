// "Speak my tasks": POST /api/tasks/voice and its undo, against the REAL
// functions cut out of worker/index.js, on an in-memory SQLite
// (scripts/fixtures/d1-shim.mjs). Deepgram and Claude are stand-ins. No network.
//
//   node scripts/test-tasks-voice.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, workerSrc } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

// The tasks table as it is live today; the migration is layered on for the
// "after" worlds and left off for the "before the migration" world.
const CURRENT = `
CREATE TABLE tasks (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL, due_date TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), session_id TEXT, due_date_source TEXT, completed_by TEXT, updated_at TEXT, source TEXT, nota TEXT);
CREATE INDEX idx_tasks_status_due ON tasks (status, due_date);
CREATE INDEX idx_tasks_client ON tasks (client_id, status);
CREATE UNIQUE INDEX idx_tasks_session_dedupe ON tasks (session_id, type, description) WHERE session_id IS NOT NULL;
CREATE INDEX idx_tasks_source_due ON tasks (source, due_date);
CREATE INDEX idx_tasks_session ON tasks (session_id);
CREATE TABLE sessions (id TEXT PRIMARY KEY, date TEXT);
`;
const MIG = readFileSync(new URL("migrations/2026-10-05_tasks_client_optional.sql", root), "utf8");
// tasks.assigned_to (2026-10-07): who a spoken to-do was handed to.
const MIG_ASSIGNED = readFileSync(new URL("migrations/2026-10-07_tasks_assigned_to.sql", root), "utf8");
// tasks.completed_at (2026-10-07): the moment a task was marked done, UTC.
const MIG_COMPLETED = readFileSync(new URL("migrations/2026-10-07_tasks_completed_at.sql", root), "utf8");
// tasks.created_by_role (2026-10-07): the role of the person who spoke the task.
const MIG_ROLE = readFileSync(new URL("migrations/2026-10-07_tasks_created_by_role.sql", root), "utf8");
const USERS = "CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, role TEXT, display_name TEXT, avatar_url TEXT, client_id TEXT)";

function world(migrated) {
  const d = makeDb([]);
  d.raw.exec(CURRENT);
  if (migrated) { d.raw.exec(MIG); d.raw.exec(MIG_ASSIGNED); d.raw.exec(MIG_COMPLETED); d.raw.exec(MIG_ROLE); }
  // Role alice has two rows (the same person), as it does live.
  d.raw.exec(USERS);
  const u = d.raw.prepare("INSERT INTO users (email, role, display_name) VALUES (?,?,?)");
  u.run("a-first@x.test", "alice", "");
  u.run("b-second@x.test", "alice", "Pra. Alice");
  u.run("rafa@x.test", "rafa", "Rafa");
  u.run("dev@x.test", "developer", "The Developer");
  u.run("client@x.test", "client", "A Client");
  const c = d.raw.prepare("INSERT INTO clients (id, name, status, archived) VALUES (?,?,?,?)");
  c.run("c-gator", "GATOR OUTDOOR LIVING", "active", 0);
  c.run("c-jm", "JM Luxury Pools", "active", 0);
  c.run("c-twin-1", "Silva Tile", "active", 0);
  c.run("c-twin-2", "SILVA TILE", "active", 0);       // same name twice: never a guess
  c.run("c-old", "Old Company", "active", 1);         // archived
  c.run("c-lead", "Lead Company", "lead", 0);         // a lead, not an active client
  return d;
}

// Every dictation in this file happens at this fixed moment unless a test
// sets another, so no check depends on the day the file is run.
// 2026-10-07T16:00:00Z is Wednesday, October 7, 12:00 PM in America/New_York.
const FIXED_NOW = new Date("2026-10-07T16:00:00Z");
const TRANSCRIPT = "Preciso ligar para o contador amanha, mandar a proposta para a Gator e preparar a mensagem de domingo.";

// Stand-ins. `claude` is what the fake API answers with; `calls` records what
// was sent to each service.
function harness(d, opts) {
  const o = Object.assign({ role: "rafa", name: "Tester", claude: { tasks: [] }, claudeStatus: 200, asrFail: null, transcript: TRANSCRIPT, now: FIXED_NOW }, opts || {});
  const calls = { asr: [], claude: [], logs: [], push: [] };
  const env = {
    DB: d.DB, CLAUDE_API_KEY: "test-key",
    AI: { run: async (model, input) => {
      calls.asr.push({ model, language: input.language, contentType: input.audio.contentType, smart_format: input.smart_format, punctuate: input.punctuate, isStream: typeof input.audio.body.getReader === "function" });
      if (o.asrFail && o.asrFail(input.language)) { throw new Error("asr refused " + input.language); }
      return { results: { channels: [{ alternatives: [{ transcript: o.transcript, languages: ["pt"] }] }] } };
    } }
  };
  const stubs = Object.assign({}, baseStubs, {
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status || 400, error: en, error_pt: pt, error_en: en }, extra || {}),
    authenticate: async () => (o.role ? { role: o.role, display_name: o.name } : null),
    actorName: (u) => (u && (u.display_name || u.role)) || null,
    crypto: globalThis.crypto, Response: globalThis.Response, Intl: globalThis.Intl,
    // Stand-in for the real push sender. It records what it was asked to send
    // and how many task rows were already saved at that moment.
    pushToUsers: async (env, emails, payload) => {
      calls.push.push({ emails, payload, tasksSaved: Number(d.q("SELECT COUNT(*) AS n FROM tasks")[0].n) });
      if (o.pushFail) { throw new Error("push service down"); }
      return { sent: emails.length };
    },
    CLAUDE_API_URL: "https://claude.test/v1/messages",
    CLAUDE_MODEL: /\nvar CLAUDE_MODEL\s*=\s*"([^"]+)"/.exec(workerSrc)[1],
    APEX_TIMEZONE: "America/New_York", VOICE_MAX_AUDIO_BYTES: 8 * 1024 * 1024,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.claude.push({ url, model: body.model, prompt: body.messages[0].content, key: init.headers["x-api-key"] });
      if (o.claudeStatus !== 200) { return { ok: false, status: o.claudeStatus, json: async () => ({}) }; }
      const text = typeof o.claude === "string" ? o.claude : JSON.stringify(o.claude);
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }] }) };
    },
    console: { log: (...a) => calls.logs.push(a.join(" ")), error: (...a) => calls.logs.push(a.join(" ")), warn: (...a) => calls.logs.push(a.join(" ")) }
  });
  const F = build(
    ["taskVoiceParseTasks", "taskVoiceMatchClient", "taskVoiceToday", "taskVoicePrompt", "taskVoiceTranscribe", "taskVoiceAskClaude", "taskVoiceDumpOpen", "taskVoiceDumpSet",
     "taskAssigneeAliceName", "taskAssigneeRafaName", "taskGivenByRole", "taskVoiceOwnerRole", "taskVoicePushText", "taskVoiceNotify",
     "handlePostTasksVoice", "handlePostTasksVoiceUndo", "handleGetAllTasks", "handleGetConsultantTasks", "handleGetConsultantTasksOverdue", "handleGetClientTasks", "handlePatchTask"],
    ["TASK_VOICE_MAX_TASKS", "TASK_VOICE_MAX_PER_DAY", "TASK_VOICE_UNDO_MARK", "TASK_NOT_UNDONE_SQL", "TASK_NOT_GIVEN_SQL", "TASK_PUSH_BODY_MAX"], stubs);
  const audioReq = (bytes, lang) => ({
    url: "https://x.test/api/tasks/voice",
    formData: async () => ({ get: (k) => (k === "audio" ? { type: "audio/webm", arrayBuffer: async () => new Uint8Array(bytes === undefined ? 2048 : bytes).buffer } : (k === "lang" ? (lang || "pt") : null)) })
  });
  return { env, calls, F, audioReq, speak: (bytes, lang) => F.handlePostTasksVoice(audioReq(bytes, lang), env, o.now) };
}
const jsonReq = (body, url) => ({ url: url || "https://x.test/", json: async () => body });
const dumps = (d) => d.q("SELECT * FROM task_voice_dumps ORDER BY created_at, rowid");

// ── 1. The straight path ────────────────────────────────────────────────────
{
  const d = world(true);
  const h = harness(d, { claude: { tasks: [
    { description: "Ligar para o contador", due_date: "2026-10-05", client_name: null },
    { description: "Mandar a proposta para a Gator", due_date: null, client_name: "  gator outdoor living " },
    { description: "Preparar a mensagem de domingo", due_date: null, client_name: null }
  ] } });
  const r = await h.speak();
  ok(r.status === 200 && r.data.ok === true, "a dictation returns 200");
  ok(r.data.transcript === TRANSCRIPT, "the transcript is returned");
  ok(r.data.tasks.length === 3, "three to-dos become three tasks");
  const rows = d.q("SELECT * FROM tasks ORDER BY rowid");
  ok(rows.length === 3 && rows.every((t) => t.type === "consultant" && t.source === "voice" && t.status === "pending"), "every row is type consultant, source voice, status pending");
  ok(rows.every((t) => t.created_by === "Tester"), "created_by is the signed-in user's name");
  ok(rows.every((t) => t.session_id === null && t.completed_by === null), "no session_id and no completed_by on a voice task");
  ok(rows[0].due_date === "2026-10-05" && rows[0].due_date_source === "stated", "a stated date is saved, with due_date_source 'stated'");
  ok(rows[1].due_date === null && rows[1].due_date_source === null && rows[2].due_date === null, "no stated date leaves due_date NULL and due_date_source NULL");
  ok(rows[1].client_id === "c-gator", "a client name matching exactly one active client (case and spaces aside) sets client_id");
  ok(rows[0].client_id === null && rows[2].client_id === null, "a to-do with no client has client_id NULL");
  ok(r.data.tasks[1].client_name === "GATOR OUTDOOR LIVING" && r.data.tasks[0].client_name === null, "the response carries the client's name for the page, or null");
  ok(rows[1].description === "Mandar a proposta para a Gator", "the description is saved as returned");
  const dp = dumps(d);
  ok(dp.length === 1 && dp[0].status === "done" && Number(dp[0].tasks_created) === 3 && dp[0].transcript === TRANSCRIPT && dp[0].language === "pt" && dp[0].created_by === "Tester" && dp[0].error === null, "the dump row is closed as done with the transcript, language and tasks_created 3");
  ok(d.log.findIndex((s) => /INSERT INTO task_voice_dumps/.test(s)) >= 0 && h.calls.asr.length === 1 && d.log.findIndex((s) => /INSERT INTO task_voice_dumps/.test(s)) < d.log.findIndex((s) => /FROM clients/.test(s)), "the dump row is written before anything else is done with the audio");
  ok(h.calls.asr.length === 1 && h.calls.asr[0].model === "@cf/deepgram/nova-3" && h.calls.asr[0].language === "multi" && h.calls.asr[0].smart_format === true && h.calls.asr[0].punctuate === true && h.calls.asr[0].isStream && h.calls.asr[0].contentType === "audio/webm", "one Deepgram Nova-3 call, language 'multi', audio.body a stream");
  const realModel = /\nvar CLAUDE_MODEL\s*=\s*"([^"]+)"/.exec(workerSrc)[1];
  ok(h.calls.claude.length === 1 && h.calls.claude[0].model === realModel && h.calls.claude[0].url === "https://claude.test/v1/messages", "one Claude call, with the file's CLAUDE_MODEL (" + realModel + ")");
  const p = h.calls.claude[0].prompt;
  ok(p.indexOf("Today is Wednesday, 2026-10-07 (America/New_York).") >= 0, "the prompt gives the date and weekday of the fixed moment in America/New_York (Wednesday, 2026-10-07)");
  ok(p.indexOf("- GATOR OUTDOOR LIVING") >= 0 && p.indexOf("- JM Luxury Pools") >= 0, "the prompt lists the active clients");
  ok(p.indexOf("Old Company") < 0 && p.indexOf("Lead Company") < 0, "an archived client and a lead are not in the list");
  ok(p.indexOf('{"tasks":[{"description": string, "due_date": "YYYY-MM-DD" or null, "client_name": string or null, "for": "self" | "rafa" | "alice" | "system"}]}') >= 0, "the prompt asks for the fixed JSON shape, with \"for\"");
  ok(p.indexOf('"alice": he says Alice') >= 0 && p.indexOf("pedir para a Alice") >= 0 && p.indexOf('"system": it is something to build, fix or change') >= 0 && p.indexOf("Nicole must do it") >= 0 && p.indexOf('When unsure, use "self". Never guess.') >= 0, "the prompt says when a to-do is for Alice, for the system, or his own");
  ok(rows.every((t) => t.assigned_to === null) && r.data.tasks.every((t) => t.assigned_to === null && t.assignee_name === null), "a reply with no \"for\" hands nothing out: assigned_to NULL on every row");
  ok(h.calls.push.length === 0, "no push when nothing was handed out");
  ok(p.indexOf(TRANSCRIPT) >= 0, "the prompt carries the transcript");
  ok(h.calls.logs.every((l) => l.indexOf("contador") < 0), "the transcript is not written to the console");
  ok(!/openai|whisper|gpt-/i.test(workerSrc.slice(workerSrc.indexOf('// "SPEAK MY TASKS"'), workerSrc.indexOf("// Route: GET /api/settings/templates"))), "no OpenAI product is named in the new code");
}

// ── 1b. Midnight in Florida is not midnight in UTC ──────────────────────────
// Both moments are October 5 in UTC. Only the second is October 5 in Florida.
{
  const todayLine = async (iso) => {
    const h = harness(world(true), { now: new Date(iso), claude: { tasks: [] } });
    const r = await h.speak();
    const m = /Today is ([^.]+)\./.exec(h.calls.claude[0].prompt);
    return { status: r.status, line: m ? m[1] : null, today: h.F.taskVoiceToday(new Date(iso)) };
  };
  const late = await todayLine("2026-10-05T03:30:00Z");
  ok(late.status === 200 && late.line === "Sunday, 2026-10-04 (America/New_York)", "2026-10-05T03:30:00Z is still Sunday, 2026-10-04 (11:30 PM in Florida): " + late.line);
  ok(late.today.date === "2026-10-04" && late.today.weekday === "Sunday", "taskVoiceToday at 03:30Z: 2026-10-04, Sunday");
  const early = await todayLine("2026-10-05T04:30:00Z");
  ok(early.status === 200 && early.line === "Monday, 2026-10-05 (America/New_York)", "2026-10-05T04:30:00Z is Monday, 2026-10-05 (12:30 AM in Florida): " + early.line);
  ok(early.today.date === "2026-10-05" && early.today.weekday === "Monday", "taskVoiceToday at 04:30Z: 2026-10-05, Monday");
  // Winter time (UTC-5): 04:30Z is still the evening before.
  const winter = h_today("2026-12-01T04:30:00Z");
  ok(winter.date === "2026-11-30" && winter.weekday === "Monday", "in winter time 2026-12-01T04:30:00Z is still Monday, 2026-11-30 (11:30 PM in Florida)");
  // With no moment handed in, the real clock is used (normal use).
  // Read the clock before and after, so this holds even across midnight.
  const clock = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()) + " " + new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(new Date());
  const before = clock();
  const real = harness(world(true), {}).F.taskVoiceToday();
  const after = clock();
  ok([before, after].indexOf(real.date + " " + real.weekday) >= 0, "with no moment handed in, today comes from the real clock");
  ok(/return handlePostTasksVoice\(request, env\);/.test(workerSrc), "the router hands the route no moment, so normal use is the real clock");
}
function h_today(iso) { return harness(world(true), {}).F.taskVoiceToday(new Date(iso)); }

// ── 2. Client matching: one, two, none ──────────────────────────────────────
{
  const d = world(true);
  const h = harness(d, { claude: { tasks: [
    { description: "Call JM about the deck", due_date: null, client_name: "jm luxury pools" },
    { description: "Visit Silva Tile", due_date: null, client_name: "Silva Tile" },
    { description: "Email Acme Roofing", due_date: null, client_name: "Acme Roofing" },
    { description: "Call Old Company", due_date: null, client_name: "Old Company" },
    { description: "Call Lead Company", due_date: null, client_name: "Lead Company" },
    { description: "Something for Gator", due_date: null, client_name: "Gator" }
  ] } });
  const r = await h.speak(2048, "en");
  const by = {}; d.q("SELECT description, client_id FROM tasks").forEach((t) => { by[t.description] = t.client_id; });
  ok(r.status === 200 && by["Call JM about the deck"] === "c-jm", "exactly one match sets client_id");
  ok(by["Visit Silva Tile"] === null, "a name matching TWO active clients leaves client_id NULL");
  ok(by["Email Acme Roofing"] === null, "a name matching no client leaves client_id NULL");
  ok(by["Call Old Company"] === null && by["Call Lead Company"] === null, "an archived client and a lead are never attached");
  ok(by["Something for Gator"] === null, "a partial name is not a match (exact name only)");
  ok(Object.keys(by).length === 6, "the unmatched to-dos are still saved, with the name he said in the description");
  ok(h.F.taskVoiceMatchClient("", [{ id: "x", name: "" }]) === null && h.F.taskVoiceMatchClient(null, []) === null, "an empty name matches nothing");
}

// ── 3. The cap, and what the parser refuses to make up ──────────────────────
{
  const d = world(true);
  const many = []; for (let i = 1; i <= 37; i++) { many.push({ description: "To-do " + i, due_date: null, client_name: null }); }
  const h = harness(d, { claude: "Here you go:\n```json\n" + JSON.stringify({ tasks: many }) + "\n```" });
  const r = await h.speak();
  ok(r.status === 200 && r.data.tasks.length === 30 && d.q("SELECT COUNT(*) AS n FROM tasks")[0].n === 30, "37 to-dos are capped at 30");
  ok(r.data.truncated === true, "the response says the list was cut");
  ok(d.q("SELECT description FROM tasks ORDER BY rowid")[29].description === "To-do 30", "the first 30 are kept, in order");
  ok(Number(dumps(d)[0].tasks_created) === 30, "the dump row counts 30");

  const P = h.F.taskVoiceParseTasks;
  const one = P(JSON.stringify({ tasks: [
    { description: "  Real   one ", due_date: "2026-02-31", client_name: "  " },
    { description: "", due_date: null, client_name: null },
    { description: 42, due_date: null, client_name: null },
    { description: "Dated", due_date: "10/05/2026", client_name: 7 },
    { description: "Good date", due_date: "2026-10-09", client_name: "JM" },
    null
  ] }));
  ok(one.tasks.length === 3 && one.tasks[0].description === "Real one", "a to-do with no words is dropped; spacing is tidied");
  ok(one.tasks[0].due_date === null && one.tasks[1].due_date === null && one.tasks[2].due_date === "2026-10-09", "a date that is not a real YYYY-MM-DD day becomes NULL, never a guess");
  ok(one.tasks[0].client_name === null && one.tasks[1].client_name === null && one.tasks[2].client_name === "JM", "a blank or non-text client name becomes null");
  ok(P("I could not find any tasks.") === null && P('{"todo":[]}') === null && P("{not json") === null && P("") === null, "a reply that is not the fixed shape is refused");
  ok(P('{"tasks":[]}').tasks.length === 0, "an empty list is a valid reply");
}

// ── 4. Nothing to do ────────────────────────────────────────────────────────
{
  const d = world(true);
  const h = harness(d, { claude: { tasks: [] }, transcript: "Bom dia, tudo bem?" });
  const r = await h.speak();
  ok(r.status === 200 && r.data.tasks.length === 0 && r.data.transcript === "Bom dia, tudo bem?", "no to-dos: 200, an empty list and the transcript");
  ok(d.q("SELECT COUNT(*) AS n FROM tasks")[0].n === 0 && dumps(d)[0].status === "done" && Number(dumps(d)[0].tasks_created) === 0, "no task row; the dump row is done with tasks_created 0");
}

// ── 5. Claude fails ─────────────────────────────────────────────────────────
{
  const d = world(true);
  const h = harness(d, { claudeStatus: 529 });
  const r = await h.speak();
  ok(r.status === 502 && !!r.error && !!r.error_pt, "a Claude failure returns a plain error in both languages");
  ok(r.transcript === TRANSCRIPT, "a Claude failure returns the transcript");
  const dp = dumps(d);
  ok(dp.length === 1 && dp[0].status === "failed" && /extraction: Claude API error 529/.test(dp[0].error) && dp[0].transcript === TRANSCRIPT, "a Claude failure keeps the dump row as failed, with the error and the transcript");
  ok(d.q("SELECT COUNT(*) AS n FROM tasks")[0].n === 0, "a Claude failure creates no task");

  const d2 = world(true);
  const h2 = harness(d2, { claude: "Sorry, I cannot help with that." });
  const r2 = await h2.speak();
  ok(r2.status === 502 && r2.transcript === TRANSCRIPT && dumps(d2)[0].status === "failed" && d2.q("SELECT COUNT(*) AS n FROM tasks")[0].n === 0, "a Claude reply that is not JSON: failed dump row, transcript returned, no task");
}

// ── 6. Transcription fails, or hears nothing ────────────────────────────────
{
  const d = world(true);
  const h = harness(d, { asrFail: () => true });
  const r = await h.speak(2048, "en");
  ok(r.status === 502 && !!r.error && r.transcript === undefined, "a transcription failure returns a plain error (there is no transcript to return)");
  ok(h.calls.asr.length === 2 && h.calls.asr[0].language === "multi" && h.calls.asr[1].language === "en", "if 'multi' is refused the page's language is tried once (en)");
  ok(dumps(d)[0].status === "failed" && /transcription/.test(dumps(d)[0].error) && h.calls.claude.length === 0, "the dump row is failed and Claude is never called");

  const d2 = world(true);
  const h2 = harness(d2, { asrFail: (l) => l === "multi", claude: { tasks: [{ description: "Ligar", due_date: null, client_name: null }] } });
  const r2 = await h2.speak(2048, "pt");
  ok(r2.status === 200 && h2.calls.asr[1].language === "pt-BR" && r2.data.tasks.length === 1, "the fallback call (pt-BR) still produces tasks");

  const d3 = world(true);
  const h3 = harness(d3, { transcript: "   " });
  const r3 = await h3.speak();
  ok(r3.status === 422 && dumps(d3)[0].status === "failed" && dumps(d3)[0].error === "nothing heard" && h3.calls.claude.length === 0, "silence: 422, failed dump row, no Claude call");
}

// ── 7. BEFORE the migration: the live table as it is today ──────────────────
{
  const d = world(false);
  const h = harness(d, { claude: { tasks: [{ description: "Ligar para o contador", due_date: null, client_name: null }, { description: "Proposta Gator", due_date: null, client_name: "GATOR OUTDOOR LIVING" }] } });
  const r = await h.speak();
  ok(r.status === 500 && !!r.error && !!r.error_pt, "before the migration: a plain error, not a crash");
  ok(r.transcript === TRANSCRIPT, "before the migration: the transcript is returned to the page");
  ok(d.q("SELECT COUNT(*) AS n FROM tasks")[0].n === 0, "before the migration: no task row at all (all or none)");
  ok(/Nothing was added/.test(r.error), "before the migration: the message says nothing was added");
}
// The migration half-applied in spirit: dumps table present, tasks still strict.
{
  const d = world(false);
  d.raw.exec("CREATE TABLE task_voice_dumps (id TEXT PRIMARY KEY, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), language TEXT, transcript TEXT, status TEXT NOT NULL DEFAULT 'received', error TEXT, tasks_created INTEGER NOT NULL DEFAULT 0)");
  const h = harness(d, { claude: { tasks: [{ description: "Ligar para o contador", due_date: null, client_name: null }] } });
  const r = await h.speak();
  const dp = dumps(d);
  ok(r.status === 500 && r.transcript === TRANSCRIPT && dp[0].status === "failed" && /^insert: /.test(dp[0].error) && dp[0].transcript === TRANSCRIPT, "an insert the table refuses: the dictation is kept in task_voice_dumps as failed, and returned");
}
// One bad row fails the whole batch.
{
  const d = world(true);
  d.raw.exec("CREATE TRIGGER t_block BEFORE INSERT ON tasks WHEN NEW.description = 'BOOM' BEGIN SELECT RAISE(ABORT, 'blocked'); END");
  const h = harness(d, { claude: { tasks: [{ description: "First", due_date: null, client_name: null }, { description: "BOOM", due_date: null, client_name: null }] } });
  const r = await h.speak();
  ok(r.status === 500 && d.q("SELECT COUNT(*) AS n FROM tasks")[0].n === 0 && dumps(d)[0].status === "failed", "if one insert fails, none of that dictation's tasks is kept");
}

// ── 8. Who may use it, and the limits ───────────────────────────────────────
{
  const d = world(true);
  for (const role of ["rafa", "alice", "developer"]) {
    const r = await harness(d, { role, name: "U-" + role, claude: { tasks: [] } }).speak();
    ok(r.status === 200, "role " + role + " may dictate");
  }
  for (const role of ["client", "seller", "vault-service"]) {
    const h = harness(d, { role });
    const r = await h.speak();
    ok(r.status === 403 && h.calls.asr.length === 0, "role " + role + " is refused before any audio is processed");
  }
  const h0 = harness(d, { role: null });
  ok((await h0.speak()).status === 401, "not signed in is refused");

  const big = harness(world(true), {});
  const rb = await big.speak(8 * 1024 * 1024 + 1);
  ok(rb.status === 413 && !!rb.error_pt && big.calls.asr.length === 0, "audio over 8 MB is refused with a plain message, before transcription");
  ok((await big.speak(0)).status === 400, "empty audio is refused");

  const d2 = world(true);
  const ins = d2.raw.prepare("INSERT INTO task_voice_dumps (id, created_by, created_at) VALUES (?,?,datetime('now', ?))");
  for (let i = 0; i < 40; i++) { ins.run("old-" + i, "Tester", "-" + (i + 1) + " minutes"); }
  const h2 = harness(d2, { claude: { tasks: [] } });
  const r2 = await h2.speak();
  ok(r2.status === 429 && !!r2.error && !!r2.error_pt && h2.calls.asr.length === 0, "the 41st dictation in 24 hours is refused with a plain message, before transcription");
  ok((await harness(d2, { name: "Someone Else", claude: { tasks: [] } }).speak()).status === 200, "the limit is per user");
  d2.raw.exec("UPDATE task_voice_dumps SET created_at = datetime('now', '-25 hours') WHERE id LIKE 'old-%'");
  ok((await harness(d2, { claude: { tasks: [] } }).speak()).status === 200, "dictations older than 24 hours no longer count");
}

// ── 9. Undo ─────────────────────────────────────────────────────────────────
{
  const d = world(true);
  const h = harness(d, { claude: { tasks: [{ description: "A", due_date: null, client_name: null }, { description: "B", due_date: null, client_name: null }, { description: "C", due_date: null, client_name: null }] } });
  const r = await h.speak();
  const ids = r.data.tasks.map((t) => t.id);
  d.raw.exec("INSERT INTO tasks (id, client_id, type, description, source, session_id) VALUES ('s1', 'c-jm', 'consultant', 'From a session', 'session', 'sess1')");
  d.raw.exec("INSERT INTO tasks (id, client_id, type, description, source, created_by) VALUES ('v-other', NULL, 'consultant', 'Someone else', 'voice', 'Other Person')");
  const u = await h.F.handlePostTasksVoiceUndo(jsonReq({ ids: [ids[0], ids[1], "s1", "v-other", "nope"] }), h.env);
  ok(u.status === 200 && u.data.undone === 2, "undo closes exactly the voice tasks named (2), nothing else");
  const st = {}; d.q("SELECT id, status, completed_by FROM tasks").forEach((t) => { st[t.id] = t; });
  ok(st[ids[0]].status === "done" && st[ids[0]].completed_by === "voice-undo" && st[ids[1]].completed_by === "voice-undo", "an undone task is done with completed_by 'voice-undo' (tasks are never deleted)");
  ok(st[ids[2]].status === "pending" && st.s1.status === "pending" && st["v-other"].status === "pending", "the third task, a session task and another person's task are untouched");
  ok(d.q("SELECT COUNT(*) AS n FROM tasks")[0].n === 5, "undo deletes no row");
  ok((await h.F.handlePostTasksVoiceUndo(jsonReq({ ids: [] }), h.env)).status === 400 && (await h.F.handlePostTasksVoiceUndo(jsonReq({ ids: new Array(31).fill("x") }), h.env)).status === 400, "undo refuses an empty list and more than 30 ids");
  ok((await harness(d, { role: "client" }).F.handlePostTasksVoiceUndo(jsonReq({ ids: [ids[2]] }), h.env)).status === 403, "undo is staff only");

  // ── 10. The read routes cope with a task that has no client ───────────────
  const all = await h.F.handleGetAllTasks(jsonReq({}), h.env);
  const list = all.data.tasks;
  ok(all.status === 200 && list.some((t) => t.id === ids[2] && t.client_id === null && t.client_name === null), "GET /api/tasks lists a task with no client (client_name null, not dropped by the join)");
  ok(list.every((t) => t.id !== ids[0] && t.id !== ids[1]), "GET /api/tasks does not list an undone dictation");
  ok(list.find((t) => t.id === ids[2]).source === "voice" && list.find((t) => t.id === "s1").source === "session", "GET /api/tasks returns source");
  ok(list.find((t) => t.id === "s1").client_name === "JM Luxury Pools", "a task with a client still carries its client's name");

  d.raw.exec("UPDATE tasks SET due_date = '2020-01-01' WHERE id = '" + ids[2] + "'");
  const od = await h.F.handleGetConsultantTasksOverdue(jsonReq({}), h.env);
  ok(od.status === 200 && od.data.tasks.some((t) => t.id === ids[2] && t.client_name === null), "the overdue list counts an overdue task with no client");
  const today = new Date().toISOString().split("T")[0];
  d.raw.exec("UPDATE tasks SET due_date = '" + today + "'");
  const td = await h.F.handleGetConsultantTasks(jsonReq({}, "https://x.test/api/tasks/consultant?scope=today"), h.env);
  ok(td.status === 200 && td.data.tasks.some((t) => t.id === ids[2]) && td.data.tasks.every((t) => t.id !== ids[0]), "today's consultant tasks include one with no client and leave out an undone one");
  const tv = await h.F.handleGetConsultantTasks(jsonReq({}, "https://x.test/api/tasks/consultant?scope=week&source=voice"), h.env);
  ok(tv.status === 200 && tv.data.tasks.every((t) => t.source === "voice"), "source=voice is accepted as a filter");

  for (const cid of ["c-gator", "c-jm", "c-twin-1", "null", ""]) {
    const cr = await h.F.handleGetClientTasks(cid, jsonReq({}, "https://x.test/api/clients/" + cid + "/tasks"), h.env);
    ok(cr.status === 200 && cr.data.tasks.every((t) => t.client_id === cid && t.client_id !== null), "a client's own task list (" + (cid || "empty id") + ") never shows a task with no client");
  }
}

// ── 11. Handing a to-do to Alice or to the system ───────────────────────────
const T = (description, who, due) => { const t = { description, due_date: due || null, client_name: null }; if (who !== undefined) { t["for"] = who; } return t; };
{
  const d = world(true);
  const h = harness(d, { name: "Rafa", claude: { tasks: [
    T("Pedir para a Alice fazer 1 follow up com a contabilidade sobre a Beraca", "alice"),
    T("No sistema precisa aparecer o telefone do cliente", "system"),
    T("Ligar para o contador"),
    T("Odd value in capitals", "ALICE"),
    T("A name that is not a choice", "nicole"),
    T("Not text at all", 42),
    T("Explicitly his own", "self")
  ] } });
  const r = await h.speak();
  const rows = d.q("SELECT * FROM tasks ORDER BY rowid");
  ok(r.status === 200 && rows.length === 7, "seven to-dos are saved");
  ok(rows[0].assigned_to === "alice", "\"for\":\"alice\" inserts assigned_to 'alice'");
  ok(rows[1].assigned_to === "developer", "\"for\":\"system\" inserts assigned_to 'developer'");
  ok(rows[2].assigned_to === null, "a missing \"for\" inserts assigned_to NULL");
  ok(rows[3].assigned_to === null && rows[4].assigned_to === null && rows[5].assigned_to === null, "an odd \"for\" (\"ALICE\", \"nicole\", 42) inserts assigned_to NULL");
  ok(rows[6].assigned_to === null, "\"for\":\"self\" inserts assigned_to NULL");
  ok(rows.every((t) => t.type === "consultant" && t.source === "voice" && t.status === "pending" && t.created_by === "Rafa"), "a handed-out task is otherwise the same row: consultant, voice, pending, created_by him");
  ok(rows[0].description === "Pedir para a Alice fazer 1 follow up com a contabilidade sobre a Beraca", "the description keeps his own words");
  const out = r.data.tasks;
  ok(out[0].assigned_to === "alice" && out[1].assigned_to === "developer" && out[2].assigned_to === null, "each returned task carries assigned_to");
  ok(out[0].assignee_name === "Pra. Alice", "assignee_name for Alice is the first non-empty display_name of a role alice user: " + out[0].assignee_name);
  ok(out[1].assignee_name === null && out[2].assignee_name === null, "assignee_name is null for the system and for his own tasks");
  ok(JSON.stringify(out).indexOf("The Developer") < 0, "the developer's name is nowhere in the response");

  ok(h.calls.push.length === 2, "one push per role: two calls for one dictation (" + h.calls.push.length + ")");
  const pa = h.calls.push.find((c) => c.payload.title === "Nova tarefa");
  const pd = h.calls.push.find((c) => c.payload.title === "New system task");
  ok(!!pa && pa.emails.slice().sort().join(",") === "a-first@x.test,b-second@x.test", "the Alice push goes to every user with role alice (both rows), and nobody else");
  ok(!!pa && pa.payload.body === rows[0].description && pa.payload.url === "/dashboard.html" && pa.payload.tag === "apex-assigned-tasks", "one task for Alice: title 'Nova tarefa', body the description, url /dashboard.html, tag apex-assigned-tasks");
  ok(!!pd && pd.emails.join(",") === "dev@x.test", "the system push goes to every user with role developer, and nobody else");
  ok(!!pd && pd.payload.body === rows[1].description && pd.payload.url === "/dashboard.html" && pd.payload.tag === "apex-assigned-tasks", "one system task: title 'New system task', body the description");
  ok(h.calls.push.every((c) => c.tasksSaved === 7), "each push is sent after all seven rows are saved, never before");
  ok(dumps(d)[0].status === "done" && Number(dumps(d)[0].tasks_created) === 7, "the dump row is closed as done before the push");

  // Undo still works for what was handed out.
  const u = await h.F.handlePostTasksVoiceUndo(jsonReq({ ids: [out[0].id, out[1].id] }), h.env);
  const after = d.q("SELECT id, status, completed_by FROM tasks WHERE assigned_to IS NOT NULL");
  ok(u.status === 200 && u.data.undone === 2 && after.every((t) => t.status === "done" && t.completed_by === "voice-undo"), "undo closes handed-out tasks too (2 undone)");
}
// More than one for each: one push per role, with the count.
{
  const d = world(true);
  const long = "Uma tarefa bem comprida para a Alice que passa do tamanho de um aviso ".repeat(3).trim();
  const h = harness(d, { claude: { tasks: [
    T("Alice precisa ligar para o banco", "alice"), T(long, "alice"),
    T("Fix the invoice total", "system"), T("Add a phone field", "system"), T("Change the logo", "system"),
    T("Mine")
  ] } });
  const r = await h.speak();
  ok(r.status === 200 && h.calls.push.length === 2, "five handed-out tasks are still two pushes, one per role");
  const pa = h.calls.push.find((c) => /novas tarefas$/.test(c.payload.title));
  const pd = h.calls.push.find((c) => /new system tasks$/.test(c.payload.title));
  ok(!!pa && pa.payload.title === "2 novas tarefas", "two for Alice: title '2 novas tarefas'");
  ok(!!pd && pd.payload.title === "3 new system tasks", "three for the system: title '3 new system tasks'");
  ok(!!pd && pd.payload.body === "Fix the invoice total · Add a phone field · Change the logo", "the body is the descriptions joined with ' · ': " + (pd && pd.payload.body));
  const full = "Alice precisa ligar para o banco · " + long;
  ok(!!pa && full.length > 160 && pa.payload.body.length === 160 && pa.payload.body === full.slice(0, 160), "a long body is cut at 160 characters (" + (pa && pa.payload.body.length) + ")");
  ok(pa.payload.body.indexOf("Mine") < 0 && pd.payload.body.indexOf("Mine") < 0, "his own task is in neither push");
}
// Only Alice: no push to the developer. Only his own: none at all.
{
  const h1 = harness(world(true), { claude: { tasks: [T("Pra. Alice precisa mandar o recibo", "alice"), T("Mine")] } });
  await h1.speak();
  ok(h1.calls.push.length === 1 && h1.calls.push[0].payload.title === "Nova tarefa", "only Alice was handed something: one push, to Alice");
  const h2 = harness(world(true), { claude: { tasks: [T("Mine"), T("Also mine", "self")] } });
  await h2.speak();
  ok(h2.calls.push.length === 0, "nothing handed out: no push");
}
// The insert fails: no push, ever.
{
  const d = world(true);
  d.raw.exec("CREATE TRIGGER t_block2 BEFORE INSERT ON tasks WHEN NEW.description = 'BOOM' BEGIN SELECT RAISE(ABORT, 'blocked'); END");
  const h = harness(d, { claude: { tasks: [T("Alice precisa ver isso", "alice"), T("BOOM", "system")] } });
  const r = await h.speak();
  ok(r.status === 500 && d.q("SELECT COUNT(*) AS n FROM tasks")[0].n === 0 && h.calls.push.length === 0, "when the insert fails nothing is saved and NO push is sent");
  const hb = harness(world(false), { claude: { tasks: [T("Alice precisa ver isso", "alice")] } });
  const rb = await hb.speak();
  ok(rb.status === 500 && hb.calls.push.length === 0, "a table without the column: a plain error, no push");
}
// The push throws: the tasks are still saved and returned.
{
  const d = world(true);
  const h = harness(d, { pushFail: true, claude: { tasks: [T("Alice precisa ligar para o banco", "alice"), T("Fix the invoice total", "system")] } });
  const r = await h.speak();
  ok(r.status === 200 && r.data.ok === true && r.data.tasks.length === 2, "a push that throws still returns 200 and the tasks");
  ok(d.q("SELECT COUNT(*) AS n FROM tasks")[0].n === 2 && dumps(d)[0].status === "done", "a push that throws loses no task and leaves the dump row done");
  ok(h.calls.push.length === 2, "a failed push to Alice does not stop the push to the developer");
  ok(h.calls.logs.every((l) => l.indexOf("banco") < 0 && l.indexOf("invoice") < 0), "a failed push writes none of his words to the console");
}
// Nobody holds the role: pushToUsers is never called with an empty list
// (an empty list there means every device).
{
  const d = world(true);
  d.raw.exec("DELETE FROM users WHERE role IN ('alice', 'developer')");
  const h = harness(d, { claude: { tasks: [T("Alice precisa ligar", "alice"), T("Fix it", "system")] } });
  const r = await h.speak();
  ok(r.status === 200 && h.calls.push.length === 0, "no user with the role: no push call at all (never the send-to-everyone call)");
  ok(r.data.tasks[0].assignee_name === "Alice", "no display_name to use: assignee_name falls back to 'Alice'");
  const d2 = world(true);
  d2.raw.exec("DROP TABLE users");
  const h2 = harness(d2, { claude: { tasks: [T("Alice precisa ligar", "alice")] } });
  const r2 = await h2.speak();
  ok(r2.status === 200 && r2.data.tasks[0].assignee_name === "Alice" && d2.q("SELECT COUNT(*) AS n FROM tasks")[0].n === 1, "the users table cannot be read: the task is saved anyway, named 'Alice'");
}
// The parser on its own.
{
  const P = harness(world(true), {}).F.taskVoiceParseTasks;
  const got = P(JSON.stringify({ tasks: [T("a", "alice"), T("b", "system"), T("c", "self"), T("d"), T("e", "developer"), T("f", " alice "), T("g", null), T("h", ["alice"]), T("i", "rafa"), T("j", "Rafa")] })).tasks.map((t) => t["for"]);
  ok(got.join(",") === "alice,system,self,self,self,self,self,self,rafa,self", "taskVoiceParseTasks: only exactly \"rafa\", \"alice\" or \"system\" pass; anything else is \"self\": " + got.join(","));
}

// ── 12. The readers: his own lists leave handed-out tasks out ───────────────
{
  const d = world(true);
  const h = harness(d, {});
  const today = new Date().toISOString().split("T")[0];
  const ins = d.raw.prepare("INSERT INTO tasks (id, client_id, type, description, due_date, status, source, created_by, assigned_to, completed_by, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  ins.run("own-today", null, "consultant", "His own, today", today, "pending", "voice", "Rafa", null, null, null, "2026-10-01 10:00:00");
  ins.run("al-today", null, "consultant", "For Alice, today", today, "pending", "voice", "Rafa", "alice", null, null, "2026-10-01 10:01:00");
  ins.run("sys-today", "c-jm", "consultant", "For the system, today", today, "pending", "voice", "Rafa", "developer", null, null, "2026-10-01 10:02:00");
  ins.run("own-late", null, "consultant", "His own, late", "2020-01-01", "pending", "voice", "Rafa", null, null, null, "2026-10-01 10:03:00");
  ins.run("al-late", null, "consultant", "For Alice, late", "2020-01-01", "pending", "voice", "Rafa", "alice", null, null, "2026-10-01 10:04:00");
  ins.run("sys-late", null, "consultant", "For the system, late", "2020-01-02", "pending", "voice", "Rafa", "developer", null, null, "2026-10-01 10:05:00");
  ins.run("al-done", null, "consultant", "For Alice, done", "2026-10-06", "done", "voice", "Rafa", "alice", "alice", "2026-10-07T15:00:00.000Z", "2026-10-01 10:06:00");
  ins.run("al-undone", null, "consultant", "For Alice, undone", null, "done", "voice", "Rafa", "alice", "voice-undo", "2026-10-07T15:00:00.000Z", "2026-10-01 10:07:00");
  const ids = (r) => r.data.tasks.map((t) => t.id).sort().join(",");

  const td = await h.F.handleGetConsultantTasks(jsonReq({}, "https://x.test/api/tasks/consultant?scope=today"), h.env);
  ok(td.status === 200 && ids(td) === "own-today", "today's consultant tasks leave out the ones handed to Alice and to the system: " + ids(td));
  const wk = await h.F.handleGetConsultantTasks(jsonReq({}, "https://x.test/api/tasks/consultant?scope=week"), h.env);
  ok(wk.status === 200 && wk.data.tasks.every((t) => t.id.indexOf("own-") === 0) && wk.data.tasks.some((t) => t.id === "own-today"), "this week's consultant tasks leave out handed-out tasks: " + ids(wk));
  const wv = await h.F.handleGetConsultantTasks(jsonReq({}, "https://x.test/api/tasks/consultant?scope=week&source=voice"), h.env);
  ok(wv.status === 200 && wv.data.tasks.every((t) => t.id.indexOf("own-") === 0), "the source filter still leaves handed-out tasks out");
  const od = await h.F.handleGetConsultantTasksOverdue(jsonReq({}), h.env);
  ok(od.status === 200 && ids(od) === "own-late" && od.data.count === 1, "the overdue list and its count leave out handed-out tasks: " + ids(od) + " (count " + od.data.count + ")");

  const all = await h.F.handleGetAllTasks(jsonReq({}), h.env);
  const by = {}; all.data.tasks.forEach((t) => { by[t.id] = t; });
  ok(all.status === 200 && all.data.tasks.every((t) => "assigned_to" in t && "assignee_name" in t), "GET /api/tasks returns assigned_to and assignee_name on every task");
  ok(by["al-today"].assigned_to === "alice" && by["al-today"].assignee_name === "Pra. Alice", "GET /api/tasks: a task for Alice carries her display name");
  ok(by["sys-today"].assigned_to === "developer" && by["sys-today"].assignee_name === null && by["sys-today"].client_name === "JM Luxury Pools", "GET /api/tasks: a system task carries no name (and still its client)");
  ok(by["own-today"].assigned_to === null && by["own-today"].assignee_name === null, "GET /api/tasks: his own task has assigned_to null and assignee_name null");
  ok(!!by["al-done"] && by["al-done"].status === "done" && by["al-done"].completed_by === "alice" && by["al-done"].updated_at === "2026-10-07T15:00:00.000Z", "GET /api/tasks returns a handed-out task that is DONE, with completed_by and updated_at");
  ok(!by["al-undone"], "GET /api/tasks never returns a task undone by voice");
  ok(JSON.stringify(all.data).indexOf("The Developer") < 0, "GET /api/tasks never carries the developer's name");

  // Marking done: who may, and what completed_by records.
  const patch = (role, id, status) => harness(d, { role }).F.handlePatchTask(id, jsonReq({ status: status || "done" }), h.env);
  const p1 = await patch("alice", "al-today");
  const a1 = d.q("SELECT status, completed_by, updated_at FROM tasks WHERE id = 'al-today'")[0];
  ok(p1.status === 200 && a1.status === "done" && a1.completed_by === "alice" && /^\d{4}-\d{2}-\d{2}T/.test(a1.updated_at), "role alice can mark her task done; completed_by is 'alice' and updated_at is set");
  const p2 = await patch("developer", "sys-today");
  const a2 = d.q("SELECT status, completed_by FROM tasks WHERE id = 'sys-today'")[0];
  ok(p2.status === 200 && a2.status === "done" && a2.completed_by === "developer", "role developer can mark a system task done; completed_by is 'developer'");
  ok((await patch("client", "al-late")).status === 403 && (await patch("seller", "al-late")).status === 403, "a client or a seller cannot mark a task done");
}

// ── 13. dashboard.html: the rule for a done row, and the two copies ─────────
{
  const rootHtml = readFileSync(new URL("dashboard.html", root), "utf8");
  const iosHtml = readFileSync(new URL("ios/App/App/public/dashboard.html", root), "utf8");
  const cut = (html, name) => {
    const i = html.indexOf("\n    function " + name + "(");
    if (i < 0) { throw new Error("not found in dashboard.html: " + name); }
    return html.slice(i + 1, html.indexOf("\n    }\n", i) + 6);
  };
  const names = ["mtNyDay", "mtGivenDoneStillShown", "renderMyGivenList", "buildMyTaskRow", "placeAssignedTasksCard", "loadAssignedTasks", "renderAssignedTasks", "markAssignedTaskDone"];
  ok(names.every((n) => cut(rootHtml, n) === cut(iosHtml, n)), "the root and iOS copies of dashboard.html carry the same new functions");
  for (const id of ["assignedTasksCard", "atTitle", "atStatus", "atList", "mtGivenList", "devBelowSection"]) {
    ok(rootHtml.split('id="' + id + '"').length === 2 && iosHtml.split('id="' + id + '"').length === 2, "id=\"" + id + "\" is in both copies, once");
  }
  for (const [label, html] of [["dashboard.html", rootHtml], ["ios/App/App/public/dashboard.html", iosHtml]]) {
    let n = 0, bad = 0;
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      n++;
      try { new Function(m[1]); } catch (e) { bad++; console.log("      " + label + " inline script " + n + ": " + e.message); }
    }
    ok(n > 0 && bad === 0, label + ": all " + n + " inline scripts parse");
  }
  const { mtNyDay, mtGivenDoneStillShown: shown } = new Function(cut(rootHtml, "mtNyDay") + "\n" + cut(rootHtml, "mtGivenDoneStillShown") + "\nreturn { mtNyDay, mtGivenDoneStillShown };")();

  // No due date: the day it was done decides. Done 10/07 -> listed 10/07, 10/08, 10/09; gone 10/10.
  ok(shown(null, "2026-10-07", "2026-10-07") === true, "done 10/07, no due date: listed the same day");
  ok(shown(null, "2026-10-07", "2026-10-08") === true && shown(null, "2026-10-07", "2026-10-09") === true, "done 10/07: still listed 10/08 and 10/09 (the two full days after)");
  ok(shown(null, "2026-10-07", "2026-10-10") === false, "done 10/07: no longer listed on 10/10");
  // Due date later than the done day: the due date decides.
  ok(shown("2026-10-12", "2026-10-07", "2026-10-14") === true && shown("2026-10-12", "2026-10-07", "2026-10-15") === false, "done 10/07 but due 10/12: listed through 10/14, gone 10/15 (the LATER of the two)");
  // Done day later than the due date: the done day decides.
  ok(shown("2026-10-01", "2026-10-07", "2026-10-09") === true && shown("2026-10-01", "2026-10-07", "2026-10-10") === false, "due 10/01 but done 10/07: listed through 10/09, gone 10/10");
  ok(shown("2026-10-07", "2026-10-07", "2026-10-09") === true && shown("2026-10-07", "2026-10-07", "2026-10-10") === false, "due and done the same day: listed through the second day after");
  // Month and year ends, and a leap day.
  ok(shown(null, "2026-10-30", "2026-11-01") === true && shown(null, "2026-10-30", "2026-11-02") === false, "across a month end: done 10/30, listed through 11/01, gone 11/02");
  ok(shown(null, "2026-12-31", "2027-01-02") === true && shown(null, "2026-12-31", "2027-01-03") === false, "across a year end: done 12/31, listed through 01/02, gone 01/03");
  ok(shown(null, "2028-02-28", "2028-03-01") === true && shown(null, "2028-02-28", "2028-03-02") === false, "across a leap day: done 02/28/2028, listed through 03/01, gone 03/02");
  // Nothing to go on.
  ok(shown(null, "", "2026-10-07") === false && shown("", null, "2026-10-07") === false && shown(undefined, undefined, "2026-10-07") === false, "no due date and no done day: not listed");
  ok(shown("10/07/2026", "not a date", "2026-10-07") === false, "dates that are not YYYY-MM-DD are not used");
  ok(shown("2026-10-12", "", "2026-10-14") === true && shown("2026-10-12", "", "2026-10-15") === false, "no done day known: the due date alone decides");
  ok(shown(null, "2026-10-07", "") === false, "no today: not listed");

  // The day it was marked done, in America/New_York.
  ok(mtNyDay("2026-10-08T03:30:00.000Z") === "2026-10-07", "marked done at 2026-10-08T03:30Z is 10/07 in Florida (11:30 PM): " + mtNyDay("2026-10-08T03:30:00.000Z"));
  ok(mtNyDay("2026-10-08T04:30:00.000Z") === "2026-10-08", "marked done at 2026-10-08T04:30Z is 10/08 in Florida (12:30 AM)");
  ok(mtNyDay("2026-10-08 03:30:00") === "2026-10-07", "a bare database timestamp is read as UTC");
  ok(mtNyDay("2026-12-01T04:30:00Z") === "2026-11-30", "winter time: 2026-12-01T04:30Z is still 11/30 in Florida");
  ok(mtNyDay(new Date("2026-10-07T16:00:00Z")) === "2026-10-07", "a Date is accepted (today)");
  ok(mtNyDay("") === "" && mtNyDay(null) === "" && mtNyDay("nonsense") === "", "an empty or unreadable timestamp gives no day");
  ok(!/\b(confirm|alert|prompt)\s*\(/.test(names.map((n) => cut(rootHtml, n)).join("\n")), "no browser pop-up in the new dashboard code");
}

// ── 14. completed_at: the moment a task was marked done ─────────────────────
{
  const d = world(true);
  const h = harness(d, { name: "Rafa", claude: { tasks: [T("Alice precisa ligar", "alice"), T("Fix it", "system"), T("Mine"), T("To undo", "alice")] } });
  const r = await h.speak();
  const [idA, idS, idM, idU] = r.data.tasks.map((t) => t.id);
  const row = (id) => d.q("SELECT status, completed_by, completed_at, updated_at FROM tasks WHERE id = ?", id)[0];
  const patch = (role, id, status) => harness(d, { role }).F.handlePatchTask(id, jsonReq({ status }), h.env);
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  ok(d.q("SELECT COUNT(*) AS n FROM tasks WHERE completed_at IS NOT NULL")[0].n === 0, "a new task has no completed_at");

  const before = Date.now();
  const p1 = await patch("alice", idA, "done");
  const after = Date.now();
  const a = row(idA);
  ok(p1.status === 200 && a.status === "done" && ISO.test(a.completed_at || ""), "marking a task done sets completed_at to a UTC time: " + a.completed_at);
  ok(new Date(a.completed_at).getTime() >= before && new Date(a.completed_at).getTime() <= after, "completed_at is the moment it was marked done (now)");
  ok(a.completed_at === a.updated_at && a.completed_by === "alice", "completed_at is written in the same statement as the status (same moment as updated_at), with completed_by");
  ok(d.log.some((s) => /UPDATE tasks SET status = \?, completed_by = \?, completed_at = \?, updated_at = \? WHERE id = \?/.test(s)), "PATCH is one UPDATE that carries status and completed_at together");

  const p2 = await patch("alice", idA, "pending");
  const a2 = row(idA);
  ok(p2.status === 200 && a2.status === "pending" && a2.completed_at === null && a2.completed_by === null, "setting a task back to pending clears completed_at (and completed_by)");
  await patch("developer", idS, "done");
  ok(ISO.test(row(idS).completed_at || "") && row(idS).completed_by === "developer", "the developer marking a system task done sets completed_at");
  await patch("rafa", idM, "done");
  ok(ISO.test(row(idM).completed_at || ""), "his own task marked done sets completed_at too (every task, not only handed-out ones)");
  ok(row(idU).completed_at === null, "a task nobody touched still has no completed_at");

  // The request a cached page sends is unchanged: { status } and nothing else.
  const old = await harness(d, { role: "rafa" }).F.handlePatchTask(idM, { url: "https://x.test/", json: async () => ({ status: "pending" }) }, h.env);
  ok(old.status === 200 && old.data.ok === true && old.data.status === "pending" && row(idM).completed_at === null, "the same { status } body an old page sends still works, and the answer has the same shape");

  const u = await h.F.handlePostTasksVoiceUndo(jsonReq({ ids: [idU] }), h.env);
  const un = row(idU);
  ok(u.status === 200 && u.data.undone === 1 && un.status === "done" && un.completed_by === "voice-undo" && ISO.test(un.completed_at || "") && un.completed_at === un.updated_at, "voice undo sets completed_at in the same statement as status 'done'");

  await patch("alice", idA, "done");
  const all = await h.F.handleGetAllTasks(jsonReq({}), h.env);
  const by = {}; all.data.tasks.forEach((t) => { by[t.id] = t; });
  ok(all.data.tasks.every((t) => "completed_at" in t), "GET /api/tasks returns completed_at on every task");
  ok(by[idA].completed_at === row(idA).completed_at && by[idM].completed_at === null, "GET /api/tasks: the done task carries its completed_at, the open one null");
  ok(!by[idU], "GET /api/tasks still never returns the undone task");

  // Every statement in the Worker that sets a task done also sets completed_at.
  const setsDone = [...workerSrc.matchAll(/"UPDATE tasks SET status = [^"]*"/g)].map((m) => m[0]);
  ok(setsDone.length === 2 && setsDone.every((s) => /completed_at = \?/.test(s)), "the Worker has exactly two statements that set a task's status, and both set completed_at (" + setsDone.length + ")");
}

// ── 15. The done date and time on screen, and tasks.html ────────────────────
{
  const dt = readFileSync(new URL("datetime.js", root), "utf8");
  const iosDt = readFileSync(new URL("ios/App/App/public/datetime.js", root), "utf8");
  ok(dt === iosDt, "datetime.js (the formatter both pages call) is the same in root and iOS");
  const { formatDateTimeUTC: fmt, formatDateUTC: fmtDay } = new Function(dt + "\nreturn { formatDateTimeUTC, formatDateUTC };")();
  ok(fmt("2026-10-07T16:00:00.000Z") === "10/07/2026 12:00 PM", "noon in New York: " + fmt("2026-10-07T16:00:00.000Z"));
  ok(fmt("2026-10-07T04:00:00.000Z") === "10/07/2026 12:00 AM", "midnight in New York is 12:00 AM, not 0:00 or 24:00: " + fmt("2026-10-07T04:00:00.000Z"));
  ok(fmt("2026-10-08T02:15:00.000Z") === "10/07/2026 10:15 PM", "a UTC time on 10/08 that is still 10/07 in New York: " + fmt("2026-10-08T02:15:00.000Z"));
  ok(fmt("2026-10-07T18:05:00.000Z") === "10/07/2026 2:05 PM", "an afternoon time is 12-hour with PM and a two-digit minute: " + fmt("2026-10-07T18:05:00.000Z"));
  ok(fmt("2026-12-01T04:30:00.000Z") === "11/30/2026 11:30 PM", "winter time (UTC-5): " + fmt("2026-12-01T04:30:00.000Z"));
  ok(fmt("2026-10-08 02:15:00") === "10/07/2026 10:15 PM", "a bare database timestamp is read as UTC");
  ok(fmtDay("2026-10-08T02:15:00.000Z") === "10/07/2026", "the date-only fallback (an old row with no completed_at) is the New York day: " + fmtDay("2026-10-08T02:15:00.000Z"));

  const html = { "dashboard.html": [readFileSync(new URL("dashboard.html", root), "utf8"), readFileSync(new URL("ios/App/App/public/dashboard.html", root), "utf8")],
                 "tasks.html": [readFileSync(new URL("tasks.html", root), "utf8"), readFileSync(new URL("ios/App/App/public/tasks.html", root), "utf8")] };
  for (const name of Object.keys(html)) {
    ok(html[name][0] === html[name][1], name + ": the root and iOS copies are the same file");
    ok(/<script src="datetime\.js"><\/script>/.test(html[name][0]), name + " loads datetime.js");
    let n = 0, bad = 0;
    for (const m of html[name][0].matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) { n++; try { new Function(m[1]); } catch (e) { bad++; console.log("      " + name + " inline script " + n + ": " + e.message); } }
    ok(n > 0 && bad === 0, name + ": all " + n + " inline scripts parse");
  }
  const dash = html["dashboard.html"][0];
  ok(dash.indexOf("opt.doneAt ? formatDateTimeUTC(opt.doneAt) : formatDate(opt.doneDay)") >= 0, "dashboard: the done tag uses completed_at with the time, and the date alone without it");
  ok(dash.indexOf("mtNyDay(t.completed_at) || mtNyDay(t.updated_at) || mtNyDay(t.created_at)") >= 0, "dashboard: the 2-day rule reads the completed_at day first");

  // tasks.html: the small functions that decide what a handed-out row shows.
  const page = html["tasks.html"][0];
  const cut = (name) => { const i = page.indexOf("\n    function " + name + "("); if (i < 0) { throw new Error("not in tasks.html: " + name); } return page.slice(i + 1, page.indexOf("\n    }\n", i) + 6); };
  const make = (role) => new Function("sessionStorage", "formatDateTimeUTC", "formatDateUTC",
    ["isOwnConsultantTask", "isGivenTask", "givenCanCheck", "givenDoneWhen", "givenDoneSortKey"].map(cut).join("\n") +
    "\nreturn { isOwnConsultantTask, isGivenTask, givenCanCheck, givenDoneWhen, givenDoneSortKey };")({ getItem: () => role }, fmt, fmtDay);
  const P = make("rafa");
  const own = { type: "rafa", assignedTo: null }, toAlice = { type: "rafa", assignedTo: "alice" }, toSys = { type: "rafa", assignedTo: "developer" };
  ok(P.isOwnConsultantTask(own) && !P.isOwnConsultantTask(toAlice) && !P.isOwnConsultantTask(toSys) && !P.isOwnConsultantTask({ type: "client", assignedTo: null }), "tasks.html: a handed-out task is not in the consultant tab or its count");
  ok(P.isGivenTask(toAlice) && P.isGivenTask(toSys) && !P.isGivenTask(own) && !P.isGivenTask({ type: "rafa", assignedTo: "alice", completedBy: "voice-undo" }), "tasks.html: Given to others takes tasks with assigned_to set, never one undone by voice");
  ok(!P.givenCanCheck(toAlice) && !P.givenCanCheck(toSys), "tasks.html: role rafa gets no checkbox on a handed-out task");
  ok(make("alice").givenCanCheck(toAlice) && !make("alice").givenCanCheck(toSys), "tasks.html: role alice gets a checkbox on tasks for Alice only");
  ok(make("developer").givenCanCheck(toSys) && !make("developer").givenCanCheck(toAlice), "tasks.html: role developer gets a checkbox on system tasks only");
  ok(!make("client").givenCanCheck(toAlice) && !make(null).givenCanCheck(toAlice), "tasks.html: any other role, or none, gets no checkbox");
  ok(P.givenDoneWhen({ completedAt: "2026-10-08T02:15:00.000Z", updatedAt: "2026-10-09T10:00:00.000Z" }) === "10/07/2026 10:15 PM", "tasks.html: the done tag is completed_at as date and time in New York");
  ok(P.givenDoneWhen({ completedAt: null, updatedAt: "2026-10-08T02:15:00.000Z" }) === "10/07/2026", "tasks.html: an old row with no completed_at shows the date alone");
  ok(P.givenDoneWhen({ completedAt: null, updatedAt: null }) === "", "tasks.html: nothing known, no done tag");
  const order = [{ k: "old", completedAt: null, updatedAt: "2026-10-01 09:00:00" }, { k: "new", completedAt: "2026-10-07T20:00:00.000Z" }, { k: "mid", completedAt: "2026-10-07T13:00:00.000Z" }]
    .sort((a, b) => (P.givenDoneSortKey(a) === P.givenDoneSortKey(b) ? 0 : (P.givenDoneSortKey(a) < P.givenDoneSortKey(b) ? 1 : -1))).map((x) => x.k).join(",");
  ok(order === "new,mid,old", "tasks.html: done handed-out tasks sort newest done first: " + order);
  for (const id of ["tabBtnGiven", "tabCountGiven"]) { ok(page.split('id="' + id + '"').length === 2, "tasks.html: id=\"" + id + "\" is there once"); }
  ok(page.indexOf('appendDoneGroup("Passei para outros", "Given to others", givenDone, true);') >= 0, "tasks.html: the Done tab has a Given to others section built with the same header as the other two");
}

// ── 16. Whoever speaks owns the task, unless they name someone else ─────────
{
  const say = async (role, name, tasks, edit) => {
    const d = world(true);
    if (edit) { edit(d); }
    const h = harness(d, { role, name, claude: { tasks } });
    const r = await h.speak();
    return { d, h, r, rows: d.q("SELECT * FROM tasks ORDER BY rowid"), out: r.data ? r.data.tasks : [] };
  };

  // Alice, for herself.
  const a1 = await say("alice", "Pra. Alice", [T("Ligar para o banco", "self"), T("No word about who")]);
  ok(a1.r.status === 200 && a1.rows.length === 2 && a1.rows.every((t) => t.assigned_to === "alice" && t.created_by_role === "alice"), "speaker alice + \"self\" (or no \"for\"): assigned_to 'alice', created_by_role 'alice'");
  ok(a1.out.every((t) => t.given === false && t.created_by_role === "alice" && t.assigned_to === "alice"), "speaker alice + \"self\": the returned task has given false and created_by_role 'alice'");
  ok(a1.h.calls.push.length === 0, "speaker alice + \"self\": NO push (" + a1.h.calls.push.length + ")");
  ok(a1.rows.every((t) => t.created_by === "Pra. Alice" && t.type === "consultant" && t.source === "voice"), "speaker alice: created_by is still her name, so her own undo works");

  // Alice names herself: still hers, no push.
  const a2 = await say("alice", "Pra. Alice", [T("A Alice precisa mandar o recibo", "alice")]);
  ok(a2.rows[0].assigned_to === "alice" && a2.out[0].given === false && a2.h.calls.push.length === 0, "speaker alice + \"alice\" is self: assigned_to 'alice', given false, no push");

  // Alice hands one to Rafa.
  const a3 = await say("alice", "Pra. Alice", [T("O pastor precisa assinar o contrato", "rafa"), T("Minha tarefa", "self")]);
  ok(a3.rows[0].assigned_to === null && a3.rows[0].created_by_role === "alice", "speaker alice + \"rafa\": assigned_to NULL, created_by_role 'alice'");
  ok(a3.out[0].given === true && a3.out[0].assignee_name === "Rafa" && a3.out[1].given === false, "speaker alice + \"rafa\": given true, assignee_name 'Rafa'; her own task in the same dictation is given false");
  ok(a3.h.calls.push.length === 1 && a3.h.calls.push[0].emails.join(",") === "rafa@x.test", "speaker alice + \"rafa\": ONE push, to role rafa and nobody else");
  ok(a3.h.calls.push[0].payload.title === "Nova tarefa" && a3.h.calls.push[0].payload.body === "O pastor precisa assinar o contrato" && a3.h.calls.push[0].payload.tag === "apex-assigned-tasks", "the Rafa push: title 'Nova tarefa', body the description of his task only");
  const a3b = await say("alice", "Pra. Alice", [T("Um", "rafa"), T("Dois", "rafa"), T("Meu")]);
  ok(a3b.h.calls.push.length === 1 && a3b.h.calls.push[0].payload.title === "2 novas tarefas" && a3b.h.calls.push[0].payload.body === "Um · Dois", "two for Rafa: one push, title '2 novas tarefas'");
  // No display_name for role rafa, or no users table: the plain name.
  const a3c = await say("alice", "Pra. Alice", [T("Um", "rafa")], (d) => d.raw.exec("UPDATE users SET display_name = '' WHERE role = 'rafa'"));
  ok(a3c.out[0].assignee_name === "Rafa", "no display_name for role rafa: assignee_name falls back to 'Rafa'");
  const a3d = await say("alice", "Pra. Alice", [T("Um", "rafa")], (d) => d.raw.exec("DROP TABLE users"));
  ok(a3d.r.status === 200 && a3d.out[0].assignee_name === "Rafa" && a3d.rows.length === 1 && a3d.h.calls.push.length === 0, "the users table cannot be read: the task is saved, named 'Rafa', and no push call is made");

  // Alice hands one to the system.
  const a4 = await say("alice", "Pra. Alice", [T("No sistema precisa aparecer o telefone", "system")]);
  ok(a4.rows[0].assigned_to === "developer" && a4.rows[0].created_by_role === "alice" && a4.out[0].given === true && a4.out[0].assignee_name === null, "speaker alice + \"system\": assigned_to 'developer', given true, no name");
  ok(a4.h.calls.push.length === 1 && a4.h.calls.push[0].emails.join(",") === "dev@x.test" && a4.h.calls.push[0].payload.title === "New system task", "speaker alice + \"system\": one push, to the developer");

  // Rafa: unchanged from today.
  const r1 = await say("rafa", "Rafa", [T("Ligar para o contador", "self"), T("Sem dono")]);
  ok(r1.rows.every((t) => t.assigned_to === null && t.created_by_role === "rafa") && r1.out.every((t) => t.given === false && t.assignee_name === null), "speaker rafa + \"self\": assigned_to NULL as today, created_by_role 'rafa', given false, no name");
  ok(r1.h.calls.push.length === 0, "speaker rafa + \"self\": no push");
  const r2 = await say("rafa", "Rafa", [T("O Rafa precisa ligar para o banco", "rafa")]);
  ok(r2.rows[0].assigned_to === null && r2.out[0].given === false && r2.out[0].assignee_name === null && r2.h.calls.push.length === 0, "speaker rafa + \"rafa\" is self: assigned_to NULL, given false, no name, no push");
  const r3 = await say("rafa", "Rafa", [T("Alice precisa ligar", "alice"), T("Fix it", "system"), T("Meu")]);
  ok(r3.out[0].given === true && r3.out[1].given === true && r3.out[2].given === false && r3.h.calls.push.length === 2, "speaker rafa handing to Alice and the system: given true on both, two pushes, as today");
  ok(r3.h.calls.push.every((c) => c.emails.indexOf("rafa@x.test") < 0), "Rafa is never pushed a dictation of his own");

  // The developer.
  const d1 = await say("developer", "The Developer", [T("Fix the invoice total", "self"), T("Nothing said about who")]);
  ok(d1.rows.every((t) => t.assigned_to === "developer" && t.created_by_role === "developer") && d1.out.every((t) => t.given === false && t.assignee_name === null), "speaker developer + \"self\": assigned_to 'developer', created_by_role 'developer', given false");
  ok(d1.h.calls.push.length === 0, "speaker developer + \"self\": no push");
  const d2 = await say("developer", "The Developer", [T("The system needs a phone field", "system")]);
  ok(d2.rows[0].assigned_to === "developer" && d2.out[0].given === false && d2.h.calls.push.length === 0, "speaker developer + \"system\" is self: no push");
  const d3 = await say("developer", "The Developer", [T("Rafa needs to call the bank", "rafa"), T("Alice needs to send it", "alice")]);
  ok(d3.rows[0].assigned_to === null && d3.rows[1].assigned_to === "alice" && d3.out.every((t) => t.given === true) && d3.h.calls.push.length === 2, "speaker developer handing to Rafa and Alice: given true on both, one push each");
  ok(JSON.stringify(d3.r.data).indexOf("The Developer") < 0 || d3.out.every((t) => t.assignee_name !== "The Developer"), "the developer's name is never an assignee_name");
  ok(d1.out.concat(d2.out).every((t) => t.assignee_name === null), "a system task never carries a name, whoever spoke it");

  // Undo still keys on created_by.
  const u = await a1.h.F.handlePostTasksVoiceUndo(jsonReq({ ids: a1.out.map((t) => t.id) }), a1.h.env);
  ok(u.status === 200 && u.data.undone === 2, "Alice can undo her own dictation (2 undone)");

  // The prompt names the speaker.
  const pr = (x) => x.h.calls.claude[0].prompt;
  ok(pr(r1).indexOf("The speaker is Rafa, the consultant,") >= 0, "the prompt names the speaker: Rafa, the consultant");
  ok(pr(a1).indexOf("The speaker is Alice, who runs the office,") >= 0, "the prompt names the speaker: Alice, who runs the office");
  ok(pr(d1).indexOf("The speaker is the developer who maintains the system,") >= 0 && pr(d1).indexOf("The Developer") < 0, "the prompt names the speaker: the developer who maintains the system (never by name)");
  ok(pr(a1).indexOf('"self": the speaker. If the speaker names themself') >= 0 && pr(a1).indexOf('"rafa": he says Rafa (Rafa, Pr. Rafa, pastor Rafa, "o pastor") must do it') >= 0, "the prompt says what \"self\" and \"rafa\" mean");
  ok(pr(a1).indexOf("business consultant in Florida listing things HE has to do") < 0, "the prompt no longer assumes the speaker is the consultant");

  // GET /api/tasks returns created_by_role.
  a3.d.raw.exec("INSERT INTO tasks (id, client_id, type, description, source) VALUES ('old-row', NULL, 'consultant', 'Before the column', 'manual')");
  const all = await a3.h.F.handleGetAllTasks(jsonReq({}), a3.h.env);
  const by = {}; all.data.tasks.forEach((t) => { by[t.id] = t; });
  ok(all.status === 200 && all.data.tasks.every((t) => "created_by_role" in t), "GET /api/tasks returns created_by_role on every task");
  ok(by[a3.out[0].id].created_by_role === "alice" && by["old-row"].created_by_role === null, "GET /api/tasks: 'alice' on the task she spoke, null on an old row");

  // giver_name: who a task came from, for its owner's lists.
  a3.d.raw.exec("INSERT INTO tasks (id, client_id, type, description, source, assigned_to, created_by_role) VALUES " +
    "('g-alice-to-rafa', NULL, 'consultant', 'x', 'voice', NULL, 'alice'), ('g-rafa-to-alice', NULL, 'consultant', 'x', 'voice', 'alice', 'rafa'), " +
    "('g-dev-to-rafa', NULL, 'consultant', 'x', 'voice', NULL, 'developer'), ('g-dev-to-alice', NULL, 'consultant', 'x', 'voice', 'alice', 'developer'), " +
    "('g-rafa-self', NULL, 'consultant', 'x', 'voice', NULL, 'rafa'), ('g-alice-self', NULL, 'consultant', 'x', 'voice', 'alice', 'alice')");
  const gv = await a3.h.F.handleGetAllTasks(jsonReq({}), a3.h.env);
  const gb = {}; gv.data.tasks.forEach((t) => { gb[t.id] = t; });
  ok(gv.data.tasks.every((t) => "giver_name" in t), "GET /api/tasks returns giver_name on every task");
  ok(gb["g-alice-to-rafa"].giver_name === "Pra. Alice", "giver_name is Alice's display name on a task Alice gave the consultant: " + gb["g-alice-to-rafa"].giver_name);
  ok(gb["g-rafa-to-alice"].giver_name === "Rafa", "giver_name is Rafa's display name on a task he gave Alice");
  ok(gb["g-dev-to-rafa"].giver_name === null && gb["g-dev-to-alice"].giver_name === null, "giver_name is null on a task from the developer");
  ok(gb["g-rafa-self"].giver_name === null && gb["g-alice-self"].giver_name === null, "giver_name is null on a self task");
  ok(gb["old-row"].giver_name === null, "giver_name is null on a row with created_by_role NULL");
  ok(JSON.stringify(gv.data).indexOf("The Developer") < 0, "GET /api/tasks never carries the developer's name (giver_name included)");
  const G = a3.h.F.taskGivenByRole;
  ok(G(null, "alice") === "alice" && G("alice", "rafa") === "rafa" && G("alice", "developer") === "developer" && G(null, "developer") === "developer", "taskGivenByRole: the giver's role when it differs from the owner");
  ok(G(null, "rafa") === null && G("alice", "alice") === null && G("developer", "developer") === null && G(null, null) === null && G("alice", null) === null && G("alice", "") === null, "taskGivenByRole: null for a self task and for created_by_role empty");

  ok(MIG_ROLE.trim() === "ALTER TABLE tasks ADD COLUMN created_by_role TEXT;", "the migration file is exactly the one statement");
}

// ── 17. The pages: the button on tasks.html, and the two dashboard corrections ─
{
  const read = (f) => readFileSync(new URL(f, root), "utf8");
  const page = read("tasks.html"), dash = read("dashboard.html");
  ok(page === read("ios/App/App/public/tasks.html") && dash === read("ios/App/App/public/dashboard.html"), "root and iOS copies of tasks.html and dashboard.html carry the same edit");
  const cutFrom = (html, name) => { const i = html.indexOf("\n    function " + name + "("); if (i < 0) { throw new Error("not found: " + name); } return html.slice(i + 1, html.indexOf("\n    }\n", i) + 6); };
  for (const id of ["mtSpeakBlock", "mtSpeakBtn", "mtSpeakLabel", "mtTimer", "mtCancelBtn", "mtStatus", "mtHeard", "mtHeardText"]) {
    ok(page.split('id="' + id + '"').length === 2, "tasks.html: id=\"" + id + "\" is there once");
  }
  ok(page.indexOf('id="mtSpeakBlock"') < page.indexOf('<div class="role-tabs">') && page.indexOf('id="mtSpeakBlock"') > page.indexOf('class="page-heading-hero"'), "tasks.html: the control sits under the heading and above the tabs");
  const fns = ["placeSpeakTasks", "toggleMyTasksRecording", "startMyTasksRecording", "stopMyTasksRecording", "cancelMyTasksRecording", "setMyTasksRecordingUi", "sendMyTasksRecording", "retryMyTasksUpload", "mtGaveText", "uploadMyTasksBlob", "undoMyTasksDictation"];
  const code = fns.map((n) => cutFrom(page, n)).join("\n");
  ok(!/\b(confirm|alert|prompt)\s*\(/.test(code), "tasks.html: no browser pop-up in the new code");
  ok(!/\b(const|let)\s|=>/.test(code), "tasks.html: the new code uses var and regular functions");
  ok(!/[^\x00-\x7f]/.test(code), "tasks.html: the new code is plain ASCII");
  ok(/loadTasks\(\);/.test(cutFrom(page, "uploadMyTasksBlob")) && /loadTasks\(\);/.test(cutFrom(page, "undoMyTasksDictation")), "tasks.html: a dictation and an undo both load the list again");

  // Who sees it.
  const place = (role) => { const el = { hidden: true }; new Function("document", "cancelMyTasksRecording", cutFrom(page, "placeSpeakTasks") + "\nreturn placeSpeakTasks;")({ getElementById: () => el }, () => {})(role); return !el.hidden; };
  ok(place("rafa") && place("alice") && place("developer"), "tasks.html: rafa, alice and developer see the button");
  ok(!place("client") && !place("seller") && !place(null), "tasks.html: any other role, or none, does not");

  // The second part of the "Added N tasks" line.
  const gave = new Function("function mtBoth(pt, en) { return pt + ' | ' + en; }\n" + cutFrom(page, "mtGaveText") + "\nreturn mtGaveText;")();
  const g = (assigned_to, given) => ({ assigned_to, given });
  ok(gave([g(null, false), g("alice", false), g("developer", false)]) === "", "tasks.html: nothing handed out, no second part (the speaker's own tasks never count)");
  ok(gave([g("alice", true)]) === " 1 para Alice. | 1 for Alice.", "tasks.html: " + gave([g("alice", true)]));
  ok(gave([g(null, true)]) === " 1 para Rafa. | 1 for Rafa.", "tasks.html: " + gave([g(null, true)]));
  ok(gave([g("developer", true)]) === " 1 para o sistema. | 1 for the system.", "tasks.html: " + gave([g("developer", true)]));
  ok(gave([g("alice", true), g(null, true), g(null, true), g("developer", true), g("alice", false)]) === " 1 para Alice, 2 para Rafa, 1 para o sistema. | 1 for Alice, 2 for Rafa, 1 for the system.", "tasks.html: all three, own task left out:" + gave([g("alice", true), g(null, true), g(null, true), g("developer", true), g("alice", false)]));

  // dashboard.html
  const up = cutFrom(dash, "uploadMyTasksBlob");
  ok(up.indexOf("d.tasks[i].given === true") >= 0 && up.indexOf('toRafa + " para Rafa"') >= 0 && up.indexOf('toRafa + " for Rafa"') >= 0, "dashboard: the second part counts given tasks by owner, with Rafa");
  // Given to others, run against a stand-in page.
  const givenShown = (rows) => {
    const made = [];
    const mk = () => ({ className: "", innerHTML: "", appendChild() {} });
    const container = { innerHTML: "", appendChild: (el) => { made.push(el); } };
    const f = new Function("mtGiven", "document", "mtNyDay", "mtGivenDoneStillShown", "mtSortKey", "mtBoth", "buildMyTaskRow", "MT_LIST_MAX",
      cutFrom(dash, "renderMyGivenList") + "\nreturn renderMyGivenList;")(
      rows, { getElementById: () => container, createElement: mk }, () => "2026-10-07", () => true, (x) => String(x || ""), (pt, en) => en,
      (t) => ({ id: t.id }), 50);
    f();
    return made.filter((el) => el.id).map((el) => el.id).join(",");
  };
  const G = (id, assigned_to, created_by_role) => ({ id, assigned_to, created_by_role, status: "pending", completed_by: null, due_date: null, created_at: "2026-10-07 10:00:0" + id.length });
  const shownIds = givenShown([G("a", "alice", "rafa"), G("bb", "alice", "alice"), G("ccc", "developer", "developer"), G("dddd", "developer", "alice"), G("eeeee", "alice", null), G("ffffff", "alice", "developer")]);
  ok(shownIds === "a,dddd,eeeee,ffffff", "dashboard Given to others: Alice's and the developer's own tasks are left out; handed-out ones and old rows (created_by_role NULL) stay: " + shownIds);
  ok(/var MY_TASKS_VIEWS = \{ rafa: "rafaMeetingsCard" \};/.test(dash), "dashboard: who sees the microphone card is unchanged (rafa)");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
