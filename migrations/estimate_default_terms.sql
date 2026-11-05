-- Saved default estimate terms: the texts every NEW estimate starts with.
-- One row per business (gm_doc_settings). All three nullable, no default:
-- NULL means nothing saved, and a new estimate starts with empty boxes.
-- Existing estimates are never touched. The Worker works before and after
-- this runs (it reads the three as null while the columns are missing).
ALTER TABLE gm_doc_settings ADD COLUMN default_terms_included TEXT;
ALTER TABLE gm_doc_settings ADD COLUMN default_terms_excluded TEXT;
ALTER TABLE gm_doc_settings ADD COLUMN default_customer_notes TEXT;
