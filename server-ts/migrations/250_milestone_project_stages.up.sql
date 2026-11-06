-- Berry migration 250: milestones as authored project stages.
--
-- Aligns with project-scoped stages (name, optional target date, manual sort
-- order). Live milestones must belong to a project. Progress percent is
-- computed in the server from linked issues; status remains for SCM mapping.

-- Backfill project_id from a linked issue's project when unique and missing.
UPDATE milestones AS m
   SET project_id = placed.project_id, updated_at = now()
  FROM (
     SELECT mi.milestone_id, (array_agg(DISTINCT ipl.project_id))[1] AS project_id
       FROM milestone_issues AS mi
       JOIN issue_project_links AS ipl ON ipl.issue_id = mi.issue_id
      GROUP BY mi.milestone_id
     HAVING count(DISTINCT ipl.project_id) = 1
  ) AS placed
 WHERE m.id = placed.milestone_id
   AND m.project_id IS NULL
   AND m.deleted_at IS NULL;

-- Soft-delete live orphans that still have no project.
UPDATE milestones
   SET deleted_at = now(), updated_at = now()
 WHERE project_id IS NULL AND deleted_at IS NULL;

ALTER TABLE milestones
   ADD COLUMN IF NOT EXISTS target_date date,
   ADD COLUMN IF NOT EXISTS sort_order double precision;

-- Existing rows: order by created_at within each project.
WITH ranked AS (
   SELECT id,
          row_number() OVER (
             PARTITION BY workspace_id, project_id
             ORDER BY created_at ASC, id ASC
          )::double precision AS ord
     FROM milestones
    WHERE deleted_at IS NULL AND project_id IS NOT NULL
)
UPDATE milestones AS m
   SET sort_order = ranked.ord
  FROM ranked
 WHERE m.id = ranked.id AND m.sort_order IS NULL;

UPDATE milestones SET sort_order = 1 WHERE sort_order IS NULL;

ALTER TABLE milestones ALTER COLUMN sort_order SET NOT NULL;
ALTER TABLE milestones ALTER COLUMN sort_order SET DEFAULT 1;

ALTER TABLE milestones DROP CONSTRAINT IF EXISTS milestones_live_project_ck;
ALTER TABLE milestones
   ADD CONSTRAINT milestones_live_project_ck
   CHECK (deleted_at IS NOT NULL OR project_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS milestones_project_sort_idx
   ON milestones (workspace_id, project_id, sort_order ASC, id ASC)
   WHERE deleted_at IS NULL AND project_id IS NOT NULL;
