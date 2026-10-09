// Document settings: never throw away what an owner typed (2026-10-09).
// The REAL Worker save (handlePutGmDocSettings, cut out of worker/index.js)
// on an in-memory SQLite. No network, no production database, nothing
// written outside this process.
//
//   node scripts/test-doc-settings-save.mjs
import { makeDb, build, baseStubs, req } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = ["gmLicenseSatisfied", "gmLicenseNotRequiredColumnReady", "gmLicenseNotRequiredRead", "gmReviewLinkParse", "gmReviewLinkColumnReady", "gmReviewLinkRead",
  "gmStr", "gmNum", "gmRunUpdate", "gmOwnedRow", "sessionSellerName", "gmDocHexColor", "gmDocParseLicenses", "gmDocParseJsonObject", "gmDocParsePaymentMethods",
  "gmDocParseLateFeePct", "gmDocParseSchedulePresets", "gmDocScheduleStepsError", "gmDocSettingsRow", "gmDocSettingsOwnerOnly", "handlePutGmDocSettings",
  "handlePostGmEstimate", "gmActorReplacer"];
const VARS = ["GM_LICENSE_NEEDED_PT", "GM_LICENSE_NEEDED_EN", "GM_REVIEW_LINK_HOSTS", "GM_REVIEW_LINK_BAD_PT", "GM_REVIEW_LINK_BAD_EN", "GM_DOC_SETTINGS_FIELDS",
  "GM_DOC_PAYMENT_METHODS", "GM_DOC_LATE_FEE_MAX_PCT", "GM_DOC_LATE_FEE_CAP_MESSAGE", "GM_DOC_DEFAULT_SCHEDULE_PRESETS", "GM_ACTOR_KEY_RE"];

const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "ZETA FLOORS", username: "zeta" };
let user = OWNER;

function world(opts) {
  opts = opts || {};
  const d = makeDb();
  d.raw.exec("CREATE TABLE gm_doc_settings (client_id TEXT PRIMARY KEY, brand_primary TEXT, brand_accent TEXT, legal_name TEXT, address TEXT, phone TEXT, email TEXT, license_numbers TEXT, license_not_required INTEGER NOT NULL DEFAULT 0, license_not_required_by TEXT, license_not_required_at TEXT, estimate_valid_days INTEGER, default_terms_days INTEGER, payment_methods_json TEXT, late_fee_annual_pct REAL, late_fee_grace_days INTEGER, schedule_presets_json TEXT, estimate_message TEXT, invoice_message TEXT, receipt_message TEXT, contract_message TEXT, google_review_link TEXT, setup_completed_at TEXT, updated_at TEXT, updated_by TEXT)");
  d.raw.exec("CREATE TABLE gm_doc_settings_history (id TEXT PRIMARY KEY, client_id TEXT, field TEXT, old_value TEXT, new_value TEXT, actor TEXT, created_at TEXT DEFAULT (datetime('now')))");
  d.raw.exec("CREATE TABLE gm_config (client_id TEXT PRIMARY KEY, target_margin REAL)");
  d.raw.exec("CREATE TABLE gm_leads (id TEXT PRIMARY KEY, client_id TEXT, cliente TEXT)");
  d.raw.prepare("INSERT INTO clients (id, name, language) VALUES ('c1', 'Zeta Floors', 'en')").run();
  d.raw.prepare("INSERT INTO gm_leads (id, client_id, cliente) VALUES ('l1', 'c1', 'Ana Souza')").run();
  if (opts.seed) {
    const cols = Object.keys(opts.seed);
    d.raw.prepare("INSERT INTO gm_doc_settings (client_id, " + cols.join(", ") + ") VALUES ('c1', " + cols.map(() => "?").join(", ") + ")").run(...cols.map((k) => opts.seed[k]));
  }
  let parsedCalls = 0;
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => user,
    requireClientAccess: (u, id) => !!u && (u.role === "developer" || (u.role === "client" && u.client_id === id)),
    jsonErr2: (pt, en, status) => ({ status: status || 400, error: en, error_pt: pt, error_en: en }),
    gmEstSellerGuard: async () => null,
    gmEstParseBody: async () => { parsedCalls++; return { error: "REACHED_PARSER" }; },
    GM_HIDDEN_ACTORS: { system: true, developer: true }
  });
  const F = build(FNS, VARS, stubs);
  const env = { DB: d.DB };
  return {
    d, env, F, parsed: () => parsedCalls,
    put: (body) => F.handlePutGmDocSettings("c1", req(body), env),
    row: () => d.q("SELECT * FROM gm_doc_settings WHERE client_id = 'c1'")[0] || null,
    startEstimate: () => F.handlePostGmEstimate("c1", req({ lead_id: "l1" }), env)
  };
}

