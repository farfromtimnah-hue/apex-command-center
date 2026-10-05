// Writes scripts/fixtures/state-checklist-review.txt: for all 50 states and
// DC, every "Before you send" line sorted into ACTION / HANDLED / BACKGROUND,
// so a person can read the sorting before relying on it.
// It runs the real Worker functions (cut out of worker/index.js) against
// data/contract-state-riders-v1.json and data/contract-state-checklist-v1.json.
// No network. Writes one file: scripts/fixtures/state-checklist-review.txt.
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
// A doubt that belongs to a rule every state shares is written once, at the
// top, and each state block points to it by number.
const generalNotes = [], generalIndex = {};
Object.keys(sorting.generic).forEach(function (k) {
  const f = sorting.generic[k].flag;
  if (f && generalIndex[f] === undefined) { generalNotes.push(f); generalIndex[f] = generalNotes.length; }
});
let total = { A: 0, H: 0, B: 0, flags: 0, general: 0 };
let body = "";
riders.states.forEach(function (s) {
  const code = s.code;
  if (code === "FL") {
    body += "################ Florida (FL)\n\nFlorida is the baseline. It has no \"Before you send\" card and nothing here changes it.\n\n";
    return;
  }
  const r = allLines(code), card = F.contractStateActionCard(r.st, r.lines, {});
  const actionByKey = {};
  card.actions.forEach(function (a) { actionByKey[a.key] = a; });
  const rows = { A: [], H: [], B: [] };
  r.lines.forEach(function (l) {
    let e = F.contractStateCheckEntry(code, l);
    const a = actionByKey[l.key];
    const cls = a ? "A" : (e && e.c === "H" ? "H" : "B");
    if (!a && e && e.c === "A") { e = { why: "Left out here because another line on this list covers it." }; }
    let row = "";
    if (a) {
      row += "  ACTION      " + a.en + " (" + (a.ref || sorting.ref_fallback.en) + ")\n";
      row += "              Portuguese (draft): " + a.pt + "\n";
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
});

const head = [
  "\"Before you send\" checklist: how every line was sorted, state by state",
  "====================================================================",
  "",
  "Read this before relying on the checklist. No lawyer has reviewed it.",
  "",
  "Each line the old card showed is now one of three things:",
  "  ACTION      something the person must do or check themselves. These are the tick-box lines.",
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
  "Marked UNSURE: " + total.flags + " lines with a doubt of their own, plus " + total.general + " that point to a general note.",
  "",
  "To change a sorting or a sentence: edit scripts/make-state-checklist-data.mjs, then run the three",
  "commands at the top of that file.",
  "", ""
]).join("\n");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(new URL("scripts/fixtures/state-checklist-review.txt", root), head + body);
  console.log("written: scripts/fixtures/state-checklist-review.txt (" + total.A + " action, " + total.H + " handled, " + total.B + " background, " + total.flags + " unsure of their own, " + total.general + " pointing to a general note)");
}
export const reviewText = head + body;
