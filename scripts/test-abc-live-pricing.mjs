// ABC live pricing (2026-11-07): POST gm/abc/price-rows prices a small set of the
// business's own ABC linked Price list rows. Real Worker functions, in-memory
// SQLite, a FAKE ABC. No network, no production database.
//
//   node scripts/test-abc-live-pricing.mjs
import { readFileSync } from "node:fs";
import { makeWorld, seedConn, addRow, rowOf, linesOf, reader, OWNER, SELLER, RIVAL, STAFF, HIDDEN, get, post } from "./fixtures/abc-world.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
async function check(name, fn) { try { await fn(); } catch (e) { console.log("FAIL  " + name + "  [" + String(e && e.message).slice(0, 200) + "]"); fail++; } }
let user = OWNER;
const seen = [];
const logged = [];
console.error = function () { logged.push(Array.prototype.slice.call(arguments).map(String).join(" ")); };
const read = reader(seen);
const world = (o) => makeWorld(o, () => user);
const call = (w, ids, who) => { if (who !== undefined) { user = who; } return w.F.handlePostGmAbcPriceRows("c1", post("/x", { ids: ids }), w.env); };

await check("route-exists", async () => {
  const w = world();
  ok(typeof w.F.handlePostGmAbcPriceRows === "function", "handlePostGmAbcPriceRows exists in the Worker");
  ok(typeof w.F.abcRefreshRows === "function", "the refresh logic is ONE shared helper (abcRefreshRows)");
});

await check("guards", async () => {
  const w = world(); await seedConn(w);
  const id = addRow(w, { abc: "EACH0001", abcUnit: "EA", apexUnit: "each", unit: "each", abcCost: 10, lines: [{ label: "ABC Supply", amount: 10, type: "material" }] });
  user = null; ok((await call(w, [id])).status === 401, "not signed in is 401");
  ok((await call(w, [id], SELLER)).status === 403, "a salesperson is 403");
  ok((await call(w, [id], RIVAL)).status === 403, "another business's owner is 403");
  ok((await call(w, [id], STAFF)).status === 403, "platform staff is 403");
  ok(w.abc.calls.length === 0, "no call reached ABC from a refused request");
  user = OWNER;
});

await check("bad-input", async () => {
  const w = world(); await seedConn(w);
  const id = addRow(w, { abc: "EACH0001", abcUnit: "EA", apexUnit: "each", unit: "each", abcCost: 10 });
  user = OWNER;
  const bads = [undefined, null, "r1", [], {}, [1], [""], ["a b"], ["x'; DROP TABLE gm_pricing;--"], [id, id], Array.from({ length: 51 }, (_, i) => "r" + i), [id, null]];
  for (const b of bads) { const r = await read(await w.F.handlePostGmAbcPriceRows("c1", post("/x", { ids: b }), w.env)); ok(r.status === 400, "refused with 400: " + String(JSON.stringify(b)).slice(0, 40)); }
  ok((await read(await w.F.handlePostGmAbcPriceRows("c1", post("/x", "not json"), w.env))).status === 400, "a body that is not JSON is 400");
  ok(w.abc.calls.length === 0, "nothing reached ABC");
});

await check("limit-429", async () => {
  const w = world(); await seedConn(w);
  const id = addRow(w, { abc: "EACH0001", abcUnit: "EA", apexUnit: "each", unit: "each", abcCost: 10 });
  user = OWNER; let first = 0;
  for (let i = 1; i <= 130; i++) { const r = await call(w, [id]); if (r.status === 429 && !first) { first = i; } }
  ok(first === 121, "the 121st request in the window is the first 429 (got " + first + ")");
});

await check("columns-and-connection", async () => {
  const w = world({ columns: false }); await seedConn(w); user = OWNER;
  const r = await read(await call(w, ["r1"]));
  ok(r.status === 503 && r.data && r.data.available === false, "columns not there yet: not available yet");
  const w2 = world(); user = OWNER;
  ok((await call(w2, ["r1"])).status === 409, "not connected is 409");
  const w3 = world(); await seedConn(w3, { account: false }); user = OWNER;
  ok((await call(w3, ["r1"])).status === 409, "no saved account and branch is 409");
});

