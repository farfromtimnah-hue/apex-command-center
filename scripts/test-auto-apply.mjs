// Auto-apply known payers: the REAL Worker functions (cut from worker/index.js)
// against the real table definitions in an in-memory SQLite. No network, no
// production database, no test rows anywhere near the live finance numbers.
//
//   node scripts/test-auto-apply.mjs
import { makeDb, build, baseStubs, req } from "./fixtures/d1-shim.mjs";

const MIGS = ["migrations/apex_club_company.sql", "migrations/apex_invoice_public.sql", "migrations/apex_club_pay.sql", "migrations/auto_apply_known_payers.sql"];
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

// Dates relative to today (UTC, the same clock SQLite's date('now') reads),
// built from calendar parts and never from toISOString().
function day(offset) {
  const n = new Date();
  const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset));
  const p = (x) => (x < 10 ? "0" + x : "" + x);
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
}

const FNS = ["isStripeTransferText", "nameFragments", "nameFragmentFrequency", "descriptionHasClientSignal", "invoicePaidCents", "depositAgeDays", "buildMatchCandidates",
  "autoApplyMoney", "autoApplyUsDate", "autoApplyPayerLabel", "autoApplyRow", "autoApplySwitchOn", "selectKnownPayerMatches", "applyKnownPayerMatches", "autoApplyAlertText",
  "handlePostFinanceNewMatchApprove"];
const VARS = ["AUTO_APPLY_APPROVER", "AUTO_APPLY_RUN_CAP", "AUTO_APPLY_CLIENT_CAP", "MATCH_BATCH_CAP", "MATCH_FORCE_REVIEW_CENTS"];

