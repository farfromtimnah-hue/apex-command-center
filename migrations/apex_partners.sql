-- APEX's OWN referral partners (2026-07-27). Fully additive — one new table
-- and one new rate-limit ledger; nothing existing is modified.
--
-- DATA TIER NOTE (the third time this distinction matters in this codebase —
-- read it before touching anything here):
--
--   gm_partners   -> a CLIENT's own referral partners (e.g. LIRA's suppliers
--                    who send it paver jobs). One tier BELOW Apex.
--   apex_partners -> APEX's own referral partners: people and businesses who
--                    send COACHING CLIENTS to Apex. This table.
--
-- They are never joined and never merged. apex_partners has no client_id at
-- all, because it does not belong to a client — it belongs to the consultancy.
-- That absence is the schema-level expression of the tier difference, and it is
-- also what makes the admin-only guard simple: there is no client scope to
-- check, so every route is isAdminRole-only, full stop.
--
-- Schema mirrors gm_partners (name, tipo, contato, status, ultima_interacao,
-- proxima_acao) so the two screens can share a visual language, plus the
-- referral-tracking fields below.
CREATE TABLE IF NOT EXISTS apex_partners (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  tipo              TEXT,                                 -- free text: Contador, Ex-cliente, Parceiro comercial…
  contato           TEXT,
  status            TEXT NOT NULL DEFAULT 'Prospectando', -- Prospectando | Ativo | Inativo (same ladder as gm_partners)
  ultima_interacao  TEXT,                                 -- ISO date
  proxima_acao      TEXT,

  -- Public referral landing, mirroring gm_partners.referral_slug exactly:
  -- an unguessable slug serving an unauthenticated intake form. A submission
  -- creates a clients row with status='lead' and referred_by_partner_id set,
  -- so attribution is BY RECORD, never by matching a typed name.
  --
  -- Nullable: a partner tracked purely by hand (a lunch, a phone call) never
  -- needs a link. The slug is minted on demand, not at creation.
  referral_slug     TEXT,

  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_apexp_slug ON apex_partners (referral_slug);

-- Attribution on the Apex-internal pipeline. A lead that arrived through a
-- partner's link (or was attributed by hand) points at the apex_partners row.
--
-- The COUNT of clients a partner referred is therefore DERIVED from this
-- column at read time and never stored — the same rule gm_partners follows for
-- leads_indicados, and for the same reason: a stored counter drifts the moment
-- a lead is deleted, converted, or re-attributed.
ALTER TABLE clients ADD COLUMN referred_by_partner_id TEXT;
CREATE INDEX IF NOT EXISTS idx_clients_referred_by ON clients (referred_by_partner_id);

-- Rate-limit ledger for the public endpoint: one row per submission ATTEMPT
-- (before validation), counted per slug and per IP over a rolling window.
-- Separate from gm_referral_hits rather than shared, because the two public
-- forms are different tiers with different abuse profiles and a shared table
-- would let traffic against one throttle the other.
CREATE TABLE IF NOT EXISTS apex_referral_hits (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_apexrh_slug ON apex_referral_hits (slug, created_at);
CREATE INDEX IF NOT EXISTS idx_apexrh_ip ON apex_referral_hits (ip, created_at);
