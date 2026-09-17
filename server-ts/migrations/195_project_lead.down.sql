-- Reverses 195. Who led each project is not recoverable: the columns are
-- dropped, and a project that recorded the AI workflow as its lead goes back to
-- carrying no answer at all.

DROP TRIGGER IF EXISTS berry_projects_release_lead ON users;
DROP FUNCTION IF EXISTS berry_projects_release_lead();

DROP INDEX IF EXISTS projects_workspace_lead_idx;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_lead_ck;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_lead_user_fkey;

ALTER TABLE projects
    DROP COLUMN IF EXISTS lead_user_id,
    DROP COLUMN IF EXISTS lead_type;
