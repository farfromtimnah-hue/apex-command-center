// Security audit log (Change G): the REAL Worker functions on an in-memory
// SQLite, with a fake Stytch fetch and fake Telegram. No network, no real
// Stytch, no production database.
//
//   node scripts/test-login-audit.mjs
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
  d.raw.prepare("INSERT INTO clients (id, name, owners, whatsapp, phone, language) VALUES ('c1', 'Acme Pools', 'Maria Silva, Joao', '(407) 555-0101', NULL, 'pt')").run();
  d.raw.prepare("INSERT INTO clients (id, name, owners, whatsapp, phone, language) VALUES ('c2', 'Other Co', 'Ana', NULL, NULL, 'en')").run();
  const state = { calls: [], telegram: [], userFor: {}, down: false, clockMs: Date.now(), user: null };
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
  const env = Object.assign({
    DB: d.DB, PASSKEY_LOGIN_ENABLED: "1", STYTCH_PROJECT_ID: "x", STYTCH_SECRET: "y"
  }, envOverrides || {});
  return { d, F, env, state };
}
function rq(method, path, body, headers) {
  const h = Object.assign({ "CF-Connecting-IP": "1.1.1.1" }, headers || {});
  return {
    method, url: "https://apex-api.test" + path,
    headers: { get: (k) => (k in h ? h[k] : null) },
    json: async () => body || {}
  };
}
const OWNER = { role: "client", client_id: "c1", login_role: "client", username: "acmepools", display_name: "Acme Pools", auth_method: "password" };

// ── 1. Each kind is recorded with the right fields, no free text ───────────
{
  const w = world();
  await w.F.loginActivityRecord(w.env, rq("GET", "/x", {}, { "CF-IPCountry": "US", "CF-Connecting-IP": "203.0.113.42" }), {
    client_id: "c1", person_id: "p1", username: "pk-abc", role: "staff",
    kind: "signin_passkey", detail: { ok: true }
  });
  const row = w.d.q("SELECT * FROM login_activity")[0];
  ok(row.kind === "signin_passkey" && row.client_id === "c1" && row.person_id === "p1" && row.username === "pk-abc" && row.role === "staff", "login_activity: fields recorded correctly");
  ok(row.country === "US", "login_activity: country from CF-IPCountry");
  ok(row.ip_prefix === "203.0.113", "login_activity: ip_prefix is the first three IPv4 octets, never the full address");
  ok(row.detail.length <= 500, "login_activity: detail capped at 500 chars");
  ok(JSON.parse(row.detail).ok === true, "login_activity: detail is valid JSON");

  // No free text or personal data ever appears in detail: feed a kind with a
  // plausible "name" field and confirm detail only ever carries the fields
  // the recorder itself builds (ids, labels, booleans), never raw names/phones.
  await w.F.loginActivityRecord(w.env, rq("GET", "/x"), {
    client_id: "c1", person_id: "p1", username: "pk-abc", role: "staff",
    kind: "passkey_registered", detail: { device_label: "iPhone Safari", purpose: "first" }, device_label: "iPhone Safari"
  });
  const row2 = w.d.q("SELECT * FROM login_activity WHERE kind = 'passkey_registered'")[0];
  ok(!/\+1|\d{3}-\d{3}-\d{4}|@/.test(row2.detail), "login_activity: detail never contains a phone number or email shape");
}

// ── 2. IPv6 prefix: first four groups ───────────────────────────────────────
{
  const w = world();
  await w.F.loginActivityRecord(w.env, rq("GET", "/x", {}, { "CF-Connecting-IP": "2001:0db8:85a3:0000:0000:8a2e:0370:7334" }), {
    kind: "signin_passkey", detail: {}
  });
  const row = w.d.q("SELECT ip_prefix FROM login_activity")[0];
  ok(row.ip_prefix === "2001:0db8:85a3:0000", "login_activity: IPv6 ip_prefix is the first four groups");
}

