// Passkey login (Stytch): the REAL Worker functions on an in-memory SQLite
// (scripts/fixtures/d1-shim.mjs) with a FAKE Stytch fetch and a fake
// Telegram. No network, no real Stytch, no production database.
//
//   node scripts/test-passkey-login.mjs
import { createHash } from "node:crypto";
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };
const sha = (s) => createHash("sha256").update(s).digest("hex");

const FNS = [
  "passkeyEnabled", "passkeyAppReady", "passkeyIso", "passkeyFail", "passkeyConstantEq", "passkeyB64url",
  "passkeyNewToken", "passkeyTokenShapeOk", "passkeyNormalizePhone", "passkeyPhoneError", "passkeyCountryCode",
  "passkeyCountryAllowed", "passkeyMaskPhone", "passkeySmsCap", "passkeyFirstName", "stytchBaseUrl", "stytchCall",
  "passkeyParseOptions", "passkeyCredentialString", "passkeyMintSession", "passkeySigninRateLimited",
  "handleGetPasskeyStatus", "handlePostPasskeyLoginStart", "handlePostPasskeyLoginFinish", "passkeyCreateInvite",
  "passkeyLoadInvite", "passkeyInviteUsable", "passkeyInviteMessage", "passkeyInviteMessageFor",
  "handleGetPasskeyInviteInfo", "passkeyMaybeAlert", "handlePostPasskeyInviteSendCode",
  "handlePostPasskeyInviteVerifyCode", "passkeyEnsureLogin", "handlePostPasskeyInviteRegister",
  "passkeyPeopleActor", "passkeyMayManage", "passkeyPublicPerson", "passkeyInviterName", "passkeyInviteResponse",
  "passkeyForbidden", "handleGetGmPeople", "handlePostGmPeople", "passkeyLoadPersonFor", "handlePostGmPersonInvite",
  "handlePostGmPersonStatus", "handleGmOwnerInvite", "passkeyIsRoutePath", "passkeyRoute",
  "loginRoleRuleHit", "loginRoleDenied", "enforceClientRoleGate", "enforceClientRoleGateChecks",
  "clientRequestAllowed", "sellerRequestAllowed",
  "sessionSellerName", "isAdminRole", "gmStr", "sha256Hex", "generateClientToken", "handlePostClientLogin",
  "verifyPassword", "hashPassword", "pbkdf2Hash", "bytesToB64", "b64ToBytes", "authenticateClientToken",
  // Login completion build (Changes A-K): device limit / labels, WhatsApp
  // channel, the audit log and its auto-recorders, seats, country anomaly,
  // "my devices", device-event / loss review, legacy cutover, source tag.
  "passkeyDeviceLimitMsg", "passkeyKeepOneMsg", "passkeySignInAgainMsg", "passkeyWhatsappSoonMsg",
  "passkeyDeviceLabel", "passkeyDeviceLabelOrDefault", "passkeyChannelFor", "passkeyWhatsappEnabled",
  "passkeyWhatsappCap", "passkeyPhoneSendable", "passkeyMaybeWhatsappAlert",
  "loginActivityIpPrefix", "loginActivityCountry", "loginActivityInsert", "loginActivityRecord",
  "loginActivityPathGroup", "loginActivityHourKey", "loginActivityMinuteKey", "loginActivityMaybeAuto",
  "loginActivityPurgeDaily",
  "passkeySeatsUsed", "passkeySeatPolicy", "passkeySeatBlocked", "passkeySeatUsageBump", "passkeySeatBlockedMsgDirect",
  "passkeyTrustedCountries", "passkeyNewCountryCheck", "notifyNicoleTelegramOncePerPersonCountry",
  "notifyNicoleTelegramOncePerPersonHour", "passkeySessionCountryCheck",
  "handlePostGmPersonPasskeyRevoke", "passkeyMeLoadPerson", "passkeyMeForbidden", "handleGetMePasskeys",
  "handlePostMePasskeysStartAdd", "handlePostMePasskeysFinishAdd", "handlePostMePasskeyRemove",
  "passkeyMeRateLimited", "handlePostGmPersonRole",
  "passkeyDeviceEventDupMsg", "passkeyEasternMidnight", "passkeyEasternDateTime", "passkeyEasternTodayStr",
  "passkeyMostRecentFridayStr", "passkeyComputeReportedLossAt", "passkeyDeviceLossWhenError",
  "handlePostGmPersonDeviceEvent", "passkeyLossReviewPeriodSummary", "passkeyRunLossReview",
  "handleGetGmLossReviews", "handlePostGmLossReviewMark", "handlePostGmLossReviewRecheck",
  "handleGetGmPersonLossReview", "handlePostGmClientLegacyLogin", "passkeyLegacyCutoverActive",
  "handleGetGmActivity", "handleGetDiagnosticsLoginActivity", "handleGetDiagnosticsDeviceEvents",
  "handlePostGmClientSeatPolicy", "handleGetGmClientSeatUsage", "handlePostGmClientSource"
];
const VARS = [
  "PASSKEY_RP_ID", "PASSKEY_INVITE_URL", "PASSKEY_APP_STORE_URL", "PASSKEY_INVITE_HOURS", "PASSKEY_CODE_MINUTES",
  "PASSKEY_REGISTER_MINUTES", "PASSKEY_SENDS_PER_INVITE", "PASSKEY_SEND_COOLDOWN_S", "PASSKEY_SENDS_PER_IP",
  "PASSKEY_VERIFY_FAILURES_MAX", "PASSKEY_SIGNIN_PER_IP_HOUR", "PASSKEY_ONLY_HASH", "PASSKEY_NEW_LOGIN_ROLES",
  "PASSKEY_PERSON_ROLES", "PASSKEY_ROLE_LABELS", "LOGIN_ROLE_DENY_OWNER_ONLY", "LOGIN_ROLE_DENY_SETTINGS",
  "LOGIN_ROLE_DENY_MONEY", "PBKDF2_ITERATIONS",
  "PASSKEY_MAX_DEVICES", "PASSKEY_RECENT_SIGNIN_MINUTES", "PASSKEY_DEVICE_LOSS_REASONS", "PASSKEY_INVITE_PURPOSES",
  "PASSKEY_TRUSTED_COUNTRIES_DEFAULT", "LOGIN_FINANCE_VIEW_RE", "LOGIN_CLIENT_ROUTE_RE", "PASSKEY_SENSITIVE_KINDS"
];

