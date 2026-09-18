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
