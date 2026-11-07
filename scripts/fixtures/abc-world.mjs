// Shared test world for the ABC live pricing, extra material and order draft tests
// (2026-11-07). The REAL Worker functions cut out of worker/index.js, an in-memory
// SQLite built from the real migration files, and a FAKE fetch standing in for ABC.
// No network, no production database, no real order is ever sent.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { makeDb, build, hasFn, varSrc } from "./d1-shim.mjs";

const require = createRequire(import.meta.url);
export const GM_MEASURE = require("../../gm-measure.js");
const root = new URL("../../", import.meta.url);
export const sqlOf = (rel) => { const u = new URL(rel, root); return existsSync(u) ? readFileSync(u, "utf8").replace(/--[^\n]*/g, "") : ""; };
export const stmts = (sql) => sql.split(";").map((s) => s.trim()).filter(Boolean);

export const CLIENT_ID = "abc-client-id-123";
export const SECRET = "abc-client-secret-ccc333";
export const ACCESS = "ABCACCESS-aaa111";
export const REFRESH = "ABCREFRESH-bbb222";
export const HIDDEN = [SECRET, ACCESS, REFRESH];
export const ENV_OK = { ABC_SANDBOX_CLIENT_IDS: "c1", ABC_CLIENT_ID: CLIENT_ID, ABC_CLIENT_SECRET: SECRET, TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64") };
export const SB_API = "https://partners-sb.abcsupply.com";
export const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "Zeta Owner", username: "zeta" };
export const SELLER = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Maria Silva", display_name: "Maria Silva", username: "maria" };
export const RIVAL = { role: "client", client_id: "c2", login_role: "client", display_name: "Omega Owner", username: "omega" };
export const STAFF = { role: "alice", display_name: "Alice", username: "alice" };
export const API = "https://apex-api.farfromtimnah.workers.dev";
export const get = (path, headers) => new Request(API + path, { method: "GET", headers: headers || {} });
export const send = (method) => (path, body, headers) => new Request(API + path, { method, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}), body: typeof body === "string" ? body : JSON.stringify(body || {}) });
export const post = send("POST");
export const put = send("PUT");

