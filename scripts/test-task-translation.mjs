// Tasks and notes between the Portuguese-speaking staff and the
// English-speaking developer are kept in both languages.
// The Worker routes are the REAL functions cut out of worker/index.js, run on
// an in-memory SQLite (scripts/fixtures/d1-shim.mjs). The model is a stand-in
// (a fake fetch that records every call). The sheet is run against a small
// stand-in page. No network, no browser, nothing written.
//
//   node scripts/test-task-translation.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, workerSrc } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

// The tables as they are live, the new columns coming from this job's
// migration file (so the file itself is what the tests run on).
const TABLES = `
CREATE TABLE tasks (id TEXT PRIMARY KEY, client_id TEXT, type TEXT NOT NULL, description TEXT NOT NULL, due_date TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')), session_id TEXT, due_date_source TEXT, completed_by TEXT, updated_at TEXT, source TEXT, nota TEXT, created_by TEXT, assigned_to TEXT, completed_at TEXT, created_by_role TEXT);
CREATE TABLE sessions (id TEXT PRIMARY KEY, date TEXT);
CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, role TEXT, display_name TEXT, avatar_url TEXT, client_id TEXT);
`;
const MIG_NOTES = read("migrations/2026-10-07_task_notes.sql");
const MIG = read("migrations/2026-10-08_task_translations.sql");
const MODEL_NAME = /\nvar CLAUDE_MODEL\s*=\s*"([^"]+)"/.exec(workerSrc)[1];

const USERS = {
  rafa:  { email: "rafa@x.test", role: "rafa", display_name: "Rafael" },
  alice: { email: "alice@x.test", role: "alice", display_name: "Pra. Alice" },
  dev:   { email: "dev@x.test", role: "developer", display_name: "The Developer" }
};

function world() {
  const d = makeDb([]);
  d.raw.exec(TABLES);
  d.raw.exec(MIG_NOTES);
  d.raw.exec(MIG);
  const u = d.raw.prepare("INSERT INTO users (email, role, display_name, avatar_url) VALUES (?,?,?,?)");
  for (const k of Object.keys(USERS)) { u.run(USERS[k].email, USERS[k].role, USERS[k].display_name, null); }
  const t = d.raw.prepare("INSERT INTO tasks (id, client_id, type, description, status, source, assigned_to, created_by_role, description_en, description_pt, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  // rafa -> system, already translated.
  t.run("t-sys", null, "consultant", "Arrumar o relatorio de vendas", "pending", "manual", "developer", "rafa", "Fix the sales report", null, "2026-10-01 10:00:00");
  // developer -> rafa, already translated.
  t.run("t-from-dev", null, "consultant", "Send me the logo by 10/12", "pending", "manual", null, "developer", null, "Me mande o logo ate 10/12", "2026-10-01 10:01:00");
  // developer -> alice, no translation yet.
  t.run("t-dev-alice", null, "consultant", "Check the invoice list", "pending", "manual", "alice", "developer", null, null, "2026-10-01 10:02:00");
  // rafa -> alice and rafa's own: the developer is not involved.
  t.run("t-ra", null, "consultant", "Ligar para o contador", "pending", "manual", "alice", "rafa", null, null, "2026-10-01 10:03:00");
  t.run("t-own", null, "consultant", "Preparar a mensagem", "pending", "manual", null, "rafa", null, null, "2026-10-01 10:04:00");
  t.run("t-client", null, "client", "The client's own to-do", "pending", "session", null, null, null, null, "2026-10-01 10:05:00");
  return d;
}

// The stand-in model. `model` is what it does with a prompt: return the reply
// text, throw, or return a Promise that is slow. Every call is recorded.
const TRANSCRIPT = "Arrumar o relatorio no sistema e pedir para a Alice ligar para o contador.";
function harness(d, who, model, opts) {
  const o = opts || {};
  const user = USERS[who];
  const calls = { model: [], push: [], asr: 0 };
  const stubs = Object.assign({}, baseStubs, {
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status || 400, error: en, error_pt: pt, error_en: en }, extra || {}),
    authenticate: async () => Object.assign({}, user),
    actorName: (u) => (u && (u.display_name || u.role)) || null,
    crypto: globalThis.crypto, Response: globalThis.Response, Intl: globalThis.Intl,
    pushToUsers: async (env, emails, payload) => { calls.push.push({ emails, payload }); },
    CLAUDE_API_URL: "https://claude.test/v1/messages", CLAUDE_MODEL: MODEL_NAME,
    APEX_TIMEZONE: "America/New_York", VOICE_MAX_AUDIO_BYTES: 8 * 1024 * 1024,
    // The wait is a stub here (30 ms) so a slow model can be tested quickly.
    TASK_TRANSLATE_TIMEOUT_MS: 30,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      const prompt = body.messages[0].content;
      calls.model.push({ url, model: body.model, prompt, key: init.headers["x-api-key"], max_tokens: body.max_tokens });
      const out = await model(prompt);
      if (out && out.status) { return { ok: false, status: out.status, json: async () => ({}) }; }
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }] }) };
    },
    console: { log() {}, error() {}, warn() {} }
  });
  const F = build(
    ["taskInvolvesDeveloper", "taskTranslationColumn", "taskWordsForRole", "taskVoiceTranslationRule", "taskTranslatePrompt", "taskTranslate", "taskVoiceAskClaude",
     "taskDescriptionClean", "handlePatchTask", "handlePostTaskTyped", "handleGetAllTasks",
     "taskGivenByRole", "taskAssigneeAliceName", "taskAssigneeRafaName", "taskVoiceOwnerRole", "taskVoicePushText", "taskVoiceNotify",
     "taskNoteRecipients", "taskNotePushText", "taskNoteNotify", "taskNoteView", "taskNotesTask", "handleGetTaskNotes", "handlePostTaskNote",
     "taskVoiceParseTasks", "taskVoiceMatchClient", "taskVoiceToday", "taskVoicePrompt", "taskVoiceTranscribe", "taskVoiceDumpOpen", "taskVoiceDumpSet", "handlePostTasksVoice"],
    ["TASK_DESC_MAX", "TASK_PUSH_BODY_MAX", "TASK_NOTE_MAX", "TASK_NOT_UNDONE_SQL", "TASK_VOICE_MAX_TASKS", "TASK_VOICE_MAX_PER_DAY", "TASK_TRANSLATION_MAX"], stubs);
  const env = {
    DB: d.DB, CLAUDE_API_KEY: "test-key",
    AI: { run: async () => { calls.asr++; return { results: { channels: [{ alternatives: [{ transcript: o.transcript || TRANSCRIPT, languages: ["pt"] }] }] } }; } }
  };
  const req = (body) => ({ url: "https://x.test/", headers: { get: () => "Bearer tok" }, json: async () => body });
  const audioReq = () => ({ url: "https://x.test/api/tasks/voice",
    formData: async () => ({ get: (k) => (k === "audio" ? { type: "audio/webm", arrayBuffer: async () => new Uint8Array(2048).buffer } : (k === "lang" ? "pt" : null)) }) });
  return {
    F, env, calls,
    add: (body) => F.handlePostTaskTyped(req(body), env),
    patch: (id, body) => F.handlePatchTask(id, req(body), env),
    note: (id, text) => F.handlePostTaskNote(id, req({ body: text }), env),
    notes: (id) => F.handleGetTaskNotes(id, req({}), env),
    all: () => F.handleGetAllTasks(req({}), env),
    speak: () => F.handlePostTasksVoice(audioReq(), env, new Date("2026-10-07T16:00:00Z"))
  };
}
const task = (d, id) => d.q("SELECT * FROM tasks WHERE id = ?", id)[0];
const noteRows = (d, id) => d.q("SELECT * FROM task_notes WHERE task_id = ? ORDER BY created_at, rowid", id);
const isTranslate = (p) => p.indexOf("Translate the text below into ") === 0;
// A model that translates: "[EN] words" or "[PT] words", so a test can see
// which language was asked for and that the words went in whole.
const translator = (prompt) => {
  const lang = /^Translate the text below into (English|Portuguese of Brazil)\./.exec(prompt);
  const text = /Text:\n"""\n([\s\S]*)\n"""$/.exec(prompt);
  return (lang[1] === "English" ? "[EN] " : "[PT] ") + text[1];
};

