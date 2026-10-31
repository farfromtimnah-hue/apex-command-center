// Weather tiles (Apple Weather look): hourly data from the Worker, icon and sky
// choice, 12-hour text, high and low, tile open state, bundled sky photos.
// Real functions are cut out of worker/index.js and gm.js; fetch is stubbed.
//
//   node scripts/test-weather-hourly-icons.mjs
import { readFileSync, existsSync, statSync } from "node:fs";
import { build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };
const gmSrc = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
const cssSrc = readFileSync(new URL("../gm.css", import.meta.url), "utf8");

// ── Worker: hours, high_f, low_f ────────────────────────────────────────────
const W_FNS = ["gmWeatherRainWindow", "gmWeatherCondText", "gmWeatherPct", "gmWeatherHighLow", "gmWeatherDayVerdict", "getHourlyForecast", "gmWeatherVerdict"];
function period(iso, temp, cond, day, pct) {
  return { startTime: iso, temperature: temp, shortForecast: cond, isDaytime: day, probabilityOfPrecipitation: { value: pct } };
}
function workerWorld(periods, opts) {
  opts = opts || {};
  const calls = [];
  const gmWeatherFetch = async (url) => {
    calls.push(url);
    if (url.indexOf("/points/") >= 0) { return { ok: true, json: async () => ({ properties: { forecastHourly: "https://api.weather.gov/gridpoints/TBW/1,1/forecast/hourly" } }) }; }
    if (opts.fail) { return { ok: false, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ properties: { periods } }) };
  };
  const F = build(W_FNS, ["GM_WEATHER_RAIN_PCT_THRESHOLD"], Object.assign({}, baseStubs, { gmWeatherFetch, APEX_TIMEZONE: "America/New_York" }));
  return { F, calls };
}
const day3 = [
  period("2026-11-03T06:00:00-05:00", 71.4, "Mostly Clear", true, 0),
  period("2026-11-03T12:00:00-05:00", 88.6, "Showers And Thunderstorms", true, 62.4),
  period("2026-11-03T13:00:00-05:00", 90, "  Partly Sunny  ", true, 45),
  period("2026-11-03T22:00:00-05:00", 74, "Clear", false, null),
  period("2026-11-04T01:00:00-05:00", 60, "Clear", false, 5)
];
{
  const w = workerWorld(day3);
  const v = await w.F.gmWeatherDayVerdict(28.1, -82.3, "2026-11-03");
  ok(v && v.rain === true && v.from === "12:00" && v.to === "13:00", "rain window keeps its shape (rain, from, to)");
  ok(v.hours.length === 4, "one entry per hour of that date only (4, not the next day's)");
  const h = v.hours[1];
  ok(h.time === "12:00" && h.temp_f === 88.6 && h.condition === "Showers And Thunderstorms" && h.is_day === true && h.rain_pct === 62, "hour entry: time, temp_f, condition, is_day, rain_pct rounded to a whole number");
  ok(v.hours[2].condition === "Partly Sunny", "condition text is trimmed");
  ok(v.hours[3].is_day === false && v.hours[3].rain_pct === 0, "night hour: is_day false, missing rain chance is 0");
  ok(v.high_f === 91 || v.high_f === 90, "high_f is a whole number (got " + v.high_f + ")");
  ok(v.high_f === 90 && v.low_f === 71, "high_f 90 and low_f 71 from the hours of that date (got " + v.high_f + " and " + v.low_f + ")");
  ok(JSON.stringify(v).indexOf("28.1") < 0 && JSON.stringify(v).indexOf("-82.3") < 0, "no coordinates in the response");
  ok(w.calls.length === 2, "no new outside call (points + hourly only)");
}
{
  const long = "x".repeat(100);
  const w = workerWorld([period("2026-11-03T12:00:00-05:00", 80, long, true, 10), period("2026-11-03T13:00:00-05:00", 80, "", true, 150), period("2026-11-03T14:00:00-05:00", 80, null, true, -5)]);
  const v = await w.F.gmWeatherDayVerdict(1, 2, "2026-11-03");
  ok(v.hours[0].condition.length <= 60, "condition longer than 60 characters is cut to 60");
  ok(v.hours[1].condition === null && v.hours[2].condition === null, "empty or missing condition is null");
  ok(v.hours[1].rain_pct === 100 && v.hours[2].rain_pct === 0, "rain_pct is held between 0 and 100");
}
{
  const w = workerWorld([period("2026-11-03T12:00:00-05:00", 77.5, "Sunny", true, 0)]);
  const v = await w.F.gmWeatherDayVerdict(1, 2, "2026-11-03");
  ok(v.high_f === 78 && v.low_f === 78, "one hour only: high and low are the same, rounded");
  const w2 = workerWorld([{ startTime: "2026-11-03T12:00:00-05:00", shortForecast: "Sunny", isDaytime: true }]);
  const v2 = await w2.F.gmWeatherDayVerdict(1, 2, "2026-11-03");
  ok(v2.hours[0].temp_f === null && v2.high_f === null && v2.low_f === null, "no temperature in any hour: temp_f, high_f and low_f are null");
  const w3 = workerWorld(day3);
  ok(await w3.F.gmWeatherDayVerdict(1, 2, "2026-12-25") === null, "date with no forecast still returns null");
  ok(await workerWorld(day3, { fail: true }).F.gmWeatherDayVerdict(1, 2, "2026-11-03") === null, "forecast fetch failure still returns null");
}
{
  const now = new Date();
  const hr = (d) => { const x = new Date(now.getTime() + d * 3600000); return x.toISOString(); };
  const w = workerWorld([period(hr(0), 80, "Cloudy", true, 10), period(hr(1), 70, "Clear", false, 20)]);
  const f = await w.F.getHourlyForecast(1, 2, {});
  ok(f && f.today.length >= 1 && "temp_f" in f.today[0] && "condition" in f.today[0] && "is_day" in f.today[0], "project card hours carry temp_f, condition and is_day");
  ok(f.high_f !== undefined && f.low_f !== undefined && f.today.every((h) => h.temp_f >= f.low_f && h.temp_f <= f.high_f), "project card has high_f and low_f for the remaining hours of today");
  ok(f.today_rain_window === null || typeof f.today_rain_window === "object", "project card keeps today_rain_window");
}

