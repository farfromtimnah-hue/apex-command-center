// Task 3.1: dormant-login check -- a login created 3+ full Eastern days ago
// with no sign-in yet (passkey or old password, both converge on
// client_logins.last_login_at) is listed; developer/alice/rafa only.
//
//   node scripts/test-dormant-logins.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = ["handleGetGmDormantLogins", "isAdminRole", "easternDateStr", "planParam", "planAnd"];

function world() {
  const d = makeDb([]);
  d.raw.exec("CREATE TABLE login_people (id TEXT PRIMARY KEY, client_id TEXT, display_name TEXT, role TEXT, username TEXT, status TEXT NOT NULL DEFAULT 'invited', created_at TEXT)");
  d.raw.exec("CREATE TABLE client_logins (username TEXT PRIMARY KEY, last_login_at TEXT)");
  const state = { user: { role: "developer" } };
  const stubs = Object.assign({}, baseStubs, { authenticate: async () => state.user });
  const F = build(FNS, [], stubs);
  return { d, F, env: { DB: d.DB }, state };
}
function rq() { return { url: "https://x.test/", headers: { get: () => null }, json: async () => ({}) }; }
function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().replace("T", " ").slice(0, 19); }

{
  const w = world();
  w.d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'Acme Pools')").run();
  // Dormant: created 5 days ago, username exists, never logged in.
  w.d.raw.prepare("INSERT INTO login_people (id, client_id, display_name, role, username, created_at) VALUES ('p1','c1','Maria','client','u1',?)").run(daysAgo(5));
  w.d.raw.prepare("INSERT INTO client_logins (username, last_login_at) VALUES ('u1', NULL)").run();
  // Not dormant: created 5 days ago but HAS signed in.
  w.d.raw.prepare("INSERT INTO login_people (id, client_id, display_name, role, username, created_at) VALUES ('p2','c1','Joao','staff','u2',?)").run(daysAgo(5));
  w.d.raw.prepare("INSERT INTO client_logins (username, last_login_at) VALUES ('u2', ?)").run(daysAgo(1));
  // Not dormant: created only 1 day ago (under the 3-day threshold).
  w.d.raw.prepare("INSERT INTO login_people (id, client_id, display_name, role, username, created_at) VALUES ('p3','c1','Ana','partner','u3',?)").run(daysAgo(1));
  w.d.raw.prepare("INSERT INTO client_logins (username, last_login_at) VALUES ('u3', NULL)").run();
  // Not dormant: never accepted the invite at all (no username yet).
  w.d.raw.prepare("INSERT INTO login_people (id, client_id, display_name, role, username, created_at) VALUES ('p4','c1','Pedro','staff',NULL,?)").run(daysAgo(10));
  // Not dormant: disabled.
  w.d.raw.prepare("INSERT INTO login_people (id, client_id, display_name, role, username, status, created_at) VALUES ('p5','c1','Carla','staff','u5','disabled',?)").run(daysAgo(10));
  w.d.raw.prepare("INSERT INTO client_logins (username, last_login_at) VALUES ('u5', NULL)").run();

  w.state.user = { role: "developer" };
  const r = await w.F.handleGetGmDormantLogins(rq(), w.env);
  ok(r.status === 200, "developer sees the dormant-logins route");
  ok(r.data.dormant.length === 1, "exactly one row is genuinely dormant (p1)");
  ok(r.data.dormant[0].id === "p1" && r.data.dormant[0].client_name === "Acme Pools" && r.data.dormant[0].display_name === "Maria", "the dormant row carries person + business name");

  w.state.user = { role: "alice" };
  const r2 = await w.F.handleGetGmDormantLogins(rq(), w.env);
  ok(r2.status === 200, "alice (admin) also sees the route");

  w.state.user = { role: "client", client_id: "c1" };
  const r3 = await w.F.handleGetGmDormantLogins(rq(), w.env);
  ok(r3.status === 403, "a client-tier session is refused");

  w.state.user = null;
  const r4 = await w.F.handleGetGmDormantLogins(rq(), w.env);
  ok(r4.status === 401, "no session is refused");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
