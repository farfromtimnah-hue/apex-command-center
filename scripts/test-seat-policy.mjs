// Seat counting and seat policy (Change J/K): the REAL Worker functions on
// an in-memory SQLite, with fake Stytch and Telegram.
//
//   node scripts/test-seat-policy.mjs
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
    fetch: async (url, init) => {
      const u = new URL(url); const body = JSON.parse(init.body || "{}");
      if (u.pathname === "/v1/otps/sms/login_or_create") { return { ok: true, status: 200, json: async () => ({ user_id: "u-" + body.phone_number.slice(-4), phone_id: "ph-" + body.phone_number.slice(-4) }) }; }
      if (u.pathname === "/v1/otps/authenticate") { return body.code === "123456" ? { ok: true, status: 200, json: async () => ({ user_id: "u-" + body.method_id.slice(-4), method_id: body.method_id }) } : { ok: false, status: 401, json: async () => ({}) }; }
      if (u.pathname === "/v1/webauthn/register/start") { return { ok: true, status: 200, json: async () => ({ user_id: body.user_id, public_key_credential_creation_options: JSON.stringify({ challenge: "Y2hhbGxlbmdl", rp: {}, user: {}, pubKeyCredParams: [] }) }) }; }
      if (u.pathname === "/v1/webauthn/register") { const c = JSON.parse(body.public_key_credential); return { ok: true, status: 200, json: async () => ({ user_id: body.user_id, webauthn_registration_id: c.reg }) }; }
      return { ok: false, status: 404, json: async () => ({}) };
    },
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
const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "Acme Pools", auth_method: "password" };
const tokenOf = (url) => url.split("?t=")[1];
async function addPerson(w, phone, name) {
  w.state.user = OWNER;
  return w.F.passkeyRoute(rq("POST", "/api/gm/people", { name, role: "staff", phone }), w.env, "/api/gm/people", "POST");
}
async function completeInvite(w, t, reg) {
  await w.F.passkeyRoute(rq("POST", "/api/passkey-invite/send-code", { t }), w.env, "/api/passkey-invite/send-code", "POST");
  await w.F.passkeyRoute(rq("POST", "/api/passkey-invite/verify-code", { t, code: "123456" }), w.env, "/api/passkey-invite/verify-code", "POST");
  return w.F.passkeyRoute(rq("POST", "/api/passkey-invite/register", { t, credential: { id: "cred", reg } }), w.env, "/api/passkey-invite/register", "POST");
}

// ── 1. Consulting business (apex_direct / no tag) in 'track': never blocked, no notice, ever ──
{
  const w = world();
  for (let i = 0; i < 8; i++) {
    const r = await addPerson(w, "407555020" + i, "Person " + i);
    ok(r.status === 200, "track mode: person " + i + " added without being blocked");
  }
  w.state.user = OWNER;
  const peopleView = await w.F.passkeyRoute(rq("GET", "/api/gm/people"), w.env, "/api/gm/people", "GET");
  ok(peopleView.status === 200 && !peopleView.data.seats, "track mode: the owner sees NO seat object at all, even with 8 people");
  const usage = w.d.q("SELECT MAX(peak) AS m FROM login_seat_usage WHERE client_id = 'c1'")[0].m;
  ok(usage === 8, "track mode: the peak is still recorded even though nothing is shown or blocked");
}

// ── 2. 'public_signup' defaults to 'notice'; note only above 5 seats; never blocks ──
{
  const w = world();
  w.state.user = { role: "developer", display_name: "Nicole" };
  const srcRes = await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/source", { source: "public_signup" }), w.env, "/api/gm/clients/c1/source", "POST");
  ok(srcRes.status === 200, "(setup) source set to public_signup");

  for (let i = 0; i < 4; i++) { await addPerson(w, "407555030" + i, "P " + i); }
  w.state.user = OWNER;
  const under = await w.F.passkeyRoute(rq("GET", "/api/gm/people"), w.env, "/api/gm/people", "GET");
  ok(under.data.seats && under.data.seats.mode === "notice" && under.data.seats.over === 0, "public_signup/notice: at or under 5 seats, no 'over' amount");

  for (let i = 0; i < 3; i++) { await addPerson(w, "407555031" + i, "Q " + i); }
  const over = await w.F.passkeyRoute(rq("GET", "/api/gm/people"), w.env, "/api/gm/people", "GET");
  ok(over.data.seats.used === 7 && over.data.seats.over === 2, "public_signup/notice: past 5 seats, 'over' shows the overage (notice-worthy)");
  const r8 = await addPerson(w, "4075550320", "R 8");
  ok(r8.status === 200, "public_signup/notice: NEVER blocks, even well past included seats");
}

// ── 3. 'block' mode: refuses at the hard limit, only an admin can set it ──
{
  const w = world();
  w.state.user = OWNER;
  const ownerSet = await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/seat-policy", { included_seats: 5, mode: "block", hard_limit: 6 }), w.env, "/api/gm/clients/c1/seat-policy", "POST");
  ok(ownerSet.status === 403, "seat-policy: only an admin can set the mode (the owner is refused)");

  w.state.user = { role: "developer", display_name: "Nicole" };
  const devSet = await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/seat-policy", { included_seats: 5, mode: "block", hard_limit: 6 }), w.env, "/api/gm/clients/c1/seat-policy", "POST");
  ok(devSet.status === 200, "seat-policy: an admin sets block mode with a hard limit of 6");

  for (let i = 0; i < 6; i++) {
    const r = await addPerson(w, "407555040" + i, "B " + i);
    ok(r.status === 200, "block mode: person " + (i + 1) + " of 6 added");
  }
  const r7 = await addPerson(w, "4075550410", "B 7");
  ok(r7.status === 400 || r7.status === 409, "block mode: the 7th person is refused at the hard limit");
  ok(/Limite de pessoas|People limit/.test((r7.error_pt || "") + (r7.error_en || "")), "block mode: a clear bilingual message");
}

