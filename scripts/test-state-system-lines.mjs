// "The system does what it can and ticks its own lines" (RES-35).
// Runs the real Worker functions (cut out of worker/index.js) and the real
// gm.js card against data/contract-state-riders-v1.json and
// data/contract-state-checklist-v1.json. No network, no production database.
//   node scripts/test-state-system-lines.mjs
// It checks, for Texas and seven other states of different shapes:
//   - every action line is one of three kinds (does / sees / person);
//   - a system line ticks itself and cannot be ticked or unticked by hand;
//   - the one-question facts, including "Not sure" and no answer;
//   - a printed notice is byte-identical to the official-text file;
//   - the second customer signer ticks its line;
//   - a waiting or unticked line never stops a send, a signature or a preview;
//   - Florida's golden files are unchanged.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { buildComposer, FLORIDA_FIXTURES, goldenView, GOLDEN_DIR } from "./fixtures/contract-compose-harness.mjs";
import { fnSrc, varSrc } from "./fixtures/d1-shim.mjs";
import { parseStateFile, inputExists, INPUT_DIR, cutRange } from "./official-text-lib.mjs";
import { summaryText, reviewText } from "./make-state-checklist-review.mjs";

const root = new URL("../", import.meta.url);
const workerSrc = readFileSync(new URL("worker/index.js", root), "utf8");
const gm = readFileSync(new URL("gm.js", root), "utf8");
const ios = readFileSync(new URL("ios/App/App/public/gm.js", root), "utf8");
const view = readFileSync(new URL("contract-view.html", root), "utf8");
const tpl = readFileSync(new URL("templates/client-contract-template.html", root), "utf8");
const h = await buildComposer(workerSrc);
const riders = JSON.parse(readFileSync(new URL("data/contract-state-riders-v1.json", root), "utf8"));
const sorting = JSON.parse(readFileSync(new URL("data/contract-state-checklist-v1.json", root), "utf8"));
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
// A residential job sold at the home in a named state, with these fact answers.
function stateFx(code, facts, patch) { return fx("residential-in-home-deposit", Object.assign({ flags: { job_state: code, state_facts: facts || {} } }, patch || {})); }
function cut(src, name) { const i = src.indexOf("\nfunction " + name + "("); if (i < 0) { throw new Error("not found: " + name); } const j = src.indexOf("\n}", i + 1); return src.slice(i + 1, j + 2); }
async function run(code, facts, patch, sys) {
  const r = await h.compose(stateFx(code, facts, patch));
  return { r: r, card: F.contractStateActionCard(r.comp.state, r.comp.checklist, r.c.flags, sys || null) };
}
function line(card, key) { return card.actions.filter(function (a) { return a.key === key; })[0] || null; }
function sec(r, id) { return r.comp.sections.filter(function (s) { return s.id === id; })[0] || null; }
const KINDS = ["does", "sees", "person"];
const NON_FL = riders.states.map(function (s) { return s.code; }).filter(function (c) { return c !== "FL"; });
const noticeOf = function (id) { return riders.riders[id.slice(0, 2)].notices.filter(function (n) { return n.id === id; })[0]; };
// What the builder reads about a contract that was sent, signed by both, and
// whose photo acknowledgment is signed (times are UTC, as D1 stores them).
const SIGNED = { status: "completed", company_signed_at: "2026-10-05 19:00:00", sent_at: "2026-10-05 19:30:00", first_viewed_at: "2026-10-05 19:45:00", homeowner_signed_at: "2026-10-05 20:12:00" };

// ── 1. Texas: each kind of line, on a new contract and on a signed one ────
{
  const fresh = await run("TX", {});
  ok(fresh.card.actions.every(function (a) { return KINDS.indexOf(a.kind) !== -1; }) && KINDS.every(function (k) { return fresh.card.actions.some(function (a) { return a.kind === k; }); }),
    "Texas: every action line is one of does / sees / person, and all three kinds are on the card");
  const hs = line(fresh.card, "notice:TX-homestead"), df = line(fresh.card, "notice:TX-defect"), ds = line(fresh.card, "notice:TX-disclosure");
  ok(hs.kind === "does" && hs.sys.done === true && hs.done && hs.done.system === true && /^Printed in the contract under "IMPORTANT NOTICE \(homestead\)"\.$/.test(hs.sys.en) && /^Impresso no contrato em /.test(hs.sys.pt) && hs.en === "Homestead IMPORTANT NOTICE printed in the contract (10 point bold)",
    "Texas: the homestead IMPORTANT NOTICE is done by the system the moment the contract exists, with one line of evidence in both languages");
  ok(df.kind === "does" && df.sys.done === true && ds.kind === "does" && ds.sys.done === false && /^The system will do this when you send the contract/.test(ds.sys.en) && /^O sistema faz isto quando você enviar o contrato/.test(ds.sys.pt) && ds.done === null,
    "Texas: the Chapter 27 notice is done; the disclosure statement says \"The system will do this when you send the contract\" and is not a job for the person");
  const ph = line(fresh.card, "fixed:1"), cp = line(fresh.card, "fixed:2");
  ok(ph.kind === "sees" && ph.sys.done === false && /^Waiting: /.test(ph.sys.en) && /^Aguardando: /.test(ph.sys.pt) && cp.kind === "does" && cp.sys.done === false && /^The system will do this when everyone has signed/.test(cp.sys.en),
    "Texas: the photo acknowledgment shows \"Waiting: ...\" and the signed copy \"The system will do this when everyone has signed\"");
  ok(line(fresh.card, "cancellation_oral").kind === "person" && line(fresh.card, "license_local").kind === "person" && !line(fresh.card, "cancellation_oral").sys,
    "Texas: telling the customer out loud and checking the city license stay person-only lines");
  ok(fresh.card.done_count === fresh.card.actions.filter(function (a) { return a.sys && a.sys.done; }).length && fresh.card.done_count === 2 && fresh.card.total === fresh.card.actions.length,
    "Texas: the count includes the system's lines (2 of " + fresh.card.total + " done on a new contract, before any hand tick)");

  const sys = { c: SIGNED, ack: { signed_at: "2026-10-04 15:00:00", photos: 6 }, copy_sent_at: "2026-10-05 21:00:00", frozen: { "TX-homestead": true, "TX-defect": true, "TX-disclosure": true } };
  const done = await run("TX", { married: "no", sale_english: "yes" }, null, sys);
  const d2 = line(done.card, "notice:TX-disclosure"), p2 = line(done.card, "fixed:1"), c2 = line(done.card, "fixed:2"), h2 = line(done.card, "notice:TX-homestead"), lg = line(done.card, "cancellation_language");
  ok(d2.sys.done && d2.sys.at === "2026-10-05 19:30:00" && d2.sys.en === "Given to the customer with the contract, sent 10/05/2026 3:30 PM ET. The customer opened it 10/05/2026 3:45 PM ET.",
    "Texas: once sent, the disclosure line reads \"Given to the customer with the contract, sent 10/05/2026 3:30 PM ET ...\" (month first, 12-hour, Eastern)");
  ok(p2.sys.done && p2.sys.at === "2026-10-04 15:00:00" && p2.sys.en === "The customer signed the condition acknowledgment with 6 photos 10/04/2026 11:00 AM ET." && /com 6 fotos em 10\/04\/2026 11:00 AM ET\.$/.test(p2.sys.pt),
    "Texas: a signed acknowledgment with photos ticks the photo line, with the count and the time in both languages");
  ok(c2.sys.done && c2.sys.at === "2026-10-05 20:12:00" && /complete signed copy when the last signature was made, 10\/05\/2026 4:12 PM ET\. You also sent it 10\/05\/2026 5:00 PM ET\.$/.test(c2.sys.en),
    "Texas: the signed copy line ticks itself when everyone has signed, and says when it was also sent");
  ok(h2.sys.done && h2.sys.at === "2026-10-05 19:00:00" && / Locked in when the company signed\.$/.test(h2.sys.en), "Texas: a printed notice carries the time the company signed (when the text was locked in)");
  ok(lg.kind === "does" && lg.sys.done && lg.en === "Contract and cancellation notice in the language of the sale" && lg.sys.en === "The contract and the cancellation notice are in English, the language of the sale.",
    "Texas: the sale was in English, so \"the contract in the language of the sale\" is done by the system");
  ok(done.card.done_count === done.card.actions.filter(function (a) { return a.kind !== "person"; }).length && done.card.actions.filter(function (a) { return a.kind !== "person"; }).every(function (a) { return a.done && a.done.system === true && a.done.by === null; }),
    "Texas: on a signed contract every system line is done, and the heading count carries them (" + done.card.done_count + " of " + done.card.total + ")");
  // A contract the company signed BEFORE the builder printed these notices never claims to carry them.
  const old = await run("TX", {}, null, { c: SIGNED, ack: null, copy_sent_at: null, frozen: {} });
  ok(line(old.card, "notice:TX-homestead").kind === "person" && line(old.card, "notice:TX-homestead").en === "Add the homestead IMPORTANT NOTICE to the contract (10 point bold)" && line(old.card, "notice:TX-disclosure").kind === "person" && !line(old.card, "notice:TX-defect").sys,
    "a contract the company signed before this change does not claim the notices: those lines stay hand-ticked with their old wording");
}

