// Send with contract (one link): the estimate, the contract, the signature and
// the first invoice travel from ONE link. The real Worker (whole file, real
// router, real handlers) on a copy of the live D1 schema. No network, nothing
// touches the production database.
//
//   node scripts/test-estimate-contract-flow.mjs
import { readFileSync } from "node:fs";
import { newWorld, loadWorker } from "./fixtures/flow-world.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };
const realErr = console.error; console.error = () => {};
const root = new URL("../", import.meta.url);

const ACCEPT = (name, extra) => Object.assign({ consent: true, signer_name: name || "Jordan Rivers", signature_kind: "typed", consent_text_version: "2026-10-04.1" }, extra || {});
const SIGN = (name, extra) => Object.assign({ consent: true, signer_name: name || "Jordan Rivers", signature_kind: "typed", initials: "JR", lien_typed: true, marketing_consent: false }, extra || {});
const FLOW = (extra) => Object.assign({ full_flow: true, consent: true, signer_name: "Pat Owner", consent_text: "I agree to sign this contract electronically on behalf of the company." }, extra || {});
const count = (w, sql, ...a) => w.d.one(sql, ...a).n;
const eventsOf = (w, cid) => w.d.q("SELECT action FROM gm_contract_events WHERE contract_id = ? ORDER BY rowid", cid).map((r) => r.action);

// The settings a business fills in once (notice days, work hours, warranty...).
// Everything the check still lists gets a plain value, round by round, so the
// owner's contract settings are "complete" for these scenarios.
async function readyUp(w, estId) {
  const vals = {};
  for (let i = 0; i < 5; i++) {
    const r = await w.gm("POST", "estimates/" + estId + "/send", { full_flow: true, check_only: true });
    if (r.status === 200 && r.json.ready) { return true; }
    ((r.json && r.json.questions) || []).forEach((q) => { const k = q.field; vals[k] = /_days$|_hours$/.test(k) ? "5" : (/date/.test(k) ? "11/16/2026" : "sample " + k); });
    w.d.x("UPDATE contract_client_settings SET values_json = ? WHERE client_id = ?", JSON.stringify(vals), w.CID);
  }
  return false;
}
function readyLead(w, o) {
  const id = w.lead(o);
  w.d.x("UPDATE gm_leads SET property_type = 'single_family', property_county = 'Hillsborough' WHERE id = ?", id);
  return id;
}

// ── 1. A normal send is today's send ─────────────────────────────────────
{
  const w = newWorld();
  const e = w.estimate(readyLead(w));
  const r = await w.gm("POST", "estimates/" + e.id + "/send");
  const row = w.d.one("SELECT status, company_presign_json FROM gm_estimates WHERE id = ?", e.id);
  ok(r.status === 200 && r.json.sent === true && /^https:\/\//.test(r.json.link) && typeof r.json.message === "string" && "phone" in r.json && "email" in r.json && "business_name" in r.json,
    "a normal send (no body) answers exactly as before: sent, message, link, phone, email, business name");
  ok(row.status === "sent" && row.company_presign_json === null, "a normal send marks the estimate sent and stores no pre-authorization");
  ok(count(w, "SELECT COUNT(*) n FROM gm_contracts") === 0 && count(w, "SELECT COUNT(*) n FROM gm_lead_events WHERE action = 'estimate_full_flow_authorized'") === 0, "a normal send creates no contract and records no one-link event");
  const r2 = await w.gm("POST", "estimates/" + e.id + "/send", { full_flow: false, consent: true });
  ok(r2.status === 200 && w.d.one("SELECT company_presign_json p FROM gm_estimates WHERE id = ?", e.id).p === null, "a body without full_flow true is still a normal send");
}

