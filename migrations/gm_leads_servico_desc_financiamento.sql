-- Two facts that arrived from the JM spreadsheet import crammed into the
-- observacao prose blob, where they are invisible to filtering and reporting.
--
-- servico_desc: "O QUE O CLIENTE PRETENDE FAZER" -- free text, deliberately
-- NOT gm_leads.servico. servico is a per-client dropdown list; the spreadsheet
-- values (POOL E SPA, POOL, SPA, CAGE, HIGH-END PROJECT, REMODEL, and one-off
-- prose like "Standard pool, maybe jacuzzi") do not match that list and
-- forcing them into it would either corrupt the dropdown or drop the detail.
--
-- status_financiamento: for an $80k pool the financing decision is the single
-- biggest qualifier, and it dominates JM's cancelled leads. Free text, NOT an
-- enum -- the source phrasing is inconsistent ("Não aplicou", "Aproval final",
-- "Não foi aprovado") and normalising it here would invent categories nobody
-- agreed to.
--
-- Both are optional and blank-tolerant: most leads have neither.
--
-- observacao is left INTACT on every row. It is the audit trail of what the
-- spreadsheet actually said; these columns are an extraction, not a move.

ALTER TABLE gm_leads ADD COLUMN servico_desc TEXT;
ALTER TABLE gm_leads ADD COLUMN status_financiamento TEXT;
