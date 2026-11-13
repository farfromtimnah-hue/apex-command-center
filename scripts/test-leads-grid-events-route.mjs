// Behavioral check for the Pipeline spreadsheet usage log (2026-11-13).
//
//   node scripts/test-leads-grid-events-route.mjs
//
// Evals the REAL handlers out of worker/index.js (the block between the
// LEADS GRID EVENTS markers) against a fake D1 that records every statement
// and its bindings, so the assertions exercise shipped code.
//
// Rules proven here:
//   - 401 / 403 / 400 gates, and a seller can post only for their own client.
//   - who, role, login_ref, previewing, ip, geo, ua come from the session and
//     the request, never the body ("at" is ignored too).
//   - cap_reached is server only. detail never holds typed text or a name.
//   - A batch of 25 is ONE db.batch call. The daily safety valve stores
//     nothing, writes one cap_reached row, and still answers 200.
//   - A missing table answers 200 and never throws.
//   - The developer read route: 403 for everyone but the developer, and the
//     "same device: staff and client" flag appears only when it should.
import { readFileSync } from "fs";

const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i + a.length);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + (i < 0 ? a : b)); }
  return src.slice(i, j);
}

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

// ── Fake D1 ───────────────────────────────────────────────────────────────
let db;
function freshDb(opts) {
  db = Object.assign({
    ownedLeads: ["lead-1", "lead-2"],   // leads that belong to client c1
    capCount: 0,
    capRowToday: false,
    missingTable: false,
    devRows: {},
    runs: [],       // statements that reached .run()
    batches: [],    // arrays of {sql,args} handed to DB.batch
    queries: []
  }, opts || {});
}
const respond = (sql, args) => {
  db.queries.push({ sql, args });
  if (db.missingTable && /leads_grid_events/.test(sql)) { throw new Error("no such table: leads_grid_events"); }
  if (/FROM gm_leads/.test(sql)) {
    const ids = args.slice(1);
    return { results: ids.filter(i => db.ownedLeads.indexOf(i) !== -1).map(id => ({ id })) };
  }
  if (/^SELECT COUNT\(\*\) AS n FROM leads_grid_events/.test(sql)) { return { first: { n: db.capCount }, results: [{ n: db.capCount }] }; }
  for (const key of Object.keys(db.devRows)) {
    if (sql.indexOf(key) !== -1) { return { first: null, results: db.devRows[key] }; }
  }
  if (/action = 'cap_reached'/.test(sql)) { return { first: db.capRowToday ? { one: 1 } : null, results: [] }; }
  return { first: null, results: [] };
};
const env = {
  DB: {
    prepare(sql) {
      if (db.missingTable && /leads_grid_events/.test(sql)) { throw new Error("no such table: leads_grid_events"); }
      const mk = (args) => ({
        sql, args,
        first: async () => respond(sql, args).first || null,
        all: async () => ({ results: respond(sql, args).results || [] }),
        run: async () => { db.runs.push({ sql, args }); return { success: true }; }
      });
      return { bind: (...args) => mk(args), ...mk([]) };
    },
    async batch(stmts) {
      if (db.missingTable) { throw new Error("no such table: leads_grid_events"); }
      db.batches.push(stmts.map(s => ({ sql: s.sql, args: s.args })));
      return stmts.map(() => ({ success: true }));
    }
  }
};

// ── Load the real code ────────────────────────────────────────────────────
let currentUser = null;
const authenticate = async () => currentUser;
const src =
  slice(worker, "function jsonOk(data)", "// An error the portal shows in the user's language") +
  slice(worker, "function actorName(user)", "// BUSINESS SYSTEM: clients.plan") +
  slice(worker, "function requireClientAccess(user, clientId)", "// The preview client id when") +
  slice(worker, "// ==== LEADS GRID EVENTS BEGIN ====", "// ==== LEADS GRID EVENTS END ====");
const api = new Function("authenticate", "CORS_HEADERS", "gmActorReplacer", "gmStr",
  src + "\nreturn { handlePostGmLeadsGridEvents, handleGetDevLeadsGridEvents, GRID_EVENT_ACTIONS, GRID_COLUMN_KEYS };")(
  authenticate, {}, undefined, (v, n) => (typeof v === "string" ? v.slice(0, n) : ""));

