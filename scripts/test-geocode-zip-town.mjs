// Geocoder fallback chain: exact street (Census) -> ZIP center -> town center -> none.
// ZIP and town centers come from the bundled Census Gazetteer files in data/geo/,
// with api.zippopotam.us as the second source. Real Worker functions, stubbed fetch.
//
//   node scripts/test-geocode-zip-town.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, fnSrc, workerSrc } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const ZIP_CENTERS_V1 = JSON.parse(readFileSync(new URL("../data/geo/zip-centers-v1.json", import.meta.url), "utf8"));
const TOWN_CENTERS_V1 = JSON.parse(readFileSync(new URL("../data/geo/town-centers-v1.json", import.meta.url), "utf8"));

const FNS = ["geocodeOneLine", "geocodeAddress", "geoZip5", "geoState2", "geoCityClean", "geoLoadCenters", "geoFetchJson", "geoPlacesCenter", "geoZipCenter", "geoTownCenter"];
const VARS = ["GEO_FETCH_TIMEOUT_MS", "GEO_ZIP_MAP", "GEO_TOWN_MAP"];

// calls: every URL requested. census: what the Census one-line geocoder answers.
// zippo: what api.zippopotam.us answers (a function of the URL) or "fail" modes.
function world({ census, zippo }) {
  const calls = [];
  const fetchStub = async (url, opts) => {
    calls.push(String(url));
    const u = String(url);
    if (u.indexOf("geocoding.geo.census.gov") >= 0) { return census ? census(u) : { ok: true, json: async () => ({ result: { addressMatches: [] } }) }; }
    if (u.indexOf("api.zippopotam.us") >= 0) { return zippo ? zippo(u, opts) : { ok: false, status: 404, json: async () => ({}) }; }
    throw new Error("unexpected host: " + u);
  };
  const F = build(FNS, VARS, Object.assign({}, baseStubs, { fetch: fetchStub, ZIP_CENTERS_V1, TOWN_CENTERS_V1 }));
  return { F, calls };
}
const censusHit = (lat, lon) => () => ({ ok: true, json: async () => ({ result: { addressMatches: [{ coordinates: { x: lon, y: lat } }] } }) });
const zippoZip = (lat, lon) => () => ({ ok: true, json: async () => ({ places: [{ latitude: String(lat), longitude: String(lon) }] }) });
const near = (a, b, tol) => typeof a === "number" && Math.abs(a - b) <= tol;
const census = (w) => w.calls.filter((c) => c.indexOf("census.gov") >= 0).length;
const zippoCalls = (w) => w.calls.filter((c) => c.indexOf("zippopotam") >= 0).length;

