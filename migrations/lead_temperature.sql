-- Lead temperature (Nicole, 2026-09-29): a pill on every Apex lead saying
-- warm or cold. NULL = not set yet (the pill reads "Definir").
-- New leads from a partner's link start 'warm' (the INSERT sets it).
ALTER TABLE clients ADD COLUMN lead_temperature TEXT;

-- Backfill, from Nicole's own account of where each lead came from:
-- warm: the two that really signed up through her partner link.
UPDATE clients SET lead_temperature = 'warm' WHERE id IN ('cac95ba0-9327-4cd7-8e2f-76a734a7a76f', 'c8ba59cd-2246-4adb-a790-971bd1eaca88');
-- cold: the eight she added straight to D1 on 2026-08-09 (attributed to her
-- partner record, but never through the link).
UPDATE clients SET lead_temperature = 'cold' WHERE id IN (
    'a1d7f3c2-9b84-4e61-8f52-3c7a6e0d5b19', 'b7e2c94a-1f56-4d83-a0c7-8e5b2f6d1c43',
    'c4f8a2e6-3d71-4b95-9c28-6a1e7f0b4d52', 'd9b3e5f1-7c42-4a86-b013-2f8d6c9a4e75',
    'e5c1a840-6b93-4f27-8d5e-1c0b7a3f9d68', 'f2a6d80b-4e39-4c17-b5a2-9d3e1f7c6084',
    '3c8f1a75-2d64-4e08-9b17-5a2c9f4d7e61', '0a4e7b26-8c15-4d93-9f7a-3b6d2e8c1054'
);
