// The WhatsApp channel (Change E): the REAL Worker functions on an
// in-memory SQLite, with fake Stytch and Telegram.
//
//   node scripts/test-whatsapp-channel.mjs
import { createHash } from "node:crypto";
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

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
  "PASSKEY_TRUSTED_COUNTRIES_DEFAULT", "LOGIN_FINANCE_VIEW_RE", "LOGIN_CLIENT_ROUTE_RE", "PASSKEY_SENSITIVE_KINDS",
  "REQUEST_CTX"
];

const BASE_TABLES = [
  "CREATE TABLE client_logins (username TEXT PRIMARY KEY, client_id TEXT NOT NULL, password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 1, tracking_start TEXT, password_changed_at TEXT, last_login_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), work_schedule TEXT, created_by TEXT, role TEXT NOT NULL DEFAULT 'client', seller_name TEXT, UNIQUE (client_id, seller_name))",
  "CREATE TABLE client_auth_tokens (token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, username TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  "CREATE TABLE client_login_attempts (id TEXT PRIMARY KEY, username TEXT, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
];

function fakeStytch(state) {
  return async function fetch(url, init) {
    const u = new URL(url);
    const body = JSON.parse(init.body || "{}");
    state.calls.push({ host: u.host, path: u.pathname, body });
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
    switch (u.pathname) {
      case "/v1/otps/sms/login_or_create":
      case "/v1/otps/whatsapp/login_or_create":
        return reply(200, { user_id: state.userFor[body.phone_number] || "user-" + body.phone_number.slice(-4), phone_id: "phone-" + body.phone_number.slice(-4) });
      case "/v1/otps/authenticate":
        return body.code === "123456" ? reply(200, { user_id: "user-" + body.method_id.slice(-4), method_id: body.method_id }) : reply(401, {});
    }
    return reply(404, {});
  };
}

function world(envOverrides) {
  const d = makeDb(["migrations/passkey_login.sql"]);
  BASE_TABLES.forEach((s) => d.raw.exec(s));
  d.raw.prepare("INSERT INTO clients (id, name, owners, whatsapp, phone, language) VALUES ('c1', 'Acme Pools', 'Maria Silva', '(407) 555-0101', NULL, 'pt')").run();
  d.raw.prepare("INSERT INTO clients (id, name, owners, whatsapp, phone, language) VALUES ('c2', 'Brasil Co', 'Ana', '+55 11 98765 4321', NULL, 'pt')").run();
  const state = { calls: [], telegram: [], userFor: {}, clockMs: Date.now(), user: null };
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
  const env = Object.assign({ DB: d.DB, PASSKEY_LOGIN_ENABLED: "1", STYTCH_PROJECT_ID: "x", STYTCH_SECRET: "y" }, envOverrides || {});
  return { d, F, env, state };
}
function rq(method, path, body, ip) {
  return { method, url: "https://apex-api.test" + path, headers: { get: (k) => (k === "CF-Connecting-IP" ? (ip || "1.1.1.1") : null) }, json: async () => body || {} };
}
const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "Acme Pools", auth_method: "password" };
const tokenOf = (url) => url.split("?t=")[1];
async function addPerson(w, phone, name, clientId) {
  w.state.user = clientId === "c2" ? { role: "client", client_id: "c2", login_role: "client", display_name: "Brasil Co", auth_method: "password" } : OWNER;
  return w.F.passkeyRoute(rq("POST", "/api/gm/people", { name, role: "staff", phone }), w.env, "/api/gm/people", "POST");
}
async function send(w, t, ip) { return w.F.passkeyRoute(rq("POST", "/api/passkey-invite/send-code", { t }, ip), w.env, "/api/passkey-invite/send-code", "POST"); }

// ── 1. +1 uses SMS, +55 uses WhatsApp, with no choice ───────────────────────
{
  const w = world();
  ok(await w.F.passkeyChannelFor("+14075550001") === "sms", "channel: +1 always resolves to SMS");
  ok(await w.F.passkeyChannelFor("+5511987654321") === "whatsapp", "channel: +55 always resolves to WhatsApp, no choice");
}

// ── 2. WhatsApp off: a +55 number is refused at person creation, owner invite and send-code ──
{
  const w = world({ PASSKEY_WHATSAPP_ENABLED: "" });
  const created = await addPerson(w, "+5511987654321", "Bia Souza");
  ok(created.status === 400 && /WhatsApp/.test(created.error_en) && /WhatsApp/.test(created.error_pt), "person creation: a +55 number is refused with the clear bilingual message while WhatsApp is off");

  w.state.user = { role: "developer", display_name: "Nicole" };
  const ownerInvite = await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c2/owner-invite", {}), w.env, "/api/gm/clients/c2/owner-invite", "POST");
  ok(ownerInvite.status === 400 && /WhatsApp/.test(ownerInvite.error_en), "owner invite: a business whose only number is +55 is refused with the same message while WhatsApp is off");

  // Build an invite directly against the DB to test the send-code path (a
  // +55 number that somehow already has an invite, e.g. created before the
  // flag was turned off) -- it must answer the generic "try again later",
  // never a hint.
  w.d.raw.prepare("INSERT INTO login_people (id, client_id, role, display_name, phone_e164, status, created_at) VALUES ('pbr', 'c1', 'staff', 'Later BR', '+5511999998888', 'invited', datetime('now'))").run();
  const invite = await w.F.passkeyCreateInvite(w.env, "pbr", "first");
  const sendRes = await send(w, invite.invite_url.split("?t=")[1]);
  ok(sendRes.status === 429 && /later|mais tarde/i.test(sendRes.error_en + sendRes.error_pt), "send-code: a +55 number is refused with the generic try-again-later while WhatsApp is off");
  ok(w.state.calls.length === 0, "send-code: no Stytch call made for a +55 number while WhatsApp is off");
}