const FN_BASE = ["jsonOk", "jsonErr", "jsonErr2", "gmActorReplacer", "requireClientAccess", "sessionSellerName", "actorName",
  "tokenEncKey", "tokenIsSealed", "tokenSeal", "tokenOpen", "bytesToB64", "b64ToBytes", "gmStr", "gmNum", "gmEstNewToken",
  "metaHex", "metaHmac", "metaSafeEqual", "metaScrub", "metaPlain", "publicReadRateLimited",
  "abcSettings", "abcClientAllowed", "abcTablesReady", "abcNotAvailable", "abcOwnerGuard", "abcB64url", "abcSha256Hex", "abcFetch", "abcApi",
  "abcErrTransient", "abcTokenCall", "abcFlagReconnect", "abcAccessToken", "abcRefreshToken", "abcText", "abcOwnerStart", "abcServerError", "abcUpstreamError",
  "gmPricingParseBreakdown", "gmCostLineType", "gmPricingComputed", "gmPricingCachedTotal", "gmPricingKind", "gmOwnedRow", "gmServiceFromPricingStmt", "gmRunUpdate",
  "gmPricingFields", "handleGetGmPricing", "handlePutGmPricing", "handlePostGmPricing",
  "abcPlColumnsReady", "abcPlStart", "abcNorm", "abcUnitPlan", "abcCostPerUnit", "abcBreakdownWith", "abcBreakdownWithout", "abcFetchPrices", "abcItemsQuery",
  "abcPlLinkInput", "abcPlAddInput", "abcPlItemInfo", "abcPlShape", "abcPlUnitName", "abcPlBad", "abcPlOwnerOnly",
  "handleGetGmAbcItems", "handlePostGmAbcAddItems", "handlePostGmPricingAbcLink", "handlePostGmPricingAbcUnlink", "handlePostGmAbcRefreshCosts",
  "abcRefreshRows", "handlePostGmAbcPriceRows",
  "gmMaterialOwner", "gmMaterialFields", "gmMaterialCandidates", "gmMaterialBad", "gmMaterialColumnsReady", "gmMaterialStandard", "handleGetGmMaterialSettings", "handlePutGmMaterialSettings", "handlePostGmMaterialApply",
  "abcValidDate", "abcOrderInput", "abcOrderBody", "abcPlaceOrder", "handlePostGmAbcOrder", "handleGetGmAbcOrders", "abcPriceInput",
  "abcDraftTablesReady", "abcDraftStart", "abcDraftBad", "abcDraftNotFound", "abcDraftQty", "abcDraftPoRef", "abcSplitAddress", "abcDraftBusiness", "abcDraftJob", "abcDraftBuildLines", "abcDraftEnsureForContract",
  "abcDraftLoad", "abcDraftShip", "abcDraftMissing", "abcDraftOrderFromRow", "abcRefusal", "abcLocationFields", "abcSameAddress", "abcLocationSave", "abcLocationUse", "abcLocationOut", "abcDraftSummary", "abcDraftFreshPrices", "abcDraftReviewedPrices", "abcSamePrice",
  "handleGetGmAbcLocations", "handlePostGmAbcLocation", "handlePutGmAbcLocation", "handlePostGmAbcLocationArchive", "handleGetGmAbcDrafts", "handleGetGmAbcDraft", "handlePostGmAbcDraftEnsure", "handlePutGmAbcDraft",
  "handlePostGmAbcDraftDiscard", "handlePostGmAbcDraftPrices", "handlePostGmAbcDraftSend", "handlePostGmAbcDraftsCombine",
  "gmEstParseOptions", "gmEstWriteOptions", "gmEstOptTotals", "gmCents", "gmEstLineAmountCents", "gmEstParseDiscount", "gmEstOptDiscount", "gmEstOptionTotals", "gmEstDiscountCents",
  "clientRequestAllowed", "sellerRequestAllowed"];
export const FNS = FN_BASE.filter(hasFn);
const VARS_ALL = ["DEFAULT_ORIGIN", "CORS_HEADERS", "GM_ACTOR_KEY_RE", "GM_HIDDEN_ACTORS", "TOKEN_SEAL_PREFIX", "ABC", "ABC_NA_PT", "ABC_NA_EN",
  "PUBLIC_READ_HITS", "PUBLIC_READ_HITS_SWEPT", "ABC_REFRESHING", "ABC_SHIPTO_RE", "ABC_BRANCH_RE", "ABC_ITEM_RE", "ABC_UOM_RE",
  "GM_COST_LINE_TYPES", "GM_PRICING_KINDS", "GM_PRICING_SELLER_FIELDS", "ABC_PL_INSERT", "GM_EST_LINE_TYPES", "GM_EST_TIERS", "GM_MATERIAL_FIELDS", "ABC_PO_RE", "ABC_ID_RE", "ABC_STATE_RE", "ABC_ZIP_RE"];
export const VARS = VARS_ALL.filter(function (v) { try { varSrc(v); return true; } catch (e) { return false; } });

export const CATALOG = {
  "02GASTZ3WW": { itemDescription: "GAF Timberline HD Weathered Wood", status: "Active", uoms: [{ name: "Square", code: "SQ", description: "costing" }, { name: "Bundle", code: "BD", description: "stocking" }], hierarchy: { category: { name: "Steep Slope Roofing" } } },
  "PAVER6X9": { itemDescription: "Paver 6x9 Charcoal", status: "Active", uoms: [{ name: "Pallet", code: "PL", description: "stocking" }], hierarchy: { category: { name: "Hardscape" } } },
  "EACH0001": { itemDescription: "Pipe boot each", status: "Active", uoms: [{ name: "Each", code: "EA", description: "stocking" }], hierarchy: {} },
  "NOPRICE1": { itemDescription: "Ridge vent no price", status: "Active", uoms: [{ name: "Each", code: "EA", description: "stocking" }], hierarchy: {} }
};

