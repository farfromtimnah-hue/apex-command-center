// Job 38: Facebook and Instagram lead ads.
// The REAL Worker functions (cut out of worker/index.js) on an in-memory
// SQLite built from the real migration file, with a FAKE fetch standing in
// for Meta, plus the page's own card and lead block cut out of gm.js.
// No network, no production database.
//
//   node scripts/test-meta-lead-ads.mjs
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { makeDb, build, fnSrc, workerSrc } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const root = new URL("../", import.meta.url);
const gmSrc = readFileSync(new URL("gm.js", root), "utf8");
const dtSrc = readFileSync(new URL("datetime.js", root), "utf8");
const migration = readFileSync(new URL("migrations/meta_lead_ads.sql", root), "utf8");

const FNS = ["jsonOk", "jsonErr", "jsonErr2", "gmActorReplacer", "requireClientAccess", "sessionSellerName", "actorName",
  "tokenEncKey", "tokenIsSealed", "tokenSeal", "tokenOpen", "bytesToB64", "b64ToBytes", "gmStr", "gmEstNewToken",
  "gmLogLeadEvents", "gmInsertLead", "gmClientPushTargets", "clientRequestAllowed", "sellerRequestAllowed",
  "metaSettings", "metaTablesReady", "metaNotAvailable", "metaPlain", "metaOwnerGuard", "metaHex", "metaHmac", "metaSafeEqual",
  "metaB64urlToBytes", "metaScrub", "metaFetch", "metaGraph", "metaErrTransient", "metaRedirectUri", "metaDialogUrl", "metaBack",
  "metaStateUse", "metaStatusPayload", "metaSubscribePage", "metaRemoveConnection", "metaGrantedPages",
  "handleGetGmMetaStatus", "handlePostGmMetaConnect", "handlePostGmMetaPages", "handlePostGmMetaDisconnect", "metaAfter",
  "handleGetMetaCallback", "handleGetMetaWebhook", "metaLeadgenChanges", "metaStoreEvents", "handlePostMetaWebhook",
  "metaProcessMany", "metaRetryStored", "metaFmtPhone", "metaNyStamp", "metaLeadFields", "metaFlagReconnect", "metaProcessEvent",
  "metaCron", "metaParseSignedRequest", "handlePostMetaDataDeletion", "metaFmtDateEastern", "handleGetMetaDeletionStatus"];
const VARS = ["DEFAULT_ORIGIN", "CORS_HEADERS", "GM_ACTOR_KEY_RE", "GM_HIDDEN_ACTORS", "TOKEN_SEAL_PREFIX", "APEX_TIMEZONE",
  "GM_MONTH_NAMES_PT", "GM_LEAD_COST_FIELDS", "GM_ORIGENS", "META", "META_LEAD_ORIGEM", "META_ACTOR", "META_NA_PT", "META_NA_EN", "META_TRANSIENT_CODES"];

const SECRET = "app-secret-5f1c9e7a";
const VERIFY = "verify-token-88aa";
const BIZ_TOKEN = "EAABIZTOKENxyz0001";
const PAGE_TOKENS = { "111": "EAAPAGETOKEN111aaa", "222": "EAAPAGETOKEN222bbb", "333": "EAAPAGETOKEN333ccc" };
const CODE = "AQCODEabcdef123456";
const HIDDEN = [SECRET, VERIFY, BIZ_TOKEN, CODE].concat(Object.values(PAGE_TOKENS));
const ENV_OK = { META_APP_ID: "2636167286809966", META_APP_SECRET: SECRET, META_LOGIN_CONFIG_ID: "cfg-123", META_WEBHOOK_VERIFY_TOKEN: VERIFY,
  TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64") };

const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "Zeta Owner", username: "zeta" };
const SELLER = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Maria Silva", display_name: "Maria Silva", username: "maria" };
const RIVAL = { role: "client", client_id: "c2", login_role: "client", display_name: "Omega Owner", username: "omega" };
let user = OWNER;

// Everything any handler ever answered, and everything it logged.
const seen = [];
const logged = [];
const realErr = console.error;
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
  d.raw.exec("CREATE TABLE gm_leads (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, mes_lead TEXT, data_lead TEXT, cliente TEXT NOT NULL, telefone TEXT, email TEXT, origem TEXT, parceiro_id TEXT, servico TEXT, observacao TEXT, vendedor TEXT, data_contato TEXT, data_estimate TEXT, valor REAL, estagio TEXT NOT NULL DEFAULT 'novo_lead', followups INTEGER, proxima_acao TEXT, mes_fechamento TEXT, address TEXT, city TEXT, created_by TEXT, updated_by TEXT, material REAL, mao_de_obra REAL, outros REAL, custo_administrativo REAL, comissao REAL, imposto REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  d.raw.exec("CREATE TABLE gm_lead_events (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, client_id TEXT NOT NULL, action TEXT NOT NULL, field TEXT, old_value TEXT, new_value TEXT, actor TEXT, reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  d.raw.exec("CREATE TABLE users (email TEXT, client_id TEXT, role TEXT)");
  d.raw.exec("CREATE TABLE client_logins (username TEXT, client_id TEXT, seller_name TEXT)");
  if (opts.migrated !== false) {
    migration.replace(/^\s*--[^\n]*$/gm, "").split(";").forEach((stmt) => { if (stmt.trim()) { d.raw.exec(stmt); } });
  }
  d.raw.prepare("INSERT INTO clients (id, name, language) VALUES ('c1', 'Zeta Pools', ?), ('c2', 'Omega Roofing', 'pt')").run(opts.language || "en");
  d.raw.prepare("INSERT INTO client_logins (username, client_id, seller_name) VALUES ('zeta', 'c1', NULL), ('maria', 'c1', 'Maria Silva'), ('omega', 'c2', NULL)").run();

  // The fake Meta. meta.pages: what /me/accounts grants. meta.leads: leadgen
  // id -> the lead, or { error } to refuse it. meta.calls: every call made.
  const meta = { pages: [{ id: "111", name: "Zeta Pools Page", access_token: PAGE_TOKENS["111"], tasks: ["ADVERTISE"] }], leads: {}, calls: [], exchangeError: null, subscribeError: {}, down: false };
  const pushes = [];
  async function fakeFetch(url, init) {
    const u = new URL(url);
    const method = (init && init.method) || "GET";
    const params = method === "POST" ? new URLSearchParams((init && init.body) || "") : u.searchParams;
    meta.calls.push({ method: method, path: u.pathname, host: u.origin, params: Object.fromEntries(params.entries()) });
    if (meta.down) { throw new Error("connect ECONNREFUSED " + url); }
    const J = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
    const path = u.pathname.replace(/^\/v[0-9.]+/, "");
    if (path === "/oauth/access_token") {
      if (meta.exchangeError || params.get("code") !== CODE) { return J({ error: { message: "This authorization code has been used. code=" + params.get("code"), type: "OAuthException", code: 100 } }, 400); }
      return J({ access_token: BIZ_TOKEN, token_type: "bearer" });
    }
    if (path === "/me") {
      if (params.get("access_token") !== BIZ_TOKEN) { return J({ error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } }, 401); }
      return J(params.get("fields") === "id" ? { id: "777001" } : { client_business_id: "888001", id: "777001" });
    }
    if (path === "/me/accounts") { return J({ data: meta.pages }); }
    const sub = /^\/(\d+)\/subscribed_apps$/.exec(path);
    if (sub) {
      if (params.get("access_token") !== PAGE_TOKENS[sub[1]]) { return J({ error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } }, 401); }
      if (method === "POST" && meta.subscribeError[sub[1]]) { return J({ error: { message: "(#200) Requires ADVERTISE task on the Page", type: "OAuthException", code: 200 } }, 403); }
      return J({ success: true });
    }
    const one = /^\/(\d+)$/.exec(path);
    if (one) {
      const lead = meta.leads[one[1]];
      if (!lead) { return J({ error: { message: "Unsupported get request.", type: "GraphMethodException", code: 100 } }, 400); }
      if (lead.error) { return J({ error: lead.error }, lead.status || 400); }
      return J(lead);
    }
    return J({ error: { message: "unknown path in the fake", code: 1 } }, 500);
  }
  const stubs = {
    authenticate: async () => user,
    fetch: fakeFetch,
    REQUEST_CTX: new WeakMap(),
    gmGetConfig: async () => ({ cycle_months: ["Outubro", "Novembro"] }),
    pushToUsers: async (env, targets, payload) => { pushes.push({ targets: targets, payload: payload }); }
  };
  const F = build(FNS, VARS, stubs, opts.src);
  const env = Object.assign({ DB: d.DB }, opts.env || ENV_OK);
  return { d, env, F, meta, pushes };
}

