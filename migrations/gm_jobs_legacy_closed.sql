-- gm_jobs.legacy_closed — 2026-09-23
--
-- A won lead has become its own project since 2026-09-16 (gm_jobs.lead_id).
-- Seller Diagnostics now counts closed deals from the closed leads, one per
-- linked project, and leaves an unlinked project out of the total (flagged).
--
-- Some projects predate that and were imported with no lead at all. Rather
-- than reconstruct old imports, a project can be marked here as a one-time
-- catch-up: it counts as a closed deal on its own. Set per row, by hand,
-- never by a date rule: an unlinked project can also be a duplicate of a
-- closed lead typed twice, and a date rule would count that one twice.
ALTER TABLE gm_jobs ADD COLUMN legacy_closed INTEGER NOT NULL DEFAULT 0;

-- JM LUXURY POOLS: Vivian Carlech, $75,000, Azaf. Spreadsheet FECHADOS tab,
-- closed June 2026, never had a lead. Nicole, 2026-09-23.
UPDATE gm_jobs SET legacy_closed = 1 WHERE id = 'jm-job-vivian-carlech';