// ── 1. The rule, and the small helpers ──────────────────────────────────────
{
  const F = harness(world(), "rafa", translator).F;
  ok(F.taskInvolvesDeveloper("developer", "rafa") === true && F.taskInvolvesDeveloper(null, "developer") === true && F.taskInvolvesDeveloper("alice", "developer") === true && F.taskInvolvesDeveloper("developer", "developer") === true, "a task involves the developer when the developer owns it or created it");
  ok(F.taskInvolvesDeveloper("alice", "rafa") === false && F.taskInvolvesDeveloper(null, "rafa") === false && F.taskInvolvesDeveloper(null, "alice") === false && F.taskInvolvesDeveloper(null, null) === false, "a task between Rafa and Alice, or anyone's own, or an old row with no roles, does not");
  ok(F.taskTranslationColumn("developer") === "description_pt" && F.taskTranslationColumn("rafa") === "description_en" && F.taskTranslationColumn("alice") === "description_en" && F.taskTranslationColumn("client") === null && F.taskTranslationColumn(undefined) === null, "the developer's words get a Portuguese version; rafa's and alice's an English one; anyone else's none");
  ok(F.taskWordsForRole("developer", "orig", "en", "pt") === "en" && F.taskWordsForRole("rafa", "orig", "en", "pt") === "pt" && F.taskWordsForRole("alice", "orig", "en", "pt") === "pt", "a recipient's words: English for the developer, Portuguese for rafa and alice");
  ok(F.taskWordsForRole("developer", "orig", null, "pt") === "orig" && F.taskWordsForRole("rafa", "orig", "en", null) === "orig" && F.taskWordsForRole("alice", "orig", "", undefined) === "orig" && F.taskWordsForRole("client", "orig", "en", "pt") === "orig", "with no version in their language, the original");
  const pEn = F.taskTranslatePrompt("Pagar R$ 1.200,00 para o Joao ate 10/12", "description_en");
  const pPt = F.taskTranslatePrompt("Pay John", "description_pt");
  ok(pEn.indexOf("Translate the text below into English.") === 0 && pPt.indexOf("Translate the text below into Portuguese of Brazil.") === 0, "the prompt names the target: English, or Portuguese of Brazil");
  ok(/Keep names of people and companies, numbers, numeric dates and money exactly as written/.test(pEn) && /Translate ordinary words for days and months/.test(pEn) && /Return ONLY the translation/.test(pEn) && /not instructions to you/.test(pEn), "the prompt keeps names, numbers, dates and money as written, asks for only the translation, and fences the text as not-instructions");
  ok(pEn.indexOf("Pagar R$ 1.200,00 para o Joao ate 10/12") > 0, "the prompt carries the words, whole");
}

