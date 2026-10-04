// Regression baseline for Apex's OWN invoice money paths and the Apex Club
// P&L, taken before the public invoice page and Club payments build and rerun
// after it. The output of this script must not change.
//
//   node scripts/test-apex-invoice-regression.mjs
//
// It runs the REAL Worker functions (cut from worker/index.js) against the
// real table definitions in an in-memory SQLite. No network, no production
// database. Only existing figures are printed, so additive payload fields a
// later build introduces do not alter the output.
import { makeDb, build, baseStubs, req, hasFn } from "./fixtures/d1-shim.mjs";

const MIGS = ["migrations/apex_club_company.sql", "migrations/apex_invoice_public.sql", "migrations/apex_club_pay.sql"];
const out = (label, v) => console.log(label + " " + JSON.stringify(v));

function seedClient(d, id, name) {
  d.raw.prepare("INSERT INTO clients (id, name, status) VALUES (?, ?, 'active')").run(id, name);
}
function seedInvoice(d, id, client, number, cents, status, extra) {
  const e = extra || {};
  d.raw.prepare("INSERT INTO invoices (id, client_id, number, amount_cents, issued_at, due_at, status, is_installment) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, client, number, cents, e.issued || "2026-09-01", e.due || "2026-09-01", status, e.inst ? 1 : 0);
}
function seedTxn(d, id, cents, date, desc, extra) {
  const e = extra || {};
  d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description, merchant_normalized, category_id, category_source, memo, transfer_status) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, e.account || "acct_biz", cents, date, desc || "", e.merchant || null, e.category || null, e.source || null, e.memo || null, e.transfer || "none");
}
function seedAccounts(d) {
  d.raw.prepare("INSERT INTO accounts (id, purpose) VALUES ('acct_biz', 'business')").run();
  d.raw.prepare("INSERT INTO accounts (id, purpose) VALUES ('acct_personal', 'personal')").run();
}
const invRow = (d, id) => d.q("SELECT status, paid_at FROM invoices WHERE id = ?", id)[0];
const paySum = (d, id) => d.q("SELECT COALESCE(SUM(amount_cents),0) AS s, COUNT(*) AS n FROM invoice_payments WHERE invoice_id = ? AND undone_at IS NULL", id)[0];

