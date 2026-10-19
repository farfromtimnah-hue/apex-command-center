// Task 5.3: the owner is alerted when a customer declines or asks for
// changes on an estimate, and when a referral lead arrives -- neither sent
// a push before this. Real Worker functions, in-memory D1, stubbed push.
//
//   node scripts/test-estimate-decline-push.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = [
  "handlePostPublicEstimateRespond", "gmRecordHomeownerResponse", "gmClientPushTargets",
  "gmEstByToken", "gmEstLinkDead", "gmEstAttach", "gmEstDerivedStatus", "gmEstPublicRateLimit",
  "gmLogLeadEvents", "gmStr", "gmDocParseJsonObject", "gmEasternToday"
];

const BASE_TABLES = [
  "CREATE TABLE gm_estimates (id TEXT PRIMARY KEY, client_id TEXT, lead_id TEXT, public_token TEXT, status TEXT, number TEXT, revision INTEGER DEFAULT 1, change_request_text TEXT, decline_reason TEXT, responded_at TEXT, updated_at TEXT, customer_name TEXT, valid_until TEXT, schedule_json TEXT)",
  "CREATE TABLE gm_estimate_options (id TEXT PRIMARY KEY, estimate_id TEXT NOT NULL, tier TEXT NOT NULL, label TEXT, sort_order INTEGER NOT NULL DEFAULT 0, subtotal_cents INTEGER NOT NULL DEFAULT 0, discount_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE gm_estimate_items (id TEXT PRIMARY KEY, estimate_id TEXT NOT NULL, option_id TEXT NOT NULL, category TEXT, pricing_id TEXT, item_name TEXT NOT NULL, description TEXT, line_type TEXT NOT NULL DEFAULT 'standard', sort_order INTEGER NOT NULL DEFAULT 0, schedule_json TEXT)",
  "CREATE TABLE gm_homeowner_responses (id TEXT PRIMARY KEY, client_id TEXT, job_id TEXT, lead_id TEXT, doc_kind TEXT, doc_id TEXT, doc_number TEXT, response TEXT, reason TEXT, customer_name TEXT, seen_at TEXT)",
  "CREATE TABLE gm_lead_events (id TEXT PRIMARY KEY, client_id TEXT, lead_id TEXT, action TEXT, field TEXT, old_value TEXT, new_value TEXT, actor TEXT, reason TEXT)",
  "CREATE TABLE gm_leads (id TEXT PRIMARY KEY, client_id TEXT, cliente TEXT)",
  "CREATE TABLE users (email TEXT PRIMARY KEY, client_id TEXT, role TEXT)",
  "CREATE TABLE client_logins (username TEXT PRIMARY KEY, client_id TEXT, seller_name TEXT)"
];

function world() {
  const d = makeDb([]);
  BASE_TABLES.forEach((s) => d.raw.exec(s));
  const state = { pushCalls: [] };
  const stubs = Object.assign({}, baseStubs, {
    pushToUsers: async (env, targets, payload) => { state.pushCalls.push({ targets, payload }); return { sent: targets.length }; }
  });
  const F = build(FNS, [], stubs);
  return { d, F, env: { DB: d.DB }, state };
}
function rq(body) { return { url: "https://x.test/", headers: { get: () => null }, json: async () => (body || {}) }; }

{
  const w = world();
  w.d.raw.prepare("INSERT INTO clients (id, name, language) VALUES ('c1', 'Acme Pools', 'en')").run();
  w.d.raw.prepare("INSERT INTO gm_leads (id, client_id, cliente) VALUES ('l1', 'c1', 'Joao')").run();
  w.d.raw.prepare("INSERT INTO gm_estimates (id, client_id, lead_id, public_token, status, number, customer_name) VALUES ('e1','c1','l1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','sent','1001','Joao')").run();
  w.d.raw.prepare("INSERT INTO client_logins (username, client_id, seller_name) VALUES ('owner1', 'c1', NULL)").run();

  const r = await w.F.handlePostPublicEstimateRespond("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "decline", rq({ text: "too expensive" }), w.env);
  ok(r.status === 200, "decline response succeeds");
  ok(w.state.pushCalls.length === 1, "exactly one push fires for a decline");
  ok(w.state.pushCalls[0].payload.title === "Cliente recusou", "push title says the customer declined");
  ok(w.state.pushCalls[0].payload.url === "/portal.html?tab=gmcrm&lead=l1", "push target is the lead itself, task 1.6 style");
  ok(w.state.pushCalls[0].targets.includes("login:owner1"), "push reaches the owner's login");
}

{
  const w = world();
  w.d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c2', 'Beta Pools')").run();
  w.d.raw.prepare("INSERT INTO gm_leads (id, client_id, cliente) VALUES ('l2', 'c2', 'Maria')").run();
  w.d.raw.prepare("INSERT INTO gm_estimates (id, client_id, lead_id, public_token, status, number, customer_name) VALUES ('e2','c2','l2','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','sent','1002','Maria')").run();
  w.d.raw.prepare("INSERT INTO client_logins (username, client_id, seller_name) VALUES ('owner2', 'c2', NULL)").run();

  const r = await w.F.handlePostPublicEstimateRespond("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "changes", rq({ text: "move the date" }), w.env);
  ok(r.status === 200, "a change request succeeds");
  ok(w.state.pushCalls.length === 1 && w.state.pushCalls[0].payload.title === "Cliente pediu mudanças", "a change request also pushes, with its own title");
}

{
  // An accept (no decline/change) must never push through this new path.
  const w = world();
  w.d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c3', 'Gamma Pools')").run();
  w.d.raw.prepare("INSERT INTO gm_leads (id, client_id, cliente) VALUES ('l3', 'c3', 'Pedro')").run();
  w.d.raw.prepare("INSERT INTO gm_estimates (id, client_id, lead_id, public_token, status, number, customer_name, valid_until) VALUES ('e3','c3','l3','cccccccccccccccccccccccccccccccccccccccccccccccc','viewed','1003','Pedro','2099-01-01')").run();
  const r = await w.F.handlePostPublicEstimateRespond("cccccccccccccccccccccccccccccccccccccccccccccccc", "renew", rq({}), w.env);
  ok(r.status !== 200 || w.state.pushCalls.length === 0, "a 'renew' (not decline/changes) never triggers THIS new push");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
