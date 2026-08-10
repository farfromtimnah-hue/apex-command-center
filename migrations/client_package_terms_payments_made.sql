-- Payment-plan progress + first due date, and the installment tag on invoices.
-- Run against the live D1 database: apex-command-center
--
-- Context (2026-08-10): Apex has 17 active clients, nearly all of whom signed
-- their package BEFORE this system existed, so their installment history lives
-- nowhere. payments_made_before is Alice's hand-entered count of what a client
-- had already paid on the day the plan was recorded. Everything paid from that
-- point on is counted live from the invoices table instead.
--
-- The split matters: two numbers that can each be checked, rather than one
-- opaque total. When a remaining balance looks wrong, Alice can see WHICH
-- half is wrong.

ALTER TABLE client_package_terms ADD COLUMN payments_made_before INTEGER NOT NULL DEFAULT 0;

-- First payment due date. This is the field that was missing to make a payment
-- plan actually drive invoicing: invoice_recurrence has always had next_due_at,
-- interval_n, interval_unit and end_after_n, and a 4-hourly cron that generates
-- drafts from them, but nothing could create a recurrence row without a start
-- date. Zero recurrence rows existed before this migration.
ALTER TABLE client_package_terms ADD COLUMN first_due_date TEXT;

-- Set when a plan has pushed its schedule into invoice_recurrence, so the
-- client profile can show the live next-due date instead of the original one.
ALTER TABLE client_package_terms ADD COLUMN recurrence_id TEXT;

-- ---------------------------------------------------------------------------
-- invoices.is_installment: marks an invoice as one of the client's package
-- payments, as opposed to a one-off charge (an Apex Club event, an extra
-- service). Without this, a naive "count the client's paid invoices" would
-- treat any unrelated charge as an installment and report the client closer to
-- paid off than they are. Harmless at 2 paid invoices; silently corrupting at
-- 60.
--
-- Defaults to 0, which deliberately leaves the 6 pre-existing invoices
-- (including the 2 already paid: Lira INV-000008, JM Luxury Pool INV-000009)
-- OUT of every plan tally. Nicole's call on 2026-08-10: the system is days old
-- and Alice hasn't driven it yet, so there is no real history to strand. The
-- start line is today forward, and anything paid before it belongs in
-- payments_made_before if it belongs anywhere.
-- ---------------------------------------------------------------------------
ALTER TABLE invoices ADD COLUMN is_installment INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_inv_client_installment
  ON invoices(client_id, is_installment, status);
