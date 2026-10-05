// State riders: the client contract builder for a job in any US state.
// Runs the real contractCompose (cut out of worker/index.js) against the real
// clause library seed and data/contract-state-riders-v1.json. No network, no
// production database, nothing written.
//   node scripts/test-state-riders.mjs
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { parseStateFile, baseStatus, inputExists, INPUT_DIR } from "./official-text-lib.mjs";
import { buildComposer, FLORIDA_FIXTURES, goldenView, GOLDEN_DIR } from "./fixtures/contract-compose-harness.mjs";

const root = new URL("../", import.meta.url);
const h = await buildComposer(readFileSync(new URL("worker/index.js", root), "utf8"));
const data = JSON.parse(readFileSync(new URL("data/contract-state-riders-v1.json", root), "utf8"));
const F = h.fns;

let failed = 0, passed = 0;
function ok(cond, label) { if (cond) { passed++; console.log("PASS  " + label); } else { failed++; console.log("FAIL  " + label); } }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function fx(base, patch) {
  const out = clone(FLORIDA_FIXTURES[base]);
  Object.keys(patch || {}).forEach(function (k) {
    out[k] = (patch[k] && typeof patch[k] === "object" && !Array.isArray(patch[k]) && out[k] && typeof out[k] === "object") ? Object.assign({}, out[k], patch[k]) : patch[k];
  });
  return out;
}
function allText(comp, keepNotices) {
  return comp.sections.filter(function (s) { return keepNotices || s.kind !== "state_notice"; }).map(function (s) { return (s.title || "") + "\n" + (s.text || ""); }).join("\n") + "\n" + (comp.notice_form_text || "") + "\n" + (comp.disclaimer_line || "");
}
const BANNED = ["Florida", "Fla.", "713.", "489.", "558", "515.", "501.", "668.50"];
// Not in the job's list, but each is a Florida-only process or office.
const BANNED_PROCESS = ["Notice of Commencement", "Final Payment Affidavit", "Supreme Court", "715.", "Recovery Fund"];
const STATE_BLOCKERS = ["license", "recovery_fund", "pool_safety_feature", "pool_docs"];
const NON_FL = data.states.map(function (s) { return s.code; }).filter(function (c) { return c !== "FL"; });

// ── A. A Florida contract does not change at all ─────────────────────────
for (const name of Object.keys(FLORIDA_FIXTURES)) {
  const golden = readFileSync(new URL("state-riders-golden-" + name + ".json", GOLDEN_DIR), "utf8");
  const g = JSON.stringify(JSON.parse(golden));
  const none = await h.compose(fx(name, {}));
  ok(JSON.stringify(goldenView(none.comp)) === g, "Florida golden, no job state and no business state: " + name);
  const fl = await h.compose(fx(name, { flags: { job_state: "FL" } }));
  ok(JSON.stringify(goldenView(fl.comp)) === g, "Florida golden, job state FL: " + name);
  const flBiz = await h.compose(fx(name, { flags: { job_state: "FL" }, settings: { values: { business_state: "FL" } } }));
  ok(JSON.stringify(goldenView(flBiz.comp)) === g, "Florida golden, job state FL and business state FL: " + name);
  const unknown = await h.compose(fx(name, { flags: { job_state: "ZZ" } }));
  ok(JSON.stringify(goldenView(unknown.comp)) === g && unknown.comp.state.code === "FL", "an unknown job state (ZZ) falls back to Florida and equals the golden file: " + name);
  ok(none.comp.checklist === null && none.comp.state.florida === true && Object.keys(none.comp.option_warnings).length === 0, "Florida carries no state checklist and no option warnings: " + name);
}
{
  // A contract nobody can edit any more, written before job states existed,
  // stays Florida whatever its address says.
  const frozen = await h.compose(fx("residential-in-home-deposit", { lead: { address: "5 Elm St, Providence RI 02903", city: "" }, contract: { status: "sent", company_signed_at: "2026-09-20 15:00:00" } }));
  ok(frozen.comp.state.code === "FL" && frozen.comp.rules.L1.on === true, "a company-signed contract with no job state stays Florida (address in RI)");
  const draft = await h.compose(fx("residential-in-home-deposit", { lead: { address: "5 Elm St, Providence RI 02903", city: "" } }));
  ok(draft.comp.state.code === "RI" && draft.comp.state.confirmed === false, "a draft with no job state takes the state at the end of the property address (RI), not yet confirmed");
}