// ── Helpers ───────────────────────────────────────────────────────────────
const USERS = {
  alice:     { role: "alice", display_name: "Alice", client_id: null },
  rafa:      { role: "rafa", display_name: "Rafa", client_id: null },
  developer: { role: "developer", display_name: "Nicole", client_id: null },
  owner:     { role: "client", login_role: "client", display_name: "Piscinas Sol", client_id: "c1", username: "owner-login-1" },
  seller:    { role: "client", login_role: "seller", seller_name: "Ana Lima", display_name: "Ana Lima", client_id: "c1", username: "ana-login-1" },
  otherOwner:{ role: "client", login_role: "client", display_name: "Outro", client_id: "c2", username: "owner-login-2" }
};
const mkReq = (body, opts) => {
  opts = opts || {};
  const headers = Object.assign({ "CF-Connecting-IP": "203.0.113.9", "User-Agent": "UA-REAL/1.0 " + "x".repeat(300) }, opts.headers || {});
  return {
    url: "https://w.example/api/clients/c1/gm/leads-grid-events" + (opts.query || ""),
    method: "POST",
    headers: { get: (k) => { const key = Object.keys(headers).find(h => h.toLowerCase() === k.toLowerCase()); return key ? headers[key] : null; } },
    cf: opts.cf === undefined ? { country: "US", region: "Florida", city: "Tampa", asn: 7018 } : opts.cf,
    json: async () => { if (body === "BAD") { throw new Error("bad json"); } return body; }
  };
};
const ev = (over) => Object.assign({ action: "sort_set", mode: "read", column_key: "valor", detail: "asc",
  row_count_after: 40, session_ref: "sess-abc123", device_id: "dev-0123456789ab" }, over || {});
const post = async (user, body, opts) => {
  currentUser = user;
  const res = await api.handlePostGmLeadsGridEvents("c1", mkReq(body, opts), env);
  return { status: res.status, body: await res.json() };
};
const insertMap = (stmt) => {
  const cols = /\(([^)]+)\)\s*VALUES/.exec(stmt.sql)[1].split(",").map(s => s.trim());
  const o = {}; cols.forEach((c, i) => { o[c] = stmt.args[i]; }); return o;
};
const inserts = () => db.batches.flat().concat(db.runs).filter(s => /INSERT INTO leads_grid_events/.test(s.sql));

// ── 1. Gates ──────────────────────────────────────────────────────────────
freshDb();
t("not signed in is 401", (await post(null, { events: [ev()] })).status, 401);
t("an owner of ANOTHER client is 403", (await post(USERS.otherOwner, { events: [ev()] })).status, 403);
t("nothing was written for the refused calls", inserts().length, 0);
t("the owner is accepted", (await post(USERS.owner, { events: [ev()] })).status, 200);
t("a seller posting for their own client is accepted", (await post(USERS.seller, { events: [ev()] })).status, 200);
t("staff (alice) is accepted", (await post(USERS.alice, { events: [ev()] })).status, 200);

// ── 2. Bad input is 400 and nothing is written ────────────────────────────
const bad = async (label, body) => {
  freshDb();
  const r = await post(USERS.owner, body);
  t(label + " is 400", r.status, 400);
  t(label + " writes nothing", inserts().length, 0);
};
await bad("an unreadable body", "BAD");
await bad("no events array", {});
await bad("an empty events array", { events: [] });
await bad("26 events", { events: Array.from({ length: 26 }, () => ev()) });
await bad("an unknown action", { events: [ev({ action: "export_csv" })] });
await bad("cap_reached sent by a page", { events: [ev({ action: "cap_reached" })] });
await bad("a bad mode", { events: [ev({ mode: "admin" })] });
await bad("a bad column_key", { events: [ev({ column_key: "password" })] });
await bad("a detail with a space", { events: [ev({ detail: "Maria Silva" })] });
await bad("a detail with a character outside the set", { events: [ev({ detail: "a;b" })] });
await bad("a detail that is a lead name written as one word", { events: [ev({ detail: "Silva" })] });
await bad("a detail longer than 120", { events: [ev({ detail: "1,".repeat(61) })] });
await bad("a lead_id with odd characters", { events: [ev({ lead_id: "x'; DROP" })] });
await bad("a lead_id from ANOTHER client on cell_saved", { events: [ev({ action: "cell_saved", column_key: "valor", detail: "ok", lead_id: "lead-OTHER" })] });
await bad("a lead_id from another client on lead_opened", { events: [ev({ action: "lead_opened", column_key: "", detail: "", lead_id: "lead-OTHER" })] });
await bad("a lead_id from another client on cell_refused", { events: [ev({ action: "cell_refused", column_key: "valor", detail: "refused", lead_id: "lead-OTHER" })] });
await bad("cell_saved without a lead_id", { events: [ev({ action: "cell_saved", column_key: "valor", detail: "ok" })] });
await bad("a bad device_id", { events: [ev({ device_id: "<script>" })] });
await bad("a bad row_count_after", { events: [ev({ row_count_after: -4 })] });

