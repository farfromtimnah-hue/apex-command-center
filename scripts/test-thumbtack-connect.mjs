// Thumbtack lead connection (Partner API, 2026-10-27).
// The REAL Worker functions (cut out of worker/index.js) on an in-memory
// SQLite built from the real migration file, with a FAKE fetch standing in
// for Thumbtack. No network, no production database.
//
//   node scripts/test-thumbtack-connect.mjs
import { readFileSync } from "node:fs";
import { makeDb, build } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const root = new URL("../", import.meta.url);
const migration = readFileSync(new URL("migrations/thumbtack_connect.sql", root), "utf8");

const FNS = ["jsonOk", "jsonErr", "jsonErr2", "gmActorReplacer", "requireClientAccess", "sessionSellerName", "actorName",
  "tokenEncKey", "tokenIsSealed", "tokenSeal", "tokenOpen", "bytesToB64", "b64ToBytes", "gmStr", "gmEstNewToken",
  "gmLogLeadEvents", "gmInsertLead", "gmClientPushTargets", "clientRequestAllowed", "sellerRequestAllowed",
  "metaHex", "metaHmac", "metaSafeEqual", "metaScrub", "metaPlain", "metaAfter", "metaFmtPhone", "metaNyStamp",
  "thumbtackSettings", "thumbtackClientAllowed", "thumbtackTablesReady", "thumbtackNotAvailable", "thumbtackOwnerGuard", "thumbtackRedirectUri",
  "thumbtackWebhookUrl", "thumbtackHeaderValue", "thumbtackFetch", "thumbtackApi", "thumbtackErrTransient", "thumbtackTokenCall",
  "thumbtackAuthorizeUrl", "thumbtackBack", "thumbtackStateUse", "thumbtackFlagReconnect", "thumbtackAccessToken",
  "thumbtackStatusPayload", "thumbtackSubscribe", "thumbtackRemoveConnection", "thumbtackGrantedBusinesses", "thumbtackAfter",
  "handleGetGmThumbtackStatus", "handlePostGmThumbtackConnect", "handlePostGmThumbtackDisconnect", "handleGetGmThumbtackPhones", "handlePostGmThumbtackTestLead",
  "thumbtackE164", "handlePostGmThumbtackPhones", "handleGetThumbtackCallback", "thumbtackFmtPhone", "thumbtackLeadFields",
  "thumbtackStoreEvent", "thumbtackProcessEvent", "handlePostThumbtackWebhook", "thumbtackCron"];
const VARS = ["DEFAULT_ORIGIN", "CORS_HEADERS", "GM_ACTOR_KEY_RE", "GM_HIDDEN_ACTORS", "TOKEN_SEAL_PREFIX", "APEX_TIMEZONE",
  "GM_MONTH_NAMES_PT", "GM_LEAD_COST_FIELDS", "GM_ORIGENS", "THUMBTACK", "THUMBTACK_LEAD_ORIGEM", "THUMBTACK_ACTOR", "THUMBTACK_NA_PT", "THUMBTACK_NA_EN"];

const CLIENT_ID = "tt-client-id-123";
const SECRET = "tt-client-secret-ccc333";
const ACCESS = "TTACCESS-aaa111";
const REFRESH = "TTREFRESH-bbb222";
const CODE = "TTCODE-ddd444";
const NEW_ACCESS = "TTACCESS-new-eee555";
const NEW_REFRESH = "TTREFRESH-new-fff666";
const HIDDEN = [SECRET, ACCESS, REFRESH, CODE, NEW_ACCESS, NEW_REFRESH];
const ENV_OK = { THUMBTACK_STAGING_CLIENTS: "c1", THUMBTACK_STAGING_CLIENT_ID: CLIENT_ID, THUMBTACK_STAGING_CLIENT_SECRET: SECRET, TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64") };

const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "Zeta Owner", username: "zeta" };
const SELLER = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Maria Silva", display_name: "Maria Silva", username: "maria" };
const RIVAL = { role: "client", client_id: "c2", login_role: "client", display_name: "Omega Owner", username: "omega" };
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

