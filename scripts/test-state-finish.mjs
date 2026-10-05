// "Finish the state lines" (RES-36): the builder does what a line was missing.
// Runs the real Worker functions (cut out of worker/index.js) against
// data/contract-state-riders-v1.json and data/contract-state-checklist-v1.json,
// and reads the customer page, the PDF template and gm.js as text.
// No network, no production database, writes nothing.
//   node scripts/test-state-finish.mjs
// It checks, on at least one state each:
//   1 placement            2 type rules           3 a separate signed page
//   4 initials             5 blanks filled        6 business facts (settings)
//   7 facts already known  8 one-fact questions   9 subcontractor/supplier list
//   10 sentence beside the message                11 agency document slot
// and: the wording is the official text byte for byte, Florida is unchanged,
// nothing stops a send or a signature, every system tick names who and when.
import { readFileSync, existsSync } from "node:fs";
import { buildComposer, FLORIDA_FIXTURES, goldenView, GOLDEN_DIR } from "./fixtures/contract-compose-harness.mjs";
import { fnSrc } from "./fixtures/d1-shim.mjs";
import { parseStateFile, inputExists, INPUT_DIR, cutRange } from "./official-text-lib.mjs";

const root = new URL("../", import.meta.url);
const workerSrc = readFileSync(new URL("worker/index.js", root), "utf8");
const gm = readFileSync(new URL("gm.js", root), "utf8");
const ios = readFileSync(new URL("ios/App/App/public/gm.js", root), "utf8");
const view = readFileSync(new URL("contract-view.html", root), "utf8");
const tpl = readFileSync(new URL("templates/client-contract-template.html", root), "utf8");
const review = readFileSync(new URL("contract-review.html", root), "utf8");
const migration = readFileSync(new URL("migrations/state_finish.sql", root), "utf8");
const h = await buildComposer(workerSrc);
const riders = JSON.parse(readFileSync(new URL("data/contract-state-riders-v1.json", root), "utf8"));
const sorting = JSON.parse(readFileSync(new URL("data/contract-state-checklist-v1.json", root), "utf8"));
const F = h.fns;

let failed = 0, passed = 0;
function ok(cond, label) { if (cond) { passed++; console.log("PASS  " + label); } else { failed++; console.log("FAIL  " + label); } }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
// One function's source, from a page's inline script or from gm.js: it ends at
// the closing brace that sits at the function's own indentation.
function cut(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) { throw new Error("not found: " + name); }
  const lineStart = src.lastIndexOf("\n", i) + 1, indent = src.slice(lineStart, i).replace(/\S.*$/, "");
  const end = src.indexOf("\n" + indent + "}", i);
  return src.slice(i, end + indent.length + 2);
}
const noticeOf = function (id) { return riders.riders[id.slice(0, 2)].notices.filter(function (n) { return n.id === id; })[0]; };
const NON_FL = riders.states.map(function (s) { return s.code; }).filter(function (c) { return c !== "FL"; });
// A residential job sold at the home in a named state.
function stateFx(code, facts, patch) {
  const out = clone(FLORIDA_FIXTURES["residential-in-home-deposit"]);
  out.flags = Object.assign({}, out.flags, { job_state: code, state_facts: facts || {} });
  Object.keys(patch || {}).forEach(function (k) { out[k] = k === "flags" ? Object.assign({}, out.flags, patch.flags) : patch[k]; });
  return out;
}
async function run(code, facts, patch, sys) {
  const r = await h.compose(stateFx(code, facts, patch));
  return { r: r, comp: r.comp, card: F.contractStateActionCard(r.comp.state, r.comp.checklist, r.c.flags, sys || null), plans: r.comp.state_finish.plans, req: r.comp.state_finish.requires };
}
function line(card, key) { return card.actions.filter(function (a) { return a.key === key; })[0] || null; }
function sec(x, id) { return x.comp.sections.filter(function (s) { return s.id === id; })[0] || null; }
function idx(x, id) { return x.comp.sections.map(function (s) { return s.id; }).indexOf(id); }
const SENT = { status: "sent", company_signed_at: "2026-10-05 19:00:00", sent_at: "2026-10-05 19:30:00", company_signer_name: "Pat Owner", sent_by: "Maria" };
const SIGNED = Object.assign({}, SENT, { status: "completed", first_viewed_at: "2026-10-05 19:45:00", homeowner_signed_at: "2026-10-05 20:12:00", homeowner_signer_name: "Jordan Rivers" });
function frozenOf(x) { const f = {}; x.comp.sections.forEach(function (s) { if (s.system) { f[s.id] = true; } }); return f; }
const WHO = { company: { id: "pat", name: "Pat Owner", role: "client", at: "2026-10-05 19:00:00" }, sent: { id: "maria.s", name: "Maria", role: "seller", at: "2026-10-05 19:30:00" } };
const BIZ_YES = { values: { ins_cgl: "yes", ins_cgl_insurer: "Acme Mutual", ins_cgl_phone: "8005551212", ins_cgl_policy: "GL-77", ins_wc: "no_employees" } };

