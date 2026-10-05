// Writes scripts/fixtures/state-checklist-review.txt: for all 50 states and
// DC, every "Before you send" line sorted into ACTION / HANDLED / BACKGROUND,
// so a person can read the sorting before relying on it.
// It runs the real Worker functions (cut out of worker/index.js) against
// data/contract-state-riders-v1.json and data/contract-state-checklist-v1.json.
// It also writes scripts/fixtures/state-checklist-summary.txt: the short
// version for a person who is not a lawyer (per state, how many lines the
// system does, how many it can see, and the lines left to a person).
// No network. Writes those two files and nothing else.
//   node scripts/make-state-checklist-review.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildComposer } from "./fixtures/contract-compose-harness.mjs";

const root = new URL("../", import.meta.url);
const h = await buildComposer(readFileSync(new URL("worker/index.js", root), "utf8"));
const riders = JSON.parse(readFileSync(new URL("data/contract-state-riders-v1.json", root), "utf8"));
const sorting = JSON.parse(readFileSync(new URL("data/contract-state-checklist-v1.json", root), "utf8"));
const F = h.fns;

// Every line a state can show: the widest job (sold at the home, a pool, a
// house, a large amount, a first payment of the whole price, no license number
// on file), then the cleaning agreement's own lines.
export function allLines(code) {
  const rider = riders.riders[code], can = rider.cancellation || {};
  const st = { code: code, name: rider.name, florida: false, rider: rider, status: rider.status,
    cancellation: { business_days: Math.round(Number(can.business_days)) || 3, saturday_counts: can.saturday_counts !== false } };
  const job = { sold_in_home: true, is_pool: true, residential: true, amount_cents: 10000000, has_deposit: true, first_payment_cents: 10000000, license_number: null, selections: {} };
  // The notices the builder prints or hands over by itself on this job, with
  // every one-question fact left unanswered (the safe side: they print).
  job.sys_lines = {};
  F.contractStatePrintPlan(st, job, F.contractStateFacts({}, null)).forEach(function (p) { job.sys_lines[p.line] = p.mode; job.sys_lines["notice:" + p.notice.id] = p.mode; });
  // RES-36: the lines the builder finishes (placement, type, signed page,
  // initials, blanks, list, message, agency document), on the job where the
  // system has what it needs: every question answered Yes, the business facts
  // answered, the blanks' values on file, the project's records complete.
  // The agency documents are counted as NOT loaded (they are fetched apart).
  const yes = {};
  Object.keys(sorting.facts).forEach(function (k) { if (sorting.facts[k].en) { yes[k] = "yes"; } });
  const facts = F.contractStateFacts({ state_facts: yes }, { deposit: true, progress: true, arbitration: true, arb_or_jury: true });
  const values = { business_legal_name: "Sunrise Pools LLC", business_address: "100 Bay St, Tampa, FL 33602", business_phone: "(813) 555-0100", business_email: "office@sunrise.test", property_address: "12 Main St, Riverview",
    company_signer_name: "Pat Owner", biz_cgl_insurer: "Acme Mutual", biz_cgl_phone: "(800) 555-1212", biz_cgl_policy: "GL-1" };
  Object.keys(sorting.ask || {}).forEach(function (k) { values["sv_" + k] = "on file"; });
  job.finish = F.contractStateFinishPlan(st, job, facts, { values: values, biz: { cgl: "yes", wc: "yes" }, slots: {},
    parties: { subs: [{ name: "Gulf Plumbing", address: "9 Pipe Rd", phone: "5125550101" }], suppliers: [] } });
  const lines = F.contractStateChecklist(st, job);
  const seen = {};
  lines.forEach(function (l) { seen[l.key] = true; });
  F.contractCleaningStateChecklist(st, Object.assign({}, job, { auto_renews: true, template: "T4" })).forEach(function (l) { if (!seen[l.key]) { seen[l.key] = true; lines.push(l); } });
  return { st: st, lines: lines };
}

function wrap(text, indent) {
  const words = String(text).split(/\s+/), out = []; let cur = "";
  words.forEach(function (w) { if ((cur + " " + w).trim().length > 96) { out.push(cur); cur = w; } else { cur = (cur + " " + w).trim(); } });
  if (cur) { out.push(cur); }
  return out.map(function (l) { return indent + l; }).join("\n");
}

