// The real Worker (worker/index.js, whole) running on an in-memory SQLite that
// has the LIVE D1 schema (scripts/fixtures/live-schema-2026-10-30.sql, read from
// the production database's sqlite_master) plus the contract clause library
// seed. Requests go through the real router (handleFetch), so a test exercises
// the routes, the guards and the SQL that ship. Nothing here touches the
// network or the production database.
//
// Used by scripts/test-estimate-contract-flow.mjs.
import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

const root = new URL("../../", import.meta.url);

// ── The Worker, loaded as a function body ────────────────────────────────
// The Worker is an ES module whose imports are JSON data files and one
// Cloudflare class. Here the data files are read from disk (or left empty
// when the flow never reads them) and the class is a stub.
let cached = null;
export function loadWorker() {
  if (cached) { return cached; }
  let src = readFileSync(new URL("worker/index.js", root), "utf8");
  const real = ["hero-gallery-v1", "hero-gallery-private-v1", "contract-state-riders-v1", "contract-state-checklist-v1"];
  src = src.replace(/^import \{ DurableObject \} from "cloudflare:workers";$/m, "var DurableObject = class DurableObject { constructor(s, e) { this.ctx = s; this.env = e; } };");
  src = src.replace(/^import (\w+) from "([^"]+\.json)";$/gm, function (m, name, rel) {
    const base = rel.replace(/^.*\//, "").replace(/\.json$/, "");
    if (real.indexOf(base) !== -1) { return "var " + name + " = __json(" + JSON.stringify(rel) + ");"; }
    if (base === "guides") { return "var " + name + " = __json(" + JSON.stringify(rel) + ");"; }
    return "var " + name + " = {};";
  });
  src = src.replace(/^export class /gm, "class ").replace(/^export default \{/m, "var __default = {");
  const names = ["handleFetch", "contractFill", "contractCompose", "gmEasternToday", "sha256Hex", "contractFillPass"];
  const body = src + "\nreturn { default: __default, " + names.join(", ") + " };";
  const loadJson = function (rel) {
    const u = new URL(rel.replace(/^\.\.\//, ""), root);
    return existsSync(u) ? JSON.parse(readFileSync(u, "utf8")) : {};
  };
  cached = new Function("__json", body)(loadJson);
  return cached;
}

// ── D1-shaped wrapper over node:sqlite ───────────────────────────────────
function clean(v) {
  if (v === undefined) { throw new Error("D1 shim: undefined bound (D1 rejects it too)"); }
  if (v === true) { return 1; }
  if (v === false) { return 0; }
  return v;
}
function makeDb(opts) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("scripts/fixtures/live-schema-2026-10-30.sql", root), "utf8"));
  // The migration of this build (the live database gets it once, before the Worker deploy).
  db.exec(readFileSync(new URL("migrations/2026-10-30_estimate_company_presign.sql", root), "utf8"));
  // The clause library the live database holds.
  db.exec(readFileSync(new URL("migrations/contracts_a_library.sql", root), "utf8"));
  ((opts && opts.migrations) || []).forEach(function (m) { db.exec(readFileSync(new URL(m, root), "utf8")); });
  function prepared(sql, args) {
    return {
      bind: function () { return prepared(sql, Array.prototype.slice.call(arguments).map(clean)); },
      first: async function () { const st = db.prepare(sql); const r = st.get.apply(st, args); return r === undefined ? null : Object.assign({}, r); },
      all: async function () { const st = db.prepare(sql); return { results: st.all.apply(st, args).map(function (r) { return Object.assign({}, r); }) }; },
      run: async function () { const st = db.prepare(sql); const r = st.run.apply(st, args); return { meta: { changes: Number(r.changes) } }; },
      _sync: function () { const st = db.prepare(sql); const r = st.run.apply(st, args); return { meta: { changes: Number(r.changes) } }; }
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
  return {
    DB: DB, raw: db,
    q: function (sql) { const st = db.prepare(sql); return st.all.apply(st, Array.prototype.slice.call(arguments, 1)).map(function (r) { return Object.assign({}, r); }); },
    one: function (sql) { const st = db.prepare(sql); const r = st.get.apply(st, Array.prototype.slice.call(arguments, 1)); return r === undefined ? null : Object.assign({}, r); },
    x: function (sql) { const st = db.prepare(sql); return st.run.apply(st, Array.prototype.slice.call(arguments, 1)); }
  };
}

// A minimal R2: put, get, delete.
function makeAssets() {
  const m = new Map();
  return {
    m: m,
    put: async function (k, v) { m.set(k, typeof v === "string" ? v : (v instanceof Uint8Array ? v : new TextEncoder().encode(String(v)))); },
    get: async function (k) {
      if (!m.has(k)) { return null; }
      const v = m.get(k);
      const bytes = typeof v === "string" ? new TextEncoder().encode(v) : v;
      return { body: bytes, text: async function () { return new TextDecoder().decode(bytes); }, arrayBuffer: async function () { return bytes.buffer; }, json: async function () { return JSON.parse(new TextDecoder().decode(bytes)); } };
    },
    delete: async function (k) { m.delete(k); },
    list: async function () { return { objects: [] }; }
  };
}

const sha = function (s) { return createHash("sha256").update(s).digest("hex"); };
export function token(n) { return String(n).padStart(2, "0").repeat(24).slice(0, 48).replace(/[^a-f0-9]/g, "a"); }
export function ymd(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

// ── A client with an owner, an authorized seller and a seller who may not sign ──
export function newWorld(opts) {
  opts = opts || {};
  const d = makeDb(opts);
  const W = loadWorker();
  const env = { DB: d.DB, ASSETS: makeAssets(), FIREBASE_PROJECT_ID: "test" };
  const CID = "client-1";
  d.x("INSERT INTO clients (id, name, owners, status, language, phone, email) VALUES (?, 'Sunrise Builders', 'Pat Owner', 'active', 'en', '8135550100', 'office@sunrise.test')", CID);
  const logins = [["owner1", "client", null, "tok-owner"], ["seller-sam", "seller", "Sam Seller", "tok-sam"], ["seller-nina", "seller", "Nina NoSign", "tok-nina"]];
  logins.forEach(function (l) {
    d.x("INSERT INTO client_logins (username, client_id, password_hash, must_change_password, role, seller_name) VALUES (?, ?, 'x', 0, ?, ?)", l[0], CID, l[1], l[2]);
  });
  d.x("INSERT INTO contract_client_settings (client_id, trades_json, builds_pools, defaults_json, signers_json, owner_signer_name, owner_signer_phone, source, values_json) VALUES (?, ?, 0, '{}', ?, 'Pat Owner', '8135550100', 'apex', ?)",
    CID, JSON.stringify(opts.trades || ["general"]), JSON.stringify([{ name: "Sam Seller", username: "seller-sam", phone: "8135550123" }]), JSON.stringify(opts.settingsValues || {}));
  d.x("INSERT INTO gm_doc_settings (client_id, legal_name, address, phone, email, license_numbers, payment_methods_json, estimate_valid_days, default_terms_days, late_fee_annual_pct, late_fee_grace_days, setup_completed_at) VALUES (?, 'Sunrise Builders LLC', '100 Bay St, Tampa, FL 33602', '8135550100', 'office@sunrise.test', ?, ?, 30, 0, 18, 5, datetime('now'))",
    CID, JSON.stringify(["CBC1259999"]), JSON.stringify({ zelle: "pay@sunrise.test", check: "Sunrise Builders LLC" }));

  // What Apex staff load once for everyone (the Recovery Fund block of the Florida notice).
  d.x("INSERT INTO contract_admin_settings (key, value, set_by) VALUES ('recovery_fund_contact_block', 'Recovery Fund contact block (test value)', 'test')");

  const tokens = {};
  const expires = new Date(Date.now() + 3600000).toISOString();
  logins.forEach(function (l) {
    const t = "capt_" + sha(l[3]).slice(0, 40);
    tokens[l[0]] = t;
    d.x("INSERT INTO client_auth_tokens (token_hash, client_id, username, expires_at) VALUES (?, ?, ?, ?)", sha(t), CID, l[0], expires);
  });

  let n = 100;
  const world = {
    W: W, env: env, d: d, CID: CID, tokens: tokens, errors: [],
    // ── requests through the real router ──
    call: async function (method, path, body, who) {
      const headers = { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113." + (n % 250), "User-Agent": "TestBrowser/1.0" };
      if (who) { headers.Authorization = "Bearer " + tokens[who]; }
      const req = new Request("https://apex-api.test" + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const waits = [];
      const res = await W.handleFetch(req, env, { waitUntil: function (p) { waits.push(p); } });
      await Promise.all(waits);
      let json = null;
      const text = await res.text();
      try { json = JSON.parse(text); } catch (e) { json = null; }
      return { status: res.status, json: json, text: text };
    },
    gm: function (method, rest, body, who) { return world.call(method, "/api/clients/" + CID + "/gm/" + rest, body, who || "owner1"); },
    // ── data ──
    lead: function (o) {
      o = Object.assign({ cliente: "Jordan Rivers", telefone: "8135550111", email: "jordan@example.test", address: "12 Main St, Tampa, FL 33602", city: "Tampa", vendedor: "Sam Seller" }, o || {});
      const id = "lead-" + (++n);
      d.x("INSERT INTO gm_leads (id, client_id, cliente, telefone, email, address, city, vendedor, estagio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Estimate')", id, CID, o.cliente, o.telefone, o.email, o.address, o.city, o.vendedor);
      return id;
    },
    estimate: function (leadId, o) {
      o = Object.assign({ mode: "single", price: 1250000, email: "jordan@example.test", phone: "8135550111", address: "12 Main St, Tampa, FL 33602", name: "Jordan Rivers", jobName: "Paver patio",
        schedule: [{ label: "Deposit", pct: 30 }, { label: "Mid-project", pct: 40 }, { label: "Completion", pct: 30 }], prices: null }, o || {});
      const id = "est-" + (++n), tok = token(n);
      const num = "EST-" + String(n).padStart(4, "0");
      d.x("INSERT INTO gm_estimates (id, client_id, lead_id, number, revision, status, mode, job_name, customer_name, customer_email, customer_phone, customer_address, valid_until, schedule_json, public_token, created_by) VALUES (?, ?, ?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test')",
        id, CID, leadId, num, o.mode, o.jobName, o.name, o.email, o.phone, o.address, ymd(30), JSON.stringify(o.schedule), tok);
      const opts2 = o.mode === "tiered" ? [["best", o.prices ? o.prices[0] : 1500000], ["good", o.prices ? o.prices[1] : 900000]] : [["single", o.price]];
      const optionIds = [];
      opts2.forEach(function (p, i) {
        const oid = "opt-" + id + "-" + i;
        optionIds.push(oid);
        d.x("INSERT INTO gm_estimate_options (id, estimate_id, tier, label, sort_order, subtotal_cents, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)", oid, id, p[0], p[0], i, p[1], p[1]);
        d.x("INSERT INTO gm_estimate_items (id, estimate_id, option_id, category, item_name, line_type, qty, unit, rate_cents, amount_cents, sort_order) VALUES (?, ?, ?, 'Work', ?, 'standard', 1, NULL, ?, ?, 0)", "it-" + oid, id, oid, o.jobName, p[1], p[1]);
      });
      return { id: id, token: tok, number: num, optionIds: optionIds, leadId: leadId };
    },
    pub: async function (method, path, body) {
      return world.call(method, "/api/public" + path, body);
    }
  };
  return world;
}
