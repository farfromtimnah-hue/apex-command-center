-- Hero build (2026-09-27), checkpoint C: the client's document hero choice.
-- A gallery pick sets hero_gallery_key (e.g. "pools-2", a key in
-- data/hero-gallery-v1.json) and copies that photo's framing into the other
-- columns; an upload keeps using hero_r2_key, clears hero_gallery_key and
-- stores the owner's own framing here. Every column defaults NULL, which the
-- Worker reads as "no choice made": existing clients render exactly as before.
-- Run ONCE against remote D1; verify with PRAGMA table_info(gm_doc_settings).
ALTER TABLE gm_doc_settings ADD COLUMN hero_gallery_key TEXT DEFAULT NULL;
ALTER TABLE gm_doc_settings ADD COLUMN hero_focus_x REAL DEFAULT NULL;
ALTER TABLE gm_doc_settings ADD COLUMN hero_focus_y REAL DEFAULT NULL;
ALTER TABLE gm_doc_settings ADD COLUMN hero_zoom REAL DEFAULT NULL;
ALTER TABLE gm_doc_settings ADD COLUMN hero_slide REAL DEFAULT NULL;
ALTER TABLE gm_doc_settings ADD COLUMN hero_fill TEXT DEFAULT NULL;
ALTER TABLE gm_doc_settings ADD COLUMN hero_tone TEXT DEFAULT NULL;
