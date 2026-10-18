// People and access roles (passkey login build): the REAL client gate
// (enforceClientRoleGate + clientRequestAllowed + sellerRequestAllowed +
// loginRoleDenied) and the REAL people handlers on an in-memory SQLite. No
// network, no production database.
//
//   node scripts/test-people-roles.mjs
import { execSync } from "node:child_process";
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const GATE_FNS = ["enforceClientRoleGate", "clientRequestAllowed", "sellerRequestAllowed", "sessionSellerName", "loginRoleRuleHit", "loginRoleDenied"];
const GATE_VARS = ["LOGIN_ROLE_DENY_OWNER_ONLY", "LOGIN_ROLE_DENY_SETTINGS", "LOGIN_ROLE_DENY_MONEY"];

let currentUser = null;
const stubs = Object.assign({}, baseStubs, { authenticate: async () => currentUser });
const G = build(GATE_FNS, GATE_VARS, stubs);

const C = "c1";
const B = "/api/clients/" + C;
function rq(method, path) {
  return { method, url: "https://apex-api.test" + path, headers: { get: (k) => (k === "Authorization" ? "Bearer capt_x" : null) }, json: async () => ({}) };
}
const sess = (login_role, extra) => Object.assign({ role: "client", client_id: C, login_role, auth_method: "password", must_change_password: false, display_name: "X", seller_name: login_role === "seller" ? "Rui" : null }, extra || {});
async function gate(user, method, path) {
  currentUser = user;
  const r = await G.enforceClientRoleGate(rq(method, path), {}, path, method);
  return r ? r.status : 200;   // 200 = the gate lets it through to the handler
}

// The exact lists, with the status each role must get. Owner status shown for
// reference: a path the owner cannot reach is closed to every new role too.
const OWNER_ONLY = [
  ["POST", "/api/auth/client-change-password"],
  ["POST", "/api/auth/client-link-google"],
  ["POST", B + "/login"],
  ["DELETE", B], ["PUT", B], ["PATCH", B],
  ["PUT", B + "/archive"]
];
const SETTINGS = [
  ["PUT", B + "/work-settings"], ["POST", B + "/blocked-ranges"], ["DELETE", B + "/blocked-ranges/r1"],
  ["PUT", B + "/referral-settings"], ["POST", B + "/logo"], ["PUT", B + "/gm/config"], ["PUT", B + "/gm/booking-settings"],
  ["PUT", B + "/gm/doc-settings"], ["PUT", B + "/gm/doc-hero-choice"], ["POST", B + "/gm/doc-hero"], ["PUT", B + "/gm/contract-settings"],
  ["POST", B + "/gm/stripe/connect"], ["POST", B + "/gm/stripe/disconnect"], ["POST", B + "/gm/stripe/reaccept"],
  ["POST", B + "/gm/stripe/tap/enable"], ["POST", B + "/gm/stripe/tap/disable"],
  ["POST", B + "/gm/meta/connect"], ["POST", B + "/gm/meta/pages"], ["POST", B + "/gm/meta/disconnect"],
  ["POST", "/api/gm/seller-login-requests"], ["GET", B + "/seller-logins"], ["GET", B + "/gm/seller-login-requests"],
  ["GET", "/api/gm/people"], ["POST", "/api/gm/people"],
  ["POST", "/api/gm/people/p1/invite"], ["POST", "/api/gm/people/p1/disable"], ["POST", "/api/gm/people/p1/enable"]
];
const MONEY = [
  ["GET", B + "/gm/finance"], ["GET", B + "/gm/finance/report"], ["POST", B + "/gm/finance"],
  ["PUT", B + "/gm/finance/f1"], ["DELETE", B + "/gm/finance/f1"],
  ["GET", B + "/gm/invoices"], ["GET", B + "/gm/invoices/i1"],
  ["POST", B + "/gm/jobs/j1/invoices-from-estimate"],
  ["POST", B + "/gm/invoices/i1/send"], ["POST", B + "/gm/invoices/i1/send-link"], ["POST", B + "/gm/invoices/i1/payments"],
  ["POST", B + "/gm/invoices/i1/void"], ["POST", B + "/gm/invoices/i1/credits"], ["POST", B + "/gm/invoices/i1/late-fee"],
  ["POST", B + "/gm/invoices/i1/disable-link"], ["POST", B + "/gm/invoices/i1/enable-link"],
  ["POST", B + "/gm/receipts/r1/disable-link"], ["POST", B + "/gm/receipts/r1/enable-link"],
  ["POST", B + "/gm/payments/p1/verify"], ["POST", B + "/gm/payments/p1/reject"], ["POST", B + "/gm/payments/p1/reverse"],
  ["POST", B + "/gm/payments/p1/receipt-message"],
  ["GET", B + "/gm/stripe/status"], ["GET", B + "/gm/stripe/tap"],
  ["POST", B + "/gm/stripe/tap/connection-token"], ["POST", B + "/gm/stripe/tap/payment-intent"], ["POST", B + "/gm/stripe/tap/shared-details"],
  ["GET", B + "/gm/jobs/j1/value-history"], ["GET", B + "/gm/leads/l1/value-history"],
  ["GET", B + "/invoices"],
  ["GET", B + "/entries"], ["GET", B + "/entries-summary"], ["GET", B + "/indicator-history"], ["GET", B + "/goal-state"],
  ["PUT", B + "/goals"], ["PUT", B + "/entries/2026-10-01/sections/vendas"], ["POST", B + "/entries/2026-10-01/day-off"]
];
// Owner tools every new role keeps.
const KEEP = [
  ["GET", "/api/role"], ["GET", "/api/portal/me"], ["POST", "/api/auth/client-logout"],
  ["GET", B], ["GET", B + "/gm/leads"], ["POST", B + "/gm/leads"], ["PUT", B + "/gm/leads/l1"], ["GET", B + "/gm/jobs"],
  ["GET", B + "/gm/estimates"], ["POST", B + "/gm/estimates"], ["GET", B + "/gm/contracts"], ["GET", B + "/gm/events"],
  ["GET", B + "/gm/pricing"], ["GET", B + "/gm/doc-settings"], ["GET", B + "/documents"], ["GET", B + "/tasks"],
  ["GET", B + "/gm/roadmap"], ["GET", B + "/field-config"], ["GET", B + "/work-settings"]
];

