// Job 40: an owner whose work needs no state contractor license can finish
// estimate setup by saying so.
// The REAL Worker functions (cut out of worker/index.js) on an in-memory
// SQLite, the real contract composer against the real clause library seed,
// and the real header line of every customer document page.
// No network, no production database, nothing written.
//
//   node scripts/test-license-not-required.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, req, fnSrc, workerSrc } from "./fixtures/d1-shim.mjs";
import { buildComposer, FLORIDA_FIXTURES } from "./fixtures/contract-compose-harness.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");
const gmSrc = read("gm.js");
const iosSrc = read("ios/App/App/public/gm.js");
const migration = read("migrations/license_not_required.sql");

const NEEDED_EN = "Enter at least one license number, or tick the box if your work does not require a state license.";
const NEEDED_PT = "Informe ao menos um n\u00famero de licen\u00e7a, ou marque a caixa se o seu trabalho n\u00e3o exige licen\u00e7a estadual.";

const FNS = ["gmLicenseSatisfied", "gmLicenseNotRequiredColumnReady", "gmLicenseNotRequiredRead", "gmReviewLinkParse", "gmReviewLinkColumnReady", "gmReviewLinkRead",
  "gmStr", "gmNum", "gmRunUpdate", "gmOwnedRow", "sessionSellerName", "gmDocHexColor", "gmDocParseLicenses", "gmDocParseJsonObject", "gmDocParsePaymentMethods",
  "gmDocParseLateFeePct", "gmDocParseSchedulePresets", "gmDocScheduleStepsError", "gmDocSettingsRow", "gmDocSettingsOwnerOnly", "handleGetGmDocSettings",
  "handlePutGmDocSettings", "handleGetGmDocSettingsHistory", "handlePostGmEstimate", "gmEstimatePublicPayload", "gmEstDerivedStatus", "logoVersionParam",
  "gmActorReplacer"];
const VARS = ["GM_LICENSE_NEEDED_PT", "GM_LICENSE_NEEDED_EN", "GM_REVIEW_LINK_HOSTS", "GM_REVIEW_LINK_BAD_PT", "GM_REVIEW_LINK_BAD_EN", "GM_DOC_SETTINGS_FIELDS",
  "GM_DOC_PAYMENT_METHODS", "GM_DOC_LATE_FEE_MAX_PCT", "GM_DOC_LATE_FEE_CAP_MESSAGE", "GM_DOC_DEFAULT_SCHEDULE_PRESETS", "GM_ACTOR_KEY_RE"];

const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "ZETA FLOORS", username: "zeta" };
const SELLER = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Maria Silva", display_name: "Maria Silva", username: "maria" };
const RIVAL = { role: "client", client_id: "c2", login_role: "client", display_name: "OMEGA ROOFING", username: "omega" };
let user = OWNER;

// migrated: run the real migration file. seed: a gm_doc_settings row to start from.
function world(opts) {
  opts = opts || {};
  const d = makeDb();
  d.raw.exec("CREATE TABLE gm_doc_settings (client_id TEXT PRIMARY KEY, brand_primary TEXT, brand_accent TEXT, legal_name TEXT, address TEXT, phone TEXT, email TEXT, license_numbers TEXT, estimate_valid_days INTEGER, default_terms_days INTEGER, payment_methods_json TEXT, late_fee_annual_pct REAL, late_fee_grace_days INTEGER, schedule_presets_json TEXT, estimate_message TEXT, invoice_message TEXT, receipt_message TEXT, contract_message TEXT, setup_completed_at TEXT, updated_at TEXT, updated_by TEXT)");
  d.raw.exec("CREATE TABLE gm_doc_settings_history (id TEXT PRIMARY KEY, client_id TEXT, field TEXT, old_value TEXT, new_value TEXT, actor TEXT, created_at TEXT DEFAULT (datetime('now')))");
  d.raw.exec("CREATE TABLE gm_config (client_id TEXT PRIMARY KEY, target_margin REAL)");
  d.raw.exec("CREATE TABLE gm_leads (id TEXT PRIMARY KEY, client_id TEXT, cliente TEXT)");
  if (opts.migrated !== false) {
    migration.replace(/^\s*--[^\n]*$/gm, "").split(";").forEach((stmt) => { if (stmt.trim()) { d.raw.exec(stmt); } });
  }
  d.raw.prepare("INSERT INTO clients (id, name, language) VALUES ('c1', 'Zeta Floors', 'en'), ('c2', 'Omega Roofing', 'en')").run();
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
    gmDocHero: () => ({ url: null, hero: null }),
    gmEstApplyBrandOverride: () => {},
    gmUtcStampToEasternDate: (s) => String(s || "").slice(0, 10),
    gmEstSellerGuard: async () => null,
    // Reaching the body parser proves the setup check let the request through.
    gmEstParseBody: async () => { parsedCalls++; return { error: "REACHED_PARSER" }; },
    GM_HIDDEN_ACTORS: { system: true, developer: true }
  });
  const F = build(FNS, VARS, stubs);
  const env = { DB: d.DB };
  return {
    d, env, F, parsed: () => parsedCalls,
    put: (body) => F.handlePutGmDocSettings("c1", req(body), env),
    get: () => F.handleGetGmDocSettings("c1", req({}, "https://x.test/api/clients/c1/gm/doc-settings"), env),
    row: () => d.q("SELECT * FROM gm_doc_settings WHERE client_id = 'c1'")[0] || null,
    hist: (field) => d.q("SELECT field, old_value, new_value, actor FROM gm_doc_settings_history WHERE client_id = 'c1' AND field = ? ORDER BY rowid", field),
    startEstimate: () => F.handlePostGmEstimate("c1", req({ lead_id: "l1" }), env)
  };
}