const API = "https://apex-api.farfromtimnah.workers.dev";
function sign(body, secret) { return "sha256=" + createHmac("sha256", secret).update(body).digest("hex"); }
function hook(body, opts) {
  opts = opts || {};
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const headers = { "Content-Type": "application/json" };
  if (opts.header !== null) { headers["X-Hub-Signature-256"] = opts.header || sign(opts.signedText || text, opts.secret || SECRET); }
  return new Request(API + "/api/meta/webhook", { method: "POST", headers: headers, body: text });
}
function event(leadgenId, pageId) {
  return { object: "page", entry: [{ id: pageId, time: 1438292065, changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, page_id: pageId, form_id: 12312312312, adgroup_id: 55, ad_id: 66, created_time: 1440120384 } }] }] };
}
function leadAnswer(id, extra) {
  return Object.assign({
    id: String(id), created_time: "2026-10-05T18:14:00+0000", ad_id: "66", ad_name: "Pool ad A", adset_name: "Set 1", campaign_id: "99",
    campaign_name: "Fall pools 2026", form_id: "12312312312", platform: "fb", is_organic: false,
    field_data: [
      { name: "full_name", values: ["Ana Souza"] }, { name: "phone_number", values: ["+14075550142"] }, { name: "email", values: ["ana@example.com"] },
      { name: "street_address", values: ["12 Lake Rd"] }, { name: "city", values: ["Orlando"] }, { name: "state", values: ["FL"] }, { name: "zip_code", values: ["32801"] },
      { name: "what_kind_of_pool_do_you_want?", values: ["Saltwater"] }
    ]
  }, extra || {});
}
const get = (path) => new Request(API + path, { method: "GET" });
const post = (path, body, type) => new Request(API + path, { method: "POST", headers: { "Content-Type": type || "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body || {}) });

// Connects c1 through the real connect + callback routes.
async function connect(w, clientId) {
  const started = await read(await w.F.handlePostGmMetaConnect(clientId || "c1", post("/x"), w.env));
  const state = new URL(started.data.url).searchParams.get("state");
  const back = await read(await w.F.handleGetMetaCallback(get("/api/meta/callback?code=" + CODE + "&state=" + state), w.env));
  return { started: started, state: state, back: back };
}

// ── the migration is add-only
{
  const sql = migration.replace(/^\s*--[^\n]*$/gm, "");
  ok(!/\b(DROP|DELETE|UPDATE|RENAME|REPLACE)\b/i.test(sql), "the migration only adds (no DROP, DELETE, UPDATE, RENAME)");
  ok(/leadgen_id\s+TEXT NOT NULL UNIQUE/.test(sql), "gm_meta_events.leadgen_id is NOT NULL UNIQUE");
}

// ── webhook verification handshake
{
  const w = world();
  const good = await read(await w.F.handleGetMetaWebhook(get("/api/meta/webhook?hub.mode=subscribe&hub.verify_token=" + VERIFY + "&hub.challenge=1158201444"), w.env));
  ok(good.status === 200 && good.text === "1158201444", "handshake: the right verify token gets the challenge back as plain text");
  const bad = await read(await w.F.handleGetMetaWebhook(get("/api/meta/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1158201444"), w.env));
  ok(bad.status === 403 && bad.text.indexOf("1158201444") === -1, "handshake: a wrong verify token is 403 and the challenge is not echoed");
  const none = await read(await w.F.handleGetMetaWebhook(get("/api/meta/webhook?hub.mode=subscribe&hub.challenge=1"), w.env));
  const mode = await read(await w.F.handleGetMetaWebhook(get("/api/meta/webhook?hub.mode=other&hub.verify_token=" + VERIFY + "&hub.challenge=1"), w.env));
  ok(none.status === 403 && mode.status === 403, "handshake: no token, or another hub.mode, is 403");
}

// ── signature
{
  const w = world();
  await connect(w);
  w.meta.leads["5001"] = leadAnswer(5001);
  const body = JSON.stringify(event(5001, 111));
  const wrongSecret = await read(await w.F.handlePostMetaWebhook(hook(body, { secret: "another-secret" }), w.env));
  ok(wrongSecret.status === 401, "signature: signed with the wrong secret is 401");
  const altered = await read(await w.F.handlePostMetaWebhook(hook(body.replace("5001", "5002"), { signedText: body }), w.env));
  ok(altered.status === 401, "signature: a body altered after signing is 401");
  const missing = await read(await w.F.handlePostMetaWebhook(hook(body, { header: null }), w.env));
  ok(missing.status === 401, "signature: a missing header is 401");
  const bare = await read(await w.F.handlePostMetaWebhook(hook(body, { header: sign(body, SECRET).replace("sha256=", "") }), w.env));
  ok(bare.status === 401, "signature: the hex without \"sha256=\" is 401");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_meta_events")[0].c === 0 && w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 0, "a refused event stores nothing and creates nothing");
  const good = await read(await w.F.handlePostMetaWebhook(hook(body), w.env));
  ok(good.status === 200, "signature: a correctly signed event is 200");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 1, "and it created the lead");
}

// ── one event creates one lead
{
  const w = world();
  const c = await connect(w);
  ok(c.back.status === 302 && c.back.location === "https://apex.resonateai.online/portal.html?tab=gmestimates&meta=connected", "one Page granted: the browser goes back to the settings screen as connected");
  ok(w.d.q("SELECT subscribed FROM gm_meta_pages WHERE client_id = 'c1' AND page_id = '111'")[0].subscribed === 1, "one Page granted: it is subscribed at once");
  const subCall = w.meta.calls.filter((x) => x.path.indexOf("/111/subscribed_apps") !== -1 && x.method === "POST")[0];
  ok(!!subCall && subCall.params.subscribed_fields === "leadgen" && subCall.params.access_token === PAGE_TOKENS["111"], "the subscribe call sends subscribed_fields=leadgen with the Page's own token");

  w.meta.leads["5001"] = leadAnswer(5001);
  const r = await read(await w.F.handlePostMetaWebhook(hook(event(5001, 111)), w.env));
  const leads = w.d.q("SELECT * FROM gm_leads");
  ok(r.status === 200 && leads.length === 1, "one event creates one lead");
  const L = leads[0];
  ok(L.client_id === "c1" && L.cliente === "Ana Souza" && L.telefone === "(407) 555-0142" && L.email === "ana@example.com", "the lead has the name, the phone as (407) 555-0142 and the email");
  ok(L.origem === "Tráfego pago" && w.F.metaLeadFields && L.estagio === "novo_lead", "origem is \"Tráfego pago\" and the stage is the first one");
  ok(L.address === "12 Lake Rd" && L.city === "Orlando", "street and city go to the lead's own address fields");
  ok(L.meta_campaign_name === "Fall pools 2026" && L.meta_ad_name === "Pool ad A" && L.meta_form_id === "12312312312" && L.meta_platform === "fb" && L.meta_leadgen_id === "5001", "the lead keeps the campaign, the ad, the form id and the platform");
  const answers = JSON.parse(L.meta_answers_json);
  ok(answers.some((a) => a.q === "what_kind_of_pool_do_you_want?" && a.a === "Saltwater"), "the custom answer is kept with its question");
  ok(answers.some((a) => a.q === "state" && a.a === "FL") && answers.some((a) => a.q === "zip_code" && a.a === "32801"), "state and zip, which have no column on a lead, are kept with the answers (nothing is dropped)");
  ok(L.observacao === null, "nothing is written into the lead's notes");
  ok(L.data_lead === "2026-10-05T14:14" && L.mes_lead === "Outubro", "the lead's date is Meta's created_time on the Eastern clock (2:14 PM), with its month");
  ok(L.created_by === "Facebook lead ad", "the lead is recorded as created by \"Facebook lead ad\", not by a person");
  const ev = w.d.q("SELECT * FROM gm_meta_events")[0];
  ok(ev.status === "created" && ev.lead_id === L.id && ev.client_id === "c1" && JSON.parse(ev.raw_event).change.value.leadgen_id === 5001 && JSON.parse(ev.raw_lead).campaign_name === "Fall pools 2026", "the event row keeps the raw event and the raw lead answer, and points at the lead");
  ok(w.d.q("SELECT action, new_value, actor FROM gm_lead_events WHERE lead_id = ?", L.id)[0].new_value === "novo_lead", "the lead's own history has its \"created\" row, as for any other lead");
  ok(w.pushes.length === 1 && w.pushes[0].payload.title === "New Facebook lead: Ana Souza" && w.pushes[0].targets.indexOf("login:zeta") !== -1 && w.pushes[0].targets.indexOf("login:maria") === -1, "the owner gets one push \"New Facebook lead: Ana Souza\" (a salesperson with no lead does not)");
  ok(w.pushes[0].payload.url === "/portal.html?tab=gmcrm&lead=" + L.id, "the push opens the pipeline on that lead");
  const readCall = w.meta.calls.filter((x) => x.path === "/v25.0/5001")[0];
  ok(!!readCall && readCall.host === "https://graph.facebook.com" && readCall.params.access_token === PAGE_TOKENS["111"] && readCall.params.fields === "id,created_time,field_data,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform,is_organic", "the lead is read from graph.facebook.com/v25.0 with the Page token and the documented fields");
  const st = await read(await w.F.handleGetGmMetaStatus("c1", get("/x"), w.env));
  ok(st.data.connected === true && st.data.pages.length === 1 && st.data.pages[0].name === "Zeta Pools Page" && !!st.data.last_lead_at && st.data.connected_by === "Zeta Owner", "the status shows the Page by name, who connected and the last lead time");

  // the same event again
  const again = await read(await w.F.handlePostMetaWebhook(hook(event(5001, 111)), w.env));
  ok(again.status === 200 && w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 1 && w.pushes.length === 1, "the same event a second time: still one lead, no second push");
  ok(w.d.q("SELECT duplicates FROM gm_meta_events WHERE leadgen_id = '5001'")[0].duplicates === 1, "and the repeat is counted on the event row");
}

// ── two copies at the same moment, a Portuguese business, an Instagram lead, ids as strings
{
  const w = world({ language: "pt" });
  await connect(w);
  w.meta.leads["6001"] = leadAnswer(6001, { platform: "ig", field_data: [{ name: "first_name", values: ["Bia"] }, { name: "last_name", values: ["Lima"] }, { name: "phone_number", values: ["+5511987654321"] }] });
  const both = await Promise.all([w.F.handlePostMetaWebhook(hook(event("6001", "111")), w.env), w.F.handlePostMetaWebhook(hook(event(6001, 111)), w.env)]);
  const leads = w.d.q("SELECT * FROM gm_leads");
  ok(both[0].status === 200 && both[1].status === 200 && leads.length === 1, "two copies of the event at the same moment: both answered 200, one lead");
  ok(leads[0].cliente === "Bia Lima" && leads[0].meta_platform === "ig", "first_name plus last_name make the name; the Instagram platform is kept");
  ok(leads[0].telefone === "+5511987654321", "a phone that is not a US number is kept as it was sent");
  ok(w.pushes.length === 1 && w.pushes[0].payload.title === "Novo lead do Facebook: Bia Lima", "a Portuguese business gets \"Novo lead do Facebook: Bia Lima\", once");
}

// ── many events in one call, and an id too long for a JavaScript number
{
  const w = world();
  await connect(w);
  const big = "12345678901234567891";
  w.meta.leads[big] = leadAnswer(big);
  w.meta.leads["7002"] = leadAnswer(7002, { field_data: [{ name: "email", values: ["only@example.com"] }] });
  const body = '{"object":"page","entry":[{"id":111,"time":1,"changes":[{"field":"leadgen","value":{"leadgen_id":' + big + ',"page_id":111}},{"field":"leadgen","value":{"leadgen_id":7002,"page_id":111}},{"field":"feed","value":{"x":1}}]}]}';
  const r = await read(await w.F.handlePostMetaWebhook(hook(body), w.env));
  const rows = w.d.q("SELECT leadgen_id, status FROM gm_meta_events ORDER BY leadgen_id");
  ok(r.status === 200 && rows.length === 2 && rows.some((x) => x.leadgen_id === big && x.status === "created"), "a 20-digit leadgen_id sent as a number is kept exactly (never rounded)");
  ok(w.d.q("SELECT cliente FROM gm_leads WHERE meta_leadgen_id = '7002'")[0].cliente === "only@example.com", "a form with no name question: the lead is listed under its email");
  const other = await read(await w.F.handlePostMetaWebhook(hook({ object: "user", entry: [] }), w.env));
  ok(other.status === 200 && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_events")[0].c === 2, "a signed event that is not a Page lead is answered 200 and ignored");
}

// ── an unknown Page
{
  const w = world();
  await connect(w);
  w.meta.leads["8001"] = leadAnswer(8001);
  const before = w.meta.calls.length;
  const r = await read(await w.F.handlePostMetaWebhook(hook(event(8001, 999)), w.env));
  ok(r.status === 200 && w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 0 && w.pushes.length === 0, "an event for a Page nobody connected: 200, no lead, no push");
  ok(w.d.q("SELECT status, client_id FROM gm_meta_events WHERE leadgen_id = '8001'")[0].status === "unmatched" && w.meta.calls.length === before, "it is recorded as unmatched and Meta is not called");
}

// ── a failed lead read
{
  const w = world();
  await connect(w);
  w.meta.leads["9001"] = { error: { message: "Error validating access token: Session has expired. access_token=" + PAGE_TOKENS["111"], type: "OAuthException", code: 190 }, status: 401 };
  w.meta.leads["9002"] = { error: { message: "Error validating access token: Session has expired.", type: "OAuthException", code: 190 }, status: 401 };
  const r1 = await read(await w.F.handlePostMetaWebhook(hook(event(9001, 111)), w.env));
  const r2 = await read(await w.F.handlePostMetaWebhook(hook(event(9002, 111)), w.env));
  const evs = w.d.q("SELECT * FROM gm_meta_events ORDER BY leadgen_id");
  ok(r1.status === 200 && r2.status === 200 && evs.length === 2 && evs.every((e) => e.status === "needs_reconnect" && /Session has expired/.test(e.error) && !!e.raw_event), "a refused token: each event is stored with the error and is not lost");
  ok(evs[0].error.indexOf(PAGE_TOKENS["111"]) === -1, "a token inside Meta's error text is not stored");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 0, "no lead is invented from an event that could not be read");
  const st = await read(await w.F.handleGetGmMetaStatus("c1", get("/x"), w.env));
  ok(st.data.needs_reconnect === true, "the status says Facebook needs to be reconnected");
  ok(w.pushes.length === 1 && w.pushes[0].payload.title === "Facebook needs to be reconnected", "the owner gets ONE push about it for two failed leads");

  // a successful reconnect retries the stored events
  w.meta.leads["9001"] = leadAnswer(9001);
  w.meta.leads["9002"] = leadAnswer(9002, { field_data: [{ name: "full_name", values: ["Caio Reis"] }] });
  const c = await connect(w);
  ok(c.back.location.indexOf("meta=connected") !== -1, "reconnect: back to the card as connected");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 2 && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_events WHERE status = 'created'")[0].c === 2, "reconnect: the two stored events are retried and both leads are created");
  const after = await read(await w.F.handleGetGmMetaStatus("c1", get("/x"), w.env));
  ok(after.data.needs_reconnect === false, "reconnect: the reconnect notice is gone");
}

// ── Meta is down: stored, no reconnect asked, picked up by the 4-hour job
{
  const w = world();
  await connect(w);
  w.meta.leads["9101"] = leadAnswer(9101);
  w.meta.down = true;
  const r = await read(await w.F.handlePostMetaWebhook(hook(event(9101, 111)), w.env));
  const ev = w.d.q("SELECT status, error FROM gm_meta_events")[0];
  ok(r.status === 200 && ev.status === "failed" && ev.error === "Meta could not be reached", "Meta unreachable: the event is stored as failed");
  ok(w.d.q("SELECT needs_reconnect FROM gm_meta_connections")[0].needs_reconnect === 0 && w.pushes.length === 0, "Meta unreachable is not a reason to ask the owner to reconnect");
  w.meta.down = false;
  await w.F.metaCron(w.env);
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 1 && w.d.q("SELECT status FROM gm_meta_events")[0].status === "created", "the 4-hour job reads it again and creates the lead");
  w.d.raw.exec("UPDATE gm_meta_events SET received_at = datetime('now', '-91 days')");
  await w.F.metaCron(w.env);
  const old = w.d.q("SELECT raw_event, raw_lead, leadgen_id, lead_id FROM gm_meta_events")[0];
  ok(old.raw_event === null && old.raw_lead === null && old.leadgen_id === "9101" && !!old.lead_id, "after 90 days the raw copies are cleared; the row (and its unique key) stays");
}

// ── the sign-in: address, state, failures
{
  const w = world();
  const started = await read(await w.F.handlePostGmMetaConnect("c1", post("/x"), w.env));
  const u = new URL(started.data.url);
  ok(started.status === 200 && u.origin + u.pathname === "https://www.facebook.com/v25.0/dialog/oauth", "connect answers Meta's dialog address at v25.0");
  ok(u.searchParams.get("client_id") === "2636167286809966" && u.searchParams.get("config_id") === "cfg-123" && u.searchParams.get("response_type") === "code" &&
    u.searchParams.get("override_default_response_type") === "true" && u.searchParams.get("redirect_uri") === API + "/api/meta/callback", "with client_id, config_id, response_type=code, override_default_response_type=true and the return address");
  const state = u.searchParams.get("state");
  const row = w.d.q("SELECT * FROM gm_meta_oauth_states WHERE state = ?", state)[0];
  ok(/^[a-f0-9]{48}$/.test(state) && row.client_id === "c1" && row.login_key === "zeta" && row.used_at === null, "the state is random, stored server-side and tied to this business and this login");
  ok(Math.abs((Date.parse(row.expires_at.replace(" ", "T") + "Z") - Date.parse(row.created_at.replace(" ", "T") + "Z")) / 60000 - 15) < 0.1, "the state expires in 15 minutes");

  // cancelled on Facebook
  const cancelled = await read(await w.F.handleGetMetaCallback(get("/api/meta/callback?error=access_denied&error_reason=user_denied&state=" + state), w.env));
  ok(cancelled.status === 302 && cancelled.location.indexOf("meta=failed") !== -1 && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_connections")[0].c === 0, "a cancelled sign-in comes back as failed and nothing changed");
  const reuse = await read(await w.F.handleGetMetaCallback(get("/api/meta/callback?code=" + CODE + "&state=" + state), w.env));
  ok(reuse.location.indexOf("meta=failed") !== -1 && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_connections")[0].c === 0 && !w.meta.calls.some((x) => x.path.indexOf("/oauth/access_token") !== -1), "the state is single-use: a second return with it is refused before Meta is called");

  // used once successfully, then replayed
  const c = await connect(w);
  ok(c.back.location.indexOf("meta=connected") !== -1, "a fresh state connects");
  const ex = w.meta.calls.filter((x) => x.path === "/v25.0/oauth/access_token")[0];
  ok(ex.method === "GET" && ex.params.client_id === "2636167286809966" && ex.params.client_secret === SECRET && ex.params.code === CODE && ex.params.redirect_uri === API + "/api/meta/callback", "the code exchange is a GET with client_id, client_secret, code and redirect_uri");
  const callsBefore = w.meta.calls.length;
  const replay = await read(await w.F.handleGetMetaCallback(get("/api/meta/callback?code=" + CODE + "&state=" + c.state), w.env));
  ok(replay.location.indexOf("meta=failed") !== -1 && w.meta.calls.length === callsBefore, "replaying a used state is refused");

  // expired
  const s2 = await read(await w.F.handlePostGmMetaConnect("c1", post("/x"), w.env));
  const state2 = new URL(s2.data.url).searchParams.get("state");
  w.d.raw.prepare("UPDATE gm_meta_oauth_states SET expires_at = datetime('now', '-1 minute') WHERE state = ?").run(state2);
  const late = await read(await w.F.handleGetMetaCallback(get("/api/meta/callback?code=" + CODE + "&state=" + state2), w.env));
  ok(late.location.indexOf("meta=failed") !== -1 && w.meta.calls.length === callsBefore, "an expired state is refused");
  const unknown = await read(await w.F.handleGetMetaCallback(get("/api/meta/callback?code=" + CODE + "&state=" + "ab".repeat(24)), w.env));
  const noState = await read(await w.F.handleGetMetaCallback(get("/api/meta/callback?code=" + CODE), w.env));
  ok(unknown.location.indexOf("meta=failed") !== -1 && noState.location.indexOf("meta=failed") !== -1, "an unknown state, or none, is refused");

  // the stored tokens are sealed
  const conn = w.d.q("SELECT * FROM gm_meta_connections")[0];
  const page = w.d.q("SELECT * FROM gm_meta_pages")[0];
  ok(conn.token_sealed.indexOf("enc:v1:") === 0 && page.token_sealed.indexOf("enc:v1:") === 0 && conn.meta_user_id === "777001" && conn.meta_business_id === "888001" && conn.connected_by === "Zeta Owner", "the business token and the Page token are stored sealed, with the Meta business id, the Meta user id and who connected");
  ok(await w.F.tokenOpen(w.env, page.token_sealed) === PAGE_TOKENS["111"], "and the sealed Page token opens back to the real one inside the Worker");
}

// ── the exchange fails: nothing changes
{
  const w = world();
  w.meta.exchangeError = true;
  const c = await connect(w);
  ok(c.back.location.indexOf("meta=failed") !== -1 && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_connections")[0].c === 0 && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_pages")[0].c === 0, "Meta refuses the code: back as failed, nothing stored");
  const flipped = workerSrc.replace("send_redirect_uri_on_exchange: true", "send_redirect_uri_on_exchange: false");
  const sw = world({ src: flipped });
  ok(flipped !== workerSrc, "the switch is one line in META");
  await connect(sw);
  ok(sw.meta.calls.filter((x) => x.path === "/v25.0/oauth/access_token")[0].params.redirect_uri === undefined, "the one switch (META.send_redirect_uri_on_exchange = false) drops redirect_uri from the exchange");
}

// ── several Pages, none, and disconnect
{
  const w = world();
  w.meta.pages = [{ id: "111", name: "Zeta Pools Page", access_token: PAGE_TOKENS["111"] }, { id: "222", name: "Zeta Spas", access_token: PAGE_TOKENS["222"] }, { id: 333, name: "Zeta Old", access_token: PAGE_TOKENS["333"] }];
  const c = await connect(w);
  ok(c.back.location.indexOf("meta=pages") !== -1 && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_pages WHERE subscribed = 1")[0].c === 0, "several Pages granted: none is subscribed until the owner chooses");
  const st = await read(await w.F.handleGetGmMetaStatus("c1", get("/x"), w.env));
  ok(st.data.connected && st.data.pages.length === 3 && st.data.subscribed_count === 0, "the status lists the three Pages to choose from");
  w.meta.subscribeError["222"] = true;
  const saved = await read(await w.F.handlePostGmMetaPages("c1", post("/x", { page_ids: ["111", "222"] }), w.env));
  const by = {};
  saved.data.pages.forEach((p) => { by[p.page_id] = p; });
  ok(saved.status === 200 && by["111"].subscribed === true && by["333"].subscribed === false, "Save Pages: the ticked Page is subscribed, the unticked one is not");
  ok(by["222"].subscribed === false && by["222"].problem === true && JSON.stringify(saved.data).indexOf("ADVERTISE") === -1, "a Page Meta refuses is shown with a problem flag, without Meta's own error text");
  w.meta.subscribeError = {};
  const before = w.meta.calls.length;
  const changed = await read(await w.F.handlePostGmMetaPages("c1", post("/x", { page_ids: ["222"] }), w.env));
  const by2 = {};
  changed.data.pages.forEach((p) => { by2[p.page_id] = p; });
  const delCalls = w.meta.calls.slice(before).filter((x) => x.method === "DELETE");
  ok(by2["111"].subscribed === false && by2["222"].subscribed === true && delCalls.length === 1 && delCalls[0].path === "/v25.0/111/subscribed_apps", "unticking a Page unsubscribes it at Meta (DELETE on the same edge)");
  w.meta.leads["4001"] = leadAnswer(4001);
  await w.F.handlePostMetaWebhook(hook(event(4001, 111)), w.env);
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 0 && w.d.q("SELECT status FROM gm_meta_events WHERE leadgen_id = '4001'")[0].status === "unmatched", "a lead from an unticked Page creates nothing");

  // another business must not reach this one
  user = RIVAL;
  const cross = await read(await w.F.handleGetGmMetaStatus("c1", get("/x"), w.env));
  const crossDis = await read(await w.F.handlePostGmMetaDisconnect("c1", post("/x"), w.env));
  ok(cross.status === 403 && crossDis.status === 403 && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_connections")[0].c === 1, "another business's owner is refused on this business's connection");
  user = OWNER;

  w.meta.leads["4002"] = leadAnswer(4002);
  await w.F.handlePostMetaWebhook(hook(event(4002, 222)), w.env);
  const b2 = w.meta.calls.length;
  const dis = await read(await w.F.handlePostGmMetaDisconnect("c1", post("/x"), w.env));
  ok(dis.status === 200 && dis.data.connected === false && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_connections")[0].c === 0 && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_pages")[0].c === 0, "disconnect deletes the stored tokens (connection and Pages)");
  ok(w.meta.calls.slice(b2).some((x) => x.method === "DELETE" && x.path === "/v25.0/222/subscribed_apps"), "disconnect unsubscribes the subscribed Page at Meta");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 1 && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_events")[0].c === 2, "disconnect keeps the leads already received and the event log");

  w.meta.pages = [];
  const none = await connect(w);
  ok(none.back.location.indexOf("meta=nopages") !== -1 && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_connections")[0].c === 0, "no Page granted: back to the card saying so, nothing stored");
}

// ── a seller is refused on every owner route
{
  const w = world();
  await connect(w);
  user = SELLER;
  const routes = [
    ["GET", "gm/meta/status", () => w.F.handleGetGmMetaStatus("c1", get("/x"), w.env)],
    ["POST", "gm/meta/connect", () => w.F.handlePostGmMetaConnect("c1", post("/x"), w.env)],
    ["POST", "gm/meta/pages", () => w.F.handlePostGmMetaPages("c1", post("/x", { page_ids: [] }), w.env)],
    ["POST", "gm/meta/disconnect", () => w.F.handlePostGmMetaDisconnect("c1", post("/x"), w.env)]
  ];
  for (const r of routes) {
    const res = await read(await r[2]());
    ok(res.status === 403, "a seller is refused by the handler: " + r[0] + " " + r[1]);
    ok(w.F.sellerRequestAllowed("/api/clients/c1/" + r[1], r[0], "c1") === false, "and by the seller gate: " + r[0] + " " + r[1]);
    ok(w.F.clientRequestAllowed("/api/clients/c1/" + r[1], r[0], "c1") === true, "while the owner gate lets the owner through: " + r[0] + " " + r[1]);
    ok(w.F.clientRequestAllowed("/api/clients/c2/" + r[1], r[0], "c1") === false, "but not into another business: " + r[0] + " " + r[1]);
  }
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_meta_connections")[0].c === 1 && w.d.q("SELECT subscribed FROM gm_meta_pages")[0].subscribed === 1, "the seller's attempts changed nothing");
  user = null;
  const anon = await read(await w.F.handlePostGmMetaConnect("c1", post("/x"), w.env));
  ok(anon.status === 401, "no login at all is 401");
  user = OWNER;
}

// ── missing settings
for (const missing of ["META_APP_ID", "META_APP_SECRET", "META_LOGIN_CONFIG_ID", "META_WEBHOOK_VERIFY_TOKEN"]) {
  const env = Object.assign({}, ENV_OK);
  delete env[missing];
  const w = world({ env: env });
  const st = await read(await w.F.handleGetGmMetaStatus("c1", get("/x"), w.env));
  const con = await read(await w.F.handlePostGmMetaConnect("c1", post("/x"), w.env));
  ok(st.status === 200 && st.data.available === false && con.status === 503 && con.data.error_en === "Not available yet." && con.data.error_pt === "Ainda não disponível.", "without " + missing + ": the status reads not available and connect answers \"Not available yet.\"");
}
{
  const env = Object.assign({}, ENV_OK);
  delete env.META_APP_SECRET;
  delete env.META_WEBHOOK_VERIFY_TOKEN;
  const w = world({ env: env });
  const body = JSON.stringify(event(5001, 111));
  const hookRes = await read(await w.F.handlePostMetaWebhook(hook(body), w.env));
  const shake = await read(await w.F.handleGetMetaWebhook(get("/api/meta/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=77"), w.env));
  const del = await read(await w.F.handlePostMetaDataDeletion(post("/api/meta/data-deletion", "signed_request=a.b", "application/x-www-form-urlencoded"), w.env));
  ok(hookRes.status === 503 && shake.status === 503 && shake.text.indexOf("77") === -1 && del.status === 503, "without the secrets: the webhook (POST and GET) and the deletion route answer 503, never 200");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_meta_events")[0].c === 0, "and nothing is stored");
}
{
  // The Worker deployed before the migration.
  const w = world({ migrated: false });
  const st = await read(await w.F.handleGetGmMetaStatus("c1", get("/x"), w.env));
  const con = await read(await w.F.handlePostGmMetaConnect("c1", post("/x"), w.env));
  const hookRes = await read(await w.F.handlePostMetaWebhook(hook(event(5001, 111)), w.env));
  const back = await read(await w.F.handleGetMetaCallback(get("/api/meta/callback?code=" + CODE + "&state=" + "ab".repeat(24)), w.env));
  ok(st.status === 200 && st.data.available === false && con.status === 503 && hookRes.status === 503 && back.status === 302, "tables missing (Worker deployed before the migration): not available, webhook 503 so Meta retries, nothing throws");
  await w.F.metaCron(w.env);
  ok(true, "the 4-hour job does nothing and does not throw without the tables");
}

// ── Meta's data deletion request
{
  const w = world();
  await connect(w);
  w.meta.leads["3001"] = leadAnswer(3001);
  await w.F.handlePostMetaWebhook(hook(event(3001, 111)), w.env);
  const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const signed = (payload, secret) => { const p = b64u(JSON.stringify(payload)); return b64u(createHmac("sha256", secret).update(p).digest()) + "." + p; };
  const form = (sr) => post("/api/meta/data-deletion", "signed_request=" + encodeURIComponent(sr), "application/x-www-form-urlencoded");

  const bad = await read(await w.F.handlePostMetaDataDeletion(form(signed({ algorithm: "HMAC-SHA256", user_id: "777001" }, "wrong-secret")), w.env));
  const tampered = signed({ algorithm: "HMAC-SHA256", user_id: "111" }, SECRET).split(".")[0] + "." + b64u(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "777001" }));
  const bad2 = await read(await w.F.handlePostMetaDataDeletion(form(tampered), w.env));
  const bad3 = await read(await w.F.handlePostMetaDataDeletion(form("garbage"), w.env));
  const bad4 = await read(await w.F.handlePostMetaDataDeletion(form(signed({ algorithm: "HMAC-SHA256" }, SECRET)), w.env));
  ok(bad.status === 400 && bad2.status === 400 && bad3.status === 400 && bad4.status === 400, "deletion: a signed_request with the wrong secret, a swapped payload, garbage, or no user_id is refused");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_meta_connections")[0].c === 1 && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_deletions")[0].c === 0, "and a refused request deletes nothing");

  const b2 = w.meta.calls.length;
  const good = await read(await w.F.handlePostMetaDataDeletion(form(signed({ algorithm: "HMAC-SHA256", issued_at: 1, user_id: "777001" }, SECRET)), w.env));
  ok(good.status === 200 && /^[a-f0-9]{32}$/.test(good.data.confirmation_code) && good.data.url === API + "/api/meta/deletion-status/" + good.data.confirmation_code && Object.keys(good.data).sort().join(",") === "confirmation_code,url", "deletion: a good signed_request answers { url, confirmation_code }");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_meta_connections")[0].c === 0 && w.d.q("SELECT COUNT(*) AS c FROM gm_meta_pages")[0].c === 0 && w.meta.calls.slice(b2).some((x) => x.method === "DELETE" && x.path === "/v25.0/111/subscribed_apps"), "the connection made by that Meta user is removed: Page unsubscribed, tokens deleted");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === 1, "the business's own leads stay");
  const page = await read(await w.F.handleGetMetaDeletionStatus(good.data.confirmation_code, get("/x"), w.env));
  const today = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  ok(page.status === 200 && page.text.indexOf("Your Facebook connection data was deleted on " + today + ".") !== -1 && /^\d{2}\/\d{2}\/\d{4}$/.test(today), "the status page reads \"Your Facebook connection data was deleted on MM/DD/YYYY.\" (Eastern)");
  const nopage = await read(await w.F.handleGetMetaDeletionStatus("0".repeat(32), get("/x"), w.env));
  ok(nopage.status === 404 && nopage.text.indexOf("deleted on") === -1, "an unknown code gets a 404 page that claims nothing");
  const other = await read(await w.F.handlePostMetaDataDeletion(post("/api/meta/data-deletion", { signed_request: signed({ algorithm: "HMAC-SHA256", user_id: "555" }, SECRET) }), w.env));
  ok(other.status === 200 && w.d.q("SELECT connections_removed FROM gm_meta_deletions WHERE code = ?", other.data.confirmation_code)[0].connections_removed === 0, "a Meta user who never connected still gets a code (nothing to remove)");
}

