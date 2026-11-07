// Extra material, measured material setup and length by width (2026-11-07).
// Part 1 tests the shared rules file gm-measure.js (one list for server and browser).
// Later parts run the REAL Worker functions on an in-memory SQLite (added below).
//
//   node scripts/test-extra-material-and-calculator.mjs
import { createRequire } from "node:module";
import { makeWorld, addRow, rowOf, reader, OWNER, SELLER, RIVAL, STAFF, get, post, put, seedConn } from "./fixtures/abc-world.mjs";
const require = createRequire(import.meta.url);

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
async function check(name, fn) {
  try { await fn(); } catch (e) { console.log("FAIL  " + name + "  [" + String(e && e.message).slice(0, 200) + "]"); fail++; }
}

let M = null;
await check("load-shared-rules", async () => { M = require("../gm-measure.js"); ok(!!M && typeof M.unitKind === "function", "gm-measure.js loads and exports unitKind"); });

await check("measured-versus-counted", async () => {
  const measured = ["sq ft", "sqft", "SF", "ft2", "Square Feet", "sq yd", "sy", "m2", "sq", "linear feet", "lin ft", "ln ft", "LF", "ft", "feet", "yd", "m", "cubic yards", "cu yd", "cy", "yd3", "cu ft", "m3",
    "  Sq.  Ft. ", "sq. ft", "pés quadrados", "pe quadrado", "metro quadrado", "metros quadrados", "m²", "pés lineares", "metro linear", "metros", "jardas cúbicas", "metro cúbico", "pé", "pés"];
  measured.forEach((u) => ok(M.unitKind(u) === "measured", "measured: " + JSON.stringify(u)));
  const counted = ["each", "ea", "unit", "un", "pc", "pcs", "piece", "set", "door", "window", "hour", "hr", "hora", "project", "lot", "ls", "Each ", "unidade", "peça", "peca", "porta", "janela", "horas", "projeto", "lote", "conjunto"];
  counted.forEach((u) => ok(M.unitKind(u) === "counted", "counted: " + JSON.stringify(u)));
  ["bundle", "pallet", "xyz", "box", "", null, undefined, "   "].forEach((u) => ok(M.unitKind(u) === "unknown", "unknown unit stays unknown, never guessed: " + JSON.stringify(u)));
});

await check("effective-kind-hand-switch-wins", async () => {
  ok(M.effectiveKind({ unit: "each", measure_kind: "area" }) === "measured", "switched to measured by hand beats the unit text 'each'");
  ok(M.effectiveKind({ unit: "sq ft", measure_kind: "count" }) === "counted", "switched to counted by hand beats the unit text 'sq ft'");
  ok(M.effectiveKind({ unit: "sq ft", measure_kind: null }) === "measured", "no hand choice: the unit text decides");
  ok(M.effectiveKind({ unit: "bundle", measure_kind: null }) === "unknown", "unknown unit and no hand choice: unknown");
  ok(M.effectiveKind({ unit: "bundle", measure_kind: "volume" }) === "measured", "volume is measured");
  ok(M.effectiveKind({ unit: "bundle", measure_kind: "length" }) === "measured", "length is measured");
  ok(M.showsExtraBox({ unit: "bundle", measure_kind: null }) === true, "an unknown unit shows the box and lets the owner decide");
  ok(M.showsExtraBox({ unit: "each", measure_kind: null }) === false, "a counted item hides the box");
  ok(M.showsExtraBox({ unit: "sq ft", measure_kind: null }) === true, "a measured item shows the box");
});

await check("extra-percent-validation", async () => {
  ok(M.parseExtraPercent("") === null && M.parseExtraPercent(null) === null && M.parseExtraPercent(undefined) === null, "empty means no extra material, no number is filled in");
  ok(M.parseExtraPercent(10) === 10 && M.parseExtraPercent("7.5") === 7.5 && M.parseExtraPercent(0) === 0 && M.parseExtraPercent(100) === 100, "0 to 100 accepted");
  [-1, 100.1, 101, "abc", NaN, Infinity, 7.55, "7.55", {}, [], true].forEach((v) => ok(M.parseExtraPercent(v) === undefined, "refused: " + JSON.stringify(v)));
});

