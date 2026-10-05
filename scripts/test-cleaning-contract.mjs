// Cleaning service agreements (the sixth trade) in the client contract builder.
// Runs the real contractCompose (cut out of worker/index.js) against the real
// clause library seed PLUS migrations/contracts_e_cleaning.sql, and checks the
// migration against the draft it was generated from. No network, no
// production database, nothing written.
//   node scripts/test-cleaning-contract.mjs
import { readFileSync } from "node:fs";
import { buildComposer, FLORIDA_FIXTURES, goldenView, GOLDEN_DIR } from "./fixtures/contract-compose-harness.mjs";
import { parseCleaningDraft, buildCleaningSql, DRAFT_URL, SEED_URL, OUT_URL, CLEANING_QUESTION_BASE, OLD_LABEL_SENTENCE } from "./make-cleaning-migration.mjs";
import { stateFixture, GOLDEN_STATES } from "./make-cleaning-golden.mjs";

const root = new URL("../", import.meta.url);
const workerSrc = readFileSync(new URL("worker/index.js", root), "utf8");
const h = await buildComposer(workerSrc, { migrations: ["migrations/contracts_e_cleaning.sql"] });
const hSeedOnly = await buildComposer(workerSrc);
const F = h.fns;
const draftMd = readFileSync(DRAFT_URL, "utf8");
const draft = parseCleaningDraft(draftMd);
const TPLS = ["T1", "T2", "T3", "T4"];

let failed = 0, passed = 0;
function ok(cond, label) { if (cond) { passed++; console.log("PASS  " + label); } else { failed++; console.log("FAIL  " + label); } }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function allText(comp) {
  return comp.sections.map(function (s) { return (s.title || "") + "\n" + (s.text || ""); }).join("\n") + "\n" + (comp.notice_form_text || "") + "\n" + (comp.disclaimer_line || "");
}
function sec(comp, id) { return comp.sections.filter(function (s) { return s.id === id; })[0] || null; }
function cleanFx(tpl, patch) {
  const fx = { amount_cents: 18000, item_name: "House cleaning", schedule: [{ label: "On completion", pct: 100 }], settings: { trades: ["cleaning"], values: {} }, doc: { legal_name: "Bright Home Cleaning LLC" },
    flags: { kind: "cleaning", cleaning_template: tpl, sold_in_home: true, job_state: "FL" } };
  Object.keys(patch || {}).forEach(function (k) {
    fx[k] = (patch[k] && typeof patch[k] === "object" && !Array.isArray(patch[k]) && fx[k] && typeof fx[k] === "object") ? Object.assign({}, fx[k], patch[k]) : patch[k];
  });
  return fx;
}
// Answer everything the builder still asks, the way an owner would.
const SAMPLE = { claim_window_hours: "24", late_cancel_fee: "$45.00", no_access_fee: "$45.00", tier2_percent: "25", tier3_percent: "50", service_date: "11/20/2026", end_date: "10/01/2027",
  condition_ack_deadline: "10/15/2026", authorization_date: "10/01/2026", visits_per_month: "4", early_termination_fee: "$50.00", term_remaining_price: "$2,000.00", conversion_fee: "$100.00" };
async function composeFull(fx) {
  let r = await h.compose(fx);
  for (let i = 0; i < 4 && r.comp.missing.length; i++) {
    const answers = Object.assign({}, fx.answers || {});
    r.comp.missing.forEach(function (m) { answers[m.field] = SAMPLE[m.field] || (/_(hours|days|minutes|months|percent|steps|lbs|size)$|^nonsolicit|^visit_count|^hours_per/.test(m.field) ? "2" : "sample " + m.field.replace(/_/g, " ")); });
    fx = Object.assign({}, fx, { answers: answers });
    r = await h.compose(fx);
  }
  return r;
}
function draftTemplates(o) {
  const t = String(o.templates || "").replace(/\([^)]*\)/g, " ");
  return /\ball\b/.test(t) ? TPLS.slice() : (t.match(/T[1-4]/g) || []);
}

