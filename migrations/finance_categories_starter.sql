-- Starter categories for finance-new.html, in Portuguese, sized for a small
-- consulting firm.
--
-- DELIBERATELY SHORT. Every category she has to think about is friction at the
-- exact moment we are asking her for time, and she can add her own. A long
-- list also makes the first month's categorization feel like data entry, which
-- is the thing that made her abandon the last tool.
--
-- NOT the 27 Zoho accounting categories: those are tax-oriented, are being
-- retired with Zoho, and are the wrong vocabulary for a budgeting tool. This
-- list answers "where did the money go", not "which line of the return".
--
-- 'transfer' kind exists so movements between her own accounts have somewhere
-- to land, but transfers are excluded from the spending breakdown entirely --
-- moving money between her own accounts is not spending and counting it would
-- inflate every total.
--
-- Idempotent: INSERT OR IGNORE on fixed ids, so re-running never duplicates.

INSERT OR IGNORE INTO categories (id, name_pt, name_en, kind, sort_order, created_at) VALUES
  ('cat_receita_clientes', 'Receita de Clientes',   'Client Revenue',     'income',   10, datetime('now')),
  ('cat_outras_receitas',  'Outras Receitas',       'Other Income',       'income',   20, datetime('now')),

  ('cat_materiais',        'Materiais',             'Materials',          'expense',  30, datetime('now')),
  ('cat_subcontratados',   'Subcontratados',        'Subcontractors',     'expense',  40, datetime('now')),
  ('cat_software',         'Software e Assinaturas','Software & Subscriptions', 'expense', 50, datetime('now')),
  ('cat_marketing',        'Marketing',             'Marketing',          'expense',  60, datetime('now')),
  ('cat_escritorio',       'Escritorio',            'Office',             'expense',  70, datetime('now')),
  ('cat_viagem',           'Viagem e Transporte',   'Travel & Transport', 'expense',  80, datetime('now')),
  ('cat_refeicoes',        'Refeicoes',             'Meals',              'expense',  90, datetime('now')),
  ('cat_taxas',            'Taxas e Servicos Bancarios', 'Fees & Banking','expense', 100, datetime('now')),
  ('cat_impostos',         'Impostos',              'Taxes',              'expense', 110, datetime('now')),
  ('cat_pessoal',          'Pessoal',               'Personal',           'expense', 120, datetime('now')),

  ('cat_transferencia',    'Transferencia',         'Transfer',           'transfer',130, datetime('now'));
