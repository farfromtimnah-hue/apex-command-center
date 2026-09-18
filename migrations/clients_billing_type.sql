-- Non-billable clients (2026-09-17).
--
-- Not every active client is meant to be invoiced, and the attention queue had
-- no way to be told so: it counted every active client without package terms,
-- forever, with no answer available. A nag you cannot answer is how a queue
-- stops being read.
--
-- Three real cases, all with genuine sessions -- the work is real, the billing
-- is not:
--   joint_venture  MY PURE FILTER  — Rafa and Alice OWN it; Apex's contribution
--                                    IS the consulting, so there is no fee.
--   pro_bono       PRODUWALL       — done for free.
--   paid_in_full   PERFECT SQUARE  — a pre-system client who settled up.
--
-- Default 'billable' so every existing and future client behaves exactly as
-- before unless somebody deliberately says otherwise.
ALTER TABLE clients ADD COLUMN billing_type TEXT NOT NULL DEFAULT 'billable'
  CHECK (billing_type IN ('billable','joint_venture','pro_bono','paid_in_full','not_billed'));

UPDATE clients SET billing_type='joint_venture' WHERE id='26b13500-41f3-4924-88a5-8c847af59efd';
UPDATE clients SET billing_type='pro_bono',     package='PRO BONO'           WHERE id='nicolas-iasmin-001';
UPDATE clients SET billing_type='paid_in_full', package='PAGO INTEGRALMENTE' WHERE id='mazinho-001';

-- 2026-09-17, second pass: a NEGOTIATED total is not a missing one.
--
-- JN FREITAS is ADVANCED ($8,382 in the catalog) PLUS a marketing add-on that
-- is priced per client, by what that client needs. There is no catalog figure
-- and there never will be, so no query can produce this number and asking for
-- it forever is noise. He IS billable -- billing_type stays 'billable' -- so
-- this is a separate flag, not another billing type.
ALTER TABLE clients ADD COLUMN custom_pricing INTEGER NOT NULL DEFAULT 0;
UPDATE clients SET custom_pricing=1 WHERE id='784aef64-b53d-444d-9887-651a2393f29d';