const BASE_TABLES = [
  "CREATE TABLE client_logins (username TEXT PRIMARY KEY, client_id TEXT NOT NULL, password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 1, tracking_start TEXT, password_changed_at TEXT, last_login_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), work_schedule TEXT, created_by TEXT, role TEXT NOT NULL DEFAULT 'client', seller_name TEXT, UNIQUE (client_id, seller_name))",
  "CREATE TABLE client_auth_tokens (token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, username TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE TABLE client_login_attempts (id TEXT PRIMARY KEY, username TEXT, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
];

// ── Fake Stytch ───────────────────────────────────────────────────────────
function fakeStytch(state) {
  return async function fetch(url, init) {
    const u = new URL(url);
    const body = JSON.parse(init.body || "{}");
    state.calls.push({ host: u.host, path: u.pathname, body, auth: init.headers.Authorization });
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (state.down) { return reply(500, { error_type: "internal_server_error" }); }
    switch (u.pathname) {
      case "/v1/otps/sms/login_or_create":
        return reply(200, { user_id: state.userFor[body.phone_number] || "user-" + body.phone_number.slice(-4), phone_id: "phone-" + body.phone_number.slice(-4) });
      case "/v1/otps/authenticate":
        return body.code === "123456"
          ? reply(200, { user_id: "user-" + body.method_id.slice(-4), method_id: body.method_id })
          : reply(401, { error_type: "unauthorized_credentials" });
      case "/v1/webauthn/register/start":
        return reply(200, { user_id: body.user_id, public_key_credential_creation_options: JSON.stringify({ challenge: "Y2hhbGxlbmdl", rp: { id: body.domain, name: "Apex" }, user: { id: "dXNlcg", name: "x", displayName: "x" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }] }) });
      case "/v1/webauthn/register": {
        const c = JSON.parse(body.public_key_credential);
        if (c.bad) { return reply(400, { error_type: "invalid_public_key_credential" }); }
        return reply(200, { user_id: body.user_id, webauthn_registration_id: c.reg });
      }
      case "/v1/webauthn/authenticate/start":
        return reply(200, { user_id: "", public_key_credential_request_options: JSON.stringify({ challenge: "c2lnbmlu", rpId: body.domain, allowCredentials: [] }) });
      case "/v1/webauthn/authenticate": {
        const c = JSON.parse(body.public_key_credential);
        if (c.bad) { return reply(401, { error_type: "unauthorized_credentials" }); }
        return reply(200, { user_id: c.user, webauthn_registration_id: c.reg });
      }
    }
    return reply(404, {});
  };
}

function world(envOverrides) {
  const d = makeDb(["migrations/passkey_login.sql"]);
  BASE_TABLES.forEach((s) => d.raw.exec(s));
  d.raw.prepare("INSERT INTO clients (id, name, owners, whatsapp, phone, language) VALUES ('c1', 'Acme Pools', 'Maria Silva, Joao', '(407) 555-0101', NULL, 'pt')").run();
  d.raw.prepare("INSERT INTO clients (id, name, owners, whatsapp, phone, language) VALUES ('c2', 'Other Co', 'Ana', NULL, NULL, 'en')").run();
  const state = { calls: [], telegram: [], userFor: {}, down: false, clockMs: Date.now(), user: null };
  const stubs = Object.assign({}, baseStubs, {
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status || 400, error: en, error_pt: pt, error_en: en }, extra || {}),
    fetch: fakeStytch(state),
    notifyNicoleTelegram: async (env, msg) => { state.telegram.push(msg); },
    publicReadRateLimited: () => false,
    passkeyNow: () => new Date(state.clockMs),
    authenticate: async () => state.user,
    actorName: (u) => (u && (u.display_name || u.role)) || null,
    docPdfRenderSession: async () => null
  });
  const F = build(FNS, VARS, stubs);
  const env = Object.assign({
    DB: d.DB, PASSKEY_LOGIN_ENABLED: "1", STYTCH_PROJECT_ID: "project-test-x", STYTCH_SECRET: "secret-test-x"
  }, envOverrides || {});
  return { d, F, env, state };
}

