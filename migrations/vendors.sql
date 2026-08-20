-- Vendors (2026-08-19). See apex-vendors-spec.md in the Nicole Second Brain
-- vault for the full decision record.
--
-- WHY THIS EXISTS: Alice works with third-party vendors (marketing, an
-- accountant, etc.) who service specific Apex clients as a paid add-on.
-- Apex bills the client one combined amount (package + add-on) on the
-- client's regular invoice, then pays the vendor directly (as an ordinary
-- Apex expense, tracked in the existing finance/categorization system --
-- there is deliberately NO vendor_payouts table here).
--
-- MONEY IS INTEGER CENTS EVERYWHERE, matching the house rule established in
-- finance_plaid.sql. Do NOT repeat the `packages` table's REAL-column
-- mistake.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- vendors: one row per third-party vendor Apex works with on a client's
-- behalf (marketing company, accountant, etc).
--
-- vendor_type is free text in Alice's own words ("Contabilidade",
-- "Identidade visual", "Back office Brasil") -- never force a fixed enum,
-- same house rule as category names ("name_pt is authoritative -- do not
-- 'correct' her Portuguese").
--
-- payment_method / payment_identifier is the outbound-matching signal --
-- same shape as client_payer_aliases but for money LEAVING the business to
-- this vendor (e.g. Zelle to a specific phone/email/name).
--
-- info_complete drives the skippable completion-modal prompt: 0 until Alice
-- has filled in contact info + payment details, flips to 1 once she does
-- (or dismisses it -- see the modal's own logic, this flag only tracks
-- "was it filled in", not "was it shown").
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  vendor_type         TEXT,
  contact_name        TEXT,
  contact_email       TEXT,
  contact_phone       TEXT,
  payment_method      TEXT CHECK (payment_method IS NULL OR payment_method IN ('zelle','check','ach','other')),
  payment_identifier  TEXT,
  info_complete       INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vendors_active ON vendors(active);

-- ---------------------------------------------------------------------------
-- client_vendor_terms: many-to-many join of clients <-> vendors, one row per
-- active (or historical) pairing. A client can have zero, one, or several
-- vendor add-ons at once; a vendor can serve many clients.
--
-- vendor_amount_cents is NULLABLE on purpose: NULL means "attached, amount
-- not yet known" (Alice's spreadsheet pending), never a placeholder $0.
-- runRecurringInvoices must skip NULL-amount rows entirely -- see worker
-- comments at the invoice-generation site.
--
-- markup_cents is Apex's cut, added on top of vendor_amount_cents, default 0
-- (passthrough by default, per the locked spec decision).
--
-- client_total_cents is NOT stored -- it is always
-- vendor_amount_cents + markup_cents, computed server-side, same pattern as
-- adjusted_total in handlePutClientPackageTerms never trusting a
-- client-submitted total.
--
-- UNIQUE(client_id, vendor_id, active) prevents two simultaneous active
-- terms for the same pairing. This only works cleanly because `active` is
-- NOT NULL INTEGER DEFAULT 1 -- see [[sqlite-null-defeats-unique]]: SQLite
-- treats NULL as distinct from every other NULL for UNIQUE purposes, so a
-- nullable `active` column would silently let duplicate active rows through.
-- Ended rows flip to active = 0 (never left/set to NULL) so the constraint
-- keeps doing its job.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_vendor_terms (
  id                   TEXT PRIMARY KEY,
  client_id            TEXT NOT NULL REFERENCES clients(id),
  vendor_id            TEXT NOT NULL REFERENCES vendors(id),
  vendor_amount_cents  INTEGER,
  markup_cents         INTEGER NOT NULL DEFAULT 0,
  label                TEXT,
  service_note         TEXT,
  recurrence_unit      TEXT CHECK (recurrence_unit IS NULL OR recurrence_unit IN ('day','week','month','year')),
  recurrence_interval  INTEGER,
  active               INTEGER NOT NULL DEFAULT 1,
  started_at           TEXT,
  ended_at             TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(client_id, vendor_id, active)
);

CREATE INDEX IF NOT EXISTS idx_cvt_client ON client_vendor_terms(client_id, active);
CREATE INDEX IF NOT EXISTS idx_cvt_vendor ON client_vendor_terms(vendor_id, active);

-- ---------------------------------------------------------------------------
-- invoice_line_items: the one real schema gap this feature exposed. Every
-- invoice so far has been "one package, one number" -- invoices.amount_cents
-- never needed to break a charge into parts. Showing the client a line item
-- for the vendor add-on (without ever showing the Apex/vendor split -- the
-- client sees the combined total only) means invoices need at least a
-- minimal line-item concept.
--
-- invoices.amount_cents stays the authoritative total (sum of its line
-- items) -- nothing that reads amount_cents today needs to change. Existing
-- package-only invoices need no migration; they simply never get a second
-- line item.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id                      TEXT PRIMARY KEY,
  invoice_id              TEXT NOT NULL REFERENCES invoices(id),
  kind                    TEXT NOT NULL CHECK (kind IN ('package', 'vendor_addon')),
  label                   TEXT NOT NULL,
  amount_cents            INTEGER NOT NULL,
  client_vendor_terms_id  TEXT REFERENCES client_vendor_terms(id)
);

CREATE INDEX IF NOT EXISTS idx_ili_invoice ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ili_cvt     ON invoice_line_items(client_vendor_terms_id);
