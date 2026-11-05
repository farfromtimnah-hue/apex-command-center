// Saved default estimate terms (included, excluded, notes to customer).
// The REAL Worker functions (cut out of worker/index.js) and the REAL
// frontend functions (cut out of gm.js) on an in-memory SQLite. No network,
// no production database.
//
//   node scripts/test-estimate-default-terms.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, req, hasFn, workerSrc } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = ["gmLicenseNotRequiredColumnReady", "gmReviewLinkParse", "gmReviewLinkColumnReady", "gmReviewLinkRead",
  "gmStr", "gmNum", "gmRunUpdate", "sessionSellerName", "gmDocHexColor", "gmDocParseLicenses", "gmDocParseJsonObject", "gmDocParsePaymentMethods",
  "gmDocParseLateFeePct", "gmDocParseSchedulePresets", "gmDocScheduleStepsError", "gmDocSettingsRow", "gmDocSettingsOwnerOnly",
  "handlePutGmDocSettings", "handleGetGmDocSettings", "handlePostGmEstimate", "gmLicenseNotRequiredRead", "gmLicenseSatisfied",
  "gmTermsColumnsReady", "gmTermsDefaultsRead", "gmTermsText", "gmEstApplyDefaultTerms", "gmOwnedRow"];
const VARS = ["GM_LICENSE_NEEDED_PT", "GM_LICENSE_NEEDED_EN", "GM_REVIEW_LINK_HOSTS", "GM_REVIEW_LINK_BAD_PT", "GM_REVIEW_LINK_BAD_EN", "GM_DOC_SETTINGS_FIELDS",
  "GM_DOC_PAYMENT_METHODS", "GM_DOC_LATE_FEE_MAX_PCT", "GM_DOC_LATE_FEE_CAP_MESSAGE", "GM_DOC_DEFAULT_SCHEDULE_PRESETS", "GM_TERMS_DEFAULT_KEYS"];

const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "ZETA FLOORS", username: "zeta" };
const SELLER = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Rafa", display_name: "Rafa", username: "rafa" };
const OTHER = { role: "client", client_id: "c2", login_role: "client", display_name: "OTHER", username: "other" };
let user = OWNER;

const BASE_COLS = "client_id TEXT PRIMARY KEY, brand_primary TEXT, brand_accent TEXT, legal_name TEXT, address TEXT, phone TEXT, email TEXT, license_numbers TEXT, license_not_required INTEGER NOT NULL DEFAULT 0, license_not_required_by TEXT, license_not_required_at TEXT, estimate_valid_days INTEGER, default_terms_days INTEGER, payment_methods_json TEXT, late_fee_annual_pct REAL, late_fee_grace_days INTEGER, schedule_presets_json TEXT, estimate_message TEXT, invoice_message TEXT, receipt_message TEXT, contract_message TEXT, google_review_link TEXT, setup_completed_at TEXT, updated_at TEXT, updated_by TEXT";
const TERMS_COLS = ", default_terms_included TEXT, default_terms_excluded TEXT, default_customer_notes TEXT";

