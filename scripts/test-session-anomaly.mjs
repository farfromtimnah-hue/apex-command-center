// Session/location anomaly check (Change I): the REAL Worker functions on an
// in-memory SQLite, with fake Stytch and Telegram.
//
//   node scripts/test-session-anomaly.mjs
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
  d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'Acme Pools')").run();
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
function rq(country) {
  return { headers: { get: (k) => (k === "CF-IPCountry" ? (country === undefined ? null : country) : null) } };
}

let mintSeq = 0;
async function mintSession(w, country, usernameOverride) {
  mintSeq++;
  const username = usernameOverride || ("pk-x" + mintSeq);
  const token = "capt_" + mintSeq.toString().padStart(2, "0") + "a".repeat(62);
  const hash = sha(token);
  const existing = w.d.q("SELECT username FROM client_logins WHERE username = ?", username);
  if (!existing.length) {
    w.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role) VALUES (?, 'c1', 'PASSKEY_ONLY', 0, 'staff')").run(username);
  }
  w.d.raw.prepare("INSERT INTO client_auth_tokens (token_hash, client_id, username, expires_at) VALUES (?, 'c1', ?, ?)")
    .run(hash, username, new Date(w.state.clockMs + 30 * 24 * 3600 * 1000).toISOString());
  if (country !== undefined && country !== null) {
    w.d.raw.prepare("INSERT INTO login_session_meta (token_hash, person_id, country, minted_at) VALUES (?, 'p1', ?, ?)")
      .run(hash, country, new Date(w.state.clockMs).toISOString());
  }
  return { token, hash, username };
}

// ── 1. US-minted session used from Brazil or Canada: passes, no alert, updates stored country ──
{
  const w = world();
  const { token, hash } = await mintSession(w, "US");
  const r1 = await w.F.authenticateClientToken(token, w.env, rq("BR"));
  ok(!!r1, "a session minted in the US and used from Brazil passes");
  ok(w.state.telegram.length === 0, "no alert for a trusted country change");
  ok((await w.F.authenticateClientToken(token, w.env, rq("BR"))) !== null, "the session is NOT signed out");
  const meta = w.d.q("SELECT country FROM login_session_meta WHERE token_hash = ?", hash)[0];
  ok(meta.country === "BR", "the stored country is updated to the new trusted country");

  const w2 = world();
  const { token: t2 } = await mintSession(w2, "US");
  const r2 = await w2.F.authenticateClientToken(t2, w2.env, rq("CA"));
  ok(!!r2, "a session minted in the US and used from Canada passes");
}

// ── 2. BR-minted session used in the US: passes ─────────────────────────────
{
  const w = world();
  const { token } = await mintSession(w, "BR");
  const r = await w.F.authenticateClientToken(token, w.env, rq("US"));
  ok(!!r, "a session minted in Brazil and used in the US passes");
}

// ── 3. Untrusted country: deleted, logged, alerted once per hour, answered like expired ──
{
  const w = world();
  const { token, hash } = await mintSession(w, "US");
  w.d.raw.prepare("INSERT INTO login_people (id, client_id, role, display_name, phone_e164, username, status, created_at) VALUES ('p1', 'c1', 'staff', 'Pat', '+14075550001', 'pk-x', 'active', datetime('now'))").run();
  const killed = await w.F.authenticateClientToken(token, w.env, rq("PT"));
  ok(killed === null, "a session used from an untrusted country (Portugal) is answered like an expired session");
  ok(w.d.q("SELECT COUNT(*) AS n FROM client_auth_tokens WHERE token_hash = ?", hash)[0].n === 0, "the token row is deleted");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_session_meta WHERE token_hash = ?", hash)[0].n === 0, "the session_meta row is deleted");
  const logRow = w.d.q("SELECT * FROM login_activity WHERE kind = 'session_country_change'")[0];
  ok(logRow && logRow.country === "PT", "'session_country_change' is logged with the new country");
  ok(w.state.telegram.length === 1, "exactly one Telegram alert sent");

  // A second session for the SAME person, killed from the SAME untrusted
  // country within the hour: the once-per-person-per-hour marker means no
  // second Telegram message.
  const { token: token2 } = await mintSession(w, "US");
  await w.F.authenticateClientToken(token2, w.env, rq("PT"));
  ok(w.state.telegram.length === 1, "a second untrusted-country kill for the same person within the hour does not send a second alert");
}

// ── 4. The same (untrusted) country as stored passes with no action ────────
{
  const w = world();
  const { token, hash } = await mintSession(w, "PT");
  const r = await w.F.authenticateClientToken(token, w.env, rq("PT"));
  ok(!!r, "the same country as stored (even if untrusted) is a pass, not an anomaly");
  ok(w.state.telegram.length === 0, "no alert when the country has not changed");
}

