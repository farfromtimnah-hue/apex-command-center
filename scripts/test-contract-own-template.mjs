// Task 5.2: "Meu próprio contrato" -- the PDF-to-clause-area mapping call,
// its retry-once-on-malformed-output rule, the 5-per-day cap, and the
// developer-only review gate. Real Worker functions, in-memory D1, stubbed
// Claude (no live network -- this session has none anyway).
//
//   node scripts/test-contract-own-template.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = [
  "handlePostGmContractOwnTemplate", "handleGetGmContractOwnTemplates", "handlePostGmContractOwnTemplateReviewed",
  "gmContractOwnTemplateAreas", "gmContractOwnTemplateAskClaude", "gmContractOwnTemplateModel",
  "apxAuthStaff", "apxAuthOwnOrStaff", "gmDocSettingsOwnerOnly", "requireClientAccess", "sessionSellerName",
  "isAdminRole", "actorName", "easternDateStr"
];
const VARS = ["GM_CONTRACT_OWN_TEMPLATE_DAILY_CAP"];

function fakePdfBytes() {
  // Not a real PDF -- the test never calls a real Claude API (fetch is
  // stubbed), so the byte content itself is never inspected.
  return new TextEncoder().encode("%PDF-1.4 fake test content, generated for this test only, never a real client's contract");
}

function world() {
  const d = makeDb(["migrations/2026-10-19_gm_contract_own_template.sql"]);
  try {
    d.raw.exec("CREATE TABLE contract_clause_areas (id TEXT NOT NULL, version INTEGER NOT NULL, title TEXT, intro_md TEXT, notes_md TEXT, sort_order INTEGER, PRIMARY KEY (id, version))");
  } catch (e) { /* already exists from a migration file */ }
  ["owners_json", "location_state", "location_city"].forEach((col) => {
    try { d.raw.exec("ALTER TABLE clients ADD COLUMN " + col + " TEXT"); } catch (e) {}
  });
  d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'Acme Pools')").run();
  d.raw.prepare("INSERT OR IGNORE INTO contract_clause_areas (id, version, title, sort_order) VALUES ('C01', 1, 'Scope of Work', 1)").run();
  d.raw.prepare("INSERT OR IGNORE INTO contract_clause_areas (id, version, title, sort_order) VALUES ('C04', 1, 'Payments', 2)").run();
  const state = { user: { role: "rafa" }, claudeReplies: [], claudeCallCount: 0 };
  const taskFiles = { put: async () => {} };
  const stubs = Object.assign({}, baseStubs, {
    // A stub can be any value, not just a function -- CLAUDE_API_URL is
    // declared with aligned extra spaces in the real file, which the
    // fixture's varSrc() (single-space match) cannot extract, and the
    // stubbed fetch below never reads the url argument anyway.
    CLAUDE_API_URL: "https://api.anthropic.com/v1/messages",
    authenticate: async () => state.user,
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status || 400, error: en, error_pt: pt, error_en: en }, extra || {}),
    fetch: async (url, init) => {
      state.claudeCallCount++;
      const reply = state.claudeReplies[state.claudeCallCount - 1] || state.claudeReplies[state.claudeReplies.length - 1];
      return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify(reply) }] }) };
    }
  });
  const F = build(FNS, VARS, stubs);
  return { d, F, env: { DB: d.DB, CLAUDE_API_KEY: "test-key", TASK_FILES: taskFiles }, state };
}

function rqUpload() {
  const file = { name: "my-contract.pdf", type: "application/pdf", size: 1000, arrayBuffer: async () => fakePdfBytes().buffer };
  return {
    url: "https://x.test/", headers: { get: () => null },
    formData: async () => ({ get: (k) => (k === "file" ? file : null) })
  };
}
function rq() { return { url: "https://x.test/", headers: { get: () => null }, json: async () => ({}) }; }

// ── 1. A well-formed reply on the first try ─────────────────────────────────
{
  const w = world();
  w.state.claudeReplies = [{
    page_count: 5,
    areas: [{ key: "C01", excerpt: "The contractor shall perform the following work..." }, { key: "C04", excerpt: null }],
    unmatched: ["A clause about pets on the job site"]
  }];
  const r = await w.F.handlePostGmContractOwnTemplate("c1", rqUpload(), w.env);
  ok(r.status === 200, "upload + mapping succeeds");
  ok(r.data.mapping.areas.length === 2, "both areas from contract_clause_areas are present in the mapping");
  ok(r.data.mapping.areas[0].name === "Scope of Work" && r.data.mapping.areas[0].excerpt, "C01 got its real name and excerpt");
  ok(r.data.mapping.areas[1].excerpt === null, "C04 correctly reports 'not found' (null excerpt)");
  ok(r.data.mapping.unmatched.length === 1, "the unmatched clause is carried through");
  ok(w.state.claudeCallCount === 1, "only ONE Claude call for a well-formed first reply");
  ok(r.data.status === "pending_review", "a fresh upload is pending_review");

  const list = await w.F.handleGetGmContractOwnTemplates("c1", rq(), w.env);
  ok(list.status === 200 && list.data.templates.length === 1, "the upload shows up in the client's own list");
}

