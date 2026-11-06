// A project's own address: validation, geocode only when a field changed, the
// weather location (the project's own coordinates first, its lead's second),
// and the read only count. Real Worker functions and real SQL on an in-memory
// SQLite built from the live schema plus migrations/2026-11-05_job_address.sql.
//
//   node scripts/test-job-address.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, workerSrc } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const live = readFileSync(new URL("./fixtures/live-schema-2026-10-30.sql", import.meta.url), "utf8");
const tableSql = (name) => { const m = new RegExp("CREATE TABLE " + name + " \\([\\s\\S]*?\\n\\);").exec(live); if (!m) { throw new Error("table not in live schema: " + name); } return m[0]; };
function dbWithProjects() {
  const d = makeDb();
  d.raw.exec("PRAGMA foreign_keys = OFF"); d.raw.exec(tableSql("gm_jobs")); d.raw.exec(tableSql("gm_leads"));
  readFileSync(new URL("../migrations/2026-11-05_job_address.sql", import.meta.url), "utf8").replace(/^\s*--[^\n]*$/gm, "").split(";").forEach((s) => { if (s.trim()) { d.raw.exec(s); } });
  return d;
}

// ── 1. Input checks on the project address (gmJobFields) ─────────────────
{
  const F = build(["gmJobFields", "gmStr", "gmNum", "gmManualPosition"], ["GM_JOB_STATUSES"], baseStubs);
  const good = F.gmJobFields({ addr_street: "1217 Apollo Beach Blvd", addr_city: "Apollo Beach", addr_state: "fl", addr_zip: "33572" }, true);
  ok(!good.error && good.fields.addr_street === "1217 Apollo Beach Blvd" && good.fields.addr_city === "Apollo Beach" && good.fields.addr_state === "FL" && good.fields.addr_zip === "33572", "a good address is accepted, the state upper-cased");
  const empty = F.gmJobFields({ addr_street: "", addr_city: null, addr_state: "", addr_zip: "" }, true);
  ok(!empty.error && empty.fields.addr_street === null && empty.fields.addr_zip === null && empty.fields.addr_state === null, "empty values clear the field (null)");
  const bads = [
    ["state with three letters", { addr_state: "FLA" }], ["state with a digit", { addr_state: "F1" }], ["state one letter", { addr_state: "F" }],
    ["ZIP with four digits", { addr_zip: "3357" }], ["ZIP with letters", { addr_zip: "33a72" }], ["ZIP+4", { addr_zip: "33572-1234" }], ["ZIP six digits", { addr_zip: "335721" }],
    ["street too long", { addr_street: "x".repeat(201) }], ["city too long", { addr_city: "y".repeat(101) }],
    ["street a number", { addr_street: 12 }], ["city an object", { addr_city: { a: 1 } }], ["state an array", { addr_state: ["FL"] }], ["zip a number", { addr_zip: 33572 }]
  ];
  for (const [label, body] of bads) {
    const r = F.gmJobFields(body, true);
    ok(typeof r.error === "string" && r.error.length > 0 && !r.fields, "refused (not repaired): " + label);
  }
  const sneaky = F.gmJobFields({ addr_street: "1 A St", addr_lat: 10, addr_lon: 20, addr_located: "exact" }, true);
  ok(!sneaky.error && sneaky.fields.addr_lat === undefined && sneaky.fields.addr_lon === undefined && sneaky.fields.addr_located === undefined, "coordinates and located sent by the browser are ignored");
  const plain = F.gmJobFields({ valor: 10 }, true);
  ok(!plain.error && plain.fields.addr_street === undefined && plain.fields.addr_state === undefined, "a save with no address fields touches no address field");
  const create = F.gmJobFields({ obra: "Test", addr_zip: "33647" }, false);
  ok(!create.error && create.fields.addr_zip === "33647", "create also accepts the address");
}