// ── Client: pure functions cut out of gm.js ─────────────────────────────────
let EN = false;
const C_FNS = ["gmWeatherClock", "gmWeatherIconName", "gmWeatherSkyName", "gmWeatherIconLabel", "gmWeatherIconHtml", "gmWeatherRepHour", "gmWeatherTileSky",
  "gmWeatherHourLabel", "gmWeatherRangeText", "gmWeatherHighLowText", "gmWeatherHighLowHtml", "gmWeatherCardTitle", "gmWeatherTileKey", "gmWeatherTileToggle",
  "gmWeatherTileIsOpen", "gmWeatherHoursButtonHtml", "gmWeatherApproxHtml", "gmWeatherCellsHtml", "gmWeatherOpenTileHtml", "gmWeatherClosedTileHtml", "gmWeatherNoForecastTileHtml", "gmWeatherDayCardHtml", "gmWeatherJobCardHtml"];
const C_VARS = ["GM_WEATHER_ICON_LABELS", "GM_WEATHER_RAIN_PCT_FRONTEND_THRESHOLD", "gmWeatherTileOpen"];
const C = build(C_FNS, C_VARS, {
  gmT: (pt, en) => (EN ? en : pt),
  isEn: () => EN,
  escHtml: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  gmIcon: (n) => "<svg data-icon=\"" + n + "\"></svg>"
}, gmSrc);