function rq(method, path, body, ip, auth) {
  return {
    method, url: "https://apex-api.test" + path,
    headers: { get: (k) => (k === "CF-Connecting-IP" ? (ip === undefined ? "1.1.1.1" : ip) : (k === "Authorization" ? (auth || null) : null)) },
    json: async () => body || {}
  };
}
const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "Acme Pools", auth_method: "password" };
const tokenOf = (url) => url.split("?t=")[1];

async function addPerson(w, role, phone, name, user) {
  w.state.user = user || OWNER;
  return w.F.passkeyRoute(rq("POST", "/api/gm/people", { name: name || "Pat Lee", role, phone }), w.env, "/api/gm/people", "POST");
}
async function send(w, t, ip) { return w.F.passkeyRoute(rq("POST", "/api/passkey-invite/send-code", { t }, ip), w.env, "/api/passkey-invite/send-code", "POST"); }
async function verify(w, t, code) { return w.F.passkeyRoute(rq("POST", "/api/passkey-invite/verify-code", { t, code }), w.env, "/api/passkey-invite/verify-code", "POST"); }
async function register(w, t, cred) { return w.F.passkeyRoute(rq("POST", "/api/passkey-invite/register", { t, credential: cred }), w.env, "/api/passkey-invite/register", "POST"); }
async function info(w, t) { return w.F.passkeyRoute(rq("GET", "/api/passkey-invite/info?t=" + encodeURIComponent(t)), w.env, "/api/passkey-invite/info", "GET"); }
async function finish(w, cred, ip) { return w.F.passkeyRoute(rq("POST", "/api/passkey-login/finish", { credential: cred }, ip), w.env, "/api/passkey-login/finish", "POST"); }
async function completeInvite(w, t, reg) {
  await send(w, t);
  const v = await verify(w, t, "123456");
  if (v.status !== 200) { throw new Error("verify failed " + JSON.stringify(v)); }
  return register(w, t, { id: "cred", reg: reg || "reg-1" });
}

// ── 1. Dark switch ────────────────────────────────────────────────────────
{
  const w = world({ PASSKEY_LOGIN_ENABLED: "" });
  const routes = [
    ["POST", "/api/passkey-login/start"], ["POST", "/api/passkey-login/finish"],
    ["GET", "/api/passkey-invite/info"], ["POST", "/api/passkey-invite/send-code"],
    ["POST", "/api/passkey-invite/verify-code"], ["POST", "/api/passkey-invite/register"],
    ["GET", "/api/gm/people"], ["POST", "/api/gm/people"], ["POST", "/api/gm/people/abc/invite"],
    ["POST", "/api/gm/people/abc/disable"], ["POST", "/api/gm/people/abc/enable"],
    ["GET", "/api/gm/clients/c1/owner-invite"], ["POST", "/api/gm/clients/c1/owner-invite"]
  ];
  w.state.user = OWNER;
  let all404 = true;
  for (const [m, p] of routes) {
    const r = await w.F.passkeyRoute(rq(m, p, {}), w.env, p, m);
    if (!r || r.status !== 404 || r.error !== "Not found") { all404 = false; console.log("   not 404:", m, p, r); }
  }
  ok(all404, "dark switch: all 13 routes answer 404 {error:'Not found'} when PASSKEY_LOGIN_ENABLED is not \"1\"");
  const st = await w.F.passkeyRoute(rq("GET", "/api/passkey-login/status"), w.env, "/api/passkey-login/status", "GET");
  ok(st.status === 200 && st.data.enabled === false, "dark switch: status still answers { enabled: false }");
  const w2 = world({ PASSKEY_LOGIN_ENABLED: "true" });
  const r2 = await w2.F.passkeyRoute(rq("POST", "/api/passkey-login/start"), w2.env, "/api/passkey-login/start", "POST");
  ok(r2.status === 404, "dark switch: only the exact string \"1\" turns it on (\"true\" stays dark)");
  ok(w.state.calls.length === 0 && w2.state.calls.length === 0, "dark switch: Stytch never called while dark");
  ok((await w.F.passkeyRoute(rq("GET", "/api/role"), w.env, "/api/role", "GET")) === null, "unrelated paths fall through (null)");
  const w3 = world();
  const st3 = await w3.F.passkeyRoute(rq("GET", "/api/passkey-login/status"), w3.env, "/api/passkey-login/status", "GET");
  ok(st3.data.enabled === true, "status says enabled when the switch is \"1\"");
}