// ── 2. A system line cannot be ticked or unticked by hand ─────────────────
{
  const t = await run("TX", { married: "yes", sale_english: "yes" });
  const sysKeys = t.card.actions.filter(function (a) { return a.kind !== "person"; }).map(function (a) { return a.key; });
  ok(sysKeys.length >= 6 && sysKeys.every(function (k) { return F.contractStateCheckApply(t.r.c.flags, t.card, k, true, "Maria", "2026-10-05 20:12:00") === null && F.contractStateCheckApply(t.r.c.flags, t.card, k, false, "Maria", "2026-10-05 20:12:00") === null; }),
    "ticking or unticking any of the " + sysKeys.length + " system lines stores nothing");
  const forged = { job_state: "TX", state_facts: { married: "yes" }, state_checks: { state: "TX", done: { "notice:TX-disclosure": { by: "Maria", at: "2026-10-05 20:12:00" }, "fixed:1": { by: "Maria", at: "2026-10-05 20:12:00" }, written_contract: { by: "Maria", at: "2026-10-05 20:12:00" } } } };
  const fc = (await run("TX", { married: "yes" }, { flags: forged })).card;
  ok(line(fc, "notice:TX-disclosure").done === null && line(fc, "fixed:1").done === null && line(fc, "written_contract").done === null,
    "a hand tick left in the saved record for a system line is ignored: the line still waits for the real thing");
  const person = t.card.actions.filter(function (a) { return a.kind === "person"; })[0];
  const good = F.contractStateCheckApply(t.r.c.flags, t.card, person.key, true, "Maria", "2026-10-05 20:12:00");
  ok(good && good.done[person.key].by === "Maria", "a person-only line is still ticked by hand exactly as before");
  const put = fnSrc("handlePutGmContract", workerSrc);
  ok(/The system ticks this line by itself\./.test(put) && /O sistema marca esta linha sozinho\./.test(put) && /code: "system_line"/.test(put) && /contractStateActionCard\(tickComp\.state, tickComp\.checklist, c\.flags, await contractStateSysLoad\(env, c\)\)/.test(put),
    "the save refuses a hand tick on a system line with a plain message in both languages");
  ok(/if \(a\.kind && a\.kind !== "person" && a\.sys\) \{ gmRenderContractSheet\(\); return; \}/.test(cut(gm, "gmConStateCheck")), "the screen never sends a hand tick for a system line");
}

