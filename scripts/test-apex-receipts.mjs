// Apex invoice receipts: record-payment, the public receipt, issuing a
// receipt for an old payment, and undo -- against the REAL functions on an
// in-memory SQLite (scripts/fixtures/d1-shim.mjs). No network.
//
//   node scripts/test-apex-receipts.mjs
import { makeDb, build, baseStubs, req, hasFn } from "./fixtures/d1-shim.mjs";

const MIGS = ["migrations/apex_invoice_receipts.sql", "migrations/apex_invoice_receipts_cash.sql"];
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

function world() {
  const d = makeDb(MIGS);
  d.raw.exec("INSERT INTO clients (id, name, status, whatsapp) VALUES ('c1', 'ALPHA BUILDERS', 'active', '8135550199')");
  return d;
}
function seedInvoice(d, id, status, cents) {
  d.raw.prepare("INSERT INTO invoices (id, client_id, number, amount_cents, issued_at, due_at, status) VALUES (?,?,?,?,?,?,?)")
    .run(id, "c1", "INV-9" + id, cents == null ? 100000 : cents, "2026-10-01", "2099-01-01", status);
}

const stubs = Object.assign({}, baseStubs, {
  easternDateStr: () => "2026-10-16", APEX_API_BASE: "https://api.test", DEFAULT_ORIGIN: "https://apex.test",
  gmEstPublicRateLimit: async () => null, crypto: globalThis.crypto, REQUEST_CTX: new WeakMap(),
  gmEstNewToken: function () { let bytes = globalThis.crypto.getRandomValues(new Uint8Array(24)); let out = ""; for (let i = 0; i < bytes.length; i++) { out += bytes[i].toString(16).padStart(2, "0"); } return out; },
  docPdfSha256: async () => "a".repeat(64), docPdfRender: async () => ({ notFound: true }), docPdfResponse: () => ({}),
  apxInvEasternDate: function (v) { if (!v) { return null; } const s = String(v); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { return s; } return s.slice(0, 10); },
  logoVersionParam: function (k) { return k ? "?v=" + k : ""; },
  apxUsd: function (cents) { return "$" + ((Number(cents) || 0) / 100).toFixed(2); }
});

const fns = [
  "apxInvMoney", "apxRctAllocateNumber", "apxRctDerivedMethod", "apxRctNoIndex", "apxRctPayload", "apxRctLoad",
  "handlePostApexInvoiceRecordPayment", "handleGetPublicApexReceipt", "handleGetApexInvoicePayments",
  "handlePostApexInvoicePaymentReceiptLink", "handlePostApexInvoicePaymentIssueReceipt", "docPdfAfterFinalApexReceipt",
  "handlePostFinanceNewMatchUndo", "invoicePaidCents"
];
const vars = ["APX_RCT_PAGE", "APX_RECEIPT_METHODS"];

{
  const d = world(); const env = { DB: d.DB };
  const F = build(fns, vars, stubs);
  const user = { role: "alice", display_name: "Alice" };
  const record = (invoiceId, body) => F.handlePostApexInvoiceRecordPayment(invoiceId, req(body), env);

  seedInvoice(d, "001", "sent", 100000);
  let r = await record("001", { amount_cents: 40000, method: "cash", paid_date: "2026-10-16" });
  ok(r.status === 200 && r.data.receipt_number === "RCT-000001" && r.data.invoice_status === "sent", "partial cash payment: issued, invoice stays sent");
  let txnRows = d.q("SELECT * FROM transactions WHERE account_id = 'apex-cash'");
  ok(txnRows.length === 1 && txnRows[0].amount_cents === 40000 && txnRows[0].transfer_status === "rejected", "cash creates exactly one transactions row, positive, never a transfer candidate");
  let payRow = d.q("SELECT * FROM invoice_payments WHERE id = ?", r.data.payment_id)[0];
  ok(payRow.transaction_id === txnRows[0].id && payRow.balance_before_cents === 100000 && payRow.balance_after_cents === 60000, "the payment links the cash transaction and freezes before/after balances");

  r = await record("001", { amount_cents: 60000, method: "zelle", paid_date: "2026-10-16" });
  ok(r.status === 200 && r.data.invoice_status === "paid", "the second (full) payment closes the invoice");
  let zelleTxns = d.q("SELECT COUNT(*) AS n FROM transactions")[0].n;
  ok(zelleTxns === 1, "zelle creates no transactions row (only the earlier cash one exists)");

  r = await record("001", { amount_cents: 1000, method: "cash", paid_date: "2026-10-16" });
  ok(r.status === 400 && /already paid/.test(r.error), "a paid invoice refuses a further payment");
}