// ── 1. Match approve: the paid rule ────────────────────────────────────────
{
  const d = makeDb(MIGS); const env = { DB: d.DB };
  const F = build(["invoicePaidCents", "handlePostFinanceNewMatchApprove", "handlePostFinanceNewMatchUndo"], ["MATCH_BATCH_CAP", "MATCH_FORCE_REVIEW_CENTS"], baseStubs);
  seedAccounts(d); seedClient(d, "c1", "ALPHA BUILDERS");
  const approve = async (inv, txn) => (await F.handlePostFinanceNewMatchApprove(req({ matches: [{ invoice_id: inv, transaction_id: txn, match_type: "manual" }] }), env));

  seedInvoice(d, "i_exact", "c1", "INV-900001", 70000, "sent"); seedTxn(d, "t_exact", 70000, "2026-09-03", "Zelle payment from ALPHA", { merchant: "ALPHA BUILDERS LLC" });
  let r = await approve("i_exact", "t_exact");
  out("approve exact:", { applied: r.data.applied.map(a => [a.fully_paid, a.remaining_cents]), inv: invRow(d, "i_exact"), pay: paySum(d, "i_exact") });

  seedInvoice(d, "i_slack", "c1", "INV-900002", 70000, "sent"); seedTxn(d, "t_slack", 69850, "2026-09-04", "Zelle");
  r = await approve("i_slack", "t_slack");
  out("approve $698.50 on $700 (shortfall 150 <= min(200, 350)):", { applied: r.data.applied.map(a => [a.fully_paid, a.remaining_cents]), inv: invRow(d, "i_slack") });

  seedInvoice(d, "i_slack2", "c1", "INV-900003", 10000, "sent"); seedTxn(d, "t_slack2", 9940, "2026-09-04", "Zelle");
  r = await approve("i_slack2", "t_slack2");
  out("approve $99.40 on $100 (shortfall 60 > min(200, 50)):", { applied: r.data.applied.map(a => [a.fully_paid, a.remaining_cents]), inv: invRow(d, "i_slack2") });

  seedInvoice(d, "i_part", "c1", "INV-900004", 99700, "sent"); seedTxn(d, "t_part1", 40000, "2026-09-05", "Zelle"); seedTxn(d, "t_part2", 59700, "2026-09-09", "Zelle");
  r = await approve("i_part", "t_part1");
  out("approve partial $400 on $997:", { applied: r.data.applied.map(a => [a.fully_paid, a.remaining_cents]), inv: invRow(d, "i_part") });
  r = await approve("i_part", "t_part2");
  out("approve second instalment $597:", { applied: r.data.applied.map(a => [a.fully_paid, a.remaining_cents]), inv: invRow(d, "i_part"), pay: paySum(d, "i_part") });

  seedInvoice(d, "i_over", "c1", "INV-900005", 50000, "sent"); seedTxn(d, "t_over", 52000, "2026-09-06", "Zelle");
  r = await approve("i_over", "t_over");
  out("approve overpay:", { applied: r.data.applied.map(a => [a.fully_paid, a.remaining_cents]), inv: invRow(d, "i_over") });

  seedInvoice(d, "i_draft", "c1", "INV-900006", 50000, "draft"); seedTxn(d, "t_draft", 50000, "2026-09-06", "Zelle");
  r = await approve("i_draft", "t_draft");
  out("approve on a draft is rejected:", { applied: r.data.applied.length, rejected: r.data.rejected.map(x => x.reason), inv: invRow(d, "i_draft") });

  out("payer alias learned:", d.q("SELECT client_id, payer_key, source FROM client_payer_aliases ORDER BY payer_key"));

  // ── 2. Undo ───────────────────────────────────────────────────────────────
  const payId = (inv, txn) => d.q("SELECT id FROM invoice_payments WHERE invoice_id = ? AND transaction_id = ?", inv, txn)[0].id;
  r = await F.handlePostFinanceNewMatchUndo(req({ payment_id: payId("i_part", "t_part2") }), env);
  out("undo one of two instalments reopens:", { res: r.data, inv: invRow(d, "i_part"), pay: paySum(d, "i_part") });
  r = await F.handlePostFinanceNewMatchUndo(req({ payment_id: payId("i_part", "t_part2") }), env);
  out("undo twice is refused:", { status: r.status, error: r.error });
  r = await F.handlePostFinanceNewMatchUndo(req({ payment_id: payId("i_exact", "t_exact") }), env);
  out("undo the only payment reopens:", { res: r.data, inv: invRow(d, "i_exact"), pay: paySum(d, "i_exact") });
  seedInvoice(d, "i_two", "c1", "INV-900007", 50000, "sent"); seedTxn(d, "t_two1", 50000, "2026-09-07", "Zelle"); seedTxn(d, "t_two2", 1000, "2026-09-08", "Zelle");
  d.raw.prepare("INSERT INTO invoice_payments (id, invoice_id, transaction_id, amount_cents, match_type) VALUES ('p_two1','i_two','t_two1',50000,'manual'), ('p_two2','i_two','t_two2',1000,'manual')").run();
  d.raw.prepare("UPDATE invoices SET status = 'paid', paid_at = '2026-09-07' WHERE id = 'i_two'").run();
  r = await F.handlePostFinanceNewMatchUndo(req({ payment_id: "p_two2" }), env);
  out("undo a surplus payment keeps it paid:", { res: r.data, inv: invRow(d, "i_two"), pay: paySum(d, "i_two") });
  d.raw.prepare("UPDATE invoice_payments SET matched_at = datetime('now', '-31 day') WHERE id = 'p_two1'").run();
  r = await F.handlePostFinanceNewMatchUndo(req({ payment_id: "p_two1" }), env);
  out("undo after 30 days is refused:", { status: r.status, error: r.error, inv: invRow(d, "i_two") });
}