// ── 3. The one-question facts: Yes / No / Not sure / no answer ────────────
{
  const none = await run("TX", {}), yes = await run("TX", { homestead: "yes" }), unsure = await run("TX", { homestead: "unsure" }), no = await run("TX", { homestead: "no" });
  const txt = noticeOf("TX-homestead").text_on_file;
  ok([none, yes, unsure].every(function (x) { return sec(x.r, "TX-homestead") && sec(x.r, "TX-homestead").text === txt; }) && sec(no.r, "TX-homestead") === null,
    "homestead: Yes, Not sure and no answer all print the IMPORTANT NOTICE (the safe side); No leaves it out");
  ok(line(no.card, "notice:TX-homestead") === null && no.card.more.some(function (m) { return m.key === "notice:TX-homestead" && /^Does not apply to this contract \("Is this the customer's homestead/.test(m.en) && /^Não se aplica a este contrato/.test(m.pt); }) && no.card.total === none.card.total - 1,
    "homestead No: the line leaves the card (the count drops by one) and is explained under More");
  const qs = none.card.facts.map(function (q) { return q.key; });
  ok(JSON.stringify(qs) === JSON.stringify(["homestead", "married", "subs", "sale_english"]) && none.card.facts.every(function (q) { return q.en && q.pt && q.en !== q.pt && q.answer === null && q.known === false; }),
    "Texas asks four questions, each once, in both languages: " + qs.join(", "));
  ok(yes.card.facts.filter(function (q) { return q.key === "homestead"; })[0].answer === "yes" && unsure.card.facts.filter(function (q) { return q.key === "homestead"; })[0].answer === "unsure", "the saved answer comes back with the question");
  // married
  const mNone = await run("TX", {}), mYes = await run("TX", { married: "yes" }), mUnsure = await run("TX", { married: "unsure" }), mNo = await run("TX", { married: "no" });
  ok(line(mNone.card, "written_contract").kind === "person" && line(mNone.card, "written_contract").en === "Get both spouses to sign before work starts, if the customer is married" && mNone.card.second_signer === null,
    "married, no answer: the line is the old hand-ticked sentence and no second signature is asked for (an old contract is never changed behind anyone's back)");
  ok([mYes, mUnsure].every(function (x) { const l = line(x.card, "written_contract"); return l.kind === "sees" && l.sys.done === false && /^Waiting: the customer's link asks for the customer's signature and then the second signer's\.$/.test(l.sys.en) && x.card.second_signer && x.card.second_signer.signed === null; }),
    "married Yes and Not sure: the second customer signer is part of the flow and the line waits for it");
  ok(line(mNo.card, "written_contract") === null && mNo.card.second_signer === null, "married No: no second signer, and the line leaves the card");
  ok(F.contractSecondSignerWanted("TX", { state_facts: { married: "yes" } }) === true && F.contractSecondSignerWanted("TX", { state_facts: { married: "unsure" } }) === true && F.contractSecondSignerWanted("TX", {}) === false && F.contractSecondSignerWanted("TX", { state_facts: { married: "no" } }) === false &&
    F.contractSecondSignerWanted("MA", { state_facts: { married: "yes" } }) === false && F.contractSecondSignerWanted("FL", { state_facts: { married: "yes" } }) === false && F.contractSecondSignerWanted("TX", { kind: "cleaning", state_facts: { married: "yes" } }) === false,
    "a second signer is asked for only in a state with a both-spouses line, on a construction contract, when married is Yes or Not sure");
  // language
  const lNo = await run("TX", { sale_english: "no" }), lUnsure = await run("TX", { sale_english: "unsure" });
  ok([lNo, lUnsure, none].every(function (x) { const l = line(x.card, "cancellation_language"); return l.kind === "person" && l.en === "Give the contract and the cancellation notice in the language you used to make the sale" && !l.sys; }),
    "sale in English No, Not sure or no answer: the language line stays with a person (the builder writes English only)");
  // what the contract and the project already record is never asked
  const arb = await run("CA", {}, { selections: { C14: "C14-B" } }), noArb = await run("CA", {}, { selections: { C14: "C14-A" } });
  ok(line(arb.card, "notice:CA-7191") && line(noArb.card, "notice:CA-7191") === null && !arb.card.facts.some(function (q) { return /^arb/.test(q.key); }),
    "California: the arbitration line shows only when the arbitration clause is chosen, and that is read from the contract, never asked");
  const ctx = await h.context(stateFx("MN", {}));
  ctx.job_sub_count = 2;
  const cMn = { id: "con-1", client_id: "client-1", number: "CON-0007", revision: 1, status: "draft", contract_date: "2026-10-01", offer_expiry_date: "2026-10-30", selections: h.defaultSelections(ctx), answers: {}, flags: { sold_in_home: true, property_type: "single_family", job_state: "MN", state_facts: { subs: "no" } }, custom_clauses: [], estimate_ids: ["est-1"] };
  const compMn = F.contractCompose(ctx, cMn, "2026-10-01", "live"), cardMn = F.contractStateActionCard(compMn.state, compMn.checklist, cMn.flags, null);
  const subQ = cardMn.facts.filter(function (q) { return q.key === "subs"; })[0];
  ok(subQ && subQ.known === true && subQ.answer === "yes" && compMn.sections.some(function (s) { return s.id === "MN-lien"; }), "Minnesota: a subcontractor already assigned to the project answers \"subcontractors or suppliers?\" Yes, whatever was typed, and the lien notice prints");
  const facts = F.contractStateFacts({ state_facts: { homestead: "maybe", married: "yes", made_up: "yes" } }, null);
  ok(facts.homestead.answer === null && facts.married.answer === "yes" && facts.made_up === undefined, "an answer that is not yes / no / unsure, or a fact that does not exist, is ignored");
  const put = fnSrc("handlePutGmContract", workerSrc);
  ok(/body\.flags\.state_facts && typeof body\.flags\.state_facts === "object"/.test(put) && /if \(!factDefs\[k\] \|\| !factDefs\[k\]\.en\) \{ return; \}/.test(put) && /CONTRACT_STATE_FACT_ANSWERS\.indexOf\(fv\) !== -1/.test(put) && put.indexOf("flags.state_facts = factsNow") < put.indexOf("UPDATE gm_contracts SET selections_json"),
    "the save stores only real facts with a real answer, in the contract's existing flags (no new column)");
  ok(Object.keys(sorting.facts).filter(function (k) { return sorting.facts[k].en; }).every(function (k) { return sorting.facts[k].pt && /\?$/.test(sorting.facts[k].en) && /\?$/.test(sorting.facts[k].pt); }), "every question has an English and a Portuguese wording");
}

// ── 4. Other states, different shapes ─────────────────────────────────────
{
  // Minnesota: a notice that depends on one fact.
  const mn = await run("MN", {}), mnNo = await run("MN", { subs: "no" }), mnUnsure = await run("MN", { subs: "unsure" });
  ok(sec(mn.r, "MN-lien") && sec(mnUnsure.r, "MN-lien") && sec(mn.r, "MN-lien").text === noticeOf("MN-lien").text_on_file && sec(mnNo.r, "MN-lien") === null && line(mn.card, "notice:MN-lien").kind === "does" && line(mnNo.card, "notice:MN-lien") === null,
    "Minnesota: the mechanics lien notice prints unless \"subcontractors or suppliers?\" is No; Not sure prints");
  ok(JSON.stringify(sec(mn.r, "MN-lien").emphasis) === JSON.stringify({ bold: true, min_pt: 10 }) && sec(mn.r, "MN-lien").system === true && sec(mn.r, "MN-lien").kind === "state_notice", "Minnesota: the printed notice carries the look the statute states (bold, at least 10 point)");
  // Nevada: two documents handed over under one line.
  const nv = await run("NV", {}), nvSent = await run("NV", {}, null, { c: { status: "sent", company_signed_at: "2026-10-05 19:00:00", sent_at: "2026-10-05 19:30:00" }, frozen: { "NV-info-liens": true, "NV-info-contractors": true } });
  ok(sec(nv.r, "NV-info-liens").kind === "state_document" && sec(nv.r, "NV-info-contractors").kind === "state_document" && sec(nv.r, "NV-info-liens").text === noticeOf("NV-info-liens").text_on_file && sec(nv.r, "NV-info-contractors").text === noticeOf("NV-info-contractors").text_on_file,
    "Nevada: the two state information forms ride with the contract as documents, word for word");
  ok(line(nv.card, "notice:NV-info-liens").kind === "does" && line(nv.card, "notice:NV-info-liens").sys.done === false && line(nvSent.card, "notice:NV-info-liens").sys.done === true && nv.card.actions.filter(function (a) { return /NV-info/.test(a.key); }).length === 1 && line(nv.card, "notice:NV-sub-list").kind === "person",
    "Nevada: one line covers both forms (waiting until the contract is sent, then done); the subcontractor list stays with a person");
  // Virginia: the system sees both signatures.
  const va = await run("VA", {}), vaSigned = await run("VA", {}, null, { c: SIGNED });
  ok(line(va.card, "written_contract").kind === "sees" && /^Waiting: the company and the customer have not both signed yet\.$/.test(line(va.card, "written_contract").sys.en) && line(vaSigned.card, "written_contract").sys.en === "Company signed 10/05/2026 3:00 PM ET; customer signed 10/05/2026 4:12 PM ET." && line(vaSigned.card, "written_contract").sys.at === "2026-10-05 20:12:00",
    "Virginia: \"signed by both sides\" waits, then reads \"Company signed 10/05/2026 3:00 PM ET; customer signed 10/05/2026 4:12 PM ET.\"");
  ok(line(va.card, "notice:VA-dpor").kind === "person" && !sec(va.r, "VA-dpor"), "Virginia: the DPOR statement needs a signed acknowledgment, so it stays with a person and does not print");
  // New York: the system sees the company signature and the send.
  const ny = await run("NY", {}), nySent = await run("NY", {}, null, { c: { status: "sent", company_signed_at: "2026-10-05 19:00:00", sent_at: "2026-10-05 19:30:00" } });
  ok(line(ny.card, "written_contract").kind === "sees" && line(ny.card, "written_contract").sys.done === false && line(nySent.card, "written_contract").sys.done === true && /^Signed by the company 10\/05\/2026 3:00 PM ET and sent to the customer 10\/05\/2026 3:30 PM ET\.$/.test(line(nySent.card, "written_contract").sys.en),
    "New York: \"a copy you have signed\" ticks itself once the company has signed and the contract is sent");
  // California: a first payment over the cap is something the system watches; a license number too.
  const ca = await run("CA", {}), caNoLic = await run("CA", {}, { doc: { license_numbers: [] } }), caYoung = await run("CA", { age65: "no" });
  const dep = line(ca.card, "deposit_over"), lic = line(caNoLic.card, "license_number");
  ok(dep && dep.kind === "sees" && dep.sys.done === false && /^Waiting: lower the first payment to \$1,000\.00 or less\./.test(dep.sys.en) && /\$1,000\.00/.test(dep.sys.pt) && /\$1,000\.00/.test(dep.en),
    "California: a first payment over the cap is a line the system watches (\"Waiting: lower the first payment to $1,000.00 or less\")");
  ok(lic && lic.kind === "sees" && /^Waiting: add your license or registration number/.test(lic.sys.en) && line(ca.card, "license_number") === null, "California: the missing license number is a line the system watches; with a number on file the line is gone");
  ok(line(ca.card, "cancellation_days") && line(caYoung.card, "cancellation_days") === null && ca.card.facts.some(function (q) { return q.key === "age65"; }), "California: \"Is the customer 65 or older?\" No takes the senior line off the card");
  // Kansas and Kentucky: printed on every residential job; Indiana: a notice whose official copy carries hard line wraps.
  const ks = await run("KS", {}), ky = await run("KY", {}), inY = await run("IN", { big_build: "yes" }), inN = await run("IN", { big_build: "no" });
  ok(sec(ks.r, "KS-60-4706").text === noticeOf("KS-60-4706").text_on_file && sec(ky.r, "KY-cure").text === noticeOf("KY-cure").text_on_file && sec(inY.r, "IN-cure").text === noticeOf("IN-cure").text_on_file && sec(inN.r, "IN-cure") === null,
    "Kansas, Kentucky and Indiana: the defect notices print word for word (Indiana only for a new home or a large remodel)");
  const commercial = await run("KS", {}, { flags: { job_state: "KS", property_type: "commercial" } });
  ok(sec(commercial.r, "KS-60-4706") === null && line(commercial.card, "notice:KS-60-4706") === null, "Kansas: a commercial job does not get the homeowner notice");
  // Massachusetts: nothing the system can print (no official wording on file), so nothing prints.
  const ma = await run("MA", {});
  ok(!ma.r.comp.sections.some(function (s) { return s.system; }) && line(ma.card, "notice:MA-142A-notices").kind === "person" && line(ma.card, "fixed:1").kind === "sees" && line(ma.card, "fixed:2").kind === "does",
    "Massachusetts: with no official wording on file nothing new prints; the notice stays with a person; the photo and signed-copy lines are the system's");
}

// ── 5. Every state: what the system prints is official, complete and exact ─
{
  let planned = 0, bad = [], notOfficial = [], fileBad = [], fileChecked = 0;
  const haveInput = inputExists();
  const parsed = {};
  for (const code of NON_FL) {
    const r = await h.compose(stateFx(code, {}, { settings: { builds_pools: true }, flags: { job_state: code, is_pool: true, state_facts: {} } }));
    r.comp.sections.filter(function (s) { return s.system === true; }).forEach(function (s) {
      planned++;
      const n = noticeOf(s.id);
      if (s.text !== n.text_on_file || !n.text_on_file || n.text) { bad.push(s.id); }
      if (n.source_status !== "VERBATIM-OFFICIAL" || n.hold_reason || (n.range && n.range.blanks.length) || !/^https:\/\//.test(n.source_url || "")) { notOfficial.push(s.id); }
      if (haveInput) {
        parsed[code] = parsed[code] || parseStateFile(code);
        fileChecked++;
        let fromFile = null;
        if (n.range) {
          const blk = parsed[code].blocks.filter(function (b) { return b.heading === n.range.block && b.index === n.range.block_index; })[0];
          const c = blk ? cutRange(blk.text, n.range) : { error: "block not found" };
          fromFile = c.error ? null : c.text;
        } else { const whole = parsed[code].blocks.filter(function (b) { return b.text === n.text_on_file; })[0]; fromFile = whole ? whole.text : null; }
        if (fromFile === null || fromFile !== s.text) { fileBad.push(s.id); }
      }
    });
  }
  ok(planned === 12 && bad.length === 0, "all 50 states and DC: the system prints or hands over " + planned + " notices, each exactly the wording stored on file, byte for byte" + (bad.length ? " (" + bad.join(", ") + ")" : ""));
  ok(notOfficial.length === 0, "each of them is an official verbatim copy with its source address, not on hold, with no blank a person must fill" + (notOfficial.length ? " (" + notOfficial.join(", ") + ")" : ""));
  if (!haveInput) { console.log("NOTICE  input folder " + INPUT_DIR + " not found: the byte-exact check against the official-text files is skipped"); }
  else { ok(fileChecked === planned && fileBad.length === 0, "each printed notice is byte-identical to the text cut out of the official-text file again by the same script (" + fileChecked + " checked)" + (fileBad.length ? " (" + fileBad.join(", ") + ")" : "")); }
  // The gate itself.
  const base = { text: null, text_on_file: "X", source_status: "VERBATIM-OFFICIAL" };
  ok(F.contractStateNoticePrintable(base) === true && F.contractStateNoticePrintable(Object.assign({}, base, { source_status: "VERBATIM-NEAR-OFFICIAL" })) === false && F.contractStateNoticePrintable(Object.assign({}, base, { source_status: "VERBATIM-SECONDARY" })) === false &&
    F.contractStateNoticePrintable(Object.assign({}, base, { text_on_file: "" })) === false && F.contractStateNoticePrintable(Object.assign({}, base, { hold_reason: "x" })) === false && F.contractStateNoticePrintable(Object.assign({}, base, { range: { blanks: ["(date)"] } })) === false && F.contractStateNoticePrintable(null) === false,
    "only a VERBATIM-OFFICIAL text prints: a near-official or secondary copy, a held notice, an empty text or a notice with a blank to fill never does");
  // Every row that says the system prints must name a notice that passes the gate; every person-only notice line is listed.
  const rowsBad = [];
  Object.keys(sorting.states).forEach(function (code) {
    Object.keys(sorting.states[code].lines).forEach(function (k) {
      const e = sorting.states[code].lines[k];
      if (e.sys !== "print" && e.sys !== "deliver") { return; }
      (e.docs || [k.slice(7)]).forEach(function (id) { if (!F.contractStateNoticePrintable(noticeOf(id))) { rowsBad.push(id); } });
      if (!e.sys_en || !e.sys_pt || e.sys_en === e.sys_pt) { rowsBad.push(k + " label"); }
    });
  });
  ok(rowsBad.length === 0, "every row sorted as \"the system prints it\" names a notice that may print, and has its label in both languages" + (rowsBad.length ? " (" + rowsBad.join(", ") + ")" : ""));
  const kinds = sorting.sys_kinds;
  const allRows = Object.keys(sorting.generic).map(function (k) { return sorting.generic[k]; }).concat(...Object.keys(sorting.states).map(function (c) { return Object.keys(sorting.states[c].lines).map(function (k) { return sorting.states[c].lines[k]; }); }));
  ok(allRows.every(function (e) { return (!e.sys || (kinds[e.sys] === "does" || kinds[e.sys] === "sees")) && (!e.sys || (e.sys_en && e.sys_pt)) && (!e.fact || sorting.facts[e.fact]); }), "every system row names a known kind and both labels; every fact a row depends on exists");
  for (const code of NON_FL) {
    const c = (await run(code, { married: "yes", sale_english: "yes" })).card;
    if (!c.actions.every(function (a) { return KINDS.indexOf(a.kind) !== -1 && (a.kind === "person" ? !a.sys : (a.sys && a.sys.en && a.sys.pt && typeof a.sys.done === "boolean")); })) { rowsBad.push("kind " + code); }
  }
  ok(rowsBad.length === 0, "in all 50 states and DC every action line is does, sees or person, and every system line says where it stands in both languages");
}

// ── 6. The second customer signer ticks its line ──────────────────────────
{
  const sql = new Function(varSrc("CONTRACT_SECOND_SIGNER_SQL", workerSrc) + "\nreturn CONTRACT_SECOND_SIGNER_SQL;")();
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE gm_contracts (id TEXT, status TEXT, homeowner_signed_at TEXT, flags_json TEXT, contract_amount_cents INTEGER, updated_at TEXT)");
  const flags = { sold_in_home: true, property_type: "single_family", job_state: "TX", state_facts: { married: "yes" } };
  db.prepare("INSERT INTO gm_contracts VALUES ('done','completed','2026-10-05 20:12:00',?,1250000,'x'), ('sent','sent',NULL,?,1250000,'x'), ('nulls','completed','2026-10-05 20:12:00',NULL,1,'x')").run(JSON.stringify(flags), JSON.stringify(flags));
  const rec = { name: "Sam Rivers", at: "2026-10-05 20:40:00", kind: "typed", ip: "203.0.113.9", ua: "test" };
  const first = db.prepare(sql).run(JSON.stringify(rec), "done"), again = db.prepare(sql).run(JSON.stringify(Object.assign({}, rec, { name: "Someone Else" })), "done"), early = db.prepare(sql).run(JSON.stringify(rec), "sent"), nulls = db.prepare(sql).run(JSON.stringify(rec), "nulls");
  const row = function (id) { return db.prepare("SELECT * FROM gm_contracts WHERE id = ?").get(id); };
  const saved = JSON.parse(row("done").flags_json);
  ok(first.changes === 1 && saved.second_signer.name === "Sam Rivers" && saved.second_signer.at === "2026-10-05 20:40:00" && saved.job_state === "TX" && saved.state_facts.married === "yes" && row("done").status === "completed" && row("done").contract_amount_cents === 1250000,
    "the second signature is written into the contract's flags only: status, amount and every other flag are untouched");
  ok(again.changes === 0 && JSON.parse(row("done").flags_json).second_signer.name === "Sam Rivers" && early.changes === 0 && !JSON.parse(row("sent").flags_json).second_signer && nulls.changes === 1,
    "it is written once (a second attempt changes nothing) and only after the first customer has signed");
  const sys = { c: Object.assign({}, SIGNED), ack: null, copy_sent_at: null, frozen: { "TX-homestead": true, "TX-defect": true, "TX-disclosure": true } };
  const before = await run("TX", { married: "yes" }, null, sys);
  const after = await run("TX", { married: "yes" }, { flags: saved }, sys);
  const lb = line(before.card, "written_contract"), la = line(after.card, "written_contract");
  ok(lb.kind === "sees" && lb.sys.done === false && lb.sys.en === "Waiting: the second signer has not signed yet. The customer's link asks for the second signature." && line(before.card, "fixed:2").sys.done === false,
    "after the first signature the line reads \"Waiting: the second signer has not signed yet\", and the signed copy line waits with it");
  ok(la.sys.done === true && la.sys.at === "2026-10-05 20:40:00" && la.sys.en === "Second signer Sam Rivers signed 10/05/2026 4:40 PM ET." && la.sys.pt === "Segundo assinante Sam Rivers assinou em 10/05/2026 4:40 PM ET." && la.done.system === true && after.card.done_count === before.card.done_count + 2 && line(after.card, "fixed:2").sys.at === "2026-10-05 20:40:00",
    "once the second signer signs, the line ticks itself: \"Second signer Sam Rivers signed 10/05/2026 4:40 PM ET.\" (and the signed copy line with it)");
  ok(after.card.second_signer.signed.name === "Sam Rivers" && before.card.second_signer.signed === null, "the builder payload says whether the second signer has signed");
  const hsrc = fnSrc("handlePostPublicContractSecondSign", workerSrc);
  ok(/body\.consent !== true/.test(hsrc) && /contractSecondSignerWanted\(contractStateCode\(c\.flags && c\.flags\.job_state\), c\.flags\)/.test(hsrc) && /c\.status !== "completed" \|\| !c\.homeowner_signed_at/.test(hsrc) && /CONTRACT_SECOND_SIGNER_SQL/.test(hsrc) && /"second_signer_signed"/.test(hsrc) && !/UPDATE gm_contracts SET status/.test(hsrc),
    "the customer's link takes the second signature only with consent, only when asked for, only after the first, and never changes the contract's status");
  ok(/\(sign\|second-sign\|changes\|decline\)/.test(workerSrc) && /pubCon\[2\] === "second-sign" && method === "POST"\) \{ return handlePostPublicContractSecondSign\(/.test(workerSrc), "the route exists on the customer's own link");
  const pub = fnSrc("contractPublicPayload", workerSrc);
  ok(/second_signer: contractSecondSignerWanted\(comp\.state\.code, c\.flags\) \? \{ signed: /.test(pub) && !/second_signer[^\n]*\bip\b/.test(pub), "the customer's page is told a second signature is asked for (and never the signer's IP)");
  ok(/second_signer: undefined/.test(fnSrc("handlePostGmContractRevise", workerSrc)), "a revision starts without the earlier second signature");
  const pdf = fnSrc("docPdfByToken", workerSrc);
  ok(/final: r\.status === "completed" && !waitsSecond/.test(pdf) && /contractSecondSignerWanted\(contractStateCode\(conFlags\.job_state\), conFlags\) && !contractSecondSigner\(conFlags\)/.test(pdf), "the stored PDF waits for a second signature that was asked for, so the stored copy carries both");
  ok(/function secondSignHtml\(\)/.test(view) && /onclick="signSecond\(\)"/.test(view) && /"\/second-sign"/.test(view) && /signatureCell\("Second owner signature", con\.second_signer\.signed, ""\)/.test(view) && /sigCell\("Second owner", con\.second_signer\.signed, ""\)/.test(tpl),
    "the customer's page asks for the second signature after the first, and the page and the PDF both show it");
}

// ── 7. Nothing waits on the list: send, sign and preview are never stopped ─
{
  const combos = [{}, { homestead: "yes", married: "yes", subs: "yes", sale_english: "no" }, { homestead: "no", married: "no", subs: "no", sale_english: "yes" }, { homestead: "unsure", married: "unsure", subs: "unsure", big_build: "unsure", credit: "unsure" }];
  let blockers = 0, missingDiff = 0;
  for (const code of ["TX", "MN", "NV", "VA", "NY", "CA", "KS", "IN", "MA"]) {
    const base = await h.compose(stateFx(code, {}));
    for (const f of combos) {
      const r = await h.compose(stateFx(code, f));
      blockers += r.comp.blockers.length;
      if (JSON.stringify(r.comp.missing) !== JSON.stringify(base.comp.missing) || JSON.stringify(r.comp.requires) !== JSON.stringify(base.comp.requires) || r.comp.amount_cents !== base.comp.amount_cents) { missingDiff++; }
    }
  }
  ok(blockers === 0 && missingDiff === 0, "nine states, every mix of answers: no blocker, and the missing fields, the signing requirements and the amount never change with an answer");
  const gates = ["handlePostGmContractSend", "handlePostGmContractCompanySign", "handlePostGmContractRoute", "handlePostPublicContractSign", "handleGetGmContractPreview", "handlePostGmContractSignedCopy"];
  ok(gates.every(function (n) { const s = fnSrc(n, workerSrc); return !/state_facts|second_signer|contractSecondSigner|contractStateSysStatus|contractStateSysLoad|state_card|contractStateActionCard|state_checks/.test(s); }),
    "send, company sign, route, customer sign, preview and signed copy never read the answers, the system lines or the second signer");
  const sign = fnSrc("handlePostPublicContractSign", workerSrc);
  ok(/SET status = 'completed'/.test(sign) && !/second/.test(sign), "the first customer signature completes the contract exactly as before; the second signature never holds it up");
  const waitingAll = (await run("TX", { married: "yes" })).card;
  ok(waitingAll.actions.filter(function (a) { return a.sys && !a.sys.done; }).length >= 4 && (await h.compose(stateFx("TX", { married: "yes" }))).comp.blockers.length === 0, "a Texas contract with four or more lines still waiting has no blocker");
  ok(!/blockers\.push/.test(fnSrc("contractStatePrintPlan", workerSrc) + fnSrc("contractStateSysStatus", workerSrc) + fnSrc("contractStateActionCard", workerSrc) + fnSrc("contractStateFacts", workerSrc)), "the new functions cannot add a blocker");
}

// ── 8. What the system lines read from the database (stubbed) ─────────────
{
  const calls = [];
  const env = {
    DB: { prepare: function (q) { return { bind: function () { calls.push(q); return { first: async function () {
      if (/FROM gm_job_acks/.test(q)) { return { signed_at: "2026-10-04 15:00:00", payload_json: JSON.stringify({ photos: [{ id: "a" }, { id: "b" }] }) }; }
      if (/FROM gm_contract_events/.test(q)) { return { created_at: "2026-10-05 21:00:00" }; }
      return null; } }; } }; } },
    ASSETS: { get: async function (key) { return key === "snap" ? { text: async function () { return JSON.stringify({ sections: [{ kind: "state_notice", id: "TX-defect", system: true }, { kind: "state_notice", id: "TX-cancel" }, { kind: "clause", id: "C01-A" }] }); } } : null; } }
  };
  const got = await F.contractStateSysLoad(env, { id: "con-1", client_id: "client-1", job_id: "job-1", snapshot_r2_key: "snap", company_signed_at: "2026-10-05 19:00:00", company_signature_voided_at: null });
  ok(got.ack && got.ack.photos === 2 && got.ack.signed_at === "2026-10-04 15:00:00" && got.copy_sent_at === "2026-10-05 21:00:00" && JSON.stringify(got.frozen) === JSON.stringify({ "TX-defect": true }),
    "the builder reads the signed photo acknowledgment, the \"signed copy sent\" event and which system notices are inside the text the company signed");
  ok(calls.every(function (q) { return /^SELECT /.test(q); }) && calls.some(function (q) { return /kind = 'before_photos' AND status = 'signed'/.test(q); }) && calls.some(function (q) { return /action = 'signed_copy_sent'/.test(q); }), "it only reads (two SELECTs): a signed before-work acknowledgment and the signed-copy event");
  const empty = await F.contractStateSysLoad({ DB: { prepare: function () { throw new Error("down"); } }, ASSETS: { get: async function () { return null; } } }, { id: "c", client_id: "x", job_id: "j" });
  ok(empty.ack === null && empty.copy_sent_at === null && empty.frozen === null, "a failed read never throws: the lines simply wait");
  const noPhotos = await F.contractStateSysLoad({ DB: { prepare: function (q) { return { bind: function () { return { first: async function () { return /gm_job_acks/.test(q) ? { signed_at: "2026-10-04 15:00:00", payload_json: "{\"photos\":[]}" } : null; } }; } }; } }, ASSETS: env.ASSETS }, { id: "c", client_id: "x", job_id: "j" });
  ok(noPhotos.ack === null, "an acknowledgment with no photos does not tick the photo line");
  ok(/contractStateSysLoad\(env, c\)/.test(fnSrc("contractInternalOut", workerSrc)) && /job_sub_count: subCount/.test(fnSrc("contractContext", workerSrc)) && /removed_at IS NULL/.test(fnSrc("contractContext", workerSrc)), "the builder payload loads it; the contract context counts the project's assigned subcontractors");
}

// ── 9. The screen: gm.js draws the three kinds (real functions, stubbed page) ─
{
  const dt = readFileSync(new URL("datetime.js", root), "utf8");
  const formatDateTimeUTC = new Function(cut(dt, "formatDateTimeUTC") + "\nfunction formatDateTime(s) { return 'RAW ' + s; }\nreturn formatDateTimeUTC;")();
  function stubs(en) {
    return { gmT: function (pt, e) { return en ? e : pt; }, isEn: function () { return en; }, formatDateTimeUTC: formatDateTimeUTC,
      gmSheetRowHtml: function (icon, label, value, a, b, sub) { return "<row>" + label + "|" + value + "|" + (sub || "") + "</row>"; },
      escHtml: function (x) { return String(x === null || x === undefined ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); } };
  }
  function draw(name, en, args) { const s = stubs(en), names = Object.keys(s); return new Function(...names, cut(gm, name) + "\nreturn " + name + ";")(...names.map(function (k) { return s[k]; })).apply(null, args); }
  const sys = { c: SIGNED, ack: { signed_at: "2026-10-04 15:00:00", photos: 6 }, copy_sent_at: null, frozen: { "TX-homestead": true, "TX-defect": true, "TX-disclosure": true } };
  const t = await run("TX", { married: "yes" }, null, sys);
  const payload = { status: "completed", job_state_name: "Texas", state_checklist: t.r.comp.checklist, state_card: t.card };
  const en = draw("gmConStateCardHtml", true, [payload]), pt = draw("gmConStateCardHtml", false, [payload]);
  const n = t.card.total, dn = t.card.done_count, sysN = t.card.actions.filter(function (a) { return a.kind !== "person"; }).length;
  ok(en.indexOf("Before you send: Texas (" + dn + " of " + n + " done)") !== -1 && pt.indexOf("Antes de enviar: Texas (" + dn + " de " + n + " feitos)") !== -1 && dn === 4, "the heading counts the system's lines: \"Before you send: Texas (" + dn + " of " + n + " done)\"");
  ok((en.match(/Done by the system<\/span>/g) || []).length === dn && (pt.match(/Feito pelo sistema<\/span>/g) || []).length === dn && /Done by the system<\/span> 10\/05\/2026 3:30 PM<br>Given to the customer with the contract, sent 10\/05\/2026 3:30 PM ET\./.test(en),
    "a done system line shows \"Done by the system\", the date and time (10/05/2026 3:30 PM, Eastern) and one line of evidence, in both languages");
  ok((en.match(/ disabled aria-describedby="gmConStChk\d+Sys"/g) || []).length === sysN && (en.match(/onchange="gmConStateCheck/g) || []).length === n - sysN && />Waiting: the second signer has not signed yet\./.test(en) && />Aguardando: o segundo assinante ainda não assinou\./.test(pt),
    "a system line has a locked box and no tick action; a waiting one says what it is waiting for; only the " + (n - sysN) + " person-only lines can be ticked");
  ok(/<label for="gmConStChk\d+">Both spouses sign the contract<\/label>/.test(en) && /<label for="gmConStChk\d+">Os dois cônjuges assinam o contrato<\/label>/.test(pt) && !/Get both spouses to sign before work starts/.test(en), "a system line reads as a thing that happens, not as a job for the person");
  const q = { state_card: t.card };
  const qEn = draw("gmConStateFactsHtml", true, [q, false]), qPt = draw("gmConStateFactsHtml", false, [q, false]), qRo = draw("gmConStateFactsHtml", true, [q, true]);
  ok((qEn.match(/class="gm-choice-chip/g) || []).length === t.card.facts.length * 3 && />Yes<\/button>/.test(qEn) && />No<\/button>/.test(qEn) && />Not sure<\/button>/.test(qEn) && />Sim<\/button>/.test(qPt) && />Não<\/button>/.test(qPt) && />Não sei<\/button>/.test(qPt),
    "each question is drawn once with three choices: Yes / No / Not sure (Sim / Não / Não sei)");
  ok(/Is the customer married\?<\/span><button type="button" class="gm-choice-chip gm-chip-sel" onclick="gmConSetFact\('married', 'yes'\)">Yes/.test(qEn) && /O cliente é casado\?/.test(qPt) && /Is this the customer&#?[a-z0-9]*;?s homestead|Is this the customer's homestead/.test(qEn),
    "the saved answer is the selected chip, and the question is in the screen's language");
  ok(!/<button/.test(qRo) && /<row>Is the customer married\?\|Yes\|<\/row>/.test(qRo) && /\|\|Not answered<\/row>/.test(qRo), "on a contract that can no longer change, the questions show as plain rows with their answers");
  const known = draw("gmConStateFactsHtml", true, [{ state_card: { facts: [{ key: "subs", en: "Will subcontractors or suppliers work on this job?", pt: "x", answer: "yes", known: true }] } }, false]);
  ok(!/<button/.test(known) && /\|Yes\|The project already records this\.<\/row>/.test(known), "a fact the project already records is shown, not asked");
  ok(draw("gmConStateFactsHtml", true, [{ state_card: null }, false]) === "" && draw("gmConStateFactsHtml", true, [{}, false]) === "", "no card (Florida): no question is drawn");
  const sheet = cut(gm, "gmRenderContractSheet"), clean = cut(gm, "gmConCleaningQuestionsHtml");
  ok((sheet.match(/if \(outFl\) \{ q \+= gmConStateFactsHtml\(c, (true|false)\); \}/g) || []).length === 2 && (clean.match(/if \(outFl\) \{ q \+= gmConStateFactsHtml\(c, (true|false)\); \}/g) || []).length === 2, "the questions sit in \"This contract\", for a job outside Florida only, on construction and cleaning contracts");
  ok(/gmConSave\(\{ flags: \{ state_facts: facts \} \}\)/.test(cut(gm, "gmConSetFact")), "an answer is saved at once, on the contract");
  const newCode = cut(gm, "gmConStateFactsHtml") + cut(gm, "gmConSetFact") + cut(gm, "gmConStateCardHtml") + cut(gm, "gmConStateCheck");
  ok(!/\b(confirm|alert|prompt)\s*\(/.test(newCode) && !/\b(const|let)\s/.test(newCode) && !/=>/.test(newCode) && !/[^\x00-\x7F]/.test(cut(gm, "gmConStateFactsHtml") + cut(gm, "gmConSetFact")), "no browser pop-up, no const / let / arrow function, plain ASCII in the new strings");
  ["gmConStateFactsHtml", "gmConSetFact", "gmConStateCardHtml", "gmConStateCheck", "gmRenderContractSheet", "gmConCleaningQuestionsHtml"].forEach(function (name) { ok(cut(gm, name) === cut(ios, name), "gm.js and its iOS copy carry the same " + name); });
}

// ── 10. What the customer reads: the page and the PDF template ────────────
{
  ok(/\.locked\.sys-em p \{ font-size: 10\.5pt; font-weight: 700; \}/.test(tpl) && /\.locked\.sys-em12 p \{ font-size: 12pt; \}/.test(tpl) && /\.clause\.sys-em p \{ font-weight: 700; font-size: 14px; \}/.test(view),
    "a notice the statute wants in bold of at least 10 point prints bold at 10.5 point in the PDF (the template's usual notice size is 9.5 point) and 14px on the page");
  ok(/if \(s\.kind === "state_document"\) \{ stateDocs\.push\(s\); return; \}/.test(tpl) && /kind: "block", startPage: true \}\);\n        dp\.forEach/.test(tpl) && /endPage: i === dp\.length - 1/.test(tpl), "PDF: a document handed over with the contract starts its own page and ends it");
  ok(/if \(s\.kind === "state_document"\) \{\n          h \+= '<\/div><div class="card state-doc"><h2>'/.test(view) && /This document is given to you with this contract/.test(view) && /Please read it before you sign\./.test(view), "page: the document is its own card above the signature, saying it is given with the contract");
  ok(/var em = s\.system === true && s\.emphasis \? s\.emphasis : null;/.test(view) && /var em = s\.system === true && s\.emphasis \? s\.emphasis : null;/.test(tpl), "the look is applied only to a notice the system printed that carries one; every other section is drawn as before");
  // flowText: display only, never a word changed.
  const flow = new Function(/function flowText\(text\) \{[^\n]*\}/.exec(view)[0] + "\nreturn flowText;")();
  const flowTpl = /function flowText\(text\) \{[^\n]*\}/.exec(tpl)[0];
  const inText = noticeOf("IN-cure").text_on_file;
  const words = function (s) { return s.split(/\s+/).filter(Boolean).join(" "); };
  ok(flowTpl === /function flowText\(text\) \{[^\n]*\}/.exec(view)[0] && /\n {2,}/.test(inText) && !/\n {2,}/.test(flow(inText)) && words(flow(inText)) === words(inText) && flow(noticeOf("TX-homestead").text_on_file) === noticeOf("TX-homestead").text_on_file && flow(noticeOf("MN-lien").text_on_file) === noticeOf("MN-lien").text_on_file,
    "hard line wraps copied from an official page are joined for display only: not one word changes, and a notice without them is untouched");
  // A function of the page's inline script (indented four spaces).
  function cutIn(src, name) { const i = src.indexOf("\n    function " + name + "("); if (i < 0) { throw new Error("not found: " + name); } return src.slice(i + 1, src.indexOf("\n    }\n", i) + 6); }
  const newView = cutIn(view, "secondSignHtml") + cutIn(view, "signSecond");
  ok(!/\b(confirm|alert|prompt)\s*\(/.test(newView) && !/\b(const|let)\s/.test(newView) && !/=>/.test(newView) && /var err = byId\("sign2Err"\); if \(!err\) \{ return; \}/.test(newView) && /esignConsentHtml\(con\.business, "", "btnSign2"\)/.test(newView),
    "the second signature form uses no browser pop-up, null-checks its elements and asks for the same electronic consent as the first");
  ok(/<h3>Second owner signature<\/h3>/.test(newView) && /Sign as second owner<\/button>/.test(newView) && /This contract asks for the signature of a second owner or spouse\. That person signs here\./.test(newView), "the customer's page names the second signature plainly, and its button says what it does (\"Sign as second owner\")");
}

// ── 11. Florida is unchanged, byte for byte ───────────────────────────────
for (const name of Object.keys(FLORIDA_FIXTURES)) {
  const golden = JSON.stringify(JSON.parse(readFileSync(new URL("state-riders-golden-" + name + ".json", GOLDEN_DIR), "utf8")));
  const fl = await h.compose(fx(name, { flags: { job_state: "FL" } }));
  const stray = await h.compose(fx(name, { flags: { job_state: "FL", state_facts: { homestead: "yes", married: "yes", subs: "yes", big_build: "yes", sale_english: "no" }, second_signer: { name: "Sam Rivers", at: "2026-10-05 20:40:00" } } }));
  ok(JSON.stringify(goldenView(fl.comp)) === golden && JSON.stringify(goldenView(stray.comp)) === golden, "Florida golden file, byte for byte (also with answers and a second signer left in flags): " + name);
  ok(F.contractStateActionCard(fl.comp.state, fl.comp.checklist, fl.c.flags, null) === null && fl.comp.state.facts === undefined && !fl.comp.sections.some(function (s) { return s.system || s.kind === "state_document"; }), "Florida has no card, no question and no system notice: " + name);
}
// Massachusetts (nothing on file to print) composes exactly as its golden files say.
for (const name of Object.keys(FLORIDA_FIXTURES)) {
  const f = clone(FLORIDA_FIXTURES[name]);
  f.flags = Object.assign({}, f.flags, { job_state: "MA" }); f.doc = { address: "100 Bay St, Springfield", license_numbers: ["REG-12345"] }; f.settings = Object.assign({}, f.settings || {}, { values: { business_state: "MA" } });
  ok(JSON.stringify(goldenView((await h.compose(f)).comp)) === JSON.stringify(JSON.parse(readFileSync(new URL("cleaning-golden-" + name + "-MA.json", GOLDEN_DIR), "utf8"))), "Massachusetts golden file unchanged: " + name);
}

// ── 12. The review and summary files match the data ───────────────────────
{
  ok(readFileSync(new URL("scripts/fixtures/state-checklist-summary.txt", root), "utf8") === summaryText && readFileSync(new URL("scripts/fixtures/state-checklist-review.txt", root), "utf8") === reviewText, "state-checklist-summary.txt and state-checklist-review.txt match the data (regenerate them after a change)");
  ok(/STATE {20}DOES {2}SEES {2}PERSON/.test(summaryText) && /\nTexas \(TX\) +5 +2 +7\n/.test(summaryText) && /NEEDS OFFICIAL TEXT BEFORE THE SYSTEM CAN DO IT \(\d+\)/.test(summaryText) && /WORDING IS ON FILE, BUT THE SYSTEM CANNOT DO THE REST YET \(\d+\)/.test(summaryText) && (summaryText.match(/\n[A-Z][A-Za-z .]+ \([A-Z]{2}\) +\d+ +\d+ +\d+/g) || []).length === 50,
    "the summary has the three counts for each of the 50 states and DC, the person-only lines, and the two \"what the system still needs\" lists");
  ok(/Who does it: THE SYSTEM DOES IT\. On the card it reads: Homestead IMPORTANT NOTICE printed in the contract/.test(reviewText) && /Who does it: PERSON ONLY\n/.test(reviewText) && /Who does it: THE SYSTEM CAN SEE IT/.test(reviewText), "the review file says who does each action line");
}

console.log("\n" + (failed ? "❌ " + failed + " FAILED, " + passed + " passed" : "✅ ALL PASS (" + passed + ")"));
process.exit(failed ? 1 : 0);
