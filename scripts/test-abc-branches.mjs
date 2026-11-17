// ABC branches, estimate order branch, compare, split, delivery date or TBD, saved contacts,
// person names, ABC descriptions, Get Item and instructions (2026-11-16).
// The REAL Worker functions on an in-memory SQLite (every migration, including
// migrations/abc_branches_and_delivery.sql) with a FAKE ABC. No network, no live database,
// no real order is ever sent.
//
//   node scripts/test-abc-branches.mjs
import { readFileSync } from "node:fs";
import { makeWorld, seedConn, seedPairs, addRow, reader, sqlOf, stmts, OWNER, SELLER, RIVAL, STAFF, HIDDEN, PAIR_A, PAIR_B, PAIR_C, get, post, put } from "./fixtures/abc-world.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
async function check(name, fn) { try { await fn(); } catch (e) { console.log("FAIL  " + name + "  [" + String(e && e.stack || e).split("\n").slice(0, 3).join(" | ").slice(0, 300) + "]"); fail++; } }
let user = OWNER;
const logged = [];
console.error = function () { logged.push(Array.prototype.slice.call(arguments).map(String).join(" ")); };
const seen = [];
const read = reader(seen);
const world = (o) => makeWorld(o, () => user);
const workerSrc = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const A = { ship_to: PAIR_A.ship, branch: PAIR_A.branch }, B = { ship_to: PAIR_B.ship, branch: PAIR_B.branch }, C = { ship_to: PAIR_C.ship, branch: PAIR_C.branch };
const q = (w, p) => w.d.q(p[0], ...(p.slice(1)));

async function two(opts) { const w = world(opts); await seedConn(w); seedPairs(w, [PAIR_A, PAIR_B]); user = OWNER; return w; }
async function three() { const w = world(); await seedConn(w); seedPairs(w, [PAIR_A, PAIR_B, PAIR_C]); user = OWNER; return w; }
const items = (w, qs) => w.F.handleGetGmAbcItems("c1", get("/api/clients/c1/gm/abc/items?" + qs), w.env);

// ── readiness, backfill, routes wired ────────────────────────────────────────────────────────
await check("ready-and-backfill", async () => {
  const w = world(); ok(typeof w.F.abcBranchColumnsReady === "function", "abcBranchColumnsReady exists");
  ok((await w.F.abcBranchColumnsReady(w.env)) === true, "ready when every new table and column exists");
  const o = world({ branches: false }); ok((await o.F.abcBranchColumnsReady(o.env)) === false, "not ready without the migration");
  await seedConn(o);
  stmts(sqlOf("migrations/abc_branches_and_delivery.sql")).forEach((s) => { try { o.d.raw.exec(s); } catch (e) { if (!/duplicate column|already exists/i.test(String(e.message))) { throw e; } } });
  const rows = o.d.q("SELECT * FROM gm_abc_branches");
  ok(rows.length === 1 && rows[0].is_default === 1 && rows[0].client_id === "c1" && rows[0].ship_to_number === "2010466-2" && rows[0].branch_number === "1234" && rows[0].id === "bk-c1", "the backfill gives the existing connection exactly one default pair");
  const o2 = world({ branches: false }); await seedConn(o2, { account: false });
  stmts(sqlOf("migrations/abc_branches_and_delivery.sql")).forEach((s) => { try { o2.d.raw.exec(s); } catch (e) { /* alters */ } });
  ok(o2.d.q("SELECT * FROM gm_abc_branches").length === 0, "a connection with no account gets no pair");
  ok(/DROP INDEX IF EXISTS idx_gm_abc_drafts_live;/.test(readFileSync(new URL("../migrations/abc_branches_and_delivery.sql", import.meta.url), "utf8")), "the migration drops the old one-draft-per-contract index and remakes it with the pair");
});

await check("routes-wired", async () => {
  for (const r of ["abc/branches", "abc/branches/default", "abc/branches/remove", "abc/branch-prices", "abc/search-other-branches", "abc/branch-compare", "abc/delivery-contacts", "abc/delivery-contacts/remove", "abc/item"]) {
    ok(workerSrc.indexOf(r) !== -1, "the router knows " + r);
  }
  ok(/abc\\\/drafts\\\/\[A-Za-z0-9-\]\+\\\/\(discard\|prices\|send\|split\|refresh-descriptions\)/.test(workerSrc), "the POST allow list has split and refresh-descriptions");
});

// ── the pairs of a business ─────────────────────────────────────────────────────────────────
await check("branches-list-and-guards", async () => {
  const w = await two();
  let r = await read(await w.F.handleGetGmAbcBranches("c1", get("/x"), w.env));
  ok(r.status === 200 && r.data.pairs.length === 2 && r.data.pairs[0].is_default === true && r.data.pairs[0].branch === "1234" && r.data.pairs[1].branch === "340", "lists the pairs, default first");
  ok(!HIDDEN.some((s) => r.text.indexOf(s) !== -1), "no secret in the answer");
  const calls = {
    list: () => w.F.handleGetGmAbcBranches("c1", get("/x"), w.env),
    add: () => w.F.handlePostGmAbcBranch("c1", post("/x", C), w.env),
    def: () => w.F.handlePostGmAbcBranchDefault("c1", post("/x", B), w.env),
    rem: () => w.F.handlePostGmAbcBranchRemove("c1", post("/x", B), w.env),
    prices: () => w.F.handlePostGmAbcBranchPrices("c1", post("/x", { item_numbers: ["02GASTZ3WW"] }), w.env),
    other: () => w.F.handlePostGmAbcSearchOtherBranches("c1", post("/x", Object.assign({ q: "shingle" }, A)), w.env),
    compare: () => w.F.handlePostGmAbcBranchCompare("c1", post("/x", { estimate_id: "e1" }), w.env),
    contacts: () => w.F.handleGetGmAbcDeliveryContacts("c1", get("/x"), w.env),
    addContact: () => w.F.handlePostGmAbcDeliveryContact("c1", post("/x", { name: "Sam Lee", phone: "8135550111" }), w.env),
    remContact: () => w.F.handlePostGmAbcDeliveryContactRemove("c1", post("/x", { id: "x" }), w.env),
    item: () => w.F.handleGetGmAbcItem("c1", get("/x?item_number=02GASTZ3WW"), w.env)
  };
  const before = w.abc.calls.length;
  for (const k of Object.keys(calls)) {
    user = null; ok((await calls[k]()).status === 401, k + ": not signed in is 401");
    for (const who of [SELLER, RIVAL, STAFF]) { user = who; ok((await calls[k]()).status === 403, k + ": " + (who.login_role || who.role) + " is 403"); }
  }
  ok(w.abc.calls.length === before, "no refused request reached ABC");
});

await check("branches-not-available-before-migration", async () => {
  const w = world({ branches: false }); await seedConn(w); user = OWNER;
  ok((await w.F.handleGetGmAbcBranches("c1", get("/x"), w.env)).status === 503, "branches: Not available yet");
  ok((await w.F.handlePostGmAbcBranch("c1", post("/x", C), w.env)).status === 503, "add: Not available yet");
  ok((await w.F.handlePostGmAbcBranchPrices("c1", post("/x", { item_numbers: ["02GASTZ3WW"] }), w.env)).status === 503, "branch-prices: Not available yet");
  ok((await w.F.handleGetGmAbcDeliveryContacts("c1", get("/x"), w.env)).status === 503, "contacts: Not available yet");
  const r = await read(await items(w, "q=ridge"));
  ok(r.status === 200 && w.abc.availCalls.length === 0 && r.data.availability_checked === undefined, "item search behaves exactly as before (no availability call, no new fields)");
  const d = await read(await items(w, "q=drip"));
  ok(d.data.items.length === 0 && d.data.skipped_dimensional === 1, "before the migration a dimensional item is still skipped");
});

await check("branches-add-default-remove", async () => {
  const w = world(); await seedConn(w); user = OWNER;
  ok((await w.F.abcPairs(w.env, "c1")).length === 1 && (await w.F.abcPairs(w.env, "c1"))[0].is_default === 1, "no pair rows yet: the connection pair is answered as the single default");
  // the first pair added becomes the default even with an empty table
  w.d.raw.exec("DELETE FROM gm_abc_branches");
  let r = await read(await w.F.handlePostGmAbcBranch("c1", post("/x", A), w.env));
  ok(r.status === 200 && q(w, ["SELECT is_default FROM gm_abc_branches WHERE branch_number = '1234'"])[0].is_default === 1, "the first pair added becomes the default");
  r = await read(await w.F.handlePostGmAbcBranch("c1", post("/x", B), w.env));
  ok(r.status === 200 && q(w, ["SELECT is_default FROM gm_abc_branches WHERE branch_number = '340'"])[0].is_default === 0, "the second pair is not the default");
  ok(!w.abc.calls.some((c) => /webhook/i.test(c.path)), "adding a pair registers no webhook");
  ok((await read(await w.F.handlePostGmAbcBranch("c1", post("/x", B), w.env))).status === 200 && q(w, ["SELECT COUNT(*) AS n FROM gm_abc_branches"])[0].n === 2, "adding the same pair twice keeps one row");
  for (const bad of [{ ship_to: "2010777-9", branch: "1" }, { ship_to: "2010466-2", branch: "999" }, { ship_to: "bad ship!", branch: "340" }, { ship_to: "2010466-2" }, { ship_to: "2010466-2", branch: 340 }, {}]) {
    ok((await w.F.handlePostGmAbcBranch("c1", post("/x", bad), w.env)).status === 400, "add refused: " + JSON.stringify(bad));
  }
  // F1: a ship-to with no branches is never accepted
  ok((await w.F.handlePostGmAbcBranch("c1", post("/x", { ship_to: "2010777-9", branch: "1234" }), w.env)).status === 400, "F1: a ship-to whose branches array is empty is refused");
  // make default writes the connection columns
  r = await read(await w.F.handlePostGmAbcBranchDefault("c1", post("/x", B), w.env));
  const conn = q(w, ["SELECT ship_to_number, branch_number FROM gm_abc_connections WHERE client_id = 'c1'"])[0];
  ok(r.status === 200 && conn.branch_number === "340" && q(w, ["SELECT branch_number FROM gm_abc_branches WHERE is_default = 1"]).length === 1 && q(w, ["SELECT branch_number FROM gm_abc_branches WHERE is_default = 1"])[0].branch_number === "340", "Make default flips the default row and writes the connection columns");
  ok((await w.F.handlePostGmAbcBranchDefault("c1", post("/x", C), w.env)).status === 400, "a pair that is not the business's own cannot be made default");
  // remove
  ok((await w.F.handlePostGmAbcBranchRemove("c1", post("/x", B), w.env)).status === 409, "the default pair cannot be removed");
  w.d.raw.prepare("INSERT INTO gm_abc_order_drafts (id, client_id, contract_id, job_name, ship_to_number, branch_number) VALUES ('dx', 'c1', 'conx', 'J', ?, ?)").run(A.ship_to, A.branch);
  ok((await w.F.handlePostGmAbcBranchRemove("c1", post("/x", A), w.env)).status === 409, "a pair a live draft uses cannot be removed");
  w.d.raw.exec("DELETE FROM gm_abc_order_drafts");
  w.d.raw.prepare("INSERT INTO gm_estimates (id, client_id, lead_id, number, revision, status, mode, job_name, public_token) VALUES ('e9', 'c1', 'l9', 'E-9', 1, 'draft', 'single', 'J', 't9')").run();
  w.d.raw.prepare("INSERT INTO gm_estimate_items (id, estimate_id, option_id, item_name, qty, rate_cents, amount_cents, sort_order, abc_ship_to, abc_branch) VALUES ('l9', 'e9', 'o9', 'X', 1, 1, 1, 0, ?, ?)").run(A.ship_to, A.branch);
  ok((await w.F.handlePostGmAbcBranchRemove("c1", post("/x", A), w.env)).status === 409, "a pair an estimate line uses cannot be removed");
  w.d.raw.exec("DELETE FROM gm_estimate_items");
  ok((await w.F.handlePostGmAbcBranchRemove("c1", post("/x", A), w.env)).status === 200 && q(w, ["SELECT COUNT(*) AS n FROM gm_abc_branches"])[0].n === 1, "an unused, non default pair is removed");
  ok((await w.F.handlePostGmAbcBranchRemove("c1", post("/x", { ship_to: "x y", branch: "1" }), w.env)).status === 400, "remove with a bad pair is 400");
});

