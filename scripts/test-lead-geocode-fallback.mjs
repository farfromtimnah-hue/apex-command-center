// Task 6.1: geocodeAddress's fallback chain (exact -> zip -> town) and
// addr_located being stamped on insert and update. Real Worker functions,
// in-memory D1, stubbed fetch (no live network -- this session has none
// anyway).
//
//   node scripts/test-lead-geocode-fallback.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = [
  "geocodeOneLine", "geocodeAddress", "gmLeadAddressChanged", "gmLeadGeocodeIfNeeded",
  "gmLeadFields", "gmInsertLead", "gmLogLeadEvents",
  "handlePostGmLead", "handlePutGmLead",
  "gmStr", "gmNum", "gmStageKey"
];
const VARS = ["GM_STAGE_DEFS", "GM_STAGES", "GM_ORIGENS", "GM_LEAD_COST_FIELDS", "GM_LEAD_LOGGED_FIELDS"];

const LEAD_MIGRATIONS = [
  "migrations/gm_growth_management.sql",
  "migrations/gm_lead_events.sql",
  "migrations/gm_leads_address.sql",
  "migrations/2026-10-13_lead_structured_address.sql",
  "migrations/2026-10-13_lead_geocode.sql",
  "migrations/2026-10-19_lead_geocode_precision.sql",
  "migrations/gm_leads_costs_commission.sql",
  "migrations/gm_leads_servico_desc_financiamento.sql",
  "migrations/client_estimates_invoices_p2.sql",
  "migrations/customer_referrals.sql",
  "migrations/double_entry_fixes.sql",
  "migrations/gm_lead_contacts.sql",
  "migrations/meta_lead_ads.sql",
  "migrations/three_prices.sql"
];

function world(fetchRouter, reuseDb) {
  const d = reuseDb || makeDb(LEAD_MIGRATIONS);
  if (!reuseDb) {
    // `imposto` is live on gm_leads in production (confirmed via PRAGMA
    // table_info on 2026-10-19) but no migration file in this repo adds it --
    // it was applied as a one-off command, never captured. Added here inline
    // so this fixture matches the real live table; not part of this task.
    try { d.raw.exec("ALTER TABLE gm_leads ADD COLUMN imposto REAL"); } catch (e) {}
    d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'Acme Pools')").run();
  }
  const stubs = Object.assign({}, baseStubs, {
    requireClientAccess: () => true,
    sessionSellerName: () => null,
    sellerCanActOnLead: () => true,
    gmGetConfig: async () => ({}),
    gmOwnedRow: async (env, table, id) => d.raw.prepare("SELECT * FROM " + table + " WHERE id = ?").get(id) || null,
    // A real (simplified) stand-in, not a no-op: this test never touches
    // valor/cost fields, only address ones, which always land in extraSets --
    // a no-op stub here would silently throw away the real UPDATE statement
    // and every PUT would look like a no-op write.
    gmValueWriteStmts: (env, spec) => {
      var sets = (spec.fields || []).map(function(f) { return f.col + " = (" + f.expr + ")"; }).concat(spec.extraSets || []);
      if (!sets.length) { return []; }
      var binds = [];
      (spec.fields || []).forEach(function(f) { binds = binds.concat(f.binds || []); });
      binds = binds.concat(spec.extraBinds || [], spec.whereBinds);
      var up = env.DB.prepare("UPDATE " + spec.table + " SET " + sets.concat(["updated_at = datetime('now')"]).join(", ") + " WHERE " + spec.where);
      return [up.bind.apply(up, binds)];
    },
    gmGuardedValorExpr: (t, p) => p,
    gmGuardedFinalCentsExpr: (t, p) => p,
    fetch: fetchRouter
  });
  const F = build(FNS, VARS, stubs);
  return { d, F, env: { DB: d.DB } };
}

// A fake Census one-line responder: matches only an EXACT line (the chain
// sends a different, shorter line at each step -- full address, bare zip,
// city+state -- so exact equality is what actually isolates one step).
function censusRouter(matchLine, coords) {
  return async (url) => {
    const addr = decodeURIComponent(String(url).split("address=")[1].split("&")[0]);
    if (addr === matchLine) {
      return { ok: true, json: async () => ({ result: { addressMatches: [{ coordinates: { x: coords[1], y: coords[0] } }] } }) };
    }
    return { ok: true, json: async () => ({ result: { addressMatches: [] } }) };
  };
}