function world(opts) {
  opts = opts || {};
  const d = makeDb();
  d.raw.exec("CREATE TABLE gm_doc_settings (" + BASE_COLS + (opts.noColumns ? "" : TERMS_COLS) + ")");
  d.raw.exec("CREATE TABLE gm_doc_settings_history (id TEXT PRIMARY KEY, client_id TEXT, field TEXT, old_value TEXT, new_value TEXT, actor TEXT, created_at TEXT DEFAULT (datetime('now')))");
  d.raw.exec("CREATE TABLE gm_config (client_id TEXT PRIMARY KEY, target_margin REAL)");
  d.raw.exec("CREATE TABLE gm_leads (id TEXT PRIMARY KEY, client_id TEXT, cliente TEXT)");
  d.raw.exec("CREATE TABLE gm_estimates (id TEXT, client_id TEXT, lead_id TEXT, number TEXT, revision INTEGER, status TEXT, mode TEXT, job_name TEXT, customer_name TEXT, customer_email TEXT, customer_phone TEXT, customer_address TEXT, valid_until TEXT, discount_type TEXT, discount_value REAL, schedule_json TEXT, terms_included TEXT, terms_excluded TEXT, customer_notes TEXT, internal_notes TEXT, public_token TEXT, created_by TEXT)");
  for (const c of ["location_state", "legal_entity_name", "legal_entity_address", "phone", "email", "logo_url", "referral_bg_color", "referral_text_color"]) { try { d.raw.exec("ALTER TABLE clients ADD COLUMN " + c + " TEXT"); } catch (e) { /* the shim table already has it */ } }
  d.raw.prepare("INSERT INTO clients (id, name, language) VALUES ('c1', 'Zeta Floors', 'en')").run();
  d.raw.prepare("INSERT INTO gm_leads (id, client_id, cliente) VALUES ('l1', 'c1', 'Ana Souza')").run();
  const seed = Object.assign({ legal_name: "Zeta Floors LLC", license_numbers: "[\"CPC1\"]", setup_completed_at: "2026-09-01 10:00:00" }, opts.seed || {});
  const cols = Object.keys(seed);
  d.raw.prepare("INSERT INTO gm_doc_settings (client_id, " + cols.join(", ") + ") VALUES ('c1', " + cols.map(() => "?").join(", ") + ")").run(...cols.map((k) => seed[k]));
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => user,
    requireClientAccess: (u, id) => !!u && (u.role === "developer" || (u.role === "client" && u.client_id === id)),
    gmEstSellerGuard: async () => null,
    // the body fields the real parser reads, with the real gmStr limits
    gmEstParseBody: async (env, id, body) => ({ fields: {
      job_name: "Job", customer_name: null, customer_email: null, customer_phone: null, customer_address: null, valid_until: "2026-12-01",
      discount_type: null, discount_value: null, schedule_json: "[]", mode: "single",
      terms_included: F.gmStr(body.terms_included, 4000), terms_excluded: F.gmStr(body.terms_excluded, 4000),
      customer_notes: F.gmStr(body.customer_notes, 12000), internal_notes: null }, options: [] }),
    gmDocAllocateNumber: async () => ({ number: "EST-1" }),
    gmEstNewToken: () => "tok",
    gmEstWriteOptions: async () => {}, gmLogLeadEvents: async () => {}, gmEstOverrideEvents: () => [],
    gmCustomerToLead: async () => {}, gmEstEditedCustomer: () => ({}), gmEstLoad: async () => ({}), gmEstApplyToLead: async () => {},
    contractStateCode: () => null, contractStateName: () => null, contractStateRider: () => null,
    gmEnsureClientLinkSlug: async () => "slug", gmDocHero: () => ({ url: null, hero: null }), jsonErr2: (pt, en, s) => ({ status: s || 400, error: en }),
    gmOwnedRow: async (env, table, rid, cid) => (await env.DB.prepare("SELECT * FROM " + table + " WHERE id = ? AND client_id = ?").bind(rid, cid).first())
  });
  const F = build(FNS.filter(hasFn), VARS.filter((v) => workerSrc.indexOf("\nvar " + v + " =") >= 0), stubs);
  const env = { DB: d.DB };
  return {
    d, env, F,
    put: (body) => F.handlePutGmDocSettings("c1", req(body), env),
    get: () => F.handleGetGmDocSettings("c1", req({}, "https://x.test/api/clients/c1/gm/doc-settings"), env),
    create: (body) => F.handlePostGmEstimate("c1", req(Object.assign({ lead_id: "l1" }, body)), env),
    row: () => d.q("SELECT * FROM gm_doc_settings WHERE client_id = 'c1'")[0],
    est: () => d.q("SELECT * FROM gm_estimates")[0],
    hist: () => d.q("SELECT field, old_value, new_value, actor FROM gm_doc_settings_history ORDER BY field")
  };
}

const L = (v) => (typeof v === "string" ? v.length : -1);
const K = ["default_terms_included", "default_terms_excluded", "default_customer_notes"];