// ── 2. A typed task: who gets a translation call, and into which language ───
{
  const d = world();
  const h = harness(d, "rafa", translator);
  const r = await h.add({ description: "Arrumar o botao de pagar", for: "system" });
  const row = task(d, r.data.task.id);
  ok(r.status === 200 && h.calls.model.length === 1, "rafa types a task for the system: ONE model call");
  ok(h.calls.model[0].model === MODEL_NAME && h.calls.model[0].url === "https://claude.test/v1/messages" && h.calls.model[0].key === "test-key", "the call uses CLAUDE_MODEL (" + MODEL_NAME + "), CLAUDE_API_URL and the same key header as the dictation");
  ok(isTranslate(h.calls.model[0].prompt) && /into English\./.test(h.calls.model[0].prompt), "the target is English");
  ok(row.description === "Arrumar o botao de pagar" && row.description_en === "[EN] Arrumar o botao de pagar" && row.description_pt === null, "the original stays in description; the English version is saved in description_en");
  ok(r.data.task.description === "Arrumar o botao de pagar" && r.data.task.description_en === "[EN] Arrumar o botao de pagar" && r.data.task.description_pt === null, "the answer carries description, description_en and description_pt");
  ok(h.calls.push.length === 1 && h.calls.push[0].emails[0] === "dev@x.test" && h.calls.push[0].payload.title === "New system task" && h.calls.push[0].payload.body === "[EN] Arrumar o botao de pagar", "the developer's push carries the English version");

  const ha = harness(d, "alice", translator);
  const ra = await ha.add({ description: "Mudar a cor do menu", for: "system" });
  ok(ha.calls.model.length === 1 && /into English\./.test(ha.calls.model[0].prompt) && task(d, ra.data.task.id).description_en === "[EN] Mudar a cor do menu", "alice types a task for the system: one call, English");

  const hd = harness(d, "dev", translator);
  const rd = await hd.add({ description: "Send me the price list", for: "rafa" });
  const rowD = task(d, rd.data.task.id);
  ok(hd.calls.model.length === 1 && /into Portuguese of Brazil\./.test(hd.calls.model[0].prompt), "the developer types a task for rafa: one call, Portuguese of Brazil");
  ok(rowD.description === "Send me the price list" && rowD.description_pt === "[PT] Send me the price list" && rowD.description_en === null && rd.data.task.description_pt === "[PT] Send me the price list", "saved in description_pt, original untouched, and answered");
  ok(hd.calls.push.length === 1 && hd.calls.push[0].emails[0] === "rafa@x.test" && hd.calls.push[0].payload.title === "Nova tarefa" && hd.calls.push[0].payload.body === "[PT] Send me the price list", "rafa's push carries the Portuguese version");
  const rd2 = await hd.add({ description: "Print the forms", for: "alice" });
  ok(hd.calls.push.length === 2 && hd.calls.push[1].emails[0] === "alice@x.test" && hd.calls.push[1].payload.body === "[PT] Print the forms" && task(d, rd2.data.task.id).description_pt === "[PT] Print the forms", "the developer types a task for alice: Portuguese saved, and her push is in Portuguese");
  const rd3 = await hd.add({ description: "Rotate the keys" });
  ok(hd.calls.model.length === 3 && task(d, rd3.data.task.id).description_pt === "[PT] Rotate the keys" && hd.calls.push.length === 2, "the developer's own task is translated too (the staff can read it), and nobody is pushed");

  // Never for a task the developer is not part of.
  const hn = harness(d, "rafa", translator);
  const n1 = await hn.add({ description: "Ligar para o banco", for: "alice" });
  const n2 = await hn.add({ description: "Escrever a mensagem" });
  const hn2 = harness(d, "alice", translator);
  const n3 = await hn2.add({ description: "Pedir o contrato", for: "rafa" });
  ok(hn.calls.model.length === 0 && hn2.calls.model.length === 0, "a task rafa gives alice, rafa's own, and one alice gives rafa: ZERO model calls");
  ok([n1, n2, n3].every((x) => x.status === 200 && x.data.task.description_en === null && x.data.task.description_pt === null && task(d, x.data.task.id).description_en === null && task(d, x.data.task.id).description_pt === null), "and no translation is saved or answered for them");
  ok(hn.calls.push.length === 1 && hn.calls.push[0].payload.body === "Ligar para o banco", "their push is the same words as before");
}

// ── 3. A model that fails, throws, says nothing or is slow never fails a save ─
{
  const bad = {
    "answers 500": () => ({ status: 500 }),
    "throws": () => { throw new Error("network down"); },
    "answers with nothing": () => "   ",
    "is slower than the wait": () => new Promise((r) => setTimeout(() => r("[EN] too late"), 400))
  };
  for (const name of Object.keys(bad)) {
    const d = world();
    const h = harness(d, "rafa", bad[name]);
    const t0 = Date.now();
    const r = await h.add({ description: "Arrumar o login", for: "system" });
    const took = Date.now() - t0;
    const row = r.data && r.data.task ? task(d, r.data.task.id) : null;
    ok(r.status === 200 && !!row && row.description === "Arrumar o login" && row.description_en === null && row.description_pt === null && r.data.task.description_en === null, "typed task, the model " + name + ": 200, the task is saved, no translation");
    ok(h.calls.push.length === 1 && h.calls.push[0].payload.body === "Arrumar o login", "typed task, the model " + name + ": the push goes out with the original words");
    if (name === "is slower than the wait") { ok(took < 300, "the answer does not wait for a slow model (waited " + took + " ms; the model took 400)"); }

    const n = await h.note("t-sys", "Ainda esta quebrado");
    const saved = noteRows(d, "t-sys");
    ok(n.status === 200 && saved.length === 1 && saved[0].body === "Ainda esta quebrado" && saved[0].body_en === null && saved[0].body_pt === null && n.data.note.body_en === null && n.data.note.body_pt === null, "note, the model " + name + ": 200, the note is saved, no translation");
    ok(h.calls.push[1].payload.body === "Rafael: Ainda esta quebrado", "note, the model " + name + ": the push goes out with the original words");

    const p = await h.patch("t-sys", { description: "Arrumar o relatorio de vendas de novo" });
    const after = task(d, "t-sys");
    ok(p.status === 200 && after.description === "Arrumar o relatorio de vendas de novo" && after.description_en === null && after.description_pt === null && p.data.description_en === null && p.data.description_pt === null, "edit, the model " + name + ": 200, the new words are saved and the stale translation is cleared");
  }
  // A translation that arrives after the wait is not written later either.
  await new Promise((r) => setTimeout(r, 450));
}