// ── A. The migration is a byte-exact copy of the draft ───────────────────
{
  const built = buildCleaningSql(draftMd, readFileSync(SEED_URL, "utf8"));
  ok(readFileSync(OUT_URL, "utf8") === built.sql, "migrations/contracts_e_cleaning.sql is exactly what the generator writes from the draft (" + built.rows + " rows)");
  const sql = readFileSync(OUT_URL, "utf8");
  const stmts = sql.split("\n").filter(function (l) { return /^(INSERT|UPDATE|ALTER|DELETE|DROP|CREATE)\b/.test(l); });
  ok(stmts.length === 186 && built.rows === 186, "the migration holds 186 statements (1 label update, 16 blocks, 19 areas, 79 options, 44 placeholder rows, 27 questions), got " + stmts.length);
  ok(stmts.every(function (l) { return /^INSERT OR IGNORE INTO contract_(locked_blocks|clause_areas|clause_options|placeholders|attorney_questions) /.test(l) || /^UPDATE contract_library_versions SET label = REPLACE\(label, /.test(l); }) &&
    stmts.filter(function (l) { return /^UPDATE/.test(l); }).length === 1 && !/\b(ALTER|DELETE|DROP)\b/.test(stmts.map(function (l) { return l.slice(0, 12); }).join(" ")),
    "only INSERT OR IGNORE and ONE UPDATE of the version label; no ALTER, no DELETE");
  const db = h.env.raw;
  const rowsO = db.prepare("SELECT id, clause_text, owner_description, pt_summary, placeholders, trades, area_id, version, scope FROM contract_clause_options WHERE id LIKE 'CL%' ORDER BY sort_order").all();
  const rowsB = db.prepare("SELECT id, text, version FROM contract_locked_blocks WHERE id LIKE 'LC%' ORDER BY sort_order").all();
  ok(rowsO.length === 79 && draft.options.length === 79 && rowsB.length === 16 && draft.blocks.length === 16, "79 clause options and 16 locked-block rows, as in the draft");
  ok(rowsO.every(function (r, i) { const d = draft.options[i]; return r.id === d.id && r.clause_text === d.clause_text && r.owner_description === d.owner_description && r.pt_summary === d.pt_summary && r.placeholders === d.placeholders && r.trades === "Cleaning: " + d.templates && r.version === 1 && r.scope === "apex"; }),
    "every clause option row equals the draft: text, owner line, Portuguese summary, fields and templates");
  ok(rowsB.every(function (r, i) { return r.id === draft.blocks[i].id && r.text === draft.blocks[i].text && r.version === 1; }), "every locked-block row equals the draft");
  // Independent of the parser: put the "> " back and find the block in the draft file.
  function quoted(t) { return t.split("\n").map(function (l) { return l === "" ? ">" : "> " + l; }).join("\n"); }
  const notFound = rowsO.map(function (r) { return [r.id, r.clause_text]; }).concat(rowsB.filter(function (r) { return r.text !== null; }).map(function (r) { return [r.id, r.text]; }))
    .filter(function (x) { return draftMd.indexOf("\n" + quoted(x[1]) + "\n") === -1; }).map(function (x) { return x[0]; });
  ok(notFound.length === 0, "every clause and block text is found byte for byte in the draft file" + (notFound.length ? " (" + notFound.join(", ") + ")" : ""));
  ok(rowsB.filter(function (r) { return r.text !== null; }).map(function (r) { return r.id; }).join() === "LC1,LC2-A,LC2-B,LC3-A,LC4-A,LC4-B,LC5-A,LC5-B", "the blocks that carry text are LC1, LC2-A, LC2-B, LC3-A, LC4-A, LC4-B, LC5-A, LC5-B; LC1-B, LC6 and LC7 carry none");
  ok(db.prepare("SELECT COUNT(*) AS c FROM contract_clause_options WHERE id LIKE 'CL%' AND id NOT GLOB 'CL[0-9][0-9]-[A-Z]'").get().c === 0 && db.prepare("SELECT COUNT(*) AS c FROM contract_clause_areas WHERE id GLOB 'CL[0-9][0-9]'").get().c === 19, "new ids only: CL01 to CL19 and CLnn-X");
  const label = db.prepare("SELECT label, status FROM contract_library_versions WHERE version = 1").get();
  ok(label.label.indexOf(OLD_LABEL_SENTENCE) === -1 && /Cleaning services \(residential recurring; one-time or move-out; short-term-rental turnover; small commercial office\): draft 1, 2026-10-04\.$/.test(label.label) && /^Version: draft 1, 2026-09-26\. Trades covered: Pools and Spas;/.test(label.label) && label.status === "draft",
    "the version label no longer says cleaning is out of scope, keeps the rest, and stays a draft");
  const qs = db.prepare("SELECT n, group_name, text FROM contract_attorney_questions WHERE version = 1 ORDER BY n").all();
  const cq = qs.filter(function (x) { return x.n > CLEANING_QUESTION_BASE; });
  ok(qs.length - cq.length === 30 && cq.length === 27 && cq.every(function (x, i) { return x.n === CLEANING_QUESTION_BASE + draft.questions[i].n && x.text === draft.questions[i].text && /^Cleaning: (Locked blocks|Clause options)$/.test(x.group_name); }),
    "the 27 cleaning attorney questions are loaded beside the 30 existing ones, marked Cleaning, numbered 101 to 127");
  // Running the file twice changes nothing.
  const before = JSON.stringify(db.prepare("SELECT COUNT(*) AS c FROM contract_clause_options").get()) + label.label;
  db.exec(sql);
  ok(JSON.stringify(db.prepare("SELECT COUNT(*) AS c FROM contract_clause_options").get()) + db.prepare("SELECT label FROM contract_library_versions WHERE version = 1").get().label === before, "running the migration a second time changes nothing");
  const seedIds = hSeedOnly.env.raw.prepare("SELECT id, clause_text FROM contract_clause_options ORDER BY id").all();
  ok(JSON.stringify(seedIds) === JSON.stringify(db.prepare("SELECT id, clause_text FROM contract_clause_options WHERE id NOT LIKE 'CL%' ORDER BY id").all()), "no existing clause option row is touched by the migration");
}

// ── B. Nothing changes for the five construction trades ──────────────────
for (const name of Object.keys(FLORIDA_FIXTURES)) {
  const g = JSON.stringify(JSON.parse(readFileSync(new URL("state-riders-golden-" + name + ".json", GOLDEN_DIR), "utf8")));
  const fl = await h.compose(clone(FLORIDA_FIXTURES[name]));
  ok(JSON.stringify(goldenView(fl.comp)) === g, "Florida golden with the cleaning library loaded: " + name);
  for (const code of GOLDEN_STATES) {
    const gs = JSON.stringify(JSON.parse(readFileSync(new URL("cleaning-golden-" + name + "-" + code + ".json", GOLDEN_DIR), "utf8")));
    const st = await h.compose(stateFixture(name, code));
    const seedOnly = await hSeedOnly.compose(stateFixture(name, code));
    ok(JSON.stringify(goldenView(st.comp)) === gs && JSON.stringify(goldenView(seedOnly.comp)) === gs, code + " golden (made before the cleaning trade), with and without the cleaning library loaded: " + name);
  }
}
{
  const ctx = await h.context(clone(FLORIDA_FIXTURES["small-job"]));
  const slice = JSON.stringify([ctx.lib.clause_areas, ctx.lib.clause_options, ctx.lib.optionsForClient, Object.keys(ctx.lib.optionsById), ctx.lib.locked_blocks, ctx.lib.placeholders, ctx.lib.exclusion_checklists]);
  ok(!/"CL\d\d/.test(slice) && !/"LC\d/.test(slice) && !/Cleaning:/.test(slice), "a construction-only business: no cleaning area, option, block or placeholder row in the library slices the settings and builder payloads are built from");
  ok(JSON.stringify(F.contractKindsFor(ctx.settings, ctx.lib)) === "[\"construction\"]" && F.contractHasCleaningTrade(ctx.settings) === false, "a construction-only business has one kind (construction) and is never asked");
  const comp = (await h.compose(clone(FLORIDA_FIXTURES["small-job"]))).comp;
  ok(comp.kind === undefined && comp.cleaning === undefined && comp.guardrails === undefined && Object.keys(comp.rules).every(function (k) { return /^L\d/.test(k); }), "a construction contract's composed result carries no cleaning key");
  ok(F.contractOptionTrades("all").join() === "pools,tile,remodeling,hardscape,general" && F.contractOptionTrades("Cleaning: all").join() === "cleaning" && F.contractOptionTrades("Pools and Spas").join() === "pools" && F.contractOptionTrades("").indexOf("cleaning") === -1,
    "\"all\" on a construction row still means the five construction trades; a cleaning row is cleaning only");
  const both = await h.context({ amount_cents: 18000, schedule: [], settings: { trades: ["general", "cleaning"] } });
  ok(JSON.stringify(F.contractKindsFor(both.settings, both.lib)) === "[\"construction\",\"cleaning\"]" && both.lib.optionsForClient.length > 0 && both.lib.optionsForClient.every(function (o) { return !/^CL/.test(o.id); }), "a business with both kinds is asked, and its construction options still hold no cleaning row");
  const only = await h.context({ amount_cents: 18000, schedule: [], settings: { trades: ["cleaning"] } });
  ok(JSON.stringify(F.contractKindsFor(only.settings, only.lib)) === "[\"cleaning\"]" && only.lib.optionsForClient.length === 0, "a cleaning-only business goes straight to cleaning and is offered no construction clause");
  const noLib = await hSeedOnly.context({ amount_cents: 18000, schedule: [], settings: { trades: ["general", "cleaning"] } });
  ok(JSON.stringify(F.contractKindsFor(noLib.settings, noLib.lib)) === "[\"construction\"]" && F.contractCleaningReady(noLib.lib) === false, "before the migration is run, the cleaning trade offers nothing");
}

// ── C. The four templates: areas, options and blocks as the draft lists ──
// The draft's section 3, as data: which blocks print by default per template.
const SECTION3 = {
  T1: { LC1: true, "LC1-B": false, LC2: true, LC3: true, LC4: false, "LC5-A": false, "LC5-B": false, LC6: true, LC7: false },
  T2: { LC1: false, "LC1-B": false, LC2: true, LC3: true, LC4: false, "LC5-A": false, "LC5-B": false, LC6: true, LC7: false },
  T3: { LC1: false, "LC1-B": false, LC2: false, LC3: false, LC4: false, "LC5-A": false, "LC5-B": true, LC6: true, LC7: false },
  T4: { LC1: false, "LC1-B": false, LC2: false, LC3: false, LC4: false, "LC5-A": true, "LC5-B": false, LC6: true, LC7: false }
};
for (const tpl of TPLS) {
  const r = await h.compose(cleanFx(tpl));
  const comp = r.comp;
  const offered = [];
  comp.cleaning.slots.forEach(function (s) { s.options.forEach(function (o) { offered.push(o.id.split(":")[0]); }); });
  // What the draft's own "Templates:" lines say, with the three rules the
  // draft states elsewhere: CL09-E is not for T2 (the CL09 area rule), CL09-F
  // shows only with CL09-B or C, CL18-B is T4 until the attorney allows T3.
  const want = draft.options.filter(function (o) { return draftTemplates(o).indexOf(tpl) !== -1 && !(o.id === "CL09-E" && tpl === "T2") && o.id !== "CL09-F"; }).map(function (o) { return o.id; });
  ok(JSON.stringify(offered.slice().sort()) === JSON.stringify(want.slice().sort()), tpl + ": the options offered are exactly the ones the draft's Templates lines name (" + offered.length + ")");
  const clauseIds = comp.sections.filter(function (s) { return s.kind === "clause"; }).map(function (s) { return s.id; });
  ok(clauseIds.length > 15 && clauseIds.every(function (id) { return want.indexOf(id) !== -1; }) && JSON.stringify(clauseIds) === JSON.stringify(clauseIds.slice().sort()), tpl + ": every printed clause is one of its template's options, in the draft's order (CL01 to CL19)");
  ok(comp.sections.every(function (s) { return /^(CL\d\d-[A-Z]|LC\d(-[A-Z])?|EXHIBIT-A|custom:CL\d\d)$/.test(s.id); }) && Object.keys(comp.rules).every(function (k) { return /^LC\d(-[A-Z])?$/.test(k); }), tpl + ": composed only from CL areas and LC blocks");
  ok(Object.keys(SECTION3[tpl]).every(function (k) { return comp.rules[k].on === SECTION3[tpl][k]; }), tpl + ": the locked-block rules match the draft's section 3 table by default");
  const areasOn = clauseIds.map(function (id) { return id.slice(0, 4); }).filter(function (a, i, arr) { return arr.indexOf(a) === i; });
  const wantAreas = tpl === "T3" ? 17 : (tpl === "T4" ? 17 : 16);
  ok(areasOn.length === wantAreas && (areasOn.indexOf("CL16") !== -1) === (tpl === "T3") && (areasOn.indexOf("CL17") !== -1) === (tpl === "T4") && areasOn.indexOf("CL15") === -1, tpl + ": CL16 only for T3, CL17 only for T4, CL15 off by default (" + areasOn.length + " areas)");
  const full = (await composeFull(cleanFx(tpl, tpl === "T4" ? { flags: Object.assign({}, cleanFx(tpl).flags, { sales_tax_registered: true }), admin: { cleaning_county_surtax: "Hillsborough=1.5" } } : (tpl === "T3" ? {} : { flags: Object.assign({}, cleanFx(tpl).flags, { oral_notice: { by: "Pat Owner", at: "2026-10-01 14:00:00" } }) })))).comp;
  ok(full.missing.length === 0 && full.blockers.length === 0, tpl + ": with every question answered there is nothing missing and no blocker" + (full.blockers.length ? " (" + full.blockers.map(function (b) { return b.code; }).join() + ")" : ""));
  const leftovers = allText(full).match(/\{[A-Za-z0-9_]+\}/g) || [];
  ok(leftovers.every(function (t) { return ["{customer_signature}", "{customer_signature_date}"].indexOf(t) !== -1; }), tpl + ": no placeholder is left in the text except the two signature tokens" + (leftovers.length ? " (" + leftovers.join(" ") + ")" : ""));
  const nums = full.sections.filter(function (s) { return s.kind === "clause"; }).map(function (s) { return Number(/^\*\*(\d+)\. /.exec(s.text)[1]); });
  ok(nums[0] === 1 && nums.every(function (n, i) { return i === 0 || n === nums[i - 1] || n === nums[i - 1] + 1; }) && nums[nums.length - 1] === wantAreas, tpl + ": sections are renumbered 1 to " + wantAreas + " with no gap");
  ok(!/Section \[CL|Section \{/.test(allText(full)), tpl + ": every cross-reference points to a real section number");
  ok(!!sec(full, "EXHIBIT-A") && /\*\*Included:\*\* House cleaning/.test(sec(full, "EXHIBIT-A").text), tpl + ": Exhibit A is printed, pre-filled from the accepted estimate's lines");
}
{
  // The draft's defaults.
  const t1 = (await h.compose(cleanFx("T1"))).c.selections, t2 = (await h.compose(cleanFx("T2"))).c.selections, t3 = (await h.compose(cleanFx("T3"))).c.selections, t4 = (await h.compose(cleanFx("T4"))).c.selections;
  ok([t1, t2, t3, t4].every(function (s) { return s.CL13 === "CL13-C" && s.CL14 === "CL14-B" && s["CL04-D"] === "CL04-D" && s.CL15 === undefined && s["CL10-D"] === "CL10-D" && s["CL07-L"] === "CL07-E"; }), "defaults: CL13-C, CL14-B, CL04-D, no CL15, CL10-D on, suspension-only late payment");
  ok(t1.CL01 === "CL01-A" && t2.CL01 === "CL01-A" && t3.CL01 === "CL01-B" && t4.CL01 === "CL01-C" && t2.CL09 === "CL09-D" && t1.CL09 === "CL09-A" && t3.CL16 === "CL16-A" && t3["CL16-B"] === "CL16-B" && t3["CL16-C"] === undefined && t4.CL17 === "CL17-A" && t4["CL17-B"] === "CL17-B" && t4["CL17-C"] === undefined,
    "defaults: CL01 by template, T2 gets the one-time sentence, CL16-A and B on for T3, CL17-A and B on for T4, their add-ons off");
  ok(t4.CL04 === undefined && t1.CL04 === "CL04-A" && t1["CL09-F"] === undefined, "T4 has no pets option; the early-termination choice is not asked on a month-to-month agreement");
}
{
  // Block rules beyond the default.
  const t1biz = (await h.compose(cleanFx("T1", { flags: Object.assign({}, cleanFx("T1").flags, { consumer: false }) }))).comp;
  ok(t1biz.rules.LC1.on === false && t1biz.rules.LC2.on === false && t1biz.rules.LC3.on === false, "T1 for a customer who is not an individual: LC1, LC2 and LC3 are off");
  const t1phone = (await h.compose(cleanFx("T1", { flags: Object.assign({}, cleanFx("T1").flags, { sold_in_home: false }) }))).comp;
  ok(t1phone.rules.LC1.on === true && t1phone.rules.LC2.on === false && t1phone.rules.LC3.on === false && t1phone.notice_form_text === null && !sec(t1phone, "LC2-A") && !!sec(t1phone, "LC1") && t1phone.requires.cancellation === true, "T1 not sold at the home: LC2 and LC3 are off, LC1 stays, the deadline is still stored");
  const t2more = (await h.compose(cleanFx("T2", { flags: Object.assign({}, cleanFx("T2").flags, { further_visits: true }) }))).comp;
  ok(t2more.rules.LC1.on === true && !!sec(t2more, "LC1"), "T2 that promises further visits: LC1 is on");
  const t3home = (await h.compose(cleanFx("T3", { flags: Object.assign({}, cleanFx("T3").flags, { sold_in_home: true, consumer: true }) }))).comp;
  ok(t3home.rules.LC1.on === false && t3home.rules.LC2.on === false && t3home.rules.LC1.flag === true && t3home.rules.LC2.flag === true, "T3: LC1 and LC2 stay off by default and are flagged as an attorney question");
  for (const tpl of ["T1", "T3", "T4"]) {
    const c = (await h.compose(cleanFx(tpl, { selections: { CL09: "CL09-B", "CL09-F": "CL09-F:none" }, flags: Object.assign({}, cleanFx(tpl).flags, { term_12_plus: true }) }))).comp;
    ok(c.rules.LC4.on === true && !!sec(c, "LC4-A") && sec(c, "LC4-A").beside_signature === true && sec(c, "LC4-A").format.min_pt === 12 && sec(c, "LC4-A").format.box === true && c.rules["LC4-B"].on === false &&
      /We will send you a written or electronic reminder between 30 and 60 days before the cancellation deadline\.\*\*$/.test(sec(c, "LC4-A").text) && /Early termination under this Section has no fee\.$/.test(sec(c, "CL09-B").text),
      tpl + " with CL09-B: the renewal panel prints at the signature (bold, 12 point, boxed), the 12-month sentence is the draft's, LC4-B is never sent");
  }
  const t2 = await h.context(cleanFx("T2"));
  const t2slots = F.contractCleaningSlots(t2, { flags: cleanFx("T2").flags, selections: {} }, F.contractCleaningGate(t2, "2026-10-01"));
  ok(t2slots.filter(function (s) { return s.area === "CL09"; }).length === 1 && t2slots.filter(function (s) { return s.area === "CL09"; })[0].options.map(function (o) { return o.id; }).join() === "CL09-D", "T2 is offered only the one-time sentence in CL09 (no CL09-B, so no LC4)");
  const all = [];
  for (const tpl of TPLS) { for (const flOn of [true, false]) { const c = (await h.compose(cleanFx(tpl, { flags: Object.assign({}, cleanFx(tpl).flags, { job_state: flOn ? "FL" : "MA", further_visits: true }), selections: tpl === "T2" ? {} : { CL09: "CL09-B", "CL09-F": "CL09-F:fee" } }))).comp; all.push(c); } }
  ok(all.every(function (c) { return c.rules["LC1-B"].on === false && c.rules.LC7.on === false && !sec(c, "LC1-B") && !sec(c, "LC7") && !sec(c, "LC4-B") && !sec(c, "LC2-C") && !/assignee/i.test(allText(c)); }), "LC1-B (assignee warning) and LC7 (construction notices) never print, in any template or state");
  const t1 = (await h.compose(cleanFx("T1"))).comp;
  ok(sec(t1, "LC1").beside_signature === true && sec(t1, "LC1").date_above === true && sec(t1, "LC1").format.bold === true && sec(t1, "LC2-A").beside_signature === true && sec(t1, "LC3-A").beside_signature === true &&
    /the seller, Bright Home Cleaning LLC, may keep/.test(sec(t1, "LC1").text) && /CUSTOMER SIGNATURE: \{customer_signature\} {4}DATE: \{customer_signature_date\}$/.test(sec(t1, "LC1").text), "T1: LC1, LC2-A and LC3-A print at the customer's signature; LC1 names the seller and keeps its signature line");
  ok(/^\*\*Notice of Cancellation\*\*/.test(t1.notice_form_text) && /NOT LATER THAN MIDNIGHT OF THE THIRD BUSINESS DAY AFTER YOU SIGN\.\*\*/.test(t1.notice_form_text) && !/\{/.test(t1.notice_form_text), "T1: the federal Notice of Cancellation form is complete before signing");
  const frozen = (await h.compose(cleanFx("T1"), "template")).comp;
  ok(/MIDNIGHT OF \{cancellation_deadline_date\}/.test(frozen.notice_form_text) && /\*\*\{transaction_date\}\*\* \(Date\)/.test(frozen.notice_form_text), "T1 frozen at company signing: the form keeps the two signing-time tokens the signing code fills");
  ok(t1.blockers.some(function (b) { return b.code === "cleaning_oral_notice"; }), "LC2-C: the oral notice must be confirmed before a home-sold agreement can be signed");
  const t3 = (await h.compose(cleanFx("T3"))).comp, t4 = (await h.compose(cleanFx("T4"))).comp;
  const ids3 = t3.sections.map(function (s) { return s.id; }), ids4 = t4.sections.map(function (s) { return s.id; });
  ok(ids3.indexOf("LC5-B") === ids3.indexOf("CL07-E") + 1 && ids4.indexOf("LC5-A") === ids4.indexOf("CL07-E") + 1 && !sec(t3, "LC5-A") && !sec(t4, "LC5-B"), "LC5-B prints after the payment clauses for T3, LC5-A for T4");
  ok(t4.blockers.some(function (b) { return b.code === "cleaning_surtax"; }) && t4.blockers.some(function (b) { return b.code === "cleaning_tax_status"; }) && /plus sales tax as described in Section 7,/.test(sec(t4, "CL06-C").text) && /the Florida sales tax and county surtax on its own line, each payment/.test(sec(t4, "CL07-B").text),
    "T4 in Florida: the tax wording is the draft's, and the county surtax (Apex data) and the registration answer are required");
}

// ── D. Locked-out options, the LC6 gate, never-printed codes ─────────────
{
  const ctx = await h.context(cleanFx("T4"));
  const gate = F.contractCleaningGate(ctx, "2026-10-01");
  ok(!gate.insured && !gate.workers_comp && !gate.bonded && !gate.screened, "LC6: with no record in the settings, nothing may be claimed");
  const lockedIds = [];
  for (const tpl of TPLS) { F.contractCleaningSlots(await h.context(cleanFx(tpl)), { flags: cleanFx(tpl).flags, selections: { CL09: "CL09-B" } }, gate).forEach(function (s) { s.options.forEach(function (o) { if (o.locked && lockedIds.indexOf(o.id) === -1) { lockedIds.push(o.id); } }); }); }
  ok(lockedIds.sort().join() === "CL10-B,CL10-E,CL13-A,CL13-B,CL14-A,CL15-B,CL17-C,CL18-B,CL19-B", "locked until a record or Apex data exists: " + lockedIds.join(", "));
  const forced = (await h.compose(cleanFx("T1", { selections: { CL13: "CL13-A", CL19: "CL19-B" } }))).comp;
  ok(forced.blockers.filter(function (b) { return b.code === "cleaning_locked"; }).length === 2, "a locked option that is chosen anyway blocks signing");
  const insured = { cleaning_insurance_on_file: "yes", cleaning_insurance_expiry: "2027-01-31", cleaning_insurance_summary: "Commercial general liability, Acme Mutual, expires 01/31/2027" };
  const ok13 = (await h.compose(cleanFx("T1", { settings: { trades: ["cleaning"], values: insured }, selections: { CL13: "CL13-A" } }))).comp;
  ok(!ok13.blockers.some(function (b) { return b.code === "cleaning_locked"; }) && /Contractor carries the insurance listed in the proposal: Commercial general liability, Acme Mutual, expires 01\/31\/2027\./.test(sec(ok13, "CL13-A").text), "LC6: with a current certificate recorded, CL13-A prints the summary on file");
  const expired = (await h.compose(cleanFx("T1", { settings: { trades: ["cleaning"], values: Object.assign({}, insured, { cleaning_insurance_expiry: "2026-09-30" }) }, selections: { CL13: "CL13-A" } }))).comp;
  ok(expired.blockers.some(function (b) { return b.code === "cleaning_locked"; }) && expired.notes.some(function (n) { return /has expired/.test(n.en); }), "LC6: an expired certificate takes the sentence away and warns the owner");
  const claim = (await h.compose(cleanFx("T1", { answers: { staff_status_description: "Contractor's bonded and insured employees" } }))).comp;
  ok(claim.blockers.some(function (b) { return b.code === "cleaning_lc6"; }), "LC6: a typed answer that says insured or bonded with no record on file is refused");
  const bond = (await h.compose(cleanFx("T1", { settings: { trades: ["cleaning"], values: Object.assign({}, insured, { cleaning_insurance_summary: "General liability and a $10,000 bond, Acme Mutual" }) }, selections: { CL13: "CL13-A" } }))).comp;
  ok(bond.blockers.filter(function (b) { return b.code === "cleaning_lc6"; }).length === 1, "LC6: the insurance summary may not mention a bond with no bond record");
  const b3 = (await composeFull(cleanFx("T3", { selections: { CL03: "CL03-C" }, answers: { alarm_gate_instructions: "gate code 4471", access_instructions: "lockbox 9921" } }))).comp;
  const b3b = (await composeFull(cleanFx("T3", { answers: { alarm_gate_instructions: "gate code 4471", access_instructions: "lockbox 9921" } }))).comp;
  ok(!/4471|9921/.test(allText(b3)) && !/4471|9921/.test(allText(b3b)) && /building entry: given to Contractor in writing and kept outside this Agreement\./.test(sec(b3, "CL03-C").text) && /described in the access instructions Customer gives Contractor in writing, which are kept outside this Agreement only to enter/.test(sec(b3b, "CL03-B").text),
    "door, alarm and gate codes are never printed, even when someone types them as an answer");
  const c18 = (await h.compose(cleanFx("T4", { selections: { CL18: "CL18-C" } }))).comp;
  ok(/^\*\*16\. Disputes\.\*\* If a disagreement arises about this Agreement, we will first try to settle it by talking, in writing, within \{negotiation_days\} days after one of us gives written notice of the problem\. If that does not settle it, we will try mediation with a mediator we both agree on, and we will share the mediator's fee equally\. In a case or arbitration/.test(sec(c18, "CL18-C").text) && !/First two sentences/.test(sec(c18, "CL18-C").text),
    "CL18-C is assembled from the first two sentences of CL18-A, not retyped");
  const lab = (await composeFull(cleanFx("T3", { answers: { customer_label: "Owner" } }))).comp;
  ok(/Owner may cancel or move a scheduled turnover/.test((await composeFull(cleanFx("T3", { answers: { customer_label: "Owner" }, selections: { CL08: "CL08-D" } }))).comp.sections.filter(function (s) { return s.id === "CL08-D"; })[0].text) && /tell Customer within/.test(sec((await composeFull(cleanFx("T3", { answers: { customer_label: "Landlord" } }))).comp, "CL16-B").text) && !!lab,
    "T3: the paying party can be called Customer, Owner or Manager, and nothing else");
  const ref = (await h.compose(cleanFx("T3", { selections: { CL16: null, "CL16-B": null } }))).comp;
  ok(ref.blockers.some(function (b) { return b.code === "cleaning_section_ref" && /CL16/.test(b.en); }), "a clause that points to an area taken off the agreement blocks signing");
  const post = (await h.compose(cleanFx("T2", { flags: Object.assign({}, cleanFx("T2").flags, { post_construction: true }) }))).comp, mixed = (await h.compose(cleanFx("T4", { flags: Object.assign({}, cleanFx("T4").flags, { mixed_use: true }) }))).comp;
  ok(post.blockers.some(function (b) { return b.code === "cleaning_manual_review"; }) && mixed.blockers.some(function (b) { return b.code === "cleaning_manual_review"; }) && post.rules.LC7.on === false, "post-construction cleaning and a mixed-use property go to manual review; the construction notices still do not print");
}

// ── E. Florida: none of the construction-only machinery ──────────────────
{
  const BANNED = ["713.", "489.", "558", "515.", "Recovery Fund", "Notice of Commencement", "Final Payment Affidavit", "construction lien", "change order", "Change Order", "punch", "pool", "Pool", "deposit", "Deposit", "license", "License", "Chapter 515", "Owner signs"];
  let hits = [], blocks = [], badIds = [];
  for (const tpl of TPLS) {
    // Every option the template offers, one variant at a time, plus the defaults.
    const base = await composeFull(cleanFx(tpl, { doc: { license_numbers: [] } }));
    const variants = [base.comp];
    const ctx = await h.context(cleanFx(tpl));
    const slots = F.contractCleaningSlots(ctx, { flags: cleanFx(tpl).flags, selections: { CL09: "CL09-B" } }, F.contractCleaningGate(ctx, "2026-10-01"));
    for (const s of slots) { for (const o of s.options) {
      const selx = {}; selx[s.id] = o.id; if (s.id === "CL09-F" || s.id === "CL09-E") { selx.CL09 = "CL09-B"; if (s.id === "CL09-E") { selx["CL09-F"] = "CL09-F:none"; } }
      if (o.id === "CL09-B" || o.id === "CL09-C") { selx["CL09-F"] = "CL09-F:none"; }
      variants.push((await composeFull(cleanFx(tpl, { doc: { license_numbers: [] }, selections: selx, flags: Object.assign({}, cleanFx(tpl).flags, { further_visits: true, term_12_plus: true }) }))).comp);
    } }
    variants.forEach(function (c) {
      const t = allText(c);
      BANNED.forEach(function (b) { if (t.indexOf(b) !== -1 && hits.indexOf(tpl + ":" + b) === -1) { hits.push(tpl + ":" + b); } });
      c.blockers.forEach(function (b) { if (["license", "recovery_fund", "pool_safety_feature", "pool_docs"].indexOf(b.code) !== -1) { blocks.push(tpl + ":" + b.code); } });
      c.sections.forEach(function (s) { if (/^(L\d|C\d\d)/.test(s.id)) { badIds.push(s.id); } });
      if (c.requires.lien_signature || c.requires.pool_ack || c.requires.arbitration_initials || c.requires.jury_initials || c.requires.marketing_checkbox) { blocks.push(tpl + ":requires"); }
      if (c.missing.some(function (m) { return m.field === "property_type" || /license|noc_|recovery|pool/.test(m.field); })) { blocks.push(tpl + ":missing"); }
    });
  }
  ok(hits.length === 0, "Florida, every option of every template: no lien notice, Recovery Fund, Chapter 558, pool, deposit-timing, Notice of Commencement, affidavit, change-order, punch-list or license wording" + (hits.length ? " (" + hits.join(", ") + ")" : ""));
  ok(blocks.length === 0 && badIds.length === 0, "Florida with NO license number on file: no license blocker, no construction blocker, no construction section, no separate lien or pool signature" + (blocks.length ? " (" + blocks.join(", ") + ")" : ""));
  const t1 = (await h.compose(cleanFx("T1"))).comp;
  ok(t1.disclaimer_line === "This contract template has not been reviewed by an attorney. Have your attorney review it." && t1.state.florida === true && t1.checklist === null, "Florida: the unreviewed-by-an-attorney line is the same one every contract carries");
  const reviewedCtxFx = cleanFx("T1");
  const rv = await h.compose(reviewedCtxFx);
  rv.ctx.lib.version.status = "attorney_reviewed"; rv.ctx.lib.version.attorney_name = "A. Lawyer"; rv.ctx.lib.version.attorney_bar_number = "1"; rv.ctx.lib.version.attorney_review_date = "2026-10-02";
  ok(F.contractCompose(rv.ctx, rv.c, "2026-10-01", "live").disclaimer_line === "This contract template has not been reviewed by an attorney. Have your attorney review it.", "a review recorded for the construction library alone does not mark a cleaning agreement as reviewed");
  const cust = (await h.compose(cleanFx("T1", { selections: { CL11: "custom" }, custom_clauses: [{ id: "cc1", area_id: "CL11", status: "pending", text: "We come back the same day." }] }))).comp;
  ok(!!sec(cust, "custom:CL11") && sec(cust, "custom:CL11").text === "We come back the same day." && / This contract contains a custom clause that was not reviewed by an attorney\.$/.test(cust.disclaimer_line), "a custom clause prints in its cleaning area and adds the custom-clause sentence to the disclaimer");
}

// ── F. Outside Florida ───────────────────────────────────────────────────
{
  const BANNED = ["Florida", "Fla.", "713.", "489.", "558", "515.", "501.", "668.50", "2-18", "DR-14", "sales tax", "Notice of Commencement", "Recovery Fund"];
  for (const code of ["MA", "TX"]) {
    let hits = [], stateBlocks = [], printedFl = [];
    for (const tpl of TPLS) {
      const fl = Object.assign({}, cleanFx(tpl).flags, { job_state: code, further_visits: true, term_12_plus: true });
      const variants = [(await composeFull(cleanFx(tpl, { flags: fl, doc: { address: "100 Bay St, Springfield", license_numbers: [] } }))).comp];
      for (const selx of [{ CL07: "CL07-A" }, { CL18: "CL18-B" }, { CL18: "CL18-C" }, { CL09: "CL09-B", "CL09-F": "CL09-F:fee" }, { CL19: "CL19-B" }, { "CL06-P": "CL06-D" }, { "CL06-P": "CL06-H" }, { CL07: "CL07-B" }]) {
        variants.push((await composeFull(cleanFx(tpl, { flags: fl, doc: { address: "100 Bay St, Springfield", license_numbers: [] }, selections: selx, admin: { cleaning_arbitration_rules: "the rules the attorney set", cleaning_arbitration_fee_allocation: "Each side pays half." } }))).comp);
      }
      variants.forEach(function (c) {
        const t = allText(c).replace(c.disclaimer_line, "");
        BANNED.forEach(function (b) { if (t.indexOf(b) !== -1 && hits.indexOf(tpl + ":" + b) === -1) { hits.push(tpl + ":" + b); } });
        c.blockers.forEach(function (b) { if (["license", "recovery_fund", "pool_safety_feature", "pool_docs", "cleaning_surtax", "cleaning_tax_status"].indexOf(b.code) !== -1) { stateBlocks.push(tpl + ":" + b.code); } });
        ["LC1", "LC3-A", "LC4-A", "LC5-A", "LC5-B"].forEach(function (id) { if (sec(c, id)) { printedFl.push(tpl + ":" + id); } });
        if (["LC1", "LC3", "LC4", "LC5-A", "LC5-B"].some(function (k) { return c.rules[k].on !== false || c.rules[k].why.indexOf(c.state.name) === -1; })) { printedFl.push(tpl + ":rule"); }
      });
    }
    ok(hits.length === 0, code + ": no Florida wording in any template" + (hits.length ? " (" + hits.join(", ") + ")" : ""));
    ok(stateBlocks.length === 0, code + ": no blocker from a state rule (no license, surtax or tax-registration blocker)" + (stateBlocks.length ? " (" + stateBlocks.join(", ") + ")" : ""));
    ok(printedFl.length === 0, code + ": LC1, LC3, LC4 and LC5 do not print and say why, naming the state" + (printedFl.length ? " (" + printedFl.join(", ") + ")" : ""));
    const t1 = (await h.compose(cleanFx("T1", { flags: Object.assign({}, cleanFx("T1").flags, { job_state: code }) }))).comp;
    ok(t1.rules.LC2.on === true && !!sec(t1, "LC2-A") && /Notice of Cancellation/.test(t1.notice_form_text || "") && t1.rules.LC6.on === true && t1.requires.cancellation === true, code + ": the federal LC2 statement and form stay, and the LC6 gate stays");
    const name = t1.state.name;
    ok(t1.disclaimer_line.indexOf("Draft rider, not reviewed by a lawyer for " + name + ".") === 0 && t1.state.florida === false, code + ": the disclaimer is the state's draft-rider sentence, as for any contract");
    const keys = t1.checklist.map(function (l) { return l.key; });
    ok(["cancellation", "cancellation_deadline", "cleaning_blocks", "cleaning_auto_renewal", "cleaning_license", "cleaning_home_solicitation", "cleaning_tax", "status", "fixed:1", "fixed:2", "fixed:3"].every(function (k) { return keys.indexOf(k) !== -1; }) &&
      !keys.some(function (k) { return /^(license|written_contract|deposit|defect|pool|notice:|risky:|item:|extra:)/.test(k); }), code + ": the checklist has the cancellation, status and fixed lines plus the cleaning facts, and none of the construction lines");
    const rider = h.riders.riders[code].cleaning;
    const ar = t1.checklist.filter(function (l) { return l.key === "cleaning_auto_renewal"; })[0].en, hs = t1.checklist.filter(function (l) { return l.key === "cleaning_home_solicitation"; })[0].en;
    ok((rider.auto_renewal && rider.auto_renewal.rule ? ar.indexOf(rider.auto_renewal.rule) !== -1 : /none found in the research/.test(ar)) && (rider.home_solicitation_applies_to_cleaning === true ? /reaches cleaning services\.$/.test(hs) : /did not find/.test(hs)),
      code + ": the auto-renewal rule (or \"none found\") and the home-solicitation answer come from the rider's cleaning object");
  }
  const ma = (await composeFull(cleanFx("T1", { flags: Object.assign({}, cleanFx("T1").flags, { job_state: "MA" }), selections: { CL07: "CL07-A" } }))).comp;
  ok(/the courts of Hillsborough County, Massachusetts\./.test(sec(ma, "CL18-A").text) && /\*\*Governing law\.\*\* Massachusetts law governs this Agreement\./.test(sec(ma, "CL19-A").text) && /matched to the invoice\.$/.test(sec(ma, "CL07-A").text),
    "Massachusetts: venue and governing law name the state; the Florida residential sales tax sentence is removed and leaves no gap");
  const edits = F.contractCleaningNeutralById((await h.context(cleanFx("T1"))).lib.cleaning.byId), src = (await h.context(cleanFx("T1"))).lib.cleaning.byId;
  let editsOk = true, changed = [];
  Object.keys(src).forEach(function (id) { if (edits[id].clause_text !== src[id].clause_text) { changed.push(id); } });
  const NE = new Function(workerSrc.slice(workerSrc.indexOf("var CONTRACT_CLEANING_NEUTRAL_EDITS"), workerSrc.indexOf("function contractIsCleaning")) + "\nreturn CONTRACT_CLEANING_NEUTRAL_EDITS;")();
  Object.keys(NE).forEach(function (id) { NE[id].forEach(function (e) { if (!src[id] || src[id].clause_text.indexOf(e.find) === -1) { editsOk = false; } }); });
  ok(editsOk && changed.sort().join() === "CL07-A,CL18-A,CL18-B,CL19-A", "every neutral edit matches text in its library row; four options change outside Florida: " + changed.join(", "));
  const ma4 = (await h.compose(cleanFx("T4", { flags: Object.assign({}, cleanFx("T4").flags, { job_state: "MA" }) }))).comp;
  ok(/is \$180\.00 per visit, for the services/.test(sec(ma4, "CL06-C").text) && /any approved extra, each payment and credit/.test(sec(ma4, "CL07-B").text) && ma4.checklist.filter(function (l) { return l.key === "cleaning_tax"; })[0].level === "warn", "T4 outside Florida: no tax sentence is printed, and the checklist says so as a warning");
}

// ── G. Product guardrails ────────────────────────────────────────────────
{
  async function fee(amount, extra) { return (await h.compose(cleanFx("T1", Object.assign({ answers: { late_cancel_fee: amount } }, extra || {})))).comp; }
  function rails(c) { return c.guardrails.map(function (g) { return g.code + ":" + g.level; }).join(); }
  const at50 = await fee("$90.00"), over50 = await fee("$90.01"), at100 = await fee("180"), over100 = await fee("$180.01");
  ok(rails(at50) === "" && rails(over50) === "fee_over_50:warn" && rails(at100) === "fee_over_50:warn" && rails(over100) === "fee_over_100:refuse", "cancellation fee on a $180.00 visit: $90.00 passes, $90.01 warns, $180.00 warns, $180.01 is refused");
  ok(!over50.blockers.some(function (b) { return /^fee_/.test(b.code); }) && over100.blockers.some(function (b) { return b.code === "fee_over_100"; }), "a warning does not block signing; a refusal does");
  ok(over50.guardrails.concat(over100.guardrails).every(function (g) { return g.en.indexOf("Product guardrail (not law): ") === 0 && g.pt.indexOf("Limite do produto (não é lei): ") === 0; }) && over100.blockers.filter(function (b) { return b.code === "fee_over_100"; })[0].en.indexOf("Product guardrail (not law): ") === 0, "each guardrail is labeled as a product guardrail, not as law, in both languages");
  ok(/Customer will pay a fee of \$180\.00\./.test(sec(at100, "CL08-A").text), "a fee typed as 180 prints as $180.00");
  ok((await fee("about half")).blockers.some(function (b) { return b.code === "cleaning_fee_amount"; }), "a fee that is not one dollar amount is refused");
  const noAccess = (await h.compose(cleanFx("T1", { selections: { CL08: "CL08-C" }, answers: { no_access_fee: "$200.00" } }))).comp;
  ok(rails(noAccess) === "fee_over_100:refuse" && noAccess.notes.some(function (n) { return /CL06-E/.test(n.en); }), "the no-access fee of CL08-C is held to the same guardrail, and CL08-C without CL06-E is pointed out");
  async function tiers(t2, t3) { return (await h.compose(cleanFx("T1", { selections: { CL08: "CL08-B" }, answers: { tier2_percent: t2, tier3_percent: t3 } }))).comp; }
  ok(rails(await tiers("25", "50")) === "" && rails(await tiers("25", "51")) === "fee_over_50:warn" && rails(await tiers("50", "100")) === "fee_over_50:warn" && rails(await tiers("50", "101")) === "fee_over_100:refuse" && rails(await tiers("60", "60")) === "fee_over_50:warn,fee_tiers:refuse",
    "tiered percentages: over 50 warns, over 100 is refused, and the first tier must be lower than the last");
  const t2 = (await h.compose(cleanFx("T2", { answers: { late_cancel_fee: "$181.00" } }))).comp;
  const t4m = (await h.compose(cleanFx("T4", { selections: { "CL06-P": "CL06-H" }, answers: { monthly_price: "$800.00", visits_per_month: "4", late_cancel_fee: "$201.00" } }))).comp;
  const t3g = (await h.compose(cleanFx("T3", { selections: { "CL06-P": "CL06-G" }, answers: { late_cancel_fee: "$60.00" } }))).comp;
  ok(rails(t2) === "fee_over_100:refuse" && rails(t4m) === "fee_over_100:refuse" && rails(t3g) === "fee_unchecked:warn", "the visit price is the one-time price for T2 and the monthly price divided by the visits for CL06-H; with a price table the fee cannot be checked and the owner is warned");
  async function early(feeAmt, remaining) { return (await h.compose(cleanFx("T1", { selections: { CL09: "CL09-C", "CL09-F": "CL09-F:fee" }, answers: Object.assign({ early_termination_fee: feeAmt }, remaining ? { term_remaining_price: remaining } : {}) }))).comp; }
  const e25 = await early("$500.00", "$2,000.00"), e26 = await early("$500.01", "$2,000.00"), eAsk = await early("$500.00", null);
  ok(rails(e25) === "" && rails(e26) === "early_fee_cap:refuse" && eAsk.missing.some(function (m) { return m.field === "term_remaining_price"; }), "early termination fee: 25 percent of the remaining contract price passes, a cent more is refused, and the remaining price is asked");
  ok(/Customer will pay \$500\.00, which Customer agrees is a reasonable estimate/.test(sec(e25, "CL09-C").text) && /No fee applies if Contractor materially breaches this Agreement or if Customer cancels within the three business days described in the cancellation notice\.$/.test(sec(e25, "CL09-C").text) && !sec(e25, "CL09-F"),
    "the fee version of CL09-F prints inside the term clause, with the draft's own exclusion sentence");
  async function interest(r) { return (await h.compose(cleanFx("T1", { selections: { "CL07-L": "CL07-F" }, answers: r === null ? {} : { late_interest_rate: r }, doc: r === null ? { late_fee_annual_pct: null } : {} }))).comp; }
  ok(!(await interest("18")).blockers.some(function (b) { return b.code === "cleaning_interest"; }) && (await interest("18.5")).blockers.some(function (b) { return b.code === "cleaning_interest"; }) && /simple interest at 12 percent per year/.test(sec(await interest(null), "CL07-F").text),
    "late interest: 18 passes, 18.5 is refused, and the draft's default of 12 is used when the document settings have none");
  const cw = (await h.compose(cleanFx("T1", { answers: { claim_window_hours: "36" } }))).comp;
  ok(cw.blockers.some(function (b) { return b.code === "cleaning_claim_window"; }), "the claim window must be 24 or 48 hours");
  const sd = (await h.compose(cleanFx("T2", { answers: { service_date: "10/03/2026" } }))).comp, sdOk = (await h.compose(cleanFx("T2", { answers: { service_date: "10/20/2026" } }))).comp;
  ok(sd.notes.some(function (n) { return n.level === "warn" && /inside the customer's cancellation period \(through 10\/05\/2026/.test(n.en); }) && !sdOk.notes.some(function (n) { return n.level === "warn" && /cancellation period/.test(n.en); }), "a service date inside the three-business-day cancellation period warns the owner (dates as MM/DD/YYYY)");
}

// ── H. Price, estimate and booking pre-fill ──────────────────────────────
{
  const t1 = (await h.compose(cleanFx("T1"))).comp;
  function field(c, k) { return c.fields.filter(function (f) { return f.field === k; })[0] || null; }
  ok(field(t1, "visit_price").value === "$180.00" && field(t1, "visit_price").source === "estimate" && field(t1, "visit_price").editable === true && field(t1, "customer_full_name").value === "Jordan Rivers" && field(t1, "customer_full_name").source === "lead" &&
    field(t1, "service_address").value === "12 Main St, Riverview" && field(t1, "customer_phone").value === "(813) 555-0111" && t1.amount_cents === 18000,
    "the customer, the address and the price come from the lead and the accepted estimate; the per-visit price is a builder answer pre-filled from the estimate");
  ok(["frequency", "service_day", "arrival_window"].every(function (k) { return t1.missing.some(function (m) { return m.field === k; }); }), "frequency, day and arrival window are asked in the builder when nothing has them");
  ok(field(t1, "business_legal_name").editable === false && field(t1, "payment_methods_list").editable === false && field(t1, "contract_date").editable === false, "the company's legal name, payment methods and the contract date are not typed on one contract");
  const booking = { id: "bk1", booked_at: "2026-09-28 15:00:00", answers: F.contractCleaningBookingAnswers(JSON.stringify([{ key: "bedrooms", value: "3" }, { key: "bathrooms", value: "2" }, { key: "sqft", value: "1800" }, { key: "clean_type", value: "deep" }, { key: "frequency", value: "biweekly" }, { key: "pets", value: "no" }])) };
  const bT1 = (await h.compose(cleanFx("T1", { booking: booking }))).comp;
  ok(field(bT1, "frequency").value === "every two weeks" && field(bT1, "frequency").source === "booking" && !bT1.missing.some(function (m) { return m.field === "frequency"; }) && /Service will be every two weeks on/.test(sec(bT1, "CL06-A").text), "booking: the frequency pre-fills and says it came from the online booking");
  const bT2 = (await h.compose(cleanFx("T2", { booking: booking, selections: { CL04: "CL04-B" } }))).comp;
  ok(field(bT2, "clean_type").value === "deep clean" && field(bT2, "clean_type").source === "booking" && field(bT2, "size_description").value === "3 bedrooms, 2 bathrooms, about 1,800 square feet" && field(bT2, "size_description").source === "booking" && field(bT2, "pets_list").value === "none" && field(bT2, "pets_list").source === "booking",
    "booking: type of cleaning, bedrooms, bathrooms, square feet and pets pre-fill the matching answers");
  ok(bT2.cleaning.booking.facts.length === 6 && bT2.cleaning.booking.facts.every(function (x) { return x.en && x.pt && x.value; }) && bT2.cleaning.booking.booked_at === "2026-09-28 15:00:00", "booking: the builder is told each booking answer and which field it filled");
  const over = (await h.compose(cleanFx("T1", { booking: booking, answers: { frequency: "weekly" } }))).comp;
  ok(field(over, "frequency").value === "weekly" && field(over, "frequency").source === "contract" && field(over, "frequency").overridden === true, "booking: what the owner types on the contract wins over the booking answer");
  const none = (await h.compose(cleanFx("T1"))).comp;
  ok(none.cleaning.booking === null, "no booking for the lead: nothing is pre-filled from one");
  ok(JSON.stringify(F.contractCleaningBookingAnswers("not json")) === "{}" && F.contractCleaningBookingPrefill({ answers: { frequency: "once", pets: "yes" } }).fill.frequency === undefined, "an unreadable booking answer or one with no clause wording fills nothing");
  ok(/SELECT id, answers_json, booked_at FROM gm_booking_requests WHERE client_id = \? AND lead_id = \? AND status = 'booked' ORDER BY booked_at DESC/.test(workerSrc) && (workerSrc.match(/gm_booking_requests/g) || []).length === (readFileSync(new URL("worker/index.js", root), "utf8").match(/(INSERT INTO|UPDATE|FROM) gm_booking_requests/g) || []).length + 0,
    "the booking table is only read by the contract code (one SELECT of the latest booked request)");
}

// ── I. Template changes and the stored choice ────────────────────────────
{
  const ctx = await h.context(cleanFx("T1"));
  const gate = F.contractCleaningGate(ctx, "2026-10-01");
  const t1sel = F.contractCleaningDefaults(ctx, { flags: { kind: "cleaning", cleaning_template: "T1" } }, gate);
  const moved = F.contractCleaningFitSelections(ctx, { flags: { kind: "cleaning", cleaning_template: "T3" }, selections: Object.assign({}, t1sel, { CL08: "CL08-B", CL15: "CL15-C" }) }, gate, true);
  ok(moved.CL01 === "CL01-B" && moved.CL08 === "CL08-B" && moved.CL15 === "CL15-C" && moved.CL16 === "CL16-A" && moved.CL02 === "CL02-D" && moved.CL13 === "CL13-C", "changing the template keeps the choices that still fit and re-defaults the rest");
  const junk = F.contractCleaningFitSelections(ctx, { flags: { kind: "cleaning", cleaning_template: "T1" }, selections: Object.assign({}, t1sel, { CL02: "CL02-E", C05: "C05-A", CL99: "x", CL09: "CL09-C" }) }, gate, false);
  ok(junk.CL02 === undefined && junk.C05 === undefined && junk.CL99 === undefined && junk["CL09-F"] === "CL09-F:none", "a save drops an option of another template or of the construction library, and asks the early-termination choice once the term is fixed");
  ok(F.contractIsCleaning({ flags: { kind: "cleaning" } }) === true && F.contractIsCleaning({ flags: {} }) === false && F.contractIsCleaning({ flags: { kind: "construction" } }) === false && F.contractCleaningTemplate({ flags: { cleaning_template: "T9" } }) === "T1", "the kind and the template are read from flags; a contract without a kind is a construction contract");
  ok(/flags = \{ kind: "cleaning", cleaning_template: body\.cleaning_template, sold_in_home: true, job_state: jobState \};/.test(workerSrc) && /code: "kind_required"/.test(workerSrc) && /code: "template_required"/.test(workerSrc), "the create step stores the kind and the template in flags_json and asks for them when they are missing");
  const put = workerSrc.slice(workerSrc.indexOf("async function handlePutGmContract("), workerSrc.indexOf("async function contractStoreSignature("));
  ok(put.indexOf("body.flags.kind !== undefined || body.flags.cleaning_template !== undefined") > put.indexOf("Contrato assinado: para mudar, crie uma revis") && /AND \(company_signed_at IS NULL OR company_signature_voided_at IS NOT NULL\)/.test(put), "the kind and the template change only through the save route, which refuses a company-signed contract");
}

// ── J. Labels and screens ────────────────────────────────────────────────
{
  const g = {};
  new Function("window", readFileSync(new URL("gm-labels.js", root), "utf8"))(g);
  const L = g.GmLabels;
  ok(L.contractTradeLabel("cleaning", "Cleaning", false) === "Limpeza" && L.contractTradeLabel("cleaning", "Cleaning", true) === "Cleaning" && L.contractTradeLabel("pools", "Pools and Spas", false) === "Piscinas e spas", "the sixth trade reads Limpeza / Cleaning");
  const keys = {};
  (readFileSync(OUT_URL, "utf8").match(/\{[a-z0-9_]+\}/g) || []).forEach(function (k) { keys[k.slice(1, -1)] = 1; });
  ["scope_included", "scope_excluded", "term_remaining_price"].forEach(function (k) { keys[k] = 1; });
  const noLabel = Object.keys(keys).filter(function (k) { const f = L.CONTRACT_FIELDS[k]; return !f || !f.pt || !f.en; });
  ok(noLabel.length === 0, "every cleaning placeholder has a builder label in Portuguese and English (" + Object.keys(keys).length + ")" + (noLabel.length ? " missing: " + noLabel.join(" ") : ""));
  const ctx = await h.context(cleanFx("T1"));
  const slotIds = [], optIds = [];
  for (const tpl of TPLS) { F.contractCleaningSlots(ctx, { flags: { kind: "cleaning", cleaning_template: tpl }, selections: { CL09: "CL09-B" } }, F.contractCleaningGate(ctx, "2026-10-01")).forEach(function (s) { if (slotIds.indexOf(s.id) === -1) { slotIds.push(s.id); } s.options.forEach(function (o) { if (optIds.indexOf(o.id) === -1) { optIds.push(o.id); } }); }); }
  ok(slotIds.length === 38 && slotIds.every(function (id) { return L.contractAreaTitle(id, "x", false) !== "x"; }) && optIds.length === 80 && optIds.every(function (id) { return L.contractOptionTitle(id, "x", false) !== "x"; }), "every slot (38) and every option (80) has a Portuguese title");
  const whys = [];
  for (const tpl of TPLS) { for (const fl of [{}, { consumer: false }, { sold_in_home: false }, { further_visits: true }]) { const c = (await h.compose(cleanFx(tpl, { flags: Object.assign({}, cleanFx(tpl).flags, fl), selections: tpl === "T2" ? {} : { CL09: "CL09-B", "CL09-F": "CL09-F:none" } }))).comp; Object.keys(c.rules).forEach(function (k) { if (whys.indexOf(c.rules[k].why) === -1) { whys.push(c.rules[k].why); } }); } }
  const maWhy = (await h.compose(cleanFx("T1", { flags: Object.assign({}, cleanFx("T1").flags, { job_state: "MA" }) }))).comp.rules.LC1.why;
  ok(whys.every(function (w) { return L.contractNoticeWhy(w, false) !== w; }) && L.contractNoticeWhy(maWhy, false) === "o serviço fica em Massachusetts: o aviso da Flórida não é usado" && L.contractNoticeWhy("every contract", false) === "todo contrato", "every reason a cleaning notice is in or out reads in Portuguese (" + whys.length + "); the existing reasons are unchanged");
  ok(readFileSync(new URL("gm-labels.js", root), "utf8") === readFileSync(new URL("ios/App/App/public/gm-labels.js", root), "utf8") && readFileSync(new URL("gm.js", root), "utf8") === readFileSync(new URL("ios/App/App/public/gm.js", root), "utf8"), "the iOS copies of gm-labels.js and gm.js carry the same edits as the root copies");
  const gm = readFileSync(new URL("gm.js", root), "utf8");
  ok(/if \(d && d\.contract_kinds && d\.contract_kinds\.length\) \{ gmConCreateKind = null; gmJobCreateContractKind\(jobId\); return; \}/.test(gm) && /if \(d\.trades\.indexOf\("cleaning"\) !== -1\) \{ h \+= gmConCleaningSettingsHtml\(d\); \}/.test(gm) && /if \(c\.kind === "cleaning"\) \{ q = gmConCleaningQuestionsHtml\(c, ro\); \}/.test(gm) && /if \(st\.job_kind === "cleaning"\) \{/.test(gm),
    "gm.js: the kind step, the cleaning settings, the cleaning questions and the plain no-contract warning each sit behind a cleaning-only condition");
  const view = readFileSync(new URL("contract-view.html", root), "utf8"), tpl = readFileSync(new URL("templates/client-contract-template.html", root), "utf8");
  ok(/function docWord\(\) \{ return \(con && con\.doc_title\) \|\| "Contract"; \}/.test(view) && /function docWord\(\) \{ return \(con && con\.doc_title\) \|\| "Contract"; \}/.test(tpl) && /function partyWord\(\) \{ return \(con && con\.doc_title\) \? "Customer" : "Owner"; \}/.test(tpl) && /doc_title: comp\.kind === "cleaning" \? CONTRACT_CLEANING_DOC_TITLE : undefined/.test(workerSrc) && /var CONTRACT_CLEANING_DOC_TITLE = "Service Agreement";/.test(workerSrc),
    "the customer page and the PDF template title a cleaning agreement \"Service Agreement\" and keep \"Contract\" for every other contract");
  const status = workerSrc.slice(workerSrc.indexOf("async function handleGetGmJobContractStatus("), workerSrc.indexOf("async function handlePostGmJobContractNotice("));
  const cleanMsg = /if \(st\.job_kind === "cleaning"\) \{\s*msg = ([^;]+);/.exec(status);
  ok(!!cleanMsg && !/713|489|\blien\b|Recovery|Florida/.test(cleanMsg[1]) && /without a signed service agreement/.test(cleanMsg[1]), "the no-contract message for a cleaning job quotes no construction law");
}

console.log("");
console.log(failed === 0 ? "✅ ALL PASS (" + passed + ")" : "❌ " + failed + " FAILED, " + passed + " passed");
process.exit(failed === 0 ? 0 : 1);
