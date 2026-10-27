// Security phase A: daily caps on every Claude route. The real ClaudeBudget
// class, the real claudeBudgetGate / claudeBudgetMissAllowed and the real
// handlers handlePostHelpAsk and handlePostFinanceStatementUpload are cut out
// of worker/index.js and run against a fake Durable Object namespace (a real
// SQLite behind the same sql.exec shape). No network, no production data.
//
//   node scripts/test-claude-budget.mjs
import { DatabaseSync } from "node:sqlite";
import { build, fnSrc, workerSrc } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

// ---- the class, as shipped (export keyword dropped so it can run in a Function)
const i0 = workerSrc.indexOf("export class ClaudeBudget extends DurableObject {");
const classSrc = workerSrc.slice(i0, workerSrc.indexOf("\n}\n", i0) + 3).replace(/^export /, "");
function varLine(name) {
  const i = workerSrc.indexOf("\nvar " + name + " =");
  const m = /;[ \t]*(\/\/[^\n]*)?\n/.exec(workerSrc.slice(i));
  return workerSrc.slice(i + 1, i + m.index + 1);
}
const VARS = ["CLAUDE_DAILY_ASK_PER_LOGIN", "CLAUDE_DAILY_SUGGEST_PER_LOGIN", "CLAUDE_DAILY_OTHER_PER_LOGIN", "CLAUDE_DAILY_GLOBAL",
  "CLAUDE_DAILY_MISS_PER_LOGIN", "CLAUDE_BUDGET_FAIL_CLOSED", "CLAUDE_BUDGET_LIMITS"];

// ---- fake clock and fake Durable Object namespace
let NOW = Date.parse("2026-10-26T15:00:00Z");
class FakeDate extends Date { constructor(...a) { if (a.length) { super(...a); } else { super(NOW); } } static now() { return NOW; } }

function makeNamespace(opts) {
  opts = opts || {};
  const instances = new Map();
  const ctxFor = () => {
    const db = new DatabaseSync(":memory:");
    let alarm = null;
    return {
      storage: {
        sql: { exec: (q, ...b) => { const st = db.prepare(q); return /^\s*select/i.test(q) ? { toArray: () => st.all(...b) } : (st.run(...b), { toArray: () => [] }); } },
        getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; }, deleteAll: async () => { alarm = null; }
      }
    };
  };
  const ClaudeBudget = new Function("class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\n" + VARS.map(varLine).join("\n") + "\n" + classSrc + "\nreturn ClaudeBudget;")();
  return {
    names: () => [...instances.keys()],
    idFromName: (n) => n,
    get: (id) => {
      if (opts.broken) { return { check: async () => { throw new Error("DO down"); } }; }
      if (!instances.has(id)) { instances.set(id, new ClaudeBudget(ctxFor(), {})); }
      return instances.get(id);
    }
  };
}

function jsonErr2(pt, en, status, extra) { return { status: status || 400, error_pt: pt, error_en: en, extra }; }
const logs = [];
const gateStubs = { Date: FakeDate, jsonErr2, console: { error: (...a) => logs.push(a.join(" ")), log: () => {} } };
const gate = build(["claudeBudgetPersonId", "claudeBudgetCall", "claudeBudgetGate", "claudeBudgetMissAllowed"], VARS, gateStubs);

const ALICE = { role: "alice", email: "A@x.test" };
const BOB = { role: "rafa", email: "b@x.test" };
const CLIENT = { role: "client", client_id: "c1", username: "loja1" };

// ---- under cap is allowed, over cap is 429
{
  const env = { CLAUDE_BUDGET: makeNamespace() };
  let allOk = true;
  for (let i = 0; i < 60; i++) { if (await gate.claudeBudgetGate(env, ALICE, "ask") !== null) { allOk = false; } }
  ok(allOk, "60 Ask questions in a day are allowed");
  const r = await gate.claudeBudgetGate(env, ALICE, "ask");
  ok(r && r.status === 429 && r.error_pt && r.error_en, "the 61st Ask question is 429 with a PT and an EN message");
  ok(/amanh/.test(r.error_pt) && /tomorrow/.test(r.error_en), "the 429 messages say to try tomorrow");
  let s = 0; for (let i = 0; i < 15; i++) { if (await gate.claudeBudgetGate(env, ALICE, "suggest") === null) { s++; } }
  ok(s === 15 && (await gate.claudeBudgetGate(env, ALICE, "suggest")).status === 429, "Suggest allows 15 then 429, counted apart from Ask");
  let o = 0; for (let i = 0; i < 200; i++) { if (await gate.claudeBudgetGate(env, ALICE, "other") === null) { o++; } }
  ok(o === 200 && (await gate.claudeBudgetGate(env, ALICE, "other")).status === 429, "other handlers allow 200 then 429");
}

