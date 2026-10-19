// Task 2.7: deleting a project with a linked calendar event must refuse
// with the plain bilingual reason, never a raw SQL error. Real Worker
// function, in-memory D1 (with foreign keys enforced, same as production).
//
//   node scripts/test-job-delete-calendar-guard.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = ["handleDeleteGmRow", "gmOwnedRow", "actorName"];
const GM_DELETE_TABLES_SRC = "{\"jobs\": \"gm_jobs\", \"partners\": \"gm_partners\", \"leads\": \"gm_leads\"}";

function world() {
  const d = makeDb([]);
  d.raw.exec("CREATE TABLE gm_jobs (id TEXT PRIMARY KEY, client_id TEXT, obra TEXT, status TEXT)");
  d.raw.exec("CREATE TABLE gm_finance (id TEXT PRIMARY KEY, obra_id TEXT)");
  d.raw.exec("CREATE TABLE gm_contract_notices (id TEXT PRIMARY KEY, client_id TEXT, job_id TEXT, resolved_at TEXT, resolution TEXT, resolved_by TEXT)");
  d.raw.exec("CREATE TABLE gm_events (id TEXT PRIMARY KEY, client_id TEXT, job_id TEXT REFERENCES gm_jobs(id), title TEXT)");
  d.raw.exec("PRAGMA foreign_keys = ON");
  const state = { user: { role: "alice", display_name: "Alice" } };
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => state.user,
    requireClientAccess: () => true,
    GM_DELETE_TABLES: { jobs: "gm_jobs" },
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status || 400, error: en, error_pt: pt, error_en: en }, extra || {})
  });
  const F = build(FNS, ["GM_DELETE_TABLES"], stubs);
  return { d, F, env: { DB: d.DB }, state };
}
function rq() { return { url: "https://x.test/", headers: { get: () => null }, json: async () => ({}) }; }

{
  const w = world();
  w.d.raw.prepare("INSERT INTO gm_jobs (id, client_id, obra, status) VALUES ('j1','test-client-temp-001','HONDA','Em andamento')").run();
  w.d.raw.prepare("INSERT INTO gm_events (id, client_id, job_id, title) VALUES ('e1','test-client-temp-001','j1','Visita')").run();

  const r = await w.F.handleDeleteGmRow("test-client-temp-001", "jobs", "j1", rq(), w.env);
  ok(r.status === 400 && r.code === "job_has_calendar_event", "a project with a linked calendar event refuses with code job_has_calendar_event");
  ok(r.error_pt === "Este projeto tem um evento no calendário. Remova o evento primeiro.", "PT reason is the exact plain bilingual sentence");
  ok(r.error_en === "This project has a calendar event. Remove the event first.", "EN reason is the exact plain bilingual sentence");

  const stillThere = w.d.raw.prepare("SELECT id FROM gm_jobs WHERE id = 'j1'").get();
  ok(!!stillThere, "the project itself was NOT deleted");
  const eventStillThere = w.d.raw.prepare("SELECT id FROM gm_events WHERE id = 'e1'").get();
  ok(!!eventStillThere, "the calendar event was NOT automatically deleted (no automatic deletions)");
}

// Removing the event first lets the delete through.
{
  const w = world();
  w.d.raw.prepare("INSERT INTO gm_jobs (id, client_id, obra, status) VALUES ('j2','test-client-temp-001','Gatão','Em andamento')").run();
  const r1 = await w.F.handleDeleteGmRow("test-client-temp-001", "jobs", "j2", rq(), w.env);
  ok(r1.status === 200 || r1.data, "a project with NO linked calendar event deletes normally");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