// ── 4. Editing the words replaces the translation ───────────────────────────
{
  const d = world();
  const h = harness(d, "rafa", translator);
  ok(task(d, "t-sys").description_en === "Fix the sales report", "(before: the task has an English version)");
  const p = await h.patch("t-sys", { description: "  Arrumar o relatorio   de clientes " });
  const row = task(d, "t-sys");
  ok(p.status === 200 && h.calls.model.length === 1 && /into English\./.test(h.calls.model[0].prompt), "rafa edits a system task: one call, English");
  ok(row.description === "Arrumar o relatorio de clientes" && row.description_en === "[EN] Arrumar o relatorio de clientes" && row.description_pt === null, "the new words are saved and their translation REPLACES the stale one");
  ok(p.data.description === "Arrumar o relatorio de clientes" && p.data.description_en === "[EN] Arrumar o relatorio de clientes" && p.data.description_pt === null, "PATCH answers with description, description_en and description_pt");

  // The developer rewrites it in English: the other column now.
  const hd = harness(d, "dev", translator);
  const pd = await hd.patch("t-sys", { description: "Fix the client report" });
  const rowD = task(d, "t-sys");
  ok(pd.status === 200 && /into Portuguese of Brazil\./.test(hd.calls.model[0].prompt) && rowD.description === "Fix the client report" && rowD.description_pt === "[PT] Fix the client report" && rowD.description_en === null, "the developer edits the same task: Portuguese version saved, the old English one cleared (the words are his English now)");
  ok(pd.data.description_pt === "[PT] Fix the client report" && pd.data.description_en === null, "and answered so");

  // The pill and the due date leave the translation alone, with no call.
  const before = hd.calls.model.length;
  const pp = await hd.patch("t-sys", { progress: "working" });
  const pdue = await hd.patch("t-sys", { due_date: "2026-11-03" });
  const pdone = await hd.patch("t-sys", { status: "done" });
  ok(pp.status === 200 && pdue.status === 200 && pdone.status === 200 && hd.calls.model.length === before && task(d, "t-sys").description_pt === "[PT] Fix the client report", "the pill, the due date and marking done make no call and keep the translation");
  ok(!("description_en" in pp.data) && !("description" in pp.data) && JSON.stringify(pdone.data) === JSON.stringify({ ok: true, status: "done" }), "and their answers are the ones they always were");

  // Not for a task the developer is not part of, whoever edits it.
  const e1 = await h.patch("t-ra", { description: "Ligar para o contador amanha" });
  const e2 = await hd.patch("t-own", { description: "Preparar a mensagem de domingo" });
  ok(e1.status === 200 && e2.status === 200 && h.calls.model.length === 1 && hd.calls.model.length === before, "editing a rafa-to-alice task, or the developer editing rafa's own task: ZERO model calls");
  ok(task(d, "t-ra").description === "Ligar para o contador amanha" && task(d, "t-ra").description_en === null && e1.data.description_en === null && e1.data.description_pt === null, "the words are saved, with no translation");
}

// ── 5. Notes: both ways, and each recipient's push in their language ────────
{
  const d = world();
  const hr = harness(d, "rafa", translator);
  const n1 = await hr.note("t-sys", "O relatorio mostra R$ 8.382,00 em 10/01.\nEsta errado.");
  ok(n1.status === 200 && hr.calls.model.length === 1 && /into English\./.test(hr.calls.model[0].prompt), "rafa's note on a system task: one call, English");
  const saved1 = noteRows(d, "t-sys")[0];
  ok(saved1.body === "O relatorio mostra R$ 8.382,00 em 10/01.\nEsta errado." && saved1.body_en === "[EN] O relatorio mostra R$ 8.382,00 em 10/01.\nEsta errado." && saved1.body_pt === null, "the note's words stay in body; the English version is saved in body_en (line break and all)");
  ok(n1.data.note.body_en === saved1.body_en && n1.data.note.body_pt === null && n1.data.note.body === saved1.body, "POST notes answers with body, body_en and body_pt");
  ok(hr.calls.push.length === 1 && hr.calls.push[0].emails[0] === "dev@x.test" && hr.calls.push[0].payload.title === "New note on a task" && hr.calls.push[0].payload.body === ("Rafael: " + saved1.body_en).slice(0, 8 + 140), "the developer's push carries the English version");

  await new Promise((r) => setTimeout(r, 3));
  const hd = harness(d, "dev", translator);
  const n2 = await hd.note("t-sys", "Fixed. Reload the page.");
  const saved2 = noteRows(d, "t-sys")[1];
  ok(n2.status === 200 && hd.calls.model.length === 1 && /into Portuguese of Brazil\./.test(hd.calls.model[0].prompt) && saved2.body === "Fixed. Reload the page." && saved2.body_pt === "[PT] Fixed. Reload the page." && saved2.body_en === null, "the developer's note: one call, Portuguese of Brazil, saved in body_pt");
  ok(hd.calls.push.length === 1 && hd.calls.push[0].emails[0] === "rafa@x.test" && hd.calls.push[0].payload.title === "Nova nota em uma tarefa" && hd.calls.push[0].payload.body === "Sistema: [PT] Fixed. Reload the page.", "rafa's push carries the Portuguese version, from \"Sistema\"");
  ok(JSON.stringify(n2.data).indexOf("The Developer") < 0 && JSON.stringify(hd.calls.push).indexOf("The Developer") < 0, "the developer's name is in neither the answer nor the push");

  // A task the developer gave alice: alice's note goes to the developer in English.
  const ha = harness(d, "alice", translator);
  const n3 = await ha.note("t-dev-alice", "A lista esta pronta");
  ok(n3.data.note.body_en === "[EN] A lista esta pronta" && ha.calls.push.length === 1 && ha.calls.push[0].emails[0] === "dev@x.test" && ha.calls.push[0].payload.body === "Pra. Alice: [EN] A lista esta pronta", "alice's note on a task the developer gave her: English saved, the developer pushed in English");

  // Never on a task the developer is not part of, even when he writes there.
  const q = harness(d, "rafa", translator);
  const qd = harness(d, "dev", translator);
  const m1 = await q.note("t-ra", "Ja liguei");
  const m2 = await qd.note("t-ra", "Looking into it");
  const m3 = await q.note("t-own", "Feito");
  ok(m1.status === 200 && m2.status === 200 && m3.status === 200 && q.calls.model.length === 0 && qd.calls.model.length === 0, "notes on a rafa-to-alice task (by rafa, and by the developer) and on rafa's own task: ZERO model calls");
  ok(noteRows(d, "t-ra").every((n) => n.body_en === null && n.body_pt === null) && m2.data.note.body_pt === null, "and no translation is saved for them");
  ok(q.calls.push[0].payload.body === "Rafael: Ja liguei", "their pushes carry the same words as before");

  // Reads.
  const g = await hr.notes("t-sys");
  ok(g.data.task.description === "Arrumar o relatorio de vendas" && g.data.task.description_en === "Fix the sales report" && g.data.task.description_pt === null, "GET notes: the task carries description_en and description_pt");
  ok(g.data.notes.length === 2 && g.data.notes[0].body_en === saved1.body_en && g.data.notes[0].body_pt === null && g.data.notes[1].body_pt === "[PT] Fixed. Reload the page." && g.data.notes[1].body_en === null, "GET notes: every note carries body_en and body_pt");
  const g2 = await hr.notes("t-ra");
  ok(g2.data.task.description_en === null && g2.data.task.description_pt === null && g2.data.notes.every((n) => n.body_en === null && n.body_pt === null), "GET notes on a task with none: the fields are there, null");
  const before = hr.calls.model.length;
  const all = await hr.all();
  const by = {}; all.data.tasks.forEach((t) => { by[t.id] = t; });
  ok(by["t-sys"].description_en === "Fix the sales report" && by["t-sys"].description_pt === null && by["t-from-dev"].description_pt === "Me mande o logo ate 10/12" && by["t-ra"].description_en === null && by["t-ra"].description_pt === null, "GET /api/tasks: every task carries description_en and description_pt");
  ok(by["t-sys"].last_note.body === "Fixed. Reload the page." && by["t-sys"].last_note.body_pt === "[PT] Fixed. Reload the page." && by["t-sys"].last_note.body_en === null, "GET /api/tasks: last_note carries its translations");
  ok(by["t-ra"].last_note.body_en === null && by["t-ra"].last_note.body_pt === null, "GET /api/tasks: last_note of an untranslated note has them null");
  d.raw.prepare("UPDATE task_notes SET body_pt = ? WHERE body = ?").run("p".repeat(300), "Fixed. Reload the page.");
  ok((await hr.all()).data.tasks.find((t) => t.id === "t-sys").last_note.body_pt.length === 140, "GET /api/tasks: a last_note translation is cut at 140 characters like the note");
  ok(hr.calls.model.length === before, "reading makes no model call");
}