export const SCHEMA_EXTRA = "CREATE TABLE gm_leads (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, cliente TEXT, address TEXT, city TEXT, estado TEXT, telefone TEXT, email TEXT, estimate_sent_at TEXT, commission_review_json TEXT);" +
  "CREATE TABLE gm_jobs (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, lead_id TEXT, obra TEXT, job_name TEXT, addr_street TEXT, addr_city TEXT, addr_state TEXT, addr_zip TEXT);" +
  "CREATE TABLE gm_config (client_id TEXT PRIMARY KEY, servicos_json TEXT, updated_at TEXT);";

// One world: database with every migration applied, a fake ABC, the Worker functions.
export function makeWorld(opts, getUser) {
  opts = opts || {};
  const d = makeDb();
  const run = (sql) => stmts(sql).forEach((s) => { try { d.raw.exec(s); } catch (e) { if (!/duplicate column|already exists/i.test(String(e.message))) { throw e; } } });
  run(sqlOf("migrations/abc_connect.sql"));
  run(sqlOf("migrations/gm_pricing.sql"));
  run(SCHEMA_EXTRA.replace(/;/g, ";\n"));
  stmts(sqlOf("migrations/client_estimates_invoices_p1.sql")).forEach((s) => { try { d.raw.exec(s); } catch (e) { /* alters on tables the test does not need */ } });
  stmts(sqlOf("migrations/client_estimates_invoices_p2.sql")).forEach((s) => { try { d.raw.exec(s); } catch (e) { /* unrelated alters */ } });
  stmts(sqlOf("migrations/client_estimates_invoices_fix2.sql")).forEach((s) => { try { d.raw.exec(s); } catch (e) { /* unrelated */ } });
  stmts(sqlOf("migrations/contracts_b_builder.sql")).forEach((s) => { try { d.raw.exec(s); } catch (e) { /* unrelated */ } });
  d.raw.exec("INSERT INTO gm_config (client_id, servicos_json) VALUES ('c1', '[]'), ('c2', '[]')");
  if (opts.columns !== false) { run(sqlOf("migrations/abc_price_list.sql")); }
  if (opts.measured !== false) { run(sqlOf("migrations/measured_materials.sql")); }
  if (opts.drafts !== false) { run(sqlOf("migrations/abc_order_drafts.sql")); }
  d.raw.prepare("INSERT INTO clients (id, name, language) VALUES ('c1', 'Zeta Roofing', 'en'), ('c2', 'Omega Roofing', 'pt')").run();
  const abc = { calls: [], prices: {}, priceBatches: [], orders: [], down: false, orderFail: null, onPrice: null };
  abc.prices["02GASTZ3WW"] = { uom: "BD", price: 41.5 };
  abc.prices["PAVER6X9"] = { uom: "PL", price: 380 };
  abc.prices["EACH0001"] = { uom: "EA", price: 12.5 };
  abc.prices["NOPRICE1"] = { err: true };
  let confirmSeq = 7000;
  async function fakeFetch(url, init) {
    const u = new URL(url);
    const method = (init && init.method) || "GET";
    const headers = (init && init.headers) || {};
    let json = null;
    if (init && init.body && String(headers["Content-Type"] || "").indexOf("json") !== -1) { json = JSON.parse(init.body); }
    abc.calls.push({ method, host: u.origin, path: u.pathname, headers, json });
    if (abc.down) { throw new Error("connect ECONNREFUSED " + url); }
    const J = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
    if (u.origin !== SB_API) { return J({ title: "unknown host in the fake", detail: url }, 500); }
    const bearer = String(headers.Authorization || "").replace(/^Bearer /, "");
    if (bearer !== ACCESS) { return J({ message: "Unauthorized" }, 401); }
    const p = u.pathname;
    let m = /^\/api\/product\/v1\/items\/([\w-]+)$/.exec(p);
    if (m && method === "GET") { return CATALOG[m[1]] ? J(Object.assign({ itemNumber: m[1] }, CATALOG[m[1]])) : J({ message: "not found" }, 404); }
    if (p === "/api/pricing/v2/prices" && method === "POST") {
      if (json.lines.length > 50) { return J({ message: "too many lines" }, 400); }
      if (!json.requestId) { return J({ message: "required key requestId not found" }, 400); }
      abc.priceBatches.push(json);
      if (abc.onPrice) { abc.onPrice(json); }
      return J({ lines: json.lines.map((l) => {
        const t = abc.prices[l.itemNumber] || { err: true };
        if (t.err) { return { id: l.id, itemNumber: l.itemNumber, quantity: l.quantity, uom: l.uom || "EA", unitPrice: 0, status: { code: "Error", message: "Cannot price item" } }; }
        return { id: l.id, itemNumber: l.itemNumber, quantity: l.quantity, uom: t.uom, unitPrice: t.price, status: { code: "OK", message: "Priced Successfully" } };
      }) });
    }
    if (p === "/api/order/v2/orders" && method === "POST") {
      abc.orders.push(json[0]);
      if (abc.orderFail) {
        const f = typeof abc.orderFail === "function" ? abc.orderFail(json[0]) : abc.orderFail;
        if (f) { return J({ message: f.message || "Delivery service not available for this branch" }, f.status || 400); }
      }
      return J({ request: { ordersFailed: 0 }, orders: [{ confirmationNumber: "CONF-" + (++confirmSeq) }] });
    }
    return J({ title: "unknown path in the fake", detail: url }, 500);
  }
  const stubs = { authenticate: async () => getUser(), fetch: fakeFetch, btoa: (s) => Buffer.from(s, "binary").toString("base64"), gmGetConfig: async () => ({ servicos: [] }),
    GM_MEASURE: GM_MEASURE };
  const F = build(FNS, VARS, stubs, opts.src);
  const env = Object.assign({ DB: d.DB }, opts.env || ENV_OK);
  return { d, env, F, abc };
}