await check("paver-and-pallet-math", async () => {
  ok(M.coveragePerPiece("area", 6, 9, "in") === 0.375, "a 6 by 9 inch paver covers 0.375 sq ft");
  ok(M.coveragePerPiece("area", 1, 2, "ft") === 2, "a 1 by 2 foot piece covers 2 sq ft");
  ok(M.coveragePerPiece("length", 96, null, "in") === 8, "a 96 inch board is 8 ft");
  ok(M.coveragePerPiece("area", 0, 9, "in") === null && M.coveragePerPiece("area", 6, null, "in") === null && M.coveragePerPiece("area", -1, 9, "in") === null, "no coverage without two positive sizes");
  ok(M.coveragePerPiece("area", 6, 9, "cm") === null, "a size unit other than in or ft is refused");
  ok(M.piecesNeeded(72, 10, 100) === 1, "72 sq ft with 10 percent extra (79.2) on a 100 sq ft pallet is 1 pallet");
  ok(M.withExtra(72, 10) === 79.2, "72 sq ft with 10 percent extra is 79.2 sq ft");
  ok(M.piecesNeeded(100, 10, 110) === 1, "no float error: 110 sq ft on a 110 sq ft pallet is 1, not 2");
  ok(M.piecesNeeded(101, 10, 100) === 2, "111.1 sq ft needs 2 pallets");
  ok(M.piecesNeeded(1, null, 1, "counted") === 1 && M.piecesNeeded(1, 0, 1) === 1, "a door: quantity 1, no extra, 1");
  ok(M.piecesNeeded(1, 25, 1, "counted") === 1, "extra is never added to a counted item");
  ok(M.piecesNeeded(72, null, 100) === 1 && M.piecesNeeded(0, 10, 100) === null && M.piecesNeeded(72, 10, 0) === null && M.piecesNeeded(72, 10, null) === null, "no answer without a quantity and a coverage");
  ok(M.abcFactorFromCoverage(100) === 100, "one ABC pallet covering 100 sq ft is stored as 100 (the existing meaning: cost = price / 100)");
  ok(M.abcFactorFromCoverage(0) === null && M.abcFactorFromCoverage(-3) === null && M.abcFactorFromCoverage(null) === null, "no conversion from a missing coverage");
  ok(M.orderQuantity({ qty: 72, extra: 10, perAbcUnit: 100, kind: "measured" }) === 1, "the order line: 72 sq ft, 10 percent, 100 sq ft per ABC unit is 1");
  ok(M.orderQuantity({ qty: 72, extra: null, perAbcUnit: 100, kind: "measured" }) === 1, "empty extra adds nothing");
  ok(M.orderQuantity({ qty: 1, extra: 10, perAbcUnit: 1, kind: "counted" }) === 1, "a door stays 1");
  ok(M.orderQuantity({ qty: 72, extra: 10, perAbcUnit: null, kind: "measured" }) === null, "no conversion: no quantity, the line is flagged");
});