// ── 6. A dictation: the SAME single call returns the other language ─────────
{
  // rafa speaks: one entry for the system, one for alice, one for himself.
  const d = world();
  const reply = { tasks: [
    { description: "Arrumar o relatorio no sistema", due_date: null, client_name: null, for: "system", description_en: "  Fix the report\n in the system " },
    { description: "Ligar para o contador", due_date: null, client_name: null, for: "alice", description_en: "Call the accountant" },
    { description: "Preparar a mensagem", due_date: null, client_name: null, for: "self", description_pt: "should be ignored" }
  ] };
  const h = harness(d, "rafa", () => reply);
  const r = await h.speak();
  ok(r.status === 200 && r.data.tasks.length === 3 && h.calls.model.length === 1 && h.calls.asr === 1, "a dictation with a system task makes ONE model call (no second call to translate)");
  const p = h.calls.model[0].prompt;
  ok(!isTranslate(p) && p.indexOf('- Add "description_en" to an entry ONLY when its "for" is "system": that same to-do in English.') > 0 && p.indexOf('No other entry has "description_en".') > 0, "that one call asks for \"description_en\" on the entries for the system only");
  ok(p.indexOf("description_pt") < 0 && p.indexOf("Keep names, numbers, numeric dates and money exactly as he said them; translate ordinary words for days and months") > 0, "and not for a Portuguese version; names, numbers, dates and money are kept");
  ok(p.indexOf("- Keep the language he spoke for each to-do. Do not translate.") > 0 && p.indexOf('{"tasks":[{"description": string, "due_date": "YYYY-MM-DD" or null, "client_name": string or null, "for": "self" | "rafa" | "alice" | "system"}]}') > 0, "the description itself is still kept in his words, and the fixed shape is unchanged");
  const rows = d.q("SELECT * FROM tasks WHERE source = 'voice' ORDER BY rowid");
  ok(rows[0].assigned_to === "developer" && rows[0].description === "Arrumar o relatorio no sistema" && rows[0].description_en === "Fix the report in the system" && rows[0].description_pt === null, "the system task keeps his words and saves the English version (spaces tidied)");
  ok(rows[1].assigned_to === "alice" && rows[1].description_en === null && rows[1].description_pt === null && rows[2].description_en === null && rows[2].description_pt === null, "a version the model sent for a task that does NOT involve the developer is not saved");
  ok(r.data.tasks[0].description_en === "Fix the report in the system" && r.data.tasks[1].description_en === null && r.data.tasks[2].description_pt === null, "the answer's tasks carry the fields");
  const devPush = h.calls.push.find((x) => x.emails[0] === "dev@x.test");
  const alicePush = h.calls.push.find((x) => x.emails[0] === "alice@x.test");
  ok(devPush.payload.body === "Fix the report in the system" && alicePush.payload.body === "Ligar para o contador", "the developer's push is the English version; alice's is the words as spoken");

  // The model leaves it out: saved without it.
  const d2 = world();
  const h2 = harness(d2, "alice", () => ({ tasks: [{ description: "Mudar o menu do sistema", due_date: null, client_name: null, for: "system" }] }));
  const r2 = await h2.speak();
  const row2 = d2.q("SELECT * FROM tasks WHERE source = 'voice'")[0];
  ok(r2.status === 200 && h2.calls.model.length === 1 && row2.description === "Mudar o menu do sistema" && row2.description_en === null && r2.data.tasks[0].description_en === null, "the model leaves the version out: the task is saved without it, still one call");
  ok(h2.calls.push[0].payload.body === "Mudar o menu do sistema", "and the push carries the words as spoken");
  const d2b = world();
  const h2b = harness(d2b, "rafa", () => ({ tasks: [{ description: "Arrumar", due_date: null, client_name: null, for: "system", description_en: 42 }, { description: "Trocar", due_date: null, client_name: null, for: "system", description_en: "   " }] }));
  const r2b = await h2b.speak();
  ok(r2b.status === 200 && d2b.q("SELECT * FROM tasks WHERE source = 'voice'").every((t) => t.description_en === null), "a version that is not text, or is blank, is saved as none");

  // The developer speaks: EVERY entry, in Portuguese.
  const d3 = world();
  const h3 = harness(d3, "dev", () => ({ tasks: [
    { description: "Send me the logo", due_date: null, client_name: null, for: "rafa", description_pt: "Me mande o logo" },
    { description: "Print the forms", due_date: null, client_name: null, for: "alice", description_pt: "Imprima os formularios" },
    { description: "Rotate the keys", due_date: null, client_name: null, for: "self", description_pt: "Trocar as chaves", description_en: "should be ignored" }
  ] }), { transcript: "Send me the logo, print the forms, rotate the keys." });
  const r3 = await h3.speak();
  const p3 = h3.calls.model[0].prompt;
  ok(r3.status === 200 && h3.calls.model.length === 1 && p3.indexOf('- Add "description_pt" to EVERY entry: that same to-do in Portuguese of Brazil.') > 0 && p3.indexOf("description_en") < 0, "the developer speaks: the one call asks for \"description_pt\" on EVERY entry");
  const rows3 = d3.q("SELECT * FROM tasks WHERE source = 'voice' ORDER BY rowid");
  ok(rows3.length === 3 && rows3[0].description_pt === "Me mande o logo" && rows3[1].description_pt === "Imprima os formularios" && rows3[2].description_pt === "Trocar as chaves" && rows3.every((t) => t.description_en === null && t.created_by_role === "developer"), "all three are saved with their Portuguese version (and no English one)");
  ok(rows3[0].description === "Send me the logo" && rows3[2].description === "Rotate the keys", "the original words are unchanged");
  const rp = h3.calls.push.find((x) => x.emails[0] === "rafa@x.test");
  const ap = h3.calls.push.find((x) => x.emails[0] === "alice@x.test");
  ok(rp.payload.title === "Nova tarefa" && rp.payload.body === "Me mande o logo" && ap.payload.body === "Imprima os formularios" && h3.calls.push.length === 2, "rafa's and alice's pushes carry the Portuguese versions");

  // A dictation between rafa and alice: nothing is kept even if sent.
  const d4 = world();
  const h4 = harness(d4, "rafa", () => ({ tasks: [{ description: "Pedir o contrato", due_date: null, client_name: null, for: "alice", description_en: "Ask for the contract", description_pt: "x" }] }));
  await h4.speak();
  const row4 = d4.q("SELECT * FROM tasks WHERE source = 'voice'")[0];
  ok(h4.calls.model.length === 1 && row4.description_en === null && row4.description_pt === null, "a dictation between rafa and alice: still one call, nothing extra saved");
}

