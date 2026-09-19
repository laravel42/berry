DROP TRIGGER IF EXISTS berry_runs_queued_insert ON runs;
DROP TRIGGER IF EXISTS berry_runs_queued_update ON runs;
DROP FUNCTION IF EXISTS berry_notify_run_queued();
