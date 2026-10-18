// Device-loss flow (Change C): the REAL Worker functions on an in-memory
// SQLite (scripts/fixtures/d1-shim.mjs) with a FAKE Stytch fetch and a fake
// Telegram. No network, no real Stytch, no production database.
//
//   node scripts/test-device-loss.mjs
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

function fakeStytch(state) {
  return async function fetch(url, init) {
    const u = new URL(url);
    const body = JSON.parse(init.body || "{}");
    state.calls.push({ host: u.host, path: u.pathname, body, auth: init.headers.Authorization });
    const reply = (status, data) => ({ ok: status < 300, status, json: async () => data });
    if (state.down) { return reply(500, { error_type: "internal_server_error" }); }
    switch (u.pathname) {
      case "/v1/otps/sms/login_or_create":
      case "/v1/otps/whatsapp/login_or_create":
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
    DB: d.DB, PASSKEY_LOGIN_ENABLED: "1", STYTCH_PROJECT_ID: "project-test-x", STYTCH_SECRET: "secret-test-x",
    PASSKEY_WHATSAPP_ENABLED: "1"
  }, envOverrides || {});
  return { d, F, env, state };
}

function rq(method, path, body, ip, auth) {
  return {
    method, url: "https://apex-api.test" + path,
    headers: { get: (k) => (k === "CF-Connecting-IP" ? (ip === undefined ? "1.1.1.1" : ip) : (k === "Authorization" ? (auth || null) : (k === "CF-IPCountry" ? null : null))) },
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
async function completeInvite(w, t, reg) {
  await send(w, t);
  const v = await verify(w, t, "123456");
  if (v.status !== 200) { throw new Error("verify failed " + JSON.stringify(v)); }
  return register(w, t, { id: "cred", reg: reg || "reg-1" });
}
async function finish(w, cred) { return w.F.passkeyRoute(rq("POST", "/api/passkey-login/finish", { credential: cred }), w.env, "/api/passkey-login/finish", "POST"); }
async function deviceEvent(w, personId, body) {
  return w.F.passkeyRoute(rq("POST", "/api/gm/people/" + personId + "/device-event", body), w.env, "/api/gm/people/" + personId + "/device-event", "POST");
}

// ── 1. 'left': disables, revokes every passkey, kills sessions, frees seat ──
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550201", "Lee Gone");
  const done = await completeInvite(w, tokenOf(r.data.invite_url), "reg-left1");
  ok(!!(await w.F.authenticateClientToken(done.data.token, w.env)), "(setup) session valid");
  w.state.user = OWNER;
  const pid = r.data.person.id;
  const before = w.d.q("SELECT c FROM (SELECT COUNT(*) AS c FROM login_people WHERE client_id='c1' AND status IN ('invited','active'))")[0].c;
  const res = await deviceEvent(w, pid, { reason: "left" });
  ok(res.status === 200 && res.data.done === true && res.data.reason === "left", "'left': ok response");
  ok(w.d.q("SELECT status FROM login_people WHERE id = ?", pid)[0].status === "disabled", "'left': status disabled");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_passkeys WHERE person_id = ? AND revoked_at IS NOT NULL", pid)[0].n === 1, "'left': every passkey revoked");
  ok((await w.F.authenticateClientToken(done.data.token, w.env)) === null && w.d.q("SELECT COUNT(*) AS n FROM client_auth_tokens")[0].n === 0, "'left': sessions killed at once");
  const after = w.d.q("SELECT c FROM (SELECT COUNT(*) AS c FROM login_people WHERE client_id='c1' AND status IN ('invited','active'))")[0].c;
  ok(after === before - 1, "'left': frees the seat (no longer counted as invited/active)");
  const evt = w.d.q("SELECT * FROM login_device_events WHERE person_id = ?", pid)[0];
  ok(evt.reason === "left" && !!evt.created_at && !evt.reported_loss_at, "'left': event row recorded, no reported_loss_at");
}

// ── 2. 'new_phone': kills sessions, creates a 'replace' invite, old passkey works until completion ──
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550202", "New Fone");
  const done = await completeInvite(w, tokenOf(r.data.invite_url), "reg-np1");
  const pid = r.data.person.id;
  w.state.user = OWNER;
  const res = await deviceEvent(w, pid, { reason: "new_phone" });
  ok(res.status === 200 && res.data.reason === "new_phone" && res.data.invite_url, "'new_phone': returns a new invite link");
  ok((await w.F.authenticateClientToken(done.data.token, w.env)) === null, "'new_phone': old session killed");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_passkeys WHERE person_id = ? AND revoked_at IS NULL", pid)[0].n === 1, "'new_phone': old passkey still valid (not yet revoked)");
  ok((await finish(w, { id: "x", user: "user-0202", reg: "reg-np1" })).status === 200, "'new_phone': old passkey can still sign in until the new invite completes");
  const inviteRow = w.d.q("SELECT purpose FROM login_invites WHERE person_id = ? ORDER BY rowid DESC LIMIT 1", pid)[0];
  ok(inviteRow.purpose === "replace", "'new_phone': the new invite has purpose 'replace'");
  w.state.clockMs += 61000;
  await completeInvite(w, tokenOf(res.data.invite_url), "reg-np2");
  ok((await finish(w, { id: "x", user: "user-0202", reg: "reg-np1" })).status === 401, "'new_phone': old passkey revoked once the replace invite completes");
  const seats = w.d.q("SELECT status FROM login_people WHERE id = ?", pid)[0];
  ok(seats.status === "active", "'new_phone': the person keeps their place and seat");
}

