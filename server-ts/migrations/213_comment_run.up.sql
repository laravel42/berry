-- Berry migration 213: a run's result comment names its run.
--
-- A run posts what it ended with — its report, or why it failed and what Berry
-- did about it — as a comment on the task. Nothing tied the comment to the
-- run, so the task page could not show a run's output under the run: it read
-- the stored failure reason instead, and the comment sat apart in the list.
-- Null for every other comment, and for result comments written before this.
ALTER TABLE comments ADD COLUMN run_id uuid REFERENCES runs(id) ON DELETE SET NULL;
