-- Documentation only; the runner never applies down files.

DROP INDEX IF EXISTS issues_cycle_idx;
ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_cycle_fk;
ALTER TABLE issues DROP COLUMN IF EXISTS cycle_id;

DROP TRIGGER IF EXISTS berry_cycles_set_updated_at ON cycles;
DROP INDEX IF EXISTS cycles_workspace_status_idx;
DROP INDEX IF EXISTS cycles_workspace_order_idx;
DROP INDEX IF EXISTS cycles_workspace_one_active_uidx;
DROP INDEX IF EXISTS cycles_workspace_number_uidx;
DROP TABLE IF EXISTS cycles;
