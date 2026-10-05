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

function world(migrated) {
  const d = makeDb([]);
  d.raw.exec(CURRENT);
  if (migrated) { d.raw.exec(MIG); }
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
  const calls = { asr: [], claude: [], logs: [] };
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
     "handlePostTasksVoice", "handlePostTasksVoiceUndo", "handleGetAllTasks", "handleGetConsultantTasks", "handleGetConsultantTasksOverdue", "handleGetClientTasks"],
    ["TASK_VOICE_MAX_TASKS", "TASK_VOICE_MAX_PER_DAY", "TASK_VOICE_UNDO_MARK", "TASK_NOT_UNDONE_SQL"], stubs);
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
  ok(p.indexOf('{"tasks":[{"description": string, "due_date": "YYYY-MM-DD" or null, "client_name": string or null}]}') >= 0, "the prompt asks for the fixed JSON shape");
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

console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
