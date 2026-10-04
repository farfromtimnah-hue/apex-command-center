// The public Apex invoice page's Worker side, against the REAL functions on an
// in-memory SQLite (scripts/fixtures/d1-shim.mjs). No network.
//
//   node scripts/test-apex-invoice-public.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { makeDb, build, baseStubs, req, hasFn, workerSrc } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
const MIGS = ["migrations/apex_club_company.sql", "migrations/apex_invoice_public.sql", "migrations/apex_club_pay.sql"];
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const TOK = (ch) => ch.repeat(48);

function world() {
  const d = makeDb(MIGS);
  d.raw.exec("INSERT INTO business_settings (id, zelle_handle, zelle_qr_r2_key, stripe_payment_link) VALUES (1, 'pay@apex.test', 'business/zelle-qr.png', 'https://buy.stripe.com/static')");
  d.raw.exec("INSERT INTO clients (id, name, status, package, email, phone) VALUES ('c1', 'ALPHA BUILDERS', 'active', 'ADV', 'owner@alpha.test', '8135550199')");
  d.raw.exec("INSERT INTO packages (id, name, short_name, full_name) VALUES ('p1', 'Advanced', 'ADV', 'APEX ADVANCED')");
  d.raw.exec("INSERT INTO accounts (id, purpose) VALUES ('acct_biz', 'business')");
  return d;
}
function seedInvoice(d, id, status, extra) {
  const e = Object.assign({ cents: 250000, due: "2099-01-31", token: null, line: null, notes: null }, extra || {});
  d.raw.prepare("INSERT INTO invoices (id, client_id, number, amount_cents, issued_at, due_at, status, public_token, line_description, notes) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, "c1", "INV-9" + id, e.cents, "2026-09-01", e.due, status, e.token, e.line, e.notes);
}
// A stand-in for Stripe: records every call, hands back ids. No network.
function fakeStripe() {
  const calls = []; let n = 0; const alerts = [];
  return {
    calls, alerts,
    apxStripePost: async (env, path, params) => {
      calls.push({ path, params: Object.fromEntries(params) });
      if (fakeStripe.failKind && path === "payment_links" && params.some(p => p[0] === "payment_method_types[0]" && p[1] === fakeStripe.failKind)) {
        const e = new Error("Stripe payment_links failed: The payment method type provided: us_bank_account is invalid."); e.status = 400; throw e;
      }
      n++;
      if (path === "prices") { return { id: "price_" + n, product: "prod_" + n }; }
      if (path === "payment_links") { return { id: "plink_" + n, url: "https://buy.stripe.com/test_" + n }; }
      return { id: path.split("/")[1], active: false };
    },
    notifyNicoleTelegram: async (env, msg) => { alerts.push(msg); }
  };
}
const stubsFor = (st, extra) => Object.assign({}, baseStubs, {
  easternDateStr: () => "2026-10-04", APEX_API_BASE: "https://api.test", DEFAULT_ORIGIN: "https://apex.test",
  gmEstPublicRateLimit: async () => null, crypto: globalThis.crypto, REQUEST_CTX: new WeakMap(),
  apxStripePost: st.apxStripePost, notifyNicoleTelegram: st.notifyNicoleTelegram, APX_STRIPE_ACH_ENABLED: false
}, extra || {});
const stubs = stubsFor(fakeStripe());
const fns = ["apxInvSwitches", "apxInvNoIndex", "apxInvByToken", "apxInvEasternDate", "apxInvMoney", "apxInvPayload", "apxInvPayBlock", "handleGetPublicApexInvoice",
  "apxPayLockTake", "apxPayLockRelease", "apxInvRetireLinks", "apxInvEnsurePayLinks", "apxInvAfterView", "apxUsd", "applyStripeChargesToApexInvoices"];

{
  const d = world(); const env = { DB: d.DB };
  const F = build(fns, ["APX_INV_PAGE"], stubs);
  const get = async (tok, url) => { const r = await F.handleGetPublicApexInvoice(tok, req({}, url || "https://x.test/api/public/apex-invoices/" + tok), env); return r; };

  seedInvoice(d, "001", "sent", { token: TOK("a"), line: "Consultoria de outubro", notes: "Obrigado pela parceria." });
  let r = await get(TOK("a")); let inv = r.data.invoice;
  ok(r.status === 200 && inv.number === "INV-9001" && inv.status === "open" && inv.draft === false, "a sent invoice reads open");
  ok(inv.balance_cents === 250000 && inv.paid_cents === 0 && inv.total_cents === 250000 && inv.subtotal_cents === 250000, "balance = total when nothing is paid");
  ok(inv.subject === "Consultoria de outubro" && inv.items[0].description === "Consultoria de outubro" && inv.description === "Obrigado pela parceria.", "subject is line_description; description is the notes");
  ok(inv.client_name === "ALPHA BUILDERS" && !/alpha\.test|8135550199/.test(JSON.stringify(inv)), "client name only: no email or phone anywhere in the payload");
  ok(!/nicole/i.test(JSON.stringify(inv)), "nothing in the payload names Nicole");
  ok(inv.payment && inv.payment.zelle_handle === "pay@apex.test" && inv.payment.zelle_qr_url === "https://api.test/api/business/qr-image", "Zelle handle and QR come from business_settings");
  ok(inv.payment.card.enabled === false && inv.payment.ach.available === false && !/stripe\.com/.test(JSON.stringify(inv)), "master switch OFF: no card, no ACH, no Stripe url (not even the static link)");
  ok(d.q("SELECT view_count, first_viewed_at IS NOT NULL AS f, last_viewed_at IS NOT NULL AS l FROM invoices WHERE id = '001'")[0].view_count === 1, "a view is counted");
  await get(TOK("a"), "https://x.test/api/public/apex-invoices/x?render=1");
  ok(d.q("SELECT view_count FROM invoices WHERE id = '001'")[0].view_count === 1, "the PDF printer's read (render=1) is not a view");

  seedInvoice(d, "002", "sent", { token: TOK("b") });
  inv = (await get(TOK("b"))).data.invoice;
  ok(inv.subject === "APEX ADVANCED" && inv.items[0].description === "APEX ADVANCED", "with no line_description the subject is the package's full name");

  seedInvoice(d, "003", "draft", { token: TOK("c") });
  inv = (await get(TOK("c"))).data.invoice;
  ok(inv.status === "draft" && inv.draft === true && inv.payment === null, "a draft is viewable, marked draft, and carries NO way to pay");

  seedInvoice(d, "004", "voided_mistake", { token: TOK("d") }); seedInvoice(d, "005", "void", { token: TOK("e") });
  ok((await get(TOK("d"))).status === 404 && (await get(TOK("e"))).status === 404, "voided_mistake and void are 404");
  ok((await get(TOK("f"))).status === 404, "an unknown token is 404");
  ok((await get("xyz")).status === 404 && (await get(TOK("A"))).status === 404, "a malformed token is 404");

  seedInvoice(d, "006", "sent", { token: TOK("1"), cents: 99700 });
  d.raw.exec("INSERT INTO transactions (id, account_id, amount_cents, date) VALUES ('t1', 'acct_biz', 40000, '2026-09-05')");
  d.raw.exec("INSERT INTO invoice_payments (id, invoice_id, transaction_id, amount_cents, match_type) VALUES ('p1','006','t1',40000,'manual'), ('p2','006',NULL,10000,'manual_no_txn')");
  d.raw.exec("UPDATE invoice_payments SET undone_at = datetime('now') WHERE id = 'p2'");
  inv = (await get(TOK("1"))).data.invoice;
  ok(inv.status === "partial" && inv.paid_cents === 40000 && inv.balance_cents === 59700 && inv.payments.length === 1 && inv.payments[0].date === "2026-09-05", "partial: undone payments do not count; the payment date is the bank's");

  seedInvoice(d, "007", "sent", { token: TOK("2"), due: "2026-10-03" });
  ok((await get(TOK("2"))).data.invoice.status === "overdue", "due yesterday (Eastern) with a balance reads overdue");
  seedInvoice(d, "008", "sent", { token: TOK("3"), due: "2026-10-04" });
  ok((await get(TOK("3"))).data.invoice.status === "open", "due today is not overdue");

  seedInvoice(d, "009", "paid", { token: TOK("4"), cents: 70000 });
  d.raw.exec("INSERT INTO invoice_payments (id, invoice_id, amount_cents, match_type) VALUES ('p3','009',69850,'manual_no_txn')");
  inv = (await get(TOK("4"))).data.invoice;
  ok(inv.status === "paid" && inv.balance_cents === 0 && inv.payment === null, "paid: balance 0 even when closed a rounding difference short, no way to pay");

  seedInvoice(d, "010", "sent", { token: TOK("5") });
  d.raw.exec("UPDATE invoices SET claimed_paid_at = '2026-10-01 10:00:00', claimed_paid_by = 'Alice', claimed_paid_note = 'viu no banco' WHERE id = '010'");
  inv = (await get(TOK("5"))).data.invoice;
  ok(inv.status === "open" && inv.balance_cents === 250000 && !/claimed|viu no banco/.test(JSON.stringify(inv)), "the sticky paid claim is never rendered as paid and never leaves the Worker");

  ok(F.apxInvEasternDate("2026-10-04 02:30:00") === "2026-10-03" && F.apxInvEasternDate("2026-10-04") === "2026-10-04", "UTC timestamps become the Eastern calendar date");
}

// ── Phase 3: Stripe pay links (a stand-in Stripe, no network) ──────────────
{
  const d = world(); const env = { DB: d.DB }; const st = fakeStripe();
  const F = build(fns, ["APX_INV_PAGE"], stubsFor(st, { APX_STRIPE_ACH_ENABLED: true }));
  const invRow = (id) => d.q("SELECT i.*, c.name AS client_name, c.package, c.invoice_card_enabled FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?", id)[0];
  const links = (id) => d.q("SELECT kind, amount_cents, active, stripe_link_id, deactivated_at IS NOT NULL AS off FROM apex_invoice_pay_links WHERE invoice_id = ? ORDER BY id", id);
  const ON = { invoice_link: true, club_pay: false }, OFF = { invoice_link: false, club_pay: false };
  seedInvoice(d, "101", "sent", { token: TOK("a"), cents: 2500 });

  let r = await F.apxInvEnsurePayLinks(env, invRow("101"));
  ok(r.created.length === 1 && r.created[0].kind === "ach" && links("101").length === 1 && links("101")[0].amount_cents === 2500, "card off: only an ACH link, for exactly the balance");
  const priceCall = st.calls.find(c => c.path === "prices"), linkCall = st.calls.find(c => c.path === "payment_links");
  ok(priceCall.params.unit_amount === "2500" && priceCall.params.currency === "usd" && priceCall.params["product_data[name]"] === "Fatura INV-9101 Apex Business & Leadership", "the price is one-time usd for the balance, named after the invoice");
  ok(linkCall.params["payment_method_types[0]"] === "us_bank_account" && linkCall.params["payment_intent_data[metadata][apex_invoice_id]"] === "101" && linkCall.params["payment_intent_data[metadata][client_id]"] === "c1" &&
     linkCall.params["payment_intent_data[metadata][apex_client_id]"] === "c1" && linkCall.params["payment_intent_data[metadata][apex_invoice_number]"] === "INV-9101" && linkCall.params["metadata[apex_invoice_id]"] === "101",
     "the link carries the invoice and client metadata on the payment intent and at the top level");
  ok(linkCall.params["after_completion[redirect][url]"] === "https://apex.test/apex-invoice-view.html?t=" + TOK("a") + "&paid=1&lang=pt", "after payment Stripe returns to the invoice page with paid=1");
  ok(!Object.keys(linkCall.params).some(k => /fee|surcharge|shipping|tax/i.test(k)), "no fee, surcharge or extra line on the link");

  let p = (await F.apxInvPayload(env, invRow("101"), ON)).payment;
  ok(p.ach.available && /^https:\/\/buy\.stripe\.com\//.test(p.ach.url) && p.card.enabled === false && !p.card.url, "switch ON: the payload offers ACH and no card");
  p = (await F.apxInvPayload(env, invRow("101"), OFF)).payment;
  ok(!p.ach.available && !p.ach.url && !p.card.enabled && !/stripe\.com/.test(JSON.stringify(p)), "switch OFF: the same invoice carries no ACH, no card and no Stripe url, even with a live link stored");

  d.raw.exec("UPDATE clients SET invoice_card_enabled = 1 WHERE id = 'c1'");
  let before = st.calls.length;
  r = await F.apxInvEnsurePayLinks(env, invRow("101"));
  ok(r.created.length === 1 && r.created[0].kind === "card" && links("101").filter(l => l.active).length === 2, "card switched on: a card link is added, the fresh ACH link is kept");
  ok(st.calls.slice(before).filter(c => c.path === "payment_links")[0].params["payment_method_types[0]"] === "card", "the card link is card only");
  before = st.calls.length;
  r = await F.apxInvEnsurePayLinks(env, invRow("101"));
  ok(r.created.length === 0 && st.calls.length === before, "asking again with fresh links creates nothing in Stripe");

  // A partial payment changes the balance: both links are stale.
  d.raw.exec("INSERT INTO invoice_payments (id, invoice_id, amount_cents, match_type) VALUES ('pp1','101',500,'manual_no_txn')");
  p = (await F.apxInvPayload(env, invRow("101"), ON)).payment;
  ok(p.card.enabled && p.card.stale === true && !p.card.url && p.ach.stale === true && !p.ach.url && p.zelle_handle, "after a partial payment the Stripe links are stale: no url, Zelle stays");
  const oldIds = links("101").filter(l => l.active).map(l => l.stripe_link_id);
  before = st.calls.length;
  r = await F.apxInvEnsurePayLinks(env, invRow("101"));
  const after = st.calls.slice(before);
  ok(r.created.length === 2 && r.created.every(c => c.amount_cents === 2000) && links("101").filter(l => l.active).every(l => l.amount_cents === 2000), "regeneration makes both links for the new balance ($20.00)");
  const lastCreate = after.map(c => c.path).lastIndexOf("payment_links");
  const offCalls = after.map((c, i) => ({ c, i })).filter(x => /^payment_links\/plink_/.test(x.c.path));
  ok(offCalls.length === 2 && offCalls.every(x => x.i > lastCreate && x.c.params.active === "false" && oldIds.includes(x.c.path.split("/")[1])), "the two old links are deactivated in Stripe AFTER the new ones exist");
  ok(links("101").filter(l => !l.active).every(l => l.off === 1), "deactivated rows are stamped once Stripe confirmed");
  ok(d.q("SELECT COUNT(*) AS n FROM apex_invoice_pay_links WHERE invoice_id = '101' AND active = 1 GROUP BY kind").every(x => x.n === 1), "never more than one active link per invoice and kind");

  // The lock: held by someone else, nothing is created.
  d.raw.exec("UPDATE invoice_payments SET amount_cents = 600 WHERE id = 'pp1'");
  await F.apxPayLockTake(env, "inv:101");
  before = st.calls.length;
  r = await F.apxInvEnsurePayLinks(env, invRow("101"));
  ok(r.created.length === 0 && r.warnings.length === 1 && st.calls.length === before, "while another request holds the lock nothing is created (database-level guard)");
  ok((await F.apxPayLockTake(env, "inv:101")) === false, "the lock cannot be taken twice");
  await F.apxPayLockRelease(env, "inv:101");
  ok((await F.apxPayLockTake(env, "inv:101")) === true, "and can be taken again once released");
  await F.apxPayLockRelease(env, "inv:101");

  seedInvoice(d, "102", "draft", { token: TOK("b"), cents: 2500 }); seedInvoice(d, "103", "paid", { token: TOK("c"), cents: 2500 }); seedInvoice(d, "104", "voided_mistake", { token: TOK("d"), cents: 2500 });
  seedInvoice(d, "105", "sent", { cents: 2500 });
  before = st.calls.length;
  for (const id of ["102", "103", "104", "105"]) { await F.apxInvEnsurePayLinks(env, invRow(id)); }
  ok(st.calls.length === before && d.q("SELECT COUNT(*) AS n FROM apex_invoice_pay_links WHERE invoice_id IN ('102','103','104','105')")[0].n === 0, "a draft, a paid, a voided or a tokenless invoice never gets a link");

  // Paid: the next view retires every link.
  d.raw.exec("UPDATE invoices SET status = 'paid' WHERE id = '101'");
  await F.apxInvRetireLinks(env, "101", true);
  ok(links("101").every(l => !l.active && l.off === 1), "once the invoice is paid its links are turned off in Stripe");

  // ACH rejected by Stripe: card still ships, the warning carries Stripe's words.
  seedInvoice(d, "106", "sent", { token: TOK("e"), cents: 2500 });
  fakeStripe.failKind = "us_bank_account";
  r = await F.apxInvEnsurePayLinks(env, invRow("106"));
  fakeStripe.failKind = null;
  ok(r.created.length === 1 && r.created[0].kind === "card" && /us_bank_account is invalid/.test(r.warnings.join(" ")), "if Stripe rejects ACH the card link is still made and the exact Stripe error is returned");
}

// ── Phase 3: recording Stripe payments on invoices ─────────────────────────
function seedCharge(d, id, cents, extra) {
  const e = Object.assign({ status: "succeeded", refunded: 0, inv: null, client: "c1", pm: "card", created: "2026-10-03 15:00:00" }, extra || {});
  d.raw.prepare("INSERT INTO stripe_charges (id, amount_cents, amount_refunded_cents, status, created_at, metadata_client_id, metadata_invoice_id, pm_type) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, cents, e.refunded, e.status, e.created, e.client, e.inv, e.pm);
}
{
  const d = world(); const env = { DB: d.DB }; const st = fakeStripe();
  const F = build(fns, ["APX_INV_PAGE"], stubsFor(st));
  const inv = (id) => d.q("SELECT status, paid_at FROM invoices WHERE id = ?", id)[0];
  const pays = (id) => d.q("SELECT amount_cents, match_type, note, approved_by, transaction_id FROM invoice_payments WHERE invoice_id = ? AND undone_at IS NULL ORDER BY rowid", id);

  seedInvoice(d, "201", "sent", { cents: 2500 }); seedCharge(d, "ch_a", 2500, { inv: "201", created: "2026-10-04 02:30:00" });
  let r = await F.applyStripeChargesToApexInvoices(env, null);
  ok(r.applied === 1 && r.paid === 1 && inv("201").status === "paid" && inv("201").paid_at === "2026-10-03", "a succeeded charge for the full balance marks the invoice paid, dated the Eastern day of the charge");
  ok(pays("201").length === 1 && pays("201")[0].amount_cents === 2500 && pays("201")[0].match_type === "manual_no_txn" && pays("201")[0].note === "Stripe card ch_a" && pays("201")[0].approved_by === "stripe-sync" && pays("201")[0].transaction_id === null, "one payment row: manual_no_txn, no transaction, note names the charge");
  r = await F.applyStripeChargesToApexInvoices(env, null);
  ok(r.applied === 0 && pays("201").length === 1 && d.q("SELECT COUNT(*) AS n FROM apex_stripe_applied")[0].n === 1, "a second run applies nothing (the primary key on charge_id is the guard)");
  // Two appliers racing on the same charge: only one insert wins.
  seedInvoice(d, "202", "sent", { cents: 5000 }); seedCharge(d, "ch_b", 5000, { inv: "202", pm: "us_bank_account" });
  await Promise.all([F.applyStripeChargesToApexInvoices(env, "202"), F.applyStripeChargesToApexInvoices(env, null)]);
  ok(pays("202").length === 1 && pays("202")[0].note === "Stripe ACH ch_b" && inv("202").status === "paid", "the cron and a refresh arriving together record the payment once; ACH is labelled ACH");

  seedInvoice(d, "203", "sent", { cents: 99700 }); seedCharge(d, "ch_c", 40000, { inv: "203" });
  await F.applyStripeChargesToApexInvoices(env, null);
  ok(inv("203").status === "sent" && pays("203")[0].amount_cents === 40000, "a partial amount (a stale link) records the payment and leaves the invoice sent");
  seedCharge(d, "ch_c2", 59700, { inv: "203" });
  await F.applyStripeChargesToApexInvoices(env, null);
  ok(inv("203").status === "paid" && pays("203").length === 2, "the remainder then closes it");

  seedInvoice(d, "204", "sent", { cents: 70000 }); seedCharge(d, "ch_d", 69850, { inv: "204" });
  seedInvoice(d, "205", "sent", { cents: 10000 }); seedCharge(d, "ch_e", 9940, { inv: "205" });
  await F.applyStripeChargesToApexInvoices(env, null);
  ok(inv("204").status === "paid" && inv("205").status === "sent", "the match-approve slack rule in SQL: $698.50 on $700 closes (150 <= min(200, 350)); $99.40 on $100 stays open (60 > 50)");

  seedInvoice(d, "206", "sent", { cents: 2500 }); seedCharge(d, "ch_f", 2500, { inv: "206", status: "pending", pm: "us_bank_account" });
  await F.applyStripeChargesToApexInvoices(env, null);
  ok(inv("206").status === "sent" && pays("206").length === 0 && d.q("SELECT COUNT(*) AS n FROM apex_stripe_applied WHERE charge_id = 'ch_f'")[0].n === 0, "a pending charge (ACH not cleared) is NEVER applied");
  ok((await F.apxInvPayload(env, d.q("SELECT i.*, c.name AS client_name, c.package, c.invoice_card_enabled FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = '206'")[0], { invoice_link: false })).payment.processing === true, "it only drives the processing banner, with the switch on or off");
  d.raw.exec("UPDATE stripe_charges SET status = 'succeeded' WHERE id = 'ch_f'");
  await F.applyStripeChargesToApexInvoices(env, null);
  ok(inv("206").status === "paid", "and is applied once it succeeds");

  let alertsBefore = st.alerts.length;
  seedCharge(d, "ch_g", 2500, { inv: "201" });
  await F.applyStripeChargesToApexInvoices(env, null);
  ok(pays("201").length === 2 && inv("201").status === "paid" && st.alerts.length === alertsBefore + 1 && /fatura já paga: INV-9201, \$25\.00/.test(st.alerts[st.alerts.length - 1]), "a payment on an already paid invoice is recorded, the status is untouched, and an alert names the invoice and amount");

  alertsBefore = st.alerts.length;
  d.raw.exec("INSERT INTO clients (id, name, status) VALUES ('c2', 'BRAVO', 'active')");
  seedInvoice(d, "207", "sent", { cents: 2500 }); seedCharge(d, "ch_h", 2500, { inv: "207", client: "c2" });
  seedCharge(d, "ch_i", 2500, { inv: "nope" });
  await F.applyStripeChargesToApexInvoices(env, null); await F.applyStripeChargesToApexInvoices(env, null);
  ok(inv("207").status === "sent" && pays("207").length === 0 && st.alerts.length === alertsBefore + 2, "a charge whose client does not match the invoice, or for an unknown invoice, is NOT applied and alerts once (not on every run)");

  alertsBefore = st.alerts.length;
  d.raw.exec("UPDATE stripe_charges SET amount_refunded_cents = 2500 WHERE id = 'ch_a'");
  await F.applyStripeChargesToApexInvoices(env, null); await F.applyStripeChargesToApexInvoices(env, null);
  ok(inv("201").status === "paid" && pays("201").length === 2 && st.alerts.length === alertsBefore + 1 && /reembolso/.test(st.alerts[st.alerts.length - 1]), "a refund on an applied charge changes NO invoice and alerts once");
}

// ── Phase 3 step 6: one Stripe payment counts ONCE ─────────────────────────
{
  const d = world(); const env = { DB: d.DB }; const st = fakeStripe();
  const F = build(fns.concat(["handleGetContractProgress", "computePlanProgress"]), ["APX_INV_PAGE", "BANK_PAID_WHERE"], stubsFor(st));
  d.raw.exec("INSERT INTO client_package_terms (client_id, base_total, installment_count, installment_amount, recurrence_unit, recurrence_never_ends) VALUES ('c1', 5400, 6, 900, 'month', 0)");
  // History: one installment paid by bank and matched, one alias deposit with no invoice, one older card charge.
  d.raw.exec("INSERT INTO invoices (id, client_id, number, amount_cents, issued_at, due_at, status, is_installment) VALUES ('h1','c1','INV-9301',90000,'2026-07-01','2026-07-01','paid',1)");
  d.raw.exec("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('th1','acct_biz',90000,'2026-07-02','ALPHA BUILDERS LLC'), ('th2','acct_biz',90000,'2026-06-02','ALPHA BUILDERS LLC')");
  d.raw.exec("INSERT INTO invoice_payments (id, invoice_id, transaction_id, amount_cents, match_type) VALUES ('ph1','h1','th1',90000,'auto')");
  d.raw.exec("INSERT INTO client_payer_aliases (id, client_id, payer_key) VALUES ('al1','c1','ALPHA BUILDERS LLC')");
  seedCharge(d, "ch_old", 90000, {});
  d.raw.exec("INSERT INTO invoices (id, client_id, number, amount_cents, issued_at, due_at, status, is_installment) VALUES ('n1','c1','INV-9302',90000,'2026-10-01','2026-10-01','sent',1)");
  const progress = async () => (await F.handleGetContractProgress(req({}), env)).data.clients.find(c => c.client_id === "c1");
  const plan = async () => F.computePlanProgress("c1", d.q("SELECT * FROM client_package_terms WHERE client_id = 'c1'")[0], [], env);
  const b = await progress(), bp = await plan();
  // The client pays the open installment by card through the invoice link.
  seedCharge(d, "ch_new", 90000, { inv: "n1" });
  await F.applyStripeChargesToApexInvoices(env, null);
  const a = await progress(), ap = await plan();
  console.log("      contract progress before: paid " + b.paid_cents + " (invoice " + b.paid_by_invoice_cents + ", bank " + b.paid_by_bank_cents + ", stripe " + b.paid_by_stripe_cents + "), installments made " + bp.made_in_apex);
  console.log("      contract progress after:  paid " + a.paid_cents + " (invoice " + a.paid_by_invoice_cents + ", bank " + a.paid_by_bank_cents + ", stripe " + a.paid_by_stripe_cents + "), installments made " + ap.made_in_apex);
  ok(a.paid_cents - b.paid_cents === 90000, "ONE Stripe payment raises contract progress by exactly the charge amount, once (+" + (a.paid_cents - b.paid_cents) + ")");
  ok(ap.made_in_apex - bp.made_in_apex === 1 && ap.remaining === bp.remaining - 1, "and raises the installment count by exactly one");
  ok(a.paid_by_bank_cents === b.paid_by_bank_cents && a.bank_paid_count === b.bank_paid_count, "the payment row has no bank transaction, so bank money is unchanged");
  ok(a.unmatched_cents === b.unmatched_cents, "and it opens no false 'paid with no match' gap");
  // Same check for a client whose whole history is invoices only (the other side of the max()).
  d.raw.exec("INSERT INTO clients (id, name, status) VALUES ('c9', 'INVOICE ONLY', 'active')");
  d.raw.exec("INSERT INTO client_package_terms (client_id, base_total, installment_count, installment_amount, recurrence_never_ends) VALUES ('c9', 1994, 2, 997, 0)");
  d.raw.exec("INSERT INTO invoices (id, client_id, number, amount_cents, issued_at, due_at, status, is_installment) VALUES ('k1','c9','INV-9311',99700,'2026-09-01','2026-09-01','paid',1), ('k2','c9','INV-9312',99700,'2026-10-01','2026-10-01','sent',1)");
  const p9 = async () => (await F.handleGetContractProgress(req({}), env)).data.clients.find(c => c.client_id === "c9");
  const b9 = await p9();
  seedCharge(d, "ch_k", 99700, { inv: "k2", client: "c9" });
  await F.applyStripeChargesToApexInvoices(env, null);
  const a9 = await p9();
  ok(a9.paid_cents - b9.paid_cents === 99700, "invoice-only client: also exactly once (+" + (a9.paid_cents - b9.paid_cents) + ", paid " + b9.paid_cents + " to " + a9.paid_cents + ")");
}

// ── Phase 3 step 4: the sync writes a plain charge exactly as before ───────
{
  const before = execFileSync("git", ["show", "5e9e4da:worker/index.js"], { cwd: new URL("../", import.meta.url), maxBuffer: 64 * 1024 * 1024 }).toString();
  const charge = { id: "ch_plain", payment_intent: "pi_1", customer: { id: "cus_1", name: "General Tile", email: "gt@x.test" }, balance_transaction: { fee: 4081, net: 135619 },
    billing_details: { name: "G TILE" }, description: "Subscription", amount: 139700, amount_refunded: 0, currency: "usd", status: "succeeded", created: 1790000000, invoice: "in_1", metadata: { client_id: "c1" },
    payment_method_details: { type: "card" } };
  const run = async (src) => {
    const d = makeDb(MIGS); const env = { DB: d.DB };
    const st = { stripeListAll: async (e, path) => path === "charges" ? [charge] : [], stripeTs: (sec) => new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 19),
      apxAfterStripeSync: async () => {}, apxStripeChargeTagStatements: null };
    const names = ["syncStripe"].concat(src ? [] : ["apxStripeChargeTagStatements"]);
    if (!src) { delete st.apxStripeChargeTagStatements; }
    const F = build(names, [], Object.assign({}, baseStubs, st), src);
    await F.syncStripe(env);
    return { writes: d.writes.map(w => [w[0], w[1].map(v => v)]), row: d.q("SELECT * FROM stripe_charges WHERE id = 'ch_plain'")[0], runs: d.q("SELECT ok, charges, payouts, linked, error FROM stripe_sync_runs") };
  };
  const o = await run(before), n = await run(null);
  const strip = (r) => { const c = Object.assign({}, r); delete c.synced_at; return c; };
  ok(JSON.stringify(o.writes) === JSON.stringify(n.writes), "a charge with only client_id metadata: the sync issues byte-for-byte the same statements and values as before this build (" + n.writes.length + " writes)");
  ok(JSON.stringify(strip(o.row)) === JSON.stringify(strip(n.row)) && n.row.metadata_invoice_id === null && n.row.metadata_club_reg_id === null && n.row.pm_type === null && JSON.stringify(o.runs) === JSON.stringify(n.runs), "and leaves the same row and the same sync-run record");
  // A charge stamped for an invoice gets the three new columns and nothing else changes.
  const d = makeDb(MIGS); const env = { DB: d.DB };
  const tagged = Object.assign({}, charge, { id: "ch_tag", metadata: { client_id: "c1", apex_invoice_id: "inv-1", apex_club_registration_id: "" }, payment_method_details: { type: "us_bank_account" } });
  const F = build(["syncStripe", "apxStripeChargeTagStatements"], [], Object.assign({}, baseStubs, { stripeListAll: async (e, path) => path === "charges" ? [tagged] : [], stripeTs: () => "2026-10-01 00:00:00", apxAfterStripeSync: async () => {} }));
  await F.syncStripe(env);
  const row = d.q("SELECT metadata_client_id, metadata_invoice_id, metadata_club_reg_id, pm_type, amount_cents FROM stripe_charges WHERE id = 'ch_tag'")[0];
  ok(row.metadata_invoice_id === "inv-1" && row.metadata_club_reg_id === null && row.pm_type === "us_bank_account" && row.metadata_client_id === "c1" && row.amount_cents === 139700, "a charge stamped for an invoice also stores the invoice id and the payment method type");
}

// The page: strings, contract with the PDF printer, conventions.
{
  const html = readFileSync(new URL("apex-invoice-view.html", root), "utf8");
  const js = html.slice(html.indexOf("<script>"));
  ok(/<meta name="robots" content="noindex, nofollow">/.test(html) && /<meta name="referrer" content="no-referrer">/.test(html), "noindex, nofollow and no-referrer");
  ok(!/\blet\s|\bconst\s|=>/.test(js) && !/localStorage|sessionStorage|IntersectionObserver/.test(js), "var and function() only; no storage, no IntersectionObserver");
  ok(!/[–—]/.test(html), "no em or en dashes");
  ok(!/nicole/i.test(html), "the page never names Nicole");
  ok(!/toISOString|toLocale/.test(js), "no toISOString or toLocale date formatting");
  ok(/data-render-done/.test(js) && /window\.onload = function/.test(js), "sets data-render-done and starts from window.onload");
  ok(!/document\.body\.appendChild/.test(js), "no document.body.appendChild");
  const must = ["Copiar valor: {amt}", "Copy amount: {amt}", "Valor copiado: {amt}. Cole no campo de valor do Zelle no app do seu banco.", "Amount copied: {amt}. Paste it into the amount box in your bank's Zelle screen.",
    "Envie para: {handle}", "Send to: {handle}", "Escreva {num} na mensagem do Zelle.", "Write {num} in the Zelle message.", "Copiar contato do Zelle", "Copy Zelle contact", "Contato copiado.", "Contact copied.",
    "Toque e segure o valor para copiar.", "Press and hold the amount to copy.", "Pagar por transferência ACH", "Pay by ACH bank transfer", "Pode levar até 4 dias úteis para compensar.", "Can take up to 4 business days to clear.",
    "Pagar com cartão", "Pay by card", "Pagamento recebido. Obrigado!", "Payment received. Thank you!", "Pagamento em processamento. Atualizaremos esta fatura quando for confirmado.", "Payment processing. This invoice will update when it is confirmed.",
    "Rascunho: esta fatura ainda não foi enviada.", "Draft: this invoice has not been sent yet.", "Paga integralmente", "Paid in full", "Saldo a pagar agora", "Balance due now", "Em aberto", "Vencida", "Parcialmente paga", "Partially paid",
    "Faturado para", "Billed to", "Data da fatura", "Invoice date", "Vencimento", "Due date", "Valor unitário", "Unit price", "Observações", "Formas de pagamento", "Ways to pay", "Esta fatura não está disponível.", "This invoice is not available.",
    "Baixar fatura (PDF)", "Download your invoice (PDF)", "Não foi possível gerar o PDF agora. Use Imprimir.", "Could not generate the PDF right now. Use Print.", "Fatura gerada por Apex Command Center", "Invoice generated by Apex Command Center",
    "Política de Privacidade", "Privacy Policy", "Termos de Uso"];
  const missing = must.filter(s => html.indexOf(s) < 0);
  ok(missing.length === 0, "every specified PT and EN string is on the page" + (missing.length ? ": MISSING " + JSON.stringify(missing) : ""));
  ok(!/fee|taxa|surcharge/i.test(js), "the page says nothing about fees");
}

// Routes: the new public patterns are anchored and sit before the generic ones.
{
  const fetchSrc = workerSrc.slice(workerSrc.indexOf("async function handleFetch("));
  const iNew = fetchSrc.indexOf("/apex-invoices\\/([a-f0-9]{48})$/"), iGeneric = fetchSrc.indexOf("var pubPdf = path.match(");
  ok(iNew > 0 && iNew < iGeneric, "the Apex invoice routes are declared before the generic document PDF route");
  const generic = /^\/api\/public\/pdf\/(contract|estimate|invoice|receipt|change-order|ack)\/([a-f0-9]{48})$/;
  ok(!generic.test("/api/public/pdf/apex-invoice/" + TOK("a")) && !/^\/api\/public\/invoices\//.test("/api/public/apex-invoices/" + TOK("a")), "the generic gm patterns do not match the new paths");
}
console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
