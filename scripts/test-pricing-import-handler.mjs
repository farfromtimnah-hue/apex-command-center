// Pricing spreadsheet import, end to end: the REAL handlePostGmPricingImport
// (cut out of worker/index.js) on an in-memory SQLite, covering what the
// .xlsx/.xls/.tsv support in gm.js depends on from the server:
//   - the sample-value field added to the "headers" response (one value from
//     the first data row per column, for the mapping dropdowns)
//   - the size and row-count caps added for a converted workbook that can be
//     far bigger than a hand-typed CSV
//   - a row whose price is unreadable is skipped, never silently imported
//   - preview never writes; commit does, and is idempotent on item name
// No network, no production database.
//
//   node scripts/test-pricing-import-handler.mjs
import { makeDb, fnSrc, varSrc, workerSrc, baseStubs, req } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = [
  "gmCsvParse", "gmCsvNum", "gmCsvNorm", "gmPricingKindFromCsv", "gmCsvNorm",
  "gmPricingResolveColumns", "gmPricingComputed", "handlePostGmPricingImport",
  "gmStr", "gmRunUpdate", "gmServiceFromPricingStmt", "gmPricingParseBreakdown", "gmCostLineType"
];
// The GM_PRICING_*_HEADERS lists use a double space before "=" (lint-clean in
// worker/index.js, but it breaks fixtures/d1-shim.mjs's single-space varSrc()
// match), so this slice pulls that whole block by its start/end landmarks
// instead of var-by-var. GM_COST_LINE_TYPES is declared elsewhere with a
// single space, so varSrc() handles it normally.
const headerBlockStart = workerSrc.indexOf("var GM_PRICING_ITEM_HEADERS");
const headerBlockEnd = workerSrc.indexOf("\n\n", workerSrc.indexOf("GM_PRICING_DESCRIPTION_HEADERS", headerBlockStart));
const headerBlockSrc = workerSrc.slice(headerBlockStart, headerBlockEnd);

function build(stubs) {
  const stubNames = Object.keys(stubs || {});
  const body = varSrc("GM_COST_LINE_TYPES") + "\n" + headerBlockSrc + "\n" +
    FNS.map(function(n) { return fnSrc(n); }).join("\n") +
    "\nreturn { " + FNS.join(", ") + " };";
  return new Function(...stubNames, body)(...stubNames.map(function(k) { return stubs[k]; }));
}

// migrations/gm_pricing.sql's layered-migration loading via makeDb() breaks
// on this file's inline trailing comments (e.g. "-- cache of SUM(...); recomputed..."
// contains a literal ";" that the loader's whole-line-comment stripper does
// not catch), so the table is created directly here instead, matching the
// real column list in that migration.
const GM_PRICING_TABLE_SQL = "CREATE TABLE gm_pricing (" +
  "id TEXT PRIMARY KEY, client_id TEXT NOT NULL, item TEXT NOT NULL, unit TEXT, " +
  "cost_breakdown TEXT NOT NULL DEFAULT '[]', cost_total REAL, price REAL, notes TEXT, " +
  "sort_order INTEGER NOT NULL DEFAULT 0, category TEXT, kind TEXT NOT NULL DEFAULT 'product', description TEXT, " +
  "created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), " +
  "created_by TEXT, updated_by TEXT)";

function world() {
  const d = makeDb(["migrations/gm_growth_management.sql"]);
  d.raw.exec(GM_PRICING_TABLE_SQL);
  d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'Gator Outdoor Living')").run();
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => ({ role: "developer", display_name: "Dev" }),
    requireClientAccess: () => true,
    jsonErr2: (pt, en, status) => ({ status: status || 400, error: en, error_pt: pt, error_en: en })
  });
  const F = build(stubs);
  const env = { DB: d.DB };
  return { d, env, F };
}