function world(extraStubs) {
  const d = makeDb(MIGS);
  const alerts = [];
  const stubs = Object.assign({}, baseStubs, { notifyNicoleTelegram: async function (env, msg) { alerts.push(msg); } }, extraStubs || {});
  const names = extraStubs && extraStubs.buildMatchCandidates ? FNS.filter((n) => n !== "buildMatchCandidates") : FNS;
  const F = build(names, VARS, stubs);
  d.raw.prepare("INSERT INTO business_settings (id) VALUES (1)").run();
  d.raw.prepare("INSERT INTO accounts (id, purpose) VALUES ('acct_biz', 'business')").run();
  return { d, env: { DB: d.DB }, F, alerts };
}
const client = (w, id, name, status) => w.d.raw.prepare("INSERT INTO clients (id, name, status) VALUES (?, ?, ?)").run(id, name, status || "active");
const alias = (w, cid, key) => w.d.raw.prepare("INSERT INTO client_payer_aliases (id, client_id, payer_key, source, created_by) VALUES (?, ?, ?, 'approved', 'seed')").run("al_" + key, cid, key);
const invoice = (w, id, cid, number, cents, issued, status) => w.d.raw.prepare("INSERT INTO invoices (id, client_id, number, amount_cents, issued_at, due_at, status) VALUES (?,?,?,?,?,?,?)").run(id, cid, number, cents, issued, issued, status || "sent");
const deposit = (w, id, cents, date, payer) => w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description, merchant_normalized, transfer_status) VALUES (?,?,?,?,?,?, 'none')").run(id, "acct_biz", cents, date, "Zelle payment from " + payer + " Conf# abc", "ZELLE PAYMENT FROM " + payer);
const inv = (w, id) => w.d.q("SELECT * FROM invoices WHERE id = ?", id)[0];
const pays = (w, id) => w.d.q("SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY matched_at", id);
const aliasCount = (w) => w.d.q("SELECT COUNT(*) AS n FROM client_payer_aliases")[0].n;
const strip = (row, keys) => { const o = Object.assign({}, row); keys.forEach((k) => delete o[k]); return o; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The Lira shape: the deposit names BRAZILIAN INC, the invoice LIRA OUTDOOR LIVING.
function liraWorld(extraStubs) {
  const w = world(extraStubs);
  client(w, "lira", "LIRA OUTDOOR LIVING"); client(w, "gator", "GATOR OUTDOOR LIVING");
  alias(w, "lira", "ZELLE PAYMENT FROM BRAZILIAN INC"); alias(w, "gator", "ZELLE PAYMENT FROM GATOR OUTDOOR LIVING LLC");
  invoice(w, "i34", "lira", "INV-000034", 229700, day(-16));
  deposit(w, "t_braz", 229700, day(-9), "BRAZILIAN INC");
  return w;
}

// (a) (b) (k): applies, and the rows equal what the approve handler writes.
{
  const auto = liraWorld(); const manual = liraWorld();
  const before = aliasCount(auto);
  const r = await auto.F.applyKnownPayerMatches(auto.env);
  await manual.F.handlePostFinanceNewMatchApprove(req({ matches: [{ invoice_id: "i34", transaction_id: "t_braz", match_type: "auto" }] }), manual.env);
  ok(r.applied.length === 1 && r.applied[0].invoice_number === "INV-000034" && r.applied[0].amount_cents === 229700, "(a) a learned-payer exact deposit inside 14 days is applied");
  const pa = pays(auto, "i34"), pm = pays(manual, "i34");
  ok(pa.length === 1 && pm.length === 1 && same(strip(pa[0], ["id", "matched_at", "match_type", "approved_by"]), strip(pm[0], ["id", "matched_at", "match_type", "approved_by"])) && !!pa[0].matched_at,
    "(a) the invoice_payments row equals the approve handler's, field for field (except match_type, approved_by)");
  ok(pa[0].match_type === "auto" && pa[0].approved_by === "auto (pagador conhecido)", "(a) match_type auto, approved_by 'auto (pagador conhecido)'");
  ok(same(strip(inv(auto, "i34"), ["created_at"]), strip(inv(manual, "i34"), ["created_at"])), "(a) the invoices row equals the approve handler's, field for field");
  ok(inv(auto, "i34").status === "paid" && inv(auto, "i34").paid_at === day(-9), "(b) paid_at is the deposit's bank date, not the run time");
  ok(aliasCount(auto) === before, "(k) the auto path writes no alias row");
  ok(auto.alerts.length === 1 && /LIRA OUTDOOR LIVING, INV-000034, \$2,297\.00, deposit \d\d\/\d\d\/\d{4}, payer BRAZILIAN INC/.test(auto.alerts[0]), "(a) one Telegram alert lists client, invoice, amount, deposit date, payer");

  // (f) a second run applies nothing and alerts nobody
  const r2 = await auto.F.applyKnownPayerMatches(auto.env);
  ok(r2.applied.length === 0 && pays(auto, "i34").length === 1 && auto.alerts.length === 1, "(f) a second run applies nothing and sends nothing");
}

// (c) name fragment only, no alias: recognised, never applied
{
  const w = world(); client(w, "dcj", "DCJ MULTISERVICES LLC");
  invoice(w, "i37", "dcj", "INV-000037", 99700, day(-9)); deposit(w, "t_dcj", 99700, day(-5), "D C J MULTISERVICES LLC");
  const cands = await w.F.buildMatchCandidates(w.env);
  const r = await w.F.applyKnownPayerMatches(w.env);
  ok(cands.length === 1 && cands[0].tier === "auto" && cands[0].via_alias === false, "(c) a name-fragment payer still reads tier auto for the human queue");
  ok(r.applied.length === 0 && inv(w, "i37").status === "sent" && pays(w, "i37").length === 0 && /not a learned payer/.test(r.skipped[0].reason), "(c) a name-fragment-only payer without an alias is NOT applied");
  ok(aliasCount(w) === 0 && w.alerts.length === 0, "(c) and nothing is learned or alerted");
}

// (d) Gator and Lira share OUTDOOR and LIVING
{
  const w = liraWorld();
  w.d.raw.prepare("DELETE FROM transactions WHERE id = 't_braz'").run();
  deposit(w, "t_g1", 150000, day(-3), "GATOR OUTDOOR LIVING LLC"); deposit(w, "t_g2", 111590, day(-12), "GATOR OUTDOOR LIVING LLC");
  const cands = await w.F.buildMatchCandidates(w.env);
  const r = await w.F.applyKnownPayerMatches(w.env);
  ok(cands.length === 0, "(d) Gator's deposits are no longer suggested against Lira's invoice (shared words are not a signal)");
  ok(r.applied.length === 0 && inv(w, "i34").status === "sent", "(d) and are not applied");
  // a word only ONE client carries is still a signal
  const w2 = world(); client(w2, "a", "ALPHA BUILDERS"); client(w2, "b", "BETA BUILDERS");
  invoice(w2, "ia", "a", "INV-1", 50000, day(-5)); deposit(w2, "ta", 50000, day(-2), "ALPHA HOLDINGS");
  const c2 = await w2.F.buildMatchCandidates(w2.env);
  ok(c2.length === 1 && c2[0].tier === "auto" && c2[0].signal === true, "(d) a word that only one client carries is still a name signal");
}

// (e) everything that must NOT apply
{
  const mk = (fn) => { const w = world(); client(w, "c", "ZETA POOLS"); alias(w, "c", "ZELLE PAYMENT FROM PAYER ONE"); fn(w); return w; };
  const none = async (w, label, ids) => {
    const r = await w.F.applyKnownPayerMatches(w.env);
    ok(r.applied.length === 0 && ids.every((i) => inv(w, i).status === "sent") && w.d.q("SELECT COUNT(*) AS n FROM invoice_payments WHERE approved_by = 'auto (pagador conhecido)' AND undone_at IS NULL")[0].n === 0, "(e) " + label + " is NOT applied");
  };
  await none(mk((w) => { invoice(w, "i1", "c", "INV-1", 150000, day(-6)); invoice(w, "i2", "c", "INV-2", 150000, day(-5)); deposit(w, "t", 150000, day(-2), "PAYER ONE"); }), "an ambiguous deposit (two open invoices of the same amount)", ["i1", "i2"]);
  await none(mk((w) => { invoice(w, "i1", "c", "INV-1", 99700, day(-6)); deposit(w, "t", 40000, day(-2), "PAYER ONE"); }), "a partial payment", ["i1"]);
  await none(mk((w) => { invoice(w, "i1", "c", "INV-1", 99700, day(-6)); deposit(w, "t", 99000, day(-2), "PAYER ONE"); }), "an inexact amount", ["i1"]);
  await none(mk((w) => { invoice(w, "i1", "c", "INV-1", 600000, day(-6)); deposit(w, "t", 600000, day(-2), "PAYER ONE"); }), "an amount above $5,000", ["i1"]);
  await none(mk((w) => { invoice(w, "i1", "c", "INV-1", 99700, day(-25)); deposit(w, "t", 99700, day(-5), "PAYER ONE"); }), "a deposit older than 14 days from the invoice", ["i1"]);
  await none(mk((w) => { invoice(w, "i1", "c", "INV-1", 99700, day(-6)); invoice(w, "i0", "c", "INV-0", 99700, day(-40), "paid"); deposit(w, "t", 99700, day(-2), "PAYER ONE");
    w.d.raw.prepare("INSERT INTO invoice_payments (id, invoice_id, transaction_id, amount_cents, match_type, approved_by) VALUES ('p0','i0','t',99700,'manual','Alice')").run(); }), "a deposit already tied to a live payment", ["i1"]);
  await none(mk((w) => { w.d.raw.prepare("UPDATE clients SET status = 'closed' WHERE id = 'c'").run(); invoice(w, "i1", "c", "INV-1", 99700, day(-6)); deposit(w, "t", 99700, day(-2), "PAYER ONE"); }), "a closed client's invoice", ["i1"]);
  await none(mk((w) => { w.d.raw.prepare("UPDATE clients SET archived = 1 WHERE id = 'c'").run(); invoice(w, "i1", "c", "INV-1", 99700, day(-6)); deposit(w, "t", 99700, day(-2), "PAYER ONE"); }), "an archived client's invoice", ["i1"]);
  await none(mk((w) => { invoice(w, "i1", "c", "INV-1", 99700, day(-6)); deposit(w, "t", 99700, day(-2), "PAYER ONE");
    w.d.raw.prepare("INSERT INTO invoice_payments (id, invoice_id, transaction_id, amount_cents, match_type, approved_by, undone_at, undone_by) VALUES ('p0','i1','t',99700,'auto','auto (pagador conhecido)', datetime('now'), 'Alice')").run(); }), "a deposit whose match a person undid", ["i1"]);
  // an alias of ANOTHER client is not a known payer of this one
  const w = world(); client(w, "c", "ZETA POOLS"); client(w, "o", "OMEGA ROOFING"); alias(w, "o", "ZELLE PAYMENT FROM ZETA HOLDINGS");
  invoice(w, "i1", "c", "INV-1", 99700, day(-6)); deposit(w, "t", 99700, day(-2), "ZETA HOLDINGS");
  await none(w, "a payer learned for a DIFFERENT client (name fragment matches this one)", ["i1"]);
}

// (g) two racing runs apply a deposit once
{
  const w = liraWorld();
  const both = await Promise.all([w.F.applyKnownPayerMatches(w.env), w.F.applyKnownPayerMatches(w.env)]);
  ok(both[0].applied.length + both[1].applied.length === 1 && pays(w, "i34").length === 1 && inv(w, "i34").status === "paid", "(g) two racing runs apply the deposit exactly once");
  ok(w.alerts.length === 1, "(g) and alert once");
}

// (h) more than 5 for one client: none, and an alert
{
  const w = world(); client(w, "c", "ZETA POOLS"); alias(w, "c", "ZELLE PAYMENT FROM PAYER ONE"); client(w, "k", "KAPPA DECKS"); alias(w, "k", "ZELLE PAYMENT FROM PAYER TWO");
  for (let i = 0; i < 6; i++) { invoice(w, "i" + i, "c", "INV-" + i, 100000 + i * 10000, day(-6)); deposit(w, "t" + i, 100000 + i * 10000, day(-2), "PAYER ONE"); }
  invoice(w, "ik", "k", "INV-K", 33300, day(-6)); deposit(w, "tk", 33300, day(-2), "PAYER TWO");
  const r = await w.F.applyKnownPayerMatches(w.env);
  ok(r.applied.length === 1 && r.applied[0].invoice_number === "INV-K" && [0, 1, 2, 3, 4, 5].every((i) => inv(w, "i" + i).status === "sent"), "(h) 6 matches for one client apply NONE for that client (another client still applies)");
  ok(w.alerts.filter((a) => /HELD: 6 matches for ZETA POOLS/.test(a) && /PAYER ONE/.test(a)).length === 1, "(h) one alert names the client and payer");
}

// (i) at most 20 per run, oldest deposit first
{
  const w = world();
  for (let i = 0; i < 25; i++) {
    const n = (i < 10 ? "0" : "") + i;
    client(w, "c" + n, "CLIENT" + n + "X UNIQ" + n + "Z"); alias(w, "c" + n, "ZELLE PAYMENT FROM PAYER " + n);
    invoice(w, "i" + n, "c" + n, "INV-9" + n, 100000 + i * 10000, day(-13));
    deposit(w, "t" + n, 100000 + i * 10000, day(-12 + Math.floor(i / 3)), "PAYER " + n);
  }
  const r = await w.F.applyKnownPayerMatches(w.env);
  const paid = w.d.q("SELECT id FROM invoices WHERE status = 'paid' ORDER BY id").map((x) => x.id);
  ok(r.applied.length === 20 && paid.length === 20, "(i) a run applies at most 20");
  ok(paid[0] === "i00" && paid[19] === "i19" && r.skipped.filter((s) => /run cap/.test(s.reason)).length === 5, "(i) the 20 oldest deposits, the other 5 wait");
  const r2 = await w.F.applyKnownPayerMatches(w.env);
  ok(r2.applied.length === 5, "(i) the next run applies the 5 that waited");
}

// (j) the switch at 0
{
  const w = liraWorld(); w.d.raw.prepare("UPDATE business_settings SET auto_apply_known_payers = 0 WHERE id = 1").run();
  const r = await w.F.applyKnownPayerMatches(w.env);
  ok(r.enabled === false && r.applied.length === 0 && inv(w, "i34").status === "sent" && pays(w, "i34").length === 0 && w.alerts.length === 0, "(j) with the switch at 0 nothing is applied");
  const dry = await w.F.applyKnownPayerMatches(w.env, { dryRun: true });
  ok(dry.enabled === false && dry.would_apply.length === 1 && pays(w, "i34").length === 0, "(j) the dry run still reports, and writes nothing");
  const w2 = liraWorld(); const d2 = await w2.F.applyKnownPayerMatches(w2.env, { dryRun: true });
  ok(d2.would_apply.length === 1 && d2.would_apply[0].invoice_number === "INV-000034" && pays(w2, "i34").length === 0 && inv(w2, "i34").status === "sent" && w2.alerts.length === 0 && w2.d.writes.length === 0, "(j) a dry run with the switch on writes nothing and alerts nobody");
}

// (l) a $2.00 shortfall settles exactly as the approve handler does. The
// selection only ever passes exact amounts, so the candidate is handed in
// directly to reach the settle rule with a short payment.
{
  const shape = (cents, total) => {
    const cand = async function (env) {
      const i = (await env.DB.prepare("SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = 'i1'").first());
      const t = await env.DB.prepare("SELECT * FROM transactions WHERE id = 't'").first();
      return [{ transaction: t, invoice: i, tier: "auto", exact: true, signal: true, days: 4, force_review: false, via_alias: true, partial: false }];
    };
    const mkw = (stub) => { const w = world(stub); client(w, "c", "ZETA POOLS"); alias(w, "c", "ZELLE PAYMENT FROM PAYER ONE"); invoice(w, "i1", "c", "INV-1", total, day(-6)); deposit(w, "t", cents, day(-2), "PAYER ONE"); return w; };
    return { auto: mkw({ buildMatchCandidates: cand }), manual: mkw() };
  };
  for (const [cents, total, label] of [[69850, 70000, "$698.50 on $700.00 (short $1.50) settles"], [69800, 70000, "$698.00 on $700.00 (short exactly $2.00) settles"], [69790, 70000, "$697.90 on $700.00 (short $2.10) stays open"], [9940, 10000, "$99.40 on $100.00 (short $0.60, over 0.5%) stays open"]]) {
    const s = shape(cents, total);
    await s.auto.F.applyKnownPayerMatches(s.auto.env);
    await s.manual.F.handlePostFinanceNewMatchApprove(req({ matches: [{ invoice_id: "i1", transaction_id: "t", match_type: "auto" }] }), s.manual.env);
    ok(same(strip(inv(s.auto, "i1"), ["created_at"]), strip(inv(s.manual, "i1"), ["created_at"])), "(l) " + label + ", identical to the approve handler (" + inv(s.auto, "i1").status + ")");
  }
}

// (m) a Stripe payout lump is never matched by the bank name (2026-10-04).
// The deposit reads "Transfer STRIPE ; APEX BUSINESS"; who paid is known only
// from the Stripe API, never from this line.
{
  const lump = (w, id, cents, date) => w.d.raw.prepare("INSERT INTO transactions (id, account_id, amount_cents, date, description, merchant_normalized, transfer_status) VALUES (?,?,?,?,?,?, 'none')").run(id, "acct_biz", cents, date, "Transfer STRIPE ; APEX BUSINESS", "TRANSFER STRIPE APEX BUSINESS");
  const tile = () => { const w = world(); client(w, "gts", "GENERAL TILE SERVICES"); alias(w, "gts", "TRANSFER STRIPE APEX BUSINESS"); alias(w, "gts", "ZELLE PAYMENT FROM GENERAL TILE SERVICES LLC"); invoice(w, "ig", "gts", "INV-000050", 99700, day(-6)); return w; };

  // exact amount, aliased client, payout already paired in stripe_payouts
  let w = tile(); lump(w, "t_po", 99700, day(-2));
  w.d.raw.prepare("INSERT INTO stripe_payouts (id, amount_cents, arrival_date, status, created_at, bank_transaction_id) VALUES ('po_1', 99700, ?, 'paid', 0, 't_po')").run(day(-2));
  let cands = await w.F.buildMatchCandidates(w.env);
  let r = await w.F.applyKnownPayerMatches(w.env);
  ok(cands.length === 0, "(m) a paired Stripe payout equal to an aliased client's open invoice produces no candidate at any tier");
  ok(r.applied.length === 0 && r.skipped.length === 0 && inv(w, "ig").status === "sent" && pays(w, "ig").length === 0 && w.alerts.length === 0, "(m) and nothing is applied or alerted");

  // not yet paired in stripe_payouts: still excluded, by its name
  w = tile(); lump(w, "t_po2", 99700, day(-2));
  cands = await w.F.buildMatchCandidates(w.env);
  r = await w.F.applyKnownPayerMatches(w.env);
  ok(w.d.q("SELECT COUNT(*) AS n FROM stripe_payouts")[0].n === 0 && cands.length === 0 && r.applied.length === 0 && inv(w, "ig").status === "sent", "(m) a payout NOT yet linked in stripe_payouts is still excluded by its name");

  // a paired payout whose bank text does not say Stripe is excluded by its id
  w = tile(); deposit(w, "t_po3", 99700, day(-2), "GENERAL TILE SERVICES LLC");
  w.d.raw.prepare("INSERT INTO stripe_payouts (id, amount_cents, arrival_date, status, created_at, bank_transaction_id) VALUES ('po_3', 99700, ?, 'paid', 0, 't_po3')").run(day(-2));
  cands = await w.F.buildMatchCandidates(w.env);
  ok(cands.length === 0, "(m) a transaction id present in stripe_payouts is excluded whatever its text says");

  // partial-by-payer and amount-only tiers do not fire for a lump either
  w = tile(); lump(w, "t_po4", 40000, day(-2)); lump(w, "t_po5", 99000, day(-2));
  cands = await w.F.buildMatchCandidates(w.env);
  ok(cands.length === 0, "(m) no partial, suggest or ambiguous candidate from a Stripe lump");

  // the same client's Zelle deposit from a learned payer still auto-applies
  w = tile(); lump(w, "t_po6", 99700, day(-3)); deposit(w, "t_z", 99700, day(-2), "GENERAL TILE SERVICES LLC");
  r = await w.F.applyKnownPayerMatches(w.env);
  ok(r.applied.length === 1 && r.applied[0].transaction_id === "t_z" && inv(w, "ig").status === "paid" && pays(w, "ig").length === 1 && pays(w, "ig")[0].transaction_id === "t_z", "(m) a Zelle deposit from a learned payer still auto-applies, next to a lump of the same amount");

  // approving a lump by hand never teaches the Stripe name as a payer
  w = world(); client(w, "gts", "GENERAL TILE SERVICES"); invoice(w, "ig", "gts", "INV-000050", 99700, day(-6)); lump(w, "t_po7", 99700, day(-2));
  await w.F.handlePostFinanceNewMatchApprove(req({ matches: [{ invoice_id: "ig", transaction_id: "t_po7", match_type: "manual" }] }), w.env);
  ok(pays(w, "ig").length === 1 && inv(w, "ig").status === "paid" && aliasCount(w) === 0, "(m) the approve path still applies a hand-picked match but saves NO alias for a Stripe transfer key");
  const wz = world(); client(wz, "gts", "GENERAL TILE SERVICES"); invoice(wz, "ig", "gts", "INV-000050", 99700, day(-6)); deposit(wz, "t_z2", 99700, day(-2), "SOMEBODY ELSE INC");
  await wz.F.handlePostFinanceNewMatchApprove(req({ matches: [{ invoice_id: "ig", transaction_id: "t_z2", match_type: "manual" }] }), wz.env);
  ok(aliasCount(wz) === 1 && wz.d.q("SELECT payer_key FROM client_payer_aliases")[0].payer_key === "ZELLE PAYMENT FROM SOMEBODY ELSE INC", "(m) and still learns an ordinary payer exactly as before");
}

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
