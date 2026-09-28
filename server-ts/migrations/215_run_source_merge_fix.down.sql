UPDATE runs SET source = 'assignment' WHERE source = 'merge_fix';
ALTER TABLE runs DROP CONSTRAINT runs_source_ck;
ALTER TABLE runs ADD CONSTRAINT runs_source_ck CHECK (
   source IN ('assignment', 'mention', 'chat', 'autopilot', 'quick_action', 'builder', 'completion')
);
