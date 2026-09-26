-- Contracts build, checkpoint D: notary helper (final payment affidavit),
-- before-work condition photos with homeowner acknowledgment, completion
-- walkthrough / punch list with sign-off, lien release tracking,
-- subcontractor license and insurance on file. Additive only.
CREATE TABLE IF NOT EXISTS gm_job_condition_photos (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  job_id      TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  content_type TEXT,
  note        TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gm_job_condition_photos_job ON gm_job_condition_photos (client_id, job_id);
-- Homeowner acknowledgments on a public token page: before-work conditions and completion.
CREATE TABLE IF NOT EXISTS gm_job_acks (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  job_id         TEXT NOT NULL,
  lead_id        TEXT,
  kind           TEXT NOT NULL,          -- before_photos | completion
  status         TEXT NOT NULL DEFAULT 'sent',   -- sent | viewed | signed | declined | void
  public_token   TEXT NOT NULL,
  payload_json   TEXT,                   -- frozen set: photos [{id,note,created_at}] or punch items [{text,done_at}]
  statement      TEXT,                   -- the sentence the homeowner signs
  snapshot_r2_key TEXT, content_hash TEXT,
  sent_at TEXT, first_viewed_at TEXT,
  signer_name TEXT, signed_at TEXT, signature_kind TEXT, signature_r2_key TEXT, signed_ip TEXT, signed_ua TEXT,
  decline_reason TEXT,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_job_acks_token ON gm_job_acks (public_token);
CREATE INDEX IF NOT EXISTS idx_gm_job_acks_job ON gm_job_acks (client_id, job_id);
CREATE TABLE IF NOT EXISTS gm_job_punch_items (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  job_id      TEXT NOT NULL,
  text        TEXT NOT NULL,
  photo_r2_key TEXT, photo_content_type TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT, done_by TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_gm_job_punch_items_job ON gm_job_punch_items (client_id, job_id);
-- Notices to Owner received and their releases (conditional / unconditional).
CREATE TABLE IF NOT EXISTS gm_job_lienors (
  id                 TEXT PRIMARY KEY,
  client_id          TEXT NOT NULL,
  job_id             TEXT NOT NULL,
  name               TEXT NOT NULL,
  notice_date        TEXT,               -- YYYY-MM-DD the Notice to Owner was served
  amount_claimed_cents INTEGER,
  note               TEXT,
  conditional_release_r2_key TEXT, conditional_release_at TEXT, conditional_release_note TEXT,
  unconditional_release_r2_key TEXT, unconditional_release_at TEXT, unconditional_release_note TEXT,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT, removed_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_gm_job_lienors_job ON gm_job_lienors (client_id, job_id);
-- Final payment affidavit: generated payload and the notarized copy uploaded back.
CREATE TABLE IF NOT EXISTS gm_job_affidavits (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  job_id         TEXT NOT NULL,
  mode           TEXT NOT NULL DEFAULT 'notary',   -- notary | declaration (s. 92.525, admin switch)
  payload_json   TEXT,
  generated_by   TEXT, generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  notarized_r2_key TEXT, notarized_content_type TEXT, notarized_at TEXT, notarized_uploaded_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_gm_job_affidavits_job ON gm_job_affidavits (client_id, job_id);
-- Subcontractors on file, per client.
CREATE TABLE IF NOT EXISTS gm_subcontractors (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  trade           TEXT,
  license_number  TEXT,
  coi_r2_key      TEXT, coi_expires TEXT,          -- certificate of insurance
  wc_kind         TEXT,                             -- policy | exemption | NULL
  wc_r2_key       TEXT, wc_expires TEXT,            -- workers' compensation certificate or exemption
  notes           TEXT,
  archived        INTEGER NOT NULL DEFAULT 0,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gm_subcontractors_client ON gm_subcontractors (client_id);
CREATE TABLE IF NOT EXISTS gm_job_subcontractors (
  id               TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL,
  job_id           TEXT NOT NULL,
  subcontractor_id TEXT NOT NULL,
  warning_json     TEXT,                 -- what was wrong at assignment time (no license / expired), if anything
  assigned_by TEXT, assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_gm_job_subcontractors_job ON gm_job_subcontractors (client_id, job_id);