async function statuses(user, list) {
  const out = [];
  for (const [m, p] of list) { out.push([m, p, await gate(user, m, p)]); }
  return out;
}
const allIs = (rows, s) => rows.every((r) => r[2] === s);
const listBad = (rows, s) => rows.filter((r) => r[2] !== s).map((r) => r[0] + " " + r[1] + " -> " + r[2]).join("; ");

{
  const partner = sess("partner"), sf = sess("staff_finance"), st = sess("staff");
  const pOwner = await statuses(partner, OWNER_ONLY), fOwner = await statuses(sf, OWNER_ONLY), sOwner = await statuses(st, OWNER_ONLY);
  ok(allIs(pOwner, 403) && allIs(fOwner, 403) && allIs(sOwner, 403), "owner-only list (" + OWNER_ONLY.length + " paths): 403 for partner, staff_finance and staff " + listBad(pOwner.concat(fOwner, sOwner), 403));
  const pSet = await statuses(partner, SETTINGS);
  ok(pSet.filter((r) => r[1].indexOf("/api/gm/people") !== 0).every((r) => r[2] === 200) &&
     pSet.filter((r) => r[1].indexOf("/api/gm/people") === 0).every((r) => r[2] === 200),
     "partner keeps Settings, Stripe, Tap to Pay, social connect and people management (" + SETTINGS.length + " paths reach the handler) " + listBad(pSet, 200));
  const fSet = await statuses(sf, SETTINGS), sSet = await statuses(st, SETTINGS);
  ok(allIs(fSet, 403), "staff_finance: Settings and people list (" + SETTINGS.length + " paths) all 403 " + listBad(fSet, 403));
  ok(allIs(sSet, 403), "staff: Settings and people list all 403 " + listBad(sSet, 403));
  const pMoney = await statuses(partner, MONEY), fMoney = await statuses(sf, MONEY), sMoney = await statuses(st, MONEY);
  ok(allIs(pMoney, 200) && allIs(fMoney, 200), "partner and staff_finance keep Finance, Invoices and money totals (" + MONEY.length + " paths) " + listBad(pMoney.concat(fMoney), 200));
  ok(allIs(sMoney, 403), "staff (no finance): Finance, Invoices and money list (" + MONEY.length + " paths) all 403 " + listBad(sMoney, 403));
  for (const u of [partner, sf, st]) {
    const k = await statuses(u, KEEP);
    ok(allIs(k, 200), u.login_role + " keeps the ordinary owner tools (" + KEEP.length + " paths) " + listBad(k, 200));
  }
  // Never wider than the owner: a path the owner cannot reach.
  for (const u of [partner, sf, st]) {
    ok((await gate(u, "GET", "/api/clients/c2")) === 403 && (await gate(u, "GET", "/api/clients/c2/gm/leads")) === 403 && (await gate(u, "GET", "/api/sessions/inbox")) === 403,
      u.login_role + ": another business and admin routes stay closed");
  }
  ok((await gate(sess("weird_role"), "GET", B + "/gm/leads")) === 403, "an unknown login_role fails closed (403), never owner");
  // Print the exact lists for the report.
  console.log("\n   DENY partner (+ staff_finance + staff): " + OWNER_ONLY.map((r) => r.join(" ")).join(", "));
  console.log("   DENY staff_finance (+ staff): " + SETTINGS.map((r) => r.join(" ")).join(", "));
  console.log("   DENY staff only: " + MONEY.map((r) => r.join(" ")).join(", ") + "\n");
}