// ── D / E. The data file ─────────────────────────────────────────────────
{
  const codes = Object.keys(data.riders);
  ok(codes.length === 51 && data.states.length === 51 && data.states.every(function (s) { return !!data.riders[s.code] && data.riders[s.code].name === s.name; }), "the data file has exactly 51 entries and the exported state list matches them");
  ok(new Set(data.states.map(function (s) { return s.code; })).size === 51 && data.states.every(function (s) { return /^[A-Z]{2}$/.test(s.code) && s.name; }), "51 unique two-letter codes, each with a name");
  ok(data.riders.FL.status === "baseline", "Florida's entry says baseline");
  const count = {};
  NON_FL.forEach(function (c) { count[data.riders[c].status] = (count[data.riders[c].status] || 0) + 1; });
  ok(NON_FL.every(function (c) { return data.statuses.indexOf(data.riders[c].status) !== -1; }) && data.statuses.length === 3, "every non-Florida entry has one of the three allowed statuses");
  ok(NON_FL.every(function (c) { return data.statuses.indexOf(data.riders[c].status) !== -1; }) && (count["needs primary source before use"] || 0) === 2 && data.riders.GA.status === "needs primary source before use" && data.riders.TN.status === "needs primary source before use", "statuses: only the two mirror-built states (GA, TN) need a primary source (got " + JSON.stringify(count) + ")");
  let notices = 0, withText = 0, badSource = [], notExact = [], skipped = !inputExists();
  const parsed = {};
  NON_FL.forEach(function (c) {
    (data.riders[c].notices || []).forEach(function (n) {
      notices++;
      if (n.text !== null || n.text_on_file) { withText += n.text !== null ? 1 : 0; }
      if (n.text !== null && n.source_status !== "VERBATIM-OFFICIAL" && n.source_status !== "VERBATIM-NEAR-OFFICIAL") { badSource.push(n.id); }
      if (n.text_on_file && n.source_status !== "VERBATIM-OFFICIAL" && n.source_status !== "VERBATIM-NEAR-OFFICIAL") { badSource.push(n.id); }
      if (n.text !== null && n.text_on_file) { badSource.push(n.id + " has both text and text_on_file"); }
      if (!("source_status" in n) || !("source_url" in n) || !("source_date" in n)) { badSource.push(n.id + " lacks source fields"); }
      if (n.text !== null && n.hold_reason) { badSource.push(n.id + " prints while on hold"); }
      if (!skipped) {
        parsed[c] = parsed[c] || parseStateFile(c);
        [n.text, n.text_on_file].forEach(function (t) { if (t && !parsed[c].blocks.some(function (b) { return b.text === t; })) { notExact.push(n.id); } });
      }
    });
  });
  ok(notices > 0 && badSource.length === 0, "every notice with text (printed or on file) has source_status VERBATIM-OFFICIAL or VERBATIM-NEAR-OFFICIAL, carries source fields, and nothing prints while on hold" + (badSource.length ? " (" + badSource.join(", ") + ")" : ""));
  if (skipped) { console.log("NOTICE  input folder " + INPUT_DIR + " not found: the byte-exact check against the state files is skipped"); }
  else { ok(notExact.length === 0, "every non-null text is a byte-exact copy of a fenced block in that state's input file (" + notices + " notices, " + withText + " print, " + NON_FL.reduce(function (a, c) { return a + data.riders[c].notices.filter(function (n) { return n.text_on_file; }).length; }, 0) + " stored on file)" + (notExact.length ? " (" + notExact.join(", ") + ")" : "")); }
  ok(data.riders.NJ.notices.length > 0 && data.riders.NJ.notices.every(function (n) { return n.text === null && !n.text_on_file && n.hold_reason; }), "New Jersey: no notice has text, each carries a hold_reason");
  ok(NON_FL.every(function (c) { return (data.riders[c].notices || []).every(function (n) { var k = Object.keys(n.applies || {}); return n.text === null || k.every(function (x) { return ["sold_in_home", "is_pool", "residential", "over_cents", "at_least_cents"].indexOf(x) !== -1; }); }); }), "a notice prints only when its trigger uses keys the builder can decide");
  ok(NON_FL.every(function (c) { return (data.riders[c].notices || []).every(function (n) { return n.id && n.title && n.cite && n.trigger && n.format && n.applies; }); }), "every notice carries id, title, cite, trigger, format and applies");
  ok(codes.every(function (c) { return data.riders[c].reviewed === null; }), "reviewed is null for every state today");
  const noLic = NON_FL.filter(function (c) { return data.riders[c].license.state_level === false; });
  ok(noLic.length === 14 && noLic.every(function (c) { return data.riders[c].license.label === "local or trade license number, if your city or county requires one"; }), "14 states have no state-level license and carry the local-license label (" + noLic.join(" ") + ")");
  ok(data.riders.RI.license.word === "registered" && ["AK", "CT", "IA", "ID", "MA", "NE", "NJ", "PA", "VT", "WA"].every(function (c) { return data.riders[c].license.word === "registered" && !/licen/i.test(data.riders[c].license.line_label); }), "registration states say registered and their line label never says license");
  ok(NON_FL.every(function (c) { const r = data.riders[c]; return typeof r.strictness === "number" && r.written_contract && r.deposit_cap && r.cancellation && r.checklist && r.checklist.rider_items.length === 3 && r.cleaning && Array.isArray(r.risky_options) && "defect_process" in r; }), "every entry carries strictness, written contract, deposit cap, cancellation, checklist, cleaning, risky options and defect process");
  const satOff = ["CT", "DE", "HI", "IA", "ID", "MI", "MN", "MO", "OR", "VT"];
  ok(data.riders.AK.cancellation.business_days === 5 && NON_FL.filter(function (c) { return data.riders[c].cancellation.business_days !== 3; }).join() === "AK" && NON_FL.filter(function (c) { return data.riders[c].cancellation.saturday_counts === false; }).sort().join() === satOff.join() && data.riders.RI.cancellation.saturday_counts === true, "cancellation: Alaska five business days; Saturday does not count in " + satOff.join(" ") + "; every other state counts Saturday (Rhode Island too)");
  // Every neutral clause version is an edit of text that really is in the library row.
  const ctx = await h.context(fx("small-job", {}));
  let editsOk = true, leftovers = [];
  Object.keys(data.outside_florida.clause_edits).forEach(function (id) {
    const o = ctx.lib.optionsById[id];
    if (!o) { editsOk = false; console.log("   no library option " + id); return; }
    data.outside_florida.clause_edits[id].forEach(function (e) { if (String(o.clause_text).indexOf(e.find) === -1) { editsOk = false; console.log("   edit not found in " + id + ": " + e.find.slice(0, 60)); } });
  });
  ok(editsOk, "every neutral clause edit matches text in its library option (" + Object.keys(data.outside_florida.clause_edits).length + " options)");
  const neutral = F.contractNeutralOptions(ctx.lib.optionsById);
  ctx.lib.clause_options.forEach(function (o) {
    const t = F.contractOptionText(neutral[o.id], neutral);
    BANNED.concat(BANNED_PROCESS).forEach(function (b) { if (t.indexOf(b) !== -1) { leftovers.push(o.id + ":" + b); } });
    if (ctx.lib.optionsById[o.id].clause_text !== o.clause_text) { leftovers.push(o.id + ":library row changed"); }
  });
  ok(leftovers.length === 0, "no Apex clause option keeps Florida wording in its neutral version, and no library row is changed" + (leftovers.length ? " (" + leftovers.join(", ") + ")" : ""));
}