// ── 3. Due date derivation, numbering, overdue ─────────────────────────────
{
  const d = makeDb(MIGS); const env = { DB: d.DB };
  const F = build(["formatInvoiceNumber", "allocateInvoiceNumber", "periodKeyFor", "addInterval", "handlePostFinanceNewInvoice", "handleGetFinanceNewInvoices"], [], baseStubs);
  seedClient(d, "c1", "ALPHA BUILDERS");
  d.raw.prepare("INSERT INTO invoice_counter (id, next_number) VALUES (1, 41)").run();
  let r = await F.handlePostFinanceNewInvoice(req({ client_id: "c1", amount_cents: 2500, issued_at: "2020-01-15", line_description: "  Consultoria  " }), env);
  out("new invoice, no due date:", { number: r.data.number, status: r.data.status, row: d.q("SELECT issued_at, due_at, status, source, is_installment, line_description FROM invoices WHERE id = ?", r.data.id)[0] });
  r = await F.handlePostFinanceNewInvoice(req({ client_id: "c1", amount_cents: 150000, issued_at: "2099-01-01", due_at: "2099-01-31", is_installment: true }), env);
  out("new invoice, explicit due date:", { number: r.data.number, row: d.q("SELECT issued_at, due_at, is_installment FROM invoices WHERE id = ?", r.data.id)[0] });
  out("counter after two:", d.q("SELECT next_number FROM invoice_counter WHERE id = 1")[0]);
  r = await F.handlePostFinanceNewInvoice(req({ amount_cents: 100 }), env);
  out("new invoice without a client:", { status: r.status, error: r.error });
  out("addInterval / periodKeyFor:", [F.addInterval("2026-01-31", 1, "month"), F.addInterval("2026-09-01", 2, "week"), F.addInterval("2026-09-01", -14, "day"), F.periodKeyFor("2026-08-15", "month"), F.periodKeyFor("2026-08-15", "year"), F.periodKeyFor("2026-08-15", "week")]);

  seedInvoice(d, "i_od", "c1", "INV-900010", 99700, "sent", { due: "2020-02-01" });
  seedInvoice(d, "i_fu", "c1", "INV-900011", 50000, "sent", { due: "2099-02-01" });
  seedInvoice(d, "i_pd", "c1", "INV-900012", 30000, "paid", { due: "2020-02-01" });
  seedInvoice(d, "i_vm", "c1", "INV-900013", 77700, "voided_mistake", { due: "2020-02-01" });
  d.raw.prepare("INSERT INTO invoice_payments (id, invoice_id, amount_cents, match_type) VALUES ('p_od','i_od',40000,'manual_no_txn')").run();
  r = await F.handleGetFinanceNewInvoices(req({}, "https://x.test/api/finance-new/invoices"), env);
  out("list totals (overdue derived from due_at):", { outstanding: r.data.outstanding_cents, overdue: r.data.overdue_cents, drafts: r.data.draft_count,
    rows: r.data.invoices.map(i => [i.number, i.status, i.paid_cents, i.remaining_cents, i.partially_paid]) });
  r = await F.handleGetFinanceNewInvoices(req({}, "https://x.test/api/finance-new/invoices?include_voided=1"), env);
  out("list with voided:", r.data.invoices.map(i => i.number));
}

