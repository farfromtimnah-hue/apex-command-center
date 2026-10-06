// RES-28: the "Before you send" card becomes a checklist; the booking preset
// switch gets an Undo instead of a browser pop-up; the Home headings follow
// the language switch.
// Runs the real Worker functions (cut out of worker/index.js) and the real
// gm.js functions against the real data files. No network, no production
// database, nothing written.
//   node scripts/test-state-checklist.mjs
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { buildComposer, FLORIDA_FIXTURES, goldenView, GOLDEN_DIR } from "./fixtures/contract-compose-harness.mjs";
import { fnSrc, varSrc } from "./fixtures/d1-shim.mjs";
import { allLines, reviewText } from "./make-state-checklist-review.mjs";

const root = new URL("../", import.meta.url);
const workerSrc = readFileSync(new URL("worker/index.js", root), "utf8");
const h = await buildComposer(workerSrc);
const riders = JSON.parse(readFileSync(new URL("data/contract-state-riders-v1.json", root), "utf8"));
const sorting = JSON.parse(readFileSync(new URL("data/contract-state-checklist-v1.json", root), "utf8"));
const gm = readFileSync(new URL("gm.js", root), "utf8"), ios = readFileSync(new URL("ios/App/App/public/gm.js", root), "utf8");
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
function stateFx(base, code, patch) { return fx(base, Object.assign({ flags: { job_state: code } }, patch || {})); }
function cut(src, name) { const i = src.indexOf("\nfunction " + name + "("); if (i < 0) { throw new Error("not in gm.js: " + name); } const j = src.indexOf("\n}", i + 1); return src.slice(i + 1, j + 2); }
function card(r) { return F.contractStateActionCard(r.comp.state, r.comp.checklist, r.c.flags); }
// Since "the system does it" (RES-35) a line is hand-ticked only when its kind is "person".
function hand(c) { return c.actions.filter(function (a) { return (a.kind || "person") === "person"; }); }
function handDone(c) { return hand(c).filter(function (a) { return a.done; }).length; }
function sysDone(c) { return c.actions.filter(function (a) { return a.sys && a.sys.done; }).length; }
const NON_FL = riders.states.map(function (s) { return s.code; }).filter(function (c) { return c !== "FL"; });
const PICKS = ["TX", "CA", "MA"];

