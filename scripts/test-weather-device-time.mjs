// Weather follows the VIEWER'S DEVICE time zone, not Eastern and not the job
// site. The real Worker functions are cut out of worker/index.js; only the
// National Weather Service fetch (gmWeatherFetch) and the database are stubbed.
//
//   node scripts/test-weather-device-time.mjs
import { build, baseStubs, hasFn } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const NY = "America/New_York", LA = "America/Los_Angeles";
const HAVE_ZONE = hasFn("gmWeatherZone"), HAVE_WINDOW = hasFn("gmWeatherCalendarWindow");

// One hourly period per real hour, starting 2026-11-01T00:00Z, 72 hours.
// Rain is 80 percent from 06:00Z to 08:00Z, 0 elsewhere.
function makePeriods() {
  const out = [];
  const t0 = Date.parse("2026-11-01T00:00:00Z");
  for (let i = 0; i < 72; i++) {
    const iso = new Date(t0 + i * 3600000).toISOString().replace(".000Z", "Z");
    const raining = i >= 6 && i <= 8;
    out.push({ startTime: iso, temperature: 40 + i, shortForecast: raining ? "Rain" : "Cloudy", isDaytime: true, probabilityOfPrecipitation: { value: raining ? 80 : 0 } });
  }
  return out;
}
const PERIODS = makePeriods();

const FNS = ["gmWeatherRainWindow", "gmWeatherCondText", "gmWeatherPct", "gmWeatherHighLow", "gmWeatherDayVerdict", "getHourlyForecast"]
  .concat(HAVE_ZONE ? ["gmWeatherZone"] : [], HAVE_WINDOW ? ["gmWeatherCalendarWindow"] : [], hasFn("tzIsValid") ? ["tzIsValid"] : []);
const gmWeatherFetch = async (url) => {
  if (url.indexOf("/points/") >= 0) { return { ok: true, json: async () => ({ properties: { forecastHourly: "https://api.weather.gov/h" } }) }; }
  return { ok: true, json: async () => ({ properties: { periods: PERIODS } }) };
};
const F = build(FNS, ["GM_WEATHER_RAIN_PCT_THRESHOLD"], Object.assign({}, baseStubs, { gmWeatherFetch, APEX_TIMEZONE: NY }));
const at = (iso) => new Date(iso);
const labels = (list) => list.map((h) => h.time);

// 05:30Z on November 1 is 1:30 AM Eastern (already November 1) and 10:30 PM
// Pacific (still October 31).
const NOW = at("2026-11-01T05:30:00Z");

// 1. Same periods, same instant, different "today" per zone.
{
  const ny = await F.getHourlyForecast(28.1, -82.3, {}, NY, NOW);
  const la = await F.getHourlyForecast(28.1, -82.3, {}, LA, NOW);
  ok(ny && la, "both zones return a forecast");
  ok(ny.today[0].time === "01:00" && la.today[0].time === "22:00", "first hour is 01:00 in Eastern and 22:00 in Pacific (got " + ny.today[0].time + " and " + la.today[0].time + ")");
  ok(ny.today.length === 24 && la.today.length === 2, "Eastern today has 24 hours left, Pacific today has 2 (got " + ny.today.length + " and " + la.today.length + ")");
  ok(labels(la.today).join() === "22:00,23:00", "Pacific labels are 22:00,23:00 (got " + labels(la.today).join() + ")");
}

// 2. Rain window in the viewer's zone. Rain runs 06:00Z to 08:00Z.
{
  const ny = await F.getHourlyForecast(1, 2, {}, NY, NOW);
  const la = await F.getHourlyForecast(1, 2, {}, LA, NOW);
  ok(ny.today_rain_window && ny.today_rain_window.from === "01:00" && ny.today_rain_window.to === "03:00", "Eastern rain window 01:00 to 03:00 (got " + JSON.stringify(ny.today_rain_window) + ")");
  ok(la.today_rain_window && la.today_rain_window.from === "23:00" && la.today_rain_window.to === "23:00", "Pacific rain window 23:00 to 23:00 for today (got " + JSON.stringify(la.today_rain_window) + ")");
  ok(la.tomorrow_rain_window && la.tomorrow_rain_window.from === "00:00" && la.tomorrow_rain_window.to === "01:00", "Pacific tomorrow rain window 00:00 to 01:00 (got " + JSON.stringify(la.tomorrow_rain_window) + ")");
  const dv = await F.gmWeatherDayVerdict(1, 2, "2026-11-01", LA, NOW);
  ok(dv && dv.from === "00:00" && dv.to === "01:00", "Day verdict for Nov 1 in Pacific: rain 00:00 to 01:00 (got " + (dv && dv.from) + " to " + (dv && dv.to) + ")");
}

