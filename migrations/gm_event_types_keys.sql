-- Calendar event types become KEYS, and titles stop being stored sentences.
--
-- Same root defect as the lead stages: a value stored as a display string can
-- never translate. Two places were affected here.
--
-- 1. gm_config.event_types_json held an array of Portuguese strings, and
--    gm_events.event_type stored one of them. Unlike stages, CLIENTS CAN ADD
--    THEIR OWN types, so the stored shape has to carry the labels with the
--    key:
--      [{"key":"visita_tecnica","pt":"Visita técnica","en":"Site visit"}, ...]
--    A type the client added themselves stores THE SAME TEXT in pt and en. A
--    client's own vocabulary is theirs and must never be machine-translated;
--    it simply displays identically in both languages. That is correct
--    behaviour, not a gap.
--
-- 2. gm_events.title stored the composed sentence "<type> — <job or lead>".
--    Toggling the language cannot rewrite saved text, so the title is now
--    composed AT RENDER TIME from the parts (event_type key + job_id/lead_id)
--    and `title` is kept only for the "Outro" / free-text case and for user
--    overrides.
--
-- title_overridden is a STORED FLAG, deliberately not inferred by
-- string-comparing a saved title against a freshly generated one: that
-- comparison would flip every generated title to "overridden" the moment a
-- translation was corrected.

ALTER TABLE gm_events ADD COLUMN title_overridden INTEGER NOT NULL DEFAULT 0;

-- The seeded vocabularies, rewritten from string arrays to keyed objects.
-- Each statement is guarded on the column still being an array of strings
-- (json_type of the first element), so re-running the file is a no-op and a
-- client who has since edited their list is never overwritten.

-- Construction / trades.
UPDATE gm_config SET event_types_json = json('[
  {"key":"visita_tecnica","pt":"Visita técnica","en":"Site visit"},
  {"key":"medicao","pt":"Medição","en":"Measurement"},
  {"key":"instalacao","pt":"Instalação","en":"Installation"},
  {"key":"entrega_de_material","pt":"Entrega de material","en":"Material delivery"},
  {"key":"inicio_de_obra","pt":"Início de obra","en":"Job start"},
  {"key":"entrega_de_obra","pt":"Entrega de obra","en":"Job completion"},
  {"key":"reuniao","pt":"Reunião","en":"Meeting"},
  {"key":"outro","pt":"Outro","en":"Other"}
]')
WHERE json_valid(event_types_json)
  AND json_type(event_types_json, '$[0]') = 'text'
  AND json_extract(event_types_json, '$[0]') = 'Visita técnica';

-- ELEVATE PRIME — design + millwork, with imported materials.
UPDATE gm_config SET event_types_json = json('[
  {"key":"apresentacao_de_projeto","pt":"Apresentação de projeto","en":"Design presentation"},
  {"key":"medicao","pt":"Medição","en":"Measurement"},
  {"key":"pedido_de_material","pt":"Pedido de material","en":"Material order"},
  {"key":"chegada_de_importacao","pt":"Chegada de importação","en":"Import arrival"},
  {"key":"instalacao","pt":"Instalação","en":"Installation"},
  {"key":"visita_tecnica","pt":"Visita técnica","en":"Site visit"},
  {"key":"reuniao","pt":"Reunião","en":"Meeting"},
  {"key":"outro","pt":"Outro","en":"Other"}
]')
WHERE json_valid(event_types_json)
  AND json_type(event_types_json, '$[0]') = 'text'
  AND json_extract(event_types_json, '$[0]') = 'Apresentação de projeto';

-- DELICIE CAKES — the event date is the anchor; everything schedules back.
UPDATE gm_config SET event_types_json = json('[
  {"key":"entrega_retirada","pt":"Entrega / retirada","en":"Delivery / pickup"},
  {"key":"degustacao","pt":"Degustação","en":"Tasting"},
  {"key":"consulta_de_projeto","pt":"Consulta de projeto","en":"Design consultation"},
  {"key":"sinal_confirmacao","pt":"Sinal / confirmação","en":"Deposit / confirmation"},
  {"key":"dia_de_producao","pt":"Dia de produção","en":"Production day"},
  {"key":"dia_de_decoracao","pt":"Dia de decoração","en":"Decorating day"},
  {"key":"reuniao","pt":"Reunião","en":"Meeting"},
  {"key":"outro","pt":"Outro","en":"Other"}
]')
WHERE json_valid(event_types_json)
  AND json_type(event_types_json, '$[0]') = 'text'
  AND json_extract(event_types_json, '$[0]') = 'Entrega / retirada';

-- RANI MOURA BOUTIQUE.
UPDATE gm_config SET event_types_json = json('[
  {"key":"atendimento_personalizado","pt":"Atendimento personalizado","en":"Personal shopping"},
  {"key":"prova_ajuste","pt":"Prova / ajuste","en":"Fitting / alteration"},
  {"key":"atendimento_online","pt":"Atendimento online","en":"Virtual appointment"},
  {"key":"chegada_de_novidades","pt":"Chegada de novidades","en":"New arrivals"},
  {"key":"live","pt":"Live","en":"Live sale"},
  {"key":"viagem_de_compras","pt":"Viagem de compras","en":"Buying trip"},
  {"key":"evento_pop_up","pt":"Evento / pop-up","en":"Event / pop-up"},
  {"key":"outro","pt":"Outro","en":"Other"}
]')
WHERE json_valid(event_types_json)
  AND json_type(event_types_json, '$[0]') = 'text'
  AND json_extract(event_types_json, '$[0]') = 'Atendimento personalizado';

