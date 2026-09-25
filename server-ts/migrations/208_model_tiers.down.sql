-- Model pairs cleared by the up migration are not restored: they were the
-- old catalogue's defaults, not anyone's choice, and nothing records which
-- agents had them.
DROP INDEX IF EXISTS task_usage_workspace_tier_idx;
ALTER TABLE task_usage DROP CONSTRAINT IF EXISTS task_usage_tier_ck;
ALTER TABLE task_usage DROP COLUMN IF EXISTS fell_back, DROP COLUMN IF EXISTS tier;
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_fallback_model_ck;
ALTER TABLE agents DROP COLUMN IF EXISTS fallback_model;
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_model_tier_ck;