// ── 2. Who sees the option, and who may use it ──────────────────────────
{
  const w = newWorld();
  const owner = await w.gm("GET", "doc-messages", undefined, "owner1");
  const sam = await w.gm("GET", "doc-messages", undefined, "seller-sam");
  const nina = await w.gm("GET", "doc-messages", undefined, "seller-nina");
  ok(owner.json.settings_lite.full_flow_signer === "Pat Owner", "the owner is offered the option, as the owner signer");
  ok(sam.json.settings_lite.full_flow_signer === "Sam Seller", "a seller on the signer list is offered it, under their own name");
  ok(nina.json.settings_lite.full_flow_signer === null, "a seller who is not a signer is not offered it");
  w.d.x("DELETE FROM contract_client_settings WHERE client_id = ?", w.CID);
  const none = await w.gm("GET", "doc-messages", undefined, "owner1");
  ok(none.json.settings_lite.full_flow_signer === null, "a business with no contract settings is not offered it");
}
{
  const w = newWorld();
  const e = w.estimate(readyLead(w, { vendedor: "Nina NoSign" }));
  await readyUp(w, e.id);
  const r = await w.gm("POST", "estimates/" + e.id + "/send", FLOW(), "seller-nina");
  const row = w.d.one("SELECT status, company_presign_json p FROM gm_estimates WHERE id = ?", e.id);
  ok(r.status === 403 && row.status === "draft" && row.p === null, "a non-signer who sends with the option is refused (403) and the estimate is left as it was");
  const n2 = await w.gm("POST", "estimates/" + e.id + "/send", undefined, "seller-nina");
  ok(n2.status === 200 && w.d.one("SELECT status FROM gm_estimates WHERE id = ?", e.id).status === "sent", "the same seller still sends the normal way");
}

{
  // A seller who is on the signer list sends with the option and signs under their own name.
  const w = newWorld();
  const e = w.estimate(readyLead(w, { vendedor: "Sam Seller" }));
  await readyUp(w, e.id);
  const r = await w.gm("POST", "estimates/" + e.id + "/send", FLOW({ signer_name: "Sam Seller" }), "seller-sam");
  const pre = JSON.parse(w.d.one("SELECT company_presign_json p FROM gm_estimates WHERE id = ?", e.id).p || "null");
  ok(r.status === 200 && pre && pre.signer_name === "Sam Seller" && pre.actor_record.role === "seller", "an authorized seller sends with the option; the pre-authorization names them and their seller login");
  await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  const con = w.d.one("SELECT company_signer_name n, status s FROM gm_contracts");
  ok(con && con.n === "Sam Seller" && con.s === "sent", "and the contract is signed for the company by that seller");
}

// ── 3. The new send refuses, with the full list at once ──────────────────
{
  const w = newWorld();
  const lead = w.lead({ telefone: "", address: "" });
  const e = w.estimate(lead, { phone: "", address: "" });
  const r = await w.gm("POST", "estimates/" + e.id + "/send", FLOW());
  const row = w.d.one("SELECT status, company_presign_json p FROM gm_estimates WHERE id = ?", e.id);
  ok(r.status === 409 && r.json.code === "contract_incomplete", "missing information: the send is refused with the contract-incomplete answer");
  const miss = r.json.missing_fields || [];
  ok(miss.indexOf("owner_phone") !== -1 && miss.indexOf("license_type") !== -1 && miss.length > 2, "the answer lists everything at once: the customer's phone is named together with the business's own missing settings (" + miss.length + " items)");
  ok(miss.indexOf("owner_email") === -1, "the customer's email is never in that list");
  ok(row.status === "draft" && row.p === null && count(w, "SELECT COUNT(*) n FROM gm_contracts") === 0, "a refused send changes nothing: still a draft, no pre-authorization, no contract");
  ok(typeof r.json.error_pt === "string" && /Faltam dados/.test(r.json.error_pt) && /Missing information/.test(r.json.error_en), "the refusal is bilingual, in the contract's own words");
}
{
  const w = newWorld();
  const e = w.estimate(readyLead(w));
  await readyUp(w, e.id);
  const noConsent = await w.gm("POST", "estimates/" + e.id + "/send", FLOW({ consent: false }));
  const noName = await w.gm("POST", "estimates/" + e.id + "/send", FLOW({ signer_name: "" }));
  ok(noConsent.status === 400 && /agree to sign electronically/.test(noConsent.json.error_en), "without the consent box the send is refused (the company-sign wording)");
  ok(noName.status === 400 && w.d.one("SELECT status FROM gm_estimates WHERE id = ?", e.id).status === "draft", "without the typed name the send is refused and nothing changes");
  const chk = await w.gm("POST", "estimates/" + e.id + "/send", { full_flow: true, check_only: true });
  ok(chk.status === 200 && chk.json.check_only === true && w.d.one("SELECT status, company_presign_json p FROM gm_estimates WHERE id = ?", e.id).status === "draft", "the check alone answers ready and writes nothing");
}

