// Task 1.7: Siri shortcut routes answer for whoever is signed in, scoped by
// their own session role. Tests against the REAL Worker functions on an
// in-memory D1 -- both directions: staff gets the Apex-wide answer, an
// owner gets ONLY their own business, a seller is refused.
//
//   node scripts/test-me-siri-routes.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = [
  "handleGetMeOutstandingInvoices", "handleGetMeTodaySchedule",
  "sessionSellerName", "easternDateStr"
];

const TABLES = [
  "CREATE TABLE gm_invoices (id TEXT PRIMARY KEY, client_id TEXT, amount_cents INTEGER, status TEXT)",
  "CREATE TABLE gm_invoice_payments (invoice_id TEXT, client_id TEXT, amount_cents INTEGER)",
  "CREATE TABLE gm_events (id TEXT PRIMARY KEY, client_id TEXT, title TEXT, event_date TEXT, start_time TEXT, location TEXT)",
  "CREATE TABLE sessions (id TEXT PRIMARY KEY, client_name TEXT, date TEXT, time TEXT, session_type TEXT, location TEXT, status TEXT)"
];

function world() {
  const d = makeDb([]);
  TABLES.forEach((s) => d.raw.exec(s));
  const state = { user: null };
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => state.user,
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status || 400, error: en, error_pt: pt, error_en: en }, extra || {})
  });
  const F = build(FNS, [], stubs);
  const env = { DB: d.DB };
  return { d, F, env, state };
}
function rq() { return { url: "https://x.test/", headers: { get: () => null }, json: async () => ({}) }; }

// ── 1. Admin (alice/rafa/developer) gets the Apex-wide outstanding total ──
{
  const w = world();
  w.d.raw.prepare("INSERT INTO invoices (id, client_id, number, amount_cents, status) VALUES ('i1','c1','1001',10000,'sent')").run();
  w.d.raw.prepare("INSERT INTO invoices (id, client_id, number, amount_cents, status) VALUES ('i2','c2','1002',5000,'paid')").run();
  w.state.user = { role: "alice" };
  const r = await w.F.handleGetMeOutstandingInvoices(rq(), w.env);
  ok(r.status === 200 && r.data.outstanding_cents === 10000 && r.data.scope === "apex", "alice: sees Apex-wide outstanding (only the 'sent' invoice), scope=apex");
}

// ── 2. An owner sees ONLY their own business's balance, never another client's ──
{
  const w = world();
  w.d.raw.prepare("INSERT INTO gm_invoices (id, client_id, amount_cents, status) VALUES ('g1','c1',20000,'sent')").run();
  w.d.raw.prepare("INSERT INTO gm_invoices (id, client_id, amount_cents, status) VALUES ('g2','c2',99999,'sent')").run();
  w.state.user = { role: "client", client_id: "c1", login_role: "client" };
  const r = await w.F.handleGetMeOutstandingInvoices(rq(), w.env);
  ok(r.status === 200 && r.data.outstanding_cents === 20000 && r.data.scope === "own_business", "owner c1: sees only c1's own balance (20000), never c2's 99999");
}

// ── 3. A payment reduces the owner's own outstanding balance ──────────────
{
  const w = world();
  w.d.raw.prepare("INSERT INTO gm_invoices (id, client_id, amount_cents, status) VALUES ('g1','c1',20000,'sent')").run();
  w.d.raw.prepare("INSERT INTO gm_invoice_payments (invoice_id, client_id, amount_cents) VALUES ('g1','c1',15000)").run();
  w.state.user = { role: "client", client_id: "c1", login_role: "client" };
  const r = await w.F.handleGetMeOutstandingInvoices(rq(), w.env);
  ok(r.status === 200 && r.data.outstanding_cents === 5000, "owner c1: balance reflects a partial payment (20000 - 15000 = 5000)");
}

// ── 4. A seller session is refused (no scope is guessed for them) ─────────
{
  const w = world();
  w.state.user = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Joao" };
  const r = await w.F.handleGetMeOutstandingInvoices(rq(), w.env);
  ok(r.status === 403, "a seller session is refused outstanding-invoices, not guessed at");
  const r2 = await w.F.handleGetMeTodaySchedule(rq(), w.env);
  ok(r2.status === 403, "a seller session is refused today-schedule too");
}

// ── 5. Unauthenticated is refused ──────────────────────────────────────────
{
  const w = world();
  w.state.user = null;
  const r = await w.F.handleGetMeOutstandingInvoices(rq(), w.env);
  ok(r.status === 401, "no session: 401, not a guess at scope");
}

// ── 6. Today's schedule: staff sees every session; an owner sees only their own gm_events ──
{
  const w = world();
  const today = w.F.easternDateStr(0);
  w.d.raw.prepare("INSERT INTO sessions (id, client_name, date, time, session_type, location, status) VALUES ('s1','Acme',?,'14:00','online_meet',NULL,'scheduled')").run(today);
  w.d.raw.prepare("INSERT INTO gm_events (id, client_id, title, event_date, start_time, location) VALUES ('e1','c1','Visit',?,'09:00',NULL)").run(today);
  w.d.raw.prepare("INSERT INTO gm_events (id, client_id, title, event_date, start_time, location) VALUES ('e2','c2','Other visit',?,'10:00',NULL)").run(today);

  w.state.user = { role: "rafa" };
  const rStaff = await w.F.handleGetMeTodaySchedule(rq(), w.env);
  ok(rStaff.status === 200 && rStaff.data.scope === "apex" && rStaff.data.sessions.length === 1 && rStaff.data.sessions[0].client_name === "Acme", "rafa: sees the Apex-side sessions table, scope=apex");

  w.state.user = { role: "client", client_id: "c1", login_role: "client" };
  const rOwner = await w.F.handleGetMeTodaySchedule(rq(), w.env);
  ok(rOwner.status === 200 && rOwner.data.scope === "own_business" && rOwner.data.sessions.length === 1 && rOwner.data.sessions[0].client_name === "Visit", "owner c1: sees only c1's own gm_events entry, never c2's");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
