-- Setup Wizard (branch setup-wizard). ADDITIVE ONLY: one new table, no change to
-- any existing table or row. An old Worker never reads it.
--
-- Why a table and not columns on gm_doc_settings: a gm_doc_settings row that
-- exists but has NULL schedule_presets_json reads as "no presets" instead of
-- the defaults (gmDocSettingsRow), so writing a wizard row there early would
-- change a new business's document settings. One row per business here keeps
-- the wizard's place away from every document setting.
--
--   stage          the stage the owner is on (1 to 11), so closing the app or
--                  changing phones resumes on the same stage
--   version        the wizard version stamp, set when the owner taps Start.
--                  NULL means this business never finished the wizard. The stamp
--                  only decides who is shown the full wizard on their own
--                  (sign ups with auto = 1); it never locks anything.
--   auto           1 = the full wizard opens by itself for this business (a new
--                  sign up). NULL for everyone else.
--   answers_json   answers that have no other home (kind of work, taps, the
--                  typed "something else", link in bio language, team choice)
CREATE TABLE IF NOT EXISTS gm_wizard_state (
  client_id    TEXT PRIMARY KEY,
  stage        INTEGER,
  version      INTEGER,
  auto         INTEGER,
  answers_json TEXT,
  started_at   TEXT,
  completed_at TEXT,
  updated_at   TEXT
);
