-- Business X-Ray, Part 2 (2026-07-26): practice-profile answers.
-- Fully additive — one new column on client_assessments.
--
-- profile_json holds the two practice-profile sections (Marketing na
-- Prática + Sistemas e IA) as { "<activity_key>": { "<dimension_key>":
-- value } }. Deliberately a SEPARATE column from answers_json: the profile
-- is a picture, not a grade — it never feeds the 62-point score, the
-- percentage or the maturity band (computeXrayScore never reads it).
-- The activity/dimension catalog lives in the Worker (XRAY_PROFILE_*).
ALTER TABLE client_assessments ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}';
