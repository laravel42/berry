-- Skills can be archived the way agents and autopilots already are.
-- The live name stays unique so a workspace can reuse a name after archive;
-- restoring then conflicts if that name is taken again.

ALTER TABLE skills ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DROP INDEX IF EXISTS skills_workspace_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS skills_workspace_live_name_key
    ON skills (workspace_id, name)
    WHERE archived_at IS NULL;