// ── 3. Bounded auto-recorders: finance_view and data_change ─────────────────
{
  const w = world();
  w.state.user = OWNER;
  // 100 identical POSTs in one minute to a client business route produce
  // exactly ONE data_change row (the deterministic per-minute key).
  for (let i = 0; i < 100; i++) {
    await w.F.enforceClientRoleGate(rq("POST", "/api/clients/c1/gm/leads", {}, { Authorization: "Bearer capt_x" }), w.env, "/api/clients/c1/gm/leads", "POST");
  }
  const dc = w.d.q("SELECT COUNT(*) AS n FROM login_activity WHERE kind = 'data_change'")[0].n;
  ok(dc === 1, "data_change: a burst of 100 identical writes in one minute produces exactly one row");

  // Many finance GETs in one hour produce ONE finance_view row.
  for (let i = 0; i < 40; i++) {
    await w.F.enforceClientRoleGate(rq("GET", "/api/clients/c1/gm/finance", {}, { Authorization: "Bearer capt_x" }), w.env, "/api/clients/c1/gm/finance", "GET");
  }
  const fv = w.d.q("SELECT COUNT(*) AS n FROM login_activity WHERE kind = 'finance_view'")[0].n;
  ok(fv === 1, "finance_view: many GETs in one hour produce exactly one row");

  // A different path group / method in the same minute is a SEPARATE key.
  await w.F.enforceClientRoleGate(rq("DELETE", "/api/clients/c1/gm/leads/abc123", {}, { Authorization: "Bearer capt_x" }), w.env, "/api/clients/c1/gm/leads/abc123", "DELETE");
  const dc2 = w.d.q("SELECT COUNT(*) AS n FROM login_activity WHERE kind = 'data_change'")[0].n;
  ok(dc2 === 2, "data_change: a different path group + method is recorded separately");

  // The audit log's own routes and the login routes are excluded.
  const beforeCount = w.d.q("SELECT COUNT(*) AS n FROM login_activity")[0].n;
  await w.F.enforceClientRoleGate(rq("GET", "/api/gm/activity", {}, { Authorization: "Bearer capt_x" }), w.env, "/api/gm/activity", "GET");
  const afterCount = w.d.q("SELECT COUNT(*) AS n FROM login_activity")[0].n;
  ok(afterCount === beforeCount, "the audit log's own route (/api/gm/activity) is never recorded by the auto-recorder");
}

// ── 4. The recorder never throws or blocks when the table is missing ───────
{
  const w = world();
  w.d.raw.exec("DROP TABLE login_activity");
  let threw = false;
  try { await w.F.loginActivityRecord(w.env, rq("GET", "/x"), { kind: "signin_passkey", detail: {} }); } catch (e) { threw = true; }
  ok(!threw, "loginActivityRecord never throws when the table is missing");
}

// ── 5. Retention: purge rows older than 120 days, at most once per day ─────
{
  const w = world();
  const oldIso = new Date(Date.now() - 130 * 24 * 3600 * 1000).toISOString();
  const recentIso = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
  w.d.raw.prepare("INSERT INTO login_activity (id, at, kind) VALUES ('old1', ?, 'signin_passkey')").run(oldIso);
  w.d.raw.prepare("INSERT INTO login_activity (id, at, kind) VALUES ('recent1', ?, 'signin_passkey')").run(recentIso);
  await w.F.loginActivityPurgeDaily(w.env);
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_activity WHERE id = 'old1'")[0].n === 0, "retention: a row older than 120 days is purged");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_activity WHERE id = 'recent1'")[0].n === 1, "retention: a recent row is kept");
  // Running again the same day is a no-op (marker row prevents a second run).
  w.d.raw.prepare("INSERT INTO login_activity (id, at, kind) VALUES ('old2', ?, 'signin_passkey')").run(oldIso);
  await w.F.loginActivityPurgeDaily(w.env);
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_activity WHERE id = 'old2'")[0].n === 1, "retention: purge runs at most once per day (marker row)");
}

