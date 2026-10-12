-- The workspace switches the GitLab settings drawer reads and writes.
-- No row means the defaults, which are all on, matching GitHub.

CREATE TABLE IF NOT EXISTS gitlab_workspace_settings (
    workspace_id      uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
    enabled           boolean NOT NULL DEFAULT true,
    show_linked_mrs   boolean NOT NULL DEFAULT true,
    co_author_trailer boolean NOT NULL DEFAULT true,
    auto_link_mrs     boolean NOT NULL DEFAULT true,
    updated_by        uuid REFERENCES users (id) ON DELETE SET NULL,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE gitlab_workspace_settings IS
    'Per-workspace GitLab feature switches. Absent row = defaults (all on).';
