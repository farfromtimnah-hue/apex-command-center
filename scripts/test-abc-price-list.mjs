// ABC Supply price list import (2026-11-05).
// The REAL Worker functions (cut out of worker/index.js) on an in-memory SQLite
// built from the real migration files, with a FAKE fetch standing in for ABC.
// No network, no production database.
//
//   node scripts/test-abc-price-list.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { makeDb, build, hasFn, varSrc } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
async function check(name, fn) {
  try { await fn(); } catch (e) { console.log("FAIL  " + name + "  [" + String(e && e.message).slice(0, 160) + "]"); fail++; }
}
const root = new URL("../", import.meta.url);
const sqlOf = (rel) => readFileSync(new URL(rel, root), "utf8").replace(/--[^\n]*/g, "");
const stmts = (sql) => sql.split(";").map((s) => s.trim()).filter(Boolean);
const connectSql = sqlOf("migrations/abc_connect.sql");
const pricingSql = sqlOf("migrations/gm_pricing.sql");
const p1Alters = stmts(sqlOf("migrations/client_estimates_invoices_p1.sql")).filter((s) => /^ALTER TABLE gm_pricing ADD COLUMN/.test(s));
const abcPlSql = (() => { try { return sqlOf("migrations/abc_price_list.sql"); } catch (e) { return ""; } })();

const FNS = ["jsonOk", "jsonErr", "jsonErr2", "gmActorReplacer", "requireClientAccess", "sessionSellerName", "actorName",
  "tokenEncKey", "tokenIsSealed", "tokenSeal", "tokenOpen", "bytesToB64", "b64ToBytes", "gmStr", "gmNum", "gmEstNewToken",
  "metaHex", "metaHmac", "metaSafeEqual", "metaScrub", "metaPlain", "publicReadRateLimited",
  "abcSettings", "abcClientAllowed", "abcTablesReady", "abcNotAvailable", "abcOwnerGuard", "abcB64url", "abcSha256Hex", "abcFetch", "abcApi",
  "abcErrTransient", "abcTokenCall", "abcFlagReconnect", "abcAccessToken", "abcRefreshToken", "abcText", "abcOwnerStart", "abcServerError", "abcUpstreamError",
  "gmPricingParseBreakdown", "gmCostLineType", "gmPricingComputed", "gmPricingCachedTotal", "gmPricingKind", "gmOwnedRow", "gmServiceFromPricingStmt", "handleGetGmPricing",
  "abcPlColumnsReady", "abcPlStart", "abcNorm", "abcUnitPlan", "abcCostPerUnit", "abcBreakdownWith", "abcBreakdownWithout", "abcFetchPrices", "abcItemsQuery",
  "abcPlLinkInput", "abcPlAddInput", "abcPlItemInfo", "abcPlShape", "abcPlUnitName", "abcPlBad", "abcPlOwnerOnly",
  "handleGetGmAbcItems", "handlePostGmAbcAddItems", "handlePostGmPricingAbcLink", "handlePostGmPricingAbcUnlink", "abcRefreshRows", "gmMaterialColumnsReady", "gmMaterialStandard", "handlePostGmAbcRefreshCosts",
  "clientRequestAllowed", "sellerRequestAllowed"].filter(hasFn);
const VARS = ["DEFAULT_ORIGIN", "CORS_HEADERS", "GM_ACTOR_KEY_RE", "GM_HIDDEN_ACTORS", "TOKEN_SEAL_PREFIX", "ABC", "ABC_NA_PT", "ABC_NA_EN",
  "PUBLIC_READ_HITS", "PUBLIC_READ_HITS_SWEPT", "ABC_REFRESHING", "ABC_SHIPTO_RE", "ABC_BRANCH_RE", "ABC_ITEM_RE", "ABC_UOM_RE",
  "GM_COST_LINE_TYPES", "GM_PRICING_KINDS", "GM_PRICING_SELLER_FIELDS", "ABC_PL_INSERT"].filter(function (v) { try { varSrc(v); return true; } catch (e) { return false; } });

const CLIENT_ID = "abc-client-id-123";
const SECRET = "abc-client-secret-ccc333";
const ACCESS = "ABCACCESS-aaa111";
const REFRESH = "ABCREFRESH-bbb222";
const HIDDEN = [SECRET, ACCESS, REFRESH];
const ENV_OK = { ABC_SANDBOX_CLIENT_IDS: "c1", ABC_CLIENT_ID: CLIENT_ID, ABC_CLIENT_SECRET: SECRET, TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64") };
const SB_API = "https://partners-sb.abcsupply.com";
const SB_AUTH = "https://sandbox.auth.partners.abcsupply.com";

const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "Zeta Owner", username: "zeta" };
const SELLER = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Maria Silva", display_name: "Maria Silva", username: "maria" };
const RIVAL = { role: "client", client_id: "c2", login_role: "client", display_name: "Omega Owner", username: "omega" };
const STAFF = { role: "alice", display_name: "Alice", username: "alice" };
let user = OWNER;

const seen = [];
const logged = [];
console.error = function () { logged.push(Array.prototype.slice.call(arguments).map(String).join(" ")); };
async function read(res) {
  const text = await res.text();
  seen.push(text);
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  return { status: res.status, text: text, data: data };
}

const CATALOG = {
  "02GASTZ3WW": { itemDescription: "GAF Timberline HD Weathered Wood", status: "Active", uoms: [{ name: "Square", code: "SQ", description: "costing" }, { name: "Bundle", code: "BD", description: "stocking" }],
    hierarchy: { category: { name: "Steep Slope Roofing" } } },
  "ICEWATER1": { itemDescription: "Ice and Water Shield 2 sq roll", status: "Active", uoms: [{ name: "Roll", code: "RL", description: "stocking" }], hierarchy: { category: { name: "Underlayment" } } },
  "EACH0001": { itemDescription: "Pipe boot each", status: "Active", uoms: [{ name: "Each", code: "EA", description: "stocking" }], hierarchy: {} },
  "NOPRICE1": { itemDescription: "Ridge vent no price", status: "Active", uoms: [{ name: "Each", code: "EA", description: "stocking" }], hierarchy: {} },
  "ZEROPRC1": { itemDescription: "Zero price flashing", status: "Active", uoms: [{ name: "Each", code: "EA", description: "stocking" }], hierarchy: {} },
  "DIM00001": { itemDescription: "Dimensional drip edge", status: "Active", isDimensional: true, uoms: [{ name: "Piece", code: "PC", description: "stocking" }], hierarchy: {} },
  "OLD00001": { itemDescription: "Old inactive shingle", status: "Inactive", uoms: [{ name: "Bundle", code: "BD", description: "stocking" }], hierarchy: {} }
};