// ---- the person key is the verified identity; two logins do not share
{
  const env = { CLAUDE_BUDGET: makeNamespace() };
  for (let i = 0; i < 15; i++) { await gate.claudeBudgetGate(env, ALICE, "suggest"); }
  ok((await gate.claudeBudgetGate(env, ALICE, "suggest")).status === 429, "alice is at her Suggest cap");
  ok(await gate.claudeBudgetGate(env, BOB, "suggest") === null, "bob has his own counter");
  ok(await gate.claudeBudgetGate(env, CLIENT, "suggest") === null, "a client login has its own counter");
  ok(gate.claudeBudgetPersonId({ role: "alice", email: "A@X.test" }) === gate.claudeBudgetPersonId({ role: "alice", email: "a@x.test" }), "email is case blind");
  ok(gate.claudeBudgetPersonId(CLIENT) === "c:loja1@c1", "client key is username@client_id");
  ok(gate.claudeBudgetPersonId({ role: "client", client_id: "c1", username: "other" }) !== gate.claudeBudgetPersonId(CLIENT), "two client logins of the same client do not share");
  ok(!/request|body/.test(fnSrc("claudeBudgetPersonId", workerSrc)), "the person key reads no request field");
}

// ---- new day resets
{
  const env = { CLAUDE_BUDGET: makeNamespace() };
  for (let i = 0; i < 15; i++) { await gate.claudeBudgetGate(env, ALICE, "suggest"); }
  ok((await gate.claudeBudgetGate(env, ALICE, "suggest")).status === 429, "capped today");
  NOW = Date.parse("2026-10-27T00:00:01Z");
  ok(await gate.claudeBudgetGate(env, ALICE, "suggest") === null, "after UTC midnight the counter starts again");
  NOW = Date.parse("2026-10-26T15:00:00Z");
}

// ---- global cap
{
  const env = { CLAUDE_BUDGET: makeNamespace() };
  const ns = env.CLAUDE_BUDGET;
  const g = ns.get("g:2026-10-26");
  for (let i = 0; i < 1999; i++) { await g.check("global"); }
  ok(await gate.claudeBudgetGate(env, ALICE, "other") === null, "the 2000th call of the day is allowed");
  const r = await gate.claudeBudgetGate(env, BOB, "ask");
  ok(r && r.status === 429, "the 2001st call of the day is 429 for anyone");
  const c = await gate.claudeBudgetGate(env, null, "cron");
  ok(c === null, "the internal cron is counted but never refused, even over the global cap");
  ok((await g.check("global")).ok === false, "and the global counter stays over the cap");
}

// ---- Durable Object failure
{
  const env = { CLAUDE_BUDGET: makeNamespace({ broken: true }) };
  const a = await gate.claudeBudgetGate(env, ALICE, "ask");
  ok(a && a.status === 503, "Ask fails closed when the counter is down");
  const s = await gate.claudeBudgetGate(env, ALICE, "suggest");
  ok(s && s.status === 503, "Suggest fails closed when the counter is down");
  ok(await gate.claudeBudgetGate(env, ALICE, "other") === null, "staff tools fail open when the counter is down");
  ok(await gate.claudeBudgetGate(env, null, "cron") === null, "the cron fails open when the counter is down");
  const none = await gate.claudeBudgetGate({}, ALICE, "ask");
  ok(none && none.status === 503, "a missing binding also fails closed for Ask");
  ok(await gate.claudeBudgetMissAllowed(env, ALICE) === false, "no help_gaps row is written when the counter is down");
  ok(logs.every((l) => !/example|a@x|alice/i.test(l)), "the log lines carry no person or question");
}

// ---- miss limit
{
  const env = { CLAUDE_BUDGET: makeNamespace() };
  let n = 0; for (let i = 0; i < 12; i++) { if (await gate.claudeBudgetMissAllowed(env, ALICE)) { n++; } }
  ok(n === 10, "10 help_gaps rows per login per day, then none");
  ok(await gate.claudeBudgetMissAllowed(env, BOB) === true, "another login still writes its misses");
}

// ---- the self cleaning alarm is set once
{
  const ns = makeNamespace();
  const o = ns.get("u:x:2026-10-26");
  await o.check("ask"); await o.check("ask");
  ok(typeof o.ctx.storage.getAlarm === "function" && (await o.ctx.storage.getAlarm()) !== null, "each counter object schedules its own deletion");
  await o.alarm();
  ok((await o.ctx.storage.getAlarm()) === null, "and clears itself when the alarm fires");
}