-- Everyone else: the small honest set.
UPDATE gm_config SET event_types_json = json('[
  {"key":"visita","pt":"Visita","en":"Visit"},
  {"key":"reuniao","pt":"Reunião","en":"Meeting"},
  {"key":"servico","pt":"Serviço","en":"Service"},
  {"key":"entrega","pt":"Entrega","en":"Delivery"},
  {"key":"outro","pt":"Outro","en":"Other"}
]')
WHERE json_valid(event_types_json)
  AND json_type(event_types_json, '$[0]') = 'text'
  AND json_extract(event_types_json, '$[0]') = 'Visita';

-- gm_events.event_type: the stored Portuguese label -> its stable key.
-- Only the seeded names are mapped; a custom type keeps whatever it holds and
-- is picked up by the frontend's legacy-string tolerance.
UPDATE gm_events SET event_type = CASE event_type
  WHEN 'Visita técnica'            THEN 'visita_tecnica'
  WHEN 'Medição'                   THEN 'medicao'
  WHEN 'Instalação'                THEN 'instalacao'
  WHEN 'Entrega de material'       THEN 'entrega_de_material'
  WHEN 'Início de obra'            THEN 'inicio_de_obra'
  WHEN 'Entrega de obra'           THEN 'entrega_de_obra'
  WHEN 'Reunião'                   THEN 'reuniao'
  WHEN 'Apresentação de projeto'   THEN 'apresentacao_de_projeto'
  WHEN 'Pedido de material'        THEN 'pedido_de_material'
  WHEN 'Chegada de importação'     THEN 'chegada_de_importacao'
  WHEN 'Entrega / retirada'        THEN 'entrega_retirada'
  WHEN 'Degustação'                THEN 'degustacao'
  WHEN 'Consulta de projeto'       THEN 'consulta_de_projeto'
  WHEN 'Sinal / confirmação'       THEN 'sinal_confirmacao'
  WHEN 'Dia de produção'           THEN 'dia_de_producao'
  WHEN 'Dia de decoração'          THEN 'dia_de_decoracao'
  WHEN 'Atendimento personalizado' THEN 'atendimento_personalizado'
  WHEN 'Prova / ajuste'            THEN 'prova_ajuste'
  WHEN 'Atendimento online'        THEN 'atendimento_online'
  WHEN 'Chegada de novidades'      THEN 'chegada_de_novidades'
  WHEN 'Live'                      THEN 'live'
  WHEN 'Viagem de compras'         THEN 'viagem_de_compras'
  WHEN 'Evento / pop-up'           THEN 'evento_pop_up'
  WHEN 'Visita'                    THEN 'visita'
  WHEN 'Serviço'                   THEN 'servico'
  WHEN 'Entrega'                   THEN 'entrega'
  WHEN 'Outro'                     THEN 'outro'
  ELSE event_type END;

-- Classify existing titles: generated (keeps translating) vs overridden
-- (keeps its stored text).
--
-- PRODUCTION SPLIT AT MIGRATION TIME: 0 generated / 0 overridden — gm_events
-- held ZERO rows when this ran. The calendar shipped the day before and
-- nobody had created an event yet, so there is no historical text to
-- classify. The statements below are still correct and still run, because
-- local/dev databases DO have rows and the file must be re-runnable
-- everywhere.
--
-- Every 'outro' event is an override by definition: there is no structure to
-- compose a title from.
UPDATE gm_events SET title_overridden = 1 WHERE event_type = 'outro';

-- A linked event whose title is exactly what the composer would have produced
-- in Portuguese ("<pt label> — <job or lead name>") is GENERATED, so it is
-- left at 0 and starts translating again. Everything else is an override.
--
-- Written as a positive test against the composed string rather than a nest
-- of inequalities: it is the same rule the frontend applies, and it is
-- readable enough to check by eye.
UPDATE gm_events SET title_overridden = 1
WHERE title_overridden = 0
  AND COALESCE(title, '') <> ''
  AND title <> (
    SELECT COALESCE(t.pt, e2.event_type) ||
           COALESCE(' — ' || NULLIF(COALESCE(
             (SELECT j.obra    FROM gm_jobs  j WHERE j.id = e2.job_id),
             (SELECT l.cliente FROM gm_leads l WHERE l.id = e2.lead_id),
             ''), ''), '')
    FROM gm_events e2
    LEFT JOIN (
      SELECT 'visita_tecnica' AS k, 'Visita técnica' AS pt UNION ALL
      SELECT 'medicao', 'Medição' UNION ALL
      SELECT 'instalacao', 'Instalação' UNION ALL
      SELECT 'entrega_de_material', 'Entrega de material' UNION ALL
      SELECT 'inicio_de_obra', 'Início de obra'
    ) t ON t.k = e2.event_type
    WHERE e2.id = gm_events.id
  );