// ── B. The default job state ─────────────────────────────────────────────
{
  const noBiz = { values: {} }, riBiz = { values: { business_state: "RI" } };
  ok(F.contractDefaultJobState("12 Main St, Riverview, FL 33579", riBiz) === "FL", "\"12 Main St, Riverview, FL 33579\" gives FL");
  ok(F.contractDefaultJobState("5 Elm St, Providence RI 02903", noBiz) === "RI", "\"5 Elm St, Providence RI 02903\" gives RI");
  ok(F.contractDefaultJobState("5 Elm St, Providence", riBiz) === "RI" && F.contractDefaultJobState("5 Elm St, Providence", { values: { business_state: "MA" } }) === "MA", "\"5 Elm St, Providence\" gives the business state");
  ok(F.contractDefaultJobState("5 Elm St, Providence", noBiz) === "FL" && F.contractDefaultJobState("", noBiz) === "FL" && F.contractDefaultJobState(null, null) === "FL", "no state in the address and no business state gives FL");
  ok(F.contractDefaultJobState("9 Oak Ave, Austin, TX", noBiz) === "TX" && F.contractDefaultJobState("9 Oak Ave, Austin TX 78701-1234", noBiz) === "TX", "two capital letters at the very end, and ZIP+4, are read");
  ok(F.contractDefaultJobState("9 Oak Ave, Springfield, XX 12345", riBiz) === "RI" && F.contractDefaultJobState("9 Oak Ave, Austin, tx 78701", riBiz) === "RI", "only real state codes in capitals are accepted");
  ok(F.contractDefaultJobState("100 Main St NE", noBiz) === "FL" && F.contractDefaultJobState("100 Main St, Omaha, NE", noBiz) === "NE", "a street direction (\"100 Main St NE\") is not read as Nebraska; \", NE\" is");
  ok(F.contractStateCode("ri") === "RI" && F.contractStateCode("DC") === "DC" && F.contractStateCode("PR") === null && F.contractStateCode("") === null && F.contractStateList().length === 51, "contractStateCode accepts the 50 states and DC only");
  const placeholders = await h.compose(fx("small-job", { flags: { job_state: "ma" } }));
  ok(placeholders.comp.vars.job_state === "MA" && placeholders.comp.vars.job_state_name === "Massachusetts", "job_state and job_state_name are placeholder values");
}

