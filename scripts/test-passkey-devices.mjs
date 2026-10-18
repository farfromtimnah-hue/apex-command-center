// Multi-device passkeys and "My devices" (Changes A and B): the REAL Worker
// functions on an in-memory SQLite (scripts/fixtures/d1-shim.mjs) with a FAKE
// Stytch fetch. No network, no real Stytch, no production database.
//
//   node scripts/test-passkey-devices.mjs
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
  "passkeyInviteMessage", "passkeyInviteMessageFor",
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
  "passkeyMeRateLimited", "handlePostGmPersonRole"
];
const VARS = [
  "PASSKEY_RP_ID", "PASSKEY_INVITE_URL", "PASSKEY_APP_STORE_URL", "PASSKEY_INVITE_HOURS", "PASSKEY_CODE_MINUTES",
  "PASSKEY_REGISTER_MINUTES", "PASSKEY_SENDS_PER_INVITE", "PASSKEY_SEND_COOLDOWN_S", "PASSKEY_SENDS_PER_IP",
  "PASSKEY_VERIFY_FAILURES_MAX", "PASSKEY_SIGNIN_PER_IP_HOUR", "PASSKEY_ONLY_HASH", "PASSKEY_NEW_LOGIN_ROLES",
  "PASSKEY_PERSON_ROLES", "PASSKEY_ROLE_LABELS", "LOGIN_ROLE_DENY_OWNER_ONLY", "LOGIN_ROLE_DENY_SETTINGS",
  "LOGIN_ROLE_DENY_MONEY", "PBKDF2_ITERATIONS",
  "PASSKEY_MAX_DEVICES", "PASSKEY_RECENT_SIGNIN_MINUTES", "PASSKEY_DEVICE_LOSS_REASONS", "PASSKEY_INVITE_PURPOSES",
  "PASSKEY_TRUSTED_COUNTRIES_DEFAULT", "LOGIN_FINANCE_VIEW_RE", "LOGIN_CLIENT_ROUTE_RE"
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
        if (c.wrongUser) { return reply(200, { user_id: "someone-else", webauthn_registration_id: c.reg }); }
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
async function send(w, t) { return w.F.passkeyRoute(rq("POST", "/api/passkey-invite/send-code", { t }), w.env, "/api/passkey-invite/send-code", "POST"); }
async function verify(w, t, code) { return w.F.passkeyRoute(rq("POST", "/api/passkey-invite/verify-code", { t, code }), w.env, "/api/passkey-invite/verify-code", "POST"); }
async function register(w, t, cred) { return w.F.passkeyRoute(rq("POST", "/api/passkey-invite/register", { t, credential: cred }), w.env, "/api/passkey-invite/register", "POST"); }
async function completeInvite(w, t, reg) {
  await send(w, t);
  const v = await verify(w, t, "123456");
  if (v.status !== 200) { throw new Error("verify failed " + JSON.stringify(v)); }
  return register(w, t, { id: "cred", reg: reg || "reg-1" });
}
async function finish(w, cred) { return w.F.passkeyRoute(rq("POST", "/api/passkey-login/finish", { credential: cred }), w.env, "/api/passkey-login/finish", "POST"); }
async function newInvite(w, pid, purpose, user) {
  w.state.user = user || OWNER;
  return w.F.passkeyRoute(rq("POST", "/api/gm/people/" + pid + "/invite", purpose ? { purpose } : {}), w.env, "/api/gm/people/" + pid + "/invite", "POST");
}
function authAs(w, username, auth) { return { role: "client", client_id: "c1", username, token_hash: sha(auth || "tok"), login_role: "staff", auth_method: "password" }; }

// ── 1. 'first' and 'add' invites never revoke existing passkeys ─────────────
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550301", "Multi Device");
  const pid = r.data.person.id;
  const first = await completeInvite(w, tokenOf(r.data.invite_url), "reg-phone");
  ok(w.d.q("SELECT purpose FROM login_invites ORDER BY created_at")[0].purpose === "first", "a person's first invite is purpose 'first'");
  const add = await newInvite(w, pid);
  const addPurposeRow = w.d.q("SELECT purpose FROM login_invites WHERE token_hash = ?", sha(tokenOf(add.data.invite_url)))[0];
  ok(addPurposeRow.purpose === "add", "invite purpose defaults to 'add' for a re-invite");
  const second = await completeInvite(w, tokenOf(add.data.invite_url), "reg-laptop");
  ok(second.status === 200, "second device registered");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_passkeys WHERE person_id = ? AND revoked_at IS NULL", pid)[0].n === 2, "'add' keeps BOTH passkeys (phone and laptop)");
  ok((await finish(w, { id: "x", user: "user-0301", reg: "reg-phone" })).status === 200, "the phone still signs in");
  ok((await finish(w, { id: "x", user: "user-0301", reg: "reg-laptop" })).status === 200, "the laptop signs in too");
}