function world(opts) {
  opts = opts || {};
  const d = makeDb();
  stmts(connectSql).forEach((s) => d.raw.exec(s));
  stmts(pricingSql).forEach((s) => d.raw.exec(s));
  p1Alters.forEach((s) => d.raw.exec(s));
  d.raw.exec("CREATE TABLE gm_config (client_id TEXT PRIMARY KEY, servicos_json TEXT, updated_at TEXT)");
  d.raw.exec("INSERT INTO gm_config (client_id, servicos_json) VALUES ('c1', '[]'), ('c2', '[]')");
  if (opts.columns !== false) { stmts(abcPlSql).forEach((s) => d.raw.exec(s)); }
  d.raw.prepare("INSERT INTO clients (id, name, language) VALUES ('c1', 'Zeta Roofing', 'en'), ('c2', 'Omega Roofing', 'pt')").run();
  const abc = { calls: [], prices: {}, searches: [], priceBatches: [], down: false, onPrice: null };
  abc.prices["02GASTZ3WW"] = { uom: "BD", price: 41.5 };
  abc.prices["ICEWATER1"] = { uom: "RL", price: 88 };
  abc.prices["EACH0001"] = { uom: "EA", price: 12.5 };
  abc.prices["NOPRICE1"] = { err: true };
  abc.prices["ZEROPRC1"] = { uom: "EA", price: 0 };
  async function fakeFetch(url, init) {
    const u = new URL(url);
    const method = (init && init.method) || "GET";
    const headers = (init && init.headers) || {};
    let json = null;
    if (init && init.body && String(headers["Content-Type"] || "").indexOf("json") !== -1) { json = JSON.parse(init.body); }
    abc.calls.push({ method, host: u.origin, path: u.pathname, search: u.search, headers, json });
    if (abc.down) { throw new Error("connect ECONNREFUSED " + url); }
    const J = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
    if (u.origin !== SB_API) { return J({ title: "unknown host in the fake", detail: url }, 500); }
    const bearer = String(headers.Authorization || "").replace(/^Bearer /, "");
    if (bearer !== ACCESS) { return J({ message: "Unauthorized" }, 401); }
    const p = u.pathname;
    if (p === "/api/product/v1/search/items" && method === "POST") {
      abc.searches.push(json);
      const f = json.filters[0];
      const needle = String(f.values[0]).toLowerCase();
      const hits = Object.keys(CATALOG).filter((n) => (f.key === "itemNumber" ? n.toLowerCase().indexOf(needle) !== -1 : CATALOG[n].itemDescription.toLowerCase().indexOf(needle) !== -1));
      return J({ pagination: { itemsPerPage: json.pagination.itemsPerPage, pageNumber: 1, totalPages: 1, totalItems: hits.length },
        items: hits.slice(0, json.pagination.itemsPerPage).map((n) => Object.assign({ itemNumber: n }, CATALOG[n])) });
    }
    let m = /^\/api\/product\/v1\/items\/([\w-]+)$/.exec(p);
    if (m && method === "GET") { return CATALOG[m[1]] ? J(Object.assign({ itemNumber: m[1] }, CATALOG[m[1]])) : J({ message: "not found" }, 404); }
    if (p === "/api/pricing/v2/prices" && method === "POST") {
      if (json.lines.length > 50) { return J({ message: "too many lines" }, 400); }
      abc.priceBatches.push(json);
      if (abc.onPrice) { abc.onPrice(json); }
      return J({ shipToNumber: json.shipToNumber, branchNumber: json.branchNumber, purpose: json.purpose,
        lines: json.lines.map((l) => {
          const t = abc.prices[l.itemNumber] || (/^BULK/.test(l.itemNumber) ? { uom: "EA", price: 10 } : { err: true });
          if (t.err) { return { id: l.id, itemNumber: l.itemNumber, quantity: l.quantity, uom: l.uom || "EA", unitPrice: 0, currency: { code: "USD", symbol: "$" }, status: { code: "Error", message: "Cannot price item" } }; }
          return { id: l.id, itemNumber: l.itemNumber, quantity: l.quantity, uom: l.uom || t.uom, unitPrice: t.price, currency: { code: "USD", symbol: "$" }, status: { code: "OK", message: "Priced Successfully" } };
        }) });
    }
    return J({ title: "unknown path in the fake", detail: url }, 500);
  }
  const stubs = { GM_MEASURE: createRequire(import.meta.url)("../gm-measure.js"), authenticate: async () => user, fetch: fakeFetch, btoa: (s) => Buffer.from(s, "binary").toString("base64"), gmGetConfig: async () => ({ servicos: [] }) };
  const F = build(FNS, VARS, stubs, opts.src);
  const env = Object.assign({ DB: d.DB }, opts.env || ENV_OK);
  return { d, env, F, abc };
}

async function seedConn(w, o) {
  o = o || {};
  const sealed = await w.F.tokenSeal(w.env, ACCESS);
  const sealedR = await w.F.tokenSeal(w.env, REFRESH);
  w.d.raw.prepare("INSERT INTO gm_abc_connections (client_id, token_sealed, refresh_sealed, token_expires_at, connected_by, ship_to_number, branch_number, environment, needs_reconnect) VALUES ('c1', ?, ?, datetime('now', '+30 minutes'), 'Zeta Owner', ?, ?, 'sandbox', ?)")
    .run(sealed, sealedR, o.account === false ? null : "2010466-2", o.account === false ? null : "1234", o.reconnect ? 1 : 0);
}
let seq = 0;
function addRow(w, o) {
  const id = o.id || ("r" + (++seq));
  w.d.raw.prepare("INSERT INTO gm_pricing (id, client_id, item, unit, cost_breakdown, cost_total, price, abc_item_number, abc_unit, abc_units_per_apex_unit, abc_cost, abc_cost_synced_at, abc_ship_to, abc_branch, abc_apex_unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, o.client || "c1", o.item || ("Item " + id), o.unit === undefined ? "sq ft" : o.unit, JSON.stringify(o.lines || []), o.total === undefined ? null : o.total, o.price === undefined ? null : o.price,
      o.abc === undefined ? null : o.abc, o.abcUnit === undefined ? null : o.abcUnit, o.conv === undefined ? null : o.conv, o.abcCost === undefined ? null : o.abcCost,
      o.synced === undefined ? null : o.synced, o.abc ? "2010466-2" : null, o.abc ? "1234" : null, o.apexUnit === undefined ? null : o.apexUnit);
  return id;
}
const rowOf = (w, id) => w.d.q("SELECT * FROM gm_pricing WHERE id = ?", id)[0];
const linesOf = (r) => JSON.parse(r.cost_breakdown);