// ── headers mode returns sample values from the first data row ──────────
{
  const w = world();
  const csv = "Item,Price,Unit\nPool resurfacing,1200,ea\nDeck staining,450,ea\n";
  const r = await w.F.handlePostGmPricingImport("c1", req({ csv, mode: "headers" }), w.env);
  ok(r.status === 200 && r.data.needs_mapping === true, "headers mode reports needs_mapping");
  ok(Array.isArray(r.data.sample) && r.data.sample.length === 3, "a sample array is returned, one entry per header");
  ok(r.data.sample[0] === "Pool resurfacing" && r.data.sample[1] === "1200" && r.data.sample[2] === "ea",
     "the sample values come from the first DATA row, not the header row");
}

// ── size cap: an oversized converted workbook is rejected with a clear message ──
{
  const w = world();
  const bigCsv = "Item,Price\n" + "x".repeat(8 * 1024 * 1024 + 10);
  const r = await w.F.handlePostGmPricingImport("c1", req({ csv: bigCsv, mode: "headers" }), w.env);
  ok(r.status === 400, "an over-limit CSV text is rejected, not silently truncated or 500'd");
  ok(/8MB/.test(r.error) || /8MB/.test(r.error_en || ""), "the size-cap message states the limit in English");
  ok(/8MB/.test(r.error_pt || ""), "the size-cap message states the limit in Portuguese too");
}

// ── row cap: too many rows is rejected with a clear message ──────────────
{
  const w = world();
  let rows = "Item,Price\n";
  for (let i = 0; i < 20005; i++) { rows += "Item " + i + ",10\n"; }
  const r = await w.F.handlePostGmPricingImport("c1", req({ csv: rows, mode: "headers" }), w.env);
  ok(r.status === 400, "more than 20,000 rows is rejected");
  ok(/20.000|20,000/.test((r.error_pt || "") + (r.error_en || r.error || "")), "the row-cap message states the limit");
}

// ── an unreadable price is skipped, never imported silently ──────────────
{
  const w = world();
  const csv = "Item,Price\nGood item,99.50\nBlank price item,\nBad price item,n/a\n";
  const map = { item: "Item", price: "Price", unit: null, category: null, kind: null, description: null };
  const r = await w.F.handlePostGmPricingImport("c1", req({ csv, mode: "preview", column_map: map }), w.env);
  ok(r.status === 200, "preview with an explicit map succeeds");
  ok(r.data.rows.length === 1 && r.data.rows[0].item === "Good item", "only the row with a readable price is planned");
  ok(r.data.skipped.length === 2, "both the blank price and the unreadable price are reported as skipped, not imported");
  ok(r.data.skipped.every(function(s) { return s.reason === "no price"; }), "both skips are tagged with a 'no price' reason");
  const rowsInDb = w.d.q("SELECT COUNT(*) AS n FROM gm_pricing WHERE client_id = 'c1'")[0].n;
  ok(rowsInDb === 0, "preview never writes, even with good and bad rows mixed");
}

// ── commit writes exactly the planned rows, create then idempotent update ──
{
  const w = world();
  const csv = "Item,Price\nPool resurfacing,1200\n";
  const map = { item: "Item", price: "Price", unit: null, category: null, kind: null, description: null };
  await w.F.handlePostGmPricingImport("c1", req({ csv, mode: "commit", column_map: map }), w.env);
  let rows = w.d.q("SELECT * FROM gm_pricing WHERE client_id = 'c1'");
  ok(rows.length === 1 && rows[0].item === "Pool resurfacing" && rows[0].price === 1200, "commit creates the row with the parsed price");

  const csv2 = "Item,Price\nPool resurfacing,1350\n";
  await w.F.handlePostGmPricingImport("c1", req({ csv: csv2, mode: "commit", column_map: map }), w.env);
  rows = w.d.q("SELECT * FROM gm_pricing WHERE client_id = 'c1'");
  ok(rows.length === 1 && rows[0].price === 1350, "re-importing the same item name updates the existing row instead of duplicating it");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