// ── 2. 'replace' revokes the older passkeys on completion ───────────────────
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550302", "Lost Phone");
  const pid = r.data.person.id;
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-old");
  const rep = await newInvite(w, pid, "replace");
  const repPurposeRow = w.d.q("SELECT purpose FROM login_invites WHERE token_hash = ?", sha(tokenOf(rep.data.invite_url)))[0];
  ok(repPurposeRow.purpose === "replace", "'replace' purpose stored");
  ok((await finish(w, { id: "x", user: "user-0302", reg: "reg-old" })).status === 200, "old device still works before the replace completes");
  await completeInvite(w, tokenOf(rep.data.invite_url), "reg-new");
  ok((await finish(w, { id: "x", user: "user-0302", reg: "reg-old" })).status === 401, "old device refused once the 'replace' invite completes");
  ok((await finish(w, { id: "x", user: "user-0302", reg: "reg-new" })).status === 200, "new device works");
}

// ── 3. unknown purpose rejected; 6th device refused, invite stays unused ────
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550303", "Six Devices");
  const pid = r.data.person.id;
  const bad = await newInvite(w, pid, "bogus");
  ok(bad.status === 400, "an unknown purpose value is a 400");
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-d1");
  for (let i = 2; i <= 5; i++) {
    w.state.clockMs += 61000;
    const inv = await newInvite(w, pid, "add");
    const tok = tokenOf(inv.data.invite_url);
    const sres = await send(w, tok);
    if (sres.status !== 200) { console.log("DEBUG send fail i=" + i, sres); }
    const vres = await verify(w, tok, "123456");
    if (vres.status !== 200) { console.log("DEBUG verify fail i=" + i, vres); }
    await register(w, tok, { id: "x", reg: "reg-d" + i });
  }
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_passkeys WHERE person_id = ? AND revoked_at IS NULL", pid)[0].n === 5, "(setup) 5 active passkeys");
  const sixthInvite = await newInvite(w, pid, "add");
  const sixthTok = tokenOf(sixthInvite.data.invite_url);
  await send(w, sixthTok);
  const sixthVerify = await verify(w, sixthTok, "123456");
  ok(sixthVerify.status === 200, "(setup) code verified for the 6th attempt");
  const sixth = await register(w, sixthTok, { id: "x", reg: "reg-d6" });
  ok(sixth.status === 409, "the 6th active passkey is refused");
  ok(w.d.q("SELECT used_at FROM login_invites WHERE token_hash = ?", sha(sixthTok))[0].used_at === null, "the invite stays unused after the device-limit refusal");
}

// ── 4. single revoke; allow-list rejects revoked, accepts others ────────────
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550304", "Revoke Me");
  const pid = r.data.person.id;
  await completeInvite(w, tokenOf(r.data.invite_url), "reg-a");
  const inv2 = await newInvite(w, pid, "add");
  await completeInvite(w, tokenOf(inv2.data.invite_url), "reg-b");
  const keyB = w.d.q("SELECT id FROM login_passkeys WHERE webauthn_registration_id = 'reg-b'")[0].id;
  w.state.user = OWNER;
  const rev = await w.F.passkeyRoute(rq("POST", "/api/gm/people/" + pid + "/passkeys/" + keyB + "/revoke"), w.env, "/api/gm/people/" + pid + "/passkeys/" + keyB + "/revoke", "POST");
  ok(rev.status === 200 && rev.data.revoked === true, "single revoke works");
  ok((await finish(w, { id: "x", user: "user-0304", reg: "reg-b" })).status === 401, "the allow-list rejects a revoked passkey");
  ok((await finish(w, { id: "x", user: "user-0304", reg: "reg-a" })).status === 200, "the allow-list still accepts the other");
}