// ── 2. The PUT route: geocode only when a field actually changed ─────────
async function putWorld(existing) {
  let geoCalls = 0, seen = null;
  const captured = [];
  const stubs = Object.assign({}, baseStubs, {
    requireClientAccess: () => true,
    gmOwnedRow: async () => existing,
    geocodeAddress: async (p) => { geoCalls++; seen = p; return { lat: 27.78, lon: -82.42, located: "county", seen: p }; },
    gmValueWriteStmts: (env, o) => { captured.push(o); return []; },
    gmGuardedValorExpr: () => "?", gmGuardedFinalCentsExpr: () => "?",
    jsonOk: baseStubs.jsonOk, jsonErr: baseStubs.jsonErr,
    sessionSellerName: () => null
  });
  const F = build(["handlePutGmJob", "gmJobFields", "gmStr", "gmNum", "gmManualPosition", "gmLeadAddressChanged", "gmLeadGeocodeIfNeeded"], ["GM_JOB_STATUSES"], stubs);
  const env = { DB: { batch: async () => [], prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } };
  return { F, env, captured, geo: () => geoCalls, get seen() { return seen; } };
}
{
  const existing = { id: "j1", client_id: "c1", obra: "Test", lead_id: null, status: "Em andamento", addr_street: "1217 Apollo Beach Blvd", addr_city: "Apollo Beach", addr_state: "FL", addr_zip: "33572", addr_lat: 1, addr_lon: 2, addr_located: "zip" };
  const req = (b) => ({ url: "https://x.test/", headers: { get: () => null }, json: async () => b });

  let w = await putWorld(existing);
  let r = await w.F.handlePutGmJob("c1", "j1", req({ addr_street: "1217 Apollo Beach Blvd" }), w.env);
  ok(r.status === 200 && w.geo() === 0, "the same street sent again: NO geocode call");
  w = await putWorld(existing);
  r = await w.F.handlePutGmJob("c1", "j1", req({ valor: 5000 }), w.env);
  ok(r.status === 200 && w.geo() === 0, "a money edit with no address fields: NO geocode call");
  w = await putWorld(existing);
  r = await w.F.handlePutGmJob("c1", "j1", req({ addr_street: "1300 New Street" }), w.env);
  const sets = w.captured[0] ? w.captured[0].extraSets.join(",") : "";
  const binds = w.captured[0] ? w.captured[0].extraBinds : [];
  ok(r.status === 200 && w.geo() === 1, "a changed street: exactly one geocode call");
  ok(/addr_lat/.test(sets) && /addr_lon/.test(sets) && /addr_located/.test(sets) && binds.indexOf(27.78) >= 0 && binds.indexOf("county") >= 0, "the coordinates and located 'county' are saved with the address");
  w = await putWorld(existing);
  await w.F.handlePutGmJob("c1", "j1", req({ addr_zip: "33647" }), w.env);
  ok(w.geo() === 1, "a changed ZIP: one geocode call");
  ok(w.seen && w.seen.street === "1217 Apollo Beach Blvd" && w.seen.city === "Apollo Beach" && w.seen.state === "FL" && w.seen.zip === "33647", "geocode input: the new ZIP with the unchanged fields from the saved row");
  w = await putWorld(existing);
  r = await w.F.handlePutGmJob("c1", "j1", req({ addr_state: "Florida" }), w.env);
  ok(r.status === 400 && w.geo() === 0 && w.captured.length === 0, "bad state: 400, no geocode, nothing written");
  ok(typeof r.error === "string" && !/Florida|stack|at /.test(r.error), "the 400 message is generic");
  w = await putWorld(existing);
  r = await w.F.handlePutGmJob("c1", "j1", req({ addr_zip: "12" }), w.env);
  ok(r.status === 400 && w.geo() === 0, "bad ZIP: 400, no geocode");
  w = await putWorld(existing);
  r = await w.F.handlePutGmJob("c1", "j1", req({ addr_street: "", addr_city: "", addr_state: "", addr_zip: "" }), w.env);
  ok(r.status === 200 && w.geo() === 1 && w.captured[0].extraBinds.some((b) => b === null), "clearing the whole address geocodes once and saves empty values");
}
{
  // The source: the PUT and POST routes use the same lead helpers, and POST saves the address columns.
  const i = workerSrc.indexOf("\nasync function handlePostGmJob(");
  const post = workerSrc.slice(i, workerSrc.indexOf("\n}", i));
  ok(/addr_street/.test(post) && /addr_located/.test(post) && /gmLeadGeocodeIfNeeded\(f, null\)/.test(post), "creating a project saves and geocodes the address too");
}