await check("branches-ten-limit", async () => {
  const w = world(); await seedConn(w); user = OWNER;
  for (let i = 0; i < 10; i++) { w.d.raw.prepare("INSERT INTO gm_abc_branches (id, client_id, ship_to_number, branch_number, is_default) VALUES (?, 'c1', ?, ?, ?)").run("k" + i, "2010466-2", String(500 + i), i === 0 ? 1 : 0); }
  const r = await read(await w.F.handlePostGmAbcBranch("c1", post("/x", B), w.env));
  ok(r.status === 400 && /10/.test(r.text), "a business with ten pairs refuses the eleventh with a plain message");
  ok(q(w, ["SELECT COUNT(*) AS n FROM gm_abc_branches"])[0].n === 10, "nothing was added");
});

// ── item search for the active branch ───────────────────────────────────────────────────────
await check("items-active-pair", async () => {
  const w = await two();
  w.abc.carried["340"] = ["02GASTZ3WW", "RIDGE0001"];
  w.abc.carried["1234"] = ["02GASTZ3WW", "RIDGE0001", "NOPRICE1", "DIMLEN01"];
  w.abc.prices["RIDGE0001"] = { uom: "BD", price: 55 };
  let r = await read(await items(w, "q=ridge&ship_to=" + B.ship_to + "&branch=" + B.branch));
  ok(r.status === 200 && r.data.items.length === 1 && r.data.items[0].item_number === "RIDGE0001", "item search lists only items the ACTIVE branch carries (F2): " + JSON.stringify((r.data && r.data.items || []).map((i) => i.item_number)));
  ok(r.data.hidden_not_carried === 1 && r.data.availability_checked === true && r.data.branch === "340" && r.data.ship_to === "2010466-2", "one item hidden because 340 does not carry it, availability checked, branch named");
  const av = w.abc.availCalls[0];
  ok(av && av.filters.some((f) => f.key === "branchNumber" && f.condition === "equals" && f.values.join() === "340") && av.filters.some((f) => f.key === "itemNumber" && f.condition === "equals" && f.values.indexOf("RIDGE0001") !== -1), "availability is asked for those item numbers at branch 340 with equals filters");
  ok(w.abc.priceBatches.every((b) => b.branchNumber === "340"), "prices are asked for the active pair only");
  r = await read(await items(w, "q=ridge"));
  ok(r.data.branch === "1234" && r.data.items.length === 2, "no pair sent: the default pair, which carries both (" + (r.data.items || []).length + ")");
  // pair validation
  ok((await items(w, "q=ridge&ship_to=" + C.ship_to + "&branch=" + C.branch)).status === 400, "a pair that is not the business's own is 400");
  ok((await items(w, "q=ridge&ship_to=" + A.ship_to)).status === 400, "a ship_to without a branch is 400");
  ok((await items(w, "q=ridge&ship_to=bad%20x&branch=1")).status === 400, "a malformed pair is 400");
  // a rival cannot use this business's pair
  user = RIVAL; ok((await items(w, "q=ridge&ship_to=" + B.ship_to + "&branch=" + B.branch)).status === 403, "another business cannot ask");
  user = OWNER;
});

await check("items-counts-dimensional-and-failure", async () => {
  const w = await two();
  w.abc.searchTotal = 214;
  let r = await read(await items(w, "q=ridge"));
  ok(r.data.total_items === 214 && r.data.more_available === true && r.data.items.length === 2, "totalItems 214 with 2 shown: more_available is true");
  w.abc.searchTotal = null;
  r = await read(await items(w, "q=ridge"));
  ok(r.data.more_available === false && r.data.total_items === 2, "everything shown: more_available false");
  r = await read(await items(w, "q=drip"));
  ok(r.data.items.length === 1 && r.data.items[0].dimensional === true && r.data.items[0].item_number === "DIMLEN01", "an item sold in lengths is listed with dimensional: true");
  // availability failure never hides results
  w.abc.availFail = 500;
  r = await read(await items(w, "q=ridge"));
  ok(r.status === 200 && r.data.availability_checked === false && r.data.items.length === 2 && r.data.hidden_not_carried === 0, "availability fails with 500: results still shown, availability_checked false, nothing hidden");
  // a 400 retries with half the values
  w.abc.availFail = (j) => (j.filters.find((f) => f.key === "itemNumber").values.length > 1 ? 400 : null);
  const calls0 = w.abc.availCalls.length;
  r = await read(await items(w, "q=ridge"));
  ok(r.data.availability_checked === true && w.abc.availCalls.length - calls0 >= 3, "a 400 is retried with half the item numbers (" + (w.abc.availCalls.length - calls0) + " calls)");
  w.abc.availFail = null;
  // many items: at most 20 per availability call
  const bulk = []; for (let i = 0; i < 45; i++) { bulk.push("BULK" + i); }
  bulk.forEach((n) => { w.abc.carried["1234"].push(n); });
  const res = await w.F.abcAvailability({ api_origin: "https://partners-sb.abcsupply.com" }, "ABCACCESS-aaa111", bulk, ["1234"], []);
  ok(res.ok === true && w.abc.availCalls.slice(-3).every((c) => c.filters.find((f) => f.key === "itemNumber").values.length <= 20), "45 item numbers go out in calls of at most 20");
});

await check("items-other-branches-annotate-only", async () => {
  const w = await three();
  w.abc.carried["1234"] = ["02GASTZ3WW", "RIDGE0001"];
  w.abc.carried["340"] = ["RIDGE0001", "EACH0001", "PAVER6X9"];
  w.abc.carried["55"] = ["02GASTZ3WW"];
  w.abc.pairPrices["2010466-2|340"] = { RIDGE0001: { uom: "BD", price: 49 } };
  w.abc.prices["RIDGE0001"] = { uom: "BD", price: 55 };
  const r = await read(await items(w, "q=ridge&other_branches=1"));
  const ridge = r.data.items.find((i) => i.item_number === "RIDGE0001");
  ok(r.data.items.length === 1 && ridge && Array.isArray(ridge.others) && ridge.others.length === 2, "other_branches=1 annotates each returned item once per OTHER pair (" + (ridge && ridge.others && ridge.others.length) + ")");
  const o340 = ridge.others.find((o) => o.branch === "340"), o55 = ridge.others.find((o) => o.branch === "55");
  ok(o340.carried === true && o340.price === 49 && o340.uom === "BD" && o340.ship_to === "2010466-2", "branch 340 carries it at its own price");
  ok(o55.carried === false && o55.price === null, "branch 55 does not carry it: carried false, no price");
  ok(!r.data.items.some((i) => i.item_number === "PAVER6X9" || i.item_number === "EACH0001"), "items another branch carries are never added to the results (F2)");
  ok(w.abc.priceBatches.some((b) => b.branchNumber === "340") && !w.abc.priceBatches.some((b) => b.branchNumber === "55"), "an item a branch does not carry is not priced there");
  // checked null when availability cannot be checked
  const w2 = await three(); w2.abc.availFail = (j) => (j.filters.find((f) => f.key === "branchNumber").values.indexOf("340") !== -1 && j.filters.find((f) => f.key === "branchNumber").values.length === 1 ? 500 : null);
  w2.abc.carried["1234"] = ["RIDGE0001"];
  const r2 = await read(await items(w2, "q=ridge&other_branches=1"));
  const ridge2 = r2.data.items.find((i) => i.item_number === "RIDGE0001");
  ok(ridge2 && ridge2.others.every((o) => o.carried === null || o.carried === false || o.carried === true), "carried is true, false or null (null when it could not be checked)");
  ok(!w.abc.calls.some((c) => /webhook|cron/.test(c.path)), "no background call");
});

await check("items-other-branches-counts-as-three", async () => {
  const w = await two();
  let first = 0;
  for (let i = 1; i <= 30; i++) { const r = await items(w, "q=ridge&other_branches=1"); if (r.status === 429 && !first) { first = i; } }
  ok(first === 21, "an other_branches request counts as 3: the 21st in the window is the first 429 (got " + first + ")");
  const w2 = await two(); let f2 = 0;
  for (let i = 1; i <= 70; i++) { const r = await items(w2, "q=ridge"); if (r.status === 429 && !f2) { f2 = i; } }
  ok(f2 === 61, "a plain search is still 60 per window (got " + f2 + ")");
});

