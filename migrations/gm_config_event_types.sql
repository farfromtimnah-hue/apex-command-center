-- Calendar event types — a PER-CLIENT, STORED vocabulary.
--
-- The client calendar composes an event title from structured choices instead
-- of accepting typed prose, and this column is the first of those choices.
-- The reason is in Rafa's own Google Calendar: the same client, over three
-- weeks, appears as "RDE - METZ", "METZ - RDE" and "Metz"; another as
-- "RDE - Mazinho" (the owner's name, not the company PERFECT SQUARE); one
-- entry is untitled. Prefix, suffix, bare, owner-name, and blank. None of it
-- can be grouped, counted or reported on. A free-text title field is what
-- produced that, so the calendar does not offer one by default.
--
-- ⚠️ NOT DERIVED FROM clients.industry. That column is a coarse free-text
-- label ('SAÚDE', 'CONSULTORIA', and NULL on two clients). Deriving a
-- vocabulary from it is precisely the mistake that put a hardscaping services
-- list on a bakery — see the block comment on gmGetConfig() in worker/index.js.
-- These lists are hand-assigned per client, below, and every one of them ends
-- in "Outro", the deliberate escape hatch for the thing that does not fit.
--
-- SEEDED ONCE, HERE, AND NEVER ON READ. gmGetConfig() falls back to an empty
-- list for a client with no row and never writes one. A client who clears
-- their list keeps it cleared; re-running this file will not refill it (every
-- statement is guarded on the column being NULL or empty). A client who
-- clears their list to [] keeps it cleared: '[]' is neither NULL nor empty,
-- so the guard skips it — clearing a list must stick, exactly as it does for
-- servicos.

ALTER TABLE gm_config ADD COLUMN event_types_json TEXT;

-- Construction / trades. The same list for all eleven: they run the same
-- shape of job — measure, start, install, deliver.
UPDATE gm_config SET event_types_json = json_array(
  'Visita técnica','Medição','Instalação','Entrega de material','Início de obra',
  'Entrega de obra','Reunião','Outro'
)
WHERE (event_types_json IS NULL OR trim(event_types_json) = '')
  AND client_id IN (SELECT id FROM clients WHERE name IN (
    'GATOR OUTDOOR LIVING','LIRA OUTDOOR LIVING','PERFECT SQUARE','JM LUXURY POOL',
    'DFN FLOORING','GENERAL TILE SERVICES','ELITE REMODELING','PRIME GROUP BUILDS',
    'PRODUWALL','TIGERS','METZ'
  ));

-- ELEVATE PRIME — interior design + luxury millwork. Projects run
-- design → purchasing → installation, with materials imported from Brazil,
-- Colombia and Italy, so the import arrival is a real scheduled event.
UPDATE gm_config SET event_types_json = json_array(
  'Apresentação de projeto','Medição','Pedido de material','Chegada de importação',
  'Instalação','Visita técnica','Reunião','Outro'
)
WHERE (event_types_json IS NULL OR trim(event_types_json) = '')
  AND client_id IN (SELECT id FROM clients WHERE name = 'ELEVATE PRIME');

-- DELICIE CAKES — custom cakes. The EVENT date is the anchor and everything
-- schedules backward from it (typical lead time 2-4 weeks); the deposit is
-- what holds the date, so it is an event in its own right.
UPDATE gm_config SET event_types_json = json_array(
  'Entrega / retirada','Degustação','Consulta de projeto','Sinal / confirmação',
  'Dia de produção','Dia de decoração','Reunião','Outro'
)
WHERE (event_types_json IS NULL OR trim(event_types_json) = '')
  AND client_id IN (SELECT id FROM clients WHERE name = 'DELICIE CAKES');

-- RANI MOURA BOUTIQUE — women's fashion boutique.
UPDATE gm_config SET event_types_json = json_array(
  'Atendimento personalizado','Prova / ajuste','Atendimento online','Chegada de novidades',
  'Live','Viagem de compras','Evento / pop-up','Outro'
)
WHERE (event_types_json IS NULL OR trim(event_types_json) = '')
  AND client_id IN (SELECT id FROM clients WHERE name = 'RANI MOURA BOUTIQUE');

-- Everyone else with an existing config row. Their profiles are empty and
-- there is no real data to infer from; a two-word industry label is not enough
-- to invent a calendar from. Seed the small honest set and let them add their
-- own. Deliberately NOT applied to clients with no gm_config row: creating one
-- here would be the same create-on-read mistake in a different costume.
UPDATE gm_config SET event_types_json = json_array(
  'Visita','Reunião','Serviço','Entrega','Outro'
)
WHERE event_types_json IS NULL;