// ── 3. Weather location: the project's own coordinates first, the lead's second ──
{
  let leadAsked = 0, used = null;
  const lead = { addr_lat: 28.5, addr_lon: -82.5, addr_located: "zip" };
  const mk = (job) => build(["handleGetGmJobWeather", "gmLocationApprox", "gmWeatherZone", "gmWeatherRequestZone", "resolveRequestZone", "clientZoneFor", "tzZoneForState", "tzIsValid"], ["TZ_STATE_ZONES", "TZ_STATE_NAMES"], Object.assign({}, baseStubs, {
    APEX_TIMEZONE: "America/New_York",
    requireClientAccess: () => true,
    gmOwnedRow: async () => job,
    getHourlyForecast: async (lat, lon) => { used = [lat, lon]; return { today: [], today_rain_window: null }; },
    gmWeatherVerdict: () => ({ rain: false })
  }));
  const env = { DB: { prepare: (sql) => ({ bind: () => ({ first: async () => { if (/FROM gm_leads/.test(sql)) { leadAsked++; return lead; } return null; } }) }) } };
  const rq = { url: "https://x.test/api/clients/c1/gm/jobs/j1/weather" };

  let F = mk({ id: "j1", lead_id: "l1", addr_lat: 27.78, addr_lon: -82.42, addr_located: "county" });
  let r = await F.handleGetGmJobWeather("c1", "j1", rq, env);
  ok(r.data.available && used[0] === 27.78 && used[1] === -82.42 && leadAsked === 0, "own coordinates win; the lead is not even read");
  ok(r.data.approx_location === false, "a county point is not approximate");

  used = null; leadAsked = 0;
  F = mk({ id: "j1", lead_id: "l1", addr_lat: 27.9, addr_lon: -82.3, addr_located: "zip" });
  r = await F.handleGetGmJobWeather("c1", "j1", rq, env);
  ok(used[0] === 27.9 && r.data.approx_location === true, "own ZIP point is used and flagged approximate");

  used = null; leadAsked = 0;
  F = mk({ id: "j1", lead_id: "l1", addr_lat: null, addr_lon: null, addr_located: null });
  r = await F.handleGetGmJobWeather("c1", "j1", rq, env);
  ok(r.data.available && used[0] === 28.5 && used[1] === -82.5 && leadAsked === 1 && r.data.approx_location === true, "no own coordinates: the lead's are used (and its flag)");

  used = null; leadAsked = 0;
  F = mk({ id: "j1", lead_id: "l1" });
  r = await F.handleGetGmJobWeather("c1", "j1", rq, env);
  ok(used && used[0] === 28.5, "a row without the new columns at all still falls back to the lead");

  used = null; leadAsked = 0;
  F = mk({ id: "j1", lead_id: null, addr_lat: null, addr_lon: null });
  r = await F.handleGetGmJobWeather("c1", "j1", rq, env);
  ok(r.data.available === false && used === null, "no own coordinates and no lead: nothing available, as before");

  used = null;
  F = mk({ id: "j1", lead_id: null, addr_lat: 27.7, addr_lon: -82.4, addr_located: "exact" });
  r = await F.handleGetGmJobWeather("c1", "j1", rq, env);
  ok(r.data.available && used[0] === 27.7, "a project with its own address and no lead works");
}

