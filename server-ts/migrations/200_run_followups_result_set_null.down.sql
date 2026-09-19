ALTER TABLE run_followups DROP CONSTRAINT IF EXISTS run_followups_result_run_id_fkey;
ALTER TABLE run_followups
   ADD CONSTRAINT run_followups_result_run_id_fkey
   FOREIGN KEY (result_run_id) REFERENCES runs(id);
