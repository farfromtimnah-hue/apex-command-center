-- gm_leads.estagio: Portuguese display strings -> language-neutral KEYS.
--
-- WHY. gm_leads.estagio stored "Negociação" as literal text. gmT(pt, en) can
-- only translate strings that live in the CODE, so a stored display string can
-- never translate no matter how good the language toggle is. An
-- English-speaking owner saw English chrome wrapped around Portuguese data —
-- at its worst gm.js read "Stage: Novo Lead · Date: now."
--
-- The eight stages are a FIXED ladder no client can add to (see the comment
-- block in lead_pipeline.sql), which is what makes keys safe here: the stored
-- value becomes stable and language-neutral, and the label is looked up at
-- render time from gm-labels.js.
--
-- ⚠️ THIS IS A REVENUE-BEARING MIGRATION. Worker SQL sums valor over
-- estagio IN (...) to produce pipeline_ativo, receita_fechada, fechados and
-- live_count. The worker code that reads these keys ships in the SAME commit.
-- If the data is migrated and the code is not (or vice versa), receita_fechada
-- silently returns $0 — which reads as a real business result, not a bug.
-- DEPLOY ORDER: apply this migration and deploy the worker together.
--
-- Verified before writing: all 137 rows across every client hold exactly one
-- of the eight known values, so no row can be stranded. The WHERE clause on
-- each statement means an already-migrated row is skipped, making the file
-- safe to re-run.

UPDATE gm_leads SET estagio = 'novo_lead'        WHERE estagio = 'Novo Lead';
UPDATE gm_leads SET estagio = 'contato_feito'    WHERE estagio = 'Contato Feito';
UPDATE gm_leads SET estagio = 'visita_agendada'  WHERE estagio = 'Visita Agendada';
UPDATE gm_leads SET estagio = 'estimate_enviado' WHERE estagio = 'Estimate Enviado';
UPDATE gm_leads SET estagio = 'follow_up'        WHERE estagio = 'Follow-up';
UPDATE gm_leads SET estagio = 'negociacao'       WHERE estagio = 'Negociação';
UPDATE gm_leads SET estagio = 'fechado'          WHERE estagio = 'Fechado';
UPDATE gm_leads SET estagio = 'perdido'          WHERE estagio = 'Perdido';

-- Anything left outside the eight keys after the statements above is a value
-- nobody anticipated. It is deliberately NOT coerced: a wrong stage is worse
-- than an obvious one, and 'fechado' in particular is a revenue claim.
-- Check this returns zero rows:
--   SELECT estagio, COUNT(*) FROM gm_leads
--   WHERE estagio NOT IN ('novo_lead','contato_feito','visita_agendada',
--                         'estimate_enviado','follow_up','negociacao',
--                         'fechado','perdido')
--   GROUP BY estagio;