// ── 1. Placement ──────────────────────────────────────────────────────────
{
  const md = await run("MD", { secured: "yes" }), ut = await run("UT", {}), wi = await run("WI", { waterproof: "yes" });
  ok(idx(md, "MD-security") === 0 && sec(md, "MD-security").place === "first_page" && idx(ut, "UT-cancel") === 0 && idx(md, "L4") === 1,
    "first page: Maryland's security notice and Utah's cancellation statement are the first thing in the contract, before the license line");
  ok(sec(wi, "WI-waterproof-noguarantee").place === "face" && idx(wi, "WI-waterproof-noguarantee") === 0,
    "face of the contract: Wisconsin's no-guarantee statement stands first, apart from the other provisions");
  const ca = await run("CA", { secured: "yes", new_home: "yes" }, { settings: BIZ_YES });
  const dp = sec(ca, "CA-downpayment"), pp = sec(ca, "CA-progress-payments");
  ok(dp && dp.title === "Downpayment" && dp.heading === true && ca.comp.sections[idx(ca, "CA-downpayment") - 1].id.slice(0, 3) === "C04" && idx(ca, "CA-progress-payments") === idx(ca, "CA-downpayment") + 1 && pp.place === "after:C04",
    "named heading: California's down payment statement sits under the heading \"Downpayment\" right after the payment clause, with the progress payment statement after it");
  ok(sec(ca, "CA-cgl-insured").title === "Commercial General Liability Insurance (CGL)" && sec(ca, "CA-7164-lien").title === "Mechanics Lien Warning" && sec(ca, "CA-wc-exempt").title === noticeOf("CA-wc-exempt").format.match(/heading '([^']+)'/)[1],
    "named heading: \"Commercial General Liability Insurance (CGL)\", the workers' compensation heading and \"Mechanics Lien Warning\" are read from the rider data, not typed");
  const arb = await run("CA", {}, { selections: { C14: "C14-B" } });
  ok(arb.comp.sections[idx(arb, "CA-7191") - 1].id === "C14-B" && sec(arb, "CA-7191").title === "ARBITRATION OF DISPUTES", "California: the ARBITRATION OF DISPUTES notice follows the arbitration clause itself");
  const ms = await run("MS", {}, { settings: BIZ_YES }), wa = await run("WA", { installments: "yes" }, { flags: { state_values: { service_charge_pct: "12" } } });
  ok(sec(ms, "MS-insurance").beside_signature === true && sec(ms, "MS-insurance").place === "above_signature" && sec(wa, "WA-cancel").beside_signature === true,
    "above the signature: Mississippi's insurance disclosure and Washington's NOTICE TO BUYER are flagged for the signature area");
  // the customer page and the PDF put them there
  const sigBlock = tpl.slice(tpl.indexOf("var sig = '<div class=\"blk sigblock\">"), tpl.indexOf("blocks.push({ html: sig, kind: \"block\" });"));
  ok(sigBlock.indexOf("sig += spBesideHtml(s)") !== -1 && sigBlock.indexOf("sig += spBesideHtml(s)") < sigBlock.indexOf("sig += '<div class=\"grid\">'"),
    "PDF: a part placed above the signature prints inside the signature block, before the signature lines");
  const actions = view.slice(view.indexOf("function renderActions()"), view.indexOf("function sigTotal()"));
  ok(/h \+= besideHtml\(\);\s+h \+= esignConsentHtml/.test(actions) && /if \(s\.system === true && s\.line\) \{ return spNoticeHtml\(s, passive\); \}/.test(view),
    "customer page: the same part is drawn directly above the consent box and the Sign button");
  ok(/s\.place === "face" \|\| s\.place === "first_page" \? " state-face" : ""/.test(view) && /s\.place === "face" \|\| s\.place === "first_page" \? " state-face" : ""/.test(tpl) && /\.clause\.state-face \{ border: 2px solid/.test(view) && /\.locked\.state-face \{ border: 1\.5pt solid/.test(tpl),
    "customer page and PDF: a first-page or face notice is set apart in its own box");
  ok(/if \(s\.kind === "state_page"\) \{ statePages\.push\(s\); return; \}/.test(tpl) && /kind: "block", startPage: true, keepWithNext: true/.test(cut(tpl, "spPushPage")) && /if \(s\.kind === "state_page"\) \{ h \+= '<\/div>' \+ spPageHtml\(s\)/.test(view),
    "a separate page starts its own page in the PDF and is its own card on the customer page");
  const noArea = await run("CA", {}, { selections: { C04: "" } });
  ok(sec(noArea, "CA-downpayment") && sec(noArea, "CA-downpayment").system === true, "a part that belongs after a clause area still prints when that area is left out of the contract");
}

// ── 2. Type rules ─────────────────────────────────────────────────────────
{
  const ca = await run("CA", { secured: "yes" }, { settings: BIZ_YES }), ms = await run("MS", {}, { settings: BIZ_YES }), ar = await run("AR", {}), ut = await run("UT", {});
  ok(JSON.stringify(sec(ca, "CA-7159.1").emphasis) === JSON.stringify({ bold: true, min_pt: 18 }) && JSON.stringify(sec(ca, "CA-downpayment").emphasis) === JSON.stringify({ bold: true, min_pt: 12 }) &&
    JSON.stringify(sec(ms, "MS-insurance").emphasis) === JSON.stringify({ bold: true, larger: true }) && sec(ar, "AR-lien").emphasis.caps === true && sec(ut, "UT-cancel").emphasis.min_pt === 12,
    "each part carries the type the law states: 18 point bold (California WARNING TO BUYER), 12 point bold, bold and larger than the rest (Mississippi), bold capitals (Arkansas)");
  const emView = new Function(cut(view, "spEmClass") + "\nreturn spEmClass;")(), emTpl = new Function(cut(tpl, "spEm") + "\nreturn spEm;")();
  const s18 = { system: true, emphasis: { bold: true, min_pt: 18 } }, sLarger = { system: true, emphasis: { bold: true, larger: true } }, sCaps = { system: true, emphasis: { bold: true, caps: true } };
  ok(emView(s18) === " sys-em sys-em18" && emTpl(s18) === " sys-em sys-em18" && emView(sLarger) === " sys-em sys-larger" && emTpl(sCaps) === " sys-em sys-caps" && emView({ system: true }) === "" && emView({ emphasis: { bold: true } }) === "",
    "customer page and PDF turn that into classes the same way (and never for a section the system did not print)");
  ok(/\.clause\.sys-em18 p \{ font-size: 24px/.test(view) && /\.locked\.sys-em18 p \{ font-size: 18pt/.test(tpl) && /\.locked\.sys-em12 p \{ font-size: 12pt/.test(tpl) && /\.locked\.sys-em p \{ font-size: 10\.5pt; font-weight: 700/.test(tpl) &&
    /\.clause\.sys-caps p \{ text-transform: uppercase/.test(view) && /\.locked\.sys-caps p \{ text-transform: uppercase/.test(tpl) && /\.locked\.sys-larger p \{ font-size: 12pt/.test(tpl) && /\.clause\.sys-larger p \{ font-size: 17px/.test(view),
    "the PDF prints 18, 12 and 10.5 point bold, capitals, and \"larger than the rest\" (12 point against the body's smaller type); the page uses the matching sizes");
  ok(/em\.min_pt >= 18 \? "18pt" : \(em\.min_pt >= 12 \|\| em\.larger \? "12pt" : "10pt"\)/.test(cut(tpl, "spBesideHtml")), "PDF: a part above the signature keeps its point size and weight there too");
}

// ── 3. A separate page the customer signs and dates ───────────────────────
{
  const no = await run("AK", {}), ak = await run("AK", { big_build: "yes" });
  ok(!sec(no, "AK-defect-notice") && line(no.card, "notice:AK-defect-notice").kind === "person" && no.card.facts.some(function (q) { return q.key === "big_build"; }),
    "Alaska: with no answer the one-year page is not put in front of the customer (a signature is never asked for on a guess); the question is asked and the line stays with a person");
  const pg = sec(ak, "AK-defect-notice");
  ok(pg.kind === "state_page" && pg.sign === true && pg.title === "Notice of Potential Claims Must Be Provided within One Year" && pg.text === noticeOf("AK-defect-notice").text_on_file && JSON.stringify(ak.req.sign) === JSON.stringify(["AK-defect-notice"]),
    "Alaska, Yes: the notice is its own page, titled as the statute titles it, word for word, and the customer's page asks for its own signature");
  const l0 = line(ak.card, "notice:AK-defect-notice");
  ok(l0.kind === "does" && l0.sys.done === false && /^Waiting: printed on its own page\. The customer's link asks for a separate signature on it in the same visit/.test(l0.sys.en) && /^Aguardando: /.test(l0.sys.pt), "before signing the line waits, and says the customer signs it in the same visit");
  // the signature itself
  const rec = F.contractStateDoneApply(ak.r.c.flags, ak.req, { sign: { "AK-defect-notice": "Jordan Rivers", "made-up": "x" } }, "Jordan Rivers", "2026-10-05 20:12:00", "203.0.113.9", "Mozilla/5.0 (iPhone)");
  ok(rec.sign["AK-defect-notice"].name === "Jordan Rivers" && rec.sign["AK-defect-notice"].at === "2026-10-05 20:12:00" && rec.sign["made-up"] === undefined &&
    JSON.stringify(rec.evidence) === JSON.stringify([{ at: "2026-10-05 20:12:00", name: "Jordan Rivers", ip: "203.0.113.9", ua: "Mozilla/5.0 (iPhone)", consent: true }]),
    "the page's signature is recorded with the signer's name, the time, the IP address, the device and the consent; a part the contract does not ask for is ignored");
  ok(F.contractStateDoneApply({ state_done: rec }, ak.req, { sign: { "AK-defect-notice": "Someone Else" } }, "Someone Else", "2026-10-06 10:00:00", null, null) === null, "a page that is signed cannot be signed again");
  const signFn = fnSrc("handlePostPublicContractSign", workerSrc);
  ok(/try \{ await contractStateDoneSave\(env, c, comp, body\.state_parts, signer, signedAt, ip, ua\); \} catch/.test(signFn) && signFn.indexOf("contractStateDoneSave") > signFn.indexOf("UPDATE gm_contracts SET status = 'completed'") &&
    /if \(pubCon\[2\] === "sign" && method === "POST"\) \{ return esignSignWithConsent\(env, request, "contract", pubCon\[1\], handleGetPublicContract, handlePostPublicContractSign\); \}/.test(workerSrc),
    "it is saved inside the contract signature itself: same request, same timestamp, and the same E-SIGN consent record (gm_esign_consents) the contract signature gets");
  ok(/await gmContractEvent\(env, c\.client_id, c\.id, signer, "state_parts_signed", \{ ip: ip, device: gmEstSummarizeUa\(ua\), hash: c\.content_hash/.test(fnSrc("contractStateDoneSave", workerSrc)), "and logged as its own event with the IP, the device and the document hash");
  const signedFlags = Object.assign({}, ak.r.c.flags, { state_done: rec });
  const cardDone = F.contractStateActionCard(ak.comp.state, ak.comp.checklist, signedFlags, { c: SIGNED, frozen: frozenOf(ak), who: WHO });
  const l1 = line(cardDone, "notice:AK-defect-notice");
  ok(l1.sys.done === true && l1.sys.at === "2026-10-05 20:12:00" && l1.sys.who_en === "Done by Jordan Rivers, 10/05/2026 4:12 PM ET" && /^Feito por Jordan Rivers, 10\/05\/2026 4:12 PM ET$/.test(l1.sys.who_pt) && l1.sys.action === "state_part_signed",
    "once signed the line ticks itself and names who and when (month first, 12-hour, Eastern)");
  const pub = F.contractStatePublicParts({ flags: signedFlags }, ak.comp, "https://x/api/public/contracts/tok");
  ok(pub.done.sign["AK-defect-notice"].signer_name === "Jordan Rivers" && !/203\.0\.113\.9|iPhone/.test(JSON.stringify(pub)) && !/203\.0\.113\.9|iPhone/.test(JSON.stringify(F.contractFlagsOut(signedFlags))),
    "the customer's page and the builder get the name and the time; the IP address and the device never leave the server");
  // California: 18 point, separate page
  const ca = await run("CA", { secured: "yes" }, { settings: BIZ_YES });
  ok(sec(ca, "CA-7159.1").kind === "state_page" && sec(ca, "CA-7159.1").sign === true && sec(ca, "CA-7159.1").text === noticeOf("CA-7159.1").text_on_file, "California: WARNING TO BUYER is a separate signed page, word for word");
  // Wisconsin: the statement only, proof kept
  const wi = await run("WI", {});
  ok(sec(wi, "WI-lien-waiver").kind === "state_page" && sec(wi, "WI-lien-waiver").bare === true && sec(wi, "WI-lien-waiver").sign === true && sec(wi, "WI-lien-waiver").text === noticeOf("WI-lien-waiver").text_on_file &&
    /\(s\.bare \? "" : '<div class="sp-page-h">'/.test(cut(tpl, "spPushPage")) && /var rec = s\.bare \? "" : spRecordHtml\(s\);/.test(cut(tpl, "spPushPage")) && /if \(!s\.bare \|\| !s\.sign\) \{ return; \}/.test(tpl),
    "Wisconsin: the lien waiver notice page carries the verbatim statement only; the proof the customer received it prints on the signature page");
  // in duplicate
  const il = await run("IL", { insurance_paid: "yes" }), form = sec(il, "IL-insurance-cancel-form");
  ok(form.kind === "state_page" && form.copies === 2 && /for \(var n = 1; n <= copies; n\+\+\)/.test(cut(tpl, "spPushPage")) && /Copy ' \+ n \+ ' of ' \+ copies/.test(cut(tpl, "spPushPage")),
    "in duplicate: a cancellation form is printed twice in the PDF, each copy labelled");
  ok(/docPdfAfterFinal\(request, env, "contract", token\);/.test(signFn) && /docPdfAfterFinal\(request, env, "contract", token\);/.test(fnSrc("handlePostPublicContractStateParts", workerSrc)),
    "the customer's copy is made by itself: the stored PDF is rebuilt after the signature, and again after a part signed later");
  // customer page: no second link, the page asks for it before the Sign button works
  const signJs = cut(view, "sign");
  ok(/var stateParts = spCollect\(err\);\s+if \(stateParts === false\) \{ return; \}\s+if \(stateParts\) \{ body\.state_parts = stateParts; \}/.test(signJs) && signJs.indexOf("spCollect(err)") < signJs.indexOf("fetch(WORKER_URL"),
    "customer page: the separate signatures go out in the same request as the contract signature (no second link, no extra trip)");
  ok(/Please sign the separate notice above: it has its own signature\./.test(cut(view, "spCollect")) && /onclick="spSign\(/.test(cut(view, "spControlsHtml")) && /Sign this ' \+ \(s\.kind === "state_page" \? "page" : "notice"\)/.test(cut(view, "spControlsHtml")),
    "customer page: each such part has its own name box and its own button (\"Sign this page\"), and the page points to it when it was skipped");
  ok(!/\b(confirm|alert|prompt)\s*\(/.test(view.slice(view.indexOf("// ── State parts (RES-36)"), view.indexOf("function renderMeta()"))), "no browser pop-up in the new customer page code");
}

// ── 4. Initials beside a provision ────────────────────────────────────────
{
  const az = await run("AZ", { new_home: "yes" }), md = await run("MD", { secured: "yes" }), ca = await run("CA", {}, { selections: { C14: "C14-B" } }), oh = await run("OH", {});
  ok(sec(az, "AZ-new-dwelling").initials === true && sec(md, "MD-security").initials === true && sec(ca, "CA-7191").initials === true && JSON.stringify(az.req.initials) === JSON.stringify(["AZ-new-dwelling"]) && JSON.stringify(md.req.initials) === JSON.stringify(["MD-security"]) && ca.req.initials.indexOf("CA-7191") !== -1,
    "Arizona, Maryland and California (arbitration): the provision prints and the customer's page asks for initials beside it");
  ok(JSON.stringify(oh.req.choose) === JSON.stringify([{ id: "OH-estimate-form", options: ["_____ written estimate", "_____ oral estimate", "_____ no estimate"] }]) && sec(oh, "OH-estimate-form").text === noticeOf("OH-estimate-form").text_on_file,
    "Ohio: the estimate form prints word for word and the customer initials ONE of its three choices");
  const rec = F.contractStateDoneApply({}, oh.req, { choose: { "OH-estimate-form": { index: 1, initials: "JR" } } }, "Jordan Rivers", "2026-10-05 20:12:00", "ip", "ua");
  ok(rec.choose["OH-estimate-form"].index === 1 && rec.choose["OH-estimate-form"].initials === "JR" && F.contractStateDoneApply({}, oh.req, { choose: { "OH-estimate-form": { index: 7, initials: "JR" } } }, "J", "t", null, null) === null &&
    F.contractStateDoneApply({}, oh.req, { choose: { "OH-estimate-form": { index: 0, initials: "" } } }, "J", "t", null, null) === null, "the choice and the initials are saved together; a choice that is not on the form, or no initials, saves nothing");
  const recMd = F.contractStateDoneApply({}, md.req, { initials: { "MD-security": "JR" } }, "Jordan Rivers", "2026-10-05 20:12:00", "ip", "ua");
  const cardMd = F.contractStateActionCard(md.comp.state, md.comp.checklist, Object.assign({}, md.r.c.flags, { state_done: recMd }), { c: SIGNED, frozen: frozenOf(md), who: WHO });
  ok(line(md.card, "notice:MD-security").sys.done === false && /asks for initials on it in the same visit/.test(line(md.card, "notice:MD-security").sys.en) && line(cardMd, "notice:MD-security").sys.done === true && /^Printed on the first page\. The customer completed it 10\/05\/2026 4:12 PM ET/.test(line(cardMd, "notice:MD-security").sys.en),
    "Maryland: the line waits for the initials, then ticks itself with the time");
  const chosen = new Function("flowText", "spDone", "con", "fmtDate", "escHtml", "richHtml", "var curPart = null;\n" + cut(view, "spTextHtml") + "\nreturn spTextHtml;")(function (t) { return t; }, function (k) { return k === "choose" ? { index: 1, initials: "JR" } : null; }, {}, String, String, function (t) { return t; });
  ok(/\n\{state_part_initials\} oral estimate\n_____ no estimate$/.test(chosen({ id: "OH-estimate-form", text: noticeOf("OH-estimate-form").text_on_file, choose: ["_____ written estimate", "_____ oral estimate", "_____ no estimate"] })),
    "customer page: the initials land in the blank of the choice the customer picked; the other blanks stay as printed");
  ok(/Please type your initials beside the provision above\./.test(cut(view, "spCollect")) && /Please pick one choice above and type your initials\./.test(cut(view, "spCollect")) && /initials beside this provision/.test(cut(tpl, "spRecordHtml")), "customer page asks for them before signing; the PDF prints them beside the provision");
}

// ── 5. Blanks filled by the system ────────────────────────────────────────
{
  const il = await run("IL", { insurance_paid: "yes" }), form = sec(il, "IL-insurance-cancel-form").text, src = noticeOf("IL-insurance-cancel-form").text_on_file;
  ok(form === src.split("(name of contractor)").join("Sunrise Pools LLC").split("(address of contractor's place of business)").join("100 Bay St, Tampa, FL 33602") && form.indexOf("(name of contractor)") === -1,
    "Illinois: the cancellation form carries the seller's name and address; every other character is the statute's");
  const nc = await run("NC", { credit: "yes" }), ncT = await h.compose(stateFx("NC", { credit: "yes" }), "template");
  const liveForm = sec(nc, "NC-cancel-credit-form").text, tplForm = ncT.comp.sections.filter(function (s) { return s.id === "NC-cancel-credit-form"; })[0].text;
  ok(/\n Date of your signature\n/.test(liveForm) && /not later than midnight of the third business day after Owner signs\n/.test(liveForm) && /\n \{transaction_date\}\n/.test(tplForm) && /not later than midnight of \{cancellation_deadline_date\}\n/.test(tplForm),
    "North Carolina: the transaction date and the cancellation deadline are the ones the builder already computes (clean words before signing, {tokens} in the text the company signs)");
  ok(F.contractFillSigningTime(tplForm, { transaction_date: "10/05/2026", cancellation_deadline_date: "10/08/2026" }, false).indexOf("\n 10/05/2026\n") !== -1 && F.contractFillSigningTime(tplForm, { transaction_date: "10/05/2026", cancellation_deadline_date: "10/08/2026" }, false).indexOf("midnight of 10/08/2026\n") !== -1,
    "and at signing they become the real dates, month first (10/05/2026, 10/08/2026)");
  const ca = await h.compose(stateFx("CA", { disaster: "yes" }, { settings: BIZ_YES }), "signed");
  const v7 = {}; F.contractSigningTimeVars(v7, { transaction_date: "2026-10-05" }, "signed");
  ok(v7.state_deadline_7 === "10/14/2026" && /not later than midnight of \{state_deadline_7\}\./.test((await h.compose(stateFx("CA", { disaster: "yes" }, { settings: BIZ_YES }), "template")).comp.sections.filter(function (s) { return s.id === "CA-7day-form"; })[0].text),
    "California disaster repair: the form's deadline is the seventh business day after signing (10/05/2026 -> 10/14/2026, Columbus Day skipped), computed by the same counter");
  // missing data: the line waits and names the field
  const noAddr = await run("IL", { insurance_paid: "yes" }, { doc: { address: "" } }), lw = line(noAddr.card, "notice:IL-insurance-cancel");
  ok(!sec(noAddr, "IL-insurance-cancel-form") && !sec(noAddr, "IL-insurance-cancel") && lw.kind === "does" && lw.sys.done === false && lw.sys.en === "Waiting: add your business address (document settings). The system fills the blank as soon as it is saved." && /^Aguardando: informe o endereço da empresa \(configurações dos documentos\)\./.test(lw.sys.pt),
    "data missing: nothing prints with a hole in it; the line reads \"Waiting: add your business address (document settings)\" in both languages");
  // per-contract values
  const wy0 = await run("WY", {}), wy1 = await run("WY", {}, { flags: { state_values: { work_description: "Paver patio", property_description: "Single-family home", legal_description: "Lot 4, Block 2, Sunrise Estates" } } });
  ok(!sec(wy0, "WY-lien") && /^Waiting: add "Materials provided or work performed" \(asked on this card\); /.test(line(wy0.card, "notice:WY-lien").sys.en) && JSON.stringify(wy0.card.values.map(function (q) { return q.key; })) === JSON.stringify(["legal_description", "property_description", "work_description"]) && wy0.card.values.every(function (q) { return q.en && q.pt && q.en !== q.pt; }),
    "Wyoming: the three values Apex does not keep are asked on the card, each named in the waiting line");
  const wyT = sec(wy1, "WY-lien").text;
  ok(/and contact person:\nSunrise Pools LLC\n100 Bay St, Tampa, FL 33602\n\(813\) 555-0100, Pat Owner\n/.test(wyT) && /LEGAL DESCRIPTION:\nLot 4, Block 2, Sunrise Estates\n/.test(wyT) && /SIGNED: \{state_part_company_signature\}/.test(wyT) && sec(wy1, "WY-lien-waiver").text === noticeOf("WY-lien-waiver").text_on_file && wy1.card.values.filter(function (q) { return q.key === "legal_description"; })[0].value === "Lot 4, Block 2, Sunrise Estates",
    "Wyoming: once answered, the NOTICE TO OWNER is filled in (seller, work, property, legal description, the company's signature) and the blank lien waiver form rides with it untouched");
  const put = fnSrc("handlePutGmContract", workerSrc);
  ok(/if \(!askDefs\[k\]\) \{ return; \}/.test(put) && /flags\.state_values = valuesNow;/.test(put) && put.indexOf("flags.state_values = valuesNow") < put.indexOf("UPDATE gm_contracts SET selections_json"), "those answers are saved in the contract's own flags (no new column), and only for a value the data file names");
  // every blank-filled part, in every state: nothing but the named blank changes
  let bad = [], checked = 0, fileBad = [], fileChecked = 0, noUrl = [];
  const haveInput = inputExists(), parsed = {};
  for (const code of NON_FL) {
    const lines = (sorting.states[code] || {}).lines || {};
    Object.keys(lines).forEach(function (k) {
      (lines[k].parts || []).forEach(function (p) {
        const n = noticeOf(p.n), src = n.text_on_file;
        const out = F.contractStatePartText(n, p, { business_legal_name: "NAME", business_address: "ADDR", business_phone: "PHONE", business_email: "EMAIL", property_address: "PROP", company_signer_name: "SIGNER", biz_cgl_insurer: "INS", biz_cgl_phone: "INSPHONE", biz_cgl_policy: "POL", sv_service_charge_pct: "12", sv_work_description: "W", sv_property_description: "P", sv_legal_description: "L" });
        checked++;
        if (!(p.fill || []).length) { if (out.text !== src) { bad.push(p.n); } }
        else {
          let marked = src;
          p.fill.forEach(function (f) { marked = f[2] === "re" ? marked.replace(new RegExp(f[0], "g"), "\u0000") : marked.split(f[0]).join("\u0000"); });
          let at = 0;
          marked.split("\u0000").forEach(function (frag) { const i = out.text.indexOf(frag, at); if (i < 0) { bad.push(p.n + " (text outside a blank changed)"); } else { at = i + frag.length; } });
          if (out.missing.length || /\{(?!state_part_|transaction_date|cancellation_deadline_date|state_deadline_7)[a-z0-9_]+\}/.test(out.text)) { bad.push(p.n + " (a blank was left)"); }
        }
        if (n.source_status !== "VERBATIM-OFFICIAL" || n.hold_reason) { bad.push(p.n + " (not official)"); }
        if (!/^https:\/\//.test(n.source_url || "")) { noUrl.push(p.n); }
        if (haveInput && n.range) {
          parsed[code] = parsed[code] || parseStateFile(code);
          fileChecked++;
          const blk = parsed[code].blocks.filter(function (b) { return b.heading === n.range.block && b.index === n.range.block_index; })[0];
          const c = blk ? cutRange(blk.text, n.range) : { error: "block not found" };
          if (c.error || c.text !== src) { fileBad.push(p.n); }
        }
      });
    });
  }
  ok(checked >= 45 && bad.length === 0, "all states: " + checked + " parts checked. A part with no blank is byte-identical to the official wording on file; in a part with blanks every character outside the named blanks is the statute's, in order, and no blank is left" + (bad.length ? " (" + bad.join(", ") + ")" : ""));
  if (noUrl.length) { console.log("NOTICE  the rider data gives no full web address for the official source of: " + noUrl.join(", ") + " (the status is VERBATIM-OFFICIAL; the address field is shortened in the data file)"); }
  if (!haveInput) { console.log("NOTICE  input folder " + INPUT_DIR + " not found: the byte-exact check against the official-text files is skipped"); }
  else { ok(fileChecked > 0 && fileBad.length === 0, "the wording on file for each of them is byte-identical to the text cut out of the official-text file again by the same script (" + fileChecked + " checked)" + (fileBad.length ? " (" + fileBad.join(", ") + ")" : "")); }
  const gen = readFileSync(new URL("scripts/make-state-checklist-data.mjs", root), "utf8");
  ok(/if \(!text \|\| n\.source_status !== "VERBATIM-OFFICIAL" \|\| n\.hold_reason\) \{ throw new Error/.test(gen) && /if \(!hit\) \{ throw new Error\("FIN: blank not found in "/.test(gen) && !/text_on_file\s*[:=]\s*["'`]/.test(gen),
    "the data script refuses a part that is not an official verbatim copy, and a blank that is not really in the wording; it holds no notice wording of its own");
}

// ── 6. Business facts, asked once in the settings ─────────────────────────
{
  const none = await run("CA", {}), l0 = line(none.card, "notice:CA-cgl-none");
  ok(!none.comp.sections.some(function (s) { return /^CA-(cgl|wc)-/.test(s.id); }) && l0.kind === "does" && l0.sys.done === false && l0.sys.en === "Waiting: answer \"Does your business carry commercial general liability insurance?\" in the contract settings. The statement that is true for your business then prints by itself." && /^Aguardando: responda "A sua empresa tem seguro de responsabilidade civil geral \(CGL\)\?"/.test(l0.sys.pt),
    "California, not answered yet: no insurance statement prints (never a guess) and the line says which question to answer in the settings");
  const want = { yes: "CA-cgl-insured", no: "CA-cgl-none", self: "CA-cgl-self", llc: "CA-cgl-llc" };
  let okAll = true;
  for (const v of Object.keys(want)) {
    const x = await run("CA", {}, { settings: { values: { ins_cgl: v, ins_cgl_insurer: "Acme Mutual", ins_cgl_phone: "8005551212", ins_wc: "yes" } } });
    const printed = x.comp.sections.filter(function (s) { return /^CA-cgl-/.test(s.id); }).map(function (s) { return s.id; });
    if (JSON.stringify(printed) !== JSON.stringify([want[v]]) || !/^Sunrise Pools LLC /.test(sec(x, want[v]).text) || !sec(x, "CA-wc-carries") || sec(x, "CA-wc-exempt")) { okAll = false; }
  }
  ok(okAll, "California: exactly the statement that is true for the business prints (carries insurance, does not, self-insured, LLC), starting with the business's own name; \"carries workers' compensation\" prints the carries statement");
  const ins = await run("CA", {}, { settings: BIZ_YES });
  ok(sec(ins, "CA-cgl-insured").text === "Sunrise Pools LLC carries commercial general liability insurance written by Acme Mutual. You may call Acme Mutual at (800) 555-1212 to check the contractor’s insurance coverage." && sec(ins, "CA-wc-exempt").text === "Sunrise Pools LLC has no employees and is exempt from workers’ compensation requirements.",
    "the insurer's name and telephone come from the settings: \"... written by Acme Mutual. You may call Acme Mutual at (800) 555-1212 ...\"");
  const noPhone = await run("CA", {}, { settings: { values: { ins_cgl: "yes", ins_cgl_insurer: "Acme Mutual", ins_wc: "yes" } } });
  ok(!sec(noPhone, "CA-cgl-insured") && /^Waiting: add your insurance company's phone \(contract settings\)\./.test(line(noPhone.card, "notice:CA-cgl-none").sys.en), "insurer's phone missing: the statement waits and names that field");
  const wcNo = await run("CA", {}, { settings: { values: { ins_cgl: "no", ins_wc: "no" } } });
  ok(line(wcNo.card, "notice:CA-wc-exempt").kind === "person" && !wcNo.comp.sections.some(function (s) { return /^CA-wc-/.test(s.id); }), "employees and no workers' compensation: the statute has no statement for that, so nothing prints and the line stays with a person");
  const msYes = await run("MS", {}, { settings: BIZ_YES }), msNo = await run("MS", {}, { settings: { values: { ins_cgl: "no" } } });
  ok(/The name of the insurer is Acme Mutual, and the policy number is GL-77\./.test(sec(msYes, "MS-insurance").text) && line(msYes.card, "notice:MS-insurance").kind === "does" && !sec(msNo, "MS-insurance") && line(msNo.card, "notice:MS-insurance").kind === "person",
    "Mississippi: \"I DO carry\" prints, with the insurer and policy number, only for a business that carries it; otherwise nothing official exists and the line stays with a person");
  const b = sorting.biz_facts;
  ok(JSON.stringify(Object.keys(b)) === JSON.stringify(["cgl", "wc"]) && b.cgl.key === "ins_cgl" && b.wc.key === "ins_wc" && JSON.stringify(b.wc.options.map(function (o) { return o.v; })) === JSON.stringify(["yes", "no", "no_employees"]) &&
    Object.keys(b).every(function (k) { return b[k].en && b[k].pt && b[k].options.every(function (o) { return o.en && o.pt; }) && b[k].extra.every(function (x) { return x.en && x.pt && x.en !== x.pt; }); }),
    "the two questions (liability insurance; workers' compensation: yes, no, or no employees) and their details have English and Portuguese wording");
  const html = cut(gm, "gmConBizFactsHtml");
  ok(/state_biz: contractStateBizDefs\(\),/.test(fnSrc("handleGetContractSettings", workerSrc)) && /h \+= gmConBizFactsHtml\(d, S\);/.test(cut(gm, "gmConSettingsHtml")) && /gmConDraft\.values\[/.test(html) && !/gmConBizFactsHtml/.test(cut(gm, "gmRenderContractSheet")),
    "they are asked in the contract settings (saved with the other standard values), never on a contract");
  ok(F.contractStateBiz({ values: { ins_cgl: "maybe", ins_wc: "no_employees" } }).cgl === null && F.contractStateBiz({ values: { ins_cgl: "maybe", ins_wc: "no_employees" } }).wc === "no_employees" && F.contractStateBiz(null).cgl === null, "an answer that is not one of the choices counts as not answered");
}

// ── 7. Facts the builder already has ──────────────────────────────────────
{
  const one = await run("CA", {}, { schedule: [{ label: "On completion", pct: 100 }] }), two = await run("CA", {}, { schedule: [{ label: "Deposit", pct: 10 }, { label: "On completion", pct: 90 }] }), three = await run("CA", {});
  ok(!sec(one, "CA-downpayment") && !sec(one, "CA-progress-payments") && line(one.card, "notice:CA-downpayment") === null && sec(two, "CA-downpayment") && !sec(two, "CA-progress-payments") && sec(three, "CA-downpayment") && sec(three, "CA-progress-payments"),
    "California: the down payment and progress payment statements follow the contract's own payment schedule (one payment: neither; deposit and final: down payment only; three or more: both)");
  ok(!one.card.facts.some(function (q) { return q.key === "deposit" || q.key === "progress"; }) && !three.card.facts.some(function (q) { return q.key === "deposit" || q.key === "progress"; }) && one.comp.state.facts.deposit.known === true && one.comp.state.facts.small_repair.known === true && one.comp.state.facts.small_repair.answer === "no" &&
    !three.card.facts.some(function (q) { return q.key === "small_repair" && !q.known; }) && line(three.card, "notice:CA-7159.10") === null,
    "none of that is asked; a $12,500.00 job is not asked whether it is a $750.00 repair (the price answers it)");
  const small = await run("CA", {}, { amount_cents: 60000, schedule: [{ label: "On completion", pct: 100 }] });
  ok(small.card.facts.some(function (q) { return q.key === "small_repair" && q.known === false; }), "a $600.00 job IS asked, because there the answer changes something");
  const subs = await run("CA", {}, { parties: { subs: [{ name: "Gulf Plumbing" }], suppliers: [] } }), noSubs = await run("CA", {});
  ok(sec(subs, "CA-subs-disclaimer") && sec(subs, "CA-subs-disclaimer").text === noticeOf("CA-subs-disclaimer").text_on_file && subs.card.facts.filter(function (q) { return q.key === "subs"; })[0].known === true && !sec(noSubs, "CA-subs-disclaimer") && noSubs.card.facts.filter(function (q) { return q.key === "subs"; })[0].known === false,
    "whether a subcontractor is used comes from the project: one assigned prints California's statement without asking; none assigned asks, and prints only after a Yes (the statement must be true)");
  const sup = await run("TX", {}, { parties: { subs: [], suppliers: [{ name: "Bay Stone Supply", address: "1 Quarry Rd", phone: "8135550199" }] } });
  ok(sup.comp.state.facts.subs.known === true && sup.comp.state.facts.subs.answer === "yes", "a supplier on the project answers \"subcontractors or suppliers?\" too");
  const many = await run("WA", {}, { schedule: [{ label: "1", pct: 20 }, { label: "2", pct: 20 }, { label: "3", pct: 20 }, { label: "4", pct: 20 }, { label: "5", pct: 20 }] });
  ok(many.comp.state.facts.installments.known === true && many.comp.state.facts.installments.answer === "yes" && many.card.facts.filter(function (q) { return q.key === "installments"; })[0].known === true, "Washington: five payments on the schedule is more than four installments; shown as already known, not asked");
  const cos = F.contractStateCoStatements({ job_state: "CA", state_facts: {} }, 1), cosNone = F.contractStateCoStatements({ job_state: "CA", state_facts: {} }, 0), cosFl = F.contractStateCoStatements({ job_state: "FL" }, 3);
  ok(cos.length === 1 && cos[0].text === noticeOf("CA-subs-disclaimer").text_on_file && cosNone.length === 0 && cosFl.length === 0 && /state_statements: stateStatements,/.test(fnSrc("coPublicPayload", workerSrc)) &&
    /\(con\.state_statements \|\| \[\]\)\.forEach/.test(readFileSync(new URL("change-order-view.html", root), "utf8")) && /\(con\.state_statements \|\| \[\]\)\.forEach/.test(readFileSync(new URL("templates/client-change-order-template.html", root), "utf8")),
    "California: the same subcontractor statement goes on each change order of that contract (page and PDF), word for word; never in Florida");
}

// ── 8. One-fact questions, only where the answer changes something ────────
{
  const NEW = ["new_home", "disaster", "small_repair", "installments", "roof_insurance", "lien_consent", "waterproof"];
  ok(NEW.every(function (k) { const q = sorting.facts[k]; return q && /\?$/.test(q.en) && /\?$/.test(q.pt) && q.en !== q.pt; }), "the new questions each have an English and a Portuguese wording: " + NEW.join(", "));
  const usedBy = {};
  Object.keys(sorting.states).forEach(function (code) { Object.keys(sorting.states[code].lines).forEach(function (k) { const f = sorting.states[code].lines[k].fact; if (f) { (usedBy[f] = usedBy[f] || []).push(code); } }); });
  ok(Object.keys(sorting.facts).filter(function (k) { return sorting.facts[k].en; }).every(function (k) { return k === "sale_english" || (usedBy[k] || []).length > 0; }) && JSON.stringify(usedBy.installments) === JSON.stringify(["WA"]) && JSON.stringify(usedBy.waterproof) === JSON.stringify(["WI"]) && JSON.stringify(usedBy.lien_consent) === JSON.stringify(["MO"]) && JSON.stringify(usedBy.roof_insurance) === JSON.stringify(["MN"]),
    "every question belongs to at least one state's line (installments: Washington only; basement waterproofing: Wisconsin only; lien consent: Missouri only; insurance-paid roofing: Minnesota only)");
  let leak = [];
  for (const code of NON_FL) {
    const x = await run(code, {});
    x.card.facts.forEach(function (q) { if (q.key !== "sale_english" && (usedBy[q.key] || []).indexOf(code) === -1) { leak.push(code + ":" + q.key); } });
  }
  ok(leak.length === 0, "in all 50 states and DC a question is asked only in a state where a line depends on it" + (leak.length ? " (" + leak.join(", ") + ")" : ""));
  const co = await run("CO", {});
  ok(!co.card.facts.some(function (q) { return NEW.indexOf(q.key) !== -1; }), "Colorado has no such line, so it asks none of them");
  const wi = await run("WI", {}), wiYes = await run("WI", { waterproof: "yes" }), wiUnsure = await run("WI", { waterproof: "unsure" }), wiNo = await run("WI", { waterproof: "no" });
  ok(!sec(wi, "WI-waterproof-noguarantee") && !sec(wiUnsure, "WI-waterproof-noguarantee") && sec(wiYes, "WI-waterproof-noguarantee").text === noticeOf("WI-waterproof-noguarantee").text_on_file && line(wiUnsure.card, "notice:WI-waterproof-noguarantee").kind === "person" && line(wiNo.card, "notice:WI-waterproof-noguarantee") === null,
    "Wisconsin basement waterproofing: Yes prints the no-guarantee statement; Not sure or no answer prints nothing and leaves the line with a person (a statement of fact is never printed on a guess); No takes the line off the card");
  const mo = await run("MO", { lien_consent: "yes" }), ri = await run("RI", { age62: "yes" }), mn = await run("MN", { roof_insurance: "yes" });
  ok(sec(mo, "MO-consent").sign === true && sec(mo, "MO-consent").kind === "state_notice" && sec(ri, "RI-62").kind === "state_page" && sec(ri, "RI-62").title === "Notice of Cancellation" && sec(ri, "RI-62").date_above === true && /All cancellations must be mailed to:\n\nSunrise Pools LLC, 100 Bay St, Tampa, FL 33602\.$/.test(sec(ri, "RI-62").text) && sec(mn, "MN-roofing-cancel-form").copies === 2,
    "Missouri (owner's consent, signed on its own), Rhode Island (age 62 notice with the seller's name and address) and Minnesota (insurance-paid roofing form in two copies) each follow their one answer");
}

// ── 9. The subcontractor and supplier list ────────────────────────────────
{
  const none = await run("TX", { subs: "yes" });
  ok(line(none.card, "notice:TX-sublist").kind === "does" && line(none.card, "notice:TX-sublist").sys.en === "Waiting: add this job's subcontractors and suppliers to the project (name, address and telephone). The system builds the list from them.",
    "Texas, nobody on the project yet: the list line waits for the project's records");
  const partial = { subs: [{ name: "Gulf Plumbing", trade: "Plumbing", license_number: "M-1", address: "", phone: "5125550101" }], suppliers: [{ name: "Bay Stone Supply", supplies: "Pavers", address: "1 Quarry Rd, Austin, TX", phone: "" }] };
  const half = await run("TX", {}, { parties: partial });
  ok(line(half.card, "notice:TX-sublist").sys.en === "Waiting: add the address of Gulf Plumbing; the telephone of Bay Stone Supply in the project." && /^Aguardando: informe o endereço de Gulf Plumbing; o telefone de Bay Stone Supply no projeto\.$/.test(line(half.card, "notice:TX-sublist").sys.pt),
    "a name without its address or telephone: the line names exactly which field of which company is missing");
  const full = { subs: [{ name: "Gulf Plumbing", trade: "Plumbing", license_number: "M-1", address: "9 Pipe Rd, Austin, TX 78701", phone: "5125550101" }], suppliers: [{ name: "Bay Stone Supply", supplies: "Pavers", address: "1 Quarry Rd, Austin, TX", phone: "5125550199" }] };
  const okx = await run("TX", {}, { parties: full });
  const pub = F.contractStatePublicParts({ flags: okx.r.c.flags }, okx.comp, "https://x/t");
  ok(pub.list.rows.length === 2 && pub.list.complete === true && JSON.stringify(pub.list.rows[0]) === JSON.stringify({ kind: "subcontractor", name: "Gulf Plumbing", trade: "Plumbing", license: "M-1", address: "9 Pipe Rd, Austin, TX 78701", phone: "5125550101" }) && pub.list.rows[1].kind === "supplier" &&
    pub.list.notice.text === noticeOf("TX-sublist").text_on_file && JSON.stringify(pub.list.notice.emphasis) === JSON.stringify({ bold: true, min_pt: 10 }),
    "the list is built from the project: each name, address and telephone, with Texas's NOTICE under it word for word, in 10 point bold");
  const waitSend = line(okx.card, "notice:TX-sublist"), sentCard = F.contractStateActionCard(okx.comp.state, okx.comp.checklist, okx.r.c.flags, { c: SENT, frozen: frozenOf(okx), who: WHO });
  ok(waitSend.sys.done === false && /^The system will do this when you send the contract: the list rides on the customer's contract link/.test(waitSend.sys.en) && line(sentCard, "notice:TX-sublist").sys.done === true && line(sentCard, "notice:TX-sublist").sys.who_en === "Sent by Maria, 10/05/2026 3:30 PM ET" && /The list \(2 names\) is on the customer's contract link/.test(line(sentCard, "notice:TX-sublist").sys.en),
    "delivered with the contract: the line ticks itself when the contract is sent, naming who sent it and when");
  const later = await run("TX", {}, { parties: { subs: full.subs, suppliers: full.suppliers.concat([{ name: "New Tile Co", address: "", phone: "" }]) } });
  const laterPub = F.contractStatePublicParts({ flags: later.r.c.flags }, later.comp, "https://x/t"), laterCard = F.contractStateActionCard(later.comp.state, later.comp.checklist, later.r.c.flags, { c: SENT, frozen: frozenOf(later), who: WHO });
  ok(laterPub.list.rows.length === 3 && laterPub.list.complete === false && line(laterCard, "notice:TX-sublist").sys.done === false && /the address of New Tile Co; the telephone of New Tile Co/.test(line(laterCard, "notice:TX-sublist").sys.en),
    "it follows the project: a supplier added later shows on the customer's link at once, and the line goes back to waiting until its address and telephone are in");
  ok(/await contractStateSysStampJob\(env, id, jobId\);/.test(fnSrc("handlePostGmJobSupplier", workerSrc)) && (fnSrc("handlePostGmJobSubcontractor", workerSrc).match(/await contractStateSysStampJob\(env, id, jobId\);/g) || []).length === 2 && /contractStateSysStampJob\(env, id, subJobs\[sj\]\.job_id\)/.test(fnSrc("handlePutGmSubcontractor", workerSrc)),
    "adding, changing or removing a subcontractor or supplier re-reads the system lines of the project's contracts (who and when are saved again)");
  const id = await run("ID", {}, { parties: full }), nv = await run("NV", {}, { parties: full });
  ok(line(id.card, "item:2").kind === "does" && F.contractStatePublicParts({ flags: {} }, id.comp, "x").list.notice === null && line(nv.card, "notice:NV-sub-list").kind === "does", "Idaho and Nevada: the same list (their statutes prescribe no notice wording, so none is printed under it)");
  // database: adds only, and every read tolerates the migration not having run
  ok(/ALTER TABLE gm_subcontractors ADD COLUMN address TEXT;/.test(migration) && /ALTER TABLE gm_subcontractors ADD COLUMN phone TEXT;/.test(migration) && /CREATE TABLE IF NOT EXISTS gm_job_suppliers/.test(migration) && !/\b(DROP|DELETE|UPDATE|RENAME)\b/i.test(migration.replace(/^--.*$/gm, "")),
    "migrations/state_finish.sql only adds: two columns on gm_subcontractors and the table gm_job_suppliers");
  const parties = fnSrc("contractJobParties", workerSrc);
  ok(/SELECT s\.\*, js\.created_at AS assigned_at FROM gm_job_subcontractors/.test(parties) && (parties.match(/\} catch \(e[12]\)/g) || []).length === 2 && /catch \(eT\) \{ return jsonOk\(\{ suppliers: \[\], ready: false \}\); \}/.test(fnSrc("handleGetGmJobSuppliers", workerSrc)) && /no such table/.test(fnSrc("handlePostGmJobSupplier", workerSrc)) && /!\(await contractSubContactReady\(env\)\)/.test(fnSrc("handlePutGmSubcontractor", workerSrc)),
    "before the migration runs: the list reads subcontractors with SELECT * (no address yet) and an empty supplier list; saving an address or a supplier answers \"not available yet\" instead of failing");
  ok(/row\(gmT\("Endere\\u00e7o", "Address"\), s\.address/.test(cut(gm, "gmDSubOpen")) && /gmDSuppliersHtml\(jobId\)/.test(cut(gm, "gmDRenderJobSubs")) && /if \(!d \|\| d\.ready === false\) \{ return ""; \}/.test(cut(gm, "gmDSuppliersHtml")) && /gmAsk\(\{/.test(cut(gm, "gmDSupplierRemove")) && /keep: gmT\("Manter no projeto", "Keep on the project"\)/.test(cut(gm, "gmDSupplierRemove")),
    "project screen: a subcontractor has an address and a telephone, the project has a Suppliers section (hidden until the table exists), and removing one asks in-page with buttons that say what they do");
}

// ── 10. The sentence beside the message (Connecticut) ─────────────────────
{
  const ct = await run("CT", {}), note = F.contractStateMessageNote(ct.comp), fl = await h.compose(clone(FLORIDA_FIXTURES["residential-in-home-deposit"]));
  ok(note === noticeOf("CT-email-sentence").text_on_file && F.contractStateMessageNote(fl.comp) === "" && F.contractStateMessageNote((await run("TX", {})).comp) === "",
    "Connecticut: the sentence that goes beside the message is the statute's, byte for byte; no other state and never Florida");
  const ctShop = await run("CT", {}, { flags: { sold_in_home: false } });
  ok(F.contractStateMessageNote(ctShop.comp) === "" && line(ctShop.card, "notice:CT-email-sentence") === null && !ctShop.card.more.some(function (m) { return m.key === "notice:CT-email-sentence"; }),
    "a Connecticut contract not sold at the customer's home has no Notice of Cancellation, so the sentence about it is not added and the line is not on the card");
  const send = fnSrc("handlePostGmContractSend", workerSrc);
  ok(/var besideMsg = contractStateMessageNote\(comp\);\s+if \(besideMsg\) \{ msg = msg \+ "\\n\\n" \+ besideMsg; \}/.test(send) && /"state_delivered", \{ message_note: !!besideMsg, slots: sentSlots, actor_id: contractActorRecord\(user\)\.id, actor_role: contractActorRecord\(user\)\.role \}/.test(send),
    "the Send step puts it on its own lines right under the message, and records that it went out, by whom");
  const l0 = line(ct.card, "notice:CT-email-sentence");
  const old = F.contractStateActionCard(ct.comp.state, ct.comp.checklist, ct.r.c.flags, { c: SENT, frozen: frozenOf(ct), who: WHO });
  const now = F.contractStateActionCard(ct.comp.state, ct.comp.checklist, ct.r.c.flags, { c: SENT, frozen: frozenOf(ct), who: WHO, delivery: { message_note_at: "2026-10-05 19:30:00", slots: {}, by: WHO.sent } });
  ok(l0.kind === "does" && l0.sys.done === false && /^The system will do this when you send the contract: the required sentence goes beside the message\.$/.test(l0.sys.en) && line(old, "notice:CT-email-sentence").sys.done === false && /^Waiting: this contract was sent before the system added the sentence/.test(line(old, "notice:CT-email-sentence").sys.en) &&
    line(now, "notice:CT-email-sentence").sys.done === true && line(now, "notice:CT-email-sentence").sys.who_en === "Sent by Maria, 10/05/2026 3:30 PM ET",
    "the line ticks only from that record: a contract sent before this build never claims the sentence went with it");
}

// ── 11. An agency document delivered with the contract ────────────────────
{
  const slots = F.contractStateSlotList().map(function (s) { return s.slot; }).sort();
  ok(["DE-ag-summary", "IL-pamphlet", "VA-dpor", "WI-brochure", "OR-lien", "OR-ccb", "WA-lien-info"].every(function (s) { return slots.indexOf(s) !== -1; }), "a slot exists for Delaware, Illinois, Virginia, Wisconsin, Oregon and Washington (and for every other line that hands over an agency's own file): " + slots.join(", "));
  const de = await run("DE", {}), l0 = line(de.card, "notice:DE-ag-summary");
  ok(l0.kind === "person" && !l0.sys && l0.staff_en === "Waiting: official document not loaded" && l0.staff_pt === "Aguardando: documento oficial não carregado" && l0.staff_slot === "DE-ag-summary" && F.contractStatePublicParts({ flags: {} }, de.comp, "x") === null,
    "file not loaded: the line stays a person line, nothing is shown to the customer, and the card carries \"Waiting: official document not loaded\"");
  const stripped = F.contractStateCardFor(clone(de.card), false), kept = F.contractStateCardFor(clone(de.card), true);
  ok(!line(stripped, "notice:DE-ag-summary").staff_en && !/official document not loaded/.test(JSON.stringify(stripped)) && line(kept, "notice:DE-ag-summary").staff_en && /contractStateCardFor\(contractStateActionCard\(.*\), !!\(user && \(isAdminRole\(user\) \|\| contractIsReviewer\(user\)\)\)\)/.test(fnSrc("contractInternalOut", workerSrc)),
    "that note reaches Apex staff only: the contractor's own card does not carry it");
  const loaded = { slots: { "DE-ag-summary": { key: "contracts/admin/statedoc-deagsummary-1.pdf", version: "Revised 10/31/2023" } } };
  const de2 = await run("DE", {}, loaded), pub = F.contractStatePublicParts({ flags: {} }, de2.comp, "https://x/api/public/contracts/tok");
  ok(line(de2.card, "notice:DE-ag-summary").kind === "does" && /^The system will do this when you send the contract: the agency's own document is shown to the customer before they sign\.$/.test(line(de2.card, "notice:DE-ag-summary").sys.en) && pub.docs.length === 1 && pub.docs[0].url === "https://x/api/public/contracts/tok/state-doc/DE-ag-summary" && pub.docs[0].version === "Revised 10/31/2023" && pub.docs[0].ack === false,
    "file loaded: the line is the system's, and the customer's page gets a link to the agency's own file with its version");
  const sentNoRec = F.contractStateActionCard(de2.comp.state, de2.comp.checklist, de2.r.c.flags, { c: SENT, frozen: frozenOf(de2), who: WHO });
  const sentRec = F.contractStateActionCard(de2.comp.state, de2.comp.checklist, de2.r.c.flags, { c: SENT, frozen: frozenOf(de2), who: WHO, delivery: { message_note_at: null, slots: { "DE-ag-summary": "2026-10-05 19:30:00" }, by: WHO.sent } });
  ok(line(sentNoRec, "notice:DE-ag-summary").sys.done === false && /loaded after this contract was sent/.test(line(sentNoRec, "notice:DE-ag-summary").sys.en) && line(sentRec, "notice:DE-ag-summary").sys.done === true && line(sentRec, "notice:DE-ag-summary").sys.who_en === "Sent by Maria, 10/05/2026 3:30 PM ET" && /\(Revised 10\/31\/2023\) was given to the customer with the contract, sent 10\/05\/2026 3:30 PM ET\./.test(line(sentRec, "notice:DE-ag-summary").sys.en),
    "delivery is recorded at Send (which files were loaded at that moment); the line ticks from that record and names who sent it and when");
  // signed acknowledgment (Virginia)
  const va = await run("VA", {}, { slots: { "VA-dpor": { key: "contracts/admin/statedoc-vadpor-1.pdf", version: "Revised 4/29/2025" } } });
  const recVa = F.contractStateDoneApply({}, va.req, { ack: { "VA-dpor": true } }, "Jordan Rivers", "2026-10-05 20:12:00", "ip", "ua");
  const dlv = { message_note_at: null, slots: { "VA-dpor": "2026-10-05 19:30:00" }, by: WHO.sent };
  const vaWait = F.contractStateActionCard(va.comp.state, va.comp.checklist, va.r.c.flags, { c: SENT, frozen: frozenOf(va), who: WHO, delivery: dlv }), vaDone = F.contractStateActionCard(va.comp.state, va.comp.checklist, Object.assign({}, va.r.c.flags, { state_done: recVa }), { c: SIGNED, frozen: frozenOf(va), who: WHO, delivery: dlv });
  ok(JSON.stringify(va.req.ack) === JSON.stringify(["VA-dpor"]) && recVa.ack["VA-dpor"].name === "Jordan Rivers" && recVa.evidence[0].consent === true && /asks for the signed acknowledgment in the same visit/.test(line(vaWait, "notice:VA-dpor").sys.en) && line(vaDone, "notice:VA-dpor").sys.done === true && line(vaDone, "notice:VA-dpor").sys.who_en === "Acknowledged by Jordan Rivers, 10/05/2026 4:12 PM ET",
    "Virginia: the signed acknowledgment is collected in the same visit, with the same evidence, and ticks the line with who and when");
  // Wisconsin: the notice prints even while the brochure is missing
  const wi = await run("WI", {});
  ok(sec(wi, "WI-defect") && sec(wi, "WI-defect").text === noticeOf("WI-defect").text_on_file && line(wi.card, "notice:WI-defect").kind === "person" && line(wi.card, "notice:WI-defect").staff_slot === "WI-brochure", "Wisconsin: the construction defect notice prints now; the line stays with a person until the state brochure is loaded");
  // Illinois: the acknowledgment form waits for the pamphlet
  const il0 = await run("IL", {}), il1 = await run("IL", {}, { slots: { "IL-pamphlet": { key: "contracts/admin/statedoc-ilpamphlet-1.pdf", version: "2026" } } });
  ok(!sec(il0, "IL-ack-form") && line(il0.card, "notice:IL-ack-form").kind === "person" && sec(il1, "IL-ack-form").kind === "state_page" && sec(il1, "IL-ack-form").title === "Consumer Rights Acknowledgment Form" && sec(il1, "IL-ack-form").copies === 2 && sec(il1, "IL-ack-form").company_sign === true && il1.req.sign.indexOf("IL-ack-form") !== -1,
    "Illinois: the customer is never asked to sign \"I have received the pamphlet\" before the pamphlet is loaded; with it, the acknowledgment form is a signed page in two copies, signed by the company too");
  ok(/if \(!contractIsReviewer\(user\)\) \{ return jsonErr\("Forbidden", 403\); \}/.test(fnSrc("handlePostContractStateDoc", workerSrc)) && /file\.type !== "application\/pdf"/.test(fnSrc("handlePostContractStateDoc", workerSrc)) && /Never overwritten/.test(fnSrc("handlePostContractStateDoc", workerSrc)) &&
    /crUploadStateDoc/.test(review) && /Waiting: official document not loaded/.test(review) && /Aguardando: documento oficial n\\u00e3o carregado/.test(review) && /pubCon\[5\] && method === "GET"\) \{ return handleGetPublicContractStateDoc\(/.test(workerSrc),
    "Apex staff load the agency's PDF (as published, never overwritten) on the review page; the customer's own link serves it unaltered");
  ok(/Official documents given with this contract/.test(cut(view, "spDocsHtml")) && /I received and read this document/.test(cut(view, "spDocsHtml")) && /Please open the official document above and confirm you received it\./.test(cut(view, "spCollect")) && /Official document given with this contract before signing: /.test(tpl),
    "customer page: the document is opened and (where required) acknowledged before signing; the PDF records it on the signature page");
}

// ── 12. Florida is unchanged ──────────────────────────────────────────────
{
  let same = 0;
  for (const name of Object.keys(FLORIDA_FIXTURES)) {
    const g = new URL("state-riders-golden-" + name + ".json", GOLDEN_DIR);
    const r = await h.compose(FLORIDA_FIXTURES[name]);
    if (existsSync(g) && readFileSync(g, "utf8") === JSON.stringify(goldenView(r.comp), null, 2) + "\n" && r.comp.state_finish === undefined && !r.comp.sections.some(function (s) { return s.system || s.line || s.place; })) { same++; }
  }
  ok(same === Object.keys(FLORIDA_FIXTURES).length && same === 5, "all five Florida golden files are byte-identical, and a Florida contract carries no state part at all");
  const flAll = await h.compose(Object.assign(clone(FLORIDA_FIXTURES["residential-in-home-deposit"]), { settings: BIZ_YES, parties: { subs: [{ name: "X", address: "a", phone: "1" }], suppliers: [] }, slots: { "DE-ag-summary": { key: "k", version: "v" } }, flags: Object.assign({}, FLORIDA_FIXTURES["residential-in-home-deposit"].flags, { state_facts: { secured: "yes" }, state_values: { legal_description: "x" } }) }));
  ok(JSON.stringify(goldenView(flAll.comp)) === readFileSync(new URL("state-riders-golden-residential-in-home-deposit.json", GOLDEN_DIR), "utf8").trim().replace(/\n\s*/g, "").replace(/": /g, "\":") || JSON.stringify(goldenView(flAll.comp), null, 2) + "\n" === readFileSync(new URL("state-riders-golden-residential-in-home-deposit.json", GOLDEN_DIR), "utf8"),
    "even with the insurance facts answered, subcontractors on the project, a document loaded and answers saved, a Florida contract composes exactly as the golden file");
  ok(F.contractStatePublicParts({ flags: {} }, flAll.comp, "x") === null && F.contractStateCoStatements({}, 2).length === 0, "Florida: nothing extra reaches the customer's page or a change order");
}

// ── 13. Nothing blocks sending, signing or previewing ─────────────────────
{
  let diff = [];
  for (const code of ["CA", "MD", "WY", "MS", "TX", "DE", "OH", "AK"]) {
    const bare = await run(code, {}), busy = await run(code, { secured: "yes", new_home: "yes", disaster: "yes", big_build: "yes", subs: "yes" });
    if (JSON.stringify(bare.comp.blockers) !== JSON.stringify(busy.comp.blockers) || JSON.stringify(bare.comp.missing) !== JSON.stringify(busy.comp.missing) || bare.comp.blockers.length) { diff.push(code); }
  }
  ok(diff.length === 0, "eight states, every part waiting or unanswered: the contract has no blocker and no extra missing field because of a state line" + (diff.length ? " (" + diff.join(", ") + ")" : ""));
  const signFn = fnSrc("handlePostPublicContractSign", workerSrc), before = signFn.slice(0, signFn.indexOf("UPDATE gm_contracts SET status = 'completed'"));
  ok(!/state_parts|state_finish|state_done/.test(before) && !/return jsonErr[^;]*state/.test(signFn), "the customer's signature is never refused because of a state part (a cached page that sends none still signs)");
  ok(/if \(c\.status !== "completed" \|\| !c\.homeowner_signed_at\)/.test(fnSrc("handlePostPublicContractStateParts", workerSrc)) && /body\.consent !== true/.test(fnSrc("handlePostPublicContractStateParts", workerSrc)) && /function spLateHtml\(\)/.test(view) && /"\/state-parts"/.test(cut(view, "spLate")),
    "a part left out is asked for on the same link afterwards (with consent); it never holds the signed contract up");
  // a contract the company signed before a part existed: its frozen text has no such part
  const akNew = await run("AK", { big_build: "yes" });
  const oldText = akNew.comp.sections.filter(function (x) { return !x.line; });
  ok(JSON.stringify(F.contractStateRequiresFromSections(oldText, akNew.req)) === JSON.stringify({ sign: [], initials: [], choose: [], ack: [] }) && JSON.stringify(F.contractStateRequiresFromSections(akNew.comp.sections, { ack: ["X"] })) === JSON.stringify({ sign: ["AK-defect-notice"], initials: [], choose: [], ack: ["X"] }) &&
    /pub\.state_parts\.requires = contractStateRequiresFromSections\(pub\.sections, pub\.state_parts\.requires\);/.test(fnSrc("contractPublicView", workerSrc)) && /contractStateRequiresFromSections\(snap && snap\.sections \? snap\.sections : comp\.sections, comp\.state_finish\.requires\)/.test(fnSrc("contractStateDoneSave", workerSrc)),
    "the customer's page asks only for a part that is in the text it shows: a contract the company signed before this build is signed exactly as before, and a part that IS in the signed text is always accepted");
  ok(/if \(pubCon\[2\] === "state-parts" && method === "POST"\) \{ return esignSignWithConsent\(env, request, "contract", pubCon\[1\], handleGetPublicContract, handlePostPublicContractStateParts\); \}/.test(workerSrc), "a part signed afterwards goes through the same E-SIGN consent record as the contract signature");
  ok(["handlePostGmContractCompanySign", "handlePostGmContractRoute", "handleGetGmContractPreview"].every(function (n) { return !/state_finish|state_done|contractStateFinish/.test(fnSrc(n, workerSrc)); }) && !/blockers\.push[^;]*state_finish/.test(fnSrc("contractCompose", workerSrc)) && !/return jsonErr[^;]*(besideMsg|sentSlots)/.test(fnSrc("handlePostGmContractSend", workerSrc)),
    "company signature, routing, preview and Send never read a state part to decide anything");
}

// ── 14. Every system tick names who caused it and when ────────────────────
{
  const md = await run("MD", { secured: "yes" }), ut = await run("UT", {});
  const utSent = F.contractStateActionCard(ut.comp.state, ut.comp.checklist, ut.r.c.flags, { c: SENT, frozen: frozenOf(ut), who: WHO }), utNew = line(ut.card, "notice:UT-cancel");
  ok(utNew.sys.done === true && utNew.sys.who_en === "Done automatically. Nobody has signed or sent the contract yet." && utNew.sys.auto === true && line(utSent, "notice:UT-cancel").sys.who_en === "Sent by Maria, 10/05/2026 3:30 PM ET" && / Locked in when the company signed\.$/.test(line(utSent, "notice:UT-cancel").sys.en),
    "a printed part: \"Done automatically\" on a new contract, then whoever sent it, with the time");
  const causes = {};
  const rec = F.contractStateDoneApply({}, md.req, { initials: { "MD-security": "JR" } }, "Jordan Rivers", "2026-10-05 20:12:00", "ip", "ua");
  const flags = Object.assign({}, md.r.c.flags, { state_done: rec });
  F.contractStateActionCard(md.comp.state, md.comp.checklist, flags, { c: SIGNED, frozen: frozenOf(md), who: WHO }, causes);
  const ledger = F.contractStateSysLedger(flags, "MD", causes, "2026-10-05 20:12:05");
  ok(JSON.stringify(ledger.lines["notice:MD-security"]) === JSON.stringify({ action: "state_part_signed", at: "2026-10-05 20:12:00", auto: false, by: [{ kind: "customer", id: null, name: "Jordan Rivers", role: "customer" }], recorded_at: "2026-10-05 20:12:05" }),
    "the saved record of the tick: the action, the time, and the customer who did it");
  let unnamed = [];
  for (const code of NON_FL) {
    const x = await run(code, { secured: "yes", new_home: "yes", disaster: "yes", big_build: "yes", subs: "yes", credit: "yes", insurance_paid: "yes", roof_insurance: "yes", age62: "yes", waterproof: "yes", lien_consent: "yes", installments: "yes" }, { settings: BIZ_YES, flags: { state_values: { service_charge_pct: "12", work_description: "w", property_description: "p", legal_description: "l" } }, parties: { subs: [{ name: "S", address: "a", phone: "1" }], suppliers: [] } });
    const sd = F.contractStateDoneApply({}, x.req, { sign: Object.fromEntries(x.req.sign.map(function (i) { return [i, "Jordan Rivers"]; })), initials: Object.fromEntries(x.req.initials.map(function (i) { return [i, "JR"]; })), choose: Object.fromEntries(x.req.choose.map(function (c) { return [c.id, { index: 0, initials: "JR" }]; })) }, "Jordan Rivers", "2026-10-05 20:12:00", "ip", "ua");
    const card = F.contractStateActionCard(x.comp.state, x.comp.checklist, Object.assign({}, x.r.c.flags, sd ? { state_done: sd } : {}), { c: SIGNED, frozen: frozenOf(x), who: WHO, delivery: { message_note_at: "2026-10-05 19:30:00", slots: {}, by: WHO.sent } });
    card.actions.forEach(function (a) { if (a.sys && a.sys.done && (!a.sys.who_en || !a.sys.who_pt || !a.sys.action)) { unnamed.push(code + " " + a.key); } });
  }
  ok(unnamed.length === 0, "all 50 states and DC, every part signed and sent: no system tick is without its who and when" + (unnamed.length ? " (" + unnamed.join(", ") + ")" : ""));
}

// ── 15. The staff screens: both languages, no pop-ups, house style ────────
{
  const names = ["gmConStateValuesHtml", "gmConSetStateValue", "gmConBizFactsHtml", "gmDSuppliersHtml", "gmDSuppliersReload", "gmDSupplierNew", "gmDSupplierOpen", "gmDSupplierEdit", "gmDSupplierRemove"];
  const code = names.map(function (n) { return cut(gm, n); }).join("\n");
  ok(!/\b(confirm|alert|prompt)\s*\(/.test(code) && !/\b(const|let)\s/.test(code) && !/=>/.test(code) && !/[^\x00-\x7F]/.test(code), "new gm.js code: no browser pop-up, var and regular functions only, plain ASCII in its strings");
  ok(names.every(function (n) { return cut(gm, n) === cut(ios, n); }) && gm === ios, "gm.js and its iOS copy carry the same new code");
  const pairs = code.match(/gmT\("((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\)/g) || [];
  ok(pairs.length >= 14 && pairs.every(function (p) { const m = /gmT\("((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\)/.exec(p); return m[1] && m[2]; }), "every new label on the staff screens has a Portuguese and an English wording (" + pairs.length + " pairs)");
  const rows = [];
  Object.keys(sorting.states).forEach(function (c) { Object.keys(sorting.states[c].lines).forEach(function (k) { const e = sorting.states[c].lines[k]; if (["parts", "list", "email", "official"].indexOf(e.sys) !== -1 && (!e.sys_en || !e.sys_pt || e.sys_en === e.sys_pt)) { rows.push(c + " " + k); } if (e.also && (!e.also.en || !e.also.pt || !e.also.why)) { rows.push(c + " " + k + " also"); } }); });
  ok(rows.length === 0 && Object.keys(sorting.ask).every(function (k) { return sorting.ask[k].en && sorting.ask[k].pt; }), "every finished line has its card label in both languages; every per-contract value is asked in both" + (rows.length ? " (" + rows.join(", ") + ")" : ""));
  const newWorker = ["contractStateFinishPlan", "contractStateDoneApply", "contractStatePartText", "contractStatePartWhere", "contractStateFieldLabel", "contractStatePublicParts", "contractStateCoStatements", "contractStateMessageNote"].map(function (n) { return fnSrc(n, workerSrc); }).join("\n");
  ok(!/\b(const|let)\s/.test(newWorker) && !/=>/.test(newWorker) && !/[^\x00-\x7F]/.test(newWorker), "new Worker code: var and regular functions only, plain ASCII in its strings");
  const il = await run("IL", {}), also = line(il.card, "notice:IL-lien#also");
  ok(line(il.card, "notice:IL-lien").kind === "does" && also && also.kind === "person" && also.en === "Give the owner your sworn statement of everyone furnishing labor or materials before the first payment" && also.pt !== also.en &&
    F.contractStateCheckApply(il.r.c.flags, il.card, "notice:IL-lien#also", true, "Maria", "2026-10-05 20:00:00").done["notice:IL-lien#also"].by === "Maria" && F.contractStateCheckApply(il.r.c.flags, il.card, "notice:IL-lien", true, "Maria", "t") === null,
    "Illinois: the lien notice prints by itself; the sworn statement (a person before a notary) is its own hand-tick line, and the system's line cannot be ticked by hand");
}

console.log("");
console.log(failed ? "❌ " + failed + " FAILED, " + passed + " passed" : "✅ ALL PASS (" + passed + ")");
process.exit(failed ? 1 : 0);