// Icon names
const icon = (c, d, p) => C.gmWeatherIconName(c, d, p);
const iconCases = [
  ["Showers And Thunderstorms", true, 90, "storm"], ["Slight Chance Thunderstorms", false, 10, "storm"], ["Rain", true, 0, "rain"], ["Light Drizzle", true, 0, "rain"], ["Chance Rain Showers", true, 0, "rain"],
  ["Snow", true, 0, "snow"], ["Sleet", true, 0, "snow"], ["Flurries", true, 0, "snow"], ["Freezing Rain", true, 0, "rain"], ["Ice Pellets", true, 0, "snow"],
  ["Patchy Fog", true, 0, "fog"], ["Haze", true, 0, "fog"], ["Mist", false, 0, "fog"], ["Smoke", true, 0, "fog"],
  ["Mostly Cloudy", true, 0, "cloud"], ["Overcast", false, 0, "cloud"], ["Cloudy", true, 0, "cloud"],
  ["Partly Cloudy", true, 0, "partly-cloudy"], ["Partly Sunny", true, 0, "partly-cloudy"], ["Mostly Sunny", true, 0, "partly-cloudy"], ["Mostly Clear", false, 0, "partly-cloudy"], ["A Few Clouds", true, 0, "partly-cloudy"],
  ["Sunny", true, 0, "sun"], ["Clear", true, 0, "sun"], ["Clear", false, 0, "moon"], ["SUNNY", true, 0, "sun"],
  [null, true, 50, "rain"], [null, true, 49, "cloud"], ["", false, 80, "rain"], ["Blowing Dust Bananas", true, 10, "cloud"], ["Blowing Dust Bananas", true, 70, "rain"]
];
iconCases.forEach(([c, d, p, want]) => ok(icon(c, d, p) === want, "icon: " + JSON.stringify(c) + (d ? " day " : " night ") + p + "% -> " + want + " (got " + icon(c, d, p) + ")"));

// Sky names
const sky = (c, d, p) => C.gmWeatherSkyName(c, d, p);
const skyCases = [
  ["Showers And Thunderstorms", true, 90, "thunder"], ["Thunderstorms", false, 0, "thunder"], ["Rain", true, 0, "rain"], ["Drizzle", false, 0, "rain"],
  ["Snow", true, 0, "cloudy"], ["Sleet", true, 0, "cloudy"], ["Fog", true, 0, "fog"], ["Haze", false, 0, "fog"], ["Smoke", true, 0, "fog"],
  ["Sunny", true, 0, "sunny"], ["Clear", true, 0, "sunny"], ["Partly Sunny", true, 0, "partly-cloudy"], ["Mostly Sunny", true, 0, "partly-cloudy"], ["Partly Cloudy", true, 0, "partly-cloudy"], ["A Few Clouds", true, 0, "partly-cloudy"],
  ["Mostly Cloudy", true, 0, "cloudy"], ["Overcast", true, 0, "cloudy"], ["Cloudy", true, 0, "cloudy"],
  ["Clear", false, 0, "clear-night"], ["Mostly Clear", false, 0, "clear-night"], ["Partly Cloudy", false, 0, "cloudy-night"], ["Mostly Cloudy", false, 0, "cloudy-night"], ["Overcast", false, 0, "cloudy-night"], ["Cloudy", false, 0, "cloudy-night"],
  [null, true, 0, "cloudy"], [null, false, 0, "cloudy-night"], ["Odd Words", true, 0, "cloudy"], ["Odd Words", false, 0, "cloudy-night"], [null, true, 60, "rain"], [null, true, 59, "cloudy"]
];
skyCases.forEach(([c, d, p, want]) => ok(sky(c, d, p) === want, "sky: " + JSON.stringify(c) + (d ? " day " : " night ") + p + "% -> " + want + " (got " + sky(c, d, p) + ")"));

// Representative hour and rain override
const hrs = [{ time: "09:00", condition: "Sunny", is_day: true }, { time: "11:00", condition: "Cloudy", is_day: true }, { time: "14:00", condition: "Rain", is_day: true }];
ok(C.gmWeatherRepHour(hrs, true).time === "09:00", "today: the representative hour is the first hour (now)");
ok(C.gmWeatherRepHour(hrs, false).time === "11:00", "another date: the hour closest to 12:00 (11:00 here)");
ok(C.gmWeatherRepHour([{ time: "12:00" }, { time: "13:00" }], false).time === "12:00", "another date: the 12:00 hour when present");
ok(C.gmWeatherRepHour([], true) === null, "no hours: no representative hour");
ok(C.gmWeatherTileSky({ condition: "Cloudy", is_day: true, rain_pct: 10 }, { rain: true }) === "rain", "verdict says rain and the hour is cloudy: the tile uses the rain photo");
ok(C.gmWeatherTileSky({ condition: "Thunderstorms", is_day: true, rain_pct: 10 }, { rain: true }) === "thunder", "verdict says rain and the hour is thunder: stays thunder");
ok(C.gmWeatherTileSky({ condition: "Cloudy", is_day: true, rain_pct: 10 }, { rain: false }) === "cloudy", "no rain verdict: sky from the hour");