// ── no token, secret or code anywhere a browser or a log can see
{
  const leaked = HIDDEN.filter((s) => seen.some((t) => t.indexOf(s) !== -1));
  ok(seen.length > 60 && leaked.length === 0, "no token, app secret, verify token or code appears in any of the " + seen.length + " response bodies or return addresses");
  const logLeak = HIDDEN.filter((s) => logged.some((t) => t.indexOf(s) !== -1));
  ok(logLeak.length === 0, "and none appears in anything the Worker logged (" + logged.length + " lines)");
  const w = world();
  await connect(w);
  w.meta.leads["2001"] = leadAnswer(2001);
  await w.F.handlePostMetaWebhook(hook(event(2001, 111)), w.env);
  const dump = JSON.stringify([w.d.q("SELECT * FROM gm_meta_events"), w.d.q("SELECT * FROM gm_leads"), w.d.q("SELECT * FROM gm_meta_connections"), w.d.q("SELECT * FROM gm_meta_pages"), w.d.q("SELECT * FROM gm_meta_oauth_states")]);
  ok(HIDDEN.every((s) => dump.indexOf(s) === -1), "and none is stored in the clear in any table (events, raw copies, leads, connection, Pages, state)");
  const st = await read(await w.F.handleGetGmMetaStatus("c1", get("/x"), w.env));
  ok(st.text.indexOf("enc:v1:") === -1 && st.text.indexOf("token") === -1, "the status answer carries no token field, sealed or not");
}

