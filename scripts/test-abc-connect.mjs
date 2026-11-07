// ABC Supply connection (Partner API, 2026-11-04).
// The REAL Worker functions (cut out of worker/index.js) on an in-memory
// SQLite built from the real migration file, with a FAKE fetch standing in for
// ABC. No network, no production database.
//
//   node scripts/test-abc-connect.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { makeDb, build, hasFn, varSrc } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
// One check. An exception (a function the Worker does not have yet, say) is a FAIL with its reason.
async function check(name, fn) {
  try { await fn(); } catch (e) { console.log("FAIL  " + name + "  [" + String(e && e.message).slice(0, 140) + "]"); fail++; }
}
const root = new URL("../", import.meta.url);
const migration = readFileSync(new URL("migrations/abc_connect.sql", root), "utf8");

const FNS = ["jsonOk", "jsonErr", "jsonErr2", "gmActorReplacer", "requireClientAccess", "sessionSellerName", "actorName",
  "tokenEncKey", "tokenIsSealed", "tokenSeal", "tokenOpen", "bytesToB64", "b64ToBytes", "gmStr", "gmEstNewToken",
  "metaHex", "metaHmac", "metaSafeEqual", "metaScrub", "metaPlain", "publicReadRateLimited",
  "abcSettings", "abcClientAllowed", "abcTablesReady", "abcNotAvailable", "abcOwnerGuard", "abcRedirectUri", "abcWebhookUrl",
  "abcB64url", "abcPkcePair", "abcSha256Hex", "abcFetch", "abcApi", "abcErrTransient", "abcTokenCall", "abcAuthorizeUrl", "abcBack",
  "abcStateUse", "abcFlagReconnect", "abcAccessToken", "abcStatusPayload", "abcWebhookRegister", "abcWebhookRemove",
  "abcPriceInput", "abcOrderInput", "abcOrderBody", "abcPlaceOrder", "abcValidDate", "abcText", "abcOwnerStart", "abcRefreshToken", "abcServerError", "abcUpstreamError", "abcCron",
  "handleGetGmAbcStatus", "handlePostGmAbcConnect", "handleGetAbcCallback", "handlePostGmAbcDisconnect", "handleGetGmAbcAccounts",
  "handlePostGmAbcAccount", "handlePostGmAbcPrice", "handlePostGmAbcOrder", "handleGetGmAbcOrders", "handlePostAbcWebhook",
  "handleGetAbcSandboxPing", "clientRequestAllowed", "sellerRequestAllowed"].filter(hasFn);
const VARS = ["DEFAULT_ORIGIN", "CORS_HEADERS", "GM_ACTOR_KEY_RE", "GM_HIDDEN_ACTORS", "TOKEN_SEAL_PREFIX", "ABC", "ABC_NA_PT", "ABC_NA_EN",
  "PUBLIC_READ_HITS", "PUBLIC_READ_HITS_SWEPT", "ABC_REFRESHING", "ABC_SHIPTO_RE", "ABC_BRANCH_RE", "ABC_ITEM_RE", "ABC_UOM_RE"].filter(function (v) { try { varSrc(v); return true; } catch (e) { return false; } });

const CLIENT_ID = "abc-client-id-123";
const SECRET = "abc-client-secret-ccc333";
const ACCESS = "ABCACCESS-aaa111";
const REFRESH = "ABCREFRESH-bbb222";
const CODE = "ABCCODE-ddd444";
const NEW_ACCESS = "ABCACCESS-new-eee555";
const NEW_REFRESH = "ABCREFRESH-new-fff666";
const CC_ACCESS = "ABCCC-token-ggg777";
const WH_SECRET = "WHSECRET-hhh888";
const HIDDEN = [SECRET, ACCESS, REFRESH, CODE, NEW_ACCESS, NEW_REFRESH, CC_ACCESS, WH_SECRET];
const ENV_OK = { ABC_SANDBOX_CLIENT_IDS: "c1", ABC_CLIENT_ID: CLIENT_ID, ABC_CLIENT_SECRET: SECRET, TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64") };

const SB_AUTH = "https://sandbox.auth.partners.abcsupply.com";
const SB_AUTH_PATH = "/oauth2/aus1vp07knpuqf6Xz0h8";
const SB_API = "https://partners-sb.abcsupply.com";
const PROD_API = "https://partners.abcsupply.com";

const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "Zeta Owner", username: "zeta" };
const SELLER = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Maria Silva", display_name: "Maria Silva", username: "maria" };
const RIVAL = { role: "client", client_id: "c2", login_role: "client", display_name: "Omega Owner", username: "omega" };
const STAFF = { role: "alice", display_name: "Alice", username: "alice" };
const DEV = { role: "developer", display_name: "Nicole", username: "nicole" };
let user = OWNER;

const seen = [];
const logged = [];
console.error = function () { logged.push(Array.prototype.slice.call(arguments).map(String).join(" ")); };
async function read(res) {
  const text = await res.text();
  seen.push(text + " " + (res.headers.get("Location") || ""));
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  return { status: res.status, text: text, data: data, location: res.headers.get("Location") };
}
const sha = (s) => createHash("sha256").update(s).digest("hex");
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const SHIPTOS = {
  "2010466-2": { number: "2010466-2", name: "Zeta Roofing Orlando", address: { line1: "1 Main St", city: "Orlando", state: "FL", postal: "32801", country: "USA" },
    branches: [{ number: "1234", name: "Orlando Branch" }, { number: "5678", name: "Kissimmee Branch" }] },
  "3030303-1": { number: "3030303-1", name: "Zeta Roofing Tampa", address: { line1: "9 Bay Rd", city: "Tampa", state: "FL", postal: "33601", country: "USA" },
    branches: [{ number: "9999", name: "Tampa Branch" }] }
};

