// handleDeleteGmRow (lead branch) against an in-memory SQLite with foreign keys
// ON. The real handler is cut out of worker/index.js as source text; only the
// D1 wrapper and the auth helpers are stubbed. No network, nothing is written.
//
//   node scripts/test-lead-delete-guard.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fnSrc, varSrc } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
db.exec(`
CREATE TABLE gm_leads (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, cliente TEXT, estagio TEXT);
CREATE TABLE gm_jobs (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, lead_id TEXT REFERENCES gm_leads(id), created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE gm_events (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, lead_id TEXT REFERENCES gm_leads(id));
CREATE TABLE gm_base_ouro (id TEXT PRIMARY KEY, reactivated_lead_id TEXT REFERENCES gm_leads(id));
CREATE TABLE gm_lead_events (id TEXT PRIMARY KEY, lead_id TEXT, client_id TEXT, action TEXT, field TEXT, old_value TEXT, new_value TEXT, actor TEXT, reason TEXT);
`);
db.exec(`
INSERT INTO gm_leads VALUES ('L-proj','c1','Maria','fechado'),('L-cal','c1','Joao','novo'),('L-plain','c1','Ana','novo'),('L-fail','c1','Bia','novo');
INSERT INTO gm_jobs (id, client_id, lead_id) VALUES ('J1','c1','L-proj'),('J2','c1','L-proj');
INSERT INTO gm_events VALUES ('E1','c1','L-cal'),('E2','c1','L-cal'),('E3','c1','L-fail');
INSERT INTO gm_base_ouro VALUES ('B1','L-cal');
`);

// D1 shape. batch() is all-or-nothing, like D1's.
function prep(sql) {
  return {
    bind: function () { const a = Array.prototype.slice.call(arguments); return stmt(sql, a); }
  };
}
function stmt(sql, args) {
  return {
    sql: sql, args: args,
    first: async function () { return db.prepare(sql).get(...args) || null; },
    all: async function () { return { results: db.prepare(sql).all(...args) }; },
    run: async function () { db.prepare(sql).run(...args); return {}; }
  };
}
const DB = {
  prepare: prep,
  batch: async function (list) {
    db.exec("BEGIN");
    try { list.forEach(function (s) { db.prepare(s.sql).run(...s.args); }); db.exec("COMMIT"); }
    catch (e) { db.exec("ROLLBACK"); throw e; }
    return [];
  }
};

const src = varSrc("GM_DELETE_TABLES") + "\n" + fnSrc("handleDeleteGmRow") + "\nreturn handleDeleteGmRow;";
const stubs = {
  authenticate: async function () { return { role: "client", client_id: "c1", display_name: "Owner" }; },
  requireClientAccess: function () { return true; },
  jsonOk: function (d) { return { status: 200, body: d }; },
  jsonErr: function (m, s) { return { status: s || 400, body: { error: m } }; },
  jsonErr2: function (pt, en, s, extra) { return { status: s || 400, body: Object.assign({ error: en, error_pt: pt, error_en: en }, extra || {}) }; },
  gmOwnedRow: async function (env, table, rowId, clientId) { return env.DB.prepare("SELECT * FROM " + table + " WHERE id = ? AND client_id = ?").bind(rowId, clientId).first(); },
  actorName: function (u) { return u.display_name; },
  crypto: { randomUUID: function () { return "u" + Math.random().toString(36).slice(2); } }
};
const names = Object.keys(stubs);
const del = new Function(...names, src)(...names.map(function (k) { return stubs[k]; }));
const env = { DB: DB };
const run = function (rowId) { return del("c1", "leads", rowId, {}, env); };
const hist = function (id) { return db.prepare("SELECT * FROM gm_lead_events WHERE lead_id = ?").all(id); };
const exists = function (id) { return !!db.prepare("SELECT 1 FROM gm_leads WHERE id = ?").get(id); };

// 1. lead with projects: refused, nothing written
let r = await run("L-proj");
ok(r.status === 400 && r.body.code === "lead_has_project", "project lead refused with 400 / lead_has_project");
ok(r.body.job_id === "J1" && r.body.job_count === 2, "answer carries first job id and job_count 2");
ok(r.body.error_pt && r.body.error_en, "answer carries both languages");
ok(exists("L-proj") && hist("L-proj").length === 0, "project lead still there, no history line");
await run("L-proj"); await run("L-proj");
ok(hist("L-proj").length === 0, "five tries would still write no history (3 checked)");

// 2. calendar-only lead: entries released, lead gone, base-ouro link released
r = await run("L-cal");
ok(r.status === 200 && r.body.deleted === true && !exists("L-cal"), "calendar lead deleted");
const ev = db.prepare("SELECT id, lead_id FROM gm_events WHERE id IN ('E1','E2') ORDER BY id").all();
ok(ev.length === 2 && ev.every(function (e) { return e.lead_id === null; }), "calendar entries remain with lead_id NULL");
ok(db.prepare("SELECT reactivated_lead_id AS x FROM gm_base_ouro WHERE id='B1'").get().x === null, "base-ouro link released");
ok(hist("L-cal").length === 1, "one deleted line for the calendar lead");

// 3. plain lead
r = await run("L-plain");
const h = hist("L-plain");
ok(r.status === 200 && !exists("L-plain"), "plain lead deleted");
ok(h.length === 1 && h[0].action === "deleted" && h[0].new_value === "Ana" && h[0].old_value === "novo" && h[0].actor === "Owner", "exactly one deleted line, with name, stage, actor");

// 4. forced failure: the DELETE aborts; release and history roll back too
db.exec("CREATE TRIGGER force_fail BEFORE DELETE ON gm_leads WHEN OLD.id = 'L-fail' BEGIN SELECT RAISE(ABORT, 'forced: D1_ERROR secret-ish text'); END");
r = await run("L-fail");
ok(r.status === 500 && r.body.error === "Could not delete. Nothing was changed.", "forced failure answers the plain sentence (en)");
ok(r.body.error_pt === "Não foi possível excluir. Nada foi alterado.", "forced failure answers the plain sentence (pt)");
ok(String(r.body.error + r.body.error_pt + r.body.error_en).indexOf("D1_ERROR") < 0 && String(r.body.detail).indexOf("forced") >= 0, "technical text only in detail");
ok(exists("L-fail") && hist("L-fail").length === 0, "failed delete left the lead and no history line");
ok(db.prepare("SELECT lead_id AS x FROM gm_events WHERE id='E3'").get().x === "L-fail", "failed delete left the calendar entry linked");

// not found stays 404
r = await run("nope");
ok(r.status === 404, "unknown lead still 404");

console.log(fail ? fail + " FAILED" : "ALL PASSED");
process.exit(fail ? 1 : 0);
