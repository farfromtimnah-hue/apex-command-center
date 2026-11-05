-- Learn (Aprenda): the COMING SOON features (2026-11-05).
--
-- WHY: a person asks the help box about a feature Apex is still building. The
-- box must say plainly that it is coming soon, not ask "learn it or have Apex
-- do it" and not open the suggestion interview. The help route reads this table
-- (one read per five minutes), so the list changes with no deploy.
--
-- HOW TO CHANGE IT BY HAND: add a row to announce a feature, set active = 0 (or
-- delete the row) when it ships. aliases are lowercase words or short phrases
-- without accents, separated by commas; a question that contains one as a whole
-- word or phrase gets the text at once, with no model call. description_en is one
-- short English sentence the model reads to recognise paraphrases.
--
-- Add-only and safe to run twice: CREATE TABLE IF NOT EXISTS and INSERT OR IGNORE.
-- The Worker also carries the first three rows built in, so it answers correctly
-- before this runs.

CREATE TABLE IF NOT EXISTS help_coming_soon (
  id             TEXT PRIMARY KEY,
  name_en        TEXT NOT NULL,
  name_pt        TEXT NOT NULL,
  aliases        TEXT NOT NULL,
  description_en TEXT NOT NULL,
  text_en        TEXT NOT NULL,
  text_pt        TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

INSERT OR IGNORE INTO help_coming_soon (id, name_en, name_pt, aliases, description_en, text_en, text_pt, active, created_at) VALUES
('abc-supply', 'ABC Supply', 'ABC Supply', 'abc supply, abcsupply, abc supplies, abc roofing',
 'Supplier connection for roofing contractors: see your own ABC prices and order materials.',
 'ABC Supply is coming soon to Apex. You will be able to see your own ABC prices and order materials from inside Apex. It is not available yet, so there is nothing to set up today.',
 'A ABC Supply está chegando ao Apex. Você vai poder ver os seus preços da ABC e pedir material direto no Apex. Ainda não está disponível, então não há nada para configurar hoje.',
 1, '2026-11-05T00:00:00Z');

INSERT OR IGNORE INTO help_coming_soon (id, name_en, name_pt, aliases, description_en, text_en, text_pt, active, created_at) VALUES
('srs', 'SRS Distribution', 'SRS Distribution', 'srs, srs distribution, roof hub, roofhub',
 'Supplier connection for roofing contractors: see your own SRS prices and order materials.',
 'SRS Distribution is coming soon to Apex. You will be able to see your own SRS prices and order materials from inside Apex. It is not available yet, so there is nothing to set up today.',
 'A SRS Distribution está chegando ao Apex. Você vai poder ver os seus preços da SRS e pedir material direto no Apex. Ainda não está disponível, então não há nada para configurar hoje.',
 1, '2026-11-05T00:00:00Z');

INSERT OR IGNORE INTO help_coming_soon (id, name_en, name_pt, aliases, description_en, text_en, text_pt, active, created_at) VALUES
('qxo', 'QXO', 'QXO', 'qxo, beacon roofing, beacon supply',
 'Supplier connection for roofing contractors: see your own QXO prices and order materials.',
 'QXO is coming soon to Apex. You will be able to see your own QXO prices and order materials from inside Apex. It is not available yet, so there is nothing to set up today.',
 'A QXO está chegando ao Apex. Você vai poder ver os seus preços da QXO e pedir material direto no Apex. Ainda não está disponível, então não há nada para configurar hoje.',
 1, '2026-11-05T00:00:00Z');

-- Found in the app itself: the setup wizard's Connections step shows Facebook and
-- Instagram with a "Coming soon" label and a real description (setup-wizard.js).
INSERT OR IGNORE INTO help_coming_soon (id, name_en, name_pt, aliases, description_en, text_en, text_pt, active, created_at) VALUES
('meta-leads', 'Facebook and Instagram leads', 'Leads do Facebook e do Instagram',
 'facebook leads, instagram leads, facebook ads, instagram ads, facebook and instagram, meta ads, meta leads, lead ads',
 'Bring the leads from your Facebook and Instagram ads into Apex.',
 'Facebook and Instagram leads are coming soon to Apex. You will be able to bring the leads from your Facebook and Instagram ads into Apex. It is not available yet, so there is nothing to set up today.',
 'Os leads do Facebook e do Instagram estão chegando ao Apex. Você vai poder trazer os leads dos seus anúncios do Facebook e do Instagram para o Apex. Ainda não está disponível, então não há nada para configurar hoje.',
 1, '2026-11-05T00:00:00Z');