// ── 4. Rain by site (calendar bands) and the project list ────────────────
{
  const d = dbWithProjects();
  d.raw.exec("INSERT INTO gm_leads (id, client_id, cliente, addr_lat, addr_lon, addr_located) VALUES ('l1','c1','Lead One', 28.5, -82.5, 'zip')");
  d.raw.exec("INSERT INTO gm_jobs (id, client_id, obra, lead_id, status, inicio, prazo_previsto, addr_lat, addr_lon, addr_located) VALUES ('jOwn','c1','Own', 'l1', 'Em andamento','2026-11-02','2026-11-03', 27.78, -82.42, 'county')");
  d.raw.exec("INSERT INTO gm_jobs (id, client_id, obra, lead_id, status, inicio, prazo_previsto) VALUES ('jLead','c1','ViaLead','l1','Em andamento','2026-11-02','2026-11-03')");
  d.raw.exec("INSERT INTO gm_jobs (id, client_id, obra, status, inicio, prazo_previsto) VALUES ('jNone','c1','None','Em andamento','2026-11-02','2026-11-03')");
  const F = build(["gmDerivedJobEvents", "gmLocationApprox"], [], Object.assign({}, baseStubs));
  const ev = await F.gmDerivedJobEvents({ DB: d.DB }, "c1", "2026-11-01", "2026-11-05");
  const by = (id) => ev.find((e) => e.kind === "band" && e.job_id === id);
  ok(by("jOwn") && by("jOwn").addr_lat === 27.78 && by("jOwn").addr_lon === -82.42 && by("jOwn").approx_location === false, "Rain by site: a project with its own coordinates uses them (county, not approximate)");
  ok(by("jLead") && by("jLead").addr_lat === 28.5 && by("jLead").approx_location === true, "Rain by site: a project without its own uses its lead's");
  ok(by("jNone") && by("jNone").addr_lat === null && by("jNone").approx_location === false, "Rain by site: no coordinates anywhere stays null");

  const list = workerSrc.slice(workerSrc.indexOf("\nasync function handleGetGmJobs("), workerSrc.indexOf("\nasync function handleGetGmJobPhotos("));
  ok(/l\.addr_lat AS lead_addr_lat/.test(list) && /l\.addr_lon AS lead_addr_lon/.test(list) && !/, l\.addr_lat, l\.addr_lon FROM/.test(list), "the project list keeps its own coordinates and carries the lead's under other names");
  const gm = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
  ok(/lead_addr_lat/.test(gm), "the 'no map coordinates' count on the Projects screen looks at own coordinates, then the lead's");
}

