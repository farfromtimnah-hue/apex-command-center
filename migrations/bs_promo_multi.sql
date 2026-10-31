-- Promo materials page: a LIST of promos, each with a Portuguese and an English
-- entry. Additive only: bs_promo_items (one row per language) is never altered
-- or dropped, so older cached pages keep working. Safe to run twice.
CREATE TABLE IF NOT EXISTS bs_promos (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  name_pt    TEXT NOT NULL DEFAULT '',
  name_en    TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bs_promo_entries (
  id         TEXT PRIMARY KEY,
  promo_id   TEXT NOT NULL,
  lang       TEXT NOT NULL CHECK (lang IN ('pt','en')),
  video_url  TEXT NOT NULL DEFAULT '',
  poster_url TEXT NOT NULL DEFAULT '',
  post_text  TEXT NOT NULL DEFAULT '',
  updated_at TEXT,
  updated_by TEXT,
  UNIQUE (promo_id, lang)
);

-- 1. Aprenda: the two entries are copied from the old table, unchanged.
INSERT OR IGNORE INTO bs_promos (id, slug, sort_order, name_pt, name_en) VALUES ('bs-promo-aprenda', 'aprenda', 1, 'Aprenda (promo)', 'Aprenda (promo)');
INSERT OR IGNORE INTO bs_promo_entries (id, promo_id, lang, video_url, poster_url, post_text, updated_at, updated_by)
  SELECT 'bs-promo-aprenda-' || lang, 'bs-promo-aprenda', lang, video_url, poster_url, post_text, updated_at, updated_by
  FROM bs_promo_items WHERE lang IN ('pt','en');

-- 2. One link: estimate, contract, deposit invoice. Post text is written on the page.
INSERT OR IGNORE INTO bs_promos (id, slug, sort_order, name_pt, name_en) VALUES ('bs-promo-one-link', 'one-link', 2, 'Um só link: orçamento, contrato e entrada', 'One link: estimate, contract, deposit');
INSERT OR IGNORE INTO bs_promo_entries (id, promo_id, lang, video_url, poster_url) VALUES ('bs-promo-one-link-pt', 'bs-promo-one-link', 'pt', '/api/bs/promo-file/video-one-link-pt.mp4', '/api/bs/promo-file/poster-one-link-pt.jpg');
INSERT OR IGNORE INTO bs_promo_entries (id, promo_id, lang, video_url, poster_url) VALUES ('bs-promo-one-link-en', 'bs-promo-one-link', 'en', '/api/bs/promo-file/video-one-link-en.mp4', '/api/bs/promo-file/poster-one-link-en.jpg');

-- 3. Weather.
INSERT OR IGNORE INTO bs_promos (id, slug, sort_order, name_pt, name_en) VALUES ('bs-promo-weather', 'weather', 3, 'Previsão do tempo', 'Weather');
INSERT OR IGNORE INTO bs_promo_entries (id, promo_id, lang, video_url, poster_url) VALUES ('bs-promo-weather-pt', 'bs-promo-weather', 'pt', '/api/bs/promo-file/video-weather-pt.mp4', '/api/bs/promo-file/poster-weather-pt.jpg');
INSERT OR IGNORE INTO bs_promo_entries (id, promo_id, lang, video_url, poster_url) VALUES ('bs-promo-weather-en', 'bs-promo-weather', 'en', '/api/bs/promo-file/video-weather-en.mp4', '/api/bs/promo-file/poster-weather-en.jpg');