await check("length-by-width", async () => {
  ok(M.calcQuantity("sqft", 6, 12) === 72, "6 ft by 12 ft equals 72 sq ft");
  ok(M.calcQuantity("sqyd", 9, 9) === 9, "9 ft by 9 ft equals 9 sq yd");
  ok(M.calcQuantity("sqm", 10, 10) === 9.29, "10 ft by 10 ft equals 9.29 sq m");
  ok(M.calcQuantity("lnft", 25) === 25, "linear uses only a length");
  ok(M.calcQuantity("cuft", 10, 10, 6) === 50, "10 by 10 ft at 6 in deep is 50 cu ft");
  ok(M.calcQuantity("cuyd", 27, 12, 12) === 12, "27 by 12 ft at 12 in deep is 12 cu yd");
  ok(M.calcQuantity("cuft", 10, 10) === null && M.calcQuantity("sqft", 6) === null && M.calcQuantity("lnft", null) === null, "a missing box gives no result");
  [0, -1, NaN, 100001, "x"].forEach((v) => ok(M.calcQuantity("sqft", v, 5) === null, "bad length refused: " + String(v)));
  ok(M.calcQuantity("acres", 5, 5) === null, "unknown calculator unit refused");
  ok(M.calcLabel("sqft", 6, 12, null, "en") === "6 ft by 12 ft equals 72 sq ft", "the editor text, English");
  ok(M.calcLabel("sqft", 6, 12, null, "pt") === "6 ft por 12 ft igual a 72 sq ft", "the editor text, Portuguese");
  ok(M.calcLabel("cuft", 10, 10, 6, "en") === "10 ft by 10 ft by 6 in equals 50 cu ft", "volume text names the depth");
  ok(M.calcLabel("lnft", 25, null, null, "en") === "25 ft equals 25 ln ft", "linear text");
  ok(M.calcLabel("sqft", 1234.5, 2, null, "en") === "1,234.5 ft by 2 ft equals 2,469 sq ft", "US number format");
});

await check("calc-fields-check", async () => {
  const good = M.parseCalc({ calc_unit: "sqft", calc_length: 6, calc_width: 12 }, 72);
  ok(good && good.calc_kind === "area" && good.calc_unit === "sqft" && good.calc_length === 6 && good.calc_width === 12 && good.calc_depth === null, "good inputs keep the kind and the numbers");
  ok(M.parseCalc({}, 5).none === true && M.parseCalc({ calc_unit: null }, 5).none === true, "no inputs: the line behaves as today");
  ok(M.parseCalc({ calc_unit: "sqft", calc_length: 6, calc_width: 12 }, 70) === undefined, "a quantity that does not match the inputs is refused, not repaired");
  ok(M.parseCalc({ calc_unit: "sqft", calc_length: -6, calc_width: 12 }, 72) === undefined, "a negative length is refused");
  ok(M.parseCalc({ calc_unit: "sqft", calc_length: 6 }, 72) === undefined, "a missing width is refused");
  ok(M.parseCalc({ calc_unit: "weird", calc_length: 6, calc_width: 12 }, 72) === undefined, "an unknown unit is refused");
  ok(M.parseCalc({ calc_unit: "cuft", calc_length: 10, calc_width: 10, calc_depth: 6 }, 50).calc_kind === "volume", "volume keeps the depth");
  ok(M.parseCalc({ calc_unit: "lnft", calc_length: 25 }, 25).calc_kind === "length", "linear is the length kind");
});


// ── Server side: the real Worker functions on an in-memory SQLite ────────────
let user = OWNER;
const read = reader(null);
const world = (o) => makeWorld(o, () => user);
const putItem = (w, id, body, who) => { if (who !== undefined) { user = who; } return w.F.handlePutGmPricing("c1", id, put("/x", body), w.env); };

