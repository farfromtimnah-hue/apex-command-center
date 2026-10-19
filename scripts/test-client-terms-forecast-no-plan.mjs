// Task 4.3: the revenue forecast now includes a client with NO completed
// client_terms row at all, marked excluded/reason=no_plan rather than
// silently dropped -- the month-by-month table needs this to show "Sem
// plano"/"No plan" instead of inventing or defaulting an amount.
//
//   node scripts/test-client-terms-forecast-no-plan.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = ["handleGetClientTermsForecast", "clientTermsAuth", "clientTermsAuthed", "clientTermsMonthlyEquivalentCents", "gmEasternToday"];

function world() {
  const d = makeDb([]);
  d.raw.exec("CREATE TABLE client_terms (client_id TEXT, answers_json TEXT, completed INTEGER)");
  const state = { user: { role: "alice" } };
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => state.user
  });
  const F = build(FNS, [], stubs);
  return { d, F, env: { DB: d.DB }, state };
}
function rq() { return { url: "https://x.test/", headers: { get: () => null }, json: async () => ({}) }; }

{
  const w = world();
  w.d.raw.prepare("INSERT INTO clients (id, name, status, archived) VALUES ('c1', 'Has Plan', 'active', 0)").run();
  w.d.raw.prepare("INSERT INTO clients (id, name, status, archived) VALUES ('c2', 'No Plan At All', 'active', 0)").run();
  w.d.raw.prepare("INSERT INTO clients (id, name, status, archived) VALUES ('c3', 'Archived', 'active', 1)").run();
  w.d.raw.prepare(
    "INSERT INTO client_terms (client_id, answers_json, completed) VALUES ('c1', ?, 1)"
  ).run(JSON.stringify({
    amount: { amount_cents: 100000 }, frequency: { frequency: "monthly" }
  }));

  const r = await w.F.handleGetClientTermsForecast(rq(), w.env);
  ok(r.status === 200, "forecast loads");
  const c1 = r.data.clients.find((c) => c.client_id === "c1");
  const c2 = r.data.clients.find((c) => c.client_id === "c2");
  const c3 = r.data.clients.find((c) => c.client_id === "c3");
  ok(c1 && !c1.excluded && c1.monthly_cents === 100000, "a client with a real plan shows its monthly amount");
  ok(c2 && c2.excluded === true && c2.reason === "no_plan" && c2.monthly_cents === 0, "a client with NO client_terms row at all is marked excluded/no_plan, never dropped silently");
  ok(!c3, "an archived client never appears in the forecast at all");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
