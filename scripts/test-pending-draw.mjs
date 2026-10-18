// Owner draws marked as soon as the transfer is PENDING (Build 3): the REAL
// mirrorOwnerDrawAcrossPair cut from worker/index.js, against an in-memory
// SQLite. Proves (a) the mirror only fires under the exact guarded
// condition, never clobbers an existing category, and is idempotent, and
// (b) every ledger total the Worker computes from transfer_status is
// IDENTICAL before and after the mirrored leg is categorized, and stays
// identical again once the pair posts and transfer_status becomes
// 'confirmed' -- because every such query excludes by transfer_status
// alone, never by category_id.
//
//   node scripts/test-pending-draw.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = ["mirrorOwnerDrawAcrossPair"];
const d = makeDb([]);
// The base fixture's `transactions` table lacks the Plaid-era columns this
// build needs (category_source, categorized_at, transfer_pair_id,
// transfer_status) -- rebuild it with the real shape from
// migrations/finance_plaid.sql + migrations/finance_categorization.sql.
d.raw.exec("DROP TABLE transactions");
d.raw.exec(
  "CREATE TABLE transactions (" +
  "id TEXT PRIMARY KEY, account_id TEXT, amount_cents INTEGER, date TEXT, description TEXT, " +
  "merchant_normalized TEXT, category_id TEXT, category_source TEXT, categorized_at TEXT, " +
  "is_transfer INTEGER DEFAULT 0, transfer_pair_id TEXT, transfer_status TEXT DEFAULT 'none', " +
  "pending INTEGER DEFAULT 0, voided_at TEXT)"
);

const stubs = Object.assign({}, baseStubs);
const F = build(FNS, [], stubs);
const env = { DB: d.DB };

function insertTxn(id, opts) {
  d.raw.prepare(
    "INSERT INTO transactions (id, account_id, amount_cents, date, description, merchant_normalized, category_id, category_source, transfer_pair_id, transfer_status) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id, opts.account_id || "acc1", opts.amount_cents, opts.date || "2026-10-10",
    opts.description || "", opts.merchant_normalized || null,
    opts.category_id || null, opts.category_source || null,
    opts.transfer_pair_id || null, opts.transfer_status || "none"
  );
}
function getTxn(id) { return d.raw.prepare("SELECT * FROM transactions WHERE id = ?").get(id); }

// The exact predicate handleGetFinanceNewLedger uses to decide what a
// month's ledger COUNTS (worker/index.js, the "Counted lines" query):
// transfer_status NOT IN ('suspected','confirmed'), nothing about category_id.
function ledgerCountedTotal() {
  return d.raw.prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions " +
    "WHERE voided_at IS NULL AND transfer_status NOT IN ('suspected','confirmed')"
  ).get().total;
}

// ── 1. The core fix: mirror cat_retirada onto the empty leg of a suspected pair ──
{
  insertTxn("in1", { amount_cents: 30000, transfer_pair_id: "pair1", transfer_status: "suspected", category_id: "cat_retirada", category_source: "rule", description: "Zelle payment from APEX BUSINESS LEADERSHIP" });
  insertTxn("out1", { amount_cents: -30000, transfer_pair_id: "pair1", transfer_status: "suspected", category_id: null, description: "Zelle payment to ALICE CORSINO" });
  const applied = await F.mirrorOwnerDrawAcrossPair(env);
  ok(applied === 1, "mirrors exactly one leg for one pending pair");
  const out1 = getTxn("out1");
  ok(out1.category_id === "cat_retirada" && out1.category_source === "rule" && !!out1.categorized_at, "the empty leg is now cat_retirada, source 'rule', with a categorized_at timestamp");
}

// ── 2. Idempotent: running it again changes nothing further ─────────────
{
  const applied2 = await F.mirrorOwnerDrawAcrossPair(env);
  ok(applied2 === 0, "running the mirror again on the same pair is a no-op (already filled)");
}

// ── 3. Never overwrites a leg that already has ANY category ─────────────
{
  insertTxn("in2", { amount_cents: 15000, transfer_pair_id: "pair2", transfer_status: "suspected", category_id: "cat_retirada", category_source: "rule" });
  insertTxn("out2", { amount_cents: -15000, transfer_pair_id: "pair2", transfer_status: "suspected", category_id: "cat_office_supplies", category_source: "manual" });
  const applied = await F.mirrorOwnerDrawAcrossPair(env);
  const out2 = getTxn("out2");
  ok(out2.category_id === "cat_office_supplies" && out2.category_source === "manual", "a leg that already has ANY category (even a different one) is never overwritten");
}