export async function seedConn(w, o) {
  o = o || {};
  const sealed = await w.F.tokenSeal(w.env, ACCESS);
  const sealedR = await w.F.tokenSeal(w.env, REFRESH);
  w.d.raw.prepare("INSERT INTO gm_abc_connections (client_id, token_sealed, refresh_sealed, token_expires_at, connected_by, ship_to_number, branch_number, environment, needs_reconnect) VALUES ('c1', ?, ?, datetime('now', '+30 minutes'), 'Zeta Owner', ?, ?, 'sandbox', ?)")
    .run(sealed, sealedR, o.account === false ? null : "2010466-2", o.account === false ? null : "1234", o.reconnect ? 1 : 0);
}
let seq = 0;
export function addRow(w, o) {
  const id = o.id || ("r" + (++seq));
  w.d.raw.prepare("INSERT INTO gm_pricing (id, client_id, item, unit, cost_breakdown, cost_total, price, abc_item_number, abc_unit, abc_units_per_apex_unit, abc_cost, abc_cost_synced_at, abc_ship_to, abc_branch, abc_apex_unit, order_extra_percent, order_extra_source, measure_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, o.client || "c1", o.item || ("Item " + id), o.unit === undefined ? "sq ft" : o.unit, JSON.stringify(o.lines || []), o.total === undefined ? null : o.total, o.price === undefined ? null : o.price,
      o.abc === undefined ? null : o.abc, o.abcUnit === undefined ? null : o.abcUnit, o.conv === undefined ? null : o.conv, o.abcCost === undefined ? null : o.abcCost,
      o.synced === undefined ? null : o.synced, o.abc ? "2010466-2" : null, o.abc ? "1234" : null, o.apexUnit === undefined ? null : o.apexUnit,
      o.extra === undefined ? null : o.extra, o.extraSource === undefined ? null : o.extraSource, o.kind === undefined ? null : o.kind);
  return id;
}
export const rowOf = (w, id) => w.d.q("SELECT * FROM gm_pricing WHERE id = ?", id)[0];
export const linesOf = (r) => JSON.parse(r.cost_breakdown);

export function reader(seen) {
  return async function read(res) {
    const text = await res.text();
    if (seen) { seen.push(text); }
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    return { status: res.status, text: text, data: data };
  };
}
