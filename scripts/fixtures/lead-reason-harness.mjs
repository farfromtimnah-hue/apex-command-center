// Shared harness for the lead reason, pause and finance tests (2026-11-14).
// The REAL Worker functions are cut out of worker/index.js as source text and
// run against an in-memory SQLite (node:sqlite) that has the live gm_leads
// columns, including the eleven columns added by hand on 2026-11-13 and the
// table gm_lead_other_log (migrations/2026-11-13_lead_reason_pause_finance.sql).
// Only the sign in check and the response wrappers are stubbed. No network, no
// live database.
import { DatabaseSync } from "node:sqlite";
import { fnSrc, varSrc, workerSrc, hasFn } from "./d1-shim.mjs";

export { workerSrc };

export const SCHEMA = `
CREATE TABLE gm_leads (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, mes_lead TEXT, data_lead TEXT, cliente TEXT, telefone TEXT, email TEXT,
  origem TEXT, parceiro_id TEXT, servico TEXT, observacao TEXT, vendedor TEXT, vendedor_secundario TEXT,
  data_contato TEXT, data_estimate TEXT, valor REAL, estagio TEXT, followups INTEGER, proxima_acao TEXT, mes_fechamento TEXT,
  address TEXT, city TEXT, addr_street TEXT, addr_city TEXT, addr_state TEXT, addr_zip TEXT, addr_access TEXT,
  addr_lat REAL, addr_lon REAL, addr_located TEXT, property_county TEXT, property_type TEXT, actual_referrer TEXT,
  servico_desc TEXT, status_financiamento TEXT, commission_review_json TEXT, final_total_cents INTEGER,
  material REAL, mao_de_obra REAL, outros REAL, custo_administrativo REAL, comissao REAL, imposto REAL,
  stage_changed_at TEXT, created_by TEXT, updated_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT,
  lost_reason TEXT, lost_reason_detail TEXT, lost_reason_source TEXT, parsed_from TEXT, paused_until TEXT, paused_at TEXT,
  paused_reason TEXT, finance_status TEXT, finance_status_other TEXT, pause_banner_cleared_at TEXT, pause_banner_cleared_by TEXT
);
CREATE TABLE gm_lead_events (id TEXT PRIMARY KEY, lead_id TEXT, client_id TEXT, action TEXT, field TEXT, old_value TEXT, new_value TEXT, actor TEXT, reason TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE gm_lead_other_log (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, lead_id TEXT, field TEXT NOT NULL, text TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL DEFAULT 'open', handled_at TEXT);
CREATE INDEX idx_gm_other_log_field ON gm_lead_other_log (field, status, created_at);
CREATE TABLE gm_jobs (id TEXT PRIMARY KEY, client_id TEXT, lead_id TEXT, obra TEXT, vendedor TEXT, updated_at TEXT);
CREATE TABLE gm_job_value_history (id TEXT PRIMARY KEY, client_id TEXT, job_id TEXT, lead_id TEXT, entity TEXT, field TEXT, old_value TEXT, new_value TEXT, source TEXT, source_ref TEXT, actor TEXT);
CREATE TABLE gm_notes (id TEXT PRIMARY KEY, client_id TEXT, parent_id TEXT, body TEXT);
CREATE TABLE gm_lead_contacts (id TEXT PRIMARY KEY, client_id TEXT, lead_id TEXT, note TEXT);
CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT, timezone TEXT, location_state TEXT);
CREATE TABLE client_logins (id TEXT, client_id TEXT, role TEXT, seller_name TEXT);
CREATE TABLE gm_seller_login_requests (id TEXT, client_id TEXT, status TEXT, seller_name TEXT);
CREATE TABLE users (id TEXT, role TEXT, display_name TEXT, email TEXT);
`;

