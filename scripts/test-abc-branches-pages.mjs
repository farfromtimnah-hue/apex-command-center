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
    "gmBrReasonWords", "gmBrCardsHtml", "gmBrStillNeeded", "gmBrBarInner", "gmBrLabel", "gmBrAcct", "gmBrPhone", "gmBrPhoneDigits", "gmBrAddrOk", "gmBrAskLocal", "gmBrSig", "gmBrActiveLines", "gmBrAskNeed", "gmBrAskGroups", "gmBrAskGroup", "gmBrSyncState", "gmBrAskTitle", "gmBrFixOk", "gmBrFixText", "gmBrHintWords", "gmBrLookupUrl", "gmBrTabsHtml", "gmBrLineChipHtml", "gmMatUsDate", "gmMatIsoDate", "gmMatMissingText", "gmMatCalloutHtml", "gmBrBranchSectionHtml", "gmBrDraftPair", "gmBrPairNameIn"];
  const code = ["GM_MAT_MISSING", "GM_MAT_ICON", "GM_BR_ASK_GROUP", "GM_BR_ASK_ORDER", "gmBr"].map(variable).join("\n") + "\n" + names.map(fn).join("\n");
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
// 2026-11-16: no list of links any more. The bar holds one line: the questions left, or Ready to send.
const inner = en.gmBrBarInner(["date"], "ok");
ok(/1 question left/.test(inner) && !/Still needed/.test(inner) && !/onclick/.test(inner) && !/<button/.test(inner), "the bar names how many questions are left and holds no links");
ok(/2 questions left/.test(en.gmBrBarInner(["date", "person"], "ok")) && /Ready to send/.test(en.gmBrBarInner([], "ok")) && /Checking/.test(en.gmBrBarInner([], "pending")) && !/Ready to send/.test(en.gmBrBarInner([], "pending")), "Ready to send is said only when nothing is left AND the check is done");
ok(/Faltam 2 perguntas/.test(pt.gmBrBarInner(["a", "b"], "ok")) && /Pronto para enviar/.test(pt.gmBrBarInner([], "ok")), "the bar is in Portuguese too");
// the questions: one group at a time, in a fixed order, from the Worker's own keys
ok(en.gmBrAskGroups(["contact_phone", "delivery_date", "delivery_service", "delivery_place_complete"]).join() === "service,date,place,contact", "the questions come in order: delivery type, date, person, place, contact");
ok(en.gmBrAskGroups(["delivery_contact_name", "delivery_contact_phone"]).join() === "person" && en.gmBrAskGroups(["location_name_taken", "delivery_place_complete"]).join() === "place", "name and phone are ONE question; the place keys are one question");
ok(en.gmBrAskGroups([]).length === 0 && en.gmBrAskGroups(["something_new"]).join() === "fields", "nothing left is an empty list; an unknown key still asks something");
const askM = (over, f) => Object.assign({ ready: true, locMode: "job", sync: "ok", prices: "ok", form: Object.assign({ service: "OTG", dateMode: "tbd", dcName: "Sam", dcPhone: "8135550111", contact_name: "Owner Person", contact_email: "o@z.example", contact_phone: "8135550100", job_name: "Smith", order_ref: "AP-ABC12345", ja: { line1: "1 Oak St", city: "Tampa", state: "FL", postal: "33602" }, nl: {}, lines: { l1: { qty: "3", removed: false } } }, f || {}), data: { lines: [{ id: "l1", unit_price: 5 }], draft: { missing: [] } } }, over || {});
const goodM = askM(); goodM.sigChecked = en.gmBrSig(goodM);
ok(en.gmBrAskNeed(goodM).length === 0 && en.gmBrSyncState(goodM) === "ok", "everything answered, saved and checked: nothing is asked and the state is ok");
const staleM = askM(); staleM.sigChecked = "not what is on screen";
ok(en.gmBrSyncState(staleM) === "pending", "what is on screen was not checked yet: the state is pending, never ok");
const srvM = askM(); srvM.sigChecked = en.gmBrSig(srvM); srvM.data.draft.missing = ["delivery_place_complete"];
ok(en.gmBrAskNeed(srvM).indexOf("delivery_place_complete") !== -1 && en.gmBrAskGroup(srvM) === "place", "something the Worker still lists is ASKED (Ready is never said while its list has an item)");
const srvOld = askM(); srvOld.sigChecked = "an older copy"; srvOld.data.draft.missing = ["delivery_place_complete"];
ok(en.gmBrAskNeed(srvOld).indexOf("delivery_place_complete") === -1, "an answer about an older copy is not trusted until the screen is checked again");
const gap1 = askM({ locMode: "job" }, { ja: { line1: "1 Oak St", city: "", state: "FL", postal: "33602" } });
ok(en.gmBrAskLocal(gap1).indexOf("delivery_place_complete") !== -1, "an address with a missing part is asked (street, city, state, zip) in the same block");
ok(en.gmBrAskLocal(askM({ locMode: "new" }, { nl: { name: "", line1: "1 A St", city: "T", state: "FL", postal: "33602" } })).indexOf("delivery_place_complete") !== -1, "a new location with no name is asked");
const noPrice = askM(); noPrice.data.lines[0].unit_price = null; noPrice.sigChecked = en.gmBrSig(noPrice);
ok(en.gmBrAskNeed(noPrice).indexOf("line_price") !== -1 && en.gmBrAskNeed(Object.assign(askM(), { prices: "loading" })).indexOf("line_price") !== -1, "a line with no price, or prices still loading, is asked: never Ready");
const askHtmlWorld = () => { const w = world("en", { gmBrContactsLoad: () => {}, gmMatDraft: null }); return w; };
void askHtmlWorld;

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
ok(/Tampa &lt;b&gt;x&lt;\/b&gt; \(1234\)/.test(multi.gmBrOtherLine({ ship_to: "S1", branch: "1234", ship_to_name: "Zeta", branch_name: "Tampa <b>x</b>", carried: false, price: null, uom: null })), "ABC branch text is escaped and shown in the one name format");
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

