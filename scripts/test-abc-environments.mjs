// ABC Supply: one environment PER BUSINESS (2026-11-17), and the staff Production read check.
// The Apex test client uses the ABC Sandbox and its Sandbox key pair. Every other business uses
// ABC Production and the Production key pair. ABC_ENV is gone: nothing flips the test client.
// The REAL Worker functions on an in-memory SQLite, with a FAKE fetch standing in for ABC.
// Fake keys only. No network, no live database, no real order.
//
//   node scripts/test-abc-environments.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { makeWorld, seedConn, reader, get, post, OWNER, RIVAL, STAFF, SB_API, PROD_API, SB_AUTH, SB_AUTH_PATH, PROD_AUTH, PROD_AUTH_PATH,
  CLIENT_ID, SECRET, PROD_ID, PROD_SECRET, ACCESS, PROD_ACCESS, CODE, WH_SECRET, ALL_SECRETS, ENV_BOTH } from "./fixtures/abc-world.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
async function check(name, fn) {
  try { await fn(); } catch (e) { console.log("FAIL  " + name + "  [" + String(e && e.message).slice(0, 160) + "]"); fail++; }
}

const TEST_CLIENT = "test-client-temp-001";
const SB_AUTH_FULL = SB_AUTH + SB_AUTH_PATH;
const PROD_AUTH_FULL = PROD_AUTH + PROD_AUTH_PATH;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const without = (o, keys) => { const c = Object.assign({}, o); keys.forEach((k) => { delete c[k]; }); return c; };
const SB_KEYS = ["ABC_CLIENT_ID", "ABC_CLIENT_SECRET"];
const PROD_KEYS = ["ABC_PROD_CLIENT_ID", "ABC_PROD_CLIENT_SECRET"];

// Every response text and every log line: no secret may appear in any of them.
const seen = [];
const logged = [];
console.error = function () { logged.push(Array.prototype.slice.call(arguments).map(String).join(" ")); };
const read = reader(seen);
let user = OWNER;
const W = (env) => makeWorld({ env: env }, () => user);

// Connects a business through the real connect and callback handlers, then picks the first account and branch.
async function connectThrough(w, who, clientId) {
  user = who;
  const c = await read(await w.F.handlePostGmAbcConnect(clientId, post("/x", {}), w.env));
  if (!c.data || !c.data.url) { throw new Error("connect gave no url: " + c.status); }
  const u = new URL(c.data.url);
  const cb = await read(await w.F.handleGetAbcCallback(get("/api/abc/callback?code=" + CODE + "&state=" + u.searchParams.get("state")), w.env));
  const pick = await read(await w.F.handlePostGmAbcAccount(clientId, post("/x", { ship_to: "2010466-2", branch: "1234" }), w.env));
  return { url: c.data.url, cb: cb, pick: pick };
}

// 1. The test client: Sandbox origins and Sandbox fake keys.
await check("1 test client", async () => {
  const w = W(ENV_BOTH);
  const c = w.F.abcSettings(w.env, TEST_CLIENT);
  ok(c.mode === "sandbox", "1 the test client is in Sandbox mode");
  ok(c.api_origin === SB_API && c.auth_origin === SB_AUTH_FULL, "1 the test client gets the Sandbox origins");
  ok(c.client_id === CLIENT_ID && c.client_secret === SECRET, "1 the test client gets the Sandbox key pair");
  ok(c.ready === true, "1 the test client is ready with both pairs and the sealing key");
});

// 2. Any other business: Production origins and Production fake keys.
await check("2 other business", async () => {
  const w = W(ENV_BOTH);
  ["c1", "c2", "some-real-business"].forEach((id) => {
    const c = w.F.abcSettings(w.env, id);
    ok(c.mode === "production" && c.api_origin === PROD_API && c.auth_origin === PROD_AUTH_FULL, "2 " + id + " gets Production and the Production origins");
    ok(c.client_id === PROD_ID && c.client_secret === PROD_SECRET && c.ready === true, "2 " + id + " gets the Production key pair and is ready");
  });
  const none = w.F.abcSettings(w.env, "");
  const undef = w.F.abcSettings(w.env);
  ok(none.mode === "production" && undef.mode === "production", "2 no business id never means Sandbox");
});