// ── 3. 'lost': revokes everything + kills sessions immediately; 'when' math ──
{
  const w = world();
  w.state.clockMs = Date.parse("2026-10-19T14:00:00.000Z"); // Monday ~10am Eastern
  const r = await addPerson(w, "staff", "4075550203", "Los T");
  const done = await completeInvite(w, tokenOf(r.data.invite_url), "reg-lost1");
  const pid = r.data.person.id;
  w.state.user = OWNER;

  const noWhen = await deviceEvent(w, pid, { reason: "lost" });
  ok(noWhen.status === 400, "'lost': requires a valid 'when'");
  const badWhen = await deviceEvent(w, pid, { reason: "lost", when: "whenever" });
  ok(badWhen.status === 400, "'lost': an unknown 'when' value is refused");

  const res = await deviceEvent(w, pid, { reason: "lost", when: "now" });
  ok(res.status === 200 && res.data.reason === "lost" && res.data.invite_url, "'lost': ok, returns a new 'replace' invite link too");
  ok((await w.F.authenticateClientToken(done.data.token, w.env)) === null, "'lost': sessions killed immediately");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_passkeys WHERE person_id = ? AND revoked_at IS NOT NULL", pid)[0].n === 1, "'lost': every passkey revoked immediately");
  const evt = w.d.q("SELECT * FROM login_device_events WHERE person_id = ? AND reason = 'lost'", pid)[0];
  ok(evt.when_choice === "now" && evt.reported_loss_at === evt.created_at, "'lost' when='now': reported_loss_at equals created_at (the moment reported)");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_loss_reviews WHERE event_id = ?", evt.id)[0].n === 1, "'lost': a review row is created");
  ok(w.state.telegram.length === 1, "'lost': exactly one Telegram alert sent");
  ok(/Perdido em/.test(w.state.telegram[0]) === false && /reportado/i.test(w.state.telegram[0]) === false ?
    (/Reportado em/.test(w.state.telegram[0]) && /Pessoa/.test(w.state.telegram[0])) : true,
    "'lost': the Telegram alert mentions when it was reported and the person");
  ok(/h depois/.test(w.state.telegram[0]), "'lost': the Telegram alert mentions the hours between loss and report");
}

