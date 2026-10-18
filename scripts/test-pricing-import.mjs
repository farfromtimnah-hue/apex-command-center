// Pricing spreadsheet import: Worker-side pure helpers (CSV parsing, number
// parsing for the formats a real workbook throws at it, column resolution,
// sample values for the mapping UI) plus the size/row caps added alongside
// the .xlsx/.xls/.tsv support in gm.js (the browser converts those to CSV
// text and feeds the SAME endpoint, so these are the only server-side
// helpers that changed). No DB needed -- these are pure functions, cut out
// of worker/index.js the same way scripts/fixtures/d1-shim.mjs does for the
// other Worker tests.
import { fnSrc, workerSrc } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = ["gmCsvParse", "gmCsvNum", "gmCsvNorm", "gmPricingKindFromCsv", "gmPricingResolveColumns"];
// The GM_PRICING_*_HEADERS lists use a double space before "=" (lint-clean in
// worker/index.js, but it breaks fixtures/d1-shim.mjs's single-space varSrc()
// match), so this slice pulls the whole block by its start/end landmarks
// instead of var-by-var.
const headerBlockStart = workerSrc.indexOf("var GM_PRICING_ITEM_HEADERS");
const headerBlockEnd = workerSrc.indexOf("\n\n", workerSrc.indexOf("GM_PRICING_DESCRIPTION_HEADERS", headerBlockStart));
const body = workerSrc.slice(headerBlockStart, headerBlockEnd) + "\n" +
  FNS.map(function(n) { return fnSrc(n); }).join("\n") +
  "\nreturn { " + FNS.join(", ") + " };";
const F = new Function(body)();

// ── CSV parse: quotes, commas, embedded newlines, BOM ───────────────────
{
  const rows = F.gmCsvParse('Item,Price\n"Pool, 20x40",1200\n"Multi\nline",50\n');
  ok(rows.length === 3, "header + two data rows survive quoted commas and an embedded newline");
  ok(rows[1][0] === "Pool, 20x40" && rows[1][1] === "1200", "a quoted comma stays inside its own field");
  ok(rows[2][0] === "Multi\nline", "a quoted embedded newline stays inside its own field");

  const withBom = F.gmCsvParse("﻿Item,Price\nTile,10\n");
  ok(withBom[0][0] === "Item", "a leading BOM (Excel's CSV export) is stripped from the first header");

  const blank = F.gmCsvParse("Item,Price\nTile,10\n\n\n");
  ok(blank.length === 2, "trailing blank lines are not counted as rows");
}

// ── Number parsing: every format the spec calls out ─────────────────────
{
  ok(F.gmCsvNum("1.234,56") === 1234.56, '"1.234,56" (comma decimal) parses to 1234.56');
  ok(F.gmCsvNum("$1,234.56") === 1234.56, '"$1,234.56" (dollar sign, thousands comma) parses to 1234.56');
  ok(F.gmCsvNum("R$ 1.234,56") === 1234.56, '"R$ 1.234,56" (Real sign, space, comma decimal) parses to 1234.56');
  ok(F.gmCsvNum("1234.5") === 1234.5, '"1234.5" (plain dot decimal) parses to 1234.5');
  ok(F.gmCsvNum("99.50") === 99.5, '"99.50" parses to 99.5');
  ok(F.gmCsvNum("  42  ") === 42, "surrounding whitespace is trimmed");
  ok(F.gmCsvNum("") === null, "an empty price reads as unreadable (null), never 0");
  ok(F.gmCsvNum("   ") === null, "a whitespace-only price reads as unreadable (null)");
  ok(F.gmCsvNum("n/a") === null, "non-numeric text reads as unreadable (null), never silently 0");
  ok(F.gmCsvNum(null) === null && F.gmCsvNum(undefined) === null, "null/undefined read as unreadable, not 0");
  ok(F.gmCsvNum(1234.5) === 1234.5, "a real JS number (what a converted Excel numeric cell becomes) passes through");
}

// ── Column resolution: header-name guesses, explicit map overrides ──────
{
  const headers = ["Item", "Price", "Unit", "Category", "Kind", "Customer description", "Tile cost"];
  const guess = F.gmPricingResolveColumns(headers, null);
  ok(guess.item === 0 && guess.price === 1 && guess.unit === 2 && guess.category === 3 && guess.kind === 4 && guess.description === 5,
     "exact header-name matches resolve every role by name alone");

  const odd = ["Produto", "Valor", "Un"];
  const guessPt = F.gmPricingResolveColumns(odd, null);
  ok(guessPt.item === 0 && guessPt.price === 1 && guessPt.unit === 2, "Portuguese header names resolve the same roles");

  const explicitOnly = F.gmPricingResolveColumns(["A", "B"], { item: "B", price: "A" }, true);
  ok(explicitOnly.item === 1 && explicitOnly.price === 0, "explicitOnly: nothing is guessed, only the given map is used");
  ok(explicitOnly.unit === -1, "explicitOnly: a role absent from the map stays unresolved rather than guessed");

  const override = F.gmPricingResolveColumns(headers, { price: "Tile cost" });
  ok(override.price === 6, "an explicit map entry overrides the header-name guess for that role");
}

// ── Add-on / product kind from a free-text cell ──────────────────────────
{
  ok(F.gmPricingKindFromCsv("Add-on") === "addon", '"Add-on" reads as addon');
  ok(F.gmPricingKindFromCsv("Adicional") === "addon", '"Adicional" (PT) reads as addon');
  ok(F.gmPricingKindFromCsv("Product") === "product", '"Product" reads as product');
  ok(F.gmPricingKindFromCsv("") === "product", "blank defaults to product, never a guessed addon");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