// 3. ABC_ENV is ignored in both directions.
await check("3 ABC_ENV ignored", async () => {
  ["production", "Production ", "sandbox", "prod", ""].forEach((v) => {
    const w = W(Object.assign({ ABC_ENV: v }, ENV_BOTH));
    const t = w.F.abcSettings(w.env, TEST_CLIENT);
    const o = w.F.abcSettings(w.env, "c2");
    ok(t.mode === "sandbox" && t.api_origin === SB_API && t.client_secret === SECRET, "3 ABC_ENV " + JSON.stringify(v) + ": the test client stays on the Sandbox");
    ok(o.mode === "production" && o.api_origin === PROD_API && o.client_secret === PROD_SECRET, "3 ABC_ENV " + JSON.stringify(v) + ": another business stays on Production");
  });
  const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  ok(src.indexOf("ABC_ENV") === -1, "3 worker/index.js has no ABC_ENV anywhere");
});

// 4. Missing keys: never fall back to the other pair.
await check("4 missing keys", async () => {
  const w = W(without(ENV_BOTH, PROD_KEYS));
  const c = w.F.abcSettings(w.env, "c2");
  ok(c.ready === false, "4 no Production keys: another business is not ready");
  ok(c.client_id !== CLIENT_ID && c.client_secret !== SECRET && c.api_origin === PROD_API && c.auth_origin === PROD_AUTH_FULL, "4 no Production keys: still never the Sandbox keys or origins");
  ok(JSON.stringify(c).indexOf(SECRET) === -1 && JSON.stringify(c).indexOf(CLIENT_ID) === -1, "4 nothing of the Sandbox pair is anywhere in those settings");
  const half = W(Object.assign(without(ENV_BOTH, ["ABC_PROD_CLIENT_SECRET"])));
  ok(half.F.abcSettings(half.env, "c2").ready === false, "4 only one Production value: not ready");
  user = RIVAL;
  const st = await read(await w.F.handleGetGmAbcStatus("c2", get("/x"), w.env));
  ok(st.status === 200 && st.data && st.data.available === false && st.data.connected === false, "4 the business sees 'not available'");
  const cn = await read(await w.F.handlePostGmAbcConnect("c2", post("/x", {}), w.env));
  ok(cn.status === 503, "4 connect answers 503 not available");
  ok(w.abc.calls.length === 0, "4 nothing was sent to ABC at all");
  // The other way round: the test client with no Sandbox keys never receives the Production pair.
  const w2 = W(without(ENV_BOTH, SB_KEYS));
  const t = w2.F.abcSettings(w2.env, TEST_CLIENT);
  ok(t.ready === false && t.mode === "sandbox" && t.api_origin === SB_API, "4 no Sandbox keys: the test client is not ready");
  ok(t.client_id !== PROD_ID && t.client_secret !== PROD_SECRET && JSON.stringify(t).indexOf(PROD_SECRET) === -1, "4 no Sandbox keys: the test client never receives the Production keys");
});

// 5. A custom Sandbox list moves exactly the listed businesses.
await check("5 custom list", async () => {
  const w = W(Object.assign({ ABC_SANDBOX_CLIENT_IDS: "c2, c3 ,," }, ENV_BOTH));
  ["c2", "c3"].forEach((id) => { const c = w.F.abcSettings(w.env, id); ok(c.mode === "sandbox" && c.client_secret === SECRET && c.api_origin === SB_API, "5 " + id + " is listed: Sandbox"); });
  ["c1", TEST_CLIENT, "c22"].forEach((id) => { const c = w.F.abcSettings(w.env, id); ok(c.mode === "production" && c.client_secret === PROD_SECRET, "5 " + id + " is not listed: Production"); });
  const empty = W(Object.assign({ ABC_SANDBOX_CLIENT_IDS: "" }, ENV_BOTH));
  ok(empty.F.abcSettings(empty.env, TEST_CLIENT).mode === "production", "5 an empty list means nobody is on the Sandbox");
  const dflt = W(ENV_BOTH);
  ok(dflt.F.abcSettings(dflt.env, TEST_CLIENT).mode === "sandbox" && dflt.F.abcSettings(dflt.env, "c1").mode === "production", "5 the variable unset: only the Apex test client");
});