await check("updates-cost-only", async () => {
  const w = world(); await seedConn(w); user = OWNER;
  const a = addRow(w, { id: "ra", item: "Pipe boot", unit: "each", price: 30, abc: "EACH0001", abcUnit: "EA", apexUnit: "each", abcCost: 9, lines: [{ label: "Labor", amount: 5, type: "labor" }, { label: "ABC Supply", amount: 9, type: "material" }], total: 14 });
  const b = addRow(w, { id: "rb", item: "Paver", unit: "sq ft", price: 8, abc: "PAVER6X9", abcUnit: "PL", apexUnit: "sq ft", conv: 100, abcCost: 3, lines: [{ label: "ABC Supply", amount: 3, type: "material" }], total: 3 });
  const other = addRow(w, { id: "rc", item: "Shingle", unit: "bundle", price: 99, abc: "02GASTZ3WW", abcUnit: "BD", apexUnit: "bundle", abcCost: 40, lines: [{ label: "ABC Supply", amount: 40, type: "material" }], total: 40 });
  const r = await read(await call(w, [a, b]));
  ok(r.status === 200 && r.data.rows.length === 2, "answers the rows asked for");
  const ra = r.data.rows.find((x) => x.id === a), rb = r.data.rows.find((x) => x.id === b);
  ok(ra.status === "updated" && ra.has_price === true, "pipe boot: updated and ABC gave a price");
  ok(rowOf(w, a).abc_cost === 12.5 && linesOf(rowOf(w, a)).find((l) => l.label === "ABC Supply").amount === 12.5, "the ABC Supply line and abc_cost carry the new cost");
  ok(linesOf(rowOf(w, a)).find((l) => l.label === "Labor").amount === 5, "other cost lines are untouched");
  ok(rowOf(w, a).cost_total === 17.5, "cost_total follows the lines");
  ok(rowOf(w, a).price === 30 && rowOf(w, b).price === 8, "the selling price is NEVER read or changed from ABC");
  ok(rowOf(w, b).abc_cost === 3.8, "paver: 380 per pallet covering 100 sq ft is 3.80 a sq ft");
  ok(!!rowOf(w, a).abc_cost_synced_at && ra.item && ra.item.abc_cost === 12.5, "the updated row comes back with the new cost");
  ok(rowOf(w, other).abc_cost === 40, "a row that was not asked for is not touched");
  ok(w.abc.priceBatches.length === 1 && w.abc.priceBatches[0].lines.length === 2 && !!w.abc.priceBatches[0].requestId, "ONE Price Items call with a requestId, only the two items");
});

await check("no-price-and-down-keep-old-cost", async () => {
  const w = world(); await seedConn(w); user = OWNER;
  const n = addRow(w, { id: "rn", item: "Ridge vent", unit: "each", abc: "NOPRICE1", abcUnit: "EA", apexUnit: "each", abcCost: 7, lines: [{ label: "ABC Supply", amount: 7, type: "material" }], total: 7 });
  const r = await read(await call(w, [n]));
  ok(r.status === 200 && r.data.rows[0].status === "no_price" && r.data.rows[0].has_price === false, "ABC gave no price: said so");
  ok(rowOf(w, n).abc_cost === 7 && linesOf(rowOf(w, n))[0].amount === 7, "the old cost is kept");
  w.abc.down = true;
  const d = await read(await call(w, [n]));
  ok(d.status >= 500 || d.status === 502 || d.status === 503, "ABC down is an error answer (" + d.status + ")");
  ok(rowOf(w, n).abc_cost === 7, "the old cost is kept when ABC does not answer");
  ok(!HIDDEN.some((h) => d.text.indexOf(h) !== -1) && !logged.some((l) => HIDDEN.some((h) => l.indexOf(h) !== -1)), "no secret in the answer or the log");
});

