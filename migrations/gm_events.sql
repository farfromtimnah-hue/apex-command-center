-- The client business's own calendar.
--
-- Rafa's clarification is the whole reason this exists: "no portal do meu
-- cliente ele não tem acesso ao calendário da empresa dele" — the client tier
-- has no calendar at all. Alice has one on the Apex side; the client business
-- has nothing.
--
-- ⚠️ NO GOOGLE. No OAuth, no sync, no Google Calendar integration of any
-- kind. This is a native client-tier calendar and that was an explicit
-- decision, not an omission — do not add a Google connection later without
-- going back to that decision first.
--
-- TITLE IS COMPOSED, NOT TYPED. The title column stores a generated string
-- (`<event type> — <linked job or lead>`) and the create form composes it from
-- structured choices. The reason is in Rafa's own Google Calendar, where one
-- client appears across three weeks as "RDE - METZ", "METZ - RDE" and "Metz",
-- another as "RDE - Mazinho" (the OWNER's name, not the company), and one
-- entry has no title at all. None of that can be grouped or counted. The
-- column stays free-text and editable — an override is the client's call —
-- but the DEFAULT is consistent, which is the point.
--
-- NO RECURRENCE. Deliberately single events only: recurrence is the most
-- bug-prone part of any calendar and nobody has asked for it. Known future
-- gap — a boutique's weekly lives and new-arrival drops will want it.
--
-- created_by / updated_by are SERVER-SET from the authenticated session,
-- never trusted from the request body — the same rule as client_notes,
-- lead_contact_log and gm_notes.
--
-- Sellers cannot reach these routes: sellerRequestAllowed() is a strict
-- allowlist and none of them are listed in it.

CREATE TABLE IF NOT EXISTS gm_events (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  -- One of the client's OWN event types (gm_config.event_types_json), not a
  -- global enum: a cake studio's "Dia de decoração" and a pool builder's
  -- "Início de obra" have nothing to do with each other.
  event_type   TEXT NOT NULL,
  title        TEXT NOT NULL,          -- generated from the choices, editable
  event_date   TEXT NOT NULL,          -- ISO YYYY-MM-DD, local to the business
  start_time   TEXT,
  end_time     TEXT,
  all_day      INTEGER NOT NULL DEFAULT 0,
  -- Auto-filled from the linked job or lead when there is one (gm_leads
  -- already carries address and city), and editable afterwards.
  location     TEXT,
  description  TEXT,
  -- The link that makes the title meaningful. Both nullable and mutually
  -- exclusive in practice: a trades client links a job, an appointment
  -- business links a lead, and plenty of events link neither.
  job_id       TEXT REFERENCES gm_jobs(id),
  lead_id      TEXT REFERENCES gm_leads(id),
  assigned_to  TEXT,                   -- from the client's own vendedores list
  created_by   TEXT,                   -- SERVER-SET from the session
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by   TEXT,                   -- SERVER-SET from the session
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The month read: every event for one client in a date window.
CREATE INDEX IF NOT EXISTS idx_gm_events_client_date ON gm_events (client_id, event_date);
-- "What is scheduled against this job / this lead", and the cascade checks.
CREATE INDEX IF NOT EXISTS idx_gm_events_job  ON gm_events (job_id);
CREATE INDEX IF NOT EXISTS idx_gm_events_lead ON gm_events (lead_id);
