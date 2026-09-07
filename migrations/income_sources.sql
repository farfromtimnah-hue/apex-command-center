-- Income by SOURCE, not just "money in".
--
-- Rafa and Alice earn from several distinct streams and the finance screens
-- could not tell them apart: Charisma teaching and My Pure Filter commissions
-- fell into "Outras Receitas", and Alice's insurance commissions into "Receita
-- Pessoal", so no screen could answer "how much came from what".
--
-- Charisma is Lagoinha's theological school. Each location runs its own and
-- brings in teachers from other Lagoinhas -- Rafa has taught at Cape Cod and
-- Sarasota, which is why the rule matches the church name rather than one city.
--
-- My Pure Filter is a partnership, not consulting. Gator's payment memo'd
-- "FILTRO COMISSAO" is a filter commission and must not inflate client revenue.
INSERT OR IGNORE INTO categories (id, name_pt, name_en, kind, scope, sort_order, archived, created_at) VALUES
 ('cat_receita_charisma','Charisma - Ensino','Charisma Teaching','income','both',12,0,datetime('now')),
 ('cat_receita_seguros','Seguros - Comissao','Insurance Commission','income','both',13,0,datetime('now')),
 ('cat_receita_filtros','My Pure Filter - Comissao','My Pure Filter Commission','income','both',14,0,datetime('now'));

INSERT OR REPLACE INTO categorization_rules (id, pattern, match_type, scope, category_id, source, created_at) VALUES
 ('rule_charisma_capecod','ZELLE PAYMENT FROM LAGOINHA CAPE COD CHURCH','merchant_contains','both','cat_receita_charisma','manual',datetime('now')),
 ('rule_charisma_sarasota','ZELLE PAYMENT FROM LAGOINHA SARASOTA CHURCH','merchant_contains','both','cat_receita_charisma','manual',datetime('now')),
 ('rule_seguros_natlife','NATIONAL LIFE','merchant_contains','both','cat_receita_seguros','manual',datetime('now'));