// ── F. Named states ──────────────────────────────────────────────────────
const NEUTRAL_DOC = { address: "100 Bay St, Springfield", license_numbers: ["REG-12345"] };
function stateFx(base, code, extra) {
  return fx(base, Object.assign({ flags: Object.assign({}, FLORIDA_FIXTURES[base].flags, { job_state: code }), doc: NEUTRAL_DOC,
    settings: Object.assign({}, FLORIDA_FIXTURES[base].settings || {}, { values: { business_state: code } }) }, extra || {}));
}
function sec(comp, id) { return comp.sections.filter(function (s) { return s.id === id; })[0] || null; }
{
  const ma = (await h.compose(stateFx("residential-in-home-deposit", "MA"))).comp;
  ok(ma.disclaimer_line === "Draft rider, not reviewed by a lawyer for Massachusetts. This contract was prepared with state-specific additions that no lawyer has reviewed. Have your attorney review it.", "Massachusetts: the disclaimer is the draft-rider sentence, without the unverified sentence");
  ok(sec(ma, "L4").text === "Sunrise Pools LLC, Massachusetts HIC Registration No. REG-12345." && !/licensed/i.test(sec(ma, "L4").text), "Massachusetts: the license line names the state and the registration");
  ok(["L1", "L2", "L6", "L7", "L5-C"].every(function (k) { return ma.rules[k].on === false && /Massachusetts/.test(ma.rules[k].why); }) && ma.rules.L3.on === false && /Massachusetts/.test(ma.rules.L3.why), "Massachusetts: L1, L2, L3, L5-C, L6 and L7 read off with a why that names the state");
  ok(ma.rules.L4.on === true && ma.rules.L5.on === true && !!sec(ma, "L5-A") && /NOTICE OF CANCELLATION/.test(ma.notice_form_text || ""), "Massachusetts: the license line and the federal L5-A / L5-B stay");
  ok(!sec(ma, "L1") && !sec(ma, "L2") && !sec(ma, "L7") && !sec(ma, "L5-C") && !sec(ma, "L6"), "Massachusetts: no Florida locked block prints");
  ok(/a Massachusetts limited liability company/.test(sec(ma, "C01-A").text) && /Hillsborough County, Massachusetts \(the "Property"\)/.test(sec(ma, "C01-A").text), "Massachusetts: C01 names the business state and the job state");
  ok(/The laws of the State of Massachusetts govern this Contract\./.test(sec(ma, "C19-A").text) && /Uniform Electronic Transactions Act as adopted in Massachusetts\./.test(sec(ma, "C19-A").text), "Massachusetts: governing law and the electronic signature sentence name the state");
  ok(!/construction defects/i.test(sec(ma, "C11-A").text) && !/\s$/.test(sec(ma, "C11-A").text) && !/  /.test(sec(ma, "C14-A").text.replace(/\n/g, "")), "Massachusetts (no defect process in the matrix): the defect sentence is removed and leaves no gap");
  ok(sec(ma, "C09-A").title === "Permits and inspections" && sec(ma, "C12-A").title === "Completion, punch list, final payment and lien releases", "Massachusetts: the two section titles that named Florida steps are neutral");
  ok(ma.requires.lien_signature === false && ma.requires.pool_ack === false && ma.requires.cancellation === true, "Massachusetts: no separate lien signature, no pool acknowledgment; the cancellation form stays");
  ok(ma.checklist.some(function (l) { return l.en === "Massachusetts requires this notice: \"Do not sign this contract if there are any blank spaces\" line (c. 142A s. 2). The exact wording is not loaded yet. Get it from the official source or your attorney and attach it before the customer signs. When: Residential contracting over $1,000. Format: 10 point bold directly above the owner's signature."; }), "Massachusetts: a required notice with no wording loaded is a checklist line, in the sentence the job gives");
  ok(!ma.sections.some(function (s) { return s.kind === "state_notice"; }), "Massachusetts: no state notice prints while its text is null");

  const ri = (await h.compose(stateFx("residential-in-home-deposit", "RI"))).comp;
  ok(/Registration/.test(sec(ri, "L4").text) && !/licensed/i.test(sec(ri, "L4").text) && sec(ri, "L4").text === "Sunrise Pools LLC, Rhode Island Registration No. REG-12345.", "Rhode Island: the license line says Registration and never licensed");
  ok(ri.checklist.some(function (l) { return /say "registered", never "licensed"/.test(l.en); }), "Rhode Island: the checklist says to write registered, never licensed");

  const tx = (await h.compose(stateFx("residential-in-home-deposit", "TX"))).comp;
  ok(sec(tx, "L4").text === "Sunrise Pools LLC, Texas local or trade license No. REG-12345.", "Texas (no state license): the license line uses the local or trade license label");
  ok(/Any claim for construction defects is subject to the notice and opportunity to repair procedures of Texas Prop\. Code 27\.004 \(RCLA\), where they apply\./.test(sec(tx, "C11-A").text) && /procedures of Texas Prop\. Code 27\.004 \(RCLA\), where they apply\. Nothing in this section/.test(sec(tx, "C14-A").text) && tx.rules.L3.on === true, "Texas (defect process in the matrix): the neutral defect sentence replaces the Chapter 558 one in C11 and C14");
  ok(tx.disclaimer_line === "Draft rider, not reviewed by a lawyer for Texas. This contract was prepared with state-specific additions that no lawyer has reviewed. Have your attorney review it.", "Texas (notice text still needs official copy; not a mirror state): the draft sentence only, no unverified sentence");

  const ga = (await h.compose(stateFx("small-job", "GA"))).comp;
  ok(data.riders.GA.status === "needs primary source before use" && / State-specific rules for Georgia could not be verified from official sources\. Confirm licensing and notices before signing\.$/.test(ga.disclaimer_line), "Georgia (needs primary source before use): the second disclaimer sentence is present");

  // A Florida business working in Georgia keeps its own state name in C01.
  const flInGa = (await h.compose(fx("residential-in-home-deposit", { flags: { job_state: "GA" }, settings: { values: { business_entity_type: "LLC" } } }))).comp;
  ok(/, a Florida LLC, /.test(sec(flInGa, "C01-A").text) && /County, Georgia \(the "Property"\)/.test(sec(flInGa, "C01-A").text) && flInGa.state.business_state === "FL", "a Florida business working in Georgia: \"a Florida LLC\" survives and the property is in Georgia");
  ok(allText(flInGa).split("a Florida LLC").join("").indexOf("Florida") === -1, "...and that is the only place the word Florida appears");

  // An empty license number is never a blocker outside Florida.
  const noLic = (await h.compose(stateFx("residential-in-home-deposit", "MA", { doc: { address: "100 Bay St, Springfield", license_numbers: [] } }))).comp;
  ok(noLic.blockers.length === 0 && sec(noLic, "L4").text === "Sunrise Pools LLC. Massachusetts license or registration number: not provided." && noLic.checklist.some(function (l) { return l.key === "license_number" && l.level === "warn"; }), "outside Florida a missing license number is not a blocker: the line prints \"not provided\" and the checklist warns");
  const noLicFl = (await h.compose(fx("residential-in-home-deposit", { doc: { license_numbers: [] } }))).comp;
  ok(noLicFl.blockers.some(function (b) { return b.code === "license"; }), "in Florida the missing-license blocker stays");

  // The qualifier prints only when someone typed one.
  const qual = (await h.compose(stateFx("small-job", "MA", { settings: { values: { business_state: "MA", qualifier_name: "Dana Qualifier" } } }))).comp;
  ok(sec(qual, "L4").text === "Sunrise Pools LLC, Massachusetts HIC Registration No. REG-12345. Qualifying agent: Dana Qualifier.", "outside Florida the qualifier part prints only when a qualifier name was typed");
}

