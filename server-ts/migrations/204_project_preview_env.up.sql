-- The environment a project's builds are given: the variables its repository
-- expects and does not carry, such as a provider's API key.
--
-- A preview runs the pull request's code, and code that reads OPENAI_API_KEY at
-- start-up stops before it answers when the variable is missing. The values
-- belong to the project rather than to a task or a preview: every task of the
-- project builds the same repository, and the next preview needs them as much
-- as this one.
--
-- One row per project, holding the whole `.env` text as a person wrote it
-- (comments and order included), sealed with the integration key like every
-- other secret at rest: nonce, ciphertext, tag. Nothing in the clear, so a
-- query that selects the row into a log shows bytes. Gone with the project.
CREATE TABLE project_preview_env (
   project_id uuid PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
   workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
   sealed bytea NOT NULL,
   updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
   updated_at timestamptz NOT NULL DEFAULT now()
);
