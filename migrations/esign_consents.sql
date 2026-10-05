-- Electronic signature consent evidence (2026-10-04). Run ONCE.
-- E-SIGN (15 USC 7001(c)) and Florida UETA (668.50): one row each time a
-- customer ticks the consent box and the signature is recorded. APPEND-ONLY:
-- nothing in the Worker updates or deletes a row here.
-- doc_sha256 is the SHA-256 of the document's JSON payload exactly as the
-- public route served it at the moment of consent.
CREATE TABLE IF NOT EXISTS gm_esign_consents (
  id                   TEXT PRIMARY KEY,
  doc_kind             TEXT NOT NULL,
  doc_id               TEXT NOT NULL,
  consented_at         TEXT NOT NULL,
  ip                   TEXT,
  user_agent           TEXT,
  consent_text_version TEXT NOT NULL,
  doc_sha256           TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gm_esign_consents_doc ON gm_esign_consents (doc_kind, doc_id);
