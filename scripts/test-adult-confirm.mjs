// Adults only and business use confirmation: the REAL Worker functions on an
// in-memory SQLite with a FAKE Stytch fetch. No network, no production database.
//
//   node scripts/test-adult-confirm.mjs
import { createHash } from "node:crypto";
import { makeDb, build, baseStubs, hasFn } from "./fixtures/d1-shim.mjs";

import { workerSrc } from "./fixtures/d1-shim.mjs";
const hasVar = (v) => workerSrc.indexOf("\nvar " + v + " =") >= 0;
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
  "sendCounterRead", "sendCounterIncrement", "sendCounterDayKey", "sendCounterMonthKey", "sendCounterMaybeAlert", "sendCounterMonthlyCap", "sendCounterMonthlyBlocked", "passkeySmsMonthlyCap", "reminderSmsDailyCap", "reminderSmsMonthlyCap", "easternDateStr",
  "adultConfirmEnabled", "adultConfirmUserKey", "adultConfirmNeeded", "adultConfirmRecord", "handlePostMeAdultConfirm", "handleGetRole", "meLanguageResolve",
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
  "PASSKEY_TRUSTED_COUNTRIES_DEFAULT", "LOGIN_FINANCE_VIEW_RE", "LOGIN_CLIENT_ROUTE_RE", "PASSKEY_SENSITIVE_KINDS",
  "REQUEST_CTX", "TERMS_VERSION", "ADULT_CONFIRM_KIND", "PUBLIC_LIMIT_MESSAGE"
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
  const d = makeDb(["migrations/passkey_login.sql", "migrations/2026-11-05_terms_acceptances.sql"]);
  BASE_TABLES.forEach((s) => d.raw.exec(s));
  d.raw.exec("CREATE TABLE IF NOT EXISTS send_counters (bucket TEXT NOT NULL, period_key TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, updated_at TEXT, PRIMARY KEY (bucket, period_key))");
  d.raw.exec("CREATE TABLE IF NOT EXISTS send_counter_alerts (bucket TEXT NOT NULL, period_key TEXT NOT NULL, threshold TEXT NOT NULL, sent_at TEXT, PRIMARY KEY (bucket, period_key, threshold))");
  d.raw.prepare("INSERT INTO clients (id, name, owners, whatsapp, phone, language) VALUES ('c1', 'Acme Pools', 'Maria Silva, Joao', '(407) 555-0101', NULL, 'pt')").run();
  d.raw.prepare("INSERT INTO clients (id, name, owners, whatsapp, phone, language) VALUES ('c2', 'Other Co', 'Ana', NULL, NULL, 'en')").run();
  const state = { calls: [], telegram: [], userFor: {}, down: false, clockMs: Date.now(), user: null };
  const stubs = Object.assign({}, baseStubs, {
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status || 400, error: en, error_pt: pt, error_en: en }, extra || {}),
    fetch: fakeStytch(state),
    notifyNicoleTelegram: async (env, msg) => { state.telegram.push(msg); },
    publicReadRateLimited: () => state.limited === true,
    passkeyNow: () => new Date(state.clockMs),
    authenticate: async () => state.user,
    actorName: (u) => (u && (u.display_name || u.role)) || null,
    docPdfRenderSession: async () => null
  });
  const F = build(FNS.filter(hasFn), VARS.filter((v) => hasVar(v)), stubs);
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

async function section(fn) {
  try { await fn(); } catch (e) { ok(false, "section crashed: " + (e && e.message)); }
}
// ── helpers for this file ──────────────────────────────────────────────────
async function registerA(w, t, adult, extra) {
  const body = Object.assign({ t, credential: { id: "cred", reg: "reg-" + Math.random().toString(16).slice(2, 8) } }, extra || {});
  if (adult !== undefined) { body.adult_confirmed = adult; }
  return w.F.passkeyRoute(rq("POST", "/api/passkey-invite/register", body), w.env, "/api/passkey-invite/register", "POST");
}
async function readyInvite(w) {
  const r = await addPerson(w, "partner", "4075550109", "Paula Reis");
  const t = tokenOf(r.data.invite_url);
  await send(w, t);
  const v = await verify(w, t, "123456");
  if (v.status !== 200) { throw new Error("verify failed " + JSON.stringify(v)); }
  return t;
}
const rows = (w) => w.d.q("SELECT * FROM terms_acceptances");
const confirmReq = (body) => rq("POST", "/api/me/adult-confirm", body);
const OWNER_SESSION = { role: "client", client_id: "c1", username: "owner1", login_role: "client", display_name: "Acme Pools", auth_method: "password" };
const STAFF_SESSION = { role: "alice", email: "alice@apex.test", display_name: "Alice", client_id: null, auth_method: "google" };