function world(opts) {
  opts = opts || {};
  const d = makeDb();
  if (opts.migrated !== false) {
    migration.replace(/^\s*--[^\n]*$/gm, "").split(";").forEach((stmt) => { if (stmt.trim()) { d.raw.exec(stmt); } });
  }
  d.raw.prepare("INSERT INTO clients (id, name, language) VALUES ('c1', 'Zeta Roofing', 'en'), ('c2', 'Omega Roofing', 'pt')").run();
  const abc = { calls: [], valid: [ACCESS], challenge: null, webhooks: {}, orders: [], down: false, refreshStatus: 0, placeStatus: 202, placeFail: false,
    refreshGood: REFRESH, deniedShipTo: false, nextWebhookId: 1 };
  async function fakeFetch(url, init) {
    const u = new URL(url);
    const method = (init && init.method) || "GET";
    const headers = (init && init.headers) || {};
    let form = null, json = null;
    if (init && init.body) {
      if (String(headers["Content-Type"] || "").indexOf("json") !== -1) { json = JSON.parse(init.body); }
      else { form = Object.fromEntries(new URLSearchParams(init.body).entries()); }
    }
    abc.calls.push({ method, host: u.origin, path: u.pathname, search: u.search, headers, form, json });
    if (abc.down) { throw new Error("connect ECONNREFUSED " + url); }
    const J = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
    if (u.origin === SB_AUTH && u.pathname === SB_AUTH_PATH + "/v1/token") {
      if (headers.Authorization !== "Basic " + Buffer.from(CLIENT_ID + ":" + SECRET).toString("base64")) { return J({ error: "invalid_client" }, 401); }
      if (form.grant_type === "authorization_code") {
        if (form.code !== CODE) { return J({ error: "invalid_grant", error_description: "code used " + form.code }, 400); }
        if (!form.code_verifier || b64url(createHash("sha256").update(form.code_verifier).digest()) !== abc.challenge) { return J({ error: "invalid_grant", error_description: "pkce" }, 400); }
        return J({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 1800, token_type: "Bearer" });
      }
      if (form.grant_type === "refresh_token") {
        if (abc.refreshStatus) { return J({ error: "server" }, abc.refreshStatus); }
        if (form.refresh_token !== abc.refreshGood) { return J({ error: "invalid_grant", error_description: "refresh token expired " + form.refresh_token }, 400); }
        abc.valid.push(NEW_ACCESS);
        abc.refreshGood = NEW_REFRESH;
        return J({ access_token: NEW_ACCESS, refresh_token: NEW_REFRESH, expires_in: 1800 });
      }
      if (form.grant_type === "client_credentials") {
        if (form.scope !== "location.read product.read") { return J({ error: "invalid_scope" }, 400); }
        abc.valid.push(CC_ACCESS);
        return J({ access_token: CC_ACCESS, expires_in: 1800 });
      }
      return J({ error: "unsupported_grant_type" }, 400);
    }
    if (u.origin === SB_API || u.origin === PROD_API) {
      const bearer = String(headers.Authorization || "").replace(/^Bearer /, "");
      if (abc.valid.indexOf(bearer) === -1) { return J({ message: "Unauthorized " + bearer }, 401); }
      const p = u.pathname;
      if (p === "/api/account/v1/search/accounts" && method === "POST") { return J({ pagination: { itemsPerPage: 50, pageNumber: 1, totalPages: 1, totaItems: 3 },
        shipTos: Object.values(SHIPTOS).map((s) => ({ number: s.number, name: s.name, status: "Active", address: s.address, branches: s.branches })).concat([{ number: "4040404-1", name: "Retired", status: "Inactive", address: {}, branches: [] }]) }); }
      let m = /^\/api\/account\/v1\/shiptos\/([\w-]+)$/.exec(p);
      if (m && method === "GET") { if (abc.deniedShipTo || !SHIPTOS[m[1]]) { return J({ message: "no access" }, 401); } return J({ shipTo: SHIPTOS[m[1]] }); }
      if (p === "/api/pricing/v2/prices" && method === "POST") {
        abc.priced = json;
        return J({ shipToNumber: json.shipToNumber, branchNumber: json.branchNumber, purpose: json.purpose,
          lines: json.lines.map((l) => ({ id: l.id, itemNumber: l.itemNumber, quantity: l.quantity, uom: l.uom || "BD", unitPrice: 41.5, currency: { code: "USD", symbol: "$" }, status: { code: l.itemNumber === "BADITEM" ? "ITEM_NOT_FOUND" : "OK", message: "" } })) });
      }
      if (p === "/api/order/v2/orders" && method === "POST") {
        abc.orders.push(json);
        if (abc.placeFail) { return J({ message: "bad request" }, 400); }
        const o = json[0];
        return J({ request: { batchId: "b1", ordersReceived: 1, ordersFailed: 0, ordersSucceded: 1 }, orders: [{ requestId: o.requestId, confirmationNumber: "CONF-7001", message: "ok" }] }, abc.placeStatus);
      }
      if (p === "/api/notification/v2/webhooks" && method === "POST") {
        const id = "wh-" + (abc.nextWebhookId++);
        abc.webhooks[id] = json;
        return J({ id: id, name: json.name, status: "REGISTERED", links: { self: "x" }, secret: WH_SECRET }, 200);
      }
      m = /^\/api\/notification\/v2\/webhooks\/([\w-]+)$/.exec(p);
      if (m && method === "DELETE") { delete abc.webhooks[m[1]]; return J({}, 200); }
      if (p === "/api/location/v1/branches" && method === "GET") { return J([{ branch: { number: "1" } }, { branch: { number: "2" } }, { branch: { number: "3" } }]); }
      if (p === "/api/product/v1/search/items" && method === "POST") { return J({ pagination: { itemsPerPage: 1, pageNumber: 1, totalPages: 9, totalItems: 9 }, items: [{ itemNumber: "X" }] }); }
    }
    return J({ title: "unknown path in the fake", detail: url }, 500);
  }
  const stubs = { authenticate: async () => user, fetch: fakeFetch, btoa: (s) => Buffer.from(s, "binary").toString("base64") };
  const F = build(FNS, VARS, stubs, opts.src);
  const env = Object.assign({ DB: d.DB }, opts.env || ENV_OK);
  return { d, env, F, abc };
}

const API = "https://apex-api.farfromtimnah.workers.dev";
const get = (path, headers) => new Request(API + path, { method: "GET", headers: headers || {} });
const post = (path, body, headers) => new Request(API + path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers || {}), body: typeof body === "string" ? body : JSON.stringify(body || {}) });
const challengeOf = (url) => new URL(url).searchParams.get("code_challenge");

// Connects client c1 through the real connect and callback handlers.
async function connect(w) {
  user = OWNER;
  const c = await read(await w.F.handlePostGmAbcConnect("c1", post("/x", {}), w.env));
  const u = new URL(c.data.url);
  w.abc.challenge = u.searchParams.get("code_challenge");
  const cb = await read(await w.F.handleGetAbcCallback(get("/api/abc/callback?code=" + CODE + "&state=" + u.searchParams.get("state")), w.env));
  return { connectRes: c, cb: cb, state: u.searchParams.get("state") };
}
async function connectAndChoose(w) {
  await connect(w);
  return read(await w.F.handlePostGmAbcAccount("c1", post("/x", { ship_to: "2010466-2", branch: "1234" }), w.env));
}
const ORDER = () => ({ order_ref: "AP-1001", ship_to: "2010466-2", branch: "1234", delivery_date: "2026-11-20", delivery_service: "COM", job_name: "Smith roof",
  address: { line1: "12 Oak Ave", city: "Orlando", state: "FL", postal: "32801" }, contact: { name: "Ana Souza", email: "ana@example.com", phone: "(407) 555-0142" },
  lines: [{ item_number: "02GASTZ3WW", description: "Shingle bundle", quantity: 30, uom: "BD", unit_price: 41.5 }] });
const sealedOk = (v) => typeof v === "string" && v.indexOf("enc:v1:") === 0;

