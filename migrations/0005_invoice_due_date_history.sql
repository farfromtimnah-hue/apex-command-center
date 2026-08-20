-- Nicole's call 2026-08-17: 0003 only kept the LAST due-date change on the
-- invoices row, which can't answer "is this becoming a habit" -- that needs
-- every change, not just the most recent one. This adds the append-only log.
--
-- invoices.due_date_changed_at/by/reason stay as-is, deliberately not
-- dropped: they are a cheap "was this ever pushed, and when last" read with
-- no join, which is what the invoice list needs for every row on every
-- load. The new table is for the one screen that actually wants the full
-- list -- per invoice, or across all invoices to spot a pattern.

CREATE TABLE IF NOT EXISTS invoice_due_date_changes (
  id           TEXT PRIMARY KEY,
  invoice_id   TEXT NOT NULL,
  old_due_at   TEXT,
  new_due_at   TEXT NOT NULL,
  reason       TEXT NOT NULL,
  changed_by   TEXT,
  changed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_due_date_changes_invoice ON invoice_due_date_changes(invoice_id, changed_at);
-- Client-level habit view needs the client, which lives on invoices, not
-- here -- this index just makes "every change in the last N days" cheap
-- for a cross-invoice habit report without touching invoice_id at all.
CREATE INDEX IF NOT EXISTS idx_due_date_changes_when ON invoice_due_date_changes(changed_at);
