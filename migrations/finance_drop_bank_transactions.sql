-- bank_transactions is legacy/orphaned: the dashboard, chart, and Reconcile
-- tab all now read live from Zoho Books directly (see progress.md, Financial
-- Health dashboard fix). Nothing in worker/index.js reads or writes this
-- table after that change. Optional cleanup -- not required for the app to
-- function, but safe to run once confirmed nothing references it.

DROP TABLE IF EXISTS bank_transactions;
