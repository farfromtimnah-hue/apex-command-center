// The county step of the geocoder: new construction streets the Census file
// misses, found in Hillsborough County's public address layer. Real Worker
// functions cut out of worker/index.js, stubbed fetch with canned answers.
//
//   node scripts/test-geocode-county.mjs
import { readFileSync } from "node:fs";
import { build, baseStubs, workerSrc } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const ZIP_CENTERS_V1 = JSON.parse(readFileSync(new URL("../data/geo/zip-centers-v1.json", import.meta.url), "utf8"));
const TOWN_CENTERS_V1 = JSON.parse(readFileSync(new URL("../data/geo/town-centers-v1.json", import.meta.url), "utf8"));
const HOST = "gisdextweb1.hillsboroughcounty.org";
const FIELDS = { AddrNum: "AddrNum", RoadName: "RoadName" };

const FNS = ["geocodeOneLine", "geocodeAddress", "geoZip5", "geoState2", "geoCityClean", "geoLoadCenters", "geoFetchJson", "geoPlacesCenter", "geoZipCenter", "geoTownCenter",
  "geoLayerWordOk", "geoLayerFold", "geoLayerParseStreet", "geoLayerEntry", "geoLayerWhere", "geoLayerFetchJson", "geoLayerPick", "geoLayerCenter"];
const VARS = ["GEO_CENSUS_TIMEOUT_MS", "GEO_CENSUS_RETRY_WAIT_MS", "GEO_FETCH_TIMEOUT_MS", "GEO_ZIP_MAP", "GEO_TOWN_MAP",
  "GEO_LAYERS", "GEO_LAYER_TIMEOUT_MS", "GEO_LAYER_TYPES", "GEO_LAYER_DIRS", "GEO_LAYER_UNIT_WORDS"];
const ADDRESS_LAYERS_V1 = JSON.parse(readFileSync(new URL("../data/geo/address-layers-v1.json", import.meta.url), "utf8"));
const ENTRY = ADDRESS_LAYERS_V1.layers[0];

const feat = (addr, status, lat, lon, zip) => ({ attributes: { FullAddr: addr, Post_Code: zip || "33572", Status: status }, geometry: { x: lon, y: lat } });
const layer = (features) => () => ({ ok: true, json: async () => ({ features }) });
const censusEmpty = () => ({ ok: true, json: async () => ({ result: { addressMatches: [] } }) });
const censusHit = (lat, lon) => () => ({ ok: true, json: async () => ({ result: { addressMatches: [{ coordinates: { x: lon, y: lat } }] } }) });

