CREATE TABLE IF NOT EXISTS message_templates (
  template_key  TEXT PRIMARY KEY,
  template_text TEXT NOT NULL,
  updated_at    TEXT,
  updated_by    TEXT
);
INSERT OR IGNORE INTO message_templates (template_key, template_text, updated_at, updated_by) VALUES
  ('session_in_person', 'Olá! Sua sessão de consultoria está agendada para {weekday}, {date} às {time}.', '2026-07-03', 'seed'),
  ('session_online', 'Olá! Sua sessão de consultoria está agendada para {weekday}, {date} às {time}. Acesse aqui: {meetLink}', '2026-07-03', 'seed'),
  ('client_login', 'Olá! Seu acesso ao Portal do Cliente Apex está pronto.

Link: {loginUrl}
Usuário: {username}
Senha temporária: {tempPassword}

No primeiro acesso você vai criar uma senha nova.', '2026-07-27', 'seed'),
  ('invoice_send', 'Ola! Segue a fatura para sua aprovacao:
{invoiceLink}', '2026-07-27', 'seed'),
  ('portal_help_request', 'Oi Rafa! Aqui é {clientName}. Preciso de ajuda com "{label}" no Portal Apex. Os números estão na sua aba de tarefas.', '2026-07-27', 'seed'),
  ('resource_send', 'Olá! Segue uma recomendação da Apex Business & Leadership:', '2026-07-27', 'seed'),
  ('partner_referral_share', 'Peça um orçamento por este link: {referralUrl}', '2026-07-27', 'seed');