// ── 2. Invite creation: hash only, 72 hours ────────────────────────────────
{
  const w = world({ PASSKEY_WHATSAPP_ENABLED: "1" });
  const t0 = w.state.clockMs;
  const r = await addPerson(w, "staff", "407 555 0199", "Pat Lee");
  ok(r.status === 200 && /^https:\/\/apex\.resonateai\.online\/invite-login\.html\?t=[A-Za-z0-9_-]{43}$/.test(r.data.invite_url), "people POST returns the invite_url with a 43-char base64url token");
  const tok = tokenOf(r.data.invite_url);
  const rows = w.d.q("SELECT * FROM login_invites");
  ok(rows.length === 1 && rows[0].token_hash === sha(tok), "only the SHA-256 of the token is stored");
  const dump = JSON.stringify(w.d.q("SELECT * FROM login_invites")) + JSON.stringify(w.d.q("SELECT * FROM login_people"));
  ok(dump.indexOf(tok) === -1, "the token itself appears in no stored row");
  const hrs = (Date.parse(rows[0].expires_at) - t0) / 3600000;
  ok(Math.abs(hrs - 72) < 0.01 && r.data.expires_at === rows[0].expires_at, "invite expires in 72 hours");
  ok(r.data.person.masked_phone === "••• •••• 0199" && w.d.q("SELECT phone_e164 FROM login_people")[0].phone_e164 === "+14075550199", "phone stored as E.164 (+1 assumed for 10 digits) and only masked in the response");
  const br = await addPerson(w, "seller", "+55 (11) 98765-4321", "Bia Souza");
  ok(br.status === 200 && w.d.q("SELECT phone_e164 FROM login_people WHERE display_name = 'Bia Souza'")[0].phone_e164 === "+5511987654321", "Brazil +55 accepted, punctuation collapsed");
  const uk = await addPerson(w, "staff", "+44 20 7946 0958", "Tom");
  ok(uk.status === 400 && /United States/.test(uk.error_en) && /Estados Unidos/.test(uk.error_pt), "other country codes refused with a bilingual message");
  const dup = await addPerson(w, "staff", "(407) 555-0199", "Someone Else");
  ok(dup.status === 409, "same number twice at one business refused");
}

// ── 3. Info route: generic 404 for bad / used / replaced / expired ─────────
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550101", "Pat Lee");
  const t = tokenOf(r.data.invite_url);
  const good = await info(w, t);
  ok(good.status === 200 && good.data.name === "Pat" && good.data.business_name === "Acme Pools" && good.data.role_label.en === "Staff without finance access" && /0101$/.test(good.data.masked_phone), "info: valid link returns first name, business, role label, masked phone");
  ok(JSON.stringify(good.data).indexOf("4075550101") === -1, "info never returns the full number");
  const bad = await info(w, "x".repeat(43));
  const malformed = await info(w, "short");
  ok(bad.status === 404 && bad.error === "Not found" && malformed.status === 404, "info: unknown and malformed tokens are a plain 404");
  // replaced
  w.state.user = OWNER;
  const pid = r.data.person.id;
  const re = await w.F.passkeyRoute(rq("POST", "/api/gm/people/" + pid + "/invite"), w.env, "/api/gm/people/" + pid + "/invite", "POST");
  const replaced = await info(w, t);
  ok(re.status === 200 && replaced.status === 404 && replaced.error === "Not found", "info: a replaced link is the same 404");
  const t2 = tokenOf(re.data.invite_url);
  ok((await info(w, t2)).status === 200, "info: the new link works");
  // expired
  w.state.clockMs += 73 * 3600 * 1000;
  ok((await info(w, t2)).status === 404, "info: an expired link is the same 404");
  // used
  const w2 = world();
  const r2 = await addPerson(w2, "staff", "4075550102", "Kim Park");
  const tu = tokenOf(r2.data.invite_url);
  const done = await completeInvite(w2, tu, "reg-used");
  ok(done.status === 200, "(setup) invite completed");
  ok((await info(w2, tu)).status === 404, "info: a used link is the same 404");
}

