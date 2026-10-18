// The owner's finance-access toggle (Change D): the REAL Worker functions on
// an in-memory SQLite, with fake Stytch and Telegram.
//
//   node scripts/test-people-role-toggle.mjs
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

function world(envOverrides) {
  const d = makeDb(["migrations/passkey_login.sql"]);
  BASE_TABLES.forEach((s) => d.raw.exec(s));
  d.raw.prepare("INSERT INTO clients (id, name, owners, whatsapp, phone, language) VALUES ('c1', 'Acme Pools', 'Maria Silva', '(407) 555-0101', NULL, 'pt')").run();
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
function rq(method, path, body) {
  return { method, url: "https://apex-api.test" + path, headers: { get: (k) => (k === "CF-Connecting-IP" ? "1.1.1.1" : null) }, json: async () => body || {} };
}
// enforceClientRoleGate itself requires a Bearer-shaped Authorization header
// before it even calls authenticate() (which is fully stubbed here and
// ignores the token's actual value), so direct gate calls need one.
function rqAuthed(method, path, body) {
  return { method, url: "https://apex-api.test" + path, headers: { get: (k) => (k === "CF-Connecting-IP" ? "1.1.1.1" : (k === "Authorization" ? "Bearer capt_x" : null)) }, json: async () => body || {} };
}
const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "Acme Pools", auth_method: "password" };

// Seed a staff person with a client_logins row directly (bypassing the full
// invite flow, which is covered elsewhere) so this file focuses on the toggle.
let seedSeq = 0;
function seedStaff(w, id, username, role) {
  seedSeq++;
  const phone = "+1407555" + String(1000 + seedSeq).slice(-4);
  w.d.raw.prepare("INSERT INTO login_people (id, client_id, role, display_name, phone_e164, username, status, created_at) VALUES (?, 'c1', ?, ?, ?, ?, 'active', datetime('now'))")
    .run(id, role, id, phone, username);
  w.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role) VALUES (?, 'c1', 'PASSKEY_ONLY', 0, ?)").run(username, role);
}

// ── 1. Owner and partner can switch staff <-> staff_finance both ways ──────
{
  const w = world();
  seedStaff(w, "p1", "pk-s1", "staff");
  w.state.user = OWNER;
  const toFin = await w.F.passkeyRoute(rq("POST", "/api/gm/people/p1/role", { role: "staff_finance" }), w.env, "/api/gm/people/p1/role", "POST");
  ok(toFin.status === 200 && toFin.data.person.role === "staff_finance", "owner: staff -> staff_finance");
  ok(w.d.q("SELECT role FROM login_people WHERE id = 'p1'")[0].role === "staff_finance", "login_people.role updated");
  ok(w.d.q("SELECT role FROM client_logins WHERE username = 'pk-s1'")[0].role === "staff_finance", "client_logins.role updated in the same step");
  const back = await w.F.passkeyRoute(rq("POST", "/api/gm/people/p1/role", { role: "staff" }), w.env, "/api/gm/people/p1/role", "POST");
  ok(back.status === 200 && back.data.person.role === "staff", "owner: staff_finance -> staff (both directions)");

  seedStaff(w, "p2", "pk-s2", "staff");
  const PARTNER_USER = { role: "client", client_id: "c1", login_role: "partner", display_name: "Partner" };
  w.state.user = PARTNER_USER;
  const partnerToggle = await w.F.passkeyRoute(rq("POST", "/api/gm/people/p2/role", { role: "staff_finance" }), w.env, "/api/gm/people/p2/role", "POST");
  ok(partnerToggle.status === 200, "a partner can also switch staff <-> staff_finance");
}

