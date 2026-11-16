// ABC branches pages (2026-11-16): the pure parts of the new gm.js screens, cut out of the real file and run with stubs.
// No browser: this proves the rules (date or TBD, quick buttons, what is still needed, no business name, escaping, no pop-ups).
//
//   node scripts/test-abc-branches-pages.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const src = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../gm.css", import.meta.url), "utf8");
function fn(name) {
  let i = src.indexOf("\nfunction " + name + "(");
  if (i < 0) { throw new Error("function not in gm.js: " + name); }
  const j = src.indexOf("\n}", i + 1);
  return src.slice(i + 1, j + 2);
}
function variable(name) {
  const i = src.indexOf("\nvar " + name + " =");
  if (i < 0) { throw new Error("var not in gm.js: " + name); }
  const m = /;[ \t]*(\/\/[^\n]*)?\n/.exec(src.slice(i + 1));
  return src.slice(i + 1, i + 1 + m.index + 1);
}
function world(lang, extra) {
  const sandbox = Object.assign({ console, Date, Math, JSON, Object, Array, String, Number, encodeURIComponent,
    gmT: (pt, en) => (lang === "pt" ? pt : en), escHtml: (t) => String(t === null || t === undefined ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
    gmMoney: (c) => "$" + (c / 100).toFixed(2), gmIsSeller: () => false, gmAbcPlStatus: null, gmAbcStatus: null, gmMatDraft: null, gmPricingRowById: () => null }, extra || {});
  const names = ["gmBrStatus", "gmBrPairs", "gmBrReady", "gmBrMulti", "gmBrKey", "gmBrFind", "gmBrDefault", "gmBrShort", "gmBrName", "gmBrMoney", "gmBrOtherLine", "gmBrAppend", "gmBrNewDl", "gmBrDlBody", "gmBrTodayIso",
    "gmBrReasonWords", "gmBrCardsHtml", "gmBrStillNeeded", "gmBrBarInner", "gmBrHintWords", "gmBrLookupUrl", "gmBrTabsHtml", "gmBrLineChipHtml", "gmMatUsDate", "gmMatIsoDate", "gmMatMissingText", "gmMatCalloutHtml", "gmBrBranchSectionHtml", "gmBrDraftPair", "gmBrPairNameIn"];
  const code = ["GM_MAT_MISSING", "GM_MAT_ICON", "GM_BR_MISSING_IDS", "gmBr"].map(variable).join("\n") + "\n" + names.map(fn).join("\n");
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}
const en = world("en"), pt = world("pt");
const PAIRS = [{ ship_to: "S1", branch: "1234", ship_to_name: "Zeta <b>Roofing</b>", branch_name: "Tampa", is_default: true }, { ship_to: "S1", branch: "340", ship_to_name: "Zeta Roofing", branch_name: "Orem", is_default: false }];

// ── instructions and quick buttons ──
ok(en.gmBrAppend("", "Call before delivery") === "Call before delivery", "an empty box takes the phrase as it is");
ok(en.gmBrAppend("Gate code 4521", "Leave at the garage") === "Gate code 4521. Leave at the garage", "text already there: joined with a period and a space");
ok(en.gmBrAppend("Already ends.", "Call first") === "Already ends. Call first", "a sentence that already ends is not given a second period");
ok(en.gmBrAppend("x".repeat(250), "Call before delivery") === null, "never past 255 characters: a phrase that does not fit answers null");
ok(en.gmBrAppend("x".repeat(230), "Call before delivery") !== null && en.gmBrAppend("x".repeat(230), "Call before delivery").length <= 255, "a phrase that fits is added");

// ── date or TBD (F5): never chosen for the owner ──
const dl0 = en.gmBrNewDl(null, "");
ok(dl0.dateMode === "" && dl0.dcName === "" && dl0.dcPhone === "", "a new delivery section has no date choice and no on-site person");
let b = en.gmBrDlBody(Object.assign({}, dl0));
ok(b.delivery_date === "" && b.delivery_date_tbd === 0, "neither chosen: saved as empty (only sending needs the choice)");
b = en.gmBrDlBody(Object.assign({}, dl0, { dateMode: "tbd", date: "11/20/2026" }));
ok(b.delivery_date_tbd === 1 && b.delivery_date === "", "TBD chosen: the typed date is not sent");
b = en.gmBrDlBody(Object.assign({}, dl0, { dateMode: "date", date: "11/20/2026" }));
ok(b.delivery_date === "2026-11-20" && b.delivery_date_tbd === 0, "a date chosen: MM/DD/YYYY becomes YYYY-MM-DD");
ok(!!en.gmBrDlBody(Object.assign({}, dl0, { dateMode: "date", date: "13/45/2026" })).err, "a bad date is refused on the page");
ok(!!en.gmBrDlBody(Object.assign({}, dl0, { dcPhone: "123" })).err, "a short phone is refused on the page");
b = en.gmBrDlBody(Object.assign({}, dl0, { dcName: " Sam Lee ", dcPhone: "(813) 555-0111", instr: "Gate\ncode\t4521" }));
ok(b.delivery_contact_name === "Sam Lee" && b.delivery_contact_phone === "8135550111" && b.delivery_instructions === "Gate code 4521", "name, ten digit phone, and line breaks turned into spaces");
ok(!!en.gmBrDlBody(Object.assign({}, dl0, { instr: "y".repeat(256) })).err, "256 characters of instructions are refused on the page");
const iso = en.gmBrTodayIso();
ok(/^\d{4}-\d{2}-\d{2}$/.test(iso), "the date picker minimum is today in the device's day");

// ── what is still needed (the pinned bar) ──
const baseForm = () => ({ service: "OTG", dateMode: "date", date: "11/20/2026", dcName: "Sam", dcPhone: "8135550111", contact_name: "Owner Person", contact_email: "o@z.example", contact_phone: "8135550100", lines: { l1: { qty: "3", removed: false } } });
const mk = (f, miss) => ({ ready: true, form: f, locMode: "job", data: { lines: [{ id: "l1" }], draft: { missing: miss || [] } } });
ok(en.gmBrStillNeeded(mk(baseForm())).length === 0, "everything filled in: nothing is still needed");
let need = en.gmBrStillNeeded(mk(Object.assign(baseForm(), { dateMode: "" })));
ok(need.length === 1 && need[0] === "delivery_date", "no date and no TBD: the date is still needed");
ok(en.gmBrStillNeeded(mk(Object.assign(baseForm(), { dateMode: "tbd", date: "" }))).length === 0, "TBD counts as a choice");
need = en.gmBrStillNeeded(mk(Object.assign(baseForm(), { dcName: "", dcPhone: "" })));
ok(need.indexOf("delivery_contact_name") !== -1 && need.indexOf("delivery_contact_phone") !== -1, "the on-site person is still needed when empty");
need = en.gmBrStillNeeded(mk(Object.assign(baseForm(), { contact_name: "" })));
ok(need.indexOf("contact_name") !== -1, "an empty submitter name is still needed (never the business name)");
need = en.gmBrStillNeeded(mk(baseForm(), ["item_description", "item_length"]));
ok(need.indexOf("item_description") !== -1 && need.indexOf("item_length") !== -1, "the server's item description and length blocks are listed");
const inner = en.gmBrBarInner(["delivery_date"]);
ok(/Still needed:/.test(inner) && /onclick="gmBrGoto\('gmMatDateBox'\)"/.test(inner) && /a delivery date, or TBD/.test(inner), "each missing item is a button that scrolls to its field");
ok(/Ready to send/.test(en.gmBrBarInner([])), "nothing missing: the bar says Ready to send");
ok(/Ainda falta:/.test(pt.gmBrBarInner(["delivery_date"])) && /Pronto para enviar/.test(pt.gmBrBarInner([])), "the bar is in Portuguese too");

// ── the missing words ──
const words = (k) => en.gmMatMissingText([k]);
ok(/Refresh this item from ABC first/.test(words("item_description")), "item_description: Refresh this item from ABC first");
ok(/Choose a length is not supported yet, ask the branch/.test(words("item_length")), "item_length: Choose a length is not supported yet, ask the branch");
ok(/delivery date, or TBD/.test(words("delivery_date")) && /on-site/.test(words("delivery_contact_name")) && /on-site/.test(words("delivery_contact_phone")), "date, on-site name and phone have wording");
ok(/pessoa/.test(pt.gmMatMissingText(["person_name"])) && /comprimento/.test(pt.gmMatMissingText(["item_length"])), "Portuguese wording exists for the new keys");

// ── the branch cards: totals only when complete, tags, the plain words ──
const cmp = { recommended: { ship_to: "S1", branch: "340" }, saving_vs_next: 42.5, availability_checked: true, names: { l1: "Shingle" }, pairs: [
  { ship_to: "S1", branch: "1234", ship_to_name: "Zeta Roofing", branch_name: "Tampa", is_default: true, reason_code: "carries_all_items", carried_count: 1, line_count: 2, complete: false, total: null, lines: [{ line_id: "l1", item_number: "A", carried: true, price: 10, uom: "BD", line_total: 30 }, { line_id: "l2", item_number: "B", carried: false, price: null, uom: null, line_total: null }] },
  { ship_to: "S1", branch: "340", ship_to_name: "Zeta Roofing", branch_name: "Orem", is_default: false, reason_code: "lowest_total_all_items", carried_count: 2, line_count: 2, complete: true, total: 99.5, lines: [{ line_id: "l1", item_number: "A", carried: true, price: 9, uom: "BD", line_total: 27 }, { line_id: "l2", item_number: "B", carried: true, price: 8, uom: "EA", line_total: 72.5 }] }] };
const cards = en.gmBrCardsHtml(cmp, "S1|1234", "gmBrOrderFrom");
ok((cards.match(/gm-br-card"/g) || []).length + (cards.match(/gm-br-card gm-br-card-rec"/g) || []).length === 2, "one card per branch");
ok(/Carries 1 of 2 items/.test(cards) && !/\$0\.00/.test(cards), "a branch that misses an item shows 'Carries 1 of 2 items' and no total");
ok(/Total<\/span><strong>\$99\.50/.test(cards), "a branch that carries and prices every line shows its total");
ok(/Not available at this branch/.test(cards) && /Lowest total/.test(cards) && /\$42\.50 less than the other branch/.test(cards), "plain words, the tag and the saving");
ok((cards.match(/Order from /g) || []).length === 2 && /gmBrOrderFrom\(0\)/.test(cards) && /gmBrOrderFrom\(1\)/.test(cards), "EVERY card has an Order from button; nothing is chosen for the owner");
ok(/Pedir da filial/.test(pt.gmBrCardsHtml(cmp, "S1|1234", "gmBrOrderFrom")), "the cards are in Portuguese too");
const none = JSON.parse(JSON.stringify(cmp)); none.recommended = null; none.pairs.forEach((p) => { p.reason_code = "not_checked"; }); none.availability_checked = false;
ok(/could not check/i.test(en.gmBrCardsHtml(none, "", "x")), "availability not checked is said plainly");

// ── tabs, escaping, one branch sees none ──
const multi = world("en", { gmAbcPlStatus: { available: true, connected: true, branches_ready: true, pairs: PAIRS } });
const one = world("en", { gmAbcPlStatus: { available: true, connected: true, branches_ready: true, pairs: [PAIRS[0]] } });
ok(multi.gmBrMulti() === true && one.gmBrMulti() === false, "tabs are for a business with more than one pair only");
const tabs = multi.gmBrTabsHtml("S1|340", "gmBrSheetTab", false, "");
ok((tabs.match(/role="tab"/g) || []).length === 2 && /aria-selected="true"/.test(tabs) && !/<b>Roofing/.test(tabs) && /&lt;b&gt;Roofing/.test(tabs), "one tab per pair, the active one selected, names escaped");
const dis = multi.gmBrTabsHtml("S1|340", "gmBrEstTab", true, "This estimate is ordered from Orem.");
ok(/disabled/.test(dis) && /This estimate is ordered from Orem\./.test(dis), "the other tabs are grayed out and say why in words");
ok(/Zeta &lt;b&gt;Roofing/.test(multi.gmBrOtherLine({ ship_to: "S1", branch: "1234", ship_to_name: "Zeta <b>Roofing</b>", branch_name: "Tampa", carried: false, price: null, uom: null })), "ABC and account text is escaped");
ok(/Not available at this branch/.test(multi.gmBrOtherLine({ ship_to: "S", branch: "1", carried: false })) && /Could not check/.test(multi.gmBrOtherLine({ ship_to: "S", branch: "1", carried: null })) && /\$12\.50 per BD/.test(multi.gmBrOtherLine({ ship_to: "S", branch: "1", carried: true, price: 12.5, uom: "BD" })), "other branch rows: the price, the plain words, or could not check");

// ── the item confirm card ──
ok(/Each bundle covers about 33\.33 square feet\./.test(en.gmBrHintWords({ unit_name: "Bundle", per_unit_sqft: 33.33, per_unit_linear_ft: null })), "the hint in plain words");
ok(/linear feet/.test(en.gmBrHintWords({ unit_name: "Bundle", per_unit_sqft: null, per_unit_linear_ft: 20 })) && en.gmBrHintWords({ per_unit_sqft: null, per_unit_linear_ft: null }) === "", "linear feet are not square feet; no hint, no words");
const url = en.gmBrLookupUrl({ item: { brand_line: "GAF", description: "Timberline HD", supplier_name: "GAF Corp" }, row: { item: "x", abc_item_number: "02GAS" } });
ok(/^https:\/\/www\.google\.com\/search\?q=GAF%20Timberline%20HD%2002GAS$/.test(url) && !/abcsupply/.test(url), "Look it up is a web search, never a link to abcsupply.com");


// ── smoke: the screens draw without errors, in both languages, with the right controls ──
function drawWorld(lang) {
  const w = world(lang, { gmApi: () => new Promise(() => {}), gmMatBatch: null, gmMatBatchRender: () => {}, gmMatDraftRender: () => {}, gmEstWiz: null });
  const more = ["gmMatField", "gmBrDateHtml", "gmBrPeopleHtml", "gmBrInstrHtml", "gmBrDeliveryHtml", "gmBrContactsLoad", "gmBrConflictHtml", "gmBrEstPanelHtml", "gmBrCantFindHtml", "gmBrSheetCountsHtml", "gmBrSheetTopHtml", "gmBrPairOfFind", "gmBrBarHtml", "gmBrCardPairsHtml", "gmBrConfirmRender"];
  const code = variable("gmBrEst") + "\n" + more.map(fn).join("\n");
  w.gmBrRepaintOpen = () => {}; w.gmSheetOpen = (t, h) => { w.__sheet = h; }; w.gmMatCalloutHtml = w.gmMatCalloutHtml;
  vm.runInContext(code, w);
  return w;
}
for (const lang of ["en", "pt"]) {
  const w = drawWorld(lang);
  w.gmAbcPlStatus = { available: true, connected: true, branches_ready: true, pairs: PAIRS };
  w.gmBr.contacts = [{ id: "c1", name: "Sam <i>Lee</i>", phone: "8135550111", email: "" }];
  const o = w.gmBrNewDl(null, "Gate code 4521");
  const h = w.gmBrDeliveryHtml(o, "draft", "gmMat");
  ok(/gmMatDateBox/.test(h) && /gmMatDcBox/.test(h) && !/aria-pressed="true"/.test(h), lang + ": the delivery block draws, and neither date nor TBD is pressed");
  ok(/Sam &lt;i&gt;Lee/.test(h) && !/<i>Lee/.test(h), lang + ": a saved person's name is escaped");
  ok(/gmBrQuick\('draft', 'gate'\)/.test(h) && /gmBrQuick\('draft', 'call'\)/.test(h) && /gmBrQuick\('draft', 'garage'\)/.test(h), lang + ": the gate code button shows when the lead has access notes, with the two fixed buttons");
  const noGate = w.gmBrDeliveryHtml(w.gmBrNewDl(null, ""), "draft", "gmMat");
  ok(!/gmBrQuick\('draft', 'gate'\)/.test(noGate) && /maxlength="255"/.test(noGate), lang + ": no access notes, no gate code button; 255 character box");
  const both = w.gmBrDeliveryHtml(Object.assign(o, { dateMode: "tbd" }), "draft", "gmMat");
  ok(/hold the order|segurar o pedido/.test(both), lang + ": TBD says the branch will hold the order");
  const m = { ready: true, multi: true, busy: false, view: "edit", form: Object.assign(baseForm(), o), locMode: "job", data: { pairs: PAIRS, lines: [{ id: "l1", description: "Shingle" }], draft: { missing: [] } }, cmp: cmp, id: "d1" };
  const bar = w.gmBrBarHtml(m);
  ok(/class="gm-bar"/.test(bar) && /gmMatReviewOpen\(\)/.test(bar), lang + ": the pinned bar holds Review and send");
  const sec = w.gmBrBranchSectionHtml(m);
  ok(/gmBrCmpLoad/.test(sec) && /gmBrOrderFrom\(0\)/.test(sec), lang + ": the draft's Branch section shows the compare button and the cards");
  m.cf = { cur: cmp.pairs[0], other: cmp.pairs[0], fix: {} };
  const cf = w.gmBrConflictHtml(m);
  ok(/gmBrConflictSplit/.test(cf) && /gmBrConflictMove/.test(cf) && /disabled/.test(cf), lang + ": the conflict screen has the three choices and the move waits until every unavailable item is handled");
  w.gmBrEst.move = { other: { ship_to: "S1", branch: "340" }, item: { description: "Ridge" }, g: PAIRS[1] };
  ok(/gmBrEstMoveYes/.test(w.gmBrEstPanelHtml({})) && /gmBrEstMoveNo/.test(w.gmBrEstPanelHtml({})), lang + ": the move card has Yes and No");
  const card = w.gmBrCardPairsHtml({ pairs: PAIRS });
  ok(/gmBrMakeDefault\(1\)/.test(card) && /gmBrRemoveAsk\(1\)/.test(card) && !/gmBrMakeDefault\(0\)/.test(card), lang + ": the ABC card gives every non default pair Make default and Remove");
  const oneCard = w.gmBrCardPairsHtml({ pairs: [PAIRS[0]] });
  ok(!/gmBrMakeDefault/.test(oneCard), lang + ": one pair shows no buttons");
  w.gmAbcPlStatus = { available: true, connected: true, branches_ready: true, pairs: [PAIRS[0]] };
  ok(w.gmBrSheetTopHtml({}) !== "" && !/role="tab"/.test(w.gmBrSheetTopHtml({})) && /Showing items carried at branch|Mostrando itens da filial/.test(w.gmBrSheetTopHtml({})), lang + ": one pair: the branch is named in words, no tabs");
  ok(w.gmBrCantFindHtml({ q: "ridge" }) === "", lang + ": one pair: no Can't find it button");
}

// ── no pop-ups, no business name, no long dashes ──
const added = src.slice(src.indexOf("// ABC branches, delivery date or TBD, saved on-site people"), src.indexOf("\nvar gmPricingCsvText = null;"));
ok(added.length > 5000 && !/\b(alert|confirm|prompt)\s*\(/.test(added), "the new screens use no browser pop-ups");
ok(!/[—–]/.test(added), "no long dashes or en dashes in anything a person reads");
ok(/rel="noopener noreferrer"/.test(added), "the web search link opens with noopener noreferrer");
ok(/referrerpolicy="no-referrer"/.test(added) && /alt="/.test(added), "ABC's photo has a plain alt text and is only an img");
ok(!/contact_name\s*=\s*biz\.name/.test(added) && /b\.ready \? \(all\[0\]\.suggested_contact_name \|\| ""\)/.test(src), "the batch never prefills the contact name with the business name");
ok(/position: sticky; bottom: 0/.test(css) && /safe-area-inset-bottom/.test(css), "the pinned bar is sticky at the bottom and safe area aware");
ok(/gm-send-abc/.test(src) && /Send materials order to ABC/.test(src) && /Send materials orders \(/.test(src), "the contract has a visible Send materials order to ABC button");
ok(/body \+= gmMatContractSendBtnHtml\(c\); \}\s*\n\s*body \+= '<a class="gm-btn-secondary" href="' \+ escHtml\(c\.preview_link\)/.test(src), "the button comes BEFORE Preview as customer at the top of the signed contract");
ok(/function gmMatContractBadgeHtml\(c\) \{ return ""; \}/.test(src), "the small pill is gone from the contract list row");

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