await check("price-list-fields", async () => {
  const w = world(); user = OWNER;
  const sq = addRow(w, { id: "sq", item: "Paver", unit: "sq ft" });
  const ea = addRow(w, { id: "ea", item: "Door", unit: "each" });
  const un = addRow(w, { id: "un", item: "Bundle thing", unit: "bundle" });
  let r = await read(await putItem(w, sq, { order_extra_percent: 10 }));
  ok(r.status === 200 && rowOf(w, sq).order_extra_percent === 10 && rowOf(w, sq).order_extra_source === "item", "a number typed for one item is saved with the source 'item'");
  r = await read(await putItem(w, sq, { order_extra_percent: "" }));
  ok(r.status === 200 && rowOf(w, sq).order_extra_percent === null && rowOf(w, sq).order_extra_source === null, "empty means no extra material: no number is filled in");
  for (const bad of [101, -1, 7.55, "abc", true, {}]) { r = await read(await putItem(w, sq, { order_extra_percent: bad })); ok(r.status === 400, "extra percent refused with 400: " + JSON.stringify(bad)); }
  ok(rowOf(w, sq).order_extra_percent === null, "nothing was saved by the refused requests");
  r = await read(await putItem(w, ea, { order_extra_percent: 10 }));
  ok(r.status === 400 && rowOf(w, ea).order_extra_percent === null, "a counted item (each) gets no extra material");
  r = await read(await putItem(w, ea, { measure_kind: "area", order_extra_percent: 5 }));
  ok(r.status === 200 && rowOf(w, ea).order_extra_percent === 5 && rowOf(w, ea).measure_kind === "area", "switched to measured by hand in the same save, it may carry extra");
  r = await read(await putItem(w, sq, { measure_kind: "count", order_extra_percent: 5 }));
  ok(r.status === 400, "switched to counted by hand, extra is refused even though the unit text says sq ft");
  r = await read(await putItem(w, un, { order_extra_percent: 12.5 }));
  ok(r.status === 200 && rowOf(w, un).order_extra_percent === 12.5, "a unit in neither list lets the owner decide");
  for (const bad of [{ measure_kind: "weird" }, { piece_length: -1 }, { piece_width: 0 }, { piece_dim_unit: "cm" }, { coverage_per_piece: 0 }, { coverage_per_sold_unit: -2 }, { sold_unit: "x".repeat(41) }, { order_extra_source: "bogus" }]) {
    r = await read(await putItem(w, sq, bad)); ok(r.status === 400, "refused with 400: " + JSON.stringify(bad));
  }
  r = await read(await putItem(w, sq, { measure_kind: "area", piece_length: 6, piece_width: 9, piece_dim_unit: "in", coverage_per_piece: 0.375, sold_unit: "pallet", coverage_per_sold_unit: 100 }));
  ok(r.status === 200 && rowOf(w, sq).coverage_per_piece === 0.375 && rowOf(w, sq).coverage_per_sold_unit === 100 && rowOf(w, sq).sold_unit === "pallet", "the wizard answers are saved");
  r = await read(await putItem(w, sq, { piece_length: 6, piece_width: 9, piece_dim_unit: "in", coverage_per_piece: 0.5 }));
  ok(r.status === 400, "a coverage that does not match the piece size is refused, not repaired");
  r = await read(await putItem(w, sq, { measure_kind: null }));
  ok(r.status === 200 && rowOf(w, sq).measure_kind === null, "the hand choice can be cleared");
  ok((await putItem(w, sq, { order_extra_percent: 5 }, null)).status === 401, "not signed in is 401");
  ok((await putItem(w, sq, { order_extra_percent: 5 }, SELLER)).status === 403, "a salesperson is 403");
  ok((await putItem(w, sq, { order_extra_percent: 5 }, RIVAL)).status === 403, "another business's owner is 403");
  user = OWNER;
  w.d.raw.prepare("INSERT INTO gm_pricing (id, client_id, item, unit) VALUES ('theirs', 'c2', 'Theirs', 'sq ft')").run();
  ok((await putItem(w, "theirs", { order_extra_percent: 5 })).status === 404 && w.d.q("SELECT order_extra_percent FROM gm_pricing WHERE id = 'theirs'")[0].order_extra_percent === null, "another business's item id is 404 and untouched");
  r = await read(await putItem(w, sq, { item: "Paver renamed" }));
  ok(r.status === 200, "a save without the new fields works as before");
});

await check("columns-missing", async () => {
  const w = world({ measured: false }); user = OWNER;
  w.d.raw.prepare("INSERT INTO gm_pricing (id, client_id, item, unit) VALUES ('x1', 'c1', 'Old', 'sq ft')").run();
  ok((await putItem(w, "x1", { item: "Renamed" })).status === 200, "the plain Price list save still works before the migration");
  const r = await read(await putItem(w, "x1", { order_extra_percent: 5 }));
  ok(r.status === 503 && r.data && r.data.available === false, "an extra material save before the migration says not available yet");
});