// ── 2. A partner cannot change a partner; nobody can change owner/partner/seller with this route ──
{
  const w = world();
  w.d.raw.prepare("INSERT INTO login_people (id, client_id, role, display_name, phone_e164, username, status, created_at) VALUES ('p3', 'c1', 'partner', 'Partner Two', '+14075550003', 'pk-p2', 'active', datetime('now'))").run();
  w.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role) VALUES ('pk-p2', 'c1', 'PASSKEY_ONLY', 0, 'partner')").run();

  const PARTNER_USER = { role: "client", client_id: "c1", login_role: "partner", display_name: "Partner One" };
  w.state.user = PARTNER_USER;
  const partnerOnPartner = await w.F.passkeyRoute(rq("POST", "/api/gm/people/p3/role", { role: "staff" }), w.env, "/api/gm/people/p3/role", "POST");
  ok(partnerOnPartner.status === 403, "a partner cannot change a partner's access type with this route");

  w.state.user = OWNER;
  const onPartner = await w.F.passkeyRoute(rq("POST", "/api/gm/people/p3/role", { role: "staff" }), w.env, "/api/gm/people/p3/role", "POST");
  ok(onPartner.status === 400, "nobody can change a partner to staff/staff_finance with this route (400, not the kind of thing this route does)");

  w.d.raw.prepare("INSERT INTO login_people (id, client_id, role, display_name, phone_e164, username, status, created_at) VALUES ('p4', 'c1', 'client', 'Owner Self', '+14075550004', 'acmepools', 'active', datetime('now'))").run();
  w.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role) VALUES ('acmepools', 'c1', 'pbkdf2$x', 0, 'client')").run();
  w.state.user = { role: "developer", display_name: "Nicole" };
  const onOwner = await w.F.passkeyRoute(rq("POST", "/api/gm/people/p4/role", { role: "staff" }), w.env, "/api/gm/people/p4/role", "POST");
  ok(onOwner.status === 400, "nobody, not even an admin, can change the owner's role with this route");

  w.d.raw.prepare("INSERT INTO login_people (id, client_id, role, display_name, phone_e164, username, status, created_at) VALUES ('p5', 'c1', 'seller', 'Rui Vendas', '+14075550005', 'pk-sell1', 'active', datetime('now'))").run();
  w.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role, seller_name) VALUES ('pk-sell1', 'c1', 'PASSKEY_ONLY', 0, 'seller', 'Rui Vendas')").run();
  w.state.user = OWNER;
  const onSeller = await w.F.passkeyRoute(rq("POST", "/api/gm/people/p5/role", { role: "staff" }), w.env, "/api/gm/people/p5/role", "POST");
  ok(onSeller.status === 400, "nobody can change a seller's role with this route");
}

// ── 3. Other roles are rejected as the TARGET VALUE too ─────────────────────
{
  const w = world();
  seedStaff(w, "p6", "pk-s6", "staff");
  w.state.user = OWNER;
  const badTarget = await w.F.passkeyRoute(rq("POST", "/api/gm/people/p6/role", { role: "partner" }), w.env, "/api/gm/people/p6/role", "POST");
  ok(badTarget.status === 400, "setting any role other than staff/staff_finance is rejected");
}

// ── 4. The change takes effect on the next request (sessions cleared) ──────
{
  const w = world();
  seedStaff(w, "p7", "pk-s7", "staff");
  const token = "capt_" + "b".repeat(64);
  const hash = createHash("sha256").update(token).digest("hex");
  w.d.raw.prepare("INSERT INTO client_auth_tokens (token_hash, client_id, username, expires_at) VALUES (?, 'c1', 'pk-s7', ?)")
    .run(hash, new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString());
  ok(!!(await w.F.authenticateClientToken(token, w.env)), "(setup) session valid before the toggle");
  w.state.user = OWNER;
  await w.F.passkeyRoute(rq("POST", "/api/gm/people/p7/role", { role: "staff_finance" }), w.env, "/api/gm/people/p7/role", "POST");
  ok((await w.F.authenticateClientToken(token, w.env)) === null, "the old session is cleared so the new role takes effect on the next sign-in");
}

// ── 5. Finance/Invoices refused for 'staff', allowed for 'staff_finance' after the toggle ──
{
  const w = world();
  seedStaff(w, "p8", "pk-s8", "staff");
  const STAFF_USER = { role: "client", client_id: "c1", login_role: "staff", username: "pk-s8", display_name: "Staffer" };
  w.state.user = STAFF_USER;
  const financeBefore = await w.F.enforceClientRoleGate(rqAuthed("GET", "/api/clients/c1/gm/finance"), w.env, "/api/clients/c1/gm/finance", "GET");
  ok(financeBefore !== null && financeBefore.status === 403, "before the toggle: 'staff' is refused on Finance");

  w.state.user = OWNER;
  await w.F.passkeyRoute(rq("POST", "/api/gm/people/p8/role", { role: "staff_finance" }), w.env, "/api/gm/people/p8/role", "POST");

  const STAFF_FINANCE_USER = { role: "client", client_id: "c1", login_role: "staff_finance", username: "pk-s8", display_name: "Staffer" };
  w.state.user = STAFF_FINANCE_USER;
  const financeAfter = await w.F.enforceClientRoleGate(rqAuthed("GET", "/api/clients/c1/gm/finance"), w.env, "/api/clients/c1/gm/finance", "GET");
  ok(financeAfter === null, "after the toggle: 'staff_finance' is allowed on Finance");
  const invoicesAfter = await w.F.enforceClientRoleGate(rqAuthed("GET", "/api/clients/c1/gm/invoices"), w.env, "/api/clients/c1/gm/invoices", "GET");
  ok(invoicesAfter === null, "after the toggle: 'staff_finance' is allowed on Invoices");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