// ── 4. send-code refusals ──────────────────────────────────────────────────
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550103", "Pat Lee");
  const t = tokenOf(r.data.invite_url);
  const s1 = await send(w, t);
  ok(s1.status === 200 && s1.data.sent === true, "send-code: first send ok");
  const smsCall = w.state.calls.filter((c) => c.path === "/v1/otps/sms/login_or_create");
  ok(smsCall.length === 1 && smsCall[0].body.phone_number === "+14075550103" && smsCall[0].body.expiration_minutes === 5, "send-code: Stytch login_or_create with the STORED E.164 number and a 5-minute code");
  ok(smsCall[0].host === "test.stytch.com" && smsCall[0].auth === "Basic " + Buffer.from("project-test-x:secret-test-x").toString("base64"), "Stytch: test host by default, HTTP Basic project:secret");
  const cool = await send(w, t);
  ok(cool.status === 429 && /later/.test(cool.error_en), "send-code: refused inside the 60-second cooldown (generic try-again-later)");
  w.state.clockMs += 61000;
  ok((await send(w, t)).status === 200, "send-code: second send after cooldown ok");
  w.state.clockMs += 61000;
  ok((await send(w, t)).status === 200, "send-code: third send ok");
  w.state.clockMs += 61000;
  const fourth = await send(w, t);
  ok(fourth.status === 429 && fourth.error_en === cool.error_en, "send-code: fourth send in 24h refused with the same message");
  ok(w.d.q("SELECT stytch_user_id FROM login_people")[0].stytch_user_id === "user-0103" && !!w.d.q("SELECT stytch_method_id FROM login_invites")[0].stytch_method_id, "send-code: Stytch user id stored on the person, method id on the invite");
  // number never from the request
  const w2 = world();
  const r2 = await addPerson(w2, "staff", "4075550104", "Pat Lee");
  await w2.F.passkeyRoute(rq("POST", "/api/passkey-invite/send-code", { t: tokenOf(r2.data.invite_url), phone: "+15550001111", phone_number: "+15550001111" }), w2.env, "/api/passkey-invite/send-code", "POST");
  const sent2 = w2.state.calls.filter((c) => c.path === "/v1/otps/sms/login_or_create");
  ok(sent2.length === 1 && sent2[0].body.phone_number === "+14075550104", "send-code: a phone in the request body is ignored; the stored number is used");
  // disallowed country (env narrows to Brazil only)
  const w3 = world({ PASSKEY_ALLOWED_COUNTRIES: "55" });
  const r3 = await addPerson(w3, "staff", "4075550105", "Pat Lee");
  const s3 = await send(w3, tokenOf(r3.data.invite_url));
  ok(s3.status === 429 && w3.state.calls.length === 0, "send-code: a country outside PASSKEY_ALLOWED_COUNTRIES is refused, no SMS");
  // disabled person
  const w4 = world();
  const r4 = await addPerson(w4, "staff", "4075550106", "Pat Lee");
  w4.d.raw.prepare("UPDATE login_people SET status = 'disabled'").run();
  const s4 = await send(w4, tokenOf(r4.data.invite_url));
  ok(s4.status === 429 && w4.state.calls.length === 0, "send-code: a disabled person gets no SMS");
  // app-wide cap + Telegram alerts
  const w5 = world({ PASSKEY_SMS_DAILY_CAP: "4" });
  const toks = [];
  for (let i = 0; i < 5; i++) { toks.push(tokenOf((await addPerson(w5, "staff", "40755502" + (10 + i), "Person " + i)).data.invite_url)); }
  const res5 = [];
  for (let i = 0; i < 5; i++) { res5.push((await send(w5, toks[i], "9.9.9." + i)).status); }
  ok(res5.slice(0, 4).every((s) => s === 200) && res5[4] === 429, "send-code: the 5th send app-wide is refused when PASSKEY_SMS_DAILY_CAP=4");
  ok(w5.state.telegram.length === 2 && /half/.test(w5.state.telegram[0]) && /daily cap/.test(w5.state.telegram[1]), "Telegram: one alert at half cap and one at the cap");
  w5.state.clockMs += 61000;
  await send(w5, toks[4], "9.9.9.9");
  ok(w5.state.telegram.length === 2, "Telegram: no repeat alert the same day");
  ok(w5.state.telegram.every((m) => !/\+1407/.test(m) && !/4075550/.test(m)), "Telegram messages carry no phone number");
  // per-IP cap
  const w6 = world({ PASSKEY_SMS_DAILY_CAP: "100" });
  const res6 = [];
  for (let i = 0; i < 11; i++) {
    const tk = tokenOf((await addPerson(w6, "staff", "40755503" + (10 + i), "P " + i)).data.invite_url);
    res6.push((await send(w6, tk, "7.7.7.7")).status);
  }
  ok(res6.slice(0, 10).every((s) => s === 200) && res6[10] === 429, "send-code: the 11th send from one IP in 24h is refused");
  ok(w6.d.q("SELECT COUNT(*) AS n FROM login_code_sends")[0].n === 10, "send-code: refused sends are not counted");
}

// ── 5. verify-code dies after 5 failures; register needs register_until ────
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550107", "Pat Lee");
  const t = tokenOf(r.data.invite_url);
  await send(w, t);
  const early = await register(w, t, { id: "x", reg: "reg-early" });
  ok(early.status === 400 && w.state.calls.every((c) => c.path !== "/v1/webauthn/register"), "register: refused before a verified code (no register_until), Stytch not called");
  const outs = [];
  for (let i = 0; i < 5; i++) { outs.push(await verify(w, t, "000000")); }
  ok(outs.slice(0, 4).every((o) => o.status === 400 && /Invalid or expired code/.test(o.error_en)), "verify-code: wrong codes 1-4 answer the generic invalid-code message");
  ok(outs[4].status === 404 && outs[4].restart === true, "verify-code: the 5th failure kills the link (restart)");
  const after = await verify(w, t, "123456");
  ok(after.status === 404 && (await info(w, t)).status === 404, "verify-code: even the right code is refused after 5 failures; info says the link is gone");
  // register window
  const w2 = world();
  const r2 = await addPerson(w2, "staff", "4075550108", "Pat Lee");
  const t2 = tokenOf(r2.data.invite_url);
  await send(w2, t2);
  const v = await verify(w2, t2, "123456");
  ok(v.status === 200 && v.data.options && v.data.options.challenge && v.data.options.rp.id === "apex.resonateai.online", "verify-code: success returns the parsed creation options for apex.resonateai.online");
  const rs = w2.state.calls.filter((c) => c.path === "/v1/webauthn/register/start")[0];
  ok(rs && rs.body.domain === "apex.resonateai.online" && rs.body.return_passkey_credential_options === true && rs.body.use_base64_url_encoding === true && rs.body.user_id === "user-0108", "register/start: domain, both options, the person's Stytch user");
  w2.state.clockMs += 11 * 60 * 1000;
  const late = await register(w2, t2, { id: "x", reg: "reg-late" });
  ok(late.status === 400 && w2.d.q("SELECT COUNT(*) AS n FROM login_passkeys")[0].n === 0, "register: refused once register_until (10 minutes) has passed");
}