// ══ 2026-11-16: names, phone, questions, conflict screen, Replace, orders without a contract ══
const NEWF = ["gmBrLabel", "gmBrAcct", "gmBrPhone", "gmBrPhoneDigits", "gmBrAddrOk", "gmBrAskLocal", "gmBrSig", "gmBrActiveLines", "gmBrAskNeed", "gmBrAskGroups", "gmBrAskGroup", "gmBrSyncState", "gmBrAskTitle", "gmBrAskInput", "gmBrAskBody", "gmBrAskHtml",
  "gmBrFixOk", "gmBrFixText", "gmBrConflictHtml", "gmBrRepPickHtml", "gmBrRepChoose", "gmBrConflictMove", "gmBrFixUndo", "gmBrRepOpen", "gmBrRepSearch", "gmBrConflictPaint", "gmBrDraftMove", "gmMatField", "gmMatAddrFields", "gmMatSavedListHtml", "gmMatCalloutHtml",
  "gmBrDateHtml", "gmBrBarHtml", "gmBrBarInner", "gmBrCardPairsHtml", "gmBrTabsHtml", "gmBrOtherLine", "gmBrCardsHtml", "gmBrSheetTopHtml", "gmBrPairOfFind", "gmBrPlLinesHtml", "gmConReasonText", "gmMatDraftNumber", "gmMatEstimateSendBtnHtml", "gmMatEstimateCheckBtnHtml", "gmMatNewReady", "gmMatNewPicked", "gmMatNewRender", "gmMatServiceName", "gmMatIsoDate", "gmMatUsDate", "gmBrTodayIso", "gmBrMoney", "gmBrKey", "gmBrPairs", "gmBrStatus", "gmBrMulti", "gmBrReady", "gmBrFind", "gmBrDefault", "gmBrShort", "gmBrName"];
