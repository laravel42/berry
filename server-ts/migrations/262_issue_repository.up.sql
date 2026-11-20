-- Berry migration 262: a task names the repository it is worked in.
--
-- Until now a task's repository was its project's (migrations 017 and 256),
-- so every task in a project checked out the same code. A task now carries
-- its own GitHub or GitLab repository, in the same shape as the project's
-- columns; the project's link stays as the default a task starts with.
--
-- At most one host per task, as on projects: a task that named both would
-- disagree with itself about where a run checks out.
ALTER TABLE issues
    ADD COLUMN IF NOT EXISTS github_repo_id bigint,
    ADD COLUMN IF NOT EXISTS github_repo_full_name text,
    ADD COLUMN IF NOT EXISTS gitlab_project_id bigint,
    ADD COLUMN IF NOT EXISTS gitlab_project_path text;

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_github_repo_pair_ck;
ALTER TABLE issues
    ADD CONSTRAINT issues_github_repo_pair_ck CHECK (
        (github_repo_id IS NULL AND github_repo_full_name IS NULL)
        OR (github_repo_id IS NOT NULL AND github_repo_full_name IS NOT NULL)
    ) NOT VALID;

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_github_repo_shape_ck;
ALTER TABLE issues
    ADD CONSTRAINT issues_github_repo_shape_ck CHECK (
        github_repo_full_name IS NULL
        OR github_repo_full_name ~ '^[A-Za-z0-9._-]{1,100}/[A-Za-z0-9._-]{1,100}$'
    ) NOT VALID;

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_gitlab_repo_pair_ck;
ALTER TABLE issues
    ADD CONSTRAINT issues_gitlab_repo_pair_ck CHECK (
        (gitlab_project_id IS NULL AND gitlab_project_path IS NULL)
        OR (gitlab_project_id IS NOT NULL AND gitlab_project_path IS NOT NULL)
    ) NOT VALID;

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_gitlab_repo_shape_ck;
ALTER TABLE issues
    ADD CONSTRAINT issues_gitlab_repo_shape_ck CHECK (
        gitlab_project_path IS NULL
        OR gitlab_project_path ~ '^[A-Za-z0-9._-]{1,100}(/[A-Za-z0-9._-]{1,100})+$'
    ) NOT VALID;

ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_scm_repo_one_ck;
ALTER TABLE issues
    ADD CONSTRAINT issues_scm_repo_one_ck CHECK (
        github_repo_id IS NULL OR gitlab_project_id IS NULL
    ) NOT VALID;

-- Reviews and conflict checks look up the open tasks of one repository.
CREATE INDEX IF NOT EXISTS issues_github_repo_idx
    ON issues (lower(github_repo_full_name))
    WHERE github_repo_full_name IS NOT NULL AND deleted_at IS NULL;

-- Every live task takes its project's repository, so runs keep checking out
-- the code they did before this migration.
UPDATE issues AS i
   SET github_repo_id = p.github_repo_id,
       github_repo_full_name = p.github_repo_full_name,
       gitlab_project_id = p.gitlab_project_id,
       gitlab_project_path = p.gitlab_project_path
  FROM issue_project_links AS link
  JOIN projects AS p ON p.id = link.project_id AND p.deleted_at IS NULL
 WHERE link.issue_id = i.id
   AND i.deleted_at IS NULL
   AND (p.github_repo_id IS NOT NULL OR p.gitlab_project_id IS NOT NULL);
