-- Cost inputs on a LEAD, asked for by JM's owner 2026-08-26 and forwarded by
-- Rafa: "preciso que coloque aqueles espaços pra inserir os custos aqui nos
-- clientes que estão na pipeline. Custos, comissão, etc. Por enquanto só tem
-- na parte dos projetos, mas lá são para os já fechados."
--
-- That last sentence is the whole reason this exists. The identical five
-- columns already live on gm_jobs, but a job is work already WON — by the time
-- a row exists there the price is agreed and the margin is whatever it is.
-- Pricing happens on the LEAD, before the estimate goes out, and that is where
-- the seller needs to see what a price does to the margin.
--
-- Same names, same types, same semantics as gm_jobs on purpose: gmJobComputed()
-- is reused verbatim against a lead row, so custo_total / lucro / margem_pct /
-- alvo_ok / comissao_pct mean exactly one thing across both tables. Any drift
-- in naming here would fork that function.
--
-- COMISSAO is the DOLLAR AMOUNT, never the rate — the rate is always derived
-- (comissao / valor, of the GROSS sale, not the profit). Storing a rate would
-- silently re-price an agreed commission the moment anyone corrected `valor`.
-- See migrations/gm_jobs_admin_commission.sql for Rafa's wording on that.
--
-- All five are nullable with no default. NULL means "not costed yet", which is
-- the honest state of most leads and must not render as $0 — a lead priced at
-- zero cost would show a 100% margin and a green on-target check.
ALTER TABLE gm_leads ADD COLUMN material REAL;
ALTER TABLE gm_leads ADD COLUMN mao_de_obra REAL;
ALTER TABLE gm_leads ADD COLUMN outros REAL;
ALTER TABLE gm_leads ADD COLUMN custo_administrativo REAL;
ALTER TABLE gm_leads ADD COLUMN comissao REAL;