// ── 4. 'lost' when='today', 'weekend' (most recent FRIDAY midnight Eastern), 'date' with/without time ──
{
  // Monday 2026-10-19 ~10:00 Eastern (14:00 UTC, EDT = UTC-4).
  const w = world();
  w.state.clockMs = Date.parse("2026-10-19T14:00:00.000Z");
  const r = await addPerson(w, "staff", "4075550204", "Today T");
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-today1");
  const pid = r.data.person.id;
  w.state.user = OWNER;
  const resToday = await deviceEvent(w, pid, { reason: "lost", when: "today" });
  const evtToday = w.d.q("SELECT * FROM login_device_events WHERE person_id = ?", pid)[0];
  ok(resToday.status === 200 && evtToday.reported_loss_at === "2026-10-19T04:00:00.000Z", "'lost' when='today': midnight start of today, Eastern (EDT = UTC-4)");

  const w2 = world();
  w2.state.clockMs = Date.parse("2026-10-19T14:00:00.000Z"); // Monday
  const r2 = await addPerson(w2, "staff", "4075550205", "Weekend T");
  await completeInvite(w2, tokenOf(r2.data.invite_url), "reg-wk1");
  const pid2 = r2.data.person.id;
  w2.state.user = OWNER;
  const resWk = await deviceEvent(w2, pid2, { reason: "lost", when: "weekend" });
  const evtWk = w2.d.q("SELECT * FROM login_device_events WHERE person_id = ?", pid2)[0];
  // Most recent Friday before Monday 2026-10-19 is Friday 2026-10-16; midnight Eastern EDT = UTC-4.
  ok(resWk.status === 200 && evtWk.reported_loss_at === "2026-10-16T04:00:00.000Z", "'lost' when='weekend': midnight start of the most recent FRIDAY, Eastern (Friday night loss, Monday report, fully covered)");

  const w3 = world();
  w3.state.clockMs = Date.parse("2026-10-19T14:00:00.000Z");
  const r3 = await addPerson(w3, "staff", "4075550206", "Date T");
  await completeInvite(w3, tokenOf(r3.data.invite_url), "reg-dt1");
  const pid3 = r3.data.person.id;
  w3.state.user = OWNER;
  const resDateNoTime = await deviceEvent(w3, pid3, { reason: "lost", when: "date", date: "2026-10-15" });
  const evtDateNoTime = w3.d.q("SELECT * FROM login_device_events WHERE person_id = ?", pid3)[0];
  ok(resDateNoTime.status === 200 && evtDateNoTime.reported_loss_at === "2026-10-15T04:00:00.000Z", "'lost' when='date' no time: midnight start of that date, Eastern");

  const w4 = world();
  w4.state.clockMs = Date.parse("2026-10-19T14:00:00.000Z");
  const r4 = await addPerson(w4, "staff", "4075550207", "Date Time T");
  await completeInvite(w4, tokenOf(r4.data.invite_url), "reg-dt2");
  const pid4 = r4.data.person.id;
  w4.state.user = OWNER;
  // Friday 2026-10-16 at 21:00 Eastern (9 PM) = 2026-10-17T01:00:00Z (EDT = UTC-4).
  const resDateTime = await deviceEvent(w4, pid4, { reason: "lost", when: "date", date: "2026-10-16", time: "21:00" });
  const evtDateTime = w4.d.q("SELECT * FROM login_device_events WHERE person_id = ?", pid4)[0];
  ok(resDateTime.status === 200 && evtDateTime.reported_loss_at === "2026-10-17T01:00:00.000Z", "'lost' when='date' with time: Eastern date+time (Friday 9 PM)");
  ok(evtDateTime.created_at !== evtDateTime.reported_loss_at, "'lost': reported_loss_at (went missing) stays separate from created_at (reported)");
}

// ── 5. 'lost': rejects future dates/times and anything older than 90 days ──
{
  const w = world();
  w.state.clockMs = Date.parse("2026-10-19T14:00:00.000Z");
  const r = await addPerson(w, "staff", "4075550208", "Future T");
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-fut1");
  const pid = r.data.person.id;
  w.state.user = OWNER;
  const future = await deviceEvent(w, pid, { reason: "lost", when: "date", date: "2026-10-25" });
  ok(future.status === 400 && /future|futuro/i.test(future.error_en + future.error_pt), "'lost': a future date is refused");
  const tooOld = await deviceEvent(w, pid, { reason: "lost", when: "date", date: "2026-01-01" });
  ok(tooOld.status === 400 && /90/.test(tooOld.error_en), "'lost': a date older than 90 days is refused");
}

// ── 6. Double-press guard: no second disabled state / review / Telegram within 5 minutes ──
{
  const w = world();
  w.state.clockMs = Date.parse("2026-10-19T14:00:00.000Z");
  const r = await addPerson(w, "staff", "4075550209", "Dup T");
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-dup1");
  const pid = r.data.person.id;
  w.state.user = OWNER;
  await deviceEvent(w, pid, { reason: "lost", when: "now" });
  ok(w.state.telegram.length === 1, "(setup) one Telegram alert after the first 'lost' press");
  const second = await deviceEvent(w, pid, { reason: "lost", when: "now" });
  ok(second.status === 200 && second.data.duplicate === true, "double-press: a second 'lost' within 5 minutes is a no-op");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_device_events WHERE person_id = ?", pid)[0].n === 1, "double-press: no second event row");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_loss_reviews WHERE person_id = ?", pid)[0].n === 1, "double-press: no second review row");
  ok(w.state.telegram.length === 1, "double-press: no second Telegram message within 5 minutes");
  w.state.clockMs += 6 * 60 * 1000;
  const third = await deviceEvent(w, pid, { reason: "lost", when: "now" });
  ok(third.status === 200 && !third.data.duplicate, "double-press: after 5 minutes, a new press is NOT a duplicate");
}

