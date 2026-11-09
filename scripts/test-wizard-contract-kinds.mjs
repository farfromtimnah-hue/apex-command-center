// Every work category the wizard offers, plus "Something else": the contract kind, the
// lawyer PDF and the clause by clause screen must each be right, or say plainly there is none.
// A kind of work with no Apex contract skips every contract step (estimate, invoice and payment
// still work, nothing is refused), and an owner with a contract is unchanged.
// Offline checks always run. The live part runs only with a branch Worker (wrangler dev --remote),
// APEX_TEST_API, APEX_TEST_TOKEN and APEX_TEST_CLIENT (a throwaway business, NEVER a real client).
// It puts the business's work answers and trades back when it is done.
//   node scripts/test-wizard-contract-kinds.mjs
import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
let failed = 0, passed = 0;
function ok(cond, label) { if (cond) { passed++; console.log("PASS  " + label); } else { failed++; console.log("FAIL  " + label); } }
function read(rel) { return readFileSync(new URL(rel, root), "utf8"); }
const WIZ = JSON.parse(read("data/wizard-v1.json")), WORKER = read("worker/index.js"), SW = read("setup-wizard.js"), GM = read("gm.js");

// What each category must give. The contract Apex has for each kind of work.
const WANT = {
  pools: ["construction"], pavers: ["construction"], outdoor_living: ["construction"], tile: ["construction"], flooring: ["construction"],
  home_exterior: ["construction"], interiors: ["construction"], stone: ["construction"], construction: ["construction"], cleaning: ["cleaning"],
  cakes: [], boutique: [], water: [], other: [],
  // Added 2026-11-09: no contract library exists yet for these trades (interim: estimates, invoices and payments only).
  home_systems: [], landscaping: [], home_services: []
};
const cats = WIZ.categories.map(c => c.key).concat(["other"]);
ok(cats.length === 17 && cats.every(k => Object.prototype.hasOwnProperty.call(WANT, k)), "Every category the wizard offers has an expected contract kind in this test (16 kinds of work and Something else)");

// ── Offline: the kind function, as written in the Worker ────────────────
const src = /function wizNoContractCat\(cat\) \{[\s\S]*?\n\}\nfunction wizLawyerKinds\(trades, cat\) \{[\s\S]*?\n\}/.exec(WORKER);
ok(!!src, "The kind function is in the Worker");
const kinds = new Function("CONTRACT_CONSTRUCTION_TRADE_KEYS", "WIZARD_V1", src[0] + "; return wizLawyerKinds;")(["pools", "tile", "remodeling", "hardscape", "general"], WIZ);
cats.forEach(k => {
  const c = WIZ.categories.filter(x => x.key === k)[0];
  const stored = c ? c.contract_trades : ["general"];   // what the wizard writes for the pick
  ok(kinds(stored, k).join() === WANT[k].join(), k + ": trades " + JSON.stringify(stored) + " give " + (WANT[k].join() || "no contract"));
});
ok(kinds([], "other").length === 0 && kinds([], "cakes").length === 0, "No trade set after picking a kind without a contract: no contract (never a remodeling one)");
ok(kinds([], undefined).join() === "construction", "No trade set and nothing picked in the wizard (an owner from before the wizard): unchanged, construction");
ok(kinds(["general", "cleaning"], "cakes").join() === "cleaning", "A baker who also ticks cleaning in Settings gets the cleaning contract only");
ok(WIZ.categories.filter(c => c.contract_available === false).map(c => c.key).sort().join() === "boutique,cakes,home_services,home_systems,landscaping,water", "The categories marked as having no contract are cakes, boutique, water, home systems, landscaping and home services");