// ── prices and availability per branch ──────────────────────────────────────────────────────
await check("branch-prices", async () => {
  const w = await three();
  w.abc.carried["1234"] = ["02GASTZ3WW", "NOPRICE1"]; w.abc.carried["340"] = ["02GASTZ3WW"]; w.abc.carried["55"] = [];
  w.abc.pairPrices["2010466-2|340"] = { "02GASTZ3WW": { uom: "BD", price: 38 } };
  let r = await read(await w.F.handlePostGmAbcBranchPrices("c1", post("/x", { item_numbers: ["02GASTZ3WW", "NOPRICE1"] }), w.env));
  ok(r.status === 200 && r.data.pairs.length === 3, "one entry per pair of the business");
  const a = r.data.pairs.find((p) => p.branch === "1234"), b = r.data.pairs.find((p) => p.branch === "340"), c = r.data.pairs.find((p) => p.branch === "55");
  ok(a.is_default === true && a.items["02GASTZ3WW"].carried === true && a.items["02GASTZ3WW"].price === 41.5 && a.items["02GASTZ3WW"].uom === "BD", "default pair: carried, its price and unit");
  ok(a.items["NOPRICE1"].carried === true && a.items["NOPRICE1"].price === null, "carried but ABC gave no price: price null");
  ok(b.items["02GASTZ3WW"].price === 38 && b.items["NOPRICE1"].carried === false && b.items["NOPRICE1"].price === null, "branch 340: its own price; an item it does not carry is carried false");
  ok(c.items["02GASTZ3WW"].carried === false && c.items["02GASTZ3WW"].price === null, "branch 55 carries nothing");
  ok(!w.abc.priceBatches.some((p) => p.branchNumber === "55"), "nothing is priced at a branch that carries none of the items");
  ok(r.data.pairs.every((p) => p.ship_to_name !== undefined && p.branch_name !== undefined), "names are answered");
  // availability could not be checked: carried null
  w.abc.availFail = 500;
  r = await read(await w.F.handlePostGmAbcBranchPrices("c1", post("/x", { item_numbers: ["02GASTZ3WW"] }), w.env));
  ok(r.data.pairs.every((p) => p.items["02GASTZ3WW"].carried === null), "availability failed: carried is null for every pair");
  w.abc.availFail = null;
  for (const bad of [{ item_numbers: [] }, { item_numbers: "x" }, { item_numbers: ["bad item!"] }, {}, { item_numbers: Array.from({ length: 51 }, (_, i) => "I" + i) }, { item_numbers: ["A", "A"] }]) {
    ok((await w.F.handlePostGmAbcBranchPrices("c1", post("/x", bad), w.env)).status === 400, "refused: " + JSON.stringify(bad).slice(0, 60));
  }
  let first = 0;
  const wr = await three();
  for (let i = 1; i <= 30; i++) { const rr = await wr.F.handlePostGmAbcBranchPrices("c1", post("/x", { item_numbers: ["02GASTZ3WW"] }), wr.env); if (rr.status === 429 && !first) { first = i; } }
  ok(first === 21, "branch-prices: the 21st request in the window is the first 429 (got " + first + ")");
  ok(q(w, ["SELECT COUNT(*) AS n FROM gm_pricing"])[0].n === 0, "nothing is stored");
});

await check("search-other-branches", async () => {
  const w = await three();
  w.abc.carried["1234"] = ["RIDGE0001"]; w.abc.carried["340"] = ["RIDGE0001"]; w.abc.carried["55"] = ["NOPRICE1"];
  const r = await read(await w.F.handlePostGmAbcSearchOtherBranches("c1", post("/x", Object.assign({ q: "ridge" }, A)), w.env));
  ok(r.status === 200 && r.data.groups.length === 2 && r.data.groups.every((g) => g.branch !== "1234"), "groups for the OTHER pairs only");
  const g340 = r.data.groups.find((g) => g.branch === "340"), g55 = r.data.groups.find((g) => g.branch === "55");
  ok(g340.items.length === 1 && g340.items[0].item_number === "RIDGE0001" && g340.availability_checked === true && g340.ship_to_name === "Zeta Roofing" && g340.branch_name === "Orem", "branch 340: the item it carries, with its names");
  ok(g55.items.length === 1 && g55.items[0].item_number === "NOPRICE1" && g55.items[0].has_price === false, "branch 55: only what it carries (ridge cap is hidden)");
  for (const bad of [{ q: "ab" }, { q: "<script>" }, { q: "ridge" }, { q: "ridge", ship_to: C.ship_to, branch: "9" }, { q: 5, ship_to: A.ship_to, branch: A.branch }]) {
    ok((await w.F.handlePostGmAbcSearchOtherBranches("c1", post("/x", bad), w.env)).status === 400, "refused: " + JSON.stringify(bad));
  }
  let first = 0;
  const wr = await three();
  for (let i = 1; i <= 15; i++) { const rr = await wr.F.handlePostGmAbcSearchOtherBranches("c1", post("/x", Object.assign({ q: "ridge" }, A)), wr.env); if (rr.status === 429 && !first) { first = i; } }
  ok(first === 11, "search-other-branches: the 11th request in the window is the first 429 (got " + first + ")");
});

// ── compare branches for an order ───────────────────────────────────────────────────────────
await check("compare-rank-pure", async () => {
  const w = world();
  const P = (o) => Object.assign({ is_default: false, carried_count: 0, line_count: 3, complete: false, total: null, carried_total: 0, availability_checked: true }, o);
  const rank = (arr) => w.F.abcCompareRank(arr);
  let r = rank([P({ ship_to: "S", branch: "1", is_default: true, carried_count: 3, complete: true, total: 300, carried_total: 300 }), P({ ship_to: "S", branch: "2", carried_count: 3, complete: true, total: 250, carried_total: 250 })]);
  ok(r.recommended.branch === "2" && r.pairs.find((p) => p.branch === "2").reason_code === "lowest_total_all_items" && r.saving_vs_next === 50, "two complete pairs: the lowest total wins, saving 50 over the next");
  r = rank([P({ ship_to: "S", branch: "1", is_default: true, carried_count: 3, complete: true, total: 300, carried_total: 300 }), P({ ship_to: "S", branch: "2", carried_count: 2, complete: false, total: null, carried_total: 100 })]);
  ok(r.recommended.branch === "1" && r.pairs[0].reason_code === "carries_all_items" && r.saving_vs_next === null, "a cheaper pair that misses an item loses to a dearer pair that carries all; no saving with one complete pair");
  r = rank([P({ ship_to: "S", branch: "1", is_default: true, carried_count: 1, carried_total: 10 }), P({ ship_to: "S", branch: "2", carried_count: 2, carried_total: 90 }), P({ ship_to: "S", branch: "3", carried_count: 2, carried_total: 80 })]);
  ok(r.recommended.branch === "3" && r.pairs.find((p) => p.branch === "3").reason_code === "most_items_available", "nobody carries all: most items, then the lowest total of those");
  r = rank([P({ ship_to: "S", branch: "2", carried_count: 3, complete: true, total: 100, carried_total: 100 }), P({ ship_to: "S", branch: "1", is_default: true, carried_count: 3, complete: true, total: 100, carried_total: 100 })]);
  ok(r.recommended.branch === "1" && r.pairs.find((p) => p.branch === "1").reason_code === "tie_default" && r.saving_vs_next === 0, "a tie keeps the default pair first");
  r = rank([P({ ship_to: "S", branch: "1", is_default: true }), P({ ship_to: "S", branch: "2" })]);
  ok(r.recommended === null, "no pair carries any line: recommended is null");
  r = rank([P({ ship_to: "S", branch: "1", is_default: true, availability_checked: false }), P({ ship_to: "S", branch: "2", availability_checked: false })]);
  ok(r.recommended === null && r.pairs.every((p) => p.reason_code === "not_checked"), "availability not checked: no recommendation, reason not_checked");
  r = rank([P({ ship_to: "S", branch: "1", is_default: true, carried_count: 3, complete: true, total: 5, carried_total: 5 })]);
  ok(r.recommended.branch === "1" && r.pairs[0].reason_code === "only_branch", "one pair: only_branch");
});

async function seedCompare(w, linePairs) {
  // a draft of two lines (shingle 10 BD, ridge 4 BD); the ABC unit of both is BD
  w.d.raw.prepare("INSERT INTO gm_abc_order_drafts (id, client_id, contract_id, job_name, order_ref, ship_to_number, branch_number) VALUES ('dc', 'c1', 'conc', 'J', 'AP-CMP00001', ?, ?)").run(A.ship_to, A.branch);
  w.d.raw.prepare("INSERT INTO gm_abc_order_draft_lines (id, draft_id, client_id, item_number, description, quantity, uom, sort_order, abc_description) VALUES ('dl1', 'dc', 'c1', '02GASTZ3WW', 'GAF', 10, 'BD', 0, 'GAF Timberline HD Weathered Wood')").run();
  w.d.raw.prepare("INSERT INTO gm_abc_order_draft_lines (id, draft_id, client_id, item_number, description, quantity, uom, sort_order, abc_description) VALUES ('dl2', 'dc', 'c1', 'RIDGE0001', 'Ridge', 4, 'BD', 1, 'Ridge cap shingle 20 Linear Feet per Bundle')").run();
}
const compare = async (w, body) => read(await w.F.handlePostGmAbcBranchCompare("c1", post("/x", body), w.env));