// ── 4. Contract progress and installment plan progress ─────────────────────
{
  const d = makeDb(MIGS); const env = { DB: d.DB };
  const F = build(["handleGetContractProgress", "computePlanProgress"], ["BANK_PAID_WHERE"], baseStubs);
  seedAccounts(d);
  seedClient(d, "c1", "ALPHA BUILDERS"); seedClient(d, "c2", "BRAVO TILE"); seedClient(d, "c3", "CHARLIE CAKES");
  d.raw.prepare("INSERT INTO client_package_terms (client_id, base_total, adjusted_total, installment_count, installment_amount, recurrence_unit, recurrence_never_ends, payments_made_before) VALUES ('c1', 6000, 5400, 6, 900, 'month', 0, 1), ('c2', 8382, NULL, 6, 1397, 'month', 0, 0), ('c3', 997, NULL, 2, 498.5, 'week', 0, 0)").run();
  // c1: two paid installment invoices matched to bank, one open, one voided, plus an aliased deposit with no invoice.
  seedInvoice(d, "a1", "c1", "INV-900101", 90000, "paid", { inst: 1 }); seedInvoice(d, "a2", "c1", "INV-900102", 90000, "paid", { inst: 1 });
  seedInvoice(d, "a3", "c1", "INV-900103", 90000, "sent", { inst: 1 }); seedInvoice(d, "a4", "c1", "INV-900104", 90000, "voided_mistake", { inst: 1 });
  seedTxn(d, "ta1", 90000, "2026-07-02", "Zelle payment from ALPHA BUILDERS LLC Conf# aaa111aaa"); seedTxn(d, "ta2", 90000, "2026-08-02", "Zelle payment from ALPHA BUILDERS LLC Conf# aaa222aaa");
  seedTxn(d, "ta3", 90000, "2026-06-02", "ALPHA BUILDERS, LLC DES:PAYMENT"); seedTxn(d, "ta4", 76200, "2026-08-10", "ALPHA BUILDERS LLC filtros", { category: "cat_receita_filtros" });
  seedTxn(d, "ta5", 90000, "2026-08-11", "ALPHA BUILDERS LLC transfer", { transfer: "confirmed" });
  d.raw.prepare("INSERT INTO invoice_payments (id, invoice_id, transaction_id, amount_cents, match_type) VALUES ('pa1','a1','ta1',90000,'auto'), ('pa2','a2','ta2',90000,'manual')").run();
  d.raw.prepare("INSERT INTO client_payer_aliases (id, client_id, payer_key) VALUES ('al1', 'c1', 'ALPHA BUILDERS LLC')").run();
  // c2: card only. Three Stripe charges (one refunded in full, one pending) and the payout lump in the bank.
  d.raw.prepare("INSERT INTO stripe_charges (id, customer_id, amount_cents, amount_refunded_cents, status, metadata_client_id) VALUES ('ch_1','cus_b',139700,0,'succeeded',NULL), ('ch_2',NULL,139700,0,'succeeded','c2'), ('ch_3','cus_b',139700,139700,'succeeded',NULL), ('ch_4','cus_b',139700,0,'pending',NULL)").run();
  d.raw.prepare("INSERT INTO stripe_customer_clients (stripe_customer_id, client_id) VALUES ('cus_b', 'c2')").run();
  seedTxn(d, "tb1", 271000, "2026-08-05", "Transfer STRIPE ; APEX BUSINESS");
  d.raw.prepare("INSERT INTO stripe_payouts (id, amount_cents, status, bank_transaction_id) VALUES ('po_1', 271000, 'paid', 'tb1')").run();
  d.raw.prepare("INSERT INTO client_payer_aliases (id, client_id, payer_key) VALUES ('al2', 'c2', 'TRANSFER STRIPE')").run();
  // c3: an invoice marked paid with no payment row behind it, and a sticky paid claim on an open one.
  seedInvoice(d, "k1", "c3", "INV-900105", 49850, "paid", { inst: 1 }); seedInvoice(d, "k2", "c3", "INV-900106", 49850, "sent", { inst: 1 });
  d.raw.prepare("UPDATE invoices SET claimed_paid_at = '2026-09-02 10:00:00', claimed_paid_by = 'Alice', claimed_paid_note = 'viu no banco' WHERE id = 'k2'").run();
  const r = await F.handleGetContractProgress(req({}), env);
  r.data.clients.forEach(c => out("contract progress " + c.client_name + ":", c));
  for (const id of ["c1", "c2", "c3"]) {
    const row = d.q("SELECT * FROM client_package_terms WHERE client_id = ?", id)[0];
    out("plan progress " + id + ":", await F.computePlanProgress(id, row, [], env));
  }
  const custom = [{ amount: 500 }, { amount: 300 }, { amount: 197 }];
  out("plan progress c3 custom split:", await F.computePlanProgress("c3", Object.assign({}, d.q("SELECT * FROM client_package_terms WHERE client_id = 'c3'")[0], { split_mode: "custom" }), custom, env));
}