// 6. A stored connection from the other environment asks to reconnect and is never used.
await check("6 wrong environment", async () => {
  const w = W(Object.assign({ ABC_SANDBOX_CLIENT_IDS: "c1" }, ENV_BOTH));
  await seedConn(w, { client: "c1", environment: "production" });          // c1 is Sandbox now, the row says production
  await seedConn(w, { client: "c2", environment: "sandbox", access: ACCESS }); // c2 is Production, the row says sandbox
  user = OWNER;
  const a = await read(await w.F.handleGetGmAbcStatus("c1", get("/x"), w.env));
  user = RIVAL;
  const b = await read(await w.F.handleGetGmAbcStatus("c2", get("/x"), w.env));
  ok(a.data.connected === true && a.data.needs_reconnect === true && a.data.mode === "sandbox", "6 Sandbox business with a production row: asks to reconnect");
  ok(b.data.connected === true && b.data.needs_reconnect === true && b.data.mode === "production", "6 Production business with a sandbox row: asks to reconnect");
  let t1 = "", t2 = "";
  try { await w.F.abcAccessToken(w.env, w.F.abcSettings(w.env, "c1"), "c1"); } catch (e) { t1 = String(e.message); }
  try { await w.F.abcAccessToken(w.env, w.F.abcSettings(w.env, "c2"), "c2"); } catch (e) { t2 = String(e.message); }
  ok(/other environment/.test(t1) && /other environment/.test(t2), "6 no token is handed out across environments");
  ok(w.abc.calls.length === 0, "6 nothing was sent to ABC");
});

// 7. The OAuth callback uses the environment of the business in the state row.
await check("7 callback", async () => {
  const w = W(Object.assign({ ABC_SANDBOX_CLIENT_IDS: "c1" }, ENV_BOTH));
  const r1 = await connectThrough(w, OWNER, "c1");
  ok(r1.url.indexOf(SB_AUTH_FULL + "/v1/authorize?") === 0, "7 the sign-in address of the Sandbox business is the Sandbox one");
  ok((w.d.q("SELECT environment FROM gm_abc_connections WHERE client_id = 'c1'")[0] || {}).environment === "sandbox", "7 the Sandbox business connected");
  const r2 = await connectThrough(w, RIVAL, "c2");
  ok(r2.url.indexOf(PROD_AUTH_FULL + "/v1/authorize?") === 0, "7 the sign-in address of the Production business is the Production one");
  const rows = w.d.q("SELECT client_id, environment FROM gm_abc_connections ORDER BY client_id");
  ok(rows.length === 2 && rows[0].environment === "sandbox" && rows[1].environment === "production", "7 each connection is stored with its own environment");
  const tokenCalls = w.abc.calls.filter((c) => /\/v1\/token$/.test(c.path));
  ok(tokenCalls.length === 2 && tokenCalls[0].host === SB_AUTH && tokenCalls[1].host === PROD_AUTH, "7 the callback exchanged the code at the right sign-in service for each business");
  ok(r1.pick.status === 200 && r2.pick.status === 200, "7 both businesses could then choose an account and a branch");
  const hooks = w.abc.webhooks.map((h) => h.host);
  ok(hooks.length === 2 && hooks[0] === SB_API && hooks[1] === PROD_API, "7 the webhook is registered at ABC Sandbox for the test business and at ABC Production for the other");
  const apiCalls = w.abc.calls.filter((c) => !/\/v1\/token$/.test(c.path));
  ok(apiCalls.every((c) => (c.host === SB_API) === (c.headers.Authorization === "Bearer " + ACCESS)), "7 every Sandbox call carried the Sandbox token and every Production call the Production one");
  // The status of each shows its own mode.
  user = OWNER; const s1 = await read(await w.F.handleGetGmAbcStatus("c1", get("/x"), w.env));
  user = RIVAL; const s2 = await read(await w.F.handleGetGmAbcStatus("c2", get("/x"), w.env));
  ok(s1.data.mode === "sandbox" && s1.data.needs_reconnect === false && s2.data.mode === "production" && s2.data.needs_reconnect === false, "7 the status shows each business's own mode and no reconnect");
  // Disconnect removes the webhook at the environment of that business.
  user = RIVAL;
  await read(await w.F.handlePostGmAbcDisconnect("c2", post("/x", {}), w.env));
  const del = w.abc.calls.filter((c) => c.method === "DELETE");
  ok(del.length === 1 && del[0].host === PROD_API, "7 disconnect removes the Production webhook at ABC Production");
});

