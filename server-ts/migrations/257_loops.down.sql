-- Reverses 257_loops. Event triggers and event-sourced run records cannot be
-- expressed in the schema before it, so they are removed first.
DROP TABLE IF EXISTS autopilot_event_receipts;
DROP TABLE IF EXISTS autopilot_event_cursor;

DELETE FROM autopilot_triggers WHERE kind = 'event';
DELETE FROM autopilot_runs WHERE source IN ('event', 'retry');

DROP INDEX IF EXISTS autopilot_runs_workspace_order_idx;
DROP INDEX IF EXISTS autopilot_runs_issue_idx;
DROP INDEX IF EXISTS autopilot_runs_run_idx;
DROP INDEX IF EXISTS autopilot_runs_retry_key;
DROP INDEX IF EXISTS autopilot_runs_event_key;
ALTER TABLE autopilot_runs DROP CONSTRAINT IF EXISTS autopilot_runs_lineage_ck;
ALTER TABLE autopilot_runs
   DROP COLUMN IF EXISTS timed_out_at,
   DROP COLUMN IF EXISTS trigger_payload,
   DROP COLUMN IF EXISTS retry_of,
   DROP COLUMN IF EXISTS depth,
   DROP COLUMN IF EXISTS parent_autopilot_run_id,
   DROP COLUMN IF EXISTS trigger_event_id;
ALTER TABLE autopilot_runs DROP CONSTRAINT IF EXISTS autopilot_runs_source_ck;
ALTER TABLE autopilot_runs ADD CONSTRAINT autopilot_runs_source_ck
   CHECK (source IN ('cron', 'webhook', 'manual', 'replay'));

DROP INDEX IF EXISTS autopilot_triggers_event_idx;
ALTER TABLE autopilot_triggers DROP CONSTRAINT IF EXISTS autopilot_triggers_conditions_ck;
ALTER TABLE autopilot_triggers DROP CONSTRAINT IF EXISTS autopilot_triggers_event_ck;
ALTER TABLE autopilot_triggers DROP COLUMN IF EXISTS conditions, DROP COLUMN IF EXISTS event_type;
ALTER TABLE autopilot_triggers DROP CONSTRAINT IF EXISTS autopilot_triggers_kind_ck;
ALTER TABLE autopilot_triggers ADD CONSTRAINT autopilot_triggers_kind_ck CHECK (kind IN ('cron', 'webhook'));

ALTER TABLE autopilots DROP CONSTRAINT IF EXISTS autopilots_template_key_ck;
ALTER TABLE autopilots DROP CONSTRAINT IF EXISTS autopilots_budget_ck;
ALTER TABLE autopilots DROP CONSTRAINT IF EXISTS autopilots_concurrency_ck;
ALTER TABLE autopilots DROP CONSTRAINT IF EXISTS autopilots_access_mode_ck;
ALTER TABLE autopilots
   DROP COLUMN IF EXISTS template_key,
   DROP COLUMN IF EXISTS allow_agent_events,
   DROP COLUMN IF EXISTS max_chain_depth,
   DROP COLUMN IF EXISTS max_duration_minutes,
   DROP COLUMN IF EXISTS max_turns,
   DROP COLUMN IF EXISTS concurrency_policy,
   DROP COLUMN IF EXISTS access_mode;