function uiWorld(lang, extra) {
  const calls = [];
  const w = world(lang, Object.assign({ gmBrContactsLoad: () => {}, gmApi: (path, opt) => { calls.push({ path, opt }); return new Promise(() => {}); }, gmMatDraftRender: () => { w.__drawn = (w.__drawn || 0) + 1; }, gmMatBatchRender: () => {}, gmToast: () => {},
    GM_MEASURE: {}, gmMatUi: () => true, gmMatDraftsEstAll: {}, gmMatDraftsEstSeen: {}, gmMatNew: null, gmPricingData: null, gmBrRepaintOpen: () => {} }, extra || {}));
  w.__calls = calls;
  vm.runInContext(["GM_MAT_SERVICES", "GM_BR_ASK_GROUP", "GM_BR_ASK_ORDER", "GM_MAT_MISSING", "GM_MAT_ICON", "gmBr"].map(variable).join("\n") + "\n" + NEWF.map(fn).join("\n"), w);
  return w;
}
const uen = uiWorld("en"), upt = uiWorld("pt");
// one name format
ok(uen.gmBrLabel({ branch: "340", branch_name: "Big Pine Roofing Com-Shop" }) === "Big Pine Roofing Com-Shop (340)", "a known branch name is shown as Name (number)");
ok(uen.gmBrLabel({ branch: "340", branch_name: "" }) === "Branch 340" && upt.gmBrLabel({ branch: "340" }) === "Filial 340" && uen.gmBrLabel({ branch: "340", branch_name: "340" }) === "Branch 340", "an unknown name is Branch number (never raw numbers like 2010466-2 / 340)");
ok(uen.gmBrAcct({ ship_to: "2010466-2", ship_to_name: "Zeta Roofing" }) === "Zeta Roofing" && uen.gmBrAcct({ ship_to: "2010466-2", ship_to_name: "" }) === "", "the account name is the second line, only when it is known");
uen.gmAbcPlStatus = { available: true, connected: true, branches_ready: true, pairs: PAIRS };
ok(uen.gmBrShort(PAIRS[0]) === uen.gmBrLabel(PAIRS[0]) && uen.gmBrName(PAIRS[1]) === "Orem (340)", "gmBrShort and gmBrName are the one function");
ok(/Tampa \(1234\)/.test(uen.gmBrTabsHtml("S1|1234", "f", false, "")) && /Orem \(340\)/.test(uen.gmBrOtherLine({ ship_to: "S1", branch: "340", branch_name: "Orem", carried: true, price: 1, uom: "EA" })), "tabs and the Available at lines use it");
ok(/Orem \(340\)/.test(uen.gmBrCardPairsHtml({ pairs: PAIRS })) && /Zeta Roofing/.test(uen.gmBrCardPairsHtml({ pairs: PAIRS })), "the ABC card in Settings uses it, with the account on a second line");
ok(/Orem \(340\)/.test(uen.gmBrCardsHtml(cmp, "S1|1234", "gmBrOrderFrom")) && /Branch 340/.test(uen.gmBrCardsHtml({ pairs: [{ ship_to: "S1", branch: "340", ship_to_name: "", branch_name: "", reason_code: "", carried_count: 1, line_count: 1, complete: true, total: 1, lines: [] }], recommended: null }, "", "x")), "the compare cards use it, and show Branch number when the name is empty");
const srcNoRaw = src.slice(src.indexOf("// ABC branches, delivery date or TBD"), src.indexOf("\nvar gmPricingCsvText = null;"));
ok(!/p\.branch_name \|\| p\.branch/.test(srcNoRaw) && !/\(p\.ship_to_name \|\| p\.ship_to\)/.test(srcNoRaw), "no screen draws raw branch text any more");
// names filled from ABC
const nm = uiWorld("en", { gmApi: (path) => Promise.resolve({ accounts: [{ ship_to: "S1", name: "Zeta Roofing", branches: [{ number: "1234", name: "Tampa" }, { number: "340", name: "Orem" }] }] }), gmCurrentTab: "x" });
nm.gmAbcPlStatus = { available: true, connected: true, branches_ready: true, pairs: [{ ship_to: "S1", branch: "340", ship_to_name: "", branch_name: "", is_default: true }] };
vm.runInContext(fn("gmBrNamesEnsure"), nm);
nm.gmBrNamesEnsure(); await new Promise((r) => setTimeout(r, 20));
ok(nm.gmAbcPlStatus.pairs[0].branch_name === "Orem" && nm.gmAbcPlStatus.pairs[0].ship_to_name === "Zeta Roofing" && nm.gmBr.namesAsked === true, "empty names are asked from ABC once per page load and filled");
nm.gmBrNamesEnsure(); ok(nm.gmBr.namesAsked === true, "and it is not asked twice");

