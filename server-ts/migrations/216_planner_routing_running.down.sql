UPDATE planner_events SET outcome = 'skipped' WHERE outcome = 'running';
ALTER TABLE planner_events DROP CONSTRAINT planner_events_outcome_ck;
ALTER TABLE planner_events ADD CONSTRAINT planner_events_outcome_ck
    CHECK (outcome IN ('ok', 'invalid', 'error', 'timeout', 'skipped'));