// ── 1. no license answer, other blanks filled: other blanks saved,
//      setup_completed_at stays empty, the estimate gate still refuses
{
  user = OWNER;
  const w = world();
  const r = await w.put({ legal_name: "Zeta Floors LLC", phone: "4075550100", email: "office@zeta.test", license_numbers: [], license_not_required: false });
  ok(r.status === 200, "no license answer: the save itself is not refused (200)");
  const row = w.row();
  ok(row.legal_name === "Zeta Floors LLC" && row.phone === "4075550100" && row.email === "office@zeta.test", "every other blank is saved");
  ok(row.setup_completed_at === null && r.data.setup_completed === false, "setup_completed_at stays empty");
  const est = await w.startEstimate();
  ok(est.status === 400 && /Complete the document settings/.test(est.error) && w.parsed() === 0, "the estimate gate (near worker/index.js:26675) still refuses");
}

// ── 2. then the license box ticked: setup_completed_at is stamped, the gate opens
{
  user = OWNER;
  const w = world({ seed: { legal_name: "Zeta Floors LLC", phone: "4075550100" } });
  let est = await w.startEstimate();
  ok(est.status === 400 && w.parsed() === 0, "still refused before the tick");
  const r = await w.put({ license_not_required: true });
  ok(r.status === 200 && r.data.setup_completed === true && !!w.row().setup_completed_at, "ticking the box stamps setup_completed_at");
  est = await w.startEstimate();
  ok(est.error === "REACHED_PARSER" && w.parsed() === 1, "the gate opens");
}

// ── 3. one invalid blank plus valid ones: valid ones saved, the invalid one not
{
  user = OWNER;
  const w = world();
  const r = await w.put({
    legal_name: "Zeta Floors LLC",
    phone: "4075550100",
    brand_primary: "not-a-color",
    late_fee_annual_pct: 25,
    google_review_link: "https://evil.com/review",
    schedule_presets: [{ name: "", steps: [{ label: "Deposit", pct: 50 }, { label: "Final", pct: 50 }] }]
  });
  ok(r.status === 200, "a save with several invalid blanks is still 200, not refused whole");
  const row = w.row();
  ok(row.legal_name === "Zeta Floors LLC" && row.phone === "4075550100", "the valid blanks (legal name, phone) are saved");
  ok(row.brand_primary === null, "the invalid color is not saved");
  ok(row.late_fee_annual_pct === null, "the rate above 18% is not saved");
  ok(row.google_review_link === null, "the non-Google link is not saved");
  ok(row.schedule_presets_json === null || JSON.parse(row.schedule_presets_json || "[]").length === 0, "the nameless preset is not saved");
  const errs = r.data.field_errors;
  ok(!!errs.brand_primary && !!errs.late_fee_annual_pct && !!errs.google_review_link && !!errs.schedule_presets, "every invalid blank is named in field_errors, each with its own message");
}

// ── 4. a business with a license number: a save that deletes it and leaves
//      the box unticked keeps the license answer and still saves the others
{
  user = OWNER;
  const w = world({ seed: { legal_name: "Zeta Floors LLC", license_numbers: "[\"CPC123\"]", setup_completed_at: "2026-09-01 10:00:00" } });
  const r = await w.put({ phone: "4075550199", license_numbers: [], license_not_required: false });
  ok(r.status === 200, "removing the only license answer is still a 200 (not a whole-save refusal)");
  const row = w.row();
  ok(row.phone === "4075550199", "the OTHER field in the same save (phone) still writes");
  ok(JSON.parse(row.license_numbers) [0] === "CPC123", "the license answer itself is kept, not emptied");
  ok(row.setup_completed_at === "2026-09-01 10:00:00", "setup_completed_at is untouched");
  ok(!!r.data.field_errors.license_numbers && !!r.data.field_errors.license_not_required, "both license fields carry the refusal message");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
