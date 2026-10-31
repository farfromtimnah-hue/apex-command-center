// Task 6.1: geocodeAddress's fallback chain (exact -> zip -> town) and
// addr_located being stamped on insert and update. Real Worker functions,
// in-memory D1, stubbed fetch (no live network -- this session has none
// anyway).
//
//   node scripts/test-lead-geocode-fallback.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

const ZIP_CENTERS_V1 = JSON.parse(readFileSync(new URL("../data/geo/zip-centers-v1.json", import.meta.url), "utf8"));
const TOWN_CENTERS_V1 = JSON.parse(readFileSync(new URL("../data/geo/town-centers-v1.json", import.meta.url), "utf8"));

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = [
  "geocodeOneLine", "geocodeAddress", "geoZip5", "geoState2", "geoCityClean", "geoLoadCenters", "geoFetchJson", "geoPlacesCenter", "geoZipCenter", "geoTownCenter", "gmLeadAddressChanged", "gmLeadGeocodeIfNeeded",
  "gmLeadFields", "gmInsertLead", "gmLogLeadEvents",
  "tzIsValid", "tzParts", "tzPad2", "tzLocalNowStamp", "tzZoneForState", "resolveRequestZone",
  "handlePostGmLead", "handlePutGmLead",
  "gmStr", "gmNum", "gmStageKey"
];
const VARS = ["GEO_FETCH_TIMEOUT_MS", "GEO_ZIP_MAP", "GEO_TOWN_MAP", "TZ_STATE_ZONES", "TZ_STATE_NAMES", "GM_STAGE_DEFS", "GM_STAGES", "GM_ORIGENS", "GM_LEAD_COST_FIELDS", "GM_LEAD_LOGGED_FIELDS"];

const LEAD_MIGRATIONS = [
  "migrations/2026-10-14_client_owners_state_city.sql",   // clients.location_state, read for the viewer zone
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
    fetch: fetchRouter,
    ZIP_CENTERS_V1, TOWN_CENTERS_V1
  });
  const F = build(FNS, VARS, stubs);
  return { d, F, env: { DB: d.DB } };
}

// A fake Census one-line responder: matches only an EXACT line (the chain
// sends a different, shorter line at each step -- full address, bare zip,
// city+state -- so exact equality is what actually isolates one step).
function censusRouter(matchLine, coords, zippoAnswer) {
  return async (url) => {
    if (String(url).indexOf("api.zippopotam.us") >= 0) {
      return zippoAnswer ? { ok: true, json: async () => zippoAnswer } : { ok: false, status: 404, json: async () => ({}) };
    }
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
  // The Census one-line geocoder never answers a bare ZIP (tested 10/31/2026),
  // so the router matches nothing; the ZIP center comes from the bundled file.
  const w = world(censusRouter("no line matches", [0, 0]));
  const geo = await w.F.geocodeAddress({ street: "999 Nowhere Ln", city: "Tampa", state: "FL", zip: "33647" });
  ok(geo.located === "zip" && Math.abs(geo.lat - 28.15) < 0.1 && Math.abs(geo.lon + 82.32) < 0.1, "street match fails, ZIP center from the bundled file -> located: zip");
}

// ── 3. Street and ZIP both fail, town succeeds ──────────────────────────────
{
  // ZIP 00000 is in neither source (the fake zippopotam answer is a 404), so
  // the town center from the bundled file is used.
  const w = world(censusRouter("no line matches", [0, 0]));
  const geo = await w.F.geocodeAddress({ street: "999 Nowhere Ln", city: "Tampa", state: "FL", zip: "00000" });
  ok(geo.located === "town" && Math.abs(geo.lat - 27.97) < 0.1, "street and ZIP fail, city+state center from the bundled file -> located: town");
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
  const geo = await w.F.geocodeAddress({ street: "1 Main St", city: "Zzyzxville", state: "FL", zip: "34999" });
  ok(geo.lat === null && geo.located === null, "fetch throwing is swallowed at every step, never bubbles up");
  // With the network down, a ZIP that is in the bundled file still resolves.
  const geo2 = await w.F.geocodeAddress({ street: "1 Main St", city: "Tampa", state: "FL", zip: "33647" });
  ok(geo2.located === "zip", "network down: a ZIP in the bundled file still gets its center");
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
  // ZIP 34999 is not in the bundled file, so the second source answers it.
  const w2 = world(censusRouter("no line matches", [0, 0], { places: [{ latitude: "27.0", longitude: "-80.0" }] }), w.d);
  const r = await w2.F.handlePutGmLead("c1", leadId, { json: async () => ({ addr_zip: "34999" }) }, w2.env);
  ok(r.status === 200, "updating just the ZIP succeeds");
  ok(r.data.lead.addr_located === "zip", "street no longer resolves after the ZIP change, falls back to zip-located");
}

// ── 9. A geocoder that fails everywhere never blocks the save, and the ─────
//      lookup itself writes nothing ────────────────────────────────────────
{
  const w = world(async () => { throw new Error("network down"); });
  const before = w.d.writes.length;
  const geo = await w.F.geocodeAddress({ street: "1 Main St", city: "Zzyzxville", state: "FL", zip: "34999" });
  ok(geo.located === null && w.d.writes.length === before, "geocoder failure returns null and the lookup writes nothing to the database");
  const r = await w.F.handlePostGmLead("c1", { json: async () => ({ cliente: "Geocoder Down", addr_street: "1 Main St", addr_city: "Zzyzxville", addr_state: "FL", addr_zip: "34999" }) }, w.env);
  ok(r.status === 200 && r.data.lead.addr_lat === null && r.data.lead.addr_located === null, "lead saves with no coordinates when every geocoder step fails");
}

// ── 10. The bug this build fixes: new construction in Wesley Chapel (street ─
//       unknown to the Census geocoder) now gets a ZIP-center pin ──────────
{
  const w = world(censusRouter("no line matches", [0, 0]));
  const r = await w.F.handlePostGmLead("c1", { json: async () => ({ cliente: "New Build", addr_street: "7 Invented Run", addr_city: "Wesley Chapel", addr_state: "FL", addr_zip: "33543" }) }, w.env);
  ok(r.status === 200 && r.data.lead.addr_located === "zip" && typeof r.data.lead.addr_lat === "number", "unmatched street in a real ZIP saves with addr_located = zip and coordinates");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