// 3. Clocks go back on 2026-11-01: Eastern at 2:00 AM EDT (06:00Z), Pacific at 2:00 AM PDT (09:00Z).
{
  const nyDay = await F.gmWeatherDayVerdict(1, 2, "2026-11-01", NY, NOW);
  const laDay = await F.gmWeatherDayVerdict(1, 2, "2026-11-01", LA, NOW);
  const expect25 = ["00:00", "01:00", "01:00"].concat(Array.from({ length: 22 }, (_, i) => String(i + 2).padStart(2, "0") + ":00"));
  ok(nyDay.hours.length === 25 && labels(nyDay.hours).join() === expect25.join(), "Eastern Nov 1 is a 25 hour day: 00, 01, 01, 02 ... 23, none lost (got " + nyDay.hours.length + " hours)");
  ok(laDay.hours.length === 25 && labels(laDay.hours).join() === expect25.join(), "Pacific Nov 1 is a 25 hour day: 00, 01, 01, 02 ... 23, none lost (got " + laDay.hours.length + " hours)");
  // Each real hour appears once: the temperatures in this fixture differ per hour.
  const temps = new Set(nyDay.hours.map((h) => h.temp_f));
  ok(temps.size === 25, "Eastern: every real hour appears exactly once (distinct temps " + temps.size + ")");

  // Standing inside the repeated hour: 06:30Z is the SECOND 1:30 AM Eastern (EST).
  const second = await F.getHourlyForecast(1, 2, {}, NY, at("2026-11-01T06:30:00Z"));
  ok(second.today.length === 23 && second.today[0].time === "01:00", "Eastern, second 1 AM: 23 hours left starting at the current hour, the past first 1 AM is not shown (got " + second.today.length + ")");
  // Pacific across its own change: 08:30Z is 1:30 AM PDT (first pass).
  const laFirst = await F.getHourlyForecast(1, 2, {}, LA, at("2026-11-01T08:30:00Z"));
  const laExpect = ["01:00", "01:00"].concat(Array.from({ length: 22 }, (_, i) => String(i + 2).padStart(2, "0") + ":00"));
  ok(laFirst.today.length === 24 && labels(laFirst.today).join() === laExpect.join(), "Pacific, first 1 AM: 24 hours left, 01:00 twice, then 02 ... 23 (got " + laFirst.today.length + ")");
}

// 4. Bad zones fall back to Eastern and never throw.
{
  const base = await F.getHourlyForecast(1, 2, {}, NY, NOW);
  const bad = ["Mars/Phobos", "", "x".repeat(80), "../x", 42, null, undefined, {}, "America/New York"];
  let allSame = true, threw = false;
  for (const tz of bad) {
    try {
      const r = await F.getHourlyForecast(1, 2, {}, tz, NOW);
      const d = await F.gmWeatherDayVerdict(1, 2, "2026-11-01", tz, NOW);
      if (!r || JSON.stringify(r) !== JSON.stringify(base) || !d || d.hours.length !== 25) { allSame = false; console.log("   differs for", JSON.stringify(tz)); }
    } catch (e) { threw = true; }
  }
  ok(!threw, "a bad zone never throws");
  ok(allSame, "every bad zone gives the Eastern answer");
  ok(HAVE_ZONE, "gmWeatherZone exists");
  if (HAVE_ZONE) {
    ok(bad.every((tz) => F.gmWeatherZone(tz) === NY), "gmWeatherZone returns America/New_York for every bad value");
    ok(F.gmWeatherZone(LA) === LA && F.gmWeatherZone("Pacific/Auckland") === "Pacific/Auckland" && F.gmWeatherZone("Etc/GMT+5") === "Etc/GMT+5", "gmWeatherZone accepts real IANA names, including plus and minus");
  }
}

// 5. Calendar window (today and 7 day horizon) follows the zone.
{
  ok(HAVE_WINDOW, "gmWeatherCalendarWindow exists");
  if (HAVE_WINDOW) {
    const ny = F.gmWeatherCalendarWindow(NY, NOW), la = F.gmWeatherCalendarWindow(LA, NOW), bad = F.gmWeatherCalendarWindow("Mars/Phobos", NOW);
    ok(ny.today === "2026-11-01" && ny.horizon === "2026-11-08", "Eastern: today 2026-11-01, horizon 2026-11-08 (got " + JSON.stringify(ny) + ")");
    ok(la.today === "2026-10-31" && la.horizon === "2026-11-07", "Pacific: today 2026-10-31, horizon 2026-11-07 (got " + JSON.stringify(la) + ")");
    ok(bad.today === ny.today && bad.horizon === ny.horizon, "bad zone: Eastern window");
  }
}

