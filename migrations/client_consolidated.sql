-- Migration: add consolidated flag to clients table
-- Manual-only marker set by Pra Alice / Pr. Rafa on the client profile page to
-- move a client from the "Active" tab to the "Consolidados" tab on clients.html.
-- Never set automatically based on package end-date or program completion.
--
-- Command run against production D1:
--   ALTER TABLE clients ADD COLUMN consolidated INTEGER NOT NULL DEFAULT 0;
--
-- Defaults every existing client to 0 (Active) so nothing changes until
-- someone manually re-categorizes them.

ALTER TABLE clients ADD COLUMN consolidated INTEGER NOT NULL DEFAULT 0;
