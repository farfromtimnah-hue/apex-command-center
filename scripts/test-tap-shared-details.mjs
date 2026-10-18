// Build 4: fill empty lead fields from details a customer shares at a tap
// (Apple's Tap to Share). The REAL handler cut from worker/index.js against
// an in-memory SQLite. No network, no production database, no iOS code.
//
//   node scripts/test-tap-shared-details.mjs
import { makeDb, build, baseStubs, req } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = [
  "handlePostGmStripeTapSharedDetails", "gmStripeTapActorGuard", "gmTapRoleGate", "requireClientAccess",
  "gmInvLoad", "gmStr", "gmTapShareEmailOk", "gmLogLeadEvents"
];
const VARS = ["GM_TAP_SHARED_FIELD_MAP", "GM_TAP_SHARED_NO_COLUMN"];

function world(authUser) {
  const d = makeDb([]);
  d.raw.exec("CREATE TABLE gm_invoices (id TEXT PRIMARY KEY, client_id TEXT, job_id TEXT, lead_id TEXT, number TEXT, status TEXT)");
  d.raw.exec("CREATE TABLE gm_invoice_items (id TEXT PRIMARY KEY, invoice_id TEXT, sort_order INTEGER DEFAULT 0)");
  d.raw.exec("CREATE TABLE gm_invoice_payments (id TEXT PRIMARY KEY, invoice_id TEXT, recorded_at TEXT DEFAULT (datetime('now')))");
  d.raw.exec("CREATE TABLE gm_invoice_credits (id TEXT PRIMARY KEY, invoice_id TEXT, created_at TEXT DEFAULT (datetime('now')))");
  d.raw.exec("CREATE TABLE gm_leads (id TEXT PRIMARY KEY, client_id TEXT, cliente TEXT NOT NULL, telefone TEXT, email TEXT, addr_street TEXT, addr_city TEXT, addr_state TEXT, addr_zip TEXT)");
  d.raw.exec("CREATE TABLE gm_lead_events (id TEXT PRIMARY KEY, lead_id TEXT, client_id TEXT, action TEXT, field TEXT, old_value TEXT, new_value TEXT, actor TEXT, reason TEXT)");
  const stubs = Object.assign({}, baseStubs, { authenticate: async () => authUser });
  const F = build(FNS, VARS, stubs);
  // TAP_TO_PAY_PUBLIC: "1" -- this file tests the shared-details field-fill
  // logic, not the developer-only gate (Fix 5, 2026-10-18); that gate has its
  // own coverage in scripts/test-tap-gate.mjs.
  return { d, env: { DB: d.DB, TAP_TO_PAY_PUBLIC: "1" }, F };
}

function seedInvoice(d, id, clientId, leadId, status) {
  d.raw.prepare("INSERT INTO gm_invoices (id, client_id, job_id, lead_id, number, status) VALUES (?, ?, 'job1', ?, 'INV-01', ?)").run(id, clientId, leadId || null, status || "sent");
}
function seedLead(d, id, clientId, fields) {
  fields = fields || {};
  d.raw.prepare("INSERT INTO gm_leads (id, client_id, cliente, telefone, email, addr_street, addr_city, addr_state, addr_zip) VALUES (?, ?, 'Customer', ?, ?, ?, ?, ?, ?)")
    .run(id, clientId, fields.telefone || null, fields.email || null, fields.addr_street || null, fields.addr_city || null, fields.addr_state || null, fields.addr_zip || null);
}
function getLead(d, id) { return d.raw.prepare("SELECT * FROM gm_leads WHERE id = ?").get(id); }

const OWNER = { role: "client", client_id: "c1", display_name: "Owner" };

// ── empty lead fills ───────────────────────────────────────────────────
{
  const w = world(OWNER);
  seedInvoice(w.d, "inv1", "c1", "lead1");
  seedLead(w.d, "lead1", "c1", {});
  const r = await w.F.handlePostGmStripeTapSharedDetails("c1", req({ invoice_id: "inv1", details: { email: "customer@example.com", phone: "813-555-0100", address_line1: "123 Oak St", city: "Tampa", state: "FL", postal_code: "33602" } }), w.env);
  ok(r.status === 200, "shared-details call succeeds");
  ok(r.data.saved.sort().join(",") === "address_line1,city,email,phone,postal_code,state".split(",").sort().join(","), "every empty, valid field is saved: " + JSON.stringify(r.data.saved));
  const lead = getLead(w.d, "lead1");
  ok(lead.email === "customer@example.com" && lead.telefone === "813-555-0100" && lead.addr_street === "123 Oak St" && lead.addr_city === "Tampa" && lead.addr_state === "FL" && lead.addr_zip === "33602", "all mapped columns are filled with the shared values");
}

// ── filled field untouched (a different shared value is ignored) ───────
{
  const w = world(OWNER);
  seedInvoice(w.d, "inv2", "c1", "lead2");
  seedLead(w.d, "lead2", "c1", { email: "already@onfile.com" });
  const r = await w.F.handlePostGmStripeTapSharedDetails("c1", req({ invoice_id: "inv2", details: { email: "different@example.com" } }), w.env);
  ok(r.data.saved.indexOf("email") === -1 && r.data.skipped.indexOf("email") !== -1, "a field that already has a value is skipped, not overwritten");
  const lead = getLead(w.d, "lead2");
  ok(lead.email === "already@onfile.com", "the ORIGINAL value survives even though a different value was shared");
}

