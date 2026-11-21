// The financial report's PDF link (docs PDF system, kind "finance-report"):
// the REAL Worker functions (token, parameter checks, client gate, link
// handler) on an in-memory SQLite. No network, no browser, no production
// database.
//
//   node scripts/test-finance-report-pdf.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const FNS = [
  "docPdfReportParams", "docPdfB64url", "docPdfHmac", "docPdfMintToken", "docPdfVerifyToken", "docPdfRenderQuery",
  "docPdfRenderSession", "docPdfById", "docPdfFileName", "handlePostDocPdfLink", "requireClientAccess",
  "enforceClientRoleGateChecks", "clientRequestAllowed", "sellerRequestAllowed", "sessionSellerName", "loginRoleDenied",
  "loginRoleRuleHit", "isAdminRole"
];
const VARS = [
  "DOC_PDF_KINDS", "DOC_PDF_TOKEN_TTL_MS", "LOGIN_ROLE_DENY_OWNER_ONLY", "LOGIN_ROLE_DENY_SETTINGS", "LOGIN_ROLE_DENY_MONEY",
  "LOGIN_FINANCE_VIEW_RE", "LOGIN_CLIENT_ROUTE_RE"
];

const d = makeDb();
d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'My Pure Filter')").run();
d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c2', 'Other Co')").run();
const env = { DB: d.DB, DOC_PDF_SECRET: "test-secret-1234567890" };

// Who each Authorization header is.
const SESSIONS = {
  "Bearer owner1": { role: "client", client_id: "c1", login_role: "client", seller_name: null },
  "Bearer owner2": { role: "client", client_id: "c2", login_role: "client", seller_name: null },
  "Bearer seller1": { role: "client", client_id: "c1", login_role: "seller", seller_name: "Rafa" },
  "Bearer nobody": null
};
let F;
const stubs = Object.assign({}, baseStubs, {
  jsonErr2: (pt, en, status) => ({ status: status || 400, error: en }),
  authenticate: async (request) => {
    const a = request.headers.get("Authorization") || "";
    if (a.indexOf("Bearer rndr_") === 0) { return F.docPdfRenderSession(a.slice(7), env); }
    return SESSIONS[a] || null;
  },
  // The replayed GET goes through the SAME client gate the real route does,
  // then the report route's own access check.
  handleFetch: async (request) => {
    const url = new URL(request.url);
    const user = await stubs.authenticate(request);
    if (!user) { return { ok: false, status: 401 }; }
    const gate = await F.enforceClientRoleGateChecks(request, env, url.pathname, request.method, user);
    if (gate) { return { ok: false, status: gate.status }; }
    const m = /^\/api\/clients\/([^/]+)\/gm\/finance\/report$/.exec(url.pathname);
    if (!m) { return { ok: false, status: 404 }; }
    if (!F.requireClientAccess(user, m[1])) { return { ok: false, status: 403 }; }
    return { ok: true, status: 200 };
  },
  Request: class { constructor(u, init) { this.url = u; this.method = init.method; this.headers = { get: (k) => init.headers[k] || null }; } }
});
F = build(FNS, VARS, stubs);

const GOOD = { from: "2026-10-01", to: "2026-10-31", open: 125000, for: "Alice Smith", title: "October report", lang: "en" };
const post = (auth, report, extra) => ({
  method: "POST", url: "https://api.test/api/clients/c1/gm/pdf-link" + ((extra && extra.search) || ""),
  headers: { get: (k) => (k === "Authorization" ? auth : null) },
  json: async () => ({ kind: "finance-report", id: "report", lang: "en", report })
});

// ── Parameters ──────────────────────────────────────────────────────────
ok(!!F.docPdfReportParams(GOOD).p, "good parameters are accepted");
const bad = (label, patch) => ok(!!F.docPdfReportParams(Object.assign({}, GOOD, patch)).error, "rejected: " + label);
bad("date not a date", { from: "2026-13-40" });
bad("date wrong shape", { to: "10/31/2026" });
bad("date missing", { from: undefined });
bad("start after end", { from: "2026-11-01", to: "2026-10-01" });
bad("opening balance fractional", { open: 12.5 });
bad("opening balance text", { open: "lots" });
bad("opening balance too big", { open: 1e13 });
bad("opening balance too negative", { open: -1e13 });
bad("for is not text", { for: { x: 1 } });
const long = F.docPdfReportParams(Object.assign({}, GOOD, { for: "x".repeat(500), title: "<b>Hi</b>\u0007\n there" })).p;
ok(long && long.w.length === 120, "long 'for' text is capped at 120 characters");
ok(long && long.h === "b Hi /b there", "title is cleaned of angle brackets and control characters: " + (long && long.h));
ok(F.docPdfReportParams(Object.assign({}, GOOD, { open: undefined })).p.o === 0, "no opening balance means 0");

// ── Link handler: access ────────────────────────────────────────────────
let res = await F.handlePostDocPdfLink("c1", post("Bearer owner1", GOOD), env, {});
ok(res.status === 200 && /\/api\/pdf\/r\/rndr_/.test(res.data.url), "owner gets a link");
const url1 = res.data.url, tok1 = url1.split("/api/pdf/r/")[1].split("?")[0];
ok(/lang=en|^[^?]*$/.test(url1), "link is the Worker's /api/pdf/r/ route");