// ── 4. The whole chain, from one link ────────────────────────────────────
{
  const w = newWorld();
  const e = w.estimate(readyLead(w));
  ok(await readyUp(w, e.id), "the contract settings are complete for this business");
  const sent = await w.gm("POST", "estimates/" + e.id + "/send", FLOW());
  const pre = JSON.parse(w.d.one("SELECT company_presign_json p FROM gm_estimates WHERE id = ?", e.id).p || "null");
  ok(sent.status === 200 && sent.json.sent === true && Object.keys(sent.json).sort().join() === "business_name,email,link,message,phone,sent", "the one-link send answers with the same fields as a normal send (the link, the message and the status are unchanged)");
  ok(pre && pre.consent === true && pre.signer_name === "Pat Owner" && pre.typed_name === "Pat Owner" && pre.user && /^[a-f0-9]{64}$/.test(pre.consent_text_sha256) && pre.ip && pre.user_agent && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(pre.at),
    "the owner's pre-authorization is stored: signer, user, hash of the consent words, IP, device and time");
  ok(count(w, "SELECT COUNT(*) n FROM gm_lead_events WHERE action = 'estimate_full_flow_authorized'") === 1, "an event records the authorization on the lead");
  ok(count(w, "SELECT COUNT(*) n FROM gm_contracts") === 0, "nothing is created at sending: the contract waits for the acceptance");

  const acc = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  ok(acc.status === 200 && acc.json.accepted === true, "the customer accepts the estimate");
  ok(Object.keys(acc.json).sort().join() === "accepted,content_hash,contract_link" && /^https:\/\//.test(acc.json.contract_link), "the accept answer carries only the contract link, nothing internal");
  const con = w.d.one("SELECT * FROM gm_contracts");
  ok(!!con && count(w, "SELECT COUNT(*) n FROM gm_contracts") === 1, "exactly one contract was created");
  ok(con && con.status === "sent" && con.company_signer_name === "Pat Owner" && con.company_signed_at && con.company_signature_kind === "typed" && con.snapshot_r2_key && con.content_hash && con.sent_at,
    "it is signed by the company (signature, frozen text and hash) and moved to sent");
  const flags = JSON.parse(con.flags_json);
  ok(flags.full_flow === true && JSON.parse(con.estimate_ids_json).join() === e.id, "it is marked as built by the one-link flow and holds this estimate");
  ok(/^203\.0\.113\./.test(con.company_signed_ip || "") && con.company_signed_ua === "TestBrowser/1.0", "the company signature keeps its evidence: IP and device of the moment it was applied");
  const evs = eventsOf(w, con.id);
  ok(["created", "flow_started", "company_signed", "flow_company_signed", "sent", "flow_sent"].every((a) => evs.indexOf(a) !== -1), "every chained step is logged in the contract events (" + evs.join(", ") + ")");
  ok(w.d.one("SELECT status FROM gm_estimates WHERE id = ?", e.id).status === "accepted" && count(w, "SELECT COUNT(*) n FROM gm_jobs") === 1 && w.d.one("SELECT estagio FROM gm_leads WHERE id = ?", e.leadId).estagio === "fechado", "the estimate is accepted, the lead is closed and the project exists, as today");
  ok(w.d.one("SELECT company_signed_at s, accepted_at a FROM gm_contracts c, gm_estimates e WHERE e.id = ?", e.id).s.slice(0, 10) === w.d.one("SELECT accepted_at a FROM gm_estimates WHERE id = ?", e.id).a.slice(0, 10), "the company signature date is the acceptance date");

  // The customer opens the contract and signs.
  const ctok = con.public_token;
  const view = await w.pub("GET", "/contracts/" + ctok);
  ok(view.status === 200 && view.json.contract.pay_link === null, "before the customer signs there is no pay link on the contract page");
  ok(count(w, "SELECT COUNT(*) n FROM gm_invoices") === 0, "no invoice exists before both parties have signed");
  const signed = await w.pub("POST", "/contracts/" + ctok + "/sign", SIGN());
  if (signed.status !== 200) { console.log("   sign answered", signed.status, signed.text.slice(0, 300)); }
  ok(signed.status === 200 && signed.json.signed === true, "the customer signs the contract");
  const invs = w.d.q("SELECT * FROM gm_invoices ORDER BY rowid");
  ok(invs.length === 3 && invs.map((i) => i.step_label).join() === "Deposit,Mid-project,Completion", "the job's three scheduled invoices exist (" + invs.map((i) => i.step_label).join(", ") + ")");
  ok(invs[0].status === "sent" && invs[0].sent_at && invs[1].status === "draft" && invs[2].status === "draft", "ONLY the first (the deposit) is sent; the later ones stay drafts for the contractor");
  ok(invs[0].amount_cents === 375000 && invs.reduce((a, i) => a + i.amount_cents, 0) === 1250000, "the deposit is 30 percent of the contract price ($3,750.00 of $12,500.00); the three add up to the contract");
  const after = w.d.one("SELECT flags_json f, status FROM gm_contracts WHERE id = ?", con.id);
  ok(after.status === "completed" && JSON.parse(after.f).first_invoice_id === invs[0].id && JSON.parse(after.f).full_flow === true, "the contract is completed and remembers its first invoice");
  const view2 = await w.pub("GET", "/contracts/" + ctok);
  ok(view2.status === 200 && /^https:\/\//.test(view2.json.contract.pay_link), "after both signatures the contract page carries the pay link");
  const payTok = invs[0].public_token;
  const inv = await w.pub("GET", "/invoices/" + payTok);
  ok(inv.status === 200 && JSON.stringify(inv.json).indexOf("pay@sunrise.test") !== -1, "the pay link opens the deposit invoice, which lists the payment methods the contractor set");
  const lateInv = await w.pub("GET", "/invoices/" + invs[1].public_token);
  console.log("   (a draft invoice link answers " + lateInv.status + ")");
  ok(lateInv.status === 404, "the later invoices are not reachable by the customer while they are drafts (404)");
  ok(JSON.stringify(view2.json).indexOf(invs[1].public_token) === -1 && JSON.stringify(view2.json).indexOf(invs[2].public_token) === -1, "the contract page never exposes the other invoices");
  ok(eventsOf(w, con.id).indexOf("flow_invoice_sent") !== -1, "the invoice step is logged in the contract events");
  // Idempotency: repeat every step.
  const again = await w.pub("POST", "/contracts/" + ctok + "/sign", SIGN());
  const acc2 = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  ok(again.status === 409 && acc2.status === 409, "signing twice and accepting twice are both refused");
  ok(count(w, "SELECT COUNT(*) n FROM gm_contracts") === 1 && count(w, "SELECT COUNT(*) n FROM gm_invoices") === 3, "repeating a step creates no second contract and no second invoice");
  const btn = await w.gm("POST", "jobs/" + con.job_id + "/invoices-from-estimate");
  ok(btn.status === 409 && count(w, "SELECT COUNT(*) n FROM gm_invoices") === 3, "the Create invoices button still answers 409 once they exist");

  // The estimate's own public payload never shows the pre-authorization.
  const pe = await w.pub("GET", "/estimates/" + e.token);
  ok(pe.status === 200 && JSON.stringify(pe.json).indexOf("presign") === -1 && JSON.stringify(pe.json).indexOf("Pat Owner") === -1, "the customer's estimate payload carries nothing of the pre-authorization");
}

// ── 5. Accept without a pre-authorization is today's accept ─────────────
{
  const w = newWorld();
  const e = w.estimate(readyLead(w));
  await w.gm("POST", "estimates/" + e.id + "/send");
  const acc = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  ok(acc.status === 200 && Object.keys(acc.json).sort().join() === "accepted,content_hash", "accept without the option answers exactly as before (no link)");
  ok(count(w, "SELECT COUNT(*) n FROM gm_contracts") === 0 && count(w, "SELECT COUNT(*) n FROM gm_invoices") === 0 && count(w, "SELECT COUNT(*) n FROM gm_jobs") === 1, "it creates the project and nothing else: no contract, no invoice");
}

// ── 6. A chain failure leaves the acceptance standing ───────────────────
{
  const w = newWorld();
  const lead = readyLead(w);
  const e = w.estimate(lead);
  await readyUp(w, e.id);
  await w.gm("POST", "estimates/" + e.id + "/send", FLOW());
  // Between sending and accepting the customer's details were wiped.
  w.d.x("UPDATE gm_leads SET telefone = '', address = '' WHERE id = ?", lead);
  w.d.x("UPDATE gm_estimates SET customer_phone = '', customer_address = '' WHERE id = ?", e.id);
  const acc = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  ok(acc.status === 200 && acc.json.accepted === true && acc.json.contract_link === undefined, "the acceptance succeeds exactly as today and no contract link is offered");
  ok(w.d.one("SELECT status FROM gm_estimates WHERE id = ?", e.id).status === "accepted" && count(w, "SELECT COUNT(*) n FROM gm_jobs") === 1, "the estimate is accepted and the project exists");
  const con = w.d.one("SELECT * FROM gm_contracts");
  ok(con && con.status === "draft" && !con.company_signed_at, "the contract that was created stays a draft for the contractor, unsigned");
  const evs = eventsOf(w, con.id);
  ok(evs.indexOf("flow_stopped") !== -1 && evs.indexOf("company_signed") === -1, "a clear event records where it stopped");
  const resp = w.d.one("SELECT * FROM gm_homeowner_responses");
  ok(resp && resp.response === "contract_not_ready" && resp.doc_kind === "estimate" && /Missing information/.test(resp.reason) && /owner_phone/.test(resp.reason), "the owner is told through the customer-responses list, with the reason");
  ok(count(w, "SELECT COUNT(*) n FROM gm_lead_events WHERE action = 'contract_flow_stopped'") === 1, "the lead history says the one-link flow stopped");
  const list = await w.gm("GET", "homeowner-responses");
  ok(list.status === 200 && list.json.responses.length === 1, "the owner's Home list returns it");
  ok(count(w, "SELECT COUNT(*) n FROM gm_invoices") === 0, "no invoice was created");
}
{
  // No license on a Florida job: the create step itself refuses.
  const w = newWorld();
  const lead = readyLead(w);
  const e = w.estimate(lead);
  await readyUp(w, e.id);
  await w.gm("POST", "estimates/" + e.id + "/send", FLOW());
  w.d.x("UPDATE gm_doc_settings SET license_numbers = '[]' WHERE client_id = ?", w.CID);
  const acc = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  ok(acc.status === 200 && acc.json.contract_link === undefined && count(w, "SELECT COUNT(*) n FROM gm_contracts") === 0, "a missing Florida license stops the chain before any contract exists; the acceptance stands");
  ok(w.d.one("SELECT response FROM gm_homeowner_responses").response === "contract_not_ready", "and the owner is told");
}
{
  // The pre-authorization of another revision never applies.
  const w = newWorld();
  const e = w.estimate(readyLead(w));
  await readyUp(w, e.id);
  await w.gm("POST", "estimates/" + e.id + "/send", FLOW());
  w.d.x("UPDATE gm_estimates SET revision = 2 WHERE id = ?", e.id);
  const acc = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  ok(acc.status === 200 && acc.json.contract_link === undefined && count(w, "SELECT COUNT(*) n FROM gm_contracts") === 0, "a pre-authorization that no longer matches the estimate is not used");
}
{
  // A normal send after a one-link send withdraws the authorization.
  const w = newWorld();
  const e = w.estimate(readyLead(w));
  await readyUp(w, e.id);
  await w.gm("POST", "estimates/" + e.id + "/send", FLOW());
  await w.gm("POST", "estimates/" + e.id + "/send");
  ok(w.d.one("SELECT company_presign_json p FROM gm_estimates WHERE id = ?", e.id).p === null, "a normal re-send withdraws the earlier pre-authorization");
  const acc = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  ok(acc.json.contract_link === undefined && count(w, "SELECT COUNT(*) n FROM gm_contracts") === 0, "and the acceptance then chains nothing");
}

// ── 7. A hand-built contract does not chain ─────────────────────────────
{
  const w = newWorld();
  const e = w.estimate(readyLead(w));
  await readyUp(w, e.id);
  await w.gm("POST", "estimates/" + e.id + "/send");
  await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  const job = w.d.one("SELECT id FROM gm_jobs");
  const made = await w.gm("POST", "jobs/" + job.id + "/contracts", {});
  ok(made.status === 200 && made.json.created === true, "the contractor builds the contract by hand, as always");
  const cid = made.json.contract_id;
  ok(JSON.parse(w.d.one("SELECT flags_json f FROM gm_contracts WHERE id = ?", cid).f).full_flow === undefined, "a hand-built contract carries no one-link mark");
  const sg = await w.gm("POST", "contracts/" + cid + "/company-sign", { consent: true, signature_kind: "typed" });
  ok(sg.status === 200 && sg.json.signed === true, "the owner signs it from the button");
  const sd = await w.gm("POST", "contracts/" + cid + "/send");
  ok(sd.status === 200 && sd.json.sent === true && /^https:\/\//.test(sd.json.link) && typeof sd.json.message === "string", "the Send button still answers with the link and the message");
  const tok = w.d.one("SELECT public_token t FROM gm_contracts WHERE id = ?", cid).t;
  const signed = await w.pub("POST", "/contracts/" + tok + "/sign", SIGN());
  ok(signed.status === 200, "the customer signs it");
  ok(count(w, "SELECT COUNT(*) n FROM gm_invoices") === 0, "no invoice is created automatically for a hand-built contract");
  const view = await w.pub("GET", "/contracts/" + tok);
  ok(view.json.contract.pay_link === null, "and its page offers no pay link");
  const btn = await w.gm("POST", "jobs/" + job.id + "/invoices-from-estimate");
  ok(btn.status === 200 && btn.json.created.length === 3 && w.d.q("SELECT status FROM gm_invoices").every((r) => r.status === "draft"), "the Create invoices button still makes all three as drafts");
  const snd = await w.gm("POST", "invoices/" + btn.json.created[0].id + "/send");
  ok(snd.status === 200 && snd.json.sent === true && /^https:\/\//.test(snd.json.link) && typeof snd.json.message === "string", "the invoice Send button still answers with the link and the message");
}

// ── 8. Invoices that already exist are reused, never doubled ────────────
{
  const w = newWorld();
  const e = w.estimate(readyLead(w));
  await readyUp(w, e.id);
  await w.gm("POST", "estimates/" + e.id + "/send", FLOW());
  const acc = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  const con = w.d.one("SELECT * FROM gm_contracts");
  // The contractor pressed Create invoices in between, and sent the first one.
  const made = await w.gm("POST", "jobs/" + con.job_id + "/invoices-from-estimate");
  await w.gm("POST", "invoices/" + made.json.created[0].id + "/send");
  const sentAt = w.d.one("SELECT sent_at s FROM gm_invoices WHERE id = ?", made.json.created[0].id).s;
  const signed = await w.pub("POST", "/contracts/" + con.public_token + "/sign", SIGN());
  ok(signed.status === 200 && count(w, "SELECT COUNT(*) n FROM gm_invoices") === 3, "invoices that already exist are not created again");
  const f = JSON.parse(w.d.one("SELECT flags_json f FROM gm_contracts WHERE id = ?", con.id).f);
  ok(f.first_invoice_id === made.json.created[0].id && w.d.one("SELECT sent_at s FROM gm_invoices WHERE id = ?", f.first_invoice_id).s === sentAt, "a first invoice that is already sent keeps its link and its date");
  const view = await w.pub("GET", "/contracts/" + con.public_token);
  ok(/^https:\/\//.test(view.json.contract.pay_link), "and the page links to it");
}
{
  // Invoice creation fails: the signing completes, only the download is offered.
  const w = newWorld();
  const e = w.estimate(readyLead(w));
  await readyUp(w, e.id);
  await w.gm("POST", "estimates/" + e.id + "/send", FLOW());
  await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  const con = w.d.one("SELECT * FROM gm_contracts");
  // Between the two signatures the estimate's payment schedule is lost.
  w.d.x("UPDATE gm_estimates SET schedule_json = '[]' WHERE id = ?", e.id);
  const signed = con ? await w.pub("POST", "/contracts/" + con.public_token + "/sign", SIGN()) : { status: 0 };
  ok(con && signed.status === 200 && w.d.one("SELECT status FROM gm_contracts WHERE id = ?", con.id).status === "completed", "when the invoices cannot be made, the signing still completes");
  ok(count(w, "SELECT COUNT(*) n FROM gm_invoices") === 0, "no invoice exists");
  const view = con ? await w.pub("GET", "/contracts/" + con.public_token) : { json: { contract: {} } };
  ok(view.json.contract.pay_link === null, "the page offers no pay link, so only the download shows");
  ok(con && eventsOf(w, con.id).indexOf("flow_stopped") !== -1, "an event records it");
  const resp = w.d.q("SELECT * FROM gm_homeowner_responses WHERE doc_kind = 'contract'")[0];
  ok(resp && resp.response === "invoice_not_ready" && /payment schedule/.test(resp.reason), "the owner is told through the customer-responses list");
}

// ── 9. A tiered estimate carries the accepted option ────────────────────
{
  const w = newWorld();
  const e = w.estimate(readyLead(w), { mode: "tiered", prices: [1500000, 900000] });
  await readyUp(w, e.id);
  const sent = await w.gm("POST", "estimates/" + e.id + "/send", FLOW());
  ok(sent.status === 200, "a tiered estimate is checked and sent with the option");
  const acc = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT("Jordan Rivers", { option_id: e.optionIds[1] }));
  ok(acc.status === 200 && /^https:\/\//.test(acc.json.contract_link), "the customer picks the second option and accepts");
  const con = w.d.one("SELECT * FROM gm_contracts");
  ok(con && con.contract_amount_cents === 900000, "the contract is for the option the customer chose ($9,000.00), not the first one");
  const signed = await w.pub("POST", "/contracts/" + con.public_token + "/sign", SIGN());
  const invs = w.d.q("SELECT amount_cents, status FROM gm_invoices ORDER BY rowid");
  ok(signed.status === 200 && invs.length === 3 && invs[0].amount_cents === 270000 && invs[0].status === "sent", "and the deposit follows that option (30 percent of $9,000.00 is $2,700.00)");
}

// ── 10. The customer's email is never required ──────────────────────────
{
  const W = loadWorker();
  const f = (t, v) => W.contractFill(t, v);
  const withE = { owner_phone: "(813) 555-0111", owner_email: "jordan@example.test" }, noE = { owner_phone: "(813) 555-0111", owner_email: "" };
  const A = '{owner_mailing_address}, phone {owner_phone}, email {owner_email} ("Owner"). The work';
  ok(f(A, Object.assign({ owner_mailing_address: "12 Main St" }, withE)) === '12 Main St, phone (813) 555-0111, email jordan@example.test ("Owner"). The work', "with an email, the opening clause reads exactly as before");
  ok(f(A, Object.assign({ owner_mailing_address: "12 Main St" }, noE)) === '12 Main St, phone (813) 555-0111 ("Owner"). The work', "without one, the clause leaves out ', email' and reads: phone (813) 555-0111 (\"Owner\")");
  const C = "phone {owner_phone}, email {owner_email}. The person";
  ok(f(C, noE) === "phone (813) 555-0111. The person" && f(C, withE) === "phone (813) 555-0111, email jordan@example.test. The person", "the rental clause behaves the same way");
  const CL = "Customer\"), {customer_phone}, {customer_email}. Contractor will";
  ok(f(CL, { customer_phone: "(813) 555-0111", customer_email: "" }) === 'Customer"), (813) 555-0111. Contractor will', "and so does the cleaning agreement's contact line");
  ok(f("Sent to {business_email}.", { business_email: "" }) === "Sent to {business_email}.", "any other empty placeholder is still reported as missing (only the customer's email changed)");
  const w = newWorld();
  const e = w.estimate(readyLead(w, { email: "" }), { email: "" });
  ok(await readyUp(w, e.id), "an estimate whose customer has no email passes the check");
  await w.gm("POST", "estimates/" + e.id + "/send", FLOW());
  const acc = await w.pub("POST", "/estimates/" + e.token + "/accept", ACCEPT());
  ok(/^https:\/\//.test(acc.json.contract_link || ""), "and the whole chain runs without an email");
  const con = w.d.one("SELECT snapshot_r2_key k FROM gm_contracts");
  const raw = w.env.ASSETS.m.get(con.k);
  const snap = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
  const txt = snap.sections.map((s) => s.text).join("\n");
  const parties = (txt.match(/\*\*1\. Parties and Property\.\*\*[^\n]*/) || [""])[0];
  ok(/\("Owner"\)/.test(parties) && !/phone \(813\) 555-0111, email/.test(parties) && /phone \(813\) 555-0111 \("Owner"\)/.test(parties), "the signed text holds no empty 'email' for the owner");
  // And for a contract by hand, on the page that lists what is missing.
  const w2 = newWorld();
  const e2 = w2.estimate(readyLead(w2, { email: "" }), { email: "" });
  await readyUp(w2, e2.id);
  await w2.gm("POST", "estimates/" + e2.id + "/send");
  await w2.pub("POST", "/estimates/" + e2.token + "/accept", ACCEPT());
  const job = w2.d.one("SELECT id FROM gm_jobs");
  const made = await w2.gm("POST", "jobs/" + job.id + "/contracts", {});
  const detail = await w2.gm("GET", "contracts/" + made.json.contract_id);
  ok(detail.status === 200 && (detail.json.contract.missing || []).every((m) => m.field !== "owner_email"), "for a contract built by hand, an empty email is not a missing field either");
  const sg = await w2.gm("POST", "contracts/" + made.json.contract_id + "/company-sign", { consent: true, signature_kind: "typed" });
  ok(sg.status === 200, "and the company can sign it");
}

// The cleaning agreement and the construction contract, composed whole with no email anywhere.
{
  const { buildComposer, FLORIDA_FIXTURES } = await import("./fixtures/contract-compose-harness.mjs");
  const h = await buildComposer(readFileSync(new URL("worker/index.js", root), "utf8"), { migrations: ["migrations/contracts_e_cleaning.sql"] });
  const run = async (fx, email) => {
    const ctx = await h.context(fx);
    ctx.lead.email = email; ctx.estimates[0].customer_email = email;
    const flags = Object.assign({}, fx.flags || {});
    const start = flags.kind === "cleaning" ? h.fns.contractCleaningDefaults(ctx, { flags: flags }, h.fns.contractCleaningGate(ctx, "2026-10-01")) : h.defaultSelections(ctx);
    const c = { id: "con-1", client_id: "client-1", number: "CON-0007", revision: 1, status: "draft", contract_date: "2026-10-01", offer_expiry_date: "2026-10-30", selections: start, answers: {}, flags: flags, custom_clauses: [], estimate_ids: ["est-1"] };
    const comp = h.fns.contractCompose(ctx, c, "2026-10-01", "template");
    return { comp: comp, text: comp.sections.map((s) => s.text).join("\n") };
  };
  const fl = JSON.parse(JSON.stringify(FLORIDA_FIXTURES["small-job"]));
  const cl = { amount_cents: 18000, item_name: "House cleaning", schedule: [{ label: "On completion", pct: 100 }], settings: { trades: ["cleaning"], values: {} }, doc: { legal_name: "Bright Home Cleaning LLC" }, flags: { kind: "cleaning", cleaning_template: "T1", sold_in_home: true, job_state: "FL" } };
  const a = await run(fl, "jordan@example.test"), b = await run(fl, "");
  ok(a.text.indexOf("phone (813) 555-0111, email jordan@example.test (\"Owner\")") !== -1 && b.text.indexOf("phone (813) 555-0111 (\"Owner\")") !== -1 && !b.comp.missing.some((m) => /email/.test(m.field)), "the whole construction contract: with an email as before; without, no 'email' label and no missing field");
  const c1 = await run(JSON.parse(JSON.stringify(cl)), "jordan@example.test"), c2 = await run(JSON.parse(JSON.stringify(cl)), "");
  ok(c1.text.indexOf("(813) 555-0111, jordan@example.test. Contractor will clean") !== -1 && c2.text.indexOf("(813) 555-0111. Contractor will clean") !== -1 && c2.text.indexOf("{customer_email}") === -1 && !c2.comp.missing.some((m) => /email/.test(m.field)), "the whole cleaning agreement: the same, with its own line");
}

// ── 11. The pages and the rest of the build ─────────────────────────────
{
  const est = readFileSync(new URL("estimate-view.html", root), "utf8");
  const con = readFileSync(new URL("contract-view.html", root), "utf8");
  ok(/continueLink = \(typeof r\.data\.contract_link === "string"/.test(est) && /id="btnContract" onclick="openContract\(\)">Contract<\/button>/.test(est), "estimate-view.html shows one button, labelled Contract, only when the accept answer carried a link");
  ok(/id="btnPay">Pay<\/button>/.test(con) && /con\.status === "completed" && typeof con\.pay_link === "string"/.test(con) && /Download your signed contract \(PDF\)/.test(con), "contract-view.html offers the existing download and a Pay button, only for a completed contract with a pay link");
  ok(/window\.location\.href = con\.pay_link/.test(con) && /window\.location\.href = continueLink/.test(est), "both buttons open the next page in the same tab");
  const gm = readFileSync(new URL("gm.js", root), "utf8");
  ok(/Enviar com contrato \(um só link\)", "Send with contract \(one link\)"/.test(gm) && /gmEstFlowSigner\(\)/.test(gm) && /full_flow: true, consent: true/.test(gm), "the send sheet has the option, off by default, for signers only");
  ok(/Concordo em assinar eletronicamente este contrato em nome da empresa\.", "I agree to sign this contract electronically on behalf of the company\./.test(gm), "the sheet reuses the company-sign consent line word for word");
  const sql = readFileSync(new URL("migrations/2026-10-30_estimate_company_presign.sql", root), "utf8").replace(/^--.*$/gm, "").trim();
  ok(sql === "ALTER TABLE gm_estimates ADD COLUMN company_presign_json TEXT DEFAULT NULL;", "the one migration is a single additive, nullable column");
  for (const f of ["estimate-view.html", "contract-view.html", "gm.js"]) {
    const a = readFileSync(new URL(f, root), "utf8");
    ok(!/[\u2013\u2014]/.test(a.split("\n").filter((l) => /OneLink|one link|full_flow|contract_link|pay_link|btnPay|btnContract/.test(l)).join("\n")), f + ": no long dashes in the new lines");
  }
}

console.error = realErr;
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
