// The public Apex invoice page's Worker side, against the REAL functions on an
// in-memory SQLite (scripts/fixtures/d1-shim.mjs). No network.
//
//   node scripts/test-apex-invoice-public.mjs
import { readFileSync } from "node:fs";
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
const stubs = Object.assign({}, baseStubs, {
  easternDateStr: () => "2026-10-04", APEX_API_BASE: "https://api.test", DEFAULT_ORIGIN: "https://apex.test",
  gmEstPublicRateLimit: async () => null, crypto: globalThis.crypto
});
const fns = ["apxInvSwitches", "apxInvNoIndex", "apxInvByToken", "apxInvEasternDate", "apxInvMoney", "apxInvPayload", "apxInvPayBlock", "handleGetPublicApexInvoice"];

{
  const d = world(); const env = { DB: d.DB };
  const F = build(fns, ["APX_INV_PAGE", "APX_STRIPE_ACH_ENABLED"], stubs);
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