const API = "https://apex-api.farfromtimnah.workers.dev";
const get = (path, headers) => new Request(API + path, { method: "GET", headers: headers || {} });
const post = (path, body, headers) => new Request(API + path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers || {}), body: typeof body === "string" ? body : JSON.stringify(body || {}) });

// ── 1. The small rules ───────────────────────────────────────────────────
await check("rules", async () => {
  const w = world();
  const F = w.F;
  ok(F.abcNorm("  Sq FT ") === "sq ft", "unit words compare without case and outer spaces");
  const same = F.abcUnitPlan(["Each", "EA"], "each", null);
  ok(same.same === true && same.factor === 1 && same.conversion === null, "same word: used directly, no conversion kept");
  const sameCode = F.abcUnitPlan(["Each", "EA"], "EA", 5);
  ok(sameCode.same === true && sameCode.factor === 1 && sameCode.conversion === null, "same word as the ABC code: a typed conversion is ignored");
  const need = F.abcUnitPlan(["Bundle", "BD"], "sq ft", null);
  ok(need.same === false && need.factor === null, "different words and no conversion: nothing can be computed");
  const conv = F.abcUnitPlan(["Bundle", "BD"], "sq ft", 33.3);
  ok(conv.same === false && conv.factor === 33.3 && conv.conversion === 33.3, "different words with a conversion: the conversion is the factor");
  for (const bad of [0, -1, NaN, Infinity, "33", null, undefined]) { ok(F.abcUnitPlan(["Bundle", "BD"], "sq ft", bad).factor === null, "conversion " + String(bad) + " is not accepted"); }
  ok(F.abcCostPerUnit(41.5, 33.3) === 1.2462, "41.50 a bundle covering 33.3 sq ft is 1.2462 a sq ft");
  ok(F.abcCostPerUnit(12.5, 1) === 12.5, "factor 1 keeps the price");
  ok(F.abcCostPerUnit(41.5, null) === null && F.abcCostPerUnit(41.5, 0) === null && F.abcCostPerUnit(-1, 1) === null, "no cost without a valid factor and price");
  const base = [{ label: "Labor", amount: 10, type: "labor" }, { label: "ABC Supply", amount: 5, type: "material" }, { label: "Nails", amount: 2, type: "material" }];
  const withIt = F.abcBreakdownWith(base, 7.25);
  ok(withIt.length === 3 && withIt.filter((l) => l.label === "ABC Supply").length === 1 && withIt.find((l) => l.label === "ABC Supply").amount === 7.25, "the ABC Supply line is replaced, not added twice");
  ok(withIt.find((l) => l.label === "Labor").amount === 10 && withIt.find((l) => l.label === "Nails").amount === 2, "other lines untouched");
  ok(F.abcBreakdownWith([{ label: "Labor", amount: 10 }], 3).length === 2, "the line is added when there is none");
  const without = F.abcBreakdownWithout(base);
  ok(without.length === 2 && !without.some((l) => l.label === "ABC Supply"), "unlinking removes only the ABC Supply line");
  ok(F.abcItemsQuery("shingle") === "shingle" && F.abcItemsQuery("  Ice & water  ") === "Ice & water", "a search text is trimmed");
  for (const bad of [null, undefined, "", "ab", " ab ", "x".repeat(41), "<script>alert(1)</script>", "a\nb c", "drop;table"]) { ok(F.abcItemsQuery(bad) === null, "search text refused: " + JSON.stringify(bad)); }
});