// ── Owner and seller unchanged against the code before this build ─────────
{
  let mainSrc = null;
  try { mainSrc = execSync("git show 686f3a2:worker/index.js", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { mainSrc = null; }
  const corpus = OWNER_ONLY.concat(SETTINGS, MONEY, KEEP, [
    ["GET", B + "/gm/partners"], ["POST", B + "/gm/pdf-link"], ["DELETE", B + "/gm/leads/l1"], ["PATCH", B + "/gm/leads/l1/contacts/x"],
    ["GET", "/api/gm/seller-login-requests"], ["POST", "/api/gm/seller-login-requests/r1/approve"], ["GET", "/api/clients"]
  ]).filter((r) => r[1].indexOf("/api/gm/people") !== 0);
  const owner = sess("client"), google = { role: "client", client_id: C, auth_method: "google" }, seller = sess("seller");
  if (!mainSrc) {
    ok(true, "(skipped: commit 686f3a2 not available for the before/after comparison)");
  } else {
    const OLD = build(["enforceClientRoleGate", "clientRequestAllowed", "sellerRequestAllowed", "sessionSellerName"], [], stubs, mainSrc);
    let diffs = [];
    for (const u of [owner, google, seller]) {
      for (const [m, p] of corpus) {
        currentUser = u;
        const a = await G.enforceClientRoleGate(rq(m, p), {}, p, m);
        const b = await OLD.enforceClientRoleGate(rq(m, p), {}, p, m);
        if ((a ? a.status : 200) !== (b ? b.status : 200)) { diffs.push((u.login_role || "google") + " " + m + " " + p); }
      }
    }
    ok(diffs.length === 0, "owner (password and Google) and seller: identical gate result to main on " + corpus.length + " paths each " + diffs.join("; "));
  }
  ok((await gate(owner, "GET", "/api/gm/people")) === 200 && (await gate(owner, "POST", "/api/gm/people/p1/disable")) === 200, "owner reaches the new people routes");
  ok((await gate(seller, "GET", "/api/gm/people")) === 403 && (await gate(seller, "POST", "/api/gm/people")) === 403, "seller cannot reach people routes");
  // SELLER_TABS shape untouched in portal.html.
  const portal = (await import("node:fs")).readFileSync(new URL("../portal.html", import.meta.url), "utf8");
  ok(portal.indexOf('var SELLER_TABS = ["gmcrm", "gmjobs", "gmpricing", "gmestimates", "gmcontracts", "gmcalendar", "documents"];') !== -1, "portal.html SELLER_TABS unchanged");
}

// ── People handlers: who may manage whom ───────────────────────────────────
const P_FNS = [
  "passkeyPeopleActor", "passkeyMayManage", "passkeyPublicPerson", "passkeyInviterName", "passkeyInviteResponse",
  "passkeyForbidden", "handleGetGmPeople", "handlePostGmPeople", "passkeyLoadPersonFor", "handlePostGmPersonInvite",
  "handlePostGmPersonStatus", "handleGmOwnerInvite", "passkeyCreateInvite", "passkeyNewToken", "passkeyB64url",
  "passkeyNormalizePhone", "passkeyPhoneError", "passkeyMaskPhone", "passkeyFirstName", "passkeyAppReady",
  "passkeyInviteMessage", "passkeyInviteMessageFor", "passkeyIso", "isAdminRole", "gmStr", "sha256Hex"
];
const P_VARS = ["PASSKEY_INVITE_URL", "PASSKEY_APP_STORE_URL", "PASSKEY_INVITE_HOURS", "PASSKEY_PERSON_ROLES", "PASSKEY_ROLE_LABELS"];
function pworld() {
  const d = makeDb(["migrations/passkey_login.sql"]);
  d.raw.exec("CREATE TABLE client_logins (username TEXT PRIMARY KEY, client_id TEXT NOT NULL, password_hash TEXT NOT NULL, must_change_password INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL DEFAULT 'client', seller_name TEXT, created_by TEXT, last_login_at TEXT, UNIQUE (client_id, seller_name))");
  d.raw.exec("CREATE TABLE client_auth_tokens (token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, username TEXT NOT NULL, expires_at TEXT NOT NULL)");
  d.raw.prepare("INSERT INTO clients (id, name, owners, whatsapp) VALUES ('c1', 'Acme', 'Maria', '4075550101')").run();
  d.raw.prepare("INSERT INTO clients (id, name, owners, whatsapp) VALUES ('c2', 'Other', 'Ana', '4075550202')").run();
  const st = { user: null };
  const F = build(P_FNS, P_VARS, Object.assign({}, baseStubs, {
    authenticate: async () => st.user,
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status || 400, error: en, error_pt: pt }, extra || {}),
    passkeyNow: () => new Date(),
    actorName: (u) => (u && (u.display_name || u.role)) || null
  }));
  return { d, F, st, env: { DB: d.DB } };
}
const preq = (method, path, body) => ({ method, url: "https://apex-api.test" + path, headers: { get: () => null }, json: async () => body || {} });
{
  const w = pworld();
  const OWN = sess("client"), PART = sess("partner", { display_name: "Paula" });
  w.st.user = PART;
  const pp = await w.F.handlePostGmPeople(preq("POST", "/api/gm/people", { name: "Second Partner", role: "partner", phone: "4075550301" }), w.env);
  ok(pp.status === 403, "partner cannot create a partner");
  const made = {};
  for (const role of ["staff_finance", "staff", "seller"]) {
    const r = await w.F.handlePostGmPeople(preq("POST", "/api/gm/people", { name: "N " + role, role, phone: "40755503" + (10 + Object.keys(made).length) }), w.env);
    made[role] = r;
  }
  ok(Object.values(made).every((r) => r.status === 200), "partner can create staff_finance, staff and seller");
  ok(/^Olá N! Paula convidou/.test(made.staff.data.message), "a partner's invite names the partner as the inviter");
  w.st.user = OWN;
  const op = await w.F.handlePostGmPeople(preq("POST", "/api/gm/people", { name: "Real Partner", role: "partner", phone: "4075550399" }), w.env);
  ok(op.status === 200 && op.data.person.role === "partner", "owner can create a partner");
  const partnerId = op.data.person.id;
  w.st.user = PART;
  ok((await w.F.handlePostGmPersonStatus(partnerId, "disable", preq("POST", "/x"), w.env)).status === 403, "partner cannot disable (remove) a partner");
  ok((await w.F.handlePostGmPersonInvite(partnerId, preq("POST", "/x"), w.env)).status === 403, "partner cannot re-invite a partner");
  ok((await w.F.handlePostGmPersonStatus(made.staff.data.person.id, "disable", preq("POST", "/x"), w.env)).status === 200, "partner can disable staff");
  // The owner's own login.
  w.st.user = { role: "rafa", display_name: "Rafa" };
  const oi = await w.F.handleGmOwnerInvite("c1", preq("POST", "/api/gm/clients/c1/owner-invite", {}), w.env);
  ok(oi.status === 200, "(setup) owner person created by an admin");
  const ownerPid = w.d.q("SELECT id FROM login_people WHERE role = 'client' AND client_id = 'c1'")[0].id;
  w.st.user = PART;
  ok((await w.F.handlePostGmPersonStatus(ownerPid, "disable", preq("POST", "/x"), w.env)).status === 403 &&
     (await w.F.handlePostGmPersonInvite(ownerPid, preq("POST", "/x"), w.env)).status === 403,
     "partner cannot disable or re-link the owner's login");
  w.st.user = OWN;
  ok((await w.F.handlePostGmPersonStatus(ownerPid, "disable", preq("POST", "/x"), w.env)).status === 403, "the owner cannot disable the owner login either (admin only)");
  ok((await w.F.handlePostGmPersonInvite(ownerPid, preq("POST", "/x"), w.env)).status === 200, "the owner can send themself a new link (new phone)");
  w.st.user = { role: "alice", display_name: "Alice" };
  ok((await w.F.handlePostGmPersonStatus(ownerPid, "disable", preq("POST", "/x"), w.env)).status === 200, "an admin can disable the owner login");
  // Other business.
  w.st.user = sess("client", { client_id: "c2" });
  ok((await w.F.handlePostGmPersonStatus(made.seller.data.person.id, "disable", preq("POST", "/x"), w.env)).status === 403 &&
     (await w.F.handlePostGmPersonInvite(made.seller.data.person.id, preq("POST", "/x"), w.env)).status === 403,
     "an owner cannot touch another business's people");
  const list2 = await w.F.handleGetGmPeople(preq("GET", "/api/gm/people?client_id=c1"), w.env);
  ok(list2.status === 403, "an owner cannot list another business's people by passing client_id");
  w.st.user = OWN;
  const list1 = await w.F.handleGetGmPeople(preq("GET", "/api/gm/people"), w.env);
  ok(list1.status === 200 && list1.data.people.length === 5 && list1.data.people.every((p) => /^•/.test(p.masked_phone)) && JSON.stringify(list1.data).indexOf("+1407") === -1, "owner lists their people with masked phones only");
  ok(list1.data.can_manage_partner === true, "owner list says it can manage partners");
  w.st.user = PART;
  ok((await w.F.handleGetGmPeople(preq("GET", "/api/gm/people"), w.env)).data.can_manage_partner === false, "partner list says it cannot manage partners");
  // Staff and seller sessions are refused by the handler itself too.
  for (const lr of ["staff_finance", "staff", "seller"]) {
    w.st.user = sess(lr);
    ok((await w.F.handleGetGmPeople(preq("GET", "/api/gm/people"), w.env)).status === 403, lr + " refused by the people handler (second wall)");
  }
  // Admin routes: alice, rafa and developer only.
  for (const role of ["alice", "rafa", "developer"]) {
    w.st.user = { role, display_name: role };
    ok((await w.F.handleGmOwnerInvite("c2", preq("GET", "/x"), w.env)).status === 200, "owner-invite allowed for " + role);
    ok((await w.F.handleGetGmPeople(preq("GET", "/api/gm/people?client_id=c1"), w.env)).status === 200, "people list for any client allowed for " + role);
  }
  for (const u of [OWN, PART, sess("staff"), sess("seller"), { role: "vault-service" }, { role: "client_admin_typo" }]) {
    w.st.user = u;
    ok((await w.F.handleGmOwnerInvite("c1", preq("POST", "/x", {}), w.env)).status === 403, "owner-invite refused for " + (u.login_role || u.role));
  }
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