// ── 6. Completing an invite ────────────────────────────────────────────────
{
  const w = world();
  const r = await addPerson(w, "partner", "4075550109", "Paula Reis");
  const t = tokenOf(r.data.invite_url);
  const done = await completeInvite(w, t, "reg-p1");
  ok(done.status === 200 && /^capt_[0-9a-f]{64}$/.test(done.data.token) && done.data.client_id === "c1" && done.data.client_name === "Acme Pools" && done.data.must_change_password === false, "register: returns a session of the normal shape { token, client_id, client_name, must_change_password }");
  ok(Object.keys(done.data).sort().join(",") === "client_id,client_name,must_change_password,token", "register: exactly the four keys handlePostClientLogin returns");
  const p = w.d.q("SELECT * FROM login_people")[0];
  ok(p.status === "active" && !!p.accepted_at && /^pk-[a-z0-9]{8}$/.test(p.username), "register: person active, accepted_at set, username pk-<random>");
  const login = w.d.q("SELECT * FROM client_logins WHERE username = ?", p.username)[0];
  ok(login && login.password_hash === "PASSKEY_ONLY" && login.must_change_password === 0 && login.role === "partner" && login.seller_name === "Paula Reis", "register: client_logins row with PASSKEY_ONLY, role partner, seller_name = name, must_change 0");
  const tok = w.d.q("SELECT * FROM client_auth_tokens")[0];
  ok(tok && tok.token_hash === sha(done.data.token) && tok.username === p.username && Math.abs(Date.parse(tok.expires_at) - Date.now() - 30 * 86400000) < 60000, "register: session stored as SHA-256 in client_auth_tokens with a 30-day expiry");
  ok(w.d.q("SELECT used_at FROM login_invites")[0].used_at && w.d.q("SELECT COUNT(*) AS n FROM login_passkeys WHERE revoked_at IS NULL")[0].n === 1, "register: invite marked used, registration id in the allow-list");
  // The session resolves to the partner role, never owner.
  const sess = await w.F.authenticateClientToken(done.data.token, w.env);
  ok(sess.login_role === "partner" && sess.seller_name === null && sess.display_name === "Paula Reis", "the new session authenticates as login_role 'partner' (not owner, not seller)");
  // Owner with an existing client row: linked, no second row.
  const w2 = world();
  w2.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role) VALUES ('acmepools', 'c1', 'pbkdf2$x$y$z', 0, 'client')").run();
  w2.state.user = { role: "developer", display_name: "Nicole" };
  const oi = await w2.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/owner-invite", {}), w2.env, "/api/gm/clients/c1/owner-invite", "POST");
  ok(oi.status === 200 && /0101$/.test(oi.data.masked_phone) && oi.data.invite_url, "owner-invite: admin creates the owner's link from clients.whatsapp");
  const od = await completeInvite(w2, tokenOf(oi.data.invite_url), "reg-owner");
  ok(od.status === 200 && w2.d.q("SELECT COUNT(*) AS n FROM client_logins WHERE client_id = 'c1' AND role = 'client'")[0].n === 1 && w2.d.q("SELECT username FROM login_people")[0].username === "acmepools", "owner: the existing client_logins owner row is linked, no second row");
  ok(w2.d.q("SELECT password_hash FROM client_logins WHERE username = 'acmepools'")[0].password_hash === "pbkdf2$x$y$z", "owner: the existing password is left exactly as it was");
  // Owner with no number: clear bilingual error asking for one.
  w2.state.user = { role: "alice", display_name: "Alice" };
  const none = await w2.F.passkeyRoute(rq("POST", "/api/gm/clients/c2/owner-invite", {}), w2.env, "/api/gm/clients/c2/owner-invite", "POST");
  ok(none.status === 400 && none.need_phone === true && /Type the number/.test(none.error_en) && /Digite o número/.test(none.error_pt), "owner-invite: no usable number asks the admin to type one (bilingual)");
  // Change E: a +55 number needs PASSKEY_WHATSAPP_ENABLED="1" now (tested in
  // scripts/test-whatsapp-channel.mjs); here a +1 number keeps testing the
  // original point (language follows the client's saved language).
  const typed = await w2.F.passkeyRoute(rq("POST", "/api/gm/clients/c2/owner-invite", { phone: "+1 786 555 0199" }), w2.env, "/api/gm/clients/c2/owner-invite", "POST");
  ok(typed.status === 200 && /0199$/.test(typed.data.masked_phone), "owner-invite: a typed number is accepted");
  ok(/^Hi Ana!/.test(typed.data.message) && typed.data.message.indexOf("Olá") === -1, "owner-invite: message follows the client's saved language (en)");
  w2.state.user = OWNER;
  const notAdmin = await w2.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/owner-invite", {}), w2.env, "/api/gm/clients/c1/owner-invite", "POST");
  ok(notAdmin.status === 403, "owner-invite: an owner session is refused (admin roles only)");
}

// ── 7. Old password login vs PASSKEY_ONLY ──────────────────────────────────
{
  const w = world();
  w.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role, seller_name) VALUES ('pk-abc12345', 'c1', 'PASSKEY_ONLY', 0, 'staff', 'Pat')").run();
  let threw = false, res;
  try { res = await w.F.handlePostClientLogin(rq("POST", "/api/auth/client-login", { username: "pk-abc12345", password: "PASSKEY_ONLY" }), w.env); } catch (e) { threw = true; }
  ok(!threw && res.status === 401 && res.error === "Usuário ou senha inválidos", "old login: a PASSKEY_ONLY row is refused with the normal 401, nothing thrown (even typing the literal)");
  const unknown = await w.F.handlePostClientLogin(rq("POST", "/api/auth/client-login", { username: "nobody", password: "x" }), w.env);
  ok(unknown.status === res.status && unknown.error === res.error, "old login: identical answer to an unknown username");
  ok(await w.F.verifyPassword("anything", "PASSKEY_ONLY") === false, "verifyPassword('PASSKEY_ONLY') is false without throwing");
  ok(w.d.q("SELECT COUNT(*) AS n FROM client_auth_tokens")[0].n === 0, "old login: no session minted");
}

