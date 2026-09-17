-- Berry migration 195: a project records who leads it.
--
-- The create-project dialog has always offered a lead, and one of the choices
-- is not a person: "AI workflow" means Berry plans the project and turns the
-- plan into tasks. That choice was never stored. The client kept it in form
-- state, sent it nowhere, and the projects list filled the lead in from
-- whoever was looking — so every project read as led by the reader, and the
-- one decision that changes what creating a project *does* left no trace to
-- audit, display, or act on later.
--
-- Two columns rather than one, because the two answers are not the same shape:
-- a person is a row in `users`, and the AI workflow is not a row anywhere. The
-- check keeps the pair honest — a user lead carries an id, the AI workflow
-- carries none, and NULL is "nobody has decided yet", which is what every
-- project created before this migration truthfully is.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS lead_type text,
    ADD COLUMN IF NOT EXISTS lead_user_id uuid;

ALTER TABLE projects
    DROP CONSTRAINT IF EXISTS projects_lead_user_fkey;

ALTER TABLE projects
    ADD CONSTRAINT projects_lead_user_fkey
    FOREIGN KEY (lead_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE projects
    DROP CONSTRAINT IF EXISTS projects_lead_ck;

-- CASE on the type rather than a chain of ORs, because a CHECK that evaluates
-- to unknown is a CHECK that passes. Written as `lead_type = 'user' AND ...`,
-- a row with no type and a user id makes every branch NULL and is admitted —
-- which is the one broken pair a `lead_user_id` column invites. Here NULL
-- matches no WHEN, so it falls to ELSE and has to be empty on both columns.
ALTER TABLE projects
    ADD CONSTRAINT projects_lead_ck CHECK (
        CASE lead_type
            WHEN 'ai_workflow' THEN lead_user_id IS NULL
            WHEN 'user' THEN lead_user_id IS NOT NULL
            ELSE lead_type IS NULL AND lead_user_id IS NULL
        END
    );

-- Deleting an account must not fail, and must not leave a project claiming a
-- user lead with no user.
--
-- `users` is hard-deleted — there is no `deleted_at` on it — so the foreign key
-- above would fire `SET NULL` on `lead_user_id` and leave `lead_type = 'user'`,
-- which the check refuses *during* the DELETE. A CHECK cannot be deferred, so
-- the pair has to be cleared before the key acts: BEFORE DELETE, per row, for
-- that user's projects only. The foreign key then finds nothing left to null.
CREATE OR REPLACE FUNCTION berry_projects_release_lead()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE projects
       SET lead_type = NULL,
           lead_user_id = NULL,
           updated_at = now()
     WHERE lead_user_id = OLD.id;
    RETURN OLD;
END
$$;

DROP TRIGGER IF EXISTS berry_projects_release_lead ON users;

CREATE TRIGGER berry_projects_release_lead
BEFORE DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION berry_projects_release_lead();

-- Answering "which projects is Berry running" without scanning the workspace.
CREATE INDEX IF NOT EXISTS projects_workspace_lead_idx
    ON projects (workspace_id, lead_type)
 WHERE lead_type IS NOT NULL AND deleted_at IS NULL;