// ── 2. Malformed first reply (missing an area key) retries ONCE, then succeeds ──
{
  const w = world();
  w.state.claudeReplies = [
    { page_count: 5, areas: [{ key: "C01", excerpt: "text" }], unmatched: [] }, // missing C04 -- malformed
    { page_count: 5, areas: [{ key: "C01", excerpt: "text" }, { key: "C04", excerpt: null }], unmatched: [] }
  ];
  const r = await w.F.handlePostGmContractOwnTemplate("c1", rqUpload(), w.env);
  ok(r.status === 200, "a malformed first reply recovers on the retry");
  ok(w.state.claudeCallCount === 2, "exactly ONE retry happened (two total calls)");
}

// ── 3. Two malformed replies in a row: fails cleanly, saves nothing ─────────
{
  const w = world();
  w.state.claudeReplies = [{ page_count: 5, areas: [{ key: "C01", excerpt: "text" }], unmatched: [] }]; // always missing C04
  const r = await w.F.handlePostGmContractOwnTemplate("c1", rqUpload(), w.env);
  ok(r.status === 502, "two malformed replies in a row fail with a clear error, never a half-parsed save");
  ok(w.state.claudeCallCount === 2, "exactly two attempts were made, never more");
  const list = await w.F.handleGetGmContractOwnTemplates("c1", rq(), w.env);
  ok(list.data.templates.length === 0, "nothing was saved for the failed upload");
}

// ── 4. The 5-per-day cap ─────────────────────────────────────────────────────
{
  const w = world();
  w.state.claudeReplies = [{ page_count: 1, areas: [{ key: "C01", excerpt: "x" }, { key: "C04", excerpt: "y" }], unmatched: [] }];
  for (let i = 0; i < 5; i++) {
    const r = await w.F.handlePostGmContractOwnTemplate("c1", rqUpload(), w.env);
    if (r.status !== 200) { ok(false, "upload " + (i + 1) + " of 5 should succeed (it did not)"); }
  }
  const r6 = await w.F.handlePostGmContractOwnTemplate("c1", rqUpload(), w.env);
  ok(r6.status === 429, "the 6th upload in the same day is refused by the 5-per-day cap");
}

// ── 5. Review gate: developer only, both directions ─────────────────────────
{
  const w = world();
  w.state.claudeReplies = [{ page_count: 1, areas: [{ key: "C01", excerpt: "x" }, { key: "C04", excerpt: "y" }], unmatched: [] }];
  const up = await w.F.handlePostGmContractOwnTemplate("c1", rqUpload(), w.env);
  const tid = up.data.id;

  w.state.user = { role: "rafa" };
  const r1 = await w.F.handlePostGmContractOwnTemplateReviewed("c1", tid, rq(), w.env);
  ok(r1.status === 403, "rafa (admin but not developer) cannot mark it reviewed");

  w.state.user = { role: "developer" };
  const r2 = await w.F.handlePostGmContractOwnTemplateReviewed("c1", tid, rq(), w.env);
  ok(r2.status === 200, "developer CAN mark it reviewed");

  const r3 = await w.F.handlePostGmContractOwnTemplateReviewed("c1", tid, rq(), w.env);
  ok(r3.status === 404, "marking an already-reviewed template again is refused, not a silent no-op success");
}

// ── 6. The OWNER uploads their own contract (client session), never another client or a seller ──
{
  const w = world();
  w.state.claudeReplies = [{ page_count: 2, areas: [{ key: "C01", excerpt: "x" }, { key: "C04", excerpt: "y" }], unmatched: [] }];

  w.state.user = { role: "client", client_id: "c1" };
  const own = await w.F.handlePostGmContractOwnTemplate("c1", rqUpload(), w.env);
  ok(own.status === 200, "the owner of c1 can upload their own contract");
  const ownList = await w.F.handleGetGmContractOwnTemplates("c1", rq(), w.env);
  ok(ownList.status === 200 && ownList.data.templates.length === 1, "the owner of c1 sees their own upload list");

  w.state.user = { role: "client", client_id: "c2" };
  const other = await w.F.handlePostGmContractOwnTemplate("c1", rqUpload(), w.env);
  ok(other.status === 403, "the owner of ANOTHER client cannot upload to c1");
  const otherList = await w.F.handleGetGmContractOwnTemplates("c1", rq(), w.env);
  ok(otherList.status === 403, "the owner of ANOTHER client cannot read c1's list");

  w.state.user = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Pat" };
  const seller = await w.F.handlePostGmContractOwnTemplate("c1", rqUpload(), w.env);
  ok(seller.status === 403, "a salesperson login of c1 cannot upload");

  w.state.user = { role: "client", client_id: "c1" };
  const rev = await w.F.handlePostGmContractOwnTemplateReviewed("c1", ownList.data.templates[0].id, rq(), w.env);
  ok(rev.status === 403, "the owner cannot mark their own upload reviewed (developer only)");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