res = await F.handlePostDocPdfLink("c1", post("Bearer owner1", Object.assign({}, GOOD, { to: "nope" })), env, {});
ok(res.status === 400, "bad parameter is refused with 400 and no link");
res = await F.handlePostDocPdfLink("c1", post("Bearer seller1", GOOD), env, {});
ok(res.status === 403, "a seller gets the same refusal the report route gives (403)");
res = await F.handlePostDocPdfLink("c1", post("Bearer owner2", GOOD), env, {});
ok(res.status === 403, "another client's owner is refused (403)");
res = await F.handlePostDocPdfLink("c1", post("Bearer nobody", GOOD), env, {});
ok(res.status === 401, "no session is refused (401)");

// ── Token: exactly this report ──────────────────────────────────────────
const claims = await F.docPdfVerifyToken(env, tok1);
ok(claims && claims.k === "finance-report" && claims.c === "c1" && claims.p.f === "2026-10-01" && claims.p.t === "2026-10-31" && claims.p.o === 125000, "token carries the signed parameters");
const sess = await F.docPdfRenderSession(tok1, env);
const get = (path, search, auth, method) => F.enforceClientRoleGateChecks({ url: "https://api.test" + path + (search || "") }, env, path, method || "GET", sess);
const REP = "/api/clients/c1/gm/finance/report";
ok((await get(REP, "?from=2026-10-01&to=2026-10-31")) === null, "token may GET its own report for its own dates");
ok((await get(REP, "?to=2026-10-31&from=2026-10-01")) === null, "same dates in another order are the same request");
ok((await get(REP, "?from=2026-10-01&to=2026-11-30")).status === 403, "token cannot fetch a different period");
ok((await get(REP, "?from=2026-09-01&to=2026-10-31")).status === 403, "token cannot fetch a different start date");
ok((await get(REP, "")).status === 403, "token cannot fetch with no dates (the whole ledger)");
ok((await get(REP, "?from=2026-10-01&to=2026-10-31&previewAs=x")).status === 403, "token cannot add other parameters");
ok((await get("/api/clients/c2/gm/finance/report", "?from=2026-10-01&to=2026-10-31")).status === 403, "token cannot fetch a different client's report");
ok((await get("/api/clients/c1/gm/finance", "?from=2026-10-01&to=2026-10-31")).status === 403, "token cannot fetch the finance list");
ok((await get(REP, "?from=2026-10-01&to=2026-10-31", null, "POST")).status === 403, "token cannot POST");
ok(sess.client_id === "c1" && sess.auth_method === "render", "render session is for the signed client only");

// ── Token: tampering and expiry ─────────────────────────────────────────
const [body, sig] = tok1.slice(5).split(".");
const forged = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
forged.p.t = "2026-12-31";
const forgedBody = Buffer.from(JSON.stringify(forged)).toString("base64url");
ok((await F.docPdfVerifyToken(env, "rndr_" + forgedBody + "." + sig)) === null, "changing the dates inside the token breaks the signature");
ok((await F.docPdfVerifyToken(env, "rndr_" + body + "." + sig.slice(0, -2) + "xx")) === null, "a bad signature is refused");
ok((await F.docPdfVerifyToken({ DB: d.DB, DOC_PDF_SECRET: "another-secret-xxxxxxxx" }, tok1)) === null, "a token signed with another secret is refused");
const realNow = Date.now;
Date.now = () => realNow() + 10 * 60 * 1000 + 1000;
ok((await F.docPdfVerifyToken(env, tok1)) === null, "token expires after 10 minutes");
ok((await F.docPdfRenderSession(tok1, env)) === null, "an expired token gives no session");
Date.now = realNow;
ok(!!(await F.docPdfVerifyToken(env, tok1)), "token is still good inside its 10 minutes");

// A token for another kind cannot be turned into a report token.
const otherBody = Buffer.from(JSON.stringify({ k: "ack", c: "c1", i: "abc", x: Date.now() + 60000 })).toString("base64url");
const otherTok = "rndr_" + otherBody + "." + (await F.docPdfHmac(env, otherBody));
const otherSess = await F.docPdfRenderSession(otherTok, env);
ok(otherSess && otherSess.render_query === "" && (await F.enforceClientRoleGateChecks({ url: "https://api.test" + REP + "?from=2026-10-01&to=2026-10-31" }, env, REP, "GET", otherSess)).status === 403, "an ack token cannot read the report");
// A signed report token whose parameters are bad is refused too.
const badBody = Buffer.from(JSON.stringify({ k: "finance-report", c: "c1", i: "report", x: Date.now() + 60000, p: { f: "bad", t: "2026-10-31" } })).toString("base64url");
ok((await F.docPdfVerifyToken(env, "rndr_" + badBody + "." + (await F.docPdfHmac(env, badBody)))) === null, "a validly signed token with bad parameters is refused");

// ── File name and kind rules ────────────────────────────────────────────
const doc = await F.docPdfById(env, "finance-report", "c1", "report", claims.p);
ok(doc && doc.final === false && doc.token === null, "the report is never final and has no stored copy");
ok(F.docPdfFileName(doc, "My Pure Filter") === "Financial report - My Pure Filter - 2026-10-01 to 2026-10-31.pdf", "file name: " + F.docPdfFileName(doc, "My Pure Filter"));
ok((await F.docPdfById(env, "finance-report", "nope", "report", claims.p)) === null, "unknown client has no report");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