// ── 7. The page helper: which words each signed-in person reads ─────────────
const sheet = read("task-sheet.js");
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
  focus() {}
  fire(type, ev) { (this.on[type] || []).forEach((f) => f(Object.assign({ target: this, preventDefault() {}, stopPropagation() {} }, ev || {}))); }
  all(out) { out = out || []; this.children.forEach((c) => { out.push(c); c.all(out); }); return out; }
}
// A fresh stand-in page with `role` signed in (sessionStorage apex_role).
// role undefined = a page where sessionStorage itself throws.
function page(role) {
  const doc = { body: new El("body"), head: new El("head"), activeElement: null, keys: [],
    createElement: (t) => new El(t),
    getElementById: (id) => doc.body.all().concat(doc.head.all()).find((e) => e.id === id) || null,
    querySelectorAll: () => [],
    addEventListener: (t, f) => { doc.keys.push(f); }, removeEventListener: (t, f) => { doc.keys = doc.keys.filter((x) => x !== f); } };
  doc.body.classList.contains = () => false;
  const store = { getItem: (k) => { if (role === undefined) { throw new Error("storage blocked"); } return k === "apex_role" ? role : null; } };
  const calls = [];
  const state = { answer: () => ({ ok: true, data: {} }) };
  const fetchStub = async (url, opts) => {
    const call = { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null };
    calls.push(call);
    const a = state.answer(call);
    return { ok: a.ok, json: async () => a.data };
  };
  const S = new Function("document", "window", "fetch", "sessionStorage", dt + "\n" + sheet +
    "\nreturn { taskSheetOpen, taskSheetClose, taskSheetWords, taskSheetTaskWords, taskSheetNoteWords, taskSheetRowNote, taskSheetViewerRole, state: function() { return taskSheetNow; } };")(doc, {}, fetchStub, store);
  return { doc, S, calls, state, $: (id) => doc.getElementById(id) };
}
const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 0)); } };
{
  const T = { description: "orig", description_en: "english", description_pt: "portugues" };
  const N = { body: "nota", body_en: "note-en", body_pt: "nota-pt" };
  const dev = page("developer").S;
  const rafa = page("rafa").S;
  const alice = page("alice").S;
  ok(dev.taskSheetViewerRole() === "developer" && dev.taskSheetWords("orig", "english", "portugues") === "english" && dev.taskSheetTaskWords(T) === "english" && dev.taskSheetNoteWords(N) === "note-en", "signed in as the developer: the English version of a task and of a note");
  ok(rafa.taskSheetTaskWords(T) === "portugues" && rafa.taskSheetNoteWords(N) === "nota-pt" && alice.taskSheetTaskWords(T) === "portugues" && alice.taskSheetNoteWords(N) === "nota-pt", "signed in as rafa or alice: the Portuguese version");
  ok(dev.taskSheetTaskWords({ description: "orig", description_en: null, description_pt: "portugues" }) === "orig" && dev.taskSheetNoteWords({ body: "nota", body_pt: "nota-pt" }) === "nota", "the developer falls back to the original when there is no English version (never to the Portuguese one)");
  ok(rafa.taskSheetTaskWords({ description: "orig", description_en: "english" }) === "orig" && alice.taskSheetNoteWords({ body: "nota", body_en: "note-en", body_pt: "" }) === "nota", "rafa and alice fall back to the original when there is no Portuguese version (never to the English one)");
  ok(page("client").S.taskSheetTaskWords(T) === "orig" && page("").S.taskSheetTaskWords(T) === "orig" && page(undefined).S.taskSheetTaskWords(T) === "orig", "any other role, no role, or a browser whose storage throws: the original");
  ok(dev.taskSheetTaskWords(null) === "" && dev.taskSheetWords(null, null, null) === "" && dev.taskSheetWords(undefined) === "", "nothing to print is an empty string, never \"null\"");

  // The note line on a row.
  const last = { body: "Esta pronto", body_en: "It is ready", body_pt: null, author_role: "alice", author_name: "Pra. Alice" };
  ok(/It is ready/.test(dev.taskSheetRowNote(last, 1).innerHTML) && !/Esta pronto/.test(dev.taskSheetRowNote(last, 1).innerHTML), "the row's note line prints the English version for the developer");
  ok(/Esta pronto/.test(rafa.taskSheetRowNote(last, 1).innerHTML) && !/It is ready/.test(rafa.taskSheetRowNote(last, 1).innerHTML), "and the original for rafa (it was written in Portuguese)");
  const lastDev = { body: "Shipped", body_en: null, body_pt: "Publicado", author_role: "developer", author_name: null };
  ok(/Sistema<\/span><span class="show-en">System<\/span>: Publicado/.test(alice.taskSheetRowNote(lastDev, 1).innerHTML) && /: Shipped/.test(dev.taskSheetRowNote(lastDev, 1).innerHTML), "a developer's note line: Portuguese for alice, his own words for him, from \"Sistema\" / \"System\"");
}

