ALTER TABLE task_usage ADD COLUMN event_id text;
CREATE UNIQUE INDEX task_usage_run_event_key ON task_usage (run_id, event_id) WHERE event_id IS NOT NULL;