await check("compare-route", async () => {
  const w = await three(); await seedCompare(w);
  w.abc.carried["1234"] = ["02GASTZ3WW", "RIDGE0001"]; w.abc.carried["340"] = ["02GASTZ3WW", "RIDGE0001"]; w.abc.carried["55"] = ["02GASTZ3WW"];
  w.abc.prices["RIDGE0001"] = { uom: "BD", price: 50 };
  w.abc.pairPrices["2010466-2|340"] = { "02GASTZ3WW": { uom: "BD", price: 30 }, RIDGE0001: { uom: "BD", price: 45 } };
  w.abc.pairPrices["2010999-1|55"] = { "02GASTZ3WW": { uom: "BD", price: 20 } };
  const before = JSON.stringify([q(w, ["SELECT * FROM gm_abc_order_drafts"]), q(w, ["SELECT * FROM gm_abc_order_draft_lines"])]);
  const r = await compare(w, { draft_id: "dc" });
  ok(r.status === 200 && r.data.pairs.length === 3, "one card per pair");
  const a = r.data.pairs.find((p) => p.branch === "1234"), b = r.data.pairs.find((p) => p.branch === "340"), c = r.data.pairs.find((p) => p.branch === "55");
  ok(a.complete === true && a.total === 41.5 * 10 + 50 * 4 && a.carried_count === 2 && a.priced_count === 2, "default pair: total is quantity times price (615)");
  ok(a.lines[0].line_id === "dl1" && a.lines[0].line_total === 415 && a.lines[0].carried === true && a.lines[0].price === 41.5 && a.lines[0].uom === "BD", "per line figures");
  ok(b.complete === true && b.total === 30 * 10 + 45 * 4, "branch 340 total 480");
  ok(c.complete === false && c.total === null && c.carried_count === 1 && c.missing.length === 1 && c.missing[0].item_number === "RIDGE0001" && c.missing[0].description.length > 0, "branch 55 misses ridge: no total, missing listed with a description");
  ok(c.lines[0].line_total === 200 && c.lines[1].carried === false && c.lines[1].line_total === null, "a line it carries still has its line total");
  ok(r.data.recommended.branch === "340" && b.reason_code === "lowest_total_all_items" && b.rank === 1 && r.data.saving_vs_next === 135, "340 is recommended, saving 135 over the next complete pair");
  ok(r.data.availability_checked === true, "availability was checked");
  ok(before === JSON.stringify([q(w, ["SELECT * FROM gm_abc_order_drafts"]), q(w, ["SELECT * FROM gm_abc_order_draft_lines"])]), "the route never changes the draft");
  // unit mismatch
  w.abc.pairPrices["2010466-2|340"] = { "02GASTZ3WW": { uom: "SQ", price: 120 }, RIDGE0001: { uom: "BD", price: 45 } };
  const m = await compare(w, { draft_id: "dc" });
  const mb = m.data.pairs.find((p) => p.branch === "340");
  ok(mb.lines[0].unit_mismatch === true && mb.lines[0].line_total === null && mb.complete === false && mb.total === null, "a price in another unit is a unit mismatch: no line total, not complete");
  // availability not checked
  w.abc.availFail = 500;
  const n = await compare(w, { draft_id: "dc" });
  ok(n.data.availability_checked === false && n.data.recommended === null && n.data.pairs.every((p) => p.reason_code === "not_checked"), "availability not checked: no recommendation");
  w.abc.availFail = null;
  // none carries anything
  w.abc.carried["1234"] = []; w.abc.carried["340"] = []; w.abc.carried["55"] = [];
  const z = await compare(w, { draft_id: "dc" });
  ok(z.data.recommended === null && z.data.pairs.every((p) => p.carried_count === 0), "no pair carries anything: recommended null");
  // input
  for (const bad of [{}, { draft_id: "dc", estimate_id: "e1" }, { draft_id: "bad id!" }, { draft_id: 5 }]) { ok((await w.F.handlePostGmAbcBranchCompare("c1", post("/x", bad), w.env)).status === 400, "refused: " + JSON.stringify(bad)); }
  w.d.raw.prepare("INSERT INTO gm_abc_order_drafts (id, client_id, contract_id, job_name) VALUES ('fd', 'c2', 'conz', 'Theirs')").run();
  ok((await w.F.handlePostGmAbcBranchCompare("c1", post("/x", { draft_id: "fd" }), w.env)).status === 404, "another business's draft is 404");
  ok((await w.F.handlePostGmAbcBranchCompare("c1", post("/x", { estimate_id: "nope" }), w.env)).status === 404, "an unknown estimate is 404");
});

// ── the estimate's order branch ─────────────────────────────────────────────────────────────
function estBody(lines) { return { mode: "single", options: [{ items: lines.map((l) => Object.assign({ item_name: "L", qty: 1, rate_cents: 0 }, l)) }] }; }
await check("estimate-order-branch", async () => {
  const w = await two();
  addRow(w, { id: "p-abc1", item: "GAF", abc: "02GASTZ3WW", abcUnit: "BD" });
  addRow(w, { id: "p-abc2", item: "Ridge", abc: "RIDGE0001", abcUnit: "BD" });
  addRow(w, { id: "p-labor", item: "Labor", unit: "hr" });
  const parse = (lines, ready) => w.F.gmEstParseOptions(w.env, "c1", estBody(lines), true);
  let r = await parse([{ pricing_id: "p-labor" }, { pricing_id: "p-abc1", abc_ship_to: B.ship_to, abc_branch: B.branch }, { pricing_id: "p-abc2" }]);
  const its = r.options[0].items;
  ok(!r.error && its[1].abc_branch === "340" && its[1].abc_ship_to === "2010466-2", "the first ABC line takes the pair of the active tab sent with it");
  ok(its[2].abc_branch === "340", "a later ABC line with no pair takes the estimate's order branch");
  ok(!its[0].abc_branch, "a line that is not from ABC carries no pair");
  r = await parse([{ pricing_id: "p-abc1", abc_ship_to: A.ship_to, abc_branch: A.branch }, { pricing_id: "p-abc2", abc_ship_to: B.ship_to, abc_branch: B.branch }]);
  ok(!r.error && r.options[0].items[1].abc_branch === "340", "a line may accept an explicit pair of the business (a split)");
  r = await parse([{ pricing_id: "p-abc1", abc_ship_to: C.ship_to, abc_branch: C.branch }]);
  ok(!!r.error, "a pair that is not the business's own is refused");
  r = await parse([{ pricing_id: "p-abc1", abc_ship_to: A.ship_to }]);
  ok(!!r.error, "a ship_to without a branch is refused");
  r = await parse([{ pricing_id: "p-abc1" }]);
  ok(!r.error && r.options[0].items[0].abc_branch === "1234", "no pair at all: the default pair is written for a business with several pairs");
  // one pair: nothing new is stored
  const one = world(); await seedConn(one); user = OWNER; addRow(one, { id: "p-abc1", item: "GAF", abc: "02GASTZ3WW", abcUnit: "BD" });
  const r1 = await one.F.gmEstParseOptions(one.env, "c1", estBody([{ pricing_id: "p-abc1" }]), true);
  ok(!r1.error && !r1.options[0].items[0].abc_branch, "a business with one pair stores nothing new");
  // before the migration nothing changes and a sent pair is ignored
  const old = world({ branches: false }); await seedConn(old); user = OWNER; addRow(old, { id: "p-abc1", item: "GAF", abc: "02GASTZ3WW", abcUnit: "BD" });
  const r0 = await old.F.gmEstParseOptions(old.env, "c1", estBody([{ pricing_id: "p-abc1", abc_ship_to: "2010466-2", abc_branch: "1234" }]), true);
  ok(!r0.error && !r0.options[0].items[0].abc_branch, "before the migration: no pair is read or written");
});

// ── drafts per pair, delivery date or TBD, people, contacts, instructions, descriptions ───────
const future = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const past = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
function seedPricing(w) {
  addRow(w, { id: "p-gaf", item: "GAF Timberline HD", unit: "bundle", abc: "02GASTZ3WW", abcUnit: "BD", apexUnit: "bundle", abcCost: 41.5 });
  addRow(w, { id: "p-ridge", item: "Ridge cap", unit: "bundle", abc: "RIDGE0001", abcUnit: "BD", apexUnit: "bundle", abcCost: 50 });
  addRow(w, { id: "p-boot", item: "Pipe boot each", unit: "each", abc: "EACH0001", abcUnit: "EA", apexUnit: "each", abcCost: 12.5 });
  // before the migration the column does not exist: the old world has no ABC description to save
  try {
    w.d.raw.exec("UPDATE gm_pricing SET abc_description = 'GAF Timberline HD Weathered Wood' WHERE id = 'p-gaf'");
    w.d.raw.exec("UPDATE gm_pricing SET abc_description = 'Ridge cap shingle 20 Linear Feet per Bundle' WHERE id = 'p-ridge'");
    w.d.raw.exec("UPDATE gm_pricing SET abc_description = 'Pipe boot each' WHERE id = 'p-boot'");
  } catch (e) { /* the old world */ }
  w.d.raw.prepare("INSERT INTO gm_doc_settings (client_id, legal_name, address, phone, email) VALUES ('c1', 'Zeta Roofing LLC', '12 Main St, Tampa, FL 33602', '8135550100', 'office@zeta.example')").run();
}
let seq = 0;
// lines: [[pricing_id, qty, unit, pair?]]
function seedContract(w, lines) {
  const k = ++seq;
  w.d.raw.prepare("INSERT INTO gm_leads (id, client_id, cliente, addr_access) VALUES (?, 'c1', 'Smith', ?)").run("lead" + k, "Gate code 4521");
  w.d.raw.prepare("INSERT INTO gm_jobs (id, client_id, lead_id, obra, job_name, addr_street, addr_city, addr_state, addr_zip) VALUES (?, 'c1', ?, ?, ?, ?, ?, ?, ?)").run("job" + k, "lead" + k, "Obra " + k, "Smith roof " + k, k + " Oak St", "Tampa", "FL", "33602");
  w.d.raw.prepare("INSERT INTO gm_estimates (id, client_id, lead_id, job_id, number, revision, status, mode, job_name, public_token, accepted_option_id) VALUES (?, 'c1', ?, ?, ?, 1, 'accepted', 'single', ?, ?, ?)").run("est" + k, "lead" + k, "job" + k, "E-" + k, "Smith roof " + k, "tok" + k, "opt" + k);
  w.d.raw.prepare("INSERT INTO gm_estimate_options (id, estimate_id, tier, sort_order) VALUES (?, ?, 'single', 0)").run("opt" + k, "est" + k);
  lines.forEach((l, i) => {
    try {
      w.d.raw.prepare("INSERT INTO gm_estimate_items (id, estimate_id, option_id, pricing_id, item_name, qty, unit, rate_cents, amount_cents, sort_order, abc_ship_to, abc_branch) VALUES (?, ?, ?, ?, ?, ?, ?, 1000, 1000, ?, ?, ?)")
        .run("il" + k + "-" + i, "est" + k, "opt" + k, l[0], "Line " + i, l[1], l[2], i, l[3] ? l[3].ship_to : "", l[3] ? l[3].branch : "");
    } catch (e) { // the world before the migration has no pair columns
      w.d.raw.prepare("INSERT INTO gm_estimate_items (id, estimate_id, option_id, pricing_id, item_name, qty, unit, rate_cents, amount_cents, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 1000, 1000, ?)")
        .run("il" + k + "-" + i, "est" + k, "opt" + k, l[0], "Line " + i, l[1], l[2], i);
    }
  });
  w.d.raw.prepare("INSERT INTO gm_contracts (id, client_id, job_id, lead_id, estimate_ids_json, number, status, public_token, homeowner_signed_at, company_signed_at) VALUES (?, 'c1', ?, ?, ?, ?, 'completed', ?, '2026-11-02 10:00:00', '2026-11-01 10:00:00')")
    .run("con" + k, "job" + k, "lead" + k, JSON.stringify(["est" + k]), "CON-000" + k, "ctok" + k);
  return "con" + k;
}
const draftsOf = (w) => w.d.q("SELECT * FROM gm_abc_order_drafts ORDER BY rowid");
const linesOfDraft = (w, did) => w.d.q("SELECT * FROM gm_abc_order_draft_lines WHERE draft_id = ? ORDER BY sort_order", did);
const getDraft = async (w, did) => read(await w.F.handleGetGmAbcDraft("c1", did, get("/x"), w.env));
const putDraft = async (w, did, body) => read(await w.F.handlePutGmAbcDraft("c1", did, put("/x", body), w.env));
const sendDraft = async (w, did, prices) => read(await w.F.handlePostGmAbcDraftSend("c1", did, post("/x", { prices: prices || {} }), w.env));
const READY = () => ({ delivery_service: "OTG", delivery_to: "job", delivery_date: future(10), contact_name: "Zeta Owner", contact_email: "office@zeta.example", contact_phone: "8135550100", delivery_contact_name: "Sam Lee", delivery_contact_phone: "(813) 555-0111" });
async function priced(w, did) {
  await w.F.handlePostGmAbcDraftPrices("c1", did, post("/x", {}), w.env);
  const g = await getDraft(w, did);
  return Object.fromEntries(g.data.lines.filter((l) => !l.removed).map((l) => [l.id, l.unit_price]));
}
async function oneDraft(w, lines) {
  const con = seedContract(w, lines || [["p-gaf", 10, "bundle"], ["p-boot", 3, "each"]]);
  await w.F.handlePostGmAbcDraftEnsure("c1", post("/x", { contract_id: con }), w.env);
  return { con, did: (draftsOf(w).find((d) => d.contract_id === con) || {}).id };
}
async function draftWorld(opts) { const w = world(opts); seedPricing(w); await seedConn(w); if (!opts || opts.pairs !== false) { seedPairs(w, [PAIR_A, PAIR_B, PAIR_C]); } user = OWNER; return w; }