// ── 5. /api/me/passkeys lists only the signed-in person's own passkeys ──────
{
  const w = world();
  const r1 = await addPerson(w, "staff", "4075550305", "Person One");
  const d1 = await completeInvite(w, tokenOf(r1.data.invite_url), "reg-p1");
  const r2 = await addPerson(w, "staff", "4075550306", "Person Two");
  await completeInvite(w, tokenOf(r2.data.invite_url), "reg-p2");
  const u1 = w.d.q("SELECT username FROM login_people WHERE id = ?", r1.data.person.id)[0].username;
  w.state.user = authAs(w, u1, d1.data.token);
  const mine = await w.F.passkeyRoute(rq("GET", "/api/me/passkeys", null, null, "Bearer " + d1.data.token), w.env, "/api/me/passkeys", "GET");
  ok(mine.status === 200 && mine.data.passkeys.length === 1, "/api/me/passkeys lists only my own passkeys");
  ok(JSON.stringify(mine.data).indexOf("Person Two") === -1, "a person cannot see another person's passkeys");
}

// ── 6. start-add refusals ────────────────────────────────────────────────────
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550307", "Recent Signin");
  const done = await completeInvite(w, tokenOf(r.data.invite_url), "reg-recent");
  const username = w.d.q("SELECT username FROM login_people WHERE id = ?", r.data.person.id)[0].username;
  w.state.user = authAs(w, username, done.data.token);
  const ok1 = await w.F.passkeyRoute(rq("POST", "/api/me/passkeys/start-add", {}, null, "Bearer " + done.data.token), w.env, "/api/me/passkeys/start-add", "POST");
  ok(ok1.status === 200 && ok1.data.options, "start-add: ok within 15 minutes of sign-in");
  w.state.clockMs += 16 * 60 * 1000;
  const late = await w.F.passkeyRoute(rq("POST", "/api/me/passkeys/start-add", {}, null, "Bearer " + done.data.token), w.env, "/api/me/passkeys/start-add", "POST");
  ok(late.status === 401, "start-add: refused when the session is older than 15 minutes");

  const w2 = world();
  const r2 = await addPerson(w2, "staff", "4075550308", "Disabled Person");
  const d2 = await completeInvite(w2, tokenOf(r2.data.invite_url), "reg-dis");
  const u2 = w2.d.q("SELECT username FROM login_people WHERE id = ?", r2.data.person.id)[0].username;
  w2.d.raw.prepare("UPDATE login_people SET status = 'disabled'").run();
  w2.state.user = authAs(w2, u2, d2.data.token);
  const disabledRes = await w2.F.passkeyRoute(rq("POST", "/api/me/passkeys/start-add", {}, null, "Bearer " + d2.data.token), w2.env, "/api/me/passkeys/start-add", "POST");
  ok(disabledRes.status === 403, "start-add: refused when the person is not active");

  const w3 = world();
  const r3 = await addPerson(w3, "staff", "4075550309", "Five Already");
  const d3 = await completeInvite(w3, tokenOf(r3.data.invite_url), "reg-f1");
  const u3 = w3.d.q("SELECT username FROM login_people WHERE id = ?", r3.data.person.id)[0].username;
  for (let i = 2; i <= 5; i++) {
    const inv = await newInvite(w3, r3.data.person.id, "add");
    w3.state.clockMs += 1000;
    await completeInvite(w3, tokenOf(inv.data.invite_url), "reg-f" + i);
  }
  // Re-sign-in to get a fresh (recent) session for start-add.
  const resignin = await finish(w3, { id: "x", user: "user-0309", reg: "reg-f1" });
  w3.state.user = authAs(w3, u3, resignin.data.token);
  const fiveRes = await w3.F.passkeyRoute(rq("POST", "/api/me/passkeys/start-add", {}, null, "Bearer " + resignin.data.token), w3.env, "/api/me/passkeys/start-add", "POST");
  ok(fiveRes.status === 409, "start-add: refused with 5 passkeys already");

  const noPersonUser = { role: "client", client_id: "c1", username: "pw-only", token_hash: sha("x"), login_role: "client", auth_method: "password" };
  w.state.user = noPersonUser;
  const noRow = await w.F.passkeyRoute(rq("POST", "/api/me/passkeys/start-add", {}, null, "Bearer x"), w.env, "/api/me/passkeys/start-add", "POST");
  ok(noRow.status === 403, "start-add: refused for a session without a login_people row (generic 403)");
}

