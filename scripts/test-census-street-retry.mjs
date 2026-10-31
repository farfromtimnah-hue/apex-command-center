// The Census street lookup is tried once more after 600 ms when it fails, is
// not OK, or finds nothing; each try has a 5 second timeout; only the street
// step retries. Real Worker functions, injected fetch.
//
//   node scripts/test-census-street-retry.mjs
import { readFileSync } from "node:fs";
import { build, baseStubs } from "./fixtures/d1-shim.mjs";

const ZIP_CENTERS_V1 = JSON.parse(readFileSync(new URL("../data/geo/zip-centers-v1.json", import.meta.url), "utf8"));
const TOWN_CENTERS_V1 = JSON.parse(readFileSync(new URL("../data/geo/town-centers-v1.json", import.meta.url), "utf8"));

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = ["geocodeOneLine", "geocodeAddress", "geoZip5", "geoState2", "geoCityClean", "geoLoadCenters", "geoFetchJson", "geoPlacesCenter", "geoZipCenter", "geoTownCenter"];
const VARS = ["GEO_CENSUS_TIMEOUT_MS", "GEO_CENSUS_RETRY_WAIT_MS", "GEO_FETCH_TIMEOUT_MS", "GEO_ZIP_MAP", "GEO_TOWN_MAP"];

const HIT = { ok: true, json: async () => ({ result: { addressMatches: [{ coordinates: { x: -82.4, y: 27.9 } }] } }) };
const EMPTY = { ok: true, json: async () => ({ result: { addressMatches: [] } }) };
const NOT_OK = { ok: false, status: 500, json: async () => ({}) };

// `script` is the list of answers for successive Census calls: a response, or
// "throw". Zippopotam is never reached in these cases (the bundled files answer).
function world(script) {
  const census = [];
  const fetchStub = async (url, opts) => {
    if (String(url).indexOf("geocoding.geo.census.gov") < 0) { return { ok: false, status: 404, json: async () => ({}) }; }
    census.push({ url: String(url), signal: opts && opts.signal, at: Date.now() });
    const a = script[census.length - 1];
    if (a === "throw") { throw new Error("network down"); }
    return a || EMPTY;
  };
  const F = build(FNS, VARS, Object.assign({}, baseStubs, { fetch: fetchStub, ZIP_CENTERS_V1, TOWN_CENTERS_V1 }));
  return { F, census };
}
const ADDR = { street: "123 Main St", city: "Tampa", state: "FL", zip: "33647" };

// (a) first call fails, second succeeds -> the exact point
for (const [label, first] of [["throws", "throw"], ["is not OK", NOT_OK], ["finds nothing", EMPTY]]) {
  const w = world([first, HIT]);
  const t0 = Date.now();
  const geo = await w.F.geocodeAddress(ADDR);
  const waited = w.census.length > 1 ? w.census[1].at - w.census[0].at : 0;
  ok(geo.located === "exact" && geo.lat === 27.9 && geo.lon === -82.4, "(a) first call " + label + ", second succeeds -> the exact point");
  ok(w.census.length === 2 && w.census[0].url === w.census[1].url, "(a) first call " + label + ": the SAME request is sent a second time (" + w.census.length + " calls)");
  ok(waited >= 550 && waited < 1500, "(a) first call " + label + ": it waited about 600 ms between the two (waited " + waited + " ms)");
}

// (b) both empty -> falls through to the ZIP step; still never throws
{
  const w = world([EMPTY, EMPTY]);
  const geo = await w.F.geocodeAddress(ADDR);
  ok(w.census.length === 2, "(b) both empty: exactly two Census calls, never a third (" + w.census.length + ")");
  ok(geo.located === "zip" && Math.abs(geo.lat - 28.15) < 0.1, "(b) both empty -> the ZIP step answers (located: " + geo.located + ")");
  const w2 = world(["throw", "throw"]);
  const geo2 = await w2.F.geocodeAddress(ADDR);
  ok(w2.census.length === 2 && geo2.located === "zip", "(b) both throw: two calls, no throw, the ZIP step answers (located: " + geo2.located + ")");
}

// (c) success on the first call -> exactly one request, no wait
{
  const w = world([HIT]);
  const t0 = Date.now();
  const geo = await w.F.geocodeAddress(ADDR);
  ok(w.census.length === 1 && geo.located === "exact" && Date.now() - t0 < 400, "(c) success first time: exactly one request and no wait");
}

// (d) no street -> no Census request at all
{
  const w = world([HIT]);
  const geo = await w.F.geocodeAddress({ street: "", city: "Tampa", state: "FL", zip: "33647" });
  ok(w.census.length === 0 && geo.located === "zip", "(d) no street: no Census request (" + w.census.length + "), ZIP answers");
}

// Each try carries an abort signal (the 5 second timeout).
{
  const w = world([EMPTY, HIT]);
  await w.F.geocodeAddress(ADDR);
  ok(w.census.length === 2 && w.census.every((c) => c.signal && typeof c.signal.aborted === "boolean"), "each attempt is sent with an AbortController signal");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
