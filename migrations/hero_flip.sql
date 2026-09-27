-- Hero follow-up (2026-09-27), A2: mirror the document hero horizontally.
-- NULL = never set (read as false). A gallery pick copies the manifest's
-- "flip"; an upload starts unflipped. Run ONCE against remote D1.
ALTER TABLE gm_doc_settings ADD COLUMN hero_flip INTEGER DEFAULT NULL;