// ── 1. GET: null when nothing is saved; the saved text when it is
{
  user = OWNER;
  let w = world();
  let r = await w.get();
  ok(r.status === 200 && K.every((k) => r.data.settings[k] === null), "GET: all three are null when nothing is saved");
  w = world({ seed: { default_terms_included: "Line one\n\n- bullet", default_terms_excluded: "Não incluído", default_customer_notes: "Notas" } });
  r = await w.get();
  ok(r.data.settings.default_terms_included === "Line one\n\n- bullet" && r.data.settings.default_terms_excluded === "Não incluído" && r.data.settings.default_customer_notes === "Notas", "GET: returns the saved texts exactly");
}

// ── 2. PUT: stores exactly as typed (blank lines, bullets, accents), CRLF becomes LF
{
  user = OWNER;
  const w = world();
  const typed = "Incluído:\r\n\r\n• Mão de obra\r\n- Material  \r\n  indented";
  const r = await w.put({ default_terms_included: typed });
  ok(r.status === 200 && !r.data.field_errors.default_terms_included, "PUT: 200 and no field error");
  ok(w.row().default_terms_included === "Incluído:\n\n• Mão de obra\n- Material  \n  indented", "PUT: line breaks kept, CRLF becomes LF, accents/bullets/inner and edge spaces untouched");
  ok(r.data.settings.default_terms_included === w.row().default_terms_included, "PUT: the response carries the saved text");
}

// ── 3. blank or whitespace only is NULL, never ""
{
  user = OWNER;
  const w = world({ seed: { default_terms_included: "old", default_terms_excluded: "old2", default_customer_notes: "old3" } });
  const r = await w.put({ default_terms_included: "", default_terms_excluded: "   \n\t ", default_customer_notes: null });
  const row = w.row();
  ok(row.default_terms_included === null && row.default_terms_excluded === null && row.default_customer_notes === null, "blank, whitespace-only and null are all stored as NULL");
  ok(r.status === 200 && w.hist().length === 3, "each cleared field is one history row");
}

// ── 4. length limits: 4000 / 4000 / 12000 accepted, one more refused for that field only
{
  user = OWNER;
  const w = world();
  let r = await w.put({ default_terms_included: "a".repeat(4000), default_terms_excluded: "b".repeat(4000), default_customer_notes: "c".repeat(12000), legal_name: "Zeta 2" });
  ok(L(w.row().default_terms_included) === 4000 && L(w.row().default_terms_excluded) === 4000 && L(w.row().default_customer_notes) === 12000, "the exact limits are accepted");
  r = await w.put({ default_terms_included: "a".repeat(4001), default_terms_excluded: "x", default_customer_notes: "c".repeat(12001), phone: "4075550100" });
  ok(!!r.data.field_errors.default_terms_included && !!r.data.field_errors.default_customer_notes && !r.data.field_errors.default_terms_excluded, "over the limit: refused for that field only, with a message");
  ok(L(w.row().default_terms_included) === 4000 && L(w.row().default_customer_notes) === 12000 && w.row().default_terms_excluded === "x" && w.row().phone === "4075550100", "refused fields keep their old text, the rest of the save still writes");
  r = await w.put({ default_terms_included: 42, default_terms_excluded: { a: 1 } });
  ok(!!r.data.field_errors.default_terms_included && !!r.data.field_errors.default_terms_excluded && w.row().default_terms_excluded === "x", "a non-text value is refused, not repaired");
}

// ── 5. history: old value, new value, actor from the session
{
  user = OWNER;
  const w = world({ seed: { default_terms_excluded: "before" } });
  await w.put({ default_terms_included: "first", default_terms_excluded: "after", actor: "attacker" });
  const h = w.hist();
  ok(h.length === 2 && !!h[0] && h[0].field === "default_terms_excluded" && h[0].old_value === "before" && h[0].new_value === "after" && h[0].actor === "ZETA FLOORS", "history: old value, new value, actor from the session (not the body)");
  ok(!!h[1] && h[1].field === "default_terms_included" && h[1].old_value === null && h[1].new_value === "first", "history: first save has a null old value");
  const n = (await w.put({ default_terms_included: "first" })).data.changed;
  ok(n === 0 && w.hist().length === 2, "saving the same text again logs nothing");
}