// ── 3. What is stored comes from the session and the request ──────────────
freshDb();
let r = await post(USERS.seller, { events: [Object.assign(ev(), {
  who: "Somebody Else", role: "developer", login_ref: "forged", ip: "6.6.6.6", country: "XX", region: "ZZ",
  city: "Nowhere", asn: "1", ua: "forged-ua", previewing: 1, at: "1999-01-01T00:00:00Z", client_id: "c2" })] });
t("a body that tries to set who, role, geo and ip is still 200", r.status, 200);
let row = insertMap(inserts()[0]);
t("who is the signed in display name", row.who, "Ana Lima");
t("role is seller", row.role, "seller");
t("login_ref is the login's username", row.login_ref, "ana-login-1");
t("client_id is the URL's", row.client_id, "c1");
t("ip comes from CF-Connecting-IP", row.ip, "203.0.113.9");
t("country comes from request.cf", row.country, "US");
t("region comes from request.cf", row.region, "Florida");
t("city comes from request.cf", row.city, "Tampa");
t("asn comes from request.cf", row.asn, "7018");
t("ua is the header cut to 200 characters", row.ua.length, 200);
t("ua starts with the real header", row.ua.indexOf("UA-REAL/1.0"), 0);
t("previewing is 0 for a seller even if the body says 1", row.previewing, 0);
t("created_at is not sent (the database time is used)", "created_at" in row, false);

freshDb();
await post(USERS.owner, { events: [ev()] });
row = insertMap(inserts()[0]);
t("owner role is owner", row.role, "owner");
t("owner who is the client name", row.who, "Piscinas Sol");

freshDb();
await post(USERS.rafa, { events: [ev()] });
row = insertMap(inserts()[0]);
t("staff role is rafa", row.role, "rafa");
t("staff login_ref is null", row.login_ref, null);
t("staff, not previewing, is 0", row.previewing, 0);

freshDb();
await post(USERS.developer, { events: [ev()] }, { query: "?previewAs=c1" });
row = insertMap(inserts()[0]);
t("a developer previewing records the REAL person", row.who + "/" + row.role, "Nicole/developer");
t("a developer previewing is marked previewing 1", row.previewing, 1);

freshDb();
await post(USERS.seller, { events: [ev()] }, { query: "?previewAs=c1" });
t("a client session with a previewAs param is NOT marked previewing", insertMap(inserts()[0]).previewing, 0);

freshDb();
await post(USERS.owner, { events: [ev()] }, { cf: null, headers: { "CF-Connecting-IP": "" } });
row = insertMap(inserts()[0]);
t("no request.cf and no ip store nulls", [row.ip, row.country, row.city, row.asn], [null, null, null, null]);

// ── 4. Batching, valid details, owned leads ───────────────────────────────
freshDb();
r = await post(USERS.owner, { events: Array.from({ length: 25 }, (_, i) => ev({ detail: String(i) })) });
t("a batch of 25 answers 200", r.status, 200);
t("a batch of 25 is ONE db.batch call", db.batches.length, 1);
t("that call holds 25 inserts", db.batches[0].length, 25);
t("no per-row run() calls", db.runs.filter(s => /INSERT/.test(s.sql)).length, 0);

freshDb();
r = await post(USERS.owner, { events: [
  ev({ action: "cell_saved", column_key: "valor", detail: "ok", lead_id: "lead-1", mode: "edit", row_count_after: null }),
  ev({ action: "cell_refused", column_key: "estagio", detail: "refused", lead_id: "lead-2", mode: "edit" }),
  ev({ action: "lead_opened", column_key: "", detail: "", lead_id: "lead-1" }),
  ev({ action: "filter_set", column_key: "origem", detail: "values:3" }),
  ev({ action: "filter_set", column_key: "valor", detail: "between" }),
  ev({ action: "search_used", column_key: "", detail: "len:6" }),
  ev({ action: "column_resized", column_key: "cliente", detail: "w:180" }),
  ev({ action: "view_closed", column_key: "", detail: "" })
] });
t("a mixed valid batch answers 200", r.status, 200);
t("lead ownership is ONE query for the whole batch", db.queries.filter(q => /FROM gm_leads/.test(q.sql)).length, 1);
t("the ownership query is scoped by the URL client", db.queries.find(q => /FROM gm_leads/.test(q.sql)).args[0], "c1");
t("cell_saved stores only column, lead and the word ok", (() => { const m = insertMap(db.batches[0][0]); return [m.column_key, m.lead_id, m.detail]; })(), ["valor", "lead-1", "ok"]);