// ── 2. Who may call, limits, missing columns, not connected ───────────────
function routeCalls(w) {
  return {
    items: () => w.F.handleGetGmAbcItems("c1", get("/x?q=shingle"), w.env),
    add: () => w.F.handlePostGmAbcAddItems("c1", post("/x", { items: [{ item_number: "EACH0001" }] }), w.env),
    link: () => w.F.handlePostGmPricingAbcLink("c1", "r1", post("/x", { item_number: "EACH0001" }), w.env),
    unlink: () => w.F.handlePostGmPricingAbcUnlink("c1", "r1", post("/x", {}), w.env),
    refresh: () => w.F.handlePostGmAbcRefreshCosts("c1", post("/x", {}), w.env)
  };
}
await check("guards", async () => {
  const w = world();
  await seedConn(w);
  const calls = routeCalls(w);
  for (const k of Object.keys(calls)) {
    user = null; ok((await calls[k]()).status === 401, k + ": not signed in is 401");
    user = SELLER; ok((await calls[k]()).status === 403, k + ": a salesperson is 403");
    user = RIVAL; ok((await calls[k]()).status === 403, k + ": another business's owner is 403");
    user = STAFF; ok((await calls[k]()).status === 403, k + ": platform staff is 403");
  }
  ok(w.abc.calls.length === 0, "no call reached ABC from a refused request");
  user = OWNER;
});
await check("limits", async () => {
  const cases = { items: 60, add: 20, link: 40, unlink: 40, refresh: 6 };
  for (const k of Object.keys(cases)) {
    const w = world();
    await seedConn(w);
    user = OWNER;
    let first429 = 0;
    for (let i = 1; i <= cases[k] + 1; i++) { const r = await routeCalls(w)[k](); if (r.status === 429 && !first429) { first429 = i; } }
    ok(first429 === cases[k] + 1, k + ": request " + (cases[k] + 1) + " in the window is the first 429 (got " + first429 + ")");
  }
});
await check("columns-missing", async () => {
  const w = world({ columns: false });
  await seedConn(w);
  user = OWNER;
  const calls = routeCalls(w);
  for (const k of Object.keys(calls)) {
    const r = await read(await calls[k]());
    ok(r.status === 503 && r.data && r.data.available === false, k + ": columns not there yet says not available yet");
  }
  ok(w.abc.calls.length === 0, "nothing was sent to ABC");
  ok((await read(await w.F.handleGetGmPricing("c1", get("/x"), w.env))).status === 200, "the plain Price list still opens without the columns");
});
await check("not-connected", async () => {
  const w = world();
  user = OWNER;
  const none = await read(await w.F.handleGetGmAbcItems("c1", get("/x?q=shingle"), w.env));
  ok(none.status === 409 && none.data.connected === false && /not connected/i.test(none.data.error_en) && /não está conectada/.test(none.data.error_pt), "no connection: a clear message in both languages");
  const w2 = world();
  await seedConn(w2, { reconnect: true });
  const rc = await read(await w2.F.handleGetGmAbcItems("c1", get("/x?q=shingle"), w2.env));
  ok(rc.status === 409 && rc.data.needs_reconnect === true && /reconnect/i.test(rc.data.error_en) && /reconectada/.test(rc.data.error_pt), "reconnect needed: a clear message");
  const w3 = world();
  await seedConn(w3, { account: false });
  const na = await read(await w3.F.handleGetGmAbcItems("c1", get("/x?q=shingle"), w3.env));
  ok(na.status === 409 && /account/i.test(na.data.error_en), "no account chosen: a clear message");
  const refresh = await read(await w2.F.handlePostGmAbcRefreshCosts("c1", post("/x", {}), w2.env));
  ok(refresh.status === 409 && refresh.data.needs_reconnect === true, "refresh with reconnect needed: same message");
  ok(w.abc.calls.length + w2.abc.calls.length + w3.abc.calls.length === 0, "ABC is never called when the connection cannot be used");
});

// ── 3. Search ─────────────────────────────────────────────────────────────
await check("items", async () => {
  const w = world();
  await seedConn(w);
  user = OWNER;
  for (const bad of ["", "?q=ab", "?q=" + "x".repeat(41), "?q=%3Cscript%3E", "?q=a%0Ab%20c"]) {
    const r = await read(await w.F.handleGetGmAbcItems("c1", get("/api/clients/c1/gm/abc/items" + bad), w.env));
    ok(r.status === 400, "search refused (400): " + bad.slice(0, 30));
  }
  ok(w.abc.calls.length === 0, "a bad search never reaches ABC");
  const writes = w.d.writes.length;
  const r = await read(await w.F.handleGetGmAbcItems("c1", get("/api/clients/c1/gm/abc/items?q=timberline"), w.env));
  ok(r.status === 200 && r.data.items.length === 1 && r.data.items[0].item_number === "02GASTZ3WW", "search finds the item (inactive ones left out)");
  const it = r.data.items[0];
  ok(it.description === "GAF Timberline HD Weathered Wood" && it.unit_code === "BD" && it.unit_name === "Bundle" && it.category === "Steep Slope Roofing", "description, ABC unit and category");
  ok(it.cost === 41.5 && it.has_price === true, "the contractor's own cost from Price Items");
  const s = w.abc.searches[0];
  ok(s.filters.length === 2 && s.filters.some((f) => f.key === "itemDescription" && f.condition === "contains" && f.values[0] === "timberline") && s.filters.some((f) => f.key === "branchNumber" && f.values[0] === "1234"), "the search is limited to the saved branch");
  ok(s.pagination.itemsPerPage === 40 && s.pagination.pageNumber === 1, "at most 40 results");
  const pb = w.abc.priceBatches[0];
  ok(pb.shipToNumber === "2010466-2" && pb.branchNumber === "1234" && pb.purpose === "estimating" && pb.lines.length === 1 && !("uom" in pb.lines[0]), "prices asked at the saved ship-to and branch, in ABC's own unit");
  ok(w.d.writes.length === writes, "searching stores nothing");
  const r2 = await read(await w.F.handleGetGmAbcItems("c1", get("/api/clients/c1/gm/abc/items?q=EACH"), w.env));
  ok(r2.data.items.some((i) => i.item_number === "EACH0001"), "an item number can be typed too");
  const r3 = await read(await w.F.handleGetGmAbcItems("c1", get("/api/clients/c1/gm/abc/items?q=no%20price"), w.env));
  ok(r3.data.items.length === 1 && r3.data.items[0].cost === null && r3.data.items[0].has_price === false, "an item ABC has no price for is listed without a cost");
  const r4 = await read(await w.F.handleGetGmAbcItems("c1", get("/api/clients/c1/gm/abc/items?q=dimensional"), w.env));
  ok(r4.data.items.length === 0 && r4.data.skipped_dimensional === 1, "dimensional items are not offered (they need a length)");
  ok(!HIDDEN.some((h) => seen.join("\n").indexOf(h) !== -1), "no token in any answer");
});

