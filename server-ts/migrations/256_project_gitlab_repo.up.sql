-- Berry migration 256: a project can name the GitLab project it delivers into.
--
-- Parallel to github_repo_id / github_repo_full_name (migration 017). GitLab's
-- path_with_namespace may be nested (group/sub/project), so the shape allows
-- one or more slash-separated segments rather than exactly two. At most one
-- SCM link is set: a project that claimed both would disagree about where a
-- run checks out.
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS gitlab_project_id bigint,
    ADD COLUMN IF NOT EXISTS gitlab_project_path text;

ALTER TABLE projects
    DROP CONSTRAINT IF EXISTS projects_gitlab_repo_pair_ck;
ALTER TABLE projects
    ADD CONSTRAINT projects_gitlab_repo_pair_ck CHECK (
        (gitlab_project_id IS NULL AND gitlab_project_path IS NULL)
        OR (gitlab_project_id IS NOT NULL AND gitlab_project_path IS NOT NULL)
    ) NOT VALID;

ALTER TABLE projects
    DROP CONSTRAINT IF EXISTS projects_gitlab_repo_shape_ck;
ALTER TABLE projects
    ADD CONSTRAINT projects_gitlab_repo_shape_ck CHECK (
        gitlab_project_path IS NULL
        OR gitlab_project_path ~ '^[A-Za-z0-9._-]{1,100}(/[A-Za-z0-9._-]{1,100})+$'
    ) NOT VALID;

ALTER TABLE projects
    DROP CONSTRAINT IF EXISTS projects_scm_repo_one_ck;
ALTER TABLE projects
    ADD CONSTRAINT projects_scm_repo_one_ck CHECK (
        github_repo_id IS NULL
        OR gitlab_project_id IS NULL
    ) NOT VALID;

CREATE INDEX IF NOT EXISTS projects_gitlab_repo_idx
    ON projects (gitlab_project_id)
    WHERE gitlab_project_id IS NOT NULL AND deleted_at IS NULL;
