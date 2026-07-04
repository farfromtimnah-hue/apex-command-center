CREATE TABLE IF NOT EXISTS packages (
  id             TEXT PRIMARY KEY,
  short_name     TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  audience       TEXT,
  included_items TEXT,
  is_popular     INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER
);

INSERT OR IGNORE INTO packages (id, short_name, full_name, audience, included_items, is_popular, sort_order) VALUES
  ('pkg_raio_x', 'Raio-X', 'Raio-X Estratégico APEX™',
   'Empresários que precisam clareza antes de tomar decisões de crescimento.',
   '["Diagnóstico completo do negócio","Análise de estratégia, finanças e operação","Identificação de gargalos e riscos","Prioridades claras de decisão","Plano estratégico inicial"]',
   0, 1),
  ('pkg_sprint', 'Sprint', 'APEX Sprint™ 90 Dias',
   'Empresários que querem crescer com estrutura, foco e controle.',
   '["Sprint estratégico de 90 dias","Clareza, direção e execução guiada","Sessões estratégicas recorrentes","+20 ferramentas práticas de gestão","Método Avance™ (primeiros 40 dias)","Acompanhamento e ajustes contínuos"]',
   1, 2),
  ('pkg_premium', 'Premium', 'APEX Business Premium (6 meses)',
   'Empresários que já faturam e querem escalar com organização, previsibilidade e crescimento sustentável.',
   '["Sprint intensivo de 90 dias (APEX Business Sprint™)","Acompanhamento estratégico por mais 3 meses","Encontros estratégicos semanais","Implementação de BSC APEX™ e indicadores","Estruturação de processos e vendas","12 meses de acesso total à Plataforma APEX"]',
   0, 3),
  ('pkg_executivo', 'Executivo', 'Desenvolvimento Executivo',
   'Empresários que precisam decisões críticas e acompanhamento direto.',
   '["Consultoria individual com Rafael Prata","Diagnóstico + execução personalizada","Decisões estratégicas de alto impacto","Acompanhamento próximo do líder","Relatórios de evolução","Desenvolvimento de liderança executiva"]',
   0, 4);
