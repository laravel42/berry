-- Berry migration 197: project activity updates.
--
-- The project overview's "Post update" composer only ever wrote into a
-- browser store, so a refresh emptied the Activity tab. An update is a fact
-- about the project the same way a comment is a fact about an issue: it has
-- to live in Postgres, and posting one also records the project's health so
-- the chip and the latest update stay the same fact.

CREATE TABLE IF NOT EXISTS project_updates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    body text NOT NULL,
    health text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT project_updates_project_fk
        FOREIGN KEY (workspace_id, project_id)
        REFERENCES projects(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT project_updates_workspace_id_id_key
        UNIQUE (workspace_id, id),
    CONSTRAINT project_updates_body_length_ck
        CHECK (char_length(body) BETWEEN 1 AND 100000),
    CONSTRAINT project_updates_health_ck
        CHECK (health IN ('on_track', 'at_risk', 'off_track'))
);

CREATE INDEX IF NOT EXISTS project_updates_project_order_idx
    ON project_updates (workspace_id, project_id, created_at DESC, id DESC);