// ── 3. WhatsApp on: the WhatsApp endpoint is called with the right payload, same caps/alerts/cooldown/failures apply ──
{
  const w = world({ PASSKEY_WHATSAPP_ENABLED: "1" });
  const created = await addPerson(w, "+5511987654321", "Bia Souza");
  ok(created.status === 200, "WhatsApp on: a +55 person can be created");
  const t = tokenOf(created.data.invite_url);
  const sendRes = await send(w, t);
  ok(sendRes.status === 200, "WhatsApp on: send-code succeeds for a +55 number");
  const waCall = w.state.calls.find((c) => c.path === "/v1/otps/whatsapp/login_or_create");
  ok(!!waCall, "the WhatsApp one-time-code endpoint is called");
  ok(waCall.body.phone_number === "+5511987654321" && waCall.body.locale === "pt-br" && waCall.body.expiration_minutes === 5, "the WhatsApp call carries the stored number, pt-br locale and the usual code expiry");

  // Same cooldown applies.
  const cooldownRes = await send(w, t);
  ok(cooldownRes.status === 429, "WhatsApp on: the same 60-second cooldown applies");

  // Same 5-failure verify limit applies.
  w.state.clockMs += 61000;
  let last;
  for (let i = 0; i < 5; i++) { last = await w.F.passkeyRoute(rq("POST", "/api/passkey-invite/verify-code", { t, code: "000000" }), w.env, "/api/passkey-invite/verify-code", "POST"); }
  ok(last.status === 404 && last.restart === true, "WhatsApp on: the same 5-failure verify limit kills the link");
}

// ── 4. The separate WhatsApp daily cap and its own alert text ───────────────
{
  const w = world({ PASSKEY_WHATSAPP_ENABLED: "1", PASSKEY_WHATSAPP_DAILY_CAP: "4" });
  const toks = [];
  for (let i = 0; i < 5; i++) {
    const r = await addPerson(w, "+551198765432" + i, "Person " + i);
    toks.push(tokenOf(r.data.invite_url));
  }
  const results = [];
  for (let i = 0; i < 5; i++) { results.push((await send(w, toks[i], "8.8.8." + i)).status); }
  ok(results.slice(0, 4).every((s) => s === 200) && results[4] === 429, "WhatsApp daily cap: the 5th send app-wide is refused when PASSKEY_WHATSAPP_DAILY_CAP=4");
  ok(w.state.telegram.some((m) => /WhatsApp/.test(m) && /half/.test(m)) && w.state.telegram.some((m) => /WhatsApp/.test(m) && /daily cap/.test(m)), "WhatsApp cap: the alert text names WhatsApp specifically (own message text)");

  // An SMS (+1) daily cap is tracked completely separately.
  const w2 = world({ PASSKEY_SMS_DAILY_CAP: "100", PASSKEY_WHATSAPP_ENABLED: "1", PASSKEY_WHATSAPP_DAILY_CAP: "2" });
  const r1 = await addPerson(w2, "+5511999990001", "BR A");
  const r2 = await addPerson(w2, "4075550099", "US A");
  await send(w2, tokenOf(r1.data.invite_url), "9.1.1.1");
  const usSend = await send(w2, tokenOf(r2.data.invite_url), "9.1.1.2");
  ok(usSend.status === 200, "an SMS (+1) send is unaffected by a near-exhausted WhatsApp cap (separate counters)");
}

// ── 5. The info route returns the channel ───────────────────────────────────
{
  const w = world({ PASSKEY_WHATSAPP_ENABLED: "1" });
  const r1 = await addPerson(w, "4075550088", "US Info");
  const info1 = await w.F.passkeyRoute(rq("GET", "/api/passkey-invite/info?t=" + encodeURIComponent(tokenOf(r1.data.invite_url))), w.env, "/api/passkey-invite/info", "GET");
  ok(info1.data.channel === "sms", "info route: a +1 invite reports channel 'sms'");
  const r2 = await addPerson(w, "+5511988887777", "BR Info");
  const info2 = await w.F.passkeyRoute(rq("GET", "/api/passkey-invite/info?t=" + encodeURIComponent(tokenOf(r2.data.invite_url))), w.env, "/api/passkey-invite/info", "GET");
  ok(info2.data.channel === "whatsapp", "info route: a +55 invite reports channel 'whatsapp'");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
