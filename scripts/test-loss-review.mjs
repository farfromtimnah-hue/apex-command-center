// The lost-device review (Change H): the REAL Worker functions on an
// in-memory SQLite, with a fake Stytch fetch and fake Telegram.
//
//   node scripts/test-loss-review.mjs
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
        return reply(200, { user_id: "user-" + body.phone_number.slice(-4), phone_id: "phone-" + body.phone_number.slice(-4) });
      case "/v1/otps/authenticate":
        return body.code === "123456" ? reply(200, { user_id: "user-" + body.method_id.slice(-4), method_id: body.method_id }) : reply(401, {});
      case "/v1/webauthn/register/start":
        return reply(200, { user_id: body.user_id, public_key_credential_creation_options: JSON.stringify({ challenge: "Y2hhbGxlbmdl", rp: { id: body.domain }, user: { id: "dXNlcg" }, pubKeyCredParams: [] }) });
      case "/v1/webauthn/register": {
        const c = JSON.parse(body.public_key_credential);
        return reply(200, { user_id: body.user_id, webauthn_registration_id: c.reg });
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
  const state = { calls: [], telegram: [], clockMs: Date.now(), user: null };
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
    DB: d.DB, PASSKEY_LOGIN_ENABLED: "1", STYTCH_PROJECT_ID: "x", STYTCH_SECRET: "y", PASSKEY_WHATSAPP_ENABLED: "1"
  }, envOverrides || {});
  return { d, F, env, state };
}
function rq(method, path, body, headers) {
  const h = Object.assign({ "CF-Connecting-IP": "1.1.1.1" }, headers || {});
  return { method, url: "https://apex-api.test" + path, headers: { get: (k) => (k in h ? h[k] : null) }, json: async () => body || {} };
}
const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "Acme Pools", auth_method: "password" };
const tokenOf = (url) => url.split("?t=")[1];
async function addPerson(w, role, phone, name, user) {
  w.state.user = user || OWNER;
  return w.F.passkeyRoute(rq("POST", "/api/gm/people", { name: name || "Pat Lee", role, phone }), w.env, "/api/gm/people", "POST");
}
async function completeInvite(w, t, reg) {
  await w.F.passkeyRoute(rq("POST", "/api/passkey-invite/send-code", { t }), w.env, "/api/passkey-invite/send-code", "POST");
  await w.F.passkeyRoute(rq("POST", "/api/passkey-invite/verify-code", { t, code: "123456" }), w.env, "/api/passkey-invite/verify-code", "POST");
  return w.F.passkeyRoute(rq("POST", "/api/passkey-invite/register", { t, credential: { id: "cred", reg: reg || "reg-1" } }), w.env, "/api/passkey-invite/register", "POST");
}
async function deviceEvent(w, personId, body) {
  return w.F.passkeyRoute(rq("POST", "/api/gm/people/" + personId + "/device-event", body), w.env, "/api/gm/people/" + personId + "/device-event", "POST");
}

// ── 1. The Friday-night case: lost Friday 9 PM, reported Monday morning ────
{
  const w = world();
  // Friday 2026-10-16, Monday 2026-10-19. "Now" is Monday 10 AM Eastern = 14:00 UTC.
  w.state.clockMs = Date.parse("2026-10-19T14:00:00.000Z");
  const r = await addPerson(w, "staff", "4075550301", "Lost Weekend");
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-fri1");
  const pid = r.data.person.id;
  const username = w.d.q("SELECT username FROM login_people WHERE id = ?", pid)[0].username;

  // A finance view recorded on Friday at 9 PM Eastern (= 2026-10-17T01:00:00Z, EDT=UTC-4).
  w.d.raw.prepare("INSERT INTO login_activity (id, at, client_id, person_id, username, kind) VALUES ('fv1', ?, 'c1', ?, ?, 'finance_view')")
    .run("2026-10-17T01:00:00.000Z", pid, username);
  // Something on Saturday (also inside the between-window).
  w.d.raw.prepare("INSERT INTO login_activity (id, at, client_id, person_id, username, kind) VALUES ('sg1', ?, 'c1', ?, ?, 'signin_passkey')")
    .run("2026-10-17T15:00:00.000Z", pid, username);

  w.state.user = OWNER;
  const res = await deviceEvent(w, pid, { reason: "lost", when: "weekend" });
  ok(res.status === 200, "(setup) lost/weekend recorded");
  const review = w.d.q("SELECT * FROM login_loss_reviews WHERE person_id = ?", pid)[0];
  const summary = JSON.parse(review.summary);
  ok(summary.window_start === "2026-10-16T04:00:00.000Z", "window_start is midnight start of the most recent Friday, Eastern");
  const betweenKinds = summary.between.items.map((i) => i.kind);
  ok(betweenKinds.indexOf("finance_view") !== -1, "the Friday 9 PM finance view is included in the 'between lost and reported' period");
  ok(betweenKinds.indexOf("signin_passkey") !== -1, "the Saturday sign-in is also in the 'between' period");
  ok(review.flagged === 1, "a sign-in during the between period flags the review automatically");
}

