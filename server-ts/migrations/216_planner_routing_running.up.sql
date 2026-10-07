-- Routing a compiled plan is its own step after compile succeeds. The plan
-- used to read "started" for the whole of that model call, including when the
-- call failed. `running` is the in-progress marker on the execute event.
ALTER TABLE planner_events DROP CONSTRAINT planner_events_outcome_ck;
ALTER TABLE planner_events ADD CONSTRAINT planner_events_outcome_ck
    CHECK (outcome IN ('ok', 'invalid', 'error', 'timeout', 'skipped', 'running'));