await check("one-draft-per-pair", async () => {
  const w = await draftWorld();
  const con = seedContract(w, [["p-gaf", 10, "bundle", A], ["p-ridge", 4, "bundle", B], ["p-boot", 3, "each", A]]);
  await w.F.abcDraftEnsureForContract(w.env, "c1", con, "Signer");
  await w.F.abcDraftEnsureForContract(w.env, "c1", con, "Signer");
  const ds = draftsOf(w);
  ok(ds.length === 2, "lines at two pairs: two drafts, and ensuring twice makes no more (got " + ds.length + ")");
  const da = ds.find((d) => d.branch_number === "1234"), db = ds.find((d) => d.branch_number === "340");
  ok(da && db && da.ship_to_number === "2010466-2" && linesOfDraft(w, da.id).length === 2 && linesOfDraft(w, db.id).length === 1 && linesOfDraft(w, db.id)[0].item_number === "RIDGE0001", "each draft holds only the lines of its own pair");
  ok(linesOfDraft(w, db.id)[0].abc_description === "Ridge cap shingle 20 Linear Feet per Bundle", "the line carries ABC's own description");
  await w.F.handlePostGmAbcDraftDiscard("c1", db.id, post("/x", {}), w.env);
  await w.F.abcDraftEnsureForContract(w.env, "c1", con, "Signer");
  ok(draftsOf(w).length === 2 && draftsOf(w).find((d) => d.id === db.id).status === "discarded", "a discarded draft is never made again for the same contract and pair");
  // single pair contract: exactly one draft, as today
  const w2 = await draftWorld({ pairs: false });
  const c2 = seedContract(w2, [["p-gaf", 10, "bundle"], ["p-ridge", 4, "bundle"]]);
  await w2.F.abcDraftEnsureForContract(w2.env, "c1", c2, "Signer");
  ok(draftsOf(w2).length === 1 && draftsOf(w2)[0].ship_to_number === "" && linesOfDraft(w2, draftsOf(w2)[0].id).length === 2, "one pair: exactly one draft, no pair stored");
  // an older draft with an empty pair counts as the default pair
  const w3 = await draftWorld();
  const c3 = seedContract(w3, [["p-gaf", 10, "bundle", A]]);
  w3.d.raw.prepare("INSERT INTO gm_abc_order_drafts (id, client_id, contract_id, job_name, order_ref) VALUES ('old1', 'c1', ?, 'J', 'AP-OLD00001')").run(c3);
  await w3.F.abcDraftEnsureForContract(w3.env, "c1", c3, "Signer");
  ok(draftsOf(w3).length === 1, "an older draft with an empty pair is the default pair's draft: no duplicate");
  // no new draft for a discarded default draft either
  w3.d.raw.exec("UPDATE gm_abc_order_drafts SET status = 'discarded'");
  await w3.F.abcDraftEnsureForContract(w3.env, "c1", c3, "Signer");
  ok(draftsOf(w3).length === 1, "the discarded older draft is never remade");
});

await check("draft-pair-change-and-pricing", async () => {
  const w = await draftWorld();
  const { did } = await oneDraft(w);
  w.abc.pairPrices["2010466-2|340"] = { "02GASTZ3WW": { uom: "BD", price: 38 }, EACH0001: { uom: "EA", price: 10 } };
  const p1 = await priced(w, did);
  ok(w.abc.priceBatches.every((b) => b.branchNumber === "1234") && Object.values(p1).includes(41.5), "an empty pair prices for the default pair");
  ok((await putDraft(w, did, { ship_to: B.ship_to })).status === 400 && (await putDraft(w, did, { ship_to: C.ship_to, branch: "9" })).status === 400, "one half of a pair, or a pair that is not the business's: 400");
  const r = await putDraft(w, did, { ship_to: B.ship_to, branch: B.branch });
  ok(r.status === 200 && draftsOf(w)[0].branch_number === "340", "the pair is saved");
  ok(linesOfDraft(w, did).every((l) => l.unit_price === null), "changing the pair clears every line price (the old price belonged to the old pair)");
  w.abc.priceBatches.length = 0;
  const p2 = await priced(w, did);
  ok(w.abc.priceBatches.length > 0 && w.abc.priceBatches.every((b) => b.branchNumber === "340" && b.shipToNumber === "2010466-2") && Object.values(p2).includes(38), "the price route prices for the DRAFT's pair");
  // sending uses the draft's pair
  await putDraft(w, did, READY());
  const s = await sendDraft(w, did, p2);
  ok(s.status === 200 && w.abc.orders.length === 1 && w.abc.orders[0].branchNumber === "340" && w.abc.orders[0].shipTo.number === "2010466-2", "send uses the draft's pair for branchNumber and shipTo.number (" + s.status + " " + s.text.slice(0, 120) + ")");
  // an older draft with an empty pair sends to the default pair
  const w2 = await draftWorld();
  const o = await oneDraft(w2);
  await putDraft(w2, o.did, READY());
  w2.d.raw.prepare("UPDATE gm_abc_order_drafts SET ship_to_number = '', branch_number = '' WHERE id = ?").run(o.did);
  const s2 = await sendDraft(w2, o.did, await priced(w2, o.did));
  ok(s2.status === 200 && w2.abc.orders[0].branchNumber === "1234", "an empty pair means the default pair at send time");
  // abcOrderInput still refuses anything else
  const bad = w2.F.abcOrderInput({ order_ref: "AP-X", ship_to: "9999", branch: "1", delivery_date: future(2), delivery_service: "OTG" }, { ship_to_number: "2010466-2", branch_number: "1234" }, { v2: true, names: [] });
  ok(bad === null, "abcOrderInput refuses a pair other than the one it is given");
});