// ── 4. Add items ──────────────────────────────────────────────────────────
await check("add-items", async () => {
  const w = world();
  await seedConn(w);
  user = OWNER;
  const add = (items, extra) => w.F.handlePostGmAbcAddItems("c1", post("/x", Object.assign({ items: items }, extra || {})), w.env);
  const bads = [null, {}, { items: [] }, { items: "x" }, { items: Array.from({ length: 26 }, (_, i) => ({ item_number: "BULK" + (1000 + i) })) },
    { items: [{ item_number: "a b" }] }, { items: [{}] }, { items: [{ item_number: "EACH0001" }, { item_number: "EACH0001" }] },
    { items: [{ item_number: "EACH0001", apex_unit: "x".repeat(41) }] }, { items: [{ item_number: "EACH0001", apex_unit: "sq\nft" }] },
    { items: [{ item_number: "EACH0001", apex_unit: "sq ft", units_per_apex_unit: 0 }] }, { items: [{ item_number: "EACH0001", apex_unit: "sq ft", units_per_apex_unit: -2 }] },
    { items: [{ item_number: "EACH0001", apex_unit: "sq ft", units_per_apex_unit: "33" }] }, { items: [{ item_number: "EACH0001", units_per_apex_unit: 33 }] }];
  const writes = w.d.writes.length;
  for (const b of bads) {
    const r = await read(await w.F.handlePostGmAbcAddItems("c1", post("/x", b === null ? "not json" : b), w.env));
    ok(r.status === 400, "refused (400): " + JSON.stringify(b).slice(0, 70));
  }
  ok(w.abc.calls.length === 0 && w.d.writes.length === writes, "bad input: nothing sent to ABC and nothing written");
  // Units the same word / ABC's own unit
  const r1 = await read(await add([{ item_number: "02GASTZ3WW" }, { item_number: "EACH0001", apex_unit: "each" }], { price: 5, cost: 999, unit: "zzz", item: "hijack" }));
  ok(r1.status === 200 && r1.data.created.length === 2 && r1.data.skipped.length === 0, "two items created");
  const gaf = w.d.q("SELECT * FROM gm_pricing WHERE abc_item_number = '02GASTZ3WW'")[0];
  ok(gaf.item === "GAF Timberline HD Weathered Wood" && gaf.unit === "Bundle" && gaf.price === null, "name from ABC, unit from ABC, selling price left empty");
  const gl = linesOf(gaf);
  ok(gl.length === 1 && gl[0].label === "ABC Supply" && gl[0].amount === 41.5 && gaf.cost_total === 41.5, "ONE cost line labeled ABC Supply");
  ok(gaf.abc_unit === "BD" && gaf.abc_units_per_apex_unit === null && gaf.abc_cost === 41.5 && !!gaf.abc_cost_synced_at && gaf.abc_ship_to === "2010466-2" && gaf.abc_branch === "1234", "ABC columns filled");
  const pipe = w.d.q("SELECT * FROM gm_pricing WHERE abc_item_number = 'EACH0001'")[0];
  ok(pipe.unit === "each" && pipe.abc_units_per_apex_unit === null && pipe.abc_apex_unit === "each" && pipe.abc_cost === 12.5, "same word as the ABC unit: used directly, the owner's unit word kept");
  ok(r1.data.created.every((c) => c.price === null && c.needs_info === true), "the Needs info badge shows (no price)");
  ok(JSON.parse(w.d.q("SELECT servicos_json FROM gm_config WHERE client_id = 'c1'")[0].servicos_json).length === 2, "the items join the business's services list like any new Price list item");
  // Conversion
  const r2 = await read(await add([{ item_number: "ICEWATER1", apex_unit: "sq ft", units_per_apex_unit: 200 }]));
  const ice = w.d.q("SELECT * FROM gm_pricing WHERE abc_item_number = 'ICEWATER1'")[0];
  ok(r2.status === 200 && ice.unit === "sq ft" && ice.abc_units_per_apex_unit === 200 && ice.abc_apex_unit === "sq ft" && ice.abc_cost === 0.44 && linesOf(ice)[0].amount === 0.44, "a roll covering 200 sq ft at 88.00 is 0.44 a sq ft, conversion stored on the row");
  // Skips
  const w2 = world();
  await seedConn(w2);
  addRow(w2, { id: "keep", item: "gaf timberline hd weathered wood", unit: "sq ft", price: 3.5, lines: [{ label: "Labor", amount: 10, type: "labor" }], total: 10 });
  addRow(w2, { id: "linked", item: "Some other name", abc: "ICEWATER1", abcUnit: "RL", conv: 200, apexUnit: "sq ft", abcCost: 0.44 });
  const r3 = await read(await w2.F.handlePostGmAbcAddItems("c1", post("/x", { items: [
    { item_number: "02GASTZ3WW" },                                              // name already exists (ignoring case)
    { item_number: "ICEWATER1" },                                                // already linked to another row
    { item_number: "NOPRICE1" },                                                 // ABC has no price
    { item_number: "ZEROPRC1" },                                                 // $0.00 is no price either
    { item_number: "NOSUCHIT" },                                                 // ABC does not know it
    { item_number: "EACH0001", apex_unit: "sq ft" },                             // units differ, no conversion
    { item_number: "DIM00001" }                                                  // dimensional: ABC cannot price it without a length
  ] }), w2.env));
  const reasons = {};
  (r3.data.skipped || []).forEach((s) => { reasons[s.item_number] = s.reason; });
  ok(r3.status === 200 && r3.data.created.length === 0, "nothing created when every item is skipped");
  ok(reasons["02GASTZ3WW"] === "name_exists" && reasons["ICEWATER1"] === "already_linked" && reasons["NOPRICE1"] === "no_price" && reasons["ZEROPRC1"] === "no_price"
    && reasons["NOSUCHIT"] === "not_found" && reasons["EACH0001"] === "needs_conversion" && reasons["DIM00001"] === "no_price", "each skip says why: " + JSON.stringify(reasons));
  const keep = rowOf(w2, "keep");
  ok(keep.price === 3.5 && keep.abc_item_number === null && linesOf(keep).length === 1 && keep.cost_total === 10, "an existing item with the same name is never overwritten");
  // Two items with the same ABC description in one request
  CATALOG["TWIN0001"] = { itemDescription: "Pipe boot each", status: "Active", uoms: [{ name: "Each", code: "EA", description: "stocking" }], hierarchy: {} };
  w2.abc.prices["TWIN0001"] = { uom: "EA", price: 9 };
  const r4 = await read(await w2.F.handlePostGmAbcAddItems("c1", post("/x", { items: [{ item_number: "EACH0001" }, { item_number: "TWIN0001" }] }), w2.env));
  delete CATALOG["TWIN0001"];
  ok(r4.data.created.length === 1 && r4.data.skipped.length === 1 && r4.data.skipped[0].reason === "name_exists", "two items with the same name in one request: the second is skipped");
  ok(w2.abc.priceBatches.every((b) => b.lines.length <= 25), "prices asked in one small batch");
  // Another business never sees this
  ok(w.d.q("SELECT COUNT(*) AS n FROM gm_pricing WHERE client_id = 'c2'")[0].n === 0, "no row appeared on another business");
});