export function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const writes = [];
  const clean = (v) => { if (v === undefined) { throw new Error("D1 shim: undefined bound"); } return v === true ? 1 : v === false ? 0 : v; };
  function prepared(sql, args) {
    return {
      sql, args,
      bind: function () { return prepared(sql, Array.prototype.slice.call(arguments).map(clean)); },
      first: async () => { const r = db.prepare(sql).get(...args); return r === undefined ? null : Object.assign({}, r); },
      all: async () => ({ results: db.prepare(sql).all(...args).map((r) => Object.assign({}, r)) }),
      run: async () => { writes.push({ sql, args }); const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
      _sync: () => { writes.push({ sql, args }); const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }
    };
  }
  const DB = {
    prepare: (sql) => prepared(sql, []),
    batch: async (stmts) => {
      db.exec("BEGIN");
      try { const out = stmts.map((s) => s._sync()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    }
  };
  return { DB, raw: db, writes, q: (sql, ...a) => db.prepare(sql).all(...a).map((r) => Object.assign({}, r)) };
}

const OPTIONAL_FNS = ["gmReasonUiHeader", "gmLostReasonCheck", "gmOtherLogStmt", "gmLeadReasonRules", "gmLeadsSummaryRow", "gmLocalTodayFor", "gmLeadIsPausedNow", "gmPauseDateError",
  "handlePostGmLeadPauseBannerClear", "handleGetDevLeadOtherLog"];
const OPTIONAL_VARS = ["GM_LEAD_LOST_REASONS", "GM_US_STATES", "GM_FINANCE_STATUSES", "GM_LEAD_REASON_COLS", "GM_NOT_PAUSED_SQL", "GM_LEAD_RULE_BODY_KEYS"];

// Loads the real functions. Pieces that do not exist yet are simply left out,
// so a test written before the change fails on its assertions, not on setup.
export function loadWorker(stubs) {
  const stubNames = Object.keys(stubs);
  const fns = ["gmActorReplacer", "jsonOk", "jsonErr", "actorName", "requireClientAccess", "isAdminRole", "sessionSellerName", "sellerCanActOnLead",
    "effectiveSellerName", "previewSellerName",
    "gmStr", "gmNum", "gmOwnedRow", "gmLeadEmailOk", "gmManualPosition", "gmLeadAddressChanged", "gmLeadGeocodeIfNeeded",
    "gmLeadFields", "gmLogLeadEvents", "gmInsertLead", "handlePutGmLead", "handlePostGmLead", "handleGetGmLeads", "gmEstimatePriceSql", "clientRequestAllowed", "sellerRequestAllowed", "gmValueWriteStmts",
    "gmGuardedValorExpr", "gmGuardedFinalCentsExpr", "gmDealFinalCents", "gmStageKey",
    "tzIsValid", "tzZoneForState", "tzParts", "tzPad2", "tzLocalNowStamp", "clientZoneFor", "resolveRequestZone"]
    .concat(OPTIONAL_FNS.filter(hasFn));
  const vars = ["DEFAULT_ORIGIN", "CORS_HEADERS", "GM_ACTOR_KEY_RE", "GM_HIDDEN_ACTORS", "GM_LEAD_COST_FIELDS", "GM_LEAD_LOGGED_FIELDS", "TZ_STATE_ZONES", "TZ_STATE_NAMES", "APEX_TIMEZONE", "GM_FINAL_CENTS_JOB_SQL", "GM_FINAL_CENTS_LEAD_SQL"]
    .concat(OPTIONAL_VARS.filter((v) => workerSrc.indexOf("\nvar " + v + " =") >= 0));
  const stageBlock = workerSrc.slice(workerSrc.indexOf("var GM_STAGE_DEFS = ["), workerSrc.indexOf("function gmStageKey(v)"));
  const all = fns.concat(vars);
  const body = vars.map((v) => varSrc(v)).join("\n") + "\n" + stageBlock + "\n" + fns.map((n) => fnSrc(n)).join("\n") +
    "\nreturn { " + all.join(", ") + " };";
  return new Function(...stubNames, body)(...stubNames.map((k) => stubs[k]));
}

export function makeStubs(state) {
  return {
    authenticate: async () => state.user,
    crypto: { randomUUID: () => "id-" + Math.random().toString(36).slice(2, 12) },
    // Not under test here: the address lookup is never reached without an address change.
    geocodeAddress: async () => ({ lat: null, lon: null, located: null }),
    gmGetConfig: async () => ({ target_margin: null }),
    gmJobComputed: () => ({})
  };
}

// A request. headers is a plain object, looked up without case.
export function mkReq(body, headers, url) {
  const h = headers || {};
  return {
    url: url || "https://w.example/api/clients/c1/gm/leads",
    method: "PUT",
    headers: { get: (k) => { const key = Object.keys(h).find((x) => x.toLowerCase() === k.toLowerCase()); return key ? h[key] : null; } },
    json: async () => { if (body === "BAD") { throw new Error("bad json"); } return body; }
  };
}

export const USERS = {
  owner:     { role: "client", login_role: "client", display_name: "Piscinas Sol", client_id: "c1", username: "owner-1" },
  seller:    { role: "client", login_role: "seller", seller_name: "Ana Lima", display_name: "Ana Lima", client_id: "c1", username: "ana-1" },
  otherOwner:{ role: "client", login_role: "client", display_name: "Outro", client_id: "c2", username: "owner-2" },
  alice:     { role: "alice", display_name: "Alice" },
  rafa:      { role: "rafa", display_name: "Rafa" },
  developer: { role: "developer", display_name: "Nicole" }
};

export const UI = { "X-Apex-Reason-UI": "1" };
export const NY = { "X-Client-Tz": "America/New_York" };
