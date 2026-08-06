-- Street address + city on gm_leads (2026-08-06).
--
-- WHY THESE ARE REAL COLUMNS. JM LUXURY POOLS' 14-lead import from their own
-- spreadsheet carried a street address and city per lead, and gm_leads had
-- nowhere to put them, so the importer parked them in the observacao free-text
-- note. These are pool builders: the address IS the job site, which makes it a
-- field the business reads and sorts on, not a remark about the job.
--
-- BOTH ARE OPTIONAL AND OFTEN EMPTY. 8 of the 14 imported rows have no street
-- address at all -- a lead can be a phone number and a name long before anyone
-- knows where the pool goes. Empty is the normal early state of a good lead,
-- not missing data: the UI renders it blank, never as a warning, and never
-- filters a lead out of the pipeline for lacking it.
--
-- NO NORMALISATION, EVER. These are stored exactly as the client typed them.
-- The source sheet spells Fort Myers as "Fort Mayers" and that misspelling is
-- imported verbatim below: it is the client's own record of their own job site,
-- and silently "correcting" a client's data is how you lose their trust in it.
-- Nothing here geocodes, validates, autocompletes or canonicalises. address is
-- a street line and city is a city; no state, ZIP or country is split out,
-- because the sheet does not carry them separately either.

ALTER TABLE gm_leads ADD COLUMN address TEXT;
ALTER TABLE gm_leads ADD COLUMN city TEXT;

-- Backfill of the 14 imported JM rows.
--
-- These values come from the SOURCE SPREADSHEET, not from re-parsing the
-- observacao text the importer wrote. That distinction matters: a regex over
-- observacao would also have to guess where the address ends and the sheet's
-- own status/colour commentary begins, and would silently mangle the rows that
-- never had an address. Hand-transcribed from the sheet is the correct source.
--
-- observacao is deliberately LEFT INTACT. It still carries the spreadsheet's
-- own status and colour ("Descartado", "cor VERMELHO") and the duplicate-lead
-- warning on Michael Baker / Mo Ba, none of which is duplicated anywhere else.
-- Stripping the now-redundant address prefix out of it would take those with
-- it. A little duplication beats losing the only copy.
--
-- Two rows get NULL in both columns on purpose:
--   jm-imp-lisa-marsh -- the sheet says "Perguntar por email" (ask by email).
--                        That is a note about not knowing the address yet, not
--                        an address. Storing it would put a Portuguese
--                        instruction in the address line of a job site.
--   jm-imp-oleg-sand, jm-imp-laurie-mike, jm-imp-sam-darwich (city only), etc.
--                        -- simply blank in the source.
--
-- Scoped by id AND client_id: these ids are JM's, and the client_id predicate
-- makes it impossible for a copy-paste of this file to touch another tenant.

UPDATE gm_leads SET city = 'Tampa'
  WHERE id = 'jm-imp-sam-darwich'     AND client_id = 'cc1b026c-4e1f-40c4-8ac8-7024484bed41';
UPDATE gm_leads SET address = '5727 silver palm Blvd',   city = 'Bradenton'
  WHERE id = 'jm-imp-casey-downing'   AND client_id = 'cc1b026c-4e1f-40c4-8ac8-7024484bed41';
UPDATE gm_leads SET address = 'W969 Mary Lake Ln',       city = 'Townsend'
  WHERE id = 'jm-imp-jason-towne'     AND client_id = 'cc1b026c-4e1f-40c4-8ac8-7024484bed41';
UPDATE gm_leads SET address = '10105 Bud Rhoden Rd',     city = 'Palmetto'
  WHERE id = 'jm-imp-cj-krukowski'    AND client_id = 'cc1b026c-4e1f-40c4-8ac8-7024484bed41';
UPDATE gm_leads SET address = '11260 Meadow River Way',  city = 'Parrish'
  WHERE id = 'jm-imp-sally-houlihan'  AND client_id = 'cc1b026c-4e1f-40c4-8ac8-7024484bed41';
UPDATE gm_leads SET address = '3548 Ulman Ave',          city = 'North Port'
  WHERE id = 'jm-imp-alex-bogdan'     AND client_id = 'cc1b026c-4e1f-40c4-8ac8-7024484bed41';
UPDATE gm_leads SET address = '4098 Big Creek Overlook', city = 'Atlanta'
  WHERE id = 'jm-imp-michael-baker'   AND client_id = 'cc1b026c-4e1f-40c4-8ac8-7024484bed41';
UPDATE gm_leads SET address = '4098 Big Creek Overlook', city = 'Atlanta'
  WHERE id = 'jm-imp-mo-ba'           AND client_id = 'cc1b026c-4e1f-40c4-8ac8-7024484bed41';
UPDATE gm_leads SET address = '10130 Boger Ranch Ct',    city = 'Wesley Chapel'
  WHERE id = 'jm-imp-carlos-morales'  AND client_id = 'cc1b026c-4e1f-40c4-8ac8-7024484bed41';
-- "Fort Mayers" is the source sheet's spelling. Imported as written -- see the
-- no-normalisation note above before "fixing" it.
UPDATE gm_leads SET address = '1269 3d st',              city = 'Fort Mayers'
  WHERE id = 'jm-imp-scott-conn'      AND client_id = 'cc1b026c-4e1f-40c4-8ac8-7024484bed41';
UPDATE gm_leads SET address = '35844 Harvest Ln',        city = 'Dade City'
  WHERE id = 'jm-imp-shannon-brown'   AND client_id = 'cc1b026c-4e1f-40c4-8ac8-7024484bed41';

-- jm-imp-lisa-marsh, jm-imp-oleg-sand, jm-imp-laurie-mike: no UPDATE at all.
-- They keep NULL/NULL, which is the correct representation of "not known yet".
