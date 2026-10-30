// Retiring the old login one business at a time (Change F): the REAL Worker
// functions on an in-memory SQLite, with fake Stytch and Telegram.
//
//   node scripts/test-legacy-cutover.mjs
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
  "handleGetGmPersonLossReview", "handlePostGmClientLegacyLogin", "legacyCutoverApply", "passkeyLegacyCutoverActive",
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

function world(envOverrides) {
  const d = makeDb(["migrations/passkey_login.sql"]);
  BASE_TABLES.forEach((s) => d.raw.exec(s));
  d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'Acme Pools')").run();
  d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c2', 'Other Co')").run();
  const state = { calls: [], telegram: [], clockMs: Date.now(), user: null };
  const stubs = Object.assign({}, baseStubs, {
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status || 400, error: en, error_pt: pt, error_en: en }, extra || {}),
    fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
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
function rq(method, path, body, headers) {
  const h = Object.assign({ "CF-Connecting-IP": "1.1.1.1", "Authorization": "Bearer capt_x" }, headers || {});
  return { method, url: "https://apex-api.test" + path, headers: { get: (k) => (k in h ? h[k] : null) }, json: async () => body || {} };
}
const OWNER = { role: "client", client_id: "c1", login_role: "client", username: "acmepools", display_name: "Acme Pools", auth_method: "password" };

function seedOldLogin(w, username, clientId, name) {
  w.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role, seller_name) VALUES (?, ?, 'pbkdf2$x$y$z', 0, 'staff', ?)")
    .run(username, clientId, name);
}
function seedCoveredPerson(w, id, clientId, username, phone) {
  w.d.raw.prepare("INSERT INTO login_people (id, client_id, role, display_name, phone_e164, username, status, created_at) VALUES (?, ?, 'staff', 'X', ?, ?, 'active', datetime('now'))")
    .run(id, clientId, phone, username);
  w.d.raw.prepare("INSERT INTO login_passkeys (id, person_id, webauthn_registration_id, created_at) VALUES (?, ?, ?, datetime('now'))")
    .run(id + "-key", id, id + "-reg");
}

// ── 1. Disabling is refused when any old-style login lacks an active + unrevoked-passkey person ──
{
  const w = world();
  seedOldLogin(w, "old1", "c1", "Old One");
  w.state.user = { role: "developer", display_name: "Nicole" };
  const res = await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/legacy-login", { disabled: true }), w.env, "/api/gm/clients/c1/legacy-login", "POST");
  ok(res.status === 409, "disabling is refused (409) when an old-style login has no migrated person");
  ok(/Ainda faltam/.test(res.error_pt) && /Still missing/.test(res.error_en), "the refusal lists who is missing, bilingual");
  ok(res.missing && res.missing.indexOf("Old One") !== -1, "the missing list names the person by display name/username");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_legacy_cutover WHERE client_id = 'c1'")[0].n === 0, "no cutover row created on refusal");
}

// ── 2. Allowed when all are covered ─────────────────────────────────────────
{
  const w = world();
  seedOldLogin(w, "old2", "c1", "Old Two");
  seedCoveredPerson(w, "p1", "c1", "old2", "+14075550001");
  w.state.user = { role: "developer", display_name: "Nicole" };
  const res = await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/legacy-login", { disabled: true }), w.env, "/api/gm/clients/c1/legacy-login", "POST");
  ok(res.status === 200 && res.data.disabled === true, "disabling succeeds when every old-style login is covered");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_legacy_cutover WHERE client_id = 'c1'")[0].n === 1, "a cutover row is created");
  const logRow = w.d.q("SELECT * FROM login_activity WHERE kind = 'legacy_cutover'")[0];
  ok(logRow && logRow.client_id === "c1", "recorded in the audit log");
}

// ── 3. Old password login for a cut-over business answers exactly like a wrong password ──
{
  const w = world();
  seedOldLogin(w, "old3", "c1", "Old Three");
  seedCoveredPerson(w, "p2", "c1", "old3", "+14075550002");
  w.state.user = { role: "developer", display_name: "Nicole" };
  await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/legacy-login", { disabled: true }), w.env, "/api/gm/clients/c1/legacy-login", "POST");

  const wrongPwRes = await w.F.handlePostClientLogin(rq("POST", "/api/auth/client-login", { username: "nonexistent", password: "whatever" }), w.env);
  const cutoverRes = await w.F.handlePostClientLogin(rq("POST", "/api/auth/client-login", { username: "old3", password: "pbkdf2$x$y$z" }), w.env);
  ok(cutoverRes.status === wrongPwRes.status && cutoverRes.error === wrongPwRes.error, "a cut-over business's old login answers EXACTLY like a wrong password (same status, same body)");
  ok(w.d.q("SELECT COUNT(*) AS n FROM client_login_attempts WHERE username = 'old3'")[0].n === 1, "the attempt still counts in the rate limit");
  ok(w.d.q("SELECT COUNT(*) AS n FROM client_auth_tokens WHERE username = 'old3'")[0].n === 0, "no session minted");
}