// 12-hour text everywhere
EN = false;
ok(C.gmWeatherHourLabel("00:00", 3, true) === "12 AM" && C.gmWeatherHourLabel("12:00", 3, true) === "12 PM" && C.gmWeatherHourLabel("14:00", 3, true) === "2 PM" && C.gmWeatherHourLabel("11:00", 3, false) === "11 AM", "hour labels are 12-hour (12 AM, 12 PM, 2 PM, 11 AM)");
ok(C.gmWeatherHourLabel("14:00", 0, true) === "Agora", "first cell of today in Portuguese: Agora");
ok(C.gmWeatherHourLabel("14:00", 0, false) === "2 PM", "first cell of another date is a time, not Agora");
EN = true;
ok(C.gmWeatherHourLabel("14:00", 0, true) === "Now", "first cell of today in English: Now");
ok(C.gmWeatherRangeText("12:00", "23:00") === "12 PM to 11 PM", "range in English: 12 PM to 11 PM");
EN = false;
ok(C.gmWeatherRangeText("12:00", "23:00") === "12 PM a 11 PM", "range in Portuguese: 12 PM a 11 PM");
ok(C.gmWeatherRangeText("12:00", "23:00").indexOf("–") < 0 && C.gmWeatherRangeText("12:00", "23:00").indexOf("—") < 0, "no dash in a printed range");

// High and low text and the bold rule
EN = true;
ok(C.gmWeatherHighLowText(88, 74) === "High 88° Low 74°", "English: High 88° Low 74°");
EN = false;
ok(C.gmWeatherHighLowText(88, 74) === "Máx 88° Mín 74°", "Portuguese: Máx 88° Mín 74°");
ok(/gm-wx-hot/.test(C.gmWeatherHighLowHtml(90, 74)) && /gm-wx-hot/.test(C.gmWeatherHighLowHtml(95, 80)), "high of 90 or more is marked bold");
ok(!/gm-wx-hot/.test(C.gmWeatherHighLowHtml(89, 74)), "high of 89 is not bold");
ok(C.gmWeatherHighLowHtml(null, null) === "", "no high or low: nothing is printed");
ok(!/(\d)\s*(alert|warning|aviso)/i.test(C.gmWeatherHighLowHtml(99, 80)), "no warning text with a high temperature");

// Card title: today versus another date
EN = true;
ok(C.gmWeatherCardTitle("2026-11-01", "2026-11-01") === "Rain by site today", "title today in English");
ok(C.gmWeatherCardTitle("2026-11-02", "2026-11-01") === "Rain by site", "title another date in English, no word today");
EN = false;
ok(C.gmWeatherCardTitle("2026-11-01", "2026-11-01") === "Chuva por obra hoje" && C.gmWeatherCardTitle("2026-11-02", "2026-11-01") === "Chuva por obra", "titles in Portuguese");

// Accessible icon names are fixed, never the raw text
ok(C.gmWeatherIconLabel("rain") === "Chuva" && C.gmWeatherIconLabel("moon") === "Noite limpa" && C.gmWeatherIconLabel("partly-cloudy") === "Parcialmente nublado", "icon labels in Portuguese");
EN = true;
ok(C.gmWeatherIconLabel("storm") === "Storm" && C.gmWeatherIconLabel("fog") === "Fog" && C.gmWeatherIconLabel("snow") === "Snow" && C.gmWeatherIconLabel("sun") === "Sunny" && C.gmWeatherIconLabel("cloud") === "Cloudy", "icon labels in English");
ok(/aria-label="Rain"/.test(C.gmWeatherIconHtml("rain")) && /role="img"/.test(C.gmWeatherIconHtml("rain")), "icon has role img and an aria-label");