// ── 5. Apex Club P&L: an event with no card prices and no payments ─────────
{
  const d = makeDb(MIGS); const env = { DB: d.DB };
  // clubCardTotals is a helper the P&L gained in the Club payments build; it
  // is loaded when it exists so the same script runs before and after.
  const F = build(["apexClubMemoHit", "buildApexClubEventPL", "parseClubPrices"].concat(hasFn("clubCardTotals") ? ["clubCardTotals"] : []), ["APEX_CLUB_PRICE_SINGLE", "APEX_CLUB_PRICE_COUPLE"], baseStubs);
  seedAccounts(d);
  const ev = (id, single, couple) => {
    d.raw.prepare("INSERT INTO apex_club_events (id, name, event_date, window_start, window_end, price_single_cents, price_couple_cents) VALUES (?, ?, '2026-07-20', '2026-07-06', '2026-07-27', ?, ?)").run(id, "Apex Club " + id, single, couple);
    return d.q("SELECT * FROM apex_club_events WHERE id = ?", id)[0];
  };
  const e1 = ev("ev1", 5000, 7500), e2 = ev("ev2", 8000, null);
  seedTxn(d, "s1", 5000, "2026-07-18", "Zelle payment from MARIA SILVA Conf# abc123def");
  seedTxn(d, "s2", 7500, "2026-07-20", "Zelle payment from PRIME GROUP BUILDS LLC Conf# zzz999zzz");
  seedTxn(d, "s3", 6000, "2026-07-20", "Zelle payment from JOAO for \"Apex Club jantar\"; Conf# qqq111qqq");
  seedTxn(d, "s4", 5000, "2026-07-19", "Zelle payment from PEDRO", { memo: "networking" });
  seedTxn(d, "s5", 4200, "2026-07-19", "Zelle payment from NOT CLUB Conf# nnn000nnn");
  seedTxn(d, "s6", -31250, "2026-07-20", "Zelle payment to CHEF", { memo: "Apex club comida" });
  seedTxn(d, "s7", -9900, "2026-07-20", "PUBLIX");
  seedTxn(d, "s8", 5000, "2026-07-21", "Zelle transfer", { transfer: "confirmed" });
  seedTxn(d, "s9", 5000, "2026-07-21", "Zelle personal", { account: "acct_personal" });
  seedTxn(d, "s10", 5000, "2026-08-15", "Zelle payment outside window");
  seedTxn(d, "s11", 5000, "2026-07-22", "Zelle payment already confirmed");
  seedTxn(d, "s12", 5000, "2026-07-22", "Zelle payment dismissed");
  seedTxn(d, "s13", -8000, "2026-07-20", "Books vendor");
  seedTxn(d, "s14", 8000, "2026-07-20", "Zelle payment from ANA Conf# eee888eee");
  d.raw.prepare("INSERT INTO apex_club_event_txns (event_id, transaction_id, side, people) VALUES ('ev1','s11','income',1), ('ev1','s13','expense',0)").run();
  d.raw.prepare("INSERT INTO apex_club_event_dismissed (event_id, transaction_id) VALUES ('ev1','s12')").run();
  const reg = (id, evId, name, phone, state, attended, plus) => d.raw.prepare("INSERT INTO apex_club_registrations (id, event_id, name, phone, rsvp_state, attended, plus_one, created_at) VALUES (?,?,?,?,?,?,?,?)").run(id, evId, name, phone, state, attended, plus, "2026-07-10 10:0" + id.slice(-1) + ":00");
  reg("r1", "ev1", "Maria Silva", "18135550100", "going", 1, 0); reg("r2", "ev1", "Carlos Souza", "18135550101", "going", 1, 1);
  reg("r3", "ev1", "Ana Lima", "18135550102", "going", 0, 0); reg("r4", "ev1", "Beto Reis", "18135550103", "next_time", null, 0);
  reg("r5", "ev1", "Duda Paz", "18135550104", "going", null, 1);
  for (const e of [e1, e2]) {
    const pl = await F.buildApexClubEventPL(env, e);
    out("club " + e.id + " confirmed:", pl.confirmed);
    out("club " + e.id + " projected:", pl.projected);
    out("club " + e.id + " suggestions:", pl.suggestions.map(s => [s.transaction_id, s.side, s.people, s.amount_cents, s.why, s.confidence]));
    out("club " + e.id + " dismissed:", pl.dismissed.map(x => x.transaction_id));
    out("club " + e.id + " rsvp:", pl.rsvp);
    out("club " + e.id + " guests:", pl.registrations.map(g => [g.id, g.name, g.phone, g.rsvp_state, g.attended, g.plus_one]));
  }
  out("parseClubPrices:", [F.parseClubPrices({}), F.parseClubPrices({ price_single_cents: "8000", price_couple_cents: "" }), F.parseClubPrices({ price_single_cents: 0 }), F.parseClubPrices({ price_single_cents: 5000, price_couple_cents: -1 })]);
}
console.log("done");
