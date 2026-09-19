-- An AI or manual plan no longer needs a goal while it is being planned.
--
-- The goal used to be minted when the plan was requested, so a request that
-- was still generating, waiting on answers or later rejected already showed as
-- a goal. Goals are now created when the plan is started (compiled), and the
-- plan carries its project itself until then. A started plan still always
-- names its goal. Orchestrator briefs are unchanged.
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_scope_ck;
ALTER TABLE plans ADD CONSTRAINT plans_scope_ck CHECK (
    (source = 'orchestrator' AND project_id IS NOT NULL)
    OR (source <> 'orchestrator' AND (goal_id IS NOT NULL OR status <> 'approved'))) NOT VALID;