// Tile rendering
const hours24 = [];
for (let i = 9; i <= 20; i++) { hours24.push({ time: (i < 10 ? "0" : "") + i + ":00", temp_f: 80 + (i % 3), condition: i >= 13 ? "Showers And Thunderstorms" : "Sunny", is_day: i < 19, rain_pct: i === 10 ? 5 : (i >= 13 ? 60 : 0) }); }
const verdict = { rain: true, from: "13:00", to: "18:00", hours: hours24, high_f: 91, low_f: 74 };
const ev = { kind: "band", date: "2026-11-01", title: "Whitfield <b>x</b>", rain_verdict: verdict, approx_location: true };
const evNo = { kind: "band", date: "2026-11-01", title: "No data site", rain_verdict: null };
const evEmpty = { kind: "band", date: "2026-11-01", title: "Empty site", rain_verdict: { rain: false, hours: [], high_f: null, low_f: null } };
EN = true;
const closed = C.gmWeatherDayCardHtml("2026-11-01", [ev, evNo, evEmpty], "2026-11-01");
ok(/Rain by site today/.test(closed), "card title today");
ok(/gm-wx-sky-rain/.test(closed), "collapsed tile: first hour is sunny but the verdict says rain, so the tile uses the rain photo");
ok(/aria-expanded="false"/.test(closed) && /aria-label="Show hours"/.test(closed) && />Hours</.test(closed), "collapsed tile has the Hours button, aria-expanded false, accessible name Show hours");
ok(/High 91°/.test(closed) && /gm-wx-hot/.test(closed), "collapsed tile shows the high and low, bold at 90 and above");
ok(/Rain 1 PM to 6 PM/.test(closed), "collapsed tile rain text uses 12-hour times and the word to");
ok(/Approximate location/.test(closed), "collapsed tile shows the approximate location note");
ok(/Whitfield &lt;b&gt;x&lt;\/b&gt;/.test(closed) && closed.indexOf("<b>x</b>") < 0, "site name is escaped");
ok(/No forecast/.test(closed) && /gm-wx-none/.test(closed), "site with no forecast: plain tile with No forecast");
const noneTile = closed.split("gm-wx-none")[1].split("</div></div>")[0];
ok(noneTile.indexOf("<button") < 0 && noneTile.indexOf("<svg") < 0, "no forecast tile has no button and no icon");
ok(closed.indexOf("Empty site") > 0, "site with an empty hours list still renders");
ok(closed.split("gm-wx-none").length - 1 === 2 && closed.split("<button").length - 1 === 1, "empty hours list renders as a no forecast tile: only one Hours button in the card");
// Open state survives re-render and keys by title plus date
const key = C.gmWeatherTileKey(ev.title, "2026-11-01");
ok(C.gmWeatherTileIsOpen(key) === false, "tile starts closed");
C.gmWeatherTileToggle(key);
const open = C.gmWeatherDayCardHtml("2026-11-01", [ev, evNo], "2026-11-01");
ok(C.gmWeatherTileIsOpen(key) === true && /aria-expanded="true"/.test(open) && /aria-label="Hide hours"/.test(open), "opened tile stays open on a re-render");
ok(/Hourly forecast/.test(open) && /gm-wx-glass/.test(open) && /gm-wx-strip/.test(open), "open tile has the Hourly forecast glass panel and strip");
ok(/>Now</.test(open) && /1 PM/.test(open) && /8 PM/.test(open) && !/\b1[3-9]:00|\b2[0-3]:00/.test(open), "open tile: Now first, 12-hour times, no 24-hour text");
const cells = open.split("gm-wx-cell").length - 1;
ok(cells >= hours24.length, "one cell per hour (" + cells + ")");
const pctCount = (open.match(/\d+%/g) || []).length;
ok(pctCount >= hours24.length, "rain percentage shown for every hour, not only the rainy ones (" + pctCount + ")");
ok(/>5%</.test(open) && />0%</.test(open), "dry hours show 5% and 0%");
ok(/gm-wx-rain-on/.test(open), "rain chance at or above 40 is marked");
ok(/tabindex="0"/.test(open) && /role="group"/.test(open), "strip is focusable and labeled");
ok(/gm-wx-big">\d+°</.test(open), "open tile has the big temperature");
ok(/gm-wx-cond">[^]*?<span>(Rain|Storm)<\/span>/.test(open), "open tile shows the condition from the fixed names (Rain or Storm)");
ok(open.indexOf("Showers And Thunderstorms") < 0 && open.indexOf("Sunny</") < 0, "raw outside condition text is never printed");
C.gmWeatherTileToggle(key);
ok(C.gmWeatherTileIsOpen(key) === false, "toggle closes it again");
const otherDay = C.gmWeatherDayCardHtml("2026-11-02", [Object.assign({}, ev, { date: "2026-11-02" })], "2026-11-01");
ok(/Rain by site</.test(otherDay) && C.gmWeatherTileIsOpen(C.gmWeatherTileKey(ev.title, "2026-11-02")) === false, "another date: title without today, its own open state");
ok(C.gmWeatherTileKey("A", "2026-11-01") !== C.gmWeatherTileKey("A", "2026-11-02"), "tile key depends on the date");

// Project card
const forecast = { today: hours24, today_rain_window: { from: "13:00", to: "18:00" }, tomorrow_rain_window: { from: "09:00", to: "14:00" }, high_f: 91, low_f: 74 };
const jc = C.gmWeatherJobCardHtml(forecast, true);
ok(/gm-wx-open/.test(jc) && jc.indexOf("<button") < 0, "project card is the open tile with no Hours button");
ok(/Rain likely 1 PM to 6 PM/.test(jc) && /Tomorrow: rain likely 9 AM to 2 PM/.test(jc), "project card: rain line and tomorrow line in 12-hour with the word to");
ok(/Approximate location/.test(jc) && /High 91°/.test(jc) && />Now</.test(jc), "project card: approximate note, high and low, Now first cell");
ok(!/–/.test(jc), "project card has no en dash");
const jcDry = C.gmWeatherJobCardHtml({ today: hours24, today_rain_window: null, tomorrow_rain_window: null, high_f: 91, low_f: 74 }, false);
ok(/No rain today/.test(jcDry) && /No rain expected|no rain expected|Tomorrow: no rain/.test(jcDry) && !/Approximate/.test(jcDry), "project card dry: No rain today, no approximate note");

// No outside photo, no popups, no 24-hour in new code
ok(!/pexels|unsplash/i.test(gmSrc + cssSrc) && !/https?:\/\/[^"' )]*\.(jpe?g|png|webp)/i.test(gmSrc + cssSrc), "no outside photo address in gm.js or gm.css");
const wxCode = gmSrc.slice(gmSrc.indexOf("var GM_WEATHER_ICON_LABELS"), gmSrc.indexOf("function gmLoadJobPhotos"));
ok(!/\balert\(|\bconfirm\(|\bprompt\(/.test(wxCode), "no browser pop-ups in the weather code");
ok(!/\b(const|let)\s/.test(wxCode) && !/=>/.test(wxCode), "weather code uses var and regular functions");
ok(!/transition|animation|@keyframes/.test(cssSrc.slice(cssSrc.indexOf("/* Weather tile"), cssSrc.indexOf("/* End weather tile"))), "no animation in the weather tile CSS");

// Sky photos
const SKIES = ["sunny", "partly-cloudy", "cloudy", "rain", "thunder", "fog", "clear-night", "cloudy-night"];
SKIES.forEach((s) => {
  const u = new URL("../assets/weather/" + s + ".jpg", import.meta.url);
  ok(existsSync(u) && statSync(u).size <= 90 * 1024 && statSync(u).size > 1000, "assets/weather/" + s + ".jpg exists and is at most 90 KB");
  ok(new RegExp("gm-wx-sky-" + s + "[^}]*assets/weather/" + s + "\\.jpg").test(cssSrc), "gm.css maps gm-wx-sky-" + s + " to its file");
});
ok(existsSync(new URL("../assets/weather/sources.txt", import.meta.url)), "assets/weather/sources.txt exists");
const seen = new Set();
[["Showers And Thunderstorms", true], ["Rain", true], ["Snow", true], ["Fog", true], ["Sunny", true], ["Partly Cloudy", true], ["Cloudy", true], ["Clear", false], ["Cloudy", false]].forEach(([c, d]) => seen.add(sky(c, d, 0)));
ok([...seen].every((s) => SKIES.indexOf(s) >= 0 && existsSync(new URL("../assets/weather/" + s + ".jpg", import.meta.url))), "every sky name the function returns has a file");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