// ── 8. Passkey sign-in ─────────────────────────────────────────────────────
{
  const w = world();
  const r = await addPerson(w, "staff_finance", "4075550111", "Sam Cruz");
  const t = tokenOf(r.data.invite_url);
  await completeInvite(w, t, "reg-s1");
  const st = await w.F.passkeyRoute(rq("POST", "/api/passkey-login/start"), w.env, "/api/passkey-login/start", "POST");
  const sc = w.state.calls.filter((c) => c.path === "/v1/webauthn/authenticate/start")[0];
  ok(st.status === 200 && st.data.options.challenge && st.data.rp_id === "apex.resonateai.online" && sc.body.domain === "apex.resonateai.online" && !("user_id" in sc.body) && sc.body.use_base64_url_encoding === true && sc.body.return_passkey_credential_options === true, "start: authenticate/start with domain and both options, NO user_id; options returned");
  const good = await finish(w, JSON.stringify({ id: "x", user: "user-0111", reg: "reg-s1" }));
  ok(good.status === 200 && /^capt_/.test(good.data.token) && Object.keys(good.data).sort().join(",") === "client_id,client_name,must_change_password,token", "finish: active person + unrevoked registration -> a normal session");
  ok(!!w.d.q("SELECT last_passkey_login_at FROM login_people")[0].last_passkey_login_at, "finish: last_passkey_login_at stamped");
  const unknownReg = await finish(w, { id: "x", user: "user-0111", reg: "reg-nope" });
  const wrongUser = await finish(w, { id: "x", user: "user-9999", reg: "reg-s1" });
  const stytchNo = await finish(w, { id: "x", bad: true });
  const empty = await finish(w, null);
  ok([unknownReg, wrongUser, stytchNo, empty].every((x) => x.status === 401 && x.error_en === unknownReg.error_en), "finish: unknown registration, wrong Stytch user, Stytch refusal and empty credential all answer the same generic 401");
  w.d.raw.prepare("UPDATE login_passkeys SET revoked_at = '2026-01-01'").run();
  const revoked = await finish(w, { id: "x", user: "user-0111", reg: "reg-s1" });
  ok(revoked.status === 401 && revoked.error_en === unknownReg.error_en, "finish: a revoked registration is refused generically");
  w.d.raw.prepare("UPDATE login_passkeys SET revoked_at = NULL").run();
  w.d.raw.prepare("UPDATE login_people SET status = 'disabled'").run();
  const disabled = await finish(w, { id: "x", user: "user-0111", reg: "reg-s1" });
  ok(disabled.status === 401 && disabled.error_en === unknownReg.error_en, "finish: a disabled person is refused generically");
  // invited (never accepted) people cannot sign in either
  w.d.raw.prepare("UPDATE login_people SET status = 'invited'").run();
  ok((await finish(w, { id: "x", user: "user-0111", reg: "reg-s1" })).status === 401, "finish: an invited (not active) person is refused");
  // IP rate limit before Stytch
  const w2 = world();
  let last;
  for (let i = 0; i < 31; i++) { last = await w2.F.passkeyRoute(rq("POST", "/api/passkey-login/start", {}, "5.5.5.5"), w2.env, "/api/passkey-login/start", "POST"); }
  ok(last.status === 429 && w2.state.calls.length === 30, "sign-in: the 31st attempt from one IP in an hour is refused BEFORE calling Stytch");
}