// ── every Meta address is built from META, the one place to change it
{
  const body = fnSrc("metaFetch") + fnSrc("handleGetMetaCallback") + fnSrc("metaProcessEvent") + fnSrc("metaSubscribePage") + fnSrc("metaGrantedPages") + fnSrc("metaDialogUrl");
  ok(!/facebook\.com|v\d+\.\d+/.test(body), "no Meta host or version is written outside the META block");
}

// ── the page: the card and the lead block (cut out of gm.js)
{
  const page = function (opts) {
    const names = ["gmMetaPagesHtml", "gmMetaCardHtml", "gmMetaQuestion", "gmMetaLeadHtml"];
    const src = "var gmMetaStatus = opts.status; var gmMetaNotice = opts.notice || \"\"; var gmMetaAwaiting = false; var gmMetaLoading = false;\n" +
      "var GM_META_Q_PT = { state: \"Estado\", zip_code: \"CEP\", post_code: \"CEP\", country: \"Pa\\u00eds\" };\n" +
      "function isEn() { return opts.en !== false; }\nfunction gmT(pt, en) { return isEn() ? en : pt; }\nfunction gmIsSeller() { return !!opts.seller; }\n" +
      "function escHtml(s) { return String(s === null || s === undefined ? \"\" : s).replace(/&/g, \"&amp;\").replace(/</g, \"&lt;\").replace(/>/g, \"&gt;\").replace(/\"/g, \"&quot;\"); }\n" +
      "function gmMetaLoad() {}\nfunction formatDate(s) { return s; }\nfunction formatDateTime(s) { return s; }\n" +
      "function gmSheetRowHtml(icon, label, value) { return \"[\" + label + \": \" + value + \"]\"; }\nfunction gmSheetSection(title, rows) { return \"{\" + title + \"}\" + rows; }\n" +
      fnSrc("formatDateTimeUTC", dtSrc) + "\n" + fnSrc("formatDateUTC", dtSrc) + "\n" + names.map((n) => fnSrc(n, gmSrc)).join("\n") + "\nreturn { gmMetaCardHtml, gmMetaLeadHtml };";
    return new Function("opts", src)(opts);
  };
  const connected = { available: true, connected: true, needs_reconnect: false, connected_at: "2026-10-05 15:00:00", connected_by: "Zeta Owner", subscribed_count: 1, last_lead_at: "2026-10-05 18:14:00",
    pages: [{ page_id: "111", name: "Zeta Pools Page", subscribed: true, problem: false }] };
  const na = page({ status: { available: false, connected: false, pages: [] } }).gmMetaCardHtml();
  ok(na.indexOf("Not available yet.") !== -1 && na.indexOf("<button") === -1 && na.indexOf("Facebook and Instagram lead ads") !== -1, "card: settings missing reads \"Not available yet.\" with no button");
  const off = page({ status: { available: true, connected: false, pages: [] } }).gmMetaCardHtml();
  ok(off.indexOf(">Connect Facebook<") !== -1 && (off.match(/<button/g) || []).length === 1 && off.indexOf("Connect your Facebook Page and every lead from your lead ads lands in your pipeline by itself.") !== -1, "card: not connected shows the sentence and one button, \"Connect Facebook\"");
  const failed = page({ status: { available: true, connected: false, pages: [] }, notice: "failed" }).gmMetaCardHtml();
  ok(failed.indexOf("Facebook was not connected. Nothing changed.") !== -1 && failed.indexOf(">Try again<") !== -1, "card: a failed sign-in reads \"Facebook was not connected. Nothing changed.\" with \"Try again\"");
  const nop = page({ status: { available: true, connected: false, pages: [] }, notice: "nopages" }).gmMetaCardHtml();
  ok(nop.indexOf("did not share any Page") !== -1 && nop.indexOf(">Try again<") !== -1, "card: no Page granted says so and offers \"Try again\"");
  const on = page({ status: connected }).gmMetaCardHtml();
  ok(on.indexOf("Zeta Pools Page") !== -1 && on.indexOf("Connected 10/05/2026 by Zeta Owner") !== -1 && on.indexOf("Last lead: 10/05/2026 2:14 PM") !== -1 && on.indexOf(">Disconnect<") !== -1, "card: connected shows the Page, \"Connected 10/05/2026 by Zeta Owner\", \"Last lead: 10/05/2026 2:14 PM\" and \"Disconnect\"");
  const onPt = page({ status: connected, en: false }).gmMetaCardHtml();
  ok(onPt.indexOf("Conectado em 10/05/2026 por Zeta Owner") !== -1 && onPt.indexOf("Último lead: 10/05/2026 2:14 PM") !== -1, "card in Portuguese: the date is still 10/05/2026 and the time 2:14 PM");
  const noLead = page({ status: Object.assign({}, connected, { last_lead_at: null, connected_by: null }) }).gmMetaCardHtml();
  ok(noLead.indexOf("No leads received yet") !== -1 && noLead.indexOf("Connected 10/05/2026</p>") !== -1, "card: \"No leads received yet\"; no name when the Worker withholds it");
  const rec = page({ status: Object.assign({}, connected, { needs_reconnect: true }) }).gmMetaCardHtml();
  ok(rec.indexOf("Facebook needs to be reconnected") !== -1 && rec.indexOf(">Reconnect<") !== -1, "card: \"Facebook needs to be reconnected\" with \"Reconnect\"");
  const many = page({ status: Object.assign({}, connected, { subscribed_count: 0, pages: [{ page_id: "111", name: "A", subscribed: false }, { page_id: "222", name: "B", subscribed: false, problem: true }] }) }).gmMetaCardHtml();
  ok((many.match(/type="checkbox"/g) || []).length === 2 && many.indexOf(">Save Pages<") !== -1, "card: several Pages are listed with a tick box each and \"Save Pages\"");
  ok(page({ status: connected, seller: true }).gmMetaCardHtml() === "", "card: a salesperson gets nothing at all");

  const lead = { meta_leadgen_id: "5001", meta_platform: "ig", meta_campaign_name: "Fall pools 2026", meta_ad_name: "Pool ad A", meta_form_id: "123",
    meta_answers_json: JSON.stringify([{ q: "what_kind_of_pool_do_you_want?", a: "<b>Saltwater</b>" }, { q: "zip_code", a: "32801" }]) };
  const blk = page({}).gmMetaLeadHtml(lead);
  ok(blk.indexOf("{From the Facebook form}") === 0 && blk.indexOf("[Came from: Instagram ad]") !== -1 && blk.indexOf("[Campaign: Fall pools 2026]") !== -1 && blk.indexOf("[Ad: Pool ad A]") !== -1 && blk.indexOf("[Form ID: 123]") !== -1, "lead: \"From the Facebook form\" shows Instagram ad, the campaign, the ad and the form id");
  ok(blk.indexOf("[What kind of pool do you want?: &lt;b&gt;Saltwater&lt;/b&gt;]") !== -1, "lead: the custom question and its answer are shown (escaped)");
  const blkPt = page({ en: false }).gmMetaLeadHtml(Object.assign({}, lead, { meta_platform: "fb" }));
  ok(blkPt.indexOf("{Do formulário do Facebook}") === 0 && blkPt.indexOf("[Veio de: Anúncio do Facebook]") !== -1 && blkPt.indexOf("[CEP: 32801]") !== -1, "lead in Portuguese: \"Do formulário do Facebook\", \"Anúncio do Facebook\"");
  ok(page({}).gmMetaLeadHtml({ id: "x", meta_leadgen_id: null }) === "", "lead: a lead that did not come from an ad shows no such block");
  ok(!/[^\x00-\x7F]/.test(fnSrc("gmMetaCardHtml", gmSrc) + fnSrc("gmMetaLeadHtml", gmSrc) + fnSrc("gmMetaDisconnect", gmSrc) + fnSrc("gmMetaPagesHtml", gmSrc)), "the new page code is plain ASCII (accents as \\u escapes)");
  ok(gmSrc === readFileSync(new URL("ios/App/App/public/gm.js", root), "utf8"), "the iOS copy of gm.js carries the same code");
}

console.error = realErr;
console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