// The old prose is shortened here; the card itself keeps every word.
function short(t, max) { t = String(t); return t.length > max ? t.slice(0, max - 4).replace(/\s+\S*$/, "") + " ..." : t; }
const NAMES = { A: "ACTION", H: "HANDLED", B: "BACKGROUND" };
const WHO = { does: "THE SYSTEM DOES IT", sees: "THE SYSTEM CAN SEE IT", person: "PERSON ONLY" };
// The answers that let the system take a line (married: the second signer is
// asked for; the sale was in English: the contract is in the sale's language).
const BEST_FACTS = { state_facts: { married: "yes", sale_english: "yes" } };
function fillRow(t, l, name) {
  let out = String(t).split("{state}").join(name);
  Object.keys(l.vars || {}).forEach(function (k) { out = out.split("{" + k + "}").join(String(l.vars[k])); });
  return out;
}
// A doubt that belongs to a rule every state shares is written once, at the
// top, and each state block points to it by number.
const generalNotes = [], generalIndex = {};
Object.keys(sorting.generic).forEach(function (k) {
  const f = sorting.generic[k].flag;
  if (f && generalIndex[f] === undefined) { generalNotes.push(f); generalIndex[f] = generalNotes.length; }
});
let total = { A: 0, H: 0, B: 0, flags: 0, general: 0, does: 0, sees: 0, person: 0 };
let body = "";
// For the summary file.
const sum = [], needText = [], needMore = [], needFile = [], outside = [], shared = {}, sharedOrder = [];
riders.states.forEach(function (s) {
  const code = s.code;
  if (code === "FL") {
    body += "################ Florida (FL)\n\nFlorida is the baseline. It has no \"Before you send\" card and nothing here changes it.\n\n";
    return;
  }
  const r = allLines(code), card = F.contractStateActionCard(r.st, r.lines, BEST_FACTS);
  const actionByKey = {};
  card.actions.forEach(function (a) { actionByKey[a.key] = a; });
  const noticeById = {};
  (riders.riders[code].notices || []).forEach(function (n) { noticeById[n.id] = n; });
  const st3 = { name: r.st.name, code: code, does: [], sees: [], person: [], own: [] };
  const ownRows = (sorting.states[code] || {}).lines || {};
  const rows = { A: [], H: [], B: [] };
  r.lines.forEach(function (l) {
    let e = F.contractStateCheckEntry(code, l);
    const a = actionByKey[l.key];
    const cls = a ? "A" : (e && e.c === "H" ? "H" : "B");
    if (!a && e && e.c === "A") { e = { why: "Left out here because another line on this list covers it." }; }
    let row = "";
    if (a) {
      const kind = a.kind || "person", ref = a.ref || sorting.ref_fallback.en;
      row += "  ACTION      " + fillRow(e.en, l, r.st.name) + " (" + ref + ")\n";
      row += "              Portuguese (draft): " + fillRow(e.pt, l, r.st.name) + "\n";
      row += "              Who does it: " + WHO[kind] + (kind === "person" ? "" : ". On the card it reads: " + a.en + " / " + a.pt) + "\n";
      if (e.sys === "language") { row += wrap("Asked first: \"" + sorting.facts.sale_english.en + "\" Yes: the system does it. No or Not sure: a person must give a translation (hand tick).", "              ") + "\n"; }
      if (e.fact && sorting.facts[e.fact]) {
        const q = sorting.facts[e.fact];
        row += wrap(q.en ? "Asked first: \"" + q.en + "\" No takes this line off the card." + (e.sys === "second_signer" ? " Yes or Not sure: the customer's link asks for the second signature. No answer: a hand tick, as before." : " Yes, Not sure or no answer keeps it.") : "Not asked: " + q.known + " When the answer is No this line is off the card.", "              ") + "\n";
      }
      total[kind]++;
      st3[kind].push(kind === "person" ? fillRow(e.en, l, r.st.name) + " (" + ref + ")" : a.en);
      // A person-only line from a rule every state shares is written once in
      // the summary; a line this state has of its own is written under the state.
      if (kind === "person" && ownRows[l.key]) { st3.own.push(fillRow(e.en, l, r.st.name) + " (" + ref + ")"); }
      else if (kind === "person") {
        const gk = fillRow(e.en, Object.assign({}, l, { vars: {} }), "{state}") + (/^cleaning_/.test(l.key) ? " [cleaning agreements only]" : "");
        if (!shared[gk]) { shared[gk] = 0; sharedOrder.push(gk); }
        shared[gk]++;
      }
      const nid = /^notice:/.test(l.key) ? l.key.slice(7) : null, n = nid ? noticeById[nid] : null;
      if (kind === "person" && e.outside) {
        outside.push(r.st.name + ": " + fillRow(e.en, l, r.st.name) + ". Why: " + e.outside);
      } else if (kind === "person" && l.plan && l.plan.state === "no_slot") {
        needFile.push(r.st.name + ": " + fillRow(e.en, l, r.st.name) + ". The agency's file: " + (l.plan.slot ? l.plan.slot.slot : "") + ".");
      } else if (kind === "person" && n && !n.text && !n.text_on_file) {
        needText.push(r.st.name + ": " + n.title + " (" + n.cite + "). " + (n.hold_reason ? "Why: " + short(n.hold_reason, 150) : "Why: no official copy obtained (" + (n.source_status || "NOT OBTAINED") + ")") + ".");
      } else if (kind === "person" && (n && n.text_on_file || e.needs)) {
        needMore.push(r.st.name + ": " + fillRow(e.en, l, r.st.name) + ". Why: " + short(e.needs || "the law says where or how it must be given: " + n.format, 230) + ".");
      }
      // RES-36: the piece of this line no system can do is its own hand-tick line.
      const also = actionByKey[l.key + "#also"];
      if (also) {
        row += "  ACTION      " + also.en + " (" + ref + ")\n              Portuguese (draft): " + also.pt + "\n              Who does it: " + WHO.person + "\n";
        row += wrap("Why a person: " + e.also.why, "              ") + "\n              [line: " + l.key + "#also]\n";
        total.person++; total.A++;
        st3.person.push(also.en + " (" + ref + ")"); st3.own.push(also.en + " (" + ref + ")");
        outside.push(r.st.name + ": " + also.en + ". Why: " + e.also.why);
      }
    } else {
      row += wrap((e && e.why ? e.why : "No row was written for this line, so it is treated as background.") + " [" + l.key + (/^cleaning_/.test(l.key) ? ", cleaning agreements only" : "") + "]", "              ").replace(/^ {14}/, "  " + (NAMES[cls] + "          ").slice(0, 12)) + "\n";
    }
    row += wrap("Old card text: " + short(l.en, a ? 420 : 170), "              ") + "\n";
    if (e && e.flag && generalIndex[e.flag] !== undefined) { row += "              UNSURE: see general note " + generalIndex[e.flag] + " at the top.\n"; total.general++; }
    else if (e && e.flag) { row += wrap("UNSURE: " + e.flag, "              ") + "\n"; total.flags++; }
    if (a) { row += "              [line: " + l.key + (/^cleaning_/.test(l.key) ? ", cleaning agreements only" : "") + "]\n"; }
    rows[cls].push(row); total[cls]++;
  });
  body += "################ " + r.st.name + " (" + code + ") - research status: " + r.st.status + "\n";
  body += "On the card: " + rows.A.length + " action lines at most. Under \"More about " + r.st.name + "\": " + (rows.H.length + rows.B.length) + " lines.\n\n";
  ["A", "H", "B"].forEach(function (c) { if (rows[c].length) { body += rows[c].join(c === "A" ? "\n" : "") + "\n"; } });
  sum.push(st3);
});

