// The weather card and "Rain by site today" say so when the pin is a ZIP or
// town center (addr_located zip/town) rather than the street.
//
//   node scripts/test-weather-approx-location.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

// Worker: the weather route says whether the location is approximate.
{
  const row = {};
  const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => row.lead }) }) } };
  const F = build(["handleGetGmJobWeather", "gmLocationApprox"], [], Object.assign({}, baseStubs, {
    requireClientAccess: () => true,
    gmOwnedRow: async () => ({ id: "j1", lead_id: "l1" }),
    getHourlyForecast: async () => ({ today: [], today_rain_window: null }),
    gmWeatherVerdict: () => ({ rain: false })
  }));
  for (const [located, want] of [["exact", false], ["zip", true], ["town", true], [null, false]]) {
    row.lead = { addr_lat: 28.1, addr_lon: -82.3, addr_located: located };
    const r = await F.handleGetGmJobWeather("c1", "j1", {}, env);
    ok(r.status === 200 && r.data.approx_location === want, "weather route: addr_located " + located + " -> approx_location " + want);
  }
}

// Worker: the calendar band carries the same flag, from the same helper.
{
  const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  ok(/l\.addr_located FROM gm_jobs j/.test(src) && /approx_location: gmLocationApprox\(j\.addr_located\)/.test(src), "calendar band events carry approx_location from the job's lead");
}

// Screen: both views show the bilingual note, escaped, in existing styles.
{
  const gm = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
  ok(/d\.approx_location/.test(gm) && /Local aproximado/.test(gm) && /Approximate location/.test(gm), "weather card shows the note in Portuguese and English");
  ok(/ev\.approx_location/.test(gm), "Rain by site today shows the note for approximate sites");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