await check("split-draft", async () => {
  const w = await draftWorld();
  const { did } = await oneDraft(w, [["p-gaf", 10, "bundle"], ["p-ridge", 4, "bundle"], ["p-boot", 3, "each"]]);
  const lines = linesOfDraft(w, did);
  const ridge = lines.find((l) => l.item_number === "RIDGE0001");
  await putDraft(w, did, Object.assign(READY(), { delivery_instructions: "Call first" }));
  await priced(w, did);
  const body = { moves: [{ line_ids: [ridge.id], ship_to: B.ship_to, branch: B.branch }] };
  const r = await read(await w.F.handlePostGmAbcDraftSplit("c1", did, post("/x", body), w.env));
  ok(r.status === 200 && r.data.created.length === 1, "split answers the new draft (" + r.status + " " + r.text.slice(0, 100) + ")");
  const nd = draftsOf(w).find((d) => d.id !== did);
  ok(nd && nd.status === "draft" && nd.branch_number === "340" && nd.delivery_date === READY().delivery_date && nd.delivery_contact_name === "Sam Lee" && nd.delivery_instructions === "Call first" && nd.delivery_service === "OTG" && nd.delivery_to === "job" && nd.contact_name === "Zeta Owner", "the new draft copies date, contact, instructions, service and place");
  const nl = linesOfDraft(w, nd.id);
  ok(nl.length === 1 && nl[0].item_number === "RIDGE0001" && nl[0].quantity === ridge.quantity && nl[0].unit_price === null && nl[0].abc_description === ridge.abc_description, "the moved line is copied, priced again later, with ABC's description");
  ok(linesOfDraft(w, did).find((l) => l.id === ridge.id).removed === 1 && linesOfDraft(w, did).filter((l) => !l.removed).length === 2, "the moved line is marked removed on the original");
  ok(nd.order_ref && nd.order_ref !== draftsOf(w)[0].order_ref, "the new draft has its own purchase order number");
  // refusals
  const g = ridge.id;
  const none = (b) => w.F.handlePostGmAbcDraftSplit("c1", did, post("/x", b), w.env);
  ok((await none({ moves: [{ line_ids: [lines[0].id], ship_to: A.ship_to, branch: A.branch }] })).status >= 400, "the draft's own pair is refused");
  ok((await none({ moves: [{ line_ids: [lines[0].id], ship_to: "9999", branch: "1" }] })).status === 400, "a pair that is not the business's own is refused");
  ok((await none({ moves: [{ line_ids: ["nope"], ship_to: C.ship_to, branch: C.branch }] })).status === 400, "a line id that is not on this draft is refused");
  ok((await none({ moves: [{ line_ids: [g], ship_to: C.ship_to, branch: C.branch }] })).status === 400, "a line already removed is not an active line");
  w.d.raw.prepare("INSERT INTO gm_abc_order_drafts (id, client_id, contract_id, job_name) VALUES ('fd', 'c2', 'conz', 'Theirs')").run();
  w.d.raw.prepare("INSERT INTO gm_abc_order_draft_lines (id, draft_id, client_id, item_number, description, quantity, uom, sort_order) VALUES ('fl', 'fd', 'c2', 'X', 'X', 1, 'EA', 0)").run();
  ok((await none({ moves: [{ line_ids: ["fl"], ship_to: C.ship_to, branch: C.branch }] })).status === 400, "another business's line is refused");
  ok((await w.F.handlePostGmAbcDraftSplit("c1", "fd", post("/x", body), w.env)).status === 404, "another business's draft is 404");
  for (const bad of [{}, { moves: [] }, { moves: "x" }, { moves: [{ line_ids: [], ship_to: C.ship_to, branch: C.branch }] }, { moves: [{ line_ids: [lines[0].id] }] }]) { ok((await none(bad)).status === 400, "bad input: " + JSON.stringify(bad).slice(0, 50)); }
  w.d.raw.prepare("UPDATE gm_abc_order_drafts SET status = 'sent' WHERE id = ?").run(did);
  ok((await none({ moves: [{ line_ids: [lines[0].id], ship_to: C.ship_to, branch: C.branch }] })).status === 409, "a draft that is not in status draft cannot be split");
  const before = draftsOf(w).length;
  w.d.raw.prepare("UPDATE gm_abc_order_drafts SET status = 'draft' WHERE id = ?").run(did);
  user = SELLER; ok((await none({ moves: [] })).status === 403, "a seller is 403"); user = null; ok((await none({ moves: [] })).status === 401, "not signed in is 401"); user = OWNER;
  ok(draftsOf(w).length === before, "no refused split created a draft");
});

await check("combine-needs-same-pair", async () => {
  const w = await draftWorld();
  const a = await oneDraft(w, [["p-gaf", 10, "bundle", A]]);
  const b = await oneDraft(w, [["p-ridge", 4, "bundle", B]]);
  const body = { draft_ids: [a.did, b.did], delivery_service: "OTG", delivery_date: future(9), location: { name: "Yard", line1: "5 Yard Rd", city: "Tampa", state: "FL", postal: "33610" }, contact: { name: "Zeta Owner", email: "office@zeta.example", phone: "8135550100" }, delivery_contact: { name: "Sam Lee", phone: "8135550111" }, order_ref: "AP-COMB0001", prices: {} };
  const r = await read(await w.F.handlePostGmAbcDraftsCombine("c1", post("/x", body), w.env));
  ok(r.status === 409 && /different ABC accounts or branches/.test(r.text) && Array.isArray(r.data.differing) && r.data.differing.length === 2, "drafts at different pairs: 409 with the plain message and the list (" + r.status + ")");
  ok(w.abc.orders.length === 0 && draftsOf(w).every((d) => d.status === "draft"), "nothing was sent or claimed");
  // same pair, TBD, instructions once
  const c = await oneDraft(w, [["p-boot", 3, "each", B]]);
  const d2 = await oneDraft(w, [["p-ridge", 2, "bundle", B]]);
  w.abc.pairPrices["2010466-2|340"] = { EACH0001: { uom: "EA", price: 12.5 }, RIDGE0001: { uom: "BD", price: 45 } };
  const body2 = Object.assign({}, body, { draft_ids: [c.did, d2.did], delivery_date: undefined, delivery_date_tbd: 1, delivery_instructions: "Leave at the garage", order_ref: "AP-COMB0002", prices: { EACH0001: 12.5, RIDGE0001: 45 } });
  const r2 = await read(await w.F.handlePostGmAbcDraftsCombine("c1", post("/x", body2), w.env));
  const sent = w.abc.orders[0];
  ok(r2.status === 200 && sent && sent.branchNumber === "340" && !(sent.dates && sent.dates.deliveryRequestedFor) && sent.orderComments[0].description === "Leave at the garage" && sent.orderComments[0].code === "H", "the combined order uses the shared pair, TBD leaves the date out, instructions go once (" + r2.status + " " + r2.text.slice(0, 120) + ")");
  const dc = sent && sent.shipTo.contacts.find((x) => x.functionCode === "DC");
  ok(dc && dc.name === "Sam Lee" && dc.phones[0].number === "8135550111" && dc.email === undefined, "the on-site contact goes once, with no email when none was entered");
  // neither date nor TBD is refused
  const e = await oneDraft(w, [["p-boot", 3, "each", B]]); const f = await oneDraft(w, [["p-ridge", 2, "bundle", B]]);
  const body3 = Object.assign({}, body, { draft_ids: [e.did, f.did], order_ref: "AP-COMB0003", delivery_date: "", prices: {} });
  ok((await w.F.handlePostGmAbcDraftsCombine("c1", post("/x", body3), w.env)).status === 400, "combine with neither a date nor TBD is 400");
});

await check("date-or-tbd", async () => {
  const w = await draftWorld({ pairs: false });
  const { did } = await oneDraft(w);
  const base = READY(); delete base.delivery_date;
  await putDraft(w, did, base);
  let g = await getDraft(w, did);
  ok(g.data.draft.missing.indexOf("delivery_date") !== -1, "neither a date nor TBD: delivery_date is listed as missing");
  ok(g.data.draft.delivery_date_tbd === 0, "TBD is never a default");
  let s = await sendDraft(w, did, await priced(w, did));
  ok(s.status === 400 && w.abc.orders.length === 0, "a draft saves with neither but cannot be sent");
  ok((await putDraft(w, did, { delivery_date: past(5) })).status === 200, "a past date can be saved");
  s = await sendDraft(w, did, await priced(w, did)); ok(s.status === 400 && w.abc.orders.length === 0, "a date in the past is refused at send");
  await putDraft(w, did, { delivery_date: future(400) }); s = await sendDraft(w, did, await priced(w, did));
  ok(s.status === 400 && w.abc.orders.length === 0, "a date more than a year ahead is refused at send");
  for (const bad of [{ delivery_date_tbd: 2 }, { delivery_date_tbd: "yes" }, { delivery_date_tbd: null }]) { ok((await putDraft(w, did, bad)).status === 400, "delivery_date_tbd accepts 0 or 1 only: " + JSON.stringify(bad)); }
  await putDraft(w, did, { delivery_date: future(7), delivery_date_tbd: 0 });
  s = await sendDraft(w, did, await priced(w, did));
  ok(s.status === 200 && w.abc.orders[0].dates.deliveryRequestedFor === future(7), "a valid date is sent as dates.deliveryRequestedFor");
  const w2 = await draftWorld({ pairs: false }); const o2 = await oneDraft(w2);
  await putDraft(w2, o2.did, Object.assign(READY(), { delivery_date: "", delivery_date_tbd: 1 }));
  s = await sendDraft(w2, o2.did, await priced(w2, o2.did));
  ok(s.status === 200 && w2.abc.orders[0].dates === undefined, "TBD leaves dates.deliveryRequestedFor out");
  const w3 = await draftWorld({ pairs: false }); const o3 = await oneDraft(w3);
  await putDraft(w3, o3.did, Object.assign(READY(), { delivery_date: future(5), delivery_date_tbd: 1 }));
  s = await sendDraft(w3, o3.did, await priced(w3, o3.did));
  ok(s.status === 200 && w3.abc.orders[0].dates === undefined, "when TBD is chosen any date is ignored");
  // the old rule holds while the migration is missing
  const w4 = world({ branches: false }); seedPricing(w4); await seedConn(w4); user = OWNER;
  const o4 = await oneDraft(w4);
  await putDraft(w4, o4.did, { delivery_service: "OTG", delivery_to: "job", delivery_date: "", contact_name: "Zeta Roofing LLC", contact_email: "office@zeta.example", contact_phone: "8135550100" });
  s = await sendDraft(w4, o4.did, await priced(w4, o4.did));
  ok(s.status === 200 && w4.abc.orders[0].dates === undefined && w4.abc.orders[0].shipTo.contacts[0].name === "Zeta Roofing LLC", "before the migration: a blank date still sends and the old contact behavior holds");
});