// ── 5. A missing CF-IPCountry header is a pass ──────────────────────────────
{
  const w = world();
  const { token } = await mintSession(w, "US");
  const r = await w.F.authenticateClientToken(token, w.env, rq(null));
  ok(!!r, "a missing CF-IPCountry header is a pass (nothing to compare)");
}

// ── 6. Old password sessions are never bound (no login_session_meta row) ───
{
  const w = world();
  const { token } = await mintSession(w, undefined); // no meta row minted
  const r = await w.F.authenticateClientToken(token, w.env, rq("RU"));
  ok(!!r, "a session with no login_session_meta row (old password login) is never checked, passes regardless of country");
}

// ── 7. PASSKEY_TRUSTED_COUNTRIES changes the trusted list ───────────────────
{
  const w = world({ PASSKEY_TRUSTED_COUNTRIES: "US,PT" });
  const { token, hash } = await mintSession(w, "US");
  const r = await w.F.authenticateClientToken(token, w.env, rq("PT"));
  ok(!!r, "PASSKEY_TRUSTED_COUNTRIES can add a country (Portugal) to the trusted list");
  const meta = w.d.q("SELECT country FROM login_session_meta WHERE token_hash = ?", hash)[0];
  ok(meta.country === "PT", "the stored country updates for the newly-trusted country");
}

// ── 8. passkeyMintSession records login_session_meta only when CF-IPCountry present ──
{
  const w = world();
  w.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role) VALUES ('pk-y', 'c1', 'PASSKEY_ONLY', 0, 'staff')").run();
  const session = await w.F.passkeyMintSession(w.env, "pk-y", "p2", { headers: { get: (k) => (k === "CF-IPCountry" ? "BR" : null) } });
  ok(!!session, "passkeyMintSession succeeds");
  const hash = sha(session.token);
  const meta = w.d.q("SELECT * FROM login_session_meta WHERE token_hash = ?", hash)[0];
  ok(meta && meta.country === "BR" && meta.person_id === "p2", "login_session_meta recorded with the minting country and person");

  const w2 = world();
  w2.d.raw.prepare("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role) VALUES ('pk-z', 'c1', 'PASSKEY_ONLY', 0, 'staff')").run();
  const session2 = await w2.F.passkeyMintSession(w2.env, "pk-z", "p3", { headers: { get: () => null } });
  const hash2 = sha(session2.token);
  ok(w2.d.q("SELECT COUNT(*) AS n FROM login_session_meta WHERE token_hash = ?", hash2)[0].n === 0, "a missing CF-IPCountry header at minting time skips the write entirely");
}

// ── 9. New-country sign-in: first sign-in is never an alert; a trusted new country is quiet; an untrusted new country alerts but never blocks ──
{
  const w = world();
  w.d.raw.prepare("INSERT INTO login_people (id, client_id, role, display_name, phone_e164, username, status, created_at) VALUES ('pA', 'c1', 'staff', 'Ana', '+14075550099', 'pk-a', 'active', datetime('now'))").run();
  await w.F.passkeyNewCountryCheck(w.env, { headers: { get: (k) => (k === "CF-IPCountry" ? "US" : null) } }, "pA");
  ok(w.state.telegram.length === 0, "a person's very first sign-in is never an alert");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_known_places WHERE person_id = 'pA'")[0].n === 1, "the first country is recorded");

  // A new TRUSTED country: logged quietly, no alert.
  await w.F.passkeyNewCountryCheck(w.env, { headers: { get: (k) => (k === "CF-IPCountry" ? "BR" : null) } }, "pA");
  ok(w.state.telegram.length === 0, "a new trusted country is recorded quietly, no alert");
  const logs = w.d.q("SELECT * FROM login_activity WHERE person_id = 'pA' AND kind = 'new_country_signin'");
  ok(logs.length === 1 && JSON.parse(logs[0].detail).trusted === true, "'new_country_signin' recorded with trusted:true for a trusted country");

  // A new UNTRUSTED country: logged and alerted, but never blocks (the check function itself never returns a refusal).
  const result = await w.F.passkeyNewCountryCheck(w.env, { headers: { get: (k) => (k === "CF-IPCountry" ? "RU" : null) } }, "pA");
  ok(result === undefined, "passkeyNewCountryCheck never returns a refusal (never blocks a legitimate sign-in)");
  ok(w.state.telegram.length === 1, "a new untrusted country alerts Nicole once");
  const logs2 = w.d.q("SELECT * FROM login_activity WHERE person_id = 'pA' AND kind = 'new_country_signin' AND country = 'RU'");
  ok(logs2.length === 1 && JSON.parse(logs2[0].detail).trusted === false, "'new_country_signin' recorded with trusted:false for the untrusted country");

  // Once per person and country: a second sign-in from Russia does not re-alert.
  await w.F.passkeyNewCountryCheck(w.env, { headers: { get: (k) => (k === "CF-IPCountry" ? "RU" : null) } }, "pA");
  ok(w.state.telegram.length === 1, "once per person and country: a repeat sign-in from the same untrusted country does not re-alert");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