await check("business-standard", async () => {
  const w = world(); user = OWNER;
  const sq1 = addRow(w, { id: "s1", item: "Paver", unit: "sq ft" });
  const sq2 = addRow(w, { id: "s2", item: "Tile", unit: "sqft", extra: 5, extraSource: "item" });
  const ea = addRow(w, { id: "e1", item: "Door", unit: "each" });
  const un = addRow(w, { id: "u1", item: "Thing", unit: "bundle" });
  const hand = addRow(w, { id: "h1", item: "Hand measured", unit: "each", kind: "area" });
  let r = await read(await w.F.handleGetGmMaterialSettings("c1", get("/x"), w.env));
  ok(r.status === 200 && r.data.standard_extra_percent === null, "no standard until the owner sets one");
  ok(M.shouldAskStandard(null, 10) === true && M.shouldAskStandard(null, null) === false && M.shouldAskStandard(10, 5) === false, "Make this your standard? is asked only with no standard and a number typed");
  r = await read(await putItem(w, sq1, { order_extra_percent: 8 }));
  ok(r.status === 200, "No: the number is kept for that one item only");
  r = await read(await w.F.handleGetGmMaterialSettings("c1", get("/x"), w.env));
  ok(r.data.standard_extra_percent === null, "...and there is still no standard (the question comes again next time)");
  r = await read(await w.F.handlePutGmMaterialSettings("c1", put("/x", { standard_extra_percent: 10 }), w.env));
  ok(r.status === 200 && r.data.standard_extra_percent === 10, "Yes: the standard is saved");
  ok(r.data.existing_without_number === 1, "the answer says how many existing measured items have no number of their own (only the hand-measured one; got " + r.data.existing_without_number + ")");
  for (const bad of [101, -1, 7.55, "abc", true]) { r = await read(await w.F.handlePutGmMaterialSettings("c1", put("/x", { standard_extra_percent: bad }), w.env)); ok(r.status === 400, "standard refused with 400: " + JSON.stringify(bad)); }
  const gone = await read(await w.F.handlePostGmMaterialApply("c1", post("/x", {}), w.env));
  ok(gone.status === 200 && gone.data.applied === 1, "Apply to all existing: copies it onto measured items with no number of their own (" + JSON.stringify(gone.data) + ")");
  ok(rowOf(w, hand).order_extra_percent === 10 && rowOf(w, hand).order_extra_source === "standard", "the hand-measured item got the standard, marked as standard");
  ok(rowOf(w, sq1).order_extra_percent === 8 && rowOf(w, sq2).order_extra_percent === 5, "items with their own number are left alone");
  ok(rowOf(w, ea).order_extra_percent === null, "a counted item gets nothing");
  ok(rowOf(w, un).order_extra_percent === null, "an item with an unknown unit gets nothing");
  ok((await read(await w.F.handlePostGmMaterialApply("c1", post("/x", {}), w.env))).data.applied === 0, "a second Apply changes nothing");
  // A custom number typed for one product is not remembered and does not change the standard.
  await putItem(w, sq1, { order_extra_percent: 3 });
  r = await read(await w.F.handleGetGmMaterialSettings("c1", get("/x"), w.env));
  ok(r.data.standard_extra_percent === 10, "a custom number for one product does not change the standard");
  // Items added later start from the standard, stored on the item.
  r = await read(await w.F.handlePostGmPricing("c1", post("/x", { item: "New tile", unit: "sq ft" }), w.env));
  ok(r.data.item.order_extra_percent === 10 && r.data.item.order_extra_source === "standard", "a new measured item starts with the standard already filled in");
  r = await read(await w.F.handlePostGmPricing("c1", post("/x", { item: "New door", unit: "each" }), w.env));
  ok(r.data.item.order_extra_percent === null, "a new counted item starts empty");
  // Back to the standard in one tap.
  r = await read(await putItem(w, sq1, { order_extra_percent: 10, order_extra_source: "standard" }));
  ok(r.status === 200 && rowOf(w, sq1).order_extra_source === "standard", "back to the standard in one save");
  r = await read(await putItem(w, sq1, { order_extra_percent: 9, order_extra_source: "standard" }));
  ok(r.status === 400, "marking a number as the standard when it is not the standard is refused");
  // Guards.
  user = null; ok((await w.F.handleGetGmMaterialSettings("c1", get("/x"), w.env)).status === 401 && (await w.F.handlePutGmMaterialSettings("c1", put("/x", { standard_extra_percent: 1 }), w.env)).status === 401 && (await w.F.handlePostGmMaterialApply("c1", post("/x", {}), w.env)).status === 401, "not signed in is 401 on all three");
  for (const who of [SELLER, RIVAL, STAFF]) {
    user = who;
    ok((await w.F.handleGetGmMaterialSettings("c1", get("/x"), w.env)).status === 403 && (await w.F.handlePutGmMaterialSettings("c1", put("/x", { standard_extra_percent: 1 }), w.env)).status === 403 && (await w.F.handlePostGmMaterialApply("c1", post("/x", {}), w.env)).status === 403, "wrong role is 403 on all three: " + (who.login_role || who.role));
  }
  user = OWNER;
  r = await read(await w.F.handlePutGmMaterialSettings("c1", put("/x", { standard_extra_percent: null }), w.env));
  ok(r.status === 200 && r.data.standard_extra_percent === null, "the standard can be cleared");
  r = await read(await w.F.handlePostGmMaterialApply("c1", post("/x", {}), w.env));
  ok(r.status === 409, "Apply with no standard is refused (nothing to copy)");
});

