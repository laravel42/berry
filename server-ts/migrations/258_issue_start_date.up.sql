-- Berry migration 258: a task can say when work on it starts.
--
-- The same shape as due_date (an instant, not a calendar day), so the two
-- read and write alike. A task never starts after it is due; existing rows
-- carry no start, so the check holds for all of them.
ALTER TABLE issues
    ADD COLUMN IF NOT EXISTS start_date timestamptz;

ALTER TABLE issues
    DROP CONSTRAINT IF EXISTS issues_start_before_due_ck;
ALTER TABLE issues
    ADD CONSTRAINT issues_start_before_due_ck CHECK (
        start_date IS NULL OR due_date IS NULL OR start_date <= due_date
    );