// ── 5b. Dark switch and bounded markers (found in review) ─────────────────
{
  // Switch off: the automatic recorders write NOTHING (no audit rows, no markers).
  const w = world({ PASSKEY_LOGIN_ENABLED: "0" });
  await w.F.loginActivityMaybeAuto(w.env, rq("POST", "/api/clients/c1/gm/leads"), "/api/clients/c1/gm/leads", "POST", OWNER);
  await w.F.loginActivityMaybeAuto(w.env, rq("GET", "/api/clients/c1/gm/finance"), "/api/clients/c1/gm/finance", "GET", OWNER);
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_activity")[0].n === 0, "dark: with the switch off the recorders write no audit rows");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_maintenance")[0].n === 0, "dark: with the switch off the recorders write no marker rows");
  // Switch on: they record again.
  const w2 = world();
  await w2.F.loginActivityMaybeAuto(w2.env, rq("POST", "/api/clients/c1/gm/leads"), "/api/clients/c1/gm/leads", "POST", OWNER);
  ok(w2.d.q("SELECT COUNT(*) AS n FROM login_activity WHERE kind = 'data_change'")[0].n === 1, "dark: with the switch on the data_change recorder works");
}
{
  // The daily purge also removes old deduplication markers, and only those.
  const w = world();
  const old = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  const fresh = new Date().toISOString();
  w.d.raw.prepare("INSERT INTO login_maintenance (key, last_run) VALUES ('fv:acme:2020010100', ?)").run(old);
  w.d.raw.prepare("INSERT INTO login_maintenance (key, last_run) VALUES ('dc:acme:/x:POST:202001010000', ?)").run(old);
  w.d.raw.prepare("INSERT INTO login_maintenance (key, last_run) VALUES ('activity_purge:2020-01-01', ?)").run(old);
  w.d.raw.prepare("INSERT INTO login_maintenance (key, last_run) VALUES ('fv:acme:recent', ?)").run(fresh);
  w.d.raw.prepare("INSERT INTO login_maintenance (key, last_run) VALUES ('something_else', ?)").run(old);
  await w.F.loginActivityPurgeDaily(w.env);
  const keys = w.d.q("SELECT key FROM login_maintenance").map((r) => r.key);
  ok(keys.indexOf("fv:acme:2020010100") === -1 && keys.indexOf("dc:acme:/x:POST:202001010000") === -1 && keys.indexOf("activity_purge:2020-01-01") === -1, "markers: old fv, dc and purge markers are deleted");
  ok(keys.indexOf("fv:acme:recent") !== -1, "markers: a recent marker is kept");
  ok(keys.indexOf("something_else") !== -1, "markers: unrelated maintenance keys are never touched");
}

// ── 6. Read permissions ─────────────────────────────────────────────────────
{
  const w = world();
  w.d.raw.prepare("INSERT INTO login_people (id, client_id, role, display_name, phone_e164, status, created_at) VALUES ('p1', 'c1', 'staff', 'Pat', '+14075550001', 'active', datetime('now'))").run();
  w.d.raw.prepare("INSERT INTO login_activity (id, at, client_id, person_id, kind) VALUES ('a1', datetime('now'), 'c1', 'p1', 'signin_passkey')").run();

  w.state.user = OWNER;
  const ownerRead = await w.F.passkeyRoute(rq("GET", "/api/gm/activity?person=p1"), w.env, "/api/gm/activity", "GET");
  ok(ownerRead.status === 200 && ownerRead.data.activity.length === 1, "read: the owner sees activity for a person at their own business");

  const PARTNER_USER = { role: "client", client_id: "c1", login_role: "partner", display_name: "Partner" };
  w.state.user = PARTNER_USER;
  const partnerRead = await w.F.passkeyRoute(rq("GET", "/api/gm/activity?person=p1"), w.env, "/api/gm/activity", "GET");
  ok(partnerRead.status === 200, "read: a partner sees activity for people of their own business");

  const STAFF_USER = { role: "client", client_id: "c1", login_role: "staff", display_name: "Staffer" };
  w.state.user = STAFF_USER;
  const staffRead = await w.F.passkeyRoute(rq("GET", "/api/gm/activity?person=p1"), w.env, "/api/gm/activity", "GET");
  ok(staffRead.status === 403, "read: staff sees nothing (403)");

  const SELLER_USER = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Rui", display_name: "Rui" };
  w.state.user = SELLER_USER;
  const sellerRead = await w.F.passkeyRoute(rq("GET", "/api/gm/activity?person=p1"), w.env, "/api/gm/activity", "GET");
  ok(sellerRead.status === 403, "read: a seller sees nothing (403)");

  w.d.raw.prepare("INSERT INTO login_people (id, client_id, role, display_name, phone_e164, status, created_at) VALUES ('p2', 'c2', 'staff', 'Kim', '+14075550002', 'active', datetime('now'))").run();
  const OTHER_OWNER = { role: "client", client_id: "c2", login_role: "client", display_name: "Other Co" };
  w.state.user = OTHER_OWNER;
  const otherBizRead = await w.F.passkeyRoute(rq("GET", "/api/gm/activity?person=p1"), w.env, "/api/gm/activity", "GET");
  ok(otherBizRead.status === 403, "read: another business's owner cannot see this one's activity");

  w.state.user = { role: "developer", display_name: "Nicole" };
  const adminRead = await w.F.passkeyRoute(rq("GET", "/api/gm/activity?person=p2"), w.env, "/api/gm/activity", "GET");
  ok(adminRead.status === 200, "read: an admin sees activity for any business's person");

  // Developer-only diagnostics route.
  w.state.user = { role: "alice", display_name: "Alice" };
  const aliceDiag = await w.F.passkeyRoute(rq("GET", "/api/diagnostics/login-activity"), w.env, "/api/diagnostics/login-activity", "GET");
  ok(aliceDiag.status === 403, "diagnostics/login-activity: alice (admin, not developer) is refused");
  w.state.user = { role: "developer", display_name: "Nicole" };
  const devDiag = await w.F.passkeyRoute(rq("GET", "/api/diagnostics/login-activity"), w.env, "/api/diagnostics/login-activity", "GET");
  ok(devDiag.status === 200 && Array.isArray(devDiag.data.activity), "diagnostics/login-activity: developer role only, returns rows");
}

