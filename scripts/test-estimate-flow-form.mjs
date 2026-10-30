// The one-link send as the DEFAULT, with its form: the Worker asks only what the
// contract for THIS job still needs, saves the typed answers with the send, builds
// the contract complete from them when the customer accepts, skips the contract
// when the job's state and amount need none, remembers answers for next time,
// and lets a person who may not sign ask a signer. The real Worker on a copy of
// the live schema; nothing touches the network or the production database.
//
//   node scripts/test-estimate-flow-form.mjs
import { newWorld } from "./fixtures/flow-world.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };
console.error = () => {};
const ACCEPT = (extra) => Object.assign({ consent: true, signer_name: "Jordan Rivers", signature_kind: "typed", consent_text_version: "2026-10-04.1" }, extra || {});
const SIGN = () => ({ consent: true, signer_name: "Jordan Rivers", signature_kind: "typed", initials: "JR", lien_typed: true, marketing_consent: false });
const CHECK = (extra) => Object.assign({ full_flow: true, check_only: true }, extra || {});
const SEND = (extra) => Object.assign({ full_flow: true, consent: true, signer_name: "Pat Owner", consent_text: "I agree to sign this contract electronically on behalf of the company." }, extra || {});
const count = (w, sql, ...a) => w.d.one(sql, ...a).n;
function lead(w, o) { const id = w.lead(o); w.d.x("UPDATE gm_leads SET property_type = 'single_family', property_county = 'Hillsborough' WHERE id = ?", id); return id; }
// Answer every question the form still asks with a plain value, like a person would.
function fill(qs) { const a = {}; qs.forEach((q) => { const k = q.field; a[k] = /_days$|_hours$|duration/.test(k) ? "5" : (/date/.test(k) ? "11/16/2026" : "sample " + k); }); return a; }