function world(opts) {
  opts = opts || {};
  const d = makeDb();
  d.raw.exec("CREATE TABLE gm_leads (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, mes_lead TEXT, data_lead TEXT, cliente TEXT NOT NULL, telefone TEXT, email TEXT, origem TEXT, parceiro_id TEXT, servico TEXT, observacao TEXT, vendedor TEXT, data_contato TEXT, data_estimate TEXT, valor REAL, estagio TEXT NOT NULL DEFAULT 'novo_lead', followups INTEGER, proxima_acao TEXT, mes_fechamento TEXT, address TEXT, city TEXT, addr_street TEXT, addr_city TEXT, addr_state TEXT, addr_zip TEXT, addr_access TEXT, addr_lat REAL, addr_lon REAL, addr_located TEXT, created_by TEXT, updated_by TEXT, material REAL, mao_de_obra REAL, outros REAL, custo_administrativo REAL, comissao REAL, imposto REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  d.raw.exec("CREATE TABLE gm_lead_events (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, client_id TEXT NOT NULL, action TEXT NOT NULL, field TEXT, old_value TEXT, new_value TEXT, actor TEXT, reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  d.raw.exec("CREATE TABLE users (email TEXT, client_id TEXT, role TEXT)");
  d.raw.exec("CREATE TABLE client_logins (username TEXT, client_id TEXT, seller_name TEXT)");
  if (opts.migrated !== false) {
    migration.replace(/^\s*--[^\n]*$/gm, "").split(";").forEach((stmt) => { if (stmt.trim()) { d.raw.exec(stmt); } });
  }
  d.raw.prepare("INSERT INTO clients (id, name, language) VALUES ('c1', 'Zeta Pools', ?), ('c2', 'Omega Roofing', 'pt')").run(opts.language || "en");
  d.raw.prepare("INSERT INTO client_logins (username, client_id, seller_name) VALUES ('zeta', 'c1', NULL), ('maria', 'c1', 'Maria Silva'), ('omega', 'c2', NULL)").run();

  // The fake Thumbtack. tt.businesses: what GET /v4/businesses grants.
  const tt = { businesses: [{ businessID: "5001", name: "Zeta Pools LLC" }], calls: [], webhooks: {}, valid: [ACCESS], refreshError: false, down: false, phones: {} };
  const pushes = [];
  async function fakeFetch(url, init) {
    const u = new URL(url);
    const method = (init && init.method) || "GET";
    const headers = (init && init.headers) || {};
    let form = null;
    let json = null;
    if (init && init.body) {
      if (String(headers["Content-Type"] || "").indexOf("json") !== -1) { json = JSON.parse(init.body); }
      else { form = Object.fromEntries(new URLSearchParams(init.body).entries()); }
    }
    tt.calls.push({ method: method, host: u.origin, path: u.pathname, search: u.search, headers: headers, form: form, json: json });
    if (tt.down) { throw new Error("connect ECONNREFUSED " + url); }
    const J = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
    if (u.origin === "https://staging-auth.thumbtack.com" && u.pathname === "/oauth2/token") {
      if (headers.Authorization !== "Basic " + Buffer.from(CLIENT_ID + ":" + SECRET).toString("base64")) { return J({ error: "invalid_client" }, 401); }
      if (form.grant_type === "authorization_code") {
        if (form.code !== CODE) { return J({ error: "invalid_grant", error_description: "The code was used. code=" + form.code }, 400); }
        return J({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, token_type: "bearer" });
      }
      if (form.grant_type === "refresh_token") {
        if (tt.refreshError || form.refresh_token !== REFRESH) { return J({ error: "invalid_grant", error_description: "refresh token expired " + form.refresh_token }, 400); }
        tt.valid.push(NEW_ACCESS);
        return J({ access_token: NEW_ACCESS, refresh_token: NEW_REFRESH, expires_in: 3600 });
      }
      return J({ error: "unsupported_grant_type" }, 400);
    }
    if (u.origin === "https://staging-api.thumbtack.com") {
      const bearer = String(headers.Authorization || "").replace(/^Bearer /, "");
      if (tt.valid.indexOf(bearer) === -1) { return J({ title: "Unauthorized", status: 401, detail: "bad token " + bearer }, 401); }
      const p = u.pathname.replace(/^\/api/, "");
      if (p === "/v4/users/self" && method === "GET") { return J({ userID: "9001", email: "o@example.com" }); }
      if (p === "/v4/businesses" && method === "GET") { return J({ data: tt.businesses, pagination: { next: null, limit: 20 } }); }
      if (p === "/v4/users/disconnect" && method === "POST") { return J({}); }
      let m = /^\/v4\/businesses\/(\d+)\/webhooks$/.exec(p);
      if (m && method === "POST") { tt.webhooks[m[1]] = json; return J({ webhookID: "wh-" + m[1], webhookURL: json.webhookURL, enabled: true, authType: "CustomHeader", eventTypes: json.eventTypes }, 201); }
      m = /^\/v4\/businesses\/(\d+)\/webhooks\/([\w-]+)$/.exec(p);
      if (m && method === "DELETE") { delete tt.webhooks[m[1]]; return new Response(null, { status: 204 }); }
      m = /^\/v4\/businesses\/(\d+)\/associate-phone-numbers$/.exec(p);
      if (m && method === "GET") { return J(tt.phones[m[1]] || []); }
      if (/^\/v4\/businesses\/\d+\/webhooks\/test-negotiation$/.test(p) && method === "POST") { tt.testCalls = (tt.testCalls || 0) + 1; return new Response(null, { status: 204 }); }
      if (m && method === "POST") { (tt.phones[m[1]] = tt.phones[m[1]] || []).push({ phoneNumberID: "p" + (tt.phones[m[1]] || []).length, phoneNumber: json.phoneNumber, name: json.name }); return J({ phoneNumberID: "p1", phoneNumber: json.phoneNumber, name: json.name }); }
    }
    return J({ title: "unknown path in the fake", status: 500, detail: url }, 500);
  }
  const stubs = {
    authenticate: async () => user,
    fetch: fakeFetch,
    REQUEST_CTX: new WeakMap(),
    gmGetConfig: async () => ({ cycle_months: ["Outubro", "Novembro"] }),
    gmLeadGeocodeIfNeeded: async () => {},
    pushToUsers: async (env, targets, payload) => { pushes.push({ targets: targets, payload: payload }); },
    btoa: (s) => Buffer.from(s, "binary").toString("base64")
  };
  const F = build(FNS, VARS, stubs, opts.src);
  const env = Object.assign({ DB: d.DB }, opts.env || ENV_OK);
  return { d, env, F, tt, pushes };
}

const API = "https://apex-api.farfromtimnah.workers.dev";
const get = (path, headers) => new Request(API + path, { method: "GET", headers: headers || {} });
const post = (path, body, headers) => new Request(API + path, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers || {}), body: typeof body === "string" ? body : JSON.stringify(body || {}) });

function negotiation(id, over) {
  return Object.assign({
    event: { eventType: "NegotiationCreatedV4", description: "New Negotiation created", webhookID: "wh-5001", triggeredAt: "2026-10-27T18:14:00Z" },
    data: {
      negotiationID: String(id), createdAt: "2026-10-27T18:14:00Z",
      customer: { customerID: "77", firstName: "Ana", lastName: "Souza", phone: "+14075550142" },
      request: {
        requestID: "88", customerID: "77", description: "Need a new pool pump installed.",
        category: { categoryID: "9", name: "Pool Repair" },
        location: { address1: "12 Lake Rd", address2: "Unit 4", city: "Orlando", state: "FL", zipCode: "32801" },
        details: [{ question: "What type of pool?", answer: "Saltwater" }, { question: "Empty answer", answer: "" }]
      },
      status: "Open", leadPrice: "$45.00", chargeState: "Charged"
    }
  }, over || {});
}