// ── 1. Settings and the sandbox gate ─────────────────────────────────────
await check("settings", async () => {
  const w = world();
  ok(w.F.abcSettings({}).mode === "sandbox", "no ABC_ENV: sandbox, never production");
  ok(w.F.abcSettings({ ABC_ENV: "Production " }).mode === "production", "ABC_ENV production (any case, trimmed) is production");
  ok(w.F.abcSettings({ ABC_ENV: "prod" }).mode === "sandbox", "any other ABC_ENV value stays sandbox");
  ok(w.F.abcSettings(ENV_OK).ready === true, "ready with the two secrets and the sealing key");
  ok(w.F.abcSettings({ ABC_CLIENT_ID: "a", ABC_CLIENT_SECRET: "b" }).ready === false, "not ready without the sealing key");
  ok(w.F.abcSettings({ TOKEN_ENC_KEY: "k" }).ready === false, "not ready without the secrets");
  const sb = w.F.abcSettings(ENV_OK);
  ok(sb.api_origin === SB_API && sb.auth_origin === SB_AUTH + SB_AUTH_PATH, "sandbox hosts are the sandbox ones");
  const pr = w.F.abcSettings(Object.assign({ ABC_ENV: "production" }, ENV_OK));
  ok(pr.api_origin === PROD_API && pr.auth_origin === "https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357", "production hosts only in production");
});
await check("gate", async () => {
  const w = world();
  const sb = w.F.abcSettings(ENV_OK);
  ok(w.F.abcClientAllowed(sb, "c1") === true && w.F.abcClientAllowed(sb, "c2") === false, "sandbox: only the listed client ids");
  const dflt = w.F.abcSettings({ ABC_CLIENT_ID: "a", ABC_CLIENT_SECRET: "b", TOKEN_ENC_KEY: "k" });
  ok(w.F.abcClientAllowed(dflt, "test-client-temp-001") === true && w.F.abcClientAllowed(dflt, "c1") === false, "variable unset: only the Apex test client");
  const none = w.F.abcSettings({ ABC_SANDBOX_CLIENT_IDS: "", ABC_CLIENT_ID: "a", ABC_CLIENT_SECRET: "b", TOKEN_ENC_KEY: "k" });
  ok(w.F.abcClientAllowed(none, "test-client-temp-001") === false, "variable set empty: nobody");
  const pr = w.F.abcSettings(Object.assign({ ABC_ENV: "production" }, ENV_OK));
  ok(w.F.abcClientAllowed(pr, "c2") === true, "production: every client");
  user = OWNER;
  const w2 = world({ env: Object.assign({}, ENV_OK, { ABC_SANDBOX_CLIENT_IDS: "someone-else" }) });
  const s = await read(await w2.F.handleGetGmAbcStatus("c1", get("/x"), w2.env));
  ok(s.status === 200 && s.data.available === false && s.data.connected === false, "client not on the list: status says available false");
  const c = await read(await w2.F.handlePostGmAbcConnect("c1", post("/x", {}), w2.env));
  ok(c.status === 503 && c.data.available === false && !w2.d.q("SELECT * FROM gm_abc_oauth_states").length, "client not on the list: connect refuses and stores no state");
  const w3 = world({ migrated: false });
  const s3 = await read(await w3.F.handleGetGmAbcStatus("c1", get("/x"), w3.env));
  ok(s3.data.available === false, "tables missing: status says available false");
  const c3 = await read(await w3.F.handlePostGmAbcConnect("c1", post("/x", {}), w3.env));
  ok(c3.status === 503, "tables missing: connect says not available yet");
});

// ── 2. Who may call every owner route ─────────────────────────────────────
await check("guards", async () => {
  const w = world();
  const calls = {
    status: () => w.F.handleGetGmAbcStatus("c1", get("/x"), w.env),
    connect: () => w.F.handlePostGmAbcConnect("c1", post("/x", {}), w.env),
    disconnect: () => w.F.handlePostGmAbcDisconnect("c1", post("/x", {}), w.env),
    accounts: () => w.F.handleGetGmAbcAccounts("c1", get("/x"), w.env),
    account: () => w.F.handlePostGmAbcAccount("c1", post("/x", { ship_to: "2010466-2", branch: "1234" }), w.env),
    price: () => w.F.handlePostGmAbcPrice("c1", post("/x", { lines: [] }), w.env),
    order: () => w.F.handlePostGmAbcOrder("c1", post("/x", ORDER()), w.env),
    orders: () => w.F.handleGetGmAbcOrders("c1", get("/x"), w.env)
  };
  for (const k of Object.keys(calls)) {
    user = null; ok((await calls[k]()).status === 401, k + ": not signed in is 401");
    user = SELLER; ok((await calls[k]()).status === 403, k + ": a salesperson of the business is 403");
    user = RIVAL; ok((await calls[k]()).status === 403, k + ": another business's owner is 403");
    user = STAFF; ok((await calls[k]()).status === 403, k + ": platform staff is 403 (the contractor must be the one asking)");
  }
  ok(w.abc.calls.length === 0, "no call reached ABC from a refused request");
  user = OWNER;
});

// ── 3. Connect, state and PKCE ────────────────────────────────────────────
await check("connect", async () => {
  const w = world();
  user = OWNER;
  const r = await read(await w.F.handlePostGmAbcConnect("c1", post("/x", {}), w.env));
  ok(r.status === 200 && r.data.url && r.data.url.indexOf(SB_AUTH + SB_AUTH_PATH + "/v1/authorize?") === 0, "connect returns the ABC sandbox sign-in address");
  const u = new URL(r.data.url);
  ok(u.searchParams.get("client_id") === CLIENT_ID && u.searchParams.get("response_type") === "code", "client id and response type");
  ok(u.searchParams.get("redirect_uri") === API + "/api/abc/callback", "redirect uri is the registered one");
  ok(u.searchParams.get("code_challenge_method") === "S256" && /^[A-Za-z0-9_-]{43}$/.test(u.searchParams.get("code_challenge") || ""), "PKCE S256 challenge present");
  ok(/^[a-f0-9]{48}$/.test(u.searchParams.get("state") || ""), "state is 48 hex");
  const sc = u.searchParams.get("scope").split(" ");
  ok(["location.read", "product.read", "account.read", "pricing.read", "order.read", "order.write", "notification.read", "notification.write", "offline_access"].every((s) => sc.indexOf(s) !== -1), "all nine scopes, offline_access included");
  const row = w.d.q("SELECT * FROM gm_abc_oauth_states")[0];
  ok(row && row.client_id === "c1" && sealedOk(row.verifier_sealed), "state row holds the verifier SEALED");
  ok(!JSON.stringify(row).match(/[A-Za-z0-9_-]{43,128}/) || sealedOk(row.verifier_sealed), "no plain verifier in the row");
  ok(row.used_at === null && row.expires_at > new Date().toISOString().replace("T", " ").slice(0, 19), "state expires later and is unused");
  ok(!HIDDEN.some((h) => r.text.indexOf(h) !== -1 && h !== CLIENT_ID), "no secret in the connect answer");
  const prod = world({ env: Object.assign({ ABC_ENV: "production" }, ENV_OK) });
  const p = await read(await prod.F.handlePostGmAbcConnect("c2", post("/x", {}), prod.env));
  user = RIVAL;
  const p2 = await read(await prod.F.handlePostGmAbcConnect("c2", post("/x", {}), prod.env));
  ok(p2.data && p2.data.url && p2.data.url.indexOf("https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/authorize?") === 0, "production uses the production sign-in only when ABC_ENV is production");
  user = OWNER;
  // Rate limit: the 11th connect from one client in the window is 429.
  const w2 = world();
  let last = null;
  for (let i = 0; i < 11; i++) { last = await w2.F.handlePostGmAbcConnect("c1", post("/x", {}), w2.env); }
  ok(last.status === 429, "connect: too many requests is 429");
});