// ── 9. Invite purposes (Change A): 'add' keeps both devices, 'replace' revokes ──
{
  // Default purpose for a re-invite is now 'add' (Change A) -- a person with
  // a phone AND a laptop keeps both. Only an explicit 'replace' (new or lost
  // device) revokes the older passkey once it completes.
  const w = world();
  const r = await addPerson(w, "seller", "4075550112", "Rui Lima");
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-old");
  w.state.user = OWNER;
  const pid = r.data.person.id;
  const re = await w.F.passkeyRoute(rq("POST", "/api/gm/people/" + pid + "/invite"), w.env, "/api/gm/people/" + pid + "/invite", "POST");
  // created_at can tie to the same millisecond as the first invite under a
  // fast clock, so order by rowid (insertion order), not created_at, to find
  // the invite this call just made.
  ok(re.data.person && w.d.q("SELECT purpose FROM login_invites ORDER BY rowid DESC LIMIT 1")[0].purpose === "add", "re-invite: no purpose given defaults to 'add'");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_passkeys WHERE revoked_at IS NULL")[0].n === 1, "re-invite ('add'): the old passkey still works until the new invite is completed");
  w.state.clockMs += 61000;
  await completeInvite(w, tokenOf(re.data.invite_url), "reg-new");
  const keys = w.d.q("SELECT webauthn_registration_id, revoked_at FROM login_passkeys ORDER BY created_at");
  ok(!keys.find((k) => k.webauthn_registration_id === "reg-old").revoked_at && !keys.find((k) => k.webauthn_registration_id === "reg-new").revoked_at, "re-invite ('add'): completing it keeps BOTH passkeys (phone and laptop)");
  ok((await finish(w, { id: "x", user: "user-0112", reg: "reg-old" })).status === 200 && (await finish(w, { id: "x", user: "user-0112", reg: "reg-new" })).status === 200, "re-invite ('add'): both devices sign in");
  ok(w.d.q("SELECT COUNT(*) AS n FROM client_logins WHERE client_id = 'c1'")[0].n === 1, "re-invite: the same client_logins row is reused (no second login)");

  // An explicit 'replace' invite (lost or new device) DOES revoke the older
  // passkey(s), once it completes.
  const w2 = world();
  const r2 = await addPerson(w2, "seller", "4075550212", "Rui Lima 2");
  await completeInvite(w2, tokenOf(r2.data.invite_url), "reg-old2");
  w2.state.user = OWNER;
  const pid2 = r2.data.person.id;
  const re2 = await w2.F.passkeyRoute(rq("POST", "/api/gm/people/" + pid2 + "/invite", { purpose: "replace" }), w2.env, "/api/gm/people/" + pid2 + "/invite", "POST");
  ok(re2.data.invite_url, "re-invite ('replace'): accepted");
  w2.state.clockMs += 61000;
  await completeInvite(w2, tokenOf(re2.data.invite_url), "reg-new2");
  const keys2 = w2.d.q("SELECT webauthn_registration_id, revoked_at FROM login_passkeys ORDER BY created_at");
  ok(keys2.find((k) => k.webauthn_registration_id === "reg-old2").revoked_at && !keys2.find((k) => k.webauthn_registration_id === "reg-new2").revoked_at, "re-invite ('replace'): completing it revokes the OLDER passkey");
  ok((await finish(w2, { id: "x", user: "user-0212", reg: "reg-old2" })).status === 401 && (await finish(w2, { id: "x", user: "user-0212", reg: "reg-new2" })).status === 200, "re-invite ('replace'): old device refused, new device signs in");

  // An unknown purpose value is a clear 400.
  const bad = await w2.F.passkeyRoute(rq("POST", "/api/gm/people/" + pid2 + "/invite", { purpose: "whatever" }), w2.env, "/api/gm/people/" + pid2 + "/invite", "POST");
  ok(bad.status === 400, "invite: an unknown purpose value is refused");
}

// ── 10. Disable kills sessions at once; enable only after acceptance ───────
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550113", "Dee Ford");
  const done = await completeInvite(w, tokenOf(r.data.invite_url), "reg-d");
  ok(!!(await w.F.authenticateClientToken(done.data.token, w.env)), "(setup) session valid before disable");
  w.state.user = OWNER;
  const pid = r.data.person.id;
  const dis = await w.F.passkeyRoute(rq("POST", "/api/gm/people/" + pid + "/disable"), w.env, "/api/gm/people/" + pid + "/disable", "POST");
  ok(dis.status === 200 && dis.data.person.status === "disabled", "disable: status disabled");
  ok((await w.F.authenticateClientToken(done.data.token, w.env)) === null && w.d.q("SELECT COUNT(*) AS n FROM client_auth_tokens")[0].n === 0, "disable: the open session dies at once");
  const en = await w.F.passkeyRoute(rq("POST", "/api/gm/people/" + pid + "/enable"), w.env, "/api/gm/people/" + pid + "/enable", "POST");
  ok(en.status === 200 && en.data.person.status === "active", "enable: back to active (had accepted)");
  const r2 = await addPerson(w, "staff", "4075550114", "New Hire");
  const en2 = await w.F.passkeyRoute(rq("POST", "/api/gm/people/" + r2.data.person.id + "/enable"), w.env, "/api/gm/people/" + r2.data.person.id + "/enable", "POST");
  ok(en2.status === 409, "enable: refused for someone who never completed an invite");
}

// ── 11. Invite message wording ─────────────────────────────────────────────
{
  const w = world({ PASSKEY_APP_READY: "" });
  const r = await addPerson(w, "staff", "4075550115", "Carla Dias");
  const m = r.data.message;
  ok(r.data.app_ready === false, "app_ready false when PASSKEY_APP_READY is not \"1\"");
  ok(m.indexOf(r.data.invite_url) !== -1 && /72 horas/.test(m) && /72 hours/.test(m), "not-ready message: link and the 72-hour note, both languages");
  ok(/^Olá Carla! Maria Silva convidou você para entrar no Apex \(Acme Pools\)/.test(m) && m.indexOf("Hi Carla!") > m.indexOf("Olá"), "unknown recipient language: Portuguese first, English below");
  ok(/funciona só no site por enquanto/.test(m) && /works only on the website for now/.test(m), "not-ready message: website-only warning in both languages");
  ok(m.indexOf("apps.apple.com") === -1 && !/app\s*store/i.test(m), "not-ready message contains NO app link");
  const w2 = world({ PASSKEY_APP_READY: "1" });
  const r2 = await addPerson(w2, "staff", "4075550116", "Carla Dias");
  const m2 = r2.data.message;
  ok(r2.data.app_ready === true && m2.indexOf("https://apps.apple.com/app/id6808500506") !== -1, "ready message carries the App Store link");
  ok(m2.indexOf("só no site") === -1 && m2.indexOf("website for now") === -1 && /Depois de criar a passkey/.test(m2) && /After you create your passkey/.test(m2), "ready message drops the website-only warning, adds the app line in both languages");
  ok(r2.data.message_en.indexOf("—") === -1, "English wording has no em dash");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