// 1. Order: exact first; no later call is made once a step finds something.
{
  const w = world({ census: censusHit(27.9, -82.4) });
  const g = await w.F.geocodeAddress({ street: "123 Main St", city: "Tampa", state: "FL", zip: "33601" });
  ok(g.located === "exact" && g.lat === 27.9 && w.calls.length === 1, "exact street wins and makes exactly one outside call");
}
// 2. Street fails -> ZIP from the bundled file, no zippopotam call.
{
  const w = world({});
  const g = await w.F.geocodeAddress({ street: "999 Invented Ct", city: "Tampa", state: "FL", zip: "33647" });
  ok(g.located === "zip" && near(g.lat, 28.11, 0.1) && near(g.lon, -82.37, 0.1), "33647: street unmatched -> located zip near 28.11, -82.37 (got " + g.lat + ", " + g.lon + ")");
  ok(census(w) === 1 && zippoCalls(w) === 0, "ZIP found in the bundled file: one Census call, no zippopotam call");
}
// 3. More Florida ZIPs resolve to the right area.
{
  const w = world({});
  const a = await w.F.geocodeAddress({ zip: "33543" });   // Wesley Chapel
  const b = await w.F.geocodeAddress({ zip: "33598" });   // Wimauma
  const c = await w.F.geocodeAddress({ zip: "33647-1234" }); // ZIP+4 cut to 5
  ok(a.located === "zip" && near(a.lat, 28.2, 0.1) && near(a.lon, -82.32, 0.1), "33543 Wesley Chapel resolves (" + a.lat + ", " + a.lon + ")");
  ok(b.located === "zip" && near(b.lat, 27.69, 0.1) && near(b.lon, -82.28, 0.1), "33598 Wimauma resolves (" + b.lat + ", " + b.lon + ")");
  ok(c.located === "zip" && near(c.lat, 28.15, 0.1), "ZIP+4 is cut to its first 5 digits");
  ok(w.calls.length === 0, "a bare ZIP with no street makes no outside call");
}
// 4. ZIP not in the bundled file -> zippopotam, one call, correct URL.
{
  const w = world({ zippo: zippoZip("27.2", "-80.3") });
  const g = await w.F.geocodeAddress({ street: "1 Invented Way", city: "Port St Lucie", state: "FL", zip: "34999" });
  ok(g.located === "zip" && g.lat === 27.2 && g.lon === -80.3, "ZIP missing from the file falls to the second source");
  ok(zippoCalls(w) === 1 && w.calls.indexOf("https://api.zippopotam.us/us/34999") >= 0, "second source: one call to /us/34999");
}
// 5. Town: Tampa, FL resolves with no outside call; unknown town returns null.
{
  const w = world({});
  const g = await w.F.geocodeAddress({ city: "Tampa", state: "FL" });
  ok(g.located === "town" && near(g.lat, 27.97, 0.1) && near(g.lon, -82.48, 0.1), "Tampa, FL -> located town (" + g.lat + ", " + g.lon + ")");
  ok(w.calls.length === 0, "town in the bundled file: no outside call");
  const w2 = world({});
  const n = await w2.F.geocodeAddress({ city: "Zzyzxville", state: "FL" });
  ok(n.lat === null && n.lon === null && n.located === null, "unknown town -> all null");
  ok(zippoCalls(w2) === 1 && w2.calls[0] === "https://api.zippopotam.us/us/fl/zzyzxville", "unknown town: one second-source call, URL built from state and city");
}
// 6. Town second source works when the file lacks it; far-apart results are refused.
{
  const places = (pts) => () => ({ ok: true, json: async () => ({ places: pts.map((p) => ({ latitude: String(p[0]), longitude: String(p[1]) })) }) });
  const w = world({ zippo: places([[28.0, -82.0], [28.1, -82.1]]) });
  const g = await w.F.geocodeAddress({ city: "Newtown Place", state: "FL" });
  ok(g.located === "town" && near(g.lat, 28.05, 0.001), "town second source averages nearby ZIP points");
  const w2 = world({ zippo: places([[28.0, -82.0], [30.5, -81.0]]) });
  const g2 = await w2.F.geocodeAddress({ city: "Newtown Place", state: "FL" });
  ok(g2.located === null, "town whose points are far apart is ambiguous -> null, never a guess");
}
// 7. Order: ZIP is tried before town.
{
  const w = world({});
  const g = await w.F.geocodeAddress({ street: "9 Invented St", city: "Tampa", state: "FL", zip: "33647" });
  ok(g.located === "zip", "ZIP is used before the town");
  const g2 = await w.F.geocodeAddress({ street: "9 Invented St", city: "Tampa", state: "FL", zip: "abcde" });
  ok(g2.located === "town", "an invalid ZIP is skipped and the town is used");
}
// 8. Every failure mode returns null, never throws.
{
  const bad = {
    "500": () => ({ ok: false, status: 500, json: async () => ({}) }),
    "bad JSON": () => ({ ok: true, json: async () => { throw new SyntaxError("bad json"); } }),
    "empty list": () => ({ ok: true, json: async () => ({ places: [] }) }),
    "no places key": () => ({ ok: true, json: async () => ({}) }),
    "non-numeric": () => ({ ok: true, json: async () => ({ places: [{ latitude: "x", longitude: "y" }] }) }),
    "network error": () => { throw new Error("network down"); }
  };
  for (const [name, fn] of Object.entries(bad)) {
    let g, threw = false;
    try { g = await world({ census: fn, zippo: fn }).F.geocodeAddress({ street: "1 A St", city: "Newtown Place", state: "FL", zip: "34999" }); } catch (e) { threw = true; }
    ok(!threw && g && g.lat === null && g.lon === null && g.located === null, "failure mode '" + name + "' -> null, no throw");
  }
  const hang = (u, opts) => new Promise((_, rej) => { opts && opts.signal && opts.signal.addEventListener("abort", () => rej(new Error("aborted"))); });
  const t0 = Date.now();
  let g, threw = false;
  try { g = await world({ census: () => ({ ok: true, json: async () => ({ result: { addressMatches: [] } }) }), zippo: hang }).F.geocodeAddress({ zip: "34999" }); } catch (e) { threw = true; }
  ok(!threw && g.located === null && Date.now() - t0 < 6000, "timeout on the second source -> null within " + (Date.now() - t0) + " ms");
}
// 9. Input safety: the second source URL is built only from validated parts.
{
  const w = world({});
  await w.F.geocodeAddress({ zip: "3364/../x" });
  await w.F.geocodeAddress({ city: "Tampa/../../evil", state: "FL" });
  await w.F.geocodeAddress({ city: "Tampa", state: "Florida" });
  await w.F.geocodeAddress({ city: "Tampa?x=1#", state: "F1" });
  ok(w.calls.length === 0, "malformed ZIP, city or state never reach an outside host");
  const w2 = world({});
  await w2.F.geocodeAddress({ city: "St. Petersburg", state: "fl" });
  await w2.F.geocodeAddress({ city: "Coeur d'Alene", state: "ID" });
  ok(w2.calls.every((c) => c.indexOf("https://api.zippopotam.us/us/") === 0), "only the allowed hosts are called");
}
// 10. The lookup writes nothing: no database access in any geocoder function.
{
  const src = FNS.map((n) => fnSrc(n)).join("\n");
  ok(!/\bDB\b|\.prepare\(|\.batch\(|\bINSERT\b|\bUPDATE\b/.test(src), "geocoder functions never touch the database");
  const mod = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  ok(/import ZIP_CENTERS_V1 from "\.\.\/data\/geo\/zip-centers-v1\.json"/.test(mod) && /import TOWN_CENTERS_V1 from "\.\.\/data\/geo\/town-centers-v1\.json"/.test(mod), "Worker imports both bundled data files");
}
// 11. Bundled file sanity.
{
  ok(ZIP_CENTERS_V1.rows.split(";").length > 33000, "ZIP file has more than 33,000 ZIPs");
  ok(TOWN_CENTERS_V1.rows.split(";").length > 30000, "town file has more than 30,000 towns");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
