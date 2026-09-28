-- Berry migration 215: a run that only brings a finished task level with main.
--
-- When an approved or delivered task's pull request conflicts with main, or
-- GitHub refuses its merge, the task goes back to its agent with the merge to
-- make. That run is `merge_fix`: the work itself was accepted, so it runs a
-- tier below its agent's (runtime/envelope-builder.ts). On BerryMax those runs
-- cost about $0.75 each, mostly reconciling README prose.
ALTER TABLE runs DROP CONSTRAINT runs_source_ck;
ALTER TABLE runs ADD CONSTRAINT runs_source_ck CHECK (
   source IN ('assignment', 'mention', 'chat', 'autopilot', 'quick_action', 'builder', 'completion', 'merge_fix')
);
