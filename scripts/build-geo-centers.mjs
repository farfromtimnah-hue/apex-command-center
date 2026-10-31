// Builds data/geo/zip-centers-v1.json and data/geo/town-centers-v1.json from the
// US Census Gazetteer files (public domain). Usage:
//   node scripts/build-geo-centers.mjs <zcta.txt> <place.txt>
import { readFileSync, writeFileSync } from "node:fs";

const [zctaPath, placePath] = process.argv.slice(2);
const rows = (p) => readFileSync(p, "utf8").split("\n").slice(1).map((l) => l.split("\t").map((s) => s.trim())).filter((r) => r.length > 5);

// "33647,28.1519,-82.3182;..." -- one string, parsed lazily by the Worker.
const zips = rows(zctaPath).map((r) => {
  const lat = Number(r[r.length - 2]), lon = Number(r[r.length - 1]);
  return /^\d{5}$/.test(r[0]) && isFinite(lat) && isFinite(lon) ? [r[0], lat.toFixed(4), lon.toFixed(4)].join(",") : null;
}).filter(Boolean);

// Place names lose their legal suffix ("Tampa city" -> "tampa"). A state+name pair
// that appears twice is dropped: ambiguous means no coordinates, never a guess.
const SUFFIX = /\s+(city|town|village|borough|municipality|CDP|city and borough|urban county|consolidated government|metropolitan government|unified government|metro government|\(balance\))$/i;
const seen = new Map();
rows(placePath).forEach((r) => {
  const lat = Number(r[r.length - 2]), lon = Number(r[r.length - 1]);
  if (!/^[A-Z]{2}$/.test(r[0]) || !isFinite(lat) || !isFinite(lon)) { return; }
  let name = r[3];
  for (let i = 0; i < 3 && SUFFIX.test(name); i++) { name = name.replace(SUFFIX, ""); }
  const key = r[0] + "|" + name.toLowerCase();
  seen.set(key, seen.has(key) ? null : [lat.toFixed(4), lon.toFixed(4)]);
});
const towns = [...seen].filter(([, v]) => v).map(([k, v]) => k + "," + v.join(","));

writeFileSync("data/geo/zip-centers-v1.json", JSON.stringify({ source: "US Census 2024 ZCTA Gazetteer (public domain), internal points", rows: zips.join(";") }));
writeFileSync("data/geo/town-centers-v1.json", JSON.stringify({ source: "US Census 2024 Places Gazetteer (public domain), internal points", rows: towns.join(";") }));
console.log("zips", zips.length, "towns", towns.length, "ambiguous dropped", [...seen].filter(([, v]) => !v).length);
