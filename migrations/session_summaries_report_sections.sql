-- Adds the three new strategic-report sections to session_summaries,
-- following the existing PT/EN column-pair convention.
--
-- business_diagnosis_pt/en : JSON array of 10 rows
--   [{"dimension": "...", "situation": "...", "level": "FORTE|MÉDIO|FRACO|CRÍTICO"}]
--   Fixed dimension order: Produto/Serviço, Fundadores, Experiência do Cliente,
--   Time Operacional, Time Comercial, Marketing & Presença Digital,
--   Infraestrutura, Documentação Legal, Sistemas de Gestão, Parcerias.
--
-- swot_synthesis_pt/en : JSON object
--   {"forca_oportunidade": "...", "fraqueza_ameaca": "...", "forca_ameaca": "..."}
--
-- thirty_day_goals_pt/en : JSON array of 7 rows
--   [{"area": "...", "meta": "...", "indicador": "..."}]
--   Fixed area order: Operacional, Comercial, Marketing, Parcerias,
--   Infraestrutura, Legal, Sistemas.

ALTER TABLE session_summaries ADD COLUMN business_diagnosis_pt TEXT;
ALTER TABLE session_summaries ADD COLUMN business_diagnosis_en TEXT;
ALTER TABLE session_summaries ADD COLUMN swot_synthesis_pt TEXT;
ALTER TABLE session_summaries ADD COLUMN swot_synthesis_en TEXT;
ALTER TABLE session_summaries ADD COLUMN thirty_day_goals_pt TEXT;
ALTER TABLE session_summaries ADD COLUMN thirty_day_goals_en TEXT;