await check("people-not-business", async () => {
  const w = await draftWorld({ pairs: false });
  const { did } = await oneDraft(w);
  const g = await getDraft(w, did);
  ok(draftsOf(w)[0].contact_name === "Zeta Owner", "the submitter name is prefilled with the owner's own personal name, not the business (" + draftsOf(w)[0].contact_name + ")");
  ok(draftsOf(w)[0].delivery_contact_name === "" && draftsOf(w)[0].delivery_contact_phone === "", "the on-site contact is never prefilled");
  ok(g.data.business.name !== undefined, "the business block is still answered for the Use my business address button");
  // a user record with no personal name leaves it empty
  const w2 = await draftWorld({ pairs: false }); user = Object.assign({}, OWNER, { display_name: "Zeta Roofing" }); const o2 = await oneDraft(w2);
  ok(draftsOf(w2)[0].contact_name === "", "the owner's name equals the business name: left empty and required");
  const w3 = await draftWorld({ pairs: false }); user = Object.assign({}, OWNER, { display_name: "" }); const o3 = await oneDraft(w3);
  ok(draftsOf(w3)[0].contact_name === "" && (await getDraft(w3, o3.did)).data.draft.missing.indexOf("contact_name") !== -1, "no personal name: empty and listed as missing");
  user = OWNER;
  // names equal to the business refuse the send
  const w4 = await draftWorld({ pairs: false }); const o4 = await oneDraft(w4);
  await putDraft(w4, o4.did, Object.assign(READY(), { contact_name: "ZETA ROOFING llc " }));
  let s = await sendDraft(w4, o4.did, await priced(w4, o4.did));
  ok(s.status === 400 && /person/i.test(s.text) && w4.abc.orders.length === 0, "SM name equal to the legal name is refused with the plain message (" + s.status + ")");
  await putDraft(w4, o4.did, { contact_name: "Zeta Owner", delivery_contact_name: "zeta roofing", delivery_contact_phone: "8135550111" });
  s = await sendDraft(w4, o4.did, await priced(w4, o4.did));
  ok(s.status === 400 && /person/i.test(s.text) && w4.abc.orders.length === 0, "DC name equal to the trading name is refused");
  // the DC contact carries its own name and phone, no email when blank
  await putDraft(w4, o4.did, { delivery_contact_name: "Sam Lee", delivery_contact_phone: "(813) 555-0111", delivery_contact_email: "" });
  s = await sendDraft(w4, o4.did, await priced(w4, o4.did));
  const cs = w4.abc.orders[0].shipTo.contacts;
  const sm = cs.find((c) => c.functionCode === "SM"), dc = cs.find((c) => c.functionCode === "DC");
  ok(s.status === 200 && sm.name === "Zeta Owner" && sm.email === "office@zeta.example" && dc.name === "Sam Lee" && dc.phones[0].number === "8135550111" && dc.email === undefined, "SM is the submitting person with email; DC is the on-site person with its own phone and no email");
  // field validation
  for (const bad of [{ delivery_contact_name: "x".repeat(61) }, { delivery_contact_phone: "123" }, { delivery_contact_email: "nope" }, { delivery_contact_name: "bad\u0007name" }]) { ok((await putDraft(w, did, bad)).status === 400, "refused: " + JSON.stringify(bad).slice(0, 50)); }
  ok((await putDraft(w, did, { delivery_contact_name: "", delivery_contact_phone: "" })).status === 200, "empty is allowed on save");
  ok((await getDraft(w, did)).data.draft.missing.indexOf("delivery_contact_name") !== -1 && (await getDraft(w, did)).data.draft.missing.indexOf("delivery_contact_phone") !== -1, "the on-site name and phone are listed as missing when empty");
});

await check("saved-contacts", async () => {
  const w = await draftWorld({ pairs: false });
  let r = await read(await w.F.handlePostGmAbcDeliveryContact("c1", post("/x", { name: "Sam Lee", phone: "(813) 555-0111", email: "sam@x.example" }), w.env));
  ok(r.status === 200 && q(w, ["SELECT phone, email FROM gm_abc_delivery_contacts"])[0].phone === "8135550111", "a contact is saved with a clean phone");
  const first = q(w, ["SELECT id, last_used_at FROM gm_abc_delivery_contacts"])[0];
  r = await read(await w.F.handlePostGmAbcDeliveryContact("c1", post("/x", { name: "Sam Lee", phone: "8135550111" }), w.env));
  ok(q(w, ["SELECT COUNT(*) AS n FROM gm_abc_delivery_contacts"])[0].n === 1 && q(w, ["SELECT last_used_at FROM gm_abc_delivery_contacts"])[0].last_used_at !== "", "a duplicate name and phone only updates last_used_at");
  for (const bad of [{ name: "", phone: "8135550111" }, { name: "A", phone: "12" }, { name: "A", phone: "8135550111", email: "bad" }, { name: "x".repeat(61), phone: "8135550111" }, {}, { name: "Zeta Roofing LLC", phone: "8135550111" }]) {
    ok((await w.F.handlePostGmAbcDeliveryContact("c1", post("/x", bad), w.env)).status === 400, "refused: " + JSON.stringify(bad).slice(0, 60));
  }
  for (let i = 0; i < 30; i++) { await w.F.handlePostGmAbcDeliveryContact("c1", post("/x", { name: "Person " + i, phone: "813555" + String(1000 + i) }), w.env); }
  ok(q(w, ["SELECT COUNT(*) AS n FROM gm_abc_delivery_contacts"])[0].n === 25, "at most 25 saved people");
  const list = await read(await w.F.handleGetGmAbcDeliveryContacts("c1", get("/x"), w.env));
  ok(list.data.contacts.length === 25 && list.data.contacts[0].name === "Sam Lee", "the most recently used person is first");
  w.d.raw.prepare("INSERT INTO gm_abc_delivery_contacts (id, client_id, name, phone) VALUES ('fc', 'c2', 'Their Person', '3055550100')").run();
  ok(!list.text.includes("Their Person"), "another business's people are never listed");
  ok((await w.F.handlePostGmAbcDeliveryContactRemove("c1", post("/x", { id: "fc" }), w.env)).status === 404 && q(w, ["SELECT COUNT(*) AS n FROM gm_abc_delivery_contacts WHERE id = 'fc'"])[0].n === 1, "another business's person cannot be removed");
  ok((await w.F.handlePostGmAbcDeliveryContactRemove("c1", post("/x", { id: 5 }), w.env)).status === 400, "bad id is 400");
  // a send updates last_used_at and inserts a typed person
  const w2 = await draftWorld({ pairs: false }); const { did } = await oneDraft(w2);
  await putDraft(w2, did, READY());
  const s = await sendDraft(w2, did, await priced(w2, did));
  const row = q(w2, ["SELECT * FROM gm_abc_delivery_contacts WHERE client_id = 'c1'"])[0];
  ok(s.status === 200 && row && row.name === "Sam Lee" && row.phone === "8135550111" && row.last_used_at !== "", "a send saves the typed person and sets last_used_at");
  // removing a saved person never changes a draft
  await w2.F.handlePostGmAbcDeliveryContactRemove("c1", post("/x", { id: row.id }), w2.env);
  ok(q(w2, ["SELECT delivery_contact_name FROM gm_abc_order_drafts WHERE id = ?", did])[0].delivery_contact_name === "Sam Lee", "the draft keeps its copy after the person is removed");
  let first429 = 0; const wc = await draftWorld({ pairs: false });
  for (let i = 1; i <= 80; i++) { const rr = await wc.F.handleGetGmAbcDeliveryContacts("c1", get("/x"), wc.env); if (rr.status === 429 && !first429) { first429 = i; } }
  ok(first429 === 61, "the contacts route allows 60 per window, the 61st is the first 429 (got " + first429 + ")");
});

await check("instructions", async () => {
  const w = await draftWorld({ pairs: false });
  const { did } = await oneDraft(w);
  await putDraft(w, did, READY());
  ok((await putDraft(w, did, { delivery_instructions: "a".repeat(255) })).status === 200, "255 characters are accepted");
  ok((await putDraft(w, did, { delivery_instructions: "a".repeat(256) })).status === 400, "256 characters are refused");
  ok((await putDraft(w, did, { delivery_instructions: "line\nbreak" })).status === 400 && (await putDraft(w, did, { delivery_instructions: "tab\there" })).status === 400, "control characters are refused (the page turns line breaks into spaces)");
  ok((await putDraft(w, did, { delivery_instructions: 5 })).status === 400, "not text is refused");
  ok((await putDraft(w, did, { delivery_instructions: "" })).status === 200, "empty is allowed");
  let s = await sendDraft(w, did, await priced(w, did));
  ok(s.status === 200 && w.abc.orders[0].orderComments === undefined, "no instructions: no orderComments key");
  const w2 = await draftWorld({ pairs: false }); const o2 = await oneDraft(w2);
  await putDraft(w2, o2.did, Object.assign(READY(), { delivery_instructions: "Gate code 4521. Call before delivery" }));
  const logsBefore = logged.length;
  s = await sendDraft(w2, o2.did, await priced(w2, o2.did));
  ok(s.status === 200 && JSON.stringify(w2.abc.orders[0].orderComments) === JSON.stringify([{ code: "H", description: "Gate code 4521. Call before delivery" }]), "instructions go as orderComments code H");
  ok(!logged.slice(logsBefore).some((l) => /4521/.test(l)), "instructions are never logged");
  ok(/instructions_code: "H"/.test(workerSrc) && /instructions_max: 255/.test(workerSrc), "the comment code and the maximum live in one constant each");
  // access notes
  const g = await getDraft(w2, o2.did);
  ok(g.data.access_notes === "Gate code 4521", "the draft answers the access notes saved on the lead");
  user = RIVAL; ok((await w2.F.handleGetGmAbcDraft("c1", o2.did, get("/x"), w2.env)).status === 403, "access notes are answered only to the owner of that business"); user = OWNER;
  w2.d.raw.exec("UPDATE gm_leads SET addr_access = NULL");
  ok((await getDraft(w2, o2.did)).data.access_notes === "", "none saved: empty");
});