// ── 1. register refuses without adult_confirmed, accepts true ──────────────
await section(async () => {
  const w = world();
  const t = await readyInvite(w);
  const missing = await registerA(w, t, undefined);
  ok(missing.status === 400, "register: no adult_confirmed in the body is refused with 400");
  ok(/reload/i.test(missing.error_en || "") && /recarregue/i.test(missing.error_pt || ""), "register: the generic message asks the person to reload the page (EN and PT)");
  const falsy = await registerA(w, t, false);
  ok(falsy.status === 400, "register: adult_confirmed false is refused with 400");
  const str = await registerA(w, t, "true");
  ok(str.status === 400, "register: the text \"true\" (not boolean true) is refused with 400");
  const one = await registerA(w, t, 1);
  ok(one.status === 400, "register: the number 1 is refused with 400");
  ok(w.state.calls.every((c) => c.path !== "/v1/webauthn/register"), "register: Stytch is never asked to create a passkey while unconfirmed");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_passkeys")[0].n === 0 && rows(w).length === 0, "register: no passkey row and no acceptance row after the refusals");
  ok(!w.d.q("SELECT used_at FROM login_invites")[0].used_at, "register: the invite stays unused, so the person can reload and retry");
  const good = await registerA(w, t, true);
  ok(good.status === 200 && /^capt_/.test(good.data.token), "register: adult_confirmed true creates the passkey and the session");
  const r = rows(w);
  const person = w.d.q("SELECT username FROM login_people")[0];
  ok(r.length === 1 && r[0].kind === "adult_business" && r[0].source === "invite" && r[0].terms_version === "2026-11-05" && r[0].client_id === "c1", "register: one terms_acceptances row, kind adult_business, source invite, version 2026-11-05, client c1");
  ok(r[0].user_id === "l:" + person.username, "register: user_id comes from the stored login record (l:<username>)");
  ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(r[0].accepted_at), "register: accepted_at is a UTC timestamp");
  ok(Object.keys(r[0]).sort().join(",") === "accepted_at,client_id,id,kind,source,terms_version,user_id", "acceptance row stores no birthdate and no other personal data (only 7 columns)");
});

// ── 2. register keeps the confirmation even when the switch for existing users is off ──
await section(async () => {
  const w = world({ ADULT_CONFIRM_EXISTING_USERS: "off" });
  const t = await readyInvite(w);
  const missing = await registerA(w, t, undefined);
  ok(missing.status === 400, "switch off: register STILL refuses a missing adult_confirmed (the switch only controls the existing user card)");
  const good = await registerA(w, t, true);
  ok(good.status === 200 && rows(w).length === 1 && rows(w)[0].source === "invite", "switch off: register with true still works and still records the acceptance");
});

// ── 3. the confirm route for existing users ────────────────────────────────
await section(async () => {
  const w = world();
  w.state.user = null;
  const anon = await w.F.handlePostMeAdultConfirm(confirmReq({ confirmed: true }), w.env);
  ok(anon.status === 401 && rows(w).length === 0, "confirm: not signed in returns 401 and writes nothing");

  w.state.user = OWNER_SESSION;
  const bad = await w.F.handlePostMeAdultConfirm(confirmReq({}), w.env);
  ok(bad.status === 400 && rows(w).length === 0, "confirm: a body without confirmed true is 400 and writes nothing");
  const bad2 = await w.F.handlePostMeAdultConfirm(confirmReq({ confirmed: "yes" }), w.env);
  ok(bad2.status === 400 && rows(w).length === 0, "confirm: confirmed must be boolean true (the text yes is 400)");

  const first = await w.F.handlePostMeAdultConfirm(confirmReq({ confirmed: true, user_id: "l:someone-else", client_id: "c2", kind: "other", source: "invite", terms_version: "1999" }), w.env);
  const r = rows(w);
  ok(first.status === 200 && r.length === 1, "confirm: signed in with confirmed true writes one row");
  ok(r[0].user_id === "l:owner1" && r[0].client_id === "c1" && r[0].kind === "adult_business" && r[0].source === "existing" && r[0].terms_version === "2026-11-05", "confirm: user, client, kind, source and version come from the session and the Worker, never from the body");
  const again = await w.F.handlePostMeAdultConfirm(confirmReq({ confirmed: true }), w.env);
  const again2 = await w.F.handlePostMeAdultConfirm(confirmReq({ confirmed: true }), w.env);
  ok(again.status === 200 && again2.status === 200 && rows(w).length === 1, "confirm: a repeated call never writes a second row (INSERT OR IGNORE)");

  w.state.user = STAFF_SESSION;
  const staff = await w.F.handlePostMeAdultConfirm(confirmReq({ confirmed: true }), w.env);
  const sr = rows(w).filter((x) => x.user_id === "u:alice@apex.test");
  ok(staff.status === 200 && sr.length === 1 && sr[0].client_id === null && sr[0].source === "existing", "confirm: a staff session is recorded too (u:<email>, no client)");

  w.state.user = { role: "client", client_id: "c1", username: "owner2", login_role: "seller", seller_name: "Ana", auth_method: "password" };
  w.state.limited = true;
  const limited = await w.F.handlePostMeAdultConfirm(confirmReq({ confirmed: true }), w.env);
  ok(limited.status === 429 && !rows(w).some((x) => x.user_id === "l:owner2"), "confirm: over the rate limit returns 429 and writes nothing");
  w.state.limited = false;
  w.state.user = { role: "vault-service", scope: "vault", display_name: "x", client_id: null };
  const svc = await w.F.handlePostMeAdultConfirm(confirmReq({ confirmed: true }), w.env);
  ok(svc.status === 403, "confirm: a service token (no person) returns 403");
});

