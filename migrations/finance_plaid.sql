-- Plaid-backed budgeting tables (2026-08-05).
--
-- WHY THIS EXISTS, AND WHY IT IS NOT A REUSE OF finance.sql:
-- The existing finance page (bank_transactions, subscriptions) is a Zoho
-- Books mirror built for reconciliation -- it asks the operator to confirm a
-- category on every row before it will show a number. It works correctly and
-- sits completely unused for exactly that reason. This build replaces the
-- INPUT model, not the data: the dashboard must show balances, money in,
-- money out and net with ZERO operator input, straight off the raw Plaid
-- feed, before anything is categorized.
--
-- Zoho code and finance.html stay live and untouched. These are parallel
-- tables so the two systems can run side by side while the new page is
-- proven against real accounts.
--
-- MONEY IS INTEGER CENTS EVERYWHERE IN THIS FILE.
-- finance.sql uses REAL (bank_transactions.amount, subscriptions.monthly_cost).
-- Do NOT copy that here. Transfer detection pairs debits to credits by EXACT
-- amount equality; binary floating point makes 1500.00 == 1500.00 a coin
-- flip, which would silently break the one mechanism protecting the headline
-- in/out numbers from double-counting. Integer cents make that comparison
-- exact. Convert at the edges (Plaid sends dollars as a float) and never in
-- between.