await check("estimate-line-calc-fields", async () => {
  const w = world(); user = OWNER;
  const line = (over) => Object.assign({ item_name: "Paver patio", qty: 72, unit: "sq ft", rate_cents: 1000 }, over || {});
  const body = (l) => ({ mode: "single", options: [{ items: [l] }] });
  let r = await w.F.gmEstParseOptions(w.env, "c1", body(line({ calc_unit: "sqft", calc_length: 6, calc_width: 12 })), true);
  const it = r.options && r.options[0].items[0];
  ok(!r.error && it.calc_kind === "area" && it.calc_length === 6 && it.calc_width === 12 && it.calc_unit === "sqft" && it.qty === 72, "good inputs are kept on the line with the quantity they produce");
  r = await w.F.gmEstParseOptions(w.env, "c1", body(line({ qty: 70, calc_unit: "sqft", calc_length: 6, calc_width: 12 })), true);
  ok(!!r.error, "a quantity that does not match the inputs is refused: " + r.error);
  r = await w.F.gmEstParseOptions(w.env, "c1", body(line({ calc_unit: "sqft", calc_length: -6, calc_width: 12 })), true);
  ok(!!r.error, "a negative length is refused");
  r = await w.F.gmEstParseOptions(w.env, "c1", body(line({ calc_unit: "acres", calc_length: 6, calc_width: 12 })), true);
  ok(!!r.error, "an unknown calculator unit is refused");
  r = await w.F.gmEstParseOptions(w.env, "c1", body(line({ qty: 5 })), true);
  const plain = r.options[0].items[0];
  ok(!r.error && plain.calc_kind === null && plain.calc_unit === null && plain.calc_length === null && plain.calc_width === null && plain.calc_depth === null, "a line without the calculator behaves exactly as today (all inputs empty)");
  r = await w.F.gmEstParseOptions(w.env, "c1", body(line({ qty: 5, calc_unit: null, calc_length: null, calc_width: null })), true);
  ok(!r.error && r.options[0].items[0].calc_unit === null, "typing a quantity clears the inputs: the line saves with none");
  r = await w.F.gmEstParseOptions(w.env, "c1", body(line({ qty: 50, unit: "cu ft", calc_unit: "cuft", calc_length: 10, calc_width: 10, calc_depth: 6 })), true);
  ok(!r.error && r.options[0].items[0].calc_kind === "volume" && r.options[0].items[0].calc_depth === 6, "volume keeps the depth");
  // Stored and read back through the real write function.
  const est = { id: "e1", number: "E-1", revision: 1, discount_type: null, discount_value: null };
  w.d.raw.prepare("INSERT INTO gm_estimates (id, client_id, lead_id, number, revision, status, mode, job_name, public_token) VALUES ('e1', 'c1', 'l1', 'E-1', 1, 'draft', 'single', 'J', 't1')").run();
  const parsed = await w.F.gmEstParseOptions(w.env, "c1", body(line({ calc_unit: "sqft", calc_length: 6, calc_width: 12 })), true);
  await w.F.gmEstWriteOptions(w.env, est, parsed.options);
  const row = w.d.q("SELECT calc_kind, calc_length, calc_width, calc_depth, calc_unit, qty FROM gm_estimate_items WHERE estimate_id = 'e1'")[0];
  ok(row && row.calc_kind === "area" && row.calc_length === 6 && row.calc_width === 12 && row.calc_depth === null && row.calc_unit === "sqft" && row.qty === 72, "the inputs are stored on the estimate line and read back");
});