// ── 8. The opened task on the stand-in page: Show original, and Edit ────────
{
  const NOTE_PT = { id: "n1", body: "O relatorio esta errado", body_en: "The report is wrong", body_pt: null, author_role: "rafa", author_name: "Rafael", author_avatar_url: null, created_at: "2026-10-07T16:05:00.000Z" };
  const NOTE_EN = { id: "n2", body: "Fixed.", body_en: null, body_pt: "Corrigido.", author_role: "developer", author_name: null, author_avatar_url: null, created_at: "2026-10-07T17:05:00.000Z" };
  const serverTask = { id: "t1", description: "Arrumar o relatorio", description_en: "Fix the report", description_pt: null, due_date: null, status: "pending", progress: null };
  const TOGGLE_ORIGINAL = '<span class="show-pt">Ver original</span><span class="show-en">Show original</span>';
  const TOGGLE_BACK = '<span class="show-pt">Ver tradu&ccedil;&atilde;o</span><span class="show-en">Show translation</span>';

  // The developer opens a task rafa wrote.
  const P = page("developer");
  const changes = [];
  P.state.answer = () => ({ ok: true, data: { task: serverTask, notes: [NOTE_PT, NOTE_EN] } });
  const opened = P.S.taskSheetOpen({ id: "t1", description: "Arrumar o relatorio", descriptionEn: "Fix the report", descriptionPt: null,
    clientName: "", tags: [], done: false, progress: null, dueDate: null, apiBase: "https://api.test", getToken: async () => "tok", onChange: (c) => changes.push(c) });
  const tg = P.$("taskSheetOriginal");
  ok(opened === true && P.$("taskSheetTitle").textContent === "Fix the report", "the developer opens rafa's task: the title is the English version at once");
  ok(!!tg && tg.hidden === false && tg.innerHTML === TOGGLE_ORIGINAL && tg.tagName === "button", "with a small \"Ver original\" / \"Show original\" button");
  await settle();
  ok(P.$("taskSheetTitle").textContent === "Fix the report" && tg.hidden === false, "still so after the task is read from the Worker");
  tg.fire("click");
  ok(P.$("taskSheetTitle").textContent === "Arrumar o relatorio" && tg.innerHTML === TOGGLE_BACK && tg.hidden === false, "one tap shows the original words, and the button reads \"Ver tradução\" / \"Show translation\"");
  tg.fire("click");
  ok(P.$("taskSheetTitle").textContent === "Fix the report" && tg.innerHTML === TOGGLE_ORIGINAL, "a second tap shows the translation again");

  // The thread.
  const texts = P.$("taskSheetThread").all().filter((e) => /task-sheet-notetext/.test(e.className));
  const toggles = P.$("taskSheetThread").all().filter((e) => "data-note-original" in e.attrs);
  ok(texts.length === 2 && texts[0].textContent === "The report is wrong" && texts[1].textContent === "Fixed.", "the thread: rafa's note in English, the developer's own note as he wrote it");
  ok(toggles.length === 1 && toggles[0].attrs["data-note-original"] === "n1" && toggles[0].innerHTML === TOGGLE_ORIGINAL, "only the translated note has a \"Show original\" button");
  toggles[0].fire("click");
  ok(texts[0].textContent === "O relatorio esta errado" && toggles[0].innerHTML === TOGGLE_BACK && texts[1].textContent === "Fixed." && P.$("taskSheetTitle").textContent === "Fix the report", "tapping it shows that note's original, and nothing else changes");
  toggles[0].fire("click");
  ok(texts[0].textContent === "The report is wrong" && toggles[0].innerHTML === TOGGLE_ORIGINAL, "and back");

  // Edit always edits the original.
  P.$("taskSheetEdit").fire("click");
  ok(P.$("taskSheetEditBox").value === "Arrumar o relatorio", "Edit puts the ORIGINAL words in the box, not the translation on screen");
  ok(P.$("taskSheetEditNote").innerHTML === '<span class="show-pt">Voc&ecirc; est&aacute; editando o texto original.</span><span class="show-en">You are editing the original text.</span>' && /task-add-quiet/.test(P.$("taskSheetEditNote").className), "with one muted line: \"Você está editando o texto original.\" / \"You are editing the original text.\"");
  ok(tg.hidden === true && P.$("taskSheetTitle").hidden === true, "while editing, the title and its toggle are out of the way");
  P.$("taskSheetEditCancel").fire("click");
  ok(P.$("taskSheetTitle").textContent === "Fix the report" && tg.hidden === false, "Cancel puts the translation back");
  tg.fire("click");
  P.$("taskSheetEdit").fire("click");
  ok(P.$("taskSheetEditBox").value === "Arrumar o relatorio" && P.$("taskSheetEditNote").innerHTML === "", "with the original already on screen, Edit shows no such line");

  // Saving new words: the answer's translation is what shows next.
  P.calls.length = 0;
  P.state.answer = (c) => ({ ok: true, data: { ok: true, status: "pending", progress: null, due_date: null, description: c.body.description, description_en: null, description_pt: "Arrumar o relatorio de clientes" } });
  P.$("taskSheetEditBox").value = "Fix the client report";
  P.$("taskSheetEditSave").fire("click");
  await settle();
  ok(P.calls.length === 1 && P.calls[0].method === "PATCH" && JSON.stringify(P.calls[0].body) === JSON.stringify({ description: "Fix the client report" }), "Save sends only the new original words");
  ok(P.$("taskSheetTitle").textContent === "Fix the client report" && tg.hidden === true, "the developer now reads his own new words, and with no English version there is no toggle");
  const lastChange = changes[changes.length - 1];
  ok(lastChange.description === "Fix the client report" && lastChange.description_en === null && lastChange.description_pt === "Arrumar o relatorio de clientes", "the page is told the new words and both translation fields");
  ok(lastChange.last_note.body === "Fixed." && lastChange.last_note.body_pt === "Corrigido." && lastChange.last_note.body_en === null, "and the newest note with its translations, for the row's note line");
  P.S.taskSheetClose();

  // rafa opens a task the developer wrote: Portuguese, and the same toggle.
  const R = page("rafa");
  R.state.answer = () => ({ ok: true, data: { task: { id: "t2", description: "Send me the logo", description_en: null, description_pt: "Me mande o logo", status: "pending" }, notes: [NOTE_PT, NOTE_EN] } });
  R.S.taskSheetOpen({ id: "t2", description: "Send me the logo", apiBase: "https://api.test", getToken: async () => "tok" });
  ok(R.$("taskSheetTitle").textContent === "Send me the logo" && R.$("taskSheetOriginal").hidden === true, "rafa opens from a row that had no translation yet: the original, no toggle");
  await settle();
  ok(R.$("taskSheetTitle").textContent === "Me mande o logo" && R.$("taskSheetOriginal").hidden === false && R.$("taskSheetOriginal").innerHTML === TOGGLE_ORIGINAL, "once the Worker answers with one, he reads the Portuguese version and gets the toggle");
  const rTexts = R.$("taskSheetThread").all().filter((e) => /task-sheet-notetext/.test(e.className));
  const rToggles = R.$("taskSheetThread").all().filter((e) => "data-note-original" in e.attrs);
  ok(rTexts[0].textContent === "O relatorio esta errado" && rTexts[1].textContent === "Corrigido." && rToggles.length === 1 && rToggles[0].attrs["data-note-original"] === "n2", "his thread: his own note as written, the developer's in Portuguese with the toggle");
  ok(R.doc.body.all().every((e) => (e.textContent + e.innerHTML).indexOf("The Developer") < 0), "no developer name anywhere in the sheet");
  R.S.taskSheetClose();

  // A task with no translation at all: nothing new on screen.
  const A = page("alice");
  A.state.answer = () => ({ ok: true, data: { task: { id: "t3", description: "Ligar para o contador", description_en: null, description_pt: null, status: "pending" }, notes: [{ id: "n9", body: "Ja liguei", body_en: null, body_pt: null, author_role: "rafa", author_name: "Rafael", created_at: "2026-10-07T16:05:00.000Z" }] } });
  A.S.taskSheetOpen({ id: "t3", description: "Ligar para o contador", apiBase: "https://api.test", getToken: async () => "tok" });
  await settle();
  ok(A.$("taskSheetTitle").textContent === "Ligar para o contador" && A.$("taskSheetOriginal").hidden === true && A.$("taskSheetThread").all().filter((e) => "data-note-original" in e.attrs).length === 0, "a rafa-to-alice task: the words as written, no toggle on the title or on any note");
  A.$("taskSheetEdit").fire("click");
  ok(A.$("taskSheetEditNote").innerHTML === "", "and Edit shows no \"editing the original\" line");
}