// ── 5. Safety valve ───────────────────────────────────────────────────────
freshDb({ capCount: 50000 });
r = await post(USERS.owner, { events: [ev(), ev()] });
t("a full day answers 200", r.status, 200);
t("a full day stores no events", db.batches.length, 0);
t("a full day writes ONE cap_reached row", db.runs.filter(s => /INSERT INTO leads_grid_events/.test(s.sql)).length, 1);
t("that row is action cap_reached", insertMap(db.runs[0]).action, "cap_reached");

freshDb({ capCount: 50001, capRowToday: true });
r = await post(USERS.owner, { events: [ev()] });
t("a full day with the marker already written answers 200", r.status, 200);
t("and writes nothing more", inserts().length, 0);

freshDb({ capCount: 49999 });
await post(USERS.owner, { events: [ev()] });
t("just under the limit still stores", inserts().length, 1);
t("the count is one query per request", db.queries.filter(q => /^SELECT COUNT\(\*\) AS n FROM leads_grid_events/.test(q.sql)).length, 1);

// ── 6. Telemetry never breaks the screen ──────────────────────────────────
freshDb({ missingTable: true });
let threw = false;
try { r = await post(USERS.owner, { events: [ev()] }); } catch (e) { threw = true; }
t("a missing table does not throw", threw, false);
t("a missing table answers 200", r.status, 200);
t("a missing table answers ok:true", r.body.ok, true);

// ── 8. Developer read route ───────────────────────────────────────────────
const getDev = async (user, query) => {
  currentUser = user;
  const res = await api.handleGetDevLeadsGridEvents({ url: "https://w.example/api/dev/leads-grid-events" + (query || ""), headers: { get: () => null } }, env);
  return { status: res.status, body: await res.json() };
};
freshDb();
t("dev route: not signed in is 401", (await getDev(null)).status, 401);
for (const who of ["alice", "rafa", "owner", "seller"]) {
  t("dev route: " + who + " is 403", (await getDev(USERS[who])).status, 403);
}
t("dev route: developer is 200", (await getDev(USERS.developer)).status, 200);
t("dev route: a bad client_id is 400", (await getDev(USERS.developer, "?client_id=a%20b")).status, 400);
t("dev route: a bad days is 400", (await getDev(USERS.developer, "?days=abc")).status, 400);

const devRow = (o) => Object.assign({ client_id: "c1", device_id: "dddddd111111", role: "owner", who: "Piscinas Sol", city: "Tampa", country: "US", first_seen: "2026-11-10 14:00:00", last_seen: "2026-11-12 15:00:00", n: 4 }, o);
freshDb({ devRows: { "GROUP BY client_id, device_id": [
  devRow({ role: "rafa", who: "Rafa" }),
  devRow({ role: "owner" }),
  devRow({ device_id: "eeeeee222222", role: "owner" }),
  devRow({ device_id: "ffffff333333", role: "rafa", who: "Rafa" }),
  devRow({ device_id: "none", role: "rafa", who: "Rafa" }),
  devRow({ device_id: "none", role: "owner" })
] } });
let d = (await getDev(USERS.developer)).body;
const flagged = d.devices.filter(x => x.same_device_staff_and_client);
t("the same device with a staff row and an owner row is flagged", flagged.map(x => x.device_short), ["dddddd"]);
t("a device with only an owner is not flagged", d.devices.find(x => x.device_short === "eeeeee").same_device_staff_and_client, false);
t("a device with only staff is not flagged", d.devices.find(x => x.device_short === "ffffff").same_device_staff_and_client, false);
t("device none (storage blocked) is never flagged and never listed", d.devices.some(x => x.device_short === "none"), false);
t("the flagged device lists both names", flagged[0].names.sort(), ["Piscinas Sol", "Rafa"]);
t("the flagged device lists the city", flagged[0].cities, ["Tampa"]);
t("the flag carries no name or verdict", Object.keys(flagged[0]).filter(k => /verdict|culprit|is_rafa/i.test(k)), []);

freshDb({ devRows: { "GROUP BY login_ref": [
  { login_ref: "owner-login-1", client_id: "c1", day: "2026-11-11", country: "US", city: "Tampa" },
  { login_ref: "owner-login-1", client_id: "c1", day: "2026-11-11", country: "BR", city: "Recife" },
  { login_ref: "owner-login-2", client_id: "c1", day: "2026-11-11", country: "US", city: "Tampa" },
  { login_ref: "owner-login-2", client_id: "c1", day: "2026-11-12", country: "US", city: "Tampa" }
] } });
d = (await getDev(USERS.developer)).body;
t("a client login seen in two countries in one day is flagged", d.different_place.map(x => x.login_ref), ["owner-login-1"]);

