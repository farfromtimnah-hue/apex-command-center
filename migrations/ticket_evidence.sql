-- Full evidence on every automatic error ticket (2026-11-16).
--
-- ADD-ONLY. NOT applied by the build: Claude reads it, applies it, deploys the Worker.
-- Each ALTER TABLE ... ADD COLUMN FAILS WITH "duplicate column name" if run twice: run it once.
-- Until both columns exist the Worker saves tickets exactly as before (apexTicketEvidenceReady is false).
-- evidence_json holds scrubbed text only (the Worker scrubs it before saving). occurrences counts how many
-- times the same ticket id was hit again inside its hour.

-- Fails with "duplicate column name" if run twice.
ALTER TABLE support_tickets ADD COLUMN evidence_json TEXT;
-- Fails with "duplicate column name" if run twice.
ALTER TABLE support_tickets ADD COLUMN occurrences INTEGER NOT NULL DEFAULT 1;
