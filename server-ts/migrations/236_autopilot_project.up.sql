-- An autopilot in create_issue mode may name the project each run's task is
-- filed under. The board stays required for issue numbering; the project is
-- optional and carries the repository an agent works in. Workspace-scoped,
-- like projects themselves, and set null if the project is deleted so an
-- autopilot is never left pointing at a project that no longer exists.
ALTER TABLE autopilots
   ADD COLUMN IF NOT EXISTS project_id uuid
      REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS autopilots_project_id_idx
   ON autopilots (project_id);
