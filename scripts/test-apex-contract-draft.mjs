// Task 5.1: contract drafts -- autosave, ONE open draft per client, a
// version-guarded write so two open tabs can never silently overwrite each
// other, and a voided draft stays in history (no hard delete).
//
//   node scripts/test-apex-contract-draft.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = ["handleGetApexContractDraft", "handlePutApexContractDraft", "apxDraftVoid", "apxAuthStaff", "actorName", "isAdminRole"];

function world() {
  const d = makeDb(["migrations/2026-10-19_gm_contract_drafts.sql"]);
  // apxAuthStaff's own SELECT reads a few columns the base fixture schema
  // predates (owners_json, location_state, location_city).
  ["owners_json", "location_state", "location_city"].forEach((col) => {
    try { d.raw.exec("ALTER TABLE clients ADD COLUMN " + col + " TEXT"); } catch (e) {}
  });
  ["c1", "c2", "c3", "c4"].forEach((id) => {
    d.raw.prepare("INSERT INTO clients (id, name) VALUES (?, ?)").run(id, id);
  });
  const state = { user: { role: "rafa" } };
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => state.user,
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status || 400, error: en, error_pt: pt, error_en: en }, extra || {})
  });
  const F = build(FNS, [], stubs);
  return { d, F, env: { DB: d.DB }, state };
}
function rq(body) { return { url: "https://x.test/", headers: { get: () => null }, json: async () => (body || {}) }; }

{
  const w = world();
  const r1 = await w.F.handleGetApexContractDraft("c1", rq(), w.env);
  ok(r1.status === 200 && r1.data.draft === null, "no draft yet: GET answers draft:null, not an error");

  const save1 = await w.F.handlePutApexContractDraft("c1", rq({ data: { company_name: "Acme" }, version: 0 }), w.env);
  ok(save1.status === 200 && save1.data.version === 1, "first save creates the draft at version 1");

  const r2 = await w.F.handleGetApexContractDraft("c1", rq(), w.env);
  ok(r2.status === 200 && r2.data.draft.data.company_name === "Acme" && r2.data.draft.version === 1, "GET returns the saved data and version");

  const save2 = await w.F.handlePutApexContractDraft("c1", rq({ data: { company_name: "Acme Pools" }, version: 1 }), w.env);
  ok(save2.status === 200 && save2.data.version === 2, "a second save with the right version succeeds and bumps the version");

  // Simulate a second tab saving at version 2 (now the row is at version 3)...
  await w.F.handlePutApexContractDraft("c1", rq({ data: { company_name: "Acme Pools Inc" }, version: 2 }), w.env);
  // ...then THIS tab (still holding the stale version 2) tries to save.
  const conflict = await w.F.handlePutApexContractDraft("c1", rq({ data: { company_name: "Acme Pools STALE" }, version: 2 }), w.env);
  ok(conflict.status === 409 && conflict.code === "version_conflict", "a stale version save is refused with version_conflict, never silently overwriting the newer one");

  const r3 = await w.F.handleGetApexContractDraft("c1", rq(), w.env);
  ok(r3.data.draft.data.company_name === "Acme Pools Inc", "the newer save from the other tab survives, the stale one never landed");
}

{
  const w = world();
  await w.F.handlePutApexContractDraft("c2", rq({ data: { company_name: "Beta" }, version: 0 }), w.env);
  await w.F.apxDraftVoid(w.env, "c2");
  const r = await w.F.handleGetApexContractDraft("c2", rq(), w.env);
  ok(r.data.draft === null, "a voided draft no longer shows as the open draft");
  const row = w.d.raw.prepare("SELECT voided_at FROM gm_contract_drafts WHERE client_id = 'c2'").get();
  ok(!!row && !!row.voided_at, "the voided draft row itself still exists in the table -- no hard delete");
}

{
  // Two different clients' drafts never collide.
  const w = world();
  await w.F.handlePutApexContractDraft("c3", rq({ data: { company_name: "Gamma" }, version: 0 }), w.env);
  await w.F.handlePutApexContractDraft("c4", rq({ data: { company_name: "Delta" }, version: 0 }), w.env);
  const r3 = await w.F.handleGetApexContractDraft("c3", rq(), w.env);
  const r4 = await w.F.handleGetApexContractDraft("c4", rq(), w.env);
  ok(r3.data.draft.data.company_name === "Gamma" && r4.data.draft.data.company_name === "Delta", "each client's own draft is isolated from the other's");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