// ── 5. The read only count ───────────────────────────────────────────────
const NAMES = ["gmGeocodeCountCompute", "handleGetGmGeocodeCount", "gmGeocodeCountOwnerGuard", "publicReadRateLimited", "jsonErr2"];
function countWorld(user, d) {
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => user,
    requireClientAccess: (u, id) => !!u && (u.role === "developer" || (u.role === "client" && u.client_id === id)),
    sessionSellerName: (u) => (u && u.login_role === "seller" && u.seller_name) ? u.seller_name : null,
    PASSKEY_NEW_LOGIN_ROLES: ["partner", "staff_finance", "staff"],
    jsonErr2: (pt, en, status) => ({ status, error: en })
  });
  const F = build(["gmGeocodeCountCompute", "handleGetGmGeocodeCount", "gmGeocodeCountOwnerGuard", "publicReadRateLimited"], ["PUBLIC_READ_HITS", "PUBLIC_READ_HITS_SWEPT"], stubs);
  return F;
}
{
  const d = dbWithProjects();
  const L = (id, extra) => d.raw.exec("INSERT INTO gm_leads (id, client_id, cliente" + (extra ? ", " + Object.keys(extra).join(",") : "") + ") VALUES ('" + id + "','c1','" + id + "'" + (extra ? ", " + Object.values(extra).map((v) => typeof v === "number" ? v : "'" + v + "'").join(",") : "") + ")");
  const J = (id, obra, lead, extra, status) => d.raw.exec("INSERT INTO gm_jobs (id, client_id, obra, lead_id, status" + (extra ? ", " + Object.keys(extra).join(",") : "") + ") VALUES ('" + id + "','c1','" + obra + "'," + (lead ? "'" + lead + "'" : "NULL") + ",'" + (status || "Em andamento") + "'" + (extra ? ", " + Object.values(extra).map((v) => typeof v === "number" ? v : "'" + v + "'").join(",") : "") + ")");
  L("lGood", { addr_street: "1 A St", addr_lat: 28.1, addr_lon: -82.1, addr_located: "exact" });
  L("lZip", { addr_zip: "33647", addr_lat: 28.11, addr_lon: -82.37, addr_located: "zip" });
  L("lAddrNoCoords", { addr_street: "5 Lost Rd" });
  L("lLegacy", { address: "9 Old Way" });
  L("lEmpty");
  J("p1", "Own exact", null, { addr_street: "1217 Apollo Beach Blvd", addr_lat: 27.78, addr_lon: -82.42, addr_located: "county" });
  J("p2", "Own zip", null, { addr_zip: "33647", addr_lat: 28.11, addr_lon: -82.37, addr_located: "zip" });
  J("p3", "Via lead exact", "lGood");
  J("p4", "Via lead zip", "lZip");
  J("p5", "Lead address, no coords", "lAddrNoCoords");
  J("p6", "Lead legacy text", "lLegacy");
  J("p7", "Lead empty", "lEmpty");
  J("p8", "Nothing at all", null);
  J("p9", "Own address, no coords", null, { addr_street: "77 Nowhere Ln" });
  J("p10", "Finished", null, null, "Concluída");
  d.raw.exec("INSERT INTO gm_jobs (id, client_id, obra, status) VALUES ('px','other-client','Other client project','Em andamento')");

  const before = JSON.stringify([d.q("SELECT * FROM gm_jobs"), d.q("SELECT * FROM gm_leads")]);
  const owner = { role: "client", client_id: "c1", login_role: "client" };
  const F = countWorld(owner, d);
  const rq = { url: "https://x.test/api/clients/c1/gm/geocode-count", headers: { get: () => null } };
  const r = await F.handleGetGmGeocodeCount("c1", rq, { DB: d.DB });
  ok(r.status === 200, "the owner gets 200");
  const c = r.data;
  ok(c.active_total === 9, "active projects counted for this client only (got " + c.active_total + ")");
  ok(c.own_coordinates === 2, "own coordinates: 2 (got " + c.own_coordinates + ")");
  ok(c.lead_coordinates_only === 2, "coordinates only through the lead: 2 (got " + c.lead_coordinates_only + ")");
  ok(c.approximate_only === 2, "located only approximately (zip or town): 2 (got " + c.approximate_only + ")");
  ok(c.lead_address_no_coordinates === 2, "lead has an address but no coordinates: 2 (got " + c.lead_address_no_coordinates + ")");
  ok(c.no_address_anywhere === 2, "no address anywhere: 2 (got " + c.no_address_anywhere + ")");
  ok(c.own_address_no_coordinates === 1, "own address but no coordinates: 1 (got " + c.own_address_no_coordinates + ")");
  const names = (c.needs_attention || []).map((n) => n.name).sort();
  ok(JSON.stringify(names) === JSON.stringify(["Lead address, no coords", "Lead empty", "Lead legacy text", "Nothing at all", "Own address, no coords", "Own zip", "Via lead zip"]), "names needing attention: " + names.join(" | "));
  ok(!names.includes("Finished") && !names.includes("Other client project"), "finished projects and other clients' projects are never listed");
  const after = JSON.stringify([d.q("SELECT * FROM gm_jobs"), d.q("SELECT * FROM gm_leads")]);
  ok(before === after, "the tables are byte for byte the same after the count");
  ok(d.writes.length === 0, "no INSERT, UPDATE or DELETE statement ran (" + d.writes.length + " writes)");
  ok(d.log.every((s) => /^\s*SELECT/i.test(s)) && d.log.length >= 1, "every statement was a SELECT (" + d.log.length + " statement)");

  // roles
  let F2 = countWorld(null, d);
  let r2 = await F2.handleGetGmGeocodeCount("c1", rq, { DB: d.DB });
  ok(r2.status === 401, "not signed in: 401");
  F2 = countWorld({ role: "client", client_id: "c1", login_role: "seller", seller_name: "Sam" }, d);
  r2 = await F2.handleGetGmGeocodeCount("c1", rq, { DB: d.DB });
  ok(r2.status === 403, "a salesperson of the same client: 403");
  F2 = countWorld({ role: "client", client_id: "other", login_role: "client" }, d);
  r2 = await F2.handleGetGmGeocodeCount("c1", rq, { DB: d.DB });
  ok(r2.status === 403, "another client's owner: 403");
  F2 = countWorld({ role: "client", client_id: "c1", login_role: "partner" }, d);
  r2 = await F2.handleGetGmGeocodeCount("c1", rq, { DB: d.DB });
  ok(r2.status === 403, "a partner login of the same client: 403");
  F2 = countWorld({ role: "developer", login_role: "client" }, d);
  r2 = await F2.handleGetGmGeocodeCount("c1", rq, { DB: d.DB });
  ok(r2.status === 200, "staff (developer) may read it");
  ok(d.writes.length === 0, "still no writes after the 401 and 403 attempts");

  // a bad client id is never put in SQL (it is a bound value), and rate limit
  const rb = await countWorld(owner, d).handleGetGmGeocodeCount("c1' OR '1'='1", rq, { DB: d.DB });
  ok(rb.status === 403, "a made-up client id is refused before any query");
  const Fl = countWorld(owner, d);
  const rql = { url: rq.url, headers: { get: (h) => h === "CF-Connecting-IP" ? "203.0.113.9" : null } };
  let last = null;
  for (let i = 0; i < 40; i++) { last = await Fl.handleGetGmGeocodeCount("c1", rql, { DB: d.DB }); }
  ok(last.status === 429, "too many requests: 429");
}

