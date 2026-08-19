-- Monthly spending budgets keyed to a category, distinct from fixed_bills.
--
-- Difference from fixed_bills: a bill has a real due date and a specific
-- transaction that pays it (mortgage, Toyota loan). A budget is a monthly
-- spending target for variable, recurring costs with no due date and no
-- single transaction that "is" the payment (fuel, groceries) -- tracked as
-- spent-vs-remaining against the category's transactions for the month, not
-- as paid/overdue against one expected charge.
--
-- Found live 2026-08-19: "Gasolina (Tesla e Sienna)" was imported from
-- Alice's spreadsheet into fixed_bills with day_of_month as a placeholder
-- ("dia 15 e um marcador" per its own notes) -- which meant the finance
-- page's overdue detector flagged it "4 dias em atraso" every month and let
-- it compete for coverage-forecast dollars against real bills like the
-- mortgage. This table is the actual right home for that kind of tracking.
CREATE TABLE IF NOT EXISTS category_budgets (
  id                  TEXT PRIMARY KEY,
  category_id         TEXT NOT NULL REFERENCES categories(id),
  monthly_amount_cents INTEGER NOT NULL,
  purpose             TEXT NOT NULL DEFAULT 'personal' CHECK (purpose IN ('business','personal')),
  notes               TEXT,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  created_by          TEXT
);