// ── Offline: the screens ────────────────────────────────────────────────
ok(/A contract for this kind of work is not available in Apex yet/.test(SW) && /id="swNoContract"/.test(SW) && /SW\.d\.contract\.available === false/.test(SW), "Review: the honest line is there, and the PDF and clause links are drawn only when a contract exists");
ok(/A contract for this kind of work is not available in Apex yet/.test(GM) && /id="gmConNoContract"/.test(GM) && /if \(!noContract\) \{\s*\n\s*h \+= '<div class="gm-sheet-section"><p class="gm-sheet-section-title">' \+ gmT\("Para o seu advogado"/.test(GM), "Settings, Contracts: the honest line is there, and the lawyer PDF section is drawn only when a contract exists");
ok(/d\.available === false/.test(SW) && /available: false, url: null/.test(WORKER), "An old page that still asks for the PDF gets a plain answer (available false), not an error");
const rev = SW.slice(SW.indexOf("function swReviewStage"), SW.indexOf("// ── Events"));
ok(/return \{ html: h, need: \[\], ok: true \}/.test(rev), "Start is never blocked by the contract (Review always returns ok)");


// ── Offline: skip, never refuse ─────────────────────────────────────────
const modeSrc = /async function wizContractMode\(env, id\) \{[\s\S]*?\n\}\nasync function wizContractNone\(env, id\) \{[\s\S]*?\n\}/.exec(WORKER);
ok(!!modeSrc, "The contract mode function is in the Worker");
function envWith(row) { return { DB: { prepare() { return { bind() { return { first: async () => row }; } }; } } }; }
const modeFn = new Function("wizStateRow", "wizAnswers", modeSrc[0] + "; return { wizContractMode, wizContractNone };");
const wizStateRowStub = async (env) => env.DB.prepare().bind().first();
const wizAnswersStub = (row) => { let a = {}; try { a = JSON.parse((row && row.answers_json) || "{}") || {}; } catch (e) {} return a; };
const M = modeFn(wizStateRowStub, wizAnswersStub);
ok(await M.wizContractMode(envWith(null), "x") === null, "An owner with no wizard record: no contract mode (unchanged)");
ok(await M.wizContractMode(envWith({ answers_json: JSON.stringify({ cat: "pools", subs: ["x"] }) }), "x") === null, "An owner who picked pools: no contract mode (unchanged)");
ok(await M.wizContractMode(envWith({ answers_json: JSON.stringify({ cat: "cakes", subs: ["cakes"] }) }), "x") === null, "A business whose wizard record predates this build, even one that picked cakes: no contract mode (unchanged)");
ok(await M.wizContractNone(envWith({ answers_json: JSON.stringify({ cat: "cakes", contract_mode: "none" }) }), "x") === true, "A business the wizard marked none: contract mode none");
ok(await M.wizContractNone(envWith({ answers_json: "not json" }), "x") === false, "A damaged wizard record: not none, never a crash");
const sect = (a, b) => WORKER.slice(WORKER.indexOf(a), WORKER.indexOf(b, WORKER.indexOf(a)));
ok(/wizContractNone\(env, clientId\)\)/.test(sect("async function coJobContractStatus", "async function handleGetGmJobContractStatus")), "The no signed contract warning is off for a business with no contract");
ok(/if \(await wizContractNone\(env, id\)\) \{ return wizNotOffered\(\); \}/.test(sect("async function gmContractCreateCore", "var settings = await contractSettingsRow")), "Creating a contract answers a plain not offered line for a business with no contract");
ok(/sendNone && flowBody\.check_only === true/.test(WORKER) && /full_flow === true && !sendNone/.test(WORKER), "Sending an estimate never asks the contract check of a business with no contract");
ok(/if \(await wizContractNone\(env, id\)\) \{ return wizNotOffered\(\); \}\s*\n\s*var cs = await contractSettingsRow/.test(WORKER), "Asking a signer to sign answers not offered, not Set up the contract settings first");
ok(/contract_none: ffNone/.test(WORKER) && /!ffNone && ffSettings\.trades\.length/.test(WORKER), "The estimate screens are told contract_none and offer no one link flow");
ok(/wizard\\\/\(website\|other-work\|contract-request\|finish\|lawyer-pdf\)/.test(WORKER) && /wizSub === "contract-request"/.test(WORKER), "The request route is routed and allowed for the owner's own session");
ok(/howNone/.test(WORKER) && /body\.trades = category && !wizNoContractCat\(cat\) \? category\.contract_trades\.slice\(\) : \[\]/.test(WORKER), "Trades hold the trades of the work only: none for a kind with no contract, never general");
ok(/Ask Apex for a contract for my business/.test(SW) && /Ask Apex for a contract for my business/.test(GM) && !/Use my own contract/.test(SW.slice(SW.indexOf("function swContractActions"), SW.indexOf("function swContractActions") + 2000)), "Review, How you work and Settings carry the request action");
ok(!/Apex (handles|takes care of|covers) (the )?legal/i.test(SW + GM), "Nothing says Apex handles the legal terms");
const GUIDE = JSON.parse(read("help/guides.json")).guides.find(g => g.id === "setup-wizard");
const ncSteps = (GUIDE.sections.find(x => x.id === "nocontract") || { steps: [] }).steps.length;
ok(ncSteps >= 3 && /data-help="setup-wizard#nocontract#1"/.test(GM) && /swH\("nocontract", 2\)/.test(SW), "The request actions have Aprenda guide steps (" + ncSteps + " steps) in English and Portuguese");
ok(!/[—–]/.test(JSON.stringify(GUIDE.sections.find(x => x.id === "nocontract"))), "No long dashes in the new guide text");

// ── Live ────────────────────────────────────────────────────────────────
const API = process.env.APEX_TEST_API, TOKEN = process.env.APEX_TEST_TOKEN, CLIENT = process.env.APEX_TEST_CLIENT;
if (API && TOKEN && CLIENT) {
  ok(CLIENT !== "gator" && !/^(gator|real)/i.test(CLIENT), "Live part runs on a throwaway business: " + CLIENT);
  const B = API + "/api/clients/" + CLIENT + "/gm/";
  async function call(path, method, body) { const res = await fetch(B + path, { method: method || "GET", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await res.json(); } catch (e) {} return { status: res.status, j }; }
  const cs0 = (await call("contract-settings")).j.settings, w0 = (await call("wizard")).j.answers || {};
  for (const k of cats) {
    const c = WIZ.categories.filter(x => x.key === k)[0], want = WANT[k];
    const pick = await call("wizard/work", "PUT", { cat: k, subs: c ? c.subtaps.slice(0, 2).map(t => t.key) : [], other_text: k === "other" ? "Test, ignore" : "" });
    ok(pick.status === 200, k + ": saving the pick works (" + pick.status + (pick.status === 200 ? "" : " " + JSON.stringify(pick.j)) + ")");
    const cs = await call("contract-settings"), wz = await call("wizard");
    ok(cs.status === 200 && wz.status === 200 && cs.j.contract.kinds.join() === want.join() && wz.j.contract.kinds.join() === want.join() && cs.j.contract.available === (want.length > 0), k + ": the server reports kinds [" + want.join() + "] on both screens (trades stored " + JSON.stringify(cs.j.settings.trades) + ")");
    const p = await call("wizard/lawyer-pdf", "POST", {});
    ok(p.status === 200, k + ": the PDF call is not refused (" + p.status + (p.status === 200 ? "" : " " + JSON.stringify(p.j)) + ")");
    if (want.length) {
      ok(!!p.j.url && p.j.kinds.join() === want.join() && p.j.areas > 0, k + ": a PDF link, kinds " + (p.j.kinds || []).join() + ", clause areas " + p.j.areas);
      const f = await fetch(p.j.url.replace(/^https?:\/\/[^/]+/, API)); const buf = Buffer.from(await f.arrayBuffer());
      const pages = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
      ok(f.status === 200 && buf.slice(0, 5).toString() === "%PDF-" && buf.length > 50000 && pages >= 3, k + ": the real PDF opens (%PDF, " + buf.length + " bytes, " + pages + " pages)");
      if (want[0] === "cleaning") { ok(p.j.areas === 19 && pages >= 15 && (cs.j.cleaning_areas || []).length === 19, k + ": cleaning has all 19 clause areas in the PDF and on the clause screen"); }
      else { ok(p.j.areas >= 10, k + ": the construction PDF has its clause areas (" + p.j.areas + ")"); }
    } else {
      ok(p.j.available === false && !p.j.url && p.j.areas === 0, k + ": no contract, so no PDF, and the answer is plain (available false), not an error");
    }
  }
  // ── Skip, never refuse: a bakery goes from estimate to a paid invoice ──
  const NONE_KINDS = cats.filter(k => WANT[k].length === 0);
  for (const k of NONE_KINDS) {
    await call("wizard/work", "PUT", { cat: k, subs: k === "other" ? [] : WIZ.categories.filter(x => x.key === k)[0].subtaps.slice(0, 1).map(t => t.key), other_text: k === "other" ? "Test, ignore" : "" });
    const w = await call("wizard"), cs = await call("contract-settings");
    ok(w.j.contract.mode === "none" && w.j.contract.none === true && JSON.stringify(cs.j.settings.trades) === "[]", k + ": mode none and no trade stored (trades " + JSON.stringify(cs.j.settings.trades) + ")");
  }
  await call("wizard/work", "PUT", { cat: "cakes", subs: ["cakes"] });
  const stamp = Date.now();
  const lead = await call("leads", "POST", { cliente: "Kinds Test " + stamp, telefone: "8135550100", email: "kinds.test@example.com", servico: "Cake" });
  ok(lead.status === 200 && lead.j.created, "Bakery: a lead is created");
  const estBody = { lead_id: lead.j.lead.id, mode: "single", job_name: "Kinds test cake", customer_name: "Kinds Test " + stamp, customer_phone: "8135550100", customer_email: "kinds.test@example.com", customer_address: "1 Test St, Tampa, FL 33602",
    valid_until: "2027-12-01", schedule: [{ label: "Deposit", pct: 50 }, { label: "Completion", pct: 50 }],
    options: [{ tier: "single", label: "", items: [{ pricing_id: null, item_name: "Cake", category: "", description: "", line_type: "standard", qty: 1, unit: "", rate_cents: 85000, is_addon: false, material_cost_cents: 0, labor_cost_cents: 0, other_cost_cents: 0 }] }] };
  const mk = async () => call("estimates", "POST", estBody);
  const e1 = await mk();
  ok(e1.status === 200 && e1.j.estimate && e1.j.estimate.id, "Bakery: the estimate is saved (" + e1.status + ")");
  const eid = e1.j.estimate.id;
  const sr = await call("estimates/" + eid + "/sign-request", "POST", {});
  ok(sr.status === 200 && sr.j.not_offered === true && sr.j.requested === false, "Bakery: asking a signer answers a plain not offered line (" + sr.status + ")");
  const ck = await call("estimates/" + eid + "/send", "POST", { full_flow: true, check_only: true });
  ok(ck.status === 200 && ck.j.not_offered === true && ck.j.blockers.length === 0, "Bakery: the one link check shows no list of things to fix (" + ck.status + ")");
  const sd = await call("estimates/" + eid + "/send", "POST", { full_flow: true });
  ok(sd.status === 200 && sd.j.sent === true && !!sd.j.link, "Bakery: the estimate is sent even when an old page asks for the contract flow (" + sd.status + ")");
  const lite = (await call("doc-messages")).j.settings_lite;
  ok(lite.contract_none === true && !lite.full_flow_signer && lite.full_flow_requestable === false, "Bakery: the estimate screens are told no contract and offer no one link flow");
  const tok = (await call("estimates/" + eid)).j.estimate.public_token;
  const acc = await fetch(API + "/api/public/estimates/" + tok + "/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signer_name: "Kinds Test", signature_kind: "typed", option_id: null, consent: true, consent_text_version: "2026-10-04.1" }) });
  ok(acc.status === 200, "Bakery: the customer accepts (" + acc.status + ")");
  const jobs = (await call("jobs")).j.jobs.filter(j => j.lead_id === lead.j.lead.id);
  ok(jobs.length === 1, "Bakery: a project exists after the acceptance");
  const jid = jobs[0].id;
  const cc = await call("jobs/" + jid + "/contracts", "POST", {});
  ok(cc.status === 200 && cc.j.not_offered === true && cc.j.created === false, "Bakery: creating a contract answers a plain not offered line, not an error (" + cc.status + ")");
  await call("jobs/" + jid, "PUT", { valor: 5000 });
  const st = await call("jobs/" + jid + "/contract-status");
  ok(st.status === 200 && st.j.needs_warning === false, "Bakery: a project over 2,500 dollars gets no No signed contract warning (" + st.status + ")");
  const inv = await call("jobs/" + jid + "/invoices-from-estimate", "POST", {});
  ok(inv.status === 200, "Bakery: invoices are made from the estimate (" + inv.status + ")");
  const invs = (await call("invoices")).j.invoices.filter(i => i.job_id === jid);
  ok(invs.length >= 1, "Bakery: the invoice is listed");
  const pay = await call("invoices/" + invs[0].id + "/payments", "POST", { amount_cents: invs[0].amount_cents, paid_date: new Date().toISOString().slice(0, 10), method: "zelle", reference: "TEST", note: null });
  ok(pay.status === 200 && pay.j.state === "verified", "Bakery: a payment is recorded and verified (" + pay.status + ")");
  const pub = await fetch(API + "/api/public/invoices/" + (await call("invoices/" + invs[0].id)).j.invoice.public_token);
  const pj = pub.status === 200 ? await pub.json() : {};
  ok(pub.status === 200 && (pj.invoice ? pj.invoice.no_contract : pj.no_contract) === true, "Bakery: the customer's invoice page is told there is no contract (it says estimate total)");
  // The request action: one ticket, a second tap makes no second one.
  const r1 = await call("wizard/contract-request", "POST", { note: "Test note" }), r2 = await call("wizard/contract-request", "POST", { note: "Test note again" });
  ok(r1.status === 200 && r2.status === 200 && r1.j.ticket_id === "wizc-" + CLIENT && r2.j.ticket_id === r1.j.ticket_id && r2.j.already === true, "Request: one support ticket for the business, a second tap makes no second ticket");
  ok(!r2.j.would_send || r2.j.would_send.sent_now === false, "Request: the second tap sends nothing (blocked run shows what the first sent)");
  ok(/needs to be added/.test(WORKER.slice(WORKER.indexOf("async function handlePostGmWizardContractRequest"), WORKER.indexOf("async function handlePostGmWizardOtherWork"))), "Request: it uses the existing needs to be added section of the support tickets");

  // ── Owners with a contract are unchanged ──
  for (const k of ["pools", "cleaning"]) {
    const c = WIZ.categories.filter(x => x.key === k)[0];
    await call("wizard/work", "PUT", { cat: k, subs: c.subtaps.slice(0, 1).map(t => t.key) });
    const w = await call("wizard");
    ok(w.j.contract.mode === null && w.j.contract.none === false && w.j.contract.kinds.join() === WANT[k].join(), k + ": no contract mode, kind " + WANT[k].join() + " (unchanged)");
    const e = await mk();
    const s2 = await call("estimates/" + e.j.estimate.id + "/sign-request", "POST", {});
    ok(s2.j.not_offered !== true && s2.status === 400, k + ": asking a signer still runs the contract checks as before (" + s2.status + ", " + String(s2.j.error || "").slice(0, 50) + ")");
    const l2 = (await call("doc-messages")).j.settings_lite;
    ok(l2.contract_none === false, k + ": the estimate screens are not told no contract");
  }

  // Put the business back the way it was.
  if (w0.cat) { await call("wizard/work", "PUT", { cat: w0.cat, subs: w0.subs || [], other_text: w0.other_text || "" }); }
  await call("contract-settings", "PUT", { trades: cs0.trades, builds_pools: cs0.builds_pools });
  const back = (await call("contract-settings")).j.settings;
  ok(JSON.stringify(back.trades) === JSON.stringify(cs0.trades), "The throwaway business's trades are back as they were");
} else { console.log("SKIP  live checks (set APEX_TEST_API, APEX_TEST_TOKEN, APEX_TEST_CLIENT)"); }
console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