// ---- real handlers: over cap means NO fetch to Claude
const claudeOk = (obj) => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(obj) }] }) });
function mkHandlers(env, user) {
  const calls = [];
  const stubs = Object.assign({}, gateStubs, {
    authenticate: async () => user,
    jsonOk: (d) => ({ status: 200, data: d }),
    jsonErr: (m, s) => ({ status: s || 400, error: m }),
    CLAUDE_API_URL: "https://api.anthropic.com/v1/messages",
    HELP_AI_MODEL: "m", CLAUDE_MODEL: "m",
    HELP_INDEXES: { client: { text: "x", ids: { estimate: { sections: { send: true } } } }, admin: { text: "x", ids: { estimate: { sections: { send: true } } } } },
    HELP_OTHERS: {},
    supportStaffAuthed: (u) => !!u && ["alice", "rafa", "developer", "seller"].includes(u.role),
    helpPageKey: () => "",
    helpViewerRole: async () => "owner",
    helpIndexFor: () => ({ text: "x", ids: { estimate: { sections: { send: true } } } }),
    helpClampResult: (r) => r,
    helpSystemText: () => "sys",
    publicReadRateLimited: () => false,
    validateHelpReply: () => ({ found: true, guide_ids: ["estimate"], best: null, reply: "ok", other_side: [], kind: "answer" }),
    fetch: async (url, init) => { calls.push(url); return claudeOk({}); },
    crypto: { randomUUID: () => "id" }
  });
  stubs.env = env;
  const w = build(["handlePostHelpAsk", "handlePostFinanceStatementUpload", "claudeBudgetPersonId", "claudeBudgetCall", "claudeBudgetGate", "claudeBudgetMissAllowed"], VARS, stubs);
  return { w, calls };
}
const dbEnv = (extra) => Object.assign({ CLAUDE_API_KEY: "k", DB: { prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => null }) }) } }, extra);
const askReq = (q) => ({ url: "https://x.test/", headers: { get: () => null }, json: async () => ({ question: q || "como envio um orcamento?", language: "en" }) });
{
  const env = dbEnv({ CLAUDE_BUDGET: makeNamespace() });
  const { w, calls } = mkHandlers(env, CLIENT);
  let first60 = true;
  for (let i = 0; i < 60; i++) { const r = await w.handlePostHelpAsk(askReq(), env); if (r.status !== 200) { first60 = false; } }
  ok(first60 && calls.length === 60, "handlePostHelpAsk: 60 questions reach Claude");
  const r = await w.handlePostHelpAsk(askReq(), env);
  ok(r.status === 429 && calls.length === 60, "handlePostHelpAsk: the 61st is 429 and makes NO fetch to Claude");
}
{
  const env = dbEnv({ CLAUDE_BUDGET: makeNamespace({ broken: true }) });
  const { w, calls } = mkHandlers(env, CLIENT);
  const r = await w.handlePostHelpAsk(askReq(), env);
  ok(r.status === 503 && calls.length === 0, "handlePostHelpAsk: counter down means fail closed, NO fetch to Claude");
}
{
  const env = dbEnv({ CLAUDE_BUDGET: makeNamespace() });
  const { w, calls } = mkHandlers(env, null);
  const r = await w.handlePostHelpAsk(askReq(), env);
  ok(r.status === 401 && calls.length === 0 && env.CLAUDE_BUDGET.names().length === 0, "signed out: 401, no Claude call and no counter touched");
}
{
  const upload = { url: "https://x.test/", headers: { get: () => null }, formData: async () => ({ get: (k) => (k === "statement" ? { text: async () => "date,amount\n2026-01-01,5" } : "acct1") }) };
  const env = dbEnv({ CLAUDE_BUDGET: makeNamespace() });
  const { w, calls } = mkHandlers(env, ALICE);
  for (let i = 0; i < 200; i++) { await w.handlePostFinanceStatementUpload(upload, env); }
  const before = calls.length;
  const r = await w.handlePostFinanceStatementUpload(upload, env);
  ok(before === 200 && r.status === 429 && calls.length === 200, "an 'other' handler (statement upload): the 201st call is 429 and makes NO fetch to Claude");
}
{
  const upload = { url: "https://x.test/", headers: { get: () => null }, formData: async () => ({ get: (k) => (k === "statement" ? { text: async () => "d,a\n1,5" } : "acct1") }) };
  const env = dbEnv({ CLAUDE_BUDGET: makeNamespace({ broken: true }) });
  const { w, calls } = mkHandlers(env, ALICE);
  await w.handlePostFinanceStatementUpload(upload, env);
  ok(calls.length === 1, "an 'other' staff handler still reaches Claude when the counter is down (fail open)");
}

// ---- every Claude call in the Worker sits behind a gate
{
  const sites = [...workerSrc.matchAll(/fetch\(CLAUDE_API_URL/g)].length;
  ok(sites === 15, "the Worker still has exactly 15 Claude call sites (trace 004); a new one needs a new gate: found " + sites);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