{
  const d = world(); const env = { DB: d.DB };
  const F = build(fns, vars, stubs);
  seedInvoice(d, "002", "sent", 50000);

  let r = await F.handlePostApexInvoiceRecordPayment("002", req({ amount_cents: 60000, method: "cash", paid_date: "2026-10-16" }), env);
  ok(r.status === 400 && /balance/.test(r.error), "an amount above the remaining balance is refused");
  ok(d.q("SELECT COUNT(*) AS n FROM transactions")[0].n === 0, "the refused overpayment posted no cash transaction");

  r = await F.handlePostApexInvoiceRecordPayment("002", req({ method: "cash", paid_date: "2026-10-16" }), env);
  ok(r.status === 400, "no amount is refused");

  r = await F.handlePostApexInvoiceRecordPayment("002", req({ amount_cents: 1000, method: "bitcoin", paid_date: "2026-10-16" }), env);
  ok(r.status === 400, "a bad method is refused");

  seedInvoice(d, "003", "draft", 50000); seedInvoice(d, "004", "void", 50000);
  r = await F.handlePostApexInvoiceRecordPayment("003", req({ amount_cents: 1000, method: "cash", paid_date: "2026-10-16" }), env);
  ok(r.status === 400, "a draft invoice refuses a payment");
  r = await F.handlePostApexInvoiceRecordPayment("004", req({ amount_cents: 1000, method: "cash", paid_date: "2026-10-16" }), env);
  ok(r.status === 400, "a void invoice refuses a payment");
}

{
  // Wrong role.
  const d = world(); const env = { DB: d.DB };
  const F = build(fns, vars, Object.assign({}, stubs, { authenticate: async () => ({ role: "guest" }) }));
  seedInvoice(d, "005", "sent", 50000);
  const r = await F.handlePostApexInvoiceRecordPayment("005", req({ amount_cents: 1000, method: "cash", paid_date: "2026-10-16" }), env);
  ok(r.status === 403, "a non-staff role is refused");
}

{
  // Double submit: one payment, one receipt, one cash transaction.
  const d = world(); const env = { DB: d.DB };
  const F = build(fns, vars, stubs);
  seedInvoice(d, "006", "sent", 100000);
  const body = { amount_cents: 40000, method: "cash", paid_date: "2026-10-16" };
  const r1 = await F.handlePostApexInvoiceRecordPayment("006", req(body), env);
  const r2 = await F.handlePostApexInvoiceRecordPayment("006", req(body), env);
  ok(r1.data.payment_id === r2.data.payment_id && r1.data.receipt_number === r2.data.receipt_number, "a double submit makes one payment, one receipt");
  ok(d.q("SELECT COUNT(*) AS n FROM invoice_payments WHERE invoice_id = '006'")[0].n === 1, "only one payment row exists");
  const liveTxns = d.q("SELECT COUNT(*) AS n FROM transactions WHERE account_id = 'apex-cash' AND voided_at IS NULL")[0].n;
  ok(liveTxns === 1, "only one live cash transaction exists; the loser's row was voided, not left dangling");
}