// ── 4. Never fires when the first leg is a DIFFERENT category ───────────
{
  insertTxn("in3", { amount_cents: 8000, transfer_pair_id: "pair3", transfer_status: "suspected", category_id: "cat_office_supplies", category_source: "rule" });
  insertTxn("out3", { amount_cents: -8000, transfer_pair_id: "pair3", transfer_status: "suspected", category_id: null });
  await F.mirrorOwnerDrawAcrossPair(env);
  const out3 = getTxn("out3");
  ok(out3.category_id === null, "a pair whose marked leg is NOT cat_retirada is never touched (not every category mirrors, only the owner-draw rule)");
}

// ── 5. Never fires when the marked leg's source is NOT 'rule' (e.g. manual) ──
{
  insertTxn("in4", { amount_cents: 6000, transfer_pair_id: "pair4", transfer_status: "suspected", category_id: "cat_retirada", category_source: "manual" });
  insertTxn("out4", { amount_cents: -6000, transfer_pair_id: "pair4", transfer_status: "suspected", category_id: null });
  await F.mirrorOwnerDrawAcrossPair(env);
  const out4 = getTxn("out4");
  ok(out4.category_id === null, "a manually-categorized cat_retirada leg does not trigger the mirror (only category_source='rule' does, per spec)");
}

// ── 6. Fires for 'confirmed' pairs too, not only 'suspected' ────────────
{
  insertTxn("in5", { amount_cents: 12000, transfer_pair_id: "pair5", transfer_status: "confirmed", category_id: "cat_retirada", category_source: "rule" });
  insertTxn("out5", { amount_cents: -12000, transfer_pair_id: "pair5", transfer_status: "confirmed", category_id: null });
  await F.mirrorOwnerDrawAcrossPair(env);
  const out5 = getTxn("out5");
  ok(out5.category_id === "cat_retirada" && out5.category_source === "rule", "mirrors on a 'confirmed' pair as well as 'suspected'");
}

// ── 7. Totals are IDENTICAL before and after, and across suspected -> confirmed ──
{
  const d2 = makeDb([]);
  d2.raw.exec("DROP TABLE transactions");
  d2.raw.exec(
    "CREATE TABLE transactions (" +
    "id TEXT PRIMARY KEY, account_id TEXT, amount_cents INTEGER, date TEXT, description TEXT, " +
    "merchant_normalized TEXT, category_id TEXT, category_source TEXT, categorized_at TEXT, " +
    "is_transfer INTEGER DEFAULT 0, transfer_pair_id TEXT, transfer_status TEXT DEFAULT 'none', " +
    "pending INTEGER DEFAULT 0, voided_at TEXT)"
  );
  const env2 = { DB: d2.DB };
  function insert2(id, opts) {
    d2.raw.prepare(
      "INSERT INTO transactions (id, account_id, amount_cents, date, category_id, category_source, transfer_pair_id, transfer_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, "acc1", opts.amount_cents, opts.date || "2026-10-10", opts.category_id || null, opts.category_source || null, opts.transfer_pair_id || null, opts.transfer_status || "none");
  }
  function total2() {
    return d2.raw.prepare("SELECT COALESCE(SUM(amount_cents),0) AS total FROM transactions WHERE voided_at IS NULL AND transfer_status NOT IN ('suspected','confirmed')").get().total;
  }
  // One ordinary expense that IS counted, plus the pending draw pair that is NOT.
  insert2("rent", { amount_cents: -200000, category_id: "cat_rent", category_source: "manual" });
  insert2("income", { amount_cents: 500000, category_id: "cat_receita_clientes", category_source: "rule" });
  insert2("in6", { amount_cents: 30000, transfer_pair_id: "pairA", transfer_status: "suspected", category_id: "cat_retirada", category_source: "rule" });
  insert2("out6", { amount_cents: -30000, transfer_pair_id: "pairA", transfer_status: "suspected", category_id: null });

  const totalBeforeMirror = total2();
  const F2 = build(FNS, [], baseStubs);
  await F2.mirrorOwnerDrawAcrossPair(env2);
  const totalAfterMirror = total2();
  ok(totalBeforeMirror === totalAfterMirror, "ledger total is IDENTICAL before and after the mirror writes category_id (the row was already excluded by transfer_status alone)");
  ok(totalBeforeMirror === 300000, "the counted total is exactly rent + income (-200000 + 500000), the draw pair excluded both times");

  // Now the pair posts: transfer_status flips to 'confirmed' (as
  // handlePostFinanceNewTransferConfirm does), category_id is untouched.
  d2.raw.prepare("UPDATE transactions SET transfer_status = 'confirmed' WHERE transfer_pair_id = 'pairA'").run();
  const totalAfterConfirm = total2();
  ok(totalAfterConfirm === totalBeforeMirror, "ledger total is STILL identical once the pair posts and transfer_status becomes 'confirmed'");

  // Mirror running again after confirm changes nothing (already filled, and
  // excluded either way).
  const appliedAfterConfirm = await F2.mirrorOwnerDrawAcrossPair(env2);
  ok(appliedAfterConfirm === 0 && total2() === totalBeforeMirror, "re-running the mirror after posting is a no-op and the total is unchanged a third time");
}

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