// ── 1. Exact match on the first try ─────────────────────────────────────────
{
  const w = world(censusRouter("123 Main St, Tampa, FL, 33601", [27.9, -82.4]));
  const geo = await w.F.geocodeAddress({ street: "123 Main St", city: "Tampa", state: "FL", zip: "33601" });
  ok(geo.located === "exact" && geo.lat === 27.9 && geo.lon === -82.4, "full street address matches -> located: exact");
}

// ── 2. Street fails, ZIP succeeds ───────────────────────────────────────────
{
  const w = world(censusRouter("33601", [28.0, -82.5]));
  const geo = await w.F.geocodeAddress({ street: "999 Nowhere Ln", city: "Tampa", state: "FL", zip: "33601" });
  // The full-line request ("999 Nowhere Ln, Tampa, FL, 33601") never equals
  // the bare zip "33601", so it correctly fails -- only the zip-only request
  // that follows matches.
  ok(geo.located === "zip" && geo.lat === 28.0, "street match fails, bare ZIP matches -> located: zip");
}

// ── 3. Street and ZIP both fail, town succeeds ──────────────────────────────
{
  const w = world(censusRouter("Tampa, FL", [28.1, -82.6]));
  const geo = await w.F.geocodeAddress({ street: "999 Nowhere Ln", city: "Tampa", state: "FL", zip: "00000" });
  // Neither the full line nor the bare zip "00000" equals "Tampa, FL", so
  // both earlier steps correctly fail before the town step matches.
  ok(geo.located === "town" && geo.lat === 28.1, "street and ZIP fail, city+state matches -> located: town");
}

// ── 4. Nothing matches anywhere -> null, never throws ───────────────────────
{
  const w = world(async () => ({ ok: true, json: async () => ({ result: { addressMatches: [] } }) }));
  const geo = await w.F.geocodeAddress({ street: "1 Nowhere", city: "Nowhere", state: "ZZ", zip: "99999" });
  ok(geo.lat === null && geo.lon === null && geo.located === null, "no match at any step -> all null, located null");
}

// ── 5. A fetch() that throws is swallowed, not propagated ───────────────────
{
  const w = world(async () => { throw new Error("network down"); });
  const geo = await w.F.geocodeAddress({ street: "1 Main St", city: "Tampa", state: "FL", zip: "33601" });
  ok(geo.lat === null && geo.located === null, "fetch throwing is swallowed at every step, never bubbles up");
}

// ── 6. No address fields at all -> never calls fetch ────────────────────────
{
  let called = false;
  const w = world(async () => { called = true; return { ok: true, json: async () => ({ result: { addressMatches: [] } }) }; });
  const geo = await w.F.geocodeAddress({});
  ok(!called && geo.lat === null, "empty address never calls the geocoder");
}

// ── 7. End to end: creating a lead with a full address stamps addr_located ──
{
  const w = world(censusRouter("5 Palm Ave, Naples, FL, 34102", [26.0, -81.0]));
  const r = await w.F.handlePostGmLead("c1", { json: async () => ({ cliente: "Test Lead", addr_street: "5 Palm Ave", addr_city: "Naples", addr_state: "FL", addr_zip: "34102" }) }, w.env);
  ok(r.status === 200, "lead created with an address");
  ok(r.data.lead.addr_located === "exact", "the created lead's row carries addr_located = exact");
  ok(r.data.lead.addr_lat === 26.0, "and the matched latitude");
}

// ── 8. Editing just the ZIP (structured address changed) re-geocodes and ──
//      re-stamps addr_located on an existing lead, through the PUT path ────
{
  const w = world(censusRouter("5 Palm Ave, Naples, FL, 34102", [26.0, -81.0]));
  const created = await w.F.handlePostGmLead("c1", { json: async () => ({ cliente: "Test Lead 2", addr_street: "5 Palm Ave", addr_city: "Naples", addr_state: "FL", addr_zip: "34102" }) }, w.env);
  const leadId = created.data.lead.id;

  // Change the geocoder's behavior: now ONLY the new zip matches (simulates
  // the street no longer resolving, forcing the zip fallback on update).
  // Same database, reused, so the second build's write lands on the lead
  // just created.
  const w2 = world(censusRouter("34999", [27.0, -80.0]), w.d);
  const r = await w2.F.handlePutGmLead("c1", leadId, { json: async () => ({ addr_zip: "34999" }) }, w2.env);
  ok(r.status === 200, "updating just the ZIP succeeds");
  ok(r.data.lead.addr_located === "zip", "street no longer resolves after the ZIP change, falls back to zip-located");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