await check("abc-add-flow-extra", async () => {
  const w = world(); await seedConn(w); user = OWNER;
  const add = (items) => w.F.handlePostGmAbcAddItems("c1", post("/x", { items: items }), w.env);
  let r = await read(await add([{ item_number: "PAVER6X9", apex_unit: "sq ft", units_per_apex_unit: 100, order_extra_percent: 7.5 }]));
  let row = r.data && r.data.created && r.data.created[0];
  ok(r.status === 200 && row && row.order_extra_percent === 7.5 && row.order_extra_source === "item" && row.abc_cost === 3.8, "a measured ABC item added with its own extra: saved, source 'item', cost 380 / 100 = 3.80");
  w.d.raw.prepare("DELETE FROM gm_pricing WHERE client_id = 'c1'").run();
  await w.F.handlePutGmMaterialSettings("c1", put("/x", { standard_extra_percent: 10 }), w.env);
  r = await read(await add([{ item_number: "PAVER6X9", apex_unit: "sq ft", units_per_apex_unit: 100 }]));
  row = r.data.created[0];
  ok(row.order_extra_percent === 10 && row.order_extra_source === "standard", "no number typed and a standard exists: the standard is filled in and stored on the item");
  w.d.raw.prepare("DELETE FROM gm_pricing WHERE client_id = 'c1'").run();
  r = await read(await add([{ item_number: "PAVER6X9", apex_unit: "sq ft", units_per_apex_unit: 100, order_extra_percent: null }]));
  ok(r.data.created[0].order_extra_percent === null, "the owner cleared the box: no extra, the standard is not forced back");
  w.d.raw.prepare("DELETE FROM gm_pricing WHERE client_id = 'c1'").run();
  r = await read(await add([{ item_number: "EACH0001", apex_unit: "each", order_extra_percent: 10 }]));
  ok(r.data.created.length === 0 && r.data.skipped.length === 1 && r.data.skipped[0].reason === "extra_on_counted_item", "extra on a counted item is skipped with a reason");
  r = await read(await add([{ item_number: "EACH0001", apex_unit: "each" }]));
  ok(r.data.created.length === 1 && r.data.created[0].order_extra_percent === null, "a counted item added without a number gets none, even with a standard");
  for (const bad of [150, -1, 7.55, "abc"]) { r = await read(await add([{ item_number: "PAVER6X9", order_extra_percent: bad }])); ok(r.status === 400, "refused with 400: " + JSON.stringify(bad)); }
});

console.log(fail ? "\n" + fail + " check(s) FAILED" : "\nAll checks passed");
process.exit(fail ? 1 : 0);