const head = [
  "\"Before you send\" checklist: how every line was sorted, state by state",
  "====================================================================",
  "",
  "Read this before relying on the checklist. No lawyer has reviewed it.",
  "",
  "Each line the old card showed is now one of three things:",
  "  ACTION      a line on the \"Before you send\" card. Under each one, \"Who does it\" says one of:",
  "                THE SYSTEM DOES IT     the builder prints the notice (from the official wording on",
  "                                       file) or hands the document over with the contract, by itself.",
  "                THE SYSTEM CAN SEE IT  a person does it inside Apex and the builder notices.",
  "                PERSON ONLY            nothing in Apex can do or see it. A hand tick, as before.",
  "              A system line ticks itself and cannot be ticked or unticked by hand.",
  "  HANDLED     the contract builder already does it (prints it, counts it, inserts the notice).",
  "  BACKGROUND  context only.",
  "HANDLED and BACKGROUND lines are not on the checklist. They stay readable under \"More about {State}\".",
  "",
  "UNSURE marks a line where the research did not make it clear whether the person has to act.",
  "Those were made ACTION lines worded as a check, or HANDLED with the doubt written down.",
  "",
  "How to read a state block:",
  "  - It lists every line the state CAN show. A real contract shows fewer: a pool line shows only on",
  "    a pool job, a door-to-door line only when the sale was made at the customer's home, a notice",
  "    only when the contract amount reaches the state's threshold.",
  "  - The blocks assume no license number is on file. When a number is on file, the line",
  "    \"Add your license or registration number\" is HANDLED (the number prints in the contract).",
  "  - The blocks assume a cleaning plan that renews by itself and a commercial cleaning template, so",
  "    the cleaning lines show as actions. Otherwise those lines are BACKGROUND.",
  "  - A flagged clause choice (\"Look again at clause ...\") shows only when that clause is chosen,",
  "    so it is not listed here. It is always an ACTION.",
  "  - The text in parentheses after an action is the law reference shown on the card. It is copied",
  "    from the research. \"" + sorting.ref_fallback.en + "\" means the research gave no law number for that line.",
  "  - \"Old card text\" is what the card showed before. It is shortened here (ending in \"...\");",
  "    on the card the person reads all of it by clicking the law reference or \"More about {State}\".",
  "",
  "General notes (a doubt about a rule every state shares):",
].concat(generalNotes.map(function (n, i) { return wrap((i + 1) + ". " + n, "  ").replace(/\n  /g, "\n     "); })).concat([
  "",
  "Totals over all states: " + total.A + " ACTION, " + total.H + " HANDLED, " + total.B + " BACKGROUND.",
  "Of the ACTION lines: " + total.does + " the system does, " + total.sees + " the system can see, " + total.person + " person only.",
  "The short version is in scripts/fixtures/state-checklist-summary.txt.",
  "Marked UNSURE: " + total.flags + " lines with a doubt of their own, plus " + total.general + " that point to a general note.",
  "",
  "To change a sorting or a sentence: edit scripts/make-state-checklist-data.mjs, then run the three",
  "commands at the top of that file.",
  "", ""
]).join("\n");