// ── F / E. All 50 states and DC: nothing blocks, nothing says Florida ────
{
  const ctx0 = await h.context(fx("small-job", {}));
  const perArea = {};
  ctx0.lib.clause_areas.forEach(function (a) { perArea[a.id] = ctx0.lib.optionsForClient.filter(function (o) { return o.area_id === a.id; }).map(function (o) { return o.id; }); });
  const variants = [0, 1, 2, 3].map(function (k) { const sel = {}; Object.keys(perArea).forEach(function (a) { if (perArea[a].length) { sel[a] = perArea[a][k % perArea[a].length]; } }); return sel; });
  const seen = {};
  variants.forEach(function (v) { Object.keys(v).forEach(function (a) { seen[v[a]] = true; }); });
  ok(ctx0.lib.optionsForClient.every(function (o) { return seen[o.id]; }), "the four selection variants cover every clause option in the library (" + Object.keys(seen).length + ")");
  const bases = Object.keys(FLORIDA_FIXTURES);
  let composed = 0;
  const bad = [];
  for (const code of NON_FL) {
    for (const base of bases) {
      for (let k = 0; k < variants.length; k++) {
        for (const lic of [["REG-12345"], []]) {
          let r;
          try { r = (await h.compose(stateFx(base, code, { selections: variants[k], doc: { address: "100 Bay St, Springfield", license_numbers: lic }, admin: { recovery_fund_contact_block: "", ch515_doc_r2_key: null, drowning_pub_r2_key: null } }))).comp; }
          catch (e) { bad.push(code + "/" + base + "/" + k + ": threw " + e.message); continue; }
          composed++;
          if (r.state.code !== code) { bad.push(code + "/" + base + ": composed as " + r.state.code); }
          r.blockers.forEach(function (b) { bad.push(code + "/" + base + "/" + k + ": blocker " + b.code); });
          if (r.missing.some(function (m) { return m.field === "property_type" || m.field === "license_type" || m.field === "pool_safety_feature"; })) { bad.push(code + "/" + base + ": a Florida-only field is asked"); }
          const text = allText(r);
          BANNED.concat(BANNED_PROCESS).forEach(function (b) { if (text.indexOf(b) !== -1) { bad.push(code + "/" + base + "/" + k + ": text contains " + b); } });
          if (r.sections.some(function (s) { return ["L1", "L2", "L5-C", "L6", "L6-barrier", "L7"].indexOf(s.id) !== -1; })) { bad.push(code + "/" + base + ": a Florida locked block printed"); }
          if (!Array.isArray(r.checklist) || r.checklist.filter(function (l) { return /^fixed:/.test(l.key); }).length !== 3) { bad.push(code + ": checklist without the three fixed lines"); }
          if (r.checklist.some(function (l) { return !l.en || !l.pt; })) { bad.push(code + ": a checklist line without both languages"); }
          if (r.disclaimer_line.indexOf("Draft rider, not reviewed by a lawyer for " + data.riders[code].name + ".") !== 0) { bad.push(code + ": disclaimer"); }
          if ((data.riders[code].status === "needs primary source before use") !== /could not be verified from official sources/.test(r.disclaimer_line)) { bad.push(code + ": unverified sentence"); }
          if (/\{(job_state|job_state_name|job_state_jurisdiction|business_state_name|license_label|defect_notice_sentence|defect_statute_cite)\}/.test(text)) { bad.push(code + ": an unfilled state placeholder"); }
        }
      }
    }
  }
  if (bad.length) { console.log("   " + bad.slice(0, 25).join("\n   ")); }
  ok(composed === NON_FL.length * bases.length * variants.length * 2 && NON_FL.length === 50, "compose succeeds for all 50 non-Florida codes (" + composed + " contracts: " + bases.length + " fixtures x 4 clause variants x with and without a license number)");
  {
    // The state notices that print carry their own state's wording: Florida's must not appear in them.
    const nb = [];
    for (const code of NON_FL) {
      const r = (await h.compose(stateFx("residential-in-home-deposit", code))).comp;
      r.sections.filter(function (x) { return x.kind === "state_notice"; }).forEach(function (x) { ["Florida", "Fla.", "713.", "489.", "558", "515.", "501.", "668.50"].forEach(function (b) { if ((x.title + "\n" + x.text).indexOf(b) !== -1) { nb.push(code + ":" + x.id + ":" + b); } }); });
    }
    ok(nb.length === 0, "the notices that print contain no Florida wording" + (nb.length ? " (" + nb.join(", ") + ")" : ""));
  }
  ok(bad.length === 0, "for every one of them: no blocker at all (no state rule can block), no Florida locked block, the checklist and disclaimer are right, and the composed text contains none of " + BANNED.concat(BANNED_PROCESS).join(", "));
}

// ── Read-through files: what a customer would see for five states ─────────
{
  const picks = ["OR", "VA", "TX", "MA", "OH"], made = [];
  for (const code of picks) {
    const r = (await h.compose(stateFx("residential-in-home-deposit", code))).comp;
    let out = "State notices a customer would see: " + data.riders[code].name + " (" + code + "), residential job, $12,500.00, sold at the customer's home.\nStatus: " + data.riders[code].status + "\n\n";
    const printed = r.sections.filter(function (x) { return x.kind === "state_notice"; });
    out += "== PRINTED IN THE CONTRACT (" + printed.length + ") ==\n\n";
    printed.forEach(function (x) { out += "--- " + x.title + (x.cite ? " (" + x.cite + ")" : "") + " ---\n" + x.text + "\n\n"; });
    if (!printed.length) { out += "(no state notice prints for this state yet)\n\n"; }
    out += "== OWNER CHECKLIST LINES ABOUT NOTICES (not printed in the contract) ==\n\n";
    r.checklist.filter(function (l) { return /^notice:/.test(l.key); }).forEach(function (l) { out += "- [" + l.level + "] " + l.en + "\n"; });
    const path = "scripts/fixtures/state-notices-" + code.toLowerCase() + ".txt";
    writeFileSync(new URL(path, root), out);
    made.push(path);
  }
  ok(made.length === 5 && made.every(function (m) { return readFileSync(new URL(m, root), "utf8").length > 200; }), "read-through files written for five states: " + made.join(", "));
}

