// A D1-shaped wrapper over an in-memory SQLite (node:sqlite), plus the
// function-extraction helpers the Apex invoice and Apex Club tests share.
// The real Worker functions are cut out of worker/index.js as source text and
// run against the real table definitions (scripts/fixtures/apex-invoice-schema.sql),
// so a test exercises the SQL that ships, never a rewritten copy of it.
// Nothing here touches the network or the production database.
import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const root = new URL("../../", import.meta.url);
export const workerSrc = readFileSync(new URL("worker/index.js", root), "utf8");

// "function name(" or "async function name(" at column 0, to its closing brace
// at column 0.
export function fnSrc(name, src) {
  src = src || workerSrc;
  let i = src.indexOf("\nasync function " + name + "(");
  if (i < 0) { i = src.indexOf("\nfunction " + name + "("); }
  if (i < 0) { throw new Error("function not found in worker/index.js: " + name); }
  const j = src.indexOf("\n}", i + 1);
  return src.slice(i + 1, j + 2);
}
function workerSrcDefault() { return workerSrc; }
export function hasFn(name) {
  return workerSrc.indexOf("\nasync function " + name + "(") >= 0 || workerSrc.indexOf("\nfunction " + name + "(") >= 0;
}
// A top-level "var NAME = ...;" (may span lines).
export function varSrc(name, src) {
  const workerSrc = src || workerSrcDefault();
  const i = workerSrc.indexOf("\nvar " + name + " =");
  if (i < 0) { throw new Error("var not found in worker/index.js: " + name); }
  // The statement ends at the first ";" that closes a line (a trailing
  // "// comment" after it is allowed).
  const m = /;[ \t]*(\/\/[^\n]*)?\n/.exec(workerSrc.slice(i));
  return workerSrc.slice(i + 1, i + m.index + 1);
}

function clean(v) {
  if (v === undefined) { throw new Error("D1 shim: undefined bound (D1 rejects it too)"); }
  if (v === true) { return 1; }
  if (v === false) { return 0; }
  return v;
}

export function makeDb(extraMigrations) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("scripts/fixtures/apex-invoice-schema.sql", root), "utf8"));
  // Migrations added by later builds are layered on when their files exist,
  // one statement at a time, so the same test runs before and after them.
  (extraMigrations || []).forEach(function (rel) {
    const u = new URL(rel, root);
    if (!existsSync(u)) { return; }
    readFileSync(u, "utf8").replace(/^\s*--[^\n]*$/gm, "").split(";").forEach(function (stmt) {
      if (!stmt.trim()) { return; }
      try { db.exec(stmt); } catch (e) { /* column or table already there */ }
    });
  });
  const log = [];
  const writes = [];   // every run()/batch statement with its bound values
  function prepared(sql, args) {
    return {
      bind: function () { return prepared(sql, Array.prototype.slice.call(arguments).map(clean)); },
      first: async function () { log.push(sql); const r = db.prepare(sql).get.apply(db.prepare(sql), args); return r === undefined ? null : Object.assign({}, r); },
      all: async function () { log.push(sql); const st = db.prepare(sql); return { results: st.all.apply(st, args).map(function (r) { return Object.assign({}, r); }) }; },
      run: async function () { log.push(sql); writes.push([sql, args]); const st = db.prepare(sql); const r = st.run.apply(st, args); return { meta: { changes: Number(r.changes) } }; },
      _sync: function () { log.push(sql); writes.push([sql, args]); const st = db.prepare(sql); const r = st.run.apply(st, args); return { meta: { changes: Number(r.changes) } }; }
    };
  }
  const DB = {
    prepare: function (sql) { return prepared(sql, []); },
    batch: async function (stmts) {
      db.exec("BEGIN");
      try { const out = stmts.map(function (s) { return s._sync(); }); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    }
  };
  return { DB: DB, raw: db, log: log, writes: writes, q: function (sql) { const st = db.prepare(sql); return st.all.apply(st, Array.prototype.slice.call(arguments, 1)).map(function (r) { return Object.assign({}, r); }); } };
}

// Builds the named Worker functions into one scope with the given stubs and
// returns them. names: functions to cut from the Worker; vars: top-level vars.
// src: another version of the Worker source (for a before and after run).
export function build(names, vars, stubs, src) {
  const stubNames = Object.keys(stubs || {});
  const body = (vars || []).map(function (v) { return varSrc(v, src); }).concat(names.map(function (n) { return fnSrc(n, src); })).join("\n") +
    "\nreturn { " + names.join(", ") + " };";
  return new Function(...stubNames, body)(...stubNames.map(function (k) { return stubs[k]; }));
}

export const baseStubs = {
  jsonOk: function (data) { return { status: 200, data: data }; },
  jsonErr: function (message, status) { return { status: status || 400, error: message }; },
  actorName: function (user) { return (user && user.display_name) || "test"; },
  authenticate: async function () { return { role: "developer", display_name: "test" }; }
};
export function req(body, url) {
  return { url: url || "https://x.test/", headers: { get: function () { return null; } }, json: async function () { return body || {}; } };
}