// 6. The routes: same auth as before, and the validated zone is what gets used.
{
  const ROUTE_FNS = ["handleGetGmJobWeather", "handleGetGmEvents"].concat(HAVE_ZONE ? ["gmWeatherZone", "tzIsValid"] : [], HAVE_WINDOW ? ["gmWeatherCalendarWindow"] : [],
    hasFn("gmWeatherRequestZone") ? ["gmWeatherRequestZone", "resolveRequestZone", "clientZoneFor", "tzZoneForState"] : []);
  const FIXED = Date.parse("2026-11-01T05:30:00Z");
  class FixedDate extends Date {
    constructor(...a) { if (a.length) { super(...a); } else { super(FIXED); } }
    static now() { return FIXED; }
  }
  const seen = { forecastTz: [], verdict: [] };
  function world(user, access) {
    const db = { prepare: () => ({ bind: () => ({ first: async () => ({ addr_lat: 28.1, addr_lon: -82.3, addr_located: "exact" }), all: async () => ({ results: [] }) }) }) };
    const stubs = Object.assign({}, baseStubs, {
      APEX_TIMEZONE: NY, Date: FixedDate,
      authenticate: async () => user,
      requireClientAccess: () => access,
      gmOwnedRow: async () => ({ id: "j1", lead_id: "l1" }),
      getHourlyForecast: async (lat, lon, env, tz) => { seen.forecastTz.push(tz); return { today: [], today_rain_window: null }; },
      gmWeatherVerdict: () => null, gmLocationApprox: () => false,
      gmStr: (v, n) => (v == null ? "" : String(v).slice(0, n)),
      gmDerivedJobEvents: async () => [
        { kind: "band", date: "2026-10-31", addr_lat: 1, addr_lon: 2 },
        { kind: "band", date: "2026-11-01", addr_lat: 1, addr_lon: 2 },
        { kind: "band", date: "2026-11-07", addr_lat: 1, addr_lon: 2 },
        { kind: "band", date: "2026-11-08", addr_lat: 1, addr_lon: 2 }
      ],
      gmDerivedLeadEvents: async () => [], gmClubInviteEvents: async () => [], gmApexMeetingEvents: async () => [],
      gmEventOut: (r) => r, effectiveSellerName: () => null, gmRedactEventsForSeller: (a) => a,
      gmWeatherDayVerdict: async (lat, lon, date, tz) => { seen.verdict.push(date + "@" + tz); return { rain: false }; }
    });
    return { F: build(ROUTE_FNS, hasFn("gmWeatherRequestZone") ? ["TZ_STATE_ZONES", "TZ_STATE_NAMES"] : [], stubs), env: { DB: db } };
  }
  const R = (qs) => ({ url: "https://x.test/api/clients/c1/gm/jobs/j1/weather" + qs, headers: { get: () => null } });

  const anon = world(null, true);
  ok((await anon.F.handleGetGmJobWeather("c1", "j1", R(""), anon.env)).status === 401, "job weather: not signed in is still 401");
  const wrong = world({ role: "client" }, false);
  ok((await wrong.F.handleGetGmJobWeather("c1", "j1", R(""), wrong.env)).status === 403, "job weather: no access to this client is still 403");
  const evAnon = world(null, true);
  ok((await evAnon.F.handleGetGmEvents("c1", R("?month=2026-11&tz=" + LA), evAnon.env)).status === 401, "calendar: not signed in is still 401");

  const w = world({ role: "developer" }, true);
  await w.F.handleGetGmJobWeather("c1", "j1", R("?tz=America%2FLos_Angeles"), w.env);
  await w.F.handleGetGmJobWeather("c1", "j1", R("?tz=Mars%2FPhobos"), w.env);
  await w.F.handleGetGmJobWeather("c1", "j1", R(""), w.env);
  ok(seen.forecastTz.join() === [LA, NY, NY].join(), "job weather route passes the validated zone: LA, then Eastern for a bad one and for none (got " + seen.forecastTz.join() + ")");

  seen.verdict.length = 0;
  const la = await w.F.handleGetGmEvents("c1", R("?month=2026-11&tz=America%2FLos_Angeles"), w.env);
  ok(la.status === 200, "calendar answers 200 with a tz");
  ok(seen.verdict.sort().join() === ["2026-10-31@" + LA, "2026-11-01@" + LA, "2026-11-07@" + LA].join(),
    "calendar, Pacific: today is Oct 31 and horizon is Nov 7, so Oct 31, Nov 1 and Nov 7 are asked, Nov 8 is not (got " + seen.verdict.join() + ")");
  seen.verdict.length = 0;
  await w.F.handleGetGmEvents("c1", R("?month=2026-11&tz=nope%2Fzone"), w.env);
  ok(seen.verdict.sort().join() === ["2026-11-01@" + NY, "2026-11-07@" + NY, "2026-11-08@" + NY].join(),
    "calendar, bad tz: Eastern window (today Nov 1, horizon Nov 8) (got " + seen.verdict.join() + ")");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