// ── 1. the rule on a first save
{
  user = OWNER;
  const w = world();
  let r = await w.put({ legal_name: "Zeta Floors LLC", license_numbers: [] });
  ok(r.status === 400 && r.error_en === NEEDED_EN && r.error_pt === NEEDED_PT && w.row() === null, "refused with neither a number nor the box, with the exact message in both languages, and nothing saved");
  r = await w.put({ legal_name: "Zeta Floors LLC", license_numbers: [], license_not_required: false });
  ok(r.status === 400 && r.error_en === NEEDED_EN && w.row() === null, "refused with no number and the box sent unticked");
  r = await w.put({ legal_name: "Zeta Floors LLC", license_numbers: ["  "], license_not_required: 0 });
  ok(r.status === 400 && w.row() === null, "a blank license number does not count as a number");
  r = await w.put({ brand_primary: "#1f2a44" });
  ok(r.status === 200 && r.data.setup_completed === false && w.row().setup_completed_at === null, "a save that touches neither one (a color) still works and does not complete setup");
}
{
  const w = world();
  const r = await w.put({ legal_name: "Zeta Floors LLC", license_numbers: ["CPC1234567"], license_not_required: false });
  const row = w.row();
  ok(r.status === 200 && r.data.setup_completed === true && !!row.setup_completed_at && row.license_not_required === 0 && row.license_not_required_by === null && row.license_not_required_at === null,
    "accepted with a number only: setup complete, box not ticked, no who and no when");
  ok(w.hist("license_not_required").length === 0, "a number-only save writes no 'License not required' history line");
  ok(r.data.settings.license_not_required === false && r.data.settings.license_not_required_by === null && r.data.settings.license_not_required_at === null, "the answer says the box is not ticked");
}