// ── 1. The form: what it asks, the send with the answers, the contract built complete ──
{
  const w = newWorld();
  const e = w.estimate(lead(w));
  const c1 = await w.gm("POST", "estimates/" + e.id + "/send", CHECK());
  ok(c1.status === 200 && c1.json.ready === false && c1.json.questions.length > 0 && c1.json.contract_needed === true, "the check answers 200 with the questions still needed (never a red refusal)");
  ok(c1.json.questions.every((q) => typeof q.field === "string" && Array.isArray(q.used_in)), "each question is a contract field name from the library");
  ok(c1.json.questions.every((q) => q.field !== "owner_email"), "the customer's email is never asked");
  ok(count(w, "SELECT COUNT(*) n FROM gm_contracts") === 0 && w.d.one("SELECT status FROM gm_estimates WHERE id = ?", e.id).status === "draft", "checking writes nothing");
  const answers = fill(c1.json.questions);
  const refused = await w.gm("POST", "estimates/" + e.id + "/send", SEND());
  ok(refused.status === 409 && refused.json.code === "contract_incomplete" && w.d.one("SELECT status FROM gm_estimates WHERE id = ?", e.id).status === "draft", "sending without the answers is refused and leaves the draft as it was");
  const c2 = await w.gm("POST", "estimates/" + e.id + "/send", CHECK({ answers }));
  ok(c2.json.ready === true && c2.json.questions.length === 0, "once the answers are given the check is ready");
  const sent = await w.gm("POST", "estimates/" + e.id + "/send", SEND({ answers }));
  const pre = JSON.parse(w.d.one("SELECT company_presign_json p FROM gm_estimates WHERE id = ?", e.id).p);
  ok(sent.status === 200 && sent.json.sent === true && pre.answers && Object.keys(pre.answers).length === Object.keys(answers).length, "the typed answers are saved with the send");
  const acc = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  const con = w.d.one("SELECT * FROM gm_contracts");
  ok(acc.status === 200 && /^https:\/\//.test(acc.json.contract_link) && con && con.status === "sent", "the customer accepts and the contract is built, signed for the company and sent");
  const ca = JSON.parse(con.answers_json);
  ok(Object.keys(answers).every((k) => ca[k] === answers[k]), "the contract's own answers are exactly what was typed on the send form (nobody opens the builder)");
  const signed = await w.pub("POST", "/contracts/" + con.public_token + "/sign", SIGN());
  const invs = w.d.q("SELECT * FROM gm_invoices ORDER BY rowid");
  ok(signed.status === 200 && invs.length === 3 && invs[0].status === "sent" && invs[1].status === "draft" && invs[0].amount_cents === 375000, "the customer signs; the first invoice is the 30 percent deposit and the rest stay drafts");
}

// ── 2. A second look: remember for next time, revisions and repeat customers ──
{
  const w = newWorld();
  const e = w.estimate(lead(w));
  const c1 = await w.gm("POST", "estimates/" + e.id + "/send", CHECK());
  const answers = fill(c1.json.questions);
  const rem = c1.json.questions.filter((q) => q.remember).map((q) => q.field);
  ok(rem.indexOf("estimated_start_date") === -1 && rem.indexOf("access_instructions") === -1 && rem.length > 0, "dates and keys or codes are never offered as remember-for-next-time");
  const pick = rem[0];
  await w.gm("POST", "estimates/" + e.id + "/send", SEND({ answers, remember: [pick, "estimated_start_date"] }));
  const vals = JSON.parse(w.d.one("SELECT values_json v FROM contract_client_settings").v);
  ok(vals[pick] === answers[pick] && vals.estimated_start_date === undefined, "the ticked answer becomes the business default; a date can never be saved that way");
  const e2 = w.estimate(lead(w), { name: "Ana Souza" });
  const c2 = await w.gm("POST", "estimates/" + e2.id + "/send", CHECK());
  ok(c2.json.questions.every((q) => q.field !== pick), "the next estimate no longer asks the remembered question");
  // Revision: the new revision starts from the earlier send's answers.
  const rev = await w.gm("POST", "estimates/" + e.id + "/revise");
  const nid = rev.json.estimate.id;
  const c3 = await w.gm("POST", "estimates/" + nid + "/send", CHECK());
  ok(c3.json.prefill && c3.json.prefill.answers && c3.json.prefill.answers.access_route === answers.access_route, "a revised estimate starts from the answers already given");
}

// ── 3. A small job in a state that needs no contract at that amount: the flow skips the contract ──
{
  const w = newWorld();
  const e = w.estimate(lead(w), { price: 200000, jobName: "Small repair" });
  const c1 = await w.gm("POST", "estimates/" + e.id + "/send", CHECK());
  ok(c1.json.contract_needed === false && c1.json.ready === true && c1.json.questions.length === 0, "$2,000 in Florida: no contract is needed, no questions are asked");
  const sent = await w.gm("POST", "estimates/" + e.id + "/send", { full_flow: true });
  ok(sent.status === 200 && sent.json.sent === true, "it sends with no signature and no consent");
  const acc = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  ok(acc.status === 200 && /^https:\/\//.test(acc.json.invoice_link) && !acc.json.contract_link, "accepting opens the first invoice, not a contract");
  ok(count(w, "SELECT COUNT(*) n FROM gm_contracts") === 0, "no contract is created");
  const invs = w.d.q("SELECT * FROM gm_invoices ORDER BY rowid");
  ok(invs.length === 3 && invs[0].status === "sent" && invs[1].status === "draft" && invs[0].amount_cents === 60000, "the invoices follow the estimate's schedule: only the 30 percent deposit ($600.00 of $2,000.00) is sent");
  const inv = await w.pub("GET", "/invoices/" + invs[0].public_token);
  ok(inv.status === 200 && JSON.stringify(inv.json).indexOf("pay@sunrise.test") !== -1, "the link opens the existing invoice page with the ways to pay");
  const big = w.estimate(lead(w), { price: 250001, name: "Ana Souza" });
  const c2 = await w.gm("POST", "estimates/" + big.id + "/send", CHECK());
  ok(c2.json.contract_needed === true, "one cent over the Florida amount: the contract is needed again");
}

// ── 4. Pool questions appear only on a pool job ──
{
  const w = newWorld();
  w.d.x("UPDATE contract_client_settings SET builds_pools = 1");
  const e = w.estimate(lead(w));
  const off = await w.gm("POST", "estimates/" + e.id + "/send", CHECK({ flags: { is_pool: false } }));
  const on = await w.gm("POST", "estimates/" + e.id + "/send", CHECK({ flags: { is_pool: true } }));
  ok(off.json.builds_pools === true && off.json.need_pool_safety === null, "pool job answered No: no pool questions");
  ok(on.json.need_pool_safety && on.json.need_pool_safety.length === 5, "pool job answered Yes: the pool safety choice appears (five legal options)");
  const done = await w.gm("POST", "estimates/" + e.id + "/send", CHECK({ flags: { is_pool: true, pool_safety_feature: on.json.need_pool_safety[1] } }));
  ok(done.json.need_pool_safety === null, "once chosen it is no longer asked");
}

// ── 5. A person who may not sign asks a signer ──
{
  const w = newWorld();
  const e = w.estimate(lead(w, { vendedor: "Nina NoSign" }));
  const chk = await w.gm("POST", "estimates/" + e.id + "/send", CHECK(), "seller-nina");
  ok(chk.status === 200 && chk.json.can_sign === false && chk.json.signature === null, "a seller who may not sign still gets the form (can_sign false)");
  const answers = fill(chk.json.questions);
  const early = await w.gm("POST", "estimates/" + e.id + "/send", SEND({ answers }), "seller-nina");
  ok(early.status === 403 && early.json.code === "not_signer", "sending before a signer signs is refused (403)");
  const incomplete = await w.gm("POST", "estimates/" + e.id + "/sign-request", { full_flow: true }, "seller-nina");
  ok(incomplete.status === 409, "asking with the form incomplete is refused");
  const ask = await w.gm("POST", "estimates/" + e.id + "/sign-request", { full_flow: true, answers }, "seller-nina");
  ok(ask.status === 200 && ask.json.requested === true && w.d.one("SELECT status FROM gm_estimates WHERE id = ?", e.id).status === "draft", "Ask to sign records the request and leaves the estimate a draft");
  const again = await w.gm("POST", "estimates/" + e.id + "/send", SEND({ answers }), "seller-nina");
  ok(again.status === 403 && again.json.code === "signature_requested", "while it waits, the seller cannot send it");
  const aw = await w.gm("GET", "contracts/awaiting", undefined, "owner1");
  ok(aw.json.sign_requests && aw.json.sign_requests.length === 1 && aw.json.sign_requests[0].can_grant === true, "the owner sees the request, with the choice to let the seller sign from now on");
  const sellerAw = await w.gm("GET", "contracts/awaiting", undefined, "seller-nina");
  ok(!sellerAw.json.sign_requests || sellerAw.json.sign_requests.length === 0, "the seller who asked does not see it as a request to sign");
  const noConsent = await w.gm("POST", "estimates/" + e.id + "/sign-approve", { signer_name: "Pat Owner" }, "owner1");
  ok(noConsent.status === 400, "a signer must give the consent");
  const nope = await w.gm("POST", "estimates/" + e.id + "/sign-approve", { signer_name: "Nina", consent: true }, "seller-nina");
  ok(nope.status === 403, "a seller who is not a signer cannot approve");
  const ok1 = await w.gm("POST", "estimates/" + e.id + "/sign-approve", { signer_name: "Pat Owner", consent: true, consent_text: "x", grant_seller: true }, "owner1");
  ok(ok1.status === 200 && ok1.json.signed === true && ok1.json.granted === true, "the owner signs and lets the seller sign from now on");
  const second = await w.gm("POST", "estimates/" + e.id + "/sign-approve", { signer_name: "Sam Seller", consent: true }, "seller-sam");
  ok(second.status === 409 && second.json.code === "already_signed", "a second signer finds it already signed");
  const signers = JSON.parse(w.d.one("SELECT signers_json s FROM contract_client_settings").s);
  ok(signers.some((s) => s.name === "Nina NoSign" && s.username === "seller-nina"), "the seller is now on the signer list");
  const sent = await w.gm("POST", "estimates/" + e.id + "/send", { full_flow: true }, "seller-nina");
  ok(sent.status === 200 && sent.json.sent === true, "the seller sends it");
  const acc = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  const con = w.d.one("SELECT * FROM gm_contracts");
  ok(acc.status === 200 && con && con.status === "sent" && con.company_signer_name === "Pat Owner", "the customer accepts; the contract carries the signer's signature, not the seller's");
}

// ── 6. A business with two kinds is asked which kind, then the template ──
{
  const w = newWorld({ trades: ["general", "cleaning"], migrations: ["migrations/contracts_e_cleaning.sql"] });
  const e = w.estimate(lead(w), { jobName: "House cleaning", price: 18000 });
  const c1 = await w.gm("POST", "estimates/" + e.id + "/send", CHECK());
  ok(c1.status === 200 && Array.isArray(c1.json.need_kind) && c1.json.need_kind.length === 2, "two trades: the form asks which kind of contract");
  const c2 = await w.gm("POST", "estimates/" + e.id + "/send", CHECK({ kind: "cleaning" }));
  ok(Array.isArray(c2.json.need_template) && c2.json.need_template.length === 4, "cleaning: the form asks the template");
  const c3 = await w.gm("POST", "estimates/" + e.id + "/send", CHECK({ kind: "cleaning", cleaning_template: "T1" }));
  console.log("   cleaning T1 form asks: " + JSON.stringify((c3.json.questions || []).map((q) => q.field)) + " blockers: " + JSON.stringify((c3.json.blockers || []).map((b) => b.en)));
  ok(c3.status === 200 && c3.json.kind === "cleaning" && c3.json.contract_needed === true, "cleaning always keeps its contract");
  const answers = fill(c3.json.questions || []);
  answers.late_cancel_fee = "$45.00"; answers.claim_window_hours = "24";
  ok(c3.json.need_oral_notice === true, "cleaning sold at the customer's home asks for the oral cancellation notice as a tick, not a red list");
  const c4 = await w.gm("POST", "estimates/" + e.id + "/send", CHECK({ kind: "cleaning", cleaning_template: "T1", answers, flags: { oral_notice_done: true } }));
  if (c4.json.ready) {
    const sent = await w.gm("POST", "estimates/" + e.id + "/send", SEND({ kind: "cleaning", cleaning_template: "T1", answers, flags: { oral_notice_done: true } }));
    const acc = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
    const con = w.d.one("SELECT * FROM gm_contracts");
    ok(sent.status === 200 && acc.status === 200 && con && JSON.parse(con.flags_json).kind === "cleaning" && con.status === "sent", "the cleaning contract is built from the form and sent to the customer");
  } else {
    ok(false, "the cleaning form reaches ready: " + JSON.stringify(c4.json.blockers) + " " + JSON.stringify(c4.json.questions));
  }
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
