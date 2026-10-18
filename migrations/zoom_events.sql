-- The random-zoom bug diagnostics (2026-10-18): one row per zoom the app's
-- own logger catches, so the real trigger can be read instead of guessed.
--
-- No free text, no field values, no names: see native-bridge.js's
-- apexZoomBuildRecord for exactly what goes into payload. Add-only: a new
-- table and two indexes. Touches no existing table.

CREATE TABLE IF NOT EXISTS zoom_events (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  who        TEXT NOT NULL,
  path       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_zoom_events_who_created ON zoom_events (who, created_at);
CREATE INDEX IF NOT EXISTS idx_zoom_events_created ON zoom_events (created_at);