await check("abc-descriptions", async () => {
  const w = await draftWorld({ pairs: false });
  const { did } = await oneDraft(w);
  await putDraft(w, did, READY());
  w.d.raw.exec("UPDATE gm_abc_order_draft_lines SET description = 'My own words for this'");
  const s = await sendDraft(w, did, await priced(w, did));
  const lines = w.abc.orders[0].lines;
  ok(s.status === 200 && lines.some((l) => l.itemDescription === "GAF Timberline HD Weathered Wood") && !lines.some((l) => /My own words/.test(l.itemDescription)), "itemDescription is ABC's own description, never the Apex one");
  // an empty ABC description blocks the send
  const w2 = await draftWorld({ pairs: false }); const o2 = await oneDraft(w2);
  await putDraft(w2, o2.did, READY());
  w2.d.raw.exec("UPDATE gm_abc_order_draft_lines SET description = 'My own words for this', abc_description = '' WHERE item_number = '02GASTZ3WW'");
  const g = await getDraft(w2, o2.did);
  ok(g.data.draft.missing.indexOf("item_description") !== -1, "an empty ABC description is listed as item_description");
  const s2 = await sendDraft(w2, o2.did, await priced(w2, o2.did));
  ok(s2.status === 400 && w2.abc.orders.length === 0, "and cannot be sent: never a fallback to the Apex description");
  ok(w2.F.abcOrderInput({ order_ref: "AP-X", ship_to: "2010466-2", branch: "1234", delivery_date: future(3), delivery_service: "OTG", job_name: "J", address: { line1: "1 A", city: "T", state: "FL", postal: "33602" }, contact: { name: "Zeta Owner", email: "a@b.co", phone: "8135550100" }, delivery_contact: { name: "Sam", phone: "8135550111" }, lines: [{ item_number: "I1", description: "x", abc_description: "", quantity: 1, uom: "EA", unit_price: 1 }] }, { ship_to_number: "2010466-2", branch_number: "1234" }, { v2: true, names: [] }) === null, "abcOrderInput refuses a line with no ABC description");
  // refresh-descriptions
  const r = await read(await w2.F.handlePostGmAbcDraftRefreshDescriptions("c1", o2.did, post("/x", {}), w2.env));
  ok(r.status === 200 && linesOfDraft(w2, o2.did).find((l) => l.item_number === "02GASTZ3WW").abc_description !== "", "refresh-descriptions fills the line from ABC");
  ok(linesOfDraft(w2, o2.did).find((l) => l.item_number === "02GASTZ3WW").description === "My own words for this", "the Apex description is not overwritten by ABC's");
  ok(w2.abc.searchCalls.some((c) => c.filters.some((f) => f.key === "itemNumber" && f.condition === "equals")), "ABC Search Items is asked for the item numbers");
  w2.d.raw.prepare("INSERT INTO gm_abc_order_drafts (id, client_id, contract_id, job_name) VALUES ('fd', 'c2', 'conz', 'Theirs')").run();
  ok((await w2.F.handlePostGmAbcDraftRefreshDescriptions("c1", "fd", post("/x", {}), w2.env)).status === 404, "another business's draft is 404");
  user = SELLER; ok((await w2.F.handlePostGmAbcDraftRefreshDescriptions("c1", o2.did, post("/x", {}), w2.env)).status === 403, "a seller is 403"); user = OWNER;
  // a dimensional line with no chosen length blocks the send
  const w3 = await draftWorld({ pairs: false });
  addRow(w3, { id: "p-dim", item: "Drip edge", unit: "piece", abc: "DIMLEN01", abcUnit: "PC", apexUnit: "piece", abcCost: 9 });
  w3.d.raw.exec("UPDATE gm_pricing SET abc_description = 'Aluminum drip edge flashing', abc_dimensional = 1 WHERE id = 'p-dim'");
  w3.abc.prices["DIMLEN01"] = { uom: "PC", price: 9 };
  const o3 = await oneDraft(w3, [["p-dim", 5, "piece"]]);
  await putDraft(w3, o3.did, READY());
  const g3 = await getDraft(w3, o3.did);
  ok(g3.data.draft.missing.indexOf("item_length") !== -1, "a dimensional line with no chosen length is listed as item_length");
  const s3 = await sendDraft(w3, o3.did, await priced(w3, o3.did));
  ok(s3.status === 400 && w3.abc.orders.length === 0 && /item_length/.test(s3.text), "and it cannot be sent: never a guessed length");
});

await check("get-item", async () => {
  const w = await draftWorld({ pairs: false });
  w.abc.getItemFull = true;
  const r = await read(await w.F.handleGetGmAbcItem("c1", get("/x?item_number=DIMLEN01"), w.env));
  ok(r.status === 200 && r.data.item.item_number === "DIMLEN01" && r.data.item.dimensional === true && r.data.item.width.value === 4 && r.data.item.variations[0].length.value === 10, "Get Item answers the trimmed fields");
  const allowed = ["item_number", "description", "marketing_description", "supplier_name", "brand_line", "color", "uoms", "dimensional", "width", "thickness", "variations", "image_href", "status", "hint"];
  ok(Object.keys(r.data.item).every((k) => allowed.indexOf(k) !== -1), "no other ABC field is answered: " + Object.keys(r.data.item).join(","));
  for (const bad of ["", "bad item!", "x".repeat(40)]) { ok((await w.F.handleGetGmAbcItem("c1", get("/x?item_number=" + encodeURIComponent(bad)), w.env)).status === 400, "bad item number refused: " + bad.slice(0, 10)); }
  ok((await w.F.handleGetGmAbcItem("c1", get("/x?item_number=NOPE"), w.env)).status === 404, "unknown item is 404");
  let first = 0; const wi = await draftWorld({ pairs: false });
  for (let i = 1; i <= 30; i++) { const rr = await wi.F.handleGetGmAbcItem("c1", get("/x?item_number=DIMLEN01"), wi.env); if (rr.status === 429 && !first) { first = i; } }
  ok(first === 21, "Get Item: the 21st request in the window is the first 429 (got " + first + ")");
  // image_href only when https
  const safe = w.F.abcItemSafe({ itemNumber: "X1", itemDescription: "d", images: [{ href: "http://x.example/a.png" }, { href: "javascript:alert(1)" }, { href: "https://img.example/a.png" }] });
  ok(safe.image_href === "https://img.example/a.png", "image_href is kept only when it is an https address");
  ok(w.F.abcItemSafe({ itemNumber: "X1", itemDescription: "d", images: [{ href: "http://x.example/a.png" }] }).image_href === undefined, "an http image is dropped");
});

await check("coverage-hint", async () => {
  const w = world();
  const hint = (o) => w.F.abcCoverageHint(o);
  let h = hint({ itemDescription: "Ridge cap 20 Linear Feet per Bundle" });
  ok(h.per_unit_linear_ft === 20 && h.per_unit_sqft === null && h.source === "description" && /20/.test(h.text), "20 Linear Feet per Bundle: linear feet, not square feet");
  h = hint({ itemDescription: "Shingle 10 Square per Roll" });
  ok(h.per_unit_sqft === 1000 && h.unit_name === "Roll" && h.source === "description", "10 Square per Roll is 1000 square feet per roll");
  h = hint({ itemDescription: "Timberline 3 Bundles per Square" });
  ok(Math.abs(h.per_unit_sqft - 33.3333) < 0.01 && h.unit_name === "Bundle", "3 Bundles per Square is about 33.3 square feet per bundle");
  h = hint({ itemDescription: "Holland Paver 6x9 Charcoal 100SF" });
  ok(h.per_unit_sqft === 100 && h.source === "description", "a paver description ending 100SF is 100 square feet");
  h = hint({ itemDescription: "Insulation Board 1 in 4' X 4'" });
  ok(h.per_unit_sqft === 16 && h.source === "description", "an Insulation Board with 4' X 4' is 16 square feet per sheet");
  h = hint({ itemDescription: "Mystery product", dimensions: { width: { value: 12, uom: "IN" }, variations: [{ length: { value: 10, uom: "FT" } }] } });
  ok(h.per_unit_sqft === 10 && h.source === "dimensions", "width 12 in and length 10 ft is 10 square feet per piece");
  h = hint({ itemDescription: "Shingle 10 Square per Roll 3 Bundles per Square" });
  ok(h.per_unit_sqft === null && h.source === null && h.text === null, "two readings that disagree give nothing");
  for (const d of ["Plain hammer", "", null, "Nails 5 lb box"]) { const x = hint({ itemDescription: d }); ok(x.per_unit_sqft === null && x.per_unit_linear_ft === null && x.source === null, "not sure: all null for " + JSON.stringify(d)); }
  ok(w.F.abcCoverageHint(null).source === null, "a missing item gives all nulls");
});


await check("accounts-status-disconnect", async () => {
  const w = await two();
  const acc = await read(await w.F.handleGetGmAbcAccounts("c1", get("/x"), w.env));
  ok(acc.status === 200 && acc.data.accounts.length === 2 && !acc.data.accounts.some((a) => a.ship_to === "2010777-9" || a.branches.length === 0), "F1: the accounts list never offers a ship-to whose branches array is empty");
  const st = await read(await w.F.handleGetGmAbcStatus("c1", get("/x"), w.env));
  ok(st.data.pair_count === 2 && st.data.pairs[0].is_default === true && st.data.pairs[0].branch === "1234" && !HIDDEN.some((s) => st.text.indexOf(s) !== -1), "the status answers the business's pairs (numbers, names, default flag) and no secret");
  const acct = await read(await w.F.handlePostGmAbcAccount("c1", post("/x", { ship_to: "2010999-1", branch: "55" }), w.env));
  ok(acct.status === 200 && q(w, ["SELECT is_default FROM gm_abc_branches WHERE branch_number = '55'"])[0].is_default === 1 && q(w, ["SELECT COUNT(*) AS n FROM gm_abc_branches WHERE is_default = 1"])[0].n === 1, "the existing account route also writes the matching pair row as the default");
  ok((await w.F.handlePostGmAbcAccount("c1", post("/x", { ship_to: "2010777-9", branch: "1" }), w.env)).status === 400, "the existing account route refuses a ship-to with no branches");
  await w.F.handlePostGmAbcDisconnect("c1", post("/x", {}), w.env);
  ok(q(w, ["SELECT COUNT(*) AS n FROM gm_abc_branches"])[0].n === 0, "disconnecting ABC removes the business's pair rows");
});

// Proven live 2026-11-16: ABC's availability search answers nothing when the filters carry joinCondition.
await check("availability-filter-has-no-joinCondition", async () => {
  const i = workerSrc.indexOf("async function abcAvailCall");
  const body = workerSrc.slice(i, workerSrc.indexOf("async function abcAvailability", i));
  ok(body.indexOf("joinCondition") === -1, "the availability request body carries no joinCondition (live ABC returns zero items with it)");
});

// 2026-11-16: ABC read calls get one automatic retry; placing an order must never be retried by itself.
await check("auto-retry-never-for-orders", async () => {
  const w = world();
  ok(w.F.abcReadOnlyCall("GET", "/api/anything") === true, "a GET may be retried once");
  ok(w.F.abcReadOnlyCall("POST", "/api/product/v1/search/items") === true, "item search may be retried once");
  ok(w.F.abcReadOnlyCall("POST", "/api/pricing/v2/prices") === true, "price items may be retried once");
  ok(w.F.abcReadOnlyCall("POST", "/api/order/v2/orders") === false, "placing an order is NEVER retried by itself");
});

await check("no-secret-and-no-guess", async () => {
  ok(!seen.some((t) => HIDDEN.some((sct) => t.indexOf(sct) !== -1)), "no answer carried a secret");
  ok(!logged.some((l) => HIDDEN.some((sct) => l.indexOf(sct) !== -1)), "no log carried a secret");
});

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
