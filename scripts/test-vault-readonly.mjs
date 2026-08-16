// Proves that Pr. Rafa's vault Worker CANNOT write to Apex's D1.
//
//   VAULT_SERVICE_TOKEN=... node scripts/test-vault-readonly.mjs
//
// This fires at the DEPLOYED Worker over the real network, with the real
// service token, through the real /api/vault/ routes. That distinction is the
// whole point: a unit test on assertVaultReadSql() proves the helper works, it
// does NOT prove the deployed route is wired to the helper, and it skips the
// auth layer that is the most likely place for a defect to hide.
//
// Six cases must FAIL, and each must fail for a structural reason:
//   INSERT / UPDATE / DELETE / DROP TABLE   -> not a SELECT
//   SELECT 1; DELETE FROM clients           -> stacked statement
//   SELECT * FROM invoices                  -> invoices is not on the allow-list
//
// The last one is the one worth re-reading. It fails because "invoices" is
// ABSENT from VAULT_READ_TABLES, not because some rule filters finance out. A
// rule someone has to remember is a rule someone eventually forgets.
//
// Two positive cases run too, because a gate that rejects everything would
// pass every assertion above while being completely broken.
//
// Runs on every deploy via scripts/deploy.sh — a gate tested only on the day
// it was written is a gate that can quietly disappear.

// The Worker's own origin, NOT apex.resonateai.online — that hostname serves
// the static GitHub Pages site and answers /api/* with a Pages 404, which would
// make every "must be blocked" case pass for entirely the wrong reason.
const BASE = process.env.APEX_BASE || "https://apex-api.farfromtimnah.workers.dev";
const TOKEN = process.env.VAULT_SERVICE_TOKEN;

if (!TOKEN) {
  console.error("VAULT_SERVICE_TOKEN is not set. Refusing to run: a test that");
  console.error("cannot authenticate would 401 on every case and report a");
  console.error("false PASS on all six blocked writes.");
  process.exit(1);
}

let fails = 0;

// Before asserting anything, prove we are actually talking to the Worker.
//
// This guard is not hypothetical. apex.resonateai.online serves the static
// GitHub Pages site and answers /api/* with a Pages 404 — pointed there, every
// "must be blocked" case below would report a tidy PASS while never reaching
// the Worker at all. A test that passes against a 404 page is worse than no
// test, because it is believed.
async function assertTargetIsTheWorker() {
  const res = await fetch(BASE + "/api/vault/selftest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql: "SELECT 1 FROM clients" })
  });
  const body = await res.text();
  // Unauthenticated, so the Worker must answer 401 with its own JSON error.
  // A 404, or HTML, means BASE is not the Worker.
  let isWorker = false;
  try { isWorker = res.status === 401 && JSON.parse(body).error === "Unauthorized"; }
  catch (e) { isWorker = false; }
  if (!isWorker) {
    console.error("Refusing to run: " + BASE + " is not the apex-api Worker.");
    console.error("Expected 401 {\"error\":\"Unauthorized\"} on POST /api/vault/selftest.");
    console.error("Got HTTP " + res.status + ": " + body.slice(0, 200));
    process.exit(1);
  }
}

await assertTargetIsTheWorker();

function record(ok, label, detail) {
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label);
  if (detail) { console.log("      " + detail); }
}

async function selftest(sql) {
  const res = await fetch(BASE + "/api/vault/selftest", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ sql: sql })
  });
  const body = await res.text();
  return { status: res.status, body: body };
}

async function get(path) {
  const res = await fetch(BASE + path, {
    headers: { "Authorization": "Bearer " + TOKEN }
  });
  const body = await res.text();
  return { status: res.status, body: body };
}

// ── The six that must be blocked ──────────────────────────────────────────