// ── 2. Activity after the report goes into the "after reported" period ─────
{
  const w = world();
  w.state.clockMs = Date.parse("2026-10-19T14:00:00.000Z");
  const r = await addPerson(w, "staff", "4075550302", "After Report");
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-after1");
  const pid = r.data.person.id;
  const username = w.d.q("SELECT username FROM login_people WHERE id = ?", pid)[0].username;
  w.state.user = OWNER;
  const res = await deviceEvent(w, pid, { reason: "lost", when: "now" });
  const reportedAt = w.d.q("SELECT reported_at FROM login_loss_reviews WHERE person_id = ?", pid)[0].reported_at;
  // An old-style password session acting an hour after the report (this is
  // the "especially serious" case: passkeys and sessions are already cut).
  const afterIso = new Date(Date.parse(reportedAt) + 3600 * 1000).toISOString();
  w.d.raw.prepare("INSERT INTO login_activity (id, at, client_id, person_id, username, kind) VALUES ('ap1', ?, 'c1', ?, ?, 'signin_password')")
    .run(afterIso, pid, username);
  // Advance the fake clock past that activity so the recheck's "up to now"
  // window actually includes it.
  w.state.clockMs += 2 * 3600 * 1000;
  const reviewIdForRecheck = w.d.q("SELECT id FROM login_loss_reviews WHERE person_id = ?", pid)[0].id;
  w.state.user = { role: "developer", display_name: "Nicole" };
  const recheck2 = await w.F.passkeyRoute(rq("POST", "/api/gm/loss-reviews/" + reviewIdForRecheck + "/recheck", {}), w.env, "/api/gm/loss-reviews/" + reviewIdForRecheck + "/recheck", "POST");
  ok(recheck2.status === 200, "recheck recomputes both periods");
  const afterKinds = recheck2.data.summary.after.items.map((i) => i.kind);
  ok(afterKinds.indexOf("signin_password") !== -1, "activity after the report lands in the 'after reported' period");
  ok(recheck2.data.flagged === true, "a sign-in after the report flags the review (especially serious)");
}

// ── 3. An empty window does not flag ────────────────────────────────────────
{
  const w = world();
  w.state.clockMs = Date.parse("2026-10-19T14:00:00.000Z");
  const r = await addPerson(w, "staff", "4075550303", "Clean Case");
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-clean1");
  const pid = r.data.person.id;
  w.state.user = OWNER;
  const res = await deviceEvent(w, pid, { reason: "lost", when: "now" });
  const review = w.d.q("SELECT * FROM login_loss_reviews WHERE person_id = ?", pid)[0];
  ok(review.flagged === 0, "an empty window (no sensitive activity) does not flag automatically");
}

// ── 4. Only admins list, review and recheck ─────────────────────────────────
{
  const w = world();
  w.state.clockMs = Date.parse("2026-10-19T14:00:00.000Z");
  const r = await addPerson(w, "staff", "4075550304", "Admin Only");
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-adm1");
  const pid = r.data.person.id;
  w.state.user = OWNER;
  await deviceEvent(w, pid, { reason: "lost", when: "now" });
  const reviewId = w.d.q("SELECT id FROM login_loss_reviews WHERE person_id = ?", pid)[0].id;

  const ownerList = await w.F.passkeyRoute(rq("GET", "/api/gm/loss-reviews?status=open"), w.env, "/api/gm/loss-reviews", "GET");
  ok(ownerList.status === 403, "the owner cannot list loss-reviews (admin only)");
  const ownerReview = await w.F.passkeyRoute(rq("POST", "/api/gm/loss-reviews/" + reviewId + "/review", { note: "ok", flagged: false }), w.env, "/api/gm/loss-reviews/" + reviewId + "/review", "POST");
  ok(ownerReview.status === 403, "the owner cannot mark a review (admin only)");
  const ownerRecheck = await w.F.passkeyRoute(rq("POST", "/api/gm/loss-reviews/" + reviewId + "/recheck", {}), w.env, "/api/gm/loss-reviews/" + reviewId + "/recheck", "POST");
  ok(ownerRecheck.status === 403, "the owner cannot recheck a review (admin only)");

  w.state.user = { role: "developer", display_name: "Nicole" };
  const devList = await w.F.passkeyRoute(rq("GET", "/api/gm/loss-reviews?status=open"), w.env, "/api/gm/loss-reviews", "GET");
  ok(devList.status === 200 && devList.data.reviews.length === 1, "an admin lists open reviews with the summary");
  const devReview = await w.F.passkeyRoute(rq("POST", "/api/gm/loss-reviews/" + reviewId + "/review", { note: "Checked, nothing suspicious.", flagged: false }), w.env, "/api/gm/loss-reviews/" + reviewId + "/review", "POST");
  ok(devReview.status === 200, "an admin marks the review as reviewed");
  const devListAfter = await w.F.passkeyRoute(rq("GET", "/api/gm/loss-reviews?status=open"), w.env, "/api/gm/loss-reviews", "GET");
  ok(devListAfter.data.reviews.length === 0, "a reviewed review no longer shows under status=open");
}

