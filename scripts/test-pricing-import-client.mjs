// Pricing spreadsheet import, browser-side pure helpers cut out of gm.js
// (root and iOS copy): CSV cell escaping/round-trip for a parsed .xlsx sheet
// or a .tsv file, and header-row detection for a workbook whose titles or
// blank rows sit above the real header row. No network, no DOM needed for
// these -- they are plain array/string functions.
//
//   node scripts/test-pricing-import-client.mjs
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

function cut(src, name) {
  const i = src.indexOf("\nfunction " + name + "(");
  if (i < 0) { throw new Error("not found in gm.js: " + name); }
  const j = src.indexOf("\n}", i + 1);
  return src.slice(i + 1, j + 2);
}
const NAMES = ["gmCsvCell", "gmRowsToCsv", "gmPricingLooksLikeHeaderRow", "gmPricingDetectHeaderRow"];

for (const file of ["gm.js", "ios/App/App/public/gm.js"]) {
  const src = readFileSync(new URL(file, root), "utf8");
  const code = NAMES.map((n) => cut(src, n)).join("\n") + "\nreturn { " + NAMES.join(", ") + " };";
  const F = new Function(code)();
  const tag = "[" + file + "] ";

  // ── CSV cell escaping / round trip ──────────────────────────────────
  ok(F.gmCsvCell("Pool, 20x40") === '"Pool, 20x40"', tag + "a comma forces quoting");
  ok(F.gmCsvCell('Say "hi"') === '"Say ""hi"""', tag + "an embedded quote is doubled and the field is quoted");
  ok(F.gmCsvCell("plain") === "plain", tag + "a plain value is left unquoted");
  ok(F.gmCsvCell(null) === "" && F.gmCsvCell(undefined) === "", tag + "null/undefined become an empty cell, not the literal word");
  ok(F.gmCsvCell(1200) === "1200", tag + "a real number (parsed Excel cell) stringifies plainly");
  ok(F.gmRowsToCsv([["Item", "Price"], ["Pool, 20x40", "1200"]]) === 'Item,Price\n"Pool, 20x40",1200',
     tag + "gmRowsToCsv joins rows/cells and only quotes the field that needs it");

  // ── Header-row detection: title rows / blank rows above the real header ──
  const withTitleRow = [
    ["Gator Outdoor Living — 2026 Price List"],
    [],
    ["Item", "Price", "Unit"],
    ["Pool resurfacing", "1200", "ea"]
  ];
  ok(F.gmPricingDetectHeaderRow(withTitleRow) === 2, tag + "a title row and a blank row above the headers are skipped; row 2 (0-based) is used");

  const headerOnRowZero = [["Item", "Price"], ["Tile", "10"]];
  ok(F.gmPricingDetectHeaderRow(headerOnRowZero) === 0, tag + "headers already on row 1 (index 0) stay there");

  const allNumericFirstRow = [["2026", "Q4"], ["Item", "Price"], ["Tile", "10"]];
  ok(F.gmPricingDetectHeaderRow(allNumericFirstRow) === 1, tag + "a first row that is mostly numbers is not mistaken for the header row");

  const noFollowingData = [["Item", "Price"]];
  ok(F.gmPricingDetectHeaderRow(noFollowingData) === 0, tag + "a one-row sheet with nothing to compare against still returns a row (falls back to 0)");

  ok(F.gmPricingLooksLikeHeaderRow([["", ""], ["x"]], 0) === false, tag + "an all-blank row never looks like a header");
  ok(F.gmPricingLooksLikeHeaderRow([["100", "200"], ["5", "6"]], 0) === false, tag + "a row of pure numbers never looks like a header (it's data, not titles)");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