// ── 2. the box only: who and when, then unticking
{
  const w = world();
  const before = Date.now();
  let r = await w.put({ legal_name: "Zeta Floors LLC", license_numbers: [], license_not_required: true });
  let row = w.row();
  ok(r.status === 200 && r.data.setup_completed === true && !!row.setup_completed_at, "accepted with the box only, and setup counts as complete");
  ok(row.license_not_required === 1 && row.license_not_required_by === "ZETA FLOORS", "who is stored: the same name the settings history uses");
  const at = Date.parse(String(row.license_not_required_at).replace(" ", "T") + "Z");
  ok(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(row.license_not_required_at) && Math.abs(at - before) < 60000, "when is stored as a UTC timestamp of now (" + row.license_not_required_at + ")");
  ok(r.data.settings.license_not_required === true && r.data.settings.license_not_required_by === "ZETA FLOORS" && r.data.settings.license_not_required_at === row.license_not_required_at, "the save answer carries the flag, who and when for the form");
  let h = w.hist("license_not_required");
  ok(h.length === 1 && h[0].old_value === "0" && h[0].new_value === "1" && h[0].actor === "ZETA FLOORS", "ticking is one line in the settings history, by the owner");
  ok(row.license_numbers === "[]", "no license number was invented");
  const g = await w.get();
  ok(g.status === 200 && g.data.settings.license_not_required === true && g.data.settings.license_not_required_by === "ZETA FLOORS" && g.data.settings.license_not_required_at === row.license_not_required_at && g.data.settings.license_numbers.length === 0, "the settings read returns the flag, who and when");

  r = await w.put({ license_numbers: [], license_not_required: true, phone: "4075550100" });
  ok(r.status === 200 && w.hist("license_not_required").length === 1 && w.row().license_not_required_at === row.license_not_required_at, "saving again with the box still ticked keeps the first who and when and adds no history line");

  r = await w.put({ license_numbers: [], license_not_required: false });
  ok(r.status === 400 && r.error_en === NEEDED_EN && w.row().license_not_required === 1, "unticking with no number on file is refused and nothing changes");

  r = await w.put({ license_numbers: ["CFC000111"], license_not_required: false });
  row = w.row();
  ok(r.status === 200 && row.license_not_required === 0 && row.license_not_required_by === null && row.license_not_required_at === null, "unticking (with a number added) clears the flag, who and when");
  h = w.hist("license_not_required");
  ok(h.length === 2 && h[1].old_value === "1" && h[1].new_value === "0", "unticking is one more line in the settings history");
  const hr = await w.F.handleGetGmDocSettingsHistory("c1", req({}), w.env);
  ok(hr.status === 200 && hr.data.history.filter((x) => x.field === "license_not_required").length === 2, "the history route returns both lines");
  ok(r.data.settings.license_not_required === false && r.data.settings.license_not_required_by === null, "the answer after unticking has no who");
}

// ── 3. only the owner
{
  const w = world({ seed: { legal_name: "Zeta Floors LLC", license_numbers: "[\"CPC123\"]", setup_completed_at: "2026-09-01 10:00:00" } });
  user = SELLER;
  let r = await w.put({ license_not_required: true });
  ok(r.status === 403 && w.row().license_not_required === 0 && w.hist("license_not_required").length === 0, "a seller is refused (403) and nothing is saved");
  r = await w.get();
  ok(r.status === 403, "a seller cannot read the settings that carry the box");
  user = RIVAL;
  r = await w.put({ license_not_required: true });
  ok(r.status === 403 && w.row().license_not_required === 0, "another business's owner is refused");
  user = null;
  r = await w.put({ license_not_required: true });
  ok(r.status === 401, "no session is refused");
  user = OWNER;
}

// ── 4. the estimate-start check
{
  user = OWNER;
  const w = world();
  let r = await w.startEstimate();
  ok(r.status === 400 && /Complete the document settings/.test(r.error) && w.parsed() === 0, "no settings yet: starting an estimate is refused");
  await w.put({ legal_name: "Zeta Floors LLC", license_numbers: [], license_not_required: true });
  r = await w.startEstimate();
  ok(r.error === "REACHED_PARSER" && w.parsed() === 1, "with the box ticked and no number, the estimate-start check passes");
}
{
  const w = world({ seed: { legal_name: "Zeta Floors LLC", license_numbers: "[\"CPC123\"]", setup_completed_at: "2026-09-01 10:00:00" } });
  const r = await w.startEstimate();
  ok(r.error === "REACHED_PARSER", "a business with a number and no tick starts an estimate as before");
}
{
  // Setup marked complete, but neither a number nor the statement on file.
  const w = world({ seed: { legal_name: "Zeta Floors LLC", license_numbers: "[]", setup_completed_at: "2026-09-01 10:00:00" } });
  const r = await w.startEstimate();
  ok(r.status === 400 && w.parsed() === 0, "setup complete but neither a number nor the box: still refused");
}