// ── 7. finish-add rejects a credential whose Stytch user id differs ─────────
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550310", "Finish Add");
  const done = await completeInvite(w, tokenOf(r.data.invite_url), "reg-fa1");
  const username = w.d.q("SELECT username FROM login_people WHERE id = ?", r.data.person.id)[0].username;
  w.state.user = authAs(w, username, done.data.token);
  const start = await w.F.passkeyRoute(rq("POST", "/api/me/passkeys/start-add", {}, null, "Bearer " + done.data.token), w.env, "/api/me/passkeys/start-add", "POST");
  ok(start.status === 200, "(setup) start-add ok");
  const wrong = await w.F.passkeyRoute(rq("POST", "/api/me/passkeys/finish-add", { credential: { id: "x", reg: "reg-fa2", wrongUser: true }, label: "Laptop" }, null, "Bearer " + done.data.token), w.env, "/api/me/passkeys/finish-add", "POST");
  ok(wrong.status === 400, "finish-add: rejects a credential whose Stytch user id differs");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_passkeys WHERE person_id = ?", r.data.person.id)[0].n === 1, "finish-add: nothing inserted on mismatch");
  const good = await w.F.passkeyRoute(rq("POST", "/api/me/passkeys/finish-add", { credential: { id: "x", reg: "reg-fa2" }, label: "Laptop" }, null, "Bearer " + done.data.token), w.env, "/api/me/passkeys/finish-add", "POST");
  ok(good.status === 200 && good.data.added === true, "finish-add: a correct credential adds a new passkey, never revoking others");
  ok(w.d.q("SELECT COUNT(*) AS n FROM login_passkeys WHERE person_id = ? AND revoked_at IS NULL", r.data.person.id)[0].n === 2, "finish-add never revokes anything");
}

// ── 8. a person cannot remove their only active passkey ─────────────────────
{
  const w = world();
  const r = await addPerson(w, "staff", "4075550311", "Only One");
  const done = await completeInvite(w, tokenOf(r.data.invite_url), "reg-only");
  const username = w.d.q("SELECT username FROM login_people WHERE id = ?", r.data.person.id)[0].username;
  const keyId = w.d.q("SELECT id FROM login_passkeys WHERE person_id = ?", r.data.person.id)[0].id;
  w.state.user = authAs(w, username, done.data.token);
  const res = await w.F.passkeyRoute(rq("POST", "/api/me/passkeys/" + keyId + "/remove", {}, null, "Bearer " + done.data.token), w.env, "/api/me/passkeys/" + keyId + "/remove", "POST");
  ok(res.status === 409, "a person cannot remove their only active passkey");
  const inv2 = await newInvite(w, r.data.person.id, "add");
  await completeInvite(w, tokenOf(inv2.data.invite_url), "reg-only2");
  // newInvite/completeInvite act as the owner admin side; switch back to the
  // signed-in person themselves for the self-service remove call.
  w.state.user = authAs(w, username, done.data.token);
  const removeNow = await w.F.passkeyRoute(rq("POST", "/api/me/passkeys/" + keyId + "/remove", {}, null, "Bearer " + done.data.token), w.env, "/api/me/passkeys/" + keyId + "/remove", "POST");
  ok(removeNow.status === 200 && removeNow.data.removed === true, "removing works once a second device exists");
}

// ── 9. every new route is 404 when PASSKEY_LOGIN_ENABLED is not "1" ────────
{
  const w = world({ PASSKEY_LOGIN_ENABLED: "" });
  w.state.user = OWNER;
  const routes = [
    ["GET", "/api/me/passkeys"], ["POST", "/api/me/passkeys/start-add"], ["POST", "/api/me/passkeys/finish-add"],
    ["POST", "/api/me/passkeys/abc/remove"], ["POST", "/api/gm/people/abc/passkeys/def/revoke"],
    ["POST", "/api/gm/people/abc/role"]
  ];
  let all404 = true;
  for (const [m, p] of routes) {
    const r = await w.F.passkeyRoute(rq(m, p, {}), w.env, p, m);
    if (!r || r.status !== 404) { all404 = false; console.log("not 404:", m, p, r); }
  }
  ok(all404, "every new route in this file is 404 when PASSKEY_LOGIN_ENABLED is not \"1\"");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