// ── 4. Callback ──────────────────────────────────────────────────────────
await check("callback", async () => {
  const w = world();
  const r = await connect(w);
  ok(r.cb.status === 302 && /[?&]abc=connected$/.test(r.cb.location), "good callback sends the person back showing connected");
  ok(r.cb.location.indexOf(CODE) === -1 && r.cb.location.indexOf(ACCESS) === -1 && r.cb.location.indexOf("state=") === -1, "return address carries no code, token or state");
  const tokenCall = w.abc.calls.find((c) => c.form && c.form.grant_type === "authorization_code");
  ok(tokenCall && tokenCall.form.code === CODE && tokenCall.form.redirect_uri === API + "/api/abc/callback" && !!tokenCall.form.code_verifier, "token call sent code, redirect uri and the PKCE verifier");
  ok(tokenCall.headers.Authorization === "Basic " + Buffer.from(CLIENT_ID + ":" + SECRET).toString("base64"), "token call used HTTP Basic");
  const conn = w.d.q("SELECT * FROM gm_abc_connections")[0];
  ok(conn && sealedOk(conn.token_sealed) && sealedOk(conn.refresh_sealed) && conn.token_sealed.indexOf(ACCESS) === -1 && conn.refresh_sealed.indexOf(REFRESH) === -1, "both tokens stored sealed");
  ok(conn.environment === "sandbox" && conn.needs_reconnect === 0 && conn.connected_by === "Zeta Owner" && conn.ship_to_number === null, "environment, connected_by, no account chosen yet");
  ok(w.d.q("SELECT used_at FROM gm_abc_oauth_states WHERE state = ?", r.state)[0].used_at !== null, "state is marked used");
  const before = w.abc.calls.length;
  const again = await read(await w.F.handleGetAbcCallback(get("/api/abc/callback?code=" + CODE + "&state=" + r.state), w.env));
  ok(again.status === 302 && /abc=failed$/.test(again.location) && w.abc.calls.length === before, "a reused state is refused and ABC is not called");
  const bad = await read(await w.F.handleGetAbcCallback(get("/api/abc/callback?code=" + CODE + "&state=" + "f".repeat(48)), w.env));
  ok(/abc=failed$/.test(bad.location) && w.abc.calls.length === before, "an unknown state is refused and ABC is not called");
  const junk = await read(await w.F.handleGetAbcCallback(get("/api/abc/callback?code=" + CODE + "&state=zz' OR 1=1"), w.env));
  ok(/abc=failed$/.test(junk.location), "a malformed state is refused");
  // Expired state
  const w2 = world();
  user = OWNER;
  const c = await read(await w2.F.handlePostGmAbcConnect("c1", post("/x", {}), w2.env));
  const st = new URL(c.data.url).searchParams.get("state");
  w2.d.raw.prepare("UPDATE gm_abc_oauth_states SET expires_at = datetime('now', '-1 minutes') WHERE state = ?").run(st);
  const ex = await read(await w2.F.handleGetAbcCallback(get("/api/abc/callback?code=" + CODE + "&state=" + st), w2.env));
  ok(/abc=failed$/.test(ex.location) && !w2.abc.calls.length && !w2.d.q("SELECT * FROM gm_abc_connections").length, "an expired state is refused, nothing stored");
  // ABC says error
  const w3 = world();
  const c3 = await read(await w3.F.handlePostGmAbcConnect("c1", post("/x", {}), w3.env));
  const st3 = new URL(c3.data.url).searchParams.get("state");
  const er = await read(await w3.F.handleGetAbcCallback(get("/api/abc/callback?error=access_denied&state=" + st3), w3.env));
  ok(/abc=failed$/.test(er.location) && !w3.abc.calls.length, "ABC error answer: refused, ABC token endpoint not called");
  // Wrong PKCE verifier at ABC fails and stores nothing
  const w4 = world();
  const c4 = await read(await w4.F.handlePostGmAbcConnect("c1", post("/x", {}), w4.env));
  w4.abc.challenge = "not-the-challenge";
  const wrong = await read(await w4.F.handleGetAbcCallback(get("/api/abc/callback?code=" + CODE + "&state=" + new URL(c4.data.url).searchParams.get("state")), w4.env));
  ok(/abc=failed$/.test(wrong.location) && !w4.d.q("SELECT * FROM gm_abc_connections").length, "a PKCE mismatch at ABC stores nothing");
  // Plain visit
  const plain = await read(await w4.F.handleGetAbcCallback(get("/api/abc/callback"), w4.env));
  ok(plain.status === 200, "callback with nothing answers a plain note");
  // Rate limit
  const w5 = world();
  let lim = null;
  for (let i = 0; i < 31; i++) { lim = await w5.F.handleGetAbcCallback(get("/api/abc/callback?code=x&state=" + "a".repeat(48), { "CF-Connecting-IP": "1.2.3.4" }), w5.env); }
  ok(lim.status === 429, "callback: too many requests from one address is 429");
});