// ── 5. a missing column (Worker deployed before the migration)
{
  user = OWNER;
  const w = world({ migrated: false, seed: { legal_name: "Zeta Floors LLC", license_numbers: "[\"CPC123\"]", setup_completed_at: "2026-09-01 10:00:00" } });
  const g = await w.get();
  ok(g.status === 200 && g.data.settings.license_not_required === false && g.data.settings.license_not_required_by === null && g.data.settings.license_numbers[0] === "CPC123", "no columns: the settings read works and the box reads as unticked");
  let r = await w.put({ phone: "4075550100", license_numbers: ["CPC123"], license_not_required: false });
  ok(r.status === 200 && w.row().phone === "4075550100", "no columns: an ordinary save (box unticked, as the page sends it) works");
  r = await w.put({ phone: "4075550199", license_not_required: true });
  ok(r.status === 503 && /cannot be saved yet/.test(r.error_en) && !/SQL|column|no such/i.test(r.error_en + r.error_pt) && w.row().phone === "4075550100", "no columns: ticking the box is refused with a plain message and nothing is saved");
  ok((await w.startEstimate()).error === "REACHED_PARSER", "no columns: a business with a number still starts an estimate");
  const w2 = world({ migrated: false });
  r = await w2.put({ legal_name: "New LLC", license_numbers: ["CGC1"] });
  ok(r.status === 200 && r.data.setup_completed === true, "no columns: a first save with a number completes setup as today");
  r = await world({ migrated: false }).put({ legal_name: "New LLC", license_numbers: [] });
  ok(r.status === 400 && r.error_en === NEEDED_EN, "no columns: a first save with no number is refused with the same message");
}

// ── 6. a business that already completed setup with a number is not affected
{
  const w = world({ seed: { legal_name: "Zeta Floors LLC", license_numbers: "[\"CPC123\"]", setup_completed_at: "2026-09-01 10:00:00" } });
  const r = await w.put({ license_numbers: ["CPC123"], license_not_required: false, email: "office@zeta.test" });
  const row = w.row();
  ok(r.status === 200 && r.data.setup_completed === false && row.setup_completed_at === "2026-09-01 10:00:00" && row.license_numbers === "[\"CPC123\"]" && row.license_not_required === 0, "an existing business saves as before: same setup date, same number, box unticked");
  ok(w.hist("license_not_required").length === 0 && w.hist("license_numbers").length === 0 && w.hist("email").length === 1, "its history shows only what it changed");
}

// ── 7. what a customer document carries
{
  const w = world();
  const est = { client_id: "c1", number: "EST-0001", revision: 1, options: [], schedule: [], status: "sent", sent_at: "2026-10-06 14:00:00", created_at: "2026-10-06 13:00:00" };
  const stubbedDerived = w.F.gmEstimatePublicPayload;
  const none = stubbedDerived(est, await (async () => { await w.put({ legal_name: "Zeta Floors LLC", license_numbers: [], license_not_required: true }); return w.F.gmDocSettingsRow(w.env, "c1"); })(), { name: "Zeta Floors" }, "https://x.test");
  ok(Array.isArray(none.business.license_numbers) && none.business.license_numbers.length === 0, "estimate payload, box ticked and no numbers: the license list is empty");
  const flat = JSON.stringify(none);
  ok(!/license_not_required|not required|exempt|isento|n\u00e3o exig/i.test(flat), "the customer payload carries no flag and no sentence about the license");
  await w.put({ license_numbers: ["CPC1234567", "CFC000111"], license_not_required: true });
  const both = w.F.gmEstimatePublicPayload(est, await w.F.gmDocSettingsRow(w.env, "c1"), { name: "Zeta Floors" }, "https://x.test");
  ok(w.row().license_not_required === 1 && both.business.license_numbers.join(",") === "CPC1234567,CFC000111", "a business with numbers AND the box ticked still sends its numbers");
  ok(!/license_not_required/.test(JSON.stringify(both)), "and still no flag in the customer payload");
}

// Every customer page and PDF template builds its license line(s) from the
// list, one line per number. The real line is run with an empty list.
const PAGES = ["estimate-view.html", "invoice-view.html", "receipt-view.html", "contract-view.html", "change-order-view.html", "ack-view.html",
  "templates/client-estimate-template.html", "templates/client-invoice-template.html", "templates/client-receipt-template.html",
  "templates/client-contract-template.html", "templates/client-change-order-template.html", "templates/client-affidavit-template.html"];