// ── 7. "Use my location": the manual position ────────────────────────────
{
  const G = build(["gmManualPosition"], [], baseStubs);
  const okCases = [[27.7819, -82.4222], [0, 0], [-90, 180], [90, -180], [27.781912, -82.422212], [-33.8688, 151.2093], [51.5, -0.12]];
  for (const [la, lo] of okCases) {
    const r = G.gmManualPosition({ manual_lat: la, manual_lon: lo });
    ok(r && !r.error && r.lat === la && r.lon === lo, "accepted: " + la + ", " + lo + " (works anywhere, including outside the US)");
  }
  ok(G.gmManualPosition({}) === null && G.gmManualPosition({ addr_street: "x" }) === null, "no manual fields: nothing to do (null)");
  const bad = [
    ["latitude 91", { manual_lat: 91, manual_lon: 0 }], ["latitude -90.5", { manual_lat: -90.5, manual_lon: 0 }],
    ["longitude 181", { manual_lat: 0, manual_lon: 181 }], ["longitude -180.1", { manual_lat: 0, manual_lon: -180.1 }],
    ["7 decimals", { manual_lat: 27.1234567, manual_lon: -82.4 }], ["7 decimals in longitude", { manual_lat: 27.1, manual_lon: -82.1234567 }],
    ["text numbers", { manual_lat: "27.78", manual_lon: "-82.42" }], ["text", { manual_lat: "abc", manual_lon: "def" }],
    ["only latitude", { manual_lat: 27.78 }], ["only longitude", { manual_lon: -82.4 }],
    ["null latitude", { manual_lat: null, manual_lon: -82.4 }], ["NaN", { manual_lat: NaN, manual_lon: 1 }], ["Infinity", { manual_lat: Infinity, manual_lon: 1 }],
    ["exponent", { manual_lat: 1e-7, manual_lon: 1 }], ["array", { manual_lat: [1], manual_lon: [2] }], ["object", { manual_lat: { a: 1 }, manual_lon: 1 }], ["boolean", { manual_lat: true, manual_lon: false }]
  ];
  for (const [label, body] of bad) {
    const r = G.gmManualPosition(body);
    ok(r && typeof r.error === "string" && r.lat === undefined, "refused: " + label);
  }

  const F = build(["gmJobFields", "gmStr", "gmNum", "gmManualPosition"], ["GM_JOB_STATUSES"], baseStubs);
  const good = F.gmJobFields({ manual_lat: 27.7819, manual_lon: -82.4222 }, true);
  ok(!good.error && good.fields.addr_lat === 27.7819 && good.fields.addr_lon === -82.4222 && good.fields.addr_located === "manual", "project: the position is stored with addr_located 'manual'");
  ok(F.gmJobFields({ manual_lat: 100, manual_lon: 0 }, true).error, "project: a bad position is an error (400 in the route)");
  const fake = F.gmJobFields({ addr_located: "manual", addr_lat: 1, addr_lon: 2 }, true);
  ok(!fake.error && fake.fields.addr_located === undefined && fake.fields.addr_lat === undefined, "a browser cannot claim 'manual' without the manual fields");
}
{
  const G = build(["gmLeadAddressChanged", "gmLeadGeocodeIfNeeded"], [], Object.assign({}, baseStubs, { geocodeAddress: async () => { throw new Error("must not geocode"); } }));
  const f = { addr_street: "1 New St", addr_lat: 1, addr_lon: 2, addr_located: "manual" };
  await G.gmLeadGeocodeIfNeeded(f, { addr_street: "old" });
  ok(f.addr_lat === 1 && f.addr_located === "manual", "a manual position sent with the address save is not overwritten by a lookup");
}
{
  // PUT project: manual saves without a lookup; a later address change looks up again and replaces it.
  const existing = { id: "j1", client_id: "c1", obra: "Test", lead_id: null, status: "Em andamento", addr_street: "1 A St", addr_city: "Tampa", addr_state: "FL", addr_zip: "33647", addr_lat: 1, addr_lon: 2, addr_located: "zip" };
  const req = (b) => ({ url: "https://x.test/", headers: { get: () => null }, json: async () => b });
  async function world2(ex) {
    let geo = 0; const captured = [];
    const stubs = Object.assign({}, baseStubs, {
      requireClientAccess: () => true, gmOwnedRow: async () => ex,
      geocodeAddress: async () => { geo++; return { lat: 27.5, lon: -82.5, located: "exact" }; },
      gmValueWriteStmts: (env, o) => { captured.push(o); return []; }, gmGuardedValorExpr: () => "?", gmGuardedFinalCentsExpr: () => "?",
      sessionSellerName: () => null
    });
    const F = build(["handlePutGmJob", "gmJobFields", "gmStr", "gmNum", "gmLeadAddressChanged", "gmLeadGeocodeIfNeeded", "gmManualPosition"], ["GM_JOB_STATUSES"], stubs);
    const env = { DB: { batch: async () => [], prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } };
    return { F, env, captured, geo: () => geo };
  }
  let w = await world2(existing);
  let r = await w.F.handlePutGmJob("c1", "j1", req({ manual_lat: 27.7819, manual_lon: -82.4222 }), w.env);
  ok(r.status === 200 && w.geo() === 0 && w.captured[0].extraBinds.indexOf("manual") >= 0 && w.captured[0].extraBinds.indexOf(27.7819) >= 0, "PUT project with a position: 200, no lookup, stored as manual");
  w = await world2(existing);
  r = await w.F.handlePutGmJob("c1", "j1", req({ manual_lat: 91, manual_lon: 0 }), w.env);
  ok(r.status === 400 && w.captured.length === 0 && w.geo() === 0, "PUT project with a bad position: 400, nothing written");
  ok(typeof r.error === "string" && !/91/.test(r.error), "the 400 message is generic");
  const manualRow = Object.assign({}, existing, { addr_lat: 27.7819, addr_lon: -82.4222, addr_located: "manual" });
  w = await world2(manualRow);
  r = await w.F.handlePutGmJob("c1", "j1", req({ addr_street: "2 B St" }), w.env);
  ok(r.status === 200 && w.geo() === 1 && w.captured[0].extraBinds.indexOf("exact") >= 0, "a later address change runs the normal lookup again and replaces the manual position");
  w = await world2(manualRow);
  r = await w.F.handlePutGmJob("c1", "j1", req({ valor: 10 }), w.env);
  ok(w.geo() === 0, "an unrelated edit leaves the manual position alone");
}
{
  // Leads: same validation; same role check as the address save.
  const calls = { run: 0, batch: 0, prepare: 0 };
  const DB = { prepare() { calls.prepare++; return { bind() { return this; }, run() { calls.run++; return {}; }, first() { return null; } }; }, batch() { calls.batch++; return []; } };
  let seller = null, canAct = true;
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => ({ role: "client", client_id: "c1", display_name: "ZETA" }),
    requireClientAccess: () => true,
    gmOwnedRow: async () => ({ id: "l1", client_id: "c1", estagio: "novo_lead", vendedor: "Ana" }),
    sessionSellerName: () => seller, sellerCanActOnLead: () => canAct, gmGetConfig: async () => ({}),
    geocodeAddress: async () => { throw new Error("must not geocode"); }
  });
  const F = build(["handlePutGmLead", "gmLeadFields", "gmLeadEmailOk", "gmStr", "gmNum", "gmManualPosition", "gmLeadAddressChanged", "gmLeadGeocodeIfNeeded"], ["GM_LEAD_COST_FIELDS"], stubs);
  const req = (b) => ({ url: "https://x.test/", headers: { get: () => null }, json: async () => b });
  let r = await F.handlePutGmLead("c1", "l1", req({ manual_lat: 95, manual_lon: 1 }), { DB });
  ok(r.status === 400 && calls.run === 0 && calls.batch === 0, "PUT lead with a bad position: 400, nothing written");
  r = await F.handlePutGmLead("c1", "l1", req({ manual_lat: "27.7", manual_lon: "-82.4" }), { DB });
  ok(r.status === 400, "PUT lead with the position as text: 400");
  seller = "Bob"; canAct = false;
  r = await F.handlePutGmLead("c1", "l1", req({ manual_lat: 27.7, manual_lon: -82.4 }), { DB });
  ok(r.status === 403 && calls.run === 0 && calls.batch === 0, "a salesperson who does not own the lead cannot set its position: 403, nothing written");
  const fl = await F.gmLeadFields({ manual_lat: 27.7819, manual_lon: -82.4222 }, {}, true, null, "c1");
  ok(!fl.error && fl.fields.addr_lat === 27.7819 && fl.fields.addr_lon === -82.4222 && fl.fields.addr_located === "manual", "lead: stored with addr_located 'manual'");
  const fl2 = await F.gmLeadFields({ addr_located: "manual", addr_lat: 3, addr_lon: 4 }, {}, true, null, "c1");
  ok(!fl2.error && fl2.fields.addr_located === undefined && fl2.fields.addr_lat === undefined, "lead: a browser cannot claim 'manual' without the manual fields");
}
{
  const gm = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
  const i = gm.indexOf("function gmLeadLocatedLabel(");
  const src = gm.slice(i, gm.indexOf("\n}", i) + 2);
  for (const lang of ["pt", "en"]) {
    const L = new Function("gmT", src + "\nreturn gmLeadLocatedLabel;")((p, e) => (lang === "pt" ? p : e));
    ok(L("manual") === (lang === "pt" ? "Localizado: posição do aparelho" : "Located: device position"), "label for manual in " + lang + ": " + L("manual"));
  }
  const F = build(["gmLocationApprox"], [], {});
  ok(F.gmLocationApprox("manual") === false && F.gmLocationApprox("county") === false, "manual and county are not approximate");
}

// ── 6. The route is registered, the script exists and writes nothing ─────
{
  ok(/gmCol === "geocode-count"[^\n]*handleGetGmGeocodeCount/.test(workerSrc), "GET /api/clients/:id/gm/geocode-count is routed");
  const i = workerSrc.indexOf("\nasync function handleGetGmGeocodeCount(");
  const body = workerSrc.slice(i, workerSrc.indexOf("\n}", i));
  ok(i > 0 && !/INSERT|UPDATE|DELETE|\.run\(|batch\(/.test(body), "the count handler has no write statement");
  let script = "";
  try { script = readFileSync(new URL("./geocode-count.mjs", import.meta.url), "utf8"); } catch (e) { script = ""; }
  ok(script.length > 0 && /geocode-count/.test(script) && !/INSERT|UPDATE|DELETE|method:\s*["'](POST|PUT|DELETE|PATCH)/i.test(script), "scripts/geocode-count.mjs exists and only reads");
  ok(script.length > 0 && !/capt_[0-9a-f]{20}/.test(script), "the script holds no token");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