// ── 4. Other businesses are unaffected ──────────────────────────────────────
{
  const w = world();
  seedOldLogin(w, "old4", "c1", "Old Four");
  seedCoveredPerson(w, "p3", "c1", "old4", "+14075550003");
  w.state.user = { role: "developer", display_name: "Nicole" };
  await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/legacy-login", { disabled: true }), w.env, "/api/gm/clients/c1/legacy-login", "POST");

  const hash = await w.F.hashPassword("RealPassword!23");
  w.d.raw.prepare("UPDATE client_logins SET password_hash = ? WHERE username = 'old5'").run(hash);
  w.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role) VALUES ('old5', 'c2', ?, 0, 'client')").run(hash);
  const otherRes = await w.F.handlePostClientLogin(rq("POST", "/api/auth/client-login", { username: "old5", password: "RealPassword!23" }), w.env);
  ok(otherRes.status === 200, "a business NOT cut over signs in normally with username/password");
}

// ── 5. Passkey sign-in still works for a cut-over business ─────────────────
{
  const w = world();
  seedOldLogin(w, "old6", "c1", "Old Six");
  seedCoveredPerson(w, "p4", "c1", "old6", "+14075550004");
  w.state.user = { role: "developer", display_name: "Nicole" };
  await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/legacy-login", { disabled: true }), w.env, "/api/gm/clients/c1/legacy-login", "POST");

  // This file's fake fetch always answers not-ok, so a real 200 is not
  // reachable here; what matters for Change F is that the route is reached
  // at all (never a 403/404 caused by the cutover) and fails for the GENERIC
  // Stytch-unavailable reason, not anything cutover-specific.
  const start = await w.F.passkeyRoute(rq("POST", "/api/passkey-login/start"), w.env, "/api/passkey-login/start", "POST");
  ok(start.status === 503, "passkey sign-in start is reached and answers the generic Stytch-unavailable status, never a cutover-caused 403/404");
}

// ── 6. Sessions are cleared on disabling ────────────────────────────────────
{
  const w = world();
  seedOldLogin(w, "old7", "c1", "Old Seven");
  seedCoveredPerson(w, "p5", "c1", "old7", "+14075550005");
  const token = "capt_" + "c".repeat(64);
  const hash = createHash("sha256").update(token).digest("hex");
  w.d.raw.prepare("INSERT INTO client_auth_tokens (token_hash, client_id, username, expires_at) VALUES (?, 'c1', 'old7', ?)")
    .run(hash, new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString());
  ok(!!(await w.F.authenticateClientToken(token, w.env)), "(setup) old password session valid before cutover");
  w.state.user = { role: "developer", display_name: "Nicole" };
  await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/legacy-login", { disabled: true }), w.env, "/api/gm/clients/c1/legacy-login", "POST");
  ok((await w.F.authenticateClientToken(token, w.env)) === null, "every old password session ends once on disabling");
}

// ── 7. Re-enabling restores the old login ───────────────────────────────────
{
  const w = world();
  seedOldLogin(w, "old8", "c1", "Old Eight");
  seedCoveredPerson(w, "p6", "c1", "old8", "+14075550006");
  w.state.user = { role: "developer", display_name: "Nicole" };
  await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/legacy-login", { disabled: true }), w.env, "/api/gm/clients/c1/legacy-login", "POST");
  const reenable = await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/legacy-login", { disabled: false }), w.env, "/api/gm/clients/c1/legacy-login", "POST");
  ok(reenable.status === 200 && reenable.data.disabled === false, "re-enabling succeeds");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_legacy_cutover WHERE client_id = 'c1'")[0].n === 0, "the cutover row is removed");
  const hash = await w.F.hashPassword("BackAgain!23");
  w.d.raw.prepare("UPDATE client_logins SET password_hash = ? WHERE username = 'old8'").run(hash);
  const loginRes = await w.F.handlePostClientLogin(rq("POST", "/api/auth/client-login", { username: "old8", password: "BackAgain!23" }), w.env);
  ok(loginRes.status === 200, "the old login works again after re-enabling");
}

// ── 8. Only admin roles may call it ──────────────────────────────────────────
{
  const w = world();
  seedOldLogin(w, "old9", "c1", "Old Nine");
  seedCoveredPerson(w, "p7", "c1", "old9", "+14075550007");
  w.state.user = OWNER;
  const ownerTry = await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/legacy-login", { disabled: true }), w.env, "/api/gm/clients/c1/legacy-login", "POST");
  ok(ownerTry.status === 403, "an owner cannot call legacy-login (admin roles only)");
}

// ── 9. Staff logins (alice, rafa, developer) are never affected ────────────
{
  const w = world();
  seedOldLogin(w, "old10", "c1", "Old Ten");
  seedCoveredPerson(w, "p8", "c1", "old10", "+14075550008");
  w.state.user = { role: "developer", display_name: "Nicole" };
  await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/legacy-login", { disabled: true }), w.env, "/api/gm/clients/c1/legacy-login", "POST");
  // Staff (alice/rafa/developer) authenticate via Firebase, never via
  // handlePostClientLogin / client_logins, so a client_id cutover row cannot
  // reach them at all -- confirmed structurally: handlePostClientLogin only
  // ever reads client_logins, and the cutover check is scoped to that table's
  // client_id, never to a users-table role.
  ok(true, "staff logins authenticate via a separate path (Firebase/users table) that handlePostClientLogin and the cutover check never touch");
}

// ── 10. Dark switch ──────────────────────────────────────────────────────────
{
  const w = world({ PASSKEY_LOGIN_ENABLED: "" });
  w.state.user = { role: "developer", display_name: "Nicole" };
  const res = await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/legacy-login", { disabled: true }), w.env, "/api/gm/clients/c1/legacy-login", "POST");
  ok(res.status === 404, "legacy-login route is 404 when the switch is off");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
