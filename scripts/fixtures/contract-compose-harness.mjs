// Runs the real contract rules engine (contractCompose and everything it calls)
// cut out of a copy of worker/index.js, against the real clause library seed
// (migrations/contracts_a_library.sql) loaded into an in-memory SQLite.
// Used by scripts/test-state-riders.mjs and scripts/make-state-riders-golden.mjs.
// Nothing here touches the network or the production database.
import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fnSrc, varSrc } from "./d1-shim.mjs";

const root = new URL("../../", import.meta.url);
export const GOLDEN_DIR = new URL("scripts/fixtures/", root);

// The helper functions outside the contract* family that the composer calls.
const GM_HELPERS = ["gmDocParseJsonObject", "gmFmtUsDate", "gmUtcStampToEasternDate", "gmEstLineAmountCents", "gmEstOptDiscount", "gmEstOptTotals",
  "gmEstDiscountCents", "gmEstOptionTotals", "gmEstScheduleAmounts", "GmLabelsPaymentMethodEn", "gmNum", "gmCents", "gmStr"];

// extra: more migration files to load after the seed (the cleaning library).
function libraryDb(extra) {
  const db = new DatabaseSync(":memory:");
  // The seed carries ";" inside clause text, so the whole file goes in at once.
  db.exec(readFileSync(new URL("migrations/contracts_a_library.sql", root), "utf8"));
  (extra || []).forEach(function (f) { db.exec(readFileSync(new URL(f, root), "utf8")); });
  try { db.exec("ALTER TABLE contract_clause_options ADD COLUMN origin TEXT"); } catch (e) { /* already there */ }
  function prepared(sql, args) {
    return {
      bind: function () { return prepared(sql, Array.prototype.slice.call(arguments)); },
      first: async function () { const st = db.prepare(sql); const r = st.get.apply(st, args); return r === undefined ? null : Object.assign({}, r); },
      all: async function () { const st = db.prepare(sql); return { results: st.all.apply(st, args).map(function (r) { return Object.assign({}, r); }) }; }
    };
  }
  return { DB: { prepare: function (sql) { return prepared(sql, []); } }, raw: db };
}