// ── 4. A left person frees the seat ─────────────────────────────────────────
{
  const w = world();
  w.state.user = { role: "developer", display_name: "Nicole" };
  await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/seat-policy", { included_seats: 2, mode: "block", hard_limit: 2 }), w.env, "/api/gm/clients/c1/seat-policy", "POST");
  const r1 = await addPerson(w, "4075550501", "Full1");
  const r2 = await addPerson(w, "4075550502", "Full2");
  ok(r1.status === 200 && r2.status === 200, "(setup) two people fill the 2-seat block limit");
  const r3blocked = await addPerson(w, "4075550503", "Full3");
  ok(r3blocked.status === 400 || r3blocked.status === 409, "(setup) a third person is blocked at the limit");

  w.state.user = OWNER;
  const leftRes = await w.F.passkeyRoute(rq("POST", "/api/gm/people/" + r1.data.person.id + "/device-event", { reason: "left" }), w.env, "/api/gm/people/" + r1.data.person.id + "/device-event", "POST");
  ok(leftRes.status === 200, "(setup) person 1 leaves");
  const r3now = await addPerson(w, "4075550504", "Full3b");
  ok(r3now.status === 200, "a left person frees the seat, a new person can now be added");
}

// ── 5. The enable route re-checks only in block mode ────────────────────────
{
  const w = world();
  const r = await addPerson(w, "4075550601", "Disabled One");
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-dis1");
  w.state.user = OWNER;
  const pid = r.data.person.id;
  await w.F.passkeyRoute(rq("POST", "/api/gm/people/" + pid + "/disable"), w.env, "/api/gm/people/" + pid + "/disable", "POST");

  // In 'track' (the default), re-enabling is never blocked.
  const enableTrack = await w.F.passkeyRoute(rq("POST", "/api/gm/people/" + pid + "/enable"), w.env, "/api/gm/people/" + pid + "/enable", "POST");
  ok(enableTrack.status === 200, "enable: in track mode, re-enabling is never blocked");

  // Now set block mode at the limit and disable/re-enable again.
  w.state.user = { role: "developer", display_name: "Nicole" };
  await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/seat-policy", { included_seats: 1, mode: "block", hard_limit: 1 }), w.env, "/api/gm/clients/c1/seat-policy", "POST");
  w.state.user = OWNER;
  await w.F.passkeyRoute(rq("POST", "/api/gm/people/" + pid + "/disable"), w.env, "/api/gm/people/" + pid + "/disable", "POST");
  const r2 = await addPerson(w, "4075550602", "Filler");
  ok(r2.status === 200, "(setup) a filler person occupies the one seat while the first is disabled");
  const enableBlocked = await w.F.passkeyRoute(rq("POST", "/api/gm/people/" + pid + "/enable"), w.env, "/api/gm/people/" + pid + "/enable", "POST");
  ok(enableBlocked.status === 400 || enableBlocked.status === 409, "enable: in block mode at the hard limit, re-enabling is refused");
}

// ── 6. Usage peaks recorded once per day per change ─────────────────────────
{
  const w = world();
  await addPerson(w, "4075550701", "Peak1");
  await addPerson(w, "4075550702", "Peak2");
  const day = new Date(w.state.clockMs).toISOString().slice(0, 10);
  const rows = w.d.q("SELECT * FROM login_seat_usage WHERE client_id = 'c1' AND day = ?", day);
  ok(rows.length === 1 && rows[0].peak === 2, "usage: one row per client per day, peak reflects the max seen that day");
}

// ── 7. Only admins call the seat and source routes ──────────────────────────
{
  const w = world();
  w.state.user = OWNER;
  const ownerUsage = await w.F.passkeyRoute(rq("GET", "/api/gm/clients/c1/seat-usage"), w.env, "/api/gm/clients/c1/seat-usage", "GET");
  ok(ownerUsage.status === 403, "seat-usage: the owner cannot call it (admin only)");
  const ownerSource = await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/source", { source: "public_signup" }), w.env, "/api/gm/clients/c1/source", "POST");
  ok(ownerSource.status === 403, "source: the owner cannot call it (admin only)");
  w.state.user = { role: "developer", display_name: "Nicole" };
  const devUsage = await w.F.passkeyRoute(rq("GET", "/api/gm/clients/c1/seat-usage"), w.env, "/api/gm/clients/c1/seat-usage", "GET");
  ok(devUsage.status === 200 && "used" in devUsage.data && "included" in devUsage.data && "peak_ever" in devUsage.data && "daily_peaks" in devUsage.data, "seat-usage: an admin gets used, included, mode, peak_ever and daily_peaks");
}

// ── 8. The source tag defaults to apex_direct ───────────────────────────────
{
  const w = world();
  const pol = await w.F.passkeySeatPolicy(w.env, "c1");
  ok(pol.mode === "track", "a business with no source row and no seat-policy row defaults to track mode (apex_direct behavior)");
  w.state.user = { role: "developer", display_name: "Nicole" };
  const bad = await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/source", { source: "something_else" }), w.env, "/api/gm/clients/c1/source", "POST");
  ok(bad.status === 400, "source: an unknown value is refused");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