{
  // Receipt numbers unique across invoices.
  const d = world(); const env = { DB: d.DB };
  const F = build(fns, vars, stubs);
  seedInvoice(d, "007", "sent", 100000); seedInvoice(d, "008", "sent", 100000);
  const r1 = await F.handlePostApexInvoiceRecordPayment("007", req({ amount_cents: 1000, method: "cash", paid_date: "2026-10-16" }), env);
  const r2 = await F.handlePostApexInvoiceRecordPayment("008", req({ amount_cents: 1000, method: "zelle", paid_date: "2026-10-16" }), env);
  ok(r1.data.receipt_number !== r2.data.receipt_number, "receipt numbers are unique");
}

{
  // The public receipt, undo, and frozen balances.
  const d = world(); const env = { DB: d.DB };
  const F = build(fns, vars, stubs);
  seedInvoice(d, "009", "sent", 100000);
  const r1 = await F.handlePostApexInvoiceRecordPayment("009", req({ amount_cents: 30000, method: "cash", paid_date: "2026-10-16", reference: "ref1" }), env);
  const token = r1.data.receipt_link.split("t=")[1];
  let pub = await F.handleGetPublicApexReceipt(token, req(), env);
  ok(pub.status === 200 && pub.data.receipt.amount_cents === 30000 && pub.data.receipt.balance_before_cents === 100000 && pub.data.receipt.balance_after_cents === 70000 && pub.data.receipt.voided === false, "the public receipt shows the frozen before/after balance");

  const r2 = await F.handlePostApexInvoiceRecordPayment("009", req({ amount_cents: 20000, method: "zelle", paid_date: "2026-10-16" }), env);
  pub = await F.handleGetPublicApexReceipt(token, req(), env);
  ok(pub.data.receipt.balance_before_cents === 100000 && pub.data.receipt.balance_after_cents === 70000, "frozen balances do not change after a later payment");

  const cashTxnBefore = d.q("SELECT id, voided_at FROM transactions WHERE account_id = 'apex-cash'")[0];
  const undo = await F.handlePostFinanceNewMatchUndo(req({ payment_id: r1.data.payment_id }), env);
  ok(undo.status === 200, "undo succeeds");
  const cashTxnAfter = d.q("SELECT voided_at, voided_reason FROM transactions WHERE id = ?", cashTxnBefore.id)[0];
  ok(cashTxnAfter.voided_at !== null && cashTxnAfter.voided_reason === "payment_undone", "undoing a cash payment voids its cash transaction row (never deletes it)");
  pub = await F.handleGetPublicApexReceipt(token, req(), env);
  ok(pub.status === 200 && pub.data.receipt.voided === true, "the receipt for an undone payment answers voided:true, not 404");
}

{
  // Issuing a receipt for an existing (pre-receipt) payment posts nothing new.
  const d = world(); const env = { DB: d.DB };
  const F = build(fns, vars, stubs);
  seedInvoice(d, "010", "paid", 50000);
  d.raw.exec("INSERT INTO accounts (id, purpose) VALUES ('acct_biz', 'business')");
  d.raw.exec("INSERT INTO transactions (id, account_id, amount_cents, date) VALUES ('t1', 'acct_biz', 50000, '2026-10-10')");
  d.raw.prepare("INSERT INTO invoice_payments (id, invoice_id, transaction_id, amount_cents, match_type) VALUES (?,?,?,?,?)")
    .run("p1", "010", "t1", 50000, "manual_no_txn");
  const txnCountBefore = d.q("SELECT COUNT(*) AS n FROM transactions")[0].n;
  const r = await F.handlePostApexInvoicePaymentIssueReceipt("010", "p1", req({}), env);
  ok(r.status === 200 && r.data.receipt_number, "issuing a receipt for an old bank-matched payment succeeds");
  ok(d.q("SELECT COUNT(*) AS n FROM transactions")[0].n === txnCountBefore, "issuing a receipt for an old payment posts nothing new to transactions");
  const p = d.q("SELECT method FROM invoice_payments WHERE id = 'p1'")[0];
  ok(p.method === "bank_transfer", "the method for a bank-matched old payment is derived (transaction_id set) as bank_transfer, not guessed");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nAll passed.");
process.exit(fail ? 1 : 0);