// ── 5. Link and unlink ───────────────────────────────────────────────────
await check("link", async () => {
  const w = world();
  await seedConn(w);
  user = OWNER;
  const link = (pid, body) => w.F.handlePostGmPricingAbcLink("c1", pid, post("/x", body), w.env);
  const shingles = addRow(w, { id: "p1", item: "Shingles", unit: "sq ft", price: 3.5, lines: [{ label: "Labor", amount: 10, type: "labor" }], total: 10 });
  for (const bad of [null, {}, { item_number: "a b" }, { item_number: "EACH0001", units_per_apex_unit: 0 }, { item_number: "EACH0001", units_per_apex_unit: "5" }, { item_number: 5 }]) {
    const r = await read(await w.F.handlePostGmPricingAbcLink("c1", "p1", post("/x", bad === null ? "not json" : bad), w.env));
    ok(r.status === 400, "link refused (400): " + JSON.stringify(bad));
  }
  ok((await read(await link("nope", { item_number: "EACH0001" }))).status === 404, "a row that does not exist is 404");
  addRow(w, { id: "other", client: "c2", item: "Theirs", unit: "each" });
  ok((await read(await w.F.handlePostGmPricingAbcLink("c1", "other", post("/x", { item_number: "EACH0001" }), w.env))).status === 404, "another business's row is 404");
  ok(w.abc.calls.length === 0, "bad link requests never reach ABC");
  // Units differ, no conversion yet: linked, no cost written
  const r0 = await read(await link("p1", { item_number: "02GASTZ3WW" }));
  const a0 = rowOf(w, "p1");
  ok(r0.status === 200 && r0.data.needs_conversion === true && r0.data.abc_unit === "BD", "units differ without a conversion: the answer says set the unit conversion");
  ok(a0.abc_item_number === "02GASTZ3WW" && a0.abc_cost === null && a0.abc_units_per_apex_unit === null && linesOf(a0).length === 1 && a0.cost_total === 10 && a0.price === 3.5, "linked, but no cost line and no cost written");
  // With the conversion
  const r1 = await read(await link("p1", { item_number: "02GASTZ3WW", units_per_apex_unit: 33.3 }));
  const a1 = rowOf(w, "p1");
  const l1 = linesOf(a1);
  ok(r1.status === 200 && l1.length === 2 && l1[0].label === "Labor" && l1[1].label === "ABC Supply" && l1[1].amount === 1.2462, "the ABC Supply line is added after the owner's own lines");
  ok(a1.cost_total === 11.25 && a1.abc_cost === 1.2462 && a1.abc_units_per_apex_unit === 33.3 && a1.abc_apex_unit === "sq ft" && !!a1.abc_cost_synced_at, "total recomputed (to the cent); conversion and sync date stored");
  ok(a1.price === 3.5, "the selling price did not change");
  // Same item on another row is refused
  addRow(w, { id: "p2", item: "Other shingles", unit: "sq ft" });
  const r2 = await read(await w.F.handlePostGmPricingAbcLink("c1", "p2", post("/x", { item_number: "02GASTZ3WW", units_per_apex_unit: 33.3 }), w.env));
  ok(r2.status === 409 && rowOf(w, "p2").abc_item_number === null, "an item linked to another row of this business is refused (409)");
  // A row with no unit can not be compared
  addRow(w, { id: "p3", item: "No unit", unit: null });
  ok((await read(await w.F.handlePostGmPricingAbcLink("c1", "p3", post("/x", { item_number: "EACH0001" }), w.env))).status === 409, "a row with no unit is 409 (set the unit first)");
  // Same word: direct
  addRow(w, { id: "p4", item: "Pipe boots", unit: "Each" });
  const r4 = await read(await w.F.handlePostGmPricingAbcLink("c1", "p4", post("/x", { item_number: "EACH0001" }), w.env));
  ok(r4.status === 200 && rowOf(w, "p4").abc_cost === 12.5 && rowOf(w, "p4").abc_units_per_apex_unit === null && rowOf(w, "p4").abc_apex_unit === "Each", "same unit word: the cost is used directly");
  // No price: nothing written
  addRow(w, { id: "p5", item: "Vent", unit: "each" });
  const r5 = await read(await w.F.handlePostGmPricingAbcLink("c1", "p5", post("/x", { item_number: "NOPRICE1" }), w.env));
  ok(r5.status === 409 && rowOf(w, "p5").abc_item_number === null, "ABC has no price: 409 and nothing linked");
  // The owner edits the row while ABC is answering: the edit survives
  addRow(w, { id: "p6", item: "Race", unit: "roll", lines: [{ label: "Labor", amount: 4, type: "labor" }], total: 4 });
  w.abc.onPrice = () => { w.d.raw.prepare("UPDATE gm_pricing SET cost_breakdown = ? WHERE id = 'p6'").run(JSON.stringify([{ label: "Labor", amount: 99, type: "labor" }])); };
  const r6 = await read(await w.F.handlePostGmPricingAbcLink("c1", "p6", post("/x", { item_number: "ICEWATER1" }), w.env));
  w.abc.onPrice = null;
  ok(r6.status === 409 && linesOf(rowOf(w, "p6"))[0].amount === 99 && rowOf(w, "p6").abc_item_number === null, "an edit made while ABC answered is not overwritten (409)");
  ok(w.abc.calls.every((c) => c.host === SB_API) && !HIDDEN.some((h) => seen.join("\n").indexOf(h) !== -1), "sandbox host only, no token in any answer");
});
await check("unlink", async () => {
  const w = world();
  await seedConn(w);
  user = OWNER;
  addRow(w, { id: "u1", item: "Shingles", unit: "sq ft", price: 3.5, abc: "02GASTZ3WW", abcUnit: "BD", conv: 33.3, apexUnit: "sq ft", abcCost: 1.2462, synced: "2026-11-05 10:00:00",
    lines: [{ label: "Labor", amount: 10, type: "labor" }, { label: "ABC Supply", amount: 1.2462, type: "material" }, { label: "Nails", amount: 1, type: "material" }], total: 12.25 });
  const un = () => w.F.handlePostGmPricingAbcUnlink("c1", "u1", post("/x", {}), w.env);
  const r = await read(await un());
  const a = rowOf(w, "u1");
  ok(r.status === 200 && a.abc_item_number === null && a.abc_unit === null && a.abc_units_per_apex_unit === null && a.abc_cost === null && a.abc_cost_synced_at === null && a.abc_ship_to === null && a.abc_branch === null && a.abc_apex_unit === null, "every ABC column cleared");
  const l = linesOf(a);
  ok(l.length === 2 && l[0].label === "Labor" && l[1].label === "Nails" && a.cost_total === 11, "only the ABC Supply line removed; total recomputed");
  ok(a.price === 3.5, "the selling price did not change");
  ok((await read(await un())).status === 200 && linesOf(rowOf(w, "u1")).length === 2, "safe to run twice");
  ok((await read(await w.F.handlePostGmPricingAbcUnlink("c1", "nope", post("/x", {}), w.env))).status === 404, "unknown row is 404");
  addRow(w, { id: "u2", client: "c2", item: "Theirs", abc: "ICEWATER1", abcUnit: "RL", lines: [{ label: "ABC Supply", amount: 1, type: "material" }], total: 1 });
  ok((await read(await w.F.handlePostGmPricingAbcUnlink("c1", "u2", post("/x", {}), w.env))).status === 404 && rowOf(w, "u2").abc_item_number === "ICEWATER1", "another business's row is untouched");
  const r2 = await read(await w.F.handlePostGmPricingAbcLink("c1", addRow(w, { id: "u3", item: "Again", unit: "each" }), post("/x", { item_number: "02GASTZ3WW", units_per_apex_unit: 10 }), w.env));
  ok(r2.status === 200, "after unlinking, the item can be linked to another row");
});