// ── F5. Cancellation deadline ────────────────────────────────────────────
{
  // Signed Thursday 10/01/2026. Federal: Fri, Sat, Mon. Columbus Day is 10/12.
  ok(F.contractCancellationDeadline("2026-10-01") === "2026-10-05" && F.contractCancellationDeadline("2026-10-01", null) === "2026-10-05", "federal count (Florida and the default): signed Thu 10/01/2026, deadline Mon 10/05/2026");
  const ak = (await h.compose(stateFx("residential-in-home-deposit", "AK"))).comp, ia = (await h.compose(stateFx("residential-in-home-deposit", "IA"))).comp, tx = (await h.compose(stateFx("residential-in-home-deposit", "TX"))).comp;
  ok(F.contractCancellationDeadline("2026-10-01", ak.state.cancellation) === "2026-10-07", "Alaska: five business days, signed Thu 10/01/2026, deadline Wed 10/07/2026");
  ok(F.contractCancellationDeadline("2026-10-01", ia.state.cancellation) === "2026-10-06", "Iowa: Saturday is not counted, signed Thu 10/01/2026, deadline Tue 10/06/2026");
  ok(F.contractCancellationDeadline("2026-10-01", tx.state.cancellation) === "2026-10-05", "Texas: the federal count");
  ok(F.contractCancellationDeadline("2026-10-08", ak.state.cancellation) === "2026-10-15" && F.contractCancellationDeadline("2026-10-08", ia.state.cancellation) === "2026-10-14", "a federal holiday (Mon 10/12/2026) is skipped in both");
  const l5b = FLORIDA_FIXTURES["residential-in-home-deposit"];
  const flForm = (await h.compose(fx("residential-in-home-deposit", {}))).comp.notice_form_text;
  ok(ak.notice_form_text.replace("THE FIFTH BUSINESS DAY AFTER YOU SIGN", "THE THIRD BUSINESS DAY AFTER YOU SIGN").replace("100 Bay St, Springfield", "100 Bay St, Tampa, FL 33602") === flForm && !!l5b, "Alaska: the federal form text is not edited; only the deadline words differ");
  ok(/the cancellation period has ended on the fifth business day after Owner signs/.test(sec(ak, "C06-A").text) && /the three-business-day cancellation period has ended on the third business day after Owner signs/.test(sec(ia, "C06-A").text), "the start condition in C06 follows the state's day count");
}

// ── F4. The reviewed branch (no UI; data only) ───────────────────────────
{
  h.riders.riders.MA.reviewed = { attorney_name: "Test Attorney", bar_number: "000000", date: "2026-11-03" };
  const rev = (await h.compose(stateFx("small-job", "MA"))).comp;
  h.riders.riders.MA.reviewed = null;
  ok(rev.disclaimer_line === "Reviewed by Test Attorney for Massachusetts on 11/03/2026.", "a filled reviewed object changes the disclaimer to \"Reviewed by {name} for {state} on {date}\" (date MM/DD/YYYY)");
  const back = (await h.compose(stateFx("small-job", "MA"))).comp;
  ok(/^Draft rider, not reviewed by a lawyer for Massachusetts\./.test(back.disclaimer_line), "...and only for that state, only while it is filled");
}

// ── E. Loading a notice's wording is a JSON edit only ────────────────────
{
  const n = h.riders.riders.MA.notices.filter(function (x) { return x.id === "MA-blank-spaces"; })[0];
  n.text = "EXACT OFFICIAL WORDING PLACEHOLDER FOR THIS TEST";
  const withText = (await h.compose(stateFx("residential-in-home-deposit", "MA"))).comp;
  const small = (await h.compose(stateFx("small-job", "MA", { amount_cents: 90000 }))).comp;
  n.text = null;
  const printed = withText.sections.filter(function (s) { return s.kind === "state_notice"; });
  ok(printed.length === 1 && printed[0].id === "MA-blank-spaces" && printed[0].text === "EXACT OFFICIAL WORDING PLACEHOLDER FOR THIS TEST" && withText.checklist.some(function (l) { return l.key === "notice:MA-blank-spaces" && /^This notice prints in the contract/.test(l.en); }), "a notice whose text is filled in the JSON prints in the contract, word for word, with no code change");
  ok(!small.sections.some(function (s) { return s.kind === "state_notice"; }) && !small.checklist.some(function (l) { return l.key === "notice:MA-blank-spaces"; }), "...and only when its trigger applies (not on a $900.00 job, under the $1,000 trigger)");
}

