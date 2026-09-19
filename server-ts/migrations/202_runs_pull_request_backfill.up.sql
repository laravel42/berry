-- Pull requests Berry opened from a run's saved files (runs/publish-artifacts)
-- were recorded only in the run's `run.delivered` event, not on the run. The
-- review's diff and merge, and the task's pull request link, read the run, so
-- those pull requests existed on GitHub and nowhere in Berry. Filled in from
-- the latest delivery that named one.
UPDATE runs AS run
   SET pull_request_number = delivered.number,
       branch = COALESCE(run.branch, delivered.branch),
       head_commit = COALESCE(run.head_commit, delivered.commit)
  FROM (
     SELECT DISTINCT ON (e.run_id) e.run_id,
            (e.payload->'pullRequest'->>'number')::int AS number,
            e.payload->>'branch' AS branch,
            e.payload->>'commit' AS commit
       FROM run_events AS e
      WHERE e.event_type = 'run.delivered'
        AND e.payload->'pullRequest'->>'number' IS NOT NULL
      ORDER BY e.run_id, e.occurred_at DESC
  ) AS delivered
 WHERE run.id = delivered.run_id
   AND run.pull_request_number IS NULL;