// ── 1. The builder data: action lines with a reference and the full text ──
{
  for (const code of PICKS) {
    const r = await h.compose(stateFx("residential-in-home-deposit", code)), c = card(r);
    ok(c && c.state === code && c.actions.length >= 3 && c.total === c.actions.length && handDone(c) === 0 && c.done_count === sysDone(c), code + ": the card has action lines (" + (c && c.actions.length) + "), none hand-ticked on a new contract");
    ok(c.actions.every(function (a) { return a.en && a.pt && a.en !== a.pt && a.context_en && a.context_pt && a.key; }), code + ": every action line has a sentence in English and Portuguese and the full text behind it");
    ok(c.actions.filter(function (a) { return a.ref; }).length >= 3 && c.actions.every(function (a) { return a.ref === null || typeof a.ref === "string"; }), code + ": action lines carry a law reference");
    ok(c.actions.every(function (a) { return r.comp.checklist.some(function (l) { return l.key === a.key && l.en === a.context_en && l.pt === a.context_pt; }); }), code + ": the full text behind each line is the existing prose for that item, word for word");
    ok(c.actions.length + c.more.length === r.comp.checklist.length && c.more.every(function (m) { return !c.actions.some(function (a) { return a.key === m.key; }); }), code + ": every old line is either an action or under More, never both, none lost");
    ok(c.actions.every(function (a) { return a.en.length <= 150; }), code + ": action sentences are short (150 characters at most)");
  }
  const tx = card(await h.compose(stateFx("residential-in-home-deposit", "TX")));
  const spouses = tx.actions.filter(function (a) { return a.key === "written_contract"; })[0];
  ok(spouses && spouses.en === "Get both spouses to sign before work starts, if the customer is married" && spouses.ref === "Tex. Prop. Code 53.254" && /both spouses if married/.test(spouses.context_en), "Texas: \"Get both spouses to sign before work starts, if the customer is married\" (Tex. Prop. Code 53.254), with the research text behind it");
  const homestead = tx.actions.filter(function (a) { return a.key === "notice:TX-homestead"; })[0];
  ok(homestead && homestead.ref === "Tex. Prop. Code 41.007" && /^https:\/\//.test(homestead.source_url), "Texas: a notice line carries the official source address from the data");
  ok(tx.more.some(function (m) { return m.key === "cancellation_deadline"; }) && tx.more.some(function (m) { return m.key === "notice:TX-cancel"; }) && tx.more.some(function (m) { return m.key === "status"; }) && !tx.actions.some(function (a) { return /^(cancellation|cancellation_deadline|status|notice:TX-cancel)$/.test(a.key); }),
    "Texas: the cancellation deadline, a notice that prints and the research status are NOT checklist lines; they stay under More");
  const ca = card(await h.compose(stateFx("residential-in-home-deposit", "CA")));
  ok(ca.actions.some(function (a) { return a.key === "deposit_over" && /\$1,000\.00/.test(a.en) && /\$1,000\.00/.test(a.pt); }), "California: a first payment over the cap is an action line that names the cap in US money");
  const maNoLic = card(await h.compose(stateFx("residential-in-home-deposit", "MA", { doc: { license_numbers: [] } })));
  const maLic = card(await h.compose(stateFx("residential-in-home-deposit", "MA")));
  ok(maNoLic.actions.some(function (a) { return a.key === "license_number"; }) && !maLic.actions.some(function (a) { return a.key === "license_number"; }) && maLic.more.some(function (m) { return m.key === "license_number"; }),
    "Massachusetts: \"Add your license number\" is an action only while no number is on file; with a number it is handled");
  const txNoLic = card(await h.compose(stateFx("residential-in-home-deposit", "TX", { doc: { license_numbers: [] } })));
  ok(txNoLic.actions.some(function (a) { return a.key === "license_local"; }) && !txNoLic.actions.some(function (a) { return a.key === "license" || a.key === "license_number"; }), "Texas (no state license): one license line, worded as a check of the city or county");
  const nc = card(await h.compose(stateFx("pool-job", "NC", { selections: { C14: "C14-C" } })));
  ok(nc.actions.some(function (a) { return a.key === "risky:C14-C" && /clause C14-C/.test(a.en) && /North Carolina/.test(a.en); }) && nc.actions.some(function (a) { return a.key === "pool"; }), "North Carolina: a flagged clause that is chosen, and a pool job, are action lines");
}

// ── 2. All 50 states and DC: the sorting file is complete and consistent ──
{
  const bad = [];
  ok(Object.keys(sorting.states).sort().join() === NON_FL.slice().sort().join() && !sorting.states.FL, "the sorting file has a block for every state and DC except Florida");
  for (const code of NON_FL) {
    const r = allLines(code), keys = {};
    r.lines.forEach(function (l) { keys[l.key] = l; });
    const rows = sorting.states[code].lines;
    Object.keys(rows).forEach(function (k) {
      if (!keys[k]) { bad.push(code + ": a row for a line that does not exist: " + k); }
      const e = rows[k];
      if (["A", "H", "B"].indexOf(e.c) === -1) { bad.push(code + " " + k + ": class " + e.c); }
      if (e.c === "A" && (!e.en || !e.pt || /[.]$/.test(e.en) || /[.]$/.test(e.pt))) { bad.push(code + " " + k + ": an action needs both sentences, with no full stop"); }
      if (e.c !== "A" && !e.why) { bad.push(code + " " + k + ": no reason given"); }
    });
    // Every notice whose wording is not loaded, every research item and every
    // extra note was sorted by hand: none falls through to a default.
    r.lines.forEach(function (l) {
      if (/^(item|extra):/.test(l.key) && !rows[l.key]) { bad.push(code + ": research line not sorted: " + l.key); }
      if (/^notice:/.test(l.key) && l.variant !== "prints" && !rows[l.key]) { bad.push(code + ": notice not sorted: " + l.key); }
    });
    (riders.riders[code].notices || []).forEach(function (n) { if (!n.text && !rows["notice:" + n.id]) { bad.push(code + ": notice with no wording loaded has no row: " + n.id); } });
    const c = F.contractStateActionCard(r.st, r.lines, {});
    c.actions.forEach(function (a) {
      if (!a.en || !a.pt || !a.context_en || /\{[a-z_]+\}/.test(a.en + a.pt)) { bad.push(code + " " + a.key + ": action incomplete or with an unfilled placeholder"); }
      if (a.ref !== null && !String(a.ref).trim()) { bad.push(code + " " + a.key + ": empty reference"); }
    });
    if (!c.actions.length) { bad.push(code + ": no action line at all"); }
  }
  if (bad.length) { console.log(bad.slice(0, 20).join("\n")); }
  ok(bad.length === 0, "for all 50: every row points at a real line, every action has both sentences, every unloaded notice, research item and extra note was sorted by hand");
  ok(Object.keys(sorting.generic).every(function (k) { const e = sorting.generic[k]; return e.c === "A" ? !!(e.en && e.pt) : !!e.why; }), "the rules every state shares are complete");
  ok(readFileSync(new URL("scripts/fixtures/state-checklist-review.txt", root), "utf8") === reviewText, "scripts/fixtures/state-checklist-review.txt matches the sorting file (regenerate it after a change)");
  ok(/################ Texas \(TX\)/.test(reviewText) && /################ District of Columbia \(DC\)/.test(reviewText) && (reviewText.match(/\n################ /g) || []).length === 51 && /ACTION {6}Get both spouses to sign before work starts, if the customer is married \(Tex\. Prop\. Code 53\.254\)/.test(reviewText) && /UNSURE: /.test(reviewText) && /HANDLED {5}/.test(reviewText) && /BACKGROUND {2}/.test(reviewText),
    "the review file has one block per state (51), with ACTION / HANDLED / BACKGROUND rows, the reference and the UNSURE marks");
}

// ── 3. A tick is saved in flags with who and when, and comes back ─────────
{
  const r = await h.compose(stateFx("residential-in-home-deposit", "TX"));
  const before = card(r), key = "written_contract";
  const checks = F.contractStateCheckApply(r.c.flags, before, key, true, "Maria", "2026-10-05 20:12:00");
  ok(checks && checks.state === "TX" && checks.done[key].by === "Maria" && checks.done[key].at === "2026-10-05 20:12:00", "a tick is stored as flags.state_checks = { state, done: { line: { by, at } } }");
  ok(F.contractStateCheckApply(r.c.flags, before, "not-a-line", true, "Maria", "x") === null && F.contractStateCheckApply(r.c.flags, before, "cancellation_deadline", true, "Maria", "x") === null, "a key that is not one of this contract's action lines stores nothing");

  // The SQL that ships, run on an in-memory SQLite: only state_checks is written.
  const sql = new Function(varSrc("CONTRACT_STATE_CHECKS_SQL", workerSrc) + "\nreturn CONTRACT_STATE_CHECKS_SQL;")();
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE gm_contracts (id TEXT, client_id TEXT, status TEXT, flags_json TEXT, selections_json TEXT)");
  const flagsJson = JSON.stringify(r.c.flags);
  db.prepare("INSERT INTO gm_contracts VALUES ('con-1','client-1','sent',?,'{\"C01\":\"C01-A\"}'), ('con-2','client-1','void',?,NULL), ('con-3','client-1','draft',NULL,NULL), ('con-1','client-2','draft',?,NULL)").run(flagsJson, flagsJson, flagsJson);
  ["con-1", "con-2", "con-3"].forEach(function (id) { db.prepare(sql).run(JSON.stringify(checks), id, "client-1"); });
  const row = function (id, client) { return db.prepare("SELECT * FROM gm_contracts WHERE id = ? AND client_id = ?").get(id, client); };
  const saved = JSON.parse(row("con-1", "client-1").flags_json);
  ok(saved.job_state === "TX" && saved.sold_in_home === true && saved.property_type === "single_family" && JSON.stringify(saved.state_checks) === JSON.stringify(checks) && row("con-1", "client-1").selections_json === "{\"C01\":\"C01-A\"}",
    "the saved tick sits in flags_json beside job_state; every other flag and column is untouched (a sent contract can still be ticked)");
  ok(row("con-2", "client-1").flags_json === flagsJson && row("con-1", "client-2").flags_json === flagsJson && JSON.parse(row("con-3", "client-1").flags_json).state_checks.state === "TX", "a void contract and another business's contract are not written; a contract with no flags yet takes the tick");

  // Reload: the stored JSON goes back through the same card builder.
  const reloaded = await h.compose(stateFx("residential-in-home-deposit", "TX", { flags: saved }));
  const after = card(reloaded), line = after.actions.filter(function (a) { return a.key === key; })[0];
  ok(after.done_count === 1 + sysDone(after) && after.total === before.total && line.done.by === "Maria" && line.done.at === "2026-10-05 20:12:00" && handDone(after) === 1, "after a reload the line is ticked, with who and when; the other hand-ticked lines are not");
  const second = F.contractStateCheckApply(saved, after, "cancellation_oral", true, "Pat Owner", "2026-10-06 13:00:00");
  ok(Object.keys(second.done).length === 2 && second.done[key].by === "Maria" && second.done["cancellation_oral"].by === "Pat Owner", "a second person's tick is added beside the first: the owner sees who ticked what");
  const unticked = F.contractStateCheckApply(saved, after, key, false, "Pat Owner", "2026-10-06 13:05:00");
  ok(Object.keys(unticked.done).length === 0 && handDone(card(await h.compose(stateFx("residential-in-home-deposit", "TX", { flags: Object.assign({}, saved, { state_checks: unticked }) })))) === 0, "unticking removes the record");

  // ── 4. Changing the state does not carry ticks over ──
  const moved = await h.compose(stateFx("residential-in-home-deposit", "MA", { flags: Object.assign({}, saved, { job_state: "MA" }) }));
  const movedCard = card(moved);
  ok(movedCard.state === "MA" && handDone(movedCard) === 0 && hand(movedCard).every(function (a) { return a.done === null; }) && movedCard.actions.some(function (a) { return a.key === "written_contract" || a.key === "fixed:1"; }) && saved.state_checks.done[key],
    "a contract moved from Texas to Massachusetts shows nothing ticked, even for a line both states share");
  ok(Object.keys(F.contractStateChecks(saved, "MA")).length === 0 && Object.keys(F.contractStateChecks(saved, "TX")).length === 1 && Object.keys(F.contractStateChecks({ state_checks: { state: "TX", done: [1] } }, "TX")).length === 0, "ticks are read for the state they were made in only");
  const put = fnSrc("handlePutGmContract", workerSrc);
  ok(/if \(flags\.state_checks && flags\.state_checks\.state !== comp\.state\.code\) \{ delete flags\.state_checks; \}/.test(put) && put.indexOf("delete flags.state_checks") < put.indexOf("UPDATE gm_contracts SET selections_json"), "saving a contract in another state drops the old state's ticks before the write");
  const maKey = hand(movedCard)[0].key;
  const tickBack = F.contractStateCheckApply(Object.assign({}, saved, { job_state: "MA" }), movedCard, maKey, true, "Maria", "2026-10-07 10:00:00");
  ok(tickBack.state === "MA" && Object.keys(tickBack.done).length === 1 && tickBack.done[maKey], "the first tick in the new state starts a fresh record for that state");
  const revise = fnSrc("handlePostGmContractRevise", workerSrc);
  ok(/state_checks: undefined/.test(revise), "a revision starts with nothing ticked");
}

// ── 5. Unticked lines never stop a send, a signature or a preview ─────────
{
  for (const code of PICKS) {
    const none = await h.compose(stateFx("residential-in-home-deposit", code));
    const c = card(none);
    const all = { state: code, done: {} };
    c.actions.forEach(function (a) { all.done[a.key] = { by: "Maria", at: "2026-10-05 20:12:00" }; });
    const ticked = await h.compose(stateFx("residential-in-home-deposit", code, { flags: { job_state: code, state_checks: all } }));
    ok(none.comp.blockers.length === 0 && handDone(c) === 0 && c.total > 0, code + ": with every line unticked the contract has no blocker");
    ok(JSON.stringify(goldenView(none.comp)) === JSON.stringify(goldenView(ticked.comp)) && JSON.stringify(none.comp.checklist) === JSON.stringify(ticked.comp.checklist), code + ": the composed contract (every printed word, rule, blocker and amount) is the same with nothing ticked and with everything ticked");
  }
  const gates = ["handlePostGmContractSend", "handlePostGmContractCompanySign", "handlePostGmContractRoute", "handlePostPublicContractSign", "handleGetGmContractPreview", "handlePostGmContractSignedCopy", "contractPublicPayload", "contractPublicView", "contractCompose", "contractCleaningCompose"];
  ok(gates.every(function (n) { const s = fnSrc(n, workerSrc); return !/state_checks|state_card|contractStateActionCard|contractStateCheckApply|contractStateChecks\(|contractStateCheckEntry/.test(s); }), "send, company sign, route, customer sign, preview, signed copy, the customer's view and the composer never read the ticks");
  ok((workerSrc.match(/state_card:/g) || []).length === 1 && /state_card: contractStateCardFor\(contractStateActionCard\(comp\.state, comp\.checklist, c\.flags, comp\.state\.florida \? null : await contractStateSysLoad\(env, c\)\), /.test(fnSrc("contractInternalOut", workerSrc)), "the card goes out in one place only: the builder's own payload");
  const put = fnSrc("handlePutGmContract", workerSrc);
  ok(/var tickOnly = /.test(put) && /contractSellerGuard\(env, user, id, c, tickOnly\)/.test(put) && put.indexOf("if (tickOnly) {") < put.indexOf("Create a revision to change it"), "a tick is its own small save: the seller guard still runs (a routed seller may tick), and it is handled before the \"already signed\" refusal");
}

// ── 6. Florida is unchanged ───────────────────────────────────────────────
for (const name of Object.keys(FLORIDA_FIXTURES)) {
  const golden = JSON.stringify(JSON.parse(readFileSync(new URL("state-riders-golden-" + name + ".json", GOLDEN_DIR), "utf8")));
  const fl = await h.compose(fx(name, { flags: { job_state: "FL" } }));
  const stray = await h.compose(fx(name, { flags: { job_state: "FL", state_checks: { state: "TX", done: { "fixed:1": { by: "Maria", at: "2026-10-05 20:12:00" } } } } }));
  ok(JSON.stringify(goldenView(fl.comp)) === golden && JSON.stringify(goldenView(stray.comp)) === golden, "Florida golden file, byte for byte (also with a stray tick record in flags): " + name);
  ok(card(fl) === null && fl.comp.checklist === null && card(stray) === null, "Florida has no card: " + name);
}

// ── 7. The card as gm.js draws it (real functions, stubbed page) ──────────
{
  const dt = readFileSync(new URL("datetime.js", root), "utf8");
  const formatDateTimeUTC = new Function(cut(dt, "formatDateTimeUTC") + "\nfunction formatDateTime(s) { return 'RAW ' + s; }\nreturn formatDateTimeUTC;")();
  function draw(c, en) {
    const stubs = { gmT: function (pt, e) { return en ? e : pt; }, isEn: function () { return en; }, formatDateTimeUTC: formatDateTimeUTC,
      escHtml: function (x) { return String(x === null || x === undefined ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); } };
    const names = Object.keys(stubs);
    return new Function(...names, cut(gm, "gmConStateCardHtml") + "\n" + cut(gm, "gmConStateLinksHtml") + "\nreturn gmConStateCardHtml;")(...names.map(function (k) { return stubs[k]; }))(c);
  }
  const r = await h.compose(stateFx("residential-in-home-deposit", "TX"));
  const payload = function (flags, status) { return { status: status || "draft", job_state_name: "Texas", state_checklist: r.comp.checklist, state_card: F.contractStateActionCard(r.comp.state, r.comp.checklist, flags) }; };
  const n = payload({}).state_card.total;
  // sd = the lines the system has already done on a new Texas contract (the
  // notices it prints); sn = every line the system does or sees; hn = hand-ticked lines.
  const sd = sysDone(payload({}).state_card), hn = hand(payload({}).state_card).length, sn = n - hn;
  const en = draw(payload({}), true), pt = draw(payload({}), false);
  ok(sd >= 2 && sn > sd && en.indexOf("Before you send: Texas (" + sd + " of " + n + " done)") !== -1 && pt.indexOf("Antes de enviar: Texas (" + sd + " de " + n + " feitos)") !== -1, "heading shows progress in both languages and counts the system's lines: \"Before you send: Texas (" + sd + " of " + n + " done)\"");
  ok((en.match(/<input type="checkbox"/g) || []).length === n && (en.match(/ checked/g) || []).length === sd && (en.match(/onchange="gmConStateCheck\(\d+, this\.checked\)"/g) || []).length === hn, "one box per action line; only the system's done lines are ticked; only hand-ticked lines save on change");
  ok(/<label for="gmConStChk\d+">Get both spouses to sign before work starts, if the customer is married<\/label> <a href="#" role="button" aria-expanded="false" aria-controls="gmConStCtx\d+" onclick="return gmConStateCtx\(this, 'gmConStCtx\d+'\)">\(Tex\. Prop\. Code 53\.254\)<\/a>/.test(en), "a line ends with its law reference in parentheses, and the reference is the clickable part");
  ok(/<label for="gmConStChk\d+">Pegue a assinatura dos dois cônjuges antes de começar o serviço, se o cliente for casado<\/label>/.test(pt), "the action sentence is in Portuguese on the Portuguese screen");
  ok((en.match(/<div id="gmConStCtx\d+" hidden>/g) || []).length === n && /<div id="gmConStCtx\d+" hidden><p class="muted"[^>]*>Written contract: Writing for homestead lien contracts/.test(en), "the full text sits under each line, closed by default");
  ok(/<a href="https:\/\/tcss\.legis\.texas\.gov\/resources\/PR\/htm\/PR\.41\.htm" target="_blank" rel="noopener">Open the official source<\/a>/.test(en) && /Abrir a fonte oficial/.test(pt), "a line whose data has a source address links to the official source");
  ok(/<details[^>]*><summary[^>]*>More about Texas<\/summary>/.test(en) && !/<details[^>]* open/.test(en) && /Mais sobre Texas/.test(pt) && en.indexOf("<summary") < en.indexOf("Research status for Texas") && en.indexOf("<summary") > en.lastIndexOf("gmConStChk"), "one closed \"More about Texas\" line at the bottom holds the rest of the prose");
  ok(!/Leave no blank spaces[^<]*<\/label>/.test(en) && !/Cancellation: Three business days[^<]*<\/label>/.test(en), "handled and background text is never a tick-box line");
  const ticked = { state_checks: { state: "TX", done: { written_contract: { by: "Maria", at: "2026-10-05 20:12:00" } } } };
  const en2 = draw(payload(ticked), true), pt2 = draw(payload(ticked), false);
  ok(en2.indexOf("(" + (sd + 1) + " of " + n + " done)") !== -1 && pt2.indexOf("(" + (sd + 1) + " de " + n + " feitos)") !== -1 && (en2.match(/ checked/g) || []).length === sd + 1, "after one hand tick the heading reads " + (sd + 1) + " of " + n + " done");
  ok(en2.indexOf("Maria, 10/05/2026 4:12 PM") !== -1 && pt2.indexOf("Maria, 10/05/2026 4:12 PM") !== -1, "a ticked line shows \"Maria, 10/05/2026 4:12 PM\" (month first, 12-hour, Eastern) in both languages");
  const winter = draw(payload({ state_checks: { state: "TX", done: { written_contract: { by: "Maria", at: "2026-12-05 20:12:00" } } } }), true);
  ok(winter.indexOf("Maria, 12/05/2026 3:12 PM") !== -1, "the time is Eastern in winter too (3:12 PM for 20:12 UTC)");
  ok((draw(payload(ticked, "void"), true).match(/ disabled/g) || []).length === n && (en2.match(/ disabled/g) || []).length === sn && (draw(payload(ticked, "sent"), true).match(/ disabled/g) || []).length === sn, "the hand-ticked boxes stay usable on a sent contract; a void contract shows every box locked; the system's boxes are always locked");
  const noActs = draw({ status: "draft", job_state_name: "Texas", state_card: { actions: [], more: [{ key: "status", level: "info", en: "Research status.", pt: "Situação da pesquisa." }] } }, true);
  ok(!/Before you send/.test(noActs) && !/type="checkbox"/.test(noActs) && /<summary[^>]*>More about Texas<\/summary>/.test(noActs), "a state with no action lines shows no checklist, only the closed More line");
  ok(draw({ status: "draft", job_state_name: "Texas", state_card: { actions: [], more: [] } }, true) === "", "no action lines and no prose: nothing is drawn");
  ok(!/window\.confirm|alert\(/.test(cut(gm, "gmConStateCardHtml") + cut(gm, "gmConStateCheck") + cut(gm, "gmConStateCtx")) && /getElementById\(id\);\n  if \(!el\) \{ return false; \}/.test(cut(gm, "gmConStateCtx")), "the card uses no browser pop-up and null-checks the element it opens");
  ok(/if \(outFl\) \{ body \+= gmConStateCardHtml\(c\); \}/.test(cut(gm, "gmRenderContractSheet")), "the builder sheet draws the card only for a job outside Florida");
  ["gmConStateCardHtml", "gmConStateCheck", "gmConStateCtx", "gmRenderContractSheet", "gmBkPreset", "gmBkPresetUndoDo", "gmBkSave", "gmOnLangChange", "gmDSubMsg", "gmDSubsCardHtml", "gmAttentionCardHtml"].forEach(function (name) {
    ok(cut(gm, name) === cut(ios, name), "gm.js and its iOS copy carry the same " + name);
  });
}

// ── 8. Part 2: the preset switch has an Undo and no browser pop-up ────────
{
  ok(gm.indexOf("Replace the current questions with this preset?") === -1 && gm.indexOf("Trocar as perguntas atuais pelo modelo?") === -1 && !/confirm\(/.test(cut(gm, "gmBkPreset")), "the browser confirm box and its sentence are gone from the preset switch");
  const mine = [{ key: "bedrooms", label_pt: "Quartos", label_en: "Bedrooms", type: "number", enabled: false }, { key: "custom_abc", label_pt: "Tem pet?", label_en: "Tem pet?", type: "yesno", enabled: true }];
  const world = new Function("window", "gmBkRerender",
    "var gmBkDraft = { preset: 'cleaning', questions: " + JSON.stringify(mine) + ", enabled: true };\n" +
    "var gmBkSettings = { presets: { cleaning: [{ key: 'bedrooms' }], general: [{ key: 'job', label_en: 'What do you need?' }, { key: 'when' }] } };\n" +
    "var gmBkPresetUndo = null;\n" + cut(gm, "gmBkPreset") + "\n" + cut(gm, "gmBkPresetUndoDo") + "\n" +
    "return { preset: gmBkPreset, undo: gmBkPresetUndoDo, draft: function() { return gmBkDraft; }, pending: function() { return gmBkPresetUndo; } };");
  let renders = 0;
  const w = world({ confirm: function () { throw new Error("browser confirm was called"); } }, function () { renders++; });
  w.preset("general");
  ok(w.draft().preset === "general" && w.draft().questions.length === 2 && w.draft().questions[0].key === "job" && renders === 1 && w.pending() !== null, "choosing a preset switches at once (no pop-up) and offers Undo");
  w.draft().questions.pop();
  w.undo();
  ok(w.draft().preset === "cleaning" && JSON.stringify(w.draft().questions) === JSON.stringify(mine) && w.pending() === null && renders === 2 && w.draft().enabled === true, "Undo restores exactly the questions that were there before the switch (order, custom question, on/off), and the preset");
  w.preset("general"); w.preset("cleaning");
  ok(JSON.stringify(w.pending().questions) === JSON.stringify([{ key: "job", label_en: "What do you need?" }, { key: "when" }]) && w.pending().preset === "general", "switching again keeps the Undo for the latest switch");
  w.undo(); w.undo();
  ok(w.draft().preset === "general" && w.pending() === null, "a second Undo with nothing to undo does nothing");
  const cardSrc = gm.slice(gm.indexOf("gmBkChip(s.preset === \"cleaning\""), gm.indexOf("if (!s.questions.length)"));
  ok(/gmBkPresetUndo \? '<p id="gmBkPresetUndoLine"/.test(cardSrc) && /gmT\("Perguntas trocadas\.", "Questions replaced\."\)/.test(cardSrc) && /onclick="gmBkPresetUndoDo\(\)">' \+ gmT\("Desfazer", "Undo"\)/.test(cardSrc), "the card shows \"Questions replaced.\" with an Undo button, in both languages, only while there is something to undo");
  const save = cut(gm, "gmBkSave");
  ok(/gmBkPresetUndo = null;/.test(save) && save.indexOf("gmBkPresetUndo = null;") > save.indexOf(".then(function(d) {") && save.indexOf("gmBkPresetUndo = null;") < save.indexOf(".catch("), "the Undo goes away after a successful save, not before; nothing else saves");
  ok(!/gmApi\(/.test(cut(gm, "gmBkPreset") + cut(gm, "gmBkPresetUndoDo")), "switching and undoing save nothing: they change the unsaved draft only");
}

// ── 9. Part 3: the Home headings follow the language switch ───────────────
{
  const lang = cut(gm, "gmOnLangChange");
  ok(/if \(typeof gmAttentionChanged === "function"\) \{ gmAttentionChanged\(gmAttention\); \}/.test(lang) && lang.indexOf("gmAttentionChanged(gmAttention)") < lang.indexOf("if (gmCurrentTab"), "a language switch repaints the Home attention card (it was never repainted before)");
  function home(en) {
    const stubs = { gmT: function (pt, e) { return en ? e : pt; }, isEn: function () { return en; }, gmIsSeller: function () { return false; }, gmMoney: function (c) { return "$" + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); },
      escHtml: function (x) { return String(x === null || x === undefined ? "" : x); }, formatDate: function (s) { const p = String(s).split("-"); return p[1] + "/" + p[2] + "/" + p[0]; }, formatDateTimeUTC: function () { return "10/01/2026 2:05 PM"; },
      gmConResponsesCardHtml: function () { return ""; }, gmConNoticesCardHtml: function () { return ""; }, gmConAwaitingCardHtml: function () { return ""; }, gmConAwaiting: [], gmConNotices: [], gmInvMethodLabel: String,
      gmDSubs: { assignments: [{ subcontractor_id: "s1", job_status: "Em andamento" }], subcontractors: [
        { id: "s1", name: "Tile Bros", warning_codes: ["coi_expired:2026-10-01"], expiring: [], expiring_codes: [] },
        { id: "s2", name: "Deck Co", warning_codes: [], expiring: ["x"], expiring_codes: ["coi_expiring:2026-10-20"] }] },
      gmAttention: { pending_alerts: [], online_acceptances: [{ id: "e1", accepted_signer_name: "Jordan Rivers", display_number: "EST-0021", total_cents: 838200, job_name: "Rivers", accepted_at: "2026-10-01 18:05:00" }] } };
    const names = Object.keys(stubs);
    return new Function(...names, ["gmDSubMsg", "gmDSubMsgs", "gmDSubsCardHtml", "gmAttentionCardHtml"].map(function (n) { return cut(gm, n); }).join("\n") + "\nreturn gmAttentionCardHtml();")(...names.map(function (k) { return stubs[k]; }));
  }
  const en = home(true), pt = home(false);
  ok(/Subcontractor documents expiring/.test(en) && /Signed online by the customer/.test(en) && /insurance \(COI\) expired on 10\/01\/2026/.test(en) && /insurance \(COI\) expires on 10\/20\/2026/.test(en) && /Jordan Rivers signed EST-0021 · \$8,382\.00/.test(en) && /! expired/.test(en) && /✓ accepted/.test(en),
    "English: both headings, both insurance lines (dates month first), the signed line and both badges");
  ok(!/Documentos de subempreiteiros|Assinados online|seguro \(COI\)|assinou |vencido|aceito/.test(en), "English: none of the Portuguese words is left");
  ok(/Documentos de subempreiteiros vencendo/.test(pt) && /Assinados online pelo cliente/.test(pt) && /seguro \(COI\) venceu em 10\/01\/2026/.test(pt) && /seguro \(COI\) vence em 10\/20\/2026/.test(pt) && /Jordan Rivers assinou EST-0021 · \$8,382\.00/.test(pt) && /! vencido/.test(pt) && /✓ aceito/.test(pt),
    "Portuguese: unchanged wording, same US date and money format");
  const portal = readFileSync(new URL("portal.html", root), "utf8");
  ok(/if \(window\.gmOnLangChange\) \{ gmOnLangChange\(\); \}/.test(portal) && /card\.innerHTML = html;/.test(portal.slice(portal.indexOf("function gmAttentionChanged()"), portal.indexOf("function gmAttentionChanged()") + 700)), "portal.html: the language button calls gmOnLangChange, and gmAttentionChanged redraws the Home card from scratch");
  const dash = readFileSync(new URL("dashboard.html", root), "utf8");
  ok(!/subempreiteiros vencendo|Assinados online|seguro \(COI\)|gmAttentionCardHtml|gmBkPreset|gmConStateChecklist/.test(dash), "dashboard.html keeps no copy of any of this code");
}

console.log("");
console.log(failed ? "❌ " + failed + " FAILED (" + passed + " passed)" : "✅ ALL PASS (" + passed + ")");
if (failed) { process.exitCode = 1; }