PAGES.forEach(function (rel) {
  const src = read(rel);
  const hits = src.split("\n").filter((l) => /license/i.test(l) && !/^\s*(\/\/|\*|<!--)/.test(l));
  const line = hits.filter((l) => l.indexOf('(b.license_numbers || []).forEach(function(l) { lines.push("License " + escHtml(l)); });') !== -1)[0];
  let empty = null, two = null;
  if (line) {
    const run = new Function("b", "escHtml", "var lines = [];\n" + line + "\nreturn lines;");
    empty = run({ license_numbers: [] }, (x) => x);
    two = run({ license_numbers: ["CPC1", "CFC2"] }, (x) => x);
  }
  ok(!!line && empty.length === 0 && two.join("|") === "License CPC1|License CFC2", rel + ": no license line with zero numbers, one line per number otherwise");
  // Anything else on the page that prints the word must also be driven by the list.
  // (Left out: the CSS comment, and a SUBCONTRACTOR's own license, which is
  // printed only when that subcontractor has one: "r.license ? ... : ''".)
  const others = hits.filter((l) => l !== line && /License/.test(l) && !/license_numbers/.test(l) && !/License, phone, email, address live HERE/.test(l) && !/\(r\.license \? /.test(l));
  ok(others.length === 0, rel + ": no other place prints the business's license label (" + others.length + " found)");
});
{
  // The affidavit also names the contractor in a table row.
  const src = read("templates/client-affidavit-template.html");
  ok(src.indexOf("(b.license_numbers && b.license_numbers.length ? ' &middot; License ' + escHtml(b.license_numbers.join(\", \")) : \"\")") !== -1, "affidavit: the contractor row adds 'License ...' only when there is a number");
}
{
  // The owner's own share text (gm.js) lists licenses the same way.
  ok(gmSrc.indexOf('(ds.license_numbers || []).forEach(function(l) { meta.push("License " + l); });') !== -1, "gm.js: the document preview header lists one entry per number, none with zero");
}

// ── 8. the contract
{
  const h = await buildComposer(workerSrc);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const fx = (name, patch) => Object.assign(clone(FLORIDA_FIXTURES[name]), patch || {});
  const text = (comp) => comp.sections.map((s) => (s.title || "") + "\n" + (s.text || "")).join("\n") + "\n" + (comp.notice_form_text || "");
  const L4 = (comp) => comp.sections.filter((s) => s.id === "L4");
  const hasBlock = (comp) => comp.blockers.some((b) => b.code === "license");

  for (const name of ["small-job", "residential-in-home-deposit"]) {
    const asToday = (await h.compose(fx(name))).comp;
    const ticked = (await h.compose(fx(name, { doc: { license_not_required: true } }))).comp;
    ok(JSON.stringify(ticked) === JSON.stringify(asToday) && L4(asToday).length === 1 && /CPC1459999/.test(L4(asToday)[0].text), "Florida " + name + ": a number on file and the box ticked composes exactly as a number alone, license line printed");

    const neither = (await h.compose(fx(name, { doc: { license_numbers: [] } }))).comp;
    ok(hasBlock(neither), "Florida " + name + ": no number and no tick is still blocked");

    const stated = (await h.compose(fx(name, { doc: { license_numbers: [], license_not_required: true } }))).comp;
    ok(!hasBlock(stated), "Florida " + name + ": no number and the box ticked is not blocked");
    ok(L4(stated).length === 0 && stated.rules.L4.on === false, "Florida " + name + ": the contract has no license line section");
    const t = text(stated);
    ok(!/License No\.|not provided|\{license|\{qualifier|Qualifying agent|license[- ]exempt|exempt from|not require a (state |contractor )*licen/i.test(t), "Florida " + name + ": no dangling license label, placeholder or exemption sentence in the text");
    ok(!stated.missing.some((m) => /license|qualifier/.test(m.field)), "Florida " + name + ": no license field is listed as missing");
    // Every other section is the same as with a number on file.
    const rest = (comp) => JSON.stringify(comp.sections.filter((s) => s.id !== "L4"));
    ok(rest(stated) === rest(asToday), "Florida " + name + ": every other notice and clause is unchanged");
  }
  // Outside Florida the license line used to print "not provided".
  const out = { flags: Object.assign({}, FLORIDA_FIXTURES["small-job"].flags, { job_state: "GA" }) };
  const gaNumber = (await h.compose(fx("small-job", out))).comp;
  const gaTickedNumber = (await h.compose(fx("small-job", Object.assign({ doc: { license_not_required: true } }, out)))).comp;
  ok(gaNumber.state.code === "GA" && JSON.stringify(gaNumber) === JSON.stringify(gaTickedNumber) && /CPC1459999/.test(L4(gaNumber)[0].text), "Georgia: a number on file prints as before, ticked or not");
  const gaNeither = (await h.compose(fx("small-job", Object.assign({ doc: { license_numbers: [] } }, out)))).comp;
  ok(/not provided/.test(L4(gaNeither)[0].text) && gaNeither.checklist.some((l) => l.key === "license_number" && l.variant === "missing"), "Georgia: no number and no tick behaves as today ('not provided', and the checklist asks for the number)");
  const gaStated = (await h.compose(fx("small-job", Object.assign({ doc: { license_numbers: [], license_not_required: true } }, out)))).comp;
  ok(L4(gaStated).length === 0 && !/not provided|No\. \.|\{license/.test(text(gaStated)), "Georgia: no number and the box ticked prints no license line and no 'not provided'");
  ok(!gaStated.checklist.some((l) => l.key === "license_number"), "Georgia: the checklist no longer asks to add a number");
  ok(JSON.stringify(gaStated.sections.filter((s) => s.id !== "L4")) === JSON.stringify(gaNeither.sections.filter((s) => s.id !== "L4")), "Georgia: every other notice and clause is unchanged");
}

// ── 9. the two contract gates outside the composer use the same rule
{
  const post = workerSrc.indexOf('if (!cleaning && jobState === "FL" && !gmLicenseSatisfied(doc))') !== -1;
  const ready = workerSrc.indexOf("doc_ready: { license: gmLicenseSatisfied(doc),") !== -1;
  const start = workerSrc.indexOf("if (!settings.setup_completed_at || !gmLicenseSatisfied(settings))") !== -1;
  ok(post && ready && start, "creating a Florida contract, the contract settings 'ready' flag and starting an estimate all read gmLicenseSatisfied");
  ok(!/license_numbers\.length\)/.test(workerSrc.replace(/gmLicenseSatisfied[\s\S]{0,200}?\n}/, "")), "no other Worker line still tests the number count alone to refuse something");
  const F = world().F;
  ok(F.gmLicenseSatisfied({ license_numbers: ["A"], license_not_required: false }) && F.gmLicenseSatisfied({ license_numbers: [], license_not_required: true }) &&
    !F.gmLicenseSatisfied({ license_numbers: [], license_not_required: false }) && !F.gmLicenseSatisfied({ license_numbers: [] }) && !F.gmLicenseSatisfied(null) &&
    !F.gmLicenseSatisfied({ license_numbers: [], license_not_required: 1 }), "gmLicenseSatisfied: a number, or the flag read from the settings row (true), and nothing else");
}

// ── 10. the form (gm.js and its iOS copy), read as text and run where it can be
[["gm.js", gmSrc], ["ios/App/App/public/gm.js", iosSrc]].forEach(function (pair) {
  const name = pair[0], src = pair[1];
  const has = (s) => src.indexOf(s) !== -1;
  ok(has('var GM_DOC_LNR_LABEL_EN = "My work does not require a state contractor license.";') && has('var GM_DOC_LNR_LABEL_PT = "O meu trabalho n\\u00e3o exige licen\\u00e7a estadual de contractor.";'), name + ": the tick box label, both languages");
  ok(has("Tick this only if none of the work you quote needs a state license. Structural changes, electrical, plumbing, air conditioning, roofing and pools do. If you are not sure, ask your state's contractor licensing agency before you tick it."), name + ": the small text, English, word for word");
  ok(has('var GM_DOC_LNR_NEEDED_EN = "' + NEEDED_EN + '";'), name + ": the refusal message matches the Worker's");
  ok(has("if (!licenses.length && !d.license_not_required) {") && has("license_not_required: !!d.license_not_required,"), name + ": the save check accepts the tick and sends it");
  const formAt = src.indexOf('gmT("+ Adicionar licen\u00e7a", "+ Add license")');
  ok(formAt !== -1 && src.slice(formAt, formAt + 120).indexOf("gmDocLicenseNotRequiredHtml(d, st)") !== -1, name + ": the box sits directly under the '+ Add license' button");
  ok(has('var GM_DOC_LICENSE_HELP_EN = "Florida law (\u00a7489.119) requires your license number on every bid and contract.";') && has('gmT("N\u00famero(s) de licen\u00e7a", "License number(s)")'), name + ": the existing label and help sentence are untouched");
  ok(has('<span class="gm-warn" id="gmDocLicenseStar"\' + (d.license_not_required ? \' hidden\' : \'\') + \'>*</span>'), name + ": the red star is hidden while the box is ticked");
  ok(has('license_not_required: ["Licen\\u00e7a n\\u00e3o exigida", "License not required"]'), name + ": the history label, both languages");
  ok(!/[^\x00-\x7F]/.test(["GM_DOC_LNR_LABEL_PT", "GM_DOC_LNR_HELP_PT", "GM_DOC_LNR_NEEDED_PT"].map((v) => src.split("\n").filter((l) => l.indexOf("var " + v + " =") === 0)[0]).join("")), name + ": the new Portuguese strings are plain ASCII with escapes");
  ok(!/\b(alert|confirm|prompt)\(/.test(fnSrc("gmDocLicenseNotRequiredHtml", src) + fnSrc("gmDocLicenseNotRequiredSet", src) + fnSrc("gmDocLicenseNotRequiredStatedText", src)), name + ": no browser pop-up in the new code");

  // The "Stated by" line, run for real with the page's own date helper.
  const dt = read("datetime.js");
  ["pt", "en"].forEach(function (lang) {
    const stated = new Function("lang", dt + "\nfunction gmT(pt, en) { return lang === 'en' ? en : pt; }\n" + fnSrc("gmDocLicenseNotRequiredStatedText", src) + "\nreturn gmDocLicenseNotRequiredStatedText;")(lang);
    const full = stated({ license_not_required: true, license_not_required_by: "ZETA FLOORS", license_not_required_at: "2026-10-06 15:30:00" });
    ok(full === (lang === "en" ? "Stated by ZETA FLOORS on 10/06/2026" : "Declarado por ZETA FLOORS em 10/06/2026"), name + " [" + lang + "]: \"" + full + "\"");
    ok(stated({ license_not_required: true, license_not_required_by: null, license_not_required_at: "2026-10-01 15:30:00" }) === (lang === "en" ? "Stated on 10/01/2026" : "Declarado em 10/01/2026"), name + " [" + lang + "]: with no name to show, the date alone, month first (10/01/2026)");
    ok(stated({ license_not_required: true, license_not_required_by: "X", license_not_required_at: "2026-10-07 02:30:00" }).slice(-10) === "10/06/2026", name + " [" + lang + "]: an evening tick shows the Eastern date, not tomorrow's");
    ok(stated({ license_not_required: false, license_not_required_by: "X", license_not_required_at: "2026-10-06 15:30:00" }) === "" && stated(null) === "", name + " [" + lang + "]: nothing when the box is not ticked");
  });
});
ok(gmSrc.split("GM_DOC_LNR_").length === iosSrc.split("GM_DOC_LNR_").length && gmSrc.split("license_not_required").length === iosSrc.split("license_not_required").length, "gm.js and its iOS copy carry the same number of job 40 references");

// ── 11. the migration is add-only
{
  const body = migration.replace(/^\s*--[^\n]*$/gm, "");
  const stmts = body.split(";").map((s) => s.trim()).filter(Boolean);
  ok(stmts.length === 3 && stmts.every((s) => /^ALTER TABLE gm_doc_settings ADD COLUMN license_not_required(_by|_at)? /.test(s)), "the migration is three ADD COLUMN statements on gm_doc_settings");
  ok(/license_not_required INTEGER NOT NULL DEFAULT 0/.test(body) && !/\b(DROP|DELETE|UPDATE|INSERT|RENAME)\b/i.test(body), "the flag defaults to 0 and nothing is changed, deleted or written");
}

// A developer's name never reaches the screen: the key is an actor key.
{
  const F = world().F;
  ok(JSON.parse(JSON.stringify({ license_not_required_by: "developer" }, F.gmActorReplacer)).license_not_required_by === null && JSON.parse(JSON.stringify({ license_not_required_by: "ZETA FLOORS" }, F.gmActorReplacer)).license_not_required_by === "ZETA FLOORS",
    "license_not_required_by goes through the same name filter as every other 'by' field");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED");
process.exit(fail ? 1 : 0);