// 7b. The webhook receiver builds the settings from the business in the hook row.
await check("7b webhook receiver", async () => {
  const mk = async (env) => {
    const w = W(env);
    for (const [id, tok] of [["c1", "a".repeat(48)], ["c2", "b".repeat(48)]]) {
      w.d.raw.prepare("INSERT INTO gm_abc_webhooks (client_id, abc_webhook_id, token_hash, secret_hash, event_type) VALUES (?, 'wh', ?, ?, 'ORDER_UPDATE')").run(id, sha(tok), sha(WH_SECRET));
    }
    return w;
  };
  const hit = (w, tok) => w.F.handlePostAbcWebhook(tok, new Request("https://apex-api.farfromtimnah.workers.dev/api/abc/webhook/" + tok, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + WH_SECRET }, body: JSON.stringify({ salesOrder: { status: "shipped", purchaseOrder: "AP-1" } }) }), w.env);
  const A = "a".repeat(48), B = "b".repeat(48);
  const sbOnly = await mk(Object.assign({ ABC_SANDBOX_CLIENT_IDS: "c1" }, without(ENV_BOTH, PROD_KEYS)));
  ok((await read(await hit(sbOnly, A))).status === 200, "7b only Sandbox keys: the Sandbox business's hook is accepted");
  ok((await read(await hit(sbOnly, B))).status === 503, "7b only Sandbox keys: the Production business's hook is not available (never the Sandbox pair)");
  const prodOnly = await mk(Object.assign({ ABC_SANDBOX_CLIENT_IDS: "c1" }, without(ENV_BOTH, SB_KEYS)));
  ok((await read(await hit(prodOnly, B))).status === 200, "7b only Production keys: the Production business's hook is accepted");
  ok((await read(await hit(prodOnly, A))).status === 503, "7b only Production keys: the Sandbox business's hook is not available (never the Production pair)");
  const bad = await read(await hit(sbOnly, "c".repeat(48)));
  ok(bad.status === 404, "7b an unknown address is still 404");
});

// 8 and 9 come at the end: the secrets check over everything above, and the staff pings (part 2).
const callPing = async (w, name, who) => { user = who; return read(await w.F[name](get("/api/abc/ping"), w.env)); };

await check("P1 production ping gate", async () => {
  const w = W(ENV_BOTH);
  ok(typeof w.F.handleGetAbcProductionPing === "function", "P1 the Production ping handler exists");
  user = null;
  ok((await read(await w.F.handleGetAbcProductionPing(get("/x"), w.env))).status === 401, "P1 no user: 401");
  ok((await callPing(w, "handleGetAbcProductionPing", OWNER)).status === 403, "P1 a business owner: 403");
  ok((await callPing(w, "handleGetAbcProductionPing", { role: "client", client_id: "c1", login_role: "seller" })).status === 403, "P1 a seller: 403");
  ok(w.abc.calls.length === 0, "P1 a refused call sends nothing to ABC");
  for (const role of ["alice", "rafa", "developer"]) {
    const r = await callPing(W(ENV_BOTH), "handleGetAbcProductionPing", { role: role, username: role });
    ok(r.status === 200, "P1 role " + role + " is allowed");
  }
});

