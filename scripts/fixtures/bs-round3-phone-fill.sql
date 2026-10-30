-- One-time fill, Business System round 3 (2026-10-30). Copies the FIRST contact's
-- phone, exactly as stored, into clients.phone, and the contact's whatsapp into
-- clients.whatsapp only when it has one. Only an active client whose phone AND
-- whatsapp are both empty is touched. A non-empty value is never overwritten.
-- Email is never filled. Used by scripts/test-bs-round3.mjs; the live run adds
-- an explicit list of ids to the WHERE (see ~/code-reports/business-system-round3-phone-fill.txt).
UPDATE clients SET
  phone = json_extract(contacts, '$[0].phone'),
  whatsapp = CASE WHEN COALESCE(whatsapp, '') = '' AND COALESCE(TRIM(json_extract(contacts, '$[0].whatsapp')), '') <> ''
                  THEN json_extract(contacts, '$[0].whatsapp') ELSE whatsapp END
WHERE COALESCE(archived, 0) = 0
  AND COALESCE(phone, '') = ''
  AND COALESCE(whatsapp, '') = ''
  AND COALESCE(TRIM(json_extract(contacts, '$[0].phone')), '') <> '';