// ── 5. Token refresh ─────────────────────────────────────────────────────
await check("refresh", async () => {
  const w = world();
  await connect(w);
  const cfg = w.F.abcSettings(w.env);
  const n0 = w.abc.calls.length;
  ok((await w.F.abcAccessToken(w.env, cfg, "c1")) === ACCESS && w.abc.calls.length === n0, "token with 30 minutes left: used as it is, no refresh");
  w.d.raw.prepare("UPDATE gm_abc_connections SET token_expires_at = datetime('now', '+3 minutes')").run();
  ok((await w.F.abcAccessToken(w.env, cfg, "c1")) === ACCESS && w.abc.calls.length === n0, "3 minutes left: still no refresh");
  w.d.raw.prepare("UPDATE gm_abc_connections SET token_expires_at = datetime('now', '+100 seconds')").run();
  const t = await w.F.abcAccessToken(w.env, cfg, "c1");
  ok(t === NEW_ACCESS, "under 2 minutes left: refreshed");
  const conn = w.d.q("SELECT * FROM gm_abc_connections")[0];
  ok(sealedOk(conn.token_sealed) && conn.token_expires_at > new Date(Date.now() + 25 * 60000).toISOString().replace("T", " ").slice(0, 19), "new tokens stored sealed with a new expiry");
  const rc = w.abc.calls.filter((c) => c.form && c.form.grant_type === "refresh_token")[0];
  ok(rc && rc.form.refresh_token === REFRESH, "refresh used the stored refresh token");
  // Refresh refused: reconnect flagged
  const w2 = world();
  await connect(w2);
  w2.abc.refreshGood = "something-else";
  w2.d.raw.prepare("UPDATE gm_abc_connections SET token_expires_at = datetime('now', '-1 minutes')").run();
  let threw = false;
  try { await w2.F.abcAccessToken(w2.env, w2.F.abcSettings(w2.env), "c1"); } catch (e) { threw = true; }
  const c2 = w2.d.q("SELECT needs_reconnect, last_error FROM gm_abc_connections")[0];
  ok(threw && c2.needs_reconnect === 1, "refresh refused: needs_reconnect set and the call fails");
  ok(!HIDDEN.some((h) => String(c2.last_error).indexOf(h) !== -1), "stored error text hides tokens");
  const st = await read(await w2.F.handleGetGmAbcStatus("c1", get("/x"), w2.env));
  ok(st.data.needs_reconnect === true, "status shows reconnect needed");
  // A server error at ABC is not a reason to ask the owner to sign in again
  const w3 = world();
  await connect(w3);
  w3.abc.refreshStatus = 503;
  w3.d.raw.prepare("UPDATE gm_abc_connections SET token_expires_at = datetime('now', '-1 minutes')").run();
  try { await w3.F.abcAccessToken(w3.env, w3.F.abcSettings(w3.env), "c1"); } catch (e) { /* expected */ }
  ok(w3.d.q("SELECT needs_reconnect FROM gm_abc_connections")[0].needs_reconnect === 0, "ABC server error: not flagged");
  // Two requests refresh at once: ABC rotates the refresh token, so the second one is refused. It must use the first one's result.
  const w4 = world();
  await connect(w4);
  w4.d.raw.prepare("UPDATE gm_abc_connections SET token_expires_at = datetime('now', '-1 minutes')").run();
  const cfg4 = w4.F.abcSettings(w4.env);
  const both = await Promise.all([w4.F.abcAccessToken(w4.env, cfg4, "c1"), w4.F.abcAccessToken(w4.env, cfg4, "c1")]);
  ok(both[0] === NEW_ACCESS && both[1] === NEW_ACCESS, "two refreshes at once: both get the new token");
  ok(w4.d.q("SELECT needs_reconnect FROM gm_abc_connections")[0].needs_reconnect === 0, "two refreshes at once: nobody is told to reconnect");
  // Tokens from one environment are never sent to the other
  const w5 = world();
  await connect(w5);
  w5.d.raw.prepare("UPDATE gm_abc_connections SET environment = 'production'").run();
  const n5 = w5.abc.calls.length;
  let threw5 = false;
  try { await w5.F.abcAccessToken(w5.env, w5.F.abcSettings(w5.env), "c1"); } catch (e) { threw5 = true; }
  ok(threw5 && w5.abc.calls.length === n5, "a production token is never used in sandbox mode");
  // Flagged connection is not used
  w5.d.raw.prepare("UPDATE gm_abc_connections SET environment = 'sandbox', needs_reconnect = 1").run();
  let threw6 = false;
  try { await w5.F.abcAccessToken(w5.env, w5.F.abcSettings(w5.env), "c1"); } catch (e) { threw6 = true; }
  ok(threw6, "a connection flagged needs_reconnect is not used");
});

// ── 6. Accounts and webhook ──────────────────────────────────────────────
await check("accounts", async () => {
  const w = world();
  await connect(w);
  const l = await read(await w.F.handleGetGmAbcAccounts("c1", get("/x"), w.env));
  ok(l.status === 200 && l.data.accounts.length === 2 && l.data.accounts[0].ship_to === "2010466-2" && l.data.accounts[0].branches[0].number === "1234", "accounts lists ship-to accounts with their branches, retired ones left out");
  const body = w.abc.calls.find((c) => c.path === "/api/account/v1/search/accounts").json;
  ok(body.filters[0].key === "accountType" && body.filters[0].values[0] === "Ship-To", "search asks for Ship-To accounts");
  for (const bad of [{}, { ship_to: "2010466-2" }, { branch: "1234" }, { ship_to: "x'; DROP TABLE x;--", branch: "1234" }, { ship_to: "2010466-2", branch: "12 34" }, { ship_to: 5, branch: "1234" }, { ship_to: "2010466-2", branch: "9999" }, { ship_to: "7777777-7", branch: "1234" }]) {
    const r = await read(await w.F.handlePostGmAbcAccount("c1", post("/x", bad), w.env));
    ok((r.status === 400 || r.status === 403) && w.d.q("SELECT ship_to_number FROM gm_abc_connections")[0].ship_to_number === null, "bad account " + JSON.stringify(bad) + " refused and nothing saved");
  }
  ok(!w.abc.calls.some((c) => c.path === "/api/notification/v2/webhooks"), "no webhook registered by a refused save");
  const s = await read(await w.F.handlePostGmAbcAccount("c1", post("/x", { ship_to: "2010466-2", branch: "1234" }), w.env));
  ok(s.status === 200 && s.data.saved === true, "a valid account and branch are saved");
  const c = w.d.q("SELECT ship_to_number, branch_number FROM gm_abc_connections")[0];
  ok(c.ship_to_number === "2010466-2" && c.branch_number === "1234", "stored");
  const reg = w.abc.calls.filter((x) => x.path === "/api/notification/v2/webhooks" && x.method === "POST");
  ok(reg.length === 1 && reg[0].json.type === "ORDER" && reg[0].json.events.join() === "ORDER_UPDATE,ORDER_INVOICED", "one webhook registered for both order events");
  const m = /\/api\/abc\/webhook\/([a-f0-9]{48})$/.exec(reg[0].json.url);
  ok(!!m && reg[0].json.url.indexOf(API) === 0, "the webhook address is on this Worker with a 48 hex token");
  const wh = w.d.q("SELECT * FROM gm_abc_webhooks")[0];
  ok(wh.token_hash === sha(m[1]) && wh.secret_hash === sha(WH_SECRET) && wh.abc_webhook_id === "wh-1", "only hashes of the token and the secret are stored");
  ok(JSON.stringify(wh).indexOf(m[1]) === -1 && JSON.stringify(wh).indexOf(WH_SECRET) === -1, "neither the token nor the secret is stored in the clear");
  await w.F.handlePostGmAbcAccount("c1", post("/x", { ship_to: "3030303-1", branch: "9999" }), w.env);
  ok(w.abc.calls.filter((x) => x.path === "/api/notification/v2/webhooks" && x.method === "POST").length === 1, "choosing another account does not register a second webhook");
  const st = await read(await w.F.handleGetGmAbcStatus("c1", get("/x"), w.env));
  ok(st.data.connected && st.data.ship_to === "3030303-1" && st.data.branch === "9999" && st.data.webhook === true, "status shows the chosen account and the webhook");
  ok(!/token|secret|refresh/i.test(Object.keys(st.data).join(",")), "status has no token fields");
  // ABC refuses the ship-to
  const w2 = world();
  await connect(w2);
  w2.abc.deniedShipTo = true;
  const d = await read(await w2.F.handlePostGmAbcAccount("c1", post("/x", { ship_to: "2010466-2", branch: "1234" }), w2.env));
  ok(d.status >= 400 && w2.d.q("SELECT ship_to_number FROM gm_abc_connections")[0].ship_to_number === null, "ABC refuses the ship-to: nothing saved");
});