await check("other-business-and-unlinked", async () => {
  const w = world(); await seedConn(w); user = OWNER;
  w.d.raw.prepare("INSERT INTO gm_pricing (id, client_id, item, unit, abc_item_number, abc_unit, abc_apex_unit, abc_cost) VALUES ('foreign', 'c2', 'Theirs', 'each', 'EACH0001', 'EA', 'each', 1)").run();
  const mine = addRow(w, { id: "plain", item: "Plain", unit: "each" });
  const r = await read(await call(w, ["foreign", mine, "nope"]));
  ok(r.status === 200 && r.data.rows.every((x) => x.status === "not_found"), "another business's row, an unlinked row and an unknown id are all not_found");
  ok(w.abc.calls.length === 0, "ABC was not called for them");
  ok(w.d.q("SELECT abc_cost FROM gm_pricing WHERE id = 'foreign'")[0].abc_cost === 1, "the other business's row is untouched");
});

await check("estimates-untouched", async () => {
  const w = world(); await seedConn(w); user = OWNER;
  const a = addRow(w, { id: "ra", item: "Pipe boot", unit: "each", abc: "EACH0001", abcUnit: "EA", apexUnit: "each", abcCost: 9, lines: [{ label: "ABC Supply", amount: 9, type: "material" }], total: 9 });
  for (const st of ["draft", "sent", "viewed", "accepted", "invoiced"]) {
    w.d.raw.prepare("INSERT INTO gm_estimates (id, client_id, lead_id, number, revision, status, mode, job_name, public_token) VALUES (?, 'c1', 'l1', ?, 1, ?, 'single', 'J', ?)").run("e-" + st, "E-" + st, st, "tok-" + st);
    w.d.raw.prepare("INSERT INTO gm_estimate_items (id, estimate_id, option_id, pricing_id, item_name, qty, unit, rate_cents, amount_cents, material_cost_cents) VALUES (?, ?, 'o', ?, 'Pipe boot', 2, 'each', 3000, 6000, 900)").run("i-" + st, "e-" + st, a);
  }
  const before = JSON.stringify(w.d.q("SELECT * FROM gm_estimate_items ORDER BY id"));
  await call(w, [a]);
  ok(rowOf(w, a).abc_cost === 12.5, "the Price list row refreshed");
  ok(JSON.stringify(w.d.q("SELECT * FROM gm_estimate_items ORDER BY id")) === before, "no estimate line (draft, sent, viewed, accepted or invoiced) is changed by the Worker route");
});

await check("only-routes-ask-abc-for-prices", async () => {
  const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  const allowed = ["handleGetGmAbcItems", "handlePostGmAbcAddItems", "handlePostGmPricingAbcLink", "abcRefreshRows", "abcDraftFreshPrices", "handlePostGmAbcDraftPrices", "handlePostGmAbcDraftSend", "handlePostGmAbcDraftsCombine"];
  const bad = [];
  let i = -1;
  while ((i = src.indexOf("abcFetchPrices(", i + 1)) !== -1) {
    const lineStart = src.lastIndexOf("\n", i) + 1;
    if (/^\s*(async\s+)?function abcFetchPrices/.test(src.slice(lineStart, lineStart + 60))) { continue; }
    const fnStart = Math.max(src.lastIndexOf("\nasync function ", i), src.lastIndexOf("\nfunction ", i));
    const name = /function (\w+)\(/.exec(src.slice(fnStart, fnStart + 80));
    if (!name || allowed.indexOf(name[1]) === -1) { bad.push(name && name[1]); }
  }
  ok(bad.length === 0, "abcFetchPrices is called only from owner routes, never from a cron, webhook or background job" + (bad.length ? " (found in " + bad.join(", ") + ")" : ""));
});

console.log(fail ? "\n" + fail + " check(s) FAILED" : "\nAll checks passed");
process.exit(fail ? 1 : 0);
