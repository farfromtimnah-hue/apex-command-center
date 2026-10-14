// Builds data/places/cities/<STATE-CODE>.json — one compact JSON array of
// city/place names per US state + DC and per Brazilian state, for the State +
// City controls on the client overview and create forms (job
// 2026-10-14_client_owners_state_city).
//
//   node scripts/build-city-lists.mjs
//
// Sources (NEVER written from memory — if either is unreachable, this script
// stops and prints an error; nothing partial is left for a state that failed
// mid-run on a previous attempt, since each state's file is only written
// after that state's full source list is parsed):
//
//   US: the U.S. Census Bureau Gazetteer national places file, latest year
//       found on census.gov (2025 at the time this was written). Keeps
//       incorporated places and Census Designated Places (CDPs); strips the
//       legal suffix (" city", " town", " village", " borough",
//       " municipality", " CDP", " (balance)") from each name; de-duplicates
//       within a state.
//   BR: IBGE's municipios API, one call per state:
//       https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios
//
// Output: data/places/cities/US-FL.json, data/places/cities/BR-MG.json, etc,
// sorted, deduplicated, no legal suffix, as a flat array of strings.
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "data", "places", "cities");
mkdirSync(OUT_DIR, { recursive: true });

var US_STATES = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["DC","District of Columbia"],
  ["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],
  ["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],
  ["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],
  ["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],
  ["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],
  ["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],
  ["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],
  ["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],
  ["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"]
];
var BR_STATES = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI",
  "RJ","RN","RS","RO","RR","SC","SP","SE","TO"
];

var SUFFIX_RE = /\s+(city|town|village|borough|municipality|CDP)$/i;
var BALANCE_RE = /\s+\(balance\)$/i;

function stripSuffix(name) {
  var n = name.replace(BALANCE_RE, "");
  n = n.replace(SUFFIX_RE, "");
  return n.trim();
}

async function fetchText(url) {
  var res = await fetch(url);
  if (!res.ok) { throw new Error("fetch failed " + res.status + " for " + url); }
  return res.text();
}
async function fetchJson(url) {
  var res = await fetch(url);
  if (!res.ok) { throw new Error("fetch failed " + res.status + " for " + url); }
  return res.json();
}

async function buildUS() {
  console.log("Downloading US Census Gazetteer national places file (2025)...");
  var url = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip";
  var res = await fetch(url);
  if (!res.ok) { throw new Error("Census Gazetteer national zip fetch failed: " + res.status); }
  var buf = Buffer.from(await res.arrayBuffer());
  // Minimal zip reader (no deps): the national file is a single-entry zip
  // with the .txt right inside. Use Node's zlib to inflate the raw deflate
  // stream rather than pull in a zip library.
  var txt = await unzipSingleEntryText(buf);
  var lines = txt.split("\n");
  var header = lines[0].split("|");
  var iUSPS = header.indexOf("USPS");
  var iNAME = header.indexOf("NAME");
  if (iUSPS < 0 || iNAME < 0) { throw new Error("unexpected Gazetteer header: " + lines[0]); }
  var byState = {};
  for (var i = 1; i < lines.length; i++) {
    var line = lines[i];
    if (!line || !line.trim()) { continue; }
    var cols = line.split("|");
    var usps = (cols[iUSPS] || "").trim();
    var name = (cols[iNAME] || "").trim();
    if (!usps || !name) { continue; }
    var clean = stripSuffix(name);
    if (!clean) { continue; }
    if (!byState[usps]) { byState[usps] = new Set(); }
    byState[usps].add(clean);
  }
  var written = [];
  US_STATES.forEach(function(pair) {
    var usps = pair[0];
    var set = byState[usps] || new Set();
    var arr = Array.from(set).sort(function(a, b) { return a.localeCompare(b); });
    var file = path.join(OUT_DIR, "US-" + usps + ".json");
    writeFileSync(file, JSON.stringify(arr));
    written.push({ code: "US-" + usps, count: arr.length, bytes: Buffer.byteLength(JSON.stringify(arr)) });
  });
  return written;
}

// Raw DEFLATE unzip for a single-file zip, using Node's zlib (no 3rd-party
// dependency). Reads the local file header at offset 0.
async function unzipSingleEntryText(buf) {
  var zlib = await import("zlib");
  // Local file header signature 0x04034b50
  if (buf.readUInt32LE(0) !== 0x04034b50) { throw new Error("not a zip (or unsupported zip layout)"); }
  var method = buf.readUInt16LE(8);
  var compSize = buf.readUInt32LE(18);
  var nameLen = buf.readUInt16LE(26);
  var extraLen = buf.readUInt16LE(28);
  var dataStart = 30 + nameLen + extraLen;
  var compData = buf.slice(dataStart, dataStart + compSize);
  if (method === 0) { return compData.toString("utf8"); }
  if (method === 8) { return zlib.inflateRawSync(compData).toString("utf8"); }
  throw new Error("unsupported zip compression method " + method);
}

async function buildBR() {
  console.log("Downloading IBGE municipios per state...");
  var written = [];
  for (var i = 0; i < BR_STATES.length; i++) {
    var uf = BR_STATES[i];
    var url = "https://servicodados.ibge.gov.br/api/v1/localidades/estados/" + uf + "/municipios";
    var data = await fetchJson(url);
    if (!Array.isArray(data) || !data.length) { throw new Error("IBGE returned no municipios for " + uf); }
    var names = Array.from(new Set(data.map(function(m) { return String(m.nome || "").trim(); }).filter(Boolean)));
    names.sort(function(a, b) { return a.localeCompare(b, "pt-BR"); });
    var file = path.join(OUT_DIR, "BR-" + uf + ".json");
    writeFileSync(file, JSON.stringify(names));
    written.push({ code: "BR-" + uf, count: names.length, bytes: Buffer.byteLength(JSON.stringify(names)) });
  }
  return written;
}

async function main() {
  var all = [];
  try {
    var us = await buildUS();
    all = all.concat(us);
  } catch (e) {
    console.error("STOP: US Census source failed: " + (e && e.message));
    process.exit(1);
  }
  try {
    var br = await buildBR();
    all = all.concat(br);
  } catch (e) {
    console.error("STOP: IBGE source failed: " + (e && e.message));
    process.exit(1);
  }
  var totalBytes = all.reduce(function(t, x) { return t + x.bytes; }, 0);
  var largest = all.slice().sort(function(a, b) { return b.bytes - a.bytes; })[0];
  console.log("Wrote " + all.length + " city list files, total " + totalBytes + " bytes.");
  console.log("Largest: " + largest.code + " (" + largest.count + " cities, " + largest.bytes + " bytes)");
}

main();