freshDb({ devRows: { "action = 'cap_reached'": [{ day: "2026-11-12" }] } });
d = (await getDev(USERS.developer)).body;
t("a cap_reached day is reported", Array.isArray(d.cap_days), true);

freshDb();
d = (await getDev(USERS.developer, "?days=500")).body;
t("days above 90 is cut to 90", d.days, 90);
d = (await getDev(USERS.developer)).body;
t("days default is 14", d.days, 14);
t("the dev route only reads (no INSERT, no run)", db.runs.length + db.batches.length, 0);
freshDb({ missingTable: true });
const dm = await getDev(USERS.developer);
t("dev route with a missing table answers 200 with empty lists", [dm.status, dm.body.recent], [200, []]);

// ── 9. The real allowlists let owner and seller reach the route ───────────
{
  const allow = new Function(
    slice(worker, "function clientRequestAllowed(path, method, clientId)", "// Salesperson gate") +
    slice(worker, "function sellerRequestAllowed(path, method, clientId)", "async function enforceClientRoleGate") +
    "return { clientRequestAllowed, sellerRequestAllowed };")();
  const p1 = "/api/clients/c1/gm/leads-grid-events";
  t("owner allowlist: POST leads-grid-events", allow.clientRequestAllowed(p1, "POST", "c1"), true);
  t("seller allowlist: POST leads-grid-events", allow.sellerRequestAllowed(p1, "POST", "c1"), true);
  t("owner allowlist: another client's path is refused", allow.clientRequestAllowed("/api/clients/c2/gm/leads-grid-events", "POST", "c1"), false);
  t("seller allowlist: another client's path is refused", allow.sellerRequestAllowed("/api/clients/c2/gm/leads-grid-events", "POST", "c1"), false);
  t("owner allowlist: GET leads-grid-events is NOT opened", allow.clientRequestAllowed(p1, "GET", "c1"), false);
  t("seller allowlist: GET leads-grid-events is NOT opened", allow.sellerRequestAllowed(p1, "GET", "c1"), false);
  t("the developer log route is not on the owner allowlist", allow.clientRequestAllowed("/api/dev/leads-grid-events", "GET", "c1"), false);
  t("the developer log route is not on the seller allowlist", allow.sellerRequestAllowed("/api/dev/leads-grid-events", "GET", "c1"), false);
}
// The router sends the path to the handler, and the preview gate skips it.
t("router: POST gm/leads-grid-events reaches the handler", /gmCol === "leads-grid-events"\) \{ return handlePostGmLeadsGridEvents\(cid, request, env\)/.test(worker), true);
t("router: GET /api/dev/leads-grid-events reaches the developer handler", /path === "\/api\/dev\/leads-grid-events" && method === "GET"\) \{ return handleGetDevLeadsGridEvents/.test(worker), true);
{
  const gate = new Function("jsonErr", "staffManageBlockedRest", "PREVIEW_READONLY_MSG", "STAFF_MANAGE_BLOCKED_MSG", "DB",
    slice(worker, "async function previewWriteGate(request, env, path)", "function isAdminRole(user)") + "\nreturn previewWriteGate;");
  const noFlagEnv = { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } };
  const g = gate((m, s) => ({ status: s }), () => false, "ro", "blocked", null);
  const mk = (path, method) => ({ url: "https://w.example" + path + "?previewAs=c1", method });
  t("preview gate: the usage log write is let through", await g(mk("/api/clients/c1/gm/leads-grid-events", "POST"), noFlagEnv, "/api/clients/c1/gm/leads-grid-events"), null);
  t("preview gate: a GET-like path change is not exempt (longer path)", (await g(mk("/api/clients/c1/gm/leads-grid-events/x", "POST"), noFlagEnv, "/api/clients/c1/gm/leads-grid-events/x")).status, 403);
  t("preview gate: GET is not exempt by this rule", (await g(mk("/api/clients/c1/gm/leads-grid-events", "PUT"), noFlagEnv, "/api/clients/c1/gm/leads-grid-events")).status, 403);
  t("preview gate: a lead update is still read only", (await g(mk("/api/clients/c1/gm/leads/lead-1", "PUT"), noFlagEnv, "/api/clients/c1/gm/leads/lead-1")).status, 403);
}

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