// ── F6 / G. Risky options, checklist, thresholds ─────────────────────────
{
  const nc = (await h.compose(stateFx("residential-in-home-deposit", "NC", { selections: { C14: "C14-C" } }))).comp;
  ok(nc.option_warnings["C14-C"] && nc.option_warnings["C14-C"].level === "risk" && nc.option_warnings["C14-C"].safer === "C14-A" && nc.option_warnings["C14-C"].en && nc.option_warnings["C14-C"].pt, "North Carolina: the jury-waiver package C14-C carries a warning and names the safer option");
  ok(nc.blockers.length === 0 && !!sec(nc, "C14-C") && nc.checklist.some(function (l) { return l.key === "risky:C14-C" && l.level === "warn"; }), "...the owner can still pick it: it composes, nothing is blocked, and the checklist says it is chosen");
  ok(["NC", "PA", "VT", "LA"].every(function (c) { return data.riders[c].risky_options.some(function (r) { return r.option === "C14-C" && r.level === "risk" && r.safer === "C14-A"; }); }), "NC, PA, VT and LA all flag C14-C with C14-A as the safer option");
  const ca = (await h.compose(stateFx("residential-in-home-deposit", "CA"))).comp;
  ok(ca.checklist.some(function (l) { return l.key === "deposit_over" && l.level === "warn" && l.en === "The first payment on this contract ($3,750.00) is over that cap ($1,000.00)."; }), "California: a 30 percent first payment on $12,500.00 warns against the cap (lesser of $1,000 or 10 percent)");
  const me = (await h.compose(stateFx("residential-in-home-deposit", "ME"))).comp;
  ok(!me.checklist.some(function (l) { return l.key === "deposit_over"; }), "Maine: a 30 percent first payment is under the one-third cap, no warning");
  const ma = (await h.compose(stateFx("residential-in-home-deposit", "MA"))).comp;
  ok(!ma.checklist.some(function (l) { return l.key === "deposit_over"; }) && ma.checklist.some(function (l) { return l.key === "deposit" && /Greater of one-third/.test(l.en); }), "Massachusetts: the cap is not one clean number, so it is shown as text with no warning line");
  ok(ma.checklist.some(function (l) { return l.key === "written_contract" && /This contract \(\$12,500\.00\) crosses that amount\./.test(l.en); }), "the checklist says whether this contract's amount crosses the written-contract threshold");
  ok(ma.checklist.every(function (l) { return l.level === "info" || l.level === "warn"; }) && ma.blockers.length === 0, "the checklist is information only: never a blocker");
  const maR = data.riders.MA, txR = data.riders.TX, ohR = data.riders.OH;
  ok(F.contractStateWrittenThreshold(maR, 100000).crosses === false && F.contractStateWrittenThreshold(maR, 100001).crosses === true && F.contractStateWrittenThreshold(maR, 1).clean === true, "no-contract warning: Massachusetts uses its own amount (over $1,000.00)");
  ok(F.contractStateWrittenThreshold(ohR, 2499999).crosses === false && F.contractStateWrittenThreshold(ohR, 2500000).crosses === true, "no-contract warning: Ohio at $25,000.00 or more");
  ok(F.contractStateWrittenThreshold(txR, 1).clean === false && F.contractStateWrittenThreshold(txR, 1).crosses === true, "no-contract warning: no clean number (Texas) warns at any amount");
  ok(F.contractStateDisclaimerFor("FL") === null && F.contractStateDisclaimerFor(null) === null && /^Draft rider, not reviewed by a lawyer for Ohio\./.test(F.contractStateDisclaimerFor("OH")), "change orders: the state label for a contract outside Florida, the existing line otherwise");
}