// ── 5. The owner sees only { status: 'open' } while open, full outcome after ──
{
  const w = world();
  w.state.clockMs = Date.parse("2026-10-19T14:00:00.000Z");
  const r = await addPerson(w, "staff", "4075550305", "Owner View");
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-ov1");
  const pid = r.data.person.id;
  w.state.user = OWNER;
  await deviceEvent(w, pid, { reason: "lost", when: "now" });
  const openView = await w.F.passkeyRoute(rq("GET", "/api/gm/people/" + pid + "/loss-review"), w.env, "/api/gm/people/" + pid + "/loss-review", "GET");
  ok(openView.status === 200 && Object.keys(openView.data).sort().join(",") === "status" && openView.data.status === "open", "the owner sees ONLY { status: 'open' } while the review is open (Apex reviews first)");

  w.state.user = { role: "developer", display_name: "Nicole" };
  const reviewId = w.d.q("SELECT id FROM login_loss_reviews WHERE person_id = ?", pid)[0].id;
  await w.F.passkeyRoute(rq("POST", "/api/gm/loss-reviews/" + reviewId + "/review", { note: "All clear.", flagged: true }), w.env, "/api/gm/loss-reviews/" + reviewId + "/review", "POST");

  w.state.user = OWNER;
  const reviewedView = await w.F.passkeyRoute(rq("GET", "/api/gm/people/" + pid + "/loss-review"), w.env, "/api/gm/people/" + pid + "/loss-review", "GET");
  ok(reviewedView.status === 200 && reviewedView.data.status === "reviewed" && reviewedView.data.flagged === true && reviewedView.data.note === "All clear.", "once reviewed, the owner sees status, flagged and the note");
  ok(!!reviewedView.data.window_start && !!reviewedView.data.window_end, "the owner sees both times once reviewed");
  ok(Array.isArray(reviewedView.data.items), "the owner sees the plain items list once reviewed");

  // Another business's owner sees nothing.
  const OTHER_OWNER = { role: "client", client_id: "c2", login_role: "client", display_name: "Other Co" };
  w.state.user = OTHER_OWNER;
  const otherView = await w.F.passkeyRoute(rq("GET", "/api/gm/people/" + pid + "/loss-review"), w.env, "/api/gm/people/" + pid + "/loss-review", "GET");
  ok(otherView.status === 403, "another business's owner sees nothing for this person's loss review");
}

// ── 6. Telegram message carries the counts per period and the flag ─────────
{
  const w = world();
  w.state.clockMs = Date.parse("2026-10-19T14:00:00.000Z");
  const r = await addPerson(w, "staff", "4075550306", "Telegram Check");
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-tg1");
  const pid = r.data.person.id;
  const username = w.d.q("SELECT username FROM login_people WHERE id = ?", pid)[0].username;
  w.d.raw.prepare("INSERT INTO login_activity (id, at, client_id, person_id, username, kind) VALUES ('tg1', ?, 'c1', ?, ?, 'finance_view')")
    .run("2026-10-19T10:00:00.000Z", pid, username);
  w.state.user = OWNER;
  await deviceEvent(w, pid, { reason: "lost", when: "now" });
  ok(w.state.telegram.length === 1, "exactly one Telegram message sent");
  const msg = w.state.telegram[0];
  ok(/Perdido em/.test(msg) && /Reportado em/.test(msg), "the message carries both times (went missing, reported)");
  ok(/h depois/.test(msg), "the message carries the hours between loss and report");
  ok(/SIM|não/.test(msg), "the message carries the flag");
  ok(/Pessoa/.test(msg) && /staff/.test(msg), "the message carries the person's display name and role");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