// ── 7. Price ──────────────────────────────────────────────────────────────
await check("price", async () => {
  const w = world();
  await connectAndChoose(w);
  const good = { lines: [{ item_number: "02GASTZ3WW", quantity: 30 }, { item_number: "BADITEM", quantity: 2, uom: "EA" }] };
  const nw = w.d.writes.length;
  const r = await read(await w.F.handlePostGmAbcPrice("c1", post("/x", good), w.env));
  ok(r.status === 200 && r.data.lines.length === 2 && r.data.lines[0].unit_price === 41.5 && r.data.lines[0].uom === "BD", "prices come back with unit price and unit");
  ok(r.data.ship_to === "2010466-2" && r.data.branch === "1234" && r.data.source === "ABC account price" && /^\d{4}-\d\d-\d\dT/.test(r.data.retrieved_at), "marked as an ABC account price with ship-to, branch and retrieval time");
  ok(r.data.lines[1].status === "ITEM_NOT_FOUND", "a line ABC could not price says so");
  ok(w.d.writes.length === nw, "pricing writes nothing to the database");
  ok(w.abc.priced.shipToNumber === "2010466-2" && w.abc.priced.branchNumber === "1234" && w.abc.priced.purpose === "estimating", "ABC was asked for the SAVED ship-to and branch");
  const bads = [{}, { lines: [] }, { lines: "x" }, { lines: [{ item_number: "A", quantity: 0 }] }, { lines: [{ item_number: "A", quantity: 1.5 }] }, { lines: [{ item_number: "A", quantity: -1 }] },
    { lines: [{ item_number: "", quantity: 1 }] }, { lines: [{ item_number: "A B", quantity: 1 }] }, { lines: [{ item_number: "A", quantity: "3" }] }, { lines: [{ item_number: "A", quantity: 1, uom: "bad uom!" }] },
    { lines: Array.from({ length: 51 }, () => ({ item_number: "A", quantity: 1 })) }];
  const before = w.abc.calls.length;
  for (const b of bads) { const x = await read(await w.F.handlePostGmAbcPrice("c1", post("/x", b), w.env)); ok(x.status === 400, "bad price input refused: " + JSON.stringify(b).slice(0, 60)); }
  ok((await read(await w.F.handlePostGmAbcPrice("c1", post("/x", "not json"), w.env))).status === 400, "unreadable body is 400");
  ok(w.abc.calls.length === before, "bad input never reaches ABC");
  const w2 = world();
  await connect(w2);
  const none = await read(await w2.F.handlePostGmAbcPrice("c1", post("/x", good), w2.env));
  ok(none.status === 409, "no account chosen yet: 409, ABC not asked for prices");
  ok(!w2.abc.calls.some((c) => c.path === "/api/pricing/v2/prices"), "no price call without a chosen account");
});