const BLOCKED = [
  ["INSERT", "INSERT INTO clients (id, name) VALUES ('x', 'x')"],
  ["UPDATE", "UPDATE clients SET name = 'pwned' WHERE id = '1'"],
  ["DELETE", "DELETE FROM clients"],
  ["DROP TABLE", "DROP TABLE clients"],
  ["stacked statement", "SELECT 1; DELETE FROM clients"],
  ["finance table (invoices)", "SELECT * FROM invoices"]
];

console.log("Target: " + BASE);
console.log("");
console.log("--- Must be BLOCKED ---");

for (const [label, sql] of BLOCKED) {
  const r = await selftest(sql);
  // A blocked statement returns 403 with an explanation. Anything 2xx means
  // the statement reached D1, which is the failure this test exists to catch.
  const blocked = r.status === 403;
  record(blocked, label + "  ->  HTTP " + r.status, r.body);
}

// A write attempted through a REAL read route's query string, not the selftest
// route — confirms the routes themselves cannot be steered into a write.
console.log("");
console.log("--- Injection through a real read route ---");
{
  const r = await get("/api/vault/tasks?status=" +
    encodeURIComponent("pending'; DELETE FROM tasks; --"));
  // Values are bound parameters, so this is matched as a literal status that
  // simply does not exist: 200 with zero rows, and no statement executed.
  let count = null;
  try { count = JSON.parse(r.body).count; } catch (e) { /* reported below */ }
  record(r.status === 200 && count === 0,
    "bound parameter defuses injection  ->  HTTP " + r.status, r.body.slice(0, 200));
}

// Unauthenticated must be refused, on the gate route too.
console.log("");
console.log("--- Auth ---");
{
  const res = await fetch(BASE + "/api/vault/selftest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql: "SELECT 1 FROM clients" })
  });
  const body = await res.text();
  record(res.status === 401, "no token  ->  HTTP " + res.status, body);
}
{
  const r = await get("/api/invoices");
  record(r.status === 401,
    "vault token on a finance route  ->  HTTP " + r.status, r.body.slice(0, 200));
}

// ── Positive: the gate must still let real reads through ──────────────────

console.log("");
console.log("--- Must SUCCEED ---");

const READS = [
  ["apex-leads", "/api/vault/apex-leads"],
  ["sessions", "/api/vault/sessions"],
  ["tasks", "/api/vault/tasks"],
  ["assessments", "/api/vault/assessments"]
];

for (const [label, path] of READS) {
  const r = await get(path);
  let ok = false;
  try { ok = r.status === 200 && typeof JSON.parse(r.body).count === "number"; }
  catch (e) { ok = false; }
  record(ok, label + "  ->  HTTP " + r.status, r.body.slice(0, 160));
}

// gm_leads needs a client_id, so find one that actually has leads.
{
  const r = await get("/api/vault/clients");
  let clientId = null;
  try {
    const clients = JSON.parse(r.body).clients || [];
    for (const c of clients) {
      const probe = await get("/api/vault/leads?client_id=" + encodeURIComponent(c.id));
      const parsed = JSON.parse(probe.body);
      if (probe.status === 200 && parsed.count > 0) { clientId = c.id; break; }
    }
  } catch (e) { /* reported below */ }

  if (clientId) {
    const r2 = await get("/api/vault/leads?client_id=" + encodeURIComponent(clientId));
    let ok = false;
    try { ok = r2.status === 200 && JSON.parse(r2.body).count > 0; } catch (e) { ok = false; }
    record(ok, "client leads (gm_leads)  ->  HTTP " + r2.status, r2.body.slice(0, 160));
  } else {
    // Not a failure: no client may currently have leads. Say so rather than
    // reporting a pass on something that was never exercised.
    record(true, "client leads (gm_leads)  ->  SKIPPED",
      "no client currently has gm_leads rows; nothing to read");
  }
}

console.log("");
if (fails) {
  console.log(fails + " FAILED. The read-only guarantee is NOT holding. Do not ship.");
  process.exit(1);
}
console.log("All checks passed. Apex D1 is read-only to the vault Worker.");