// ── 6b. The old password login must never depend on the new tables (found in review) ──
{
  // Switch OFF and the cutover table missing: a normal password login still works.
  const w = world({ PASSKEY_LOGIN_ENABLED: "0" });
  w.d.raw.exec("DROP TABLE login_legacy_cutover");
  w.d.raw.exec("DROP TABLE login_activity");
  const hash = await w.F.hashPassword("Sup3rSecret!23");
  w.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role) VALUES ('acmepools', 'c1', ?, 0, 'client')").run(hash);
  const res = await w.F.handlePostClientLogin(rq("POST", "/api/auth/client-login", { username: "acmepools", password: "Sup3rSecret!23" }), w.env);
  ok(res.status === 200 && !!res.data.token, "old login: works with the switch off and the new tables missing");
  // Switch ON but the cutover table missing: still works (a failed read never breaks a login).
  const w2 = world();
  w2.d.raw.exec("DROP TABLE login_legacy_cutover");
  const hash2 = await w2.F.hashPassword("Sup3rSecret!23");
  w2.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role) VALUES ('acmepools', 'c1', ?, 0, 'client')").run(hash2);
  const res2 = await w2.F.handlePostClientLogin(rq("POST", "/api/auth/client-login", { username: "acmepools", password: "Sup3rSecret!23" }), w2.env);
  ok(res2.status === 200, "old login: works with the switch on and the cutover table missing");
  // Switch off: no audit row is written for the password login.
  const w3 = world({ PASSKEY_LOGIN_ENABLED: "0" });
  const hash3 = await w3.F.hashPassword("Sup3rSecret!23");
  w3.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role) VALUES ('acmepools', 'c1', ?, 0, 'client')").run(hash3);
  await w3.F.handlePostClientLogin(rq("POST", "/api/auth/client-login", { username: "acmepools", password: "Sup3rSecret!23" }), w3.env);
  ok(w3.d.q("SELECT COUNT(*) AS n FROM login_activity")[0].n === 0, "old login: no audit row is written while the switch is off");
}

// ── 7. signin_password recorded on a successful username/password login ───
{
  const w = world();
  const hash = await w.F.hashPassword("Sup3rSecret!23");
  w.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role) VALUES ('acmepools', 'c1', ?, 0, 'client')").run(hash);
  const res = await w.F.handlePostClientLogin(rq("POST", "/api/auth/client-login", { username: "acmepools", password: "Sup3rSecret!23" }), w.env);
  ok(res.status === 200, "(setup) password login succeeded");
  const row = w.d.q("SELECT * FROM login_activity WHERE kind = 'signin_password'")[0];
  ok(row && row.client_id === "c1" && row.username === "acmepools", "signin_password: recorded for every business, including old logins");
}

// ── 8. Dark switch ──────────────────────────────────────────────────────────
{
  const w = world({ PASSKEY_LOGIN_ENABLED: "" });
  w.state.user = { role: "developer", display_name: "Nicole" };
  const r1 = await w.F.passkeyRoute(rq("GET", "/api/gm/activity?person=p1"), w.env, "/api/gm/activity", "GET");
  ok(r1.status === 404, "GET /api/gm/activity is 404 when the switch is off");
  const r2 = await w.F.passkeyRoute(rq("GET", "/api/diagnostics/login-activity"), w.env, "/api/diagnostics/login-activity", "GET");
  ok(r2.status === 404, "GET /api/diagnostics/login-activity is 404 when the switch is off");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