// ── The short summary ─────────────────────────────────────────────────────
let summary = [
  "\"Before you send\" checklist: who does each line, state by state",
  "==============================================================",
  "",
  "The rule: a line is left for a person only when no system could do it.",
  "No lawyer has reviewed this. The long version is state-checklist-review.txt.",
  "",
  "Three kinds of line:",
  "  SYSTEM DOES IT     Apex prints the notice in the contract (copied from the official wording on",
  "                     file, never retyped), in the place and the type the law states, with its",
  "                     blanks filled; collects a separate signature or initials inside the",
  "                     customer's own signing visit; builds the subcontractor and supplier list;",
  "                     puts a required sentence beside the message; or gives the document to the",
  "                     customer with the contract.",
  "  SYSTEM CAN SEE IT  a person does it inside Apex (a signature, the photo acknowledgment) and",
  "                     Apex ticks the line when it happens.",
  "  PERSON ONLY        nothing in Apex can do or see it. The person ticks it by hand.",
  "",
  "The counts are the most lines a state can show (a pool job sold at the customer's home, no license",
  "number on file, the customer married, the sale made in English). A real contract shows fewer.",
  "Lines that depend on one fact (homestead, married, credit, age, subcontractors) ask one Yes / No /",
  "Not sure question; a No takes the line off the card.",
  "A line that states a fact or asks the customer for a signature is done by the system only after a",
  "Yes; the counts assume those Yes answers, the insurance questions answered in the contract",
  "settings, and the project's subcontractors and suppliers on file with address and telephone.",
  "The agency documents (pamphlets and forms that must be handed over unaltered) are counted as not",
  "loaded yet: their lines show under PERSON until Apex staff load each file.",
  "",
  "All states together: " + total.does + " system does it, " + total.sees + " system can see it, " + total.person + " person only.",
  "",
  "STATE                    DOES  SEES  PERSON",
].concat(sum.map(function (x) { return (x.name + " (" + x.code + ")" + "                         ").slice(0, 25) + ("   " + x.does.length).slice(-4) + ("     " + x.sees.length).slice(-6) + ("       " + x.person.length).slice(-8); })).concat([
  "Florida (FL)             baseline: no card, nothing changed",
  "",
  "",
  "PERSON-ONLY LINES THAT COME FROM A RULE MANY STATES SHARE (written once; the number is how many states)",
  "-------------------------------------------------------------------------------------------------------",
]).concat(sharedOrder.map(function (k) { return wrap("- " + k + "  [" + shared[k] + "]", "").replace(/\n/g, "\n  "); })).concat([
  "",
  "",
  "PERSON-ONLY LINES EACH STATE HAS OF ITS OWN",
  "-------------------------------------------",
  ""
]).join("\n");
sum.forEach(function (x) {
  if (!x.own.length) { return; }
  summary += x.name + " (" + x.code + ")\n";
  x.own.forEach(function (t) { summary += wrap("- " + t, "  ").replace(/\n  /g, "\n    ") + "\n"; });
  summary += "\n";
});
summary += "States with no person-only line of their own: " + (sum.filter(function (x) { return !x.own.length; }).map(function (x) { return x.code; }).join(", ") || "none") + ".\n\n";
summary += "\nNEEDS OFFICIAL TEXT BEFORE THE SYSTEM CAN DO IT (" + needText.length + ")\n" + "-----------------------------------------------------\n" +
  "The state requires a notice, but no official word-for-word copy is on file, so nothing prints and\nthe line stays with a person. Get the official wording and the system can print it.\n\n" +
  needText.map(function (t) { return wrap("- " + t, "").replace(/\n/g, "\n  "); }).join("\n") + "\n\n" +
  "\nWORDING IS ON FILE, BUT THE SYSTEM CANNOT DO THE REST YET (" + needMore.length + ")\n" + "---------------------------------------------------------------\n" +
  "Left to a person for the reason given.\n\n" +
  (needMore.length ? needMore.map(function (t) { return wrap("- " + t, "").replace(/\n/g, "\n  "); }).join("\n") : "None.") + "\n\n" +
  "\nWAITING FOR THE AGENCY'S OWN DOCUMENT (" + needFile.length + ")\n" + "--------------------------------------------\n" +
  "The system is built to hand the agency's file to the customer before they sign, record the delivery\nand collect the signed acknowledgment where the law asks for one. The file itself is not loaded yet.\nUntil Apex staff load it, the line stays with the contractor (who is not shown this note).\n\n" +
  needFile.map(function (t) { return wrap("- " + t, "").replace(/\n/g, "\n  "); }).join("\n") + "\n\n" +
  "\nSTAYS WITH A PERSON FOR GOOD: OUTSIDE APEX (" + outside.length + ")\n" + "-------------------------------------------------\n" +
  "No system could do these: they happen on a document Apex does not make, on a state's own website,\nor before a notary.\n\n" +
  outside.map(function (t) { return wrap("- " + t, "").replace(/\n/g, "\n  "); }).join("\n") + "\n";
export const summaryText = summary;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(new URL("scripts/fixtures/state-checklist-summary.txt", root), summary);
  writeFileSync(new URL("scripts/fixtures/state-checklist-review.txt", root), head + body);
  console.log("written: scripts/fixtures/state-checklist-review.txt (" + total.A + " action, " + total.H + " handled, " + total.B + " background, " + total.flags + " unsure of their own, " + total.general + " pointing to a general note)");
}
export const reviewText = head + body;