// ── one branch name, everywhere (2026-11-16): the same string for the same pair, on every screen ──
{
  const NAMED = { ship_to: "S1", branch: "340", ship_to_name: "Zeta Roofing", branch_name: "Orem", is_default: true };
  const BARE = { ship_to: "S1", branch: "340", ship_to_name: "", branch_name: "", is_default: true };
  const surfaces = (lang, pair, other) => {
    const w = uiWorld(lang);
    w.gmAbcPlStatus = { available: true, connected: true, branches_ready: true, pairs: [pair, Object.assign({}, other, { is_default: false })] };
    const m = { id: "d1", ready: true, multi: true, busy: false, view: "edit", form: { lines: {} }, cmp: null, data: { pairs: [pair, Object.assign({}, other, { is_default: false })], draft: { ship_to_number: "S1", branch_number: "340", missing: [] }, lines: [{ id: "l1", description: "Shingle", uom: "BD", quantity: 1 }] } };
    w.gmMatDraft = m;
    const cmpData = { pairs: [Object.assign({ reason_code: "", carried_count: 1, line_count: 1, complete: true, total: 1, lines: [] }, pair)], recommended: null };
    m.cf = { cur: Object.assign({ lines: [] }, other), other: Object.assign({ lines: [{ line_id: "l1", item_number: "A", carried: false, price: 5 }] }, pair), fix: {}, pick: null };
    return {
      title: w.gmBrPairNameIn(m, w.gmBrDraftPair(m)),
      section: w.gmBrBranchSectionHtml(m),
      tabs: w.gmBrTabsHtml("S1|340", "f", false, ""),
      other: w.gmBrOtherLine(Object.assign({ carried: true, price: 1, uom: "EA" }, pair)),
      compare: w.gmBrCardsHtml(cmpData, "", "x"),
      conflict: w.gmBrConflictHtml(m),
      card: w.gmBrCardPairsHtml({ pairs: [pair] }),
      sheet: w.gmBrSheetTopHtml({ pair: { ship_to: "S1", branch: "340" } }),
      label: w.gmBrLabel(pair)
    };
  };
  const OTHER = { ship_to: "S1", branch: "1234", ship_to_name: "Zeta Roofing", branch_name: "Tampa" };
  for (const [lang, named, bare] of [["en", "Orem (340)", "Branch 340"], ["pt", "Orem (340)", "Filial 340"]]) {
    const a = surfaces(lang, NAMED, OTHER), b = surfaces(lang, BARE, OTHER);
    const names = Object.keys(a).filter((k) => k !== "label");
    ok(names.every((k) => a[k].indexOf(named) !== -1), lang + ": a known name shows as " + named + " on the order title, the branch section, tabs, available line, Compare, conflict screen and Settings card (missing: " + names.filter((k) => a[k].indexOf(named) === -1).join(",") + ")");
    ok(["title", "section", "tabs", "other", "compare", "conflict", "card"].every((k) => b[k].indexOf(bare) !== -1) && a.label === named && b.label === bare, lang + ": an unknown name shows as " + bare + " on those same screens, and the label is the same one string");
  }
  // the order screen's own list can lag behind the status read: the name that is known anywhere is the one shown
  const lag = uiWorld("en");
  lag.gmAbcPlStatus = { available: true, connected: true, branches_ready: true, pairs: [NAMED] };
  const lm = { data: { pairs: [BARE], draft: { missing: [] } } };
  ok(lag.gmBrPairNameIn(lm, { ship_to: "S1", branch: "340" }) === "Orem (340)", "an order screen whose own pair list has no name still shows the name the account list knows (never two strings for one pair)");
  ok(uiWorld("en").gmBrPairNameIn({ data: { pairs: [], draft: {} } }, { ship_to: "S1", branch: "340" }) === "Branch 340", "a pair nobody knows is Branch number");
  const rawUse = (src.match(/\.branch_name/g) || []).length;
  ok(/function gmBrLabel/.test(src) && !/escHtml\([^)]*\.branch_name/.test(src) && !/escHtml\([^)]*\.ship_to_name/.test(src), "no screen draws a raw name; every one goes through gmBrLabel (" + rawUse + " other mentions are data handling)");
}
// phone
ok(uen.gmBrPhone("5550100222") === "(555) 010-0222" && uen.gmBrPhone("15550100222") === "(555) 010-0222" && uen.gmBrPhone("(555) 010-0222") === "(555) 010-0222" && uen.gmBrPhone("12345") === "12345" && uen.gmBrPhone(null) === "", "a phone shows as (555) 010-0222; anything else is shown as typed");
ok(uen.gmBrPhoneDigits("(555) 010-0222") === "5550100222" && uen.gmBrPhoneDigits("+1 555 010 0222") === "5550100222", "and it is saved as digits only");
const peopleHtml = (() => { const w = uiWorld("en", { gmBrContactsLoad: () => {} }); vm.runInContext(fn("gmBrPeopleHtml"), w); w.gmBr.contacts = [{ id: "c1", name: "Sam", phone: "5550100222", email: "" }]; return w.gmBrPeopleHtml(w.gmBrNewDl(null, ""), "draft", "gmMat"); })();
ok(/\(555\) 010-0222/.test(peopleHtml) && !/5550100222/.test(peopleHtml), "a saved on-site person's phone is shown as (555) 010-0222, not raw digits");
// Portuguese Home sentence
const both = "This project already has contract CON-0034 (completed). Open it from the project.\u001eEste projeto já tem o contrato CON-0034 (concluído). Abra pelo projeto.";
ok(/^Este projeto/.test(upt.gmConReasonText(both)) && !/This project/.test(upt.gmConReasonText(both)) && /CON-0034/.test(upt.gmConReasonText(both)), "the Portuguese Home card shows the Portuguese reason (the contract number kept) and no English");
ok(/^This project/.test(uen.gmConReasonText(both)) && upt.gmConReasonText("unexpected error: x") === "unexpected error: x", "English shows English; an older one language reason is shown as it is");
// the questions block draws one question with its box
function askM2(lang, over) { const w = uiWorld(lang); const m = askM(Object.assign({ data: { lines: [{ id: "l1", unit_price: 5, description: "Shingle", uom: "BD" }], draft: { missing: [] }, locations: [] } }, over || {})); return { w, m }; }
{
  const { w, m } = askM2("en", { locMode: "" }); m.form.service = ""; m.form.dateMode = ""; m.form.dcName = ""; m.form.dcPhone = ""; m.form.contact_email = ""; m.sigChecked = w.gmBrSig(m);
  let h = w.gmBrAskHtml(m);
  ok(/How should it be delivered\?/.test(h) && /Question 1 of 5/.test(h) && !/When should it be delivered/.test(h) && (h.match(/gm-seg-btn/g) || []).length === 7, "the first question asks how it should be delivered, with the seven choices, and only that question");
  m.form.service = "OTG"; h = w.gmBrAskHtml(m);
  ok(/When should it be delivered\?/.test(h) && /Pick a date/.test(h) && /TBD, put the order on hold/.test(h) && !/aria-pressed="true"/.test(h), "answering it brings the next question: the date; neither choice is preselected");
  m.form.dateMode = "tbd"; h = w.gmBrAskHtml(m);
  ok(/Who will be at the job\?/.test(h) && /id="gmAskDcName"/.test(h) && /id="gmAskDcPhone"/.test(h), "then who will be at the job, with Name and Phone boxes");
  m.form.dcName = "Sam"; m.form.dcPhone = "5550100222"; h = w.gmBrAskHtml(m);
  ok(/Where does it go\?/.test(h) && /Job address/.test(h) && /Saved location/.test(h) && /New location/.test(h), "then where does it go: job address, saved location, new location");
  m.locMode = "job"; m.form.ja = { line1: "12 Main St", city: "", state: "", postal: "" }; h = w.gmBrAskHtml(m);
  ok(/Where does it go\?/.test(h) && /value="12 Main St"/.test(h) && /gmMatCity_ja/.test(h) && /gmMatSt_ja/.test(h) && /gmMatZip_ja/.test(h), "a one line address: the street is prefilled and city, state and zip are asked in the same block");
  m.form.ja = { line1: "12 Main St", city: "Tampa", state: "FL", postal: "33602" }; m.form.contact_email = ""; h = w.gmBrAskHtml(m);
  ok(/Who is your contact for ABC\?/.test(h) && /id="gmAskCName"/.test(h) && /id="gmAskCEmail"/.test(h) && /id="gmAskCPhone"/.test(h), "then your contact for ABC: name, email, phone");
  m.form.contact_email = "o@z.example"; m.sync = "pending"; h = w.gmBrAskHtml(m);
  ok(/Checking/.test(h) && !/Ready to send/.test(h), "all answered but not checked yet: the block says Checking, never Ready");
  m.sync = "ok"; m.sigChecked = w.gmBrSig(m); h = w.gmBrAskHtml(m);
  ok(/Ready to send/.test(h) && !/gm-seg-btn/.test(h), "when the list is empty the block says Ready to send");
  m.data.draft.missing = ["location_name_taken"]; m.locMode = "new"; m.form.nl = { name: "Warehouse", line1: "1 A St", city: "T", state: "FL", postal: "33602" }; m.sigChecked = w.gmBrSig(m); h = w.gmBrAskHtml(m);
  ok(!/Ready to send/.test(h) && /already exists/.test(h), "a location name taken by another address is asked, with the reason in words");
  const bar = w.gmBrBarHtml(m);
  ok(/id="gmBrReviewBtn" disabled/.test(bar) && !/Ready to send/.test(bar), "Review and send is off while the Worker's list has an item");
  const bar2 = w.gmBrBarHtml(Object.assign(askM(), { sigChecked: undefined }));
  ok(/disabled/.test(bar2) && /Checking/.test(bar2), "an unchecked screen: the button is off and the bar says Checking");
  const good = askM(); good.sigChecked = w.gmBrSig(good);
  ok(!/id="gmBrReviewBtn" disabled/.test(w.gmBrBarHtml(good)) && /Ready to send/.test(w.gmBrBarHtml(good)), "answered and checked: the button is on and the bar says Ready to send");
  ok(!/gm-bar-link/.test(w.gmBrBarHtml(m)) && !/Still needed/.test(w.gmBrBarHtml(m)), "no 'Still needed' links in the bar");
}
{
  const { w, m } = askM2("pt", { locMode: "" }); m.form.service = ""; m.sigChecked = w.gmBrSig(m);
  ok(/Como deve ser a entrega\?/.test(w.gmBrAskHtml(m)), "the questions are in Portuguese too");
}
// every sentence from the Worker's readiness list that the Worker can send has a question (nothing falls through unasked)
for (const k of ["delivery_service", "delivery_date", "delivery_contact_name", "delivery_contact_phone", "delivery_place", "delivery_place_complete", "location_name_taken", "contact_name", "contact_email", "contact_phone", "quantity", "item_description", "item_length", "line_price", "order_ref", "job_name", "branch", "lines", "order_fields", "person_name"]) {
  ok(!!uen.GM_BR_ASK_GROUP[k], "the readiness key " + k + " is asked as a question");
}
// the conflict screen and Replace
function cfM(lang) {
  const w = uiWorld(lang);
  const m = { id: "d1", ready: true, multi: true, busy: false, view: "conflict", form: { lines: {} }, data: { pairs: PAIRS, draft: { missing: [] }, lines: [{ id: "l1", description: "Espresso 20 Linear ft ridge cap", uom: "BD", quantity: 4 }, { id: "l2", description: "Shingle", uom: "BD", quantity: 2 }] } };
  w.gmMatDraft = m;
  m.cf = { cur: cmp.pairs[0], other: { ship_to: "S1", branch: "340", ship_to_name: "Zeta Roofing", branch_name: "Orem", lines: [{ line_id: "l1", item_number: "A", carried: false, price: 86.25 }, { line_id: "l2", item_number: "B", carried: true, price: 9 }] }, fix: {}, pick: null };
  return { w, m };
}
{
  const { w, m } = cfM("en");
  let h = w.gmBrConflictHtml(m);
  ok(/Replace this item/.test(h) && /id="gmBrConflictGo" disabled/.test(h), "the final button 'Order everything from Orem (340)' starts off");
  ok(/Order everything from Orem \(340\)/.test(h) && /\$86\.25/.test(h) && /class="gm-price">\$86\.25/.test(h), "prices are in their own nowrap cell (never '$86. 25' across two lines)");
  w.gmBrRepOpen("l1"); // sets the picker on the draft: the real function draws through gmMatDraftRender, here a stub
  ok(m.cf.pick && m.cf.pick.lineId === "l1", "Replace this item opens the picker (the picker belongs to that line)");
  h = w.gmBrConflictHtml(m);
  ok(/id="gmBrRepQ"/.test(h) && /Search at Orem \(340\)/.test(h) && /gmBrRepSearch\(\)/.test(h), "the picker has a search box on the OTHER branch");
  w.gmBrRepSearch(); ok(m.cf.pick.err !== "" && w.__calls.length === 0, "a search under 3 letters asks for more and calls nothing");
  m.cf.pick.q = "ridge"; w.gmBrRepSearch();
  ok(w.__calls.length === 1 && /^abc\/items\?q=ridge&ship_to=S1&branch=340$/.test(w.__calls[0].path), "the search asks the other branch's items");
  m.cf.pick.loading = false; m.cf.pick.items = [{ item_number: "RIDGE9", description: "Ridge cap shingle", unit_code: "BD", unit_name: "Bundle", cost: 55, has_price: true }, { item_number: "NOP", description: "No price one", unit_code: "BD", has_price: false }];
  h = w.gmBrConflictHtml(m);
  ok(/\$55\.00 per Bundle/.test(h) && /Use this item/.test(h) && (h.match(/Use this item/g) || []).length === 2 && /disabled onclick="gmBrRepChoose\(1\)"/.test(h), "results show prices; one tap chooses; an item with no price cannot be chosen");
  w.gmBrRepChoose(0);
  ok(m.cf.fix.l1 && m.cf.fix.l1.item_number === "RIDGE9" && m.cf.fix.l1.qty === "4" && m.cf.pick === null, "choosing records the substitute for THAT line (same unit: the quantity is carried over)");
  h = w.gmBrConflictHtml(m);
  ok(/Will be replaced by Ridge cap shingle/.test(h) && />Undo</.test(h) && !/id="gmBrConflictGo" disabled/.test(h), "the line says Will be replaced by <item>, offers Undo, and the final button turns on once every unavailable line is handled");
  w.gmBrFixUndo("l1"); h = w.gmBrConflictHtml(m);
  ok(m.cf.fix.l1 === undefined && /id="gmBrConflictGo" disabled/.test(h) && /Replace this item/.test(h), "Undo takes the substitute back and the final button goes off again");
  m.cf.fix.l1 = "replace";
  ok(!w.gmBrFixOk("replace") && /id="gmBrConflictGo" disabled/.test(w.gmBrConflictHtml(m)), "the old 'replace' mark with no chosen item no longer counts: the button stays off");
  m.cf.fix.l1 = { item_number: "R", description: "Ridge", uom: "EA", qty: "", cost: 1 };
  ok(/id="gmBrConflictGo" disabled/.test(w.gmBrConflictHtml(m)) && !w.gmBrFixOk(m.cf.fix.l1), "a substitute in another unit with no quantity typed keeps the button off");
  m.cf.fix.l1 = "remove";
  ok(!/id="gmBrConflictGo" disabled/.test(w.gmBrConflictHtml(m)) && /Will be removed/.test(w.gmBrConflictHtml(m)), "removing counts too");
  // nothing changes before the final button
  ok(w.__calls.length === 1, "nothing was sent while choosing (only the one search)");
  m.cf.fix.l1 = { item_number: "RIDGE9", description: "Ridge cap shingle", uom: "BD", qty: "4", cost: 55 };
  let moved = null; w.gmBrDraftMove = (c, rm, after, add) => { moved = { c, rm, add }; };
  w.gmBrConflictMove();
  ok(moved && moved.c.branch === "340" && moved.rm.join() === "l1" && moved.add.length === 1 && moved.add[0].item_number === "RIDGE9" && moved.add[0].quantity === 4 && moved.add[0].uom === "BD" && moved.add[0].abc_description === "Ridge cap shingle", "the final button replaces the lines and saves everything in one go (remove the old line, add the chosen item)");
  const incomplete = cfM("en"); let ran = false; incomplete.w.gmBrDraftMove = () => { ran = true; }; incomplete.w.gmBrConflictMove();
  ok(ran === false, "the final button does nothing while a line is not handled");
}
{
  const { w, m } = cfM("pt");
  ok(/Trocar este item/.test(w.gmBrConflictHtml(m)) && /Pedir tudo de Orem \(340\)/.test(w.gmBrConflictHtml(m)), "the conflict screen is in Portuguese too");
}
// layout: the sheet fits 390 px (stylesheet rules, see below)
const cssRule = (sel) => { const i = css.indexOf(sel + " {"); return i < 0 ? "" : css.slice(i, css.indexOf("}", i) + 1); };
ok(/grid-template-columns: minmax\(0, 1fr\)/.test(cssRule(".gm-br-cards")) && /min-width: 0/.test(cssRule(".gm-br-cards")), "the cards grid has a column that can shrink (minmax(0, 1fr)): stacked on a phone");
ok(/min-width: 0/.test(cssRule(".gm-br-card")) && /overflow-wrap: anywhere/.test(cssRule(".gm-br-card")) && /\.gm-br-card \* \{ min-width: 0; overflow-wrap: anywhere; \}/.test(css), "every card text can wrap: min-width 0 and overflow-wrap anywhere on the card and what is in it");
ok(/white-space: nowrap/.test(cssRule(".gm-price")) && /\.gm-br-name \{ flex: 1 1 0; min-width: 0; overflow-wrap: anywhere; \}/.test(css), "the price is a nowrap cell and the item name wraps beside it");
ok(/\.gm-br-line span:first-child \{ flex: 1 1 0; min-width: 0/.test(css) && /\.gm-callout-k \{[^}]*min-width: 0/.test(css) && /\.gm-callout \{ min-width: 0; max-width: 100%/.test(css), "lines and callout rows shrink their text instead of pushing the sheet wider");
ok(/@media \(min-width: 720px\) \{ \.gm-br-cards \{ grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 260px\), 1fr\)\)/.test(css), "side by side only when there is room (720 px and up)");
// orders without a contract: the number, the gold button, the New order screen
ok(uen.gmMatDraftNumber({ contract_number: "CON-0034" }) === "CON-0034" && uen.gmMatDraftNumber({ estimate_number: "EST-0012" }) === "EST-0012" && uen.gmMatDraftNumber({ source_kind: "manual" }) === "New order" && upt.gmMatDraftNumber({ source_kind: "manual" }) === "Novo pedido", "the number shown is the contract, the estimate number, or the words New order");
{
  const w = uiWorld("en", { gmMatDraftsEstAll: { e1: [{ id: "d1" }] }, gmMatDraftsEstSeen: { e1: true } });
  const btn = w.gmMatEstimateSendBtnHtml({ id: "e1", stored_status: "accepted" });
  ok(/btn-gold gm-add-btn gm-send-abc/.test(btn) && /Send materials order to ABC/.test(btn) && /gmMatDraftOpen\('d1'\)/.test(btn), "an accepted estimate with a ready order shows the same gold button as the contract");
  ok(w.gmMatEstimateSendBtnHtml({ id: "e1", stored_status: "sent" }) === "" && w.gmMatEstimateSendBtnHtml({ id: "e2", stored_status: "accepted" }) === "", "no button for an estimate that is not accepted or has no order");
  const w2 = uiWorld("en", { gmMatDraftsEstAll: { e1: [{ id: "d1" }, { id: "d2" }] } });
  const b2 = w2.gmMatEstimateSendBtnHtml({ id: "e1", stored_status: "accepted" });
  ok(/Send materials orders \(2\)/.test(b2) && /gmMatOrdersOpen\(\['d1','d2'\]\)/.test(b2), "two orders: Send materials orders (2), both ticked for Batch order");
  ok(/Check for ABC items/.test(w.gmMatEstimateCheckBtnHtml({ id: "e9", stored_status: "accepted" })) && w.gmMatEstimateCheckBtnHtml({ id: "e1", stored_status: "accepted" }) === "" && w.gmMatEstimateCheckBtnHtml({ id: "e9", stored_status: "sent" }) === "", "an accepted estimate nobody has checked offers a plain Check for ABC items; one that was checked offers nothing");
}
{
  const w = uiWorld("en"); const m = { name: "Quick repair", items: [{ id: "p1", item: "Pipe boot", abc_item_number: "EACH0001", abc_unit: "EA" }, { id: "p2", item: "Paver", abc_item_number: "P", abc_unit: "PL" }], qty: {}, busy: false };
  ok(!w.gmMatNewReady(m), "New order: no quantity yet, the button stays off");
  m.qty.p1 = "4"; ok(w.gmMatNewReady(m) && JSON.stringify(w.gmMatNewPicked(m)) === JSON.stringify([{ price_list_id: "p1", quantity: 4 }]), "a job name and one quantity: ready, and it sends the Price list row id and the quantity");
  m.qty.p2 = "0"; ok(w.gmMatNewPicked(m).length === 1, "a zero quantity is not picked");
  m.name = "<b>x</b>"; ok(!w.gmMatNewReady(m), "an unsafe job name is not accepted on the page either");
}
// Already on your Price list
ok(/Already on your Price list: /.test(src) && /Já está na sua lista de preços: /.test(src) && /s\.reason === "already_linked"/.test(src), "an item already on the Price list is named in the result: Already on your Price list: <name>");
ok(/if \(f\.result\.created\.length\) \{ body \+=/.test(src), "the 'N items added' line shows only when something was added");
// Mark accepted
ok(/A materials order is ready\./.test(src) && /materials_order/.test(src) && /gmMatEstimateSendBtnHtml\(est\) \+ gmMatEstimateCheckBtnHtml\(est\);\s*\n\s*body \+= '<a class="gm-btn-secondary" href="' \+ escHtml\(est\.link\)/.test(src), "Mark accepted says A materials order is ready, and the estimate sheet puts the button above Preview as customer");
ok(/'<\/button>' \+ gmMatEstimateSendBtnHtml\(e\);/.test(src), "the estimate list row shows the button too");
ok(/function gmMatDraftsFresh/.test(src) && /abc\/drafts\/ensure", \{ method: "POST", body: \{ estimate_id: estimateId \}/.test(src), "the page asks for the list and can ask for an estimate's order; a 404 simply shows nothing (the load already ignores 503 and 409)");

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