// ── 6. who may call: 401 not signed in, 403 seller / other business
{
  const w = world();
  user = null;
  ok((await w.get()).status === 401 && (await w.put({ default_terms_included: "x" })).status === 401, "not signed in: GET and PUT are 401");
  user = SELLER;
  ok((await w.get()).status === 403 && (await w.put({ default_terms_included: "x" })).status === 403, "salesperson: GET and PUT are 403");
  user = OTHER;
  ok((await w.get()).status === 403 && (await w.put({ default_terms_included: "x" })).status === 403, "another business's owner: GET and PUT are 403");
  ok(w.row().default_terms_included === null, "nothing was written by the refused calls");
  user = OWNER;
}

// ── 7. columns missing (Worker deployed before the migration)
{
  user = OWNER;
  const w = world({ noColumns: true });
  let r = await w.get();
  ok(r.status === 200 && K.every((k) => r.data.settings[k] === null), "no columns: GET still works and returns the three as null");
  r = await w.put({ default_terms_included: "x", phone: "4075550100" });
  ok(r.status === 200 && !!r.data.field_errors.default_terms_included && /not available yet|ainda n/i.test(r.data.field_errors.default_terms_included.en + r.data.field_errors.default_terms_included.pt), "no columns: a real text answers 'not available yet' for that field");
  ok(w.row().phone === "4075550100" && !r.data.field_errors.phone, "no columns: the rest of doc settings still saves");
  r = await w.put({ default_terms_included: null, default_terms_excluded: "" });
  ok(r.status === 200 && !r.data.field_errors.default_terms_included, "no columns: clearing a field that was never saved is not an error");
  const c = await w.create({ terms_included: "typed" });
  ok(c.status === 200 && w.est().terms_included === "typed", "no columns: creating an estimate still works");
  const w2 = world({ noColumns: true });
  ok((await w2.create({})).status === 200 && w2.est().terms_included === null, "no columns: absent key stays empty (no crash)");
}

// ── 8. create fallback: ABSENT key takes the default, empty string / null stays empty
{
  user = OWNER;
  const seed = { default_terms_included: "INC\n\n- a", default_terms_excluded: "EXC", default_customer_notes: "NOTES\n\nmore" };
  let w = world({ seed });
  let c = await w.create({});
  ok(c.status === 200 && w.est().terms_included === "INC\n\n- a" && w.est().terms_excluded === "EXC" && w.est().customer_notes === "NOTES\n\nmore", "absent keys take the saved defaults, line breaks kept");
  w = world({ seed });
  c = await w.create({ terms_included: "", terms_excluded: null, customer_notes: "mine" });
  ok(w.est().terms_included === null && w.est().terms_excluded === null && w.est().customer_notes === "mine", "empty string and null mean 'cleared': stay empty; a typed text wins");
  w = world({ seed });
  c = await w.create({ terms_included: "only this" });
  ok(w.est().terms_included === "only this" && w.est().terms_excluded === "EXC" && w.est().customer_notes === "NOTES\n\nmore", "keys are decided one by one");
  w = world();
  c = await w.create({});
  ok(w.est().terms_included === null && w.est().terms_excluded === null && w.est().customer_notes === null, "nothing saved: nothing is invented");
}

