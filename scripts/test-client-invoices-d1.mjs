// Task 4.1: the client page's Invoices card now reads D1 (invoices table)
// directly -- no Zoho call. Real Worker function, in-memory D1.
//
//   node scripts/test-client-invoices-d1.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = ["handleGetClientInvoices", "requireClientAccess"];

function world() {
  const d = makeDb([]);
  const state = { user: null, fetchCalled: false };
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => state.user,
    fetch: async () => { state.fetchCalled = true; throw new Error("no network should ever be reached"); }
  });
  const F = build(FNS, [], stubs);
  return { d, F, env: { DB: d.DB }, state };
}
function rq() { return { url: "https://x.test/", headers: { get: () => null }, json: async () => ({}) }; }

{
  const w = world();
  w.d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'Acme Pools')").run();
  w.d.raw.prepare("INSERT INTO invoices (id, client_id, number, amount_cents, due_at, status, source) VALUES ('i1','c1','1001',50000,'2026-10-01','sent','manual')").run();
  w.d.raw.prepare("INSERT INTO invoices (id, client_id, number, amount_cents, due_at, status, source) VALUES ('i2','c1','1002',30000,'2026-09-01','paid','zoho_migrated')").run();
  w.d.raw.prepare("INSERT INTO invoices (id, client_id, number, amount_cents, due_at, status, source) VALUES ('i3','c1','1003',20000,'2026-08-01','draft','manual')").run();
  w.d.raw.prepare("INSERT INTO invoices (id, client_id, number, amount_cents, due_at, status, source) VALUES ('i4','c2','1004',99999,'2026-08-01','sent','manual')").run();
  w.d.raw.prepare("INSERT INTO invoice_payments (id, invoice_id, amount_cents) VALUES ('p1','i1',10000)").run();

  w.state.user = { role: "client", client_id: "c1" };
  const r = await w.F.handleGetClientInvoices("c1", rq(), w.env);
  ok(r.status === 200, "a client-tier owner reads their own invoices");
  ok(!w.state.fetchCalled, "no network call was made -- confirmed D1-only, Zoho never touched");
  ok(r.data.unpaid.length === 1 && r.data.unpaid[0].id === "i1", "only the sent invoice (i1) is in 'unpaid', draft and other client's rows excluded");
  ok(r.data.paid.length === 1 && r.data.paid[0].id === "i2", "the migrated-from-zoho paid invoice (i2, source=zoho_migrated) IS included in 'paid'");
  ok(r.data.unpaid[0].paid_cents === 10000 && r.data.unpaid[0].remaining_cents === 40000, "a partial payment reduces the remaining balance correctly");
  ok(r.data.invoices.every((inv) => inv.id !== "i4"), "another client's invoice never leaks into this client's list");

  w.state.user = { role: "client", client_id: "c2" };
  const r2 = await w.F.handleGetClientInvoices("c1", rq(), w.env);
  ok(r2.status === 403, "client c2 cannot read client c1's invoices");

  w.state.user = null;
  const r3 = await w.F.handleGetClientInvoices("c1", rq(), w.env);
  ok(r3.status === 401, "no session is refused");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
