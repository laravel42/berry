-- `result_run_id` only records which run a follow-up started. It had no
-- delete rule, so removing that run failed: deleting a task (its runs
-- cascade), the test fixtures and `pnpm reset:server` all stopped on
-- run_followups_result_run_id_fkey. The follow-up outlives the pointer.
ALTER TABLE run_followups DROP CONSTRAINT IF EXISTS run_followups_result_run_id_fkey;
ALTER TABLE run_followups
   ADD CONSTRAINT run_followups_result_run_id_fkey
   FOREIGN KEY (result_run_id) REFERENCES runs(id) ON DELETE SET NULL;