// Connects c1 through the real connect + callback routes.
async function connect(w, clientId) {
  const started = await read(await w.F.handlePostGmThumbtackConnect(clientId || "c1", post("/x"), w.env));
  const state = new URL(started.data.url).searchParams.get("state");
  const back = await read(await w.F.handleGetThumbtackCallback(get("/api/thumbtack/callback?code=" + CODE + "&state=" + state), w.env));
  return { started: started, state: state, back: back };
}
// The address and header Thumbtack was given when the webhook was created.
function hookTarget(w, bizId) {
  const wh = w.tt.webhooks[bizId || "5001"];
  const path = new URL(wh.webhookURL).pathname;
  return { path: path, token: path.split("/").pop(), headerName: wh.auth.header, headerValue: wh.auth.value };
}
function hook(w, body, over) {
  const t = hookTarget(w);
  over = over || {};
  const headers = { "Content-Type": "application/json" };
  if (over.header !== null) { headers[over.headerName || t.headerName] = over.header || t.headerValue; }
  return new Request(API + (over.path || t.path), { method: "POST", headers: headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

// ── the migration only adds
{
  const sql = migration.replace(/^\s*--[^\n]*$/gm, "");
  ok(!/\b(DROP|DELETE|UPDATE|RENAME|REPLACE)\b/i.test(sql), "the migration only adds (no DROP, DELETE, UPDATE, RENAME)");
  ok(/negotiation_id\s+TEXT NOT NULL UNIQUE/.test(sql), "gm_thumbtack_events.negotiation_id is NOT NULL UNIQUE");
}

// ── not configured yet: everything says "not available"
{
  const w = world({ env: { TOKEN_ENC_KEY: ENV_OK.TOKEN_ENC_KEY } });
  const st = await read(await w.F.handleGetGmThumbtackStatus("c1", get("/x"), w.env));
  ok(st.status === 200 && st.data.available === false && st.data.connected === false, "no app id or secret: the status says not available");
  const c = await read(await w.F.handlePostGmThumbtackConnect("c1", post("/x"), w.env));
  ok(c.status === 503 && c.data.available === false, "no app id or secret: connect answers 503 not available");
  const h = await read(await w.F.handlePostThumbtackWebhook("a".repeat(48), post("/x", negotiation(1)), w.env));
  ok(h.status === 503, "no app id or secret: the webhook answers 503");
  // Staging and production credentials never mix.
  const prodOnly = world({ env: { THUMBTACK_ENV: "production", THUMBTACK_STAGING_CLIENT_ID: CLIENT_ID, THUMBTACK_STAGING_CLIENT_SECRET: SECRET, TOKEN_ENC_KEY: ENV_OK.TOKEN_ENC_KEY } });
  const pst = await read(await prodOnly.F.handleGetGmThumbtackStatus("c1", get("/x"), prodOnly.env));
  ok(pst.data.available === false, "production mode with only the STAGING credentials is not available (they are never reused)");
  const prodHost = world({ env: { THUMBTACK_ENV: "production", THUMBTACK_CLIENT_ID: CLIENT_ID, THUMBTACK_CLIENT_SECRET: SECRET, TOKEN_ENC_KEY: ENV_OK.TOKEN_ENC_KEY } });
  const prodStart = await read(await prodHost.F.handlePostGmThumbtackConnect("c1", post("/x"), prodHost.env));
  ok(new URL(prodStart.data.url).origin === "https://auth.thumbtack.com", "production mode signs in at the production host");
  const stOnly = world({ env: { THUMBTACK_CLIENT_ID: CLIENT_ID, THUMBTACK_CLIENT_SECRET: SECRET, TOKEN_ENC_KEY: ENV_OK.TOKEN_ENC_KEY } });
  const sst = await read(await stOnly.F.handleGetGmThumbtackStatus("c1", get("/x"), stOnly.env));
  ok(sst.data.available === false, "staging mode with only the PRODUCTION credentials is not available (they are never reused)");
  const w2 = world({ migrated: false });
  const st2 = await read(await w2.F.handleGetGmThumbtackStatus("c1", get("/x"), w2.env));
  ok(st2.status === 200 && st2.data.available === false, "tables not migrated yet: the status says not available");
  const c2 = await read(await w2.F.handlePostGmThumbtackConnect("c1", post("/x"), w2.env));
  ok(c2.status === 503, "tables not migrated yet: connect answers 503");
  const h2 = await read(await w2.F.handlePostThumbtackWebhook("a".repeat(48), post("/x", negotiation(1)), w2.env));
  ok(h2.status === 404 || h2.status === 503, "tables not migrated yet: the webhook does not crash (" + h2.status + ")");
}

// ── staging is only for the businesses on the allow list
{
  const noList = world({ env: { THUMBTACK_STAGING_CLIENT_ID: CLIENT_ID, THUMBTACK_STAGING_CLIENT_SECRET: SECRET, TOKEN_ENC_KEY: ENV_OK.TOKEN_ENC_KEY } });
  const s1 = await read(await noList.F.handleGetGmThumbtackStatus("c1", get("/x"), noList.env));
  ok(s1.data.available === false, "staging: with no allow list set, only the test client is allowed, so another business sees not available");
  const c1 = await read(await noList.F.handlePostGmThumbtackConnect("c1", post("/x"), noList.env));
  ok(c1.status === 503, "staging: another business cannot start a connection (503)");
  const listed = world({ env: { THUMBTACK_STAGING_CLIENTS: "c2, c1", THUMBTACK_STAGING_CLIENT_ID: CLIENT_ID, THUMBTACK_STAGING_CLIENT_SECRET: SECRET, TOKEN_ENC_KEY: ENV_OK.TOKEN_ENC_KEY } });
  const s2 = await read(await listed.F.handleGetGmThumbtackStatus("c1", get("/x"), listed.env));
  ok(s2.data.available === true, "staging: a business on the list sees the card");
  user = RIVAL;
  const s3 = await read(await listed.F.handleGetGmThumbtackStatus("c2", get("/x"), listed.env));
  ok(s3.data.available === true, "staging: the list can name more than one business");
  user = OWNER;
  const none = world({ env: { THUMBTACK_STAGING_CLIENTS: "", THUMBTACK_STAGING_CLIENT_ID: CLIENT_ID, THUMBTACK_STAGING_CLIENT_SECRET: SECRET, TOKEN_ENC_KEY: ENV_OK.TOKEN_ENC_KEY } });
  const s4 = await read(await none.F.handleGetGmThumbtackStatus("c1", get("/x"), none.env));
  ok(s4.data.available === false, "staging: an empty list allows nobody");
  const prodAll = world({ env: { THUMBTACK_ENV: "production", THUMBTACK_CLIENT_ID: CLIENT_ID, THUMBTACK_CLIENT_SECRET: SECRET, TOKEN_ENC_KEY: ENV_OK.TOKEN_ENC_KEY } });
  const s5 = await read(await prodAll.F.handleGetGmThumbtackStatus("c1", get("/x"), prodAll.env));
  ok(s5.data.available === true, "production: every business is allowed (no list)");
}

// ── who may use the owner routes
{
  const w = world();
  user = SELLER;
  const a = await read(await w.F.handleGetGmThumbtackStatus("c1", get("/x"), w.env));
  const b = await read(await w.F.handlePostGmThumbtackConnect("c1", post("/x"), w.env));
  const c = await read(await w.F.handlePostGmThumbtackDisconnect("c1", post("/x"), w.env));
  const e = await read(await w.F.handleGetGmThumbtackPhones("c1", get("/x"), w.env));
  ok(a.status === 403 && b.status === 403 && c.status === 403 && e.status === 403, "a salesperson is refused on status, connect, disconnect and phones (403)");
  user = RIVAL;
  const f = await read(await w.F.handleGetGmThumbtackStatus("c1", get("/x"), w.env));
  ok(f.status === 403, "the owner of another business is refused (403)");
  user = null;
  const g = await read(await w.F.handleGetGmThumbtackStatus("c1", get("/x"), w.env));
  ok(g.status === 401, "no login is 401");
  user = OWNER;
}

// ── connect and callback
let W = null;
{
  const w = world();
  W = w;
  const c = await connect(w);
  const url = new URL(c.started.data.url);
  ok(url.origin === "https://staging-auth.thumbtack.com" && url.pathname === "/oauth2/auth", "connect: in staging mode the sign-in address is Thumbtack's STAGING authorize address");
  ok(url.searchParams.get("audience") === "urn:partner-api", "connect: the sign-in request carries audience=urn:partner-api");
  ok(url.searchParams.get("client_id") === CLIENT_ID && url.searchParams.get("response_type") === "code", "connect: it carries the app id and response_type=code");
  ok(url.searchParams.get("redirect_uri") === API + "/api/thumbtack/callback", "connect: the redirect address is this Worker's callback");
  const scopes = String(url.searchParams.get("scope")).split(" ");
  ok(scopes.indexOf("offline_access") !== -1 && scopes.indexOf("supply::negotiations.read") !== -1 && scopes.indexOf("supply::webhooks.write") !== -1 &&
    scopes.indexOf("supply::businesses/associate-phone-numbers.write") !== -1, "connect: the scopes include refresh, leads, webhooks and phone numbers");
  ok(/^[a-f0-9]{48}$/.test(c.state), "connect: the state is 48 random hex characters");
  ok(c.back.status === 302 && c.back.location === "https://apex.resonateai.online/portal.html?tab=gmestimates&thumbtack=connected", "callback: the browser goes back to the settings screen as connected");
  ok(!/code=|access_token|refresh/.test(c.back.location), "callback: the return address carries one plain word, no code or token");
  const tokenCall = w.tt.calls.filter((x) => x.path === "/oauth2/token")[0];
  ok(tokenCall.form.grant_type === "authorization_code" && tokenCall.form.code === CODE && tokenCall.form.redirect_uri === API + "/api/thumbtack/callback", "callback: the token call sends the code and the same redirect address");
  const row = w.d.q("SELECT * FROM gm_thumbtack_connections WHERE client_id = 'c1'")[0];
  ok(!!row && row.token_sealed.indexOf("enc:v1:") === 0 && row.refresh_sealed.indexOf("enc:v1:") === 0 && row.thumbtack_user_id === "9001", "callback: both tokens are stored sealed, and the Thumbtack user id is kept");
  ok(JSON.stringify(row).indexOf(ACCESS) === -1 && JSON.stringify(row).indexOf(REFRESH) === -1, "callback: no plain token anywhere in the connection row");
  ok(row.connected_by === "Zeta Owner" && row.connected_login === "zeta", "callback: it records who connected");
  const biz = w.d.q("SELECT * FROM gm_thumbtack_businesses WHERE client_id = 'c1'")[0];
  ok(biz.business_id === "5001" && biz.name === "Zeta Pools LLC" && biz.subscribed === 1 && biz.webhook_id === "wh-5001" && /^[a-f0-9]{48}$/.test(biz.webhook_token), "callback: the business is stored, subscribed, with a 48 hex address token");
  const wh = w.tt.webhooks["5001"];
  ok(wh.webhookURL === API + "/api/thumbtack/webhook/" + biz.webhook_token && wh.eventTypes.length === 1 && wh.eventTypes[0] === "NegotiationCreatedV4" && wh.enabled === true, "callback: the webhook asked for is NegotiationCreatedV4 at this Worker's address");
  ok(wh.auth && wh.auth.header === "X-Apex-Thumbtack" && /^[a-f0-9]{64}$/.test(wh.auth.value), "callback: the webhook carries a custom header with a 64 hex keyed value");
  const subCall = w.tt.calls.filter((x) => /webhooks$/.test(x.path) && x.method === "POST")[0];
  ok(subCall.headers.Authorization === "Bearer " + ACCESS, "callback: the webhook is created with the Pro's own access token");

  const reuse = await read(await w.F.handleGetThumbtackCallback(get("/api/thumbtack/callback?code=" + CODE + "&state=" + c.state), w.env));
  ok(reuse.location.indexOf("thumbtack=failed") !== -1, "callback: the same state used twice fails");
  const wrong = await read(await w.F.handleGetThumbtackCallback(get("/api/thumbtack/callback?code=" + CODE + "&state=" + "0".repeat(48)), w.env));
  ok(wrong.location.indexOf("thumbtack=failed") !== -1, "callback: an unknown state fails");
  const plain = await read(await w.F.handleGetThumbtackCallback(get("/api/thumbtack/callback"), w.env));
  ok(plain.status === 200 && plain.text.indexOf("Partner API") !== -1, "callback: with no code and no state it still answers the plain note (the Request Access form address)");

  const st = await read(await w.F.handleGetGmThumbtackStatus("c1", get("/x"), w.env));
  ok(st.data.connected === true && st.data.businesses.length === 1 && st.data.businesses[0].subscribed === true && st.data.subscribed_count === 1, "status: connected, one business, subscribed");
  ok(st.data.mode === "staging", "status: the Worker is in staging mode unless THUMBTACK_ENV says production");
}

// ── a refused code changes nothing
{
  const w = world();
  const started = await read(await w.F.handlePostGmThumbtackConnect("c1", post("/x"), w.env));
  const state = new URL(started.data.url).searchParams.get("state");
  const back = await read(await w.F.handleGetThumbtackCallback(get("/api/thumbtack/callback?code=BADCODE-123456&state=" + state), w.env));
  ok(back.location.indexOf("thumbtack=failed") !== -1, "a refused code: the browser goes back as failed");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_thumbtack_connections")[0].c === 0 && w.d.q("SELECT COUNT(*) AS c FROM gm_thumbtack_businesses")[0].c === 0, "a refused code: nothing was stored");
  w.tt.businesses = [];
  const s2 = await read(await w.F.handlePostGmThumbtackConnect("c1", post("/x"), w.env));
  const state2 = new URL(s2.data.url).searchParams.get("state");
  const none = await read(await w.F.handleGetThumbtackCallback(get("/api/thumbtack/callback?code=" + CODE + "&state=" + state2), w.env));
  ok(none.location.indexOf("thumbtack=nobusinesses") !== -1 && w.d.q("SELECT COUNT(*) AS c FROM gm_thumbtack_connections")[0].c === 0, "no business granted: nobusinesses, and nothing was stored");
}

// ── the webhook creates one lead per negotiation
{
  const w = world();
  await connect(w);
  const t = hookTarget(w);
  const body = JSON.stringify(negotiation(5343987659230309812n));
  ok(body.indexOf("5343987659230309812") !== -1, "the test sends an id too long for a JavaScript number as a bare number");
  const bad404 = await read(await w.F.handlePostThumbtackWebhook("f".repeat(48), hook(w, body), w.env));
  ok(bad404.status === 404, "webhook: an unknown address token is 404");
  const short = await read(await w.F.handlePostThumbtackWebhook("abc", hook(w, body), w.env));
  ok(short.status === 404, "webhook: a malformed address token is 404");
  const noHeader = await read(await w.F.handlePostThumbtackWebhook(t.token, hook(w, body, { header: null }), w.env));
  ok(noHeader.status === 401, "webhook: a missing header is 401");
  const badHeader = await read(await w.F.handlePostThumbtackWebhook(t.token, hook(w, body, { header: "0".repeat(64) }), w.env));
  ok(badHeader.status === 401, "webhook: a wrong header value is 401");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_thumbtack_events")[0].c === 0 && w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 0, "a refused call stores nothing and creates nothing");
  const badJson = await read(await w.F.handlePostThumbtackWebhook(t.token, hook(w, "{not json"), w.env));
  ok(badJson.status === 400, "webhook: a body that is not JSON is 400");

  const good = await read(await w.F.handlePostThumbtackWebhook(t.token, hook(w, body), w.env));
  ok(good.status === 200, "webhook: a correct call is 200");
  const L = w.d.q("SELECT * FROM gm_leads")[0];
  ok(!!L && L.client_id === "c1" && L.cliente === "Ana Souza" && L.telefone === "(407) 555-0142", "the lead has the name and the phone as (407) 555-0142");
  ok(L.origem === "Thumbtack" && L.estagio === "novo_lead" && L.servico === "Pool Repair", "the lead's source is Thumbtack, its stage is new lead, its service is the category");
  ok(L.address === "12 Lake Rd, Unit 4" && L.city === "Orlando" && L.addr_street === "12 Lake Rd, Unit 4" && L.addr_city === "Orlando" && L.addr_state === "FL" && L.addr_zip === "32801", "the lead has the address in both the plain and the structured columns");
  ok(L.thumbtack_negotiation_id === "5343987659230309812", "the negotiation id was kept whole (not rounded by JavaScript)");
  const details = JSON.parse(L.thumbtack_details_json);
  ok(details.length === 2 && details[0].q === "Description" && details[1].a === "Saltwater", "the description and the answers are kept, and an empty answer is left out");
  ok(L.thumbtack_lead_price === "$45.00" && L.thumbtack_category === "Pool Repair", "the lead price and category are kept");
  ok(L.data_lead === "2026-10-27T14:14" && L.mes_lead === "Outubro", "the lead date is in Eastern time and the month is the cycle month");
  const ev = w.d.q("SELECT * FROM gm_thumbtack_events")[0];
  ok(ev.status === "created" && ev.lead_id === L.id && ev.client_id === "c1" && ev.business_id === "5001", "the event is marked created, with the lead and the business");
  ok(w.d.q("SELECT last_lead_at FROM gm_thumbtack_businesses")[0].last_lead_at !== null, "the business remembers when its last lead arrived");
  ok(w.pushes.length === 1 && w.pushes[0].payload.title === "New Thumbtack lead: Ana Souza", "the owner got one push in English (" + (w.pushes[0] && w.pushes[0].payload.title) + ")");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_lead_events WHERE lead_id = ?", L.id)[0].c === 1, "the lead's history has its creation row");

  const again = await read(await w.F.handlePostThumbtackWebhook(t.token, hook(w, body), w.env));
  ok(again.status === 200 && w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 1, "the same lead sent twice: still one lead");
  ok(w.d.q("SELECT duplicates FROM gm_thumbtack_events")[0].duplicates === 1 && w.pushes.length === 1, "the second copy only counts up, and no second push");
  const other = await read(await w.F.handlePostThumbtackWebhook(t.token, hook(w, { event: { eventType: "ReviewCreatedV4" }, data: { reviewID: "1" } }), w.env));
  ok(other.status === 200 && w.d.q("SELECT COUNT(*) AS c FROM gm_thumbtack_events")[0].c === 1, "another kind of event is answered 200 and stored nowhere");
  const noId = await read(await w.F.handlePostThumbtackWebhook(t.token, hook(w, { event: { eventType: "NegotiationCreatedV4" }, data: {} }), w.env));
  ok(noId.status === 400, "a lead event with no negotiation id is 400");
  const second = await read(await w.F.handlePostThumbtackWebhook(t.token, hook(w, negotiation("777", { data: Object.assign({}, negotiation("777").data, { customer: {}, request: { location: {} } }) })), w.env));
  const L2 = w.d.q("SELECT * FROM gm_leads WHERE thumbtack_negotiation_id = '777'")[0];
  ok(second.status === 200 && L2.cliente === "Thumbtack lead", "a lead with no name, phone or address is still listed (as Thumbtack lead)");
}

// ── Portuguese owner gets a Portuguese push
{
  const w = world({ language: "pt" });
  await connect(w);
  await w.F.handlePostThumbtackWebhook(hookTarget(w).token, hook(w, negotiation(31)), w.env);
  ok(w.pushes.length === 1 && w.pushes[0].payload.title === "Novo lead do Thumbtack: Ana Souza", "a Portuguese business gets the push in Portuguese");
}

// ── a failed event is stored and tried again by the 4-hour job
{
  const w = world();
  await connect(w);
  const t = hookTarget(w);
  await w.F.handlePostThumbtackWebhook(t.token, hook(w, negotiation(41)), w.env);
  w.d.raw.prepare("DELETE FROM gm_leads").run();
  w.d.raw.prepare("UPDATE gm_thumbtack_events SET status = 'failed', raw_event = '{broken', attempts = 1").run();
  await w.F.thumbtackCron(w.env);
  const broken = w.d.q("SELECT status, error FROM gm_thumbtack_events")[0];
  ok(broken.status === "failed" && !!broken.error && w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 0, "an event that cannot be read stays failed, with a reason, and creates nothing");
  w.d.raw.prepare("UPDATE gm_thumbtack_events SET raw_event = ?").run(JSON.stringify(negotiation(41).data));
  await w.F.thumbtackCron(w.env);
  ok(w.d.q("SELECT status FROM gm_thumbtack_events")[0].status === "created" && w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 1, "the 4-hour job tries it again and the lead is created");
  w.d.raw.prepare("UPDATE gm_thumbtack_events SET received_at = datetime('now', '-100 days')").run();
  await w.F.thumbtackCron(w.env);
  ok(w.d.q("SELECT raw_event FROM gm_thumbtack_events")[0].raw_event === null, "the 4-hour job clears raw copies older than 90 days");
}

// ── the access token is refreshed before it runs out
{
  const w = world();
  await connect(w);
  w.d.raw.prepare("UPDATE gm_thumbtack_connections SET token_expires_at = datetime('now', '-5 minutes')").run();
  const ph = await read(await w.F.handleGetGmThumbtackPhones("c1", get("/x"), w.env));
  ok(ph.status === 200, "phones: the list answers 200 after a refresh");
  const refreshCall = w.tt.calls.filter((x) => x.form && x.form.grant_type === "refresh_token")[0];
  ok(!!refreshCall && refreshCall.form.refresh_token === REFRESH, "a token about to run out is refreshed with the stored refresh token");
  const row = w.d.q("SELECT token_expires_at, needs_reconnect FROM gm_thumbtack_connections")[0];
  ok(row.token_expires_at > new Date().toISOString().replace("T", " ").slice(0, 19) && row.needs_reconnect === 0, "the new expiry is saved");
  const used = w.tt.calls.filter((x) => /associate-phone-numbers$/.test(x.path))[0];
  ok(used.headers.Authorization === "Bearer " + NEW_ACCESS, "the call after the refresh uses the new token");
  ok(w.d.q("SELECT token_sealed FROM gm_thumbtack_connections")[0].token_sealed.indexOf(NEW_ACCESS) === -1, "the new token is stored sealed");

  const w2 = world();
  await connect(w2);
  w2.d.raw.prepare("UPDATE gm_thumbtack_connections SET token_expires_at = datetime('now', '-5 minutes')").run();
  w2.tt.refreshError = true;
  const bad = await read(await w2.F.handleGetGmThumbtackPhones("c1", get("/x"), w2.env));
  const bad2 = await read(await w2.F.handleGetGmThumbtackPhones("c1", get("/x"), w2.env));
  ok(bad.status === 500 && bad2.status === 500, "a refresh Thumbtack refuses ends the call with an error");
  const st = await read(await w2.F.handleGetGmThumbtackStatus("c1", get("/x"), w2.env));
  ok(st.data.needs_reconnect === true, "and the card is told to ask for a reconnect");
  ok(w2.pushes.length === 1, "the owner got ONE push about it, however many calls failed (" + w2.pushes.length + ")");

  const w3 = world();
  await connect(w3);
  w3.d.raw.prepare("UPDATE gm_thumbtack_connections SET token_expires_at = datetime('now', '-5 minutes')").run();
  w3.tt.down = true;
  await read(await w3.F.handleGetGmThumbtackPhones("c1", get("/x"), w3.env));
  const st3 = await read(await w3.F.handleGetGmThumbtackStatus("c1", get("/x"), w3.env));
  ok(st3.data.needs_reconnect === false && w3.pushes.length === 0, "Thumbtack unreachable is not a reconnect: no flag, no push");
}

// ── phone numbers
{
  const w = world();
  await connect(w);
  w.tt.phones["5001"] = [{ phoneNumberID: "p0", phoneNumber: "+14075550100", name: "Front desk" }];
  const list = await read(await w.F.handleGetGmThumbtackPhones("c1", get("/x"), w.env));
  ok(list.status === 200 && list.data.businesses[0].numbers[0].phone === "+14075550100" && list.data.businesses[0].numbers[0].name === "Front desk", "phones: the numbers Thumbtack holds are listed per business");
  const noName = await read(await w.F.handlePostGmThumbtackPhones("c1", post("/x", { business_id: "5001", phone: "(407) 555-0142", name: "" }), w.env));
  const badNum = await read(await w.F.handlePostGmThumbtackPhones("c1", post("/x", { business_id: "5001", phone: "12345", name: "Ana" }), w.env));
  const noBiz = await read(await w.F.handlePostGmThumbtackPhones("c1", post("/x", { business_id: "9999", phone: "(407) 555-0142", name: "Ana" }), w.env));
  ok(noName.status === 400 && badNum.status === 400 && noBiz.status === 404, "phones: no name or a bad number is 400, a business that is not connected is 404");
  ok(w.tt.calls.filter((x) => x.method === "POST" && /associate-phone-numbers$/.test(x.path)).length === 0, "phones: nothing was sent to Thumbtack for those");
  const add = await read(await w.F.handlePostGmThumbtackPhones("c1", post("/x", { business_id: "5001", phone: "(407) 555-0142", name: "Ana" }), w.env));
  const sent = w.tt.calls.filter((x) => x.method === "POST" && /associate-phone-numbers$/.test(x.path))[0];
  ok(add.status === 200 && sent.json.phoneNumber === "+14075550142" && sent.json.name === "Ana", "phones: an added number is sent in E.164 with its name");
  const other = world();
  other.tt.businesses = [{ businessID: "6001", name: "Other" }];
  user = RIVAL;
  const cross = await read(await w.F.handlePostGmThumbtackPhones("c1", post("/x", { business_id: "5001", phone: "(407) 555-0142", name: "Ana" }), w.env));
  ok(cross.status === 403, "phones: another business's owner cannot add a number (403)");
  user = OWNER;
}

// ── the staging test lead
{
  const w = world();
  user = OWNER;
  const none = await read(await w.F.handlePostGmThumbtackTestLead("c1", post("/x"), w.env));
  ok(none.status === 409, "test lead: not connected is 409");
  await connect(w);
  const sent = await read(await w.F.handlePostGmThumbtackTestLead("c1", post("/x"), w.env));
  ok(sent.status === 200 && sent.data.sent === true && w.tt.testCalls === 1, "test lead: Thumbtack is asked for its sample lead, once");
  const call = w.tt.calls.filter((x) => /test-negotiation$/.test(x.path))[0];
  ok(call.path === "/api/v4/businesses/5001/webhooks/test-negotiation" && call.headers.Authorization === "Bearer " + ACCESS, "test lead: it uses the Pro's own token on the connected business");
  user = SELLER;
  const s2 = await read(await w.F.handlePostGmThumbtackTestLead("c1", post("/x"), w.env));
  ok(s2.status === 403 && w.tt.testCalls === 1, "test lead: a salesperson is refused (403) and nothing is sent");
  user = RIVAL;
  const s3 = await read(await w.F.handlePostGmThumbtackTestLead("c1", post("/x"), w.env));
  ok(s3.status === 403 && w.tt.testCalls === 1, "test lead: another business's owner is refused (403)");
  user = OWNER;
  const wp = world({ env: { THUMBTACK_ENV: "production", THUMBTACK_CLIENT_ID: CLIENT_ID, THUMBTACK_CLIENT_SECRET: SECRET, TOKEN_ENC_KEY: ENV_OK.TOKEN_ENC_KEY } });
  const prod = await read(await wp.F.handlePostGmThumbtackTestLead("c1", post("/x"), wp.env));
  ok(prod.status === 403, "test lead: in production mode it is refused (403)");
}

// ── disconnect
{
  const w = world();
  await connect(w);
  await w.F.handlePostThumbtackWebhook(hookTarget(w).token, hook(w, negotiation(61)), w.env);
  const before = w.d.q("SELECT id FROM gm_leads")[0].id;
  const t0 = hookTarget(w);
  const off = await read(await w.F.handlePostGmThumbtackDisconnect("c1", post("/x"), w.env));
  ok(off.status === 200 && off.data.connected === false, "disconnect: the card reads not connected");
  ok(w.tt.calls.some((x) => x.method === "DELETE" && /\/webhooks\/wh-5001$/.test(x.path)) && !w.tt.webhooks["5001"], "disconnect: the webhook was deleted at Thumbtack");
  ok(w.tt.calls.some((x) => x.method === "POST" && x.path === "/api/v4/users/disconnect"), "disconnect: Thumbtack was told to revoke the connection");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_thumbtack_connections")[0].c === 0 && w.d.q("SELECT COUNT(*) AS c FROM gm_thumbtack_businesses")[0].c === 0, "disconnect: the tokens and the businesses are deleted");
  ok(w.d.q("SELECT raw_event FROM gm_thumbtack_events")[0].raw_event === null, "disconnect: the raw event copies are cleared at once");
  const L = w.d.q("SELECT * FROM gm_leads WHERE id = ?", before)[0];
  ok(!!L && L.cliente === "Ana Souza" && L.telefone === "(407) 555-0142" && L.thumbtack_details_json === null && L.thumbtack_lead_price === null, "disconnect: the lead stays in the pipeline, with Thumbtack's extra data cleared");
  const late = await read(await w.F.handlePostThumbtackWebhook(t0.token, new Request(API + t0.path, { method: "POST", headers: { "Content-Type": "application/json", [t0.headerName]: t0.headerValue }, body: JSON.stringify(negotiation(62)) }), w.env));
  ok(late.status === 404, "disconnect: a late webhook call to the old address is 404");
  const on = await read(await w.F.handlePostGmThumbtackDisconnect("c1", post("/x"), w.env));
  ok(on.status === 200, "disconnect: disconnecting twice is harmless");
}

// ── the settings card and the lead block (the REAL code, cut out of gm.js)
{
  const gm = readFileSync(new URL("gm.js", root), "utf8");
  const a = gm.indexOf("// ── Thumbtack leads (2026-10-27)");
  const b = gm.indexOf("// Asks the Worker for Facebook's sign-in address");
  const src = gm.slice(a, b);
  const esc = (t) => String(t === null || t === undefined ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let seller = false;
  let loads = 0;
  const mk = new Function("gmT", "escHtml", "gmIsSeller", "gmSheetRowHtml", "gmSheetSection", "formatDateUTC", "formatDateTimeUTC", "gmApi", "gmRenderEstimatesTab", "gmToast", "gmAsk", "gmInApp", "apexOpenExternal", "window", "gmEstimatesSection",
    src + "\nreturn { card: gmThumbtackCardHtml, lead: gmThumbtackLeadHtml, set: function(k, v) { if (k === 'status') { gmTtStatus = v; } if (k === 'notice') { gmTtNotice = v; } if (k === 'awaiting') { gmTtAwaiting = v; } if (k === 'phones') { gmTtPhones = v; } }, load: gmTtLoad, disconnect: gmTtDisconnect, ret: gmTtReturnRead };");
  let asked = null;
  const win = { location: { search: "?tab=gmestimates&thumbtack=nobusinesses", pathname: "/portal.html", hash: "" }, history: { replaceState: function (a1, b1, url) { win.location.search = url.indexOf("?") === -1 ? "" : url.slice(url.indexOf("?")); } } };
  const U = mk((pt, en) => en, esc, () => seller, (i, l, v) => "[" + l + ": " + v + "]", (t, r) => "<" + t + ">" + r, (d) => String(d).slice(0, 10), (d) => String(d), () => { loads++; return new Promise(() => {}); }, () => {}, () => {}, (o) => { asked = o; }, () => false, () => {}, win, "list");
  seller = true;
  ok(U.card() === "", "card: a salesperson sees nothing");
  seller = false;
  ok(U.card().indexOf("Checking Thumbtack") !== -1 && loads === 1, "card: before the status arrives it says Checking and asks for the status");
  U.set("status", { available: false, connected: false, businesses: [] });
  ok(U.card().indexOf("Not available yet.") !== -1 && U.card().indexOf("gmTtConnect") === -1, "card: not available yet shows no Connect button");
  U.set("status", { available: true, connected: false, businesses: [] });
  ok(U.card().indexOf("Connect Thumbtack") !== -1 && U.card().indexOf("gmTtConnect") !== -1 && U.card().indexOf("Coming soon") === -1, "card: available and not connected shows the Connect button");
  U.set("notice", "failed");
  ok(U.card().indexOf("Thumbtack was not connected. Nothing changed.") !== -1 && U.card().indexOf("Try again") !== -1, "card: a failed sign-in says nothing changed and offers Try again");
  U.set("notice", "nobusinesses");
  ok(U.card().indexOf("did not share any business") !== -1, "card: no business granted says so");
  U.set("notice", "");
  U.set("awaiting", true);
  ok(U.card().indexOf("Refresh status") !== -1, "card: after the sign-in opened outside the app it offers Refresh status");
  U.set("status", { available: true, connected: true, needs_reconnect: false, connected_at: "2026-10-27 18:00:00", connected_by: "Zeta Owner", businesses: [{ business_id: "5001", name: "Zeta Pools LLC", subscribed: true, problem: false }], subscribed_count: 1, last_lead_at: null });
  const c1 = U.card();
  ok(c1.indexOf("Zeta Pools LLC") !== -1 && c1.indexOf("receiving leads") !== -1 && c1.indexOf("No leads received yet") !== -1 && c1.indexOf("by Zeta Owner") !== -1, "card: connected shows the business, receiving leads, who connected and that no lead has come yet");
  ok(c1.indexOf("Disconnect") !== -1 && c1.indexOf("Show phone numbers") !== -1 && c1.indexOf("Reconnect") === -1, "card: connected shows Disconnect and Show phone numbers, and no Reconnect");
  U.set("status", { available: true, connected: true, needs_reconnect: true, connected_at: "2026-10-27 18:00:00", businesses: [{ business_id: "5001", name: "Zeta Pools LLC", subscribed: false, problem: true }], last_lead_at: "2026-10-28 09:00:00" });
  const c2 = U.card();
  ok(c2.indexOf("Thumbtack needs to be reconnected") !== -1 && c2.indexOf("Reconnect") !== -1 && c2.indexOf("did not let the leads of this business connect") !== -1 && c2.indexOf("Last lead: 2026-10-28") !== -1, "card: a refused token or webhook shows Reconnect, the reason and the last lead date");
  U.set("status", { available: true, connected: true, needs_reconnect: false, mode: "staging", connected_at: "2026-10-27 18:00:00", businesses: [{ business_id: "5001", name: "Zeta Pools LLC", subscribed: true, problem: false }], subscribed_count: 1, last_lead_at: null });
  ok(U.card().indexOf("Send a test lead") !== -1 && U.card().indexOf("gmTtTestLead") !== -1, "card: in staging the Send a test lead button shows");
  U.set("status", { available: true, connected: true, needs_reconnect: false, mode: "production", connected_at: "2026-10-27 18:00:00", businesses: [{ business_id: "5001", name: "Zeta Pools LLC", subscribed: true, problem: false }], subscribed_count: 1, last_lead_at: null });
  ok(U.card().indexOf("Send a test lead") === -1, "card: in production there is no test lead button");
  U.set("phones", { businesses: [{ business_id: "5001", name: "Zeta Pools LLC", numbers: [{ name: "Front desk", phone: "+14075550100" }] }] });
  const c3 = U.card();
  ok(c3.indexOf("Front desk") !== -1 && c3.indexOf("+14075550100") !== -1 && c3.indexOf('id="gmTtPhoneNum"') !== -1 && c3.indexOf('type="tel"') !== -1 && c3.indexOf('for="gmTtPhoneNum"') !== -1, "card: phone numbers are listed, and the add form has labelled name and tel inputs");
  ok(c3.indexOf("gmTtPhoneBiz") === -1, "card: with one business there is no business picker");
  U.disconnect();
  ok(!!asked && asked.message.indexOf("Thumbtack's extra details are erased") !== -1 && asked.yes === "Yes, disconnect Thumbtack" && asked.keep === "Keep it connected", "disconnect: asks first, says Thumbtack's extra details are erased, and offers Keep it connected");
  win.location.search = "?tab=gmestimates&thumbtack=nobusinesses";
  U.ret();
  ok(win.location.search === "?tab=gmestimates", "return: the thumbtack word is taken out of the address after it is read");
  ok(!/confirm\(|alert\(|prompt\(/.test(src), "the card uses no browser pop-ups");
  ok(U.lead({}) === "" && U.lead({ meta_leadgen_id: "1" }) === "", "lead block: a lead that did not come from Thumbtack shows nothing");
  const lb = U.lead({ thumbtack_negotiation_id: "5001", thumbtack_category: "Pool Repair", thumbtack_lead_price: "$45.00", thumbtack_details_json: JSON.stringify([{ q: "Description", a: "Need a pump" }, { q: "What type of pool?", a: "Saltwater" }]) });
  ok(lb.indexOf("From Thumbtack") !== -1 && lb.indexOf("Pool Repair") !== -1 && lb.indexOf("$45.00") !== -1 && lb.indexOf("Need a pump") !== -1 && lb.indexOf("Saltwater") !== -1, "lead block: a Thumbtack lead shows its service, price, description and answers");
  ok(U.lead({ thumbtack_negotiation_id: "5001", thumbtack_details_json: "{broken" }).indexOf("From Thumbtack") !== -1, "lead block: broken stored answers do not break the sheet");
}

// ── nothing secret ever left, and no secret was ever logged
{
  const all = seen.join("\n");
  const log = logged.join("\n");
  HIDDEN.forEach((h) => {
    ok(all.indexOf(h) === -1, "no answer or redirect ever contained " + h.slice(0, 8) + "...");
    ok(log.indexOf(h) === -1, "nothing logged ever contained " + h.slice(0, 8) + "...");
  });
}

console.log(fail === 0 ? "\nALL PASSED" : "\n" + fail + " FAILED");
process.exit(fail === 0 ? 0 : 1);