// ── 8. Orders ─────────────────────────────────────────────────────────────
await check("order", async () => {
  const w = world();
  await connectAndChoose(w);
  const r = await read(await w.F.handlePostGmAbcOrder("c1", post("/x", ORDER()), w.env));
  ok(r.status === 200 && r.data.order_ref === "AP-1001" && r.data.status === "submitted" && r.data.confirmation_number === "CONF-7001", "order accepted by ABC for review: status submitted, never accepted");
  const sent = w.abc.orders[0][0];
  ok(Array.isArray(w.abc.orders[0]) && sent.requestId === "AP-1001" && sent.purchaseOrder === "AP-1001" && sent.typeCode === "SO" && sent.currency === "USD", "ABC got a one-order array with our reference, SO and USD");
  ok(sent.branchNumber === "1234" && sent.shipTo.number === "2010466-2" && sent.deliveryService === "COM" && sent.dates.deliveryRequestedFor === "2026-11-20", "branch, ship-to, delivery service and date");
  ok(sent.lines[0].id === 1 && sent.lines[0].orderedQty.value === 30 && sent.lines[0].unitPrice.value === 41.5 && sent.lines[0].unitPrice.instructions === "", "line quantity and price as the person sent them");
  ok(sent.shipTo.contacts.some((c) => c.functionCode === "SM") && sent.shipTo.contacts.some((c) => c.functionCode === "DC" && c.phones[0].number === "4075550142"), "submitting and delivery contacts, phone as 10 digits");
  const row = w.d.q("SELECT * FROM gm_abc_orders")[0];
  ok(row.status === "submitted" && row.abc_order_id === "CONF-7001" && row.order_ref === "AP-1001" && row.created_by === "Zeta Owner", "row stored as submitted with ABC's confirmation number");
  const dup = await read(await w.F.handlePostGmAbcOrder("c1", post("/x", ORDER()), w.env));
  ok(dup.status === 409 && w.abc.orders.length === 1, "the same reference again is 409 and ABC is not called a second time");
  // Strict validation: each broken field is a 400 and ABC is never called
  const mutate = (fn) => { const o = ORDER(); fn(o); return o; };
  const bads = {
    "no order_ref": mutate((o) => { delete o.order_ref; }), "ref too long": mutate((o) => { o.order_ref = "A".repeat(17); }), "ref with space": mutate((o) => { o.order_ref = "A 1"; }),
    "no ship_to": mutate((o) => { delete o.ship_to; }), "other ship_to": mutate((o) => { o.ship_to = "3030303-1"; }), "no branch": mutate((o) => { delete o.branch; }), "other branch": mutate((o) => { o.branch = "5678"; }),
    "date not real": mutate((o) => { o.delivery_date = "2026-02-30"; }), "date format": mutate((o) => { o.delivery_date = "11/20/2026"; }),
    "no service": mutate((o) => { delete o.delivery_service; }), "service not listed": mutate((o) => { o.delivery_service = "FAST"; }),
    "no job name": mutate((o) => { delete o.job_name; }), "no address": mutate((o) => { delete o.address; }), "state not 2 letters": mutate((o) => { o.address.state = "Florida"; }), "zip bad": mutate((o) => { o.address.postal = "abc"; }),
    "no contact": mutate((o) => { delete o.contact; }), "email bad": mutate((o) => { o.contact.email = "nope"; }), "phone short": mutate((o) => { o.contact.phone = "555"; }), "no contact name": mutate((o) => { o.contact.name = ""; }),
    "no lines": mutate((o) => { o.lines = []; }), "100 lines": mutate((o) => { o.lines = Array.from({ length: 100 }, () => ORDER().lines[0]); }),
    "qty zero": mutate((o) => { o.lines[0].quantity = 0; }), "qty text": mutate((o) => { o.lines[0].quantity = "30"; }), "no price": mutate((o) => { delete o.lines[0].unit_price; }), "negative price": mutate((o) => { o.lines[0].unit_price = -1; }),
    "price text": mutate((o) => { o.lines[0].unit_price = "41.5"; }), "no uom": mutate((o) => { delete o.lines[0].uom; }), "no description": mutate((o) => { o.lines[0].description = ""; }), "bad item": mutate((o) => { o.lines[0].item_number = "a b"; })
  };
  for (const k of Object.keys(bads)) {
    const x = Object.assign({}, bads[k]);
    if (x.order_ref === "AP-1001") { x.order_ref = "AP-2002"; }
    const before = w.abc.orders.length;
    const res = await read(await w.F.handlePostGmAbcOrder("c1", post("/x", x), w.env));
    ok(res.status === 400 && w.abc.orders.length === before, "order refused (400), ABC not called: " + k);
  }
  ok(w.d.q("SELECT COUNT(*) AS n FROM gm_abc_orders")[0].n === 1, "refused orders left no rows");
  // 2026-11-07: the delivery date is optional. Left out, the order goes without a date and the branch decides.
  const noDate = ORDER(); delete noDate.delivery_date; noDate.order_ref = "AP-3003";
  const nd = await read(await w.F.handlePostGmAbcOrder("c1", post("/x", noDate), w.env));
  ok(nd.status === 200 && w.abc.orders[w.abc.orders.length - 1].dates === undefined, "an order with no delivery date is accepted and sent without a date");
  ok((await read(await w.F.handlePostGmAbcOrder("c1", post("/x", "not json"), w.env))).status === 400, "unreadable body is 400");
  // ABC refuses: no row left behind, the person can try again with the same reference
  const w2 = world();
  await connectAndChoose(w2);
  w2.abc.placeFail = true;
  const f = await read(await w2.F.handlePostGmAbcOrder("c1", post("/x", ORDER()), w2.env));
  ok(f.status === 502 && !w2.d.q("SELECT * FROM gm_abc_orders").length, "ABC refuses the order: error, no row left");
  ok(!HIDDEN.some((h) => f.text.indexOf(h) !== -1), "error text hides secrets");
  w2.abc.placeFail = false;
  const again = await read(await w2.F.handlePostGmAbcOrder("c1", post("/x", ORDER()), w2.env));
  ok(again.status === 200, "same reference works after ABC refused it");
  // ABC unreachable mid-order: we do not know if it arrived, so the row stays and the reference is not reusable
  const w3 = world();
  await connectAndChoose(w3);
  w3.abc.down = true;
  const amb = await read(await w3.F.handlePostGmAbcOrder("c1", post("/x", ORDER()), w3.env));
  ok(amb.status === 502 && w3.d.q("SELECT status FROM gm_abc_orders")[0].status === "submitted", "no answer from ABC: row kept as submitted, nothing guessed");
  // Orders list is the business's own
  const w4 = world();
  await connectAndChoose(w4);
  await w4.F.handlePostGmAbcOrder("c1", post("/x", ORDER()), w4.env);
  w4.d.raw.prepare("INSERT INTO gm_abc_orders (id, client_id, order_ref, status) VALUES ('o2', 'c2', 'OTHER-1', 'submitted')").run();
  const l = await read(await w4.F.handleGetGmAbcOrders("c1", get("/x"), w4.env));
  ok(l.status === 200 && l.data.orders.length === 1 && l.data.orders[0].order_ref === "AP-1001" && l.text.indexOf("OTHER-1") === -1, "orders list shows only this business's orders");
});

// ── 9. Webhook ────────────────────────────────────────────────────────────
async function hookWorld() {
  const w = world();
  await connectAndChoose(w);
  const reg = w.abc.calls.filter((x) => x.path === "/api/notification/v2/webhooks" && x.method === "POST")[0];
  w.token = /([a-f0-9]{48})$/.exec(reg.json.url)[1];
  await w.F.handlePostGmAbcOrder("c1", post("/x", ORDER()), w.env);
  return w;
}
const hook = (w, token, headers, body) => w.F.handlePostAbcWebhook(token, post("/api/abc/webhook/" + token, body === undefined ? {} : body, headers), w.env);
const UPDATE = (status, over) => Object.assign({ salesOrder: { confirmationNumber: "CONF-7001", purchaseOrder: "AP-1001", orderNumber: "55", status: status } }, over || {});
const orderRow = (w) => w.d.q("SELECT status, last_event_at, abc_order_id FROM gm_abc_orders WHERE order_ref = 'AP-1001'")[0];
await check("webhook", async () => {
  const w = await hookWorld();
  ok((await hook(w, "e".repeat(48), { Authorization: WH_SECRET }, UPDATE("Scheduled"))).status === 404, "unknown token is 404");
  ok((await hook(w, "not-hex", { Authorization: WH_SECRET }, UPDATE("Scheduled"))).status === 404, "malformed token is 404");
  ok((await hook(w, w.token, {}, UPDATE("Scheduled"))).status === 401 && orderRow(w).status === "submitted", "no secret: 401 and nothing changes");
  ok((await hook(w, w.token, { Authorization: "wrong" }, UPDATE("Scheduled"))).status === 401 && orderRow(w).status === "submitted", "wrong secret: 401 and nothing changes");
  const ok1 = await hook(w, w.token, { Authorization: WH_SECRET }, UPDATE("Scheduled"));
  ok(ok1.status === 200 && orderRow(w).status === "scheduled" && orderRow(w).last_event_at !== null, "good secret: status updated and last_event_at set");
  const ok2 = await hook(w, w.token, { Authorization: "Bearer " + WH_SECRET }, UPDATE("Delivered"));
  ok(ok2.status === 200 && orderRow(w).status === "delivered", "the secret is also accepted with a Bearer prefix");
  // Never trust a client id from the body
  w.d.raw.prepare("INSERT INTO gm_abc_orders (id, client_id, order_ref, abc_order_id, status) VALUES ('o9', 'c2', 'AP-1001', 'CONF-7001', 'submitted')").run();
  await hook(w, w.token, { Authorization: WH_SECRET }, UPDATE("Canceled", { clientId: "c2", client_id: "c2" }));
  ok(w.d.q("SELECT status FROM gm_abc_orders WHERE client_id = 'c2'")[0].status === "submitted", "a client id in the body is ignored: the other business's order is untouched");
  // Invoiced is final
  const inv = await hook(w, w.token, {}, { event: "invoice", eventType: "ORDER_INVOICED", webhookDetails: [{ apiKey: WH_SECRET }], data: { orderNumber: "55", purchaseOrderNumber: "AP-1001", invoiceNumber: "I-1" } });
  ok(inv.status === 200 && orderRow(w).status === "invoiced", "invoice event (secret in the body) marks the order invoiced");
  await hook(w, w.token, { Authorization: WH_SECRET }, UPDATE("Scheduled"));
  ok(orderRow(w).status === "invoiced", "a late update never undoes invoiced");
  const badInv = await hook(w, w.token, {}, { eventType: "ORDER_INVOICED", webhookDetails: [{ apiKey: "nope" }], data: { purchaseOrderNumber: "AP-1002" } });
  ok(badInv.status === 401, "invoice event with a wrong key is 401");
  // Odd values are ignored, not stored
  const w2 = await hookWorld();
  const odd = await hook(w2, w2.token, { Authorization: WH_SECRET }, UPDATE("<script>alert(1)</script>"));
  ok(odd.status === 200 && orderRow(w2).status === "submitted", "an odd status is ignored, answer is still 200");
  const garbage = await w2.F.handlePostAbcWebhook(w2.token, new Request(API + "/x", { method: "POST", headers: { Authorization: WH_SECRET }, body: "{not json" }), w2.env);
  ok(garbage.status === 400, "unreadable body is 400");
  // Claim row (registration in progress) never matches
  w2.d.raw.prepare("INSERT INTO gm_abc_webhooks (client_id, token_hash, secret_hash, event_type) VALUES ('c9', ?, '', 'x')").run(sha("c".repeat(48)));
  ok((await hook(w2, "c".repeat(48), {}, UPDATE("Scheduled"))).status === 401, "a webhook with no secret yet never accepts events");
  // Tables missing
  const w3 = world({ migrated: false });
  ok((await hook(w3, "a".repeat(48), { Authorization: "x" }, UPDATE("x"))).status === 503, "tables missing: 503");
  ok(!HIDDEN.some((h) => logged.join("\n").indexOf(h) !== -1), "no secret in the server log");
});

