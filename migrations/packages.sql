CREATE TABLE IF NOT EXISTS packages (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER
);
INSERT OR IGNORE INTO packages (id, name, sort_order) VALUES
  ('pkg_raio_x',    'Raio-X',    1),
  ('pkg_sprint',    'Sprint',    2),
  ('pkg_premium',   'Premium',   3),
  ('pkg_executivo', 'Executivo', 4);
