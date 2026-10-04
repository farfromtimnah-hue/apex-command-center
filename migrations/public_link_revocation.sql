-- Customer link control (2026-10-04). Run ONCE.
--
-- link_disabled_at: set by POST .../disable-link (which also ROTATES the
-- token, so the old copied link stays dead for good) and cleared by
-- POST .../enable-link. While it is set, every public GET and PDF route
-- answers the same 404 as an unknown token.
--
-- One column per table that holds a public token. gm_invoice_payments is the
-- receipts table (receipt_token). invoices is Apex's own invoices table.
ALTER TABLE gm_estimates        ADD COLUMN link_disabled_at TEXT;
ALTER TABLE gm_invoices         ADD COLUMN link_disabled_at TEXT;
ALTER TABLE gm_invoice_payments ADD COLUMN link_disabled_at TEXT;
ALTER TABLE gm_contracts        ADD COLUMN link_disabled_at TEXT;
ALTER TABLE gm_change_orders    ADD COLUMN link_disabled_at TEXT;
ALTER TABLE gm_job_acks         ADD COLUMN link_disabled_at TEXT;
ALTER TABLE apex_contracts      ADD COLUMN link_disabled_at TEXT;
ALTER TABLE invoices            ADD COLUMN link_disabled_at TEXT;
-- Estimates only: a public estimate link stops working 90 days after
-- valid_until. When staff enable it again, link_enabled_at records when, and
-- the link then works for 90 days from that moment.
ALTER TABLE gm_estimates        ADD COLUMN link_enabled_at TEXT;