// ── 9. The files ────────────────────────────────────────────────────────────
{
  ok((MIG.match(/^ALTER TABLE (tasks|task_notes) ADD COLUMN (description_en|description_pt|body_en|body_pt) TEXT;$/gm) || []).length === 4 && !/DROP|DELETE|UPDATE|CREATE/i.test(MIG.replace(/^--.*$/gm, "")), "the migration file holds exactly the four ADD COLUMN statements and nothing else");
  const dash = read("dashboard.html");
  const tasksPage = read("tasks.html");
  ok(dash.split("taskSheetTaskWords(t)").length === 3 && !/main\.textContent = t\.description \|\|/.test(dash), "dashboard.html: both task row builders print through the helper");
  ok(/taskSheetWords\(task\.text, task\.textEn, task\.textPt\)/.test(tasksPage) && !/textEl\.textContent = task\.text;/.test(tasksPage) && /textEn:\s+r\.description_en \|\| null,\s+textPt:\s+r\.description_pt \|\| null/.test(tasksPage), "tasks.html: the row builder prints through the helper, from the fields GET /api/tasks sends");
  ok(/descriptionEn: t\.description_en \|\| null, descriptionPt: t\.description_pt \|\| null/.test(dash) && /descriptionEn: task\.textEn \|\| null, descriptionPt: task\.textPt \|\| null/.test(tasksPage), "both pages hand the sheet the task's two versions");
  ok(sheet.split("sessionStorage.getItem(\"apex_role\")").length === 2 && sheet.split("function taskSheetWords(").length === 2, "task-sheet.js: ONE helper reads the signed-in role and decides the words");
  for (const f of ["task-sheet.js", "dashboard.html", "tasks.html"]) {
    ok(read(f) === read("ios/App/App/public/" + f), f + ": the root and iOS copies are the same");
  }
  const cut = (name) => { const i = workerSrc.indexOf("\nasync function " + name + "("); return workerSrc.slice(i, workerSrc.indexOf("\n}", i)); };
  const tr = cut("taskTranslate");
  ok(/taskVoiceAskClaude\(env, /.test(tr) && !/fetch\(/.test(tr) && !/model:/.test(tr), "taskTranslate calls the model only through taskVoiceAskClaude (the file's one way, CLAUDE_MODEL)");
  ok(!/openai|gpt-|whisper/i.test(tr + cut("handlePostTaskNote") + cut("handlePostTaskTyped") + sheet), "no OpenAI product in the new code");
  ok(!/\b(confirm|alert|prompt)\s*\(/.test(sheet), "task-sheet.js: no browser pop-up");
  ok(!/[^\x00-\x7F]/.test(sheet), "task-sheet.js is plain ASCII (accents are HTML entities)");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