// ── 6. Refresh ────────────────────────────────────────────────────────────
function refreshWorld() {
  const w = world();
  return seedConn(w).then(() => {
    const L = (amount) => [{ label: "Labor", amount: 10, type: "labor" }, { label: "ABC Supply", amount: amount, type: "material" }];
    addRow(w, { id: "A", item: "Shingles", unit: "sq ft", price: 3.5, abc: "02GASTZ3WW", abcUnit: "BD", conv: 33.3, apexUnit: "sq ft", abcCost: 1.0, synced: "2026-01-01 00:00:00", lines: L(1.0), total: 11 });
    addRow(w, { id: "B", item: "Pipe boots", unit: "each", price: 20, abc: "EACH0001", abcUnit: "EA", apexUnit: "each", abcCost: 12.5, synced: "2026-01-01 00:00:00", lines: [{ label: "ABC Supply", amount: 12.5, type: "material" }], total: 12.5 });
    addRow(w, { id: "C", item: "Vent", unit: "each", abc: "NOPRICE1", abcUnit: "EA", apexUnit: "each", abcCost: 5, synced: "2026-01-01 00:00:00", lines: [{ label: "ABC Supply", amount: 5, type: "material" }], total: 5 });
    addRow(w, { id: "D", item: "Ice shield", unit: "sq ft", abc: "ICEWATER1", abcUnit: "RL", lines: [], total: null });
    addRow(w, { id: "E", item: "Not linked", unit: "each", lines: [{ label: "Labor", amount: 3 }], total: 3 });
    addRow(w, { id: "F", client: "c2", item: "Theirs", unit: "each", abc: "EACH0001", abcUnit: "EA", abcCost: 1, lines: [{ label: "ABC Supply", amount: 1 }], total: 1 });
    return w;
  });
}
await check("refresh", async () => {
  const w = await refreshWorld();
  user = OWNER;
  const r = await read(await w.F.handlePostGmAbcRefreshCosts("c1", post("/x", {}), w.env));
  ok(r.status === 200 && r.data.updated === 1 && r.data.unchanged === 1 && r.data.no_price === 1 && r.data.needs_conversion === 1, "counts: updated, unchanged, no price returned, needs conversion " + JSON.stringify(r.data && { u: r.data.updated, n: r.data.unchanged, p: r.data.no_price, c: r.data.needs_conversion }));
  ok(Array.isArray(r.data.no_price_items) && r.data.no_price_items.length === 1 && r.data.no_price_items[0].item === "Vent", "items with no price returned are listed by name");
  const A = rowOf(w, "A");
  ok(A.abc_cost === 1.2462 && linesOf(A)[1].amount === 1.2462 && linesOf(A)[0].amount === 10 && A.cost_total === 11.25 && A.price === 3.5, "A: only the ABC Supply line and the cost fields changed; total recomputed; price untouched");
  ok(A.abc_cost_synced_at > "2026-11-01", "A: sync date is now");
  const B = rowOf(w, "B");
  ok(B.abc_cost === 12.5 && B.cost_total === 12.5 && B.abc_cost_synced_at > "2026-11-01", "B: same cost, date still moves");
  const C = rowOf(w, "C");
  ok(C.abc_cost === 5 && linesOf(C)[0].amount === 5 && C.abc_cost_synced_at === "2026-01-01 00:00:00", "C: no price returned, left exactly as it was");
  ok(rowOf(w, "D").abc_cost === null && linesOf(rowOf(w, "D")).length === 0, "D: needs a conversion, nothing written");
  ok(rowOf(w, "F").abc_cost === 1 && rowOf(w, "E").cost_total === 3, "another business's row and a plain row are untouched");
  const sent = w.abc.priceBatches.flatMap((b) => b.lines.map((l) => l.itemNumber)).sort();
  ok(w.abc.priceBatches.length === 1 && sent.join() === ["02GASTZ3WW", "EACH0001", "NOPRICE1"].sort().join(), "only this business's usable linked items were priced, once");
  ok(w.abc.priceBatches[0].lines.every((l) => !("uom" in l)) && w.abc.priceBatches[0].shipToNumber === "2010466-2", "priced in ABC's own unit at the saved account");
  ok(!w.d.q("SELECT name FROM sqlite_master WHERE name LIKE '%pricing%hist%' OR name LIKE '%pricing%log%'").length, "(there is no Price list cost log to write to)");
});
await check("refresh-rules", async () => {
  // ABC changed the unit it prices in: the old conversion no longer applies
  const w = await refreshWorld();
  user = OWNER;
  w.abc.prices["02GASTZ3WW"] = { uom: "SQ", price: 120 };
  const r = await read(await w.F.handlePostGmAbcRefreshCosts("c1", post("/x", {}), w.env));
  ok(r.data.needs_conversion === 2 && rowOf(w, "A").abc_cost === 1.0, "ABC priced in a different unit than the one converted: not written, counted as needs conversion");
  // The owner changed the Price list unit after typing the conversion
  const w2 = await refreshWorld();
  w2.d.raw.prepare("UPDATE gm_pricing SET unit = 'ft' WHERE id = 'A'").run();
  const r2 = await read(await w2.F.handlePostGmAbcRefreshCosts("c1", post("/x", {}), w2.env));
  ok(r2.data.needs_conversion === 2 && rowOf(w2, "A").abc_cost === 1.0, "a changed Price list unit makes the stored conversion stale: not written");
  // $0.00 is no price
  const w3 = await refreshWorld();
  w3.abc.prices["EACH0001"] = { uom: "EA", price: 0 };
  const r3 = await read(await w3.F.handlePostGmAbcRefreshCosts("c1", post("/x", {}), w3.env));
  ok(r3.data.no_price === 2 && rowOf(w3, "B").abc_cost === 12.5, "a $0.00 answer is no price: the old cost stays");
  // The owner edits a row while ABC answers
  const w4 = await refreshWorld();
  w4.abc.onPrice = () => { w4.d.raw.prepare("UPDATE gm_pricing SET cost_breakdown = ? WHERE id = 'A'").run(JSON.stringify([{ label: "Labor", amount: 77, type: "labor" }, { label: "ABC Supply", amount: 1, type: "material" }])); };
  const r4 = await read(await w4.F.handlePostGmAbcRefreshCosts("c1", post("/x", {}), w4.env));
  ok(r4.data.changed_meanwhile === 1 && linesOf(rowOf(w4, "A"))[0].amount === 77 && rowOf(w4, "A").abc_cost === 1.0, "an edit made while ABC answered is not overwritten");
  // Someone unlinks the row while ABC answers
  const w5 = await refreshWorld();
  w5.abc.onPrice = () => { w5.d.raw.prepare("UPDATE gm_pricing SET abc_item_number = NULL WHERE id = 'A'").run(); };
  const r5 = await read(await w5.F.handlePostGmAbcRefreshCosts("c1", post("/x", {}), w5.env));
  ok(r5.data.changed_meanwhile >= 1 && rowOf(w5, "A").abc_cost === 1.0, "a row unlinked while ABC answered is not written");
  // Two presses at once
  const w6 = await refreshWorld();
  const both = await Promise.all([w6.F.handlePostGmAbcRefreshCosts("c1", post("/x", {}), w6.env), w6.F.handlePostGmAbcRefreshCosts("c1", post("/x", {}), w6.env)]);
  const codes = both.map((x) => x.status);
  const A6 = rowOf(w6, "A");
  ok(codes.every((c) => c === 200) && linesOf(A6).filter((l) => l.label === "ABC Supply").length === 1 && A6.abc_cost === 1.2462 && A6.cost_total === 11.25, "two presses at once: one clean result, one ABC Supply line");
  // Batches of 50
  const w7 = world();
  await seedConn(w7);
  for (let i = 0; i < 120; i++) { addRow(w7, { id: "b" + i, item: "Bulk " + i, unit: "each", abc: "BULK" + (1000 + i), abcUnit: "EA", apexUnit: "each", abcCost: 1, lines: [{ label: "ABC Supply", amount: 1 }], total: 1 }); }
  const r7 = await read(await w7.F.handlePostGmAbcRefreshCosts("c1", post("/x", {}), w7.env));
  ok(r7.status === 200 && r7.data.updated === 120 && w7.abc.priceBatches.map((b) => b.lines.length).join() === "50,50,20", "120 linked items are priced in batches of 50, 50 and 20");
  // ABC down
  const w8 = await refreshWorld();
  w8.abc.down = true;
  const r8 = await read(await w8.F.handlePostGmAbcRefreshCosts("c1", post("/x", {}), w8.env));
  ok(r8.status === 502 && rowOf(w8, "A").abc_cost === 1.0 && !HIDDEN.some((h) => r8.text.indexOf(h) !== -1), "ABC not answering: a plain error, nothing changed");
  ok(!HIDDEN.some((h) => logged.join("\n").indexOf(h) !== -1), "no token in the server log");
});

