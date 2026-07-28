-- Where a client came from, kept for their whole lifecycle (2026-07-27).
-- Fully additive: two nullable columns on clients, plus a one-time backfill.
--
-- WHY THIS EXISTS ALONGSIDE referred_by_partner_id
--
-- clients.referred_by_partner_id (migrations/apex_partners.sql) already records
-- ONE kind of source: an Apex referral partner, by record. But most clients do
-- not arrive that way — a walk-in, an Instagram DM, an existing client's word
-- of mouth, Rafa meeting someone at an event. Today there is nowhere to record
-- any of those, and no page reads the partner pointer back in the other
-- direction either, so a client's origin is invisible once the lead is created.
--
-- These two columns describe the sources that AREN'T partners. They do not
-- replace the partner link:
--
--   source_type = 'partner'  ->  referred_by_partner_id stays AUTHORITATIVE.
--                                The partner's name is resolved by join against
--                                apex_partners at read time, exactly as the
--                                Partner tab already derives its counts. The
--                                name is NEVER copied into source_detail — a
--                                typed string drifts the moment the partner is
--                                renamed, and attribution here is by record,
--                                never by matching a name (the same rule stated
--                                on the gm_leads partner field).
--
--   any other source_type    ->  source_detail carries the specifics, free text.
--
-- source_type is a CONSTRAINED set, not free text, because it is the field
-- future source-attribution metrics will GROUP BY (what share of clients came
-- from each source, conversion rate per source, which partners actually
-- convert). Free text would make those numbers uncountable on day one. The set
-- is validated in the worker rather than by a CHECK constraint, matching how
-- every other constrained column in this schema is enforced (lead_stage,
-- status, apex_partners.status) — SQLite cannot alter a CHECK later, and this
-- list will grow.
--
--   partner          — an Apex referral partner (apex_partners row)
--   referral_client  — an existing client sent them; the name goes in detail
--   direct           — Rafa/Alice already knew them, or they reached out cold
--   event            — met at an event: Apex Club, a talk, a trade show
--   social           — Instagram, LinkedIn, YouTube, an ad
--   other            — anything that fits nowhere above; detail explains

ALTER TABLE clients ADD COLUMN source_type TEXT;
ALTER TABLE clients ADD COLUMN source_detail TEXT;

-- Grouping/filtering by source is the whole point of the column, and the leads
-- pipeline is the first place it will be counted.
CREATE INDEX IF NOT EXISTS idx_clients_source_type ON clients (source_type);

-- BACKFILL — only what is already KNOWN, never a guess.
--
-- A client carrying a partner pointer demonstrably came from that partner, so
-- their source_type is 'partner' by definition. Everyone else stays NULL:
-- unknown origin is a true and useful fact, and defaulting them to 'direct'
-- would silently invent attribution data that the future metrics would then
-- report as if it were observed.
UPDATE clients
   SET source_type = 'partner'
 WHERE referred_by_partner_id IS NOT NULL
   AND source_type IS NULL;
