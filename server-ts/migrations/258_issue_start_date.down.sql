-- Reverses 258_issue_start_date.
ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_start_before_due_ck;
ALTER TABLE issues DROP COLUMN IF EXISTS start_date;