function world({ census, county, zippo }) {
  const calls = [];
  const logs = [];
  const fetchStub = async (url, opts) => {
    calls.push(String(url));
    const u = String(url);
    if (u.indexOf("geocoding.geo.census.gov") >= 0) { return (census || censusEmpty)(u); }
    if (u.indexOf(HOST) >= 0) { return county ? county(u, opts) : { ok: true, json: async () => ({ features: [] }) }; }
    if (u.indexOf("api.zippopotam.us") >= 0) { return zippo ? zippo(u) : { ok: false, status: 404, json: async () => ({}) }; }
    throw new Error("unexpected host: " + u);
  };
  const consoleStub = { log: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")) };
  const F = build(FNS, VARS, Object.assign({}, baseStubs, { fetch: fetchStub, ZIP_CENTERS_V1, TOWN_CENTERS_V1, ADDRESS_LAYERS_V1, console: consoleStub }));
  return { F, calls, logs, countyCalls: () => calls.filter((c) => c.indexOf(HOST) >= 0) };
}
const FL = { street: "1217 Apollo Beach Blvd", city: "Apollo Beach", state: "FL", zip: "33572" };

// 1. The right record: Current beats Pending beats Proposed, whatever the order.
{
  const rows = [feat("1217 Apollo Beach Blvd", "Proposed", 1, -1), feat("1217 Apollo Beach Blvd", "Pending", 2, -2), feat("1217 Apollo Beach Blvd", "Current", 3, -3)];
  for (const order of [rows, rows.slice().reverse()]) {
    const w = world({ county: layer(order) });
    const g = await w.F.geoLayerCenter(FL);
    ok(g && g.lat === 3 && g.lon === -3, "Current is chosen over Pending and Proposed");
  }
  const w2 = world({ county: layer([rows[0], rows[1]]) });
  const g2 = await w2.F.geoLayerCenter(FL);
  ok(g2 && g2.lat === 2, "Pending is chosen over Proposed when there is no Current");
  const w3 = world({ county: layer([rows[0]]) });
  const g3 = await w3.F.geoLayerCenter(FL);
  ok(g3 && g3.lat === 1, "Proposed alone is accepted");
}

// 2. Refusals: a different house number, and Retired / Inactive / Unknown.
{
  const w = world({ county: layer([feat("1219 Apollo Beach Blvd", "Current", 5, -5)]) });
  ok((await w.F.geoLayerCenter(FL)) === null, "a different house number is refused");
  const w1 = world({ county: layer([feat("12170 Apollo Beach Blvd", "Current", 5, -5)]) });
  ok((await w1.F.geoLayerCenter(FL)) === null, "12170 is not 1217 (exact house number, not a prefix)");
  const w1b = world({ county: layer([feat("1217A Apollo Beach Blvd", "Current", 5, -5)]) });
  ok((await w1b.F.geoLayerCenter(FL)) === null, "1217A is not 1217");
  const w1c = world({ county: layer([feat("1217 Other Road", "Current", 5, -5)]) });
  ok((await w1c.F.geoLayerCenter(FL)) === null, "a different street name is refused");
  for (const st of ["Retired", "Inactive", "Unknown", "Temporary", "Other", "", null]) {
    const w2 = world({ county: layer([feat("1217 Apollo Beach Blvd", st, 5, -5)]) });
    ok((await w2.F.geoLayerCenter(FL)) === null, "status " + JSON.stringify(st) + " is refused");
  }
  const w3 = world({ county: layer([feat("1217 Apollo Beach Blvd", "Retired", 5, -5), feat("1217 Apollo Beach Blvd", "Pending", 6, -6)]) });
  const g3 = await w3.F.geoLayerCenter(FL);
  ok(g3 && g3.lat === 6, "a Retired record next to a Pending one: the Pending one wins");
  const w4 = world({ county: layer([feat("1217A Apollo Beach Blvd", "Current", 7, -7)]) });
  const g4 = await w4.F.geoLayerCenter({ street: "1217A Apollo Beach Blvd", city: "Apollo Beach", state: "FL", zip: "33572" });
  ok(g4 && g4.lat === 7, "a house number with a letter matches the letter exactly");
}

// 3. The request: one call, the right host, safe where clause.
{
  const w = world({ county: layer([feat("1217 Apollo Beach Blvd", "Pending", 27.7819, -82.4222)]) });
  const g = await w.F.geoLayerCenter(FL);
  const c = w.countyCalls();
  ok(c.length === 1, "exactly one outside call to the county layer");
  const u = new URL(c[0]);
  ok(u.protocol === "https:" && u.host === HOST, "the call goes to exactly " + HOST);
  ok(u.searchParams.get("outSR") === "4326" && u.searchParams.get("f") === "json", "outSR=4326 and f=json");
  ok(u.searchParams.get("outFields") === "FullAddr,Post_Code,Status", "outFields come from the registry field map: FullAddr, Post_Code, Status");
  ok(u.searchParams.get("resultRecordCount") === "5", "at most 5 records are requested");
  const where = u.searchParams.get("where");
  ok(/AddrNum\s*=\s*'1217'/.test(where) && /UPPER\(RoadName\) LIKE 'APOLLO BEACH%'/.test(where) && /Post_Code\s*=\s*'33572'/.test(where),
    "where: house number equals AddrNum, RoadName LIKE the street words, Post_Code equals the ZIP (got " + where + ")");
  ok(g && Math.abs(g.lat - 27.7819) < 1e-6 && Math.abs(g.lon - -82.4222) < 1e-6, "geometry x is the longitude and y the latitude");
  const w2 = world({ county: layer([feat("1217 Apollo Beach Blvd", "Current", 1, -1)]) });
  const r2 = await w2.F.geoLayerCenter({ street: "1217 Apollo Beach Blvd", city: "Apollo Beach", state: "FL", zip: "" });
  ok(r2 === null && w2.countyCalls().length === 0, "no ZIP typed: the step is skipped, no call");
  const w3 = world({ county: layer([feat("1217 N Apollo Beach Blvd", "Current", 1, -1)]) });
  const g3 = await w3.F.geoLayerCenter({ street: "1217 N Apollo Beach Blvd Apt 4", city: "x", state: "FL", zip: "33572" });
  ok(g3 && /LIKE 'APOLLO BEACH%'/.test(new URL(w3.countyCalls()[0]).searchParams.get("where")), "a typed direction, road type and unit are left out of the name");
}

// 4. Unsafe input never reaches the where clause.
{
  const w = world({ county: layer([feat("12 O'Brien St", "Current", 1, -1, "33607")]) });
  const g = await w.F.geoLayerCenter({ street: "12 O'Brien St", city: "Tampa", state: "FL", zip: "33607" });
  const where = w.countyCalls().length ? new URL(w.countyCalls()[0]).searchParams.get("where") : "";
  ok(/LIKE 'O''BRIEN%'/.test(where) && where.replace(/''/g, "").split("'").length - 1 === 6, "an apostrophe is doubled inside the quoted term and the clause has exactly three quoted terms (got " + where + ")");
  ok(g && g.lat === 1, "and the record is still found");
  for (const bad of ["12 Main St; DROP TABLE x", "12 Main St' OR '1'='1", "12 Main%", "12 Ma_in St", "12 Main\\St", "12 Main \"St", "12 Main (St)", "12 Main/St", "12 Main--x"]) {
    const wb = world({ county: layer([feat("12 Main St", "Current", 1, -1)]) });
    const r = await wb.F.geoLayerCenter({ street: bad, city: "Tampa", state: "FL", zip: "33607" });
    ok(r === null && wb.countyCalls().length === 0, "refused with no outside call: " + JSON.stringify(bad));
  }
  const wz = world({ county: layer([]) });
  await wz.F.geoLayerCenter({ street: "12 Main St", city: "Tampa", state: "FL", zip: "33607' OR 1=1" });
  ok(wz.countyCalls().length === 0 || !/OR 1=1/.test(new URL(wz.countyCalls()[0]).searchParams.get("where")), "a bad ZIP never reaches the where clause");
}

// 5. Host allowlist: exactly the hosts in the registry file.
{
  const w = world({});
  const path = ENTRY.path + "/query?f=json";
  ok((await w.F.geoLayerFetchJson("https://evil.example.com" + path)) === null && w.calls.length === 0, "another host is refused with no call");
  ok((await w.F.geoLayerFetchJson("https://" + HOST + ".evil.example.com/x")) === null && w.calls.length === 0, "a look-alike host is refused");
  ok((await w.F.geoLayerFetchJson("http://" + HOST + path)) === null && w.calls.length === 0, "plain http is refused");
  ok((await w.F.geoLayerFetchJson("https://user@" + HOST + "@evil.example.com/x")) === null && w.calls.length === 0, "a user-info trick is refused");
  ok((await w.F.geoLayerFetchJson("https://" + HOST + "/arcgis/rest/services/OTHER/Thing/MapServer/0/query?f=json")) === null && w.calls.length === 0, "a path that is not in a registry entry is refused");
  const two = [ENTRY, { id: "other-county", label: "Other", host: "gis.other-county.example", path: "/arcgis/rest/services/A/B/MapServer/0", state: "TX", zips: ["77001"], fields: ENTRY.fields, statuses: ENTRY.statuses }];
  const w2 = world({ county: layer([]) });
  ok((await w2.F.geoLayerFetchJson("https://gis.other-county.example/arcgis/rest/services/A/B/MapServer/0/query?f=json", two)) !== null || w2.calls.length === 1, "a host listed in a second registry entry is allowed (the registry is the allowlist)");
  const calledHost = new URL(w2.calls[0]).host;
  ok(calledHost === "gis.other-county.example", "the second entry's own host was the one called (" + calledHost + ")");
}

// 6. Entry selection: street present, typed state, ZIP in the entry's list. Else skip.
{
  const two = [ENTRY, { id: "other-county", label: "Other", host: "gis.other-county.example", path: "/arcgis/rest/services/A/B/MapServer/0", state: "TX", zips: ["77001", "33572"], fields: ENTRY.fields, statuses: ENTRY.statuses }];
  const w = world({});
  const idOf = (parts) => { const e = w.F.geoLayerEntry(parts, two); return e ? e.id : null; };
  ok(idOf({ street: "1 Main St", state: "FL", zip: "33572" }) === "hillsborough-tampa-bay", "FL + a listed ZIP: the Hillsborough entry");
  ok(idOf({ street: "1 Main St", state: "fl", zip: "33572" }) === "hillsborough-tampa-bay", "lower case fl");
  ok(idOf({ street: "1 Main St", state: "Florida", zip: "33572" }) === null, "a spelled out state is skipped (the screens store two letters)");
  ok(idOf({ street: "1 Main St", state: "TX", zip: "33572" }) === "other-county", "TX picks the TX entry even though 33572 is in both lists (state decides)");
  ok(idOf({ street: "1 Main St", state: "TX", zip: "77001" }) === "other-county", "TX + 77001: the other entry");
  ok(idOf({ street: "1 Main St", state: "FL", zip: "77001" }) === null, "FL with a ZIP that only the TX entry lists: skipped");
  ok(idOf({ street: "1 Main St", state: "CA", zip: "33572" }) === null, "a state with no entry: skipped");
  ok(idOf({ street: "1 Main St", state: "", zip: "33572" }) === null, "no state typed: skipped, a region is never guessed");
  ok(idOf({ street: "1 Main St", state: "FL", zip: "" }) === null, "no ZIP: skipped");
  ok(idOf({ street: "1 Main St", state: "FL", zip: "3357" }) === null, "a 4 digit ZIP: skipped");
  ok(idOf({ street: "1 Main St", state: "FL", zip: "90210" }) === null, "a ZIP no entry lists: skipped");
  ok(idOf({ street: "", state: "FL", zip: "33572" }) === null && idOf({ state: "FL", zip: "33572" }) === null, "no street: skipped");
  ok(w.F.geoLayerEntry({ street: "1 Main St", state: "FL", zip: "33647" }) !== null, "with the real registry, the test ZIP 33647 is covered");
  const wt = world({ county: layer([feat("1 Main St", "Current", 1, -1)]) });
  const r = await wt.F.geoLayerCenter({ street: "1 Main St", state: "TX", zip: "33572" });
  ok(r === null && wt.countyCalls().length === 0, "a Texas address makes no Hillsborough call");
  const entry = JSON.stringify(ENTRY);
  ok(/"hillsborough-tampa-bay"/.test(entry) && ENTRY.state === "FL" && ENTRY.zips.length > 10 && Object.keys(ENTRY.fields).sort().join() === "full_address,house_number,status,street_name,zip", "the registry entry has id, state, ZIPs and the five field names");
}

// 7. Failure: timeout, bad data, errors. Returns nothing, never throws.
{
  const bads = {
    "non-OK answer": () => ({ ok: false, status: 500, json: async () => ({}) }),
    "JSON that throws": () => ({ ok: true, json: async () => { throw new Error("bad json"); } }),
    "fetch that throws": () => { throw new Error("network down"); },
    "features not a list": () => ({ ok: true, json: async () => ({ features: "nope" }) }),
    "an error object": () => ({ ok: true, json: async () => ({ error: { code: 400, message: "bad" } }) }),
    "no geometry": () => ({ ok: true, json: async () => ({ features: [{ attributes: { FullAddr: "1217 Apollo Beach Blvd", Status: "Current" } }] }) }),
    "geometry with text": () => ({ ok: true, json: async () => ({ features: [{ attributes: { FullAddr: "1217 Apollo Beach Blvd", Status: "Current" }, geometry: { x: "a", y: "b" } }] }) }),
    "a point outside the earth": () => ({ ok: true, json: async () => ({ features: [{ attributes: { FullAddr: "1217 Apollo Beach Blvd", Status: "Current" }, geometry: { x: 999, y: 999 } }] }) }),
    "null body": () => ({ ok: true, json: async () => null })
  };
  for (const [name, fn] of Object.entries(bads)) {
    const w = world({ county: fn });
    let r, threw = false;
    try { r = await w.F.geoLayerCenter(FL); } catch (e) { threw = true; }
    ok(!threw && r === null, "returns nothing and does not throw: " + name);
  }
  // Timeout: the call never answers; the abort signal ends it after 4 seconds.
  const w = world({ county: (u, opts) => new Promise((res, rej) => { opts.signal.addEventListener("abort", () => rej(new Error("aborted"))); }) });
  const t0 = Date.now();
  const r = await w.F.geoLayerCenter(FL);
  const ms = Date.now() - t0;
  ok(r === null && ms >= 3500 && ms < 6000, "a call that never answers is cut off at about 4 seconds (took " + ms + " ms)");
  ok(/GEO_LAYER_TIMEOUT_MS\s*=\s*4000/.test(workerSrc), "the timeout is 4000 ms");
  ok(/import ADDRESS_LAYERS_V1 from "..\/data\/geo\/address-layers-v1.json"/.test(workerSrc), "the registry file is imported like zip-centers-v1.json");
  ok(/How to add another region/i.test(workerSrc), "a comment block explains how to add another region");
}

// 8. Chain order: exact, then county, then zip, then town, then none.
{
  const countyOk = layer([feat("1217 Apollo Beach Blvd", "Pending", 27.7819, -82.4222)]);
  let w = world({ census: censusHit(27.9, -82.4), county: countyOk });
  let g = await w.F.geocodeAddress(FL);
  ok(g.located === "exact" && w.countyCalls().length === 0, "exact found: the county layer is not called");
  w = world({ county: countyOk });
  g = await w.F.geocodeAddress(FL);
  ok(g.located === "county" && Math.abs(g.lat - 27.7819) < 1e-6 && Math.abs(g.lon + 82.4222) < 1e-6, "exact misses, county hits: located county");
  const iC = w.calls.findIndex((c) => c.indexOf(HOST) >= 0), iCensus = w.calls.findIndex((c) => c.indexOf("census.gov") >= 0);
  ok(iCensus >= 0 && iC > iCensus && w.calls.filter((c) => c.indexOf("zippopotam") >= 0).length === 0, "Census is asked first, then the county, and ZIP is never reached");
  w = world({});
  g = await w.F.geocodeAddress({ street: "999 Invented Ct", city: "Tampa", state: "FL", zip: "33647" });
  ok(g.located === "zip" && w.countyCalls().length === 1, "county finds nothing: falls on to the ZIP center");
  w = world({ county: () => { throw new Error("down"); } });
  g = await w.F.geocodeAddress({ street: "999 Invented Ct", city: "Tampa", state: "FL", zip: "33647" });
  ok(g.located === "zip", "county service down: the chain still reaches the ZIP");
  w = world({});
  g = await w.F.geocodeAddress({ street: "999 Invented Ct", city: "Tampa", state: "FL", zip: "" });
  ok(g.located === "town", "no ZIP: falls on to the town center");
  w = world({});
  g = await w.F.geocodeAddress({ street: "999 Invented Ct", city: "Nowheresville", state: "FL", zip: "" });
  ok(g.located === null && g.lat === null && g.lon === null, "nothing found anywhere: null, null, null");
  w = world({ county: countyOk });
  g = await w.F.geocodeAddress({ city: "Tampa", state: "FL", zip: "33647" });
  ok(g.located === "zip" && w.countyCalls().length === 0, "no street: no Census call, no county call, ZIP only");
}

// 9. A county answer is an address point: not approximate; the label says so.
{
  const F = build(["gmLocationApprox"], [], {});
  ok(F.gmLocationApprox("county") === false, "county is NOT approximate");
  ok(F.gmLocationApprox("zip") === true && F.gmLocationApprox("town") === true && F.gmLocationApprox("exact") === false, "zip and town stay approximate, exact stays exact");
  const gm = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
  const i = gm.indexOf("function gmLeadLocatedLabel(");
  const src = gm.slice(i, gm.indexOf("\n}", i) + 2);
  for (const lang of ["pt", "en"]) {
    const L = new Function("gmT", src + "\nreturn gmLeadLocatedLabel;")((p, e) => (lang === "pt" ? p : e));
    ok(L("county") === (lang === "pt" ? "Localizado: registros do condado" : "Located: county records"), "label for county in " + lang + ": " + L("county"));
    ok(L("exact") !== L("county") && /aproximado|approximate/.test(L("zip")) && L(null) !== L("county"), "other labels unchanged in " + lang);
  }
}

// 10. No full street address in any log, no database, no throw path out.
{
  const i = workerSrc.indexOf("\nasync function geoLayerCenter(");
  const body = workerSrc.slice(i, workerSrc.indexOf("\n}", i) + 2);
  ok(i > 0 && !/console\./.test(body) && !/env\.DB|DB\.prepare/.test(body), "geoLayerCenter has no logging and no database call");
  const w = world({ county: layer([feat("1217 Apollo Beach Blvd", "Current", 1, -1)]) });
  await w.F.geocodeAddress(FL);
  ok(w.logs.length === 0, "nothing is logged while geocoding");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