// ── 7. What a salesperson reads, and the gate in front of the routes ─────
await check("seller-view", async () => {
  const w = await refreshWorld();
  user = OWNER;
  const o = await read(await w.F.handleGetGmPricing("c1", get("/x"), w.env));
  ok(o.data.items.some((i) => i.abc_item_number === "02GASTZ3WW" && i.abc_cost !== undefined), "the owner's list carries the ABC link fields");
  user = SELLER;
  const s = await read(await w.F.handleGetGmPricing("c1", get("/x"), w.env));
  ok(s.status === 200 && s.data.items.length > 0 && s.data.items.every((i) => !Object.keys(i).some((k) => /^abc_|cost|margin|breakdown/.test(k))), "a salesperson's list has no ABC field, no cost, no margin");
  user = OWNER;
});
await check("gate", async () => {
  const w = world();
  const b = "/api/clients/c1/gm/";
  [["abc/items", "GET"], ["abc/add-items", "POST"], ["abc/refresh-costs", "POST"], ["pricing/p-1/abc-link", "POST"], ["pricing/p-1/abc-unlink", "POST"]].forEach(function (r) {
    ok(w.F.clientRequestAllowed(b + r[0], r[1], "c1") === true, "the owner's login reaches " + r[1] + " " + r[0]);
    ok(w.F.sellerRequestAllowed(b + r[0], r[1], "c1") !== true, "a salesperson's login does not reach " + r[1] + " " + r[0]);
  });
  ok(w.F.clientRequestAllowed(b + "abc/items", "POST", "c1") !== true && w.F.clientRequestAllowed(b + "pricing/p-1/abc-link", "GET", "c1") !== true, "the wrong method is not let through");
  ok(w.F.clientRequestAllowed("/api/clients/c2/gm/abc/items", "GET", "c1") !== true, "another business's path is not let through");
});

console.log(fail ? "\n" + fail + " check(s) FAILED" : "\nAll ABC price list checks passed");
process.exit(fail ? 1 : 0);