-- ---------------------------------------------------------------------------
-- plaid_items: one row per Plaid Item (one bank login).
-- access_token is a live credential -- never returned to the client, never
-- logged, never in the repo. It is read only inside the Worker.
-- Both Apex accounts are at BofA and may arrive under ONE Item via a shared
-- login, which is why purpose lives on `accounts`, not here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plaid_items (
  id                 TEXT PRIMARY KEY,
  plaid_item_id      TEXT UNIQUE,
  access_token       TEXT NOT NULL,
  institution        TEXT,
  status             TEXT NOT NULL DEFAULT 'good' CHECK (status IN ('good','reauth_required','revoked')),
  consent_expires_at TEXT,
  cursor             TEXT,
  last_synced_at     TEXT,
  last_webhook_at    TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- accounts: one row per bank account, tagged business or personal.
--
-- purpose is set by WHICH BUTTON Alice clicked ("Conectar conta comercial" vs
-- "Conectar conta pessoal") and carried through the whole link flow. It is
-- NEVER inferred from the bank's own account name -- a checking account named
-- "ADV PLUS BANKING" says nothing about whether Apex treats it as business,
-- and a silent mis-tag puts household spending in the business column where
-- Alice would read it as a real cost. Mis-tags are corrected in the UI
-- without unlinking.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id               TEXT PRIMARY KEY,
  plaid_item_id    TEXT,
  plaid_account_id TEXT UNIQUE,
  institution      TEXT,
  name             TEXT,
  mask             TEXT,
  subtype          TEXT,
  purpose          TEXT NOT NULL CHECK (purpose IN ('business','personal')),
  balance_cents    INTEGER,
  available_cents  INTEGER,
  last_synced_at   TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_acct_purpose ON accounts(purpose, status);
CREATE INDEX IF NOT EXISTS idx_acct_item    ON accounts(plaid_item_id);

-- ---------------------------------------------------------------------------
-- transactions: the raw Plaid feed. Usable with zero categorization.
--
-- SIGN CONVENTION: amount_cents is NEGATIVE for money leaving the account and
-- POSITIVE for money arriving. This is the INVERSE of Plaid's own convention
-- (Plaid sends positive for outflow). Flipped once, at ingest, so that every
-- query downstream reads naturally and no reader has to remember a trick.
--
-- DEDUPLICATION: Plaid transaction IDs CHANGE when a transaction settles from
-- pending to posted. Matching on plaid_transaction_id alone therefore
-- double-inserts every settling transaction. pending_plaid_transaction_id
-- holds the id the row had while pending, checked first; a composite of
-- (date within +/-3 days, exact amount_cents, merchant_normalized) is the
-- fallback for feeds that drop the link.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id                           TEXT PRIMARY KEY,
  account_id                   TEXT NOT NULL,
  plaid_transaction_id         TEXT UNIQUE,
  pending_plaid_transaction_id TEXT,
  amount_cents                 INTEGER NOT NULL,
  date                         TEXT NOT NULL,
  posted_date                  TEXT,
  description                  TEXT,
  merchant_normalized          TEXT,
  category_id                  TEXT,
  is_transfer                  INTEGER NOT NULL DEFAULT 0,
  transfer_pair_id             TEXT,
  transfer_status              TEXT NOT NULL DEFAULT 'none' CHECK (transfer_status IN ('none','suspected','confirmed','rejected')),
  pending                      INTEGER NOT NULL DEFAULT 0,
  raw_json                     TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_txn_account_date  ON transactions(account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_txn_date          ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_txn_pending_id    ON transactions(pending_plaid_transaction_id);
CREATE INDEX IF NOT EXISTS idx_txn_transfer      ON transactions(transfer_status, is_transfer);
CREATE INDEX IF NOT EXISTS idx_txn_amount_date   ON transactions(amount_cents, date);

-- ---------------------------------------------------------------------------
-- invoices: migrated out of Zoho Books, then owned here.
--
-- 'voided_mistake' is NOT the same as 'void'. Zoho 'void' is a real business
-- void that Alice performed deliberately (INV-000006). 'voided_mistake' is
-- the soft delete for a duplicate created while fumbling the send flow --
-- the row stays in D1 forever, drops out of the normal UI, outstanding
-- totals, aging and matching candidates, and its number is never reused.
-- Mirrors the house pattern from the JM Luxury client merge, which set
-- status 'merged' rather than deleting the losing record.
--
-- There is NO 'overdue' status on purpose. Overdue is derived from due_at at
-- render time. Zoho carries it as a status, which is why the migration maps
-- both 'sent' and 'overdue' onto 'sent' -- Apex never sent email through
-- Zoho, so both simply mean "issued and unpaid".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  client_id       TEXT,
  number          TEXT NOT NULL UNIQUE,
  amount_cents    INTEGER,
  issued_at       TEXT,
  due_at          TEXT,
  status          TEXT NOT NULL CHECK (status IN ('draft','sent','paid','void','voided_mistake')),
  sent_at         TEXT,
  paid_at         TEXT,
  voided_reason   TEXT,
  voided_by       TEXT,
  voided_at       TEXT,
  recurrence_id   TEXT,
  period_key      TEXT,
  zoho_invoice_id TEXT,
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','zoho_migrated','recurrence')),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inv_status_due ON invoices(status, due_at);
CREATE INDEX IF NOT EXISTS idx_inv_client     ON invoices(client_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_zoho ON invoices(zoho_invoice_id) WHERE zoho_invoice_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- invoice_counter: single-row allocator for INV-###### numbers.
--
-- Seeded to 17, not 16. INV-000016 was a Zoho-auto-generated duplicate of
-- Alice's manual INV-000015 (same client, same $1,500, one day apart). It is
-- being silently retired and is NOT migrated -- but its number is burned.
-- Reissuing 16 would put two different documents under one number in a
-- client's inbox.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_counter (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  next_number INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- invoice_recurrence: schedules that generate DRAFTS, never sends.
--
-- last_satisfied_period is the duplicate guard. When Alice manually invoices
-- a client whose recurrence is due around now, the collision modal stamps the
-- period here so the 4-hourly cron does not generate a second invoice on top
-- of the one she just made by hand. This is the direct fix for the Gator
-- INV-000015/INV-000016 collision.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_recurrence (
  id                    TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  amount_cents          INTEGER,
  interval_n            INTEGER NOT NULL DEFAULT 1,
  interval_unit         TEXT NOT NULL DEFAULT 'month' CHECK (interval_unit IN ('day','week','month','year')),
  next_due_at           TEXT NOT NULL,
  end_after_n           INTEGER,
  generated_count       INTEGER NOT NULL DEFAULT 0,
  last_satisfied_period TEXT,
  active                INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rec_active_due ON invoice_recurrence(active, next_due_at);
CREATE INDEX IF NOT EXISTS idx_rec_client     ON invoice_recurrence(client_id, active);

-- ---------------------------------------------------------------------------
-- invoice_payments: the audit trail for deposit-to-invoice matching.
--
-- A wrong match marks an invoice paid; it does NOT move money. That is what
-- makes a bulk "approve all" acceptable at all. The safety rails live here:
-- approved_by and matched_at record who and when, and undone_at makes the
-- 30-day undo a soft reversal rather than a delete, so an undo can itself be
-- reviewed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_payments (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  amount_cents   INTEGER,
  matched_at     TEXT NOT NULL DEFAULT (datetime('now')),
  match_type     TEXT NOT NULL DEFAULT 'manual' CHECK (match_type IN ('auto','suggested','manual')),
  approved_by    TEXT,
  undone_at      TEXT,
  undone_by      TEXT
);

CREATE INDEX IF NOT EXISTS idx_pay_invoice ON invoice_payments(invoice_id, undone_at);
CREATE INDEX IF NOT EXISTS idx_pay_txn     ON invoice_payments(transaction_id, undone_at);

-- ---------------------------------------------------------------------------
-- categories / categorization_rules: OPTIONAL enrichment, never a gate.
--
-- Nothing on the dashboard waits on these. An uncategorized transaction still
-- counts toward money in, money out and net. These exist so that categories
-- can accrue in the background over time from rules, not so that a screen can
-- demand Alice fill them in first. If any view ever blocks on category_id
-- being non-null, that view has reintroduced the chore that killed the last
-- tool.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id      TEXT PRIMARY KEY,
  name_pt TEXT NOT NULL,
  name_en TEXT,
  kind    TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('income','expense','transfer'))
);

CREATE TABLE IF NOT EXISTS categorization_rules (
  id          TEXT PRIMARY KEY,
  pattern     TEXT NOT NULL,
  category_id TEXT,
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_catrule_pattern ON categorization_rules(pattern);