await check("P2 production ping uses Production", async () => {
  const w = W(ENV_BOTH);
  const r = await callPing(w, "handleGetAbcProductionPing", STAFF);
  ok(r.status === 200 && r.data.mode === "production" && r.data.token_status === 200, "P2 answers mode production and a token status of 200");
  ok(r.data.branches.status === 200 && r.data.branches.count === 3 && r.data.items.status === 200 && typeof r.data.items.total === "number", "P2 reports branch and item counts");
  ok(w.abc.calls.length === 3 && w.abc.calls.every((c) => c.host === PROD_AUTH || c.host === PROD_API), "P2 only the Production hosts were called (one token, one branch search, one item search)");
  ok(w.abc.calls.some((c) => c.method === "GET" && c.path === "/api/location/v1/branches" && c.host === PROD_API), "P2 Search Branches was called at Production");
  ok(w.abc.calls.some((c) => c.method === "POST" && c.path === "/api/product/v1/search/items" && c.host === PROD_API), "P2 Search Items was called at Production");
  ok(w.abc.calls[0].headers.Authorization === "Basic " + Buffer.from(PROD_ID + ":" + PROD_SECRET).toString("base64"), "P2 the Production key pair signed the token call");
  ok(w.abc.calls.every((c) => !/pricing|order/.test(c.path)), "P2 never pricing and never an order");
  ok(w.abc.priceBatches.length === 0 && w.abc.orders.length === 0, "P2 no price batch and no order was made");
  const keys = Object.keys(r.data).sort().join(",");
  ok(keys === "branches,items,mode,token_status", "P2 the answer holds only mode, token status, branches and items");
  // The old route still answers, from the Sandbox, with the Sandbox keys.
  const s = await callPing(w, "handleGetAbcSandboxPing", STAFF);
  ok(s.status === 200 && s.data.mode === "sandbox" && s.data.token_status === 200 && s.data.branches.count === 3, "P2 the Sandbox ping still works");
  const sbCalls = w.abc.calls.slice(3);
  ok(sbCalls.length === 3 && sbCalls.every((c) => c.host === SB_AUTH || c.host === SB_API), "P2 the Sandbox ping called only the Sandbox hosts");
  ok(sbCalls[0].headers.Authorization === "Basic " + Buffer.from(CLIENT_ID + ":" + SECRET).toString("base64"), "P2 the Sandbox ping used the Sandbox key pair");
});

await check("P3 production ping needs the Production keys", async () => {
  const w = W(without(ENV_BOTH, PROD_KEYS));
  const r = await callPing(w, "handleGetAbcProductionPing", STAFF);
  ok(r.status === 503, "P3 no Production keys: not available, never the Sandbox keys");
  ok(w.abc.calls.length === 0, "P3 nothing was sent");
  const w2 = W(without(ENV_BOTH, SB_KEYS));
  const s = await callPing(w2, "handleGetAbcSandboxPing", STAFF);
  ok(s.status === 503 && w2.abc.calls.length === 0, "P3 the Sandbox ping with no Sandbox keys: not available, never the Production keys");
  // ABC_ENV does not change which pair either ping uses.
  const w3 = W(Object.assign({ ABC_ENV: "production" }, ENV_BOTH));
  const s3 = await callPing(w3, "handleGetAbcSandboxPing", STAFF);
  ok(s3.data.mode === "sandbox" && w3.abc.calls.every((c) => c.host === SB_AUTH || c.host === SB_API), "P3 ABC_ENV production does not turn the Sandbox ping into a Production call");
});

await check("P4 failures are reported not thrown", async () => {
  const w = W(ENV_BOTH);
  w.abc.tokenFail = 429;
  const t = await callPing(w, "handleGetAbcProductionPing", STAFF);
  ok(t.status === 200 && t.data.token_status === 429 && t.data.branches.status === 0, "P4 a token failure: the status is reported and nothing else is called");
  ok(w.abc.calls.length === 1, "P4 only the token call was made");
  const w2 = W(ENV_BOTH);
  w2.abc.branchesFail = 503;
  const b = await callPing(w2, "handleGetAbcProductionPing", STAFF);
  ok(b.status === 200 && b.data.token_status === 200 && b.data.branches.status === 503 && b.data.items.status === 200, "P4 a failed branch search is reported and the item search still runs");
  const w3 = W(ENV_BOTH);
  w3.abc.down = true;
  const d = await callPing(w3, "handleGetAbcProductionPing", STAFF);
  ok(d.status === 200 && d.data.token_status === 0, "P4 ABC unreachable: status 0, no crash");
});

// 8. No secret in any text or log line produced by all of the above.
await check("8 no secrets", async () => {
  const all = seen.join("\n") + "\n" + logged.join("\n");
  ok(seen.length > 20, "8 a good number of answers were checked (" + seen.length + ")");
  ALL_SECRETS.forEach((s) => { ok(all.indexOf(s) === -1, "8 no answer or log line holds " + s.slice(0, 10) + "..."); });
  ok(all.indexOf(Buffer.from(CLIENT_ID + ":" + SECRET).toString("base64")) === -1 && all.indexOf(Buffer.from(PROD_ID + ":" + PROD_SECRET).toString("base64")) === -1, "8 no basic auth header value anywhere");
});

console.log(fail ? "\n" + fail + " failed" : "\nAll passed");
process.exit(fail ? 1 : 0);