// ── invoice with no lead ──────────────────────────────────────────────
{
  const w = world(OWNER);
  seedInvoice(w.d, "inv3", "c1", null);
  const r = await w.F.handlePostGmStripeTapSharedDetails("c1", req({ invoice_id: "inv3", details: { email: "x@example.com" } }), w.env);
  ok(r.status === 200 && r.data.saved.length === 0 && r.data.reason === "no lead", "an invoice with no lead_id: nothing saved, reason 'no lead'");
}

// ── invalid email rejected ───────────────────────────────────────────────
{
  const w = world(OWNER);
  seedInvoice(w.d, "inv4", "c1", "lead4");
  seedLead(w.d, "lead4", "c1", {});
  const r = await w.F.handlePostGmStripeTapSharedDetails("c1", req({ invoice_id: "inv4", details: { email: "not-an-email" } }), w.env);
  ok(r.data.saved.indexOf("email") === -1 && r.data.skipped.indexOf("email") !== -1, "an invalid email is skipped, never saved");
  const lead = getLead(w.d, "lead4");
  ok(lead.email === null, "the lead's email column stays NULL after an invalid email is sent");
}

// ── partial details ───────────────────────────────────────────────────────
{
  const w = world(OWNER);
  seedInvoice(w.d, "inv5", "c1", "lead5");
  seedLead(w.d, "lead5", "c1", {});
  const r = await w.F.handlePostGmStripeTapSharedDetails("c1", req({ invoice_id: "inv5", details: { email: "only@example.com" } }), w.env);
  ok(r.data.saved.join(",") === "email", "only the fields actually sent are considered");
  const lead = getLead(w.d, "lead5");
  ok(lead.telefone === null && lead.addr_city === null, "fields never mentioned stay NULL, untouched");
}

// ── fields with no lead column: name, address_line2 ──────────────────────
{
  const w = world(OWNER);
  seedInvoice(w.d, "inv6", "c1", "lead6");
  seedLead(w.d, "lead6", "c1", {});
  const r = await w.F.handlePostGmStripeTapSharedDetails("c1", req({ invoice_id: "inv6", details: { name: "Jane Customer", address_line2: "Apt 4B" } }), w.env);
  ok(r.data.saved.length === 0 && r.data.skipped.sort().join(",") === "address_line2,name", "name and address_line2 have no lead column and are always skipped");
  const lead = getLead(w.d, "lead6");
  ok(lead.cliente === "Customer", "gm_leads.cliente (the identity field) is never touched by this route");
}

// ── a client from another business is refused ───────────────────────────
{
  const w = world({ role: "client", client_id: "c2", display_name: "Other" });
  seedInvoice(w.d, "inv7", "c1", "lead7");
  seedLead(w.d, "lead7", "c1", {});
  const r = await w.F.handlePostGmStripeTapSharedDetails("c1", req({ invoice_id: "inv7", details: { email: "x@example.com" } }), w.env);
  ok(r.status === 403, "a session from a DIFFERENT business is refused before touching the lead");
}
{
  const w = world(null);
  seedInvoice(w.d, "inv7b", "c1", "lead7b");
  const r = await w.F.handlePostGmStripeTapSharedDetails("c1", req({ invoice_id: "inv7b", details: {} }), w.env);
  ok(r.status === 401, "no session: 401 Unauthorized");
}

// ── a repeated request saves nothing new ─────────────────────────────────
{
  const w = world(OWNER);
  seedInvoice(w.d, "inv8", "c1", "lead8");
  seedLead(w.d, "lead8", "c1", {});
  const body = { invoice_id: "inv8", details: { email: "once@example.com", phone: "813-555-0199" } };
  const r1 = await w.F.handlePostGmStripeTapSharedDetails("c1", req(body), w.env);
  ok(r1.data.saved.sort().join(",") === "email,phone", "first request saves both fields");
  const r2 = await w.F.handlePostGmStripeTapSharedDetails("c1", req(body), w.env);
  ok(r2.data.saved.length === 0, "the SAME request repeated saves nothing new (both fields already filled)");
}

// ── history entry written once per saved field ───────────────────────────
{
  const w = world(OWNER);
  seedInvoice(w.d, "inv9", "c1", "lead9");
  seedLead(w.d, "lead9", "c1", {});
  await w.F.handlePostGmStripeTapSharedDetails("c1", req({ invoice_id: "inv9", details: { email: "evt@example.com", phone: "813-555-0188" } }), w.env);
  const events = w.d.raw.prepare("SELECT * FROM gm_lead_events WHERE lead_id = 'lead9'").all();
  ok(events.length === 2, "exactly one lead-event row per field actually saved (2 fields saved -> 2 rows)");
  ok(events.every((e) => e.actor === "Tap to Share" && /shared by customer at Tap to Pay, invoice INV-01/.test(e.reason)), "each event is attributed to 'Tap to Share' with the expected reason text");
  ok(events.every((e) => e.old_value === null), "old_value is always null (the field was empty before the save)");
}

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