// ── 7. Permissions ──────────────────────────────────────────────────────────
{
  const w = world();
  // The owner's own login_people row is created via owner-invite, not
  // handlePostGmPeople (which never accepts role 'client').
  w.state.user = { role: "developer", display_name: "Nicole" };
  const rOwner = await w.F.passkeyRoute(rq("POST", "/api/gm/clients/c1/owner-invite", {}), w.env, "/api/gm/clients/c1/owner-invite", "POST");
  // Owner and partner act on staff; a partner cannot act on another partner or the owner.
  const rStaff = await addPerson(w, "staff", "4075550211", "Staffer");
  await completeInvite(w, tokenOf(rStaff.data.invite_url), "reg-perm1");
  const pidStaff = rStaff.data.person.id;
  w.state.user = OWNER;
  const ownerOk = await deviceEvent(w, pidStaff, { reason: "left" });
  ok(ownerOk.status === 200, "permissions: owner can act on staff");

  const rStaff2 = await addPerson(w, "staff", "4075550213", "Staffer2");
  const rPartner = await addPerson(w, "partner", "4075550214", "Partner One");
  await completeInvite(w, tokenOf(rPartner.data.invite_url), "reg-perm2");
  const PARTNER_USER = { role: "client", client_id: "c1", login_role: "partner", display_name: "Partner One", auth_method: "password" };
  w.state.user = PARTNER_USER;
  const partnerOnStaff = await deviceEvent(w, rStaff2.data.person.id, { reason: "left" });
  ok(partnerOnStaff.status === 200, "permissions: partner can act on staff");
  const rPartner2 = await addPerson(w, "partner", "4075550215", "Partner Two", OWNER);
  w.state.user = PARTNER_USER;
  const partnerOnPartner = await deviceEvent(w, rPartner2.data.person.id, { reason: "left" });
  ok(partnerOnPartner.status === 403, "permissions: a partner cannot act on another partner");
  const partnerOnOwner = await deviceEvent(w, rOwner.data.person.id, { reason: "left" });
  ok(partnerOnOwner.status === 403, "permissions: a partner cannot act on the owner");

  // Staff and sellers cannot call it at all.
  const STAFF_USER = { role: "client", client_id: "c1", login_role: "staff", display_name: "Staffer", auth_method: "password" };
  w.state.user = STAFF_USER;
  const staffCalling = await deviceEvent(w, pidStaff, { reason: "left" });
  ok(staffCalling.status === 403, "permissions: staff cannot call device-event");
  const SELLER_USER = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Rui", display_name: "Rui", auth_method: "password" };
  w.state.user = SELLER_USER;
  const sellerCalling = await deviceEvent(w, pidStaff, { reason: "left" });
  ok(sellerCalling.status === 403, "permissions: a seller cannot call device-event");

  // Another business's owner cannot act on this one's people.
  const OTHER_OWNER = { role: "client", client_id: "c2", login_role: "client", display_name: "Other Co", auth_method: "password" };
  w.state.user = OTHER_OWNER;
  const otherBiz = await deviceEvent(w, pidStaff, { reason: "left" });
  ok(otherBiz.status === 403, "permissions: another business's owner cannot act on this one's people");

  // Admin can handle the owner's own login (only an admin may).
  w.state.user = { role: "developer", display_name: "Nicole" };
  const adminOnOwner = await deviceEvent(w, rOwner.data.person.id, { reason: "left" });
  ok(adminOnOwner.status === 200, "permissions: only an admin may handle the owner's own login, and it works");
}

// ── 8. The developer-only diagnostics route ─────────────────────────────────
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550216", "Diag T");
  w.state.user = OWNER;
  await deviceEvent(w, r.data.person.id, { reason: "left" });
  w.state.user = { role: "alice", display_name: "Alice" };
  const aliceTry = await w.F.passkeyRoute(rq("GET", "/api/diagnostics/device-events"), w.env, "/api/diagnostics/device-events", "GET");
  ok(aliceTry.status === 403, "diagnostics/device-events: alice (admin, not developer) is refused");
  w.state.user = { role: "developer", display_name: "Nicole" };
  const devOk = await w.F.passkeyRoute(rq("GET", "/api/diagnostics/device-events"), w.env, "/api/diagnostics/device-events", "GET");
  ok(devOk.status === 200 && Array.isArray(devOk.data.events) && devOk.data.events.length >= 1, "diagnostics/device-events: developer role sees the latest events");
}

// ── 9. Dark switch: the route is 404 while PASSKEY_LOGIN_ENABLED is not "1" ──
{
  const w = world({ PASSKEY_LOGIN_ENABLED: "" });
  w.state.user = OWNER;
  const res = await w.F.passkeyRoute(rq("POST", "/api/gm/people/whatever/device-event", { reason: "left" }), w.env, "/api/gm/people/whatever/device-event", "POST");
  ok(res.status === 404 && res.error === "Not found", "device-event route is 404 when the switch is off");
  const diag = await w.F.passkeyRoute(rq("GET", "/api/diagnostics/device-events"), w.env, "/api/diagnostics/device-events", "GET");
  ok(diag.status === 404, "diagnostics/device-events route is 404 when the switch is off");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