// ── B / G. The builder sheet (gm.js gmRenderContractSheet, run with stubs) ─
// Not a browser: the real function is cut out of gm.js and run against a
// payload shaped like the Worker's, to prove it renders and what it prints.
{
  const gm = readFileSync(new URL("gm.js", root), "utf8"), ios = readFileSync(new URL("ios/App/App/public/gm.js", root), "utf8");
  const labelsSrc = readFileSync(new URL("gm-labels.js", root), "utf8");
  const labelHost = {};
  new Function("window", "global", labelsSrc + "\n;return 0;").call(labelHost, labelHost, labelHost);
  const GmLabels = labelHost.GmLabels;
  function cut(src, name) { const i = src.indexOf("\nfunction " + name + "("); const j = src.indexOf("\n}", i + 1); return src.slice(i + 1, j + 2); }
  function renderer(src, en) {
    let out = null;
    const stubs = {
      gmConDetail: null, gmConEditable: function (c) { return c.status === "draft"; }, gmT: function (pt, e) { return en ? e : pt; }, isEn: function () { return en; },
      escHtml: function (x) { return String(x === null || x === undefined ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
      gmMoney: function (c) { return "$" + (c / 100).toFixed(2); }, gmSignedMoney: function (c) { return String(c); },
      gmSheetSection: function (t, b, n) { return "<section><h>" + t + "</h>" + b + (n || "") + "</section>"; }, gmSheetRowHtml: function (i, l, v, a, b, sub) { return "<row>" + l + "|" + v + "|" + (sub || "") + "</row>"; },
      gmConPill: function (x) { return x; }, gmOpenDocLink: function () {}, gmPdfHref: function (x) { return x; }, gmLinkControlBtn: function () { return ""; }, gmIsSeller: function () { return false; },
      gmConProblemsHtml: function (b) { return "<problems>" + b.length + "</problems>"; }, formatDateTimeUTC: String, formatDate: String,
      GM_CON_PROPERTY_TYPES: [["single_family", "Casa unifamiliar", "Single-family home"]], gmConFieldType: function () { return "text"; }, gmConFieldLabel: function (k) { return k; }, gmConUsToIso: String,
      gmConSourceLabel: function () { return "src"; }, GM_CON_TO_LEAD: {}, GM_CON_CUSTOM_STATUS: {}, gmConAreaTitle: function (a) { return a.title; }, gmConOptTitle: function (o) { return o.title; }, gmConOptDesc: function (o) { return o.owner_description || ""; },
      gmConCustomHtml: function () { return ""; }, gmSheetOpen: function (t, b) { out = b; }, document: { getElementById: function () { return null; } }, gmDocMsgAttach: function () {}, window: { GmLabels: GmLabels }, GmLabels: GmLabels, gmCOWizardOpen: function () {}
    };
    const names = Object.keys(stubs);
    const fn = new Function(...names, cut(src, "gmRenderContractSheet") + "\nreturn function(c) { gmConDetail = c; gmRenderContractSheet(); };")(...names.map(function (k) { return stubs[k]; }));
    return function (c) { out = null; fn(clone(c)); return out; };
  }
  async function detail(fxIn, status) {
    const r = await h.compose(fxIn), comp = r.comp, ctx = r.ctx;
    const areaOptions = {};
    ctx.lib.optionsForClient.forEach(function (o) { (areaOptions[o.area_id] = areaOptions[o.area_id] || []).push({ id: o.id, title: o.title, owner_description: o.owner_description }); });
    const neutral = F.contractNeutralOptions(ctx.lib.optionsById);
    return { id: "con-1", status: status || "draft", display_number: "CON-0007", job_name: "Rivers", selections: r.c.selections, answers: {}, flags: r.c.flags,
      areas: ctx.lib.clause_areas.map(function (a) { return { id: a.id, title: a.title, options: areaOptions[a.id] || [] }; }),
      missing: comp.missing, blockers: comp.blockers, rules: comp.rules, amount_cents: comp.amount_cents, disclaimer_line: comp.disclaimer_line, fields: comp.fields, builds_pools: ctx.settings.builds_pools, safety_features: ["(a) x"],
      preview_link: "p", pdf_link: "q", custom_clauses: [], estimate_price_cents: comp.amount_cents, can_sign_as_company: true,
      job_state: comp.state.code, job_state_name: comp.state.name, job_state_confirmed: comp.state.confirmed, job_state_florida: comp.state.florida, cancellation_rule: comp.state.cancellation, states: F.contractStateList(),
      state_checklist: comp.checklist, option_warnings: comp.option_warnings,
      state_neutral_options: comp.state.florida ? [] : ctx.lib.optionsForClient.filter(function (o) { return F.contractOptionText(neutral[o.id], neutral) !== F.contractOptionText(o, ctx.lib.optionsById); }).map(function (o) { return o.id; }) };
  }
  ok(cut(gm, "gmRenderContractSheet") === cut(ios, "gmRenderContractSheet") && cut(gm, "gmContractGuard") === cut(ios, "gmContractGuard") && cut(gm, "gmConSettingsHtml") === cut(ios, "gmConSettingsHtml"), "gm.js and its iOS copy carry the same builder sheet, settings card and no-contract warning");
  const nc = await detail(stateFx("pool-job", "NC", { selections: { C14: "C14-C" } }));
  const en = renderer(gm, true)(nc), pt = renderer(gm, false)(nc);
  ok(/for="gmConJobState">State where the work is done \*<\/label>/.test(en) && /<option value="NC" selected>North Carolina<\/option>/.test(en) && (en.match(/<option value="[A-Z]{2}"/g) || []).length === 51 && /gmConSetFlag\('job_state', this\.value\)/.test(en), "builder sheet: a required-looking state select with 51 states, the job state selected, saved through the flag mechanism");
  ok(en.indexOf("gmConJobState") < en.indexOf("gmConPropType") && en.indexOf("gmConJobState") !== -1, "builder sheet: the state select sits just before the property type question");
  ok(/Notices inserted by rule: North Carolina/.test(en) && !/Florida notices inserted by rule/.test(en) && /Avisos inseridos por regra: North Carolina/.test(pt), "builder sheet: the locked-blocks title names the job state in both languages");
  ok(/L1 · Florida construction lien notice\|[^|]*out[^|]*\|job is in North Carolina: Florida notice not used/.test(en) && /L5-C · Florida home solicitation statement/.test(en) && /a obra fica em North Carolina: o aviso da Flórida não é usado/.test(pt), "builder sheet: a Florida block reads off with a reason that names the state, in both languages");
  ok(/<p class="gm-sheet-section-title">Before you send: North Carolina/.test(en) && /<p class="gm-sheet-section-title">Antes de enviar: North Carolina/.test(pt) && /Leave no blank spaces in the contract\./.test(en) && /Não deixe espaços em branco no contrato\./.test(pt), "builder sheet: the \"Before you send\" checklist card shows in both languages");
  ok(!/type="checkbox"[^>]*gmConStateChecklist/.test(en) && !/<input[^>]*>[^<]*Leave no blank/.test(en), "builder sheet: the checklist has no tick box");
  ok(/caution in this state/.test(en) && /North Carolina: Jury waiver is unconscionable as a matter of law/.test(en), "builder sheet: a flagged clause option is marked in the list and warned about under the select");
  ok(!/515/.test(en) && !/gmConSafety/.test(en) && /Pool job<\/label>/.test(en), "builder sheet: outside Florida the pool question carries no Chapter 515 wording and no safety-feature select");
  ok(/Rascunho de adendo estadual, não revisado por advogado para North Carolina\./.test(pt) && /Draft rider, not reviewed by a lawyer for North Carolina\./.test(en), "builder sheet: the disclaimer is the state's, in Portuguese on the Portuguese screen");
  const roSheet = renderer(gm, true)(await detail(stateFx("pool-job", "NC"), "sent"));
  ok(/State where the work is done\|North Carolina/.test(roSheet) && !/gmConJobState/.test(roSheet), "builder sheet: a contract that can no longer change shows the state as a value, not a select");
  const fl = renderer(gm, true)(await detail(fx("pool-job", { flags: { job_state: "FL" } })));
  ok(/Florida notices inserted by rule/.test(fl) && !/Before you send/.test(fl) && /Pool job \(attaches the two Chapter 515 documents\)/.test(fl) && /<option value="FL" selected>Florida<\/option>/.test(fl) && !/L5-C ·/.test(fl), "builder sheet: a Florida contract keeps its title, its pool wording and has no checklist card");
  ok(GmLabels.contractDisclaimer("This contract template has not been reviewed by an attorney. Have your attorney review it.", false) === "Este modelo de contrato não foi revisado por um advogado. Peça ao seu advogado para revisar." && GmLabels.contractNoticeWhy("every contract", false) === "todo contrato", "gm-labels.js: the Florida disclaimer and reasons translate exactly as before");
}

console.log("");
console.log(failed ? "❌ " + failed + " FAILED (" + passed + " passed)" : "✅ ALL PASS (" + passed + ")");
if (failed) { process.exitCode = 1; }
