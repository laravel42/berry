ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_scope_ck;
ALTER TABLE plans ADD CONSTRAINT plans_scope_ck CHECK (
    (source = 'orchestrator' AND project_id IS NOT NULL)
    OR (source <> 'orchestrator' AND goal_id IS NOT NULL AND project_id IS NULL)) NOT VALID;
