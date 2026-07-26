-- APEX Growth Management, Part 1 (2026-07-26): the six data tabs that port
-- the 7-month Google Sheets engagement workbook into the client portal.
-- Fully additive — no existing table is modified.
--
-- NEW DATA TIER: gm_leads rows are the CLIENT's own customers (e.g. LIRA's
-- paver leads), one tier below the app's clients table. This is unrelated
-- to clients.status = 'lead' (the consultancy's own prospect flag).
--
-- Everything is keyed to clients.id (TEXT) so each client business gets an
-- isolated instance. Money is REAL (numbers by construction — the source
-- spreadsheet had "$22.759.42" as text summing to 0). Dates/datetimes are
-- ISO TEXT. The partner reference on a lead is a REAL foreign key by id,
-- never a name string (the spreadsheet's text join already drifted:
-- "Mark Alluminum" vs "MARK (LUMINUM)").

-- Per-client configurable lists + settings. One row per client, created on
-- first access and seeded with the LIRA defaults by the Worker. The 8
-- pipeline stages, the 3-stage "pipeline ativo" rule and the Entrada/Saída
-- category model are the consultancy's fixed method and live in Worker
-- code, NOT here.
CREATE TABLE IF NOT EXISTS gm_config (
  client_id                TEXT PRIMARY KEY,
  servicos_json            TEXT NOT NULL DEFAULT '[]',  -- SERVIÇO dropdown values
  vendedores_json          TEXT NOT NULL DEFAULT '[]',  -- VENDEDOR dropdown values
  finance_categories_json  TEXT NOT NULL DEFAULT '[]',  -- [{name, tipo}] — tipo is Entrada|Saída
  partner_types_json       TEXT NOT NULL DEFAULT '[]',  -- TIPO dropdown for partners
  cycle_months_json        TEXT NOT NULL DEFAULT '[]',  -- MÊS dropdown (engagement cycle months)
  target_margin            REAL NOT NULL DEFAULT 30,    -- ALVO? threshold on Obras (margem % minimum)
  pipeline_view_threshold  INTEGER NOT NULL DEFAULT 50, -- live-lead count that flips stacked → chip rail
  pipeline_view_override   TEXT,                        -- NULL = automatic | 'stacked' | 'rail' (manual toggle, persisted)
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Referral partners (Tab 4). LEADS INDICADOS / RECEITA GERADA are computed
-- from gm_leads at read time via the parceiro_id FK — never stored.
CREATE TABLE IF NOT EXISTS gm_partners (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  tipo              TEXT,                                -- from gm_config.partner_types_json
  contato           TEXT,
  status            TEXT NOT NULL DEFAULT 'Prospectando', -- Prospectando | Ativo | Inativo
  ultima_interacao  TEXT,                                -- ISO date
  proxima_acao      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gmp_client ON gm_partners (client_id);

-- CRM pipeline (Tab 1) — 17 fields per lead, exactly the spreadsheet's.
CREATE TABLE IF NOT EXISTS gm_leads (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL,
  mes_lead          TEXT,                                -- MÊS LEAD (cycle month name)
  data_lead         TEXT,                                -- DATA/HORA LEAD (ISO datetime)
  cliente           TEXT NOT NULL,                       -- CLIENTE — required, the row's existence key
  telefone          TEXT,
  origem            TEXT,                                -- ORIGEM dropdown
  parceiro_id       TEXT REFERENCES gm_partners(id),     -- PARCEIRO — REAL FK, not a name string
  servico           TEXT,                                -- SERVIÇO (per-client list)
  observacao        TEXT,                                -- OBSERVAÇÃO DO TRABALHO
  vendedor          TEXT,                                -- VENDEDOR (per-client list)
  data_contato      TEXT,                                -- DATA/HORA 1º CONTATO → 5-minute SLA
  data_estimate     TEXT,                                -- DATA/HORA ESTIMATE → 24-hour SLA
  valor             REAL,                                -- VALOR ESTIMATE ($)
  estagio           TEXT NOT NULL DEFAULT 'Novo Lead',   -- ESTÁGIO (the 8 fixed stages)
  followups         INTEGER,                             -- Nº FOLLOW-UPS
  proxima_acao      TEXT,                                -- PRÓXIMA AÇÃO (free text in practice)
  mes_fechamento    TEXT,                                -- MÊS FECHAMENTO
  stage_changed_at  TEXT NOT NULL DEFAULT (datetime('now')), -- drives "days in stage"
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gml_client ON gm_leads (client_id);
CREATE INDEX IF NOT EXISTS idx_gml_parceiro ON gm_leads (parceiro_id);

-- Metas & Execução roadmap (Tab 2).
CREATE TABLE IF NOT EXISTS gm_roadmap (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  mes          TEXT,                                     -- cycle month name
  acao         TEXT NOT NULL,
  frente       TEXT,                                     -- Comercial | Gestão | ... (fixed list)
  responsavel  TEXT,
  status       TEXT NOT NULL DEFAULT 'Pendente',         -- Realizado | Em andamento | Pendente | Atrasado | Cancelado
  observacoes  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gmr_client ON gm_roadmap (client_id);

-- Base de Ouro — dormant-customer reactivation (Tab 3). Marking a row
-- "Reativado" is an explicit confirmed action that creates a gm_leads row
-- with ORIGEM = 'Base de Clientes'; the created lead id is recorded here so
-- the action is idempotent and auditable.
CREATE TABLE IF NOT EXISTS gm_base_ouro (
  id                   TEXT PRIMARY KEY,
  client_id            TEXT NOT NULL,
  cliente              TEXT NOT NULL,
  telefone             TEXT,
  servico_anterior     TEXT,                             -- SERVIÇO ANTERIOR / ANO (free text)
  status               TEXT NOT NULL DEFAULT 'Não contatado', -- Não contatado | Contatado | Interessado | Reativado | Sem interesse
  data_contato         TEXT,                             -- ISO date
  oferta               TEXT,                             -- OFERTA APRESENTADA
  observacoes          TEXT,
  reactivated_lead_id  TEXT REFERENCES gm_leads(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gmb_client ON gm_base_ouro (client_id);

-- Obras & Margem — per-job P&L (Tab 6). CUSTO TOTAL / LUCRO / MARGEM % /
-- ALVO? / NO PRAZO? are computed at read time, never stored.
CREATE TABLE IF NOT EXISTS gm_jobs (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  obra            TEXT NOT NULL,                         -- CLIENTE / OBRA
  mes_entrega     TEXT,                                  -- cycle month name
  valor           REAL,                                  -- VALOR ($)
  material        REAL,                                  -- MATERIAL ($)
  mao_de_obra     REAL,                                  -- MÃO DE OBRA ($)
  outros          REAL,                                  -- OUTROS ($)
  inicio          TEXT,                                  -- ISO date
  prazo_previsto  TEXT,                                  -- ISO date
  entrega_real    TEXT,                                  -- ISO date
  status          TEXT NOT NULL DEFAULT 'Em andamento',  -- Em andamento | Concluída | Atrasada | Pausada
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gmj_client ON gm_jobs (client_id);

-- Financeiro — the CLIENT's own cash ledger (Tab 5), native, no external
-- accounting API. tipo is DERIVED from categoria by the Worker (looked up
-- in gm_config.finance_categories_json) and never accepted from a request.
CREATE TABLE IF NOT EXISTS gm_finance (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  mes        TEXT,                                       -- cycle month name
  data       TEXT,                                       -- ISO date
  descricao  TEXT NOT NULL,
  categoria  TEXT NOT NULL,
  tipo       TEXT NOT NULL,                              -- 'Entrada' | 'Saída' — derived, see above
  valor      REAL NOT NULL,                              -- always a number by construction
  obra_id    TEXT REFERENCES gm_jobs(id),                -- OBRA VINCULADA — real FK
  obs        TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gmf_client ON gm_finance (client_id);
CREATE INDEX IF NOT EXISTS idx_gmf_obra ON gm_finance (obra_id);