// ── 9. frontend: the new-estimate state
const gm = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
function fnSrc(name) {
  const i = gm.indexOf("\nfunction " + name + "(");
  if (i < 0) throw new Error("gm.js function not found: " + name);
  return gm.slice(i + 1, gm.indexOf("\n}", i + 1) + 2);
}
function front(settings, extra) {
  const calls = { api: [], started: [] };
  const code = ["gmEstWizNewState", "gmEstWizFromDetail", "gmEstWizardOpenForLead"].map(fnSrc).join("\n") +
    "\nreturn { gmEstWizNewState: gmEstWizNewState, gmEstWizFromDetail: gmEstWizFromDetail, gmEstWizardOpenForLead: gmEstWizardOpenForLead, setSettings: function(s){ gmDocSettings = s; }, getSettings: function(){ return gmDocSettings; } };";
  const fn = new Function("calls", "extra", "var gmDocSettings = " + JSON.stringify(settings) + ";" +
    "function gmServicoList(s){ return s ? [s] : []; } function gmLeadAddressLine(){ return ''; } function localDateStr(){ return '2026-12-01'; }" +
    "function gmEstHeadlineOption(){ return null; } function gmIsSeller(){ return !!extra.seller; }" +
    "function gmEstWizStart(l){ calls.started.push({ lead: l, settings: gmDocSettings }); } function gmToast(){}" +
    "function gmApi(p){ calls.api.push(p); return Promise.resolve({ settings: extra.loaded }); }" + code);
  return Object.assign(fn(calls, extra || {}), { calls });
}
const D = { default_terms_included: "INC\n\n- a", default_terms_excluded: "Não incluído", default_customer_notes: "NOTES\n\n• b" };
{
  let f = front(D);
  let s = f.gmEstWizNewState({ id: "l1", cliente: "Ana" });
  ok(s.terms_included === D.default_terms_included && s.terms_excluded === D.default_terms_excluded && s.customer_notes === D.default_customer_notes, "new estimate: the three boxes start from the saved defaults");
  f = front({ default_terms_included: null, default_terms_excluded: null, default_customer_notes: null });
  s = f.gmEstWizNewState({ id: "l1" });
  ok(s.terms_included === "" && s.terms_excluded === "" && s.customer_notes === "", "nothing saved: the boxes start empty as before");
  f = front({});
  s = f.gmEstWizNewState({ id: "l1" });
  ok(s.terms_included === "" && s.customer_notes === "", "settings without the fields: empty, never 'undefined'");
  f = front(null);
  ok(f.gmEstWizNewState({ id: "l1" }).terms_excluded === "", "no settings at all: empty");
  // editing / revising / copying an existing estimate keeps its own text
  f = front(D);
  let e = f.gmEstWizFromDetail({ id: "e1", lead_id: "l1", customer_name: "Ana", options: [], mode: "single", terms_included: "own", terms_excluded: null, customer_notes: "", internal_notes: "" });
  ok(e.terms_included === "own" && e.terms_excluded === "" && e.customer_notes === "", "existing estimate: keeps its own text; a cleared box stays cleared (defaults not applied)");
}
// settings not loaded yet (or loaded without the fields): load first, then start
{
  let f = front(null, { loaded: Object.assign({ setup_completed_at: "x" }, D) });
  f.gmEstWizardOpenForLead({ id: "l1" });
  await new Promise((r) => setTimeout(r, 0));
  ok(f.calls.api.indexOf("doc-settings") >= 0 && f.calls.started.length === 1 && f.calls.started[0].settings.default_terms_included === D.default_terms_included, "settings not loaded: loaded first, wizard starts with the defaults present");
  f = front({ setup_completed_at: "x", estimate_valid_days: 30 }, { loaded: Object.assign({ setup_completed_at: "x" }, D) });
  f.gmEstWizardOpenForLead({ id: "l1" });
  await new Promise((r) => setTimeout(r, 0));
  ok(f.calls.api.length === 1 && f.calls.started[0].settings.default_terms_included === D.default_terms_included, "settings loaded but without the three fields: reloaded before the wizard starts");
  f = front(Object.assign({ setup_completed_at: "x" }, D), { loaded: {} });
  f.gmEstWizardOpenForLead({ id: "l1" });
  ok(f.calls.api.length === 0 && f.calls.started.length === 1, "settings already carry the fields (even null): no extra load");
  f = front({ x: 1 }, { seller: true });
  f.gmEstWizardOpenForLead({ id: "l1" });
  ok(f.calls.api.length === 0 && f.calls.started.length === 1, "salesperson: never calls the owner-only route");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
