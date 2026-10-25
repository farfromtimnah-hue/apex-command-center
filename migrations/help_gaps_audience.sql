-- Learn (Aprenda) search: which side the unanswered question was asked on.
-- 'admin' is the staff app, 'client' is the client portal. Rows written before
-- this column existed read as an empty string.
--
-- Add-only: one new column with a default, so no existing row changes.
-- NOT applied yet. Apply it BEFORE the Worker deploy that names the column, with:
--   npx wrangler d1 execute apex-command-center --remote --file=migrations/help_gaps_audience.sql

ALTER TABLE help_gaps ADD COLUMN audience TEXT NOT NULL DEFAULT '';