// ── 10. Disconnect ───────────────────────────────────────────────────────
await check("disconnect", async () => {
  const w = await hookWorld();
  const r = await read(await w.F.handlePostGmAbcDisconnect("c1", post("/x", {}), w.env));
  ok(r.status === 200 && r.data.connected === false, "disconnect answers not connected");
  ok(w.abc.calls.some((c) => c.method === "DELETE" && c.path === "/api/notification/v2/webhooks/wh-1"), "the webhook was unregistered at ABC");
  ok(!w.d.q("SELECT * FROM gm_abc_connections").length && !w.d.q("SELECT * FROM gm_abc_webhooks").length, "tokens and webhook row deleted");
  ok(w.d.q("SELECT * FROM gm_abc_orders").length === 1, "the order history stays");
  const again = await read(await w.F.handlePostGmAbcDisconnect("c1", post("/x", {}), w.env));
  ok(again.status === 200, "safe to run twice");
  ok((await hook(w, w.token, { Authorization: WH_SECRET }, UPDATE("Scheduled"))).status === 404, "the old webhook address is dead after disconnect");
  const st = await read(await w.F.handleGetGmAbcStatus("c1", get("/x"), w.env));
  ok(st.data.connected === false && st.data.available === true, "status: available, not connected");
});

// ── 11. Staff sandbox ping ───────────────────────────────────────────────
await check("ping", async () => {
  const w = world();
  user = null; ok((await w.F.handleGetAbcSandboxPing(get("/x"), w.env)).status === 401, "ping: not signed in is 401");
  user = OWNER; ok((await w.F.handleGetAbcSandboxPing(get("/x"), w.env)).status === 403, "ping: a contractor is 403");
  user = SELLER; ok((await w.F.handleGetAbcSandboxPing(get("/x"), w.env)).status === 403, "ping: a salesperson is 403");
  ok(w.abc.calls.length === 0, "ping: refused requests never reach ABC");
  user = DEV;
  const r = await read(await w.F.handleGetAbcSandboxPing(get("/x"), w.env));
  ok(r.status === 200 && r.data.token_status === 200 && r.data.branches.status === 200 && r.data.branches.count === 3 && r.data.items.status === 200 && r.data.items.total === 9, "ping returns status codes and counts only");
  ok(!HIDDEN.some((h) => r.text.indexOf(h) !== -1), "ping answer holds no token or secret");
  const tc = w.abc.calls.find((c) => c.form && c.form.grant_type === "client_credentials");
  ok(tc && tc.form.scope === "location.read product.read", "ping asks for exactly location.read and product.read");
  ok(w.abc.calls.every((c) => c.host === SB_AUTH || c.host === SB_API), "ping stays on the sandbox hosts");
  user = STAFF;
  ok((await w.F.handleGetAbcSandboxPing(get("/x"), w.env)).status === 200, "ping: platform staff may run it");
  const nr = world({ env: {} });
  user = DEV;
  ok((await nr.F.handleGetAbcSandboxPing(get("/x"), nr.env)).status === 503, "ping: no secrets configured is 503");
  user = OWNER;
});

// ── 12. Everything that left the Worker ─────────────────────────────────
await check("hosts", async () => {
  const w = await hookWorld();
  await w.F.handlePostGmAbcPrice("c1", post("/x", { lines: [{ item_number: "A", quantity: 1 }] }), w.env);
  await w.F.handlePostGmAbcDisconnect("c1", post("/x", {}), w.env);
  ok(w.abc.calls.every((c) => c.host === SB_AUTH || c.host === SB_API), "sandbox mode never touched a production host");
  ok(w.abc.calls.length > 5, "the run really made calls to the fake ABC");
  ok(!HIDDEN.some((h) => seen.join("\n").indexOf(h) !== -1 && h !== ""), "no secret or token appeared in any answer");
  ok(!HIDDEN.some((h) => logged.join("\n").indexOf(h) !== -1), "no secret or token appeared in any log line");
});


// ── 13. The client gate in front of every route ─────────────────────────
// A business login only reaches the gm paths this gate names. Without these
// entries every ABC route answers 403 before its handler runs.
await check("gate-list", async () => {
  const w = world();
  const base = "/api/clients/c1/gm/abc/";
  const routes = [["status", "GET"], ["accounts", "GET"], ["orders", "GET"], ["connect", "POST"], ["disconnect", "POST"], ["account", "POST"], ["price", "POST"], ["order", "POST"]];
  routes.forEach(function (r) {
    ok(w.F.clientRequestAllowed(base + r[0], r[1], "c1") === true, "the owner's login reaches " + r[1] + " abc/" + r[0]);
    ok(w.F.sellerRequestAllowed(base + r[0], r[1], "c1") !== true, "a salesperson's login does not reach " + r[1] + " abc/" + r[0]);
  });
  ok(w.F.clientRequestAllowed(base + "status", "POST", "c1") !== true && w.F.clientRequestAllowed(base + "connect", "GET", "c1") !== true, "the wrong method is not let through");
  ok(w.F.clientRequestAllowed("/api/clients/c2/gm/abc/status", "GET", "c1") !== true, "another business's path is not let through");
});

console.log(fail ? "\n" + fail + " check(s) FAILED" : "\nAll ABC connect checks passed");
process.exit(fail ? 1 : 0);
