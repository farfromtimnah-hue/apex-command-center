CREATE TABLE IF NOT EXISTS message_templates (
  template_key  TEXT PRIMARY KEY,
  template_text TEXT NOT NULL,
  updated_at    TEXT,
  updated_by    TEXT
);
INSERT OR IGNORE INTO message_templates (template_key, template_text, updated_at, updated_by) VALUES
  ('session_in_person', 'Olá! Sua sessão de consultoria está agendada para {weekday}, {date} às {time}.', '2026-07-03', 'seed'),
  ('session_online', 'Olá! Sua sessão de consultoria está agendada para {weekday}, {date} às {time}. Acesse aqui: {meetLink}', '2026-07-03', 'seed');
