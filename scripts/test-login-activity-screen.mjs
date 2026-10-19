// Task 3.2: GET /api/diagnostics/login-activity's person/date filters, and
// the developer-only gate. Real Worker function, in-memory D1.
//
//   node scripts/test-login-activity-screen.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = ["handleGetDiagnosticsLoginActivity", "easternDateStrFromIso", "gmStr"];

function world() {
  const d = makeDb([]);
  d.raw.exec("CREATE TABLE login_activity (id TEXT PRIMARY KEY, at TEXT, client_id TEXT, person_id TEXT, username TEXT, role TEXT, kind TEXT, detail TEXT, country TEXT, ip_prefix TEXT, device_label TEXT)");
  d.raw.exec("CREATE TABLE login_people (id TEXT PRIMARY KEY, display_name TEXT)");
  const state = { user: { role: "developer" } };
  const stubs = Object.assign({}, baseStubs, { authenticate: async () => state.user });
  const F = build(FNS, [], stubs);
  return { d, F, env: { DB: d.DB }, state };
}
function rq(qs) { return { url: "https://x.test/api/diagnostics/login-activity" + (qs || ""), headers: { get: () => null }, json: async () => ({}) }; }

{
  const w = world();
  w.d.raw.prepare("INSERT INTO login_people (id, display_name) VALUES ('p1', 'Maria Silva')").run();
  w.d.raw.prepare("INSERT INTO login_activity (id, at, person_id, username, kind, detail) VALUES ('a1','2026-10-19T14:00:00.000Z','p1','maria1','finance_view','{}')").run();
  w.d.raw.prepare("INSERT INTO login_activity (id, at, person_id, username, kind, detail) VALUES ('a2','2026-10-15T09:00:00.000Z','p1','maria1','data_change','{\"group\":\"/api/clients/:id/notes\",\"method\":\"POST\"}')").run();
  w.d.raw.prepare("INSERT INTO login_activity (id, at, person_id, username, kind, detail) VALUES ('a3','2026-10-19T10:00:00.000Z',NULL,'joao2','finance_view','{}')").run();

  w.state.user = { role: "developer" };
  const r1 = await w.F.handleGetDiagnosticsLoginActivity(rq(), w.env);
  ok(r1.status === 200 && r1.data.activity.length === 3, "developer sees all rows with no filter");

  const r2 = await w.F.handleGetDiagnosticsLoginActivity(rq("?person=maria"), w.env);
  ok(r2.status === 200 && r2.data.activity.length === 2 && r2.data.activity.every((a) => a.username === "maria1"), "person filter matches by username substring");

  const r3 = await w.F.handleGetDiagnosticsLoginActivity(rq("?person=Silva"), w.env);
  ok(r3.status === 200 && r3.data.activity.length === 2, "person filter also matches by display_name substring");

  const r4 = await w.F.handleGetDiagnosticsLoginActivity(rq("?date=2026-10-19"), w.env);
  ok(r4.status === 200 && r4.data.activity.length === 2 && r4.data.activity.every((a) => a.id !== "a2"), "date filter keeps only that Eastern calendar day's rows");

  w.state.user = { role: "alice" };
  const r5 = await w.F.handleGetDiagnosticsLoginActivity(rq(), w.env);
  ok(r5.status === 403, "alice (admin but not developer) is refused -- this screen is developer-only");

  w.state.user = { role: "client", client_id: "c1" };
  const r6 = await w.F.handleGetDiagnosticsLoginActivity(rq(), w.env);
  ok(r6.status === 403, "a client-tier session is refused");

  w.state.user = null;
  const r7 = await w.F.handleGetDiagnosticsLoginActivity(rq(), w.env);
  ok(r7.status === 401, "no session is refused");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
