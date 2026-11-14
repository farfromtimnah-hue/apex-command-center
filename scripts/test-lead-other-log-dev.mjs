// GET /api/dev/lead-other-log: the developer's read only list (2026-11-14).
//
//   node scripts/test-lead-other-log-dev.mjs
//
// Real handler against an in-memory SQLite. 401 not signed in; 403 for alice,
// rafa, an owner and a seller; 200 for the developer. Open rows only, newest
// first, at most 200, one fixed set of fields. The route is wired in the router.
import { makeDb, loadWorker, makeStubs, mkReq, USERS, workerSrc } from "./fixtures/lead-reason-harness.mjs";

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};
const state = { user: null };
const database = makeDb();
const W = loadWorker(makeStubs(state));
const env = { DB: database.DB };
database.raw.exec("INSERT INTO clients (id, name) VALUES ('c1', 'Piscinas Sol'), ('c2', 'Telhados Norte')");
const log = (id, client, field, text, at, status, by) => database.raw.prepare(
  "INSERT INTO gm_lead_other_log (id, client_id, lead_id, field, text, created_by, created_at, status) VALUES (?,?,?,?,?,?,?,?)").run(id, client, "L-" + id, field, text, by || "Ana Lima", at, status || "open");
log("a", "c1", "lost_reason", "The pool was sold already.", "2026-11-10 14:00:00");
log("b", "c2", "finance_status", "Family loan", "2026-11-12 18:30:00");
log("c", "c1", "lost_reason", "Handled long ago, should not show", "2026-11-11 09:00:00", "handled");
const get = async (user) => {
  state.user = user;
  if (typeof W.handleGetDevLeadOtherLog !== "function") { return { status: "no handler", body: {} }; }
  const res = await W.handleGetDevLeadOtherLog(mkReq({}, {}, "https://w.example/api/dev/lead-other-log"), env);
  return { status: res.status, body: await res.json() };
};
t("not signed in is 401", (await get(null)).status, 401);
for (const who of ["alice", "rafa", "owner", "seller"]) { t(who + " is 403", (await get(USERS[who])).status, 403); }
const r = await get(USERS.developer);
t("the developer is 200", r.status, 200);
const rows = r.body.rows || [];
t("only open rows, newest first", rows.map((x) => x.created_at), ["2026-11-12 18:30:00", "2026-11-10 14:00:00"]);
t("each row has field, text, client name, date and who", rows.map((x) => [x.field, x.text, x.client_name, x.created_by]),
  [["finance_status", "Family loan", "Telhados Norte", "Ana Lima"], ["lost_reason", "The pool was sold already.", "Piscinas Sol", "Ana Lima"]]);
t("a row carries nothing else (no ids of leads, no status)", Object.keys(rows[0] || {}).sort(), ["client_name", "created_at", "created_by", "field", "text"]);
for (let i = 0; i < 210; i++) { log("m" + i, "c1", "lost_reason", "Bulk row number " + i + " of the test", "2026-11-13 10:" + String(i % 60).padStart(2, "0") + ":00"); }
t("at most 200 rows", ((await get(USERS.developer)).body.rows || []).length, 200);
t("the route is wired in the router for GET only", /path === "\/api\/dev\/lead-other-log" && method === "GET"\) \{ return handleGetDevLeadOtherLog\(request, env\)/.test(workerSrc), true);

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