// ── 4. who sees the card, and the switch ───────────────────────────────────
await section(async () => {
  const w = world();
  ok(await w.F.adultConfirmNeeded(w.env, OWNER_SESSION) === true, "card: shown to an existing owner with no acceptance on file");
  ok(await w.F.adultConfirmNeeded(w.env, STAFF_SESSION) === true, "card: shown to staff too");
  w.state.user = OWNER_SESSION;
  await w.F.handlePostMeAdultConfirm(confirmReq({ confirmed: true }), w.env);
  ok(await w.F.adultConfirmNeeded(w.env, OWNER_SESSION) === false, "card: never shown again after Confirm and continue");
  ok(await w.F.adultConfirmNeeded(w.env, STAFF_SESSION) === true, "card: still owed by the other person");
  w.d.raw.exec("UPDATE terms_acceptances SET terms_version = '2026-01-01'");
  ok(await w.F.adultConfirmNeeded(w.env, OWNER_SESSION) === true, "card: shown again if the terms version changes");

  const off = world({ ADULT_CONFIRM_EXISTING_USERS: "off" });
  ok(await off.F.adultConfirmNeeded(off.env, OWNER_SESSION) === false, "switch: the text off turns the existing user card off");
  const off2 = world({ ADULT_CONFIRM_EXISTING_USERS: " OFF " });
  ok(await off2.F.adultConfirmNeeded(off2.env, STAFF_SESSION) === false, "switch: off is read ignoring case and spaces");
  for (const v of ["", "on", "0", "false", "no", undefined]) {
    const on = world(v === undefined ? {} : { ADULT_CONFIRM_EXISTING_USERS: v });
    ok(await on.F.adultConfirmNeeded(on.env, OWNER_SESSION) === true, "switch: " + JSON.stringify(v) + " keeps the card ON (only the text off disables it)");
  }
  const offRole = world({ ADULT_CONFIRM_EXISTING_USERS: "off" });
  offRole.state.user = OWNER_SESSION;
  const rr = await offRole.F.handleGetRole(rq("GET", "/api/role"), offRole.env);
  ok(rr.status === 200 && rr.data.adult_confirm_needed === false, "switch off: /api/role reports adult_confirm_needed false");
  const onRole = world();
  onRole.state.user = OWNER_SESSION;
  const ro = await onRole.F.handleGetRole(rq("GET", "/api/role"), onRole.env);
  ok(ro.status === 200 && ro.data.adult_confirm_needed === true && ro.data.role === "client", "switch on: /api/role reports adult_confirm_needed true and keeps its other fields");
  const offConfirm = world({ ADULT_CONFIRM_EXISTING_USERS: "off" });
  offConfirm.state.user = OWNER_SESSION;
  const oc = await offConfirm.F.handlePostMeAdultConfirm(confirmReq({ confirmed: true }), offConfirm.env);
  ok(oc.status === 200, "switch off: the confirm route itself is untouched (only the card is off)");
});

// ── 5. the gates let signed-in people reach the route ──────────────────────
await section(async () => {
  const w = world();
  ok(w.F.clientRequestAllowed("/api/me/adult-confirm", "POST", "c1") === true, "gate: an owner session may POST /api/me/adult-confirm");
  ok(w.F.sellerRequestAllowed("/api/me/adult-confirm", "POST", "c1") === true, "gate: a seller session may POST /api/me/adult-confirm");
  ok(w.F.clientRequestAllowed("/api/me/adult-confirm", "GET", "c1") === false, "gate: GET is not allowed");
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