// src: the text of a worker/index.js (main's, for the golden files, or the
// working copy). Returns the real functions plus a compose(fixture) helper.
// opts.migrations: extra migration files loaded on top of the seed.
export async function buildComposer(src, opts) {
  const names = [];
  const re = /\n(?:async )?function (contract[A-Za-z0-9_]*)\(/g;
  let m;
  while ((m = re.exec(src)) !== null) { if (names.indexOf(m[1]) === -1) { names.push(m[1]); } }
  GM_HELPERS.forEach(function (n) {
    if (src.indexOf("\nfunction " + n + "(") >= 0 && names.indexOf(n) === -1) { names.push(n); }
  });
  const vars = [];
  const rv = /\nvar (CONTRACT_[A-Z0-9_]+) =/g;
  while ((m = rv.exec(src)) !== null) { if (vars.indexOf(m[1]) === -1) { vars.push(m[1]); } }
  const stubs = {};
  // The riders data file is an import in the Worker; here it is read from disk.
  const ridersUrl = new URL("data/contract-state-riders-v1.json", root);
  if (/\nimport CONTRACT_STATE_RIDERS_V1 from /.test("\n" + src) && existsSync(ridersUrl)) {
    stubs.CONTRACT_STATE_RIDERS_V1 = JSON.parse(readFileSync(ridersUrl, "utf8"));
  }
  const stubNames = Object.keys(stubs);
  const body = vars.map(function (v) { return varSrc(v, src); }).concat(names.map(function (n) { return fnSrc(n, src); })).join("\n") +
    "\nreturn { " + names.join(", ") + " };";
  const fns = new Function(...stubNames, body)(...stubNames.map(function (k) { return stubs[k]; }));
  const env = libraryDb(opts && opts.migrations);
  async function context(fx) {
    const settings = Object.assign({ exists: true, trades: ["pools", "tile", "remodeling", "hardscape", "general"], builds_pools: false, defaults: {}, signers: [],
      owner_signer_name: "Pat Owner", owner_signer_phone: "8135550100", source: "apex", values: {} }, fx.settings || {});
    const lib = await fns.contractLibraryForClient(env, "client-1", 1, settings.trades);
    const doc = Object.assign({ legal_name: "Sunrise Pools LLC", address: "100 Bay St, Tampa, FL 33602", phone: "8135550100", email: "office@sunrise.test",
      license_numbers: ["CPC1459999"], payment_methods: { zelle: "pay@sunrise.test", check: "" }, late_fee_grace_days: 5, late_fee_annual_pct: 18 }, fx.doc || {});
    const lead = Object.assign({ id: "lead-1", cliente: "Jordan Rivers", telefone: "8135550111", email: "jordan@example.test", address: "12 Main St", city: "Riverview",
      property_county: "Hillsborough", updated_at: "2026-09-01 12:00:00" }, fx.lead || {});
    const job = Object.assign({ id: "job-1", obra: "Rivers backyard", lead_id: "lead-1", inicio: "2026-11-02", prazo_previsto: "2026-11-20" }, fx.job || {});
    const estimates = [{
      id: "est-1", number: "EST-0042", revision: 1, public_token: "tok", job_name: "Rivers backyard", customer_name: "Jordan Rivers", customer_phone: "8135550111",
      customer_email: "jordan@example.test", customer_address: fx.estimate_address === undefined ? "" : fx.estimate_address, accepted_signer_name: "Jordan Rivers",
      sent_at: "2026-09-10 15:00:00", created_at: "2026-09-10 14:00:00", updated_at: "2026-08-01 10:00:00", accepted_at: "2026-09-12 16:00:00", valid_until: "2026-10-30",
      terms_excluded: "", discount_type: null, discount_value: null, accepted_option_id: "opt-1", schedule: fx.schedule,
      options: [{ id: "opt-1", discount_type: null, discount_value: null, items: [{ id: "it-1", item_name: fx.item_name || "Paver patio", qty: 1, rate_cents: fx.amount_cents, line_type: "item", category: "Work" }] }]
    }];
    const admin = Object.assign({ recovery_fund_contact_block: "Recovery Fund contact block (test value)", ch515_doc_r2_key: "k1", drowning_pub_r2_key: "k2", ch515_doc_version: "2026", drowning_pub_version: "2026" }, fx.admin || {});
    const out = { job: job, lead: lead, estimates: estimates, doc: doc, settings: settings, client: { name: "Sunrise Pools", owners: "Pat Owner" }, admin: admin, lib: lib };
    // Cleaning fixtures only: the booked online-booking answers of the lead.
    if (fx.booking !== undefined) { out.booking = fx.booking; }
    return out;
  }
  // The selections a new contract starts with (the same loop as handlePostGmJobContract).
  function defaultSelections(ctx) {
    const sel = {};
    ctx.lib.clause_areas.forEach(function (a) {
      const d = ctx.settings.defaults[a.id];
      if (d && ctx.lib.optionsById[d]) { sel[a.id] = d; return; }
      const first = ctx.lib.optionsForClient.filter(function (o) { return o.area_id === a.id; })[0];
      if (first) { sel[a.id] = first.id; }
    });
    return sel;
  }
  async function compose(fx, mode) {
    const ctx = await context(fx);
    const flags = Object.assign({}, fx.flags || {});
    // A cleaning fixture starts from the cleaning defaults, as a new cleaning agreement does.
    const start = flags.kind === "cleaning" ? fns.contractCleaningDefaults(ctx, { flags: flags }, fns.contractCleaningGate(ctx, "2026-10-01")) : defaultSelections(ctx);
    const c = { id: "con-1", client_id: "client-1", number: "CON-0007", revision: 1, status: "draft", contract_date: "2026-10-01", offer_expiry_date: "2026-10-30",
      selections: Object.assign(start, fx.selections || {}), answers: Object.assign({}, fx.answers || {}), flags: flags,
      custom_clauses: fx.custom_clauses || [], estimate_ids: ["est-1"] };
    if (fx.contract) { Object.assign(c, fx.contract); }
    return { comp: fns.contractCompose(ctx, c, "2026-10-01", mode || "live"), ctx: ctx, c: c };
  }
  return { fns: fns, compose: compose, context: context, defaultSelections: defaultSelections, env: env, riders: stubs.CONTRACT_STATE_RIDERS_V1 || null };
}

// The Florida fixtures the golden files are made from: a small job under
// $2,500, a residential job over $2,500 sold in the home with a deposit over
// 10 percent, a pool job, and two that pick the other clause options.
export const FLORIDA_FIXTURES = {
  "small-job": {
    amount_cents: 180000, item_name: "Tile repair",
    schedule: [{ label: "On completion", pct: 100 }],
    flags: { sold_in_home: false, is_pool: false, property_type: "single_family", pool_safety_feature: null }
  },
  "residential-in-home-deposit": {
    amount_cents: 1250000, item_name: "Paver patio",
    schedule: [{ label: "Deposit", pct: 30 }, { label: "Midpoint", pct: 40 }, { label: "Completion", pct: 30 }],
    flags: { sold_in_home: true, is_pool: false, property_type: "single_family", pool_safety_feature: null }
  },
  "pool-job": {
    amount_cents: 6800000, item_name: "Swimming pool",
    schedule: [{ label: "Deposit", pct: 10 }, { label: "Shell", pct: 50 }, { label: "Completion", pct: 40 }],
    settings: { builds_pools: true },
    flags: { sold_in_home: true, is_pool: true, property_type: "single_family", pool_safety_feature: "(a) Isolated from the home by an enclosure that meets s. 515.29" }
  },
  // Two more, so every other clause option that carries Florida text (the B
  // and C options of C01, C09, C11, C12, C13, C14 and C19) is in a golden file.
  "alternate-clauses-b": {
    amount_cents: 2400000, item_name: "Kitchen remodel",
    schedule: [{ label: "Deposit", pct: 20 }, { label: "Completion", pct: 80 }],
    flags: { sold_in_home: true, is_pool: false, property_type: "condo", pool_safety_feature: null },
    selections: { C01: "C01-B", C02: "C02-B", C03: "C03-B", C04: "C04-B", C05: "C05-B", C06: "C06-B", C07: "C07-B", C08: "C08-B", C09: "C09-B", C10: "C10-B", C11: "C11-B", C12: "C12-B", C13: "C13-B", C14: "C14-B", C15: "C15-B", C16: "C16-B", C17: "C17-B", C18: "C18-B", C19: "C19-B" }
  },
  "alternate-clauses-c": {
    amount_cents: 400000, item_name: "Bathroom tile",
    schedule: [{ label: "Deposit", pct: 10 }, { label: "Completion", pct: 90 }],
    flags: { sold_in_home: false, is_pool: false, property_type: "commercial", pool_safety_feature: null },
    selections: { C01: "C01-C", C02: "C02-A", C03: "C03-C", C04: "C04-C", C05: "C05-C", C06: "C06-C", C07: "C07-C", C08: "C08-C", C09: "C09-C", C10: "C10-C", C11: "C11-C", C12: "C12-C", C13: "C13-C", C14: "C14-C", C15: "C15-C", C16: "C16-C", C17: "C17-C", C18: "C18-C", C19: "C19-A" }
  }
};

// What the golden files hold: the whole composed result except `vars` (kept
// out because a later build may add new placeholder values without changing a
// single printed word).
export function goldenView(comp) {
  return JSON.parse(JSON.stringify({ sections: comp.sections, notice_form_text: comp.notice_form_text, rules: comp.rules, missing: comp.missing, blockers: comp.blockers,
    fields: comp.fields, amount_cents: comp.amount_cents, sums: comp.sums, disclaimer_line: comp.disclaimer_line, requires: comp.requires, locked_format: comp.locked_format }));
}
